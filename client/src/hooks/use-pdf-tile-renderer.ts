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
  type TileScheduler,
} from "@/lib/takeoff/tileScheduler";

export interface PdfTileRendererState {
  pageDims: PageDims | null;
  placeholder: ImageBitmap | null;
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
      setPlaceholder(null);
      return;
    }
    const prevSheet = lastSheetRef.current;
    if (prevSheet && prevSheet !== args.sheetId) {
      scheduler.cancelAllForSheet(prevSheet);
    }
    lastSheetRef.current = args.sheetId;
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
        setPlaceholder((prev) => {
          if (prev) {
            try {
              prev.close();
            } catch {
              /* noop */
            }
          }
          return res.bitmap;
        });
      })
      .catch(() => {
        /* surfaced via console in worker; UI keeps showing skeleton */
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
    visibleTiles,
    isLoadingPlaceholder: loadingPlaceholder,
    isAnyTileLoading: loadingTileCount > 0,
    cacheStats: { size: stats.size, bytes: stats.bytes, budget: stats.budget },
    getTextItems,
  };
}
