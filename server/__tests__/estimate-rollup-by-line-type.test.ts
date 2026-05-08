/**
 * Task #2603 — Route test for GET /api/estimates/:id/rollup-by-line-type.
 * Seeds an estimate with BASE / ALTERNATE / ALLOWANCE / CONTINGENCY line
 * items + two alternate groups (one defaultIncluded, one not) and
 * verifies the per-bucket subtotals plus both alternate totals.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import {
  users,
  organizations,
  projects,
  estimates,
  estimateLineItems,
  estimateAlternateGroups,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__rollup_lt_test__";

interface Seeded {
  orgId: string;
  token: string;
  estimateId: string;
  groupAId: string; // defaultIncluded = true
  groupBId: string; // defaultIncluded = false
}

async function seed(label: string): Promise<Seeded> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Rollup Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Rollup",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Rollup Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: `Rollup Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [estimate] = await db.insert(estimates).values({
    projectId: project.id,
    createdById: user.id,
    status: "DRAFT",
  }).returning();

  const [groupA] = await db.insert(estimateAlternateGroups).values({
    estimateId: estimate.id,
    code: "ALT-A",
    name: "Default included",
    defaultIncluded: true,
  }).returning();

  const [groupB] = await db.insert(estimateAlternateGroups).values({
    estimateId: estimate.id,
    code: "ALT-B",
    name: "Optional",
    defaultIncluded: false,
  }).returning();

  // BASE: 1000 + 500 = 1500
  // ALLOWANCE: 200
  // CONTINGENCY: 175
  // ALTERNATE group A: 250 + 50 = 300 (default included)
  // ALTERNATE group B: 800 (NOT default included)
  await db.insert(estimateLineItems).values([
    {
      estimateId: estimate.id, category: "GENERAL", description: "Base 1",
      quantity: "1.00", unit: "LS", materialCost: "1000.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "1000.00", lineType: "BASE",
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Base 2",
      quantity: "1.00", unit: "LS", materialCost: "500.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "500.00", lineType: "BASE",
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Allowance 1",
      quantity: "1.00", unit: "LS", materialCost: "200.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "200.00", lineType: "ALLOWANCE",
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Contingency 1",
      quantity: "1.00", unit: "LS", materialCost: "175.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "175.00", lineType: "CONTINGENCY",
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Alt A line 1",
      quantity: "1.00", unit: "LS", materialCost: "250.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "250.00", lineType: "ALTERNATE",
      alternateGroupId: groupA.id,
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Alt A line 2",
      quantity: "1.00", unit: "LS", materialCost: "50.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "50.00", lineType: "ALTERNATE",
      alternateGroupId: groupA.id,
    },
    {
      estimateId: estimate.id, category: "GENERAL", description: "Alt B line 1",
      quantity: "1.00", unit: "LS", materialCost: "800.00", laborCost: "0",
      equipmentCost: "0", subcontractCost: "0", overheadAllocation: "0",
      profitAllocation: "0", totalCost: "800.00", lineType: "ALTERNATE",
      alternateGroupId: groupB.id,
    },
  ]);

  const token = generateToken(user.id, user.tokenVersion ?? 0);
  return {
    orgId: org.id,
    token,
    estimateId: estimate.id,
    groupAId: groupA.id,
    groupBId: groupB.id,
  };
}

interface IdRow { id: string }
interface ExecuteResult<T> { rows?: T[] }

async function cleanup(): Promise<void> {
  try {
    const orgIdsResult = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as ExecuteResult<IdRow>;
    const orgIds: string[] = (orgIdsResult.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM estimate_alternate_groups WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort cleanup
  }
}

let app: Express;
let server: Server;
let orgA: Seeded;
let orgB: Seeded;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);

  [orgA, orgB] = await Promise.all([seed("A"), seed("B")]);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

interface RollupResponse {
  baseSubtotal: number;
  allowanceSubtotal: number;
  contingencySubtotal: number;
  alternates: Array<{
    group: { id: string; code: string; defaultIncluded: boolean };
    subtotal: number;
    lineCount: number;
  }>;
  totalIfAllAlternatesIncluded: number;
  totalWithDefaultAlternates: number;
}

describe("GET /api/estimates/:estimateId/rollup-by-line-type", () => {
  it("splits subtotals by BASE / ALLOWANCE / CONTINGENCY and per alternate group", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/rollup-by-line-type`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    const body = res.body as RollupResponse;

    expect(Number(body.baseSubtotal)).toBe(1500);
    expect(Number(body.allowanceSubtotal)).toBe(200);
    expect(Number(body.contingencySubtotal)).toBe(175);

    expect(body.alternates).toHaveLength(2);
    const altA = body.alternates.find((a) => a.group.id === orgA.groupAId)!;
    const altB = body.alternates.find((a) => a.group.id === orgA.groupBId)!;
    expect(altA).toBeDefined();
    expect(altB).toBeDefined();
    expect(Number(altA.subtotal)).toBe(300);
    expect(altA.lineCount).toBe(2);
    expect(altA.group.defaultIncluded).toBe(true);
    expect(Number(altB.subtotal)).toBe(800);
    expect(altB.lineCount).toBe(1);
    expect(altB.group.defaultIncluded).toBe(false);
  });

  it("returns totalWithDefaultAlternates including only default-included groups, and totalIfAllAlternatesIncluded for the maximum scenario", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/rollup-by-line-type`)
      .set("Cookie", `auth_token=${orgA.token}`);
    expect(res.status).toBe(200);
    const body = res.body as RollupResponse;

    // base + allowance + contingency = 1875
    // + group A (default included, $300) = 2175
    expect(Number(body.totalWithDefaultAlternates)).toBe(1500 + 200 + 175 + 300);
    // + both alternates = 2975
    expect(Number(body.totalIfAllAlternatesIncluded)).toBe(1500 + 200 + 175 + 300 + 800);
  });

  it("denies cross-tenant access with 404 when caller's org doesn't own the estimate", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/rollup-by-line-type`)
      .set("Cookie", `auth_token=${orgB.token}`);
    expect(res.status).toBe(404);
  });
});
