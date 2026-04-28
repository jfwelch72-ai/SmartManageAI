/**
 * Task #2138 — React glue for the PDF tile renderer. Turns a sheet
 * URL + a viewport descriptor into:
 *
 *   • `pageDims`  — `{ width, height }` matching the legacy
 *                   `pdfImage` (page rendered at `BASE_RENDER_SCALE`),
 *                   so every consumer downstream of `pdfImage` keeps
 *                   working without world-coord changes.
 *   • `placeholder` — A low-res whole-page bitmap for the eager
 *                   first paint and as a backdrop while detail tiles
 *                   stream in.
 *   • `tiles`    — Currently-cached tile bitmaps for the visible
 *                   viewport, ready for `<TileLayer>` to draw.
 *   • `getTextItems()` — Worker-side text extraction (used by the
 *                   scale-detection routine that historically called
 *                   `page.getTextContent()` on the main thread).
 *
 * The hook owns no pdfjs state itself — that lives entirely inside
 * the worker. Sheet switches cancel queued work for the prior sheet
 * and pre-warm the placeholder for the next sheet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileCache } from "@/lib/takeoff/tileCache";
import {
  PLACEHOLDER_BUCKET,
  pickZoomBucket,
  tileKey,
  visibleTileCoords,
  type PageDims,
  type TileCoord,
  type ViewportWorldRect,
  type ZoomBucket,
} from "@/lib/takeoff/tileCoords";
import {
  getSharedScheduler,
  WorkerPdfError,
  type TileScheduler,
} from "@/lib/takeoff/tileScheduler";

/**
 * Error surface for a failed placeholder render. We deliberately keep
 * this independent of `Error` so consumers can render it via React
 * without worrying about prototype-chain quirks across the
 * worker/main-thread boundary; the hook normalizes whatever the
 * scheduler rejects with into this shape.
 */
export interface PdfPlaceholderError {
  /** Human-readable message — preferred fallback for toast bodies. */
  message: string;
  /** pdfjs exception name (e.g. "MissingPDFException") when known. */
  name?: string;
  /** HTTP status from `UnexpectedResponseException` when known. */
  status?: number;
}

export interface PdfTileRendererState {
  pageDims: PageDims | null;
  placeholder: ImageBitmap | null;
  /**
   * Set when the worker fails to render the low-res placeholder for
   * the currently selected sheet. Cleared automatically on the next
   * sheet switch (or when the hook is disabled). Without this, a
   * silently-rejected `renderPlaceholder` left the workspace stuck on
   * "Loading plan… 80%" forever — see TakeoffWorkspace mirror effect.
   */
  placeholderError: PdfPlaceholderError | null;
  visibleTiles: Array<{ coord: TileCoord; bitmap: ImageBitmap }>;
  isLoadingPlaceholder: boolean;
  isAnyTileLoading: boolean;
  cacheStats: { size: number; bytes: number; budget: number };
}

export interface UsePdfTileRendererArgs {
  sheetId: string | null;
  sheetUrl: string | null;
  pageIndex: number;
  viewport: ViewportWorldRect | null;
  stageScale: number;
  enabled: boolean;
  cache?: TileCache;
  scheduler?: TileScheduler;
}

const DEFAULT_CACHE = new TileCache();

