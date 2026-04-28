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
      /* longtask unsupported in this browser — leave samples empty so
         the assertion below still runs but only fails on real
         regressions captured by the engines that do support it
         (Chromium). */
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

async function readLongTasks(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const w = window as unknown as { __longTasks?: number[] };
    return [...(w.__longTasks ?? [])];
  });
}

test.use({ viewport: { width: 1600, height: 1000 }, video: "off" });

test.describe("Task #2213 — Worker-only PDF preview path", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("plan-document preview canvas paints non-blank pixels and stays off the main thread", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const suffix = Date.now();
    // Install the long-task observer BEFORE navigation so we capture
    // the cold-start paint window — that's where a regression to a
    // synchronous main-thread `pdfjs` would show up.
    await installLongTaskRecorder(page);
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
    // calls out.
    await resetLongTaskRecorder(page);

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

    // Initial-paint long-task ceiling: pdfjs MUST stay off the main
    // thread during the open-document-to-first-paint window. With the
    // worker pipeline, a full-page render dispatches off the main
    // thread; a regression that re-introduced
    // `pdfjs.getDocument(...).promise.then(p => p.render(...))` on the
    // main thread would trip a >100 ms long task during this window.
    const initialPaintTasks = await readLongTasks(page);
    const worstInitialPaint = initialPaintTasks.reduce(
      (a, b) => Math.max(a, b),
      0,
    );
    expect(
      worstInitialPaint,
      `worst main-thread long task during initial paint ${worstInitialPaint.toFixed(0)}ms exceeded ${LONG_TASK_BUDGET_MS}ms — pdfjs may be back on the main thread`,
    ).toBeLessThan(LONG_TASK_BUDGET_MS);

    // Additional guard: also verify a fresh re-render through the
    // worker (triggered via zoom-in) stays off the main thread. The
    // initial-paint assertion above is the primary contract; this
    // second check catches regressions that only show up on subsequent
    // renders (e.g. cache-miss paths or tile-scheduler fallbacks).
    const baseline = await sampleCanvas();
    await resetLongTaskRecorder(page);

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

    const zoomTasks = await readLongTasks(page);
    const worstZoom = zoomTasks.reduce((a, b) => Math.max(a, b), 0);
    expect(
      worstZoom,
      `worst main-thread long task during zoom re-render ${worstZoom.toFixed(0)}ms exceeded ${LONG_TASK_BUDGET_MS}ms — pdfjs may be back on the main thread`,
    ).toBeLessThan(LONG_TASK_BUDGET_MS);
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
