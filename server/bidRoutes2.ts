/**
 * @openapi
 * /api/bids:
 *   get:
 *     tags: [Bids & Estimates]
 *     summary: List all bids
 *     description: Returns bids for the authenticated user's organization with latest estimate summaries.
 *     responses:
 *       200:
 *         description: List of bids
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Bid'
 *   post:
 *     tags: [Bids & Estimates]
 *     summary: Create a new bid
 *     description: Requires ADMIN, MANAGER, or ESTIMATOR role. Bid code is auto-generated.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               clientName: { type: string }
 *               description: { type: string }
 *               bidAmount: { type: string }
 *               dueDate: { type: string, format: date-time }
 *               estimatorId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Bid created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bid'
 * /api/bids/{code}:
 *   get:
 *     tags: [Bids & Estimates]
 *     summary: Get bid by code
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Bid details with estimates
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Bid'
 *       404: { description: Bid not found }
 *   patch:
 *     tags: [Bids & Estimates]
 *     summary: Update a bid
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Bid updated }
 *   delete:
 *     tags: [Bids & Estimates]
 *     summary: Delete a bid
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bid deleted }
 * /api/bids/{code}/estimates:
 *   get:
 *     tags: [Bids & Estimates]
 *     summary: List estimates for a bid
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: List of estimates }
 *   post:
 *     tags: [Bids & Estimates]
 *     summary: Create an estimate
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201: { description: Estimate created }
 * /api/bids/{code}/estimates/{estimateId}/line-items:
 *   get:
 *     tags: [Bids & Estimates]
 *     summary: Get estimate line items
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: estimateId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: List of line items }
 *   post:
 *     tags: [Bids & Estimates]
 *     summary: Add estimate line item
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: estimateId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [description, quantity, unitPrice]
 *             properties:
 *               description: { type: string }
 *               quantity: { type: number }
 *               unitPrice: { type: string }
 *               unit: { type: string }
 *               costCode: { type: string }
 *     responses:
 *       201: { description: Line item added }
 * /api/bids/{code}/convert-to-project:
 *   post:
 *     tags: [Bids & Estimates]
 *     summary: Convert bid to project
 *     description: Creates a new project from an awarded bid. Copies scope items and estimates.
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Project created from bid }
 *       400: { description: Bid must be in AWARDED status }
 */
import { logError } from "./utils/logger";
import { Router } from "express";
import { db } from "./db";
import { eventBus } from "./events";
import { exportLimiter } from "./rateLimiter";
import {
  bids, estimates, estimateLineItems, projects, users,
  insertBidSchema, scopeItems,
  subcontractors, subcontractorContracts,
  bidEquipmentSelections, bidDocuments,
  scheduleOfValues, sovLineItems,
} from "@shared/schema";
import { eq, desc, inArray, sql, and, or } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { validateBody } from "./utils/validation";
import { logUpdate, logDelete, logAudit } from "./auditLogger";
import { pruneTakeoffRecentsForEntity } from "./takeoffRecentsCleanup";
import { sanitizeShortText, sanitizeText, sanitizeEmail, sanitizePhone } from "./sanitization";
import { getOrgIdForFilter, verifyOrgAccess } from "./orgFilter";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";
import { ObjectPermission } from "./objectAcl";
import { generateInternalBidSummaryPDF, generateCustomerQuotePDF, generateWarrantyContractPDF } from "./pdf-service";
import { getOrganizationBranding } from "./organizationBranding";
import { sendEmail } from "./email";
import { queueWageDecisionSync } from "./integrations/providers/dol_davis_bacon/sync";

const router = Router();

const BID_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "SUBMITTED", "CANCELLED"],
  ACTIVE: ["SUBMITTED", "AWARDED", "LOST", "CANCELLED"],
  SUBMITTED: ["AWARDED", "LOST", "CANCELLED"],
  AWARDED: [],
  LOST: [],
  CANCELLED: [],
};

const BID_ADMIN_FORCE_TRANSITIONS: Record<string, string[]> = {
  AWARDED: ["ACTIVE"],
  LOST: ["ACTIVE", "DRAFT"],
  CANCELLED: ["DRAFT"],
};

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

router.get("/api/bids", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    res.json(bid);
  } catch (error) {
    next(error);
  }
});

router.post("/api/bids", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

        if (newBid.estimatorId) {
          let estimatorName: string | null = null;
          const [est] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, newBid.estimatorId)).limit(1);
          if (est) estimatorName = `${est.firstName} ${est.lastName}`.trim();
          await eventBus.emit({
            type: "bid.assigned",
            version: 1,
            orgId: newBid.gcOrganizationId || userOrgId || "",
            actorId: req.user!.id,
            timestamp: new Date(),
            payload: {
              bidId: newBid.id,
              bidCode: newBid.code,
              title: newBid.name,
              estimatorId: newBid.estimatorId,
              estimatorName,
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
    logError("Create bid error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') {
      res.status(409).json({ error: "Unable to generate unique bid code - please try again" });
    } else {
      next(error);
    }
  }
});

router.patch("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const [existingBid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    
    if (!existingBid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, existingBid.gcOrganizationId)) return;

    const ALLOWED_UPDATE_FIELDS = new Set([
      "name", "clientName", "clientContactName", "clientContactEmail", "clientContactPhone",
      "bidAmount", "dueDate", "locationAddress", "city", "state", "description",
      "estimatorId", "ownerRepOrganizationId", "status",
      "crmOpportunityId", "aiWinProbability", "force",
      "wageDecision",
    ]);
    const filteredBody: Record<string, any> = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        filteredBody[key] = value;
      }
    }

    const sanitizedBody = {
      ...filteredBody,
      name: filteredBody.name ? sanitizeShortText(filteredBody.name) : undefined,
      clientName: filteredBody.clientName ? sanitizeShortText(filteredBody.clientName) : undefined,
      description: filteredBody.description ? sanitizeText(filteredBody.description) : undefined,
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

    const newStatus = validationResult.data.status;
    if (newStatus && newStatus !== existingBid.status) {
      const allowed = BID_STATUS_TRANSITIONS[existingBid.status] || [];
      if (!allowed.includes(newStatus)) {
        const forceFlag = filteredBody.force === true;
        const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "SUPER_ADMIN";
        const forceAllowed = BID_ADMIN_FORCE_TRANSITIONS[existingBid.status] || [];
        if (!(forceFlag && isAdmin && forceAllowed.includes(newStatus))) {
          const hint = forceAllowed.length > 0 ? ` Admins can force: ${forceAllowed.join(", ")}` : "";
          res.status(422).json({
            error: `Invalid status transition from ${existingBid.status} to ${newStatus}. Allowed transitions: ${allowed.join(", ") || "none"}.${hint}`,
          });
          return;
        }
      }
    }

    const updateData: any = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(validationResult.data)) {
      if (key !== "force" && value !== undefined) {
        updateData[key] = value;
      }
    }
    
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

    const userOrgId = req.user?.organizationId || existingBid.gcOrganizationId || "";
    if (newStatus && newStatus !== existingBid.status) {
      await eventBus.emit({
        type: "bid.status_changed",
        version: 1,
        orgId: userOrgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          bidId: updatedBid.id,
          bidCode: updatedBid.code,
          title: updatedBid.name,
          oldStatus: existingBid.status,
          newStatus,
        },
      });
    }

    if (validationResult.data.estimatorId && validationResult.data.estimatorId !== existingBid.estimatorId) {
      let estimatorName: string | null = null;
      const [est] = await db.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, validationResult.data.estimatorId)).limit(1);
      if (est) estimatorName = `${est.firstName} ${est.lastName}`.trim();
      await eventBus.emit({
        type: "bid.assigned",
        version: 1,
        orgId: userOrgId,
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          bidId: updatedBid.id,
          bidCode: updatedBid.code,
          title: updatedBid.name,
          estimatorId: validationResult.data.estimatorId,
          estimatorName,
        },
      });
    }

    res.json(updatedBid);
  } catch (error: any) {
    logError("Update bid error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') {
      res.status(409).json({ error: "Bid code already exists" });
    } else {
      next(error);
    }
  }
});

