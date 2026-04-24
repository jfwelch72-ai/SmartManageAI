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
  it("MARKUP_UPDATE_BATCH undo PATCHes every member, redo reapplies every member", async () => {
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

    const undoCalls = apiRequestMock.mock.calls;
    expect(undoCalls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { points: beforeA }],
        ["PATCH", "/api/takeoff/markups/b", { points: beforeB }],
      ]),
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "markups"],
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    apiRequestMock.mockClear();
    await act(async () => { await result.current.redo(); });

    const redoCalls = apiRequestMock.mock.calls;
    expect(redoCalls).toEqual(
      expect.arrayContaining([
        ["PATCH", "/api/takeoff/markups/a", { points: afterA }],
        ["PATCH", "/api/takeoff/markups/b", { points: afterB }],
      ]),
    );
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
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
