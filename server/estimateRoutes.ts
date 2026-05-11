// prompt-injection-guard: estimate generation operates on tenant-internal validated takeoff line items; no third-party free-text in the user message
import { logError, logWarn, logInfo } from "./utils/logger";
import { Router } from "express";
import multer from "multer";
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
  takeoffAssemblies,
  takeoffAssemblyItems,
  takeoffMeasurementAssemblies,
  insertEstimateSchema,
  insertEstimateLineItemSchema,
  updateEstimateLineItemSchema,
  organizations,
  procurementItems,
  scopeItems,
  jobClassifications,
  bidSubcontractorQuotes,
  vendorPricingCatalogs,
  type EstimateLineItem,
  type EstimateLineItemSubcontractor,
} from "@shared/schema";
import { computeAssemblyQuantity, type FormulaContext } from "@shared/utils/assemblyFormula";
import { computeNetAreaInFt2 } from "@shared/utils/geometry";
import {
  applyOrgFactors,
  normalizeFactors,
  DEFAULT_ESTIMATING_FACTORS,
} from "./services/aiEstimator/orgFactorsApply";
import { getOrgFactors as getOrgFactorsForEstimate } from "./services/aiEstimator/orgFactors";

// Task #2576 — Resolve the effective EstimatingFactors bag for an
// estimate (per-estimate override wins; otherwise org default). Used
// by every GET that returns roll-up totals so the bid/project/totals
// endpoints all agree on a single number.
async function resolveAppliedFactors(
  estimateOrgId: string,
  perEstimateOverride: unknown,
): Promise<ReturnType<typeof normalizeFactors>> {
  if (perEstimateOverride && typeof perEstimateOverride === "object") {
    return normalizeFactors(perEstimateOverride as Record<string, unknown>);
  }
  try {
    const row = await getOrgFactorsForEstimate(estimateOrgId);
    return normalizeFactors({
      laborBurdenPercent: row.laborBurdenPercent,
      smallToolsPercent: row.smallToolsPercent,
      overheadPercent: row.overheadPercent,
      profitPercent: row.profitPercent,
      bondPercent: row.bondPercent,
      escalationPercent: row.escalationPercent,
      wasteFactorPercent: row.defaultWasteFactor,
    });
  } catch {
    return { ...DEFAULT_ESTIMATING_FACTORS };
  }
}
import { eq, and, desc, sql, or, isNull, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { openai } from "./ai/openaiClient";
import { routedChatCompletion } from "./ai/providers";
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

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = temp;
    }
  }
  return dp[n];
}

function normalizedSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function tokenOverlapScore(a: string, b: string): number {
  const tokensA = new Set(a.split(/[\s\-_\/,]+/).filter(t => t.length > 1));
  const tokensB = new Set(b.split(/[\s\-_\/,]+/).filter(t => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

export async function matchVendorPricing(lineItems: EstimateLineItem[], organizationId: string): Promise<void> {
  try {
    const catalogItems = await db
      .select({
        id: vendorPricingCatalogs.id,
        itemName: vendorPricingCatalogs.itemName,
        itemCode: vendorPricingCatalogs.itemCode,
        category: vendorPricingCatalogs.category,
        unit: vendorPricingCatalogs.unit,
        unitPrice: vendorPricingCatalogs.unitPrice,
      })
      .from(vendorPricingCatalogs)
      .where(eq(vendorPricingCatalogs.organizationId, organizationId));

    if (catalogItems.length === 0) return;

    const updates: { id: string; vendorPricingId: string | null; vendorMatchConfidence: string; unitPrice: number | null; quantity: number; laborCost: number; equipmentCost: number; consumablesCost: number; subcontractCost: number }[] = [];

    for (const li of lineItems) {
      const desc = (li.description || "").toLowerCase().trim();
      const liUnit = (li.unit || "").toLowerCase().trim();
      const liCategory = (li.category || "").toLowerCase().trim();
      let bestMatch: { id: string; confidence: string; unitPrice: number; score: number } | null = null;

      for (const cat of catalogItems) {
        const catName = (cat.itemName || "").toLowerCase().trim();
        const catCode = (cat.itemCode || "").toLowerCase().trim();
        const catUnit = (cat.unit || "").toLowerCase().trim();
        const catCategory = (cat.category || "").toLowerCase().trim();
        const catPrice = Number(cat.unitPrice) || 0;

        if (catCode && desc === catCode) {
          bestMatch = { id: cat.id, confidence: "EXACT", unitPrice: catPrice, score: 1 };
          break;
        }
        if (desc === catName) {
          const unitBonus = liUnit === catUnit ? 0.05 : 0;
          bestMatch = { id: cat.id, confidence: "EXACT", unitPrice: catPrice, score: 1 + unitBonus };
          break;
        }

        const stringSim = normalizedSimilarity(desc, catName);
        const tokenSim = tokenOverlapScore(desc, catName);
        let combinedScore = stringSim * 0.6 + tokenSim * 0.4;

        if (liUnit && catUnit && liUnit === catUnit) combinedScore += 0.1;
        if (liCategory && catCategory && (liCategory === catCategory || normalizedSimilarity(liCategory, catCategory) > 0.8)) {
          combinedScore += 0.1;
        }

        if (combinedScore >= 0.85) {
          if (!bestMatch || combinedScore > bestMatch.score) {
            bestMatch = { id: cat.id, confidence: "HIGH", unitPrice: catPrice, score: combinedScore };
          }
        } else if (combinedScore >= 0.6) {
          if (!bestMatch || (bestMatch.confidence !== "EXACT" && bestMatch.confidence !== "HIGH" && combinedScore > bestMatch.score)) {
            bestMatch = { id: cat.id, confidence: "FUZZY", unitPrice: catPrice, score: combinedScore };
          }
        } else if (combinedScore >= 0.4) {
          if (!bestMatch || (bestMatch.confidence === "NO_MATCH" || (bestMatch.confidence === "LOW" && combinedScore > bestMatch.score))) {
            bestMatch = { id: cat.id, confidence: "LOW", unitPrice: catPrice, score: combinedScore };
          }
        }
      }

      updates.push({
        id: li.id,
        vendorPricingId: bestMatch?.id || null,
        vendorMatchConfidence: bestMatch?.confidence || "NO_MATCH",
        unitPrice: bestMatch?.unitPrice ?? null,
        quantity: Number(li.quantity) || 0,
        laborCost: Number(li.laborCost) || 0,
        equipmentCost: Number(li.equipmentCost) || 0,
        consumablesCost: Number(li.consumablesCost) || 0,
        subcontractCost: Number(li.subcontractCost) || 0,
      });
    }

    const batchSize = 50;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await Promise.all(batch.map(u => {
        const hasVendorPrice = u.vendorPricingId !== null && u.unitPrice !== null && u.unitPrice > 0;
        const setFields: Record<string, any> = {
          vendorPricingId: u.vendorPricingId,
          vendorMatchConfidence: u.vendorMatchConfidence,
        };
        if (hasVendorPrice) {
          const materialCost = parseFloat((u.unitPrice! * u.quantity).toFixed(2));
          const totalCost = parseFloat((materialCost + u.laborCost + u.equipmentCost + u.consumablesCost + u.subcontractCost).toFixed(2));
          setFields.materialCost = materialCost.toFixed(2);
          setFields.totalCost = totalCost.toFixed(2);
        }
        return db.update(estimateLineItems)
          .set(setFields)
          .where(eq(estimateLineItems.id, u.id));
      }));
    }
  } catch (err) {
    logError("[VendorMatch] Error matching vendor pricing:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

// Helper to check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
function hasEstimateAccess(role: string): boolean {
  return ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"].includes(role);
}

// Helper to check if user has general management access (includes SUPERINTENDENT for read-only)
function hasManagementAccess(role: string): boolean {
  return ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"].includes(role);
}

// Create a snapshot of current estimate line items and store in estimate_versions
// Throws on failure so callers can handle or log appropriately
export async function createEstimateSnapshot(estimateId: string, savedByUserId: string): Promise<void> {
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
const VALID_CATEGORIES = [
  "CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL",
  "PLUMBING", "HVAC", "ROOFING", "STRUCTURAL_STEEL", "MASONRY", "DRYWALL", "PAINTING",
  "FLOORING", "FIRE_PROTECTION", "DEMOLITION", "CARPENTRY", "INSULATION", "WINDOWS_DOORS",
  "ELEVATOR", "GRADING", "PAVING", "SITEWORK", "WATERPROOFING", "MECHANICAL", "FRAMING",
  "STRIPING", "SIGNAGE", "LANDSCAPING", "ELECTRICAL", "OTHER",
  "METALS", "FINISHES",
];
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

// Re-exported shared validator — kept here for callers that still import from this module.
import { validateDotPayItemLink as _validateDotPayItemLink } from "./utils/dotPayItemValidation";
import { parseOrRespond } from "./utils/validation";
const validateDotPayItemLink = _validateDotPayItemLink;

export function normalizeLineItemData(data: any): any {
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

// ---------------------------------------------------------------------------
// Cross-tenant ownership helpers.
//
// The `estimates` table has NO `organizationId` column. The owning
// organization is derived from the parent project (`projects.gcOrganizationId`)
// or parent bid (`bids.gcOrganizationId`). Every endpoint that loads an
// estimate by id MUST verify ownership through one of these helpers, otherwise
// any authenticated user could read or mutate another tenant's estimate.
// SUPER_ADMIN callers (no `organizationId` on the user record) bypass the
// org check intentionally.
// ---------------------------------------------------------------------------
export const verifyEstimateOrgAccess = async (estimateId: string, user: AuthRequest["user"]) => {
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });
  if (!estimate) return null;
  if (user!.organizationId) {
    const bid = estimate.bidId ? await db.query.bids.findFirst({ where: eq(bids.id, estimate.bidId) }) : null;
    const project = estimate.projectId ? await db.query.projects.findFirst({ where: eq(projects.id, estimate.projectId) }) : null;
    const ownerOrgId = bid?.gcOrganizationId || project?.gcOrganizationId;
    if (ownerOrgId && ownerOrgId !== user!.organizationId) return null;
    // If neither bid nor project exists, deny by default (orphan estimate).
    if (!ownerOrgId) return null;
  }
  return estimate;
};

const verifyProjectOrgAccess = async (projectId: string, user: AuthRequest["user"]) => {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) return null;
  if (user!.organizationId && project.gcOrganizationId !== user!.organizationId) return null;
  return project;
};

const verifyBidOrgAccess = async (bidId: string, user: AuthRequest["user"]) => {
  const bid = await db.query.bids.findFirst({ where: eq(bids.id, bidId) });
  if (!bid) return null;
  if (user!.organizationId && bid.gcOrganizationId !== user!.organizationId) return null;
  return bid;
};

// Get active estimate for a project
router.get("/api/projects/:projectId/estimate", requireAuth, async (req: AuthRequest, res, next) => {
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

      // Task #2576 — Single source of truth for factorized totals: the
      // org default + per-estimate override flow through applyOrgFactors
      // so bid/project/exports all return the same grand total.
      const estOrgId = project.gcOrganizationId ?? null;
      const appliedFactors = estOrgId
        ? await resolveAppliedFactors(estOrgId, (estimate as { estimatingFactorsOverride?: unknown }).estimatingFactorsOverride ?? null)
        : { ...DEFAULT_ESTIMATING_FACTORS };
      const appliedTotals = applyOrgFactors(
        {
          materialCost: totals.materialCost,
          laborCost: totals.laborCost,
          equipmentCost: totals.equipmentCost,
          consumablesCost: totals.consumablesCost,
          subcontractCost: totals.subcontractCost,
        },
        appliedFactors,
      );

      res.json({ estimate: { ...estimate, lineItems, totals, appliedTotals } });
    } catch (error) {
      next(error);
    }
  });

  // Create new estimate for project
  router.post("/api/projects/:projectId/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      logInfo("[Estimate] Create estimate request:", { projectId: req.params.projectId, user: req.user?.email });
      const { projectId } = req.params;
      const userId = req.user!.id;

      // Check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
      if (!hasEstimateAccess(req.user!.role)) {
        logInfo("[Estimate] Permission denied:", req.user!.role);
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check project exists and is owned by caller's org
      const project = await verifyProjectOrgAccess(projectId, req.user);

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
      logInfo("[Estimate] Creating estimate with version:", versionNumber);
      const [newEstimate] = await db.insert(estimates).values({
        projectId,
        versionNumber,
        status: "DRAFT",
        createdById: userId,
      }).returning();

      logInfo("[Estimate] Created estimate:", newEstimate.id);
      res.status(201).json(newEstimate);
    } catch (error) {
      next(error);
    }
  });

  // Get active estimate for a bid
  router.get("/api/bids/:bidId/estimate", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const { bidId } = req.params;

      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check bid exists and is owned by caller's org
      const bid = await verifyBidOrgAccess(bidId, req.user);

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

      // Task #2576 — Apply org factors + per-estimate override.
      const estOrgId = bid.gcOrganizationId ?? null;
      const appliedFactors = estOrgId
        ? await resolveAppliedFactors(estOrgId, (estimate as { estimatingFactorsOverride?: unknown }).estimatingFactorsOverride ?? null)
        : { ...DEFAULT_ESTIMATING_FACTORS };
      const appliedTotals = applyOrgFactors(
        {
          materialCost: totals.materialCost,
          laborCost: totals.laborCost,
          equipmentCost: totals.equipmentCost,
          consumablesCost: totals.consumablesCost,
          subcontractCost: totals.subcontractCost,
        },
        appliedFactors,
      );

      res.json({ estimate: { ...estimate, lineItems, totals, appliedTotals } });
    } catch (error) {
      next(error);
    }
  });

  // Create new estimate for bid
  router.post("/api/bids/:bidId/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      logInfo("[Estimate] Create bid estimate request:", { bidId: req.params.bidId, user: req.user?.email });
      const { bidId } = req.params;
      const userId = req.user!.id;

      if (!hasEstimateAccess(req.user!.role)) {
        logInfo("[Estimate] Permission denied:", req.user!.role);
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Check bid exists and is owned by caller's org
      const bid = await verifyBidOrgAccess(bidId, req.user);

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
      logInfo("[Estimate] Creating bid estimate with version:", versionNumber);
      const [newEstimate] = await db.insert(estimates).values({
        bidId,
        projectId: null,
        versionNumber,
        status: "DRAFT",
        createdById: userId,
      }).returning();

      logInfo("[Estimate] Created bid estimate:", newEstimate.id);
      res.status(201).json(newEstimate);
    } catch (error) {
      next(error);
    }
  });

  // Import takeoff quantities into estimate
  router.post("/api/projects/:projectId/estimate/import-takeoff", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { projectId } = req.params;
      const { estimateId, categoryIds } = req.body as { estimateId: string, categoryIds: string[] };

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify project is owned by caller's org (cross-tenant guard)
      const projectOwner = await verifyProjectOrgAccess(projectId, req.user);
      if (!projectOwner) {
        return res.status(404).json({ error: "Project not found" });
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

      const existingTakeoffLineItems = await db.select({ id: estimateLineItems.id, metadata: estimateLineItems.metadata, sourceTakeoffCategoryId: estimateLineItems.sourceTakeoffCategoryId })
        .from(estimateLineItems)
        .where(and(
          eq(estimateLineItems.estimateId, estimateId),
          or(eq(estimateLineItems.source, "TAKEOFF"), eq(estimateLineItems.source, "ASSEMBLY")),
        ));

      const alreadyImportedMeasurementIds = new Set<string>();
      for (const li of existingTakeoffLineItems) {
        try {
          const meta = typeof li.metadata === 'string' ? JSON.parse(li.metadata) : (li.metadata || {});
          if (Array.isArray(meta.sourceMeasurementIds) && meta.sourceMeasurementIds.length > 0) {
            for (const mid of meta.sourceMeasurementIds) alreadyImportedMeasurementIds.add(mid);
          }
        } catch (err) { logError("Failed to parse line item metadata for sourceMeasurementIds", { lineItemId: li.id }, err instanceof Error ? err : new Error(String(err))); }
      }

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
        metadata?: string;
      }> = [];

      let totalMeasurementsFound = 0;

      for (const category of categories) {
        const allMeasurements = await db.query.takeoffMeasurements.findMany({
          where: eq(takeoffMeasurements.categoryId, category.id),
        });

        const measurements = allMeasurements.filter(m => !alreadyImportedMeasurementIds.has(m.id));
        totalMeasurementsFound += allMeasurements.length;

        let linearTotal = 0;
        let areaTotal = 0;
        let volumeTotal = 0;
        let countTotal = 0;
        const linearMeasurementIds: string[] = [];
        const areaMeasurementIds: string[] = [];
        const volumeMeasurementIds: string[] = [];
        const countMeasurementIds: string[] = [];

        for (const measurement of measurements) {
          if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
            if (measurement.computedLengthFt) {
              linearTotal += Number(measurement.computedLengthFt);
              linearMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                  const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                  linearTotal += length;
                  linearMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
            let deductionPolygons: Array<{x: number; y: number}[]> = [];
            let rectDeductionSf = 0;
            try {
              if (measurement.deductions) {
                const parsed = JSON.parse(measurement.deductions);
                if (Array.isArray(parsed)) {
                  for (const d of parsed) {
                    if (d && typeof d.width === "number" && typeof d.height === "number") {
                      rectDeductionSf += d.width * d.height;
                    } else if (Array.isArray(d)) {
                      deductionPolygons.push(d);
                    }
                  }
                }
              }
            } catch (err) { logError("Failed to parse deductions metadata for area measurement", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }

            if (measurement.computedAreaFt2) {
              let area = Number(measurement.computedAreaFt2);
              if (deductionPolygons.length > 0 && measurement.points) {
                try {
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                  if (sheet?.scalePxPerFoot) {
                    const { netArea } = computeNetAreaInFt2(points, deductionPolygons, sheet.scalePxPerFoot);
                    area = netArea;
                  }
                } catch (err) { logError("Failed to compute net area with deductions", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              }
              area = Math.max(0, area - rectDeductionSf);
              areaTotal += area;
              areaMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                  let area: number;
                  if (deductionPolygons.length > 0) {
                    const result = computeNetAreaInFt2(points, deductionPolygons, sheet.scalePxPerFoot);
                    area = result.netArea;
                  } else {
                    area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  }
                  area = Math.max(0, area - rectDeductionSf);
                  areaTotal += area;
                  areaMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "VOLUME") {
            if (measurement.computedVolumeCy) {
              volumeTotal += Number(measurement.computedVolumeCy);
              volumeMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  const volume = computeVolumeInCY(area, measurement.depthFeet);
                  volumeTotal += volume;
                  volumeMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "COUNT") {
            let meta: any = {};
            try { meta = typeof measurement.metadata === 'string' ? JSON.parse(measurement.metadata) : (measurement.metadata || {}); } catch (err) { logError("Failed to parse COUNT measurement metadata", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
            const rawQty = Number(measurement.count ?? meta.quantity ?? 1);
            const qty = Number.isFinite(rawQty) ? rawQty : 1;
            const unit = (meta.unit || "EA").toUpperCase();
            if (unit === "CY") {
              volumeTotal += qty;
              volumeMeasurementIds.push(measurement.id);
            } else if (unit === "SF") {
              areaTotal += qty;
              areaMeasurementIds.push(measurement.id);
            } else if (unit === "LF") {
              linearTotal += qty;
              linearMeasurementIds.push(measurement.id);
            } else {
              countTotal += qty;
              countMeasurementIds.push(measurement.id);
            }
          }
        }

        const wasteMult = 1 + ((category.wasteFactor ?? 0) / 100);
        const catUnitCost = category.unitCost ?? 0;

        const allNewMeasurementIds = [...linearMeasurementIds, ...areaMeasurementIds, ...volumeMeasurementIds, ...countMeasurementIds];

        const linkedAssemblies = allNewMeasurementIds.length > 0
          ? await db.select({
              measurementId: takeoffMeasurementAssemblies.measurementId,
              assemblyId: takeoffMeasurementAssemblies.assemblyId,
            }).from(takeoffMeasurementAssemblies)
              .where(inArray(takeoffMeasurementAssemblies.measurementId, allNewMeasurementIds))
          : [];

        const assemblyIds = [...new Set(linkedAssemblies.map(la => la.assemblyId))];
        let assembliesWithItems: Array<{ assembly: any; items: any[] }> = [];
        if (assemblyIds.length > 0) {
          const assemblies = await db.select().from(takeoffAssemblies).where(inArray(takeoffAssemblies.id, assemblyIds));
          for (const assembly of assemblies) {
            const items = await db.select().from(takeoffAssemblyItems)
              .where(eq(takeoffAssemblyItems.assemblyId, assembly.id));
            assembliesWithItems.push({ assembly, items });
          }
        }

        const formulaCtx: FormulaContext = {
          length: linearTotal,
          area: areaTotal,
          volume: volumeTotal,
          count: countTotal,
        };

        if (assembliesWithItems.length > 0) {
          for (const { assembly, items } of assembliesWithItems) {
            for (const item of items) {
              const computedQty = computeAssemblyQuantity(item.formula, formulaCtx, item.wasteFactor ?? 0);
              if (computedQty <= 0) continue;
              const itemUnitCost = Number(item.unitCost ?? 0);
              const materialCost = computedQty * itemUnitCost;
              lineItemsToCreate.push({
                estimateId,
                category: "GENERAL" as const,
                description: `${category.name} — ${item.name}`,
                quantity: computedQty.toFixed(2),
                unit: item.unit,
                source: "ASSEMBLY" as "TAKEOFF",
                sourceTakeoffCategoryId: category.id,
                computedQuantity: computedQty.toFixed(2),
                materialCost: materialCost.toFixed(2),
                laborHours: "0", laborCost: "0",
                equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
                overheadAllocation: "0", profitAllocation: "0",
                totalCost: materialCost.toFixed(2),
                metadata: JSON.stringify({
                  sourceMeasurementIds: allNewMeasurementIds,
                  assemblyId: assembly.id,
                  assemblyName: assembly.name,
                  assemblyItemId: item.id,
                  wasteFactor: item.wasteFactor,
                }),
              });
            }
          }
        } else {
          const buildCatLineItem = (description: string, rawQty: number, unit: string, measurementIds: string[]) => {
            const qty = rawQty * wasteMult;
            const perUnitCost = catUnitCost;
            const avgMeasurementCost = measurements.reduce((sum, m) => sum + (m.unitCost ?? 0), 0) / (measurements.length || 1);
            const effectiveUnitCost = avgMeasurementCost > 0 ? avgMeasurementCost : perUnitCost;
            const materialCost = qty * effectiveUnitCost;
            return {
              estimateId,
              category: "GENERAL" as const,
              description,
              quantity: qty.toFixed(2),
              unit,
              source: "TAKEOFF" as const,
              sourceTakeoffCategoryId: category.id,
              computedQuantity: rawQty.toFixed(2),
              materialCost: materialCost.toFixed(2),
              laborHours: "0", laborCost: "0",
              equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
              overheadAllocation: "0", profitAllocation: "0",
              totalCost: materialCost.toFixed(2),
              metadata: JSON.stringify({
                sourceMeasurementIds: measurementIds,
                wasteFactor: category.wasteFactor ?? 0,
                wasteMultiplier: wasteMult,
                rawQuantity: rawQty,
              }),
            };
          };

          if (linearTotal > 0) lineItemsToCreate.push(buildCatLineItem(`${category.name} - Linear`, linearTotal, "LF", linearMeasurementIds));
          if (areaTotal > 0) lineItemsToCreate.push(buildCatLineItem(`${category.name} - Area`, areaTotal, "SF", areaMeasurementIds));
          if (volumeTotal > 0) lineItemsToCreate.push(buildCatLineItem(`${category.name} - Volume`, volumeTotal, "CY", volumeMeasurementIds));
          if (countTotal > 0) lineItemsToCreate.push(buildCatLineItem(`${category.name} - Count`, countTotal, "EA", countMeasurementIds));
        }
      }

      const projectSheets = await db.query.takeoffSheets.findMany({
        where: eq(takeoffSheets.projectId, projectId),
      });
      if (projectSheets.length > 0) {
        const sheetIds = projectSheets.map(s => s.id);
        const allUncategorizedMeasurements = await db.query.takeoffMeasurements.findMany({
          where: and(
            inArray(takeoffMeasurements.sheetId, sheetIds),
            isNull(takeoffMeasurements.categoryId)
          ),
        });

        const uncategorizedMeasurements = allUncategorizedMeasurements.filter(m => !alreadyImportedMeasurementIds.has(m.id));
        totalMeasurementsFound += allUncategorizedMeasurements.length;

        if (uncategorizedMeasurements.length > 0) {
          let uncatLinear = 0, uncatArea = 0, uncatVolume = 0, uncatCount = 0;
          const uncatLinearIds: string[] = [];
          const uncatAreaIds: string[] = [];
          const uncatVolumeIds: string[] = [];
          const uncatCountIds: string[] = [];

          for (const measurement of uncategorizedMeasurements) {
            if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
              if (measurement.computedLengthFt) {
                uncatLinear += Number(measurement.computedLengthFt);
                uncatLinearIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                    const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                    uncatLinear += length;
                    uncatLinearIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
              let rectDeductionSf = 0;
              try {
                if (measurement.deductions) {
                  const parsed = JSON.parse(measurement.deductions);
                  if (Array.isArray(parsed)) {
                    for (const d of parsed) {
                      if (d && typeof d.width === "number" && typeof d.height === "number") {
                        rectDeductionSf += d.width * d.height;
                      }
                    }
                  }
                }
              } catch (err) { logError("Failed to parse deductions for uncategorized area measurement", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              if (measurement.computedAreaFt2) {
                uncatArea += Math.max(0, Number(measurement.computedAreaFt2) - rectDeductionSf);
                uncatAreaIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                    const area = Math.max(0, computePolygonAreaInFt2(points, sheet.scalePxPerFoot) - rectDeductionSf);
                    uncatArea += area;
                    uncatAreaIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "VOLUME") {
              if (measurement.computedVolumeCy) {
                uncatVolume += Number(measurement.computedVolumeCy);
                uncatVolumeIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = projectSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    const volume = computeVolumeInCY(area, measurement.depthFeet);
                    uncatVolume += volume;
                    uncatVolumeIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "COUNT") {
              let meta: any = {};
              try { meta = typeof measurement.metadata === 'string' ? JSON.parse(measurement.metadata) : (measurement.metadata || {}); } catch (err) { logError("Failed to parse COUNT measurement metadata", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              const rawQty = Number(measurement.count ?? meta.quantity ?? 1);
              const qty = Number.isFinite(rawQty) ? rawQty : 1;
              const unit = (meta.unit || "EA").toUpperCase();
              if (unit === "CY") {
                uncatVolume += qty;
                uncatVolumeIds.push(measurement.id);
              } else if (unit === "SF") {
                uncatArea += qty;
                uncatAreaIds.push(measurement.id);
              } else if (unit === "LF") {
                uncatLinear += qty;
                uncatLinearIds.push(measurement.id);
              } else {
                uncatCount += qty;
                uncatCountIds.push(measurement.id);
              }
            }
          }

          const buildUncatLineItem = (description: string, qty: number, unit: string, measurementIds: string[]) => ({
            estimateId, category: "GENERAL" as const, description,
            quantity: qty.toString(), unit, source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: null as unknown as string,
            computedQuantity: qty.toString(),
            materialCost: "0", laborHours: "0", laborCost: "0",
            equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
            overheadAllocation: "0", profitAllocation: "0", totalCost: "0",
            metadata: JSON.stringify({ sourceMeasurementIds: measurementIds }),
          });

          if (uncatLinear > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Linear", uncatLinear, "LF", uncatLinearIds));
          if (uncatArea > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Area", uncatArea, "SF", uncatAreaIds));
          if (uncatVolume > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Volume", uncatVolume, "CY", uncatVolumeIds));
          if (uncatCount > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Count", uncatCount, "EA", uncatCountIds));
        }
      }

      if (lineItemsToCreate.length > 0) {
        let newLineItems = await db.insert(estimateLineItems).values(lineItemsToCreate).returning();
        if (req.user?.organizationId) {
          await matchVendorPricing(newLineItems, req.user!.organizationId);
          const lineItemIds = newLineItems.map(li => li.id);
          newLineItems = await db.query.estimateLineItems.findMany({
            where: inArray(estimateLineItems.id, lineItemIds),
          });
        }
        try {
          await createEstimateSnapshot(estimateId, req.user!.id);
        } catch (snapshotErr) {
          logError("[Snapshot] Failed to create snapshot after project import-takeoff:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
        }
        res.json({ lineItems: newLineItems, count: newLineItems.length });
      } else {
        let message: string | undefined;
        if (totalMeasurementsFound > 0 && alreadyImportedMeasurementIds.size > 0) {
          message = "All measurements have already been imported. Add new measurements to import additional items.";
        } else if (totalMeasurementsFound > 0) {
          message = "Measurements were found but could not be converted to line items. Ensure sheets have scale calibration set.";
        }
        res.json({ lineItems: [], count: 0, message });
      }
    } catch (error) {
      next(error);
    }
  });

  // Import takeoff measurements into a bid estimate
  router.post("/api/bids/:bidId/estimate/import-takeoff", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

      // Verify bid is owned by caller's org (cross-tenant guard)
      const bidOwner = await verifyBidOrgAccess(bidId, req.user);
      if (!bidOwner) {
        return res.status(404).json({ error: "Bid not found" });
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

      const existingTakeoffLineItems = await db.select({ id: estimateLineItems.id, metadata: estimateLineItems.metadata, sourceTakeoffCategoryId: estimateLineItems.sourceTakeoffCategoryId })
        .from(estimateLineItems)
        .where(and(
          eq(estimateLineItems.estimateId, estimateId),
          or(eq(estimateLineItems.source, "TAKEOFF"), eq(estimateLineItems.source, "ASSEMBLY")),
        ));

      const alreadyImportedMeasurementIds = new Set<string>();
      for (const li of existingTakeoffLineItems) {
        try {
          const meta = typeof li.metadata === 'string' ? JSON.parse(li.metadata) : (li.metadata || {});
          if (Array.isArray(meta.sourceMeasurementIds) && meta.sourceMeasurementIds.length > 0) {
            for (const mid of meta.sourceMeasurementIds) alreadyImportedMeasurementIds.add(mid);
          }
        } catch (err) { logError("Failed to parse line item metadata for sourceMeasurementIds", { lineItemId: li.id }, err instanceof Error ? err : new Error(String(err))); }
      }

      const filteredCategories = categories;

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
        metadata?: string;
      }> = [];

      let totalMeasurementsFound = 0;

      for (const category of filteredCategories) {
        const allMeasurements = await db.query.takeoffMeasurements.findMany({
          where: eq(takeoffMeasurements.categoryId, category.id),
        });

        const measurements = allMeasurements.filter(m => !alreadyImportedMeasurementIds.has(m.id));
        totalMeasurementsFound += allMeasurements.length;

        let linearTotal = 0;
        let areaTotal = 0;
        let volumeTotal = 0;
        let countTotal = 0;
        const linearMeasurementIds: string[] = [];
        const areaMeasurementIds: string[] = [];
        const volumeMeasurementIds: string[] = [];
        const countMeasurementIds: string[] = [];

        for (const measurement of measurements) {
          if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
            if (measurement.computedLengthFt) {
              linearTotal += Number(measurement.computedLengthFt);
              linearMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                  const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                  linearTotal += length;
                  linearMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if ((measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA")) {
            let deductionPolygons: Array<{x: number; y: number}[]> = [];
            let rectDeductionSf = 0;
            try {
              if (measurement.deductions) {
                const parsed = JSON.parse(measurement.deductions);
                if (Array.isArray(parsed)) {
                  for (const d of parsed) {
                    if (d && typeof d.width === "number" && typeof d.height === "number") {
                      rectDeductionSf += d.width * d.height;
                    } else if (Array.isArray(d)) {
                      deductionPolygons.push(d);
                    }
                  }
                }
              }
            } catch (err) { logError("Failed to parse deductions metadata for area measurement", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }

            if (measurement.computedAreaFt2) {
              let area = Number(measurement.computedAreaFt2);
              if (deductionPolygons.length > 0 && measurement.points) {
                try {
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                  if (sheet?.scalePxPerFoot) {
                    const { netArea } = computeNetAreaInFt2(points, deductionPolygons, sheet.scalePxPerFoot);
                    area = netArea;
                  }
                } catch (err) { logError("Failed to compute net area with deductions", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              }
              area = Math.max(0, area - rectDeductionSf);
              areaTotal += area;
              areaMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                  let area: number;
                  if (deductionPolygons.length > 0) {
                    const result = computeNetAreaInFt2(points, deductionPolygons, sheet.scalePxPerFoot);
                    area = result.netArea;
                  } else {
                    area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  }
                  area = Math.max(0, area - rectDeductionSf);
                  areaTotal += area;
                  areaMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "VOLUME") {
            if (measurement.computedVolumeCy) {
              volumeTotal += Number(measurement.computedVolumeCy);
              volumeMeasurementIds.push(measurement.id);
            } else if (measurement.points) {
              try {
                const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                const sheet = await db.query.takeoffSheets.findFirst({ where: eq(takeoffSheets.id, measurement.sheetId) });
                if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                  const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                  const volume = computeVolumeInCY(area, measurement.depthFeet);
                  volumeTotal += volume;
                  volumeMeasurementIds.push(measurement.id);
                  await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                }
              } catch { logWarn("Non-critical operation failed"); }
            }
          } else if (measurement.type === "COUNT") {
            let meta: any = {};
            try { meta = typeof measurement.metadata === 'string' ? JSON.parse(measurement.metadata) : (measurement.metadata || {}); } catch (err) { logError("Failed to parse COUNT measurement metadata", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
            const rawQty = Number(measurement.count ?? meta.quantity ?? 1);
            const qty = Number.isFinite(rawQty) ? rawQty : 1;
            const unit = (meta.unit || "EA").toUpperCase();
            if (unit === "CY") {
              volumeTotal += qty;
              volumeMeasurementIds.push(measurement.id);
            } else if (unit === "SF") {
              areaTotal += qty;
              areaMeasurementIds.push(measurement.id);
            } else if (unit === "LF") {
              linearTotal += qty;
              linearMeasurementIds.push(measurement.id);
            } else {
              countTotal += qty;
              countMeasurementIds.push(measurement.id);
            }
          }
        }

        const wasteMult = 1 + ((category.wasteFactor ?? 0) / 100);
        const catUnitCost = category.unitCost ?? 0;
        const allNewMeasurementIds = [...linearMeasurementIds, ...areaMeasurementIds, ...volumeMeasurementIds, ...countMeasurementIds];

        const linkedAssemblies = allNewMeasurementIds.length > 0
          ? await db.select({
              measurementId: takeoffMeasurementAssemblies.measurementId,
              assemblyId: takeoffMeasurementAssemblies.assemblyId,
            }).from(takeoffMeasurementAssemblies)
              .where(inArray(takeoffMeasurementAssemblies.measurementId, allNewMeasurementIds))
          : [];

        const assemblyIds = [...new Set(linkedAssemblies.map(la => la.assemblyId))];
        let assembliesWithItems: Array<{ assembly: any; items: any[] }> = [];
        if (assemblyIds.length > 0) {
          const assemblies = await db.select().from(takeoffAssemblies).where(inArray(takeoffAssemblies.id, assemblyIds));
          for (const assembly of assemblies) {
            const items = await db.select().from(takeoffAssemblyItems)
              .where(eq(takeoffAssemblyItems.assemblyId, assembly.id));
            assembliesWithItems.push({ assembly, items });
          }
        }

        const formulaCtx: FormulaContext = {
          length: linearTotal,
          area: areaTotal,
          volume: volumeTotal,
          count: countTotal,
        };

        if (assembliesWithItems.length > 0) {
          for (const { assembly, items } of assembliesWithItems) {
            for (const item of items) {
              const computedQty = computeAssemblyQuantity(item.formula, formulaCtx, item.wasteFactor ?? 0);
              if (computedQty <= 0) continue;
              const itemUnitCost = Number(item.unitCost ?? 0);
              const materialCost = computedQty * itemUnitCost;
              let laborHours = 0;
              let laborCost = 0;
              if (classificationRate !== null && classificationRate > 0 && orgId) {
                try {
                  const laborEstimate = await estimateLaborHoursFromProductionRate(item.name, item.unit, computedQty, orgId);
                  if (laborEstimate.confidence !== "NONE") {
                    laborHours = laborEstimate.suggestedLaborHours;
                  }
                } catch { logWarn("Non-critical operation failed"); }
                laborCost = parseFloat((laborHours * classificationRate).toFixed(2));
              }
              const totalCost = materialCost + laborCost;
              lineItemsToCreate.push({
                estimateId,
                category: "GENERAL" as const,
                description: `${category.name} — ${item.name}`,
                quantity: computedQty.toFixed(2),
                unit: item.unit,
                source: "ASSEMBLY" as "TAKEOFF",
                sourceTakeoffCategoryId: category.id,
                computedQuantity: computedQty.toFixed(2),
                materialCost: materialCost.toFixed(2),
                laborHours: laborHours.toFixed(2),
                laborCost: laborCost.toFixed(2),
                equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
                overheadAllocation: "0", profitAllocation: "0",
                totalCost: totalCost.toFixed(2),
                ...(jobClassificationId ? { jobClassificationId, laborRateUsed: classificationRate?.toFixed(2) } : {}),
                metadata: JSON.stringify({
                  sourceMeasurementIds: allNewMeasurementIds,
                  assemblyId: assembly.id,
                  assemblyName: assembly.name,
                  assemblyItemId: item.id,
                  wasteFactor: item.wasteFactor,
                }),
              });
            }
          }
        } else {
          const buildLineItem = async (description: string, rawQty: number, unit: string, measurementIds: string[]) => {
            const qty = rawQty * wasteMult;
            const avgMeasurementCost = measurements.reduce((sum, m) => sum + (m.unitCost ?? 0), 0) / (measurements.length || 1);
            const effectiveUnitCost = avgMeasurementCost > 0 ? avgMeasurementCost : catUnitCost;
            const materialCost = qty * effectiveUnitCost;

            const base = {
              estimateId, category: "GENERAL" as const, description,
              quantity: qty.toFixed(2), unit, source: "TAKEOFF" as const,
              sourceTakeoffCategoryId: category.id, computedQuantity: rawQty.toFixed(2),
              materialCost: materialCost.toFixed(2), equipmentCost: "0", consumablesCost: "0",
              subcontractCost: "0", overheadAllocation: "0", profitAllocation: "0",
              metadata: JSON.stringify({
                sourceMeasurementIds: measurementIds,
                wasteFactor: category.wasteFactor ?? 0,
                wasteMultiplier: wasteMult,
                rawQuantity: rawQty,
              }),
            };

            if (classificationRate !== null && classificationRate > 0 && orgId) {
              let laborHours = 0;
              try {
                const laborEstimate = await estimateLaborHoursFromProductionRate(description, unit, qty, orgId);
                if (laborEstimate.confidence !== "NONE") {
                  laborHours = laborEstimate.suggestedLaborHours;
                }
              } catch { logWarn("Non-critical operation failed"); }
              const laborCost = parseFloat((laborHours * classificationRate).toFixed(2));
              const totalCost = materialCost + laborCost;
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
              totalCost: materialCost.toFixed(2),
            };
          };

          if (linearTotal > 0) lineItemsToCreate.push(await buildLineItem(`${category.name} - Linear`, linearTotal, "LF", linearMeasurementIds));
          if (areaTotal > 0) lineItemsToCreate.push(await buildLineItem(`${category.name} - Area`, areaTotal, "SF", areaMeasurementIds));
          if (volumeTotal > 0) lineItemsToCreate.push(await buildLineItem(`${category.name} - Volume`, volumeTotal, "CY", volumeMeasurementIds));
          if (countTotal > 0) lineItemsToCreate.push(await buildLineItem(`${category.name} - Count`, countTotal, "EA", countMeasurementIds));
        }
      }

      const bidSheets = await db.query.takeoffSheets.findMany({
        where: eq(takeoffSheets.bidId, bidId),
      });
      if (bidSheets.length > 0) {
        const sheetIds = bidSheets.map(s => s.id);
        const allUncategorizedMeasurements = await db.query.takeoffMeasurements.findMany({
          where: and(
            inArray(takeoffMeasurements.sheetId, sheetIds),
            isNull(takeoffMeasurements.categoryId)
          ),
        });

        const uncategorizedMeasurements = allUncategorizedMeasurements.filter(m => !alreadyImportedMeasurementIds.has(m.id));
        totalMeasurementsFound += allUncategorizedMeasurements.length;

        if (uncategorizedMeasurements.length > 0) {
          let uncatLinear = 0, uncatArea = 0, uncatVolume = 0, uncatCount = 0;
          const uncatLinearIds: string[] = [];
          const uncatAreaIds: string[] = [];
          const uncatVolumeIds: string[] = [];
          const uncatCountIds: string[] = [];

          for (const measurement of uncategorizedMeasurements) {
            if (measurement.type === "LINEAR" || measurement.type === "LINEAR_WITH_DROP" || measurement.type === "PITCHED_LINEAR" || measurement.type === "SEGMENT") {
              if (measurement.computedLengthFt) {
                uncatLinear += Number(measurement.computedLengthFt);
                uncatLinearIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computeDistanceInFeet } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 2) {
                    const length = computeDistanceInFeet(points, sheet.scalePxPerFoot);
                    uncatLinear += length;
                    uncatLinearIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedLengthFt: length }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "AREA" || measurement.type === "PITCHED_AREA" || measurement.type === "SURFACE_AREA") {
              let rectDeductionSf = 0;
              try {
                if (measurement.deductions) {
                  const parsed = JSON.parse(measurement.deductions);
                  if (Array.isArray(parsed)) {
                    for (const d of parsed) {
                      if (d && typeof d.width === "number" && typeof d.height === "number") {
                        rectDeductionSf += d.width * d.height;
                      }
                    }
                  }
                }
              } catch (err) { logError("Failed to parse deductions for uncategorized area measurement", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              if (measurement.computedAreaFt2) {
                uncatArea += Math.max(0, Number(measurement.computedAreaFt2) - rectDeductionSf);
                uncatAreaIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3) {
                    const area = Math.max(0, computePolygonAreaInFt2(points, sheet.scalePxPerFoot) - rectDeductionSf);
                    uncatArea += area;
                    uncatAreaIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "VOLUME") {
              if (measurement.computedVolumeCy) {
                uncatVolume += Number(measurement.computedVolumeCy);
                uncatVolumeIds.push(measurement.id);
              } else if (measurement.points) {
                try {
                  const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
                  const points = typeof measurement.points === "string" ? JSON.parse(measurement.points) : measurement.points;
                  const sheet = bidSheets.find(s => s.id === measurement.sheetId);
                  if (sheet?.scalePxPerFoot && Array.isArray(points) && points.length >= 3 && measurement.depthFeet) {
                    const area = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
                    const volume = computeVolumeInCY(area, measurement.depthFeet);
                    uncatVolume += volume;
                    uncatVolumeIds.push(measurement.id);
                    await db.update(takeoffMeasurements).set({ computedAreaFt2: area, computedVolumeCy: volume }).where(eq(takeoffMeasurements.id, measurement.id));
                  }
                } catch { logWarn("Non-critical operation failed"); }
              }
            } else if (measurement.type === "COUNT") {
              let meta: any = {};
              try { meta = typeof measurement.metadata === 'string' ? JSON.parse(measurement.metadata) : (measurement.metadata || {}); } catch (err) { logError("Failed to parse COUNT measurement metadata", { measurementId: measurement.id }, err instanceof Error ? err : new Error(String(err))); }
              const rawQty = Number(measurement.count ?? meta.quantity ?? 1);
              const qty = Number.isFinite(rawQty) ? rawQty : 1;
              const unit = (meta.unit || "EA").toUpperCase();
              if (unit === "CY") {
                uncatVolume += qty;
                uncatVolumeIds.push(measurement.id);
              } else if (unit === "SF") {
                uncatArea += qty;
                uncatAreaIds.push(measurement.id);
              } else if (unit === "LF") {
                uncatLinear += qty;
                uncatLinearIds.push(measurement.id);
              } else {
                uncatCount += qty;
                uncatCountIds.push(measurement.id);
              }
            }
          }

          const buildUncatLineItem = (description: string, qty: number, unit: string, measurementIds: string[]) => ({
            estimateId, category: "GENERAL" as const, description,
            quantity: qty.toString(), unit, source: "TAKEOFF" as const,
            sourceTakeoffCategoryId: null as unknown as string,
            computedQuantity: qty.toString(),
            materialCost: "0", laborHours: "0", laborCost: "0",
            equipmentCost: "0", consumablesCost: "0", subcontractCost: "0",
            overheadAllocation: "0", profitAllocation: "0", totalCost: "0",
            metadata: JSON.stringify({ sourceMeasurementIds: measurementIds }),
          });

          if (uncatLinear > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Linear", uncatLinear, "LF", uncatLinearIds));
          if (uncatArea > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Area", uncatArea, "SF", uncatAreaIds));
          if (uncatVolume > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Volume", uncatVolume, "CY", uncatVolumeIds));
          if (uncatCount > 0) lineItemsToCreate.push(buildUncatLineItem("Uncategorized - Count", uncatCount, "EA", uncatCountIds));
        }
      }

      if (lineItemsToCreate.length > 0) {
        let newLineItems = await db.insert(estimateLineItems).values(lineItemsToCreate).returning();
        if (req.user?.organizationId) {
          await matchVendorPricing(newLineItems, req.user!.organizationId);
          const lineItemIds = newLineItems.map(li => li.id);
          newLineItems = await db.query.estimateLineItems.findMany({
            where: inArray(estimateLineItems.id, lineItemIds),
          });
        }
        const laborRateAppliedCount = newLineItems.filter((li) => li.laborRateUsed !== null && Number(li.laborRateUsed) > 0).length;
        try {
          await createEstimateSnapshot(estimateId, req.user!.id);
        } catch (snapshotErr) {
          logError("[Snapshot] Failed to create snapshot after import-takeoff:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
        }
        res.json({ lineItems: newLineItems, count: newLineItems.length, laborRateAppliedCount, classificationName });
      } else {
        let message: string | undefined;
        if (totalMeasurementsFound > 0 && alreadyImportedMeasurementIds.size > 0) {
          message = "All measurements have already been imported. Add new measurements to import additional items.";
        } else if (totalMeasurementsFound > 0) {
          message = "Measurements were found but could not be converted to line items. Ensure sheets have scale calibration set.";
        }
        res.json({ lineItems: [], count: 0, laborRateAppliedCount: 0, classificationName: null, message });
      }
    } catch (error) {
      next(error);
    }
  });

  // Production rate labor estimation — must be before /:estimateId routes to avoid route shadowing
  router.post("/api/estimates/production-rates/estimate-labor", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  router.post("/api/estimates/:estimateId/line-items", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId } = req.params;
      const lineItem = req.body;

      if (process.env.DEBUG_LINE_ITEMS === "true") {
        const costFields = ['quantity', 'materialCost', 'laborCost', 'laborHours', 'equipmentCost', 'equipmentHours', 'consumablesCost', 'subcontractCost', 'overheadAllocation', 'profitAllocation'];
        const rawCosts: Record<string, any> = {};
        for (const f of costFields) rawCosts[f] = { value: lineItem[f], type: typeof lineItem[f] };
        logInfo("[DEBUG:LineItem:POST] Raw request body values:", JSON.stringify(rawCosts));
      }

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists, is editable, AND owned by caller's org
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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
        stoneType: lineItem.stoneType,
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

      const dotCheck = await validateDotPayItemLink(lineItem);
      if (!dotCheck.ok) return res.status(400).json({ error: dotCheck.error });

      // Normalize data to fix frontend/backend enum mismatches
      const normalizedLineItem = normalizeLineItemData(lineItem);

      const parseInput: Record<string, any> = {
        ...normalizedLineItem,
        estimateId,
        source: "MANUAL",
        totalCost: totalCost,
        calculatedConcreteYards: materialResults.calculatedConcreteYards ?? null,
        calculatedStoneTons: materialResults.calculatedStoneTons ?? null,
        calculatedExcavationYards: materialResults.calculatedExcavationYards ?? null,
        calculatedWireMeshRolls: materialResults.calculatedWireMeshRolls ?? null,
        calculatedRebarCount: materialResults.calculatedRebarCount ?? null,
        calculatedRebarLinearFeet: materialResults.calculatedRebarLinearFeet ?? null,
        calculatedDowelCount: materialResults.calculatedDowelCount ?? null,
        calculatedSealerGallons: materialResults.calculatedSealerGallons ?? null,
        calculatedUnderlaymentSF: materialResults.calculatedUnderlaymentSF ?? null,
        materialRequirementsJson: generateMaterialRequirementsJson(materialResults),
        equipmentRequirementsJson: generateEquipmentRequirementsJson(materialResults),
      };

      const decimalFields = [
        'quantity', 'materialCost', 'laborHours', 'laborCost',
        'equipmentHours', 'equipmentCost', 'consumablesCost',
        'subcontractCost', 'overheadAllocation', 'profitAllocation', 'totalCost',
        'computedQuantity', 'laborRateUsed',
        'concreteDepthInches', 'dimensionWidthInches', 'dimensionHeightInches',
        'concreteWasteFactor', 'calculatedConcreteYards',
        'stoneDepthInches', 'stoneWasteFactor', 'calculatedStoneTons',
        'excavationDepthInches', 'excavationWidthInches', 'excavationSwellFactor', 'calculatedExcavationYards',
        'wireMeshCoverageSF', 'wireMeshWasteFactor', 'calculatedWireMeshRolls',
        'rebarSpacingInches', 'rebarLengthFeet', 'rebarWasteFactor', 'calculatedRebarCount', 'calculatedRebarLinearFeet',
        'dowelSpacingInches', 'dowelLengthInches', 'jointLengthFeet', 'calculatedDowelCount',
        'sealerCoverageSFPerGallon', 'sealerWasteFactor', 'calculatedSealerGallons',
        'underlaymentOverlapInches', 'underlaymentWasteFactor', 'calculatedUnderlaymentSF',
      ];
      for (const field of decimalFields) {
        if (parseInput[field] !== undefined && parseInput[field] !== null && typeof parseInput[field] === 'number') {
          parseInput[field] = String(parseInput[field]);
        }
      }

      const validatedData = parseOrRespond(insertEstimateLineItemSchema, parseInput, res);
      if (!validatedData) return;

      if (process.env.DEBUG_LINE_ITEMS === "true") {
        const costFields = ['quantity', 'materialCost', 'laborCost', 'laborHours', 'equipmentCost', 'equipmentHours', 'consumablesCost', 'subcontractCost', 'overheadAllocation', 'profitAllocation', 'totalCost'];
        const parsedCosts: Record<string, any> = {};
        for (const f of costFields) parsedCosts[f] = { value: (validatedData as any)[f], type: typeof (validatedData as any)[f] };
        logInfo("[DEBUG:LineItem:POST] After parse+coercion:", JSON.stringify(parsedCosts));
      }

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
        matchVendorPricing([newLineItem], req.user!.organizationId).catch(() => {});
      }

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError("[Snapshot] Failed to create snapshot after line item create:", {}, snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)));
      }

      res.status(201).json(newLineItem);
    } catch (error) {
      next(error);
    }
  });

  // Bulk create line items in a single transaction. Used by the bid-tab importer
  // so a 200-row import is one round-trip and an all-or-nothing insert.
  router.post("/api/estimates/:estimateId/line-items/bulk", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const rawItems: any[] | null = Array.isArray(req.body?.lineItems)
        ? req.body.lineItems
        : Array.isArray(req.body)
          ? req.body
          : null;

      if (!rawItems) {
        return res.status(400).json({
          error: "Request body must be an array of line items or { lineItems: [...] }",
        });
      }
      if (rawItems.length === 0) {
        return res.status(400).json({ error: "lineItems must not be empty" });
      }
      if (rawItems.length > 1000) {
        return res.status(400).json({
          error: "Cannot create more than 1000 line items in a single request",
        });
      }

      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);
      if (!estimate) {
        return res.status(404).json({ error: "Estimate not found" });
      }

      const decimalFields = [
        'quantity', 'materialCost', 'laborHours', 'laborCost',
        'equipmentHours', 'equipmentCost', 'consumablesCost',
        'subcontractCost', 'overheadAllocation', 'profitAllocation', 'totalCost',
        'computedQuantity', 'laborRateUsed',
        'concreteDepthInches', 'dimensionWidthInches', 'dimensionHeightInches',
        'concreteWasteFactor', 'calculatedConcreteYards',
        'stoneDepthInches', 'stoneWasteFactor', 'calculatedStoneTons',
        'excavationDepthInches', 'excavationWidthInches', 'excavationSwellFactor', 'calculatedExcavationYards',
        'wireMeshCoverageSF', 'wireMeshWasteFactor', 'calculatedWireMeshRolls',
        'rebarSpacingInches', 'rebarLengthFeet', 'rebarWasteFactor', 'calculatedRebarCount', 'calculatedRebarLinearFeet',
        'dowelSpacingInches', 'dowelLengthInches', 'jointLengthFeet', 'calculatedDowelCount',
        'sealerCoverageSFPerGallon', 'sealerWasteFactor', 'calculatedSealerGallons',
        'underlaymentOverlapInches', 'underlaymentWasteFactor', 'calculatedUnderlaymentSF',
      ];

      const validatedRows: any[] = [];
      for (let i = 0; i < rawItems.length; i++) {
        const lineItem = rawItems[i] ?? {};

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
          stoneType: lineItem.stoneType,
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

        const totalCost = (
          Number(lineItem.materialCost || 0) +
          Number(lineItem.laborCost || 0) +
          Number(lineItem.equipmentCost || 0) +
          Number(lineItem.consumablesCost || 0) +
          Number(lineItem.subcontractCost || 0) +
          Number(lineItem.overheadAllocation || 0) +
          Number(lineItem.profitAllocation || 0)
        ).toString();

        const dotCheck = await validateDotPayItemLink(lineItem);
        if (!dotCheck.ok) {
          return res.status(400).json({ error: `Row ${i + 1}: ${dotCheck.error}` });
        }

        const normalizedLineItem = normalizeLineItemData(lineItem);

        const parseInput: Record<string, any> = {
          ...normalizedLineItem,
          estimateId,
          source: normalizedLineItem.source ?? "MANUAL",
          totalCost,
          calculatedConcreteYards: materialResults.calculatedConcreteYards ?? null,
          calculatedStoneTons: materialResults.calculatedStoneTons ?? null,
          calculatedExcavationYards: materialResults.calculatedExcavationYards ?? null,
          calculatedWireMeshRolls: materialResults.calculatedWireMeshRolls ?? null,
          calculatedRebarCount: materialResults.calculatedRebarCount ?? null,
          calculatedRebarLinearFeet: materialResults.calculatedRebarLinearFeet ?? null,
          calculatedDowelCount: materialResults.calculatedDowelCount ?? null,
          calculatedSealerGallons: materialResults.calculatedSealerGallons ?? null,
          calculatedUnderlaymentSF: materialResults.calculatedUnderlaymentSF ?? null,
          materialRequirementsJson: generateMaterialRequirementsJson(materialResults),
          equipmentRequirementsJson: generateEquipmentRequirementsJson(materialResults),
        };

        for (const field of decimalFields) {
          if (parseInput[field] !== undefined && parseInput[field] !== null && typeof parseInput[field] === 'number') {
            parseInput[field] = String(parseInput[field]);
          }
        }

        try {
          validatedRows.push(insertEstimateLineItemSchema.parse(parseInput));
        } catch (err: any) {
          return res.status(400).json({
            error: `Row ${i + 1}: validation failed`,
            details: err?.errors ?? String(err),
          });
        }
      }

      const inserted = await db.transaction(async (tx) => {
        return await tx.insert(estimateLineItems).values(validatedRows).returning();
      });

      if (req.user?.organizationId) {
        matchVendorPricing(inserted, req.user!.organizationId).catch(() => {});
      }

      try {
        await createEstimateSnapshot(estimateId, req.user!.id);
      } catch (snapshotErr) {
        logError(
          "[Snapshot] Failed to create snapshot after bulk line item create:",
          {},
          snapshotErr instanceof Error ? snapshotErr : new Error(String(snapshotErr)),
        );
      }

      res.status(201).json({ lineItems: inserted, count: inserted.length });
    } catch (error) {
      next(error);
    }
  });

  // Update line item
  router.put("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const updates = req.body;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists AND owned by caller's org
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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
        stoneType: updates.stoneType,
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

      const dotCheck = await validateDotPayItemLink(updates);
      if (!dotCheck.ok) return res.status(400).json({ error: dotCheck.error });

      const normalizedUpdates: Record<string, any> = normalizeLineItemData(updates);

      const decimalFields = [
        'quantity', 'materialCost', 'laborHours', 'laborCost',
        'equipmentHours', 'equipmentCost', 'consumablesCost',
        'subcontractCost', 'overheadAllocation', 'profitAllocation', 'totalCost',
        'computedQuantity', 'laborRateUsed',
        'concreteDepthInches', 'dimensionWidthInches', 'dimensionHeightInches',
        'concreteWasteFactor', 'calculatedConcreteYards',
        'stoneDepthInches', 'stoneWasteFactor', 'calculatedStoneTons',
        'excavationDepthInches', 'excavationWidthInches', 'excavationSwellFactor', 'calculatedExcavationYards',
        'wireMeshCoverageSF', 'wireMeshWasteFactor', 'calculatedWireMeshRolls',
        'rebarSpacingInches', 'rebarLengthFeet', 'rebarWasteFactor', 'calculatedRebarCount', 'calculatedRebarLinearFeet',
        'dowelSpacingInches', 'dowelLengthInches', 'jointLengthFeet', 'calculatedDowelCount',
        'sealerCoverageSFPerGallon', 'sealerWasteFactor', 'calculatedSealerGallons',
        'underlaymentOverlapInches', 'underlaymentWasteFactor', 'calculatedUnderlaymentSF',
      ];
      for (const field of decimalFields) {
        if (normalizedUpdates[field] !== undefined && normalizedUpdates[field] !== null && typeof normalizedUpdates[field] === 'number') {
          normalizedUpdates[field] = String(normalizedUpdates[field]);
        }
      }

      const updateData = parseOrRespond(updateEstimateLineItemSchema, normalizedUpdates, res);
      if (!updateData) return;

      // Update line item with recalculated total and material quantities
      let [updatedLineItem] = await db.update(estimateLineItems)
        .set({ 
          ...updateData, 
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
      next(error);
    }
  });

  // Delete line item
  router.delete("/api/estimates/:estimateId/line-items/:lineItemId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId, lineItemId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Verify estimate exists AND owned by caller's org
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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
      next(error);
    }
  });

  const lineItemUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  router.post("/api/estimates/:estimateId/line-items/:lineItemId/upload-photo", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), lineItemUpload.single("photo"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });

      const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: "Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed." });
      }

      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)),
      });
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      const MAX_PHOTOS_PER_LINE_ITEM = 30;
      const existingPhotoUrls = Array.isArray(lineItem.photoUrls) ? lineItem.photoUrls : [];
      const existingPhotoSet = new Set<string>(existingPhotoUrls);
      if (lineItem.photoUrl) existingPhotoSet.add(lineItem.photoUrl);
      if (existingPhotoSet.size >= MAX_PHOTOS_PER_LINE_ITEM) {
        return res.status(409).json({
          error: `Photo limit reached. A line item can have at most ${MAX_PHOTOS_PER_LINE_ITEM} photos.`,
          maxPhotos: MAX_PHOTOS_PER_LINE_ITEM,
          currentCount: existingPhotoSet.size,
        });
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const orgId = req.user!.organizationId || "default";
      const fileName = `${Date.now()}-${file.originalname}`;
      const storagePath = `line-item-photos/${orgId}/${lineItemId}/${fileName}`;
      const fullPath = `${privateDir}/${storagePath}`;

      const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      await objectFile.save(file.buffer, { contentType: file.mimetype, metadata: { contentType: file.mimetype } });

      const photoUrl = `/api/estimates/line-item-photos/${orgId}/${lineItemId}/${fileName}`;

      const existingUrls = Array.isArray(lineItem.photoUrls) ? lineItem.photoUrls : [];
      const legacyUrl = lineItem.photoUrl;
      const merged = [...existingUrls];
      if (legacyUrl && !merged.includes(legacyUrl)) merged.unshift(legacyUrl);
      const nextUrls = [...merged, photoUrl];

      await db.update(estimateLineItems)
        .set({ photoUrls: nextUrls, photoUrl, updatedAt: new Date() })
        .where(and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)));

      res.json({ photoUrl, photoUrls: nextUrls });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/estimates/:estimateId/line-items/:lineItemId/photo", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const targetUrl = typeof req.query.url === "string" ? req.query.url : null;

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)),
      });
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      const currentUrls = Array.isArray(lineItem.photoUrls) ? lineItem.photoUrls : [];
      const legacyUrl = lineItem.photoUrl;

      let nextUrls: string[];
      let nextLegacy: string | null;

      if (targetUrl) {
        nextUrls = currentUrls.filter((u) => u !== targetUrl);
        if (legacyUrl === targetUrl) {
          nextLegacy = nextUrls.length > 0 ? nextUrls[0] : null;
        } else {
          nextLegacy = legacyUrl;
        }
      } else {
        nextUrls = [];
        nextLegacy = null;
      }

      await db.update(estimateLineItems)
        .set({ photoUrls: nextUrls, photoUrl: nextLegacy, updatedAt: new Date() })
        .where(and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)));
      res.json({ success: true, photoUrls: nextUrls });
    } catch (error) {
      next(error);
    }
  });

  router.put("/api/estimates/:estimateId/line-items/:lineItemId/photos/order", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId, lineItemId } = req.params;
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);
      if (!estimate) return res.status(404).json({ error: "Estimate not found" });

      const body = req.body as { photoUrls?: unknown };
      if (!Array.isArray(body.photoUrls) || !body.photoUrls.every((u) => typeof u === "string")) {
        return res.status(400).json({ error: "photoUrls must be an array of strings" });
      }
      const requested = body.photoUrls as string[];

      const lineItem = await db.query.estimateLineItems.findFirst({
        where: and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)),
      });
      if (!lineItem) return res.status(404).json({ error: "Line item not found" });

      const existingUrls = Array.isArray(lineItem.photoUrls) ? lineItem.photoUrls : [];
      const legacyUrl = lineItem.photoUrl;
      const allowed = new Set<string>(existingUrls);
      if (legacyUrl) allowed.add(legacyUrl);

      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const u of requested) {
        if (!allowed.has(u) || seen.has(u)) continue;
        seen.add(u);
        ordered.push(u);
      }
      if (ordered.length !== allowed.size) {
        return res.status(400).json({ error: "photoUrls must contain exactly the existing photos" });
      }

      const nextLegacy = ordered.length > 0 ? ordered[0] : null;

      await db.update(estimateLineItems)
        .set({ photoUrls: ordered, photoUrl: nextLegacy, updatedAt: new Date() })
        .where(and(eq(estimateLineItems.id, lineItemId), eq(estimateLineItems.estimateId, estimateId)));

      res.json({ success: true, photoUrls: ordered, photoUrl: nextLegacy });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/estimates/line-item-photos/:orgId/:lineItemId/*", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      const { orgId, lineItemId } = req.params;
      const fileName = req.params[0];
      if (req.user!.organizationId && req.user!.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const objectId = `line-item-photos/${orgId}/${lineItemId}/${fileName}`;
      const fullPath = `${privateDir}/${objectId}`;

      const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");

      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      const [exists] = await objectFile.exists();
      if (!exists) return res.status(404).json({ error: "Photo not found" });

      const [metadata] = await objectFile.getMetadata();
      res.setHeader("Content-Type", (metadata.metadata?.contentType as string) || "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      objectFile.createReadStream().pipe(res);
    } catch (error) {
      next(error);
    }
  });

  // Helper: fetch a line item photo buffer for embedding in exports.
  // Only resolves internal `/api/estimates/line-item-photos/...` URLs to prevent SSRF.
  const resolveLineItemPhotoBuffer = async (
    photoUrl: string,
    user: AuthRequest["user"],
  ): Promise<{ buffer: Buffer; contentType?: string } | null> => {
    try {
      const match = photoUrl.match(/^\/api\/estimates\/line-item-photos\/([^/]+)\/([^/]+)\/(.+)$/);
      if (!match) return null;
      const [, orgId, lineItemId, fileName] = match;
      if (user!.organizationId && user!.organizationId !== orgId) return null;

      const { objectStorageClient } = await import("./objectStorage");
      const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
      const objectId = `line-item-photos/${orgId}/${lineItemId}/${fileName}`;
      const fullPath = `${privateDir}/${objectId}`;
      const parts = fullPath.startsWith("/") ? fullPath.slice(1).split("/") : fullPath.split("/");
      const bucketName = parts[0];
      const objectName = parts.slice(1).join("/");
      const bucket = objectStorageClient.bucket(bucketName);
      const objectFile = bucket.file(objectName);
      const [exists] = await objectFile.exists();
      if (!exists) return null;
      const [metadata] = await objectFile.getMetadata();
      const [buffer] = await objectFile.download();
      return { buffer, contentType: (metadata.metadata?.contentType as string) || undefined };
    } catch {
      logWarn("estimate export: failed to resolve photo");
      return null;
    }
  };

  const loadEstimateExportContext = async (estimateId: string, user: AuthRequest["user"]) => {
    const estimate = await verifyEstimateOrgAccess(estimateId, user);
    if (!estimate) return null;
    const lineItems = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimateId))
      .orderBy(estimateLineItems.createdAt);
    const totals = lineItems.reduce(
      (acc, item) => ({
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      }),
      {
        materialCost: 0,
        laborCost: 0,
        equipmentCost: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        totalCost: 0,
      },
    );
    let title = "Project Estimate";
    let subtitle: string | undefined;
    let code: string | undefined;
    let clientName: string | undefined;
    if (estimate.bidId) {
      const bid = await db.query.bids.findFirst({ where: eq(bids.id, estimate.bidId) });
      if (bid) {
        title = `Bid Estimate — ${bid.name}`;
        subtitle = bid.code;
        code = bid.code;
        clientName = bid.clientName ?? undefined;
      }
    } else if (estimate.projectId) {
      const project = await db.query.projects.findFirst({ where: eq(projects.id, estimate.projectId) });
      if (project) {
        title = `Project Estimate — ${project.name}`;
        subtitle = project.code;
        code = project.code;
        clientName = project.clientName ?? undefined;
      }
    }
    let branding: { organizationName?: string; primaryColor?: string } | undefined;
    if (user!.organizationId) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, user!.organizationId),
      });
      if (org) {
        branding = {
          organizationName: org.name,
          primaryColor: org.primaryColor ?? undefined,
        };
      }
    }
    return { estimate, lineItems, totals, context: { title, subtitle, code, clientName }, branding };
  };

  // Export estimate as PDF (with embedded line item photos)
  router.get("/api/estimates/:estimateId/export/pdf", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to export estimates" });
      }
      const { estimateId } = req.params;
      const ctx = await loadEstimateExportContext(estimateId, req.user);
      if (!ctx) return res.status(404).json({ error: "Estimate not found" });

      const includeFormulas = req.query.includeFormulas === "true"
        || req.query.includeFormulas === "1";

      const { generateEstimatePdf } = await import("./estimate-pdf-service");
      const pdfBuffer = await generateEstimatePdf({
        estimate: {
          id: ctx.estimate.id,
          versionNumber: ctx.estimate.versionNumber,
          status: ctx.estimate.status,
          notes: ctx.estimate.notes,
        },
        context: ctx.context,
        lineItems: ctx.lineItems.map((li) => ({
          id: li.id,
          description: li.description,
          category: li.category,
          quantity: li.quantity,
          unit: li.unit,
          totalCost: li.totalCost,
          materialCost: li.materialCost,
          laborCost: li.laborCost,
          equipmentCost: li.equipmentCost,
          subcontractCost: li.subcontractCost,
          notes: li.notes,
          photoUrls: Array.isArray(li.photoUrls) ? li.photoUrls : [],
          photoUrl: li.photoUrl ?? null,
          // Material calculator inputs / results — used by the optional
          // step-by-step formula breakdown section in the PDF.
          concreteDepthInches: li.concreteDepthInches,
          dimensionWidthInches: li.dimensionWidthInches,
          dimensionHeightInches: li.dimensionHeightInches,
          concreteWasteFactor: li.concreteWasteFactor,
          calculatedConcreteYards: li.calculatedConcreteYards,
          requiresStoneBase: li.requiresStoneBase,
          stoneType: li.stoneType,
          stoneDepthInches: li.stoneDepthInches,
          stoneWasteFactor: li.stoneWasteFactor,
          calculatedStoneTons: li.calculatedStoneTons,
          requiresExcavation: li.requiresExcavation,
          excavationDepthInches: li.excavationDepthInches,
          excavationWidthInches: li.excavationWidthInches,
          excavationSwellFactor: li.excavationSwellFactor,
          calculatedExcavationYards: li.calculatedExcavationYards,
          requiresWireMesh: li.requiresWireMesh,
          wireMeshCoverageSF: li.wireMeshCoverageSF,
          wireMeshWasteFactor: li.wireMeshWasteFactor,
          calculatedWireMeshRolls: li.calculatedWireMeshRolls,
          requiresRebar: li.requiresRebar,
          rebarSpacingInches: li.rebarSpacingInches,
          rebarLengthFeet: li.rebarLengthFeet,
          rebarWasteFactor: li.rebarWasteFactor,
          calculatedRebarCount: li.calculatedRebarCount,
          calculatedRebarLinearFeet: li.calculatedRebarLinearFeet,
          requiresDowels: li.requiresDowels,
          dowelSpacingInches: li.dowelSpacingInches,
          jointLengthFeet: li.jointLengthFeet,
          calculatedDowelCount: li.calculatedDowelCount,
          requiresSealer: li.requiresSealer,
          sealerCoverageSFPerGallon: li.sealerCoverageSFPerGallon,
          sealerCoats: li.sealerCoats,
          sealerWasteFactor: li.sealerWasteFactor,
          calculatedSealerGallons: li.calculatedSealerGallons,
          requiresUnderlayment: li.requiresUnderlayment,
          underlaymentOverlapInches: li.underlaymentOverlapInches,
          underlaymentWasteFactor: li.underlaymentWasteFactor,
          calculatedUnderlaymentSF: li.calculatedUnderlaymentSF,
        })),
        totals: ctx.totals,
        branding: ctx.branding,
        includeFormulas,
        resolvePhoto: (url) => resolveLineItemPhotoBuffer(url, req.user),
      });

      const filename = `estimate-${ctx.context.code || ctx.estimate.id}-v${ctx.estimate.versionNumber}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (error) {
      logError("estimate pdf export failed", undefined, error as Error);
      next(error);
    }
  });

  // Export estimate as Excel (XLSX) with per-line-item photo URLs
  router.get("/api/estimates/:estimateId/export/excel", requireAuth, async (req: AuthRequest, res, next) => {
    try {
      if (!hasManagementAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions to export estimates" });
      }
      const { estimateId } = req.params;
      const ctx = await loadEstimateExportContext(estimateId, req.user);
      if (!ctx) return res.status(404).json({ error: "Estimate not found" });

      const includeFormulas = req.query.includeFormulas === "true"
        || req.query.includeFormulas === "1";

      const XLSX = await import("xlsx");

      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
      const host = req.get("host") || "";
      const baseUrl = host ? `${protocol}://${host}` : "";

      const rows = ctx.lineItems.map((li) => {
        const urls: string[] = [
          ...(li.photoUrl ? [li.photoUrl] : []),
          ...(li.photoUrls ?? []),
        ];
        const unique: string[] = [];
        for (const u of urls) if (u && !unique.includes(u)) unique.push(u);
        const absolute = unique.map((u) => (u.startsWith("http") ? u : `${baseUrl}${u}`));
        return {
          Description: li.description,
          Category: li.category,
          Quantity: Number(li.quantity || 0),
          Unit: li.unit || "",
          "Material Cost": Number(li.materialCost || 0),
          "Labor Cost": Number(li.laborCost || 0),
          "Equipment Cost": Number(li.equipmentCost || 0),
          "Subcontract Cost": Number(li.subcontractCost || 0),
          "Overhead": Number(li.overheadAllocation || 0),
          "Profit": Number(li.profitAllocation || 0),
          "Total Cost": Number(li.totalCost || 0),
          Notes: li.notes || "",
          "Photo Count": unique.length,
          "Photo URLs": absolute.join("\n"),
        };
      });

      const wb = XLSX.utils.book_new();
      const itemsSheet = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, itemsSheet, "Line Items");

      const summaryRows = [
        ["Estimate", ctx.estimate.id],
        ["Version", ctx.estimate.versionNumber],
        ["Status", ctx.estimate.status],
        ["Title", ctx.context.title],
        ["Code", ctx.context.code || ""],
        ["Client", ctx.context.clientName || ""],
        ["Generated", new Date().toISOString()],
        [],
        ["Material Cost", ctx.totals.materialCost],
        ["Labor Cost", ctx.totals.laborCost],
        ["Equipment Cost", ctx.totals.equipmentCost],
        ["Subcontract Cost", ctx.totals.subcontractCost],
        ["Overhead", ctx.totals.overheadAllocation],
        ["Profit", ctx.totals.profitAllocation],
        ["Total", ctx.totals.totalCost],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

      const photoRows: Array<{ "Line Item": string; Category: string; "Photo URL": string }> = [];
      for (const li of ctx.lineItems) {
        const urls: string[] = [
          ...(li.photoUrl ? [li.photoUrl] : []),
          ...(li.photoUrls ?? []),
        ];
        const unique: string[] = [];
        for (const u of urls) if (u && !unique.includes(u)) unique.push(u);
        for (const u of unique) {
          photoRows.push({
            "Line Item": li.description,
            Category: li.category,
            "Photo URL": u.startsWith("http") ? u : `${baseUrl}${u}`,
          });
        }
      }
      if (photoRows.length > 0) {
        const photosSheet = XLSX.utils.json_to_sheet(photoRows);
        XLSX.utils.book_append_sheet(wb, photosSheet, "Photos");
      }

      if (includeFormulas) {
        const { buildLineItemFormulaBreakdowns } = await import(
          "./materialFormulaBreakdown"
        );
        const breakdownRows: Array<Record<string, string | number>> = [];
        for (const li of ctx.lineItems) {
          const blocks = buildLineItemFormulaBreakdowns({
            quantity: li.quantity,
            unit: li.unit,
            concreteDepthInches: li.concreteDepthInches,
            dimensionWidthInches: li.dimensionWidthInches,
            dimensionHeightInches: li.dimensionHeightInches,
            concreteWasteFactor: li.concreteWasteFactor,
            calculatedConcreteYards: li.calculatedConcreteYards,
            requiresStoneBase: li.requiresStoneBase,
            stoneType: li.stoneType,
            stoneDepthInches: li.stoneDepthInches,
            stoneWasteFactor: li.stoneWasteFactor,
            calculatedStoneTons: li.calculatedStoneTons,
            requiresExcavation: li.requiresExcavation,
            excavationDepthInches: li.excavationDepthInches,
            excavationWidthInches: li.excavationWidthInches,
            excavationSwellFactor: li.excavationSwellFactor,
            calculatedExcavationYards: li.calculatedExcavationYards,
            requiresWireMesh: li.requiresWireMesh,
            wireMeshCoverageSF: li.wireMeshCoverageSF,
            wireMeshWasteFactor: li.wireMeshWasteFactor,
            calculatedWireMeshRolls: li.calculatedWireMeshRolls,
            requiresRebar: li.requiresRebar,
            rebarSpacingInches: li.rebarSpacingInches,
            rebarLengthFeet: li.rebarLengthFeet,
            rebarWasteFactor: li.rebarWasteFactor,
            calculatedRebarCount: li.calculatedRebarCount,
            calculatedRebarLinearFeet: li.calculatedRebarLinearFeet,
            requiresDowels: li.requiresDowels,
            dowelSpacingInches: li.dowelSpacingInches,
            jointLengthFeet: li.jointLengthFeet,
            calculatedDowelCount: li.calculatedDowelCount,
            requiresSealer: li.requiresSealer,
            sealerCoverageSFPerGallon: li.sealerCoverageSFPerGallon,
            sealerCoats: li.sealerCoats,
            sealerWasteFactor: li.sealerWasteFactor,
            calculatedSealerGallons: li.calculatedSealerGallons,
            requiresUnderlayment: li.requiresUnderlayment,
            underlaymentOverlapInches: li.underlaymentOverlapInches,
            underlaymentWasteFactor: li.underlaymentWasteFactor,
            calculatedUnderlaymentSF: li.calculatedUnderlaymentSF,
          });
          for (const block of blocks) {
            const lastIdx = block.steps.length - 1;
            block.steps.forEach((step, idx) => {
              breakdownRows.push({
                "Line Item": li.description,
                "Section": block.title,
                "Formula": block.formula,
                "Step #": idx + 1,
                "Label": step.label,
                "Calculation": step.calculation ?? "",
                "Value": step.value,
                "Result": idx === lastIdx ? block.result : "",
                "Unit": idx === lastIdx ? block.resultUnit : "",
              });
            });
          }
        }
        if (breakdownRows.length > 0) {
          const breakdownSheet = XLSX.utils.json_to_sheet(breakdownRows, {
            header: [
              "Line Item",
              "Section",
              "Formula",
              "Step #",
              "Label",
              "Calculation",
              "Value",
              "Result",
              "Unit",
            ],
          });
          XLSX.utils.book_append_sheet(wb, breakdownSheet, "Calculation Breakdowns");
        } else {
          // Always emit the sheet when the user opted in so the workbook
          // reflects their toggle choice; an empty sheet with the header
          // makes it clear no line items had calculator inputs.
          const emptySheet = XLSX.utils.aoa_to_sheet([
            [
              "Line Item",
              "Section",
              "Formula",
              "Step #",
              "Label",
              "Calculation",
              "Value",
              "Result",
              "Unit",
            ],
            ["(no line items have material calculator inputs)"],
          ]);
          XLSX.utils.book_append_sheet(wb, emptySheet, "Calculation Breakdowns");
        }
      }

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const filename = `estimate-${ctx.context.code || ctx.estimate.id}-v${ctx.estimate.versionNumber}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(buf);
    } catch (error) {
      logError("estimate excel export failed", undefined, error as Error);
      next(error);
    }
  });

  // Get subcontractor assignments for a line item
  router.get("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors", requireAuth, async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  // Set subcontractor assignments for a line item (replaces all existing)
  router.post("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  // Delete a single subcontractor assignment
  router.delete("/api/estimates/:estimateId/line-items/:lineItemId/subcontractors/:assignmentId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  // Get estimate version history
  router.get("/api/bids/:code/estimates/:estimateId/versions", requireAuth, async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  // Get a specific estimate version snapshot
  router.get("/api/bids/:code/estimates/:estimateId/versions/:versionId", requireAuth, async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  // Approve estimate and sync to project budget, create procurement items and scope items
  router.post("/api/estimates/:estimateId/approve", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId } = req.params;
      const userId = req.user!.id;
      const { createProcurement = true, createScopeItems = true } = req.body;

      // Check if user has estimate access (ADMIN, MANAGER, ESTIMATOR only)
      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate (org-scoped)
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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

        logInfo(`[Estimate Approval] Created ${procurementItemsCreated} procurement items and ${scopeItemsCreated} scope items for project ${estimate.projectId}`);
        
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
      next(error);
    }
  });

  // AI CFO estimate analysis
  router.post("/api/estimates/:estimateId/analyze", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
    try {
      const { estimateId } = req.params;

      if (!hasEstimateAccess(req.user!.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Get estimate and project data (org-scoped)
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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
        // Task #2423 — route through provider abstraction so Claude can take
        // over for orgs with AI_PROVIDER_TAKEOFF on, and so the prior-context
        // bridge stitches this analysis into the rest of the estimate session.
        fn: async () => {
          const completion = await routedChatCompletion({
            orgId: govOrgId,
            featureKey: "estimation.analyze",
            priorContext: { orgId: govOrgId, scopeId: `estimate:${estimateId}` },
            request: {
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
            max_completion_tokens: 1500,
            },
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
      next(error);
    }
  });

  router.get("/api/estimates/production-rates/suggestions", requireAuth, async (req: AuthRequest, res, next) => {
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

  router.get("/api/estimates/production-rates/lookup", requireAuth, async (req: AuthRequest, res, next) => {
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
  router.get("/api/estimates/production-rates/by-sow-item/:sowItemId", requireAuth, async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  });

  router.post("/api/estimates/:estimateId/line-items/auto-populate-labor", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
  router.post("/api/estimates/:estimateId/line-items/:lineItemId/sync-materials", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

      // Verify estimate exists AND owned by caller's org
      const estimate = await verifyEstimateOrgAccess(estimateId, req.user);

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

      logInfo(`[MaterialSync] Synced material data for line item ${lineItemId}`);

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
      next(error);
    }
  });

router.get("/api/historical-costs", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.get("/api/historical-costs/aggregated", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/historical-costs", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    const data = parseOrRespond(insertHistoricalCostSchema, body, res);
    if (!data) return;
    const [result] = await db.insert(historicalCosts).values(data).returning();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/historical-costs/:id", requireAuth, requireRole("ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthorized" });
    if (!hasManagementAccess(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });

    const { historicalCosts } = await import("@shared/schema");
    await db.delete(historicalCosts)
      .where(and(eq(historicalCosts.id, req.params.id), eq(historicalCosts.organizationId, orgId)));
    successResponse(res);
  } catch (error) {
    next(error);
  }
});

router.post("/api/estimates/:estimateId/insert-assembly", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { estimateId } = req.params;
    const { assemblyId, quantity: baseQuantity } = req.body;

    if (!assemblyId) return res.status(400).json({ error: "assemblyId is required" });

    if (!hasEstimateAccess(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // Verify estimate exists AND owned by caller's org
    // (works for both bid-linked and project-linked estimates)
    const estimate = await verifyEstimateOrgAccess(estimateId, req.user);
    if (!estimate) {
      return res.status(404).json({ error: "Estimate not found" });
    }

    const { libraryAssemblies, libraryAssemblyItems } = await import("@shared/schema");

    const [assembly] = await db.select().from(libraryAssemblies)
      .where(and(eq(libraryAssemblies.id, assemblyId), eq(libraryAssemblies.organizationId, req.user!.organizationId!)));
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
    next(error);
  }
});

/**
 * GET /api/estimates
 * List all estimates for the authenticated org, with bid/project label.
 * Used by SendToEstimateDialog when no specific bid/project context is provided.
 */