export function usePdfTileRenderer(
  args: UsePdfTileRendererArgs,
): PdfTileRendererState & {
  getTextItems: () => Promise<string[]>;
} {
  const cache = args.cache ?? DEFAULT_CACHE;
  // `getSharedScheduler()` returns null when the runtime has no
  // `Worker` (jsdom unit tests, very old browsers). Treat that case
  // exactly like the feature flag being off so the hook degrades to a
  // no-op instead of crashing.
  const scheduler = args.scheduler ?? getSharedScheduler();
  const enabled = args.enabled && scheduler !== null;
  const [pageDims, setPageDims] = useState<PageDims | null>(null);
  const [placeholder, setPlaceholder] = useState<ImageBitmap | null>(null);
  const [placeholderError, setPlaceholderError] =
    useState<PdfPlaceholderError | null>(null);
  const [, setTick] = useState(0);
  const [loadingPlaceholder, setLoadingPlaceholder] = useState(false);
  const [loadingTileCount, setLoadingTileCount] = useState(0);
  const lastSheetRef = useRef<string | null>(null);
  const lastVisibleKeysRef = useRef<Set<string>>(new Set());
  // RAF-coalesced re-render: many tiles can resolve in the same frame
  // (especially after a fast pan); per-tile setTick caused a setState
  // storm that re-ran the visibleTiles useMemo dozens of times per
  // frame. Batch them into a single setState per RAF tick.
  const flushScheduledRef = useRef(false);
  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        flushScheduledRef.current = false;
        setTick((t) => (t + 1) % 1_000_000);
      });
    } else {
      // jsdom and SSR have no RAF — fall back to a microtask so the
      // unit tests still observe state changes.
      Promise.resolve().then(() => {
        flushScheduledRef.current = false;
        setTick((t) => (t + 1) % 1_000_000);
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled || !scheduler || !args.sheetUrl || !args.sheetId) {
      setPageDims(null);
      // IMPORTANT: do NOT call .close() on the prior bitmap here. The
      // consumer (TakeoffWorkspace) keeps its own `pdfImage` ref to the
      // same ImageBitmap, and Konva draws it on requestAnimationFrame.
      // If we close synchronously, the next RAF can fire before the
      // consumer's mirror effect has had a chance to null its `pdfImage`,
      // throwing "Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
      // The image source is detached" in dev. The bitmap will be
      // GC-reclaimed once the consumer's state update lands.
      setPlaceholder(null);
      setPlaceholderError(null);
      // Reset so a subsequent re-enable / sheet-set is treated as a
      // fresh load (not a "same sheet" no-op that skips the cleanup
      // branch above).
      lastSheetRef.current = null;
      return;
    }
    const prevSheet = lastSheetRef.current;
    if (prevSheet && prevSheet !== args.sheetId) {
      scheduler.cancelAllForSheet(prevSheet);
      // Clear the prior sheet's placeholder + pageDims so the consumer's
      // mirror effect cannot keep showing sheet A's bitmap (and treat
      // the load as "succeeded") while sheet B is still loading or has
      // failed. Without this reset the placeholderError arm below is
      // unreachable on a sheet switch, because `placeholder` would
      // still be truthy and win the success branch first.
      //
      // We deliberately do NOT close the bitmap here — the consumer's
      // pdfImage state still points to it for at least one render after
      // we null it, and a Konva RAF in that window would throw
      // "image source is detached". Let GC reclaim it instead.
      setPlaceholder(null);
      setPageDims(null);
    }
    lastSheetRef.current = args.sheetId;
    // Reset error state on every (re)load attempt so a transient
    // failure on sheet A doesn't leak into sheet B's UI.
    setPlaceholderError(null);
    let cancelled = false;
    setLoadingPlaceholder(true);
    scheduler
      .renderPlaceholder(args.sheetUrl, args.pageIndex, PLACEHOLDER_BUCKET)
      .then((res) => {
        if (cancelled) {
          try {
            res.bitmap.close();
          } catch {
            /* noop */
          }
          return;
        }
        setPageDims({ width: res.width, height: res.height });
        // IMPORTANT: do NOT call .close() on the previous placeholder
        // bitmap here. The consumer (TakeoffWorkspace) mirrors our
        // `placeholder` into its own `pdfImage` state via an effect,
        // so its bitmap ref doesn't update in lockstep with ours —
        // there is at least one Konva RAF tick during which `pdfImage`
        // still points at the OLD bitmap. Closing synchronously
        // inside `.then` therefore re-introduced the same
        // "Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
        // The image source is detached" crash that the sheet-switch /
        // disable paths above already guard against. Drop the ref and
        // let GC reclaim the prior bitmap once the consumer's mirror
        // effect has switched over.
        setPlaceholder(res.bitmap);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Surface the error so the consumer can clear its loading
        // skeleton and show a toast. Previously this catch was a
        // silent no-op, which left the takeoff workspace stuck on
        // "Loading plan… 80%" forever whenever the worker rejected
        // (corrupt page, 401/404 PDF response, OOM in OffscreenCanvas
        // on giant civil sheets, etc.). The console.error preserves
        // the stack for production diagnosis.
        console.error(
          "[Takeoff] Placeholder render failed for sheet",
          args.sheetId,
          err,
        );
        const msg =
          err instanceof Error ? err.message : String(err ?? "render failed");
        const wpe = err instanceof WorkerPdfError ? err : null;
        setPlaceholderError({
          message: msg,
          name: wpe?.errorName ?? (err instanceof Error ? err.name : undefined),
          status: wpe?.status,
        });
      })
      .finally(() => {
        if (!cancelled) setLoadingPlaceholder(false);
      });
    return () => {
      cancelled = true;
    };
  }, [args.enabled, args.sheetUrl, args.sheetId, args.pageIndex, scheduler]);

  useEffect(() => {
    if (
      !enabled ||
      !scheduler ||
      !args.sheetUrl ||
      !args.sheetId ||
      !args.viewport ||
      !pageDims
    ) {
      return;
    }
    const sheetId = args.sheetId;
    const sheetUrl = args.sheetUrl;
    const pageIndex = args.pageIndex;
    const bucket: ZoomBucket = pickZoomBucket(args.stageScale);
    const coords = visibleTileCoords({
      page: pageDims,
      viewport: args.viewport,
      zoomBucket: bucket,
      sheetId,
      pageIndex,
    });
    const visibleKeys = new Set(coords.map(tileKey));
    lastVisibleKeysRef.current = visibleKeys;
    scheduler.cancelOutsideViewport(visibleKeys);
    // Update both the scheduler (so newly-enqueued tiles below pick the
    // right priority on insertion) and the cache (so over-budget
    // eviction prefers tiles farthest from the user's viewport).
    scheduler.setViewport(args.viewport, sheetId);
    cache.setViewport(args.viewport, sheetId);

    let issued = 0;
    for (const c of coords) {
      if (cache.has(c)) continue;
      issued++;
      scheduler
        .requestTile({ coord: c, sheetUrl, priority: 0 })
        .then((res) => {
          if (lastVisibleKeysRef.current.has(tileKey(res.coord))) {
            cache.set(res.coord, res.bitmap);
            scheduleFlush();
          } else {
            try {
              res.bitmap.close();
            } catch {
              /* noop */
            }
          }
        })
        .catch(() => undefined)
        .finally(() => {
          setLoadingTileCount((n) => Math.max(0, n - 1));
        });
    }
    if (issued > 0) {
      setLoadingTileCount((n) => n + issued);
    } else {
      scheduleFlush();
    }
  }, [
    args.enabled,
    args.sheetUrl,
    args.sheetId,
    args.pageIndex,
    args.viewport?.x,
    args.viewport?.y,
    args.viewport?.w,
    args.viewport?.h,
    args.stageScale,
    pageDims,
    cache,
    scheduler,
    scheduleFlush,
  ]);

  const visibleTiles = useMemo(() => {
    if (!enabled || !args.sheetId || !args.viewport || !pageDims) return [];
    const bucket = pickZoomBucket(args.stageScale);
    const coords = visibleTileCoords({
      page: pageDims,
      viewport: args.viewport,
      zoomBucket: bucket,
      sheetId: args.sheetId,
      pageIndex: args.pageIndex,
    });
    const out: Array<{ coord: TileCoord; bitmap: ImageBitmap }> = [];
    for (const c of coords) {
      const bm = cache.get(c);
      if (bm) out.push({ coord: c, bitmap: bm });
    }
    return out;
  }, [
    enabled,
    args.sheetId,
    args.pageIndex,
    args.viewport?.x,
    args.viewport?.y,
    args.viewport?.w,
    args.viewport?.h,
    args.stageScale,
    pageDims,
    cache,
  ]);

  const getTextItems = useCallback(async () => {
    if (!args.sheetUrl || !scheduler) return [] as string[];
    const res = await scheduler.getTextItems(args.sheetUrl, args.pageIndex);
    return res.items;
  }, [args.sheetUrl, args.pageIndex, scheduler]);

  const stats = cache.stats();
  return {
    pageDims,
    placeholder,
    placeholderError,
    visibleTiles,
    isLoadingPlaceholder: loadingPlaceholder,
    isAnyTileLoading: loadingTileCount > 0,
    cacheStats: { size: stats.size, bytes: stats.bytes, budget: stats.budget },
    getTextItems,
  };
}
