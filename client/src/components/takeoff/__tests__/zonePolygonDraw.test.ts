// @vitest-environment node
/**
 * Task #2794 — Unit tests for the zone polygon drawing state machine.
 *
 * Covers two contracts extracted into `zonePolygonDraw.ts`:
 *
 *   1. `applyZoneClick`  — single canvas click appends a vertex OR closes
 *      the polygon when the click lands within the snap threshold of the
 *      first vertex (requires ≥ 3 vertices already placed).
 *
 *   2. `applyZoneDblClick` — double-click closes the polygon when ≥ 3
 *      vertices are placed; always clears in-progress points.
 *
 * All tests run against pure functions so they are fast, deterministic,
 * and require no DOM / React machinery.
 */
import { describe, it, expect } from "vitest";
import {
  ZONE_CLOSE_THRESHOLD_PX,
  pointDistance,
  isNearFirstVertex,
  applyZoneClick,
  applyZoneDblClick,
  type ZonePoint,
} from "../zonePolygonDraw";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a square polygon with the given side length, centered at origin. */
function square(side: number): ZonePoint[] {
  const h = side / 2;
  return [
    { x: -h, y: -h },
    { x:  h, y: -h },
    { x:  h, y:  h },
    { x: -h, y:  h },
  ];
}

// ---------------------------------------------------------------------------
// pointDistance
// ---------------------------------------------------------------------------

