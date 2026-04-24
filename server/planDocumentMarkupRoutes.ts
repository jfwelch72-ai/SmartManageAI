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
import { eq, and, inArray, isNull, sql } from "drizzle-orm";
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

      // Task #1775 — exclude soft-deleted rows from every read path so
      // a deleted markup is invisible until the restore endpoint clears
      // its `deleted_at`. This is the LIST endpoint the canvas + the
      // headless print page (PDF export) both consume.
      const conds = [
        eq(planDocumentMarkups.planDocumentId, req.params.docId),
        isNull(planDocumentMarkups.deletedAt),
      ];
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

      // Task #1775 — soft-delete: stamp `deleted_at` instead of removing
      // the row so the new `POST /api/plan-document-markups/:id/restore`
      // endpoint can clear the column and bring the markup back with
      // its original id, layer, group, points, and every other column
      // intact. Idempotent on an already-deleted row: re-stamping just
      // updates the timestamp, the response is still 200, and a stale
      // double-DELETE never errors out.
      await db
        .update(planDocumentMarkups)
        .set({ deletedAt: new Date() })
        .where(eq(planDocumentMarkups.id, m.id));

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
      // Task #1775 — soft-deleted rows are invisible to the move
      // endpoint, so a stale drag against a row that was just deleted
      // surfaces as a clean 404 (same response a hard-delete would
      // produce) rather than silently mutating an undead row.
      const rows = await db
        .select()
        .from(planDocumentMarkups)
        .where(
          and(
            inArray(planDocumentMarkups.id, ids),
            isNull(planDocumentMarkups.deletedAt),
          ),
        );
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
// Task #1776 — Bulk DELETE: remove multiple markups in one request.
// Symmetric with the bulk PATCH above and used by the toolbar's
// "delete selected group" gesture. Issuing one DELETE per group member
// is N round-trips through auth + per-row checks and a network blip
// mid-flight can leave a group half-deleted; this route applies the
// same per-row org + RBAC checks the single DELETE applies, then
// removes every row in a single transaction so the operation is
// all-or-nothing.
//
// Per-row authorization mirrors the single DELETE handler exactly:
// SUPER_ADMIN bypasses org checks, ADMIN/MANAGER may delete any row
// in their org, FIELD_WORKER/SUPERINTENDENT may only delete rows they
// authored. Cross-doc and cross-org rows are rejected up-front (400 /
// 403) before the transaction opens, so a bad payload can never
// partially apply.
// ============================================================================
const bulkDeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

