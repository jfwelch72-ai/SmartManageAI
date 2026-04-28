import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { installCsrf, authedRequest } from "./helpers/csrf";

// Task #2189 — Tile renderer + worker pipeline render-correctness gate.
//
// What this spec is FOR:
//   • Pixel-baseline coverage so a regression that swaps tile (x, y)
//     coordinates, returns blank ImageBitmaps, mis-clips the page,
//     or routes the wrong sheet's bitmap onto the canvas can no
//     longer slip through CI.
//   • Coverage of both the supported zoom buckets the user spends
//     real time in (1× and 2×) and the sheet-switch path that swaps
//     the active document inside the worker.
//   • Coverage of the legacy fallback render path with the
//     `takeoff_tile_renderer` flag forced OFF — so the escape hatch
//     that the perf harness only smoke-tests (any non-blank pixel
//     wins) actually paints the right pixels in the right places.
//
// What this spec is NOT for:
//   • Frame-rate budgets (covered by `takeoff-tile-renderer-perf.spec.ts`).
//   • Markup math, calibration, or interaction logic.
//
// Determinism notes:
//   • The fixture PDF is generated in-test from a fixed set of
//     pdf-lib drawing commands (no fonts, no text, only filled
//     rectangles + stroked lines). pdf-lib emits byte-identical
//     PDFs for a fixed input, and pdf.js + Chromium 2D canvas are
//     deterministic for a fixed input + viewport, so the rendered
//     pixels are stable across runs on the same browser revision.
//   • We pin the Playwright viewport so the Konva stage is always
//     the same screen size — without this the canvas dimensions
//     would shift with the host's default browser viewport and the
//     baselines would never match.
//   • We restrict to chromium because visual baselines are inherently
//     engine-specific (firefox/webkit rasterize PDFs differently).
//   • A small `maxDiffPixelRatio` tolerance absorbs the few pixels
//     of font/AA jitter that can vary across Chromium minor versions
//     while still catching a coordinate swap (which would shift
//     entire tile-sized blocks of pixels) or a blank-tile regression
//     (which would zero-out big regions of the canvas).
//
// Baseline regeneration:
//   To bootstrap or refresh the baselines after an intentional
//   visual change:
//     npx playwright test --project=chromium \
//       --update-snapshots e2e/takeoff-tile-renderer-render.spec.ts
//   The PNGs are written to
//   `e2e/takeoff-tile-renderer-render.spec.ts-snapshots/` and must
//   be committed alongside the spec.

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const SHEET_COUNT = 2;
// pdf-lib default page size; small enough to keep the fixture cheap
// but big enough at BASE_RENDER_SCALE (1.5×) to produce a 2-tile-wide
// grid at zoom bucket 1 (TILE_SIZE_PX = 512). Without that the test
// would never exercise the (tileX, tileY) → bitmap fan-out the
// regression class lives in.
const PAGE_W = 612;
const PAGE_H = 792;

const SCREENSHOT_OPTS = {
  // Catches any meaningful regression (a single tile is ~7% of the
  // captured area at zoom bucket 1), but tolerates the handful of
  // AA pixels Chromium's PDF rasterizer can vary across patch
  // releases.
  maxDiffPixelRatio: 0.02,
  threshold: 0.2,
  animations: "disabled" as const,
  caret: "hide" as const,
};

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
      clientName: "PW Tile Renderer Render",
      bidAmount: "75000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

/**
 * Build a tiny, deterministic PDF whose visual content is rich enough
 * that swapping any pair of tiles or losing a tile produces a large
 * pixel diff. Per-sheet `seed` flips the corner-marker layout so the
 * sheet-switch test can prove the worker actually re-rasterized the
 * new document instead of re-displaying the previous one's tiles.
 *
 * Implementation notes:
 *   • Use `addPage()` (no arg) + `setSize` instead of `addPage([w,h])`.
 *     pdf-lib validates the dimensions argument with `instanceof Array`
 *     against its own intrinsic, so a literal `[w,h]` produced in the
 *     test runtime gets rejected as `NaN` when the bundles end up in
 *     different realms (e.g. the playwright spec ESM vs the pdf-lib
 *     CJS bundle). `setSize` takes plain numbers and sidesteps it.
 *   • Embed a Helvetica-rendered label so pdf.js always loads at
 *     least one font — without that, some pdf.js codepaths silently
 *     produce an empty raster (the scenario our previous fixture
 *     hit, where the canvas stayed transparent).
 */