describe("pointDistance", () => {
  it("returns 0 for the same point", () => {
    expect(pointDistance({ x: 5, y: 10 }, { x: 5, y: 10 })).toBe(0);
  });

  it("returns the correct Euclidean distance for a 3-4-5 right triangle", () => {
    expect(pointDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
  });

  it("is commutative", () => {
    const a = { x: 1, y: 7 };
    const b = { x: 4, y: 3 };
    expect(pointDistance(a, b)).toBeCloseTo(pointDistance(b, a));
  });
});

// ---------------------------------------------------------------------------
// isNearFirstVertex
// ---------------------------------------------------------------------------

describe("isNearFirstVertex", () => {
  const first: ZonePoint = { x: 100, y: 100 };
  const SCALE = 1;

  it("returns true when the point is exactly on the first vertex", () => {
    expect(isNearFirstVertex({ x: 100, y: 100 }, first, SCALE)).toBe(true);
  });

  it("returns true when the point is strictly inside the threshold radius", () => {
    // Just inside: offset by threshold - 1
    const inside: ZonePoint = {
      x: first.x + ZONE_CLOSE_THRESHOLD_PX - 1,
      y: first.y,
    };
    expect(isNearFirstVertex(inside, first, SCALE)).toBe(true);
  });

  it("returns false when the point is exactly at the threshold distance", () => {
    // distance === threshold is NOT < threshold, so the polygon should NOT close.
    const atEdge: ZonePoint = {
      x: first.x + ZONE_CLOSE_THRESHOLD_PX,
      y: first.y,
    };
    expect(isNearFirstVertex(atEdge, first, SCALE)).toBe(false);
  });

  it("returns false when the point is outside the threshold radius", () => {
    const outside: ZonePoint = {
      x: first.x + ZONE_CLOSE_THRESHOLD_PX + 5,
      y: first.y,
    };
    expect(isNearFirstVertex(outside, first, SCALE)).toBe(false);
  });

  it("scales the threshold with stageScale (zoomed in → tighter world-space radius)", () => {
    // At stageScale = 2 the effective world-space radius is 15/2 = 7.5 px.
    const closeAtScale1 = { x: first.x + 10, y: first.y }; // 10 px from first
    expect(isNearFirstVertex(closeAtScale1, first, 1)).toBe(true);  // < 15
    expect(isNearFirstVertex(closeAtScale1, first, 2)).toBe(false); // < 7.5? No
  });

  it("scales the threshold with stageScale (zoomed out → looser world-space radius)", () => {
    // At stageScale = 0.5 the effective radius is 15/0.5 = 30 px.
    const pt = { x: first.x + 20, y: first.y }; // 20 px from first
    expect(isNearFirstVertex(pt, first, 1)).toBe(false); // > 15 at scale 1
    expect(isNearFirstVertex(pt, first, 0.5)).toBe(true);  // < 30 at scale 0.5
  });
});

// ---------------------------------------------------------------------------
// applyZoneClick — vertex appending
// ---------------------------------------------------------------------------

describe("applyZoneClick — appending vertices", () => {
  const SCALE = 1;

  it("appends the first vertex to an empty list", () => {
    const pt: ZonePoint = { x: 50, y: 50 };
    const { newPoints, closedPoints } = applyZoneClick([], pt, SCALE);
    expect(newPoints).toEqual([pt]);
    expect(closedPoints).toBeNull();
  });

  it("appends the second vertex", () => {
    const prev: ZonePoint[] = [{ x: 0, y: 0 }];
    const pt: ZonePoint = { x: 100, y: 0 };
    const { newPoints, closedPoints } = applyZoneClick(prev, pt, SCALE);
    expect(newPoints).toHaveLength(2);
    expect(newPoints[1]).toEqual(pt);
    expect(closedPoints).toBeNull();
  });

  it("appends the third vertex (close-check does NOT run with < 3 prior)", () => {
    // Only 2 prior vertices — the close-check is gated on prev.length >= 3,
    // so a click near the first vertex must still append (not close).
    const prev: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    // Click very close to the first vertex.
    const nearFirst: ZonePoint = { x: 1, y: 0 };
    const { newPoints, closedPoints } = applyZoneClick(prev, nearFirst, SCALE);
    expect(newPoints).toHaveLength(3);
    expect(closedPoints).toBeNull();
  });

  it("appends a fourth vertex that is far from the first vertex", () => {
    const prev = square(200).slice(0, 3); // 3 vertices of a 200×200 square
    const farPt: ZonePoint = { x: 500, y: 500 };
    const { newPoints, closedPoints } = applyZoneClick(prev, farPt, SCALE);
    expect(newPoints).toHaveLength(4);
    expect(closedPoints).toBeNull();
  });

  it("does not mutate the previous array", () => {
    const prev: ZonePoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    const prevCopy = [...prev];
    applyZoneClick(prev, { x: 500, y: 500 }, SCALE);
    expect(prev).toEqual(prevCopy);
  });
});

// ---------------------------------------------------------------------------
// applyZoneClick — polygon close via first-vertex snap
// ---------------------------------------------------------------------------

describe("applyZoneClick — close by clicking near first vertex", () => {
  const SCALE = 1;

  it("closes the polygon when clicking exactly on the first vertex (3 points prior)", () => {
    const prev: ZonePoint[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    // Click exactly on first vertex.
    const { newPoints, closedPoints } = applyZoneClick(prev, { x: 0, y: 0 }, SCALE);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toEqual(prev);
  });

  it("closes the polygon when clicking just inside the threshold radius", () => {
    const first: ZonePoint = { x: 0, y: 0 };
    const prev: ZonePoint[] = [
      first,
      { x: 100, y: 0 },
      { x: 50,  y: 100 },
    ];
    const nearFirst: ZonePoint = { x: ZONE_CLOSE_THRESHOLD_PX - 1, y: 0 };
    const { newPoints, closedPoints } = applyZoneClick(prev, nearFirst, SCALE);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toEqual(prev);
  });

  it("does NOT close when clicking exactly at the threshold boundary", () => {
    const prev: ZonePoint[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 50,  y: 100 },
    ];
    const atEdge: ZonePoint = { x: ZONE_CLOSE_THRESHOLD_PX, y: 0 };
    const { closedPoints } = applyZoneClick(prev, atEdge, SCALE);
    expect(closedPoints).toBeNull();
  });

  it("closes after 4 vertices are placed", () => {
    const sq = square(200); // 4 vertices
    // Click near first vertex.
    const nearFirst: ZonePoint = { x: sq[0].x + 1, y: sq[0].y + 1 };
    const { newPoints, closedPoints } = applyZoneClick(sq, nearFirst, SCALE);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toEqual(sq);
  });

  it("respects stageScale when deciding whether a click is close enough", () => {
    const prev: ZonePoint[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 50,  y: 100 },
    ];
    // At distance 10, which is < 15 (scale 1) but NOT < 7.5 (scale 2).
    const pt: ZonePoint = { x: 10, y: 0 };

    const { closedPoints: closedAtScale1 } = applyZoneClick(prev, pt, 1);
    expect(closedAtScale1).not.toBeNull(); // 10 < 15/1 = 15 ✓

    const { closedPoints: closedAtScale2 } = applyZoneClick(prev, pt, 2);
    expect(closedAtScale2).toBeNull();     // 10 < 15/2 = 7.5? No ✗
  });
});

// ---------------------------------------------------------------------------
// applyZoneDblClick — double-click close
// ---------------------------------------------------------------------------