router.delete("/api/bids/:code", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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

    // Task #2105 — drop any Takeoff "Recent" rail rows pointing at this
    // bid (across every user) so the per-user 24-entry cap doesn't get
    // wasted by orphaned cards. The takeoff_recents table only FK's to
    // users/orgs, so without this hook the rows would linger forever.
    await pruneTakeoffRecentsForEntity("bid", bid.id);

    await logDelete(req.user!.id, "bids", bid.id, { code: bid.code, name: bid.name }, req);

    res.json({ success: true, message: `Bid ${bid.code} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:id/estimate", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:id/estimate", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:code/convert", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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

    const bidConvertSchema = z.object({
      superintendentId: z.string().uuid().optional(),
      projectManagerId: z.string().uuid().optional(),
      overheadPercent: z.number().min(0).max(100).optional(),
      profitPercent: z.number().min(0).max(100).optional(),
      startStatus: z.enum(["ACTIVE", "PLANNING"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      projectEngineerId: z.string().uuid().optional(),
      foremanId: z.string().uuid().optional(),
    });
    const parsed = validateBody(bidConvertSchema, req.body || {}, res);
    if (!parsed) return;

    const { superintendentId, projectManagerId, overheadPercent: bodyOverhead, profitPercent: bodyProfit, startStatus: bodyStartStatus, startDate: bodyStartDate, endDate: bodyEndDate, projectEngineerId: bodyProjectEngineerId, foremanId: bodyForemanId } = parsed;
    const OVERHEAD_PERCENT = typeof bodyOverhead === "number" && bodyOverhead >= 0 ? bodyOverhead : 10;
    const PROFIT_MARGIN_PERCENT = typeof bodyProfit === "number" && bodyProfit >= 0 ? bodyProfit : 15;
    const projectStartStatus: "ACTIVE" | "PLANNING" = bodyStartStatus === "PLANNING" ? "PLANNING" : "ACTIVE";
    
    let directCostBudget = "0";
    let contractAmount = bid.bidAmount || "0";
    let sovSeedLineItems: (typeof estimateLineItems.$inferSelect)[] = [];
    
    if (bidEstimates.length > 0) {
      const activeEstimate = bidEstimates.find(e => e.status === "APPROVED") || bidEstimates[0];
      
      if (activeEstimate) {
        const lineItems = await db
          .select()
          .from(estimateLineItems)
          .where(eq(estimateLineItems.estimateId, activeEstimate.id));
        sovSeedLineItems = lineItems;
        
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

    const { projectMaterialBudgets, budgetLineItems, projectLaborRates, jobClassifications,
      bidSubcontractorQuotes: subQuotesTable, bidMaterialQuotes: matQuotesTable,
      procurementItems, handoffPackets: handoffTable,
      bidEquipmentSelections: equipSelectionsTable, projectEquipmentPlans: equipPlansTable,
      planDocuments, takeoffSheets, takeoffMeasurements, quantityCategories,
      takeoffMeasurementGroups, takeoffVersions,
      contracts: contractsTable, contractVersions: contractVersionsTable,
      notifications: notificationsTable } = await import("@shared/schema");

    const newProject = await db.transaction(async (tx) => {
    
    const [createdProject] = await tx.insert(projects).values({
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
      startDate: bodyStartDate ? new Date(bodyStartDate) : null,
      endDate: bodyEndDate ? new Date(bodyEndDate) : null,
      // Task #1386 — propagate any prevailing-wage decision number set on
      // the bid so the new project picks it up on day one. The post-commit
      // queueWageDecisionSync below ensures the Davis-Bacon rates auto-import.
      wageDecision: bid.wageDecision || null,
    }).returning();

    for (const estimate of bidEstimates) {
      await tx
        .update(estimates)
        .set({ projectId: createdProject.id })
        .where(eq(estimates.id, estimate.id));

      const lineItems = await tx
        .select()
        .from(estimateLineItems)
        .where(eq(estimateLineItems.estimateId, estimate.id));

      console.log(`[Bid Conversion] Syncing ${lineItems.length} line items to scope of work`);

      for (const lineItem of lineItems) {
        const existingScopeItem = await tx.query.scopeItems.findFirst({
          where: eq(scopeItems.estimateLineItemId, lineItem.id),
        });

        if (!existingScopeItem) {
          const [newScopeItem] = await tx.insert(scopeItems).values({
            projectId: createdProject.id,
            estimateLineItemId: lineItem.id,
            organizationSowItemId: lineItem.organizationSowItemId || null,
            subcontractorQuoteId: lineItem.subcontractorQuoteId || null,
            description: lineItem.description,
            unit: lineItem.unit,
            totalQuantity: lineItem.quantity,
            unitPrice: lineItem.totalCost ? 
              (Number(lineItem.totalCost) / Number(lineItem.quantity)).toFixed(2) : 
              null,
            estimatedConcreteYards: lineItem.calculatedConcreteYards || null,
            estimatedStoneTons: lineItem.calculatedStoneTons || null,
            estimatedExcavationYards: lineItem.calculatedExcavationYards || null,
            materialResponsibility: lineItem.subcontractorQuoteId ? "SUBCONTRACTOR" : "TFR",
          }).returning();

          const materialCost = Number(lineItem.materialCost || 0);
          const quantity = Number(lineItem.quantity || 0);
          
          if (materialCost > 0 && quantity > 0) {
            const unitCost = materialCost / quantity;
            await tx.insert(projectMaterialBudgets).values({
              projectId: createdProject.id,
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
      
      console.log(`[Bid Conversion] Created material budgets for project ${createdProject.code}`);
    }

    // Seed SOV from estimate line items
    if (sovSeedLineItems.length > 0) {
      const sovContractValue = contractAmount && parseFloat(contractAmount) > 0 ? contractAmount : "0";
      const totalScheduled = sovSeedLineItems.reduce((sum, li) => sum + Number(li.totalCost || 0), 0);
      const [newSov] = await tx.insert(scheduleOfValues).values({
        organizationId: bid.gcOrganizationId,
        projectId: createdProject.id,
        sovNumber: `SOV-${createdProject.code}-001`,
        title: `${createdProject.name} — Initial Contract`,
        contractValue: sovContractValue,
        totalScheduledValue: totalScheduled.toFixed(2),
        createdById: req.user?.id || null,
      }).returning();

      const { validateDotPayItemLink } = await import("./utils/dotPayItemValidation");
      for (let i = 0; i < sovSeedLineItems.length; i++) {
        const li = sovSeedLineItems[i];
        const scheduledValue = Number(li.totalCost || 0);
        // Carry DOT pay-item identity through bid → SOV so the AIA G703 PDF
        // and DOT progress estimates can render the agency pay item number.
        // Defense-in-depth: re-validate against dot_pay_items in case the
        // estimate row was seeded by an importer that bypassed estimate
        // validation. On mismatch, drop the DOT fields rather than fail
        // the conversion (legacy data shouldn't block project creation).
        const dotFields = {
          dotPayItemId: (li as any).dotPayItemId ?? null,
          payItemNumber: (li as any).payItemNumber ?? null,
          specSection: (li as any).specSection ?? null,
          dotSpecBookId: (li as any).dotSpecBookId ?? null,
        };
        if (dotFields.dotPayItemId) {
          const check = await validateDotPayItemLink(dotFields);
          if (!check.ok) {
            console.warn(`[Bid Conversion] Dropping invalid DOT pay-item link on estimate line ${li.id}: ${check.error}`);
            dotFields.dotPayItemId = null;
            dotFields.payItemNumber = null;
            dotFields.specSection = null;
          }
        }
        await tx.insert(sovLineItems).values({
          sovId: newSov.id,
          lineNumber: i + 1,
          itemCode: li.workTypeCode || null,
          description: li.description || `Line Item ${i + 1}`,
          category: li.category || null,
          scheduledValue: scheduledValue.toFixed(2),
          estimateLineItemId: li.id,
          balanceToFinish: scheduledValue.toFixed(2),
          dotPayItemId: dotFields.dotPayItemId,
          payItemNumber: dotFields.payItemNumber,
          specSection: dotFields.specSection,
        });
      }
      console.log(`[Bid Conversion] Seeded SOV ${newSov.sovNumber} with ${sovSeedLineItems.length} line items for project ${createdProject.code}`);
    }

    // Seed budget line items from individual estimate line items, preserving each
    // line item's specific cost code (workTypeCode, CSI division, category) rather
    // than collapsing into generic Division 01 buckets.
    if (sovSeedLineItems.length > 0) {
      const seededAt = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const budgetSeedRows: { projectId: string; costCode: string; description: string; division: string; laborBudget: string; materialBudget: string; subcontractorBudget: string; equipmentBudget: string; otherBudget: string; totalBudget: string }[] = [];

      const CATEGORY_DIVISION_MAP: Record<string, { division: string; codePrefix: string }> = {
        CONCRETE: { division: "Division 03 — Concrete", codePrefix: "03" },
        EXCAVATION: { division: "Division 31 — Earthwork", codePrefix: "31" },
        PAVERS: { division: "Division 32 — Exterior Improvements", codePrefix: "32" },
        BOLLARDS: { division: "Division 32 — Exterior Improvements", codePrefix: "32" },
        GC: { division: "Division 01 — General Requirements", codePrefix: "01" },
        OVERHEAD: { division: "Division 01 — General Requirements", codePrefix: "01" },
        PROFIT: { division: "Division 01 — General Requirements", codePrefix: "01" },
        GENERAL: { division: "Division 01 — General Requirements", codePrefix: "01" },
      };

      const usedCostCodes = new Set<string>();
      for (let i = 0; i < sovSeedLineItems.length; i++) {
        const li = sovSeedLineItems[i];
        const labor = Number(li.laborCost || 0);
        const material = Number(li.materialCost || 0);
        const equipment = Number(li.equipmentCost || 0);
        const subcontract = Number(li.subcontractCost || 0);
        const other = Number(li.consumablesCost || 0) + Number(li.overheadAllocation || 0) + Number(li.profitAllocation || 0);
        const total = labor + material + subcontract + equipment + other;
        if (total <= 0) continue;

        const category = li.category || "GENERAL";
        const divInfo = CATEGORY_DIVISION_MAP[category] || CATEGORY_DIVISION_MAP.GENERAL;
        const baseCostCode = li.workTypeCode || `${divInfo.codePrefix}-${String(i + 1).padStart(3, '0')}`;
        const division = divInfo.division;

        let costCode = baseCostCode;
        if (usedCostCodes.has(costCode)) {
          let suffix = 2;
          while (usedCostCodes.has(`${baseCostCode}.${suffix}`)) suffix++;
          costCode = `${baseCostCode}.${suffix}`;
        }
        usedCostCodes.add(costCode);

        budgetSeedRows.push({
          projectId: createdProject.id,
          costCode,
          description: `${li.description || `Line Item ${i + 1}`} — Seeded from estimate on ${seededAt}`,
          division,
          laborBudget: labor.toFixed(2),
          materialBudget: material.toFixed(2),
          subcontractorBudget: subcontract.toFixed(2),
          equipmentBudget: equipment.toFixed(2),
          otherBudget: other.toFixed(2),
          totalBudget: total.toFixed(2),
        });
      }

      if (budgetSeedRows.length > 0) {
        await tx.insert(budgetLineItems).values(budgetSeedRows);
        console.log(`[Bid Conversion] Seeded ${budgetSeedRows.length} granular budget line(s) for project ${createdProject.code}`);
      }
    }

    // Seed project labor rates from job classifications used in estimate line items
    if (sovSeedLineItems.length > 0) {
      const classificationIds = new Set<string>();
      for (const li of sovSeedLineItems) {
        if (li.jobClassificationId) {
          classificationIds.add(li.jobClassificationId);
        }
      }

      if (classificationIds.size > 0) {
        const classifications = await tx
          .select()
          .from(jobClassifications)
          .where(inArray(jobClassifications.id, Array.from(classificationIds)));

        if (classifications.length > 0) {
          const [existingRate] = await tx
            .select()
            .from(projectLaborRates)
            .where(eq(projectLaborRates.projectId, createdProject.id))
            .limit(1);

          if (!existingRate) {
            const primary = classifications[0];
            const regularRate = primary.defaultRegularRate || "0.00";
            const overtimeRate = primary.defaultOvertimeRate || (Number(regularRate) * 1.5).toFixed(2);
            const classificationSummary = classifications.map(c => {
              const reg = c.defaultRegularRate || "0.00";
              const ot = c.defaultOvertimeRate || (Number(reg) * 1.5).toFixed(2);
              return `${c.name}: $${reg}/hr reg, $${ot}/hr OT`;
            }).join("; ");

            await tx.insert(projectLaborRates).values({
              projectId: createdProject.id,
              defaultRegularRate: regularRate,
              defaultOvertimeRate: overtimeRate,
              burdenMultiplier: "1.0000",
              notes: `Seeded from estimate classifications — ${classificationSummary}`,
            });
            console.log(`[Bid Conversion] Seeded project labor rate from primary classification: ${primary.name}`);
          }
        }
      }
    }

    const allSubQuotes = await tx
      .select()
      .from(subQuotesTable)
      .where(eq(subQuotesTable.bidId, bid.id));
    
    if (allSubQuotes.length > 0) {
      await tx
        .update(subQuotesTable)
        .set({ projectId: createdProject.id })
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
        
        subcontractor = await tx.query.subcontractors.findFirst({
          where: and(
            eq(subcontractors.companyName, quote.subcontractorName),
            or(...contactConditions)
          ),
        });
      }
      
      if (!subcontractor) {
        subcontractor = await tx.query.subcontractors.findFirst({
          where: eq(subcontractors.companyName, quote.subcontractorName),
        });
      }

      if (!subcontractor) {
        [subcontractor] = await tx.insert(subcontractors).values({
          companyName: quote.subcontractorName,
          contactName: quote.contactName || null,
          email: quote.contactEmail || null,
          phone: quote.contactPhone || null,
          notes: quote.notes || null,
          isActive: true,
        }).returning();
      }

      const contractNumber = `SC-${createdProject.code}-${String(subQuotes.indexOf(quote) + 1).padStart(3, '0')}`;
      const paymentTerms = quote.leadTime ? `Lead Time: ${quote.leadTime}`.substring(0, 500) : null;
      
      const notesParts: string[] = [];
      if (quote.estimatedCompletionTime) notesParts.push(`Estimated Completion: ${quote.estimatedCompletionTime}`);
      if (quote.notes) notesParts.push(quote.notes);
      if (quote.fileUrl) {
        const sanitizedFileName = (quote.fileName || 'Document').replace(/[\r\n]/g, ' ').trim();
        notesParts.push(`[Quote Attachment: ${sanitizedFileName}]`);
      }
      
      const notes = notesParts.length > 0 ? notesParts.join('\n').substring(0, 1000) : null;
      
      await tx.insert(subcontractorContracts).values({
        subcontractorId: subcontractor.id,
        projectId: createdProject.id,
        contractNumber,
        scopeOfWork: quote.scopeOfWork,
        contractAmount: quote.quoteAmount,
        status: "PENDING",
        paymentTerms,
        notes,
        createdById: req.user!.id,
      });
    }

    const allMatQuotes = await tx
      .select()
      .from(matQuotesTable)
      .where(eq(matQuotesTable.bidId, bid.id));
    
    if (allMatQuotes.length > 0) {
      await tx
        .update(matQuotesTable)
        .set({ projectId: createdProject.id })
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
      
      await tx.insert(procurementItems).values({
        projectId: createdProject.id,
        description: fullDescription,
        vendor: quote.supplierName || null,
        quantity: "1",
        unit: "LOT",
        unitCost: quote.cost,
        status: "PLANNED",
        neededByDate: null,
      });
    }

    const [existingPacket] = await tx
      .select()
      .from(handoffTable)
      .where(eq(handoffTable.bidId, bid.id))
      .limit(1);
    
    if (existingPacket) {
      await tx
        .update(handoffTable)
        .set({ 
          projectId: createdProject.id,
          awardDate: new Date().toISOString().split('T')[0],
          updatedAt: new Date()
        })
        .where(eq(handoffTable.id, existingPacket.id));
      
      console.log(`[Bid Conversion] Transferred handoff packet to project`);
    }

    const bidEquipSelections = await tx
      .select()
      .from(equipSelectionsTable)
      .where(eq(equipSelectionsTable.bidId, bid.id));
    
    if (bidEquipSelections.length > 0) {
      for (const selection of bidEquipSelections) {
        await tx.insert(equipPlansTable).values({
          projectId: createdProject.id,
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

    const bidDocs = await tx
      .select()
      .from(bidDocuments)
      .where(eq(bidDocuments.bidId, bid.id));

    if (bidDocs.length > 0) {
      for (const doc of bidDocs) {
        await tx.insert(planDocuments).values({
          projectId: createdProject.id,
          type: doc.type,
          title: doc.title,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          objectKey: doc.objectKey,
          fileSize: doc.fileSize,
          mimeType: doc.mimeType,
          uploadedById: doc.uploadedById,
        });
      }
      console.log(`[Bid Conversion] Transferred ${bidDocs.length} bid documents to project plan_documents`);
    }

    // Duplicate takeoff sheets, measurements, categories, and groups into new project
    const bidSheets = await tx.select().from(takeoffSheets).where(eq(takeoffSheets.bidId, bid.id));
    const bidCategories = await tx.select().from(quantityCategories).where(eq(quantityCategories.bidId, bid.id));
    const bidGroups = await tx.select().from(takeoffMeasurementGroups).where(eq(takeoffMeasurementGroups.bidId, bid.id));

    const categoryIdMap = new Map<string, string>();
    for (const cat of bidCategories) {
      const [newCat] = await tx.insert(quantityCategories).values({
        projectId: createdProject.id,
        name: cat.name,
        color: cat.color,
        lineStyle: cat.lineStyle,
        lineWidth: cat.lineWidth,
        wasteFactor: cat.wasteFactor,
        unitCost: cat.unitCost,
        displayOrder: cat.displayOrder,
      }).returning();
      categoryIdMap.set(cat.id, newCat.id);
    }

    const sheetIdMap = new Map<string, string>();
    for (const sheet of bidSheets) {
      const [newSheet] = await tx.insert(takeoffSheets).values({
        projectId: createdProject.id,
        imageUrl: sheet.imageUrl,
        sheetIndex: sheet.sheetIndex,
        sheetName: sheet.sheetName,
        scalePxPerFoot: sheet.scalePxPerFoot,
        units: sheet.units,
        folderGroup: sheet.folderGroup,
        revisionLabel: sheet.revisionLabel,
        isActive: true,
        rotation: sheet.rotation,
      }).returning();
      sheetIdMap.set(sheet.id, newSheet.id);
    }

    const groupIdMap = new Map<string, string>();
    for (const group of bidGroups) {
      const newSheetId = group.sheetId ? sheetIdMap.get(group.sheetId) || null : null;
      const [newGroup] = await tx.insert(takeoffMeasurementGroups).values({
        name: group.name,
        projectId: createdProject.id,
        sheetId: newSheetId,
        sortOrder: group.sortOrder,
        color: group.color,
      }).returning();
      groupIdMap.set(group.id, newGroup.id);
    }

    let measurementsCopied = 0;
    for (const [oldSheetId, newSheetId] of sheetIdMap) {
      const sheetVersions = await tx.select().from(takeoffVersions)
        .where(eq(takeoffVersions.sheetId, oldSheetId))
        .orderBy(takeoffVersions.versionNumber);
      const latestVersion = sheetVersions.length > 0 ? sheetVersions[sheetVersions.length - 1] : null;

      if (latestVersion) {
        const orphaned = await tx.select({ id: takeoffMeasurements.id }).from(takeoffMeasurements)
          .where(and(eq(takeoffMeasurements.sheetId, oldSheetId), sql`takeoff_measurements.takeoff_version_id IS NULL`));
        for (const m of orphaned) {
          await tx.update(takeoffMeasurements)
            .set({ takeoffVersionId: latestVersion.id })
            .where(eq(takeoffMeasurements.id, m.id));
        }
      }

      const bidMeasurements = latestVersion
        ? await tx.select().from(takeoffMeasurements)
            .where(and(eq(takeoffMeasurements.sheetId, oldSheetId), eq(takeoffMeasurements.takeoffVersionId, latestVersion.id)))
        : await tx.select().from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.sheetId, oldSheetId));

      const [projectVersion] = await tx.insert(takeoffVersions).values({
        projectId: createdProject.id,
        sheetId: newSheetId,
        versionNumber: 1,
        status: "DRAFT",
        createdById: req.user!.id,
        label: "Project Takeoff v1",
      }).returning();

      if (bidMeasurements.length > 0) {
        const clonedMeasurements = bidMeasurements.map(m => ({
          sheetId: newSheetId,
          categoryId: m.categoryId ? categoryIdMap.get(m.categoryId) || null : null,
          groupId: m.groupId ? groupIdMap.get(m.groupId) || null : null,
          takeoffVersionId: projectVersion.id,
          originMeasurementId: m.originMeasurementId || m.id,
          type: m.type,
          label: m.label,
          points: m.points,
          arcData: m.arcData,
          depthFeet: m.depthFeet,
          count: m.count,
          note: m.note,
          color: m.color,
          visible: m.visible,
          source: m.source,
          status: m.status,
          pitchRatio: m.pitchRatio,
          costCodeId: m.costCodeId,
          unitCost: m.unitCost,
          lineStyle: m.lineStyle,
          lineWidth: m.lineWidth,
          computedLengthFt: m.computedLengthFt,
          computedAreaFt2: m.computedAreaFt2,
          computedVolumeCy: m.computedVolumeCy,
          computedSurfaceAreaFt2: m.computedSurfaceAreaFt2,
          deductions: m.deductions,
          metadata: m.metadata,
          subcontractorId: m.subcontractorId,
          supplierId: m.supplierId,
          locationTag: m.locationTag,
          installationStatus: m.installationStatus,
        }));
        await tx.insert(takeoffMeasurements).values(clonedMeasurements);
        measurementsCopied += clonedMeasurements.length;
      }

      // Lock bid takeoff versions and handle unversioned measurements
      const bidVersions = await tx.select().from(takeoffVersions)
        .where(eq(takeoffVersions.sheetId, oldSheetId));
      if (bidVersions.length > 0) {
        const latestBidVersion = bidVersions[bidVersions.length - 1];
        const orphanedMeasurements = await tx.select({ id: takeoffMeasurements.id }).from(takeoffMeasurements)
          .where(and(eq(takeoffMeasurements.sheetId, oldSheetId), sql`takeoff_measurements.takeoff_version_id IS NULL`));
        for (const m of orphanedMeasurements) {
          await tx.update(takeoffMeasurements)
            .set({ takeoffVersionId: latestBidVersion.id })
            .where(eq(takeoffMeasurements.id, m.id));
        }
        for (const bv of bidVersions) {
          await tx.update(takeoffVersions)
            .set({ status: "LOCKED" })
            .where(eq(takeoffVersions.id, bv.id));
        }
      } else {
        const [lockedBidVersion] = await tx.insert(takeoffVersions).values({
          bidId: bid.id,
          sheetId: oldSheetId,
          versionNumber: 1,
          status: "LOCKED",
          createdById: req.user!.id,
          label: "Bid Takeoff (Locked)",
        }).returning();
        const unversioned = await tx.select({ id: takeoffMeasurements.id }).from(takeoffMeasurements)
          .where(and(eq(takeoffMeasurements.sheetId, oldSheetId), sql`takeoff_measurements.takeoff_version_id IS NULL`));
        for (const m of unversioned) {
          await tx.update(takeoffMeasurements)
            .set({ takeoffVersionId: lockedBidVersion.id })
            .where(eq(takeoffMeasurements.id, m.id));
        }
      }
    }
    console.log(`[Bid Conversion] Duplicated ${bidSheets.length} takeoff sheets with ${measurementsCopied} measurements, ${bidCategories.length} categories, ${bidGroups.length} groups to project`);

    await tx.update(bids)
      .set({
        status: "AWARDED",
        convertedToProjectId: createdProject.id,
        awardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(bids.code, req.params.code));

    return createdProject;
    }); // end db.transaction

    // Task #1386 — fire-and-forget Davis-Bacon auto-sync. Mirrors the
    // pattern used by projectCrudRoutes.ts and laborRateRoutes.ts so that
    // the moment a project is created with a wage decision attached, the
    // matching prevailing wage rates are queued for import.
    if (newProject.wageDecision && newProject.gcOrganizationId) {
      const orgId = newProject.gcOrganizationId;
      const decision = newProject.wageDecision;
      void queueWageDecisionSync(orgId, decision).catch((err) => {
        logError("[Bid Conversion] queueWageDecisionSync failed", {
          orgId,
          decision,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    try {
      const contractNum = `CTR-${newProject.code}-001`;
      const partiesStr = [bid.clientName].filter(Boolean).join(", ");
      const [newContract] = await db.insert(contractsTable).values({
        organizationId: newProject.gcOrganizationId,
        projectId: newProject.id,
        bidId: bid.id,
        contractNumber: contractNum,
        contractType: "PRIME",
        status: "DRAFT",
        parties: partiesStr || null,
        contractValue: contractAmount || null,
        scopeSummary: bid.description || null,
        currentVersion: 1,
        createdById: req.user!.id,
      }).returning();

      await db.insert(contractVersionsTable).values({
        contractId: newContract.id,
        versionNumber: 1,
        snapshotJson: JSON.stringify(newContract),
        changedById: req.user!.id,
        changeNote: "Auto-created from bid conversion",
      });
      console.log(`[Bid Conversion] Auto-created draft contract ${contractNum} for project ${newProject.code}`);
    } catch (contractErr) {
      const errMsg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      logError(`[Bid Conversion] Failed to auto-create contract: ${errMsg}`);
    }

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

    if (bodyProjectEngineerId) {
      await db.insert(notificationsTable).values({
        userId: bodyProjectEngineerId,
        type: "PROJECT_ASSIGNMENT",
        title: "New Project Assignment",
        message: `You have been assigned as Project Engineer for project "${newProject.name}" (${newProject.code})`,
        relatedEntityId: newProject.id,
        relatedEntityType: "project",
      });
      console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for project engineer ${bodyProjectEngineerId}`);
    }

    if (bodyForemanId) {
      await db.insert(notificationsTable).values({
        userId: bodyForemanId,
        type: "PROJECT_ASSIGNMENT",
        title: "New Project Assignment",
        message: `You have been assigned as Foreman for project "${newProject.name}" (${newProject.code})`,
        relatedEntityId: newProject.id,
        relatedEntityType: "project",
      });
      console.log(`[Bid Conversion] Created PROJECT_ASSIGNMENT notification for foreman ${bodyForemanId}`);
    }

    await logAudit({
      userId: req.user!.id,
      action: "CREATE",
      entityType: "project",
      entityId: newProject.id,
      newValue: `Converted bid ${bid.code} to project ${newProject.code} with ${bidEstimates.length} estimates`,
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
    logError("Convert bid error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.code === '23505') {
      res.status(409).json({ error: "Project with this code already exists" });
    } else {
      next(error);
    }
  }
});

