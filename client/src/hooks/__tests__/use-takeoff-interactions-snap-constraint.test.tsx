// @vitest-environment jsdom
/**
 * Task #2192 — Lock down the contract that the unified ribbon's
 * `enabledSnapModes`, `constraintMode` and `orthoPresetIndex` props
 * actually drive how `useTakeoffInteractions.resolvePoint` returns
 * snapped/constrained coordinates. The previous implementation only
 * read the legacy `snapEnabled` / `orthoLock` booleans, so toggling a
 * snap mode in the ribbon was a visual no-op and selecting a non-90°
 * ortho preset still produced 90° axis locks.
 *
 * The four cases below cover:
 *   1. With `midpoint` excluded from `enabledSnapModes`, a cursor on
 *      a segment midpoint resolves UNCHANGED (no snap fires).
 *   2. With `midpoint` included, the same cursor RESOLVES to the
 *      exact midpoint coordinates.
 *   3. An empty `enabledSnapModes` array disables snapping entirely
 *      even if the legacy `snapEnabled` boolean is still on.
 *   4. With `constraintMode = 'ortho-angle'` and `orthoPresetIndex`
 *      pointing at 45°, a cursor at ~50° from horizontal snaps to a
 *      45° bearing while preserving cursor reach (i.e. the radial
 *      angle-constraint behaviour, not the legacy axis-only ortho
 *      lock that would zero the off-axis component).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { useTakeoffInteractions } from "../use-takeoff-interactions";
import type { TakeoffMeasurement } from "@shared/schema";

function makeMeasurement(
  id: string,
  type: string,
  points: Array<{ x: number; y: number }>,
): TakeoffMeasurement {
  // The hook only reads `id`, `type`, `points` for snap-target
  // computation; everything else is unused by `resolvePoint`. Cast
  // through `unknown` to avoid pulling the full row shape into the
  // test.
  return {
    id,
    type,
    points: JSON.stringify(points),
  } as unknown as TakeoffMeasurement;
}

interface OverrideOpts {
  enabledSnapModes?: Parameters<typeof useTakeoffInteractions>[0]["enabledSnapModes"];
  constraintMode?: Parameters<typeof useTakeoffInteractions>[0]["constraintMode"];
  orthoPresetIndex?: number;
  drawingPoints?: Array<{ x: number; y: number }>;
  measurements?: TakeoffMeasurement[];
  // Task #2204 — polar-lock + typed-length draw flow knobs.
  polarAngleStep?: number;
  pendingDimLengthFt?: number | null;
  scalePxPerFoot?: number;
}

function buildParams(
  opts: OverrideOpts = {},
): Parameters<typeof useTakeoffInteractions>[0] {
  const noop = () => {};
  return {
    projectId: "p1",
    selectedSheet: "s1",
    currentSheet: { id: "s1", scalePxPerFoot: opts.scalePxPerFoot ?? 12 } as any,
    measurements: opts.measurements ?? [],
    categories: [],
    activeTool: "linear",
    setActiveTool: noop,
    isDrawing: (opts.drawingPoints?.length ?? 0) > 0,
    setIsDrawing: noop,
    drawingPoints: opts.drawingPoints ?? [],
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
    stageRef: { current: null } as React.RefObject<any>,
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
    isMobile: false,
    sheetRotation: 0,
    imageWidth: 1000,
    imageHeight: 1000,
    disableLegacyShortcuts: true,
    enabledSnapModes: opts.enabledSnapModes,
    constraintMode: opts.constraintMode,
    orthoPresetIndex: opts.orthoPresetIndex,
    polarAngleStep: opts.polarAngleStep,
    pendingDimLengthFt: opts.pendingDimLengthFt,
  };
}

beforeEach(() => {
  // Avoid localStorage drift between tests for the legacy
  // `snapEnabled` / `orthoLock` initial values that the hook
  // hydrates from `window.localStorage`.
  window.localStorage.clear();
});

describe("Task #2192 — useTakeoffInteractions wires unified-ribbon snap modes", () => {
  // Horizontal segment from (0,0) → (100,0); midpoint sits at (50,0).
  // The cursor is offset 1px from the midpoint so we can tell whether
  // a snap actually fired (output is exactly the midpoint) or didn't
  // (output equals the cursor coordinates, modulo any constraint).
  const seg = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("does not snap to the midpoint when `midpoint` is excluded from enabledSnapModes", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"], // explicitly omit midpoint
          constraintMode: "none",
          orthoPresetIndex: 4, // null preset = off
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      // Cursor 1px above the midpoint, well within the 12px snap
      // radius — so if midpoint snap WERE on it would land on (50,0).
      resolved = result.current.resolvePoint({ x: 50, y: 1 });
    });
    expect(resolved).toEqual({ x: 50, y: 1 });
  });

  it("snaps to the midpoint when `midpoint` IS included", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint", "midpoint"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 50, y: 1 });
    });
    expect(resolved.x).toBeCloseTo(50, 6);
    expect(resolved.y).toBeCloseTo(0, 6);
  });

  it("an empty enabledSnapModes array disables snapping entirely", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [], // every mode off
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      // Cursor exactly on the endpoint — would normally snap there.
      resolved = result.current.resolvePoint({ x: 0.5, y: 0.5 });
    });
    expect(resolved).toEqual({ x: 0.5, y: 0.5 });
  });

  it("ortho-angle preset at 45° applies the radial angular constraint (not legacy axis lock)", () => {
    // Anchor at origin via drawingPoints; cursor at ~50° from horizontal.
    // 45° preset → snapped bearing is 45°, distance preserved.
    const cursor = { x: 64.28, y: 76.6 }; // ≈ 100 * (cos50°, sin50°)
    const dist = Math.sqrt(cursor.x * cursor.x + cursor.y * cursor.y);
    const expectedX = Math.cos(Math.PI / 4) * dist;
    const expectedY = Math.sin(Math.PI / 4) * dist;

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [], // snap off so it can't mask the constraint
          constraintMode: "ortho-angle",
          orthoPresetIndex: 2, // ORTHO_PRESETS[2] === 45
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );

    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });

    expect(resolved.x).toBeCloseTo(expectedX, 3);
    expect(resolved.y).toBeCloseTo(expectedY, 3);
    // Sanity: legacy axis lock would have produced (64.28, 0) — i.e.
    // y zeroed and the cursor x kept. Make sure we are NOT doing that.
    expect(Math.abs(resolved.y)).toBeGreaterThan(1);
  });

  it("constraintMode='none' is authoritative — stale localStorage `takeoff-ortho-lock=true` does NOT re-enable a 90° lock", () => {
    // Simulate a user who once toggled the legacy ortho-lock keyboard
    // shortcut and still has it persisted in localStorage. The unified
    // ribbon is now mounted and explicitly says Free (constraintMode =
    // 'none'); the canvas must respect the ribbon, not the stale flag.
    window.localStorage.setItem("takeoff-ortho-lock", "true");
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      // Off-axis cursor — legacy 90° axis lock would zero y (smaller
      // |dy| vs. |dx|). With the ribbon authoritative, both
      // coordinates must pass through unchanged.
      resolved = result.current.resolvePoint({ x: 30, y: 10 });
    });
    expect(resolved).toEqual({ x: 30, y: 10 });
  });

  it("handleStageMouseMove HUD parity — currentSnap follows enabledSnapModes (not legacy snapEnabled)", () => {
    // Legacy snapEnabled defaults to true (and is persisted). The
    // ribbon owns state with empty enabledSnapModes → the live HUD
    // current-snap indicator must be cleared, matching the
    // resolve-time behaviour. Drives the same `handleStageMouseMove`
    // code path users hit while moving the cursor on the canvas.
    window.localStorage.setItem("takeoff-snap-enabled", "true");
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [], // ribbon: all snaps off
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    // Build a fake Konva-shaped event whose pointer maps directly to
    // the segment endpoint (would normally trigger an endpoint snap).
    const fakeStage = {
      getPointerPosition: () => ({ x: 0, y: 0 }),
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = {
      target: { getStage: () => fakeStage },
      evt: {},
    };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });
    expect(result.current.currentSnap).toBeNull();
    expect(result.current.cursorPosition).toEqual({ x: 0, y: 0 });
  });

  it("handleStageMouseMove HUD parity — currentSnap fires when matching mode is enabled", () => {
    // Counterpart to the previous case: with `endpoint` enabled, the
    // same pointer position lights up the snap HUD.
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    const fakeStage = {
      getPointerPosition: () => ({ x: 0, y: 0 }),
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = {
      target: { getStage: () => fakeStage },
      evt: {},
    };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });
    expect(result.current.currentSnap).not.toBeNull();
    expect(result.current.currentSnap?.snappedPoint).toEqual({ x: 0, y: 0 });
  });

  // ---------------------------------------------------------------
  // Task #2198 — Perpendicular and Nearest snap modes drive
  // resolvePoint and the live HUD. Prior to this task they were
  // toggleable in the ribbon but produced no canvas-side snap.
  // ---------------------------------------------------------------

  it("Task #2198 — Perpendicular: cursor near the perpendicular foot of the draw anchor snaps to that foot", () => {
    // Anchor at (50, 40); horizontal segment along y=0 from (0,0)→(100,0).
    // Perpendicular foot of the anchor onto the segment is (50, 0).
    // Cursor placed 1px off that foot, well inside the 12px snap radius.
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["perpendicular"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [{ x: 50, y: 40 }],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 51, y: 1 });
    });
    expect(resolved.x).toBeCloseTo(50, 6);
    expect(resolved.y).toBeCloseTo(0, 6);
  });

  it("Task #2198 — Perpendicular: when the mode is OFF the same cursor passes through unchanged", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"], // perpendicular omitted
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [{ x: 50, y: 40 }],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 51, y: 1 });
    });
    expect(resolved).toEqual({ x: 51, y: 1 });
  });

  it("Task #2198 — Perpendicular: requires a draw anchor (no snap before first click)", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["perpendicular"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [], // no anchor yet
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 51, y: 1 });
    });
    expect(resolved).toEqual({ x: 51, y: 1 });
  });

  it("Task #2198 — Nearest: cursor near a segment snaps to the closest point on that segment", () => {
    // Cursor at (30, 5), 5px above the y=0 segment → nearest point is (30, 0).
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["nearest"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 30, y: 5 });
    });
    expect(resolved.x).toBeCloseTo(30, 6);
    expect(resolved.y).toBeCloseTo(0, 6);
  });

  it("Task #2198 — Nearest: when the mode is OFF the same cursor passes through unchanged", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"], // nearest omitted
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 30, y: 5 });
    });
    expect(resolved).toEqual({ x: 30, y: 5 });
  });

  it("Task #2198 — Endpoint takes priority over Nearest when both are enabled", () => {
    // Cursor 1px from the endpoint (0,0); both endpoint and nearest
    // are in range. Endpoint snap must win because it's higher
    // priority — the resolved point should be (0,0), not the nearest
    // foot on the segment (which would be (0.5, 0)).
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint", "nearest"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 0.5, y: 0.5 });
    });
    expect(resolved.x).toBeCloseTo(0, 6);
    expect(resolved.y).toBeCloseTo(0, 6);
  });

  it("Task #2198 — Perpendicular HUD: currentSnap reports type='perpendicular' when only perpendicular fires", () => {
    // Drive `handleStageMouseMove` with a cursor positioned near the
    // perpendicular foot of the in-progress anchor. The HUD/badge
    // tracks `currentSnap.snapTarget.type` so users see why a snap
    // occurred — Done-criteria of Task #2198.
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["perpendicular"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [{ x: 50, y: 40 }],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    const fakeStage = {
      getPointerPosition: () => ({ x: 51, y: 1 }),
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = { target: { getStage: () => fakeStage }, evt: {} };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });
    expect(result.current.currentSnap).not.toBeNull();
    expect(result.current.currentSnap?.snapTarget?.type).toBe("perpendicular");
    expect(result.current.currentSnap?.snappedPoint.x).toBeCloseTo(50, 6);
    expect(result.current.currentSnap?.snappedPoint.y).toBeCloseTo(0, 6);
  });

  it("Task #2198 — Nearest HUD: currentSnap reports type='nearest' when only nearest fires", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["nearest"],
          constraintMode: "none",
          orthoPresetIndex: 4,
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    const fakeStage = {
      getPointerPosition: () => ({ x: 30, y: 5 }),
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = { target: { getStage: () => fakeStage }, evt: {} };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });
    expect(result.current.currentSnap).not.toBeNull();
    expect(result.current.currentSnap?.snapTarget?.type).toBe("nearest");
    expect(result.current.currentSnap?.snappedPoint.x).toBeCloseTo(30, 6);
    expect(result.current.currentSnap?.snappedPoint.y).toBeCloseTo(0, 6);
  });

  it("ortho-angle with a null preset (index 4 = off) skips constraint", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "ortho-angle",
          orthoPresetIndex: 4, // ORTHO_PRESETS[4] === null → off
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint({ x: 30, y: 40 });
    });
    expect(resolved).toEqual({ x: 30, y: 40 });
  });
});

/**
 * Task #2199 — `polarGuideStep` is the single value the canvas reads to
 * decide whether (and at what step) to paint the CAD-style polar
 * tracking guide rays. It must light up ONLY when the unified ribbon's
 * angular constraint is engaged with a non-null preset; legacy `ortho`
 * (axis lock) keeps its single dashed preview line, and the bare
 * `orthoLock` boolean is never enough on its own.
 */
