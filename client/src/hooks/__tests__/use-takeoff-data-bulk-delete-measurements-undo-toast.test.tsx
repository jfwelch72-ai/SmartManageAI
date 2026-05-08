// @vitest-environment jsdom
/**
 * Task #1901 — Visible Undo toast after bulk-deleting measurements.
 *
 * Mirrors the markup-side coverage in
 * `use-takeoff-data-bulk-delete-undo-toast.test.tsx` (#1882). The
 * measurement bulk-delete path differs in two ways from the markup
 * path:
 *   - There is no `/bulk` DELETE endpoint, so the mutation fans out
 *     N per-id DELETEs via Promise.all instead of one round-trip.
 *   - There is no `/restore-bulk` endpoint, so the new
 *     MEASUREMENT_DELETE_BATCH undo branch fans out per-id POSTs
 *     (already exercised by `use-takeoff-history.test.ts`); this
 *     file only locks down the *toast* contract.
 *
 * The contract this file locks down:
 *   1. After `bulkDeleteMeasurementsMutation` resolves, exactly one
 *      destructive-style toast is shown with a "Deleted N
 *      measurements" title (singular for N=1) and an Undo action
 *      element. The toast carries a `duration` so the shared toast
 *      hook auto-dismisses it (without `duration` it would be pinned
 *      forever — see TOAST_REMOVE_DELAY in `use-toast`).
 *   2. Exactly one MEASUREMENT_DELETE_BATCH history entry is pushed
 *      with the full row snapshots, so a single Undo press (toast or
 *      Cmd/Ctrl+Z) restores the whole selection in one gesture
 *      instead of N per-id `DELETE` entries the previous fan-out
 *      loop would have produced.
 *   3. Clicking Undo on the toast invokes `takeoffHistory.undo()` —
 *      i.e. it replays the same MEASUREMENT_DELETE_BATCH entry the
 *      onSuccess push placed at the top of the undo stack.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

const apiRequestMock = vi.fn();
const toastMock = vi.fn();

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
    pushMarkupDeleteBatchAction: vi.fn(),
    pushMarkupUpdateAction: vi.fn(),
    pushMarkupUpdateBatchAction: vi.fn(),
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

const makeMeasurement = (id: string) =>
  ({
    id,
    sheetId: "sheet-1",
    type: "LINEAR",
    points: JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    label: `m-${id}`,
  }) as any;

const seedMeasurementsCache = (ids: string[]) =>
  mockedQueryClient.setQueryData(MEASUREMENTS_KEY, ids.map(makeMeasurement));

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMock.mockReset();
  // Mirror the real `toast()` return shape so the hook can call
  // `.dismiss` on the handle without crashing.
  toastMock.mockImplementation(() => ({ id: "t-1", dismiss: vi.fn(), update: vi.fn() }));
  mockedQueryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("bulkDeleteMeasurementsMutation Undo toast (Task #1901)", () => {
  it("shows a destructive toast with a count + Undo action that auto-dismisses", async () => {
    seedMeasurementsCache(["m-1", "m-2", "m-3"]);
    apiRequestMock.mockResolvedValue({ json: async () => ({}) });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    const toDelete = ["m-1", "m-2", "m-3"].map(makeMeasurement);

    await act(async () => {
      await result.current.bulkDeleteMeasurementsMutation.mutateAsync(toDelete);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Deleted 3 measurements",
          duration: expect.any(Number),
          action: expect.anything(),
        }),
      );
    });

    // Per-id DELETEs were issued (no /bulk endpoint exists yet).
    expect(apiRequestMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/takeoff/measurements/m-1",
    );
    expect(apiRequestMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/takeoff/measurements/m-2",
    );
    expect(apiRequestMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/takeoff/measurements/m-3",
    );

    // The history batch entry is what the Undo click will replay via
    // takeoffHistory.undo() — must be pushed before / alongside the
    // toast.
    expect(history.pushMeasurementDeleteBatchAction).toHaveBeenCalledTimes(1);
    expect(history.pushMeasurementDeleteBatchAction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "m-1" })]),
      "sheet-1",
    );
  });

  it("uses singular wording when exactly one measurement is deleted", async () => {
    seedMeasurementsCache(["m-1"]);
    apiRequestMock.mockResolvedValue({ json: async () => ({}) });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.bulkDeleteMeasurementsMutation.mutateAsync([
        makeMeasurement("m-1"),
      ]);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Deleted 1 measurement",
        }),
      );
    });
  });

  it("Undo button on the toast invokes takeoffHistory.undo() (the same MEASUREMENT_DELETE_BATCH undo path)", async () => {
    seedMeasurementsCache(["m-1", "m-2"]);
    apiRequestMock.mockResolvedValue({ json: async () => ({}) });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.bulkDeleteMeasurementsMutation.mutateAsync([
        makeMeasurement("m-1"),
        makeMeasurement("m-2"),
      ]);
    });

    let actionEl: React.ReactElement | undefined;
    await waitFor(() => {
      const call = toastMock.mock.calls.find(
        ([arg]) =>
          arg?.variant === "destructive" &&
          arg?.title === "Deleted 2 measurements",
      );
      expect(call).toBeTruthy();
      actionEl = call![0].action as React.ReactElement;
      expect(actionEl).toBeTruthy();
    });

    // Render the action element in isolation (the radix ToastProvider
    // wrapper is unnecessary for click-handler verification) and click
    // the Undo button.
    const { getByTestId } = render(actionEl as React.ReactElement);
    fireEvent.click(getByTestId("button-toast-undo-bulk-delete-measurements"));

    expect(history.undo).toHaveBeenCalledTimes(1);
  });

  it("optimistically removes the rows from cache and rolls back on failure", async () => {
    seedMeasurementsCache(["m-1", "m-2", "m-3"]);
    apiRequestMock.mockRejectedValue(new Error("boom"));

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    const toDelete = ["m-1", "m-2"].map(makeMeasurement);

    await act(async () => {
      await result.current.bulkDeleteMeasurementsMutation
        .mutateAsync(toDelete)
        .catch(() => undefined);
    });

    // Cache restored to the pre-mutation snapshot (all 3 ids).
    const restored = mockedQueryClient.getQueryData<any[]>(MEASUREMENTS_KEY);
    expect(restored?.map((m) => m.id).sort()).toEqual(["m-1", "m-2", "m-3"]);

    // Error toast surfaced; no batch history entry pushed.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Error", variant: "destructive" }),
    );
    expect(history.pushMeasurementDeleteBatchAction).not.toHaveBeenCalled();
  });
});
