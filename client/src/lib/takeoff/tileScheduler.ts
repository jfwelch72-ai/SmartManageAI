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
  return Math.max(1, Math.min(4, Math.floor(hw)));
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
  bitmap?: ImageBitmap;
  width?: number;
  height?: number;
  empty?: boolean;
  items?: string[];
};

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

  constructor(poolSize: number = defaultPoolSize()) {
    for (let i = 0; i < poolSize; i++) {
      const w = spawnWorker();
      const pw: PoolWorker = { worker: w, inflight: 0, pending: new Map() };
      w.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
        this.onMessage(pw, e.data);
      });
      w.addEventListener("error", () => {
        pw.pending.forEach((req) => {
          req.reject(new Error("worker error"));
        });
        pw.pending.clear();
        pw.inflight = 0;
      });
      this.pool.push(pw);
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
    this.queue.sort(
      (a, b) =>
        a.request.priority - b.request.priority ||
        a.enqueueOrder - b.enqueueOrder,
    );
    this.pump();
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
   * Drop queued requests whose coords are no longer in `keep`.
   * In-flight requests are flagged so their results are discarded on
   * arrival (the worker still finishes them — terminating mid-render
   * is more expensive than letting a tile finish and throwing it
   * away).
   */
  cancelOutsideViewport(keepKeys: Set<string>): void {
    const next: typeof this.queue = [];
    for (const item of this.queue) {
      const k = tileKey(item.request.coord);
      if (keepKeys.has(k)) {
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
    // Tell the worker to abort any tiles it has already started rendering
    // that are no longer in the keep set.
    this.inflightTileDispatch.forEach((entry, k) => {
      if (!keepKeys.has(k)) {
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

  private pump(): void {
    if (this.destroyed) return;
    while (this.queue.length > 0) {
      const pw = this.pickLeastBusy();
      if (pw.inflight >= 2) break;
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
      p.reject(new Error(data.error || "render failed"));
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