describe("Task #2199 — polarGuideStep gates polar tracking guides", () => {
  it("returns the preset degrees when constraintMode='ortho-angle' with a valid preset", () => {
    // 15° / 30° / 45° / 90° all map to a usable step.
    for (const [presetIndex, expected] of [
      [0, 15],
      [1, 30],
      [2, 45],
      [3, 90],
    ] as const) {
      const { result } = renderHook(() =>
        useTakeoffInteractions(
          buildParams({
            enabledSnapModes: [],
            constraintMode: "ortho-angle",
            orthoPresetIndex: presetIndex,
            drawingPoints: [{ x: 0, y: 0 }],
          }),
        ),
      );
      expect(result.current.polarGuideStep).toBe(expected);
    }
  });

  it("is null when the active preset is 'off' (index 4 → null)", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "ortho-angle",
          orthoPresetIndex: 4,
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    expect(result.current.polarGuideStep).toBeNull();
  });

  it("is null for the legacy 90°-axis ortho mode (no polar fan for plain ortho)", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "ortho",
          // orthoPresetIndex is irrelevant for 'ortho' — set to any
          // valid index to confirm the gate is on constraintMode.
          orthoPresetIndex: 2,
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    expect(result.current.polarGuideStep).toBeNull();
  });

  it("is null for constraintMode='none'", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 2,
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    expect(result.current.polarGuideStep).toBeNull();
  });

  /**
   * Task #2225 — Polar lock must paint guide rays too. Previously
   * `polarGuideStep` only emitted for `ortho-angle`, so engaging Polar
   * lock from the ribbon snapped silently with no visible fan. The
   * polar-mode branch must mirror `angleStep`'s default 15° fallback
   * and honor any custom `polarAngleStep` the ribbon hands down.
   */
  it("Task #2225 — returns the default 15° step when constraintMode='polar' with no explicit step", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "polar",
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    expect(result.current.polarGuideStep).toBe(15);
  });

  it("Task #2225 — honors a custom polarAngleStep when constraintMode='polar'", () => {
    for (const step of [5, 10, 22.5, 30]) {
      const { result } = renderHook(() =>
        useTakeoffInteractions(
          buildParams({
            enabledSnapModes: [],
            constraintMode: "polar",
            polarAngleStep: step,
            drawingPoints: [{ x: 0, y: 0 }],
          }),
        ),
      );
      expect(result.current.polarGuideStep).toBe(step);
    }
  });

  it("is null when constraintMode is undefined (legacy callers without ribbon)", () => {
    // Even with the legacy `takeoff-ortho-lock=true` flag persisted,
    // pure-legacy callers must not get polar guides — they never had
    // a preset to choose from in the first place.
    window.localStorage.setItem("takeoff-ortho-lock", "true");
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: undefined,
          orthoPresetIndex: undefined,
          drawingPoints: [{ x: 0, y: 0 }],
        }),
      ),
    );
    expect(result.current.polarGuideStep).toBeNull();
  });
});

