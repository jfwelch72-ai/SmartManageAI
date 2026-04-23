import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Each "file" carries an ACL policy keyed by object name; the mock honours
// `getObjectAclPolicy()` indirectly via metadata.
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

  // Re-implement ObjectStorageService against our in-memory FAKE_FILES so the
  // class methods don't reach the real GCS client (which is captured by
  // closure inside the original module and cannot be swapped out from here).
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
      // GCS object name omits the leading bucket segment (`/test-bucket/`).
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
import { organizations, users, projects, planDocuments, documentRevisions, uploadIntents } from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__doc_rev_iso_test__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  documentId: string;
  storageKey: string;
  revisionId?: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Doc Rev Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "DocRev",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Doc Rev Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  // Storage key uses the normalized `/objects/<orgId>/uploads/<uuid>` form
  // returned by the upload-confirm endpoint. The mock GCS keys off the GCS
  // object name (i.e. the `<orgId>/uploads/<uuid>` portion) once
  // `getObjectEntityFile` resolves it.
  const objectId = `${label}-obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const storageKey = `/objects/${org.id}/uploads/${objectId}`;
  const gcsObjectName = `private/${org.id}/uploads/${objectId}`; // PRIVATE_OBJECT_DIR=/test-bucket/private
  FAKE_FILES.set(gcsObjectName, {
    aclPolicy: { owner: user.id, organizationId: org.id, visibility: "private" },
    bytes: Buffer.from(`hello-${label}`),
  });

  // Record the upload intent for the fast-path ownership check.
  await db.insert(uploadIntents).values({
    organizationId: org.id,
    uploadedById: user.id,
    objectKey: `/test-bucket/private/${org.id}/uploads/${objectId}`,
    contentType: "application/octet-stream",
    fileSize: 5,
    confirmedAt: new Date(),
  });

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    type: "OTHER",
    title: `Doc ${label}`,
    fileName: `doc-${label}.bin`,
    fileUrl: storageKey,
    objectKey: storageKey,
    uploadedById: user.id,
  }).returning();

  // Seed an existing active revision so the preview-url cross-tenant test has
  // something to target.
  const [rev] = await db.insert(documentRevisions).values({
    organizationId: org.id,
    documentId: doc.id,
    revisionNumber: 1,
    sourceType: "upload",
    status: "active",
    storageKey,
    createdByUserId: user.id,
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    documentId: doc.id,
    storageKey,
    revisionId: rev.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM document_revisions WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
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
  // Minimal final error handler: surface the status field on the error so our
  // assertions see the intended 4xx instead of a generic 500.
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

describe("Task #492 — document revision storage-key tenancy", () => {
  it("rejects POST /api/documents/:docId/revisions when storageKey belongs to another org", async () => {
    const res = await request(app)
      .post(`/api/documents/${orgA.documentId}/revisions`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ sourceType: "upload", storageKey: orgB.storageKey });

    // Either 403 (storageKey ACL/upload-intent rejection) or 404 (object
    // missing) is acceptable — both deny the cross-tenant attach.
    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });

  it("accepts POST /api/documents/:docId/revisions when storageKey belongs to caller org", async () => {
    const res = await request(app)
      .post(`/api/documents/${orgA.documentId}/revisions`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ sourceType: "upload", storageKey: orgA.storageKey });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(orgA.orgId);
  });

  it("rejects GET /api/documents/revisions/:id/preview-url for another org's revision", async () => {
    // Org A token requesting Org B's revision id.
    const res = await request(app)
      .get(`/api/documents/revisions/${orgB.revisionId}/preview-url`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
  });

  it("rejects preview-url even if a revision row was forged with another org's storageKey", async () => {
    // Simulate the defense-in-depth path: insert a revision row owned by Org A
    // but pointing at Org B's storageKey, then try to stream it.
    const [forged] = await db.insert(documentRevisions).values({
      organizationId: orgA.orgId,
      documentId: orgA.documentId,
      revisionNumber: 999,
      sourceType: "upload",
      status: "active",
      storageKey: orgB.storageKey,
      createdByUserId: orgA.userId,
    }).returning();

    try {
      const res = await request(app)
        .get(`/api/documents/revisions/${forged.id}/preview-url`)
        .set("Cookie", `auth_token=${orgA.token}`);

      expect(res.status).toBe(403);
    } finally {
      await db.delete(documentRevisions).where(eq(documentRevisions.id, forged.id)).catch(() => {});
    }
  });
});
