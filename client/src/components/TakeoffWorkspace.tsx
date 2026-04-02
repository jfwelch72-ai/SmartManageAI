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
  Maximize, Minimize, Trash2, Plus, AlertTriangle, GitCompare, Ruler,
  CheckCircle2, AlertCircle, GalleryHorizontal, List,
  Link2, ArrowLeft, Search, X, Tag, History, PanelRight, ArrowRight
} from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import {
  createArcSegment,
  sampleArcPoints,
} from "@shared/utils/geometry";
import { type Tool, validateHexColor, hexToRgba } from "./takeoff/types";
import { detectScaleFromText, type DetectedScale } from "@/lib/scaleDetection";
import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffInteractions } from "@/hooks/use-takeoff-interactions";
import { TakeoffToolbar } from "./takeoff/TakeoffToolbar";
import { TakeoffSidebar } from "./takeoff/TakeoffSidebar";
import TakeoffCrossModulePanel from "./takeoff/TakeoffCrossModulePanel";
import { PageThumbnailStrip } from "./takeoff/PageThumbnailStrip";
import { TakeoffDialogs } from "./takeoff/TakeoffDialogs";
import { PlanScaleModal } from "./takeoff/PlanScaleModal";
import { TakeoffSheetCompareDialog } from "./takeoff/TakeoffSheetCompareDialog";
import { TakeoffPropertiesPanel } from "./takeoff/TakeoffPropertiesPanel";
import { TakeoffVersionHistory } from "./takeoff/TakeoffVersionHistory";
import { IssueDetailPanel } from "./takeoff/IssueDetailPanel";
import AiTakeoffPanel, { type DetectedItem } from "@/components/AiTakeoffPanel";

