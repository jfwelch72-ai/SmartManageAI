/**
 * Task #2356 — Integration coverage for the unlock-and-rescale audit
 * surfacing on the takeoff sheet's scale-history endpoint.
 *
 * The unlock route (`POST /api/takeoff/measurements/:id/unlock-rescale`)
 * now stamps an `action: "unlock_and_rescale"` audit row that captures
 * the prior `lockedScalePxPerFoot`, the live sheet `sheetScalePxPerFoot`
 * used for the rescale, and the before/after computed length/area/volume.
 * The sheet's `GET /api/takeoff/sheets/:sheetId/scale-history` route
 * folds those rows into a new `unlockRescaleEntries` array so the
 * Scale History panel can display them alongside calibration changes
 * and a manager can filter to the unlock-and-rescale activity at a
 * glance.
 *
 * The assertions below exercise that contract end-to-end through the
 * Express routes + Drizzle storage layer (no mocks):
 *   - Newly-unlocked rows produce an `unlockRescaleEntries` payload
 *     keyed by measurement, with the prior locked px/ft snapshot,
 *     the captured sheet px/ft, and the before/after computed length.
 *   - Sheets without any unlock activity return an empty array (so
 *     the UI never crashes on an undefined field).
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

const TEST_PREFIX = "__takeoff_unlock_history__";

interface SheetResponse {
  id: string;
  scalePxPerFoot: number | null;
}

interface MeasurementResponse {
  id: string;
  type: string;
  computedLengthFt: number | null;
  lockedScalePxPerFoot: number | null;
}

interface UnlockRescaleEntry {
  id: string;
  measurementId: string;
  measurementLabel: string | null;
  measurementType: string | null;
  previousLockedScalePxPerFoot: number | null;
  sheetScalePxPerFoot: number | null;
  beforeLengthFt: number | null;
  afterLengthFt: number | null;
  user: { id: string } | null;
}

interface ScaleHistoryResponse {
  sheetId: string;
  entries: unknown[];
  notes: unknown[];
  unlockRescaleEntries: UnlockRescaleEntry[];
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
    const measurementSubquery = sql`(SELECT id FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery})`;
    await db
      .execute(
        sql`DELETE FROM audit_log WHERE entity_type = 'takeoff_measurement' AND entity_id IN ${measurementSubquery}`,
      )
      .catch(() => {});
    await db
      .execute(
        sql`DELETE FROM audit_log WHERE entity_type = 'takeoff_sheet' AND entity_id IN ${sheetSubquery}`,
      )
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`)
      .catch(() => {});
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

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Unlock History Org",
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [admin] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Unlock",
      lastName: "Tester",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db
    .insert(bids)
    .values({
      code: `${slug}-BID`,
      name: "Unlock History Bid",
      clientName: "Unlock History Client",
      gcOrganizationId: org.id,
    })
    .returning();
  bidId = bid.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function freshSheetWithLockedLinear(initialScalePxPerFoot: number): Promise<{
  sheetId: string;
  measurementId: string;
}> {
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/unlock-history-${Date.now()}-${Math.random()}.pdf`,
    fileName: "Unlock History Plan",
  });
  expect(planRes.status).toBe(201);
  const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const calRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: initialScalePxPerFoot,
    units: "ft",
  });
  expect(calRes.status).toBe(200);

  // Linear measurement, 100 px wide → at 10 px/ft = 10 ft.
  const mRes = await apiPost(`/api/takeoff/sheets/${sheetId}/measurements`, {
    type: "LINEAR",
    label: "Audited Edge",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    color: "#3b82f6",
  });
  expect(mRes.status).toBe(201);
  const measurementId = (mRes.body as { id: string }).id;

  // Lock the row at the initial scale by re-calibrating with `lock`.
  const lockRes = await apiPatch(`/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: initialScalePxPerFoot * 2,
    units: "ft",
    existingMeasurementHandling: "lock",
  });
  expect(lockRes.status).toBe(200);

  return { sheetId, measurementId };
}

describe("GET /api/takeoff/sheets/:sheetId/scale-history — unlock_and_rescale (Task #2356)", () => {
  it("returns an empty unlockRescaleEntries array when the sheet has no unlock activity", async () => {
    const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
      fileUrl: `https://example.com/no-unlock-${Date.now()}.pdf`,
      fileName: "No Unlock Plan",
    });
    expect(planRes.status).toBe(201);
    const sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

    const res = await apiGet(`/api/takeoff/sheets/${sheetId}/scale-history`);
    expect(res.status).toBe(200);
    const body = res.body as ScaleHistoryResponse;
    expect(Array.isArray(body.unlockRescaleEntries)).toBe(true);
    expect(body.unlockRescaleEntries).toHaveLength(0);
  });

  it("surfaces a structured unlockRescaleEntries row with the captured sheet scale and before/after length after a row is unlocked", async () => {
    const { sheetId, measurementId } = await freshSheetWithLockedLinear(10);

    // Sanity: the lock froze the row at 10 ft even though sheet is now 20 px/ft.
    const beforeUnlock = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
    expect(beforeUnlock.status).toBe(200);
    const beforeRow = (beforeUnlock.body as MeasurementResponse[]).find(
      (m) => m.id === measurementId,
    );
    expect(beforeRow?.lockedScalePxPerFoot).toBeCloseTo(10, 5);
    expect(beforeRow?.computedLengthFt).toBeCloseTo(10, 5);

    // Unlock & rescale against the live 20 px/ft sheet scale —
    // 100 px / 20 px/ft = 5 ft after the rescale.
    const unlockRes = await apiPost(
      `/api/takeoff/measurements/${measurementId}/unlock-rescale`,
    );
    expect(unlockRes.status).toBe(200);

    const historyRes = await apiGet(`/api/takeoff/sheets/${sheetId}/scale-history`);
    expect(historyRes.status).toBe(200);
    const body = historyRes.body as ScaleHistoryResponse;
    expect(body.unlockRescaleEntries).toHaveLength(1);
    const entry = body.unlockRescaleEntries[0];
    expect(entry.measurementId).toBe(measurementId);
    expect(entry.measurementLabel).toBe("Audited Edge");
    expect(entry.measurementType).toBe("LINEAR");
    expect(entry.previousLockedScalePxPerFoot).toBeCloseTo(10, 5);
    // Captured at unlock-time = the live sheet scale (20 px/ft) at
    // the moment the rescale was applied.
    expect(entry.sheetScalePxPerFoot).toBeCloseTo(20, 5);
    expect(entry.beforeLengthFt).toBeCloseTo(10, 5);
    expect(entry.afterLengthFt).toBeCloseTo(5, 5);
    expect(entry.user?.id).toBeTruthy();
  });
});
