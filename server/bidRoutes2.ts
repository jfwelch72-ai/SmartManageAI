import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import {
  bids, estimates, estimateLineItems, projects, users,
  insertBidSchema, scopeItems,
  subcontractors, subcontractorContracts,
  bidEquipmentSelections, bidDocuments,
} from "@shared/schema";
import { eq, desc, inArray, sql, and, or } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logUpdate, logDelete, logAudit } from "./auditLogger";
import { sanitizeShortText, sanitizeText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { generateInternalBidSummaryPDF, generateCustomerQuotePDF } from "./pdf-service";
import { sendEmail } from "./email";

const router = Router();

function validateMonetaryAmount(amount: string | number | null | undefined, fieldName: string): { valid: boolean; error?: string } {
  if (amount === null || amount === undefined) {
    return { valid: true };
  }
  
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  
  if (numAmount <= 0) {
    return { valid: false, error: `${fieldName} must be a positive value (greater than zero)` };
  }
  
  if (numAmount > 100000000) {
    return { valid: false, error: `${fieldName} exceeds maximum allowed value ($100,000,000)` };
  }
  
  return { valid: true };
}

// ====================
// Bid Routes
// ====================

const createBidSchema = insertBidSchema.omit({ code: true }).extend({
  dueDate: z.preprocess(
    (val) => {
      if (!val) return undefined;
      return typeof val === "string" ? new Date(val) : val;
    },
    z.date().nullish()
  ),
});

const BID_CODE_START = 260001;
async function getNextBidCode(): Promise<string> {
  const result = await db.execute(sql`
    SELECT GREATEST(
      COALESCE((
        SELECT MAX(CAST(code AS INTEGER))
        FROM bids 
        WHERE code ~ '^[0-9]+$' 
        AND CAST(code AS INTEGER) >= ${BID_CODE_START}
      ), ${BID_CODE_START - 1}),
      COALESCE((
        SELECT MAX(CAST(code AS INTEGER))
        FROM projects 
        WHERE code ~ '^[0-9]+$' 
        AND CAST(code AS INTEGER) >= ${BID_CODE_START}
      ), ${BID_CODE_START - 1})
    ) as max_code
  `);
  
  const maxCode = Number(result.rows[0]?.max_code) || BID_CODE_START - 1;
  return String(maxCode + 1);
}

const updateBidSchema = insertBidSchema.extend({
  dueDate: z.preprocess(
    (val) => typeof val === "string" ? new Date(val) : val,
    z.date().nullish()
  ),
}).partial();

router.get("/api/bids", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    if (mustDenyAccess) {
      return res.json([]);
    }
    
    let allBids;
    if (shouldFilter && orgId) {
      allBids = await db
        .select({
          bid: bids,
          estimatorName: sql<string | null>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('estimator_name'),
        })
        .from(bids)
        .leftJoin(users, eq(bids.estimatorId, users.id))
        .where(eq(bids.gcOrganizationId, orgId))
        .orderBy(bids.createdAt);
    } else {
      allBids = await db
        .select({
          bid: bids,
          estimatorName: sql<string | null>`CONCAT(${users.firstName}, ' ', ${users.lastName})`.as('estimator_name'),
        })
        .from(bids)
        .leftJoin(users, eq(bids.estimatorId, users.id))
        .orderBy(bids.createdAt);
    }
    
    const bidsWithEstimatorNames = allBids.map(({ bid, estimatorName }) => ({
      ...bid,
      estimatorName: estimatorName || null,
    }));
    
    if (bidsWithEstimatorNames.length === 0) {
      res.json([]);
      return;
    }

    const bidIds = bidsWithEstimatorNames.map(bid => bid.id);
    
    const estimateResults = await db
      .select({
        bidId: estimates.bidId,
        estimateId: estimates.id,
        status: estimates.status,
        createdAt: estimates.createdAt,
      })
      .from(estimates)
      .where(inArray(estimates.bidId, bidIds))
      .orderBy(desc(estimates.createdAt));
    
    const latestEstimatesByBid = new Map<string, { estimateId: string; status: string }>();
    for (const est of estimateResults) {
      if (est.bidId && !latestEstimatesByBid.has(est.bidId)) {
        latestEstimatesByBid.set(est.bidId, { estimateId: est.estimateId, status: est.status });
      }
    }
    
    const latestEstimateIds = Array.from(latestEstimatesByBid.values()).map(e => e.estimateId);
    
    let lineItemSummaries: Array<{ estimateId: string; totalCost: number; lineItemCount: number }> = [];
    if (latestEstimateIds.length > 0) {
      lineItemSummaries = await db
        .select({
          estimateId: estimateLineItems.estimateId,
          totalCost: sql<number>`
            SUM(
              COALESCE(CAST(${estimateLineItems.materialCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.laborCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.equipmentCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.consumablesCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.subcontractCost} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.overheadAllocation} AS NUMERIC), 0) +
              COALESCE(CAST(${estimateLineItems.profitAllocation} AS NUMERIC), 0)
            )
          `.as('total_cost'),
          lineItemCount: sql<number>`COUNT(*)`.as('line_item_count'),
        })
        .from(estimateLineItems)
        .where(inArray(estimateLineItems.estimateId, latestEstimateIds))
        .groupBy(estimateLineItems.estimateId);
    }
    
    const lineItemMap = new Map(
      lineItemSummaries.map(s => [s.estimateId, { totalCost: Number(s.totalCost) || 0, lineItemCount: Number(s.lineItemCount) || 0 }])
    );
    
    const estimateMap = new Map<string, { totalCost: number; lineItemCount: number; status: string }>();
    latestEstimatesByBid.forEach((est, bidId) => {
      const lineItemData = lineItemMap.get(est.estimateId) || { totalCost: 0, lineItemCount: 0 };
      estimateMap.set(bidId, {
        totalCost: lineItemData.totalCost,
        lineItemCount: lineItemData.lineItemCount,
        status: est.status,
      });
    });

    const bidsWithEstimates = bidsWithEstimatorNames.map(bid => ({
      ...bid,
      estimateSummary: estimateMap.get(bid.id) || null,
    }));

    res.json(bidsWithEstimates);
  } catch (error) {
    console.error("Get bids error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    res.json(bid);
  } catch (error) {
    console.error("Get bid error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    console.log("[Create Bid] Received body:", JSON.stringify(req.body, null, 2));

    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      clientName: sanitizeShortText(req.body.clientName),
      description: sanitizeText(req.body.description),
    };

    console.log("[Create Bid] Sanitized body:", JSON.stringify(sanitizedBody, null, 2));

    const validationResult = createBidSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      console.log("[Create Bid] Validation failed:", JSON.stringify(validationResult.error.errors, null, 2));
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.bidAmount !== undefined) {
      const amountCheck = validateMonetaryAmount(validationResult.data.bidAmount, "Bid amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }
    }

    const MAX_RETRIES = 3;
    let lastError: any = null;
    
    const userOrgId = req.user?.organizationId;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const nextCode = await getNextBidCode();
        console.log(`[Create Bid] Auto-assigned code: ${nextCode} (attempt ${attempt + 1})`);

        const [newBid] = await db.insert(bids).values({
          ...validationResult.data,
          code: nextCode,
          gcOrganizationId: userOrgId || validationResult.data.gcOrganizationId,
        }).returning();

        if (newBid.status === "SUBMITTED") {
          await eventBus.emit({
            type: "bid.submitted",
            version: 1,
            orgId: newBid.gcOrganizationId || userOrgId || "",
            actorId: req.user!.id,
            timestamp: new Date(),
            payload: {
              bidId: newBid.id,
              bidCode: newBid.code,
              title: newBid.name,
              clientName: newBid.clientName || "",
            },
          });
        }

        res.status(201).json(newBid);
        return;
      } catch (insertError: any) {
        if (insertError.code === '23505' && attempt < MAX_RETRIES - 1) {
          console.log(`[Create Bid] Code conflict, retrying... (attempt ${attempt + 1})`);
          lastError = insertError;
          continue;
        }
        throw insertError;
      }
    }
    
    throw lastError;
  } catch (error: any) {
    console.error("Create bid error:", error);
    if (error.code === '23505') {
      res.status(409).json({ error: "Unable to generate unique bid code - please try again" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [existingBid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!existingBid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, existingBid.gcOrganizationId)) return;

    const sanitizedBody = {
      ...req.body,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      clientName: req.body.clientName ? sanitizeShortText(req.body.clientName) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validationResult = updateBidSchema.safeParse(sanitizedBody);
    
    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    if (validationResult.data.bidAmount !== undefined) {
      const amountCheck = validateMonetaryAmount(validationResult.data.bidAmount, "Bid amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }
    }

    const updateData: any = { ...validationResult.data, updatedAt: new Date() };
    
    const [updatedBid] = await db
      .update(bids)
      .set(updateData)
      .where(eq(bids.code, req.params.code))
      .returning();

    if (!updatedBid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    await logUpdate(req.user!.id, "BID", updatedBid.id, existingBid, updateData, req);

    res.json(updatedBid);
  } catch (error: any) {
    console.error("Update bid error:", error);
    if (error.code === '23505') {
      res.status(409).json({ error: "Bid code already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const [existingProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, bid.code))
      .limit(1);
    
    if (existingProject) {
      res.status(409).json({ 
        error: "Cannot delete converted bid",
        newValue: `This bid has been converted to project ${bid.code}. Delete the project first if needed.`
      });
      return;
    }

    const { handoffPackets } = await import("@shared/schema");
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const { bidMaterialQuotes } = await import("@shared/schema");

    await db.delete(handoffPackets).where(eq(handoffPackets.bidId, bid.id));
    
    await db.delete(bidSubcontractorQuotes).where(eq(bidSubcontractorQuotes.bidId, bid.id));
    
    await db.delete(bidMaterialQuotes).where(eq(bidMaterialQuotes.bidId, bid.id));
    
    const bidEstimates = await db.select().from(estimates).where(eq(estimates.bidId, bid.id));
    for (const estimate of bidEstimates) {
      await db.delete(estimateLineItems).where(eq(estimateLineItems.estimateId, estimate.id));
    }
    await db.delete(estimates).where(eq(estimates.bidId, bid.id));

    const [deletedBid] = await db
      .delete(bids)
      .where(eq(bids.code, req.params.code))
      .returning();

    await logDelete(req.user!.id, "bids", bid.id, { code: bid.code, name: bid.name }, req);

    res.json({ success: true, message: `Bid ${bid.code} deleted successfully` });
  } catch (error) {
    console.error("Delete bid error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:id/estimate", requireAuth, async (req: AuthRequest, res) => {
  try {
    const bidId = req.params.id;
    console.log(`[GET /api/bids/:id/estimate] Fetching estimate for bid ID: ${bidId}`);
    
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
    
    const bidEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .orderBy(desc(estimates.versionNumber));
    
    if (bidEstimates.length === 0) {
      res.json({ estimate: null });
      return;
    }
    
    const activeEstimate = bidEstimates.find(e => e.status === "APPROVED") || bidEstimates[0];
    
    const lineItems = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, activeEstimate.id));
    
    const totals = lineItems.reduce((acc, item) => ({
      materialCost: acc.materialCost + Number(item.materialCost || 0),
      laborCost: acc.laborCost + Number(item.laborCost || 0),
      laborHours: acc.laborHours + Number(item.laborHours || 0),
      equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
      consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
      subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
      overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
      profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
      totalCost: acc.totalCost + Number(item.totalCost || 0),
    }), {
      materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
      consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
      profitAllocation: 0, totalCost: 0,
    });
    
    res.json({
      estimate: {
        ...activeEstimate,
        lineItems,
        totals,
      }
    });
  } catch (error) {
    console.error("Get bid estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bidId = req.params.id;
    console.log(`[POST /api/bids/:id/estimate] Creating estimate for bid ID: ${bidId}`);
    
    const [bid] = await db.select().from(bids).where(eq(bids.id, bidId)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;
    
    const existingEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bidId))
      .limit(1);
    
    if (existingEstimates.length > 0) {
      const estimate = existingEstimates[0];
      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));
      
      const totals = lineItems.reduce((acc, item) => ({
        materialCost: acc.materialCost + Number(item.materialCost || 0),
        laborCost: acc.laborCost + Number(item.laborCost || 0),
        laborHours: acc.laborHours + Number(item.laborHours || 0),
        equipmentCost: acc.equipmentCost + Number(item.equipmentCost || 0),
        consumablesCost: acc.consumablesCost + Number(item.consumablesCost || 0),
        subcontractCost: acc.subcontractCost + Number(item.subcontractCost || 0),
        overheadAllocation: acc.overheadAllocation + Number(item.overheadAllocation || 0),
        profitAllocation: acc.profitAllocation + Number(item.profitAllocation || 0),
        totalCost: acc.totalCost + Number(item.totalCost || 0),
      }), {
        materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
        consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
        profitAllocation: 0, totalCost: 0,
      });
      
      res.json({ estimate: { ...estimate, lineItems, totals } });
      return;
    }
    
    const [newEstimate] = await db.insert(estimates).values({
      bidId: bidId,
      createdById: req.user!.id,
      status: "DRAFT",
      versionNumber: 1,
    }).returning();
    
    console.log(`[Estimate Created] New estimate ${newEstimate.id} created for bid ${bidId}`);
    
    res.status(201).json({
      estimate: {
        ...newEstimate,
        lineItems: [],
        totals: {
          materialCost: 0, laborCost: 0, laborHours: 0, equipmentCost: 0,
          consumablesCost: 0, subcontractCost: 0, overheadAllocation: 0,
          profitAllocation: 0, totalCost: 0,
        }
      }
    });
  } catch (error) {
    console.error("Create bid estimate error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/convert", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    if (bid.status === "AWARDED") {
      res.status(409).json({ 
        error: "Bid already awarded",
        newValue: `This bid has already been converted to a project.`
      });
      return;
    }

    const [existingProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, bid.code))
      .limit(1);

    if (existingProject) {
      res.status(409).json({ 
        error: "Project with this code already exists",
        newValue: `A project with code ${bid.code} already exists. Cannot convert bid.`
      });
      return;
    }

    const bidEstimates = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bid.id));

    console.log(`[Bid Conversion] Found ${bidEstimates.length} estimates to transfer`);

    const { superintendentId, projectManagerId, overheadPercent: bodyOverhead, profitPercent: bodyProfit, startStatus: bodyStartStatus } = req.body || {};
    const OVERHEAD_PERCENT = typeof bodyOverhead === "number" && bodyOverhead >= 0 ? bodyOverhead : 10;
    const PROFIT_MARGIN_PERCENT = typeof bodyProfit === "number" && bodyProfit >= 0 ? bodyProfit : 15;
    const projectStartStatus: "ACTIVE" | "PLANNING" = bodyStartStatus === "PLANNING" ? "PLANNING" : "ACTIVE";
    
    let directCostBudget = "0";
    let contractAmount = bid.bidAmount || "0";
    
    if (bidEstimates.length > 0) {
      const activeEstimate = bidEstimates.find(e => e.status === "APPROVED") || bidEstimates[0];
      
      if (activeEstimate) {
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, activeEstimate.id));
        
        const totalDirectCost = lineItems.reduce((sum, item) => {
          const materialCost = Number(item.materialCost || 0);
          const laborCost = Number(item.laborCost || 0);
          const equipmentCost = Number(item.equipmentCost || 0);
          const consumablesCost = Number(item.consumablesCost || 0);
          const subcontractCost = Number(item.subcontractCost || 0);
          return sum + materialCost + laborCost + equipmentCost + consumablesCost + subcontractCost;
        }, 0);
        
        if (totalDirectCost > 0) {
          directCostBudget = totalDirectCost.toFixed(2);
          
          const overhead = totalDirectCost * (OVERHEAD_PERCENT / 100);
          const profit = (totalDirectCost + overhead) * (PROFIT_MARGIN_PERCENT / 100);
          const totalContract = totalDirectCost + overhead + profit;
          
          if (!bid.bidAmount) {
            contractAmount = totalContract.toFixed(2);
          }
          
          console.log(`[Bid Conversion] Budget (direct costs): $${directCostBudget}`);
          console.log(`[Bid Conversion] Contract amount (with ${OVERHEAD_PERCENT}% overhead + ${PROFIT_MARGIN_PERCENT}% profit): $${contractAmount}`);
        }
      }
    }
    
    const [newProject] = await db.insert(projects).values({
      name: bid.name,
      code: bid.code,
      clientName: bid.clientName,
      clientContactName: bid.clientContactName,
      clientContactEmail: bid.clientContactEmail,
      clientContactPhone: bid.clientContactPhone,
      status: projectStartStatus,
      locationAddress: bid.locationAddress,
      city: bid.city,
      state: bid.state,
      description: bid.description,
      estimatorId: bid.estimatorId,
      superintendentId: superintendentId || null,
      projectManagerId: projectManagerId || null,
      contractAmount: contractAmount,
      budget: directCostBudget,
      gcOrganizationId: bid.gcOrganizationId,
    }).returning();

    for (const estimate of bidEstimates) {
      await db
        .update(estimates)
        .set({ projectId: newProject.id })
        .where(eq(estimates.id, estimate.id));

      const lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));

      console.log(`[Bid Conversion] Syncing ${lineItems.length} line items to scope of work`);

      const { projectMaterialBudgets } = await import("@shared/schema");
      
      for (const lineItem of lineItems) {
        const existingScopeItem = await db.query.scopeItems.findFirst({
          where: eq(scopeItems.estimateLineItemId, lineItem.id),
        });

        if (!existingScopeItem) {
          const lineItemAny = lineItem as any;
          const [newScopeItem] = await db.insert(scopeItems).values({
            projectId: newProject.id,
            estimateLineItemId: lineItem.id,
            organizationSowItemId: lineItemAny.organizationSowItemId || null,
            subcontractorQuoteId: lineItemAny.subcontractorQuoteId || null,
            description: lineItem.description,
            unit: lineItem.unit,
            totalQuantity: lineItem.quantity,
            unitPrice: lineItem.totalCost ? 
              (Number(lineItem.totalCost) / Number(lineItem.quantity)).toFixed(2) : 
              null,
            estimatedConcreteYards: lineItemAny.calculatedConcreteYards || null,
            estimatedStoneTons: lineItemAny.calculatedStoneTons || null,
            estimatedExcavationYards: lineItemAny.calculatedExcavationYards || null,
            materialResponsibility: lineItemAny.subcontractorQuoteId ? "SUBCONTRACTOR" : "TFR",
          }).returning();

          const materialCost = Number(lineItem.materialCost || 0);
          const quantity = Number(lineItem.quantity || 0);
          
          if (materialCost > 0 && quantity > 0) {
            const unitCost = materialCost / quantity;
            await db.insert(projectMaterialBudgets).values({
              projectId: newProject.id,
              scopeItemId: newScopeItem.id,
              estimateLineItemId: lineItem.id,
              description: lineItem.description,
              unit: lineItem.unit,
              budgetedQuantity: lineItem.quantity,
              budgetedUnitCost: unitCost.toFixed(2),
              budgetedTotalCost: materialCost.toFixed(2),
            });
          }
        }
      }
      
      console.log(`[Bid Conversion] Created material budgets for project ${newProject.code}`);
    }

    const { bidSubcontractorQuotes: subQuotesTable } = await import("@shared/schema");
    
    const allSubQuotes = await db
      .select()
      .from(subQuotesTable)
      .where(eq(subQuotesTable.bidId, bid.id));
    
    if (allSubQuotes.length > 0) {
      await db
        .update(subQuotesTable)
        .set({ projectId: newProject.id })
        .where(eq(subQuotesTable.bidId, bid.id));
    }
    
    const subQuotes = allSubQuotes.filter(q => q.isSelected);
    const pendingSubQuotes = allSubQuotes.filter(q => !q.isSelected);

    console.log(`[Bid Conversion] Transferred ${allSubQuotes.length} subcontractor quotes to project (${subQuotes.length} selected, ${pendingSubQuotes.length} pending)`);

    for (const quote of subQuotes) {
      let subcontractor;
      if (quote.contactEmail || quote.contactPhone) {
        const contactConditions = [];
        if (quote.contactEmail) {
          contactConditions.push(eq(subcontractors.email, quote.contactEmail));
        }
        if (quote.contactPhone) {
          contactConditions.push(eq(subcontractors.phone, quote.contactPhone));
        }
        
        subcontractor = await db.query.subcontractors.findFirst({
          where: and(
            eq(subcontractors.companyName, quote.subcontractorName),
            or(...contactConditions)
          ),
        });
      }
      
      if (!subcontractor) {
        subcontractor = await db.query.subcontractors.findFirst({
          where: eq(subcontractors.companyName, quote.subcontractorName),
        });
      }

      if (!subcontractor) {
        [subcontractor] = await db.insert(subcontractors).values({
          companyName: quote.subcontractorName,
          contactName: quote.contactName || null,
          email: quote.contactEmail || null,
          phone: quote.contactPhone || null,
          notes: quote.notes || null,
          isActive: true,
        }).returning();
      }

      const contractNumber = `SC-${newProject.code}-${String(subQuotes.indexOf(quote) + 1).padStart(3, '0')}`;
      const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
      
      const notesParts: string[] = [];
      if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
      if (quote.notes) notesParts.push(quote.notes);
      if (quote.fileUrl) {
        const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
        notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
      }
      
      const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
      
      await db.insert(subcontractorContracts).values({
        subcontractorId: subcontractor.id,
        projectId: newProject.id,
        contractNumber,
        scopeOfWork: quote.scopeOfWork,
        contractAmount: quote.quoteAmount,
        status: "PENDING",
        paymentTerms,
        notes,
        createdById: req.user!.id,
      });
    }

    const { bidMaterialQuotes: matQuotesTable } = await import("@shared/schema");
    const { procurementItems } = await import("@shared/schema");
    
    const allMatQuotes = await db
      .select()
      .from(matQuotesTable)
      .where(eq(matQuotesTable.bidId, bid.id));
    
    if (allMatQuotes.length > 0) {
      await db
        .update(matQuotesTable)
        .set({ projectId: newProject.id })
        .where(eq(matQuotesTable.bidId, bid.id));
    }
    
    const matQuotes = allMatQuotes.filter(q => q.isSelected);
    const pendingMatQuotes = allMatQuotes.filter(q => !q.isSelected);

    console.log(`[Bid Conversion] Transferred ${allMatQuotes.length} material quotes to project (${matQuotes.length} selected, ${pendingMatQuotes.length} pending)`);

    for (const quote of matQuotes) {
      let fullDescription = quote.materialName;
      if (quote.specs) fullDescription += ` - ${quote.specs}`;
      if (quote.description) fullDescription += `\n${quote.description}`;
      
      const additionalInfo: string[] = [];
      if (quote.leadTime) additionalInfo.push(`Lead Time: ${quote.leadTime}`);
      if (quote.supplierContact) additionalInfo.push(`Supplier Contact: ${quote.supplierContact}`);
      
      if (additionalInfo.length > 0) {
        fullDescription += `\n\n[Quote Details]\n${additionalInfo.join('\n')}`;
      }
      
      await db.insert(procurementItems).values({
        projectId: newProject.id,
        description: fullDescription,
        vendor: quote.supplierName || null,
        quantity: "1",
        unit: "LOT",
        unitCost: quote.cost,
        status: "PLANNED",
        neededByDate: null,
      });
    }

    const { handoffPackets: handoffTable } = await import("@shared/schema");
    const [existingPacket] = await db
      .select()
      .from(handoffTable)
      .where(eq(handoffTable.bidId, bid.id))
      .limit(1);
    
    if (existingPacket) {
      await db
        .update(handoffTable)
        .set({ 
          projectId: newProject.id,
          awardDate: new Date().toISOString().split('T')[0],
          updatedAt: new Date()
        })
        .where(eq(handoffTable.id, existingPacket.id));
      
      console.log(`[Bid Conversion] Transferred handoff packet to project`);
    }

    const { bidEquipmentSelections: equipSelectionsTable, projectEquipmentPlans: equipPlansTable } = await import("@shared/schema");
    
    const bidEquipSelections = await db
      .select()
      .from(equipSelectionsTable)
      .where(eq(equipSelectionsTable.bidId, bid.id));
    
    if (bidEquipSelections.length > 0) {
      for (const selection of bidEquipSelections) {
        await db.insert(equipPlansTable).values({
          projectId: newProject.id,
          bidEquipmentSelectionId: selection.id,
          source: selection.source,
          status: "PLANNED",
          equipmentId: selection.equipmentId,
          rentalCatalogId: selection.rentalCatalogId,
          rentalVendorId: selection.rentalVendorId,
          equipmentName: selection.equipmentName,
          equipmentType: selection.equipmentType,
          plannedHours: selection.plannedHours,
          plannedDays: selection.plannedDays,
          plannedStartDate: selection.startDate,
          plannedEndDate: selection.endDate,
          plannedCost: selection.estimatedCost,
          hourlyRate: selection.hourlyRate,
          dailyRate: selection.dailyRate,
          notes: selection.notes,
          createdById: req.user!.id,
        });
      }
      console.log(`[Bid Conversion] Transferred ${bidEquipSelections.length} equipment selections to project equipment plans`);
    }

    await db.update(bids)
      .set({
        status: "AWARDED",
        convertedToProjectId: newProject.id,
        awardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bids.code, req.params.code));

    const { notifications: notificationsTable } = await import("@shared/schema");
    
    if (superintendentId) {
      await db.insert(notificationsTable).values({
        userId: superintendentId,
        type: "PROJECT_ASSIGNMENT",
        title: "New Project Assignment",
        message: `You have been assigned as Superintendent for project "${newProject.name}" (${newProject.code})`,
        relatedEntityId: newProject.id,
        relatedEntityType: "project",
      });
      console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for superintendent ${superintendentId}`);
    }
    
    if (projectManagerId) {
      await db.insert(notificationsTable).values({
        userId: projectManagerId,
        type: "PROJECT_ASSIGNMENT",
        title: "New Project Assignment",
        message: `You have been assigned as Project Manager for project "${newProject.name}" (${newProject.code})`,
        relatedEntityId: newProject.id,
        relatedEntityType: "project",
      });
      console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for project manager ${projectManagerId}`);
    }

    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "project",
      entityId: newProject.id,
      newValue: `Converted bid ${bid.code} to project with ${bidEstimates.length} estimates, ${subQuotes.length} selected subcontractor quotes, ${matQuotes.length} selected material quotes, and ${bidEquipSelections.length} equipment plans`,
    }, req);

    await eventBus.emit({
      type: "bid.converted_to_project",
      version: 1,
      orgId: newProject.gcOrganizationId || req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        bidId: bid.id,
        bidCode: bid.code,
        projectId: newProject.id,
        projectCode: newProject.code,
      },
    });

    res.status(201).json(newProject);
  } catch (error: any) {
    console.error("Convert bid error:", error);
    if (error.code === '23505') {
      res.status(409).json({ error: "Project with this code already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ====================
// Bid Subcontractor Quotes Routes
// ====================

router.get("/api/bids/:code/quotes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");

    const quotes = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.bidId, bid.id))
      .orderBy(desc(bidSubcontractorQuotes.createdAt));

    res.json(quotes);
  } catch (error) {
    console.error("Get bid quotes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes, insertBidSubcontractorQuoteSchema } = await import("@shared/schema");

    const sanitizedBody = {
      ...req.body,
      subcontractorName: sanitizeShortText(req.body.subcontractorName),
      scopeOfWork: sanitizeText(req.body.scopeOfWork),
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      contactName: req.body.contactName ? sanitizeShortText(req.body.contactName) : undefined,
      contactEmail: req.body.contactEmail ? sanitizeEmail(req.body.contactEmail) : undefined,
      contactPhone: req.body.contactPhone ? sanitizePhone(req.body.contactPhone) : undefined,
    };

    const validated = insertBidSubcontractorQuoteSchema.parse({
      ...sanitizedBody,
      bidId: bid.id,
    });

    const [newQuote] = await db.insert(bidSubcontractorQuotes).values(validated).returning();

    await logAudit({
      userId: req.user!.id,
      action: "CREATE_BID_QUOTE",
      entityType: "bid_quote",
      entityId: newQuote.id,
      newValue: `Created quote from ${validated.subcontractorName} for bid ${bid.code}`,
    }, req);

    res.status(201).json(newQuote);
  } catch (error: any) {
    console.error("Create bid quote error:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid quote data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.patch("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");

    const sanitizedBody: any = {
      subcontractorName: req.body.subcontractorName ? sanitizeShortText(req.body.subcontractorName) : undefined,
      scopeOfWork: req.body.scopeOfWork ? sanitizeText(req.body.scopeOfWork) : undefined,
      notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
      contactName: req.body.contactName ? sanitizeShortText(req.body.contactName) : undefined,
      contactEmail: req.body.contactEmail ? sanitizeEmail(req.body.contactEmail) : undefined,
      contactPhone: req.body.contactPhone ? sanitizePhone(req.body.contactPhone) : undefined,
      leadTime: req.body.leadTime !== undefined ? req.body.leadTime : undefined,
      estimatedCompletionTime: req.body.estimatedCompletionTime !== undefined ? req.body.estimatedCompletionTime : undefined,
      quoteAmount: req.body.quoteAmount !== undefined ? req.body.quoteAmount : undefined,
      fileUrl: req.body.fileUrl !== undefined ? req.body.fileUrl : undefined,
      fileName: req.body.fileName !== undefined ? req.body.fileName : undefined,
    };
    
    if (typeof req.body.isSelected === 'boolean') {
      sanitizedBody.isSelected = req.body.isSelected;
    }
    
    Object.keys(sanitizedBody).forEach(key => {
      if (sanitizedBody[key] === undefined) {
        delete sanitizedBody[key];
      }
    });

    const validated = sanitizedBody;

    const [existing] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    if (existing.bidId !== bid.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [updated] = await db
      .update(bidSubcontractorQuotes)
      .set({ ...validated, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE_BID_QUOTE",
      entityType: "bid_quote",
      entityId: updated.id,
      newValue: `Updated quote from ${updated.subcontractorName} for bid ${bid.code}`,
    }, req);

    res.json(updated);
  } catch (error: any) {
    console.error("Update bid quote error:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid quote data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");

    const [existing] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    if (existing.bidId !== bid.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [deleted] = await db
      .delete(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "DELETE_BID_QUOTE",
      entityType: "bid_quote",
      entityId: deleted.id,
      oldValue: `Deleted quote from ${deleted.subcontractorName} for bid ${bid.code}`,
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete bid quote error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/quotes/:quoteId/send-rfq", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const { sendRfqEmail } = await import("./bidNetworkNotifications");
    const { organizations } = await import("@shared/schema");

    const [quote] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.id, req.params.quoteId))
      .limit(1);

    if (!quote || quote.bidId !== bid.id) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    const recipientEmail = quote.contactEmail;
    if (!recipientEmail) {
      res.status(400).json({ error: "Quote has no contact email. Add a contact email first." });
      return;
    }

    const [gcOrg] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, bid.gcOrganizationId));

    const sent = await sendRfqEmail(
      recipientEmail,
      quote.contactName || "",
      bid.name || "Untitled Bid",
      quote.scopeOfWork,
      gcOrg?.name || "Unknown",
      "subcontractor",
      bid.dueDate ? new Date(bid.dueDate) : undefined
    );

    if (sent) {
      await db
        .update(bidSubcontractorQuotes)
        .set({ rfqSentAt: new Date(), rfqStatus: "sent", updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, quote.id));

      const [updated] = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, quote.id))
        .limit(1);

      res.json(updated);
    } else {
      res.status(500).json({ error: "Failed to send RFQ email" });
    }
  } catch (error) {
    console.error("Send RFQ error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Bid Material Quotes Routes
// ====================

router.get("/api/bids/:code/material-quotes", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes } = await import("@shared/schema");

    const materialQuotes = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.bidId, bid.id))
      .orderBy(desc(bidMaterialQuotes.createdAt));

    res.json(materialQuotes);
  } catch (error) {
    console.error("Get bid material quotes error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/material-quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes, insertBidMaterialQuoteSchema } = await import("@shared/schema");

    const sanitizedBody = {
      ...req.body,
      materialName: sanitizeShortText(req.body.materialName),
      description: req.body.description ? sanitizeText(req.body.description) : "",
      specs: req.body.specs ? sanitizeText(req.body.specs) : undefined,
      leadTime: req.body.leadTime ? sanitizeShortText(req.body.leadTime) : undefined,
      supplierName: req.body.supplierName ? sanitizeShortText(req.body.supplierName) : undefined,
      supplierContact: req.body.supplierContact ? sanitizeText(req.body.supplierContact) : undefined,
      supplierEmail: req.body.supplierEmail ? sanitizeEmail(req.body.supplierEmail) : undefined,
    };

    const validated = insertBidMaterialQuoteSchema.parse({
      ...sanitizedBody,
      bidId: bid.id,
    });

    const [newMaterialQuote] = await db.insert(bidMaterialQuotes).values(validated).returning();

    await logAudit({
      userId: req.user!.id,
      action: "CREATE_BID_MATERIAL_QUOTE",
      entityType: "bid_material_quote",
      entityId: newMaterialQuote.id,
      newValue: `Created material quote for ${validated.materialName} for bid ${bid.code}`,
    }, req);

    res.status(201).json(newMaterialQuote);
  } catch (error: any) {
    console.error("Create bid material quote error:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid material quote data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.patch("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes } = await import("@shared/schema");

    const sanitizedBody: any = {
      materialName: req.body.materialName ? sanitizeShortText(req.body.materialName) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
      specs: req.body.specs ? sanitizeText(req.body.specs) : undefined,
      leadTime: req.body.leadTime ? sanitizeShortText(req.body.leadTime) : undefined,
      supplierName: req.body.supplierName ? sanitizeShortText(req.body.supplierName) : undefined,
      supplierContact: req.body.supplierContact ? sanitizeText(req.body.supplierContact) : undefined,
      supplierEmail: req.body.supplierEmail ? sanitizeEmail(req.body.supplierEmail) : undefined,
      cost: req.body.cost !== undefined ? req.body.cost : undefined,
      fileUrl: req.body.fileUrl !== undefined ? req.body.fileUrl : undefined,
      fileName: req.body.fileName !== undefined ? req.body.fileName : undefined,
    };
    
    if (typeof req.body.isSelected === 'boolean') {
      sanitizedBody.isSelected = req.body.isSelected;
    }
    
    Object.keys(sanitizedBody).forEach(key => {
      if (sanitizedBody[key] === undefined) {
        delete sanitizedBody[key];
      }
    });

    const validated = sanitizedBody;

    const [existingMQ] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, req.params.quoteId))
      .limit(1);

    if (!existingMQ) {
      res.status(404).json({ error: "Material quote not found" });
      return;
    }

    if (existingMQ.bidId !== bid.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [updated] = await db
      .update(bidMaterialQuotes)
      .set({ ...validated, updatedAt: new Date() })
      .where(eq(bidMaterialQuotes.id, req.params.quoteId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE_BID_MATERIAL_QUOTE",
      entityType: "bid_material_quote",
      entityId: updated.id,
      newValue: `Updated material quote for ${updated.materialName} for bid ${bid.code}`,
    }, req);

    res.json(updated);
  } catch (error: any) {
    console.error("Update bid material quote error:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid material quote data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

router.delete("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes } = await import("@shared/schema");

    const [existingMQ] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, req.params.quoteId))
      .limit(1);

    if (!existingMQ) {
      res.status(404).json({ error: "Material quote not found" });
      return;
    }

    if (existingMQ.bidId !== bid.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const [deleted] = await db
      .delete(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, req.params.quoteId))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "DELETE_BID_MATERIAL_QUOTE",
      entityType: "bid_material_quote",
      entityId: deleted.id,
      oldValue: `Deleted material quote for ${deleted.materialName} for bid ${bid.code}`,
    }, req);

    res.json({ success: true });
  } catch (error) {
    console.error("Delete bid material quote error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/material-quotes/:quoteId/send-rfq", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes } = await import("@shared/schema");
    const { sendRfqEmail } = await import("./bidNetworkNotifications");
    const { organizations } = await import("@shared/schema");

    const [quote] = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.id, req.params.quoteId))
      .limit(1);

    if (!quote || quote.bidId !== bid.id) {
      res.status(404).json({ error: "Material quote not found" });
      return;
    }

    const recipientEmail = quote.supplierEmail;
    if (!recipientEmail) {
      res.status(400).json({ error: "Quote has no supplier email. Add a supplier email first." });
      return;
    }

    const [gcOrg] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, bid.gcOrganizationId));

    const scopeDesc = [quote.materialName, quote.description, quote.specs].filter(Boolean).join(" - ");

    const sent = await sendRfqEmail(
      recipientEmail,
      quote.supplierContact || quote.supplierName || "",
      bid.name || "Untitled Bid",
      scopeDesc,
      gcOrg?.name || "Unknown",
      "material",
      bid.dueDate ? new Date(bid.dueDate) : undefined
    );

    if (sent) {
      await db
        .update(bidMaterialQuotes)
        .set({ rfqSentAt: new Date(), rfqStatus: "sent", updatedAt: new Date() })
        .where(eq(bidMaterialQuotes.id, quote.id));

      const [updated] = await db
        .select()
        .from(bidMaterialQuotes)
        .where(eq(bidMaterialQuotes.id, quote.id))
        .limit(1);

      res.json(updated);
    } else {
      res.status(500).json({ error: "Failed to send RFQ email" });
    }
  } catch (error) {
    console.error("Send material RFQ error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Handoff Packet Routes (Job Information for QuickBooks)
// ====================

router.get("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { handoffPackets } = await import("@shared/schema");

    const [packet] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.bidId, bid.id))
      .limit(1);

    res.json(packet || null);
  } catch (error) {
    console.error("Get handoff packet error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { handoffPackets } = await import("@shared/schema");

    const [existing] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.bidId, bid.id))
      .limit(1);

    const packetData = {
      bidId: bid.id,
      gcName: req.body.gcName || null,
      gcContactName: req.body.gcContactName || null,
      gcPhone: req.body.gcPhone || null,
      gcEmail: req.body.gcEmail || null,
      accessDetails: req.body.accessDetails || null,
      scopeOfWorkSummary: req.body.scopeOfWorkSummary || null,
      contractValue: req.body.contractValue || null,
      bidDate: req.body.bidDate || null,
      awardDate: req.body.awardDate || null,
      markupPercent: req.body.markupPercent || null,
      duration: req.body.duration || null,
      projectStartDate: req.body.projectStartDate || null,
      projectCompletionDate: req.body.projectCompletionDate || null,
      manpower: req.body.manpower || null,
      alternates: req.body.alternates || null,
      subcontractExecuted: req.body.subcontractExecuted ?? null,
      insuranceCerts: req.body.insuranceCerts || null,
      bondRequired: req.body.bondRequired ?? null,
      permits: req.body.permits || null,
      retentionPercent: req.body.retentionPercent || null,
      paymentTerms: req.body.paymentTerms || null,
      scheduleOfValuesReady: req.body.scheduleOfValuesReady ?? null,
      drawSchedule: req.body.drawSchedule || null,
      prevailingWage: req.body.prevailingWage ?? null,
      concreteSupplier: req.body.concreteSupplier || null,
      mixInfo: req.body.mixInfo || null,
      rebarVendor: req.body.rebarVendor || null,
      formingMaterialPlan: req.body.formingMaterialPlan || null,
      curingSpecs: req.body.curingSpecs || null,
      specialItems: req.body.specialItems || null,
      leadTimeRisks: req.body.leadTimeRisks || null,
      submittalStatus: req.body.submittalStatus || null,
      layoutSurveyBy: req.body.layoutSurveyBy || null,
      benchmarkInfo: req.body.benchmarkInfo || null,
      accessZones: req.body.accessZones || null,
      workHours: req.body.workHours || null,
      safetyOrientation: req.body.safetyOrientation || null,
      inspectionNeeds: req.body.inspectionNeeds || null,
      coordinationIssues: req.body.coordinationIssues || null,
      weatherRisks: req.body.weatherRisks || null,
      soilConditions: req.body.soilConditions || null,
      estimatorNotes: req.body.estimatorNotes || null,
      gcContactMethod: req.body.gcContactMethod || null,
      projectManager: req.body.projectManager || null,
      superintendent: req.body.superintendent || null,
      officeAdmin: req.body.officeAdmin || null,
      safetyContact: req.body.safetyContact || null,
      createdById: req.user!.id,
      updatedAt: new Date(),
    };

    let result;
    if (existing) {
      [result] = await db
        .update(handoffPackets)
        .set(packetData)
        .where(eq(handoffPackets.id, existing.id))
        .returning();
    } else {
      [result] = await db
        .insert(handoffPackets)
        .values(packetData)
        .returning();
    }

    res.json(result);
  } catch (error) {
    console.error("Save handoff packet error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const { handoffPackets } = await import("@shared/schema");

    const [packet] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.projectId, project.id))
      .limit(1);

    res.json(packet || null);
  } catch (error) {
    console.error("Get project handoff packet error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "OFFICE_MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
  try {
    const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const userRole = req.user!.effectiveRole || req.user!.role;
    if (userRole === "SUPERINTENDENT" && project.superintendentId !== req.user!.id) {
      res.status(403).json({ error: "You can only edit handoff packets for projects where you are the assigned superintendent" });
      return;
    }

    const { handoffPackets } = await import("@shared/schema");

    const [existing] = await db
      .select()
      .from(handoffPackets)
      .where(eq(handoffPackets.projectId, project.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Handoff packet not found for this project" });
      return;
    }

    const updateData = {
      gcName: req.body.gcName ?? existing.gcName,
      gcContactName: req.body.gcContactName ?? existing.gcContactName,
      gcPhone: req.body.gcPhone ?? existing.gcPhone,
      gcEmail: req.body.gcEmail ?? existing.gcEmail,
      accessDetails: req.body.accessDetails ?? existing.accessDetails,
      scopeOfWorkSummary: req.body.scopeOfWorkSummary ?? existing.scopeOfWorkSummary,
      contractValue: req.body.contractValue ?? existing.contractValue,
      bidDate: req.body.bidDate ?? existing.bidDate,
      awardDate: req.body.awardDate ?? existing.awardDate,
      markupPercent: req.body.markupPercent ?? existing.markupPercent,
      duration: req.body.duration ?? existing.duration,
      projectStartDate: req.body.projectStartDate ?? existing.projectStartDate,
      projectCompletionDate: req.body.projectCompletionDate ?? existing.projectCompletionDate,
      manpower: req.body.manpower ?? existing.manpower,
      alternates: req.body.alternates ?? existing.alternates,
      subcontractExecuted: req.body.subcontractExecuted ?? existing.subcontractExecuted,
      insuranceCerts: req.body.insuranceCerts ?? existing.insuranceCerts,
      bondRequired: req.body.bondRequired ?? existing.bondRequired,
      permits: req.body.permits ?? existing.permits,
      retentionPercent: req.body.retentionPercent ?? existing.retentionPercent,
      paymentTerms: req.body.paymentTerms ?? existing.paymentTerms,
      scheduleOfValuesReady: req.body.scheduleOfValuesReady ?? existing.scheduleOfValuesReady,
      drawSchedule: req.body.drawSchedule ?? existing.drawSchedule,
      prevailingWage: req.body.prevailingWage ?? existing.prevailingWage,
      concreteSupplier: req.body.concreteSupplier ?? existing.concreteSupplier,
      mixInfo: req.body.mixInfo ?? existing.mixInfo,
      rebarVendor: req.body.rebarVendor ?? existing.rebarVendor,
      formingMaterialPlan: req.body.formingMaterialPlan ?? existing.formingMaterialPlan,
      curingSpecs: req.body.curingSpecs ?? existing.curingSpecs,
      specialItems: req.body.specialItems ?? existing.specialItems,
      leadTimeRisks: req.body.leadTimeRisks ?? existing.leadTimeRisks,
      submittalStatus: req.body.submittalStatus ?? existing.submittalStatus,
      layoutSurveyBy: req.body.layoutSurveyBy ?? existing.layoutSurveyBy,
      benchmarkInfo: req.body.benchmarkInfo ?? existing.benchmarkInfo,
      accessZones: req.body.accessZones ?? existing.accessZones,
      workHours: req.body.workHours ?? existing.workHours,
      safetyOrientation: req.body.safetyOrientation ?? existing.safetyOrientation,
      inspectionNeeds: req.body.inspectionNeeds ?? existing.inspectionNeeds,
      coordinationIssues: req.body.coordinationIssues ?? existing.coordinationIssues,
      weatherRisks: req.body.weatherRisks ?? existing.weatherRisks,
      soilConditions: req.body.soilConditions ?? existing.soilConditions,
      estimatorNotes: req.body.estimatorNotes ?? existing.estimatorNotes,
      gcContactMethod: req.body.gcContactMethod ?? existing.gcContactMethod,
      projectManager: req.body.projectManager ?? existing.projectManager,
      superintendent: req.body.superintendent ?? existing.superintendent,
      officeAdmin: req.body.officeAdmin ?? existing.officeAdmin,
      safetyContact: req.body.safetyContact ?? existing.safetyContact,
      updatedAt: new Date(),
    };

    const [result] = await db
      .update(handoffPackets)
      .set(updateData)
      .where(eq(handoffPackets.id, existing.id))
      .returning();

    res.json(result);
  } catch (error) {
    console.error("Update project handoff packet error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ====================
// Bid PDF Generation Routes
// ====================

router.get("/api/bids/:code/pdf/internal-summary", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const [estimate] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bid.id))
      .limit(1);

    let lineItems: any[] = [];
    if (estimate) {
      lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));
    }

    const { bidSubcontractorQuotes, bidMaterialQuotes } = await import("@shared/schema");

    const subQuotes = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.bidId, bid.id));

    const materialQuotes = await db
      .select()
      .from(bidMaterialQuotes)
      .where(eq(bidMaterialQuotes.bidId, bid.id));

    const equipmentSelections = await db
      .select()
      .from(bidEquipmentSelections)
      .where(eq(bidEquipmentSelections.bidId, bid.id));

    const scopeItemsList = lineItems.map(item => ({
      description: item.description,
      category: item.category,
      quantity: parseFloat(item.quantity) || 0,
      unit: item.unit,
      totalCost: parseFloat(item.totalCost) || 0,
      laborCost: parseFloat(item.laborCost) || 0,
      materialCost: parseFloat(item.materialCost) || 0,
      equipmentCost: parseFloat(item.equipmentCost) || 0,
      subcontractCost: parseFloat(item.subcontractCost) || 0,
    }));

    const totalDirectCost = scopeItemsList.reduce((sum, item) => sum + item.totalCost, 0);
    const selectedMaterialCost = materialQuotes
      .filter(q => q.isSelected)
      .reduce((sum, q) => sum + parseFloat(q.cost as any), 0);
    const selectedSubCost = subQuotes
      .filter(q => q.isSelected)
      .reduce((sum, q) => sum + parseFloat(q.quoteAmount as any), 0);
    const equipmentCost = equipmentSelections.reduce((sum, eqItem) => sum + (parseFloat(eqItem.estimatedCost as any) || 0), 0);

    const baseCost = totalDirectCost + selectedMaterialCost + selectedSubCost + equipmentCost;
    const overheadPercent = 15;
    const profitPercent = 10;
    const overheadAmount = baseCost * (overheadPercent / 100);
    const profitAmount = baseCost * (profitPercent / 100);
    const finalBidAmount = baseCost + overheadAmount + profitAmount;

    const pdfData = {
      bid: {
        id: bid.id,
        name: bid.name,
        code: bid.code,
        clientName: bid.clientName,
        clientContactName: bid.clientContactName,
        clientContactEmail: bid.clientContactEmail,
        clientContactPhone: bid.clientContactPhone,
        locationAddress: bid.locationAddress,
        city: bid.city,
        state: bid.state,
        description: bid.description,
        bidAmount: parseFloat(bid.bidAmount as any) || null,
        dueDate: bid.dueDate,
      },
      scopeItems: scopeItemsList,
      subQuotes: subQuotes.map(q => ({
        subcontractorName: q.subcontractorName,
        scopeOfWork: q.scopeOfWork,
        quoteAmount: parseFloat(q.quoteAmount as any),
        isSelected: q.isSelected,
      })),
      materialQuotes: materialQuotes.map(q => ({
        materialName: q.materialName,
        description: q.description,
        cost: parseFloat(q.cost as any),
        supplierName: q.supplierName,
        isSelected: q.isSelected,
      })),
      equipmentSelections: equipmentSelections.map(eqItem => ({
        equipmentName: eqItem.equipmentName,
        equipmentType: eqItem.equipmentType,
        source: eqItem.source,
        plannedDays: eqItem.plannedDays,
        plannedHours: parseFloat(eqItem.plannedHours as any) || null,
        estimatedCost: parseFloat(eqItem.estimatedCost as any) || null,
      })),
      summary: {
        totalDirectCost: baseCost,
        overheadPercent,
        overheadAmount,
        profitPercent,
        profitAmount,
        finalBidAmount,
      },
    };

    const pdfStream = generateInternalBidSummaryPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="SmartManageAI-Internal-Summary-${bid.code}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Generate internal bid summary PDF error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/bids/:code/pdf/customer-quote", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const [estimate] = await db
      .select()
      .from(estimates)
      .where(eq(estimates.bidId, bid.id))
      .limit(1);

    let lineItems: any[] = [];
    if (estimate) {
      lineItems = await db
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));
    }

    const scopeItemsList = lineItems.map(item => ({
      description: item.description,
      category: item.category,
      quantity: parseFloat(item.quantity) || 0,
      unit: item.unit,
      totalCost: parseFloat(item.totalCost) || 0,
      laborCost: parseFloat(item.laborCost) || 0,
      materialCost: parseFloat(item.materialCost) || 0,
      equipmentCost: parseFloat(item.equipmentCost) || 0,
      subcontractCost: parseFloat(item.subcontractCost) || 0,
    }));

    const totalDirectCost = scopeItemsList.reduce((sum, item) => sum + item.totalCost, 0);
    const overheadPercent = 15;
    const profitPercent = 10;
    const overheadAmount = totalDirectCost * (overheadPercent / 100);
    const profitAmount = totalDirectCost * (profitPercent / 100);
    const finalBidAmount = parseFloat(bid.bidAmount as any) || (totalDirectCost + overheadAmount + profitAmount);

    const pdfData = {
      bid: {
        id: bid.id,
        name: bid.name,
        code: bid.code,
        clientName: bid.clientName,
        clientContactName: bid.clientContactName,
        clientContactEmail: bid.clientContactEmail,
        clientContactPhone: bid.clientContactPhone,
        locationAddress: bid.locationAddress,
        city: bid.city,
        state: bid.state,
        description: bid.description,
        bidAmount: parseFloat(bid.bidAmount as any) || null,
        dueDate: bid.dueDate,
      },
      scopeItems: scopeItemsList,
      subQuotes: [],
      materialQuotes: [],
      equipmentSelections: [],
      summary: {
        totalDirectCost,
        overheadPercent,
        overheadAmount,
        profitPercent,
        profitAmount,
        finalBidAmount,
        taxRate: 0,
        taxAmount: 0,
      },
    };

    const pdfStream = generateCustomerQuotePDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="SmartManageAI-Quote-${bid.code}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    console.error("Generate customer quote PDF error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ==================