// ====================
// Bid Subcontractor Quotes Routes
// ====================

router.get("/api/bids/:code/quotes", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:code/quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const validated = validateBody(insertBidSubcontractorQuoteSchema, {
      ...sanitizedBody,
      bidId: bid.id,
    }, res);
    if (!validated) return;

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
    logError("Create bid quote error:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

const updateSubQuoteSchema = z.object({
  subcontractorName: z.string().max(500).optional(),
  scopeOfWork: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().max(320).optional(),
  contactPhone: z.string().max(50).optional(),
  leadTime: z.string().max(200).nullable().optional(),
  estimatedCompletionTime: z.string().max(200).nullable().optional(),
  quoteAmount: z.union([z.string(), z.number()]).nullable().optional(),
  fileUrl: z.string().max(2000).nullable().optional(),
  fileName: z.string().max(500).nullable().optional(),
  inclusions: z.string().max(5000).nullable().optional(),
  exclusions: z.string().max(5000).nullable().optional(),
  isSelected: z.boolean().optional(),
});

router.patch("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");

    const zodResult = updateSubQuoteSchema.safeParse(req.body);
    if (!zodResult.success) {
      res.status(400).json({ error: "Invalid quote data", details: zodResult.error.errors });
      return;
    }

    if (zodResult.data.quoteAmount !== undefined && zodResult.data.quoteAmount !== null) {
      const amountCheck = validateMonetaryAmount(zodResult.data.quoteAmount, "Quote amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }
    }

    const sanitizedBody: any = {
      subcontractorName: zodResult.data.subcontractorName ? sanitizeShortText(zodResult.data.subcontractorName) : undefined,
      scopeOfWork: zodResult.data.scopeOfWork ? sanitizeText(zodResult.data.scopeOfWork) : undefined,
      notes: zodResult.data.notes ? sanitizeText(zodResult.data.notes) : undefined,
      contactName: zodResult.data.contactName ? sanitizeShortText(zodResult.data.contactName) : undefined,
      contactEmail: zodResult.data.contactEmail ? sanitizeEmail(zodResult.data.contactEmail) : undefined,
      contactPhone: zodResult.data.contactPhone ? sanitizePhone(zodResult.data.contactPhone) : undefined,
      leadTime: zodResult.data.leadTime,
      estimatedCompletionTime: zodResult.data.estimatedCompletionTime,
      quoteAmount: zodResult.data.quoteAmount,
      fileUrl: zodResult.data.fileUrl,
      fileName: zodResult.data.fileName,
      inclusions: zodResult.data.inclusions !== undefined ? sanitizeText(zodResult.data.inclusions || "") : undefined,
      exclusions: zodResult.data.exclusions !== undefined ? sanitizeText(zodResult.data.exclusions || "") : undefined,
    };
    
    if (zodResult.data.isSelected !== undefined) {
      sanitizedBody.isSelected = zodResult.data.isSelected;
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
    logError("Update bid quote error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid quote data", details: error.errors });
    } else {
      next(error);
    }
  }
});

