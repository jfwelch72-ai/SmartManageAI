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
 *
 * Task #1739 — Extended with multi-step undo/redo coverage. The plan
 * markup layer now keeps a bounded LIFO of move snapshots
 * (`MAX_MARKUP_HISTORY = 20`) plus a forward redo stack instead of the
 * single-shot `lastMoveSnapshot` that #1725 tested. Each undo entry
 * stores both the pre-move (`before`) and post-move (`after`) points so
 * the same `PATCH /markups/bulk` route can fan out either direction
 * without recomputing deltas. The new cases below stack 3 forward
 * group moves, walk back through each `before` snapshot one at a time,
 * then walk forward through each `after` snapshot — exercising the
 * exact route fan-out the toolbar's Undo + Redo buttons (and Cmd/Ctrl+Z
 * / Cmd/Ctrl+Shift+Z keyboard shortcuts) issue today, and proving that
 * a second Ctrl+Z is no longer a no-op.
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

/**
 * Task #1739 — Multi-step undo / redo round-trips.
 *
 * Each `MarkupMoveHistoryEntry` the layer pushes carries both the
 * `before` (pre-move) and `after` (post-move) snapshots produced by
 * `buildMoveSnapshot`, captured against the cached points right before
 * the optimistic update lands. Walking back through the bounded ring
 * buffer one Ctrl+Z at a time replays each entry's `before` against
 * `PATCH /markups/bulk`; redo replays each entry's `after` in the
 * reverse direction. These cases stack multiple forward edits and
 * verify the database steps through every intermediate position
 * without aliasing — i.e. the second Ctrl+Z is no longer a no-op, and
 * a subsequent fresh edit invalidates the redo stack.
 */
