import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  takeoffSheets,
  drawingSets,
  drawingSetItems,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

// ─────────────────────────────────────────────────────────────────────────────
// Drawing-set item endpoints accept a caller-supplied sheetId / revisionId
// (the analog of the storage-key references covered by Task #1303 / #1328).
// These tests assert Org A cannot pin Org B's takeoff sheet onto its own
// drawing set, nor can it touch Org B's drawing-set items at all.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_PREFIX = "__drawing_set_iso__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  drawingSetId: string;
  sheetId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Drawing Set Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Drawing",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Drawing Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [sheet] = await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${label}-${Date.now()}.png`,
    sheetIndex: 0,
    sheetName: `Sheet ${label}`,
  }).returning();

  const [set] = await db.insert(drawingSets).values({
    projectId: project.id,
    organizationId: org.id,
    name: `Drawing Set ${label}`,
    description: null,
    isPrimary: false,
    createdByUserId: user.id,
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    drawingSetId: set.id,
    sheetId: sheet.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM drawing_set_items WHERE drawing_set_id IN (SELECT id FROM drawing_sets WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM drawing_sets WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

let app: Express;
let server: Server;
let orgA: SeededOrg;
let orgB: SeededOrg;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "/test-bucket/public";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (!res.headersSent) res.status(err?.status || 500).json({ error: err?.message || "error" });
  });

  [orgA, orgB] = await Promise.all([seedOrg("A"), seedOrg("B")]);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Task #1343 — drawing-set item cross-tenant safety", () => {
  it("rejects POST /api/projects/drawing-sets/:setId/items when sheetId belongs to another org", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${orgA.drawingSetId}/items`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: orgB.sheetId });

    expect([400, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);

    const rows = await db
      .select()
      .from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, orgA.drawingSetId));
    expect(rows.length).toBe(0);
  });

  it("accepts POST /api/projects/drawing-sets/:setId/items when sheetId belongs to caller org", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${orgA.drawingSetId}/items`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: orgA.sheetId });

    expect(res.status).toBe(201);
    expect(res.body.sheetId).toBe(orgA.sheetId);
    expect(res.body.drawingSetId).toBe(orgA.drawingSetId);

    if (res.body?.id) {
      await db.delete(drawingSetItems).where(eq(drawingSetItems.id, res.body.id)).catch(() => {});
    }
  });

  it("rejects POST /api/projects/drawing-sets/:setId/items targeting another org's drawing set", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${orgB.drawingSetId}/items`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: orgA.sheetId });

    expect([403, 404]).toContain(res.status);

    const rows = await db
      .select()
      .from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, orgB.drawingSetId));
    expect(rows.length).toBe(0);
  });

  it("rejects POST /api/projects/drawing-sets/:setId/items/bulk when any sheetId belongs to another org", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${orgA.drawingSetId}/items/bulk`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        items: [
          { sheetId: orgA.sheetId },
          { sheetId: orgB.sheetId },
        ],
      });

    expect([400, 403, 404]).toContain(res.status);

    const rows = await db
      .select()
      .from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, orgA.drawingSetId));
    expect(rows.length).toBe(0);
  });

  it("rejects GET /api/projects/drawing-sets/:setId/items for another org's drawing set", async () => {
    const res = await request(app)
      .get(`/api/projects/drawing-sets/${orgB.drawingSetId}/items`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
  });
});
