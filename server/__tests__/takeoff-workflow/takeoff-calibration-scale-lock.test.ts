/**
 * Task #2326 — Server coverage for the lock-vs-rescale calibration choice.
 *
 * The PATCH `/api/takeoff/sheets/:id/calibration` route now accepts an
 * `existingMeasurementHandling: "rescale" | "lock"` discriminator that
 * controls what happens to measurements already on the sheet when the
 * user re-calibrates:
 *
 *   - `"rescale"` (default, legacy behaviour): every unlocked
 *     measurement re-derives its `computedLengthFt`/`computedAreaFt2`
 *     against the fresh `scalePxPerFoot`. Previously locked rows
 *     (those with a non-null `lockedScalePxPerFoot`) are skipped so a
 *     post-lock rescale can never silently shift their numbers.
 *   - `"lock"`: snapshots the OLD `scalePxPerFoot` onto every
 *     unlocked measurement (`lockedScalePxPerFoot = previousScale`),
 *     flips the sheet's `scaleLockedToRevision` flag on, and
 *     short-circuits the recompute loop entirely so the existing
 *     length/area values survive the recalibration verbatim.
 *
 * The four assertions below pin that contract end-to-end through the
 * Express route + Drizzle storage layer (no mocks): a happy-path
 * rescale recompute, a lock snapshot + value survival, the immutable
 * snapshot guarantee on a second lock, and the rescale-skips-locked
 * guarantee.
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

const TEST_PREFIX = "__takeoff_scale_lock__";

interface SheetResponse {
  id: string;
  scalePxPerFoot: number | null;
  scaleLockedToRevision: boolean;
}

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
    name: "Scale Lock Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Lock",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Scale Lock Bid",
    clientName: "Scale Lock Client",
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

async function freshSheetWithLinear(initialScalePxPerFoot: number): Promise<{
  sheetId: string;
  measurementId: string;
}> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/scale-lock-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Scale Lock Plan",
  });
  expect(planRes.status).toBe(201);
  const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  // Calibrate first so the sheet has a `previousScalePxPerFoot` for
  // the lock branch to snapshot. Default handling = "rescale".
  const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: initialScalePxPerFoot,
    units: "ft",
  });
  expect(calRes.status).toBe(200);

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
  return { sheetId, measurementId: (mRes.body as { id: string }).id };
}

async function fetchMeasurements(sheetId: string): Promise<MeasurementResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
  expect(res.status).toBe(200);
  return res.body as MeasurementResponse[];
}

describe("PATCH /api/takeoff/sheets/:id/calibration — scale-lock (Task #2326)", () => {
  it("default 'rescale' branch recomputes computed values against the new scale", async () => {
    const { sheetId, measurementId } = await freshSheetWithLinear(10);
    // Sanity: 100 px / 10 px/ft = 10 ft
    let [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    expect(m.computedLengthFt).toBeCloseTo(10, 5);

    // Re-calibrate WITHOUT specifying handling → defaults to "rescale".
    const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 20,
      units: "ft",
    });
    expect(res.status).toBe(200);
    const sheet = res.body as SheetResponse;
    // Rescale must clear the lock flag; per-row snapshots remain
    // authoritative for any rows that were locked, but this row is
    // unlocked so the flag toggles cleanly.
    expect(sheet.scaleLockedToRevision).toBe(false);

    [m] = await fetchMeasurements(sheetId);
    // 100 px / 20 px/ft = 5 ft.
    expect(m.computedLengthFt).toBeCloseTo(5, 5);
    expect(m.lockedScalePxPerFoot).toBeNull();
  });

  it("'lock' branch snapshots the OLD scale, freezes computed values, and flips scaleLockedToRevision", async () => {
    const { sheetId, measurementId } = await freshSheetWithLinear(10);
    // Pre-lock: 10 ft
    {
      const [m] = await fetchMeasurements(sheetId);
      expect(m.computedLengthFt).toBeCloseTo(10, 5);
    }

    const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 20,
      units: "ft",
      existingMeasurementHandling: "lock",
    });
    expect(res.status).toBe(200);
    const sheet = res.body as SheetResponse;
    expect(sheet.scalePxPerFoot).toBe(20);
    expect(sheet.scaleLockedToRevision).toBe(true);

    const [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    // Snapshot is the OLD px/ft (10), not the freshly-written 20.
    expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    // Computed length survives unchanged at the original 10 ft —
    // this is the whole point of the lock: the estimator's prior
    // numbers do NOT silently re-scale.
    expect(m.computedLengthFt).toBeCloseTo(10, 5);
  });

  it("a second 'lock' calibration does NOT overwrite an already-snapshotted lockedScalePxPerFoot", async () => {
    const { sheetId, measurementId } = await freshSheetWithLinear(10);

    // First lock — snapshots OLD scale = 10.
    let res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 20,
      units: "ft",
      existingMeasurementHandling: "lock",
    });
    expect(res.status).toBe(200);
    {
      const [m] = await fetchMeasurements(sheetId);
      expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    }

    // Second lock — at this point the sheet's previous scale is 20,
    // but the row is already locked at 10. The route must NOT
    // overwrite the snapshot; once locked, the captured px/ft is
    // immutable so audit history of the original scale survives.
    res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 40,
      units: "ft",
      existingMeasurementHandling: "lock",
    });
    expect(res.status).toBe(200);

    const [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    // Still 10, not the freshly-overwriteable "previous" 20.
    expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    // And the computed length is still the original 10 ft — the
    // recompute branch is short-circuited for locked rows on every
    // subsequent rescale path too (covered explicitly below).
    expect(m.computedLengthFt).toBeCloseTo(10, 5);
  });

  it("'rescale' branch SKIPS rows whose lockedScalePxPerFoot is set, leaving them untouched", async () => {
    const { sheetId, measurementId } = await freshSheetWithLinear(10);

    // Lock first — row now snapshotted at 10 px/ft, length = 10 ft.
    let res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 20,
      units: "ft",
      existingMeasurementHandling: "lock",
    });
    expect(res.status).toBe(200);

    // Then a normal rescale to a new scale. The locked row must be
    // skipped: its lockedScalePxPerFoot stays at 10, and its
    // computedLengthFt stays at 10 ft (it is NOT recomputed against
    // the new 50 px/ft, which would yield 2 ft).
    res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 50,
      units: "ft",
      existingMeasurementHandling: "rescale",
    });
    expect(res.status).toBe(200);

    const sheet = res.body as SheetResponse;
    expect(sheet.scalePxPerFoot).toBe(50);
    expect(sheet.scaleLockedToRevision).toBe(false);

    const [m] = await fetchMeasurements(sheetId);
    expect(m.id).toBe(measurementId);
    expect(m.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    expect(m.computedLengthFt).toBeCloseTo(10, 5);
  });

  it("rejects an invalid existingMeasurementHandling value with 400", async () => {
    const { sheetId } = await freshSheetWithLinear(10);
    const res = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
      scalePxPerFoot: 20,
      units: "ft",
      existingMeasurementHandling: "invalid-mode",
    });
    expect(res.status).toBe(400);
  });
});
