import { describe, it, expect } from "vitest";
import {
  findPerpendicularSnap,
  findSnapTargets,
  perpendicularFoot,
  snapToGrid,
} from "./snapping";

describe("Task #2065 — snapToGrid", () => {
  it("snaps to nearest grid intersection at given spacing", () => {
    expect(snapToGrid({ x: 14, y: 7 }, { spacingPx: 10 })).toEqual({ x: 10, y: 10 });
    expect(snapToGrid({ x: 24, y: -3 }, { spacingPx: 10 })).toEqual({ x: 20, y: 0 });
  });

  it("respects custom origin", () => {
    expect(
      snapToGrid({ x: 12, y: 12 }, { spacingPx: 10, origin: { x: 5, y: 5 } })
    ).toEqual({ x: 15, y: 15 });
  });

  it("returns the input unchanged for non-positive spacing", () => {
    expect(snapToGrid({ x: 7, y: 7 }, { spacingPx: 0 })).toEqual({ x: 7, y: 7 });
  });
});

describe("Task #2065 — perpendicularFoot", () => {
  it("computes the foot of the perpendicular onto a horizontal segment", () => {
    const foot = perpendicularFoot(
      { x: 5, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    );
    expect(foot.x).toBeCloseTo(5, 6);
    expect(foot.y).toBeCloseTo(0, 6);
  });

  it("can land outside the segment endpoints (no clamping)", () => {
    const foot = perpendicularFoot(
      { x: 20, y: 5 },
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    );
    expect(foot.x).toBeCloseTo(20, 6);
    expect(foot.y).toBeCloseTo(0, 6);
  });

  it("returns the segment start for a degenerate segment", () => {
    expect(
      perpendicularFoot({ x: 5, y: 5 }, { x: 1, y: 1 }, { x: 1, y: 1 })
    ).toEqual({ x: 1, y: 1 });
  });
});

describe("Task #2065 — findPerpendicularSnap", () => {
  const measurements = [
    {
      id: "m1",
      type: "LINEAR",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  ];

  it("snaps the cursor to the perpendicular foot when within radius", () => {
    const result = findPerpendicularSnap(
      { x: 50, y: 6 },
      { x: 50, y: 50 },
      measurements,
      12,
      1
    );
    expect(result.isSnapped).toBe(true);
    expect(result.snappedPoint.x).toBeCloseTo(50, 6);
    expect(result.snappedPoint.y).toBeCloseTo(0, 6);
    expect(result.snapTarget?.type).toBe("perpendicular");
  });

  it("does not snap when the foot is farther than snapDistance", () => {
    const result = findPerpendicularSnap(
      { x: 50, y: 50 },
      { x: 50, y: 50 },
      measurements,
      12,
      1
    );
    expect(result.isSnapped).toBe(false);
  });

  it("returns no snap without an anchor", () => {
    const result = findPerpendicularSnap(
      { x: 50, y: 6 },
      null,
      measurements,
      12,
      1
    );
    expect(result.isSnapped).toBe(false);
  });
});

describe("Task #2065 — findSnapTargets center + grid mode toggles", () => {
  const polygon = {
    id: "poly1",
    type: "AREA",
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  };

  it("emits a center target for closed polygons by default", () => {
    const targets = findSnapTargets([polygon]);
    const center = targets.find((t) => t.type === "center");
    expect(center).toBeDefined();
    expect(center?.point.x).toBeCloseTo(5, 6);
    expect(center?.point.y).toBeCloseTo(5, 6);
  });

  it("can suppress center / midpoint / endpoint targets via the modes flag", () => {
    const targets = findSnapTargets([polygon], {
      endpoint: false,
      midpoint: false,
      center: false,
      intersection: false,
    });
    expect(targets).toHaveLength(0);
  });

  it("includes the closing-segment midpoint for unclosed polygon paths", () => {
    const targets = findSnapTargets([polygon], { endpoint: false, center: false });
    // Closing segment runs from (0,10) → (0,0); its midpoint is (0,5).
    const closing = targets.find(
      (t) => t.type === "midpoint" && Math.abs(t.point.x - 0) < 1e-6 && Math.abs(t.point.y - 5) < 1e-6
    );
    expect(closing).toBeDefined();
  });
});
