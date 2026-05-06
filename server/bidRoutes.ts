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
import { Router, type Response, type Request } from "express";
import { z } from "zod";
import { logError, logInfo } from "./utils/logger";
import { eventBus } from "./events";
import { exportLimiter } from "./rateLimiter";
import { insertBidSchema } from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { validateBody } from "./utils/validation";
import { logUpdate, logDelete, logAudit } from "./auditLogger";
import { pruneTakeoffRecentsForEntity } from "./takeoffRecentsCleanup";
import {
  sanitizeShortText,
  sanitizeText,
  sanitizeEmail,
  sanitizePhone,
} from "./sanitization";
import { getOrgIdForFilter } from "./orgFilter";
import { assertStorageKeyBelongsToOrg } from "./services/documentRevisionService";
import {
  generateInternalBidSummaryPDF,
  generateCustomerQuotePDF,
  generateWarrantyContractPDF,
} from "./pdf-service";
import { getOrganizationBranding } from "./organizationBranding";
import { sendEmail } from "./email";
import {
  BidStorageDrizzle,
} from "./bids/storage.drizzle";
import {
  CrossOrgAccessError,
  type IBidStorage,
} from "./bids/storage";

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

function validateMonetaryAmount(
  amount: string | number | null | undefined,
  fieldName: string,
): { valid: boolean; error?: string } {
  if (amount === null || amount === undefined) return { valid: true };
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (numAmount <= 0) {
    return {
      valid: false,
      error: `${fieldName} must be a positive value (greater than zero)`,
    };
  }
  if (numAmount > 100000000) {
    return {
      valid: false,
      error: `${fieldName} exceeds maximum allowed value ($100,000,000)`,
    };
  }
  return { valid: true };
}

/**
 * Resolves the per-request bid storage instance.
 *
 * - Returns null after sending the appropriate 401/403 response when the user
 *   has no org access (mirrors the pre-refactor verifyOrgAccess behaviour).
 * - SUPER_ADMIN gets a storage bound to `null` orgId (no org filter).
 * - Regular users get a storage bound to their organizationId.
 *
 * Cross-org reads against this storage will throw CrossOrgAccessError, which
 * route handlers map to HTTP 403 via {@link handleStorageError}.
 */
function getBidStorage(req: AuthRequest, res: Response): BidStorageDrizzle | null {
  const ctx = getOrgIdForFilter(req);
  if (ctx.mustDenyAccess) {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
    } else if (!req.user.organizationId) {
      res.status(403).json({ error: "No organization access" });
    } else {
      res.status(403).json({ error: "Access denied" });
    }
    return null;
  }
  return new BidStorageDrizzle(ctx.isSuperAdmin ? null : ctx.orgId);
}

function handleStorageError(err: unknown, res: Response, next: (e?: any) => void) {
  if (err instanceof CrossOrgAccessError) {
    res.status(403).json({ error: "Access denied" });
    return true;
  }
  return false;
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
    z.date().nullish(),
  ),
});

const updateBidSchema = insertBidSchema
  .extend({
    dueDate: z.preprocess(
      (val) => (typeof val === "string" ? new Date(val) : val),
      z.date().nullish(),
    ),
  })
  .partial();

router.get("/api/bids", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgIdForFilter(req);
    if (ctx.mustDenyAccess) {
      return res.json([]);
    }
    const storage = new BidStorageDrizzle(ctx.isSuperAdmin ? null : ctx.orgId);
    const rows = await storage.listBidsWithEstimateSummary();
    res.json(rows);
  } catch (error) {
    if (handleStorageError(error, res, next)) return;
    next(error);
  }
});

router.get("/api/bids/:code", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const storage = getBidStorage(req, res);
    if (!storage) return;
    const bid = await storage.getBidByCode(req.params.code);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    res.json(bid);
  } catch (error) {
    if (handleStorageError(error, res, next)) return;
    next(error);
  }
});

