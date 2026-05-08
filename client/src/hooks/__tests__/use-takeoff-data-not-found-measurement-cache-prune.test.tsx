// @vitest-environment jsdom
/**
 * Task #1970 — When `updateMeasurementMutation` PATCH fails with
 * `reason: "not_found"` the server has already deleted that
 * measurement (typically because a teammate removed it on another
 * device). The legacy onError handler only fired a generic
 * "Failed to update measurement" toast and left the cache untouched,
 * so the next edit attempt against the same row would just keep
 * failing until the user manually refreshed. Mirrors the markup-side
 * coverage in `use-takeoff-data-not-found-cache-prune.test.tsx` and
 * locks in the auto-refresh contract for measurements:
 *
 *   1. The active sheet's cached measurements list drops the failed
 *      ids before the rollback toast.
 *   2. The workspace selection (`selectedMeasurementId` and any
 *      multi-select set) is pruned via the
 *      `pruneSelectedMeasurementIds` callback so the user can't
 *      re-edit a phantom that's already gone from the cache.
 *   3. Failures that are NOT `not_found` (e.g. plain network errors
 *      or validation rejections) leave the cache and selection alone
 *      — only not_found triggers the surgical removal.
 *   4. The destructive toast names *why* the edit failed instead of
 *      the legacy generic wording.
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

const seedMeasurementsCache = (measurements: any[]) => {
  mockedQueryClient.setQueryData(MEASUREMENTS_KEY, measurements);
};

const readCachedMeasurements = () =>
  mockedQueryClient.getQueryData<any[]>(MEASUREMENTS_KEY) ?? [];

/**
 * Build an Error matching `apiRequest`'s contract: `error.status` and
 * `error.data` carry the parsed response body so the not_found
 * extractor can read the structured `reason` / `failedMeasurementIds`
 * fields the server now emits (Task #1970).
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

describe("Task #1970 — auto-refresh stale measurements on not_found PATCH", () => {
  it("PATCH not_found removes the deleted id from the cached measurements list and prunes the selection", async () => {
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
        await result.current.updateMeasurementMutation.mutateAsync({
          id: "meas-deleted",
          label: "New label",
          previous: { label: "Curb run" },
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      // The deleted measurement is gone — auto-refresh kicked in.
      expect(cached.find((m) => m.id === "meas-deleted")).toBeUndefined();
      // The unrelated sibling stays in the cache.
      expect(cached.find((m) => m.id === "meas-survives")).toBeDefined();
    });

    // The selection-prune callback received exactly the deleted id.
    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-deleted"]);

    // The toast still fires — and uses the new not_found wording so
    // the user is told *why* it disappeared (rather than the legacy
    // generic "Failed to update measurement").
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "destructive",
      }),
    );
    const lastCall = toastMock.mock.calls.at(-1)?.[0];
    expect(lastCall?.title).toBe("Measurement was deleted");
    expect(lastCall?.description).toContain("teammate");
  });

  it("non-not_found PATCH failures (e.g. network error) leave the cache and selection set untouched", async () => {
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
        await result.current.updateMeasurementMutation.mutateAsync({
          id: "meas-1",
          label: "New label",
          previous: { label: "Curb run" },
        });
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
    expect(lastCall?.description).toBe("Failed to update measurement");
  });

  it("validation failure (400 with reason: 'validation') leaves the cache and selection alone", async () => {
    seedMeasurementsCache([
      {
        id: "meas-1",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
    ]);

    const err: Error & { status?: number; data?: any } = new Error(
      "Invalid measurement data",
    );
    err.status = 400;
    err.data = {
      error: "Invalid measurement data",
      reason: "validation",
      details: [],
    };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.updateMeasurementMutation.mutateAsync({
          id: "meas-1",
          label: "New label",
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached).toHaveLength(1);
      expect(cached[0].id).toBe("meas-1");
    });

    expect(pruneSpy).not.toHaveBeenCalled();
  });

  it("PATCH not_found falls back to the attempted id when the server omits `failedMeasurementIds` (older response shape)", async () => {
    // Older server responses may include `reason: "not_found"` but no
    // enumerated id list. The extractor falls back to the attempted
    // id (the one the client just tried to PATCH) so the prune still
    // fires instead of leaking a phantom row.
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
        await result.current.updateMeasurementMutation.mutateAsync({
          id: "meas-legacy",
          label: "New label",
        });
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

  it("PATCH not_found via the multi-reason `failuresByReason` shape prunes only the not_found ids", async () => {
    // Forward-compatible test: when a future bulk-measurement PATCH
    // endpoint emits the same `failuresByReason` shape the markup
    // bulk endpoint uses (Task #1768), the extractor must pull only
    // the not_found ids out of the mixed batch, not the validation
    // siblings.
    seedMeasurementsCache([
      {
        id: "meas-deleted",
        sheetId: "sheet-1",
        type: "linear",
        label: "Curb run",
      },
      {
        id: "meas-validation",
        sheetId: "sheet-1",
        type: "area",
        label: "Pavement",
      },
    ]);

    const err: Error & { status?: number; data?: any } = new Error(
      "Some measurements could not be updated",
    );
    err.status = 409;
    err.data = {
      error: "Some measurements could not be updated",
      failuresByReason: [
        { reason: "not_found", failedMeasurementIds: ["meas-deleted"] },
        { reason: "validation", failedMeasurementIds: ["meas-validation"] },
      ],
    };
    apiRequestMock.mockRejectedValueOnce(err);

    const pruneSpy = vi.fn();
    const { result } = renderTakeoffData(makeMockTakeoffHistory(), {
      pruneSelectedMeasurementIds: pruneSpy,
    });

    await act(async () => {
      try {
        await result.current.updateMeasurementMutation.mutateAsync({
          id: "meas-deleted",
          label: "New label",
        });
      } catch {
        // mutationFn rejects — onError handles cleanup.
      }
    });

    await waitFor(() => {
      const cached = readCachedMeasurements();
      expect(cached.find((m) => m.id === "meas-deleted")).toBeUndefined();
      expect(cached.find((m) => m.id === "meas-validation")).toBeDefined();
    });

    expect(pruneSpy).toHaveBeenCalledTimes(1);
    expect(pruneSpy).toHaveBeenCalledWith(["meas-deleted"]);
  });
});
