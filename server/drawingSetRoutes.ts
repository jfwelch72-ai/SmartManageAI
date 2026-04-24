import { Router } from "express";
import { requireAuth, requireRole, requireRoleOrFeature, type AuthRequest } from "./auth";
import { db } from "./db";
import { drawingSets, drawingSetItems, takeoffSheets, projects } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getOrgId, getUserOrThrow } from "./utils/routeHelpers";
import { logError } from "./utils/logger";
import { z } from "zod";

const createDrawingSetSchema = z.object({
  name: z.string().min(1, "name required").max(200),
  description: z.string().max(1000).nullable().optional(),
});

const updateDrawingSetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
}).refine(d => d.name !== undefined || d.description !== undefined, { message: "No fields to update" });

const addDrawingSetItemSchema = z.object({
  sheetId: z.string().uuid("sheetId required"),
  revisionId: z.string().uuid().optional(),
});

const bulkDrawingSetItemsSchema = z.object({
  items: z.array(z.object({
    sheetId: z.string().uuid(),
    revisionId: z.string().uuid().optional(),
  })).min(1, "items array required"),
});

const router = Router();

router.get("/:projectId/drawing-sets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, req.params.projectId), eq(projects.gcOrganizationId, orgId)));
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const sets = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.projectId, req.params.projectId),
        eq(drawingSets.organizationId, orgId)
      ))
      .orderBy(desc(drawingSets.createdAt));
    res.json(sets);
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/drawing-sets", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, req.params.projectId), eq(projects.gcOrganizationId, orgId)));
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const parsed = createDrawingSetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });

    const [set] = await db.insert(drawingSets).values({
      projectId: req.params.projectId,
      organizationId: orgId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      isPrimary: false,
      createdByUserId: user.id,
    }).returning();
    res.status(201).json(set);
  } catch (err) {
    next(err);
  }
});

router.patch("/drawing-sets/:setId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const parsed = updateDrawingSetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    const updates: Partial<{ name: string; description: string | null }> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;

    const [updated] = await db.update(drawingSets)
      .set(updates)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Drawing set not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/drawing-sets/:setId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const [deleted] = await db.delete(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Drawing set not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/drawing-sets/:setId/primary", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    await db.update(drawingSets)
      .set({ isPrimary: false })
      .where(and(
        eq(drawingSets.projectId, set.projectId),
        eq(drawingSets.organizationId, orgId)
      ));

    const [updated] = await db.update(drawingSets)
      .set({ isPrimary: true })
      .where(eq(drawingSets.id, req.params.setId))
      .returning();
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/drawing-sets/:setId/items", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const items = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, req.params.setId));
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.post("/drawing-sets/:setId/items", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const parsed = addDrawingSetItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    const { sheetId, revisionId } = parsed.data;

    const [sheet] = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(and(
        eq(takeoffSheets.id, sheetId),
        eq(takeoffSheets.projectId, set.projectId)
      ));
    if (!sheet) return res.status(400).json({ error: "Sheet not found in this project" });

    const [item] = await db.insert(drawingSetItems).values({
      drawingSetId: req.params.setId,
      sheetId,
      revisionId: revisionId || null,
    }).returning();
    res.status(201).json(item);
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Sheet already in this drawing set" });
    }
    next(err);
  }
});

router.post("/drawing-sets/:setId/items/bulk", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const parsed = bulkDrawingSetItemsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
    const { items } = parsed.data;

    const sheetIds = items.map((i) => i.sheetId);
    const validSheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(and(
        inArray(takeoffSheets.id, sheetIds),
        eq(takeoffSheets.projectId, set.projectId)
      ));
    const validSheetIds = new Set(validSheets.map(s => s.id));
    const invalidIds = sheetIds.filter((id: string) => !validSheetIds.has(id));
    if (invalidIds.length > 0) return res.status(400).json({ error: `Sheets not found in project: ${invalidIds.join(", ")}` });

    await db.delete(drawingSetItems).where(eq(drawingSetItems.drawingSetId, req.params.setId));

    const values = items.map((item: { sheetId: string; revisionId?: string }) => ({
      drawingSetId: req.params.setId,
      sheetId: item.sheetId,
      revisionId: item.revisionId || null,
    }));

    const inserted = await db.insert(drawingSetItems).values(values).returning();
    res.json(inserted);
  } catch (err: any) {
    // Task #1812 — match the single-item POST so duplicate sheetIds within
    // a bulk request surface as a 409 (caught by the bulk-manage modal's
    // friendly toast) rather than a generic 500.
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Sheet already in this drawing set" });
    }
    next(err);
  }
});

