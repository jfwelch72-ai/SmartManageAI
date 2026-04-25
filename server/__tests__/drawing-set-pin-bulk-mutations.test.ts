import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, eq } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  takeoffSheets,
  drawingSets,
  drawingSetItems,
} from "@shared/schema";
import { generateToken } from "../auth";

// Task #1683 — drawing-set item mutation tests (POST/DELETE items, POST bulk).

const TEST_PREFIX = "__ds_pin_bulk__";

interface SeededOrg {
  orgId: string;
  adminId: string;
  adminToken: string;
  fieldWorkerId: string;
  fieldWorkerToken: string;
  projectId: string;
  drawingSetId: string;
  sheetAId: string;
  sheetBId: string;
  // Second revision of sheet A (same sheetName) — for swap-to-latest tests.
  sheetAv2Id: string;
}

let app: Express;
let server: Server;
let seed: SeededOrg;

async function seed_(): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `DS Pin/Bulk Org ${slug}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}-admin@test.local`,
    passwordHash,
    firstName: "Pin",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [fieldWorker] = await db.insert(users).values({
    email: `${slug}-field@test.local`,
    passwordHash,
    firstName: "Pin",
    lastName: "Field",
    role: "FIELD_WORKER",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `DS Pin/Bulk Project ${slug}`,
    code: `${TEST_PREFIX}P-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: "Pin Client",
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  // Sheet A v1 (inactive — superseded by v2)
  const [sheetAv1] = await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${slug}-Av1.png`,
    sheetIndex: 0,
    sheetName: `A-100`,
    revisionLabel: "v1",
    isActive: false,
  }).returning();

  // Sheet A v2 (the latest active revision sharing the same sheetName)
  const [sheetAv2] = await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${slug}-Av2.png`,
    sheetIndex: 0,
    sheetName: `A-100`,
    revisionLabel: "v2",
    isActive: true,
  }).returning();

  const [sheetB] = await db.insert(takeoffSheets).values({
    projectId: project.id,
    imageUrl: `https://example.test/${slug}-B.png`,
    sheetIndex: 1,
    sheetName: `A-200`,
    isActive: true,
  }).returning();

  const [set] = await db.insert(drawingSets).values({
    projectId: project.id,
    organizationId: org.id,
    name: `DS Pin/Bulk Set ${slug}`,
    description: null,
    isPrimary: false,
    createdByUserId: admin.id,
  }).returning();

  return {
    orgId: org.id,
    adminId: admin.id,
    adminToken: generateToken(admin.id, admin.tokenVersion),
    fieldWorkerId: fieldWorker.id,
    fieldWorkerToken: generateToken(fieldWorker.id, fieldWorker.tokenVersion),
    projectId: project.id,
    drawingSetId: set.id,
    sheetAId: sheetAv1.id,
    sheetBId: sheetB.id,
    sheetAv2Id: sheetAv2.id,
  };
}

async function clearItems(setId: string): Promise<void> {
  await db.delete(drawingSetItems).where(eq(drawingSetItems.drawingSetId, setId));
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM drawing_set_items WHERE drawing_set_id IN (SELECT id FROM drawing_sets WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM drawing_sets WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "/test-bucket/public";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (!res.headersSent) res.status(err?.status || 500).json({ error: err?.message || "error" });
  });

  seed = await seed_();
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

beforeEach(async () => {
  await clearItems(seed.drawingSetId);
});

describe("Task #1683 — POST /api/projects/drawing-sets/:setId/items", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(res.status).toBe(401);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.length).toBe(0);
  });

  it("rejects FIELD_WORKER role (lacks canEditProjects) with 403", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.fieldWorkerToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(res.status).toBe(403);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.length).toBe(0);
  });

  it("admins can pin a single sheet (201) and the item shows up in DB", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });

    expect(res.status).toBe(201);
    expect(res.body.sheetId).toBe(seed.sheetBId);
    expect(res.body.drawingSetId).toBe(seed.drawingSetId);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetBId]);
  });

  it("returns 409 when the same sheet is pinned twice (unique constraint)", async () => {
    const first = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(second.status).toBe(409);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.length).toBe(1);
  });

  it("returns 400 when sheetId is missing or malformed", async () => {
    const empty = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({});
    expect(empty.status).toBe(400);

    const notUuid = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: "not-a-uuid" });
    expect(notUuid.status).toBe(400);
  });
});

