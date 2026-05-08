/**
 * Task #2319 — Server-side provenance & needs_review coverage for the
 * takeoff measurement endpoints.
 *
 * The schema additions (`calibrationSource`, `scaleAtCapture*`,
 * `snapModesUsed`, `snapHitRatio`, `needsReview` + audit columns) come
 * with a server-owned contract: the four `needs_review` flip
 * conditions, the immutable capture-scale snapshot, and the
 * recalibration carve-out are all enforced in
 * `applyProvenanceForInsert` / the `/calibration` PATCH. This suite
 * locks that contract in so a future refactor can't silently drop a
 * rule (the review-queue UI, out of scope for this task, will lean on
 * exactly these flags).
 *
 * Coverage:
 *   - UNCALIBRATED backfill: a measurement created on a sheet with
 *     no scale gets `calibrationSource = "UNCALIBRATED"` and
 *     `needsReview = true` automatically — the client cannot opt out.
 *   - AI source: a payload with `source: "AI"` flips needsReview even
 *     when the sheet is calibrated and the snap ratio is high.
 *   - Low snap ratio: a payload with `snapHitRatio` below the
 *     threshold (0.6) flips needsReview.
 *   - High snap ratio + low cost: needsReview stays false (the happy
 *     path the rule must NOT false-positive on).
 *   - High $ value: a payload whose computed cost exceeds the org's
 *     `takeoffReviewValueThreshold` flips needsReview.
 *   - Recalibration carve-out: the `/calibration` PATCH MUST NOT
 *     mutate `scaleAtCapturePxPerFoot` / `scaleAtCaptureLabel` on
 *     rows that already carry the snapshot. (The rule that protects
 *     historical quantities from drifting when an estimator corrects
 *     the sheet scale weeks later.)
 *   - snap_modes_used persistence: the array column round-trips so
 *     the future review HUD can show which snap modes contributed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../../db";
import { users, organizations, bids } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_meas_prov__";

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  unitCost: number | null;
  calibrationSource: string;
  scaleAtCapturePxPerFoot: number | null;
  scaleAtCaptureLabel: string | null;
  snapModesUsed: string[] | null;
  snapHitRatio: number | null;
  needsReview: boolean;
  source: string | null;
  computedLengthFt: number | string | null;
  computedAreaFt2: number | string | null;
  count: number | null;
}

let app: Express;
let server: Server;
let adminToken: string;
let orgId: string;
let bidId: string;
let calibratedSheetId: string;
let uncalibratedSheetId: string;

function apiPost(path: string, body?: Record<string, unknown>, token = adminToken) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, body?: Record<string, unknown>, token = adminToken) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgIdsResult.rows;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  // Set the org-level $-threshold low (1000) so we can exercise the
  // high-$ flip without having to fabricate a five-figure unit cost.
  // The default in code is 25_000 — we drop it here so the test stays
  // legible.
  const [org] = await db.insert(organizations).values({
    name: "Provenance Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
    takeoffReviewValueThreshold: "1000",
  }).returning();
  orgId = org.id;

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Prov",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Provenance Bid",
    clientName: "Provenance Client",
    gcOrganizationId: orgId,
  }).returning();
  bidId = bid.id;

  // Two sheets: one we leave uncalibrated (so the UNCALIBRATED + auto
  // needs_review rules apply), one we calibrate via the real
  // /calibration PATCH so subsequent measurements get a real
  // scaleAtCapture snapshot.
  const planA = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/prov-plan-a.pdf",
    fileName: "Prov Plan A",
  });
  expect(planA.status).toBe(201);
  uncalibratedSheetId = (planA.body as { sheets: { id: string }[] }).sheets[0].id;

  const planB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/prov-plan-b.pdf",
    fileName: "Prov Plan B",
  });
  expect(planB.status).toBe(201);
  calibratedSheetId = (planB.body as { sheets: { id: string }[] }).sheets[0].id;

  const cal = await apiPatch(`/api/takeoff/sheets/${calibratedSheetId}/calibration`, {
    scalePxPerFoot: 10,
    scaleLabel: '1/8" = 1\'',
    units: "ft",
  });
  expect(cal.status).toBe(200);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Task #2319 — takeoff measurement provenance & needs_review", () => {
  it("uncalibrated sheet → row gets calibrationSource=UNCALIBRATED and needsReview=true", async () => {
    // The whole point of the rule: an estimator who started taking off
    // BEFORE setting the scale must have those rows surfaced for
    // re-examination. The client cannot opt out by omitting the
    // field — the server re-derives it from the sheet.
    const res = await apiPost(`/api/takeoff/sheets/${uncalibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "Pre-calibration draft",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      // Even if the client lies and sends needsReview:false, the
      // server overwrites it because the four flip conditions are
      // re-evaluated below.
      needsReview: false,
      snapHitRatio: 1.0,
    });
    expect(res.status).toBe(201);
    const m = res.body as MeasurementResponse;
    expect(m.calibrationSource).toBe("UNCALIBRATED");
    expect(m.scaleAtCapturePxPerFoot).toBeNull();
    expect(m.scaleAtCaptureLabel).toBeNull();
    expect(m.needsReview).toBe(true);
  });

  it("calibrated sheet + clean snap + low cost → needsReview stays false (no false positives)", async () => {
    // The negative case the rule must NOT trip on. If this fires the
    // review queue will drown in noise and estimators will start
    // ignoring the flag.
    const res = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "Clean capture",
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      snapHitRatio: 0.95,
      snapModesUsed: ["endpoint", "midpoint"],
      unitCost: 1, // 5 ft * $1 = $5, well under the 1000 threshold
      source: "USER",
    });
    expect(res.status).toBe(201);
    const m = res.body as MeasurementResponse;
    expect(m.needsReview).toBe(false);
    expect(m.calibrationSource).toBe("USER_TWO_POINT");
    // The capture-scale snapshot was stamped from the sheet at insert.
    expect(Number(m.scaleAtCapturePxPerFoot)).toBe(10);
    expect(m.scaleAtCaptureLabel).toBe('1/8" = 1\'');
    // Snap modes round-trip through the array column.
    expect(m.snapModesUsed).toEqual(["endpoint", "midpoint"]);
    expect(Number(m.snapHitRatio)).toBeCloseTo(0.95);
  });

  it("AI source flips needsReview even on a calibrated sheet with high snap ratio", async () => {
    const res = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "AI-detected line",
      points: [{ x: 0, y: 0 }, { x: 30, y: 0 }],
      snapHitRatio: 1.0,
      source: "AI",
      unitCost: 0.5,
    });
    expect(res.status).toBe(201);
    const m = res.body as MeasurementResponse;
    expect(m.needsReview).toBe(true);
    expect(m.source).toBe("AI");
  });

  it("low snap ratio (< 0.6) flips needsReview", async () => {
    const res = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "Sloppy capture",
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      snapHitRatio: 0.2,
      snapModesUsed: ["endpoint", "endpoint", "endpoint", "endpoint", "endpoint"],
      source: "USER",
      unitCost: 0.5,
    });
    expect(res.status).toBe(201);
    const m = res.body as MeasurementResponse;
    expect(m.needsReview).toBe(true);
    expect(Number(m.snapHitRatio)).toBeCloseTo(0.2);
  });

  it("high $ value (> org threshold) flips needsReview", async () => {
    // 100ft polygon → ~10x10ft area = 100 sf. With unitCost $50 the
    // total ($5000) easily clears the 1000 threshold this org was
    // seeded with.
    const res = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "AREA",
      label: "Big-money slab",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      snapHitRatio: 0.95,
      source: "USER",
      unitCost: 50,
    });
    expect(res.status).toBe(201);
    const m = res.body as MeasurementResponse;
    expect(m.needsReview).toBe(true);
    // Sanity-check geometry actually computed; the $-rule is supposed
    // to fire after geometry has populated the area column.
    expect(Number(m.computedAreaFt2)).toBeGreaterThan(0);
  });

  it("batch recalibration MUST NOT mutate scaleAtCapture* on existing rows either", async () => {
    // Same carve-out as the per-sheet calibration route, applied to
    // the batch endpoint. Without this guard, a "Apply scale to N
    // selected sheets" action would silently re-price every captured
    // measurement on each affected sheet, defeating the immutability
    // contract.
    const create = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "Pre-batch capture",
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }],
      snapHitRatio: 1.0,
      source: "USER",
      unitCost: 0,
    });
    expect(create.status).toBe(201);
    const beforeId = (create.body as MeasurementResponse).id;
    const beforeSnap = Number((create.body as MeasurementResponse).scaleAtCapturePxPerFoot);
    const beforeLabel = (create.body as MeasurementResponse).scaleAtCaptureLabel;
    const beforeLength = Number((create.body as MeasurementResponse).computedLengthFt);
    expect(beforeSnap).toBe(10);

    // Drive a batch recalibration with a different scale.
    // skipCalibrated:false forces the route to actually update the
    // calibrated sheet (the default would skip it).
    const batch = await apiPatch("/api/takeoff/sheets/batch-calibration", {
      sheetIds: [calibratedSheetId],
      scalePxPerFoot: 40,
      units: "ft",
      skipCalibrated: false,
    });
    expect(batch.status).toBe(200);

    const rowsRes = await db.execute(
      sql`SELECT scale_at_capture_px_per_foot, scale_at_capture_label, computed_length_ft FROM takeoff_measurements WHERE id = ${beforeId}`,
    );
    const rowsResU: unknown = rowsRes;
    const after = (rowsResU as {
      rows: Array<{
        scale_at_capture_px_per_foot: number | string | null;
        scale_at_capture_label: string | null;
        computed_length_ft: number | string | null;
      }>;
    }).rows[0];
    expect(Number(after.scale_at_capture_px_per_foot)).toBe(beforeSnap);
    expect(after.scale_at_capture_label).toBe(beforeLabel);
    expect(Number(after.computed_length_ft)).toBeCloseTo(beforeLength);
  });

  it("recalibration MUST NOT mutate scaleAtCapture* on existing rows", async () => {
    // The carve-out at the heart of the task. Capture a measurement
    // on a sheet, then re-calibrate the sheet to a different scale.
    // The row's snapshot must stay frozen so historical quantities
    // continue to reflect the scale they were captured against.
    const create = await apiPost(`/api/takeoff/sheets/${calibratedSheetId}/measurements`, {
      type: "LINEAR",
      label: "Pre-recal capture",
      points: [{ x: 0, y: 0 }, { x: 60, y: 0 }],
      snapHitRatio: 1.0,
      source: "USER",
      unitCost: 0,
    });
    expect(create.status).toBe(201);
    const beforeId = (create.body as MeasurementResponse).id;
    const beforeSnap = Number((create.body as MeasurementResponse).scaleAtCapturePxPerFoot);
    const beforeLabel = (create.body as MeasurementResponse).scaleAtCaptureLabel;
    const beforeLength = Number((create.body as MeasurementResponse).computedLengthFt);
    expect(beforeSnap).toBe(10);

    // Re-calibrate the sheet to a totally different scale.
    const recal = await apiPatch(`/api/takeoff/sheets/${calibratedSheetId}/calibration`, {
      scalePxPerFoot: 25,
      scaleLabel: '1/4" = 1\'',
      units: "ft",
    });
    expect(recal.status).toBe(200);

    // Read the row back and confirm the snapshot survived. Use raw
    // SQL to avoid the schema import dance — we only need the three
    // columns the carve-out promises to leave alone.
    const rowsRes = await db.execute(
      sql`SELECT scale_at_capture_px_per_foot, scale_at_capture_label, computed_length_ft FROM takeoff_measurements WHERE id = ${beforeId}`,
    );
    const rowsResU: unknown = rowsRes;
    const after = (rowsResU as {
      rows: Array<{
        scale_at_capture_px_per_foot: number | string | null;
        scale_at_capture_label: string | null;
        computed_length_ft: number | string | null;
      }>;
    }).rows[0];
    expect(Number(after.scale_at_capture_px_per_foot)).toBe(beforeSnap);
    expect(after.scale_at_capture_label).toBe(beforeLabel);
    // The computed length must also be untouched — the calibration
    // loop intentionally skips rows that have a non-null
    // scale_at_capture_px_per_foot. If this assertion ever fails the
    // carve-out has been broken.
    expect(Number(after.computed_length_ft)).toBeCloseTo(beforeLength);
  });
});
