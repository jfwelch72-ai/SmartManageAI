/**
 * Task #2213 — Worker-only PDF preview path coverage.
 *
 * After Task #2188, both `<PdfPreview />` (the in-app markups drawer) and
 * `<PlanDocumentPrintPage />` (the headless print route) dispatch every
 * pdfjs render through the shared `pdfTileWorker` pool the takeoff
 * workspace uses (Task #2138). There is no main-thread fallback: when
 * `getSharedScheduler()` returns `null` (no `Worker`, no
 * `OffscreenCanvas`, …) both surfaces deliberately surface a friendly
 * error instead of silently regressing.
 *
 * The existing perf spec (`takeoff-tile-renderer-perf.spec.ts`) covers
 * the takeoff workspace's tile renderer — but it does NOT exercise the
 * markups preview drawer or the `/print/plan-documents/:id` route. This
 * spec fills that gap with two cases:
 *
 *   1. Happy path — open a plan-document with a markup in the project
 *      Plans tab, assert the worker pipeline actually paints pixels into
 *      the `<canvas data-testid="pdf-preview-canvas">`, and assert no
 *      main-thread long task >100 ms fires during initial paint
 *      (regression guard against pdfjs sneaking back onto the main
 *      thread).
 *   2. Sad path — stub `Worker` so `getSharedScheduler()` returns null,
 *      then assert both `<PdfPreview />` AND `<PlanDocumentPrintPage />`
 *      render their friendly "scheduler unavailable" error UX (and the
 *      print page still flips `__PLAN_PDF_READY=true` so the headless
 *      capture doesn't deadlock).
 *
 * Cross-engine notes (Task #2253):
 *   - Both friendly-error cases run as-is in chromium / firefox /
 *     webkit. The `Object.defineProperty(window, "Worker", { value:
 *     undefined })` stub takes the `typeof Worker === "undefined"`
 *     branch in `getSharedScheduler()` consistently across all three
 *     engines (verified locally on firefox-1511 and webkit-2272 with
 *     Playwright 1.59.1).
 *   - The happy-path canvas-pixel + overlay assertions also run
 *     cross-engine — pdfjs's worker-mediated render lands an
 *     `ImageBitmap` on the visible canvas in every engine that exposes
 *     `Worker` + `OffscreenCanvas`.
 *   - The "main thread stays free" assertion is gated to chromium.
 *     `PerformanceObserver`'s `longtask` entry type is a Chromium-only
 *     extension (the W3C Long Tasks spec is not implemented in
 *     Gecko/WebKit at the time of writing — see MDN's compat table).
 *     Firefox and WebKit silently emit no entries, so a
 *     `longTasks.length` of 0 there proves nothing about whether
 *     pdfjs is on the main thread; running the assertion would just
 *     bake in a false-positive "always green" signal that masks real
 *     regressions on chromium.
 *   - Task #2292 — to give Firefox and WebKit an actual signal (not
 *     just "no longtask, therefore green"), the spec now also reads
 *     `window.__pdfTileSchedulerStats` — a small call counter we
 *     instrument inside `tileScheduler.ts`. The counter increments
 *     every time a `getDocumentInfo` / `renderPage` call is dispatched
 *     through the worker pool, so a regression that re-introduced
 *     main-thread `pdfjs.getDocument(url).promise.then(p => p.render())`
 *     (bypassing the scheduler entirely) would leave the counters at 0
 *     even though the canvas eventually paints. That assertion runs on
 *     chromium, firefox, *and* webkit and catches the same class of
 *     regression on every engine without relying on the longtask API.
 */

import { test, expect, type Page } from "@playwright/test";
import { authedRequest, installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const PDF_LABEL = "Pdf Preview Worker E2E";

// Mirrors the headroom the takeoff tile-renderer perf spec uses so CI
// hardware variance doesn't make this assertion flaky. The intent of
// the budget is "main thread is free during initial paint" — the
// absolute number tracks the 100 ms cited in the task brief.
const CI_PERF_HEADROOM = process.env.CI ? 2.0 : 1.0;
const LONG_TASK_BUDGET_MS = 100 * CI_PERF_HEADROOM;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface PlanDocumentResponse {
  id: string;
  projectId: string;
  title: string;
  fileName: string;
}

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
}

async function devLogin(page: Page, role: string): Promise<void> {
  const r = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(r.status()).toBe(200);
}

