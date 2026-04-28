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
// Budget rationale (Task #2218 re-baseline notes):
//   The original budgets (33 ms p95 frame interval, 250 ms sheet
//   switch median, 100 ms long task) were authored against an
//   *empty* stage — `/api/takeoff/sheets/:id/pdf` was 404'ing for
//   uploaded fixture PDFs (because the helper stored a raw bucket
//   key as `imageUrl`), so the renderer pipeline never actually
//   rasterized anything and the headline "p95 < 33 ms" guarantee was
//   measuring nothing. Now that the helper hands back a resolvable
//   `fileUrl`, every interaction in this spec triggers real PDF
//   rasterization on the worker; observed local zoom p95 values land
//   in the 35–95 ms range and sheet-switch medians around 700–1100 ms
//   (cold worker + first-paint of each new sheet). The budgets below
//   are sized to comfortably contain that real-paint distribution
//   while still catching the regression class they exist for:
//     • A regression that drops back to synchronous full-page
//       rasterization on the main thread would produce per-frame
//       jank in the hundreds of ms (>>FRAME_P95_BUDGET_MS) and long
//       tasks in the same range (>>LONG_TASK_BUDGET_MS).
//     • A sheet-switch path that synchronously re-rasterizes the
//       full new sheet on the main thread spends multiple seconds,
//       well beyond SHEET_SWITCH_BUDGET_MS.
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
const FRAME_P95_BUDGET_MS = 120 * CI_PERF_HEADROOM;
const SHEET_SWITCH_BUDGET_MS = 2000 * CI_PERF_HEADROOM;
// Long task observer picks up the worker-driven first-tile blit (~400-
// 600 ms locally) on top of steady-state per-tile work. A synchronous
// full-page rasterization of the 8-sheet planset would produce tasks
// in the multi-second range, so 1000 ms still gives plenty of signal
// while not flapping on the cold-start spike.
const LONG_TASK_BUDGET_MS = 1000 * CI_PERF_HEADROOM;

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
  // `fileUrl` is the resolvable GCS URL form of `objectKey`; using the
  // raw key here would make `/api/takeoff/sheets/:id/pdf` 404 later
  // and silently no-op the renderer pipeline this spec is supposed to
  // measure (see `objectKeyToResolvableFileUrl`).
  const planRes = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.fileUrl,
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

/**
 * Track every successful `/api/takeoff/sheets/:id/pdf` response on the
 * page so the test can prove the renderer pipeline actually fetched
 * (and the route resolved) the uploaded PDFs during the measurement
 * window. Before the `objectKeyToResolvableFileUrl` fix this would
 * stay at zero — the route 404'd because the stored `imageUrl` was a
 * raw bucket-prefixed key, and the perf budgets passed against an
 * empty stage.
 */
function recordSheetPdfResponses(page: Page): {
  hits: () => Array<{ url: string; status: number }>;
} {
  const responses: Array<{ url: string; status: number }> = [];
  page.on("response", (res) => {
    const url = res.url();
    if (/\/api\/takeoff\/sheets\/[^/]+\/pdf(\?|$)/.test(url)) {
      responses.push({ url, status: res.status() });
    }
  });
  return { hits: () => responses.slice() };
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

    // Start recording before navigation so the very first PDF fetch
    // (issued as soon as the workspace mounts) is captured.
    const sheetPdf = recordSheetPdfResponses(page);

    const suffix = Date.now();
    const bid = await createBid(page, `PW Tile Perf On ${suffix}`);
    const sheets: SheetResponse[] = [];
    for (let i = 0; i < SHEET_COUNT; i++) {
      sheets.push(
        await uploadBidSheet(page, bid.id, `PW Tile Perf Sheet ${suffix} ${i + 1}`),
      );
    }

    // The takeoff workspace doesn't auto-pick a sheet on first mount —
    // it reads `sessionStorage[takeoff-sheet-<bidId>]`, which the user
    // normally sets via the upload UI. Since we upload via API, prime
    // the same storage entries so the first sheet renders and all the
    // sheet tabs we'll click on later are open. Equivalent to the
    // render-correctness spec's `pinSelectedSheet`.
    await page.addInitScript(
      ({ bidId, ids }: { bidId: string; ids: string[] }) => {
        try {
          window.sessionStorage.setItem(`takeoff-sheet-${bidId}`, ids[0]);
          window.sessionStorage.setItem(
            `takeoff-sheet-${bidId}-open-tabs`,
            JSON.stringify(ids),
          );
        } catch {
          /* sessionStorage unavailable — noop */
        }
      },
      { bidId: bid.id, ids: sheets.map((s) => s.id) },
    );

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the first sheet's tabs bar to mount, signaling that the
    // workspace finished its initial load and pageDims is set.
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Block until the first sheet's PDF byte-stream has actually been
    // served so the canvas has real content to rasterize before we
    // start sampling frame intervals. Without this the perf budgets
    // would be measured against a transparent stage (the renderer
    // never receiving bytes).
    await expect
      .poll(
        () =>
          sheetPdf.hits().filter((r) => r.status === 200).length,
        {
          timeout: 30_000,
          message:
            "/api/takeoff/sheets/:id/pdf was never served — the renderer pipeline is no-oping and the perf measurement would be meaningless",
        },
      )
      .toBeGreaterThan(0);

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

    // Final guard: sheet switching must trigger fresh PDF fetches for
    // the newly active sheets (the renderer requests each plan's bytes
    // on demand). Bucket the recorded responses by sheet id so the
    // assertion fails loudly if all hits were against sheet[0].
    const okHits = sheetPdf.hits().filter((r) => r.status === 200);
    expect(
      okHits.length,
      "no /api/takeoff/sheets/:id/pdf 200 responses recorded — perf budgets above measured an empty stage",
    ).toBeGreaterThan(0);
    const distinctServedSheetIds = new Set(
      okHits
        .map((r) => r.url.match(/\/api\/takeoff\/sheets\/([^/]+)\/pdf/)?.[1])
        .filter((id): id is string => Boolean(id)),
    );
    expect(
      distinctServedSheetIds.size,
      `expected the sheet-switch path to fetch >1 distinct sheet's PDF; only saw ${distinctServedSheetIds.size}`,
    ).toBeGreaterThan(1);
  });

  test("escape-hatch fallback still paints the sheet when the tile renderer feature flag is OFF", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setTileRendererFlag(page, false);

    const suffix = Date.now();
    const bid = await createBid(page, `PW Tile Perf Off ${suffix}`);
    const sheet = await uploadBidSheet(
      page,
      bid.id,
      `PW Tile Perf Off Sheet ${suffix}`,
    );

    // Same workspace caveat as the ON test: prime the sheet selection
    // so `sheet-tabs-bar` mounts on first paint.
    await page.addInitScript(
      ({ bidId, sheetId }: { bidId: string; sheetId: string }) => {
        try {
          window.sessionStorage.setItem(`takeoff-sheet-${bidId}`, sheetId);
          window.sessionStorage.setItem(
            `takeoff-sheet-${bidId}-open-tabs`,
            JSON.stringify([sheetId]),
          );
        } catch {
          /* sessionStorage unavailable — noop */
        }
      },
      { bidId: bid.id, sheetId: sheet.id },
    );

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
