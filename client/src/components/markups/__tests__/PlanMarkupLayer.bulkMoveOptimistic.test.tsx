// @vitest-environment jsdom
/**
 * Task #1767 — Plan-side mirror of the takeoff regression test added in
 * Task #1748 (`use-takeoff-data-update-markup-optimistic.test.tsx`).
 *
 * The Konva group drag in `<PlanMarkupLayer />` resets every dragged
 * Konva node back to its origin on `dragend` (Task #1706 — see
 * PlanMarkupLayer.tsx around line 1388: `e.target.position({ x: drag.
 * origX, y: drag.origY })`) and relies on `bulkMoveMutation.onMutate`
 * having ALREADY rewritten the markups query cache to the post-drag
 * normalized points. If `onMutate` ever stops writing the optimistic
 * cache update, the dragged shapes snap back to their pre-drag
 * positions for the few hundred ms between drag-end and the
 * success-path invalidation refetch — a flicker that does not show up
 * in code review and only appears at runtime.
 *
 * The existing `PlanMarkupLayer.bulkMove.test.tsx` only covers the
 * pure helper math (`buildBulkMoveUpdates`, `buildMoveSnapshot`, the
 * history ring buffer). The render-lockdown spec in
 * `PlanMarkupLayer.groupDragRender.test.tsx` waits for the bulk PATCH
 * to settle so it can't tell whether the cache was updated by
 * `onMutate` (the contract under test here) or by the success-path
 * invalidation refetch (which would be too late to prevent the
 * snap-back). This file pins down the two halves of the optimistic
 * contract that are otherwise unguarded:
 *
 *   1. `onMutate` flips the cached points BEFORE the bulk PATCH
 *      resolves — so the dragged markups stay put across the
 *      drag-end → PATCH boundary; non-selected sibling markups in
 *      the same cache are left alone.
 *
 *   2. `onError` rolls the cache back to the pre-drag points AND
 *      surfaces the destructive "Could not move markups" toast — so
 *      a failed bulk PATCH does not strand the markups at the failed
 *      optimistic position with no user-visible feedback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  // PlanMarkupLayer reaches for `queryClient` directly (not through
  // the <QueryClientProvider> the wrapper supplies) when it cancels
  // in-flight queries, writes the optimistic cache update, and rolls
  // back on error — so the test exposes this same instance below to
  // seed and assert the cached markup state.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Keep the seeded markups stable so useQuery never schedules a
        // real fetch mid-test (which would clobber the optimistic
        // cache write we are trying to assert).
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import PlanMarkupLayer from "../PlanMarkupLayer";
import {
  apiRequest,
  queryClient as mockedQueryClient,
} from "@/lib/queryClient";
import Konva from "konva";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const DOC_ID = "doc-1";
const PAGE = 1;
const CANVAS = 400;
const QUERY_KEY = [
  "/api/plan-documents",
  DOC_ID,
  "markups",
  PAGE,
] as const;

// Three seeded markups: m-a and m-b will be multi-selected and
// dragged together; m-c is the unrelated sibling we use to confirm
// the optimistic write only touches the moved ids.
const SEEDED_MARKUPS = [
  {
    id: "m-a",
    tool: "ARROW",
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
    color: "#ef4444",
    thickness: 2,
  },
  {
    id: "m-b",
    tool: "RECTANGLE",
    points: [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.5 },
    ],
    color: "#22c55e",
    thickness: 2,
  },
  {
    id: "m-c",
    tool: "ARROW",
    points: [
      { x: 0.7, y: 0.7 },
      { x: 0.8, y: 0.8 },
    ],
    color: "#3b82f6",
    thickness: 2,
  },
] as const;

// 40 px right, 20 px down at canvas=400 → +0.10 / +0.05 normalized.
// The dragged points the optimistic write should land in the cache.
const DRAG_DX_PX = 40;
const DRAG_DY_PX = 20;
const NDX = DRAG_DX_PX / CANVAS;
const NDY = DRAG_DY_PX / CANVAS;

const seedMarkupsCache = () => {
  // Deep-clone the seeded fixture so a test mutating cached points
  // (or comparing references) does not leak across cases.
  mockedQueryClient.setQueryData(
    QUERY_KEY,
    SEEDED_MARKUPS.map((m) => ({
      ...m,
      points: m.points.map((p) => ({ ...p })),
    })),
  );
};

const readCachedMarkups = () =>
  mockedQueryClient.getQueryData<typeof SEEDED_MARKUPS>(QUERY_KEY) ?? [];

beforeEach(() => {
  apiRequestMock.mockReset();
  toastMock.mockReset();
  mockedQueryClient.clear();
  // Stub fetch as a belt-and-suspenders against any stray useQuery
  // refetch returning undefined and clobbering the seeded cache.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => SEEDED_MARKUPS,
        }) as Response,
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  mockedQueryClient.clear();
});

function renderLayer() {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={mockedQueryClient}>
      {children}
    </QueryClientProvider>
  );
  return render(
    <PlanMarkupLayer
      documentId={DOC_ID}
      pageNumber={PAGE}
      canvasWidth={CANVAS}
      canvasHeight={CANVAS}
      activeTool="SELECT"
      color="#ef4444"
      thickness={2}
    />,
    { wrapper: Wrapper },
  );
}

function getStage(): Konva.Stage {
  // react-konva pushes each mounted Stage onto Konva.stages; the
  // most recently mounted one is the layer under test.
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  expect(stages.length).toBeGreaterThan(0);
  return stages[stages.length - 1];
}

function clickShape(stage: Konva.Stage, idx: number, shift: boolean) {
  // Drives MarkupShapeView -> handleSelectShape with the shift
  // modifier carried on the synthetic Konva event's `evt` field —
  // mirrors the gesture that produces a multi-markup selection.
  const layer = stage.getLayers()[0];
  const groups = layer.getChildren();
  expect(groups.length).toBeGreaterThanOrEqual(idx + 1);
  const group = groups[idx];
  act(() => {
    group.fire(
      "click",
      {
        cancelBubble: false,
        evt: { shiftKey: shift } as MouseEvent,
      } as never,
      true,
    );
  });
}

/**
 * Drives a multi-select on the rendered Konva stage and returns the
 * dragged node. Mirrors the gesture pattern in
 * `PlanMarkupLayer.groupDragRender.test.tsx` so both tests
 * exercise the same code path that produces a `markup-drag-member-*`
 * Konva name on every selected markup.
 */