describe("Task #1683 — DELETE /api/projects/drawing-sets/:setId/items/:itemId", () => {
  async function pin(sheetId: string): Promise<string> {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("rejects unauthenticated callers with 401", async () => {
    const itemId = await pin(seed.sheetBId);
    const res = await request(app)
      .delete(`/api/projects/drawing-sets/${seed.drawingSetId}/items/${itemId}`);
    expect(res.status).toBe(401);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.id, itemId));
    expect(rows.length).toBe(1);
  });

  it("rejects FIELD_WORKER role with 403 (item is not removed)", async () => {
    const itemId = await pin(seed.sheetBId);
    const res = await request(app)
      .delete(`/api/projects/drawing-sets/${seed.drawingSetId}/items/${itemId}`)
      .set("Cookie", `auth_token=${seed.fieldWorkerToken}`);
    expect(res.status).toBe(403);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.id, itemId));
    expect(rows.length).toBe(1);
  });

  it("admin removes the pinned item (200) and DB row is gone", async () => {
    const itemId = await pin(seed.sheetBId);
    const res = await request(app)
      .delete(`/api/projects/drawing-sets/${seed.drawingSetId}/items/${itemId}`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.id, itemId));
    expect(rows.length).toBe(0);
  });

  it("returns 404 when the item id does not exist in the set", async () => {
    const ghost = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .delete(`/api/projects/drawing-sets/${seed.drawingSetId}/items/${ghost}`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe("Task #1683 — POST /api/projects/drawing-sets/:setId/items/bulk", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items/bulk`)
      .set("Content-Type", "application/json")
      .send({ items: [{ sheetId: seed.sheetBId }] });
    expect(res.status).toBe(401);
  });

  it("rejects FIELD_WORKER role with 403", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items/bulk`)
      .set("Cookie", `auth_token=${seed.fieldWorkerToken}`)
      .set("Content-Type", "application/json")
      .send({ items: [{ sheetId: seed.sheetBId }] });
    expect(res.status).toBe(403);
  });

  it("returns 400 when the items array is empty", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items/bulk`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ items: [] });
    expect(res.status).toBe(400);
  });

  it("replaces all existing items in one call (delete-then-insert semantics)", async () => {
    // Pre-pin sheet B to verify bulk replaces (not appends).
    const pre = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(pre.status).toBe(201);

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items/bulk`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ items: [{ sheetId: seed.sheetAv2Id }] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetAv2Id]);
  });

  it("returns 400 when any sheetId does not belong to the project (and leaves existing items intact)", async () => {
    // Pre-seed one item to verify bulk does NOT delete on validation failure.
    const pre = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId });
    expect(pre.status).toBe(201);

    // Foreign sheet from a sibling project in the same org.
    const [otherProject] = await db.insert(projects).values({
      name: "Other Pin Project",
      code: `${TEST_PREFIX}P-OTHER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientName: "Other",
      gcOrganizationId: seed.orgId,
      status: "ACTIVE",
    }).returning();
    const [foreignSheet] = await db.insert(takeoffSheets).values({
      projectId: otherProject.id,
      imageUrl: `https://example.test/foreign-${Date.now()}.png`,
      sheetIndex: 0,
      sheetName: "FOREIGN",
      isActive: true,
    }).returning();

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items/bulk`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({
        items: [
          { sheetId: seed.sheetAv2Id },
          { sheetId: foreignSheet.id },
        ],
      });
    expect(res.status).toBe(400);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetBId]);
  });
});

describe("Task #1683 — swap-to-latest delete-then-add sequence", () => {
  it("removes the old pinned revision then pins the latest in two HTTP calls", async () => {
    const old = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAId });
    expect(old.status).toBe(201);
    const oldItemId = old.body.id as string;

    // DELETE old → POST new (latest revision of same sheetName).
    const del = await request(app)
      .delete(`/api/projects/drawing-sets/${seed.drawingSetId}/items/${oldItemId}`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(del.status).toBe(200);

    const add = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAv2Id });
    expect(add.status).toBe(201);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetAv2Id]);
  });

  it("re-pinning the same already-pinned sheet returns 409 (the unique (set, sheet) constraint enforces DELETE-first ordering for the swap UI)", async () => {
    const old = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAId });
    expect(old.status).toBe(201);

    // Re-pinning the same sheet must 409 (unique constraint on set+sheet).
    const dupOld = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAId });
    expect(dupOld.status).toBe(409);
  });
});

// Task #1894 — POST /api/projects/drawing-sets/:setId/repin-stale
// One-click "Re-pin all to latest" action surfaced from the new stale
// badge and the Compare dialog. The endpoint must:
//   * enforce auth + canEditProjects (no anonymous / FIELD_WORKER access);
//   * scope by organization (404 for cross-org sets);
//   * only swap stale rows in-place (preserves non-stale pinned items);
//   * survive the dedupe edge case where the latest revision of one
//     stale row is already pinned as another item — without HTTP 409.
describe("Task #1894 — POST /api/projects/drawing-sets/:setId/repin-stale", () => {
  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`);
    expect(res.status).toBe(401);
  });

  it("rejects FIELD_WORKER role with 403", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`)
      .set("Cookie", `auth_token=${seed.fieldWorkerToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 404 for a drawing set in another organization", async () => {
    const slug = `${TEST_PREFIX}other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [otherOrg] = await db.insert(organizations).values({
      name: `Other ${slug}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    }).returning();
    const [otherProj] = await db.insert(projects).values({
      name: `Other Proj ${slug}`,
      code: `${TEST_PREFIX}OP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientName: "x",
      gcOrganizationId: otherOrg.id,
      status: "ACTIVE",
    }).returning();
    const [otherSet] = await db.insert(drawingSets).values({
      projectId: otherProj.id,
      organizationId: otherOrg.id,
      name: `Other Set ${slug}`,
      description: null,
      isPrimary: false,
      createdByUserId: null,
    }).returning();

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${otherSet.id}/repin-stale`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(404);
  });

  it("returns updated:0 when there are no pinned items", async () => {
    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 0, replaced: 0, removed: 0 });
    // Task #1918 — empty `changes` array even when nothing to do.
    expect(res.body.changes).toEqual([]);
  });

  it("returns updated:0 when no pinned items are stale", async () => {
    // Pin only the up-to-date sheet (sheet B is active, no superseding revision).
    await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId })
      .expect(201);

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 0, replaced: 0, removed: 0 });
    expect(res.body.changes).toEqual([]);

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetBId]);
  });

  it("swaps stale rows in-place to the latest active revision, leaving non-stale pinned items untouched", async () => {
    // Pin a stale row (Av1) and a non-stale row (B).
    await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAId })
      .expect(201);
    await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetBId })
      .expect(201);

    const before = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    const staleItemId = before.find((r) => r.sheetId === seed.sheetAId)!.id;
    const nonStaleItemId = before.find((r) => r.sheetId === seed.sheetBId)!.id;

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 1, replaced: 1, removed: 0 });

    // Task #1918 — `changes` enumerates the affected pin with the
    // sheet name, old/new revision labels, and the post-re-pin sheet
    // id (latest active revision) so the client can highlight the
    // right row.
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({
      itemId: staleItemId,
      sheetId: seed.sheetAv2Id,
      sheetName: "A-100",
      fromRevision: "v1",
      toRevision: "v2",
      action: "updated",
    });

    const after = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    const sheetIds = new Set(after.map((r) => r.sheetId));
    expect(sheetIds).toEqual(new Set([seed.sheetAv2Id, seed.sheetBId]));
    // Stale row was updated in place (same item id, new sheet id).
    const swapped = after.find((r) => r.id === staleItemId);
    expect(swapped?.sheetId).toBe(seed.sheetAv2Id);
    // Non-stale row is identical (same item id, same sheet id).
    const untouched = after.find((r) => r.id === nonStaleItemId);
    expect(untouched?.sheetId).toBe(seed.sheetBId);
    // Non-stale row should not appear in the changes payload.
    expect(
      res.body.changes.find((c: any) => c.itemId === nonStaleItemId),
    ).toBeUndefined();
  });

  it("dedupes the stale row instead of failing with 409 when its latest is already pinned in the set", async () => {
    // Pin both Av1 (stale) AND Av2 (the latest revision sharing the same
    // sheetName). A naive bulk-replace would try to insert two rows with
    // sheetId=Av2, hitting the unique (set, sheet) constraint and 409'ing.
    await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAId })
      .expect(201);
    await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/items`)
      .set("Cookie", `auth_token=${seed.adminToken}`)
      .set("Content-Type", "application/json")
      .send({ sheetId: seed.sheetAv2Id })
      .expect(201);

    const res = await request(app)
      .post(`/api/projects/drawing-sets/${seed.drawingSetId}/repin-stale`)
      .set("Cookie", `auth_token=${seed.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: 1, replaced: 0, removed: 1 });

    // Task #1918 — even when the stale row was *removed* (because its
    // latest revision was already pinned separately) the change is
    // still surfaced so users see "A-100: v1 → v2" in the dialog and
    // can highlight the remaining latest pin in the sheet list.
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body.changes).toHaveLength(1);
    expect(res.body.changes[0]).toMatchObject({
      sheetId: seed.sheetAv2Id,
      sheetName: "A-100",
      fromRevision: "v1",
      toRevision: "v2",
      action: "removed",
    });

    const rows = await db.select().from(drawingSetItems)
      .where(eq(drawingSetItems.drawingSetId, seed.drawingSetId));
    expect(rows.map((r) => r.sheetId)).toEqual([seed.sheetAv2Id]);
  });
});
