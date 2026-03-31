import {logError, logWarn } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { 
  estimates, 
  estimateLineItems, 
  estimateLineItemSubcontractors,
  estimateVersions,
  projects,
  bids,
  quantityCategories,
  takeoffMeasurements,
  takeoffSheets,
  insertEstimateSchema,
  insertEstimateLineItemSchema,
  organizations,
  procurementItems,
  scopeItems,
  jobClassifications,
  bidSubcontractorQuotes,
  vendorPricingCatalogs,
  type EstimateLineItem,
  type EstimateLineItemSubcontractor,
} from "@shared/schema";
import { eq, and, desc, sql, or, isNull, inArray } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { openai } from "./ai/openaiClient";
import { governedAiCall } from "./services/aiGovernance";
import { 
  calculateMaterials, 
  generateMaterialRequirementsJson, 
  generateEquipmentRequirementsJson,
  type MaterialCalculationInputs 
} from "./materialCalculator";
import { getOrgIdForFilter } from "./orgFilter";
import { successResponse, safeJsonParse } from "./responseHelper";
import { 
  getProductionRateForSOW, 
  getProductionRateBySowItemId,
  estimateLaborHoursFromProductionRate,
  getProductionRateSuggestions,
  OrganizationRequiredError,
  type ProductionRateStats,
  type LaborEstimate 
} from "./productionRateService";

async function matchVendorPricing(lineItems: EstimateLineItem[], organizationId: string): Promise<void> {
  try {
    const catalogItems = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        unit: vendorPricingCatalogs.unit,
      })
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.organizationId, organizationId));

    if (catalogItems.length === 0) return;

    const updates: { id: string; vendorPricingId: string | null; vendorMatchConfidence: string }[] = [];

    for (const li of lineItems) {
      const desc = (li.description || "").toLowerCase().trim();
      const liUnit = (li.unit || "").toLowerCase().trim();
      let bestMatch: { id: string; confidence: string } | null = null;

      for (const cat of catalogItems) {
        const catName = (cat.itemName || "").toLowerCase().trim();
        const catCode = (cat.itemCode || "").toLowerCase().trim();
        const catUnit = (cat.unit || "").toLowerCase().trim();

        if (catCode && desc === catCode) {
          bestMatch = { id: cat.id, confidence: "EXACT" };
          break;
        }
        if (desc === catName && liUnit === catUnit) {
          bestMatch = { id: cat.id, confidence: "EXACT" };
          break;
        }
        if (desc === catName) {
          bestMatch = { id: cat.id, confidence: "EXACT" };
          break;
        }
        if (catName && (desc.includes(catName) || catName.includes(desc)) && liUnit === catUnit) {
          if (!bestMatch || bestMatch.confidence !== "EXACT") {
            bestMatch = { id: cat.id, confidence: "FUZZY" };
          }
        }
      }

      updates.push({
        id: li.id,
        vendorPricingId: bestMatch?.id || null,
        vendorMatchConfidence: bestMatch?.confidence || "NO_MATCH",
      });
    }

    await Promise.all(updates.map(u =>
      db.update(estimateLineItems)
        .set({ vendorPricingId: u.vendorPricingId, vendorMatchConfidence: u.vendorMatchConfidence })
        .where(eq(estimateLineItems.id, u.id))
    ));
  } catch (err) {
    logError("[VendorMatch] Error matching vendor pricing:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

// Helper to check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
function hasEstimateAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "ESTIMATOR"].includes(role);
}

// Helper to check if user has general management access (includes SUPERINTENDENT for read-only)
function hasManagementAccess(role: string): boolean {
  return ["ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"].includes(role);
}

// Create a snapshot of current estimate line items and store in estimate_versions
// Throws on failure so callers can handle or log appropriately
async function createEstimateSnapshot(estimateId: string, savedByUserId: string): Promise<void> {
  const lineItems = await db.select().from(estimateLineItems).where(eq(estimateLineItems.estimateId, estimateId));
  const totalCost = lineItems.reduce((sum, item) => sum + Number(item.totalCost || 0), 0);
  // Enrich each line item with a deterministic unitCost for comparison purposes
  const enrichedLineItems = lineItems.map((item) => {
    const qty = Number(item.quantity) || 0;
    const tc = Number(item.totalCost) || 0;
    const unitCost = qty > 0 ? tc / qty : 0;
    return { ...item, unitCost: unitCost.toFixed(4) };
  });
  const snapshot = JSON.stringify({
    savedByUserId,
    totalCost,
    lineItemCount: lineItems.length,
    lineItems: enrichedLineItems,
  });
  const lastVersion = await db
    .select({ versionNumber: estimateVersions.versionNumber })
    .from(estimateVersions)
    .where(eq(estimateVersions.estimateId, estimateId))
    .orderBy(desc(estimateVersions.versionNumber))
    .limit(1);
  const nextVersion = lastVersion.length > 0 ? lastVersion[0].versionNumber + 1 : 1;
  await db.insert(estimateVersions).values({ estimateId, versionNumber: nextVersion, snapshot });
}

// Valid database enum values
const VALID_CATEGORIES = ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"];
const VALID_WIRE_MESH_TYPES = ["6X6_W1.4_W1.4", "6X6_W2.9_W2.9", "4X4_W1.4_W1.4", "4X4_W2.9_W2.9"];
const VALID_SEALER_TYPES = ["CURE_AND_SEAL", "PENETRATING", "ACRYLIC", "EPOXY"];

// Map frontend wire mesh type values to database enum values
function normalizeWireMeshType(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const upperValue = value.toUpperCase();
  
  // Direct match
  if (VALID_WIRE_MESH_TYPES.includes(upperValue)) return upperValue;
  
  // Map shorthand values
  const mappings: Record<string, string> = {
    "6X6_W1.4": "6X6_W1.4_W1.4",
    "6X6_W2.9": "6X6_W2.9_W2.9",
    "4X4_W1.4": "4X4_W1.4_W1.4",
    "4X4_W2.9": "4X4_W2.9_W2.9",
  };
  
  return mappings[upperValue] || undefined;
}

// Map frontend sealer type values to database enum values
function normalizeSealerType(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const upperValue = value.toUpperCase();
  
  // Direct match
  if (VALID_SEALER_TYPES.includes(upperValue)) return upperValue;
  
  // Map shorthand values
  const mappings: Record<string, string> = {
    "CURE_SEAL": "CURE_AND_SEAL",
    "CURE": "CURE_AND_SEAL",
  };
  
  return mappings[upperValue] || undefined;
}

// Normalize category - map invalid/new categories to GENERAL
function normalizeCategory(value: string | undefined | null): string {
  if (!value) return "GENERAL";
  const upperValue = value.toUpperCase();
  
  if (VALID_CATEGORIES.includes(upperValue)) return upperValue;
  
  // Map common new trade categories to GENERAL
  return "GENERAL";
}

// Transform line item data to match database schema
function normalizeLineItemData(data: any): any {
  const { subcontractorAssignments, ...rest } = data;
  return {
    ...rest,
    category: normalizeCategory(rest.category),
    wireMeshType: normalizeWireMeshType(rest.wireMeshType),
    sealerType: normalizeSealerType(rest.sealerType),
    sealerCoats: rest.sealerCoats !== undefined ? Number(rest.sealerCoats) : undefined,
  };
}

const router = Router();

