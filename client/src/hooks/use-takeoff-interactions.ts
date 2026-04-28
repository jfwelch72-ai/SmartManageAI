import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import { canonicalTool, type Tool, type MeasurementType } from "@/components/takeoff/types";
import {
  computePixelDistance,
  computeDistanceInFeet,
  computePolygonAreaInFt2,
  computePolygonPerimeterInFt,
  computeVolumeInCY,
  inchesToFeet,
  createArcSegment,
  computePitchedLinearFt,
  computePitchedAreaFt2,
  computeLinearWithDropFt,
  isPointInPolygon,
  type Point,
} from "@shared/utils/geometry";
import {
  findSnapTargets,
  findNearestSnap,
  findPerpendicularSnap,
  findNearestSnapOnLine,
  applyOrthoLock,
  applyAngleConstraint,
  applyFixedLength,
  type SnapResult,
  type SnapMode,
  type SnapModeConfig,
} from "@/utils/snapping";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import type { ConstraintMode } from "@/components/takeoff/hosts/takeoff-shortcuts";
import { ORTHO_PRESETS } from "@/components/takeoff/hosts/takeoff-shortcuts";

interface UseTakeoffInteractionsParams {
  projectId: string;
  sheetsQueryKey?: string[];
  selectedSheet: string | null;
  currentSheet: TakeoffSheet | undefined;
  measurements: TakeoffMeasurement[];
  categories: QuantityCategory[];
  activeTool: Tool;
  setActiveTool: (t: Tool) => void;
  isDrawing: boolean;
  setIsDrawing: (v: boolean) => void;
  drawingPoints: { x: number; y: number }[];
  setDrawingPoints: (v: { x: number; y: number }[]) => void;
  currentDrawingTool: Tool | null;
  setCurrentDrawingTool: (v: Tool | null) => void;
  calibrationMode: "idle" | "first-point" | "second-point";
  setCalibrationMode: (v: "idle" | "first-point" | "second-point") => void;
  calibrationPoints: { x: number; y: number }[];
  setCalibrationPoints: (v: { x: number; y: number }[]) => void;
  calibrationDistance: string;
  setCalibrationDistance: (v: string) => void;
  units: "ft" | "m";
  stageScale: number;
  setStageScale: (v: number | ((prev: number) => number)) => void;
  stagePosition: { x: number; y: number };
  setStagePosition: (v: { x: number; y: number }) => void;
  selectedCategoryId: string | null;
  selectedMeasurementId: string | null;
  setSelectedMeasurementId: (v: string | null) => void;
  setSelectedSegmentIndex: (v: number | null) => void;
  notePosition: { x: number; y: number } | null;
  setNotePosition: (v: { x: number; y: number } | null) => void;
  setNoteDialogOpen: (v: boolean) => void;
  noteText: string;
  setNoteText: (v: string) => void;
  pitchRatio: string;
  dropDistance: string;
  verifyMode: "idle" | "first-point" | "second-point";
  setVerifyMode: (v: "idle" | "first-point" | "second-point") => void;
  verifyPoints: { x: number; y: number }[];
  setVerifyPoints: (v: { x: number; y: number }[]) => void;
  verifyExpectedDistance: string;
  setVerifyResult: (v: { expected: number; measured: number; errorPct: number } | null) => void;
  isSpacebarHeld: boolean;
  setIsSpacebarHeld: (v: boolean) => void;
  toolBeforeSpacebar: Tool | null;
  setToolBeforeSpacebar: (v: Tool | null) => void;
  isFullscreen: boolean;
  setIsFullscreen: (v: boolean) => void;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<any>;
  takeoffHistory: ReturnType<typeof useTakeoffHistory>;
  createMeasurementMutation: any;
  aggregatedMeasurements: any;
  setShortcutsDialogOpen: (v: boolean) => void;
  isMobile: boolean;
  deleteMeasurementMutation?: any;
  onZoomToFit?: () => void;
  sheetRotation: number;
  imageWidth: number;
  imageHeight: number;
  onRotateCW?: () => void;
  onRotateCCW?: () => void;
  structuralGridlines?: {
    horizontal: Array<{ label: string; position: number }>;
    vertical: Array<{ label: string; position: number }>;
  };
  showStructuralGridlines?: boolean;
  gridlineSnapThreshold?: number;
  /** Polar tracking step in degrees (used when
   *  `constraintMode === 'polar'`). Defaults to 15°. */
  polarAngleStep?: number;
  /** Typed-dimension input (Section 4): when set, the next vertex
   *  placed during a draw is locked to this length (in feet) along the
   *  current cursor direction from the previous vertex. The hook
   *  clears it after consumption via `onConsumeDimLength`. */
  pendingDimLengthFt?: number | null;
  onConsumeDimLength?: () => void;
  /** Task #2137 — When the standalone workspace mounts the unified
   *  ribbon, the new `useTakeoffShortcuts` hook becomes the single
   *  source of truth for tool / snap / constrain / navigation
   *  bindings. Set this to true so the legacy block below skips its
   *  window listener and the two handlers don't fight (e.g. `D` would
   *  otherwise still pick `linear_with_drop` from the old map). The
   *  drawing-time keys (Backspace/Enter while drawing) and
   *  Space-momentary-pan stay registered because they read canvas
   *  internals the ribbon doesn't see. */
  disableLegacyShortcuts?: boolean;
  /** Task #2192 — Granular snap-mode set owned by the unified ribbon.
   *  When provided, this is authoritative: only the listed modes
   *  contribute snap targets, and an empty array disables snapping
   *  entirely (without needing the legacy `snapEnabled` boolean).
   *  When undefined, the legacy `snapEnabled` toggle continues to
   *  drive on/off across all modes (backward compatible for callers
   *  that haven't adopted the unified ribbon yet). */
  enabledSnapModes?: SnapMode[];
  /** Task #2192 — Constraint group selection from the unified ribbon.
   *  `none` defers to the legacy `orthoLock` boolean (so the existing
   *  90° axis lock keeps working). `ortho` forces the 90° axis lock.
   *  `ortho-angle` engages the angular preset selected via
   *  `orthoPresetIndex` (15/30/45/90 → applyAngleConstraint). `polar`
   *  is reserved (placeholder in the ribbon — falls through to
   *  legacy ortho). */
  constraintMode?: ConstraintMode;
  /** Task #2192 — Index into `ORTHO_PRESETS`. Used only when
   *  `constraintMode === 'ortho-angle'`; a `null` preset (the
   *  trailing entry) means "off" and skips angular constraint. */
  orthoPresetIndex?: number;
  /** Task #2142 — Mobile / stylus precision pass. The two-finger
   *  rotate gesture is opt-in (default false) so accidental pinches
   *  don't rotate the sheet. When true, the pinch handler additionally
   *  applies the rotation delta around the gesture's center. */
  allowTwoFingerRotate?: boolean;
  /** Task #2142 — Palm rejection band (px). Touches with a contact
   *  size larger than this band are dropped while a stylus is in
   *  contact. Pen + mouse events are unaffected. */
  palmRejectionBandPx?: number;
}

function inverseRotatePoint(
  pt: Point,
  rotation: number,
  imgW: number,
  imgH: number
): Point {
  switch (rotation) {
    case 90: return { x: imgW - pt.y, y: pt.x };
    case 180: return { x: imgW - pt.x, y: imgH - pt.y };
    case 270: return { x: pt.y, y: imgH - pt.x };
    default: return pt;
  }
}

