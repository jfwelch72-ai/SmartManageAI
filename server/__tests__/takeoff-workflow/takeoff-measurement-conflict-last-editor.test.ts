/**
 * Task #2656 — Coverage for the conflict-dialog "lastEditor" lookup
 * added in Task #2652.
 *
 * The 409 body returned by `PATCH /api/takeoff/measurements/:id` on a
 * stale `expectedVersion` MUST include the teammate who last UPDATEd
 * the row, joined from `audit_log` → `users` so the client conflict
 * dialog can name them ("Jane Doe just edited this") instead of the
 * generic "another teammate". Regressions worth pinning:
 *   - The server forgetting to JOIN users (lastEditor would lose
 *     firstName/lastName).
 *   - audit_log shape drift (entityType / action filter no longer
 *     matching what `logUpdate` writes).
 *   - The lookup picking the wrong row (e.g. a CREATE row, or a row
 *     for a different measurement) and naming the wrong person.
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

const TEST_PREFIX = "__takeoff_meas_conflict_editor__";

let app: Express;
let server: Server;
let userAToken: string;
let userBToken: string;
let userBFirst: string;
let userBLast: string;
let orgId: string;
let bidId: string;
let sheetId: string;

function apiPost(token: string, path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiPatch(token: string, path: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function cleanup(): Promise<void> {
  const orgIdsResult = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgIdsResult as unknown as { rows: Array<{ id: string }> }).rows;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    const measurementSubquery = sql`(SELECT id FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery})`;
    await db.execute(sql`DELETE FROM audit_log WHERE entity_type = 'takeoff_measurement' AND entity_id IN ${measurementSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE organization_id = ${id})`).catch(() => {});
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
    name: "Conflict Editor Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const [userA] = await db.insert(users).values({
    email: `${slug}-a@test.local`,
    passwordHash,
    firstName: "Alice",
    lastName: "Architect",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  userAToken = generateToken(userA.id, userA.tokenVersion ?? 0);

  userBFirst = "Bob";
  userBLast = "Builder";
  const [userB] = await db.insert(users).values({
    email: `${slug}-b@test.local`,
    passwordHash,
    firstName: userBFirst,
    lastName: userBLast,
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning();
  userBToken = generateToken(userB.id, userB.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-B`,
    name: "Conflict Bid",
    clientName: "Conflict Client",
    gcOrganizationId: orgId,
  }).returning();
  bidId = bid.id;

  const planRes = await apiPost(userAToken, `/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: `https://example.com/plan-${Date.now()}.pdf`,
    fileName: "Conflict Plan",
  });
  expect(planRes.status).toBe(201);
  sheetId = (planRes.body as { sheets: { id: string }[] }).sheets[0].id;

  await apiPatch(userAToken, `/api/takeoff/sheets/${sheetId}/calibration`, {
    scalePxPerFoot: 10,
    units: "ft",
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("PATCH /api/takeoff/measurements/:id — 409 names the teammate from audit_log (Task #2656)", () => {
  it("returns lastEditor.firstName/lastName from the most recent UPDATE row in audit_log", async () => {
    // Alice creates a measurement (version 1).
    const create = await apiPost(userAToken, `/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: "Original",
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      source: "USER",
      snapHitRatio: 1.0,
      unitCost: 0,
    });
    expect(create.status).toBe(201);
    const measurementId = (create.body as { id: string }).id;

    // Bob updates it (version → 2). This writes the audit_log UPDATE
    // row that the conflict lookup must surface.
    const bobUpdate = await apiPatch(userBToken, `/api/takeoff/measurements/${measurementId}`, {
      label: "Bob's edit",
      expectedVersion: 1,
    });
    expect(bobUpdate.status).toBe(200);
    expect((bobUpdate.body as { version: number }).version).toBe(2);

    // Alice now PATCHes with the stale version — must 409 with the
    // teammate name (Bob) joined in from audit_log → users.
    const stale = await apiPatch(userAToken, `/api/takeoff/measurements/${measurementId}`, {
      label: "Alice's stale edit",
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);

    const body = stale.body as {
      reason: string;
      currentVersion: number;
      current: { label: string };
      lastEditor: { id: string; firstName: string | null; lastName: string | null; editedAt: string } | null;
    };
    expect(body.reason).toBe("version_conflict");
    expect(body.currentVersion).toBe(2);
    expect(body.current.label).toBe("Bob's edit");

    expect(body.lastEditor).not.toBeNull();
    expect(body.lastEditor!.firstName).toBe(userBFirst);
    expect(body.lastEditor!.lastName).toBe(userBLast);
    // editedAt should be a parseable ISO timestamp.
    expect(body.lastEditor!.editedAt).toBeTruthy();
    expect(Number.isFinite(new Date(body.lastEditor!.editedAt).getTime())).toBe(true);
  });

  it("picks the most recent UPDATE row, not an earlier editor or the CREATE row", async () => {
    // Alice creates (CREATE audit row → Alice).
    const create = await apiPost(userAToken, `/api/takeoff/sheets/${sheetId}/measurements`, {
      type: "LINEAR",
      label: "Multi-editor",
      points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
      source: "USER",
      snapHitRatio: 1.0,
      unitCost: 0,
    });
    expect(create.status).toBe(201);
    const measurementId = (create.body as { id: string }).id;

    // Alice updates first (UPDATE audit row → Alice, v2).
    const aliceUpdate = await apiPatch(userAToken, `/api/takeoff/measurements/${measurementId}`, {
      label: "Alice first",
      expectedVersion: 1,
    });
    expect(aliceUpdate.status).toBe(200);

    // Then Bob updates (UPDATE audit row → Bob, v3). This is the
    // edit the conflict dialog must surface.
    const bobUpdate = await apiPatch(userBToken, `/api/takeoff/measurements/${measurementId}`, {
      label: "Bob latest",
      expectedVersion: 2,
    });
    expect(bobUpdate.status).toBe(200);

    // Alice now sends a stale version — the lastEditor must be Bob
    // (the most recent UPDATE actor), not Alice (CREATE / first
    // UPDATE).
    const stale = await apiPatch(userAToken, `/api/takeoff/measurements/${measurementId}`, {
      label: "Alice stale",
      expectedVersion: 1,
    });
    expect(stale.status).toBe(409);
    const body = stale.body as {
      lastEditor: { firstName: string | null; lastName: string | null } | null;
    };
    expect(body.lastEditor).not.toBeNull();
    expect(body.lastEditor!.firstName).toBe(userBFirst);
    expect(body.lastEditor!.lastName).toBe(userBLast);
  });
});
