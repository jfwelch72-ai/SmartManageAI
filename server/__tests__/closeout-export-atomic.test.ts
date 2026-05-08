import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Task #2689 — GCS-first atomic closeout export.
//
// We mock objectStorageClient with a Map-backed fake bucket so the test can:
//   - assert the temp-key-then-promote-to-final-key sequence
//   - assert that a GCS failure leaves NO final-key object behind
//   - assert that a client-disconnect-after-success still leaves a verified
//     READY package row + final-key object intact (because the response is
//     committed BEFORE the client receives it).
// ─────────────────────────────────────────────────────────────────────────────
const FAKE_FILES = new Map<string, Buffer>();
let failNextCopy = false;
let failNextSave = false;

vi.mock("../objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectStorage")>();
  const fileFor = (name: string) => ({
    name,
    bucket: { name: "test-bucket" },
    save: async (buf: Buffer | string) => {
      if (failNextSave) {
        failNextSave = false;
        throw new Error("simulated GCS save failure");
      }
      FAKE_FILES.set(name, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      return [{}];
    },
    copy: async (dest: any) => {
      if (failNextCopy) {
        failNextCopy = false;
        throw new Error("simulated GCS copy failure");
      }
      const src = FAKE_FILES.get(name);
      if (!src) throw new Error(`copy: source ${name} missing`);
      FAKE_FILES.set(dest.name, Buffer.from(src));
      return [{}];
    },
    delete: async (_opts: any) => {
      FAKE_FILES.delete(name);
      return [{}];
    },
    exists: async () => [FAKE_FILES.has(name)],
    getMetadata: async () => [{ contentType: "application/zip", size: String(FAKE_FILES.get(name)?.length ?? 0), metadata: {} }],
    setMetadata: async () => [{}],
    createReadStream: () => Readable.from([FAKE_FILES.get(name) ?? Buffer.from("")]),
    getSignedUrl: async () => ["https://signed.test/url"],
  });

  class FakeObjectStorageService {
    getPrivateObjectDir() {
      return process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";
    }
    async getSignedDownloadUrl(_file: any, _ttl?: number): Promise<string> {
      return "https://signed.test/closeout";
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
  closeoutChecklists,
  closeoutItems,
  closeoutPackages,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__closeout_atomic__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  projectCode: string;
  checklistId: string;
}

async function seed(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db.insert(organizations).values({
    name: `Closeout Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "Closeout",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const code = `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [project] = await db.insert(projects).values({
    name: `Closeout Project ${label}`,
    code,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

  const [checklist] = await db.insert(closeoutChecklists).values({
    organizationId: org.id,
    projectId: project.id,
    name: "Project Closeout",
    createdById: user.id,
  }).returning();

  await db.insert(closeoutItems).values([
    {
      checklistId: checklist.id,
      projectId: project.id,
      category: "WARRANTY",
      title: "Roof warranty",
      status: "COMPLETE",
      sortOrder: 0,
    },
    {
      checklistId: checklist.id,
      projectId: project.id,
      category: "PUNCH_LIST",
      title: "Final punch sign-off",
      status: "COMPLETE",
      sortOrder: 1,
    },
  ]);

  const token = generateToken(user.id, (user as any).tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    projectCode: code,
    checklistId: checklist.id,
  };
}

async function cleanup(): Promise<void> {
  try {
    const res = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as { rows?: Array<{ id: string }> };
    const orgIds: string[] = (res.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM closeout_packages WHERE checklist_id IN (SELECT id FROM closeout_checklists WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM closeout_items WHERE checklist_id IN (SELECT id FROM closeout_checklists WHERE organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM closeout_checklists WHERE organization_id = ${orgId}`).catch(() => {});
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

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = "/test-bucket/private";

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
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

beforeEach(() => {
  FAKE_FILES.clear();
  failNextCopy = false;
  failNextSave = false;
});

describe("Task #2689 — closeout export is GCS-first and atomic", () => {
  it("happy path: writes verified ZIP to final key, deletes temp, marks READY with checksum/size/completedAt", async () => {
    const ctx = await seed("happy");

    const res = await request(app)
      .post(`/api/projects/${ctx.projectCode}/closeout/export`)
      .set("Cookie", `auth_token=${ctx.token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("READY");
    expect(typeof res.body.packageId).toBe("string");
    expect(typeof res.body.checksum).toBe("string");
    expect(res.body.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.fileSize).toBeGreaterThan(0);
    expect(res.body.fileCount).toBeGreaterThan(0);
    expect(typeof res.body.completedAt).toBe("string");
    expect(res.body.downloadEndpoint).toContain(`/api/projects/${ctx.projectCode}/closeout/packages/`);

    // Final key present, temp key deleted.
    const finalKeys = [...FAKE_FILES.keys()].filter((k) => k.includes("/closeout/") && !k.includes("/.tmp/"));
    const tempKeys = [...FAKE_FILES.keys()].filter((k) => k.includes("/.tmp/"));
    expect(finalKeys.length).toBe(1);
    expect(tempKeys.length).toBe(0);

    // Package row reflects the verified state.
    const [pkg] = await db.select().from(closeoutPackages).where(eq(closeoutPackages.id, res.body.packageId));
    expect(pkg.status).toBe("READY");
    expect(pkg.storageKey).toBeTruthy();
    expect(pkg.checksum).toBe(res.body.checksum);
    expect(pkg.fileSize).toBe(res.body.fileSize);
    expect(pkg.completedAt).not.toBeNull();
  });

  it("GCS failure: package marked FAILED, NO final-key object exists", async () => {
    const ctx = await seed("gcsfail");
    failNextCopy = true;

    const res = await request(app)
      .post(`/api/projects/${ctx.projectCode}/closeout/export`)
      .set("Cookie", `auth_token=${ctx.token}`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Closeout export failed");
    expect(typeof res.body.packageId).toBe("string");

    const finalKeys = [...FAKE_FILES.keys()].filter((k) => k.includes("/closeout/") && !k.includes("/.tmp/"));
    expect(finalKeys.length).toBe(0);

    const [pkg] = await db.select().from(closeoutPackages).where(eq(closeoutPackages.id, res.body.packageId));
    expect(pkg.status).toBe("FAILED");
    expect(pkg.errorMessage).toContain("simulated GCS copy failure");
    expect(pkg.checksum).toBeNull();
    expect(pkg.completedAt).toBeNull();
    expect(pkg.storageKey).toBeNull();
  });

  it("client-disconnect-after-GCS-success: package row + final-key object survive, download endpoint serves it", async () => {
    const ctx = await seed("disconnect");

    // Build the package normally — the server commits READY before delivery,
    // so even if the client drops the response, the row + object exist.
    const res = await request(app)
      .post(`/api/projects/${ctx.projectCode}/closeout/export`)
      .set("Cookie", `auth_token=${ctx.token}`)
      .send({});
    expect(res.status).toBe(200);
    const packageId = res.body.packageId;

    // Simulate the client never having read the response: throw away `res`
    // and re-fetch via the authoritative download endpoint. The download
    // endpoint MUST 302 to a fresh signed URL because the row is READY +
    // checksum + completedAt + storageKey.
    const dl = await request(app)
      .get(`/api/projects/${ctx.projectCode}/closeout/packages/${packageId}/download`)
      .set("Cookie", `auth_token=${ctx.token}`)
      .redirects(0);

    expect(dl.status).toBe(302);
    expect(dl.headers.location).toBe("https://signed.test/closeout");

    // And the final-key object is still present in the fake bucket.
    const finalKeys = [...FAKE_FILES.keys()].filter((k) => k.includes("/closeout/") && !k.includes("/.tmp/"));
    expect(finalKeys.length).toBe(1);
  });
});