router.delete("/api/bids/:code/quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:code/quotes/:quoteId/send-rfq", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const { overrideEmail } = req.body as { overrideEmail?: string };
    const recipientEmail = overrideEmail || quote.contactEmail;
    if (!recipientEmail) {
      res.status(400).json({ error: "Quote has no contact email. Add a contact email first." });
      return;
    }

    if (overrideEmail && overrideEmail !== quote.contactEmail) {
      await db
        .update(bidSubcontractorQuotes)
        .set({ contactEmail: overrideEmail, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, quote.id));
    }

    const [gcOrg] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, bid.gcOrganizationId));

    const crypto = await import("crypto");
    const responseToken = crypto.randomBytes(32).toString("hex");

    const sent = await sendRfqEmail(
      recipientEmail,
      quote.contactName || "",
      bid.name || "Untitled Bid",
      quote.scopeOfWork,
      gcOrg?.name || "Unknown",
      "subcontractor",
      bid.dueDate ? new Date(bid.dueDate) : undefined,
      responseToken
    );

    if (sent) {
      await db
        .update(bidSubcontractorQuotes)
        .set({ rfqSentAt: new Date(), rfqStatus: "sent", rfqResponseToken: responseToken, updatedAt: new Date() })
        .where(eq(bidSubcontractorQuotes.id, quote.id));

      const [updated] = await db
        .select()
        .from(bidSubcontractorQuotes)
        .where(eq(bidSubcontractorQuotes.id, quote.id))
        .limit(1);

      res.json(updated);
    } else {
      next(error);
    }
  } catch (error) {
    next(error);
  }
});