router.delete("/drawing-sets/:setId/items/:itemId", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const [deleted] = await db.delete(drawingSetItems)
      .where(and(
        eq(drawingSetItems.id, req.params.itemId),
        eq(drawingSetItems.drawingSetId, req.params.setId)
      ))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Item not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/drawing-sets/:setId/compare", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const items = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, req.params.setId));

    if (items.length === 0) return res.json({ items: [], comparison: [] });

    const sheetIds = items.map(i => i.sheetId);
    const pinnedSheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.id, sheetIds));
    const pinnedMap = new Map(pinnedSheets.map(s => [s.id, s]));

    const allProjectSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, set.projectId));

    const activeByName = new Map<string, typeof allProjectSheets[0]>();
    for (const s of allProjectSheets) {
      if (s.isActive && s.sheetName) {
        activeByName.set(s.sheetName, s);
      }
    }

    const comparison = items.map(item => {
      const pinnedSheet = pinnedMap.get(item.sheetId);
      const sheetName = pinnedSheet?.sheetName || null;
      const latestActive = sheetName ? activeByName.get(sheetName) : null;

      const hasNewerRevision = latestActive
        ? latestActive.id !== item.sheetId
        : pinnedSheet ? !pinnedSheet.isActive : false;

      return {
        itemId: item.id,
        sheetId: item.sheetId,
        pinnedRevisionId: item.revisionId,
        sheetName,
        pinnedIsActive: pinnedSheet?.isActive ?? false,
        latestSheetId: latestActive?.id || null,
        latestRevisionLabel: latestActive?.revisionLabel || null,
        currentRevisionLabel: pinnedSheet?.revisionLabel || null,
        hasNewerRevision,
      };
    });

    res.json({ items, comparison });
  } catch (err) {
    next(err);
  }
});

