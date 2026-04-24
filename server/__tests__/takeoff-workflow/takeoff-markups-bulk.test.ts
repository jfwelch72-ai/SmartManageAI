/**
 * Task #1752 — integration coverage for the bulk takeoff markup PATCH
 * endpoint. The endpoint replaces the legacy fan-out path that issued
 * one PATCH per dragged member of a multi-select, so this suite locks
 * in the contract the client now relies on:
 *
 *  - happy path: every row's points are written atomically and the
 *    response echoes the rebuilt rows back to the caller
 *  - auth: an unauthenticated request is rejected
 *  - cross-org isolation: a user from a different org cannot move
 *    another tenant's markups
 *  - cross-sheet rejection: a payload that mixes markups from two
 *    sheets is rejected with 400
 *  - partial-failure atomicity: if any id is missing the whole
 *    request 404s and NO row is mutated (transaction rollback)
 *  - validation: zod errors come back as 400
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

const TEST_PREFIX = "__takeoff_markup_bulk__";

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
let otherOrgToken: string;
let bidId: string;
let sheetIdA: string;
let sheetIdB: string;

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
    name: "Bulk Markup Org",
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

  // Second org so we can verify cross-tenant isolation.
  const otherSlug = `${slug}-other`;
  const [otherOrg] = await db.insert(organizations).values({
    name: "Other Bulk Org",
    slug: otherSlug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  const [otherAdmin] = await db.insert(users).values({
    email: `${otherSlug}@test.local`,
    passwordHash,
    firstName: "Other",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: otherOrg.id,
    isActive: true,
  }).returning();
  otherOrgToken = generateToken(otherAdmin.id, otherAdmin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Bulk Markup Bid",
    clientName: "Bulk Markup Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  // Two plans so we can test the same-sheet rejection path.
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-markup-plan-a.pdf",
    fileName: "Bulk Plan A",
  });
  expect(planRes.status).toBe(201);
  sheetIdA = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const planResB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-markup-plan-b.pdf",
    fileName: "Bulk Plan B",
  });
  expect(planResB.status).toBe(201);
  sheetIdB = (planResB.body as { sheets: { id: string }[] }).sheets[0].id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

async function createMarkup(sheetId: string, x: number, y: number, token = adminToken): Promise<MarkupResponse> {
  const res = await apiPost(
    "/api/takeoff/markups",
    {
      sheetId,
      tool: "RECTANGLE",
      points: [
        { x, y },
        { x: x + 50, y: y + 50 },
      ],
      color: "#222222",
      thickness: 2,
    },
    token,
  );
  expect(res.status).toBe(201);
  return res.body as MarkupResponse;
}

async function fetchMarkupsForSheet(sheetId: string): Promise<MarkupResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/markups`);
  expect(res.status).toBe(200);
  return res.body as MarkupResponse[];
}

describe("PATCH /api/takeoff/markups/bulk", () => {
  it("atomically rewrites every markup's points in one request", async () => {
    const m1 = await createMarkup(sheetIdA, 10, 10);
    const m2 = await createMarkup(sheetIdA, 200, 200);
    const m3 = await createMarkup(sheetIdA, 400, 400);

    const dx = 25;
    const dy = -15;
    const updates = [m1, m2, m3].map((m) => ({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
    }));

    const res = await apiPatch("/api/takeoff/markups/bulk", { updates });
    expect(res.status).toBe(200);
    const returned = res.body as MarkupResponse[];
    expect(returned.length).toBe(3);
    const byId = new Map(returned.map((r) => [r.id, r]));
    for (const u of updates) {
      const r = byId.get(u.id);
      expect(r).toBeTruthy();
      expect(r!.points).toEqual(u.points);
    }

    // Re-read through the GET endpoint to confirm the points actually
    // landed in the DB (not just echoed back from the request body).
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const refreshedById = new Map(refreshed.map((r) => [r.id, r]));
    for (const u of updates) {
      expect(refreshedById.get(u.id)!.points).toEqual(u.points);
    }
  });

  it("rejects unauthenticated requests", async () => {
    const m = await createMarkup(sheetIdA, 1, 1);
    const res = await apiPatch(
      "/api/takeoff/markups/bulk",
      { updates: [{ id: m.id, points: [{ x: 9, y: 9 }, { x: 10, y: 10 }] }] },
      null,
    );
    expect(res.status).toBe(401);
  });

  it("rejects requests from a different organization", async () => {
    const m = await createMarkup(sheetIdA, 5, 5);
    const before = m.points;
    const res = await apiPatch(
      "/api/takeoff/markups/bulk",
      { updates: [{ id: m.id, points: [{ x: 99, y: 99 }, { x: 100, y: 100 }] }] },
      otherOrgToken,
    );
    expect(res.status).toBe(403);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const found = refreshed.find((r) => r.id === m.id)!;
    expect(found.points).toEqual(before);
  });

  it("rejects payloads that mix markups from two different sheets", async () => {
    const a = await createMarkup(sheetIdA, 11, 11);
    const b = await createMarkup(sheetIdB, 22, 22);
    const aBefore = a.points;
    const bBefore = b.points;

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [
        { id: a.id, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { id: b.id, points: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
      ],
    });
    expect(res.status).toBe(400);

    const refreshedA = await fetchMarkupsForSheet(sheetIdA);
    const refreshedB = await fetchMarkupsForSheet(sheetIdB);
    expect(refreshedA.find((r) => r.id === a.id)!.points).toEqual(aBefore);
    expect(refreshedB.find((r) => r.id === b.id)!.points).toEqual(bBefore);
  });

  it("rolls the entire transaction back when one id is missing (partial-failure atomicity)", async () => {
    const real1 = await createMarkup(sheetIdA, 100, 100);
    const real2 = await createMarkup(sheetIdA, 150, 150);
    const before1 = real1.points;
    const before2 = real2.points;
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [
        { id: real1.id, points: [{ x: 999, y: 999 }, { x: 1000, y: 1000 }] },
        { id: real2.id, points: [{ x: 888, y: 888 }, { x: 889, y: 889 }] },
        { id: fakeId, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ],
    });
    expect(res.status).toBe(404);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const r1 = refreshed.find((r) => r.id === real1.id)!;
    const r2 = refreshed.find((r) => r.id === real2.id)!;
    expect(r1.points).toEqual(before1);
    expect(r2.points).toEqual(before2);
  });

  it("rejects malformed payloads with 400", async () => {
    // Empty updates array
    const empty = await apiPatch("/api/takeoff/markups/bulk", { updates: [] });
    expect(empty.status).toBe(400);

    // Missing points
    const noPoints = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [{ id: "abc" }],
    });
    expect(noPoints.status).toBe(400);

    // Non-numeric coordinates
    const badCoords = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [{ id: "abc", points: [{ x: "oops", y: 1 }] }],
    });
    expect(badCoords.status).toBe(400);
  });
});
