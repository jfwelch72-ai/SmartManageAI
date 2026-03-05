import { useState, useRef, useEffect, useLayoutEffect, Fragment } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import {
  Upload, Pencil, Keyboard, MoreVertical, Copy, ArrowUp, ArrowDown,
  Maximize, Minimize, Trash2
} from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import {
  createArcSegment,
  sampleArcPoints,
} from "@shared/utils/geometry";
import { type Tool, validateHexColor, hexToRgba } from "./takeoff/types";
import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffInteractions } from "@/hooks/use-takeoff-interactions";
import { TakeoffToolbar } from "./takeoff/TakeoffToolbar";
import { TakeoffSidebar } from "./takeoff/TakeoffSidebar";
import { TakeoffDialogs } from "./takeoff/TakeoffDialogs";
import AiTakeoffPanel from "@/components/AiTakeoffPanel";
import { cn } from "@/lib/utils";

interface TakeoffWorkspaceProps {
  projectId: string;
  projectCode: string;
}

export default function TakeoffWorkspace({ projectId, projectCode }: TakeoffWorkspaceProps) {
  const isMobile = useIsMobile();
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [currentDrawingTool, setCurrentDrawingTool] = useState<Tool | null>(null);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const takeoffHistory = useTakeoffHistory(selectedSheet);
  const prevSheetRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSheetRef.current !== null && prevSheetRef.current !== selectedSheet) {
      takeoffHistory.clear();
    }
    prevSheetRef.current = selectedSheet;
  }, [selectedSheet, takeoffHistory]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState<"idle" | "first-point" | "second-point">("idle");
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [calibrationDistance, setCalibrationDistance] = useState("");
  const [units, setUnits] = useState<"ft" | "m">("ft");
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [notePosition, setNotePosition] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [pitchRatio, setPitchRatio] = useState("6:12");
  const [dropDistance, setDropDistance] = useState("");
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  const [toolBeforeSpacebar, setToolBeforeSpacebar] = useState<Tool | null>(null);
  const [isSpacebarHeld, setIsSpacebarHeld] = useState(false);
  const [pdfImage, setPdfImage] = useState<HTMLImageElement | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageDimensions, setStageDimensions] = useState({ width: 800, height: 600 });
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState("#3b82f6");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSheetConfirmOpen, setDeleteSheetConfirmOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [addendaOverlays, setAddendaOverlays] = useState<Record<string, { visible: boolean; opacity: number; imageUrl?: string }>>({});
  const [addendaImages, setAddendaImages] = useState<Record<string, HTMLImageElement>>({});
  const [verifyMode, setVerifyMode] = useState<"idle" | "first-point" | "second-point">("idle");
  const [verifyPoints, setVerifyPoints] = useState<{ x: number; y: number }[]>([]);
  const [verifyExpectedDistance, setVerifyExpectedDistance] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ expected: number; measured: number; errorPct: number } | null>(null);
  const [multiCalibPoints, setMultiCalibPoints] = useState<Array<{ points: [{ x: number; y: number }, { x: number; y: number }]; distance: number }>>([]);
  const [multiCalibMode, setMultiCalibMode] = useState(false);

  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const data = useTakeoffData({
    projectId,
    projectCode,
    selectedSheet,
    uploadDialogOpen,
    takeoffHistory,
    selectedCategoryId,
    callbacks: {
      setUploadDialogOpen,
      setSelectedSheet,
      setSelectedMeasurementId,
      setRenameDialogOpen,
      setDeleteSheetConfirmOpen,
      setCategoryDialogOpen,
      setEditingCategory,
      setCategoryName,
      setCategoryColor,
      setSelectedCategoryId,
    },
  });

  const {
    sheets, sheetsLoading, planDocuments, documentsLoading,
    projectAddenda, measurements, measurementsLoading,
    categories, currentSheet, aggregatedMeasurements,
    importPlanMutation, createMeasurementMutation,
    updateMeasurementMutation, deleteMeasurementMutation,
    saveCategoryMutation, deleteCategoryMutation,
    renameSheetMutation, duplicateSheetMutation,
    deleteSheetMutation, handleMoveSheet,
  } = data;

  const interactions = useTakeoffInteractions({
    projectId,
    selectedSheet,
    currentSheet,
    measurements,
    categories,
    activeTool,
    setActiveTool,
    isDrawing,
    setIsDrawing,
    drawingPoints,
    setDrawingPoints,
    currentDrawingTool,
    setCurrentDrawingTool,
    calibrationMode,
    setCalibrationMode,
    calibrationPoints,
    setCalibrationPoints,
    calibrationDistance,
    setCalibrationDistance,
    units,
    stageScale,
    setStageScale,
    stagePosition,
    setStagePosition,
    selectedCategoryId,
    selectedMeasurementId,
    setSelectedMeasurementId,
    notePosition,
    setNotePosition,
    setNoteDialogOpen,
    noteText,
    setNoteText,
    pitchRatio,
    dropDistance,
    verifyMode,
    setVerifyMode,
    verifyPoints,
    setVerifyPoints,
    verifyExpectedDistance,
    setVerifyResult,
    isSpacebarHeld,
    setIsSpacebarHeld,
    toolBeforeSpacebar,
    setToolBeforeSpacebar,
    isFullscreen,
    setIsFullscreen,
    workspaceRef,
    stageRef,
    takeoffHistory,
    createMeasurementMutation,
    aggregatedMeasurements,
    setShortcutsDialogOpen,
    isMobile,
  });

  const {
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
    snapEnabled,
    setSnapEnabled,
    orthoLock,
    setOrthoLock,
    currentSnap,
    cursorPosition,
  } = interactions;

  useEffect(() => {
    Object.entries(addendaOverlays).forEach(([addendumId, overlay]) => {
      if (overlay.visible && !addendaImages[addendumId] && !overlay.imageUrl) {
        fetch(`/api/addenda/${addendumId}/preview-url`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.url) {
              setAddendaOverlays(prev => ({ ...prev, [addendumId]: { ...prev[addendumId], imageUrl: data.url } }));
              const img = new window.Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                setAddendaImages(prev => ({ ...prev, [addendumId]: img }));
              };
              img.src = data.url;
            }
          })
          .catch(() => {});
      }
    });
  }, [addendaOverlays, addendaImages]);

  useEffect(() => {
    if (editingCategory) {
      setCategoryName(editingCategory.name);
      setCategoryColor(editingCategory.color);
    } else {
      setCategoryName("");
      setCategoryColor("#3b82f6");
    }
  }, [editingCategory]);

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm("Delete this category? Measurements will not be deleted, but will lose their category assignment.")) {
      return;
    }
    deleteCategoryMutation.mutate(categoryId);
  };

  const handleSaveCategory = () => {
    if (!categoryName.trim()) {
      toast({ title: "Error", description: "Category name is required", variant: "destructive" });
      return;
    }
    saveCategoryMutation.mutate({
      id: editingCategory?.id,
      name: categoryName,
      color: categoryColor,
    });
  };

  useEffect(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }, []);

  useEffect(() => {
    if (!currentSheet?.imageUrl) {
      setPdfImage(null);
      return;
    }

    const loadPDF = async () => {
      try {
        setIsPdfLoading(true);
        setPdfImage(null);
        const pdfUrl = `/api/takeoff/sheets/${currentSheet.id}/pdf`;
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: true,
        });
        const pdf = await loadingTask.promise;
        const pageNumber = (currentSheet.sheetIndex || 0) + 1;
        const page = await pdf.getPage(pageNumber);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }).promise;
        const img = new window.Image();
        img.src = canvas.toDataURL();
        img.onload = () => {
          setPdfImage(img);
          setIsPdfLoading(false);
        };
      } catch (error) {
        console.error('Error loading PDF:', error);
        setIsPdfLoading(false);
        toast({
          title: "Error",
          description: "Failed to load PDF. The file may not be a valid PDF document.",
          variant: "destructive"
        });
      }
    };

    loadPDF();
  }, [currentSheet?.id, currentSheet?.imageUrl, toast]);

  useLayoutEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setStageDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateDimensions();
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(containerRef.current);
      return () => { resizeObserver.disconnect(); };
    }
  }, [isFullscreen, selectedSheet]);

  return (
    <div ref={workspaceRef} className="flex flex-col sm:flex-row h-full relative overflow-hidden">
      <TakeoffToolbar
        activeTool={activeTool}
        onToolSelect={handleToolSelect}
        stageScale={stageScale}
        setStageScale={setStageScale}
        selectedMeasurementId={selectedMeasurementId}
        measurements={measurements}
        onDeleteMeasurement={(m) => deleteMeasurementMutation.mutate(m)}
        deletePending={deleteMeasurementMutation.isPending}
        takeoffHistory={takeoffHistory}
        snapEnabled={snapEnabled}
        setSnapEnabled={setSnapEnabled}
        orthoLock={orthoLock}
        setOrthoLock={setOrthoLock}
        onUpload={() => setUploadDialogOpen(true)}
        aiPanelOpen={aiPanelOpen}
        setAiPanelOpen={setAiPanelOpen}
        mobileMeasurementsOpen={mobileMeasurementsOpen}
        setMobileMeasurementsOpen={setMobileMeasurementsOpen}
        isDrawing={isDrawing}
        drawingPoints={drawingPoints}
        isMobile={isMobile}
      />

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0">
        <div className="h-12 sm:h-14 bg-card border-b px-2 sm:px-4 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Label className="text-xs sm:text-sm font-medium shrink-0">Sheet:</Label>
            <Select value={selectedSheet || ""} onValueChange={setSelectedSheet}>
              <SelectTrigger className="w-32 sm:w-64" data-testid="select-sheet">
                <SelectValue placeholder="Select a sheet..." />
              </SelectTrigger>
              <SelectContent container={workspaceRef.current}>
                {sheets.map((sheet) => (
                  <SelectItem key={sheet.id} value={sheet.id}>
                    {sheet.sheetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSheet && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-sheet-actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => { setRenameValue(currentSheet?.sheetName || ""); setRenameDialogOpen(true); }}
                    data-testid="menu-rename-sheet"
                  >
                    <Pencil className="h-4 w-4 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => duplicateSheetMutation.mutate(selectedSheet)}
                    disabled={duplicateSheetMutation.isPending}
                    data-testid="menu-duplicate-sheet"
                  >
                    <Copy className="h-4 w-4 mr-2" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleMoveSheet("up")}
                    disabled={sheets.findIndex(s => s.id === selectedSheet) <= 0}
                    data-testid="menu-move-sheet-up"
                  >
                    <ArrowUp className="h-4 w-4 mr-2" /> Move Up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleMoveSheet("down")}
                    disabled={sheets.findIndex(s => s.id === selectedSheet) >= sheets.length - 1}
                    data-testid="menu-move-sheet-down"
                  >
                    <ArrowDown className="h-4 w-4 mr-2" /> Move Down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteSheetConfirmOpen(true)}
                    data-testid="menu-delete-sheet"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete Sheet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {currentSheet && (
              <Badge variant="outline" data-testid="badge-calibration-status">
                {currentSheet.scalePxPerFoot
                  ? `Calibrated (${currentSheet.units})`
                  : "Not Calibrated"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShortcutsDialogOpen(true)}
                  data-testid="button-keyboard-shortcuts"
                >
                  <Keyboard className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex items-center gap-2">
                  <span>Keyboard Shortcuts</span>
                  <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">?</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              data-testid="button-toggle-fullscreen"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
          style={{
            cursor: activeTool === "pan" ? "grab" :
                   activeTool === "select" ? "default" :
                   "crosshair"
          }}
        >
          {selectedSheet ? (
            <Stage
              ref={stageRef}
              width={stageDimensions.width}
              height={stageDimensions.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePosition.x}
              y={stagePosition.y}
              onMouseDown={handleStageMouseDown}
              onMouseUp={handleStageMouseUp}
              onMouseMove={handleStageMouseMove}
              onTouchStart={handleStageMouseDown}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              onDblClick={(e) => {
                if ((activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                }
              }}
              onDblTap={(e: any) => {
                if ((activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                }
              }}
              onWheel={handleWheel}
              draggable={activeTool === "pan"}
              onDragStart={handleStageDragStart}
              onDragMove={handleStageDragMove}
              onDragEnd={handleStageDragEnd}
            >
              <Layer>
                {isPdfLoading ? (
                  <Text text="Loading PDF..." x={20} y={20} fontSize={16} fill="#888" />
                ) : pdfImage ? (
                  <KonvaImage image={pdfImage} />
                ) : (
                  <Text text="Select a sheet to begin" x={20} y={20} fontSize={16} fill="#888" />
                )}

                {Object.entries(addendaOverlays).map(([addendumId, overlay]) => {
                  if (!overlay.visible || !addendaImages[addendumId]) return null;
                  return (
                    <KonvaImage
                      key={`addenda-overlay-${addendumId}`}
                      image={addendaImages[addendumId]}
                      opacity={overlay.opacity}
                      listening={false}
                    />
                  );
                })}

                {measurements.map((m) => {
                  const points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                  const isSelected = selectedMeasurementId === m.id;
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
                    }
                  };

                  if ((m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && points.length >= 2) {
                    if (points.length === 3 && currentSheet?.scalePxPerFoot) {
                      const [startPoint, middlePoint, endPoint] = points;
                      const arcSegment = createArcSegment(startPoint, endPoint, middlePoint, currentSheet.scalePxPerFoot);
                      if (arcSegment) {
                        const arcPoints = sampleArcPoints(arcSegment, 30);
                        const flatPoints = arcPoints.flatMap(p => [p.x, p.y]);
                        return (
                          <Line
                            key={m.id}
                            points={flatPoints}
                            stroke={baseColor}
                            strokeWidth={isSelected ? 5 : 3}
                            opacity={isSelected ? 1 : 0.8}
                            onClick={handleMeasurementClick}
                            onTap={handleMeasurementClick}
                          />
                        );
                      }
                    }
                    return (
                      <Line
                        key={m.id}
                        points={[points[0].x, points[0].y, points[1].x, points[1].y]}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        hitStrokeWidth={isMobile ? 20 : 0}
                        opacity={isSelected ? 1 : 0.8}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if ((m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && points.length >= 3) {
                    const flatPoints = points.flatMap((p: any) => [p.x, p.y]);
                    return (
                      <Line
                        key={m.id}
                        points={flatPoints}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        hitStrokeWidth={isMobile ? 20 : 0}
                        fill={isSelected ? hexToRgba(baseColor, 0.3) : hexToRgba(baseColor, 0.15)}
                        opacity={isSelected ? 1 : 0.8}
                        closed={true}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "VOLUME" && points.length >= 3) {
                    const flatPoints = points.flatMap((p: any) => [p.x, p.y]);
                    return (
                      <Line
                        key={m.id}
                        points={flatPoints}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        hitStrokeWidth={isMobile ? 20 : 0}
                        fill={isSelected ? hexToRgba(baseColor, 0.3) : hexToRgba(baseColor, 0.15)}
                        opacity={isSelected ? 1 : 0.8}
                        closed={true}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "COUNT" && points.length >= 1) {
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
                  }
                  return null;
                })}

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

                    {activeTool === "arc" && drawingPoints.length === 2 && currentSheet?.scalePxPerFoot && (
                      <Line
                        points={[drawingPoints[0].x, drawingPoints[0].y, drawingPoints[1].x, drawingPoints[1].y]}
                        stroke="#2563eb"
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}

                    {drawingPoints.map((point, i) => (
                      <Circle
                        key={`temp-${i}`}
                        x={point.x}
                        y={point.y}
                        radius={isMobile ? 10 : 6}
                        fill={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : activeTool === "volume" ? "#ea580c" : "#2563eb"}
                        stroke="white"
                        strokeWidth={isMobile ? 3 : 2}
                      />
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
                      text={currentSnap.snapTarget.type === "endpoint" ? "End" : "Mid"}
                      fontSize={11 / stageScale}
                      fill="#f59e0b"
                      fontStyle="bold"
                    />
                  </>
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
              </Layer>
            </Stage>
          ) : (
            <div
              className="flex items-center justify-center h-full cursor-pointer hover-elevate"
              onClick={() => setUploadDialogOpen(true)}
              data-testid="button-empty-upload-area"
            >
              <div className="text-center text-muted-foreground p-8 rounded-lg border-2 border-dashed border-muted-foreground/30">
                <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select or upload a plan sheet to begin takeoff</p>
                <p className="text-sm mt-2">Click here to import a document</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {aiPanelOpen && selectedSheet && (
        <div className="w-80 border-l bg-card shrink-0">
          <AiTakeoffPanel
            projectId={projectId}
            sheetId={selectedSheet}
            onClose={() => setAiPanelOpen(false)}
          />
        </div>
      )}

      <TakeoffSidebar
        selectedSheet={selectedSheet}
        currentSheet={currentSheet}
        projectId={projectId}
        calibrationMode={calibrationMode}
        calibrationPoints={calibrationPoints}
        calibrationDistance={calibrationDistance}
        setCalibrationDistance={setCalibrationDistance}
        units={units}
        setUnits={setUnits}
        onSaveCalibration={handleSaveCalibration}
        activeTool={activeTool}
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        setSelectedCategoryId={setSelectedCategoryId}
        setCategoryDialogOpen={setCategoryDialogOpen}
        setEditingCategory={setEditingCategory}
        onDeleteCategory={handleDeleteCategory}
        pitchRatio={pitchRatio}
        setPitchRatio={setPitchRatio}
        dropDistance={dropDistance}
        setDropDistance={setDropDistance}
        measurements={measurements}
        selectedMeasurementId={selectedMeasurementId}
        setSelectedMeasurementId={setSelectedMeasurementId}
        deleteMeasurementMutation={deleteMeasurementMutation}
        updateMeasurementMutation={updateMeasurementMutation}
        aggregatedMeasurements={aggregatedMeasurements}
        projectAddenda={projectAddenda}
        addendaOverlays={addendaOverlays}
        setAddendaOverlays={setAddendaOverlays}
        verifyMode={verifyMode}
        setVerifyMode={setVerifyMode}
        verifyPoints={verifyPoints}
        setVerifyPoints={setVerifyPoints}
        verifyExpectedDistance={verifyExpectedDistance}
        setVerifyExpectedDistance={setVerifyExpectedDistance}
        verifyResult={verifyResult}
        setVerifyResult={setVerifyResult}
        multiCalibMode={multiCalibMode}
        setMultiCalibMode={setMultiCalibMode}
        multiCalibPoints={multiCalibPoints}
        setMultiCalibPoints={setMultiCalibPoints}
        setCalibrationMode={setCalibrationMode}
        setCalibrationPoints={setCalibrationPoints}
        workspaceRef={workspaceRef}
        aiPanelOpen={aiPanelOpen}
        onApplyPresetScale={handleApplyPresetScale}
      />

      <TakeoffDialogs
        mobileMeasurementsOpen={mobileMeasurementsOpen}
        setMobileMeasurementsOpen={setMobileMeasurementsOpen}
        measurements={measurements}
        selectedMeasurementId={selectedMeasurementId}
        setSelectedMeasurementId={setSelectedMeasurementId}
        deleteMeasurementMutation={deleteMeasurementMutation}
        updateMeasurementMutation={updateMeasurementMutation}
        aggregatedMeasurements={aggregatedMeasurements}
        renameDialogOpen={renameDialogOpen}
        setRenameDialogOpen={setRenameDialogOpen}
        renameValue={renameValue}
        setRenameValue={setRenameValue}
        renameSheetMutation={renameSheetMutation}
        selectedSheet={selectedSheet}
        deleteSheetConfirmOpen={deleteSheetConfirmOpen}
        setDeleteSheetConfirmOpen={setDeleteSheetConfirmOpen}
        currentSheet={currentSheet}
        deleteSheetMutation={deleteSheetMutation}
        noteDialogOpen={noteDialogOpen}
        setNoteDialogOpen={setNoteDialogOpen}
        noteText={noteText}
        setNoteText={setNoteText}
        notePosition={notePosition}
        setNotePosition={setNotePosition}
        onSaveNote={handleSaveNote}
        categoryDialogOpen={categoryDialogOpen}
        setCategoryDialogOpen={setCategoryDialogOpen}
        editingCategory={editingCategory}
        setEditingCategory={setEditingCategory}
        categoryName={categoryName}
        setCategoryName={setCategoryName}
        categoryColor={categoryColor}
        setCategoryColor={setCategoryColor}
        onSaveCategory={handleSaveCategory}
        saveCategoryPending={saveCategoryMutation.isPending}
        shortcutsDialogOpen={shortcutsDialogOpen}
        setShortcutsDialogOpen={setShortcutsDialogOpen}
        uploadDialogOpen={uploadDialogOpen}
        setUploadDialogOpen={setUploadDialogOpen}
        planDocuments={planDocuments}
        documentsLoading={documentsLoading}
        sheets={sheets}
        importPlanMutation={importPlanMutation}
        workspaceRef={workspaceRef}
      />
    </div>
  );
}
