import { Router } from "express";
import { db } from "./db";
import { userSavedViews, users } from "@shared/schema";
import { and, eq, or } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { z } from "zod";
import { parseOrRespond } from "./utils/validation";

const router = Router();

const VALID_VIEWS = ["table", "kanban", "calendar", "map"] as const;

function isAdmin(role: string | undefined): boolean {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

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
      .select({
        view: userSavedViews,
        creatorFirstName: users.firstName,
        creatorLastName: users.lastName,
      })
      .from(userSavedViews)
      .leftJoin(users, eq(users.id, userSavedViews.userId))
      .where(and(
        eq(userSavedViews.organizationId, orgId),
        eq(userSavedViews.viewKey, viewKey),
        or(
          eq(userSavedViews.userId, userId),
          eq(userSavedViews.isShared, true),
        ),
      ));
    const result = rows.map((r) => {
      const first = (r.creatorFirstName || "").trim();
      const last = (r.creatorLastName || "").trim();
      const fullName = [first, last].filter(Boolean).join(" ");
      const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || null;
      return {
        ...r.view,
        creatorName: fullName || null,
        creatorInitials: initials,
      };
    });
    result.sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));
    return res.json(result);
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
      isShared: z.boolean().optional(),
    });
    const parsed = parseOrRespond(schema, req.body, res);
    if (!parsed) return;
    const [created] = await db
      .insert(userSavedViews)
      .values({
        userId,
        organizationId: orgId,
        viewKey: parsed.viewKey,
        name: parsed.name,
        view: parsed.view,
        filtersJson: JSON.stringify(parsed.filters || {}),
        isShared: parsed.isShared === true,
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

router.patch("/api/saved-views/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const { id } = req.params;
    const schema = z.object({
      name: z.string().min(1).max(120).optional(),
      isShared: z.boolean().optional(),
      filters: z.record(z.any()).optional(),
      view: z.enum(VALID_VIEWS).optional(),
    });
    const parsed = parseOrRespond(schema, req.body, res);
    if (!parsed) return;

    const [existing] = await db
      .select()
      .from(userSavedViews)
      .where(and(
        eq(userSavedViews.id, id),
        eq(userSavedViews.organizationId, orgId),
      ))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Saved view not found" });
    }
    if (existing.userId !== userId && !isAdmin(role)) {
      return res.status(403).json({ error: "Only the creator or an admin can edit this view" });
    }

    const updates: Partial<typeof existing> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.isShared !== undefined) updates.isShared = parsed.isShared;
    if (parsed.view !== undefined) updates.view = parsed.view;
    if (parsed.filters !== undefined) updates.filtersJson = JSON.stringify(parsed.filters);

    if (Object.keys(updates).length === 0) {
      return res.json(existing);
    }

    const [updated] = await db
      .update(userSavedViews)
      .set(updates)
      .where(and(
        eq(userSavedViews.id, id),
        eq(userSavedViews.organizationId, orgId),
      ))
      .returning();
    return res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid update", details: err.errors });
    }
    return next(err);
  }
});

router.delete("/api/saved-views/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    const role = req.user!.role;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required" });
    }
    const { id } = req.params;
    const [existing] = await db
      .select()
      .from(userSavedViews)
      .where(and(
        eq(userSavedViews.id, id),
        eq(userSavedViews.organizationId, orgId),
      ))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Saved view not found" });
    }
    if (existing.userId !== userId && !isAdmin(role)) {
      return res.status(403).json({ error: "Only the creator or an admin can delete this view" });
    }
    await db.delete(userSavedViews).where(and(
      eq(userSavedViews.id, id),
      eq(userSavedViews.organizationId, orgId),
    ));
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

export default router;
