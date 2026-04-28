// @vitest-environment jsdom
/**
 * Task #2205 — Integration tests for the takeoff workspace's mobile /
 * stylus touch-gesture wiring.
 *
 * The pure utility at `client/src/lib/pointerInput.ts` (palm rejection,
 * pinch interpretation, long-press detector) has unit coverage in
 * `client/src/lib/__tests__/pointerInput.test.ts`. This file pins down
 * the **integration** of those primitives into the canvas surfaces:
 *
 *   1. PlanMarkupLayer drops a fat finger touch (width > palm band)
 *      from its pointerdown handler when a stylus is in contact, so
 *      stray palm rests do not arm the marquee / draft branch.
 *   2. The TakeoffWorkspace stylus long-press → snap HUD wiring
 *      (`createLongPressDetector` + `useTakeoffStylusPrefs`) opens
 *      the HUD after the configured hold for pen pointers, but never
 *      for finger touches.
 *   3. The use-takeoff-interactions pinch-rotate gate fires
 *      `onRotateCW` once per π/2 of cumulative rotation when the
 *      "Allow two-finger rotate" preference is on, and is a no-op
 *      when it is off.
 *
 * These three paths can not be exercised by Playwright in CI: the
 * Replit container has no real touch input and Playwright cannot
 * synthesise PointerEvents that carry stylus / pen pressure data with
 * the precision required to observe palm-band thresholds. A jsdom
 * integration test that drives synthetic PointerEvents (and, where
 * Konva is involved, fires through the Konva stage) is the only place
 * a regression in the prefs hook, the long-press detector wiring, or
 * the PlanMarkupLayer rejection branch will be caught before merge.
 */
import React, { useRef } from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  render,
  cleanup,
  act,
  renderHook,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Identical to other PlanMarkupLayer integration tests — keep
        // useQuery from triggering real network calls so the seeded
        // markup list stays stable across the gesture sequence.
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

// `useTakeoffStylusPrefs` reads `/api/user-settings` via useQuery.
// Mocking it directly lets each test pin the exact pref values it needs
// (palm band, long-press ms, rotate gate) without standing up a fake
// fetch. The PlanMarkupLayer / TakeoffWorkspace integration calls are
// the surfaces under test; the hook itself has its own coverage.
const mockedPrefs = {
  current: {
    allowTwoFingerRotate: false,
    palmRejectionBandPx: 24,
    stylusLongPressMs: 500,
  },
};
vi.mock("@/hooks/use-takeoff-stylus-prefs", () => ({
  useTakeoffStylusPrefs: () => mockedPrefs.current,
}));

import PlanMarkupLayer from "../markups/PlanMarkupLayer";
import {
  apiRequest,
  queryClient as testQueryClient,
} from "@/lib/queryClient";
import Konva from "konva";
import { useStylusLongPress } from "@/hooks/use-stylus-long-press";
import { useTakeoffStylusPrefs } from "@/hooks/use-takeoff-stylus-prefs";
import { useTakeoffInteractions } from "@/hooks/use-takeoff-interactions";

const apiRequestMock = apiRequest as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 1. PlanMarkupLayer palm rejection
// ---------------------------------------------------------------------------

const DOC_ID = "doc-touch-gestures";
const PAGE = 1;
const CANVAS = 400;
const queryKey = [
  "/api/plan-documents",
  DOC_ID,
  "markups",
  PAGE,
] as const;

beforeEach(() => {
  apiRequestMock.mockClear();
  apiRequestMock.mockImplementation(async () => ({ ok: true } as Response));
  testQueryClient.setQueryData(queryKey, []);
  // Belt-and-suspenders against any stray useQuery refetch.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] } as Response)),
  );
  // Reset prefs to defaults between tests.
  mockedPrefs.current = {
    allowTwoFingerRotate: false,
    palmRejectionBandPx: 24,
    stylusLongPressMs: 500,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanup();
  testQueryClient.clear();
});

function renderMarkupLayer(activeTool: "SELECT" | "ARROW" = "SELECT") {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  );
  return render(
    <PlanMarkupLayer
      documentId={DOC_ID}
      pageNumber={PAGE}
      canvasWidth={CANVAS}
      canvasHeight={CANVAS}
      activeTool={activeTool}
      color="#ef4444"
      thickness={2}
    />,
    { wrapper: Wrapper },
  );
}

