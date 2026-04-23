import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Mirrors the approach used by messaging-attachment-storage-key-isolation.test.ts.
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
import {
  organizations,
  users,
  projects,
  crmOrganisations,
  subcontractorPortalTokens,
  clientPortalAccess,
  portalChatThreads,
  portalChatMessages,
  uploadIntents,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";

const TEST_PREFIX = "__portal_attach_iso_test__";

interface SeededOrg {
  orgId: string;
  userId: string;
  userToken: string;
  projectId: string;
  crmOrgId: string;
  portalRawToken: string;
  portalTokenId: string;
  clientAccessId: string;
  clientEmail: string;
  // chat threads
  teamThreadId: string;       // for /team/chat — internal user
  subThreadId: string;        // for /portal/chat — sub portal token
  clientThreadId: string;     // for /client-portal/chat — clientPortalAccess
  storageKey: string;
  gcsObjectName: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Portal Attach Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PortalAttach",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    name: `Portal Attach Iso Project ${label}`,
    code: `PAI-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    clientName: "Test Client",
  }).returning();

  const [crmOrg] = await db.insert(crmOrganisations).values({
    organizationId: org.id,
    type: "SUBCONTRACTOR",
    name: `CRM Sub ${label}`,
  }).returning();

  // Sub portal token
  const portalRawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(portalRawToken, 4);
  const [portalToken] = await db.insert(subcontractorPortalTokens).values({
    organizationId: org.id,
    projectId: project.id,
    crmOrganisationId: crmOrg.id,
    contactEmail: `sub-${slug}@test.local`,
    contactName: `Sub Contact ${label}`,
    tokenHash,
    status: "active",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).returning();

  // Client portal access
  const clientEmail = `client-${slug}@test.local`;
  const [access] = await db.insert(clientPortalAccess).values({
    organizationId: org.id,
    projectId: project.id,
    email: clientEmail,
    name: `Client Contact ${label}`,
    accessType: "STAKEHOLDER",
    isActive: true,
  }).returning();

  // Threads — one per surface, all in this org
  const [teamThread] = await db.insert(portalChatThreads).values({
    organizationId: org.id,
    projectId: project.id,
    portalTokenId: portalToken.id,
    subject: `Team thread ${label}`,
    status: "OPEN",
  }).returning();

  const [subThread] = await db.insert(portalChatThreads).values({
    organizationId: org.id,
    projectId: project.id,
    portalTokenId: portalToken.id,
    subject: `Sub thread ${label}`,
    status: "OPEN",
  }).returning();

  const [clientThread] = await db.insert(portalChatThreads).values({
    organizationId: org.id,
    projectId: project.id,
    clientPortalAccessId: access.id,
    subject: `Client thread ${label}`,
    status: "OPEN",
  }).returning();

  const objectId = `${label}-portalobj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

  const userToken = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    userToken,
    projectId: project.id,
    crmOrgId: crmOrg.id,
    portalRawToken,
    portalTokenId: portalToken.id,
    clientAccessId: access.id,
    clientEmail,
    teamThreadId: teamThread.id,
    subThreadId: subThread.id,
    clientThreadId: clientThread.id,
    storageKey,
    gcsObjectName,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM portal_chat_messages WHERE thread_id IN (SELECT id FROM portal_chat_threads WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM portal_chat_threads WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM client_portal_access WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM subcontractor_portal_tokens WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM crm_organisations WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM upload_intents WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
    await db.execute(sql`DELETE FROM projects WHERE code LIKE 'PAI-%'`).catch(() => {});
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

describe("Task #1356 — portal team chat (/api/team/chat) attachment URL tenancy", () => {
  it("rejects an attachmentUrl pointing at another org's /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/team/chat/threads/${orgA.teamThreadId}/messages`)
      .set("Cookie", `auth_token=${orgA.userToken}`)
      .set("Content-Type", "application/json")
      .send({
        content: "leak attempt",
        attachmentUrl: orgB.storageKey,
        attachmentName: "leak.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(403);

    const leaked = await db
      .select({ id: portalChatMessages.id })
      .from(portalChatMessages)
      .where(eq(portalChatMessages.attachmentUrl, orgB.storageKey));
    expect(leaked.length).toBe(0);
  });

  it("rejects an attachmentUrl that is not an /objects/ reference", async () => {
    const res = await request(app)
      .post(`/api/team/chat/threads/${orgA.teamThreadId}/messages`)
      .set("Cookie", `auth_token=${orgA.userToken}`)
      .set("Content-Type", "application/json")
      .send({
        content: "external",
        attachmentUrl: "https://evil.example.com/leak.png",
      });

    expect(res.status).toBe(403);
  });

  it("accepts an attachmentUrl referencing the caller's own /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/team/chat/threads/${orgA.teamThreadId}/messages`)
      .set("Cookie", `auth_token=${orgA.userToken}`)
      .set("Content-Type", "application/json")
      .send({
        content: "own object",
        attachmentUrl: orgA.storageKey,
        attachmentName: "own.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    if (res.body?.id) {
      await db.delete(portalChatMessages).where(eq(portalChatMessages.id, res.body.id)).catch(() => {});
    }
  });
});

describe("Task #1356 — sub portal chat (/api/portal/chat) attachment URL tenancy", () => {
  it("rejects an attachmentUrl pointing at another org's /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/portal/chat/threads/${orgA.subThreadId}/messages`)
      .set("x-portal-token", orgA.portalRawToken)
      .set("Content-Type", "application/json")
      .send({
        content: "leak attempt",
        attachmentUrl: orgB.storageKey,
        attachmentName: "leak.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(403);

    const leaked = await db
      .select({ id: portalChatMessages.id })
      .from(portalChatMessages)
      .where(eq(portalChatMessages.attachmentUrl, orgB.storageKey));
    expect(leaked.length).toBe(0);
  });

  it("rejects an attachmentUrl that is not an /objects/ reference", async () => {
    const res = await request(app)
      .post(`/api/portal/chat/threads/${orgA.subThreadId}/messages`)
      .set("x-portal-token", orgA.portalRawToken)
      .set("Content-Type", "application/json")
      .send({
        content: "external",
        attachmentUrl: "https://evil.example.com/leak.png",
      });

    expect(res.status).toBe(403);
  });

  it("accepts an attachmentUrl referencing this org's own /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/portal/chat/threads/${orgA.subThreadId}/messages`)
      .set("x-portal-token", orgA.portalRawToken)
      .set("Content-Type", "application/json")
      .send({
        content: "own object",
        attachmentUrl: orgA.storageKey,
        attachmentName: "own.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    if (res.body?.id) {
      await db.delete(portalChatMessages).where(eq(portalChatMessages.id, res.body.id)).catch(() => {});
    }
  });
});

describe("Task #1356 — client portal chat (/api/client-portal/chat) attachment URL tenancy", () => {
  it("rejects an attachmentUrl pointing at another org's /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/client-portal/chat/threads/${orgA.clientThreadId}/messages`)
      .set("x-client-email", orgA.clientEmail)
      .set("x-client-project-id", orgA.projectId)
      .set("Content-Type", "application/json")
      .send({
        content: "leak attempt",
        attachmentUrl: orgB.storageKey,
        attachmentName: "leak.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(403);

    const leaked = await db
      .select({ id: portalChatMessages.id })
      .from(portalChatMessages)
      .where(eq(portalChatMessages.attachmentUrl, orgB.storageKey));
    expect(leaked.length).toBe(0);
  });

  it("rejects an attachmentUrl that is not an /objects/ reference", async () => {
    const res = await request(app)
      .post(`/api/client-portal/chat/threads/${orgA.clientThreadId}/messages`)
      .set("x-client-email", orgA.clientEmail)
      .set("x-client-project-id", orgA.projectId)
      .set("Content-Type", "application/json")
      .send({
        content: "external",
        attachmentUrl: "https://evil.example.com/leak.png",
      });

    expect(res.status).toBe(403);
  });

  it("accepts an attachmentUrl referencing this org's own /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/client-portal/chat/threads/${orgA.clientThreadId}/messages`)
      .set("x-client-email", orgA.clientEmail)
      .set("x-client-project-id", orgA.projectId)
      .set("Content-Type", "application/json")
      .send({
        content: "own object",
        attachmentUrl: orgA.storageKey,
        attachmentName: "own.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    if (res.body?.id) {
      await db.delete(portalChatMessages).where(eq(portalChatMessages.id, res.body.id)).catch(() => {});
    }
  });
});
