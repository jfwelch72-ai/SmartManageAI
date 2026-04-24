/**
 * Task #1609 — burned-in PDF export for plan documents.
 *
 * Renders a print-only HTML page (`/print/plan-documents/:id`) via headless
 * Chromium and captures the result with `page.pdf()`. The print page itself
 * uses PDF.js to rasterize the source PDF page-by-page and overlays
 * markups + (optionally) pins fetched from the same auth context. Mirrors
 * the architecture used by `server/gantt-pdf-service.ts` but with its own
 * minimal browser cache so a Gantt render and a Plan-PDF render cannot
 * starve each other for the single shared browser.
 *
 * The export is bounded by `MAX_PAGES` so a 5000-page set cannot accidentally
 * pin the renderer; callers above that ceiling get a 413.
 */

import { logError } from "./utils/logger";

interface CachedBrowser {
  browser: any;
  createdAt: number;
  pdfCount: number;
  inFlight: number;
  recycling: boolean;
}

const MAX_PDFS_PER_BROWSER = 100;
const MAX_BROWSER_AGE_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_RENDERS = 2;
const NAV_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 180_000;

export const MAX_PAGES = 500;

export class PlanPdfTooLargeError extends Error {
  constructor(public readonly pageCount: number) {
    super(`Plan document has ${pageCount} pages; export is capped at ${MAX_PAGES}`);
    this.name = "PlanPdfTooLargeError";
  }
}

let cachedBrowserPromise: Promise<CachedBrowser> | null = null;
let activeRenders = 0;

async function launchBrowser(): Promise<CachedBrowser> {
  const { chromium } = await import("playwright");
  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    undefined;
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const cached: CachedBrowser = {
    browser,
    createdAt: Date.now(),
    pdfCount: 0,
    inFlight: 0,
    recycling: false,
  };
  browser.on("disconnected", () => {
    if (cachedBrowserPromise) {
      cachedBrowserPromise.then((c) => {
        if (c.browser === browser) cachedBrowserPromise = null;
      }).catch(() => { cachedBrowserPromise = null; });
    }
  });
  return cached;
}

async function leaseBrowser(): Promise<CachedBrowser> {
  if (cachedBrowserPromise) {
    try {
      const current = await cachedBrowserPromise;
      const stale =
        current.recycling ||
        Date.now() - current.createdAt > MAX_BROWSER_AGE_MS ||
        current.pdfCount >= MAX_PDFS_PER_BROWSER ||
        !current.browser.isConnected();
      if (!stale) {
        current.pdfCount++;
        current.inFlight++;
        return current;
      }
      current.recycling = true;
      cachedBrowserPromise = null;
      // Don't close until in-flight drains.
      if (current.inFlight === 0) current.browser.close().catch(() => undefined);
    } catch {
      cachedBrowserPromise = null;
    }
  }
  cachedBrowserPromise = launchBrowser().catch((err) => {
    cachedBrowserPromise = null;
    throw err;
  });
  const fresh = await cachedBrowserPromise;
  fresh.pdfCount++;
  fresh.inFlight++;
  return fresh;
}

function releaseBrowser(c: CachedBrowser): void {
  c.inFlight = Math.max(0, c.inFlight - 1);
  if (c.recycling && c.inFlight === 0) {
    c.browser.close().catch(() => undefined);
  }
}

async function acquireSlot(): Promise<void> {
  const start = Date.now();
  while (activeRenders >= MAX_CONCURRENT_RENDERS) {
    if (Date.now() - start > 5 * 60_000) {
      throw new Error("Timed out waiting for plan PDF render slot");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  activeRenders++;
}

function releaseSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1);
}

export interface PlanPdfRenderOptions {
  documentId: string;
  /** Origin (e.g. https://app.example.com) — used to resolve the print page URL. */
  origin: string;
  /** Auth cookie copied from the originating request so the print page can fetch protected APIs. */
  authCookie?: { name: string; value: string };
  includeMarkups: boolean;
  includePins: boolean;
}

export async function renderPlanDocumentPdf(opts: PlanPdfRenderOptions): Promise<Buffer> {
  await acquireSlot();
  let cached: CachedBrowser | null = null;
  try {
    cached = await leaseBrowser();
    const context = await cached.browser.newContext({
      viewport: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
      ignoreHTTPSErrors: true,
    });
    try {
      if (opts.authCookie) {
        const url = new URL(opts.origin);
        await context.addCookies([
          {
            name: opts.authCookie.name,
            value: opts.authCookie.value,
            domain: url.hostname,
            path: "/",
            httpOnly: true,
            secure: url.protocol === "https:",
            sameSite: "Lax",
          },
        ]);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);

      const url = new URL(`/print/plan-documents/${encodeURIComponent(opts.documentId)}`, opts.origin);
      url.searchParams.set("markups", opts.includeMarkups ? "1" : "0");
      url.searchParams.set("pins", opts.includePins ? "1" : "0");
      // Forward MAX_PAGES so the print page can fail-fast on large
      // documents (no need to rasterize 5,000 pages just to discover
      // the limit was exceeded — the server still throws below).
      url.searchParams.set("maxPages", String(MAX_PAGES));

      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      // The print page must set `window.__PLAN_PDF_READY = true` once
      // every page has rendered + every overlay finished drawing.
      await page.waitForFunction(
        () =>
          (window as unknown as { __PLAN_PDF_READY?: boolean; __PLAN_PDF_ERROR?: string })
            .__PLAN_PDF_READY === true ||
          !!(window as unknown as { __PLAN_PDF_ERROR?: string }).__PLAN_PDF_ERROR,
        { timeout: READY_TIMEOUT_MS },
      );

      const printError = await page.evaluate(
        () => (window as unknown as { __PLAN_PDF_ERROR?: string }).__PLAN_PDF_ERROR || null,
      );
      if (printError) throw new Error(`Plan PDF print page reported error: ${printError}`);

      const pageCount = await page.evaluate(
        () => (window as unknown as { __PLAN_PDF_PAGE_COUNT?: number }).__PLAN_PDF_PAGE_COUNT || 0,
      );
      if (pageCount > MAX_PAGES) throw new PlanPdfTooLargeError(pageCount);

      const pdfBuffer = await page.pdf({
        format: "Letter",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      });

      return pdfBuffer;
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch (err) {
    logError(
      "[plan-pdf-export] render failed",
      { documentId: opts.documentId },
      err instanceof Error ? err : new Error(String(err)),
    );
    throw err;
  } finally {
    if (cached) releaseBrowser(cached);
    releaseSlot();
  }
}
