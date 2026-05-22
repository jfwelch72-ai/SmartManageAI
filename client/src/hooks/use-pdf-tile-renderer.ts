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
import { TileCache, computeDeviceAwareTileBudget } from "@/lib/takeoff/tileCache";
import {
  PLACEHOLDER_BUCKET,
  ZOOM_BUCKETS,
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

// Task #2405 — size the shared cache from `navigator.deviceMemory` so a
// 32 GB workstation gets ~1.5 GB of headroom while a 4 GB Chromebook
// stays at the 256 MB floor. Per-call `cache` overrides still win.
const DEFAULT_CACHE = new TileCache(computeDeviceAwareTileBudget());

// Task #2446 — Expose the shared cache on `window` in non-production
// builds so the env-gated 25 GB e2e spec (`takeoff-large-pdf.spec.ts`)
// can poll `stats()` to assert the byte budget holds across a 10-sheet
// flip sequence. Production builds skip this so the cache stays
// internal. Type-only declaration keeps the hook self-contained.
if (
  typeof window !== "undefined" &&
  import.meta.env.MODE !== "production"
) {
  (window as unknown as { __takeoffDefaultTileCache?: TileCache }).__takeoffDefaultTileCache =
    DEFAULT_CACHE;
}

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
  // `tick` is exposed to visibleTiles useMemo (see dep list below) so
  // that `scheduleFlush()` forces a fresh cache read after every tile
  // arrival or eviction. Without this, the memo returned the STALE
  // tile array (which still contained the just-evicted bitmap) and
  // `deferredCloseBitmap` could close that bitmap while Konva was
  // still drawing it — producing the
  // "Failed to execute 'drawImage'… image source is detached" crash.
  const [tick, setTick] = useState(0);
  const [loadingPlaceholder, setLoadingPlaceholder] = useState(false);
  const [loadingTileCount, setLoadingTileCount] = useState(0);
  const lastSheetRef = useRef<string | null>(null);
  const lastVisibleKeysRef = useRef<Set<string>>(new Set());
  // Batch loadingTileCount decrements with RAF so N tiles completing in
  // the same frame don't each fire a separate setState (N re-renders).
  const pendingDecrRef = useRef(0);
  const decrRafRef = useRef(false);
  // Zoom-settle timer: when stageScale changes rapidly (wheel zoom),
  // defer expensive tile cancellations and new requests by 150 ms so we
  // don't thrash the scheduler — cancelling and re-requesting tiles on
  // every ~16 ms RAF tick — while the user is still pinching/scrolling.
  // Pure pans (same stageScale, different viewport x/y) still fire
  // immediately because prevScaleRef stays equal.
  const prevStageScaleRef = useRef<number | null>(null);
  const zoomSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const viewport = args.viewport;
    const stageScale = args.stageScale;

    // Detect whether stageScale actually changed since the last run.
    // If it did, the user is mid-zoom: defer the expensive work so we
    // don't cancel + re-request tiles on every ~16 ms wheel tick.
    const scaleChanged =
      prevStageScaleRef.current !== null &&
      prevStageScaleRef.current !== stageScale;
    prevStageScaleRef.current = stageScale;

    // Always do the cheap priority update immediately so tiles that are
    // already queued sort toward the new viewport center.
    scheduler.setViewport(viewport, sheetId);
    cache.setViewport(viewport, sheetId);

    // RAF-batched decrement helper: N tiles completing in the same frame
    // produce a single setState instead of N individual re-renders.
    const batchDecrement = () => {
      pendingDecrRef.current++;
      if (decrRafRef.current) return;
      decrRafRef.current = true;
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          decrRafRef.current = false;
          const n = pendingDecrRef.current;
          pendingDecrRef.current = 0;
          if (n > 0) setLoadingTileCount((c) => Math.max(0, c - n));
        });
      } else {
        Promise.resolve().then(() => {
          decrRafRef.current = false;
          const n = pendingDecrRef.current;
          pendingDecrRef.current = 0;
          if (n > 0) setLoadingTileCount((c) => Math.max(0, c - n));
        });
      }
    };

    // The expensive part: cancel stale tiles + request new ones.
    // When scale is changing rapidly, defer this by 150 ms so we only
    // thrash once per zoom gesture rather than once per wheel tick.
    const doTileUpdates = () => {
      const bucket: ZoomBucket = pickZoomBucket(stageScale);
      const bucketIdx = (ZOOM_BUCKETS as ReadonlyArray<ZoomBucket>).indexOf(bucket);
      const coords = visibleTileCoords({
        page: pageDims,
        viewport,
        zoomBucket: bucket,
        sheetId,
        pageIndex,
      });

      // Build a "keep" set spanning ALL pyramid levels (bucket 0.25 →
      // current bucket) that are visible in the current viewport.
      //
      // Why both uses matter:
      //   1. cancelOutsideViewport(keepKeys) — keeps any in-flight
      //      lower-bucket renders alive so they can fill the pyramid
      //      backdrop instead of being needlessly aborted.
      //   2. lastVisibleKeysRef.current = keepKeys — the .then() handler
      //      caches arriving lower-bucket tiles (instead of close()-ing
      //      them), so the pyramid useMemo in visibleTiles can find them.
      //
      // Without this, zooming rapidly across bucket levels left the
      // pyramid empty: lower-bucket in-flight tiles were cancelled by
      // cancelOutsideViewport and any that did arrive were close()'d
      // because lastVisibleKeysRef only contained current-bucket keys.
      // The canvas then fell back to the 0.25× placeholder which at
      // stageScale ≥ 4 appears completely dark/blurry — the "PDF can't
      // render" symptom the user reported.
      const keepKeys = new Set<string>();
      coords.forEach((c) => keepKeys.add(tileKey(c)));
      for (let bi = 0; bi < bucketIdx; bi++) {
        const fb = ZOOM_BUCKETS[bi];
        visibleTileCoords({ page: pageDims, viewport, zoomBucket: fb, sheetId, pageIndex })
          .forEach((c) => keepKeys.add(tileKey(c)));
      }
      lastVisibleKeysRef.current = keepKeys;
      scheduler.cancelOutsideViewport(keepKeys);

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
          .finally(batchDecrement);
      }
      if (issued > 0) {
        setLoadingTileCount((n) => n + issued);
      } else {
        scheduleFlush();
      }
    };

    if (scaleChanged) {
      // Scale is actively changing — cancel any earlier settle timer and
      // restart the countdown. Only the last zoom position within the
      // 150 ms window triggers tile work.
      if (zoomSettleTimerRef.current !== null) {
        clearTimeout(zoomSettleTimerRef.current);
      }
      zoomSettleTimerRef.current = setTimeout(() => {
        zoomSettleTimerRef.current = null;
        doTileUpdates();
      }, 150);
    } else {
      // Pure pan (scale unchanged) — update tiles immediately.
      doTileUpdates();
    }

    return () => {
      if (zoomSettleTimerRef.current !== null) {
        clearTimeout(zoomSettleTimerRef.current);
        zoomSettleTimerRef.current = null;
      }
    };
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
    const bucketIdx = ZOOM_BUCKETS.indexOf(bucket);

    // Tile-pyramid fallback: walk from the coarsest bucket up to the
    // current target bucket and include any tiles that are already in
    // cache.  Lower-quality (lower-bucket) tiles are pushed first so
    // Konva draws them behind the higher-quality ones — painter's
    // algorithm.  This means that when the user zooms across a bucket
    // boundary and the new-bucket tiles are still loading (150 ms
    // debounce + worker render time), the canvas shows cached
    // lower-res tiles for uncovered areas instead of falling back to
    // the blurry full-page placeholder, eliminating the jarring
    // "dark-split" artifact seen when rapidly zooming in.
    const out: Array<{ coord: TileCoord; bitmap: ImageBitmap }> = [];
    for (let bi = 0; bi <= bucketIdx; bi++) {
      const fb = ZOOM_BUCKETS[bi];
      const coords = visibleTileCoords({
        page: pageDims,
        viewport: args.viewport,
        zoomBucket: fb,
        sheetId: args.sheetId,
        pageIndex: args.pageIndex,
      });
      for (const c of coords) {
        const bm = cache.get(c);
        if (bm) out.push({ coord: c, bitmap: bm });
      }
    }
    return out;
  }, [
    // `tick` is intentionally first — `scheduleFlush()` bumps it on
    // every tile arrival AND after every cache eviction so this memo
    // always reads a fresh slice from the cache. Without it the memo
    // returned a stale array that still referenced an already-evicted
    // (and deferredClosed) bitmap, which Konva would then try to
    // drawImage two frames later → "image source is detached".
    tick,
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
