import type { Browser } from "playwright";
import { logError, logInfo, logWarn } from "./utils/logger";

const NAV_TIMEOUT_MS = 30_000;
const MAX_PDFS_PER_BROWSER = 50;
const MAX_BROWSER_AGE_MS = 30 * 60 * 1000;

interface CachedBrowser {
  browser: Browser;
  createdAt: number;
  pdfCount: number;
  inFlight: number;
  recycling: boolean;
}

let cachedBrowserPromise: Promise<CachedBrowser> | null = null;
let cachedBrowserResolved: CachedBrowser | null = null;
// We only ever cache a *positive* availability result so a transient launch
// failure (resource pressure, race, brief Playwright glitch) doesn't pin the
// renderer to "unavailable" until the process restarts.
let chromiumAvailable: true | null = null;
let lastAvailabilityError: string | null = null;
let lastAvailabilityCheckedAt: number | null = null;

function chromiumLaunchOptions() {
  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    undefined;
  return {
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  };
}

function maybeCloseRetired(cached: CachedBrowser): void {
  if (!cached.recycling || cached.inFlight > 0) return;
  cached.browser.close().catch((err) => {
    logError("Failed to close retired portfolio browser", {}, err as Error);
  });
}

async function launchBrowser(): Promise<CachedBrowser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch(chromiumLaunchOptions());
  const cached: CachedBrowser = {
    browser,
    createdAt: Date.now(),
    pdfCount: 0,
    inFlight: 0,
    recycling: false,
  };
  browser.on("disconnected", () => {
    if (cachedBrowserResolved && cachedBrowserResolved.browser === browser) {
      cachedBrowserResolved = null;
    }
    if (cachedBrowserPromise) {
      cachedBrowserPromise
        .then((current) => {
          if (current.browser === browser) cachedBrowserPromise = null;
        })
        .catch(() => {
          cachedBrowserPromise = null;
        });
    }
  });
  return cached;
}

async function leaseBrowserInner(): Promise<CachedBrowser> {
  if (cachedBrowserPromise) {
    try {
      const current = await cachedBrowserPromise;
      const tooOld = Date.now() - current.createdAt > MAX_BROWSER_AGE_MS;
      const tooMany = current.pdfCount >= MAX_PDFS_PER_BROWSER;
      const disconnected = !current.browser.isConnected();
      if (!current.recycling && !tooOld && !tooMany && !disconnected) {
        current.pdfCount++;
        current.inFlight++;
        return current;
      }
      // Retire the current browser; wait for in-flight renders to finish
      // before closing.
      current.recycling = true;
      cachedBrowserPromise = null;
      cachedBrowserResolved = null;
      maybeCloseRetired(current);
    } catch {
      cachedBrowserPromise = null;
      cachedBrowserResolved = null;
    }
  }
  const launching = launchBrowser();
  cachedBrowserPromise = launching.catch((err) => {
    cachedBrowserPromise = null;
    cachedBrowserResolved = null;
    throw err;
  });
  const fresh = await launching;
  cachedBrowserResolved = fresh;
  fresh.pdfCount++;
  fresh.inFlight++;
  return fresh;
}

// Serialize all acquire/recycle/lease decisions so concurrent callers cannot
// each launch a fresh Chromium (orphan races) or race the recycle thresholds.
let getBrowserLock: Promise<unknown> | null = null;

async function leaseBrowser(): Promise<CachedBrowser> {
  while (getBrowserLock) {
    try {
      await getBrowserLock;
    } catch {
      // ignore; next iteration will retry
    }
  }
  const work = leaseBrowserInner();
  getBrowserLock = work.catch(() => undefined);
  try {
    return await work;
  } finally {
    getBrowserLock = null;
  }
}

function releaseBrowser(cached: CachedBrowser): void {
  cached.inFlight = Math.max(0, cached.inFlight - 1);
  maybeCloseRetired(cached);
}

export interface PortfolioPdfOptions {
  format?: "Letter" | "A4";
  margin?: { top: string; right: string; bottom: string; left: string };
  /**
   * Origins (scheme + host) the renderer is allowed to fetch from. Anything
   * else — including http://, file://, internal IPs, or attacker-controlled
   * URLs that may have leaked into branding fields — is blocked at the
   * network layer so the headless browser can never act as an SSRF vector.
   * `data:` URIs are always permitted (they don't trigger network I/O).
   */
  allowedOrigins?: string[];
}

