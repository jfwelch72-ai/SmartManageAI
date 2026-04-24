/**
 * Task #1860 — integration coverage for the bulk takeoff markup
 * RESTORE endpoint that powers a single-round-trip Undo of a bulk
 * DELETE. Mirrors the bulk DELETE suite next door so the contract the
 * client relies on is locked in:
 *
 *  - happy path: every snapshot is restored in one transactional
 *    round-trip with the original ids / authorship / sheet / category
 *  - delete → undo → re-fetch round-trips the rows back to their
 *    original ids so a Redo can target the same id list
 *  - auth: an unauthenticated request is rejected
 *  - cross-org isolation: a user from another org cannot restore
 *    another tenant's snapshots (and no row is inserted)
 *  - not_owner: a same-org regular user cannot restore markups
 *    authored by someone else (and no row is inserted)
 *  - mixed-reason batch: an access-denied + not-owner mix returns 403
 *    with `failuresByReason` enumerating both causes (no row inserted)
 *  - conflict: if any id is still live the whole request 409s and NO
 *    row is inserted (atomic — primary-key UNIQUE pre-check fires
 *    before the transaction opens)
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

const TEST_PREFIX = "__takeoff_markup_restore_bulk__";

interface MarkupResponse {
  id: string;
  sheetId: string;
  organizationId: string;
  createdBy: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
  categoryId: string | null;
}

let app: Express;
let server: Server;
let adminToken: string;
let adminId: string;
let orgId: string;
let otherOrgToken: string;
let otherAdminId: string;
let otherOrgId: string;
let userToken: string;
let userId: string;
let bidId: string;
let sheetIdA: string;
let sheetIdB: string;
let otherOrgSheetId: string;

function apiGet(path: string, token = adminToken) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, body?: Record<string, unknown>, token: string | null = adminToken) {
  const r = request(app).post(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
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
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;

  for (const id of ids) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
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

  const [org] = await db.insert(organizations).values({
    name: "Bulk Restore Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

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
  adminId = admin.id;

  const otherSlug = `${slug}-other`;
  const [otherOrg] = await db.insert(organizations).values({
    name: "Other Bulk Restore Org",
    slug: otherSlug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  otherOrgId = otherOrg.id;

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
  otherAdminId = otherAdmin.id;

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
    name: "Bulk Restore Bid",
    clientName: "Bulk Restore Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/restore-bulk-plan-a.pdf",
    fileName: "Restore Bulk Plan A",
  });
  expect(planRes.status).toBe(201);
  sheetIdA = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const planResB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/restore-bulk-plan-b.pdf",
    fileName: "Restore Bulk Plan B",
  });
  expect(planResB.status).toBe(201);
  sheetIdB = (planResB.body as { sheets: { id: string }[] }).sheets[0].id;

  const [otherBid] = await db.insert(bids).values({
    code: `${otherSlug}-BID`,
    name: "Other Org Bid",
    clientName: "Other Org Client",
    gcOrganizationId: otherOrg.id,
  }).returning();
  const otherPlanRes = await apiPost(
    `/api/bids/${otherBid.id}/takeoff/plans`,
    {
      fileUrl: "https://example.com/restore-bulk-other-plan.pdf",
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

async function createMarkup(
  sheetId: string,
  x: number,
  y: number,
  token = adminToken,
): Promise<MarkupResponse> {
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

function snapshotForRestore(m: MarkupResponse) {
  return {
    id: m.id,
    sheetId: m.sheetId,
    organizationId: m.organizationId,
    createdBy: m.createdBy,
    tool: m.tool,
    points: m.points,
    color: m.color,
    thickness: m.thickness,
    text: m.text,
    categoryId: m.categoryId,
  };
}

describe("POST /api/takeoff/markups/restore-bulk", () => {
  it("restores every snapshot in one transactional round-trip with original ids preserved", async () => {
    const m1 = await createMarkup(sheetIdA, 10, 10);
    const m2 = await createMarkup(sheetIdA, 200, 200);
    const m3 = await createMarkup(sheetIdB, 400, 400);
    const snapshots = [m1, m2, m3].map(snapshotForRestore);
    const ids = snapshots.map((s) => s.id);

    // Bulk DELETE first to clear the rows the snapshots describe.
    const delRes = await apiDelete("/api/takeoff/markups/bulk", { ids });
    expect(delRes.status).toBe(200);

    // Restore in one round-trip.
    const restoreRes = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: snapshots },
    );
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.ok).toBe(true);
    expect(restoreRes.body.count).toBe(3);
    expect(restoreRes.body.markups).toHaveLength(3);

    // Original ids are preserved (response shape).
    const restoredIds: string[] = restoreRes.body.markups.map((m: any) => m.id);
    expect(restoredIds).toEqual(expect.arrayContaining(ids));

    // Re-read each sheet to confirm the rows exist with the SAME ids
    // and original authorship / sheet.
    const refreshedA = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshedA.find((r) => r.id === m1.id && r.createdBy === adminId)).toBeTruthy();
    expect(refreshedA.find((r) => r.id === m2.id && r.createdBy === adminId)).toBeTruthy();
    const refreshedB = await fetchMarkupsForSheet(sheetIdB);
    expect(refreshedB.find((r) => r.id === m3.id && r.createdBy === adminId)).toBeTruthy();
  });

  it("supports a delete → restore → delete redo cycle on the same id list", async () => {
    const m1 = await createMarkup(sheetIdA, 700, 700);
    const m2 = await createMarkup(sheetIdA, 720, 720);
    const snapshots = [m1, m2].map(snapshotForRestore);
    const ids = snapshots.map((s) => s.id);

    expect((await apiDelete("/api/takeoff/markups/bulk", { ids })).status).toBe(200);
    expect((await apiPost("/api/takeoff/markups/restore-bulk", { markups: snapshots })).status).toBe(200);

    // Re-issue the SAME bulk DELETE — the redo path the client uses.
    const redoDel = await apiDelete("/api/takeoff/markups/bulk", { ids });
    expect(redoDel.status).toBe(200);
    expect(redoDel.body.deletedIds).toEqual(expect.arrayContaining(ids));

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    for (const id of ids) {
      expect(refreshed.find((r) => r.id === id)).toBeUndefined();
    }
  });

  it("rejects unauthenticated requests", async () => {
    const m = await createMarkup(sheetIdA, 1, 1);
    const snap = snapshotForRestore(m);
    expect((await apiDelete("/api/takeoff/markups/bulk", { ids: [m.id] })).status).toBe(200);

    const res = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: [snap] },
      null,
    );
    expect(res.status).toBe(401);

    // No row was inserted.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)).toBeUndefined();
  });

  it("rejects a cross-org request and inserts no rows", async () => {
    const m1 = await createMarkup(sheetIdA, 5, 5);
    const m2 = await createMarkup(sheetIdA, 6, 6);
    const snapshots = [m1, m2].map(snapshotForRestore);
    const ids = snapshots.map((s) => s.id);
    expect((await apiDelete("/api/takeoff/markups/bulk", { ids })).status).toBe(200);

    const res = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: snapshots },
      otherOrgToken,
    );
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("access_denied");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining(ids));

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    for (const id of ids) {
      expect(refreshed.find((r) => r.id === id)).toBeUndefined();
    }
  });

  it("blocks a non-owner same-org user from restoring another user's snapshots", async () => {
    const m1 = await createMarkup(sheetIdA, 800, 800);
    const m2 = await createMarkup(sheetIdA, 805, 805);
    const snapshots = [m1, m2].map(snapshotForRestore);
    const ids = snapshots.map((s) => s.id);
    expect((await apiDelete("/api/takeoff/markups/bulk", { ids })).status).toBe(200);

    const res = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: snapshots },
      userToken,
    );
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("not_owner");
    expect(res.body.failedMarkupIds).toEqual(expect.arrayContaining(ids));

    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    for (const id of ids) {
      expect(refreshed.find((r) => r.id === id)).toBeUndefined();
    }
  });

  it("lets a regular user restore snapshots they themselves authored", async () => {
    const own = await createMarkup(sheetIdA, 900, 900, userToken);
    const snap = snapshotForRestore(own);
    expect(snap.createdBy).toBe(userId);
    expect((await apiDelete("/api/takeoff/markups/bulk", { ids: [own.id] }, userToken)).status).toBe(200);

    const res = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: [snap] },
      userToken,
    );
    expect(res.status).toBe(200);

    const refreshed = await fetchMarkupsForSheet(sheetIdA, userToken);
    expect(refreshed.find((r) => r.id === own.id && r.createdBy === userId)).toBeTruthy();
  });

  it("surfaces every reason in a mixed-reason batch via failuresByReason and inserts no rows", async () => {
    // adminOwned lives in the regular user's org but was authored by
    // the admin → triggers `not_owner` for the regular user.
    // otherOrgOwned lives in the OTHER org entirely → triggers
    // `access_denied` for the regular user.
    const adminOwned = await createMarkup(sheetIdA, 1000, 1000);
    const otherOrgOwned = await createMarkup(otherOrgSheetId, 1001, 1001, otherOrgToken);
    const snapshots = [adminOwned, otherOrgOwned].map(snapshotForRestore);

    expect((await apiDelete("/api/takeoff/markups/bulk", { ids: [adminOwned.id] })).status).toBe(200);
    expect((await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [otherOrgOwned.id] },
      otherOrgToken,
    )).status).toBe(200);

    const res = await apiPost(
      "/api/takeoff/markups/restore-bulk",
      { markups: snapshots },
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
    expect(notOwnerGroup.failedMarkupIds).toEqual(
      expect.arrayContaining([adminOwned.id, otherOrgOwned.id]),
    );

    expect(res.body.failedMarkupIds).toEqual(
      expect.arrayContaining([adminOwned.id, otherOrgOwned.id]),
    );

    // Atomicity — neither row was inserted in either org.
    const refreshedA = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshedA.find((r) => r.id === adminOwned.id)).toBeUndefined();
    const refreshedOther = await fetchMarkupsForSheet(otherOrgSheetId, otherOrgToken);
    expect(refreshedOther.find((r) => r.id === otherOrgOwned.id)).toBeUndefined();
  });

  it("rolls the entire restore back when one id is still live (conflict atomicity)", async () => {
    const liveMarkup = await createMarkup(sheetIdA, 1100, 1100);
    const deletedMarkup = await createMarkup(sheetIdA, 1110, 1110);
    expect((await apiDelete(
      "/api/takeoff/markups/bulk",
      { ids: [deletedMarkup.id] },
    )).status).toBe(200);

    const res = await apiPost("/api/takeoff/markups/restore-bulk", {
      markups: [snapshotForRestore(liveMarkup), snapshotForRestore(deletedMarkup)],
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("conflict");
    expect(res.body.failedMarkupIds).toEqual([liveMarkup.id]);

    // The deleted markup did NOT get restored — the conflict pre-check
    // bails out before the transaction opens, so partial restores
    // never commit.
    const refreshed = await fetchMarkupsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === deletedMarkup.id)).toBeUndefined();
    expect(refreshed.find((r) => r.id === liveMarkup.id)).toBeTruthy();
  });

  it("rejects malformed payloads with 400", async () => {
    const empty = await apiPost("/api/takeoff/markups/restore-bulk", { markups: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.reason).toBe("validation");

    const missing = await apiPost("/api/takeoff/markups/restore-bulk", {});
    expect(missing.status).toBe(400);

    const wrongShape = await apiPost("/api/takeoff/markups/restore-bulk", {
      markups: [
        {
          // missing required fields (sheetId, organizationId, createdBy, tool, points, color, thickness)
          id: "abc",
        },
      ],
    });
    expect(wrongShape.status).toBe(400);
    expect(wrongShape.body.reason).toBe("validation");
    expect(wrongShape.body.failedMarkupIds).toEqual(["abc"]);
  });
});
