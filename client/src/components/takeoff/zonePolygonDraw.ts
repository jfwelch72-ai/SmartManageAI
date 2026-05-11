/**
 * Task #2794 — Pure utility functions for the zone polygon drawing state
 * machine. Extracted from the `handleZoneCanvasClick` /
 * `handleZoneCanvasDblClick` callbacks in TakeoffWorkspace.tsx so the
 * close-polygon contract can be unit-tested in isolation.
 *
 * Design rules:
 *   - No React imports. Functions are plain TypeScript so they can be
 *     imported by both the workspace and the vitest suite.
 *   - No side effects. Every function returns its new state; callers
 *     (`setZoneDrawPoints`, `setPendingZonePoints`, …) decide what to do
 *     with the result.
 */

export type ZonePoint = { x: number; y: number };

/**
 * The threshold radius (in **world** pixels at scale = 1) within which a
 * click on the first vertex closes the polygon. Exported so tests can
 * pin it explicitly and the canvas hint text can reference the same value.
 */
export const ZONE_CLOSE_THRESHOLD_PX = 15;

/**
 * Euclidean distance between two points.
 */
export function pointDistance(a: ZonePoint, b: ZonePoint): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * Returns `true` when `pt` is within the close-polygon snap radius of the
 * first placed vertex.
 *
 * The threshold scales inversely with `stageScale`: when the user has
 * zoomed in (stageScale > 1) the radius in world-space shrinks so the snap
 * doesn't feel overly sticky; when zoomed out (stageScale < 1) it grows so
 * a pixel-precise click on the first vertex is still possible at low zoom.
 */
export function isNearFirstVertex(
  pt: ZonePoint,
  first: ZonePoint,
  stageScale: number,
): boolean {
  return pointDistance(pt, first) < ZONE_CLOSE_THRESHOLD_PX / stageScale;
}

/**
 * Result of a zone click or double-click state transition.
 */
export interface ZoneDrawResult {
  /**
   * The new `zoneDrawPoints` array. Empty when the polygon is closed
   * (the completed points live in `closedPoints` instead).
   */
  newPoints: ZonePoint[];
  /**
   * When non-null, the polygon has been closed and this is the complete
   * vertex list to move into `pendingZonePoints`.
   */
  closedPoints: ZonePoint[] | null;
}

/**
 * Pure reducer for a canvas single-click during zone drawing.
 *
 * Rules (matching TakeoffWorkspace.tsx `handleZoneCanvasClick`):
 *   1. With fewer than 3 vertices placed: always append the new point.
 *   2. With 3 or more vertices placed AND the click lands within the
 *      close-polygon threshold of the first vertex: close the polygon
 *      (return the accumulated points as `closedPoints`).
 *   3. Otherwise: append the new point.
 */
export function applyZoneClick(
  prev: ZonePoint[],
  pt: ZonePoint,
  stageScale: number,
): ZoneDrawResult {
  if (prev.length >= 3) {
    if (isNearFirstVertex(pt, prev[0], stageScale)) {
      return { newPoints: [], closedPoints: prev };
    }
  }
  return { newPoints: [...prev, pt], closedPoints: null };
}

/**
 * Pure reducer for a canvas double-click during zone drawing.
 *
 * Rules (matching TakeoffWorkspace.tsx `handleZoneCanvasDblClick`):
 *   1. With 3 or more vertices placed: close the polygon.
 *   2. With fewer than 3 vertices: discard without closing (the polygon
 *      is not valid yet).
 *
 * Either way `newPoints` is `[]` — the double-click always clears the
 * in-progress list (matching the `return []` in the original callback).
 */
export function applyZoneDblClick(prev: ZonePoint[]): ZoneDrawResult {
  if (prev.length >= 3) {
    return { newPoints: [], closedPoints: prev };
  }
  return { newPoints: [], closedPoints: null };
}
