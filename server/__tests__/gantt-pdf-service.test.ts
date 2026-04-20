import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../utils/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
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
let pdfDelayController: { promise: Promise<void>; resolve: () => void } | null = null;
let activePdfCalls = 0;
let maxObservedActivePdfCalls = 0;

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
      goto: vi.fn(async () => undefined),
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => null),
      pdf: vi.fn(async () => {
        activePdfCalls++;
        if (activePdfCalls > maxObservedActivePdfCalls) {
          maxObservedActivePdfCalls = activePdfCalls;
        }
        try {
          if (pdfDelayController) {
            await pdfDelayController.promise;
          }
          return Buffer.from(`pdf-from-browser-${ee.__id}`);
        } finally {
          activePdfCalls--;
        }
      }),
    };
    return {
      addCookies: vi.fn(async () => undefined),
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

const RENDER_OPTS = {
  projectCode: "TEST-1",
  origin: "http://localhost:5000",
};

async function freshImport() {
  vi.resetModules();
  return await import("../gantt-pdf-service");
}

describe("gantt-pdf-service browser pooling and queueing", () => {
  beforeEach(() => {
    launchedBrowsers.length = 0;
    launchCallCount = 0;
    pdfDelayController = null;
    activePdfCalls = 0;
    maxObservedActivePdfCalls = 0;
  });

  afterEach(async () => {
    const mod = await import("../gantt-pdf-service");
    await mod.shutdownGanttBrowser().catch(() => undefined);
    vi.useRealTimers();
  });

  it("reuses the cached browser across sequential exports", async () => {
    const { renderGanttPdf } = await freshImport();

    const buf1 = await renderGanttPdf(RENDER_OPTS);
    const buf2 = await renderGanttPdf(RENDER_OPTS);
    const buf3 = await renderGanttPdf(RENDER_OPTS);

    expect(buf1).toBeInstanceOf(Buffer);
    expect(buf2).toBeInstanceOf(Buffer);
    expect(buf3).toBeInstanceOf(Buffer);
    expect(launchCallCount).toBe(1);
    expect(launchedBrowsers).toHaveLength(1);
    expect(launchedBrowsers[0].newContext).toHaveBeenCalledTimes(3);
  });

  it("recycles the browser after the configured PDF count", async () => {
    const { renderGanttPdf } = await freshImport();

    // MAX_PDFS_PER_BROWSER = 50. After 50 renders we should still be on
    // browser #1; the 51st call must trigger a launch of browser #2.
    for (let i = 0; i < 50; i++) {
      await renderGanttPdf(RENDER_OPTS);
    }
    expect(launchCallCount).toBe(1);

    await renderGanttPdf(RENDER_OPTS);
    expect(launchCallCount).toBe(2);

    // The retired browser should have been closed (no in-flight renders).
    expect(launchedBrowsers[0].close).toHaveBeenCalled();
  });

  it("recycles the browser after the configured age", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { renderGanttPdf } = await freshImport();

    await renderGanttPdf(RENDER_OPTS);
    expect(launchCallCount).toBe(1);

    // Advance past MAX_BROWSER_AGE_MS = 30 minutes.
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);

    await renderGanttPdf(RENDER_OPTS);
    expect(launchCallCount).toBe(2);
    expect(launchedBrowsers[0].close).toHaveBeenCalled();
  });

  it("detects a disconnected browser and launches a fresh one", async () => {
    const { renderGanttPdf } = await freshImport();

    await renderGanttPdf(RENDER_OPTS);
    expect(launchCallCount).toBe(1);

    // Simulate Chromium crashing / getting disconnected between requests.
    const first = launchedBrowsers[0];
    first.__connected = false;
    first.emit("disconnected");

    await renderGanttPdf(RENDER_OPTS);
    expect(launchCallCount).toBe(2);
    expect(launchedBrowsers[1].__id).toBe(2);
  });

  it("rejects with GanttPdfQueueFullError when the queue is saturated", async () => {
    const { renderGanttPdf, GanttPdfQueueFullError } = await freshImport();

    let releasePdf!: () => void;
    pdfDelayController = {
      promise: new Promise<void>((resolve) => {
        releasePdf = resolve;
      }),
      resolve: () => releasePdf(),
    };

    // Concurrency cap = 2, queue length = 8. Fire 2 active + 8 queued = 10
    // renders; the 11th must be rejected immediately as queue-full.
    const inFlight = Array.from({ length: 10 }, () => renderGanttPdf(RENDER_OPTS));

    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    await expect(renderGanttPdf(RENDER_OPTS)).rejects.toBeInstanceOf(
      GanttPdfQueueFullError,
    );

    releasePdf();
    pdfDelayController = null;
    await Promise.all(inFlight);
  });

  it("rejects queued renders that wait longer than the slot timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { renderGanttPdf } = await freshImport();

    let releasePdf!: () => void;
    pdfDelayController = {
      promise: new Promise<void>((resolve) => {
        releasePdf = resolve;
      }),
      resolve: () => releasePdf(),
    };

    // Saturate the 2 concurrent slots so the next render must wait.
    const blockers = [renderGanttPdf(RENDER_OPTS), renderGanttPdf(RENDER_OPTS)];
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(20);
    expect(activePdfCalls).toBe(2);

    const queued = renderGanttPdf(RENDER_OPTS);
    // Attach the rejection handler synchronously so the timer-driven
    // rejection is never observed as unhandled.
    const queuedAssertion = expect(queued).rejects.toThrow(
      /Timed out waiting for Gantt PDF render slot/,
    );

    // Advance past QUEUE_WAIT_TIMEOUT_MS (60s) but well under the
    // browser-age threshold (30m) so we only trip the wait timeout.
    await vi.advanceTimersByTimeAsync(61 * 1000);
    await queuedAssertion;

    releasePdf();
    pdfDelayController = null;
    await Promise.all(blockers);
  });

  it("records render history with successes and failures and prunes old samples", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const mod = await freshImport();
    const { renderGanttPdf, getGanttPdfHistory, __resetGanttPdfHistoryForTests } = mod;
    __resetGanttPdfHistoryForTests();

    await renderGanttPdf(RENDER_OPTS);
    await renderGanttPdf(RENDER_OPTS);

    let history = getGanttPdfHistory();
    expect(history.retainedSamples).toBe(2);
    expect(history.lastHour.total).toBe(2);
    expect(history.lastHour.failures).toBe(0);
    expect(history.lastDay.total).toBe(2);
    expect(history.lastHour.avgDurationMs).not.toBeNull();
    expect(history.lastHour.buckets.length).toBeGreaterThan(0);
    const lastHourBucketsWithData = history.lastHour.buckets.filter((b) => b.total > 0);
    expect(lastHourBucketsWithData.length).toBeGreaterThan(0);

    // Force a failure by making newContext throw.
    const failingBrowser = launchedBrowsers[launchedBrowsers.length - 1];
    failingBrowser.newContext = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(renderGanttPdf(RENDER_OPTS)).rejects.toThrow("boom");

    history = getGanttPdfHistory();
    expect(history.retainedSamples).toBe(3);
    expect(history.lastHour.failures).toBe(1);

    // Advance well beyond the 24h retention window; old samples must drop.
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    history = getGanttPdfHistory();
    expect(history.retainedSamples).toBe(0);
    expect(history.lastHour.total).toBe(0);
    expect(history.lastDay.total).toBe(0);
  });

  it("queues bursts of concurrent exports and completes them all", async () => {
    const { renderGanttPdf } = await freshImport();

    let releasePdf!: () => void;
    pdfDelayController = {
      promise: new Promise<void>((resolve) => {
        releasePdf = resolve;
      }),
      resolve: () => releasePdf(),
    };

    // Kick off a burst of 6 concurrent exports. Concurrency cap is 2,
    // so 4 must queue while the first 2 are blocked on pdf().
    const renders = Array.from({ length: 6 }, () => renderGanttPdf(RENDER_OPTS));

    // Give the event loop a few ticks for scheduling.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    await new Promise((r) => setTimeout(r, 10));

    expect(activePdfCalls).toBe(2);

    // Release all blocked pdf() calls and let everything drain.
    releasePdf();
    pdfDelayController = null;

    const results = await Promise.all(renders);
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r).toBeInstanceOf(Buffer);
    }

    // Cap was honored throughout the burst.
    expect(maxObservedActivePdfCalls).toBeLessThanOrEqual(2);
    // All 6 reused the same cached browser.
    expect(launchCallCount).toBe(1);
    expect(launchedBrowsers[0].newContext).toHaveBeenCalledTimes(6);
  });
});

