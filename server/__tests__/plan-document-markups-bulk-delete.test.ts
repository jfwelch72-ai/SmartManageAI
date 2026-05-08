/**
 * Task #1776 — End-to-end coverage for the bulk DELETE route on
 * plan-document markups.
 *
 * `DELETE /api/plan-documents/:docId/markups/bulk` is the bulk
 * counterpart to the existing per-id `DELETE /api/plan-document-markups/:id`
 * and is symmetric with `PATCH /api/plan-documents/:docId/markups/bulk`.
 * The toolbar's "delete selected group" gesture used to fan-out one
 * DELETE per group member, so a network blip mid-flight could leave a
 * group half-deleted; this route runs the removal in a single
 * transaction so the operation is all-or-nothing.
 *
 * What this suite locks down:
 *  - happy path: every requested row is gone after one round-trip and
 *    the response reports the right `count`
 *  - all-or-nothing under a forced failure: a payload that mixes valid
 *    ids with an id that fails the per-row validation (here: an id from
 *    a different plan document, which trips the same 400 the route uses
 *    to reject cross-doc payloads) leaves every original row intact —
 *    no partial delete ever escapes the route
 *  - per-row org safety (cross-tenant id is rejected with 403)
 *  - per-row RBAC (a FIELD_WORKER cannot bulk-delete an admin's row)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
  planDocumentMarkups,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_PREFIX = "__plandoc_bulkdel_e2e__";

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
  layerId: string | null;
  groupId: string | null;
  createdBy?: string;
}

interface Tenant {
  orgId: string;
  adminId: string;
  adminToken: string;
  fieldUserId: string;
  fieldToken: string;
  projectId: string;
  docId: string;
  otherDocId: string;
}

let app: Express;
let server: Server;
let tenant: Tenant;
let otherTenant: Tenant;

function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).delete(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD BulkDel ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "PDA",
    lastName: label,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [field] = await db.insert(users).values({
    email: `${slug}-field@test.local`,
    passwordHash,
    firstName: "PDF",
    lastName: label,
    role: "FIELD_WORKER",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const adminToken = generateToken(admin.id, admin.tokenVersion ?? 0);
  const fieldToken = generateToken(field.id, field.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: `PD BulkDel Project ${label}`,
    clientName: `PD BulkDel Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `bulkdel-${label}.pdf`,
    fileUrl: `https://example.com/bulkdel-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  // A second plan document on the same project so we can prove the
  // route rejects ids that point at a sibling sheet.
  const [otherDoc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc Other ${label}`,
    fileName: `bulkdel-other-${label}.pdf`,
    fileUrl: `https://example.com/bulkdel-other-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  return {
    orgId: org.id,
    adminId: admin.id,
    adminToken,
    fieldUserId: field.id,
    fieldToken,
    projectId: project.id,
    docId: doc.id,
    otherDocId: otherDoc.id,
  };
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgs.rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_pins WHERE plan_document_id IN ${docSub}`).catch(() => {});
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

  tenant = await setupTenant("primary");
  otherTenant = await setupTenant("cross");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Seed `count` markups under `tenant.docId` authored by `token`'s user
 * and return the resulting markup ids. Centralised so each test can
 * start from a clean, known set of rows.
 */
async function seedMarkups(
  docId: string,
  token: string,
  count: number,
  page = 7,
): Promise<MarkupResponse[]> {
  const out: MarkupResponse[] = [];
  for (let i = 0; i < count; i++) {
    const res = await apiPost(
      `/api/plan-documents/${docId}/markups`,
      token,
      {
        pageNumber: page,
        tool: "RECTANGLE",
        points: [
          { x: 0.1 + i * 0.01, y: 0.1 + i * 0.01 },
          { x: 0.5 + i * 0.01, y: 0.5 + i * 0.01 },
        ],
        color: "#0ea5e9",
        thickness: 3,
      },
    );
    expect(res.status).toBe(201);
    out.push(res.body as MarkupResponse);
  }
  return out;
}

async function readRowIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: planDocumentMarkups.id })
    .from(planDocumentMarkups)
    .where(inArray(planDocumentMarkups.id, ids));
  return new Set(rows.map((r) => r.id));
}