async function createProject(
  page: Page,
  suffix: string | number,
): Promise<ProjectResponse> {
  const r = await authedRequest(page, "POST", `${BASE_URL}/api/projects`, {
    data: {
      name: `PW Worker-Only PDF ${suffix}`,
      clientName: "PW Worker-Only Client",
      status: "PLANNING",
    },
  });
  if (r.status() !== 201) {
    throw new Error(
      `Project create failed (${r.status()}): ${await r.text()}`,
    );
  }
  return (await r.json()) as ProjectResponse;
}

async function createPlanDocument(
  page: Page,
  projectId: string,
  suffix: string | number,
): Promise<PlanDocumentResponse> {
  const { objectKey } = await uploadFixturePdf(page, {
    baseUrl: BASE_URL,
    label: PDF_LABEL,
  });
  const r = await authedRequest(page, "POST", `${BASE_URL}/api/documents`, {
    data: {
      projectId,
      type: "PLANS",
      title: `PW Worker-Only Plan ${suffix}`,
      fileName: `pw-worker-only-${suffix}.pdf`,
      fileUrl: objectKey,
      mimeType: "application/pdf",
    },
  });
  if (r.status() !== 201) {
    throw new Error(
      `Plan document create failed (${r.status()}): ${await r.text()}`,
    );
  }
  return (await r.json()) as PlanDocumentResponse;
}

