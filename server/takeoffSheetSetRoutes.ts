import { Router } from "express";
import { db } from "./db";
import {
  takeoffSheetSets,
  takeoffSheetSetMembers,
  takeoffSheets,
  insertTakeoffSheetSetSchema,
  type TakeoffSheetSet,
} from "@shared/schema";
import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit, logCreate, logUpdate, logDelete } from "./auditLogger";
import { verifySheetAccess } from "./takeoffHelpers";

const router = Router();

function getOrgContext(req: AuthRequest): { orgId: string; userId: string } | null {
  const orgId = req.user?.organizationId;
  const userId = req.user?.id;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

const createBodySchema = insertTakeoffSheetSetSchema
  .omit({ organizationId: true, createdBy: true })
  .extend({
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional().nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    defaultScalePxPerFoot: z.number().positive().optional().nullable(),
    defaultScaleLabel: z.string().max(64).optional().nullable(),
  });

const updateBodySchema = createBodySchema.partial();

const memberBodySchema = z.object({
  sheetIds: z.array(z.string().min(1)).min(1).max(500),
});

const reorderBodySchema = z.object({
  members: z
    .array(z.object({ sheetId: z.string().min(1), sortOrder: z.number().int() }))
    .min(1),
});

// Task #2229 — Atomic "move a member from one Sheet Set to another".
// The UI used to require Remove → Add (two clicks); a single drag now
// posts here and we delete + insert inside one transaction so the
// member never disappears in a half-state if either side fails.
const moveMemberBodySchema = z.object({
  sheetId: z.string().min(1),
  fromSetId: z.string().min(1),
});

// Task #2320 — apply-scale is the canonical "BULK_PROPAGATED" path.
// Callers may pass through an explicit confidence (the parent sheet's
// confidence, typically) but we never accept a source from the client
// for this endpoint — it is, by definition, bulk-propagated.
const applyScaleBodySchema = z.object({
  scalePxPerFoot: z.number().positive(),
  scaleLabel: z.string().max(64).optional().nullable(),
  saveAsDefault: z.boolean().optional(),
  scaleConfidence: z.enum(["HIGH", "MEDIUM", "LOW", "UNVERIFIED"]).optional(),
});

// Task #2141 — Undo affordance for "Apply to entire Sheet Set". The
// apply-scale endpoint now returns each member sheet's prior
// scalePxPerFoot / scaleLabel; the client snapshots that array and,
// on Undo, posts it back here so we can restore the per-sheet values
// in a single batch. Bodies that reference a sheet outside the org
// are filtered out by the verifySheetAccess pass below.
const restoreScalesBodySchema = z.object({
  sheets: z
    .array(
      z.object({
        sheetId: z.string().min(1),
        scalePxPerFoot: z.number().positive().nullable(),
        scaleLabel: z.string().max(64).nullable(),
      }),
    )
    .min(1)
    .max(500),
});

router.get("/api/takeoff/sheet-sets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgContext(req);
    if (!ctx) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    const bidId = typeof req.query.bidId === "string" ? req.query.bidId : null;

    const filters = [eq(takeoffSheetSets.organizationId, ctx.orgId)];
    if (projectId) filters.push(eq(takeoffSheetSets.projectId, projectId));
    if (bidId) filters.push(eq(takeoffSheetSets.bidId, bidId));

    const sets: TakeoffSheetSet[] = await db
      .select()
      .from(takeoffSheetSets)
      .where(and(...filters))
      .orderBy(asc(takeoffSheetSets.sortOrder), asc(takeoffSheetSets.createdAt));
    res.json(sets);
  } catch (error) {
    next(error);
  }
});

