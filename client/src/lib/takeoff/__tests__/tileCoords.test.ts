import { describe, it, expect } from "vitest";
import {
  TILE_SIZE_PX,
  ZOOM_BUCKETS,
  pickZoomBucket,
  rotateViewportToPageNative,
  tileKey,
  tileWorldRect,
  viewportToWorldRect,
  visibleTileCoords,
  tileDistanceFromViewportCenter,
  estimateTileBytes,
  type TileCoord,
} from "../tileCoords";
import { TileCache } from "../tileCache";

describe("tileCoords (Task #2138)", () => {
  describe("pickZoomBucket", () => {
    it("returns the smallest bucket that meets or exceeds the stage scale", () => {
      expect(pickZoomBucket(0.1)).toBe(0.25);
      expect(pickZoomBucket(0.25)).toBe(0.25);
      expect(pickZoomBucket(0.4)).toBe(0.5);
      expect(pickZoomBucket(0.99)).toBe(1);
      expect(pickZoomBucket(1.5)).toBe(2);
      expect(pickZoomBucket(3.5)).toBe(4);
    });

    it("caps at the largest bucket for extreme zooms", () => {
      expect(pickZoomBucket(8)).toBe(ZOOM_BUCKETS[ZOOM_BUCKETS.length - 1]);
      expect(pickZoomBucket(1000)).toBe(ZOOM_BUCKETS[ZOOM_BUCKETS.length - 1]);
    });

    it("treats non-positive stage scales as the smallest bucket", () => {
      expect(pickZoomBucket(0)).toBe(0.25);
      expect(pickZoomBucket(-1)).toBe(0.25);
    });
  });

  describe("tileKey", () => {
    it("is stable and unique across coord components", () => {
      const a = tileKey({
        sheetId: "s1",
        pageIndex: 0,
        zoomBucket: 1,
        tileX: 2,
        tileY: 3,
      });
      const b = tileKey({
        sheetId: "s1",
        pageIndex: 0,
        zoomBucket: 1,
        tileX: 2,
        tileY: 3,
      });
      expect(a).toBe(b);
      const c = tileKey({
        sheetId: "s1",
        pageIndex: 0,
        zoomBucket: 1,
        tileX: 2,
        tileY: 4,
      });
      expect(a).not.toBe(c);
      const d = tileKey({
        sheetId: "s2",
        pageIndex: 0,
        zoomBucket: 1,
        tileX: 2,
        tileY: 3,
      });
      expect(a).not.toBe(d);
    });
  });

  describe("tileWorldRect", () => {
    it("returns a TILE_SIZE_PX/zoom world square at the right origin", () => {
      const r = tileWorldRect({ zoomBucket: 1, tileX: 0, tileY: 0 });
      expect(r).toEqual({ x: 0, y: 0, w: TILE_SIZE_PX, h: TILE_SIZE_PX });
      const r2 = tileWorldRect({ zoomBucket: 2, tileX: 1, tileY: 3 });
      // At 2x zoom each tile is 256 world px wide.
      expect(r2).toEqual({ x: 256, y: 768, w: 256, h: 256 });
      const r3 = tileWorldRect({ zoomBucket: 0.5, tileX: 1, tileY: 0 });
      expect(r3).toEqual({ x: 1024, y: 0, w: 1024, h: 1024 });
    });
  });

  describe("viewportToWorldRect", () => {
    it("inverts Konva's stage transform", () => {
      // stagePosition is the top-left of the page in screen coords.
      // At scale=2 a 1000x800 stage shows a 500x400 world rect; if
      // the page is panned -200 screen px right then world x starts
      // at +100.
      const r = viewportToWorldRect({
        stageWidth: 1000,
        stageHeight: 800,
        stagePosition: { x: -200, y: -120 },
        stageScale: 2,
      });
      expect(r).toEqual({ x: 100, y: 60, w: 500, h: 400 });
    });

    it("treats non-positive scale as a tiny positive scale", () => {
      const r = viewportToWorldRect({
        stageWidth: 100,
        stageHeight: 100,
        stagePosition: { x: 0, y: 0 },
        stageScale: 0,
      });
      expect(Number.isFinite(r.w)).toBe(true);
      expect(Number.isFinite(r.h)).toBe(true);
    });
  });

  describe("rotateViewportToPageNative", () => {
    const page = { width: 800, height: 600 };

    it("is a no-op for rotation=0", () => {
      const r = rotateViewportToPageNative({
        rect: { x: 100, y: 50, w: 300, h: 200 },
        rotation: 0,
        pageDims: page,
      });
      expect(r).toEqual({ x: 100, y: 50, w: 300, h: 200 });
    });

    it("preserves rectangle dimensions for 90/180/270 (no inflation)", () => {
      for (const rot of [90, 180, 270] as const) {
        const r = rotateViewportToPageNative({
          rect: { x: 100, y: 50, w: 300, h: 200 },
          rotation: rot,
          pageDims: page,
        });
        // For 0/180 the axes don't swap; for 90/270 they do.
        if (rot === 180) {
          expect(r.w).toBe(300);
          expect(r.h).toBe(200);
        } else {
          expect(r.w).toBe(200);
          expect(r.h).toBe(300);
        }
      }
    });

    it("maps the page top-left corner correctly under 90° rotation", () => {
      // Under 90° CW rotation with Group.y = pageDims.width = 800, the
      // page top-left lands at stage-world (0, 800). A 100×100 stage
      // rect anchored to that corner (y from 700 to 800) sits entirely
      // inside the rotated page and inverse-maps to page-native
      // (0, 0, 100, 100).
      const r = rotateViewportToPageNative({
        rect: { x: 0, y: 700, w: 100, h: 100 },
        rotation: 90,
        pageDims: page,
      });
      expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });

    it("returns a rect inside the page bounds for the full visible page (180)", () => {
      // 180° rotation: stage-world rect that covers the rotated page
      // (0..pw, 0..ph) maps back onto the same page-native rect.
      const r = rotateViewportToPageNative({
        rect: { x: 0, y: 0, w: page.width, h: page.height },
        rotation: 180,
        pageDims: page,
      });
      expect(r).toEqual({ x: 0, y: 0, w: page.width, h: page.height });
    });
  });

  describe("visibleTileCoords with rotation", () => {
    it("at rotation=90 the page-native viewport selects different tiles than rotation=0 for the same stage rect", () => {
      const page = { width: 4096, height: 3072 };
      const stageRect = { x: 0, y: 0, w: 1024, h: 1024 };

      const native0 = rotateViewportToPageNative({
        rect: stageRect,
        rotation: 0,
        pageDims: page,
      });
      const native90 = rotateViewportToPageNative({
        rect: stageRect,
        rotation: 90,
        pageDims: page,
      });

      const tiles0 = visibleTileCoords({
        page,
        viewport: native0,
        zoomBucket: 1,
        sheetId: "s",
        pageIndex: 0,
      });
      const tiles90 = visibleTileCoords({
        page,
        viewport: native90,
        zoomBucket: 1,
        sheetId: "s",
        pageIndex: 0,
      });

      // The two tile sets must differ — that's the whole point of the
      // rotation fix. (At rotation=0 the viewport hits the page top-left
      // corner; at rotation=90 it hits the rotated top-left, which maps
      // to a different page-native quadrant.)
      const keys0 = new Set(tiles0.map(tileKey));
      const keys90 = new Set(tiles90.map(tileKey));
      const same = [...keys0].every((k) => keys90.has(k)) && keys0.size === keys90.size;
      expect(same).toBe(false);
    });
  });

  describe("visibleTileCoords", () => {
    it("returns tiles intersecting the viewport plus a one-tile padding ring", () => {
      // With zoomBucket=1 each tile is 512 world px. A viewport 0..512
      // on x and 0..512 on y intersects only tile (0,0). Padding=1
      // adds the surrounding ring, but bounds clamp to page size.
      const tiles = visibleTileCoords({
        page: { width: 1024, height: 1024 },
        viewport: { x: 0, y: 0, w: 512, h: 512 },
        zoomBucket: 1,
        sheetId: "s",
        pageIndex: 0,
      });
      // Indexes returned should be (0,0), (1,0), (0,1), (1,1).
      const set = new Set(tiles.map((t) => `${t.tileX},${t.tileY}`));
      expect(set.has("0,0")).toBe(true);
      expect(set.has("1,0")).toBe(true);
      expect(set.has("0,1")).toBe(true);
      expect(set.has("1,1")).toBe(true);
    });

    it("clamps tile indices to the page bounds", () => {
      // Page is 1 tile wide/tall at zoom 1; viewport extends past the
      // page. Tiles outside the page must be omitted.
      const tiles = visibleTileCoords({
        page: { width: 400, height: 400 },
        viewport: { x: 0, y: 0, w: 4096, h: 4096 },
        zoomBucket: 1,
        sheetId: "s",
        pageIndex: 0,
      });
      for (const t of tiles) {
        expect(t.tileX).toBe(0);
        expect(t.tileY).toBe(0);
      }
      expect(tiles.length).toBeGreaterThan(0);
    });

    it("returns an empty array for off-page negative viewports", () => {
      const tiles = visibleTileCoords({
        page: { width: 100, height: 100 },
        viewport: { x: -10000, y: -10000, w: 100, h: 100 },
        zoomBucket: 1,
        sheetId: "s",
        pageIndex: 0,
        padding: 0,
      });
      expect(tiles).toEqual([]);
    });

    it("respects zoom bucket so 2x bucket emits ~4x tiles for the same viewport", () => {
      // Use a viewport slightly under tile-boundary multiples so the
      // floor-based endpoint isn't off-by-one across buckets.
      const baseArgs = {
        page: { width: 4096, height: 4096 },
        viewport: { x: 0, y: 0, w: 1023, h: 1023 },
        sheetId: "s",
        pageIndex: 0,
        padding: 0,
      };
      const at1 = visibleTileCoords({ ...baseArgs, zoomBucket: 1 });
      const at2 = visibleTileCoords({ ...baseArgs, zoomBucket: 2 });
      // ~1024 world px viewport at zoom 1 = 2x2 tiles; at zoom 2 each
      // tile covers 256 world px so the same viewport spans 4x4 = 16.
      expect(at1.length).toBe(4);
      expect(at2.length).toBe(16);
    });
  });

  describe("tileDistanceFromViewportCenter", () => {
    it("returns 0 when the tile center matches the viewport center", () => {
      const d = tileDistanceFromViewportCenter(
        { zoomBucket: 1, tileX: 0, tileY: 0 },
        { x: -TILE_SIZE_PX / 2, y: -TILE_SIZE_PX / 2, w: TILE_SIZE_PX * 2, h: TILE_SIZE_PX * 2 },
      );
      // Tile center is at (256, 256). Viewport center is at (-256+512, -256+512) = (256, 256).
      expect(d).toBeCloseTo(0, 5);
    });

    it("grows monotonically as the tile moves further from the viewport center", () => {
      const vp = { x: 0, y: 0, w: TILE_SIZE_PX, h: TILE_SIZE_PX };
      const d0 = tileDistanceFromViewportCenter(
        { zoomBucket: 1, tileX: 0, tileY: 0 },
        vp,
      );
      const d1 = tileDistanceFromViewportCenter(
        { zoomBucket: 1, tileX: 5, tileY: 0 },
        vp,
      );
      const d2 = tileDistanceFromViewportCenter(
        { zoomBucket: 1, tileX: 10, tileY: 10 },
        vp,
      );
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
    });
  });

  describe("estimateTileBytes", () => {
    it("returns 4 bytes per pixel of a TILE_SIZE_PX square", () => {
      expect(estimateTileBytes()).toBe(TILE_SIZE_PX * TILE_SIZE_PX * 4);
    });
  });
});

