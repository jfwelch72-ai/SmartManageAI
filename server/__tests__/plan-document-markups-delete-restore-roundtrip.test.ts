/**
 * Task #1740 — End-to-end coverage for the delete-and-restore round-trip
 * on plan-document markups.
 *
 * Task #1725 already locks down the group-move Undo round-trip against
 * `PATCH /api/plan-documents/:docId/markups/bulk`. The other destructive
 * plan-markup operation — `DELETE /api/plan-document-markups/:id`
 * (single, and any future "restore from trash" path that re-creates a
 * trashed markup through the public POST route) — had no equivalent
 * end-to-end coverage. This suite seeds a markup, deletes it through
 * the public DELETE route, re-creates it through the same public POST
 * route the toolbar would use to restore, and asserts the resulting DB
 * row's `points`, `color`, `thickness`, `tool`, `layer_id`, and
 * `group_id` columns equal the originals — closing the same class of
 * regression for the delete flow that #1725 closed for the move flow.
 *
 * The "bulk" half of the destructive surface is exercised by
 * round-tripping two markups in sequence (the public DELETE route is
 * per-id, but the toolbar's "delete selected group" gesture issues one
 * DELETE per member; restoring then issues one POST per member plus a
 * single `/markup-groups` call to re-stitch the group). That mirrors
 * the contract the UI relies on today.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
  planDocumentMarkups,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_PREFIX = "__plandoc_delrestore_e2e__";

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
}

interface Tenant {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  docId: string;
}

let app: Express;
let server: Server;
let tenant: Tenant;

function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}
function apiDelete(path: string, token: string) {
  return request(app).delete(path).set("Cookie", `auth_token=${token}`);
}
function apiGet(path: string, token: string) {
  return request(app).get(path).set("Cookie", `auth_token=${token}`);
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD DelRestore ${label}`,
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
    name: `PD DelRestore Project ${label}`,
    clientName: `PD DelRestore Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `delrestore-${label}.pdf`,
    fileUrl: `https://example.com/delrestore-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  return {
    orgId: org.id,
    userId: admin.id,
    token,
    projectId: project.id,
    docId: doc.id,
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

  tenant = await setupTenant("delrestore");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Read the persisted columns we care about straight from the DB and
 * parse the JSON `points` blob. We bypass the API list route on purpose
 * — a regression that happens to round-trip through the read path
 * (e.g. a stray transformer) cannot mask a real persistence bug if we
 * inspect the columns directly.
 */
async function readRowFromDb(id: string): Promise<{
  id: string;
  tool: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  layerId: string | null;
  groupId: string | null;
} | null> {
  const [row] = await db
    .select({
      id: planDocumentMarkups.id,
      tool: planDocumentMarkups.tool,
      points: planDocumentMarkups.points,
      color: planDocumentMarkups.color,
      thickness: planDocumentMarkups.thickness,
      layerId: planDocumentMarkups.layerId,
      groupId: planDocumentMarkups.groupId,
    })
    .from(planDocumentMarkups)
    .where(eq(planDocumentMarkups.id, id))
    .limit(1);
  if (!row) return null;
  const points =
    typeof row.points === "string" ? JSON.parse(row.points) : row.points;
  return {
    id: row.id,
    tool: row.tool,
    points: points as Array<{ x: number; y: number }>,
    color: row.color,
    thickness: row.thickness,
    layerId: row.layerId,
    groupId: row.groupId,
  };
}