// ====================
// Bid Material Quotes Routes
// ====================

router.get("/api/bids/:code/material-quotes", requireAuth, async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:code/material-quotes", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const validated = validateBody(insertBidMaterialQuoteSchema, {
      ...sanitizedBody,
      bidId: bid.id,
    }, res);
    if (!validated) return;

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
    logError("Create bid material quote error:", {}, error instanceof Error ? error : new Error(String(error)));
    next(error);
  }
});

const updateMaterialQuoteSchema = z.object({
  materialName: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  specs: z.string().max(5000).optional(),
  leadTime: z.string().max(200).optional(),
  supplierName: z.string().max(500).optional(),
  supplierContact: z.string().max(500).optional(),
  supplierEmail: z.string().max(320).optional(),
  cost: z.union([z.string(), z.number()]).nullable().optional(),
  fileUrl: z.string().max(2000).nullable().optional(),
  fileName: z.string().max(500).nullable().optional(),
  isSelected: z.boolean().optional(),
});

router.patch("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidMaterialQuotes } = await import("@shared/schema");

    const zodResult = updateMaterialQuoteSchema.safeParse(req.body);
    if (!zodResult.success) {
      res.status(400).json({ error: "Invalid material quote data", details: zodResult.error.errors });
      return;
    }

    if (zodResult.data.cost !== undefined && zodResult.data.cost !== null) {
      const costCheck = validateMonetaryAmount(zodResult.data.cost, "Material cost");
      if (!costCheck.valid) {
        res.status(400).json({ error: costCheck.error });
        return;
      }
    }

    const sanitizedBody: any = {
      materialName: zodResult.data.materialName ? sanitizeShortText(zodResult.data.materialName) : undefined,
      description: zodResult.data.description ? sanitizeText(zodResult.data.description) : undefined,
      specs: zodResult.data.specs ? sanitizeText(zodResult.data.specs) : undefined,
      leadTime: zodResult.data.leadTime ? sanitizeShortText(zodResult.data.leadTime) : undefined,
      supplierName: zodResult.data.supplierName ? sanitizeShortText(zodResult.data.supplierName) : undefined,
      supplierContact: zodResult.data.supplierContact ? sanitizeText(zodResult.data.supplierContact) : undefined,
      supplierEmail: zodResult.data.supplierEmail ? sanitizeEmail(zodResult.data.supplierEmail) : undefined,
      cost: zodResult.data.cost,
      fileUrl: zodResult.data.fileUrl,
      fileName: zodResult.data.fileName,
    };
    
    if (zodResult.data.isSelected !== undefined) {
      sanitizedBody.isSelected = zodResult.data.isSelected;
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
    logError("Update bid material quote error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid material quote data", details: error.errors });
    } else {
      next(error);
    }
  }
});

router.delete("/api/bids/:code/material-quotes/:quoteId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.post("/api/bids/:code/material-quotes/:quoteId/send-rfq", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
      next(error);
    }
  } catch (error) {
    next(error);
  }
});

// ====================
// Handoff Packet Routes (Job Information for QuickBooks)
// ====================

router.get("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.put("/api/bids/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const optStr = z.string().max(2000).nullable().optional();
    const optBool = z.boolean().nullable().optional();
    const handoffPacketSchema = z.object({
      gcName: optStr, gcContactName: optStr, gcPhone: optStr, gcEmail: optStr,
      accessDetails: optStr, scopeOfWorkSummary: optStr, contractValue: optStr,
      bidDate: optStr, awardDate: optStr, markupPercent: optStr, duration: optStr,
      projectStartDate: optStr, projectCompletionDate: optStr, manpower: optStr,
      alternates: optStr, subcontractExecuted: optBool, insuranceCerts: optStr,
      bondRequired: optBool, permits: optStr, retentionPercent: optStr,
      paymentTerms: optStr, scheduleOfValuesReady: optBool, drawSchedule: optStr,
      prevailingWage: optBool, concreteSupplier: optStr, mixInfo: optStr,
      rebarVendor: optStr, formingMaterialPlan: optStr, curingSpecs: optStr,
      specialItems: optStr, leadTimeRisks: optStr, submittalStatus: optStr,
      layoutSurveyBy: optStr, benchmarkInfo: optStr, accessZones: optStr,
      workHours: optStr, safetyOrientation: optStr, inspectionNeeds: optStr,
      coordinationIssues: optStr, weatherRisks: optStr, soilConditions: optStr,
      estimatorNotes: optStr, gcContactMethod: optStr, projectManager: optStr,
      superintendent: optStr, officeAdmin: optStr, safetyContact: optStr,
    });
    const parsed = validateBody(handoffPacketSchema, req.body || {}, res);
    if (!parsed) return;

    const packetData = {
      bidId: bid.id,
      gcName: parsed.gcName || null,
      gcContactName: parsed.gcContactName || null,
      gcPhone: parsed.gcPhone || null,
      gcEmail: parsed.gcEmail || null,
      accessDetails: parsed.accessDetails || null,
      scopeOfWorkSummary: parsed.scopeOfWorkSummary || null,
      contractValue: parsed.contractValue || null,
      bidDate: parsed.bidDate || null,
      awardDate: parsed.awardDate || null,
      markupPercent: parsed.markupPercent || null,
      duration: parsed.duration || null,
      projectStartDate: parsed.projectStartDate || null,
      projectCompletionDate: parsed.projectCompletionDate || null,
      manpower: parsed.manpower || null,
      alternates: parsed.alternates || null,
      subcontractExecuted: parsed.subcontractExecuted ?? null,
      insuranceCerts: parsed.insuranceCerts || null,
      bondRequired: parsed.bondRequired ?? null,
      permits: parsed.permits || null,
      retentionPercent: parsed.retentionPercent || null,
      paymentTerms: parsed.paymentTerms || null,
      scheduleOfValuesReady: parsed.scheduleOfValuesReady ?? null,
      drawSchedule: parsed.drawSchedule || null,
      prevailingWage: parsed.prevailingWage ?? null,
      concreteSupplier: parsed.concreteSupplier || null,
      mixInfo: parsed.mixInfo || null,
      rebarVendor: parsed.rebarVendor || null,
      formingMaterialPlan: parsed.formingMaterialPlan || null,
      curingSpecs: parsed.curingSpecs || null,
      specialItems: parsed.specialItems || null,
      leadTimeRisks: parsed.leadTimeRisks || null,
      submittalStatus: parsed.submittalStatus || null,
      layoutSurveyBy: parsed.layoutSurveyBy || null,
      benchmarkInfo: parsed.benchmarkInfo || null,
      accessZones: parsed.accessZones || null,
      workHours: parsed.workHours || null,
      safetyOrientation: parsed.safetyOrientation || null,
      inspectionNeeds: parsed.inspectionNeeds || null,
      coordinationIssues: parsed.coordinationIssues || null,
      weatherRisks: parsed.weatherRisks || null,
      soilConditions: parsed.soilConditions || null,
      estimatorNotes: parsed.estimatorNotes || null,
      gcContactMethod: parsed.gcContactMethod || null,
      projectManager: parsed.projectManager || null,
      superintendent: parsed.superintendent || null,
      officeAdmin: parsed.officeAdmin || null,
      safetyContact: parsed.safetyContact || null,
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
    next(error);
  }
});

