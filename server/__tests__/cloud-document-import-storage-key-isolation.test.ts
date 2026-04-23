import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1420 — regression coverage for the two cloud-document import endpoints
// in `server/projectOpsRoutes.ts` that create plan_document rows scoped to a
// caller-supplied projectId:
//   - POST /api/documents/from-url
//   - POST /api/documents/from-cloud
//
// The existing *-storage-key-isolation tests only cover the user-supplied
// `fileUrl` endpoints. Because these two endpoints fetch the bytes themselves
// and write them to a freshly-allocated object key in the caller's org, the
// only thing standing between Org A and Org B's plan_documents is the
// `verifyOrgAccess(req, res, project.gcOrganizationId)` check. A regression
// there would let one tenant inject documents into another tenant's project.
// ─────────────────────────────────────────────────────────────────────────────

// Mock objectStorage so we don't need real GCS for the happy-path uploads.
vi.mock("../objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectStorage")>();

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
    async getObjectEntityUploadURL(orgId: string) {
      const objectId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fullPath = `${this.getPrivateObjectDir()}/${orgId}/uploads/${objectId}`;
      return {
        uploadURL: `https://fake-upload.local/${orgId}/${objectId}`,
        objectKey: fullPath,
      };
    }
    async trySetObjectEntityAclPolicy(rawPath: string, _policy: any) {
      return this.normalizeObjectEntityPath(rawPath);
    }
    async getObjectEntityFile(_objectPath: string) {
      throw new actual.ObjectNotFoundError();
    }
    async canAccessObjectEntity() {
      return true;
    }
  }

  return {
    ...actual,
    objectStorageClient: {
      bucket: (_b: string) => ({
        file: (n: string) => ({
          name: n,
          bucket: { name: "test-bucket" },
          exists: async () => [false],
          getMetadata: async () => [{ metadata: {}, contentType: "application/octet-stream", size: "0" }],
          createReadStream: () => Readable.from([Buffer.from("")]),
          delete: async () => [{}],
        }),
      }),
    },
    ObjectStorageService: FakeObjectStorageService,
  };
});

// Mock dns so the SSRF guard in /api/documents/from-url sees public IPs for
// our synthetic "example.test" hostname without making real DNS queries.
vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dns")>();
  const fakeResolve4 = (hostname: string, cb: any) => {
    cb(null, ["93.184.216.34"]);
  };
  return {
    ...actual,
    default: { ...actual, resolve4: fakeResolve4 },
    resolve4: fakeResolve4,
  };
});

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  planDocuments,
  integrationConnections,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__cloud_doc_import_iso__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Cloud Doc Import Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "CloudDoc",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const projectCode = `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [project] = await db.insert(projects).values({
    name: `Cloud Doc Project ${label}`,
    code: projectCode,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  // Seed an active gdrive connection so /api/documents/from-cloud has a token
  // to pull. The unencrypted token short-circuits decryptToken (returns as-is).
  await db.insert(integrationConnections).values({
    organizationId: org.id,
    provider: "gdrive",
    status: "active",
    metadata: {
      accessToken: `fake-access-${label}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    } as any,
    createdByUserId: user.id,
  });

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM file_permissions WHERE file_type = 'DOCUMENT' AND file_id IN (SELECT id FROM plan_documents WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM integration_connections WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort
  }
}

let app: Express;
let server: Server;
let orgA: SeededOrg;
let orgB: SeededOrg;

const REMOTE_PDF_URL = "https://example.test/sample.pdf";
const REMOTE_PDF_BYTES = Buffer.from("%PDF-1.4\n%fake-pdf-bytes-for-test\n");

const originalFetch = globalThis.fetch;

function makeFetchMock() {
  return vi.fn(async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));

    // Object-storage signed PUT (from getObjectEntityUploadURL mock).
    if (url.startsWith("https://fake-upload.local/")) {
      return new Response(null, { status: 200 });
    }

    // /api/documents/from-url's own download.
    if (url === REMOTE_PDF_URL) {
      return new Response(REMOTE_PDF_BYTES, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(REMOTE_PDF_BYTES.length),
        },
      });
    }

    // /api/documents/from-cloud — Google Drive download.
    if (url.startsWith("https://www.googleapis.com/drive/")) {
      return new Response(REMOTE_PDF_BYTES, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": String(REMOTE_PDF_BYTES.length),
        },
      });
    }

    // Anything else: defer to the real fetch (e.g. nothing in this test).
    return originalFetch(input, init);
  }) as unknown as typeof fetch;
}

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

beforeEach(() => {
  globalThis.fetch = makeFetchMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function planDocsForProject(projectId: string) {
  return db
    .select({ id: planDocuments.id })
    .from(planDocuments)
    .where(eq(planDocuments.projectId, projectId));
}

describe("Task #1420 — cloud-document import endpoint tenancy", () => {
  // ── POST /api/documents/from-url ─────────────────────────────────────────
  it("rejects POST /api/documents/from-url when projectId belongs to another org", async () => {
    const before = await planDocsForProject(orgB.projectId);

    const res = await request(app)
      .post("/api/documents/from-url")
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        url: REMOTE_PDF_URL,
        title: "Cross-tenant injection",
        type: "OTHER",
        projectId: orgB.projectId,
      });

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);

    const after = await planDocsForProject(orgB.projectId);
    expect(after.length).toBe(before.length);
  });

  it("accepts POST /api/documents/from-url when the caller owns the project", async () => {
    const res = await request(app)
      .post("/api/documents/from-url")
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        url: REMOTE_PDF_URL,
        title: "Same-tenant from-url doc",
        type: "OTHER",
        projectId: orgA.projectId,
      });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(orgA.projectId);
    expect(res.body.fileSize).toBe(REMOTE_PDF_BYTES.length);

    if (res.body?.id) {
      await db.delete(planDocuments).where(eq(planDocuments.id, res.body.id)).catch(() => {});
    }
  });

  // ── POST /api/documents/from-cloud ───────────────────────────────────────
  it("rejects POST /api/documents/from-cloud when projectId belongs to another org", async () => {
    const before = await planDocsForProject(orgB.projectId);

    const res = await request(app)
      .post("/api/documents/from-cloud")
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        provider: "gdrive",
        fileId: "fake-drive-file-id",
        fileName: "evil.pdf",
        title: "Cross-tenant cloud injection",
        type: "OTHER",
        projectId: orgB.projectId,
      });

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);

    const after = await planDocsForProject(orgB.projectId);
    expect(after.length).toBe(before.length);
  });

  it("accepts POST /api/documents/from-cloud when the caller owns the project", async () => {
    const res = await request(app)
      .post("/api/documents/from-cloud")
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        provider: "gdrive",
        fileId: "fake-drive-file-id",
        fileName: "ok.pdf",
        title: "Same-tenant from-cloud doc",
        type: "OTHER",
        projectId: orgA.projectId,
      });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(orgA.projectId);
    expect(res.body.fileSize).toBe(REMOTE_PDF_BYTES.length);

    if (res.body?.id) {
      await db.delete(planDocuments).where(eq(planDocuments.id, res.body.id)).catch(() => {});
    }
  });
});
