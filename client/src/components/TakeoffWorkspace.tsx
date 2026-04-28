import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment, type ComponentProps } from "react";
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
  ChevronLeft, ChevronRight, Pin, PinOff, ArrowUpCircle,
  Loader2, Check
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import * as pdfjsLib from 'pdfjs-dist';
import {
  createArcSegment,
  sampleArcPoints,
  computeNetAreaInFt2,
} from "@shared/utils/geometry";
import { type Tool, type MeasurementType, validateHexColor, hexToRgba, TOOL_CONFIG } from "./takeoff/types";
import { detectScaleFromText, type DetectedScale } from "@/lib/scaleDetection";
import { useTakeoffData } from "@/hooks/use-takeoff-data";
import { useTakeoffInteractions } from "@/hooks/use-takeoff-interactions";
import type { TakeoffCondition, TakeoffMeasurement, TakeoffSheet } from "@shared/schema";
import type { MeasurementSnapshot } from "@/hooks/use-takeoff-history";
import { computeAssemblyResults, type FormulaContext } from "@shared/utils/assemblyFormula";
import { commitMarkupBodyDrag, commitMarkupResize } from "./markups/markup-drag-commit";
import {
  TakeoffWorkspaceProvider,
  type TakeoffWorkspaceContextValue,
  type RibbonContextSlice,
  type PanelContextSlice,
  type SheetContextSlice,
  type CollabContextSlice,
  type CanvasContextSlice,
} from "./takeoff/hosts/TakeoffWorkspaceContext";
import { RibbonHost } from "./takeoff/hosts/RibbonHost";
import { SheetHost } from "./takeoff/hosts/SheetHost";
import { CanvasHost } from "./takeoff/hosts/CanvasHost";
import { PanelHost } from "./takeoff/hosts/PanelHost";
import { CollabHost } from "./takeoff/hosts/CollabHost";
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
  /** Task #2067 — When true, the `<PlanScaleModal>` opens in its
   *  near-fullscreen layout. Wired from the standalone `/takeoff/:bidCode`
   *  workspace page so the scale calibration UX gets Bluebeam-style breathing
   *  room. Embedded callers (bid Plans tab split-view) keep the compact
   *  modal by leaving this off. */
  fullscreenScaleModal?: boolean;
}

