import type { Browser } from "playwright";
import { lt, sql } from "drizzle-orm";
import { db } from "./db";
import { portfolioPdfRenderSamples } from "@shared/schema";
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
let chromiumAvailable: boolean | null = null;
let lastAvailabilityError: string | null = null;
let lastAvailabilityCheckedAt: number | null = null;

// ---------------------------------------------------------------------------
// Availability event hooks (consumed by portfolio-pdf-alerts to watch for the
// cached Chromium dropping mid-flight).
// ---------------------------------------------------------------------------
type DisconnectListener = (at: number) => void;
const disconnectListeners = new Set<DisconnectListener>();

export function onPortfolioPdfBrowserDisconnected(fn: DisconnectListener): () => void {
  disconnectListeners.add(fn);
  return () => disconnectListeners.delete(fn);
}

function emitDisconnected(at: number): void {
  for (const fn of disconnectListeners) {
    try {
      fn(at);
    } catch (err) {
      logError("Portfolio PDF disconnect listener threw", {}, err as Error);
    }
  }
}

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
    const wasCached =
      cachedBrowserResolved !== null && cachedBrowserResolved.browser === browser;
    if (wasCached && !cached.recycling) {
      // Surfaced to alert subsystem only when this looks like an unexpected
      // disconnect (not us deliberately recycling the cached browser).
      emitDisconnected(Date.now());
    }
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

let getBrowserLock: Promise<unknown> | null = null;

async function leaseBrowser(): Promise<CachedBrowser> {
  while (getBrowserLock) {
    try {
      await getBrowserLock;
    } catch {
      // ignore
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
  allowedOrigins?: string[];
}

export function isAllowedAssetUrl(url: string, allowedOrigins: string[]): boolean {
  if (!url) return false;
  if (url.startsWith("data:")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
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
  const startedAt = Date.now();
  let success = false;
  let errorMessage: string | null = null;
  const cached = await leaseBrowser();
  try {
    const context = await cached.browser.newContext({
      viewport: { width: 1240, height: 1600 },
      deviceScaleFactor: 2,
      javaScriptEnabled: false,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(NAV_TIMEOUT_MS);

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
      success = true;
      return pdf;
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    releaseBrowser(cached);
    recordRenderSample({
      startedAt,
      durationMs: Date.now() - startedAt,
      success,
      errorMessage,
    });
  }
}

export async function isPortfolioRendererAvailable(): Promise<boolean> {
  if (cachedBrowserResolved && cachedBrowserResolved.browser.isConnected()) {
    chromiumAvailable = true;
    lastAvailabilityError = null;
    lastAvailabilityCheckedAt = Date.now();
    return true;
  }
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch(chromiumLaunchOptions());
    await browser.close();
    chromiumAvailable = true;
    lastAvailabilityError = null;
    lastAvailabilityCheckedAt = Date.now();
    return true;
  } catch (err) {
    chromiumAvailable = false;
    lastAvailabilityError = (err as Error).message;
    lastAvailabilityCheckedAt = Date.now();
    return false;
  }
}

export function getPortfolioRendererStatus(): {
  available: boolean | null;
  error: string | null;
  lastCheckedAt: number | null;
  cachedBrowser: { present: boolean; connected: boolean; recycling: boolean };
} {
  return {
    available: chromiumAvailable,
    error: lastAvailabilityError,
    lastCheckedAt: lastAvailabilityCheckedAt,
    cachedBrowser: {
      present: cachedBrowserResolved !== null,
      connected: cachedBrowserResolved !== null && cachedBrowserResolved.browser.isConnected(),
      recycling: cachedBrowserResolved !== null && cachedBrowserResolved.recycling,
    },
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

// ---------------------------------------------------------------------------
// Render history + failure-rate alerting (mirrors gantt-pdf-service)
// ---------------------------------------------------------------------------

interface RenderSample {
  startedAt: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string | null;
}

const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 2000;
const DB_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const renderHistory: RenderSample[] = [];

let persistenceEnabled = false;
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;
let dbPruneTimer: NodeJS.Timeout | null = null;

function pruneHistory(now: number): void {
  const cutoff = now - HISTORY_RETENTION_MS;
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
    await db.insert(portfolioPdfRenderSamples).values({
      startedAt: new Date(sample.startedAt),
      durationMs: sample.durationMs,
      success: sample.success,
      errorMessage: sample.errorMessage ?? null,
    });
  } catch (err) {
    logError("Failed to persist Portfolio PDF render sample", {}, err as Error);
  }
}

async function pruneDbHistory(): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    await db.delete(portfolioPdfRenderSamples).where(lt(portfolioPdfRenderSamples.startedAt, cutoff));
  } catch (err) {
    logError("Failed to prune Portfolio PDF render history", {}, err as Error);
  }
}

async function hydrateFromDb(): Promise<void> {
  if (!persistenceEnabled) return;
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_MS);
    const rows = await db
      .select({
        startedAt: portfolioPdfRenderSamples.startedAt,
        durationMs: portfolioPdfRenderSamples.durationMs,
        success: portfolioPdfRenderSamples.success,
      })
      .from(portfolioPdfRenderSamples)
      .where(sql`${portfolioPdfRenderSamples.startedAt} >= ${cutoff}`)
      .orderBy(portfolioPdfRenderSamples.startedAt);
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
    logError("Failed to hydrate Portfolio PDF render history", {}, err as Error);
  }
}

export async function initializePortfolioPdfHistory(): Promise<void> {
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
    evaluatePortfolioPdfAlerts(now);
  } catch (err) {
    logError("Portfolio PDF alert evaluation failed", {}, err as Error);
  }
}

