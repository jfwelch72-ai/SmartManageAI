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
  planMarkupLayers,
  planDocumentMarkups,
} from "@shared/schema";
import { generateToken } from "../auth";
import { getJobMetrics } from "../utils/jobMetrics";

// Task #1704 — extract text from a printed PDF so we can assert on the
// HTML legend strip + the per-page test manifest of included markups
// that the layered test print page surfaces. Mirrors the helper used
// by `wh347-recent-rate-change.test.ts` (pdfjs legacy build, system
// fonts off, standard fonts pulled from the bundled directory).
async function extractPdfText(buf: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const nodePath = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const standardFontDataUrl =
    nodePath.resolve(here, "../../node_modules/pdfjs-dist/standard_fonts/") + "/";
  const data = new Uint8Array(buf);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
  }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items as Array<{ str?: string }>) {
      if (typeof item.str === "string") parts.push(item.str);
    }
  }
  await doc.destroy();
  return parts.join("\n");
}

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
  /**
   * Either a fixture PDF buffer to rasterize ("render"), the 413 path
   * ("oversized"), or the layered-export path ("layered" — Task #1704)
   * which fetches markups + layers from the real APIs and renders an
   * HTML legend strip + per-markup manifest so a route-level export can
   * be asserted via pdf.js text extraction.
   */
  mode: "render" | "oversized" | "layered";
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

