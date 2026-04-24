import { Router, NextFunction } from "express";
import { db } from "./db";
import { bids, bidDocuments, takeoffSheets, quantityCategories, projects, subcontractorContracts, subcontractors, subcontractorPayments } from "@shared/schema";
import { eq, desc, and, sql, max } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logCreate } from "./auditLogger";
import { sanitizeShortText, sanitizeText } from "./sanitization";
import { verifyOrgAccess, requireOrgOwnership } from "./orgFilter";
import { verifySheetAccess, safeParsePoints } from "./takeoffHelpers";
import { logError } from "./utils/logger";

const router = Router();

// Subcontractor Routes
// ====================

// Get subcontractor contracts for a project
router.get("/api/projects/:code/subcontractors", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.params;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // Get contracts with subcontractor details
    const contracts = await db
      .select({
        id: subcontractorContracts.id,
        contractNumber: subcontractorContracts.contractNumber,
        scopeOfWork: subcontractorContracts.scopeOfWork,
        contractAmount: subcontractorContracts.contractAmount,
        startDate: subcontractorContracts.startDate,
        completionDate: subcontractorContracts.completionDate,
        status: subcontractorContracts.status,
        paymentTerms: subcontractorContracts.paymentTerms,
        retentionPercent: subcontractorContracts.retentionPercent,
        notes: subcontractorContracts.notes,
        createdAt: subcontractorContracts.createdAt,
        subcontractor: {
          id: subcontractors.id,
          companyName: subcontractors.companyName,
          contactName: subcontractors.contactName,
          email: subcontractors.email,
          phone: subcontractors.phone,
        },
      })
      .from(subcontractorContracts)
      .leftJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .where(eq(subcontractorContracts.projectId, project.id))
      .orderBy(desc(subcontractorContracts.createdAt));

    res.json(contracts);
  } catch (error) {
  next(error);
  }
});

// Get payments for a contract
router.get("/api/subcontractor-contracts/:contractId/payments", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { contractId } = req.params;

    const [contract] = await db
      .select({ id: subcontractorContracts.id, projectId: subcontractorContracts.projectId })
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);
    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [project] = await db
      .select({ gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);
    if (!project || !verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const payments = await db
      .select()
      .from(subcontractorPayments)
      .where(eq(subcontractorPayments.contractId, contractId))
      .orderBy(subcontractorPayments.paymentNumber);

    res.json(payments);
  } catch (error) {
  next(error);
  }
});

// Create payment for a contract (Admin/Manager only)
router.post("/api/subcontractor-contracts/:contractId/payments", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const { contractId } = req.params;
    const { insertSubcontractorPaymentSchema } = await import("@shared/schema");

    const [contract] = await db
      .select()
      .from(subcontractorContracts)
      .where(eq(subcontractorContracts.id, contractId))
      .limit(1);

    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }
    const [contractProject] = await db
      .select({ gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, contract.projectId))
      .limit(1);
    if (!contractProject || !verifyOrgAccess(req, res, contractProject.gcOrganizationId)) return;

    // Get next payment number
    const existingPayments = await db
      .select({ paymentNumber: subcontractorPayments.paymentNumber })
      .from(subcontractorPayments)
      .where(eq(subcontractorPayments.contractId, contractId))
      .orderBy(desc(subcontractorPayments.paymentNumber))
      .limit(1);

    const nextPaymentNumber = existingPayments.length > 0 ? existingPayments[0].paymentNumber + 1 : 1;

    // Validate input
    const validationResult = insertSubcontractorPaymentSchema.safeParse({
      ...req.body,
      contractId,
      paymentNumber: nextPaymentNumber,
    });

    if (!validationResult.success) {
      res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
      return;
    }

    // Insert payment
    const [newPayment] = await db.insert(subcontractorPayments).values(validationResult.data).returning();

    // Audit log
    await logCreate(req.user!.id, "SUBCONTRACTOR_PAYMENT", newPayment.id, {
      contractId,
      amount: req.body.amount,
      paymentNumber: nextPaymentNumber,
    });

    res.status(201).json(newPayment);
  } catch (error) {
  next(error);
  }
});

// ====================
// Subcontractor Payables Routes
// ====================