function getStage(): Konva.Stage {
  const stages = (Konva as unknown as { stages: Konva.Stage[] }).stages;
  expect(stages.length).toBeGreaterThan(0);
  return stages[stages.length - 1];
}

/** Drive a synthetic Konva pointerdown with full control over the
 *  underlying native event's pointerType / size and the cursor
 *  position the renderer sees via `stage.getPointerPosition()`. */
function firePointerDown(
  stage: Konva.Stage,
  cursor: { x: number; y: number },
  native: Partial<PointerEvent> & { pointerType: string; pointerId: number },
) {
  // The MarkupRenderer reads the cursor from the stage; spy it to the
  // requested coords for the duration of this single fire.
  const original = stage.getPointerPosition;
  stage.getPointerPosition = () => cursor;
  try {
    act(() => {
      stage.fire(
        "pointerdown",
        {
          target: stage,
          evt: {
            width: 0,
            height: 0,
            clientX: cursor.x,
            clientY: cursor.y,
            shiftKey: false,
            ...native,
          } as unknown as PointerEvent,
        } as never,
        true,
      );
    });
  } finally {
    stage.getPointerPosition = original;
  }
}

function readMarqueeLeftPx(): number | null {
  const el = document.querySelector(
    '[data-testid="markup-marquee"]',
  ) as HTMLElement | null;
  if (!el) return null;
  // The element's inline style is set as `left: <px>px`. We strip the
  // unit and parse so the assertion is robust to JSDom's preferred
  // serialisation.
  const raw = el.style.left;
  if (!raw) return null;
  return Number.parseFloat(raw);
}

