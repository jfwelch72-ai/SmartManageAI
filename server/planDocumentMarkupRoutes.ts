/**
 * Task #1609 — plan_document_markups CRUD, carryover-from-revision, and
 * burned-in PDF export.
 *
 * Lives separately from `server/takeoffCategoryRoutes.ts` (which serves
 * the bid-side `takeoff_markups` surface) so the project-side PlansTab
 * can evolve without regression risk to the takeoff workspace. The two
 * tables intentionally have the same shape so the React renderer is
 * shared.
 */

import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  planDocumentMarkups,
  planDocuments,
  planMarkupLayers,
  planMarkupLayerVisibility,
  planPins,
  projects,
  users,
  insertPlanDocumentMarkupSchema,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { logError } from "./utils/logger";
import { recordJobMetrics } from "./utils/jobMetrics";
import { z } from "zod";
import { renderPlanDocumentPdf, PlanPdfTooLargeError, MAX_PAGES } from "./planDocumentPdfExport";
import { ObjectPermission } from "./objectAcl";
import crypto from "crypto";

const router = Router();

// Task #1662 — RBAC role-set used by every layer/group mutation.
// Mirrors the create/delete role-set on markups so the layers UI is
// available everywhere markups are.
const MARKUP_AUTHOR_ROLES = ["ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"] as const;

const DEFAULT_LAYER_NAME = "Default";

/**
 * Task #1662 — lazily materialise the default layer for a plan document.
 * Called from every layer-aware endpoint so legacy plan_documents (which
 * existed before the layers migration) get one canonical default layer
 * the first time any user opens the layers panel or draws a markup.
 *
 * Idempotent on (plan_document_id, name) — the unique constraint on the
 * layers table protects against double-creation under concurrent calls.
 */
async function ensureDefaultLayer(
  doc: typeof planDocuments.$inferSelect,
  userId: string,
): Promise<typeof planMarkupLayers.$inferSelect> {
  const [existing] = await db
    .select()
    .from(planMarkupLayers)
    .where(
      and(
        eq(planMarkupLayers.planDocumentId, doc.id),
        eq(planMarkupLayers.isDefault, true),
      ),
    )
    .limit(1);
  if (existing) return existing;

  // Try to insert; on conflict (race or pre-existing "Default" by name),
  // re-select. ON CONFLICT DO NOTHING on the unique (doc, name) index.
  await db
    .insert(planMarkupLayers)
    .values({
      organizationId: doc.organizationId!,
      planDocumentId: doc.id,
      name: DEFAULT_LAYER_NAME,
      color: "#94a3b8",
      sortOrder: 0,
      isDefault: true,
      createdById: userId,
    })
    .onConflictDoNothing({
      target: [planMarkupLayers.planDocumentId, planMarkupLayers.name],
    });

  const [row] = await db
    .select()
    .from(planMarkupLayers)
    .where(
      and(
        eq(planMarkupLayers.planDocumentId, doc.id),
        eq(planMarkupLayers.name, DEFAULT_LAYER_NAME),
      ),
    )
    .limit(1);
  // The seed above always succeeds-or-finds. If we still got nothing,
  // surface a clear error rather than crashing on undefined later.
  if (!row) throw new Error("Failed to materialise default markup layer");
  return row;
}

function safeParsePoints(s: string | null | undefined): Array<{ x: number; y: number }> {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function loadDocAndAssertOrg(
  docId: string,
  req: AuthRequest,
): Promise<
  | { ok: true; doc: typeof planDocuments.$inferSelect }
  | { ok: false; status: number; error: string }
> {
  const [doc] = await db.select().from(planDocuments).where(eq(planDocuments.id, docId)).limit(1);
  if (!doc) return { ok: false, status: 404, error: "Plan document not found" };
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) return { ok: false, status: 403, error: "Access denied" };
  if (shouldFilter && orgId && doc.organizationId && doc.organizationId !== orgId) {
    return { ok: false, status: 403, error: "Access denied" };
  }
  return { ok: true, doc };
}

