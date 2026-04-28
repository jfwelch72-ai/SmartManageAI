import { test, expect, type Page } from "@playwright/test";
import { installCsrf, authedRequest } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #2138 — Tile renderer + worker pipeline perf harness.
//
// What this spec is FOR:
//   • Catch any regression that re-introduces the legacy synchronous
//     full-page rasterization path on the main thread when the
//     `takeoff_tile_renderer` flag is on.
//   • Enforce a published p95 frame-time budget during pan/zoom on a
//     large planset so 300+ sheet civil PDFs stay smooth.
//   • Enforce a published sheet-switch latency budget so swapping
//     between sheets doesn't freeze the workspace.
//   • Smoke-cover the `takeoff_tile_renderer` feature flag itself —
//     the legacy fallback must still load and display a placeholder
//     when the flag is forced off.
//
// What this spec is NOT for:
//   • Pixel-perfect rendering checks (covered by render-correctness
//     specs) or markup math (covered by takeoff-markup-* specs).
//
// Budget rationale:
//   • > 30 fps target → p95 main-thread frame interval < 33 ms.
//   • Sheet switch budget < 250 ms median is loose enough to survive
//     a cold worker boot but tight enough to fail if we accidentally
//     fall back to a synchronous full-page render.
//   • CI envs are slower than dev hardware, so budgets get an extra
//     headroom factor (`CI_PERF_HEADROOM`) when CI=true.
//
// All numeric budgets live in one block at the top of this file so
// future tuning is easy and obvious.

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const SHEET_COUNT = 8; // enough sheets to exercise the LRU + switch path
const PAN_FRAMES = 30;
const ZOOM_FRAMES = 16;

const CI_PERF_HEADROOM = process.env.CI ? 2.0 : 1.0;
const FRAME_P95_BUDGET_MS = 33 * CI_PERF_HEADROOM;
const SHEET_SWITCH_BUDGET_MS = 250 * CI_PERF_HEADROOM;
const LONG_TASK_BUDGET_MS = 100 * CI_PERF_HEADROOM;

interface BidResponse {
  id: string;
  code: string;
  name: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  bidId: string | null;
  sheetIndex: number;
}

async function devLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status()).toBe(200);
}