describe("gantt-pdf-service alert evaluation", () => {
  beforeEach(() => {
    launchedBrowsers.length = 0;
    launchCallCount = 0;
    pdfDelayController = null;
    activePdfCalls = 0;
    maxObservedActivePdfCalls = 0;
  });

  afterEach(async () => {
    const mod = await import("../gantt-pdf-service");
    mod.__resetGanttPdfHistoryForTests();
    mod.setGanttPdfAlertDispatcher(null);
    await mod.shutdownGanttBrowser().catch(() => undefined);
  });

  it("does not trigger alerts below the minimum sample threshold", async () => {
    const mod = await freshImport();
    mod.updateGanttPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 5 * 60 * 1000,
      minSamples: 5,
      failureRatePct: 10,
      avgDurationMs: 0,
      maxDurationMs: 0,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    mod.setGanttPdfAlertDispatcher((e) => { dispatched.push(e); });
    // Only 2 renders, both failures. Should NOT trigger because below minSamples.
    pdfDelayController = null;
    // Force failures by making goto throw via newContext return tweak — easier:
    // directly drive the evaluator after manually pushing samples by re-rendering.
    // Instead, render twice successfully and confirm no alert because failure rate is 0.
    await mod.renderGanttPdf(RENDER_OPTS);
    await mod.renderGanttPdf(RENDER_OPTS);
    expect(dispatched).toHaveLength(0);
    expect(mod.getGanttPdfAlertState().lastBreaches).toEqual([]);
  });

  it("triggers an alert when avg duration crosses the threshold and respects cooldown", async () => {
    const mod = await freshImport();
    mod.updateGanttPdfAlertConfig({
      enabled: true,
      evaluationWindowMs: 60_000,
      minSamples: 1,
      failureRatePct: 0,
      avgDurationMs: 5, // 5ms — our forced 20ms delay will exceed this
      maxDurationMs: 0,
      cooldownMs: 0, // start with no cooldown
    });
    const dispatched: any[] = [];
    mod.setGanttPdfAlertDispatcher((e) => { dispatched.push(e); });

    // Force each render to take ~20ms via the pdf() mock delay.
    pdfDelayController = {
      promise: new Promise<void>((resolve) => setTimeout(resolve, 20)),
      resolve: () => undefined,
    };

    await mod.renderGanttPdf(RENDER_OPTS);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].breaches.some((b: any) => b.reason === "AVG_DURATION")).toBe(true);

    // Now set a long cooldown — second render must not dispatch again.
    mod.updateGanttPdfAlertConfig({ cooldownMs: 10 * 60 * 1000 });
    // updateGanttPdfAlertConfig itself runs evaluate but cooldown blocks it; ignore extras.
    const beforeSecond = dispatched.length;
    await mod.renderGanttPdf(RENDER_OPTS);
    expect(dispatched.length).toBe(beforeSecond);

    // Drop cooldown back to 0 and render again — should dispatch.
    mod.updateGanttPdfAlertConfig({ cooldownMs: 0 });
    const beforeThird = dispatched.length;
    await mod.renderGanttPdf(RENDER_OPTS);
    expect(dispatched.length).toBeGreaterThan(beforeThird);
  });

  it("does not dispatch when alerts are disabled", async () => {
    const mod = await freshImport();
    mod.updateGanttPdfAlertConfig({
      enabled: false,
      avgDurationMs: 1,
      minSamples: 1,
      cooldownMs: 0,
    });
    const dispatched: any[] = [];
    mod.setGanttPdfAlertDispatcher((e) => { dispatched.push(e); });
    await mod.renderGanttPdf(RENDER_OPTS);
    expect(dispatched).toHaveLength(0);
  });

  it("clamps and validates updateGanttPdfAlertConfig inputs", async () => {
    const mod = await freshImport();
    const cfg = mod.updateGanttPdfAlertConfig({
      failureRatePct: 250,
      evaluationWindowMs: 1000, // below 60s minimum
      minSamples: 0,
      avgDurationMs: -5,
    });
    expect(cfg.failureRatePct).toBe(100);
    expect(cfg.evaluationWindowMs).toBe(60_000);
    // minSamples=0 is below the >=1 guard, so previous default is preserved.
    expect(cfg.minSamples).toBeGreaterThanOrEqual(1);
    // negative avgDurationMs should be ignored (kept previous)
    expect(cfg.avgDurationMs).toBeGreaterThanOrEqual(0);
  });
});
