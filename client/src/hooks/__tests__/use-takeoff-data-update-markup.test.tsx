// @vitest-environment jsdom
/**
 * Task #1756 — markup color/thickness edits push a MARKUP_UPDATE entry
 * onto the takeoff history stack so the sidebar Undo button reverses
 * them. Locks in the contract of `useTakeoffData.updateMarkupMutation`.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

const apiRequestMock = vi.fn();

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  const queryClient = new actual.QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    apiRequest: apiRequestMock,
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTakeoffData } from "../use-takeoff-data";

type TakeoffHistory = ReturnType<typeof useTakeoffHistory>;

function makeMockTakeoffHistory(): TakeoffHistory {
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

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function renderTakeoffData(takeoffHistory: TakeoffHistory) {
  return renderHook(
    () =>
      useTakeoffData({
        projectId: "p-1",
        projectCode: "PROJ-1",
        selectedSheet: "sheet-1",
        uploadDialogOpen: false,
        takeoffHistory,
        selectedCategoryId: null,
        callbacks: {
          setUploadDialogOpen: vi.fn(),
          setSelectedSheet: vi.fn(),
          setSelectedMeasurementId: vi.fn(),
          setRenameDialogOpen: vi.fn(),
          setDeleteSheetConfirmOpen: vi.fn(),
          setCategoryDialogOpen: vi.fn(),
          setEditingCategory: vi.fn(),
          setCategoryName: vi.fn(),
          setCategoryColor: vi.fn(),
          setSelectedCategoryId: vi.fn(),
        },
      }),
    { wrapper: makeWrapper() },
  );
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockResolvedValue({ json: async () => ({ id: "m-1" }) });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMarkupMutation — markup style edits land on takeoff history", () => {
  it("pushes a MARKUP_UPDATE entry and strips `previous` from the PATCH body when color changes", async () => {
    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m-1",
        color: "#3b82f6",
        previous: { color: "#ef4444" },
      });
    });

    await waitFor(() => {
      expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m-1",
      { color: "#3b82f6" },
    );

    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m-1", color: "#ef4444" },
      { id: "m-1", color: "#3b82f6" },
      "sheet-1",
    );
  });

  it("records thickness changes so undo restores the prior thickness", async () => {
    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m-2",
        thickness: 8,
        previous: { thickness: 2 },
      });
    });

    await waitFor(() => {
      expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    });

    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m-2",
      { thickness: 8 },
    );

    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m-2", thickness: 2 },
      { id: "m-2", thickness: 8 },
      "sheet-1",
    );
  });

  it("captures color and thickness in a single history entry when both change at once", async () => {
    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m-3",
        color: "#10b981",
        thickness: 4,
        previous: { color: "#000000", thickness: 1 },
      });
    });

    await waitFor(() => {
      expect(history.pushMarkupUpdateAction).toHaveBeenCalledTimes(1);
    });

    expect(history.pushMarkupUpdateAction).toHaveBeenCalledWith(
      { id: "m-3", color: "#000000", thickness: 1 },
      { id: "m-3", color: "#10b981", thickness: 4 },
      "sheet-1",
    );
  });

  it("does not push a history entry when the caller omits `previous`", async () => {
    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.updateMarkupMutation.mutateAsync({
        id: "m-4",
        color: "#f59e0b",
      });
    });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "PATCH",
        "/api/takeoff/markups/m-4",
        { color: "#f59e0b" },
      );
    });

    expect(history.pushMarkupUpdateAction).not.toHaveBeenCalled();
  });
});
