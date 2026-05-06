/**
 * Task #2138 — Byte-budget LRU cache for rasterized PDF tiles. Tiles
 * outside the visible viewport stay resident while the cache is under
 * its byte budget; over budget, eviction starts at the oldest entry
 * (Map iteration order is insertion order, and `get()` re-inserts so
 * "recently used" floats to the back). Sheets share one budget so a
 * back-and-forth sheet-flip flow keeps both sheets resident.
 *
 * `MAX_BYTES_DEFAULT` is the canonical, single-source-of-truth budget
 * referenced by the architectural constraint in task-2138 ("the byte
 * budget is non-negotiable and is configurable via a constant in one
 * place"). Bumping it here is the only knob.
 */

import {
  estimateTileBytes,
  tileKey,
  tileDistanceFromViewportCenter,
  type TileCoord,
  type ViewportWorldRect,
} from "./tileCoords";

/**
 * Task #2405 — Device-aware default budget.
 *
 * The legacy 600 MB constant was tuned for a developer laptop and was
 * either *too small* on workstations (estimators on 32 GB iMacs were
 * thrashing the cache during pan on a 300-sheet planset) or *too big*
 * on field tablets (4 GB Chromebooks were getting `out-of-memory`
 * worker crashes after a few sheet flips). Browsers expose
 * `navigator.deviceMemory` as a coarse hint (in GiB, capped at 8) which
 * is enough to scale the budget sensibly without per-machine config.
 *
 * Floor: 256 MB so the smallest-possible viewer still has room for the
 * active sheet plus one prefetched neighbour.
 * Ceiling: 1.5 GB so we never starve the rest of the page on a beefy
 * machine.
 *
 * The exported constant is preserved as the *floor* so existing tests
 * and explicit `new TileCache(MAX_TILE_CACHE_BYTES_DEFAULT)` callers
 * keep their previous behaviour.
 */
export const MAX_TILE_CACHE_BYTES_DEFAULT = 600 * 1024 * 1024;
export const MIN_TILE_CACHE_BYTES = 256 * 1024 * 1024;
export const MAX_TILE_CACHE_BYTES_CEILING = 1.5 * 1024 * 1024 * 1024;
/** Per-document soft cap as a fraction of the global budget. When a
 *  single sheet's tiles exceed this share the cache prefers to evict
 *  *that sheet's* farthest tiles before touching others — so an
 *  oversized planset can't squeeze a still-visible second sheet out
 *  of cache during a back-and-forth flip. */
export const PER_DOCUMENT_SOFT_CAP_FRACTION = 0.6;

export function computeDeviceAwareTileBudget(): number {
  if (typeof navigator === "undefined") return MAX_TILE_CACHE_BYTES_DEFAULT;
  const memGib = (navigator as Navigator & { deviceMemory?: number })
    .deviceMemory;
  if (typeof memGib !== "number" || !Number.isFinite(memGib) || memGib <= 0) {
    return MAX_TILE_CACHE_BYTES_DEFAULT;
  }
  // 15 % of total RAM is the empirical sweet spot — large enough to
  // hold ~1 active sheet plus its prefetched neighbours, small enough
  // not to trigger Chrome's tab-discard heuristics under memory
  // pressure.
  const target = memGib * 0.15 * 1024 * 1024 * 1024;
  return Math.max(
    MIN_TILE_CACHE_BYTES,
    Math.min(MAX_TILE_CACHE_BYTES_CEILING, Math.round(target)),
  );
}

/** How long an evicted bitmap stays alive before we explicitly close it.
 *  See `deferredCloseBitmap` for rationale. Exported so tests can read
 *  the same constant. */
export const EVICTED_BITMAP_GRACE_MS = 1500;