async function buildFixturePdf(seed: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.setSize(PAGE_W, PAGE_H);

  // Solid background so any blank tile shows up as bright white in the
  // diff (pdf.js fills uncovered pixels white, the background is gray).
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: rgb(0.93, 0.95, 0.98),
  });

  // 4×5 grid of distinctly-colored rectangles. Each cell is ~127×148pt
  // which spans multiple tiles at zoom bucket 2, so a tile-coord swap
  // smears multiple grid cells visibly across the canvas.
  const cols = 4;
  const rows = 5;
  const cw = PAGE_W / cols;
  const ch = PAGE_H / rows;
  const palette: Array<[number, number, number]> = [
    [0.95, 0.27, 0.27],
    [0.95, 0.65, 0.18],
    [0.95, 0.85, 0.24],
    [0.31, 0.78, 0.47],
    [0.27, 0.6, 0.95],
    [0.55, 0.36, 0.96],
    [0.93, 0.34, 0.69],
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = (r * cols + c + seed) % 7;
      const [pr, pg, pb] = palette[idx];
      page.drawRectangle({
        x: c * cw + 6,
        y: r * ch + 6,
        width: cw - 12,
        height: ch - 12,
        color: rgb(pr, pg, pb),
        borderColor: rgb(0.1, 0.1, 0.1),
        borderWidth: 1.25,
      });
    }
  }

  // Diagonals so a horizontal/vertical coord swap is visually obvious.
  page.drawLine({
    start: { x: 0, y: 0 },
    end: { x: PAGE_W, y: PAGE_H },
    color: rgb(0, 0, 0),
    thickness: 2,
  });
  page.drawLine({
    start: { x: 0, y: PAGE_H },
    end: { x: PAGE_W, y: 0 },
    color: rgb(0, 0, 0),
    thickness: 2,
  });

  // Per-sheet corner marker — a different shape per sheet so sheet-
  // switch regressions (worker returning the prior sheet's tiles)
  // light up the diff. Drawn last so it sits on top of the grid.
  const cornerSize = 40;
  const cx = seed % 2 === 0 ? 12 : PAGE_W - cornerSize - 12;
  const cy = seed % 2 === 0 ? PAGE_H - cornerSize - 12 : 12;
  page.drawRectangle({
    x: cx,
    y: cy,
    width: cornerSize,
    height: cornerSize,
    color: rgb(0, 0, 0),
  });

  // Big seed-tagged title in the centre so the sheet-switch test
  // doesn't need to rely on the corner marker alone — and, more
  // importantly, so pdf-lib actually embeds a font (see header note).
  page.drawText(`PW Render Sheet ${seed + 1}`, {
    x: PAGE_W / 2 - 110,
    y: PAGE_H / 2 - 12,
    size: 28,
    font,
    color: rgb(0, 0, 0),
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function uploadDeterministicSheet(
  page: Page,
  bidId: string,
  fileName: string,
  seed: number,
): Promise<SheetResponse> {
  const pdf = await buildFixturePdf(seed);
  const intentRes = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/objects/upload`,
    {
      data: {
        contentType: "application/pdf",
        fileSize: pdf.length,
        fileType: "DOCUMENT",
      },
    },
  );
  expect(intentRes.status()).toBe(200);
  const { uploadURL, objectKey } = (await intentRes.json()) as {
    uploadURL?: string;
    objectKey?: string;
  };
  if (!uploadURL || !objectKey) {
    throw new Error("Upload intent response missing uploadURL / objectKey");
  }
  const putRes = await page.request.put(uploadURL, {
    data: pdf,
    headers: { "Content-Type": "application/pdf" },
  });
  const status = putRes.status();
  if (status !== 200 && status !== 201 && status !== 204) {
    throw new Error(`Presigned PUT failed (${status}): ${await putRes.text()}`);
  }

  // `/api/objects/upload` hands back a raw bucket-prefixed key like
  // `/replit-objstore-XXX/<orgId>/uploads/<uuid>`. The takeoff plan
  // route stores `imageUrl` verbatim, but `/api/takeoff/sheets/:id/pdf`
  // → `resolveGcsFile()` only knows how to look up
  //   • `/objects/...` paths, and
  //   • `https://storage.googleapis.com/...` URLs.
  // Wrapping the raw key in the GCS URL form is the cheapest way to
  // make the resolver happy without leaking the privateObjectDir into
  // the test, and it's the same shape that older upload flows used to
  // hand back to clients before the `/objects/...` short-form existed.
  const fileUrl = objectKey.startsWith("/")
    ? `https://storage.googleapis.com${objectKey}`
    : `https://storage.googleapis.com/${objectKey}`;

  const planRes = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: {
        fileUrl,
        objectKey,
        fileName,
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  expect(planBody.sheets.length).toBeGreaterThan(0);
  return planBody.sheets[0];
}

async function setTileRendererFlag(page: Page, enabled: boolean): Promise<void> {
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

/**
 * The takeoff workspace doesn't auto-pick a sheet on first mount —
 * it reads `sessionStorage[takeoff-sheet-<bidId>]`. The user normally
 * sets that by going through the upload flow (which calls
 * `setSelectedSheet(data.sheets[0].id)` after success); since we
 * upload via the API, no UI runs. Inject the same storage entry
 * before navigation so the workspace selects the first sheet on the
 * first render and `sheet-tabs-bar` mounts.
 */
async function pinSelectedSheet(
  page: Page,
  bidId: string,
  sheetId: string,
): Promise<void> {
  await page.addInitScript(
    ({ bidId: b, sheetId: s }: { bidId: string; sheetId: string }) => {
      try {
        window.sessionStorage.setItem(`takeoff-sheet-${b}`, s);
        window.sessionStorage.setItem(
          `takeoff-sheet-${b}-open-tabs`,
          JSON.stringify([s]),
        );
      } catch {
        /* sessionStorage unavailable — noop */
      }
    },
    { bidId, sheetId },
  );
}

/**
 * Wait for the active sheet's canvas to be painted with non-blank
 * pixels (i.e. tile / placeholder bitmaps have arrived from the
 * worker). Avoids relying on internal state by sampling the actual
 * canvas — same approach the perf spec's fallback test uses. Returns
 * once the centre region contains opaque pixels.
 */
async function waitForCanvasPainted(page: Page): Promise<void> {
  const stage = page.locator(".konvajs-content canvas").first();
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        await stage.evaluate((el: HTMLCanvasElement) => {
          const ctx = el.getContext("2d");
          if (!ctx || el.width === 0 || el.height === 0) return 0;
          const cx = Math.floor(el.width / 2);
          const cy = Math.floor(el.height / 2);
          const r = 16;
          const data = ctx.getImageData(cx - r, cy - r, r * 2, r * 2).data;
          let nonBlank = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] !== 0) nonBlank++;
          }
          return nonBlank;
        }),
      {
        timeout: 30_000,
        message: "canvas never painted any pixels",
      },
    )
    .toBeGreaterThan(0);
}

