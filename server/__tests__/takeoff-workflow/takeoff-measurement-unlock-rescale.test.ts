/**
 * Task #2334 — Server coverage for the per-row unlock-and-rescale route.
 *
 * `POST /api/takeoff/measurements/:id/unlock-rescale` releases a single
 * measurement from the lock snapshot it picked up during a previous
 * `existingMeasurementHandling: "lock"` calibration (Task #2326) and
 * recomputes its length/area against the sheet's CURRENT
 * `scalePxPerFoot`. It's the inverse of the lock branch: instead of
 * freezing one row out of subsequent rescales, it pulls one row back
 * into the rescale flow without disturbing the rest of the sheet.
 *
 * The assertions below pin the contract end-to-end through Express +
 * Drizzle (no mocks):
 *
 *   1. Happy-path unlock recomputes computedLengthFt against the live
 *      sheet scale and clears `lockedScalePxPerFoot` (the row will
 *      now track future re-calibrations again).
 *   2. Idempotent: unlocking a row that isn't locked is a no-op
 *      (returns 200 with the row unchanged) — protects against stale
 *      optimistic UI / teammate races.
 *   3. 404 with a structured `not_found` reason for unknown ids so
 *      the client cache pruner can react the same way as on PATCH.
 *   4. 400 with a `sheet_not_calibrated` reason when the sheet has
 *      no scale to rescale against — we refuse to silently pin
 *      length/area to pixel-space.
 *   5. The unlock affects ONLY the targeted row; sibling locked rows
 *      on the same sheet stay locked and untouched.
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

const TEST_PREFIX = "__takeoff_unlock_rescale__";

interface MeasurementResponse {
  id: string;
  type: string;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  lockedScalePxPerFoot: number | null;
  points: { x: number; y: number }[];
}

let app: Express;
let server: Server;
let adminToken: string;
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
    name: "Unlock Rescale Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Unlock",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Unlock Rescale Bid",
    clientName: "Unlock Rescale Client",
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
 * Provision a fresh sheet with a single LINEAR measurement (100 px
 * wide), then directly mark the row as locked at the OLD scale.
 *
 * We seed the locked state via direct SQL rather than going through
 * the calibration `lock` branch because that branch's SELECT filter
 * (`isNull(scaleAtCapturePxPerFoot)`, Task #2319) intentionally
 * skips rows that already carry an immutable capture snapshot — and
 * the measurement-create route auto-populates that snapshot from
 * the sheet's current scale. The unlock-and-rescale endpoint we're
 * actually testing here is independent of how a row got locked: it
 * keys off `lockedScalePxPerFoot` alone, so a SQL-seeded lock is
 * the most isolated way to drive that codepath without piggy-backing
 * on calibration semantics that aren't this task's concern.
 *
 * Returns the IDs plus the OLD/NEW scale values so the test can
 * assert against them precisely. After this helper returns, the
 * sheet's live scale is `newScale` (so an unlock will recompute
 * against `newScale`) and the row is locked at `oldScale`.
 */
async function freshLockedSheet(): Promise<{
  sheetId: string;
  measurementId: string;
  oldScale: number;
  newScale: number;
}> {
  const oldScale = 10;
  const newScale = 20;

  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/unlock-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Unlock Plan",
  });
  expect(planRes.status).toBe(201);
  const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  // Initial calibration → 10 px/ft.
  let calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: oldScale,
    units: "ft",
  });
  expect(calRes.status).toBe(200);

  // Single LINEAR measurement, 100 px wide → 10 ft at 10 px/ft.
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

  // Bump the sheet's live scale to `newScale` WITHOUT recomputing
  // the row (rescale would overwrite computedLengthFt; we want it
  // frozen at the original 10 ft to mirror the lock branch's
  // post-state). Direct UPDATE keeps the test orthogonal to the
  // calibration recompute loop.
  await db.execute(sql`
    UPDATE takeoff_sheets
       SET scale_px_per_foot = ${newScale}
     WHERE id = ${sheetId}
  `);

  // Stamp the row as locked at the OLD scale so it looks exactly
  // like a row that survived a "lock" calibration: snapshot is set,
  // computedLengthFt stays frozen at 10 ft.
  await db.execute(sql`
    UPDATE takeoff_measurements
       SET locked_scale_px_per_foot = ${oldScale}
     WHERE id = ${measurementId}
  `);

  return { sheetId, measurementId, oldScale, newScale };
}

async function fetchMeasurements(sheetId: string): Promise<MeasurementResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
  expect(res.status).toBe(200);
  return res.body as MeasurementResponse[];
}

