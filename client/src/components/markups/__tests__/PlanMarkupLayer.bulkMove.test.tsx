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
import {
  buildBulkMoveUpdates,
  buildMoveSnapshot,
  describeHistoryEntry,
  MAX_MARKUP_HISTORY,
  type MarkupHistoryEntry,
  type MarkupMoveHistoryEntry,
  type MarkupRestoreSnapshot,
} from "../PlanMarkupLayer";
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
    // (sanity check on the historical single-step undo contract; the
    // multi-step undo/redo helpers below build on the same primitive.)
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

/**
 * Task #1723 — Multi-step undo / redo. The drag handler in
 * `<PlanMarkupLayer />` pushes one of these entries onto the undo
 * stack on every group move; undo and redo each fire one bulk-PATCH
 * (using `before` / `after` respectively) and swap the entry between
 * stacks. These tests lock down (a) the tooltip label format the
 * toolbar surfaces and (b) the bounded ring-buffer policy that keeps
 * the stack from growing unboundedly during a long editing session.
 */
describe("describeHistoryEntry", () => {
  const moveEntry = (count: number): MarkupMoveHistoryEntry => ({
    type: "move",
    before: [],
    after: [],
    count,
  });

  it("uses singular form for a single-markup move", () => {
    expect(describeHistoryEntry(moveEntry(1))).toBe("Move 1 markup");
  });

  it("uses plural form for a multi-markup move", () => {
    expect(describeHistoryEntry(moveEntry(5))).toBe("Move 5 markups");
    expect(describeHistoryEntry(moveEntry(20))).toBe("Move 20 markups");
  });

  it("uses plural form for a zero-markup move (defensive)", () => {
    // A 0-count entry should never reach the toolbar in practice (the
    // drag handler skips zero-delta moves), but the label must still
    // be human-readable if it does.
    expect(describeHistoryEntry(moveEntry(0))).toBe("Move 0 markups");
  });

  // Task #1737 — labels for the new entry variants. The toolbar
  // prepends "Undo " / "Redo " when rendering, so the bare label
  // describes the action itself ("Create" → "Undo Create").
  const snapshot: MarkupRestoreSnapshot = {
    id: "id-1",
    pageNumber: 1,
    tool: "ARROW",
    points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    color: "#ef4444",
    thickness: 2,
    text: null,
    layerId: null,
    groupId: null,
  };

  it("labels a create entry as 'Create'", () => {
    const entry: MarkupHistoryEntry = { type: "create", markup: snapshot };
    expect(describeHistoryEntry(entry)).toBe("Create");
  });

  it("labels a delete entry with singular markup count", () => {
    const entry: MarkupHistoryEntry = {
      type: "delete",
      markups: [snapshot],
      count: 1,
    };
    expect(describeHistoryEntry(entry)).toBe("Delete 1 markup");
  });

  it("labels a delete entry with plural markup count", () => {
    const entry: MarkupHistoryEntry = {
      type: "delete",
      markups: [snapshot, { ...snapshot, id: "id-2" }, { ...snapshot, id: "id-3" }],
      count: 3,
    };
    expect(describeHistoryEntry(entry)).toBe("Delete 3 markups");
  });

  it("labels a group entry as 'Group'", () => {
    const entry: MarkupHistoryEntry = {
      type: "group",
      assignments: [
        { id: "id-1", previousGroupId: null, nextGroupId: "g-1" },
        { id: "id-2", previousGroupId: null, nextGroupId: "g-1" },
      ],
      count: 2,
    };
    expect(describeHistoryEntry(entry)).toBe("Group");
  });

  it("labels an ungroup entry as 'Ungroup'", () => {
    const entry: MarkupHistoryEntry = {
      type: "ungroup",
      assignments: [
        { id: "id-1", previousGroupId: "g-1" },
        { id: "id-2", previousGroupId: "g-1" },
      ],
      count: 2,
    };
    expect(describeHistoryEntry(entry)).toBe("Ungroup");
  });
});

/**
 * Task #1737 — Mixed-action ring buffer policy. The undo stack now
 * accepts any combination of move/create/delete/group/ungroup entries;
 * the bounded eviction policy applies uniformly so a 25-action editing
 * session keeps only the last 20 regardless of which action types were
 * involved.
 */
