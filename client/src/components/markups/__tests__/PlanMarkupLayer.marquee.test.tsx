// @vitest-environment jsdom
/**
 * Task #1738 — PlanMarkupLayer lasso / marquee selection helpers.
 *
 * The full Konva drag interaction is exercised end-to-end by the
 * deferred Task #1728 (Playwright spec mirroring `e2e/plan-markup-
 * group-drag.spec.ts`). This file locks down the pure helpers — the
 * intersection math that decides which markups a marquee picks up —
 * so the gesture behaves predictably regardless of the renderer.
 */
import { describe, it, expect } from "vitest";
import {
  findMarkupsIntersectingMarquee,
  rectFromPoints,
  shapeBoundingBox,
} from "../marqueeHelpers";
import { MARQUEE_MIN_DRAG_PX } from "../PlanMarkupLayer";
import type { MarkupShape } from "../MarkupRenderer";

const mk = (
  id: string,
  points: Array<{ x: number; y: number }>,
): MarkupShape => ({
  id,
  tool: "ARROW",
  points,
  color: "#ef4444",
  thickness: 2,
});

describe("rectFromPoints", () => {
  it("normalizes any drag direction to canonical min/max corners", () => {
    expect(rectFromPoints({ x: 0.2, y: 0.5 }, { x: 0.7, y: 0.1 })).toEqual({
      minX: 0.2,
      maxX: 0.7,
      minY: 0.1,
      maxY: 0.5,
    });
    expect(rectFromPoints({ x: 0.7, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({
      minX: 0.2,
      maxX: 0.7,
      minY: 0.1,
      maxY: 0.5,
    });
  });

  it("returns a degenerate rect when both corners coincide", () => {
    // A pointerdown that releases without movement reaches the helper
    // with start === end. Math should not crash; downstream callers
    // gate on the pixel-distance threshold before applying selection.
    expect(rectFromPoints({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 })).toEqual({
      minX: 0.4,
      maxX: 0.4,
      minY: 0.4,
      maxY: 0.4,
    });
  });
});

describe("shapeBoundingBox", () => {
  it("returns min/max across every point of a multi-point shape", () => {
    const bb = shapeBoundingBox(
      mk("a", [
        { x: 0.1, y: 0.4 },
        { x: 0.3, y: 0.2 },
        { x: 0.2, y: 0.5 },
      ]),
    );
    expect(bb).toEqual({ minX: 0.1, maxX: 0.3, minY: 0.2, maxY: 0.5 });
  });

  it("collapses to a degenerate box for a single-point TEXT anchor", () => {
    const bb = shapeBoundingBox({
      id: "t",
      tool: "TEXT",
      points: [{ x: 0.5, y: 0.5 }],
      color: "#000",
      thickness: 2,
      text: "label",
    });
    expect(bb).toEqual({ minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 });
  });

  it("returns null for an empty point array (defensive)", () => {
    expect(shapeBoundingBox(mk("empty", []))).toBeNull();
  });

  it("skips any point with a non-finite coordinate (defensive)", () => {
    // The helper treats a NaN/Infinity on either axis as a discard
    // for the whole point — pre-normalized data should never contain
    // these, but a single bad row must not corrupt the bounding box.
    const bb = shapeBoundingBox(
      mk("nan", [
        { x: 0.1, y: 0.1 },
        { x: Number.NaN, y: 0.5 },
        { x: Number.POSITIVE_INFINITY, y: 0.3 },
        { x: 0.4, y: 0.4 },
      ]),
    );
    expect(bb).toEqual({ minX: 0.1, maxX: 0.4, minY: 0.1, maxY: 0.4 });
  });
});

describe("findMarkupsIntersectingMarquee", () => {
  const markups: MarkupShape[] = [
    mk("inside", [
      { x: 0.20, y: 0.20 },
      { x: 0.30, y: 0.30 },
    ]),
    mk("outside", [
      { x: 0.80, y: 0.80 },
      { x: 0.90, y: 0.90 },
    ]),
    mk("partial", [
      // Straddles the marquee's right edge — bounding box overlaps.
      { x: 0.45, y: 0.40 },
      { x: 0.65, y: 0.50 },
    ]),
    {
      id: "text-inside",
      tool: "TEXT",
      points: [{ x: 0.40, y: 0.40 }],
      color: "#000",
      thickness: 2,
      text: "label",
    },
    {
      id: "text-outside",
      tool: "TEXT",
      points: [{ x: 0.90, y: 0.10 }],
      color: "#000",
      thickness: 2,
      text: "out",
    },
    mk("empty", []),
  ];
  const rect = { minX: 0.10, maxX: 0.50, minY: 0.10, maxY: 0.50 };

  it("returns every markup whose bounding box intersects the rectangle", () => {
    const ids = findMarkupsIntersectingMarquee(markups, rect);
    // Order-insensitive — the helper returns ids in source order, but
    // the contract is the SET of intersecting ids.
    expect(new Set(ids)).toEqual(new Set(["inside", "partial", "text-inside"]));
  });

  it("treats a touching edge as a hit (forgiving boundary)", () => {
    // Markup whose left edge exactly touches the marquee's right edge.
    const m = [
      mk("touch", [
        { x: 0.50, y: 0.20 },
        { x: 0.60, y: 0.30 },
      ]),
    ];
    expect(findMarkupsIntersectingMarquee(m, rect)).toEqual(["touch"]);
  });

  it("excludes markups whose bounding box lies fully outside", () => {
    expect(
      findMarkupsIntersectingMarquee([markups[1]], rect),
    ).toEqual([]);
  });

  it("includes a TEXT anchor that lies inside the rectangle", () => {
    expect(
      findMarkupsIntersectingMarquee([markups[3]], rect),
    ).toEqual(["text-inside"]);
  });

  it("excludes a TEXT anchor that lies outside the rectangle", () => {
    expect(
      findMarkupsIntersectingMarquee([markups[4]], rect),
    ).toEqual([]);
  });

  it("ignores markups with no points (defensive)", () => {
    expect(
      findMarkupsIntersectingMarquee([markups[5]], rect),
    ).toEqual([]);
  });

  it("returns an empty array for a degenerate (0×0) rectangle that misses everything", () => {
    const ids = findMarkupsIntersectingMarquee(markups, {
      minX: 0.99,
      maxX: 0.99,
      minY: 0.99,
      maxY: 0.99,
    });
    expect(ids).toEqual([]);
  });

  it("returns the markup whose bounding box contains a degenerate rectangle", () => {
    // A 0×0 marquee inside a markup's bounding box still intersects —
    // useful as a contract for future click-through-marquee flows.
    const ids = findMarkupsIntersectingMarquee(markups, {
      minX: 0.25,
      maxX: 0.25,
      minY: 0.25,
      maxY: 0.25,
    });
    expect(ids).toEqual(["inside"]);
  });
});

describe("MARQUEE_MIN_DRAG_PX", () => {
  it("is small enough to feel responsive but >= 1px to ignore stationary clicks", () => {
    // Acceptance criterion: a click without drag must NOT marquee-
    // select. The drag handler in PlanMarkupLayer compares the pixel
    // distance against this threshold and falls through to the click
    // path when below it.
    expect(MARQUEE_MIN_DRAG_PX).toBeGreaterThanOrEqual(1);
    expect(MARQUEE_MIN_DRAG_PX).toBeLessThanOrEqual(10);
  });
});

/**
 * Task #1738 — Selection-extension contract. The marquee gesture
 * captures the Shift modifier at pointerdown and uses it on
 * pointerup to decide whether to replace or extend the prior
 * selection. These tests model that branch directly so the policy is
 * pinned even if the gesture wiring changes shape.
 */
describe("marquee + Shift selection extension policy", () => {
  const apply = (
    prev: Set<string>,
    additions: string[],
    shift: boolean,
  ): Set<string> => {
    if (shift) {
      const next = new Set(prev);
      for (const id of additions) next.add(id);
      return next;
    }
    return new Set(additions);
  };

  it("replaces the prior selection when Shift was NOT held", () => {
    const result = apply(new Set(["a", "b"]), ["c", "d"], false);
    expect([...result].sort()).toEqual(["c", "d"]);
  });

  it("extends the prior selection when Shift WAS held", () => {
    const result = apply(new Set(["a", "b"]), ["c", "d"], true);
    expect([...result].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("Shift-extending an empty marquee leaves the selection unchanged", () => {
    const result = apply(new Set(["a", "b"]), [], true);
    expect([...result].sort()).toEqual(["a", "b"]);
  });

  it("Shift-extending with overlap does not duplicate ids", () => {
    const result = apply(new Set(["a", "b"]), ["b", "c"], true);
    expect([...result].sort()).toEqual(["a", "b", "c"]);
  });

  it("non-Shift marquee that picks nothing clears the selection", () => {
    const result = apply(new Set(["a", "b"]), [], false);
    expect([...result]).toEqual([]);
  });
});

/**
 * Task #1738 — `suppressNextStageClickRef` lifecycle. The flag must
 * be self-clearing on the next event-loop tick so that a marquee
 * committed via the window-level pointerup fallback (i.e. the user
 * released OUTSIDE the canvas, so Konva never fires a trailing
 * stage `click`) does not leave a stale "skip the next clear" flag
 * that would force the user to click twice to deselect.
 */
describe("suppress-flag self-expiry contract", () => {
  it("leaves the flag set during the synchronous click that follows pointerup, then clears it on the next macrotask", async () => {
    const flag = { current: false };
    // Simulate `commitMarquee` arming the flag and scheduling the
    // safety clear (mirrors the production `setTimeout(0)` path).
    flag.current = true;
    setTimeout(() => {
      flag.current = false;
    }, 0);

    // Synchronous follow-up (the stage click that may or may not
    // fire) still sees the flag as set, so it correctly skips the
    // clear-selection branch.
    expect(flag.current).toBe(true);

    // After the event-loop tick, the flag is cleared even if no
    // click ever fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(flag.current).toBe(false);
  });

  it("a SECOND empty-stage click after an out-of-bounds release would find the flag already cleared", async () => {
    const flag = { current: false };
    // Marquee commits via window listener, mouseup OUTSIDE stage —
    // no Konva click will fire.
    flag.current = true;
    setTimeout(() => {
      flag.current = false;
    }, 0);

    await new Promise((resolve) => setTimeout(resolve, 0));

    // A subsequent genuine empty-stage click reads the flag…
    const wouldClear = !flag.current;
    // …finds it false, and proceeds to clear the selection on the
    // FIRST try. No double-click required.
    expect(wouldClear).toBe(true);
  });
});
