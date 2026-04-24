import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Rect, Group } from "react-konva";
import { MarkupShapeView, type MarkupShape } from "@/components/markups/MarkupRenderer";
import {
  MARKUP_TOOLBAR_DEFAULT_COLOR,
  MARKUP_TOOLBAR_DEFAULT_THICKNESS,
  MARKUP_TOOLBAR_THICKNESSES,
} from "@/components/markups/PlanMarkupToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Link2, ArrowLeft, Search, X, Tag, History, PanelRight, ArrowRight,
  ChevronLeft, ChevronRight, Pin, PinOff, ArrowUpCircle
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import * as pdfjsLib from 'pdfjs-dist';
import {
  createArcSegment,
  sampleArcPoints,
  computeNetAreaInFt2,
} from "@shared/utils/geometry";
import { type Tool, validateHexColor, hexToRgba, TOOL_CONFIG } from "./takeoff/types";
import { detectScaleFromText, type DetectedScale } from "@/lib/scaleDetection";
import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffInteractions } from "@/hooks/use-takeoff-interactions";
import type { TakeoffCondition } from "@shared/schema";
import { computeAssemblyResults, type FormulaContext } from "@shared/utils/assemblyFormula";
import { commitMarkupBodyDrag, commitMarkupResize } from "./markups/markup-drag-commit";
import { TakeoffToolbar } from "./takeoff/TakeoffToolbar";
import { TakeoffSidebar } from "./takeoff/TakeoffSidebar";
import { MeasurementTable } from "./takeoff/MeasurementTable";
import TakeoffCrossModulePanel from "./takeoff/TakeoffCrossModulePanel";
import { PageThumbnailStrip } from "./takeoff/PageThumbnailStrip";
import { TakeoffDialogs } from "./takeoff/TakeoffDialogs";
import { PlanScaleModal } from "./takeoff/PlanScaleModal";
import { TakeoffSheetCompareDialog } from "./takeoff/TakeoffSheetCompareDialog";
import { TakeoffPropertiesPanel } from "./takeoff/TakeoffPropertiesPanel";
import { TakeoffVersionHistory } from "./takeoff/TakeoffVersionHistory";
import { MarkupTextInput } from "./markups/MarkupTextInput";
import { IssueDetailPanel } from "./takeoff/IssueDetailPanel";
import { LiveCostPanel } from "./takeoff/LiveCostPanel";
import AiTakeoffPanel, { type DetectedItem } from "@/components/AiTakeoffPanel";