describe("TileCache viewport-aware eviction (Task #2138)", () => {
  function makeFakeBitmap(): ImageBitmap {
    return { width: 512, height: 512, close: () => undefined } as unknown as ImageBitmap;
  }

  function coord(sheetId: string, tileX: number, tileY = 0): TileCoord {
    return { sheetId, pageIndex: 0, zoomBucket: 1, tileX, tileY };
  }

  it("evicts other-sheet tiles before active-sheet tiles when over budget", () => {
    const tileBytes = 512 * 512 * 4;
    const cache = new TileCache(tileBytes * 2);
    cache.setViewport({ x: 0, y: 0, w: 1024, h: 1024 }, "active");

    const a = coord("active", 0);
    const b = coord("other", 0);
    const c = coord("active", 1);

    cache.set(a, makeFakeBitmap());
    cache.set(b, makeFakeBitmap());
    cache.set(c, makeFakeBitmap());

    expect(cache.has(a)).toBe(true);
    expect(cache.has(c)).toBe(true);
    expect(cache.has(b)).toBe(false);
  });

  it("evicts the farthest active-sheet tile when no other-sheet tiles exist", () => {
    const tileBytes = 512 * 512 * 4;
    const cache = new TileCache(tileBytes * 2);
    cache.setViewport({ x: 0, y: 0, w: 512, h: 512 }, "s");

    const closeTile = coord("s", 0);
    const midTile = coord("s", 8);
    const farTile = coord("s", 16);

    cache.set(closeTile, makeFakeBitmap());
    cache.set(midTile, makeFakeBitmap());
    cache.set(farTile, makeFakeBitmap());

    expect(cache.has(closeTile)).toBe(true);
    expect(cache.has(midTile)).toBe(true);
    expect(cache.has(farTile)).toBe(false);
  });
});