export function isAllowedAssetUrl(url: string, allowedOrigins: string[]): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const origin = `${parsed.protocol}//${parsed.host}`;
    return allowedOrigins.some((allowed) => {
      try {
        const a = new URL(allowed);
        return a.protocol === parsed.protocol && a.host === parsed.host;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function defaultAllowedOrigins(): string[] {
  const raw = process.env.PORTFOLIO_PDF_ALLOWED_ORIGINS || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function renderPortfolioSummaryPdf(
  html: string,
  opts: PortfolioPdfOptions = {},
): Promise<Buffer> {
  const allowedOrigins = opts.allowedOrigins ?? defaultAllowedOrigins();
  const cached = await leaseBrowser();
  try {
    const context = await cached.browser.newContext({
      viewport: { width: 1240, height: 1600 },
      deviceScaleFactor: 2,
      // Disable JS — we only render server-built HTML for PDF, no client code
      // should run inside the headless browser.
      javaScriptEnabled: false,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);

      // Block every network request that is not explicitly allowed. This
      // prevents the renderer from being weaponized as an SSRF probe via
      // attacker-controlled <img>/<link> URLs that may slip into branding
      // or other dynamic fields.
      await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith("data:") || reqUrl === "about:blank") {
          return route.continue();
        }
        if (isAllowedAssetUrl(reqUrl, allowedOrigins)) {
          return route.continue();
        }
        return route.abort();
      });

      await page.setContent(html, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      const pdf = await page.pdf({
        format: opts.format || "Letter",
        printBackground: true,
        preferCSSPageSize: true,
        margin: opts.margin || { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
      });
      return pdf;
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    releaseBrowser(cached);
  }
}

export async function isPortfolioRendererAvailable(): Promise<boolean> {
  // If we have a cached, still-connected browser we know Chromium is reachable
  // — no need to launch a throwaway one.
  if (cachedBrowserResolved && cachedBrowserResolved.browser.isConnected()) {
    chromiumAvailable = true;
    lastAvailabilityError = null;
    lastAvailabilityCheckedAt = Date.now();
    return true;
  }
  // Always attempt a real launch so transient failures don't permanently pin
  // the renderer to "unavailable" (mirrors the gantt service's non-sticky
  // availability check).
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch(chromiumLaunchOptions());
    await browser.close();
    chromiumAvailable = true;
    lastAvailabilityError = null;
    lastAvailabilityCheckedAt = Date.now();
    return true;
  } catch (err) {
    // Do NOT cache the negative result — let the next request retry.
    lastAvailabilityError = (err as Error).message;
    lastAvailabilityCheckedAt = Date.now();
    return false;
  }
}

export function getPortfolioRendererStatus(): {
  available: boolean | null;
  error: string | null;
  lastCheckedAt: number | null;
} {
  return {
    available: chromiumAvailable,
    error: lastAvailabilityError,
    lastCheckedAt: lastAvailabilityCheckedAt,
  };
}

export async function checkPortfolioRendererAtStartup(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const ok = await isPortfolioRendererAvailable();
  if (ok) {
    logInfo("Portfolio PDF renderer (Chromium) available");
  } else if (isProduction) {
    logError(
      "Portfolio PDF renderer (Chromium) UNAVAILABLE in production — /api/portfolio/summary-pdf will return 503",
      { error: lastAvailabilityError },
    );
  } else {
    logWarn("Portfolio PDF renderer (Chromium) unavailable — falling back to HTML export in non-production", {
      error: lastAvailabilityError,
    });
  }
}

export async function shutdownPortfolioBrowser(): Promise<void> {
  if (!cachedBrowserPromise) return;
  const promise = cachedBrowserPromise;
  cachedBrowserPromise = null;
  cachedBrowserResolved = null;
  try {
    const current = await promise;
    await current.browser.close();
  } catch (err) {
    logError("Failed to close portfolio browser", {}, err as Error);
  }
}