/**
 * Task #2204 — Polar-locked draw and typed-length draw end-to-end
 * through `useTakeoffInteractions`.
 *
 * The two new ribbon flows being exercised:
 *   1. `constraintMode === "polar"` with the default 15° step. With an
 *      anchor in `drawingPoints`, a cursor at an arbitrary bearing must
 *      resolve to the nearest 15° multiple while keeping the cursor's
 *      reach (radial distance) — this is the same code path the canvas
 *      hits during a polar-locked LINEAR/POLYLINE draw.
 *   2. `pendingDimLengthFt > 0` (the dim-input HUD has a typed value).
 *      With an anchor and a sheet scale in place, the resolved point
 *      must be projected onto the cursor's bearing at exactly
 *      `pendingDimLengthFt * scalePxPerFoot` pixels from the anchor.
 *
 * Both also check the live HUD path (`handleStageMouseMove`) so the
 * preview line, length badge, and click-commit code use the same
 * resolved coordinates — i.e. the HUD never lies about where a click
 * would land.
 */
describe("Task #2204 — polar-locked and typed-length draw end-to-end", () => {
  it("polar mode: cursor at ~22° from horizontal snaps to the nearest 15° bearing while preserving distance", () => {
    const anchor = { x: 0, y: 0 };
    const dist = 80;
    const rad = (22 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],            // snap off so it can't mask the constraint
          constraintMode: "polar",         // polar lock active
          orthoPresetIndex: 4,             // null preset; polar uses polarAngleStep
          polarAngleStep: 15,              // explicit default, makes intent obvious
          drawingPoints: [anchor],
        }),
      ),
    );

    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });

    // Nearest 15° to 22° is 15°.
    const expectedRad = (15 * Math.PI) / 180;
    expect(resolved.x).toBeCloseTo(Math.cos(expectedRad) * dist, 3);
    expect(resolved.y).toBeCloseTo(Math.sin(expectedRad) * dist, 3);
    // Distance preservation is what makes a polar lock useful — it
    // tracks the user's reach instead of collapsing to an axis.
    expect(Math.hypot(resolved.x, resolved.y)).toBeCloseTo(dist, 3);
  });

  it("polar mode: a custom polarAngleStep (e.g. 30°) overrides the 15° default", () => {
    // Cursor at 22° bearing — with a 30° step the nearest multiple is
    // 30°, not 15°. Proves the polarAngleStep prop actually drives the
    // angular constraint (not a hard-coded 15°).
    const anchor = { x: 0, y: 0 };
    const dist = 80;
    const rad = (22 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "polar",
          orthoPresetIndex: 4,
          polarAngleStep: 30,
          drawingPoints: [anchor],
        }),
      ),
    );

    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });

    const expectedRad = (30 * Math.PI) / 180;
    expect(resolved.x).toBeCloseTo(Math.cos(expectedRad) * dist, 3);
    expect(resolved.y).toBeCloseTo(Math.sin(expectedRad) * dist, 3);
  });

  it("polar mode: HUD pointer move resolves to the same locked point as resolvePoint", () => {
    // Drives the same `handleStageMouseMove` path the live preview uses
    // — so the badge / preview line stays in sync with the click-commit
    // coordinates produced by the polar lock.
    const anchor = { x: 0, y: 0 };
    const dist = 50;
    const rad = (22 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "polar",
          orthoPresetIndex: 4,
          polarAngleStep: 15,
          drawingPoints: [anchor],
        }),
      ),
    );

    const fakeStage = {
      getPointerPosition: () => cursor,
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = { target: { getStage: () => fakeStage }, evt: {} };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });

    const expectedRad = (15 * Math.PI) / 180;
    expect(result.current.cursorPosition).not.toBeNull();
    expect(result.current.cursorPosition!.x).toBeCloseTo(
      Math.cos(expectedRad) * dist, 3,
    );
    expect(result.current.cursorPosition!.y).toBeCloseTo(
      Math.sin(expectedRad) * dist, 3,
    );
  });

  it("typed-length lock: pendingDimLengthFt clamps the resolved point to length × scale, bearing preserved", () => {
    // Sheet scale 12 px/ft; user typed 5 ft → 60 px lock.
    const anchor = { x: 0, y: 0 };
    // Cursor 100px out at 30° bearing → must shrink to 60px at 30°.
    const rad = (30 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * 100, y: Math.sin(rad) * 100 };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [anchor],
          scalePxPerFoot: 12,
          pendingDimLengthFt: 5,
        }),
      ),
    );

    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });

    expect(Math.hypot(resolved.x, resolved.y)).toBeCloseTo(60, 6);
    expect(Math.atan2(resolved.y, resolved.x)).toBeCloseTo(rad, 6);
  });

  it("typed-length lock combines with polar lock: bearing snapped to 15° AND length clamped", () => {
    // Typed 5 ft @ 12 px/ft → 60 px. Cursor at 22° → bearing snaps to
    // 15°, then length clamps to 60 px. Order matters: polar runs
    // first to fix the bearing, then applyFixedLength projects.
    const anchor = { x: 0, y: 0 };
    const rad = (22 * Math.PI) / 180;
    const cursor = { x: Math.cos(rad) * 200, y: Math.sin(rad) * 200 };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "polar",
          orthoPresetIndex: 4,
          polarAngleStep: 15,
          drawingPoints: [anchor],
          scalePxPerFoot: 12,
          pendingDimLengthFt: 5,
        }),
      ),
    );

    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });

    const expectedRad = (15 * Math.PI) / 180;
    expect(Math.hypot(resolved.x, resolved.y)).toBeCloseTo(60, 4);
    expect(Math.atan2(resolved.y, resolved.x)).toBeCloseTo(expectedRad, 4);
  });

  it("typed-length lock no-ops when there is no anchor yet (first click)", () => {
    // Before the user has placed the first vertex, there's nothing for
    // the typed length to project against — must pass through.
    const cursor = { x: 42, y: 17 };
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [], // no anchor
          scalePxPerFoot: 12,
          pendingDimLengthFt: 5,
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });
    expect(resolved).toEqual(cursor);
  });

  it("typed-length lock no-ops when pendingDimLengthFt is null (HUD empty / consumed)", () => {
    const anchor = { x: 0, y: 0 };
    const cursor = { x: 30, y: 40 };
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [anchor],
          scalePxPerFoot: 12,
          pendingDimLengthFt: null,
        }),
      ),
    );
    let resolved!: { x: number; y: number };
    act(() => {
      resolved = result.current.resolvePoint(cursor);
    });
    expect(resolved).toEqual(cursor);
  });

  it("typed-length lock: HUD pointer move uses the locked length too (preview parity)", () => {
    const anchor = { x: 0, y: 0 };
    const rad = (45 * Math.PI) / 180;
    // Cursor 200px out at 45° → typed 10 ft @ 12 px/ft = 120 px lock.
    const cursor = { x: Math.cos(rad) * 200, y: Math.sin(rad) * 200 };

    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: [],
          constraintMode: "none",
          orthoPresetIndex: 4,
          drawingPoints: [anchor],
          scalePxPerFoot: 12,
          pendingDimLengthFt: 10,
        }),
      ),
    );

    const fakeStage = {
      getPointerPosition: () => cursor,
      getAbsoluteTransform: () => ({
        copy: () => ({
          invert: () => ({
            point: (p: { x: number; y: number }) => p,
          }),
        }),
      }),
    };
    const fakeEvent = { target: { getStage: () => fakeStage }, evt: {} };
    act(() => {
      result.current.handleStageMouseMove(fakeEvent as any);
    });

    expect(result.current.cursorPosition).not.toBeNull();
    expect(
      Math.hypot(
        result.current.cursorPosition!.x,
        result.current.cursorPosition!.y,
      ),
    ).toBeCloseTo(120, 4);
    expect(
      Math.atan2(
        result.current.cursorPosition!.y,
        result.current.cursorPosition!.x,
      ),
    ).toBeCloseTo(rad, 6);
  });
});
