// @vitest-environment jsdom
/**
 * Task #1989 — Coverage for `bulkUpdateMeasurementsMutation`, the
 * client mutation introduced to coalesce multi-measurement edits
 * (e.g. a 50-row category re-assign from `handleBulkCategoryAssign`)
 * into a single PATCH `/api/takeoff/measurements/bulk` round-trip.
 * Mirrors the markup-side bulk coverage in
 * `use-takeoff-data-bulk-markup-rollback.test.tsx` and the per-id
 * not_found coverage in
 * `use-takeoff-data-not-found-measurement-cache-prune.test.tsx` so
 * the same atomic + auto-refresh contract the per-id mutation
 * already enforces is locked in for the bulk path:
 *
 *   1. Happy path: exactly one PATCH for the whole gesture, the
 *      optimistic cache write reflects every entry's new field
 *      values BEFORE the network resolves, the success-path
 *      invalidate refetches the list, and no destructive toast
 *      fires. The legacy N-parallel-PATCH fan-out (one
 *      `updateMeasurementMutation` per row) would fail this.
 *
 *   2. Atomic rollback: when the server rejects the bulk PATCH the
 *      `onError` handler restores the pre-mutation cache snapshot in
 *      one `setQueryData` call (no sibling-by-sibling unwind) and
 *      surfaces ONE generic destructive toast, not N. A regression
 *      that only restored a subset would leave the canvas in a
 *      half-applied state the user can't see and can't undo.
 *
 *   3. not_found mid-batch: when the server reports any of the
 *      requested ids no longer exist, those ids drop out of the
 *      cached measurements list AND the workspace selection (via
 *      `pruneSelectedMeasurementIds`), and the destructive toast
 *      uses the deleted-by-teammate wording instead of the legacy
 *      generic copy. Mirrors the per-id behavior the workspace
 *      already depends on so the multi-select path doesn't leak
 *      phantom rows the user can keep retrying against.
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
  // The mutation reaches for `queryClient` directly when it cancels
  // in-flight queries, writes the optimistic cache update, invalidates
  // on success, and rolls back on error. Exposing this same instance
  // below lets the test seed the cache and assert the rollback /
  // invalidate side-effects against the very client the hook is using.
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

const MEASUREMENTS_KEY = ["/api/takeoff/sheets", "sheet-1", "measurements"];

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
  pruneSelectedMeasurementIds?: (ids: string[]) => void;
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
          pruneSelectedMeasurementIds: opts.pruneSelectedMeasurementIds,
        },
      }),
    { wrapper: makeWrapper() },
  );
}

const M1_ORIG = {
  id: "meas-1",
  sheetId: "sheet-1",
  type: "LINEAR",
  label: "Curb run A",
  categoryId: "cat-old",
  costCodeId: null,
  lineWidth: 3,
  lineStyle: "solid",
};
const M2_ORIG = {
  id: "meas-2",
  sheetId: "sheet-1",
  type: "AREA",
  label: "Pavement",
  categoryId: "cat-old",
  costCodeId: null,
  lineWidth: 3,
  lineStyle: "solid",
};
const M3_ORIG = {
  id: "meas-3",
  sheetId: "sheet-1",
  type: "LINEAR",
  label: "Sidewalk",
  categoryId: "cat-old",
  costCodeId: null,
  lineWidth: 3,
  lineStyle: "solid",
};

const seedMeasurementsCache = () =>
  mockedQueryClient.setQueryData(MEASUREMENTS_KEY, [
    { ...M1_ORIG },
    { ...M2_ORIG },
    { ...M3_ORIG },
  ]);

const readCachedMeasurements = () =>
  mockedQueryClient.getQueryData<any[]>(MEASUREMENTS_KEY) ?? [];

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMock.mockReset();
  mockedQueryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("bulkUpdateMeasurementsMutation (Task #1989)", () => {
  it("happy path: one bulk PATCH, optimistic cache reflects every entry's new fields, no destructive toast", async () => {
    seedMeasurementsCache();
    apiRequestMock.mockResolvedValue({
      json: async () => [
        { ...M1_ORIG, categoryId: "cat-new" },
        { ...M2_ORIG, categoryId: "cat-new" },
        { ...M3_ORIG, categoryId: "cat-new" },
      ],
    });

    const { result } = renderTakeoffData(makeMockTakeoffHistory());

    await act(async () => {
      await result.current.bulkUpdateMeasurementsMutation.mutateAsync({
        updates: [
          { id: "meas-1", categoryId: "cat-new" },
          { id: "meas-2", categoryId: "cat-new" },
          { id: "meas-3", categoryId: "cat-new" },
        ],
      });
    });

    // Exactly one bulk PATCH for the whole gesture — the legacy
    // N-parallel-PATCH fan-out (one request per measurement) would
    // fail this assertion with `toHaveBeenCalledTimes(3)`.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/measurements/bulk",
      {
        updates: [
          { id: "meas-1", categoryId: "cat-new" },
          { id: "meas-2", categoryId: "cat-new" },
          { id: "meas-3", categoryId: "cat-new" },
        ],
      },
    );

    // The optimistic write in `onMutate` reassigned every member's
    // categoryId; the success-path invalidate() refetches via the
    // mocked queryFn (returns null) but does NOT itself rewrite the
    // cache, so the final cached state still reflects the new ids.
    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-1")?.categoryId).toBe("cat-new");
      expect(cached.find((m) => m.id === "meas-2")?.categoryId).toBe("cat-new");
      expect(cached.find((m) => m.id === "meas-3")?.categoryId).toBe("cat-new");
    });

    // Success path must not surface a destructive toast.
    const destructiveToasts = toastMock.mock.calls.filter(
      ([arg]) => arg?.variant === "destructive",
    );
    expect(destructiveToasts).toHaveLength(0);
  });

  it("optimistic cache write lands BEFORE the bulk PATCH resolves (multi-select edit doesn't snap back mid-flight)", async () => {
    seedMeasurementsCache();
    // Hold the network call open so any cache change observed before
    // resolveApi() must come from `onMutate` — not from a success-path
    // refetch. Locks in the synchronous-before-network contract that
    // keeps a 50-row category re-assign from flickering through the
    // old categoryIds while the PATCH is in flight.
    let resolveApi: (value: unknown) => void = () => {};
    apiRequestMock.mockImplementation(
      () => new Promise((resolve) => { resolveApi = resolve; }),
    );

    const { result } = renderTakeoffData(makeMockTakeoffHistory());

    let mutationPromise!: Promise<unknown>;
    act(() => {
      mutationPromise = result.current.bulkUpdateMeasurementsMutation.mutateAsync({
        updates: [
          { id: "meas-1", categoryId: "cat-new" },
          { id: "meas-2", categoryId: "cat-new" },
        ],
      });
    });

    // PATCH still in flight. Cache should already reflect the new
    // categoryIds for both members (onMutate wrote them via setQueryData).
    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-1")?.categoryId).toBe("cat-new");
      expect(cached.find((m) => m.id === "meas-2")?.categoryId).toBe("cat-new");
    });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);

    // Drain the mutation so the test doesn't leak a pending fetch.
    await act(async () => {
      resolveApi({ json: async () => [] });
      await mutationPromise;
    });
  });

  it("atomic rollback: failed bulk PATCH restores the pre-mutation cache in one write and surfaces ONE error toast", async () => {
    seedMeasurementsCache();
    // Reject the bulk PATCH for the whole gesture. Atomic on the server
    // by construction: either every update lands or none do, so there
    // is no partial state to unwind sibling-by-sibling on the client.
    apiRequestMock.mockRejectedValue(new Error("network down"));

    const { result } = renderTakeoffData(makeMockTakeoffHistory());

    await act(async () => {
      try {
        await result.current.bulkUpdateMeasurementsMutation.mutateAsync({
          updates: [
            { id: "meas-1", categoryId: "cat-new" },
            { id: "meas-2", categoryId: "cat-new" },
            { id: "meas-3", categoryId: "cat-new" },
          ],
        });
      } catch {
        // mutationFn rejects — onError handles the cleanup.
      }
    });

    // `onError` snapshots the pre-mutation cache via `previousMeasurements`
    // and writes it back wholesale — every reassigned member returns to
    // its pre-edit categoryId in one cache write, not three.
    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-1")?.categoryId).toBe("cat-old");
      expect(cached.find((m) => m.id === "meas-2")?.categoryId).toBe("cat-old");
      expect(cached.find((m) => m.id === "meas-3")?.categoryId).toBe("cat-old");
    });

    // Exactly one user-visible toast for the whole failed gesture —
    // the pre-#1989 fan-out would have surfaced N toasts here, that
    // UX regression must stay dead.
    const destructiveToasts = toastMock.mock.calls.filter(
      ([arg]) => arg?.variant === "destructive",
    );
    expect(destructiveToasts).toHaveLength(1);
    expect(destructiveToasts[0][0]).toEqual(
      expect.objectContaining({
        title: "Error",
        variant: "destructive",
      }),
    );
  });

  it("not_found mid-batch: prunes the deleted ids from the cache and the workspace selection", async () => {
    seedMeasurementsCache();

    // Server rejects with the structured `failedMeasurementIds` shape
    // the bulk endpoint emits when one or more requested rows are
    // gone — typically because a teammate deleted them on another
    // device while the user was multi-selecting.
    const err: Error & { status?: number; data?: any } = new Error(
      "Some measurements could not be updated because they no longer exist",
    );
    err.status = 404;
    err.data = {
      error: "Some measurements could not be updated because they no longer exist",
      reason: "not_found",
      failedMeasurementIds: ["meas-2"],
      failuresByReason: [
        {
          reason: "not_found",
          failedMeasurementIds: ["meas-2"],
          message: "Some measurements could not be updated because they no longer exist",
        },
      ],
    };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkUpdateMeasurementsMutation.mutateAsync({
          updates: [
            { id: "meas-1", categoryId: "cat-new" },
            { id: "meas-2", categoryId: "cat-new" },
            { id: "meas-3", categoryId: "cat-new" },
          ],
        });
      } catch {
        // mutationFn rejects — onError handles the cleanup.
      }
    });

    // The deleted row dropped out of the cache, AND the surviving
    // siblings were rolled back to their pre-edit categoryId because
    // the bulk PATCH is atomic on the server (none of the updates
    // landed). Without the rollback the cache would diverge from
    // the DB on every multi-select retry.
    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-2")).toBeUndefined();
      expect(cached.find((m) => m.id === "meas-1")?.categoryId).toBe("cat-old");
      expect(cached.find((m) => m.id === "meas-3")?.categoryId).toBe("cat-old");
    });

    // The selection-prune callback received exactly the deleted id —
    // the surviving siblings stay selected so the user can retry the
    // edit against the live rows in one keypress.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-2"]);

    // The destructive toast uses the deleted-by-teammate wording so
    // the user is told *why* the edit failed rather than the legacy
    // generic "Failed to update measurements" copy.
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Measurement was deleted");
    expect(lastCall?.description).toContain("teammate");
    expect(lastCall?.variant).toBe("destructive");
  });

  it("not_found via legacy attempted-id fallback (no failedMeasurementIds field in response) still prunes the attempted ids", async () => {
    // Older / out-of-date server responses may include
    // `reason: "not_found"` but not the enumerated id list. The
    // extractor falls back to the attempted ids (the ones the client
    // just tried to PATCH) so the prune still fires instead of
    // leaking phantoms across the multi-select.
    seedMeasurementsCache();

    const err: Error & { status?: number; data?: any } = new Error(
      "Measurement not found",
    );
    err.status = 404;
    err.data = {
      error: "Measurement not found",
      reason: "not_found",
    };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkUpdateMeasurementsMutation.mutateAsync({
          updates: [
            { id: "meas-1", categoryId: "cat-new" },
            { id: "meas-3", categoryId: "cat-new" },
          ],
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-1", "meas-3"]);
  });
});
