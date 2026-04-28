import { describe, it, expect } from "vitest";
import {
  applyAngleConstraint,
  applyOrthoLock,
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

describe("Task #2192 — applyAngleConstraint (ortho preset polar lock)", () => {
  // The unified ribbon's `ortho-angle` constraint mode cycles through
  // 15° / 30° / 45° / 90°, so each preset gets coverage to lock down
  // the bearing-rotation behaviour that #2192 wires into the canvas.

  it("returns the input unchanged when anchor is null", () => {
    expect(applyAngleConstraint({ x: 10, y: 7 }, null, 45)).toEqual({ x: 10, y: 7 });
  });

  it("returns the input unchanged for a non-positive step", () => {
    const anchor = { x: 0, y: 0 };
    expect(applyAngleConstraint({ x: 10, y: 7 }, anchor, 0)).toEqual({ x: 10, y: 7 });
    expect(applyAngleConstraint({ x: 10, y: 7 }, anchor, -45)).toEqual({ x: 10, y: 7 });
  });

  it("returns the anchor point when cursor sits on top of the anchor", () => {
    const anchor = { x: 5, y: 5 };
    expect(applyAngleConstraint({ x: 5, y: 5 }, anchor, 45)).toEqual({ x: 5, y: 5 });
  });

  it("snaps a near-horizontal cursor to 0° at 45° step", () => {
    const anchor = { x: 0, y: 0 };
    // Cursor 1° above horizontal → nearest 45-mult is 0°. Distance is
    // preserved (so the line still reaches under the cursor).
    const cursor = { x: 100, y: 1.7455 }; // ≈ tan(1°) * 100
    const out = applyAngleConstraint(cursor, anchor, 45);
    const expectedDist = Math.sqrt(cursor.x ** 2 + cursor.y ** 2);
    expect(out.x).toBeCloseTo(expectedDist, 4);
    expect(out.y).toBeCloseTo(0, 4);
  });

  it("snaps to the diagonal at 45° step when cursor is near 45°", () => {
    const anchor = { x: 0, y: 0 };
    // Cursor ~50° from horizontal — closer to 45° than 90°.
    const cursor = { x: 64.28, y: 76.6 }; // ≈ (cos50, sin50) * 100
    const out = applyAngleConstraint(cursor, anchor, 45);
    const expectedDist = Math.sqrt(cursor.x ** 2 + cursor.y ** 2);
    expect(out.x).toBeCloseTo(Math.cos(Math.PI / 4) * expectedDist, 3);
    expect(out.y).toBeCloseTo(Math.sin(Math.PI / 4) * expectedDist, 3);
  });

  it("snaps to 30° at 30° step (preset 2)", () => {
    const anchor = { x: 10, y: 10 };
    // Bearing of ~32° → nearest 30° multiple is 30°.
    const angle = (32 * Math.PI) / 180;
    const cursor = {
      x: 10 + Math.cos(angle) * 50,
      y: 10 + Math.sin(angle) * 50,
    };
    const out = applyAngleConstraint(cursor, anchor, 30);
    expect(out.x - anchor.x).toBeCloseTo(Math.cos(Math.PI / 6) * 50, 3);
    expect(out.y - anchor.y).toBeCloseTo(Math.sin(Math.PI / 6) * 50, 3);
  });

  it("snaps to 15° at 15° step (preset 1)", () => {
    const anchor = { x: 0, y: 0 };
    // Bearing of ~17° → nearest 15° multiple is 15°.
    const angle = (17 * Math.PI) / 180;
    const cursor = { x: Math.cos(angle) * 80, y: Math.sin(angle) * 80 };
    const out = applyAngleConstraint(cursor, anchor, 15);
    expect(out.x).toBeCloseTo(Math.cos(Math.PI / 12) * 80, 3);
    expect(out.y).toBeCloseTo(Math.sin(Math.PI / 12) * 80, 3);
  });

  it("at 90° step preserves cursor reach (unlike axis-aligned ortho lock)", () => {
    const anchor = { x: 0, y: 0 };
    // A cursor at (50, 5): legacy ortho-lock would snap y to 0 and
    // keep x at 50 — distance 50. The angle-constraint version also
    // snaps to the horizontal axis but preserves the radial distance
    // sqrt(50² + 5²) ≈ 50.249, so the line still reaches under the
    // cursor's pointer position.
    const cursor = { x: 50, y: 5 };
    const orthoOut = applyOrthoLock(cursor, anchor);
    expect(orthoOut).toEqual({ x: 50, y: 0 });

    const angleOut = applyAngleConstraint(cursor, anchor, 90);
    const dist = Math.sqrt(50 * 50 + 5 * 5);
    expect(angleOut.x).toBeCloseTo(dist, 4);
    expect(angleOut.y).toBeCloseTo(0, 4);
  });
});