// ============================================================================
// LIST markups for a plan document (optionally filtered by page)
// ============================================================================
router.get(
  "/api/plan-documents/:docId/markups",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const conds = [eq(planDocumentMarkups.planDocumentId, req.params.docId)];
      const { page } = req.query;
      if (typeof page === "string" && page) {
        const n = parseInt(page, 10);
        if (!Number.isNaN(n)) conds.push(eq(planDocumentMarkups.pageNumber, n));
      }

      const rows = await db
        .select({
          id: planDocumentMarkups.id,
          organizationId: planDocumentMarkups.organizationId,
          projectId: planDocumentMarkups.projectId,
          planDocumentId: planDocumentMarkups.planDocumentId,
          pageNumber: planDocumentMarkups.pageNumber,
          tool: planDocumentMarkups.tool,
          points: planDocumentMarkups.points,
          color: planDocumentMarkups.color,
          thickness: planDocumentMarkups.thickness,
          text: planDocumentMarkups.text,
          createdBy: planDocumentMarkups.createdBy,
          createdAt: planDocumentMarkups.createdAt,
          sourceMarkupId: planDocumentMarkups.sourceMarkupId,
          // Task #1662 — layer + group are returned so the client can
          // filter by visibility and render group selection halos
          // without a second round-trip.
          layerId: planDocumentMarkups.layerId,
          groupId: planDocumentMarkups.groupId,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(planDocumentMarkups)
        .leftJoin(users, eq(planDocumentMarkups.createdBy, users.id))
        .where(and(...conds))
        .orderBy(planDocumentMarkups.createdAt);

      recordJobMetrics("plan_document_markups_list", {
        ok: 1,
        markups: rows.length,
        ms: Date.now() - startedAt,
      });

      res.json(
        rows.map((m) => ({
          ...m,
          points: safeParsePoints(m.points),
        })),
      );
    } catch (err) {
      recordJobMetrics("plan_document_markups_list", { error: 1, ms: Date.now() - startedAt });
      next(err);
    }
  },
);

// ============================================================================
// CREATE markup
// ============================================================================
const createMarkupBody = z.object({
  pageNumber: z.number().int().min(1),
  tool: z.enum(["ARROW", "TEXT", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"]),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
  color: z.string().min(1).max(16).optional(),
  thickness: z.number().int().min(1).max(64).optional(),
  text: z.string().nullable().optional(),
  // Task #1662 — assign to a named layer at draw-time. When omitted,
  // we route the new markup to the auto-created Default layer for the
  // sheet so legacy clients that don't know about layers keep working.
  layerId: z.string().min(1).optional().nullable(),
});

router.post(
  "/api/plan-documents/:docId/markups",
  requireAuth,
  // Task #1609 RBAC: only roles that can be expected to author markup may
  // create them. Other authenticated roles (HUSTLER, VENDOR viewers, etc.)
  // get a 403 before we touch the DB. SUPERINTENDENT is the codebase's
  // analogue of "project engineer" and FIELD_WORKER is the analogue of
  // "foreman" for review-feedback purposes.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const user = req.user!;
      if (!user.organizationId) {
        res.status(403).json({ error: "No organization assigned" });
        return;
      }

      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      const body = createMarkupBody.parse(req.body);

      // Task #1662 — resolve which layer this markup belongs to. Either
      // the caller supplied an explicit layerId (which must belong to
      // the same plan_document for tenant + cross-doc safety), or we
      // fall back to the auto-created Default layer for the sheet.
      let layerId: string | null = null;
      if (body.layerId) {
        const [layer] = await db
          .select()
          .from(planMarkupLayers)
          .where(eq(planMarkupLayers.id, body.layerId))
          .limit(1);
        if (!layer || layer.planDocumentId !== access.doc.id) {
          res.status(400).json({ error: "Layer does not belong to this plan document" });
          return;
        }
        layerId = layer.id;
      } else {
        const def = await ensureDefaultLayer(access.doc, user.id);
        layerId = def.id;
      }

      const validated = insertPlanDocumentMarkupSchema.parse({
        organizationId: user.organizationId,
        projectId: access.doc.projectId,
        planDocumentId: access.doc.id,
        pageNumber: body.pageNumber,
        tool: body.tool,
        points: JSON.stringify(body.points),
        color: body.color ?? "#ff0000",
        thickness: body.thickness ?? 2,
        text: body.text ?? null,
        createdBy: user.id,
        layerId,
        groupId: null,
      });

      const [created] = await db.insert(planDocumentMarkups).values(validated).returning();

      await logAudit(
        {
          userId: user.id,
          action: "CREATE",
          entityType: "planDocumentMarkup",
          entityId: created.id,
          newValue: JSON.stringify({ tool: created.tool, page: created.pageNumber, doc: created.planDocumentId }),
        },
        req,
      );

      recordJobMetrics("plan_document_markups_create", {
        ok: 1,
        ms: Date.now() - startedAt,
      });

      res.status(201).json({
        ...created,
        points: safeParsePoints(created.points),
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_create", { error: 1, ms: Date.now() - startedAt });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid markup data", details: err.errors });
        return;
      }
      logError("Error creating plan document markup", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

// ============================================================================
// DELETE markup
// ============================================================================
router.delete(
  "/api/plan-document-markups/:id",
  requireAuth,
  // Task #1609 RBAC: gate at the same set of roles as create. The
  // "owner-or-manager" rule is then applied per-row inside the handler
  // (so a FIELD_WORKER can delete their own markup but not someone else's).
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const [m] = await db
        .select()
        .from(planDocumentMarkups)
        .where(eq(planDocumentMarkups.id, req.params.id))
        .limit(1);
      if (!m) {
        res.status(404).json({ error: "Markup not found" });
        return;
      }

      const user = req.user!;
      const isSuperAdmin = user.role === "SUPER_ADMIN";
      const isAdminOrManager = isSuperAdmin || user.role === "ADMIN" || user.role === "MANAGER";
      const isOwner = m.createdBy === user.id;

      if (!isSuperAdmin && m.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!isOwner && !isAdminOrManager) {
        res.status(403).json({ error: "You can only delete your own markups" });
        return;
      }

      await db.delete(planDocumentMarkups).where(eq(planDocumentMarkups.id, m.id));

      await logAudit(
        {
          userId: user.id,
          action: "DELETE",
          entityType: "planDocumentMarkup",
          entityId: m.id,
        },
        req,
      );

      recordJobMetrics("plan_document_markups_delete", {
        ok: 1,
        ms: Date.now() - startedAt,
      });

      res.json({ ok: true });
    } catch (err) {
      recordJobMetrics("plan_document_markups_delete", { error: 1, ms: Date.now() - startedAt });
      next(err);
    }
  },
);

// ============================================================================
// Task #1662 — PATCH markup: re-assign to a different layer or change
// its group membership. We deliberately do NOT support editing the
// shape/text/color through this endpoint — those are handled by drawing
// a new markup or deleting the old one. Keeping the surface narrow
// limits the audit/permission blast radius.
// ============================================================================
const patchMarkupBody = z
  .object({
    layerId: z.string().min(1).nullable().optional(),
    groupId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v) => v.layerId !== undefined || v.groupId !== undefined,
    { message: "At least one of layerId or groupId must be provided" },
  );

router.patch(
  "/api/plan-document-markups/:id",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = patchMarkupBody.parse(req.body || {});
      const [m] = await db
        .select()
        .from(planDocumentMarkups)
        .where(eq(planDocumentMarkups.id, req.params.id))
        .limit(1);
      if (!m) {
        res.status(404).json({ error: "Markup not found" });
        return;
      }
      const user = req.user!;
      const isSuperAdmin = user.role === "SUPER_ADMIN";
      if (!isSuperAdmin && m.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const isAdminOrManager = isSuperAdmin || user.role === "ADMIN" || user.role === "MANAGER";
      const isOwner = m.createdBy === user.id;
      if (!isOwner && !isAdminOrManager) {
        res.status(403).json({ error: "You can only edit your own markups" });
        return;
      }

      const patch: Record<string, unknown> = {};
      if (body.layerId !== undefined) {
        if (body.layerId === null) {
          patch.layerId = null;
        } else {
          const [layer] = await db
            .select()
            .from(planMarkupLayers)
            .where(eq(planMarkupLayers.id, body.layerId))
            .limit(1);
          if (!layer || layer.planDocumentId !== m.planDocumentId) {
            res.status(400).json({ error: "Layer does not belong to this plan document" });
            return;
          }
          patch.layerId = layer.id;
        }
      }
      if (body.groupId !== undefined) {
        patch.groupId = body.groupId;
      }
      const [updated] = await db
        .update(planDocumentMarkups)
        .set(patch)
        .where(eq(planDocumentMarkups.id, m.id))
        .returning();
      res.json({ ...updated, points: safeParsePoints(updated.points) });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid patch", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// Task #1676 — Bulk PATCH: reposition multiple markups in one request.
// Used by the plan-side overlay when the user drags a grouped markup —
// every member of the group needs to move by the same delta atomically
// so the visual group stays intact even if the network blips mid-flight.
//
// Each entry carries the markup id and its NEW normalized points array.
// Per-row owner-or-manager check still applies, so a FIELD_WORKER can
// only move groups composed of their own markups (an admin/manager can
// move any). All updates run in a single transaction so a partial
// failure either commits everything or nothing.
// ============================================================================
const bulkPatchPointsBody = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().min(1),
        points: z
          .array(z.object({ x: z.number(), y: z.number() }))
          .min(1)
          .max(4096),
      }),
    )
    .min(1)
    .max(500),
});