// Task #1704 — fixture for the layered-export coverage. Two named layers
// (one included, one excluded by ?layerIds=…) and one TEXT markup on
// each so we can assert the legend lists the included layer + the
// per-page manifest only mentions the included markup.
interface LayeredFixture {
  docId: string;
  includedLayer: { id: string; name: string; color: string };
  excludedLayer: { id: string; name: string; color: string };
  includedMarkupText: string;
  excludedMarkupText: string;
}
let docLayered: LayeredFixture | null = null;

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
    // Task #1704 — explicit visibility + layer cleanup so a partial
    // failure doesn't leave dangling FK rows pointing at the doc.
    await db.execute(
      sql`DELETE FROM plan_markup_layer_visibility WHERE layer_id IN (SELECT id FROM plan_markup_layers WHERE plan_document_id IN ${docSub})`,
    ).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layers WHERE plan_document_id IN ${docSub}`).catch(() => {});
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
  /* Task #1704 — keep the layered footers visually compact so they
     fit on the same printed page as the rasterised canvas above. */
  .plan-pdf-legend {
    font-size: 9px; padding: 6px 12px;
    border-top: 1px solid #cbd5e1; background: #f8fafc;
    color: #0f172a;
  }
  .plan-pdf-legend .label { font-weight: 600; margin-right: 6px; }
  .plan-pdf-legend .chip { margin-right: 10px; }
  .plan-pdf-markup-manifest { font-size: 10px; padding: 4px 12px; color: #0f172a; }
  .plan-pdf-markup-manifest .row { white-space: nowrap; }
</style></head><body>
<div id="root"></div>
<script type="module">
  import * as pdfjsLib from "/__test_pdfjs/pdf.mjs";
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/__test_pdfjs/pdf.worker.mjs";

  const url = new URL(window.location.href);
  const id = decodeURIComponent(url.pathname.split("/").pop() || "");
  const maxPages = parseInt(url.searchParams.get("maxPages") || "0", 10) || Infinity;
  // Task #1704 — mirror the layerIds parsing in PlanDocumentPrintPage.tsx
  // so the test print page applies the same effective-set logic the real
  // print page does. Comma-separated ids; empty/missing means "all".
  const layerIdFilterRaw = url.searchParams.get("layerIds") || "";
  const layerIdFilter = layerIdFilterRaw
    ? new Set(layerIdFilterRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : null;

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

      // Task #1704 — for "layered" mode, fetch markups + layers from the
      // real APIs (auth flows in via the cookie the export route forwards
      // to the headless browser) and resolve the inclusion set the same
      // way PlanDocumentPrintPage.tsx does. We then surface (a) an HTML
      // "Layers included:" footer for the legend assertion and (b) a
      // per-page manifest of included markups so a regression that
      // accidentally drops the layer filter or mis-resolves layer color
      // is detectable via pdf.js text extraction.
      let markups = [];
      let layers = [];
      if (behavior.mode === "layered") {
        const [mRes, lRes] = await Promise.all([
          fetch("/api/plan-documents/" + encodeURIComponent(id) + "/markups", { credentials: "include" }),
          fetch("/api/plan-documents/" + encodeURIComponent(id) + "/markup-layers", { credentials: "include" }),
        ]);
        if (!mRes.ok) throw new Error("markups fetch failed: " + mRes.status);
        if (!lRes.ok) throw new Error("layers fetch failed: " + lRes.status);
        markups = await mRes.json();
        layers = await lRes.json();
      }

      const layersById = new Map();
      for (const l of layers) layersById.set(l.id, l);
      const defaultLayer = layers.find((l) => l.isDefault) || null;
      let effectiveIncluded;
      if (layerIdFilter) {
        effectiveIncluded = new Set();
        for (const lid of layerIdFilter) {
          if (lid === "__default__") {
            if (defaultLayer) effectiveIncluded.add(defaultLayer.id);
          } else {
            effectiveIncluded.add(lid);
          }
        }
      } else {
        effectiveIncluded = new Set(
          layers.filter((l) => l.isVisible !== false).map((l) => l.id),
        );
      }
      const includedLayers = layers
        .filter((l) => effectiveIncluded.has(l.id))
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
      function isLayerIncluded(layerId) {
        const resolved = layerId == null ? (defaultLayer ? defaultLayer.id : null) : layerId;
        if (!resolved) return !layerIdFilter;
        return effectiveIncluded.has(resolved);
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

        if (behavior.mode === "layered") {
          // Per-page manifest of markups that survived the layer filter.
          // Each row carries the markup text + its resolved layer name +
          // color so a regression mis-resolving either is caught by a
          // single text snapshot.
          const pageMarkups = markups.filter(
            (m) => m.pageNumber === i && isLayerIncluded(m.layerId),
          );
          const manifest = document.createElement("div");
          manifest.className = "plan-pdf-markup-manifest";
          manifest.setAttribute("data-testid", "plan-pdf-markup-manifest");
          for (const m of pageMarkups) {
            const row = document.createElement("div");
            row.className = "row";
            const layer = m.layerId
              ? layersById.get(m.layerId) || defaultLayer
              : defaultLayer;
            const layerName = layer ? layer.name : "(unlayered)";
            const layerColor = layer ? layer.color || "" : "";
            row.textContent = "MARKUP:" + (m.text || m.id) +
              " | LAYER:" + layerName +
              " | COLOR:" + layerColor;
            manifest.appendChild(row);
          }
          wrap.appendChild(manifest);

          // Legend strip — mirrors PlanDocumentPrintPage.tsx's
          // renderLegendFooter contract: a "Layers included:" label
          // followed by one chip per included layer carrying the layer
          // name. The chip color is recorded in the manifest above.
          const legend = document.createElement("div");
          legend.className = "plan-pdf-legend";
          legend.setAttribute("data-testid", "plan-pdf-legend");
          const lbl = document.createElement("span");
          lbl.className = "label";
          lbl.textContent = "Layers included:";
          legend.appendChild(lbl);
          if (includedLayers.length === 0) {
            const none = document.createElement("span");
            none.className = "chip";
            none.textContent = "(none)";
            legend.appendChild(none);
          } else {
            for (const layer of includedLayers) {
              const chip = document.createElement("span");
              chip.className = "chip";
              chip.textContent = layer.name;
              legend.appendChild(chip);
            }
          }
          wrap.appendChild(legend);
        }

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
    if (behavior.mode === "layered") {
      res.json({ mode: "layered" });
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

  // Task #1704 — seed a plan document with two named layers and one
  // markup on each so the layered export test can verify the legend
  // strip lists the included layer and that markups from the excluded
  // layer are filtered out of the printed PDF.
  const layeredDocId = await createDoc("layered");
  const [includedLayerRow] = await db
    .insert(planMarkupLayers)
    .values({
      organizationId: tenant.orgId,
      planDocumentId: layeredDocId,
      name: "QA-REVIEW-LAYER-A",
      color: "#1d4ed8",
      sortOrder: 1,
      isDefault: false,
      createdById: tenant.userId,
    })
    .returning();
  const [excludedLayerRow] = await db
    .insert(planMarkupLayers)
    .values({
      organizationId: tenant.orgId,
      planDocumentId: layeredDocId,
      name: "DESIGN-LAYER-B",
      color: "#b91c1c",
      sortOrder: 2,
      isDefault: false,
      createdById: tenant.userId,
    })
    .returning();

  const includedMarkupText = "INCLUDED-MARKUP-TEXT-A";
  const excludedMarkupText = "EXCLUDED-MARKUP-TEXT-B";
  await db.insert(planDocumentMarkups).values([
    {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      planDocumentId: layeredDocId,
      pageNumber: 1,
      tool: "TEXT",
      points: JSON.stringify([{ x: 0.1, y: 0.1 }]),
      color: "#000000",
      thickness: 2,
      text: includedMarkupText,
      createdBy: tenant.userId,
      layerId: includedLayerRow.id,
    },
    {
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      planDocumentId: layeredDocId,
      pageNumber: 1,
      tool: "TEXT",
      points: JSON.stringify([{ x: 0.5, y: 0.5 }]),
      color: "#000000",
      thickness: 2,
      text: excludedMarkupText,
      createdBy: tenant.userId,
      layerId: excludedLayerRow.id,
    },
  ]);

  // Use a single-page fixture so the layered assertions stay focused
  // on a single legend + manifest block. Reusing the 2-page `fixture`
  // would force us to assert against the markups that only live on
  // page 1, complicating the manifest text expectations.
  const layeredFixturePdf = await makeFixturePdf(1);
  docBehaviors.set(layeredDocId, { mode: "layered", fixture: layeredFixturePdf });

  docLayered = {
    docId: layeredDocId,
    includedLayer: {
      id: includedLayerRow.id,
      name: includedLayerRow.name,
      color: includedLayerRow.color,
    },
    excludedLayer: {
      id: excludedLayerRow.id,
      name: excludedLayerRow.name,
      color: excludedLayerRow.color,
    },
    includedMarkupText,
    excludedMarkupText,
  };
}, 180_000);

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

  // ============================================================================
  // Task #1704 — verify the layered export path: when ?layerIds=<one-layer>
  // is supplied, the printed PDF must
  //   1. carry the legend strip ("Layers included:" + the included layer's
  //      name) and
  //   2. contain only the included layer's markups (i.e. omit the excluded
  //      layer's markups + name from the printed output).
  // The test print page in this file mirrors PlanDocumentPrintPage.tsx's
  // inclusion logic and surfaces the chip color via the per-page manifest
  // so a regression that drops a chip or returns the wrong color is
  // detectable via pdf.js text extraction.
  // ============================================================================
  itIfChromium(
    "scopes the printed PDF to ?layerIds=… — legend lists the included layer and excluded markups disappear",
    async () => {
      if (!docLayered) throw new Error("layered fixture not initialised");
      const fixture = docLayered;

      const res = await request(app)
        .get(
          `/api/plan-documents/${fixture.docId}/export.pdf?layerIds=${encodeURIComponent(fixture.includedLayer.id)}`,
        )
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
      const body = res.body as Buffer;
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      const text = await extractPdfText(body);

      // Legend strip (the "Layers included:" footer in PlanDocumentPrintPage)
      // must be present and must name the included layer.
      expect(text).toContain("Layers included:");
      expect(text).toContain(fixture.includedLayer.name);

      // The excluded layer must NOT appear in the legend (the layer
      // filter dropped it) and the per-page manifest must show only
      // the included markup, proving filter + chip resolution work
      // end-to-end.
      expect(text).not.toContain(fixture.excludedLayer.name);
      expect(text).toContain(`MARKUP:${fixture.includedMarkupText}`);
      expect(text).not.toContain(`MARKUP:${fixture.excludedMarkupText}`);

      // Chip color check — a regression that resolves the wrong layer
      // for the included markup would surface here as the wrong hex
      // string in the manifest row.
      expect(text).toContain(`COLOR:${fixture.includedLayer.color}`);
      expect(text).not.toContain(`COLOR:${fixture.excludedLayer.color}`);
    },
    180_000,
  );
});

if (!CHROMIUM_PATH) {
  describe.skip("Task #1612 — /api/plan-documents/:id/export.pdf end-to-end (real Chromium)", () => {
    it("skipped: no Chromium executable found", () => {
      // Surface the skip reason in the test output.
    });
  });
}
