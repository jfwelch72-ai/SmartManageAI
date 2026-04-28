/**
 * Task #2345 — Server coverage for the drift-remediation endpoints.
 *
 * Two new routes:
 *
 *   POST /api/takeoff/measurements/:id/remediate-drift
 *   POST /api/takeoff/sheets/:sheetId/remediate-drift
 *
 * Each accepts `{ action: "recapture" | "mark_stale" }`. Drift is
 * defined as `measurement.scaleAtCaptureLabel != sheet.scaleLabel`
 * (both non-null) — exactly the same predicate the client-side
 * `measurementHasDrift` selector uses.
 *
 *   - "recapture" re-stamps the snapshot to the sheet's CURRENT
 *     label/px-per-foot, clears any per-row `lockedScalePxPerFoot`
 *     (Task #2326), and recomputes geometry against the new scale.
 *   - "mark_stale" leaves quantities alone, flips `needsReview =
 *     true`, and (re-)opens `reviewStatus = PENDING` so the row
 *     surfaces in the Task #2321 review queue.
 *
 * Both branches write an `audit_log` row with action="UPDATE" and a
 * structured `op` field in `newValue` (the audit_action enum has no
 * dedicated drift code; using a structured payload keeps QA filters
 * working without a Postgres enum migration).
 *
 * Cases pinned below:
 *   1. recapture: snapshot+px/ft updated, geometry recomputed, lock
 *      cleared, audit row written
 *   2. mark_stale: needsReview flipped, reviewStatus → PENDING,
 *      quantities untouched, audit row written
 *   3. no-drift row → 409 (refuses to flood the audit log)
 *   4. bulk recapture remediates all drifting rows AND skips
 *      non-drifting ones (one audit row per remediation; healthy
 *      rows untouched)
 *   5. sheet with no current label → 409 on the bulk path
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../../db";
import { users, organizations, bids, auditLog } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_drift_remediate__";

interface SheetResponse {
  id: string;
  scalePxPerFoot: number | null;
  scaleLabel: string | null;
}

interface MeasurementResponse {
  id: string;
  type: string;
  computedLengthFt: number | null;
  scaleAtCaptureLabel: string | null;
  scaleAtCapturePxPerFoot: number | null;
  lockedScalePxPerFoot: number | null;
  needsReview: boolean;
  reviewStatus: string | null;
  points: { x: number; y: number }[];
}

let app: Express;
let server: Server;
let adminToken: string;
let adminUserId: string;
let bidId: string;

function apiGet(path: string) {
  return request(app).get(path).set("Cookie", `auth_token=${adminToken}`);
}
function apiPost(path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${adminToken}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${adminToken}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgIdsResult as { rows: Array<{ id: string }> }).rows;
  const orgIds = rows.map((r) => r.id);
  if (orgIds.length === 0) return;

  for (const orgId of orgIds) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${orgId})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM audit_log WHERE entity_type = 'takeoff_measurement' AND entity_id IN (SELECT id FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery})`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
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

  const [org] = await db.insert(organizations).values({
    name: "Drift Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Drift",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminUserId = admin.id;
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Drift Bid",
    clientName: "Drift Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Spin up a sheet with one calibrated measurement, then re-calibrate
 * the sheet to a different scaleLabel WITHOUT touching the
 * measurement's snapshot (which is what the legacy calibration path
 * does for the unlabelled-snapshot case). After this helper returns,
 * the measurement is in drift relative to the sheet.
 */
async function freshSheetWithDriftedMeasurement(): Promise<{
  sheetId: string;
  measurementId: string;
}> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/drift-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Drift Plan",
  });
  expect(planRes.status).toBe(201);
  const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  // Initial calibration with label "1/8\" = 1'-0\""
  const cal1 = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: 10,
    units: "ft",
    scaleLabel: '1/8" = 1\'-0"',
  });
  expect(cal1.status).toBe(200);

  // Single LINEAR measurement, 100 px wide. At 10 px/ft → 10 ft.
  const mRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
    type: "LINEAR",
    label: "Edge",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    color: "#3b82f6",
  });
  expect(mRes.status).toBe(201);
  const measurementId = (mRes.body as { id: string }).id;

  // Re-calibrate the sheet to a DIFFERENT label. Use lock handling so
  // computed length stays at 10 ft and the per-row snapshot stays as
  // it was (i.e. capture label is still "1/8\" = 1'-0\""), now
  // disagreeing with the sheet's new "1/4\" = 1'-0\"" label →
  // synthetic drift.
  const cal2 = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: 20,
    units: "ft",
    scaleLabel: '1/4" = 1\'-0"',
    existingMeasurementHandling: "lock",
  });
  expect(cal2.status).toBe(200);

  return { sheetId, measurementId };
}

async function fetchMeasurements(sheetId: string): Promise<MeasurementResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
  expect(res.status).toBe(200);
  return res.body as MeasurementResponse[];
}

