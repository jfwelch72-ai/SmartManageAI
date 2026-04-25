/**
 * Task #1967 — regression coverage for the bulk takeoff markup PATCH
 * endpoint when a sibling row is hard-deleted between the route's
 * pre-check SELECT and the in-transaction per-id UPDATEs.
 *
 * Before the fix, the loop did `if (row) out.push(row)` and silently
 * skipped any UPDATE that affected zero rows — so a concurrent delete
 * landing mid-drag let every OTHER row in the batch commit its move
 * while the missing one stayed put, leaving the dragged group
 * visually misaligned. The fix throws inside the transaction when any
 * per-id UPDATE returns no row, rolling the whole transaction back so
 * every sibling stays at its pre-move position when the race fires
 * (mirroring the bulk DELETE pattern in the same route file and the
 * plan-document fix in Task #1842).
 *
 * The race is simulated by spying on `db.transaction` and hard-
 * deleting the victim row on a different pool connection right
 * before the original transaction opens — the same observable effect
 * a concurrent client DELETE would produce, with deterministic timing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db, pool } from "../../db";
import { users, organizations, bids } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_markup_bulk_race__";

interface MarkupResponse {
  id: string;
  sheetId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
}

let app: Express;
let server: Server;
let adminToken: string;
let bidId: string;
let sheetId: string;

function apiGet(path: string, token = adminToken) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, body?: Record<string, unknown>, token = adminToken) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(path: string, body?: Record<string, unknown>, token: string | null = adminToken) {
  const r = request(app).patch(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
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
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
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
    name: "Bulk Race Org",
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
    name: "Bulk Race Bid",
    clientName: "Bulk Race Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-race-plan.pdf",
    fileName: "Bulk Race Plan",
  });
  expect(planRes.status).toBe(201);
  sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function createMarkup(sheetIdArg: string, x: number, y: number): Promise<MarkupResponse> {
  const res = await apiPost(
    "/api/takeoff/markups",
    {
      sheetId: sheetIdArg,
      tool: "RECTANGLE",
      points: [
        { x, y },
        { x: x + 50, y: y + 50 },
      ],
      color: "#222222",
      thickness: 2,
    },
  );
  expect(res.status).toBe(201);
  return res.body as MarkupResponse;
}

async function fetchMarkupsForSheet(sheetIdArg: string): Promise<MarkupResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetIdArg}/markups`);
  expect(res.status).toBe(200);
  return res.body as MarkupResponse[];
}

describe("PATCH /api/takeoff/markups/bulk — concurrent-delete race (Task #1967)", () => {
  it("rolls every sibling back when one row is hard-deleted between the pre-check SELECT and the in-transaction UPDATE", async () => {
    const m1 = await createMarkup(sheetId, 100, 100);
    const m2 = await createMarkup(sheetId, 200, 200); // victim — deleted mid-drag
    const m3 = await createMarkup(sheetId, 300, 300);
    const before1 = m1.points;
    const before3 = m3.points;

    // Spy on db.transaction so we can land a hard-delete on a
    // SEPARATE pool connection AFTER the route's pre-check SELECT
    // (which runs before db.transaction is called) but BEFORE the
    // original transaction's per-id UPDATEs run. Same observable
    // effect a concurrent client DELETE would produce, but with
    // deterministic timing so the test is not flaky.
    const originalTransaction = db.transaction.bind(db);
    let deleted = false;
    const spy = vi
      .spyOn(db, "transaction")
      .mockImplementation(async (...args: Parameters<typeof db.transaction>) => {
        if (!deleted) {
          deleted = true;
          // Bypass drizzle entirely so the DELETE commits on a
          // separate connection from the pool, not the one the
          // about-to-open transaction will check out.
          await pool.query("DELETE FROM takeoff_markups WHERE id = $1", [m2.id]);
        }
        return (originalTransaction as (...a: typeof args) => unknown)(...args);
      });

    try {
      const res = await apiPatch("/api/takeoff/markups/bulk", {
        updates: [
          { id: m1.id, points: [{ x: 999, y: 999 }, { x: 1000, y: 1000 }] },
          { id: m2.id, points: [{ x: 888, y: 888 }, { x: 889, y: 889 }] },
          { id: m3.id, points: [{ x: 777, y: 777 }, { x: 778, y: 778 }] },
        ],
      });

      // The pre-check SELECT saw all three rows (it ran before the
      // DELETE landed) so the route enters its transaction. The
      // UPDATE on m2 then affects zero rows, so the route throws
      // and Express returns a non-2xx response. The exact status
      // code is incidental (today the default error handler returns
      // 500; a future hardening pass may map this to 409 / 404 with
      // a structured `failedMarkupIds` shape) — what matters is the
      // transaction did NOT commit a partial move, which the
      // refresh assertions below prove.
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expect(deleted).toBe(true);
    } finally {
      spy.mockRestore();
    }

    // Atomicity proof: m1 and m3 must still be at their pre-move
    // positions. Before the fix, both would have committed the new
    // points while m2 silently stayed put — exactly the misaligned
    // group the user reported.
    const refreshed = await fetchMarkupsForSheet(sheetId);
    const r1 = refreshed.find((r) => r.id === m1.id);
    const r3 = refreshed.find((r) => r.id === m3.id);
    expect(r1).toBeTruthy();
    expect(r3).toBeTruthy();
    expect(r1!.points).toEqual(before1);
    expect(r3!.points).toEqual(before3);

    // The victim row really was hard-deleted out from under the
    // transaction (sanity-check that the race we simulated actually
    // fired — without this assertion a future refactor that no-ops
    // the spy would still let the test pass).
    expect(refreshed.find((r) => r.id === m2.id)).toBeUndefined();
  });
});
