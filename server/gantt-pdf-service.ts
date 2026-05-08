import type { Browser } from "playwright";
import { lt, sql } from "drizzle-orm";
import { logError, logInfo } from "./utils/logger";
import { db } from "./db";
import { ganttPdfRenderSamples } from "@shared/schema";

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

type QueueFullListener = () => void;
type BrowserDisconnectListener = (disconnectedAt: number) => void;
const queueFullListeners: QueueFullListener[] = [];
const browserDisconnectListeners: BrowserDisconnectListener[] = [];

export function onGanttPdfQueueFull(listener: QueueFullListener): () => void {
  queueFullListeners.push(listener);
  return () => {
    const idx = queueFullListeners.indexOf(listener);
    if (idx !== -1) queueFullListeners.splice(idx, 1);
  };
}

export function onGanttPdfBrowserDisconnected(
  listener: BrowserDisconnectListener,
): () => void {
  browserDisconnectListeners.push(listener);
  return () => {
    const idx = browserDisconnectListeners.indexOf(listener);
    if (idx !== -1) browserDisconnectListeners.splice(idx, 1);
  };
}

function emitQueueFull(): void {
  for (const fn of queueFullListeners.slice()) {
    try {
      fn();
    } catch (err) {
      logError("Gantt PDF queue-full listener threw", {}, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

function emitBrowserDisconnected(at: number): void {
  for (const fn of browserDisconnectListeners.slice()) {
    try {
      fn(at);
    } catch (err) {
      logError("Gantt PDF browser-disconnect listener threw", {}, err instanceof Error ? err : new Error(String(err)));
    }
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
    __GANTT_ERROR?: string;
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
    logError("Failed to close retired Gantt browser", {}, err instanceof Error ? err : new Error(String(err)));
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
    emitBrowserDisconnected(Date.now());
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
    emitQueueFull();
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
const DB_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const renderHistory: RenderSample[] = [];

// Persistence is opt-in: server/index.ts enables it via initializeGanttPdfHistory().
// Tests that import the service without explicit init exercise pure in-memory behavior.
let persistenceEnabled = false;
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let dbPruneTimer: NodeJS.Timeout | null = null;

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

async function persistSample(sample: RenderSample): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    await db.insert(ganttPdfRenderSamples).values({
      startedAt: new Date(sample.startedAt),
      durationMs: sample.durationMs,
      success: sample.success,
    });
  } catch (err) {
    logError("Failed to persist Gantt PDF render sample", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

async function pruneDbHistory(): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    await db.delete(ganttPdfRenderSamples).where(lt(ganttPdfRenderSamples.startedAt, cutoff));
  } catch (err) {
    logError("Failed to prune Gantt PDF render history", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

async function hydrateFromDb(): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    const rows = await db
      .select({
        startedAt: ganttPdfRenderSamples.startedAt,
        durationMs: ganttPdfRenderSamples.durationMs,
        success: ganttPdfRenderSamples.success,
      })
      .from(ganttPdfRenderSamples)
      .where(sql`${ganttPdfRenderSamples.startedAt} >= ${cutoff}`)
      .orderBy(ganttPdfRenderSamples.startedAt);
    // Replace any in-memory samples that were recorded before hydration ran.
    // We dedupe by (startedAt, durationMs, success) so a sample recorded after
    // boot but before hydration completes isn't double-counted.
    const seen = new Set(
      renderHistory.map((s) => `${s.startedAt}:${s.durationMs}:${s.success ? 1 : 0}`),
    );
    for (const row of rows) {
      const startedAtMs = row.startedAt instanceof Date ? row.startedAt.getTime() : Number(row.startedAt);
      const key = `${startedAtMs}:${row.durationMs}:${row.success ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      renderHistory.push({
        startedAt: startedAtMs,
        durationMs: row.durationMs,
        success: row.success,
      });
    }
    renderHistory.sort((a, b) => a.startedAt - b.startedAt);
    pruneHistory(Date.now());
  } catch (err) {
    logError("Failed to hydrate Gantt PDF render history", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

export async function initializeGanttPdfHistory(): Promise<void> {
  if (hydrated) return;
  persistenceEnabled = true;
  if (!hydrationPromise) {
    hydrationPromise = hydrateFromDb().then(() => {
      hydrated = true;
    });
  }
  await hydrationPromise;
  if (!dbPruneTimer) {
    dbPruneTimer = setInterval(() => {
      void pruneDbHistory();
    }, DB_PRUNE_INTERVAL_MS);
    if (typeof dbPruneTimer.unref === "function") dbPruneTimer.unref();
  }
}

function recordRenderSample(sample: RenderSample): void {
  renderHistory.push(sample);
  const now = Date.now();
  pruneHistory(now);
  void persistSample(sample);
  try {
    evaluateGanttPdfAlerts(now);
  } catch (err) {
    logError("Gantt PDF alert evaluation failed", {}, err instanceof Error ? err : new Error(String(err)));
  }
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
  alertState.lastEvaluatedAt = null;
  alertState.lastTriggeredAt = null;
  alertState.lastBreaches = [];
  alertState.recentAlerts = [];
  persistenceEnabled = false;
  hydrated = false;
  hydrationPromise = null;
  if (dbPruneTimer) {
    clearInterval(dbPruneTimer);
    dbPruneTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

export type GanttPdfAlertReason =
  | "FAILURE_RATE"
  | "AVG_DURATION"
  | "MAX_DURATION";

export interface GanttPdfAlertConfig {
  enabled: boolean;
  evaluationWindowMs: number;
  minSamples: number;
  failureRatePct: number; // 0-100
  avgDurationMs: number;
  maxDurationMs: number;
  cooldownMs: number;
}

export interface GanttPdfAlertWindowSnapshot {
  rangeMs: number;
  total: number;
  failures: number;
  failureRatePct: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface GanttPdfAlertBreach {
  reason: GanttPdfAlertReason;
  threshold: number;
  observed: number;
  message: string;
}

export interface GanttPdfAlertEvent {
  triggeredAt: number;
  breaches: GanttPdfAlertBreach[];
  window: GanttPdfAlertWindowSnapshot;
  config: GanttPdfAlertConfig;
}

export interface GanttPdfAlertState {
  lastEvaluatedAt: number | null;
  lastTriggeredAt: number | null;
  lastBreaches: GanttPdfAlertBreach[];
  recentAlerts: GanttPdfAlertEvent[];
}

const ALERT_HISTORY_LIMIT = 20;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

const alertConfig: GanttPdfAlertConfig = {
  enabled: envBool("GANTT_PDF_ALERT_ENABLED", true),
  evaluationWindowMs: envNumber("GANTT_PDF_ALERT_WINDOW_MS", 15 * 60 * 1000),
  minSamples: Math.max(1, Math.round(envNumber("GANTT_PDF_ALERT_MIN_SAMPLES", 5))),
  failureRatePct: Math.min(100, Math.max(0, envNumber("GANTT_PDF_ALERT_FAILURE_RATE_PCT", 25))),
  avgDurationMs: envNumber("GANTT_PDF_ALERT_AVG_MS", 30_000),
  maxDurationMs: envNumber("GANTT_PDF_ALERT_MAX_MS", 60_000),
  cooldownMs: envNumber("GANTT_PDF_ALERT_COOLDOWN_MS", 30 * 60 * 1000),
};

const alertState: GanttPdfAlertState = {
  lastEvaluatedAt: null,
  lastTriggeredAt: null,
  lastBreaches: [],
  recentAlerts: [],
};

export type GanttPdfAlertDispatcher = (event: GanttPdfAlertEvent) => Promise<void> | void;
let alertDispatcher: GanttPdfAlertDispatcher | null = null;

export function setGanttPdfAlertDispatcher(dispatcher: GanttPdfAlertDispatcher | null): void {
  alertDispatcher = dispatcher;
}

export function getGanttPdfAlertConfig(): GanttPdfAlertConfig {
  return { ...alertConfig };
}

export function getGanttPdfAlertState(): GanttPdfAlertState {
  return {
    lastEvaluatedAt: alertState.lastEvaluatedAt,
    lastTriggeredAt: alertState.lastTriggeredAt,
    lastBreaches: alertState.lastBreaches.map((b) => ({ ...b })),
    recentAlerts: alertState.recentAlerts.map((a) => ({
      ...a,
      breaches: a.breaches.map((b) => ({ ...b })),
      window: { ...a.window },
      config: { ...a.config },
    })),
  };
}

export function updateGanttPdfAlertConfig(
  patch: Partial<GanttPdfAlertConfig>,
): GanttPdfAlertConfig {
  if (typeof patch.enabled === "boolean") alertConfig.enabled = patch.enabled;
  if (typeof patch.evaluationWindowMs === "number" && Number.isFinite(patch.evaluationWindowMs) && patch.evaluationWindowMs > 0) {
    alertConfig.evaluationWindowMs = Math.min(HISTORY_RETENTION_MS, Math.max(60_000, Math.round(patch.evaluationWindowMs)));
  }
  if (typeof patch.minSamples === "number" && Number.isFinite(patch.minSamples) && patch.minSamples >= 1) {
    alertConfig.minSamples = Math.max(1, Math.round(patch.minSamples));
  }
  if (typeof patch.failureRatePct === "number" && Number.isFinite(patch.failureRatePct)) {
    alertConfig.failureRatePct = Math.min(100, Math.max(0, patch.failureRatePct));
  }
  if (typeof patch.avgDurationMs === "number" && Number.isFinite(patch.avgDurationMs) && patch.avgDurationMs >= 0) {
    alertConfig.avgDurationMs = Math.round(patch.avgDurationMs);
  }
  if (typeof patch.maxDurationMs === "number" && Number.isFinite(patch.maxDurationMs) && patch.maxDurationMs >= 0) {
    alertConfig.maxDurationMs = Math.round(patch.maxDurationMs);
  }
  if (typeof patch.cooldownMs === "number" && Number.isFinite(patch.cooldownMs) && patch.cooldownMs >= 0) {
    alertConfig.cooldownMs = Math.round(patch.cooldownMs);
  }
  return getGanttPdfAlertConfig();
}

function summarizeWindowForAlerts(now: number, rangeMs: number): GanttPdfAlertWindowSnapshot {
  const start = now - rangeMs;
  let total = 0;
  let failures = 0;
  let sum = 0;
  let max = 0;
  for (const s of renderHistory) {
    if (s.startedAt < start) continue;
    total++;
    sum += s.durationMs;
    if (s.durationMs > max) max = s.durationMs;
    if (!s.success) failures++;
  }
  return {
    rangeMs,
    total,
    failures,
    failureRatePct: total > 0 ? Math.round((failures / total) * 1000) / 10 : 0,
    avgDurationMs: total > 0 ? Math.round(sum / total) : null,
    maxDurationMs: total > 0 ? max : null,
  };
}

function computeBreaches(
  snapshot: GanttPdfAlertWindowSnapshot,
  config: GanttPdfAlertConfig,
): GanttPdfAlertBreach[] {
  const breaches: GanttPdfAlertBreach[] = [];
  if (snapshot.total < config.minSamples) return breaches;
  if (snapshot.failureRatePct >= config.failureRatePct && config.failureRatePct > 0) {
    breaches.push({
      reason: "FAILURE_RATE",
      threshold: config.failureRatePct,
      observed: snapshot.failureRatePct,
      message: `Failure rate ${snapshot.failureRatePct}% (${snapshot.failures}/${snapshot.total}) is at or above threshold ${config.failureRatePct}%`,
    });
  }
  if (snapshot.avgDurationMs !== null && config.avgDurationMs > 0 && snapshot.avgDurationMs >= config.avgDurationMs) {
    breaches.push({
      reason: "AVG_DURATION",
      threshold: config.avgDurationMs,
      observed: snapshot.avgDurationMs,
      message: `Average render duration ${snapshot.avgDurationMs}ms is at or above threshold ${config.avgDurationMs}ms`,
    });
  }
  if (snapshot.maxDurationMs !== null && config.maxDurationMs > 0 && snapshot.maxDurationMs >= config.maxDurationMs) {
    breaches.push({
      reason: "MAX_DURATION",
      threshold: config.maxDurationMs,
      observed: snapshot.maxDurationMs,
      message: `Max render duration ${snapshot.maxDurationMs}ms is at or above threshold ${config.maxDurationMs}ms`,
    });
  }
  return breaches;
}

export function evaluateGanttPdfAlerts(now: number = Date.now()): GanttPdfAlertEvent | null {
  alertState.lastEvaluatedAt = now;
  if (!alertConfig.enabled) {
    alertState.lastBreaches = [];
    return null;
  }
  const snapshot = summarizeWindowForAlerts(now, alertConfig.evaluationWindowMs);
  const breaches = computeBreaches(snapshot, alertConfig);
  alertState.lastBreaches = breaches;
  if (breaches.length === 0) return null;
  if (alertState.lastTriggeredAt !== null && now - alertState.lastTriggeredAt < alertConfig.cooldownMs) {
    return null;
  }
  const event: GanttPdfAlertEvent = {
    triggeredAt: now,
    breaches,
    window: snapshot,
    config: { ...alertConfig },
  };
  alertState.lastTriggeredAt = now;
  alertState.recentAlerts.unshift(event);
  if (alertState.recentAlerts.length > ALERT_HISTORY_LIMIT) {
    alertState.recentAlerts.length = ALERT_HISTORY_LIMIT;
  }
  if (alertDispatcher) {
    try {
      const result = alertDispatcher(event);
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).catch((err) => {
          logError("Gantt PDF alert dispatcher failed", {}, err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      logError("Gantt PDF alert dispatcher threw", {}, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return event;
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
    logError("Failed to close gantt browser", {}, err instanceof Error ? err : new Error(String(err)));
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
