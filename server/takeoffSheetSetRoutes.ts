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
import { logCreate, logUpdate, logDelete } from "./auditLogger";
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

const applyScaleBodySchema = z.object({
  scalePxPerFoot: z.number().positive(),
  scaleLabel: z.string().max(64).optional().nullable(),
  saveAsDefault: z.boolean().optional(),
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
      const updates: Partial<typeof takeoffSheets.$inferInsert> = {
        scalePxPerFoot: parsed.data.scalePxPerFoot,
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

      res.json({ updatedSheets: updated.length, savedAsDefault });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
