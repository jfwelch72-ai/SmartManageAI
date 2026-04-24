/**
 * Task #1599: route-level integration tests for the Submittal/RFI Log
 * PDF endpoints. Asserts:
 *   - Auth gating: anonymous requests are rejected (401).
 *   - Role gating: roles outside ADMIN/MANAGER/SUPERINTENDENT (and
 *     SUPER_ADMIN) are rejected (403).
 *   - Tenant gating: a user from a different organization cannot pull
 *     another org's project log (403).
 *   - Happy path: an authorized user gets a 200 response with a
 *     non-empty `application/pdf` body that starts with the PDF magic
 *     bytes "%PDF-".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  rfis,
  submittals,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__log_pdf__";

let app: Express;
let orgId: string;
let otherOrgId: string;
let adminUserId: string;
let fieldUserId: string;
let otherOrgUserId: string;
let projectId: string;

async function buildApp(): Promise<Express> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const rfiRoutes = (await import("../rfiRoutes")).default;
  const submittalRoutes = (await import("../submittalRoutes")).default;

  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(cookieParser());

  // Test-only auth shim: read role + org from headers so we can
  // exercise both happy and rejection paths without spinning up the
  // real session middleware. Mirrors the shape AuthRequest.user
  // expects.
  a.use((req: Request & { user?: { id: string; organizationId: string; role: string } }, _res: Response, next: NextFunction) => {
    const headerUserId = req.header("x-test-user-id");
    const headerOrgId = req.header("x-test-org-id");
    const headerRole = req.header("x-test-role");
    if (headerUserId && headerOrgId && headerRole) {
      req.user = { id: headerUserId, organizationId: headerOrgId, role: headerRole };
    }
    next();
  });

  a.use("/api", rfiRoutes);
  a.use("/api", submittalRoutes);
  return a;
}

beforeAll(async () => {
  app = await buildApp();

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `Log PDF Org ${Date.now()}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning({ id: organizations.id });
  orgId = org.id;

  const [otherOrg] = await db.insert(organizations).values({
    name: `Other Org ${Date.now()}`,
    slug: `${slug}-other`,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning({ id: organizations.id });
  otherOrgId = otherOrg.id;

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Admin",
    lastName: "User",
    role: "ADMIN",
    organizationId: orgId,
    isActive: true,
  }).returning({ id: users.id });
  adminUserId = admin.id;

  const [field] = await db.insert(users).values({
    email: `${slug}-field@test.local`,
    passwordHash,
    firstName: "Field",
    lastName: "Worker",
    role: "FIELD_WORKER",
    organizationId: orgId,
    isActive: true,
  }).returning({ id: users.id });
  fieldUserId = field.id;

  const [otherUser] = await db.insert(users).values({
    email: `${slug}-other@test.local`,
    passwordHash,
    firstName: "Other",
    lastName: "Tenant",
    role: "ADMIN",
    organizationId: otherOrgId,
    isActive: true,
  }).returning({ id: users.id });
  otherOrgUserId = otherUser.id;

  const [proj] = await db.insert(projects).values({
    name: `Log PDF Project`,
    code: `${TEST_PREFIX}P-${Date.now()}`,
    clientName: "Test Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
  }).returning({ id: projects.id });
  projectId = proj.id;

  // Seed at least one RFI + one submittal so the PDF body has rows.
  await db.insert(rfis).values({
    organizationId: orgId,
    projectId,
    rfiNumber: `RFI-${TEST_PREFIX}-${Date.now()}`,
    subject: "Liner subgrade compaction tolerance",
    question: "What is the +/- tolerance on subgrade?",
    submittedById: adminUserId,
    status: "SUBMITTED",
    priority: "HIGH",
  });

  await db.insert(submittals).values({
    organizationId: orgId,
    projectId,
    submittalNumber: `SUB-${TEST_PREFIX}-${Date.now()}`,
    subject: "30-mil HDPE liner shop drawings",
    submittalType: "CONTRACTOR",
    phase: "CONSTRUCTION",
    status: "UNDER_REVIEW",
    submittedById: adminUserId,
  });
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM submittal_reviews WHERE organization_id IN (${orgId}, ${otherOrgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM submittal_activity WHERE submittal_id IN (SELECT id FROM submittals WHERE organization_id IN (${orgId}, ${otherOrgId}))`).catch(() => {});
  await db.execute(sql`DELETE FROM submittals WHERE organization_id IN (${orgId}, ${otherOrgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM rfis WHERE organization_id IN (${orgId}, ${otherOrgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE gc_organization_id IN (${orgId}, ${otherOrgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE organization_id IN (${orgId}, ${otherOrgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${orgId}, ${otherOrgId})`).catch(() => {});
}, 30_000);

function asRole(role: string, userId: string, anOrgId: string) {
  return {
    "X-Test-User-Id": userId,
    "X-Test-Org-Id": anOrgId,
    "X-Test-Role": role,
  } as Record<string, string>;
}

describe("GET /api/projects/:projectId/rfis/log.pdf", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${projectId}/rfis/log.pdf`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for FIELD_WORKER (role outside ADMIN/MANAGER/SUPERINTENDENT)", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/rfis/log.pdf`)
      .set(asRole("FIELD_WORKER", fieldUserId, orgId));
    expect(res.status).toBe(403);
  });

  it("returns 403 when an ADMIN from another organization requests this project's log", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/rfis/log.pdf`)
      .set(asRole("ADMIN", otherOrgUserId, otherOrgId));
    expect(res.status).toBe(403);
  });

  it("returns 200 with a non-empty application/pdf body for ADMIN in the project's org", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/rfis/log.pdf`)
      .set(asRole("ADMIN", adminUserId, orgId))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(200);
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  }, 30_000);
});

describe("GET /api/projects/:projectId/submittals/log.pdf", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get(`/api/projects/${projectId}/submittals/log.pdf`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for FIELD_WORKER (role outside ADMIN/MANAGER/SUPERINTENDENT)", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/submittals/log.pdf`)
      .set(asRole("FIELD_WORKER", fieldUserId, orgId));
    expect(res.status).toBe(403);
  });

  it("returns 403 when an ADMIN from another organization requests this project's log", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/submittals/log.pdf`)
      .set(asRole("ADMIN", otherOrgUserId, otherOrgId));
    expect(res.status).toBe(403);
  });

  it("returns 200 with a non-empty application/pdf body for SUPERINTENDENT in the project's org", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/submittals/log.pdf`)
      .set(asRole("SUPERINTENDENT", fieldUserId, orgId))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(200);
    expect(body.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  }, 30_000);
});
