/**
 * Task #2204 — Edge-case coverage for the polar/angle constraint
 * (`applyAngleConstraint`, exposed in the unified ribbon as the
 * "polar lock") and the typed-length lock (`applyFixedLength`).
 *
 * Both functions back the new ribbon dimension input flow:
 *   - `applyAngleConstraint` is the canvas-side lock that the
 *     `ortho-angle` / `polar` constraint modes call before the
 *     measure handlers commit a click.
 *   - `applyFixedLength` clamps the next segment to the magnitude the
 *     user typed into the dim-input HUD, while preserving the cursor
 *     bearing.
 *
 * The cases below pin down behaviours that are easy to regress:
 *   • zero-length anchor (cursor coincident with anchor) — must not
 *     produce NaN bearings or zero-length jumps;
 *   • exact angle multiples — must round-trip without jitter;
 *   • non-positive / non-finite step or length — must return input
 *     unchanged so the caller never gets a silently-collapsed point.
 */
import { describe, it, expect } from "vitest";
import {
  applyAngleConstraint,
  applyFixedLength,
} from "./geometry";

describe("Task #2204 — applyAngleConstraint (a.k.a. polar lock)", () => {
  // -- Anchor / coincident-point edge cases ------------------------

  it("returns the cursor unchanged when anchor is null", () => {
    const cursor = { x: 12.5, y: -8.25 };
    expect(applyAngleConstraint(cursor, null, 15)).toEqual(cursor);
  });

  it("returns the cursor unchanged when cursor coincides with anchor", () => {
    // Distance is 0 → bearing is undefined → must NOT produce NaN.
    const anchor = { x: 100, y: 200 };
    const result = applyAngleConstraint({ ...anchor }, anchor, 15);
    expect(result).toEqual(anchor);
    expect(Number.isNaN(result.x)).toBe(false);
    expect(Number.isNaN(result.y)).toBe(false);
  });

  it("returns the cursor unchanged when within the 1e-10 zero-length threshold", () => {
    // Sub-threshold distance still degenerate; must short-circuit.
    const anchor = { x: 0, y: 0 };
    const cursor = { x: 1e-12, y: 1e-12 };
    const result = applyAngleConstraint(cursor, anchor, 45);
    expect(result).toEqual(cursor);
  });

  // -- Step-size guards --------------------------------------------

  it("returns the cursor unchanged for a zero step", () => {
    const cursor = { x: 50, y: 50 };
    const anchor = { x: 0, y: 0 };
    expect(applyAngleConstraint(cursor, anchor, 0)).toEqual(cursor);
  });

  it("returns the cursor unchanged for a negative step", () => {
    const cursor = { x: 50, y: 50 };
    const anchor = { x: 0, y: 0 };
    expect(applyAngleConstraint(cursor, anchor, -15)).toEqual(cursor);
  });

  it("returns the cursor unchanged for a non-finite step (NaN, Infinity)", () => {
    const cursor = { x: 50, y: 50 };
    const anchor = { x: 0, y: 0 };
    expect(applyAngleConstraint(cursor, anchor, Number.NaN)).toEqual(cursor);
    expect(applyAngleConstraint(cursor, anchor, Number.POSITIVE_INFINITY))
      .toEqual(cursor);
  });

  // -- Exact angle multiples (round-trip, no jitter) ----------------

  it("a cursor already on an exact 15° multiple returns essentially unchanged (round-trip)", () => {
    const anchor = { x: 0, y: 0 };
    const dist = 100;
    // 0°, 15°, 30°, 45°, 60°, 75°, 90°, ..., 345° all valid multiples.
    for (let degrees = 0; degrees < 360; degrees += 15) {
      const rad = (degrees * Math.PI) / 180;
      const cursor = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };
      const result = applyAngleConstraint(cursor, anchor, 15);
      expect(result.x).toBeCloseTo(cursor.x, 9);
      expect(result.y).toBeCloseTo(cursor.y, 9);
    }
  });

  it("a cursor at an off-step bearing snaps to the nearest 15° multiple AND preserves radial distance", () => {
    // Cursor at 22° bearing → nearest 15° multiple is 15° (Δ=7°), not 30° (Δ=8°).
    const anchor = { x: 0, y: 0 };
    const dist = 100;
    const rad = (22 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };
    const result = applyAngleConstraint(cursor, anchor, 15);

    const expectedRad = (15 * Math.PI) / 180;
    expect(result.x).toBeCloseTo(Math.cos(expectedRad) * dist, 6);
    expect(result.y).toBeCloseTo(Math.sin(expectedRad) * dist, 6);

    // Distance preservation — what makes the polar lock different
    // from a plain axis-aligned ortho lock.
    const resDist = Math.hypot(result.x - anchor.x, result.y - anchor.y);
    expect(resDist).toBeCloseTo(dist, 6);
  });

  it("90° step reproduces the four cardinal bearings", () => {
    const anchor = { x: 10, y: 20 };
    // Cursor 50px to the right and 5px down → snaps to +X axis.
    expect(applyAngleConstraint({ x: 60, y: 25 }, anchor, 90).y)
      .toBeCloseTo(20, 6);
    // Cursor mostly up → snaps to -Y axis.
    expect(applyAngleConstraint({ x: 12, y: -50 }, anchor, 90).x)
      .toBeCloseTo(10, 6);
  });

  it("non-anchor origin: snapping is computed in the anchor's local frame", () => {
    // If the math accidentally used global (0,0) instead of the anchor,
    // the bearing would change — this catches that class of regression.
    const anchor = { x: 100, y: 100 };
    // Cursor 100px to the right of the anchor → 0° bearing locally.
    const result = applyAngleConstraint({ x: 200, y: 100 }, anchor, 45);
    expect(result.x).toBeCloseTo(200, 9);
    expect(result.y).toBeCloseTo(100, 9);
  });
});

