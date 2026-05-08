/**
 * Task #2631 — Integration coverage for the AI map-reduce review-batch
 * lifecycle introduced in Task #2617:
 *
 *   POST /ai-estimator/draft/map-reduce/apply  — creates one
 *     `takeoff_measurement_groups` row per touched sheet (named
 *     "AI map-reduce draft — <YYYY-MM-DD>") and stamps every freshly
 *     inserted measurement with that group's id.
 *   DELETE /api/takeoff/groups/:id?deleteMeasurements=true — cascades
 *     the wipe to every measurement carrying the group id and reports
 *     the row count via `deletedMeasurementCount`.
 *   DELETE /api/takeoff/groups/:id (no flag) — drops only the group;
 *     the FK on `takeoff_measurements.group_id` (`onDelete: set null`)
 *     keeps the rows around with a NULL groupId so the estimator can
 *     re-bucket them instead of losing data.
 *
 * The flow only had unit-level coverage before — this suite locks in
 * the real HTTP shape (router + DB) end-to-end, including the
 * "two apply calls in the same day must reuse the same per-sheet
 * group" anti-fragmentation guarantee.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq, inArray } from "drizzle-orm";

import { db } from "../../db";
import {
  users,
  organizations,
  bids,
  takeoffSheets,
  takeoffMeasurements,
  takeoffMeasurementGroups,
} from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__ai_mr_group__";

let app: Express;
let server: Server;
let adminToken: string;
let bidId: string;
let sheetAId: string;
let sheetBId: string;
const sheetANumber = `${TEST_PREFIX}A-100`;
const sheetBNumber = `${TEST_PREFIX}B-200`;

function apiPost(path: string, body?: Record<string, unknown>, token: string | null = adminToken) {
  const r = request(app).post(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string | null = adminToken) {
  const r = request(app).delete(path);
  if (token) r.set("Cookie", `auth_token=${token}`);
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
    await db.execute(sql`DELETE FROM takeoff_measurement_groups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
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
    name: "AI Map-Reduce Group Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  // SUPER_ADMIN bypasses both `requireEstimatorAccess` (no
  // `ai_estimator_user_access` row to maintain) and `verifySheetAccess`
  // / `verifyGroupAccess` parent-org checks. The lifecycle under test
  // does not depend on the role-gating logic, so this keeps the
  // fixture minimal.
  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "AI MR",
    lastName: "Tester",
    role: "SUPER_ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "AI Map-Reduce Group Bid",
    clientName: "AI MR Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  // Direct-insert sheets so we can pin known sheetNumber values to
  // drive deterministic citation matching in `/draft/map-reduce/apply`.
  const inserted = await db.insert(takeoffSheets).values([
    {
      bidId,
      imageUrl: "https://example.com/ai-mr-sheet-a.png",
      sheetIndex: 0,
      sheetNumber: sheetANumber,
      sheetName: `${TEST_PREFIX}sheet-a`,
    },
    {
      bidId,
      imageUrl: "https://example.com/ai-mr-sheet-b.png",
      sheetIndex: 1,
      sheetNumber: sheetBNumber,
      sheetName: `${TEST_PREFIX}sheet-b`,
    },
  ]).returning({ id: takeoffSheets.id, sheetIndex: takeoffSheets.sheetIndex });
  const byIndex = new Map(inserted.map((s) => [s.sheetIndex, s.id]));
  sheetAId = byIndex.get(0)!;
  sheetBId = byIndex.get(1)!;
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

const APPLY_URL = "/api/ai-estimator/draft/map-reduce/apply";

describe("AI map-reduce review-batch lifecycle (Task #2631)", () => {
  it(
    "two apply calls on the same day reuse the same per-sheet group id (no fragmentation)",
    async () => {
      const callOne = await apiPost(APPLY_URL, {
        bidId,
        measurements: [
          {
            label: `${TEST_PREFIX}call1-A`,
            type: "LINEAR",
            value: 50,
            unit: "LF",
            sheetCitations: [sheetANumber],
          },
          {
            label: `${TEST_PREFIX}call1-B`,
            type: "AREA",
            value: 200,
            unit: "SF",
            sheetCitations: [sheetBNumber],
          },
        ],
      });
      expect(callOne.status).toBe(200);
      expect(callOne.body.inserted).toBe(2);
      expect(callOne.body.groupName).toMatch(/^AI map-reduce draft — \d{4}-\d{2}-\d{2}$/);
      expect(Array.isArray(callOne.body.groupIds)).toBe(true);
      // One group per touched sheet.
      expect(callOne.body.groupIds).toHaveLength(2);

      const callTwo = await apiPost(APPLY_URL, {
        bidId,
        measurements: [
          {
            label: `${TEST_PREFIX}call2-A`,
            type: "LINEAR",
            value: 75,
            unit: "LF",
            sheetCitations: [sheetANumber],
          },
          {
            label: `${TEST_PREFIX}call2-B`,
            type: "AREA",
            value: 400,
            unit: "SF",
            sheetCitations: [sheetBNumber],
          },
        ],
      });
      expect(callTwo.status).toBe(200);
      expect(callTwo.body.inserted).toBe(2);
      expect(callTwo.body.groupName).toBe(callOne.body.groupName);
      // Same set of group ids — second call must reuse the per-sheet
      // group rather than spawning a parallel "draft — same date" row.
      expect(new Set(callTwo.body.groupIds)).toEqual(new Set(callOne.body.groupIds));

      // Verify against the DB: every freshly inserted measurement on a
      // given sheet shares one and only one groupId, and that groupId
      // matches the per-sheet group row's id.
      const rows = await db
        .select({
          id: takeoffMeasurements.id,
          sheetId: takeoffMeasurements.sheetId,
          groupId: takeoffMeasurements.groupId,
          label: takeoffMeasurements.label,
        })
        .from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.sheetId, [sheetAId, sheetBId]));

      const groupBySheet = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!r.groupId) continue;
        if (!groupBySheet.has(r.sheetId)) groupBySheet.set(r.sheetId, new Set());
        groupBySheet.get(r.sheetId)!.add(r.groupId);
      }
      expect(groupBySheet.get(sheetAId)?.size).toBe(1);
      expect(groupBySheet.get(sheetBId)?.size).toBe(1);

      const sheetAGroupId = [...groupBySheet.get(sheetAId)!][0];
      const sheetBGroupId = [...groupBySheet.get(sheetBId)!][0];
      // Sanity: per-sheet groups are distinct rows.
      expect(sheetAGroupId).not.toBe(sheetBGroupId);
      expect(new Set([sheetAGroupId, sheetBGroupId])).toEqual(new Set(callOne.body.groupIds));

      // Each sheet should now hold both call-1 and call-2 measurements
      // under that single group id (4 rows total across the two sheets).
      const aRows = rows.filter((r) => r.sheetId === sheetAId);
      const bRows = rows.filter((r) => r.sheetId === sheetBId);
      expect(aRows).toHaveLength(2);
      expect(bRows).toHaveLength(2);
      for (const r of aRows) expect(r.groupId).toBe(sheetAGroupId);
      for (const r of bRows) expect(r.groupId).toBe(sheetBGroupId);
    },
    60_000,
  );

  it(
    "DELETE /api/takeoff/groups/:id?deleteMeasurements=true cascades the wipe and reports the count",
    async () => {
      // Fresh apply so this test is independent of the suite ordering.
      const apply = await apiPost(APPLY_URL, {
        bidId,
        measurements: [
          {
            label: `${TEST_PREFIX}cascade-1`,
            type: "LINEAR",
            value: 10,
            unit: "LF",
            sheetCitations: [sheetANumber],
          },
          {
            label: `${TEST_PREFIX}cascade-2`,
            type: "LINEAR",
            value: 20,
            unit: "LF",
            sheetCitations: [sheetANumber],
          },
          {
            label: `${TEST_PREFIX}cascade-3`,
            type: "LINEAR",
            value: 30,
            unit: "LF",
            sheetCitations: [sheetANumber],
          },
        ],
      });
      expect(apply.status).toBe(200);
      const groupIds: string[] = apply.body.groupIds;
      expect(groupIds).toHaveLength(1);
      const groupId = groupIds[0];

      // Count every measurement carrying this groupId — includes rows
      // from the previous test, which is exactly what cascade should
      // wipe in a single call.
      const before = await db
        .select({ id: takeoffMeasurements.id })
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.groupId, groupId));
      expect(before.length).toBeGreaterThanOrEqual(3);
      const expectedCascaded = before.length;

      const del = await apiDelete(`/api/takeoff/groups/${groupId}?deleteMeasurements=true`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);
      expect(del.body.deletedMeasurementCount).toBe(expectedCascaded);

      // (a) Group row is gone.
      const groupRow = await db
        .select({ id: takeoffMeasurementGroups.id })
        .from(takeoffMeasurementGroups)
        .where(eq(takeoffMeasurementGroups.id, groupId));
      expect(groupRow).toHaveLength(0);

      // (b) Every measurement that carried the groupId is gone.
      const remaining = await db
        .select({ id: takeoffMeasurements.id })
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.groupId, groupId));
      expect(remaining).toHaveLength(0);

      // (b ii) None of the cascaded ids resurface under any other
      // groupId either — they are physically deleted, not orphaned.
      const resurfaced = await db
        .select({ id: takeoffMeasurements.id })
        .from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.id, before.map((r) => r.id)));
      expect(resurfaced).toHaveLength(0);
    },
    60_000,
  );

  it(
    "DELETE /api/takeoff/groups/:id without the flag drops the group and nulls measurements (FK onDelete: set null)",
    async () => {
      const apply = await apiPost(APPLY_URL, {
        bidId,
        measurements: [
          {
            label: `${TEST_PREFIX}nullify-1`,
            type: "AREA",
            value: 100,
            unit: "SF",
            sheetCitations: [sheetBNumber],
          },
          {
            label: `${TEST_PREFIX}nullify-2`,
            type: "AREA",
            value: 250,
            unit: "SF",
            sheetCitations: [sheetBNumber],
          },
        ],
      });
      expect(apply.status).toBe(200);
      const groupIds: string[] = apply.body.groupIds;
      expect(groupIds).toHaveLength(1);
      const groupId = groupIds[0];
      const insertedIds: string[] = apply.body.insertedIds;
      expect(insertedIds).toHaveLength(2);

      const del = await apiDelete(`/api/takeoff/groups/${groupId}`);
      expect(del.status).toBe(200);
      expect(del.body.success).toBe(true);
      // Without the flag the route never enters the cascading branch.
      expect(del.body.deletedMeasurementCount).toBe(0);

      // Group is gone…
      const groupRow = await db
        .select({ id: takeoffMeasurementGroups.id })
        .from(takeoffMeasurementGroups)
        .where(eq(takeoffMeasurementGroups.id, groupId));
      expect(groupRow).toHaveLength(0);

      // …but the measurements survive with a NULL groupId, courtesy
      // of the FK's `onDelete: set null` (so estimators can re-bucket
      // them rather than losing the data).
      const survivors = await db
        .select({
          id: takeoffMeasurements.id,
          groupId: takeoffMeasurements.groupId,
          label: takeoffMeasurements.label,
        })
        .from(takeoffMeasurements)
        .where(inArray(takeoffMeasurements.id, insertedIds));
      expect(survivors).toHaveLength(2);
      for (const row of survivors) {
        expect(row.groupId).toBeNull();
      }
    },
    60_000,
  );
});