router.delete(
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
      const body = bulkDeleteBody.parse(req.body || {});
      // De-duplicate caller-supplied ids so a payload that lists the
      // same row twice doesn't trip the "rows.length !== ids.length"
      // not-found check below.
      const ids = Array.from(new Set(body.ids));
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
            .json({ error: "You can only delete your own markups" });
          return;
        }
      }
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(planDocumentMarkups)
          .where(inArray(planDocumentMarkups.id, ids))
          .returning({ id: planDocumentMarkups.id });
        // Defensive: if a concurrent writer removed any of the rows
        // between the SELECT above and the DELETE here, the row count
        // will diverge. Throw to roll back the transaction so the
        // caller never sees a "partially succeeded" delete (which is
        // the whole point of this route over fan-out per-id DELETEs).
        if (deleted.length !== ids.length) {
          throw new Error("Bulk delete affected fewer rows than expected");
        }
      });
      await logAudit(
        {
          userId: user.id,
          action: "DELETE",
          entityType: "planDocumentMarkup",
          entityId: access.doc.id,
          newValue: JSON.stringify({
            op: "bulkDelete",
            count: ids.length,
            ids,
          }),
        },
        req,
      );
      recordJobMetrics("plan_document_markups_bulk_delete", {
        ok: 1,
        count: ids.length,
        ms: Date.now() - startedAt,
      });
      res.json({ ok: true, count: ids.length });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_bulk_delete", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid bulk delete", details: err.errors });
        return;
      }
      logError(
        "Error bulk-deleting plan document markups",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
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
      // Task #1775 — soft-deleted rows can never be members of a group;
      // filtering here makes a stale Group click against a deleted
      // member return 404 instead of silently grouping a deleted row.
      const rows = await db
        .select()
        .from(planDocumentMarkups)
        .where(
          and(
            inArray(planDocumentMarkups.id, body.markupIds),
            isNull(planDocumentMarkups.deletedAt),
          ),
        );
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
      // Task #1775 — soft-deleted rows are excluded from the ungroup
      // surface as well; only live rows have a groupId worth clearing.
      const targets = body.markupIds && body.markupIds.length > 0
        ? await db
            .select()
            .from(planDocumentMarkups)
            .where(
              and(
                inArray(planDocumentMarkups.id, body.markupIds),
                isNull(planDocumentMarkups.deletedAt),
              ),
            )
        : await db
            .select()
            .from(planDocumentMarkups)
            .where(
              and(
                eq(planDocumentMarkups.planDocumentId, access.doc.id),
                eq(planDocumentMarkups.groupId, body.groupId!),
                isNull(planDocumentMarkups.deletedAt),
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
// Task #1737 — Bulk RESTORE markups with caller-supplied ids. Powers the
// "undo delete" / "redo create" paths in the plan markup overlay. The
// undo stack hands back the full pre-deletion snapshot of every removed
// markup; this route re-inserts them with their original ids so any
// downstream references (group memberships, pin links, source_markup_id
// carryover) stay valid. ON CONFLICT DO NOTHING per row makes the route
// idempotent so a double-click or stale Ctrl+Z never errors out.
// ============================================================================
const restoreMarkupsBody = z.object({
  markups: z
    .array(
      z.object({
        id: z.string().min(1),
        pageNumber: z.number().int().min(1),
        tool: z.enum(["ARROW", "TEXT", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"]),
        points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
        color: z.string().min(1).max(16),
        thickness: z.number().int().min(1).max(64),
        text: z.string().nullable().optional(),
        layerId: z.string().min(1).nullable().optional(),
        groupId: z.string().min(1).nullable().optional(),
        createdBy: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(500),
});

router.post(
  "/api/plan-documents/:docId/markups/restore",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
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
      const body = restoreMarkupsBody.parse(req.body || {});

      // Only admins/managers (and SUPER_ADMIN) may preserve the
      // original creator's id when restoring; everyone else is forced
      // to caller-id attribution to prevent authorship spoofing.
      const isAdminOrManagerForRestore =
        user.role === "SUPER_ADMIN" ||
        user.role === "ADMIN" ||
        user.role === "MANAGER";

      // Verify any caller-supplied layerIds belong to this plan document
      // (mirrors the per-row check in the create handler so a malicious
      // restore payload can't leak markups into another sheet's layer).
      const layerIds = Array.from(
        new Set(
          body.markups
            .map((m) => m.layerId)
            .filter((v): v is string => typeof v === "string"),
        ),
      );
      let validLayerIds = new Set<string>();
      if (layerIds.length > 0) {
        const layers = await db
          .select()
          .from(planMarkupLayers)
          .where(inArray(planMarkupLayers.id, layerIds));
        for (const l of layers) {
          if (l.planDocumentId === access.doc.id) validLayerIds.add(l.id);
        }
        for (const lid of layerIds) {
          if (!validLayerIds.has(lid)) {
            res.status(400).json({ error: "Layer does not belong to this plan document" });
            return;
          }
        }
      }

      // Insert each row with its original id. ON CONFLICT (id) DO NOTHING
      // makes a duplicate restore (e.g. user double-tapped Ctrl+Z) a
      // no-op rather than a 500 — the previously-restored row stays.
      const inserted: Array<typeof planDocumentMarkups.$inferSelect> = [];
      await db.transaction(async (tx) => {
        for (const m of body.markups) {
          const values = {
            id: m.id,
            organizationId: user.organizationId!,
            projectId: access.doc.projectId,
            planDocumentId: access.doc.id,
            pageNumber: m.pageNumber,
            tool: m.tool,
            points: JSON.stringify(m.points),
            color: m.color,
            thickness: m.thickness,
            text: m.text ?? null,
            // Authorship preservation: an admin/manager may restore a
            // row with the original creator's id (so undo of someone
            // else's delete keeps audit lineage intact). Non-privileged
            // callers (FIELD_WORKER / SUPERINTENDENT) can never spoof
            // authorship — we force createdBy to the caller's id even
            // if the client sends a different value, so this route
            // can't be used to forge attribution or escalate
            // ownership-based edit rights.
            createdBy:
              isAdminOrManagerForRestore && m.createdBy
                ? m.createdBy
                : user.id,
            layerId: m.layerId ?? null,
            groupId: m.groupId ?? null,
          };
          // Task #1775 — the DELETE handler now soft-deletes (stamps
          // `deleted_at`) instead of removing the row, so a restore of
          // a row that the caller deleted in this same session would
          // collide on the primary key. Switch the conflict policy to
          // DO UPDATE so the existing row is "undeleted" by clearing
          // `deleted_at` and refreshed from the snapshot. The original
          // id, layer, group, and downstream references survive
          // because the row never went away. New ids (the rare case
          // where the snapshot belongs to a row that was hard-deleted
          // before #1775 shipped) still INSERT cleanly.
          const rows = await tx
            .insert(planDocumentMarkups)
            .values(values)
            .onConflictDoUpdate({
              target: planDocumentMarkups.id,
              set: {
                deletedAt: null,
                pageNumber: values.pageNumber,
                tool: values.tool,
                points: values.points,
                color: values.color,
                thickness: values.thickness,
                text: values.text,
                layerId: values.layerId,
                groupId: values.groupId,
              },
            })
            .returning();
          if (rows[0]) inserted.push(rows[0]);
        }
      });

      await logAudit(
        {
          userId: user.id,
          action: "CREATE",
          entityType: "planDocumentMarkup",
          entityId: access.doc.id,
          newValue: JSON.stringify({
            op: "restore",
            requested: body.markups.length,
            inserted: inserted.length,
            ids: body.markups.map((m) => m.id),
          }),
        },
        req,
      );
      recordJobMetrics("plan_document_markups_restore", {
        ok: 1,
        count: inserted.length,
        ms: Date.now() - startedAt,
      });
      res.status(201).json({
        ok: true,
        count: inserted.length,
        markups: inserted.map((m) => ({ ...m, points: safeParsePoints(m.points) })),
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_restore", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid restore request", details: err.errors });
        return;
      }
      logError("Error restoring plan document markups", {}, err instanceof Error ? err : new Error(String(err)));
      next(err);
    }
  },
);

// ============================================================================
// Task #1775 — Per-id RESTORE for the new soft-delete flow. The DELETE
// route now stamps `deleted_at` rather than removing the row, so the
// restore is just a single UPDATE that clears the column. The original
// id, layer, group, points, color, thickness, text, and createdBy all
// survive intact because the row never went away — that's the whole
// point of soft-delete vs the cached-snapshot bulk restore (Task #1737).
//
// Powers the toolbar's one-click "Undo delete" button. RBAC mirrors the
// DELETE handler exactly: same role-set, same per-row owner-or-manager
// check, same cross-org guard, so undoing a delete can never grant a
// caller permission they didn't have to delete the row in the first
// place. Idempotent on a row that's already live (already-cleared
// `deleted_at` just stays NULL).
// ============================================================================
router.post(
  "/api/plan-document-markups/:id/restore",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      // Look up the row including soft-deleted ones so the restore can
      // find a trashed markup. (Every other read path filters
      // `deleted_at IS NULL`; this is the single endpoint that must
      // see across that filter.)
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
      const isAdminOrManager =
        isSuperAdmin || user.role === "ADMIN" || user.role === "MANAGER";
      const isOwner = m.createdBy === user.id;

      if (!isSuperAdmin && m.organizationId !== user.organizationId) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      if (!isOwner && !isAdminOrManager) {
        res
          .status(403)
          .json({ error: "You can only restore your own markups" });
        return;
      }

      const [restored] = await db
        .update(planDocumentMarkups)
        .set({ deletedAt: null })
        .where(eq(planDocumentMarkups.id, m.id))
        .returning();

      // Log under "UPDATE" because the auditAction enum doesn't have a
      // dedicated RESTORE value yet; the newValue payload describes
      // the operation explicitly so the audit trail is still searchable.
      await logAudit(
        {
          userId: user.id,
          action: "UPDATE",
          entityType: "planDocumentMarkup",
          entityId: m.id,
          newValue: JSON.stringify({ op: "restore", deletedAt: null }),
        },
        req,
      );

      recordJobMetrics("plan_document_markups_restore_one", {
        ok: 1,
        ms: Date.now() - startedAt,
      });

      res.json({
        ok: true,
        markup: { ...restored, points: safeParsePoints(restored.points) },
      });
    } catch (err) {
      recordJobMetrics("plan_document_markups_restore_one", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      next(err);
    }
  },
);

// ============================================================================
// Task #1737 — Bulk SET groupId per markup. Powers the "undo group" /
// "undo ungroup" / "redo group" / "redo ungroup" paths. Each entry on
// the undo stack remembers the pre-mutation groupId per markup so this
// route can restore the prior state in a single round-trip. Each
// markup's groupId can be set independently, which lets us undo an
// "ungroup" that originally affected members from multiple groups
// without merging them into a single new group.
// ============================================================================
const groupAssignmentsBody = z.object({
  assignments: z
    .array(
      z.object({
        id: z.string().min(1),
        groupId: z.string().min(1).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

router.post(
  "/api/plan-documents/:docId/markup-group-assignments",
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
      const body = groupAssignmentsBody.parse(req.body || {});
      const ids = body.assignments.map((a) => a.id);
      // Task #1775 — soft-deleted rows cannot have their group
      // membership rewritten; the bulk restore endpoint must run first
      // to bring them back. Filter here so the response is a clean 404
      // rather than a silent UPDATE on an undead row.
      const rows = await db
        .select()
        .from(planDocumentMarkups)
        .where(
          and(
            inArray(planDocumentMarkups.id, ids),
            isNull(planDocumentMarkups.deletedAt),
          ),
        );
      if (rows.length !== ids.length) {
        res.status(404).json({ error: "One or more markups were not found" });
        return;
      }
      const user = req.user!;
      const isSuperAdmin = user.role === "SUPER_ADMIN";
      // RBAC parity: this route is the inverse of the forward
      // /markup-groups and /markup-ungroup routes (Task #1737 undo /
      // redo path), so its authorization must match theirs exactly —
      // role + same-doc + same-org. The forward routes deliberately
      // do NOT enforce per-row ownership (a non-admin user can group
      // a mixed-ownership selection successfully today), so neither
      // does this one. Otherwise Ctrl+Z would 403 on a group/ungroup
      // that the same user just performed without error.
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
      }
      await db.transaction(async (tx) => {
        for (const a of body.assignments) {
          await tx
            .update(planDocumentMarkups)
            .set({ groupId: a.groupId })
            .where(eq(planDocumentMarkups.id, a.id));
        }
      });
      await logAudit(
        {
          userId: user.id,
          action: "UPDATE",
          entityType: "planDocumentMarkup",
          entityId: access.doc.id,
          newValue: JSON.stringify({
            op: "groupAssignments",
            count: body.assignments.length,
          }),
        },
        req,
      );
      recordJobMetrics("plan_document_markups_group_assign", {
        ok: 1,
        count: body.assignments.length,
        ms: Date.now() - startedAt,
      });
      res.json({ ok: true, count: body.assignments.length });
    } catch (err: any) {
      recordJobMetrics("plan_document_markups_group_assign", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid group-assignments request", details: err.errors });
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
      // Task #1775 — soft-deleted rows must not inflate the per-layer
      // count, otherwise the panel would still show "QA/QC (12)" even
      // after the user trashes every member.
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
            isNull(planDocumentMarkups.deletedAt),
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
      // Task #1805 — opt-in cascade. Drives the "Undo" action on the
      // copy-to-sheet success toast: the freshly-created destination
      // layer AND every markup that was copied with it are removed in
      // a single transaction, leaving the destination sheet exactly as
      // it was before the accidental copy. Without `cascade`, the FK's
      // SET NULL behaviour is preserved and orphaned markups fall back
      // into the default bucket (Task #1662 semantics).
      const cascade = String(req.query.cascade ?? "") === "1" ||
        String(req.query.cascade ?? "").toLowerCase() === "true";
      let markupsDeleted = 0;
      if (cascade) {
        await db.transaction(async (tx) => {
          const removed = await tx
            .delete(planDocumentMarkups)
            .where(eq(planDocumentMarkups.layerId, layer.id))
            .returning({ id: planDocumentMarkups.id });
          markupsDeleted = removed.length;
          await tx.delete(planMarkupLayers).where(eq(planMarkupLayers.id, layer.id));
        });
      } else {
        // ON DELETE SET NULL on plan_document_markups.layer_id drops the
        // affected markups back into the default bucket — exactly the
        // behaviour the task spec calls for.
        await db.delete(planMarkupLayers).where(eq(planMarkupLayers.id, layer.id));
      }
      await logAudit(
        {
          userId: user.id,
          action: "DELETE",
          entityType: "planMarkupLayer",
          entityId: layer.id,
          ...(cascade
            ? { newValue: JSON.stringify({ cascade: true, markupsDeleted }) }
            : {}),
        },
        req,
      );
      res.json({ ok: true, ...(cascade ? { markupsDeleted } : {}) });
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
          // Task #1775 — never carry over soft-deleted rows from the
          // source revision. The user's intent on hitting "carry
          // markups over" is to bring forward the visible state of
          // the prior sheet; trashed rows are explicitly out of that
          // visible set.
          const sourceMarkups = await tx
            .select()
            .from(planDocumentMarkups)
            .where(
              and(
                eq(planDocumentMarkups.planDocumentId, body.fromDocumentId),
                isNull(planDocumentMarkups.deletedAt),
              ),
            );

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
// Task #1701 — COPY a single layer (and all its markups) from one
// plan_document onto another within the same project. Wraps the existing
// layer-name / group-id remapping logic used by carryover-annotations
// but is keyed on a *single* source layer rather than every primary
// markup on the source doc, so users can grab one named layer
// (e.g. "QA/QC", "Owner Comments") and replicate it to a sibling sheet
// without re-creating every annotation by hand.
//
// Behaviour:
//   - Source layer is unchanged.
//   - Destination receives a NEW layer named "<source name> (copy)".
//     If that name is already taken, the suffix bumps to "(copy 2)",
//     "(copy 3)", … so repeat invocations always succeed.
//   - The new layer inherits the source layer's color and is appended
//     to the end of the target's order.
//   - Every markup on the source layer is cloned onto the target doc
//     with `sourceMarkupId = NULL` so a future "Copy" call from the
//     same source produces *another* copy (the action is explicitly
//     non-idempotent, unlike carryover-annotations which is keyed on
//     source_markup_id for revision rollovers).
//   - Group ids are remapped per-call so grouped markups stay grouped
//     on the destination without colliding with existing groups.
//   - Cross-project copies are denied — copying annotations between
//     unrelated projects is never desirable and would silently leak
//     drawing context across a customer's portfolio.
// ============================================================================
const copyLayerBody = z.object({
  targetDocumentId: z.string().min(1),
});

router.post(
  "/api/plan-markup-layers/:layerId/copy-to-document",
  requireAuth,
  requireRole(...MARKUP_AUTHOR_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    try {
      const body = copyLayerBody.parse(req.body || {});
      const user = req.user!;

      // Load source layer + assert org access.
      const [sourceLayer] = await db
        .select()
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.id, req.params.layerId))
        .limit(1);
      if (!sourceLayer) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }
      if (
        user.role !== "SUPER_ADMIN" &&
        sourceLayer.organizationId !== user.organizationId
      ) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Load source + target plan documents using the shared helper so
      // org filtering matches every other endpoint in this router.
      const sourceAccess = await loadDocAndAssertOrg(sourceLayer.planDocumentId, req);
      if (!sourceAccess.ok) {
        res.status(sourceAccess.status).json({ error: sourceAccess.error });
        return;
      }
      const targetAccess = await loadDocAndAssertOrg(body.targetDocumentId, req);
      if (!targetAccess.ok) {
        res.status(targetAccess.status).json({ error: targetAccess.error });
        return;
      }

      if (sourceAccess.doc.id === targetAccess.doc.id) {
        res
          .status(400)
          .json({ error: "Source and destination sheets must be different" });
        return;
      }

      // Cross-project copies are denied — see comment block above.
      if (
        sourceAccess.doc.projectId &&
        targetAccess.doc.projectId &&
        sourceAccess.doc.projectId !== targetAccess.doc.projectId
      ) {
        res
          .status(400)
          .json({ error: "Source and destination must belong to the same project" });
        return;
      }

      const { newLayer, markupsCopied } = await db.transaction(async (tx) => {
        // Pick a unique target name. Start with "<name> (copy)" and bump
        // a counter on collision so a second click on the same source
        // produces "(copy 2)", etc. Bounded to 50 attempts so a
        // pathological state can never wedge the request.
        const baseName = sourceLayer.name;
        const existingNames = new Set(
          (
            await tx
              .select({ name: planMarkupLayers.name })
              .from(planMarkupLayers)
              .where(eq(planMarkupLayers.planDocumentId, targetAccess.doc.id))
          ).map((r) => r.name),
        );
        const buildCandidate = (i: number) =>
          i === 1 ? `${baseName} (copy)` : `${baseName} (copy ${i})`;
        let candidate = buildCandidate(1);
        for (let i = 1; i <= 50 && existingNames.has(candidate); i++) {
          candidate = buildCandidate(i + 1);
        }

        // Append to the end of the target's layer order.
        const [{ maxSort } = { maxSort: 0 }] = await tx
          .select({
            maxSort: sql<number>`COALESCE(MAX(${planMarkupLayers.sortOrder}), 0)::int`,
          })
          .from(planMarkupLayers)
          .where(eq(planMarkupLayers.planDocumentId, targetAccess.doc.id));

        const [created] = await tx
          .insert(planMarkupLayers)
          .values({
            organizationId: targetAccess.doc.organizationId!,
            planDocumentId: targetAccess.doc.id,
            name: candidate,
            color: sourceLayer.color,
            sortOrder: (Number(maxSort) || 0) + 1000,
            isDefault: false,
            createdById: user.id,
          })
          .returning();

        // Copy every markup currently on the source layer. We pull
        // *all* rows (not just primaries) because a layer may have
        // been built up over several revisions; the user expects the
        // visible state of the layer to be replicated verbatim.
        // Task #1775 — copy-to-sheet must never duplicate soft-deleted
        // rows onto the destination layer. The user expects the
        // visible state of the source layer.
        const sourceMarkups = await tx
          .select()
          .from(planDocumentMarkups)
          .where(
            and(
              eq(planDocumentMarkups.planDocumentId, sourceAccess.doc.id),
              eq(planDocumentMarkups.layerId, sourceLayer.id),
              isNull(planDocumentMarkups.deletedAt),
            ),
          );

        if (sourceMarkups.length === 0) {
          return { newLayer: created, markupsCopied: 0 };
        }

        // Remap group ids per-call so the cloned markups stay grouped
        // together on the destination but never collide with an
        // existing group there.
        const groupMap = new Map<string, string>();
        for (const m of sourceMarkups) {
          if (m.groupId && !groupMap.has(m.groupId)) {
            groupMap.set(m.groupId, crypto.randomUUID());
          }
        }

        const inserted = await tx
          .insert(planDocumentMarkups)
          .values(
            sourceMarkups.map((m) => ({
              organizationId: targetAccess.doc.organizationId!,
              projectId: targetAccess.doc.projectId,
              planDocumentId: targetAccess.doc.id,
              pageNumber: m.pageNumber,
              tool: m.tool,
              points: m.points,
              color: m.color,
              thickness: m.thickness,
              text: m.text,
              createdBy: user.id,
              // Explicitly NULL — a "Copy to sheet" action is
              // intentionally non-idempotent: clicking it twice yields
              // two independent destination layers ("(copy)",
              // "(copy 2)"). Setting sourceMarkupId to the original
              // would trip the (planDocumentId, sourceMarkupId) unique
              // index on the second copy.
              sourceMarkupId: null,
              layerId: created.id,
              groupId: m.groupId ? groupMap.get(m.groupId) ?? null : null,
            })),
          )
          .returning({ id: planDocumentMarkups.id });

        return { newLayer: created, markupsCopied: inserted.length };
      });

      await logAudit(
        {
          userId: user.id,
          action: "CREATE",
          entityType: "planMarkupLayer",
          entityId: newLayer.id,
          newValue: JSON.stringify({
            sourceLayerId: sourceLayer.id,
            sourceDocumentId: sourceAccess.doc.id,
            targetDocumentId: targetAccess.doc.id,
            markupsCopied,
          }),
        },
        req,
      );

      recordJobMetrics("plan_document_layer_copy", {
        ok: 1,
        markupsCopied,
        ms: Date.now() - startedAt,
      });

      res.status(201).json({
        ok: true,
        layer: { ...newLayer, isVisible: true, markupCount: markupsCopied },
        markupsCopied,
      });
    } catch (err: any) {
      recordJobMetrics("plan_document_layer_copy", {
        error: 1,
        ms: Date.now() - startedAt,
      });
      if (err?.name === "ZodError") {
        res.status(400).json({ error: "Invalid copy request", details: err.errors });
        return;
      }
      next(err);
    }
  },
);

// ============================================================================
// Task #1722 — LIST sibling sheets that already contain a copy of a given
// source layer. Backs the "Copy to sheet" picker so users can see at a
// glance which destinations would produce a duplicate "(copy)" /
// "(copy 2)" / … layer if clicked again.
//
// The copy action is intentionally non-idempotent (each click creates a
// fresh layer with a bumped suffix), so the picker has historically
// given no hint that the user has already copied this layer somewhere.
// This endpoint returns, per sibling document in the same project, how
// many copies of the named source layer already exist there and when
// the most recent one was created.
//
// Returned shape:
//   { targets: [{ documentId, existingCopyCount, lastCopiedAt }] }
//
// Documents with zero matching copies are omitted from the array; the
// client treats absence as zero.
// ============================================================================
router.get(
  "/api/plan-markup-layers/:layerId/copy-targets",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const [sourceLayer] = await db
        .select()
        .from(planMarkupLayers)
        .where(eq(planMarkupLayers.id, req.params.layerId))
        .limit(1);
      if (!sourceLayer) {
        res.status(404).json({ error: "Layer not found" });
        return;
      }

      const sourceAccess = await loadDocAndAssertOrg(
        sourceLayer.planDocumentId,
        req,
      );
      if (!sourceAccess.ok) {
        res.status(sourceAccess.status).json({ error: sourceAccess.error });
        return;
      }

      // No project = no siblings to scan (also matches the same-project
      // guard enforced by the copy-to-document endpoint).
      if (!sourceAccess.doc.projectId) {
        res.json({ targets: [] });
        return;
      }

      // Sibling docs: same project + same org, excluding the source doc.
      const siblings = await db
        .select({ id: planDocuments.id })
        .from(planDocuments)
        .where(
          and(
            eq(planDocuments.projectId, sourceAccess.doc.projectId),
            eq(
              planDocuments.organizationId,
              sourceAccess.doc.organizationId!,
            ),
          ),
        );
      const siblingIds = siblings
        .map((s) => s.id)
        .filter((id) => id !== sourceAccess.doc.id);
      if (siblingIds.length === 0) {
        res.json({ targets: [] });
        return;
      }

      // Pull every layer on a sibling doc whose name *starts with* the
      // copy prefix. We then filter precisely in JS so we only count
      // names matching exactly "<source> (copy)" or "<source> (copy N)"
      // — never partial matches like "<source> (copy on tuesday)".
      const escapedPrefix = `${sourceLayer.name} (copy`
        .replace(/\\/g, "\\\\")
        .replace(/%/g, "\\%")
        .replace(/_/g, "\\_");
      const likePattern = `${escapedPrefix}%`;

      const matches = await db
        .select({
          planDocumentId: planMarkupLayers.planDocumentId,
          name: planMarkupLayers.name,
          createdAt: planMarkupLayers.createdAt,
        })
        .from(planMarkupLayers)
        .where(
          and(
            inArray(planMarkupLayers.planDocumentId, siblingIds),
            sql`${planMarkupLayers.name} LIKE ${likePattern} ESCAPE '\\'`,
          ),
        );

      // RegExp anchored to the exact "(copy)" / "(copy N)" suffix, with
      // the source name escaped so special characters are literal.
      const escapedName = sourceLayer.name.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const copyRe = new RegExp(`^${escapedName} \\(copy(?: \\d+)?\\)$`);

      const grouped = new Map<
        string,
        { count: number; lastCopiedAt: Date }
      >();
      for (const m of matches) {
        if (!copyRe.test(m.name)) continue;
        const createdAt = m.createdAt ?? new Date(0);
        const existing = grouped.get(m.planDocumentId);
        if (!existing) {
          grouped.set(m.planDocumentId, {
            count: 1,
            lastCopiedAt: createdAt,
          });
        } else {
          existing.count += 1;
          if (createdAt > existing.lastCopiedAt) {
            existing.lastCopiedAt = createdAt;
          }
        }
      }

      const targets = Array.from(grouped.entries()).map(
        ([documentId, v]) => ({
          documentId,
          existingCopyCount: v.count,
          lastCopiedAt: v.lastCopiedAt.toISOString(),
        }),
      );

      res.json({ targets });
    } catch (err) {
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

      // Task #1677 — accept an optional `layerIds` query param so the
      // recipient can scope the export to a subset of named layers
      // (e.g. just "QA/QC"). When provided, the explicit set wins and
      // overrides per-user visibility. When *absent*, the print page
      // falls back to honouring the requesting user's per-layer
      // visibility toggles (i.e. "all layers currently visible to me"),
      // matching what they see in the in-app viewer. We accept either
      // repeated `?layerIds=a&layerIds=b` or a single `?layerIds=a,b,c`
      // form so the URL stays human-friendly.
      const layerIds: string[] = (() => {
        const raw = req.query.layerIds;
        const collected: string[] = [];
        const push = (v: unknown) => {
          if (typeof v !== "string") return;
          for (const part of v.split(",")) {
            const trimmed = part.trim();
            // Loose validation — IDs are uuids or the "__default__"
            // sentinel for legacy null-layer markups. Reject anything
            // with characters that could break the print URL.
            if (trimmed && /^[A-Za-z0-9_-]{1,64}$/.test(trimmed)) {
              collected.push(trimmed);
            }
          }
        };
        if (Array.isArray(raw)) raw.forEach(push);
        else if (raw !== undefined) push(raw);
        // Dedupe while preserving order.
        return Array.from(new Set(collected));
      })();

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
        layerIds,
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
