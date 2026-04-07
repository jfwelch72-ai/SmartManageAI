import { Router, NextFunction } from "express";
import { db } from "./db";
import { bids, takeoffSheets, projects } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { sanitizeShortText } from "./sanitization";
import { createArcSegment, computeDistanceInFeet, computePolygonAreaInFt2, computeVolumeInCY, computePitchedAreaFt2 } from "@shared/utils/geometry";
import { verifySheetAccess, safeParsePoints, verifyGroupAccess, getActiveDraftVersionId, getDefaultVersionId, getDefaultVersionIdsBatch, hasAnyVersions, isMeasurementLocked } from "./takeoffHelpers";
import { logCreate, logUpdate, logDelete } from "./auditLogger";

const router = Router();

router.get("/api/projects/:projectId/takeoff/all-measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;
    const user = req.user!;
    const { takeoffMeasurements, takeoffSheets, crewProjectAssignments, crewMembers } = await import("@shared/schema");

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    if (user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "SUPER_ADMIN" && user.role !== "ESTIMATOR") {
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, projectId), eq(crewMembers.userId, user.id)))
        .limit(1);
      if (!assignment) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }

    const projectSheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, projectId));

    const sheetIds = projectSheets.map(s => s.id);
    if (sheetIds.length === 0) {
      res.json([]);
      return;
    }

    const versionMap = await getDefaultVersionIdsBatch(sheetIds);
    const versionedSheetIds: string[] = [];
    const unversionedSheetIds: string[] = [];
    const defaultVersionIds: string[] = [];
    for (const sid of sheetIds) {
      const vId = versionMap.get(sid);
      if (vId) {
        versionedSheetIds.push(sid);
        defaultVersionIds.push(vId);
      } else {
        unversionedSheetIds.push(sid);
      }
    }

    let allMeasurements: (typeof takeoffMeasurements.$inferSelect)[] = [];
    if (defaultVersionIds.length > 0) {
      const versioned = await db.select().from(takeoffMeasurements)
        .where(and(
          inArray(takeoffMeasurements.sheetId, versionedSheetIds),
          inArray(takeoffMeasurements.takeoffVersionId, defaultVersionIds)
        ))
        .orderBy(takeoffMeasurements.createdAt);
      allMeasurements = allMeasurements.concat(versioned);
    }
    if (unversionedSheetIds.length > 0) {
      const unversioned = await db.select().from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.sheetId, unversionedSheetIds))
        .orderBy(takeoffMeasurements.createdAt);
      allMeasurements = allMeasurements.concat(unversioned);
    }

    const parsedMeasurements = allMeasurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:bidId/takeoff/all-measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { bidId } = req.params;
    const user = req.user!;
    const { takeoffMeasurements, takeoffSheets, bids } = await import("@shared/schema");

    const isSuperAdmin = user.role === "SUPER_ADMIN";
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, bidId)]
      : [eq(bids.id, bidId), eq(bids.gcOrganizationId, user.organizationId)];
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);

    if (!bid) {
      res.status(404).json({ error: "Bid not found" });
      return;
    }

    const bidSheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bidId));

    const sheetIds = bidSheets.map(s => s.id);
    if (sheetIds.length === 0) {
      res.json([]);
      return;
    }

    const versionMap = await getDefaultVersionIdsBatch(sheetIds);
    const versionedSheetIds: string[] = [];
    const unversionedSheetIds: string[] = [];
    const defaultVersionIds: string[] = [];
    for (const sid of sheetIds) {
      const vId = versionMap.get(sid);
      if (vId) {
        versionedSheetIds.push(sid);
        defaultVersionIds.push(vId);
      } else {
        unversionedSheetIds.push(sid);
      }
    }

    let allMeasurements: (typeof takeoffMeasurements.$inferSelect)[] = [];
    if (defaultVersionIds.length > 0) {
      const versioned = await db.select().from(takeoffMeasurements)
        .where(and(
          inArray(takeoffMeasurements.sheetId, versionedSheetIds),
          inArray(takeoffMeasurements.takeoffVersionId, defaultVersionIds)
        ))
        .orderBy(takeoffMeasurements.createdAt);
      allMeasurements = allMeasurements.concat(versioned);
    }
    if (unversionedSheetIds.length > 0) {
      const unversioned = await db.select().from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.sheetId, unversionedSheetIds))
        .orderBy(takeoffMeasurements.createdAt);
      allMeasurements = allMeasurements.concat(unversioned);
    }

    const parsedMeasurements = allMeasurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
    next(error);
  }
});

