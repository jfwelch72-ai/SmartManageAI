import type { Point } from "@shared/utils/geometry";

export interface SnapTarget {
  point: Point;
  type: "endpoint" | "midpoint" | "intersection";
  sourceId?: string;
}

export interface SnapResult {
  snappedPoint: Point;
  snapTarget: SnapTarget | null;
  isSnapped: boolean;
}

const DEFAULT_SNAP_DISTANCE = 12;

export function findSnapTargets(
  measurements: Array<{
    id: string;
    points: string | Point[];
    type: string;
  }>
): SnapTarget[] {
  const targets: SnapTarget[] = [];

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
    }

    if (pts.length >= 3 && m.type !== "COUNT") {
      for (let i = 0; i < pts.length - 1; i++) {
        const mid = {
          x: (pts[i].x + pts[i + 1].x) / 2,
          y: (pts[i].y + pts[i + 1].y) / 2,
        };
        targets.push({ point: mid, type: "midpoint", sourceId: m.id });
      }
    }
  }

  return targets;
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
