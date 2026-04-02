import { Router, NextFunction } from "express";
import { db } from "./db";
import { bids, takeoffSheets, projects } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { sanitizeShortText } from "./sanitization";
import { createArcSegment } from "@shared/utils/geometry";
import { verifySheetAccess, safeParsePoints, verifyGroupAccess, getActiveDraftVersionId, getDefaultVersionId, hasAnyVersions, isMeasurementLocked } from "./takeoffHelpers";

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

    const versionedSheetIds: string[] = [];
    const unversionedSheetIds: string[] = [];
    const defaultVersionIds: string[] = [];
    for (const s of projectSheets) {
      const vId = await getDefaultVersionId(s.id);
      if (vId) {
        versionedSheetIds.push(s.id);
        defaultVersionIds.push(vId);
      } else {
        unversionedSheetIds.push(s.id);
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

// Get all measurements across all sheets for a bid
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

    const versionedSheetIds: string[] = [];
    const unversionedSheetIds: string[] = [];
    const defaultVersionIds: string[] = [];
    for (const s of bidSheets) {
      const vId = await getDefaultVersionId(s.id);
      if (vId) {
        versionedSheetIds.push(s.id);
        defaultVersionIds.push(vId);
      } else {
        unversionedSheetIds.push(s.id);
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

// Create a new measurement
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
    };

    const validated = insertTakeoffMeasurementSchema.parse({
      ...sanitizedBody,
      sheetId,
      takeoffVersionId: draftVersionId || undefined,
    });

    const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

    res.status(201).json(measurement);
  } catch (error) {
    console.error("Error creating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Update a measurement
router.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements, takeoffSheets, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    const [existingMeasurement] = await db
      .select({ sheetId: takeoffMeasurements.sheetId })
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
    };

    const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

    let finalValues = { ...validated };
    if (validated.points && validated.type === "LINEAR") {
      const sheet = await db
        .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, existingMeasurement.sheetId))
        .limit(1);

      if (sheet && sheet.length > 0 && sheet[0].scalePxPerFoot) {
        const points = safeParsePoints(validated.points);
        
        if (points && points.length === 3) {
          try {
            const [start, middle, end] = points;
            const arcSegment = createArcSegment(start, end, middle, sheet[0].scalePxPerFoot);
            
            if (arcSegment) {
              finalValues = {
                ...validated,
                computedLengthFt: arcSegment.arcLength,
              };
              console.log(`[Arc Measurement Update] Recomputed arc length: ${arcSegment.arcLength.toFixed(2)} LF`);
            }
          } catch (error) {
            console.error("Error computing arc length during update:", error);
          }
        }
      }
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({ ...finalValues, updatedAt: new Date() })
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Create a new measurement (with sheetId in body)
router.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { takeoffMeasurements, takeoffSheets, projects, bids, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

    // SECURITY: Sanitize text inputs for data integrity
    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
    };

    // Convert points array to JSON string if it's an array
    const bodyWithStringifiedPoints = {
      ...sanitizedBody,
      points: Array.isArray(sanitizedBody.points) ? JSON.stringify(sanitizedBody.points) : sanitizedBody.points,
    };

    const draftVersionId = await getActiveDraftVersionId(bodyWithStringifiedPoints.sheetId);
    if (!draftVersionId && await hasAnyVersions(bodyWithStringifiedPoints.sheetId)) {
      res.status(403).json({ error: "Sheet is locked. Create a new version to add measurements." });
      return;
    }
    const validated = insertTakeoffMeasurementSchema.parse({
      ...bodyWithStringifiedPoints,
      takeoffVersionId: draftVersionId || undefined,
    });

    // Validate that the sheet exists (supports both project-based and bid-based sheets)
    const sheetWithProject = await db
      .select({
        sheetId: takeoffSheets.id,
        projectId: takeoffSheets.projectId,
        bidId: takeoffSheets.bidId,
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, validated.sheetId))
      .limit(1);

    if (!sheetWithProject || sheetWithProject.length === 0) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    const sheet = sheetWithProject[0];
    const orgId = req.user!.organizationId;
    const isSuperAdmin = req.user!.role === "SUPER_ADMIN";

    if (!isSuperAdmin) {
      if (sheet.projectId) {
        const [project] = await db.select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
          .from(projects).where(eq(projects.id, sheet.projectId)).limit(1);
        if (!project || project.gcOrganizationId !== orgId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      } else if (sheet.bidId) {
        const [bid] = await db.select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
          .from(bids).where(eq(bids.id, sheet.bidId)).limit(1);
        if (!bid || bid.gcOrganizationId !== orgId) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      } else {
        res.status(404).json({ error: "Sheet has no parent project or bid" });
        return;
      }
    }

    // Additional authorization for non-admin/manager on project-based sheets
    const userRole = req.user!.role;
    if (sheet.projectId && userRole !== "ADMIN" && userRole !== "MANAGER") {
      const userAssignment = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(
          and(
            eq(crewProjectAssignments.projectId, sheet.projectId),
            eq(crewMembers.userId, req.user!.id)
          )
        )
        .limit(1);

      if (!userAssignment || userAssignment.length === 0) {
        res.status(403).json({ error: "You do not have access to this project" });
        return;
      }
    }

    let finalValues = { ...validated };
    if (sheet.scalePxPerFoot) {
      const points = safeParsePoints(validated.points);

      if (validated.type === "LINEAR" && points && points.length === 3) {
        try {
          const [start, middle, end] = points;
          const arcSegment = createArcSegment(start, end, middle, sheet.scalePxPerFoot);
          if (arcSegment) {
            finalValues.computedLengthFt = arcSegment.arcLength;
          }
        } catch (error) {
          console.error("Error computing arc length:", error);
        }
      } else if (validated.type === "LINEAR" && points && points.length >= 2 && !finalValues.computedLengthFt) {
        try {
          const { computeDistanceInFeet } = await import("@shared/utils/geometry");
          finalValues.computedLengthFt = computeDistanceInFeet(points, sheet.scalePxPerFoot);
        } catch (error) {
          console.error("Error computing linear length:", error);
        }
      }

      if ((validated.type === "AREA" || validated.type === "PITCHED_AREA" || validated.type === "SURFACE_AREA") && points && points.length >= 3 && !finalValues.computedAreaFt2) {
        try {
          const { computePolygonAreaInFt2 } = await import("@shared/utils/geometry");
          finalValues.computedAreaFt2 = computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
        } catch (error) {
          console.error("Error computing area:", error);
        }
      }

      if (validated.type === "VOLUME" && points && points.length >= 3 && !finalValues.computedVolumeCy) {
        try {
          const { computePolygonAreaInFt2, computeVolumeInCY } = await import("@shared/utils/geometry");
          const areaFt2 = finalValues.computedAreaFt2 || computePolygonAreaInFt2(points, sheet.scalePxPerFoot);
          if (!finalValues.computedAreaFt2) finalValues.computedAreaFt2 = areaFt2;
          if (validated.depthFeet) {
            finalValues.computedVolumeCy = computeVolumeInCY(areaFt2, validated.depthFeet);
          }
        } catch (error) {
          console.error("Error computing volume:", error);
        }
      }
    }

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues).returning();

    res.status(201).json(measurement);
  } catch (error) {
    console.error("Error creating measurement:", error);
    if (error.name === "ZodError") {
      res.status(400).json({ error: "Invalid measurement data", details: error.errors });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// Delete a measurement
router.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const [existing] = await db
      .select({ sheetId: takeoffMeasurements.sheetId })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Measurement not found" }); return; }

    const locked = await isMeasurementLocked(id);
    if (locked) { res.status(403).json({ error: "Cannot delete a measurement in a locked version" }); return; }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    await db.delete(takeoffMeasurements).where(eq(takeoffMeasurements.id, id));

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

// Update sheet calibration
router.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");
    const { 
      computeDistanceInFeet, 
      computePolygonAreaInFt2, 
      computeVolumeInCY, 
      inchesToFeet 
    } = await import("@shared/utils/geometry");

    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    // Update the calibration
    const [updated] = await db
      .update(takeoffSheets)
      .set({ 
        scalePxPerFoot, 
        units: units || "ft",
        updatedAt: new Date() 
      })
      .where(eq(takeoffSheets.id, id))
      .returning();

    // Recompute all measurements for this sheet with the new scale
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.sheetId, id));

    console.log(`Recalculating ${measurements.length} measurements with new scale: ${scalePxPerFoot} px/ft`);

    for (const measurement of measurements) {
      if (!measurement.points) {
        continue;
      }

      // Parse points from JSON string (Drizzle may auto-parse or leave as string)
      let points: Array<{ x: number; y: number }>;
      try {
        points = typeof measurement.points === 'string' 
          ? JSON.parse(measurement.points) 
          : measurement.points as any;
      } catch (parseError) {
        console.error(`Error parsing points for measurement ${measurement.id}:`, parseError);
        continue;
      }

      // Skip measurements with no points
      if (!points || points.length === 0) {
        continue;
      }

      const updates: any = {};

      try {
        switch (measurement.type) {
          case "LINEAR":
            if (points.length >= 2) {
              const lengthFt = computeDistanceInFeet(points, scalePxPerFoot);
              updates.computedLengthFt = lengthFt;
            }
            break;

          case "AREA":
            if (points.length >= 3) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = areaFt2;
            }
            break;

          case "VOLUME":
            if (points.length >= 3 && measurement.depthFeet) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              const volumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
              updates.computedAreaFt2 = areaFt2;
              updates.computedVolumeCy = volumeCy;
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

          default:
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
        // Continue with other measurements even if one fails
      }
    }

    console.log(`Successfully recalculated ${measurements.length} measurements`);
    res.json(updated);
  } catch (error) {
  next(error);
  }
});

// Batch update calibration for multiple sheets
router.patch("/api/takeoff/sheets/batch-calibration", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetIds, scalePxPerFoot, units } = req.body;
    const { takeoffSheets, takeoffMeasurements, projects } = await import("@shared/schema");
    const {
      computeDistanceInFeet,
      computePolygonAreaInFt2,
      computeVolumeInCY,
    } = await import("@shared/utils/geometry");

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

    const results: any[] = [];
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

            const updates: any = {};
            try {
              switch (measurement.type) {
                case "LINEAR":
                  if (points.length >= 2) {
                    updates.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
                  }
                  break;
                case "AREA":
                  if (points.length >= 3) {
                    updates.computedAreaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
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

    console.log(`Batch calibration: updated ${updatedCount}/${sheetIds.length} sheets, skipped ${skippedCount} already calibrated`);
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
