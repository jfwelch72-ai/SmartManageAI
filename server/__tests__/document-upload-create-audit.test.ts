import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1534 — Regression coverage for the standard `POST /api/documents`
// upload route. Until this task, only the from-url and from-cloud importer
// routes wrote a CREATE audit_log row when a plan_document was created;
// the plain upload path silently inserted the row, leaving compliance and
// cross-tenant investigations with an incomplete trail. This test asserts
// that a successful upload now produces a CREATE audit_log row keyed to the
// new plan_document, mirroring the importer routes.
// ─────────────────────────────────────────────────────────────────────────────

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
    async getObjectEntityFile() {
      throw new actual.ObjectNotFoundError();
    }
    async canAccessObjectEntity() {
      return true;
    }
    async trySetObjectEntityAclPolicy(rawPath: string) {
      return this.normalizeObjectEntityPath(rawPath);
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

// Bypass the cross-org storage-key guard — this test is about the audit row,
// not the tenancy check (which has its own coverage in
// upload-storage-key-isolation.test.ts).
vi.mock("../services/documentRevisionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/documentRevisionService")>();
  return {
    ...actual,
    assertStorageKeyBelongsToOrg: async () => {},
  };
});

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  planDocuments,
  auditLog,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, and, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__doc_upload_audit__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  storageKey: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Doc Upload Audit Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Audit",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const projectCode = `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [project] = await db.insert(projects).values({
    name: `Doc Upload Audit Project ${label}`,
    code: projectCode,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const objectId = `${label}-obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const storageKey = `/objects/${org.id}/uploads/${objectId}`;

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return { orgId: org.id, userId: user.id, token, projectId: project.id, storageKey };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM file_permissions WHERE file_type = 'DOCUMENT' AND file_id IN (SELECT id FROM plan_documents WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
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

describe("Task #1534 — POST /api/documents writes a CREATE audit row", () => {
  it("inserts an audit_log CREATE row keyed to the new plan_document", async () => {
    const res = await request(app)
      .post("/api/documents")
      .set("Cookie", `auth_token=${org.token}`)
      .set("Content-Type", "application/json")
      .send({
        projectId: org.projectId,
        type: "OTHER",
        title: "Audited Upload",
        fileName: "audited.pdf",
        fileUrl: org.storageKey,
        mimeType: "application/pdf",
        fileSize: 1234,
      });

    expect(res.status).toBe(201);
    expect(res.body?.id).toBeTruthy();

    const docId: string = res.body.id;

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, "plan_document"), eq(auditLog.entityId, docId)));

    expect(auditRows.length).toBe(1);
    const row = auditRows[0];
    expect(row.action).toBe("CREATE");
    expect(row.userId).toBe(org.userId);
    expect(row.oldValue).toBeNull();
    expect(typeof row.newValue).toBe("string");

    const parsed = JSON.parse(row.newValue ?? "{}");
    expect(parsed.source).toBe("upload");
    expect(parsed.projectId).toBe(org.projectId);
    expect(parsed.title).toBe("Audited Upload");
    expect(parsed.mimeType).toBe("application/pdf");

    // Cleanup the row created by this test (the suite's afterAll also
    // sweeps, but be tidy in case other suites share the prefix).
    await db.delete(planDocuments).where(eq(planDocuments.id, docId)).catch(() => {});
  });
});