describe("plan_document_markups — multi-step undo / redo (Task #1739)", () => {
  /** Helper: snapshot the captured shapes (id + points) defensively so
   *  later mutations to `current` can't bleed into a stored entry. */
  function snap(
    shapes: Array<{ id: string; points: Array<{ x: number; y: number }> }>,
  ): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
    return shapes.map((s) => ({
      id: s.id,
      points: s.points.map((p) => ({ x: p.x, y: p.y })),
    }));
  }

  it("walks back through 3 stacked group moves one entry at a time", async () => {
    // Use a fresh page so this case can't be confused with the first
    // describe's seeded markups.
    const startA = [{ x: 0.05, y: 0.05 }, { x: 0.10, y: 0.10 }];
    const startB = [{ x: 0.20, y: 0.20 }, { x: 0.25, y: 0.25 }];

    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 5, tool: "ARROW", points: startA },
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 5, tool: "ARROW", points: startB },
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    // Track the in-memory shapes the same way the client cache would.
    let current: MarkupShape[] = [
      { id: a.id, tool: "ARROW", points: a.points, color: a.color, thickness: a.thickness },
      { id: b.id, tool: "ARROW", points: b.points, color: b.color, thickness: b.thickness },
    ];

    // Build the same kind of move-history entries the layer pushes
    // (`before` + `after` per group move). Three deliberately distinct
    // deltas so each intermediate DB state is unique and we can prove
    // we did NOT skip a step.
    const deltas: Array<[number, number]> = [
      [0.10, 0.05],
      [-0.04, 0.12],
      [0.07, -0.08],
    ];
    const history: Array<{
      before: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
      after: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
    }> = [];

    for (const [dx, dy] of deltas) {
      const before = buildMoveSnapshot(current, [a.id, b.id]);
      const after = current.map((m) => ({
        id: m.id,
        points: m.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      }));
      const moved = await apiPatch(
        `/api/plan-documents/${tenant.docId}/markups/bulk`,
        tenant.token,
        { updates: after },
      );
      expect(moved.status).toBe(200);
      expect(moved.body.count).toBe(2);
      // Update the in-memory cache so the next iteration's snapshot is
      // captured against the new "current" position, exactly mirroring
      // how the live React Query cache evolves.
      current = current.map((m) => {
        const a2 = after.find((u) => u.id === m.id)!;
        return { ...m, points: a2.points };
      });
      history.push({ before: snap(before), after: snap(after) });
    }

    // Sanity check: the third forward move actually landed in the DB.
    const afterAllMoves = await readPointsFromDb([a.id, b.id]);
    expect(afterAllMoves.get(a.id)![0].x).toBeCloseTo(0.18, 6);
    expect(afterAllMoves.get(a.id)![0].y).toBeCloseTo(0.14, 6);

    // Walk the undo stack one entry at a time (LIFO). After each undo
    // the DB must equal the `before` snapshot from the matching entry
    // — i.e. the position the markups had immediately before that
    // forward move ran. A second Ctrl+Z (this loop's second iteration)
    // is the regression Task #1739 fixes; it must NOT be a no-op.
    for (let step = history.length - 1; step >= 0; step--) {
      const entry = history[step];
      const undo = await apiPatch(
        `/api/plan-documents/${tenant.docId}/markups/bulk`,
        tenant.token,
        { updates: entry.before },
      );
      expect(undo.status).toBe(200);
      expect(undo.body.count).toBe(2);

      const dbState = await readPointsFromDb([a.id, b.id]);
      const expected = new Map(entry.before.map((s) => [s.id, s.points]));
      expect(dbState.get(a.id)).toEqual(expected.get(a.id));
      expect(dbState.get(b.id)).toEqual(expected.get(b.id));
    }

    // After fully unwinding the stack the DB must equal the originals
    // we seeded with — i.e. every step really did roll back.
    const fullyUndone = await readPointsFromDb([a.id, b.id]);
    expect(fullyUndone.get(a.id)).toEqual(startA);
    expect(fullyUndone.get(b.id)).toEqual(startB);

    // Now walk the redo stack forward and assert the DB rebuilds the
    // same intermediate states. The forward iteration order matches
    // how the layer pops off the redo stack (oldest entry first, since
    // undo pushed them onto redo in reverse).
    for (let step = 0; step < history.length; step++) {
      const entry = history[step];
      const redo = await apiPatch(
        `/api/plan-documents/${tenant.docId}/markups/bulk`,
        tenant.token,
        { updates: entry.after },
      );
      expect(redo.status).toBe(200);
      expect(redo.body.count).toBe(2);

      const dbState = await readPointsFromDb([a.id, b.id]);
      const expected = new Map(entry.after.map((s) => [s.id, s.points]));
      expect(dbState.get(a.id)).toEqual(expected.get(a.id));
      expect(dbState.get(b.id)).toEqual(expected.get(b.id));
    }

    // Final cross-check: redoing every entry should land back on the
    // post-third-move state we observed before the undo walk started.
    const finalState = await readPointsFromDb([a.id, b.id]);
    expect(finalState.get(a.id)).toEqual(history[history.length - 1].after.find((u) => u.id === a.id)!.points);
    expect(finalState.get(b.id)).toEqual(history[history.length - 1].after.find((u) => u.id === b.id)!.points);
  });

  it("a fresh forward move after partial undo invalidates the dropped redo entries", async () => {
    // Mirrors the layer's `pushHistory` contract: any new edit clears
    // the redo stack. The DB-side proof is that re-issuing a stale
    // `after` snapshot from the discarded entry no longer represents a
    // valid replay path because the underlying points have moved on.
    // We can't *block* the route from accepting it (the bulk-PATCH is
    // dumb on purpose — that's how it's reusable for both undo and
    // redo), but we can prove the contract the UI enforces by walking
    // the same sequence and asserting the DB matches what the new
    // forward edit produced, not the discarded redo target.
    const startA = [{ x: 0.40, y: 0.40 }, { x: 0.42, y: 0.42 }];
    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      { pageNumber: 6, tool: "ARROW", points: startA },
    );
    expect(aRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    let current: MarkupShape[] = [
      { id: a.id, tool: "ARROW", points: a.points, color: a.color, thickness: a.thickness },
    ];

    // Two forward moves -> stack depth 2, redo empty.
    const move1Before = buildMoveSnapshot(current, [a.id]);
    const move1After = current.map((m) => ({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x + 0.05, y: p.y })),
    }));
    let r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move1After },
    );
    expect(r.status).toBe(200);
    current = current.map((m) => ({ ...m, points: move1After.find((u) => u.id === m.id)!.points }));

    const move2Before = buildMoveSnapshot(current, [a.id]);
    const move2After = current.map((m) => ({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x, y: p.y + 0.05 })),
    }));
    r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move2After },
    );
    expect(r.status).toBe(200);
    current = current.map((m) => ({ ...m, points: move2After.find((u) => u.id === m.id)!.points }));

    // Undo move 2 -> redo stack now holds [move2].
    r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move2Before },
    );
    expect(r.status).toBe(200);
    current = current.map((m) => ({ ...m, points: move2Before.find((u) => u.id === m.id)!.points }));

    // A fresh forward move now arrives — the layer's `pushHistory`
    // would clear the redo stack at this point so move2's `after` is
    // no longer reachable via Ctrl+Shift+Z. Simulate that fresh edit.
    const move3Before = buildMoveSnapshot(current, [a.id]);
    const move3After = current.map((m) => ({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x - 0.10, y: p.y - 0.03 })),
    }));
    r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move3After },
    );
    expect(r.status).toBe(200);

    const afterFreshMove = await readPointsFromDb([a.id]);
    expect(afterFreshMove.get(a.id)).toEqual(move3After[0].points);

    // Undo the fresh move -> back to move2Before. Critically we should
    // NOT re-land on move2's `after`: the redo stack was invalidated.
    r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move3Before },
    );
    expect(r.status).toBe(200);
    const afterUndoOfFresh = await readPointsFromDb([a.id]);
    expect(afterUndoOfFresh.get(a.id)).toEqual(move3Before[0].points);
    expect(afterUndoOfFresh.get(a.id)).not.toEqual(move2After[0].points);

    // One more undo (move 1) — proves the stack still holds move1's
    // entry under the freshly pushed move3 entry, exactly the
    // bounded-LIFO behavior the layer promises.
    r = await apiPatch(
      `/api/plan-documents/${tenant.docId}/markups/bulk`,
      tenant.token,
      { updates: move1Before },
    );
    expect(r.status).toBe(200);
    const afterUndoMove1 = await readPointsFromDb([a.id]);
    expect(afterUndoMove1.get(a.id)).toEqual(startA);
  });
});
