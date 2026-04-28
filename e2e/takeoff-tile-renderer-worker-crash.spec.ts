import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { installCsrf, authedRequest } from "./helpers/csrf";
import { objectKeyToResolvableFileUrl } from "./helpers/uploadFixturePdf";

// Task #2264 — End-to-end worker-crash regression gate.
//
// What this spec is FOR:
//   • Catch a future `pdfjs-dist` upgrade that introduces a *new*
//     unguarded DOM reference (e.g. `window.foo`, `document.bar`,
//     `navigator.baz`) on a render code path that our existing
//     `installPdfWorkerGlobals()` shim does not cover. The Task #2219
//     unit test pins the polyfill itself and pins the one specific
//     `window.matchMedia(...)` call we know about today, but it does
//     NOT actually drive the takeoff worker through "open a sheet,
//     render a tile" in a real browser. If pdfjs grows a new
//     unguarded `document.<…>` reference on the render path, the
//     unit tests would still pass and the bug would only surface as
//     a permanently blank takeoff canvas in production.
//   • Give CI a real-browser, real-worker, real-PDF signal: any
//     `ReferenceError: window is not defined` (or `document` /
//     `self` / `navigator`) that surfaces while rendering a tile
//     fails the spec at PR time, well before the bug ships.
//
// What this spec is NOT for:
//   • Pixel-baseline correctness (covered by
//     `takeoff-tile-renderer-render.spec.ts`).
//   • Frame-rate budgets (covered by
//     `takeoff-tile-renderer-perf.spec.ts`).
//
// How it catches the regression:
//   1. Before navigation, monkey-patch `window.Worker` so every
//      `pdfTileWorker` instance the takeoff workspace spawns has its
//      `message` / `error` / `messageerror` events forwarded into a
//      page-global error log.
//   2. The `pdfTileWorker` protocol replies to every request with
//      either `{ ok: true, ... }` or `{ ok: false, error: "<msg>" }`.
//      A `ReferenceError: window is not defined` thrown anywhere in
//      pdfjs's render path bubbles up through `handle(req).catch(...)`
//      in the worker (see `pdfTileWorker.ts`) and is posted back as
//      `{ ok: false, error: "ReferenceError: window is not defined",
//      errorName: "ReferenceError" }`. The hook captures it and the
//      assertion below fails.
//   3. Errors that escape the `try`/`catch` (e.g. a synchronous throw
//      during worker module evaluation) fire a `WorkerErrorEvent`
//      which is also captured.
//   4. The spec also waits for the canvas to actually paint — if no
//      tile ever rendered, the assertion that a render attempt
//      occurred fails so the spec can't silently pass on an empty
//      stage.

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const PAGE_W = 612;
const PAGE_H = 792;

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