async function createBid(page: Page, name: string): Promise<BidResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/bids`, {
    data: {
      name,
      clientName: "PW Tile Renderer Perf",
      bidAmount: "75000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

async function uploadBidSheet(
  page: Page,
  bidId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, {
    baseUrl: BASE_URL,
    label: fileName,
  });
  const planRes = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.objectKey,
        objectKey: upload.objectKey,
        fileName,
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  expect(planBody.sheets.length).toBeGreaterThan(0);
  return planBody.sheets[0];
}

/** Force the renderer flag *before* the workspace bundle evaluates. */
async function setTileRendererFlag(
  page: Page,
  enabled: boolean,
): Promise<void> {
  await page.addInitScript((on: boolean) => {
    try {
      (window as unknown as { __TAKEOFF_TILE_RENDERER__?: boolean }).__TAKEOFF_TILE_RENDERER__ =
        on;
      window.localStorage.setItem(
        "takeoff_tile_renderer",
        on ? "on" : "off",
      );
    } catch {
      /* private mode or storage disabled — noop */
    }
  }, enabled);
}

/** Sample frame intervals via requestAnimationFrame for `frames` ticks. */
async function sampleFrameIntervals(
  page: Page,
  frames: number,
): Promise<number[]> {
  return await page.evaluate(async (n: number) => {
    const samples: number[] = [];
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          const now = performance.now();
          samples.push(now - last);
          last = now;
          resolve();
        }),
      );
    }
    return samples;
  }, frames);
}

/** Count main-thread long tasks (>50ms by default; budget asserted separately). */
async function startLongTaskRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
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
      /* longtask unsupported in this browser — leave samples empty */
    }
  });
}

async function readLongTasks(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const w = window as unknown as { __longTasks?: number[] };
    return [...(w.__longTasks ?? [])];
  });
}

function p95(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
  return sorted[idx];
}

function median(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

test.describe("Task #2138 — Tile renderer perf harness", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page);
  });

  test("pan/zoom holds the frame budget and sheet switches stay snappy with the tile renderer ON", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTileRendererFlag(page, true);

    const suffix = Date.now();
    const bid = await createBid(page, `PW Tile Perf On ${suffix}`);
    const sheets: SheetResponse[] = [];
    for (let i = 0; i < SHEET_COUNT; i++) {
      sheets.push(
        await uploadBidSheet(page, bid.id, `PW Tile Perf Sheet ${suffix} ${i + 1}`),
      );
    }

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the first sheet's tabs bar to mount, signaling that the
    // workspace finished its initial load and pageDims is set.
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });

    await startLongTaskRecorder(page);
    // Discard the first few frames; cold-start is not part of steady-state.
    await sampleFrameIntervals(page, 10);

    // ---- Pan: simulate a long horizontal drag across the canvas ----
    const stage = page.locator(".konvajs-content canvas").first();
    await expect(stage).toBeVisible({ timeout: 15_000 });
    const box = await stage.boundingBox();
    if (!box) throw new Error("Canvas bounding box not available");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    const panFrames: number[] = [];
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: "middle" }); // pan tool uses middle/space drag
    for (let i = 0; i < PAN_FRAMES; i++) {
      await page.mouse.move(cx - i * 12, cy - i * 6, { steps: 1 });
      const [dt] = await sampleFrameIntervals(page, 1);
      panFrames.push(dt);
    }
    await page.mouse.up({ button: "middle" });

    // ---- Zoom: synthesize wheel events at the canvas center ----
    const zoomFrames: number[] = [];
    for (let i = 0; i < ZOOM_FRAMES; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
      const [dt] = await sampleFrameIntervals(page, 1);
      zoomFrames.push(dt);
    }

    const panP95 = p95(panFrames);
    const zoomP95 = p95(zoomFrames);
    expect(
      panP95,
      `pan p95 frame interval ${panP95.toFixed(2)}ms exceeded ${FRAME_P95_BUDGET_MS}ms budget`,
    ).toBeLessThan(FRAME_P95_BUDGET_MS);
    expect(
      zoomP95,
      `zoom p95 frame interval ${zoomP95.toFixed(2)}ms exceeded ${FRAME_P95_BUDGET_MS}ms budget`,
    ).toBeLessThan(FRAME_P95_BUDGET_MS);

    // ---- Sheet switching: time each click to the next sheet tab ----
    const switchTimes: number[] = [];
    for (let i = 1; i < Math.min(SHEET_COUNT, 5); i++) {
      const tab = page.getByTestId(`tab-sheet-${sheets[i].id}`);
      await expect(tab).toBeVisible();
      const start = Date.now();
      await tab.click();
      // The placeholder bitmap arrives asynchronously from the worker;
      // we wait for the next two animation frames so the canvas has had
      // a chance to repaint with the new sheet.
      await page.evaluate(
        () =>
          new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r())),
          ),
      );
      switchTimes.push(Date.now() - start);
    }

    const switchMedian = median(switchTimes);
    expect(
      switchMedian,
      `sheet switch median ${switchMedian.toFixed(0)}ms exceeded ${SHEET_SWITCH_BUDGET_MS}ms budget`,
    ).toBeLessThan(SHEET_SWITCH_BUDGET_MS);

    // ---- Long-task ceiling: pdfjs must stay off the main thread ----
    const longTasks = await readLongTasks(page);
    const worst = longTasks.reduce((a, b) => Math.max(a, b), 0);
    expect(
      worst,
      `worst main-thread long task ${worst.toFixed(0)}ms exceeded ${LONG_TASK_BUDGET_MS}ms budget — pdfjs may be running on the main thread`,
    ).toBeLessThan(LONG_TASK_BUDGET_MS);
  });

  test("escape-hatch fallback still paints the sheet when the tile renderer feature flag is OFF", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setTileRendererFlag(page, false);

    const suffix = Date.now();
    const bid = await createBid(page, `PW Tile Perf Off ${suffix}`);
    await uploadBidSheet(page, bid.id, `PW Tile Perf Off Sheet ${suffix}`);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });
    const stage = page.locator(".konvajs-content canvas").first();
    await expect(stage).toBeVisible({ timeout: 15_000 });

    const flag = await page.evaluate(() => ({
      window: (window as unknown as { __TAKEOFF_TILE_RENDERER__?: boolean })
        .__TAKEOFF_TILE_RENDERER__,
      storage: window.localStorage.getItem("takeoff_tile_renderer"),
    }));
    expect(flag.window).toBe(false);
    expect(flag.storage).toBe("off");

    // Smoke-check the escape hatch actually paints: poll the first
    // Konva canvas until it contains non-blank pixels. Without a real
    // fallback render path this would stay transparent and the test
    // would fail well before the 30s budget. We sample the centre of
    // the canvas because Konva clears outside the page area.
    await expect
      .poll(
        async () =>
          await stage.evaluate((el: HTMLCanvasElement) => {
            const ctx = el.getContext("2d");
            if (!ctx || el.width === 0 || el.height === 0) return 0;
            const cx = Math.floor(el.width / 2);
            const cy = Math.floor(el.height / 2);
            const r = 8;
            const data = ctx.getImageData(cx - r, cy - r, r * 2, r * 2).data;
            let nonBlank = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] !== 0) nonBlank++;
            }
            return nonBlank;
          }),
        {
          timeout: 30_000,
          message:
            "fallback canvas never painted any pixels — the escape hatch is broken",
        },
      )
      .toBeGreaterThan(0);
  });
});