export default function TakeoffWorkspace({ projectId = "", projectCode = "", context, selectedSheetId: controlledSheetId, onSelectSheet, labeled = false, fullscreenScaleModal = false }: TakeoffWorkspaceProps) {
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
    // Task #1971 — When the server pushes a `MARKUP_DELETED` event
    // (a teammate removed markups from the same bid/project on
    // another device), the hook surgically prunes the cache; this
    // callback mirrors the prune into the workspace's local
    // selection set so the user can't re-select a markup that's
    // already been removed server-side. Mirrors the #1837
    // `pruneSelectedMarkupIds` callback that handles the
    // not_found-PATCH path for stale local edits.
    onMarkupDeleted: (_sheetId: string, ids: string[]) => {
      if (ids.length === 0) return;
      setSelectedMarkupIds((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const id of ids) {
          if (next.delete(id)) changed = true;
        }
        return changed ? next : prev;
      });
    },
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
      // Task #1837 — When the markup PATCH handler reports a
      // not_found rollback (a teammate deleted the markup on another
      // device), drop those ids out of the local selection set so
      // the user can't re-select a phantom that's already gone from
      // the cache.
      pruneSelectedMarkupIds: (ids: string[]) => {
        if (ids.length === 0) return;
        setSelectedMarkupIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const id of ids) {
            if (next.delete(id)) changed = true;
          }
          return changed ? next : prev;
        });
      },
      // Task #1970 — Same affordance as `pruneSelectedMarkupIds`
      // above but for measurements: when `updateMeasurementMutation`
      // sees a `reason: "not_found"` 404 (teammate deleted the
      // measurement on another device), clear the matching id from
      // both the single-select (`selectedMeasurementId`) and
      // multi-select (`selectedMeasurementIds`) state so the
      // properties panel can't re-issue an edit against a phantom.
      pruneSelectedMeasurementIds: (ids: string[]) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        setSelectedMeasurementId((prev) => (prev && idSet.has(prev) ? null : prev));
        setSelectedMeasurementIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const id of ids) {
            if (next.delete(id)) changed = true;
          }
          return changed ? next : prev;
        });
      },
    },
  });

  const {
    sheets, sheetsLoading, planDocuments, documentsLoading,
    projectAddenda, measurements, measurementsLoading,
    isViewingLockedVersion, markups, sheetLinks,
    categories, currentSheet, aggregatedMeasurements,
    sheetsQueryKey,
    importPlanMutation, supersedeSheetMutation, createMeasurementMutation,
    updateMeasurementMutation, bulkUpdateMeasurementsMutation, deleteMeasurementMutation, bulkDeleteMeasurementsMutation,
    createMarkupMutation, updateMarkupMutation, bulkUpdateMarkupsMutation, deleteMarkupMutation, bulkDeleteMarkupsMutation,
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
    // Task #1893 — keep the projects-list portfolio roll-up in sync.
    queryClient.invalidateQueries({ queryKey: ["/api/projects/drawing-sets/stale-summary"] });
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

  // Task #1917 — Stale-set re-pin reminder banner. Counts pinned items
  // whose `pinnedToLatestMap` entry points at a different (newer
  // active) sheet, mirroring what `/repin-stale` will actually update.
  // Reusing the existing `/sheet-status` payload avoids a third HTTP
  // round trip on top of the items + sheet-status the workspace
  // already loads for the canvas pin/unpin controls.
  const staleCanvasItemCount = useMemo(() => {
    const map = activeSetStatus?.pinnedToLatestMap;
    if (!map) return 0;
    let n = 0;
    for (const sheetId of Object.keys(map)) {
      const latestId = map[sheetId];
      if (latestId && latestId !== sheetId) n++;
    }
    return n;
  }, [activeSetStatus]);
  // Dismissal is persisted per-(set, count) in sessionStorage so a user
  // who dismisses the banner doesn't see it again for the same stale
  // signature on this tab — but a fresh stale sheet appearing (the
  // count changes) re-surfaces the reminder.
  const staleBannerDismissKey = activeCanvasSetId && staleCanvasItemCount > 0
    ? `takeoff-stale-banner-dismissed-${activeCanvasSetId}-${staleCanvasItemCount}`
    : null;
  const [staleBannerDismissed, setStaleBannerDismissed] = useState(false);
  useEffect(() => {
    if (!staleBannerDismissKey) {
      setStaleBannerDismissed(false);
      return;
    }
    try {
      setStaleBannerDismissed(sessionStorage.getItem(staleBannerDismissKey) === "true");
    } catch {
      setStaleBannerDismissed(false);
    }
  }, [staleBannerDismissKey]);
  const dismissStaleBanner = useCallback(() => {
    setStaleBannerDismissed(true);
    if (staleBannerDismissKey) {
      try { sessionStorage.setItem(staleBannerDismissKey, "true"); } catch {}
    }
  }, [staleBannerDismissKey]);
  // Task #1917 — same `/repin-stale` endpoint used by Task #1894's
  // per-card and Compare-dialog buttons. Toast wording mirrors
  // SetStaleBadge.repinStaleMutation so the user sees identical
  // confirmation copy regardless of which entry point they used.
  const repinStaleCanvasMutation = useMutation({
    mutationFn: async () => {
      if (!activeCanvasSetId) throw new Error("No active drawing set");
      const res = await apiRequest(
        "POST",
        `/api/projects/drawing-sets/${activeCanvasSetId}/repin-stale`,
      );
      return res.json() as Promise<{ updated: number; replaced: number; removed: number }>;
    },
    onSuccess: (data) => {
      invalidateDrawingSetCanvasCaches(activeCanvasSetId);
      const count = data?.updated ?? 0;
      toast({
        title:
          count === 0
            ? "No stale sheets to update"
            : count === 1
              ? "Re-pinned 1 sheet to latest"
              : `Re-pinned ${count} sheets to latest`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to re-pin stale sheets.",
        variant: "destructive",
      });
    },
  });
  const showStaleBanner =
    drawingSetsEnabled &&
    canManageDrawingSetsOnCanvas &&
    !!activeCanvasSetId &&
    staleCanvasItemCount > 0 &&
    !staleBannerDismissed;

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
    ? sheets.find((s: TakeoffSheet) => s.id === (currentSheet as any).supersededById)
    : null;
  const predecessorSheet = !currentSheetIsSuperseded && currentSheet
    ? sheets.find((s: TakeoffSheet) => s.supersededById === currentSheet.id)
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
        createMeasurementMutation.mutate(enriched as Parameters<typeof createMeasurementMutation.mutate>[0]);
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

  // Task #1884 — Measurement selection and markup selection are tracked
  // independently, so without this effect a user could have a
  // measurement *and* one or more markups selected at the same time.
  // Pressing Delete/Backspace would then fire BOTH the measurement
  // handler in `use-takeoff-interactions.ts` AND the markup handler
  // above on the same keypress, silently bulk-deleting work the user
  // didn't mean to remove. This effect enforces that the canvas only
  // ever has one "active" entity class: when the user grows one
  // selection (selects a new measurement, expands the measurement
  // multi-set, or shift-clicks a markup), the other class is cleared.
  // Shrinking either selection (deselecting, sheet change, escape) is
  // intentionally a no-op so we don't fight the existing teardown
  // effects. With both selections mutually exclusive, the two Delete
  // handlers can never both fire on the same keypress.
  const prevSelMeasIdRef = useRef(selectedMeasurementId);
  const prevSelMeasIdsSizeRef = useRef(selectedMeasurementIds.size);
  const prevSelMarkupIdsSizeRef = useRef(selectedMarkupIds.size);
  useEffect(() => {
    const decision = resolveCrossClassSelection({
      selectedMeasurementId,
      selectedMeasurementIdsSize: selectedMeasurementIds.size,
      selectedMarkupIdsSize: selectedMarkupIds.size,
      prevSelectedMeasurementId: prevSelMeasIdRef.current,
      prevSelectedMeasurementIdsSize: prevSelMeasIdsSizeRef.current,
      prevSelectedMarkupIdsSize: prevSelMarkupIdsSizeRef.current,
    });
    if (decision === "clear-markups") {
      setSelectedMarkupIds(new Set());
      setMarkupEditDraft(null);
      setMarkupEditInitial(null);
    } else if (decision === "clear-measurements") {
      if (selectedMeasurementId !== null) setSelectedMeasurementId(null);
      if (selectedMeasurementIds.size > 0) setSelectedMeasurementIds(new Set());
    }

    prevSelMeasIdRef.current = selectedMeasurementId;
    prevSelMeasIdsSizeRef.current = selectedMeasurementIds.size;
    prevSelMarkupIdsSizeRef.current = selectedMarkupIds.size;
  }, [
    selectedMeasurementId,
    selectedMeasurementIds,
    selectedMarkupIds,
    setSelectedMeasurementId,
    setSelectedMeasurementIds,
  ]);

  // Task #1861 — route Delete/Backspace through the same bulk-delete
  // mutation the multi-select panel button uses, so the keyboard and
  // the button never drift apart. Scope is intentionally narrow:
  // canvas/workspace must own focus, no text-editing context, no
  // active drawing/calibration, no in-flight bulk delete.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (selectedMarkupIds.size === 0) return;
      if (isDrawing || markupDrawing) return;
      if (calibrationMode !== "idle") return;
      if (bulkDeleteMarkupsMutation.isPending) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Only fire when focus is inside the takeoff workspace (or on
      // the document body / a Konva canvas, which is what
      // `selectedMarkupIds.size > 0` already implies). This prevents
      // a Delete keypress from a focused button or link elsewhere on
      // the page from accidentally bulk-deleting markups.
      const active = document.activeElement as HTMLElement | null;
      const root = workspaceRef.current;
      const isBodyOrNull =
        !active || active === document.body || active === document.documentElement;
      const isInsideWorkspace = !!root && !!active && root.contains(active);
      if (!isBodyOrNull && !isInsideWorkspace) return;
      event.preventDefault();
      const ids = Array.from(selectedMarkupIds);
      // Match the toolbar button: clear selection/edit state only
      // after the bulk DELETE resolves so a server failure leaves the
      // UI in the same state as before the keypress (markups still
      // selected, edit panel still open, undo history unchanged).
      bulkDeleteMarkupsMutation
        .mutateAsync(ids)
        .then(() => {
          setSelectedMarkupIds(new Set());
          setMarkupEditDraft(null);
          setMarkupEditInitial(null);
        })
        .catch((err) => {
          console.warn("[Takeoff] Failed to bulk-delete markups via key:", err);
        });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedMarkupIds,
    isDrawing,
    markupDrawing,
    calibrationMode,
    bulkDeleteMarkupsMutation,
  ]);

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
        const currentIdx = latestSheets.findIndex((s: TakeoffSheet) => s.id === currentSheet.id);
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

  // Task #2136 — Per-host context slices. Each slice is memoized
  // independently so unrelated state changes don't ripple across
  // hosts (real per-slice render isolation). Side-effect callbacks
  // are pre-bound here so hosts stay pure view layers.
  const isCalibrated = !!currentSheet?.scalePxPerFoot;
  const ribbonSlice: RibbonContextSlice = useMemo(() => ({
    activeTool,
    handleToolSelect,
    stageScale,
    setStageScale,
    selectedMeasurementId,
    measurements,
    deleteMeasurementMutation: {
      mutate: (m) => deleteMeasurementMutation.mutate(m),
      isPending: deleteMeasurementMutation.isPending,
    },
    takeoffHistory,
    snapEnabled,
    setSnapEnabled,
    orthoLock,
    setOrthoLock,
    onUpload: () => setUploadDialogOpen(true),
    aiPanelOpen,
    setAiPanelOpen,
    mobileMeasurementsOpen,
    setMobileMeasurementsOpen,
    isDrawing,
    drawingPoints,
    isMobile,
    markupColor,
    setMarkupColor,
    markupThickness,
    setMarkupThickness,
    handleExportCurrentSheet,
    handleExportAllSheets,
    handleExportQuantityDelta,
    handleExportBidPackage,
    handlePrintSheet,
    isOffline,
    onShowShortcuts: () => setShortcutsDialogOpen(true),
    sheetRotation,
    onRotateCW: () => handleRotate(90),
    onRotateCCW: () => handleRotate(-90),
    onRotate180: () => handleRotate(180),
    gridEnabled,
    handleToggleGrid,
    isCalibrated,
    onFitToPage: () => zoomToFitRef.current(),
    showMeasurementLabels,
    onToggleMeasurementLabels: (v: boolean) => {
      setShowMeasurementLabels(v);
      try {
        localStorage.setItem("takeoff-show-labels", v ? "true" : "false");
      } catch (err) {
        console.warn("[Takeoff] Failed to persist label visibility setting:", err);
      }
    },
    showStructuralGridlines,
    setShowStructuralGridlines,
    labeled,
  }), [
    activeTool, handleToolSelect, stageScale, selectedMeasurementId, measurements,
    deleteMeasurementMutation, takeoffHistory, snapEnabled, orthoLock,
    aiPanelOpen, mobileMeasurementsOpen, isDrawing, drawingPoints, isMobile,
    markupColor, markupThickness, handleExportCurrentSheet, handleExportAllSheets,
    handleExportQuantityDelta, handleExportBidPackage, handlePrintSheet, isOffline,
    sheetRotation, handleRotate, gridEnabled, handleToggleGrid, isCalibrated,
    showMeasurementLabels, showStructuralGridlines, labeled,
  ]);
  const handleAcceptDetectedScale = useCallback(async () => {
    if (!selectedSheet || !detectedScale) return;
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
  }, [selectedSheet, detectedScale, sheetsQueryKey, toast]);

  const sheetSlice: SheetContextSlice = useMemo(() => ({
    isViewingLockedVersion,
    onReturnToDraft: () => setSelectedVersionId(null),
    detectedScale,
    hasCurrentSheetScale: !!currentSheet?.scalePxPerFoot,
    onAcceptDetectedScale: handleAcceptDetectedScale,
    onDismissDetectedScale: () => setDetectedScale(null),
    showStaleBanner,
    staleCanvasItemCount,
    onRepinStaleCanvas: () => repinStaleCanvasMutation.mutate(),
    isRepinPending: repinStaleCanvasMutation.isPending,
    onDismissStaleBanner: dismissStaleBanner,
    currentSheetIsSuperseded: !!currentSheetIsSuperseded,
    hasCompareNewSheet: !!compareNewSheet,
    onOpenCompareDialog: () => setCompareDialogOpen(true),
  }), [
    isViewingLockedVersion, detectedScale, currentSheet?.scalePxPerFoot,
    handleAcceptDetectedScale, showStaleBanner, staleCanvasItemCount,
    repinStaleCanvasMutation.isPending, dismissStaleBanner,
    currentSheetIsSuperseded, compareNewSheet,
  ]);
  const canvasSlice = useMemo<CanvasContextSlice>(() => ({
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
    isPdfLoading,
    pdfLoadProgress,
    activeTool,
    setActiveTool,
    isDrawing,
    drawingPoints,
    cursorPosition,
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
    calibrationPoints,
    verifyPoints,
    currentSnap,
    runningMeasurement,
    orthoLock,
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
  }), [
    stageDimensions, stageScale, stagePosition,
    selectedSheet, currentSheet, sheetRotation, pdfImage, isPdfLoading, pdfLoadProgress,
    activeTool,
    isDrawing, drawingPoints, cursorPosition,
    showAiOverlays, hideAiMeasurements, hideResolvedIssues, showOverlaySlider, overlayOpacity,
    preImportDetectedItems, highlightedAiItem,
    addendaImages, addendaOverlays,
    gridEnabled, showStructuralGridlines, structuralGridlines,
    showMeasurementLabels, hiddenCategoryIds, labelHiddenCategories,
    measurements, categories,
    selectedMeasurementId, selectedSegmentIndex,
    selectedMarkupId, selectedMarkupIds,
    markupResizePreview, markupEditDraft,
    markups, sheets, markupDrawing, markupDrawPoints,
    sheetLinks, hoveredLinkId, failedMarkupIds,
    flashMeasurementId, flashPulse,
    calibrationPoints, verifyPoints,
    currentSnap, runningMeasurement,
    orthoLock, activeCondition,
    issues, selectedIssueId,
    createLinkMode,
    isMobile,
    markupColor, markupThickness,
    bulkUpdateMarkupsMutation, updateMarkupMutation, updateMeasurementMutation,
    createIssueMutation, moveIssueMutation,
    takeoffHistory,
    completePolygon, completeSegment,
    handleStageMouseDown, handleStageMouseUp, handleStageMouseMove,
    handleStageDragStart, handleStageDragMove, handleStageDragEnd,
    handleTouchEnd, handleTouchMove, handleWheel,
    handleMarkupMouseDown, handleMarkupMouseUp, handleMarkupMouseMove,
    handleLinkNavigate,
    collab,
  ]);

  const handleSaveTypical = (name: string, measurementIds: string[]) => {
    if (!selectedSheet) return;
    const sourceMeasurements = measurements.filter((m) => measurementIds.includes(m.id));
    const geometry = sourceMeasurements.map((m) => ({
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
  };
  const handleDeleteTypical = (id: string) => {
    const updated = typicals.filter((t) => t.id !== id);
    setTypicals(updated);
    localStorage.setItem("takeoff-typicals", JSON.stringify(updated));
    toast({ title: "Typical Deleted" });
  };
  const handleStampTypical = (typicalId: string) => {
    const typical = typicals.find((t) => t.id === typicalId);
    if (!typical || !selectedSheet) return;
    const sources = typical.geometry && typical.geometry.length > 0
      ? typical.geometry
      : measurements.filter((m) => typical.measurementIds.includes(m.id)).map((m) => ({
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
    setTypicalPlacementCount((c) => c + 1);
    sources.forEach((src) => {
      const pts: Array<{ x: number; y: number }> = Array.isArray(src.points) ? src.points : [];
      if (pts.length === 0) return;
      const offsetPts = pts.map((p: { x: number; y: number }) => ({ x: p.x + offset.x, y: p.y + offset.y }));
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: src.type as MeasurementType,
        points: offsetPts,
        label: `${src.label || src.type} (copy)`,
        categoryId: src.categoryId,
        computedAreaFt2: src.computedAreaFt2,
        computedLengthFt: src.computedLengthFt ?? undefined,
        computedVolumeCy: src.computedVolumeCy,
        count: src.count,
        metadata: typeof src.metadata === "string" ? src.metadata : undefined,
      } as Parameters<typeof createMeasurementMutation.mutate>[0]);
    });
    toast({ title: "Typical Stamped", description: `Placed ${sources.length} measurement(s) with offset` });
  };

  const panelSlice: PanelContextSlice = useMemo(() => ({
    versionHistory: {
      open: versionHistoryOpen,
      onOpenChange: setVersionHistoryOpen,
      sheetId: selectedSheet,
      projectId: context?.type === "project" ? context.projectId : projectId || undefined,
      bidId: context?.type === "bid" ? context.bidId : undefined,
      onVersionSwitch: (versionId: string | null) => {
        setSelectedVersionId(versionId);
        setVersionHistoryOpen(false);
      },
    },
    sidebar: {
      selectedSheet,
      currentSheet,
      projectId,
      sheetsQueryKey,
      calibrationMode,
      calibrationPoints,
      calibrationDistance,
      setCalibrationDistance,
      units,
      setUnits,
      onSaveCalibration: handleSaveCalibration,
      activeTool,
      categories,
      selectedCategoryId,
      setSelectedCategoryId,
      setCategoryDialogOpen,
      setEditingCategory,
      onDeleteCategory: handleDeleteCategory,
      hiddenCategoryIds,
      onToggleCategoryVisibility: handleToggleCategoryVisibility,
      pitchRatio,
      setPitchRatio,
      dropDistance,
      setDropDistance,
      measurements,
      selectedMeasurementId,
      setSelectedMeasurementId,
      selectedSegmentIndex,
      setSelectedSegmentIndex,
      deleteMeasurementMutation,
      updateMeasurementMutation,
      bulkUpdateMeasurementsMutation,
      pushMeasurementUpdateBatch: takeoffHistory.pushMeasurementUpdateBatchAction,
      aggregatedMeasurements,
      projectAddenda,
      addendaOverlays,
      setAddendaOverlays,
      verifyMode,
      setVerifyMode,
      verifyPoints,
      setVerifyPoints,
      verifyExpectedDistance,
      setVerifyExpectedDistance,
      verifyResult,
      setVerifyResult,
      multiCalibMode,
      setMultiCalibMode,
      multiCalibPoints,
      setMultiCalibPoints,
      setCalibrationMode,
      setCalibrationPoints,
      workspaceRef,
      aiPanelOpen,
      collapsed: sidebarCollapsed,
      onToggleCollapse: toggleSidebarCollapsed,
      onApplyPresetScale: handleApplyPresetScale,
      sheets,
      onCompareRevisions: hasRevisionHistory ? () => setCompareDialogOpen(true) : undefined,
      onSelectSheet: setSelectedSheet,
      markups,
      deleteMarkupMutation,
      measurementGroups,
      createGroupMutation,
      updateGroupMutation,
      deleteGroupMutation,
      toggleGroupVisibilityMutation,
      issues,
      allSheetIssues: allIssues,
      selectedIssueId,
      onSelectIssue: (issue: { id: string; sheetId?: string | null }) => {
        setSelectedIssueId(issue.id);
        if (issue.sheetId && issue.sheetId !== selectedSheet) {
          setSelectedSheet(issue.sheetId);
        }
      },
      onExportCurrentSheet: handleExportCurrentSheet,
      onExportAllSheets: handleExportAllSheets,
      onExportQuantityDelta: handleExportQuantityDelta,
      onExportBidPackage: handleExportBidPackage,
      onPrintSheet: handlePrintSheet,
      onZoomToMeasurement: handleZoomToMeasurement,
      onZoomToFitMeasurement: handleZoomToFitMeasurement,
      hideAiMeasurements,
      setHideAiMeasurements,
      measurementLinks,
      typicals,
      onSaveTypical: handleSaveTypical,
      onDeleteTypical: handleDeleteTypical,
      onStampTypical: handleStampTypical,
      structuralGridlines,
      onUpdateGridlines: (gl) => {
        setStructuralGridlines(gl);
        localStorage.setItem("takeoff-gridlines", JSON.stringify(gl));
      },
      labelHiddenCategories,
      onToggleLabelCategory: (catId: string) => {
        setLabelHiddenCategories((prev) => {
          const next = new Set(prev);
          if (next.has(catId)) next.delete(catId); else next.add(catId);
          localStorage.setItem("takeoff-label-hidden-categories", JSON.stringify(Array.from(next)));
          return next;
        });
      },
      showMeasurementLabels,
      conditions,
      activeCondition,
      onActivateCondition: handleActivateCondition,
      onClearCondition: handleClearCondition,
      onSaveCondition: handleSaveCondition,
      onUpdateCondition: (d: { id: string; [key: string]: string | number | boolean | undefined }) => updateConditionMutation.mutate(d),
      onDeleteCondition: (id: string) => deleteConditionMutation.mutate(id),
      saveConditionPending: createConditionMutation.isPending,
    },
    dialogs: {
      mobileMeasurementsOpen,
      setMobileMeasurementsOpen,
      measurements,
      selectedMeasurementId,
      setSelectedMeasurementId,
      deleteMeasurementMutation,
      updateMeasurementMutation,
      aggregatedMeasurements,
      categories,
      hiddenCategoryIds,
      onToggleCategoryVisibility: handleToggleCategoryVisibility,
      renameDialogOpen,
      setRenameDialogOpen,
      renameValue,
      setRenameValue,
      renameSheetMutation,
      selectedSheet,
      deleteSheetConfirmOpen,
      setDeleteSheetConfirmOpen,
      currentSheet,
      deleteSheetMutation,
      noteDialogOpen,
      setNoteDialogOpen,
      noteText,
      setNoteText,
      notePosition,
      setNotePosition,
      onSaveNote: handleSaveNote,
      categoryDialogOpen,
      setCategoryDialogOpen,
      editingCategory,
      setEditingCategory,
      categoryName,
      setCategoryName,
      categoryColor,
      setCategoryColor,
      categoryLineStyle,
      setCategoryLineStyle,
      categoryLineWidth,
      setCategoryLineWidth,
      categoryWasteFactor,
      setCategoryWasteFactor,
      categoryUnitCost,
      setCategoryUnitCost,
      onSaveCategory: handleSaveCategory,
      saveCategoryPending: saveCategoryMutation.isPending,
      shortcutsDialogOpen,
      setShortcutsDialogOpen,
      uploadDialogOpen,
      setUploadDialogOpen,
      planDocuments,
      documentsLoading,
      sheets,
      importPlanMutation,
      supersedeSheetMutation,
      workspaceRef,
    },
    scaleModal: {
      fullscreen: fullscreenScaleModal,
      open: scaleModalOpen,
      onClose: () => setScaleModalOpen(false),
      onApplyScale: async (pxPerFoot, scaleUnits, label) => {
        if (!selectedSheet) return;
        try {
          await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: pxPerFoot, units: scaleUnits });
          queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
          toast({ title: "Scale Applied", description: `Scale set to ${label}` });
        } catch (error: any) {
          toast({ title: "Error", description: error?.message || "Failed to apply scale", variant: "destructive" });
        }
      },
      onStartCalibration: () => {
        setCalibrationMode("first-point");
        setCalibrationPoints([]);
        setCalibrationDistance("");
        setActiveTool("calibrate");
        toast({ title: "Calibration Mode", description: "Click two points on a known distance to calibrate scale" });
      },
      currentScalePxPerFoot: currentSheet?.scalePxPerFoot ?? null,
    },
    compareDialog:
      compareDialogOpen && currentSheet && compareNewSheet
        ? {
            open: compareDialogOpen,
            onOpenChange: setCompareDialogOpen,
            oldSheet: compareOldSheet as ComponentProps<typeof TakeoffSheetCompareDialog>["oldSheet"],
            newSheet: compareNewSheet as ComponentProps<typeof TakeoffSheetCompareDialog>["newSheet"],
            allSheets: sheets as ComponentProps<typeof TakeoffSheetCompareDialog>["allSheets"],
          }
        : null,
    crossModulePanel: {
      visible: crossModulePanelOpen && context?.type !== "bid",
      isDrawing,
      isMobile,
      props: {
        projectId,
        selectedSheet,
        measurements,
        categories,
        onClose: () => setCrossModulePanelOpen(false),
      },
    },
    bidPackage: {
      open: bidPackageDialogOpen,
      setOpen: setBidPackageDialogOpen,
      tradeScope: bidPackageTradeScope,
      setTradeScope: setBidPackageTradeScope,
      onConfirm: handleConfirmBidPackage,
    },
    // Deps are intentionally permissive — many of the captured values
    // are stable React setters / mutations / refs. The slice is
    // rebuilt whenever any of the orchestrator's renderable state
    // changes; React + the per-slice context still prevents this from
    // rerendering Ribbon/Canvas/Sheet/Collab consumers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    versionHistoryOpen, selectedSheet, projectId, context, currentSheet,
    calibrationMode, calibrationPoints, calibrationDistance, units,
    activeTool, categories, selectedCategoryId, hiddenCategoryIds,
    pitchRatio, dropDistance, measurements, selectedMeasurementId,
    selectedSegmentIndex, aggregatedMeasurements, projectAddenda,
    addendaOverlays, verifyMode, verifyPoints, verifyExpectedDistance,
    verifyResult, multiCalibMode, multiCalibPoints, aiPanelOpen,
    sidebarCollapsed, hasRevisionHistory, sheets, markups, measurementGroups,
    issues, allIssues, selectedIssueId, hideAiMeasurements, measurementLinks,
    typicals, structuralGridlines, labelHiddenCategories, showMeasurementLabels,
    conditions, activeCondition, mobileMeasurementsOpen, renameDialogOpen,
    renameValue, deleteSheetConfirmOpen, noteDialogOpen, noteText, notePosition,
    categoryDialogOpen, editingCategory, categoryName, categoryColor,
    categoryLineStyle, categoryLineWidth, categoryWasteFactor, categoryUnitCost,
    shortcutsDialogOpen, uploadDialogOpen, planDocuments, documentsLoading,
    fullscreenScaleModal, scaleModalOpen, compareDialogOpen, compareOldSheet,
    compareNewSheet, crossModulePanelOpen, isDrawing, isMobile,
    bidPackageDialogOpen, bidPackageTradeScope,
  ]);
  const collabSlice: CollabContextSlice = useMemo(() => ({
    collaborators: collab.collaborators,
    currentSheetLock: collab.currentSheetLock,
    connected: collab.connected,
    hasRoom: !!collabRoomId,
    sheetNameById: (sheetId: string) =>
      sheets.find((s: TakeoffSheet) => s.id === sheetId)?.sheetName ?? null,
  }), [collab.collaborators, collab.currentSheetLock, collab.connected, collabRoomId, sheets]);
  const ctxValue: TakeoffWorkspaceContextValue = {
    ribbon: ribbonSlice,
    sheet: sheetSlice,
    canvas: canvasSlice,
    panel: panelSlice,
    collab: collabSlice,
  };

  return (
    <TakeoffWorkspaceProvider value={ctxValue}>
    <div ref={workspaceRef} className="flex flex-col sm:flex-row h-full relative overflow-hidden">
      <RibbonHost />

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0 relative">
        <SheetHost />
        
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
            <CollabHost />
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
                .map((id) => sheets.find((s: TakeoffSheet) => s.id === id))
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
                .sort((a, b) => {
                  const bKey = b.lastUsedAt ? new Date(b.lastUsedAt).toISOString() : "";
                  const aKey = a.lastUsedAt ? new Date(a.lastUsedAt).toISOString() : "";
                  return bKey.localeCompare(aKey);
                })
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
            <CanvasHost />
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
                        const targetSheet = sheets.find((s: TakeoffSheet) => s.id === val);
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
                disabled={bulkDeleteMeasurementsMutation.isPending}
                data-testid="button-batch-delete"
                onClick={async () => {
                  // Task #1901 — Route through the bulk mutation so the
                  // user gets a single destructive "Deleted N
                  // measurements · Undo" toast (mirroring #1882 for
                  // markups) and the deletion is coalesced into one
                  // MEASUREMENT_DELETE_BATCH history entry instead of
                  // N per-id `DELETE` entries from the previous
                  // per-id fan-out loop.
                  const toDelete = measurements.filter(m => selectedMeasurementIds.has(m.id));
                  if (toDelete.length === 0) return;
                  setSelectedMeasurementIds(new Set());
                  setSelectedMeasurementId(null);
                  bulkDeleteMeasurementsMutation.mutate(toDelete);
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
              onUpdate={(id, data) => {
                // Task #1843 — forward a `previous` snapshot so the
                // inline rename in MeasurementTable produces one
                // MEASUREMENT_UPDATE history entry (one Undo press).
                const prev: TakeoffMeasurement | undefined = measurements.find(
                  (mm: TakeoffMeasurement) => mm.id === id,
                );
                const previous: Omit<MeasurementSnapshot, "id"> = {};
                if (prev) {
                  if (data.label !== undefined) previous.label = prev.label ?? null;
                  if (data.costCodeId !== undefined) previous.costCodeId = prev.costCodeId ?? null;
                  if (data.unitCost !== undefined) previous.unitCost = prev.unitCost ?? null;
                  if (data.categoryId !== undefined) previous.categoryId = prev.categoryId ?? null;
                  if (data.groupId !== undefined) previous.groupId = prev.groupId ?? null;
                  if (data.lineStyle !== undefined) previous.lineStyle = prev.lineStyle ?? null;
                  if (data.lineWidth !== undefined) previous.lineWidth = prev.lineWidth ?? null;
                  if (data.metadata !== undefined) previous.metadata = prev.metadata ?? null;
                }
                updateMeasurementMutation.mutate({ id, ...data, previous });
              }}
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
              ) : (
                // Task #1832 — Multi-select delete now collapses N parallel
                // per-id `deleteMarkupMutation` calls into one bulk DELETE
                // round-trip. The server runs the removal in a transaction
                // so a mid-flight failure rolls back atomically (no
                // half-deleted group). Disabled while the bulk request is
                // in flight to keep accidental double-clicks from racing
                // against the optimistic cache strip.
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={bulkDeleteMarkupsMutation.isPending}
                  onClick={async () => {
                    try {
                      await bulkDeleteMarkupsMutation.mutateAsync(
                        selectedMarkups.map((m) => m.id),
                      );
                      close();
                    } catch (err) {
                      console.warn("[Takeoff] Failed to bulk-delete markups:", err);
                    }
                  }}
                  data-testid="button-delete-markups-bulk"
                >
                  {bulkDeleteMarkupsMutation.isPending
                    ? "Deleting..."
                    : `Delete ${selectedMarkups.length} markups`}
                </Button>
              )}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={close} data-testid="button-cancel-markup-edit">Cancel</Button>
                <MarkupStylingPopoverSaveButton
                  onSave={save}
                  updatePending={updateMarkupMutation.isPending}
                  bulkPending={bulkUpdateMarkupsMutation.isPending}
                />
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


      <PanelHost />
    </div>
    </TakeoffWorkspaceProvider>
  );
}

// ---------------------------------------------------------------------------
// Markup styling popover Save button (extracted for Task #1840 testability).
//
// The button is disabled and re-labelled "Saving..." while EITHER the
// single-update or bulk-update mutation is in flight. Locking both flags
// here prevents a future refactor from forgetting the bulk path and
// re-introducing the double-fire regression Task #1772 prevented at the
// history-stack layer (a slow bulk PATCH that left the button enabled
// could otherwise produce two MARKUP_UPDATE_BATCH entries from a single
// user intent).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-class selection mutual exclusion (extracted for Task #1884
// testability). Pure decision helper: given current and previous
// selection sizes/ids for both measurements and markups, return which
// (if any) class should be cleared so the canvas only ever has one
// "active" entity class. The caller (the `useEffect` inside
// `TakeoffWorkspace`) is responsible for actually invoking the
// setters and resetting the markup edit panel state. Keeping the
// decision pure means we can unit-test every mixed-selection edge
// case without mounting the full workspace + Konva stage.
// ---------------------------------------------------------------------------

export type CrossClassSelectionInputs = {
  selectedMeasurementId: string | null;
  selectedMeasurementIdsSize: number;
  selectedMarkupIdsSize: number;
  prevSelectedMeasurementId: string | null;
  prevSelectedMeasurementIdsSize: number;
  prevSelectedMarkupIdsSize: number;
};

export type CrossClassSelectionDecision =
  | "noop"
  | "clear-markups"
  | "clear-measurements";

export function resolveCrossClassSelection(
  inputs: CrossClassSelectionInputs,
): CrossClassSelectionDecision {
  const {
    selectedMeasurementId,
    selectedMeasurementIdsSize,
    selectedMarkupIdsSize,
    prevSelectedMeasurementId,
    prevSelectedMeasurementIdsSize,
    prevSelectedMarkupIdsSize,
  } = inputs;

  // "Grew" = the user expanded this class's selection on this render
  // (selected a new measurement, added to the multi-set, or shift-clicked
  // a new markup). Shrinking — deselecting, sheet change, escape — is
  // intentionally a no-op so we don't fight existing teardown effects.
  const measurementGrew =
    (selectedMeasurementId !== null &&
      selectedMeasurementId !== prevSelectedMeasurementId) ||
    selectedMeasurementIdsSize > prevSelectedMeasurementIdsSize;
  const markupGrew = selectedMarkupIdsSize > prevSelectedMarkupIdsSize;

  if (measurementGrew && !markupGrew && selectedMarkupIdsSize > 0) {
    return "clear-markups";
  }
  if (markupGrew && !measurementGrew) {
    return "clear-measurements";
  }
  return "noop";
}

export function MarkupStylingPopoverSaveButton({
  onSave,
  updatePending,
  bulkPending,
}: {
  onSave: () => void;
  updatePending: boolean;
  bulkPending: boolean;
}): JSX.Element {
  const isPending = updatePending || bulkPending;
  return (
    <Button
      size="sm"
      onClick={onSave}
      disabled={isPending}
      data-testid="button-save-markup-edit"
    >
      {isPending ? "Saving..." : "Save"}
    </Button>
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