/**
 * Konva renders to a stack of <canvas> elements inside
 * `.konvajs-content`; capture all of them by screenshotting the
 * containing element. `toHaveScreenshot` automatically retries until
 * two consecutive frames match, which lets in-flight tile bitmaps
 * settle without a brittle sleep.
 */
async function expectStageScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  const stageContainer = page.locator(".konvajs-content").first();
  await expect(stageContainer).toBeVisible();
  await expect(stageContainer).toHaveScreenshot(name, SCREENSHOT_OPTS);
}

/**
 * Drive a deterministic zoom-in. The takeoff page is mounted with
 * `unifiedRibbon` so the legacy toolbar's `button-zoom-in` /
 * `button-zoom-reset` buttons aren't in the DOM; the only canvas-side
 * zoom path is the Konva wheel handler in `use-takeoff-interactions`,
 * which multiplies stageScale by 1.1 per upward wheel tick. Sending
 * the wheel events at the canvas centre keeps the zoomed-into point
 * stable across runs (the handler re-anchors stagePosition around the
 * pointer), so the captured frame is bit-identical between runs.
 */
async function zoomCanvasIn(page: Page, ticks: number): Promise<void> {
  const stage = page.locator(".konvajs-content canvas").first();
  await expect(stage).toBeVisible();
  const box = await stage.boundingBox();
  if (!box) throw new Error("Canvas bounding box not available for wheel zoom");
  const cx = Math.floor(box.x + box.width / 2);
  const cy = Math.floor(box.y + box.height / 2);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < ticks; i++) {
    // negative deltaY = wheel up = zoom in (handler reads `e.evt.deltaY > 0`
    // for zoom-out). 120 matches a single physical mouse-wheel notch so
    // each iteration produces exactly one stageScale step.
    await page.mouse.wheel(0, -120);
  }
}

