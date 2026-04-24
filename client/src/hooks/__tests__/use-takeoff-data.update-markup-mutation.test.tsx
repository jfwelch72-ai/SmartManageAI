// @vitest-environment jsdom
/**
 * Task #1757 — locks in the contract that `updateMarkupMutation.onSuccess`
 * pushes a `MARKUP_UPDATE` history entry exactly when callers forward a
 * `previous` payload. Three recent fixes (#1742 body drag, #1754 resize,
 * #1162 style edits) all rely on this routing — a future refactor that
 * drops the `previous` field at the call site or the diff logic in
 * `onSuccess` would silently break sidebar Undo / Cmd+Z, which has no
 * end-to-end signal until a user reports it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

type TakeoffHistory = ReturnType<typeof useTakeoffHistory>;

const { mockApiRequest, sharedQc } = vi.hoisted(() => {
  return {
    mockApiRequest: vi.fn(),
    sharedQc: { current: null as QueryClient | null },
  };
});

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const qc = new QueryClient({
    defaultOptions: {
      queries: { queryFn: async () => [], retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  sharedQc.current = qc;
  return {
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
    queryClient: qc,
    getQueryFn: () => async () => [],
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTakeoffData } from "../use-takeoff-data";

/**
 * Minimal stand-in for `useTakeoffHistory`. Only `pushMarkupUpdateAction`
 * is asserted against — every method on the public return type is filled
 * with a fresh spy so we can satisfy `useTakeoffData`'s prop typing
 * without any unknown-cast escape hatches.
 */
type HistoryMock = {
  [K in keyof TakeoffHistory]: TakeoffHistory[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : TakeoffHistory[K];
};

function makeHistoryMock(): HistoryMock {
  return {
    pushAction: vi.fn(),
    pushMarkupAction: vi.fn(),
    pushMarkupUpdateAction: vi.fn(),
    pushMarkupUpdateBatchAction: vi.fn(),
    pushMeasurementUpdateBatchAction: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    isPending: false,
    clear: vi.fn(),
  };
}

const noopCallbacks = {
  setUploadDialogOpen: () => {},
  setSelectedSheet: () => {},
  setSelectedMeasurementId: () => {},
  setRenameDialogOpen: () => {},
  setDeleteSheetConfirmOpen: () => {},
  setCategoryDialogOpen: () => {},
  setEditingCategory: () => {},
  setCategoryName: () => {},
  setCategoryColor: () => {},
  setSelectedCategoryId: () => {},
};

function renderTakeoffData(history: HistoryMock, selectedSheet: string | null = "sheet-1") {
  const qc = sharedQc.current;
  if (!qc) throw new Error("Test setup bug: sharedQc was not initialized by the @/lib/queryClient mock");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useTakeoffData({
        projectId: "p1",
        projectCode: "P1",
        selectedSheet,
        uploadDialogOpen: false,
        takeoffHistory: history,
        selectedCategoryId: null,
        callbacks: noopCallbacks,
      }),
    { wrapper },
  );
}

beforeEach(() => {
  mockApiRequest.mockReset();
  // Default: PATCH/POST returns the patched markup. Each test overrides the
  // `json()` payload via mockResolvedValueOnce as needed.
  mockApiRequest.mockResolvedValue({
    json: async () => ({ id: "m1" }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMarkupMutation onSuccess history routing (Task #1757)", () => {
  it("pushes a MARKUP_UPDATE history entry when `previous` is provided (color edit)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        color: "#ff0000",
        previous: { color: "#000000" },
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m1",
      { color: "#ff0000" },
    );
    expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m1", color: "#000000" },
      { id: "m1", color: "#ff0000" },
      "sheet-1",
    );
  });

  it("pushes a MARKUP_UPDATE history entry when `previous.points` is provided (body drag / resize)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    const oldPoints = [{ x: 10, y: 10 }, { x: 20, y: 20 }];
    const newPoints = [{ x: 30, y: 30 }, { x: 40, y: 40 }];

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        points: newPoints,
        previous: { points: oldPoints },
      });
    });

    expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m1", points: oldPoints },
      { id: "m1", points: newPoints },
      "sheet-1",
    );
  });

  it("captures multiple changed fields in a single history entry", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        color: "#abcdef",
        thickness: 8,
        text: "after",
        previous: { color: "#000000", thickness: 2, text: "before" },
      });
    });

    expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m1", color: "#000000", thickness: 2, text: "before" },
      { id: "m1", color: "#abcdef", thickness: 8, text: "after" },
      "sheet-1",
    );
  });

  it("does NOT push history when `previous` is omitted (regression guard for #1742/#1754)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        color: "#ff0000",
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m1",
      { color: "#ff0000" },
    );
    expect(history.pushMarkupUpdateAction).not.toHaveBeenCalled();
  });

  it("does NOT push history when there is no overlapping changed field", async () => {
    // `updates` carries a points change but `previous` only carries a color —
    // there's no before/after pair for the same field, so onSuccess must
    // skip the history push (otherwise undo would PATCH a stale snapshot).
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        points: [{ x: 1, y: 1 }],
        previous: { color: "#000000" },
      });
    });

    expect(history.pushMarkupUpdateAction).not.toHaveBeenCalled();
  });

  it("does NOT push history when `skipHistory: true` is set (Task #1755 multi-select batch)", async () => {
    // The multi-select body-drag branch in TakeoffWorkspace pushes a
    // single MARKUP_UPDATE_BATCH entry up front and then fans out N
    // per-markup PATCHes that each forward `previous` (so optimistic
    // rollback still works) but pass `skipHistory: true` to suppress
    // the per-mutation history push. Without this flag the user would
    // need N+1 Undo presses to reverse one gesture.
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        points: [{ x: 5, y: 5 }],
        previous: { points: [{ x: 0, y: 0 }] },
        skipHistory: true,
      });
    });

    expect(history.pushMarkupUpdateAction).not.toHaveBeenCalled();
    // The PATCH still goes out — only the history push is suppressed.
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m1",
      { points: [{ x: 5, y: 5 }] },
    );
  });

  it("does NOT push history when there is no selectedSheet (no sheet to invalidate against)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history, null);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m1",
        color: "#ff0000",
        previous: { color: "#000000" },
      });
    });

    expect(history.pushMarkupUpdateAction).not.toHaveBeenCalled();
  });
});
