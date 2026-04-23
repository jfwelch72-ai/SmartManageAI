import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Same approach used by document-revision-storage-key-isolation.test.ts.
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
import { organizations, users, projects, addenda, uploadIntents } from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__addendum_iso_test__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  storageKey: string;
  addendumId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Addendum Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Addendum",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Addendum Project ${label}`,
    code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

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

  // Seed an existing addendum referencing this storage key, for the
  // preview-url cross-tenant test.
  const [addendum] = await db.insert(addenda).values({
    organizationId: org.id,
    projectId: project.id,
    addendumNumber: 1,
    title: `Addendum ${label}`,
    storageKey,
    fileName: `addendum-${label}.bin`,
    status: "DRAFT",
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    storageKey,
    addendumId: addendum.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM addendum_acknowledgments WHERE addendum_id IN (SELECT id FROM addenda WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM addenda WHERE organization_id = ${orgId}`).catch(() => {});
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

describe("Task #1303 — addendum storage-key tenancy", () => {
  it("rejects POST /api/projects/:projectId/addenda when storageKey belongs to another org", async () => {
    const res = await request(app)
      .post(`/api/projects/${orgA.projectId}/addenda`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ title: "Cross-tenant attempt", storageKey: orgB.storageKey });

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });

  it("accepts POST /api/projects/:projectId/addenda when storageKey belongs to caller org", async () => {
    const res = await request(app)
      .post(`/api/projects/${orgA.projectId}/addenda`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({ title: "Same-tenant attach", storageKey: orgA.storageKey });

    expect(res.status).toBe(201);
    expect(res.body.organizationId).toBe(orgA.orgId);

    // Cleanup the addendum we just created so the cleanup hook doesn't fight
    // over ordering with the seeded addendum.
    if (res.body?.id) {
      await db.delete(addenda).where(eq(addenda.id, res.body.id)).catch(() => {});
    }
  });

  it("rejects GET /api/addenda/:id/preview-url for another org's addendum", async () => {
    const res = await request(app)
      .get(`/api/addenda/${orgB.addendumId}/preview-url`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
  });

  it("rejects preview-url even if an addendum row was forged with another org's storageKey", async () => {
    // Insert an addendum row owned by Org A but pointing at Org B's storageKey
    // and try to stream it.
    const [forged] = await db.insert(addenda).values({
      organizationId: orgA.orgId,
      projectId: orgA.projectId,
      addendumNumber: 999,
      title: "Forged",
      storageKey: orgB.storageKey,
      status: "DRAFT",
    }).returning();

    try {
      const res = await request(app)
        .get(`/api/addenda/${forged.id}/preview-url`)
        .set("Cookie", `auth_token=${orgA.token}`);

      expect(res.status).toBe(403);
    } finally {
      await db.delete(addenda).where(eq(addenda.id, forged.id)).catch(() => {});
    }
  });
});
