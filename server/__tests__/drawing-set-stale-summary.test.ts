import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

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

// Task #1893 — coverage for the org-scoped roll-up that powers the
// projects-list "out of date drawings" indicator.

const TEST_PREFIX = "__ds_stale_summary__";

interface SeededOrg {
  orgId: string;
  adminToken: string;
  fieldWorkerToken: string;
  staleProjectId: string;
  cleanProjectId: string;
  emptyProjectId: string;
}

let app: Express;
let server: Server;
let seed: SeededOrg;
let otherOrgSeed: { orgId: string; staleProjectId: string };

async function seedOrgWithStaleAndCleanProjects(): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Stale Summary Org ${slug}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Stale",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [fieldWorker] = await db.insert(users).values({
    email: `${slug}-field@test.local`,
    passwordHash,
    firstName: "Stale",
    lastName: "Field",
    role: "FIELD_WORKER",
    organizationId: org.id,
    isActive: true,
  }).returning();

  // Project A — has a stale pinned sheet (v1 pinned, v2 is the active revision)
  const [staleProject] = await db.insert(projects).values({
    name: `Stale Project ${slug}`,
    code: `${TEST_PREFIX}STALE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Stale Client",
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [staleV1] = await db.insert(takeoffSheets).values({
    projectId: staleProject.id,
    imageUrl: `https://example.test/${slug}-stale-Av1.png`,
    sheetIndex: 0,
    sheetName: "A-100",
    revisionLabel: "v1",
    isActive: false,
  }).returning();

  await db.insert(takeoffSheets).values({
    projectId: staleProject.id,
    imageUrl: `https://example.test/${slug}-stale-Av2.png`,
    sheetIndex: 0,
    sheetName: "A-100",
    revisionLabel: "v2",
    isActive: true,
  }).returning();

  const [staleSet] = await db.insert(drawingSets).values({
    projectId: staleProject.id,
    organizationId: org.id,
    name: "Stale Set",
    description: null,
    isPrimary: true,
    createdByUserId: admin.id,
  }).returning();

  await db.insert(drawingSetItems).values({
    drawingSetId: staleSet.id,
    sheetId: staleV1.id,
  });

  // Project B — pins the latest active sheet (no staleness)
  const [cleanProject] = await db.insert(projects).values({
    name: `Clean Project ${slug}`,
    code: `${TEST_PREFIX}CLEAN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Clean Client",
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [cleanSheet] = await db.insert(takeoffSheets).values({
    projectId: cleanProject.id,
    imageUrl: `https://example.test/${slug}-clean.png`,
    sheetIndex: 0,
    sheetName: "B-200",
    revisionLabel: "v1",
    isActive: true,
  }).returning();

  const [cleanSet] = await db.insert(drawingSets).values({
    projectId: cleanProject.id,
    organizationId: org.id,
    name: "Clean Set",
    description: null,
    isPrimary: true,
    createdByUserId: admin.id,
  }).returning();

  await db.insert(drawingSetItems).values({
    drawingSetId: cleanSet.id,
    sheetId: cleanSheet.id,
  });

  // Project C — has drawing sets with no pinned items at all
  const [emptyProject] = await db.insert(projects).values({
    name: `Empty Project ${slug}`,
    code: `${TEST_PREFIX}EMPTY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Empty Client",
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  await db.insert(drawingSets).values({
    projectId: emptyProject.id,
    organizationId: org.id,
    name: "Empty Set",
    description: null,
    isPrimary: true,
    createdByUserId: admin.id,
  });

  return {
    orgId: org.id,
    adminToken: generateToken(admin.id, admin.tokenVersion),
    fieldWorkerToken: generateToken(fieldWorker.id, fieldWorker.tokenVersion),
    staleProjectId: staleProject.id,
    cleanProjectId: cleanProject.id,
    emptyProjectId: emptyProject.id,
  };
}

async function seedOtherOrgWithStaleProject(): Promise<{ orgId: string; staleProjectId: string }> {
  const slug = `${TEST_PREFIX}other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db.insert(organizations).values({
    name: `Other Org ${slug}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Other Project ${slug}`,
    code: `${TEST_PREFIX}OTHER-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Other Client",
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [otherV1] = await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${slug}-Av1.png`,
    sheetIndex: 0,
    sheetName: "A-100",
    revisionLabel: "v1",
    isActive: false,
  }).returning();

  await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${slug}-Av2.png`,
    sheetIndex: 0,
    sheetName: "A-100",
    revisionLabel: "v2",
    isActive: true,
  });

  const [otherSet] = await db.insert(drawingSets).values({
    projectId: project.id,
    organizationId: org.id,
    name: "Other Set",
    description: null,
    isPrimary: true,
    createdByUserId: null,
  }).returning();

  await db.insert(drawingSetItems).values({
    drawingSetId: otherSet.id,
    sheetId: otherV1.id,
  });

  return { orgId: org.id, staleProjectId: project.id };
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

  seed = await seedOrgWithStaleAndCleanProjects();
  otherOrgSeed = await seedOtherOrgWithStaleProject();
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Task #1893 — GET /api/projects/drawing-sets/stale-summary", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/projects/drawing-sets/stale-summary");
    expect(res.status).toBe(401);
  });

  it("returns only projects with at least one stale pinned sheet", async () => {
    const res = await request(app)
      .get("/api/projects/drawing-sets/stale-summary")
      .set("Cookie", `auth_token=${seed.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    const summary: Record<string, { staleSetCount: number; newerSheetCount: number }> = res.body.summary;

    expect(summary[seed.staleProjectId]).toEqual({
      staleSetCount: 1,
      newerSheetCount: 1,
    });
    expect(summary[seed.cleanProjectId]).toBeUndefined();
    expect(summary[seed.emptyProjectId]).toBeUndefined();
  });

  it("does not leak staleness from another organization", async () => {
    const res = await request(app)
      .get("/api/projects/drawing-sets/stale-summary")
      .set("Cookie", `auth_token=${seed.adminToken}`);

    expect(res.status).toBe(200);
    const summary: Record<string, unknown> = res.body.summary;
    expect(summary[otherOrgSeed.staleProjectId]).toBeUndefined();
  });

  it("FIELD_WORKER (read-only role) can still fetch the roll-up", async () => {
    const res = await request(app)
      .get("/api/projects/drawing-sets/stale-summary")
      .set("Cookie", `auth_token=${seed.fieldWorkerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.summary[seed.staleProjectId]).toEqual({
      staleSetCount: 1,
      newerSheetCount: 1,
    });
  });
});
