/**
 * Task #2138 — Typed tile coordinate system for the takeoff PDF tile
 * renderer. World coordinates are the same pixel space markups have
 * always been stored in (page rendered at `BASE_RENDER_SCALE` via
 * pdfjs). Tiles are addressed by their integer (tileX, tileY) within a
 * given `zoomBucket`; zoom buckets snap to powers of 2 so the four
 * adjacent buckets share factor-of-2 alignment and tiles can be
 * crossfaded as the user zooms.
 *
 * Held in its own file (no React, no pdfjs, no Konva) so it can be
 * imported by the main thread, the worker, and unit tests alike.
 */

export const TILE_SIZE_PX = 512;

export const BASE_RENDER_SCALE = 1.5;

export const ZOOM_BUCKETS = [0.25, 0.5, 1, 2, 4] as const;
export type ZoomBucket = (typeof ZOOM_BUCKETS)[number];

export const PLACEHOLDER_BUCKET: ZoomBucket = 0.25;

export interface TileCoord {
  sheetId: string;
  pageIndex: number;
  zoomBucket: ZoomBucket;
  tileX: number;
  tileY: number;
}

export interface PageDims {
  width: number;
  height: number;
}

export function tileKey(c: TileCoord): string {
  return `${c.sheetId}|${c.pageIndex}|${c.zoomBucket}|${c.tileX}|${c.tileY}`;
}

/**
 * Pick the smallest zoom bucket that produces tiles whose pixel
 * density is at least the user's current screen pixel density. Larger
 * stage scale means more screen pixels per world pixel, so we pick a
 * higher bucket so the rasterized tile texture has enough resolution
 * to look crisp. Capped at the largest bucket; a 4x bucket already
 * produces 4x the texels of the world coordinate system, beyond which
 * additional resolution doesn't help on a typical display.
 */
export function pickZoomBucket(stageScale: number): ZoomBucket {
  const target = Math.max(0.0001, stageScale);
  for (const b of ZOOM_BUCKETS) {
    if (b >= target) return b;
  }
  return ZOOM_BUCKETS[ZOOM_BUCKETS.length - 1];
}

/**
 * Compute the world-coordinate region a tile covers. A tile renders
 * `TILE_SIZE_PX` device pixels wide, which corresponds to
 * `TILE_SIZE_PX / zoomBucket` world pixels.
 */
export function tileWorldRect(
  c: Pick<TileCoord, "zoomBucket" | "tileX" | "tileY">,
): { x: number; y: number; w: number; h: number } {
  const wWorld = TILE_SIZE_PX / c.zoomBucket;
  return {
    x: c.tileX * wWorld,
    y: c.tileY * wWorld,
    w: wWorld,
    h: wWorld,
  };
}

export interface ViewportWorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Convert a screen-pixel viewport (the `<Stage>` canvas) into the
 * world-coordinate rectangle it currently shows, given Konva's
 * `stagePosition` (translation in screen pixels) and `stageScale`.
 */
export function viewportToWorldRect(args: {
  stageWidth: number;
  stageHeight: number;
  stagePosition: { x: number; y: number };
  stageScale: number;
}): ViewportWorldRect {
  const { stageWidth, stageHeight, stagePosition, stageScale } = args;
  const s = Math.max(0.0001, stageScale);
  return {
    x: -stagePosition.x / s,
    y: -stagePosition.y / s,
    w: stageWidth / s,
    h: stageHeight / s,
  };
}

/**
 * Map a stage-world (post-rotation) viewport rect into the page-native
 * (pre-rotation) coordinate system the tile grid uses. Tiles are laid
 * out in unrotated page coords because pdfjs renders the page natively
 * — the Konva `<Group>` wrapping the canvas applies the visual
 * rotation. Without this mapping the scheduler picks the wrong tile
 * set whenever `sheetRotation !== 0` (especially obvious for 90/270
 * where the axes swap), so high-res tiles never composite over the
 * placeholder.
 *
 * `rotation` matches Konva's CW degree convention (0/90/180/270).
 * `pageDims` is always the unrotated page (the same `pageDims` passed
 * to `visibleTileCoords`). Output is an axis-aligned bounding box in
 * page-native coords; for the 4 supported rotations the transform is
 * exact, so no inflation is introduced.
 */
export function rotateViewportToPageNative(args: {
  rect: ViewportWorldRect;
  rotation: 0 | 90 | 180 | 270;
  pageDims: PageDims;
}): ViewportWorldRect {
  const { rect, rotation, pageDims } = args;
  if (rotation === 0) return rect;
  const w = pageDims.width;
  const h = pageDims.height;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  const mapped = corners.map((p) => {
    switch (rotation) {
      // Mirrors `inverseRotate` in TakeoffWorkspace so points stay
      // consistent with markup/measurement/snap math.
      case 90:
        return { x: w - p.y, y: p.x };
      case 180:
        return { x: w - p.x, y: h - p.y };
      case 270:
        return { x: p.y, y: h - p.x };
    }
  });
  const xs = mapped.map((p) => p.x);
  const ys = mapped.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Enumerate every tile (at the given zoom bucket) whose world rect
 * intersects the visible viewport, plus an optional `padding` ring of
 * tiles around the visible set so a small pan gesture finds tiles
 * already cached. Tile counts saturate at the page bounds — never
 * request a tile whose origin sits beyond the page itself.
 */
export function visibleTileCoords(args: {
  page: PageDims;
  viewport: ViewportWorldRect;
  zoomBucket: ZoomBucket;
  padding?: number;
  sheetId: string;
  pageIndex: number;
}): TileCoord[] {
  const {
    page,
    viewport,
    zoomBucket,
    padding = 1,
    sheetId,
    pageIndex,
  } = args;
  const tileWorld = TILE_SIZE_PX / zoomBucket;
  const startX = Math.max(0, Math.floor(viewport.x / tileWorld) - padding);
  const startY = Math.max(0, Math.floor(viewport.y / tileWorld) - padding);
  const endX = Math.min(
    Math.ceil(page.width / tileWorld) - 1,
    Math.floor((viewport.x + viewport.w) / tileWorld) + padding,
  );
  const endY = Math.min(
    Math.ceil(page.height / tileWorld) - 1,
    Math.floor((viewport.y + viewport.h) / tileWorld) + padding,
  );
  const out: TileCoord[] = [];
  if (endX < 0 || endY < 0) return out;
  for (let ty = startY; ty <= endY; ty++) {
    for (let tx = startX; tx <= endX; tx++) {
      out.push({ sheetId, pageIndex, zoomBucket, tileX: tx, tileY: ty });
    }
  }
  return out;
}

/**
 * Distance from a tile's center to the viewport's center, in world
 * coordinates. The scheduler uses this as the primary priority key:
 * tiles closest to where the user is looking render first.
 */
export function tileDistanceFromViewportCenter(
  c: Pick<TileCoord, "zoomBucket" | "tileX" | "tileY">,
  viewport: ViewportWorldRect,
): number {
  const r = tileWorldRect(c);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const vx = viewport.x + viewport.w / 2;
  const vy = viewport.y + viewport.h / 2;
  const dx = cx - vx;
  const dy = cy - vy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Estimated decoded byte size of a tile's `ImageBitmap`. Real
 * `ImageBitmap` instances don't expose a size, so we approximate using
 * 4 bytes per pixel (RGBA). The cache uses this number to enforce its
 * byte budget; the exact value doesn't have to be precise as long as
 * it's stable per tile so the cache evicts in a predictable order.
 */
export function estimateTileBytes(): number {
  return TILE_SIZE_PX * TILE_SIZE_PX * 4;
}