describe("POST /api/takeoff/measurements/:id/unlock-rescale (Task #2334)", () => {
  it("clears lockedScalePxPerFoot and recomputes computedLengthFt against the sheet's current scale", async () => {
    const { sheetId, measurementId, oldScale, newScale } = await freshLockedSheet();

    // Sanity: row is locked at 10 px/ft, length frozen at 10 ft.
    {
      const [m] = await fetchMeasurements(sheetId);
      expect(m.id).toBe(measurementId);
      expect(m.lockedScalePxPerFoot).toBeCloseTo(oldScale, 5);
      expect(m.computedLengthFt).toBeCloseTo(10, 5);
    }

    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/unlock-rescale`);
    expect(res.status).toBe(200);

    const body = res.body as MeasurementResponse;
    expect(body.id).toBe(measurementId);
    expect(body.lockedScalePxPerFoot).toBeNull();
    // 100 px / 20 px/ft = 5 ft (the recompute against the live scale).
    expect(body.computedLengthFt).toBeCloseTo(100 / newScale, 5);

    // And re-fetching from the DB confirms the same:
    const [refetched] = await fetchMeasurements(sheetId);
    expect(refetched.lockedScalePxPerFoot).toBeNull();
    expect(refetched.computedLengthFt).toBeCloseTo(100 / newScale, 5);
  });

  it("is a no-op (200) when the row is already unlocked", async () => {
    const { sheetId, measurementId } = await freshLockedSheet();

    // First unlock — flips the row.
    const first = await apiPost(`/api/takeoff/measurements/${measurementId}/unlock-rescale`);
    expect(first.status).toBe(200);
    expect((first.body as MeasurementResponse).lockedScalePxPerFoot).toBeNull();

    // Second unlock — row is already unlocked. Server returns the
    // row unchanged with `unlocked: false` so the client can decide
    // not to flash a misleading "rescaled!" toast.
    const second = await apiPost(`/api/takeoff/measurements/${measurementId}/unlock-rescale`);
    expect(second.status).toBe(200);
    expect(second.body.lockedScalePxPerFoot).toBeNull();
    expect(second.body.unlocked).toBe(false);

    // Length stays at the post-unlock value.
    const [m] = await fetchMeasurements(sheetId);
    expect(m.lockedScalePxPerFoot).toBeNull();
  });

  it("returns 404 with reason='not_found' for unknown measurement ids", async () => {
    const res = await apiPost(
      `/api/takeoff/measurements/00000000-0000-0000-0000-000000000000/unlock-rescale`,
    );
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMeasurementIds).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
  });

  it("returns 400 with reason='sheet_not_calibrated' when the sheet has no scale", async () => {
    // Build an uncalibrated sheet directly: import the plan but DO
    // NOT call PATCH /calibration. Then craft a locked row by
    // running the lock branch on a separate calibration cycle and
    // then clearing the sheet's scale. Easier path: lock-rescale a
    // row, then null out the sheet's scale via direct SQL so the
    // route's "sheet_not_calibrated" guard fires.
    const { sheetId, measurementId } = await freshLockedSheet();
    await db.execute(
      sql`UPDATE takeoff_sheets SET scale_px_per_foot = NULL WHERE id = ${sheetId}`,
    );

    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/unlock-rescale`);
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("sheet_not_calibrated");

    // Defensive: row is still locked since the route bailed before
    // mutating anything.
    const [m] = await fetchMeasurements(sheetId);
    expect(m.lockedScalePxPerFoot).not.toBeNull();
  });

  it("only unlocks the targeted row — sibling locked rows on the same sheet stay locked", async () => {
    const { sheetId, measurementId, oldScale, newScale } = await freshLockedSheet();

    // Add a second LINEAR row on the SAME sheet, then SQL-seed it
    // as locked at a different scale. This mirrors the post-state
    // of two rows that came through different lock cycles, and
    // gives us a clean control to assert the unlock route only
    // touches the targeted id.
    const sibRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: "Sibling",
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      color: "#3b82f6",
    });
    expect(sibRes.status).toBe(201);
    const siblingId = (sibRes.body as { id: string }).id;

    const siblingLockedScale = newScale;
    await db.execute(sql`
      UPDATE takeoff_measurements
         SET locked_scale_px_per_foot = ${siblingLockedScale}
       WHERE id = ${siblingId}
    `);

    // Confirm both rows are locked before we unlock just one.
    {
      const all = await fetchMeasurements(sheetId);
      const original = all.find((m) => m.id === measurementId)!;
      const sibling = all.find((m) => m.id === siblingId)!;
      expect(original.lockedScalePxPerFoot).toBeCloseTo(oldScale, 5);
      expect(sibling.lockedScalePxPerFoot).toBeCloseTo(siblingLockedScale, 5);
    }

    // Unlock just the original.
    const res = await apiPost(`/api/takeoff/measurements/${measurementId}/unlock-rescale`);
    expect(res.status).toBe(200);

    const all = await fetchMeasurements(sheetId);
    const original = all.find((m) => m.id === measurementId)!;
    const sibling = all.find((m) => m.id === siblingId)!;

    // Original — unlocked and recomputed against the current sheet scale.
    expect(original.lockedScalePxPerFoot).toBeNull();
    expect(original.computedLengthFt).toBeCloseTo(100 / newScale, 5);

    // Sibling — still locked at the snapshot, untouched.
    expect(sibling.lockedScalePxPerFoot).toBeCloseTo(siblingLockedScale, 5);
  });
});