interface CapturedWorkerError {
  source: "message" | "error" | "messageerror";
  workerName: string;
  type?: string;
  error?: string;
  errorName?: string;
  message?: string;
  filename?: string;
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
      clientName: "PW Worker Crash Gate",
      bidAmount: "75000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

/**
 * Tiny deterministic PDF — only purpose is to be a valid, font-bearing
 * single-page document the worker can actually rasterize. We don't
 * snapshot pixels here, so the layout is intentionally minimal. We
 * still embed a Helvetica-rendered label so pdfjs is forced down its
 * font-loading code path (which historically is where the unguarded
 * DOM references in pdfjs v5 live).
 *
 * Implementation notes (mirrored from
 * `takeoff-tile-renderer-render.spec.ts → buildFixturePdf`):
 *   • Use `addPage()` (no arg) + `setSize` instead of
 *     `addPage([w, h])`. pdf-lib validates the dimensions argument
 *     with `instanceof Array` against its own intrinsic, so a literal
 *     `[w, h]` from the test runtime gets rejected as `NaN` when the
 *     bundles end up in different realms.
 */
async function buildFixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  page.setSize(PAGE_W, PAGE_H);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: PAGE_W,
    height: PAGE_H,
    color: rgb(0.93, 0.95, 0.98),
  });
  page.drawRectangle({
    x: 60,
    y: 60,
    width: PAGE_W - 120,
    height: PAGE_H - 120,
    color: rgb(0.27, 0.6, 0.95),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
  });
  page.drawText("PW Worker Crash Gate", {
    x: 80,
    y: PAGE_H / 2,
    size: 24,
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
): Promise<SheetResponse> {
  const pdf = await buildFixturePdf();
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
  // See `objectKeyToResolvableFileUrl` — the raw bucket-prefixed key
  // returned by `/api/objects/upload` won't resolve through
  // `server/takeoffSheetRoutes.ts → resolveGcsFile()`, so storing it
  // verbatim 404s the PDF stream and silently leaves the canvas blank.
  const fileUrl = objectKeyToResolvableFileUrl(objectKey);
  const planRes = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
    {
      data: { fileUrl, objectKey, fileName },
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
 * Hook the global `Worker` constructor before any page script runs so
 * we can observe every error / failure response that comes out of a
 * `pdfTileWorker` instance the takeoff workspace spawns.
 *
 * Separately also tracks how many `renderTile` / `renderPlaceholder`
 * /`renderPage` responses arrived so the spec can refuse to pass when
 * the worker never actually rendered anything (which would also mean
 * the assertion that no crash occurred is vacuous).
 */
async function installWorkerErrorHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface CapturedErr {
      source: "message" | "error" | "messageerror";
      workerName: string;
      type?: string;
      error?: string;
      errorName?: string;
      message?: string;
      filename?: string;
    }
    const errors: CapturedErr[] = [];
    const renderResponses: string[] = [];
    (window as unknown as { __pdfWorkerErrors?: CapturedErr[] }).__pdfWorkerErrors =
      errors;
    (window as unknown as { __pdfWorkerRenderResponses?: string[] }).__pdfWorkerRenderResponses =
      renderResponses;

    const NativeWorker = window.Worker;
    if (!NativeWorker) return;

    // Use a real subclass so the native [[Construct]] semantics
    // (including the `new Worker(url, {type: "module"})` module loader)
    // are preserved exactly — patching the prototype or wrapping with
    // a plain function would break the module-worker contract that
    // `pdfTileWorker.ts` depends on.
    class PatchedWorker extends NativeWorker {
      constructor(scriptUrl: string | URL, options?: WorkerOptions) {
        super(scriptUrl, options);
        const name = options?.name ?? "";
        const url = typeof scriptUrl === "string" ? scriptUrl : scriptUrl.toString();
        const isPdfWorker =
          name === "pdf-tile-worker" ||
          name.includes("pdf") ||
          url.includes("pdfTileWorker");
        if (!isPdfWorker) return;
        this.addEventListener("message", (ev: MessageEvent) => {
          const data = ev.data as
            | {
                ok?: boolean;
                error?: string;
                errorName?: string;
                type?: string;
              }
            | null
            | undefined;
          if (!data || typeof data !== "object") return;
          if (typeof data.type === "string") {
            renderResponses.push(data.type);
          }
          if (data.ok === false && typeof data.error === "string") {
            errors.push({
              source: "message",
              workerName: name,
              type: data.type,
              error: data.error,
              errorName: data.errorName,
            });
          }
        });
        this.addEventListener("error", (ev: Event) => {
          const ee = ev as ErrorEvent;
          errors.push({
            source: "error",
            workerName: name,
            message: ee.message,
            filename: ee.filename,
          });
        });
        this.addEventListener("messageerror", (ev: Event) => {
          errors.push({
            source: "messageerror",
            workerName: name,
            message: String((ev as MessageEvent).data ?? "messageerror"),
          });
        });
      }
    }
    (window as unknown as { Worker: typeof Worker }).Worker =
      PatchedWorker as unknown as typeof Worker;
  });
}