export function useTakeoffInteractions(params: UseTakeoffInteractionsParams) {
  const { toast } = useToast();

  const [mouseDownPosition, _setMouseDownPosition] = useState<{ x: number; y: number } | null>(null);
  const mouseDownPositionRef = useRef<{ x: number; y: number } | null>(null);
  const setMouseDownPosition = useCallback((pos: { x: number; y: number } | null) => {
    mouseDownPositionRef.current = pos;
    _setMouseDownPosition(pos);
  }, []);
  const CLICK_DRAG_THRESHOLD = 5;
  const [isDraggingStage, _setIsDraggingStage] = useState(false);
  const isDraggingStageRef = useRef(false);
  const setIsDraggingStage = useCallback((v: boolean) => {
    isDraggingStageRef.current = v;
    _setIsDraggingStage(v);
  }, []);
  const [snapEnabled, setSnapEnabled] = useState(() => {
    try { return localStorage.getItem("takeoff-snap-enabled") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("takeoff-snap-enabled", String(snapEnabled)); } catch {} }, [snapEnabled]);

  // Task #2206 follow-up — window-level pen tracker. Use capture-phase so
  // we observe pen pointerdown/up even if a child element calls
  // stopPropagation. We only care about pointerType === "pen"; finger and
  // mouse events are ignored here. Any tab-hide / window-blur clears the
  // set so the rejector cannot be permanently armed by a missed pointerup.
  useEffect(() => {
    const onPenDown = (e: PointerEvent) => {
      if (e.pointerType === "pen") activePenIdsRef.current.add(e.pointerId);
    };
    const onPenUp = (e: PointerEvent) => {
      if (e.pointerType === "pen") activePenIdsRef.current.delete(e.pointerId);
    };
    const reset = () => activePenIdsRef.current.clear();
    const onVisibility = () => { if (document.hidden) reset(); };
    window.addEventListener("pointerdown", onPenDown, true);
    window.addEventListener("pointerup", onPenUp, true);
    window.addEventListener("pointercancel", onPenUp, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onPenDown, true);
      window.removeEventListener("pointerup", onPenUp, true);
      window.removeEventListener("pointercancel", onPenUp, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const [orthoLock, setOrthoLock] = useState(() => {
    try { return localStorage.getItem("takeoff-ortho-lock") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("takeoff-ortho-lock", String(orthoLock)); } catch {} }, [orthoLock]);
  const [currentSnap, setCurrentSnap] = useState<SnapResult | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const [runningMeasurement, setRunningMeasurement] = useState<{ value: number; unit: string; segments?: number } | null>(null);
  const [selectedMeasurementIds, setSelectedMeasurementIds] = useState<Set<string>>(new Set());
  const shiftHeldRef = useRef(false);
  const lastInputTypeRef = useRef<"mouse" | "touch" | null>(null);
  const lastInputTimeRef = useRef<number>(0);
  const isPinchingRef = useRef(false);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  // Task #2206 follow-up — track which stylus pointers are currently in
  // contact with the screen at the document level. The canvas-level palm
  // rejection below only fires when at least one pen is active; without
  // this gate, normal fingertip taps on iPad (whose contact diameter
  // routinely exceeds 24 px) would always be dropped, breaking
  // finger-driven measurement entirely. Tracker self-heals on tab hide /
  // window blur so a missed `pointerup` (pen lifted out of hover range,
  // app-switch, etc.) does not leave the rejector stuck on.
  const activePenIdsRef = useRef<Set<number>>(new Set());

  const {
    projectId, sheetsQueryKey, selectedSheet, currentSheet, measurements, activeTool, setActiveTool,
    isDrawing, setIsDrawing, drawingPoints, setDrawingPoints, currentDrawingTool, setCurrentDrawingTool,
    calibrationMode, setCalibrationMode, calibrationPoints, setCalibrationPoints,
    calibrationDistance, setCalibrationDistance, units,
    stageScale, setStageScale, stagePosition, setStagePosition,
    selectedCategoryId, selectedMeasurementId, setSelectedMeasurementId, setSelectedSegmentIndex,
    notePosition, setNotePosition, setNoteDialogOpen, noteText, setNoteText,
    pitchRatio, dropDistance,
    verifyMode, setVerifyMode, verifyPoints, setVerifyPoints, verifyExpectedDistance, setVerifyResult,
    isSpacebarHeld, setIsSpacebarHeld, toolBeforeSpacebar, setToolBeforeSpacebar,
    isFullscreen, setIsFullscreen, workspaceRef, stageRef,
    takeoffHistory, createMeasurementMutation, aggregatedMeasurements,
    setShortcutsDialogOpen, isMobile,
    deleteMeasurementMutation, onZoomToFit,
    sheetRotation, imageWidth, imageHeight,
    onRotateCW, onRotateCCW,
    polarAngleStep,
    pendingDimLengthFt,
    onConsumeDimLength,
    disableLegacyShortcuts,
    enabledSnapModes, constraintMode, orthoPresetIndex,
    allowTwoFingerRotate = false,
    palmRejectionBandPx,
  } = params;
  // Task #2142 — Track the cumulative rotate delta during a single
  // pinch so we can apply discrete 90° rotations without accidentally
  // chaining multiple rotations from one continuous gesture. The ref
  // resets whenever the pinch ends.
  const pinchRotationAccumRef = useRef<number>(0);

  const handleToolSelect = useCallback((tool: Tool) => {
    setActiveTool(tool);
    if (isSpacebarHeld) {
      setToolBeforeSpacebar(null);
      setIsSpacebarHeld(false);
    }
    if (tool === "calibrate") {
      setCalibrationMode("first-point");
      setCalibrationPoints([]);
      toast({
        title: "Calibration Mode",
        description: "Click two points on a known distance to calibrate scale"
      });
    }
  }, [isSpacebarHeld, setActiveTool, setToolBeforeSpacebar, setIsSpacebarHeld, setCalibrationMode, setCalibrationPoints, toast]);

  /* Task #2192 — Translate the unified ribbon's per-mode snap selection
   * into the granular flags that `findSnapTargets` understands. When
   * the ribbon's `enabledSnapModes` prop is undefined, fall back to
   * legacy behaviour (the boolean `snapEnabled` toggles all modes at
   * once). When defined, the array is authoritative — including the
   * empty-array case, which collapses to "snapping disabled". The
   * `nearest` and `perpendicular` modes are surfaced in the ribbon but
   * resolved through different code paths (not via `findSnapTargets`),
   * so they're tracked here only to preserve the contract that
   * removing every mode kills snapping.
   */
  const snapModeConfig: SnapModeConfig | null = useMemo(() => {
    if (!enabledSnapModes) return null;
    return {
      endpoint: enabledSnapModes.includes("endpoint"),
      midpoint: enabledSnapModes.includes("midpoint"),
      intersection: enabledSnapModes.includes("intersection"),
      perpendicular: enabledSnapModes.includes("perpendicular"),
      center: enabledSnapModes.includes("center"),
      nearest: enabledSnapModes.includes("nearest"),
      grid: enabledSnapModes.includes("grid"),
    };
  }, [enabledSnapModes]);

  /* When the ribbon owns snap state, treat snapping as enabled iff at
   * least one mode is selected. Otherwise defer to the legacy toggle.
   * This is what closes the loop with the task's "removing all snap
   * modes disables snapping entirely" requirement. */
  const effectiveSnapEnabled = enabledSnapModes
    ? enabledSnapModes.length > 0
    : snapEnabled;

  const snapTargets = useMemo(
    () =>
      effectiveSnapEnabled
        ? findSnapTargets(measurements, snapModeConfig ?? undefined)
        : [],
    [measurements, effectiveSnapEnabled, snapModeConfig]
  );

  /* Task #2192 — Constraint mode resolution. The ribbon's radio-style
   * constraint group selects one of {none, ortho, ortho-angle, polar}
   * and pairs `ortho-angle` with `orthoPresetIndex` (15° / 30° / 45° /
   * 90° / null). We resolve to a single optional `angleStep` (degrees)
   * here so `resolvePoint` is straight-line. `angleStep === 90` means
   * use the dominant-axis lock (`applyOrthoLock`); any other positive
   * step uses the radial `applyAngleConstraint`. `null` means no
   * constraint. Polar is reserved/coming-soon, so for now it falls
   * through to the legacy axis lock if `orthoLock` is also engaged. */
  const angleStep: number | null = useMemo(() => {
    // When the ribbon owns constraint state, it's authoritative — the
    // legacy `orthoLock` boolean (which may be stale in localStorage
    // from a previous session) must NOT override an explicit ribbon
    // selection. Only fall back to `orthoLock` when `constraintMode`
    // is undefined (no ribbon mounted, pure legacy callers).
    if (constraintMode === undefined) {
      return orthoLock ? 90 : null;
    }
    if (constraintMode === "ortho-angle" && orthoPresetIndex != null) {
      const preset = ORTHO_PRESETS[orthoPresetIndex];
      return preset ?? null;
    }
    if (constraintMode === "ortho") return 90;
    if (constraintMode === "none") return null;
    // Task #2191 — `polar` mode locks the in-progress vertex to
    // multiples of `polarAngleStep` (default 15°) from the previous
    // anchor. Mathematically identical to an angular constraint, so
    // we route it through the same `applyAngleConstraint` path below.
    if (constraintMode === "polar") return polarAngleStep ?? 15;
    return null;
  }, [constraintMode, orthoPresetIndex, orthoLock, polarAngleStep]);

  /* Task #2199 — Polar tracking guide rays. The canvas renders thin
   * dashed rays from the active anchor at every multiple of the
   * active angular step so users can see which angle they're locked
   * onto before clicking. We emit a step for both the `ortho-angle`
   * preset family AND the dedicated `polar` mode (Task #2225 — without
   * this, enabling Polar lock from the ribbon snapped the cursor but
   * never painted the guides, leaving the lock invisible until commit).
   * Legacy `ortho` (axis lock) and the bare `orthoLock` boolean keep
   * their existing single-line preview and do NOT produce polar guides. */
  const polarGuideStep: number | null = useMemo(() => {
    if (constraintMode === "ortho-angle") {
      if (orthoPresetIndex == null) return null;
      const preset = ORTHO_PRESETS[orthoPresetIndex];
      return preset ?? null;
    }
    if (constraintMode === "polar") {
      // Mirror `angleStep`'s polar fallback so the guides render at the
      // same step the snap actually uses. Default 15° matches the
      // ribbon's polar-step default.
      return polarAngleStep ?? 15;
    }
    return null;
  }, [constraintMode, orthoPresetIndex, polarAngleStep]);

  const resolvePoint = useCallback(
    (rawPoint: Point): Point => {
      let pt = rawPoint;
      const anchor = drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : null;
      if (angleStep != null && anchor) {
        // 90° preserves the historical axis-aligned ortho lock; any
        // other angle (incl. polar's 15° step) is a true angular
        // constraint that preserves cursor distance from the anchor.
        pt = angleStep === 90
          ? applyOrthoLock(pt, anchor)
          : applyAngleConstraint(pt, anchor, angleStep);
      }
      // Task #2191 — Typed-dimension input. When the user has typed a
      // length, clamp the cursor to that length along the resolved
      // direction so the next click commits at the exact distance.
      // Applied BEFORE snapping so snap targets can still pull the
      // length-locked cursor onto a meaningful endpoint when one is in
      // range.
      if (pendingDimLengthFt && pendingDimLengthFt > 0 && anchor && currentSheet?.scalePxPerFoot) {
        const lengthPx = pendingDimLengthFt * currentSheet.scalePxPerFoot;
        pt = applyFixedLength(pt, anchor, lengthPx);
      }
      if (effectiveSnapEnabled) {
        // 1) Endpoint / midpoint / intersection / center snap (highest
        //    priority — matches the legacy behaviour exactly).
        if (snapTargets.length > 0) {
          const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
          if (snap.isSnapped) return snap.snappedPoint;
        }
        // 2) Task #2198 — Perpendicular snap. Drops the perpendicular
        //    foot from the in-progress draw anchor onto a nearby
        //    segment. Requires an anchor (so it's only meaningful
        //    while drawing). Only active when the unified ribbon
        //    explicitly enables this mode.
        if (snapModeConfig?.perpendicular && anchor) {
          const perp = findPerpendicularSnap(pt, anchor, measurements, 12, stageScale);
          if (perp.isSnapped) return perp.snappedPoint;
        }
        // 3) Task #2198 — Nearest-on-line snap. Lower priority than
        //    perpendicular because it always matches near any line;
        //    prevents nearest from "swallowing" a more meaningful
        //    perpendicular target. Only active when the ribbon
        //    explicitly enables this mode.
        if (snapModeConfig?.nearest) {
          const near = findNearestSnapOnLine(pt, measurements, 12, stageScale);
          if (near.isSnapped) return near.snappedPoint;
        }
      }
      // Structural gridline snap is gated on the `grid` snap mode when
      // the ribbon owns snap state (so unchecking Grid in the ribbon
      // turns it off without touching the structural-gridlines toggle
      // that drives rendering). When the ribbon isn't wired,
      // `snapModeConfig` is null and the legacy gridline-on behaviour
      // is preserved.
      const gridSnapAllowed = snapModeConfig
        ? snapModeConfig.grid !== false
        : true;
      if (
        gridSnapAllowed &&
        params.showStructuralGridlines &&
        params.structuralGridlines
      ) {
        const threshold = (params.gridlineSnapThreshold ?? 10) / stageScale;
        let snappedX = pt.x;
        let snappedY = pt.y;
        for (const gl of params.structuralGridlines.vertical) {
          if (Math.abs(pt.x - gl.position) < threshold) {
            snappedX = gl.position;
            break;
          }
        }
        for (const gl of params.structuralGridlines.horizontal) {
          if (Math.abs(pt.y - gl.position) < threshold) {
            snappedY = gl.position;
            break;
          }
        }
        if (snappedX !== pt.x || snappedY !== pt.y) {
          return { x: snappedX, y: snappedY };
        }
      }
      return pt;
    },
    [angleStep, pendingDimLengthFt, currentSheet?.scalePxPerFoot, effectiveSnapEnabled, snapTargets, snapModeConfig, drawingPoints, measurements, stageScale, params.showStructuralGridlines, params.structuralGridlines, params.gridlineSnapThreshold]
  );

  const completePolygon = useCallback(() => {
    if (!selectedSheet || !currentSheet?.scalePxPerFoot || drawingPoints.length < 3) {
      toast({ title: "Error", description: "Need at least 3 points for polygon", variant: "destructive" });
      return;
    }

    const areaFt2 = computePolygonAreaInFt2(drawingPoints, currentSheet.scalePxPerFoot);
    const perimeterFt = computePolygonPerimeterInFt(drawingPoints, currentSheet.scalePxPerFoot);

    // Ribbon aliases (e.g. polygon → area) must commit through the
    // canonical tool — otherwise closing a polygon would silently
    // skip the mutation and leave the canvas in an in-progress state.
    const completeTool = canonicalTool(activeTool);
    if (completeTool === "area") {
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "AREA",
        points: drawingPoints,
        label: `Area ${aggregatedMeasurements.byType.area.length + 1}`,
        categoryId: selectedCategoryId,
        computedAreaFt2: areaFt2,
        metadata: JSON.stringify({ perimeterFt }),
      });
      toast({ title: "Area Measurement Created", description: `${areaFt2.toFixed(2)} SF | ${perimeterFt.toFixed(2)} LF perimeter` });
    } else if (completeTool === "volume") {
      const defaultDepthInches = 12;
      const depthFt = inchesToFeet(defaultDepthInches);
      const volumeCy = computeVolumeInCY(areaFt2, depthFt);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "VOLUME",
        points: drawingPoints,
        label: `Volume ${aggregatedMeasurements.byType.volume.length + 1}`,
        depthFeet: depthFt,
        categoryId: selectedCategoryId,
        computedAreaFt2: areaFt2,
        computedVolumeCy: volumeCy,
        metadata: JSON.stringify({ perimeterFt }),
      });
      toast({ title: "Volume Measurement Created", description: `${areaFt2.toFixed(2)} SF @ ${defaultDepthInches}" depth = ${volumeCy.toFixed(2)} CY` });
    } else if (completeTool === "pitched_area") {
      const pitchedArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "PITCHED_AREA",
        points: drawingPoints,
        label: `Pitched Area ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedAreaFt2: areaFt2,
        computedSurfaceAreaFt2: pitchedArea,
        metadata: JSON.stringify({ perimeterFt }),
      });
      toast({ title: "Pitched Area Created", description: `Flat: ${areaFt2.toFixed(2)} SF → Pitched (${pitchRatio}): ${pitchedArea.toFixed(2)} SF` });
    } else if (completeTool === "surface_area") {
      const surfaceArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "SURFACE_AREA",
        points: drawingPoints,
        label: `Surface ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedAreaFt2: areaFt2,
        computedSurfaceAreaFt2: surfaceArea,
        metadata: JSON.stringify({ perimeterFt }),
      });
      toast({ title: "Surface Area Created", description: `Flat: ${areaFt2.toFixed(2)} SF → Surface (${pitchRatio}): ${surfaceArea.toFixed(2)} SF` });
    }

    setIsDrawing(false);
    setDrawingPoints([]);
  }, [selectedSheet, currentSheet, drawingPoints, activeTool, selectedCategoryId, pitchRatio, measurements.length, aggregatedMeasurements, createMeasurementMutation, setIsDrawing, setDrawingPoints, toast]);

  const completeSegment = useCallback(() => {
    if (!selectedSheet || !currentSheet?.scalePxPerFoot || drawingPoints.length < 2) {
      toast({ title: "Error", description: "Need at least 2 points for a segment measurement", variant: "destructive" });
      return;
    }

    const segmentProperties: Array<{ label: string; color: string; unitCost?: number; costCodeId?: string; categoryId?: string }> = [];
    const segmentColors = ["#2563eb", "#dc2626", "#16a34a", "#ea580c", "#8b5cf6", "#0891b2", "#d97706", "#be185d"];
    let totalLengthFt = 0;

    for (let i = 0; i < drawingPoints.length - 1; i++) {
      const segLen = computeDistanceInFeet([drawingPoints[i], drawingPoints[i + 1]], currentSheet.scalePxPerFoot);
      totalLengthFt += segLen;
      segmentProperties.push({
        label: `Seg ${i + 1}`,
        color: segmentColors[i % segmentColors.length],
      });
    }

    createMeasurementMutation.mutate({
      sheetId: selectedSheet,
      type: "SEGMENT",
      points: drawingPoints,
      label: `Segment ${(aggregatedMeasurements.byType.segment?.length || 0) + 1}`,
      categoryId: selectedCategoryId,
      computedLengthFt: totalLengthFt,
      metadata: JSON.stringify({ segmentProperties }),
    });
    toast({ title: "Segment Created", description: `${drawingPoints.length - 1} segments, ${totalLengthFt.toFixed(2)} LF total` });

    setIsDrawing(false);
    setDrawingPoints([]);
  }, [selectedSheet, currentSheet, drawingPoints, selectedCategoryId, aggregatedMeasurements, createMeasurementMutation, setIsDrawing, setDrawingPoints, toast]);

  const handleStageClick = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    const transform = stage.getAbsoluteTransform().copy().invert();
    let point = inverseRotatePoint(transform.point(pointerPosition), sheetRotation, imageWidth, imageHeight);

    // Ribbon aliases (lasso → select, polygon → area, circle → arc,
    // dimension → linear) share canvas behavior with their canonical
    // tool. Compute once so every branch below dispatches on the
    // canonical tool while the ribbon highlight tracks the user's
    // explicit pick.
    const tool = canonicalTool(activeTool);
    const isDrawingTool = ["linear", "arc", "circle", "area", "volume", "count", "segment", "deduct"].includes(tool);
    if (isDrawingTool) {
      point = resolvePoint(point);
      if (navigator.vibrate) navigator.vibrate(10);
    }

    if (tool === "select") {
      if (e.target === stage) {
        setSelectedMeasurementId(null);
        setSelectedSegmentIndex(null);
        setSelectedMeasurementIds(new Set());
      }
      return;
    }

    if (verifyMode === "first-point") {
      setVerifyPoints([point]);
      setVerifyMode("second-point");
      toast({ title: "First Point Set", description: "Click second point to complete verification" });
      return;
    } else if (verifyMode === "second-point") {
      const newPoints = [verifyPoints[0], point];
      setVerifyPoints(newPoints);
      setVerifyMode("idle");
      const expectedDist = parseFloat(verifyExpectedDistance);
      if (expectedDist > 0 && currentSheet?.scalePxPerFoot) {
        const pxDist = computePixelDistance(newPoints[0], newPoints[1]);
        const measuredDist = pxDist / currentSheet.scalePxPerFoot;
        const errorPct = Math.abs(measuredDist - expectedDist) / expectedDist * 100;
        setVerifyResult({ expected: expectedDist, measured: measuredDist, errorPct });
      } else {
        toast({ title: "Error", description: "Enter an expected distance before verifying", variant: "destructive" });
      }
      return;
    }

    if (tool === "calibrate") {
      if (calibrationMode === "first-point") {
        setCalibrationPoints([point]);
        setCalibrationMode("second-point");
        toast({ title: "First Point Set", description: "Click second point to complete calibration" });
      } else if (calibrationMode === "second-point") {
        const newPoints = [...calibrationPoints, point];
        setCalibrationPoints(newPoints);
        const pixelDistance = computePixelDistance(newPoints[0], newPoints[1]);
        toast({ title: "Calibration Complete", description: `Enter the real-world distance (${pixelDistance.toFixed(2)} pixels measured)` });
      }
    } else if (tool === "linear") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
      } else {
        const newPoints = [...drawingPoints, point];
        const lengthFt = computeDistanceInFeet(newPoints, currentSheet.scalePxPerFoot);
        createMeasurementMutation.mutate({
          sheetId: selectedSheet, type: "LINEAR", points: newPoints,
          label: `Line ${measurements.length + 1}`, categoryId: selectedCategoryId,
        });
        setDrawingPoints([point]);
        setRunningMeasurement(null);
        toast({ title: "Measurement Created", description: `${lengthFt.toFixed(2)} LF — click next point or Esc to stop` });
      }
    } else if (activeTool === "linear_with_drop" || activeTool === "pitched_linear") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
      } else {
        const newPoints = [...drawingPoints, point];
        const baseLengthFt = computeDistanceInFeet(newPoints, currentSheet.scalePxPerFoot);
        let finalLength = baseLengthFt;
        let measureType: MeasurementType = activeTool === "linear_with_drop" ? "LINEAR_WITH_DROP" : "PITCHED_LINEAR";
        if (activeTool === "linear_with_drop") {
          const drop = parseFloat(dropDistance) || 0;
          finalLength = computeLinearWithDropFt(baseLengthFt, drop);
        } else {
          finalLength = computePitchedLinearFt(baseLengthFt, pitchRatio);
        }
        createMeasurementMutation.mutate({
          sheetId: selectedSheet, type: measureType, points: newPoints,
          label: `${activeTool === "linear_with_drop" ? "Drop" : "Pitched"} Line ${measurements.length + 1}`,
          categoryId: selectedCategoryId,
          pitchRatio: activeTool === "pitched_linear" ? pitchRatio : undefined,
          computedLengthFt: finalLength,
        });
        setIsDrawing(false);
        setDrawingPoints([]);
        toast({ title: "Measurement Created", description: `${finalLength.toFixed(2)} LF (${activeTool === "linear_with_drop" ? `drop: ${dropDistance || 0} ft` : `pitch: ${pitchRatio}`})` });
      }
    } else if (tool === "arc") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setCurrentDrawingTool("arc");
        setDrawingPoints([point]);
        toast({ title: "Arc Tool", description: "Click second point (middle) to define curvature" });
      } else if (drawingPoints.length === 1) {
        setDrawingPoints([...drawingPoints, point]);
        toast({ title: "Arc Tool", description: "Click third point (end) to complete arc" });
      } else if (drawingPoints.length === 2) {
        const [startPoint, middlePoint] = drawingPoints;
        const endPoint = point;
        const arcSegment = createArcSegment(startPoint, endPoint, middlePoint, currentSheet.scalePxPerFoot);
        if (!arcSegment) {
          toast({ title: "Error", description: "Points are collinear - cannot form arc. Try different points.", variant: "destructive" });
          setIsDrawing(false);
          setCurrentDrawingTool(null);
          setDrawingPoints([]);
          return;
        }
        const existingArcs = measurements.filter(m => {
          if (m.type !== "LINEAR") return false;
          const pts = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
          return pts.length === 3;
        });
        createMeasurementMutation.mutate({
          sheetId: selectedSheet, type: "LINEAR" as const,
          points: [startPoint, middlePoint, endPoint],
          label: `Arc ${existingArcs.length + 1}`, categoryId: selectedCategoryId,
        });
        setIsDrawing(false);
        setCurrentDrawingTool(null);
        setDrawingPoints([]);
        toast({ title: "Arc Created", description: `${arcSegment.arcLength.toFixed(2)} LF` });
      }
    } else if (tool === "circle") {
      // Center + radius circle. First click sets the center; second click
      // sets a point on the edge. The result is persisted as an AREA
      // measurement using a 32-sided polygon approximation so existing
      // area math, deductions, and renderers all work unchanged.
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setCurrentDrawingTool("arc");
        setDrawingPoints([point]);
        toast({ title: "Circle Tool", description: "Click the edge to set the radius." });
      } else if (drawingPoints.length === 1) {
        const center = drawingPoints[0];
        const radiusPx = computePixelDistance(center, point);
        if (radiusPx < 1) {
          toast({ title: "Radius too small", description: "Click farther from the center to define a circle.", variant: "destructive" });
          return;
        }
        const sides = 32;
        const polygon: Point[] = [];
        for (let i = 0; i < sides; i++) {
          const theta = (i / sides) * 2 * Math.PI;
          polygon.push({ x: center.x + radiusPx * Math.cos(theta), y: center.y + radiusPx * Math.sin(theta) });
        }
        const radiusFt = radiusPx / currentSheet.scalePxPerFoot;
        const areaFt2 = Math.PI * radiusFt * radiusFt;
        const perimeterFt = 2 * Math.PI * radiusFt;
        createMeasurementMutation.mutate({
          sheetId: selectedSheet,
          type: "AREA",
          points: polygon,
          label: `Circle ${aggregatedMeasurements.byType.area.length + 1}`,
          categoryId: selectedCategoryId,
          computedAreaFt2: areaFt2,
          metadata: JSON.stringify({ perimeterFt, shape: "circle", radiusFt, center }),
        });
        setIsDrawing(false);
        setCurrentDrawingTool(null);
        setDrawingPoints([]);
        toast({ title: "Circle Created", description: `r = ${radiusFt.toFixed(2)} ft → ${areaFt2.toFixed(2)} SF` });
      }
    } else if (tool === "area" || tool === "volume" || tool === "pitched_area" || tool === "surface_area") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
        toast({ title: "Drawing Polygon", description: "Click to add points. Click first point to close polygon." });
      } else {
        if (drawingPoints.length >= 3) {
          const firstPoint = drawingPoints[0];
          const distance = computePixelDistance(point, firstPoint);
          if (distance < 10) { completePolygon(); return; }
        }
        setDrawingPoints([...drawingPoints, point]);
      }
    } else if (tool === "deduct") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!selectedMeasurementId) { toast({ title: "Select Area First", description: "Select an area measurement to add a deduct polygon", variant: "destructive" }); return; }
      const targetM = measurements.find(m => m.id === selectedMeasurementId);
      if (!targetM || !["AREA", "PITCHED_AREA", "SURFACE_AREA", "VOLUME"].includes(targetM.type)) {
        toast({ title: "Invalid Target", description: "Select an area or volume measurement to add deducts", variant: "destructive" });
        return;
      }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
        toast({ title: "Drawing Deduct", description: "Click to add points. Click first point to close deduct polygon." });
      } else {
        if (drawingPoints.length >= 3) {
          const firstPoint = drawingPoints[0];
          const distance = computePixelDistance(point, firstPoint);
          if (distance < 10) {
            const hostPoints: Point[] = (() => {
              try {
                const pts = targetM.points ? (typeof targetM.points === "string" ? JSON.parse(targetM.points) : targetM.points) : [];
                return Array.isArray(pts) ? pts : [];
              } catch { return []; }
            })();
            if (hostPoints.length >= 3) {
              const deductCentroid: Point = {
                x: drawingPoints.reduce((s, p) => s + p.x, 0) / drawingPoints.length,
                y: drawingPoints.reduce((s, p) => s + p.y, 0) / drawingPoints.length,
              };
              if (!isPointInPolygon(deductCentroid, hostPoints)) {
                toast({ title: "Invalid Deduction", description: "Deduct polygon must be inside the parent measurement area", variant: "destructive" });
                setIsDrawing(false);
                setDrawingPoints([]);
                return;
              }
            }
            const deductAreaFt2 = computePolygonAreaInFt2(drawingPoints, currentSheet.scalePxPerFoot);
            const existingDeductions: Array<{ points: { x: number; y: number }[]; areaFt2: number; label?: string }> = (() => {
              try {
                const parsed = targetM.deductions ? JSON.parse(targetM.deductions as string) : [];
                return Array.isArray(parsed) ? parsed : [];
              } catch { return []; }
            })();
            const newDeduction = {
              points: drawingPoints,
              areaFt2: deductAreaFt2,
              label: `Deduct ${existingDeductions.length + 1}`,
            };
            const updatedDeductions = [...existingDeductions, newDeduction];
            setIsDrawing(false);
            setDrawingPoints([]);
            apiRequest("PATCH", `/api/takeoff/measurements/${targetM.id}`, {
              deductions: JSON.stringify(updatedDeductions),
            }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
              toast({ title: "Deduct Added", description: `${deductAreaFt2.toFixed(2)} SF deducted` });
            }).catch(() => {
              toast({ title: "Error", description: "Failed to save deduction", variant: "destructive" });
            });
            return;
          }
        }
        setDrawingPoints([...drawingPoints, point]);
      }
    } else if (tool === "segment") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      if (!currentSheet?.scalePxPerFoot) { toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" }); return; }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
        toast({ title: "Segment Tool", description: "Click to add segment points. Double-click or press Enter to finish." });
      } else {
        setDrawingPoints([...drawingPoints, point]);
      }
    } else if (tool === "count") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      createMeasurementMutation.mutate({
        sheetId: selectedSheet, type: "COUNT", points: [point],
        label: `Count ${aggregatedMeasurements.byType.count.length + 1}`, categoryId: selectedCategoryId,
      });
    } else if (tool === "note") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      setNotePosition(point);
      setNoteDialogOpen(true);
    }

    // Section 4 — typed-dimension input is single-shot. Once a draw
    // click has consumed the length lock, clear it so the next vertex
    // is free.
    if (isDrawingTool && pendingDimLengthFt && pendingDimLengthFt > 0) {
      onConsumeDimLength?.();
    }
  }, [activeTool, resolvePoint, verifyMode, verifyPoints, verifyExpectedDistance, calibrationMode, calibrationPoints,
    isDrawing, drawingPoints, selectedSheet, currentSheet, measurements, selectedCategoryId, pitchRatio, dropDistance,
    aggregatedMeasurements, createMeasurementMutation, completePolygon, pendingDimLengthFt, onConsumeDimLength,
    setSelectedMeasurementId, setVerifyPoints, setVerifyMode, setVerifyResult,
    setCalibrationPoints, setCalibrationMode, setIsDrawing, setDrawingPoints, setCurrentDrawingTool,
    setNotePosition, setNoteDialogOpen, toast, sheetRotation, imageWidth, imageHeight]);

  const handleStageMouseDown = useCallback((e: any) => {
    const isTouchEvent = e.evt && (e.evt.type === "touchstart" || e.evt.touches);
    const now = Date.now();
    if (isTouchEvent) {
      e.evt.preventDefault();
      lastInputTypeRef.current = "touch";
      lastInputTimeRef.current = now;
      // Task #2142 — Palm rejection on the takeoff canvas. When more
      // than two touches land at once, only the first two are
      // legitimately the pinch gesture; any extra contacts are palm
      // rest. We also drop the lone touch when its contact dimension
      // exceeds the per-user palm band, which happens on iPad / Surface
      // when the user rests their hand while drawing with a stylus.
      //
      // Task #2206 follow-up — gate the single-touch rejector on
      // `activePenIdsRef` so we only drop fat finger contacts while a
      // stylus is *actually* in contact. Without this gate, plain
      // fingertip taps on iPad (typical contact diameter 30–60 px) were
      // unconditionally rejected against the 24 px default band, which
      // made finger-driven measurement appear broken even with no pen
      // anywhere near the screen.
      const band = typeof palmRejectionBandPx === "number" ? palmRejectionBandPx : 24;
      const penActive = activePenIdsRef.current.size > 0;
      if (penActive && e.evt.touches && e.evt.touches.length === 1) {
        const t = e.evt.touches[0];
        const size = Math.max(
          t.radiusX ? t.radiusX * 2 : 0,
          t.radiusY ? t.radiusY * 2 : 0,
        );
        if (size > band) {
          setMouseDownPosition(null);
          return;
        }
      }
      if (e.evt.touches && e.evt.touches.length >= 2) {
        isPinchingRef.current = true;
        pinchRotationAccumRef.current = 0;
        setMouseDownPosition(null);
        return;
      }
    } else {
      if (lastInputTypeRef.current === "touch" && now - lastInputTimeRef.current < 500) return;
      lastInputTypeRef.current = "mouse";
    }
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) return;
    setMouseDownPosition(pointerPosition);
  }, [palmRejectionBandPx, setMouseDownPosition]);

  const handleStageMouseUp = useCallback((e: any) => {
    const isTouchEvent = e.evt && (e.evt.type === "touchend" || e.evt.changedTouches);
    const now = Date.now();
    if (isTouchEvent) {
      e.evt.preventDefault();
      lastInputTypeRef.current = "touch";
      lastInputTimeRef.current = now;
    } else {
      if (lastInputTypeRef.current === "touch" && now - lastInputTimeRef.current < 500) return;
      lastInputTypeRef.current = "mouse";
    }
    const mdp = mouseDownPositionRef.current;
    if (!mdp) return;
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    setMouseDownPosition(null);
    if (!pointerPosition) return;
    if (isDraggingStageRef.current) return;
    const deltaX = pointerPosition.x - mdp.x;
    const deltaY = pointerPosition.y - mdp.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance < CLICK_DRAG_THRESHOLD) {
      handleStageClick(e);
    }
  }, [handleStageClick, setMouseDownPosition]);

  const handleStageDragStart = useCallback(() => { setIsDraggingStage(true); }, []);

  const handleStageDragMove = useCallback((e: any) => {
    if (activeTool !== "pan") return;
    const stage = e.target;
    setStagePosition({ x: stage.x(), y: stage.y() });
  }, [activeTool, setStagePosition]);

  const handleStageDragEnd = useCallback(() => { setIsDraggingStage(false); }, []);

  const handleStageMouseMove = useCallback((e: any) => {
    if (e.evt && (e.evt.type === "touchmove" || e.evt.touches)) {
      e.evt.preventDefault();
    }
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const transform = stage.getAbsoluteTransform().copy().invert();
    let pt: Point = inverseRotatePoint(transform.point(pointer), sheetRotation, imageWidth, imageHeight);
    // Mirror `resolvePoint`'s constraint resolution so the live cursor
    // preview, current-snap HUD, and running-measurement readout are
    // driven by the same unified-ribbon state as the committed point.
    const moveAnchor = drawingPoints.length > 0 ? drawingPoints[drawingPoints.length - 1] : null;
    if (angleStep != null && moveAnchor) {
      pt = angleStep === 90
        ? applyOrthoLock(pt, moveAnchor)
        : applyAngleConstraint(pt, moveAnchor, angleStep);
    }
    if (pendingDimLengthFt && pendingDimLengthFt > 0 && moveAnchor && currentSheet?.scalePxPerFoot) {
      pt = applyFixedLength(pt, moveAnchor, pendingDimLengthFt * currentSheet.scalePxPerFoot);
    }
    setCursorPosition(pt);
    // Mirror `resolvePoint`'s priority order so the HUD/badge highlight
    // matches whichever snap will actually be applied on click. Higher
    // priority wins: endpoint/midpoint/intersection/center →
    // perpendicular → nearest. (Grid snaps don't surface in the HUD.)
    let liveSnap: SnapResult | null = null;
    if (effectiveSnapEnabled) {
      if (snapTargets.length > 0) {
        const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
        if (snap.isSnapped) liveSnap = snap;
      }
      if (!liveSnap && snapModeConfig?.perpendicular && drawingPoints.length > 0) {
        const anchor = drawingPoints[drawingPoints.length - 1];
        const perp = findPerpendicularSnap(pt, anchor, measurements, 12, stageScale);
        if (perp.isSnapped) liveSnap = perp;
      }
      if (!liveSnap && snapModeConfig?.nearest) {
        const near = findNearestSnapOnLine(pt, measurements, 12, stageScale);
        if (near.isSnapped) liveSnap = near;
      }
    }
    setCurrentSnap(liveSnap);

    if (isDrawing && drawingPoints.length > 0 && currentSheet?.scalePxPerFoot) {
      const scale = currentSheet.scalePxPerFoot;
      const allPts = [...drawingPoints, pt];
      const moveTool = canonicalTool(activeTool);
      if (moveTool === "circle" && drawingPoints.length === 1) {
        const radiusPx = computePixelDistance(drawingPoints[0], pt);
        const radiusFt = radiusPx / scale;
        const areaFt2 = Math.PI * radiusFt * radiusFt;
        setRunningMeasurement({ value: areaFt2, unit: "SF", segments: 2 * Math.PI * radiusFt });
      } else if (moveTool === "linear" || moveTool === "linear_with_drop" || moveTool === "pitched_linear") {
        const len = computeDistanceInFeet(allPts, scale);
        setRunningMeasurement({ value: len, unit: "LF" });
      } else if (moveTool === "segment") {
        let total = 0;
        for (let i = 0; i < allPts.length - 1; i++) {
          total += computeDistanceInFeet([allPts[i], allPts[i + 1]], scale);
        }
        setRunningMeasurement({ value: total, unit: "LF", segments: allPts.length - 1 });
      } else if (moveTool === "area" || moveTool === "volume" || moveTool === "pitched_area" || moveTool === "surface_area") {
        if (allPts.length >= 3) {
          const area = computePolygonAreaInFt2(allPts, scale);
          const perim = computePolygonPerimeterInFt(allPts, scale);
          setRunningMeasurement({ value: area, unit: "SF", segments: perim });
        } else {
          const len = computeDistanceInFeet(allPts, scale);
          setRunningMeasurement({ value: len, unit: "LF" });
        }
      }
    } else if (!isDrawing && runningMeasurement) {
      setRunningMeasurement(null);
    }
  }, [effectiveSnapEnabled, snapTargets, snapModeConfig, measurements, stageScale, angleStep, pendingDimLengthFt, drawingPoints, sheetRotation, imageWidth, imageHeight, isDrawing, currentSheet, activeTool, runningMeasurement]);

  const handleWheel = useCallback((e: any) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const MIN_SCALE = 0.1;
    const MAX_SCALE = 10;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    setStageScale(newScale);
    setStagePosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, [setStageScale, setStagePosition]);

  const lastPinchAngleRef = useRef<number | null>(null);
  const handleTouchMove = useCallback((e: any) => {
    const touches = e.evt?.touches;
    if (!touches || touches.length < 2) {
      lastPinchDistRef.current = null;
      lastPinchCenterRef.current = null;
      lastPinchAngleRef.current = null;
      if (!isPinchingRef.current) handleStageMouseMove(e);
      return;
    }
    isPinchingRef.current = true;
    setMouseDownPosition(null);
    e.evt.preventDefault();
    const t1 = touches[0];
    const t2 = touches[1];
    const dist = Math.sqrt(Math.pow(t2.clientX - t1.clientX, 2) + Math.pow(t2.clientY - t1.clientY, 2));
    const center = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    // Task #2142 — Track the angle between the two touches so we can
    // optionally apply a rotation delta (gated behind the per-user
    // "Allow two-finger rotate" preference). Default-off so accidental
    // pinch rotations don't spin the sheet.
    const angle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    if (lastPinchDistRef.current !== null && lastPinchCenterRef.current !== null) {
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      const stageCenter = { x: center.x - container.left, y: center.y - container.top };
      const oldScale = stageScale;
      const scaleFactor = dist / lastPinchDistRef.current;
      let newScale = oldScale * scaleFactor;
      newScale = Math.max(0.1, Math.min(10, newScale));
      const mousePointTo = {
        x: (stageCenter.x - stagePosition.x) / oldScale,
        y: (stageCenter.y - stagePosition.y) / oldScale,
      };
      const dx = center.x - lastPinchCenterRef.current.x;
      const dy = center.y - lastPinchCenterRef.current.y;
      setStageScale(newScale);
      setStagePosition({
        x: stageCenter.x - mousePointTo.x * newScale + dx,
        y: stageCenter.y - mousePointTo.y * newScale + dy,
      });

      // Task #2142 — Apply 90° sheet rotation when the user has opted
      // in and the cumulative pinch rotation crosses a quarter turn.
      // Discrete 90° steps prevent fine-grained drift; the canvas only
      // supports the four cardinal orientations (sheetRotation 0/90/
      // 180/270) so anything between is meaningless. We accumulate the
      // signed rotation delta across the lifetime of one pinch, then
      // fire onRotateCW / onRotateCCW once for every full π/2 it
      // crosses, decrementing the accumulator by the same amount so
      // multi-step rotations within one gesture stay possible.
      if (allowTwoFingerRotate && lastPinchAngleRef.current !== null) {
        let dAngle = angle - lastPinchAngleRef.current;
        // Normalize to the shortest path so the wrap-around at ±π
        // doesn't register as a near-full revolution.
        if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
        if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
        pinchRotationAccumRef.current += dAngle;
        const QUARTER = Math.PI / 2;
        while (pinchRotationAccumRef.current >= QUARTER) {
          pinchRotationAccumRef.current -= QUARTER;
          if (typeof onRotateCW === "function") onRotateCW();
        }
        while (pinchRotationAccumRef.current <= -QUARTER) {
          pinchRotationAccumRef.current += QUARTER;
          if (typeof onRotateCCW === "function") onRotateCCW();
        }
      }
    }
    lastPinchDistRef.current = dist;
    lastPinchCenterRef.current = center;
    lastPinchAngleRef.current = angle;
  }, [stageScale, stagePosition, stageRef, handleStageMouseMove, setStageScale, setStagePosition, allowTwoFingerRotate, onRotateCW, onRotateCCW, setMouseDownPosition]);

  const handleTouchEnd = useCallback((e: any) => {
    const touches = e.evt?.touches;
    if (!touches || touches.length < 2) {
      lastPinchDistRef.current = null;
      lastPinchCenterRef.current = null;
      // Task #2142 — Reset rotate-gesture bookkeeping so the next
      // two-finger gesture starts from a fresh angle baseline.
      lastPinchAngleRef.current = null;
      pinchRotationAccumRef.current = 0;
    }
    if (isPinchingRef.current) {
      if (!touches || touches.length === 0) isPinchingRef.current = false;
      return;
    }
    handleStageMouseUp(e);
  }, [handleStageMouseUp]);

  const handleSaveNote = useCallback(() => {
    if (!noteText.trim() || !notePosition || !selectedSheet) {
      toast({ title: "Error", description: "Enter note text", variant: "destructive" });
      return;
    }
    createMeasurementMutation.mutate({
      sheetId: selectedSheet, type: "NOTE", points: [notePosition], label: noteText,
    });
    toast({ title: "Note Added", description: "Note saved successfully" });
    setNoteDialogOpen(false);
    setNoteText("");
    setNotePosition(null);
  }, [noteText, notePosition, selectedSheet, createMeasurementMutation, setNoteDialogOpen, setNoteText, setNotePosition, toast]);

  // Returns `true` only when the PATCH lands and state has been
  // reset, so callers (notably the inline drawer in
  // `TakeoffWorkspace`) can keep the drawer open on validation /
  // network failure for retry. Task #2140 round-7 review explicitly
  // called out the previous unconditional-close behavior as a UX
  // regression.
  const handleSaveCalibration = useCallback(async (distanceOverrideFt?: number): Promise<boolean> => {
    if (!selectedSheet || calibrationPoints.length !== 2) {
      toast({ title: "Error", description: "Complete calibration first", variant: "destructive" });
      return false;
    }
    // The new InlineCalibrationDrawer passes the parsed numeric
    // distance (always feet) directly so we don't have to read it
    // back from `calibrationDistance` state, which races the
    // upstream `setCalibrationDistance` and the closure baked into
    // this useCallback. Older callers still drive the legacy
    // string-typed state, so fall back to that when no override is
    // provided.
    const usingOverride =
      typeof distanceOverrideFt === "number" && Number.isFinite(distanceOverrideFt);
    if (!usingOverride && !calibrationDistance) {
      toast({ title: "Error", description: "Complete calibration first", variant: "destructive" });
      return false;
    }
    const distanceValue = usingOverride
      ? (distanceOverrideFt as number)
      : parseFloat(calibrationDistance.trim());
    if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
      toast({ title: "Error", description: "Please enter a valid distance value", variant: "destructive" });
      return false;
    }
    // Override is always in feet; legacy state is in active `units`.
    // Normalize the min-distance check accordingly.
    const minDistance = usingOverride
      ? 0.5
      : units === "ft"
        ? 0.5
        : 0.15;
    if (distanceValue < minDistance) {
      toast({
        title: "Error",
        description: `Distance must be at least ${minDistance} ${usingOverride ? "ft" : units}. For small details, use a larger reference distance.`,
        variant: "destructive",
      });
      return false;
    }
    const pixelDistance = computePixelDistance(calibrationPoints[0], calibrationPoints[1]);
    const scalePxPerFoot = usingOverride
      ? pixelDistance / distanceValue
      : units === "ft"
        ? pixelDistance / distanceValue
        : pixelDistance / (distanceValue * 3.28084);
    if (!Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      toast({ title: "Error", description: "Invalid calibration value. Please check your measurements.", variant: "destructive" });
      return false;
    }
    try {
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot, units });
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
      // Surface the resulting scale so the user can verify the
      // calibration landed where they expected (Task #2140 done
      // criteria: "Scale set: …").
      toast({
        title: "Scale set",
        description: `Scale set: ${scalePxPerFoot.toFixed(2)} px/ft`,
      });
      setCalibrationMode("idle");
      setCalibrationPoints([]);
      setCalibrationDistance("");
      setActiveTool("select");
      return true;
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to save calibration";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
      return false;
    }
  }, [selectedSheet, calibrationPoints, calibrationDistance, units, projectId, sheetsQueryKey, setCalibrationMode, setCalibrationPoints, setCalibrationDistance, setActiveTool, toast]);

  const handleApplyPresetScale = useCallback(async (scaleCategory: string, selectedPresetScale: string, resetScaleState: () => void) => {
    if (!selectedSheet || !selectedPresetScale || !scaleCategory) {
      toast({ title: "Error", description: "Please select a scale", variant: "destructive" });
      return;
    }
    const category = (COMMON_SCALES as any)[scaleCategory];
    const scale = category?.find((s: any) => s.label === selectedPresetScale);
    if (!scale) {
      toast({ title: "Error", description: "Invalid scale selected", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(scale.pxPerFoot) || scale.pxPerFoot <= 0) {
      toast({ title: "Error", description: "Invalid scale value", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: scale.pxPerFoot, units: "ft", scaleLabel: scale.label });
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ title: "Success", description: `Applied scale: ${scale.label}` });
      resetScaleState();
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to apply scale";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  }, [selectedSheet, projectId, sheetsQueryKey, toast]);

  const toggleFullscreen = useCallback(async () => {
    if (!workspaceRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await workspaceRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      toast({ title: "Fullscreen Error", description: "Could not toggle fullscreen mode", variant: "destructive" });
    }
  }, [workspaceRef, setIsFullscreen, toast]);

  useEffect(() => {
    if (!isDrawing) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (activeTool === "segment" && drawingPoints.length >= 2) completeSegment();
        else if (drawingPoints.length >= 3) completePolygon();
      } else if (e.key === "Escape") {
        setIsDrawing(false);
        setDrawingPoints([]);
        setRunningMeasurement(null);
        toast({ title: "Drawing Cancelled" });
      } else if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (drawingPoints.length > 1) {
          setDrawingPoints(drawingPoints.slice(0, -1));
          toast({ title: "Point Removed", description: `${drawingPoints.length - 1} point(s) remaining` });
        } else if (drawingPoints.length === 1) {
          setIsDrawing(false);
          setDrawingPoints([]);
          setRunningMeasurement(null);
          toast({ title: "Drawing Cancelled" });
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawing, drawingPoints, activeTool, completePolygon, completeSegment, setIsDrawing, setDrawingPoints, toast]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [setIsFullscreen]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeldRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftHeldRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      event.preventDefault();
      if (isDrawing && currentDrawingTool) return;
      if (!isSpacebarHeld && activeTool !== "pan") {
        setToolBeforeSpacebar(activeTool);
        setActiveTool("pan");
        setIsSpacebarHeld(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") return;
      if (isDrawing && currentDrawingTool) return;
      if (isSpacebarHeld && toolBeforeSpacebar) {
        setActiveTool(toolBeforeSpacebar);
        setToolBeforeSpacebar(null);
        setIsSpacebarHeld(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
  }, [activeTool, isSpacebarHeld, toolBeforeSpacebar, isDrawing, currentDrawingTool, setActiveTool, setToolBeforeSpacebar, setIsSpacebarHeld]);

  useEffect(() => {
    if (disableLegacyShortcuts) return;
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) return;
      const path = event.composedPath();
      const isInPortal = path.some(node => {
        if (!(node instanceof Element)) return false;
        const closestPortal = node.closest('[data-radix-portal]');
        if (closestPortal) return true;
        return (
          node.hasAttribute('data-radix-focus-guard') ||
          node.hasAttribute('data-radix-popper-content-wrapper') ||
          node.getAttribute('role') === 'dialog' ||
          node.getAttribute('role') === 'menu' ||
          node.getAttribute('role') === 'listbox' ||
          node.getAttribute('role') === 'combobox'
        );
      });
      const activeElement = document.activeElement;
      const isInIframe = activeElement?.tagName === 'IFRAME' || (target instanceof HTMLElement && target.closest('iframe') !== null);
      const canUseToolShortcuts = !isInPortal && !isInIframe && calibrationMode === "idle" && !(isDrawing && currentDrawingTool);
      const canUseNavigationShortcuts = !isInPortal && !isInIframe;
      const key = event.key.toLowerCase();

      if (canUseToolShortcuts) {
        const toolMap: Record<string, Tool> = { s: "select", h: "pan", l: "linear", a: "area", v: "volume", c: "count", n: "note", r: "arc", d: "linear_with_drop", p: "pitched_linear", t: "pitched_area", g: "surface_area", e: "segment", x: "deduct" };
        if (toolMap[key]) { event.preventDefault(); setActiveTool(toolMap[key]); }
      }

      if (key === 'escape' && canUseNavigationShortcuts) {
        event.preventDefault();
        if (isDrawing) {
          setIsDrawing(false);
          setCurrentDrawingTool(null);
          setDrawingPoints([]);
          toast({ title: "Drawing Cancelled" });
        } else if (selectedMeasurementId) {
          setSelectedMeasurementId(null);
        }
      }
      if (key === 'o' && !event.ctrlKey && !event.metaKey && canUseToolShortcuts) { event.preventDefault(); setOrthoLock(!orthoLock); }
      if (key === 'm' && !event.ctrlKey && !event.metaKey && canUseToolShortcuts) { event.preventDefault(); setSnapEnabled(!snapEnabled); }
      if ((key === 'delete' || key === 'backspace') && !event.ctrlKey && !event.metaKey && canUseNavigationShortcuts && !isDrawing && selectedMeasurementId && deleteMeasurementMutation) {
        event.preventDefault();
        const selM = measurements.find(mm => mm.id === selectedMeasurementId);
        if (selM) deleteMeasurementMutation.mutate(selM);
      }
      if (key === 'f' && !event.ctrlKey && !event.metaKey && canUseNavigationShortcuts) { event.preventDefault(); if (onZoomToFit) onZoomToFit(); }
      if ((event.key === '?' || (event.shiftKey && event.key === '/')) && canUseNavigationShortcuts) { event.preventDefault(); setShortcutsDialogOpen(true); }
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) { event.preventDefault(); takeoffHistory.undo(); return; }
      if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) { event.preventDefault(); takeoffHistory.redo(); return; }
      if ((key === '+' || key === '=') && !event.ctrlKey && !event.metaKey && !event.shiftKey && canUseNavigationShortcuts) { event.preventDefault(); setStageScale((prev: number) => Math.min(prev * 1.2, 10)); }
      if (key === '-' && !event.ctrlKey && !event.metaKey && !event.shiftKey && canUseNavigationShortcuts) { event.preventDefault(); setStageScale((prev: number) => Math.max(prev / 1.2, 0.1)); }
      if ((event.ctrlKey || event.metaKey) && key === 'r' && !event.shiftKey && canUseNavigationShortcuts) { event.preventDefault(); onRotateCW?.(); }
      if ((event.ctrlKey || event.metaKey) && key === 'r' && event.shiftKey && canUseNavigationShortcuts) { event.preventDefault(); onRotateCCW?.(); }

      if (key === 'tab' && canUseNavigationShortcuts && !isDrawing && measurements.length > 0) {
        event.preventDefault();
        const currentIdx = selectedMeasurementId ? measurements.findIndex(m => m.id === selectedMeasurementId) : -1;
        const nextIdx = event.shiftKey
          ? (currentIdx <= 0 ? measurements.length - 1 : currentIdx - 1)
          : (currentIdx >= measurements.length - 1 ? 0 : currentIdx + 1);
        setSelectedMeasurementId(measurements[nextIdx].id);
        setSelectedMeasurementIds(new Set());
      }

      if ((event.ctrlKey || event.metaKey) && key === 'd' && canUseNavigationShortcuts && !isDrawing && selectedMeasurementId && createMeasurementMutation) {
        event.preventDefault();
        const srcM = measurements.find(mm => mm.id === selectedMeasurementId);
        if (srcM) {
          const pts: Point[] = typeof srcM.points === "string" ? JSON.parse(srcM.points as string) : (srcM.points as Point[]);
          const offset = 20;
          const shiftedPts = pts.map(p => ({ x: p.x + offset, y: p.y + offset }));
          const dupData: any = {
            sheetId: srcM.sheetId, type: srcM.type as any, points: shiftedPts,
            label: `${srcM.label || "Measurement"} (copy)`, categoryId: srcM.categoryId || undefined,
          };
          if (srcM.depthFeet) dupData.depthFeet = srcM.depthFeet;
          if (srcM.pitchRatio) dupData.pitchRatio = srcM.pitchRatio;
          if (srcM.count) dupData.count = srcM.count;
          if (srcM.color) dupData.color = srcM.color;
          if (srcM.costCodeId) dupData.costCodeId = srcM.costCodeId;
          if (srcM.unitCost) dupData.unitCost = srcM.unitCost;
          if (srcM.computedLengthFt) dupData.computedLengthFt = srcM.computedLengthFt;
          if (srcM.computedAreaFt2) dupData.computedAreaFt2 = srcM.computedAreaFt2;
          if (srcM.computedVolumeCy) dupData.computedVolumeCy = srcM.computedVolumeCy;
          createMeasurementMutation.mutate(dupData);
          toast({ title: "Duplicated", description: `Measurement copied with offset` });
        }
      }

      if ((event.ctrlKey || event.metaKey) && key === 'a' && canUseNavigationShortcuts && !isDrawing) {
        event.preventDefault();
        const allIds = new Set(measurements.map(m => m.id));
        setSelectedMeasurementIds(allIds);
        if (measurements.length > 0) setSelectedMeasurementId(measurements[0].id);
        toast({ title: "All Selected", description: `${measurements.length} measurements selected` });
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [disableLegacyShortcuts, isDrawing, currentDrawingTool, toggleFullscreen, calibrationMode, takeoffHistory, setActiveTool, setIsDrawing, setCurrentDrawingTool, setDrawingPoints, setStageScale, setShortcutsDialogOpen, toast, orthoLock, setOrthoLock, snapEnabled, setSnapEnabled, selectedMeasurementId, setSelectedMeasurementId, measurements, deleteMeasurementMutation, onZoomToFit, onRotateCW, onRotateCCW, createMeasurementMutation]);

  return {
    handleToolSelect,
    handleStageMouseDown,
    handleStageMouseUp,
    handleStageMouseMove,
    handleStageDragStart,
    handleStageDragMove,
    handleStageDragEnd,
    handleWheel,
    handleTouchMove,
    handleTouchEnd,
    handleSaveNote,
    handleSaveCalibration,
    handleApplyPresetScale,
    completePolygon,
    completeSegment,
    toggleFullscreen,
    resolvePoint,
    snapEnabled,
    setSnapEnabled,
    orthoLock,
    setOrthoLock,
    currentSnap,
    cursorPosition,
    polarGuideStep,
    snapTargets,
    runningMeasurement,
    selectedMeasurementIds,
    setSelectedMeasurementIds,
    toggleMeasurementSelection: useCallback((id: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedMeasurementIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
      setSelectedMeasurementId(id);
    }, [setSelectedMeasurementId]),
  };
}

const COMMON_SCALES = {
  architectural: [
    { label: '1/16" = 1\'-0"', pxPerFoot: 6 }, { label: '1/8" = 1\'-0"', pxPerFoot: 12 }, { label: '1/4" = 1\'-0"', pxPerFoot: 24 },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36 }, { label: '1/2" = 1\'-0"', pxPerFoot: 48 }, { label: '3/4" = 1\'-0"', pxPerFoot: 72 },
    { label: '1" = 1\'-0"', pxPerFoot: 96 }, { label: '1-1/2" = 1\'-0"', pxPerFoot: 144 }, { label: '3" = 1\'-0"', pxPerFoot: 288 },
  ],
  civil: [
    { label: '1" = 10\'', pxPerFoot: 9.6 }, { label: '1" = 20\'', pxPerFoot: 4.8 }, { label: '1" = 30\'', pxPerFoot: 3.2 },
    { label: '1" = 40\'', pxPerFoot: 2.4 }, { label: '1" = 50\'', pxPerFoot: 1.92 }, { label: '1" = 60\'', pxPerFoot: 1.6 },
    { label: '1" = 100\'', pxPerFoot: 0.96 },
  ],
  structural: [
    { label: '1/8" = 1\'-0"', pxPerFoot: 12 }, { label: '1/4" = 1\'-0"', pxPerFoot: 24 }, { label: '3/8" = 1\'-0"', pxPerFoot: 36 },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48 }, { label: '3/4" = 1\'-0"', pxPerFoot: 72 }, { label: '1" = 1\'-0"', pxPerFoot: 96 },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144 }, { label: '3" = 1\'-0"', pxPerFoot: 288 },
  ],
};
