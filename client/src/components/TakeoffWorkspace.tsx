import { useState, useRef, useEffect, useLayoutEffect, Fragment } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Arrow, Rect, Group } from "react-konva";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import {
  Upload, Pencil, Keyboard, MoreVertical, Copy, ArrowUp, ArrowDown,
  Maximize, Minimize, Trash2, Plus, AlertTriangle, GitCompare
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
import { PlanScaleModal } from "./takeoff/PlanScaleModal";
import { TakeoffSheetCompareDialog } from "./takeoff/TakeoffSheetCompareDialog";
import { IssueDetailPanel } from "./takeoff/IssueDetailPanel";
import AiTakeoffPanel from "@/components/AiTakeoffPanel";
import { cn } from "@/lib/utils";
import { onLibraryEvent } from "@/lib/libraryEvents";
import type { LibraryEvent } from "@/lib/libraryEvents";

type TakeoffContext =
  | { type: "project"; projectId: string; projectCode: string }
  | { type: "bid"; bidId: string; bidCode: string };

interface TakeoffWorkspaceProps {
  projectId?: string;
  projectCode?: string;
  context?: TakeoffContext;
}

export default function TakeoffWorkspace({ projectId = "", projectCode = "", context }: TakeoffWorkspaceProps) {
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
      setHiddenCategoryIds(new Set());
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
  const [scaleModalOpen, setScaleModalOpen] = useState(false);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(new Set());
  const [addendaOverlays, setAddendaOverlays] = useState<Record<string, { visible: boolean; opacity: number; imageUrl?: string }>>({});
  const [addendaImages, setAddendaImages] = useState<Record<string, HTMLImageElement>>({});
  const [verifyMode, setVerifyMode] = useState<"idle" | "first-point" | "second-point">("idle");
  const [verifyPoints, setVerifyPoints] = useState<{ x: number; y: number }[]>([]);
  const [verifyExpectedDistance, setVerifyExpectedDistance] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ expected: number; measured: number; errorPct: number } | null>(null);
  const [multiCalibPoints, setMultiCalibPoints] = useState<Array<{ points: [{ x: number; y: number }, { x: number; y: number }]; distance: number }>>([]);
  const [multiCalibMode, setMultiCalibMode] = useState(false);
  const [markupColor, setMarkupColor] = useState("#ff0000");
  const [markupThickness, setMarkupThickness] = useState(2);
  const [markupDrawing, setMarkupDrawing] = useState(false);
  const [markupDrawPoints, setMarkupDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [markupTextInput, setMarkupTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const isMarkupTool = (tool: string) => tool.startsWith("markup_");

  const getStagePointer = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - stagePosition.x) / stageScale,
      y: (pos.y - stagePosition.y) / stageScale,
    };
  };

  const toolToMarkupType = (tool: string): string => {
    switch (tool) {
      case "markup_arrow": return "ARROW";
      case "markup_text": return "TEXT";
      case "markup_rectangle": return "RECTANGLE";
      case "markup_cloud": return "CLOUD";
      case "markup_highlight": return "HIGHLIGHT";
      case "markup_freehand": return "FREEHAND";
      default: return "ARROW";
    }
  };

  const data = useTakeoffData({
    projectId,
    projectCode,
    context,
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
    markups,
    categories, currentSheet, aggregatedMeasurements,
    sheetsQueryKey,
    importPlanMutation, supersedeSheetMutation, createMeasurementMutation,
    updateMeasurementMutation, deleteMeasurementMutation,
    createMarkupMutation, deleteMarkupMutation,
    saveCategoryMutation, deleteCategoryMutation,
    renameSheetMutation, duplicateSheetMutation,
    deleteSheetMutation, handleMoveSheet,
  } = data;

  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [hideResolvedIssues, setHideResolvedIssues] = useState(false);

  const issuesQueryKey = selectedSheet ? [`/api/takeoff/sheets/${selectedSheet}/issues`] : null;
  const { data: issuesData = [] } = useQuery({
    queryKey: issuesQueryKey || ["__no_issues__"],
    enabled: !!selectedSheet,
  });
  const issues: any[] = issuesData as any[];

  const allSheetsIssuesQueryKey = ["__all_issues__", sheets.map((s: any) => s.id).join(",")];
  const allSheetsIssues = useQuery({
    queryKey: allSheetsIssuesQueryKey,
    enabled: sheets.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        sheets.map((sheet: any) =>
          fetch(`/api/takeoff/sheets/${sheet.id}/issues`, { credentials: "include" })
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      return results.flat();
    },
    staleTime: 30000,
  });
  const allIssues: any[] = (allSheetsIssues.data || []) as any[];

  const { data: orgUsersData = [] } = useQuery({ queryKey: ["/api/messaging/users"] });
  const orgUsers: any[] = (orgUsersData as any[]).map((u: any) => ({
    ...u,
    name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
  }));

  const { data: currentUserData } = useQuery({ queryKey: ["/api/auth/me"] });
  const currentUser: any = currentUserData;

  const createIssueMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/takeoff/issues", body);
      return res.json();
    },
    onSuccess: () => {
      if (issuesQueryKey) queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      queryClient.invalidateQueries({ queryKey: allSheetsIssuesQueryKey });
    },
    onError: () => toast({ title: "Error", description: "Failed to create issue", variant: "destructive" }),
  });

  const selectedIssue = issues.find((i: any) => i.id === selectedIssueId) || null;

  const currentSheetIsSuperseded = currentSheet && (currentSheet as any).isActive === false;
  const supersededBySheet = currentSheetIsSuperseded && (currentSheet as any).supersededById
    ? sheets.find((s: any) => s.id === (currentSheet as any).supersededById)
    : null;
  const predecessorSheet = !currentSheetIsSuperseded && currentSheet
    ? sheets.find((s: any) => s.supersededById === currentSheet.id)
    : null;
  const hasRevisionHistory = !!(predecessorSheet || supersededBySheet);
  const compareOldSheet = predecessorSheet || currentSheet;
  const compareNewSheet = supersededBySheet || (predecessorSheet ? currentSheet : null);

  const interactions = useTakeoffInteractions({
    projectId,
    sheetsQueryKey,
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

  const handleMarkupMouseDown = (e: any) => {
    if (!isMarkupTool(activeTool) || !selectedSheet) return;
    const pos = getStagePointer();
    if (!pos) return;
    if (activeTool === "markup_text") {
      setMarkupTextInput({ x: pos.x, y: pos.y, value: "" });
      return;
    }
    setMarkupDrawing(true);
    setMarkupDrawPoints([pos]);
  };

  const handleMarkupMouseMove = () => {
    if (!isMarkupTool(activeTool) || !markupDrawing) return;
    const pos = getStagePointer();
    if (!pos) return;
    if (activeTool === "markup_freehand") {
      setMarkupDrawPoints(prev => [...prev, pos]);
    } else {
      setMarkupDrawPoints(prev => prev.length > 0 ? [prev[0], pos] : [pos]);
    }
  };

  const handleMarkupMouseUp = async () => {
    if (!isMarkupTool(activeTool) || !markupDrawing || !selectedSheet) return;
    setMarkupDrawing(false);
    const points = [...markupDrawPoints];
    setMarkupDrawPoints([]);
    if (points.length < 2) return;
    try {
      await createMarkupMutation.mutateAsync({
        sheetId: selectedSheet,
        tool: toolToMarkupType(activeTool),
        points,
        color: markupColor,
        thickness: markupThickness,
      });
    } catch {
    }
  };

  const handleMarkupTextSubmit = async (text: string) => {
    if (!markupTextInput || !selectedSheet || !text.trim()) {
      setMarkupTextInput(null);
      return;
    }
    const pos = markupTextInput;
    setMarkupTextInput(null);
    try {
      await createMarkupMutation.mutateAsync({
        sheetId: selectedSheet,
        tool: "TEXT",
        points: [pos],
        color: markupColor,
        thickness: markupThickness,
        text: text.trim(),
      });
    } catch {
    }
  };

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

  const handleToggleCategoryVisibility = (categoryId: string) => {
    setHiddenCategoryIds(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
        const selM = measurements.find(m => m.id === selectedMeasurementId);
        if (selM && selM.categoryId === categoryId) {
          setSelectedMeasurementId(null);
        }
      }
      return next;
    });
  };

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

  useEffect(() => {
    const cleanup = onLibraryEvent((event: LibraryEvent) => {
      if (event.type === "APPLY_LIBRARY_ITEM") {
        if (!selectedMeasurementId) {
          toast({ title: "No Measurement Selected", description: "Select a measurement first, then apply a library item.", variant: "destructive" });
          return;
        }
        const updates: { id: string; label?: string; unitCost?: number; costCodeId?: string } = { id: selectedMeasurementId };
        if (event.item.name) updates.label = event.item.name;
        if (event.item.unitCost != null) updates.unitCost = event.item.unitCost;
        if (event.item.costCodeId) updates.costCodeId = event.item.costCodeId;
        updateMeasurementMutation.mutate(updates, {
          onSuccess: () => {
            toast({ title: "Item Applied", description: `"${event.item.name}" applied to measurement.` });
          },
        });
      } else if (event.type === "APPLY_LIBRARY_ASSEMBLY") {
        if (!selectedMeasurementId) {
          toast({ title: "No Measurement Selected", description: "Select a measurement first, then apply an assembly.", variant: "destructive" });
          return;
        }
        const firstItem = event.assembly.items?.[0];
        const updates: { id: string; label?: string; unitCost?: number } = {
          id: selectedMeasurementId,
          label: event.assembly.name,
        };
        if (firstItem?.unitCost != null) updates.unitCost = Number(firstItem.unitCost);
        updateMeasurementMutation.mutate(updates, {
          onSuccess: () => {
            toast({ title: "Assembly Applied", description: `"${event.assembly.name}" applied to measurement.` });
          },
        });
      } else if (event.type === "LOAD_SAVED_TAKEOFF") {
        toast({ title: "Saved Takeoff Loaded", description: `"${event.takeoff.name}" measurement data loaded. Select a sheet to apply.` });
      }
    });
    return cleanup;
  }, [selectedMeasurementId, updateMeasurementMutation, toast]);

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
        markupColor={markupColor}
        setMarkupColor={setMarkupColor}
        markupThickness={markupThickness}
        setMarkupThickness={setMarkupThickness}
      />

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0">
        {currentSheetIsSuperseded && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200" data-testid="banner-sheet-superseded">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>This drawing has been updated — some measurements may reference the old revision.</span>
            {compareNewSheet && (
              <Button variant="ghost" size="sm" className="ml-auto text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 h-7 px-2" onClick={() => setCompareDialogOpen(true)} data-testid="button-banner-compare">
                <GitCompare className="w-3.5 h-3.5 mr-1" /> Compare Revisions
              </Button>
            )}
          </div>
        )}
        <div className="h-12 sm:h-14 bg-card border-b px-2 sm:px-4 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
            <Label className="text-xs sm:text-sm font-medium shrink-0">Sheet:</Label>
            <Select value={selectedSheet || ""} onValueChange={setSelectedSheet}>
              <SelectTrigger className="w-32 sm:w-64" data-testid="select-sheet">
                <SelectValue placeholder="Select a sheet..." />
              </SelectTrigger>
              <SelectContent container={workspaceRef.current}>
                {sheets.map((sheet: any) => (
                  <SelectItem key={sheet.id} value={sheet.id}>
                    <span className="flex items-center gap-2">
                      {sheet.sheetName}
                      {sheet.revisionLabel && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{sheet.revisionLabel}</Badge>
                      )}
                      {sheet.isActive === false && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 opacity-60">Superseded</Badge>
                      )}
                    </span>
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
                  {hasRevisionHistory && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setCompareDialogOpen(true)}
                        data-testid="menu-compare-revisions"
                      >
                        <GitCompare className="h-4 w-4 mr-2" /> Compare Revisions
                      </DropdownMenuItem>
                    </>
                  )}
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
            {selectedSheet && issues.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="hide-resolved-toggle">
                <Switch
                  id="hide-resolved"
                  checked={hideResolvedIssues}
                  onCheckedChange={setHideResolvedIssues}
                  className="h-4 w-7 data-[state=checked]:bg-green-500"
                />
                <label htmlFor="hide-resolved" className="cursor-pointer select-none hidden sm:block">Hide Resolved</label>
              </div>
            )}
            {selectedSheet && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setScaleModalOpen(true)}
                className="gap-1.5"
                data-testid="button-add-scale"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{currentSheet?.scalePxPerFoot ? "Set Scale" : "Add Scale"}</span>
              </Button>
            )}
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
              onMouseDown={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseDown(e); } else { handleStageMouseDown(e); } }}
              onMouseUp={(e: any) => {
                if (isMarkupTool(activeTool)) { handleMarkupMouseUp(); return; }
                if (activeTool === "issue_pin" && selectedSheet) {
                  const stage = e.target.getStage();
                  const pointerPosition = stage.getPointerPosition();
                  if (!pointerPosition) return;
                  const transform = stage.getAbsoluteTransform().copy().invert();
                  const point = transform.point(pointerPosition);
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
              onMouseMove={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseMove(); } else { handleStageMouseMove(e); } }}
              onTouchStart={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseDown(e); } else { handleStageMouseDown(e); } }}
              onTouchEnd={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseUp(); } else { handleTouchEnd(e); } }}
              onTouchMove={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseMove(); } else { handleTouchMove(e); } }}
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
                  if (m.categoryId && hiddenCategoryIds.has(m.categoryId)) return null;
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

                {issues.map((issue: any) => {
                  if (!issue.position) return null;
                  if (hideResolvedIssues && issue.status === "RESOLVED") return null;
                  let pos: { x: number; y: number };
                  try { pos = typeof issue.position === "string" ? JSON.parse(issue.position) : issue.position; } catch { return null; }
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
                      onClick={(e: any) => {
                        e.cancelBubble = true;
                        setSelectedIssueId(issue.id === selectedIssueId ? null : issue.id);
                      }}
                      onTap={(e: any) => {
                        e.cancelBubble = true;
                        setSelectedIssueId(issue.id === selectedIssueId ? null : issue.id);
                      }}
                      style={{ cursor: "pointer" }}
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
                  const pts = markup.points as { x: number; y: number }[];
                  if (!pts || pts.length === 0) return null;
                  const color = (markup.color as string) || "#ff0000";
                  const thickness = (markup.thickness as number) || 2;
                  const tool = markup.tool as string;
                  if (tool === "ARROW" && pts.length >= 2) {
                    return (
                      <Arrow
                        key={markup.id}
                        points={[pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y]}
                        stroke={color}
                        strokeWidth={thickness}
                        fill={color}
                        pointerLength={12}
                        pointerWidth={8}
                        listening={false}
                      />
                    );
                  }
                  if (tool === "TEXT" && pts.length >= 1) {
                    return (
                      <Text
                        key={markup.id}
                        x={pts[0].x}
                        y={pts[0].y}
                        text={(markup.text as string) || ""}
                        fontSize={16 / stageScale}
                        fill={color}
                        listening={false}
                      />
                    );
                  }
                  if (tool === "RECTANGLE" && pts.length >= 2) {
                    const x = Math.min(pts[0].x, pts[1].x);
                    const y = Math.min(pts[0].y, pts[1].y);
                    const w = Math.abs(pts[1].x - pts[0].x);
                    const h = Math.abs(pts[1].y - pts[0].y);
                    return (
                      <Rect
                        key={markup.id}
                        x={x} y={y} width={w} height={h}
                        stroke={color}
                        strokeWidth={thickness}
                        fill="transparent"
                        listening={false}
                      />
                    );
                  }
                  if (tool === "HIGHLIGHT" && pts.length >= 2) {
                    const x = Math.min(pts[0].x, pts[1].x);
                    const y = Math.min(pts[0].y, pts[1].y);
                    const w = Math.abs(pts[1].x - pts[0].x);
                    const h = Math.abs(pts[1].y - pts[0].y);
                    return (
                      <Rect
                        key={markup.id}
                        x={x} y={y} width={w} height={h}
                        fill={color}
                        opacity={0.3}
                        listening={false}
                      />
                    );
                  }
                  if ((tool === "FREEHAND" || tool === "CLOUD") && pts.length >= 2) {
                    return (
                      <Line
                        key={markup.id}
                        points={pts.flatMap(p => [p.x, p.y])}
                        stroke={color}
                        strokeWidth={thickness}
                        tension={tool === "CLOUD" ? 0.5 : 0}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                    );
                  }
                  return null;
                })}

                {markupDrawing && markupDrawPoints.length >= 2 && (() => {
                  const pts = markupDrawPoints;
                  if (activeTool === "markup_arrow") {
                    return (
                      <Arrow
                        key="markup-preview"
                        points={[pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y]}
                        stroke={markupColor}
                        strokeWidth={markupThickness}
                        fill={markupColor}
                        pointerLength={12}
                        pointerWidth={8}
                        opacity={0.7}
                        listening={false}
                      />
                    );
                  }
                  if (activeTool === "markup_rectangle") {
                    const x = Math.min(pts[0].x, pts[1].x);
                    const y = Math.min(pts[0].y, pts[1].y);
                    const w = Math.abs(pts[1].x - pts[0].x);
                    const h = Math.abs(pts[1].y - pts[0].y);
                    return (
                      <Rect
                        key="markup-preview"
                        x={x} y={y} width={w} height={h}
                        stroke={markupColor}
                        strokeWidth={markupThickness}
                        fill="transparent"
                        opacity={0.7}
                        listening={false}
                      />
                    );
                  }
                  if (activeTool === "markup_highlight") {
                    const x = Math.min(pts[0].x, pts[1].x);
                    const y = Math.min(pts[0].y, pts[1].y);
                    const w = Math.abs(pts[1].x - pts[0].x);
                    const h = Math.abs(pts[1].y - pts[0].y);
                    return (
                      <Rect
                        key="markup-preview"
                        x={x} y={y} width={w} height={h}
                        fill={markupColor}
                        opacity={0.2}
                        listening={false}
                      />
                    );
                  }
                  return (
                    <Line
                      key="markup-preview"
                      points={pts.flatMap(p => [p.x, p.y])}
                      stroke={markupColor}
                      strokeWidth={markupThickness}
                      tension={activeTool === "markup_cloud" ? 0.5 : 0}
                      lineCap="round"
                      lineJoin="round"
                      opacity={0.7}
                      listening={false}
                    />
                  );
                })()}
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

          {markupTextInput && (
            <div
              className="absolute z-50 pointer-events-auto"
              style={{
                left: markupTextInput.x * stageScale + stagePosition.x,
                top: markupTextInput.y * stageScale + stagePosition.y,
              }}
            >
              <input
                autoFocus
                className="border-2 border-primary rounded px-2 py-1 text-sm bg-background shadow-md min-w-40"
                placeholder="Type label..."
                defaultValue=""
                data-testid="input-markup-text"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleMarkupTextSubmit(e.currentTarget.value);
                  if (e.key === "Escape") setMarkupTextInput(null);
                }}
                onBlur={(e) => handleMarkupTextSubmit(e.currentTarget.value)}
              />
            </div>
          )}
        </div>
      </div>

      {selectedIssue && (
        <IssueDetailPanel
          issue={selectedIssue}
          orgUsers={orgUsers}
          currentUser={currentUser}
          sheetId={selectedSheet!}
          onClose={() => setSelectedIssueId(null)}
          onDelete={() => {
            setSelectedIssueId(null);
            if (issuesQueryKey) queryClient.invalidateQueries({ queryKey: issuesQueryKey });
            queryClient.invalidateQueries({ queryKey: allSheetsIssuesQueryKey });
          }}
        />
      )}

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
        hiddenCategoryIds={hiddenCategoryIds}
        onToggleCategoryVisibility={handleToggleCategoryVisibility}
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
        sheets={sheets}
        onCompareRevisions={hasRevisionHistory ? () => setCompareDialogOpen(true) : undefined}
        onSelectSheet={setSelectedSheet}
        markups={markups}
        deleteMarkupMutation={deleteMarkupMutation}
        issues={issues}
        allSheetIssues={allIssues}
        selectedIssueId={selectedIssueId}
        onSelectIssue={(issue) => {
          setSelectedIssueId(issue.id);
          if (issue.sheetId && issue.sheetId !== selectedSheet) {
            setSelectedSheet(issue.sheetId);
          }
        }}
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
        categories={categories}
        hiddenCategoryIds={hiddenCategoryIds}
        onToggleCategoryVisibility={handleToggleCategoryVisibility}
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
        supersedeSheetMutation={supersedeSheetMutation}
        workspaceRef={workspaceRef}
      />

      {compareDialogOpen && currentSheet && compareNewSheet && (
        <TakeoffSheetCompareDialog
          open={compareDialogOpen}
          onOpenChange={setCompareDialogOpen}
          oldSheet={compareOldSheet as any}
          newSheet={compareNewSheet as any}
          allSheets={sheets as any[]}
        />
      )}

      <PlanScaleModal
        open={scaleModalOpen}
        onClose={() => setScaleModalOpen(false)}
        onApplyScale={async (pxPerFoot, scaleUnits, label) => {
          if (!selectedSheet) return;
          try {
            await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: pxPerFoot, units: scaleUnits });
            queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
            toast({ title: "Scale Applied", description: `Scale set to ${label}` });
          } catch (error: any) {
            toast({ title: "Error", description: error?.message || "Failed to apply scale", variant: "destructive" });
          }
        }}
        onStartCalibration={() => {
          setCalibrationMode("first-point");
          setCalibrationPoints([]);
          setCalibrationDistance("");
          setActiveTool("calibrate");
        }}
        currentScalePxPerFoot={currentSheet?.scalePxPerFoot ?? null}
      />
    </div>
  );
}
