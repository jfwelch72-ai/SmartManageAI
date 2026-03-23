import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import type { Tool, MeasurementType } from "@/components/takeoff/types";
import {
  computePixelDistance,
  computeDistanceInFeet,
  computePolygonAreaInFt2,
  computeVolumeInCY,
  inchesToFeet,
  createArcSegment,
  computePitchedLinearFt,
  computePitchedAreaFt2,
  computeLinearWithDropFt,
  type Point,
} from "@shared/utils/geometry";
import {
  findSnapTargets,
  findNearestSnap,
  applyOrthoLock,
  type SnapResult,
} from "@/utils/snapping";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";

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
}

export function useTakeoffInteractions(params: UseTakeoffInteractionsParams) {
  const { toast } = useToast();

  const [mouseDownPosition, setMouseDownPosition] = useState<{ x: number; y: number } | null>(null);
  const CLICK_DRAG_THRESHOLD = 5;
  const [isDraggingStage, setIsDraggingStage] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoLock, setOrthoLock] = useState(false);
  const [currentSnap, setCurrentSnap] = useState<SnapResult | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const shiftHeldRef = useRef(false);
  const lastInputTypeRef = useRef<"mouse" | "touch" | null>(null);
  const lastInputTimeRef = useRef<number>(0);
  const isPinchingRef = useRef(false);
  const lastPinchDistRef = useRef<number | null>(null);
  const lastPinchCenterRef = useRef<{ x: number; y: number } | null>(null);

  const {
    projectId, sheetsQueryKey, selectedSheet, currentSheet, measurements, activeTool, setActiveTool,
    isDrawing, setIsDrawing, drawingPoints, setDrawingPoints, currentDrawingTool, setCurrentDrawingTool,
    calibrationMode, setCalibrationMode, calibrationPoints, setCalibrationPoints,
    calibrationDistance, setCalibrationDistance, units,
    stageScale, setStageScale, stagePosition, setStagePosition,
    selectedCategoryId, selectedMeasurementId, setSelectedMeasurementId,
    notePosition, setNotePosition, setNoteDialogOpen, noteText, setNoteText,
    pitchRatio, dropDistance,
    verifyMode, setVerifyMode, verifyPoints, setVerifyPoints, verifyExpectedDistance, setVerifyResult,
    isSpacebarHeld, setIsSpacebarHeld, toolBeforeSpacebar, setToolBeforeSpacebar,
    isFullscreen, setIsFullscreen, workspaceRef, stageRef,
    takeoffHistory, createMeasurementMutation, aggregatedMeasurements,
    setShortcutsDialogOpen, isMobile,
    deleteMeasurementMutation, onZoomToFit,
  } = params;

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

  const snapTargets = useMemo(
    () => (snapEnabled ? findSnapTargets(measurements) : []),
    [measurements, snapEnabled]
  );

  const resolvePoint = useCallback(
    (rawPoint: Point): Point => {
      let pt = rawPoint;
      if (orthoLock && drawingPoints.length > 0) {
        pt = applyOrthoLock(pt, drawingPoints[drawingPoints.length - 1]);
      }
      if (snapEnabled && snapTargets.length > 0) {
        const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
        if (snap.isSnapped) return snap.snappedPoint;
      }
      return pt;
    },
    [orthoLock, snapEnabled, snapTargets, drawingPoints, stageScale]
  );

  const completePolygon = useCallback(() => {
    if (!selectedSheet || !currentSheet?.scalePxPerFoot || drawingPoints.length < 3) {
      toast({ title: "Error", description: "Need at least 3 points for polygon", variant: "destructive" });
      return;
    }

    const areaFt2 = computePolygonAreaInFt2(drawingPoints, currentSheet.scalePxPerFoot);

    if (activeTool === "area") {
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "AREA",
        points: drawingPoints,
        label: `Area ${aggregatedMeasurements.byType.area.length + 1}`,
        categoryId: selectedCategoryId,
      });
      toast({ title: "Area Measurement Created", description: `${areaFt2.toFixed(2)} SF` });
    } else if (activeTool === "volume") {
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
      });
      toast({ title: "Volume Measurement Created", description: `${areaFt2.toFixed(2)} SF @ ${defaultDepthInches}" depth = ${volumeCy.toFixed(2)} CY` });
    } else if (activeTool === "pitched_area") {
      const pitchedArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "PITCHED_AREA",
        points: drawingPoints,
        label: `Pitched Area ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedSurfaceAreaFt2: pitchedArea,
      });
      toast({ title: "Pitched Area Created", description: `Flat: ${areaFt2.toFixed(2)} SF → Pitched (${pitchRatio}): ${pitchedArea.toFixed(2)} SF` });
    } else if (activeTool === "surface_area") {
      const surfaceArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "SURFACE_AREA",
        points: drawingPoints,
        label: `Surface ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedSurfaceAreaFt2: surfaceArea,
      });
      toast({ title: "Surface Area Created", description: `Flat: ${areaFt2.toFixed(2)} SF → Surface (${pitchRatio}): ${surfaceArea.toFixed(2)} SF` });
    }

    setIsDrawing(false);
    setDrawingPoints([]);
  }, [selectedSheet, currentSheet, drawingPoints, activeTool, selectedCategoryId, pitchRatio, measurements.length, aggregatedMeasurements, createMeasurementMutation, setIsDrawing, setDrawingPoints, toast]);

  const handleStageClick = useCallback((e: any) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    const transform = stage.getAbsoluteTransform().copy().invert();
    let point = transform.point(pointerPosition);

    const isDrawingTool = ["linear", "arc", "area", "volume", "count"].includes(activeTool);
    if (isDrawingTool) {
      point = resolvePoint(point);
    }

    if (activeTool === "select") {
      if (e.target === stage) {
        setSelectedMeasurementId(null);
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

    if (activeTool === "calibrate") {
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
    } else if (activeTool === "linear") {
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
        setIsDrawing(false);
        setDrawingPoints([]);
        toast({ title: "Measurement Created", description: `${lengthFt.toFixed(2)} LF` });
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
    } else if (activeTool === "arc") {
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
    } else if (activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") {
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
    } else if (activeTool === "count") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      createMeasurementMutation.mutate({
        sheetId: selectedSheet, type: "COUNT", points: [point],
        label: `Count ${aggregatedMeasurements.byType.count.length + 1}`, categoryId: selectedCategoryId,
      });
    } else if (activeTool === "note") {
      if (!selectedSheet) { toast({ title: "Error", description: "Select a sheet first", variant: "destructive" }); return; }
      setNotePosition(point);
      setNoteDialogOpen(true);
    }
  }, [activeTool, resolvePoint, verifyMode, verifyPoints, verifyExpectedDistance, calibrationMode, calibrationPoints,
    isDrawing, drawingPoints, selectedSheet, currentSheet, measurements, selectedCategoryId, pitchRatio, dropDistance,
    aggregatedMeasurements, createMeasurementMutation, completePolygon,
    setSelectedMeasurementId, setVerifyPoints, setVerifyMode, setVerifyResult,
    setCalibrationPoints, setCalibrationMode, setIsDrawing, setDrawingPoints, setCurrentDrawingTool,
    setNotePosition, setNoteDialogOpen, toast]);

  const handleStageMouseDown = useCallback((e: any) => {
    const isTouchEvent = e.evt && (e.evt.type === "touchstart" || e.evt.touches);
    const now = Date.now();
    if (isTouchEvent) {
      e.evt.preventDefault();
      lastInputTypeRef.current = "touch";
      lastInputTimeRef.current = now;
      if (e.evt.touches && e.evt.touches.length >= 2) {
        isPinchingRef.current = true;
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
  }, []);

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
    if (!mouseDownPosition) return;
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    setMouseDownPosition(null);
    if (!pointerPosition) return;
    if (isDraggingStage) return;
    const deltaX = pointerPosition.x - mouseDownPosition.x;
    const deltaY = pointerPosition.y - mouseDownPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (distance < CLICK_DRAG_THRESHOLD) {
      handleStageClick(e);
    }
  }, [mouseDownPosition, isDraggingStage, handleStageClick]);

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
    let pt: Point = transform.point(pointer);
    if (orthoLock && drawingPoints.length > 0) {
      pt = applyOrthoLock(pt, drawingPoints[drawingPoints.length - 1]);
    }
    setCursorPosition(pt);
    if (snapEnabled && snapTargets.length > 0) {
      const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
      setCurrentSnap(snap.isSnapped ? snap : null);
    } else {
      setCurrentSnap(null);
    }
  }, [snapEnabled, snapTargets, stageScale, orthoLock, drawingPoints]);

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

  const handleTouchMove = useCallback((e: any) => {
    const touches = e.evt?.touches;
    if (!touches || touches.length < 2) {
      lastPinchDistRef.current = null;
      lastPinchCenterRef.current = null;
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
    }
    lastPinchDistRef.current = dist;
    lastPinchCenterRef.current = center;
  }, [stageScale, stagePosition, stageRef, handleStageMouseMove, setStageScale, setStagePosition]);

  const handleTouchEnd = useCallback((e: any) => {
    const touches = e.evt?.touches;
    if (!touches || touches.length < 2) {
      lastPinchDistRef.current = null;
      lastPinchCenterRef.current = null;
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

  const handleSaveCalibration = useCallback(async () => {
    if (!selectedSheet || calibrationPoints.length !== 2 || !calibrationDistance) {
      toast({ title: "Error", description: "Complete calibration first", variant: "destructive" });
      return;
    }
    const distanceValue = parseFloat(calibrationDistance.trim());
    if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
      toast({ title: "Error", description: "Please enter a valid distance value", variant: "destructive" });
      return;
    }
    const minDistance = units === "ft" ? 0.5 : 0.15;
    if (distanceValue < minDistance) {
      toast({ title: "Error", description: `Distance must be at least ${minDistance} ${units}. For small details, use a larger reference distance.`, variant: "destructive" });
      return;
    }
    const pixelDistance = computePixelDistance(calibrationPoints[0], calibrationPoints[1]);
    const scalePxPerFoot = units === "ft" ? pixelDistance / distanceValue : pixelDistance / (distanceValue * 3.28084);
    if (!Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      toast({ title: "Error", description: "Invalid calibration value. Please check your measurements.", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot, units });
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ title: "Success", description: "Calibration saved" });
      setCalibrationMode("idle");
      setCalibrationPoints([]);
      setCalibrationDistance("");
      setActiveTool("select");
    } catch (error: any) {
      const errorMessage = error?.message || "Failed to save calibration";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
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
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: scale.pxPerFoot, units: "ft" });
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
      if (e.key === "Enter" && drawingPoints.length >= 3) completePolygon();
      else if (e.key === "Escape") { setIsDrawing(false); setDrawingPoints([]); toast({ title: "Drawing Cancelled" }); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawing, drawingPoints, completePolygon, setIsDrawing, setDrawingPoints, toast]);

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
        const toolMap: Record<string, Tool> = { s: "select", h: "pan", l: "linear", a: "area", v: "volume", c: "count", n: "note", r: "arc", d: "linear_with_drop", p: "pitched_linear", t: "pitched_area", g: "surface_area" };
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
      if ((key === 'delete' || key === 'backspace') && !event.ctrlKey && !event.metaKey && canUseNavigationShortcuts && selectedMeasurementId && deleteMeasurementMutation) {
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
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isDrawing, currentDrawingTool, calibrationMode, takeoffHistory, setActiveTool, setIsDrawing, setCurrentDrawingTool, setDrawingPoints, setStageScale, setShortcutsDialogOpen, toast, orthoLock, setOrthoLock, snapEnabled, setSnapEnabled, selectedMeasurementId, setSelectedMeasurementId, measurements, deleteMeasurementMutation, onZoomToFit]);

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
    toggleFullscreen,
    resolvePoint,
    snapEnabled,
    setSnapEnabled,
    orthoLock,
    setOrthoLock,
    currentSnap,
    cursorPosition,
    snapTargets,
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
