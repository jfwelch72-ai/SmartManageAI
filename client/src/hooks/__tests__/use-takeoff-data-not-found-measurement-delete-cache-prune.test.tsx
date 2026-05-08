// @vitest-environment jsdom
/**
 * Task #1988 — Mirror the PATCH not_found auto-refresh contract from
 * Task #1970 for the DELETE side. When `deleteMeasurementMutation` and
 * `bulkDeleteMeasurementsMutation` fan out per-id DELETEs and one fails
 * with `reason: "not_found"` (the server has already removed the row,
 * typically because a teammate removed it on another device), the
 * legacy onError handler restored the entire optimistic-rollback
 * snapshot — putting the deleted measurement back on the canvas with
 * no way to clear it short of a manual refresh. This locks in:
 *
 *   1. Per-id DELETE (single) — the not_found id is dropped from the
 *      cached measurements list and the workspace selection set, and
 *      the destructive toast names *why* the row vanished instead of
 *      the legacy generic "Failed to delete measurement".
 *   2. Bulk DELETE — only the not_found ids are excluded from the
 *      restored snapshot; the rest of the bulk's rows return to the
 *      cache so the user can retry whatever else failed. The selection
 *      is pruned only for the not_found ids, and the destructive toast
 *      names *why* a row vanished mid-bulk.
 *   3. Failures that are NOT `not_found` (network errors, validation,
 *      403) leave the cache and selection alone — only `not_found`
 *      triggers the surgical removal.
 *   4. The legacy `failedMeasurementIds` fallback (status 404 with the
 *      attempted id) still works for the per-id delete path so older
 *      server responses don't leak phantoms.
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

const MEASUREMENTS_KEY = ["/api/takeoff/sheets", "sheet-1", "measurements"];

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

const seedMeasurementsCache = (measurements: any[]) => {
  mockedQueryClient.setQueryData(MEASUREMENTS_KEY, measurements);
};

const readCachedMeasurements = () =>
  mockedQueryClient.getQueryData<any[]>(MEASUREMENTS_KEY) ?? [];

/**
 * Build an Error matching `apiRequest`'s contract: `error.status` and
 * `error.data` carry the parsed response body so the not_found
 * extractor can read the structured `reason` / `failedMeasurementIds`
 * fields the server now emits for DELETE (Task #1988, mirroring #1970
 * on the PATCH side).
 */
