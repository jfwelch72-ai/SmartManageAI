/**
 * Task #1989 — Integration coverage for the bulk takeoff measurement
 * PATCH endpoint introduced to coalesce multi-measurement edits (e.g.
 * a 50-row category re-assign from `handleBulkCategoryAssign`) into a
 * single round-trip. Mirrors the markup-side suite in
 * `takeoff-markups-bulk.test.ts` (Task #1752 / #1768) so the
 * measurement endpoint locks in the same atomic + structured-failure
 * contract the client now relies on:
 *
 *   - happy path: every row's mutable fields are written atomically and
 *     the response echoes the rebuilt rows back to the caller (so the
 *     hook's optimistic write doesn't have to guess)
 *   - auth: an unauthenticated request is rejected
 *   - cross-org isolation: a user from a different org cannot mutate
 *     another tenant's measurements (verified through the sheet→bid→org
 *     chain since takeoff_measurements has no `organizationId` column)
 *   - cross-sheet rejection: a payload that mixes measurements from
 *     two sheets is rejected with 400 (every caller operates inside
 *     one sheet by definition)
 *   - partial-failure atomicity: if any id is missing the whole
 *     request 404s and NO row is mutated (transaction rollback) — the
 *     critical contract the optimistic-rollback test on the client
 *     leans on
 *   - validation: zod errors come back as 400 with the offending
 *     measurement ids enumerated so the client toast can name them
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

const TEST_PREFIX = "__takeoff_meas_bulk__";

interface MeasurementResponse {
  id: string;
  sheetId: string;
  type: string;
  label: string;
  categoryId: string | null;
  costCodeId: string | null;
  unitCost: number | null;
  groupId: string | null;
  lineStyle: string;
  lineWidth: number;
  color: string | null;
  points: { x: number; y: number }[];
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
    name: "Bulk Measurement Org",
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

  // Second org so we can verify cross-tenant isolation through the
  // sheet→bid→org chain (takeoff_measurements has no organizationId
  // column of its own — access is gated by sheet ownership).
  const otherSlug = `${slug}-other`;
  const [otherOrg] = await db.insert(organizations).values({
    name: "Other Bulk Measurement Org",
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
    name: "Bulk Measurement Bid",
    clientName: "Bulk Measurement Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  // Two plans so the cross-sheet rejection path has two distinct
  // sheetIds to mix across.
  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-meas-plan-a.pdf",
    fileName: "Bulk Meas Plan A",
  });
  expect(planRes.status).toBe(201);
  sheetIdA = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  const planResB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/bulk-meas-plan-b.pdf",
    fileName: "Bulk Meas Plan B",
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

async function createMeasurement(
  sheetId: string,
  label: string,
  token = adminToken,
): Promise<MeasurementResponse> {
  const res = await apiPost(
    `/api/takeoff/sheets/${sheetId}/measurements`,
    {
      type: "LINEAR",
      label,
      points: [{ x: 10, y: 10 }, { x: 100, y: 10 }],
      color: "#3b82f6",
    },
    token,
  );
  expect(res.status).toBe(201);
  return res.body as MeasurementResponse;
}

async function fetchMeasurementsForSheet(sheetId: string): Promise<MeasurementResponse[]> {
  const res = await apiGet(`/api/takeoff/sheets/${sheetId}/measurements`);
  expect(res.status).toBe(200);
  return res.body as MeasurementResponse[];
}

describe("PATCH /api/takeoff/measurements/bulk (Task #1989)", () => {
  it("happy path: atomically updates every row's mutable fields in one request", async () => {
    const m1 = await createMeasurement(sheetIdA, "Curb run A");
    const m2 = await createMeasurement(sheetIdA, "Curb run B");
    const m3 = await createMeasurement(sheetIdA, "Curb run C");

    // Mix of fields per entry — proves the route doesn't require a
    // homogeneous payload (the real `handleBulkCategoryAssign` always
    // sends categoryId, but the styling panel will eventually want to
    // mix lineStyle / lineWidth / color edits in one request).
    const updates = [
      { id: m1.id, label: "Curb run A — renamed", lineStyle: "dashed" },
      { id: m2.id, lineWidth: 5 },
      { id: m3.id, color: "#22c55e" },
    ];

    const res = await apiPatch("/api/takeoff/measurements/bulk", { updates });
    expect(res.status).toBe(200);
    const returned = res.body as MeasurementResponse[];
    expect(returned).toHaveLength(3);
    const byId = new Map(returned.map((r) => [r.id, r]));
    expect(byId.get(m1.id)?.label).toBe("Curb run A — renamed");
    expect(byId.get(m1.id)?.lineStyle).toBe("dashed");
    expect(byId.get(m2.id)?.lineWidth).toBe(5);
    expect(byId.get(m3.id)?.color).toBe("#22c55e");

    // Re-read through the GET endpoint so the test confirms the
    // updates actually landed in the DB rather than just the response
    // body the route hand-rolled. Critical because the bulk route
    // skips the per-id audit-log write — if it also accidentally
    // skipped the actual UPDATE we'd have a silent data-loss bug.
    const refreshed = await fetchMeasurementsForSheet(sheetIdA);
    const refreshedById = new Map(refreshed.map((r) => [r.id, r]));
    expect(refreshedById.get(m1.id)?.label).toBe("Curb run A — renamed");
    expect(refreshedById.get(m1.id)?.lineStyle).toBe("dashed");
    expect(refreshedById.get(m2.id)?.lineWidth).toBe(5);
    expect(refreshedById.get(m3.id)?.color).toBe("#22c55e");
  });

  it("rejects unauthenticated requests", async () => {
    const m = await createMeasurement(sheetIdA, "Auth guard probe");
    const res = await apiPatch(
      "/api/takeoff/measurements/bulk",
      { updates: [{ id: m.id, label: "Should not land" }] },
      null,
    );
    expect(res.status).toBe(401);

    const refreshed = await fetchMeasurementsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)?.label).toBe("Auth guard probe");
  });

  it("rejects requests from a different organization", async () => {
    const m = await createMeasurement(sheetIdA, "Cross-org probe");
    const res = await apiPatch(
      "/api/takeoff/measurements/bulk",
      { updates: [{ id: m.id, label: "Should not land" }] },
      otherOrgToken,
    );
    // 403 when the caller can see the sheet exists (sheetAccess.sheet
    // is truthy) — same shape the markup endpoint emits so the client
    // can name the offending row in the toast.
    expect([403, 404]).toContain(res.status);
    expect(["access_denied", "not_found"]).toContain(res.body.reason);
    expect(res.body.failedMeasurementIds).toEqual([m.id]);

    const refreshed = await fetchMeasurementsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)?.label).toBe("Cross-org probe");
  });

  it("rejects payloads that mix measurements from two different sheets", async () => {
    const a = await createMeasurement(sheetIdA, "Same-sheet guard A");
    const b = await createMeasurement(sheetIdB, "Same-sheet guard B");

    const res = await apiPatch("/api/takeoff/measurements/bulk", {
      updates: [
        { id: a.id, label: "A renamed" },
        { id: b.id, label: "B renamed" },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("cross_sheet");
    // The offending row (the one whose sheetId differs from the rest)
    // is named explicitly so the client toast can flash it.
    expect(res.body.failedMeasurementIds).toEqual(expect.arrayContaining([b.id]));

    // Atomicity guard — neither sheet's labels were touched.
    const refreshedA = await fetchMeasurementsForSheet(sheetIdA);
    const refreshedB = await fetchMeasurementsForSheet(sheetIdB);
    expect(refreshedA.find((r) => r.id === a.id)?.label).toBe("Same-sheet guard A");
    expect(refreshedB.find((r) => r.id === b.id)?.label).toBe("Same-sheet guard B");
  });

  it("partial-failure atomicity: a missing id rolls the entire transaction back", async () => {
    const real1 = await createMeasurement(sheetIdA, "Atomic guard 1");
    const real2 = await createMeasurement(sheetIdA, "Atomic guard 2");
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const res = await apiPatch("/api/takeoff/measurements/bulk", {
      updates: [
        { id: real1.id, label: "Should not land 1" },
        { id: real2.id, label: "Should not land 2" },
        { id: fakeId, label: "Phantom row" },
      ],
    });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
    // Only the missing id is enumerated — real ids must NOT appear in
    // the failed set or the client would prune live rows from the
    // cache and the workspace selection.
    expect(res.body.failedMeasurementIds).toEqual([fakeId]);
    expect(res.body.failedMeasurementIds).not.toContain(real1.id);
    expect(res.body.failedMeasurementIds).not.toContain(real2.id);

    // Mirror the markup-bulk's `failuresByReason` shape so the
    // client's `extractMeasurementNotFoundIds` (Task #1970) can pull
    // the not_found ids out of a mixed batch.
    expect(res.body.failuresByReason).toEqual([
      expect.objectContaining({
        reason: "not_found",
        failedMeasurementIds: [fakeId],
      }),
    ]);

    // The transaction never opened — both real rows still have their
    // pre-bulk labels. Without this guard the client's optimistic
    // rollback would leave the DB and the cache out of sync.
    const refreshed = await fetchMeasurementsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === real1.id)?.label).toBe("Atomic guard 1");
    expect(refreshed.find((r) => r.id === real2.id)?.label).toBe("Atomic guard 2");
  });

  it("rejects an empty updates array as 400 (validation)", async () => {
    const res = await apiPatch("/api/takeoff/measurements/bulk", { updates: [] });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("validation");
  });

  it("rejects an entry with no editable fields (id-only) as 400 (validation)", async () => {
    const m = await createMeasurement(sheetIdA, "Validation guard");
    const res = await apiPatch("/api/takeoff/measurements/bulk", {
      updates: [{ id: m.id }],
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe("validation");
    // The id of the offending entry is mapped back from the Zod
    // path so the client toast can flash it.
    expect(res.body.failedMeasurementIds).toEqual([m.id]);

    // The DB row is untouched.
    const refreshed = await fetchMeasurementsForSheet(sheetIdA);
    expect(refreshed.find((r) => r.id === m.id)?.label).toBe("Validation guard");
  });

  it("supports nullable fields (categoryId / costCodeId / unitCost = null)", async () => {
    // Critical for the "Unassign category" UX: the client sends
    // `categoryId: null` and the row should land with NULL in the DB
    // rather than the route silently filtering nullable fields out.
    const m = await createMeasurement(sheetIdA, "Nullable field probe");

    const res = await apiPatch("/api/takeoff/measurements/bulk", {
      updates: [
        {
          id: m.id,
          categoryId: null,
          costCodeId: null,
          unitCost: null,
        },
      ],
    });
    expect(res.status).toBe(200);
    const returned = res.body as MeasurementResponse[];
    expect(returned[0].categoryId).toBeNull();
    expect(returned[0].costCodeId).toBeNull();
    expect(returned[0].unitCost).toBeNull();
  });
});