// Bid Documents (Plans & Takeoff)
// ==================

router.get("/api/bids/:code/documents", requireAuth, async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const docs = await db.select().from(bidDocuments).where(eq(bidDocuments.bidId, bid.id)).orderBy(desc(bidDocuments.uploadedAt));
    res.json(docs);
  } catch (error) {
    console.error("Get bid documents error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/documents", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const bodySchema = z.object({
      title: z.string().min(1),
      fileName: z.string().min(1),
      fileUrl: z.string().min(1),
      objectKey: z.string().optional(),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
      type: z.enum(["PLANS", "SPECS", "TAKEOFF", "OTHER"]).default("OTHER"),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const data = parsed.data;

    const [doc] = await db.insert(bidDocuments).values({
      bidId: bid.id,
      title: data.title,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      objectKey: data.objectKey,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      type: data.type,
      uploadedById: req.user!.id,
    }).returning();

    res.status(201).json(doc);
  } catch (error) {
    console.error("Create bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/api/bids/:code/documents/:docId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const [doc] = await db.select().from(bidDocuments).where(and(eq(bidDocuments.id, req.params.docId), eq(bidDocuments.bidId, bid.id))).limit(1);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    if (doc.objectKey) {
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(doc.objectKey);
        await objectFile.delete();
      } catch (error) {
        console.error("Error deleting bid document from object storage:", error);
      }
    }

    await db.delete(bidDocuments).where(eq(bidDocuments.id, req.params.docId));
    res.json({ success: true });
  } catch (error) {
    console.error("Delete bid document error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/api/bids/:code/submit", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
  try {
    const bid = await db.query.bids.findFirst({ where: eq(bids.code, req.params.code) });
    if (!bid) return res.status(404).json({ error: "Bid not found" });

    const orgId = req.user!.organizationId;
    if (bid.gcOrganizationId && bid.gcOrganizationId !== orgId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { recipientEmail } = req.body;
    const toEmail = recipientEmail || bid.clientContactEmail;

    if (!toEmail) {
      return res.status(400).json({ error: "No recipient email provided and no client contact email on bid" });
    }

    const finalAmount = bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "To be determined";
    const dueDate = bid.dueDate ? new Date(bid.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Not specified";

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a;">Bid Proposal: ${bid.name}</h2>
        <p style="color: #555;">Dear ${bid.clientContactName || bid.clientName},</p>
        <p style="color: #555;">Please find below the details of our bid proposal for your review.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f5f5f5;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Project</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${bid.name}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Bid Reference</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace;">${bid.code}</td>
          </tr>
          <tr style="background: #f5f5f5;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Bid Amount</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 1.1em; color: #2563eb;">${finalAmount}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Due Date</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${dueDate}</td>
          </tr>
          ${bid.locationAddress ? `<tr style="background: #f5f5f5;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Location</td><td style="padding: 10px; border: 1px solid #ddd;">${[bid.locationAddress, bid.city, bid.state].filter(Boolean).join(", ")}</td></tr>` : ""}
          ${bid.description ? `<tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Description</td><td style="padding: 10px; border: 1px solid #ddd;">${bid.description}</td></tr>` : ""}
        </table>
        <p style="color: #555;">Please review this proposal and let us know if you have any questions or require additional information.</p>
        <p style="color: #555;">Thank you for the opportunity to submit this bid.</p>
      </div>
    `;

    const emailSent = await sendEmail({
      to: toEmail,
      subject: `Bid Proposal: ${bid.name} (Ref: ${bid.code})`,
      html: emailHtml,
      text: `Bid Proposal: ${bid.name}\nReference: ${bid.code}\nAmount: ${finalAmount}\nDue Date: ${dueDate}\n\nPlease review this proposal and contact us with any questions.`,
    });

    if (!emailSent) {
      console.warn(`[Bid Submit] Email send failed for bid ${bid.code} to ${toEmail}`);
    }

    const [updatedBid] = await db.update(bids)
      .set({ submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(bids.code, req.params.code))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "bid",
      entityId: bid.id,
      newValue: `Bid submitted to client at ${toEmail}`,
    }, req);

    res.json({ success: true, submittedAt: updatedBid.submittedAt, emailSent });
  } catch (error) {
    console.error("Bid submit error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