function makeNotFoundError(failedIds: string[]): Error {
  const err: Error & { status?: number; data?: any } = new Error(
    "Measurement not found — it may have been deleted",
  );
  err.status = 404;
  err.data = {
    error: "Measurement not found — it may have been deleted",
    reason: "not_found",
    failedMeasurementIds: failedIds,
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

describe("Task #1988 — auto-refresh stale measurements on not_found DELETE (single)", () => {
  it("DELETE not_found removes the deleted id from the cached measurements list and prunes the selection", async () => {
    seedMeasurementsCache([
      {
        id: "meas-deleted",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
      {
        id: "meas-survives",
        sheetId: "sheet-1",
        type: "area",
        label: "Pavement",
      },
    ]);

    apiRequestMock.mockRejectedValueOnce(makeNotFoundError(["meas-deleted"]));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.deleteMeasurementMutation.mutateAsync({
          id: "meas-deleted",
          sheetId: "sheet-1",
          type: "linear",
          label: "Curb run",
        } as any);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // The teammate-deleted measurement is gone — auto-refresh fired.
      expect(cached.find((m) => m.id === "meas-deleted")).toBeUndefined();
      // The unrelated sibling stays in the cache.
      expect(cached.find((m) => m.id === "meas-survives")).toBeDefined();
    });

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-deleted"]);

    // The toast still fires — and uses the new not_found wording so
    // the user is told *why* it vanished instead of the legacy generic
    // "Failed to delete measurement".
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Measurement was already deleted");
    expect(lastCall?.description).toContain("teammate");
    expect(lastCall?.variant).toBe("destructive");
  });

  it("non-not_found DELETE failures (e.g. network error) leave the cache and selection set untouched", async () => {
    seedMeasurementsCache([
      {
        id: "meas-1",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
    ]);

    // Plain Error — no `status` / `data`, so the extractor returns
    // an empty list and the legacy generic toast path runs without
    // touching the cache or selection.
    apiRequestMock.mockRejectedValueOnce(new Error("network down"));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.deleteMeasurementMutation.mutateAsync({
          id: "meas-1",
          sheetId: "sheet-1",
          type: "linear",
          label: "Curb run",
        } as any);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // The measurement stays — only not_found triggers the prune.
      expect(cached).toHaveLength(1);
      expect(cached[0].id).toBe("meas-1");
    });

    expect(pruneSpy).not.toHaveBeenCalled();

    // Generic legacy toast wording (NOT the new not_found wording).
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Error");
    expect(lastCall?.description).toBe("Failed to delete measurement");
  });

  it("DELETE plain 404 with NO `reason` / `failedMeasurementIds` (true legacy server) still prunes the attempted id", async () => {
    // True legacy server: the response is just `{ error: "Measurement not found" }`
    // with no `reason` field at all — what the original endpoint
    // returned before Task #1988 added the structured 404. Mixed
    // deployments (client updated ahead of server) need the prune to
    // fire on bare-404 status alone, otherwise a teammate-deleted row
    // leaks back as a phantom on the canvas.
    seedMeasurementsCache([
      {
        id: "meas-bare-404",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
    ]);

    const err: Error & { status?: number; data?: any } = new Error(
      "Measurement not found",
    );
    err.status = 404;
    err.data = { error: "Measurement not found" };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.deleteMeasurementMutation.mutateAsync({
          id: "meas-bare-404",
          sheetId: "sheet-1",
          type: "linear",
          label: "Curb run",
        } as any);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-bare-404")).toBeUndefined();
    });

    expect(pruneSpy).toHaveBeenCalledWith(["meas-bare-404"]);

    // Still emits the destructive not_found toast (not the legacy
    // generic "Failed to delete measurement").
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Measurement was already deleted");
    expect(lastCall?.variant).toBe("destructive");
  });

  it("DELETE not_found falls back to the attempted id when the server omits `failedMeasurementIds` (older response shape)", async () => {
    // Older server responses may include `reason: "not_found"` but no
    // enumerated id list. The extractor falls back to the attempted
    // id (the one the client just tried to DELETE) so the prune still
    // fires instead of leaking a phantom row in mixed-deployment
    // scenarios where the client is updated ahead of the server.
    seedMeasurementsCache([
      {
        id: "meas-legacy",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
    ]);

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
        await result.current.deleteMeasurementMutation.mutateAsync({
          id: "meas-legacy",
          sheetId: "sheet-1",
          type: "linear",
          label: "Curb run",
        } as any);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-legacy")).toBeUndefined();
    });

    expect(pruneSpy).toHaveBeenCalledWith(["meas-legacy"]);
  });
});