router.get("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

router.put("/api/projects/:code/handoff-packet", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
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
    next(error);
  }
});

// ====================
// Bid PDF Generation Routes
// ====================

router.get("/api/bids/:code/pdf/internal-summary", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), exportLimiter, async (req: AuthRequest, res, next) => {
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

    const orgBranding = await getOrganizationBranding(bid.gcOrganizationId);

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
      branding: orgBranding,
    };

    const pdfStream = generateInternalBidSummaryPDF(pdfData);

    const brandName = orgBranding.organizationName || 'SmartManageAI';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${brandName}-Internal-Summary-${bid.code}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:code/pdf/customer-quote", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), exportLimiter, async (req: AuthRequest, res, next) => {
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

    const orgBranding = await getOrganizationBranding(bid.gcOrganizationId);

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
      branding: orgBranding,
    };

    const pdfStream = generateCustomerQuotePDF(pdfData);

    const brandName = orgBranding.organizationName || 'SmartManageAI';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${brandName}-Quote-${bid.code}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:code/pdf/warranty-contract", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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

    const orgBranding = await getOrganizationBranding(bid.gcOrganizationId);

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
      },
      branding: {
        organizationName: orgBranding.organizationName,
        primaryColor: orgBranding.primaryColor,
        accentColor: orgBranding.accentColor,
      },
    };

    const pdfStream = generateWarrantyContractPDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${orgBranding.organizationName.replace(/[^a-zA-Z0-9]/g, '-')}-Warranty-Contract-${bid.code}.pdf"`);

    pdfStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

// ==================
// Bid Documents (Plans & Takeoff)
// ==================

router.get("/api/bids/:code/documents", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const docs = await db.select().from(bidDocuments).where(eq(bidDocuments.bidId, bid.id)).orderBy(desc(bidDocuments.uploadedAt));
    res.json(docs);
  } catch (error) {
    next(error);
  }
});

router.post("/api/bids/:code/documents", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
      type: z.enum(["PLANS", "SPECS", "TAKEOFF", "OTHER", "BIM"]).default("OTHER"),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    const data = parsed.data;

    // Verify the storage reference actually belongs to the caller's org so a
    // tenant cannot register a bid document that points at another tenant's
    // private object.
    const supplied = data.objectKey || data.fileUrl;
    let normalizedObjectKey: string | undefined = data.objectKey;
    if (supplied) {
      try {
        await assertStorageKeyBelongsToOrg(supplied, bid.gcOrganizationId!, req.user!.id, req.user!.role);
      } catch (err: any) {
        return res.status(err?.status || 403).json({ error: err?.message || "Forbidden" });
      }

      // Persist an ACL policy on the underlying object so the read endpoints
      // (preview-url / stream) — which call canAccessObjectEntity as
      // defense-in-depth — can resolve tenancy. Without this, every bid
      // document upload returned 403 on preview because getObjectAclPolicy
      // resolved to null and canAccessObject defaults to deny.
      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        normalizedObjectKey = await objectStorageService.trySetObjectEntityAclPolicy(
          supplied,
          {
            owner: req.user!.id,
            organizationId: bid.gcOrganizationId!,
            visibility: "private",
          },
        );
      } catch (err) {
        logError("Bid document ACL policy write failed:", {}, err instanceof Error ? err : new Error(String(err)));
        // Do not block the upload; the read endpoint has a backfill that will
        // set the policy on first preview if it is still missing.
      }
    }

    const [doc] = await db.insert(bidDocuments).values({
      bidId: bid.id,
      title: data.title,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      objectKey: normalizedObjectKey ?? data.objectKey,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      type: data.type,
      uploadedById: req.user!.id,
    }).returning();

    res.status(201).json(doc);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/bids/:code/documents/:docId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
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
        logError("Error deleting bid document from object storage:", {}, error instanceof Error ? error : new Error(String(error)));
      }
    }

    await db.delete(bidDocuments).where(eq(bidDocuments.id, req.params.docId));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Shared helper: resolves a bid document for the preview / stream
// endpoints. Authorization model: anyone who can list a bid's documents
// (verifyOrgAccess on the bid's gcOrganizationId) can also view the
// individual files. The list endpoint at GET /api/bids/:code/documents
// uses the same gate, so the read endpoints must match — otherwise users
// see a file in the list and get a 403 trying to open it.
//
// Defense-in-depth against a forged or imported bidDocuments row whose
// storageKey points at another tenant's object: every legitimate upload
// goes through `getObjectEntityUploadURL` which builds the path as
// `<privateObjectDir>/<orgId>/uploads/<uuid>`, normalized to
// `/objects/<orgId>/uploads/<uuid>`. We verify the second path segment
// (the encoded orgId) matches the bid's gcOrganizationId before piping
// any bytes back. This catches the forgery scenario without depending
// on the role-based filePermissions / ESTIMATOR-assigned-bid checks
// that gate `canAccessObject` — those checks deny legitimate org
// members and were the reason every preview returned 403.
async function resolveBidDocumentForRead(
  req: AuthRequest,
  res: any,
): Promise<{ objectStorageService: import("./objectStorage").ObjectStorageService; objectFile: import("@google-cloud/storage").File } | null> {
  const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return null;
  }
  if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return null;

  const [doc] = await db.select().from(bidDocuments)
    .where(and(eq(bidDocuments.id, req.params.docId), eq(bidDocuments.bidId, bid.id)))
    .limit(1);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return null;
  }
  const storageKey = doc.objectKey || doc.fileUrl;
  if (!storageKey) {
    res.status(404).json({ error: "No file associated with this document" });
    return null;
  }

  const { ObjectStorageService } = await import("./objectStorage");
  const objectStorageService = new ObjectStorageService();
  const normalized = objectStorageService.normalizeObjectEntityPath(storageKey);

  // Tenancy gate on the storage key itself. Normalized form is always
  // `/objects/<orgId>/uploads/<uuid>` for files uploaded via the
  // standard signed-URL flow. If the path doesn't carry the bid's org as
  // its first segment, the row is pointing at someone else's object —
  // refuse rather than serve it.
  const expectedOrgId = bid.gcOrganizationId;
  let storageKeyOrgId: string | null = null;
  if (normalized.startsWith("/objects/")) {
    const parts = normalized.slice("/objects/".length).split("/");
    storageKeyOrgId = parts[0] || null;
  }
  // SUPER_ADMIN is allowed to bypass for support/oversight, mirroring
  // the carve-out in canAccessObject.
  const userRole = (req.user as any).effectiveRole || req.user!.role;
  const isSuperAdmin = userRole === "SUPER_ADMIN";
  if (!isSuperAdmin && (!storageKeyOrgId || storageKeyOrgId !== expectedOrgId)) {
    logError("Bid document storage key tenancy mismatch", {
      bidId: bid.id,
      docId: doc.id,
      bidOrg: expectedOrgId,
      storageKeyOrg: storageKeyOrgId,
    });
    res.status(403).json({ error: "Forbidden" });
    return null;
  }

  const objectFile = await objectStorageService.getObjectEntityFile(normalized);

  // Best-effort ACL backfill so other code paths that DO check the ACL
  // policy (e.g. signed download URLs, future audits) see a coherent
  // policy on the object. We don't gate this request on the result —
  // tenancy was already proven above.
  try {
    const { getObjectAclPolicy } = await import("./objectAcl");
    const existing = await getObjectAclPolicy(objectFile);
    if (!existing) {
      await objectStorageService.trySetObjectEntityAclPolicy(storageKey, {
        owner: doc.uploadedById || req.user!.id,
        organizationId: bid.gcOrganizationId!,
        visibility: "private",
      });
    }
  } catch (backfillErr) {
    logError("Bid document ACL backfill skipped:", {}, backfillErr instanceof Error ? backfillErr : new Error(String(backfillErr)));
  }

  return { objectStorageService, objectFile };
}