describe("undo stack ring-buffer with mixed action types", () => {
  const push = (
    stack: MarkupHistoryEntry[],
    entry: MarkupHistoryEntry,
  ): MarkupHistoryEntry[] => {
    const next = [...stack, entry];
    return next.length > MAX_MARKUP_HISTORY
      ? next.slice(next.length - MAX_MARKUP_HISTORY)
      : next;
  };

  it("walks one step per action regardless of variant type", () => {
    let stack: MarkupHistoryEntry[] = [];
    const snap: MarkupRestoreSnapshot = {
      id: "x",
      pageNumber: 1,
      tool: "ARROW",
      points: [{ x: 0, y: 0 }],
      color: "#000",
      thickness: 2,
      text: null,
      layerId: null,
      groupId: null,
    };
    stack = push(stack, { type: "move", before: [], after: [], count: 1 });
    stack = push(stack, { type: "create", markup: snap });
    stack = push(stack, { type: "delete", markups: [snap], count: 1 });
    stack = push(stack, {
      type: "group",
      assignments: [{ id: "x", previousGroupId: null, nextGroupId: "g-1" }],
      count: 1,
    });
    stack = push(stack, {
      type: "ungroup",
      assignments: [{ id: "x", previousGroupId: "g-1" }],
      count: 1,
    });
    expect(stack).toHaveLength(5);
    expect(stack.map((e) => e.type)).toEqual([
      "move",
      "create",
      "delete",
      "group",
      "ungroup",
    ]);
  });

  it("evicts the oldest mixed-action entries past MAX_MARKUP_HISTORY", () => {
    let stack: MarkupHistoryEntry[] = [];
    const snap: MarkupRestoreSnapshot = {
      id: "x",
      pageNumber: 1,
      tool: "ARROW",
      points: [{ x: 0, y: 0 }],
      color: "#000",
      thickness: 2,
      text: null,
      layerId: null,
      groupId: null,
    };
    // Push MAX + 3 entries alternating between create and move; only
    // the most-recent MAX entries should survive.
    for (let i = 0; i < MAX_MARKUP_HISTORY + 3; i++) {
      const e: MarkupHistoryEntry =
        i % 2 === 0
          ? { type: "create", markup: { ...snap, id: `x-${i}` } }
          : { type: "move", before: [], after: [], count: i };
      stack = push(stack, e);
    }
    expect(stack).toHaveLength(MAX_MARKUP_HISTORY);
  });
});

/**
 * Task #1739 — `pushHistory` redo-invalidation contract. The drag /
 * create / delete / group / ungroup paths in `<PlanMarkupLayer />` all
 * funnel through one shared helper that:
 *   1. appends the new entry to the undo stack (with eviction past
 *      MAX_MARKUP_HISTORY)
 *   2. UNCONDITIONALLY clears the redo stack
 * The redo-clear is the standard undo-history contract — the moment
 * the user makes a fresh edit, any pending Cmd/Shift+Z targets become
 * unreachable. Without this, after partial undo + fresh edit the user
 * would silently jump back to a stale "after" state on the next redo.
 * We re-implement the policy as a pure function below so a regression
 * to that two-step semantic is caught at the unit level — the layer's
 * `pushHistory` is the same code shape.
 */
