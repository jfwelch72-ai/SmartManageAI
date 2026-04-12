import { Router } from "express";
import { db } from "./db";
import { projectLocations, takeoffMeasurements, takeoffSheets, projects, quantityCategories, users, notifications } from "@shared/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { verifyOrgAccess } from "./orgFilter";
import { sanitizeShortText } from "./sanitization";
import { logError } from "./utils/logger";

const router = Router();

async function getProjectWithAccess(req: AuthRequest, res: any, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }
  if (!verifyOrgAccess(req, res, project.gcOrganizationId)) return null;
  return project;
}

router.get("/api/projects/:projectId/locations", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const locations = await db.select().from(projectLocations)
      .where(eq(projectLocations.projectId, project.id))
      .orderBy(projectLocations.sortOrder);
    res.json(locations);
  } catch (error) { next(error); }
});

router.post("/api/projects/:projectId/locations", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const schema = z.object({
      name: z.string().min(1),
      level: z.enum(["BUILDING", "FLOOR", "ROOM", "ZONE"]),
      parentId: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      description: z.string().nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    if (parsed.data.parentId) {
      const [parent] = await db.select().from(projectLocations)
        .where(and(eq(projectLocations.id, parsed.data.parentId), eq(projectLocations.projectId, project.id)))
        .limit(1);
      if (!parent) return res.status(400).json({ error: "Parent location not found" });
    }

    const [location] = await db.insert(projectLocations).values({
      projectId: project.id,
      name: sanitizeShortText(parsed.data.name),
      level: parsed.data.level,
      parentId: parsed.data.parentId || null,
      sortOrder: parsed.data.sortOrder ?? 0,
      description: parsed.data.description || null,
    }).returning();

    res.status(201).json(location);
  } catch (error) { next(error); }
});

router.patch("/api/projects/:projectId/locations/:locationId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const schema = z.object({
      name: z.string().min(1).optional(),
      sortOrder: z.number().optional(),
      description: z.string().nullable().optional(),
      parentId: z.string().nullable().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const updateData: any = { updatedAt: new Date() };
    if (parsed.data.name) updateData.name = sanitizeShortText(parsed.data.name);
    if (parsed.data.sortOrder !== undefined) updateData.sortOrder = parsed.data.sortOrder;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.parentId !== undefined) updateData.parentId = parsed.data.parentId;

    const [updated] = await db.update(projectLocations)
      .set(updateData)
      .where(and(eq(projectLocations.id, req.params.locationId), eq(projectLocations.projectId, project.id)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Location not found" });
    res.json(updated);
  } catch (error) { next(error); }
});

router.delete("/api/projects/:projectId/locations/:locationId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const projectSheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, project.id));
    const sheetIds = projectSheets.map(s => s.id);
    if (sheetIds.length > 0) {
      await db.update(takeoffMeasurements)
        .set({ locationId: null })
        .where(and(
          eq(takeoffMeasurements.locationId, req.params.locationId),
          inArray(takeoffMeasurements.sheetId, sheetIds)
        ));
    }

    await db.update(projectLocations)
      .set({ parentId: null })
      .where(and(eq(projectLocations.parentId, req.params.locationId), eq(projectLocations.projectId, project.id)));

    await db.delete(projectLocations)
      .where(and(eq(projectLocations.id, req.params.locationId), eq(projectLocations.projectId, project.id)));

    res.json({ success: true });
  } catch (error) { next(error); }
});