describe("Tile cache device-aware budget (Task #2405)", () => {
  it("computes a budget within the [256 MB, 1.5 GB] band based on deviceMemory", async () => {
    const { computeDeviceAwareTileBudget } = await import("../tileCache");
    const g = globalThis as unknown as { navigator?: { deviceMemory?: number } };
    const hadNavigator = "navigator" in g;
    const originalNavigator = g.navigator;
    try {
      g.navigator = { deviceMemory: 32 };
      const big = computeDeviceAwareTileBudget();
      expect(big).toBeGreaterThanOrEqual(256 * 1024 * 1024);
      expect(big).toBeLessThanOrEqual(1.5 * 1024 * 1024 * 1024);

      g.navigator = { deviceMemory: 1 };
      const small = computeDeviceAwareTileBudget();
      expect(small).toBe(256 * 1024 * 1024);
    } finally {
      if (hadNavigator) {
        g.navigator = originalNavigator;
      } else {
        delete g.navigator;
      }
    }
  });
});

describe("TileCache per-document soft cap (Task #2405)", () => {
  function makeFakeBitmap(): ImageBitmap {
    return { width: 512, height: 512, close: () => undefined } as unknown as ImageBitmap;
  }
  function coord(sheetId: string, tileX: number, tileY = 0): TileCoord {
    return { sheetId, pageIndex: 0, zoomBucket: 1, tileX, tileY };
  }

  it("prefers evicting tiles from a single sheet that exceeds the soft cap fraction", async () => {
    const { TileCache, PER_DOCUMENT_SOFT_CAP_FRACTION } = await import(
      "../tileCache"
    );
    const tileBytes = 512 * 512 * 4;
    // Budget = 5 tiles. Soft cap = 60% × 5 = 3 tiles. We seed sheet A
    // with 3 tiles and sheet B with 1 tile (no active sheet set), then
    // add a 5th tile to A. Without per-doc soft cap, plain-LRU would
    // evict the older "A" tile or B's tile arbitrarily. With the soft
    // cap, A is dominant (4 > 3) so its farthest tile gets evicted
    // before B's lone tile.
    expect(PER_DOCUMENT_SOFT_CAP_FRACTION).toBeGreaterThan(0);
    const cache = new TileCache(tileBytes * 5);
    cache.setViewport({ x: 0, y: 0, w: 512, h: 512 }, null);

    cache.set(coord("A", 0), makeFakeBitmap());
    cache.set(coord("A", 1), makeFakeBitmap());
    cache.set(coord("A", 2), makeFakeBitmap());
    cache.set(coord("B", 0), makeFakeBitmap());
    // 4 tiles cached — under budget.
    expect(cache.has(coord("B", 0))).toBe(true);

    // 5th + 6th A tiles push A to 5 of 6 — over the 60% soft cap on
    // a 5-tile budget. Eviction should target A's farthest tile, not B.
    cache.set(coord("A", 16), makeFakeBitmap());
    cache.set(coord("A", 17), makeFakeBitmap());

    expect(cache.has(coord("B", 0))).toBe(true);
    // A lost at least one tile to eviction.
    const remainingA = [0, 1, 2, 16, 17].filter((x) =>
      cache.has(coord("A", x)),
    ).length;
    expect(remainingA).toBeLessThan(5);
  });
});