describe("Task #2204 — applyFixedLength (typed-length dim input lock)", () => {
  // -- Anchor / length guards --------------------------------------

  it("returns the cursor unchanged when anchor is null", () => {
    const cursor = { x: 7, y: 9 };
    expect(applyFixedLength(cursor, null, 100)).toEqual(cursor);
  });

  it("returns the cursor unchanged when length is zero", () => {
    const cursor = { x: 7, y: 9 };
    expect(applyFixedLength(cursor, { x: 0, y: 0 }, 0)).toEqual(cursor);
  });

  it("returns the cursor unchanged when length is negative", () => {
    const cursor = { x: 7, y: 9 };
    expect(applyFixedLength(cursor, { x: 0, y: 0 }, -50)).toEqual(cursor);
  });

  // -- Coincident cursor → fallback projection ---------------------

  it("falls back to a horizontal projection when cursor coincides with anchor", () => {
    // Without a defined bearing the function picks +X — gives the user
    // a deterministic, visible preview instead of a 0-length collapse.
    const anchor = { x: 50, y: 80 };
    const result = applyFixedLength({ ...anchor }, anchor, 25);
    expect(result.x).toBeCloseTo(75, 9);
    expect(result.y).toBeCloseTo(80, 9);
  });

  it("falls back to horizontal projection within the 1e-6 zero-distance threshold", () => {
    const anchor = { x: 0, y: 0 };
    const cursor = { x: 1e-7, y: 1e-7 }; // sub-threshold
    const result = applyFixedLength(cursor, anchor, 10);
    expect(result.x).toBeCloseTo(10, 9);
    expect(result.y).toBeCloseTo(0, 9);
  });

  // -- Length lock: bearing preserved, magnitude clamped -----------

  it("projects to the exact requested length while preserving the cursor bearing", () => {
    const anchor = { x: 0, y: 0 };
    // Cursor at (3, 4) → 5px away on a 3:4:5 triangle bearing.
    // Locking to 50px must give (30, 40).
    const result = applyFixedLength({ x: 3, y: 4 }, anchor, 50);
    expect(result.x).toBeCloseTo(30, 9);
    expect(result.y).toBeCloseTo(40, 9);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(50, 9);
  });

  it("a cursor already at the target length round-trips unchanged", () => {
    const anchor = { x: 10, y: 10 };
    // 6:8:10 from anchor → already 10px away.
    const cursor = { x: 16, y: 18 };
    const result = applyFixedLength(cursor, anchor, 10);
    expect(result.x).toBeCloseTo(cursor.x, 9);
    expect(result.y).toBeCloseTo(cursor.y, 9);
  });

  it("clamps a far-away cursor down to the typed length (preview shrink)", () => {
    const anchor = { x: 0, y: 0 };
    // Cursor 1000px out at 30° bearing → lock to 60px.
    const rad = (30 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * 1000, y: Math.sin(rad) * 1000 };
    const result = applyFixedLength(cursor, anchor, 60);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(60, 6);
    // Bearing preserved.
    const bearing = Math.atan2(result.y, result.x);
    expect(bearing).toBeCloseTo(rad, 9);
  });

  it("extends a too-close cursor up to the typed length (preview grow)", () => {
    const anchor = { x: 0, y: 0 };
    // Cursor only 2px away at 45° → lock to 100px.
    const rad = Math.PI / 4;
    const cursor = { x: Math.cos(rad) * 2, y: Math.sin(rad) * 2 };
    const result = applyFixedLength(cursor, anchor, 100);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(100, 6);
    expect(Math.atan2(result.y, result.x)).toBeCloseTo(rad, 9);
  });

  it("works with non-origin anchors (bearing computed in anchor frame)", () => {
    const anchor = { x: 100, y: 100 };
    // Cursor 4px right + 3px down → 5px away at +X-down bearing.
    const cursor = { x: 104, y: 103 };
    const result = applyFixedLength(cursor, anchor, 25);
    // 25/5 = 5×, so offsets scale: (4*5, 3*5) added to anchor.
    expect(result.x).toBeCloseTo(120, 9);
    expect(result.y).toBeCloseTo(115, 9);
  });
});
