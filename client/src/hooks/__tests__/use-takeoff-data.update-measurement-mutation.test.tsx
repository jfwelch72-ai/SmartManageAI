// @vitest-environment jsdom
/**
 * Task #1770 — locks in the contract that `updateMeasurementMutation`
 * accepts the `skipHistory` flag, strips it from the PATCH body, and
 * routes the underlying request through `/api/takeoff/measurements/:id`
 * unchanged. The flag is the same opt-out that `updateMarkupMutation`
 * uses (#1755 — see `use-takeoff-data.update-markup-mutation.test.tsx`)
 * so bulk callers (e.g. `handleBulkCategoryAssign` in `TakeoffSidebar`)
 * can fan out N per-id PATCHes that suppress per-call history pushes
 * while a single MEASUREMENT_UPDATE_BATCH is added up front.
 *
 * Without this contract, a future refactor that forgets to strip the
 * flag would either reject the PATCH (the API doesn't know `skipHistory`)
 * or, worse, persist it as a measurement field. Either failure mode is
 * silent at the type level — these tests fail loudly the moment that
 * happens.
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
    apiRequest: mockApiRequest,
    queryClient: qc,
    getQueryFn: () => async () => [],
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTakeoffData } from "../use-takeoff-data";

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
    pushMarkupDeleteBatchAction: vi.fn(),
    pushMeasurementUpdateAction: vi.fn(),
    pushMeasurementUpdateBatchAction: vi.fn(),
    pushMeasurementDeleteBatchAction: vi.fn(),
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
  mockApiRequest.mockResolvedValue({ json: async () => ({ id: "m1" }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMeasurementMutation `skipHistory` flag (Task #1770)", () => {
  // The flag must be stripped from the PATCH body — the API has no
  // `skipHistory` column. If a future refactor removes the destructure,
  // either the request fails server-side or the field gets persisted
  // as part of `metadata`. Both are silent at the type level.
  it("strips `skipHistory` from the PATCH body when set to true", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        categoryId: "cat-new",
        skipHistory: true,
      });
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { categoryId: "cat-new" },
    );
  });

  it("strips `skipHistory` from the PATCH body when set to false", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "Renamed",
        skipHistory: false,
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { label: "Renamed" },
    );
  });

  // Backwards compatibility: existing call sites that don't pass the
  // flag continue to PATCH the same body they always did. Guards
  // against a refactor that makes `skipHistory` required.
  it("works without `skipHistory` provided (existing call sites)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        categoryId: "cat-x",
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { categoryId: "cat-x" },
    );
  });

  // When no `previous` payload is forwarded (legacy callers, e.g. a
  // drag-and-drop group reassign that doesn't snapshot), the per-id
  // PATCH must NOT push a MEASUREMENT_UPDATE entry — otherwise undo
  // would PATCH `undefined` back over the field. Pins the "no
  // regression" guarantee from #1770: callers opt IN to undo by
  // passing `previous`.
  it("does NOT push any history entry on a successful per-id PATCH without `previous`", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        categoryId: "cat-new",
        skipHistory: true,
      });
    });

    expect(history.pushAction).not.toHaveBeenCalled();
    expect(history.pushMeasurementUpdateAction).not.toHaveBeenCalled();
    expect(history.pushMeasurementUpdateBatchAction).not.toHaveBeenCalled();
  });
});

// Task #1843 — single-edit history push. Mirrors the markup-side
// contract from #1758 (see `use-takeoff-data.update-markup-mutation.test.tsx`):
// when the properties panel forwards a `previous` snapshot, onSuccess
// must push exactly one MEASUREMENT_UPDATE entry so a single Undo press
// reverses one rename. Without these tests, a future refactor that
// drops the `previous` field at the call site or the diff branch in
// onSuccess would silently break sidebar Undo / Cmd+Z for renames —
// there's no e2e signal until a user reports it.
describe("updateMeasurementMutation onSuccess history routing (Task #1843)", () => {
  it("pushes a MEASUREMENT_UPDATE history entry when `previous` is provided (label rename)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "Renamed",
        previous: { label: "Old name" },
      });
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { label: "Renamed" },
    );
    expect(history.pushMeasurementUpdateAction).toHaveBeenCalledTimes(1);
    expect(history.pushMeasurementUpdateAction).toHaveBeenCalledWith(
      { id: "m1", label: "Old name" },
      { id: "m1", label: "Renamed" },
      "sheet-1",
    );
  });

  it("captures multiple changed fields in a single history entry", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "New",
        costCodeId: "03-100",
        unitCost: 25,
        categoryId: "cat-new",
        previous: { label: "Old", costCodeId: null, unitCost: 10, categoryId: "cat-old" },
      });
    });

    expect(history.pushMeasurementUpdateAction).toHaveBeenCalledTimes(1);
    expect(history.pushMeasurementUpdateAction).toHaveBeenCalledWith(
      { id: "m1", label: "Old", costCodeId: null, unitCost: 10, categoryId: "cat-old" },
      { id: "m1", label: "New", costCodeId: "03-100", unitCost: 25, categoryId: "cat-new" },
      "sheet-1",
    );
  });

  // The `previous` field is a hint to the history layer, not a column
  // on the API. It must be stripped from the PATCH body alongside
  // `skipHistory` so a future server-side schema with `additionalProperties: false`
  // doesn't reject every rename.
  it("strips `previous` from the PATCH body", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "Renamed",
        previous: { label: "Old name" },
      });
    });

    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { label: "Renamed" },
    );
  });

  it("does NOT push history when `previous` is omitted (regression guard for legacy callers)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "Renamed",
      });
    });

    expect(history.pushMeasurementUpdateAction).not.toHaveBeenCalled();
  });

  // Bulk callers (e.g. `handleBulkCategoryAssign` in TakeoffSidebar)
  // pre-push a single MEASUREMENT_UPDATE_BATCH entry up front and then
  // fan out N per-id PATCHes that pass `skipHistory: true`. Even if
  // those calls also forward `previous` (so a future contract change
  // doesn't drop the snapshot), the per-call onSuccess must NOT push
  // — otherwise the user is back to N+1 Undo presses to reverse one
  // gesture.
  it("does NOT push history when `skipHistory: true` is set, even with `previous`", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        categoryId: "cat-new",
        previous: { categoryId: "cat-old" },
        skipHistory: true,
      });
    });

    expect(history.pushMeasurementUpdateAction).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/m1",
      { categoryId: "cat-new" },
    );
  });

  it("does NOT push history when there is no overlapping changed field", async () => {
    // `updates` carries a categoryId change but `previous` only
    // carries a label — there's no before/after pair for the same
    // field, so onSuccess must skip the history push (otherwise undo
    // would PATCH a stale snapshot).
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        categoryId: "cat-new",
        previous: { label: "Old" },
      });
    });

    expect(history.pushMeasurementUpdateAction).not.toHaveBeenCalled();
  });

  it("does NOT push history when there is no selectedSheet", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history, null);

    await act(async () => {
      await result.current.updateMeasurementMutation.mutateAsync({
        id: "m1",
        label: "Renamed",
        previous: { label: "Old name" },
      });
    });

    expect(history.pushMeasurementUpdateAction).not.toHaveBeenCalled();
  });
});