async function fetchSheet(sheetId: string): Promise<SheetResponse> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}`);
  expect(res.status).toBe(200);
  return res.body as SheetResponse;
}

async function countAuditFor(measurementId: string, op: string): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id, newValue: auditLog.newValue })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "takeoff_measurement"),
        eq(auditLog.entityId, measurementId),
      ),
    );
  return rows.filter((r) => {
    try {
      const parsed = r.newValue ? JSON.parse(r.newValue) : null;
      return parsed && parsed.op === op;
    } catch {
      return false;
    }
  }).length;
}

describe("POST /api/takeoff/measurements/:id/remediate-drift (Task #2345)", () => {
  it("'recapture' updates snapshot, recomputes geometry, clears lock, and writes a structured audit row", async () => {
    const { sheetId, measurementId } = await freshSheetWithDriftedMeasurement();

    // Pre-flight: confirm drift actually exists.
    {
      const sheet = await fetchSheet(sheetId);
      expect(sheet.scaleLabel).toBe('1/4" = 1\'-0"');
      expect(sheet.scalePxPerFoot).toBe(20);
      const [m] = await fetchMeasurements(sheetId);
      expect(m.scaleAtCaptureLabel).toBe('1/8" = 1\'-0"');
      expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5); // lock in place
      expect(m.computedLengthFt).toBeCloseTo(10, 5); // pre-recapture
    }

    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/remediate-drift`, {
      action: "recapture",
    });
    expect(res.status).toBe(200);

    const [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    // Snapshot now matches the sheet
    expect(m.scaleAtCaptureLabel).toBe('1/4" = 1\'-0"');
    expect(m.scaleAtCapturePxPerFoot).toBeCloseTo(20, 5);
    // Lock is cleared (user explicitly opted back into the sheet's
    // authoritative scale).
    expect(m.lockedScalePxPerFoot).toBeNull();
    // Geometry recomputed against the new scale: 100 px / 20 px/ft = 5 ft.
    expect(m.computedLengthFt).toBeCloseTo(5, 5);

    expect(await countAuditFor(measurementId, "drift_recapture")).toBe(1);
  });

  it("'mark_stale' flips needsReview and reopens reviewStatus without changing geometry", async () => {
    const { sheetId, measurementId } = await freshSheetWithDriftedMeasurement();

    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/remediate-drift`, {
      action: "mark_stale",
    });
    expect(res.status).toBe(200);

    const [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    // Quantities untouched — this is the "review later" path.
    expect(m.computedLengthFt).toBeCloseTo(10, 5);
    expect(m.scaleAtCaptureLabel).toBe('1/8" = 1\'-0"');
    expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    // Review queue side-effects.
    expect(m.needsReview).toBe(true);
    expect(m.reviewStatus).toBe("PENDING");

    expect(await countAuditFor(measurementId, "drift_mark_stale")).toBe(1);
  });

  it("returns 409 when the measurement is not actually in drift (no audit pollution)", async () => {
    // Make a sheet whose measurement matches its scaleLabel.
    const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
      fileUrl: `https://example.com/no-drift-${Date.now()}-${Math.random()}.pdf`,
      fileName: "No-Drift Plan",
    });
    const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
    await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 10,
      units: "ft",
      scaleLabel: '1/8" = 1\'-0"',
    });
    const mRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: "Edge",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      color: "#3b82f6",
    });
    const measurementId = (mRes.body as { id: string }).id;

    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/remediate-drift`, {
      action: "recapture",
    });
    expect(res.status).toBe(409);
    expect(await countAuditFor(measurementId, "drift_recapture")).toBe(0);
  });
});

describe("POST /api/takeoff/sheets/:sheetId/remediate-drift (Task #2345)", () => {
  it("bulk 'recapture' remediates only the drifting rows and writes one audit entry per remediation", async () => {
    // Sheet with a drifted row (helper) plus a SECOND, healthy row
    // captured AFTER re-calibration so it carries the sheet's
    // current label.
    const { sheetId, measurementId: drifted } = await freshSheetWithDriftedMeasurement();
    const healthyRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: "Healthy edge",
      points: [
        { x: 0, y: 50 },
        { x: 200, y: 50 },
      ],
      color: "#22c55e",
    });
    const healthy = (healthyRes.body as { id: string }).id;

    {
      // Sanity: the new row was captured against the sheet's CURRENT
      // label (the per-create provenance stamper does this), so it is
      // NOT in drift.
      const all = await fetchMeasurements(sheetId);
      const healthyM = all.find((m) => m.id === healthy)!;
      expect(healthyM.scaleAtCaptureLabel).toBe('1/4" = 1\'-0"');
    }

    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/remediate-drift`, {
      action: "recapture",
    });
    expect(res.status).toBe(200);
    const body = res.body as { action: string; remediated: number; ids: string[] };
    expect(body.action).toBe("recapture");
    expect(body.remediated).toBe(1);
    expect(body.ids).toEqual([drifted]);

    // Audit: exactly one drift_recapture row for the drifted
    // measurement, zero for the healthy one.
    expect(await countAuditFor(drifted, "drift_recapture")).toBe(1);
    expect(await countAuditFor(healthy, "drift_recapture")).toBe(0);
  });

  it("returns 409 when the sheet has no scaleLabel to remediate against", async () => {
    const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
      fileUrl: `https://example.com/no-label-${Date.now()}-${Math.random()}.pdf`,
      fileName: "No-Label Plan",
    });
    const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
    // Calibrate with px/ft only — no scaleLabel.
    await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 10,
      units: "ft",
    });

    const res = await apiPost(`/api/takeoff/sheets/${sheetId}/remediate-drift`, {
      action: "recapture",
    });
    expect(res.status).toBe(409);
    expect((res.body as { reason: string }).reason).toBe("no_sheet_label");
  });
});
