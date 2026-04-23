import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  bids,
  estimates,
  estimateLineItems,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_PREFIX = "__estimate_xtenant__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  bidId: string;
  projectEstimateId: string;
  bidEstimateId: string;
  lineItemId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `XTenant Test Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "XTenant",
      lastName: `Tester-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `XTenant Project ${label}`,
      code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientName: `XTenant Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [bid] = await db
    .insert(bids)
    .values({
      name: `XTenant Bid ${label}`,
      code: `${TEST_PREFIX}B-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientName: `XTenant Client ${label}`,
      gcOrganizationId: org.id,
      status: "DRAFT",
    })
    .returning();

  const [projectEstimate] = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      createdById: user.id,
      status: "DRAFT",
    })
    .returning();

  const [bidEstimate] = await db
    .insert(estimates)
    .values({
      bidId: bid.id,
      createdById: user.id,
      status: "DRAFT",
    })
    .returning();

  const [lineItem] = await db
    .insert(estimateLineItems)
    .values({
      estimateId: projectEstimate.id,
      category: "CONCRETE",
      description: `Concrete pour ${label}`,
      quantity: "10.00",
      unit: "CY",
      materialCost: "1000.00",
      laborCost: "300.00",
      equipmentCost: "100.00",
      subcontractCost: "0.00",
      overheadAllocation: "50.00",
      profitAllocation: "50.00",
      totalCost: "1500.00",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    bidId: bid.id,
    projectEstimateId: projectEstimate.id,
    bidEstimateId: bidEstimate.id,
    lineItemId: lineItem.id,
  };
}

interface IdRow {
  id: string;
}

interface ExecuteResult<T> {
  rows?: T[];
}