const AI_ZONE = { MARGIN_X: 80, START_Y: 40, SPACING_X: 220, SPACING_Y: 60, COLS: 3 };
function computeAiPosition(aiIdx: number, imageWidth: number) {
  const col = aiIdx % AI_ZONE.COLS;
  const row = Math.floor(aiIdx / AI_ZONE.COLS);
  return { x: imageWidth + AI_ZONE.MARGIN_X + col * AI_ZONE.SPACING_X, y: AI_ZONE.START_Y + row * AI_ZONE.SPACING_Y };
}
import { cn } from "@/lib/utils";
import { onLibraryEvent } from "@/lib/libraryEvents";
import { generateTakeoffExcel } from "@/utils/takeoff-export";
import type { LibraryEvent } from "@/lib/libraryEvents";
import { useTakeoffCollaboration } from "@/hooks/use-takeoff-collaboration";
import { Users, Lock } from "lucide-react";

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
  const [localRotation, setLocalRotation] = useState<number | null>(null);
  const takeoffHistory = useTakeoffHistory(selectedSheet);
  const prevSheetRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSheetRef.current !== null && prevSheetRef.current !== selectedSheet) {
      takeoffHistory.clear();
      setHiddenCategoryIds(new Set());
      setLocalRotation(null);
      setSelectedVersionId(null);
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
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
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
  const [categoryLineStyle, setCategoryLineStyle] = useState("solid");
  const [categoryLineWidth, setCategoryLineWidth] = useState(3);
  const [categoryWasteFactor, setCategoryWasteFactor] = useState("0");
  const [categoryUnitCost, setCategoryUnitCost] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSheetConfirmOpen, setDeleteSheetConfirmOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [hideAiMeasurements, setHideAiMeasurements] = useState(false);
  const [showAiOverlays, setShowAiOverlays] = useState(true);
  const [highlightedAiItem, setHighlightedAiItem] = useState<DetectedItem | null>(null);
  const [preImportDetectedItems, setPreImportDetectedItems] = useState<DetectedItem[]>([]);
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
  const [detectedScale, setDetectedScale] = useState<DetectedScale | null>(null);
  const [thumbnailStripOpen, setThumbnailStripOpen] = useState(false);
  const [propertiesPanelOpen, setPropertiesPanelOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [linkNavigationHistory, setLinkNavigationHistory] = useState<string[]>([]);
  const [createLinkMode, setCreateLinkMode] = useState<{ step: "select-area" | "select-target"; startPoint?: { x: number; y: number }; endPoint?: { x: number; y: number } } | null>(null);
  const [createLinkTargetSheet, setCreateLinkTargetSheet] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);
  const [measurementContextMenu, setMeasurementContextMenu] = useState<{ x: number; y: number; measurementId: string } | null>(null);
  const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);
  const [flashMeasurementId, setFlashMeasurementId] = useState<string | null>(null);
  const [flashPulse, setFlashPulse] = useState(0);
  const [gridEnabled, setGridEnabled] = useState(() => {
    try { return localStorage.getItem("takeoff-grid-enabled") === "true"; } catch { return false; }
  });
  const [crossModulePanelOpen, setCrossModulePanelOpen] = useState(false);

  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const isMarkupTool = (tool: string) => tool.startsWith("markup_");

  const inverseRotate = (pt: { x: number; y: number }): { x: number; y: number } => {
    const w = pdfImage?.width || 0;
    const h = pdfImage?.height || 0;
    switch (sheetRotation) {
      case 90: return { x: w - pt.y, y: pt.x };
      case 180: return { x: w - pt.x, y: h - pt.y };
      case 270: return { x: pt.y, y: h - pt.x };
      default: return pt;
    }
  };

  const getStagePointer = (): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    const raw = {
      x: (pos.x - stagePosition.x) / stageScale,
      y: (pos.y - stagePosition.y) / stageScale,
    };
    return inverseRotate(raw);
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

  const { data: currentUserData } = useQuery({ queryKey: ["/api/auth/me"] });
  const currentUser: any = currentUserData;

  const collabRoomId = context?.type === "bid" ? context.bidId : projectId;
  const collab = useTakeoffCollaboration({
    roomId: collabRoomId || null,
    selectedSheet,
    currentUserId: currentUser?.id || null,
  });

  const data = useTakeoffData({
    projectId,
    projectCode,
    context,
    selectedSheet,
    selectedVersionId,
    uploadDialogOpen,
    takeoffHistory,
    selectedCategoryId,
    onCollabBroadcast: collab.broadcastMeasurementChange,
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
    isViewingLockedVersion, markups, sheetLinks,
    categories, currentSheet, aggregatedMeasurements,
    sheetsQueryKey,
    importPlanMutation, supersedeSheetMutation, createMeasurementMutation,
    updateMeasurementMutation, deleteMeasurementMutation,
    createMarkupMutation, deleteMarkupMutation,
    createSheetLinkMutation, deleteSheetLinkMutation, detectLinksMutation,
    saveCategoryMutation, deleteCategoryMutation,
    renameSheetMutation, duplicateSheetMutation,
    deleteSheetMutation, handleMoveSheet,
    measurementGroups, createGroupMutation, updateGroupMutation,
    deleteGroupMutation, toggleGroupVisibilityMutation,
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

  const { data: measurementLinksData } = useQuery<any>({
    queryKey: ["/api/takeoff/projects", projectId, "measurement-links"],
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/projects/${projectId}/measurement-links`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!projectId && context?.type !== "bid",
    staleTime: 30000,
  });
  const measurementLinks = measurementLinksData?.linkedMeasurementIds
    ? {
        hasPR: new Set<string>(measurementLinksData.linkedMeasurementIds.pr || []),
        hasCO: new Set<string>(measurementLinksData.linkedMeasurementIds.co || []),
        hasSOV: new Set<string>(measurementLinksData.linkedMeasurementIds.sov || []),
      }
    : undefined;

  const { data: orgUsersData = [] } = useQuery({ queryKey: ["/api/messaging/users"] });
  const orgUsers: any[] = (orgUsersData as any[]).map((u: any) => ({
    ...u,
    name: u.name || `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
  }));

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

  const serverRotation = (currentSheet as any)?.rotation ?? 0;
  const sheetRotation = localRotation ?? serverRotation;

  useEffect(() => {
    setLocalRotation(null);
  }, [serverRotation]);

  const rotationMutation = useMutation({
    mutationFn: async ({ sheetId, rotation }: { sheetId: string; rotation: number }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rotation`, { rotation });
      return res.json();
    },
    onSuccess: () => {
      if (sheetsQueryKey) queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
    },
    onError: () => {
      setLocalRotation(null);
      toast({ title: "Error", description: "Failed to save rotation", variant: "destructive" });
    },
  });

  const handleRotate = (delta: number) => {
    if (!selectedSheet) return;
    const newRotation = ((sheetRotation + delta) % 360 + 360) % 360;
    setLocalRotation(newRotation);
    rotationMutation.mutate({ sheetId: selectedSheet, rotation: newRotation });
  };

  const handleToggleGrid = (v: boolean) => {
    setGridEnabled(v);
    try { localStorage.setItem("takeoff-grid-enabled", v ? "true" : "false"); } catch {}
  };

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

  const handleLinkNavigate = (targetSheetId: string) => {
    if (selectedSheet) {
      setLinkNavigationHistory(prev => [...prev, selectedSheet]);
    }
    setSelectedSheet(targetSheetId);
  };

  const handleLinkBack = () => {
    if (linkNavigationHistory.length > 0) {
      const prevSheet = linkNavigationHistory[linkNavigationHistory.length - 1];
      setLinkNavigationHistory(prev => prev.slice(0, -1));
      setSelectedSheet(prevSheet);
    }
  };

  const allSheetsLinksQueryKey = ["__all_links__", sheets.map((s: any) => s.id).join(",")];
  const allSheetsLinksQuery = useQuery({
    queryKey: allSheetsLinksQueryKey,
    enabled: sheets.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        sheets.map((sheet: any) =>
          fetch(`/api/takeoff/sheets/${sheet.id}/links`, { credentials: "include" })
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      const linksBySheet: Record<string, number> = {};
      results.forEach((links: any[], i: number) => {
        if (links.length > 0) {
          linksBySheet[sheets[i].id] = links.length;
        }
      });
      return linksBySheet;
    },
    staleTime: 30000,
  });
  const linkCountsBySheet: Record<string, number> = (allSheetsLinksQuery.data || {}) as Record<string, number>;

  const zoomToFitRef = useRef<() => void>(() => {});

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
    setSelectedSegmentIndex,
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
    deleteMeasurementMutation,
    onZoomToFit: () => zoomToFitRef.current(),
    sheetRotation,
    imageWidth: pdfImage?.width || 0,
    imageHeight: pdfImage?.height || 0,
    onRotateCW: () => handleRotate(90),
    onRotateCCW: () => handleRotate(-90),
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
    completeSegment,
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
      setCategoryLineStyle(editingCategory.lineStyle || "solid");
      setCategoryLineWidth(editingCategory.lineWidth || 3);
      setCategoryWasteFactor(String(editingCategory.wasteFactor ?? 0));
      setCategoryUnitCost(editingCategory.unitCost ? String(editingCategory.unitCost) : "");
    } else {
      setCategoryName("");
      setCategoryColor("#3b82f6");
      setCategoryLineStyle("solid");
      setCategoryLineWidth(3);
      setCategoryWasteFactor("0");
      setCategoryUnitCost("");
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

  const parseMeasurementPoints = (m: any): { x: number; y: number }[] => {
    try {
      const pts = typeof m.points === "string" ? JSON.parse(m.points) : m.points;
      return Array.isArray(pts) ? pts : [];
    } catch { return []; }
  };

  const getMeasurementCenter = (m: any): { x: number; y: number } | null => {
    let pts = parseMeasurementPoints(m);
    if (pts.length === 0 && m.source === "AI" && m.type === "COUNT") {
      const aiCountMeasurements = measurements.filter(mm => mm.source === "AI" && mm.type === "COUNT");
      const aiIdx = aiCountMeasurements.findIndex(mm => mm.id === m.id);
      if (aiIdx >= 0) {
        pts = [computeAiPosition(aiIdx, pdfImage?.width || 2000)];
      }
    }
    if (pts.length === 0) return null;
    if (m.type === "COUNT" || m.type === "NOTE") return pts[0];
    if ((m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && pts.length >= 2) {
      return { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    }
    if (pts.length >= 3) {
      let signedArea = 0;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        signedArea += cross;
        cx += (pts[i].x + pts[j].x) * cross;
        cy += (pts[i].y + pts[j].y) * cross;
      }
      signedArea *= 0.5;
      if (Math.abs(signedArea) > 1e-6) {
        cx /= (6 * signedArea);
        cy /= (6 * signedArea);
        return { x: cx, y: cy };
      }
    }
    const avgX = pts.reduce((sum: number, p: any) => sum + p.x, 0) / pts.length;
    const avgY = pts.reduce((sum: number, p: any) => sum + p.y, 0) / pts.length;
    return { x: avgX, y: avgY };
  };

  const backfilledAiIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!measurements.length || !pdfImage?.width) return;
    const legacyAiMeasurements = measurements.filter(m => {
      if (m.source !== "AI" || m.type !== "COUNT") return false;
      if (backfilledAiIdsRef.current.has(m.id)) return false;
      const pts = parseMeasurementPoints(m);
      return !pts || pts.length === 0;
    });
    if (legacyAiMeasurements.length === 0) return;
    const allAiCount = measurements.filter(mm => mm.source === "AI" && mm.type === "COUNT");
    legacyAiMeasurements.forEach(m => {
      const aiIdx = allAiCount.findIndex(mm => mm.id === m.id);
      if (aiIdx < 0) return;
      const pos = computeAiPosition(aiIdx, pdfImage.width);
      const mId = m.id;
      backfilledAiIdsRef.current.add(mId);
      updateMeasurementMutation.mutate(
        { id: mId, points: JSON.stringify([pos]) },
        { onError: () => { backfilledAiIdsRef.current.delete(mId); } }
      );
    });
  }, [measurements, pdfImage]);

  const getMeasurementBounds = (m: any): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    const pts = parseMeasurementPoints(m);
    if (pts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (m.type === "COUNT" || m.type === "NOTE" || pts.length === 1) {
      const pad = 100;
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }
    return { minX, minY, maxX, maxY };
  };

  const animateToPosition = (targetScale: number, targetPos: { x: number; y: number }) => {
    const startScale = stageScale;
    const startPos = { ...stagePosition };
    const duration = 300;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setStageScale(startScale + (targetScale - startScale) * ease);
      setStagePosition({
        x: startPos.x + (targetPos.x - startPos.x) * ease,
        y: startPos.y + (targetPos.y - startPos.y) * ease,
      });
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };

  zoomToFitRef.current = () => {
    if (!pdfImage) return;
    const sw = stageDimensions.width;
    const sh = stageDimensions.height;
    const padding = 0.05;
    const scaleX = sw / (pdfImage.width * (1 + padding * 2));
    const scaleY = sh / (pdfImage.height * (1 + padding * 2));
    const targetScale = Math.min(scaleX, scaleY, 10);
    const targetPos = {
      x: (sw - pdfImage.width * targetScale) / 2,
      y: (sh - pdfImage.height * targetScale) / 2,
    };
    animateToPosition(targetScale, targetPos);
  };

  useEffect(() => {
    if (!flashMeasurementId) return;
    let animId: number;
    const startTime = performance.now();
    const duration = 2000;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed >= duration) {
        setFlashMeasurementId(null);
        setFlashPulse(0);
        return;
      }
      const t = elapsed / duration;
      const pulse = Math.sin(t * Math.PI * 4) * 0.5 + 0.5;
      const fade = 1 - t;
      setFlashPulse(pulse * fade);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [flashMeasurementId]);

  const triggerFlash = (measurementId: string) => {
    setFlashMeasurementId(measurementId);
  };

  const handleZoomToMeasurement = (m: any) => {
    if (m.sheetId && m.sheetId !== selectedSheet) {
      setSelectedSheet(m.sheetId);
    }
    const center = getMeasurementCenter(m);
    if (!center) return;
    const sw = stageDimensions.width;
    const sh = stageDimensions.height;
    const targetPos = {
      x: sw / 2 - center.x * stageScale,
      y: sh / 2 - center.y * stageScale,
    };
    animateToPosition(stageScale, targetPos);
    triggerFlash(m.id);
  };

  const handleZoomToFitMeasurement = (m: any) => {
    if (m.sheetId && m.sheetId !== selectedSheet) {
      setSelectedSheet(m.sheetId);
    }
    const bounds = getMeasurementBounds(m);
    if (!bounds) return;
    const sw = stageDimensions.width;
    const sh = stageDimensions.height;
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const padding = 0.2;
    const scaleX = sw / (bw * (1 + padding * 2));
    const scaleY = sh / (bh * (1 + padding * 2));
    const targetScale = Math.min(scaleX, scaleY, 10);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const targetPos = {
      x: sw / 2 - cx * targetScale,
      y: sh / 2 - cy * targetScale,
    };
    animateToPosition(targetScale, targetPos);
    triggerFlash(m.id);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm("Delete this category? Measurements will not be deleted, but will lose their category assignment.")) {
      return;
    }
    deleteCategoryMutation.mutate(categoryId);
  };

  const handleExportCurrentSheet = () => {
    if (measurements.length === 0) {
      toast({ title: "No measurements", description: "There are no measurements to export on this sheet", variant: "destructive" });
      return;
    }
    const filtered = measurements.filter(m => !m.categoryId || !hiddenCategoryIds.has(m.categoryId));
    if (filtered.length === 0) {
      toast({ title: "No measurements", description: "All measurements are hidden by category filters", variant: "destructive" });
      return;
    }
    generateTakeoffExcel({
      projectName: projectCode || "Takeoff",
      measurements: filtered,
      sheets,
      categories,
      hiddenCategoryIds,
    });
    toast({ title: "Export complete", description: "Current sheet exported to Excel" });
  };

  const handleExportAllSheets = async () => {
    try {
      const isBid = context?.type === "bid";
      const ctxId = isBid ? context.bidId : projectId;
      const url = isBid
        ? `/api/bids/${ctxId}/takeoff/all-measurements`
        : `/api/projects/${ctxId}/takeoff/all-measurements`;
      const res = await apiRequest("GET", url);
      const allMeasurements = await res.json();
      if (!allMeasurements || allMeasurements.length === 0) {
        toast({ title: "No measurements", description: "There are no measurements across any sheets", variant: "destructive" });
        return;
      }
      generateTakeoffExcel({
        projectName: projectCode || "Takeoff",
        measurements: allMeasurements,
        sheets,
        categories,
        hiddenCategoryIds,
      });
      toast({ title: "Export complete", description: `All sheets exported to Excel (${allMeasurements.length} measurements)` });
    } catch {
      toast({ title: "Error", description: "Failed to fetch measurements for export", variant: "destructive" });
    }
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
      lineStyle: categoryLineStyle,
      lineWidth: categoryLineWidth,
      wasteFactor: parseFloat(categoryWasteFactor) || 0,
      unitCost: categoryUnitCost ? parseFloat(categoryUnitCost) : null,
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
        }).promise;
        const img = new window.Image();
        img.src = canvas.toDataURL();
        img.onload = () => {
          setPdfImage(img);
          setIsPdfLoading(false);
        };

        if (!currentSheet.scalePxPerFoot) {
          try {
            const textContent = await page.getTextContent();
            const textItems = textContent.items
              .filter((item: any) => item.str && item.str.trim())
              .map((item: any) => item.str as string);
            const detected = detectScaleFromText(textItems);
            if (detected) {
              setDetectedScale(detected);
            }
          } catch (textErr) {
            console.warn("Could not extract text from PDF for scale detection:", textErr);
          }
        }
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
    setDetectedScale(null);
  }, [currentSheet?.id, currentSheet?.imageUrl, toast]);

  const autoDetectedSheetsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (currentSheet?.id && sheetLinks.length === 0 && !autoDetectedSheetsRef.current.has(currentSheet.id)) {
      autoDetectedSheetsRef.current.add(currentSheet.id);
      detectLinksMutation.mutate(currentSheet.id);
    }
  }, [currentSheet?.id, sheetLinks.length]);

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

  const measurementTypeToTool = (mt: string): Tool => {
    const map: Record<string, Tool> = {
      LINEAR: "linear", AREA: "area", VOLUME: "volume", COUNT: "count",
      LINEAR_WITH_DROP: "linear_with_drop", PITCHED_LINEAR: "pitched_linear",
      PITCHED_AREA: "pitched_area", SURFACE_AREA: "surface_area",
    };
    return map[mt] || "linear";
  };

  const handleActivateCondition = (condition: TakeoffCondition) => {
    setActiveCondition(condition);
    const tool = measurementTypeToTool(condition.measurementType);
    setActiveTool(tool);
    if (condition.categoryName) {
      const cat = categories.find(c => c.name === condition.categoryName);
      if (cat) {
        setSelectedCategoryId(cat.id);
      } else {
        setSelectedCategoryId(null);
      }
    } else {
      setSelectedCategoryId(null);
    }
    updateConditionMutation.mutate({ id: condition.id, lastUsedAt: new Date().toISOString() });
    toast({ title: "Condition Active", description: `"${condition.name}" selected — start drawing` });
  };

  const handleClearCondition = () => {
    setActiveCondition(null);
  };

  const handleSaveCondition = (data: { name: string; measurementType: string; color: string; categoryName?: string; unitCost?: number; costCodeId?: string; labelTemplate?: string; lineStyle?: string }) => {
    createConditionMutation.mutate(data);
  };

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
        onExportCurrentSheet={handleExportCurrentSheet}
        onExportAllSheets={handleExportAllSheets}
        onShowShortcuts={() => setShortcutsDialogOpen(true)}
        sheetRotation={sheetRotation}
        onRotateCW={() => handleRotate(90)}
        onRotateCCW={() => handleRotate(-90)}
        onRotate180={() => handleRotate(180)}
        gridEnabled={gridEnabled}
        onToggleGrid={handleToggleGrid}
        isCalibrated={!!currentSheet?.scalePxPerFoot}
      />

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0 relative">
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setVersionHistoryOpen(true)}
                data-testid="button-version-history"
              >
                <History className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version History</TooltipContent>
          </Tooltip>
          {selectedMeasurementId && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={propertiesPanelOpen ? "default" : "outline"}
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setPropertiesPanelOpen(!propertiesPanelOpen)}
                  data-testid="button-properties-panel"
                >
                  <PanelRight className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Properties Panel</TooltipContent>
            </Tooltip>
          )}
        </div>
        {isViewingLockedVersion && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200" data-testid="banner-viewing-historical">
            <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Viewing historical version (read-only)</span>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-7 px-3 text-xs"
              onClick={() => setSelectedVersionId(null)}
              data-testid="button-return-to-draft"
            >
              Return to current draft
            </Button>
          </div>
        )}
        {detectedScale && !currentSheet?.scalePxPerFoot && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800 px-4 py-2 flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200" data-testid="banner-detected-scale">
            <Ruler className="w-4 h-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>Detected scale: <strong>{detectedScale.label}</strong></span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={async () => {
                  if (!selectedSheet) return;
                  try {
                    await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, {
                      scalePxPerFoot: detectedScale.pxPerFoot,
                      units: detectedScale.units,
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
                    toast({ title: "Scale Applied", description: `Auto-detected scale ${detectedScale.label} applied` });
                    setDetectedScale(null);
                  } catch {
                    toast({ title: "Error", description: "Failed to apply detected scale", variant: "destructive" });
                  }
                }}
                data-testid="button-accept-detected-scale"
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                onClick={() => setDetectedScale(null)}
                data-testid="button-reject-detected-scale"
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}
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
                      {sheet.scalePxPerFoot ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                      )}
                      {sheet.sheetName}
                      {sheet.revisionLabel && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{sheet.revisionLabel}</Badge>
                      )}
                      {sheet.isActive === false && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 opacity-60">Superseded</Badge>
                      )}
                      {linkCountsBySheet[sheet.id] > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0 text-blue-600 border-blue-300" data-testid={`badge-links-count-${sheet.id}`}>
                          <Link2 className="w-2.5 h-2.5 mr-0.5" />{linkCountsBySheet[sheet.id]}
                        </Badge>
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
                    onClick={() => selectedSheet && detectLinksMutation.mutate(selectedSheet)}
                    disabled={detectLinksMutation.isPending}
                    data-testid="menu-detect-links"
                  >
                    <Search className="h-4 w-4 mr-2" /> {detectLinksMutation.isPending ? "Detecting..." : "Detect Links"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setCreateLinkMode({ step: "select-area" })}
                    data-testid="menu-create-link"
                  >
                    <Link2 className="h-4 w-4 mr-2" /> Create Link to Sheet
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
            {sheets.length > 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={thumbnailStripOpen ? "secondary" : "ghost"}
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setThumbnailStripOpen((v) => !v)}
                    data-testid="button-toggle-thumbnails"
                  >
                    {thumbnailStripOpen ? <List className="h-4 w-4" /> : <GalleryHorizontal className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{thumbnailStripOpen ? "Hide Thumbnails" : "Show Page Thumbnails"}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {linkNavigationHistory.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleLinkBack}
                className="gap-1 h-7 px-2 text-xs"
                data-testid="button-link-back"
              >
                <ArrowLeft className="h-3 w-3" />
                <span className="hidden sm:inline">Back</span>
              </Button>
            )}
            {currentSheet && (
              <Badge variant="outline" data-testid="badge-calibration-status">
                {currentSheet.scalePxPerFoot
                  ? `Calibrated (${currentSheet.units})`
                  : "Not Calibrated"}
              </Badge>
            )}
            {selectedSheet && collab.collaborators.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={collab.sheetLocks.has(selectedSheet) && collab.sheetLocks.get(selectedSheet)?.userId === currentUser?.id ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-1 h-7 px-2"
                    onClick={() => {
                      if (!selectedSheet) return;
                      const myLock = collab.sheetLocks.get(selectedSheet);
                      if (myLock && myLock.userId === currentUser?.id) {
                        collab.unlockSheet(selectedSheet);
                      } else {
                        collab.lockSheet(selectedSheet);
                      }
                    }}
                    data-testid="button-sheet-lock-toggle"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-xs">
                      {collab.sheetLocks.has(selectedSheet) && collab.sheetLocks.get(selectedSheet)?.userId === currentUser?.id ? "Unlock" : "Lock"}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {collab.sheetLocks.has(selectedSheet) && collab.sheetLocks.get(selectedSheet)?.userId === currentUser?.id
                      ? "Release \"I'm working here\" lock"
                      : "Set \"I'm working here\" soft lock"}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {sheetLinks.length > 0 && (
              <Badge variant="outline" className="text-blue-600 border-blue-300" data-testid="badge-sheet-links">
                <Link2 className="w-3 h-3 mr-1" />{sheetLinks.length} Links
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {collab.collaborators.length > 0 && (
              <div className="flex items-center gap-1" data-testid="collaborators-indicator">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center -space-x-1.5">
                      {collab.collaborators.slice(0, 4).map((c) => (
                        <Tooltip key={c.userId}>
                          <TooltipTrigger asChild>
                            <div
                              className="w-7 h-7 rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white cursor-default"
                              style={{ backgroundColor: c.userColor }}
                              data-testid={`avatar-collaborator-${c.userId}`}
                            >
                              {c.userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{c.userName}</p>
                            {c.currentSheetId && (
                              <p className="text-xs text-muted-foreground">
                                Viewing: {sheets.find(s => s.id === c.currentSheetId)?.sheetName || "Unknown sheet"}
                              </p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      {collab.collaborators.length > 4 && (
                        <div className="w-7 h-7 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                          +{collab.collaborators.length - 4}
                        </div>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{collab.collaborators.length} collaborator{collab.collaborators.length > 1 ? "s" : ""} online</p>
                  </TooltipContent>
                </Tooltip>
                <Users className="w-4 h-4 text-muted-foreground ml-1" />
              </div>
            )}
            {collab.currentSheetLock && (
              <div className="flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 rounded text-xs text-amber-700 dark:text-amber-300" data-testid="sheet-lock-warning">
                <Lock className="w-3 h-3" />
                <span>{collab.currentSheetLock.userName} is working here</span>
              </div>
            )}
            {!collab.connected && collabRoomId && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300" data-testid="badge-offline">
                Offline
              </Badge>
            )}
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
            {context?.type !== "bid" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={crossModulePanelOpen ? "secondary" : "ghost"}
                    size="icon"
                    onClick={() => setCrossModulePanelOpen((v) => !v)}
                    data-testid="button-toggle-cross-module"
                  >
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{crossModulePanelOpen ? "Hide Cross-Module Panel" : "Cross-Module Actions"}</p>
                </TooltipContent>
              </Tooltip>
            )}
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

        {thumbnailStripOpen && sheets.length > 1 && (
          <div className="bg-card border-b shrink-0" data-testid="panel-thumbnail-strip">
            <PageThumbnailStrip
              sheets={sheets}
              selectedSheet={selectedSheet}
              onSelectSheet={setSelectedSheet}
              layout="horizontal"
            />
          </div>
        )}

        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative"
          style={{
            cursor: createLinkMode?.step === "select-area" ? "crosshair" :
                   activeTool === "pan" ? "grab" :
                   activeTool === "select" ? "default" :
                   "crosshair"
          }}
          onContextMenu={(e) => {
            if (!selectedSheet) return;
            e.preventDefault();
            const stage = stageRef.current;
            if (stage) {
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                const stageX = (e.clientX - rect.left - stagePosition.x) / stageScale;
                const stageY = (e.clientY - rect.top - stagePosition.y) / stageScale;
                setContextMenuPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, canvasX: stageX, canvasY: stageY });
              }
            }
          }}
          onClick={() => { if (contextMenuPos) setContextMenuPos(null); if (measurementContextMenu) setMeasurementContextMenu(null); }}
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
              onMouseDown={(e) => {
                if (createLinkMode?.step === "select-area") {
                  const stage = e.target.getStage();
                  const pos = stage?.getPointerPosition();
                  if (pos) {
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
                  if (pos) {
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
              onTouchStart={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseDown(e); } else { handleStageMouseDown(e); } }}
              onTouchEnd={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseUp(); } else { handleTouchEnd(e); } }}
              onTouchMove={(e) => { if (isMarkupTool(activeTool)) { handleMarkupMouseMove(); } else { handleTouchMove(e); } }}
              onDblClick={(e) => {
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
                  x={sheetRotation === 180 ? (pdfImage?.width || 0) : sheetRotation === 270 ? (pdfImage?.height || 0) : 0}
                  y={sheetRotation === 90 ? (pdfImage?.width || 0) : sheetRotation === 180 ? (pdfImage?.height || 0) : 0}
                >
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

                {showAiOverlays && pdfImage && preImportDetectedItems.filter(item => item.boundingBox).map((item) => {
                  const imgW = pdfImage.width;
                  const imgH = pdfImage.height;
                  const bbox = item.boundingBox!;
                  const rx = (bbox.x / 100) * imgW;
                  const ry = (bbox.y / 100) * imgH;
                  const rw = (bbox.w / 100) * imgW;
                  const rh = (bbox.h / 100) * imgH;
                  const conf = item.confidence || 0;
                  const fillColor = conf >= 85 ? "rgba(139,92,246,0.06)" : conf >= 70 ? "rgba(139,92,246,0.04)" : "rgba(139,92,246,0.03)";
                  const strokeColor = conf >= 85 ? "#8b5cf6" : conf >= 70 ? "#a78bfa" : "#c4b5fd";
                  const isHighlighted = highlightedAiItem?.id === item.id;
                  return (
                    <Fragment key={`ai-pre-${item.id}`}>
                      <Rect
                        x={rx}
                        y={ry}
                        width={rw}
                        height={rh}
                        fill={isHighlighted ? "rgba(139,92,246,0.18)" : fillColor}
                        stroke={isHighlighted ? "#7c3aed" : strokeColor}
                        strokeWidth={isHighlighted ? 2.5 : 1}
                        dash={[4, 4]}
                        cornerRadius={2}
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
                        y={ry - 13}
                        text={`${item.description} (${conf}%) · ${item.quantity} ${item.unit}`}
                        fontSize={9}
                        fill={isHighlighted ? "#7c3aed" : strokeColor}
                        listening={false}
                      />
                      {isHighlighted && (
                        <Text
                          x={rx + 4}
                          y={ry + 4}
                          text={`${item.description}\n${item.quantity} ${item.unit} · ${conf}% confidence${item.suggestedSowItem ? `\nSOW: ${item.suggestedSowItem.code}` : ""}`}
                          fontSize={11}
                          fill="#fff"
                          padding={6}
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
                    const imgW = pdfImage.width;
                    const imgH = pdfImage.height;
                    const rx = (bbox.x / 100) * imgW;
                    const ry = (bbox.y / 100) * imgH;
                    const rw = (bbox.w / 100) * imgW;
                    const rh = (bbox.h / 100) * imgH;
                    const conf = meta?.confidence || 0;
                    const fillColor = conf >= 85 ? "rgba(34,197,94,0.08)" : conf >= 70 ? "rgba(234,179,8,0.08)" : "rgba(249,115,22,0.08)";
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
                          fill={isHighlighted ? "rgba(139,92,246,0.15)" : fillColor}
                          stroke={isHighlighted ? "#8b5cf6" : strokeColor}
                          strokeWidth={isHighlighted ? 2.5 : 1.5}
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
                          y={ry - 14}
                          text={`${m.label || "AI"} · ${m.count || 1} ${meta?.unit || "EA"} (${conf}%)`}
                          fontSize={10}
                          fill={isHighlighted ? "#8b5cf6" : strokeColor}
                          listening={false}
                        />
                        {selectedMeasurementId === m.id && (
                          <Text
                            x={rx + 4}
                            y={ry + 4}
                            text={`${m.label || "AI Item"}\nQty: ${m.count || 1} ${meta?.unit || "EA"}\nConfidence: ${conf}%`}
                            fontSize={11}
                            fill="#fff"
                            padding={6}
                            listening={false}
                          />
                        )}
                      </Fragment>
                    );
                  } catch { return null; }
                })}

                {gridEnabled && currentSheet?.scalePxPerFoot && pdfImage && (() => {
                  const imgW = pdfImage.width;
                  const imgH = pdfImage.height;
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
                      const pos = computeAiPosition(aiIdx, pdfImage?.width || 2000);
                      points = [pos];
                    }
                  }
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
                            <Line points={offsetLinePoints(flatPoints, 2)} stroke={baseColor} strokeWidth={effectiveWidth} opacity={isSelected ? 1 : 0.8} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                            <Line points={offsetLinePoints(flatPoints, -2)} stroke={baseColor} strokeWidth={effectiveWidth} opacity={isSelected ? 1 : 0.8} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                          </Fragment>
                        ) : (
                          <Line
                            key={m.id}
                            points={flatPoints}
                            stroke={baseColor}
                            strokeWidth={effectiveWidth}
                            dash={dashArray.length > 0 ? dashArray : undefined}
                            opacity={isSelected ? 1 : 0.8}
                            onClick={handleMeasurementClick}
                            onTap={handleMeasurementClick}
                          />
                        );
                      }
                    }
                    return mLineStyle === "double" ? (
                      <Fragment key={m.id}>
                        <Line points={offsetLinePoints([points[0].x, points[0].y, points[1].x, points[1].y], 2)} stroke={baseColor} strokeWidth={effectiveWidth} hitStrokeWidth={isMobile ? 20 : 0} opacity={isSelected ? 1 : 0.8} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
                        <Line points={offsetLinePoints([points[0].x, points[0].y, points[1].x, points[1].y], -2)} stroke={baseColor} strokeWidth={effectiveWidth} hitStrokeWidth={isMobile ? 20 : 0} opacity={isSelected ? 1 : 0.8} onClick={handleMeasurementClick} onTap={handleMeasurementClick} />
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
                        strokeWidth={effectiveWidth}
                        dash={dashArray.length > 0 ? dashArray : undefined}
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
                        strokeWidth={effectiveWidth}
                        dash={dashArray.length > 0 ? dashArray : undefined}
                        hitStrokeWidth={isMobile ? 20 : 0}
                        fill={isSelected ? hexToRgba(baseColor, 0.3) : hexToRgba(baseColor, 0.15)}
                        opacity={isSelected ? 1 : 0.8}
                        closed={true}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "COUNT" && points.length >= 1) {
                    if (isAiMeasurement) {
                      const aiColor = "#8b5cf6";
                      let meta: any = {};
                      try { meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch {}
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
                            shadowColor="rgba(139,92,246,0.4)"
                            shadowBlur={isSelected ? 8 : 4}
                            shadowOffsetY={2}
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
                            shadowColor="rgba(0,0,0,0.2)"
                            shadowBlur={4}
                            shadowOffsetY={2}
                            opacity={isSelected ? 1 : 0.9}
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
                      } catch { return []; }
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

                {sheetLinks.map((link: any) => {
                  const targetSheet = sheets.find((s: any) => s.id === link.targetSheetId);
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

                {collab.visibleCursors.map((cursor) => (
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
                </Group>
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

          {createLinkMode && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-card border rounded-lg shadow-lg px-4 py-3 flex items-center gap-3" data-testid="create-link-panel">
              {createLinkMode.step === "select-area" && (
                <>
                  <Link2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">Draw rectangle on the area to create a link hotspot</span>
                  <Button variant="ghost" size="sm" onClick={() => setCreateLinkMode(null)} data-testid="button-cancel-create-link">
                    <X className="w-4 h-4" />
                  </Button>
                </>
              )}
              {createLinkMode.step === "select-target" && (
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">Select target sheet:</span>
                  <Select
                    value={createLinkTargetSheet || ""}
                    onValueChange={(val) => {
                      setCreateLinkTargetSheet(val);
                      if (val && selectedSheet && createLinkMode.startPoint && createLinkMode.endPoint) {
                        const x = Math.min(createLinkMode.startPoint.x, createLinkMode.endPoint.x);
                        const y = Math.min(createLinkMode.startPoint.y, createLinkMode.endPoint.y);
                        const width = Math.abs(createLinkMode.endPoint.x - createLinkMode.startPoint.x);
                        const height = Math.abs(createLinkMode.endPoint.y - createLinkMode.startPoint.y);
                        const targetSheet = sheets.find((s: any) => s.id === val);
                        createSheetLinkMutation.mutate({
                          sourceSheetId: selectedSheet,
                          targetSheetId: val,
                          x, y, width, height,
                          label: targetSheet?.sheetName || undefined,
                        }, {
                          onSuccess: () => {
                            queryClient.invalidateQueries({ queryKey: allSheetsLinksQueryKey });
                            setCreateLinkMode(null);
                            setCreateLinkTargetSheet(null);
                          },
                        });
                      }
                    }}
                  >
                    <SelectTrigger className="w-48" data-testid="select-link-target">
                      <SelectValue placeholder="Choose sheet..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sheets.filter((s: any) => s.id !== selectedSheet).map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.sheetName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => { setCreateLinkMode(null); setCreateLinkTargetSheet(null); }} data-testid="button-cancel-link-target">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

          {contextMenuPos && (
            <div
              className="absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-44"
              style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
              data-testid="canvas-context-menu"
            >
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                onClick={() => {
                  setCreateLinkMode({ step: "select-area" });
                  setContextMenuPos(null);
                }}
                data-testid="context-menu-create-link"
              >
                <Link2 className="w-3.5 h-3.5" /> Create Link to Sheet
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                onClick={() => {
                  if (selectedSheet) detectLinksMutation.mutate(selectedSheet);
                  setContextMenuPos(null);
                }}
                data-testid="context-menu-detect-links"
              >
                <Search className="w-3.5 h-3.5" /> Detect Links
              </button>
            </div>
          )}

          {measurementContextMenu && (() => {
            const ctxMeasurement = measurements.find(m => m.id === measurementContextMenu.measurementId);
            if (!ctxMeasurement) return null;
            return (
              <div
                className="absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-48"
                style={{ left: measurementContextMenu.x, top: measurementContextMenu.y }}
                data-testid="measurement-context-menu"
              >
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1 truncate max-w-56">
                  {ctxMeasurement.label || "Measurement"}
                </div>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    setSelectedMeasurementId(ctxMeasurement.id);
                    setMeasurementContextMenu(null);
                  }}
                  data-testid="context-menu-select-measurement"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit Details
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent flex items-center gap-2"
                  onClick={() => {
                    setSelectedMeasurementId(ctxMeasurement.id);
                    setPropertiesPanelOpen(true);
                    setMeasurementContextMenu(null);
                  }}
                  data-testid="context-menu-properties"
                >
                  <Tag className="w-3.5 h-3.5" /> Properties
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent text-destructive flex items-center gap-2"
                  onClick={() => {
                    deleteMeasurementMutation.mutate(ctxMeasurement);
                    setMeasurementContextMenu(null);
                  }}
                  data-testid="context-menu-delete-measurement"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            );
          })()}
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
            projectId={context?.type === "project" ? context.projectId : projectId || undefined}
            bidId={context?.type === "bid" ? context.bidId : undefined}
            sheetId={selectedSheet}
            onClose={() => { setAiPanelOpen(false); setPreImportDetectedItems([]); }}
            onHighlightItem={(item) => setHighlightedAiItem(item)}
            onDetectedItemsChanged={(items) => setPreImportDetectedItems(items)}
            showOverlays={showAiOverlays}
            onToggleOverlays={setShowAiOverlays}
            onItemsImported={async (items: DetectedItem[]) => {
              let succeeded = 0;
              let failed = 0;
              const failedItems: string[] = [];
              const imgW = pdfImage?.width || 2000;
              const existingAiCount = measurements.filter(m => m.source === "AI" && m.type === "COUNT").length;

              const isBidContext = context?.type === "bid";
              const ctxBidId = isBidContext ? context.bidId : undefined;

              const categoryCache: Record<string, string> = {};
              let existingCategories: { id: string; name: string }[] = [];
              if (ctxBidId) {
                try {
                  const catRes = await apiRequest("GET", `/api/bids/${ctxBidId}/takeoff/categories`);
                  existingCategories = await catRes.json();
                } catch (catFetchErr) {
                  console.warn("Failed to fetch takeoff categories:", catFetchErr);
                }
              }

              const getOrCreateCategory = async (itemType: string): Promise<string | undefined> => {
                if (!ctxBidId) return undefined;
                const categoryName = itemType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                if (categoryCache[categoryName]) return categoryCache[categoryName];
                const existing = existingCategories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
                if (existing) {
                  categoryCache[categoryName] = existing.id;
                  return existing.id;
                }
                try {
                  const res = await apiRequest("POST", `/api/bids/${ctxBidId}/takeoff/categories`, { name: categoryName });
                  const created = await res.json();
                  if (created?.id) {
                    categoryCache[categoryName] = created.id;
                    existingCategories.push({ id: created.id, name: categoryName });
                    return created.id;
                  }
                } catch (catCreateErr) {
                  console.warn(`Failed to create category '${categoryName}':`, catCreateErr);
                }
                return undefined;
              };

              const newMeasurementIds: string[] = [];
              const imgH = pdfImage?.height || 1500;

              const LINEAR_UNITS = new Set(["lf", "lm", "ft", "m", "in", "linear feet", "linear meters"]);
              const AREA_UNITS = new Set(["sf", "sm", "sq ft", "sq m", "sqft", "sqm", "square feet", "square meters"]);
              const LINEAR_TYPES = new Set(["wire_run", "ridge", "drip_edge", "pipe_run", "conduit", "framing", "rebar"]);
              const AREA_TYPES = new Set(["roof_plane", "slab", "floor", "ceiling", "wall", "formwork"]);

              const deriveMeasurementType = (item: DetectedItem): string => {
                const unitLower = (item.unit || "").toLowerCase();
                if (LINEAR_UNITS.has(unitLower) || LINEAR_TYPES.has(item.itemType)) return "LINEAR";
                if (AREA_UNITS.has(unitLower) || AREA_TYPES.has(item.itemType)) return "AREA";
                return "COUNT";
              };

              let fallbackCounter = 0;
              const derivePoints = (item: DetectedItem, measType: string, imgW: number, imgH: number): Array<{ x: number; y: number }> => {
                if (!item.boundingBox) {
                  return [computeAiPosition(existingAiCount + fallbackCounter++, imgW)];
                }
                const bbox = item.boundingBox;
                const x1 = (bbox.x / 100) * imgW;
                const y1 = (bbox.y / 100) * imgH;
                const x2 = x1 + (bbox.w / 100) * imgW;
                const y2 = y1 + (bbox.h / 100) * imgH;

                if (measType === "AREA") {
                  return [
                    { x: x1, y: y1 },
                    { x: x2, y: y1 },
                    { x: x2, y: y2 },
                    { x: x1, y: y2 },
                  ];
                }
                if (measType === "LINEAR") {
                  const isWide = (x2 - x1) >= (y2 - y1);
                  if (isWide) {
                    const midY = (y1 + y2) / 2;
                    return [{ x: x1, y: midY }, { x: x2, y: midY }];
                  }
                  const midX = (x1 + x2) / 2;
                  return [{ x: midX, y: y1 }, { x: midX, y: y2 }];
                }
                return [{ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }];
              };

              for (let idx = 0; idx < items.length; idx++) {
                const item = items[idx];
                const measType = deriveMeasurementType(item);
                const points = derivePoints(item, measType, imgW, imgH);

                try {
                  const categoryId = item.itemType ? await getOrCreateCategory(item.itemType) : undefined;
                  const res = await apiRequest("POST", "/api/takeoff/measurements", {
                    sheetId: selectedSheet,
                    type: measType,
                    points,
                    label: item.description,
                    count: measType === "COUNT" ? item.quantity : undefined,
                    source: "AI",
                    categoryId: categoryId || undefined,
                    costCodeId: item.suggestedSowItem?.code || undefined,
                    metadata: JSON.stringify({
                      source: "ai_takeoff",
                      aiItemId: item.id,
                      unit: item.unit,
                      itemType: item.itemType,
                      confidence: item.confidence,
                      boundingBox: item.boundingBox || null,
                      suggestedSowItem: item.suggestedSowItem || null,
                      costCodeId: item.suggestedSowItem?.code || null,
                      derivedMeasurementType: measType,
                    }),
                  });
                  const created = await res.json();
                  if (created?.id) newMeasurementIds.push(created.id);
                  succeeded++;
                } catch (err) {
                  console.error(`Failed to import AI item: ${item.description}`, err);
                  failed++;
                  failedItems.push(item.description);
                }
              }
              if (succeeded > 0) {
                await queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
                if (ctxBidId) {
                  await queryClient.invalidateQueries({ queryKey: ["/api/bids", ctxBidId, "takeoff", "categories"] });
                }
                if (newMeasurementIds.length > 0) {
                  const flashSequence = async () => {
                    for (const mId of newMeasurementIds) {
                      setFlashMeasurementId(mId);
                      setFlashPulse(1);
                      await new Promise(resolve => setTimeout(resolve, 600));
                    }
                  };
                  flashSequence();
                }
              }
              return { succeeded, failed, failedItems };
            }}
          />
        </div>
      )}

      {propertiesPanelOpen && selectedMeasurementId && (() => {
        const selectedMeasurement = measurements.find(m => m.id === selectedMeasurementId);
        return selectedMeasurement ? (
          <TakeoffPropertiesPanel
            measurement={selectedMeasurement}
            selectedSheet={selectedSheet}
            onClose={() => setPropertiesPanelOpen(false)}
          />
        ) : null;
      })()}

      <TakeoffVersionHistory
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        sheetId={selectedSheet}
        projectId={context?.type === "project" ? context.projectId : projectId || undefined}
        bidId={context?.type === "bid" ? context.bidId : undefined}
        onVersionSwitch={(versionId) => {
          setSelectedVersionId(versionId);
          setVersionHistoryOpen(false);
        }}
      />

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
        selectedSegmentIndex={selectedSegmentIndex}
        setSelectedSegmentIndex={setSelectedSegmentIndex}
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
        measurementGroups={measurementGroups}
        createGroupMutation={createGroupMutation}
        updateGroupMutation={updateGroupMutation}
        deleteGroupMutation={deleteGroupMutation}
        toggleGroupVisibilityMutation={toggleGroupVisibilityMutation}
        issues={issues}
        allSheetIssues={allIssues}
        selectedIssueId={selectedIssueId}
        onSelectIssue={(issue) => {
          setSelectedIssueId(issue.id);
          if (issue.sheetId && issue.sheetId !== selectedSheet) {
            setSelectedSheet(issue.sheetId);
          }
        }}
        onExportCurrentSheet={handleExportCurrentSheet}
        onExportAllSheets={handleExportAllSheets}
        onZoomToMeasurement={handleZoomToMeasurement}
        onZoomToFitMeasurement={handleZoomToFitMeasurement}
        hideAiMeasurements={hideAiMeasurements}
        setHideAiMeasurements={setHideAiMeasurements}
        measurementLinks={measurementLinks}
      />

      {crossModulePanelOpen && context?.type !== "bid" && (
        <div className="w-[340px] shrink-0 overflow-y-auto border-l bg-background">
          <TakeoffCrossModulePanel
            projectId={projectId}
            selectedSheet={selectedSheet}
            measurements={measurements}
            categories={categories}
            onClose={() => setCrossModulePanelOpen(false)}
          />
        </div>
      )}

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
        categoryLineStyle={categoryLineStyle}
        setCategoryLineStyle={setCategoryLineStyle}
        categoryLineWidth={categoryLineWidth}
        setCategoryLineWidth={setCategoryLineWidth}
        categoryWasteFactor={categoryWasteFactor}
        setCategoryWasteFactor={setCategoryWasteFactor}
        categoryUnitCost={categoryUnitCost}
        setCategoryUnitCost={setCategoryUnitCost}
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