router.get("/api/bids/:code/documents/:docId/preview-url", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const resolved = await resolveBidDocumentForRead(req, res);
    if (!resolved) return;
    await resolved.objectStorageService.downloadObject(resolved.objectFile, res, 3600);
  } catch (error) {
    logError("Bid document preview-url error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      next(error);
    }
  }
});

router.get("/api/bids/:code/documents/:docId/stream", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const resolved = await resolveBidDocumentForRead(req, res);
    if (!resolved) return;
    await resolved.objectStorageService.downloadObject(resolved.objectFile, res, 3600);
  } catch (error) {
    logError("Bid document stream error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) {
      next(error);
    }
  }
});

router.post("/api/bids/:code/submit", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const bid = await db.query.bids.findFirst({ where: eq(bids.code, req.params.code) });
    if (!bid) return res.status(404).json({ error: "Bid not found" });

    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const allowedTransitions = BID_STATUS_TRANSITIONS[bid.status] || [];
    if (!allowedTransitions.includes("SUBMITTED") && bid.status !== "SUBMITTED") {
      return res.status(422).json({
        error: `Cannot submit bid from status ${bid.status}. Bid must be in DRAFT, ACTIVE, or SUBMITTED status.`,
      });
    }

    const bidSubmitSchema = z.object({
      recipientEmail: z.string().email().optional(),
    });
    const parsed = validateBody(bidSubmitSchema, req.body || {}, res);
    if (!parsed) return;

    const { recipientEmail } = parsed;
    const toEmail = recipientEmail || bid.clientContactEmail;

    if (!toEmail) {
      return res.status(400).json({ error: "No recipient email provided and no client contact email on bid" });
    }

    const esc = (str: string): string => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const finalAmount = bid.bidAmount ? `₱${Number(bid.bidAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "To be discussed";
    const parsedDueDate = bid.dueDate ? new Date(bid.dueDate) : null;
    const dueDate = (parsedDueDate && !isNaN(parsedDueDate.getTime())) ? parsedDueDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "To be discussed";
    const projectLocation = [bid.locationAddress, bid.city, bid.state].filter(Boolean).join(", ") || "To be discussed";

    const { organizations } = await import("@shared/schema");
    const sender = req.user!;
    const senderFullName = [sender.firstName, sender.lastName].filter(Boolean).join(" ") || "";
    const senderRole = sender.role || "";
    const senderEmail = sender.email || "";
    const senderPhone = sender.phone || "";

    let orgName = "";
    let orgPhone = "";
    let orgEmail = "";
    if (sender.organizationId) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, sender.organizationId)).limit(1);
      if (org) {
        orgName = org.name || "";
        orgPhone = org.phone || "";
        orgEmail = org.email || "";
      }
    }

    let scopeOfWorkHtml = "";
    let scopeOfWorkText = "";
    try {
      const latestEstimate = await db.query.estimates.findFirst({
        where: eq(estimates.bidId, bid.id),
        orderBy: [desc(estimates.versionNumber)],
      });
      if (latestEstimate) {
        const lineItems = await db.select().from(estimateLineItems).where(eq(estimateLineItems.estimateId, latestEstimate.id));
        if (lineItems.length > 0) {
          scopeOfWorkHtml = lineItems.map(item => `<li style="margin-bottom: 6px; color: #333;">${esc(item.description)}</li>`).join("\n");
          scopeOfWorkText = lineItems.map(item => `  - ${item.description}`).join("\n");
        }
      }
    } catch (e) {
      logError("[bid] scope of work fetch failed, using defaults:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    if (!scopeOfWorkHtml) {
      if (bid.description) {
        scopeOfWorkHtml = `<li style="margin-bottom: 6px; color: #333;">${esc(bid.description)}</li>`;
        scopeOfWorkText = `  - ${bid.description}`;
      } else {
        scopeOfWorkHtml = `<li style="margin-bottom: 6px; color: #333;">As per project requirements (to be discussed)</li>`;
        scopeOfWorkText = `  - As per project requirements (to be discussed)`;
      }
    }

    const clientGreeting = bid.clientContactName || bid.clientName || "Valued Client";

    const signOffParts = [
      senderFullName ? `<strong>${esc(senderFullName)}</strong>` : null,
      senderRole ? `<span style="color: #555;">${esc(senderRole)}</span>` : null,
      orgName ? `<span style="color: #555;">${esc(orgName)}</span>` : null,
      (senderPhone || orgPhone) ? `<span style="color: #555;">Contact: ${esc(senderPhone || orgPhone)}</span>` : null,
      (senderEmail || orgEmail) ? `<span style="color: #555;">Email: ${esc(senderEmail || orgEmail)}</span>` : null,
    ].filter(Boolean);
    const signOffHtml = signOffParts.length > 0 ? signOffParts.join("<br/>") : `<span style="color: #555;">Your Project Team</span>`;

    const signOffTextParts = [
      senderFullName || null,
      senderRole || null,
      orgName || null,
      (senderPhone || orgPhone) ? `Contact: ${senderPhone || orgPhone}` : null,
      (senderEmail || orgEmail) ? `Email: ${senderEmail || orgEmail}` : null,
    ].filter(Boolean);
    const signOffText = signOffTextParts.length > 0 ? signOffTextParts.join("\n") : "Your Project Team";

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; color: #333;">
        <h2 style="color: #1a1a1a; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">Bid Proposal: ${esc(bid.name)}</h2>

        <p>Dear ${esc(clientGreeting)},</p>
        <p>Thank you for the opportunity to submit our bid for the above-mentioned project. We are pleased to present the following proposal for your review and consideration.</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f5f5f5;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Project Name</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${esc(bid.name)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Location</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${esc(projectLocation)}</td>
          </tr>
          <tr style="background: #f5f5f5;">
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Bid Reference</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-family: monospace;">${esc(bid.code)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Total Bid Price</td>
            <td style="padding: 10px; border: 1px solid #ddd; font-size: 1.1em; color: #2563eb; font-weight: bold;">${esc(finalAmount)}</td>
          </tr>
        </table>

        <h3 style="color: #1a1a1a; margin-top: 30px;">Scope of Work Includes:</h3>
        <ul style="padding-left: 20px; line-height: 1.8;">
          ${scopeOfWorkHtml}
        </ul>

        <h3 style="color: #1a1a1a; margin-top: 30px;">Project Timeline:</h3>
        <p>Target completion date: ${esc(dueDate)}</p>
        <p>Detailed project schedule will be provided upon contract award.</p>

        <h3 style="color: #1a1a1a; margin-top: 30px;">Inclusions:</h3>
        <ul style="padding-left: 20px; line-height: 1.8;">
          <li style="margin-bottom: 6px;">All labor and materials as described in scope of work</li>
          <li style="margin-bottom: 6px;">Equipment and tools required for the project</li>
          <li style="margin-bottom: 6px;">Standard site cleanup upon completion</li>
        </ul>

        <h3 style="color: #1a1a1a; margin-top: 30px;">Exclusions:</h3>
        <ul style="padding-left: 20px; line-height: 1.8;">
          <li style="margin-bottom: 6px;">Permit fees (unless otherwise stated)</li>
          <li style="margin-bottom: 6px;">Work outside the defined scope</li>
          <li style="margin-bottom: 6px;">Unforeseen subsurface conditions</li>
        </ul>

        <h3 style="color: #1a1a1a; margin-top: 30px;">Payment Terms:</h3>
        <ul style="padding-left: 20px; line-height: 1.8;">
          <li style="margin-bottom: 6px;">Payment terms to be discussed and agreed upon prior to commencement</li>
          <li style="margin-bottom: 6px;">Progress billing may apply for projects exceeding 30 days</li>
        </ul>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />

        <p>We look forward to your favorable response. Should you have any questions or require further clarification, please do not hesitate to contact us.</p>

        <p style="margin-top: 20px;">Warm regards,</p>
        <div style="margin-top: 10px; line-height: 1.8;">
          ${signOffHtml}
        </div>
      </div>
    `;

    const emailText = [
      `Bid Proposal: ${bid.name}`,
      ``,
      `Dear ${clientGreeting},`,
      ``,
      `Thank you for the opportunity to submit our bid for the above-mentioned project. We are pleased to present the following proposal for your review and consideration.`,
      ``,
      `Project Name: ${bid.name}`,
      `Location: ${projectLocation}`,
      `Bid Reference: ${bid.code}`,
      `Total Bid Price: ${finalAmount}`,
      ``,
      `Scope of Work Includes:`,
      scopeOfWorkText,
      ``,
      `Project Timeline:`,
      `  Target completion date: ${dueDate}`,
      `  Detailed project schedule will be provided upon contract award.`,
      ``,
      `Inclusions:`,
      `  - All labor and materials as described in scope of work`,
      `  - Equipment and tools required for the project`,
      `  - Standard site cleanup upon completion`,
      ``,
      `Exclusions:`,
      `  - Permit fees (unless otherwise stated)`,
      `  - Work outside the defined scope`,
      `  - Unforeseen subsurface conditions`,
      ``,
      `Payment Terms:`,
      `  - Payment terms to be discussed and agreed upon prior to commencement`,
      `  - Progress billing may apply for projects exceeding 30 days`,
      ``,
      `We look forward to your favorable response. Should you have any questions or require further clarification, please do not hesitate to contact us.`,
      ``,
      `Warm regards,`,
      signOffText,
    ].join("\n");

    const emailSent = await sendEmail({
      to: toEmail,
      subject: `Bid Proposal: ${bid.name} (Ref: ${bid.code})`,
      html: emailHtml,
      text: emailText,
    });

    if (!emailSent) {
      console.warn(`[Bid Submit] Email send failed for bid ${bid.code} to ${toEmail}`);
    }

    const statusUpdate: any = { submittedAt: new Date(), updatedAt: new Date() };
    const oldStatus = bid.status;
    const allowedForSubmit = BID_STATUS_TRANSITIONS[oldStatus] || [];
    if (allowedForSubmit.includes("SUBMITTED")) {
      statusUpdate.status = "SUBMITTED";
    }

    const [updatedBid] = await db.update(bids)
      .set(statusUpdate)
      .where(eq(bids.code, req.params.code))
      .returning();

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "bid",
      entityId: bid.id,
      newValue: `Bid submitted to client at ${toEmail}`,
    }, req);

    await eventBus.emit({
      type: "bid.submitted",
      version: 1,
      orgId: bid.gcOrganizationId || req.user!.organizationId || "",
      actorId: req.user!.id,
      timestamp: new Date(),
      payload: {
        bidId: bid.id,
        bidCode: bid.code,
        title: bid.name,
        clientName: bid.clientName || "",
      },
    });

    if (statusUpdate.status && statusUpdate.status !== oldStatus) {
      await eventBus.emit({
        type: "bid.status_changed",
        version: 1,
        orgId: bid.gcOrganizationId || req.user!.organizationId || "",
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          bidId: bid.id,
          bidCode: bid.code,
          title: bid.name,
          oldStatus,
          newStatus: statusUpdate.status,
        },
      });
    }

    res.json({ success: true, submittedAt: updatedBid.submittedAt, emailSent });
  } catch (error) {
    next(error);
  }
});