/**
 * Defer an `ImageBitmap.close()` past every plausible Konva draw cycle.
 *
 * The cache hands bitmaps to consumers via `get()` and they may already
 * be embedded in the current render tree (Konva tile layer). If we
 * close synchronously — or even within the next few RAFs — when
 * evicting/replacing/clearing, Konva's already-scheduled batchDraw
 * tick can still call `drawImage(detachedBitmap)` and throw
 * "Failed to execute 'drawImage' on 'CanvasRenderingContext2D':
 *  The image source is detached".
 *
 * We tried 2 RAFs, then 3 RAFs — both still raced in production.
 * The race is fundamentally that React's setState (from
 * `scheduleFlush`) is async in concurrent mode, Konva's own batchDraw
 * uses its own RAF queue, and the eviction's RAFs were registered in
 * the same frame and fire BEFORE Konva's draw RAF when ordering goes
 * the wrong way. Adding more RAFs is a losing arms race.
 *
 * Switching to a generous wall-clock timeout (1.5s, ~90 frames at
 * 60fps) guarantees the evicted bitmap is gone from every Konva node
 * before we free it. The cost is a temporary memory overhang
 * (recently-evicted tiles stay in GPU memory for up to 1.5s) which
 * is bounded by the cache turnover rate and never grows unboundedly:
 * normal interaction evicts at most a few tiles per second, so the
 * worst-case overhang is a handful of extra MB.
 */
export function deferredCloseBitmap(bm: ImageBitmap | null | undefined): void {
  if (!bm) return;
  const close = () => {
    try {
      bm.close();
    } catch {
      /* noop — best-effort, older browsers may noop entirely */
    }
  };
  setTimeout(close, EVICTED_BITMAP_GRACE_MS);
}

export interface CachedTile {
  coord: TileCoord;
  bitmap: ImageBitmap;
  bytes: number;
  /** Monotonically-increasing tick for LRU tie-breaking. */
  touch: number;
}