// Get all subcontractor payables (for CFO/Office Manager dashboard)
router.get("/api/subcontractor-payables", requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const orgConditions = isSuperAdmin ? [] : [eq(projects.gcOrganizationId, user.organizationId)];

    const payables = await db
      .select({
        subcontractorId: subcontractors.id,
        contractId: subcontractorContracts.id,
        projectId: subcontractorContracts.projectId,
        contractAmount: subcontractorContracts.contractAmount,
        totalPaid: sql<number>`COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("total_paid"),
        remainingBalance: sql<number>`${subcontractorContracts.contractAmount} - COALESCE(SUM(${subcontractorPayments.amount}), 0)`.as("remaining_balance"),
        projectName: projects.name,
        companyName: subcontractors.companyName,
      })
      .from(subcontractorContracts)
      .innerJoin(subcontractors, eq(subcontractorContracts.subcontractorId, subcontractors.id))
      .innerJoin(projects, eq(projects.id, subcontractorContracts.projectId))
      .leftJoin(subcontractorPayments, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .where(orgConditions.length > 0 ? and(...orgConditions) : undefined)
      .groupBy(subcontractorContracts.id, subcontractors.id, projects.id);

    res.json(payables);
  } catch (error) {
  next(error);
  }
});

// ====================
// Data Quality Routes
// ====================

// Get data quality score for a project (UI-facing endpoint with boolean flags)
router.get("/api/projects/:code/data-quality", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.params;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // Calculate data quality with boolean flags for each category
    const { 
      scopeItems, estimates, estimateLineItems, timeEntries, procurementItems,
      dailyScopeProgress, media, changeOrders, scheduleOfValues, planDocuments 
    } = await import("@shared/schema");

    // Check for scope items
    const scopeCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(scopeItems)
      .where(eq(scopeItems.projectId, project.id));
    const has_scope = Number(scopeCount[0]?.count || 0) > 0;

    // Check for estimate line items (actual pricing data via estimates linked to project)
    const lineItemsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(estimateLineItems)
      .innerJoin(estimates, eq(estimateLineItems.estimateId, estimates.id))
      .where(eq(estimates.projectId, project.id));
    const has_estimates = Number(lineItemsCount[0]?.count || 0) > 0;

    // Check for budget (project has budget amount set)
    const has_budget = project.budget !== null && Number(project.budget) > 0;

    // Check for timeline (start date and estimated completion date)
    const has_timeline = !!(project.startDate && project.estimatedCompletionDate);

    // Check for daily updates (daily scope progress entries)
    const dailyUpdatesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(dailyScopeProgress)
      .where(eq(dailyScopeProgress.projectId, project.id));
    const has_daily_updates = Number(dailyUpdatesCount[0]?.count || 0) > 0;

    // Check for cost tracking (time entries or procurement items)
    const timeEntriesCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(timeEntries)
      .where(eq(timeEntries.projectId, project.id));
    const procurementCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(procurementItems)
      .where(eq(procurementItems.projectId, project.id));
    const has_cost_tracking = Number(timeEntriesCount[0]?.count || 0) > 0 || Number(procurementCount[0]?.count || 0) > 0;

    // Check for media uploads
    const mediaCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(media)
      .where(eq(media.projectId, project.id));
    const has_media = Number(mediaCount[0]?.count || 0) > 0;

    // Check for documentation (plan documents)
    const docsCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(planDocuments)
      .where(eq(planDocuments.projectId, project.id));
    const has_documentation = Number(docsCount[0]?.count || 0) > 0;

    // Check for change orders
    const changeOrdersCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(changeOrders)
      .where(eq(changeOrders.projectId, project.id));
    const has_change_orders_managed = Number(changeOrdersCount[0]?.count || 0) > 0;

    // Check for billing setup (schedule of values)
    const sovCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(scheduleOfValues)
      .where(eq(scheduleOfValues.projectId, project.id));
    const has_billing_setup = Number(sovCount[0]?.count || 0) > 0;

    // Calculate overall score (each flag worth 10 points)
    const flags = [
      has_scope, has_estimates, has_budget, has_timeline, has_daily_updates,
      has_cost_tracking, has_media, has_documentation, has_change_orders_managed, has_billing_setup
    ];
    const overall_score = flags.filter(Boolean).length * 10;

    res.json({
      overall_score,
      has_scope,
      has_estimates,
      has_budget,
      has_timeline,
      has_daily_updates,
      has_cost_tracking,
      has_media,
      has_documentation,
      has_change_orders_managed,
      has_billing_setup
    });
  } catch (error) {
  next(error);
  }
});

// ====================
// TAKEOFF + ESTIMATING ROUTES
// ====================


// ====================
// QUANTITY CATEGORY ROUTES
// ====================

// Get all quantity categories for a project
router.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.params;
    const { quantityCategories } = await import("@shared/schema");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    const categories = await db
      .select()
      .from(quantityCategories)
      .where(eq(quantityCategories.projectId, project.id))
      .orderBy(quantityCategories.displayOrder);

    res.json(categories);
  } catch (error) {
  next(error);
  }
});

// Create a new quantity category
router.post("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { code } = req.params;
    const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.code, code))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return;

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      name: sanitizeShortText(req.body.name),
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validated = insertQuantityCategorySchema.parse({
      projectId: project.id,  // Use the internal UUID, not the code
      ...sanitizedBody,
    });

    const [category] = await db
      .insert(quantityCategories)
      .values(validated)
      .returning();

    res.status(201).json(category);
  } catch (error) {
    logError("Error creating quantity category:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      next(error);
    }
  }
});

// Update a quantity category
router.patch("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { quantityCategories, insertQuantityCategorySchema, takeoffSheets, projects, bids } = await import("@shared/schema");

    const [existing] = await db.select().from(quantityCategories).where(eq(quantityCategories.id, id)).limit(1);
    if (!existing) { res.status(404).json({ error: "Category not found" }); return; }

    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";
    if (!isSuperAdmin) {
      if (existing.projectId) {
        const [project] = await db.select({ id: projects.id }).from(projects)
          .where(and(eq(projects.id, existing.projectId), eq(projects.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!project) { res.status(403).json({ error: "Access denied" }); return; }
      } else if (existing.bidId) {
        const [bid] = await db.select({ id: bids.id }).from(bids)
          .where(and(eq(bids.id, existing.bidId), eq(bids.gcOrganizationId, req.user!.organizationId)))
          .limit(1);
        if (!bid) { res.status(403).json({ error: "Access denied" }); return; }
      } else {
        res.status(403).json({ error: "Access denied" }); return;
      }
    }

    const sanitizedBody = {
      ...req.body,
      name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
      description: req.body.description ? sanitizeText(req.body.description) : undefined,
    };

    const validated = insertQuantityCategorySchema.partial().parse(sanitizedBody);

    const [updated] = await db
      .update(quantityCategories)
      .set({ ...validated, updatedAt: new Date() })
      .where(eq(quantityCategories.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Category not found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    logError("Error updating quantity category:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid category data", details: error.errors });
    } else {
      next(error);
    }
  }
});

// ====================
// Sheet Page Management
// ====================

// Rename a sheet

// ====================
// TAKEOFF MARKUP ROUTES
// ====================

// Get markups for a sheet
router.get("/api/takeoff/sheets/:sheetId/markups", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMarkups, users } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const markups = await db
      .select({
        id: takeoffMarkups.id,
        sheetId: takeoffMarkups.sheetId,
        organizationId: takeoffMarkups.organizationId,
        createdBy: takeoffMarkups.createdBy,
        tool: takeoffMarkups.tool,
        points: takeoffMarkups.points,
        color: takeoffMarkups.color,
        thickness: takeoffMarkups.thickness,
        text: takeoffMarkups.text,
        categoryId: takeoffMarkups.categoryId,
        createdAt: takeoffMarkups.createdAt,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        authorAvatarUrl: users.avatarUrl,
      })
      .from(takeoffMarkups)
      .leftJoin(users, eq(takeoffMarkups.createdBy, users.id))
      .where(eq(takeoffMarkups.sheetId, sheetId))
      .orderBy(takeoffMarkups.createdAt);

    const parsed = markups.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsed);
  } catch (error) {
  next(error);
  }
});

// Create a markup
router.post("/api/takeoff/markups", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { takeoffMarkups, insertTakeoffMarkupSchema } = await import("@shared/schema");

    const body = {
      ...req.body,
      createdBy: req.user!.id,
      organizationId: req.user!.organizationId,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    const validated = insertTakeoffMarkupSchema.parse(body);

    const access = await verifySheetAccess(validated.sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [markup] = await db.insert(takeoffMarkups).values(validated).returning();

    res.status(201).json({
      ...markup,
      points: safeParsePoints(markup.points) || [],
      authorName: req.user!.name,
    });
  } catch (error) {
    logError("Error creating markup:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid markup data", details: error.errors });
    } else {
      next(error);
    }
  }
});

// Task #1752 — Bulk PATCH for moving N takeoff markups in a single
// round-trip. Mirrors `/api/plan-documents/:docId/markups/bulk` and
// replaces the N parallel per-id PATCHes that fanned out from
// `TakeoffWorkspace.onBodyDragEnd` (each of which triggered its own
// `queryClient.invalidateQueries` refetch). All updates run inside a
// single transaction so a partial failure either commits everything
// or nothing.
//
// Task #1765 — Extended to also accept optional `color`, `thickness`,
// and `text` per entry so the toolbar / properties panel can collapse
// a multi-selection recolor / restyle into one PATCH instead of N
// per-id PATCHes (matching the field set the per-id PATCH below
// accepts). Each entry must carry at least one mutable field; the
// updater builds a per-row `set` payload from whichever fields are
// present, so a single bulk call can mix payloads (e.g. recolor some
// members, retext others) without forcing the client to issue
// separate requests.
//
// Auth mirrors the per-id PATCH below — `requireAuth` only (no
// `requireRole`), with per-row owner-or-admin/manager checks so a
// FIELD_WORKER can still bulk-edit groups composed of their own
// markups. Same-sheet enforcement is added on top because every
// caller (group-drag commit and bulk style apply) operates inside
// one sheet by definition; refusing cross-sheet payloads guards
// against a malformed request silently mutating markups on unrelated
// sheets.
//
// Route MUST be registered before `/api/takeoff/markups/:markupId`
// or Express will route "bulk" into `:markupId` and 404.
router.patch("/api/takeoff/markups/bulk", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffMarkups } = await import("@shared/schema");
    const { z } = await import("zod");
    const { inArray } = await import("drizzle-orm");

    const bulkSchema = z.object({
      updates: z
        .array(
          z
            .object({
              id: z.string().min(1),
              points: z
                .array(z.object({ x: z.number(), y: z.number() }))
                .min(1)
                .max(4096)
                .optional(),
              color: z.string().min(1).optional(),
              thickness: z.number().int().min(1).max(64).optional(),
              text: z.string().nullable().optional(),
            })
            .refine(
              (u) =>
                u.points !== undefined ||
                u.color !== undefined ||
                u.thickness !== undefined ||
                u.text !== undefined,
              { message: "Each update must include at least one of points, color, thickness, or text" },
            ),
        )
        .min(1)
        .max(500),
    });

    const validated = bulkSchema.parse(req.body);
    const ids = validated.updates.map((u) => u.id);

    const rows = await db
      .select()
      .from(takeoffMarkups)
      .where(inArray(takeoffMarkups.id, ids));

    if (rows.length !== ids.length) {
      res.status(404).json({ error: "One or more markups were not found" });
      return;
    }

    const userRole = req.user!.role;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const isSuperAdmin = userRole === "SUPER_ADMIN";
    const isAdminOrManager = isSuperAdmin || userRole === "ADMIN" || userRole === "MANAGER";

    const firstSheetId = rows[0].sheetId;
    for (const r of rows) {
      if (r.sheetId !== firstSheetId) {
        res.status(400).json({ error: "All markups must belong to the same sheet" });
        return;
      }
      if (!isSuperAdmin && r.organizationId !== orgId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!isAdminOrManager && r.createdBy !== userId) {
        res.status(403).json({ error: "You can only edit your own markups" });
        return;
      }
    }

    const updated = await db.transaction(async (tx) => {
      const out: typeof rows = [];
      for (const u of validated.updates) {
        const setPayload: Record<string, unknown> = {};
        if (u.points !== undefined) setPayload.points = JSON.stringify(u.points);
        if (u.color !== undefined) setPayload.color = u.color;
        if (u.thickness !== undefined) setPayload.thickness = u.thickness;
        if (u.text !== undefined) setPayload.text = u.text;
        const whereClause = isSuperAdmin
          ? eq(takeoffMarkups.id, u.id)
          : and(eq(takeoffMarkups.id, u.id), eq(takeoffMarkups.organizationId, orgId!));
        const [row] = await tx
          .update(takeoffMarkups)
          .set(setPayload)
          .where(whereClause)
          .returning();
        if (row) out.push(row);
      }
      return out;
    });

    res.json(
      updated.map((r) => ({
        ...r,
        points: safeParsePoints(r.points) || [],
      })),
    );
  } catch (error: any) {
    logError("Error bulk-updating markups:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.name === "ZodError") {
      res.status(400).json({ error: "Invalid bulk patch", details: error.errors });
      return;
    }
    next(error);
  }
});

// Update a markup (label, color, thickness, points)
router.patch("/api/takeoff/markups/:markupId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { markupId } = req.params;
    const { takeoffMarkups } = await import("@shared/schema");
    const { z } = await import("zod");

    const updateSchema = z.object({
      color: z.string().min(1).optional(),
      thickness: z.number().int().min(1).max(64).optional(),
      text: z.string().nullable().optional(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
    }).refine((data) => Object.keys(data).length > 0, { message: "No fields to update" });

    const validated = updateSchema.parse(req.body);

    const [markup] = await db
      .select()
      .from(takeoffMarkups)
      .where(eq(takeoffMarkups.id, markupId))
      .limit(1);

    if (!markup) {
      res.status(404).json({ error: "Markup not found" });
      return;
    }

    const userRole = req.user!.role;
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    if (!isSuperAdmin && markup.organizationId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const isOwner = markup.createdBy === userId;
    const isAdminOrManager = isSuperAdmin || userRole === "ADMIN" || userRole === "MANAGER";

    if (!isOwner && !isAdminOrManager) {
      res.status(403).json({ error: "You can only edit your own markups" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (validated.color !== undefined) updates.color = validated.color;
    if (validated.thickness !== undefined) updates.thickness = validated.thickness;
    if (validated.text !== undefined) updates.text = validated.text;
    if (validated.points !== undefined) updates.points = JSON.stringify(validated.points);

    const whereClause = isSuperAdmin
      ? eq(takeoffMarkups.id, markupId)
      : and(eq(takeoffMarkups.id, markupId), eq(takeoffMarkups.organizationId, orgId!));

    const [updated] = await db
      .update(takeoffMarkups)
      .set(updates)
      .where(whereClause)
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Markup not found" });
      return;
    }

    res.json({
      ...updated,
      points: safeParsePoints(updated.points) || [],
    });
  } catch (error: any) {
    logError("Error updating markup:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid markup data", details: error.errors });
    } else {
      next(error);
    }
  }
});

// Delete a markup
router.delete("/api/takeoff/markups/:markupId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { markupId } = req.params;
    const { takeoffMarkups } = await import("@shared/schema");

    const [markup] = await db
      .select()
      .from(takeoffMarkups)
      .where(eq(takeoffMarkups.id, markupId))
      .limit(1);

    if (!markup) {
      res.status(404).json({ error: "Markup not found" });
      return;
    }

    const userRole = req.user!.role;
    const userId = req.user!.id;

    const orgId = req.user!.organizationId;
    const isSuperAdmin = userRole === "SUPER_ADMIN";

    if (!isSuperAdmin && markup.organizationId !== orgId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const isOwner = markup.createdBy === userId;
    const isAdminOrManager = isSuperAdmin || userRole === "ADMIN" || userRole === "MANAGER";

    if (!isOwner && !isAdminOrManager) {
      res.status(403).json({ error: "You can only delete your own markups" });
      return;
    }

    if (isSuperAdmin) {
      await db.delete(takeoffMarkups).where(eq(takeoffMarkups.id, markupId));
    } else {
      await db.delete(takeoffMarkups).where(and(eq(takeoffMarkups.id, markupId), eq(takeoffMarkups.organizationId, orgId!)));
    }

    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

router.get("/api/takeoff/sheets/:sheetId/links", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheetLinks } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    const links = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.sourceSheetId, sheetId));

    res.json(links);
  } catch (error) {
  next(error);
  }
});

router.get("/api/takeoff/conditions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(403).json({ error: "Organization required" }); return; }
    const { takeoffConditions } = await import("@shared/schema");
    const conditions = await db
      .select()
      .from(takeoffConditions)
      .where(eq(takeoffConditions.organizationId, orgId))
      .orderBy(sql`${takeoffConditions.lastUsedAt} DESC NULLS LAST`, takeoffConditions.sortOrder);
    res.json(conditions);
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/sheet-links", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { takeoffSheetLinks, insertTakeoffSheetLinkSchema, takeoffSheets } = await import("@shared/schema");

    const sourceAccess = await verifySheetAccess(req.body.sourceSheetId, req.user!);
    if (!sourceAccess.allowed) {
      res.status(403).json({ error: sourceAccess.reason });
      return;
    }

    const targetAccess = await verifySheetAccess(req.body.targetSheetId, req.user!);
    if (!targetAccess.allowed) {
      res.status(403).json({ error: "No access to target sheet" });
      return;
    }

    const [sourceSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, req.body.sourceSheetId)).limit(1);
    const [targetSheet] = await db.select().from(takeoffSheets).where(eq(takeoffSheets.id, req.body.targetSheetId)).limit(1);

    if (!sourceSheet || !targetSheet) {
      res.status(404).json({ error: "Source or target sheet not found" });
      return;
    }

    const sameContext = (sourceSheet.projectId && sourceSheet.projectId === targetSheet.projectId) ||
                        (sourceSheet.bidId && sourceSheet.bidId === targetSheet.bidId);
    if (!sameContext) {
      res.status(400).json({ error: "Source and target sheets must belong to the same project or bid" });
      return;
    }

    if (req.body.width <= 0 || req.body.height <= 0) {
      res.status(400).json({ error: "Link width and height must be positive" });
      return;
    }

    const validated = insertTakeoffSheetLinkSchema.parse(req.body);

    const [link] = await db
      .insert(takeoffSheetLinks)
      .values(validated)
      .returning();

    res.status(201).json(link);
  } catch (error) {
    logError("Error creating sheet link:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid link data", details: error.errors });
    } else {
      next(error);
    }
  }
});

router.delete("/api/takeoff/sheet-links/:linkId", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { linkId } = req.params;
    const { takeoffSheetLinks } = await import("@shared/schema");

    const [link] = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.id, linkId))
      .limit(1);

    if (!link) {
      res.status(404).json({ error: "Link not found" });
      return;
    }

    const access = await verifySheetAccess(link.sourceSheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    await db.delete(takeoffSheetLinks).where(eq(takeoffSheetLinks.id, linkId));

    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/sheets/:sheetId/detect-links", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const { takeoffSheetLinks, takeoffSheets } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(403).json({ error: access.reason });
      return;
    }

    const sheet = access.sheet!;

    const allSheets = await db
      .select()
      .from(takeoffSheets)
      .where(
        sheet.projectId
          ? eq(takeoffSheets.projectId, sheet.projectId)
          : eq(takeoffSheets.bidId, sheet.bidId!)
      );

    const sheetNameMap = new Map<string, string>();
    for (const s of allSheets) {
      if (s.id === sheetId) continue;
      if (s.sheetName) {
        sheetNameMap.set(s.sheetName.toUpperCase(), s.id);
        const simplified = s.sheetName.replace(/\s+/g, "").toUpperCase();
        sheetNameMap.set(simplified, s.id);
      }
    }

    const detectedLinks: Array<{
      sourceSheetId: string;
      targetSheetId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      autoDetected: boolean;
    }> = [];

    await db.delete(takeoffSheetLinks).where(
      and(
        eq(takeoffSheetLinks.sourceSheetId, sheetId),
        eq(takeoffSheetLinks.autoDetected, true)
      )
    );

    if (sheet.projectId || sheet.bidId) {
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const { planDocuments, projectPlans, bidDocuments } = await import("@shared/schema");
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();

        const planSheet = allSheets.find(s => s.id === sheetId);
        let pdfBuffer: Buffer | null = null;

        if (planSheet && sheet.bidId) {
          const [bidDoc] = await db.select({ objectKey: bidDocuments.objectKey, fileUrl: bidDocuments.fileUrl })
            .from(bidDocuments)
            .where(and(eq(bidDocuments.bidId, sheet.bidId), eq(bidDocuments.fileUrl, planSheet.imageUrl)))
            .limit(1);
          if (bidDoc?.objectKey) {
            const objectFile = await objectStorageService.getObjectEntityFile(bidDoc.objectKey);
            const [buf] = await objectFile.download();
            pdfBuffer = buf;
          }
        } else if (planSheet?.planId) {
          const [sheetWithDoc] = await db
            .select({ objectKey: planDocuments.objectKey, fileUrl: planDocuments.fileUrl })
            .from(takeoffSheets)
            .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
            .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
            .where(eq(takeoffSheets.id, sheetId))
            .limit(1);
          if (sheetWithDoc?.objectKey) {
            const objectFile = await objectStorageService.getObjectEntityFile(sheetWithDoc.objectKey);
            const [buf] = await objectFile.download();
            pdfBuffer = buf;
          }
        }

        if (pdfBuffer && planSheet) {
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
            const pageNumber = (planSheet.sheetIndex || 0) + 1;

            const samePdfSheets = allSheets.filter(s => s.planId === planSheet.planId);

            if (pageNumber <= pdf.numPages) {
              const page = await pdf.getPage(pageNumber);
              const viewport = page.getViewport({ scale: 1.5 });

              const annotations = await page.getAnnotations();
              for (const ann of annotations) {
                if (ann.subtype === "Link" && ann.dest) {
                  let targetPageIndex: number | null = null;
                  if (typeof ann.dest === "string") {
                    const destinations = await pdf.getDestinations();
                    const dest = destinations[ann.dest];
                    if (dest) {
                      const ref = dest[0];
                      targetPageIndex = await pdf.getPageIndex(ref);
                    }
                  } else if (Array.isArray(ann.dest) && ann.dest[0]) {
                    targetPageIndex = await pdf.getPageIndex(ann.dest[0]);
                  }

                  if (targetPageIndex !== null) {
                    const targetSheet = samePdfSheets.find(s => s.sheetIndex === targetPageIndex);
                    if (targetSheet && targetSheet.id !== sheetId) {
                      const rect = ann.rect;
                      const [x1, y1, x2, y2] = [
                        rect[0] * 1.5,
                        viewport.height - rect[3] * 1.5,
                        rect[2] * 1.5,
                        viewport.height - rect[1] * 1.5,
                      ];
                      detectedLinks.push({
                        sourceSheetId: sheetId,
                        targetSheetId: targetSheet.id,
                        x: x1,
                        y: y1,
                        width: x2 - x1,
                        height: y2 - y1,
                        label: targetSheet.sheetName || `Page ${targetPageIndex + 1}`,
                        autoDetected: true,
                      });
                    }
                  }
                }
              }

              if (detectedLinks.length === 0) {
                const textContent = await page.getTextContent();
                const refPatterns = [
                  /\bSEE\s+(DWG|DRAWING|DETAIL|SHEET|PLAN)\s+([A-Z]-?\d{2,3})\b/gi,
                  /\bREFER\s+TO\s+([A-Z]-?\d{2,3})\b/gi,
                  /\bDETAIL\s+(\d+)\s*[/\\]\s*([A-Z]-?\d{2,3})\b/gi,
                  /\bSECTION\s+(\d+)\s*[/\\]\s*([A-Z]-?\d{2,3})\b/gi,
                  /\bSEE\s+([A-Z]-?\d{2,3})\b/gi,
                ];

                for (const item of textContent.items) {
                  const textItem = item as any;
                  if (!textItem.str) continue;

                  for (const pattern of refPatterns) {
                    pattern.lastIndex = 0;
                    let match;
                    while ((match = pattern.exec(textItem.str)) !== null) {
                      const refName = match[match.length - 1].toUpperCase();
                      const targetId = sheetNameMap.get(refName);
                      if (targetId) {
                        const tx = textItem.transform?.[4] * 1.5 || 0;
                        const ty = viewport.height - (textItem.transform?.[5] * 1.5 || 0);
                        const tw = (textItem.width || 80) * 1.5;
                        const th = (textItem.height || 14) * 1.5;

                        const alreadyExists = detectedLinks.some(
                          l => l.targetSheetId === targetId && Math.abs(l.x - tx) < 10 && Math.abs(l.y - ty) < 10
                        );
                        if (!alreadyExists) {
                          detectedLinks.push({
                            sourceSheetId: sheetId,
                            targetSheetId: targetId,
                            x: tx,
                            y: ty,
                            width: Math.max(tw, 40),
                            height: Math.max(th, 20),
                            label: match[0],
                            autoDetected: true,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
        }
      } catch (pdfError) {
        logError("PDF link detection error:", {}, pdfError instanceof Error ? pdfError : new Error(String(pdfError)));
      }
    }

    if (detectedLinks.length > 0) {
      await db.insert(takeoffSheetLinks).values(detectedLinks);
    }

    const allLinks = await db
      .select()
      .from(takeoffSheetLinks)
      .where(eq(takeoffSheetLinks.sourceSheetId, sheetId));

    res.json({ detected: detectedLinks.length, links: allLinks });
  } catch (error) {
  next(error);
  }
});

router.patch("/api/takeoff/conditions/:id/favorite", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(takeoffConditions.id, id)]
      : [eq(takeoffConditions.id, id), eq(takeoffConditions.organizationId, orgCtx.orgId!)];
    const [existing] = await db.select().from(takeoffConditions).where(and(...conditions)).limit(1);
    if (!existing) { res.status(404).json({ error: "Condition not found" }); return; }
    const [updated] = await db.update(takeoffConditions)
      .set({ isFavorite: !existing.isFavorite, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    res.json(updated);
  } catch (error) {
  next(error);
  }
});

router.get("/api/takeoff/conditions/export-csv", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(403).json({ error: "Organization required" }); return; }
    const { takeoffConditions } = await import("@shared/schema");
    const conditions = await db.select().from(takeoffConditions)
      .where(eq(takeoffConditions.organizationId, orgId))
      .orderBy(takeoffConditions.sortOrder);
    const csvRows = [["Name","Measurement Type","Color","Category","Unit Cost","Cost Code","Line Style","Label Template","Formula","Assembly Components"]];
    for (const c of conditions) {
      csvRows.push([
        c.name, c.measurementType, c.color, c.categoryName || "", String(c.unitCost ?? ""),
        c.costCodeId || "", c.lineStyle || "solid", c.labelTemplate || "",
        c.formula || "", c.assemblyComponents || "",
      ]);
    }
    const csv = csvRows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=conditions_export.csv");
    res.send(csv);
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/conditions/import-csv", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions } = await import("@shared/schema");
    const resolvedOrgId = orgCtx.isSuperAdmin ? req.body.organizationId : orgCtx.orgId;
    if (!resolvedOrgId) { res.status(400).json({ error: "organizationId is required" }); return; }
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "No rows provided" }); return;
    }
    const VALID_MEASUREMENT_TYPES = ["LINEAR", "AREA", "VOLUME", "COUNT", "SEGMENT", "POLYGON", "RECTANGLE", "CIRCLE", "ANGLE", "NOTE"];
    const VALID_LINE_STYLES = ["solid", "dashed", "dotted"];
    let imported = 0;
    let skipped = 0;
    for (const row of rows) {
      if (!row.name || typeof row.name !== "string") { skipped++; continue; }
      const measType = String(row.measurementType || "").toUpperCase();
      if (!VALID_MEASUREMENT_TYPES.includes(measType)) { skipped++; continue; }
      const unitCostParsed = row.unitCost ? parseFloat(String(row.unitCost)) : null;
      if (unitCostParsed !== null && !Number.isFinite(unitCostParsed)) { skipped++; continue; }
      const lineStyle = VALID_LINE_STYLES.includes(row.lineStyle) ? row.lineStyle : "solid";
      let assemblyComponents: string | null = null;
      if (row.assemblyComponents) {
        try {
          const parsed = typeof row.assemblyComponents === "string" ? JSON.parse(row.assemblyComponents) : row.assemblyComponents;
          if (Array.isArray(parsed)) {
            assemblyComponents = JSON.stringify(parsed);
          }
        } catch { /* skip malformed */ }
      }
      await db.insert(takeoffConditions).values({
        organizationId: resolvedOrgId,
        name: sanitizeShortText(row.name),
        measurementType: measType,
        color: typeof row.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(row.color) ? row.color : "#3b82f6",
        categoryName: typeof row.categoryName === "string" ? sanitizeShortText(row.categoryName) : null,
        unitCost: unitCostParsed,
        costCodeId: typeof row.costCodeId === "string" ? row.costCodeId : null,
        lineStyle,
        labelTemplate: typeof row.labelTemplate === "string" ? row.labelTemplate : null,
        formula: typeof row.formula === "string" ? row.formula : null,
        assemblyComponents,
      });
      imported++;
    }
    res.json({ imported, skipped });
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/conditions/apply-to-project", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions, quantityCategories, projects } = await import("@shared/schema");
    const resolvedOrgId = orgCtx.isSuperAdmin ? req.body.organizationId : orgCtx.orgId;
    const { conditionIds, projectCode } = req.body;
    if (!Array.isArray(conditionIds) || !projectCode) {
      res.status(400).json({ error: "conditionIds and projectCode are required" }); return;
    }
    const [project] = await db.select().from(projects).where(eq(projects.code, projectCode)).limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!orgCtx.isSuperAdmin && project.gcOrganizationId !== orgCtx.orgId) {
      res.status(403).json({ error: "Project does not belong to your organization" }); return;
    }
    const targetOrgId = project.gcOrganizationId || orgCtx.orgId;
    const conds = await db.select().from(takeoffConditions)
      .where(and(eq(takeoffConditions.organizationId, resolvedOrgId!), sql`${takeoffConditions.id} = ANY(${conditionIds})`));

    let conditionsCloned = 0;
    let categoriesCreated = 0;
    for (const c of conds) {
      const existingCond = await db.select().from(takeoffConditions)
        .where(and(
          eq(takeoffConditions.organizationId, targetOrgId),
          eq(takeoffConditions.name, c.name),
          eq(takeoffConditions.measurementType, c.measurementType)
        )).limit(1);

      if (existingCond.length === 0) {
        await db.insert(takeoffConditions).values({
          organizationId: targetOrgId,
          name: c.name,
          measurementType: c.measurementType,
          color: c.color,
          categoryName: c.categoryName,
          unitCost: c.unitCost,
          costCodeId: c.costCodeId,
          lineStyle: c.lineStyle,
          labelTemplate: c.labelTemplate,
          formula: c.formula,
          assemblyComponents: c.assemblyComponents,
          isFavorite: false,
        });
        conditionsCloned++;
      }

      if (c.categoryName) {
        const existingCat = await db.select().from(quantityCategories)
          .where(and(eq(quantityCategories.projectId, project.id), eq(quantityCategories.name, c.categoryName)))
          .limit(1);
        if (existingCat.length === 0) {
          await db.insert(quantityCategories).values({
            projectId: project.id,
            name: c.categoryName,
            color: c.color,
            lineStyle: c.lineStyle || "solid",
            unitCost: c.unitCost,
          });
          categoriesCreated++;
        }
      }
    }
    res.json({ conditionsCloned, categoriesCreated, totalProcessed: conds.length });
  } catch (error) {
  next(error);
  }
});

router.get("/api/takeoff/scale-templates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(403).json({ error: "Organization required" }); return; }
    const { savedScaleTemplates } = await import("@shared/schema");
    const templates = await db.select().from(savedScaleTemplates)
      .where(eq(savedScaleTemplates.organizationId, orgId))
      .orderBy(savedScaleTemplates.category, savedScaleTemplates.name);
    res.json(templates);
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/scale-templates", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { savedScaleTemplates } = await import("@shared/schema");
    const resolvedOrgId = orgCtx.isSuperAdmin ? req.body.organizationId : orgCtx.orgId;
    if (!resolvedOrgId) { res.status(400).json({ error: "organizationId is required" }); return; }
    const [template] = await db.insert(savedScaleTemplates).values({
      organizationId: resolvedOrgId,
      name: sanitizeShortText(req.body.name),
      label: req.body.label,
      pxPerFoot: req.body.pxPerFoot,
      category: req.body.category || "custom",
    }).returning();
    res.json(template);
  } catch (error) {
  next(error);
  }
});

router.delete("/api/takeoff/scale-templates/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { savedScaleTemplates } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(savedScaleTemplates.id, id)]
      : [eq(savedScaleTemplates.id, id), eq(savedScaleTemplates.organizationId, orgCtx.orgId!)];
    await db.delete(savedScaleTemplates).where(and(...conditions));
    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

router.post("/api/takeoff/conditions", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions, insertTakeoffConditionSchema } = await import("@shared/schema");
    const resolvedOrgId = orgCtx.isSuperAdmin ? req.body.organizationId : orgCtx.orgId;
    if (!resolvedOrgId) {
      res.status(400).json({ error: "organizationId is required" });
      return;
    }
    const body = { ...req.body, organizationId: resolvedOrgId };
    const parsed = insertTakeoffConditionSchema.parse(body);
    const [condition] = await db.insert(takeoffConditions).values(parsed).returning();
    res.json(condition);
  } catch (error) {
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid condition data", details: error.errors });
      return;
    }
  next(error);
  }
});

router.patch("/api/takeoff/conditions/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions, insertTakeoffConditionSchema } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(takeoffConditions.id, id)]
      : [eq(takeoffConditions.id, id), eq(takeoffConditions.organizationId, orgCtx.orgId!)];
    const [existing] = await db.select().from(takeoffConditions).where(and(...conditions)).limit(1);
    if (!existing) { res.status(404).json({ error: "Condition not found" }); return; }
    const updateSchema = insertTakeoffConditionSchema.partial().omit({ organizationId: true });
    const validated = updateSchema.parse(req.body);
    const updateData = { ...validated, updatedAt: new Date() };
    const [updated] = await db.update(takeoffConditions).set(updateData).where(and(...conditions)).returning();
    res.json(updated);
  } catch (error) {
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid condition data", details: error.errors });
      return;
    }
  next(error);
  }
});

router.delete("/api/takeoff/conditions/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgCtx = requireOrgOwnership(req, res);
    if (!orgCtx) return;
    const { takeoffConditions } = await import("@shared/schema");
    const { id } = req.params;
    const conditions = orgCtx.isSuperAdmin
      ? [eq(takeoffConditions.id, id)]
      : [eq(takeoffConditions.id, id), eq(takeoffConditions.organizationId, orgCtx.orgId!)];
    const [existing] = await db.select().from(takeoffConditions).where(and(...conditions)).limit(1);
    if (!existing) { res.status(404).json({ error: "Condition not found" }); return; }
    await db.delete(takeoffConditions).where(and(...conditions));
    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

export default router;
