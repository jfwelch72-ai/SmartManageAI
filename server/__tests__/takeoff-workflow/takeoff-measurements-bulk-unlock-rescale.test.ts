/**
 * Task #2357 — Server coverage for the bulk unlock-and-rescale route.
 *
 * `POST /api/takeoff/measurements/bulk-unlock-rescale` is the
 * many-row companion to the per-row `:id/unlock-rescale` endpoint
 * pinned by `takeoff-measurement-unlock-rescale.test.ts` (Task #2334).
 * It releases N measurements from their `lockedScalePxPerFoot`
 * snapshots and recomputes their length/area against the sheet's
 * CURRENT scale in a single transaction so a busy sheet's mistaken
 * "Lock existing measurements" choice can be undone in one click
 * instead of N.
 *
 * The assertions below pin the contract end-to-end through Express +
 * Drizzle (no mocks):
 *
 *   1. Happy-path bulk unlock recomputes computedLengthFt against the
 *      live sheet scale for every locked row and clears each row's
 *      `lockedScalePxPerFoot`.
 *   2. Mixed batch (some rows already unlocked) is partial-no-op:
 *      already-unlocked rows are returned unchanged and reported in
 *      `alreadyUnlockedIds`; previously-locked rows are recomputed.
 *   3. 404 with reason='not_found' when any submitted id is unknown,
 *      so the client cache pruner can react the same way as on the
 *      bulk PATCH path.
 *   4. 400 with reason='cross_sheet' when the payload mixes ids from
 *      different sheets, so a malformed request can't silently
 *      mutate rows on unrelated sheets.
 *   5. 400 with reason='sheet_not_calibrated' when the sheet has no
 *      scale to rescale against — same loud refusal as the per-row
 *      route, applied to the whole batch.
 *   6. Atomicity: a row outside the batch on the same sheet is left
 *      strictly untouched.
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

const TEST_PREFIX = "__takeoff_bulk_unlock_rescale__";

interface MeasurementResponse {
  id: string;
  type: string;
  computedLengthFt: number | null;
  computedAreaFt2: number | null;
  lockedScalePxPerFoot: number | null;
  points: { x: number; y: number }[];
}

interface BulkUnlockResponse {
  measurements: MeasurementResponse[];
  unlockedCount: number;
  alreadyUnlockedIds: string[];
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
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgIdsResult.rows;
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
    name: "Bulk Unlock Rescale Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Bulk",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Bulk Unlock Rescale Bid",
    clientName: "Bulk Unlock Rescale Client",
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
 * Provision a fresh sheet calibrated at `oldScale`, populate `count`
 * LINEAR rows each `pxWidth` pixels long, then bump the sheet's live
 * scale to `newScale` WITHOUT a recompute and SQL-seed each row as
 * locked at the old scale. This mirrors the post-state of a sheet
 * that survived a "lock" calibration choice — every row has frozen
 * geometry plus a `lockedScalePxPerFoot` snapshot — without
 * piggy-backing on the calibration recompute loop's semantics.
 */
async function freshLockedSheetWithRows(
  count: number,
  pxWidth = 100,
  oldScale = 10,
  newScale = 20,
): Promise<{
  sheetId: string;
  measurementIds: string[];
  oldScale: number;
  newScale: number;
}> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/bulk-unlock-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Bulk Unlock Plan",
  });
  expect(planRes.status).toBe(201);
  const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: oldScale,
    units: "ft",
  });
  expect(calRes.status).toBe(200);

  const measurementIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const mRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: `Edge-${i}`,
      points: [
        { x: 0, y: i * 5 },
        { x: pxWidth, y: i * 5 },
      ],
      color: "#3b82f6",
    });
    expect(mRes.status).toBe(201);
    measurementIds.push((mRes.body as { id: string }).id);
  }

  await db.execute(sql`
    UPDATE takeoff_sheets
       SET scale_px_per_foot = ${newScale}
     WHERE id = ${sheetId}
  `);

  for (const id of measurementIds) {
    await db.execute(sql`
      UPDATE takeoff_measurements
         SET locked_scale_px_per_foot = ${oldScale}
       WHERE id = ${id}
    `);
  }

  return { sheetId, measurementIds, oldScale, newScale };
}

async function fetchMeasurements(sheetId: string): Promise<MeasurementResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
  expect(res.status).toBe(200);
  return res.body as MeasurementResponse[];
}