const AI_ZONE = { MARGIN_X: 80, START_Y: 40, SPACING_X: 220, SPACING_Y: 60, COLS: 3 };
function computeAiPosition(aiIdx: number, imageWidth: number) {
  const col = aiIdx % AI_ZONE.COLS;
  const row = Math.floor(aiIdx / AI_ZONE.COLS);
  return { x: imageWidth + AI_ZONE.MARGIN_X + col * AI_ZONE.SPACING_X, y: AI_ZONE.START_Y + row * AI_ZONE.SPACING_Y };
}
import { cn } from "@/lib/utils";
import { onLibraryEvent } from "@/lib/libraryEvents";
import { generateTakeoffExcel, generateQuantityDeltaReport, generateBidPackageExport } from "@/utils/takeoff-export";
import type { LibraryEvent } from "@/lib/libraryEvents";
import { useTakeoffCollaboration } from "@/hooks/use-takeoff-collaboration";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { detectScaleBatch } from "@/lib/scaleDetection";
import { Users, Lock, Sparkles, DollarSign, Layers, Zap, TableProperties, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type TakeoffContext =
  | { type: "project"; projectId: string; projectCode: string }
  | { type: "bid"; bidId: string; bidCode: string };

interface TakeoffWorkspaceProps {
  projectId?: string;
  projectCode?: string;
  context?: TakeoffContext;
  selectedSheetId?: string | null;
  onSelectSheet?: (sheetId: string | null) => void;
  /** Task #1696 — Forwarded to `<TakeoffToolbar>` so the embedded
   *  `<PlanMarkupToolbar>` markup popover renders icon+label instead
   *  of icon-only when the user has the "Labeled toolbar" preference
   *  on. Wired from the bid Plans tab; project Plans tab opts out
   *  (default false) for now to preserve existing behavior. */
  labeled?: boolean;
}

export default function TakeoffWorkspace({ projectId = "", projectCode = "", context, selectedSheetId: controlledSheetId, onSelectSheet, labeled = false }: TakeoffWorkspaceProps) {
  const isMobile = useIsMobile();
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [currentDrawingTool, setCurrentDrawingTool] = useState<Tool | null>(null);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);
  const sheetStorageKey = context
    ? `takeoff-sheet-${context.type === "bid" ? context.bidId : context.projectId}`
    : projectId
      ? `takeoff-sheet-${projectId}`
      : null;
  const prevStorageKeyRef = useRef<string | null>(sheetStorageKey);
  const isControlled = controlledSheetId !== undefined;
  const [internalSelectedSheet, setInternalSelectedSheet] = useState<string | null>(() => {
    if (isControlled) return controlledSheetId ?? null;
    if (sheetStorageKey) {
      try {
        return sessionStorage.getItem(sheetStorageKey);
      } catch (err) {
        console.warn("[Takeoff] Failed to read sheet from sessionStorage:", err);
      }
    }
    return null;
  });
  const selectedSheet = isControlled ? (controlledSheetId ?? null) : internalSelectedSheet;
  const setSelectedSheet = useCallback((val: string | null) => {
    if (!isControlled) {
      setInternalSelectedSheet(val);
    }
    onSelectSheet?.(val);
  }, [isControlled, onSelectSheet]);
  useEffect(() => {
    if (isControlled) return;
    if (prevStorageKeyRef.current !== sheetStorageKey) {
      prevStorageKeyRef.current = sheetStorageKey;
      if (sheetStorageKey) {
        try {
          const stored = sessionStorage.getItem(sheetStorageKey);
          setInternalSelectedSheet(stored);
        } catch (err) {
          console.warn("[Takeoff] Failed to read sheet from sessionStorage:", err);
          setInternalSelectedSheet(null);
        }
      } else {
        setInternalSelectedSheet(null);
      }
    }
  }, [sheetStorageKey, isControlled]);
  useEffect(() => {
    if (isControlled) return;
    if (sheetStorageKey) {
      try {
        if (internalSelectedSheet) {
          sessionStorage.setItem(sheetStorageKey, internalSelectedSheet);
        } else {
          sessionStorage.removeItem(sheetStorageKey);
        }
      } catch (err) {
        console.warn("[Takeoff] Failed to persist selected sheet:", err);
      }
    }
  }, [internalSelectedSheet, sheetStorageKey, isControlled]);
  const openSheetsStorageKey = sheetStorageKey ? `${sheetStorageKey}-open-tabs` : null;
  const [openSheetIds, setOpenSheetIds] = useState<string[]>(() => {
    if (!openSheetsStorageKey) return [];
    try {
      const raw = sessionStorage.getItem(openSheetsStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
      }
    } catch (err) {
      console.warn("[Takeoff] Failed to read open sheet tabs:", err);
    }
    return [];
  });
  useEffect(() => {
    if (!openSheetsStorageKey) return;
    try {
      sessionStorage.setItem(openSheetsStorageKey, JSON.stringify(openSheetIds));
    } catch (err) {
      console.warn("[Takeoff] Failed to persist open sheet tabs:", err);
    }
  }, [openSheetIds, openSheetsStorageKey]);
  useEffect(() => {
    if (selectedSheet && !openSheetIds.includes(selectedSheet)) {
      setOpenSheetIds((prev) => (prev.includes(selectedSheet) ? prev : [...prev, selectedSheet]));
    }
  }, [selectedSheet, openSheetIds]);
  const handleCloseSheetTab = useCallback((sheetId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setOpenSheetIds((prev) => {
      const next = prev.filter((id) => id !== sheetId);
      if (selectedSheet === sheetId) {
        const idx = prev.indexOf(sheetId);
        const fallback = next[idx] || next[idx - 1] || next[0] || null;
        setSelectedSheet(fallback);
      }
      return next;
    });
  }, [selectedSheet, setSelectedSheet]);
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
  const autoImportStorageKey = sheetStorageKey ? `${sheetStorageKey}-auto-import` : null;
  const prevAutoImportKeyRef = useRef<string | null>(autoImportStorageKey);
  const [autoImportEnabled, setAutoImportEnabled] = useState<boolean>(() => {
    if (autoImportStorageKey) {
      try { return sessionStorage.getItem(autoImportStorageKey) === "true"; } catch (err) { console.warn("[Takeoff] Failed to read auto-import setting:", err); }
    }
    return false;
  });
  useEffect(() => {
    if (prevAutoImportKeyRef.current !== autoImportStorageKey) {
      prevAutoImportKeyRef.current = autoImportStorageKey;
      if (autoImportStorageKey) {
        try { setAutoImportEnabled(sessionStorage.getItem(autoImportStorageKey) === "true"); } catch (err) { console.warn("[Takeoff] Failed to read auto-import setting:", err); setAutoImportEnabled(false); }
      } else {
        setAutoImportEnabled(false);
      }
    }
  }, [autoImportStorageKey]);
  useEffect(() => {
    if (autoImportStorageKey) {
      try { sessionStorage.setItem(autoImportStorageKey, String(autoImportEnabled)); } catch (err) { console.warn("[Takeoff] Failed to persist auto-import setting:", err); }
    }
  }, [autoImportEnabled, autoImportStorageKey]);
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("takeoff-sidebar-collapsed") === "true"; } catch { return false; }
  });
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem("takeoff-sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  };
  const [hideAiMeasurements, setHideAiMeasurements] = useState(() => {
    try { return localStorage.getItem("takeoff-hide-ai-measurements") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("takeoff-hide-ai-measurements", String(hideAiMeasurements)); } catch {} }, [hideAiMeasurements]);
  const [showAiOverlays, setShowAiOverlays] = useState(() => {
    try { return localStorage.getItem("takeoff-show-ai-overlays") !== "false"; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem("takeoff-show-ai-overlays", String(showAiOverlays)); } catch {} }, [showAiOverlays]);
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
  // Task #1631 — defaults match the project-side toolbar so a fresh
  // markup looks the same on either surface.
  const [markupColor, setMarkupColor] = useState(MARKUP_TOOLBAR_DEFAULT_COLOR);
  const [markupThickness, setMarkupThickness] = useState(MARKUP_TOOLBAR_DEFAULT_THICKNESS);
  const [markupDrawing, setMarkupDrawing] = useState(false);
  const [markupDrawPoints, setMarkupDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [markupTextInput, setMarkupTextInput] = useState<{ x: number; y: number; value: string } | null>(null);
  // Task #1736 — multi-select for takeoff markups. Plain click replaces
  // the set with one id; Shift+click toggles a markup in/out of the
  // set. The edit panel and resize handles only show when exactly one
  // markup is selected; the selection halo + body-drag work for every
  // member of the set so users can reposition entire callouts (an
  // arrow + a label + a cloud) in a single gesture.
  const [selectedMarkupIds, setSelectedMarkupIds] = useState<Set<string>>(new Set());
  const selectedMarkupId = selectedMarkupIds.size === 1
    ? (selectedMarkupIds.values().next().value as string)
    : null;
  const [markupEditDraft, setMarkupEditDraft] = useState<{ color: string; thickness: number; text: string } | null>(null);
  // Task #1758 — Initial values captured when the styling popover opens
  // so a multi-selection bulk save can tell which fields the user
  // actually touched. Without this, the bulk save would either over-
  // apply unchanged fields across N markups or silently drop edits
  // when the per-markup current value happened to equal the draft.
  // For single-selection this stays semantically equivalent to the
  // pre-#1758 `draft !== editing.color` check.
  //
  // Task #1751 (rebase) — Task #1758 in main implemented multi-select
  // bulk color/thickness edits by extending this same `panel-markup-
  // properties` panel to render whenever `selectedMarkupIds.size >= 1`,
  // which fully covers the original Task #1751 ask. The standalone
  // `panel-markup-bulk-edit` from #1751 was therefore dropped during
  // rebase to avoid two competing edit panels rendering on a multi
  // selection.
  const [markupEditInitial, setMarkupEditInitial] = useState<{ color: string; thickness: number; text: string } | null>(null);
  // Task #1654 — Snap a markup's persisted thickness to the nearest
  // toolbar preset when opening the edit panel. Older markups created
  // before the toolbar/edit panel were aligned may have non-preset
  // thickness values (e.g. 6 px from the legacy 1–20 slider); without
  // this, none of the preset buttons would appear active.
  const snapToPresetThickness = useCallback((value: number) => {
    return MARKUP_TOOLBAR_THICKNESSES.reduce((best, preset) =>
      Math.abs(preset - value) < Math.abs(best - value) ? preset : best,
    );
  }, []);
  // Task #1718 — body drag is intentionally NOT React state. The
  // previous implementation called `setMarkupBodyDragId(id)` on
  // dragStart and `setMarkupBodyDragId(null)` on dragEnd, which
  // re-rendered every markup on the sheet at both ends of the gesture.
  // On takeoff sheets with many overlapping markups that re-render
  // dropped frames the same way the plan-side group drag did before
  // Task #1706. We now mirror the plan-side imperative pattern:
  // capture origin coords + the markup's resize handles in a ref on
  // dragStart, hide the handles via `node.visible(false)` so they
  // don't lag behind the moving body, and restore + commit a single
  // PATCH on dragEnd. Konva translates the dragged Group internally,
  // so no per-frame work runs in React for the duration of the drag.
  // Task #1736 — `siblings` carries the other selected markups' Konva
  // group nodes when a multi-select drag begins. They are translated
  // imperatively in onDragMove (no React state, no re-render) and
  // restored to their original position in onDragEnd before the bulk
  // PATCH lands. This mirrors the plan-side `getGroupProps` pattern.
  const markupBodyDragRef = useRef<{
    id: string;
    origX: number;
    origY: number;
    hiddenHandles: Array<{ visible: boolean; listening: boolean; node: any }>;
    siblings: Array<{ id: string; node: any }>;
  } | null>(null);
  const [markupResizePreview, setMarkupResizePreview] = useState<{ id: string; points: { x: number; y: number }[] } | null>(null);
  const markupResizeRef = useRef<{
    id: string;
    origPts: { x: number; y: number }[];
    origBB: { x: number; y: number; w: number; h: number };
    corner: string;
    tool: string;
  } | null>(null);
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
    try { return localStorage.getItem("takeoff-grid-enabled") === "true"; } catch (err) { console.warn("[Takeoff] Failed to read grid setting:", err); return false; }
  });
  const [crossModulePanelOpen, setCrossModulePanelOpen] = useState(false);
  const [showMeasurementLabels, setShowMeasurementLabels] = useState(() => {
    try { return localStorage.getItem("takeoff-show-labels") !== "false"; } catch (err) { console.warn("[Takeoff] Failed to read label visibility setting:", err); return true; }
  });
  const [typicals, setTypicals] = useState<Array<{ id: string; name: string; measurementIds: string[]; sheetId: string; geometry?: Array<{ type: string; points: Array<{ x: number; y: number }>; label?: string; categoryId?: string | null; computedAreaFt2?: number | null; computedLengthFt?: number | null; computedVolumeCy?: number | null; count?: number | null; metadata?: string | Record<string, unknown> | null }> }>>(() => {
    try { return JSON.parse(localStorage.getItem("takeoff-typicals") || "[]"); } catch (err) { console.warn("[Takeoff] Failed to read typicals:", err); return []; }
  });
  const [typicalPlacementCount, setTypicalPlacementCount] = useState(0);
  const [structuralGridlines, setStructuralGridlines] = useState<{
    horizontal: Array<{ label: string; position: number }>;
    vertical: Array<{ label: string; position: number }>;
  }>(() => {
    try { return JSON.parse(localStorage.getItem("takeoff-gridlines") || '{"horizontal":[],"vertical":[]}'); } catch (err) { console.warn("[Takeoff] Failed to read gridlines:", err); return { horizontal: [], vertical: [] }; }
  });
  const [showStructuralGridlines, setShowStructuralGridlines] = useState(() => {
    try { return localStorage.getItem("takeoff-show-structural-gridlines") === "true"; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem("takeoff-show-structural-gridlines", String(showStructuralGridlines)); } catch {} }, [showStructuralGridlines]);
  const [labelHiddenCategories, setLabelHiddenCategories] = useState<Set<string>>(() => {
    try { const stored = localStorage.getItem("takeoff-label-hidden-categories"); return stored ? new Set(JSON.parse(stored)) : new Set(); } catch (err) { console.warn("[Takeoff] Failed to read label hidden categories:", err); return new Set(); }
  });
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [showMeasurementTable, setShowMeasurementTable] = useState(false);
  const [showMobileGestureGuide, setShowMobileGestureGuide] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("takeoff-gesture-guide-dismissed");
  });
  const [showMobileToolPicker, setShowMobileToolPicker] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [showOverlaySlider, setShowOverlaySlider] = useState(false);
  const [activeCondition, setActiveCondition] = useState<TakeoffCondition | null>(null);
  const [bidPackageDialogOpen, setBidPackageDialogOpen] = useState(false);
  const [bidPackageTradeScope, setBidPackageTradeScope] = useState("");
  const { isOffline, queueLength } = useOfflineQueue();

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
    autoImportEnabled,
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
    createMarkupMutation, updateMarkupMutation, bulkUpdateMarkupsMutation, deleteMarkupMutation,
    createSheetLinkMutation, deleteSheetLinkMutation, detectLinksMutation,
    saveCategoryMutation, deleteCategoryMutation,
    renameSheetMutation, duplicateSheetMutation,
    deleteSheetMutation, handleMoveSheet,
    measurementGroups, createGroupMutation, updateGroupMutation,
    deleteGroupMutation, toggleGroupVisibilityMutation,
    conditions, createConditionMutation, updateConditionMutation, deleteConditionMutation,
    measurementCountsPerSheet,
    // Task #1768 — Set of markup ids whose most-recent move PATCH was
    // rejected by the server. Used below to render a temporary red
    // glow on each rejected markup so a 50-markup batch failure
    // points the user at exactly which siblings to fix.
    failedMarkupIds,
  } = data;

  useEffect(() => {
    if (!sheetsLoading && sheets.length > 0 && selectedSheet) {
      const exists = sheets.some((s: any) => s.id === selectedSheet);
      if (!exists) {
        setSelectedSheet(null);
      }
    }
  }, [sheetsLoading, sheets, selectedSheet]);

  // Task #1742 — Markup body moves now flow through the unified
  // `useTakeoffHistory` stack (see `onBodyDragEnd` below, which passes
  // a `previous: { points }` payload to `updateMarkupMutation` so its
  // onSuccess handler pushes a `MARKUP_UPDATE` history entry). The
  // sidebar Undo/Redo buttons and the bubble-phase Cmd/Ctrl+Z handler
  // in `use-takeoff-interactions` therefore handle markup drags just
  // like measurement edits — interleaved in correct order. The
  // single-step popover Undo + capture-phase keydown handler that
  // Task #1724 added have been removed in favor of this unified path.

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

  // Task #1661 — surface drawing-set membership state on the takeoff
  // canvas thumbnail strip. We resolve the project's active (or primary)
  // drawing set, fetch its pinned items + per-sheet status, and pass the
  // derived id sets into <PageThumbnailStrip /> so each thumbnail can
  // render the same Pinned / Newer indicators shown in the Plans tab.
  const drawingSetsEnabled = !!projectId && context?.type !== "bid";
  const { data: drawingSetsForCanvas = [] } = useQuery<Array<{ id: string; name: string; isPrimary: boolean }>>({
    queryKey: ["/api/projects", projectId, "drawing-sets"],
    enabled: drawingSetsEnabled,
    staleTime: 30000,
  });
  const activeCanvasSetId = useMemo(() => {
    const primary = drawingSetsForCanvas.find(s => s.isPrimary);
    return primary?.id ?? drawingSetsForCanvas[0]?.id ?? null;
  }, [drawingSetsForCanvas]);
  const activeCanvasSetName = useMemo(() => {
    if (!activeCanvasSetId) return null;
    return drawingSetsForCanvas.find(s => s.id === activeCanvasSetId)?.name ?? null;
  }, [activeCanvasSetId, drawingSetsForCanvas]);
  // Sheet-status payload contract matches PlansTab: the server returns
  // pinnedSheetIds + newerSheetIds + pinnedToLatestMap (see
  // server/drawingSetRoutes.ts GET /drawing-sets/:setId/sheet-status).
  const { data: activeSetStatus } = useQuery<{ pinnedSheetIds: string[]; newerSheetIds: string[]; pinnedToLatestMap?: Record<string, string | null> }>({
    queryKey: ["/api/projects", "drawing-sets", activeCanvasSetId, "sheet-status"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${activeCanvasSetId}/sheet-status`, { credentials: "include" });
      if (!res.ok) return { pinnedSheetIds: [], newerSheetIds: [] };
      return res.json();
    },
    enabled: !!activeCanvasSetId,
    staleTime: 30000,
  });
  const pinnedSheetIdsForStrip = useMemo(
    () => new Set<string>(activeSetStatus?.pinnedSheetIds ?? []),
    [activeSetStatus],
  );
  const newerSheetIdsForStrip = useMemo(
    () => new Set<string>(activeSetStatus?.newerSheetIds ?? []),
    [activeSetStatus],
  );

  // Task #1682 — Pin/unpin/swap controls on the canvas need the actual
  // drawing-set item ids (for DELETE) so we additionally fetch the
  // active set's items here. Mirrors PlansTab's `activeSetItems` query
  // and the resulting `activeSetItemMap`.
  const { user: authUser } = useAuth();
  const canManageDrawingSetsOnCanvas = ["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(authUser?.role || "");
  const { data: activeCanvasSetItems = [] } = useQuery<Array<{ id: string; drawingSetId: string; sheetId: string; revisionId: string | null; pinnedAt: string }>>({
    queryKey: ["/api/projects", "drawing-sets", activeCanvasSetId, "items"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/drawing-sets/${activeCanvasSetId}/items`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeCanvasSetId && canManageDrawingSetsOnCanvas,
    staleTime: 30000,
  });
  const activeCanvasSetItemMap = useMemo(() => {
    const map = new Map<string, { id: string; sheetId: string; revisionId: string | null }>();
    for (const item of activeCanvasSetItems) {
      map.set(item.sheetId, item);
    }
    return map;
  }, [activeCanvasSetItems]);
  const getLatestRevisionForCanvasSheet = useCallback((sheetId: string): string | null => {
    if (!activeCanvasSetId || !activeSetStatus) return null;
    const latest = activeSetStatus.pinnedToLatestMap?.[sheetId];
    if (!latest || latest === sheetId) return null;
    return latest;
  }, [activeCanvasSetId, activeSetStatus]);

  // Task #1682 — invalidate the same set of caches PlansTab does after
  // a pin/unpin/swap so the right-side Drawing Sets panel and Plans-tab
  // badges stay in sync with the canvas thumbnail strip.
  const invalidateDrawingSetCanvasCaches = useCallback((setId: string | null | undefined) => {
    if (!setId) return;
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "sheet-status"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", "drawing-sets", setId, "compare"] });
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drawing-sets"] });
    }
  }, [projectId]);

  // Task #1682 — three mutations mirror PlansTab's pinSheetToActiveSet /
  // unpinSheetFromActiveSet / swapPinnedRevision so the canvas controls
  // hit the same endpoints with the same semantics.
  const canvasPinSheetMutation = useMutation({
    mutationFn: async ({ setId, sheetId }: { setId: string; sheetId: string }) => {
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${setId}/items`, { sheetId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCanvasCaches(vars.setId);
      toast({ title: "Pinned to set" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "";
      toast({
        title: "Error",
        description: message.includes("409") ? "Sheet already pinned." : "Failed to pin sheet.",
        variant: "destructive",
      });
    },
  });
  const canvasUnpinSheetMutation = useMutation({
    mutationFn: async ({ setId, itemId }: { setId: string; itemId: string }) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${itemId}`);
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCanvasCaches(vars.setId);
      toast({ title: "Removed from set" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to unpin sheet.", variant: "destructive" });
    },
  });
  const canvasSwapPinnedRevisionMutation = useMutation({
    mutationFn: async ({ setId, oldItemId, newSheetId }: { setId: string; oldItemId: string; newSheetId: string }) => {
      await apiRequest("DELETE", `/api/projects/drawing-sets/${setId}/items/${oldItemId}`);
      const res = await apiRequest("POST", `/api/projects/drawing-sets/${setId}/items`, { sheetId: newSheetId });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateDrawingSetCanvasCaches(vars.setId);
      toast({ title: "Pinned to latest revision" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to swap pinned revision.", variant: "destructive" });
    },
  });
  const canvasPinMutationPending =
    canvasPinSheetMutation.isPending ||
    canvasUnpinSheetMutation.isPending ||
    canvasSwapPinnedRevisionMutation.isPending;

  // Task #1682 — callbacks fed to <PageThumbnailStrip /> overlay buttons.
  // We resolve setId / itemId / latest revision id at click time so the
  // strip itself stays presentation-only.
  const handleCanvasPinSheet = useCallback((sheetId: string) => {
    if (!activeCanvasSetId) return;
    canvasPinSheetMutation.mutate({ setId: activeCanvasSetId, sheetId });
  }, [activeCanvasSetId, canvasPinSheetMutation]);
  const handleCanvasUnpinSheet = useCallback((sheetId: string) => {
    if (!activeCanvasSetId) return;
    const item = activeCanvasSetItemMap.get(sheetId);
    if (!item) return;
    canvasUnpinSheetMutation.mutate({ setId: activeCanvasSetId, itemId: item.id });
  }, [activeCanvasSetId, activeCanvasSetItemMap, canvasUnpinSheetMutation]);
  const handleCanvasSwapRevision = useCallback((sheetId: string) => {
    if (!activeCanvasSetId) return;
    const item = activeCanvasSetItemMap.get(sheetId);
    const latestId = getLatestRevisionForCanvasSheet(sheetId);
    if (!item || !latestId) return;
    canvasSwapPinnedRevisionMutation.mutate({
      setId: activeCanvasSetId,
      oldItemId: item.id,
      newSheetId: latestId,
    });
  }, [activeCanvasSetId, activeCanvasSetItemMap, canvasSwapPinnedRevisionMutation, getLatestRevisionForCanvasSheet]);

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

  const moveIssueMutation = useMutation({
    mutationFn: async ({ issueId, sheetId, position }: { issueId: string; sheetId?: string; position?: { x: number; y: number } }) => {
      const body: Record<string, unknown> = {};
      if (sheetId) body.sheetId = sheetId;
      if (position) body.position = JSON.stringify(position);
      return apiRequest("PATCH", `/api/takeoff/issues/${issueId}`, body);
    },
    onSuccess: (_data, vars) => {
      if (issuesQueryKey) queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      queryClient.invalidateQueries({ queryKey: allSheetsIssuesQueryKey });
      if (vars.sheetId) {
        toast({ title: "Pin moved to another sheet" });
      }
    },
    onError: (e: Error) => {
      if (issuesQueryKey) queryClient.invalidateQueries({ queryKey: issuesQueryKey });
      queryClient.invalidateQueries({ queryKey: allSheetsIssuesQueryKey });
      toast({ title: "Could not move pin", description: e.message, variant: "destructive" });
    },
  });

  const issueDropTargetRef = useRef<HTMLElement | null>(null);
  const clearIssueDropTarget = useCallback(() => {
    if (issueDropTargetRef.current) {
      issueDropTargetRef.current.removeAttribute("data-pin-drop-active");
      issueDropTargetRef.current = null;
    }
  }, []);
  const updateIssueDropTarget = useCallback((clientX: number, clientY: number): HTMLElement | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const target = el && (el.closest('[data-pin-drop-target]') as HTMLElement | null);
    if (target !== issueDropTargetRef.current) {
      clearIssueDropTarget();
      if (target) {
        target.setAttribute("data-pin-drop-active", "true");
        issueDropTargetRef.current = target;
      }
    }
    return target;
  }, [clearIssueDropTarget]);
  const getEventClientPoint = (evt: MouseEvent | TouchEvent | PointerEvent): { x: number; y: number } | null => {
    if ("clientX" in evt && typeof evt.clientX === "number") {
      return { x: evt.clientX, y: evt.clientY };
    }
    const touch = (evt as TouchEvent).changedTouches?.[0] ?? (evt as TouchEvent).touches?.[0];
    if (touch) return { x: touch.clientX, y: touch.clientY };
    return null;
  };

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
    try { localStorage.setItem("takeoff-grid-enabled", v ? "true" : "false"); } catch (err) {
      console.warn("[Takeoff] Failed to persist grid setting:", err);
    }
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
    createMeasurementMutation: {
      ...createMeasurementMutation,
      mutate: (data: Record<string, unknown>) => {
        const enriched: Record<string, unknown> = { ...data };
        if (activeCondition) {
          if (activeCondition.unitCost && !enriched.unitCost) enriched.unitCost = activeCondition.unitCost;
          if (activeCondition.costCodeId && !enriched.costCodeId) enriched.costCodeId = activeCondition.costCodeId;
          if (activeCondition.color && !enriched.color) enriched.color = activeCondition.color;
          if (activeCondition.labelTemplate) {
            const label = String(enriched.label || "");
            const count = (label.match(/\d+/) || ["1"])[0];
            enriched.label = activeCondition.labelTemplate.replace("#{n}", count).replace("{n}", count);
          }

          const getMeta = (): Record<string, unknown> => {
            if (!enriched.metadata) return {};
            try { return typeof enriched.metadata === "string" ? JSON.parse(enriched.metadata as string) : enriched.metadata as Record<string, unknown>; } catch (err) { console.warn("[Takeoff] Failed to parse measurement metadata:", err); return {}; }
          };

          if (activeCondition.formula) {
            const meta = getMeta();
            meta.conditionFormula = activeCondition.formula;
            meta.conditionId = activeCondition.id;
            enriched.metadata = JSON.stringify(meta);
          }
          if (activeCondition.assemblyComponents) {
            const meta = getMeta();
            meta.assemblyComponents = activeCondition.assemblyComponents;
            try {
              const components = JSON.parse(activeCondition.assemblyComponents);
              if (Array.isArray(components)) {
                const ctx: FormulaContext = {
                  length: (enriched.computedLengthFt as number) || 0,
                  area: (enriched.computedAreaFt2 as number) || 0,
                  volume: (enriched.computedVolumeCy as number) || 0,
                  count: 1,
                  depth: (enriched.depthFeet as number) || 0,
                };
                meta.assemblyResults = computeAssemblyResults(components, ctx);
              }
            } catch (err) { console.warn("[Takeoff] Failed to compute assembly results:", err); }
            enriched.metadata = JSON.stringify(meta);
          }
        }
        createMeasurementMutation.mutate(enriched);
      },
    },
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
    structuralGridlines,
    showStructuralGridlines,
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
    runningMeasurement,
    selectedMeasurementIds,
    setSelectedMeasurementIds,
    toggleMeasurementSelection,
  } = interactions;

  useEffect(() => {
    if (activeTool !== "select" && selectedMarkupIds.size > 0) {
      setSelectedMarkupIds(new Set());
      setMarkupEditDraft(null);
      setMarkupEditInitial(null);
    }
  }, [activeTool, selectedMarkupIds]);

  useEffect(() => {
    setSelectedMarkupIds(new Set());
    setMarkupEditDraft(null);
    setMarkupEditInitial(null);
  }, [selectedSheet]);

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
    } catch (err) {
      console.warn("[Takeoff] Failed to save markup:", err);
    }
  };

  const handleMarkupTextSubmit = async (text: string) => {
    const trimmed = (text || "").trim();
    if (!markupTextInput || !selectedSheet || !trimmed) {
      setMarkupTextInput(null);
      return;
    }
    const pos = { x: markupTextInput.x, y: markupTextInput.y };
    setMarkupTextInput(null);
    try {
      await createMarkupMutation.mutateAsync({
        sheetId: selectedSheet,
        tool: "TEXT",
        points: [pos],
        color: markupColor,
        thickness: markupThickness,
        text: trimmed,
      });
    } catch (err) {
      console.warn("[Takeoff] Failed to save text markup:", err);
      toast({ title: "Error", description: "Failed to save text label", variant: "destructive" });
    }
  };

  useEffect(() => {
    Object.entries(addendaOverlays).forEach(([addendumId, overlay]) => {
      if (overlay.visible && !addendaImages[addendumId] && !overlay.imageUrl) {
        const imageUrl = `/api/addenda/${addendumId}/preview-url`;
        setAddendaOverlays(prev => ({ ...prev, [addendumId]: { ...prev[addendumId], imageUrl } }));
        const img = new window.Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          setAddendaImages(prev => ({ ...prev, [addendumId]: img }));
        };
        img.src = imageUrl;
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
    } catch (err) { console.warn("[Takeoff] Failed to parse measurement points:", err); return []; }
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
    const avgX = pts.reduce((sum: number, p: { x: number; y: number }) => sum + p.x, 0) / pts.length;
    const avgY = pts.reduce((sum: number, p: { x: number; y: number }) => sum + p.y, 0) / pts.length;
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
    } catch (err) {
      console.warn("[Takeoff] Export failed:", err);
      toast({ title: "Error", description: "Failed to fetch measurements for export", variant: "destructive" });
    }
  };

  const handleExportQuantityDelta = async () => {
    try {
      const isBid = context?.type === "bid";
      const ctxId = isBid ? context.bidId : projectId;
      const url = isBid
        ? `/api/bids/${ctxId}/takeoff/all-measurements`
        : `/api/projects/${ctxId}/takeoff/all-measurements`;
      const res = await apiRequest("GET", url);
      const allMeasurements = await res.json();

      const activeSheets = sheets.filter((s: any) => s.isActive !== false);
      const supersededSheets = sheets.filter((s: any) => s.isActive === false);

      if (supersededSheets.length === 0) {
        toast({ title: "No revisions found", description: "Quantity delta requires at least one superseded sheet revision", variant: "destructive" });
        return;
      }

      const supersededIds = new Set(supersededSheets.map((s: any) => s.id));
      const oldMeasurements = allMeasurements.filter((m: any) => supersededIds.has(m.sheetId));
      const newMeasurements = allMeasurements.filter((m: any) => !supersededIds.has(m.sheetId));

      generateQuantityDeltaReport({
        projectName: projectCode || "Takeoff",
        oldMeasurements,
        newMeasurements,
        sheets,
        categories,
        oldRevision: "Previous",
        newRevision: "Current",
      });
      toast({ title: "Export complete", description: "Quantity delta report exported" });
    } catch (err) {
      console.warn("[Takeoff] Quantity delta export failed:", err);
      toast({ title: "Error", description: "Failed to generate quantity delta report", variant: "destructive" });
    }
  };

  const handleExportBidPackage = async () => {
    setBidPackageDialogOpen(true);
  };

  const handleConfirmBidPackage = async () => {
    try {
      const isBid = context?.type === "bid";
      const ctxId = isBid ? context.bidId : projectId;
      const url = isBid
        ? `/api/bids/${ctxId}/takeoff/all-measurements`
        : `/api/projects/${ctxId}/takeoff/all-measurements`;
      const res = await apiRequest("GET", url);
      const allMeasurements = await res.json();

      if (!allMeasurements || allMeasurements.length === 0) {
        toast({ title: "No measurements", description: "There are no measurements to include in the bid package", variant: "destructive" });
        return;
      }

      generateBidPackageExport({
        projectName: projectCode || "Takeoff",
        measurements: allMeasurements,
        sheets,
        categories,
        tradeScope: bidPackageTradeScope || "General",
      });
      setBidPackageDialogOpen(false);
      setBidPackageTradeScope("");
      toast({ title: "Export complete", description: "Bid package exported" });
    } catch (err) {
      console.warn("[Takeoff] Bid package export failed:", err);
      toast({ title: "Error", description: "Failed to generate bid package export", variant: "destructive" });
    }
  };

  const handlePrintSheet = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      const dataUrl = stage.toDataURL({ pixelRatio: 2 });
      const sheetName = currentSheet?.sheetName || "Takeoff Sheet";
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        toast({ title: "Error", description: "Please allow popups to print", variant: "destructive" });
        return;
      }
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${sheetName} - Print</title>
            <style>
              @page { size: landscape; margin: 0.5in; }
              body { margin: 0; display: flex; flex-direction: column; align-items: center; font-family: system-ui, sans-serif; }
              .title-block { width: 100%; padding: 12px 0; border-bottom: 2px solid #333; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: baseline; }
              .title-block h1 { font-size: 16px; margin: 0; }
              .title-block .meta { font-size: 11px; color: #666; }
              img { max-width: 100%; max-height: calc(100vh - 100px); object-fit: contain; }
              .legend { width: 100%; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ccc; display: flex; flex-wrap: wrap; gap: 12px; font-size: 10px; }
              .legend-item { display: flex; align-items: center; gap: 4px; }
              .legend-swatch { width: 12px; height: 12px; border-radius: 2px; border: 1px solid #999; }
              @media print { .no-print { display: none; } }
            </style>
          </head>
          <body>
            <div class="title-block">
              <h1>${sheetName}</h1>
              <div class="meta">
                <span>${projectCode || ""}</span>
                &nbsp;|&nbsp;
                <span>${new Date().toLocaleDateString()}</span>
                &nbsp;|&nbsp;
                <span>${measurements.length} measurement${measurements.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <img src="${dataUrl}" alt="${sheetName}" />
            <div class="legend">
              ${categories
                .filter(c => measurements.some(m => m.categoryId === c.id))
                .map(c => `<div class="legend-item"><div class="legend-swatch" style="background:${c.color || '#3b82f6'}"></div><span>${c.name}</span></div>`)
                .join("")}
            </div>
            <script>window.onload=function(){window.print();}<\/script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } catch (err) {
      console.warn("[Takeoff] Print view generation failed:", err);
      toast({ title: "Error", description: "Failed to generate print view", variant: "destructive" });
    }
  }, [currentSheet, measurements, categories, projectCode, toast]);

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

  const pdfImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const pdfDocCacheRef = useRef<Map<string, any>>(new Map());
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const [pdfLoadProgress, setPdfLoadProgress] = useState(0);

  const renderPdfPage = useCallback(async (sheetId: string, pdfUrl: string, pageIndex: number): Promise<HTMLImageElement> => {
    const cacheKey = `${sheetId}-${pageIndex}`;
    const cached = pdfImageCacheRef.current.get(cacheKey);
    if (cached) {
      pdfImageCacheRef.current.delete(cacheKey);
      pdfImageCacheRef.current.set(cacheKey, cached);
      return cached;
    }

    let pdf = pdfDocCacheRef.current.get(pdfUrl);
    if (!pdf) {
      const loadingTask = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: true });
      pdf = await loadingTask.promise;
      pdfDocCacheRef.current.set(pdfUrl, pdf);
      if (pdfDocCacheRef.current.size > 20) {
        const firstKey = pdfDocCacheRef.current.keys().next().value;
        if (firstKey) pdfDocCacheRef.current.delete(firstKey);
      }
    }

    const page = await pdf.getPage(pageIndex + 1);
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvasContext: context, viewport }).promise;

    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => {
        pdfImageCacheRef.current.set(cacheKey, img);
        if (pdfImageCacheRef.current.size > 50) {
          const firstKey = pdfImageCacheRef.current.keys().next().value;
          if (firstKey) pdfImageCacheRef.current.delete(firstKey);
        }
        resolve(img);
      };
      img.onerror = reject;
      img.src = canvas.toDataURL();
    });
  }, []);

  useEffect(() => {
    if (!currentSheet?.imageUrl) {
      setPdfImage(null);
      return;
    }

    const loadPDF = async () => {
      try {
        setIsPdfLoading(true);
        setPdfLoadProgress(10);
        const pdfUrl = `/api/takeoff/sheets/${currentSheet.id}/pdf`;
        setPdfLoadProgress(30);

        const img = await renderPdfPage(currentSheet.id, pdfUrl, currentSheet.sheetIndex || 0);
        setPdfLoadProgress(80);
        setPdfImage(img);
        setPdfLoadProgress(100);
        setIsPdfLoading(false);

        if (!currentSheet.scalePxPerFoot) {
          try {
            const latestSheets = sheetsRef.current;
            const uncalibratedSheets = latestSheets.filter((s: any) => !s.scalePxPerFoot && s.imageUrl);
            const batchInput: Array<{ id: string; textItems: string[] }> = [];

            for (const s of uncalibratedSheets) {
              try {
                const sPdfUrl = `/api/takeoff/sheets/${s.id}/pdf`;
                let sPdf = pdfDocCacheRef.current.get(sPdfUrl);
                if (!sPdf) {
                  const loadTask = pdfjsLib.getDocument({ url: sPdfUrl, withCredentials: true });
                  sPdf = await loadTask.promise;
                  if (pdfDocCacheRef.current.size >= 20) {
                    const oldest = pdfDocCacheRef.current.keys().next().value;
                    if (oldest) pdfDocCacheRef.current.delete(oldest);
                  }
                  pdfDocCacheRef.current.set(sPdfUrl, sPdf);
                }
                const page = await sPdf.getPage((s.sheetIndex || 0) + 1);
                const textContent = await page.getTextContent();
                const textItems = textContent.items
                  .filter((item: any) => item.str && item.str.trim())
                  .map((item: any) => item.str as string);
                batchInput.push({ id: s.id, textItems });
              } catch (err) {
                console.warn(`[Takeoff] Failed to load sheet for scale detection:`, err);
              }
            }

            if (batchInput.length > 0) {
              const batchResults = detectScaleBatch(batchInput);
              const currentResult = batchResults.get(currentSheet.id);
              if (currentResult) {
                setDetectedScale(currentResult);
              }
            }
          } catch (textErr) {
            console.warn("Could not extract text from PDF for scale detection:", textErr);
          }
        }

        const latestSheets = sheetsRef.current;
        const currentIdx = latestSheets.findIndex((s: any) => s.id === currentSheet.id);
        const adjacentIndices = [currentIdx - 1, currentIdx + 1, currentIdx + 2].filter(i => i >= 0 && i < latestSheets.length);
        for (const idx of adjacentIndices) {
          const adjSheet = latestSheets[idx] as any;
          if (adjSheet && adjSheet.imageUrl && !pdfImageCacheRef.current.has(`${adjSheet.id}-${adjSheet.sheetIndex || 0}`)) {
            renderPdfPage(adjSheet.id, `/api/takeoff/sheets/${adjSheet.id}/pdf`, adjSheet.sheetIndex || 0).catch(() => {});
          }
        }
      } catch (error) {
        console.error("Error loading PDF:", error);
        setIsPdfLoading(false);
        setPdfLoadProgress(0);
        toast({
          title: "Error",
          description: "Failed to load PDF. The file may not be a valid PDF document.",
          variant: "destructive",
        });
      }
    };

    loadPDF();
    setDetectedScale(null);
  }, [currentSheet?.id, currentSheet?.imageUrl, toast, renderPdfPage]);

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

  const handleSaveCondition = (data: { name: string; measurementType: string; color: string; categoryName?: string; unitCost?: number; costCodeId?: string; labelTemplate?: string; lineStyle?: string; formula?: string; assemblyComponents?: string }) => {
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
        onExportQuantityDelta={handleExportQuantityDelta}
        onExportBidPackage={handleExportBidPackage}
        onPrintSheet={handlePrintSheet}
        isOffline={isOffline}
        onShowShortcuts={() => setShortcutsDialogOpen(true)}
        sheetRotation={sheetRotation}
        onRotateCW={() => handleRotate(90)}
        onRotateCCW={() => handleRotate(-90)}
        onRotate180={() => handleRotate(180)}
        gridEnabled={gridEnabled}
        onToggleGrid={handleToggleGrid}
        isCalibrated={!!currentSheet?.scalePxPerFoot}
        showMeasurementLabels={showMeasurementLabels}
        onToggleMeasurementLabels={(v) => { setShowMeasurementLabels(v); localStorage.setItem("takeoff-show-labels", String(v)); }}
        showStructuralGridlines={showStructuralGridlines}
        onToggleStructuralGridlines={setShowStructuralGridlines}
        labeled={labeled}
        onFitToPage={() => {
          if (pdfImage && containerRef.current) {
            const cw = containerRef.current.clientWidth;
            const ch = containerRef.current.clientHeight;
            const isRotated = sheetRotation === 90 || sheetRotation === 270;
            const pw = isRotated ? pdfImage.height : pdfImage.width;
            const ph = isRotated ? pdfImage.width : pdfImage.height;
            if (pw && ph) {
              const scale = Math.min(cw / pw, ch / ph) * 0.95;
              setStageScale(scale);
              setStagePosition({ x: (cw - pw * scale) / 2, y: (ch - ph * scale) / 2 });
            }
          }
        }}
      />

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0 relative">
        
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
                    queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
                    toast({ title: "Scale Applied", description: `Auto-detected scale ${detectedScale.label} applied` });
                    setDetectedScale(null);
                  } catch (err) {
                    console.warn("[Takeoff] Failed to apply detected scale:", err);
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
                  {/* Task #1682 — admin-gated Pin / Unpin / Use-latest
                      revision controls for the currently-selected sheet
                      so users don't have to leave the takeoff canvas to
                      change active-set membership. Wired to the same
                      mutations + cache-invalidations as PlansTab. */}
                  {canManageDrawingSetsOnCanvas && activeCanvasSetId && currentSheet && (() => {
                    const pinnedItem = activeCanvasSetItemMap.get(currentSheet.id);
                    const isPinned = pinnedSheetIdsForStrip.has(currentSheet.id);
                    const latestId = getLatestRevisionForCanvasSheet(currentSheet.id);
                    const setLabel = activeCanvasSetName || "active set";
                    return (
                      <>
                        <DropdownMenuSeparator />
                        {isPinned ? (
                          <DropdownMenuItem
                            onClick={() => {
                              if (!pinnedItem) return;
                              canvasUnpinSheetMutation.mutate({
                                setId: activeCanvasSetId,
                                itemId: pinnedItem.id,
                              });
                            }}
                            disabled={canvasUnpinSheetMutation.isPending || !pinnedItem}
                            data-testid="menu-unpin-sheet-from-set"
                          >
                            <PinOff className="h-4 w-4 mr-2" /> Unpin from {setLabel}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              canvasPinSheetMutation.mutate({
                                setId: activeCanvasSetId,
                                sheetId: currentSheet.id,
                              });
                            }}
                            disabled={canvasPinSheetMutation.isPending}
                            data-testid="menu-pin-sheet-to-set"
                          >
                            <Pin className="h-4 w-4 mr-2" /> Pin to {setLabel}
                          </DropdownMenuItem>
                        )}
                        {isPinned && latestId && pinnedItem && (
                          <DropdownMenuItem
                            onClick={() => {
                              canvasSwapPinnedRevisionMutation.mutate({
                                setId: activeCanvasSetId,
                                oldItemId: pinnedItem.id,
                                newSheetId: latestId,
                              });
                            }}
                            disabled={canvasSwapPinnedRevisionMutation.isPending}
                            data-testid="menu-use-latest-revision"
                          >
                            <ArrowUpCircle className="h-4 w-4 mr-2" /> Use latest revision
                          </DropdownMenuItem>
                        )}
                      </>
                    );
                  })()}
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
          <div className="flex items-center gap-1.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={autoImportEnabled ? "default" : "outline"}
                  size="sm"
                  className={`h-7 gap-1 px-2 text-xs ${autoImportEnabled ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
                  onClick={() => setAutoImportEnabled(!autoImportEnabled)}
                  data-testid="button-auto-import-toggle"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{autoImportEnabled ? "Auto-Import ON" : "Auto-Import"}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{autoImportEnabled ? "New measurements are automatically added to the estimate" : "Enable to auto-add new measurements to estimate"}</p>
              </TooltipContent>
            </Tooltip>
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
              measurementCounts={measurementCountsPerSheet}
              pinnedSheetIds={pinnedSheetIdsForStrip}
              newerSheetIds={newerSheetIdsForStrip}
              canManagePins={canManageDrawingSetsOnCanvas && !!activeCanvasSetId}
              onPinSheet={handleCanvasPinSheet}
              onUnpinSheet={handleCanvasUnpinSheet}
              onSwapToLatestRevision={handleCanvasSwapRevision}
              pinActionsDisabled={canvasPinMutationPending}
              activeSetName={activeCanvasSetName}
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
          {calibrationMode !== "idle" && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg text-sm font-medium flex items-center gap-2 pointer-events-none" data-testid="calibration-mode-banner">
              <span className="inline-block w-2 h-2 rounded-full bg-primary-foreground animate-pulse" />
              {calibrationMode === "first-point" ? "Click first point on a known distance" : "Click second point to complete"}
            </div>
          )}
          {isDrawing && isMobile && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-card/95 backdrop-blur-sm rounded-xl shadow-lg border px-3 py-2" data-testid="mobile-drawing-bar">
              <div className="flex items-center gap-1.5 pr-2 border-r">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs font-medium">{drawingPoints.length} pts</span>
              </div>
              {drawingPoints.length > 0 && (
                <button
                  onClick={() => {
                    const event = new KeyboardEvent("keydown", { key: "Backspace" });
                    window.dispatchEvent(event);
                  }}
                  className="px-3 py-1.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                  data-testid="mobile-undo-point"
                >
                  Undo
                </button>
              )}
              {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area" || activeTool === "segment") && drawingPoints.length >= (activeTool === "segment" ? 2 : 3) && (
                <button
                  onClick={() => {
                    const event = new KeyboardEvent("keydown", { key: "Enter" });
                    window.dispatchEvent(event);
                  }}
                  className="px-3 py-1.5 bg-green-500/20 text-green-700 dark:text-green-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                  data-testid="mobile-close-polygon"
                >
                  Close
                </button>
              )}
              <button
                onClick={() => {
                  const event = new KeyboardEvent("keydown", { key: "Escape" });
                  window.dispatchEvent(event);
                }}
                className="px-3 py-1.5 bg-red-500/20 text-red-700 dark:text-red-300 rounded-lg text-xs font-medium active:scale-95 transition-transform"
                data-testid="mobile-cancel-draw"
              >
                Cancel
              </button>
              {activeCondition && (
                <div className="flex items-center gap-1 pl-2 border-l">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
                  <span className="text-[10px] text-muted-foreground truncate max-w-[60px]">{activeCondition.name}</span>
                </div>
              )}
            </div>
          )}
          {isMobile && showMobileGestureGuide && selectedSheet && !isDrawing && (
            <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center" data-testid="mobile-gesture-guide">
              <div className="bg-card rounded-xl shadow-2xl p-5 mx-4 max-w-sm space-y-4">
                <h3 className="text-sm font-bold text-center">Touch Gestures</h3>
                <div className="space-y-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                      <span className="text-lg">👆</span>
                    </div>
                    <div><span className="font-medium text-foreground">Tap</span> — Place measurement points or select items</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                      <span className="text-lg">🤏</span>
                    </div>
                    <div><span className="font-medium text-foreground">Pinch</span> — Zoom in/out on the plan</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                      <span className="text-lg">👆👆</span>
                    </div>
                    <div><span className="font-medium text-foreground">Double-tap</span> — Complete polygon or close shape</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                      <span className="text-lg">☝️</span>
                    </div>
                    <div><span className="font-medium text-foreground">One-finger drag</span> — Pan the drawing</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowMobileGestureGuide(false);
                    localStorage.setItem("takeoff-gesture-guide-dismissed", "1");
                  }}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium active:scale-95 transition-transform"
                  data-testid="dismiss-gesture-guide"
                >
                  Got it
                </button>
              </div>
            </div>
          )}
          {isMobile && !isDrawing && selectedSheet && (
            <div className="absolute bottom-4 right-4 z-40" data-testid="mobile-fab-tools">
              {showMobileToolPicker && (
                <div className="absolute bottom-14 right-0 bg-card/95 backdrop-blur-sm rounded-xl shadow-lg border p-2 grid grid-cols-3 gap-1.5 min-w-[180px] animate-in fade-in slide-in-from-bottom-2 duration-200">
                  {[
                    { id: "linear" as const, label: "Line", icon: "📏" },
                    { id: "area" as const, label: "Area", icon: "⬜" },
                    { id: "volume" as const, label: "Vol", icon: "📦" },
                    { id: "count" as const, label: "Count", icon: "🔢" },
                    { id: "segment" as const, label: "Seg", icon: "📐" },
                    { id: "arc" as const, label: "Arc", icon: "⌒" },
                  ].map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => {
                        setActiveTool(tool.id);
                        setShowMobileToolPicker(false);
                        if (navigator.vibrate) navigator.vibrate(10);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-0.5 p-2 rounded-lg text-[10px] active:scale-95 transition-all",
                        activeTool === tool.id ? "bg-primary/20 text-primary font-bold" : "hover:bg-accent"
                      )}
                      data-testid={`mobile-tool-${tool.id}`}
                    >
                      <span className="text-base">{tool.icon}</span>
                      <span>{tool.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  setShowMobileToolPicker(!showMobileToolPicker);
                  if (navigator.vibrate) navigator.vibrate(10);
                }}
                className="w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center active:scale-90 transition-transform"
                data-testid="mobile-fab-button"
              >
                <span className="text-xl">{activeTool === "linear" ? "📏" : activeTool === "area" ? "⬜" : activeTool === "count" ? "🔢" : "✏️"}</span>
              </button>
            </div>
          )}
          {openSheetIds.length > 0 && (
            <div className="absolute top-2 left-2 right-2 z-20 flex items-center gap-0.5 bg-card/95 backdrop-blur-sm rounded-md shadow-sm border px-1 py-0.5 overflow-x-auto no-scrollbar" data-testid="sheet-tabs-bar">
              {openSheetIds
                .map((id) => sheets.find((s: any) => s.id === id))
                .filter(Boolean)
                .map((s: any, idx: number) => {
                  const isActive = selectedSheet === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedSheet(s.id)}
                      className={cn(
                        "group flex items-center gap-1 pl-2 pr-1 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors border",
                        isActive
                          ? "bg-background text-foreground border-border shadow-sm"
                          : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-accent/50"
                      )}
                      title={s.name || `Sheet ${idx + 1}`}
                      data-testid={`tab-sheet-${s.id}`}
                    >
                      <span className="truncate inline-block max-w-[140px] align-middle">{s.name || `Sheet ${idx + 1}`}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCloseSheetTab(s.id, e)}
                        className={cn(
                          "flex items-center justify-center w-4 h-4 rounded-sm shrink-0 transition-opacity hover:bg-muted-foreground/20",
                          isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                        )}
                        data-testid={`button-close-tab-${s.id}`}
                        title="Close tab"
                        aria-label={`Close ${s.name || `Sheet ${idx + 1}`}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}

          {selectedSheet && (
            <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 bg-card/90 backdrop-blur-sm rounded-md shadow-sm border px-2 py-1 text-[10px] text-muted-foreground" data-testid="takeoff-status-bar">
              <span className="font-mono tabular-nums" data-testid="status-zoom">{Math.round(stageScale * 100)}%</span>
              <span className="opacity-40">·</span>
              <span data-testid="status-tool">{TOOL_CONFIG.find(t => t.id === activeTool)?.label || "Select"}</span>
              {currentSheet?.scalePxPerFoot ? (
                <>
                  <span className="opacity-40">·</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium" data-testid="status-scale-ok">Calibrated</span>
                </>
              ) : (
                <>
                  <span className="opacity-40">·</span>
                  <span className="text-amber-600 dark:text-amber-400 font-medium" data-testid="status-scale-missing">No scale</span>
                </>
              )}
              {snapEnabled && (<><span className="opacity-40">·</span><span data-testid="status-snap">Snap</span></>)}
              {orthoLock && (<><span className="opacity-40">·</span><span data-testid="status-ortho">Ortho</span></>)}
              {gridEnabled && (<><span className="opacity-40">·</span><span data-testid="status-grid">Grid</span></>)}
            </div>
          )}

          {isDrawing && !isMobile && (
            <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg border px-3 py-1.5" data-testid="drawing-guide-bar">
              <div className="flex items-center gap-1.5">
                <div className={cn("w-2 h-2 rounded-full animate-pulse", isDrawing ? "bg-green-500" : "bg-muted-foreground")} />
                <span className="text-[11px] font-medium">
                  {activeTool === "linear" || activeTool === "linear_with_drop" || activeTool === "pitched_linear"
                    ? drawingPoints.length === 0 ? "Click start point" : "Click end point · Esc cancel"
                    : activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area"
                    ? drawingPoints.length < 3 ? `Click point ${drawingPoints.length + 1}` : `${drawingPoints.length} pts · Enter to close · Backspace undo`
                    : activeTool === "segment"
                    ? `${drawingPoints.length} pts · Enter to finish · Backspace undo`
                    : activeTool === "count"
                    ? "Click to place count"
                    : "Drawing..."}
                </span>
              </div>
              {drawingPoints.length > 0 && (
                <span className="text-[10px] text-muted-foreground border-l pl-2">
                  {drawingPoints.length} point{drawingPoints.length !== 1 ? "s" : ""}
                </span>
              )}
              {activeCondition && (
                <span className="text-[10px] text-muted-foreground border-l pl-2 flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
                  {activeCondition.name}
                </span>
              )}
            </div>
          )}
          {isDrawing && conditions.length > 0 && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg border px-2 py-1.5 max-w-[80%] overflow-x-auto" data-testid="condition-quick-bar">
              {activeCondition && (
                <div className="flex items-center gap-1.5 pr-2 border-r mr-1 shrink-0">
                  <div className="w-3 h-3 rounded-full border border-white/30 shrink-0" style={{ backgroundColor: activeCondition.color || "#2563eb" }} />
                  <span className="text-[11px] font-semibold truncate max-w-[120px]">{activeCondition.name}</span>
                </div>
              )}
              {conditions
                .filter(c => c.id !== activeCondition?.id)
                .sort((a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""))
                .slice(0, 8)
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => handleActivateCondition(c)}
                    className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] hover:bg-accent/80 transition-colors shrink-0"
                    data-testid={`quick-condition-${c.id}`}
                    title={`${c.name} (${c.measurementType})`}
                  >
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || "#2563eb" }} />
                    <span className="truncate max-w-[80px] text-muted-foreground">{c.name}</span>
                  </button>
                ))}
            </div>
          )}
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
                  <>
                    <Rect x={20} y={20} width={200} height={6} fill="#e5e7eb" cornerRadius={3} />
                    <Rect x={20} y={20} width={Math.max(4, pdfLoadProgress * 2)} height={6} fill="#f97316" cornerRadius={3} />
                    <Text text={`Loading plan... ${pdfLoadProgress}%`} x={20} y={32} fontSize={12} fill="#888" />
                  </>
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
                      opacity={showOverlaySlider ? (overlayOpacity / 100) * overlay.opacity : overlay.opacity}
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
                    const imgW = pdfImage.width;
                    const imgH = pdfImage.height;
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
                        {deductPolygons.map((dp, dpIdx) => (
                          <Line
                            key={`${m.id}-deduct-${dpIdx}`}
                            points={dp.points.flatMap((p: { x: number; y: number }) => [p.x, p.y])}
                            stroke="#ef4444"
                            strokeWidth={2}
                            dash={[6, 4]}
                            fill="rgba(239,68,68,0.15)"
                            closed={true}
                            listening={false}
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
                        {deductPolygons.map((dp, dpIdx) => (
                          <Line
                            key={`${m.id}-deduct-${dpIdx}`}
                            points={dp.points.flatMap((p: { x: number; y: number }) => [p.x, p.y])}
                            stroke="#ef4444"
                            strokeWidth={2}
                            dash={[6, 4]}
                            fill="rgba(239,68,68,0.15)"
                            closed={true}
                            listening={false}
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
                  const imgW = pdfImage.width;
                  const imgH = pdfImage.height;
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
                        for (const id of selectedMarkupIds) {
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
          ) : (
            <div className="flex items-center justify-center h-full" data-testid="takeoff-empty-state">
              <div className="max-w-lg w-full mx-auto text-center px-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <Upload className="w-10 h-10 text-primary/60" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Start Your Takeoff</h3>
                <p className="text-muted-foreground mb-6">Upload construction plans to begin measuring quantities. Supports multi-page PDFs with auto-scale detection.</p>
                <Button
                  size="lg"
                  onClick={() => setUploadDialogOpen(true)}
                  className="gap-2 mb-8"
                  data-testid="button-empty-upload-area"
                >
                  <Upload className="w-4 h-4" />
                  Import Plan Sheets
                </Button>
                <div className="grid grid-cols-3 gap-4 text-left">
                  <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-measure">
                    <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-2">
                      <Ruler className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <p className="text-sm font-medium">Precise Measurement</p>
                    <p className="text-xs text-muted-foreground mt-1">Linear, area, volume, count, and pitched measurements</p>
                  </div>
                  <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-ai">
                    <div className="w-8 h-8 rounded-md bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-2">
                      <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    </div>
                    <p className="text-sm font-medium">AI Auto-Takeoff</p>
                    <p className="text-xs text-muted-foreground mt-1">Auto-detect symbols and quantities from blueprints</p>
                  </div>
                  <div className="p-3 rounded-lg bg-card border" data-testid="info-feature-collab">
                    <div className="w-8 h-8 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-2">
                      <Users className="w-4 h-4 text-green-600 dark:text-green-400" />
                    </div>
                    <p className="text-sm font-medium">Live Collaboration</p>
                    <p className="text-xs text-muted-foreground mt-1">Work together in real-time with your team</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {markupTextInput && (() => {
            const w = pdfImage?.width || 0;
            const h = pdfImage?.height || 0;
            let rx = markupTextInput.x;
            let ry = markupTextInput.y;
            switch (sheetRotation) {
              case 90: rx = markupTextInput.y; ry = w - markupTextInput.x; break;
              case 180: rx = w - markupTextInput.x; ry = h - markupTextInput.y; break;
              case 270: rx = h - markupTextInput.y; ry = markupTextInput.x; break;
            }
            const left = Math.max(4, Math.min((rx * stageScale + stagePosition.x), (workspaceRef.current?.clientWidth || 9999) - 260));
            const top = Math.max(48, Math.min((ry * stageScale + stagePosition.y), (workspaceRef.current?.clientHeight || 9999) - 80));
            return (
              <MarkupTextInput
                key={`${markupTextInput.x},${markupTextInput.y}`}
                left={left}
                top={top}
                initialValue={markupTextInput.value}
                onSubmit={handleMarkupTextSubmit}
                onCancel={() => setMarkupTextInput(null)}
              />
            );
          })()}

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

          <LiveCostPanel
            measurements={measurements}
            categories={categories}
            visible={showCostPanel}
            onClose={() => setShowCostPanel(false)}
          />

          {showOverlaySlider && (
            <div className="absolute top-3 right-3 z-30 bg-card/95 backdrop-blur-sm border rounded-lg shadow-lg px-3 py-2 flex items-center gap-3 w-[220px]" data-testid="overlay-opacity-slider">
              <Layers className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="flex-1 accent-primary h-1.5"
                data-testid="input-overlay-opacity"
              />
              <span className="text-[10px] tabular-nums text-muted-foreground w-8 text-right">{overlayOpacity}%</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setShowOverlaySlider(false)} data-testid="button-close-overlay-slider">
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
        </div>
        {selectedMeasurementIds.size > 1 && (
          <div className="flex h-9 bg-primary/10 border-t border-primary/20 px-3 items-center justify-between text-xs shrink-0" data-testid="batch-action-bar">
            <span className="font-medium text-primary">{selectedMeasurementIds.size} measurements selected</span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                data-testid="button-batch-delete"
                onClick={async () => {
                  if (deleteMeasurementMutation) {
                    const toDelete = measurements.filter(m => selectedMeasurementIds.has(m.id));
                    const count = toDelete.length;
                    setSelectedMeasurementIds(new Set());
                    setSelectedMeasurementId(null);
                    for (const m of toDelete) {
                      deleteMeasurementMutation.mutate(m);
                    }
                    toast({ title: "Batch Delete", description: `Deleting ${count} measurements...` });
                  }
                }}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Delete All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                data-testid="button-batch-clear"
                onClick={() => {
                  setSelectedMeasurementIds(new Set());
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
        {selectedSheet && (
          <div className="hidden sm:flex h-7 bg-card/95 backdrop-blur-sm border-t px-3 items-center justify-between text-[11px] text-muted-foreground shrink-0 tabular-nums" data-testid="takeoff-status-bar">
            <div className="flex items-center gap-4">
              {measurements.length > 0 && (
                <>
                  <span className="font-medium text-foreground/80">{measurements.length} measurement{measurements.length !== 1 ? "s" : ""}</span>
                  {(() => {
                    const totals = { lf: 0, sf: 0, cy: 0, count: 0 };
                    measurements.forEach(m => {
                      if (m.computedLengthFt) totals.lf += Number(m.computedLengthFt);
                      if (m.computedAreaFt2) totals.sf += Number(m.computedAreaFt2);
                      if (m.computedVolumeCy) totals.cy += Number(m.computedVolumeCy);
                      if (m.type === "COUNT" && m.count) totals.count += Number(m.count);
                    });
                    return (
                      <>
                        {totals.lf > 0 && <span>LF: <strong className="text-foreground/80">{totals.lf.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>}
                        {totals.sf > 0 && <span>SF: <strong className="text-foreground/80">{totals.sf.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>}
                        {totals.cy > 0 && <span>CY: <strong className="text-foreground/80">{totals.cy.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span>}
                        {totals.count > 0 && <span>Count: <strong className="text-foreground/80">{totals.count.toLocaleString()}</strong></span>}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showCostPanel && "bg-primary/10 text-primary")}
                onClick={() => setShowCostPanel(!showCostPanel)}
                data-testid="button-toggle-cost-panel"
              >
                <DollarSign className="w-3 h-3" />
                <span>Costs</span>
              </button>
              <button
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showOverlaySlider && "bg-primary/10 text-primary")}
                onClick={() => setShowOverlaySlider(!showOverlaySlider)}
                data-testid="button-toggle-overlay-slider"
              >
                <Layers className="w-3 h-3" />
                <span>Overlay</span>
              </button>
              <button
                className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors", showMeasurementTable && "bg-primary/10 text-primary")}
                onClick={() => setShowMeasurementTable(!showMeasurementTable)}
                data-testid="button-toggle-measurement-table"
              >
                <TableProperties className="w-3 h-3" />
                <span>Table</span>
              </button>
              <span>Zoom: {Math.round(stageScale * 100)}%</span>
              {currentSheet?.scalePxPerFoot ? (
                <span className="text-green-600 dark:text-green-400">Scale: {currentSheet.units || "ft"}</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">Not Calibrated</span>
              )}
            </div>
          </div>
        )}
      </div>

      {showMeasurementTable && selectedSheet && (
        <div className="fixed bottom-0 left-[65px] right-0 z-30 bg-card border-t shadow-lg" style={{ height: "35vh" }} data-testid="measurement-table-panel">
          <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/30">
            <span className="text-xs font-semibold flex items-center gap-1.5">
              <TableProperties className="w-3.5 h-3.5" />
              Measurements ({measurements.length})
            </span>
            <button onClick={() => setShowMeasurementTable(false)} className="text-muted-foreground hover:text-foreground p-0.5" data-testid="close-measurement-table">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div style={{ height: "calc(35vh - 30px)" }}>
            <MeasurementTable
              measurements={measurements}
              categories={categories}
              selectedMeasurementId={selectedMeasurementId}
              onSelect={(id) => setSelectedMeasurementId(id)}
              onDelete={(id) => {
                const m = measurements.find((m: any) => m.id === id);
                if (m) deleteMeasurementMutation.mutate(m);
              }}
              onUpdate={(id, data) => updateMeasurementMutation.mutate({ id, ...data })}
              scalePxPerFoot={currentSheet?.scalePxPerFoot}
            />
          </div>
        </div>
      )}

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
        <div className={cn("absolute top-0 right-0 h-full w-full sm:w-80 max-w-full border-l bg-card shadow-2xl z-40 flex flex-col transition-opacity", isDrawing && !isMobile && "opacity-20 hover:opacity-100")} data-testid="panel-ai-takeoff-overlay">
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

              const LINEAR_UNITS = new Set(["lf", "lm", "ft", "m", "in", "linear feet", "linear meters", "feet", "meters", "inches"]);
              const AREA_UNITS = new Set(["sf", "sm", "sq ft", "sq m", "sqft", "sqm", "square feet", "square meters", "sq", "squares", "sy", "square yards"]);
              const VOLUME_UNITS = new Set(["cy", "cm", "cubic yards", "cubic meters", "cu yd", "cu ft", "cf", "cubic feet", "ton", "tons"]);
              const LINEAR_TYPES = new Set(["wire_run", "ridge", "drip_edge", "pipe_run", "conduit", "framing", "rebar", "gutter", "fascia", "soffit_linear", "trim"]);
              const AREA_TYPES = new Set(["roof_plane", "slab", "floor", "ceiling", "wall", "formwork", "insulation", "drywall", "sheathing", "membrane", "shingles", "roofing"]);
              const VOLUME_TYPES = new Set(["footing", "foundation", "concrete", "fill", "excavation", "backfill", "grading"]);

              const deriveMeasurementType = (item: DetectedItem): string => {
                const unitLower = (item.unit || "").toLowerCase();
                const typeLower = (item.itemType || "").toLowerCase();
                if (LINEAR_UNITS.has(unitLower) || LINEAR_TYPES.has(typeLower)) return "LINEAR";
                if (AREA_UNITS.has(unitLower) || AREA_TYPES.has(typeLower)) return "AREA";
                if (VOLUME_UNITS.has(unitLower) || VOLUME_TYPES.has(typeLower)) return "AREA";
                if (item.boundingBox && unitLower !== "ea" && unitLower !== "each") return "AREA";
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
                if (item.boundingBox) {
                  return [
                    { x: x1, y: y1 },
                    { x: x2, y: y1 },
                    { x: x2, y: y2 },
                    { x: x1, y: y2 },
                  ];
                }
                return [{ x: (x1 + x2) / 2, y: (y1 + y2) / 2 }];
              };

              for (let idx = 0; idx < items.length; idx++) {
                const item = items[idx];
                let measType = deriveMeasurementType(item);
                const points = derivePoints(item, measType, imgW, imgH);
                if (points.length >= 4 && measType === "COUNT") {
                  measType = "AREA";
                }

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

      {selectedMarkupIds.size >= 1 && markupEditDraft && markupEditInitial && (() => {
        const selectedMarkups = markups.filter(m => selectedMarkupIds.has(m.id));
        if (selectedMarkups.length === 0) return null;
        // Anchor: when only one is selected we use it directly; when
        // multiple are selected we still pick the first as a header
        // hint, but bulk save fans out across every selectedMarkup.
        const anchor = selectedMarkups.find(m => m.id === selectedMarkupId) ?? selectedMarkups[0];
        const isMulti = selectedMarkups.length > 1;
        const allText = selectedMarkups.every(m => (m.tool as string) === "TEXT");
        const allHighlight = selectedMarkups.every(m => (m.tool as string) === "HIGHLIGHT");
        // Task #1758 — Text input shows for a single TEXT markup OR
        // for a multi-selection that is exclusively TEXT markups (so a
        // user can rename a group of labels to the same string in one
        // shot). Mixed selections still hide it because bulk-renaming
        // non-TEXT shapes has no meaning. The bulk save routes the
        // text change through the same MARKUP_UPDATE_BATCH path as
        // color/thickness so one Undo press reverts every renamed
        // label.
        const showTextInput = allText;
        // Thickness applies to every non-text tool. If the selection
        // is exclusively TEXT markups, hide the thickness control
        // (matches existing single-select behavior).
        const showThicknessInput = !allText;
        const isHighlight = allHighlight;
        const close = () => {
          setSelectedMarkupIds(new Set());
          setMarkupEditDraft(null);
          setMarkupEditInitial(null);
        };
        // Task #1758 / #1765 — Real save logic lives in the exported
        // `saveMarkupStylingPopover` helper at the bottom of this file
        // so it can be exercised directly from tests (Task #1772)
        // without mounting the entire workspace. Single-select still
        // routes through `updateMarkupMutation` (one MARKUP_UPDATE
        // entry); multi-select fans out into ONE bulk PATCH and ONE
        // MARKUP_UPDATE_BATCH history entry pushed only after the
        // PATCH resolves.
        const save = () =>
          saveMarkupStylingPopover({
            draft: markupEditDraft,
            initial: markupEditInitial,
            showTextInput,
            isMulti,
            anchor,
            selectedMarkups,
            selectedSheet,
            updateMarkupMutation,
            bulkUpdateMarkupsMutation,
            takeoffHistory,
            toast,
            close,
          });
        return (
          <div
            className="absolute top-16 right-3 z-50 bg-card border rounded-lg shadow-lg p-3 w-64 space-y-3"
            data-testid="panel-markup-properties"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" data-testid="text-markup-edit-header">
                {isMulti ? `Edit ${selectedMarkups.length} markups` : "Edit markup"}
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={close} data-testid="button-close-markup-properties">
                <X className="w-4 h-4" />
              </Button>
            </div>
            {showTextInput && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Label</label>
                <Input
                  value={markupEditDraft.text}
                  onChange={(e) => setMarkupEditDraft({ ...markupEditDraft, text: e.target.value })}
                  data-testid="input-markup-text"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={markupEditDraft.color}
                  onChange={(e) => setMarkupEditDraft({ ...markupEditDraft, color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border"
                  data-testid="input-markup-color"
                />
                <span className="text-xs font-mono">{markupEditDraft.color}</span>
              </div>
            </div>
            {showThicknessInput && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{isHighlight ? "Border thickness" : "Thickness"}: {markupEditDraft.thickness}px</label>
                <div className="flex items-center gap-1" data-testid="input-markup-thickness">
                  {MARKUP_TOOLBAR_THICKNESSES.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant={markupEditDraft.thickness === t ? "default" : "ghost"}
                      className="h-7 w-7 p-0"
                      onClick={() => setMarkupEditDraft({ ...markupEditDraft, thickness: t })}
                      aria-label={`Thickness ${t}`}
                      aria-pressed={markupEditDraft.thickness === t}
                      data-testid={`button-markup-thickness-${t}`}
                    >
                      <span style={{ fontSize: 10 }}>{t}px</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              {!isMulti ? (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={async () => {
                    try {
                      await deleteMarkupMutation.mutateAsync(anchor.id);
                      close();
                    } catch (err) {
                      console.warn("[Takeoff] Failed to delete markup:", err);
                    }
                  }}
                  data-testid="button-delete-markup"
                >
                  Delete
                </Button>
              ) : <div />}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={close} data-testid="button-cancel-markup-edit">Cancel</Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={updateMarkupMutation.isPending}
                  data-testid="button-save-markup-edit"
                >
                  {updateMarkupMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

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
        sheetsQueryKey={sheetsQueryKey}
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
        pushMeasurementUpdateBatch={takeoffHistory.pushMeasurementUpdateBatchAction}
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
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapsed}
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
        onExportQuantityDelta={handleExportQuantityDelta}
        onExportBidPackage={handleExportBidPackage}
        onPrintSheet={handlePrintSheet}
        onZoomToMeasurement={handleZoomToMeasurement}
        onZoomToFitMeasurement={handleZoomToFitMeasurement}
        hideAiMeasurements={hideAiMeasurements}
        setHideAiMeasurements={setHideAiMeasurements}
        measurementLinks={measurementLinks}
        typicals={typicals}
        onSaveTypical={(name, measurementIds) => {
          if (!selectedSheet) return;
          const sourceMeasurements = measurements.filter(m => measurementIds.includes(m.id));
          const geometry = sourceMeasurements.map(m => ({
            type: m.type,
            points: typeof m.points === "string" ? JSON.parse(m.points) : m.points,
            label: m.label,
            categoryId: m.categoryId,
            computedAreaFt2: m.computedAreaFt2,
            computedLengthFt: m.computedLengthFt,
            computedVolumeCy: m.computedVolumeCy,
            count: m.count,
            metadata: m.metadata,
          }));
          const newTypical = { id: crypto.randomUUID(), name, measurementIds, sheetId: selectedSheet, geometry };
          const updated = [...typicals, newTypical];
          setTypicals(updated);
          localStorage.setItem("takeoff-typicals", JSON.stringify(updated));
          toast({ title: "Typical Saved", description: `"${name}" with ${geometry.length} measurement(s)` });
        }}
        onDeleteTypical={(id) => {
          const updated = typicals.filter(t => t.id !== id);
          setTypicals(updated);
          localStorage.setItem("takeoff-typicals", JSON.stringify(updated));
          toast({ title: "Typical Deleted" });
        }}
        onStampTypical={(typicalId) => {
          const typical = typicals.find(t => t.id === typicalId);
          if (!typical || !selectedSheet) return;
          const sources = typical.geometry && typical.geometry.length > 0
            ? typical.geometry
            : measurements.filter(m => typical.measurementIds.includes(m.id)).map(m => ({
                type: m.type,
                points: typeof m.points === "string" ? JSON.parse(m.points) : m.points,
                label: m.label,
                categoryId: m.categoryId,
                computedAreaFt2: m.computedAreaFt2,
                computedLengthFt: m.computedLengthFt,
                computedVolumeCy: m.computedVolumeCy,
                count: m.count,
                metadata: m.metadata,
              }));
          if (sources.length === 0) {
            toast({ title: "Error", description: "No measurements found for this typical", variant: "destructive" });
            return;
          }
          const offset = { x: 100 + typicalPlacementCount * 50, y: 100 + typicalPlacementCount * 50 };
          setTypicalPlacementCount(c => c + 1);
          sources.forEach((src) => {
            const pts: Array<{ x: number; y: number }> = Array.isArray(src.points) ? src.points : [];
            if (pts.length === 0) return;
            const offsetPts = pts.map((p: { x: number; y: number }) => ({ x: p.x + offset.x, y: p.y + offset.y }));
            createMeasurementMutation.mutate({
              sheetId: selectedSheet,
              type: src.type,
              points: offsetPts,
              label: `${src.label || src.type} (copy)`,
              categoryId: src.categoryId,
              computedAreaFt2: src.computedAreaFt2,
              computedLengthFt: src.computedLengthFt,
              computedVolumeCy: src.computedVolumeCy,
              count: src.count,
              metadata: src.metadata,
            });
          });
          toast({ title: "Typical Stamped", description: `Placed ${sources.length} measurement(s) with offset` });
        }}
        structuralGridlines={structuralGridlines}
        onUpdateGridlines={(gl) => {
          setStructuralGridlines(gl);
          localStorage.setItem("takeoff-gridlines", JSON.stringify(gl));
        }}
        labelHiddenCategories={labelHiddenCategories}
        onToggleLabelCategory={(catId) => {
          setLabelHiddenCategories(prev => {
            const next = new Set(prev);
            if (next.has(catId)) next.delete(catId); else next.add(catId);
            localStorage.setItem("takeoff-label-hidden-categories", JSON.stringify([...next]));
            return next;
          });
        }}
        showMeasurementLabels={showMeasurementLabels}
        conditions={conditions}
        activeCondition={activeCondition}
        onActivateCondition={handleActivateCondition}
        onClearCondition={handleClearCondition}
        onSaveCondition={handleSaveCondition}
        onUpdateCondition={(d: { id: string; [key: string]: string | number | boolean | undefined }) => updateConditionMutation.mutate(d)}
        onDeleteCondition={(id: string) => deleteConditionMutation.mutate(id)}
        saveConditionPending={createConditionMutation.isPending}
      />

      {crossModulePanelOpen && context?.type !== "bid" && (
        <div className={cn("absolute top-0 right-0 h-full w-full sm:w-[340px] max-w-full overflow-y-auto border-l bg-background shadow-2xl z-30 transition-opacity", isDrawing && !isMobile && "opacity-20 hover:opacity-100")} data-testid="panel-cross-module-overlay">
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
            queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
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
          toast({
            title: "Calibration Mode",
            description: "Click two points on a known distance to calibrate scale",
          });
        }}
        currentScalePxPerFoot={currentSheet?.scalePxPerFoot ?? null}
      />

      <Dialog open={bidPackageDialogOpen} onOpenChange={setBidPackageDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Bid Package</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-sm font-medium">Trade / Scope</label>
            <input
              type="text"
              className="w-full px-3 py-2 border rounded-md text-sm bg-background"
              placeholder="e.g. Electrical, Plumbing, General"
              value={bidPackageTradeScope}
              onChange={(e) => setBidPackageTradeScope(e.target.value)}
              data-testid="input-bid-package-trade"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBidPackageDialogOpen(false)} data-testid="button-cancel-bid-package">
              Cancel
            </Button>
            <Button onClick={handleConfirmBidPackage} data-testid="button-confirm-bid-package">
              Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markup styling popover save handler (extracted for Task #1772 testability).
//
// Production wiring lives in the popover JSX above — the inline `save`
// callback delegates to `saveMarkupStylingPopover` so the same code path
// runs whether the user clicks Save in the workspace or a test invokes the
// helper directly. Single-select edits stay on the `updateMarkupMutation`
// path (one MARKUP_UPDATE history entry via the mutation's onSuccess).
// Multi-select bulk style changes always collapse into ONE bulk PATCH and
// ONE MARKUP_UPDATE_BATCH history entry, pushed only after the PATCH
// resolves so a failed request never leaves a phantom Undo entry.
// ---------------------------------------------------------------------------

export type MarkupStylingDraft = {
  color: string;
  thickness: number;
  text: string;
};

export type MarkupStylingTarget = {
  id: string;
  tool: string;
  color: string;
  thickness: number;
  text: string | null;
};

export type MarkupSnapshot = {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
};

export type SaveMarkupStylingPopoverArgs = {
  draft: MarkupStylingDraft;
  initial: MarkupStylingDraft;
  showTextInput: boolean;
  isMulti: boolean;
  anchor: MarkupStylingTarget;
  selectedMarkups: MarkupStylingTarget[];
  selectedSheet: string | null;
  updateMarkupMutation: {
    mutateAsync: (vars: {
      id: string;
      color?: string;
      thickness?: number;
      text?: string | null;
      previous?: { color?: string; thickness?: number; text?: string | null };
    }) => Promise<unknown>;
  };
  bulkUpdateMarkupsMutation: {
    mutateAsync: (vars: {
      updates: Array<{ id: string; color?: string; thickness?: number; text?: string | null }>;
    }) => Promise<unknown>;
  };
  takeoffHistory: {
    pushMarkupUpdateBatchAction: (
      before: MarkupSnapshot[],
      after: MarkupSnapshot[],
      sheetId: string,
    ) => void;
  };
  toast: (opts: { title: string }) => void;
  close: () => void;
};

export async function saveMarkupStylingPopover(
  args: SaveMarkupStylingPopoverArgs,
): Promise<void> {
  const {
    draft,
    initial,
    showTextInput,
    isMulti,
    anchor,
    selectedMarkups,
    selectedSheet,
    updateMarkupMutation,
    bulkUpdateMarkupsMutation,
    takeoffHistory,
    toast,
    close,
  } = args;

  const colorChanged = draft.color !== initial.color;
  const thicknessChanged = draft.thickness !== initial.thickness;
  const textChanged = showTextInput && draft.text !== initial.text;
  if (!colorChanged && !thicknessChanged && !textChanged) {
    close();
    return;
  }

  if (!isMulti) {
    const editing = anchor;
    const updates: {
      id: string;
      color?: string;
      thickness?: number;
      text?: string | null;
      previous?: { color?: string; thickness?: number; text?: string | null };
    } = { id: editing.id };
    const previous: { color?: string; thickness?: number; text?: string | null } = {};
    if (colorChanged) {
      updates.color = draft.color;
      previous.color = editing.color;
    }
    if (thicknessChanged && editing.tool !== "TEXT") {
      updates.thickness = draft.thickness;
      previous.thickness = editing.thickness;
    }
    if (textChanged && editing.tool === "TEXT") {
      updates.text = draft.text;
      previous.text = editing.text ?? "";
    }
    if (Object.keys(updates).length === 1) {
      close();
      return;
    }
    updates.previous = previous;
    try {
      await updateMarkupMutation.mutateAsync(updates);
      toast({ title: "Markup updated" });
      close();
    } catch (err) {
      console.warn("[Takeoff] Failed to update markup:", err);
    }
    return;
  }

  const beforeSnaps: MarkupSnapshot[] = [];
  const afterSnaps: MarkupSnapshot[] = [];
  const bulkUpdates: Array<{ id: string; color?: string; thickness?: number; text?: string | null }> = [];
  for (const m of selectedMarkups) {
    const before: MarkupSnapshot = { id: m.id };
    const after: MarkupSnapshot = { id: m.id };
    const updateFields: { color?: string; thickness?: number; text?: string | null } = {};
    let hasChange = false;
    if (colorChanged && m.color !== draft.color) {
      before.color = m.color;
      after.color = draft.color;
      updateFields.color = draft.color;
      hasChange = true;
    }
    // Skip thickness on TEXT members — they have no stroke.
    if (thicknessChanged && m.tool !== "TEXT" && m.thickness !== draft.thickness) {
      before.thickness = m.thickness;
      after.thickness = draft.thickness;
      updateFields.thickness = draft.thickness;
      hasChange = true;
    }
    // Bulk text edit only for TEXT members; each member's before snapshot
    // keeps its individual prior label so Undo restores them independently.
    if (textChanged && m.tool === "TEXT" && (m.text ?? "") !== draft.text) {
      before.text = m.text ?? "";
      after.text = draft.text;
      updateFields.text = draft.text;
      hasChange = true;
    }
    if (!hasChange) continue;
    beforeSnaps.push(before);
    afterSnaps.push(after);
    bulkUpdates.push({ id: m.id, ...updateFields });
  }
  if (bulkUpdates.length === 0) {
    close();
    return;
  }
  // Capture the sheet id before awaiting so a sheet switch mid-flight
  // can't push the history batch into the wrong sheet.
  const sheetIdForBatch = selectedSheet;
  try {
    await bulkUpdateMarkupsMutation.mutateAsync({ updates: bulkUpdates });
  } catch (err) {
    console.warn("[Takeoff] Failed to bulk-update markups:", err);
    return;
  }
  if (sheetIdForBatch) {
    takeoffHistory.pushMarkupUpdateBatchAction(beforeSnaps, afterSnaps, sheetIdForBatch);
  }
  toast({ title: `Updated ${bulkUpdates.length} markups` });
  close();
}
