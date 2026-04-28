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
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  BASE_RENDER_SCALE,
  TILE_SIZE_PX,
  type ZoomBucket,
} from "../lib/takeoff/tileCoords";

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

type Req =
  | {
      type: "getPageDims";
      requestId: number;
      sheetUrl: string;
      pageIndex: number;
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
  | { type: string; requestId: number; ok: false; error: string };

interface CancellableTask {
  cancel: () => void;
}
const inflightRenderTasks = new Map<number, CancellableTask>();

const docCache = new Map<string, Promise<PDFDocumentProxy>>();
const pageCache = new Map<string, Promise<PDFPageProxy>>();
const MAX_DOC_CACHE = 24;

async function loadDoc(sheetUrl: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(sheetUrl);
  if (p) return p;
  p = (async () => {
    const task = pdfjsLib.getDocument({
      url: sheetUrl,
      withCredentials: true,
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
    return await doc.getPage(pageIndex + 1);
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
      const errResp: Resp = {
        type: req.type,
        requestId: req.requestId,
        ok: false,
        error: msg,
      };
      (self as unknown as Worker).postMessage(errResp);
    });
});

export type {};