describe("Task #1988 — auto-refresh stale measurements on not_found DELETE (bulk)", () => {
  it("bulk DELETE not_found restores the snapshot MINUS the teammate-deleted ids and prunes only those from the selection", async () => {
    seedMeasurementsCache([
      {
        id: "meas-deleted",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
      {
        id: "meas-other",
        sheetId: "sheet-1",
        type: "area",
        label: "Pavement",
      },
    ]);

    // The bulk fans out per-id DELETEs via Promise.all; the first
    // rejection becomes the bulk-level error. Mirror what the client
    // sees when one of the per-id 404s wins the race.
    apiRequestMock.mockRejectedValue(makeNotFoundError(["meas-deleted"]));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkDeleteMeasurementsMutation.mutateAsync([
          {
            id: "meas-deleted",
            sheetId: "sheet-1",
            type: "linear",
            label: "Curb run",
          } as any,
          {
            id: "meas-other",
            sheetId: "sheet-1",
            type: "area",
            label: "Pavement",
          } as any,
        ]);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // The teammate-deleted measurement is gone from the rollback —
      // the canvas does NOT put a phantom row back. The other row
      // returns to the cache so the user can retry the bulk delete.
      expect(cached.find((m) => m.id === "meas-deleted")).toBeUndefined();
      expect(cached.find((m) => m.id === "meas-other")).toBeDefined();
    });

    // Only the teammate-deleted id is pruned from selection — the
    // other row is preserved so the user's multi-select isn't lost.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-deleted"]);

    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Measurement was already deleted");
    expect(lastCall?.description).toContain("teammate");
    expect(lastCall?.variant).toBe("destructive");
  });

  it("bulk DELETE non-not_found failure (network error) restores the FULL snapshot and leaves the selection alone", async () => {
    seedMeasurementsCache([
      {
        id: "meas-1",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
      {
        id: "meas-2",
        sheetId: "sheet-1",
        type: "area",
        label: "Pavement",
      },
    ]);

    apiRequestMock.mockRejectedValue(new Error("network down"));

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkDeleteMeasurementsMutation.mutateAsync([
          {
            id: "meas-1",
            sheetId: "sheet-1",
            type: "linear",
            label: "Curb run",
          } as any,
          {
            id: "meas-2",
            sheetId: "sheet-1",
            type: "area",
            label: "Pavement",
          } as any,
        ]);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // Full snapshot is restored — both rows are back since the
      // failure was not a teammate-delete.
      expect(cached).toHaveLength(2);
      expect(cached.find((m) => m.id === "meas-1")).toBeDefined();
      expect(cached.find((m) => m.id === "meas-2")).toBeDefined();
    });

    expect(pruneSpy).not.toHaveBeenCalled();

    // Generic legacy toast wording (the not_found path is not
    // triggered).
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Error");
    expect(lastCall?.description).toBe("network down");
  });

  it("bulk DELETE multi-id not_found via `failuresByReason` prunes ONLY the not_found ids from the rollback (forward-compatible bulk endpoint)", async () => {
    // Forward-compatible test: when a future bulk-measurement DELETE
    // endpoint emits the same `failuresByReason` shape the markup
    // bulk endpoint uses (Task #1768), the extractor must pull only
    // the not_found ids out of the mixed batch — not the validation
    // siblings — and the rollback must restore those validation rows
    // (plus any unrelated ones) so the user can retry.
    seedMeasurementsCache([
      {
        id: "meas-deleted-a",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
      {
        id: "meas-deleted-b",
        sheetId: "sheet-1",
        type: "area",
        label: "Pavement",
      },
      {
        id: "meas-other",
        sheetId: "sheet-1",
        type: "count",
        label: "Bollard",
      },
    ]);

    const err: Error & { status?: number; data?: any } = new Error(
      "Some measurements could not be deleted",
    );
    err.status = 409;
    err.data = {
      error: "Some measurements could not be deleted",
      failuresByReason: [
        {
          reason: "not_found",
          failedMeasurementIds: ["meas-deleted-a", "meas-deleted-b"],
        },
        { reason: "validation", failedMeasurementIds: ["meas-other"] },
      ],
    };
    apiRequestMock.mockRejectedValue(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.bulkDeleteMeasurementsMutation.mutateAsync([
          {
            id: "meas-deleted-a",
            sheetId: "sheet-1",
            type: "linear",
            label: "Curb run",
          } as any,
          {
            id: "meas-deleted-b",
            sheetId: "sheet-1",
            type: "area",
            label: "Pavement",
          } as any,
          {
            id: "meas-other",
            sheetId: "sheet-1",
            type: "count",
            label: "Bollard",
          } as any,
        ]);
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // The two teammate-deleted rows are NOT restored. The
      // validation row IS restored so the user can retry.
      expect(cached.find((m) => m.id === "meas-deleted-a")).toBeUndefined();
      expect(cached.find((m) => m.id === "meas-deleted-b")).toBeUndefined();
      expect(cached.find((m) => m.id === "meas-other")).toBeDefined();
    });

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith([
      "meas-deleted-a",
      "meas-deleted-b",
    ]);

    // Plural copy when more than one row was teammate-deleted.
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Some measurements were already deleted");
    expect(lastCall?.description).toContain("2");
    expect(lastCall?.description).toContain("teammate");
    expect(lastCall?.variant).toBe("destructive");
  });
});