describe("applyZoneDblClick", () => {
  it("does NOT close when fewer than 3 vertices are placed (0 vertices)", () => {
    const { newPoints, closedPoints } = applyZoneDblClick([]);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toBeNull();
  });

  it("does NOT close when fewer than 3 vertices are placed (1 vertex)", () => {
    const { newPoints, closedPoints } = applyZoneDblClick([{ x: 0, y: 0 }]);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toBeNull();
  });

  it("does NOT close when fewer than 3 vertices are placed (2 vertices)", () => {
    const { closedPoints } = applyZoneDblClick([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(closedPoints).toBeNull();
  });

  it("always clears newPoints regardless of whether it closes", () => {
    const twoVertices: ZonePoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(applyZoneDblClick(twoVertices).newPoints).toEqual([]);

    const threeVertices: ZonePoint[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 },
    ];
    expect(applyZoneDblClick(threeVertices).newPoints).toEqual([]);
  });

  it("closes the polygon when exactly 3 vertices are placed", () => {
    const prev: ZonePoint[] = [
      { x: 0,   y: 0 },
      { x: 100, y: 0 },
      { x: 50,  y: 100 },
    ];
    const { newPoints, closedPoints } = applyZoneDblClick(prev);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toEqual(prev);
  });

  it("closes the polygon when 4 vertices are placed", () => {
    const sq = square(200);
    const { closedPoints } = applyZoneDblClick(sq);
    expect(closedPoints).toEqual(sq);
  });

  it("closes the polygon when many vertices are placed", () => {
    const pts: ZonePoint[] = Array.from({ length: 8 }, (_, i) => ({
      x: Math.cos((i / 8) * 2 * Math.PI) * 100,
      y: Math.sin((i / 8) * 2 * Math.PI) * 100,
    }));
    const { closedPoints } = applyZoneDblClick(pts);
    expect(closedPoints).toEqual(pts);
  });

  it("does not mutate the previous array", () => {
    const prev: ZonePoint[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 },
    ];
    const prevCopy = [...prev];
    applyZoneDblClick(prev);
    expect(prev).toEqual(prevCopy);
  });
});

// ---------------------------------------------------------------------------
// handleZoneCanvasDblClick event-order contract
// ---------------------------------------------------------------------------
// This describe block guards the production assumption in TakeoffWorkspace.tsx:
//
//   handleZoneCanvasDblClick slices off the last 2 points before calling
//   applyZoneDblClick, because Konva v9's double-click detection fires two
//   mousedown events (each of which triggers handleZoneCanvasClick and appends
//   a vertex) before the onDblClick callback fires.
//
//   Event sequence for a user double-click at point D, with N prior vertices:
//     mousedown #1 → handleZoneCanvasClick(D) → state: [v1…vN, D]
//     mousedown #2 → handleZoneCanvasClick(D) → state: [v1…vN, D, D]
//     mouseup  #2  → handleZoneCanvasDblClick()
//                  → prev.slice(0, -2) → [v1…vN]
//                  → applyZoneDblClick([v1…vN], D) → closes with N vertices ✓
//
// These tests are pure-function unit tests; they do not render React or mount
// Konva — they simply verify the arithmetic that production code relies on.
// ---------------------------------------------------------------------------
describe("handleZoneCanvasDblClick — Konva event-order contract", () => {
  it("slice(0,-2) on N+2 points restores the original N intentional vertices", () => {
    const v1 = { x: 0,   y: 0   };
    const v2 = { x: 100, y: 0   };
    const v3 = { x: 100, y: 100 };
    const v4 = { x: 0,   y: 100 };
    const D  = { x: 50,  y: 50  }; // dblclick target

    // After 4 intentional single-clicks and 2 dblclick mousedowns:
    const stateAtDblClick: ZonePoint[] = [v1, v2, v3, v4, D, D];

    // Production handler: slice off the 2 Konva-injected extras.
    const sliced = stateAtDblClick.slice(0, -2);
    expect(sliced).toHaveLength(4);
    expect(sliced).toEqual([v1, v2, v3, v4]);

    // Then close via the pure function.
    const { closedPoints, newPoints } = applyZoneDblClick(sliced);
    expect(newPoints).toEqual([]);
    expect(closedPoints).toEqual([v1, v2, v3, v4]);
  });

  it("slice(0,-2) on 3+2 points (minimum valid polygon) still closes correctly", () => {
    const v1 = { x: 0,  y: 0   };
    const v2 = { x: 80, y: 0   };
    const v3 = { x: 40, y: 80  };
    const D  = { x: 20, y: 20  };

    const stateAtDblClick: ZonePoint[] = [v1, v2, v3, D, D];
    const sliced = stateAtDblClick.slice(0, -2);
    expect(sliced).toEqual([v1, v2, v3]);

    const { closedPoints } = applyZoneDblClick(sliced);
    expect(closedPoints).toEqual([v1, v2, v3]);
  });

  it("slice(0,-2) preserves all N intentional vertices unchanged", () => {
    // Verify the slice operation does not reorder or alter coordinates.
    const intended: ZonePoint[] = Array.from({ length: 6 }, (_, i) => ({
      x: i * 20,
      y: i * 10,
    }));
    const dblPt = { x: 99, y: 99 };
    const stateAtDblClick = [...intended, dblPt, dblPt];

    const sliced = stateAtDblClick.slice(0, -2);
    expect(sliced).toEqual(intended);

    const { closedPoints } = applyZoneDblClick(sliced);
    expect(closedPoints).toEqual(intended);
  });
});
