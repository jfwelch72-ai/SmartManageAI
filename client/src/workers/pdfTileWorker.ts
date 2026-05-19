/**
 * Task #2138 — Off-thread PDF rasterizer for the takeoff workspace.
 *
 * Owns the only `pdfjs-dist` instance on the page after this task. The
 * main thread asks for tiles, full-page placeholders, page dimensions,
 * thumbnails, and text items via `postMessage`; everything pdfjs-side
 * (download, parse, render, font loading) happens here so the canvas
 * stays responsive even on a 300+ sheet civil planset.
 *
 * Protocol — every request carries a numeric `requestId`. The worker
 * replies with the same `requestId` and either an `ok: true` payload
 * or `ok: false, error: string`. ImageBitmaps are transferred (zero
 * copy) via the second `postMessage` argument.
 *
 * Task #2219 — pdfjs-dist v5 reaches `window.matchMedia(...)` on the
 * render path with no environment guard, which crashes a worker the
 * very first time it tries to render a page. We installed the
 * polyfill (`installPdfWorkerGlobals`) before *any* `pdfjs-dist`
 * code is loaded by:
 *   1. Statically importing only the polyfill function (hoisted).
 *   2. Calling the polyfill in module body (runs synchronously).
 *   3. Loading `pdfjs-dist` itself via `await import(...)` so the
 *      module evaluation order is encoded in real, executable code
 *      instead of import-statement ordering. This removes the
 *      previous "remember to keep these two `import` lines in this
 *      exact order" footgun — an import sorter or refactor can no
 *      longer silently re-break PDF rendering.
 */

import {
  installPdfWorkerGlobals,
  type PdfWorkerGlobalShim,
} from "./pdfWorkerPolyfill";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  BASE_RENDER_SCALE,
  TILE_SIZE_PX,
  type ZoomBucket,
} from "../lib/takeoff/tileCoords";

installPdfWorkerGlobals(globalThis as unknown as PdfWorkerGlobalShim);

// Dynamic import wrapped in an IIFE-promise: the polyfill above runs
// synchronously *before* this dynamic import begins, so pdfjs's module
// initializer is guaranteed to see the shimmed `window` / `matchMedia`.
//
// We deliberately avoid top-level `await` here so the worker stays
// compatible with the project's current `tsconfig.json` (which doesn't
// pin a `target` recent enough for TLA). Every async handler awaits
// `pdfjsLibPromise` once before touching pdfjs, which is effectively
// free after the first request because the promise resolves once and
// stays resolved.
const pdfjsLibPromise: Promise<typeof import("pdfjs-dist")> = (async () => {
  const lib = await import("pdfjs-dist");
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  return lib;
})();

type Req =
  | {
      type: "getPageDims";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
    }
  | {
      // Task #2188 — Fetch document-level metadata (currently just
      // `numPages`) without rendering anything. Used by the Plan Markup
      // viewer and the print page so they can drive their page strip
      // and per-page render loops without ever touching pdfjs on the
      // main thread.
      type: "getDocumentInfo";
      requestId: number;
      sheetUrl: string;
    }
  | {
      type: "renderTile";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
      zoomBucket: ZoomBucket;
      tileX: number;
      tileY: number;
    }
  | {
      type: "renderPlaceholder";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
      zoomBucket: ZoomBucket;
    }
  | {
      // Task #2188 — Render a full page at an arbitrary `scale`. The
      // tile renderer's existing `renderPlaceholder` is locked to the
      // discrete `ZoomBucket` ladder used by the takeoff workspace; the
      // Plan Markup viewer and the print page need finer-grained zoom
      // levels (1.0, 1.5, 2.5x, etc.) so this message accepts a raw
      // scale and returns a single bitmap covering the whole page.
      type: "renderPage";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
      scale: number;
    }
  | {
      type: "renderThumbnail";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
      maxWidth: number;
      maxHeight: number;
    }
  | {
      type: "getTextItems";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
    }
  | { type: "evictSheet"; requestId: number; sheetUrl: string }
  | {
      // Best-effort: cancel an in-flight `renderTile` whose original
      // `requestId` matches `targetRequestId`. The scheduler fires this
      // when the user moves the viewport so the worker can stop wasting
      // CPU on a tile we no longer need.
      type: "cancelTile";
      requestId: number;
      targetRequestId: number;
    }
  | {
      // Task #2188 — Same idea as `cancelTile` but for `renderPage`
      // requests. Fired when the Plan Markup viewer changes page or
      // zoom mid-render so we don't burn CPU rasterising a page the
      // user no longer cares about.
      type: "cancelPage";
      requestId: number;
      targetRequestId: number;
    };

