import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";
import { PDFDocument } from "pdf-lib";

// Task #1973 — integration coverage for the four takeoff plan-import routes
// asserting one takeoff_sheets row is created per page of a multi-page PDF.

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
  projects,
  bids,
  bidDocuments,
  planDocuments,
  takeoffSheets,
  projectPlans,
} from "@shared/schema";
import { generateToken } from "../../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__takeoff_pageCount_e2e__";

interface SeededOrg {
  org: typeof organizations.$inferSelect;
  admin: typeof users.$inferSelect;
  token: string;
  project: typeof projects.$inferSelect;
  bid: typeof bids.$inferSelect;
}

async function buildPdfBytes(numPages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < numPages; i++) doc.addPage([612, 792]);
  return Buffer.from(await doc.save());
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Takeoff PageCount Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Pagecount",
    lastName: `Admin-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Takeoff PageCount Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: `PageCount Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [bid] = await db.insert(bids).values({
    code: `${TEST_PREFIX}B-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: `Takeoff PageCount Bid ${label}`,
    clientName: `PageCount Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const token = generateToken(admin.id, (admin as { tokenVersion?: number }).tokenVersion ?? 0);
  return { org, admin, token, project, bid };
}

async function cleanup(): Promise<void> {
  const res = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  )) as unknown as { rows?: Array<{ id: string }> };
  const orgIds = (res.rows ?? []).map((r) => r.id);
  for (const orgId of orgIds) {
    const projectSubquery = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const bidSubquery = sql`(SELECT id FROM bids WHERE gc_organization_id = ${orgId})`;
    const sheetSubquery = sql`(SELECT id FROM takeoff_sheets WHERE project_id IN ${projectSubquery} OR bid_id IN ${bidSubquery})`;
    await db.execute(sql`DELETE FROM takeoff_measurements WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_versions WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_measurement_groups WHERE sheet_id IN ${sheetSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN ${projectSubquery} OR bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM project_plans WHERE project_id IN ${projectSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bid_documents WHERE bid_id IN ${bidSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projectSubquery}`).catch(() => {});
    await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
  FAKE_FILES.clear();
}

let app: Express;
let server: Server;
let seeded: SeededOrg;
let pdf3pages: Buffer;
let pdf5pages: Buffer;

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

  seeded = await seedOrg("A");
  pdf3pages = await buildPdfBytes(3);
  pdf5pages = await buildPdfBytes(5);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

interface SheetResponse {
  id: string;
  sheetName: string | null;
  sheetIndex: number;
  bidId: string | null;
  projectId: string | null;
  imageUrl: string;
}

interface ImportPlanResponse {
  sheets: SheetResponse[];
  pageCount?: number;
  plan?: { id: string };
}

function expectSheetNames(sheets: SheetResponse[], baseName: string, pageCount: number): void {
  expect(sheets).toHaveLength(pageCount);
  const sortedByIndex = [...sheets].sort((a, b) => a.sheetIndex - b.sheetIndex);
  for (let i = 0; i < pageCount; i++) {
    expect(sortedByIndex[i].sheetIndex).toBe(i);
    expect(sortedByIndex[i].sheetName).toBe(`${baseName} - Page ${i + 1}`);
  }
}