router.get("/api/projects/:projectId/location-breakdown", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const locations = await db.select().from(projectLocations)
      .where(eq(projectLocations.projectId, project.id))
      .orderBy(projectLocations.sortOrder);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, project.id));
    const sheetIds = sheets.map(s => s.id);

    if (sheetIds.length === 0) {
      return res.json({ locations, breakdown: [] });
    }

    const measurements = await db.select({
      locationId: takeoffMeasurements.locationId,
      type: takeoffMeasurements.type,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      unitCost: takeoffMeasurements.unitCost,
      count: takeoffMeasurements.count,
      installedQuantity: takeoffMeasurements.installedQuantity,
      label: takeoffMeasurements.label,
      id: takeoffMeasurements.id,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const locationMap = new Map<string | null, {
      locationId: string | null;
      locationName: string;
      locationLevel: string | null;
      totalItems: number;
      totalLengthFt: number;
      totalAreaFt2: number;
      totalVolumeCy: number;
      totalCost: number;
      plannedQuantity: number;
      installedQuantity: number;
    }>();

    for (const m of measurements) {
      const locId = m.locationId || null;
      if (!locationMap.has(locId)) {
        const loc = locations.find(l => l.id === locId);
        locationMap.set(locId, {
          locationId: locId,
          locationName: loc?.name || "Unassigned",
          locationLevel: loc?.level || null,
          totalItems: 0,
          totalLengthFt: 0,
          totalAreaFt2: 0,
          totalVolumeCy: 0,
          totalCost: 0,
          plannedQuantity: 0,
          installedQuantity: 0,
        });
      }
      const entry = locationMap.get(locId)!;
      entry.totalItems++;
      entry.totalLengthFt += m.computedLengthFt || 0;
      entry.totalAreaFt2 += m.computedAreaFt2 || 0;
      entry.totalVolumeCy += m.computedVolumeCy || 0;
      const qty = m.computedAreaFt2 || m.computedLengthFt || m.computedVolumeCy || m.count || 0;
      entry.totalCost += qty * (m.unitCost || 0);
      entry.plannedQuantity += qty;
      entry.installedQuantity += m.installedQuantity || 0;
    }

    res.json({
      locations,
      breakdown: Array.from(locationMap.values()),
    });
  } catch (error) { next(error); }
});

router.get("/api/projects/:projectId/field-takeoff", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const project = await getProjectWithAccess(req, res, req.params.projectId);
    if (!project) return;

    const locations = await db.select().from(projectLocations)
      .where(eq(projectLocations.projectId, project.id))
      .orderBy(projectLocations.sortOrder);

    const sheets = await db.select({ id: takeoffSheets.id }).from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, project.id));
    const sheetIds = sheets.map(s => s.id);

    if (sheetIds.length === 0) {
      return res.json({ locations, items: [] });
    }

    const measurements = await db.select({
      id: takeoffMeasurements.id,
      label: takeoffMeasurements.label,
      type: takeoffMeasurements.type,
      locationId: takeoffMeasurements.locationId,
      computedLengthFt: takeoffMeasurements.computedLengthFt,
      computedAreaFt2: takeoffMeasurements.computedAreaFt2,
      computedVolumeCy: takeoffMeasurements.computedVolumeCy,
      count: takeoffMeasurements.count,
      unitCost: takeoffMeasurements.unitCost,
      installedQuantity: takeoffMeasurements.installedQuantity,
      installedAt: takeoffMeasurements.installedAt,
      installedById: takeoffMeasurements.installedById,
      photoUrls: takeoffMeasurements.photoUrls,
      status: takeoffMeasurements.status,
      categoryId: takeoffMeasurements.categoryId,
      note: takeoffMeasurements.note,
    }).from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.sheetId, sheetIds));

    const categories = await db.select().from(quantityCategories)
      .where(eq(quantityCategories.projectId, project.id));

    const categoryMap = new Map(categories.map(c => [c.id, c]));

    const items = measurements.map(m => {
      const qty = m.computedAreaFt2 || m.computedLengthFt || m.computedVolumeCy || m.count || 0;
      const installed = m.installedQuantity || 0;
      const remaining = Math.max(0, qty - installed);
      const overrunPercent = qty > 0 ? ((installed - qty) / qty) * 100 : 0;
      const category = m.categoryId ? categoryMap.get(m.categoryId) : null;
      const costImpact = (installed - qty) * (m.unitCost || 0);

      return {
        ...m,
        categoryName: category?.name || null,
        categoryColor: category?.color || null,
        plannedQuantity: qty,
        installedQuantity: installed,
        remainingQuantity: remaining,
        overrunPercent: overrunPercent > 0 ? overrunPercent : 0,
        isOverrun: installed > qty && qty > 0,
        costImpact: costImpact > 0 ? costImpact : 0,
        photoUrlsList: m.photoUrls ? JSON.parse(m.photoUrls) : [],
      };
    });

    res.json({ locations, items });
  } catch (error) { next(error); }
});