/**
 * Same pattern as `takeoff-tile-renderer-render.spec.ts` —
 * wait for the active sheet's canvas to be painted with non-blank
 * pixels (i.e. tile / placeholder bitmaps have arrived from the
 * worker). If this times out, the worker either crashed before
 * producing a bitmap or never started, and the captured error log
 * tells us which.
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

test.describe("Task #2264 — Tile renderer worker-crash regression gate", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page, browserName }) => {
    // The worker-globals shim being tested is engine-agnostic, but
    // the fixture-upload + takeoff-route flow this spec drives is
    // already validated only on chromium in the sibling render /
    // perf specs. Limiting this gate to chromium keeps us out of
    // engine-specific PDF rasterizer differences and matches where
    // CI actually runs the takeoff e2e suite.
    test.skip(
      browserName !== "chromium",
      "Worker-crash regression gate runs alongside the chromium tile-renderer specs.",
    );
    await installCsrf(page);
    await devLogin(page);
  });

  test("worker renders a real PDF tile end-to-end with no DOM-reference crash", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Hook the Worker constructor BEFORE any flag/sheet init script
    // so every Worker the page constructs is wrapped, including the
    // pool the TileScheduler eagerly spawns on first scheduler use.
    await installWorkerErrorHook(page);
    await setTileRendererFlag(page, true);

    const bid = await createBid(page, `PW Worker Crash ${Date.now()}`);
    const sheet = await uploadDeterministicSheet(
      page,
      bid.id,
      "PW Worker Crash Sheet 1.pdf",
    );
    await pinSelectedSheet(page, bid.id, sheet.id);

    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("sheet-tabs-bar")).toBeVisible({
      timeout: 30_000,
    });

    // Drive the canvas to paint at least one bitmap from the worker.
    // If the worker crashes on the very first render request (the
    // historical pdfjs v5 + window.matchMedia regression class), the
    // canvas would never paint and this poll would time out — which
    // is the failure signal we want.
    await waitForCanvasPainted(page);

    // Pull the captured worker errors + render-response log out of
    // the page. We assert in two steps so a regression that "renders
    // nothing but also crashes nothing" (e.g. flag silently flipped
    // off, worker pool never used) can't make this gate vacuously
    // pass.
    const { errors, renderResponses } = await page.evaluate(() => {
      const w = window as unknown as {
        __pdfWorkerErrors?: CapturedWorkerError[];
        __pdfWorkerRenderResponses?: string[];
      };
      return {
        errors: w.__pdfWorkerErrors ?? [],
        renderResponses: w.__pdfWorkerRenderResponses ?? [],
      };
    });

    // Sanity gate: at least one render-bearing response (renderTile,
    // renderPlaceholder, or renderPage) must have arrived. Otherwise
    // the canvas was painted by something other than the worker
    // pipeline (e.g. a fallback image), and the no-crash assertion
    // below wouldn't actually be exercising the worker we care about.
    const renderBearing = renderResponses.filter((t) =>
      ["renderTile", "renderPlaceholder", "renderPage"].includes(t),
    );
    expect(
      renderBearing.length,
      `expected at least one render-bearing worker response (renderTile / renderPlaceholder / renderPage); got: ${JSON.stringify(renderResponses)}`,
    ).toBeGreaterThan(0);

    // Crash gate: no captured error may match the unguarded-DOM-
    // reference signature. We match on the *whole* "X is not defined"
    // family (window, document, self, navigator, location, ...) so a
    // future pdfjs upgrade that introduces a new unguarded reference
    // surfaces here regardless of which DOM global it touched.
    const domReferenceErrors = errors.filter((e) => {
      const msg = `${e.error ?? ""} ${e.message ?? ""}`;
      return (
        /\bReferenceError\b/.test(msg) &&
        /\b(window|document|self|navigator|location|HTMLElement)\b\s+is not defined/i.test(
          msg,
        )
      );
    });
    expect(
      domReferenceErrors,
      `pdfTileWorker emitted DOM-reference crash(es) — pdfjs likely added a new unguarded global reference that installPdfWorkerGlobals() does not cover. Captured: ${JSON.stringify(domReferenceErrors, null, 2)}`,
    ).toEqual([]);
  });
});