router.get("/api/takeoff/sheet-sets/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgContext(req);
    if (!ctx) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { id } = req.params;
    const [set] = await db
      .select()
      .from(takeoffSheetSets)
      .where(
        and(
          eq(takeoffSheetSets.id, id),
          eq(takeoffSheetSets.organizationId, ctx.orgId),
        ),
      )
      .limit(1);
    if (!set) {
      res.status(404).json({ error: "Sheet set not found" });
      return;
    }
    const members = await db
      .select()
      .from(takeoffSheetSetMembers)
      .where(eq(takeoffSheetSetMembers.setId, id))
      .orderBy(asc(takeoffSheetSetMembers.sortOrder));
    res.json({ ...set, members });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/api/takeoff/sheet-sets",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [created] = await db
        .insert(takeoffSheetSets)
        .values({
          ...parsed.data,
          organizationId: ctx.orgId,
          createdBy: ctx.userId,
        })
        .returning();
      await logCreate(ctx.userId, "takeoff_sheet_sets", created.id, created, req);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  "/api/takeoff/sheet-sets/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const parsed = updateBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [existing] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      const [updated] = await db
        .update(takeoffSheetSets)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(takeoffSheetSets.id, id))
        .returning();
      await logUpdate(ctx.userId, "takeoff_sheet_sets", id, existing, updated, req);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/api/takeoff/sheet-sets/:id",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const [existing] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      await db.delete(takeoffSheetSets).where(eq(takeoffSheetSets.id, id));
      await logDelete(ctx.userId, "takeoff_sheet_sets", id, existing, req);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/takeoff/sheet-sets/:id/members",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const parsed = memberBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [set] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!set) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }

      // Verify access to every sheet first; refuse the whole batch on the
      // first failure so the request is atomic from the caller's view.
      for (const sheetId of parsed.data.sheetIds) {
        const access = await verifySheetAccess(sheetId, req.user!);
        if (!access.allowed) {
          res.status(403).json({ error: `No access to sheet ${sheetId}` });
          return;
        }
      }

      // Determine the next sortOrder so newly added members append cleanly.
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number>`COALESCE(MAX(${takeoffSheetSetMembers.sortOrder}), -1)` })
        .from(takeoffSheetSetMembers)
        .where(eq(takeoffSheetSetMembers.setId, id));
      let nextOrder = (maxOrder ?? -1) + 1;

      const inserted: Array<{ sheetId: string; sortOrder: number }> = [];
      for (const sheetId of parsed.data.sheetIds) {
        try {
          await db
            .insert(takeoffSheetSetMembers)
            .values({ setId: id, sheetId, sortOrder: nextOrder });
          inserted.push({ sheetId, sortOrder: nextOrder });
          nextOrder += 1;
        } catch (err: any) {
          if (err?.code === "23505") {
            // Already a member — skip.
            continue;
          }
          throw err;
        }
      }
      res.status(201).json({ added: inserted });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/api/takeoff/sheet-sets/:id/members/:sheetId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id, sheetId } = req.params;
      const [set] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!set) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      const result = await db
        .delete(takeoffSheetSetMembers)
        .where(
          and(
            eq(takeoffSheetSetMembers.setId, id),
            eq(takeoffSheetSetMembers.sheetId, sheetId),
          ),
        );
      // drizzle .delete returns no .rowCount on Neon HTTP — best-effort.
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/takeoff/sheet-sets/:id/reorder",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const parsed = reorderBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [set] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!set) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      let updated = 0;
      await db.transaction(async (tx) => {
        for (const member of parsed.data.members) {
          await tx
            .update(takeoffSheetSetMembers)
            .set({ sortOrder: member.sortOrder })
            .where(
              and(
                eq(takeoffSheetSetMembers.setId, id),
                eq(takeoffSheetSetMembers.sheetId, member.sheetId),
              ),
            );
          updated += 1;
        }
      });
      res.json({ updated });
    } catch (error) {
      next(error);
    }
  },
);