export interface TileCacheStats {
  size: number;
  bytes: number;
  budget: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class TileCache {
  private map = new Map<string, CachedTile>();
  private budget: number;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private touchCounter = 0;
  private currentViewport: ViewportWorldRect | null = null;
  private currentSheetId: string | null = null;

  constructor(budget: number = MAX_TILE_CACHE_BYTES_DEFAULT) {
    this.budget = budget;
  }

  /**
   * Tell the cache where the user is looking. Eviction prefers tiles
   * that belong to other sheets first, then — within the active sheet
   * — the tile farthest from the viewport center. LRU is the
   * tie-breaker so a back-and-forth that revisits the same tiles
   * doesn't churn.
   */
  setViewport(
    viewport: ViewportWorldRect,
    currentSheetId: string | null,
  ): void {
    this.currentViewport = viewport;
    this.currentSheetId = currentSheetId;
  }

  setBudget(b: number): void {
    this.budget = Math.max(0, b);
    this.evictWhileOverBudget();
  }

  has(coord: TileCoord): boolean {
    return this.map.has(tileKey(coord));
  }

  get(coord: TileCoord): ImageBitmap | null {
    const k = tileKey(coord);
    const e = this.map.get(k);
    if (!e) {
      this.misses++;
      return null;
    }
    e.touch = ++this.touchCounter;
    this.hits++;
    return e.bitmap;
  }

  set(coord: TileCoord, bitmap: ImageBitmap): void {
    const k = tileKey(coord);
    const existing = this.map.get(k);
    if (existing) {
      this.map.delete(k);
      this.bytes -= existing.bytes;
      // Defer past the current Konva RAF so an in-flight drawImage
      // on the previous bitmap doesn't see a detached source. See
      // `deferredCloseBitmap` for full rationale.
      deferredCloseBitmap(existing.bitmap);
    }
    const bytes = estimateTileBytes();
    this.map.set(k, { coord, bitmap, bytes, touch: ++this.touchCounter });
    this.bytes += bytes;
    this.evictWhileOverBudget();
  }

  /**
   * Drop every cached tile for the given sheet — used when the sheet
   * itself was deleted or its underlying file was replaced and the
   * cached pixels are no longer faithful.
   */
  invalidateSheet(sheetId: string): void {
    const toRemove: string[] = [];
    this.map.forEach((e, k) => {
      if (e.coord.sheetId === sheetId) toRemove.push(k);
    });
    for (const k of toRemove) {
      const e = this.map.get(k)!;
      this.map.delete(k);
      this.bytes -= e.bytes;
      deferredCloseBitmap(e.bitmap);
    }
  }

  clear(): void {
    this.map.forEach((e) => {
      deferredCloseBitmap(e.bitmap);
    });
    this.map.clear();
    this.bytes = 0;
  }

  stats(): TileCacheStats {
    return {
      size: this.map.size,
      bytes: this.bytes,
      budget: this.budget,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  /**
   * Evict in this priority order until total bytes fit under budget:
   *   1. Tiles that don't belong to the active sheet (LRU among them).
   *   2. Active-sheet tiles farthest from the viewport center.
   *   3. LRU as the final tie-breaker if no viewport is set.
   *
   * O(n) per eviction is acceptable because n is bounded by the byte
   * budget (≈600 MB / ~1 MB per tile ≈ 600 entries) and evictions only
   * fire when the budget is breached.
   */
  private evictWhileOverBudget(): void {
    while (this.bytes > this.budget && this.map.size > 0) {
      const victimKey = this.pickEvictionVictim();
      if (!victimKey) break;
      const e = this.map.get(victimKey)!;
      this.map.delete(victimKey);
      this.bytes -= e.bytes;
      this.evictions++;
      // Defer the close past Konva's next draw cycle — see
      // `deferredCloseBitmap`. Konva may still hold a reference to
      // this bitmap from the current render and would otherwise throw
      // "image source is detached" the next time it ticks.
      deferredCloseBitmap(e.bitmap);
    }
  }

  private pickEvictionVictim(): string | null {
    const vp = this.currentViewport;
    const activeSheet = this.currentSheetId;

    // Task #2405 — Per-document soft cap. Compute each sheet's byte
    // share and, if any *single* sheet is over the soft cap fraction
    // of the global budget, prefer evicting from that sheet first
    // (its farthest-from-viewport tile). This keeps a 25 GB planset
    // from monopolising cache and pushing a recently-viewed sibling
    // sheet out during a back-and-forth flip.
    const perSheetBytes = new Map<string, number>();
    this.map.forEach((entry) => {
      perSheetBytes.set(
        entry.coord.sheetId,
        (perSheetBytes.get(entry.coord.sheetId) ?? 0) + entry.bytes,
      );
    });
    const softCap = this.budget * PER_DOCUMENT_SOFT_CAP_FRACTION;
    let dominantSheet: string | null = null;
    let dominantBytes = 0;
    perSheetBytes.forEach((bytes, sheetId) => {
      if (bytes > softCap && bytes > dominantBytes) {
        dominantSheet = sheetId;
        dominantBytes = bytes;
      }
    });

    let bestKey: string | null = null;
    let bestScore = -Infinity;
    this.map.forEach((entry, key) => {
      // Higher score → better eviction candidate.
      let score: number;
      if (activeSheet && entry.coord.sheetId !== activeSheet) {
        // Other-sheet tiles win first; oldest among them first.
        score = 1e15 - entry.touch;
      } else if (
        dominantSheet &&
        entry.coord.sheetId === dominantSheet &&
        entry.coord.sheetId !== activeSheet
      ) {
        // Soft cap violator (and not the active sheet) — second
        // priority after pure other-sheet tiles. Score sits between
        // the other-sheet band (1e15) and the active-sheet band
        // (1e9) so it always wins over active-sheet tiles but loses
        // to any non-active tile that's already eligible above.
        score =
          1e12 +
          (vp
            ? tileDistanceFromViewportCenter(entry.coord, vp)
            : -entry.touch);
      } else if (
        dominantSheet &&
        entry.coord.sheetId === dominantSheet &&
        vp
      ) {
        // Active sheet *is* the dominant sheet — fall back to
        // farthest-from-viewport eviction within it.
        score =
          1e9 +
          tileDistanceFromViewportCenter(entry.coord, vp) -
          entry.touch * 1e-6;
      } else if (vp) {
        score =
          1e9 +
          tileDistanceFromViewportCenter(entry.coord, vp) -
          entry.touch * 1e-6;
      } else {
        score = -entry.touch;
      }
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    });
    return bestKey;
  }
}
