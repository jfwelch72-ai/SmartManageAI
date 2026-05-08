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
  apiRequest: apiRequestMock,
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
    expect((apiRequestMock.mock.calls[0] as unknown[])[0]).toBe("PATCH");
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

  // Task #1770 — mirror image of MARKUP_UPDATE_BATCH (#1755/#1758) for
  // measurements. A bulk category-assign across N selected measurements
  // must collapse into a single MEASUREMENT_UPDATE_BATCH entry so one
  // Undo press restores every member's prior categoryId and one Redo
  // press reapplies the new categoryId. The measurement API has no
  // `/bulk` PATCH endpoint, so undo/redo fans out per-id PATCHes via
  // Promise.all — the test asserts each PATCH lands on its own member's
  // URL so a future "optimization" that mis-routes them is caught.
  it("MEASUREMENT_UPDATE_BATCH undo/redo restores per-member categoryId via per-id PATCHes", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMeasurementUpdateBatchAction(
        [
          { id: "m1", categoryId: "cat-old-1" },
          { id: "m2", categoryId: null },
          { id: "m3", categoryId: "cat-old-3" },
        ],
        [
          { id: "m1", categoryId: "cat-new" },
          { id: "m2", categoryId: "cat-new" },
          { id: "m3", categoryId: "cat-new" },
        ],
        "sheet-1",
      );
    });

    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    await act(async () => { await result.current.undo(); });

    // Task #2653 — Batches now collapse into one /bulk PATCH.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      {
        updates: [
          { id: "m1", categoryId: "cat-old-1" },
          { id: "m2", categoryId: null },
          { id: "m3", categoryId: "cat-old-3" },
        ],
      },
    );
    // Measurements (not markups) — invalidate the measurements cache key.
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "measurements"],
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    apiRequestMock.mockClear();
    invalidateQueriesMock.mockClear();
    await act(async () => { await result.current.redo(); });

    // Task #2653 — Batches now collapse into one /bulk PATCH.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      {
        updates: [
          { id: "m1", categoryId: "cat-new" },
          { id: "m2", categoryId: "cat-new" },
          { id: "m3", categoryId: "cat-new" },
        ],
      },
    );
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "measurements"],
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  // Task #1770 — only fields explicitly present on the snapshot are
  // PATCHed. A bulk categoryId edit must NOT touch label, color,
  // costCodeId, etc. on its members; otherwise undo would silently
  // null out unrelated fields. Mirrors the markup snapshot semantics.
  it("MEASUREMENT_UPDATE_BATCH apply only PATCHes fields explicitly on the snapshot", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMeasurementUpdateBatchAction(
        [{ id: "m1", categoryId: "cat-old" }],
        [{ id: "m1", categoryId: "cat-new" }],
        "sheet-1",
      );
    });

    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    // Strict equality — no `label`, `color`, `unitCost`, etc. leak
    // into the PATCH body.
    // Task #2653 — Single-row batches still go through /bulk so
    // the per-row CAS (when version is captured) is honored.
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      { updates: [{ id: "m1", categoryId: "cat-old" }] },
    );
  });

  // Task #1770 — supports multi-field per-member snapshots (e.g. a
  // future bulk edit that changes both label and color in one gesture).
  // Each member's prior label and color are restored independently on
  // undo, then reapplied on redo.
  it("MEASUREMENT_UPDATE_BATCH undo/redo restores per-member label and color", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    act(() => {
      result.current.pushMeasurementUpdateBatchAction(
        [
          { id: "a", label: "Slab A", color: "#000000" },
          { id: "b", label: "Slab B", color: "#111111" },
        ],
        [
          { id: "a", label: "Renamed", color: "#ff0000" },
          { id: "b", label: "Renamed", color: "#ff0000" },
        ],
        "sheet-1",
      );
    });

    // Task #2653 — Batches of bulk-safe fields (no `points`) are
    // replayed through the `/bulk` endpoint in a single PATCH so the
    // server can apply the per-row CAS atomically.
    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      {
        updates: [
          { id: "a", label: "Slab A", color: "#000000" },
          { id: "b", label: "Slab B", color: "#111111" },
        ],
      },
    );

    apiRequestMock.mockClear();
    await act(async () => { await result.current.redo(); });
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      {
        updates: [
          { id: "a", label: "Renamed", color: "#ff0000" },
          { id: "b", label: "Renamed", color: "#ff0000" },
        ],
      },
    );
  });

  it("MEASUREMENT_UPDATE_BATCH ignores empty snapshot arrays", () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    act(() => {
      result.current.pushMeasurementUpdateBatchAction([], [], "sheet-1");
    });
    expect(result.current.canUndo).toBe(false);
  });

  // Task #1770 — a 50-member bulk categoryId edit (e.g. assigning every
  // measurement on a sheet to a new category) must still collapse into
  // ONE history entry, not 50, and one Undo must restore every prior
  // categoryId. We don't have a `/bulk` measurement endpoint so the
  // undo cost is N PATCHes — but the user-visible cost is one press.
  it("MEASUREMENT_UPDATE_BATCH coalesces a 50-member bulk edit into one Undo press", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    const before = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      categoryId: `cat-old-${i}`,
    }));
    const after = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      categoryId: "cat-new",
    }));

    act(() => {
      result.current.pushMeasurementUpdateBatchAction(before, after, "sheet-1");
    });

    // Single history entry — one Undo press is enough to revert.
    expect(result.current.canUndo).toBe(true);

    // Task #2653 — Bulk-safe batches now collapse to a single
    // /bulk PATCH on the server (one round-trip instead of 50).
    await act(async () => { await result.current.undo(); });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      expect.objectContaining({
        updates: expect.arrayContaining([
          expect.objectContaining({ id: "m0", categoryId: "cat-old-0" }),
        ]),
      }),
    );
    expect(invalidateQueriesMock).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  // Task #1901 — A bulk DELETE of N measurements must collapse into a
  // single MEASUREMENT_DELETE_BATCH entry so one Undo press recreates
  // every removed row (and one Redo press re-deletes them). The
  // measurements API has no /restore-bulk counterpart to #1860, so
  // undo fans out per-id POSTs and redo fans out per-id DELETEs via
  // Promise.all — same shape as the per-id `DELETE` undo path. The
  // restored rows receive new ids on undo; the redo branch must
  // target those new ids, so we assert the entry stores them back.
  it("MEASUREMENT_DELETE_BATCH undo fans out per-id POSTs and redo targets the restored ids", async () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));

    const deletedRows = [
      {
        id: "old-m1",
        sheetId: "sheet-1",
        type: "LINEAR",
        points: JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
        label: "Slab A",
      },
      {
        id: "old-m2",
        sheetId: "sheet-1",
        type: "AREA",
        points: JSON.stringify([{ x: 0, y: 0 }, { x: 2, y: 2 }]),
        label: "Slab B",
      },
    ] as any;

    act(() => {
      result.current.pushMeasurementDeleteBatchAction(deletedRows, "sheet-1");
    });

    expect(result.current.canUndo).toBe(true);

    // Undo: server returns brand-new ids; entry must remember them
    // so redo can target the right rows. Capture the id at call time
    // (not inside the json closure) so each POST returns its own id
    // even though Promise.all fires both in parallel.
    let postCount = 0;
    apiRequestMock.mockImplementation(async (method: string, _url: string) => {
      if (method === "POST") {
        postCount += 1;
        const id = `restored-${postCount}`;
        return { json: async () => ({ id }) };
      }
      return { json: async () => ({}) };
    });

    await act(async () => { await result.current.undo(); });

    expect(apiRequestMock.mock.calls.filter(([m]) => m === "POST")).toHaveLength(2);
    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["POST", "/api/takeoff/measurements", expect.objectContaining({ sheetId: "sheet-1", label: "Slab A" })],
        ["POST", "/api/takeoff/measurements", expect.objectContaining({ sheetId: "sheet-1", label: "Slab B" })],
      ]),
    );
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["/api/takeoff/sheets", "sheet-1", "measurements"],
    });

    apiRequestMock.mockClear();
    apiRequestMock.mockResolvedValue({ json: async () => ({}) });

    // Redo: must DELETE the freshly-restored ids, not the original ones.
    await act(async () => { await result.current.redo(); });

    expect(apiRequestMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["DELETE", "/api/takeoff/measurements/restored-1"],
        ["DELETE", "/api/takeoff/measurements/restored-2"],
      ]),
    );
  });

  it("MEASUREMENT_DELETE_BATCH ignores empty arrays", () => {
    const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
    act(() => {
      result.current.pushMeasurementDeleteBatchAction([], "sheet-1");
    });
    expect(result.current.canUndo).toBe(false);
  });

  // Task #2653 — undo/redo replays the snapshot's captured `version`
  // as `expectedVersion`, and a 409 from the per-id PATCH is surfaced
  // through the `onMeasurementConflict` callback so the workspace can
  // open the same conflict-resolution dialog the per-id PATCH path uses.
  describe("MEASUREMENT_UPDATE undo/redo with optimistic concurrency", () => {
    it("sends `expectedVersion` from the captured snapshot during undo", async () => {
      const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
      act(() => {
        result.current.pushMeasurementUpdateAction(
          { id: "meas-1", label: "old", version: 5 },
          { id: "meas-1", label: "new", version: 5 },
          "sheet-1",
        );
      });
      apiRequestMock.mockResolvedValueOnce({ json: async () => ({}) });
      await act(async () => { await result.current.undo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/meas-1",
        { label: "old", expectedVersion: 5 },
      );
    });

    it("surfaces a 409 version_conflict through onMeasurementConflict and pushes the entry back", async () => {
      const onConflict = vi.fn();
      const { result } = renderHook(() =>
        useTakeoffHistory("sheet-1", { onMeasurementConflict: onConflict }),
      );
      act(() => {
        result.current.pushMeasurementUpdateAction(
          { id: "meas-1", label: "old", version: 5 },
          { id: "meas-1", label: "new", version: 5 },
          "sheet-1",
        );
      });
      const err: Error & { status?: number; data?: unknown } = new Error("409");
      err.status = 409;
      err.data = {
        reason: "version_conflict",
        currentVersion: 7,
        current: { id: "meas-1", label: "teammate" },
      };
      apiRequestMock.mockRejectedValueOnce(err);

      await act(async () => { await result.current.undo(); });

      expect(onConflict).toHaveBeenCalledTimes(1);
      expect(onConflict).toHaveBeenCalledWith(
        expect.objectContaining({
          measurementId: "meas-1",
          currentVersion: 7,
          replay: "undo",
        }),
      );
      // Entry pushed back so the user can retry after resolving.
      expect(result.current.canUndo).toBe(true);
    });

    it("uses the bulk endpoint and surfaces per-row conflicts on a batch undo", async () => {
      const onConflict = vi.fn();
      const { result } = renderHook(() =>
        useTakeoffHistory("sheet-1", { onMeasurementConflict: onConflict }),
      );
      act(() => {
        result.current.pushMeasurementUpdateBatchAction(
          [
            { id: "a", categoryId: "old-cat", version: 3 },
            { id: "b", categoryId: "old-cat", version: 4 },
          ],
          [
            { id: "a", categoryId: "new-cat", version: 3 },
            { id: "b", categoryId: "new-cat", version: 4 },
          ],
          "sheet-1",
        );
      });
      const err: Error & { status?: number; data?: unknown } = new Error("409");
      err.status = 409;
      err.data = {
        reason: "version_conflict",
        failedMeasurementIds: ["a"],
        conflicts: [
          { id: "a", expectedVersion: 3, currentVersion: 9, current: { id: "a" } },
        ],
      };
      apiRequestMock.mockRejectedValueOnce(err);

      await act(async () => { await result.current.undo(); });

      // Replay went through the bulk endpoint with per-row expectedVersion.
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/bulk",
        {
          updates: [
            { id: "a", categoryId: "old-cat", expectedVersion: 3 },
            { id: "b", categoryId: "old-cat", expectedVersion: 4 },
          ],
        },
      );
      expect(onConflict).toHaveBeenCalledWith(
        expect.objectContaining({ measurementId: "a", currentVersion: 9, replay: "undo" }),
      );
      expect(result.current.canUndo).toBe(true);
    });

    // Task #2653 — Repeated Undo→Redo→Undo cycles must roll the
    // server's bumped `version` forward onto the opposite snapshot.
    // Otherwise the second same-direction replay sends the original
    // (now stale) expectedVersion and false-conflicts against itself.
    it("rolls bumped version forward across undo→redo→undo cycles (per-id)", async () => {
      const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
      act(() => {
        result.current.pushMeasurementUpdateAction(
          { id: "meas-1", label: "old", version: 5 },
          { id: "meas-1", label: "new", version: 5 },
          "sheet-1",
        );
      });
      // Cycle 1: undo bumps server to v6.
      apiRequestMock.mockResolvedValueOnce({ json: async () => ({ id: "meas-1", version: 6 }) });
      await act(async () => { await result.current.undo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/meas-1",
        { label: "old", expectedVersion: 5 },
      );

      // Cycle 2: redo must send expectedVersion=6 (post-undo), not the
      // original 5. Server bumps to v7.
      apiRequestMock.mockResolvedValueOnce({ json: async () => ({ id: "meas-1", version: 7 }) });
      await act(async () => { await result.current.redo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/meas-1",
        { label: "new", expectedVersion: 6 },
      );

      // Cycle 3: undo again must send expectedVersion=7 (post-redo).
      apiRequestMock.mockResolvedValueOnce({ json: async () => ({ id: "meas-1", version: 8 }) });
      await act(async () => { await result.current.undo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/meas-1",
        { label: "old", expectedVersion: 7 },
      );
    });

    it("rolls bumped per-row versions forward across undo→redo cycles (bulk)", async () => {
      const { result } = renderHook(() => useTakeoffHistory("sheet-1"));
      act(() => {
        result.current.pushMeasurementUpdateBatchAction(
          [
            { id: "a", categoryId: "old-cat", version: 3 },
            { id: "b", categoryId: "old-cat", version: 4 },
          ],
          [
            { id: "a", categoryId: "new-cat", version: 3 },
            { id: "b", categoryId: "new-cat", version: 4 },
          ],
          "sheet-1",
        );
      });
      // Undo: server returns the bumped versions.
      apiRequestMock.mockResolvedValueOnce({
        json: async () => [
          { id: "a", version: 4 },
          { id: "b", version: 5 },
        ],
      });
      await act(async () => { await result.current.undo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/bulk",
        {
          updates: [
            { id: "a", categoryId: "old-cat", expectedVersion: 3 },
            { id: "b", categoryId: "old-cat", expectedVersion: 4 },
          ],
        },
      );
      // Redo: must send the post-undo versions per row, not the
      // original 3/4.
      apiRequestMock.mockResolvedValueOnce({
        json: async () => [
          { id: "a", version: 5 },
          { id: "b", version: 6 },
        ],
      });
      await act(async () => { await result.current.redo(); });
      expect(apiRequestMock).toHaveBeenLastCalledWith(
        "PATCH",
        "/api/takeoff/measurements/bulk",
        {
          updates: [
            { id: "a", categoryId: "new-cat", expectedVersion: 4 },
            { id: "b", categoryId: "new-cat", expectedVersion: 5 },
          ],
        },
      );
    });
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
