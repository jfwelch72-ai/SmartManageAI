import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { db } from "./db";
import { drawingSets, drawingSetItems, takeoffSheets, projects } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getOrgId, getUserOrThrow } from "./utils/routeHelpers";
import { logError } from "./utils/logger";

const router = Router();

router.get("/:projectId/drawing-sets", requireAuth, async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, req.params.projectId), eq(projects.organizationId, orgId)));
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const sets = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.projectId, req.params.projectId),
        eq(drawingSets.organizationId, orgId)
      ))
      .orderBy(desc(drawingSets.createdAt));
    res.json(sets);
  } catch (err) {
    logError("Failed to list drawing sets", { error: String(err) });
    res.status(500).json({ error: "Failed to list drawing sets" });
  }
});

router.post("/:projectId/drawing-sets", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [proj] = await db.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, req.params.projectId), eq(projects.organizationId, orgId)));
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const [set] = await db.insert(drawingSets).values({
      projectId: req.params.projectId,
      organizationId: orgId,
      name,
      description: description || null,
      isPrimary: false,
      createdByUserId: user.id,
    }).returning();
    res.status(201).json(set);
  } catch (err) {
    logError("Failed to create drawing set", { error: String(err) });
    res.status(500).json({ error: "Failed to create drawing set" });
  }
});

router.patch("/drawing-sets/:setId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { name, description } = req.body;
    const updates: Partial<{ name: string; description: string | null }> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No fields to update" });

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
    logError("Failed to update drawing set", { error: String(err) });
    res.status(500).json({ error: "Failed to update drawing set" });
  }
});

router.delete("/drawing-sets/:setId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    logError("Failed to delete drawing set", { error: String(err) });
    res.status(500).json({ error: "Failed to delete drawing set" });
  }
});

router.post("/drawing-sets/:setId/primary", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    logError("Failed to set primary drawing set", { error: String(err) });
    res.status(500).json({ error: "Failed to set primary" });
  }
});

router.get("/drawing-sets/:setId/items", requireAuth, async (req: AuthRequest, res) => {
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
    logError("Failed to list drawing set items", { error: String(err) });
    res.status(500).json({ error: "Failed to list items" });
  }
});

router.post("/drawing-sets/:setId/items", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const { sheetId, revisionId } = req.body;
    if (!sheetId) return res.status(400).json({ error: "sheetId required" });

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
    logError("Failed to add drawing set item", { error: String(err) });
    res.status(500).json({ error: "Failed to add item" });
  }
});

router.post("/drawing-sets/:setId/items/bulk", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const [set] = await db.select().from(drawingSets)
      .where(and(
        eq(drawingSets.id, req.params.setId),
        eq(drawingSets.organizationId, orgId)
      ));
    if (!set) return res.status(404).json({ error: "Drawing set not found" });

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "items array required" });

    const sheetIds = items.map((i: { sheetId: string }) => i.sheetId);
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
  } catch (err) {
    logError("Failed to bulk update drawing set items", { error: String(err) });
    res.status(500).json({ error: "Failed to bulk update items" });
  }
});

router.delete("/drawing-sets/:setId/items/:itemId", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
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
    logError("Failed to remove drawing set item", { error: String(err) });
    res.status(500).json({ error: "Failed to remove item" });
  }
});

router.get("/drawing-sets/:setId/compare", requireAuth, async (req: AuthRequest, res) => {
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
    logError("Failed to compare drawing set", { error: String(err) });
    res.status(500).json({ error: "Failed to compare" });
  }
});

router.get("/drawing-sets/:setId/sheet-status", requireAuth, async (req: AuthRequest, res) => {
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
    logError("Failed to get sheet status", { error: String(err) });
    res.status(500).json({ error: "Failed to get sheet status" });
  }
});

export default router;
