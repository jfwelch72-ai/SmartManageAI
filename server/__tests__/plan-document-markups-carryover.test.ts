/**
 * Task #1609 — integration coverage for plan_document_markups CRUD,
 * tenant isolation, and the carryover endpoint (idempotency).
 */
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
  planDocuments,
  planPins,
  planDocumentMarkups,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_PREFIX = "__plandoc_markup_e2e__";

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
}

let app: Express;
let server: Server;

interface Tenant {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  docA: string;
  docB: string;
}
let tenant1: Tenant;
let tenant2: Tenant;

function apiGet(path: string, token: string) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}
function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string) {
  return request(app).delete(path).set("Cookie", `auth_token=${token}`);
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD Markup ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PD",
    lastName: label,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const token = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: `PD Markup Project ${label}`,
    clientName: `PD Markup Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [docA] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc A ${label}`,
    fileName: `a-${label}.pdf`,
    fileUrl: `https://example.com/a-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  const [docB] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc B ${label}`,
    fileName: `b-${label}.pdf`,
    fileUrl: `https://example.com/b-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  return {
    orgId: org.id,
    userId: admin.id,
    token,
    projectId: project.id,
    docA: docA.id,
    docB: docB.id,
  };
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgs as { rows: Array<{ id: string }> }).rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_pins WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  tenant1 = await setupTenant("a");
  tenant2 = await setupTenant("b");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("plan_document_markups — CRUD + tenant isolation", () => {
  let createdId: string;

  it("creates a markup", async () => {
    const res = await apiPost(
      `/api/plan-documents/${tenant1.docA}/markups`,
      tenant1.token,
      {
        pageNumber: 1,
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }],
        color: "#1e40af",
        thickness: 3,
      },
    );
    expect(res.status).toBe(201);
    const m = res.body as MarkupResponse;
    expect(m.id).toBeTruthy();
    expect(m.tool).toBe("ARROW");
    expect(m.planDocumentId).toBe(tenant1.docA);
    createdId = m.id;
  });

  it("lists markups for a page", async () => {
    const res = await apiGet(
      `/api/plan-documents/${tenant1.docA}/markups?page=1`,
      tenant1.token,
    );
    expect(res.status).toBe(200);
    const list = res.body as MarkupResponse[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((m) => m.id === createdId)).toBe(true);
  });

  it("rejects access from a different tenant", async () => {
    const res = await apiGet(
      `/api/plan-documents/${tenant1.docA}/markups?page=1`,
      tenant2.token,
    );
    expect([403, 404]).toContain(res.status);
  });

  it("cross-tenant create is denied", async () => {
    const res = await apiPost(
      `/api/plan-documents/${tenant1.docA}/markups`,
      tenant2.token,
      {
        pageNumber: 1,
        tool: "RECTANGLE",
        points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
      },
    );
    expect([403, 404]).toContain(res.status);
  });

  it("cross-tenant delete is denied", async () => {
    const res = await apiDelete(`/api/plan-document-markups/${createdId}`, tenant2.token);
    expect([403, 404]).toContain(res.status);
  });

  it("admin can delete a markup", async () => {
    const res = await apiDelete(`/api/plan-document-markups/${createdId}`, tenant1.token);
    expect(res.status).toBe(200);
  });

  // Task #1609 RBAC — verify the role gate added to the create + delete +
  // export routes denies users whose role is NOT one of
  // ADMIN/MANAGER/SUPERINTENDENT/FIELD_WORKER. We exercise this with a
  // freshly-created VENDOR user inside tenant1 so the org check passes
  // and the only thing that can deny is the role middleware.
  it("denies non-author roles (VENDOR) from creating + exporting markups", async () => {
    const slug = `${TEST_PREFIX}vendor-${Date.now()}`;
    const passwordHash = await bcrypt.hash("VendorPass123!", 10);
    const [vendorUser] = await db.insert(users).values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Vend",
      lastName: "Or",
      role: "VENDOR",
      organizationId: tenant1.orgId,
      isActive: true,
    }).returning();
    const vendorToken = generateToken(vendorUser.id, vendorUser.tokenVersion ?? 0);

    const createRes = await apiPost(
      `/api/plan-documents/${tenant1.docA}/markups`,
      vendorToken,
      {
        pageNumber: 1,
        tool: "RECTANGLE",
        points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
      },
    );
    expect(createRes.status).toBe(403);

    const exportRes = await apiGet(
      `/api/plan-documents/${tenant1.docA}/export.pdf`,
      vendorToken,
    );
    expect(exportRes.status).toBe(403);
  });
});

// Task #1609 — endpoint-level coverage for the PDF export route.
// We don't actually launch headless Chromium here (that's covered by an
// e2e follow-up #1612). These tests assert the gate-only behavior so a
// regression in auth/RBAC/route-mounting fails fast without paying the
// cost of a real PDF render.
describe("plan-documents export.pdf — gate behavior", () => {
  let tenant: Tenant;

  beforeAll(async () => {
    tenant = await setupTenant("expgate");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get(
      `/api/plan-documents/${tenant.docA}/export.pdf`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 or 404 for a non-existent document (org check fails first)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await apiGet(
      `/api/plan-documents/${fakeId}/export.pdf`,
      tenant.token,
    );
    expect([403, 404]).toContain(res.status);
  });
});

describe("plan-documents carryover-annotations — idempotent", () => {
  it("copies markups + pins from source to target on first call, no duplicates on second", async () => {
    // Seed source markups and pins
    await db.insert(planDocumentMarkups).values({
      organizationId: tenant1.orgId,
      projectId: tenant1.projectId,
      planDocumentId: tenant1.docA,
      pageNumber: 2,
      tool: "ARROW",
      points: JSON.stringify([{ x: 0.1, y: 0.2 }, { x: 0.4, y: 0.5 }]),
      color: "#10b981",
      thickness: 2,
      text: null,
      createdBy: tenant1.userId,
    });
    await db.insert(planPins).values({
      organizationId: tenant1.orgId,
      projectCode: `seed-${tenant1.projectId.slice(0, 8)}`,
      planDocumentId: tenant1.docA,
      pageNumber: 2,
      x: 0.5,
      y: 0.5,
      pinType: "RFI",
      refTable: "rfis",
      refId: tenant1.userId, // benign placeholder ID for the foreign reference
      createdById: tenant1.userId,
    });

    const first = await apiPost(
      `/api/plan-documents/${tenant1.docB}/carryover-annotations`,
      tenant1.token,
      { fromDocumentId: tenant1.docA, includeMarkups: true, includePins: true },
    );
    expect(first.status).toBe(200);
    expect((first.body.markupsCopied ?? 0) + (first.body.pinsCopied ?? 0)).toBeGreaterThan(0);

    const second = await apiPost(
      `/api/plan-documents/${tenant1.docB}/carryover-annotations`,
      tenant1.token,
      { fromDocumentId: tenant1.docA, includeMarkups: true, includePins: true },
    );
    expect(second.status).toBe(200);
    // The second call must be a no-op because of the unique source_*_id indexes.
    expect(second.body.markupsCopied).toBe(0);
    expect(second.body.pinsCopied).toBe(0);
  });

  it("rejects carryover across tenants", async () => {
    const res = await apiPost(
      `/api/plan-documents/${tenant1.docB}/carryover-annotations`,
      tenant2.token,
      { fromDocumentId: tenant1.docA, includeMarkups: true, includePins: true },
    );
    expect([403, 404]).toContain(res.status);
  });
});
