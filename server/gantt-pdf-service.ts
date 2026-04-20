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

interface RenderSample {
  startedAt: number;
  durationMs: number;
  success: boolean;
}

const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 2000;
const renderHistory: RenderSample[] = [];

function pruneHistory(now: number): void {
  const cutoff = now - HISTORY_RETENTION_MS;
  // Filter by timestamp — concurrent renders can insert out-of-order
  // startedAt values (samples are appended on completion, not start),
  // so a simple front-trim isn't sufficient.
  for (let i = renderHistory.length - 1; i >= 0; i--) {
    if (renderHistory[i].startedAt < cutoff) {
      renderHistory.splice(i, 1);
    }
  }
  if (renderHistory.length > MAX_HISTORY_SAMPLES) {
    renderHistory.splice(0, renderHistory.length - MAX_HISTORY_SAMPLES);
  }
}

function recordRenderSample(sample: RenderSample): void {
  renderHistory.push(sample);
  pruneHistory(Date.now());
}

export interface GanttPdfHistoryBucket {
  bucketStart: number;
  bucketEnd: number;
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface GanttPdfHistoryWindow {
  rangeMs: number;
  bucketMs: number;
  buckets: GanttPdfHistoryBucket[];
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface GanttPdfHistory {
  generatedAt: number;
  retentionMs: number;
  retainedSamples: number;
  lastHour: GanttPdfHistoryWindow;
  lastDay: GanttPdfHistoryWindow;
}

function summarize(samples: RenderSample[]): { total: number; failures: number; avg: number | null; max: number | null } {
  if (samples.length === 0) return { total: 0, failures: 0, avg: null, max: null };
  let sum = 0;
  let max = 0;
  let failures = 0;
  for (const s of samples) {
    sum += s.durationMs;
    if (s.durationMs > max) max = s.durationMs;
    if (!s.success) failures++;
  }
  return { total: samples.length, failures, avg: Math.round(sum / samples.length), max };
}

function buildWindow(now: number, rangeMs: number, bucketMs: number): GanttPdfHistoryWindow {
  const start = now - rangeMs;
  const firstBucketStart = Math.floor(start / bucketMs) * bucketMs;
  // +1 ensures a bucket exists for samples timestamped at or after `now`
  // when `start` does not align to `bucketMs`.
  const bucketCount = Math.ceil(rangeMs / bucketMs) + 1;
  const buckets: GanttPdfHistoryBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const bs = firstBucketStart + i * bucketMs;
    buckets.push({
      bucketStart: bs,
      bucketEnd: bs + bucketMs,
      total: 0,
      failures: 0,
      avgDurationMs: null,
      maxDurationMs: null,
    });
  }
  const accum = buckets.map(() => ({ sum: 0, max: 0 }));
  const inWindow: RenderSample[] = [];
  for (const s of renderHistory) {
    if (s.startedAt < start) continue;
    inWindow.push(s);
    const idx = Math.floor((s.startedAt - firstBucketStart) / bucketMs);
    if (idx < 0 || idx >= buckets.length) continue;
    const b = buckets[idx];
    b.total++;
    if (!s.success) b.failures++;
    accum[idx].sum += s.durationMs;
    if (s.durationMs > accum[idx].max) accum[idx].max = s.durationMs;
  }
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].total > 0) {
      buckets[i].avgDurationMs = Math.round(accum[i].sum / buckets[i].total);
      buckets[i].maxDurationMs = accum[i].max;
    }
  }
  const summary = summarize(inWindow);
  return {
    rangeMs,
    bucketMs,
    buckets,
    total: summary.total,
    failures: summary.failures,
    avgDurationMs: summary.avg,
    maxDurationMs: summary.max,
  };
}

export function getGanttPdfHistory(): GanttPdfHistory {
  const now = Date.now();
  pruneHistory(now);
  return {
    generatedAt: now,
    retentionMs: HISTORY_RETENTION_MS,
    retainedSamples: renderHistory.length,
    lastHour: buildWindow(now, 60 * 60 * 1000, 5 * 60 * 1000),
    lastDay: buildWindow(now, 24 * 60 * 60 * 1000, 60 * 60 * 1000),
  };
}

export function __resetGanttPdfHistoryForTests(): void {
  renderHistory.length = 0;
}

export async function renderGanttPdf(opts: GanttPdfOptions): Promise<Buffer> {
  const { projectCode, theme = "light", showBaseline = true, authCookie, origin } = opts;

  const startedAt = Date.now();
  await acquireSlot();
  let cached: CachedBrowser | null = null;
  let success = false;
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

      success = true;
      return pdfBuffer;
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    if (cached) releaseBrowser(cached);
    releaseSlot();
    recordRenderSample({
      startedAt,
      durationMs: Date.now() - startedAt,
      success,
    });
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
