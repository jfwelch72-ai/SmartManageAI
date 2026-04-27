import { Router } from "express";
import { db } from "./db";
import {
  takeoffToolChestItems,
  insertTakeoffToolChestItemSchema,
  type TakeoffToolChestItem,
} from "@shared/schema";
import { and, eq, or, asc } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate, logDelete } from "./auditLogger";

const router = Router();

const ITEM_KINDS = ["tool", "condition", "assembly"] as const;

function getOrgContext(req: AuthRequest): { orgId: string; userId: string } | null {
  const orgId = req.user?.organizationId;
  const userId = req.user?.id;
  if (!orgId || !userId) return null;
  return { orgId, userId };
}

const createBodySchema = insertTakeoffToolChestItemSchema
  .omit({ organizationId: true, userId: true })
  .extend({
    itemKind: z.enum(ITEM_KINDS),
    itemId: z.string().min(1).max(128),
    label: z.string().max(120).optional().nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .nullable(),
    shortcut: z.string().max(32).optional().nullable(),
  });

const updateBodySchema = createBodySchema.partial();

const reorderBodySchema = z.object({
  items: z
    .array(z.object({ id: z.string().min(1), sortOrder: z.number().int() }))
    .min(1),
});

router.get("/api/takeoff/tool-chest", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgContext(req);
    if (!ctx) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const items: TakeoffToolChestItem[] = await db
      .select()
      .from(takeoffToolChestItems)
      .where(
        and(
          eq(takeoffToolChestItems.organizationId, ctx.orgId),
          or(
            eq(takeoffToolChestItems.userId, ctx.userId),
            eq(takeoffToolChestItems.isShared, true),
          ),
        ),
      )
      .orderBy(asc(takeoffToolChestItems.sortOrder), asc(takeoffToolChestItems.createdAt));
    res.json(items);
  } catch (error) {
    next(error);
  }
});

router.post("/api/takeoff/tool-chest", requireAuth, async (req: AuthRequest, res, next) => {
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

    try {
      const [created] = await db
        .insert(takeoffToolChestItems)
        .values({
          ...parsed.data,
          organizationId: ctx.orgId,
          userId: ctx.userId,
        })
        .returning();
      await logCreate(ctx.userId, "takeoff_tool_chest_items", created.id, created, req);
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") {
        res.status(409).json({ error: "Already pinned" });
        return;
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

router.patch("/api/takeoff/tool-chest/:id", requireAuth, async (req: AuthRequest, res, next) => {
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
      .from(takeoffToolChestItems)
      .where(
        and(
          eq(takeoffToolChestItems.id, id),
          eq(takeoffToolChestItems.organizationId, ctx.orgId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Tool chest item not found" });
      return;
    }
    if (existing.userId !== ctx.userId) {
      res.status(403).json({ error: "You can only edit your own tool chest items" });
      return;
    }

    const [updated] = await db
      .update(takeoffToolChestItems)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(takeoffToolChestItems.id, id))
      .returning();

    await logUpdate(ctx.userId, "takeoff_tool_chest_items", id, existing, updated, req);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/takeoff/tool-chest/reorder", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgContext(req);
    if (!ctx) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const parsed = reorderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    const ids = parsed.data.items.map((i) => i.id);
    if (ids.length === 0) {
      res.json({ updated: 0 });
      return;
    }

    const rows = await db
      .select()
      .from(takeoffToolChestItems)
      .where(
        and(
          eq(takeoffToolChestItems.organizationId, ctx.orgId),
          eq(takeoffToolChestItems.userId, ctx.userId),
        ),
      );
    const ownedIds = new Set(rows.map((r) => r.id));

    let updatedCount = 0;
    await db.transaction(async (tx) => {
      for (const item of parsed.data.items) {
        if (!ownedIds.has(item.id)) continue;
        await tx
          .update(takeoffToolChestItems)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(eq(takeoffToolChestItems.id, item.id));
        updatedCount += 1;
      }
    });

    res.json({ updated: updatedCount });
  } catch (error) {
    next(error);
  }
});

router.delete("/api/takeoff/tool-chest/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const ctx = getOrgContext(req);
    if (!ctx) {
      res.status(403).json({ error: "Organization required" });
      return;
    }
    const { id } = req.params;
    const [existing] = await db
      .select()
      .from(takeoffToolChestItems)
      .where(
        and(
          eq(takeoffToolChestItems.id, id),
          eq(takeoffToolChestItems.organizationId, ctx.orgId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Tool chest item not found" });
      return;
    }
    if (existing.userId !== ctx.userId) {
      res.status(403).json({ error: "You can only delete your own tool chest items" });
      return;
    }

    await db.delete(takeoffToolChestItems).where(eq(takeoffToolChestItems.id, id));
    await logDelete(ctx.userId, "takeoff_tool_chest_items", id, existing, req);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