router.patch(
  "/api/plan-documents/:docId/markups/bulk",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const body = bulkPatchPointsBody.parse(req.body || {});
      const ids = body.updates.map((u) => u.id);
      const rows = await db
        .select()
        .from(planDocumentMarkups)
        .where(inArray(planDocumentMarkups.id, ids));
      if (rows.length !== ids.length) {
        res.status(404).json({ error: "One or more markups were not found" });
        return;
      }
      const user = req.user!;
      const isSuperAdmin = user.role === "SUPER_ADMIN";
      const isAdminOrManager =
        isSuperAdmin || user.role === "ADMIN" || user.role === "MANAGER";
      for (const r of rows) {
        if (r.planDocumentId !== access.doc.id) {
          res
            .status(400)
            .json({ error: "All markups must belong to the same plan document" });
          return;
        }
        if (!isSuperAdmin && r.organizationId !== user.organizationId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
        if (!isAdminOrManager && r.createdBy !== user.id) {
          res
            .status(403)
            .json({ error: "You can only edit your own markups" });
          return;
        }
      }
      await db.transaction(async (tx) => {
        for (const u of body.updates) {
          await tx
            .update(planDocumentMarkups)
            .set({ points: JSON.stringify(u.points) })
            .where(eq(planDocumentMarkups.id, u.id));
        }
      });
      await logAudit(
        {
          userId: user.id,
          action: "UPDATE",
          entityType: "planDocumentMarkup",
          entityId: access.doc.id,
          newValue: JSON.stringify({
            op: "bulkMove",
            count: body.updates.length,
            ids,
          }),
        },
        req,
      );
      recordJobMetrics("plan_document_markups_bulk_move", {
        ok: 1,
        count: body.updates.length,
        ms: Date.now() - startedAt,
      });
      res.json({ ok: true, count: body.updates.length });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_bulk_move", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid bulk patch", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// Task #1662 — Group / Ungroup multiple markups. Group assigns the same
// new uuid to every markup id in the request body so they move + delete
// as one unit. Ungroup clears it. Both operations are scoped to a single
// plan_document for tenant + cross-doc safety; the route returns the
// list of affected markup ids and the new group id (or null on ungroup).
// ============================================================================
const groupBody = z.object({
  markupIds: z.array(z.string().min(1)).min(2),
});
router.post(
  "/api/plan-documents/:docId/markup-groups",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const body = groupBody.parse(req.body || {});
      const rows = await db
        .select()
        .from(planDocumentMarkups)
        .where(inArray(planDocumentMarkups.id, body.markupIds));
      // Reject if any markup belongs to another doc/org — keeps groups
      // from spanning sheets or tenants.
      for (const r of rows) {
        if (r.planDocumentId !== access.doc.id) {
          res.status(400).json({ error: "All markups must belong to the same plan document" });
          return;
        }
        if (r.organizationId !== access.doc.organizationId) {
          res.status(403).json({ error: "Cross-org grouping is not allowed" });
          return;
        }
      }
      if (rows.length !== body.markupIds.length) {
        res.status(404).json({ error: "One or more markups were not found" });
        return;
      }
      const groupId = crypto.randomUUID();
      await db
        .update(planDocumentMarkups)
        .set({ groupId })
        .where(inArray(planDocumentMarkups.id, body.markupIds));
      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "planDocumentMarkup",
          entityId: groupId,
          newValue: JSON.stringify({ groupId, members: body.markupIds.length }),
        },
        req,
      );
      res.json({ ok: true, groupId, count: body.markupIds.length });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid group request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

const ungroupBody = z.object({
  // Either a list of markup ids, or a single groupId to dissolve.
  markupIds: z.array(z.string().min(1)).optional(),
  groupId: z.string().min(1).optional(),
}).refine((v) => (v.markupIds && v.markupIds.length > 0) || v.groupId, {
  message: "Provide markupIds or groupId",
});

router.post(
  "/api/plan-documents/:docId/markup-ungroup",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const body = ungroupBody.parse(req.body || {});
      const targets = body.markupIds && body.markupIds.length > 0
        ? await db
            .select()
            .from(planDocumentMarkups)
            .where(inArray(planDocumentMarkups.id, body.markupIds))
        : await db
            .select()
            .from(planDocumentMarkups)
            .where(
              and(
                eq(planDocumentMarkups.planDocumentId, access.doc.id),
                eq(planDocumentMarkups.groupId, body.groupId!),
              ),
            );
      for (const r of targets) {
        if (r.planDocumentId !== access.doc.id) {
          res.status(400).json({ error: "All markups must belong to the same plan document" });
          return;
        }
      }
      if (targets.length === 0) {
        res.json({ ok: true, count: 0 });
        return;
      }
      const ids = targets.map((t) => t.id);
      await db
        .update(planDocumentMarkups)
        .set({ groupId: null })
        .where(inArray(planDocumentMarkups.id, ids));
      res.json({ ok: true, count: ids.length });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid ungroup request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// Task #1662 — Layer CRUD: list/create/rename/delete + per-user
// visibility toggle. Layers live one-per-plan_document and the default
// layer is auto-materialised on first read so legacy sheets keep
// working.
// ============================================================================
router.get(
  "/api/plan-documents/:docId/markup-layers",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const user = req.user!;
      // Materialise the default layer on first read so the panel never
      // shows an empty list (Task #1662 acceptance: a default layer
      // always exists).
      await ensureDefaultLayer(access.doc, user.id);

      const rows = await db
        .select({
          id: planMarkupLayers.id,
          planDocumentId: planMarkupLayers.planDocumentId,
          name: planMarkupLayers.name,
          color: planMarkupLayers.color,
          sortOrder: planMarkupLayers.sortOrder,
          isDefault: planMarkupLayers.isDefault,
          createdById: planMarkupLayers.createdById,
          createdAt: planMarkupLayers.createdAt,
        })
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.planDocumentId, access.doc.id))
        .orderBy(planMarkupLayers.sortOrder, planMarkupLayers.createdAt);

      // Fetch this user's per-layer visibility overrides. Absence of a
      // row means "visible" (the default), so we coalesce on the client
      // and return an explicit `isVisible` per layer for convenience.
      const layerIds = rows.map((r) => r.id);
      let visibilityMap: Record<string, boolean> = {};
      if (layerIds.length > 0) {
        const vis = await db
          .select()
          .from(planMarkupLayerVisibility)
          .where(
            and(
              eq(planMarkupLayerVisibility.userId, user.id),
              inArray(planMarkupLayerVisibility.layerId, layerIds),
            ),
          );
        visibilityMap = Object.fromEntries(vis.map((v) => [v.layerId, v.isVisible]));
      }

      // Per-layer counts so the panel can render "QA/QC (12)" without
      // a second round-trip.
      const counts = layerIds.length === 0 ? [] : await db
        .select({
          layerId: planDocumentMarkups.layerId,
          count: sql<number>`count(*)::int`,
        })
        .from(planDocumentMarkups)
        .where(
          and(
            eq(planDocumentMarkups.planDocumentId, access.doc.id),
            inArray(planDocumentMarkups.layerId, layerIds),
          ),
        )
        .groupBy(planDocumentMarkups.layerId);
      const countMap = Object.fromEntries(
        counts.map((c) => [c.layerId, Number(c.count) || 0]),
      );

      res.json(
        rows.map((r) => ({
          ...r,
          isVisible: visibilityMap[r.id] ?? true,
          markupCount: countMap[r.id] ?? 0,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

const createLayerBody = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.string().min(1).max(16).optional(),
  sortOrder: z.number().int().optional(),
});
router.post(
  "/api/plan-documents/:docId/markup-layers",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const user = req.user!;
      if (!user.organizationId) {
        res.status(403).json({ error: "No organization assigned" });
        return;
      }
      const body = createLayerBody.parse(req.body || {});
      // Reserved name guard so users can't create a second "Default".
      if (body.name.toLowerCase() === DEFAULT_LAYER_NAME.toLowerCase()) {
        res.status(400).json({ error: `"${DEFAULT_LAYER_NAME}" is a reserved layer name` });
        return;
      }
      try {
        const [created] = await db
          .insert(planMarkupLayers)
          .values({
            organizationId: user.organizationId,
            planDocumentId: access.doc.id,
            name: body.name,
            color: body.color ?? "#94a3b8",
            sortOrder: body.sortOrder ?? Date.now() % 1000000,
            isDefault: false,
            createdById: user.id,
          })
          .returning();
        await logAudit(
          {
            userId: user.id,
            action: "CREATE",
            entityType: "planMarkupLayer",
            entityId: created.id,
            newValue: JSON.stringify({ name: created.name, doc: created.planDocumentId }),
          },
          req,
        );
        res.status(201).json({ ...created, isVisible: true, markupCount: 0 });
      } catch (e: any) {
        // Unique constraint on (plan_document_id, name).
        if (String(e?.code) === "23505") {
          res.status(409).json({ error: "A layer with that name already exists" });
          return;
        }
        throw e;
      }
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid layer", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

const patchLayerBody = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  color: z.string().min(1).max(16).optional(),
  sortOrder: z.number().int().optional(),
});
router.patch(
  "/api/plan-markup-layers/:id",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = patchLayerBody.parse(req.body || {});
      const [layer] = await db
        .select()
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.id, req.params.id))
        .limit(1);
      if (!layer) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      const user = req.user!;
      if (user.role !== "SUPER_ADMIN" && layer.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      // Default layer can have its color/sortOrder tweaked but its name
      // is locked so the "everything goes here by default" affordance
      // stays predictable.
      if (layer.isDefault && body.name && body.name !== layer.name) {
        res.status(400).json({ error: "The default layer cannot be renamed" });
        return;
      }
      try {
        const [updated] = await db
          .update(planMarkupLayers)
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          })
          .where(eq(planMarkupLayers.id, layer.id))
          .returning();
        res.json(updated);
      } catch (e: any) {
        if (String(e?.code) === "23505") {
          res.status(409).json({ error: "A layer with that name already exists" });
          return;
        }
        throw e;
      }
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid layer patch", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

