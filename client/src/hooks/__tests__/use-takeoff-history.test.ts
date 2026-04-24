// @vitest-environment jsdom
/**
 * Task #1162 — verify markup style edits are recorded in undo/redo history.
 * Covers undo restoring previous values, redo reapplying new values, and a
 * fresh edit clearing the redo stack.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const apiRequestMock = vi.fn();
const invalidateQueriesMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  queryClient: { invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args) },
}));

import { useTakeoffHistory } from "../use-takeoff-history";

beforeEach(() => {
  apiRequestMock.mockReset();
  invalidateQueriesMock.mockReset();
  apiRequestMock.mockResolvedValue({ json: async () => ({}) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useTakeoffHistory MARKUP_UPDATE", () => {
  it("undo PATCHes the markup back to previous values, redo reapplies new values", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMarkupUpdateAction(
        { id: "m1", color: "#000000", thickness: 2 },
        { id: "m1", color: "#ff0000", thickness: 6 },
        "sheet-1",
      );
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });

    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "PATCH",
      "/api/takeoff/markups/m1",
      { color: "#000000", thickness: 2 },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "markups"],
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(async () => { await result.current.redo(); });

    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "PATCH",
      "/api/takeoff/markups/m1",
      { color: "#ff0000", thickness: 6 },
    );
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("supports text and points snapshots in the same action", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    const oldPoints = [{ x: 0, y: 0 }];
    const newPoints = [{ x: 5, y: 5 }];

    act(() => {
      result.current.pushMarkupUpdateAction(
        { id: "m2", text: "old", points: oldPoints },
        { id: "m2", text: "new", points: newPoints },
        "sheet-1",
      );
    });

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "PATCH",
      "/api/takeoff/markups/m2",
      { text: "old", points: oldPoints },
    );

    await act(async () => { await result.current.redo(); });
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      "PATCH",
      "/api/takeoff/markups/m2",
      { text: "new", points: newPoints },
    );
  });

  // Task #1755 — multi-select markup body drag should be reversible
  // by a single Undo press (not N), and reapplied by a single Redo.
  // Task #1764 — points-only batches now route through the bulk
  // endpoint so a 50-markup group move costs one PATCH to undo and
  // one PATCH to redo (matching the commit cost from #1752), instead
  // of fanning out N parallel per-id PATCHes.
  it("MARKUP_UPDATE_BATCH undo/redo points-only sends one bulk PATCH per press", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    const beforeA = [{ x: 0, y: 0 }];
    const beforeB = [{ x: 1, y: 1 }];
    const afterA = [{ x: 10, y: 10 }];
    const afterB = [{ x: 11, y: 11 }];

    act(() => {
      result.current.pushMarkupUpdateBatchAction(
        [
          { id: "a", points: beforeA },
          { id: "b", points: beforeB },
        ],
        [
          { id: "a", points: afterA },
          { id: "b", points: afterB },
        ],
        "sheet-1",
      );
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/bulk",
      {
        updates: [
          { id: "a", points: beforeA },
          { id: "b", points: beforeB },
        ],
      },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "markups"],
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    apiRequestMock.mockClear();
    invalidateQueriesMock.mockClear();
    await act(async () => { await result.current.redo(); });

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/bulk",
      {
        updates: [
          { id: "a", points: afterA },
          { id: "b", points: afterB },
        ],
      },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  // Task #1764 — explicit guard for the headline N-roundtrip win:
  // a 50-member group-drag undo/redo must collapse into one PATCH
  // each (not 50). Mirrors the bulk-commit shape from #1752.
  it("MARKUP_UPDATE_BATCH undo/redo of a 50-member points-only batch issues one PATCH per press", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    const before = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      points: [{ x: i, y: i }],
    }));
    const after = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      points: [{ x: i + 100, y: i + 100 }],
    }));

    act(() => {
      result.current.pushMarkupUpdateBatchAction(before, after, "sheet-1");
    });

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock.mock.calls[0][0]).toBe("PATCH");
    expect(apiRequestMock.mock.calls[0][1]).toBe("/api/takeoff/markups/bulk");
    expect((apiRequestMock.mock.calls[0][2] as { updates: unknown[] }).updates).toHaveLength(50);
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);

    apiRequestMock.mockClear();
    invalidateQueriesMock.mockClear();
    await act(async () => { await result.current.redo(); });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock.mock.calls[0][1]).toBe("/api/takeoff/markups/bulk");
    expect((apiRequestMock.mock.calls[0][2] as { updates: unknown[] }).updates).toHaveLength(50);
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
  });

  // Task #1758 — bulk color/thickness style edits coalesce into one
  // MARKUP_UPDATE_BATCH entry the same way body drags do (Task #1755),
  // so one Undo press reverses every member's prior style and one Redo
  // press reapplies the new style.
  it("MARKUP_UPDATE_BATCH undo/redo restores per-member color and thickness", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMarkupUpdateBatchAction(
        [
          { id: "a", color: "#000000", thickness: 2 },
          { id: "b", color: "#222222", thickness: 4 },
        ],
        [
          { id: "a", color: "#ff0000", thickness: 6 },
          { id: "b", color: "#ff0000", thickness: 6 },
        ],
        "sheet-1",
      );
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { color: "#000000", thickness: 2 }],
        ["PATCH", "/api/takeoff/markups/b", { color: "#222222", thickness: 4 }],
      ]),
    );
    // Task #1764 — style-only batches must NOT route through the
    // bulk endpoint (its schema only accepts `{ id, points }`); they
    // stay on the per-id Promise.all fallback so undo still restores
    // every member's prior color/thickness.
    expect(apiRequestMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["/api/takeoff/markups/bulk"]),
      ]),
    );
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    apiRequestMock.mockClear();
    await act(async () => { await result.current.redo(); });
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { color: "#ff0000", thickness: 6 }],
        ["PATCH", "/api/takeoff/markups/b", { color: "#ff0000", thickness: 6 }],
      ]),
    );
    expect(apiRequestMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["/api/takeoff/markups/bulk"]),
      ]),
    );
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  // Task #1758 — bulk-renaming N TEXT markups to the same string also
  // collapses into one MARKUP_UPDATE_BATCH entry. Each member's before
  // snapshot must preserve its individual prior label so Undo restores
  // them independently (not all to a shared value).
  it("MARKUP_UPDATE_BATCH undo/redo restores per-member text labels", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMarkupUpdateBatchAction(
        [
          { id: "t1", text: "TBD" },
          { id: "t2", text: "old label" },
        ],
        [
          { id: "t1", text: "Stair detail" },
          { id: "t2", text: "Stair detail" },
        ],
        "sheet-1",
      );
    });

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/t1", { text: "TBD" }],
        ["PATCH", "/api/takeoff/markups/t2", { text: "old label" }],
      ]),
    );

    apiRequestMock.mockClear();
    await act(async () => { await result.current.redo(); });
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/t1", { text: "Stair detail" }],
        ["PATCH", "/api/takeoff/markups/t2", { text: "Stair detail" }],
      ]),
    );
  });

  // Task #1764 — pin down what counts as a "points-only" batch for
  // bulk routing. `applyMarkupSnapshot` already treats any non-
  // `undefined` field as a real update, so a snapshot that explicitly
  // sets `text: null` (clearing a TEXT label) is NOT points-only and
  // must stay on the per-id fallback. The bulk endpoint's Zod schema
  // would reject the extra field anyway. This test guards against a
  // future "optimization" that strips nullable fields and accidentally
  // routes label-clear gestures through /bulk, where they'd silently
  // drop the text:null clear.
  it("MARKUP_UPDATE_BATCH treats snapshots with text:null as non-points-only and uses per-id PATCHes", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMarkupUpdateBatchAction(
        [
          { id: "a", points: [{ x: 0, y: 0 }], text: "old" },
          { id: "b", points: [{ x: 1, y: 1 }], text: "old" },
        ],
        [
          { id: "a", points: [{ x: 5, y: 5 }], text: null },
          { id: "b", points: [{ x: 6, y: 6 }], text: null },
        ],
        "sheet-1",
      );
    });

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock.mock.calls).not.toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["/api/takeoff/markups/bulk"]),
      ]),
    );
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { text: "old", points: [{ x: 0, y: 0 }] }],
        ["PATCH", "/api/takeoff/markups/b", { text: "old", points: [{ x: 1, y: 1 }] }],
      ]),
    );
  });

  it("MARKUP_UPDATE_BATCH ignores empty snapshot arrays", () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    act(() => {
      result.current.pushMarkupUpdateBatchAction([], [], "sheet-1");
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("clears the redo stack when a new edit is pushed", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMarkupUpdateAction(
        { id: "m3", color: "#000" },
        { id: "m3", color: "#fff" },
        "sheet-1",
      );
    });
    await act(async () => { await result.current.undo(); });
    expect(result.current.canRedo).toBe(true);

    act(() => {
      result.current.pushMarkupUpdateAction(
        { id: "m3", thickness: 1 },
        { id: "m3", thickness: 4 },
        "sheet-1",
      );
    });

    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });
});
