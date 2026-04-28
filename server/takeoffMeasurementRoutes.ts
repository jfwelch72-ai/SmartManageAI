import { Router, NextFunction } from "express";
import { db } from "./db";
import { bids, takeoffSheets, projects } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z, ZodError } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { sanitizeShortText } from "./sanitization";
import { createArcSegment, computeDistanceInFeet, computePolygonAreaInFt2, computePolygonPerimeterInFt, computeVolumeInCY, computePitchedAreaFt2 } from "@shared/utils/geometry";
import { verifySheetAccess, safeParsePoints, verifyGroupAccess, getActiveDraftVersionId, getDefaultVersionId, getDefaultVersionIdsBatch, hasAnyVersions, isMeasurementLocked } from "./takeoffHelpers";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { logError } from "./utils/logger";
import { recordJobMetrics } from "./utils/jobMetrics";
import { parseOrRespond } from "./utils/validation";

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
    } catch (e) { logError("Error computing arc length:", {}, e instanceof Error ? e : new Error(String(e))); }
  } else if (mType === "LINEAR" && points.length >= 2 && !finalValues.computedLengthFt) {
    try {
      finalValues.computedLengthFt = computeDistanceInFeet(points, scalePxPerFoot);
    } catch (e) { logError("Error computing linear distance:", {}, e instanceof Error ? e : new Error(String(e))); }
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
    } catch (e) { logError("Error computing area:", {}, e instanceof Error ? e : new Error(String(e))); }
  }

  if (mType === "VOLUME" && points.length >= 3 && !finalValues.computedVolumeCy) {
    try {
      const areaFt2 = (finalValues.computedAreaFt2 as number) || computePolygonAreaInFt2(points, scalePxPerFoot);
      if (!finalValues.computedAreaFt2) finalValues.computedAreaFt2 = areaFt2;
      if (validated.depthFeet) {
        finalValues.computedVolumeCy = computeVolumeInCY(areaFt2, validated.depthFeet as number);
      }
    } catch (e) { logError("Error computing volume:", {}, e instanceof Error ? e : new Error(String(e))); }
  }

  if (["AREA", "PITCHED_AREA", "SURFACE_AREA", "VOLUME"].includes(mType) && points.length >= 3) {
    try {
      const perimeterFt = computePolygonPerimeterInFt(points, scalePxPerFoot);
      const existingMeta: Record<string, unknown> = (() => {
        try {
          const raw = validated.metadata;
          if (!raw) return {};
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch { return {}; }
      })();
      finalValues.metadata = JSON.stringify({ ...existingMeta, perimeterFt });
    } catch (e) { logError("Error computing perimeter:", {}, e instanceof Error ? e : new Error(String(e))); }
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

    const validated = parseOrRespond(insertTakeoffMeasurementSchema, {
      ...sanitizedBody,
      sheetId,
      takeoffVersionId: draftVersionId || undefined,
    }, res);
    if (!validated) return;

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

// Task #1989 — Bulk PATCH for editing N takeoff measurements in a
// single round-trip. Mirrors the markup-side `/api/takeoff/markups/bulk`
// (Task #1752 / #1765 / #1768) so a 50-measurement category re-assign
// from `handleBulkCategoryAssign` collapses into one HTTP request and
// one cache invalidation instead of fanning out N parallel per-id
// PATCHes (each one its own audit-log entry and its own
// `queryClient.invalidateQueries` refetch flicker). All updates run
// inside a single transaction so a partial failure either commits
// everything or nothing.
//
// Failure responses mirror the markup bulk endpoint's structured
// shape so the existing `extractMeasurementNotFoundIds` /
// `pruneDeletedMeasurements` helpers (Task #1970) plug in unchanged
// on the client:
//   - 404 not_found (with `failedMeasurementIds` listing the missing
//     ids and a `failuresByReason` array carrying the same shape)
//   - 403 access_denied (sheet not visible to the caller's tenant)
//   - 403 locked (one or more rows belong to a LOCKED version)
//   - 400 cross_sheet (payload mixed measurements from multiple
//     sheets — every caller operates inside one sheet by definition,
//     so refusing the request guards against malformed payloads
//     silently mutating measurements on unrelated sheets)
//   - 400 validation (with `failedMeasurementIds` mapped from the
//     offending Zod issue indices)
//
// Unlike the per-id PATCH below this endpoint does NOT recompute
// geometry or write audit-log entries per row: every caller today is
// a metadata edit (label / categoryId / costCodeId / unitCost /
// groupId / styling) where points and depth are unchanged, and the
// bulk path is explicitly the "skip the N audit entries" alternative
// to the fan-out per the task description. Callers that need
// geometry recomputes still go through the per-id PATCH.
//
// Route MUST be registered before `/api/takeoff/measurements/:id`
// or Express will route "bulk" into `:id` and 404.
router.patch("/api/takeoff/measurements/bulk", requireAuth, async (req: AuthRequest, res, next) => {
  const startedAt = Date.now();
  let batchCount = 0;
  try {
    const { takeoffMeasurements, takeoffVersions } = await import("@shared/schema");

    const bulkSchema = z.object({
      updates: z
        .array(
          z
            .object({
              id: z.string().min(1),
              label: z.string().optional(),
              categoryId: z.string().nullable().optional(),
              costCodeId: z.string().nullable().optional(),
              unitCost: z.number().nullable().optional(),
              groupId: z.string().nullable().optional(),
              lineStyle: z.string().optional(),
              lineWidth: z.number().int().min(1).max(64).optional(),
              metadata: z.string().optional(),
              color: z.string().optional(),
              note: z.string().nullable().optional(),
              locationId: z.string().nullable().optional(),
            })
            .refine(
              (u) =>
                u.label !== undefined ||
                u.categoryId !== undefined ||
                u.costCodeId !== undefined ||
                u.unitCost !== undefined ||
                u.groupId !== undefined ||
                u.lineStyle !== undefined ||
                u.lineWidth !== undefined ||
                u.metadata !== undefined ||
                u.color !== undefined ||
                u.note !== undefined ||
                u.locationId !== undefined,
              { message: "Each update must include at least one editable field" },
            ),
        )
        .min(1)
        .max(500),
    });

    const validated = parseOrRespond(bulkSchema, req.body, res);
    if (!validated) return;
    batchCount = validated.updates.length;
    const ids = validated.updates.map((u) => u.id);

    const rows = await db
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.id, ids));

    // Mirror the markup endpoint's "name every offending id" behavior
    // so the client toast can call out exactly which siblings are gone
    // instead of leaving the user to retry the whole batch blind.
    if (rows.length !== ids.length) {
      const present = new Set(rows.map((r) => r.id));
      const missing = ids.filter((id) => !present.has(id));
      recordJobMetrics("takeoff_measurements_bulk_update", {
        error: 1,
        count: batchCount,
        ms: Date.now() - startedAt,
      });
      res.status(404).json({
        error: "Some measurements could not be updated because they no longer exist",
        reason: "not_found",
        failedMeasurementIds: missing,
        failuresByReason: [
          {
            reason: "not_found",
            failedMeasurementIds: missing,
            message: "Some measurements could not be updated because they no longer exist",
          },
        ],
      });
      return;
    }

    // Same-sheet enforcement — every caller (bulk category / cost-code
    // re-assign) operates inside one sheet by definition, so refusing
    // mixed-sheet payloads guards against a malformed request silently
    // mutating measurements on unrelated sheets.
    const firstSheetId = rows[0].sheetId;
    const crossSheet: string[] = [];
    for (const r of rows) {
      if (r.sheetId !== firstSheetId) crossSheet.push(r.id);
    }

    // Sheet access check fans out the per-id `verifySheetAccess` /
    // org-isolation guard the per-id PATCH does, but only once: every
    // row shares the same sheet, so cross-tenant requests are caught
    // up front before the transaction opens.
    const sheetAccess = await verifySheetAccess(firstSheetId, req.user!);
    if (!sheetAccess.allowed) {
      recordJobMetrics("takeoff_measurements_bulk_update", {
        error: 1,
        count: batchCount,
        ms: Date.now() - startedAt,
      });
      const status = sheetAccess.sheet ? 403 : 404;
      const reason: "access_denied" | "not_found" = sheetAccess.sheet ? "access_denied" : "not_found";
      const message = sheetAccess.reason || "Access denied";
      res.status(status).json({
        error: message,
        reason,
        failedMeasurementIds: ids,
        failuresByReason: [{ reason, failedMeasurementIds: ids, message }],
      });
      return;
    }

    // Locked-version enforcement — mirror the per-id PATCH's
    // `isMeasurementLocked` check but in one query for the whole
    // batch so a 50-row request doesn't fan out 50 lookups.
    const versionIds = Array.from(
      new Set(rows.map((r) => r.takeoffVersionId).filter((v): v is string => !!v)),
    );
    const locked: string[] = [];
    if (versionIds.length > 0) {
      const lockedVersions = await db
        .select({ id: takeoffVersions.id })
        .from(takeoffVersions)
        .where(and(inArray(takeoffVersions.id, versionIds), eq(takeoffVersions.status, "LOCKED")));
      const lockedSet = new Set(lockedVersions.map((v) => v.id));
      for (const r of rows) {
        if (r.takeoffVersionId && lockedSet.has(r.takeoffVersionId)) {
          locked.push(r.id);
        }
      }
    }

    // Mirror the markup bulk endpoint's mixed-reason aggregation so
    // the client toast can call out every cause separately instead of
    // surfacing only the first non-empty bucket. The legacy flat
    // `failedMeasurementIds` is preserved (union of all groups) so the
    // existing `extractMeasurementNotFoundIds` extractor and the
    // workspace selection prune still work unchanged.
    const groups: Array<{
      reason: "cross_sheet" | "locked";
      ids: string[];
      message: string;
    }> = [];
    if (crossSheet.length > 0) {
      groups.push({
        reason: "cross_sheet",
        ids: crossSheet,
        message: "Some measurements belong to a different sheet and were not updated",
      });
    }
    if (locked.length > 0) {
      groups.push({
        reason: "locked",
        ids: locked,
        message: "Some measurements belong to a locked version and were not updated",
      });
    }
    if (groups.length > 0) {
      const allFailed = Array.from(new Set(groups.flatMap((g) => g.ids)));
      const status = groups.some((g) => g.reason === "locked") ? 403 : 400;
      const dominant = groups.reduce((acc, g) =>
        g.ids.length > acc.ids.length ? g : acc,
      );
      recordJobMetrics("takeoff_measurements_bulk_update", {
        error: 1,
        count: batchCount,
        ms: Date.now() - startedAt,
      });
      res.status(status).json({
        error: groups.map((g) => g.message).join("; "),
        reason: dominant.reason,
        failedMeasurementIds: allFailed,
        failuresByReason: groups.map((g) => ({
          reason: g.reason,
          failedMeasurementIds: g.ids,
          message: g.message,
        })),
      });
      return;
    }

    // Apply all updates inside a single transaction so a mid-batch
    // failure rolls back atomically — no half-applied category
    // re-assign that the user can't see and can't undo.
    const updated = await db.transaction(async (tx) => {
      const out: typeof rows = [];
      for (const u of validated.updates) {
        const setPayload: Record<string, unknown> = { updatedAt: new Date() };
        if (u.label !== undefined) {
          // sanitizeShortText returns undefined for empty input — match
          // the per-id PATCH behavior of leaving the existing label
          // untouched in that case (the validator already rejected the
          // empty payload at the schema level if no other field was set).
          const sanitized = sanitizeShortText(u.label);
          if (sanitized !== undefined) setPayload.label = sanitized;
        }
        if (u.categoryId !== undefined) setPayload.categoryId = u.categoryId;
        if (u.costCodeId !== undefined) setPayload.costCodeId = u.costCodeId;
        if (u.unitCost !== undefined) setPayload.unitCost = u.unitCost;
        if (u.groupId !== undefined) setPayload.groupId = u.groupId;
        if (u.lineStyle !== undefined) setPayload.lineStyle = u.lineStyle;
        if (u.lineWidth !== undefined) setPayload.lineWidth = u.lineWidth;
        if (u.metadata !== undefined) setPayload.metadata = u.metadata;
        if (u.color !== undefined) setPayload.color = u.color;
        if (u.note !== undefined) setPayload.note = u.note;
        if (u.locationId !== undefined) setPayload.locationId = u.locationId;

        const [row] = await tx
          .update(takeoffMeasurements)
          .set(setPayload)
          .where(eq(takeoffMeasurements.id, u.id))
          .returning();
        if (row) out.push(row);
      }
      return out;
    });

    recordJobMetrics("takeoff_measurements_bulk_update", {
      ok: 1,
      count: batchCount,
      ms: Date.now() - startedAt,
    });
    res.json(
      updated.map((r) => ({
        ...r,
        points: safeParsePoints(r.points) || [],
      })),
    );
  } catch (error: unknown) {
    recordJobMetrics("takeoff_measurements_bulk_update", {
      error: 1,
      count: batchCount,
      ms: Date.now() - startedAt,
    });
    logError(
      "Error bulk-updating measurements:",
      {},
      error instanceof Error ? error : new Error(String(error)),
    );
    if (error instanceof ZodError) {
      // Map each Zod issue's `["updates", N, ...]` path back to the
      // measurement id the caller submitted so the client toast can
      // name + flash the offending rows. Mirrors the markup bulk
      // endpoint's validation failure shape for consistency.
      const submittedUpdates: Array<{ id?: unknown }> = Array.isArray(req.body?.updates)
        ? req.body.updates
        : [];
      const failedIndices = new Set<number>();
      for (const issue of error.errors) {
        const path = Array.isArray(issue.path) ? issue.path : [];
        if (path[0] === "updates" && typeof path[1] === "number") {
          failedIndices.add(path[1]);
        }
      }
      const failedMeasurementIds = Array.from(failedIndices)
        .map((i) => submittedUpdates[i]?.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      res.status(400).json({
        error: "Invalid bulk patch",
        reason: "validation",
        failedMeasurementIds,
        details: error.errors,
      });
      return;
    }
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
    if (!existingMeasurement) {
      // Task #1970 — Mirror the markup PATCH's structured 404 shape
      // (Task #1768) so the client onError handler can drop the
      // deleted id out of the cached measurements list and the
      // workspace selection set instead of restoring a phantom that
      // will keep failing until the user manually refreshes.
      res.status(404).json({
        error: "Measurement not found — it may have been deleted",
        reason: "not_found",
        failedMeasurementIds: [id],
      });
      return;
    }

    const locked = await isMeasurementLocked(id);
    if (locked) { res.status(403).json({ error: "Cannot edit a measurement in a locked version" }); return; }

    const access = await verifySheetAccess(existingMeasurement.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const sanitizedBody = {
      ...req.body,
      label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      points: Array.isArray(req.body.points) ? JSON.stringify(req.body.points) : req.body.points,
    };

    const validated = parseOrRespond(insertTakeoffMeasurementSchema.partial(), sanitizedBody, res);
    if (!validated) return;

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
            .select({ points: takeoffMeasurements.points, depthFeet: takeoffMeasurements.depthFeet, pitchRatio: takeoffMeasurements.pitchRatio, metadata: takeoffMeasurements.metadata })
            .from(takeoffMeasurements)
            .where(eq(takeoffMeasurements.id, id))
            .limit(1);
          if (full) {
            pointsForCompute = full.points;
            if (validated.depthFeet === undefined && full.depthFeet) finalValues.depthFeet = full.depthFeet;
            if (validated.pitchRatio === undefined && full.pitchRatio) finalValues.pitchRatio = full.pitchRatio;
            if (!validated.metadata && full.metadata) finalValues.metadata = full.metadata;
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

    const validated = parseOrRespond(insertTakeoffMeasurementSchema, {
      ...sanitizedBody,
      takeoffVersionId: draftVersionId || undefined,
    }, res);
    if (!validated) return;

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

router.post("/api/takeoff/measurements/:id/auto-import", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements, takeoffSheets: sheetsTable, estimates, estimateLineItems } = await import("@shared/schema");

    const [measurement] = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!measurement) { res.status(404).json({ error: "Measurement not found" }); return; }

    const access = await verifySheetAccess(measurement.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const [sheet] = await db
      .select({ bidId: sheetsTable.bidId, projectId: sheetsTable.projectId })
      .from(sheetsTable)
      .where(eq(sheetsTable.id, measurement.sheetId))
      .limit(1);
    if (!sheet) { res.status(404).json({ error: "Sheet not found" }); return; }

    const contextId = sheet.bidId || sheet.projectId;
    if (!contextId) { res.status(400).json({ error: "Sheet has no bid or project association" }); return; }

    const estimateCondition = sheet.bidId
      ? eq(estimates.bidId, sheet.bidId)
      : eq(estimates.projectId, sheet.projectId!);
    const [estimate] = await db
      .select({ id: estimates.id })
      .from(estimates)
      .where(estimateCondition)
      .limit(1);

    if (!estimate) {
      res.json({ skipped: true, reason: "No estimate exists yet" });
      return;
    }

    let quantity = 0;
    let unit = "EA";
    let description = measurement.label || "Takeoff Measurement";
    const mType = measurement.type as string;

    if (mType === "LINEAR" || mType === "LINEAR_WITH_DROP" || mType === "PITCHED_LINEAR" || mType === "SEGMENT") {
      quantity = Number(measurement.computedLengthFt) || 0;
      unit = "LF";
      description = measurement.label || `${mType === "SEGMENT" ? "Segment" : "Linear"} Measurement`;
    } else if (mType === "AREA" || mType === "PITCHED_AREA" || mType === "SURFACE_AREA") {
      quantity = Number(measurement.computedAreaFt2) || 0;
      unit = "SF";
      description = measurement.label || `${mType === "PITCHED_AREA" ? "Pitched Area" : mType === "SURFACE_AREA" ? "Surface Area" : "Area"} Measurement`;
    } else if (mType === "VOLUME") {
      quantity = Number(measurement.computedVolumeCy) || 0;
      unit = "CY";
      description = measurement.label || "Volume Measurement";
    } else if (mType === "COUNT") {
      quantity = measurement.count ?? 1;
      unit = "EA";
      description = measurement.label || "Count Measurement";
    }

    if (quantity <= 0) {
      res.json({ skipped: true, reason: "Measurement has no computed quantity" });
      return;
    }

    const materialCost = quantity * (Number(measurement.unitCost) || 0);

    const result = await db.transaction(async (tx) => {
      const existingItems = await tx
        .select({ metadata: estimateLineItems.metadata })
        .from(estimateLineItems)
        .where(and(
          eq(estimateLineItems.estimateId, estimate.id),
          eq(estimateLineItems.source, "TAKEOFF"),
        ));
      for (const li of existingItems) {
        try {
          const meta = typeof li.metadata === 'string' ? JSON.parse(li.metadata) : (li.metadata || {});
          if (Array.isArray(meta.sourceMeasurementIds) && meta.sourceMeasurementIds.includes(id)) {
            return { skipped: true as const, reason: "Measurement already imported" };
          }
        } catch {}
      }

      const [lineItem] = await tx.insert(estimateLineItems).values({
        estimateId: estimate.id,
        category: "GENERAL",
        description,
        quantity: quantity.toFixed(2),
        unit,
        source: "TAKEOFF",
        materialCost: materialCost.toFixed(2),
        laborHours: "0",
        laborCost: "0",
        equipmentCost: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
        totalCost: materialCost.toFixed(2),
        computedQuantity: quantity.toFixed(2),
        metadata: JSON.stringify({
          sourceMeasurementIds: [id],
          autoImported: true,
        }),
      }).returning();

      return { lineItem, autoImported: true as const };
    });

    if ('skipped' in result) {
      res.json(result);
      return;
    }

    await logCreate(req.user!.id, "estimate_line_item", result.lineItem.id, {
      autoImported: true,
      measurementId: id,
      description,
      quantity: quantity.toFixed(2),
      unit,
    }, req);

    res.status(201).json(result);
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
    if (!existing) {
      // Task #1988 — Mirror the PATCH endpoint's structured 404 shape
      // (Task #1970) so the client onError handler on the per-id and
      // bulk DELETE paths can drop the deleted id out of the cached
      // measurements list and the workspace selection set instead of
      // restoring a teammate-deleted row from the optimistic-rollback
      // snapshot. Without this, a mid-bulk teammate delete left a
      // phantom row on the canvas until the user manually refreshed.
      res.status(404).json({
        error: "Measurement not found — it may have been deleted",
        reason: "not_found",
        failedMeasurementIds: [id],
      });
      return;
    }

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

    const { scaleLabel } = req.body;
    const [updated] = await db
      .update(takeoffSheets)
      .set({ 
        scalePxPerFoot, 
        units: units || "ft",
        scaleLabel: scaleLabel || null,
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
              const perimA = computePolygonPerimeterInFt(points, scalePxPerFoot);
              const metaA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
              updates.metadata = JSON.stringify({ ...metaA, perimeterFt: perimA });
            }
            break;

          case "PITCHED_AREA":
            if (points.length >= 3) {
              let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              if (measurement.pitchRatio) {
                areaFt2 = computePitchedAreaFt2(areaFt2, measurement.pitchRatio);
              }
              updates.computedAreaFt2 = areaFt2;
              const perimPA = computePolygonPerimeterInFt(points, scalePxPerFoot);
              const metaPA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
              updates.metadata = JSON.stringify({ ...metaPA, perimeterFt: perimPA });
            }
            break;

          case "SURFACE_AREA":
            if (points.length >= 3) {
              const surfArea = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = surfArea;
              updates.computedSurfaceAreaFt2 = surfArea;
              const perimSA = computePolygonPerimeterInFt(points, scalePxPerFoot);
              const metaSA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
              updates.metadata = JSON.stringify({ ...metaSA, perimeterFt: perimSA });
            }
            break;

          case "VOLUME":
            if (points.length >= 3 && measurement.depthFeet) {
              const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
              updates.computedAreaFt2 = areaFt2;
              updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
              const perimV = computePolygonPerimeterInFt(points, scalePxPerFoot);
              const metaV: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
              updates.metadata = JSON.stringify({ ...metaV, perimeterFt: perimV });
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
        logError(`Error recalculating measurement ${measurement.id}:`, {}, error instanceof Error ? error : new Error(String(error)));
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
                    const bPerimA = computePolygonPerimeterInFt(points, scalePxPerFoot);
                    const bMetaA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
                    updates.metadata = JSON.stringify({ ...bMetaA, perimeterFt: bPerimA });
                  }
                  break;
                case "PITCHED_AREA":
                  if (points.length >= 3) {
                    let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                    if (measurement.pitchRatio) {
                      areaFt2 = computePitchedAreaFt2(areaFt2, measurement.pitchRatio);
                    }
                    updates.computedAreaFt2 = areaFt2;
                    const bPerimPA = computePolygonPerimeterInFt(points, scalePxPerFoot);
                    const bMetaPA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
                    updates.metadata = JSON.stringify({ ...bMetaPA, perimeterFt: bPerimPA });
                  }
                  break;
                case "SURFACE_AREA":
                  if (points.length >= 3) {
                    const surfArea = computePolygonAreaInFt2(points, scalePxPerFoot);
                    updates.computedAreaFt2 = surfArea;
                    updates.computedSurfaceAreaFt2 = surfArea;
                    const bPerimSA = computePolygonPerimeterInFt(points, scalePxPerFoot);
                    const bMetaSA: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
                    updates.metadata = JSON.stringify({ ...bMetaSA, perimeterFt: bPerimSA });
                  }
                  break;
                case "VOLUME":
                  if (points.length >= 3 && measurement.depthFeet) {
                    const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
                    updates.computedAreaFt2 = areaFt2;
                    updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
                    const bPerimV = computePolygonPerimeterInFt(points, scalePxPerFoot);
                    const bMetaV: Record<string, unknown> = (() => { try { return measurement.metadata ? (typeof measurement.metadata === "string" ? JSON.parse(measurement.metadata) : measurement.metadata) as Record<string, unknown> : {}; } catch { return {}; } })();
                    updates.metadata = JSON.stringify({ ...bMetaV, perimeterFt: bPerimV });
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
              logError(`Error recalculating measurement ${measurement.id}:`, {}, error instanceof Error ? error : new Error(String(error)));
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

router.patch("/api/takeoff/sheets/:id/assignment", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { assignedTo, completionStatus, targetMeasurements } = req.body;
    const { takeoffSheets } = await import("@shared/schema");

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const updates: any = { updatedAt: new Date() };
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;
    if (completionStatus !== undefined) updates.completionStatus = completionStatus;
    if (targetMeasurements !== undefined) updates.targetMeasurements = targetMeasurements;

    const [updated] = await db
      .update(takeoffSheets)
      .set(updates)
      .where(eq(takeoffSheets.id, id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
