// @vitest-environment jsdom
/**
 * Task #1837 — When the markup PATCH (single or bulk) fails with
 * `reason: "not_found"` the server has already deleted those markups,
 * typically because a teammate removed them on another device. The
 * legacy onError handler restored the optimistic-rollback snapshot
 * and stopped, which re-introduced the phantom markup with a red
 * glow until the next manual refresh ("you said it was deleted, but
 * I see it"). These tests lock in the auto-refresh contract:
 *
 *   1. The active sheet's cached markups list drops the failed ids
 *      AFTER the rollback restores the rest of the snapshot.
 *   2. The workspace selection set is pruned via the
 *      `pruneSelectedMarkupIds` callback so the user can't re-select
 *      a phantom that's already gone from the cache.
 *   3. Failures that are NOT `not_found` (e.g. plain network errors
 *      or `cross_sheet`) leave the cache and selection alone — only
 *      not_found triggers the surgical removal.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

const apiRequestMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  // The hook calls `queryClient.setQueryData` / `getQueryData` directly
  // (not via the <QueryClientProvider> the wrapper supplies) so the
  // test exposes the same instance below for seeding and assertion.
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
  useToast: () => ({ toast: toastMock }),
}));

import { useTakeoffData } from "../use-takeoff-data";
import { queryClient as mockedQueryClient } from "@/lib/queryClient";

type TakeoffHistory = ReturnType<typeof useTakeoffHistory>;

const MARKUPS_KEY = ["/api/takeoff/sheets", "sheet-1", "markups"];

function makeMockTakeoffHistory(): TakeoffHistory {
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
  } as unknown as TakeoffHistory;
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

interface RenderOpts {
  pruneSelectedMarkupIds?: (ids: string[]) => void;
}

function renderTakeoffData(
  takeoffHistory: TakeoffHistory,
  opts: RenderOpts = {},
) {
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
          pruneSelectedMarkupIds: opts.pruneSelectedMarkupIds,
        },
      }),
    { wrapper: makeWrapper() },
  );
}

const seedMarkupsCache = (markups: any[]) => {
  mockedQueryClient.setQueryData(MARKUPS_KEY, markups);
};

const readCachedMarkups = () =>
  mockedQueryClient.getQueryData<any[]>(MARKUPS_KEY) ?? [];

/**
 * Build an Error matching `apiRequest`'s contract: `error.status` and
 * `error.data` carry the parsed response body so the failure-summary
 * helper can read structured `reason` / `failedMarkupIds` fields.
 */