// Get measurements for a sheet
router.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const { versionId } = req.query;
    const { takeoffMeasurements } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    let targetVersionId: string | null = null;
    if (versionId) {
      targetVersionId = versionId as string;
    } else {
      targetVersionId = await getDefaultVersionId(sheetId);
    }

    let measurements;
    if (targetVersionId) {
      measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(and(eq(takeoffMeasurements.sheetId, sheetId), eq(takeoffMeasurements.takeoffVersionId, targetVersionId)))
        .orderBy(takeoffMeasurements.createdAt);
    } else {
      measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, sheetId))
        .orderBy(takeoffMeasurements.createdAt);
    }

    const parsedMeasurements = measurements.map(m => ({
      ...m,
      points: safeParsePoints(m.points) || [],
    }));

    res.json(parsedMeasurements);
  } catch (error) {
  next(error);
  }
});

async function computeMeasurementGeometry(
  validated: Record<string, unknown>,
  scalePxPerFoot: number | null,
): Promise<Record<string, unknown>> {
  const finalValues = { ...validated };
  if (!scalePxPerFoot) return finalValues;

  const points = safeParsePoints(validated.points);
  if (!points || points.length === 0) return finalValues;

  const mType = validated.type as string;

  if (mType === "LINEAR" && points.length === 3) {
    try {
      const [start, middle, end] = points;
      const arcSegment = createArcSegment(start, end, middle, scalePxPerFoot);
      if (arcSegment) {
        finalValues.computedLengthFt = arcSegment.arcLength;
      }
    } catch (e) { console.error("Error computing arc length:", e); }
  } else if (mType === "LINEAR" && points.length >= 2 && !finalValues.computedLengthFt) {
    try {
      finalValues.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
    } catch (e) { console.error("Error computing linear distance:", e); }
  }

  if ((mType === "AREA" || mType === "PITCHED_AREA" || mType === "SURFACE_AREA") && points.length >= 3 && !finalValues.computedAreaFt2) {
    try {
      let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
      if (mType === "PITCHED_AREA" && validated.pitchRatio) {
        areaFt2 = computePitchedAreaFt2(areaFt2, validated.pitchRatio as string);
      }
      finalValues.computedAreaFt2 = areaFt2;
      if (mType === "SURFACE_AREA") {
        finalValues.computedSurfaceAreaFt2 = areaFt2;
      }
    } catch (e) { console.error("Error computing area:", e); }
  }

  if (mType === "VOLUME" && points.length >= 3 && !finalValues.computedVolumeCy) {
    try {
      const areaFt2 = (finalValues.computedAreaFt2 as number) || computePolygonAreaInFt2(points, scalePxPerFoot);
      if (!finalValues.computedAreaFt2) finalValues.computedAreaFt2 = areaFt2;
      if (validated.depthFeet) {
        finalValues.computedVolumeCy = computeVolumeInCY(areaFt2, validated.depthFeet as number);
      }
    } catch (e) { console.error("Error computing volume:", e); }
  }

  return finalValues;
}