router.get("/api/public/rfq-response/:token", async (req, res, next) => {
  try {
    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const { organizations } = await import("@shared/schema");

    const [quote] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.rfqResponseToken, req.params.token))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Invalid or expired RFQ link" });
      return;
    }

    const bid = quote.bidId
      ? (await db.select().from(bids).where(eq(bids.id, quote.bidId)).limit(1))[0]
      : null;

    let gcOrgName = "Unknown";
    if (bid?.gcOrganizationId) {
      const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, bid.gcOrganizationId)).limit(1);
      if (org) gcOrgName = org.name;
    }

    res.json({
      quoteId: quote.id,
      bidName: bid?.name || "Project",
      gcOrganizationName: gcOrgName,
      scopeOfWork: quote.scopeOfWork,
      subcontractorName: quote.subcontractorName,
      dueDate: bid?.dueDate || null,
      alreadyResponded: quote.rfqStatus === "responded",
    });
  } catch (error) {
    next(error);
  }
});

interface MulterFile {
  filename: string;
  originalname: string;
  size: number;
  mimetype: string;
}

interface MulterRequest extends Request {
  files?: MulterFile[];
}

router.post("/api/public/rfq-response/:token", async (req, res, next) => {
  let parsedFiles: MulterFile[] = [];

  try {
    const multer = (await import("multer")).default;
    const upload = multer({
      dest: "uploads/rfq-responses",
      limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    }).array("attachments", 5);

    await new Promise<void>((resolve, reject) => {
      upload(req, res, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });

    parsedFiles = ((req as MulterRequest).files || []);
  } catch (uploadErr: unknown) {
    const multerErr = uploadErr as { code?: string };
    if (multerErr?.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "File too large. Maximum 10MB per file." });
      return;
    }
    res.status(400).json({ error: "File upload failed" });
    return;
  }

  try {
    const { bidSubcontractorQuotes } = await import("@shared/schema");

    const [quote] = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.rfqResponseToken, req.params.token))
      .limit(1);

    if (!quote) {
      res.status(404).json({ error: "Invalid or expired RFQ link" });
      return;
    }

    if (quote.rfqStatus === "responded") {
      res.status(400).json({ error: "This quote has already been submitted. Please contact the GC directly to make changes." });
      return;
    }

    const rfqSentAt = quote.rfqSentAt ? new Date(quote.rfqSentAt).getTime() : 0;
    const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
    if (rfqSentAt && Date.now() - rfqSentAt > TOKEN_EXPIRY_MS) {
      res.status(410).json({ error: "This RFQ link has expired. Please request a new one from the GC." });
      return;
    }

    const quoteAmount = req.body.quoteAmount as string;
    const leadTime = req.body.leadTime as string | undefined;
    const notes = req.body.notes as string | undefined;
    const contactName = req.body.contactName as string | undefined;
    const contactPhone = req.body.contactPhone as string | undefined;

    if (!quoteAmount || isNaN(parseFloat(quoteAmount)) || parseFloat(quoteAmount) < 0) {
      res.status(400).json({ error: "A valid quote amount is required" });
      return;
    }

    const attachmentsMeta = parsedFiles.map(f => ({
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    const existingNotes = quote.notes || "";
    const responseNotes = notes ? `${existingNotes ? existingNotes + "\n\n" : ""}[Sub Response] ${notes}` : existingNotes;

    await db
      .update(bidSubcontractorQuotes)
      .set({
        quoteAmount,
        leadTime: leadTime || quote.leadTime,
        notes: responseNotes,
        contactName: contactName || quote.contactName,
        contactPhone: contactPhone || quote.contactPhone,
        rfqStatus: "responded",
        rfqResponseToken: null,
        rfqResponseAttachmentsJson: attachmentsMeta.length > 0 ? JSON.stringify(attachmentsMeta) : null,
        updatedAt: new Date(),
      })
      .where(eq(bidSubcontractorQuotes.id, quote.id));

    res.json({ success: true, message: "Quote submitted successfully" });
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:code/bid-leveling", requireAuth, async (req: AuthRequest, res, next) => {
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
      .orderBy(bidSubcontractorQuotes.scopeOfWork, bidSubcontractorQuotes.quoteAmount);

    const scopeGroups: Record<string, any[]> = {};
    for (const q of quotes) {
      const scope = q.scopeOfWork || "Unspecified";
      if (!scopeGroups[scope]) scopeGroups[scope] = [];
      scopeGroups[scope].push(q);
    }

    const leveling = Object.entries(scopeGroups).map(([scope, scopeQuotes]) => {
      const amounts = scopeQuotes.map(q => Number(q.quoteAmount));
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const stdDev = Math.sqrt(amounts.reduce((sum, val) => sum + Math.pow(val - avgAmount, 2), 0) / amounts.length);
      const outlierThreshold = avgAmount + 1.5 * stdDev;

      return {
        scope,
        quotes: scopeQuotes.map(q => ({
          ...q,
          isLowBid: Number(q.quoteAmount) === minAmount,
          isOutlier: Number(q.quoteAmount) > outlierThreshold,
          variance: avgAmount > 0 ? ((Number(q.quoteAmount) - avgAmount) / avgAmount * 100).toFixed(1) : "0",
        })),
        summary: {
          count: scopeQuotes.length,
          lowBid: minAmount,
          highBid: maxAmount,
          average: Math.round(avgAmount * 100) / 100,
          spread: maxAmount - minAmount,
          selectedQuote: scopeQuotes.find(q => q.isSelected)?.id || null,
        },
      };
    });

    res.json({ bidId: bid.id, bidCode: bid.code, leveling });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/bids/:code/quotes/:quoteId/select", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const [bid] = await db.select().from(bids).where(eq(bids.code, req.params.code)).limit(1);
    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, bid.gcOrganizationId)) return;

    const { bidSubcontractorQuotes } = await import("@shared/schema");
    const { quoteId } = req.params;

    const [quote] = await db.select().from(bidSubcontractorQuotes)
      .where(and(eq(bidSubcontractorQuotes.id, quoteId), eq(bidSubcontractorQuotes.bidId, bid.id)));
    if (!quote) {
      res.status(404).json({ error: "Quote not found" });
      return;
    }

    await db.update(bidSubcontractorQuotes)
      .set({ isSelected: false, updatedAt: new Date() })
      .where(and(eq(bidSubcontractorQuotes.bidId, bid.id), eq(bidSubcontractorQuotes.scopeOfWork, quote.scopeOfWork)));

    await db.update(bidSubcontractorQuotes)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(bidSubcontractorQuotes.id, quoteId));

    res.json({ success: true, selectedQuoteId: quoteId });
  } catch (error) {
    next(error);
  }
});

export default router;