export interface PortfolioPdfHistoryBucket {
  bucketStart: number;
  bucketEnd: number;
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface PortfolioPdfHistoryWindow {
  rangeMs: number;
  bucketMs: number;
  buckets: PortfolioPdfHistoryBucket[];
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface PortfolioPdfHistory {
  generatedAt: number;
  retentionMs: number;
  retainedSamples: number;
  lastHour: PortfolioPdfHistoryWindow;
  lastDay: PortfolioPdfHistoryWindow;
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

function buildWindow(now: number, rangeMs: number, bucketMs: number): PortfolioPdfHistoryWindow {
  const start = now - rangeMs;
  const firstBucketStart = Math.floor(start / bucketMs) * bucketMs;
  const bucketCount = Math.ceil(rangeMs / bucketMs) + 1;
  const buckets: PortfolioPdfHistoryBucket[] = [];
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

export function getPortfolioPdfHistory(): PortfolioPdfHistory {
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

export function __resetPortfolioPdfHistoryForTests(): void {
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
// Failure-rate alerting
// ---------------------------------------------------------------------------

export type PortfolioPdfAlertReason =
  | "FAILURE_RATE"
  | "AVG_DURATION"
  | "MAX_DURATION";

export interface PortfolioPdfAlertConfig {
  enabled: boolean;
  evaluationWindowMs: number;
  minSamples: number;
  failureRatePct: number;
  avgDurationMs: number;
  maxDurationMs: number;
  cooldownMs: number;
}

export interface PortfolioPdfAlertWindowSnapshot {
  rangeMs: number;
  total: number;
  failures: number;
  failureRatePct: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

export interface PortfolioPdfAlertBreach {
  reason: PortfolioPdfAlertReason;
  threshold: number;
  observed: number;
  message: string;
}

export interface PortfolioPdfAlertEvent {
  triggeredAt: number;
  breaches: PortfolioPdfAlertBreach[];
  window: PortfolioPdfAlertWindowSnapshot;
  config: PortfolioPdfAlertConfig;
}

export interface PortfolioPdfAlertState {
  lastEvaluatedAt: number | null;
  lastTriggeredAt: number | null;
  lastBreaches: PortfolioPdfAlertBreach[];
  recentAlerts: PortfolioPdfAlertEvent[];
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

const alertConfig: PortfolioPdfAlertConfig = {
  enabled: envBool("PORTFOLIO_PDF_ALERT_ENABLED", true),
  evaluationWindowMs: envNumber("PORTFOLIO_PDF_ALERT_WINDOW_MS", 15 * 60 * 1000),
  minSamples: Math.max(1, Math.round(envNumber("PORTFOLIO_PDF_ALERT_MIN_SAMPLES", 5))),
  failureRatePct: Math.min(100, Math.max(0, envNumber("PORTFOLIO_PDF_ALERT_FAILURE_RATE_PCT", 25))),
  avgDurationMs: envNumber("PORTFOLIO_PDF_ALERT_AVG_MS", 30_000),
  maxDurationMs: envNumber("PORTFOLIO_PDF_ALERT_MAX_MS", 60_000),
  cooldownMs: envNumber("PORTFOLIO_PDF_ALERT_COOLDOWN_MS", 30 * 60 * 1000),
};

const alertState: PortfolioPdfAlertState = {
  lastEvaluatedAt: null,
  lastTriggeredAt: null,
  lastBreaches: [],
  recentAlerts: [],
};

export type PortfolioPdfAlertDispatcher = (event: PortfolioPdfAlertEvent) => Promise<void> | void;
let alertDispatcher: PortfolioPdfAlertDispatcher | null = null;

export function setPortfolioPdfAlertDispatcher(dispatcher: PortfolioPdfAlertDispatcher | null): void {
  alertDispatcher = dispatcher;
}

export function getPortfolioPdfAlertConfig(): PortfolioPdfAlertConfig {
  return { ...alertConfig };
}

export function getPortfolioPdfAlertState(): PortfolioPdfAlertState {
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

export function updatePortfolioPdfAlertConfig(
  patch: Partial<PortfolioPdfAlertConfig>,
): PortfolioPdfAlertConfig {
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
  return getPortfolioPdfAlertConfig();
}

function summarizeWindowForAlerts(now: number, rangeMs: number): PortfolioPdfAlertWindowSnapshot {
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
  snapshot: PortfolioPdfAlertWindowSnapshot,
  config: PortfolioPdfAlertConfig,
): PortfolioPdfAlertBreach[] {
  const breaches: PortfolioPdfAlertBreach[] = [];
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

export function evaluatePortfolioPdfAlerts(now: number = Date.now()): PortfolioPdfAlertEvent | null {
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
  const event: PortfolioPdfAlertEvent = {
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
          logError("Portfolio PDF alert dispatcher failed", {}, err as Error);
        });
      }
    } catch (err) {
      logError("Portfolio PDF alert dispatcher threw", {}, err as Error);
    }
  }
  return event;
}
