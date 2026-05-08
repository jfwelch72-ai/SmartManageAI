/**
 * Task #456 — integration coverage for the takeoff markup endpoints across
 * every supported tool type (ARROW, TEXT, RECTANGLE, CLOUD, HIGHLIGHT,
 * FREEHAND). The endpoint is tool-agnostic but historically only TEXT
 * markups exercised the full create→list→delete loop in tests; this suite
 * locks in that all six tools persist correctly, are returned by the GET
 * endpoint, can be deleted, and reject unknown tool values.
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

const TEST_PREFIX = "__takeoff_markup_e2e__";

const TOOL_TYPES = ["ARROW", "TEXT", "RECTANGLE", "CLOUD", "HIGHLIGHT", "FREEHAND"] as const;

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
let bidId: string;
let sheetId: string;

function apiGet(path: string) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string) {
  return request(app).delete(path).set("Cookie", `auth_token=${token}`);
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
    name: "Markup Test Org",
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Markup",
    lastName: "Tester",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  token = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [bid] = await db.insert(bids).values({
    code: `${slug}-BID`,
    name: "Markup Test Bid",
    clientName: "Markup Test Client",
    gcOrganizationId: org.id,
  }).returning();
  bidId = bid.id;

  const planRes = await apiPost(`/api/bids/${bidId}/takeoff/plans`, {
    fileUrl: "https://example.com/markup-plan.pdf",
    fileName: "Markup Plan",
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

function pointsForTool(tool: (typeof TOOL_TYPES)[number]) {
  switch (tool) {
    case "TEXT":
      return [{ x: 50, y: 50 }];
    case "FREEHAND":
      return [
        { x: 0, y: 0 },
        { x: 5, y: 6 },
        { x: 12, y: 14 },
        { x: 25, y: 30 },
      ];
    default:
      return [
        { x: 10, y: 10 },
        { x: 100, y: 80 },
      ];
  }
}

describe("Takeoff Markups — every tool type round-trips", () => {
  const created: Record<string, string> = {};

  for (const tool of TOOL_TYPES) {
    it(`creates and persists a ${tool} markup`, async () => {
      const body: Record<string, unknown> = {
        sheetId,
        tool,
        points: pointsForTool(tool),
        color: "#1e40af",
        thickness: 3,
      };
      if (tool === "TEXT") body.text = `Label for ${tool}`;

      const res = await apiPost("/api/takeoff/markups", body);
      expect(res.status).toBe(201);
      const m = res.body as MarkupResponse;
      expect(m.id).toBeTruthy();
      expect(m.tool).toBe(tool);
      expect(m.sheetId).toBe(sheetId);
      expect(Array.isArray(m.points)).toBe(true);
      expect(m.points.length).toBe(pointsForTool(tool).length);
      expect(m.color).toBe("#1e40af");
      expect(m.thickness).toBe(3);
      if (tool === "TEXT") expect(m.text).toBe("Label for TEXT");
      created[tool] = m.id;
    });
  }

  it("lists every persisted markup for the sheet", async () => {
    const res = await apiGet(`/api/takeoff/sheets/${sheetId}/markups`);
    expect(res.status).toBe(200);
    const list = res.body as MarkupResponse[];
    const tools = new Set(list.map((m) => m.tool));
    for (const t of TOOL_TYPES) expect(tools.has(t)).toBe(true);
    // Points were stored as JSON text but must come back parsed.
    for (const m of list) expect(Array.isArray(m.points)).toBe(true);
  });

  it("rejects unknown tool values", async () => {
    const res = await apiPost("/api/takeoff/markups", {
      sheetId,
      tool: "NOT_A_TOOL",
      points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      color: "#000000",
      thickness: 1,
    });
    expect(res.status).toBe(400);
  });

  it("deletes each markup type and removes it from the listing", async () => {
    for (const tool of TOOL_TYPES) {
      const id = created[tool];
      expect(id, `missing created id for ${tool}`).toBeTruthy();
      const del = await apiDelete(`/api/takeoff/markups/${id}`);
      expect(del.status).toBe(200);
    }
    const after = await apiGet(`/api/takeoff/sheets/${sheetId}/markups`);
    expect(after.status).toBe(200);
    const remaining = after.body as MarkupResponse[];
    const remainingIds = new Set(remaining.map((m) => m.id));
    for (const tool of TOOL_TYPES) {
      expect(remainingIds.has(created[tool])).toBe(false);
    }
  });
});