describe("POST /api/takeoff/measurements/bulk-unlock-rescale (Task #2357)", () => {
  it("clears lockedScalePxPerFoot and recomputes computedLengthFt for every row in the batch", async () => {
    const { sheetId, measurementIds, newScale } = await freshLockedSheetWithRows(3);

    // Sanity: every row is locked at the old scale, frozen at 10 ft.
    {
      const all = await fetchMeasurements(sheetId);
      for (const m of all) {
        expect(m.lockedScalePxPerFoot).not.toBeNull();
        expect(m.computedLengthFt).toBeCloseTo(10, 5);
      }
    }

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: measurementIds,
    });
    expect(res.status).toBe(200);

    const body = res.body as BulkUnlockResponse;
    expect(body.unlockedCount).toBe(measurementIds.length);
    expect(body.alreadyUnlockedIds).toEqual([]);
    expect(body.measurements).toHaveLength(measurementIds.length);

    // Every returned row is unlocked + recomputed at the live scale.
    for (const m of body.measurements) {
      expect(m.lockedScalePxPerFoot).toBeNull();
      expect(m.computedLengthFt).toBeCloseTo(100 / newScale, 5);
    }

    // Re-fetch from the DB confirms the same.
    const refetched = await fetchMeasurements(sheetId);
    for (const m of refetched) {
      expect(m.lockedScalePxPerFoot).toBeNull();
      expect(m.computedLengthFt).toBeCloseTo(100 / newScale, 5);
    }
  });

  it("partial-no-op: already-unlocked rows in the batch are returned unchanged and counted in alreadyUnlockedIds", async () => {
    const { sheetId, measurementIds, newScale } = await freshLockedSheetWithRows(3);

    // Pre-unlock the first row out-of-band so it's already at the live
    // scale by the time the bulk call runs.
    const preUnlock = await apiPost(
      `/api/takeoff/measurements/${measurementIds[0]}/unlock-rescale`,
    );
    expect(preUnlock.status).toBe(200);

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: measurementIds,
    });
    expect(res.status).toBe(200);

    const body = res.body as BulkUnlockResponse;
    // Only the two still-locked rows actually flipped; the third is a no-op.
    expect(body.unlockedCount).toBe(2);
    expect(body.alreadyUnlockedIds).toEqual([measurementIds[0]]);
    expect(body.measurements).toHaveLength(measurementIds.length);

    // Every row is now unlocked and recomputed at the live scale.
    for (const m of body.measurements) {
      expect(m.lockedScalePxPerFoot).toBeNull();
      expect(m.computedLengthFt).toBeCloseTo(100 / newScale, 5);
    }
  });

  it("returns 404 with reason='not_found' when any submitted id is unknown", async () => {
    const { measurementIds } = await freshLockedSheetWithRows(2);

    const phantom = "00000000-0000-0000-0000-000000000000";
    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: [...measurementIds, phantom],
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMeasurementIds).toEqual([phantom]);
    expect(Array.isArray(res.body.failuresByReason)).toBe(true);
    expect(res.body.failuresByReason[0].reason).toBe("not_found");
    expect(res.body.failuresByReason[0].failedMeasurementIds).toEqual([phantom]);
  });

  it("returns 400 with reason='cross_sheet' when ids span multiple sheets", async () => {
    const a = await freshLockedSheetWithRows(1);
    const b = await freshLockedSheetWithRows(1);

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: [a.measurementIds[0], b.measurementIds[0]],
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("cross_sheet");

    // Defensive: both rows are still locked since the route bailed
    // before the transaction opened.
    const allA = await fetchMeasurements(a.sheetId);
    const allB = await fetchMeasurements(b.sheetId);
    expect(allA[0].lockedScalePxPerFoot).not.toBeNull();
    expect(allB[0].lockedScalePxPerFoot).not.toBeNull();
  });

  it("returns 400 with reason='sheet_not_calibrated' when the sheet has no scale", async () => {
    const { sheetId, measurementIds } = await freshLockedSheetWithRows(2);
    await db.execute(
      sql`UPDATE takeoff_sheets SET scale_px_per_foot = NULL WHERE id = ${sheetId}`,
    );

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: measurementIds,
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("sheet_not_calibrated");

    // Defensive: every row is still locked since the route refused the batch.
    const all = await fetchMeasurements(sheetId);
    for (const m of all) {
      expect(m.lockedScalePxPerFoot).not.toBeNull();
    }
  });

  it("only unlocks rows in the batch — sibling locked rows on the same sheet stay locked", async () => {
    const { sheetId, measurementIds, oldScale, newScale } = await freshLockedSheetWithRows(3);

    // Bulk-unlock just the first two; the third is the control.
    const targets = [measurementIds[0], measurementIds[1]];
    const sibling = measurementIds[2];

    const res = await apiPost(`/api/takeoff/measurements/bulk-unlock-rescale`, {
      ids: targets,
    });
    expect(res.status).toBe(200);
    expect((res.body as BulkUnlockResponse).unlockedCount).toBe(2);

    const all = await fetchMeasurements(sheetId);
    const byId = new Map(all.map((m) => [m.id, m]));

    // Targeted rows — unlocked + recomputed at the live scale.
    for (const id of targets) {
      const row = byId.get(id)!;
      expect(row.lockedScalePxPerFoot).toBeNull();
      expect(row.computedLengthFt).toBeCloseTo(100 / newScale, 5);
    }

    // Sibling — still locked at the snapshot, length frozen at 10 ft.
    const siblingRow = byId.get(sibling)!;
    expect(siblingRow.lockedScalePxPerFoot).toBeCloseTo(oldScale, 5);
    expect(siblingRow.computedLengthFt).toBeCloseTo(10, 5);
  });
});
