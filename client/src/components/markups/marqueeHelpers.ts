/**
 * Task #1738 — Pure helpers for the lasso / marquee selection gesture
 * on the plan-side markup overlay.
 *
 * Lives in its own file (rather than co-located in `PlanMarkupLayer.tsx`)
 * for the same reason `moveHelpers.ts` does: the unit tests run under a
 * jsdom environment and pulling in `react-konva` from the layer module
 * would make the helpers harder to import in isolation.
 */
import type { MarkupShape } from "./MarkupRenderer";

/**
 * Axis-aligned rectangle in the same normalized coordinate space as
 * `MarkupShape.points` (0..1 of the canvas width/height). The marquee
 * gesture stores its drag start and end as normalized points; this is
 * the canonical (min/max) form passed into the intersection helper.
 */
export interface MarqueeRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Build the canonical (min/max) rectangle from two arbitrary corner
 * points. Lets the caller pass the raw drag start + drag end (in any
 * direction) without having to know which coordinate is the lower
 * bound. Returned in the same normalized 0..1 space.
 */
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): MarqueeRect {
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Compute the axis-aligned bounding box of a markup's points in
 * normalized space. Empty point arrays (defensive — should never
 * happen for a persisted markup) return `null`.
 */
export function shapeBoundingBox(
  shape: MarkupShape,
): MarqueeRect | null {
  const pts = shape.points;
  if (!pts || pts.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, maxX, minY, maxY };
}

/**
 * Task #1738 — Return the ids of every markup whose bounding box
 * intersects the supplied marquee rectangle. Matches the gesture's
 * acceptance criterion: "selects every markup whose bounding box
 * intersects the rectangle". Single-point shapes (TEXT) intersect the
 * marquee whenever their anchor point lies inside it.
 *
 * The caller is expected to pre-filter `markups` for layer visibility
 * (the `PlanMarkupLayer` already does this via the `markups` memo) so
 * hidden markups are never picked up by a marquee that happens to
 * overlap them.
 */
export function findMarkupsIntersectingMarquee(
  markups: MarkupShape[],
  rect: MarqueeRect,
): string[] {
  const out: string[] = [];
  for (const m of markups) {
    const bb = shapeBoundingBox(m);
    if (!bb) continue;
    // Standard axis-aligned bounding-box intersection. Touching edges
    // (a marquee whose right edge lines up with a markup's left edge)
    // counts as intersecting — Bluebeam/AutoCAD both treat the touch
    // case as a hit, and it makes the gesture feel forgiving at the
    // boundaries.
    if (
      bb.maxX < rect.minX ||
      bb.minX > rect.maxX ||
      bb.maxY < rect.minY ||
      bb.minY > rect.maxY
    ) {
      continue;
    }
    out.push(m.id);
  }
  return out;
}