describe("Task #2205 — PlanMarkupLayer palm rejection (integration)", () => {
  it("drops a fat finger touch from pointerdown while a pen is in contact", () => {
    renderMarkupLayer("SELECT");
    const stage = getStage();

    // Pen down arms the marquee at (0.25, 0.25) → left = 100px. The
    // pen is ALSO recorded in the layer's ActivePointerTracker so the
    // subsequent palm-rejection check sees `penActive=true`.
    firePointerDown(
      stage,
      { x: 100, y: 100 },
      { pointerType: "pen", pointerId: 1, width: 0, height: 0 },
    );
    expect(readMarqueeLeftPx()).toBe(100);

    // Fat finger touch (width 40 > band 24) lands at (200, 200). Palm
    // rejection MUST drop it before the SELECT-mode marquee branch
    // re-arms — the marquee should still anchor at the pen position.
    firePointerDown(
      stage,
      { x: 200, y: 200 },
      { pointerType: "touch", pointerId: 2, width: 40, height: 40 },
    );
    expect(readMarqueeLeftPx()).toBe(100);
  });

  it("honors a small finger touch (within the palm band) so deliberate taps still register", () => {
    renderMarkupLayer("SELECT");
    const stage = getStage();

    // Pen down — penActive=true, marquee at 100px.
    firePointerDown(
      stage,
      { x: 100, y: 100 },
      { pointerType: "pen", pointerId: 1, width: 0, height: 0 },
    );
    expect(readMarqueeLeftPx()).toBe(100);

    // Small touch (width 10 < band 24): contact size below the band so
    // shouldRejectAsPalm is false even though the pen is in contact.
    // Marquee should re-anchor at (300, 300) → left = 300px. This is
    // the control case for the rejection assertion above — without it
    // a regression that "always rejects when penActive" would silently
    // pass the first assertion.
    firePointerDown(
      stage,
      { x: 300, y: 300 },
      { pointerType: "touch", pointerId: 2, width: 10, height: 10 },
    );
    expect(readMarqueeLeftPx()).toBe(300);
  });

  it("never rejects finger touches when no pen is active", () => {
    renderMarkupLayer("SELECT");
    const stage = getStage();

    // No pen has ever touched down → penActive=false → palm rejection
    // is a no-op regardless of contact size. A finger-only user with a
    // chunky thumb must still be able to start a marquee.
    firePointerDown(
      stage,
      { x: 200, y: 200 },
      { pointerType: "touch", pointerId: 1, width: 60, height: 60 },
    );
    expect(readMarqueeLeftPx()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 2. TakeoffWorkspace stylus long-press → snap HUD
// ---------------------------------------------------------------------------

/**
 * Thin harness that wires the *production* `useStylusLongPress` hook
 * (the same one `TakeoffWorkspace` consumes for its snap-HUD effect)
 * to a real DOM element so jsdom can dispatch PointerEvents at it.
 * The harness intentionally does NOT re-implement listener wiring —
 * it only mounts the hook with the prefs the workspace would pass.
 * Any regression in the hook's listener set, holdMs reactivity, or
 * pen-only gating shows up here.
 */
function LongPressHarness({ onSnapHud }: { onSnapHud: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stylusPrefs = useTakeoffStylusPrefs();
  useStylusLongPress(ref, {
    holdMs: stylusPrefs.stylusLongPressMs,
    onLongPress: onSnapHud,
  });
  return <div data-testid="long-press-surface" ref={ref} />;
}

/** Construct a minimally-typed PointerEvent that flows through the
 *  detector. JSDom's PointerEvent constructor exists; we only set the
 *  fields the detector reads (pointerId, pointerType, clientX/Y). */
function makePointerEvent(
  type: string,
  init: { pointerId: number; pointerType: string; clientX?: number; clientY?: number },
): PointerEvent {
  const evt = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperty(evt, "pointerId", { value: init.pointerId });
  Object.defineProperty(evt, "pointerType", { value: init.pointerType });
  Object.defineProperty(evt, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(evt, "clientY", { value: init.clientY ?? 0 });
  return evt;
}

describe("Task #2205 — Stylus long-press → snap HUD wiring (integration)", () => {
  it("opens the snap HUD after the configured hold for a pen pointer", () => {
    vi.useFakeTimers();
    mockedPrefs.current = {
      ...mockedPrefs.current,
      stylusLongPressMs: 500,
    };
    const onSnapHud = vi.fn();
    render(<LongPressHarness onSnapHud={onSnapHud} />);
    const surface = document.querySelector(
      '[data-testid="long-press-surface"]',
    ) as HTMLDivElement;

    act(() => {
      surface.dispatchEvent(
        makePointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "pen",
          clientX: 50,
          clientY: 60,
        }),
      );
    });
    // Just under the threshold: still pending.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onSnapHud).not.toHaveBeenCalled();
    // Cross the threshold: HUD opens.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSnapHud).toHaveBeenCalledTimes(1);
  });

  it("respects the per-user `stylusLongPressMs` pref", () => {
    vi.useFakeTimers();
    // Bump the threshold to 900ms via the prefs hook. The detector must
    // NOT fire at the default 500ms — proving the wiring reads the
    // current pref value, not a hard-coded constant.
    mockedPrefs.current = {
      ...mockedPrefs.current,
      stylusLongPressMs: 900,
    };
    const onSnapHud = vi.fn();
    render(<LongPressHarness onSnapHud={onSnapHud} />);
    const surface = document.querySelector(
      '[data-testid="long-press-surface"]',
    ) as HTMLDivElement;

    act(() => {
      surface.dispatchEvent(
        makePointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "pen",
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onSnapHud).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSnapHud).toHaveBeenCalledTimes(1);
  });

  it("never fires for finger touch pointers, even past the hold threshold", () => {
    vi.useFakeTimers();
    const onSnapHud = vi.fn();
    render(<LongPressHarness onSnapHud={onSnapHud} />);
    const surface = document.querySelector(
      '[data-testid="long-press-surface"]',
    ) as HTMLDivElement;

    act(() => {
      surface.dispatchEvent(
        makePointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "touch",
        }),
      );
    });
    act(() => {
      // Well past the configured 500ms hold.
      vi.advanceTimersByTime(2000);
    });
    expect(onSnapHud).not.toHaveBeenCalled();
  });

  it("cancels the pending long-press when the pointer moves past the budget", () => {
    vi.useFakeTimers();
    const onSnapHud = vi.fn();
    render(<LongPressHarness onSnapHud={onSnapHud} />);
    const surface = document.querySelector(
      '[data-testid="long-press-surface"]',
    ) as HTMLDivElement;

    act(() => {
      surface.dispatchEvent(
        makePointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "pen",
          clientX: 0,
          clientY: 0,
        }),
      );
      // Move 20px (well past the 8px movement budget) — gesture aborts.
      surface.dispatchEvent(
        makePointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "pen",
          clientX: 20,
          clientY: 0,
        }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onSnapHud).not.toHaveBeenCalled();
  });

  it("survives parent re-renders mid-hold and still fires the latest callback", () => {
    // Regression guard for the callback-stability fix in
    // `use-stylus-long-press`. TakeoffWorkspace passes an inline arrow
    // for `onLongPress`, so its identity changes on every render. If
    // the hook listed `onLongPress` in its effect deps, every parent
    // re-render mid-hold would tear down the listener bookkeeping and
    // cancel the pending hold timer. Here we render once, dispatch a
    // pen pointerdown, force a parent re-render (with a NEW callback
    // identity), advance past the threshold, and assert the LATEST
    // callback fires exactly once.
    vi.useFakeTimers();
    const firstCb = vi.fn();
    const secondCb = vi.fn();
    const { rerender } = render(<LongPressHarness onSnapHud={firstCb} />);
    const surface = document.querySelector(
      '[data-testid="long-press-surface"]',
    ) as HTMLDivElement;

    act(() => {
      surface.dispatchEvent(
        makePointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "pen",
          clientX: 0,
          clientY: 0,
        }),
      );
    });
    // Mid-hold re-render: a fresh closure replaces the prior one.
    act(() => {
      vi.advanceTimersByTime(200);
      rerender(<LongPressHarness onSnapHud={secondCb} />);
    });
    // Cross the 500ms threshold from the original press timestamp.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(firstCb).not.toHaveBeenCalled();
    expect(secondCb).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. use-takeoff-interactions two-finger rotate gate
// ---------------------------------------------------------------------------

/**
 * Build a minimally-shaped Konva-style touch event for `handleTouchMove`.
 * The hook reads `e.evt.touches[0..1].clientX/Y` and calls
 * `e.evt.preventDefault()`. Anything else is unused for the rotate
 * accumulator branch. The hook's parameter type is `any`, so we keep
 * the literal shape and let the call site infer it without an extra
 * cast.
 */
interface SyntheticTouchMoveEvent {
  evt: {
    preventDefault: () => void;
    touches: Array<{ clientX: number; clientY: number }>;
  };
}

function makeTouchMoveEvent(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): SyntheticTouchMoveEvent {
  return {
    evt: {
      preventDefault: () => {},
      touches: [a, b],
    },
  };
}

interface RotateHookOpts {
  allowTwoFingerRotate: boolean;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
}

/**
 * Build a fully-typed `UseTakeoffInteractionsParams` payload for the
 * rotate-gate tests. The shape is derived from the hook's inferred
 * parameter type so any future field added to the params interface
 * forces this builder to be updated (compile-time safety net), while
 * the few opaque collaborators (sheet row, history bag, mutation,
 * aggregator) reuse the same minimal shims the snap-constraint test
 * already standardised on.
 */
function buildRotateParams(
  opts: RotateHookOpts,
): Parameters<typeof useTakeoffInteractions>[0] {
  const noop = () => {};
  const fakeStage = {
    container: () => ({
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 1000,
        height: 1000,
        right: 1000,
        bottom: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    }),
  };
  return {
    projectId: "p1",
    selectedSheet: "s1",
    currentSheet: { id: "s1", scalePxPerFoot: 12 } as any,
    measurements: [],
    categories: [],
    activeTool: "linear",
    setActiveTool: noop,
    isDrawing: false,
    setIsDrawing: noop,
    drawingPoints: [],
    setDrawingPoints: noop,
    currentDrawingTool: null,
    setCurrentDrawingTool: noop,
    calibrationMode: "idle",
    setCalibrationMode: noop,
    calibrationPoints: [],
    setCalibrationPoints: noop,
    calibrationDistance: "",
    setCalibrationDistance: noop,
    units: "ft",
    stageScale: 1,
    setStageScale: noop,
    stagePosition: { x: 0, y: 0 },
    setStagePosition: noop,
    selectedCategoryId: null,
    selectedMeasurementId: null,
    setSelectedMeasurementId: noop,
    setSelectedSegmentIndex: noop,
    notePosition: null,
    setNotePosition: noop,
    setNoteDialogOpen: noop,
    noteText: "",
    setNoteText: noop,
    pitchRatio: "",
    dropDistance: "",
    verifyMode: "idle",
    setVerifyMode: noop,
    verifyPoints: [],
    setVerifyPoints: noop,
    verifyExpectedDistance: "",
    setVerifyResult: noop,
    isSpacebarHeld: false,
    setIsSpacebarHeld: noop,
    toolBeforeSpacebar: null,
    setToolBeforeSpacebar: noop,
    isFullscreen: false,
    setIsFullscreen: noop,
    workspaceRef: { current: null } as React.RefObject<HTMLDivElement | null>,
    stageRef: { current: fakeStage } as React.RefObject<any>,
    takeoffHistory: {
      pushAction: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
    } as any,
    createMeasurementMutation: { mutate: vi.fn() } as any,
    aggregatedMeasurements: { byType: { area: [], volume: [], segment: [] } } as any,
    setShortcutsDialogOpen: noop,
    isMobile: true,
    sheetRotation: 0,
    imageWidth: 1000,
    imageHeight: 1000,
    disableLegacyShortcuts: true,
    enabledSnapModes: [],
    constraintMode: "none",
    orthoPresetIndex: 4,
    allowTwoFingerRotate: opts.allowTwoFingerRotate,
    onRotateCW: opts.onRotateCW,
    onRotateCCW: opts.onRotateCCW,
  };
}

describe("Task #2205 — useTakeoffInteractions two-finger rotate gate (integration)", () => {
  it("is a no-op when allowTwoFingerRotate is off, regardless of how far the gesture rotates", () => {
    const onRotateCW = vi.fn();
    const onRotateCCW = vi.fn();
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildRotateParams({
          allowTwoFingerRotate: false,
          onRotateCW,
          onRotateCCW,
        }),
      ),
    );

    // Drive a full 180° rotation across three frames. Frame 1 sets the
    // pinch baseline; frames 2-3 each rotate the touch axis by 90°.
    act(() => {
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }),
      );
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }),
      );
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: -100, clientY: 0 }),
      );
    });

    expect(onRotateCW).not.toHaveBeenCalled();
    expect(onRotateCCW).not.toHaveBeenCalled();
  });

  it("fires onRotateCW exactly once per quarter turn when allowTwoFingerRotate is on", () => {
    const onRotateCW = vi.fn();
    const onRotateCCW = vi.fn();
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildRotateParams({
          allowTwoFingerRotate: true,
          onRotateCW,
          onRotateCCW,
        }),
      ),
    );

    act(() => {
      // Frame 1 — baseline (no fire). Touches horizontal: angle = 0.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }),
      );
    });
    expect(onRotateCW).not.toHaveBeenCalled();
    expect(onRotateCCW).not.toHaveBeenCalled();

    act(() => {
      // Frame 2 — touches vertical: angle = +π/2. dAngle = +π/2 → one CW.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 0, clientY: 100 }),
      );
    });
    expect(onRotateCW).toHaveBeenCalledTimes(1);
    expect(onRotateCCW).not.toHaveBeenCalled();

    act(() => {
      // Frame 3 — touches horizontal opposite: angle = π. dAngle = +π/2 → another CW.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: -100, clientY: 0 }),
      );
    });
    expect(onRotateCW).toHaveBeenCalledTimes(2);
    expect(onRotateCCW).not.toHaveBeenCalled();
  });

  it("fires onRotateCCW for the opposite rotation direction", () => {
    const onRotateCW = vi.fn();
    const onRotateCCW = vi.fn();
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildRotateParams({
          allowTwoFingerRotate: true,
          onRotateCW,
          onRotateCCW,
        }),
      ),
    );

    act(() => {
      // Baseline horizontal.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }),
      );
      // Rotate the touch axis by -π/2 (touches now vertical, but with
      // the second touch ABOVE the first → angle = -π/2). The negative
      // accumulator path fires onRotateCCW.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 0, clientY: -100 }),
      );
    });

    expect(onRotateCCW).toHaveBeenCalledTimes(1);
    expect(onRotateCW).not.toHaveBeenCalled();
  });

  it("does NOT double-fire on a sub-quarter-turn nudge", () => {
    const onRotateCW = vi.fn();
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildRotateParams({
          allowTwoFingerRotate: true,
          onRotateCW,
        }),
      ),
    );

    // Baseline.
    act(() => {
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }),
      );
      // Slight rotation — second touch nudged just below horizontal so
      // dAngle ≈ atan2(10, 100) ≈ 0.0997 rad, well under π/2. No fire.
      result.current.handleTouchMove(
        makeTouchMoveEvent({ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 10 }),
      );
    });
    expect(onRotateCW).not.toHaveBeenCalled();
  });
});
