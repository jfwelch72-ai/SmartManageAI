// @vitest-environment jsdom
/**
 * Task #1676 — PlanMarkupLayer group-drag delta math.
 *
 * The full Konva drag interaction is integration-tested separately via
 * the bulk-PATCH suite in `server/__tests__/plan-document-markups-
 * carryover.test.ts`. This file locks down the pure helper that turns a
 * normalized pixel delta into a bulk PATCH payload — the math that
 * decides "did every selected member move by the same amount?".
 */
import { describe, it, expect } from "vitest";
import { buildBulkMoveUpdates } from "../PlanMarkupLayer";
import type { MarkupShape } from "../MarkupRenderer";

const mk = (id: string, points: Array<{ x: number; y: number }>): MarkupShape => ({
  id,
  tool: "ARROW",
  points,
  color: "#ef4444",
  thickness: 2,
});

describe("buildBulkMoveUpdates", () => {
  const markups = [
    mk("a", [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]),
    mk("b", [
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ]),
    mk("c", [
      { x: 0.5, y: 0.5 },
      { x: 0.6, y: 0.6 },
    ]),
  ];

  it("returns a payload that translates every member by the same delta", () => {
    const out = buildBulkMoveUpdates(markups, ["a", "b"], 0.05, -0.02);
    expect(out).toHaveLength(2);
    const byId = new Map(out.map((u) => [u.id, u]));
    const aPoints = byId.get("a")!.points;
    const bPoints = byId.get("b")!.points;
    // Use toBeCloseTo to absorb the inherent IEEE-754 rounding when
    // adding fractional deltas (e.g. 0.1 + 0.05 !== 0.15 exactly).
    expect(aPoints[0].x).toBeCloseTo(0.15, 10);
    expect(aPoints[0].y).toBeCloseTo(0.08, 10);
    expect(aPoints[1].x).toBeCloseTo(0.25, 10);
    expect(aPoints[1].y).toBeCloseTo(0.18, 10);
    expect(bPoints[0].x).toBeCloseTo(0.35, 10);
    expect(bPoints[0].y).toBeCloseTo(0.28, 10);
    expect(bPoints[1].x).toBeCloseTo(0.45, 10);
    expect(bPoints[1].y).toBeCloseTo(0.38, 10);
  });

  it("skips memberIds that are not present in the cache", () => {
    // A stale id in expandedSelection (e.g. just-deleted markup) must not
    // crash the bulk move. We silently drop it so the surviving members
    // still move together.
    const out = buildBulkMoveUpdates(markups, ["a", "ghost"], 0.1, 0);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("returns an empty array on a zero delta (no PATCH is fired)", () => {
    expect(buildBulkMoveUpdates(markups, ["a", "b"], 0, 0)).toEqual([]);
  });

  it("preserves point arity per shape (does not collapse multi-point shapes)", () => {
    // Freehand-style 4-point shape stays 4-point after the translate.
    const free = mk("f", [
      { x: 0, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.05 },
      { x: 0.3, y: 0.2 },
    ]);
    const out = buildBulkMoveUpdates([free], ["f"], 0.5, 0.5);
    expect(out[0].points).toHaveLength(4);
    expect(out[0].points[2]).toEqual({ x: 0.7, y: 0.55 });
  });
});