describe("plan-import routes create one takeoff_sheet per PDF page", () => {
  it("POST /api/bids/:bidId/takeoff/import-plan creates one sheet per page from a 5-page PDF", async () => {
    const objectKey = `/objects/${seeded.org.id}/bid-import-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf5pages);

    const [doc] = await db.insert(bidDocuments).values({
      bidId: seeded.bid.id,
      type: "PLANS",
      title: "Bid Import 5p",
      fileName: "bid-import-5p.pdf",
      fileUrl: `https://example.com/bid-import-5p.pdf`,
      objectKey,
      fileSize: pdf5pages.length,
      mimeType: "application/pdf",
      uploadedById: seeded.admin.id,
    }).returning();

    const res = await request(app)
      .post(`/api/bids/${seeded.bid.id}/takeoff/import-plan`)
      .set("Cookie", `auth_token=${seeded.token}`)
      .set("Content-Type", "application/json")
      .send({ documentId: doc.id });

    expect(res.status).toBe(201);
    const body = res.body as ImportPlanResponse;
    expect(body.pageCount).toBe(5);
    expectSheetNames(body.sheets, "Bid Import 5p", 5);
    body.sheets.forEach((s) => expect(s.bidId).toBe(seeded.bid.id));

    const dbRows = await db.select().from(takeoffSheets).where(eq(takeoffSheets.bidId, seeded.bid.id));
    expect(dbRows.filter((r) => r.imageUrl === doc.fileUrl)).toHaveLength(5);
  });

  it("POST /api/bids/:bidId/takeoff/plans creates one sheet per page from a 3-page PDF (direct upload)", async () => {
    const objectKey = `/objects/${seeded.org.id}/bid-direct-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf3pages);

    const fileName = "bid-direct-3p.pdf";
    const fileUrl = `https://example.com/${fileName}`;

    const res = await request(app)
      .post(`/api/bids/${seeded.bid.id}/takeoff/plans`)
      .set("Cookie", `auth_token=${seeded.token}`)
      .set("Content-Type", "application/json")
      .send({ fileUrl, fileName, objectKey });

    expect(res.status).toBe(201);
    const body = res.body as ImportPlanResponse;
    expect(body.pageCount).toBe(3);
    expectSheetNames(body.sheets, "bid-direct-3p", 3);
    body.sheets.forEach((s) => expect(s.bidId).toBe(seeded.bid.id));

    const dbRows = await db.select().from(takeoffSheets).where(eq(takeoffSheets.bidId, seeded.bid.id));
    expect(dbRows.filter((r) => r.imageUrl === fileUrl)).toHaveLength(3);
  });

  it("POST /api/projects/:projectId/takeoff/import-plan creates one sheet per page from a 5-page PDF", async () => {
    const objectKey = `/objects/${seeded.org.id}/project-import-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf5pages);

    const [doc] = await db.insert(planDocuments).values({
      scope: "PROJECT",
      projectId: seeded.project.id,
      organizationId: seeded.org.id,
      type: "PLANS",
      title: "Project Import 5p",
      fileName: "project-import-5p.pdf",
      fileUrl: `https://example.com/project-import-5p.pdf`,
      objectKey,
      fileSize: pdf5pages.length,
      mimeType: "application/pdf",
      uploadedById: seeded.admin.id,
    }).returning();

    const res = await request(app)
      .post(`/api/projects/${seeded.project.id}/takeoff/import-plan`)
      .set("Cookie", `auth_token=${seeded.token}`)
      .set("Content-Type", "application/json")
      .send({ documentId: doc.id });

    expect(res.status).toBe(201);
    const body = res.body as ImportPlanResponse;
    expect(body.plan?.id).toBeTruthy();
    expectSheetNames(body.sheets, "Project Import 5p", 5);
    body.sheets.forEach((s) => expect(s.projectId).toBe(seeded.project.id));

    const projectRows = await db.select().from(takeoffSheets).where(eq(takeoffSheets.projectId, seeded.project.id));
    expect(projectRows.filter((r) => r.imageUrl === doc.fileUrl)).toHaveLength(5);

    const planRows = await db.select().from(projectPlans).where(eq(projectPlans.projectId, seeded.project.id));
    expect(planRows.find((p) => p.id === body.plan!.id)).toBeDefined();
  });

  it("POST /api/projects/:projectId/takeoff/plans creates one sheet per page from a 3-page PDF (direct upload)", async () => {
    const objectKey = `/objects/${seeded.org.id}/project-direct-${Date.now()}`;
    FAKE_FILES.set(objectKey, pdf3pages);

    const fileName = "project-direct-3p.pdf";
    const fileUrl = `https://example.com/${fileName}`;

    const res = await request(app)
      .post(`/api/projects/${seeded.project.id}/takeoff/plans`)
      .set("Cookie", `auth_token=${seeded.token}`)
      .set("Content-Type", "application/json")
      .send({ fileUrl, fileName, objectKey });

    expect(res.status).toBe(201);
    const body = res.body as ImportPlanResponse;
    expectSheetNames(body.sheets, "project-direct-3p", 3);
    body.sheets.forEach((s) => expect(s.projectId).toBe(seeded.project.id));

    const projectRows = await db.select().from(takeoffSheets).where(eq(takeoffSheets.projectId, seeded.project.id));
    expect(projectRows.filter((r) => r.imageUrl === fileUrl)).toHaveLength(3);
  });

  it("falls back to a single sheet when the PDF cannot be read", async () => {
    const fileName = "bid-no-storage-3p.pdf";
    const fileUrl = `https://example.com/${fileName}`;

    const res = await request(app)
      .post(`/api/bids/${seeded.bid.id}/takeoff/plans`)
      .set("Cookie", `auth_token=${seeded.token}`)
      .set("Content-Type", "application/json")
      .send({ fileUrl, fileName });

    expect(res.status).toBe(201);
    const body = res.body as ImportPlanResponse;
    expect(body.pageCount).toBe(1);
    expect(body.sheets).toHaveLength(1);
    expect(body.sheets[0].sheetName).toBe("bid-no-storage-3p");
  });
});
