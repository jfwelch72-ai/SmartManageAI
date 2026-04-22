import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

// We never want the real DB touched in these unit tests. The service guards
// all persistence with `persistenceEnabled`, which defaults to false unless
// `initializePortfolioPdfHistory()` is called. We still mock `../db` so the
// import doesn't try to open a connection pool.
vi.mock("../db", () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })),
      })),
    })),
  },
  pool: { end: vi.fn(async () => undefined) },
}));

interface MockBrowser extends EventEmitter {
  __id: number;
  __connected: boolean;
  __closed: boolean;
  isConnected: () => boolean;
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const launchedBrowsers: MockBrowser[] = [];
let launchCallCount = 0;
let pdfDelayMs = 0;

function makeBrowser(): MockBrowser {
  launchCallCount++;
  const ee = new EventEmitter() as MockBrowser;
  ee.__id = launchCallCount;
  ee.__connected = true;
  ee.__closed = false;
  ee.isConnected = () => ee.__connected && !ee.__closed;
  ee.close = vi.fn(async () => {
    ee.__closed = true;
    ee.__connected = false;
  });
  ee.newContext = vi.fn(async () => {
    const page = {
      setDefaultTimeout: vi.fn(),
      route: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      pdf: vi.fn(async () => {
        if (pdfDelayMs > 0) {
          await new Promise((r) => setTimeout(r, pdfDelayMs));
        }
        return Buffer.from(`portfolio-pdf-${ee.__id}`);
      }),
    };
    return {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
  });
  launchedBrowsers.push(ee);
  return ee;
}

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(async () => makeBrowser()),
  },
}));

const HTML = "<html><body>Portfolio</body></html>";
const RENDER_OPTS = { allowedOrigins: [] };

async function freshImport() {
  vi.resetModules();
  return await import("../portfolio-pdf-service");
}

