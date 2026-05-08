// @vitest-environment jsdom
/**
 * Task #1748 — Locks down the optimistic-cache contract added in
 * Task #1735 to `useTakeoffData.updateMarkupMutation`. The Konva body
 * drag in `TakeoffWorkspace.onBodyDragEnd` resets the dragged group's
 * pixel position to the origin and relies on the markups query cache
 * already holding the translated points; if `onMutate` ever stops
 * rewriting the cache, the markup snaps back to its pre-drag location
 * for the few hundred ms between drag-end and the success-path
 * invalidation refetch — a flicker that does not show up in code
 * review and only appears at runtime.
 *
 * These two cases assert:
 *   1. `onMutate` flips the cached points BEFORE `apiRequest` resolves
 *      (so the dragged markup stays put across the drag-end → PATCH
 *      boundary), and
 *   2. `onError` rolls the cache back to the pre-drag points AND
 *      surfaces the destructive toast (so a failed PATCH does not
 *      strand the markup at the failed optimistic position).
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
  // The hook reaches for `queryClient` directly (not through the
  // <QueryClientProvider> the wrapper supplies) when it cancels in-
  // flight queries, writes the optimistic cache update, and rolls back
  // on error — so the test exposes this same instance below to seed and
  // assert the cached markup state.
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
const ORIGINAL_POINTS = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.2 },
];
const DRAGGED_POINTS = [
  { x: 0.35, y: 0.42 },
  { x: 0.45, y: 0.52 },
];

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

const seedMarkupsCache = (markups: any[]) => {
  mockedQueryClient.setQueryData(MARKUPS_KEY, markups);
};

const readCachedMarkups = () =>
  mockedQueryClient.getQueryData<any[]>(MARKUPS_KEY) ?? [];

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMock.mockReset();
  mockedQueryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("updateMarkupMutation — optimistic cache update for body drags", () => {
  it("rewrites the cached markup points in onMutate before the PATCH resolves", async () => {
    // Seed the markups cache with the pre-drag points plus an
    // unrelated sibling markup so we can also confirm the optimistic
    // write only touches the dragged id.
    seedMarkupsCache([
      {
        id: "m-1",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: ORIGINAL_POINTS,
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

    // Hold the network call open for the duration of the test so that
    // any change to the cached points must come from `onMutate` — not
    // from the success-path invalidation refetch. This is what locks
    // in the "synchronous before network call resolves" contract.
    let resolveApi: (value: unknown) => void = () => {};
    apiRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApi = resolve;
        }),
    );

    const { result } = renderTakeoffData(makeMockTakeoffHistory());

    act(() => {
      result.current.updateMarkupMutation.mutate({
        id: "m-1",
        points: DRAGGED_POINTS,
        previous: { points: ORIGINAL_POINTS },
      });
    });

    // `onMutate` awaits `cancelQueries`, so the optimistic write lands
    // one microtask after `mutate` returns — wait for it explicitly
    // rather than asserting synchronously.
    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-1")?.points).toEqual(DRAGGED_POINTS);
    });

    // The PATCH is still in-flight. Anything the test sees in the
    // cache right now is purely the optimistic write — the success
    // path's invalidation has not run yet.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m-1",
      { points: DRAGGED_POINTS },
    );

    // The unrelated sibling markup is untouched.
    const cached = readCachedMarkups();
    expect(cached.find((m) => m.id === "m-2")?.points).toEqual([
      { x: 0.7, y: 0.7 },
    ]);

    // Drain the mutation so it doesn't leak across tests.
    await act(async () => {
      resolveApi({ json: async () => ({ id: "m-1" }) });
    });
  });

  it("rolls the cache back to the pre-drag points and surfaces an error toast on PATCH failure", async () => {
    seedMarkupsCache([
      {
        id: "m-1",
        sheetId: "sheet-1",
        tool: "ARROW",
        points: ORIGINAL_POINTS,
        color: "#ef4444",
        thickness: 2,
      },
    ]);

    apiRequestMock.mockRejectedValue(new Error("network down"));

    const { result } = renderTakeoffData(makeMockTakeoffHistory());

    await act(async () => {
      try {
        await result.current.updateMarkupMutation.mutateAsync({
          id: "m-1",
          points: DRAGGED_POINTS,
          previous: { points: ORIGINAL_POINTS },
        });
      } catch {
        // mutationFn intentionally rejects — onError handles cleanup.
      }
    });

    // `onError` writes the captured `previousMarkups` snapshot back
    // into the cache so the markup returns to its real location
    // instead of being stranded at the failed optimistic position.
    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached).toHaveLength(1);
      expect(cached[0].points).toEqual(ORIGINAL_POINTS);
    });

    // Task #1768 — The toast now names the failed markup and the
    // reason instead of the legacy generic "Failed to update markup".
    // The seeded markup has no text, so `describeMarkup` falls back to
    // `Arrow <id-prefix>`; the rejection has no structured `reason`
    // (`Error("network down")`), so the helper takes the unknown
    // branch and surfaces the raw network error followed by the
    // affected-markup name.
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Markup could not be moved",
        variant: "destructive",
      }),
    );
    const description = toastMock.mock.calls.at(-1)?.[0]?.description as string;
    expect(description).toContain("network down");
    expect(description).toContain("Arrow m-1");
    expect(description).toContain("rolled back");
  });
});