function makeNotFoundError(failedIds: string[]): Error {
  const err: Error & { status?: number; data?: any } = new Error(
    "Markup not found",
  );
  err.status = 404;
  err.data = {
    error: "Markup not found",
    reason: "not_found",
    failedMarkupIds: failedIds,
  };
  return err;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMock.mockReset();
  mockedQueryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Task #1837 — auto-refresh stale markups on not_found PATCH", () => {
  it("bulk PATCH not_found removes deleted ids from the cached markups list and leaves siblings rolled-back", async () => {
    seedMarkupsCache([
      {
        id: "m-deleted",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.1 }],
        color: "#ef4444",
        thickness: 2,
      },
      {
        id: "m-survives",
        sheetId: "sheet-1",
        tool: "RECTANGLE",
        points: [{ x: 0.5, y: 0.5 }],
        color: "#3b82f6",
        thickness: 2,
      },
    ]);

    apiRequestMock.mockRejectedValueOnce(makeNotFoundError(["m-deleted"]));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMarkupIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkUpdateMarkupsMutation.mutateAsync({
          updates: [
            { id: "m-deleted", points: [{ x: 0.9, y: 0.9 }] },
            { id: "m-survives", points: [{ x: 0.6, y: 0.6 }] },
          ],
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      // The deleted markup is gone — auto-refresh kicked in.
      expect(cached.find((m) => m.id === "m-deleted")).toBeUndefined();
      // The surviving sibling is rolled back to its pre-drag points
      // (NOT left at the optimistic position) but stays in the cache.
      const survivor = cached.find((m) => m.id === "m-survives");
      expect(survivor).toBeDefined();
      expect(survivor?.points).toEqual([{ x: 0.5, y: 0.5 }]);
    });

    // The selection-prune callback received exactly the deleted id.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["m-deleted"]);

    // The toast still fires with the per-reason wording so the user
    // is told *why* it disappeared (rather than the cache silently
    // changing under them).
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
      }),
    );
    const description = toastMock.mock.calls.at(-1)?.[0]?.description as string;
    expect(description).toContain("no longer exists");
  });

  it("single PATCH not_found removes the deleted id from the cached markups list and prunes the selection", async () => {
    seedMarkupsCache([
      {
        id: "m-1",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.1 }],
        color: "#ef4444",
        thickness: 2,
      },
      {
        id: "m-2",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: [{ x: 0.7, y: 0.7 }],
        color: "#3b82f6",
        thickness: 2,
      },
    ]);

    apiRequestMock.mockRejectedValueOnce(makeNotFoundError(["m-1"]));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMarkupIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.updateMarkupMutation.mutateAsync({
          id: "m-1",
          points: [{ x: 0.9, y: 0.9 }],
          previous: { points: [{ x: 0.1, y: 0.1 }] },
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-1")).toBeUndefined();
      // Sibling untouched.
      expect(cached.find((m) => m.id === "m-2")).toBeDefined();
    });

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["m-1"]);
  });

  it("non-not_found PATCH failures (e.g. network error) leave the cache and selection set untouched", async () => {
    seedMarkupsCache([
      {
        id: "m-1",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.1 }],
        color: "#ef4444",
        thickness: 2,
      },
    ]);

    // Plain Error — no `status` / `data`, so the failure summary falls
    // through to the unknown-reason branch and the helper must NOT
    // prune any ids.
    apiRequestMock.mockRejectedValueOnce(new Error("network down"));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMarkupIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.updateMarkupMutation.mutateAsync({
          id: "m-1",
          points: [{ x: 0.9, y: 0.9 }],
          previous: { points: [{ x: 0.1, y: 0.1 }] },
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      // The markup is rolled back (NOT removed) — only not_found
      // triggers the surgical prune.
      expect(cached).toHaveLength(1);
      expect(cached[0].id).toBe("m-1");
      expect(cached[0].points).toEqual([{ x: 0.1, y: 0.1 }]);
    });

    expect(pruneSpy).not.toHaveBeenCalled();
  });

  it("bulk PATCH with a mixed multi-reason failure only prunes the not_found ids, not the cross_sheet sibling", async () => {
    seedMarkupsCache([
      {
        id: "m-deleted",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: [{ x: 0.1, y: 0.1 }],
        color: "#ef4444",
        thickness: 2,
      },
      {
        id: "m-cross-sheet",
        sheetId: "sheet-1",
        tool: "RECTANGLE",
        points: [{ x: 0.5, y: 0.5 }],
        color: "#3b82f6",
        thickness: 2,
      },
    ]);

    const err: Error & { status?: number; data?: any } = new Error("rejected");
    err.status = 409;
    err.data = {
      error: "Some markups could not be moved",
      failuresByReason: [
        { reason: "not_found", failedMarkupIds: ["m-deleted"] },
        { reason: "cross_sheet", failedMarkupIds: ["m-cross-sheet"] },
      ],
    };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMarkupIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkUpdateMarkupsMutation.mutateAsync({
          updates: [
            { id: "m-deleted", points: [{ x: 0.9, y: 0.9 }] },
            { id: "m-cross-sheet", points: [{ x: 0.6, y: 0.6 }] },
          ],
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMarkups();
      // Only the deleted markup is removed; the cross-sheet sibling
      // is rolled back but stays in the cache so the user can fix
      // it separately.
      expect(cached.find((m) => m.id === "m-deleted")).toBeUndefined();
      const crossSheet = cached.find((m) => m.id === "m-cross-sheet");
      expect(crossSheet).toBeDefined();
      expect(crossSheet?.points).toEqual([{ x: 0.5, y: 0.5 }]);
    });

    // The prune callback only receives the not_found id.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["m-deleted"]);
  });
});