// Get active estimate for a project
router.get("/api/projects/:projectId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
      
      if (mustDenyAccess) {
        return res.json({ estimate: null });
      }

      const { projectId } = req.params;

      // Check if user has management access (includes SUPERINTENDENT for read-only)
      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check project access
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Check organization access
      if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
        return res.json({ estimate: null });
      }

      // Get the most recent active estimate (DRAFT, PENDING_APPROVAL, or APPROVED)
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.projectId, projectId),
          sql`${estimates.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')`
        ),
        orderBy: [desc(estimates.createdAt)],
      });

      if (!estimate) {
        return res.json({ estimate: null });
      }

      // Get line items for this estimate
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimate.id),
      });

      // Calculate totals
      const totals = lineItems.reduce((acc: {
        materialCost: number;
        laborCost: number;
        laborHours: number;
        equipmentCost: number;
        consumablesCost: number;
        subcontractCost: number;
        overheadAllocation: number;
        profitAllocation: number;
        totalCost: number;
      }, item: EstimateLineItem) => ({
        materialCost: acc.materialCost + Number(item.materialCost),
        laborCost: acc.laborCost + Number(item.laborCost),
        laborHours: acc.laborHours + Number(item.laborHours),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation),
        totalCost: acc.totalCost + Number(item.totalCost),
      }), {
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      });

      res.json({ estimate: { ...estimate, lineItems, totals } });
    } catch (error) {
      logError("Error fetching estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch estimate" });
    }
  });

  // Create new estimate for project
  router.post("/api/projects/:projectId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log("[Estimate] Create estimate request:", { projectId: req.params.projectId, user: req.user?.email });
      const { projectId } = req.params;
      const userId = req.user!.id;

      // Check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
      if (!hasEstimateAccess(req.user!.role)) {
        console.log("[Estimate] Permission denied:", req.user!.role);
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check project exists
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // Get version number
      const existingEstimates = await db.query.estimates.findMany({
        where: eq(estimates.projectId, projectId),
        orderBy: [desc(estimates.versionNumber)],
      });

      const versionNumber = existingEstimates.length > 0 
        ? existingEstimates[0].versionNumber + 1 
        : 1;

      // Create estimate
      console.log("[Estimate] Creating estimate with version:", versionNumber);
      const [newEstimate] = await db.insert(estimates).values({
        projectId,
        versionNumber,
        status: "DRAFT",
        createdById: userId,
      }).returning();

      console.log("[Estimate] Created estimate:", newEstimate.id);
      res.status(201).json(newEstimate);
    } catch (error) {
      logError("[Estimate] Error creating estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to create estimate" });
    }
  });

  // Get active estimate for a bid
  router.get("/api/bids/:bidId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check bid exists
      const bid = await db.query.bids.findFirst({
        where: eq(bids.id, bidId),
      });

      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      // Get the most recent active estimate
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.bidId, bidId),
          sql`${estimates.status} IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')`
        ),
        orderBy: [desc(estimates.createdAt)],
      });

      if (!estimate) {
        return res.json({ estimate: null });
      }

      // Get line items
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimate.id),
      });

      // Calculate totals
      const totals = lineItems.reduce((acc: {
        materialCost: number;
        laborCost: number;
        laborHours: number;
        equipmentCost: number;
        consumablesCost: number;
        subcontractCost: number;
        overheadAllocation: number;
        profitAllocation: number;
        totalCost: number;
      }, item: EstimateLineItem) => ({
        materialCost: acc.materialCost + Number(item.materialCost),
        laborCost: acc.laborCost + Number(item.laborCost),
        laborHours: acc.laborHours + Number(item.laborHours),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation),
        totalCost: acc.totalCost + Number(item.totalCost),
      }), {
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      });

      res.json({ estimate: { ...estimate, lineItems, totals } });
    } catch (error) {
      logError("Error fetching bid estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch estimate" });
    }
  });

  // Create new estimate for bid
  router.post("/api/bids/:bidId/estimate", requireAuth, async (req: AuthRequest, res) => {
    try {
      console.log("[Estimate] Create bid estimate request:", { bidId: req.params.bidId, user: req.user?.email });
      const { bidId } = req.params;
      const userId = req.user!.id;

      if (!hasEstimateAccess(req.user!.role)) {
        console.log("[Estimate] Permission denied:", req.user!.role);
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check bid exists
      const bid = await db.query.bids.findFirst({
        where: eq(bids.id, bidId),
      });

      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }

      // Get version number
      const existingEstimates = await db.query.estimates.findMany({
        where: eq(estimates.bidId, bidId),
        orderBy: [desc(estimates.versionNumber)],
      });

      const versionNumber = existingEstimates.length > 0 
        ? existingEstimates[0].versionNumber + 1 
        : 1;

      // Create estimate
      console.log("[Estimate] Creating bid estimate with version:", versionNumber);
      const [newEstimate] = await db.insert(estimates).values({
        bidId,
        projectId: null,
        versionNumber,
        status: "DRAFT",
        createdById: userId,
      }).returning();

      console.log("[Estimate] Created bid estimate:", newEstimate.id);
      res.status(201).json(newEstimate);
    } catch (error) {
      logError("[Estimate] Error creating bid estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to create estimate" });
    }
  });

  // Import takeoff quantities into estimate
  router.post("/api/projects/:projectId/estimate/import-takeoff", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { estimateId, categoryIds } = req.body as { estimateId: string, categoryIds: string[] };

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate belongs to project
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.id, estimateId),
          eq(estimates.projectId, projectId)
        ),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      const categories = categoryIds?.length
        ? await db.query.quantityCategories.findMany({
            where: inArray(quantityCategories.id, categoryIds),
          })
        : [];

      const existingImportedCategoryIds = new Set(
        (await db.select({ catId: estimateLineItems.sourceTakeoffCategoryId })
          .from(estimateLineItems)
          .where(and(
            eq(estimateLineItems.estimateId, estimateId),
            eq(estimateLineItems.source, "TAKEOFF"),
          ))
        ).map(r => r.catId).filter(Boolean)
      );

      const filteredCategories = categories.filter(c => !existingImportedCategoryIds.has(c.id));

      const lineItemsToCreate = [];

      for (const category of filteredCategories) {
        // Get measurements for this category
        const measurements = await db.query.takeoffMeasurements.findMany({
          where: eq(takeoffMeasurements.categoryId, category.id),
        });
        // Calculate totals for this category
        let linearTotal = 0;
        let areaTotal = 0;
        let volumeTotal = 0;
        let countTotal = 0;

        for (const measurement of measurements) {
          if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
            if (measurement.computedLengthFt) {
              linearTotal += Number(measurement.computedLengthFt);
            } else if (measurement.points) {
              try {
                const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                  const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                  linearTotal += length;
                  await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
            if (measurement.computedAreaFt2) {
              areaTotal += Number(measurement.computedAreaFt2);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  areaTotal += area;
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "VOLUME") {
            if (measurement.computedVolumeCy) {
              volumeTotal += Number(measurement.computedVolumeCy);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  const volume = computeVolumeInCY(area, measurement.depthFeet);
                  volumeTotal += volume;
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "COUNT") {
            countTotal += (measurement.count ?? 1);
          }
        }

        // Create line items based on non-zero totals
        if (linearTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Linear`,
            quantity: linearTotal.toString(),
            unit: "LF",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: linearTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (areaTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Area`,
            quantity: areaTotal.toString(),
            unit: "SF",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: areaTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (volumeTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Volume`,
            quantity: volumeTotal.toString(),
            unit: "CY",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: volumeTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }

        if (countTotal > 0) {
          lineItemsToCreate.push({
            estimateId,
            category: "GENERAL" as const,
            description: `${category.name} - Count`,
            quantity: countTotal.toString(),
            unit: "EA",
            source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id,
            computedQuantity: countTotal.toString(),
            materialCost: "0",
            laborHours: "0",
            laborCost: "0",
            equipmentCost: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: "0",
          });
        }
      }

      // Also import uncategorized measurements from this project's sheets
      const projectSheets = await db.query.takeoffSheets.findMany({
        where: eq(takeoffSheets.projectId, projectId),
      });
      if (projectSheets.length > 0) {
        const sheetIds = projectSheets.map(s => s.id);
        const uncategorizedMeasurements = await db.query.takeoffMeasurements.findMany({
          where: and(
            inArray(takeoffMeasurements.sheetId, sheetIds),
            isNull(takeoffMeasurements.categoryId)
          ),
        });

        if (uncategorizedMeasurements.length > 0) {
          let uncatLinear = 0, uncatArea = 0, uncatVolume = 0, uncatCount = 0;

          for (const measurement of uncategorizedMeasurements) {
            if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
              if (measurement.computedLengthFt) {
                uncatLinear += Number(measurement.computedLengthFt);
              } else if (measurement.points) {
                try {
                  const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                    const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                    uncatLinear += length;
                    await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
              if (measurement.computedAreaFt2) {
                uncatArea += Number(measurement.computedAreaFt2);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    uncatArea += area;
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "VOLUME") {
              if (measurement.computedVolumeCy) {
                uncatVolume += Number(measurement.computedVolumeCy);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    const volume = computeVolumeInCY(area, measurement.depthFeet);
                    uncatVolume += volume;
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "COUNT") {
              uncatCount += (measurement.count ?? 1);
            }
          }

          const buildUncatLineItem = (description: string, qty: number, unit: string) => ({
            estimateId, category: "GENERAL" as const, description,
            quantity: qty.toString(), unit, source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: null as unknown as string,
            computedQuantity: qty.toString(),
            materialCost: "0", laborHours: "0", laborCost: "0",
            equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
            overheadAllocation: "0", profitAllocation: "0", totalCost: "0",
          });

          if (uncatLinear > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Linear", uncatLinear, "LF"));
          if (uncatArea > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Area", uncatArea, "SF"));
          if (uncatVolume > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Volume", uncatVolume, "CY"));
          if (uncatCount > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Count", uncatCount, "EA"));
        }
      }

      if (lineItemsToCreate.length > 0) {
        const newLineItems = await db.insert(estimateLineItems).values(lineItemsToCreate).returning();
        if (req.user?.organizationId) {
          matchVendorPricing(newLineItems, req.user.organizationId).catch(() => {});
        }
        try {
          await createEstimateSnapshot(estimateId, req.user!.id);
        } catch (snapshotErr) {
          logError("[Snapshot] Failed to create snapshot after project import-takeoff:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
        }
        res.json({ lineItems: newLineItems, count: newLineItems.length });
      } else {
        res.json({ lineItems: [], count: 0 });
      }
    } catch (error) {
      logError("Error importing takeoff:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to import takeoff" });
    }
  });

  // Import takeoff measurements into a bid estimate
  router.post("/api/bids/:bidId/estimate/import-takeoff", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { bidId } = req.params;
      const { estimateId, categoryIds, jobClassificationId, checkDuplicates, duplicateAction } = req.body as {
        estimateId: string;
        categoryIds: string[];
        jobClassificationId?: string;
        checkDuplicates?: boolean;
        duplicateAction?: "skip" | "replace" | "alongside";
      };

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate belongs to this bid
      const estimate = await db.query.estimates.findFirst({
        where: and(
          eq(estimates.id, estimateId),
          eq(estimates.bidId, bidId)
        ),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found for this bid" });
      }

      const categories = categoryIds?.length
        ? await db.query.quantityCategories.findMany({
            where: inArray(quantityCategories.id, categoryIds),
          })
        : [];

      const existingImportedCategoryIds = new Set(
        (await db.select({ catId: estimateLineItems.sourceTakeoffCategoryId })
          .from(estimateLineItems)
          .where(and(
            eq(estimateLineItems.estimateId, estimateId),
            eq(estimateLineItems.source, "TAKEOFF"),
          ))
        ).map(r => r.catId).filter(Boolean)
      );

      const filteredCategories = categories.filter(c => !existingImportedCategoryIds.has(c.id));

      if (checkDuplicates) {
        const existingManualItems = await db
          .select({
            id: estimateLineItems.id,
            description: estimateLineItems.description,
            category: estimateLineItems.category,
            workTypeCode: estimateLineItems.workTypeCode,
          })
          .from(estimateLineItems)
          .where(and(
            eq(estimateLineItems.estimateId, estimateId),
            eq(estimateLineItems.source, "MANUAL"),
          ));

        const categoryNames = filteredCategories.map(c => c.name.toLowerCase());
        const categoryEnumValues = filteredCategories.map(c => c.name.toUpperCase().replace(/\s+/g, "_"));
        const conflicts = existingManualItems.filter(item => {
          const desc = (item.description || "").toLowerCase();
          const itemCategory = (item.category || "").toUpperCase();
          const matchByCategory = categoryEnumValues.some(enumVal => itemCategory === enumVal);
          const matchByDescription = categoryNames.some(catName =>
            desc === catName || desc.startsWith(catName + " ") || desc.startsWith(catName + ":")
          );
          return matchByCategory || matchByDescription;
        });

        if (conflicts.length > 0) {
          return res.json({
            hasConflicts: true,
            conflicts: conflicts.map(c => ({
              id: c.id,
              description: c.description,
              category: c.category,
            })),
            message: `${conflicts.length} existing manual line item(s) may overlap with takeoff categories being imported.`,
          });
        }
      }

      if (duplicateAction === "skip") {
        return res.json({ lineItems: [], count: 0, skipped: true });
      }

      if (duplicateAction === "replace") {
        const categoryNames = filteredCategories.map(c => c.name.toLowerCase());
        const categoryEnumValues = filteredCategories.map(c => c.name.toUpperCase().replace(/\s+/g, "_"));
        const existingManualItems = await db
          .select({
            id: estimateLineItems.id,
            description: estimateLineItems.description,
            category: estimateLineItems.category,
          })
          .from(estimateLineItems)
          .where(and(
            eq(estimateLineItems.estimateId, estimateId),
            eq(estimateLineItems.source, "MANUAL"),
          ));
        const idsToRemove = existingManualItems
          .filter(item => {
            const desc = (item.description || "").toLowerCase();
            const itemCategory = (item.category || "").toUpperCase();
            const matchByCategory = categoryEnumValues.some(enumVal => itemCategory === enumVal);
            const matchByDescription = categoryNames.some(catName =>
              desc === catName || desc.startsWith(catName + " ") || desc.startsWith(catName + ":")
            );
            return matchByCategory || matchByDescription;
          })
          .map(item => item.id);
        if (idsToRemove.length > 0) {
          await db.delete(estimateLineItems).where(inArray(estimateLineItems.id, idsToRemove));
        }
      }

      // Resolve labor classification rate if provided — scoped to org for tenant isolation
      let classificationRate: number | null = null;
      let classificationName: string | null = null;
      if (jobClassificationId) {
        const [classification] = await db
          .select({ id: jobClassifications.id, name: jobClassifications.name, defaultRegularRate: jobClassifications.defaultRegularRate })
          .from(jobClassifications)
          .where(and(
            eq(jobClassifications.id, jobClassificationId),
            eq(jobClassifications.organizationId, req.user!.organizationId!)
          ))
          .limit(1);
        if (!classification) {
          return res.status(400).json({ error: "Job classification not found or not accessible" });
        }
        if (classification.defaultRegularRate !== null) {
          classificationRate = Number(classification.defaultRegularRate);
          classificationName = classification.name;
        }
      }

      const orgId = req.user!.organizationId;

      const lineItemsToCreate: Array<{
        estimateId: string;
        category: "GENERAL";
        description: string;
        quantity: string;
        unit: string;
        source: "TAKEOFF";
        sourceTakeoffCategoryId: string;
        computedQuantity: string;
        materialCost: string;
        laborHours: string;
        laborCost: string;
        equipmentCost: string;
        consumablesCost: string;
        subcontractCost: string;
        overheadAllocation: string;
        profitAllocation: string;
        totalCost: string;
        jobClassificationId?: string;
        laborRateUsed?: string;
      }> = [];

      for (const category of filteredCategories) {
        const measurements = await db.query.takeoffMeasurements.findMany({
          where: eq(takeoffMeasurements.categoryId, category.id),
        });

        let linearTotal = 0;
        let areaTotal = 0;
        let volumeTotal = 0;
        let countTotal = 0;

        for (const measurement of measurements) {
          if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
            if (measurement.computedLengthFt) {
              linearTotal += Number(measurement.computedLengthFt);
            } else if (measurement.points) {
              try {
                const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                  const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                  linearTotal += length;
                  await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if ((measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA")) {
            if (measurement.computedAreaFt2) {
              areaTotal += Number(measurement.computedAreaFt2);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  areaTotal += area;
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "VOLUME") {
            if (measurement.computedVolumeCy) {
              volumeTotal += Number(measurement.computedVolumeCy);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  const volume = computeVolumeInCY(area, measurement.depthFeet);
                  volumeTotal += volume;
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "COUNT") {
            countTotal += (measurement.count ?? 1);
          }
        }

        const buildLineItem = async (description: string, qty: number, unit: string) => {
          const base = {
            estimateId, category: "GENERAL" as const, description,
            quantity: qty.toString(), unit, source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: category.id, computedQuantity: qty.toString(),
            materialCost: "0", equipmentCost: "0", consumablesCost: "0",
            subcontractCost: "0", overheadAllocation: "0", profitAllocation: "0",
          };

          if (classificationRate !== null && classificationRate > 0 && orgId) {
            let laborHours = 0;
            try {
              const laborEstimate = await estimateLaborHoursFromProductionRate(description, unit, qty, orgId);
              if (laborEstimate.confidence !== "NONE") {
                laborHours = laborEstimate.suggestedLaborHours;
              }
            } catch {
              logWarn("Non-critical operation failed");
            }
            const laborCost = parseFloat((laborHours * classificationRate).toFixed(2));
            const totalCost = laborCost; // material/equip are all 0 at import time
            return {
              ...base,
              laborHours: laborHours.toFixed(2),
              laborCost: laborCost.toFixed(2),
              totalCost: totalCost.toFixed(2),
              jobClassificationId,
              laborRateUsed: classificationRate.toFixed(2),
            };
          }

          return {
            ...base,
            laborHours: "0",
            laborCost: "0",
            totalCost: "0",
          };
        };

        if (linearTotal > 0) {
          lineItemsToCreate.push(await buildLineItem(`${category.name} - Linear`, linearTotal, "LF"));
        }
        if (areaTotal > 0) {
          lineItemsToCreate.push(await buildLineItem(`${category.name} - Area`, areaTotal, "SF"));
        }
        if (volumeTotal > 0) {
          lineItemsToCreate.push(await buildLineItem(`${category.name} - Volume`, volumeTotal, "CY"));
        }
        if (countTotal > 0) {
          lineItemsToCreate.push(await buildLineItem(`${category.name} - Count`, countTotal, "EA"));
        }
      }

      const hasExistingUncategorizedImport = (await db.select({ id: estimateLineItems.id })
        .from(estimateLineItems)
        .where(and(
          eq(estimateLineItems.estimateId, estimateId),
          eq(estimateLineItems.source, "TAKEOFF"),
          isNull(estimateLineItems.sourceTakeoffCategoryId)
        ))
        .limit(1)
      ).length > 0;

      const bidSheets = await db.query.takeoffSheets.findMany({
        where: eq(takeoffSheets.bidId, bidId),
      });
      if (bidSheets.length > 0 && !hasExistingUncategorizedImport) {
        const sheetIds = bidSheets.map(s => s.id);
        const uncategorizedMeasurements = await db.query.takeoffMeasurements.findMany({
          where: and(
            inArray(takeoffMeasurements.sheetId, sheetIds),
            isNull(takeoffMeasurements.categoryId)
          ),
        });

        if (uncategorizedMeasurements.length > 0) {
          let uncatLinear = 0, uncatArea = 0, uncatVolume = 0, uncatCount = 0;

          for (const measurement of uncategorizedMeasurements) {
            if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
              if (measurement.computedLengthFt) {
                uncatLinear += Number(measurement.computedLengthFt);
              } else if (measurement.points) {
                try {
                  const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                    const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                    uncatLinear += length;
                    await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
              if (measurement.computedAreaFt2) {
                uncatArea += Number(measurement.computedAreaFt2);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    uncatArea += area;
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "VOLUME") {
              if (measurement.computedVolumeCy) {
                uncatVolume += Number(measurement.computedVolumeCy);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    const volume = computeVolumeInCY(area, measurement.depthFeet);
                    uncatVolume += volume;
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "COUNT") {
              uncatCount += (measurement.count ?? 1);
            }
          }

          const buildUncatLineItem = (description: string, qty: number, unit: string) => ({
            estimateId, category: "GENERAL" as const, description,
            quantity: qty.toString(), unit, source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: null as unknown as string,
            computedQuantity: qty.toString(),
            materialCost: "0", laborHours: "0", laborCost: "0",
            equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
            overheadAllocation: "0", profitAllocation: "0", totalCost: "0",
          });

          if (uncatLinear > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Linear", uncatLinear, "LF"));
          if (uncatArea > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Area", uncatArea, "SF"));
          if (uncatVolume > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Volume", uncatVolume, "CY"));
          if (uncatCount > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Count", uncatCount, "EA"));
        }
      }

      if (lineItemsToCreate.length > 0) {
        const newLineItems = await db.insert(estimateLineItems).values(lineItemsToCreate).returning();
        if (req.user?.organizationId) {
          matchVendorPricing(newLineItems, req.user.organizationId).catch(() => {});
        }
        const laborRateAppliedCount = newLineItems.filter((li) => li.laborRateUsed !== null && Number(li.laborRateUsed) > 0).length;
        try {
          await createEstimateSnapshot(estimateId, req.user!.id);
        } catch (snapshotErr) {
          logError("[Snapshot] Failed to create snapshot after import-takeoff:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
        }
        res.json({ lineItems: newLineItems, count: newLineItems.length, laborRateAppliedCount, classificationName });
      } else {
        res.json({ lineItems: [], count: 0, laborRateAppliedCount: 0, classificationName: null });
      }
    } catch (error) {
      logError("Error importing bid takeoff:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to import takeoff" });
    }
  });

  // Production rate labor estimation — must be before /:estimateId routes to avoid route shadowing
  router.post("/api/estimates/production-rates/estimate-labor", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !hasManagementAccess(req.user!.role)) {
        return res.status(404).json({ error: "Not found" });
      }

      const { description, unit, quantity, workdayHours, organizationId: rawRequestedOrgId } = req.body;
      const requestedOrgId = typeof rawRequestedOrgId === 'string' && rawRequestedOrgId.trim().length > 0 
        ? rawRequestedOrgId.trim() 
        : null;
      let targetOrgId: string | null = null;

      if (isSuperAdmin) {
        if (!requestedOrgId) {
          return res.status(404).json({ error: "Not found" });
        }
        const orgExists = await db.query.organizations.findFirst({
          where: eq(organizations.id, requestedOrgId),
        });
        if (!orgExists) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = requestedOrgId;
      } else {
        if (!orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        if (requestedOrgId && requestedOrgId !== orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = orgId;
      }
      
      if (!description || !unit || quantity === undefined || !targetOrgId) {
        return res.status(404).json({ error: "Not found" });
      }

      const laborEstimate = await estimateLaborHoursFromProductionRate(
        description,
        unit,
        Number(quantity),
        targetOrgId,
        workdayHours ? Number(workdayHours) : 8
      );

      res.json({ estimate: laborEstimate });
    } catch (error) {
      if (error instanceof OrganizationRequiredError) {
        return res.status(404).json({ error: "Not found" });
      }
      logError("Error estimating labor hours:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(404).json({ error: "Not found" });
    }
  });

  // Add manual line item
  router.post("/api/estimates/:estimateId/line-items", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;
      const lineItem = req.body;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists and is editable
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      // Run material calculator if any material fields are present
      const materialInputs: MaterialCalculationInputs = {
        quantity: Number(lineItem.quantity) || 0,
        unit: lineItem.unit || '',
        concreteDepthInches: lineItem.concreteDepthInches,
        dimensionWidthInches: lineItem.dimensionWidthInches,
        dimensionHeightInches: lineItem.dimensionHeightInches,
        concreteWasteFactor: lineItem.concreteWasteFactor,
        requiresStoneBase: lineItem.requiresStoneBase,
        stoneDepthInches: lineItem.stoneDepthInches,
        stoneWasteFactor: lineItem.stoneWasteFactor,
        requiresExcavation: lineItem.requiresExcavation,
        excavationDepthInches: lineItem.excavationDepthInches,
        excavationWidthInches: lineItem.excavationWidthInches,
        excavationSwellFactor: lineItem.excavationSwellFactor,
        requiresWireMesh: lineItem.requiresWireMesh,
        wireMeshCoverageSF: lineItem.wireMeshCoverageSF,
        wireMeshWasteFactor: lineItem.wireMeshWasteFactor,
        requiresRebar: lineItem.requiresRebar,
        rebarSpacingInches: lineItem.rebarSpacingInches,
        rebarLengthFeet: lineItem.rebarLengthFeet,
        rebarWasteFactor: lineItem.rebarWasteFactor,
        requiresDowels: lineItem.requiresDowels,
        dowelSpacingInches: lineItem.dowelSpacingInches,
        jointLengthFeet: lineItem.jointLengthFeet,
        requiresSealer: lineItem.requiresSealer,
        sealerCoverageSFPerGallon: lineItem.sealerCoverageSFPerGallon,
        sealerCoats: lineItem.sealerCoats,
        sealerWasteFactor: lineItem.sealerWasteFactor,
        requiresUnderlayment: lineItem.requiresUnderlayment,
        underlaymentOverlapInches: lineItem.underlaymentOverlapInches,
        underlaymentWasteFactor: lineItem.underlaymentWasteFactor,
      };

      const materialResults = calculateMaterials(materialInputs);

      // Calculate totalCost from component costs
      const totalCost = (
        Number(lineItem.materialCost || 0) +
        Number(lineItem.laborCost || 0) +
        Number(lineItem.equipmentCost || 0) +
        Number(lineItem.consumablesCost || 0) +
        Number(lineItem.subcontractCost || 0) +
        Number(lineItem.overheadAllocation || 0) +
        Number(lineItem.profitAllocation || 0)
      ).toString();

      // Normalize data to fix frontend/backend enum mismatches
      const normalizedLineItem = normalizeLineItemData(lineItem);

      // Validate and create line item with calculated material quantities
      const validatedData = insertEstimateLineItemSchema.parse({
        ...normalizedLineItem,
        estimateId,
        source: "MANUAL",
        totalCost,
        calculatedConcreteYards: materialResults.calculatedConcreteYards?.toString(),
        calculatedStoneTons: materialResults.calculatedStoneTons?.toString(),
        calculatedExcavationYards: materialResults.calculatedExcavationYards?.toString(),
        calculatedWireMeshRolls: materialResults.calculatedWireMeshRolls?.toString(),
        calculatedRebarCount: materialResults.calculatedRebarCount?.toString(),
        calculatedRebarLinearFeet: materialResults.calculatedRebarLinearFeet?.toString(),
        calculatedDowelCount: materialResults.calculatedDowelCount?.toString(),
        calculatedSealerGallons: materialResults.calculatedSealerGallons?.toString(),
        calculatedUnderlaymentSF: materialResults.calculatedUnderlaymentSF?.toString(),
        materialRequirementsJson: generateMaterialRequirementsJson(materialResults),
        equipmentRequirementsJson: generateEquipmentRequirementsJson(materialResults),
      });

      const [newLineItem] = await db.insert(estimateLineItems).values(validatedData).returning();

      if (lineItem.subcontractorAssignments && Array.isArray(lineItem.subcontractorAssignments) && lineItem.subcontractorAssignments.length > 0) {
        const assignmentValues = lineItem.subcontractorAssignments.map((a: any) => ({
          lineItemId: newLineItem.id,
          subcontractorQuoteId: a.subcontractorQuoteId,
          allocatedCost: String(a.allocatedCost || 0),
          isSelected: a.isSelected !== false,
          notes: a.notes || null,
        }));
        await db.insert(estimateLineItemSubcontractors).values(assignmentValues);

        const totalAllocated = lineItem.subcontractorAssignments
          .filter((a: any) => a.isSelected !== false)
          .reduce((sum: number, a: any) => sum + Number(a.allocatedCost || 0), 0);

        const refreshedTotalCost = (
          Number(newLineItem.materialCost || 0) +
          Number(newLineItem.laborCost || 0) +
          Number(newLineItem.equipmentCost || 0) +
          Number(newLineItem.consumablesCost || 0) +
          totalAllocated +
          Number(newLineItem.overheadAllocation || 0) +
          Number(newLineItem.profitAllocation || 0)
        );

        await db.update(estimateLineItems)
          .set({
            subcontractCost: totalAllocated.toFixed(2),
            totalCost: refreshedTotalCost.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(estimateLineItems.id, newLineItem.id));

        newLineItem.subcontractCost = totalAllocated.toFixed(2);
        newLineItem.totalCost = refreshedTotalCost.toFixed(2);
      }

      if (req.user?.organizationId) {
        matchVendorPricing([newLineItem], req.user.organizationId).catch(() => {});
      }

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed to create snapshot after line item create:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      res.status(201).json(newLineItem);
    } catch (error) {
      logError("Error creating line item:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to create line item" });
    }
  });

  // Update line item
  router.put("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const updates = req.body;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      // Run material calculator if any material fields are present
      const materialInputs: MaterialCalculationInputs = {
        quantity: Number(updates.quantity) || 0,
        unit: updates.unit || '',
        concreteDepthInches: updates.concreteDepthInches,
        dimensionWidthInches: updates.dimensionWidthInches,
        dimensionHeightInches: updates.dimensionHeightInches,
        concreteWasteFactor: updates.concreteWasteFactor,
        requiresStoneBase: updates.requiresStoneBase,
        stoneDepthInches: updates.stoneDepthInches,
        stoneWasteFactor: updates.stoneWasteFactor,
        requiresExcavation: updates.requiresExcavation,
        excavationDepthInches: updates.excavationDepthInches,
        excavationWidthInches: updates.excavationWidthInches,
        excavationSwellFactor: updates.excavationSwellFactor,
        requiresWireMesh: updates.requiresWireMesh,
        wireMeshCoverageSF: updates.wireMeshCoverageSF,
        wireMeshWasteFactor: updates.wireMeshWasteFactor,
        requiresRebar: updates.requiresRebar,
        rebarSpacingInches: updates.rebarSpacingInches,
        rebarLengthFeet: updates.rebarLengthFeet,
        rebarWasteFactor: updates.rebarWasteFactor,
        requiresDowels: updates.requiresDowels,
        dowelSpacingInches: updates.dowelSpacingInches,
        jointLengthFeet: updates.jointLengthFeet,
        requiresSealer: updates.requiresSealer,
        sealerCoverageSFPerGallon: updates.sealerCoverageSFPerGallon,
        sealerCoats: updates.sealerCoats,
        sealerWasteFactor: updates.sealerWasteFactor,
        requiresUnderlayment: updates.requiresUnderlayment,
        underlaymentOverlapInches: updates.underlaymentOverlapInches,
        underlaymentWasteFactor: updates.underlaymentWasteFactor,
      };

      const materialResults = calculateMaterials(materialInputs);

      // Recalculate totalCost from component costs
      const totalCost = (
        Number(updates.materialCost || 0) +
        Number(updates.laborCost || 0) +
        Number(updates.equipmentCost || 0) +
        Number(updates.consumablesCost || 0) +
        Number(updates.subcontractCost || 0) +
        Number(updates.overheadAllocation || 0) +
        Number(updates.profitAllocation || 0)
      ).toString();

      // Normalize data to fix frontend/backend enum mismatches
      const normalizedUpdates = normalizeLineItemData(updates);

      // Update line item with recalculated total and material quantities
      let [updatedLineItem] = await db.update(estimateLineItems)
        .set({ 
          ...normalizedUpdates, 
          totalCost, 
          userAdjusted: true, 
          updatedAt: new Date(),
          calculatedConcreteYards: materialResults.calculatedConcreteYards?.toString() || null,
          calculatedStoneTons: materialResults.calculatedStoneTons?.toString() || null,
          calculatedExcavationYards: materialResults.calculatedExcavationYards?.toString() || null,
          calculatedWireMeshRolls: materialResults.calculatedWireMeshRolls?.toString() || null,
          calculatedRebarCount: materialResults.calculatedRebarCount?.toString() || null,
          calculatedRebarLinearFeet: materialResults.calculatedRebarLinearFeet?.toString() || null,
          calculatedDowelCount: materialResults.calculatedDowelCount?.toString() || null,
          calculatedSealerGallons: materialResults.calculatedSealerGallons?.toString() || null,
          calculatedUnderlaymentSF: materialResults.calculatedUnderlaymentSF?.toString() || null,
          materialRequirementsJson: generateMaterialRequirementsJson(materialResults),
          equipmentRequirementsJson: generateEquipmentRequirementsJson(materialResults),
        })
        .where(and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ))
        .returning();

      if (!updatedLineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      if (updates.subcontractorAssignments && Array.isArray(updates.subcontractorAssignments)) {
        await db.delete(estimateLineItemSubcontractors)
          .where(eq(estimateLineItemSubcontractors.lineItemId, lineItemId));

        if (updates.subcontractorAssignments.length > 0) {
          const assignmentValues = updates.subcontractorAssignments.map((a: any) => ({
            lineItemId,
            subcontractorQuoteId: a.subcontractorQuoteId,
            allocatedCost: String(a.allocatedCost || 0),
            isSelected: a.isSelected !== false,
            notes: a.notes || null,
          }));
          await db.insert(estimateLineItemSubcontractors).values(assignmentValues);

          const totalAllocated = updates.subcontractorAssignments
            .filter((a: any) => a.isSelected !== false)
            .reduce((sum: number, a: any) => sum + Number(a.allocatedCost || 0), 0);

          const refreshedTotalCost = (
            Number(updates.materialCost || updatedLineItem.materialCost || 0) +
            Number(updates.laborCost || updatedLineItem.laborCost || 0) +
            Number(updates.equipmentCost || updatedLineItem.equipmentCost || 0) +
            Number(updates.consumablesCost || updatedLineItem.consumablesCost || 0) +
            totalAllocated +
            Number(updates.overheadAllocation || updatedLineItem.overheadAllocation || 0) +
            Number(updates.profitAllocation || updatedLineItem.profitAllocation || 0)
          );

          await db.update(estimateLineItems)
            .set({
              subcontractCost: totalAllocated.toFixed(2),
              totalCost: refreshedTotalCost.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(estimateLineItems.id, lineItemId));

          updatedLineItem = { ...updatedLineItem, subcontractCost: totalAllocated.toFixed(2), totalCost: refreshedTotalCost.toFixed(2) };
        } else {
          const refreshedTotalCost = (
            Number(updates.materialCost || updatedLineItem.materialCost || 0) +
            Number(updates.laborCost || updatedLineItem.laborCost || 0) +
            Number(updates.equipmentCost || updatedLineItem.equipmentCost || 0) +
            Number(updates.consumablesCost || updatedLineItem.consumablesCost || 0) +
            0 +
            Number(updates.overheadAllocation || updatedLineItem.overheadAllocation || 0) +
            Number(updates.profitAllocation || updatedLineItem.profitAllocation || 0)
          );

          await db.update(estimateLineItems)
            .set({
              subcontractCost: "0",
              totalCost: refreshedTotalCost.toFixed(2),
              updatedAt: new Date(),
            })
            .where(eq(estimateLineItems.id, lineItemId));

          updatedLineItem = { ...updatedLineItem, subcontractCost: "0", totalCost: refreshedTotalCost.toFixed(2) };
        }
      }

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed to create snapshot after line item update:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      res.json(updatedLineItem);
    } catch (error) {
      logError("Error updating line item:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to update line item" });
    }
  });

  // Delete line item
  router.delete("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      await db.delete(estimateLineItems)
        .where(and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ));

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed to create snapshot after line item delete:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      successResponse(res);
    } catch (error) {
      logError("Error deleting line item:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to delete line item" });
    }
  });

  // Get subcontractor assignments for a line item
  router.get("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const { shouldFilter, orgId } = getOrgIdForFilter(req);

      if (!hasEstimateAccess(req.user!.role) && !hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });
      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (shouldFilter && orgId) {
        if (estimate.bidId) {
          const bid = await db.query.bids.findFirst({ where: eq(bids.id, estimate.bidId) });
          if (bid && bid.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        } else if (estimate.projectId) {
          const project = await db.query.projects.findFirst({ where: eq(projects.id, estimate.projectId) });
          if (project && project.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        }
      }

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ),
      });

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      const assignments = await db
        .select({
          id: estimateLineItemSubcontractors.id,
          lineItemId: estimateLineItemSubcontractors.lineItemId,
          subcontractorQuoteId: estimateLineItemSubcontractors.subcontractorQuoteId,
          allocatedCost: estimateLineItemSubcontractors.allocatedCost,
          isSelected: estimateLineItemSubcontractors.isSelected,
          notes: estimateLineItemSubcontractors.notes,
          createdAt: estimateLineItemSubcontractors.createdAt,
          updatedAt: estimateLineItemSubcontractors.updatedAt,
          subcontractorName: bidSubcontractorQuotes.subcontractorName,
          scopeOfWork: bidSubcontractorQuotes.scopeOfWork,
          quoteAmount: bidSubcontractorQuotes.quoteAmount,
          leadTime: bidSubcontractorQuotes.leadTime,
        })
        .from(estimateLineItemSubcontractors)
        .leftJoin(bidSubcontractorQuotes, eq(estimateLineItemSubcontractors.subcontractorQuoteId, bidSubcontractorQuotes.id))
        .where(eq(estimateLineItemSubcontractors.lineItemId, lineItemId));

      res.json(assignments);
    } catch (error) {
      logError("Error fetching subcontractor assignments:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch subcontractor assignments" });
    }
  });

  // Set subcontractor assignments for a line item (replaces all existing)
  router.post("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const { shouldFilter, orgId } = getOrgIdForFilter(req);
      const { assignments } = req.body as {
        assignments: Array<{
          subcontractorQuoteId: string;
          allocatedCost: string | number;
          isSelected?: boolean;
          notes?: string;
        }>;
      };

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });
      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (shouldFilter && orgId) {
        if (estimate.bidId) {
          const bid = await db.query.bids.findFirst({ where: eq(bids.id, estimate.bidId) });
          if (bid && bid.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        } else if (estimate.projectId) {
          const project = await db.query.projects.findFirst({ where: eq(projects.id, estimate.projectId) });
          if (project && project.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        }
      }

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ),
      });

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      await db.delete(estimateLineItemSubcontractors)
        .where(eq(estimateLineItemSubcontractors.lineItemId, lineItemId));

      let newAssignments: EstimateLineItemSubcontractor[] = [];
      let totalAllocated = 0;

      if (assignments && assignments.length > 0) {
        const values = assignments.map(a => ({
          lineItemId,
          subcontractorQuoteId: a.subcontractorQuoteId,
          allocatedCost: String(a.allocatedCost),
          isSelected: a.isSelected !== false,
          notes: a.notes || null,
        }));

        newAssignments = await db.insert(estimateLineItemSubcontractors).values(values).returning();

        totalAllocated = assignments
          .filter(a => a.isSelected !== false)
          .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);
      }

      const currentTotal = Number(lineItem.totalCost || 0);
      const oldSubCost = Number(lineItem.subcontractCost || 0);
      const newTotal = currentTotal - oldSubCost + totalAllocated;

      await db.update(estimateLineItems)
        .set({
          subcontractCost: totalAllocated.toFixed(2),
          totalCost: newTotal.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(estimateLineItems.id, lineItemId));

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed after subcontractor assignment:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      res.json(newAssignments);
    } catch (error) {
      logError("Error setting subcontractor assignments:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to set subcontractor assignments" });
    }
  });

  // Delete a single subcontractor assignment
  router.delete("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors/:assignmentId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId, assignmentId } = req.params;
      const { shouldFilter, orgId } = getOrgIdForFilter(req);

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });
      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (shouldFilter && orgId) {
        if (estimate.bidId) {
          const bid = await db.query.bids.findFirst({ where: eq(bids.id, estimate.bidId) });
          if (bid && bid.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        } else if (estimate.projectId) {
          const project = await db.query.projects.findFirst({ where: eq(projects.id, estimate.projectId) });
          if (project && project.gcOrganizationId !== orgId) {
            return res.status(403).json({ error: "Access denied" });
          }
        }
      }

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ),
      });

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      await db.delete(estimateLineItemSubcontractors)
        .where(and(
          eq(estimateLineItemSubcontractors.id, assignmentId),
          eq(estimateLineItemSubcontractors.lineItemId, lineItemId)
        ));

      const remaining = await db.select()
        .from(estimateLineItemSubcontractors)
        .where(eq(estimateLineItemSubcontractors.lineItemId, lineItemId));

      const totalAllocated = remaining
        .filter(a => a.isSelected)
        .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);

      const currentTotal = Number(lineItem.totalCost || 0);
      const oldSubCost = Number(lineItem.subcontractCost || 0);
      const newTotal = currentTotal - oldSubCost + totalAllocated;

      await db.update(estimateLineItems)
        .set({
          subcontractCost: totalAllocated.toFixed(2),
          totalCost: newTotal.toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(estimateLineItems.id, lineItemId));

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed after subcontractor removal:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      successResponse(res);
    } catch (error) {
      logError("Error deleting subcontractor assignment:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to delete subcontractor assignment" });
    }
  });

  // Get estimate version history
  router.get("/api/bids/:code/estimates/:estimateId/versions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code, estimateId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify the bid and estimate belong to the org
      const bid = await db.query.bids.findFirst({
        where: eq(bids.code, code),
      });
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const orgId = req.user!.organizationId;
      if (orgId && bid.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const estimate = await db.query.estimates.findFirst({
        where: and(eq(estimates.id, estimateId), eq(estimates.bidId, bid.id)),
      });
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const versions = await db
        .select()
        .from(estimateVersions)
        .where(eq(estimateVersions.estimateId, estimateId))
        .orderBy(desc(estimateVersions.versionNumber));

      const result = versions.map((v) => {
        const parsed = safeJsonParse<{ savedByUserId?: string; totalCost?: number; lineItemCount?: number }>(v.snapshot, {});
        return {
          id: v.id,
          versionNumber: v.versionNumber,
          createdAt: v.createdAt,
          savedByUserId: parsed?.savedByUserId,
          totalCost: parsed?.totalCost,
          lineItemCount: parsed?.lineItemCount,
        };
      });

      res.json(result);
    } catch (error) {
      logError("Error fetching estimate versions:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch estimate versions" });
    }
  });

  // Get a specific estimate version snapshot
  router.get("/api/bids/:code/estimates/:estimateId/versions/:versionId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code, estimateId, versionId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const bid = await db.query.bids.findFirst({ where: eq(bids.code, code) });
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const orgId = req.user!.organizationId;
      if (orgId && bid.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const estimate = await db.query.estimates.findFirst({
        where: and(eq(estimates.id, estimateId), eq(estimates.bidId, bid.id)),
      });
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const [version] = await db
        .select()
        .from(estimateVersions)
        .where(and(eq(estimateVersions.id, versionId), eq(estimateVersions.estimateId, estimateId)))
        .limit(1);
      if (!version) return res.status(404).json({ error: "Version not found" });

      const parsed = safeJsonParse(version.snapshot, {});
      res.json({ ...version, parsed });
    } catch (error) {
      logError("Error fetching estimate version:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to fetch estimate version" });
    }
  });

  // Approve estimate and sync to project budget, create procurement items and scope items
  router.post("/api/estimates/:estimateId/approve", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;
      const userId = req.user!.id;
      const { createProcurement = true, createScopeItems = true } = req.body;

      // Check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      if (estimate.status === "APPROVED") {
        return res.status(400).json({ error: "Estimate already approved" });
      }

      const APPROVABLE_STATUSES = ["DRAFT", "SUBMITTED", "PENDING_APPROVAL"]; // DRAFT included for fast-track approval of small estimates
      if (!APPROVABLE_STATUSES.includes(estimate.status)) {
        return res.status(422).json({
          error: `Cannot approve an estimate with status "${estimate.status}". Estimate must be in DRAFT, SUBMITTED, or PENDING_APPROVAL status.`,
        });
      }

      // Get line items
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimateId),
      });

      // Calculate total
      const total = lineItems.reduce((sum: number, item: EstimateLineItem) => sum + Number(item.totalCost), 0);

      // Update estimate status and base bid amount
      await db.update(estimates)
        .set({ 
          status: "APPROVED", 
          baseBidAmount: total.toString(),
          updatedAt: new Date(),
        })
        .where(eq(estimates.id, estimateId));

      // Update project budget (only if estimate is linked to a project)
      if (estimate.projectId) {
        await db.update(projects)
          .set({ 
            budget: total.toString(),
            updatedAt: new Date(),
          })
          .where(eq(projects.id, estimate.projectId));

        // Create procurement items from estimate line items with material costs
        let procurementItemsCreated = 0;
        if (createProcurement) {
          const materialLineItems = lineItems.filter(item => Number(item.materialCost) > 0);
          
          for (const item of materialLineItems) {
            await db.insert(procurementItems).values({
              projectId: estimate.projectId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitCost: (Number(item.materialCost) / Math.max(Number(item.quantity), 1)).toFixed(2),
              status: "PLANNED",
              neededByDate: null,
            });
            procurementItemsCreated++;
          }
        }

        // Create scope items from all estimate line items for tracking
        let scopeItemsCreated = 0;
        if (createScopeItems) {
          for (const item of lineItems) {
            // Check if scope item already exists for this estimate line item
            const existingScopeItem = await db.query.scopeItems.findFirst({
              where: eq(scopeItems.estimateLineItemId, item.id),
            });

            if (!existingScopeItem) {
              await db.insert(scopeItems).values({
                projectId: estimate.projectId,
                estimateLineItemId: item.id,
                description: item.description,
                unit: item.unit,
                totalQuantity: item.quantity,
                completedQuantity: "0",
                billedQuantity: "0",
                unitPrice: (Number(item.totalCost) / Math.max(Number(item.quantity), 1)).toFixed(2),
                billingStatus: "NOT_READY",
                estimatedConcreteYards: item.calculatedConcreteYards,
                estimatedStoneTons: item.calculatedStoneTons,
                estimatedExcavationYards: item.calculatedExcavationYards,
              });
              scopeItemsCreated++;
            }
          }
        }

        console.log(`[Estimate Approval] Created ${procurementItemsCreated} procurement items and ${scopeItemsCreated} scope items for project ${estimate.projectId}`);
        
        res.json({ 
          success: true, 
          total, 
          estimateId, 
          projectId: estimate.projectId,
          procurementItemsCreated,
          scopeItemsCreated,
        });
      } else {
        successResponse(res, { total, estimateId, projectId: null });
      }
    } catch (error) {
      logError("Error approving estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to approve estimate" });
    }
  });

  // AI CFO estimate analysis
  router.post("/api/estimates/:estimateId/analyze", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate and project data
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      // Get project data (only for project estimates, not bid estimates)
      let project = null;
      if (estimate.projectId) {
        project = await db.query.projects.findFirst({
          where: eq(projects.id, estimate.projectId),
        });

        if (!project) {
          return res.status(404).json({ error: "Project not found" });
        }
      }

      // Get line items
      const lineItems = await db.query.estimateLineItems.findMany({
        where: eq(estimateLineItems.estimateId, estimateId),
      });

      // Get actual labor costs for comparison (only for project estimates, not bid estimates)
      let actualLabor = { total_hours: '0', total_labor_cost: '0' };
      if (project) {
        const actualLaborQuery = await db.execute(sql`
          SELECT 
            COALESCE(SUM(CAST(hours_worked AS NUMERIC)), 0) as total_hours,
            COALESCE(SUM(CAST(labor_cost AS NUMERIC)), 0) as total_labor_cost
          FROM time_clock_entries
          WHERE project_id = ${project.id}
            AND approval_status = 'APPROVED'
        `);
        actualLabor = actualLaborQuery.rows[0] as { total_hours: string, total_labor_cost: string };
      }

      // Prepare data for AI analysis
      const estimateSummary = lineItems.reduce((acc: {
        totalCost: number;
        materialCost: number;
        laborCost: number;
        laborHours: number;
        equipmentCost: number;
        subcontractCost: number;
        overhead: number;
        profit: number;
      }, item: EstimateLineItem) => ({
        totalCost: acc.totalCost + Number(item.totalCost),
        materialCost: acc.materialCost + Number(item.materialCost),
        laborCost: acc.laborCost + Number(item.laborCost),
        laborHours: acc.laborHours + Number(item.laborHours),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost),
        overhead: acc.overhead + Number(item.overheadAllocation),
        profit: acc.profit + Number(item.profitAllocation),
      }), {
        totalCost: 0,
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        subcontractCost: 0,
        overhead: 0,
        profit: 0,
      });

      const categoryBreakdown = lineItems.reduce((acc: Record<string, { count: number, totalCost: number, laborCost: number, materialCost: number }>, item: EstimateLineItem) => {
        const cat = item.category;
        if (!acc[cat]) {
          acc[cat] = { count: 0, totalCost: 0, laborCost: 0, materialCost: 0 };
        }
        acc[cat].count++;
        acc[cat].totalCost += Number(item.totalCost);
        acc[cat].laborCost += Number(item.laborCost);
        acc[cat].materialCost += Number(item.materialCost);
        return acc;
      }, {} as Record<string, { count: number, totalCost: number, laborCost: number, materialCost: number }>);

      const govOrgId = req.user!.organizationId || "system";
      const { result: analysisText, blocked, reason } = await governedAiCall({
        orgId: govOrgId,
        userId: req.user!.id,
        actionType: "estimate_analyze",
        inputRefs: { estimateId },
        fn: async () => {
          const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              {
                role: "system",
                content: `You are an AI CFO analyzing a construction project estimate. Provide:
1. Budget Health Assessment (Low/Medium/High risk)
2. Key Insights (3-5 bullet points)
3. Cost Distribution Analysis
4. Profitability Analysis
5. Recommendations (3-5 actionable items)

Format as JSON with keys: riskLevel, insights (array), costAnalysis (string), profitabilityAnalysis (string), recommendations (array).`
              },
              {
                role: "user",
                content: `Analyze this estimate:

${project ? `Project: ${project.name} (${project.status})
Contract Amount: $${project.contractAmount || 'Not set'}` : 'Bid Estimate (not yet converted to project)'}


ESTIMATE SUMMARY:
- Total Estimated Cost: $${estimateSummary.totalCost.toFixed(2)}
- Material Cost: $${estimateSummary.materialCost.toFixed(2)} (${((estimateSummary.materialCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Labor Cost: $${estimateSummary.laborCost.toFixed(2)} (${((estimateSummary.laborCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Labor Hours: ${estimateSummary.laborHours.toFixed(1)} hrs
- Equipment Cost: $${estimateSummary.equipmentCost.toFixed(2)} (${((estimateSummary.equipmentCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Subcontract Cost: $${estimateSummary.subcontractCost.toFixed(2)} (${((estimateSummary.subcontractCost / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Overhead: $${estimateSummary.overhead.toFixed(2)} (${((estimateSummary.overhead / estimateSummary.totalCost) * 100).toFixed(1)}%)
- Profit: $${estimateSummary.profit.toFixed(2)} (${((estimateSummary.profit / estimateSummary.totalCost) * 100).toFixed(1)}%)

CATEGORY BREAKDOWN:
${Object.entries(categoryBreakdown).map(([cat, breakdown]) => 
  `- ${cat}: ${breakdown.count} items, $${breakdown.totalCost.toFixed(2)} total`
).join('\n')}

ACTUAL COSTS (if available):
- Actual Labor Hours: ${Number(actualLabor.total_hours).toFixed(1)} hrs
- Actual Labor Cost: $${Number(actualLabor.total_labor_cost).toFixed(2)}
${Number(actualLabor.total_hours) > 0 ? `- Labor Variance: ${((Number(actualLabor.total_labor_cost) - estimateSummary.laborCost) / estimateSummary.laborCost * 100).toFixed(1)}%` : ''}

Provide comprehensive financial analysis and recommendations.`
              }
            ],
            temperature: 0.7,
            max_tokens: 1500,
          });
          return {
            result: completion.choices[0]?.message?.content,
            completion,
          };
        },
      });

      if (blocked) {
        return res.status(429).json({ error: reason || "AI usage limit reached" });
      }

      if (!analysisText) {
        throw new Error("No analysis generated");
      }

      // Parse JSON response
      const analysis = JSON.parse(analysisText) as {
        riskLevel: string;
        insights: string[];
        costAnalysis: string;
        profitabilityAnalysis: string;
        recommendations: string[];
      };

      res.json({
        ...analysis,
        estimateSummary,
        actualLabor: {
          hours: Number(actualLabor.total_hours),
          cost: Number(actualLabor.total_labor_cost),
        },
        categoryBreakdown,
      });
    } catch (error) {
      logError("Error analyzing estimate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to analyze estimate" });
    }
  });

  router.get("/api/estimates/production-rates/suggestions", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !hasManagementAccess(req.user!.role)) {
        return res.status(404).json({ error: "Not found" });
      }

      const rawRequestedOrgId = req.query.organizationId;
      const requestedOrgId = typeof rawRequestedOrgId === 'string' && rawRequestedOrgId.trim().length > 0 
        ? rawRequestedOrgId.trim() 
        : null;
      let targetOrgId: string | null = null;

      if (isSuperAdmin) {
        if (!requestedOrgId) {
          return res.status(404).json({ error: "Not found" });
        }
        const orgExists = await db.query.organizations.findFirst({
          where: eq(organizations.id, requestedOrgId),
        });
        if (!orgExists) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = requestedOrgId;
      } else {
        if (!orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        if (requestedOrgId && requestedOrgId !== orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = orgId;
      }

      const { searchTerm, unit, limit } = req.query;
      
      const suggestions = await getProductionRateSuggestions(
        targetOrgId,
        searchTerm as string | undefined,
        unit as string | undefined,
        limit ? parseInt(limit as string) : 10
      );

      res.json({ rates: suggestions });
    } catch (error) {
      if (error instanceof OrganizationRequiredError) {
        return res.status(404).json({ error: "Not found" });
      }
      logError("Error fetching production rate suggestions:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(404).json({ error: "Not found" });
    }
  });

  router.get("/api/estimates/production-rates/lookup", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !hasManagementAccess(req.user!.role)) {
        return res.status(404).json({ error: "Not found" });
      }

      const rawRequestedOrgId = req.query.organizationId;
      const requestedOrgId = typeof rawRequestedOrgId === 'string' && rawRequestedOrgId.trim().length > 0 
        ? rawRequestedOrgId.trim() 
        : null;
      let targetOrgId: string | null = null;

      if (isSuperAdmin) {
        if (!requestedOrgId) {
          return res.status(404).json({ error: "Not found" });
        }
        const orgExists = await db.query.organizations.findFirst({
          where: eq(organizations.id, requestedOrgId),
        });
        if (!orgExists) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = requestedOrgId;
      } else {
        if (!orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        if (requestedOrgId && requestedOrgId !== orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = orgId;
      }

      const { description, unit } = req.query;
      
      if (!description || !unit) {
        return res.status(404).json({ error: "Not found" });
      }

      const rate = await getProductionRateForSOW(
        description as string,
        unit as string,
        targetOrgId
      );

      res.json({ rate });
    } catch (error) {
      if (error instanceof OrganizationRequiredError) {
        return res.status(404).json({ error: "Not found" });
      }
      logError("Error looking up production rate:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(404).json({ error: "Not found" });
    }
  });

  // Unified SOW Tracking: Get production rate by organizationSowItemId
  // This provides more reliable historical data than description-based matching
  router.get("/api/estimates/production-rates/by-sow-item/:sowItemId", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !hasManagementAccess(req.user!.role)) {
        return res.status(404).json({ error: "Not found" });
      }

      const { sowItemId } = req.params;
      
      if (!sowItemId) {
        return res.status(400).json({ error: "SOW item ID is required" });
      }

      const rawRequestedOrgId = req.query.organizationId;
      const requestedOrgId = typeof rawRequestedOrgId === 'string' && rawRequestedOrgId.trim().length > 0 
        ? rawRequestedOrgId.trim() 
        : null;
      let targetOrgId: string | null = null;

      if (isSuperAdmin) {
        if (!requestedOrgId) {
          return res.status(404).json({ error: "Not found" });
        }
        // Verify organization exists
        const orgExists = await db.query.organizations.findFirst({
          where: eq(organizations.id, requestedOrgId),
        });
        if (!orgExists) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = requestedOrgId;
      } else {
        if (!orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        if (requestedOrgId && requestedOrgId !== orgId) {
          return res.status(404).json({ error: "Not found" });
        }
        targetOrgId = orgId;
      }

      const rate = await getProductionRateBySowItemId(
        sowItemId,
        targetOrgId
      );

      if (!rate) {
        return res.json({ 
          rate: null, 
          message: "No historical production data found for this scope item" 
        });
      }

      res.json({ 
        rate,
        message: `Based on ${rate.totalDays} days of data across ${rate.totalProjects} projects`
      });
    } catch (error) {
      if (error instanceof OrganizationRequiredError) {
        return res.status(404).json({ error: "Not found" });
      }
      logError("Error looking up production rate by SOW item:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to lookup production rate" });
    }
  });

  router.post("/api/estimates/:estimateId/line-items/auto-populate-labor", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId } = req.params;
      const { lineItemId, applyRate } = req.body;

      const { shouldFilter, orgId, mustDenyAccess, isSuperAdmin } = getOrgIdForFilter(req);
      
      if (mustDenyAccess || !hasEstimateAccess(req.user!.role)) {
        return res.status(404).json({ error: "Not found" });
      }

      if (!isSuperAdmin && !orgId) {
        return res.status(404).json({ error: "Not found" });
      }

      const estimateQuery = shouldFilter 
        ? db
            .select({
              estimateId: estimates.id,
              projectId: estimates.projectId,
              projectOrgId: projects.gcOrganizationId,
            })
            .from(estimates)
            .leftJoin(projects, eq(estimates.projectId, projects.id))
            .where(and(
              eq(estimates.id, estimateId),
              eq(projects.gcOrganizationId, orgId!)
            ))
            .limit(1)
        : db
            .select({
              estimateId: estimates.id,
              projectId: estimates.projectId,
              projectOrgId: projects.gcOrganizationId,
            })
            .from(estimates)
            .leftJoin(projects, eq(estimates.projectId, projects.id))
            .where(eq(estimates.id, estimateId))
            .limit(1);

      const estimateWithProject = await estimateQuery;

      if (estimateWithProject.length === 0) {
        return res.status(404).json({ error: "Not found" });
      }

      const { projectOrgId } = estimateWithProject[0];
      
      if (!projectOrgId) {
        return res.status(404).json({ error: "Not found" });
      }

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ),
      });

      if (!lineItem) {
        return res.status(404).json({ error: "Not found" });
      }

      const laborEstimate = await estimateLaborHoursFromProductionRate(
        lineItem.description || '',
        lineItem.unit || '',
        Number(lineItem.quantity) || 0,
        projectOrgId
      );

      if (laborEstimate.confidence === 'NONE') {
        return res.json({
          success: false,
          message: "No production rate data available for this scope of work",
        });
      }

      if (applyRate) {
        const [updatedLineItem] = await db.transaction(async (tx) => {
          return await tx.update(estimateLineItems)
            .set({
              laborHours: laborEstimate.suggestedLaborHours.toString(),
              updatedAt: new Date(),
            })
            .where(and(
              eq(estimateLineItems.id, lineItemId),
              eq(estimateLineItems.estimateId, estimateId)
            ))
            .returning();
        });

        if (!updatedLineItem) {
          return res.status(404).json({ error: "Not found" });
        }

        try {
          await createEstimateSnapshot(estimateId, req.user!.id);
        } catch (snapshotErr) {
          logError("[Snapshot] Failed to create snapshot after auto-populate-labor:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
        }

        return res.json({
          success: true,
          message: `Applied ${laborEstimate.suggestedLaborHours} labor hours based on production rate data`,
          laborEstimate,
          updatedLineItem,
        });
      }

      res.json({
        success: true,
        message: "Labor estimate calculated successfully",
        laborEstimate,
        suggestedLaborHours: laborEstimate.suggestedLaborHours,
      });
    } catch (error) {
      if (error instanceof OrganizationRequiredError) {
        return res.status(404).json({ error: "Not found" });
      }
      logError("Error auto-populating labor hours:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(404).json({ error: "Not found" });
    }
  });

  // Sync material calculator results to estimate line item
  router.post("/api/estimates/:estimateId/line-items/:lineItemId/sync-materials", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { estimateId, lineItemId } = req.params;
      
      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Safe numeric parsing helper
      const safeNumber = (val: unknown): number | undefined => {
        if (val === undefined || val === null || val === '') return undefined;
        const num = Number(val);
        if (isNaN(num) || !isFinite(num) || num < 0) return undefined;
        return num;
      };

      const concreteYards = safeNumber(req.body.concreteYards);
      const stoneTons = safeNumber(req.body.stoneTons);
      const excavationYards = safeNumber(req.body.excavationYards);
      const wireMeshSqFt = safeNumber(req.body.wireMeshSqFt);
      const rebarPounds = safeNumber(req.body.rebarPounds);
      const dowelCount = safeNumber(req.body.dowelCount);
      const sealerGallons = safeNumber(req.body.sealerGallons);
      const underlaymentSqFt = safeNumber(req.body.underlaymentSqFt);
      const totalMaterialCost = safeNumber(req.body.totalMaterialCost);

      // Verify estimate exists
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      // Verify line item exists
      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ),
      });

      if (!lineItem) {
        return res.status(404).json({ error: "Line item not found" });
      }

      // Update line item with material calculations
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (concreteYards !== undefined) updateData.calculatedConcreteYards = concreteYards.toString();
      if (stoneTons !== undefined) updateData.calculatedStoneTons = stoneTons.toString();
      if (excavationYards !== undefined) updateData.calculatedExcavationYards = excavationYards.toString();
      if (wireMeshSqFt !== undefined) updateData.calculatedWireMeshSqFt = wireMeshSqFt.toString();
      if (rebarPounds !== undefined) updateData.calculatedRebarPounds = rebarPounds.toString();
      if (dowelCount !== undefined) updateData.calculatedDowelCount = dowelCount.toString();
      if (sealerGallons !== undefined) updateData.calculatedSealerGallons = sealerGallons.toString();
      if (underlaymentSqFt !== undefined) updateData.calculatedUnderlaymentSqFt = underlaymentSqFt.toString();
      if (totalMaterialCost !== undefined) updateData.materialCost = totalMaterialCost.toString();

      const [updatedLineItem] = await db.update(estimateLineItems)
        .set(updateData)
        .where(and(
          eq(estimateLineItems.id, lineItemId),
          eq(estimateLineItems.estimateId, estimateId)
        ))
        .returning();

      console.log(`[MaterialSync] Synced material data for line item ${lineItemId}`);

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed to create snapshot after sync-materials:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      res.json({
        success: true,
        message: "Material calculations synced successfully",
        lineItem: updatedLineItem,
      });
    } catch (error) {
      logError("Error syncing material calculations:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to sync material calculations" });
    }
  });

router.get("/api/historical-costs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthorized" });
    if (!hasManagementAccess(req.user!.role) && !hasEstimateAccess(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const { historicalCosts } = await import("@shared/schema");
    const { ilike, gte, lte } = await import("drizzle-orm");

    const conditions: any[] = [eq(historicalCosts.organizationId, orgId)];
    const { search, trade, costCode, scopeCategory, startDate, endDate, projectType } = req.query;

    if (search) conditions.push(ilike(historicalCosts.description, `%${search}%`));
    if (trade) conditions.push(eq(historicalCosts.trade, trade as string));
    if (costCode) conditions.push(eq(historicalCosts.costCode, costCode as string));
    if (scopeCategory) conditions.push(eq(historicalCosts.scopeCategory, scopeCategory as string));
    if (projectType) conditions.push(eq(historicalCosts.projectType, projectType as string));
    if (startDate) conditions.push(gte(historicalCosts.completedDate, startDate as string));
    if (endDate) conditions.push(lte(historicalCosts.completedDate, endDate as string));

    const results = await db.select().from(historicalCosts)
      .where(and(...conditions))
      .orderBy(desc(historicalCosts.createdAt))
      .limit(500);

    res.json(results);
  } catch (error) {
    logError("Historical costs fetch error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch historical costs" });
  }
});

router.get("/api/historical-costs/aggregated", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthorized" });
    if (!hasManagementAccess(req.user!.role) && !hasEstimateAccess(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const { historicalCosts } = await import("@shared/schema");
    const { ilike, gte, lte } = await import("drizzle-orm");

    const conditions: any[] = [eq(historicalCosts.organizationId, orgId)];
    const { trade, costCode, scopeCategory, startDate, endDate, projectType } = req.query;

    if (trade) conditions.push(eq(historicalCosts.trade, trade as string));
    if (costCode) conditions.push(eq(historicalCosts.costCode, costCode as string));
    if (scopeCategory) conditions.push(eq(historicalCosts.scopeCategory, scopeCategory as string));
    if (projectType) conditions.push(eq(historicalCosts.projectType, projectType as string));
    if (startDate) conditions.push(gte(historicalCosts.completedDate, startDate as string));
    if (endDate) conditions.push(lte(historicalCosts.completedDate, endDate as string));

    const aggregated = await db.select({
      scopeCategory: historicalCosts.scopeCategory,
      trade: historicalCosts.trade,
      unit: historicalCosts.unit,
      costCode: historicalCosts.costCode,
      recordCount: sql<number>`count(*)::int`,
      avgUnitCost: sql<string>`round(avg(${historicalCosts.unitCost}::numeric), 4)::text`,
      minUnitCost: sql<string>`round(min(${historicalCosts.unitCost}::numeric), 4)::text`,
      maxUnitCost: sql<string>`round(max(${historicalCosts.unitCost}::numeric), 4)::text`,
      totalQuantity: sql<string>`round(sum(${historicalCosts.quantity}::numeric), 2)::text`,
      totalCost: sql<string>`round(sum(${historicalCosts.totalCost}::numeric), 2)::text`,
      latestDate: sql<string>`max(${historicalCosts.completedDate})`,
      earliestDate: sql<string>`min(${historicalCosts.completedDate})`,
    })
      .from(historicalCosts)
      .where(and(...conditions))
      .groupBy(historicalCosts.scopeCategory, historicalCosts.trade, historicalCosts.unit, historicalCosts.costCode);

    const trades = await db.selectDistinct({ trade: historicalCosts.trade })
      .from(historicalCosts)
      .where(eq(historicalCosts.organizationId, orgId));

    const scopeCategories = await db.selectDistinct({ scopeCategory: historicalCosts.scopeCategory })
      .from(historicalCosts)
      .where(eq(historicalCosts.organizationId, orgId));

    const costCodes = await db.selectDistinct({ costCode: historicalCosts.costCode })
      .from(historicalCosts)
      .where(and(eq(historicalCosts.organizationId, orgId), sql`${historicalCosts.costCode} IS NOT NULL`));

    res.json({
      aggregated,
      filters: {
        trades: trades.map(t => t.trade).filter(Boolean),
        scopeCategories: scopeCategories.map(s => s.scopeCategory).filter(Boolean),
        costCodes: costCodes.map(c => c.costCode).filter(Boolean),
      },
    });
  } catch (error) {
    logError("Historical costs aggregation error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to aggregate historical costs" });
  }
});

router.post("/api/historical-costs", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthorized" });
    if (!hasManagementAccess(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const { historicalCosts, insertHistoricalCostSchema } = await import("@shared/schema");
    const body = { ...req.body, organizationId: orgId };
    const decimalFields = ["quantity", "unitCost", "totalCost", "materialCost", "laborCost", "equipmentCost", "subcontractCost"] as const;
    for (const f of decimalFields) {
      if (body[f] !== undefined && body[f] !== null) body[f] = String(body[f]);
    }
    const data = insertHistoricalCostSchema.parse(body);
    const [result] = await db.insert(historicalCosts).values(data).returning();
    res.json(result);
  } catch (error) {
    logError("Historical cost create error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create historical cost record" });
  }
});

router.delete("/api/historical-costs/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthorized" });
    if (!hasManagementAccess(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const { historicalCosts } = await import("@shared/schema");
    await db.delete(historicalCosts)
      .where(and(eq(historicalCosts.id, req.params.id), eq(historicalCosts.organizationId, orgId)));
    successResponse(res);
  } catch (error) {
    logError("Historical cost delete error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete historical cost record" });
  }
});

router.post("/api/estimates/:estimateId/insert-assembly", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { estimateId } = req.params;
    const { assemblyId, quantity: baseQuantity } = req.body;

    if (!assemblyId) return res.status(400).json({ error: "assemblyId is required" });

    const [estimate] = await db.select().from(estimates).where(eq(estimates.id, estimateId));
    if (!estimate) return res.status(404).json({ error: "Estimate not found" });

    if (!hasEstimateAccess(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { bids } = await import("@shared/schema");
    const [bid] = await db.select().from(bids).where(eq(bids.id, estimate.bidId));
    if (!bid || bid.gcOrganizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { libraryAssemblies, libraryAssemblyItems } = await import("@shared/schema");

    const [assembly] = await db.select().from(libraryAssemblies)
      .where(and(eq(libraryAssemblies.id, assemblyId), eq(libraryAssemblies.organizationId, req.user!.organizationId)));
    if (!assembly) return res.status(404).json({ error: "Assembly not found" });

    const items = await db.select().from(libraryAssemblyItems)
      .where(eq(libraryAssemblyItems.assemblyId, assemblyId))
      .orderBy(libraryAssemblyItems.displayOrder);

    if (items.length === 0) return res.status(400).json({ error: "Assembly has no items" });

    const qty = baseQuantity || 1;
    const createdLineItems: any[] = [];

    for (const item of items) {
      let computedQty = qty;
      try {
        const formula = (item.formula || "1").replace(/quantity/gi, String(qty))
          .replace(/area/gi, String(qty))
          .replace(/volume/gi, String(qty))
          .replace(/perimeter/gi, String(qty * 4))
          .replace(/ridge_length/gi, String(qty * 0.3));
        if (!/^[\d\s+\-*/().]+$/.test(formula)) {
          computedQty = qty;
        } else {
          computedQty = Function(`"use strict"; return (${formula})`)();
        }
        if (isNaN(computedQty) || !isFinite(computedQty)) computedQty = qty;
      } catch {
        logWarn("Non-critical operation failed");
        computedQty = qty;
      }

      const wasteFactor = item.wasteFactor || 0;
      const adjustedQty = computedQty * (1 + wasteFactor / 100);
      const unitCost = Number(item.unitCost || 0);
      const totalMaterialCost = adjustedQty * unitCost;

      const [lineItem] = await db.insert(estimateLineItems).values({
        estimateId,
        category: "GENERAL",
        description: `${item.name} (from ${assembly.name})`,
        quantity: String(Math.round(adjustedQty * 100) / 100),
        unit: item.unit || assembly.unitOfMeasure || "EA",
        source: "ASSEMBLY",
        materialCost: String(Math.round(totalMaterialCost * 100) / 100),
        laborCost: "0",
        laborHours: "0",
        equipmentCost: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
        totalCost: String(Math.round(totalMaterialCost * 100) / 100),
        metadata: JSON.stringify({
          assemblyId: assembly.id,
          assemblyName: assembly.name,
          originalFormula: item.formula,
          wasteFactor: wasteFactor,
          baseQuantity: qty,
        }),
      }).returning();

      createdLineItems.push(lineItem);
    }

    try {
      await createEstimateSnapshot(estimateId, req.user!.id);
    } catch (snapshotErr) {
      logError("[Snapshot] Failed after assembly insertion:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
    }

    res.json({
      success: true,
      assemblyName: assembly.name,
      lineItemsCreated: createdLineItems.length,
      lineItems: createdLineItems,
    });
  } catch (error) {
    logError("Assembly insertion error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to insert assembly into estimate" });
  }
});

export default router;
