import type { Browser } from "playwright";
import { logError, logInfo } from "./utils/logger";

const READY_TIMEOUT_MS = 30000;
const NAV_TIMEOUT_MS = 30000;

const MAX_PDFS_PER_BROWSER = 50;
const MAX_BROWSER_AGE_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_RENDERS = 2;
const MAX_QUEUE_LENGTH = 8;
const QUEUE_WAIT_TIMEOUT_MS = 60 * 1000;

export class GanttPdfQueueFullError extends Error {
  constructor() {
    super("Gantt PDF render queue is full, please retry shortly");
    this.name = "GanttPdfQueueFullError";
  }
}

export interface GanttPdfOptions {
  projectCode: string;
  theme?: "light" | "dark";
  showBaseline?: boolean;
  authCookie?: { name: string; value: string };
  origin: string;
}

declare global {
  interface Window {
    __GANTT_READY?: boolean;
    __GANTT_ERROR?: string | null;
  }
}

interface CachedBrowser {
  browser: Browser;
  createdAt: number;
  pdfCount: number;
  inFlight: number;
  recycling: boolean;
}

function maybeCloseRetired(cached: CachedBrowser): void {
  if (!cached.recycling || cached.inFlight > 0) return;
  cached.browser.close().catch((err) => {
    logError("Failed to close retired Gantt browser", err as Error);
  });
}

let cachedBrowserPromise: Promise<CachedBrowser> | null = null;
let cachedBrowserResolved: CachedBrowser | null = null;

async function launchBrowser(): Promise<CachedBrowser> {
  const { chromium } = await import("playwright");
  const executablePath =
    process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    undefined;
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
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
          if (current.browser === browser) {
            cachedBrowserPromise = null;
          }
        })
        .catch(() => {
          cachedBrowserPromise = null;
        });
    }
  });
  return cached;
}

let getBrowserLock: Promise<unknown> | null = null;

