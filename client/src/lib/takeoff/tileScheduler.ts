/**
 * Task #2138 — Worker pool + priority scheduler that orchestrates the
 * `pdfTileWorker` instances. The scheduler owns:
 *
 *   • A small pool of dedicated workers (capped at 4) so multiple
 *     tiles render in parallel without saturating the user's CPU on
 *     low-end laptops.
 *   • A priority queue keyed by viewport-center distance so the tile
 *     under the user's cursor renders first.
 *   • Pending-request bookkeeping so a viewport change can `cancel()`
 *     stale requests and the worker stops fielding them once the user
 *     pans somewhere else.
 *
 * It deliberately does *not* know anything about React, Konva, or the
 * `TileCache`; the consuming hook (`use-pdf-tile-renderer`) wires
 * those layers together.
 */

import {
  tileKey,
  type TileCoord,
  type ViewportWorldRect,
  tileDistanceFromViewportCenter,
  type ZoomBucket,
} from "./tileCoords";

interface PoolWorker {
  worker: Worker;
  inflight: number;
  pending: Map<number, PendingRequest>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  cancelled: boolean;
}

let nextRequestId = 1;

/**
 * Task #2292 — Cross-engine call counter for the worker pipeline.
 *
 * The chromium-only `longtask` PerformanceObserver gate in
 * `e2e/pdf-preview-worker-only.spec.ts` proves "no main-thread JS
 * burst happened during render" but is silently a no-op on
 * Gecko/WebKit (those engines never emit `longtask` entries). To get
 * a real "pdfjs actually flowed through the worker pool" signal on
 * every engine, we expose a tiny call counter here that the e2e spec
 * can read via `page.evaluate`.
 *
 * The counters increment as soon as a `getDocumentInfo` /
 * `renderPage` call is dispatched (i.e. after the worker `postMessage`
 * fires). A regression that re-introduced main-thread
 * `pdfjs.getDocument(url).promise.then(p => p.render(...))` in any
 * `<PdfPreview>` / `<PlanDocumentPrintPage>` consumer would bypass
 * this scheduler entirely, so the canvas could still paint pixels but
 * the counters would stay at 0 on every engine — which is the
 * cross-engine assertion the spec now enforces.
 *
 * The shape is intentionally minimal so app code paths stay cheap; we
 * only attach the object on first use so non-browser environments
 * (jsdom, server-side rendering) don't try to mutate `window`.
 */
export interface TileSchedulerStats {
  /** Number of `scheduler.renderPage(...)` dispatches since page load. */
  renderPageCalls: number;
  /** Number of `scheduler.getDocumentInfo(...)` dispatches since page load. */
  getDocumentInfoCalls: number;
}

declare global {
  interface Window {
    __pdfTileSchedulerStats?: TileSchedulerStats;
  }
}

function bumpStat(field: keyof TileSchedulerStats): void {
  if (typeof window === "undefined") return;
  const existing = window.__pdfTileSchedulerStats;
  if (!existing) {
    window.__pdfTileSchedulerStats = {
      renderPageCalls: 0,
      getDocumentInfoCalls: 0,
      [field]: 1,
    } as TileSchedulerStats;
    return;
  }
  existing[field] = (existing[field] ?? 0) + 1;
}

function spawnWorker(): Worker {
  return new Worker(
    new URL("../../workers/pdfTileWorker.ts", import.meta.url),
    { type: "module", name: "pdf-tile-worker" },
  );
}

function defaultPoolSize(): number {
  const hw =
    typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4;
  return Math.max(1, Math.min(6, Math.floor(hw)));
}

export interface TileRequest {
  coord: TileCoord;
  sheetUrl: string;
  priority: number;
}

export interface TileResult {
  coord: TileCoord;
  bitmap: ImageBitmap;
  empty: boolean;
}

export interface PageDimsResult {
  width: number;
  height: number;
}

