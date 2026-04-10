import type { Point } from "@shared/utils/geometry";

export interface SnapTarget {
  point: Point;
  type: "endpoint" | "midpoint" | "intersection" | "perpendicular" | "nearest";
  sourceId?: string;
}

export interface SnapResult {
  snappedPoint: Point;
  snapTarget: SnapTarget | null;
  isSnapped: boolean;
}

const DEFAULT_SNAP_DISTANCE = 12;

function lineSegmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const dx1 = a2.x - a1.x, dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x, dy2 = b2.y - b1.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;
  if (t >= -0.01 && t <= 1.01 && u >= -0.01 && u <= 1.01) {
    return { x: a1.x + t * dx1, y: a1.y + t * dy1 };
  }
  return null;
}

function nearestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

interface SegmentData {
  a: Point;
  b: Point;
  sourceId: string;
}

export function findSnapTargets(
  measurements: Array<{
    id: string;
    points: string | Point[];
    type: string;
  }>
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const segments: SegmentData[] = [];

  for (const m of measurements) {
    if (m.type === "NOTE") continue;

    const pts: Point[] =
      typeof m.points === "string" ? JSON.parse(m.points) : m.points;

    if (!Array.isArray(pts) || pts.length === 0) continue;

    for (const pt of pts) {
      targets.push({ point: pt, type: "endpoint", sourceId: m.id });
    }

    if (pts.length === 2) {
      targets.push({
        point: {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2,
        },
        type: "midpoint",
        sourceId: m.id,
      });
      segments.push({ a: pts[0], b: pts[1], sourceId: m.id });
    }

    if (pts.length >= 3 && m.type !== "COUNT") {
      for (let i = 0; i < pts.length - 1; i++) {
        const mid = {
          x: (pts[i].x + pts[i + 1].x) / 2,
          y: (pts[i].y + pts[i + 1].y) / 2,
        };
        targets.push({ point: mid, type: "midpoint", sourceId: m.id });
        segments.push({ a: pts[i], b: pts[i + 1], sourceId: m.id });
      }
    }
  }

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (segments[i].sourceId === segments[j].sourceId) continue;
      const ix = lineSegmentIntersection(segments[i].a, segments[i].b, segments[j].a, segments[j].b);
      if (ix) {
        targets.push({ point: ix, type: "intersection" });
      }
    }
  }

  return targets;
}

export function findNearestSnapOnLine(
  cursorPoint: Point,
  measurements: Array<{ id: string; points: string | Point[]; type: string }>,
  snapDistance: number = DEFAULT_SNAP_DISTANCE,
  stageScale: number = 1
): SnapResult {
  const adjustedDist = snapDistance / stageScale;
  let nearest: SnapTarget | null = null;
  let nearestDist = Infinity;

  for (const m of measurements) {
    if (m.type === "NOTE" || m.type === "COUNT") continue;
    const pts: Point[] = typeof m.points === "string" ? JSON.parse(m.points) : m.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const np = nearestPointOnSegment(cursorPoint, pts[i], pts[i + 1]);
      const dx = cursorPoint.x - np.x, dy = cursorPoint.y - np.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < adjustedDist && dist < nearestDist) {
        nearestDist = dist;
        nearest = { point: np, type: "nearest", sourceId: m.id };
      }
    }
  }

  if (nearest) return { snappedPoint: nearest.point, snapTarget: nearest, isSnapped: true };
  return { snappedPoint: cursorPoint, snapTarget: null, isSnapped: false };
}

export function findNearestSnap(
  cursorPoint: Point,
  targets: SnapTarget[],
  snapDistance: number = DEFAULT_SNAP_DISTANCE,
  stageScale: number = 1
): SnapResult {
  const adjustedDist = snapDistance / stageScale;
  let nearest: SnapTarget | null = null;
  let nearestDist = Infinity;

  for (const t of targets) {
    const dx = cursorPoint.x - t.point.x;
    const dy = cursorPoint.y - t.point.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < adjustedDist && dist < nearestDist) {
      nearestDist = dist;
      nearest = t;
    }
  }

  if (nearest) {
    return {
      snappedPoint: nearest.point,
      snapTarget: nearest,
      isSnapped: true,
    };
  }

  return {
    snappedPoint: cursorPoint,
    snapTarget: null,
    isSnapped: false,
  };
}

export function applyOrthoLock(
  point: Point,
  anchor: Point | null
): Point {
  if (!anchor) return point;

  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);

  if (dx > dy) {
    return { x: point.x, y: anchor.y };
  } else {
    return { x: anchor.x, y: point.y };
  }
}
