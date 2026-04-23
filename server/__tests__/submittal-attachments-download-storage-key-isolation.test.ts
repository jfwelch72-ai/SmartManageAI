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
    async getSignedDownloadUrl(file: any, _ttl: number) {
      return `https://signed.example/${encodeURIComponent(file.name)}`;
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
import { organizations, users, projects, submittals, submittalAttachments, uploadIntents } from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__submittal_dl_iso__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  storageKey: string;
  submittalId: string;
  ownAttachmentId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Submittal Download Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Submittal",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Submittal Project ${label}`,
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

  const [submittal] = await db.insert(submittals).values({
    organizationId: org.id,
    projectId: project.id,
    submittalNumber: `S-${label}-${Date.now()}`,
    subject: `Submittal ${label}`,
    submittedById: user.id,
    status: "DRAFT",
  }).returning();

  const [attachment] = await db.insert(submittalAttachments).values({
    submittalId: submittal.id,
    organizationId: org.id,
    fileName: `own-${label}.bin`,
    fileSize: 5,
    mimeType: "application/octet-stream",
    storageKey,
    uploadedById: user.id,
    uploadedByName: `${user.firstName} ${user.lastName}`,
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    storageKey,
    submittalId: submittal.id,
    ownAttachmentId: attachment.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM submittal_attachments WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM submittal_activity WHERE submittal_id IN (SELECT id FROM submittals WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM submittals WHERE organization_id = ${orgId}`).catch(() => {});
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

describe("Task #1328 — submittal attachment download storage-key tenancy", () => {
  it("rejects GET /api/submittals/:id/attachments/:attachmentId/download when the attachment belongs to another org's submittal", async () => {
    const res = await request(app)
      .get(`/api/submittals/${orgB.submittalId}/attachments/${orgB.ownAttachmentId}/download`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  it("rejects GET /api/submittals/:id/attachments/:attachmentId/download when a forged attachment row points at another org's storageKey", async () => {
    // Insert an attachment row owned by Org A's submittal but referencing
    // Org B's storageKey. The defense-in-depth ACL check on the underlying
    // object must reject the read.
    const [forged] = await db.insert(submittalAttachments).values({
      submittalId: orgA.submittalId,
      organizationId: orgA.orgId,
      fileName: "forged.bin",
      fileSize: 5,
      mimeType: "application/octet-stream",
      storageKey: orgB.storageKey,
      uploadedById: orgA.userId,
      uploadedByName: "Forged",
    }).returning();

    try {
      const res = await request(app)
        .get(`/api/submittals/${orgA.submittalId}/attachments/${forged.id}/download`)
        .set("Cookie", `auth_token=${orgA.token}`);

      expect(res.status).toBe(403);
    } finally {
      await db.delete(submittalAttachments).where(eq(submittalAttachments.id, forged.id)).catch(() => {});
    }
  });

  it("allows GET /api/submittals/:id/attachments/:attachmentId/download for the caller org's own attachment", async () => {
    const res = await request(app)
      .get(`/api/submittals/${orgA.submittalId}/attachments/${orgA.ownAttachmentId}/download`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe("string");
  });
});
