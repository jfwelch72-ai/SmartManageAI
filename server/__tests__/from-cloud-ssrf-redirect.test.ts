import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1456 — handler-level coverage for `POST /api/documents/from-cloud`
// ensuring that when the cloud provider replies with a 302 to an internal
// address, the request is blocked with a 400 (no plan_document is created
// and no bytes are written to object storage). This locks in the SSRF guard
// inside `safeDownload` as wired up by the from-cloud handler.
// ─────────────────────────────────────────────────────────────────────────────

const dnsMap = new Map<string, string[]>();
function setDns(host: string, ips: string[]) {
  dnsMap.set(host, ips);
}

vi.mock("dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dns")>();
  const fakeResolve4 = (hostname: string, cb: any) => {
    const ips = dnsMap.get(hostname);
    if (ips && ips.length) return cb(null, ips);
    return cb(new Error("ENOTFOUND " + hostname));
  };
  return {
    ...actual,
    default: { ...actual, resolve4: fakeResolve4 },
    resolve4: fakeResolve4,
  };
});

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
    async trySetObjectEntityAclPolicy(rawPath: string) {
      return this.normalizeObjectEntityPath(rawPath);
    }
    async getObjectEntityFile() {
      throw new actual.ObjectNotFoundError();
    }
    async canAccessObjectEntity() {
      return true;
    }
  }
  return {
    ...actual,
    objectStorageClient: {
      bucket: () => ({
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

const TEST_PREFIX = "__from_cloud_ssrf__";

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
    name: `From-Cloud SSRF Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "FromCloud",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const projectCode = `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [project] = await db.insert(projects).values({
    name: `From-Cloud SSRF Project ${label}`,
    code: projectCode,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

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
  return { orgId: org.id, userId: user.id, token, projectId: project.id };
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
let org: SeededOrg;

const originalFetch = globalThis.fetch;

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

  org = await seedOrg("A");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

beforeEach(() => {
  dnsMap.clear();
  // googleapis.com always resolves to a public IP so the initial URL passes
  // the SSRF guard and the request actually reaches the redirect logic.
  setDns("www.googleapis.com", ["142.250.80.1"]);
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

describe("Task #1456 — POST /api/documents/from-cloud SSRF redirect blocking", () => {
  it("returns 400 when the provider 302-redirects to an internal IP, and creates no document", async () => {
    setDns("metadata.test", ["169.254.169.254"]);

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith("https://www.googleapis.com/drive/")) {
        // Provider replies with a redirect pointing at AWS-style metadata.
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        // We should NEVER reach the upload phase when SSRF is blocked.
        throw new Error("upload should not be reached when SSRF is blocked");
      }
      // Anything else: defer to the real fetch (nothing in this test).
      return originalFetch(input);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await request(app)
      .post("/api/documents/from-cloud")
      .set("Cookie", `auth_token=${org.token}`)
      .set("Content-Type", "application/json")
      .send({
        provider: "gdrive",
        fileId: "fake-file-id",
        fileName: "evil.pdf",
        title: "Should be blocked",
        type: "OTHER",
        projectId: org.projectId,
      });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || "")).toMatch(/unsafe destination/i);

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("returns 400 when the provider 302-redirects to a private RFC1918 host", async () => {
    setDns("intranet.test", ["10.0.0.5"]);

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith("https://www.googleapis.com/drive/")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://intranet.test/secret.pdf" },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        throw new Error("upload should not be reached when SSRF is blocked");
      }
      return originalFetch(input);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await request(app)
      .post("/api/documents/from-cloud")
      .set("Cookie", `auth_token=${org.token}`)
      .set("Content-Type", "application/json")
      .send({
        provider: "gdrive",
        fileId: "another-id",
        fileName: "intranet.pdf",
        title: "Should also be blocked",
        type: "OTHER",
        projectId: org.projectId,
      });

    expect(res.status).toBe(400);
    expect(String(res.body?.error || "")).toMatch(/unsafe destination/i);

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });
});
