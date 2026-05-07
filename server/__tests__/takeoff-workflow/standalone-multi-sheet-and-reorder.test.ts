import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";
import { PDFDocument } from "pdf-lib";

// Task #2552 — End-to-end coverage for the standalone takeoff
// multi-sheet plan import + sheet reorder + group CRUD wiring.
//
// Asserts:
//   1. POST /api/takeoff/standalone/:id/import-plan creates one
//      takeoff_sheets row per page of a multi-page PDF.
//   2. PATCH /api/takeoff/standalone/:id/sheets/reorder persists
//      sheetIndex changes (and is scoped — it cannot reorder a
//      sheet that doesn't belong to the standalone takeoff).
//   3. The shared sheet-scoped group routes
//      (`POST /api/takeoff/sheets/:sheetId/groups`,
//       `PATCH /api/takeoff/groups/:id`,
//       `DELETE /api/takeoff/groups/:id`) work against a sheet
//      created on a standalone takeoff (no 403/404 from
//      verifySheetAccess — proves grouping affordances in the
//      shared TakeoffWorkspace are functional for standalone).

const FAKE_FILES = new Map<string, Buffer>();

function fileFor(name: string) {
  return {
    name,
    bucket: { name: "test-bucket" },
    exists: async () => [FAKE_FILES.has(name)],
    getMetadata: async () => {
      const bytes = FAKE_FILES.get(name) ?? Buffer.alloc(0);
      return [{ contentType: "application/pdf", size: String(bytes.length) }];
    },
    download: async () => [FAKE_FILES.get(name) ?? Buffer.alloc(0)],
    createReadStream: () =>
      Readable.from([FAKE_FILES.get(name) ?? Buffer.alloc(0)]),
  };
}

vi.mock("../../objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../objectStorage")>();

  class FakeObjectStorageService {
    getPrivateObjectDir() {
      return process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
    }
    getPublicObjectSearchPaths() {
      return [process.env.PUBLIC_OBJECT_SEARCH_PATHS || "/test-bucket/public"];
    }
    normalizeObjectEntityPath(rawPath: string) {
      return rawPath;
    }
    async getObjectEntityFile(objectPath: string) {
      if (!FAKE_FILES.has(objectPath)) throw new actual.ObjectNotFoundError();
      return fileFor(objectPath) as unknown as import("@google-cloud/storage").File;
    }
    async canAccessObjectEntity() {
      return true;
    }
    async trySetObjectEntityAclPolicy(rawPath: string) {
      return rawPath;
    }
  }

  return {
    ...actual,
    objectStorageClient: {
      bucket: (b: string) => ({ file: (n: string) => fileFor(`/${b}/${n}`) }),
    },
    ObjectStorageService: FakeObjectStorageService,
  };
});

import { db } from "../../db";
import {
  organizations,
  users,
  standaloneTakeoffs,
  takeoffSheets,
  takeoffMeasurementGroups,
} from "@shared/schema";
import { generateToken } from "../../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__standalone_multi_sheet__";

let app: Express;
let server: Server;
let orgId: string;
let adminUserId: string;
let userToken: string;
let pdf4pages: Buffer;

async function buildPdfBytes(numPages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

async function cleanup(): Promise<void> {
  const res = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  )) as unknown as { rows?: Array<{ id: string }> };
  const orgIds = (res.rows ?? []).map((r) => r.id);
  for (const id of orgIds) {
    const standaloneSubquery = sql`(SELECT id FROM standalone_takeoffs WHERE organization_id = ${id})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE standalone_takeoff_id IN ${standaloneSubquery})`;
    await db
      .execute(sql`DELETE FROM takeoff_measurement_groups WHERE sheet_id IN ${sheetSubquery}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM takeoff_sheets WHERE standalone_takeoff_id IN ${standaloneSubquery}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM standalone_takeoff_files WHERE standalone_takeoff_id IN ${standaloneSubquery}`)
      .catch(() => {});
    await db
      .execute(sql`DELETE FROM standalone_takeoffs WHERE organization_id = ${id}`)
      .catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${id}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${id}`).catch(() => {});
  }
  FAKE_FILES.clear();
}

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
  process.env.PUBLIC_OBJECT_SEARCH_PATHS = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "/test-bucket/public";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);

  const slug = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);
  const [org] = await db.insert(organizations).values({
    name: `Standalone Multi Org`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  orgId = org.id;
  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Standalone",
    lastName: "Admin",
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  adminUserId = admin.id;
  userToken = generateToken(admin.id, (admin as { tokenVersion?: number }).tokenVersion ?? 0);

  pdf4pages = await buildPdfBytes(4);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

interface SheetResp {
  id: string;
  sheetIndex: number;
  sheetName: string | null;
  standaloneTakeoffId: string | null;
}

async function createStandaloneTakeoff(): Promise<string> {
  const [row] = await db.insert(standaloneTakeoffs).values({
    organizationId: orgId,
    ownerUserId: adminUserId,
    title: `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tradeType: "GENERAL_CONTRACTOR",
  }).returning();
  return row.id;
}