export interface PlaceholderResult {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

type WorkerResponse = {
  type: string;
  requestId: number;
  ok: boolean;
  error?: string;
  // Task #2188 — pdfjs error metadata (name + HTTP status) forwarded
  // from the worker so the Plan Markup preview can show its existing
  // friendly error text (e.g. "missing on the server") instead of the
  // raw pdfjs message.
  errorName?: string;
  errorStatus?: number;
  bitmap?: ImageBitmap;
  width?: number;
  height?: number;
  empty?: boolean;
  items?: string[];
  numPages?: number;
};

/**
 * Task #2188 — Subclass of Error that preserves the pdfjs exception
 * `name` (e.g. "MissingPDFException") and the HTTP `status` from
 * `UnexpectedResponseException`. Callers (PdfPreview) inspect these
 * fields to map the error onto a friendly user-facing message.
 */
export class WorkerPdfError extends Error {
  readonly errorName: string | undefined;
  readonly status: number | undefined;
  constructor(message: string, errorName?: string, status?: number) {
    super(message);
    this.name = errorName || "WorkerPdfError";
    this.errorName = errorName;
    this.status = status;
  }
}

/**
 * Task #2188 — Handle returned from `renderPage`. Lets callers cancel
 * an in-flight full-page render (e.g. when the user changes page or
 * zoom mid-render in the Plan Markup viewer) so the worker can stop
 * the underlying pdfjs render task instead of burning CPU on a result
 * the consumer is going to discard.
 */
export interface CancellablePageRender {
  promise: Promise<{ bitmap: ImageBitmap; width: number; height: number }>;
  cancel: () => void;
}

export class TileScheduler {
  private pool: PoolWorker[] = [];
  private queue: Array<{
    request: TileRequest;
    enqueueOrder: number;
  }> = [];
  private enqueueCounter = 0;
  private inflightTiles = new Map<string, Promise<TileResult>>();
  // Tracks the worker + worker-side requestId for each tile that has
  // already been dispatched, so `cancelOutsideViewport` can post a
  // `cancelTile` message and the worker can call `RenderTask.cancel()`
  // on the in-flight pdfjs render. Without this, viewport changes only
  // pruned the queue and let the worker burn CPU on tiles we no longer
  // need.
  private inflightTileDispatch = new Map<
    string,
    { worker: Worker; requestId: number }
  >();
  private cancelledTiles = new Set<string>();
  private destroyed = false;
  private currentViewport: ViewportWorldRect | null = null;
  private currentSheetId: string | null = null;
  // Batch-pump optimisation: instead of sorting + dispatching after every
  // single requestTile insertion, we mark the queue dirty and schedule a
  // microtask pump.  All requestTile calls that land in the same synchronous
  // loop (e.g. the initial 50-tile viewport fill) accumulate before the first
  // sort fires, reducing ~50 O(n log n) sorts to a single one.
  private pumpScheduled = false;
  private queueDirty = false;