describe("plan_document_markups — bulk DELETE (Task #1776)", () => {
  it("removes every requested row in one round-trip", async () => {
    const created = await seedMarkups(tenant.docId, tenant.adminToken, 4);
    const ids = created.map((m) => m.id);

    const res = await apiDelete(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.adminToken,
      { ids },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, count: ids.length });

    const remaining = await readRowIds(ids);
    expect(remaining.size).toBe(0);
  });

  it("is all-or-nothing: a payload mixing a valid id with a cross-doc id rejects with 400 and deletes nothing", async () => {
    // Forced failure: include one id from a sibling plan document on
    // the same project. The route validates per-row that every id
    // belongs to `:docId` and rejects the whole payload BEFORE opening
    // the transaction, so none of the originally-intended-for-deletion
    // rows can leak away half-deleted.
    const valid = await seedMarkups(tenant.docId, tenant.adminToken, 3);
    const stranger = await seedMarkups(tenant.otherDocId, tenant.adminToken, 1);

    const before = await readRowIds([
      ...valid.map((m) => m.id),
      stranger[0].id,
    ]);
    expect(before.size).toBe(4);

    const res = await apiDelete(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.adminToken,
      { ids: [...valid.map((m) => m.id), stranger[0].id] },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same plan document/i);

    const after = await readRowIds([
      ...valid.map((m) => m.id),
      stranger[0].id,
    ]);
    // Every original row is still present — the failed bulk delete
    // committed nothing.
    expect(after.size).toBe(4);
  });

  it("is all-or-nothing: a payload referencing a non-existent id 404s and deletes nothing", async () => {
    // Second forced-failure variant: a stale snapshot (e.g. another
    // user already deleted one of the members between when the
    // toolbar built the selection and when the request hit the
    // server). The 404 short-circuit must still leave the surviving
    // rows untouched.
    const valid = await seedMarkups(tenant.docId, tenant.adminToken, 3);
    const ghostId = "00000000-0000-0000-0000-000000000000";

    const res = await apiDelete(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.adminToken,
      { ids: [...valid.map((m) => m.id), ghostId] },
    );
    expect(res.status).toBe(404);

    const after = await readRowIds(valid.map((m) => m.id));
    expect(after.size).toBe(valid.length);

    // Cleanup so the cross-test row count stays predictable.
    await db
      .delete(planDocumentMarkups)
      .where(inArray(planDocumentMarkups.id, valid.map((m) => m.id)));
  });

  it("rejects cross-tenant ids with 403 and deletes nothing", async () => {
    const mine = await seedMarkups(tenant.docId, tenant.adminToken, 2);
    const theirs = await seedMarkups(otherTenant.docId, otherTenant.adminToken, 1);

    // Tenant A tries to bulk-delete an id belonging to tenant B's doc
    // through tenant A's docId. The doc-id check fires first (cross-doc
    // 400), so we instead send the foreign id alone via tenant B's doc
    // path while authenticated as tenant A — that reaches the doc
    // ownership check and 403s.
    const crossDocAccess = await apiDelete(
      `/api/plan-documents/${otherTenant.docId}/markups/bulk`,
      tenant.adminToken,
      { ids: [theirs[0].id] },
    );
    expect(crossDocAccess.status).toBe(403);

    const after = await readRowIds([
      ...mine.map((m) => m.id),
      theirs[0].id,
    ]);
    expect(after.size).toBe(3);

    await db
      .delete(planDocumentMarkups)
      .where(
        inArray(planDocumentMarkups.id, [
          ...mine.map((m) => m.id),
          theirs[0].id,
        ]),
      );
  });

  it("a FIELD_WORKER cannot bulk-delete a markup they do not own", async () => {
    // Per-row ownership rule mirrors the single DELETE handler: a
    // FIELD_WORKER can bulk-delete their own rows, but if any row in
    // the payload was authored by someone else the whole request 403s
    // and nothing is deleted.
    const adminOwned = await seedMarkups(tenant.docId, tenant.adminToken, 1);
    const fieldOwned = await seedMarkups(tenant.docId, tenant.fieldToken, 2);

    const res = await apiDelete(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.fieldToken,
      {
        ids: [adminOwned[0].id, ...fieldOwned.map((m) => m.id)],
      },
    );
    expect(res.status).toBe(403);

    const after = await readRowIds([
      adminOwned[0].id,
      ...fieldOwned.map((m) => m.id),
    ]);
    expect(after.size).toBe(3);

    // The field worker can still bulk-delete the rows they own.
    const ownRes = await apiDelete(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.fieldToken,
      { ids: fieldOwned.map((m) => m.id) },
    );
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.count).toBe(fieldOwned.length);

    const remaining = await readRowIds([
      adminOwned[0].id,
      ...fieldOwned.map((m) => m.id),
    ]);
    // Admin row survived, field rows are gone.
    expect(remaining.has(adminOwned[0].id)).toBe(true);
    for (const m of fieldOwned) expect(remaining.has(m.id)).toBe(false);

    await db
      .delete(planDocumentMarkups)
      .where(eq(planDocumentMarkups.id, adminOwned[0].id));
  });
});