function selectTwoMarkups(stage: Konva.Stage): Konva.Node {
  // Multi-select m-a and m-b (leaving m-c untouched so we can
  // confirm the optimistic write only rewrites the dragged ids).
  clickShape(stage, 0, false);
  clickShape(stage, 1, true);

  const layer = stage.getLayers()[0];
  const dragged = layer.findOne(`.markup-drag-member-m-a`) as Konva.Node;
  const sibling = layer.findOne(`.markup-drag-member-m-b`) as Konva.Node;
  expect(dragged).toBeTruthy();
  expect(sibling).toBeTruthy();
  return dragged;
}

/**
 * Drives the dragstart -> dragmove -> dragend sequence used by both
 * tests. Issuing dragend is what triggers `bulkMoveMutation.mutate`,
 * so the cache assertions in the caller fire after this returns.
 */
function performDrag(dragged: Konva.Node) {
  act(() => {
    dragged.fire("dragstart", { target: dragged } as never, true);
  });
  // Position the dragged node so the dragend handler can compute a
  // non-zero pixel delta.
  dragged.position({ x: DRAG_DX_PX, y: DRAG_DY_PX });
  act(() => {
    dragged.fire("dragmove", { target: dragged } as never, true);
  });
  act(() => {
    dragged.fire("dragend", { target: dragged } as never, true);
  });
}

