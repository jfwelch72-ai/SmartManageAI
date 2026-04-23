import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Mirrors addendum-storage-key-isolation.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
const FAKE_FILES = new Map<string, { aclPolicy: { owner: string; organizationId: string; visibility: "private" | "public" } | null; bytes: Buffer }>();

vi.mock("../objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectStorage")>();
  const fileFor = (name: string) => ({
    name,
    bucket: { name: "test-bucket" },
    exists: async () => [FAKE_FILES.has(name)],
    getMetadata: async () => {
      const entry = FAKE_FILES.get(name);
      const meta = entry?.aclPolicy
        ? { metadata: { "custom:aclPolicy": JSON.stringify(entry.aclPolicy) }, contentType: "application/octet-stream", size: String(entry.bytes.length) }
        : { metadata: {}, contentType: "application/octet-stream", size: "0" };
      return [meta];
    },
    setMetadata: async (_m: any) => [{}],
    createReadStream: () => Readable.from([FAKE_FILES.get(name)?.bytes ?? Buffer.from("")]),
    delete: async () => [{}],
  });

  class FakeObjectStorageService {
    getPrivateObjectDir() {
      return process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
    }
    getPublicObjectSearchPaths() {
      return [process.env.PUBLIC_OBJECT_SEARCH_PATHS || "/test-bucket/public"];
    }
    normalizeObjectEntityPath(rawPath: string): string {
      let dir = this.getPrivateObjectDir();
      if (!dir.endsWith("/")) dir = `${dir}/`;
      if (rawPath.startsWith(dir)) return `/objects/${rawPath.slice(dir.length)}`;
      return rawPath;
    }
    async getObjectEntityFile(objectPath: string) {
      if (!objectPath.startsWith("/objects/")) {
        throw new actual.ObjectNotFoundError();
      }
      const entityId = objectPath.slice("/objects/".length);
      let dir = this.getPrivateObjectDir();
      if (!dir.endsWith("/")) dir = `${dir}/`;
      const fullPath = `${dir}${entityId}`;
      const objectName = fullPath.replace(/^\/[^/]+\//, "");
      if (!FAKE_FILES.has(objectName)) {
        throw new actual.ObjectNotFoundError();
      }
      return fileFor(objectName) as any;
    }
    async canAccessObjectEntity(opts: any) {
      const entry = FAKE_FILES.get(opts.objectFile.name);
      const acl = entry?.aclPolicy;
      if (!acl) return false;
      if (opts.userRole === "SUPER_ADMIN") return true;
      if (opts.userOrganizationId !== acl.organizationId) return false;
      if (acl.visibility === "public") return true;
      return acl.owner === opts.userId;
    }
    async downloadObject(file: any, res: any) {
      res.status(200);
      res.setHeader?.("Content-Type", "application/octet-stream");
      res.end(FAKE_FILES.get(file.name)?.bytes ?? Buffer.from(""));
    }
  }

  return {
    ...actual,
    objectStorageClient: {
      bucket: (_b: string) => ({ file: (n: string) => fileFor(n) }),
    },
    ObjectStorageService: FakeObjectStorageService,
  };
});

import { db } from "../db";
import { organizations, users, projects, bids, bidDocuments, uploadIntents } from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__bid_doc_iso__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  storageKey: string;
  bidId: string;
  bidCode: string;
  ownDocId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Bid Doc Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Bid",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Bid Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();
  void project;

  const objectId = `${label}-obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const storageKey = `/objects/${org.id}/uploads/${objectId}`;
  const gcsObjectName = `private/${org.id}/uploads/${objectId}`;
  FAKE_FILES.set(gcsObjectName, {
    aclPolicy: { owner: user.id, organizationId: org.id, visibility: "private" },
    bytes: Buffer.from(`hello-${label}`),
  });

  await db.insert(uploadIntents).values({
    organizationId: org.id,
    uploadedById: user.id,
    objectKey: `/test-bucket/private/${org.id}/uploads/${objectId}`,
    contentType: "application/octet-stream",
    fileSize: 5,
    confirmedAt: new Date(),
  });

  const bidCode = `${TEST_PREFIX}B-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [bid] = await db.insert(bids).values({
    name: `Bid ${label}`,
    code: bidCode,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    estimatorId: user.id,
    status: "DRAFT",
  }).returning();

  const [doc] = await db.insert(bidDocuments).values({
    bidId: bid.id,
    type: "OTHER",
    title: `Own Doc ${label}`,
    fileName: `own-${label}.bin`,
    fileUrl: storageKey,
    objectKey: storageKey,
    fileSize: 5,
    mimeType: "application/octet-stream",
    uploadedById: user.id,
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    storageKey,
    bidId: bid.id,
    bidCode,
    ownDocId: doc.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM bid_documents WHERE bid_id IN (SELECT id FROM bids WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM bids WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM upload_intents WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort
  }
  FAKE_FILES.clear();
}

let app: Express;
let server: Server;
let orgA: SeededOrg;
let orgB: SeededOrg;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";
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

  [orgA, orgB] = await Promise.all([seedOrg("A"), seedOrg("B")]);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Task #1328 — bid document storage-key tenancy", () => {
  it("rejects GET /api/bids/:code/documents/:docId/preview-url for another org's bid", async () => {
    const res = await request(app)
      .get(`/api/bids/${orgB.bidCode}/documents/${orgB.ownDocId}/preview-url`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("rejects GET /api/bids/:code/documents/:docId/stream for another org's bid", async () => {
    const res = await request(app)
      .get(`/api/bids/${orgB.bidCode}/documents/${orgB.ownDocId}/stream`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("rejects preview-url even if a bid_documents row was forged with another org's objectKey", async () => {
    // Insert a bid_documents row attached to Org A's bid but pointing at Org
    // B's storage. The defense-in-depth ACL check on the underlying object
    // must reject the preview.
    const [forged] = await db.insert(bidDocuments).values({
      bidId: orgA.bidId,
      type: "OTHER",
      title: "Forged Preview",
      fileName: "forged.bin",
      fileUrl: orgB.storageKey,
      objectKey: orgB.storageKey,
      fileSize: 5,
      mimeType: "application/octet-stream",
      uploadedById: orgA.userId,
    }).returning();

    try {
      const res = await request(app)
        .get(`/api/bids/${orgA.bidCode}/documents/${forged.id}/preview-url`)
        .set("Cookie", `auth_token=${orgA.token}`);

      expect(res.status).toBe(403);
    } finally {
      await db.delete(bidDocuments).where(eq(bidDocuments.id, forged.id)).catch(() => {});
    }
  });

  it("rejects stream even if a bid_documents row was forged with another org's objectKey", async () => {
    const [forged] = await db.insert(bidDocuments).values({
      bidId: orgA.bidId,
      type: "OTHER",
      title: "Forged Stream",
      fileName: "forged-stream.bin",
      fileUrl: orgB.storageKey,
      objectKey: orgB.storageKey,
      fileSize: 5,
      mimeType: "application/octet-stream",
      uploadedById: orgA.userId,
    }).returning();

    try {
      const res = await request(app)
        .get(`/api/bids/${orgA.bidCode}/documents/${forged.id}/stream`)
        .set("Cookie", `auth_token=${orgA.token}`);

      expect(res.status).toBe(403);
    } finally {
      await db.delete(bidDocuments).where(eq(bidDocuments.id, forged.id)).catch(() => {});
    }
  });
});