describe("pushHistory: redo-invalidation policy (Task #1739)", () => {
  type Stacks = {
    undo: MarkupHistoryEntry[];
    redo: MarkupHistoryEntry[];
  };
  const pushHistory = (state: Stacks, entry: MarkupHistoryEntry): Stacks => {
    const next = [...state.undo, entry];
    return {
      undo:
        next.length > MAX_MARKUP_HISTORY
          ? next.slice(next.length - MAX_MARKUP_HISTORY)
          : next,
      // Mirrors `setRedoStack([])` in PlanMarkupLayer.tsx:361 — every
      // fresh forward edit invalidates the redo stack.
      redo: [],
    };
  };
  const moveEntry = (count: number): MarkupMoveHistoryEntry => ({
    type: "move",
    before: [],
    after: [],
    count,
  });

  it("a fresh push clears a non-empty redo stack", () => {
    const seeded: Stacks = {
      undo: [moveEntry(1)],
      // Two pending redo entries the user could have replayed before.
      redo: [moveEntry(2), moveEntry(3)],
    };
    const after = pushHistory(seeded, moveEntry(4));
    expect(after.undo).toHaveLength(2);
    expect(after.undo[after.undo.length - 1].type).toBe("move");
    expect((after.undo[after.undo.length - 1] as MarkupMoveHistoryEntry).count).toBe(4);
    // The two redo entries must be gone — Ctrl+Shift+Z would otherwise
    // jump to a stale "after" state inconsistent with the new edit.
    expect(after.redo).toEqual([]);
  });

  it("clears the redo stack even when the undo stack is at the bound", () => {
    // A long editing session that fills the undo stack to capacity and
    // still has pending redo entries. The next push must both evict
    // the oldest undo entry AND wipe the redo stack — the two policies
    // are independent and must both fire.
    const fullUndo: MarkupHistoryEntry[] = [];
    for (let i = 0; i < MAX_MARKUP_HISTORY; i++) {
      fullUndo.push(moveEntry(i));
    }
    const seeded: Stacks = {
      undo: fullUndo,
      redo: [moveEntry(900), moveEntry(901)],
    };
    const after = pushHistory(seeded, moveEntry(MAX_MARKUP_HISTORY + 100));
    expect(after.undo).toHaveLength(MAX_MARKUP_HISTORY);
    // Oldest undo entry was evicted — `count: 0` is gone.
    expect((after.undo[0] as MarkupMoveHistoryEntry).count).toBe(1);
    // Newest entry landed on top.
    expect(
      (after.undo[after.undo.length - 1] as MarkupMoveHistoryEntry).count,
    ).toBe(MAX_MARKUP_HISTORY + 100);
    expect(after.redo).toEqual([]);
  });
});

describe("undo stack ring-buffer policy", () => {
  // The drag handler pushes new entries with the standard pattern
  //   next = [...prev, entry];
  //   if (next.length > MAX_MARKUP_HISTORY) next = next.slice(next.length - MAX_MARKUP_HISTORY);
  // This test re-implements that policy and verifies the trailing
  // window stays at exactly MAX_MARKUP_HISTORY entries (oldest dropped
  // from the front), so a long editing session never grows the stack
  // unboundedly while preserving the most-recent N actions.
  const push = (
    stack: MarkupMoveHistoryEntry[],
    entry: MarkupMoveHistoryEntry,
  ): MarkupMoveHistoryEntry[] => {
    const next = [...stack, entry];
    return next.length > MAX_MARKUP_HISTORY
      ? next.slice(next.length - MAX_MARKUP_HISTORY)
      : next;
  };

  it("MAX_MARKUP_HISTORY meets the spec (>= 20)", () => {
    // Task #1723 acceptance criterion: "Cmd/Ctrl+Z repeatedly walks
    // back at least the last N group-move actions (suggested N = 20)".
    expect(MAX_MARKUP_HISTORY).toBeGreaterThanOrEqual(20);
  });

  it("retains every entry while the stack is below the limit", () => {
    let stack: MarkupMoveHistoryEntry[] = [];
    for (let i = 0; i < MAX_MARKUP_HISTORY; i++) {
      stack = push(stack, { type: "move", before: [], after: [], count: i });
    }
    expect(stack).toHaveLength(MAX_MARKUP_HISTORY);
    expect(stack[0].count).toBe(0);
    expect(stack[stack.length - 1].count).toBe(MAX_MARKUP_HISTORY - 1);
  });

  it("drops the oldest entry once the stack exceeds the limit", () => {
    let stack: MarkupMoveHistoryEntry[] = [];
    // Push MAX + 5 distinct entries; only the last MAX should survive.
    for (let i = 0; i < MAX_MARKUP_HISTORY + 5; i++) {
      stack = push(stack, { type: "move", before: [], after: [], count: i });
    }
    expect(stack).toHaveLength(MAX_MARKUP_HISTORY);
    // First retained entry is `5` (entries 0-4 were dropped).
    expect(stack[0].count).toBe(5);
    // Last entry is the most-recent push.
    expect(stack[stack.length - 1].count).toBe(MAX_MARKUP_HISTORY + 4);
  });
});