test.describe("Task #2189 — Tile renderer render-correctness gate", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page, browserName }) => {
    // Visual baselines are produced by Chromium's specific PDF + 2D
    // canvas rasterizers; firefox / webkit will never match them.
    test.skip(
      browserName !== "chromium",
      "Visual baselines are chromium-specific; skipping non-chromium engines.",
    );
    await installCsrf(page);
    await devLogin(page);
  });

  test("tile renderer paints zoom bucket 1 the same way every run", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTileRendererFlag(page, true);

    const bid = await createBid(page, `PW Render Bucket1 ${Date.now()}`);
    const sheets: SheetResponse[] = [];
    for (let i = 0; i < SHEET_COUNT; i++) {
      sheets.push(
        await uploadDeterministicSheet(
          page,
          bid.id,
          `PW Render Sheet ${i + 1}.pdf`,
          i,
        ),
      );
    }
    await pinSelectedSheet(page, bid.id, sheets[0].id);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });
    // No zoom interaction — bucket 1 captures the workspace at its
    // initial post-mount stage scale (the auto-fit zoom-to-page state),
    // which is deterministic given the pinned 1280×800 viewport and
    // the fixed-size fixture PDF.
    await waitForCanvasPainted(page);

    await expectStageScreenshot(page, "tile-renderer-zoom-bucket-1.png");
  });

  test("tile renderer paints zoom bucket 2 the same way every run", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTileRendererFlag(page, true);

    const bid = await createBid(page, `PW Render Bucket2 ${Date.now()}`);
    const sheets: SheetResponse[] = [];
    for (let i = 0; i < SHEET_COUNT; i++) {
      sheets.push(
        await uploadDeterministicSheet(
          page,
          bid.id,
          `PW Render Sheet ${i + 1}.pdf`,
          i,
        ),
      );
    }
    await pinSelectedSheet(page, bid.id, sheets[0].id);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });
    await waitForCanvasPainted(page);
    // Wheel-zoom multiplies stageScale by 1.1 per tick. Three ticks
    // (≈1.331×) lands stageScale firmly above the bucket-1 / bucket-2
    // threshold so the worker switches to the higher LOD tier and we
    // exercise the *other* tile resolution. The auto-fit baseline scale
    // (computed from the viewport / pageDims ratio) is deterministic,
    // so adding a fixed multiple to it is also deterministic.
    await zoomCanvasIn(page, 3);
    await waitForCanvasPainted(page);

    await expectStageScreenshot(page, "tile-renderer-zoom-bucket-2.png");
  });

  test("tile renderer paints the right pixels after switching sheets", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTileRendererFlag(page, true);

    const bid = await createBid(page, `PW Render Switch ${Date.now()}`);
    const sheets: SheetResponse[] = [];
    for (let i = 0; i < SHEET_COUNT; i++) {
      sheets.push(
        await uploadDeterministicSheet(
          page,
          bid.id,
          `PW Render Sheet ${i + 1}.pdf`,
          i,
        ),
      );
    }
    // Pin sheet[0] AND keep both tabs open so the second tab is
    // immediately clickable after navigation.
    await page.addInitScript(
      ({ bidId, ids }: { bidId: string; ids: string[] }) => {
        try {
          window.sessionStorage.setItem(`takeoff-sheet-${bidId}`, ids[0]);
          window.sessionStorage.setItem(
            `takeoff-sheet-${bidId}-open-tabs`,
            JSON.stringify(ids),
          );
        } catch {
          /* noop */
        }
      },
      { bidId: bid.id, ids: sheets.map((s) => s.id) },
    );

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });
    await waitForCanvasPainted(page);

    // Click the second sheet's tab. Its corner marker sits on the
    // opposite corner from sheet 1 (see `buildFixturePdf` seed math),
    // so a stale-bitmap regression where the worker keeps serving
    // sheet-1 tiles after the switch would diff against this baseline.
    await page.getByTestId(`tab-sheet-${sheets[1].id}`).click();
    await waitForCanvasPainted(page);

    await expectStageScreenshot(page, "tile-renderer-sheet-switch.png");
  });

  test("legacy fallback paints the same pixels with the tile renderer flag OFF", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await setTileRendererFlag(page, false);

    const bid = await createBid(page, `PW Render Fallback ${Date.now()}`);
    const sheet = await uploadDeterministicSheet(
      page,
      bid.id,
      "PW Render Sheet 1.pdf",
      0,
    );
    await pinSelectedSheet(page, bid.id, sheet.id);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Sanity-check the flag stuck so the screenshot below really did
    // come from the legacy synchronous-render code path.
    const flag = await page.evaluate(() => ({
      window: (window as unknown as { __TAKEOFF_TILE_RENDERER__?: boolean })
        .__TAKEOFF_TILE_RENDERER__,
      storage: window.localStorage.getItem("takeoff_tile_renderer"),
    }));
    expect(flag.window).toBe(false);
    expect(flag.storage).toBe("off");

    await waitForCanvasPainted(page);

    await expectStageScreenshot(page, "tile-renderer-legacy-fallback.png");
  });
});