router.get("/api/estimates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgIdForFilter(req);
    const rows = await db
      .select({
        id: estimates.id,
        versionNumber: estimates.versionNumber,
        status: estimates.status,
        bidName: bids.name,
        projectName: projects.name,
      })
      .from(estimates)
      .leftJoin(bids, eq(estimates.bidId, bids.id))
      .leftJoin(projects, eq(estimates.projectId, projects.id))
      .where(or(eq(bids.gcOrganizationId, orgId), eq(projects.gcOrganizationId, orgId)))
      .orderBy(desc(estimates.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.bidName
          ? `${r.bidName} — v${r.versionNumber}`
          : r.projectName
          ? `${r.projectName} — v${r.versionNumber}`
          : `Estimate v${r.versionNumber}`,
        status: r.status,
      })),
    );
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/bids/:code/estimates
 * List estimates for a specific bid (documented in swagger, now implemented).
 */
router.get("/api/bids/:code/estimates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgIdForFilter(req);
    const [bid] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.code, req.params.code), eq(bids.gcOrganizationId, orgId)))
      .limit(1);

    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    const rows = await db
      .select({
        id: estimates.id,
        versionNumber: estimates.versionNumber,
        status: estimates.status,
      })
      .from(estimates)
      .where(eq(estimates.bidId, bid.id))
      .orderBy(desc(estimates.versionNumber));

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: `${bid.name} — v${r.versionNumber}`,
        status: r.status,
      })),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/api/estimates/:estimateId/match-review", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const lineItems = await db.select({
      id: estimateLineItems.id,
      description: estimateLineItems.description,
      quantity: estimateLineItems.quantity,
      unit: estimateLineItems.unit,
      vendorPricingId: estimateLineItems.vendorPricingId,
      vendorMatchConfidence: estimateLineItems.vendorMatchConfidence,
      materialCost: estimateLineItems.materialCost,
      totalCost: estimateLineItems.totalCost,
    })
    .from(estimateLineItems)
    .innerJoin(estimates, eq(estimates.id, estimateLineItems.estimateId))
    .leftJoin(projects, eq(projects.id, estimates.projectId))
    .leftJoin(bids, eq(bids.id, estimates.bidId))
    .where(and(
      eq(estimateLineItems.estimateId, req.params.estimateId),
      or(
        eq(projects.gcOrganizationId, organizationId),
        eq(bids.gcOrganizationId, organizationId),
      ),
      sql`${estimateLineItems.vendorMatchConfidence} IN ('LOW', 'FUZZY', 'NO_MATCH')`
    ))
    .orderBy(estimateLineItems.vendorMatchConfidence);

    const catalogItems = await db.select({
      id: vendorPricingCatalogs.id,
      itemName: vendorPricingCatalogs.itemName,
      itemCode: vendorPricingCatalogs.itemCode,
      category: vendorPricingCatalogs.category,
      unit: vendorPricingCatalogs.unit,
      unitPrice: vendorPricingCatalogs.unitPrice,
    })
    .from(vendorPricingCatalogs)
    .where(eq(vendorPricingCatalogs.organizationId, organizationId));

    const reviewItems = lineItems.map(li => {
      const desc = (li.description || "").toLowerCase().trim();
      const alternatives = catalogItems
        .map(cat => {
          const catName = (cat.itemName || "").toLowerCase().trim();
          const stringSim = normalizedSimilarity(desc, catName);
          const tokenSim = tokenOverlapScore(desc, catName);
          const score = stringSim * 0.6 + tokenSim * 0.4;
          return { ...cat, unitPrice: Number(cat.unitPrice), score: Math.round(score * 100) };
        })
        .filter(c => c.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      return {
        ...li,
        alternatives,
      };
    });

    res.json({ items: reviewItems });
  } catch (error) {
    next(error);
  }
});