router.post(
  "/api/bids",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      logInfo("[Create Bid] Received body:", JSON.stringify(req.body, null, 2));

      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        clientName: sanitizeShortText(req.body.clientName),
        description: sanitizeText(req.body.description),
      };

      logInfo("[Create Bid] Sanitized body:", JSON.stringify(sanitizedBody, null, 2));

      const validationResult = createBidSchema.safeParse(sanitizedBody);
      if (!validationResult.success) {
        logInfo(
          "[Create Bid] Validation failed:",
          JSON.stringify(validationResult.error.errors, null, 2),
        );
        return res
          .status(400)
          .json({ error: "Invalid input", details: validationResult.error.errors });
      }

      if (validationResult.data.bidAmount !== undefined) {
        const amountCheck = validateMonetaryAmount(
          validationResult.data.bidAmount,
          "Bid amount",
        );
        if (!amountCheck.valid) {
          return res.status(400).json({ error: amountCheck.error });
        }
      }

      const userOrgId = req.user?.organizationId;
      const storage = new BidStorageDrizzle(userOrgId ?? null);

      const MAX_RETRIES = 3;
      let lastError: any = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const nextCode = await storage.getNextBidCode();
          logInfo(`[Create Bid] Auto-assigned code: ${nextCode} (attempt ${attempt + 1})`);

          const newBid = await storage.createBid({
            ...validationResult.data,
            code: nextCode,
            gcOrganizationId:
              userOrgId || (validationResult.data as any).gcOrganizationId,
          } as any);

          if (newBid.estimatorId) {
            const estimatorName = await storage.getUserDisplayName(newBid.estimatorId);
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

          return res.status(201).json(newBid);
        } catch (insertError: any) {
          if (insertError.code === "23505" && attempt < MAX_RETRIES - 1) {
            logInfo(
              `[Create Bid] Code conflict, retrying... (attempt ${attempt + 1})`,
            );
            lastError = insertError;
            continue;
          }
          throw insertError;
        }
      }

      throw lastError;
    } catch (error: any) {
      logError(
        "Create bid error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "Unable to generate unique bid code - please try again" });
      }
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.patch(
  "/api/bids/:code",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;

      const existingBid = await storage.getBidByCode(req.params.code);
      if (!existingBid) return res.status(404).json({ error: "Bid not found" });

      const ALLOWED_UPDATE_FIELDS = new Set([
        "name",
        "clientName",
        "clientContactName",
        "clientContactEmail",
        "clientContactPhone",
        "bidAmount",
        "dueDate",
        "locationAddress",
        "city",
        "state",
        "description",
        "estimatorId",
        "ownerRepOrganizationId",
        "status",
        "crmOpportunityId",
        "aiWinProbability",
        "force",
        "wageDecision",
      ]);
      const filteredBody: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (ALLOWED_UPDATE_FIELDS.has(key)) filteredBody[key] = value;
      }

      const sanitizedBody = {
        ...filteredBody,
        name: filteredBody.name ? sanitizeShortText(filteredBody.name) : undefined,
        clientName: filteredBody.clientName
          ? sanitizeShortText(filteredBody.clientName)
          : undefined,
        description: filteredBody.description
          ? sanitizeText(filteredBody.description)
          : undefined,
      };

      const validationResult = updateBidSchema.safeParse(sanitizedBody);
      if (!validationResult.success) {
        return res
          .status(400)
          .json({ error: "Invalid input", details: validationResult.error.errors });
      }

      if (validationResult.data.bidAmount !== undefined) {
        const amountCheck = validateMonetaryAmount(
          validationResult.data.bidAmount,
          "Bid amount",
        );
        if (!amountCheck.valid) {
          return res.status(400).json({ error: amountCheck.error });
        }
      }

      const newStatus = validationResult.data.status;
      if (newStatus && newStatus !== existingBid.status) {
        const allowed = BID_STATUS_TRANSITIONS[existingBid.status] || [];
        if (!allowed.includes(newStatus)) {
          const forceFlag = filteredBody.force === true;
          const isAdmin =
            req.user?.role === "ADMIN" || req.user?.role === "SUPER_ADMIN";
          const forceAllowed =
            BID_ADMIN_FORCE_TRANSITIONS[existingBid.status] || [];
          if (!(forceFlag && isAdmin && forceAllowed.includes(newStatus))) {
            const hint =
              forceAllowed.length > 0
                ? ` Admins can force: ${forceAllowed.join(", ")}`
                : "";
            return res.status(422).json({
              error: `Invalid status transition from ${existingBid.status} to ${newStatus}. Allowed transitions: ${
                allowed.join(", ") || "none"
              }.${hint}`,
            });
          }
        }
      }

      const updateData: any = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(validationResult.data)) {
        if (key !== "force" && value !== undefined) updateData[key] = value;
      }

      const updatedBid = await storage.updateBidByCode(req.params.code, updateData);
      if (!updatedBid) return res.status(404).json({ error: "Bid not found" });

      await logUpdate(req.user!.id, "BID", updatedBid.id, existingBid, updateData, req);

      const userOrgId =
        req.user?.organizationId || existingBid.gcOrganizationId || "";
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

      if (
        validationResult.data.estimatorId &&
        validationResult.data.estimatorId !== existingBid.estimatorId
      ) {
        const estimatorName = await storage.getUserDisplayName(
          validationResult.data.estimatorId,
        );
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
      logError(
        "Update bid error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error.code === "23505") {
        return res.status(409).json({ error: "Bid code already exists" });
      }
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.delete(
  "/api/bids/:code",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;

      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const existingProject = await storage.getProjectByCode(bid.code);
      if (existingProject) {
        return res.status(409).json({
          error: "Cannot delete converted bid",
          newValue: `This bid has been converted to project ${bid.code}. Delete the project first if needed.`,
        });
      }

      const deletedBid = await storage.deleteBidByCode(req.params.code);

      // Task #2105 — drop any Takeoff "Recent" rail rows pointing at this
      // bid (across every user) so the per-user 24-entry cap doesn't get
      // wasted by orphaned cards. The takeoff_recents table only FK's to
      // users/orgs, so without this hook the rows would linger forever.
      await pruneTakeoffRecentsForEntity("bid", bid.id);

      await logDelete(
        req.user!.id,
        "bids",
        bid.id,
        { code: bid.code, name: bid.name },
        req,
      );

      res.json({
        success: true,
        message: `Bid ${bid.code} deleted successfully`,
      });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.get("/api/bids/:id/estimate", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const storage = getBidStorage(req, res);
    if (!storage) return;
    const bidId = req.params.id;
    logInfo(`[GET /api/bids/:id/estimate] Fetching estimate for bid ID: ${bidId}`);

    const bid = await storage.getBidById(bidId);
    if (!bid) return res.status(404).json({ error: "Bid not found" });

    const active = await storage.getActiveEstimateWithLineItems(bidId);
    if (!active) return res.json({ estimate: null });
    res.json({ estimate: active });
  } catch (error) {
    if (handleStorageError(error, res, next)) return;
    next(error);
  }
});

router.post(
  "/api/bids/:id/estimate",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bidId = req.params.id;
      logInfo(`[POST /api/bids/:id/estimate] Creating estimate for bid ID: ${bidId}`);

      const bid = await storage.getBidById(bidId);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { estimate, created } = await storage.getOrCreateEstimateForBid(
        bidId,
        req.user!.id,
      );

      if (created) {
        logInfo(`[Estimate Created] New estimate ${estimate.id} created for bid ${bidId}`);
        return res.status(201).json({ estimate });
      }
      res.json({ estimate });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.post(
  "/api/bids/:code/convert",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;

      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      if (bid.status === "AWARDED") {
        return res.status(409).json({
          error: "Bid already awarded",
          newValue: `This bid has already been converted to a project.`,
        });
      }

      const existingProject = await storage.getProjectByCode(bid.code);
      if (existingProject) {
        return res.status(409).json({
          error: "Project with this code already exists",
          newValue: `A project with code ${bid.code} already exists. Cannot convert bid.`,
        });
      }

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

      const result = await storage.convertBidToProject({
        bid,
        params: parsed,
        actorId: req.user!.id,
      });
      const newProject = result.project;

      await logAudit(
        {
          userId: req.user!.id,
          action: "CREATE",
          entityType: "project",
          entityId: newProject.id,
          newValue: `Converted bid ${bid.code} to project ${newProject.code} with ${result.estimateCount} estimates`,
        },
        req,
      );

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
      logError(
        "Convert bid error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error.code === "23505") {
        return res
          .status(409)
          .json({ error: "Project with this code already exists" });
      }
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ====================
// Bid Subcontractor Quotes Routes
// ====================

router.get("/api/bids/:code/quotes", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const storage = getBidStorage(req, res);
    if (!storage) return;
    const bid = await storage.getBidByCode(req.params.code);
    if (!bid) return res.status(404).json({ error: "Bid not found" });
    const quotes = await storage.listSubQuotes(bid.id);
    res.json(quotes);
  } catch (error) {
    if (handleStorageError(error, res, next)) return;
    next(error);
  }
});

