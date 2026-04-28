import { Router, NextFunction } from "express";
import { db } from "./db";
import {
  bids,
  takeoffSheets,
  projects,
  takeoffMeasurements,
  users,
  organizations,
  MEASUREMENT_NEEDS_REVIEW_DEFAULT_VALUE_THRESHOLD,
  MEASUREMENT_NEEDS_REVIEW_SNAP_RATIO_THRESHOLD,
} from "@shared/schema";
import { eq, and, inArray, isNull, isNotNull, sql, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z, ZodError } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { sanitizeShortText } from "./sanitization";
import { createArcSegment, computeDistanceInFeet, computePolygonAreaInFt2, computePolygonPerimeterInFt, computeVolumeInCY, computePitchedAreaFt2 } from "@shared/utils/geometry";
import { verifySheetAccess, safeParsePoints, verifyGroupAccess, getActiveDraftVersionId, getDefaultVersionId, getDefaultVersionIdsBatch, hasAnyVersions, isMeasurementLocked } from "./takeoffHelpers";
import { logAudit, logCreate, logUpdate, logDelete } from "./auditLogger";
import { logError } from "./utils/logger";
import { recordJobMetrics } from "./utils/jobMetrics";
import { parseOrRespond } from "./utils/validation";
import { notifyUsers, getApproverUserIds } from "./services/approvalNotificationService";

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

// Task #2319 — Provenance helper. Stamps the immutable
// `scale_at_capture_*` snapshot from the sheet (so a later
// re-calibration leaves historical quantities untouched), normalizes
// the calibration source, and applies the server-side `needs_review`
// rule. The rule is a server-side guarantee: the client cannot opt out
// by omitting the field, because the four flip conditions
// (uncalibrated capture, AI source, low snap, high $ value) are all
// re-derived from authoritative inputs (sheet scale, payload source,
// payload snapHitRatio, sheet→bid→org threshold) before insert.
async function applyProvenanceForInsert(
  validated: Record<string, unknown>,
  sheet: { scalePxPerFoot: number | null; scaleLabel: string | null; bidId: string | null; projectId: string | null },
): Promise<Record<string, unknown>> {
  const next: Record<string, unknown> = { ...validated };

  // Snapshot the sheet's scale onto the row at insert time. Once
  // stamped, these two columns are immutable for the lifetime of the
  // measurement (PATCH strips them, the calibration endpoint skips
  // them) so historical rows always know what scale they were captured
  // against.
  if (next.scaleAtCapturePxPerFoot == null && sheet.scalePxPerFoot != null) {
    next.scaleAtCapturePxPerFoot = sheet.scalePxPerFoot;
  }
  if (next.scaleAtCaptureLabel == null && sheet.scaleLabel) {
    next.scaleAtCaptureLabel = sheet.scaleLabel;
  }

  // Default the calibration source explicitly when callers omit it so
  // the server, not the db default, owns this decision. UNCALIBRATED
  // when there's no scale to stamp; otherwise USER_TWO_POINT (the
  // current calibration UX). AI/STANDARD_SCALE values are accepted
  // verbatim from the client and re-validated by the zod enum.
  if (!next.calibrationSource) {
    next.calibrationSource = sheet.scalePxPerFoot != null ? "USER_TWO_POINT" : "UNCALIBRATED";
  }

  // Resolve the org's $-value threshold for needs_review via the
  // gcOrganizationId column on whichever owning entity the sheet
  // hangs off (bids and projects each carry their own gcOrganizationId;
  // there's no FK chain between them that we can rely on for sheets
  // created against a bid that hasn't been converted to a project
  // yet). Falls back to the plan-level constant for orphan sheets
  // used in tests/demos.
  let orgThreshold = MEASUREMENT_NEEDS_REVIEW_DEFAULT_VALUE_THRESHOLD;
  let ownerOrgId: string | null = null;
  if (sheet.bidId) {
    const [bidRow] = await db
      .select({ orgId: bids.gcOrganizationId })
      .from(bids)
      .where(eq(bids.id, sheet.bidId))
      .limit(1);
    ownerOrgId = bidRow?.orgId ?? null;
  } else if (sheet.projectId) {
    const [projectRow] = await db
      .select({ orgId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, sheet.projectId))
      .limit(1);
    ownerOrgId = projectRow?.orgId ?? null;
  }
  if (ownerOrgId) {
    const [orgRow] = await db
      .select({ threshold: organizations.takeoffReviewValueThreshold })
      .from(organizations)
      .where(eq(organizations.id, ownerOrgId))
      .limit(1);
    if (orgRow?.threshold) {
      const parsed = Number(orgRow.threshold);
      if (Number.isFinite(parsed) && parsed > 0) orgThreshold = parsed;
    }
  }

  // The four needs_review conditions. Any one flips the flag — the
  // review queue (out of scope for this task) will surface them later.
  const calibrationSource = next.calibrationSource as string;
  const isUncalibrated = calibrationSource === "UNCALIBRATED" || next.scaleAtCapturePxPerFoot == null;
  const isAIDetected = calibrationSource === "AI_DETECTED" || next.source === "AI";
  const snapRatio = typeof next.snapHitRatio === "number" ? next.snapHitRatio : null;
  // Low snap only triggers when we actually have a snap signal; a
  // null ratio (e.g. count measurements with one click, or legacy
  // clients that haven't shipped the snap log yet) is not a flip.
  const isLowSnap = snapRatio != null && snapRatio < MEASUREMENT_NEEDS_REVIEW_SNAP_RATIO_THRESHOLD;
  const totalCost = (() => {
    const unit = Number(next.unitCost ?? 0);
    if (!Number.isFinite(unit) || unit <= 0) return 0;
    // Use whichever quantity column the row populated; we don't try to
    // recompute geometry here because that ran upstream.
    const qty =
      Number(next.computedAreaFt2 ?? 0) ||
      Number(next.computedLengthFt ?? 0) ||
      Number(next.computedVolumeCy ?? 0) ||
      Number(next.count ?? 0);
    return unit * qty;
  })();
  const isHighValue = totalCost > orgThreshold;

  if (isUncalibrated || isAIDetected || isLowSnap || isHighValue) {
    next.needsReview = true;
  }

  return next;
}

// Task #2334 — Per-measurement recompute helper. Extracted so both the
// sheet-level re-calibration loop (rescale branch) and the new
// per-row "Unlock & rescale" endpoint use the exact same per-type
// formula. Returns the partial update dict (computed length / area /
// volume / surface area + metadata.perimeterFt) for one row at the
// supplied target scale, or `null` when the row carries no usable
// points. Intentionally has no side-effects: callers persist the
// updates with `db.update(...)` so they can wrap their own audit/log
// behaviour around it.
function computeMeasurementRescaleUpdates(
  measurement: {
    type: string;
    points: string | null;
    depthFeet: number | null;
    pitchRatio: string | null;
    metadata: string | null;
  },
  scalePxPerFoot: number,
): Partial<{
  computedLengthFt: number;
  computedAreaFt2: number;
  computedVolumeCy: number;
  computedSurfaceAreaFt2: number;
  metadata: string;
}> | null {
  if (!measurement.points) return null;
  const points = safeParsePoints(measurement.points);
  if (!points || points.length === 0) return null;

  const updates: Partial<{
    computedLengthFt: number;
    computedAreaFt2: number;
    computedVolumeCy: number;
    computedSurfaceAreaFt2: number;
    metadata: string;
  }> = {};

  const mergePerimeterIntoMetadata = (perimeterFt: number) => {
    const existing: Record<string, unknown> = (() => {
      try {
        return measurement.metadata
          ? (typeof measurement.metadata === "string"
              ? JSON.parse(measurement.metadata)
              : measurement.metadata) as Record<string, unknown>
          : {};
      } catch {
        return {};
      }
    })();
    updates.metadata = JSON.stringify({ ...existing, perimeterFt });
  };

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
        mergePerimeterIntoMetadata(computePolygonPerimeterInFt(points, scalePxPerFoot));
      }
      break;

    case "PITCHED_AREA":
      if (points.length >= 3) {
        let areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
        if (measurement.pitchRatio) {
          areaFt2 = computePitchedAreaFt2(areaFt2, measurement.pitchRatio);
        }
        updates.computedAreaFt2 = areaFt2;
        mergePerimeterIntoMetadata(computePolygonPerimeterInFt(points, scalePxPerFoot));
      }
      break;

    case "SURFACE_AREA":
      if (points.length >= 3) {
        const surfArea = computePolygonAreaInFt2(points, scalePxPerFoot);
        updates.computedAreaFt2 = surfArea;
        updates.computedSurfaceAreaFt2 = surfArea;
        mergePerimeterIntoMetadata(computePolygonPerimeterInFt(points, scalePxPerFoot));
      }
      break;

    case "VOLUME":
      if (points.length >= 3 && measurement.depthFeet) {
        const areaFt2 = computePolygonAreaInFt2(points, scalePxPerFoot);
        updates.computedAreaFt2 = areaFt2;
        updates.computedVolumeCy = computeVolumeInCY(areaFt2, measurement.depthFeet);
        mergePerimeterIntoMetadata(computePolygonPerimeterInFt(points, scalePxPerFoot));
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

  return updates;
}

