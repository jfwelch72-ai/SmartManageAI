/**
 * Task #1984 — server-side coverage for the `MARKUP_DELETED` collab
 * event that Task #1971 wired into the single + bulk takeoff-markup
 * DELETE routes.
 *
 * Before this suite the broadcast contract lived only in a client-side
 * cache-prune test (Task #1971): if the server quietly stopped emitting
 * the event (wrong type name, wrong room id, wrong payload shape) the
 * regression would only surface the next time a teammate noticed a
 * stale canvas after someone else removed a markup. These tests pin
 * the broadcast itself by mocking `broadcastTakeoffEvent` and
 * asserting the route hands it:
 *
 *   - the type literal `MARKUP_DELETED`,
 *   - the right room id (bidId for bid-context sheets, projectId for
 *     project-context sheets, resolved via `resolveRoomIdForSheet`),
 *   - a `{ sheetId, markupIds }` payload with the deleted ids grouped
 *     per sheet (the bulk route can in principle span multiple
 *     sheets and must emit one event per sheet — matching the per-
 *     sheet shape `useTakeoffCollaboration` consumes on the client).
 *
 * Both the single-id route (`DELETE /api/takeoff/markups/:markupId`)
 * and the bulk route (`DELETE /api/takeoff/markups/bulk`) are
 * exercised, including the no-broadcast path for an "orphan" sheet
 * with neither bidId nor projectId set (room id resolves to null).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { Mock } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

// IMPORTANT: hoisted by vitest above every other import so that
// `takeoffCategoryRoutes.ts` (loaded transitively when we import
// `../../routes` below) sees the mocked module instead of the real
// WebSocket-driven implementation. We replace both exports:
//
//   - `broadcastTakeoffEvent` becomes a `vi.fn()` so we can spy on
//     every call from the DELETE handlers.
//   - `setupTakeoffCollaboration` becomes a no-op so `registerRoutes`
//     does not actually attach a real WebSocket server to the test
//     HTTP server (the suite never opens a socket).
vi.mock("../../takeoffCollaboration", () => ({
  broadcastTakeoffEvent: vi.fn(),
  setupTakeoffCollaboration: vi.fn(),
}));

import { db } from "../../db";
import { users, organizations, bids, projects, takeoffSheets, takeoffMarkups } from "@shared/schema";
import { generateToken } from "../../auth";

const TEST_PREFIX = "__takeoff_markup_delete_broadcast__";

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
let token: string;
let orgId: string;
let userId: string;
let bidId: string;
let projectId: string;
let sheetIdBidA: string;
let sheetIdBidB: string;
let sheetIdProject: string;
let orphanSheetId: string;

let broadcastSpy: Mock;

function apiPost(path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

function apiDelete(path: string, body?: Record<string, unknown>) {
  const r = request(app).delete(path).set("Cookie", `auth_token=${token}`);
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

  for (const id of orgIds) {
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${id})`;
    const projectSubquery = sql`(SELECT id FROM projects WHERE gc_organization_id = ${id})`;
    const bidSheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE bid_id IN ${bidSubquery})`;
    const projectSheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE project_id IN ${projectSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id IN ${bidSheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id IN ${projectSheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN ${projectSubquery}`).catch(() => {});
    // Orphan sheets created via direct DB insert with neither bidId
    // nor projectId — clean by organization via the markups they hold,
    // then by direct id below before the org is removed.
    await db.execute(sql`DELETE FROM project_plans WHERE project_id IN ${projectSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../../routes");
  const collab = await import("../../takeoffCollaboration");
  broadcastSpy = collab.broadcastTakeoffEvent as unknown as Mock;

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: "Markup Delete Broadcast Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Broadcast",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  userId = admin.id;
  token = generateToken(admin.id, admin.tokenVersion ?? 0);

  // Bid-context fixtures: one bid + two sheets so the bulk delete test
  // can group ids by sheet and verify a per-sheet broadcast for each.
  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Broadcast Bid",
    clientName: "Broadcast Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  const planResA = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/broadcast-plan-a.pdf",
    fileName: "Broadcast Plan A",
  });
  expect(planResA.status).toBe(201);
  sheetIdBidA = (planResA.body as { sheets: { id: string }[] }).sheets[0].id;

  const planResB = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/broadcast-plan-b.pdf",
    fileName: "Broadcast Plan B",
  });
  expect(planResB.status).toBe(201);
  sheetIdBidB = (planResB.body as { sheets: { id: string }[] }).sheets[0].id;

  // Project-context fixture so we can assert the room id resolves to
  // `projectId` when a sheet has no bidId — the other branch of
  // `resolveRoomIdForSheet`.
  const [project] = await db.insert(projects).values({
    code: `${slug}-PROJ`,
    name: "Broadcast Project",
    clientName: "Broadcast Project Client",
    gcOrganizationId: org.id,
  }).returning();
  projectId = project.id;

  const planResProj = await apiPost(`/api/projects/${projectId}/takeoff/plans`, {
    fileUrl: "https://example.com/broadcast-plan-proj.pdf",
    fileName: "Broadcast Plan Project",
  });
  expect(planResProj.status).toBe(201);
  sheetIdProject = (planResProj.body as { sheets: { id: string }[] }).sheets[0].id;

  // Orphan sheet — no bidId, no projectId — so `resolveRoomIdForSheet`
  // returns null and the route MUST skip the broadcast (rather than
  // throwing or broadcasting to an undefined room).
  const [orphan] = await db.insert(takeoffSheets).values({
    imageUrl: "https://example.com/broadcast-plan-orphan.pdf",
    sheetIndex: 0,
    sheetName: "Orphan Sheet",
  }).returning();
  orphanSheetId = orphan.id;
}, 60_000);

afterAll(async () => {
  // Remove the orphan sheet (and any markups it held) ahead of the
  // org-scoped cleanup, since it isn't reachable via bid_id /
  // project_id subqueries.
  if (orphanSheetId) {
    await db.execute(sql`DELETE FROM takeoff_markups WHERE sheet_id = ${orphanSheetId}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE id = ${orphanSheetId}`).catch(() => {});
  }
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

beforeEach(() => {
  broadcastSpy.mockClear();
});

async function createMarkup(sheetId: string, x = 10, y = 10): Promise<MarkupResponse> {
  const res = await apiPost("/api/takeoff/markups", {
    sheetId,
    tool: "RECTANGLE",
    points: [
      { x, y },
      { x: x + 50, y: y + 50 },
    ],
    color: "#222222",
    thickness: 2,
  });
  expect(res.status).toBe(201);
  return res.body as MarkupResponse;
}

// Direct-DB markup creation for the orphan-sheet case — the public
// POST `/api/takeoff/markups` route requires the sheet to belong to a
// bid or project the caller can access, but we deliberately want a
// sheet with NEITHER set so we can exercise the null-room branch.
async function createMarkupOnOrphanSheet(sheetId: string): Promise<{ id: string; sheetId: string }> {
  const [m] = await db.insert(takeoffMarkups).values({
    sheetId,
    organizationId: orgId,
    createdBy: userId,
    tool: "RECTANGLE",
    points: JSON.stringify([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
    color: "#000000",
    thickness: 1,
  }).returning({ id: takeoffMarkups.id, sheetId: takeoffMarkups.sheetId });
  return m;
}

describe("DELETE /api/takeoff/markups/:markupId — MARKUP_DELETED broadcast", () => {
  it("emits MARKUP_DELETED to the bid room with { sheetId, markupIds: [id] } for a bid-context sheet", async () => {
    const m = await createMarkup(sheetIdBidA);
    expect(broadcastSpy).not.toHaveBeenCalled();

    const res = await apiDelete(`/api/takeoff/markups/${m.id}`);
    expect(res.status).toBe(200);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const [roomId, type, payload] = broadcastSpy.mock.calls[0];
    expect(type).toBe("MARKUP_DELETED");
    expect(roomId).toBe(bidId);
    expect(payload).toEqual({ sheetId: sheetIdBidA, markupIds: [m.id] });
  });

  it("emits MARKUP_DELETED to the project room for a project-context sheet (no bidId)", async () => {
    const m = await createMarkup(sheetIdProject);

    const res = await apiDelete(`/api/takeoff/markups/${m.id}`);
    expect(res.status).toBe(200);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const [roomId, type, payload] = broadcastSpy.mock.calls[0];
    expect(type).toBe("MARKUP_DELETED");
    // Confirms `resolveRoomIdForSheet` falls through to `projectId`
    // when `bidId` is null — and conversely that we did NOT misroute
    // to the bid room.
    expect(roomId).toBe(projectId);
    expect(roomId).not.toBe(bidId);
    expect(payload).toEqual({ sheetId: sheetIdProject, markupIds: [m.id] });
  });

  it("skips the broadcast when the sheet has neither bidId nor projectId (no room to target)", async () => {
    const m = await createMarkupOnOrphanSheet(orphanSheetId);

    const res = await apiDelete(`/api/takeoff/markups/${m.id}`);
    expect(res.status).toBe(200);

    // No room → no broadcast (the route must not throw or try to
    // broadcast to a null/undefined room id).
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/takeoff/markups/bulk — MARKUP_DELETED broadcast", () => {
  it("emits one MARKUP_DELETED per affected sheet, grouping markup ids by sheet", async () => {
    // Three markups across two sheets in the same bid: 2 on sheet A,
    // 1 on sheet B. The route must fire ONE broadcast per sheet (both
    // targeting the bid room) with markupIds grouped accordingly.
    const a1 = await createMarkup(sheetIdBidA, 10, 10);
    const a2 = await createMarkup(sheetIdBidA, 20, 20);
    const b1 = await createMarkup(sheetIdBidB, 30, 30);

    broadcastSpy.mockClear();

    const res = await apiDelete("/api/takeoff/markups/bulk", {
      ids: [a1.id, a2.id, b1.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);

    expect(broadcastSpy).toHaveBeenCalledTimes(2);

    // Both calls go to the bid room (both sheets belong to the same bid).
    for (const call of broadcastSpy.mock.calls) {
      expect(call[0]).toBe(bidId);
      expect(call[1]).toBe("MARKUP_DELETED");
    }

    const bySheet = new Map<string, string[]>();
    for (const [, , payload] of broadcastSpy.mock.calls) {
      const p = payload as { sheetId: string; markupIds: string[] };
      bySheet.set(p.sheetId, p.markupIds);
    }
    expect(bySheet.has(sheetIdBidA)).toBe(true);
    expect(bySheet.has(sheetIdBidB)).toBe(true);
    expect(new Set(bySheet.get(sheetIdBidA))).toEqual(new Set([a1.id, a2.id]));
    expect(bySheet.get(sheetIdBidB)).toEqual([b1.id]);
  });

  it("targets each sheet's own room when a bulk payload spans bid- and project-context sheets", async () => {
    // Mixed payload: a markup on a bid-context sheet AND a markup on
    // a project-context sheet. The route must emit one broadcast for
    // each, routed to the correct room (bidId vs projectId) — a
    // single global room for the whole batch would be wrong.
    const bidMarkup = await createMarkup(sheetIdBidA, 100, 100);
    const projMarkup = await createMarkup(sheetIdProject, 200, 200);

    broadcastSpy.mockClear();

    const res = await apiDelete("/api/takeoff/markups/bulk", {
      ids: [bidMarkup.id, projMarkup.id],
    });
    expect(res.status).toBe(200);

    expect(broadcastSpy).toHaveBeenCalledTimes(2);

    const byRoom = new Map<string, { sheetId: string; markupIds: string[] }>();
    for (const [roomId, type, payload] of broadcastSpy.mock.calls) {
      expect(type).toBe("MARKUP_DELETED");
      byRoom.set(roomId as string, payload as { sheetId: string; markupIds: string[] });
    }

    expect(byRoom.get(bidId)).toEqual({
      sheetId: sheetIdBidA,
      markupIds: [bidMarkup.id],
    });
    expect(byRoom.get(projectId)).toEqual({
      sheetId: sheetIdProject,
      markupIds: [projMarkup.id],
    });
  });

  it("does not broadcast when the bulk request fails validation or atomicity (no partial canvas pruning)", async () => {
    // A fake id triggers the `not_found` atomicity rollback before
    // the transaction commits — the broadcast must not fire, otherwise
    // teammates would prune rows that still exist on the server.
    const real = await createMarkup(sheetIdBidA, 300, 300);
    const fakeId = "00000000-0000-0000-0000-0000000000ff";

    broadcastSpy.mockClear();

    const res = await apiDelete("/api/takeoff/markups/bulk", {
      ids: [real.id, fakeId],
    });
    expect(res.status).toBe(404);
    expect(broadcastSpy).not.toHaveBeenCalled();

    // And a malformed payload (validation error) likewise must not
    // broadcast anything.
    const empty = await apiDelete("/api/takeoff/markups/bulk", { ids: [] });
    expect(empty.status).toBe(400);
    expect(broadcastSpy).not.toHaveBeenCalled();
  });
});
