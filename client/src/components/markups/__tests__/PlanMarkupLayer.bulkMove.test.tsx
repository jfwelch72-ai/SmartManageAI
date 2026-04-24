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
import { buildBulkMoveUpdates, buildMoveSnapshot } from "../PlanMarkupLayer";
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

/**
 * Task #1705 — `buildMoveSnapshot` is the inverse-payload helper used to
 * undo a group move with a single bulk-PATCH. The acceptance criteria
 * require that the snapshot, replayed verbatim through the same bulk-
 * PATCH route, restores the previous positions of every moved shape —
 * so this suite locks down the round-trip math: snapshot ∘ apply-delta
 * ∘ snapshot must be a no-op on the original points.
 */
describe("buildMoveSnapshot", () => {
  const markups = [
    mk("a", [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]),
    mk("b", [
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ]),
  ];

  it("captures the pre-move points of every selected member", () => {
    const snap = buildMoveSnapshot(markups, ["a", "b"]);
    expect(snap).toHaveLength(2);
    const byId = new Map(snap.map((s) => [s.id, s]));
    expect(byId.get("a")!.points).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ]);
    expect(byId.get("b")!.points).toEqual([
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
    ]);
  });

  it("returns a deep-copied points array (snapshot is not aliased to the cache)", () => {
    // Mutating the snapshot must NOT mutate the source markup. Otherwise
    // the optimistic update would corrupt our undo payload mid-flight.
    const snap = buildMoveSnapshot(markups, ["a"]);
    snap[0].points[0].x = 0.99;
    expect(markups[0].points[0].x).toBe(0.1);
  });

  it("skips memberIds that are not present in the cache", () => {
    // A stale id (e.g. just-deleted markup) must not crash the snapshot.
    const snap = buildMoveSnapshot(markups, ["a", "ghost"]);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe("a");
  });

  it("round-trip: replaying snapshot after a delta restores original points", () => {
    // This is the contract of the undo feature. We:
    //   1. snapshot the pre-move state
    //   2. apply a delta and pretend the cache moved to that state
    //   3. replay the snapshot as a "set points" payload
    // The result must equal the original points exactly.
    const ids = ["a", "b"];
    const snap = buildMoveSnapshot(markups, ids);
    const moved = buildBulkMoveUpdates(markups, ids, 0.07, -0.03);
    // Simulate the cache after the optimistic update.
    const movedCache = markups.map((m) => {
      const u = moved.find((x) => x.id === m.id);
      return u ? { ...m, points: u.points } : m;
    });
    // Replaying the snapshot through the same cache layout must
    // restore exactly the original points.
    for (const s of snap) {
      const cached = movedCache.find((m) => m.id === s.id)!;
      const restored = { ...cached, points: s.points };
      const original = markups.find((m) => m.id === s.id)!;
      expect(restored.points).toEqual(original.points);
    }
  });
});
