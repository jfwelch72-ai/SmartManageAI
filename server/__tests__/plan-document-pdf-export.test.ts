/**
 * Task #1612 — end-to-end coverage for `GET /api/plan-documents/:id/export.pdf`.
 *
 * This is a real-Playwright test. It launches the bundled headless
 * Chromium against a self-contained "test print page" mounted on the
 * Express test app. The test print page mirrors the contract the real
 * `PlanDocumentPrintPage.tsx` exposes (fetches a fixture PDF, rasterizes
 * it via pdfjs-dist, sets `window.__PLAN_PDF_PAGE_COUNT` and
 * `window.__PLAN_PDF_READY`) so the route's renderer (`renderPlanDocumentPdf`)
 * exercises a real navigation -> readiness wait -> page.pdf() pipeline.
 *
 * Coverage:
 *   1. Happy path — the export endpoint returns a valid PDF byte stream
 *      (asserted via `%PDF-` magic bytes + pdf-lib parse for page count).
 *   2. The 500-page guard returns HTTP 413 when the print page reports
 *      a page count above MAX_PAGES.
 *   3. `recordJobMetrics("plan_document_pdf_export", ...)` emissions
 *      are spot-checked on both paths.
 *
 * Skips automatically when no Chromium binary is discoverable.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import type { Server } from "http";
import type { Express, Request, Response } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
} from "@shared/schema";
import { generateToken } from "../auth";
import { getJobMetrics } from "../utils/jobMetrics";

const TEST_PREFIX = "__plandoc_export_e2e__";

function resolveChromium(): string | undefined {
  const explicit =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit && existsSync(explicit)) return explicit;
  for (const p of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  try {
    const found = execSync(
      "ls -d /nix/store/*playwright-browsers*/chromium-*/chrome-linux/chrome 2>/dev/null | head -1",
      { encoding: "utf8" },
    ).trim();
    if (found && existsSync(found)) return found;
  } catch {}
  try {
    const found = execSync(
      "command -v chromium || command -v chromium-browser || command -v google-chrome",
      { encoding: "utf8" },
    ).trim();
    if (found && existsSync(found)) return found;
  } catch {}
  return undefined;
}

const CHROMIUM_PATH = resolveChromium();
if (CHROMIUM_PATH) {
  // The renderer reads this env var when launching Playwright.
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = CHROMIUM_PATH;
}

interface DocBehavior {
  /** Either a fixture PDF buffer to rasterize, or `oversized` for the 413 path. */
  mode: "render" | "oversized";
  fixture?: Buffer;
}

const docBehaviors = new Map<string, DocBehavior>();

let app: Express;
let server: Server;

interface Tenant {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
}
let tenant: Tenant;

let docOk: { id: string; expectedPages: number } = { id: "", expectedPages: 0 };
let docTooBig: { id: string } = { id: "" };

async function makeFixturePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([400, 200]);
    page.drawText(`FIXTURE-PAGE-${i}`, { x: 40, y: 100, size: 20 });
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD Export ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PD",
    lastName: label,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const token = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: `Export Proj ${label}`,
    clientName: `Export Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  return {
    orgId: org.id,
    userId: admin.id,
    token,
    projectId: project.id,
  };
}

async function createDoc(label: string): Promise<string> {
  const [doc] = await db.insert(planDocuments).values({
    projectId: tenant.projectId,
    organizationId: tenant.orgId,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `doc-${label}.pdf`,
    fileUrl: `https://example.com/doc-${label}.pdf`,
    uploadedById: tenant.userId,
  }).returning();
  return doc.id;
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgs as { rows: Array<{ id: string }> }).rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_pins WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

function buildTestPrintPageHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>test print</title><style>
  body { margin: 0; background: #fff; font-family: system-ui, sans-serif; }
  .page { display: block; break-after: page; page-break-after: always; padding: 16px; }
  .page canvas { display: block; max-width: 100%; }
  .page .label { font-weight: bold; margin-top: 8px; }
</style></head><body>
<div id="root"></div>
<script type="module">
  import * as pdfjsLib from "/__test_pdfjs/pdf.mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/__test_pdfjs/pdf.worker.mjs";

  const url = new URL(window.location.href);
  const id = decodeURIComponent(url.pathname.split("/").pop() || "");
  const maxPages = parseInt(url.searchParams.get("maxPages") || "0", 10) || Infinity;

  (async () => {
    try {
      const behaviorRes = await fetch("/__test_doc_behavior/" + encodeURIComponent(id));
      if (!behaviorRes.ok) throw new Error("behavior lookup failed: " + behaviorRes.status);
      const behavior = await behaviorRes.json();

      if (behavior.mode === "oversized") {
        // Mirror the real print page's early-bail contract: report the
        // page count above MAX_PAGES and signal ready WITHOUT rendering.
        window.__PLAN_PDF_PAGE_COUNT = behavior.pageCount;
        window.__PLAN_PDF_READY = true;
        return;
      }

      const fileRes = await fetch("/__test_doc_fixture/" + encodeURIComponent(id));
      if (!fileRes.ok) throw new Error("fixture fetch failed: " + fileRes.status);
      const buf = await fileRes.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      window.__PLAN_PDF_PAGE_COUNT = pdf.numPages;
      if (pdf.numPages > maxPages) {
        window.__PLAN_PDF_ERROR = "Plan document has " + pdf.numPages + " pages; export is capped at " + maxPages;
        window.__PLAN_PDF_READY = true;
        return;
      }

      const root = document.getElementById("root");
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const wrap = document.createElement("div");
        wrap.className = "page";
        const label = document.createElement("div");
        label.className = "label";
        label.textContent = "PRINTED-FIXTURE-PAGE-" + i;
        wrap.appendChild(canvas);
        wrap.appendChild(label);
        root.appendChild(wrap);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__PLAN_PDF_READY = true;
      }));
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      window.__PLAN_PDF_ERROR = msg;
      window.__PLAN_PDF_READY = true;
    }
  })();
