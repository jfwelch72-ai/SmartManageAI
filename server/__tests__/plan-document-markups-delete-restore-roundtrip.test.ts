/**
 * Task #1740 / Task #1775 — End-to-end coverage for the delete-and-restore
 * round-trip on plan-document markups.
 *
 * Task #1725 already locks down the group-move Undo round-trip against
 * `PATCH /api/plan-documents/:docId/markups/bulk`. The other destructive
 * plan-markup operation — `DELETE /api/plan-document-markups/:id` —
 * historically had to be undone by a multi-step "POST recreate +
 * /markup-groups re-stitch" dance because the DELETE handler hard-removed
 * the row. Task #1775 reworked the DELETE handler to soft-delete (stamp
 * `deleted_at`) and added a new `POST /api/plan-document-markups/:id/restore`
 * route that simply clears the column. The round-trip is therefore now
 * a SINGLE per-id call, and every persisted column — including the
 * original id, layer_id, AND group_id — survives unchanged. This suite
 * proves that contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq, and, desc } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
  planDocumentMarkups,
  auditLog,
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

  tenant = await setupTenant("delrestore");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Read every persisted column we care about straight from the DB so a
 * regression that happens to round-trip through the read path (e.g. a
 * stray transformer, or — Task #1775 — a missing `deleted_at IS NULL`
 * filter on the LIST endpoint) cannot mask a real persistence bug.
 * `deletedAt` is included so the suite can prove the soft-delete +
 * restore flow actually toggles the column on the same row.
 */
async function readRowFromDb(id: string): Promise<{
  id: string;
  tool: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  thickness: number;
  layerId: string | null;
  groupId: string | null;
  deletedAt: Date | null;
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
      deletedAt: planDocumentMarkups.deletedAt,
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
    deletedAt: row.deletedAt,
  };
}

