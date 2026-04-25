// @vitest-environment jsdom
/**
 * Task #1913 — Locks in the contract that the takeoff workspace's
 * sheet-mutating mutations (rename, duplicate, delete, supersede) all
 * invalidate every drawing set's `/compare` query for the project so
 * the SetStaleBadge stays accurate without window refocus.
 *
 * The PlansTab rename/duplicate/delete/import-plan/document-delete
 * paths already shipped this invalidation in #1895; this test guards
 * the parallel set of paths inside `use-takeoff-data` so a future
 * refactor that drops one of these calls cannot silently regress the
 * staleness badge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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
    pushMeasurementUpdateAction: vi.fn(),
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

function renderTakeoffData(history: HistoryMock, projectId = "p1") {
  const qc = sharedQc.current;
  if (!qc) throw new Error("Test setup bug: sharedQc was not initialized");
  // Pre-seed the drawing-sets query so `useInvalidateDrawingSetCompares`
  // sees two sets without needing a real fetch round-trip.
  qc.setQueryData(
    ["/api/projects", projectId, "drawing-sets"],
    [
      { id: "set-A" },
      { id: "set-B" },
    ],
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useTakeoffData({
        projectId,
        projectCode: "P1",
        selectedSheet: "sheet-1",
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
  mockApiRequest.mockResolvedValue({
    json: async () => ({ id: "sheet-1", sheet: { id: "sheet-1" } }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
  sharedQc.current?.clear();
});

describe("use-takeoff-data drawing-set staleness invalidation (Task #1913)", () => {
  it("rename → invalidates every drawing set's /compare query", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);
    const qc = sharedQc.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await act(async () => {
      await result.current.renameSheetMutation.mutateAsync({
        sheetId: "sheet-1",
        sheetName: "C-101 Sheet",
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-A", "compare"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-B", "compare"],
      });
    });
  });

  it("duplicate → invalidates every drawing set's /compare query", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);
    const qc = sharedQc.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await act(async () => {
      await result.current.duplicateSheetMutation.mutateAsync("sheet-1");
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-A", "compare"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-B", "compare"],
      });
    });
  });

  it("delete → invalidates every drawing set's /compare query", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);
    const qc = sharedQc.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await act(async () => {
      await result.current.deleteSheetMutation.mutateAsync("sheet-1");
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-A", "compare"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-B", "compare"],
      });
    });
  });

  it("supersede → invalidates every drawing set's /compare query (the is_active flip is the staleness trigger)", async () => {
    const history = makeHistoryMock();
    const { result } = renderTakeoffData(history);
    const qc = sharedQc.current!;
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await act(async () => {
      await result.current.supersedeSheetMutation.mutateAsync({
        oldSheetId: "sheet-1",
        newSheetId: "sheet-2",
        revisionLabel: "Rev B",
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-A", "compare"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["/api/projects", "drawing-sets", "set-B", "compare"],
      });
    });
  });

  it("bid-context takeoff → does NOT invalidate any project drawing-set /compare query", async () => {
    const history = makeHistoryMock();
    const qc = sharedQc.current!;
    // Seed sets under the project id so we can prove they were NOT touched.
    qc.setQueryData(
      ["/api/projects", "p1", "drawing-sets"],
      [{ id: "set-A" }, { id: "set-B" }],
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useTakeoffData({
          projectId: "p1",
          projectCode: "P1",
          context: { type: "bid", bidId: "b1", bidCode: "B1" },
          selectedSheet: "sheet-1",
          uploadDialogOpen: false,
          takeoffHistory: history,
          selectedCategoryId: null,
          callbacks: noopCallbacks,
        }),
      { wrapper },
    );

    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await act(async () => {
      await result.current.renameSheetMutation.mutateAsync({
        sheetId: "sheet-1",
        sheetName: "Bid Sheet",
      });
    });

    const compareCalls = invalidateSpy.mock.calls.filter((c) => {
      const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
      return Array.isArray(key) && key[3] === "compare";
    });
    expect(compareCalls).toHaveLength(0);
  });
});
