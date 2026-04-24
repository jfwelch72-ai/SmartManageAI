import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { Readable } from "stream";

// ─────────────────────────────────────────────────────────────────────────────
// Task #1499 — Integration tests for `POST /api/documents/from-url`. After
// the handler was refactored to delegate to `safeDownload()` (Task #1455),
// the user-visible error strings and HTTP status codes were deliberately
// preserved via a translation table. These tests pin that contract so any
// future change to `safeDownload` or the translator is caught immediately:
//   • success path (small PDF round-trips and creates a plan_document row)
//   • SSRF rejection (initial host resolves to a private IP)
//   • unsafe redirect (provider 302s to a private IP)
//   • oversize file (advertised content-length > 100MB)
//   • disallowed content type (mime type outside the allowlist)
//   • request timeout (fetch is aborted via AbortError)
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
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__from_url_importer__";
const PUBLIC_HOST = "files.example.test";
const PUBLIC_IP = "203.0.113.10";

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
    name: `From-URL Importer Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "FromUrl",
    lastName: `Tester-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const projectCode = `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [project] = await db.insert(projects).values({
    name: `From-URL Importer Project ${label}`,
    code: projectCode,
    clientName: `Client ${label}`,
    gcOrganizationId: org.id,
    status: "ACTIVE",
  }).returning();

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
  setDns(PUBLIC_HOST, [PUBLIC_IP]);
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

function postFromUrl(body: Record<string, unknown>) {
  return request(app)
    .post("/api/documents/from-url")
    .set("Cookie", `auth_token=${org.token}`)
    .set("Content-Type", "application/json")
    .send(body);
}

describe("Task #1499 — POST /api/documents/from-url", () => {
  it("downloads, stores, and creates a plan_document on the success path", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4\n%fake test pdf body\n%%EOF\n");
    let uploadCalled = false;

    globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith(`https://${PUBLIC_HOST}/`)) {
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(pdfBytes.length),
          },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        uploadCalled = true;
        return new Response(null, { status: 200 });
      }
      return originalFetch(input, init);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/specs/site-plan.pdf`,
      title: "Site Plan",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(201);
    expect(res.body?.id).toBeTruthy();
    expect(res.body?.title).toBe("Site Plan");
    expect(res.body?.fileSize).toBe(pdfBytes.length);
    expect(res.body?.mimeType).toBe("application/pdf");
    expect(uploadCalled).toBe(true);

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length + 1);
  });

  it("rejects non-HTTPS URLs with 400 'Only HTTPS URLs are allowed'", async () => {
    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `http://${PUBLIC_HOST}/file.pdf`,
      title: "Insecure",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("Only HTTPS URLs are allowed");

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("blocks URLs whose hostname resolves to a private IP (SSRF)", async () => {
    setDns("intranet.test", ["10.0.0.5"]);

    globalThis.fetch = (async (): Promise<Response> => {
      throw new Error("fetch should not be reached when SSRF is blocked");
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: "https://intranet.test/secret.pdf",
      title: "Internal",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "This URL points to an internal network address and can't be accessed. Please use a publicly accessible link.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("blocks a redirect that lands on an unsafe destination", async () => {
    setDns("metadata.test", ["169.254.169.254"]);

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith(`https://${PUBLIC_HOST}/`)) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://metadata.test/latest/meta-data/" },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        throw new Error("upload should not be reached when redirect is blocked");
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/redir.pdf`,
      title: "Redirected",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "This link redirected to an unsafe destination and was blocked for security.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("rejects responses whose advertised size exceeds the 100MB cap", async () => {
    const tooBig = String(101 * 1024 * 1024);

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith(`https://${PUBLIC_HOST}/`)) {
        // Empty body but advertise an oversize content-length so the
        // pre-stream guard rejects without us actually allocating 100MB.
        return new Response(Buffer.alloc(0), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": tooBig,
          },
        });
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/huge.pdf`,
      title: "Too big",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "This file is too large (over 100MB). Please use a smaller file.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("rejects responses whose content-type is outside the allowlist", async () => {
    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith(`https://${PUBLIC_HOST}/`)) {
        return new Response(Buffer.from("MZ"), {
          status: 200,
          headers: {
            "content-type": "application/x-msdownload",
            "content-length": "2",
          },
        });
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/installer.exe`,
      title: "Bad type",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "This file type isn't supported. You can upload PDFs, images, Office documents, or CSV files.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("rejects redirect chains that exceed the maxRedirects limit (3)", async () => {
    setDns("hop1.example.test", [PUBLIC_IP]);
    setDns("hop2.example.test", [PUBLIC_IP]);
    setDns("hop3.example.test", [PUBLIC_IP]);
    setDns("hop4.example.test", [PUBLIC_IP]);

    // Route passes maxRedirects: 3, so the 4th hop must trigger the
    // "Too many redirects." mapping.
    const chain: Record<string, string> = {
      [`https://${PUBLIC_HOST}/start.pdf`]: "https://hop1.example.test/a",
      "https://hop1.example.test/a": "https://hop2.example.test/b",
      "https://hop2.example.test/b": "https://hop3.example.test/c",
      "https://hop3.example.test/c": "https://hop4.example.test/d",
    };

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      const next = chain[url];
      if (next) {
        return new Response(null, {
          status: 302,
          headers: { location: next },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        throw new Error("upload should not be reached when redirect limit is exceeded");
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/start.pdf`,
      title: "Too many hops",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe(
      "This link redirects too many times. Please paste the final download link instead.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });

  it("follows a redirect chain under the limit and creates the document", async () => {
    setDns("hopa.example.test", [PUBLIC_IP]);
    setDns("hopb.example.test", [PUBLIC_IP]);

    const pdfBytes = Buffer.from("%PDF-1.4\n%redirected body\n%%EOF\n");
    const chain: Record<string, string> = {
      [`https://${PUBLIC_HOST}/redir-ok.pdf`]: "https://hopa.example.test/x",
      "https://hopa.example.test/x": "https://hopb.example.test/y",
    };
    let uploadCalled = false;

    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      const next = chain[url];
      if (next) {
        return new Response(null, {
          status: 302,
          headers: { location: next },
        });
      }
      if (url === "https://hopb.example.test/y") {
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(pdfBytes.length),
          },
        });
      }
      if (url.startsWith("https://fake-upload.local/")) {
        uploadCalled = true;
        return new Response(null, { status: 200 });
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/redir-ok.pdf`,
      title: "Redirect under limit",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(201);
    expect(res.body?.id).toBeTruthy();
    expect(uploadCalled).toBe(true);

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length + 1);
  });

  it("returns 408 with the timeout message when the download is aborted", async () => {
    globalThis.fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      if (url.startsWith(`https://${PUBLIC_HOST}/`)) {
        // Simulate the AbortController firing — `safeDownload` maps any
        // AbortError to its 408 "took too long" branch.
        const err = new Error("aborted");
        (err as any).name = "AbortError";
        throw err;
      }
      throw new Error("unexpected fetch: " + url);
    }) as any;

    const before = await planDocsForProject(org.projectId);

    const res = await postFromUrl({
      url: `https://${PUBLIC_HOST}/slow.pdf`,
      title: "Slow",
      type: "OTHER",
      projectId: org.projectId,
    });

    expect(res.status).toBe(408);
    expect(res.body?.error).toBe(
      "The download took too long (over 30 seconds). Please try a smaller file or a faster link.",
    );

    const after = await planDocsForProject(org.projectId);
    expect(after.length).toBe(before.length);
  });
});
