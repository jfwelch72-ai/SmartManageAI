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

export const MAX_TILE_CACHE_BYTES_DEFAULT = 600 * 1024 * 1024;

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
      try {
        existing.bitmap.close();
      } catch {
        // ImageBitmap.close is best-effort; older browsers may noop.
      }
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
      try {
        e.bitmap.close();
      } catch {
        /* noop */
      }
    }
  }

  clear(): void {
    this.map.forEach((e) => {
      try {
        e.bitmap.close();
      } catch {
        /* noop */
      }
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
      try {
        e.bitmap.close();
      } catch {
        /* noop */
      }
    }
  }

  private pickEvictionVictim(): string | null {
    const vp = this.currentViewport;
    const activeSheet = this.currentSheetId;
    let bestKey: string | null = null;
    let bestScore = -Infinity;
    this.map.forEach((entry, key) => {
      // Higher score → better eviction candidate.
      let score: number;
      if (activeSheet && entry.coord.sheetId !== activeSheet) {
        // Other-sheet tiles win first; oldest among them first.
        score = 1e15 - entry.touch;
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