describe("portfolio-pdf-service render history", () => {
  beforeEach(() => {
    launchedBrowsers.length = 0;
    launchCallCount = 0;
    pdfDelayMs = 0;
  });

  afterEach(async () => {
    const mod = await import("../portfolio-pdf-service");
    mod.__resetPortfolioPdfHistoryForTests();
    await mod.shutdownPortfolioBrowser().catch(() => undefined);
    vi.useRealTimers();
  });

  it("records a success sample with a realistic non-negative duration", async () => {
    const mod = await freshImport();
    mod.__resetPortfolioPdfHistoryForTests();

    pdfDelayMs = 15;
    const buf = await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(buf).toBeInstanceOf(Buffer);

    const history = mod.getPortfolioPdfHistory();
    expect(history.retainedSamples).toBe(1);
    expect(history.lastHour.total).toBe(1);
    expect(history.lastHour.failures).toBe(0);
    expect(history.lastHour.avgDurationMs).not.toBeNull();
    // Duration should reflect the artificial 15ms delay (allow generous slack).
    expect(history.lastHour.avgDurationMs!).toBeGreaterThanOrEqual(10);
    expect(history.lastHour.maxDurationMs!).toBeGreaterThanOrEqual(10);
    // 24h history mirrors the same single sample.
    expect(history.lastDay.total).toBe(1);
    expect(history.lastDay.failures).toBe(0);
  });

  it("records a failure sample when the underlying render throws", async () => {
    const mod = await freshImport();
    mod.__resetPortfolioPdfHistoryForTests();

    // First, a successful render so we have a known baseline.
    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);

    // Force the next render to fail by making newContext throw on the
    // currently cached browser.
    const failing = launchedBrowsers[launchedBrowsers.length - 1];
    failing.newContext = vi.fn(async () => {
      throw new Error("boom-portfolio");
    });
    await expect(mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS)).rejects.toThrow(
      "boom-portfolio",
    );

    const history = mod.getPortfolioPdfHistory();
    expect(history.retainedSamples).toBe(2);
    expect(history.lastHour.total).toBe(2);
    expect(history.lastHour.failures).toBe(1);
    expect(history.lastDay.failures).toBe(1);
  });

  it("prunes samples that fall outside the 24h retention window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await freshImport();
    mod.__resetPortfolioPdfHistoryForTests();

    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    expect(mod.getPortfolioPdfHistory().retainedSamples).toBe(2);

    // Jump well past the 24h retention window.
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

    const history = mod.getPortfolioPdfHistory();
    expect(history.retainedSamples).toBe(0);
    expect(history.lastHour.total).toBe(0);
    expect(history.lastDay.total).toBe(0);
  });

  it("aggregates samples into lastHour (5m) and lastDay (1h) buckets", async () => {
    const mod = await freshImport();
    mod.__resetPortfolioPdfHistoryForTests();

    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);

    const history = mod.getPortfolioPdfHistory();

    // lastHour window: 60 minutes / 5 minute buckets => 13 buckets.
    expect(history.lastHour.rangeMs).toBe(60 * 60 * 1000);
    expect(history.lastHour.bucketMs).toBe(5 * 60 * 1000);
    expect(history.lastHour.buckets.length).toBe(13);

    // lastDay window: 24 hours / 1 hour buckets => 25 buckets.
    expect(history.lastDay.rangeMs).toBe(24 * 60 * 60 * 1000);
    expect(history.lastDay.bucketMs).toBe(60 * 60 * 1000);
    expect(history.lastDay.buckets.length).toBe(25);

    // All three samples land in the same recent bucket of each window.
    const hourPopulated = history.lastHour.buckets.filter((b) => b.total > 0);
    const dayPopulated = history.lastDay.buckets.filter((b) => b.total > 0);
    expect(hourPopulated).toHaveLength(1);
    expect(dayPopulated).toHaveLength(1);
    expect(hourPopulated[0].total).toBe(3);
    expect(hourPopulated[0].failures).toBe(0);
    expect(hourPopulated[0].avgDurationMs).not.toBeNull();
    expect(hourPopulated[0].maxDurationMs).not.toBeNull();
    expect(dayPopulated[0].total).toBe(3);

    // Each empty bucket exposes the canonical "no data" shape.
    const emptyBucket = history.lastHour.buckets.find((b) => b.total === 0)!;
    expect(emptyBucket.failures).toBe(0);
    expect(emptyBucket.avgDurationMs).toBeNull();
    expect(emptyBucket.maxDurationMs).toBeNull();
    expect(emptyBucket.bucketEnd - emptyBucket.bucketStart).toBe(5 * 60 * 1000);
  });

  it("__resetPortfolioPdfHistoryForTests clears history and alert state", async () => {
    const mod = await freshImport();

    // Configure alerts so a single render trips the AVG_DURATION threshold,
    // giving us non-empty alert state to verify the reset.
    mod.updatePortfolioPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 1,
      failureRatePct: 100,
      avgDurationMs: 1,
      maxDurationMs: 0,
      cooldownMs: 0,
    });

    pdfDelayMs = 10;
    await mod.renderPortfolioSummaryPdf(HTML, RENDER_OPTS);
    pdfDelayMs = 0;

    expect(mod.getPortfolioPdfHistory().retainedSamples).toBe(1);
    const stateBefore = mod.getPortfolioPdfAlertState();
    expect(stateBefore.lastTriggeredAt).not.toBeNull();
    expect(stateBefore.lastBreaches.length).toBeGreaterThan(0);
    expect(stateBefore.recentAlerts.length).toBeGreaterThan(0);

    mod.__resetPortfolioPdfHistoryForTests();

    expect(mod.getPortfolioPdfHistory().retainedSamples).toBe(0);
    const stateAfter = mod.getPortfolioPdfAlertState();
    expect(stateAfter.lastEvaluatedAt).toBeNull();
    expect(stateAfter.lastTriggeredAt).toBeNull();
    expect(stateAfter.lastBreaches).toEqual([]);
    expect(stateAfter.recentAlerts).toEqual([]);
  });
});
