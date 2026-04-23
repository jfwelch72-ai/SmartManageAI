import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Mirrors addendum-storage-key-isolation.test.ts and
// submittal-files-storage-key-isolation.test.ts.
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
    async trySetObjectEntityAclPolicy(rawPath: string, _policy: any) {
      return this.normalizeObjectEntityPath(rawPath);
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
import { organizations, users, projects, documentTransmittals, uploadIntents } from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__transmittal_files_iso__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  storageKey: string;
  transmittalId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Transmittal Files Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Transmittal",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Transmittal Project ${label}`,
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

  const [transmittal] = await db.insert(documentTransmittals).values({
    organizationId: org.id,
    projectId: project.id,
    transmittalNumber: `TX-${label}-${Date.now()}`,
    subject: `Transmittal ${label}`,
    sentById: user.id,
    sentByName: `Transmittal Tester-${label}`,
    status: "DRAFT",
  }).returning();

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    storageKey,
    transmittalId: transmittal.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM transmittal_recipients WHERE transmittal_id IN (SELECT id FROM document_transmittals WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM document_transmittals WHERE organization_id = ${orgId}`).catch(() => {});
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

describe("Task #1343 — transmittal attachment storage-key tenancy", () => {
  it("rejects POST /api/transmittals/:id/files when fileUrl belongs to another org", async () => {
    const res = await request(app)
      .post(`/api/transmittals/${orgA.transmittalId}/files`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        fileUrl: orgB.storageKey,
        fileName: "cross-tenant.bin",
        fileSize: 5,
        mimeType: "application/octet-stream",
      });

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(201);

    // Confirm no attachment was persisted to Org A's transmittal
    const [row] = await db
      .select({ attachmentsJson: documentTransmittals.attachmentsJson })
      .from(documentTransmittals)
      .where(eq(documentTransmittals.id, orgA.transmittalId));
    expect(row?.attachmentsJson ?? null).toBeNull();
  });

  it("accepts POST /api/transmittals/:id/files when fileUrl belongs to caller org", async () => {
    const res = await request(app)
      .post(`/api/transmittals/${orgA.transmittalId}/files`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        fileUrl: orgA.storageKey,
        fileName: "same-tenant.bin",
        fileSize: 5,
        mimeType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    expect(res.body.fileUrl).toBe(orgA.storageKey);

    // Reset attachmentsJson so other tests start clean.
    await db
      .update(documentTransmittals)
      .set({ attachmentsJson: null })
      .where(eq(documentTransmittals.id, orgA.transmittalId))
      .catch(() => {});
  });

  it("rejects POST /api/transmittals/:id/files for another org's transmittal", async () => {
    const res = await request(app)
      .post(`/api/transmittals/${orgB.transmittalId}/files`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        fileUrl: orgA.storageKey,
        fileName: "cross-tenant-target.bin",
        fileSize: 5,
        mimeType: "application/octet-stream",
      });

    expect([403, 404]).toContain(res.status);

    const [row] = await db
      .select({ attachmentsJson: documentTransmittals.attachmentsJson })
      .from(documentTransmittals)
      .where(eq(documentTransmittals.id, orgB.transmittalId));
    expect(row?.attachmentsJson ?? null).toBeNull();
  });

  it("rejects GET /api/transmittals/:id/files for another org's transmittal", async () => {
    const res = await request(app)
      .get(`/api/transmittals/${orgB.transmittalId}/files`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect([403, 404]).toContain(res.status);
  });
});
