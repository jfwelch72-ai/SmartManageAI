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
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
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

  // The single-edit measurement path doesn't push UPDATE history today
  // (no caller forwards a `previous` snapshot). The `skipHistory` flag
  // must NOT change that — its only job is to suppress a future per-
  // call history push if one is added later. Asserting zero pushes
  // here pins down the "no regression" guarantee from the task spec.
  it("does NOT push any history entry on a successful per-id PATCH (no regression)", async () => {
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
    expect(history.pushMeasurementUpdateBatchAction).not.toHaveBeenCalled();
  });
});
