import { Fragment, memo, useEffect, useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Rect, Group } from "react-konva";
import { MarkupShapeView, type MarkupShape } from "@/components/markups/MarkupRenderer";
import {
  MARKUP_TOOLBAR_DEFAULT_COLOR,
  MARKUP_TOOLBAR_DEFAULT_THICKNESS,
} from "@/components/markups/PlanMarkupToolbar";
import {
  createArcSegment,
  sampleArcPoints,
  computeNetAreaInFt2,
} from "@shared/utils/geometry";
import { commitMarkupBodyDrag, commitMarkupResize } from "../../markups/markup-drag-commit";
import { TileLayer } from "../TileLayer";
import { DimInputCursorBadge } from "./DimInputCursorBadge";
import { CaptureQualityHUD } from "../CaptureQualityHUD";
import {
  type Tool,
  type MeasurementType,
  validateHexColor,
  hexToRgba,
  TOOL_CONFIG,
} from "../types";
import { formatPolarGuideLabel } from "@/lib/takeoffPolarLabel";
import type { TakeoffCondition, TakeoffMeasurement, TakeoffSheet } from "@shared/schema";
import type { DetectedItem } from "@/components/AiTakeoffPanel";
import type { useMutation } from "@tanstack/react-query";
import type { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import type { ConstraintMode } from "./takeoff-shortcuts";

type Mutation = ReturnType<typeof useMutation<any, any, any, any>>;
type HistoryRet = ReturnType<typeof useTakeoffHistory>;

type Point = { x: number; y: number };

type StructuralGridlines = {
  horizontal: Array<{ label: string; position: number }>;
  vertical: Array<{ label: string; position: number }>;
};

type MarkupBodyDragRefVal = {
  id: string;
  origX: number;
  origY: number;
  hiddenHandles: Array<{ visible: boolean; listening: boolean; node: any }>;
  siblings: Array<{ id: string; node: any }>;
} | null;

type MarkupResizeRefVal = {
  id: string;
  origPts: Point[];
  origBB: { x: number; y: number; w: number; h: number };
  corner: string;
  tool: string;
} | null;

export interface CanvasStageProps {
  stageRef: RefObject<any>;
  containerRef: RefObject<HTMLDivElement>;
  markupBodyDragRef: { current: MarkupBodyDragRefVal };
  markupResizeRef: { current: MarkupResizeRefVal };

  stageDimensions: { width: number; height: number };
  stageScale: number;
  stagePosition: Point;

  selectedSheet: string | null;
  currentSheet: TakeoffSheet | null | undefined;
  sheetRotation: number;
  pdfImage: HTMLImageElement | ImageBitmap | null;
  /**
   * `pdfImageSheetId` — sheet provenance for the bitmap currently in
   * `pdfImage`. The placeholder is set from two independent code paths
   * in TakeoffWorkspace (the legacy non-tile loader and the tile
   * renderer mirror effect) and on a fast sheet swap A → B the
   * mirror effect can briefly hold A's bitmap while `pageDims` has
   * already advanced to B's tagged dims. A pageDims-only check would
   * pass and paint A stretched into B's page rectangle (the
   * "duplicate / ghost plan" artifact). We require both fields to
   * match `currentSheet.id` before drawing.
   */
  pdfImageSheetId: string | null;
  pageDims: { width: number; height: number; sheetId?: string } | null;
  tileRendererEnabled: boolean;
  tiles: Array<{ coord: import("@/lib/takeoff/tileCoords").TileCoord; bitmap: ImageBitmap }>;
  isPdfLoading: boolean;
  pdfLoadProgress: number;

  activeTool: Tool;
  setActiveTool: Dispatch<SetStateAction<Tool>>;

  isDrawing: boolean;
  drawingPoints: Point[];
  cursorPosition: Point | null;
  /**
   * Task #2203 — Typed dimension lock active for the next vertex (in
   * feet). When set and the user is mid-draw, the canvas paints a
   * small "Locked: 12 ft" badge near the cursor so the active length
   * is visible without darting back to the ribbon. `null` / `0` hides
   * the badge.
   */
  pendingDimLengthFt?: number | null;
  /**
   * Task #2203 — When true, the typed dimension lock is in chain mode
   * (stays active across multiple clicks). The badge swaps to a
   * "Chain" label so the user can tell at a glance that the next
   * click won't release the lock.
   */
  dimInputRepeat?: boolean;

  showAiOverlays: boolean;
  hideAiMeasurements: boolean;
  hideResolvedIssues: boolean;
  showOverlaySlider: boolean;
  overlayOpacity: number;
  preImportDetectedItems: DetectedItem[];
  highlightedAiItem: DetectedItem | null;
  setHighlightedAiItem: Dispatch<SetStateAction<DetectedItem | null>>;

  addendaImages: Record<string, HTMLImageElement>;
  addendaOverlays: Record<string, { visible: boolean; opacity: number; imageUrl?: string }>;

  gridEnabled: boolean;
  showStructuralGridlines: boolean;
  structuralGridlines: StructuralGridlines;

  showMeasurementLabels: boolean;
  hiddenCategoryIds: Set<string>;
  labelHiddenCategories: Set<string>;

  measurements: TakeoffMeasurement[];
  categories: any[];

  selectedMeasurementId: string | null;
  setSelectedMeasurementId: Dispatch<SetStateAction<string | null>>;
  selectedSegmentIndex: number | null;
  setSelectedSegmentIndex: Dispatch<SetStateAction<number | null>>;

  selectedMarkupId: string | null;
  selectedMarkupIds: Set<string>;
  setSelectedMarkupIds: Dispatch<SetStateAction<Set<string>>>;

  markupResizePreview: { id: string; points: Point[] } | null;
  setMarkupResizePreview: Dispatch<SetStateAction<{ id: string; points: Point[] } | null>>;
  markupEditDraft: { color: string; thickness: number; text: string } | null;
  setMarkupEditDraft: Dispatch<SetStateAction<{ color: string; thickness: number; text: string } | null>>;
  setMarkupEditInitial: Dispatch<SetStateAction<any>>;

  markups: Array<MarkupShape & { categoryId?: string | null }>;
  sheets: TakeoffSheet[];
  markupDrawing: boolean;
  markupDrawPoints: Point[];
  sheetLinks: any[];
  hoveredLinkId: string | null;
  setHoveredLinkId: Dispatch<SetStateAction<string | null>>;
  failedMarkupIds: Set<string>;

  flashMeasurementId: string | null;
  flashPulse: number;
  /**
   * ID of the measurement the user is hovering in the sidebar list.
   * The canvas draws a persistent highlight ring around that measurement
   * so the user can instantly locate it on the drawing.
   */
  hoveredMeasurementId?: string | null;

  calibrationPoints: Point[];
  verifyPoints: Point[];

  /**
   * Task #2781 — Calibration zone polygons to render as overlays on
   * the canvas. When provided, each zone is drawn as a labeled polygon
   * so users can see which scale applies where.
   */
  calibrationZones?: Array<{
    id: string;
    name: string;
    polygon_points: Array<{ x: number; y: number }>;
    px_per_foot: number;
  }>;
  /** ID of the currently-selected calibration zone (highlighted on canvas). */
  selectedCalibrationZoneId?: string | null;
  /**
   * Task #2796 — ID of the calibration zone the cursor is currently inside
   * (computed from pointer world-coordinates in TakeoffWorkspace). When set,
   * the matching polygon gets a brighter outline and a slightly stronger fill
   * so estimators can see zone boundaries without opening the drawer.
   */
  activeCalibrationZoneId?: string | null;
  /** Called when the user clicks a zone polygon on the canvas. */
  onSelectCalibrationZone?: (id: string | null) => void;

  currentSnap: any;
  runningMeasurement: { value: number; unit: string; segments?: number } | null;
  /**
   * Task #2331 — Live capture-quality stats for the in-progress draft.
   * Sourced from `useTakeoffInteractions.snapStats` and consumed by
   * the on-canvas `CaptureQualityHUD` so estimators can self-correct
   * mid-draft (vs. only learning after the row's needs-review flag).
   * Optional so legacy hosts that haven't been wired up yet render no
   * HUD instead of crashing.
   */
  snapStats?: {
    vertices: number;
    hits: number;
    modeCounts: Record<string, number>;
  };

  orthoLock: boolean;
  /**
   * Task #2199 / #2225 — Step in degrees the canvas uses to paint
   * CAD-style polar tracking guide rays from the active anchor. Set
   * when the ribbon's `ortho-angle` constraint is engaged with a
   * non-null preset (15° / 30° / 45° / 90°) OR when the dedicated
   * `polar` constraint is on (defaults to `polarAngleStep` ?? 15°).
   * Null in every other constraint state (none / ortho / null preset).
   */
  polarGuideStep: number | null;
  /**
   * Task #2210 — Active constraint group from the unified ribbon. The
   * canvas paints the live cursor angle/distance badge only when this
   * is `'ortho-angle'` (the dedicated guided-angle mode); the polar /
   * ortho / none modes keep their existing previews. Optional so the
   * legacy ribbon path (which doesn't manage constraintMode) is a
   * no-op for the badge.
   */
  constraintMode?: ConstraintMode;
  activeCondition: TakeoffCondition | null;

  issues: any[];
  selectedIssueId: string | null;
  setSelectedIssueId: Dispatch<SetStateAction<string | null>>;

  createLinkMode: { step: "select-area" | "select-target"; startPoint?: Point; endPoint?: Point } | null;
  setCreateLinkMode: Dispatch<SetStateAction<any>>;

  isMobile: boolean;
  setMeasurementContextMenu: Dispatch<SetStateAction<any>>;

  markupColor: string;
  markupThickness: number;

  bulkUpdateMarkupsMutation: Mutation;
  updateMarkupMutation: Mutation;
  updateMeasurementMutation: Mutation;
  createIssueMutation: Mutation;
  moveIssueMutation: Mutation;
  takeoffHistory: HistoryRet;

  inverseRotate: (pt: Point) => Point;
  isMarkupTool: (tool: string) => boolean;
  getMeasurementCenter: (m: any) => Point | null;
  parseMeasurementPoints: (m: any) => Point[];
  computeAiPosition: (aiIdx: number, imageWidth: number) => Point;
  snapToPresetThickness: (value: number) => number;

  completePolygon: (...args: any[]) => any;
  completeSegment: (...args: any[]) => any;

  handleStageMouseDown: (e: any) => any;
  handleStageMouseUp: (e: any) => any;
  handleStageMouseMove: (e: any) => any;
  /** Task #2795 — Called on Stage mouseleave to clear cursorPosition so
   *  the bottom-bar zone/sheet-scale indicator hides when not over canvas. */
  clearCursorPosition?: () => void;
  handleStageDragStart: (e: any) => any;
  handleStageDragMove: (e: any) => any;
  handleStageDragEnd: (e: any) => any;
  handleTouchEnd: (e: any) => any;
  handleTouchMove: (e: any) => any;
  handleWheel: (e: any) => any;
  handleMarkupMouseDown: (e: any) => any;
  handleMarkupMouseUp: () => any;
  handleMarkupMouseMove: () => any;
  handleLinkNavigate: (targetSheetId: string) => any;
  getEventClientPoint: (evt: MouseEvent | TouchEvent | PointerEvent) => Point | null;
  updateIssueDropTarget: (clientX: number, clientY: number) => HTMLElement | null;
  clearIssueDropTarget: () => void;
  toolToMarkupType: (tool: string) => string;

  collab: any;

  /** Task #2784 — Zone polygon drawing mode. When true, canvas clicks
   *  accumulate polygon vertices instead of performing normal interactions. */
  zoneDrawingActive?: boolean;
  /** Current in-progress polygon vertices (canvas coords). */
  zoneDrawPoints?: Point[];
  /** Called with the canvas-space point when the user clicks during zone drawing. */
  onZoneCanvasClick?: (pt: Point) => void;
  /** Called when the user double-clicks during zone drawing (closes the polygon). */
  onZoneCanvasDblClick?: () => void;

  /**
   * Task #2793 — Zone polygon vertex-drag reshape mode.
   * When set, this zone's polygon is shown with draggable vertex handles
   * instead of the normal static overlay.
   */
  editingZoneId?: string | null;
  /**
   * Current vertex positions for the zone being edited. Updated on every
   * drag so the canvas preview stays live.
   */
  editingZonePoints?: Point[] | null;
  /**
   * Called with the vertex index and new canvas-space position as the user
   * drags a handle. The parent updates `editingZonePoints` so the canvas
   * re-renders the live polygon outline.
   */
  onZoneVertexDrag?: (idx: number, pt: Point) => void;
  /**
   * Task #2793 — Called when the user clicks a zone polygon on the canvas.
   * Receives the full zone object so the parent can decide whether to enter
   * vertex-edit mode (e.g. when the calibration drawer is open) or just
   * select the zone. When undefined, falls back to `onSelectCalibrationZone`.
   */
  onZonePolygonClick?: (zone: {
    id: string;
    name: string;
    polygon_points: Array<{ x: number; y: number }>;
    px_per_foot: number;
  }) => void;
}

function CanvasStageImpl(props: CanvasStageProps) {
  const {
    stageRef,
    containerRef,
    markupBodyDragRef,
    markupResizeRef,
    stageDimensions,
    stageScale,
    stagePosition,
    selectedSheet,
    currentSheet,
    sheetRotation,
    pdfImage,
    pdfImageSheetId,
    pageDims,
    tileRendererEnabled,
    tiles,
    isPdfLoading,
    pdfLoadProgress,
    activeTool,
    setActiveTool,
    isDrawing,
    drawingPoints,
    cursorPosition,
    pendingDimLengthFt,
    dimInputRepeat,
    showAiOverlays,
    hideAiMeasurements,
    hideResolvedIssues,
    showOverlaySlider,
    overlayOpacity,
    preImportDetectedItems,
    highlightedAiItem,
    setHighlightedAiItem,
    addendaImages,
    addendaOverlays,
    gridEnabled,
    showStructuralGridlines,
    structuralGridlines,
    showMeasurementLabels,
    hiddenCategoryIds,
    labelHiddenCategories,
    measurements,
    categories,
    selectedMeasurementId,
    setSelectedMeasurementId,
    selectedSegmentIndex,
    setSelectedSegmentIndex,
    selectedMarkupId,
    selectedMarkupIds,
    setSelectedMarkupIds,
    markupResizePreview,
    setMarkupResizePreview,
    markupEditDraft,
    setMarkupEditDraft,
    setMarkupEditInitial,
    markups,
    sheets,
    markupDrawing,
    markupDrawPoints,
    sheetLinks,
    hoveredLinkId,
    setHoveredLinkId,
    failedMarkupIds,
    flashMeasurementId,
    flashPulse,
    hoveredMeasurementId,
    calibrationPoints,
    verifyPoints,
    calibrationZones,
    selectedCalibrationZoneId,
    activeCalibrationZoneId,
    onSelectCalibrationZone,
    currentSnap,
    runningMeasurement,
    snapStats,
    orthoLock,
    polarGuideStep,
    constraintMode,
    activeCondition,
    issues,
    selectedIssueId,
    setSelectedIssueId,
    createLinkMode,
    setCreateLinkMode,
    isMobile,
    setMeasurementContextMenu,
    markupColor,
    markupThickness,
    bulkUpdateMarkupsMutation,
    updateMarkupMutation,
    updateMeasurementMutation,
    createIssueMutation,
    moveIssueMutation,
    takeoffHistory,
    inverseRotate,
    isMarkupTool,
    getMeasurementCenter,
    parseMeasurementPoints,
    computeAiPosition,
    snapToPresetThickness,
    completePolygon,
    completeSegment,
    handleStageMouseDown,
    handleStageMouseUp,
    handleStageMouseMove,
    clearCursorPosition,
    handleStageDragStart,
    handleStageDragMove,
    handleStageDragEnd,
    handleTouchEnd,
    handleTouchMove,
    handleWheel,
    handleMarkupMouseDown,
    handleMarkupMouseUp,
    handleMarkupMouseMove,
    handleLinkNavigate,
    getEventClientPoint,
    updateIssueDropTarget,
    clearIssueDropTarget,
    toolToMarkupType,
    collab,
    zoneDrawingActive,
    zoneDrawPoints,
    onZoneCanvasClick,
    onZoneCanvasDblClick,
    editingZoneId,
    editingZonePoints,
    onZoneVertexDrag,
    onZonePolygonClick,
  } = props;

  // Visible world-coordinate rectangle — used for viewport culling so
  // measurements that are completely off-screen are skipped during render.
  // A generous 400 px padding prevents "pop-in" at the edges and accounts
  // for label overflow beyond the measurement geometry itself.
  const viewportRect = useMemo(() => {
    const pad = 400;
    return {
      left: (-stagePosition.x / stageScale) - pad,
      top: (-stagePosition.y / stageScale) - pad,
      right: (-stagePosition.x + stageDimensions.width) / stageScale + pad,
      bottom: (-stagePosition.y + stageDimensions.height) / stageScale + pad,
    };
  }, [stagePosition.x, stagePosition.y, stageScale, stageDimensions.width, stageDimensions.height]);

  // Register a non-passive wheel listener on the container element so that
  // e.evt.preventDefault() in handleWheel is always honoured.  Modern
  // browsers default wheel listeners to passive=true for scroll performance;
  // if Konva's own listener is registered as passive, calling preventDefault()
  // is silently ignored and the page scrolls instead of the canvas zooming.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prevent = (e: WheelEvent) => { e.preventDefault(); };
    container.addEventListener("wheel", prevent, { passive: false });
    return () => container.removeEventListener("wheel", prevent);
  // containerRef identity is stable for the component lifetime — no deps needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // Wrap in a <div style="display:contents"> instead of a bare Fragment so
    // that Replit devtools can attach data-replit-metadata without React
    // warning "Invalid prop supplied to React.Fragment".
    <div style={{ display: "contents" }}>
            <Stage
              ref={stageRef}
              width={stageDimensions.width}
              height={stageDimensions.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePosition.x}
              y={stagePosition.y}
              onMouseDown={(e) => {
                if (zoneDrawingActive && onZoneCanvasClick) {
                  const stage = e.target.getStage();
                  const pos = stage?.getPointerPosition();
                  if (stage && pos) {
                    const transform = stage.getAbsoluteTransform().copy().invert();
                    const point = inverseRotate(transform.point(pos));
                    onZoneCanvasClick(point);
                  }
                  return;
                }
                if (createLinkMode?.step === "select-area") {
                  const stage = e.target.getStage();
                  const pos = stage?.getPointerPosition();
                  if (stage && pos) {
                    const transform = stage.getAbsoluteTransform().copy().invert();
                    const point = transform.point(pos);
                    setCreateLinkMode({ ...createLinkMode, startPoint: point, endPoint: point });
                  }
                  return;
                }
                if (isMarkupTool(activeTool)) { handleMarkupMouseDown(e); } else { handleStageMouseDown(e); }
              }}
              onMouseUp={(e: any) => {
                if (createLinkMode?.step === "select-area" && createLinkMode.startPoint) {
                  const stage = e.target.getStage();
                  const pos = stage?.getPointerPosition();
                  if (pos) {
                    const transform = stage.getAbsoluteTransform().copy().invert();
                    const point = transform.point(pos);
                    const dx = Math.abs(point.x - createLinkMode.startPoint.x);
                    const dy = Math.abs(point.y - createLinkMode.startPoint.y);
                    if (dx > 10 && dy > 10) {
                      setCreateLinkMode({ step: "select-target", startPoint: createLinkMode.startPoint, endPoint: point });
                    } else {
                      setCreateLinkMode({ step: "select-area" });
                    }
                  }
                  return;
                }
                if (isMarkupTool(activeTool)) { handleMarkupMouseUp(); return; }
                if (activeTool === "issue_pin" && selectedSheet) {
                  const stage = e.target.getStage();
                  const pointerPosition = stage.getPointerPosition();
                  if (!pointerPosition) return;
                  const transform = stage.getAbsoluteTransform().copy().invert();
                  const point = inverseRotate(transform.point(pointerPosition));
                  createIssueMutation.mutate({
                    sheetId: selectedSheet,
                    position: JSON.stringify({ x: point.x, y: point.y }),
                    category: "OBSERVATION",
                    severity: "LOW",
                    description: "",
                  }, {
                    onSuccess: (newIssue: any) => {
                      setSelectedIssueId(newIssue.id);
                      setActiveTool("select");
                    },
                  });
                  return;
                }
                handleStageMouseUp(e);
              }}
              onMouseMove={(e) => {
                if (createLinkMode?.step === "select-area" && createLinkMode.startPoint) {
                  const stage = e.target.getStage();
                  const pos = stage?.getPointerPosition();
                  if (stage && pos) {
                    const transform = stage.getAbsoluteTransform().copy().invert();
                    const point = transform.point(pos);
                    setCreateLinkMode({ ...createLinkMode, endPoint: point });
                  }
                  return;
                }
                if (isMarkupTool(activeTool)) { handleMarkupMouseMove(); } else { handleStageMouseMove(e); }
                const stage = stageRef.current;
                if (stage) {
                  const pos = stage.getPointerPosition();
                  if (pos) {
                    const canvasX = (pos.x - stagePosition.x) / stageScale;
                    const canvasY = (pos.y - stagePosition.y) / stageScale;
                    collab.sendCursorMove(canvasX, canvasY, selectedSheet);
                  }
                }
              }}
              onMouseLeave={() => {
                // Task #2795 — Clear cursor position when the pointer leaves the
                // canvas so the live zone/sheet-scale indicator in the status bar
                // hides instead of showing stale last-position data.
                clearCursorPosition?.();
              }}
              onTouchStart={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseDown(e); } else { handleStageMouseDown(e); } }}
              onTouchEnd={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseUp(); } else { handleTouchEnd(e); } }}
              onTouchMove={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseMove(); } else { handleTouchMove(e); } }}
              onDblClick={(e) => {
                if (zoneDrawingActive && onZoneCanvasDblClick) {
                  e.evt.preventDefault();
                  onZoneCanvasDblClick();
                  return;
                }
                if ((activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                } else if (activeTool === "segment" && isDrawing && drawingPoints.length >= 2) {
                  e.evt.preventDefault();
                  completeSegment();
                }
              }}
              onDblTap={(e: any) => {
                if ((activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                } else if (activeTool === "segment" && isDrawing && drawingPoints.length >= 2) {
                  e.evt.preventDefault();
                  completeSegment();
                }
              }}
              onWheel={handleWheel}
              draggable={activeTool === "pan"}
              onDragStart={handleStageDragStart}
              onDragMove={handleStageDragMove}
              onDragEnd={handleStageDragEnd}
            >
              <Layer>
                <Group
                  rotation={sheetRotation}
                  x={sheetRotation === 180 ? (pageDims?.width || 0) : sheetRotation === 270 ? (pageDims?.height || 0) : 0}
                  y={sheetRotation === 90 ? (pageDims?.width || 0) : sheetRotation === 180 ? (pageDims?.height || 0) : 0}
                >
                {isPdfLoading ? (
                  <>
                    <Rect x={20} y={20} width={200} height={6} fill="#e5e7eb" cornerRadius={3} />
                    <Rect x={20} y={20} width={Math.max(4, pdfLoadProgress * 2)} height={6} fill="#f97316" cornerRadius={3} />
                    <Text text={`Loading plan... ${pdfLoadProgress}%`} x={20} y={32} fontSize={12} fill="#888" />
                  </>
                ) : pdfImage && pageDims && pageDims.sheetId === currentSheet?.id && pdfImageSheetId === currentSheet?.id ? (
                  <>
                    {/* Task #2138: low-res placeholder is stretched to world
                        dimensions so markup math (which has always operated in
                        world coords) keeps lining up perfectly. Detail tiles
                        composited on top by `<TileLayer>` replace the blurry
                        placeholder pixel-for-pixel as they stream in.

                        Defensive: a closed/transferred ImageBitmap reports
                        `width === 0`. We guard the *placeholder* KonvaImage
                        individually (rather than the whole branch) so that a
                        transient detach on the placeholder does NOT also
                        suppress the tile layer — tiles can keep painting at
                        the new zoom level while the placeholder reloads.
                        Without this, zooming felt "stuck" because a detached
                        placeholder dropped both layers and the user saw an
                        empty stage.

                        Sheet-match guard (`pageDims.sheetId === currentSheet.id`):
                        TakeoffWorkspace updates `pdfImage` and `pageDims` from
                        two independent async paths (the worker's placeholder
                        bitmap arrives via the mirror effect; pageDims arrives
                        via `getPageDims` in the loadPDF effect). On a sheet
                        swap A→B those paths can briefly land in a state where
                        `pdfImage` already points at B's bitmap while `pageDims`
                        is still A's smaller dimensions (or vice-versa) — which
                        renders the new sheet at the previous sheet's size,
                        producing the duplicate-image / "ghost at wrong scale"
                        artifact the user reported. The `Loading plan…`
                        skeleton above takes over until both halves agree on
                        the same sheet, then this branch paints once. */}
                    {(pdfImage as { width?: number }).width ? (
                      <KonvaImage
                        image={pdfImage as unknown as HTMLImageElement}
                        width={pageDims.width}
                        height={pageDims.height}
                        listening={false}
                      />
                    ) : null}
                    {tileRendererEnabled && tiles.length > 0 ? (
                      <TileLayer tiles={tiles} />
                    ) : null}
                  </>
                ) : currentSheet ? (
                  /* Sheet is selected but pdfImage / pageDims haven't
                     converged on `currentSheet.id` yet (mid-swap window).
                     Show the same loading skeleton the explicit
                     `isPdfLoading` branch above renders — anything else
                     would either flash "Select a sheet" at the user
                     (jarring) or paint the prior sheet at the wrong
                     dimensions (the original duplicate-image bug). */
                  <>
                    <Rect x={20} y={20} width={200} height={6} fill="#e5e7eb" cornerRadius={3} />
                    <Rect x={20} y={20} width={4} height={6} fill="#f97316" cornerRadius={3} />
                    <Text text="Loading plan..." x={20} y={32} fontSize={12} fill="#888" />
                  </>
                ) : (
                  <Text text="Select a sheet to begin" x={20} y={20} fontSize={16} fill="#888" />
                )}

                {pageDims && pageDims.sheetId === currentSheet?.id && Object.entries(addendaOverlays).map(([addendumId, overlay]) => {
                  if (!overlay.visible || !addendaImages[addendumId]) return null;
                  // Stretch the addenda image to the same world dimensions
                  // as the underlying sheet placeholder so it lines up
                  // pixel-for-pixel with the PDF render. Without explicit
                  // width/height, KonvaImage falls back to the bitmap's
                  // natural pixel size at world (0,0), which renders the
                  // overlay as a smaller "ghost" image stuck in the upper
                  // area of the canvas (the placeholder render is at a
                  // higher scale than the addenda preview image).
                  //
                  // The outer `pageDims.sheetId === currentSheet?.id` gate
                  // matches the placeholder branch above: if pageDims is
                  // still the previous sheet's during a swap, the addendum
                  // image would stretch to the wrong sheet's world box and
                  // the user sees the same "ghost at wrong scale" duplicate
                  // overlapping the new sheet. Suppressing addenda until
                  // pageDims catches up keeps the overlay aligned with the
                  // sheet it was authored against.
                  return (
                    <KonvaImage
                      key={`addenda-overlay-${addendumId}`}
                      image={addendaImages[addendumId]}
                      width={pageDims.width}
                      height={pageDims.height}
                      opacity={showOverlaySlider ? (overlayOpacity / 100) * overlay.opacity : overlay.opacity}
                      listening={false}
                    />
                  );
                })}

                {showAiOverlays && pdfImage && preImportDetectedItems.filter(item => item.boundingBox).map((item) => {
                  const imgW = (pageDims?.width || 0);
                  const imgH = (pageDims?.height || 0);
                  const bbox = item.boundingBox!;
                  const rx = (bbox.x / 100) * imgW;
                  const ry = (bbox.y / 100) * imgH;
                  const rw = (bbox.w / 100) * imgW;
                  const rh = (bbox.h / 100) * imgH;
                  const conf = item.confidence || 0;
                  const fillColor = conf >= 85 ? "rgba(139,92,246,0.18)" : conf >= 70 ? "rgba(139,92,246,0.14)" : "rgba(139,92,246,0.10)";
                  const strokeColor = conf >= 85 ? "#8b5cf6" : conf >= 70 ? "#a78bfa" : "#c4b5fd";
                  const isHighlighted = highlightedAiItem?.id === item.id;
                  return (
                    <Fragment key={`ai-pre-${item.id}`}>
                      <Rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill={isHighlighted ? "rgba(139,92,246,0.30)" : fillColor}
                        stroke={isHighlighted ? "#7c3aed" : strokeColor}
                        strokeWidth={isHighlighted ? 3 : 2}
                        dash={[6, 4]}
                        cornerRadius={3}
                        listening={true}
                        onMouseEnter={(e) => {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = "pointer";
                          setHighlightedAiItem(item);
                        }}
                        onMouseLeave={(e) => {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = "default";
                          setHighlightedAiItem(null);
                        }}
                        onClick={() => setHighlightedAiItem(prev => prev?.id === item.id ? null : item)}
                      />
                      <Text
                        x={rx}
                        y={ry - 16}
                        text={`${item.description} (${conf}%) · ${item.quantity} ${item.unit}`}
                        fontSize={11}
                        fontStyle="bold"
                        fill={isHighlighted ? "#7c3aed" : "#e9d5ff"}
                        listening={false}
                      />
                      {isHighlighted && (
                        <Rect
                          x={rx + 4}
                          y={ry + 4}
                          width={Math.min(rw - 8, 220)}
                          height={item.suggestedSowItem ? 56 : 42}
                          fill="rgba(0,0,0,0.80)"
                          cornerRadius={4}
                          listening={false}
                        />
                      )}
                      {isHighlighted && (
                        <Text
                          x={rx + 10}
                          y={ry + 8}
                          text={`${item.description}\n${item.quantity} ${item.unit} · ${conf}% confidence${item.suggestedSowItem ? `\nSOW: ${item.suggestedSowItem.code}` : ""}`}
                          fontSize={11}
                          fill="#fff"
                          listening={false}
                        />
                      )}
                    </Fragment>
                  );
                })}

                {showAiOverlays && pdfImage && measurements.filter(m => m.source === "AI").map((m) => {
                  try {
                    const meta = m.metadata ? (typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata) : null;
                    const bbox = meta?.boundingBox;
                    if (!bbox || !bbox.w || !bbox.h) return null;
                    const imgW = (pageDims?.width || 0);
                    const imgH = (pageDims?.height || 0);
                    const rx = (bbox.x / 100) * imgW;
                    const ry = (bbox.y / 100) * imgH;
                    const rw = (bbox.w / 100) * imgW;
                    const rh = (bbox.h / 100) * imgH;
                    const conf = meta?.confidence || 0;
                    const fillColor = conf >= 85 ? "rgba(34,197,94,0.15)" : conf >= 70 ? "rgba(234,179,8,0.15)" : "rgba(249,115,22,0.12)";
                    const strokeColor = conf >= 85 ? "#22c55e" : conf >= 70 ? "#eab308" : "#f97316";
                    const aiItemId = meta?.aiItemId || meta?.sourceItemId;
                    const isHighlighted = highlightedAiItem && (
                      (aiItemId && aiItemId === highlightedAiItem.id) ||
                      (m.label && m.label === highlightedAiItem.description && bbox.x === highlightedAiItem.boundingBox?.x && bbox.y === highlightedAiItem.boundingBox?.y)
                    );
                    return (
                      <Fragment key={`ai-overlay-${m.id}`}>
                        <Rect
                          x={rx}
                          y={ry}
                          width={rw}
                          height={rh}
                          fill={isHighlighted ? "rgba(139,92,246,0.25)" : fillColor}
                          stroke={isHighlighted ? "#8b5cf6" : strokeColor}
                          strokeWidth={isHighlighted ? 3 : 2}
                          dash={[6, 3]}
                          cornerRadius={3}
                          listening={true}
                          onMouseEnter={(e) => {
                            const container = e.target.getStage()?.container();
                            if (container) container.style.cursor = "pointer";
                          }}
                          onMouseLeave={(e) => {
                            const container = e.target.getStage()?.container();
                            if (container) container.style.cursor = "default";
                          }}
                          onClick={() => setSelectedMeasurementId(m.id)}
                        />
                        <Text
                          x={rx}
                          y={ry - 16}
                          text={`${m.label || "AI"} · ${m.count || 1} ${meta?.unit || "EA"} (${conf}%)`}
                          fontSize={11}
                          fontStyle="bold"
                          fill={isHighlighted ? "#8b5cf6" : strokeColor}
                          listening={false}
                        />
                        {selectedMeasurementId === m.id && (
                          <>
                            <Rect
                              x={rx + 4}
                              y={ry + 4}
                              width={Math.min(rw - 8, 220)}
                              height={52}
                              fill="rgba(0,0,0,0.80)"
                              cornerRadius={4}
                              listening={false}
                            />
                            <Text
                              x={rx + 10}
                              y={ry + 8}
                              text={`${m.label || "AI Item"}\nQty: ${m.count || 1} ${meta?.unit || "EA"}\nConfidence: ${conf}%`}
                              fontSize={11}
                              fill="#fff"
                              listening={false}
                            />
                          </>
                        )}
                      </Fragment>
                    );
                  } catch (err) { console.warn("[Takeoff] Failed to render AI count measurement:", err); return null; }
                })}

                {gridEnabled && currentSheet?.scalePxPerFoot && pdfImage && (() => {
                  const imgW = (pageDims?.width || 0);
                  const imgH = (pageDims?.height || 0);
                  const pxPerFoot = currentSheet.scalePxPerFoot;
                  let gridSpacingFt = 1;
                  const screenPxPerFoot = pxPerFoot * stageScale;
                  if (screenPxPerFoot > 0) {
                    const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
                    gridSpacingFt = steps.find(s => s * screenPxPerFoot >= 30) || 100;
                  }
                  const gridSpacingPx = gridSpacingFt * pxPerFoot;
                  const majorEvery = gridSpacingFt >= 10 ? 5 : gridSpacingFt >= 1 ? (currentSheet.units === "m" ? 10 : 5) : 10;
                  const gridLines: JSX.Element[] = [];
                  const unitLabel = currentSheet.units === "m" ? "m" : "ft";
                  for (let x = 0; x <= imgW; x += gridSpacingPx) {
                    const idx = Math.round(x / gridSpacingPx);
                    const isMajor = idx % majorEvery === 0;
                    gridLines.push(
                      <Line key={`gv-${idx}`} points={[x, 0, x, imgH]} stroke={isMajor ? "#999" : "#ccc"} strokeWidth={isMajor ? 0.8 : 0.5} opacity={isMajor ? 0.4 : 0.25} listening={false} />
                    );
                  }
                  for (let y = 0; y <= imgH; y += gridSpacingPx) {
                    const idx = Math.round(y / gridSpacingPx);
                    const isMajor = idx % majorEvery === 0;
                    gridLines.push(
                      <Line key={`gh-${idx}`} points={[0, y, imgW, y]} stroke={isMajor ? "#999" : "#ccc"} strokeWidth={isMajor ? 0.8 : 0.5} opacity={isMajor ? 0.4 : 0.25} listening={false} />
                    );
                  }
                  const rulerSize = 24 / stageScale;
                  const fontSize = Math.max(8, 10 / stageScale);
                  const rulerElements: JSX.Element[] = [];
                  rulerElements.push(
                    <Rect key="ruler-top-bg" x={0} y={0} width={imgW} height={rulerSize} fill="#f5f5f5" opacity={0.85} listening={false} />,
                    <Rect key="ruler-left-bg" x={0} y={0} width={rulerSize} height={imgH} fill="#f5f5f5" opacity={0.85} listening={false} />
                  );
                  for (let x = 0; x <= imgW; x += gridSpacingPx) {
                    const idx = Math.round(x / gridSpacingPx);
                    const isMajor = idx % majorEvery === 0;
                    const dist = idx * gridSpacingFt;
                    if (isMajor) {
                      rulerElements.push(
                        <Line key={`rt-${idx}`} points={[x, 0, x, rulerSize]} stroke="#666" strokeWidth={0.8} listening={false} />,
                        <Text key={`rtl-${idx}`} x={x + 2} y={2} text={`${dist}`} fontSize={fontSize} fill="#444" listening={false} />
                      );
                    } else {
                      rulerElements.push(
                        <Line key={`rt-${idx}`} points={[x, rulerSize * 0.5, x, rulerSize]} stroke="#999" strokeWidth={0.5} listening={false} />
                      );
                    }
                  }
                  for (let y = gridSpacingPx; y <= imgH; y += gridSpacingPx) {
                    const idx = Math.round(y / gridSpacingPx);
                    const isMajor = idx % majorEvery === 0;
                    const dist = idx * gridSpacingFt;
                    if (isMajor) {
                      rulerElements.push(
                        <Line key={`rl-${idx}`} points={[0, y, rulerSize, y]} stroke="#666" strokeWidth={0.8} listening={false} />,
                        <Text key={`rll-${idx}`} x={2} y={y + 2} text={`${dist}`} fontSize={fontSize} fill="#444" listening={false} />
                      );
                    } else {
                      rulerElements.push(
                        <Line key={`rl-${idx}`} points={[rulerSize * 0.5, y, rulerSize, y]} stroke="#999" strokeWidth={0.5} listening={false} />
                      );
                    }
                  }
                  rulerElements.push(
                    <Text key="ruler-unit" x={2} y={2} text={unitLabel} fontSize={fontSize} fill="#666" fontStyle="bold" listening={false} />
                  );
                  return [...gridLines, ...rulerElements];
                })()}

                {measurements.map((m, mIdx) => {
                  if (m.categoryId && hiddenCategoryIds.has(m.categoryId)) return null;
                  if (hideAiMeasurements && m.source === "AI") return null;
                  let points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                  const isAiMeasurement = m.source === "AI";
                  if (isAiMeasurement && m.type === "COUNT" && (!points || points.length === 0)) {
                    const aiMeasurements = measurements.filter(mm => mm.source === "AI" && mm.type === "COUNT");
                    const aiIdx = aiMeasurements.findIndex(mm => mm.id === m.id);
                    if (aiIdx >= 0) {
                      const pos = computeAiPosition(aiIdx, pageDims?.width || 2000);
                      points = [pos];
                    }
                  }
                  // Viewport culling — skip shapes that are entirely off-screen.
                  // This is the single biggest render-performance win for large
                  // plans with many measurements (only visible subset is drawn).
                  if (Array.isArray(points) && points.length > 0) {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (const p of points) {
                      if (p.x < minX) minX = p.x;
                      if (p.y < minY) minY = p.y;
                      if (p.x > maxX) maxX = p.x;
                      if (p.y > maxY) maxY = p.y;
                    }
                    if (maxX < viewportRect.left || minX > viewportRect.right ||
                        maxY < viewportRect.top  || minY > viewportRect.bottom) {
                      return null;
                    }
                  }
                  const isSelected = selectedMeasurementId === m.id;
                  const isHovered = !isSelected && hoveredMeasurementId === m.id;
                  const category = m.categoryId ? categories.find(c => c.id === m.categoryId) : null;
                  const catColor = validateHexColor(category?.color);
                  const baseColor = catColor || (
                    m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" ? "#2563eb" :
                    m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA" ? "#16a34a" :
                    m.type === "VOLUME" ? "#ea580c" :
                    m.type === "COUNT" ? "#dc2626" : "#f59e0b"
                  );

                  const handleMeasurementClick = (e: any) => {
                    if (activeTool === "select") {
                      e.cancelBubble = true;
                      e.evt.stopPropagation();
                      setSelectedMeasurementId(m.id === selectedMeasurementId ? null : m.id);
                      setSelectedSegmentIndex(null);
                    }
                  };

                  const mCategory = m.categoryId ? categories.find(c => c.id === m.categoryId) : null;
                  const mLineStyle = m.lineStyle || mCategory?.lineStyle || "solid";
                  const mLineWidth = m.lineWidth || mCategory?.lineWidth || 3;
                  const dashMap: Record<string, number[]> = {
                    solid: [],
                    dashed: [10, 5],
                    dotted: [2, 4],
                    "dash-dot": [10, 5, 2, 5],
                  };
                  const dashArray = dashMap[mLineStyle] || [];
                  const effectiveWidth = isSelected ? mLineWidth + 2 : mLineWidth;

                  const offsetLinePoints = (pts: number[], offset: number): number[] => {
                    const result: number[] = [];
                    for (let i = 0; i < pts.length - 2; i += 2) {
                      const dx = pts[i + 2] - pts[i];
                      const dy = pts[i + 3] - pts[i + 1];
                      const len = Math.sqrt(dx * dx + dy * dy) || 1;
                      const nx = -dy / len * offset;
                      const ny = dx / len * offset;
                      result.push(pts[i] + nx, pts[i + 1] + ny);
                    }
                    const lastI = pts.length - 2;
                    const dx = pts[lastI] - pts[lastI - 2];
                    const dy = pts[lastI + 1] - pts[lastI - 1];
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const nx = -dy / len * offset;
                    const ny = dx / len * offset;
                    result.push(pts[lastI] + nx, pts[lastI + 1] + ny);
                    return result;
                  };

                  if ((m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && points.length >= 2) {
                    if (points.length === 3 && currentSheet?.scalePxPerFoot) {
                      const [startPoint, middlePoint, endPoint] = points;
                      const arcSegment = createArcSegment(startPoint, endPoint, middlePoint, currentSheet.scalePxPerFoot);
                      if (arcSegment) {
                        const arcPoints = sampleArcPoints(arcSegment, 30);
                        const flatPoints = arcPoints.flatMap(p => [p.x, p.y]);
                        return mLineStyle === "double" ? (
                          <Fragment key={m.id}>
                            <Line points={offsetLinePoints(flatPoints, 2)} stroke={baseColor} strokeWidth={effectiveWidth} opacity={isSelected ? 1 : 0.8} perfectDrawEnabled={false} shadowEnabled={false} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                            <Line points={offsetLinePoints(flatPoints, -2)} stroke={baseColor} strokeWidth={effectiveWidth} opacity={isSelected ? 1 : 0.8} perfectDrawEnabled={false} shadowEnabled={false} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                          </Fragment>
                        ) : (
                          <Line
                            key={m.id}
                            points={flatPoints}
                            stroke={baseColor}
                            strokeWidth={effectiveWidth}
                            dash={dashArray.length > 0 ? dashArray : undefined}
                            opacity={isSelected ? 1 : 0.8}
                            perfectDrawEnabled={false}
                            shadowEnabled={false}
                            onClick={handleMeasurementClick}
                            onTap={handleMeasurementClick}
                          />
                        );
                      }
                    }
                    return mLineStyle === "double" ? (
                      <Fragment key={m.id}>
                        <Line points={offsetLinePoints([points[0].x, points[0].y, points[1].x, points[1].y], 2)} stroke={baseColor} strokeWidth={effectiveWidth} hitStrokeWidth={isMobile ? 20 : 0} opacity={isSelected ? 1 : 0.8} perfectDrawEnabled={false} shadowEnabled={false} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                        <Line points={offsetLinePoints([points[0].x, points[0].y, points[1].x, points[1].y], -2)} stroke={baseColor} strokeWidth={effectiveWidth} hitStrokeWidth={isMobile ? 20 : 0} opacity={isSelected ? 1 : 0.8} perfectDrawEnabled={false} shadowEnabled={false} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                      </Fragment>
                    ) : (
                      <Line
                        key={m.id}
                        points={[points[0].x, points[0].y, points[1].x, points[1].y]}
                        stroke={baseColor}
                        strokeWidth={effectiveWidth}
                        dash={dashArray.length > 0 ? dashArray : undefined}
                        hitStrokeWidth={isMobile ? 20 : 0}
                        opacity={isSelected ? 1 : 0.8}
                        perfectDrawEnabled={false}
                        shadowEnabled={false}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if ((m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && points.length >= 3) {
                    const flatPoints = points.flatMap((p: { x: number; y: number }) => [p.x, p.y]);
                    const deductPolygons: Array<{ points: { x: number; y: number }[]; areaFt2: number; label?: string }> = (() => {
                      try {
                        const parsed = m.deductions ? JSON.parse(m.deductions as string) : [];
                        return Array.isArray(parsed) ? parsed.filter((d: { points?: Array<{ x: number; y: number }>; areaFt2?: number; label?: string }) => d.points && Array.isArray(d.points)) : [];
                      } catch (err) { console.warn("[Takeoff] Failed to parse area deductions:", err); return []; }
                    })();
                    return (
                      <Fragment key={m.id}>
                        <Line
                          points={flatPoints}
                          stroke={isSelected || isHovered ? baseColor : hexToRgba(baseColor, 0.6)}
                          strokeWidth={isSelected ? effectiveWidth : isHovered ? Math.max(effectiveWidth, 2.5 / stageScale) : Math.max(1 / stageScale, 1)}
                          dash={dashArray.length > 0 ? dashArray : undefined}
                          hitStrokeWidth={isMobile ? 20 : 0}
                          fill={isSelected ? hexToRgba(baseColor, 0.3) : isHovered ? hexToRgba(baseColor, 0.28) : hexToRgba(baseColor, 0.07)}
                          opacity={isSelected ? 1 : isHovered ? 1 : 0.85}
                          closed={true}
                          perfectDrawEnabled={false}
                          shadowEnabled={false}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                        {deductPolygons.map((dp, dpIdx) => (
                          <Line
                            key={`${m.id}-deduct-${dpIdx}`}
                            points={dp.points.flatMap((p: { x: number; y: number }) => [p.x, p.y])}
                            stroke="#ef4444"
                            strokeWidth={2}
                            dash={[6, 4]}
                            fill="rgba(239,68,68,0.12)"
                            closed={true}
                            listening={false}
                            perfectDrawEnabled={false}
                            shadowEnabled={false}
                          />
                        ))}
                      </Fragment>
                    );
                  } else if (m.type === "VOLUME" && points.length >= 3) {
                    const flatPoints = points.flatMap((p: { x: number; y: number }) => [p.x, p.y]);
                    const deductPolygons: Array<{ points: { x: number; y: number }[]; areaFt2: number; label?: string }> = (() => {
                      try {
                        const parsed = m.deductions ? JSON.parse(m.deductions as string) : [];
                        return Array.isArray(parsed) ? parsed.filter((d: { points?: Array<{ x: number; y: number }>; areaFt2?: number; label?: string }) => d.points && Array.isArray(d.points)) : [];
                      } catch (err) { console.warn("[Takeoff] Failed to parse area deductions:", err); return []; }
                    })();
                    return (
                      <Fragment key={m.id}>
                        <Line
                          points={flatPoints}
                          stroke={isSelected || isHovered ? baseColor : hexToRgba(baseColor, 0.6)}
                          strokeWidth={isSelected ? effectiveWidth : isHovered ? Math.max(effectiveWidth, 2.5 / stageScale) : Math.max(1 / stageScale, 1)}
                          dash={dashArray.length > 0 ? dashArray : undefined}
                          hitStrokeWidth={isMobile ? 20 : 0}
                          fill={isSelected ? hexToRgba(baseColor, 0.3) : isHovered ? hexToRgba(baseColor, 0.28) : hexToRgba(baseColor, 0.07)}
                          opacity={isSelected ? 1 : isHovered ? 1 : 0.85}
                          closed={true}
                          perfectDrawEnabled={false}
                          shadowEnabled={false}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                        {deductPolygons.map((dp, dpIdx) => (
                          <Line
                            key={`${m.id}-deduct-${dpIdx}`}
                            points={dp.points.flatMap((p: { x: number; y: number }) => [p.x, p.y])}
                            stroke="#ef4444"
                            strokeWidth={2}
                            dash={[6, 4]}
                            fill="rgba(239,68,68,0.12)"
                            closed={true}
                            listening={false}
                            perfectDrawEnabled={false}
                            shadowEnabled={false}
                          />
                        ))}
                      </Fragment>
                    );
                  } else if (m.type === "COUNT" && points.length >= 1) {
                    if (isAiMeasurement) {
                      const aiColor = "#8b5cf6";
                      let meta: any = {};
                      try { meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch (err) { console.warn("[Takeoff] Failed to parse count metadata:", err); }
                      const qtyText = `${m.count ?? meta.quantity ?? 1} ${meta.unit || "EA"}`;
                      const labelText = m.label || "AI Item";
                      const displayText = `${labelText} — ${qtyText}`;
                      const confText = meta.confidence ? `${meta.confidence}%` : "";
                      return (
                        <Group
                          key={m.id}
                          x={points[0].x}
                          y={points[0].y}
                          draggable={activeTool === "select"}
                          onDragEnd={(e: any) => {
                            const newX = e.target.x();
                            const newY = e.target.y();
                            updateMeasurementMutation.mutate({
                              id: m.id,
                              points: JSON.stringify([{ x: newX, y: newY }]),
                            });
                          }}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                          onContextMenu={(e: any) => {
                            e.evt.preventDefault();
                            e.cancelBubble = true;
                            const stage = stageRef.current;
                            if (stage) {
                              const containerRect = containerRef.current?.getBoundingClientRect();
                              if (containerRect) {
                                setMeasurementContextMenu({
                                  x: e.evt.clientX - containerRect.left,
                                  y: e.evt.clientY - containerRect.top,
                                  measurementId: m.id,
                                });
                                setSelectedMeasurementId(m.id);
                              }
                            }
                          }}
                        >
                          <Circle
                            x={0}
                            y={0}
                            radius={isSelected ? 16 : 13}
                            fill={aiColor}
                            stroke={isSelected ? "#fbbf24" : "white"}
                            strokeWidth={isSelected ? 3 : 2}
                            opacity={isSelected ? 1 : 0.85}
                            shadowEnabled={isSelected}
                            shadowColor="rgba(139,92,246,0.4)"
                            shadowBlur={8}
                            shadowOffsetY={2}
                            perfectDrawEnabled={false}
                          />
                          <Text
                            x={0}
                            y={0}
                            text="✦"
                            fontSize={12}
                            fill="white"
                            fontStyle="bold"
                            align="center"
                            verticalAlign="middle"
                            offsetX={6}
                            offsetY={7}
                            listening={false}
                          />
                          <Rect
                            x={20}
                            y={-14}
                            width={Math.max(displayText.length * 6.5 + 16, 100)}
                            height={confText ? 36 : 24}
                            fill={isSelected ? aiColor : "rgba(139,92,246,0.9)"}
                            cornerRadius={6}
                            stroke={isSelected ? "#fbbf24" : "rgba(255,255,255,0.3)"}
                            strokeWidth={isSelected ? 2 : 1}
                            shadowEnabled={isSelected}
                            shadowColor="rgba(0,0,0,0.2)"
                            shadowBlur={4}
                            shadowOffsetY={2}
                            opacity={isSelected ? 1 : 0.9}
                            perfectDrawEnabled={false}
                          />
                          <Text
                            x={28}
                            y={confText ? -10 : -6}
                            text={displayText}
                            fontSize={11}
                            fill="white"
                            fontStyle="bold"
                            listening={false}
                          />
                          {confText && (
                            <Text
                              x={28}
                              y={6}
                              text={`Confidence: ${confText}`}
                              fontSize={9}
                              fill="rgba(255,255,255,0.7)"
                              listening={false}
                            />
                          )}
                        </Group>
                      );
                    }
                    return (
                      <Circle
                        key={m.id}
                        x={points[0].x}
                        y={points[0].y}
                        radius={isSelected ? (isMobile ? 18 : 14) : (isMobile ? 16 : 12)}
                        fill={baseColor}
                        stroke="white"
                        strokeWidth={isSelected ? 3 : 2}
                        opacity={isSelected ? 1 : 0.8}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                        hitStrokeWidth={isMobile ? 15 : 0}
                      />
                    );
                  } else if (m.type === "NOTE" && points.length >= 1) {
                    return (
                      <Fragment key={m.id}>
                        <Circle
                          x={points[0].x}
                          y={points[0].y}
                          radius={isSelected ? (isMobile ? 14 : 10) : (isMobile ? 12 : 8)}
                          fill={baseColor}
                          stroke="white"
                          strokeWidth={isSelected ? 3 : 2}
                          opacity={isSelected ? 1 : 0.8}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                        <Text
                          x={points[0].x + 15}
                          y={points[0].y - 5}
                          text={m.label || "Note"}
                          fontSize={isSelected ? 14 : 12}
                          fill={baseColor}
                          fontStyle="bold"
                          opacity={isSelected ? 1 : 0.8}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                      </Fragment>
                    );
                  } else if (m.type === "SEGMENT" && points.length >= 2) {
                    const segProps = (() => {
                      try {
                        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
                        return meta?.segmentProperties || [];
                      } catch (err) { console.warn("[Takeoff] Failed to parse segment properties:", err); return []; }
                    })();
                    const segmentColors = ["#2563eb", "#dc2626", "#16a34a", "#ea580c", "#8b5cf6", "#0891b2", "#d97706", "#be185d"];
                    return (
                      <Fragment key={m.id}>
                        {points.slice(0, -1).map((p: any, i: number) => {
                          const segColor = segProps[i]?.color || segmentColors[i % segmentColors.length];
                          const isSegSelected = isSelected && selectedSegmentIndex === i;
                          return (
                            <Line
                              key={`${m.id}-seg-${i}`}
                              points={[p.x, p.y, points[i + 1].x, points[i + 1].y]}
                              stroke={segColor}
                              strokeWidth={isSegSelected ? 6 : isSelected ? 4 : 3}
                              hitStrokeWidth={isMobile ? 20 : 10}
                              opacity={isSegSelected ? 1 : isSelected ? 0.9 : 0.8}
                              onClick={(e: any) => {
                                if (activeTool === "select") {
                                  e.cancelBubble = true;
                                  e.evt.stopPropagation();
                                  setSelectedMeasurementId(m.id);
                                  setSelectedSegmentIndex(i);
                                }
                              }}
                              onTap={(e: any) => {
                                if (activeTool === "select") {
                                  e.cancelBubble = true;
                                  e.evt.stopPropagation();
                                  setSelectedMeasurementId(m.id);
                                  setSelectedSegmentIndex(i);
                                }
                              }}
                            />
                          );
                        })}
                        {points.map((p: any, i: number) => (
                          <Circle
                            key={`${m.id}-node-${i}`}
                            x={p.x}
                            y={p.y}
                            radius={isSelected ? (isMobile ? 8 : 6) : (isMobile ? 6 : 4)}
                            fill="white"
                            stroke={baseColor}
                            strokeWidth={2}
                            onClick={(e: any) => {
                              if (activeTool === "select") {
                                e.cancelBubble = true;
                                e.evt.stopPropagation();
                                setSelectedMeasurementId(m.id);
                                setSelectedSegmentIndex(null);
                              }
                            }}
                            onTap={(e: any) => {
                              if (activeTool === "select") {
                                e.cancelBubble = true;
                                e.evt.stopPropagation();
                                setSelectedMeasurementId(m.id);
                                setSelectedSegmentIndex(null);
                              }
                            }}
                          />
                        ))}
                      </Fragment>
                    );
                  }
                  return null;
                })}

                {showMeasurementLabels && measurements.map((m) => {
                  if (m.categoryId && hiddenCategoryIds.has(m.categoryId)) return null;
                  if (m.categoryId && labelHiddenCategories.has(m.categoryId)) return null;
                  if (hideAiMeasurements && m.source === "AI") return null;
                  const center = getMeasurementCenter(m);
                  if (!center) return null;
                  // Viewport culling for labels — skip off-screen label groups.
                  if (center.x < viewportRect.left || center.x > viewportRect.right ||
                      center.y < viewportRect.top  || center.y > viewportRect.bottom) {
                    return null;
                  }
                  const category = m.categoryId ? categories.find(c => c.id === m.categoryId) : null;
                  const catColor = validateHexColor(category?.color);
                  const baseColor = catColor || (
                    m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" ? "#2563eb" :
                    m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA" ? "#16a34a" :
                    m.type === "VOLUME" ? "#ea580c" :
                    m.type === "COUNT" ? "#dc2626" : "#f59e0b"
                  );
                  let labelText = m.label || "";
                  if (m.computedLengthFt) labelText += `\n${Number(m.computedLengthFt).toFixed(1)} LF`;
                  if (m.computedAreaFt2) {
                    let displayArea = Number(m.computedAreaFt2);
                    try {
                      const deductions: Array<{ width?: number; height?: number; points?: Array<{ x: number; y: number }>; areaFt2?: number }> = m.deductions ? JSON.parse(m.deductions as string) : [];
                      if (deductions.length > 0) {
                        const mainPts = parseMeasurementPoints(m);
                        const polyDeductPolygons = deductions.filter(d => d.points && Array.isArray(d.points)).map(d => d.points!);
                        const wHDeductionSf = deductions.filter(d => !d.points).reduce((sum, d) => sum + ((d.width || 0) * (d.height || 0)), 0);
                        let polyDeductionSf = 0;
                        if (polyDeductPolygons.length > 0 && currentSheet?.scalePxPerFoot && mainPts.length >= 3) {
                          const netResult = computeNetAreaInFt2(mainPts, polyDeductPolygons, currentSheet.scalePxPerFoot);
                          polyDeductionSf = netResult.deductionArea;
                        } else {
                          polyDeductionSf = deductions.filter(d => d.points).reduce((sum, d) => sum + (d.areaFt2 || 0), 0);
                        }
                        displayArea = Math.max(0, displayArea - wHDeductionSf - polyDeductionSf);
                      }
                    } catch (err) {
                      console.warn("[Takeoff] Failed to compute deduction area:", err);
                    }
                    labelText += `\n${displayArea.toFixed(1)} SF`;
                  }
                  const mRecord = m as Record<string, unknown>;
                  if (mRecord.computedSurfaceAreaFt2) labelText += `\n${Number(mRecord.computedSurfaceAreaFt2).toFixed(1)} SF surf`;
                  if (m.computedVolumeCy) labelText += `\n${Number(m.computedVolumeCy).toFixed(2)} CY`;
                  if (m.type === "COUNT") labelText += `\n${m.count || 1} EA`;
                  try {
                    const meta = m.metadata ? (typeof m.metadata === "string" ? JSON.parse(m.metadata) : m.metadata) : null;
                    if (meta?.perimeterFt) labelText += `\n${Number(meta.perimeterFt).toFixed(1)} LF perim`;
                  } catch (err) {
                    console.warn("[Takeoff] Failed to parse measurement metadata:", err);
                  }
                  if (!labelText.trim()) return null;
                  const fontSize = Math.max(10, Math.min(14, 12 / stageScale));
                  const lines = labelText.trim().split("\n");
                  const maxLineLen = Math.max(...lines.map(l => l.length));
                  const bgWidth = maxLineLen * fontSize * 0.52 + 12;
                  const bgHeight = lines.length * (fontSize + 3) + 6;
                  const mColor = m.color || baseColor;
                  return (
                    <Group key={`label-${m.id}`} x={center.x} y={center.y} listening={false}>
                      <Rect
                        x={-2}
                        y={-2}
                        width={bgWidth}
                        height={bgHeight}
                        fill="rgba(0,0,0,0.8)"
                        cornerRadius={3}
                      />
                      <Rect
                        x={-2}
                        y={-2}
                        width={3}
                        height={bgHeight}
                        fill={mColor}
                        cornerRadius={[3, 0, 0, 3]}
                      />
                      <Text
                        text={labelText.trim()}
                        fontSize={fontSize}
                        fill="white"
                        fontStyle="bold"
                        fontFamily="system-ui, sans-serif"
                        padding={4}
                        x={2}
                      />
                    </Group>
                  );
                })}

                {showStructuralGridlines && pdfImage && (() => {
                  const imgW = (pageDims?.width || 0);
                  const imgH = (pageDims?.height || 0);
                  const elements: JSX.Element[] = [];
                  structuralGridlines.vertical.forEach((gl, i) => {
                    const x = gl.position;
                    if (x < 0 || x > imgW) return;
                    elements.push(
                      <Line key={`sgl-v-${i}`} points={[x, 0, x, imgH]} stroke="#9333ea" strokeWidth={1.5} dash={[12, 6]} opacity={0.6} listening={false} />,
                      <Group key={`sgl-vl-${i}`} x={x} y={10} listening={false}>
                        <Rect x={-12} y={-4} width={24} height={18} fill="#9333ea" cornerRadius={3} opacity={0.85} />
                        <Text text={gl.label} x={-10} y={-1} fontSize={11} fill="white" fontStyle="bold" width={20} align="center" />
                      </Group>
                    );
                  });
                  structuralGridlines.horizontal.forEach((gl, i) => {
                    const y = gl.position;
                    if (y < 0 || y > imgH) return;
                    elements.push(
                      <Line key={`sgl-h-${i}`} points={[0, y, imgW, y]} stroke="#9333ea" strokeWidth={1.5} dash={[12, 6]} opacity={0.6} listening={false} />,
                      <Group key={`sgl-hl-${i}`} x={10} y={y} listening={false}>
                        <Rect x={-4} y={-12} width={18} height={24} fill="#9333ea" cornerRadius={3} opacity={0.85} />
                        <Text text={gl.label} x={-2} y={-9} fontSize={11} fill="white" fontStyle="bold" width={14} align="center" />
                      </Group>
                    );
                  });
                  return elements;
                })()}

                {/* Hover-from-sidebar highlight — a steady glow ring drawn
                    around whichever measurement the user is hovering in the
                    sidebar list so they can instantly locate it on the plan. */}
                {hoveredMeasurementId && !flashMeasurementId && (() => {
                  const hm = measurements.find(m => m.id === hoveredMeasurementId);
                  if (!hm) return null;
                  const center = getMeasurementCenter(hm);
                  if (!center) return null;
                  const r = 28 / stageScale;
                  return (
                    <Group key={`hover-ring-${hoveredMeasurementId}`} listening={false}>
                      <Circle
                        x={center.x}
                        y={center.y}
                        radius={r}
                        fill="rgba(251,191,36,0.15)"
                        stroke="#fbbf24"
                        strokeWidth={3 / stageScale}
                        opacity={0.85}
                        perfectDrawEnabled={false}
                        shadowEnabled={false}
                      />
                      <Circle
                        x={center.x}
                        y={center.y}
                        radius={r * 1.6}
                        fill="transparent"
                        stroke="#fbbf24"
                        strokeWidth={1.5 / stageScale}
                        opacity={0.4}
                        perfectDrawEnabled={false}
                        shadowEnabled={false}
                      />
                    </Group>
                  );
                })()}

                {flashMeasurementId && flashPulse > 0 && (() => {
                  const fm = measurements.find(m => m.id === flashMeasurementId);
                  if (!fm) return null;
                  const center = getMeasurementCenter(fm);
                  if (!center) return null;
                  const r1 = (20 + flashPulse * 20) / stageScale;
                  const r2 = (35 + flashPulse * 25) / stageScale;
                  const r3 = (50 + flashPulse * 30) / stageScale;
                  return (
                    <Group key={`flash-${flashMeasurementId}`} listening={false}>
                      <Circle
                        x={center.x}
                        y={center.y}
                        radius={r1}
                        fill="transparent"
                        stroke="#f59e0b"
                        strokeWidth={(2 + flashPulse * 2) / stageScale}
                        opacity={flashPulse * 0.9}
                      />
                      <Circle
                        x={center.x}
                        y={center.y}
                        radius={r2}
                        fill="transparent"
                        stroke="#f59e0b"
                        strokeWidth={(1.5 + flashPulse) / stageScale}
                        opacity={flashPulse * 0.6}
                      />
                      <Circle
                        x={center.x}
                        y={center.y}
                        radius={r3}
                        fill="transparent"
                        stroke="#f59e0b"
                        strokeWidth={(1 + flashPulse * 0.5) / stageScale}
                        opacity={flashPulse * 0.3}
                      />
                    </Group>
                  );
                })()}

                {/* Task #2199 — Polar tracking guide rays. Painted UNDER
                    the in-progress segment / fills so the bright preview
                    line stays the most prominent stroke; the matching
                    snapped ray is highlighted so users can see exactly
                    which angle they'll commit to. */}
                {polarGuideStep != null && isDrawing && drawingPoints.length > 0 && (() => {
                  const anchor = drawingPoints[drawingPoints.length - 1];
                  const step = polarGuideStep;
                  const MAX_RAYS = 24;
                  const rayCount = Math.min(MAX_RAYS, Math.max(1, Math.floor(360 / step)));
                  const safeScale = stageScale > 0 ? stageScale : 1;
                  // Viewport diagonal in stage units, doubled so a ray
                  // from any anchor still covers the visible canvas
                  // even under sheet rotation. Konva clips off-canvas
                  // pixels so overshooting is harmless.
                  const rayLen =
                    (Math.sqrt(
                      stageDimensions.width * stageDimensions.width +
                        stageDimensions.height * stageDimensions.height,
                    ) /
                      safeScale) *
                    2;
                  let activeIdx = -1;
                  let cursorDistPx = 0;
                  if (cursorPosition) {
                    const dx = cursorPosition.x - anchor.x;
                    const dy = cursorPosition.y - anchor.y;
                    cursorDistPx = Math.sqrt(dx * dx + dy * dy);
                    if (dx !== 0 || dy !== 0) {
                      const cursorDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
                      const idx = Math.round(cursorDeg / step);
                      activeIdx = ((idx % rayCount) + rayCount) % rayCount;
                    }
                  }
                  const baseStroke = 1 / safeScale;
                  const baseDash = [4 / safeScale, 4 / safeScale];
                  const activeStroke = 1.5 / safeScale;
                  const activeDash = [8 / safeScale, 4 / safeScale];
                  /* Task #2236 — Cursor-side label for the highlighted
                   * ray. Hidden when the cursor is sitting on the
                   * anchor (no meaningful bearing) — we use a small
                   * 4-screen-pixel deadband so jitter at the start of
                   * a draw doesn't flicker the label in/out. */
                  const labelDeadbandPx = 4 / safeScale;
                  const showLabel =
                    cursorPosition != null &&
                    activeIdx !== -1 &&
                    cursorDistPx > labelDeadbandPx;
                  let labelText = "";
                  if (showLabel) {
                    const snappedScreenDeg = activeIdx * step;
                    const distFt = currentSheet?.scalePxPerFoot
                      ? cursorDistPx / currentSheet.scalePxPerFoot
                      : null;
                    labelText = formatPolarGuideLabel(snappedScreenDeg, distFt);
                  }
                  // Compact, monospace badge sized to the text. Offset
                  // away from the cursor so it doesn't sit under the
                  // crosshair and obscure the snap point.
                  const labelFontSize = 11 / safeScale;
                  const labelCharW = 6.6 / safeScale;
                  const labelPadX = 6 / safeScale;
                  const labelPadY = 4 / safeScale;
                  const labelW = labelText.length * labelCharW + labelPadX * 2;
                  const labelH = labelFontSize + labelPadY * 2;
                  const labelX = (cursorPosition?.x ?? 0) + 16 / safeScale;
                  const labelY = (cursorPosition?.y ?? 0) - 32 / safeScale;
                  return (
                    <>
                      {Array.from({ length: rayCount }, (_, i) => {
                        const angleRad = (i * step * Math.PI) / 180;
                        const ex = anchor.x + Math.cos(angleRad) * rayLen;
                        const ey = anchor.y + Math.sin(angleRad) * rayLen;
                        const isActive = i === activeIdx;
                        return (
                          <Line
                            key={`polar-guide-${i}`}
                            points={[anchor.x, anchor.y, ex, ey]}
                            stroke={isActive ? "#06b6d4" : "#94a3b8"}
                            strokeWidth={isActive ? activeStroke : baseStroke}
                            dash={isActive ? activeDash : baseDash}
                            opacity={isActive ? 0.85 : 0.3}
                            listening={false}
                          />
                        );
                      })}
                      {showLabel && (
                        <Group listening={false} data-testid="polar-guide-label">
                          <Rect
                            x={labelX}
                            y={labelY}
                            width={labelW}
                            height={labelH}
                            fill="rgba(6, 182, 212, 0.92)"
                            cornerRadius={3 / safeScale}
                            shadowColor="rgba(0,0,0,0.35)"
                            shadowBlur={3 / safeScale}
                            shadowOffset={{ x: 0, y: 1 / safeScale }}
                          />
                          <Text
                            x={labelX + labelPadX}
                            y={labelY + labelPadY}
                            text={labelText}
                            fontSize={labelFontSize}
                            fill="#ffffff"
                            fontStyle="bold"
                            fontFamily="monospace"
                          />
                        </Group>
                      )}
                    </>
                  );
                })()}

                {isDrawing && drawingPoints.length > 0 && (
                  <>
                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 3 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        fill={hexToRgba(activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c", 0.15)}
                        closed={true}
                        strokeWidth={0}
                      />
                    )}

                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 2 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        stroke={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}

                    {activeTool === "deduct" && drawingPoints.length >= 2 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        stroke="#ef4444"
                        strokeWidth={2}
                        dash={[6, 4]}
                        fill={drawingPoints.length >= 3 ? "rgba(239,68,68,0.12)" : undefined}
                        closed={drawingPoints.length >= 3}
                      />
                    )}

                    {activeTool === "segment" && drawingPoints.length >= 2 && (
                      <>
                        {drawingPoints.slice(0, -1).map((p, i) => {
                          const segmentColors = ["#2563eb", "#dc2626", "#16a34a", "#ea580c", "#8b5cf6", "#0891b2", "#d97706", "#be185d"];
                          return (
                            <Line
                              key={`temp-seg-${i}`}
                              points={[p.x, p.y, drawingPoints[i + 1].x, drawingPoints[i + 1].y]}
                              stroke={segmentColors[i % segmentColors.length]}
                              strokeWidth={2}
                              dash={[5, 5]}
                            />
                          );
                        })}
                      </>
                    )}

                    {activeTool === "arc" && drawingPoints.length === 2 && currentSheet?.scalePxPerFoot && (
                      <Line
                        points={[drawingPoints[0].x, drawingPoints[0].y, drawingPoints[1].x, drawingPoints[1].y]}
                        stroke="#2563eb"
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}

                    {isDrawing && cursorPosition && drawingPoints.length > 0 && (
                      <Line
                        points={[
                          drawingPoints[drawingPoints.length - 1].x,
                          drawingPoints[drawingPoints.length - 1].y,
                          cursorPosition.x,
                          cursorPosition.y,
                        ]}
                        stroke={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : activeTool === "volume" ? "#ea580c" : activeTool === "deduct" ? "#ef4444" : "#2563eb"}
                        strokeWidth={1.5 / stageScale}
                        dash={[8 / stageScale, 4 / stageScale]}
                        opacity={0.7}
                      />
                    )}

                    {isDrawing && currentSheet?.scalePxPerFoot && drawingPoints.length >= 1 && (() => {
                      const scale = currentSheet.scalePxPerFoot;
                      const allPts = drawingPoints;
                      const labels: Array<{ x: number; y: number; text: string; angle: number }> = [];
                      for (let i = 0; i < allPts.length - 1; i++) {
                        const dx = allPts[i + 1].x - allPts[i].x;
                        const dy = allPts[i + 1].y - allPts[i].y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const ft = dist / scale;
                        if (ft < 0.1) continue;
                        const mx = (allPts[i].x + allPts[i + 1].x) / 2;
                        const my = (allPts[i].y + allPts[i + 1].y) / 2;
                        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                        if (angle > 90 || angle < -90) angle += 180;
                        labels.push({ x: mx, y: my - 8 / stageScale, text: `${ft.toFixed(2)}'`, angle: 0 });
                      }
                      return labels.map((lbl, i) => (
                        <Group key={`seg-lbl-${i}`}>
                          <Rect
                            x={lbl.x - (lbl.text.length * 3.5) / stageScale}
                            y={lbl.y - 6 / stageScale}
                            width={(lbl.text.length * 7) / stageScale}
                            height={13 / stageScale}
                            fill="rgba(0,0,0,0.75)"
                            cornerRadius={2 / stageScale}
                          />
                          <Text
                            x={lbl.x - (lbl.text.length * 3.2) / stageScale}
                            y={lbl.y - 4 / stageScale}
                            text={lbl.text}
                            fontSize={10 / stageScale}
                            fill="#fbbf24"
                            fontFamily="monospace"
                            fontStyle="bold"
                          />
                        </Group>
                      ));
                    })()}

                    {/* Task #2210 — Live angle/distance readout that
                        follows the cursor while drawing with the
                        ortho-angle constraint engaged. Mirrors CAD
                        polar-tracking tooltips ("045° / 12.34 ft") so
                        users can confirm both the bearing and length
                        before clicking. Hidden when constraint is none
                        (covered by the prop check) or when the cursor
                        sits exactly on the active anchor. Only paints
                        when the sheet is calibrated so the distance is
                        meaningful. Style mirrors the per-segment label
                        above to keep the canvas visually quiet. */}
                    {constraintMode === "ortho-angle" &&
                      cursorPosition &&
                      currentSheet?.scalePxPerFoot &&
                      (() => {
                        const anchor = drawingPoints[drawingPoints.length - 1];
                        const dx = cursorPosition.x - anchor.x;
                        const dy = cursorPosition.y - anchor.y;
                        const distPx = Math.sqrt(dx * dx + dy * dy);
                        // Hide while the cursor is still on the anchor —
                        // a 0-distance / undefined-angle badge would just
                        // flicker. ~2px in stage units is small enough
                        // to never dead-zone meaningful drags.
                        if (distPx < 2 / stageScale) return null;
                        const scale = currentSheet.scalePxPerFoot;
                        const unitLabel =
                          currentSheet.units === "m" ? "m" : "ft";
                        const distVal =
                          currentSheet.units === "m"
                            ? (distPx / scale) * 0.3048
                            : distPx / scale;
                        // Convert canvas atan2 (y grows downward) into a
                        // CAD-style bearing where 0° points right and
                        // angle grows counter-clockwise, normalised to
                        // [0, 360). Three-digit zero-padded matches the
                        // "045°" example in the task brief.
                        let bearing = -Math.atan2(dy, dx) * (180 / Math.PI);
                        bearing = ((bearing % 360) + 360) % 360;
                        // Round THEN re-modulo so a bearing of 359.6
                        // displays as "000°" instead of "360°" — keeps
                        // the wraparound clean at the +x axis.
                        const bearingDeg = Math.round(bearing) % 360;
                        const text = `${String(bearingDeg).padStart(3, "0")}° / ${distVal.toFixed(2)} ${unitLabel}`;
                        // Offset down-right of the cursor so the badge
                        // never sits under the pointer; matches the
                        // per-segment label's character-width math so
                        // the box hugs the text on both sides.
                        const padX = 14 / stageScale;
                        const padY = 14 / stageScale;
                        const charW = 7 / stageScale;
                        const boxW = text.length * charW;
                        const boxH = 13 / stageScale;
                        return (
                          <Group
                            listening={false}
                            data-testid="badge-ortho-angle-readout"
                          >
                            <Rect
                              x={cursorPosition.x + padX}
                              y={cursorPosition.y + padY}
                              width={boxW}
                              height={boxH}
                              fill="rgba(0,0,0,0.75)"
                              cornerRadius={2 / stageScale}
                            />
                            <Text
                              x={cursorPosition.x + padX + (3 / stageScale)}
                              y={cursorPosition.y + padY + (2 / stageScale)}
                              text={text}
                              fontSize={10 / stageScale}
                              fill="#fbbf24"
                              fontFamily="monospace"
                              fontStyle="bold"
                            />
                          </Group>
                        );
                      })()}

                    {drawingPoints.map((point, i) => (
                      <Group key={`temp-${i}`}>
                        <Circle
                          x={point.x}
                          y={point.y}
                          radius={isMobile ? 10 : 6}
                          fill={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : activeTool === "volume" ? "#ea580c" : "#2563eb"}
                          stroke="white"
                          strokeWidth={isMobile ? 3 : 2}
                        />
                        {drawingPoints.length > 1 && (
                          <Text
                            x={point.x + (isMobile ? 12 : 8) / stageScale}
                            y={point.y - (isMobile ? 12 : 8) / stageScale}
                            text={`${i + 1}`}
                            fontSize={9 / stageScale}
                            fill="white"
                            fontStyle="bold"
                          />
                        )}
                      </Group>
                    ))}

                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 3 && (
                      <Circle
                        x={drawingPoints[0].x}
                        y={drawingPoints[0].y}
                        radius={isMobile ? 16 : 10}
                        stroke={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={isMobile ? 4 : 3}
                        fill="transparent"
                        dash={[3, 3]}
                      />
                    )}

                    {activeTool === "deduct" && drawingPoints.length >= 3 && (
                      <Circle
                        x={drawingPoints[0].x}
                        y={drawingPoints[0].y}
                        radius={isMobile ? 16 : 10}
                        stroke="#ef4444"
                        strokeWidth={isMobile ? 4 : 3}
                        fill="transparent"
                        dash={[3, 3]}
                      />
                    )}
                  </>
                )}

                {/* Task #2781 — Calibration zone polygon overlays. Rendered before
                    calibration pick-point markers so the zone rectangles don't
                    obscure the active calibration line. Each zone is drawn as a
                    closed polygon with a semi-transparent fill and a labeled
                    centroid. Clicking a zone calls onSelectCalibrationZone so
                    the sidebar can scroll to and highlight the matching row. */}
                {/* Task #2786 — Render independently of pdfImage so e2e tests
                    can click the real Konva hit-test layer without a loaded PDF. */}
                {calibrationZones && calibrationZones.length > 0 && calibrationZones.map((zone) => {
                  const isBeingEdited = editingZoneId === zone.id;
                  // Task #2793 — While a zone is in vertex-drag reshape mode, render
                  // from editingZonePoints (the mutable draft) rather than the
                  // persisted polygon_points, so the canvas preview stays live.
                  const pts = isBeingEdited && editingZonePoints && editingZonePoints.length >= 3
                    ? editingZonePoints
                    : zone.polygon_points;
                  if (!pts || pts.length < 3) return null;
                  const isSelected = selectedCalibrationZoneId === zone.id;
                  // Task #2796 — cursor is inside this zone (but not click-selected).
                  // isActive drives a hover highlight: brighter outline + stronger fill.
                  const isActive = !isSelected && activeCalibrationZoneId === zone.id;
                  const flatPts = pts.flatMap((p: { x: number; y: number }) => [p.x, p.y]);
                  const cx = pts.reduce((s: number, p: { x: number; y: number }) => s + p.x, 0) / pts.length;
                  const cy = pts.reduce((s: number, p: { x: number; y: number }) => s + p.y, 0) / pts.length;
                  const sw = (isBeingEdited ? 2.5 : isSelected ? 2.5 : isActive ? 2 : 1.5) / stageScale;
                  const labelFontSize = Math.max(9, 13 / stageScale);
                  const scaleFontSize = Math.max(8, 11 / stageScale);
                  const labelW = 160 / stageScale;
                  return (
                    <Fragment key={`cal-zone-${zone.id}`}>
                      <Line
                        points={flatPts}
                        closed={true}
                        fill={
                          isBeingEdited ? "rgba(245,158,11,0.18)"
                          : isSelected  ? "rgba(6,182,212,0.22)"
                          : isActive    ? "rgba(6,182,212,0.18)"
                          :               "rgba(6,182,212,0.10)"
                        }
                        stroke={
                          isBeingEdited ? "rgba(245,158,11,1)"
                          : isSelected  ? "rgba(6,182,212,1)"
                          : isActive    ? "rgba(6,182,212,0.90)"
                          :               "rgba(6,182,212,0.60)"
                        }
                        strokeWidth={sw}
                        dash={isBeingEdited || isSelected || isActive ? undefined : [6 / stageScale, 3 / stageScale]}
                        listening={!isBeingEdited}
                        onClick={() => {
                          if (isBeingEdited) return;
                          // Task #2793 — When onZonePolygonClick is provided (calibration
                          // drawer is open), the parent decides whether to enter edit mode
                          // or just select. Without it, fall back to the plain select path.
                          if (onZonePolygonClick) {
                            onZonePolygonClick(zone);
                          } else {
                            onSelectCalibrationZone?.(isSelected ? null : zone.id);
                          }
                        }}
                        onTap={() => {
                          if (isBeingEdited) return;
                          if (onZonePolygonClick) {
                            onZonePolygonClick(zone);
                          } else {
                            onSelectCalibrationZone?.(isSelected ? null : zone.id);
                          }
                        }}
                        onMouseEnter={(e) => {
                          if (isBeingEdited) return;
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = "pointer";
                        }}
                        onMouseLeave={(e) => {
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = "default";
                        }}
                        data-testid={`canvas-zone-polygon-${zone.id}`}
                      />
                      <Text
                        x={cx}
                        y={cy - labelFontSize * 1.2}
                        text={zone.name}
                        fontSize={labelFontSize}
                        fontStyle="bold"
                        fill={
                          isBeingEdited ? "rgba(245,158,11,1)"
                          : isSelected  ? "rgba(6,182,212,1)"
                          : isActive    ? "rgba(6,182,212,1)"
                          :               "rgba(6,182,212,0.90)"
                        }
                        align="center"
                        width={labelW}
                        offsetX={labelW / 2}
                        listening={false}
                      />
                      <Text
                        x={cx}
                        y={cy + 2 / stageScale}
                        text={`${zone.px_per_foot.toFixed(1)} px/ft`}
                        fontSize={scaleFontSize}
                        fill={
                          isBeingEdited ? "rgba(245,158,11,0.90)"
                          : isSelected  ? "rgba(6,182,212,0.95)"
                          : isActive    ? "rgba(6,182,212,0.90)"
                          :               "rgba(6,182,212,0.75)"
                        }
                        align="center"
                        width={labelW}
                        offsetX={labelW / 2}
                        listening={false}
                      />
                      {/* Task #2793 — Draggable vertex handles shown only while this
                          zone is in reshape mode. Each Circle is draggable; its
                          dragmove calls onZoneVertexDrag(idx, newPos) so the parent
                          updates editingZonePoints and the polygon preview re-renders. */}
                      {isBeingEdited && pts.map((pt, i) => (
                        <Circle
                          key={`zone-edit-vtx-${zone.id}-${i}`}
                          x={pt.x}
                          y={pt.y}
                          radius={6 / stageScale}
                          fill="rgba(245,158,11,0.90)"
                          stroke="white"
                          strokeWidth={1.5 / stageScale}
                          draggable={true}
                          onDragMove={(e) => {
                            const node = e.target;
                            onZoneVertexDrag?.(i, { x: node.x(), y: node.y() });
                          }}
                          onMouseEnter={(e) => {
                            const container = e.target.getStage()?.container();
                            if (container) container.style.cursor = "crosshair";
                          }}
                          onMouseLeave={(e) => {
                            const container = e.target.getStage()?.container();
                            if (container) container.style.cursor = "default";
                          }}
                          perfectDrawEnabled={false}
                          data-testid={`canvas-zone-vertex-${zone.id}-${i}`}
                        />
                      ))}
                    </Fragment>
                  );
                })}

                {/* Task #2784 — In-progress zone polygon drawn by the user click-by-click.
                    Renders: dashed outline of the polygon-so-far, vertex handles,
                    a live preview line to the current cursor, and a snap-to-close
                    ring on the first vertex when ≥3 vertices have been placed. */}
                {zoneDrawingActive && zoneDrawPoints && zoneDrawPoints.length > 0 && (
                  <>
                    {zoneDrawPoints.length >= 2 && (
                      <Line
                        points={zoneDrawPoints.flatMap(p => [p.x, p.y])}
                        stroke="rgba(6,182,212,1)"
                        strokeWidth={2 / stageScale}
                        closed={false}
                        dash={[6 / stageScale, 3 / stageScale]}
                        fill="rgba(6,182,212,0.08)"
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}
                    {zoneDrawPoints.map((pt, i) => (
                      <Circle
                        key={`zdp-${i}`}
                        x={pt.x}
                        y={pt.y}
                        radius={(i === 0 ? 7 : 4) / stageScale}
                        fill={i === 0 ? "rgba(6,182,212,0.85)" : "rgba(6,182,212,0.6)"}
                        stroke="white"
                        strokeWidth={1.5 / stageScale}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    ))}
                    {cursorPosition && (
                      <Line
                        points={[
                          zoneDrawPoints[zoneDrawPoints.length - 1].x,
                          zoneDrawPoints[zoneDrawPoints.length - 1].y,
                          cursorPosition.x,
                          cursorPosition.y,
                        ]}
                        stroke="rgba(6,182,212,0.55)"
                        strokeWidth={1.5 / stageScale}
                        dash={[4 / stageScale, 3 / stageScale]}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}
                    {zoneDrawPoints.length >= 3 && (
                      <Circle
                        x={zoneDrawPoints[0].x}
                        y={zoneDrawPoints[0].y}
                        radius={14 / stageScale}
                        stroke="rgba(6,182,212,1)"
                        strokeWidth={2 / stageScale}
                        fill="rgba(6,182,212,0.18)"
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                    )}
                  </>
                )}

                {calibrationPoints.map((point, i) => (
                  <Circle
                    key={`cal-${i}`}
                    x={point.x}
                    y={point.y}
                    radius={8}
                    fill="red"
                    stroke="white"
                    strokeWidth={2}
                  />
                ))}

                {calibrationPoints.length === 2 && (
                  <Line
                    points={[
                      calibrationPoints[0].x, calibrationPoints[0].y,
                      calibrationPoints[1].x, calibrationPoints[1].y
                    ]}
                    stroke="red"
                    strokeWidth={2}
                    dash={[10, 5]}
                  />
                )}

                {verifyPoints.map((point, i) => (
                  <Circle
                    key={`verify-${i}`}
                    x={point.x}
                    y={point.y}
                    radius={8}
                    fill="#f59e0b"
                    stroke="white"
                    strokeWidth={2}
                  />
                ))}
                {verifyPoints.length === 2 && (
                  <Line
                    points={[verifyPoints[0].x, verifyPoints[0].y, verifyPoints[1].x, verifyPoints[1].y]}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dash={[8, 4]}
                  />
                )}

                {currentSnap && currentSnap.isSnapped && currentSnap.snapTarget && (
                  <>
                    <Circle
                      x={currentSnap.snappedPoint.x}
                      y={currentSnap.snappedPoint.y}
                      radius={8 / stageScale}
                      stroke="#f59e0b"
                      strokeWidth={2 / stageScale}
                      fill="transparent"
                    />
                    <Line
                      points={[
                        currentSnap.snappedPoint.x - 12 / stageScale, currentSnap.snappedPoint.y,
                        currentSnap.snappedPoint.x + 12 / stageScale, currentSnap.snappedPoint.y,
                      ]}
                      stroke="#f59e0b"
                      strokeWidth={1 / stageScale}
                    />
                    <Line
                      points={[
                        currentSnap.snappedPoint.x, currentSnap.snappedPoint.y - 12 / stageScale,
                        currentSnap.snappedPoint.x, currentSnap.snappedPoint.y + 12 / stageScale,
                      ]}
                      stroke="#f59e0b"
                      strokeWidth={1 / stageScale}
                    />
                    <Text
                      x={currentSnap.snappedPoint.x + 14 / stageScale}
                      y={currentSnap.snappedPoint.y - 6 / stageScale}
                      text={
                        currentSnap.snapTarget.type === "endpoint" ? "End" :
                        currentSnap.snapTarget.type === "midpoint" ? "Mid" :
                        currentSnap.snapTarget.type === "intersection" ? "Int" :
                        currentSnap.snapTarget.type === "perpendicular" ? "Perp" :
                        currentSnap.snapTarget.type === "center" ? "Cen" :
                        currentSnap.snapTarget.type === "nearest" ? "Near" : "Snap"
                      }
                      fontSize={11 / stageScale}
                      fill={currentSnap.snapTarget.type === "intersection" ? "#ef4444" : "#f59e0b"}
                      fontStyle="bold"
                    />
                  </>
                )}

                {runningMeasurement && isDrawing && cursorPosition && (() => {
                  const costPerUnit = activeCondition?.unitCost ? Number(activeCondition.unitCost) : 0;
                  const liveCost = costPerUnit > 0 ? runningMeasurement.value * costPerUnit : 0;
                  const measureText = `${runningMeasurement.value.toFixed(2)} ${runningMeasurement.unit}${runningMeasurement.segments && runningMeasurement.unit === "SF" ? ` | ${(runningMeasurement.segments as number).toFixed(1)} LF` : ""}`;
                  const costText = liveCost > 0 ? ` | $${liveCost.toFixed(2)}` : "";
                  const fullText = measureText + costText;
                  return (
                    <Group>
                      <Rect
                        x={cursorPosition.x + 18 / stageScale}
                        y={cursorPosition.y - 28 / stageScale}
                        width={Math.max(80, fullText.length * 7.5) / stageScale}
                        height={22 / stageScale}
                        fill="rgba(0,0,0,0.85)"
                        cornerRadius={4 / stageScale}
                      />
                      <Text
                        x={cursorPosition.x + 24 / stageScale}
                        y={cursorPosition.y - 24 / stageScale}
                        text={fullText}
                        fontSize={13 / stageScale}
                        fill={liveCost > 0 ? "#4ade80" : "#22d3ee"}
                        fontStyle="bold"
                        fontFamily="monospace"
                      />
                    </Group>
                  );
                })()}

                {!runningMeasurement && isDrawing && drawingPoints.length > 0 && cursorPosition && (
                  <Group>
                    <Rect
                      x={cursorPosition.x + 18 / stageScale}
                      y={cursorPosition.y - 28 / stageScale}
                      width={120 / stageScale}
                      height={22 / stageScale}
                      fill="rgba(0,0,0,0.75)"
                      cornerRadius={4 / stageScale}
                      listening={false}
                    />
                    <Text
                      x={cursorPosition.x + 24 / stageScale}
                      y={cursorPosition.y - 24 / stageScale}
                      text="Set scale to measure"
                      fontSize={11 / stageScale}
                      fill="#f59e0b"
                      fontStyle="bold"
                      fontFamily="monospace"
                      listening={false}
                    />
                  </Group>
                )}

                {orthoLock && isDrawing && drawingPoints.length > 0 && cursorPosition && (
                  <Line
                    points={[
                      drawingPoints[drawingPoints.length - 1].x,
                      drawingPoints[drawingPoints.length - 1].y,
                      cursorPosition.x,
                      cursorPosition.y,
                    ]}
                    stroke="#06b6d4"
                    strokeWidth={1 / stageScale}
                    dash={[6 / stageScale, 4 / stageScale]}
                    opacity={0.6}
                  />
                )}

                {/* Task #2331 — Live capture-quality HUD. Stacks one
                    row above the runningMeasurement pill so the user
                    sees Snap-hit ratio + most-used mode without
                    looking away from the cursor. Hidden until the
                    draft has 2+ vertices (no value on first click);
                    resets when the draft commits or is cancelled
                    (state lives in `useTakeoffInteractions`). */}
                {snapStats && (
                  <CaptureQualityHUD
                    isDrawing={isDrawing}
                    cursorPosition={cursorPosition}
                    drawingPointsCount={drawingPoints.length}
                    snapStats={snapStats}
                    stageScale={stageScale}
                  />
                )}

                {/* Task #2203 / #2227 — Active typed-dimension lock
                    cursor badge. Hidden when not drawing or no length
                    is locked. Chain mode swaps to an amber palette +
                    "Chain" label. Extracted into `DimInputCursorBadge`
                    so its conditional contract is unit-tested in
                    `__tests__/DimInputCursorBadge.test.tsx`. */}
                <DimInputCursorBadge
                  isDrawing={isDrawing}
                  cursorPosition={cursorPosition}
                  pendingDimLengthFt={pendingDimLengthFt}
                  dimInputRepeat={dimInputRepeat}
                  stageScale={stageScale}
                />

                {issues.map((issue: any) => {
                  if (!issue.position) return null;
                  if (hideResolvedIssues && issue.status === "RESOLVED") return null;
                  let pos: { x: number; y: number };
                  try { pos = typeof issue.position === "string" ? JSON.parse(issue.position) : issue.position; } catch (err) { console.warn("[Takeoff] Failed to parse issue position:", err); return null; }
                  const x = pos.x;
                  const y = pos.y;
                  const isSelected = selectedIssueId === issue.id;
                  const fill = issue.status === "RESOLVED" ? "#16a34a" : issue.status === "IN_REVIEW" ? "#d97706" : "#dc2626";
                  const radius = 14 / stageScale;
                  const fontSize = 10 / stageScale;
                  const strokeWidth = isSelected ? 3 / stageScale : 2 / stageScale;
                  return (
                    <Group
                      key={issue.id}
                      x={x}
                      y={y}
                      draggable={activeTool === "select"}
                      onClick={(e: any) => {
                        e.cancelBubble = true;
                        setSelectedIssueId(issue.id === selectedIssueId ? null : issue.id);
                      }}
                      onTap={(e: any) => {
                        e.cancelBubble = true;
                        setSelectedIssueId(issue.id === selectedIssueId ? null : issue.id);
                      }}
                      onDragStart={(e: any) => {
                        e.cancelBubble = true;
                      }}
                      onDragMove={(e: any) => {
                        e.cancelBubble = true;
                        const pt = getEventClientPoint(e.evt);
                        if (pt) updateIssueDropTarget(pt.x, pt.y);
                      }}
                      onDragEnd={(e: any) => {
                        e.cancelBubble = true;
                        const node = e.target;
                        const pt = getEventClientPoint(e.evt);
                        const target = pt ? updateIssueDropTarget(pt.x, pt.y) : null;
                        clearIssueDropTarget();
                        const dropSheetId = target?.getAttribute("data-pin-drop-sheet");
                        if (dropSheetId && dropSheetId !== issue.sheetId) {
                          node.position({ x, y });
                          moveIssueMutation.mutate({ issueId: issue.id, sheetId: dropSheetId });
                          return;
                        }
                        const newX = node.x();
                        const newY = node.y();
                        if (Math.abs(newX - x) < 0.5 && Math.abs(newY - y) < 0.5) {
                          node.position({ x, y });
                          return;
                        }
                        moveIssueMutation.mutate({
                          issueId: issue.id,
                          position: { x: newX, y: newY },
                        });
                      }}
                      style={{ cursor: activeTool === "select" ? "grab" : "pointer" }}
                    >
                      <Circle
                        radius={radius}
                        fill={fill}
                        stroke={isSelected ? "#ffffff" : "rgba(255,255,255,0.8)"}
                        strokeWidth={strokeWidth}
                        shadowColor="rgba(0,0,0,0.4)"
                        shadowBlur={isSelected ? 8 / stageScale : 4 / stageScale}
                        shadowOffset={{ x: 0, y: 2 / stageScale }}
                      />
                      <Text
                        text={String(issue.issueNumber ?? "")}
                        fontSize={fontSize}
                        fontStyle="bold"
                        fill="#ffffff"
                        width={radius * 2}
                        height={radius * 2}
                        x={-radius}
                        y={-radius}
                        align="center"
                        verticalAlign="middle"
                        listening={false}
                      />
                    </Group>
                  );
                })}

                {isMobile && cursorPosition && activeTool !== "select" && activeTool !== "pan" && (
                  <>
                    <Line
                      points={[
                        cursorPosition.x - 20 / stageScale, cursorPosition.y,
                        cursorPosition.x - 6 / stageScale, cursorPosition.y,
                      ]}
                      stroke="#3b82f6"
                      strokeWidth={1.5 / stageScale}
                      opacity={0.7}
                    />
                    <Line
                      points={[
                        cursorPosition.x + 6 / stageScale, cursorPosition.y,
                        cursorPosition.x + 20 / stageScale, cursorPosition.y,
                      ]}
                      stroke="#3b82f6"
                      strokeWidth={1.5 / stageScale}
                      opacity={0.7}
                    />
                    <Line
                      points={[
                        cursorPosition.x, cursorPosition.y - 20 / stageScale,
                        cursorPosition.x, cursorPosition.y - 6 / stageScale,
                      ]}
                      stroke="#3b82f6"
                      strokeWidth={1.5 / stageScale}
                      opacity={0.7}
                    />
                    <Line
                      points={[
                        cursorPosition.x, cursorPosition.y + 6 / stageScale,
                        cursorPosition.x, cursorPosition.y + 20 / stageScale,
                      ]}
                      stroke="#3b82f6"
                      strokeWidth={1.5 / stageScale}
                      opacity={0.7}
                    />
                    <Circle
                      x={cursorPosition.x}
                      y={cursorPosition.y}
                      radius={3 / stageScale}
                      fill="#3b82f6"
                      opacity={0.5}
                    />
                  </>
                )}

                {markups.map((markup) => {
                  if (markup.categoryId && hiddenCategoryIds.has(markup.categoryId)) return null;
                  const rawPts = markup.points as { x: number; y: number }[];
                  if (!rawPts || rawPts.length === 0) return null;
                  // Task #1631 — fall back to the same shared toolbar
                  // defaults the project-side surface uses so legacy /
                  // malformed markups don't drift into the old red.
                  const color = (markup.color as string) || MARKUP_TOOLBAR_DEFAULT_COLOR;
                  const thickness = (markup.thickness as number) || MARKUP_TOOLBAR_DEFAULT_THICKNESS;
                  const tool = markup.tool as string;
                  const isSelectable = activeTool === "select";
                  // Task #1736 — `isSelected` highlights every member of
                  // the multi-selection (not just the size-1 anchor)
                  // and makes them all draggable. The resize handles
                  // and edit panel still gate on size === 1.
                  const isSelected = selectedMarkupIds.has(markup.id);
                  const isOnlySelected = selectedMarkupId === markup.id;
                  const pts = (markupResizePreview && markupResizePreview.id === markup.id)
                    ? markupResizePreview.points
                    : rawPts;
                  const isDraggable = isSelected;
                  // Task #1718 — imperative drag pattern (mirrors
                  // plan-side `getGroupProps` in PlanMarkupLayer). On
                  // dragStart we cache origin + this markup's resize
                  // handles in `markupBodyDragRef` and hide the handles
                  // via Konva so they don't lag behind the moving body.
                  // No setState fires for the entire gesture; Konva
                  // translates the dragged Group internally so live
                  // position updates happen at native frame rate. On
                  // dragEnd we restore the handles, reset the Konva
                  // position (the points re-render owns the new
                  // location), and fire the existing PATCH exactly once.
                  const onBodyDragStart = (e: any) => {
                    e.cancelBubble = true;
                    const origX = e.target.x();
                    const origY = e.target.y();
                    const layer = e.target.getLayer();
                    const hiddenHandles: Array<{ visible: boolean; listening: boolean; node: any }> = [];
                    const siblings: Array<{ id: string; node: any }> = [];
                    if (layer) {
                      const handles = layer.find(`.markup-handle-${markup.id}`);
                      handles.forEach((node: any) => {
                        hiddenHandles.push({
                          visible: node.visible(),
                          listening: node.listening(),
                          node,
                        });
                        node.visible(false);
                        node.listening(false);
                      });
                      if (hiddenHandles.length > 0) layer.batchDraw();
                      // Task #1736 — for a multi-select drag, find the
                      // other selected markups' Konva groups by name
                      // and disable hit-testing/draggable on them so
                      // the gesture stays anchored to `e.target` for
                      // the entire move. They're translated below in
                      // onDragMove via `node.position({ x: dx, y: dy })`,
                      // restored in onDragEnd, then re-rendered with
                      // their new normalized points by the bulk PATCH.
                      if (selectedMarkupIds.size > 1) {
                        for (const id of Array.from(selectedMarkupIds)) {
                          if (id === markup.id) continue;
                          const node = layer.findOne(`.markup-drag-member-${id}`);
                          if (node) {
                            node.draggable(false);
                            node.listening(false);
                            siblings.push({ id, node });
                          }
                        }
                      }
                    }
                    markupBodyDragRef.current = {
                      id: markup.id,
                      origX,
                      origY,
                      hiddenHandles,
                      siblings,
                    };
                  };
                  const onBodyDragMove = (e: any) => {
                    const drag = markupBodyDragRef.current;
                    if (!drag || drag.siblings.length === 0) return;
                    const dx = e.target.x() - drag.origX;
                    const dy = e.target.y() - drag.origY;
                    // Imperatively translate every sibling by the same
                    // pixel delta. No setState / no React reconciliation
                    // runs for the duration of the drag — that's what
                    // keeps a 50+ selection at 60fps.
                    for (const s of drag.siblings) {
                      s.node.position({ x: dx, y: dy });
                    }
                    e.target.getLayer()?.batchDraw();
                  };
                  const onBodyDragEnd = (e: any) => {
                    const drag = markupBodyDragRef.current;
                    // Defensive early return — matches the plan-side
                    // `getGroupProps` pattern. If the ref is missing
                    // (e.g. the drag was synthesized or the ref was
                    // cleared mid-gesture by an unmount) there's no
                    // origin to translate against, so do nothing rather
                    // than collapsing to a (0,0)-anchored move.
                    if (!drag) return;
                    const dx = e.target.x() - drag.origX;
                    const dy = e.target.y() - drag.origY;
                    e.target.position({ x: drag.origX, y: drag.origY });
                    for (const h of drag.hiddenHandles) {
                      h.node.visible(h.visible);
                      h.node.listening(h.listening);
                    }
                    // Reset every sibling's Konva position before the
                    // optimistic update lands so no shape "double-shifts"
                    // when the re-render rewrites its points. Restore
                    // listening + draggable so the user can immediately
                    // start a new drag from any member.
                    for (const s of drag.siblings) {
                      s.node.position({ x: 0, y: 0 });
                      s.node.listening(true);
                      s.node.draggable(true);
                    }
                    e.target.getLayer()?.batchDraw();
                    const siblingIds = drag.siblings.map(s => s.id);
                    markupBodyDragRef.current = null;
                    // Task #1742 / #1755 / #1752 / #1759 — All of the
                    // body-drag commit routing lives in
                    // `commitMarkupBodyDrag` so it can be unit-tested
                    // without standing up the Konva stage:
                    //   - Single-markup drags fire one
                    //     `updateMarkupMutation.mutate` with
                    //     `previous: { points }` so the mutation's
                    //     onSuccess records exactly one MARKUP_UPDATE
                    //     history entry (#1742).
                    //   - Multi-select drags fire ONE
                    //     `bulkUpdateMarkupsMutation.mutateAsync` PATCH
                    //     for the whole gesture (#1752 — one server
                    //     round-trip and one cache invalidation instead
                    //     of N), then push a single
                    //     MARKUP_UPDATE_BATCH history entry (#1755) ONLY
                    //     after the PATCH resolves (#1759 — prevents a
                    //     phantom Undo entry when the bulk PATCH
                    //     fails).
                    // See `client/src/components/markups/markup-drag-commit.ts`
                    // and `client/src/components/markups/__tests__/markup-drag-commit.test.ts`.
                    void commitMarkupBodyDrag({
                      markup,
                      rawPts,
                      dx,
                      dy,
                      siblingIds,
                      markups,
                      selectedSheet,
                      updateMarkupMutation,
                      bulkUpdateMarkupsMutation,
                      takeoffHistory,
                    });
                  };
                  const groupProps = isDraggable
                    ? {
                        // Task #1736 — `name` lets a sibling's drag-start
                        // locate this markup via `layer.findOne('.markup-drag-member-...')`
                        // and disable hit-testing for the duration of the
                        // gesture. Always set on selected members so the
                        // first frame of any group drag finds them.
                        name: `markup-drag-member-${markup.id}`,
                        draggable: true,
                        onDragStart: onBodyDragStart,
                        onDragMove: onBodyDragMove,
                        onDragEnd: onBodyDragEnd,
                        onMouseEnter: (e: any) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = "move"; },
                        onMouseLeave: (e: any) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = "default"; },
                      }
                    : undefined;
                  const sharedShape: MarkupShape = {
                    id: markup.id,
                    tool,
                    points: rawPts,
                    color,
                    thickness,
                    text: (markup.text as string) || "",
                  };
                  // Task #1768 — Flash a red glow on any markup whose
                  // most-recent move PATCH was rejected. The set lives
                  // on `useTakeoffData` and auto-clears after a few
                  // seconds, so a 50-markup batch failure makes the
                  // bad siblings unmistakable instead of leaving the
                  // user to guess from a generic toast.
                  const isFailed = failedMarkupIds.has(markup.id);
                  const shape = (
                    <MarkupShapeView
                      shape={sharedShape}
                      pts={pts}
                      selected={isSelected}
                      failed={isFailed}
                      onSelect={isSelectable
                        ? () => {
                            // Task #1736 — Shift+click toggles the
                            // markup in/out of the multi-selection set;
                            // plain click replaces the set with one id.
                            // The Konva click handler doesn't surface
                            // the original mouse event, so we read
                            // shift state from `window.event` (mirrors
                            // the plan-side `handleSelectShape`).
                            const shift =
                              typeof window !== "undefined" &&
                              (window.event as MouseEvent | undefined)?.shiftKey === true;
                            const draft = {
                              color,
                              thickness: snapToPresetThickness(thickness),
                              text: (markup.text as string) || "",
                            };
                            setSelectedMarkupIds(prev => {
                              if (shift) {
                                const next = new Set(prev);
                                const wasOpen = markupEditDraft !== null;
                                if (next.has(markup.id)) next.delete(markup.id);
                                else next.add(markup.id);
                                // Task #1758 — Keep the edit panel open
                                // for multi-selection so bulk color/
                                // thickness edits become possible. If
                                // the panel was closed, opening it
                                // seeds the draft from the just-clicked
                                // markup; if it was already open we
                                // preserve in-progress edits so a
                                // shift-click to grow the selection
                                // does not clobber unsaved pickers.
                                if (next.size === 0) {
                                  setMarkupEditDraft(null);
                                  setMarkupEditInitial(null);
                                } else if (!wasOpen) {
                                  setMarkupEditDraft(draft);
                                  setMarkupEditInitial(draft);
                                }
                                return next;
                              }
                              setMarkupEditDraft(draft);
                              setMarkupEditInitial(draft);
                              return new Set([markup.id]);
                            });
                          }
                        : undefined}
                      readOnly={!isSelectable}
                      listening={isSelectable}
                      pixelScale={1 / stageScale}
                      groupProps={groupProps}
                    />
                  );

                  const handles: any[] = [];
                  // Task #1718 — handles are always rendered when the
                  // markup is selected. During a body drag we hide them
                  // imperatively via Konva (`node.visible(false)`) in
                  // `onBodyDragStart`, which avoids the previous
                  // setState-on-dragStart that re-rendered every markup.
                  // Task #1736 — resize handles are intentionally
                  // hidden for multi-selection. Vertex / endpoint
                  // resize remains a single-markup operation; multi
                  // means "translate as a group", which the body drag
                  // covers.
                  if (isOnlySelected && tool !== "TEXT") {
                    const handleHalf = 6 / stageScale;
                    const handleStroke = 1.5 / stageScale;
                    if (tool === "ARROW") {
                      [0, rawPts.length - 1].forEach((idx, i) => {
                        handles.push(
                          <Rect
                            key={`handle-${markup.id}-${i}`}
                            // Task #1718 — `name` lets the body drag
                            // find this handle via `layer.find('.markup-handle-...')`
                            // and hide it imperatively for the duration
                            // of the drag.
                            name={`markup-handle-${markup.id}`}
                            x={rawPts[idx].x - handleHalf}
                            y={rawPts[idx].y - handleHalf}
                            width={handleHalf * 2}
                            height={handleHalf * 2}
                            fill="#ffffff"
                            stroke="#3b82f6"
                            strokeWidth={handleStroke}
                            draggable
                            onMouseDown={(e: any) => { e.cancelBubble = true; }}
                            onTouchStart={(e: any) => { e.cancelBubble = true; }}
                            onDragStart={(e: any) => {
                              e.cancelBubble = true;
                              markupResizeRef.current = {
                                id: markup.id,
                                origPts: rawPts.map(p => ({ ...p })),
                                origBB: { x: 0, y: 0, w: 0, h: 0 },
                                corner: `pt${idx}`,
                                tool,
                              };
                            }}
                            onDragMove={(e: any) => {
                              const np = rawPts.map(p => ({ ...p }));
                              np[idx] = { x: e.target.x() + handleHalf, y: e.target.y() + handleHalf };
                              setMarkupResizePreview({ id: markup.id, points: np });
                            }}
                            onDragEnd={async (e: any) => {
                              const np = rawPts.map(p => ({ ...p }));
                              np[idx] = { x: e.target.x() + handleHalf, y: e.target.y() + handleHalf };
                              // Task #1754 — Capture the pre-resize points
                              // before nulling the ref so `commitMarkupResize`
                              // can forward them as `previous` to
                              // `updateMarkupMutation`. Without this the
                              // resize would not land on the
                              // `useTakeoffHistory` stack and the sidebar
                              // Undo / Cmd+Z would skip over it (mirrors
                              // the body-drag fix from Task #1742).
                              const origPts = markupResizeRef.current?.origPts;
                              markupResizeRef.current = null;
                              setMarkupResizePreview({ id: markup.id, points: np });
                              await commitMarkupResize({
                                markupId: markup.id,
                                newPts: np,
                                origPts,
                                updateMarkupMutation,
                              });
                              setMarkupResizePreview(curr => (curr && curr.id === markup.id) ? null : curr);
                            }}
                            onMouseEnter={(e: any) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = "move"; }}
                            onMouseLeave={(e: any) => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = "default"; }}
                            data-testid={`handle-markup-${markup.id}-pt${idx}`}
                          />
                        );
                      });
                    } else {
                      const xs = rawPts.map(p => p.x);
                      const ys = rawPts.map(p => p.y);
                      const bbX = Math.min(...xs);
                      const bbY = Math.min(...ys);
                      const bbW = Math.max(...xs) - bbX;
                      const bbH = Math.max(...ys) - bbY;
                      const corners = [
                        { name: "tl", x: bbX, y: bbY, cursor: "nwse-resize" },
                        { name: "tr", x: bbX + bbW, y: bbY, cursor: "nesw-resize" },
                        { name: "bl", x: bbX, y: bbY + bbH, cursor: "nesw-resize" },
                        { name: "br", x: bbX + bbW, y: bbY + bbH, cursor: "nwse-resize" },
                      ];
                      const computeNewPts = (cornerName: string, newCornerX: number, newCornerY: number) => {
                        const ref = markupResizeRef.current;
                        if (!ref) return rawPts;
                        const oldBB = ref.origBB;
                        let nx = oldBB.x, ny = oldBB.y, nRight = oldBB.x + oldBB.w, nBottom = oldBB.y + oldBB.h;
                        if (cornerName === "tl") { nx = newCornerX; ny = newCornerY; }
                        else if (cornerName === "tr") { ny = newCornerY; nRight = newCornerX; }
                        else if (cornerName === "bl") { nx = newCornerX; nBottom = newCornerY; }
                        else if (cornerName === "br") { nRight = newCornerX; nBottom = newCornerY; }
                        const minSize = 4;
                        if (nRight - nx < minSize) {
                          if (cornerName === "tl" || cornerName === "bl") nx = nRight - minSize;
                          else nRight = nx + minSize;
                        }
                        if (nBottom - ny < minSize) {
                          if (cornerName === "tl" || cornerName === "tr") ny = nBottom - minSize;
                          else nBottom = ny + minSize;
                        }
                        const newBB = { x: nx, y: ny, w: nRight - nx, h: nBottom - ny };
                        if (ref.tool === "RECTANGLE" || ref.tool === "HIGHLIGHT" || ref.tool === "CLOUD") {
                          return [
                            { x: newBB.x, y: newBB.y },
                            { x: newBB.x + newBB.w, y: newBB.y + newBB.h },
                          ];
                        }
                        const sx = oldBB.w === 0 ? 1 : newBB.w / oldBB.w;
                        const sy = oldBB.h === 0 ? 1 : newBB.h / oldBB.h;
                        return ref.origPts.map(p => ({
                          x: newBB.x + (p.x - oldBB.x) * sx,
                          y: newBB.y + (p.y - oldBB.y) * sy,
                        }));
                      };
                      corners.forEach(c => {
                        handles.push(
                          <Rect
                            key={`handle-${markup.id}-${c.name}`}
                            // Task #1718 — `name` lets the body drag
                            // find this handle via `layer.find('.markup-handle-...')`
                            // and hide it imperatively for the duration
                            // of the drag.
                            name={`markup-handle-${markup.id}`}
                            x={c.x - handleHalf}
                            y={c.y - handleHalf}
                            width={handleHalf * 2}
                            height={handleHalf * 2}
                            fill="#ffffff"
                            stroke="#3b82f6"
                            strokeWidth={handleStroke}
                            draggable
                            onMouseDown={(e: any) => { e.cancelBubble = true; }}
                            onTouchStart={(e: any) => { e.cancelBubble = true; }}
                            onDragStart={(e: any) => {
                              e.cancelBubble = true;
                              markupResizeRef.current = {
                                id: markup.id,
                                origPts: rawPts.map(p => ({ ...p })),
                                origBB: { x: bbX, y: bbY, w: bbW, h: bbH },
                                corner: c.name,
                                tool,
                              };
                            }}
                            onDragMove={(e: any) => {
                              if (!markupResizeRef.current) return;
                              const newPts = computeNewPts(c.name, e.target.x() + handleHalf, e.target.y() + handleHalf);
                              setMarkupResizePreview({ id: markup.id, points: newPts });
                            }}
                            onDragEnd={async (e: any) => {
                              if (!markupResizeRef.current) { setMarkupResizePreview(null); return; }
                              const newPts = computeNewPts(c.name, e.target.x() + handleHalf, e.target.y() + handleHalf);
                              // Task #1754 — Capture the pre-resize points
                              // before nulling the ref so `commitMarkupResize`
                              // can forward them as `previous` to
                              // `updateMarkupMutation`. Without this the
                              // resize would not land on the
                              // `useTakeoffHistory` stack and the sidebar
                              // Undo / Cmd+Z would skip over it (mirrors
                              // the body-drag fix from Task #1742).
                              const origPts = markupResizeRef.current.origPts;
                              markupResizeRef.current = null;
                              setMarkupResizePreview({ id: markup.id, points: newPts });
                              await commitMarkupResize({
                                markupId: markup.id,
                                newPts,
                                origPts,
                                updateMarkupMutation,
                              });
                              setMarkupResizePreview(curr => (curr && curr.id === markup.id) ? null : curr);
                            }}
                            onMouseEnter={(e: any) => { const con = e.target.getStage()?.container(); if (con) con.style.cursor = c.cursor; }}
                            onMouseLeave={(e: any) => { const con = e.target.getStage()?.container(); if (con) con.style.cursor = "default"; }}
                            data-testid={`handle-markup-${markup.id}-${c.name}`}
                          />
                        );
                      });
                    }
                  }

                  return (
                    <Fragment key={markup.id}>
                      {shape}
                      {handles}
                    </Fragment>
                  );
                })}

                {sheetLinks.map((link: any) => {
                  const targetSheet = sheets.find((s: TakeoffSheet) => s.id === link.targetSheetId);
                  const isHovered = hoveredLinkId === link.id;
                  return (
                    <Group
                      key={`link-${link.id}`}
                      x={link.x}
                      y={link.y}
                      onClick={(e: any) => {
                        e.cancelBubble = true;
                        handleLinkNavigate(link.targetSheetId);
                      }}
                      onTap={(e: any) => {
                        e.cancelBubble = true;
                        handleLinkNavigate(link.targetSheetId);
                      }}
                      onMouseEnter={(e: any) => {
                        setHoveredLinkId(link.id);
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = "pointer";
                      }}
                      onMouseLeave={(e: any) => {
                        setHoveredLinkId(null);
                        const container = e.target.getStage()?.container();
                        if (container) container.style.cursor = activeTool === "pan" ? "grab" : activeTool === "select" ? "default" : "crosshair";
                      }}
                    >
                      <Rect
                        width={link.width}
                        height={link.height}
                        fill={isHovered ? "rgba(59, 130, 246, 0.15)" : "transparent"}
                        stroke={isHovered ? "rgba(59, 130, 246, 0.7)" : "rgba(59, 130, 246, 0.2)"}
                        strokeWidth={isHovered ? 2 / stageScale : 1 / stageScale}
                        cornerRadius={2 / stageScale}
                        dash={isHovered ? undefined : [4 / stageScale, 2 / stageScale]}
                      />
                      {isHovered && (
                        <Text
                          text={link.label || targetSheet?.sheetName || "→"}
                          fontSize={Math.max(10 / stageScale, 8)}
                          fill="rgba(59, 130, 246, 0.9)"
                          fontStyle="bold"
                          y={link.height + 2 / stageScale}
                          width={Math.max(link.width, 60 / stageScale)}
                          align="center"
                          listening={false}
                        />
                      )}
                    </Group>
                  );
                })}

                {createLinkMode?.step === "select-area" && createLinkMode.startPoint && createLinkMode.endPoint && (
                  <Rect
                    x={Math.min(createLinkMode.startPoint.x, createLinkMode.endPoint.x)}
                    y={Math.min(createLinkMode.startPoint.y, createLinkMode.endPoint.y)}
                    width={Math.abs(createLinkMode.endPoint.x - createLinkMode.startPoint.x)}
                    height={Math.abs(createLinkMode.endPoint.y - createLinkMode.startPoint.y)}
                    fill="rgba(59, 130, 246, 0.15)"
                    stroke="rgba(59, 130, 246, 0.8)"
                    strokeWidth={2 / stageScale}
                    dash={[6 / stageScale, 3 / stageScale]}
                    listening={false}
                  />
                )}

                {collab.visibleCursors.map((cursor: any) => (
                  <Group key={`collab-cursor-${cursor.userId}`} x={cursor.x} y={cursor.y} listening={false}>
                    <Line
                      points={[0, 0, 4 / stageScale, 14 / stageScale, 0, 10 / stageScale]}
                      fill={cursor.userColor}
                      stroke="#ffffff"
                      strokeWidth={1 / stageScale}
                      closed
                    />
                    <Rect
                      x={6 / stageScale}
                      y={10 / stageScale}
                      width={(cursor.userName.length * 6 + 8) / stageScale}
                      height={16 / stageScale}
                      fill={cursor.userColor}
                      cornerRadius={3 / stageScale}
                    />
                    <Text
                      x={10 / stageScale}
                      y={12 / stageScale}
                      text={cursor.userName}
                      fontSize={10 / stageScale}
                      fill="#ffffff"
                      listening={false}
                    />
                  </Group>
                ))}

                {markupDrawing && markupDrawPoints.length >= 2 && isMarkupTool(activeTool) && (
                  <MarkupShapeView
                    key="markup-preview"
                    shape={{
                      id: "markup-preview",
                      tool: toolToMarkupType(activeTool),
                      points: markupDrawPoints,
                      color: markupColor,
                      thickness: markupThickness,
                      text: "",
                    }}
                    pts={markupDrawPoints}
                    selected={false}
                    readOnly
                    listening={false}
                    pixelScale={1 / stageScale}
                    groupProps={{ opacity: 0.7 }}
                  />
                )}
                </Group>
              </Layer>
            </Stage>

            {/* Test-only DOM mirror of collab.visibleCursors. Konva renders
                the cursor markers to a <canvas>, which Playwright cannot
                inspect; this hidden list lets the e2e at
                e2e/takeoff-collab-conflict.spec.ts assert that the React
                state was actually consumed (Task #2651). */}
            <div
              aria-hidden
              style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }}
              data-testid="collab-cursors-root"
            >
              {collab.visibleCursors.map((cursor: { userId: string; userName: string; x: number; y: number }) => (
                <span
                  key={`collab-cursor-dom-${cursor.userId}`}
                  data-testid={`collab-cursor-${cursor.userId}`}
                  data-cursor-x={String(Math.round(cursor.x))}
                  data-cursor-y={String(Math.round(cursor.y))}
                >
                  {cursor.userName}
                </span>
              ))}
            </div>

    </div>
  );
}

export const CanvasStage = memo(CanvasStageImpl);
CanvasStage.displayName = "CanvasStage";
