// @vitest-environment jsdom
/**
 * Task #1769 — Atomic-rollback coverage for batched markup body-drag
 * commits.
 *
 * The current Konva multi-select drag commits through a single bulk PATCH
 * (`useTakeoffData.bulkUpdateMarkupsMutation` → `PATCH /api/takeoff/markups/bulk`)
 * orchestrated by `commitMarkupBodyDrag` in
 * `client/src/components/markups/markup-drag-commit.ts`. The atomic
 * contract that future refactors must not silently regress is:
 *
 *   1. All-success: optimistic cache write lands in `onMutate`, the PATCH
 *      resolves, the cache invalidation refetches the list, and exactly
 *      one `MARKUP_UPDATE_BATCH` history entry is pushed AFTER the PATCH
 *      resolves (#1759 — never up front).
 *
 *   2. All-failure: the PATCH rejects, `onError` rolls every member's
 *      points back to the pre-drag snapshot in one shot, surfaces ONE
 *      destructive toast for the whole gesture (not N — that was the
 *      pre-#1752 fan-out's UX), and the helper SKIPS the history push
 *      entirely so no phantom Undo entry survives the failure (#1759).
 *
 * Note (deviation from task #1769 plan): The plan referenced a parallel-
 * PATCH path with a `updateMarkupMutation.batched` flag that would
 * suppress per-mutation rollback / toasts. That path no longer exists in
 * the codebase — Task #1752 collapsed the N-parallel-PATCH fan-out into
 * one bulk PATCH (atomic by construction on the server), so there is no
 * "partial-failure" branch to test and no `batched` flag to assert on.
 * This file therefore exercises the actual bulk-mutation atomic contract.
 *
 * Existing coverage that this file deliberately does NOT duplicate:
 *   - `markup-drag-commit.test.ts` already drives `commitMarkupBodyDrag`
 *     against pure-function spies (no React Query) and proves the
 *     deferred-history-push contract for #1759.
 *   - `use-takeoff-data-update-markup-optimistic.test.tsx` covers the
 *     SINGLE-markup `updateMarkupMutation` cache rollback.
 *
 * What's new here is end-to-end orchestration: `commitMarkupBodyDrag`
 * driven against the real `bulkUpdateMarkupsMutation` with a mocked
 * `apiRequest` and a real React Query `queryClient`, asserting the cache
 * + toast + history side-effects together so a regression in any one of
 * them fails loudly.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import { commitMarkupBodyDrag } from "@/components/markups/markup-drag-commit";

const apiRequestMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  // The mutation reaches for `queryClient` directly (not through the
  // <QueryClientProvider> the wrapper supplies) when it cancels in-flight
  // queries, writes the optimistic cache update, invalidates on success,
  // and rolls back on error. Exposing this same instance below lets the
  // test seed the cache and assert the rollback / invalidate side-effects
  // against the very client the hook is using.
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
const M1_ORIG = [{ x: 0.1, y: 0.1 }];
const M2_ORIG = [{ x: 0.5, y: 0.5 }];
const M3_ORIG = [{ x: 0.7, y: 0.7 }];

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

const seedMarkupsCache = () =>
  mockedQueryClient.setQueryData(MARKUPS_KEY, [
    { id: "m-1", sheetId: "sheet-1", tool: "ARROW", points: M1_ORIG, color: "#ef4444", thickness: 2 },
    { id: "m-2", sheetId: "sheet-1", tool: "ARROW", points: M2_ORIG, color: "#3b82f6", thickness: 2 },
    { id: "m-3", sheetId: "sheet-1", tool: "ARROW", points: M3_ORIG, color: "#22c55e", thickness: 2 },
  ]);

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

describe("bulkUpdateMarkupsMutation atomic-rollback (Task #1769)", () => {
  it("all-success: one bulk PATCH, optimistic cache holds, history pushed AFTER resolve, no error toast", async () => {
    seedMarkupsCache();
    apiRequestMock.mockResolvedValue({ json: async () => ({ ok: true }) });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    // Drive the same orchestration the Konva onBodyDragEnd handler runs
    // (extracted into commitMarkupBodyDrag in #1757). Three-member
    // multi-select translates each member by (dx, dy).
    await act(async () => {
      await commitMarkupBodyDrag({
        markup: { id: "m-1" },
        rawPts: M1_ORIG,
        dx: 0.05,
        dy: 0.05,
        siblingIds: ["m-2", "m-3"],
        markups: [
          { id: "m-1", points: M1_ORIG },
          { id: "m-2", points: M2_ORIG },
          { id: "m-3", points: M3_ORIG },
        ],
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.bulkUpdateMarkupsMutation,
        takeoffHistory: history,
      });
    });

    // Exactly one bulk PATCH for the whole gesture — the legacy
    // N-parallel-PATCH fan-out (one request per markup) would fail this.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/bulk",
      {
        updates: [
          { id: "m-1", points: [{ x: 0.15000000000000002, y: 0.15000000000000002 }] },
          { id: "m-2", points: [{ x: 0.55, y: 0.55 }] },
          { id: "m-3", points: [{ x: 0.75, y: 0.75 }] },
        ],
      },
    );

    // The optimistic write in `onMutate` translated every dragged member's
    // points; the success-path invalidate() refetches via the mocked
    // queryFn (returns null) but does NOT itself rewrite the cache, so
    // the final cached state still reflects the post-drag points.
    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-1")?.points).toEqual([
        { x: 0.15000000000000002, y: 0.15000000000000002 },
      ]);
      expect(cached.find((m) => m.id === "m-2")?.points).toEqual([
        { x: 0.55, y: 0.55 },
      ]);
      expect(cached.find((m) => m.id === "m-3")?.points).toEqual([
        { x: 0.75, y: 0.75 },
      ]);
    });

    // Task #1759 — exactly one MARKUP_UPDATE_BATCH entry, pushed after
    // the bulk PATCH resolves (commitMarkupBodyDrag awaits mutateAsync
    // before calling pushMarkupUpdateBatchAction). The before/after
    // snapshots carry every member's pre- and post-drag points so a
    // single Undo press reverses the whole gesture.
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledTimes(1);
    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledWith(
      [
        { id: "m-1", points: M1_ORIG },
        { id: "m-2", points: M2_ORIG },
        { id: "m-3", points: M3_ORIG },
      ],
      [
        { id: "m-1", points: [{ x: 0.15000000000000002, y: 0.15000000000000002 }] },
        { id: "m-2", points: [{ x: 0.55, y: 0.55 }] },
        { id: "m-3", points: [{ x: 0.75, y: 0.75 }] },
      ],
      "sheet-1",
    );

    // Success path must not surface a destructive toast.
    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("all-failure: cache rolls back to pre-drag snapshot, ONE error toast, NO history push (#1759 phantom-Undo guard)", async () => {
    seedMarkupsCache();
    // Reject the bulk PATCH for the whole gesture. Atomic on the server:
    // either every update lands or none do — there is no partial state to
    // unwind sibling-by-sibling.
    apiRequestMock.mockRejectedValue(new Error("network down"));

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await commitMarkupBodyDrag({
        markup: { id: "m-1" },
        rawPts: M1_ORIG,
        dx: 0.2,
        dy: 0.2,
        siblingIds: ["m-2", "m-3"],
        markups: [
          { id: "m-1", points: M1_ORIG },
          { id: "m-2", points: M2_ORIG },
          { id: "m-3", points: M3_ORIG },
        ],
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.bulkUpdateMarkupsMutation,
        takeoffHistory: history,
      });
    });

    // `onError` snapshots the pre-mutation cache via the `previousMarkups`
    // ctx and writes it back wholesale — every dragged member returns to
    // its pre-drag points in one cache write, not three.
    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-1")?.points).toEqual(M1_ORIG);
      expect(cached.find((m) => m.id === "m-2")?.points).toEqual(M2_ORIG);
      expect(cached.find((m) => m.id === "m-3")?.points).toEqual(M3_ORIG);
    });

    // Exactly one user-visible toast for the whole failed gesture. The
    // pre-#1752 fan-out (one updateMarkupMutation per markup) would have
    // surfaced N toasts here — that UX regression must stay dead.
    const destructiveToasts = toastMock.mock.calls.filter(
      ([arg]) => arg?.variant === "destructive",
    );
    expect(destructiveToasts).toHaveLength(1);
    expect(destructiveToasts[0][0]).toEqual(
      expect.objectContaining({
        title: "Error",
        description: "Failed to update markups",
        variant: "destructive",
      }),
    );

    // Task #1759 — the helper MUST NOT push a MARKUP_UPDATE_BATCH entry
    // when the bulk PATCH rejects. Pushing one would leave a phantom Undo
    // entry on the stack claiming a move that never reached the server,
    // and a Redo press would silently re-fire the failed payload.
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
  });

  it("optimistic cache write lands BEFORE the bulk PATCH resolves (drag does not snap back mid-flight)", async () => {
    seedMarkupsCache();
    // Hold the network call open so any cache change observed before
    // resolveApi() must come from `onMutate` — not from a success-path
    // refetch. This locks in the synchronous-before-network contract that
    // keeps a 50-member drag from flickering back to its origin while the
    // PATCH is in flight.
    let resolveApi: (value: unknown) => void = () => {};
    apiRequestMock.mockImplementation(
      () => new Promise((resolve) => { resolveApi = resolve; }),
    );

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    let commitPromise!: Promise<void>;
    act(() => {
      commitPromise = commitMarkupBodyDrag({
        markup: { id: "m-1" },
        rawPts: M1_ORIG,
        dx: 0.05,
        dy: 0.05,
        siblingIds: ["m-2"],
        markups: [
          { id: "m-1", points: M1_ORIG },
          { id: "m-2", points: M2_ORIG },
        ],
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.bulkUpdateMarkupsMutation,
        takeoffHistory: history,
      });
    });

    // PATCH still in flight. Cache should already reflect the dragged
    // points for both members (onMutate wrote them via setQueryData).
    await waitFor(() => {
      const cached = readCachedMarkups();
      expect(cached.find((m) => m.id === "m-1")?.points).toEqual([
        { x: 0.15000000000000002, y: 0.15000000000000002 },
      ]);
      expect(cached.find((m) => m.id === "m-2")?.points).toEqual([
        { x: 0.55, y: 0.55 },
      ]);
    });
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    // History push is deferred until the PATCH resolves (#1759).
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();

    // Drain the mutation so the test doesn't leak a pending fetch.
    await act(async () => {
      resolveApi({ json: async () => ({ ok: true }) });
      await commitPromise;
    });

    expect(history.pushMarkupUpdateBatchAction).toHaveBeenCalledTimes(1);
  });

  it("zero-delta drag short-circuits before any PATCH or cache write", async () => {
    seedMarkupsCache();
    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await commitMarkupBodyDrag({
        markup: { id: "m-1" },
        rawPts: M1_ORIG,
        dx: 0,
        dy: 0,
        siblingIds: ["m-2"],
        markups: [
          { id: "m-1", points: M1_ORIG },
          { id: "m-2", points: M2_ORIG },
        ],
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.bulkUpdateMarkupsMutation,
        takeoffHistory: history,
      });
    });

    // No PATCH, no toast, no cache mutation, no history entry — a
    // click-without-drag must not show up on the Undo stack.
    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
    const cached = readCachedMarkups();
    expect(cached.find((m) => m.id === "m-1")?.points).toEqual(M1_ORIG);
    expect(cached.find((m) => m.id === "m-2")?.points).toEqual(M2_ORIG);
  });

  it("single-markup drag (no siblings) goes through updateMarkupMutation, NOT bulk", async () => {
    seedMarkupsCache();
    apiRequestMock.mockResolvedValue({ json: async () => ({ id: "m-1" }) });

    const history = makeMockTakeoffHistory();
    const { result } = renderTakeoffData(history);

    await act(async () => {
      await commitMarkupBodyDrag({
        markup: { id: "m-1" },
        rawPts: M1_ORIG,
        dx: 0.1,
        dy: 0.1,
        siblingIds: [],
        markups: [{ id: "m-1", points: M1_ORIG }],
        selectedSheet: "sheet-1",
        updateMarkupMutation: result.current.updateMarkupMutation,
        bulkUpdateMarkupsMutation: result.current.bulkUpdateMarkupsMutation,
        takeoffHistory: history,
      });
    });

    // Single-markup drags route through the per-id PATCH endpoint and
    // record a MARKUP_UPDATE entry via `updateMarkupMutation.onSuccess`
    // (asserted in the per-mutation test files), NOT a batch entry.
    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/m-1",
      { points: [{ x: 0.2, y: 0.2 }] },
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      "PATCH",
      "/api/takeoff/markups/bulk",
      expect.anything(),
    );
    expect(history.pushMarkupUpdateBatchAction).not.toHaveBeenCalled();
  });
});