router.post("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const draftVersionId = await getActiveDraftVersionId(sheetId);
    if (!draftVersionId && await hasAnyVersions(sheetId)) {
      res.status(403).json({ error: "Sheet is locked. Create a new version to add measurements." });
      return;
    }

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    const validated = insertTakeoffMeasurementSchema.parse({
      ...sanitizedBody,
      sheetId,
      takeoffVersionId: draftVersionId || undefined,
    });

    const [sheet] = await db
      .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, sheetId))
      .limit(1);

    const finalValues = await computeMeasurementGeometry(validated, sheet?.scalePxPerFoot ?? null);

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues).returning();

    await logCreate(req.user!.id, "takeoff_measurement", measurement.id, { type: measurement.type, sheetId, label: measurement.label }, req);

    res.status(201).json(measurement);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements, takeoffSheets, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const [existingMeasurement] = await db
      .select({ sheetId: takeoffMeasurements.sheetId, type: takeoffMeasurements.type })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existingMeasurement) { res.status(404).json({ error: "Measurement not found" }); return; }

    const locked = await isMeasurementLocked(id);
    if (locked) { res.status(403).json({ error: "Cannot edit a measurement in a locked version" }); return; }

    const access = await verifySheetAccess(existingMeasurement.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

    const effectiveType = (validated.type || existingMeasurement.type) as string;
    let finalValues: Record<string, unknown> = { ...validated };

    const needsRecompute = validated.points || validated.type || validated.pitchRatio !== undefined || validated.depthFeet !== undefined;

    if (needsRecompute) {
      const [sheet] = await db
        .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, existingMeasurement.sheetId))
        .limit(1);

      if (sheet?.scalePxPerFoot) {
        let pointsForCompute = validated.points;
        if (!pointsForCompute) {
          const [full] = await db
            .select({ points: takeoffMeasurements.points, depthFeet: takeoffMeasurements.depthFeet, pitchRatio: takeoffMeasurements.pitchRatio })
            .from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.id, id))
            .limit(1);
          if (full) {
            pointsForCompute = full.points;
            if (validated.depthFeet === undefined && full.depthFeet) finalValues.depthFeet = full.depthFeet;
            if (validated.pitchRatio === undefined && full.pitchRatio) finalValues.pitchRatio = full.pitchRatio;
          }
        }

        finalValues.computedLengthFt = undefined;
        finalValues.computedAreaFt2 = undefined;
        finalValues.computedVolumeCy = undefined;
        finalValues.computedSurfaceAreaFt2 = undefined;

        finalValues = await computeMeasurementGeometry(
          { ...finalValues, points: pointsForCompute, type: effectiveType },
          sheet.scalePxPerFoot,
        );
      }
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({ ...finalValues, updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    await logUpdate(req.user!.id, "takeoff_measurement", id, { type: existingMeasurement.type }, { type: effectiveType, label: updated.label }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    if (!sanitizedBody.sheetId) {
      res.status(400).json({ error: "sheetId is required" });
      return;
    }

    const access = await verifySheetAccess(sanitizedBody.sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" });
      return;
    }

    const draftVersionId = await getActiveDraftVersionId(sanitizedBody.sheetId);
    if (!draftVersionId && await hasAnyVersions(sanitizedBody.sheetId)) {
      res.status(403).json({ error: "Sheet is locked. Create a new version to add measurements." });
      return;
    }

    const validated = insertTakeoffMeasurementSchema.parse({
      ...sanitizedBody,
      takeoffVersionId: draftVersionId || undefined,
    });

    const [sheet] = await db
      .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, validated.sheetId))
      .limit(1);

    const finalValues = await computeMeasurementGeometry(validated, sheet?.scalePxPerFoot ?? null);

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues).returning();

    await logCreate(req.user!.id, "takeoff_measurement", measurement.id, { type: measurement.type, sheetId: validated.sheetId, label: measurement.label }, req);

    res.status(201).json(measurement);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const [existing] = await db
      .select({ sheetId: takeoffMeasurements.sheetId, type: takeoffMeasurements.type, label: takeoffMeasurements.label })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Measurement not found" }); return; }

    const locked = await isMeasurementLocked(id);
    if (locked) { res.status(403).json({ error: "Cannot delete a measurement in a locked version" }); return; }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.id, id));

    await logDelete(req.user!.id, "takeoff_measurement", id, { type: existing.type, sheetId: existing.sheetId, label: existing.label }, req);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== Measurement Groups CRUD ====================

// Get groups for a sheet
router.get("/api/takeoff/sheets/:sheetId/groups", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");
    const groups = await db
      .select()
      .from(takeoffMeasurementGroups)
      .where(eq(takeoffMeasurementGroups.sheetId, sheetId))
      .orderBy(takeoffMeasurementGroups.sortOrder);
    res.json(groups);
  } catch (error) {
  next(error);
  }
});

// Create a group
router.post("/api/takeoff/sheets/:sheetId/groups", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups, takeoffSheets } = await import("@shared/schema");

    const [sheet] = await db.select({ projectId: takeoffSheets.projectId, bidId: takeoffSheets.bidId }).from(takeoffSheets).where(eq(takeoffSheets.id, sheetId)).limit(1);
    if (!sheet) { res.status(404).json({ error: "Sheet not found" }); return; }

    const name = sanitizeShortText(req.body.name || "Untitled Group");
    if (!name || name.length > 200) { res.status(400).json({ error: "Invalid group name" }); return; }
    const color = typeof req.body.color === "string" ? req.body.color.slice(0, 20) : "#6b7280";
    const sortOrder = typeof req.body.sortOrder === "number" ? req.body.sortOrder : 0;

    const [group] = await db.insert(takeoffMeasurementGroups).values({
      name,
      sheetId,
      projectId: sheet.projectId,
      bidId: sheet.bidId,
      sortOrder,
      color,
    }).returning();

    res.status(201).json(group);
  } catch (error) {
  next(error);
  }
});

