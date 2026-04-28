// @vitest-environment jsdom
/**
 * Task #2331 — Lock down the live snap-stats lifecycle exposed by
 * `useTakeoffInteractions` for the on-canvas capture-quality HUD.
 *
 * `snapLogRef` already records one entry per committed vertex for the
 * post-commit `needs_review` rule. The HUD additionally needs the same
 * data mirrored into React state so it re-renders mid-draft. This
 * suite pins:
 *
 *   1. Initial state is empty (no draft → no readout).
 *   2. Each `resolvePoint` call increments `vertices`; matching snaps
 *      also increment `hits` and the `modeCounts` for that mode.
 *   3. A no-snap click (cursor outside snap range) increments
 *      `vertices` only — keeping the ratio honest.
 *   4. When `drawingPoints` empties (the user escaped a draft, the
 *      previous draft committed and was drained, the tool changed),
 *      the stats reset so a fresh draft starts clean.
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
  return {
    id,
    type,
    points: JSON.stringify(points),
  } as unknown as TakeoffMeasurement;
}

interface OverrideOpts {
  enabledSnapModes?: Parameters<typeof useTakeoffInteractions>[0]["enabledSnapModes"];
  drawingPoints?: Array<{ x: number; y: number }>;
  measurements?: TakeoffMeasurement[];
}

function buildParams(opts: OverrideOpts = {}): Parameters<typeof useTakeoffInteractions>[0] {
  const noop = () => {};
  return {
    projectId: "p1",
    selectedSheet: "s1",
    currentSheet: { id: "s1", scalePxPerFoot: 12 } as any,
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
    constraintMode: "none",
    orthoPresetIndex: 4,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Task #2331 — useTakeoffInteractions exposes live snapStats", () => {
  // Horizontal segment (0,0)→(100,0); endpoint snap is the easiest to
  // hit because it pulls anything within 12 px of either end.
  const seg = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it("starts empty before any vertex is committed", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({ enabledSnapModes: ["endpoint"], measurements: [makeMeasurement("m1", "LINEAR", seg)] }),
      ),
    );
    expect(result.current.snapStats).toEqual({ vertices: 0, hits: 0, modeCounts: {} });
  });

  it("counts a snap-hit vertex as both a hit and a mode-count entry", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    act(() => {
      // Cursor 1 px from the (0,0) endpoint → endpoint snap fires.
      result.current.resolvePoint({ x: 0.5, y: 0.5 });
    });
    expect(result.current.snapStats).toEqual({
      vertices: 1,
      hits: 1,
      modeCounts: { endpoint: 1 },
    });
  });

  it("counts a no-snap click as a vertex but not a hit", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint"],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    act(() => {
      // Far from every snap target — cursor passes through unchanged.
      result.current.resolvePoint({ x: 500, y: 500 });
    });
    expect(result.current.snapStats).toEqual({
      vertices: 1,
      hits: 0,
      modeCounts: {},
    });
  });

  it("aggregates multiple vertices and tallies modes by frequency", () => {
    const { result } = renderHook(() =>
      useTakeoffInteractions(
        buildParams({
          enabledSnapModes: ["endpoint", "midpoint"],
          measurements: [makeMeasurement("m1", "LINEAR", seg)],
        }),
      ),
    );
    act(() => {
      result.current.resolvePoint({ x: 0.5, y: 0.5 }); // endpoint
      result.current.resolvePoint({ x: 50, y: 1 }); // midpoint
      result.current.resolvePoint({ x: 50, y: 1 }); // midpoint again
      result.current.resolvePoint({ x: 500, y: 500 }); // miss
    });
    expect(result.current.snapStats.vertices).toBe(4);
    expect(result.current.snapStats.hits).toBe(3);
    expect(result.current.snapStats.modeCounts).toEqual({
      endpoint: 1,
      midpoint: 2,
    });
  });

  it("resets when drawingPoints empties (escape / tool change / post-commit drain)", () => {
    const { result, rerender } = renderHook(
      ({ drawingPoints }: { drawingPoints: Array<{ x: number; y: number }> }) =>
        useTakeoffInteractions(
          buildParams({
            enabledSnapModes: ["endpoint"],
            drawingPoints,
            measurements: [makeMeasurement("m1", "LINEAR", seg)],
          }),
        ),
      { initialProps: { drawingPoints: [{ x: 0, y: 0 }] } },
    );
    act(() => {
      result.current.resolvePoint({ x: 0.5, y: 0.5 });
    });
    expect(result.current.snapStats.vertices).toBe(1);
    // Emulate the parent dropping `drawingPoints` (Escape, tool swap,
    // commit cleanup). The stats must clear so the next draft starts
    // fresh — done-criteria says the HUD resets on cancel/commit.
    rerender({ drawingPoints: [] });
    expect(result.current.snapStats).toEqual({
      vertices: 0,
      hits: 0,
      modeCounts: {},
    });
  });
});