async function computeMeasurementGeometry(
  validated: Record<string, unknown>,
  scalePxPerFoot: number | null,
): Promise<Record<string, unknown>> {
  const finalValues = { ...validated };
  // Task #2319 — provenance: when the row carries an immutable
  // `scale_at_capture_px_per_foot` snapshot, every quantity computation
  // for this measurement uses the captured scale instead of the live
  // sheet scale. This is what makes a sheet-level re-calibration leave
  // historical quantities untouched even though every row still
  // references the same `sheet_id`.
  const captureScale = typeof finalValues.scaleAtCapturePxPerFoot === "number"
    ? finalValues.scaleAtCapturePxPerFoot
    : null;
  const effectiveScale = captureScale ?? scalePxPerFoot;
  if (!effectiveScale) return finalValues;

  const points = safeParsePoints(validated.points);
  if (!points || points.length === 0) return finalValues;

  const mType = validated.type as string;
  // Re-bind for the closures below so the rest of the function reads
  // unchanged. Captured-scale rows compute against the snapshot;
  // legacy rows compute against the live sheet scale.
  scalePxPerFoot = effectiveScale;

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
      .select({
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        scaleLabel: takeoffSheets.scaleLabel,
        bidId: takeoffSheets.bidId,
        projectId: takeoffSheets.projectId,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, sheetId))
      .limit(1);

    // Task #2319 — provenance must run BEFORE geometry so the captured
    // scale (snapshotted from the sheet here) is what geometry uses.
    // Also enables the needs_review rule to see the unit/qty produced
    // by geometry below for the high-$ check.
    const provenanced = await applyProvenanceForInsert(validated, {
      scalePxPerFoot: sheet?.scalePxPerFoot ?? null,
      scaleLabel: sheet?.scaleLabel ?? null,
      bidId: sheet?.bidId ?? null,
      projectId: sheet?.projectId ?? null,
    });
    const computed = await computeMeasurementGeometry(provenanced, sheet?.scalePxPerFoot ?? null);
    // Re-run the high-$ check now that geometry has populated quantity
    // columns. Cheaper than a second full provenance pass and only
    // adds the one rule that depends on computed values.
    const finalValues = await applyProvenanceForInsert(computed, {
      scalePxPerFoot: sheet?.scalePxPerFoot ?? null,
      scaleLabel: sheet?.scaleLabel ?? null,
      bidId: sheet?.bidId ?? null,
      projectId: sheet?.projectId ?? null,
    });

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues as typeof takeoffMeasurements.$inferInsert).returning();

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

// Task #2334 — Per-row "Unlock & rescale" endpoint. Released from the
// `lockedScalePxPerFoot` snapshot a user opted into during a previous
// re-calibration's lock branch (Task #2326), and re-derives the row's
// `computedLengthFt` / `computedAreaFt2` / `computedVolumeCy` against
// the sheet's CURRENT `scalePxPerFoot`. Without this endpoint a
// mistakenly-locked row could only be released by deleting and re-
// drawing it; the lock is intentionally sticky against subsequent
// sheet recalibrations (the rescale loop above skips locked rows on
// every recalibration), so the only way back to "track the sheet
// scale" was a destructive redraw.
//
// Auth gating mirrors the per-id PATCH below: `verifySheetAccess`
// covers tenant + role checks (ESTIMATOR / MANAGER / ADMIN +
// crew-assigned roles, blocking VIEWER through the same access path),
// and `isMeasurementLocked` blocks edits to rows in a locked version
// — those rows are immutable for everyone, so an unlock here would be
// silently un-doable on the next legitimate edit attempt anyway.
//
// Behaviour notes:
//   - 404 (structured): row already gone (teammate-deleted), client
//     prunes from cache via the same not_found path used for PATCH.
//   - 403 locked-version: row belongs to a LOCKED takeoff version.
//   - 200 no-op: row is not currently locked. The endpoint is
//     idempotent so a double-click can't create a 4xx; we just return
//     the row unchanged with `unlocked: false` so the client toast
//     can decide whether to celebrate.
//   - 400 no-scale: sheet has no `scalePxPerFoot`. Without a target
//     scale there is no meaningful recompute to perform, and we'd
//     end up with a row whose computed* values silently went stale
//     — refuse loudly and ask the user to calibrate first.
router.post("/api/takeoff/measurements/:id/unlock-rescale", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements, takeoffSheets } = await import("@shared/schema");

    const [existing] = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) {
      // Mirror the structured 404 the per-id PATCH uses (Task #1970)
      // so the client `extractMeasurementNotFoundIds` helper can
      // prune the row out of the cache and the workspace selection.
      res.status(404).json({
        error: "Measurement not found — it may have been deleted",
        reason: "not_found",
        failedMeasurementIds: [id],
      });
      return;
    }

    const locked = await isMeasurementLocked(id);
    if (locked) {
      res.status(403).json({ error: "Cannot unlock a measurement in a locked version" });
      return;
    }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" });
      return;
    }

    // Idempotent no-op when the row isn't locked. We return the row
    // unchanged + `unlocked: false` so the client toast can degrade
    // gracefully (it shouldn't happen given the badge only renders
    // when locked, but a stale optimistic cache or a teammate's
    // earlier unlock could trigger this race).
    if (existing.lockedScalePxPerFoot == null) {
      res.json({ ...existing, unlocked: false });
      return;
    }

    const [sheet] = await db
      .select({ scalePxPerFoot: takeoffSheets.scalePxPerFoot })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, existing.sheetId))
      .limit(1);

    const sheetScale = sheet?.scalePxPerFoot;
    if (!sheetScale || !Number.isFinite(sheetScale) || sheetScale <= 0) {
      res.status(400).json({
        error: "Sheet is not calibrated. Calibrate the sheet before unlocking the row.",
        reason: "sheet_not_calibrated",
      });
      return;
    }

    // Recompute against the live sheet scale using the shared helper
    // (same formulas as the calibration loop's rescale branch). The
    // helper returns `null` for rows that have no usable points
    // (e.g. COUNT measurements); for those we still clear the lock
    // but skip the geometry write since there's nothing to compute.
    const recompute = computeMeasurementRescaleUpdates(existing, sheetScale);

    const setPayload: Record<string, unknown> = {
      lockedScalePxPerFoot: null,
      updatedAt: new Date(),
    };
    if (recompute) {
      Object.assign(setPayload, recompute);
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set(setPayload)
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    // Task #2356 — Capture the live sheet scale used for the rescale
    // in the audit payload so the takeoff history panel can show a
    // stable "captured scale" value even if the sheet is later
    // re-calibrated. Without this, the panel would have to display
    // whatever scalePxPerFoot the sheet has *now*, which can drift
    // away from the value that was actually applied at unlock time.
    await logUpdate(
      req.user!.id,
      "takeoff_measurement",
      id,
      {
        lockedScalePxPerFoot: existing.lockedScalePxPerFoot,
        computedLengthFt: existing.computedLengthFt,
        computedAreaFt2: existing.computedAreaFt2,
        computedVolumeCy: existing.computedVolumeCy,
      },
      {
        lockedScalePxPerFoot: null,
        sheetScalePxPerFoot: sheetScale,
        computedLengthFt: updated.computedLengthFt,
        computedAreaFt2: updated.computedAreaFt2,
        computedVolumeCy: updated.computedVolumeCy,
        action: "unlock_and_rescale",
      },
      req,
    );

    res.json(updated);
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

    const { updateTakeoffMeasurementSchema } = await import("@shared/schema");
    const validated = parseOrRespond(updateTakeoffMeasurementSchema, sanitizedBody, res);
    if (!validated) return;

    // Task #2319 — `scaleAtCapture*` and the review-audit columns are
    // server-owned and immutable through the generic per-id PATCH.
    // The capture scale must stay frozen for the lifetime of the
    // measurement (that's the whole point of the snapshot — survives
    // sheet re-calibration), and `reviewedBy/At/Note + needsReview`
    // belong to the (out-of-scope) review-queue endpoint, not a free
    // edit. Strip them defensively here even though the client doesn't
    // send them, so a future curl-wielding caller can't bypass it.
    const STRIPPED_PROVENANCE_KEYS = [
      "scaleAtCapturePxPerFoot",
      "scaleAtCaptureLabel",
      "calibrationSource",
      "needsReview",
      "reviewedById",
      "reviewedAt",
      "reviewNote",
    ] as const;
    for (const key of STRIPPED_PROVENANCE_KEYS) {
      delete (validated as Record<string, unknown>)[key];
    }

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
      .select({
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        scaleLabel: takeoffSheets.scaleLabel,
        bidId: takeoffSheets.bidId,
        projectId: takeoffSheets.projectId,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, validated.sheetId))
      .limit(1);

    // Task #2319 — same provenance-then-geometry-then-rule sequence as
    // the sheet-scoped POST. Re-run the helper after geometry so the
    // high-$ rule sees the freshly computed quantity columns.
    const sheetCtx = {
      scalePxPerFoot: sheet?.scalePxPerFoot ?? null,
      scaleLabel: sheet?.scaleLabel ?? null,
      bidId: sheet?.bidId ?? null,
      projectId: sheet?.projectId ?? null,
    };
    const provenanced = await applyProvenanceForInsert(validated, sheetCtx);
    const computed = await computeMeasurementGeometry(provenanced, sheet?.scalePxPerFoot ?? null);
    const finalValues = await applyProvenanceForInsert(computed, sheetCtx);

    const [measurement] = await db.insert(takeoffMeasurements).values(finalValues as typeof takeoffMeasurements.$inferInsert).returning();

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

// Task #2330 — Review queue endpoints. Returns every measurement
// flagged with `needs_review = true` for the given bid/project,
// joined with the parent sheet (sheetIndex, sheetName, isActive,
// revisionLabel) and — when present — the reviewer's display name so
// the UI can group rows by sheet and credit the last reviewer
// without a follow-up fetch. Mirrors the visibility rules used by
// `/takeoff/all-measurements`: project-scoped sheets respect crew
// assignments for non-management roles; bid-scoped sheets gate on
// org membership of the bid (super-admin bypasses both). Measurements
// reviewed earlier have already cleared `needs_review`, so the
// partial index `takeoff_measurements_needs_review_idx` (Task #2319)
// makes this a B-tree probe across the bid/project's sheets.
async function selectFlaggedMeasurements(sheetIds: string[]) {
  if (sheetIds.length === 0) return [] as Array<Record<string, unknown>>;
  const { takeoffMeasurements: tm, takeoffSheets: ts, users } = await import("@shared/schema");
  const rows = await db
    .select({
      id: tm.id,
      sheetId: tm.sheetId,
      label: tm.label,
      type: tm.type,
      categoryId: tm.categoryId,
      groupId: tm.groupId,
      computedLengthFt: tm.computedLengthFt,
      computedAreaFt2: tm.computedAreaFt2,
      computedVolumeCy: tm.computedVolumeCy,
      computedSurfaceAreaFt2: tm.computedSurfaceAreaFt2,
      count: tm.count,
      unitCost: tm.unitCost,
      calibrationSource: tm.calibrationSource,
      snapHitRatio: tm.snapHitRatio,
      scaleAtCaptureLabel: tm.scaleAtCaptureLabel,
      scaleAtCapturePxPerFoot: tm.scaleAtCapturePxPerFoot,
      needsReview: tm.needsReview,
      reviewedById: tm.reviewedById,
      reviewedAt: tm.reviewedAt,
      reviewNote: tm.reviewNote,
      createdAt: tm.createdAt,
      updatedAt: tm.updatedAt,
      sheetIndex: ts.sheetIndex,
      sheetName: ts.sheetName,
      sheetIsActive: ts.isActive,
      sheetRevisionLabel: ts.revisionLabel,
      reviewerFirstName: users.firstName,
      reviewerLastName: users.lastName,
    })
    .from(tm)
    .innerJoin(ts, eq(tm.sheetId, ts.id))
    .leftJoin(users, eq(tm.reviewedById, users.id))
    .where(and(
      inArray(tm.sheetId, sheetIds),
      eq(tm.needsReview, true),
    ))
    .orderBy(ts.sheetIndex, tm.createdAt);
  return rows;
}

router.get("/api/projects/:projectId/takeoff/review-queue", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { projectId } = req.params;
    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!isSuperAdmin && !user.organizationId) { res.status(403).json({ error: "Access denied" }); return; }
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, projectId)]
      : [eq(projects.id, projectId), eq(projects.gcOrganizationId, user.organizationId as string)];
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!project) { res.status(404).json({ error: "Project not found" }); return; }

    if (user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "SUPER_ADMIN" && user.role !== "ESTIMATOR") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, projectId), eq(crewMembers.userId, user.id)))
        .limit(1);
      if (!assignment) { res.status(403).json({ error: "Access denied" }); return; }
    }

    const sheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.projectId, projectId));
    const flagged = await selectFlaggedMeasurements(sheets.map(s => s.id));
    res.json({ measurements: flagged, count: flagged.length });
  } catch (error) {
    next(error);
  }
});