describe("standalone takeoff multi-sheet import + reorder + group wiring", () => {
  it("POST /api/takeoff/standalone/:id/import-plan creates one sheet per PDF page", async () => {
    const takeoffId = await createStandaloneTakeoff();
    const objectKey = `/objects/${orgId}/standalone-import-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf4pages);

    const fileName = "standalone-plan-4p.pdf";
    const fileUrl = `https://example.com/${fileName}`;

    const res = await request(app)
      .post(`/api/takeoff/standalone/${takeoffId}/import-plan`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ fileUrl, fileName, objectKey, mimeType: "application/pdf", fileSize: pdf4pages.length });

    expect(res.status).toBe(201);
    const body = res.body as { sheets: SheetResp[]; pageCount: number };
    expect(body.pageCount).toBe(4);
    expect(body.sheets).toHaveLength(4);
    body.sheets.forEach((s) => expect(s.standaloneTakeoffId).toBe(takeoffId));
    const sortedByIndex = [...body.sheets].sort((a, b) => a.sheetIndex - b.sheetIndex);
    for (let i = 0; i < 4; i++) {
      expect(sortedByIndex[i].sheetIndex).toBe(i);
      expect(sortedByIndex[i].sheetName).toBe(`standalone-plan-4p - Page ${i + 1}`);
    }

    const dbRows = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.standaloneTakeoffId, takeoffId));
    expect(dbRows).toHaveLength(4);
  });

  it("PATCH /api/takeoff/standalone/:id/sheets/reorder persists sheetIndex changes (and is scoped)", async () => {
    const takeoffId = await createStandaloneTakeoff();
    const objectKey = `/objects/${orgId}/standalone-reorder-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf4pages);
    const fileName = "reorder-plan.pdf";
    const fileUrl = `https://example.com/${fileName}`;
    const importRes = await request(app)
      .post(`/api/takeoff/standalone/${takeoffId}/import-plan`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ fileUrl, fileName, objectKey, mimeType: "application/pdf", fileSize: pdf4pages.length });
    expect(importRes.status).toBe(201);
    const sheets = (importRes.body as { sheets: SheetResp[] }).sheets;
    const ordered = [...sheets].sort((a, b) => a.sheetIndex - b.sheetIndex);
    // Reverse the order: 0->3, 1->2, 2->1, 3->0.
    const order = ordered.map((s, i) => ({ id: s.id, sheetIndex: ordered.length - 1 - i }));

    const reorderRes = await request(app)
      .patch(`/api/takeoff/standalone/${takeoffId}/sheets/reorder`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ order });
    expect(reorderRes.status).toBe(200);
    const persisted = reorderRes.body as SheetResp[];
    expect(persisted).toHaveLength(4);
    // Persisted comes back ordered by sheetIndex ascending.
    expect(persisted.map((s) => s.id)).toEqual([...ordered].reverse().map((s) => s.id));

    // Cross-takeoff scoping: a sheet from a *different* standalone
    // takeoff must NOT be touched even if its id is in the order
    // payload (the WHERE clause AND-eq's standaloneTakeoffId).
    const otherTakeoffId = await createStandaloneTakeoff();
    const [otherSheet] = await db.insert(takeoffSheets).values({
      standaloneTakeoffId: otherTakeoffId,
      imageUrl: "https://example.com/other.pdf",
      sheetIndex: 7,
      sheetName: "Other - Page 1",
    }).returning();

    const cross = await request(app)
      .patch(`/api/takeoff/standalone/${takeoffId}/sheets/reorder`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ order: [{ id: otherSheet.id, sheetIndex: 99 }] });
    expect(cross.status).toBe(200);
    const [reloadedOther] = await db
      .select()
      .from(takeoffSheets)
      .where(eq(takeoffSheets.id, otherSheet.id));
    expect(reloadedOther.sheetIndex).toBe(7);
  });

  it("group CRUD via shared sheet-scoped routes works against a standalone sheet", async () => {
    const takeoffId = await createStandaloneTakeoff();
    const objectKey = `/objects/${orgId}/standalone-groups-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf4pages);
    const importRes = await request(app)
      .post(`/api/takeoff/standalone/${takeoffId}/import-plan`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({
        fileUrl: "https://example.com/groups-plan.pdf",
        fileName: "groups-plan.pdf",
        objectKey,
        mimeType: "application/pdf",
        fileSize: pdf4pages.length,
      });
    expect(importRes.status).toBe(201);
    const sheetId = (importRes.body as { sheets: SheetResp[] }).sheets[0].id;

    // List groups on a standalone sheet — must return [] (200, not 403/404).
    const listRes = await request(app)
      .get(`/api/takeoff/sheets/${sheetId}/groups`)
      .set("Cookie", `auth_token=${userToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    // Create.
    const createRes = await request(app)
      .post(`/api/takeoff/sheets/${sheetId}/groups`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ name: "Standalone Group A", sortOrder: 0 });
    expect(createRes.status).toBe(201);
    const groupId = (createRes.body as { id: string }).id;
    expect(groupId).toBeTruthy();

    // Update.
    const patchRes = await request(app)
      .patch(`/api/takeoff/groups/${groupId}`)
      .set("Cookie", `auth_token=${userToken}`)
      .set("Content-Type", "application/json")
      .send({ name: "Standalone Group A (renamed)" });
    expect(patchRes.status).toBe(200);

    const [reloaded] = await db
      .select()
      .from(takeoffMeasurementGroups)
      .where(eq(takeoffMeasurementGroups.id, groupId));
    expect(reloaded?.name).toBe("Standalone Group A (renamed)");

    // Delete.
    const delRes = await request(app)
      .delete(`/api/takeoff/groups/${groupId}`)
      .set("Cookie", `auth_token=${userToken}`);
    expect(delRes.status).toBe(204);

    const after = await db
      .select()
      .from(takeoffMeasurementGroups)
      .where(eq(takeoffMeasurementGroups.id, groupId));
    expect(after).toHaveLength(0);
  });
});
