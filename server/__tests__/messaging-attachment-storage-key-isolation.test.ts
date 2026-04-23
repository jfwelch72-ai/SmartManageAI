import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Mock objectStorage so we can simulate per-org private files without GCS.
// Mirrors the approach used by addendum-storage-key-isolation.test.ts.
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
  conversations,
  conversationParticipants,
  messages,
  uploadIntents,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__msg_attach_iso_test__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  conversationId: string;
  storageKey: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Msg Attach Iso Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "MsgAttach",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [conv] = await db.insert(conversations).values({
    organizationId: org.id,
    type: "GROUP",
    name: `Attach Iso Conversation ${label}`,
    createdById: user.id,
  }).returning();

  await db.insert(conversationParticipants).values({
    conversationId: conv.id,
    userId: user.id,
    isAdmin: true,
  });

  const objectId = `${label}-msgobj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return { orgId: org.id, userId: user.id, token, conversationId: conv.id, storageKey };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM conversation_participants WHERE conversation_id IN (SELECT id FROM conversations WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM conversations WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM upload_intents WHERE organization_id = ${orgId}`).catch(() => {});
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

describe("Task #1347 — chat attachment URL tenancy", () => {
  it("rejects attachmentUrl pointing at another org's /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "leak attempt",
        attachmentUrl: orgB.storageKey,
        attachmentName: "leak.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(403);

    // Ensure no message row was persisted referencing Org B's key.
    const leaked = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.attachmentUrl, orgB.storageKey));
    expect(leaked.length).toBe(0);
  });

  it("rejects voiceUrl pointing at another org's /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        voiceUrl: orgB.storageKey,
        voiceDurationSeconds: 3,
      });

    expect(res.status).toBe(403);

    // Ensure no message row was persisted referencing Org B's key via voiceUrl.
    const leaked = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.voiceUrl, orgB.storageKey));
    expect(leaked.length).toBe(0);
  });

  it("rejects attachmentUrl that points at a sibling conversation's proxy URL", async () => {
    const fakeOtherConv = `00000000-0000-0000-0000-000000000999`;
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "wrong conversation",
        attachmentUrl: `/api/conversations/${fakeOtherConv}/files/leak.png`,
      });

    expect(res.status).toBe(403);
  });

  it("rejects an attachmentUrl with a totally unrelated absolute URL", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "external",
        attachmentUrl: "https://evil.example.com/leak.png",
      });

    expect(res.status).toBe(403);
  });

  it("accepts attachmentUrl matching this conversation's own proxy URL", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "ok attach",
        attachmentUrl: `/api/conversations/${orgA.conversationId}/files/abc.png`,
        attachmentName: "abc.png",
        attachmentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(res.body.attachmentUrl).toBe(`/api/conversations/${orgA.conversationId}/files/abc.png`);
    if (res.body?.id) {
      await db.delete(messages).where(eq(messages.id, res.body.id)).catch(() => {});
    }
  });

  it("accepts attachmentUrl referencing the caller's own /objects/ key", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "own object",
        attachmentUrl: orgA.storageKey,
        attachmentName: "own.bin",
        attachmentType: "application/octet-stream",
      });

    expect(res.status).toBe(201);
    if (res.body?.id) {
      await db.delete(messages).where(eq(messages.id, res.body.id)).catch(() => {});
    }
  });

  it("rejects an attachmentUrl with traversal in the filename portion", async () => {
    const res = await request(app)
      .post(`/api/conversations/${orgA.conversationId}/messages`)
      .set("Cookie", `auth_token=${orgA.token}`)
      .set("Content-Type", "application/json")
      .send({
        content: "traversal",
        attachmentUrl: `/api/conversations/${orgA.conversationId}/files/../../etc/passwd`,
      });

    expect([400, 403]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });
});