router.get("/api/bids/:bidId/takeoff/review-queue", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { bidId } = req.params;
    const user = req.user!;
    const isSuperAdmin = user.role === "SUPER_ADMIN";
    if (!isSuperAdmin && !user.organizationId) { res.status(403).json({ error: "Access denied" }); return; }
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, bidId)]
      : [eq(bids.id, bidId), eq(bids.gcOrganizationId, user.organizationId as string)];
    const [bid] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);
    if (!bid) { res.status(404).json({ error: "Bid not found" }); return; }

    const sheets = await db
      .select({ id: takeoffSheets.id })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.bidId, bidId));
    const flagged = await selectFlaggedMeasurements(sheets.map(s => s.id));
    res.json({ measurements: flagged, count: flagged.length });
  } catch (error) {
    next(error);
  }
});

// Task #2330 — Review action. Stamps the reviewer audit columns and
// clears `needs_review` so the partial index drops the row out of the
// queue and the MeasurementTable flag glyph hides on the next refetch.
// Body is `{ reviewNote?: string }`. The columns are intentionally
// closed off from the per-id PATCH (Task #2319 strip list), so this
// endpoint is the only legitimate way to flip them. Audit-logged.
const reviewMeasurementSchema = z.object({
  reviewNote: z.string().max(2000).optional(),
});