</script></body></html>`;
}

function mountTestPrintPage(target: Express): void {
  // Replace the production print page (served by Vite in dev / static
  // in prod) with a self-contained test harness. The harness mirrors
  // the print contract the renderer relies on so we can drive a real
  // Chromium render without spinning up the full client app.
  const html = buildTestPrintPageHtml();

  target.get("/print/plan-documents/:id", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  target.get("/__test_doc_behavior/:id", (req: Request, res: Response) => {
    const behavior = docBehaviors.get(req.params.id);
    if (!behavior) {
      res.status(404).json({ error: "no behavior" });
      return;
    }
    if (behavior.mode === "oversized") {
      res.json({ mode: "oversized", pageCount: 501 });
      return;
    }
    res.json({ mode: "render" });
  });

  target.get("/__test_doc_fixture/:id", (req: Request, res: Response) => {
    const behavior = docBehaviors.get(req.params.id);
    if (!behavior || !behavior.fixture) {
      res.status(404).json({ error: "no fixture" });
      return;
    }
    res.setHeader("Content-Type", "application/pdf");
    res.send(behavior.fixture);
  });

  // pdfjs ESM entry + worker, served straight from node_modules.
  const pdfjsRoot = path.resolve(process.cwd(), "node_modules/pdfjs-dist/build");
  const sendPdfjs = (relPath: string) => (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.sendFile(path.join(pdfjsRoot, relPath));
  };
  target.get("/__test_pdfjs/pdf.mjs", sendPdfjs("pdf.mjs"));
  target.get("/__test_pdfjs/pdf.worker.mjs", sendPdfjs("pdf.worker.mjs"));
}

beforeAll(async () => {
  if (!CHROMIUM_PATH) return;

  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  // Mount the test print page BEFORE registerRoutes so we shadow any
  // catch-all the production routes might attach. (registerRoutes only
  // wires API/WebSocket handlers; in dev the print page is served by
  // Vite separately.)
  mountTestPrintPage(app);
  server = await registerRoutes(app);

  tenant = await setupTenant("a");

  const fixture = await makeFixturePdf(2);
  docOk.id = await createDoc("ok");
  docOk.expectedPages = 2;
  docBehaviors.set(docOk.id, { mode: "render", fixture });

  docTooBig.id = await createDoc("toobig");
  docBehaviors.set(docTooBig.id, { mode: "oversized" });
}, 120_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

const itIfChromium = CHROMIUM_PATH ? it : it.skip;

describe("Task #1612 — /api/plan-documents/:id/export.pdf end-to-end (real Chromium)", () => {
  itIfChromium("renders a valid PDF byte stream from a fixture and emits ok metrics", async () => {
    const okBefore = getJobMetrics("plan_document_pdf_export").totals.ok ?? 0;
    const errBefore = getJobMetrics("plan_document_pdf_export").totals.error ?? 0;

    const res = await request(app)
      .get(`/api/plan-documents/${docOk.id}/export.pdf`)
      .set("Cookie", `auth_token=${tenant.token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
        response.on("error", (err) => callback(err, Buffer.alloc(0)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.headers["content-disposition"]).toContain("with-markups.pdf");

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(200);
    expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    // Real PDF — parse it and verify the renderer produced one printed
    // page per fixture page. Chromium prints what's visible, so the
    // page count of the *output* matches the fixture's page count.
    const parsed = await PDFDocument.load(body);
    expect(parsed.getPageCount()).toBe(docOk.expectedPages);

    const metrics = getJobMetrics("plan_document_pdf_export");
    expect(metrics.totals.ok ?? 0).toBe(okBefore + 1);
    expect(metrics.totals.error ?? 0).toBe(errBefore);
    expect(metrics.latest?.counters.ok).toBe(1);
    expect(metrics.latest?.counters.bytes).toBe(body.length);
    expect(typeof metrics.latest?.counters.ms).toBe("number");
  }, 120_000);

  itIfChromium("returns 413 when the print page reports a page count above MAX_PAGES, and emits an error metric", async () => {
    const okBefore = getJobMetrics("plan_document_pdf_export").totals.ok ?? 0;
    const errBefore = getJobMetrics("plan_document_pdf_export").totals.error ?? 0;

    const res = await request(app)
      .get(`/api/plan-documents/${docTooBig.id}/export.pdf`)
      .set("Cookie", `auth_token=${tenant.token}`);

    expect(res.status).toBe(413);
    expect(res.body?.error).toMatch(/501 pages/);
    expect(res.body?.error).toMatch(/capped at 500/);

    const metrics = getJobMetrics("plan_document_pdf_export");
    expect(metrics.totals.error ?? 0).toBe(errBefore + 1);
    expect(metrics.totals.ok ?? 0).toBe(okBefore);
    expect(metrics.latest?.counters.error).toBe(1);
  }, 120_000);
});

if (!CHROMIUM_PATH) {
  describe.skip("Task #1612 — /api/plan-documents/:id/export.pdf end-to-end (real Chromium)", () => {
    it("skipped: no Chromium executable found", () => {
      // Surface the skip reason in the test output.
    });
  });
}