router.delete(
  "/api/plan-markup-layers/:id",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const [layer] = await db
        .select()
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.id, req.params.id))
        .limit(1);
      if (!layer) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      const user = req.user!;
      if (user.role !== "SUPER_ADMIN" && layer.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (layer.isDefault) {
        res.status(400).json({ error: "The default layer cannot be deleted" });
        return;
      }
      // ON DELETE SET NULL on plan_document_markups.layer_id drops the
      // affected markups back into the default bucket — exactly the
      // behaviour the task spec calls for.
      await db.delete(planMarkupLayers).where(eq(planMarkupLayers.id, layer.id));
      await logAudit(
        {
          userId: user.id,
          action: "DELETE",
          entityType: "planMarkupLayer",
          entityId: layer.id,
        },
        req,
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

const visibilityBody = z.object({ isVisible: z.boolean() });
router.put(
  "/api/plan-markup-layers/:id/visibility",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = visibilityBody.parse(req.body || {});
      const [layer] = await db
        .select()
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.id, req.params.id))
        .limit(1);
      if (!layer) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      const user = req.user!;
      if (user.role !== "SUPER_ADMIN" && layer.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      // Upsert on (user_id, layer_id) — visibility is per-user so two
      // teammates can independently focus on their own layers.
      await db
        .insert(planMarkupLayerVisibility)
        .values({ layerId: layer.id, userId: user.id, isVisible: body.isVisible })
        .onConflictDoUpdate({
          target: [planMarkupLayerVisibility.userId, planMarkupLayerVisibility.layerId],
          set: { isVisible: body.isVisible, updatedAt: new Date() },
        });
      res.json({ ok: true, layerId: layer.id, isVisible: body.isVisible });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid visibility", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// CARRYOVER pins + markups from a source plan_document to the current one.
// Idempotent — repeated calls with the same source do not duplicate rows
// because of the (plan_document_id, source_*_id) UNIQUE indexes; the
// implementation uses `ON CONFLICT DO NOTHING` to make the no-op explicit.
// ============================================================================
const carryoverBody = z.object({
  fromDocumentId: z.string().min(1),
  includePins: z.boolean().optional().default(true),
  includeMarkups: z.boolean().optional().default(true),
});

router.post(
  "/api/plan-documents/:docId/carryover-annotations",
  requireAuth,
  // Bulk-mutation surface — same role-set as markup create/delete.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "FIELD_WORKER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const body = carryoverBody.parse(req.body || {});

      const targetAccess = await loadDocAndAssertOrg(req.params.docId, req);
      if (!targetAccess.ok) {
        res.status(targetAccess.status).json({ error: targetAccess.error });
        return;
      }
      const sourceAccess = await loadDocAndAssertOrg(body.fromDocumentId, req);
      if (!sourceAccess.ok) {
        res.status(sourceAccess.status).json({ error: sourceAccess.error });
        return;
      }

      // Both documents must belong to the same project — copying across
      // projects is never desirable here and would silently create
      // cross-project annotation drift.
      if (
        targetAccess.doc.projectId &&
        sourceAccess.doc.projectId &&
        targetAccess.doc.projectId !== sourceAccess.doc.projectId
      ) {
        res
          .status(400)
          .json({ error: "fromDocumentId must belong to the same project as :docId" });
        return;
      }

      // Resolve project code (needed for plan_pins.projectCode) once.
      let projectCode: string | null = null;
      if (targetAccess.doc.projectId) {
        const [proj] = await db
          .select({ code: projects.code })
          .from(projects)
          .where(eq(projects.id, targetAccess.doc.projectId))
          .limit(1);
        projectCode = proj?.code ?? null;
      }

      // Task #1609 — execute the entire carryover in a single transaction
      // so that a partial copy never appears as `ok: true`. ON CONFLICT DO
      // NOTHING is still used to make repeats idempotent (no duplicate
      // (plan_document_id, source_*_id) pairs), but any *other* failure
      // rolls back both pins and markups together.
      const { pinsCopied, markupsCopied } = await db.transaction(async (tx) => {
        let pinsCopiedTx = 0;
        let markupsCopiedTx = 0;

        if (body.includePins && projectCode) {
          const sourcePins = await tx
            .select()
            .from(planPins)
            .where(eq(planPins.planDocumentId, body.fromDocumentId));

          // Only carry over pins that originated as primary entries on the
          // source document — recursively-copied pins (sourcePinId !== null)
          // are skipped to avoid recursive lineage explosion.
          const primaryPins = sourcePins.filter((p) => !p.sourcePinId);
          if (primaryPins.length > 0) {
            const inserted = await tx
              .insert(planPins)
              .values(
                primaryPins.map((p) => ({
                  organizationId: p.organizationId,
                  projectCode: projectCode,
                  planDocumentId: targetAccess.doc.id,
                  pageNumber: p.pageNumber,
                  x: p.x,
                  y: p.y,
                  pinType: p.pinType,
                  refTable: p.refTable,
                  refId: p.refId,
                  createdById: req.user!.id,
                  sourcePinId: p.id,
                })),
              )
              .onConflictDoNothing({
                target: [planPins.planDocumentId, planPins.sourcePinId],
                where: sql`${planPins.sourcePinId} IS NOT NULL`,
              })
              .returning({ id: planPins.id });
            pinsCopiedTx = inserted.length;
          }
        }

        if (body.includeMarkups) {
          const sourceMarkups = await tx
            .select()
            .from(planDocumentMarkups)
            .where(eq(planDocumentMarkups.planDocumentId, body.fromDocumentId));

          const primaryMarkups = sourceMarkups.filter((m) => !m.sourceMarkupId);
          if (primaryMarkups.length > 0) {
            // Task #1662 — preserve layer assignment when copying
            // markups to the new revision. Build a (sourceLayerId →
            // targetLayerId) map by find-or-creating each source layer
            // by name on the target document. Markups whose layer was
            // null (legacy rows) stay null and end up in the target's
            // default layer at render time.
            const sourceLayerIds = Array.from(
              new Set(
                primaryMarkups
                  .map((m) => m.layerId)
                  .filter((id): id is string => !!id),
              ),
            );
            const layerMap = new Map<string, string>();
            if (sourceLayerIds.length > 0) {
              const sourceLayers = await tx
                .select()
                .from(planMarkupLayers)
                .where(inArray(planMarkupLayers.id, sourceLayerIds));
              for (const sourceLayer of sourceLayers) {
                // Re-use a same-named layer on the target doc when it
                // already exists (idempotent across repeated carryovers
                // and across runs that pulled from different sources
                // sharing layer names like "QA/QC").
                const [existing] = await tx
                  .select()
                  .from(planMarkupLayers)
                  .where(
                    and(
                      eq(planMarkupLayers.planDocumentId, targetAccess.doc.id),
                      eq(planMarkupLayers.name, sourceLayer.name),
                    ),
                  )
                  .limit(1);
                if (existing) {
                  layerMap.set(sourceLayer.id, existing.id);
                  continue;
                }
                const [created] = await tx
                  .insert(planMarkupLayers)
                  .values({
                    organizationId: sourceLayer.organizationId,
                    planDocumentId: targetAccess.doc.id,
                    name: sourceLayer.name,
                    color: sourceLayer.color,
                    sortOrder: sourceLayer.sortOrder,
                    isDefault: sourceLayer.isDefault,
                    createdById: req.user!.id,
                  })
                  .onConflictDoNothing({
                    target: [planMarkupLayers.planDocumentId, planMarkupLayers.name],
                  })
                  .returning();
                if (created) {
                  layerMap.set(sourceLayer.id, created.id);
                } else {
                  // Lost an ON CONFLICT race — re-resolve the existing one.
                  const [now] = await tx
                    .select()
                    .from(planMarkupLayers)
                    .where(
                      and(
                        eq(planMarkupLayers.planDocumentId, targetAccess.doc.id),
                        eq(planMarkupLayers.name, sourceLayer.name),
                      ),
                    )
                    .limit(1);
                  if (now) layerMap.set(sourceLayer.id, now.id);
                }
              }
            }

            // Task #1662 — preserve group assignment too. Generate one
            // new group_id per source group so the carried-over markups
            // remain a single unit on the target sheet without
            // colliding with any existing group ids on it.
            const sourceGroupIds = Array.from(
              new Set(
                primaryMarkups
                  .map((m) => m.groupId)
                  .filter((id): id is string => !!id),
              ),
            );
            const groupMap = new Map<string, string>();
            for (const gid of sourceGroupIds) {
              groupMap.set(gid, crypto.randomUUID());
            }

            const inserted = await tx
              .insert(planDocumentMarkups)
              .values(
                primaryMarkups.map((m) => ({
                  organizationId: m.organizationId,
                  projectId: targetAccess.doc.projectId,
                  planDocumentId: targetAccess.doc.id,
                  pageNumber: m.pageNumber,
                  tool: m.tool,
                  points: m.points,
                  color: m.color,
                  thickness: m.thickness,
                  text: m.text,
                  createdBy: req.user!.id,
                  sourceMarkupId: m.id,
                  layerId: m.layerId ? layerMap.get(m.layerId) ?? null : null,
                  groupId: m.groupId ? groupMap.get(m.groupId) ?? null : null,
                })),
              )
              .onConflictDoNothing({
                target: [planDocumentMarkups.planDocumentId, planDocumentMarkups.sourceMarkupId],
                where: sql`${planDocumentMarkups.sourceMarkupId} IS NOT NULL`,
              })
              .returning({ id: planDocumentMarkups.id });
            markupsCopiedTx = inserted.length;
          }
        }

        return { pinsCopied: pinsCopiedTx, markupsCopied: markupsCopiedTx };
      });

      await logAudit(
        {
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "planDocument",
          entityId: targetAccess.doc.id,
          newValue: JSON.stringify({
            from: body.fromDocumentId,
            pinsCopied,
            markupsCopied,
          }),
        },
        req,
      );

      recordJobMetrics("plan_document_carryover", {
        ok: 1,
        pinsCopied,
        markupsCopied,
        ms: Date.now() - startedAt,
      });

      res.json({
        ok: true,
        pinsCopied,
        markupsCopied,
        skipped: {
          // Idempotency-skipped counts. Useful for the "already carried over"
          // affordance in the upload prompt UI.
          reason: "duplicate-source",
        },
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_carryover", { error: 1, ms: Date.now() - startedAt });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid carryover request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// LIST pins for a single plan_document. Convenience endpoint used by the
// print page so it can fetch overlays without first resolving the
// project code.
// ============================================================================
router.get(
  "/api/plan-pin-rollup-by-doc/:docId",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const rows = await db
        .select({
          id: planPins.id,
          pageNumber: planPins.pageNumber,
          x: planPins.x,
          y: planPins.y,
          pinType: planPins.pinType,
          refTable: planPins.refTable,
          refId: planPins.refId,
        })
        .from(planPins)
        .where(eq(planPins.planDocumentId, req.params.docId));
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================================
// PRINT-STREAM — stream the underlying PDF bytes for the print page. Mirrors
// `/api/projects/:code/documents/:docId/stream` but is keyed only on the
// document id so the print page (which doesn't know the project code at
// load time) can resolve the file with one fetch.
// ============================================================================
router.get(
  "/api/plan-documents/:docId/print-stream",
  requireAuth,
  // Same role-set as export.pdf — prevents bypassing the export gate
  // by loading /print/plan-documents/:id and using browser print-to-PDF.
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
      const doc = access.doc;
      const { filterFilesByPermissions } = await import("./fileAccessHelpers");
      const permitted = await filterFilesByPermissions(
        [doc],
        req.user!.id,
        req.user!.role,
        "DOCUMENT",
      );
      if (permitted.length === 0) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const storageKey = doc.objectKey || doc.fileUrl;
      if (!storageKey) {
        res.status(404).json({ error: "No file associated with this document" });
        return;
      }

      const { ObjectStorageService } = await import("./objectStorage");
      const objectStorageService = new ObjectStorageService();
      const objectFile = await objectStorageService.getObjectEntityFile(storageKey);
      const allowed = await objectStorageService.canAccessObjectEntity({
        userId: req.user!.id,
        userOrganizationId: req.user!.organizationId || undefined,
        objectFile,
        requestedPermission: ObjectPermission.READ,
        userRole: req.user!.role,
      });
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      await objectStorageService.downloadObject(objectFile, res, 3600);
    } catch (err) {
      logError(
        "[plan-pdf-export] print-stream failed",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      if (!res.headersSent) next(err);
    }
  },
);

// ============================================================================
// EXPORT — burn markups (and optionally pins) into a downloaded PDF
// ============================================================================
router.get(
  "/api/plan-documents/:docId/export.pdf",
  requireAuth,
  // Task #1609 RBAC: PDF export spins up a headless browser and is the
  // most expensive surface in this router. Limit it to roles that need to
  // distribute construction documents (SUPERINTENDENT is the codebase's
  // analogue of "project engineer" for this purpose).
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const access = await loadDocAndAssertOrg(req.params.docId, req);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }

      // Accept ?flag=true|false|1|0|yes|no|on|off (case-insensitive).
      const parseBoolFlag = (v: unknown, defaultValue: boolean): boolean => {
        if (v === undefined || v === null || v === "") return defaultValue;
        if (typeof v === "boolean") return v;
        const s = String(v).trim().toLowerCase();
        if (s === "0" || s === "false" || s === "no" || s === "off") return false;
        if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
        return defaultValue;
      };
      const includeMarkups = parseBoolFlag(req.query.includeMarkups, true);
      const includePins = parseBoolFlag(req.query.includePins, true);

      // Resolve origin so the print page can hit our own APIs.
      const protoHeader = (req.headers["x-forwarded-proto"] as string | undefined) || req.protocol;
      const proto = String(protoHeader).split(",")[0].trim() || "http";
      const host = (req.headers["x-forwarded-host"] as string | undefined) || req.get("host") || "localhost";
      const origin = `${proto}://${host}`;

      // Forward the requesting user's auth cookie to the headless browser.
      // This codebase uses the `auth_token` JWT cookie (server/auth.ts);
      // SESSION_COOKIE_NAME and connect.sid are fallbacks.
      const cookieCandidates = [
        process.env.SESSION_COOKIE_NAME,
        "auth_token",
        "connect.sid",
      ].filter((n): n is string => !!n);
      let cookieName: string | undefined;
      let cookieValue: string | undefined;
      for (const candidate of cookieCandidates) {
        const v = req.cookies?.[candidate] as string | undefined;
        if (v) {
          cookieName = candidate;
          cookieValue = v;
          break;
        }
      }
      if (!cookieName || !cookieValue) {
        // The export requires a real session/JWT cookie to render the
        // print page; bearer-token-only auth would not propagate to the
        // headless browser.
        res.status(400).json({ error: "Export requires an interactive session." });
        return;
      }

      const pdfBuffer = await renderPlanDocumentPdf({
        documentId: access.doc.id,
        origin,
        authCookie: { name: cookieName, value: cookieValue },
        includeMarkups,
        includePins,
      });

      recordJobMetrics("plan_document_pdf_export", {
        ok: 1,
        bytes: pdfBuffer.length,
        ms: Date.now() - startedAt,
      });

      const fileName = (access.doc.fileName || "plan-document").replace(/\.[^.]+$/, "");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}-with-markups.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      recordJobMetrics("plan_document_pdf_export", { error: 1, ms: Date.now() - startedAt });
      if (err instanceof PlanPdfTooLargeError) {
        res.status(413).json({
          error: `Plan document has ${err.pageCount} pages; export is capped at ${MAX_PAGES}.`,
        });
        return;
      }
      logError("[plan-pdf-export] route failed", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

export default router;