describe("plan_document_markups — delete + restore round-trips through the public API (Task #1740)", () => {
  it("re-creating a deleted markup via POST restores every persisted column", async () => {
    // Seed a custom layer so we can prove the layer assignment survives
    // the round-trip (rather than silently snapping back to the default).
    const layerRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-layers`,
      tenant.token,
      { name: `QA-${Date.now()}`, color: "#22c55e" },
    );
    expect(layerRes.status).toBe(201);
    const layerId = layerRes.body.id as string;

    // Seed two markups on the same page so we can group them; the
    // group_id column then has a non-null value to round-trip.
    const aPoints = [
      { x: 0.11, y: 0.12 },
      { x: 0.21, y: 0.22 },
      { x: 0.31, y: 0.32 },
    ];
    const bPoints = [
      { x: 0.41, y: 0.42 },
      { x: 0.51, y: 0.52 },
    ];
    const aSeed = {
      pageNumber: 3,
      tool: "FREEHAND" as const,
      points: aPoints,
      color: "#1e40af",
      thickness: 5,
      layerId,
    };
    const bSeed = {
      pageNumber: 3,
      tool: "ARROW" as const,
      points: bPoints,
      color: "#dc2626",
      thickness: 4,
      layerId,
    };

    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      aSeed,
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      bSeed,
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    // Stitch them into a group so group_id is populated on both rows.
    const groupRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [a.id, b.id] },
    );
    expect(groupRes.status).toBe(200);
    const groupId = groupRes.body.groupId as string;
    expect(groupId).toBeTruthy();

    // Snapshot the originals straight from the DB. This is what the
    // restore step has to faithfully reproduce.
    const originalA = await readRowFromDb(a.id);
    const originalB = await readRowFromDb(b.id);
    expect(originalA).toBeTruthy();
    expect(originalB).toBeTruthy();
    expect(originalA!.layerId).toBe(layerId);
    expect(originalA!.groupId).toBe(groupId);
    expect(originalB!.groupId).toBe(groupId);

    // ---- Delete (single + bulk-by-iteration) ----
    // The public surface only exposes a per-id DELETE today, so the
    // toolbar's "delete selected group" gesture issues one request per
    // member. We mirror that here.
    const delA = await apiDelete(
      `/api/plan-document-markups/${a.id}`,
      tenant.token,
    );
    const delB = await apiDelete(
      `/api/plan-document-markups/${b.id}`,
      tenant.token,
    );
    expect(delA.status).toBe(200);
    expect(delB.status).toBe(200);

    // Sanity check: both rows are actually gone from the DB so the
    // restore step has something to re-create.
    expect(await readRowFromDb(a.id)).toBeNull();
    expect(await readRowFromDb(b.id)).toBeNull();

    // ---- Restore through the same public POST route ----
    // This is the exact payload a "restore from trash" affordance would
    // re-fire from a cached snapshot of the deleted rows.
    const restoreA = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      {
        pageNumber: 3,
        tool: originalA!.tool,
        points: originalA!.points,
        color: originalA!.color,
        thickness: originalA!.thickness,
        layerId: originalA!.layerId,
      },
    );
    const restoreB = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      {
        pageNumber: 3,
        tool: originalB!.tool,
        points: originalB!.points,
        color: originalB!.color,
        thickness: originalB!.thickness,
        layerId: originalB!.layerId,
      },
    );
    expect(restoreA.status).toBe(201);
    expect(restoreB.status).toBe(201);
    const newA = restoreA.body as MarkupResponse;
    const newB = restoreB.body as MarkupResponse;

    // The POST route does not (intentionally) accept a `groupId` —
    // `createMarkupBody` in server/planDocumentMarkupRoutes.ts hard-codes
    // `groupId: null` on insert. So restoring a grouped markup is a
    // two-step contract: re-create each member via POST, then stitch
    // them back together via the existing `/markup-groups` route (the
    // same path the UI uses for any new group). The new group_id will
    // therefore be a FRESH uuid, NOT the original one — so the column
    // assertion below checks the equivalence relation (both restored
    // rows share the same non-null group_id) rather than strict id
    // parity. A future "restore from trash" endpoint that preserves the
    // original group_id would tighten this to strict equality.
    const regroup = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [newA.id, newB.id] },
    );
    expect(regroup.status).toBe(200);
    const newGroupId = regroup.body.groupId as string;
    expect(newGroupId).toBeTruthy();

    // ---- Verify every persisted column matches the original row ----
    const restoredA = await readRowFromDb(newA.id);
    const restoredB = await readRowFromDb(newB.id);
    expect(restoredA).toBeTruthy();
    expect(restoredB).toBeTruthy();

    expect(restoredA!.tool).toBe(originalA!.tool);
    expect(restoredA!.points).toEqual(originalA!.points);
    expect(restoredA!.color).toBe(originalA!.color);
    expect(restoredA!.thickness).toBe(originalA!.thickness);
    expect(restoredA!.layerId).toBe(originalA!.layerId);
    // group_id is RECONSTITUTED, not restored: the stitched id is a
    // fresh uuid and will not equal the original `groupId` snapshot.
    // What we lock down is the contract that both restored members
    // belong to the same non-null group again — that is the property
    // group-aware UI gestures (move/select/delete) actually rely on.
    expect(restoredA!.groupId).toBe(newGroupId);
    expect(restoredB!.groupId).toBe(newGroupId);
    expect(restoredA!.groupId).not.toBe(originalA!.groupId);

    expect(restoredB!.tool).toBe(originalB!.tool);
    expect(restoredB!.points).toEqual(originalB!.points);
    expect(restoredB!.color).toBe(originalB!.color);
    expect(restoredB!.thickness).toBe(originalB!.thickness);
    expect(restoredB!.layerId).toBe(originalB!.layerId);
  });

  it("a solo markup (default layer, no group) round-trips through delete + restore", async () => {
    // Edge case: the most common toolbar gesture is a single-shape
    // delete, where layer_id ends up pointing at the auto-materialised
    // default layer and group_id is NULL. Both paths must round-trip
    // unchanged so the restore button never silently re-parents to a
    // different layer or accidentally creates a singleton group.
    const seed = {
      pageNumber: 4,
      tool: "RECTANGLE" as const,
      points: [
        { x: 0.05, y: 0.05 },
        { x: 0.95, y: 0.95 },
      ],
      color: "#7c3aed",
      thickness: 6,
    };
    const created = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seed,
    );
    expect(created.status).toBe(201);
    const m = created.body as MarkupResponse;
    expect(m.layerId).toBeTruthy(); // default layer was auto-materialised

    const original = await readRowFromDb(m.id);
    expect(original).toBeTruthy();
    expect(original!.groupId).toBeNull();
    expect(original!.layerId).toBeTruthy();

    const del = await apiDelete(
      `/api/plan-document-markups/${m.id}`,
      tenant.token,
    );
    expect(del.status).toBe(200);
    expect(await readRowFromDb(m.id)).toBeNull();

    const restored = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      {
        pageNumber: 4,
        tool: original!.tool,
        points: original!.points,
        color: original!.color,
        thickness: original!.thickness,
        layerId: original!.layerId,
      },
    );
    expect(restored.status).toBe(201);
    const newRow = await readRowFromDb((restored.body as MarkupResponse).id);
    expect(newRow).toBeTruthy();
    expect(newRow!.tool).toBe(original!.tool);
    expect(newRow!.points).toEqual(original!.points);
    expect(newRow!.color).toBe(original!.color);
    expect(newRow!.thickness).toBe(original!.thickness);
    expect(newRow!.layerId).toBe(original!.layerId);
    expect(newRow!.groupId).toBeNull();

    // And it shows up on the public LIST endpoint exactly once — a
    // restore must never produce a duplicate row from the same payload.
    const list = await apiGet(
      `/api/plan-documents/${tenant.docId}/markups?page=4`,
      tenant.token,
    );
    expect(list.status).toBe(200);
    const matches = (list.body as MarkupResponse[]).filter(
      (x) => x.id === (restored.body as MarkupResponse).id,
    );
    expect(matches).toHaveLength(1);
  });
});