// Update a group
router.patch("/api/takeoff/groups/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    const updates: any = { updatedAt: new Date() };
    if (typeof req.body.name === "string") updates.name = sanitizeShortText(req.body.name);
    if (typeof req.body.color === "string") updates.color = req.body.color.slice(0, 20);
    if (typeof req.body.sortOrder === "number") updates.sortOrder = req.body.sortOrder;

    const [updated] = await db.update(takeoffMeasurementGroups).set(updates).where(eq(takeoffMeasurementGroups.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Group not found" }); return; }

    res.json(updated);
  } catch (error) {
  next(error);
  }
});

// Delete a group (measurements get groupId set to null via FK constraint)
router.delete("/api/takeoff/groups/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    const [deleted] = await db.delete(takeoffMeasurementGroups).where(eq(takeoffMeasurementGroups.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Group not found" }); return; }

    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

// Reorder groups
const groupReorderItemSchema = z.object({ id: z.string().min(1), sortOrder: z.number().int().min(0) });
const groupReorderSchema = z.object({ order: z.array(groupReorderItemSchema).min(1) });
router.patch("/api/takeoff/sheets/:sheetId/groups/reorder", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const parsed = groupReorderSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "order must be a non-empty array of { id: string, sortOrder: number }" }); return; }
    const { order } = parsed.data;

    const { takeoffMeasurementGroups } = await import("@shared/schema");

    await db.transaction(async (tx) => {
      for (const item of order) {
        await tx.update(takeoffMeasurementGroups)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(and(eq(takeoffMeasurementGroups.id, item.id), eq(takeoffMeasurementGroups.sheetId, sheetId)));
      }
    });

    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

// Bulk visibility toggle for a group's measurements
router.patch("/api/takeoff/groups/:id/visibility", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const groupAccess = await verifyGroupAccess(id, req.user!);
    if (!groupAccess.allowed) { res.status(groupAccess.group ? 403 : 404).json({ error: groupAccess.reason || "Access denied" }); return; }

    const { visible } = req.body;
    if (typeof visible !== "boolean") { res.status(400).json({ error: "visible must be a boolean" }); return; }
    const { takeoffMeasurements } = await import("@shared/schema");

    await db.update(takeoffMeasurements).set({ visible, updatedAt: new Date() }).where(eq(takeoffMeasurements.groupId, id));

    res.json({ success: true });
  } catch (error) {
  next(error);
  }
});