router.patch("/api/takeoff/measurements/:measurementId/installed", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      installedQuantity: z.number().min(0),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const [measurement] = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .limit(1);
    if (!measurement) return res.status(404).json({ error: "Measurement not found" });

    const [sheet] = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.id, measurement.sheetId))
      .limit(1);
    if (!sheet) return res.status(404).json({ error: "Sheet not found" });

    const projectId = sheet.projectId;
    if (projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
      if (project && !verifyOrgAccess(req, res, project.gcOrganizationId)) return;
    }

    const [updated] = await db.update(takeoffMeasurements)
      .set({
        installedQuantity: parsed.data.installedQuantity,
        installedById: req.user!.id,
        installedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .returning();

    const plannedQty = measurement.computedAreaFt2 || measurement.computedLengthFt || measurement.computedVolumeCy || measurement.count || 0;
    const overrunThreshold = 0.9;
    let overrunAlert = null;

    if (plannedQty > 0 && parsed.data.installedQuantity > plannedQty * overrunThreshold) {
      const overrunPct = ((parsed.data.installedQuantity - plannedQty) / plannedQty * 100).toFixed(1);
      const costImpact = (parsed.data.installedQuantity - plannedQty) * (measurement.unitCost || 0);
      overrunAlert = {
        type: parsed.data.installedQuantity > plannedQty ? "OVERRUN" : "WARNING",
        message: parsed.data.installedQuantity > plannedQty
          ? `Overrun: +${overrunPct}% → ₱${costImpact.toFixed(0)} impact`
          : `Warning: ${((parsed.data.installedQuantity / plannedQty) * 100).toFixed(0)}% of planned quantity installed`,
        overrunPercent: parseFloat(overrunPct),
        costImpact,
      };

      if (projectId && parsed.data.installedQuantity > plannedQty) {
        try {
          await db.insert(notifications).values({
            userId: req.user!.id,
            type: "MATERIAL_ALERT",
            title: `Takeoff Overrun: ${measurement.label}`,
            message: `Installed quantity (${parsed.data.installedQuantity}) exceeds planned (${plannedQty}) by ${overrunPct}%`,
            projectId,
          });
        } catch (e) {
          logError("Failed to create overrun notification:", {}, e instanceof Error ? e : new Error(String(e)));
        }
      }
    }

    res.json({ measurement: updated, overrunAlert });
  } catch (error) { next(error); }
});

router.patch("/api/takeoff/measurements/:measurementId/location", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      locationId: z.string().nullable(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const [measurement] = await db.select().from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .limit(1);
    if (!measurement) return res.status(404).json({ error: "Measurement not found" });

    const [sheet] = await db.select().from(takeoffSheets)
      .where(eq(takeoffSheets.id, measurement.sheetId))
      .limit(1);
    if (!sheet) return res.status(404).json({ error: "Sheet not found" });

    if (sheet.projectId) {
      const [project] = await db.select().from(projects).where(eq(projects.id, sheet.projectId)).limit(1);
      if (project && !verifyOrgAccess(req, res, project.gcOrganizationId)) return;
    }

    const [updated] = await db.update(takeoffMeasurements)
      .set({ locationId: parsed.data.locationId, updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .returning();

    res.json(updated);
  } catch (error) { next(error); }
});

async function verifyMeasurementAccess(req: AuthRequest, res: any, measurementId: string) {
  const [measurement] = await db.select().from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, measurementId))
    .limit(1);
  if (!measurement) { res.status(404).json({ error: "Measurement not found" }); return null; }

  const [sheet] = await db.select().from(takeoffSheets)
    .where(eq(takeoffSheets.id, measurement.sheetId))
    .limit(1);
  if (!sheet) { res.status(404).json({ error: "Sheet not found" }); return null; }

  if (sheet.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, sheet.projectId)).limit(1);
    if (project && !verifyOrgAccess(req, res, project.gcOrganizationId)) return null;
  }

  return measurement;
}

router.post("/api/takeoff/measurements/:measurementId/photos", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      photoUrl: z.string().url(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid photo URL" });

    const measurement = await verifyMeasurementAccess(req, res, req.params.measurementId);
    if (!measurement) return;

    const existing: string[] = measurement.photoUrls ? JSON.parse(measurement.photoUrls) : [];
    existing.push(parsed.data.photoUrl);

    const [updated] = await db.update(takeoffMeasurements)
      .set({ photoUrls: JSON.stringify(existing), updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .returning();

    res.json(updated);
  } catch (error) { next(error); }
});

router.delete("/api/takeoff/measurements/:measurementId/photos", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      photoUrl: z.string(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

    const measurement = await verifyMeasurementAccess(req, res, req.params.measurementId);
    if (!measurement) return;

    const existing: string[] = measurement.photoUrls ? JSON.parse(measurement.photoUrls) : [];
    const filtered = existing.filter(u => u !== parsed.data.photoUrl);

    const [updated] = await db.update(takeoffMeasurements)
      .set({ photoUrls: JSON.stringify(filtered), updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, req.params.measurementId))
      .returning();

    res.json(updated);
  } catch (error) { next(error); }
});

export default router;