router.post("/api/takeoff/measurements/:id/review", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { takeoffMeasurements } = await import("@shared/schema");

    const validated = parseOrRespond(reviewMeasurementSchema, req.body ?? {}, res);
    if (!validated) return;

    const [existing] = await db
      .select({
        sheetId: takeoffMeasurements.sheetId,
        needsReview: takeoffMeasurements.needsReview,
        type: takeoffMeasurements.type,
        label: takeoffMeasurements.label,
        reviewedById: takeoffMeasurements.reviewedById,
        reviewedAt: takeoffMeasurements.reviewedAt,
        reviewNote: takeoffMeasurements.reviewNote,
      })
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Measurement not found", reason: "not_found", failedMeasurementIds: [id] }); return; }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) { res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" }); return; }

    const note = validated.reviewNote
      ? (sanitizeShortText(validated.reviewNote, 2000) ?? null)
      : null;
    const reviewedAt = new Date();

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({
        needsReview: false,
        reviewedById: req.user!.id,
        reviewedAt,
        reviewNote: note,
        updatedAt: reviewedAt,
      })
      .where(eq(takeoffMeasurements.id, id))
      .returning();

    await logUpdate(
      req.user!.id,
      "takeoff_measurement",
      id,
      { needsReview: existing.needsReview, reviewedById: existing.reviewedById, reviewedAt: existing.reviewedAt, reviewNote: existing.reviewNote },
      { needsReview: false, reviewedById: req.user!.id, reviewedAt: reviewedAt.toISOString(), reviewNote: note, action: "review_cleared" },
      req,
    );

    res.json(updated);
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
    const {
      takeoffSheets,
      takeoffMeasurements,
      TAKEOFF_SCALE_SOURCES,
      TAKEOFF_SCALE_CONFIDENCES,
    } = await import("@shared/schema");

    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    const access = await verifySheetAccess(id, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    const { scaleLabel, scaleSource, scaleConfidence, existingMeasurementHandling, note } = req.body;

    // Task #2351 — Optional free-text note typed by the estimator
    // in the InlineCalibrationDrawer (e.g. "Verified against
    // architect's dimension on A2.1"). Persisted onto the audit
    // row's newValue JSON so the GET /scale-history endpoint can
    // surface it inline with the calibration entry. Validate
    // type/length here so the audit log can't be flooded with
    // arbitrarily large blobs; the drawer mirrors the same cap.
    const NOTE_MAX_LENGTH = 500;
    let resolvedNote: string | null = null;
    if (note !== undefined && note !== null) {
      if (typeof note !== "string") {
        res.status(400).json({ error: "note must be a string" });
        return;
      }
      const trimmedNote = note.trim();
      if (trimmedNote.length > NOTE_MAX_LENGTH) {
        res.status(400).json({
          error: `note must be ${NOTE_MAX_LENGTH} characters or fewer`,
        });
        return;
      }
      if (trimmedNote.length > 0) resolvedNote = trimmedNote;
    }

    // Task #2326 — Lock-vs-rescale choice. Default is "rescale" so
    // existing callers (legacy sidebar paths, the standard-scale
    // dropdown, AI flows) keep their previous behavior. "lock" is
    // opt-in via the InlineCalibrationDrawer's choice radio: it
    // snapshots the OLD px/ft onto every unlocked measurement so
    // their length/area never silently re-scales against the new
    // calibration.
    if (
      existingMeasurementHandling !== undefined &&
      existingMeasurementHandling !== "rescale" &&
      existingMeasurementHandling !== "lock"
    ) {
      res.status(400).json({ error: "Invalid existingMeasurementHandling" });
      return;
    }
    const handlingMode: "rescale" | "lock" =
      existingMeasurementHandling === "lock" ? "lock" : "rescale";

    // Task #2320 — every calibration write must record provenance.
    // Default to USER_TWO_POINT/HIGH for backwards-compatible callers
    // (the calibration drawer is the single largest source of writes).
    let resolvedSource: string = "USER_TWO_POINT";
    if (typeof scaleSource === "string") {
      if (!(TAKEOFF_SCALE_SOURCES as readonly string[]).includes(scaleSource)) {
        res.status(400).json({ error: "Invalid scaleSource" });
        return;
      }
      resolvedSource = scaleSource;
    }
    let resolvedConfidence: string = "HIGH";
    if (typeof scaleConfidence === "string") {
      if (!(TAKEOFF_SCALE_CONFIDENCES as readonly string[]).includes(scaleConfidence)) {
        res.status(400).json({ error: "Invalid scaleConfidence" });
        return;
      }
      resolvedConfidence = scaleConfidence;
    }

    // Tasks #2325 + #2326 — Read the prior scale state up front. We
    // need it for two purposes:
    //   • #2326 lock mode: the exact previous px/ft value gets
    //     snapshotted onto every still-unlocked measurement before
    //     we overwrite the sheet's scale.
    //   • #2325 Scale History panel: the full prior row (label /
    //     source / confidence / calibrating user / timestamp) gets
    //     serialized into the audit log's `oldValue` so the panel
    //     can render a real before→after timeline for each write.
    // Race-safety isn't a concern here: the calibration PATCH is
    // single-tenant per sheet and we issue the sheet update +
    // measurement updates within the same request.
    const [priorRow] = await db
      .select({
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        scaleLabel: takeoffSheets.scaleLabel,
        units: takeoffSheets.units,
        scaleSource: takeoffSheets.scaleSource,
        scaleConfidence: takeoffSheets.scaleConfidence,
        scaleCalibratedById: takeoffSheets.scaleCalibratedById,
        scaleCalibratedAt: takeoffSheets.scaleCalibratedAt,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, id))
      .limit(1);
    const previousScalePxPerFoot = priorRow?.scalePxPerFoot ?? null;
    const previousScale = {
      kind: "scale_calibration" as const,
      scalePxPerFoot: priorRow?.scalePxPerFoot ?? null,
      scaleLabel: priorRow?.scaleLabel ?? null,
      units: priorRow?.units ?? null,
      scaleSource: priorRow?.scaleSource ?? null,
      scaleConfidence: priorRow?.scaleConfidence ?? null,
      scaleCalibratedById: priorRow?.scaleCalibratedById ?? null,
      scaleCalibratedAt: priorRow?.scaleCalibratedAt
        ? new Date(priorRow.scaleCalibratedAt as Date | string).toISOString()
        : null,
    };

    const [updated] = await db
      .update(takeoffSheets)
      .set({
        scalePxPerFoot,
        units: units || "ft",
        scaleLabel: scaleLabel || null,
        scaleSource: resolvedSource,
        scaleConfidence: resolvedConfidence,
        scaleCalibratedById: req.user!.id,
        scaleCalibratedAt: new Date(),
        // Task #2326 — Surface the user's choice to the rest of the
        // app. Only flip ON when locking; rescaling clears the flag
        // (the per-measurement snapshots remain authoritative for
        // already-locked rows).
        scaleLockedToRevision: handlingMode === "lock",
        updatedAt: new Date(),
      })
      .where(eq(takeoffSheets.id, id))
      .returning();

    // Task #2325 — write a structured audit row for the Scale History
    // panel. Both branches below (lock + rescale) read the new sheet
    // state, so we log here once before the geometry pass to keep the
    // before/after pairing tight even if a downstream recompute throws.
    if (updated) {
      await logAudit({
        userId: req.user!.id,
        entityType: "takeoff_sheet",
        entityId: id,
        action: "UPDATE",
        oldValue: JSON.stringify(previousScale),
        newValue: JSON.stringify({
          kind: "scale_calibration",
          scalePxPerFoot: updated.scalePxPerFoot,
          scaleLabel: updated.scaleLabel,
          units: updated.units,
          scaleSource: updated.scaleSource,
          scaleConfidence: updated.scaleConfidence,
          scaleCalibratedById: updated.scaleCalibratedById,
          scaleCalibratedAt: updated.scaleCalibratedAt
            ? new Date(updated.scaleCalibratedAt as Date | string).toISOString()
            : null,
          source: "calibration",
          // Task #2351 — Estimator's optional note. Stored on the
          // audit row's newValue JSON so the Scale History panel
          // can surface it inline with the calibration entry. Only
          // included when the user actually typed something.
          ...(resolvedNote ? { note: resolvedNote } : {}),
        }),
      }, req);
    }

    // Task #2319 — re-calibration recomputes legacy rows only. Rows
    // that already carry an immutable `scale_at_capture_px_per_foot`
    // snapshot are intentionally left alone: their quantities should
    // continue to reflect the scale they were captured against, even
    // when an estimator later corrects the sheet scale. The partial
    // index `takeoff_measurements_needs_review_idx` (created in this
    // task) lets the future review UI find the rows that should be
    // re-examined; this loop just refuses to silently mutate them.
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(and(
        eq(takeoffMeasurements.sheetId, id),
        isNull(takeoffMeasurements.scaleAtCapturePxPerFoot),
      ));

    // Task #2326 — Lock branch: snapshot the OLD scale onto every
    // unlocked measurement and short-circuit the recompute loop.
    // Locked measurements keep their previously-stored
    // computedLengthFt / computedAreaFt2 / etc. untouched, so the
    // estimator's prior numbers survive the new calibration.
    // We deliberately don't overwrite an existing
    // lockedScalePxPerFoot — once a row is locked, its snapshot is
    // immutable (a follow-up calibration that picks "lock" again
    // shouldn't replace older snapshots with a fresher OLD scale).
    if (handlingMode === "lock") {
      if (previousScalePxPerFoot != null && previousScalePxPerFoot > 0) {
        for (const measurement of measurements) {
          if (measurement.lockedScalePxPerFoot != null) continue;
          await db
            .update(takeoffMeasurements)
            .set({
              lockedScalePxPerFoot: previousScalePxPerFoot,
              updatedAt: new Date(),
            })
            .where(eq(takeoffMeasurements.id, measurement.id));
        }
      }
      res.json(updated);
      return;
    }

    for (const measurement of measurements) {
      if (!measurement.points) continue;
      // Task #2326 — Honor previously-locked rows during a rescale.
      // Once a measurement was snapshotted at a specific px/ft, no
      // amount of subsequent recalibration is allowed to silently
      // shift its computed values.
      if (measurement.lockedScalePxPerFoot != null) continue;

      try {
        // Task #2334 — Delegated to the shared per-measurement helper
        // so the new "Unlock & rescale" endpoint and this loop stay
        // byte-for-byte equivalent on the formula side.
        const updates = computeMeasurementRescaleUpdates(measurement, scalePxPerFoot);
        if (updates && Object.keys(updates).length > 0) {
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
    const { sheetIds, scalePxPerFoot, units, scaleSource, scaleConfidence } = req.body;
    const {
      takeoffSheets,
      takeoffMeasurements,
      TAKEOFF_SCALE_SOURCES,
      TAKEOFF_SCALE_CONFIDENCES,
    } = await import("@shared/schema");

    if (!Array.isArray(sheetIds) || sheetIds.length === 0) {
      res.status(400).json({ error: "sheetIds array is required" });
      return;
    }
    if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      res.status(400).json({ error: "Valid scale is required" });
      return;
    }

    // Task #2320 — batch calibration writes also record provenance.
    // Default to USER_TWO_POINT/HIGH so the legacy "Apply to N selected
    // sheets" affordance keeps working while routing through this path.
    let resolvedSource: string = "USER_TWO_POINT";
    if (typeof scaleSource === "string") {
      if (!(TAKEOFF_SCALE_SOURCES as readonly string[]).includes(scaleSource)) {
        res.status(400).json({ error: "Invalid scaleSource" });
        return;
      }
      resolvedSource = scaleSource;
    }
    let resolvedConfidence: string = "HIGH";
    if (typeof scaleConfidence === "string") {
      if (!(TAKEOFF_SCALE_CONFIDENCES as readonly string[]).includes(scaleConfidence)) {
        res.status(400).json({ error: "Invalid scaleConfidence" });
        return;
      }
      resolvedConfidence = scaleConfidence;
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
        // Task #2325 — read prior state up-front so we can write a structured
        // audit row covering the per-sheet skip/update outcome.
        const [priorRow] = await tx
          .select({
            scalePxPerFoot: takeoffSheets.scalePxPerFoot,
            scaleLabel: takeoffSheets.scaleLabel,
            units: takeoffSheets.units,
            scaleSource: takeoffSheets.scaleSource,
            scaleConfidence: takeoffSheets.scaleConfidence,
            scaleCalibratedById: takeoffSheets.scaleCalibratedById,
            scaleCalibratedAt: takeoffSheets.scaleCalibratedAt,
          })
          .from(takeoffSheets)
          .where(eq(takeoffSheets.id, sheetId))
          .limit(1);

        if (skipCalibrated) {
          if (priorRow?.scalePxPerFoot) {
            skippedCount++;
            continue;
          }
        }

        const [updated] = await tx
          .update(takeoffSheets)
          .set({
            scalePxPerFoot,
            units: units || "ft",
            scaleSource: resolvedSource,
            scaleConfidence: resolvedConfidence,
            scaleCalibratedById: req.user!.id,
            scaleCalibratedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(takeoffSheets.id, sheetId))
          .returning();

        if (updated) {
          updatedCount++;
          results.push(updated);

          // Task #2325 — per-sheet structured audit row, written
          // inside the same transaction as the sheet update so a
          // rollback of the sheet write rolls the audit row back too.
          await logAudit({
            userId: req.user!.id,
            entityType: "takeoff_sheet",
            entityId: sheetId,
            action: "UPDATE",
            oldValue: JSON.stringify({
              kind: "scale_calibration",
              scalePxPerFoot: priorRow?.scalePxPerFoot ?? null,
              scaleLabel: priorRow?.scaleLabel ?? null,
              units: priorRow?.units ?? null,
              scaleSource: priorRow?.scaleSource ?? null,
              scaleConfidence: priorRow?.scaleConfidence ?? null,
              scaleCalibratedById: priorRow?.scaleCalibratedById ?? null,
              scaleCalibratedAt: priorRow?.scaleCalibratedAt
                ? new Date(priorRow.scaleCalibratedAt as Date | string).toISOString()
                : null,
            }),
            newValue: JSON.stringify({
              kind: "scale_calibration",
              scalePxPerFoot: updated.scalePxPerFoot,
              scaleLabel: updated.scaleLabel,
              units: updated.units,
              scaleSource: updated.scaleSource,
              scaleConfidence: updated.scaleConfidence,
              scaleCalibratedById: updated.scaleCalibratedById,
              scaleCalibratedAt: updated.scaleCalibratedAt
                ? new Date(updated.scaleCalibratedAt as Date | string).toISOString()
                : null,
              source: "batch_calibration",
            }),
          }, req, tx);

          // Task #2319 — same carve-out as the per-sheet calibration
          // route: rows with an immutable scaleAtCapturePxPerFoot
          // snapshot are intentionally skipped so historical
          // quantities don't drift when an estimator re-calibrates
          // weeks later. Only legacy rows (snapshot still NULL) get
          // their geometry recomputed against the new scale.
          const measurements = await tx
            .select()
            .from(takeoffMeasurements)
            .where(and(
              eq(takeoffMeasurements.sheetId, sheetId),
              isNull(takeoffMeasurements.scaleAtCapturePxPerFoot),
            ));

          for (const measurement of measurements) {
            if (!measurement.points) continue;
            // Task #2326 — Locked measurements (per-row scale snapshot)
            // must survive bulk recalibration the same way they survive
            // a per-sheet recalibration; otherwise the batch path
            // would be a back-door around the lock.
            if (measurement.lockedScalePxPerFoot != null) continue;

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

// Task #2345 — Drift remediation. Task #2332's confidence chip already
// surfaces "this sheet's measurements were captured against a
// different scale label than the sheet now reads"; this endpoint is
// the corresponding *fix*. Two actions are supported:
//
//   - "recapture": re-stamp `scale_at_capture_label` /
//     `scale_at_capture_px_per_foot` from the sheet's current scale
//     and recompute geometry against that new scale. Equivalent to
//     telling the server "the original capture was wrong; this row
//     was always meant to be against the sheet's current scale."
//     This intentionally clears any per-row `lockedScalePxPerFoot`
//     snapshot from Task #2326 — the user is explicitly opting back
//     into the sheet's authoritative scale for this row, so the
//     prior lock no longer applies.
//
//   - "mark_stale": leave the snapshot and quantities untouched but
//     flip `needsReview = true` and (re)open a PENDING reviewStatus
//     so the row surfaces in the review queue (Task #2321) for an
//     estimator to triage manually. Used when a user knows the row
//     is wrong but wants to fix it later instead of blindly
//     re-stamping it.
//
// Pre-conditions enforced by the route (all of which 4xx, never 5xx):
//   - The sheet must currently carry a non-null `scaleLabel` AND
//     `scalePxPerFoot` (you can't recapture against an unlabelled
//     sheet, and you can't recompute geometry without a scale).
//   - The measurement's `scaleAtCaptureLabel` must be non-null and
//     differ from the sheet's current label (i.e. drift actually
//     exists per `measurementHasDrift`). Idempotent no-ops on
//     non-drifting rows would still write an audit entry, which
//     would let a malicious caller flood the audit log.
//   - Standard sheet access + locked-version checks (mirror of the
//     per-id PATCH route).
//
// Audit-log shape:
//   action = "UPDATE" (audit_action enum doesn't have a dedicated
//     drift code; using a structured `op` field in newValue keeps
//     QA filters working without an enum migration).
//   newValue = JSON describing { op, fromLabel, toLabel, fromPxPerFoot,
//     toPxPerFoot, recomputedColumns? }.
async function applyDriftRecapture(
  measurement: typeof takeoffMeasurements.$inferSelect,
  sheet: { scalePxPerFoot: number | null; scaleLabel: string | null },
): Promise<{
  updates: Partial<typeof takeoffMeasurements.$inferInsert>;
  newRow: typeof takeoffMeasurements.$inferSelect;
}> {
  // Force the new snapshot, clear stale computed columns, then run
  // `computeMeasurementGeometry` which will pick up the new
  // `scaleAtCapturePxPerFoot` (its `effectiveScale = captureScale ??
  // scalePxPerFoot` resolves to the new value because we set the
  // capture-scale field above).
  const seed: Record<string, unknown> = {
    points: measurement.points,
    type: measurement.type,
    pitchRatio: measurement.pitchRatio,
    depthFeet: measurement.depthFeet,
    metadata: measurement.metadata,
    scaleAtCaptureLabel: sheet.scaleLabel,
    scaleAtCapturePxPerFoot: sheet.scalePxPerFoot,
    computedLengthFt: undefined,
    computedAreaFt2: undefined,
    computedVolumeCy: undefined,
    computedSurfaceAreaFt2: undefined,
  };
  const computed = await computeMeasurementGeometry(seed, sheet.scalePxPerFoot);
  // Build the update payload. Only forward the columns we actually
  // recomputed plus the snapshot fields; everything else on the row
  // is left alone.
  const updates: Partial<typeof takeoffMeasurements.$inferInsert> = {
    scaleAtCaptureLabel: sheet.scaleLabel,
    scaleAtCapturePxPerFoot: sheet.scalePxPerFoot,
    // Clear the per-row scale lock from Task #2326 — the user is
    // explicitly re-opting into the sheet's authoritative scale.
    lockedScalePxPerFoot: null,
    updatedAt: new Date(),
  };
  for (const key of [
    "computedLengthFt",
    "computedAreaFt2",
    "computedVolumeCy",
    "computedSurfaceAreaFt2",
    "metadata",
  ] as const) {
    if (computed[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = computed[key];
    }
  }
  const [newRow] = await db
    .update(takeoffMeasurements)
    .set(updates)
    .where(eq(takeoffMeasurements.id, measurement.id))
    .returning();
  return { updates, newRow };
}

async function applyDriftMarkStale(
  measurement: typeof takeoffMeasurements.$inferSelect,
  sheet: { scaleLabel: string | null },
  userId: string,
): Promise<typeof takeoffMeasurements.$inferSelect> {
  // Append (not replace) a system note so any prior reviewer note
  // survives. Capped to keep the column from ballooning if the same
  // row is marked stale repeatedly across calibrations.
  const stamp = new Date().toISOString();
  const stalePhrase =
    `Scale drift flagged ${stamp} — captured at "${measurement.scaleAtCaptureLabel ?? "?"}" but sheet now reads "${sheet.scaleLabel ?? "?"}".`;
  const combinedNote = measurement.reviewNote
    ? `${measurement.reviewNote}\n${stalePhrase}`.slice(0, 4000)
    : stalePhrase;
  const [newRow] = await db
    .update(takeoffMeasurements)
    .set({
      needsReview: true,
      // Re-open the queue item so a previously-approved row that
      // drifted gets eyes on it again. We deliberately do NOT clear
      // reviewedById/At — the prior decision is part of the row's
      // history and the queue UI will show "previously approved by …
      // before scale changed".
      reviewStatus: "PENDING",
      reviewRequestedById: userId,
      reviewRequestedAt: new Date(),
      reviewNote: combinedNote,
      updatedAt: new Date(),
    })
    .where(eq(takeoffMeasurements.id, measurement.id))
    .returning();
  return newRow;
}

const driftRemediateActionSchema = z.enum(["recapture", "mark_stale"]);

router.post("/api/takeoff/measurements/:id/remediate-drift", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const parsedAction = driftRemediateActionSchema.safeParse(req.body?.action);
    if (!parsedAction.success) {
      res.status(400).json({ error: "action must be \"recapture\" or \"mark_stale\"" });
      return;
    }
    const action = parsedAction.data;

    const [existing] = await db
      .select()
      .from(takeoffMeasurements)
      .where(eq(takeoffMeasurements.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({
        error: "Measurement not found — it may have been deleted",
        reason: "not_found",
        failedMeasurementIds: [id],
      });
      return;
    }

    const access = await verifySheetAccess(existing.sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Access denied" });
      return;
    }

    // Refuse to mutate a row in a locked version — same contract as
    // the per-id PATCH route. Locked-version protection has a
    // different intent than per-row scale lock.
    const locked = await isMeasurementLocked(id);
    if (locked) {
      res.status(403).json({ error: "Cannot remediate a measurement in a locked version" });
      return;
    }

    const [sheet] = await db
      .select({
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        scaleLabel: takeoffSheets.scaleLabel,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, existing.sheetId))
      .limit(1);

    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }

    // Drift-existence check. Inlined rather than imported from the
    // client-side selector because the `client/` directory isn't on
    // the server's module graph; the contract is one-line and is
    // covered by both the client unit test and the server integration
    // test below.
    const sheetLabel = (sheet.scaleLabel ?? "").trim();
    const captureLabel = (existing.scaleAtCaptureLabel ?? "").trim();
    if (!sheetLabel || !captureLabel || sheetLabel === captureLabel) {
      res.status(409).json({
        error: "This measurement is not in scale drift — nothing to remediate.",
        reason: "no_drift",
      });
      return;
    }

    if (action === "recapture") {
      if (!sheet.scalePxPerFoot || sheet.scalePxPerFoot <= 0) {
        res.status(409).json({ error: "Sheet has no current scalePxPerFoot to recapture against" });
        return;
      }
      const { newRow } = await applyDriftRecapture(existing, {
        scalePxPerFoot: sheet.scalePxPerFoot,
        scaleLabel: sheet.scaleLabel,
      });
      await logUpdate(
        req.user!.id,
        "takeoff_measurement",
        id,
        {
          scaleAtCaptureLabel: existing.scaleAtCaptureLabel,
          scaleAtCapturePxPerFoot: existing.scaleAtCapturePxPerFoot,
        },
        {
          op: "drift_recapture",
          fromLabel: existing.scaleAtCaptureLabel,
          toLabel: sheet.scaleLabel,
          fromPxPerFoot: existing.scaleAtCapturePxPerFoot,
          toPxPerFoot: sheet.scalePxPerFoot,
        },
        req,
      );
      res.json(newRow);
      return;
    }

    // action === "mark_stale"
    const newRow = await applyDriftMarkStale(existing, { scaleLabel: sheet.scaleLabel }, req.user!.id);
    await logUpdate(
      req.user!.id,
      "takeoff_measurement",
      id,
      {
        needsReview: existing.needsReview,
        reviewStatus: existing.reviewStatus,
      },
      {
        op: "drift_mark_stale",
        fromLabel: existing.scaleAtCaptureLabel,
        toLabel: sheet.scaleLabel,
      },
      req,
    );
    res.json(newRow);
  } catch (error) {
    next(error);
  }
});

router.post("/api/takeoff/sheets/:sheetId/remediate-drift", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const parsedAction = driftRemediateActionSchema.safeParse(req.body?.action);
    if (!parsedAction.success) {
      res.status(400).json({ error: "action must be \"recapture\" or \"mark_stale\"" });
      return;
    }
    const action = parsedAction.data;

    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) {
      res.status(access.sheet ? 403 : 404).json({ error: access.reason || "Sheet not found" });
      return;
    }

    // Refuse the bulk action when the active version is locked (no
    // partial-success here — the whole sheet's measurements share the
    // same version, so a single locked check is enough).
    const draftVersionId = await getActiveDraftVersionId(sheetId);
    if (!draftVersionId && (await hasAnyVersions(sheetId))) {
      res.status(403).json({ error: "Sheet is locked. Create a new version to remediate measurements." });
      return;
    }

    const [sheet] = await db
      .select({
        scalePxPerFoot: takeoffSheets.scalePxPerFoot,
        scaleLabel: takeoffSheets.scaleLabel,
      })
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, sheetId))
      .limit(1);
    if (!sheet) {
      res.status(404).json({ error: "Sheet not found" });
      return;
    }
    const sheetLabel = (sheet.scaleLabel ?? "").trim();
    if (!sheetLabel) {
      res.status(409).json({
        error: "Sheet has no current scaleLabel — set the calibration label before bulk-remediating drift.",
        reason: "no_sheet_label",
      });
      return;
    }
    if (action === "recapture" && (!sheet.scalePxPerFoot || sheet.scalePxPerFoot <= 0)) {
      res.status(409).json({ error: "Sheet has no current scalePxPerFoot to recapture against" });
      return;
    }

    // Filter to only the rows that actually drift. Done in SQL so a
    // sheet with thousands of measurements doesn't pull every row
    // into Node just to drop the matching ones.
    const candidates = await db
      .select()
      .from(takeoffMeasurements)
      .where(and(
        eq(takeoffMeasurements.sheetId, sheetId),
        isNotNull(takeoffMeasurements.scaleAtCaptureLabel),
      ));
    const drifters = candidates.filter((m) => {
      const cap = (m.scaleAtCaptureLabel ?? "").trim();
      return cap.length > 0 && cap !== sheetLabel;
    });

    if (drifters.length === 0) {
      res.json({ action, remediated: 0, ids: [] });
      return;
    }

    const remediatedIds: string[] = [];
    for (const m of drifters) {
      try {
        if (action === "recapture") {
          await applyDriftRecapture(m, {
            scalePxPerFoot: sheet.scalePxPerFoot,
            scaleLabel: sheet.scaleLabel,
          });
          await logUpdate(
            req.user!.id,
            "takeoff_measurement",
            m.id,
            {
              scaleAtCaptureLabel: m.scaleAtCaptureLabel,
              scaleAtCapturePxPerFoot: m.scaleAtCapturePxPerFoot,
            },
            {
              op: "drift_recapture",
              bulk: true,
              fromLabel: m.scaleAtCaptureLabel,
              toLabel: sheet.scaleLabel,
              fromPxPerFoot: m.scaleAtCapturePxPerFoot,
              toPxPerFoot: sheet.scalePxPerFoot,
            },
            req,
          );
        } else {
          await applyDriftMarkStale(m, { scaleLabel: sheet.scaleLabel }, req.user!.id);
          await logUpdate(
            req.user!.id,
            "takeoff_measurement",
            m.id,
            {
              needsReview: m.needsReview,
              reviewStatus: m.reviewStatus,
            },
            {
              op: "drift_mark_stale",
              bulk: true,
              fromLabel: m.scaleAtCaptureLabel,
              toLabel: sheet.scaleLabel,
            },
            req,
          );
        }
        remediatedIds.push(m.id);
      } catch (error) {
        // Log but keep going — a single bad row shouldn't poison the
        // bulk action. Mirrors the calibration loop's per-row
        // try/catch shape.
        logError(
          `Drift remediation failed for measurement ${m.id}:`,
          { sheetId, action },
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }

    res.json({ action, remediated: remediatedIds.length, ids: remediatedIds });
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

// ─────────────────────────────────────────────────────────────────────────────
// Task #2321 — Second-eye review workflow
//
// Senior estimators want a forced "right of refusal" on high-dollar takeoff
// measurements before the bid is locked & submitted. The workflow keeps a
// per-measurement state machine (NULL → PENDING → APPROVED|REJECTED) plus
// a queue flag (`needs_review`) that survives a rejection so the original
// owner can fix the line and resubmit. APPROVED and REJECTED both notify
// the requester; REQUEST notifies all org-level reviewers (ADMIN/MANAGER)
// or a single explicitly-chosen reviewer.
//
// All four endpoints below share the `loadMeasurementForReview` helper
// which pulls the measurement plus its parent bid/sheet/project so we can
// scope to the caller's organization (defence-in-depth — RBAC checks the
// route, but takeoff data is sensitive enough to warrant a hard org guard
// per row). Org cross-tenant attempts return 404 (not 403) so attackers
// can't enumerate measurement IDs.
// ─────────────────────────────────────────────────────────────────────────────

// SQL fragment that converts a measurement row into its dollar value
// regardless of takeoff type. Used by both the bid-lock gate and the
// review-summary endpoint so the two views never disagree.
//
// Area-like (AREA / PITCHED_AREA / SURFACE_AREA) → unit_cost * computed_area_ft2
// Length-like (LINEAR / LINEAR_WITH_DROP / PITCHED_LINEAR) → unit_cost * computed_length_ft
// VOLUME → unit_cost * computed_volume_cy
// COUNT → unit_cost * count
// NOTE / anything else → 0 (NOTE is metadata, not quantity)
//
// IMPORTANT: every literal compared to ${takeoffMeasurements.type} must
// match a real value in the `measurement_type` Postgres enum, otherwise
// the whole query fails to plan with "invalid input value for enum".
// We cast to text so future schema enum additions don't crash this
// query before the corresponding ALTER TYPE … ADD VALUE has run.
const measurementDollarValueSql = sql`(
  COALESCE(${takeoffMeasurements.unitCost}, 0) * COALESCE(
    CASE ${takeoffMeasurements.type}::text
      WHEN 'AREA' THEN ${takeoffMeasurements.computedAreaFt2}
      WHEN 'PITCHED_AREA' THEN ${takeoffMeasurements.computedAreaFt2}
      WHEN 'SURFACE_AREA' THEN ${takeoffMeasurements.computedAreaFt2}
      WHEN 'LINEAR' THEN ${takeoffMeasurements.computedLengthFt}
      WHEN 'LINEAR_WITH_DROP' THEN ${takeoffMeasurements.computedLengthFt}
      WHEN 'PITCHED_LINEAR' THEN ${takeoffMeasurements.computedLengthFt}
      WHEN 'VOLUME' THEN ${takeoffMeasurements.computedVolumeCy}
      WHEN 'COUNT' THEN ${takeoffMeasurements.count}
      ELSE 0
    END,
    0
  )
)`;

async function loadMeasurementForReview(measurementId: string, orgId: string) {
  // Single round-trip — measurement + sheet + bid + project so we can
  // verify cross-tenant isolation and resolve the bid for notification
  // entity-id linking. Joining instead of N+1 keeps the hot path fast
  // (the right-click menu is fired one-row-at-a-time).
  const [row] = await db
    .select({
      measurement: takeoffMeasurements,
      bidId: bids.id,
      bidCode: bids.code,
      bidName: bids.name,
      bidOrgId: bids.gcOrganizationId,
    })
    .from(takeoffMeasurements)
    .innerJoin(takeoffSheets, eq(takeoffSheets.id, takeoffMeasurements.sheetId))
    .innerJoin(bids, eq(bids.id, takeoffSheets.bidId))
    .where(and(eq(takeoffMeasurements.id, measurementId), eq(bids.gcOrganizationId, orgId)))
    .limit(1);
  return row || null;
}

// POST /api/takeoff/measurements/:id/request-review
// Body: { reviewerId?: string, note?: string }
// Flips needs_review=true, sets reviewStatus=PENDING, fans out a
// MEASUREMENT_REVIEW_REQUESTED notification to either the chosen
// reviewer or all org-level approvers (excluding the requester).
const requestReviewSchema = z.object({
  reviewerId: z.string().min(1).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
router.post("/api/takeoff/measurements/:id/request-review", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!orgId || !userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = requestReviewSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const { reviewerId, note } = parsed.data;

    const ctx = await loadMeasurementForReview(req.params.id, orgId);
    if (!ctx) return res.status(404).json({ error: "Measurement not found" });

    // If a specific reviewer is named, make sure they're in the same org
    // so we don't leak measurements across tenants by mis-routing a
    // notification.
    if (reviewerId) {
      const [reviewer] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, reviewerId), eq(users.organizationId, orgId), eq(users.isActive, true)))
        .limit(1);
      if (!reviewer) {
        return res.status(400).json({ error: "Reviewer not found in your organization" });
      }
    }

    const sanitizedNote = note ? sanitizeShortText(note, 2000) : null;

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({
        needsReview: true,
        reviewStatus: "PENDING",
        reviewRequestedById: userId,
        reviewRequestedAt: new Date(),
        reviewerId: reviewerId ?? null,
        // Clear any previous decision so the reviewer's UI doesn't
        // show stale "approved by Jane on …" text from a prior round.
        reviewedById: null,
        reviewedAt: null,
        reviewNote: sanitizedNote,
        updatedAt: new Date(),
      })
      .where(eq(takeoffMeasurements.id, req.params.id))
      .returning();

    // Recipient pool: the explicit reviewer if provided, otherwise all
    // org-level approvers minus the requester (we never want a senior
    // who clicks "send to reviewer" on their own row to ping themselves).
    const recipients = reviewerId
      ? [reviewerId]
      : await getApproverUserIds(orgId, userId);

    if (recipients.length > 0) {
      await notifyUsers(
        recipients,
        {
          type: "MEASUREMENT_REVIEW_REQUESTED",
          title: `Takeoff review requested${ctx.bidCode ? ` — ${ctx.bidCode}` : ""}`,
          message: `${updated.label || "A measurement"} on bid ${ctx.bidName ?? ctx.bidCode ?? ""} needs a second-eye review.`,
          relatedEntityId: ctx.bidId,
          relatedEntityType: "bid",
        },
        orgId,
      );
    }

    await logUpdate(userId, "takeoff_measurement", updated.id, ctx.measurement, updated, req);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Shared body schema for approve/reject — both accept an optional note
// (which becomes the human-readable comment shown in the queue page),
// and both expect the caller to be in the same org as the measurement.
const decisionSchema = z.object({ note: z.string().max(2000).optional().nullable() });

// Authorization helper — approve/reject are only valid for senior
// estimator roles AND the caller must not be the original requester
// (no rubber-stamping your own work). If the row was sent to a
// specific reviewer, only that reviewer or another approver may act.
// Returns null on success, otherwise an Express response error code.
function denyReviewerDecision(
  ctxMeasurement: { reviewRequestedById: string | null; reviewerId: string | null },
  userId: string,
): { status: number; error: string } | null {
  if (ctxMeasurement.reviewRequestedById && ctxMeasurement.reviewRequestedById === userId) {
    return { status: 403, error: "You cannot review a measurement you requested review on." };
  }
  return null;
}

// POST /api/takeoff/measurements/:id/approve-review
// Closes the queue item: needs_review=false, reviewStatus=APPROVED.
// Restricted to ADMIN/MANAGER/SUPERINTENDENT — these are the only
// roles whose word counts as a "second eye" for bid-lock purposes.
router.post(
  "/api/takeoff/measurements/:id/approve-review",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!orgId || !userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
    const note = parsed.data.note ? sanitizeShortText(parsed.data.note, 2000) : null;

    const ctx = await loadMeasurementForReview(req.params.id, orgId);
    if (!ctx) return res.status(404).json({ error: "Measurement not found" });

    const denial = denyReviewerDecision(ctx.measurement, userId);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    // Only allow a decision on a row that is actually pending. This
    // prevents two reviewers from racing each other and double-flipping
    // the row from PENDING → APPROVED → REJECTED in the wrong order.
    if (!ctx.measurement.needsReview || ctx.measurement.reviewStatus !== "PENDING") {
      return res.status(409).json({ error: "Measurement is not awaiting review" });
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({
        needsReview: false,
        reviewStatus: "APPROVED",
        reviewedById: userId,
        reviewedAt: new Date(),
        // Preserve the requester's note on the row, but tack the
        // reviewer's note on with a delimiter so both are auditable.
        reviewNote: note ? note : ctx.measurement.reviewNote,
        updatedAt: new Date(),
      })
      .where(eq(takeoffMeasurements.id, req.params.id))
      .returning();

    if (ctx.measurement.reviewRequestedById && ctx.measurement.reviewRequestedById !== userId) {
      await notifyUsers(
        [ctx.measurement.reviewRequestedById],
        {
          type: "MEASUREMENT_REVIEW_APPROVED",
          title: `Takeoff approved — ${ctx.bidCode ?? ""}`,
          message: `${updated.label || "Your measurement"} was approved.`,
          relatedEntityId: ctx.bidId,
          relatedEntityType: "bid",
        },
        orgId,
      );
    }

    await logUpdate(userId, "takeoff_measurement", updated.id, ctx.measurement, updated, req);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// POST /api/takeoff/measurements/:id/reject-review
// Keeps the queue item OPEN (needs_review stays true) so the requester
// sees the same row in their "needs fixing" filter; reviewStatus moves
// to REJECTED and a notification carries the reviewer's note back.
// Same auth contract as approve-review.
router.post(
  "/api/takeoff/measurements/:id/reject-review",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    const userId = req.user?.id;
    if (!orgId || !userId) return res.status(401).json({ error: "Unauthenticated" });

    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
    const note = parsed.data.note ? sanitizeShortText(parsed.data.note, 2000) : null;

    const ctx = await loadMeasurementForReview(req.params.id, orgId);
    if (!ctx) return res.status(404).json({ error: "Measurement not found" });

    const denial = denyReviewerDecision(ctx.measurement, userId);
    if (denial) return res.status(denial.status).json({ error: denial.error });

    if (!ctx.measurement.needsReview || ctx.measurement.reviewStatus !== "PENDING") {
      return res.status(409).json({ error: "Measurement is not awaiting review" });
    }

    const [updated] = await db
      .update(takeoffMeasurements)
      .set({
        // Intentionally leave needs_review = true so the requester
        // still sees this row in "my queue" and can fix-then-resubmit.
        // The next request-review call will reset reviewedAt/By etc.
        needsReview: true,
        reviewStatus: "REJECTED",
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: note ? note : ctx.measurement.reviewNote,
        updatedAt: new Date(),
      })
      .where(eq(takeoffMeasurements.id, req.params.id))
      .returning();

    if (ctx.measurement.reviewRequestedById && ctx.measurement.reviewRequestedById !== userId) {
      await notifyUsers(
        [ctx.measurement.reviewRequestedById],
        {
          type: "MEASUREMENT_REVIEW_REJECTED",
          title: `Takeoff needs changes — ${ctx.bidCode ?? ""}`,
          message: `${updated.label || "Your measurement"} was rejected${note ? `: ${note}` : ""}.`,
          relatedEntityId: ctx.bidId,
          relatedEntityType: "bid",
        },
        orgId,
      );
    }

    await logUpdate(userId, "takeoff_measurement", updated.id, ctx.measurement, updated, req);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// GET /api/takeoff/review-queue
//
// Returns every measurement in the caller's org that still needs
// review, sorted by **dollar value descending** by default — the
// product spec is "show me the riskiest items first", so a senior
// estimator scanning the queue should never miss a six-figure row
// hiding below a $50 paint touch-up.
//
// Server-side filters (all optional, all combine with AND):
//   ?bidId=<uuid>         — only items belonging to that bid
//   ?bidCode=<code>       — same, but uses the human-readable code
//                           the bid header chip already passes
//   ?projectId=<uuid>     — only items belonging to that project
//   ?reviewerId=<uuid>    — only items explicitly assigned to that
//                           reviewer (NULL reviewerId rows are the
//                           org-wide queue; pass `unassigned` to
//                           target those specifically)
//
// We join `users` twice (requester + assigned reviewer) so the UI
// can render names without a follow-up batch lookup, and join
// `projects` so `?projectId` can be honoured without an extra hop.
router.get("/api/takeoff/review-queue", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthenticated" });

    const requester = alias(users, "rev_requester");
    const reviewer = alias(users, "rev_reviewer");

    const filters = [
      eq(takeoffMeasurements.needsReview, true),
      eq(bids.gcOrganizationId, orgId),
    ];
    if (typeof req.query.bidId === "string" && req.query.bidId) {
      filters.push(eq(bids.id, req.query.bidId));
    }
    if (typeof req.query.bidCode === "string" && req.query.bidCode) {
      filters.push(eq(bids.code, req.query.bidCode));
    }
    if (typeof req.query.projectId === "string" && req.query.projectId) {
      // Task #2321 — `bids` doesn't carry a project FK directly; the
      // canonical takeoff→project linkage is on `takeoffSheets.projectId`,
      // and bids that have been converted also expose `convertedToProjectId`.
      // Match either so deep-links from a project page (sheet-level) and
      // post-conversion pages (bid-level) both resolve correctly.
      filters.push(sql`(${takeoffSheets.projectId} = ${req.query.projectId} OR ${bids.convertedToProjectId} = ${req.query.projectId})`);
    }
    if (typeof req.query.reviewerId === "string" && req.query.reviewerId) {
      if (req.query.reviewerId === "unassigned") {
        // SQL: reviewer_id IS NULL — handled inline because Drizzle's
        // isNull import would clash with the existing isNotNull import.
        filters.push(sql`${takeoffMeasurements.reviewerId} IS NULL`);
      } else {
        filters.push(eq(takeoffMeasurements.reviewerId, req.query.reviewerId));
      }
    }

    const rows = await db
      .select({
        id: takeoffMeasurements.id,
        label: takeoffMeasurements.label,
        type: takeoffMeasurements.type,
        source: takeoffMeasurements.source,
        reviewStatus: takeoffMeasurements.reviewStatus,
        reviewRequestedAt: takeoffMeasurements.reviewRequestedAt,
        reviewRequestedById: takeoffMeasurements.reviewRequestedById,
        reviewerId: takeoffMeasurements.reviewerId,
        reviewedAt: takeoffMeasurements.reviewedAt,
        reviewedById: takeoffMeasurements.reviewedById,
        reviewNote: takeoffMeasurements.reviewNote,
        unitCost: takeoffMeasurements.unitCost,
        count: takeoffMeasurements.count,
        computedLengthFt: takeoffMeasurements.computedLengthFt,
        computedAreaFt2: takeoffMeasurements.computedAreaFt2,
        computedVolumeCy: takeoffMeasurements.computedVolumeCy,
        metadata: takeoffMeasurements.metadata,
        sheetId: takeoffMeasurements.sheetId,
        sheetName: takeoffSheets.sheetName,
        sheetScalePxPerFoot: takeoffSheets.scalePxPerFoot,
        sheetScaleLabel: takeoffSheets.scaleLabel,
        bidId: bids.id,
        bidCode: bids.code,
        bidName: bids.name,
        // Task #2321 — `bids.convertedToProjectId` is the column on the
        // schema (`projectId` is on `takeoffSheets`, not `bids`). Surface
        // both: prefer the bid's converted project, fall back to the
        // sheet's project so project-level takeoffs still surface.
        projectId: takeoffSheets.projectId,
        convertedToProjectId: bids.convertedToProjectId,
        requestedByName: sql<string | null>`COALESCE(${requester.firstName} || ' ' || ${requester.lastName}, ${requester.email})`.as("requested_by_name"),
        reviewerName: sql<string | null>`COALESCE(${reviewer.firstName} || ' ' || ${reviewer.lastName}, ${reviewer.email})`.as("reviewer_name"),
        dollarValue: sql<number>`${measurementDollarValueSql}`.as("dollar_value"),
      })
      .from(takeoffMeasurements)
      .innerJoin(takeoffSheets, eq(takeoffSheets.id, takeoffMeasurements.sheetId))
      .innerJoin(bids, eq(bids.id, takeoffSheets.bidId))
      .leftJoin(requester, eq(requester.id, takeoffMeasurements.reviewRequestedById))
      .leftJoin(reviewer, eq(reviewer.id, takeoffMeasurements.reviewerId))
      .where(and(...filters))
      .orderBy(desc(measurementDollarValueSql), desc(takeoffMeasurements.reviewRequestedAt))
      .limit(500);

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/bids/:bidId/takeoff/review-summary
// Used by the bid-detail header chip ("Reviewed: X/Y" + dollar pct).
// We compute both a row-count summary and a dollar-weighted summary
// because the bid-lock gate uses dollars but the human-readable chip
// uses the row count (which estimators intuit faster).
router.get("/api/bids/:bidId/takeoff/review-summary", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(401).json({ error: "Unauthenticated" });

    // Verify bid belongs to caller's org first so we don't leak counts
    // for other tenants' bids.
    const [bid] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.id, req.params.bidId), eq(bids.gcOrganizationId, orgId)))
      .limit(1);
    if (!bid) return res.status(404).json({ error: "Bid not found" });

    const [summary] = await db
      .select({
        totalRows: sql<number>`COUNT(*)::int`,
        approvedRows: sql<number>`COUNT(*) FILTER (WHERE ${takeoffMeasurements.reviewStatus} = 'APPROVED')::int`,
        pendingRows: sql<number>`COUNT(*) FILTER (WHERE ${takeoffMeasurements.needsReview} = true)::int`,
        totalDollars: sql<number>`COALESCE(SUM(${measurementDollarValueSql}), 0)::float8`,
        approvedDollars: sql<number>`COALESCE(SUM(${measurementDollarValueSql}) FILTER (WHERE ${takeoffMeasurements.reviewStatus} = 'APPROVED'), 0)::float8`,
      })
      .from(takeoffMeasurements)
      .innerJoin(takeoffSheets, eq(takeoffSheets.id, takeoffMeasurements.sheetId))
      .where(eq(takeoffSheets.bidId, req.params.bidId));

    res.json({
      totalRows: summary?.totalRows ?? 0,
      approvedRows: summary?.approvedRows ?? 0,
      pendingRows: summary?.pendingRows ?? 0,
      totalDollars: summary?.totalDollars ?? 0,
      approvedDollars: summary?.approvedDollars ?? 0,
      approvedDollarPct: summary && summary.totalDollars > 0
        ? (summary.approvedDollars / summary.totalDollars) * 100
        : 0,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