type Resp =
  | {
      type: "getPageDims";
      requestId: number;
      ok: true;
      width: number;
      height: number;
    }
  | {
      type: "getDocumentInfo";
      requestId: number;
      ok: true;
      numPages: number;
    }
  | {
      type: "renderTile";
      requestId: number;
      ok: true;
      bitmap: ImageBitmap;
      empty: boolean;
    }
  | {
      type: "renderPlaceholder";
      requestId: number;
      ok: true;
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }
  | {
      type: "renderPage";
      requestId: number;
      ok: true;
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }
  | {
      type: "renderThumbnail";
      requestId: number;
      ok: true;
      bitmap: ImageBitmap;
    }
  | {
      type: "getTextItems";
      requestId: number;
      ok: true;
      items: string[];
    }
  | { type: "evictSheet"; requestId: number; ok: true }
  | { type: "cancelTile"; requestId: number; ok: true }
  | { type: "cancelPage"; requestId: number; ok: true }
  | {
      type: string;
      requestId: number;
      ok: false;
      error: string;
      // Task #2188 — Surface the original pdfjs error name (e.g.
      // "MissingPDFException", "InvalidPDFException") and HTTP status
      // (e.g. 401/403/404) so the Plan Markup preview can render the
      // same friendly error states it used to render when it ran pdfjs
      // on the main thread.
      errorName?: string;
      errorStatus?: number;
    };

interface CancellableTask {
  cancel: () => void;
}
const inflightRenderTasks = new Map<number, CancellableTask>();
// Task #2188 — Mirror of `inflightRenderTasks` for full-page renders
// dispatched via `renderPage`. Kept separate so a `cancelPage` for one
// surface can never abort a `renderTile` started for the takeoff
// workspace (and vice-versa).
const inflightPageTasks = new Map<number, CancellableTask>();

const docCache = new Map<string, Promise<PDFDocumentProxy>>();
const pageCache = new Map<string, Promise<PDFPageProxy>>();
const MAX_DOC_CACHE = 24;

/**
 * pdfjs-dist's default `DOMCanvasFactory` calls
 * `globalThis.document.createElement("canvas")` whenever the renderer
 * needs an internal scratch canvas (transparency layers, pattern fills,
 * tiling helpers, etc.). In a Web Worker there is no `document`, so the
 * call throws `TypeError: Cannot read properties of undefined (reading
 * 'createElement')` — surfaced to the user as the
 * "Couldn't load <sheet>" toast with no other context.
 *
 * `OffscreenCanvas` is the worker-native equivalent and exposes the
 * same `getContext("2d")` + `width`/`height` API that
 * `BaseCanvasFactory.create/reset/destroy` need, so we provide our own
 * factory and hand it to `getDocument({ CanvasFactory })`. pdfjs
 * `new`s the class internally with `{ ownerDocument, enableHWA }`,
 * which we accept for forward compatibility but ignore.
 */
