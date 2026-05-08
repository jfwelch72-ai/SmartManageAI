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
 *
 * Task #1765 — Bulk endpoint additionally accepts optional `color`,
 * `thickness`, and `text` per entry so the multi-select properties
 * panel can collapse a recolor / restyle into one PATCH instead of N
 * per-id PATCHes. The new tests below cover:
 *
 *  - color-only bulk update
 *  - thickness-only bulk update
 *  - text-only bulk update (label rename)
 *  - mixed-field payload (different fields per entry, including a
 *    points + color combo)
 *  - partial-failure atomicity for the new style fields (one missing
 *    id ⇒ 404 and NO color / thickness / text change is committed)
 *  - validation: an entry with no mutable fields is rejected with 400
 *
 * Task #1829 — Task #1766 added `recordJobMetrics("takeoff_markups_bulk_move", ...)`
 * around this handler so SREs can spot tenants with slow / hot bulk
 * gestures. There were no tests pinning that the metric actually fires
 * with the right counters, so a future refactor could silently drop it
 * and we'd lose the visibility. The new tests below cover:
 *
 *  - happy path: a successful bulk PATCH records exactly one
 *    `takeoff_markups_bulk_move` sample with `ok: 1`, `count` matching
 *    the request size, and a numeric `ms`
 *  - failure path: a failing bulk PATCH (validation error caught by
 *    the route's catch block) records exactly one sample with
 *    `error: 1` and a numeric `ms`
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
import { getJobMetrics } from "../../utils/jobMetrics";

// Task #1829 — Job-metrics tag the bulk-move route emits via
// `recordJobMetrics(...)`. Hardcoded here so a future rename of the
// counter in the route file fails this suite loudly rather than
// silently dropping the visibility we wired up in #1766.
const BULK_MOVE_METRIC = "takeoff_markups_bulk_move";

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
// Task #1768 — Same-org USER (no manager privileges) so we can
// exercise the `not_owner` reason and prove that mixed-reason batches
// (e.g. `cross_sheet` + `not_owner`) surface every cause, not just
// the first one the legacy code happened to short-circuit on.
let userToken: string;
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
  const orgIdsResult = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgIdsResult.rows;
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

  // Task #1768 — Same-org regular user. Used in the mixed-reason
  // batch test below to trigger `not_owner` on markups created by
  // the admin while ALSO triggering `cross_sheet` on the same batch.
  const [regularUser] = await db.insert(users).values({
    email: `${slug}-user@test.local`,
    passwordHash,
    firstName: "Regular",
    lastName: "User",
    role: "ESTIMATOR",
    organizationId: org.id,
    isActive: true,
  }).returning();
  userToken = generateToken(regularUser.id, regularUser.tokenVersion ?? 0);

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

async function createTextMarkup(
  sheetId: string,
  x: number,
  y: number,
  text: string,
  token = adminToken,
): Promise<MarkupResponse> {
  const res = await apiPost(
    "/api/takeoff/markups",
    {
      sheetId,
      tool: "TEXT",
      points: [{ x, y }],
      color: "#222222",
      thickness: 2,
      text,
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
    // Task #1768 — Structured response so the client can name the
    // offending markup in the toast and flash it on the canvas.
    expect(res.body.reason).toBe("access_denied");
    expect(res.body.failedMarkupIds).toEqual([m.id]);

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
    // Task #1768 — Cross-sheet failure should call out the mismatched
    // markup id (the row whose sheetId differs from the rest).
    expect(res.body.reason).toBe("cross_sheet");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([b.id]));

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
    // Task #1768 — The 404 must enumerate the missing ids so the
    // client toast can name them ("X was deleted") and the canvas
    // can flash them. Real ids must NOT appear in the failed set.
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMarkupIds).toEqual([fakeId]);
    expect(res.body.failedMarkupIds).not.toContain(real1.id);
    expect(res.body.failedMarkupIds).not.toContain(real2.id);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const r1 = refreshed.find((r) => r.id === real1.id)!;
    const r2 = refreshed.find((r) => r.id === real2.id)!;
    expect(r1.points).toEqual(before1);
    expect(r2.points).toEqual(before2);
  });

  it("enumerates every missing id when several siblings were deleted, not just the first", async () => {
    // Task #1768 — A 50-markup batch where two siblings were deleted
    // should call out BOTH so the user retries the right ones; the
    // pre-#1768 endpoint short-circuited on the first failure.
    const real = await createMarkup(sheetIdA, 200, 200);
    const fakeA = "00000000-0000-0000-0000-0000000000aa";
    const fakeB = "00000000-0000-0000-0000-0000000000bb";

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [
        { id: real.id, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { id: fakeA, points: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
        { id: fakeB, points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] },
      ],
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([fakeA, fakeB]));
    expect(res.body.failedMarkupIds).not.toContain(real.id);
  });

  it("surfaces every reason in a mixed-reason batch via failuresByReason (cross_sheet + not_owner)", async () => {
    // Task #1768 — Two markups created by the admin: one on sheetA,
    // one on sheetB. When a same-org USER tries to move both at
    // once, the bulk endpoint must call out BOTH causes — `cross_sheet`
    // (the markups span two sheets) AND `not_owner` (neither was
    // created by this user) — instead of the legacy short-circuit that
    // only reported whichever bucket fired first.
    const a = await createMarkup(sheetIdA, 700, 700);
    const b = await createMarkup(sheetIdB, 800, 800);

    const res = await apiPatch(
      "/api/takeoff/markups/bulk",
      {
        updates: [
          { id: a.id, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
          { id: b.id, points: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
        ],
      },
      userToken,
    );

    // 403 because `not_owner` is the dominant failure (2 ids vs the
    // 1 id flagged for cross_sheet) and any access-class reason
    // forces 403 over the cross-sheet 400.
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("not_owner");

    // Both reasons must appear in `failuresByReason`. Row order from
    // `inArray` isn't guaranteed by Postgres without ORDER BY, so
    // `cross_sheet` may name either id (whichever wasn't `rows[0]`),
    // but it must always have exactly one entry; `not_owner` always
    // names both.
    expect(Array.isArray(res.body.failuresByReason)).toBe(true);
    const reasons = (res.body.failuresByReason as Array<{ reason: string }>)
      .map((g) => g.reason)
      .sort();
    expect(reasons).toEqual(["cross_sheet", "not_owner"]);

    const crossSheetGroup = (res.body.failuresByReason as Array<{
      reason: string;
      failedMarkupIds: string[];
    }>).find((g) => g.reason === "cross_sheet")!;
    expect(crossSheetGroup.failedMarkupIds).toHaveLength(1);
    expect([a.id, b.id]).toContain(crossSheetGroup.failedMarkupIds[0]);

    const notOwnerGroup = (res.body.failuresByReason as Array<{
      reason: string;
      failedMarkupIds: string[];
    }>).find((g) => g.reason === "not_owner")!;
    expect(notOwnerGroup.failedMarkupIds).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(notOwnerGroup.failedMarkupIds).toHaveLength(2);

    // The flat union still carries every offending id so the canvas
    // can flash both at once even on older clients.
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(res.body.failedMarkupIds).toHaveLength(2);

    // No row was mutated (atomicity).
    const refreshedA = await fetchMarkupsForSheet(sheetIdA);
    const refreshedB = await fetchMarkupsForSheet(sheetIdB);
    expect(refreshedA.find((r) => r.id === a.id)!.points).toEqual(a.points);
    expect(refreshedB.find((r) => r.id === b.id)!.points).toEqual(b.points);
  });

  it("rejects malformed payloads with 400 and identifies the offending update by id", async () => {
    // Empty updates array
    const empty = await apiPatch("/api/takeoff/markups/bulk", { updates: [] });
    expect(empty.status).toBe(400);

    // Entry with no mutable fields (Task #1765 — must include at
    // least one of points / color / thickness / text).
    const noFields = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [{ id: "abc" }],
    });
    expect(noFields.status).toBe(400);

    // Non-numeric coordinates
    const badCoords = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [{ id: "abc", points: [{ x: "oops", y: 1 }] }],
    });
    expect(badCoords.status).toBe(400);
    // Task #1768 — Zod's per-update path lets us map back to the
    // submitted markup id so the client toast can name it.
    expect(badCoords.body.reason).toBe("validation");
    expect(badCoords.body.failedMarkupIds).toEqual(["abc"]);
  });

  // Task #1765 — color / thickness / text bulk updates.
  it("bulk-applies a color change to every selected markup", async () => {
    const m1 = await createMarkup(sheetIdA, 300, 10);
    const m2 = await createMarkup(sheetIdA, 300, 80);
    const m3 = await createMarkup(sheetIdA, 300, 150);
    const newColor = "#ff8800";

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [m1, m2, m3].map((m) => ({ id: m.id, color: newColor })),
    });
    expect(res.status).toBe(200);
    const returned = res.body as MarkupResponse[];
    expect(returned.length).toBe(3);
    for (const r of returned) expect(r.color).toBe(newColor);

    // Re-read to confirm the color landed in the DB and that the
    // points were NOT touched (omitted fields stay as-is).
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const byId = new Map(refreshed.map((r) => [r.id, r]));
    for (const m of [m1, m2, m3]) {
      const r = byId.get(m.id)!;
      expect(r.color).toBe(newColor);
      expect(r.points).toEqual(m.points);
    }
  });

  it("bulk-applies a thickness change to every selected markup", async () => {
    const m1 = await createMarkup(sheetIdA, 500, 10);
    const m2 = await createMarkup(sheetIdA, 500, 80);
    const newThickness = 7;

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [m1, m2].map((m) => ({ id: m.id, thickness: newThickness })),
    });
    expect(res.status).toBe(200);
    const returned = res.body as MarkupResponse[];
    for (const r of returned) expect(r.thickness).toBe(newThickness);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const byId = new Map(refreshed.map((r) => [r.id, r]));
    for (const m of [m1, m2]) {
      expect(byId.get(m.id)!.thickness).toBe(newThickness);
    }
  });

  it("bulk-applies a label rename across multiple TEXT markups", async () => {
    const t1 = await createTextMarkup(sheetIdA, 700, 10, "Old Label A");
    const t2 = await createTextMarkup(sheetIdA, 700, 80, "Old Label B");
    const newText = "Renamed via bulk";

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [t1, t2].map((m) => ({ id: m.id, text: newText })),
    });
    expect(res.status).toBe(200);
    const returned = res.body as MarkupResponse[];
    for (const r of returned) expect(r.text).toBe(newText);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const byId = new Map(refreshed.map((r) => [r.id, r]));
    for (const m of [t1, t2]) {
      expect(byId.get(m.id)!.text).toBe(newText);
    }
  });

  it("accepts mixed-field payloads and applies each entry's fields independently", async () => {
    const m1 = await createMarkup(sheetIdA, 900, 10);
    const m2 = await createMarkup(sheetIdA, 900, 80);
    const m3 = await createMarkup(sheetIdA, 900, 150);
    const newPoints = m3.points.map((p) => ({ x: p.x + 11, y: p.y + 22 }));

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [
        { id: m1.id, color: "#abcdef" },
        { id: m2.id, thickness: 5 },
        // Combine a points move with a color change in the same entry
        // — the per-row set payload should write both fields.
        { id: m3.id, points: newPoints, color: "#123456" },
      ],
    });
    expect(res.status).toBe(200);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const byId = new Map(refreshed.map((r) => [r.id, r]));

    // m1: only color changed; thickness and points are unchanged.
    expect(byId.get(m1.id)!.color).toBe("#abcdef");
    expect(byId.get(m1.id)!.thickness).toBe(m1.thickness);
    expect(byId.get(m1.id)!.points).toEqual(m1.points);

    // m2: only thickness changed; color and points are unchanged.
    expect(byId.get(m2.id)!.thickness).toBe(5);
    expect(byId.get(m2.id)!.color).toBe(m2.color);
    expect(byId.get(m2.id)!.points).toEqual(m2.points);

    // m3: both points and color changed; thickness unchanged.
    expect(byId.get(m3.id)!.points).toEqual(newPoints);
    expect(byId.get(m3.id)!.color).toBe("#123456");
    expect(byId.get(m3.id)!.thickness).toBe(m3.thickness);
  });

  it("rolls the entire transaction back on a missing id even for style-only payloads", async () => {
    const real1 = await createMarkup(sheetIdA, 1100, 10);
    const real2 = await createMarkup(sheetIdA, 1100, 80);
    const beforeColor1 = real1.color;
    const beforeColor2 = real2.color;
    const beforeThickness1 = real1.thickness;
    const beforeThickness2 = real2.thickness;
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [
        { id: real1.id, color: "#deadbe" },
        { id: real2.id, thickness: 12 },
        { id: fakeId, color: "#cafe00" },
      ],
    });
    expect(res.status).toBe(404);

    // Confirm NO row was mutated — the missing-id pre-check fires
    // before the transaction opens, so partial style writes never
    // commit. Same atomicity guarantee as the points-only path.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const r1 = refreshed.find((r) => r.id === real1.id)!;
    const r2 = refreshed.find((r) => r.id === real2.id)!;
    expect(r1.color).toBe(beforeColor1);
    expect(r1.thickness).toBe(beforeThickness1);
    expect(r2.color).toBe(beforeColor2);
    expect(r2.thickness).toBe(beforeThickness2);
  });

  // Task #1829 — Pin the `recordJobMetrics("takeoff_markups_bulk_move", ...)`
  // call wired up by Task #1766. Without these tests a future refactor
  // could silently delete the metric call and we'd lose the visibility
  // we just added (slow tenants on the bulk-move endpoint would stop
  // showing up in the admin dashboard with no test failure to flag it).
  // We snapshot the in-memory totals/sample count BEFORE firing the
  // request so this works even when other tests in the suite have
  // already exercised the endpoint and pushed samples into the rolling
  // window.
  it("records a `takeoff_markups_bulk_move` sample with ok:1 and count==batch size on success", async () => {
    const m1 = await createMarkup(sheetIdA, 1500, 10);
    const m2 = await createMarkup(sheetIdA, 1500, 80);
    const m3 = await createMarkup(sheetIdA, 1500, 150);
    const updates = [m1, m2, m3].map((m) => ({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x + 1, y: p.y + 2 })),
    }));

    const okBefore = getJobMetrics(BULK_MOVE_METRIC).totals.ok ?? 0;
    const errBefore = getJobMetrics(BULK_MOVE_METRIC).totals.error ?? 0;
    const samplesBefore = getJobMetrics(BULK_MOVE_METRIC).samples.length;

    const res = await apiPatch("/api/takeoff/markups/bulk", { updates });
    expect(res.status).toBe(200);

    const after = getJobMetrics(BULK_MOVE_METRIC);
    // Exactly one new sample for this request — the route records once
    // per call, not per update inside the batch.
    expect(after.samples.length).toBe(samplesBefore + 1);
    // Success path bumps `ok` by 1 and never bumps `error`.
    expect(after.totals.ok ?? 0).toBe(okBefore + 1);
    expect(after.totals.error ?? 0).toBe(errBefore);

    const latest = after.latest!;
    expect(latest).toBeTruthy();
    expect(latest.counters.ok).toBe(1);
    expect(latest.counters.error ?? 0).toBe(0);
    // `count` mirrors `validated.updates.length`, which is the batch
    // size the client submitted — this is the dimension SREs look at
    // to spot tenants pushing huge group-drag gestures.
    expect(latest.counters.count).toBe(updates.length);
    // `ms` is wall-clock time spent in the handler. We can't assert a
    // tight upper bound (CI is noisy) but it must be a finite, non-
    // negative number — that's what the dashboard charts.
    expect(typeof latest.counters.ms).toBe("number");
    expect(Number.isFinite(latest.counters.ms)).toBe(true);
    expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
  });

  it("records a `takeoff_markups_bulk_move` sample with error:1 when the request fails validation", async () => {
    const okBefore = getJobMetrics(BULK_MOVE_METRIC).totals.ok ?? 0;
    const errBefore = getJobMetrics(BULK_MOVE_METRIC).totals.error ?? 0;
    const samplesBefore = getJobMetrics(BULK_MOVE_METRIC).samples.length;

    // Non-numeric coordinates trip the per-update Zod schema, which
    // throws and lands in the route's catch block — the same catch
    // block that owns the `error: 1` metric call. Using a Zod failure
    // (rather than e.g. a missing-id 404, which short-circuits BEFORE
    // either metric call fires) is what guarantees the failure
    // counter actually gets tagged.
    const res = await apiPatch("/api/takeoff/markups/bulk", {
      updates: [{ id: "abc", points: [{ x: "oops", y: 1 }] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("validation");

    const after = getJobMetrics(BULK_MOVE_METRIC);
    expect(after.samples.length).toBe(samplesBefore + 1);
    // Failure path bumps `error` by 1 and never bumps `ok`.
    expect(after.totals.error ?? 0).toBe(errBefore + 1);
    expect(after.totals.ok ?? 0).toBe(okBefore);

    const latest = after.latest!;
    expect(latest).toBeTruthy();
    expect(latest.counters.error).toBe(1);
    expect(latest.counters.ok ?? 0).toBe(0);
    // `ms` must still be tagged on the failure path so the dashboard
    // can chart "how long do failed bulk PATCHes take?" alongside the
    // happy-path latency.
    expect(typeof latest.counters.ms).toBe("number");
    expect(Number.isFinite(latest.counters.ms)).toBe(true);
    expect(latest.counters.ms).toBeGreaterThanOrEqual(0);
  });
});