async function leaseBrowserInner(): Promise<CachedBrowser> {
  if (cachedBrowserPromise) {
    try {
      const current = await cachedBrowserPromise;
      const tooOld = Date.now() - current.createdAt > MAX_BROWSER_AGE_MS;
      const tooManyPdfs = current.pdfCount >= MAX_PDFS_PER_BROWSER;
      const disconnected = !current.browser.isConnected();
      if (!current.recycling && !tooOld && !tooManyPdfs && !disconnected) {
        current.pdfCount++;
        current.inFlight++;
        return current;
      }
      // Retire the current browser. Don't close it yet — wait for in-flight
      // renders to finish so we never tear down an active context.
      current.recycling = true;
      cachedBrowserPromise = null;
      cachedBrowserResolved = null;
      logInfo("Retiring cached Gantt browser", {
        ageMs: Date.now() - current.createdAt,
        pdfCount: current.pdfCount,
        inFlight: current.inFlight,
        disconnected,
      });
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

async function leaseBrowser(): Promise<CachedBrowser> {
  // Serialize all acquire/recycle/lease decisions so concurrent callers cannot
  // each launch a fresh Chromium (orphan races) or race the recycle thresholds.
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

async function getBrowser(): Promise<CachedBrowser> {
  // Used only for health checks (isGanttRendererAvailable). Doesn't lease.
  while (getBrowserLock) {
    try {
      await getBrowserLock;
    } catch {
      // ignore
    }
  }
  if (cachedBrowserPromise) {
    const current = await cachedBrowserPromise;
    if (current.browser.isConnected() && !current.recycling) {
      return current;
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
  return fresh;
}

let activeRenders = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return;
  }
  if (waiters.length >= MAX_QUEUE_LENGTH) {
    throw new GanttPdfQueueFullError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(onReady);
      if (idx !== -1) waiters.splice(idx, 1);
      reject(new Error("Timed out waiting for Gantt PDF render slot"));
    }, QUEUE_WAIT_TIMEOUT_MS);
    const onReady = () => {
      clearTimeout(timer);
      activeRenders++;
      resolve();
    };
    waiters.push(onReady);
  });
}

function releaseSlot(): void {
  activeRenders--;
  const next = waiters.shift();
  if (next) next();
}

export async function renderGanttPdf(opts: GanttPdfOptions): Promise<Buffer> {
  const { projectCode, theme = "light", showBaseline = true, authCookie, origin } = opts;

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
      if (authCookie) {
        const url = new URL(origin);
        await context.addCookies([
          {
            name: authCookie.name,
            value: authCookie.value,
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

      const url = new URL(`/print/projects/${encodeURIComponent(projectCode)}/schedule`, origin);
      url.searchParams.set("theme", theme);
      url.searchParams.set("baseline", showBaseline ? "1" : "0");

      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

      await page.waitForFunction(
        () => window.__GANTT_READY === true,
        { timeout: READY_TIMEOUT_MS },
      );

      const ganttError = await page.evaluate(() => window.__GANTT_ERROR || null);
      if (ganttError) {
        throw new Error(`Print page reported error: ${ganttError}`);
      }

      const pdfBuffer = await page.pdf({
        format: "A3",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
      });

      return pdfBuffer;
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    if (cached) releaseBrowser(cached);
    releaseSlot();
  }
}

export interface GanttPdfStats {
  cachedBrowser: {
    present: boolean;
    connected: boolean;
    recycling: boolean;
    ageMs: number | null;
    pdfCount: number;
    inFlight: number;
  };
  limits: {
    maxPdfsPerBrowser: number;
    maxBrowserAgeMs: number;
    maxConcurrentRenders: number;
    maxQueueLength: number;
    queueWaitTimeoutMs: number;
  };
  queue: {
    activeRenders: number;
    queuedRenders: number;
  };
}

export function getGanttPdfStats(): GanttPdfStats {
  let cachedSnapshot: GanttPdfStats["cachedBrowser"] = {
    present: false,
    connected: false,
    recycling: false,
    ageMs: null,
    pdfCount: 0,
    inFlight: 0,
  };

  if (cachedBrowserResolved) {
    const current = cachedBrowserResolved;
    cachedSnapshot = {
      present: true,
      connected: current.browser.isConnected(),
      recycling: current.recycling,
      ageMs: Date.now() - current.createdAt,
      pdfCount: current.pdfCount,
      inFlight: current.inFlight,
    };
  } else if (cachedBrowserPromise) {
    cachedSnapshot = { ...cachedSnapshot, present: true };
  }

  return {
    cachedBrowser: cachedSnapshot,
    limits: {
      maxPdfsPerBrowser: MAX_PDFS_PER_BROWSER,
      maxBrowserAgeMs: MAX_BROWSER_AGE_MS,
      maxConcurrentRenders: MAX_CONCURRENT_RENDERS,
      maxQueueLength: MAX_QUEUE_LENGTH,
      queueWaitTimeoutMs: QUEUE_WAIT_TIMEOUT_MS,
    },
    queue: {
      activeRenders,
      queuedRenders: waiters.length,
    },
  };
}

export async function recycleGanttBrowser(): Promise<{ recycled: boolean }> {
  if (!cachedBrowserPromise) return { recycled: false };
  try {
    const current = await cachedBrowserPromise;
    if (current.recycling) return { recycled: false };
    current.recycling = true;
    cachedBrowserPromise = null;
    cachedBrowserResolved = null;
    logInfo("Manually recycling cached Gantt browser", {
      ageMs: Date.now() - current.createdAt,
      pdfCount: current.pdfCount,
      inFlight: current.inFlight,
    });
    maybeCloseRetired(current);
    return { recycled: true };
  } catch {
    cachedBrowserPromise = null;
    cachedBrowserResolved = null;
    return { recycled: false };
  }
}

export async function shutdownGanttBrowser(): Promise<void> {
  if (!cachedBrowserPromise) return;
  const promise = cachedBrowserPromise;
  cachedBrowserPromise = null;
  cachedBrowserResolved = null;
  try {
    const current = await promise;
    await current.browser.close();
  } catch (err) {
    logError("Failed to close gantt browser", err as Error);
  }
}

export async function isGanttRendererAvailable(): Promise<boolean> {
  try {
    await getBrowser();
    return true;
  } catch (err) {
    logInfo("Server-side Gantt renderer unavailable", { error: (err as Error).message });
    return false;
  }
}