class WorkerCanvasFactory {
  private enableHWA = false;
  constructor(opts?: { enableHWA?: boolean }) {
    this.enableHWA = !!opts?.enableHWA;
  }
  create(width: number, height: number): {
    canvas: OffscreenCanvas;
    context: OffscreenCanvasRenderingContext2D;
  } {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.floor(width)),
      Math.max(1, Math.floor(height)),
    );
    const context = canvas.getContext("2d", {
      willReadFrequently: !this.enableHWA,
    }) as OffscreenCanvasRenderingContext2D | null;
    if (!context) throw new Error("OffscreenCanvas 2D context unavailable");
    return { canvas, context };
  }
  reset(
    canvasAndContext: { canvas: OffscreenCanvas | null; context: unknown },
    width: number,
    height: number,
  ): void {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
    canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
  }
  destroy(canvasAndContext: {
    canvas: OffscreenCanvas | null;
    context: unknown;
  }): void {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * Task #2405 — When the URL points at our `/api/takeoff/sheets/:id/pdf`
 * endpoint, first try the sibling `/pdf-url` endpoint to obtain a
 * short-TTL signed GCS URL. That lets pdfjs's range loader talk to GCS
 * directly (which natively supports HTTP Range) and bypass our Express
 * proxy entirely, so a 25 GB planset isn't streamed through Node just
 * for the trailer dictionary. On any failure we fall back to the
 * authenticated proxy URL — `withCredentials: true` keeps the session
 * cookie attached so range support in `downloadObject` kicks in.
 */
async function resolvePdfFetchUrl(
  sheetUrl: string,
): Promise<{ url: string; useCredentials: boolean }> {
  const takeoffMatch = /\/api\/takeoff\/sheets\/([^/?#]+)\/pdf(?:[?#].*)?$/.exec(sheetUrl);
  if (!takeoffMatch) return { url: sheetUrl, useCredentials: true };
  const signedEndpoint = sheetUrl.replace(/\/pdf(?=[?#]|$)/, "/pdf-url");
  try {
    const res = await fetch(signedEndpoint, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const body = (await res.json()) as { url?: string };
      if (body && typeof body.url === "string" && body.url.length > 0) {
        return { url: body.url, useCredentials: false };
      }
    }
  } catch {
    /* network/CORS — fall through to the authenticated proxy URL. */
  }
  return { url: sheetUrl, useCredentials: true };
}

async function loadDoc(sheetUrl: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(sheetUrl);
  if (p) return p;
  p = (async () => {
    const pdfjsLib = await pdfjsLibPromise;
    const resolved = await resolvePdfFetchUrl(sheetUrl);
    // Build absolute URLs for the standard font data and CMaps that
    // pdfjs-dist needs to render text in PDFs that use standard Type1
    // fonts (Helvetica, Times-Roman, Courier, etc.) or CJK CMaps.
    // Without these, text characters render as boxes. The assets are
    // served from /standard_fonts/ and /cmaps/ (copied from
    // node_modules/pdfjs-dist during the build/setup step).
    const origin =
      typeof self !== "undefined" && self.location
        ? self.location.origin
        : "";
    const task = pdfjsLib.getDocument({
      url: resolved.url,
      withCredentials: resolved.useCredentials,
      // See WorkerCanvasFactory above — without this, pdfjs falls back
      // to `DOMCanvasFactory` and crashes the first time it needs a
      // scratch canvas in this worker context.
      CanvasFactory: WorkerCanvasFactory,
      standardFontDataUrl: `${origin}/standard_fonts/`,
      cMapUrl: `${origin}/cmaps/`,
      cMapPacked: true,
      // Worker context: document is undefined, so PDF.js cannot call
      // document.fonts.add() to register embedded fonts as @font-face
      // CSS rules. When font registration silently fails, fillText()
      // falls back to a generic system font that lacks the PDF's glyph
      // encoding — every character maps to notdef → rendered as a box.
      //
      // disableFontFace:true bypasses the CSS font-loading path entirely.
      // PDF.js instead compiles each glyph into canvas path operations
      // (moveTo/bezierCurveTo/fill) and draws them directly, which works
      // correctly with OffscreenCanvas in a Web Worker context.
      //
      // isEvalSupported:false pairs with this: production CSP blocks
      // eval()/new Function() which PDF.js uses to JIT-compile glyph
      // charstrings. Setting false forces the pure-JS interpreter path
      // which renders identically without requiring eval.
      disableFontFace: true,
      isEvalSupported: false,
    });
    return await task.promise;
  })();
  docCache.set(sheetUrl, p);
  if (docCache.size > MAX_DOC_CACHE) {
    const firstKey = docCache.keys().next().value;
    if (firstKey && firstKey !== sheetUrl) {
      const stale = docCache.get(firstKey);
      docCache.delete(firstKey);
      stale?.then((d) => d.destroy().catch(() => undefined)).catch(() => undefined);
      const allKeys: string[] = [];
      pageCache.forEach((_v, k) => allKeys.push(k));
      for (const k of allKeys) {
        if (k.startsWith(`${firstKey}#`)) pageCache.delete(k);
      }
    }
  }
  return p;
}

async function loadPage(
  sheetUrl: string,
  pageIndex: number,
): Promise<PDFPageProxy> {
  const k = `${sheetUrl}#${pageIndex}`;
  let p = pageCache.get(k);
  if (p) return p;
  p = (async () => {
    const doc = await loadDoc(sheetUrl);
    // Guard against the sheet record's stored `sheetIndex` being out
    // of range for the underlying PDF — e.g. a sheet that was
    // originally page 5 of a multi-page document but whose PDF was
    // later replaced with a single-page pricing PDF (the case the
    // user hit with "TFR Construction 2025 Pricing"). Without this
    // clamp, pdfjs throws "Invalid page request" and the workspace
    // shows a destructive toast with a black canvas instead of the
    // (one) page the file actually contains.
    //
    // Negative indices are clamped to 0; indices beyond the last
    // page fall back to the last page. The clamped value is logged
    // so the data drift is visible in DevTools without surfacing a
    // user-facing error.
    const numPages = doc.numPages;
    let safePageIndex = pageIndex;
    if (!Number.isFinite(safePageIndex) || safePageIndex < 0) {
      console.warn(
        `[pdfTileWorker] Negative/invalid pageIndex ${pageIndex} for ${sheetUrl}; falling back to page 0`,
      );
      safePageIndex = 0;
    } else if (safePageIndex >= numPages) {
      console.warn(
        `[pdfTileWorker] pageIndex ${pageIndex} out of range for ${sheetUrl} (numPages=${numPages}); falling back to page ${numPages - 1}`,
      );
      safePageIndex = numPages - 1;
    }
    return await doc.getPage(safePageIndex + 1);
  })();
  pageCache.set(k, p);
  return p;
}

function getOffscreen(
  width: number,
  height: number,
): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return new OffscreenCanvas(w, h);
}

async function renderToBitmap(
  page: PDFPageProxy,
  scale: number,
  cropPx: { x: number; y: number; w: number; h: number } | null,
  outW: number,
  outH: number,
  registerTask?: (task: CancellableTask) => void,
): Promise<ImageBitmap> {
  const canvas = getOffscreen(outW, outH);
  if (!canvas) {
    throw new Error("OffscreenCanvas unavailable in this worker context");
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  const viewport = page.getViewport({ scale });
  if (cropPx) {
    ctx.translate(-cropPx.x, -cropPx.y);
  }
  const renderTask = page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    canvas: canvas as unknown as HTMLCanvasElement,
  });
  registerTask?.(renderTask);
  await renderTask.promise;
  return canvas.transferToImageBitmap();
}

async function handle(req: Req): Promise<{ resp: Resp; transfer: Transferable[] }> {
  switch (req.type) {
    case "getPageDims": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const v = page.getViewport({ scale: BASE_RENDER_SCALE });
      return {
        resp: {
          type: "getPageDims",
          requestId: req.requestId,
          ok: true,
          width: v.width,
          height: v.height,
        },
        transfer: [],
      };
    }
    case "getDocumentInfo": {
      const doc = await loadDoc(req.sheetUrl);
      return {
        resp: {
          type: "getDocumentInfo",
          requestId: req.requestId,
          ok: true,
          numPages: doc.numPages,
        },
        transfer: [],
      };
    }
    case "renderPage": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const scale = req.scale > 0 ? req.scale : 1;
      const v = page.getViewport({ scale });
      const w = Math.max(1, Math.round(v.width));
      const h = Math.max(1, Math.round(v.height));
      try {
        const bm = await renderToBitmap(page, scale, null, w, h, (task) => {
          inflightPageTasks.set(req.requestId, task);
        });
        return {
          resp: {
            type: "renderPage",
            requestId: req.requestId,
            ok: true,
            bitmap: bm,
            width: w,
            height: h,
          },
          transfer: [bm],
        };
      } finally {
        inflightPageTasks.delete(req.requestId);
      }
    }
    case "cancelPage": {
      const task = inflightPageTasks.get(req.targetRequestId);
      if (task) {
        try {
          task.cancel();
        } catch {
          /* RenderTask.cancel() can throw if already done; harmless */
        }
        inflightPageTasks.delete(req.targetRequestId);
      }
      return {
        resp: { type: "cancelPage", requestId: req.requestId, ok: true },
        transfer: [],
      };
    }
    case "renderTile": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const baseV = page.getViewport({ scale: BASE_RENDER_SCALE });
      const tileWorld = TILE_SIZE_PX / req.zoomBucket;
      const worldX = req.tileX * tileWorld;
      const worldY = req.tileY * tileWorld;
      if (worldX >= baseV.width || worldY >= baseV.height) {
        const blank = getOffscreen(TILE_SIZE_PX, TILE_SIZE_PX);
        if (!blank) throw new Error("OffscreenCanvas unavailable");
        const bm = blank.transferToImageBitmap();
        return {
          resp: {
            type: "renderTile",
            requestId: req.requestId,
            ok: true,
            bitmap: bm,
            empty: true,
          },
          transfer: [bm],
        };
      }
      const renderScale = BASE_RENDER_SCALE * req.zoomBucket;
      const cropPx = {
        x: worldX * req.zoomBucket,
        y: worldY * req.zoomBucket,
        w: TILE_SIZE_PX,
        h: TILE_SIZE_PX,
      };
      try {
        const bm = await renderToBitmap(
          page,
          renderScale,
          cropPx,
          TILE_SIZE_PX,
          TILE_SIZE_PX,
          (task) => {
            inflightRenderTasks.set(req.requestId, task);
          },
        );
        return {
          resp: {
            type: "renderTile",
            requestId: req.requestId,
            ok: true,
            bitmap: bm,
            empty: false,
          },
          transfer: [bm],
        };
      } finally {
        inflightRenderTasks.delete(req.requestId);
      }
    }
    case "cancelTile": {
      const task = inflightRenderTasks.get(req.targetRequestId);
      if (task) {
        try {
          task.cancel();
        } catch {
          /* RenderTask.cancel() can throw if already done; harmless */
        }
        inflightRenderTasks.delete(req.targetRequestId);
      }
      return {
        resp: { type: "cancelTile", requestId: req.requestId, ok: true },
        transfer: [],
      };
    }
    case "renderPlaceholder": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const baseV = page.getViewport({ scale: BASE_RENDER_SCALE });
      const renderScale = BASE_RENDER_SCALE * req.zoomBucket;
      const w = Math.max(1, Math.round(baseV.width * req.zoomBucket));
      const h = Math.max(1, Math.round(baseV.height * req.zoomBucket));
      const bm = await renderToBitmap(page, renderScale, null, w, h);
      return {
        resp: {
          type: "renderPlaceholder",
          requestId: req.requestId,
          ok: true,
          bitmap: bm,
          width: baseV.width,
          height: baseV.height,
        },
        transfer: [bm],
      };
    }
    case "renderThumbnail": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const v1 = page.getViewport({ scale: 1 });
      const sX = req.maxWidth / v1.width;
      const sY = req.maxHeight / v1.height;
      const scale = Math.min(sX, sY);
      const w = Math.max(1, Math.round(v1.width * scale));
      const h = Math.max(1, Math.round(v1.height * scale));
      const bm = await renderToBitmap(page, scale, null, w, h);
      return {
        resp: {
          type: "renderThumbnail",
          requestId: req.requestId,
          ok: true,
          bitmap: bm,
        },
        transfer: [bm],
      };
    }
    case "getTextItems": {
      const page = await loadPage(req.sheetUrl, req.pageIndex);
      const text = await page.getTextContent();
      const items: string[] = [];
      for (const it of text.items as Array<{ str?: string }>) {
        if (it && typeof it.str === "string" && it.str.trim().length > 0) {
          items.push(it.str);
        }
      }
      return {
        resp: {
          type: "getTextItems",
          requestId: req.requestId,
          ok: true,
          items,
        },
        transfer: [],
      };
    }
    case "evictSheet": {
      const stale = docCache.get(req.sheetUrl);
      docCache.delete(req.sheetUrl);
      stale?.then((d) => d.destroy().catch(() => undefined)).catch(() => undefined);
      const allKeys: string[] = [];
      pageCache.forEach((_v, k) => allKeys.push(k));
      for (const k of allKeys) {
        if (k.startsWith(`${req.sheetUrl}#`)) pageCache.delete(k);
      }
      return {
        resp: { type: "evictSheet", requestId: req.requestId, ok: true },
        transfer: [],
      };
    }
  }
}

self.addEventListener("message", (event: MessageEvent<Req>) => {
  const req = event.data;
  if (!req || typeof req !== "object" || !("requestId" in req)) return;
  handle(req)
    .then(({ resp, transfer }) => {
      (self as unknown as Worker).postMessage(resp, transfer);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Task #2188 — pdfjs raises typed exceptions whose `name` (and
      // sometimes `status`) tell us what actually went wrong. Pass
      // them through so the main thread can render the same friendly
      // "MissingPDFException" / 401 / 403 messages it used to.
      const e = err as { name?: string; status?: number };
      const errResp: Resp = {
        type: req.type,
        requestId: req.requestId,
        ok: false,
        error: msg,
        errorName: typeof e?.name === "string" ? e.name : undefined,
        errorStatus: typeof e?.status === "number" ? e.status : undefined,
      };
      (self as unknown as Worker).postMessage(errResp);
    });
});

export type {};