async function createMarkup(
  page: Page,
  documentId: string,
  body: {
    pageNumber: number;
    tool: string;
    points: Array<{ x: number; y: number }>;
    color: string;
    thickness: number;
  },
): Promise<MarkupResponse> {
  const r = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/plan-documents/${documentId}/markups`,
    { data: body },
  );
  if (r.status() !== 201) {
    throw new Error(`Markup create failed (${r.status()}): ${await r.text()}`);
  }
  return (await r.json()) as MarkupResponse;
}

/**
 * Install a `longtask` PerformanceObserver via `addInitScript` so the
 * observer is wired up before any app code runs. The samples array is
 * reset by the test after the cold-start paint settles so the
 * assertion only measures long tasks that fire during the actual
 * worker-mediated PDF render — Vite/React/sidebar bundle hydration on
 * the cold project page produces a large unrelated long task that
 * would otherwise drown out the regression we care about.
 *
 * Task #2253 — only Chromium implements the W3C Long Tasks API
 * (`PerformanceObserver` with `entryTypes: ["longtask"]`). The
 * try/catch below keeps the init script harmless on Gecko/WebKit
 * (where `obs.observe({ type: "longtask" })` throws), but the
 * happy-path test only reads `__longTasks` when it's about to assert
 * — and that read is itself gated behind `browserName === "chromium"`
 * so the friendly-error guarantee on the other engines isn't
 * weakened by an always-empty samples array silently passing.
 */
async function installLongTaskRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface PerfWin extends Window {
      __longTasks?: number[];
      __longTaskObserver?: PerformanceObserver;
    }
    const w = window as PerfWin;
    w.__longTasks = [];
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          w.__longTasks!.push(e.duration);
        }
      });
      obs.observe({ type: "longtask", buffered: true });
      w.__longTaskObserver = obs;
    } catch {
      /* longtask unsupported in this browser (Gecko / WebKit) — leave
         samples empty. The chromium-gated assertion below won't run
         on these engines, so this branch is just defensive. */
    }
  });
}

async function resetLongTaskRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks?: number[] };
    if (w.__longTasks) w.__longTasks.length = 0;
  });
}

/**
 * Stub `Worker` to undefined before the app bundle evaluates so
 * `getSharedScheduler()` (`tileScheduler.ts`) takes its `typeof
 * Worker === "undefined"` branch and returns `null`. This is the
 * externally observable hook for the "scheduler unavailable" path —
 * the production code we're testing already accepts `null` from this
 * helper (jsdom unit tests, Safari 16-, …) so we just force that
 * condition in a real browser.
 */
async function disableWorkerSupport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: undefined,
      });
    } catch {
      /* if the property is non-configurable for some reason, fall back
         to assignment — Chromium leaves it configurable in practice. */
      try {
        (window as unknown as { Worker?: unknown }).Worker = undefined;
      } catch {
        /* noop */
      }
    }
  });
}

/**
 * Task #2298 — Replace `window.Worker` with a stand-in that always
 * responds to scheduler requests with `ok: false` and an
 * `InvalidPDFException` error name. This exercises the
 * "consumer dispatched into the scheduler, the worker rejected"
 * code path end-to-end without depending on a real `pdfTileWorker`
 * instance:
 *
 *   - The scheduler still constructs a `Worker` (so
 *     `getSharedScheduler()` does NOT take its null branch — the
 *     "scheduler unavailable" test above already covers that).
 *   - Every `postMessage({type: "getDocumentInfo" | "renderPage" |
 *     ...})` from the scheduler is answered with the same
 *     `{ ok: false, error, errorName }` shape the real worker posts
 *     when pdfjs throws inside it. The scheduler's `onMessage`
 *     turns that into a `WorkerPdfError` rejection, which the
 *     consumer (PdfPreview) maps to its friendly error UI.
 *   - `addInitScript` runs before the app bundle loads, so the
 *     scheduler picks up the stand-in on first use across
 *     navigations and reloads.
 *
 * Why this and not `page.route()` to serve garbage PDF bytes: on
 * WebKit, `page.route()` does NOT reliably intercept fetches issued
 * from a dedicated worker, so the real PDF streams through and
 * pdfjs renders it successfully — the friendly-error assertion
 * never fires. Stubbing `Worker` itself is engine-agnostic and
 * exercises the exact same scheduler→`WorkerPdfError`→consumer
 * code path the brief calls out.
 */
async function injectWorkerRejectingScheduler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The set of scheduler request types `pdfTileWorker.ts` accepts.
    // Anything outside this set (e.g. the worker's own internal
    // protocol future expansion) falls through silently — we don't
    // want to misroute unknown messages onto the synthetic-error
    // path because that could mask real regressions.
    const SCHEDULER_TYPES = new Set([
      "getDocumentInfo",
      "renderPage",
      "getPageDims",
      "renderPlaceholder",
      "renderTile",
      "renderThumbnail",
      "getTextItems",
      "evictSheet",
    ]);

    class WorkerRejectingPdf extends EventTarget implements Worker {
      // Keep the assignable handlers around so `worker.onmessage = …`
      // (used by some libs as a shorthand) still fires alongside any
      // `addEventListener("message", …)` listeners.
      onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
      onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
      onerror: ((this: AbstractWorker, ev: ErrorEvent) => unknown) | null = null;

      constructor(_scriptURL: string | URL, _options?: WorkerOptions) {
        super();
      }

      postMessage(message: unknown, _transfer?: unknown): void {
        if (
          !message ||
          typeof message !== "object" ||
          !("type" in message) ||
          !("requestId" in message)
        ) {
          return;
        }
        const m = message as { type: string; requestId: number };
        if (!SCHEDULER_TYPES.has(m.type)) return;
        const reply = {
          type: m.type,
          requestId: m.requestId,
          ok: false,
          error:
            "Invalid PDF structure (Task #2298 synthetic worker rejection)",
          errorName: "InvalidPDFException",
        };
        // Defer one microtask so the scheduler's `pending.set(...)`
        // (which runs synchronously after the postMessage call) has
        // already wired up the request before we deliver the reply.
        queueMicrotask(() => {
          const ev = new MessageEvent("message", { data: reply });
          this.dispatchEvent(ev);
          if (this.onmessage) this.onmessage.call(this as unknown as Worker, ev);
        });
      }

      terminate(): void {
        /* noop — nothing real to clean up */
      }
    }

    // Replace the global. The TileScheduler constructor calls
    // `new Worker(new URL(...), { type: "module" })`, which now
    // instantiates this stand-in.
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: WorkerRejectingPdf,
    });
  });
}

async function readLongTasks(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const w = window as unknown as { __longTasks?: number[] };
    return [...(w.__longTasks ?? [])];
  });
}

interface SchedulerStats {
  renderPageCalls: number;
  getDocumentInfoCalls: number;
}

/**
 * Task #2292 — Read the cross-engine call counter that
 * `tileScheduler.ts` exposes on `window.__pdfTileSchedulerStats`. The
 * counter increments every time a `getDocumentInfo` / `renderPage`
 * call is dispatched through the worker pool, so a non-zero value on
 * Firefox / WebKit proves pdfjs ran via the worker (not on the main
 * thread). Returns zeroes if the object hasn't been attached yet —
 * that's the actual regression signal: the counter object is created
 * lazily on first scheduler dispatch, so "still undefined after the
 * canvas painted" means the consumer bypassed the scheduler.
 */
async function readSchedulerStats(page: Page): Promise<SchedulerStats> {
  return await page.evaluate(() => {
    const w = window as unknown as {
      __pdfTileSchedulerStats?: SchedulerStats;
    };
    const s = w.__pdfTileSchedulerStats;
    return {
      renderPageCalls: s?.renderPageCalls ?? 0,
      getDocumentInfoCalls: s?.getDocumentInfoCalls ?? 0,
    };
  });
}

/**
 * Reset the scheduler stats to zero so the next assertion measures
 * only dispatches that happen *after* this call (e.g. so the zoom
 * re-render assertion isn't trivially satisfied by counters left over
 * from the initial paint).
 */
async function resetSchedulerStats(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __pdfTileSchedulerStats?: SchedulerStats;
    };
    if (w.__pdfTileSchedulerStats) {
      w.__pdfTileSchedulerStats.renderPageCalls = 0;
      w.__pdfTileSchedulerStats.getDocumentInfoCalls = 0;
    }
  });
}

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Task #2213 — Worker-only PDF preview path", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("plan-document preview canvas paints non-blank pixels and stays off the main thread", async ({
    page,
    browserName,
  }) => {
    // Task #2253 — WebKit's pdfjs render is noticeably slower in the
    // headless container than chromium/firefox (the cold pdfjs +
    // worker boot, page rasterisation, and a follow-up zoom re-render
    // routinely clear 90 s in CI). Bumping the per-test timeout to
    // 240 s on webkit keeps the cross-engine canvas-pixel coverage
    // green without inflating the budget for the engines that finish
    // in well under 60 s.
    test.setTimeout(browserName === "webkit" ? 240_000 : 120_000);

    // Task #2253 — `longtask` PerformanceObserver entries are a
    // Chromium-only thing; in Gecko/WebKit `__longTasks` stays empty
    // forever which would let a regression that re-introduced
    // main-thread pdfjs sneak past the assertion below. Only install
    // the recorder on chromium so the assertion that reads it is
    // operating on real data, never on a vacuously-empty array.
    const measureLongTasks = browserName === "chromium";

    const suffix = Date.now();
    // Install the long-task observer BEFORE navigation so we capture
    // the cold-start paint window — that's where a regression to a
    // synchronous main-thread `pdfjs` would show up.
    if (measureLongTasks) {
      await installLongTaskRecorder(page);
    }
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    // Seed a HIGHLIGHT markup so the preview drawer also exercises the
    // overlay slot (`PlanMarkupLayer` mounts inside `PdfPreview`'s
    // overlay render prop). A bare PDF would still cover the worker
    // pipeline, but a markup proves the overlay sees the same canvas
    // dimensions the worker produced.
    await createMarkup(page, doc.id, {
      pageNumber: 1,
      tool: "HIGHLIGHT",
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.3, y: 0.2 },
      ],
      color: "#3b82f6",
      thickness: 2,
    });

    // First navigate to the Plans tab WITHOUT a documentId param. This
    // pays the cold-start cost (Vite client init, sidebar hydration,
    // project detail load, plans tab list render) without mounting
    // PdfPreview. We then reset the long-task buffer once the document
    // list is visible so the assertion below only measures the window
    // between "user opens a plan document" and "first canvas paint",
    // which is exactly the path the task brief calls out.
    await page.goto(`${BASE_URL}/projects/${project.code}?tab=plans`, {
      waitUntil: "domcontentloaded",
    });

    const docCard = page.getByTestId(`document-${doc.id}`);
    await expect(docCard).toBeVisible({ timeout: 30_000 });
    // Wait for any in-flight requests (auth, project detail, document
    // list) to settle before we start measuring. Anything that fires
    // after this point and trips a long task is fair game for the
    // pdfjs-on-main-thread regression assertion.
    await page
      .waitForLoadState("networkidle", { timeout: 15_000 })
      .catch(() => {
        /* networkidle is best-effort on a heavy page; if it never
           settles within 15s we still proceed because the doc list is
           already visible. The reset below is what actually scopes
           the measurement window. */
      });

    const canvas = page.getByTestId("pdf-preview-canvas");

    // Helper that returns a pixel "fingerprint" of the canvas (current
    // dimensions plus the count of non-transparent pixels in a 32×32
    // patch at the centre). pdfjs paints opaque pixels for the whole
    // page region, so an all-transparent sample means the worker never
    // delivered an `ImageBitmap` (the regression we're guarding
    // against).
    const sampleCanvas = async (): Promise<{ w: number; h: number; nonBlank: number }> =>
      await canvas.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext("2d");
        if (!ctx || el.width === 0 || el.height === 0) {
          return { w: el.width, h: el.height, nonBlank: 0 };
        }
        const cx = Math.floor(el.width / 2);
        const cy = Math.floor(el.height / 2);
        const r = 16;
        const x0 = Math.max(0, cx - r);
        const y0 = Math.max(0, cy - r);
        const w = Math.min(el.width - x0, r * 2);
        const h = Math.min(el.height - y0, r * 2);
        const data = ctx.getImageData(x0, y0, w, h).data;
        let nonBlank = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] !== 0) nonBlank++;
        }
        return { w: el.width, h: el.height, nonBlank };
      });

    // Reset the long-task buffer right before opening the plan
    // document. Everything captured from here through the first
    // non-blank canvas paint is "the initial-paint window for the
    // worker pipeline" — i.e. the exact window the acceptance criterion
    // calls out. (Skipped on engines without `longtask` support — see
    // `measureLongTasks` above.)
    if (measureLongTasks) {
      await resetLongTaskRecorder(page);
    }

    // Task #2292 — also reset the cross-engine scheduler call counter
    // so the assertion below only counts dispatches that happen during
    // the initial-paint window we're about to open. (No project-detail
    // load mounts a PDF preview, so in practice the counter is already
    // 0 here, but resetting makes the intent explicit and keeps the
    // assertion robust if cold-start behaviour ever changes.)
    await resetSchedulerStats(page);

    // Open the plan document. This mounts <PdfPreview/>, which
    // dispatches `getDocumentInfo` + `renderPage` to the shared tile
    // scheduler worker. If pdfjs were back on the main thread, this
    // is where the long task would land.
    await docCard.click();

    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await sampleCanvas()).nonBlank, {
        timeout: 30_000,
        message:
          "PdfPreview worker pipeline never painted pixels — the worker-only path is broken",
      })
      .toBeGreaterThan(0);

    // The overlay slot only mounts once the canvas reports a non-zero
    // size — i.e. once the worker delivered its first bitmap and
    // `setCanvasSize` fired. Having the overlay visible proves the
    // worker pipeline made it past `getDocumentInfo` + first
    // `renderPage`.
    await expect(page.getByTestId("pdf-preview-overlay")).toBeVisible({
      timeout: 15_000,
    });

    // Task #2292 — cross-engine "pdfjs flowed through the worker pool"
    // assertion. Unlike the chromium-only longtask gate below, this
    // runs on chromium, firefox, and webkit alike. The counter is
    // incremented inside `tileScheduler.getDocumentInfo` /
    // `tileScheduler.renderPage`, so a regression that re-introduced
    // main-thread `pdfjs.getDocument(url).promise.then(p => p.render())`
    // (bypassing the scheduler) would leave the counters at 0 even
    // though the canvas painted above. This is the first assertion in
    // this spec that catches a Firefox- or Safari-only regression in
    // the worker contract — the canvas-pixel test alone only proves
    // pixels arrived, not where the work happened.
    const initialPaintStats = await readSchedulerStats(page);
    expect(
      initialPaintStats.getDocumentInfoCalls,
      `expected scheduler.getDocumentInfo to be dispatched at least once during initial paint, got ${initialPaintStats.getDocumentInfoCalls} — pdfjs may be bypassing the worker pool`,
    ).toBeGreaterThan(0);
    expect(
      initialPaintStats.renderPageCalls,
      `expected scheduler.renderPage to be dispatched at least once during initial paint, got ${initialPaintStats.renderPageCalls} — pdfjs may be rendering the page on the main thread`,
    ).toBeGreaterThan(0);

    // Initial-paint long-task ceiling: pdfjs MUST stay off the main
    // thread during the open-document-to-first-paint window. With the
    // worker pipeline, a full-page render dispatches off the main
    // thread; a regression that re-introduced
    // `pdfjs.getDocument(...).promise.then(p => p.render(...))` on the
    // main thread would trip a >100 ms long task during this window.
    //
    // Task #2253 — gated to chromium because `longtask` is a
    // Chromium-only PerformanceEntry type. Running this on Gecko /
    // WebKit would always observe an empty buffer, which would silently
    // pass even if pdfjs were back on the main thread on those engines.
    // The worker contract itself is enforced cross-engine by the
    // friendly-error tests below — if `getSharedScheduler()` returns
    // null we surface an error, so the only way the canvas-pixel
    // assertion above succeeds at all is if the worker pipeline ran.
    if (measureLongTasks) {
      const initialPaintTasks = await readLongTasks(page);
      const worstInitialPaint = initialPaintTasks.reduce(
        (a, b) => Math.max(a, b),
        0,
      );
      expect(
        worstInitialPaint,
        `worst main-thread long task during initial paint ${worstInitialPaint.toFixed(0)}ms exceeded ${LONG_TASK_BUDGET_MS}ms — pdfjs may be back on the main thread`,
      ).toBeLessThan(LONG_TASK_BUDGET_MS);
    }

    // Additional guard: also verify a fresh re-render through the
    // worker (triggered via zoom-in) actually paints new pixels into
    // the canvas. The pixel sample below proves the worker delivered
    // a fresh ImageBitmap; on chromium we additionally assert the
    // re-render didn't slip onto the main thread. This catches
    // regressions that only show up on subsequent renders (e.g.
    // cache-miss paths or tile-scheduler fallbacks).
    const baseline = await sampleCanvas();
    if (measureLongTasks) {
      await resetLongTaskRecorder(page);
    }
    // Task #2292 — also reset the scheduler counter so the post-zoom
    // assertion below only counts the re-render dispatch (and not the
    // initial-paint dispatches we already asserted on above).
    await resetSchedulerStats(page);

    const zoomBtn = page.getByTestId("button-pdf-zoom-in");
    await expect(zoomBtn).toBeEnabled();
    await zoomBtn.click();

    await expect
      .poll(async () => (await sampleCanvas()).w, {
        timeout: 30_000,
        message:
          "Zoom did not produce a new canvas size — worker render never arrived",
      })
      .toBeGreaterThan(baseline.w);
    await expect
      .poll(async () => (await sampleCanvas()).nonBlank, {
        timeout: 15_000,
        message: "Post-zoom canvas never received pixels from the worker",
      })
      .toBeGreaterThan(0);

    if (measureLongTasks) {
      const zoomTasks = await readLongTasks(page);
      const worstZoom = zoomTasks.reduce((a, b) => Math.max(a, b), 0);
      expect(
        worstZoom,
        `worst main-thread long task during zoom re-render ${worstZoom.toFixed(0)}ms exceeded ${LONG_TASK_BUDGET_MS}ms — pdfjs may be back on the main thread`,
      ).toBeLessThan(LONG_TASK_BUDGET_MS);
    }

    // Task #2292 — cross-engine guard for the zoom re-render path.
    // Subsequent renders go through a separate code path from the
    // initial paint (cache-miss handling, scale change, etc.), so a
    // regression that only fell back to main-thread pdfjs on the
    // re-render path would slip past the initial-paint assertion
    // above. Asserting `renderPageCalls > 0` after the zoom-in
    // pinpoints that class of regression on Firefox / WebKit too.
    const zoomStats = await readSchedulerStats(page);
    expect(
      zoomStats.renderPageCalls,
      `expected scheduler.renderPage to be dispatched at least once during zoom re-render, got ${zoomStats.renderPageCalls} — pdfjs may be re-rendering on the main thread`,
    ).toBeGreaterThan(0);
  });

  test("PdfPreview surfaces the friendly worker-unavailable error when the shared scheduler can't be created", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    // Stub Worker BEFORE navigation so the in-page module evaluation
    // takes the `typeof Worker === "undefined"` branch in
    // `getSharedScheduler()` from the very first call.
    await disableWorkerSupport(page);

    await page.goto(
      `${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`,
      { waitUntil: "domcontentloaded" },
    );

    const errorBlock = page.getByTestId("pdf-preview-error");
    await expect(errorBlock).toBeVisible({ timeout: 30_000 });
    // Friendly text must mention worker support so the user understands
    // why the preview is unavailable (and isn't shown a raw pdfjs
    // exception or a blank panel).
    await expect(
      page.getByTestId("text-pdf-preview-error-detail"),
    ).toContainText(/worker support/i);
    // Retry / Open File buttons remain available so the user has a
    // path forward (Open File falls back to the browser's native PDF
    // viewer, which doesn't go through the worker pipeline).
    await expect(page.getByTestId("button-pdf-retry")).toBeVisible();

    // The loading + canvas render paths must not have started.
    await expect(page.getByTestId("pdf-preview-canvas")).toHaveCount(0);
    await expect(page.getByTestId("pdf-preview-loading")).toHaveCount(0);
  });

  test("PdfPreview surfaces the friendly worker error when the worker rejects a scheduler request (Task #2298)", async ({
    page,
  }) => {
    // Task #2298 — companion to the "scheduler unavailable" test
    // above. That test exercises the path where `getSharedScheduler()`
    // returns `null`; this one exercises the *inverse* failure mode
    // the task brief flagged as uncovered: the consumer dispatches
    // into the scheduler, the worker errors out (e.g. a malformed
    // PDF, an aborted fetch, the worker bundle failing to load), and
    // we have to make sure the user sees the friendly error block —
    // not a silent blank canvas. Without this coverage, a regression
    // that swallowed the worker rejection (PdfPreview's catch handler
    // dropping `setError(...)`, the scheduler resolving on
    // `ok: false`, the worker forgetting to reply on throw, …) would
    // leave the loading spinner gone and the canvas blank — exactly
    // the silent failure the task brief calls out.
    //
    // Synthesising the rejection: we replace `window.Worker` with a
    // tiny stand-in that responds to every scheduler request type
    // (`getDocumentInfo`, `renderPage`, `getPageDims`, …) with
    // `{ ok: false, error, errorName: "InvalidPDFException" }` —
    // exactly the shape `pdfTileWorker` posts back when pdfjs throws
    // `InvalidPDFException`. The scheduler then rejects with
    // `WorkerPdfError`, PdfPreview's catch maps it onto
    // `friendlyForWorkerError`'s "This file is not a valid PDF."
    // copy, and the friendly error block mounts. The `Worker`
    // override runs in `addInitScript` so it's installed before the
    // app bundle evaluates and `getSharedScheduler()` constructs its
    // pool from the stand-in.
    //
    // Why this synthesis (and not `page.route()` to serve garbage
    // bytes): on WebKit, `page.route()` does not reliably intercept
    // fetches initiated from a dedicated worker — the real PDF
    // streamed through, pdfjs rendered it successfully, and the
    // friendly-error assertion never fired. Stubbing `Worker` itself
    // is engine-agnostic and exercises the exact same downstream
    // code path the brief calls out: the scheduler's `onMessage`
    // sees `ok: false`, builds a `WorkerPdfError`, rejects the
    // pending promise, and the consumer maps it to friendly text.
    //
    // What this catches that the existing tests don't:
    //   - Initial-paint canvas + scheduler-counter assertions
    //     (happy-path test) only fire on a successful render — they
    //     would pass if the consumer silently swallowed errors
    //     because the canvas just stays empty.
    //   - Scheduler-unavailable test never dispatches into the
    //     worker pool at all (`getSharedScheduler()` returns null
    //     before any `getDocumentInfo` call), so it can't catch
    //     post-dispatch error-handling regressions.
    test.setTimeout(120_000);

    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    await injectWorkerRejectingScheduler(page);

    await page.goto(
      `${BASE_URL}/projects/${project.code}?tab=plans&documentId=${doc.id}`,
      { waitUntil: "domcontentloaded" },
    );

    // The friendly error block must appear. A regression that
    // swallowed the worker rejection (consumer dropped
    // `setError(...)` in the `catch`, scheduler resolved on
    // `ok: false`, worker forgot to reply on throw, …) would leave
    // this assertion failing because the loading spinner never
    // clears and the error block never mounts.
    const errorBlock = page.getByTestId("pdf-preview-error");
    await expect(errorBlock).toBeVisible({ timeout: 30_000 });

    // The friendly text must come from `friendlyForWorkerError`'s
    // pdfjs-error mapping — specifically the `InvalidPDFException`
    // branch ("This file is not a valid PDF.") that our synthetic
    // worker reply triggers. Asserting the exact branch (rather
    // than a permissive regex) makes the test fail loudly if a
    // future refactor of `friendlyForWorkerError` accidentally
    // routed worker rejections through the generic fallback.
    const detail = page.getByTestId("text-pdf-preview-error-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/not a valid PDF/i);
    // Specifically MUST NOT be the scheduler-unavailable copy — that
    // would mean the worker pool never spun up and we're testing a
    // different code path than intended.
    await expect(detail).not.toContainText(/worker support/i);

    // The blank-canvas regression we're guarding against would leave
    // either the empty canvas mounted (waiting for pixels that never
    // arrive) or the loading spinner spinning forever. Neither
    // should be visible once the friendly error has rendered.
    await expect(page.getByTestId("pdf-preview-canvas")).toHaveCount(0);
    await expect(page.getByTestId("pdf-preview-loading")).toHaveCount(0);

    // Cross-engine proof we exercised the "scheduler dispatched"
    // path: the counter is bumped inside
    // `tileScheduler.getDocumentInfo` before the worker `postMessage`
    // fires, so a non-zero value here proves PdfPreview routed
    // through the worker pool. If the scheduler had short-circuited
    // (returned null, threw before dispatch), the counter would
    // still be 0 and we'd be testing the same path as the test
    // above — not the worker-rejection path this spec is supposed
    // to cover.
    const stats = await readSchedulerStats(page);
    expect(
      stats.getDocumentInfoCalls,
      `expected scheduler.getDocumentInfo to be dispatched at least once before the worker rejected, got ${stats.getDocumentInfoCalls} — wrong code path`,
    ).toBeGreaterThan(0);

    // Working-retry-button assertion. Clicking retry must:
    //   1. Re-dispatch through the scheduler (counter increments).
    //   2. Re-render the friendly error UI cleanly — no stuck
    //      loading spinner, no orphaned blank canvas.
    // The synthetic stand-in keeps rejecting on every request, so
    // retry re-surfaces the same friendly error. That's the
    // user-observable contract we want to lock in: the retry
    // button must produce a clean error each time, never a blank
    // canvas or stuck spinner, even when the underlying document
    // is permanently broken. Asserting the dispatch counter
    // increments is what proves the button is wired to the actual
    // loader (not a no-op stub).
    await resetSchedulerStats(page);

    await page.getByTestId("button-pdf-retry").click();

    // The error block momentarily unmounts during the retry's
    // loading window before re-rendering with the same error. Poll
    // the scheduler counter so the assertion doesn't race the brief
    // "loading -> error" transition.
    await expect
      .poll(async () => (await readSchedulerStats(page)).getDocumentInfoCalls, {
        timeout: 30_000,
        message:
          "Retry button click did not trigger a new scheduler.getDocumentInfo dispatch — the retry button is not wired to the loader",
      })
      .toBeGreaterThan(0);

    // After retry settles, the friendly error block must be back
    // (not the loading spinner stuck forever, not a blank canvas).
    await expect(page.getByTestId("pdf-preview-error")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("pdf-preview-canvas")).toHaveCount(0);
    await expect(page.getByTestId("pdf-preview-loading")).toHaveCount(0);
  });

  test("PlanDocumentPrintPage shows the friendly worker-unavailable error and still flips __PLAN_PDF_READY", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now();
    await devLogin(page, "ADMIN");

    const project = await createProject(page, suffix);
    const doc = await createPlanDocument(page, project.id, suffix);

    await disableWorkerSupport(page);

    await page.goto(`${BASE_URL}/print/plan-documents/${doc.id}`, {
      waitUntil: "domcontentloaded",
    });

    // The headless capture watches `window.__PLAN_PDF_READY` to know
    // when to grab the page. Even on the error path it MUST flip
    // true (alongside `__PLAN_PDF_ERROR`), otherwise the export job
    // would hang until its outer timeout. This is the contract the
    // export endpoint relies on, so it gets its own assertion.
    await page.waitForFunction(
      () =>
        (window as unknown as { __PLAN_PDF_READY?: boolean }).__PLAN_PDF_READY ===
        true,
      undefined,
      { timeout: 60_000 },
    );

    const errorMsg = await page.evaluate(
      () =>
        (window as unknown as { __PLAN_PDF_ERROR?: string }).__PLAN_PDF_ERROR ??
        null,
    );
    expect(errorMsg, "scheduler-unavailable branch did not set __PLAN_PDF_ERROR")
      .toMatch(/off-thread PDF rendering/i);

    // Visible UI also surfaces the same friendly error so a developer
    // who opens the print URL in a regular tab sees what's wrong.
    await expect(page.getByText("Plan PDF export error")).toBeVisible();
    await expect(page.getByText(/off-thread PDF rendering/i)).toBeVisible();

    // The render container must NOT contain any rasterised pages — a
    // regression that snuck a main-thread fallback in would leave at
    // least one `.plan-pdf-page` div behind.
    await expect(
      page
        .getByTestId("plan-pdf-print-root")
        .locator(".plan-pdf-page"),
    ).toHaveCount(0);
  });
});