// Task #1894 — atomic "Re-pin all to latest" action. The Compare dialog
// (and the per-card stale badge) surface a one-click "Update N stale
// sheets" button. The previous client-side approach rebuilt the entire
// pinned-items list and POST'd `/items/bulk`, which could collide with
// the unique (drawing_set_id, sheet_id) constraint and fail with HTTP
// 409 whenever the latest revision of a stale row was already pinned as
// another item in the same set.
//
// This endpoint:
//   * scopes the set to the caller's organization (404 otherwise);
//   * derives stale items from `(sheet.sheet_name → latest active sheet)`;
//   * within a single transaction:
//       - deletes stale items whose latest is already pinned in the set
//         (avoiding the 23505 dedupe collision);
//       - updates the remaining stale items in-place to the latest
//         sheet id (which preserves their `pinned_at` ordering);
//   * returns `{ updated, replaced, removed }` so the client toast can
//     report the exact number of sheets that were re-pinned.
//
// Non-stale pinned items are left untouched, satisfying the
// "without losing other pinned selections" requirement.
router.post("/drawing-sets/:setId/repin-stale", requireAuth, requireRoleOrFeature(["SUPER_ADMIN", "ADMIN", "MANAGER"], "canEditProjects"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const items = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, req.params.setId));
    if (items.length === 0) return res.json({ updated: 0, replaced: 0, removed: 0 });

    const sheetIds = items.map((i) => i.sheetId);
    const pinnedSheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.id, sheetIds));
    const pinnedMap = new Map(pinnedSheets.map((s) => [s.id, s]));

    const allProjectSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, set.projectId));
    const activeByName = new Map<string, typeof allProjectSheets[0]>();
    for (const s of allProjectSheets) {
      if (s.isActive && s.sheetName) activeByName.set(s.sheetName, s);
    }

    // Track which sheetIds are currently pinned in this set so we can
    // dedupe before issuing UPDATE/DELETE statements (avoids the unique
    // constraint conflict that would otherwise surface as HTTP 409).
    const currentPinnedIds = new Set(items.map((i) => i.sheetId));
    const itemsToDelete: string[] = [];
    const itemsToUpdate: Array<{ id: string; newSheetId: string }> = [];

    for (const item of items) {
      const pinnedSheet = pinnedMap.get(item.sheetId);
      if (!pinnedSheet?.sheetName) continue;
      const latest = activeByName.get(pinnedSheet.sheetName);
      if (!latest || latest.id === item.sheetId) continue; // already up-to-date or nothing to swap to
      if (currentPinnedIds.has(latest.id)) {
        // Latest revision is already pinned as a separate item — drop the
        // stale row instead of trying (and failing) to update into a
        // duplicate (drawingSetId, sheetId) pair.
        itemsToDelete.push(item.id);
        currentPinnedIds.delete(item.sheetId);
      } else {
        itemsToUpdate.push({ id: item.id, newSheetId: latest.id });
        currentPinnedIds.delete(item.sheetId);
        currentPinnedIds.add(latest.id);
      }
    }

    if (itemsToDelete.length === 0 && itemsToUpdate.length === 0) {
      return res.json({ updated: 0, replaced: 0, removed: 0 });
    }

    await db.transaction(async (tx) => {
      if (itemsToDelete.length > 0) {
        await tx.delete(drawingSetItems)
          .where(inArray(drawingSetItems.id, itemsToDelete));
      }
      for (const u of itemsToUpdate) {
        await tx.update(drawingSetItems)
          .set({ sheetId: u.newSheetId, revisionId: null })
          .where(eq(drawingSetItems.id, u.id));
      }
    });

    res.json({
      updated: itemsToDelete.length + itemsToUpdate.length,
      replaced: itemsToUpdate.length,
      removed: itemsToDelete.length,
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Sheet already in this drawing set" });
    }
    next(err);
  }
});

router.get("/drawing-sets/:setId/sheet-status", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const items = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, req.params.setId));

    if (items.length === 0) return res.json({ pinnedSheetIds: [], newerSheetIds: [] });

    const sheetIds = items.map(i => i.sheetId);
    const pinnedSheets = await db.select().from(takeoffSheets)
      .where(inArray(takeoffSheets.id, sheetIds));
    const pinnedMap = new Map(pinnedSheets.map(s => [s.id, s]));

    const allProjectSheets = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, set.projectId));

    const activeByName = new Map<string, typeof allProjectSheets[0]>();
    for (const s of allProjectSheets) {
      if (s.isActive && s.sheetName) {
        activeByName.set(s.sheetName, s);
      }
    }

    const newerSheetIds: string[] = [];
    for (const item of items) {
      const pinnedSheet = pinnedMap.get(item.sheetId);
      if (!pinnedSheet?.sheetName) continue;
      const latestActive = activeByName.get(pinnedSheet.sheetName);
      if (latestActive && latestActive.id !== item.sheetId) {
        newerSheetIds.push(item.sheetId);
        newerSheetIds.push(latestActive.id);
      }
    }

    res.json({
      pinnedSheetIds: sheetIds,
      newerSheetIds,
      pinnedToLatestMap: items.reduce((acc: Record<string, string | null>, item) => {
        const pinnedSheet = pinnedMap.get(item.sheetId);
        if (pinnedSheet?.sheetName) {
          const latest = activeByName.get(pinnedSheet.sheetName);
          acc[item.sheetId] = latest?.id || null;
        }
        return acc;
      }, {}),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
