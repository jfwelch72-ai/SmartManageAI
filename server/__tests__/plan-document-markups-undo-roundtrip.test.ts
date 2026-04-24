/**
 * Task #1725 — End-to-end coverage for the group-move Undo round-trip.
 *
 * Task #1705 already locks down the pure helper (`buildMoveSnapshot`)
 * and the toolbar Undo button in client-side unit tests, but neither of
 * those exercises the real `PATCH /api/plan-documents/:docId/markups/
 * bulk` endpoint. This suite seeds two markups, fires a forward bulk
 * move through the route, then fires a second bulk move with the
 * snapshot payload produced by the same `buildMoveSnapshot` helper the
 * UI uses, and asserts the database `points` columns equal the original
 * pre-move values. That locks down the Undo contract against accidental
 * regressions to the bulk-PATCH route or its persistence path.
 *
 * `buildMoveSnapshot` is imported from `client/src/components/markups/
 * moveHelpers.ts` — a pure-TypeScript module re-exported by
 * `PlanMarkupLayer.tsx`, so the test exercises the *exact* helper the
 * UI uses without dragging react-konva into the Node test environment.
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
import { buildMoveSnapshot } from "@/components/markups/moveHelpers";
import type { MarkupShape } from "@/components/markups/MarkupRenderer";

const TEST_PREFIX = "__plandoc_undo_e2e__";

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
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
function apiPatch(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).patch(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD Undo ${label}`,
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
    name: `PD Undo Project ${label}`,
    clientName: `PD Undo Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `undo-${label}.pdf`,
    fileUrl: `https://example.com/undo-${label}.pdf`,
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

  tenant = await setupTenant("undo");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Read the raw `points` column for a list of markup ids straight from
 * the DB and parse the JSON. We intentionally bypass the API's list
 * route and inspect the column directly so a regression that happens to
 * round-trip through the read path (e.g. a stray transformer) cannot
 * mask a real persistence bug.
 */
async function readPointsFromDb(
  ids: string[],
): Promise<Map<string, Array<{ x: number; y: number }>>> {
  const rows = await db
    .select({ id: planDocumentMarkups.id, points: planDocumentMarkups.points })
    .from(planDocumentMarkups)
    .where(inArray(planDocumentMarkups.id, ids));
  const out = new Map<string, Array<{ x: number; y: number }>>();
  for (const r of rows) {
    const parsed = typeof r.points === "string" ? JSON.parse(r.points) : r.points;
    out.set(r.id, parsed as Array<{ x: number; y: number }>);
  }
  return out;
}

describe("plan_document_markups — group-move Undo round-trips through PATCH /bulk (Task #1725)", () => {
  it("re-issuing the snapshot restores the prior DB points columns exactly", async () => {
    // Seed two markups that will form the moving "group".
    const aPoints = [
      { x: 0.10, y: 0.10 },
      { x: 0.20, y: 0.20 },
    ];
    const bPoints = [
      { x: 0.30, y: 0.30 },
      { x: 0.40, y: 0.40 },
    ];

    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 1, tool: "ARROW", points: aPoints },
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 1, tool: "ARROW", points: bPoints },
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    // Build the pre-move snapshot using the SAME helper the UI uses.
    // This is the payload the toolbar's Undo button re-fires after a
    // group drag.
    const cachedShapes: MarkupShape[] = [
      { id: a.id, tool: "ARROW", points: a.points, color: a.color, thickness: a.thickness },
      { id: b.id, tool: "ARROW", points: b.points, color: b.color, thickness: b.thickness },
    ];
    const snapshot = buildMoveSnapshot(cachedShapes, [a.id, b.id]);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].points).toEqual(aPoints);
    expect(snapshot[1].points).toEqual(bPoints);

    // Forward bulk move — translate every member of the group by the
    // same delta, just like the live group-drag code path.
    const dx = 0.07;
    const dy = -0.04;
    const forwardUpdates = [
      { id: a.id, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
      { id: b.id, points: b.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
    ];
    const forward = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: forwardUpdates },
    );
    expect(forward.status).toBe(200);
    expect(forward.body.count).toBe(2);

    // Sanity check: the forward move actually mutated the DB so the
    // undo step has something to restore.
    const afterMove = await readPointsFromDb([a.id, b.id]);
    expect(afterMove.get(a.id)![0].x).toBeCloseTo(0.17, 6);
    expect(afterMove.get(a.id)![0].y).toBeCloseTo(0.06, 6);
    expect(afterMove.get(b.id)![1].x).toBeCloseTo(0.47, 6);
    expect(afterMove.get(b.id)![1].y).toBeCloseTo(0.36, 6);

    // Undo — re-issue the captured snapshot through the same bulk PATCH
    // route. This is the exact payload the toolbar Undo button sends.
    const undo = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: snapshot },
    );
    expect(undo.status).toBe(200);
    expect(undo.body.count).toBe(2);

    // The DB `points` columns must equal the original pre-move values.
    const afterUndo = await readPointsFromDb([a.id, b.id]);
    expect(afterUndo.get(a.id)).toEqual(aPoints);
    expect(afterUndo.get(b.id)).toEqual(bPoints);
  });

  it("the snapshot is order-independent and survives multiple forward/undo cycles", async () => {
    // A fresh page so this case can't be confused with the first test.
    const originalA = [{ x: 0.05, y: 0.05 }, { x: 0.15, y: 0.15 }];
    const originalB = [{ x: 0.25, y: 0.25 }, { x: 0.35, y: 0.35 }];

    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 2, tool: "ARROW", points: originalA },
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 2, tool: "ARROW", points: originalB },
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    const baseSnapshot = buildMoveSnapshot(
      [
        { id: a.id, tool: "ARROW", points: a.points, color: a.color, thickness: a.thickness },
        { id: b.id, tool: "ARROW", points: b.points, color: b.color, thickness: b.thickness },
      ],
      [a.id, b.id],
    );

    // Two consecutive forward moves. After each one the snapshot should
    // still take the points back to the very first position because the
    // snapshot was captured BEFORE the first move (single-step undo
    // semantics — see PlanMarkupLayer Task #1705).
    for (const [dx, dy] of [
      [0.10, 0.05],
      [-0.03, 0.12],
    ]) {
      const moved = await apiPatch(
        `/api/plan-documents/${tenant.docId}/markups/bulk`,
        tenant.token,
        {
          updates: [
            { id: a.id, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
            { id: b.id, points: b.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) },
          ],
        },
      );
      expect(moved.status).toBe(200);
    }

    // Re-issue the original snapshot in REVERSE order — the route must
    // still restore each markup's pre-move points by id, not by index.
    const undo = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: [...baseSnapshot].reverse() },
    );
    expect(undo.status).toBe(200);
    expect(undo.body.count).toBe(2);

    const restored = await readPointsFromDb([a.id, b.id]);
    expect(restored.get(a.id)).toEqual(originalA);
    expect(restored.get(b.id)).toEqual(originalB);
  });
});