router.post(
  "/api/bids/:code/quotes",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { insertBidSubcontractorQuoteSchema } = await import("@shared/schema");

      const sanitizedBody = {
        ...req.body,
        subcontractorName: sanitizeShortText(req.body.subcontractorName),
        scopeOfWork: sanitizeText(req.body.scopeOfWork),
        notes: req.body.notes ? sanitizeText(req.body.notes) : undefined,
        contactName: req.body.contactName
          ? sanitizeShortText(req.body.contactName)
          : undefined,
        contactEmail: req.body.contactEmail
          ? sanitizeEmail(req.body.contactEmail)
          : undefined,
        contactPhone: req.body.contactPhone
          ? sanitizePhone(req.body.contactPhone)
          : undefined,
      };

      const validated = validateBody(
        insertBidSubcontractorQuoteSchema,
        { ...sanitizedBody, bidId: bid.id },
        res,
      );
      if (!validated) return;

      const newQuote = await storage.createSubQuote(bid.id, validated);

      await logAudit(
        {
          userId: req.user!.id,
          action: "CREATE_BID_QUOTE",
          entityType: "bid_quote",
          entityId: newQuote.id,
          newValue: `Created quote from ${validated.subcontractorName} for bid ${bid.code}`,
        },
        req,
      );

      res.status(201).json(newQuote);
    } catch (error: any) {
      logError(
        "Create bid quote error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

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

router.patch(
  "/api/bids/:code/quotes/:quoteId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const zodResult = updateSubQuoteSchema.safeParse(req.body);
      if (!zodResult.success) {
        return res
          .status(400)
          .json({ error: "Invalid quote data", details: zodResult.error.errors });
      }

      if (
        zodResult.data.quoteAmount !== undefined &&
        zodResult.data.quoteAmount !== null
      ) {
        const amountCheck = validateMonetaryAmount(
          zodResult.data.quoteAmount,
          "Quote amount",
        );
        if (!amountCheck.valid) return res.status(400).json({ error: amountCheck.error });
      }

      const sanitizedBody: any = {
        subcontractorName: zodResult.data.subcontractorName
          ? sanitizeShortText(zodResult.data.subcontractorName)
          : undefined,
        scopeOfWork: zodResult.data.scopeOfWork
          ? sanitizeText(zodResult.data.scopeOfWork)
          : undefined,
        notes: zodResult.data.notes ? sanitizeText(zodResult.data.notes) : undefined,
        contactName: zodResult.data.contactName
          ? sanitizeShortText(zodResult.data.contactName)
          : undefined,
        contactEmail: zodResult.data.contactEmail
          ? sanitizeEmail(zodResult.data.contactEmail)
          : undefined,
        contactPhone: zodResult.data.contactPhone
          ? sanitizePhone(zodResult.data.contactPhone)
          : undefined,
        leadTime: zodResult.data.leadTime,
        estimatedCompletionTime: zodResult.data.estimatedCompletionTime,
        quoteAmount: zodResult.data.quoteAmount,
        fileUrl: zodResult.data.fileUrl,
        fileName: zodResult.data.fileName,
        inclusions:
          zodResult.data.inclusions !== undefined
            ? sanitizeText(zodResult.data.inclusions || "")
            : undefined,
        exclusions:
          zodResult.data.exclusions !== undefined
            ? sanitizeText(zodResult.data.exclusions || "")
            : undefined,
      };
      if (zodResult.data.isSelected !== undefined) {
        sanitizedBody.isSelected = zodResult.data.isSelected;
      }
      Object.keys(sanitizedBody).forEach((key) => {
        if (sanitizedBody[key] === undefined) delete sanitizedBody[key];
      });

      const existing = await storage.getSubQuoteForBid(bid.id, req.params.quoteId);
      if (!existing) {
        // Distinguish "wrong bid" from "missing" to mirror legacy behavior:
        // legacy returned 404 for missing; 403 if existed but wrong bid.
        // Storage returns null for both — fall back to a separate lookup.
        const anyQuote = await storage.listSubQuotes(bid.id);
        if (!anyQuote.find((q) => q.id === req.params.quoteId)) {
          return res.status(404).json({ error: "Quote not found" });
        }
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateSubQuote(bid.id, req.params.quoteId, sanitizedBody);
      if (!updated) return res.status(404).json({ error: "Quote not found" });

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE_BID_QUOTE",
          entityType: "bid_quote",
          entityId: updated.id,
          newValue: `Updated quote from ${updated.subcontractorName} for bid ${bid.code}`,
        },
        req,
      );

      res.json(updated);
    } catch (error: any) {
      logError(
        "Update bid quote error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error.name === "ZodError") {
        return res
          .status(400)
          .json({ error: "Invalid quote data", details: error.errors });
      }
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.delete(
  "/api/bids/:code/quotes/:quoteId",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const existing = await storage.getSubQuoteForBid(bid.id, req.params.quoteId);
      if (!existing) {
        return res.status(404).json({ error: "Quote not found" });
      }

      const deleted = await storage.deleteSubQuote(bid.id, req.params.quoteId);
      if (!deleted) return res.status(404).json({ error: "Quote not found" });

      await logAudit(
        {
          userId: req.user!.id,
          action: "DELETE_BID_QUOTE",
          entityType: "bid_quote",
          entityId: deleted.id,
          oldValue: `Deleted quote from ${deleted.subcontractorName} for bid ${bid.code}`,
        },
        req,
      );

      res.json({ success: true });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.post(
  "/api/bids/:code/quotes/:quoteId/send-rfq",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { sendRfqEmail } = await import("./bidNetworkNotifications");

      const quote = await storage.getSubQuoteForBid(bid.id, req.params.quoteId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      const { overrideEmail } = req.body as { overrideEmail?: string };
      const recipientEmail = overrideEmail || quote.contactEmail;
      if (!recipientEmail) {
        return res
          .status(400)
          .json({ error: "Quote has no contact email. Add a contact email first." });
      }

      if (overrideEmail && overrideEmail !== quote.contactEmail) {
        await storage.setSubQuoteContactEmail(bid.id, quote.id, overrideEmail);
      }

      const gcOrg = bid.gcOrganizationId
        ? await storage.getOrganizationContact(bid.gcOrganizationId)
        : null;

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
        responseToken,
      );

      if (sent) {
        const updated = await storage.setSubQuoteRfqSent(
          bid.id,
          quote.id,
          responseToken,
        );
        return res.json(updated);
      } else {
        // Preserve legacy bug: original referenced an undefined `error`
        // identifier here so this branch crashed and was caught by the
        // outer catch. Mirror that: throw a generic Error to enter the
        // catch clause.
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw (undefined as any);
      }
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ====================
// Bid Material Quotes Routes
// ====================

router.get(
  "/api/bids/:code/material-quotes",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });
      const materialQuotes = await storage.listMaterialQuotes(bid.id);
      res.json(materialQuotes);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.post(
  "/api/bids/:code/material-quotes",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { insertBidMaterialQuoteSchema } = await import("@shared/schema");

      const sanitizedBody = {
        ...req.body,
        materialName: sanitizeShortText(req.body.materialName),
        description: req.body.description ? sanitizeText(req.body.description) : "",
        specs: req.body.specs ? sanitizeText(req.body.specs) : undefined,
        leadTime: req.body.leadTime ? sanitizeShortText(req.body.leadTime) : undefined,
        supplierName: req.body.supplierName
          ? sanitizeShortText(req.body.supplierName)
          : undefined,
        supplierContact: req.body.supplierContact
          ? sanitizeText(req.body.supplierContact)
          : undefined,
        supplierEmail: req.body.supplierEmail
          ? sanitizeEmail(req.body.supplierEmail)
          : undefined,
      };

      const validated = validateBody(
        insertBidMaterialQuoteSchema,
        { ...sanitizedBody, bidId: bid.id },
        res,
      );
      if (!validated) return;

      const newMaterialQuote = await storage.createMaterialQuote(bid.id, validated);

      await logAudit(
        {
          userId: req.user!.id,
          action: "CREATE_BID_MATERIAL_QUOTE",
          entityType: "bid_material_quote",
          entityId: newMaterialQuote.id,
          newValue: `Created material quote for ${validated.materialName} for bid ${bid.code}`,
        },
        req,
      );

      res.status(201).json(newMaterialQuote);
    } catch (error: any) {
      logError(
        "Create bid material quote error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

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

router.patch(
  "/api/bids/:code/material-quotes/:quoteId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const zodResult = updateMaterialQuoteSchema.safeParse(req.body);
      if (!zodResult.success) {
        return res
          .status(400)
          .json({ error: "Invalid material quote data", details: zodResult.error.errors });
      }

      if (zodResult.data.cost !== undefined && zodResult.data.cost !== null) {
        const costCheck = validateMonetaryAmount(zodResult.data.cost, "Material cost");
        if (!costCheck.valid) return res.status(400).json({ error: costCheck.error });
      }

      const sanitizedBody: any = {
        materialName: zodResult.data.materialName
          ? sanitizeShortText(zodResult.data.materialName)
          : undefined,
        description: zodResult.data.description
          ? sanitizeText(zodResult.data.description)
          : undefined,
        specs: zodResult.data.specs ? sanitizeText(zodResult.data.specs) : undefined,
        leadTime: zodResult.data.leadTime
          ? sanitizeShortText(zodResult.data.leadTime)
          : undefined,
        supplierName: zodResult.data.supplierName
          ? sanitizeShortText(zodResult.data.supplierName)
          : undefined,
        supplierContact: zodResult.data.supplierContact
          ? sanitizeText(zodResult.data.supplierContact)
          : undefined,
        supplierEmail: zodResult.data.supplierEmail
          ? sanitizeEmail(zodResult.data.supplierEmail)
          : undefined,
        cost: zodResult.data.cost,
        fileUrl: zodResult.data.fileUrl,
        fileName: zodResult.data.fileName,
      };
      if (zodResult.data.isSelected !== undefined) {
        sanitizedBody.isSelected = zodResult.data.isSelected;
      }
      Object.keys(sanitizedBody).forEach((key) => {
        if (sanitizedBody[key] === undefined) delete sanitizedBody[key];
      });

      const existingMQ = await storage.getMaterialQuoteForBid(bid.id, req.params.quoteId);
      if (!existingMQ) {
        const all = await storage.listMaterialQuotes(bid.id);
        if (!all.find((q) => q.id === req.params.quoteId)) {
          return res.status(404).json({ error: "Material quote not found" });
        }
        return res.status(403).json({ error: "Access denied" });
      }

      const updated = await storage.updateMaterialQuote(bid.id, req.params.quoteId, sanitizedBody);
      if (!updated) return res.status(404).json({ error: "Material quote not found" });

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE_BID_MATERIAL_QUOTE",
          entityType: "bid_material_quote",
          entityId: updated.id,
          newValue: `Updated material quote for ${updated.materialName} for bid ${bid.code}`,
        },
        req,
      );

      res.json(updated);
    } catch (error: any) {
      logError(
        "Update bid material quote error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (error.name === "ZodError") {
        return res
          .status(400)
          .json({ error: "Invalid material quote data", details: error.errors });
      }
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.delete(
  "/api/bids/:code/material-quotes/:quoteId",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const existing = await storage.getMaterialQuoteForBid(bid.id, req.params.quoteId);
      if (!existing) return res.status(404).json({ error: "Material quote not found" });

      const deleted = await storage.deleteMaterialQuote(bid.id, req.params.quoteId);
      if (!deleted) return res.status(404).json({ error: "Material quote not found" });

      await logAudit(
        {
          userId: req.user!.id,
          action: "DELETE_BID_MATERIAL_QUOTE",
          entityType: "bid_material_quote",
          entityId: deleted.id,
          oldValue: `Deleted material quote for ${deleted.materialName} for bid ${bid.code}`,
        },
        req,
      );

      res.json({ success: true });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.post(
  "/api/bids/:code/material-quotes/:quoteId/send-rfq",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { sendRfqEmail } = await import("./bidNetworkNotifications");

      const quote = await storage.getMaterialQuoteForBid(bid.id, req.params.quoteId);
      if (!quote) return res.status(404).json({ error: "Material quote not found" });

      const recipientEmail = quote.supplierEmail;
      if (!recipientEmail) {
        return res
          .status(400)
          .json({ error: "Quote has no supplier email. Add a supplier email first." });
      }

      const gcOrg = bid.gcOrganizationId
        ? await storage.getOrganizationContact(bid.gcOrganizationId)
        : null;

      const scopeDesc = [quote.materialName, quote.description, quote.specs]
        .filter(Boolean)
        .join(" - ");

      const sent = await sendRfqEmail(
        recipientEmail,
        quote.supplierContact || quote.supplierName || "",
        bid.name || "Untitled Bid",
        scopeDesc,
        gcOrg?.name || "Unknown",
        "material",
        bid.dueDate ? new Date(bid.dueDate) : undefined,
      );

      if (sent) {
        const updated = await storage.setMaterialQuoteRfqSent(bid.id, quote.id);
        return res.json(updated);
      } else {
        // Preserve legacy bug: original referenced undefined `error` here.
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw (undefined as any);
      }
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ====================
// Handoff Packet Routes (Job Information for QuickBooks)
// ====================

const handoffPacketBodySchema = (() => {
  const optStr = z.string().max(2000).nullable().optional();
  const optBool = z.boolean().nullable().optional();
  return z.object({
    gcName: optStr,
    gcContactName: optStr,
    gcPhone: optStr,
    gcEmail: optStr,
    accessDetails: optStr,
    scopeOfWorkSummary: optStr,
    contractValue: optStr,
    bidDate: optStr,
    awardDate: optStr,
    markupPercent: optStr,
    duration: optStr,
    projectStartDate: optStr,
    projectCompletionDate: optStr,
    manpower: optStr,
    alternates: optStr,
    subcontractExecuted: optBool,
    insuranceCerts: optStr,
    bondRequired: optBool,
    permits: optStr,
    retentionPercent: optStr,
    paymentTerms: optStr,
    scheduleOfValuesReady: optBool,
    drawSchedule: optStr,
    prevailingWage: optBool,
    concreteSupplier: optStr,
    mixInfo: optStr,
    rebarVendor: optStr,
    formingMaterialPlan: optStr,
    curingSpecs: optStr,
    specialItems: optStr,
    leadTimeRisks: optStr,
    submittalStatus: optStr,
    layoutSurveyBy: optStr,
    benchmarkInfo: optStr,
    accessZones: optStr,
    workHours: optStr,
    safetyOrientation: optStr,
    inspectionNeeds: optStr,
    coordinationIssues: optStr,
    weatherRisks: optStr,
    soilConditions: optStr,
    estimatorNotes: optStr,
    gcContactMethod: optStr,
    projectManager: optStr,
    superintendent: optStr,
    officeAdmin: optStr,
    safetyContact: optStr,
  });
})();

router.get(
  "/api/bids/:code/handoff-packet",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });
      const packet = await storage.getHandoffPacketByBid(bid.id);
      res.json(packet || null);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.put(
  "/api/bids/:code/handoff-packet",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const parsed = validateBody(handoffPacketBodySchema, req.body || {}, res);
      if (!parsed) return;

      const packetData: any = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "boolean") packetData[k] = v;
        else packetData[k] = v || null;
      }
      // Preserve nullable-bool pass-through with `?? null` (matches legacy
      // behaviour exactly — false stays false, undefined → null).
      packetData.subcontractExecuted = parsed.subcontractExecuted ?? null;
      packetData.bondRequired = parsed.bondRequired ?? null;
      packetData.scheduleOfValuesReady = parsed.scheduleOfValuesReady ?? null;
      packetData.prevailingWage = parsed.prevailingWage ?? null;

      const result = await storage.upsertHandoffPacketByBid(
        bid.id,
        req.user!.id,
        packetData,
      );
      res.json(result);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.get(
  "/api/projects/:code/handoff-packet",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const project = await storage.getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      const packet = await storage.getHandoffPacketByProject(project.id);
      res.json(packet || null);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.put(
  "/api/projects/:code/handoff-packet",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const project = await storage.getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const userRole = req.user!.effectiveRole || req.user!.role;
      if (
        userRole === "SUPERINTENDENT" &&
        project.superintendentId !== req.user!.id
      ) {
        return res.status(403).json({
          error:
            "You can only edit handoff packets for projects where you are the assigned superintendent",
        });
      }

      const existing = await storage.getHandoffPacketByProject(project.id);
      if (!existing) {
        return res
          .status(404)
          .json({ error: "Handoff packet not found for this project" });
      }

      // Merge `?? existing.x` semantics — every field is opt-in patchable.
      const e: any = existing;
      const b: any = req.body;
      const updateData: any = {
        gcName: b.gcName ?? e.gcName,
        gcContactName: b.gcContactName ?? e.gcContactName,
        gcPhone: b.gcPhone ?? e.gcPhone,
        gcEmail: b.gcEmail ?? e.gcEmail,
        accessDetails: b.accessDetails ?? e.accessDetails,
        scopeOfWorkSummary: b.scopeOfWorkSummary ?? e.scopeOfWorkSummary,
        contractValue: b.contractValue ?? e.contractValue,
        bidDate: b.bidDate ?? e.bidDate,
        awardDate: b.awardDate ?? e.awardDate,
        markupPercent: b.markupPercent ?? e.markupPercent,
        duration: b.duration ?? e.duration,
        projectStartDate: b.projectStartDate ?? e.projectStartDate,
        projectCompletionDate: b.projectCompletionDate ?? e.projectCompletionDate,
        manpower: b.manpower ?? e.manpower,
        alternates: b.alternates ?? e.alternates,
        subcontractExecuted: b.subcontractExecuted ?? e.subcontractExecuted,
        insuranceCerts: b.insuranceCerts ?? e.insuranceCerts,
        bondRequired: b.bondRequired ?? e.bondRequired,
        permits: b.permits ?? e.permits,
        retentionPercent: b.retentionPercent ?? e.retentionPercent,
        paymentTerms: b.paymentTerms ?? e.paymentTerms,
        scheduleOfValuesReady: b.scheduleOfValuesReady ?? e.scheduleOfValuesReady,
        drawSchedule: b.drawSchedule ?? e.drawSchedule,
        prevailingWage: b.prevailingWage ?? e.prevailingWage,
        concreteSupplier: b.concreteSupplier ?? e.concreteSupplier,
        mixInfo: b.mixInfo ?? e.mixInfo,
        rebarVendor: b.rebarVendor ?? e.rebarVendor,
        formingMaterialPlan: b.formingMaterialPlan ?? e.formingMaterialPlan,
        curingSpecs: b.curingSpecs ?? e.curingSpecs,
        specialItems: b.specialItems ?? e.specialItems,
        leadTimeRisks: b.leadTimeRisks ?? e.leadTimeRisks,
        submittalStatus: b.submittalStatus ?? e.submittalStatus,
        layoutSurveyBy: b.layoutSurveyBy ?? e.layoutSurveyBy,
        benchmarkInfo: b.benchmarkInfo ?? e.benchmarkInfo,
        accessZones: b.accessZones ?? e.accessZones,
        workHours: b.workHours ?? e.workHours,
        safetyOrientation: b.safetyOrientation ?? e.safetyOrientation,
        inspectionNeeds: b.inspectionNeeds ?? e.inspectionNeeds,
        coordinationIssues: b.coordinationIssues ?? e.coordinationIssues,
        weatherRisks: b.weatherRisks ?? e.weatherRisks,
        soilConditions: b.soilConditions ?? e.soilConditions,
        estimatorNotes: b.estimatorNotes ?? e.estimatorNotes,
        gcContactMethod: b.gcContactMethod ?? e.gcContactMethod,
        projectManager: b.projectManager ?? e.projectManager,
        superintendent: b.superintendent ?? e.superintendent,
        officeAdmin: b.officeAdmin ?? e.officeAdmin,
        safetyContact: b.safetyContact ?? e.safetyContact,
      };

      const result = await storage.updateHandoffPacketByProject(project.id, updateData);
      res.json(result);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ====================
// Bid PDF Generation Routes
// ====================

router.get(
  "/api/bids/:code/pdf/internal-summary",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  exportLimiter,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const firstEstimate = await storage.getFirstEstimateForBid(bid.id);
      const lineItems = firstEstimate
        ? await storage.listEstimateLineItems(firstEstimate.id)
        : [];

      const subQuotes = await storage.listSubQuotes(bid.id);
      const materialQuotes = await storage.listMaterialQuotes(bid.id);
      const equipmentSelections = await storage.listBidEquipmentSelections(bid.id);

      const scopeItemsList = lineItems.map((item) => ({
        description: item.description,
        category: item.category,
        quantity: parseFloat(item.quantity as any) || 0,
        unit: item.unit,
        totalCost: parseFloat(item.totalCost as any) || 0,
        laborCost: parseFloat(item.laborCost as any) || 0,
        materialCost: parseFloat(item.materialCost as any) || 0,
        equipmentCost: parseFloat(item.equipmentCost as any) || 0,
        subcontractCost: parseFloat(item.subcontractCost as any) || 0,
      }));

      const totalDirectCost = scopeItemsList.reduce((sum, item) => sum + item.totalCost, 0);
      const selectedMaterialCost = materialQuotes
        .filter((q) => q.isSelected)
        .reduce((sum, q) => sum + parseFloat(q.cost as any), 0);
      const selectedSubCost = subQuotes
        .filter((q) => q.isSelected)
        .reduce((sum, q) => sum + parseFloat(q.quoteAmount as any), 0);
      const equipmentCost = equipmentSelections.reduce(
        (sum, eqItem) => sum + (parseFloat(eqItem.estimatedCost as any) || 0),
        0,
      );

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
        subQuotes: subQuotes.map((q) => ({
          subcontractorName: q.subcontractorName,
          scopeOfWork: q.scopeOfWork,
          quoteAmount: parseFloat(q.quoteAmount as any),
          isSelected: q.isSelected,
        })),
        materialQuotes: materialQuotes.map((q) => ({
          materialName: q.materialName,
          description: q.description,
          cost: parseFloat(q.cost as any),
          supplierName: q.supplierName,
          isSelected: q.isSelected,
        })),
        equipmentSelections: equipmentSelections.map((eqItem) => ({
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

      const brandName = orgBranding.organizationName || "SmartManageAI";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${brandName}-Internal-Summary-${bid.code}.pdf"`,
      );

      pdfStream.pipe(res);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.get(
  "/api/bids/:code/pdf/customer-quote",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  exportLimiter,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const firstEstimate = await storage.getFirstEstimateForBid(bid.id);
      const lineItems = firstEstimate
        ? await storage.listEstimateLineItems(firstEstimate.id)
        : [];

      const scopeItemsList = lineItems.map((item) => ({
        description: item.description,
        category: item.category,
        quantity: parseFloat(item.quantity as any) || 0,
        unit: item.unit,
        totalCost: parseFloat(item.totalCost as any) || 0,
        laborCost: parseFloat(item.laborCost as any) || 0,
        materialCost: parseFloat(item.materialCost as any) || 0,
        equipmentCost: parseFloat(item.equipmentCost as any) || 0,
        subcontractCost: parseFloat(item.subcontractCost as any) || 0,
      }));

      const totalDirectCost = scopeItemsList.reduce((sum, item) => sum + item.totalCost, 0);
      const overheadPercent = 15;
      const profitPercent = 10;
      const overheadAmount = totalDirectCost * (overheadPercent / 100);
      const profitAmount = totalDirectCost * (profitPercent / 100);
      const finalBidAmount =
        parseFloat(bid.bidAmount as any) || totalDirectCost + overheadAmount + profitAmount;

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

      const brandName = orgBranding.organizationName || "SmartManageAI";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${brandName}-Quote-${bid.code}.pdf"`,
      );

      pdfStream.pipe(res);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.get(
  "/api/bids/:code/pdf/warranty-contract",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const firstEstimate = await storage.getFirstEstimateForBid(bid.id);
      const lineItems = firstEstimate
        ? await storage.listEstimateLineItems(firstEstimate.id)
        : [];

      const scopeItemsList = lineItems.map((item) => ({
        description: item.description,
        category: item.category,
        quantity: parseFloat(item.quantity as any) || 0,
        unit: item.unit,
        totalCost: parseFloat(item.totalCost as any) || 0,
        laborCost: parseFloat(item.laborCost as any) || 0,
        materialCost: parseFloat(item.materialCost as any) || 0,
        equipmentCost: parseFloat(item.equipmentCost as any) || 0,
        subcontractCost: parseFloat(item.subcontractCost as any) || 0,
      }));

      const totalDirectCost = scopeItemsList.reduce((sum, item) => sum + item.totalCost, 0);
      const overheadPercent = 15;
      const profitPercent = 10;
      const overheadAmount = totalDirectCost * (overheadPercent / 100);
      const profitAmount = totalDirectCost * (profitPercent / 100);
      const finalBidAmount =
        parseFloat(bid.bidAmount as any) || totalDirectCost + overheadAmount + profitAmount;

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

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${orgBranding.organizationName.replace(/[^a-zA-Z0-9]/g, "-")}-Warranty-Contract-${bid.code}.pdf"`,
      );

      pdfStream.pipe(res);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ==================
// Bid Documents (Plans & Takeoff)
// ==================

router.get(
  "/api/bids/:code/documents",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });
      const docs = await storage.listBidDocuments(bid.id);
      res.json(docs);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.post(
  "/api/bids/:code/documents",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

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
      if (!parsed.success)
        return res
          .status(400)
          .json({ error: "Invalid request body", details: parsed.error.flatten() });
      const data = parsed.data;

      // Verify the storage reference actually belongs to the caller's org so a
      // tenant cannot register a bid document that points at another tenant's
      // private object.
      const supplied = data.objectKey || data.fileUrl;
      let normalizedObjectKey: string | undefined = data.objectKey;
      if (supplied) {
        try {
          await assertStorageKeyBelongsToOrg(
            supplied,
            bid.gcOrganizationId!,
            req.user!.id,
            req.user!.role,
          );
        } catch (err: any) {
          return res
            .status(err?.status || 403)
            .json({ error: err?.message || "Forbidden" });
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
          logError(
            "Bid document ACL policy write failed:",
            {},
            err instanceof Error ? err : new Error(String(err)),
          );
          // Do not block the upload; the read endpoint has a backfill that will
          // set the policy on first preview if it is still missing.
        }
      }

      const doc = await storage.createBidDocument(bid.id, {
        title: data.title,
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        objectKey: normalizedObjectKey ?? data.objectKey,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        type: data.type,
        uploadedById: req.user!.id,
      });

      res.status(201).json(doc);
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

router.delete(
  "/api/bids/:code/documents/:docId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const doc = await storage.getBidDocumentForBid(bid.id, req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });

      if (doc.objectKey) {
        try {
          const { ObjectStorageService } = await import("./objectStorage");
          const objectStorageService = new ObjectStorageService();
          const objectFile = await objectStorageService.getObjectEntityFile(doc.objectKey);
          await objectFile.delete();
        } catch (error) {
          logError(
            "Error deleting bid document from object storage:",
            {},
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      await storage.deleteBidDocumentForBid(bid.id, req.params.docId);
      res.json({ success: true });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// Shared helper: resolves a bid document for the preview / stream
// endpoints. Authorization model: anyone who can list a bid's documents
// (the org check on the bid's gcOrganizationId) can also view the
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
  res: Response,
  storage: IBidStorage,
): Promise<{
  objectStorageService: import("./objectStorage").ObjectStorageService;
  objectFile: import("@google-cloud/storage").File;
} | null> {
  const bid = await storage.getBidByCode(req.params.code);
  if (!bid) {
    res.status(404).json({ error: "Bid not found" });
    return null;
  }
  const doc = await storage.getBidDocumentForBid(bid.id, req.params.docId);
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
    logError(
      "Bid document ACL backfill skipped:",
      {},
      backfillErr instanceof Error ? backfillErr : new Error(String(backfillErr)),
    );
  }

  return { objectStorageService, objectFile };
}

router.get(
  "/api/bids/:code/documents/:docId/preview-url",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const resolved = await resolveBidDocumentForRead(req, res, storage);
      if (!resolved) return;
      await resolved.objectStorageService.downloadObject(resolved.objectFile, res, 3600);
    } catch (error) {
      logError(
        "Bid document preview-url error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (handleStorageError(error, res, next)) return;
      if (!res.headersSent) next(error);
    }
  },
);

router.get(
  "/api/bids/:code/documents/:docId/stream",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const resolved = await resolveBidDocumentForRead(req, res, storage);
      if (!resolved) return;
      await resolved.objectStorageService.downloadObject(resolved.objectFile, res, 3600);
    } catch (error) {
      logError(
        "Bid document stream error:",
        {},
        error instanceof Error ? error : new Error(String(error)),
      );
      if (handleStorageError(error, res, next)) return;
      if (!res.headersSent) next(error);
    }
  },
);

router.post(
  "/api/bids/:code/submit",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const allowedTransitions = BID_STATUS_TRANSITIONS[bid.status] || [];
      if (!allowedTransitions.includes("SUBMITTED") && bid.status !== "SUBMITTED") {
        return res.status(422).json({
          error: `Cannot submit bid from status ${bid.status}. Bid must be in DRAFT, ACTIVE, or SUBMITTED status.`,
        });
      }

      // Task #2321 — bid-lock gate. If the org has opted-in to the
      // second-eye review workflow by setting a non-null
      // `takeoffReviewBidLockThresholdPct`, refuse to submit the bid
      // until the percentage of dollar-value reviewed-and-approved
      // measurements meets the threshold.
      try {
        if (bid.gcOrganizationId) {
          const thresholdRaw = await storage.getReviewBidLockThresholdPct(
            bid.gcOrganizationId,
          );
          if (thresholdRaw !== null && thresholdRaw !== undefined && thresholdRaw !== "") {
            const threshold = Number(thresholdRaw);
            if (!Number.isNaN(threshold) && threshold > 0) {
              const summary = await storage.getBidReviewDollarSummary(bid.id);
              const total = summary.totalDollars ?? 0;
              const approved = summary.approvedDollars ?? 0;
              if (total > 0) {
                const pct = (approved / total) * 100;
                if (pct < threshold) {
                  return res.status(422).json({
                    error:
                      "Bid cannot be submitted until the takeoff review threshold is met.",
                    code: "REVIEW_THRESHOLD_NOT_MET",
                    approvedDollars: approved,
                    totalDollars: total,
                    approvedDollarPct: pct,
                    requiredPct: threshold,
                  });
                }
              }
            }
          }
        }
      } catch (gateErr) {
        // Defensive — if the gate query itself fails, we don't want to
        // hard-block submissions across the entire platform. Log and
        // continue; the surface area for the gate is admin-opt-in.
        logError(
          "[bid] review gate check failed; allowing submission",
          { bidId: bid.id },
          gateErr instanceof Error ? gateErr : new Error(String(gateErr)),
        );
      }

      const bidSubmitSchema = z.object({
        recipientEmail: z.string().email().optional(),
      });
      const parsed = validateBody(bidSubmitSchema, req.body || {}, res);
      if (!parsed) return;

      const { recipientEmail } = parsed;
      const toEmail = recipientEmail || bid.clientContactEmail;

      if (!toEmail) {
        return res
          .status(400)
          .json({ error: "No recipient email provided and no client contact email on bid" });
      }

      const esc = (str: string): string =>
        str
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const finalAmount = bid.bidAmount
        ? `₱${Number(bid.bidAmount).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : "To be discussed";
      const parsedDueDate = bid.dueDate ? new Date(bid.dueDate) : null;
      const dueDate =
        parsedDueDate && !isNaN(parsedDueDate.getTime())
          ? parsedDueDate.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "To be discussed";
      const projectLocation =
        [bid.locationAddress, bid.city, bid.state].filter(Boolean).join(", ") ||
        "To be discussed";

      const sender = req.user!;
      const senderFullName =
        [sender.firstName, sender.lastName].filter(Boolean).join(" ") || "";
      const senderRole = sender.role || "";
      const senderEmail = sender.email || "";
      const senderPhone = sender.phone || "";

      let orgName = "";
      let orgPhone = "";
      let orgEmail = "";
      if (sender.organizationId) {
        const org = await storage.getOrganizationContact(sender.organizationId);
        if (org) {
          orgName = org.name || "";
          orgPhone = org.phone || "";
          orgEmail = org.email || "";
        }
      }

      let scopeOfWorkHtml = "";
      let scopeOfWorkText = "";
      try {
        const latestEstimate = await storage.getLatestEstimateForBid(bid.id);
        if (latestEstimate) {
          const lineItems = await storage.listEstimateLineItems(latestEstimate.id);
          if (lineItems.length > 0) {
            scopeOfWorkHtml = lineItems
              .map(
                (item) =>
                  `<li style="margin-bottom: 6px; color: #333;">${esc(item.description)}</li>`,
              )
              .join("\n");
            scopeOfWorkText = lineItems.map((item) => `  - ${item.description}`).join("\n");
          }
        }
      } catch (e) {
        logError(
          "[bid] scope of work fetch failed, using defaults:",
          {},
          e instanceof Error ? e : new Error(String(e)),
        );
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
        senderPhone || orgPhone
          ? `<span style="color: #555;">Contact: ${esc(senderPhone || orgPhone)}</span>`
          : null,
        senderEmail || orgEmail
          ? `<span style="color: #555;">Email: ${esc(senderEmail || orgEmail)}</span>`
          : null,
      ].filter(Boolean);
      const signOffHtml =
        signOffParts.length > 0
          ? signOffParts.join("<br/>")
          : `<span style="color: #555;">Your Project Team</span>`;

      const signOffTextParts = [
        senderFullName || null,
        senderRole || null,
        orgName || null,
        senderPhone || orgPhone ? `Contact: ${senderPhone || orgPhone}` : null,
        senderEmail || orgEmail ? `Email: ${senderEmail || orgEmail}` : null,
      ].filter(Boolean);
      const signOffText =
        signOffTextParts.length > 0 ? signOffTextParts.join("\n") : "Your Project Team";

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

      const oldStatus = bid.status;
      const allowedForSubmit = BID_STATUS_TRANSITIONS[oldStatus] || [];
      const nextStatus = allowedForSubmit.includes("SUBMITTED") ? "SUBMITTED" : null;

      const submittedAt = new Date();
      const updatedBid = await storage.markBidSubmitted(
        req.params.code,
        nextStatus,
        submittedAt,
      );

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "bid",
          entityId: bid.id,
          newValue: `Bid submitted to client at ${toEmail}`,
        },
        req,
      );

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

      if (nextStatus && nextStatus !== oldStatus) {
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
            newStatus: nextStatus,
          },
        });
      }

      res.json({
        success: true,
        submittedAt: updatedBid?.submittedAt ?? submittedAt,
        emailSent,
      });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

// ====================
// Public RFQ-response (token-authenticated; no org context)
// ====================

router.get("/api/public/rfq-response/:token", async (req, res, next) => {
  try {
    const storage = new BidStorageDrizzle(null);
    const quote = await storage.getSubQuoteByRfqToken(req.params.token);
    if (!quote) {
      return res.status(404).json({ error: "Invalid or expired RFQ link" });
    }

    const bid = quote.bidId ? await storage.getBidByIdUnscoped(quote.bidId) : null;

    let gcOrgName = "Unknown";
    if (bid?.gcOrganizationId) {
      const org = await storage.getOrganizationContact(bid.gcOrganizationId);
      if (org?.name) gcOrgName = org.name;
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

    parsedFiles = (req as MulterRequest).files || [];
  } catch (uploadErr: unknown) {
    const multerErr = uploadErr as { code?: string };
    if (multerErr?.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum 10MB per file." });
    }
    return res.status(400).json({ error: "File upload failed" });
  }

  try {
    const storage = new BidStorageDrizzle(null);
    const quote = await storage.getSubQuoteByRfqToken(req.params.token);

    if (!quote) {
      return res.status(404).json({ error: "Invalid or expired RFQ link" });
    }

    if (quote.rfqStatus === "responded") {
      return res.status(400).json({
        error:
          "This quote has already been submitted. Please contact the GC directly to make changes.",
      });
    }

    const rfqSentAt = quote.rfqSentAt ? new Date(quote.rfqSentAt).getTime() : 0;
    const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
    if (rfqSentAt && Date.now() - rfqSentAt > TOKEN_EXPIRY_MS) {
      return res.status(410).json({
        error: "This RFQ link has expired. Please request a new one from the GC.",
      });
    }

    const quoteAmount = req.body.quoteAmount as string;
    const leadTime = req.body.leadTime as string | undefined;
    const notes = req.body.notes as string | undefined;
    const contactName = req.body.contactName as string | undefined;
    const contactPhone = req.body.contactPhone as string | undefined;

    if (!quoteAmount || isNaN(parseFloat(quoteAmount)) || parseFloat(quoteAmount) < 0) {
      return res.status(400).json({ error: "A valid quote amount is required" });
    }

    const attachmentsMeta = parsedFiles.map((f) => ({
      filename: f.filename,
      originalName: f.originalname,
      size: f.size,
      mimeType: f.mimetype,
    }));

    const existingNotes = quote.notes || "";
    const responseNotes = notes
      ? `${existingNotes ? existingNotes + "\n\n" : ""}[Sub Response] ${notes}`
      : existingNotes;

    await storage.updateSubQuoteResponseByToken(req.params.token, {
      quoteAmount,
      leadTime: leadTime || quote.leadTime,
      notes: responseNotes,
      contactName: contactName || quote.contactName,
      contactPhone: contactPhone || quote.contactPhone,
      rfqStatus: "responded",
      rfqResponseToken: null,
      rfqResponseAttachmentsJson:
        attachmentsMeta.length > 0 ? JSON.stringify(attachmentsMeta) : null,
      updatedAt: new Date(),
    });

    res.json({ success: true, message: "Quote submitted successfully" });
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:code/bid-leveling", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const storage = getBidStorage(req, res);
    if (!storage) return;
    const bid = await storage.getBidByCode(req.params.code);
    if (!bid) return res.status(404).json({ error: "Bid not found" });

    const quotesUnsorted = await storage.listSubQuotes(bid.id);
    // Original ordering: scopeOfWork ASC, quoteAmount ASC. Sort in JS to
    // preserve the legacy response shape exactly without leaking the
    // ordering concern into the storage interface.
    const quotes = [...quotesUnsorted].sort((a, b) => {
      const sa = a.scopeOfWork || "";
      const sb = b.scopeOfWork || "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      const qa = Number(a.quoteAmount || 0);
      const qb = Number(b.quoteAmount || 0);
      return qa - qb;
    });

    const scopeGroups: Record<string, any[]> = {};
    for (const q of quotes) {
      const scope = q.scopeOfWork || "Unspecified";
      if (!scopeGroups[scope]) scopeGroups[scope] = [];
      scopeGroups[scope].push(q);
    }

    const leveling = Object.entries(scopeGroups).map(([scope, scopeQuotes]) => {
      const amounts = scopeQuotes.map((q) => Number(q.quoteAmount));
      const minAmount = Math.min(...amounts);
      const maxAmount = Math.max(...amounts);
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      const stdDev = Math.sqrt(
        amounts.reduce((sum, val) => sum + Math.pow(val - avgAmount, 2), 0) / amounts.length,
      );
      const outlierThreshold = avgAmount + 1.5 * stdDev;

      return {
        scope,
        quotes: scopeQuotes.map((q) => ({
          ...q,
          isLowBid: Number(q.quoteAmount) === minAmount,
          isOutlier: Number(q.quoteAmount) > outlierThreshold,
          variance:
            avgAmount > 0
              ? (((Number(q.quoteAmount) - avgAmount) / avgAmount) * 100).toFixed(1)
              : "0",
        })),
        summary: {
          count: scopeQuotes.length,
          lowBid: minAmount,
          highBid: maxAmount,
          average: Math.round(avgAmount * 100) / 100,
          spread: maxAmount - minAmount,
          selectedQuote: scopeQuotes.find((q) => q.isSelected)?.id || null,
        },
      };
    });

    res.json({ bidId: bid.id, bidCode: bid.code, leveling });
  } catch (error) {
    if (handleStorageError(error, res, next)) return;
    next(error);
  }
});

router.patch(
  "/api/bids/:code/quotes/:quoteId/select",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const storage = getBidStorage(req, res);
      if (!storage) return;
      const bid = await storage.getBidByCode(req.params.code);
      if (!bid) return res.status(404).json({ error: "Bid not found" });

      const { quoteId } = req.params;
      const quote = await storage.getSubQuoteForBid(bid.id, quoteId);
      if (!quote) return res.status(404).json({ error: "Quote not found" });

      await storage.selectSubQuote(bid.id, quoteId);
      res.json({ success: true, selectedQuoteId: quoteId });
    } catch (error) {
      if (handleStorageError(error, res, next)) return;
      next(error);
    }
  },
);

export default router;
