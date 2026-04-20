import { Router } from "express";
import { db } from "./db";
import { userSavedViews, insertUserSavedViewSchema } from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { z } from "zod";

const router = Router();

const VALID_VIEWS = ["table", "kanban", "calendar", "map"] as const;

router.get("/api/saved-views", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const viewKey = String(req.query.viewKey || "");
    if (!viewKey) {
      return res.status(400).json({ error: "viewKey query param required" });
    }
    const rows = await db
      .select()
      .from(userSavedViews)
      .where(and(
        eq(userSavedViews.userId, userId),
        eq(userSavedViews.organizationId, orgId),
        eq(userSavedViews.viewKey, viewKey),
      ))
      .orderBy(desc(userSavedViews.createdAt));
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/api/saved-views", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const schema = z.object({
      viewKey: z.string().min(1).max(64),
      name: z.string().min(1).max(120),
      view: z.enum(VALID_VIEWS),
      filters: z.record(z.any()).optional(),
    });
    const parsed = schema.parse(req.body);
    const [created] = await db
      .insert(userSavedViews)
      .values({
        userId,
        organizationId: orgId,
        viewKey: parsed.viewKey,
        name: parsed.name,
        view: parsed.view,
        filtersJson: JSON.stringify(parsed.filters || {}),
      })
      .returning();
    return res.status(201).json(created);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid saved view", details: err.errors });
    }
    return next(err);
  }
});

router.delete("/api/saved-views/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const { id } = req.params;
    const [existing] = await db
      .select()
      .from(userSavedViews)
      .where(and(
        eq(userSavedViews.id, id),
        eq(userSavedViews.userId, userId),
        eq(userSavedViews.organizationId, orgId),
      ))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Saved view not found" });
    }
    await db.delete(userSavedViews).where(and(
      eq(userSavedViews.id, id),
      eq(userSavedViews.userId, userId),
      eq(userSavedViews.organizationId, orgId),
    ));
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