  constructor(poolSize: number = defaultPoolSize()) {
    // Extracted so the error handler can spawn a replacement without
    // duplicating the message + error listener wiring.
    const addWorker = () => {
      const w = spawnWorker();
      const pw: PoolWorker = { worker: w, inflight: 0, pending: new Map() };
      w.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
        this.onMessage(pw, e.data);
      });
      w.addEventListener("error", () => {
        // Reject all in-flight requests so .catch() / .finally(batchDecrement)
        // handlers fire and loadingTileCount is properly decremented.
        pw.pending.forEach((req) => {
          req.reject(new Error("worker error"));
        });
        pw.pending.clear();
        pw.inflight = 0;
        // Remove stale inflightTileDispatch entries pointing at this dead
        // worker so that cancelOutsideViewport does not try to postMessage
        // a terminated worker (silently dropped per the HTML spec).
        this.inflightTileDispatch.forEach((entry, k) => {
          if (entry.worker === pw.worker) {
            this.inflightTileDispatch.delete(k);
          }
        });
        // Remove the dead worker from the pool and spawn a fresh replacement.
        // Without this fix, the dead worker (inflight=0) is first-picked by
        // pickLeastBusy(), its postMessages are silently dropped (terminated
        // workers ignore new messages per the HTML spec), and the in-flight
        // promises hang forever — leaving the tile-loading spinner stuck and
        // canvas cells permanently blank.
        const idx = this.pool.indexOf(pw);
        if (idx !== -1 && !this.destroyed) {
          this.pool.splice(idx, 1);
          try {
            addWorker(); // replace with a fresh healthy worker
          } catch {
            // If spawning fails the pool runs with one fewer worker;
            // tiles still render, just more slowly.
          }
          this.schedulePump(); // re-dispatch any queued tiles to healthy workers
        }
      });
      this.pool.push(pw);
    };
    for (let i = 0; i < poolSize; i++) {
      addWorker();
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const pw of this.pool) {
      try {
        pw.worker.terminate();
      } catch {
        /* noop */
      }
    }
    this.pool = [];
    this.queue = [];
    this.inflightTiles.clear();
  }

  /**
   * Update the active viewport. New `requestTile` calls compute their
   * priority against this viewport at enqueue time, and the current
   * queue is re-sorted so the user's center renders first.
   */
  setViewport(
    viewport: ViewportWorldRect,
    currentSheetId: string | null,
  ): void {
    this.currentViewport = viewport;
    this.currentSheetId = currentSheetId;
    for (const item of this.queue) {
      item.request.priority = this.computePriority(item.request.coord);
    }
    this.queue.sort(
      (a, b) =>
        a.request.priority - b.request.priority ||
        a.enqueueOrder - b.enqueueOrder,
    );
    // A fresh sort was just applied — clear the dirty flag so pump()
    // doesn't redundantly re-sort when it runs next.
    this.queueDirty = false;
  }

  private computePriority(coord: TileCoord): number {
    if (!this.currentViewport) return 0;
    const sheetWeight =
      this.currentSheetId && coord.sheetId === this.currentSheetId ? 0 : 1e9;
    return (
      sheetWeight + tileDistanceFromViewportCenter(coord, this.currentViewport)
    );
  }

  /**
   * Push a tile-render request onto the queue. Priority is computed
   * from the most recent `setViewport` call so the closest-to-center
   * tile dispatches first regardless of insertion order. If the same
   * coord is already pending, returns the existing promise so
   * duplicate calls coalesce into a single render.
   */
  requestTile(request: TileRequest): Promise<TileResult> {
    const k = tileKey(request.coord);
    const existing = this.inflightTiles.get(k);
    if (existing) return existing;
    this.cancelledTiles.delete(k);
    const computed = this.computePriority(request.coord);
    const p = new Promise<TileResult>((resolve, reject) => {
      this.queue.push({
        request: {
          ...request,
          priority: computed,
          _resolve: resolve,
          _reject: reject,
        } as TileRequest & {
          _resolve: (r: TileResult) => void;
          _reject: (e: Error) => void;
        },
        enqueueOrder: this.enqueueCounter++,
      });
    });
    this.inflightTiles.set(k, p);
    p.finally(() => {
      this.inflightTiles.delete(k);
    }).catch(() => undefined);
    // Mark dirty and defer — all tiles inserted in the same synchronous
    // loop will accumulate before the single microtask sort+dispatch.
    this.queueDirty = true;
    this.schedulePump();
    return p;
  }

  /**
   * Backwards-compatible alias for `setViewport`. Kept so callers that
   * already invoke this in a tight loop don't have to change.
   */
  reprioritize(viewport: ViewportWorldRect, currentSheetId: string | null): void {
    this.setViewport(viewport, currentSheetId);
  }

  /**
   * Returns true when `coord` has already been dispatched to a worker
   * or is sitting in the pending queue.  Callers use this to avoid
   * attaching a second `.finally` callback to the same promise when
   * they want to issue a speculative/pyramid request for a tile that
   * is already in-flight.
   */
  isInflight(coord: TileCoord): boolean {
    return this.inflightTiles.has(tileKey(coord));
  }

  /**
   * Drop queued requests whose coords are no longer in `queueKeepKeys`.
   *
   * Two-phase cancellation lets callers use a tighter set for the
   * pending queue (so unstarted low-priority tiles don't hold a queue
   * slot) while letting dispatched renders finish with a wider set:
   *
   *   • `queueKeepKeys`    — tiles NOT in this set are rejected from
   *     the pending queue immediately (fast worker-slot reclaim).
   *   • `dispatchKeepKeys` — tiles NOT in this set that are already
   *     rendering inside a worker receive a `cancelTile` message.
   *     Defaults to `queueKeepKeys` when omitted (original behaviour).
   *
   * Keeping dispatched pyramid tiles alive (via a wider
   * `dispatchKeepKeys`) lets them finish and populate the cache as a
   * backdrop while high-res tiles load, without letting unstarted
   * pyramid tiles block the queue.
   */
  cancelOutsideViewport(
    queueKeepKeys: Set<string>,
    dispatchKeepKeys: Set<string> = queueKeepKeys,
  ): void {
    const next: typeof this.queue = [];
    for (const item of this.queue) {
      const k = tileKey(item.request.coord);
      if (queueKeepKeys.has(k)) {
        next.push(item);
      } else {
        const req = item.request as TileRequest & {
          _resolve?: (r: TileResult) => void;
          _reject?: (e: Error) => void;
        };
        this.cancelledTiles.add(k);
        this.inflightTiles.delete(k);
        req._reject?.(new Error("cancelled"));
      }
    }
    this.queue = next;
    // Tell the worker to abort dispatched tiles that are outside the
    // (potentially wider) dispatch keep-set.
    this.inflightTileDispatch.forEach((entry, k) => {
      if (!dispatchKeepKeys.has(k)) {
        this.cancelledTiles.add(k);
        this.postCancelTile(entry.worker, entry.requestId);
        this.inflightTileDispatch.delete(k);
      }
    });
  }

  cancelAllForSheet(sheetId: string): void {
    const next: typeof this.queue = [];
    for (const item of this.queue) {
      if (item.request.coord.sheetId === sheetId) {
        const req = item.request as TileRequest & {
          _reject?: (e: Error) => void;
        };
        const k = tileKey(item.request.coord);
        this.cancelledTiles.add(k);
        this.inflightTiles.delete(k);
        req._reject?.(new Error("sheet evicted"));
      } else {
        next.push(item);
      }
    }
    this.queue = next;
    // Abort dispatched-but-not-yet-finished tiles for this sheet.
    this.inflightTileDispatch.forEach((entry, k) => {
      if (k.startsWith(`${sheetId}|`)) {
        this.cancelledTiles.add(k);
        this.postCancelTile(entry.worker, entry.requestId);
        this.inflightTileDispatch.delete(k);
      }
    });
  }

  private postCancelTile(worker: Worker, targetRequestId: number): void {
    try {
      worker.postMessage({
        type: "cancelTile",
        requestId: nextRequestId++,
        targetRequestId,
      });
    } catch {
      /* worker may already be terminated; harmless */
    }
  }

  /**
   * One-off requests that don't go through the priority queue: the
   * scheduler picks the least-busy worker and dispatches immediately.
   * Used for placeholder/page-dim/thumbnail/text-content calls that
   * are infrequent and on the critical path.
   */
  getPageDims(sheetUrl: string, pageIndex: number): Promise<PageDimsResult> {
    return this.dispatchOnce<PageDimsResult>({
      type: "getPageDims",
      sheetUrl,
      pageIndex,
    });
  }

  /**
   * Task #2188 — Document-level metadata fetch (currently just
   * `numPages`). Used by the Plan Markup preview and the print page so
   * they can drive their page strip / per-page render loop without
   * importing pdfjs on the main thread.
   */
  getDocumentInfo(sheetUrl: string): Promise<{ numPages: number }> {
    // Task #2292 — record the dispatch on the cross-engine counter
    // before posting to the worker so the e2e spec can prove the
    // worker pipeline ran on Firefox / Safari (where the longtask
    // observer is silent). See `bumpStat` above.
    bumpStat("getDocumentInfoCalls");
    return this.dispatchOnce<{ numPages: number }>({
      type: "getDocumentInfo",
      sheetUrl,
    });
  }

  /**
   * Task #2188 — Render a full PDF page at an arbitrary `scale`.
   * Returns a cancellable handle so the Plan Markup viewer can abort
   * an in-flight render when the user changes page or zoom mid-render.
   */
  renderPage(
    sheetUrl: string,
    pageIndex: number,
    scale: number,
  ): CancellablePageRender {
    if (this.destroyed) {
      return {
        promise: Promise.reject(new Error("destroyed")),
        cancel: () => undefined,
      };
    }
    if (this.pool.length === 0) {
      return {
        promise: Promise.reject(new Error("no workers available")),
        cancel: () => undefined,
      };
    }
    // Task #2292 — record the dispatch on the cross-engine counter so
    // the e2e spec can prove a full-page render flowed through the
    // worker pool on Firefox / Safari (where the longtask observer is
    // silent). Bumped here (not after `postMessage`) so the counter
    // reflects user-visible intent even if the worker subsequently
    // rejects — the regression we're guarding against is "a consumer
    // bypassed the scheduler entirely", not "the worker errored".
    bumpStat("renderPageCalls");
    const pw = this.pickLeastBusy();
    const requestId = nextRequestId++;
    let cancelled = false;
    const promise = new Promise<{
      bitmap: ImageBitmap;
      width: number;
      height: number;
    }>((resolve, reject) => {
      pw.pending.set(requestId, {
        resolve: (value) => {
          if (cancelled) {
            const v = value as { bitmap?: ImageBitmap };
            try { v.bitmap?.close(); } catch { /* noop */ }
            reject(new Error("cancelled"));
            return;
          }
          const v = value as {
            bitmap: ImageBitmap;
            width: number;
            height: number;
          };
          resolve({ bitmap: v.bitmap, width: v.width, height: v.height });
        },
        reject,
        cancelled: false,
      });
      pw.inflight++;
      pw.worker.postMessage({
        type: "renderPage",
        requestId,
        sheetUrl,
        pageIndex,
        scale,
      });
    });
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      try {
        pw.worker.postMessage({
          type: "cancelPage",
          requestId: nextRequestId++,
          targetRequestId: requestId,
        });
      } catch {
        /* worker may already be terminated; harmless */
      }
    };
    return { promise, cancel };
  }

  renderPlaceholder(
    sheetUrl: string,
    pageIndex: number,
    zoomBucket: ZoomBucket,
  ): Promise<PlaceholderResult> {
    return this.dispatchOnce<PlaceholderResult>({
      type: "renderPlaceholder",
      sheetUrl,
      pageIndex,
      zoomBucket,
    });
  }

  renderThumbnail(
    sheetUrl: string,
    pageIndex: number,
    maxWidth: number,
    maxHeight: number,
  ): Promise<{ bitmap: ImageBitmap }> {
    return this.dispatchOnce<{ bitmap: ImageBitmap }>({
      type: "renderThumbnail",
      sheetUrl,
      pageIndex,
      maxWidth,
      maxHeight,
    });
  }

  getTextItems(
    sheetUrl: string,
    pageIndex: number,
  ): Promise<{ items: string[] }> {
    return this.dispatchOnce<{ items: string[] }>({
      type: "getTextItems",
      sheetUrl,
      pageIndex,
    });
  }

  evictSheet(sheetUrl: string): Promise<void> {
    return this.dispatchOnce<void>({ type: "evictSheet", sheetUrl }).then(
      () => undefined,
    );
  }

  private dispatchOnce<T>(payload: Record<string, unknown>): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error("destroyed"));
    if (this.pool.length === 0) return Promise.reject(new Error("no workers available"));
    const pw = this.pickLeastBusy();
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pw.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        cancelled: false,
      });
      pw.inflight++;
      pw.worker.postMessage({ ...payload, requestId });
    });
  }

  private pickLeastBusy(): PoolWorker {
    let best = this.pool[0];
    for (const pw of this.pool) {
      if (pw.inflight < best.inflight) best = pw;
    }
    return best;
  }

  /**
   * Defers a `pump()` call to the next microtask. All `requestTile`
   * calls that land in the same synchronous loop accumulate on the
   * queue first; the single microtask fires one sort + dispatch over
   * the full batch instead of N separate per-insertion sorts.
   *
   * `onMessage` still calls `pump()` directly (not via this helper)
   * so a just-freed worker slot is filled immediately rather than
   * waiting an extra microtask tick.
   */
  private schedulePump(): void {
    if (this.pumpScheduled || this.destroyed) return;
    this.pumpScheduled = true;
    Promise.resolve().then(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.destroyed) return;
    // Guard: if all workers crashed (addWorker failed inside the error handler's
    // try/catch), the pool can be transiently empty. Stop here — schedulePump()
    // will be called again once a replacement worker is available.
    if (this.pool.length === 0) return;
    // Lazy sort: only re-order when new tiles were inserted since the
    // last sort (queueDirty=true). setViewport() sorts immediately and
    // clears the flag, so this is a no-op after a viewport change.
    if (this.queueDirty && this.queue.length > 1) {
      this.queue.sort(
        (a, b) =>
          a.request.priority - b.request.priority ||
          a.enqueueOrder - b.enqueueOrder,
      );
      this.queueDirty = false;
    }
    while (this.queue.length > 0) {
      const pw = this.pickLeastBusy();
      // Raised from 2 → 3 inflight per worker (6 workers × 3 = 18
      // concurrent tile renders vs the previous 12) for faster initial
      // viewport fill without overloading a single worker.
      if (pw.inflight >= 3) break;
      const item = this.queue.shift()!;
      const k = tileKey(item.request.coord);
      if (this.cancelledTiles.has(k)) continue;
      const requestId = nextRequestId++;
      const req = item.request as TileRequest & {
        _resolve?: (r: TileResult) => void;
        _reject?: (e: Error) => void;
      };
      pw.pending.set(requestId, {
        resolve: (value) => {
          if (this.cancelledTiles.has(k)) {
            const v = value as { bitmap?: ImageBitmap };
            try {
              v.bitmap?.close();
            } catch {
              /* noop */
            }
            this.cancelledTiles.delete(k);
            req._reject?.(new Error("cancelled"));
            return;
          }
          const v = value as { bitmap: ImageBitmap; empty: boolean };
          req._resolve?.({
            coord: item.request.coord,
            bitmap: v.bitmap,
            empty: !!v.empty,
          });
        },
        reject: (err) => {
          req._reject?.(err);
        },
        cancelled: false,
      });
      pw.inflight++;
      this.inflightTileDispatch.set(k, { worker: pw.worker, requestId });
      pw.worker.postMessage({
        type: "renderTile",
        requestId,
        sheetUrl: item.request.sheetUrl,
        pageIndex: item.request.coord.pageIndex,
        zoomBucket: item.request.coord.zoomBucket,
        tileX: item.request.coord.tileX,
        tileY: item.request.coord.tileY,
      });
    }
  }

  private onMessage(pw: PoolWorker, data: WorkerResponse): void {
    const p = pw.pending.get(data.requestId);
    if (!p) return;
    pw.pending.delete(data.requestId);
    pw.inflight = Math.max(0, pw.inflight - 1);
    // Clean up dispatch tracking for tile responses (cancel or success).
    if (this.inflightTileDispatch.size > 0) {
      this.inflightTileDispatch.forEach((entry, key) => {
        if (entry.requestId === data.requestId) {
          this.inflightTileDispatch.delete(key);
        }
      });
    }
    if (data.ok === false) {
      // Task #2188 — surface pdfjs error metadata (name + status) so
      // callers can render the same friendly error states they did
      // when they called pdfjs directly on the main thread.
      p.reject(
        new WorkerPdfError(
          data.error || "render failed",
          data.errorName,
          data.errorStatus,
        ),
      );
    } else {
      p.resolve(data);
    }
    this.pump();
  }
}

let _shared: TileScheduler | null = null;

/**
 * Returns the process-shared TileScheduler, lazily constructing it on
 * first use. Returns `null` in environments that don't expose a
 * `Worker` global (jsdom unit tests, ancient browsers, server-side
 * rendering) so callers can degrade gracefully instead of throwing
 * during construction. Callers should treat `null` the same as the
 * `takeoff_tile_renderer` flag being off.
 */
export function getSharedScheduler(): TileScheduler | null {
  if (_shared) return _shared;
  if (typeof Worker === "undefined") return null;
  try {
    _shared = new TileScheduler();
  } catch {
    _shared = null;
  }
  return _shared;
}

export function resetSharedSchedulerForTests(): void {
  _shared?.destroy();
  _shared = null;
}