describe("plan_document_markups — delete + restore round-trips through the public API (Task #1740 / Task #1775)", () => {
  it("a deleted grouped markup can be restored via POST /:id/restore with id, layer, AND group all preserved", async () => {
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
    // Sanity: live rows have a NULL `deleted_at` column.
    expect(originalA!.deletedAt).toBeNull();
    expect(originalB!.deletedAt).toBeNull();

    // ---- Soft-delete (single + bulk-by-iteration) ----
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

    // Soft-delete: the rows still exist in the DB but `deleted_at` is
    // now stamped. The LIST endpoint must NOT return them.
    const afterDelA = await readRowFromDb(a.id);
    const afterDelB = await readRowFromDb(b.id);
    expect(afterDelA).toBeTruthy();
    expect(afterDelB).toBeTruthy();
    expect(afterDelA!.deletedAt).toBeInstanceOf(Date);
    expect(afterDelB!.deletedAt).toBeInstanceOf(Date);

    const listAfterDel = await apiGet(
      `/api/plan-documents/${tenant.docId}/markups?page=3`,
      tenant.token,
    );
    expect(listAfterDel.status).toBe(200);
    const listIdsAfterDel = (listAfterDel.body as MarkupResponse[]).map((m) => m.id);
    expect(listIdsAfterDel).not.toContain(a.id);
    expect(listIdsAfterDel).not.toContain(b.id);

    // ---- One-click restore via the new per-id route ----
    // The toolbar's "Undo delete" affordance issues one POST per
    // soft-deleted id. Each call clears `deleted_at` on its row; no
    // payload is required, no group re-stitch is required, the
    // original id / layer_id / group_id all survive intact.
    const restoreA = await apiPost(
      `/api/plan-document-markups/${a.id}/restore`,
      tenant.token,
    );
    const restoreB = await apiPost(
      `/api/plan-document-markups/${b.id}/restore`,
      tenant.token,
    );
    expect(restoreA.status).toBe(200);
    expect(restoreB.status).toBe(200);
    expect((restoreA.body as { ok: boolean }).ok).toBe(true);
    expect((restoreB.body as { ok: boolean }).ok).toBe(true);

    // ---- Verify every persisted column matches the original row ----
    // Including STRICT id and group_id parity, which the old
    // "POST recreate + regroup" round-trip could not provide.
    const restoredA = await readRowFromDb(a.id);
    const restoredB = await readRowFromDb(b.id);
    expect(restoredA).toBeTruthy();
    expect(restoredB).toBeTruthy();

    expect(restoredA!.id).toBe(originalA!.id);
    expect(restoredA!.tool).toBe(originalA!.tool);
    expect(restoredA!.points).toEqual(originalA!.points);
    expect(restoredA!.color).toBe(originalA!.color);
    expect(restoredA!.thickness).toBe(originalA!.thickness);
    expect(restoredA!.layerId).toBe(originalA!.layerId);
    // STRICT group_id parity — the soft-delete restore brings the
    // exact same group membership back, no fresh uuid required.
    expect(restoredA!.groupId).toBe(originalA!.groupId);
    expect(restoredA!.deletedAt).toBeNull();

    expect(restoredB!.id).toBe(originalB!.id);
    expect(restoredB!.tool).toBe(originalB!.tool);
    expect(restoredB!.points).toEqual(originalB!.points);
    expect(restoredB!.color).toBe(originalB!.color);
    expect(restoredB!.thickness).toBe(originalB!.thickness);
    expect(restoredB!.layerId).toBe(originalB!.layerId);
    expect(restoredB!.groupId).toBe(originalB!.groupId);
    expect(restoredB!.deletedAt).toBeNull();

    // And the LIST endpoint returns them again — exactly once each.
    const listAfterRestore = await apiGet(
      `/api/plan-documents/${tenant.docId}/markups?page=3`,
      tenant.token,
    );
    expect(listAfterRestore.status).toBe(200);
    const matchesA = (listAfterRestore.body as MarkupResponse[]).filter(
      (m) => m.id === a.id,
    );
    const matchesB = (listAfterRestore.body as MarkupResponse[]).filter(
      (m) => m.id === b.id,
    );
    expect(matchesA).toHaveLength(1);
    expect(matchesB).toHaveLength(1);
    expect(matchesA[0].groupId).toBe(originalA!.groupId);
    expect(matchesB[0].groupId).toBe(originalB!.groupId);
  });

  it("a solo markup (default layer, no group) round-trips through delete + restore with id preserved", async () => {
    // Edge case: the most common toolbar gesture is a single-shape
    // delete, where layer_id ends up pointing at the auto-materialised
    // default layer and group_id is NULL. Both paths must round-trip
    // unchanged and the restored row must keep its original id.
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
    expect(original!.deletedAt).toBeNull();

    const del = await apiDelete(
      `/api/plan-document-markups/${m.id}`,
      tenant.token,
    );
    expect(del.status).toBe(200);
    const afterDel = await readRowFromDb(m.id);
    expect(afterDel).toBeTruthy();
    expect(afterDel!.deletedAt).toBeInstanceOf(Date);

    const restored = await apiPost(
      `/api/plan-document-markups/${m.id}/restore`,
      tenant.token,
    );
    expect(restored.status).toBe(200);

    const newRow = await readRowFromDb(m.id);
    expect(newRow).toBeTruthy();
    expect(newRow!.id).toBe(original!.id);
    expect(newRow!.tool).toBe(original!.tool);
    expect(newRow!.points).toEqual(original!.points);
    expect(newRow!.color).toBe(original!.color);
    expect(newRow!.thickness).toBe(original!.thickness);
    expect(newRow!.layerId).toBe(original!.layerId);
    expect(newRow!.groupId).toBeNull();
    expect(newRow!.deletedAt).toBeNull();

    // And it shows up on the public LIST endpoint exactly once — a
    // restore must never produce a duplicate row from the same id.
    const list = await apiGet(
      `/api/plan-documents/${tenant.docId}/markups?page=4`,
      tenant.token,
    );
    expect(list.status).toBe(200);
    const matches = (list.body as MarkupResponse[]).filter(
      (x) => x.id === m.id,
    );
    expect(matches).toHaveLength(1);
  });

  /**
   * Task #1872 — Lock down the audit row written by the soft-delete
   * restore routes. Task #1847 changed both restore handlers (the
   * per-id `POST /api/plan-document-markups/:id/restore` and the
   * cached-snapshot bulk `POST /api/plan-documents/:docId/markups/restore`)
   * from logging under `action: "UPDATE"` / `action: "CREATE"` (with an
   * `op: "restore"` JSON shim crammed into `new_value`) to a first-class
   * `action: "RESTORE"`. The earlier round-trip suite proves the data
   * flow but never reads the audit_log itself, so a regression that
   * quietly reverts to `UPDATE` / `CREATE` (or drops the audit log call
   * entirely) would be invisible to CI. These two assertions read the
   * row back from `audit_log` directly so any drift in the action /
   * entity_type / entity_id / user_id contract trips immediately.
   */
  it("POST /api/plan-document-markups/:id/restore writes a first-class RESTORE audit row keyed to the markup id and caller", async () => {
    const seed = {
      pageNumber: 9,
      tool: "RECTANGLE" as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.9 },
      ],
      color: "#0f766e",
      thickness: 4,
    };
    const created = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seed,
    );
    expect(created.status).toBe(201);
    const m = created.body as MarkupResponse;

    const del = await apiDelete(
      `/api/plan-document-markups/${m.id}`,
      tenant.token,
    );
    expect(del.status).toBe(200);

    const restored = await apiPost(
      `/api/plan-document-markups/${m.id}/restore`,
      tenant.token,
    );
    expect(restored.status).toBe(200);

    // Read the most recent audit row keyed to this exact markup id so
    // we can never confuse it with the DELETE row written moments
    // earlier (which has the same entity_id but a different action).
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "planDocumentMarkup"),
          eq(auditLog.entityId, m.id),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    expect(row).toBeTruthy();
    // The whole point of Task #1847 — restore is no longer logged as
    // `UPDATE` (with an `op: "restore"` JSON shim) but as a dedicated
    // `RESTORE` action that an auditor can grep for directly.
    expect(row!.action).toBe("RESTORE");
    expect(row!.entityType).toBe("planDocumentMarkup");
    // entity_id on the per-id route must point at the restored
    // markup's id (NOT the document id) so a SIEM filter on a
    // specific markup catches the restore alongside the create /
    // update / delete events for that same row.
    expect(row!.entityId).toBe(m.id);
    expect(row!.userId).toBe(tenant.userId);
  });

  it("POST /api/plan-documents/:docId/markups/restore (cached-snapshot bulk) writes a first-class RESTORE audit row keyed to the document id and caller", async () => {
    // Seed two live markups so we have real ids to round-trip
    // through the cached-snapshot bulk restore endpoint.
    const seedA = {
      pageNumber: 11,
      tool: "FREEHAND" as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
      color: "#9333ea",
      thickness: 3,
    };
    const seedB = {
      pageNumber: 11,
      tool: "ARROW" as const,
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.4, y: 0.4 },
      ],
      color: "#ea580c",
      thickness: 2,
    };
    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedA,
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedB,
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    // Soft-delete both rows so the bulk restore has work to do.
    expect(
      (await apiDelete(`/api/plan-document-markups/${a.id}`, tenant.token))
        .status,
    ).toBe(200);
    expect(
      (await apiDelete(`/api/plan-document-markups/${b.id}`, tenant.token))
        .status,
    ).toBe(200);

    // Cached-snapshot bulk restore — the client hands back the full
    // pre-deletion snapshot of every removed markup. This is the
    // route Task #1847 changed to log under `action: "RESTORE"` with
    // entity_id pointing at the document (not any single markup).
    const bulk = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups/restore`,
      tenant.token,
      {
        markups: [
          {
            id: a.id,
            pageNumber: 11,
            tool: seedA.tool,
            points: seedA.points,
            color: seedA.color,
            thickness: seedA.thickness,
          },
          {
            id: b.id,
            pageNumber: 11,
            tool: seedB.tool,
            points: seedB.points,
            color: seedB.color,
            thickness: seedB.thickness,
          },
        ],
      },
    );
    expect(bulk.status).toBe(201);
    expect((bulk.body as { ok: boolean; count: number }).ok).toBe(true);
    expect((bulk.body as { count: number }).count).toBe(2);

    // The bulk restore writes its audit row keyed to the DOCUMENT id
    // (since it covers many markups in one call). Filter on that
    // entity_id + the RESTORE action so we don't pick up an
    // unrelated row for the same document written by some other
    // test's interleaved write.
    const [row] = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "planDocumentMarkup"),
          eq(auditLog.entityId, tenant.docId),
          eq(auditLog.action, "RESTORE"),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    expect(row).toBeTruthy();
    expect(row!.action).toBe("RESTORE");
    expect(row!.entityType).toBe("planDocumentMarkup");
    // Bulk-restore: entity_id is the document id, NOT any single
    // markup id, because one bulk call covers an arbitrary number
    // of rows. (The per-row ids are still preserved inside
    // new_value for SIEM exports — see the route handler — but
    // entity_id is the indexed column auditors filter on.)
    expect(row!.entityId).toBe(tenant.docId);
    expect(row!.userId).toBe(tenant.userId);
  });

  /**
   * Task #1841 — Lock down end-to-end group_id preservation through the
   * cached-snapshot bulk restore route. The earlier per-id round-trip
   * already proves the soft-delete path keeps every column (including
   * group_id) intact because the row never went away. The cached-
   * snapshot bulk route is a separate code path: the client hands back
   * the full pre-deletion snapshot of every removed markup AND the
   * server `INSERT ... ON CONFLICT DO UPDATE` rewrites the row from
   * that snapshot. If the client sent the original group_id, the
   * restored rows MUST come back with the same group_id they had
   * before deletion — not a fresh one re-stitched after the fact via
   * `/markup-groups`. Anything else means downstream references to
   * the group (audit trails, future "comments-on-group" tables) would
   * silently dangle across a delete + undo cycle.
   *
   * Tightens the assertion from "both members share *some* non-null
   * group_id" to "both members share the SAME group_id they had
   * before deletion".
   */
  it("POST /api/plan-documents/:docId/markups/restore (cached-snapshot bulk) preserves the original group_id when the snapshot supplies it", async () => {
    const seedA = {
      pageNumber: 13,
      tool: "FREEHAND" as const,
      points: [
        { x: 0.12, y: 0.13 },
        { x: 0.22, y: 0.23 },
      ],
      color: "#0891b2",
      thickness: 4,
    };
    const seedB = {
      pageNumber: 13,
      tool: "ARROW" as const,
      points: [
        { x: 0.32, y: 0.33 },
        { x: 0.42, y: 0.43 },
      ],
      color: "#be185d",
      thickness: 5,
    };
    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedA,
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedB,
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    // Stitch the pair into a real group so group_id is populated on
    // both rows. This is the value that has to survive the round-trip.
    const groupRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [a.id, b.id] },
    );
    expect(groupRes.status).toBe(200);
    const originalGroupId = groupRes.body.groupId as string;
    expect(originalGroupId).toBeTruthy();

    // Sanity: both rows actually carry the group id we just minted.
    const beforeA = await readRowFromDb(a.id);
    const beforeB = await readRowFromDb(b.id);
    expect(beforeA!.groupId).toBe(originalGroupId);
    expect(beforeB!.groupId).toBe(originalGroupId);

    // Soft-delete both (per-id, mirroring the toolbar's delete fan-out).
    expect(
      (await apiDelete(`/api/plan-document-markups/${a.id}`, tenant.token))
        .status,
    ).toBe(200);
    expect(
      (await apiDelete(`/api/plan-document-markups/${b.id}`, tenant.token))
        .status,
    ).toBe(200);

    // Cached-snapshot bulk restore — the same path the client's undo
    // stack uses for `case "delete"`. The snapshot includes the
    // ORIGINAL group_id on each member; the server is contractually
    // obliged to write that value back through the on-conflict UPDATE
    // rather than minting a new group id (which would force the
    // client to re-stitch via `/markup-groups` and would orphan any
    // downstream references to the original group_id).
    const bulk = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups/restore`,
      tenant.token,
      {
        markups: [
          {
            id: a.id,
            pageNumber: seedA.pageNumber,
            tool: seedA.tool,
            points: seedA.points,
            color: seedA.color,
            thickness: seedA.thickness,
            groupId: originalGroupId,
          },
          {
            id: b.id,
            pageNumber: seedB.pageNumber,
            tool: seedB.tool,
            points: seedB.points,
            color: seedB.color,
            thickness: seedB.thickness,
            groupId: originalGroupId,
          },
        ],
      },
    );
    expect(bulk.status).toBe(201);
    expect((bulk.body as { ok: boolean; count: number }).count).toBe(2);

    // STRICT parity: both members share the SAME group_id they had
    // before deletion. Not "some non-null group_id"; the exact value.
    const restoredA = await readRowFromDb(a.id);
    const restoredB = await readRowFromDb(b.id);
    expect(restoredA!.groupId).toBe(originalGroupId);
    expect(restoredB!.groupId).toBe(originalGroupId);
    expect(restoredA!.groupId).toBe(restoredB!.groupId);
    expect(restoredA!.deletedAt).toBeNull();
    expect(restoredB!.deletedAt).toBeNull();

    // The bulk-restore response payload also has to surface the
    // preserved group_id so the client cache update doesn't have to
    // do a follow-up read just to learn what the server kept.
    const responseRows = (bulk.body as {
      markups: Array<{ id: string; groupId: string | null }>;
    }).markups;
    const responseA = responseRows.find((r) => r.id === a.id);
    const responseB = responseRows.find((r) => r.id === b.id);
    expect(responseA?.groupId).toBe(originalGroupId);
    expect(responseB?.groupId).toBe(originalGroupId);
  });

  /**
   * Task #1841 — Belt-and-braces guard: an older client (or a partial
   * snapshot built before the membership step) that POSTs the same
   * payload but with NO `groupId` field at all must not silently null
   * out the existing row's group_id when the on-conflict UPDATE runs.
   * Prior to Task #1841 the server normalised missing `groupId` to
   * NULL and clobbered the column on every restore, which is exactly
   * the regression that forced the client to re-stitch via
   * `/markup-groups` after each redo. The handler now distinguishes
   * "field omitted" (preserve existing) from "field explicitly null"
   * (clear), so a snapshot that simply doesn't know the group_id keeps
   * the row's original membership intact.
   */
  it("POST /api/plan-documents/:docId/markups/restore (cached-snapshot bulk) does NOT clobber the existing group_id when the snapshot omits the field", async () => {
    // Seed two markups so we can stitch a real group (the
    // `/markup-groups` endpoint enforces a minimum of two members).
    // We then soft-delete and restore JUST ONE of them with a
    // snapshot that OMITS the `groupId` field — proving that the
    // on-conflict UPDATE preserves the row's existing group_id when
    // the caller doesn't supply one, instead of nulling it out.
    const seedA = {
      pageNumber: 14,
      tool: "RECTANGLE" as const,
      points: [
        { x: 0.05, y: 0.06 },
        { x: 0.95, y: 0.96 },
      ],
      color: "#16a34a",
      thickness: 4,
    };
    const seedB = {
      pageNumber: 14,
      tool: "FREEHAND" as const,
      points: [
        { x: 0.15, y: 0.16 },
        { x: 0.25, y: 0.26 },
      ],
      color: "#0f766e",
      thickness: 3,
    };
    const aRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedA,
    );
    const bRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seedB,
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const a = aRes.body as MarkupResponse;
    const b = bRes.body as MarkupResponse;

    const groupRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [a.id, b.id] },
    );
    expect(groupRes.status).toBe(200);
    const originalGroupId = groupRes.body.groupId as string;
    expect(originalGroupId).toBeTruthy();

    expect(
      (await apiDelete(`/api/plan-document-markups/${a.id}`, tenant.token))
        .status,
    ).toBe(200);

    // Snapshot omits `groupId` entirely (no key at all). The server's
    // on-conflict UPDATE must leave the existing row's group_id alone.
    const bulk = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups/restore`,
      tenant.token,
      {
        markups: [
          {
            id: a.id,
            pageNumber: seedA.pageNumber,
            tool: seedA.tool,
            points: seedA.points,
            color: seedA.color,
            thickness: seedA.thickness,
          },
        ],
      },
    );
    expect(bulk.status).toBe(201);
    expect((bulk.body as { count: number }).count).toBe(1);

    const restored = await readRowFromDb(a.id);
    expect(restored!.deletedAt).toBeNull();
    // Preserved on omit — NOT nulled out. The other group member's
    // row is untouched too, so the group is still cohesive.
    expect(restored!.groupId).toBe(originalGroupId);
    const otherMember = await readRowFromDb(b.id);
    expect(otherMember!.groupId).toBe(originalGroupId);
  });

  /**
   * Task #1841 — Mirror of the preserve-on-omit guarantee for the
   * `layerId` column. The existing per-id soft-delete restore test
   * already proves layerId survives the soft-delete round-trip; this
   * one proves the cached-snapshot bulk route is symmetric — a
   * snapshot that omits `layerId` must not clear the row's existing
   * layer assignment.
   */
  it("POST /api/plan-documents/:docId/markups/restore (cached-snapshot bulk) does NOT clobber the existing layer_id when the snapshot omits the field", async () => {
    const layerRes = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-layers`,
      tenant.token,
      { name: `QA-omit-${Date.now()}`, color: "#a855f7" },
    );
    expect(layerRes.status).toBe(201);
    const layerId = layerRes.body.id as string;

    const seed = {
      pageNumber: 15,
      tool: "FREEHAND" as const,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
      color: "#f59e0b",
      thickness: 3,
      layerId,
    };
    const created = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seed,
    );
    expect(created.status).toBe(201);
    const m = created.body as MarkupResponse;
    expect(m.layerId).toBe(layerId);

    expect(
      (await apiDelete(`/api/plan-document-markups/${m.id}`, tenant.token))
        .status,
    ).toBe(200);

    // Snapshot omits both `layerId` and `groupId`. The on-conflict
    // UPDATE must preserve the row's existing layerId rather than
    // resetting it to NULL.
    const bulk = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups/restore`,
      tenant.token,
      {
        markups: [
          {
            id: m.id,
            pageNumber: seed.pageNumber,
            tool: seed.tool,
            points: seed.points,
            color: seed.color,
            thickness: seed.thickness,
          },
        ],
      },
    );
    expect(bulk.status).toBe(201);

    const restored = await readRowFromDb(m.id);
    expect(restored!.deletedAt).toBeNull();
    expect(restored!.layerId).toBe(layerId);
  });

  it("restoring a row that is already live is a no-op (idempotent double-click)", async () => {
    // The toolbar's "Undo delete" button might fire twice on a
    // double-click or after a stale cache — the restore endpoint must
    // be idempotent so the second call returns 200 without error.
    const seed = {
      pageNumber: 5,
      tool: "ARROW" as const,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
      color: "#0ea5e9",
      thickness: 3,
    };
    const created = await apiPost(
      `/api/plan-documents/${tenant.docId}/markups`,
      tenant.token,
      seed,
    );
    expect(created.status).toBe(201);
    const m = created.body as MarkupResponse;

    // No prior delete — restore on a live row should still succeed.
    const restored = await apiPost(
      `/api/plan-document-markups/${m.id}/restore`,
      tenant.token,
    );
    expect(restored.status).toBe(200);
    const row = await readRowFromDb(m.id);
    expect(row!.deletedAt).toBeNull();
  });
});
