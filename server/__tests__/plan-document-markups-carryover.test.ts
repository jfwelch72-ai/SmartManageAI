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
  planMarkupLayers,
} from "@shared/schema";
import { eq } from "drizzle-orm";
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
function apiPatch(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
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
    // Task #1662 — visibility rows reference plan_markup_layers, so they
    // need to come down before the layers themselves.
    await db.execute(sql`DELETE FROM plan_markup_layer_visibility WHERE layer_id IN (SELECT id FROM plan_markup_layers WHERE plan_document_id IN ${docSub})`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layers WHERE plan_document_id IN ${docSub}`).catch(() => {});
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

// Task #1662 — layer + group + visibility coverage. We use a dedicated
// tenant so this block is independent of the carryover/CRUD tests above
// (those mutate docA/docB markup state in ways that would interfere).
describe("plan_document_markups — layers, groups, visibility (Task #1662)", () => {
  let tenant: Tenant;

  beforeAll(async () => {
    tenant = await setupTenant("layers");
  }, 60_000);

  it("auto-materialises a Default layer on first list", async () => {
    const res = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    expect(res.status).toBe(200);
    const layers = res.body as Array<{ id: string; name: string; isDefault: boolean; isVisible: boolean }>;
    expect(layers.length).toBeGreaterThanOrEqual(1);
    const def = layers.find((l) => l.isDefault);
    expect(def).toBeTruthy();
    expect(def!.name).toBe("Default");
    expect(def!.isVisible).toBe(true);
  });

  it("creates a custom layer and rejects reserved 'Default' name", async () => {
    const ok = await apiPost(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
      { name: "QA/QC", color: "#ff0000" },
    );
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe("QA/QC");

    const reserved = await apiPost(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
      { name: "default" },
    );
    expect(reserved.status).toBe(400);
  });

  it("creates a markup with explicit layerId and lists it back", async () => {
    const layers = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    const qaLayer = (layers.body as Array<{ id: string; name: string }>).find(
      (l) => l.name === "QA/QC",
    )!;
    const res = await apiPost(
      `/api/plan-documents/${tenant.docA}/markups`,
      tenant.token,
      {
        pageNumber: 7,
        tool: "RECTANGLE",
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
        layerId: qaLayer.id,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.layerId).toBe(qaLayer.id);

    const list = await apiGet(
      `/api/plan-documents/${tenant.docA}/markups?page=7`,
      tenant.token,
    );
    expect(list.status).toBe(200);
    const m = (list.body as Array<{ id: string; layerId: string | null }>).find(
      (x) => x.id === res.body.id,
    );
    expect(m?.layerId).toBe(qaLayer.id);
  });

  it("rejects layerId from a different document", async () => {
    const layers = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    const qaLayer = (layers.body as Array<{ id: string; name: string }>).find(
      (l) => l.name === "QA/QC",
    )!;
    // Try to use docA's layer when posting against docB.
    const res = await apiPost(
      `/api/plan-documents/${tenant.docB}/markups`,
      tenant.token,
      {
        pageNumber: 1,
        tool: "RECTANGLE",
        points: [{ x: 0, y: 0 }, { x: 0.1, y: 0.1 }],
        layerId: qaLayer.id,
      },
    );
    expect(res.status).toBe(400);
  });

  it("groups + ungroups multiple markups", async () => {
    // Seed two markups on a fresh page so they're easy to isolate.
    const a = await apiPost(
      `/api/plan-documents/${tenant.docA}/markups`,
      tenant.token,
      { pageNumber: 9, tool: "ARROW", points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }] },
    );
    const b = await apiPost(
      `/api/plan-documents/${tenant.docA}/markups`,
      tenant.token,
      { pageNumber: 9, tool: "ARROW", points: [{ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }] },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const grouped = await apiPost(
      `/api/plan-documents/${tenant.docA}/markup-groups`,
      tenant.token,
      { markupIds: [a.body.id, b.body.id] },
    );
    expect(grouped.status).toBe(200);
    expect(grouped.body.groupId).toBeTruthy();

    const list = await apiGet(
      `/api/plan-documents/${tenant.docA}/markups?page=9`,
      tenant.token,
    );
    const groupIds = (list.body as Array<{ id: string; groupId: string | null }>)
      .filter((m) => m.id === a.body.id || m.id === b.body.id)
      .map((m) => m.groupId);
    expect(groupIds[0]).toBeTruthy();
    expect(groupIds[0]).toBe(groupIds[1]);

    const ungroup = await apiPost(
      `/api/plan-documents/${tenant.docA}/markup-ungroup`,
      tenant.token,
      { markupIds: [a.body.id, b.body.id] },
    );
    expect(ungroup.status).toBe(200);

    const after = await apiGet(
      `/api/plan-documents/${tenant.docA}/markups?page=9`,
      tenant.token,
    );
    const afterGroups = (after.body as Array<{ id: string; groupId: string | null }>)
      .filter((m) => m.id === a.body.id || m.id === b.body.id)
      .map((m) => m.groupId);
    expect(afterGroups[0]).toBeNull();
    expect(afterGroups[1]).toBeNull();
  });

  it("toggles per-user layer visibility", async () => {
    const layers = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    const def = (layers.body as Array<{ id: string; isDefault: boolean }>)
      .find((l) => l.isDefault)!;
    const off = await request(app)
      .put(`/api/plan-markup-layers/${def.id}/visibility`)
      .set("Cookie", `auth_token=${tenant.token}`)
      .send({ isVisible: false });
    expect(off.status).toBe(200);
    expect(off.body.isVisible).toBe(false);

    const layers2 = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    const def2 = (layers2.body as Array<{ id: string; isDefault: boolean; isVisible: boolean }>)
      .find((l) => l.isDefault)!;
    expect(def2.isVisible).toBe(false);
  });

  it("preserves layer assignments through carryover", async () => {
    // Fresh sheet: a markup tagged with QA/QC layer on docA, carried into docB.
    const layersA = await apiGet(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
    );
    const qaA = (layersA.body as Array<{ id: string; name: string }>).find(
      (l) => l.name === "QA/QC",
    )!;
    const tagged = await apiPost(
      `/api/plan-documents/${tenant.docA}/markups`,
      tenant.token,
      {
        pageNumber: 12,
        tool: "ARROW",
        points: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.6 }],
        layerId: qaA.id,
      },
    );
    expect(tagged.status).toBe(201);

    const carry = await apiPost(
      `/api/plan-documents/${tenant.docB}/carryover-annotations`,
      tenant.token,
      { fromDocumentId: tenant.docA, includeMarkups: true, includePins: false },
    );
    expect(carry.status).toBe(200);
    expect(carry.body.markupsCopied).toBeGreaterThan(0);

    // The target doc should now have a layer named "QA/QC" too, and the
    // carried-over markup should reference it (NOT the source layer id).
    const layersB = await apiGet(
      `/api/plan-documents/${tenant.docB}/markup-layers`,
      tenant.token,
    );
    const qaB = (layersB.body as Array<{ id: string; name: string }>).find(
      (l) => l.name === "QA/QC",
    );
    expect(qaB).toBeTruthy();
    expect(qaB!.id).not.toBe(qaA.id);

    const listB = await apiGet(
      `/api/plan-documents/${tenant.docB}/markups?page=12`,
      tenant.token,
    );
    const carriedM = (listB.body as Array<{ layerId: string | null; sourceMarkupId?: string | null }>)
      .find((m) => m.sourceMarkupId === tagged.body.id);
    expect(carriedM).toBeTruthy();
    expect(carriedM!.layerId).toBe(qaB!.id);
  });

  it("deleting a custom layer SET NULLs its markups (they fall back to default)", async () => {
    // Seed a throwaway layer with one markup, then delete the layer.
    const created = await apiPost(
      `/api/plan-documents/${tenant.docA}/markup-layers`,
      tenant.token,
      { name: "Throwaway" },
    );
    expect(created.status).toBe(201);
    const layerId = created.body.id as string;

    const m = await apiPost(
      `/api/plan-documents/${tenant.docA}/markups`,
      tenant.token,
      {
        pageNumber: 13,
        tool: "ARROW",
        points: [{ x: 0, y: 0 }, { x: 0.4, y: 0.4 }],
        layerId,
      },
    );
    expect(m.status).toBe(201);

    const del = await apiDelete(`/api/plan-markup-layers/${layerId}`, tenant.token);
    expect(del.status).toBe(200);

    const layers = await db.select().from(planMarkupLayers).where(eq(planMarkupLayers.id, layerId));
    expect(layers.length).toBe(0);

    // The orphaned markup row's layer_id is now NULL (FK SET NULL).
    const list = await apiGet(
      `/api/plan-documents/${tenant.docA}/markups?page=13`,
      tenant.token,
    );
    const orphan = (list.body as Array<{ id: string; layerId: string | null }>).find(
      (x) => x.id === m.body.id,
    );
    expect(orphan).toBeTruthy();
    expect(orphan!.layerId).toBeNull();
  });
});

// Task #1676 — bulk PATCH to reposition multiple markups atomically.
// Drives the plan-side group-drag flow where every member of a selected
// group must move by the same delta in a single transaction.
describe("plan_document_markups — bulk reposition (Task #1676)", () => {
  let bulkTenant: Tenant;
  let crossTenant: Tenant;

  beforeAll(async () => {
    bulkTenant = await setupTenant("bulk");
    crossTenant = await setupTenant("bulk2");
  }, 60_000);

  async function seedMarkup(
    tenant: Tenant,
    docId: string,
    pageNumber: number,
    points: Array<{ x: number; y: number }>,
  ): Promise<MarkupResponse> {
    const r = await apiPost(
      `/api/plan-documents/${docId}/markups`,
      tenant.token,
      { pageNumber, tool: "ARROW", points },
    );
    expect(r.status).toBe(201);
    return r.body as MarkupResponse;
  }

  it("translates every member of a group by the same delta", async () => {
    const a = await seedMarkup(bulkTenant, bulkTenant.docA, 21, [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]);
    const b = await seedMarkup(bulkTenant, bulkTenant.docA, 21, [
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ]);
    const dx = 0.05;
    const dy = -0.02;
    const updates = [
      {
        id: a.id,
        points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      },
      {
        id: b.id,
        points: b.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      },
    ];
    const res = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      bulkTenant.token,
      { updates },
    );
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const list = await apiGet(
      `/api/plan-documents/${bulkTenant.docA}/markups?page=21`,
      bulkTenant.token,
    );
    const after = (list.body as MarkupResponse[]).filter(
      (m) => m.id === a.id || m.id === b.id,
    );
    const byId = new Map(after.map((m) => [m.id, m]));
    expect(byId.get(a.id)!.points[0].x).toBeCloseTo(0.15, 6);
    expect(byId.get(a.id)!.points[0].y).toBeCloseTo(0.08, 6);
    expect(byId.get(a.id)!.points[1].x).toBeCloseTo(0.25, 6);
    expect(byId.get(b.id)!.points[0].x).toBeCloseTo(0.35, 6);
    expect(byId.get(b.id)!.points[1].y).toBeCloseTo(0.38, 6);
  });

  it("rejects updates that reference markups in another document", async () => {
    const a = await seedMarkup(bulkTenant, bulkTenant.docA, 22, [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
    ]);
    const b = await seedMarkup(bulkTenant, bulkTenant.docB, 22, [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
    ]);
    // Mixing a docA markup and a docB markup against /docA/markups/bulk
    // must fail with 400 — the route refuses cross-doc bulk moves so a
    // group can never span sheets.
    const res = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      bulkTenant.token,
      {
        updates: [
          { id: a.id, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }] },
          { id: b.id, points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }] },
        ],
      },
    );
    expect(res.status).toBe(400);
  });

  it("denies cross-tenant bulk moves", async () => {
    const a = await seedMarkup(bulkTenant, bulkTenant.docA, 23, [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
    ]);
    // The cross-tenant user has no access to bulkTenant's doc — the
    // org-scoped loadDocAndAssertOrg helper short-circuits with 403.
    const res = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      crossTenant.token,
      {
        updates: [
          { id: a.id, points: [{ x: 0.9, y: 0.9 }, { x: 1, y: 1 }] },
        ],
      },
    );
    expect([403, 404]).toContain(res.status);
  });

  it("returns 404 if any markup id does not exist", async () => {
    const a = await seedMarkup(bulkTenant, bulkTenant.docA, 24, [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
    ]);
    const res = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      bulkTenant.token,
      {
        updates: [
          { id: a.id, points: [{ x: 0.5, y: 0.5 }] },
          { id: "00000000-0000-0000-0000-000000000000", points: [{ x: 0, y: 0 }] },
        ],
      },
    );
    expect(res.status).toBe(404);
  });

  it("validates request body shape", async () => {
    const empty = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      bulkTenant.token,
      { updates: [] },
    );
    expect(empty.status).toBe(400);

    const noPoints = await apiPatch(
      `/api/plan-documents/${bulkTenant.docA}/markups/bulk`,
      bulkTenant.token,
      { updates: [{ id: "x", points: [] }] },
    );
    expect(noPoints.status).toBe(400);
  });
});

// Task #1701 — copy a single layer + its markups onto a sibling sheet.
// Verifies the per-call "(copy)" / "(copy 2)" naming, group-id remap,
// markup count, RBAC, and same-project guard.
describe("plan-markup-layers — copy-to-document (Task #1701)", () => {
  let copyTenant: Tenant;
  let otherTenant: Tenant;
  let secondProjectDocId: string;

  beforeAll(async () => {
    copyTenant = await setupTenant("copyL");
    otherTenant = await setupTenant("copyL2");

    // Spin up a second project under the same org so we can prove the
    // endpoint refuses copies that would cross project boundaries.
    const [project2] = await db
      .insert(projects)
      .values({
        code: `${TEST_PREFIX}copyL-PRJ2-${Date.now()}`,
        name: "PD Markup Project copyL #2",
        clientName: "PD Markup Client copyL #2",
        gcOrganizationId: copyTenant.orgId,
      })
      .returning();
    const [doc] = await db
      .insert(planDocuments)
      .values({
        projectId: project2.id,
        organizationId: copyTenant.orgId,
        scope: "PROJECT",
        type: "PLANS",
        title: "Doc cross-project",
        fileName: "cross.pdf",
        fileUrl: "https://example.com/cross.pdf",
        uploadedById: copyTenant.userId,
      })
      .returning();
    secondProjectDocId = doc.id;
  }, 60_000);

  it("copies a layer + its markups, names destination '(copy)', and remaps group ids", async () => {
    // Source layer + two grouped markups + one ungrouped markup.
    const layer = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
      { name: "Owner Comments", color: "#0066cc" },
    );
    expect(layer.status).toBe(201);
    const sourceLayerId = layer.body.id as string;

    const m1 = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markups`,
      copyTenant.token,
      {
        pageNumber: 3,
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
        layerId: sourceLayerId,
      },
    );
    const m2 = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markups`,
      copyTenant.token,
      {
        pageNumber: 3,
        tool: "ARROW",
        points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }],
        layerId: sourceLayerId,
      },
    );
    const m3 = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markups`,
      copyTenant.token,
      {
        pageNumber: 4,
        tool: "RECTANGLE",
        points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }],
        layerId: sourceLayerId,
      },
    );
    expect([m1.status, m2.status, m3.status]).toEqual([201, 201, 201]);

    // Group m1 + m2 so we can assert the group id is REMAPPED on the copy.
    const grouped = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-groups`,
      copyTenant.token,
      { markupIds: [m1.body.id, m2.body.id] },
    );
    expect(grouped.status).toBe(200);
    const sourceGroupId = grouped.body.groupId as string;

    // First copy → "(copy)" suffix.
    const first = await apiPost(
      `/api/plan-markup-layers/${sourceLayerId}/copy-to-document`,
      copyTenant.token,
      { targetDocumentId: copyTenant.docB },
    );
    expect(first.status).toBe(201);
    expect(first.body.layer.name).toBe("Owner Comments (copy)");
    expect(first.body.layer.color).toBe("#0066cc");
    expect(first.body.markupsCopied).toBe(3);

    // Source layer is unchanged: still has 3 markups, name unchanged.
    const sourceList = await apiGet(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
    );
    const sourceStill = (sourceList.body as Array<{ id: string; name: string; markupCount: number }>)
      .find((l) => l.id === sourceLayerId);
    expect(sourceStill?.name).toBe("Owner Comments");
    expect(sourceStill?.markupCount).toBe(3);

    // Destination has the new layer with the right markup count.
    const destLayers = await apiGet(
      `/api/plan-documents/${copyTenant.docB}/markup-layers`,
      copyTenant.token,
    );
    const copied = (destLayers.body as Array<{ id: string; name: string; markupCount: number }>)
      .find((l) => l.name === "Owner Comments (copy)");
    expect(copied).toBeTruthy();
    expect(copied!.markupCount).toBe(3);

    // Group id is remapped: same group on the destination, but different
    // UUID than the source group.
    const destPage3 = await apiGet(
      `/api/plan-documents/${copyTenant.docB}/markups?page=3`,
      copyTenant.token,
    );
    const destGroupedMarkups = (destPage3.body as Array<{ layerId: string; groupId: string | null }>)
      .filter((m) => m.layerId === copied!.id);
    expect(destGroupedMarkups.length).toBe(2);
    expect(destGroupedMarkups[0].groupId).toBeTruthy();
    expect(destGroupedMarkups[0].groupId).toBe(destGroupedMarkups[1].groupId);
    expect(destGroupedMarkups[0].groupId).not.toBe(sourceGroupId);

    // Second copy → "(copy 2)" suffix and brand-new layer (action is
    // intentionally non-idempotent).
    const second = await apiPost(
      `/api/plan-markup-layers/${sourceLayerId}/copy-to-document`,
      copyTenant.token,
      { targetDocumentId: copyTenant.docB },
    );
    expect(second.status).toBe(201);
    expect(second.body.layer.name).toBe("Owner Comments (copy 2)");
    expect(second.body.layer.id).not.toBe(first.body.layer.id);
    expect(second.body.markupsCopied).toBe(3);
  });

  it("copies an empty layer (zero markups) without error", async () => {
    const layer = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
      { name: "Blank" },
    );
    expect(layer.status).toBe(201);
    const res = await apiPost(
      `/api/plan-markup-layers/${layer.body.id}/copy-to-document`,
      copyTenant.token,
      { targetDocumentId: copyTenant.docB },
    );
    expect(res.status).toBe(201);
    expect(res.body.markupsCopied).toBe(0);
    expect(res.body.layer.name).toBe("Blank (copy)");
  });

  it("rejects a copy onto the same document", async () => {
    const layer = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
      { name: "Self" },
    );
    const res = await apiPost(
      `/api/plan-markup-layers/${layer.body.id}/copy-to-document`,
      copyTenant.token,
      { targetDocumentId: copyTenant.docA },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a cross-project copy", async () => {
    const layer = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
      { name: "Stay-Put" },
    );
    const res = await apiPost(
      `/api/plan-markup-layers/${layer.body.id}/copy-to-document`,
      copyTenant.token,
      { targetDocumentId: secondProjectDocId },
    );
    expect(res.status).toBe(400);
  });

  it("denies cross-tenant copy attempts", async () => {
    const layer = await apiPost(
      `/api/plan-documents/${copyTenant.docA}/markup-layers`,
      copyTenant.token,
      { name: "TenantSafe" },
    );
    // otherTenant has no business touching copyTenant's layer; the
    // org check on the source layer (or doc) must short-circuit.
    const res = await apiPost(
      `/api/plan-markup-layers/${layer.body.id}/copy-to-document`,
      otherTenant.token,
      { targetDocumentId: otherTenant.docA },
    );
    expect([403, 404]).toContain(res.status);
  });
});