async function cleanup(): Promise<void> {
  try {
    const orgIdsResult = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as ExecuteResult<IdRow>;
    const orgIds: string[] = (orgIdsResult.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}) OR bid_id IN (SELECT id FROM bids WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}) OR bid_id IN (SELECT id FROM bids WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
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
let orgA: SeededOrg;
let orgB: SeededOrg;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);

  [orgA, orgB] = await Promise.all([seedOrg("A"), seedOrg("B")]);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Estimate routes — cross-tenant isolation", () => {
  describe("project-context endpoints", () => {
    it("GET /api/projects/:projectId/estimate is org-scoped (returns null for other-org project)", async () => {
      const res = await request(app)
        .get(`/api/projects/${orgA.projectId}/estimate`)
        .set("Cookie", `auth_token=${orgB.token}`);
      // Implementation returns 200 with `{ estimate: null }` for cross-org reads
      // (no information disclosure about whether the project exists).
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.estimate).toBeNull();
      }
    });

    it("POST /api/projects/:projectId/estimate denies creation against other-org project", async () => {
      const res = await request(app)
        .post(`/api/projects/${orgA.projectId}/estimate`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe("bid-context endpoints", () => {
    it("GET /api/bids/:bidId/estimate denies cross-tenant read", async () => {
      const res = await request(app)
        .get(`/api/bids/${orgA.bidId}/estimate`)
        .set("Cookie", `auth_token=${orgB.token}`);
      expect(res.status).toBe(404);
    });

    it("POST /api/bids/:bidId/estimate denies cross-tenant create", async () => {
      const res = await request(app)
        .post(`/api/bids/${orgA.bidId}/estimate`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe("line-items CRUD on /api/estimates/:estimateId/...", () => {
    it("POST /api/estimates/:estimateId/line-items denies cross-tenant create", async () => {
      const beforeCount = await db.execute(
        sql`SELECT COUNT(*)::int AS n FROM estimate_line_items WHERE estimate_id = ${orgA.projectEstimateId}`,
      );
      const before = ((beforeCount as unknown) as ExecuteResult<{ n: number }>).rows?.[0]?.n ?? 0;

      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/line-items`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({
          category: "CONCRETE",
          description: "Hostile cross-tenant insert",
          quantity: 1,
          unit: "EA",
          materialCost: "1.00",
          laborCost: "0",
          equipmentCost: "0",
          consumablesCost: "0",
          subcontractCost: "0",
          overheadAllocation: "0",
          profitAllocation: "0",
        });
      expect(res.status).toBe(404);

      const afterCount = await db.execute(
        sql`SELECT COUNT(*)::int AS n FROM estimate_line_items WHERE estimate_id = ${orgA.projectEstimateId}`,
      );
      const after = ((afterCount as unknown) as ExecuteResult<{ n: number }>).rows?.[0]?.n ?? 0;
      expect(after).toBe(before);
    });

    it("POST /api/estimates/:estimateId/line-items/bulk denies cross-tenant create", async () => {
      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/line-items/bulk`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({
          lineItems: [
            {
              category: "CONCRETE",
              description: "Hostile bulk row",
              quantity: 1,
              unit: "EA",
              materialCost: "1.00",
              laborCost: "0",
              equipmentCost: "0",
              consumablesCost: "0",
              subcontractCost: "0",
              overheadAllocation: "0",
              profitAllocation: "0",
            },
          ],
        });
      expect(res.status).toBe(404);
    });

    it("PUT /api/estimates/:estimateId/line-items/:lineItemId denies cross-tenant update", async () => {
      const res = await request(app)
        .put(`/api/estimates/${orgA.projectEstimateId}/line-items/${orgA.lineItemId}`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({
          category: "CONCRETE",
          description: "HACKED",
          quantity: 1,
          unit: "EA",
          materialCost: "9999.00",
          laborCost: "0",
          equipmentCost: "0",
          consumablesCost: "0",
          subcontractCost: "0",
          overheadAllocation: "0",
          profitAllocation: "0",
        });
      expect(res.status).toBe(404);

      const row = await db.query.estimateLineItems.findFirst({
        where: (t, { eq: $eq }) => $eq(t.id, orgA.lineItemId),
      });
      expect(row?.description).not.toBe("HACKED");
    });

    it("DELETE /api/estimates/:estimateId/line-items/:lineItemId denies cross-tenant delete", async () => {
      const res = await request(app)
        .delete(`/api/estimates/${orgA.projectEstimateId}/line-items/${orgA.lineItemId}`)
        .set("Cookie", `auth_token=${orgB.token}`);
      expect(res.status).toBe(404);

      const row = await db.query.estimateLineItems.findFirst({
        where: (t, { eq: $eq }) => $eq(t.id, orgA.lineItemId),
      });
      expect(row).toBeTruthy();
    });
  });

  describe("state-changing estimate endpoints", () => {
    it("POST /api/estimates/:estimateId/approve denies cross-tenant approval", async () => {
      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/approve`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({});
      expect(res.status).toBe(404);

      const row = await db.query.estimates.findFirst({
        where: (t, { eq: $eq }) => $eq(t.id, orgA.projectEstimateId),
      });
      expect(row?.status).not.toBe("APPROVED");
    });

    it("POST /api/estimates/:estimateId/analyze denies cross-tenant analyze", async () => {
      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/analyze`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({});
      expect(res.status).toBe(404);
    });

    it("POST /api/estimates/:estimateId/insert-assembly denies cross-tenant insert", async () => {
      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/insert-assembly`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({ assemblyId: "00000000-0000-0000-0000-000000000000", quantity: 1 });
      // Either 404 (estimate not found from the caller's perspective) or 400
      // from the missing-assembly check; must NOT be 200.
      expect([400, 403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });

    it("POST /api/estimates/:estimateId/line-items/:lineItemId/sync-materials denies cross-tenant", async () => {
      const res = await request(app)
        .post(`/api/estimates/${orgA.projectEstimateId}/line-items/${orgA.lineItemId}/sync-materials`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({ totalMaterialCost: 99999 });
      expect(res.status).toBe(404);
    });
  });

  describe("import-takeoff routes", () => {
    it("POST /api/projects/:projectId/estimate/import-takeoff denies cross-tenant project access", async () => {
      const res = await request(app)
        .post(`/api/projects/${orgA.projectId}/estimate/import-takeoff`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({ estimateId: orgA.projectEstimateId, categoryIds: [] });
      expect(res.status).toBe(404);
    });

    it("POST /api/bids/:bidId/estimate/import-takeoff denies cross-tenant bid access", async () => {
      const res = await request(app)
        .post(`/api/bids/${orgA.bidId}/estimate/import-takeoff`)
        .set("Cookie", `auth_token=${orgB.token}`)
        .send({ estimateId: orgA.bidEstimateId, categoryIds: [] });
      expect(res.status).toBe(404);
    });
  });

  describe("same-tenant access still works", () => {
    it("owner can read their project estimate", async () => {
      const res = await request(app)
        .get(`/api/projects/${orgA.projectId}/estimate`)
        .set("Cookie", `auth_token=${orgA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.estimate?.id).toBe(orgA.projectEstimateId);
    });

    it("owner can read their bid estimate", async () => {
      const res = await request(app)
        .get(`/api/bids/${orgA.bidId}/estimate`)
        .set("Cookie", `auth_token=${orgA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.estimate?.id).toBe(orgA.bidEstimateId);
    });
  });
});