// Task #2229 — Drag a member from one set to another in a single
// transactional hop. `:id` is the destination set; `fromSetId` in the
// body is the source. Both sets are org-scoped and the sheet itself
// must be reachable (verifySheetAccess) — the same gates the
// add-members and remove-member endpoints already use. If the sheet
// is somehow already a member of the destination (rare; can happen
// when a sheet sits in two sets), the insert is a no-op and we still
// remove it from the source so the user-visible "move" intent holds.
router.post(
  "/api/takeoff/sheet-sets/:id/move-member",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id: toSetId } = req.params;
      const parsed = moveMemberBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const { sheetId, fromSetId } = parsed.data;
      if (fromSetId === toSetId) {
        res.status(400).json({ error: "Source and destination sets must differ" });
        return;
      }
      const setRows = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            inArray(takeoffSheetSets.id, [toSetId, fromSetId]),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        );
      const fromSet = setRows.find((s) => s.id === fromSetId);
      const toSet = setRows.find((s) => s.id === toSetId);
      if (!fromSet || !toSet) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      const access = await verifySheetAccess(sheetId, req.user!);
      if (!access.allowed) {
        res.status(403).json({ error: `No access to sheet ${sheetId}` });
        return;
      }

      let movedSortOrder = -1;
      let alreadyMember = false;
      await db.transaction(async (tx) => {
        // Append at the end of the destination so the move feels like
        // "drop here last" rather than reshuffling existing members.
        const [{ maxOrder }] = await tx
          .select({
            maxOrder: sql<number>`COALESCE(MAX(${takeoffSheetSetMembers.sortOrder}), -1)`,
          })
          .from(takeoffSheetSetMembers)
          .where(eq(takeoffSheetSetMembers.setId, toSetId));
        const nextOrder = (maxOrder ?? -1) + 1;
        // ON CONFLICT DO NOTHING — a try/catch would abort the whole
        // postgres transaction on a 23505, blocking the source-side
        // delete that has to run after this insert.
        const inserted = await tx
          .insert(takeoffSheetSetMembers)
          .values({ setId: toSetId, sheetId, sortOrder: nextOrder })
          .onConflictDoNothing({
            target: [
              takeoffSheetSetMembers.setId,
              takeoffSheetSetMembers.sheetId,
            ],
          })
          .returning({ id: takeoffSheetSetMembers.id });
        if (inserted.length === 0) {
          alreadyMember = true;
        } else {
          movedSortOrder = nextOrder;
        }
        await tx
          .delete(takeoffSheetSetMembers)
          .where(
            and(
              eq(takeoffSheetSetMembers.setId, fromSetId),
              eq(takeoffSheetSetMembers.sheetId, sheetId),
            ),
          );
      });

      await logUpdate(
        ctx.userId,
        "takeoff_sheet_sets",
        toSetId,
        { event: "move-member-before", fromSetId, sheetId },
        {
          event: "move-member-after",
          fromSetId,
          toSetId,
          sheetId,
          alreadyMember,
          sortOrder: movedSortOrder,
        },
        req,
      );

      res.json({ moved: true, fromSetId, toSetId, sheetId, alreadyMember });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/api/takeoff/sheet-sets/:id/apply-scale",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const parsed = applyScaleBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [set] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!set) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      const members = await db
        .select({ sheetId: takeoffSheetSetMembers.sheetId })
        .from(takeoffSheetSetMembers)
        .where(eq(takeoffSheetSetMembers.setId, id));
      if (members.length === 0) {
        res.json({ updatedSheets: 0, savedAsDefault: false });
        return;
      }
      const sheetIds = members.map((m) => m.sheetId);
      // Task #2141 — Snapshot each member's existing scale BEFORE the
      // bulk UPDATE runs so the client can hold the prior values for
      // an Undo round-trip via /restore-scales. Without this snapshot
      // an apply-scale across N sheets is irreversible from the UI.
      const priorScales = await db
        .select({
          id: takeoffSheets.id,
          scalePxPerFoot: takeoffSheets.scalePxPerFoot,
          scaleLabel: takeoffSheets.scaleLabel,
          units: takeoffSheets.units,
          scaleSource: takeoffSheets.scaleSource,
          scaleConfidence: takeoffSheets.scaleConfidence,
          scaleCalibratedById: takeoffSheets.scaleCalibratedById,
          scaleCalibratedAt: takeoffSheets.scaleCalibratedAt,
        })
        .from(takeoffSheets)
        .where(inArray(takeoffSheets.id, sheetIds));
      // Task #2320 — every sheet touched by apply-scale gets the
      // BULK_PROPAGATED source so the bottom-bar chip and the audit
      // trail can distinguish "calibrated by hand on this sheet" from
      // "scale arrived here via Apply to Sheet Set". The confidence
      // tracks the parent sheet (default UNVERIFIED if the caller
      // doesn't tell us otherwise).
      const propagatedConfidence: string = parsed.data.scaleConfidence ?? "UNVERIFIED";
      const updates: Partial<typeof takeoffSheets.$inferInsert> = {
        scalePxPerFoot: parsed.data.scalePxPerFoot,
        scaleSource: "BULK_PROPAGATED",
        scaleConfidence: propagatedConfidence,
        scaleCalibratedById: ctx.userId,
        scaleCalibratedAt: new Date(),
        updatedAt: new Date(),
      };
      if (parsed.data.scaleLabel !== undefined) {
        updates.scaleLabel = parsed.data.scaleLabel;
      }
      const updated = await db
        .update(takeoffSheets)
        .set(updates)
        .where(inArray(takeoffSheets.id, sheetIds))
        .returning({ id: takeoffSheets.id });

      // Task #2325 — write a per-sheet audit row for every member so the
      // Scale History panel for each sheet shows the BULK_PROPAGATED entry
      // (the existing logUpdate below records the set-level event only).
      const newScaleCalibratedAtIso = (updates.scaleCalibratedAt as Date).toISOString();
      const priorByIdForAudit = new Map(priorScales.map((s) => [s.id, s] as const));
      for (const memberId of updated.map((u) => u.id)) {
        const prior = priorByIdForAudit.get(memberId);
        await logAudit({
          userId: ctx.userId,
          entityType: "takeoff_sheet",
          entityId: memberId,
          action: "UPDATE",
          oldValue: JSON.stringify({
            kind: "scale_calibration",
            scalePxPerFoot: prior?.scalePxPerFoot ?? null,
            scaleLabel: prior?.scaleLabel ?? null,
            units: prior?.units ?? null,
            scaleSource: prior?.scaleSource ?? null,
            scaleConfidence: prior?.scaleConfidence ?? null,
            scaleCalibratedById: prior?.scaleCalibratedById ?? null,
            scaleCalibratedAt: prior?.scaleCalibratedAt
              ? new Date(prior.scaleCalibratedAt as Date | string).toISOString()
              : null,
          }),
          newValue: JSON.stringify({
            kind: "scale_calibration",
            scalePxPerFoot: parsed.data.scalePxPerFoot,
            scaleLabel:
              parsed.data.scaleLabel !== undefined
                ? parsed.data.scaleLabel
                : (prior?.scaleLabel ?? null),
            units: prior?.units ?? null,
            scaleSource: "BULK_PROPAGATED",
            scaleConfidence: propagatedConfidence,
            scaleCalibratedById: ctx.userId,
            scaleCalibratedAt: newScaleCalibratedAtIso,
            source: "sheet_set_apply",
            sheetSetId: id,
          }),
        }, req);
      }

      let savedAsDefault = false;
      if (parsed.data.saveAsDefault) {
        await db
          .update(takeoffSheetSets)
          .set({
            defaultScalePxPerFoot: parsed.data.scalePxPerFoot,
            defaultScaleLabel: parsed.data.scaleLabel ?? null,
            updatedAt: new Date(),
          })
          .where(eq(takeoffSheetSets.id, id));
        savedAsDefault = true;
      }

      await logUpdate(
        ctx.userId,
        "takeoff_sheet_sets",
        id,
        { event: "apply-scale-before", sheetIds },
        {
          event: "apply-scale-after",
          scalePxPerFoot: parsed.data.scalePxPerFoot,
          updatedSheets: updated.length,
          savedAsDefault,
        },
        req,
      );

      res.json({
        updatedSheets: updated.length,
        savedAsDefault,
        // Task #2141 — Per-sheet scale snapshot for client-side Undo.
        // Returned in member order so the toast can echo "5 sheets
        // updated" without an extra round-trip.
        priorScales: priorScales.map((s) => ({
          sheetId: s.id,
          scalePxPerFoot: s.scalePxPerFoot ?? null,
          scaleLabel: s.scaleLabel ?? null,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

// Task #2141 — Restore per-sheet scales captured by the apply-scale
// snapshot. Used by the "Undo" toast affordance after an
// "Apply to entire Sheet Set" calibration. Each item is updated
// individually so per-sheet prior values are preserved (the bulk
// UPDATE pattern in apply-scale collapses everything to one value
// and isn't reusable here).
router.post(
  "/api/takeoff/sheet-sets/:id/restore-scales",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const ctx = getOrgContext(req);
      if (!ctx) {
        res.status(403).json({ error: "Organization required" });
        return;
      }
      const { id } = req.params;
      const parsed = restoreScalesBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
        return;
      }
      const [set] = await db
        .select()
        .from(takeoffSheetSets)
        .where(
          and(
            eq(takeoffSheetSets.id, id),
            eq(takeoffSheetSets.organizationId, ctx.orgId),
          ),
        )
        .limit(1);
      if (!set) {
        res.status(404).json({ error: "Sheet set not found" });
        return;
      }
      // Refuse the whole batch if any sheet escapes the caller's
      // org; mirrors the pattern used by the members endpoint.
      for (const item of parsed.data.sheets) {
        const access = await verifySheetAccess(item.sheetId, req.user!);
        if (!access.allowed) {
          res.status(403).json({ error: `No access to sheet ${item.sheetId}` });
          return;
        }
      }
      let restored = 0;
      await db.transaction(async (tx) => {
        for (const item of parsed.data.sheets) {
          // Task #2325 — capture the BULK_PROPAGATED state we're about to
          // overwrite so the Scale History panel renders the Undo as its own
          // entry instead of silently rolling back to the prior value.
          const [beforeRestore] = await tx
            .select({
              scalePxPerFoot: takeoffSheets.scalePxPerFoot,
              scaleLabel: takeoffSheets.scaleLabel,
              units: takeoffSheets.units,
              scaleSource: takeoffSheets.scaleSource,
              scaleConfidence: takeoffSheets.scaleConfidence,
              scaleCalibratedById: takeoffSheets.scaleCalibratedById,
              scaleCalibratedAt: takeoffSheets.scaleCalibratedAt,
            })
            .from(takeoffSheets)
            .where(eq(takeoffSheets.id, item.sheetId))
            .limit(1);
          const [afterRestore] = await tx
            .update(takeoffSheets)
            .set({
              scalePxPerFoot: item.scalePxPerFoot,
              scaleLabel: item.scaleLabel,
              updatedAt: new Date(),
            })
            .where(eq(takeoffSheets.id, item.sheetId))
            .returning();
          if (afterRestore) {
            await logAudit({
              userId: ctx.userId,
              entityType: "takeoff_sheet",
              entityId: item.sheetId,
              action: "UPDATE",
              oldValue: JSON.stringify({
                kind: "scale_calibration",
                scalePxPerFoot: beforeRestore?.scalePxPerFoot ?? null,
                scaleLabel: beforeRestore?.scaleLabel ?? null,
                units: beforeRestore?.units ?? null,
                scaleSource: beforeRestore?.scaleSource ?? null,
                scaleConfidence: beforeRestore?.scaleConfidence ?? null,
                scaleCalibratedById: beforeRestore?.scaleCalibratedById ?? null,
                scaleCalibratedAt: beforeRestore?.scaleCalibratedAt
                  ? new Date(beforeRestore.scaleCalibratedAt as Date | string).toISOString()
                  : null,
              }),
              newValue: JSON.stringify({
                kind: "scale_calibration",
                scalePxPerFoot: afterRestore.scalePxPerFoot,
                scaleLabel: afterRestore.scaleLabel,
                units: afterRestore.units,
                scaleSource: afterRestore.scaleSource,
                scaleConfidence: afterRestore.scaleConfidence,
                scaleCalibratedById: afterRestore.scaleCalibratedById,
                scaleCalibratedAt: afterRestore.scaleCalibratedAt
                  ? new Date(afterRestore.scaleCalibratedAt as Date | string).toISOString()
                  : null,
                source: "sheet_set_restore",
                sheetSetId: id,
              }),
            }, req, tx);
          }
          restored += 1;
        }
      });
      await logUpdate(
        ctx.userId,
        "takeoff_sheet_sets",
        id,
        { event: "restore-scales-before" },
        { event: "restore-scales-after", restored },
        req,
      );
      res.json({ restored });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