router.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements } = await import("@shared/schema");

    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ 
        scalePxPerFoot, 
        units: units || "ft",
        updatedAt: new Date() 
      })
      .where(eq(takeoffSheets.id, id))
      .returning();

    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, id));

    for (const measurement of measurements) {
      if (!measurement.points) continue;

      const points = safeParsePoints(measurement.points);
      if (!points || points.length === 0) continue;

      const updates: Partial<typeof takeoffMeasurements.$inferInsert> = {};

      try {
        switch (measurement.type) {
          case "LINEAR":
            if (points.length === 3) {
              const [start, middle, end] = points;
              const arcSegment = createArcSegment(start, end, middle, scalePxPerFoot);
              if (arcSegment) {
                updates.computedLengthFt = arcSegment.arcLength;
              }
            } else if (points.length >= 2) {
              updates.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
            }
            break;

          case "AREA":
            if (points.length >= 3) {
              updates.computedAreaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
            }
            break;

          case "PITCHED_AREA":
            if (points.length >= 3) {
              let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              if (measurement.pitchRatio) {
                areaFt2 = computePitchedAreaFt2(areaFt2, measurement.pitchRatio);
              }
              updates.computedAreaFt2 = areaFt2;
            }
            break;

          case "SURFACE_AREA":
            if (points.length >= 3) {
              const surfArea = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = surfArea;
              updates.computedSurfaceAreaFt2 = surfArea;
            }
            break;

          case "VOLUME":
            if (points.length >= 3 && measurement.depthFeet) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = areaFt2;
              updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
            }
            break;

          case "SEGMENT":
            if (points.length >= 2) {
              let totalLen = 0;
              for (let i = 0; i < points.length - 1; i++) {
                totalLen += computeDistanceInFeet([points[i], points[i + 1]], scalePxPerFoot);
              }
              updates.computedLengthFt = totalLen;
            }
            break;
        }

        if (Object.keys(updates).length > 0) {
          await db
            .update(takeoffMeasurements)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(takeoffMeasurements.id, measurement.id));
        }
      } catch (error) {
        console.error(`Error recalculating measurement ${measurement.id}:`, error);
      }
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.patch("/api/takeoff/sheets/batch-calibration", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetIds, scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements } = await import("@shared/schema");

    if (!Array.isArray(sheetIds) || sheetIds.length === 0) {
      res.status(400).json({ error: "sheetIds array is required" });
      return;
    }
    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const skipCalibrated = req.body.skipCalibrated !== false;

    const allowedSheetIds: string[] = [];
    for (const sheetId of sheetIds) {
      const access = await verifySheetAccess(sheetId, req.user!);
      if (access.allowed) allowedSheetIds.push(sheetId);
    }

    const results: (typeof takeoffSheets.$inferSelect)[] = [];
    let updatedCount = 0;
    let skippedCount = 0;

    await db.transaction(async (tx) => {
      for (const sheetId of allowedSheetIds) {
        if (skipCalibrated) {
          const [existing] = await tx
            .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
            .from(takeoffSheets)
            .where(eq(takeoffSheets.id, sheetId))
            .limit(1);
          if (existing?.scalePxPerFoot) {
            skippedCount++;
            continue;
          }
        }

        const [updated] = await tx
          .update(takeoffSheets)
          .set({
            scalePxPerFoot,
            units: units || "ft",
            updatedAt: new Date(),
          })
          .where(eq(takeoffSheets.id, sheetId))
          .returning();

        if (updated) {
          updatedCount++;
          results.push(updated);

          const measurements = await tx
            .select()
            .from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.sheetId, sheetId));

          for (const measurement of measurements) {
            if (!measurement.points) continue;

            const points = safeParsePoints(measurement.points);
            if (!points || points.length === 0) continue;

            const updates: Partial<typeof takeoffMeasurements.$inferInsert> = {};
            try {
              switch (measurement.type) {
                case "LINEAR":
                  if (points.length === 3) {
                    const [start, middle, end] = points;
                    const arcSegment = createArcSegment(start, end, middle, scalePxPerFoot);
                    if (arcSegment) updates.computedLengthFt = arcSegment.arcLength;
                  } else if (points.length >= 2) {
                    updates.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
                  }
                  break;
                case "AREA":
                  if (points.length >= 3) {
                    updates.computedAreaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                  }
                  break;
                case "PITCHED_AREA":
                  if (points.length >= 3) {
                    let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                    if (measurement.pitchRatio) {
                      areaFt2 = computePitchedAreaFt2(areaFt2, measurement.pitchRatio);
                    }
                    updates.computedAreaFt2 = areaFt2;
                  }
                  break;
                case "SURFACE_AREA":
                  if (points.length >= 3) {
                    const surfArea = computePolygonAreaInFt2(points, scalePxPerFoot);
                    updates.computedAreaFt2 = surfArea;
                    updates.computedSurfaceAreaFt2 = surfArea;
                  }
                  break;
                case "VOLUME":
                  if (points.length >= 3 && measurement.depthFeet) {
                    const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                    updates.computedAreaFt2 = areaFt2;
                    updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
                  }
                  break;
                case "SEGMENT":
                  if (points.length >= 2) {
                    let totalLen = 0;
                    for (let si = 0; si < points.length - 1; si++) {
                      totalLen += computeDistanceInFeet([points[si], points[si + 1]], scalePxPerFoot);
                    }
                    updates.computedLengthFt = totalLen;
                  }
                  break;
              }
              if (Object.keys(updates).length > 0) {
                await tx
                  .update(takeoffMeasurements)
                  .set({ ...updates, updatedAt: new Date() })
                  .where(eq(takeoffMeasurements.id, measurement.id));
              }
            } catch (error) {
              console.error(`Error recalculating measurement ${measurement.id}:`, error);
            }
          }
        }
      }
    });

    res.json({ updated: updatedCount, skipped: skippedCount, sheets: results });
  } catch (error) {
    next(error);
  }
});

// Update sheet rotation
router.patch("/api/takeoff/sheets/:id/rotation", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { rotation } = req.body;
    const { takeoffSheets } = await import("@shared/schema");

    const validRotations = [0, 90, 180, 270];
    if (!validRotations.includes(rotation)) {
      res.status(400).json({ error: "Rotation must be 0, 90, 180, or 270" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const [updated] = await db
      .update(takeoffSheets)
      .set({ rotation, updatedAt: new Date() })
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
  next(error);
  }
});

export default router;
