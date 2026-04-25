// @vitest-environment jsdom
/**
 * Task #1882 — Visible Undo toast after bulk-deleting markups.
 *
 * Task #1860 wired the backend `restore-bulk` endpoint and a single
 * MARKUP_DELETE_BATCH history entry so Cmd/Ctrl+Z reverses a whole
 * bulk deletion in one round-trip. Power users get the keyboard
 * shortcut for free, but non-power users had no in-canvas affordance
 * to recover from an accidental bulk delete.
 *
 * The contract this file locks down:
 *   1. After `bulkDeleteMarkupsMutation` resolves, exactly one
 *      destructive-style toast is shown with a "Deleted N markups"
 *      title (singular for N=1) and an Undo action element.
 *   2. The toast carries a `duration` so it auto-dismisses on its own
 *      (the shared toast hook never auto-dismisses without `duration`
 *      because TOAST_REMOVE_DELAY is 1000000ms).
 *   3. Clicking Undo invokes the same `pushMarkupDeleteBatchAction`
 *      undo path — i.e. `takeoffHistory.undo()`, which the
 *      onSuccess push placed at the top of the undo stack.
 *
 * Existing coverage that this file deliberately does NOT duplicate:
 *   - `use-takeoff-data-bulk-markup-rollback.test.tsx` covers the
 *     bulk *update* (PATCH /bulk) atomic-rollback contract for #1769.
 *     It does not exercise the bulk DELETE path.
 *   - `use-takeoff-history.test.tsx` (the history hook) already
 *     covers MARKUP_DELETE_BATCH undo POSTing to /restore-bulk.
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
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
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

const seedMarkupsCache = (ids: string[]) =>
  mockedQueryClient.setQueryData(
    MARKUPS_KEY,
    ids.map((id) => ({
      id,
      sheetId: "sheet-1",
      tool: "ARROW",
      points: [{ x: 0.1, y: 0.1 }],
      color: "#ef4444",
      thickness: 2,
    })),
  );

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

describe("bulkDeleteMarkupsMutation Undo toast (Task #1882)", () => {
  it("shows a destructive toast with a count + Undo action that auto-dismisses", async () => {
    seedMarkupsCache(["m-1", "m-2", "m-3"]);
    apiRequestMock.mockResolvedValue({
      json: async () => ({ ok: true, count: 3, deletedIds: ["m-1", "m-2", "m-3"] }),
    });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.bulkDeleteMarkupsMutation.mutateAsync(["m-1", "m-2", "m-3"]);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Deleted 3 markups",
          duration: expect.any(Number),
          action: expect.anything(),
        }),
      );
    });

    // The history batch entry is what the Undo click will replay via
    // takeoffHistory.undo() — must be pushed before / alongside the toast.
    expect(history.pushMarkupDeleteBatchAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupDeleteBatchAction).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "m-1" })]),
      "sheet-1",
    );
  });

  it("uses singular wording when exactly one markup is deleted", async () => {
    seedMarkupsCache(["m-1"]);
    apiRequestMock.mockResolvedValue({
      json: async () => ({ ok: true, count: 1, deletedIds: ["m-1"] }),
    });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.bulkDeleteMarkupsMutation.mutateAsync(["m-1"]);
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Deleted 1 markup",
        }),
      );
    });
  });

  it("Undo button on the toast invokes takeoffHistory.undo() (the same MARKUP_DELETE_BATCH undo path)", async () => {
    seedMarkupsCache(["m-1", "m-2"]);
    apiRequestMock.mockResolvedValue({
      json: async () => ({ ok: true, count: 2, deletedIds: ["m-1", "m-2"] }),
    });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await result.current.bulkDeleteMarkupsMutation.mutateAsync(["m-1", "m-2"]);
    });

    let actionEl: React.ReactElement | undefined;
    await waitFor(() => {
      const call = toastMock.mock.calls.find(
        ([arg]) => arg?.variant === "destructive" && arg?.title === "Deleted 2 markups",
      );
      expect(call).toBeTruthy();
      actionEl = call![0].action as React.ReactElement;
      expect(actionEl).toBeTruthy();
    });

    // Render the action element in isolation (the radix ToastProvider
    // wrapper is unnecessary for click-handler verification) and click
    // the Undo button.
    const { getByTestId } = render(actionEl as React.ReactElement);
    fireEvent.click(getByTestId("button-toast-undo-bulk-delete-markups"));

    expect(history.undo).toHaveBeenCalledTimes(1);
  });
});
