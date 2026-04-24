// @vitest-environment jsdom
/**
 * Task #1719 — Lock down the "no React re-render fires between drag-start
 * and drag-end" performance contract introduced in Task #1706.
 *
 * Task #1706 moved live group-drag translation off React state and onto
 * direct Konva node updates: dragging any member of a multi-markup
 * selection imperatively translates every sibling node via
 * `node.position()` and only commits the new normalized points back to
 * React state once, on drag-end. Prior to that, calling `setState`
 * inside `onDragMove` re-rendered the entire layer on every pointer
 * frame and dropped frames at 50+ markups.
 *
 * The performance contract had so far only been enforced by code review.
 * This spec catches any future regression that re-introduces a React
 * commit between drag-start and drag-end (the kind of subtle change
 * that doesn't break correctness but silently brings the frame drop
 * back).
 *
 * Coverage:
 *   1. A multi-markup selection is established by clicking the rendered
 *      Konva groups (with `shiftKey` set on the dispatched event — the
 *      modifier `MarkupShapeView` now forwards through `onSelect` per
 *      Task #1729, replacing the legacy `window.event` lookup).
 *   2. A `<Profiler>` wrapping `<PlanMarkupLayer />` records every
 *      React commit; the count is captured AFTER selection settles and
 *      must NOT change while we fire `dragstart` followed by N
 *      `dragmove` events.
 *   3. Sibling Konva nodes have `position()` called imperatively with
 *      the same delta as the dragged node on every frame, and are
 *      reset to {x:0,y:0} on `dragend`.
 *   4. `bulkMoveMutation` (the Task #1676 atomic PATCH) fires exactly
 *      once on drag-end, with each member's pre-move points translated
 *      by the final normalized delta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import {
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // staleTime + refetchOnMount keep the seeded markups stable so
        // useQuery never schedules a real fetch mid-test (which would
        // bump the commit counter and mask the regression we're
        // pinning down).
        staleTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
  return {
    apiRequest: vi.fn(async () => ({ ok: true } as unknown as Response)),
    queryClient,
    getQueryFn: () => async () => null,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import PlanMarkupLayer from "../PlanMarkupLayer";
import {
  apiRequest,
  queryClient as testQueryClient,
} from "@/lib/queryClient";
import Konva from "konva";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

const DOC_ID = "doc-1";
const PAGE = 1;
const CANVAS = 400;
const queryKey = [
  "/api/plan-documents",
  DOC_ID,
  "markups",
  PAGE,
] as const;

const seededMarkups = [
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
      { x: 0.6, y: 0.6 },
      { x: 0.7, y: 0.7 },
    ],
    color: "#3b82f6",
    thickness: 2,
  },
];

beforeEach(() => {
  apiRequestMock.mockClear();
  apiRequestMock.mockImplementation(async () => ({ ok: true } as Response));
  // Pre-seed so useQuery resolves synchronously from cache without a
  // network call (in addition to the staleTime: Infinity default).
  testQueryClient.setQueryData(queryKey, seededMarkups);
  // Belt-and-suspenders: stub fetch so any stray queryFn invocation
  // (e.g. a future invalidation flush) returns the same payload
  // instead of erroring out and re-rendering the layer.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          json: async () => seededMarkups,
        } as Response),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  testQueryClient.clear();
});

function renderLayer(commitCounter: { count: number }) {
  const onRender: ProfilerOnRenderCallback = () => {
    commitCounter.count += 1;
  };
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      <Profiler id="layer" onRender={onRender}>
        {children}
      </Profiler>
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
  // react-konva pushes each mounted Stage onto Konva.stages; the most
  // recently mounted one is the layer under test.
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  expect(stages.length).toBeGreaterThan(0);
  return stages[stages.length - 1];
}

function clickShape(stage: Konva.Stage, idx: number, shift: boolean) {
  // Each markup renders as a wrapping <Group> in the order they were
  // seeded (one direct child of the Layer). Clicking the Group drives
  // MarkupShapeView -> handleSelectShape via the renderer's onSelect
  // callback. Per Task #1729 the Shift modifier is forwarded off the
  // synthetic Konva event's underlying native event (`evt.evt`), so
  // we attach a stub MouseEvent with the desired shiftKey here. No
  // reliance on `window.event` — the modifier flows entirely through
  // the dispatched event object.
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

describe("PlanMarkupLayer group-drag (Task #1719 — render lockdown)", () => {
  it("imperatively translates siblings on dragMove without firing any React commits", async () => {
    const counter = { count: 0 };
    renderLayer(counter);

    const stage = getStage();

    // Multi-select all three markups (plain click, then Shift+click x2).
    clickShape(stage, 0, false);
    clickShape(stage, 1, true);
    clickShape(stage, 2, true);

    // After selection settles, every member of the expanded selection
    // gets the `markup-drag-member-<id>` Konva name and `draggable=true`
    // — the contract `getGroupProps` is meant to satisfy.
    const layer = stage.getLayers()[0];
    const findMember = (id: string) =>
      layer.findOne(`.markup-drag-member-${id}`) as Konva.Node;
    const dragged = findMember("m-a");
    const sibB = findMember("m-b");
    const sibC = findMember("m-c");
    expect(dragged).toBeTruthy();
    expect(sibB).toBeTruthy();
    expect(sibC).toBeTruthy();
    expect(dragged.draggable()).toBe(true);
    expect(sibB.draggable()).toBe(true);
    expect(sibC.draggable()).toBe(true);

    // Spy on `position()` for siblings so we can count imperative
    // updates per frame. The spy starts AFTER selection so the only
    // calls it sees are from the drag handlers themselves.
    const sibBPositionSpy = vi.spyOn(sibB, "position");
    const sibCPositionSpy = vi.spyOn(sibC, "position");

    // Capture the React commit baseline AFTER selection so we can
    // detect ANY commit caused by the drag.
    const baseline = counter.count;

    // dragstart: caches origX/origY and disables hit-testing on
    // siblings. Pure ref + Konva mutations — must not commit React.
    act(() => {
      dragged.fire("dragstart", { target: dragged } as never, true);
    });
    expect(sibB.listening()).toBe(false);
    expect(sibC.listening()).toBe(false);
    expect(sibB.draggable()).toBe(false);
    expect(sibC.draggable()).toBe(false);
    expect(counter.count).toBe(baseline);

    // Simulate N dragMove frames. Every sibling must track the dragged
    // node by the same pixel delta — and NOT ONE React commit may
    // occur between them (this is the regression trap for any future
    // setState that creeps back into onDragMove).
    const frames = [
      { x: 10, y: 0 },
      { x: 25, y: 8 },
      { x: 40, y: 18 },
      { x: 55, y: 30 },
    ];
    for (const f of frames) {
      dragged.position({ x: f.x, y: f.y });
      act(() => {
        dragged.fire("dragmove", { target: dragged } as never, true);
      });
      expect(sibB.position()).toEqual({ x: f.x, y: f.y });
      expect(sibC.position()).toEqual({ x: f.x, y: f.y });
      expect(counter.count).toBe(baseline);
    }

    // Each sibling's `position()` setter must have been invoked exactly
    // once per dragMove frame (length-0 calls are getter reads we did
    // ourselves inside `expect(...)`).
    const sibBSets = sibBPositionSpy.mock.calls.filter((c) => c.length > 0);
    const sibCSets = sibCPositionSpy.mock.calls.filter((c) => c.length > 0);
    expect(sibBSets).toHaveLength(frames.length);
    expect(sibCSets).toHaveLength(frames.length);

    // dragend: every Konva-managed position resets to {0,0} so the
    // optimistic React state can take over without a "double-shift",
    // and listening/draggable are restored so the user can immediately
    // start a new drag from any member.
    const finalFrame = frames[frames.length - 1];
    await act(async () => {
      dragged.fire("dragend", { target: dragged } as never, true);
    });
    expect(dragged.position()).toEqual({ x: 0, y: 0 });
    expect(sibB.position()).toEqual({ x: 0, y: 0 });
    expect(sibC.position()).toEqual({ x: 0, y: 0 });
    expect(sibB.listening()).toBe(true);
    expect(sibC.listening()).toBe(true);
    expect(sibB.draggable()).toBe(true);
    expect(sibC.draggable()).toBe(true);

    // The bulk-move PATCH (Task #1676) must fire EXACTLY once with the
    // final delta normalized into 0–1 canvas coordinates and applied
    // to every selected member's points. `mutate()` awaits the async
    // `onMutate` (cancelQueries) before calling the mutationFn, so
    // we wait for the call to land.
    await waitFor(() => {
      const patches = apiRequestMock.mock.calls.filter(
        (c) =>
          c[0] === "PATCH" &&
          /\/api\/plan-documents\/.*\/markups\/bulk$/.test(String(c[1])),
      );
      expect(patches).toHaveLength(1);
    });
    const patches = apiRequestMock.mock.calls.filter(
      (c) =>
        c[0] === "PATCH" &&
        /\/api\/plan-documents\/.*\/markups\/bulk$/.test(String(c[1])),
    );
    const body = patches[0][2] as {
      updates: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
    };
    expect(body.updates).toHaveLength(3);
    const ndx = finalFrame.x / CANVAS;
    const ndy = finalFrame.y / CANVAS;
    const byId = new Map(body.updates.map((u) => [u.id, u]));
    expect(byId.get("m-a")!.points[0].x).toBeCloseTo(0.1 + ndx, 10);
    expect(byId.get("m-a")!.points[0].y).toBeCloseTo(0.1 + ndy, 10);
    expect(byId.get("m-b")!.points[0].x).toBeCloseTo(0.3 + ndx, 10);
    expect(byId.get("m-b")!.points[1].y).toBeCloseTo(0.5 + ndy, 10);
    expect(byId.get("m-c")!.points[1].x).toBeCloseTo(0.7 + ndx, 10);
    expect(byId.get("m-c")!.points[1].y).toBeCloseTo(0.7 + ndy, 10);
  });
});