router.post("/api/estimates/:estimateId/match-review/:lineItemId/accept", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!hasEstimateAccess(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const { vendorPricingId } = req.body;
    if (!vendorPricingId) {
      return res.status(400).json({ error: "vendorPricingId required" });
    }

    const [estimateRow] = await db.select({ estimate: estimates })
      .from(estimates)
      .leftJoin(projects, eq(projects.id, estimates.projectId))
      .leftJoin(bids, eq(bids.id, estimates.bidId))
      .where(and(
        eq(estimates.id, req.params.estimateId),
        or(
          eq(projects.gcOrganizationId, organizationId),
          eq(bids.gcOrganizationId, organizationId),
        ),
      )).limit(1);
    const estimate = estimateRow?.estimate;
    if (!estimate) return res.status(404).json({ error: "Estimate not found" });

    const [catalogItem] = await db.select().from(vendorPricingCatalogs).where(and(eq(vendorPricingCatalogs.id, vendorPricingId), eq(vendorPricingCatalogs.organizationId, organizationId))).limit(1);
    if (!catalogItem) return res.status(404).json({ error: "Catalog item not found" });

    const unitPrice = Number(catalogItem.unitPrice) || 0;

    const [lineItem] = await db.select().from(estimateLineItems)
      .where(and(eq(estimateLineItems.id, req.params.lineItemId), eq(estimateLineItems.estimateId, req.params.estimateId))).limit(1);
    if (!lineItem) return res.status(404).json({ error: "Line item not found" });

    const qty = Number(lineItem.quantity) || 0;
    const materialCost = parseFloat((unitPrice * qty).toFixed(2));
    const totalCost = parseFloat((materialCost + Number(lineItem.laborCost || 0) + Number(lineItem.equipmentCost || 0) + Number(lineItem.consumablesCost || 0) + Number(lineItem.subcontractCost || 0)).toFixed(2));

    await db.update(estimateLineItems)
      .set({
        vendorPricingId,
        vendorMatchConfidence: "HIGH",
        materialCost: materialCost.toFixed(2),
        totalCost: totalCost.toFixed(2),
      })
      .where(eq(estimateLineItems.id, req.params.lineItemId));

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