describe("bulkMoveMutation — optimistic cache update for plan group drags", () => {
  it("rewrites the cached markup points in onMutate before the bulk PATCH resolves", async () => {
    seedMarkupsCache();

    // Hold the network call open for the duration of the test so any
    // change to the cached points must come from `onMutate` — not
    // from the success-path invalidation refetch. This is what locks
    // in the "synchronous before network call resolves" contract.
    let resolveApi: (value: unknown) => void = () => {};
    apiRequestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApi = resolve;
        }),
    );

    renderLayer();
    const stage = getStage();

    const dragged = selectTwoMarkups(stage);
    performDrag(dragged);

    // `onMutate` awaits `cancelQueries`, so the optimistic write
    // lands one microtask after `mutate` returns — wait for it
    // explicitly rather than asserting synchronously.
    await waitFor(() => {
      const cached = readCachedMarkups();
      const a = cached.find((m) => m.id === "m-a");
      const b = cached.find((m) => m.id === "m-b");
      expect(a?.points[0].x).toBeCloseTo(0.1 + NDX, 10);
      expect(a?.points[0].y).toBeCloseTo(0.1 + NDY, 10);
      expect(a?.points[1].x).toBeCloseTo(0.2 + NDX, 10);
      expect(a?.points[1].y).toBeCloseTo(0.2 + NDY, 10);
      expect(b?.points[0].x).toBeCloseTo(0.3 + NDX, 10);
      expect(b?.points[0].y).toBeCloseTo(0.3 + NDY, 10);
      expect(b?.points[1].x).toBeCloseTo(0.5 + NDX, 10);
      expect(b?.points[1].y).toBeCloseTo(0.5 + NDY, 10);
    });

    // Locate the bulk PATCH call. Other mutations (e.g. group/
    // ungroup pushes from history scaffolding) should not have fired
    // — but we filter so an unrelated stray request would not falsely
    // pass this case.
    const patches = apiRequestMock.mock.calls.filter(
      (c) =>
        c[0] === "PATCH" &&
        /\/api\/plan-documents\/.*\/markups\/bulk$/.test(String(c[1])),
    );
    expect(patches).toHaveLength(1);

    // The bulk PATCH is still in-flight (we never resolved
    // `resolveApi`). Anything we see in the cache right now is purely
    // the optimistic write from `onMutate` — the success-path
    // `invalidate()` has not run yet.
    const cached = readCachedMarkups();
    // The unrelated sibling markup is untouched.
    const c = cached.find((m) => m.id === "m-c");
    expect(c?.points).toEqual([
      { x: 0.7, y: 0.7 },
      { x: 0.8, y: 0.8 },
    ]);

    // Drain the in-flight mutation so it doesn't leak across tests.
    await act(async () => {
      resolveApi({ json: async () => ({ ok: true }) });
    });
  });

  it("rolls the cache back to the pre-drag points and surfaces a destructive toast on PATCH failure", async () => {
    seedMarkupsCache();

    apiRequestMock.mockRejectedValue(new Error("network down"));

    renderLayer();
    const stage = getStage();

    const dragged = selectTwoMarkups(stage);
    performDrag(dragged);

    // `onError` writes the captured `previous` snapshot back into the
    // cache so the markups return to their real positions instead of
    // being stranded at the failed optimistic coordinates.
    await waitFor(() => {
      const cached = readCachedMarkups();
      const a = cached.find((m) => m.id === "m-a");
      const b = cached.find((m) => m.id === "m-b");
      expect(a?.points).toEqual([
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ]);
      expect(b?.points).toEqual([
        { x: 0.3, y: 0.3 },
        { x: 0.5, y: 0.5 },
      ]);
    });

    // The destructive toast is what tells the user the drag did not
    // persist — without it the rollback would be silent.
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Could not move markups",
          description: "network down",
          variant: "destructive",
        }),
      );
    });
  });
});
