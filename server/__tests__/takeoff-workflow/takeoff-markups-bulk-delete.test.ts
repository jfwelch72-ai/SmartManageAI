/**
 * Task #1832 — integration coverage for the bulk takeoff markup DELETE
 * endpoint. Mirrors the bulk PATCH suite next door so the contract the
 * client relies on is locked in:
 *
 *  - happy path: every selected row is removed in one transactional
 *    round-trip and the response echoes the deleted ids
 *  - de-duplication: a payload that lists the same id twice still works
 *  - auth: an unauthenticated request is rejected
 *  - cross-org isolation: a user from another org cannot delete another
 *    tenant's markups (and no row is mutated)
 *  - not_owner: a same-org regular user cannot delete markups created
 *    by someone else (and no row is mutated)
 *  - mixed-reason batch: an access-denied + not-owner mix returns 403
 *    with `failuresByReason` enumerating both causes
 *  - partial-failure atomicity: if any id is missing the whole request
 *    404s and NO row is removed (transaction rollback)
 *  - validation: malformed payloads come back as 400
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

const TEST_PREFIX = "__takeoff_markup_bulk_del__";

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
let userToken: string;
let userId: string;
let bidId: string;
let sheetIdA: string;
let sheetIdB: string;
// Sheet that lives in the OTHER organization so we can create rows
// that the primary org can't access (drives the `access_denied`
// branch and the mixed-reason `access_denied` + `not_owner` test).
let otherOrgSheetId: string;

function apiGet(path: string, token = adminToken) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, body?: Record<string, unknown>, token = adminToken) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, body?: Record<string, unknown>, token: string | null = adminToken) {
  const r = request(app).delete(path);
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
    name: "Bulk Delete Org",
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
    name: "Other Bulk Delete Org",
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

  // Same-org regular user (ESTIMATOR — non-manager). Used to exercise
  // the `not_owner` branch and the mixed-reason batch path.
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
  userId = regularUser.id;

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Bulk Delete Bid",
    clientName: "Bulk Delete Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  // Two plans so the suite can exercise cross-sheet payloads if needed.
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-delete-plan-a.pdf",
    fileName: "Bulk Delete Plan A",
  });
  expect(planRes.status).toBe(201);
  sheetIdA = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const planResB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-delete-plan-b.pdf",
    fileName: "Bulk Delete Plan B",
  });
  expect(planResB.status).toBe(201);
  sheetIdB = (planResB.body as { sheets: { id: string }[] }).sheets[0].id;

  // Sister bid + sheet inside the OTHER org so we can author markups
  // there and let the primary org's user attempt to delete them
  // (`access_denied` branch).
  const [otherBid] = await db.insert(bids).values({
    code: `${otherSlug}-BID`,
    name: "Other Org Bid",
    clientName: "Other Org Client",
    gcOrganizationId: otherOrg.id,
  }).returning();
  const otherPlanRes = await apiPost(
    `/api/bids/${otherBid.id}/takeoff/plans`,
    {
      fileUrl: "https://example.com/bulk-delete-other-plan.pdf",
      fileName: "Other Org Plan",
    },
    otherOrgToken,
  );
  expect(otherPlanRes.status).toBe(201);
  otherOrgSheetId = (otherPlanRes.body as { sheets: { id: string }[] }).sheets[0].id;
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

async function fetchMarkupsForSheet(sheetId: string, token = adminToken): Promise<MarkupResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/markups`, token);
  expect(res.status).toBe(200);
  return res.body as MarkupResponse[];
}

describe("DELETE /api/takeoff/markups/bulk", () => {
  it("removes every selected markup in one transactional round-trip", async () => {
    const m1 = await createMarkup(sheetIdA, 10, 10);
    const m2 = await createMarkup(sheetIdA, 200, 200);
    const m3 = await createMarkup(sheetIdA, 400, 400);
    const ids = [m1.id, m2.id, m3.id];

    const res = await apiDelete("/api/takeoff/markups/bulk", { ids });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.count).toBe(3);
    expect(res.body.deletedIds).toEqual(expect.arrayContaining(ids));

    // Re-read through the GET endpoint to confirm every row is gone.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    const refreshedIds = new Set(refreshed.map((r) => r.id));
    for (const id of ids) {
      expect(refreshedIds.has(id)).toBe(false);
    }
  });

  it("de-duplicates ids so a payload with repeats still succeeds", async () => {
    const m = await createMarkup(sheetIdA, 12, 12);
    const res = await apiDelete("/api/takeoff/markups/bulk", { ids: [m.id, m.id, m.id] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)).toBeUndefined();
  });

  it("rejects unauthenticated requests", async () => {
    const m = await createMarkup(sheetIdA, 1, 1);
    const res = await apiDelete("/api/takeoff/markups/bulk", { ids: [m.id] }, null);
    expect(res.status).toBe(401);

    // Row still exists.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)).toBeTruthy();
  });

  it("rejects requests from a different organization and leaves every row intact", async () => {
    const m1 = await createMarkup(sheetIdA, 5, 5);
    const m2 = await createMarkup(sheetIdA, 6, 6);
    const before = await fetchMarkupsForSheet(sheetIdA);
    const beforeIds = new Set(before.map((r) => r.id));

    const res = await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [m1.id, m2.id] },
      otherOrgToken,
    );
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("access_denied");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([m1.id, m2.id]));

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    for (const id of beforeIds) {
      expect(refreshed.some((r) => r.id === id)).toBe(true);
    }
  });

  it("blocks a non-owner same-org user from deleting another user's markups", async () => {
    const m1 = await createMarkup(sheetIdA, 700, 700);
    const m2 = await createMarkup(sheetIdA, 705, 705);

    const res = await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [m1.id, m2.id] },
      userToken,
    );
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("not_owner");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([m1.id, m2.id]));

    // Both rows still present.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m1.id)).toBeTruthy();
    expect(refreshed.find((r) => r.id === m2.id)).toBeTruthy();
  });

  it("lets a regular user delete markups they authored themselves", async () => {
    const own = await createMarkup(sheetIdA, 800, 800, userToken);
    expect(own).toBeTruthy();
    expect(userId).toBeTruthy();

    const res = await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [own.id] },
      userToken,
    );
    expect(res.status).toBe(200);

    const refreshed = await fetchMarkupsForSheet(sheetIdA, userToken);
    expect(refreshed.find((r) => r.id === own.id)).toBeUndefined();
  });

  it("rolls the entire transaction back when one id is missing (partial-failure atomicity)", async () => {
    const real1 = await createMarkup(sheetIdA, 100, 100);
    const real2 = await createMarkup(sheetIdA, 150, 150);
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await apiDelete("/api/takeoff/markups/bulk", {
      ids: [real1.id, real2.id, fakeId],
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMarkupIds).toEqual([fakeId]);
    expect(res.body.failedMarkupIds).not.toContain(real1.id);
    expect(res.body.failedMarkupIds).not.toContain(real2.id);

    // Confirm NO row was removed — the missing-id pre-check fires
    // before the transaction opens, so partial deletes never commit.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === real1.id)).toBeTruthy();
    expect(refreshed.find((r) => r.id === real2.id)).toBeTruthy();
  });

  it("enumerates every missing id when several siblings were already deleted", async () => {
    const real = await createMarkup(sheetIdA, 220, 220);
    const fakeA = "00000000-0000-0000-0000-0000000000aa";
    const fakeB = "00000000-0000-0000-0000-0000000000bb";

    const res = await apiDelete("/api/takeoff/markups/bulk", {
      ids: [real.id, fakeA, fakeB],
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining([fakeA, fakeB]));
    expect(res.body.failedMarkupIds).not.toContain(real.id);

    // The real row is still there.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === real.id)).toBeTruthy();
  });

  it("surfaces every reason in a mixed-reason batch via failuresByReason", async () => {
    // Two markups: one created by the admin in the primary org's sheet
    // (ownership belongs to the admin), and one created by the other
    // org's admin on the OTHER org's sheet (lives in a different
    // tenant entirely). When the same-org regular USER tries to delete
    // both at once, `access_denied` fires for the cross-tenant row
    // AND `not_owner` fires for the admin-owned row. The bulk endpoint
    // must call out BOTH causes instead of short-circuiting on the
    // first one to fail.
    const adminOwned = await createMarkup(sheetIdA, 900, 900);
    const otherOrgOwned = await createMarkup(otherOrgSheetId, 901, 901, otherOrgToken);

    const res = await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [adminOwned.id, otherOrgOwned.id] },
      userToken,
    );
    expect(res.status).toBe(403);

    expect(Array.isArray(res.body.failuresByReason)).toBe(true);
    const reasons = (res.body.failuresByReason as Array<{ reason: string }>)
      .map((g) => g.reason)
      .sort();
    expect(reasons).toEqual(["access_denied", "not_owner"]);

    const accessGroup = (res.body.failuresByReason as Array<{
      reason: string;
      failedMarkupIds: string[];
    }>).find((g) => g.reason === "access_denied")!;
    expect(accessGroup.failedMarkupIds).toEqual([otherOrgOwned.id]);

    const notOwnerGroup = (res.body.failuresByReason as Array<{
      reason: string;
      failedMarkupIds: string[];
    }>).find((g) => g.reason === "not_owner")!;
    // Both rows also fail the not_owner check (admin owns one,
    // other-org admin owns the other; neither is the regular user)
    // so the group names every offending id.
    expect(notOwnerGroup.failedMarkupIds).toEqual(
      expect.arrayContaining([adminOwned.id, otherOrgOwned.id]),
    );

    // Flat union still carries every offending id.
    expect(res.body.failedMarkupIds).toEqual(
      expect.arrayContaining([adminOwned.id, otherOrgOwned.id]),
    );

    // Atomicity — neither row was removed.
    const refreshedA = await fetchMarkupsForSheet(sheetIdA);
    const refreshedOther = await fetchMarkupsForSheet(otherOrgSheetId, otherOrgToken);
    expect(refreshedA.find((r) => r.id === adminOwned.id)).toBeTruthy();
    expect(refreshedOther.find((r) => r.id === otherOrgOwned.id)).toBeTruthy();
  });

  it("rejects malformed payloads with 400", async () => {
    const empty = await apiDelete("/api/takeoff/markups/bulk", { ids: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe("validation");

    const missing = await apiDelete("/api/takeoff/markups/bulk", {});
    expect(missing.status).toBe(400);

    const wrongType = await apiDelete("/api/takeoff/markups/bulk", { ids: "abc" });
    expect(wrongType.status).toBe(400);
  });
});
