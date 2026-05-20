import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, Fragment, type ComponentProps, type DragEvent as ReactDragEvent } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text, Rect, Group } from "react-konva";
import { MarkupShapeView, type MarkupShape } from "@/components/markups/MarkupRenderer";
import {
  MARKUP_TOOLBAR_DEFAULT_COLOR,
  MARKUP_TOOLBAR_DEFAULT_THICKNESS,
  MARKUP_TOOLBAR_THICKNESSES,
} from "@/components/markups/PlanMarkupToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { getSharedScheduler } from "@/lib/takeoff/tileScheduler";
import { deferredCloseBitmap } from "@/lib/takeoff/tileCache";
import { isTileRendererEnabled } from "@/lib/takeoff/tileRendererFlag";
import { usePdfTileRenderer } from "@/hooks/use-pdf-tile-renderer";
import { rotateViewportToPageNative, viewportToWorldRect } from "@/lib/takeoff/tileCoords";
import { useTakeoffStylusPrefs } from "@/hooks/use-takeoff-stylus-prefs";
import { useStylusLongPress } from "@/hooks/use-stylus-long-press";
import { recordLongPress } from "@/lib/takeoffStylusTelemetry";
import * as pdfjsLib from 'pdfjs-dist';
import {
  createArcSegment,
  sampleArcPoints,
  computeNetAreaInFt2,
  computeDistanceInFeet,
  computeLinearWithDropFt,
  computePitchedLinearFt,
  isPointInPolygon,
} from "@shared/utils/geometry";
import { type Tool, type MeasurementType, validateHexColor, hexToRgba, TOOL_CONFIG } from "./takeoff/types";
import { applyZoneClick, applyZoneDblClick } from "./takeoff/zonePolygonDraw";
import {
  readChestPayload,
  usePinToChest,
  type ChestItemDragPayload,
} from "./takeoff/toolChest";
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
import { ToolChestHost } from "./takeoff/hosts/ToolChestHost";
import { CollabHost } from "./takeoff/hosts/CollabHost";
import { WorkspaceBottomBar } from "./takeoff/hosts/WorkspaceBottomBar";
import { TakeoffSidebar } from "./takeoff/TakeoffSidebar";
import { MeasurementTable } from "./takeoff/MeasurementTable";
import TakeoffCrossModulePanel from "./takeoff/TakeoffCrossModulePanel";
import { PageThumbnailStrip } from "./takeoff/PageThumbnailStrip";
import { TakeoffDialogs } from "./takeoff/TakeoffDialogs";
import { PlanScaleModal } from "./takeoff/PlanScaleModal";
import { InlineCalibrationDrawer } from "./takeoff/InlineCalibrationDrawer";
import { computeSheetCalibrationConfidence } from "./takeoff/sheetCalibrationConfidence";
import { ScaleHistoryPanel } from "./takeoff/ScaleHistoryPanel";
import { SheetSetsPanel } from "./takeoff/SheetSetsPanel";
import { ProjectFilesPanel } from "./takeoff/ProjectFilesPanel";
import { ToastAction } from "@/components/ui/toast";
import type { ParsedDimension } from "@/lib/takeoffTypedInput";
import { TakeoffSheetCompareDialog } from "./takeoff/TakeoffSheetCompareDialog";
import { MeasurementConflictDialog } from "./takeoff/MeasurementConflictDialog";
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
import { UnifiedTakeoffRibbon } from "./takeoff/UnifiedTakeoffRibbon";
import { TakeoffShortcutCheatSheet } from "./takeoff/TakeoffShortcutCheatSheet";
import { useTakeoffShortcuts } from "./takeoff/hosts/useTakeoffShortcuts";
import {
  ORTHO_PRESETS,
  constraintModeStorageKey,
  snapModesStorageKey,
  type ConstraintMode,
  type SnapMode,
} from "./takeoff/hosts/takeoff-shortcuts";
import { Users, Lock, Sparkles, DollarSign, Layers, Zap, TableProperties, Printer } from "lucide-react";

type TakeoffContext =
  | { type: "project"; projectId: string; projectCode: string }
  | { type: "bid"; bidId: string; bidCode: string }
  | { type: "standalone"; standaloneTakeoffId: string; standaloneTitle?: string };

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
  /** Task #2137 — When true, the workspace mounts the new horizontal
   *  Unified Ribbon (groups: Select / Measure / Annotate / Snap /
   *  Constrain / Verify / View) at the top instead of the legacy
   *  vertical `<TakeoffToolbar>` sidebar. The standalone
   *  `/takeoff/:bidCode` and `/takeoff/project/:projectCode` pages set
   *  this to true; embedded callers (bid Plans tab split-view) keep
   *  the legacy toolbar by leaving this off. Wires up the single-key
   *  shortcut hook, snap HUD, sheet `[`/`]` navigation, and the
   *  Cmd/Ctrl+/ cheat-sheet overlay. */
  unifiedRibbon?: boolean;
  /** Task #2311 — When true, auto-opens the AI Takeoff side panel on
   *  first mount. Wired from the `/takeoff/...?openAi=1` deep link the
   *  Plans-tab "AI Takeoff" call-out card produces, so users land
   *  inside the panel without an extra click. Re-applies when the
   *  prop flips from false → true (e.g. an in-app navigation that
   *  arrived with the param) but does not force the panel back open
   *  if the user has manually closed it. */
  autoOpenAiPanel?: boolean;
}

export default function TakeoffWorkspace({ projectId = "", projectCode = "", context, selectedSheetId: controlledSheetId, onSelectSheet, labeled = false, fullscreenScaleModal = false, unifiedRibbon = false, autoOpenAiPanel = false }: TakeoffWorkspaceProps) {
  const isMobile = useIsMobile();
  // Task #2312 — Below the Tailwind `lg` breakpoint (1024px) the
  // pinned right-side inspector has no room without crushing the
  // canvas, so the inspector switches to a right-edge Sheet drawer.
  // Tracks `< 1024px` (covers iPad portrait at 768px down through
  // phone widths). matchMedia drives a state flip rather than a
  // re-render-per-resize so the slice memo stays stable.
  const [isBelowLg, setIsBelowLg] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 1023px)");
    const handler = (e: MediaQueryListEvent) => setIsBelowLg(e.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, []);
  // Task #2312 — Drawer-mode visibility for the inspector on <lg
  // viewports. Auto-opens when the user picks a measurement (so the
  // tablet/phone equivalent of "select → see properties" matches
  // desktop), but stays closed when the user dismisses the drawer
  // (Esc, swipe, or tap outside) without forcing it back open until
  // the user picks a different measurement.
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<Tool>("select");
  // Auto-open the inspector drawer when a measurement is freshly
  // selected on a `<lg` viewport, and close it when the selection
  // clears. The ref tracks the last id we reacted to so that
  // dismissing the drawer (which does NOT change `selectedMeasurementId`)
  // doesn't immediately re-open it on the next render.
  const inspectorDrawerLastSelectionRef = useRef<string | null>(null);
  const [currentDrawingTool, setCurrentDrawingTool] = useState<Tool | null>(null);
  const [mobileMeasurementsOpen, setMobileMeasurementsOpen] = useState(false);
  const sheetStorageKey = context
    ? context.type === "bid"
      ? `takeoff-sheet-${context.bidId}`
      : context.type === "project"
        ? `takeoff-sheet-${context.projectId}`
        : `takeoff-sheet-standalone-${context.standaloneTakeoffId}`
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
  // Task #2653 — Bridge ref so the history hook (created before the
  // data hook) can hand a 409 version_conflict from an undo/redo
  // measurement replay into the same conflict-resolution dialog the
  // per-id PATCH path opens. The ref is populated in an effect once
  // `data.setMeasurementConflict` is available.
  const measurementConflictHandlerRef = useRef<
    ((c: import("@/hooks/use-takeoff-history").MeasurementHistoryConflict) => void) | null
  >(null);
  const takeoffHistory = useTakeoffHistory(selectedSheet, {
    onMeasurementConflict: (c) => measurementConflictHandlerRef.current?.(c),
  });
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
  // Task #2312 — Auto-open the inspector drawer when a measurement
  // is freshly selected on a `<lg` viewport, and force it closed
  // when the selection clears entirely. The ref guard ensures that
  // dismissing the drawer (which leaves `selectedMeasurementId`
  // unchanged) doesn't immediately re-open it on the next render.
  useEffect(() => {
    if (!isBelowLg) return;
    const last = inspectorDrawerLastSelectionRef.current;
    if (selectedMeasurementId && selectedMeasurementId !== last) {
      setInspectorDrawerOpen(true);
    } else if (!selectedMeasurementId && last) {
      setInspectorDrawerOpen(false);
    }
    inspectorDrawerLastSelectionRef.current = selectedMeasurementId;
  }, [selectedMeasurementId, isBelowLg]);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(null);
  const [toolBeforeSpacebar, setToolBeforeSpacebar] = useState<Tool | null>(null);
  const [isSpacebarHeld, setIsSpacebarHeld] = useState(false);
  const [pdfImage, setPdfImage] = useState<HTMLImageElement | ImageBitmap | null>(null);
  // Ghost-render guard: tag the currently-loaded `pdfImage` with the
  // `sheetId` it was rendered for. The placeholder bitmap is set from
  // two separate code paths (the legacy non-tile loader and the tile
  // renderer mirror effect) and neither used to carry sheet
  // provenance. On a fast sheet swap A → B, the mirror effect can
  // briefly hold A's bitmap while `pageDims` has already advanced to
  // B's tagged dims, causing CanvasStage's previous gate
  // (`pageDims.sheetId === currentSheet.id`) to pass while
  // `pdfImage` still points at A — which renders A's content
  // stretched into B's page rectangle, producing the duplicate /
  // ghost-image artifact reported on the takeoff canvas. Tagging the
  // bitmap lets CanvasStage cross-check provenance against
  // `currentSheet.id` and fall through to the loading skeleton until
  // both sources agree.
  const [pdfImageSheetId, setPdfImageSheetId] = useState<string | null>(null);
  // Task #2310 — pageDims carries the owning `sheetId` so the
  // auto-fit effect (and any other consumer that needs to know
  // "are these dims for the sheet currently selected?") can
  // distinguish fresh load from stale-from-previous-sheet state.
  // The PDF load effect runs async; without this tag, switching from
  // sheet A → B would briefly leave A's dims in scope and the
  // auto-fit effect would fire against A's geometry while B's name
  // is showing in the header. All existing consumers use
  // `pageDims?.width || 0` style access so adding the field is
  // type-safe and non-breaking.
  const [pageDims, setPageDims] = useState<{ width: number; height: number; sheetId: string } | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const tileRendererEnabled = useMemo(() => isTileRendererEnabled(), []);
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
  // Task #2311 — Auto-open the AI panel when the workspace mounted
  // with the `?openAi=1` deep link from the Plans-tab "AI Takeoff"
  // call-out card. Triggered on the prop transitioning to true so an
  // in-app navigation that arrives with the param while the workspace
  // is already mounted still auto-opens; we deliberately do not force
  // the panel back open if the user manually closes it.
  const autoOpenAiAppliedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenAiPanel) {
      autoOpenAiAppliedRef.current = false;
      return;
    }
    if (autoOpenAiAppliedRef.current) return;
    autoOpenAiAppliedRef.current = true;
    setAiPanelOpen(true);
  }, [autoOpenAiPanel]);
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
  // Task #2206 follow-up — narrow-viewport sidebar override. The
  // persisted `sidebarCollapsed` reflects the user's desktop preference
  // (and is what the regular toggle button mutates). On mobile / iPad
  // portrait we always start with the sidebar collapsed so the central
  // canvas actually has room to render the PDF — otherwise the
  // categories sidebar + (optional) properties panel squeeze the canvas
  // to a sliver. Tap-to-open is provided by `narrowSidebarOpen` and
  // resets every time we (re-)enter mobile mode so rotating back to
  // desktop restores the persisted preference. The properties panel is
  // simply hidden on mobile — it'd otherwise consume 288 px of the
  // already-narrow viewport.
  const [narrowSidebarOpen, setNarrowSidebarOpen] = useState(false);
  useEffect(() => {
    if (isMobile) setNarrowSidebarOpen(false);
  }, [isMobile]);
  const effectiveSidebarCollapsed = isMobile ? !narrowSidebarOpen : sidebarCollapsed;
  const effectiveToggleSidebar = isMobile
    ? () => setNarrowSidebarOpen((prev) => !prev)
    : toggleSidebarCollapsed;
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
  // Task #2140 — Inline calibration drawer (Section 5 of the
  // interaction map). `T` opens this side-anchored Sheet so the
  // canvas stays clickable for the two-point pick.
  const [calibrationDrawerOpen, setCalibrationDrawerOpen] = useState(false);
  // Task #2784 — Zone polygon drawing mode. zoneDrawingActive = user is
  // clicking vertices on the canvas; zoneDrawPoints = accumulated vertices;
  // pendingZonePoints = polygon closed, waiting for name/px-per-ft entry.
  const [zoneDrawingActive, setZoneDrawingActive] = useState(false);
  const [zoneDrawPoints, setZoneDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [pendingZonePoints, setPendingZonePoints] = useState<{ x: number; y: number }[] | null>(null);
  // Task #2793 — Zone polygon vertex-drag reshape mode.
  // editingZoneId = the zone being reshaped; editingZonePoints = mutable draft vertices.
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZonePoints, setEditingZonePoints] = useState<{ x: number; y: number }[] | null>(null);
  // Task #2325 — Scale History side panel. Holds the sheet ID it was
  // opened for so callers (drift banner, calibration drawer) can target a
  // specific sheet that may differ from the currently selected one.
  const [scaleHistorySheetId, setScaleHistorySheetId] = useState<string | null>(null);
  // Tool to restore when the calibration drawer closes — captured at
  // open time so the canvas returns to whatever the user was doing.
  const calibrationPrevToolRef = useRef<Tool>("select");
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
  // Task #2139 — Tool Chest panel toggle (View ribbon group). Persisted
  // to localStorage so the chest stays open across sheet/page navigations.
  const [toolChestOpen, setToolChestOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("takeoff-tool-chest-open") === "true";
    } catch {
      return false;
    }
  });
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
  const [hoveredMeasurementId, setHoveredMeasurementId] = useState<string | null>(null);
  const [gridEnabled, setGridEnabled] = useState(() => {
    try { return localStorage.getItem("takeoff-grid-enabled") === "true"; } catch (err) { console.warn("[Takeoff] Failed to read grid setting:", err); return false; }
  });
  const [crossModulePanelOpen, setCrossModulePanelOpen] = useState(false);
  // Task #2141 — Sheet Sets workspace state. The active set steers
  // `[` / `]` navigation (member order), unlocks the inline
  // calibration drawer's "Apply to entire Sheet Set" checkbox, and
  // surfaces the sheet-header badge. Persisted per-context so the
  // panel sticks across reloads, mirroring `takeoff-sheet-${ctxId}`.
  const sheetSetsCtxId = context
    ? context.type === "bid"
      ? `bid:${context.bidId}`
      : context.type === "project"
        ? `project:${context.projectId}`
        : null
    : projectId
      ? `project:${projectId}`
      : null;
  const sheetSetsStorageKey = sheetSetsCtxId
    ? `takeoff-active-sheet-set-${sheetSetsCtxId}`
    : null;
  const [sheetSetsPanelOpen, setSheetSetsPanelOpen] = useState(false);
  // Project Files drawer — slide-out alongside Sheet Sets that lists
  // the bid's / project's documents inline, with preview + import-to-
  // takeoff actions. Mounted only when we have a context (bid or
  // project) since both code paths need a code/id to talk to the
  // documents endpoints.
  const [projectFilesPanelOpen, setProjectFilesPanelOpen] = useState(false);
  const [activeSheetSetId, setActiveSheetSetIdState] = useState<string | null>(() => {
    if (!sheetSetsStorageKey) return null;
    try {
      return sessionStorage.getItem(sheetSetsStorageKey);
    } catch {
      return null;
    }
  });
  const setActiveSheetSetId = useCallback(
    (next: string | null) => {
      setActiveSheetSetIdState(next);
      if (sheetSetsStorageKey) {
        try {
          if (next) sessionStorage.setItem(sheetSetsStorageKey, next);
          else sessionStorage.removeItem(sheetSetsStorageKey);
        } catch {
          // storage failures are non-fatal for navigation state
        }
      }
    },
    [sheetSetsStorageKey],
  );
  // Task #2141 — Multi-sheet selection (Shift+[ / Shift+]). Tracked
  // as a Set; clears whenever the user navigates without Shift,
  // changes the active set, or clicks "Clear" in the panel.
  const [multiSheetSelection, setMultiSheetSelection] = useState<Set<string>>(
    () => new Set(),
  );
  // Task #2141 — Drawer-only state propagated from a "Calibrate set"
  // click in the SheetSetsPanel. Pre-checks the "Apply to entire
  // Sheet Set" checkbox when the inline calibration drawer opens.
  const [calibrationDefaultApplyToSet, setCalibrationDefaultApplyToSet] =
    useState(false);
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
  // Task #2630 — Programmatic group-filter request fanned into the
  // bottom MeasurementTable panel. Bumping `nonce` (with a new
  // `groupId`) lets the AI map-reduce apply-toast "Review batch"
  // action force the panel to scope to the freshly-created group
  // without reaching into MeasurementTable's internal state.
  const [measurementGroupFilterRequest, setMeasurementGroupFilterRequest] = useState<
    { groupId: string; nonce: number } | null
  >(null);
  // Task #2330 — Right-edge review-queue panel state. The count badge
  // on the bottom bar reads from `reviewQueueCountQuery` even when
  // the panel is closed, so reviewers always see the workload.
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
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
  const { isOffline, queueLength, isSyncing } = useOfflineQueue();
  // Task #2137 — Hoisted up from below so the unified-ribbon state
  // initializers can hydrate from per-user localStorage on first render.
  // The role check (canManageDrawingSetsOnCanvas) still derives from
  // this same authUser further down.
  const { user: ribbonAuthUser } = useAuth();
  const ribbonUserId = ribbonAuthUser?.id ?? null;

  // Task #2137 — Unified ribbon state. Snap is multi-select, constrain
  // is radio, ortho preset cycles via Shift+O. Persisted per-user so
  // muscle memory survives reloads; null userId (anonymous / pre-auth)
  // falls back to in-memory only.
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
  const [snapHudOpen, setSnapHudOpen] = useState(false);

  // Task #2142 — Mobile / stylus precision pass. Pulls the per-user
  // prefs (palm rejection band, stylus long-press ms, allow rotate)
  // from /api/user-settings so every consumer in the workspace —
  // PlanMarkupLayer's palm rejection, the long-press → snap HUD
  // detector below, and the gesture handlers in CanvasViewport — uses
  // the same source of truth.
  const stylusPrefs = useTakeoffStylusPrefs();
  const [orthoPresetIndex, setOrthoPresetIndex] = useState(() => ORTHO_PRESETS.length - 1);
  const [enabledSnapModes, setEnabledSnapModesState] = useState<SnapMode[]>(() => {
    const key = snapModesStorageKey(ribbonUserId);
    if (key && typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed as SnapMode[];
        }
      } catch {
        // ignore
      }
    }
    return ["endpoint", "midpoint", "intersection"];
  });
  const setEnabledSnapModes = useCallback((modes: SnapMode[]) => {
    setEnabledSnapModesState(modes);
    const key = snapModesStorageKey(ribbonUserId);
    if (key) {
      try { window.localStorage.setItem(key, JSON.stringify(modes)); } catch { /* ignore */ }
    }
  }, [ribbonUserId]);
  const [constraintMode, setConstraintModeState] = useState<ConstraintMode>(() => {
    const key = constraintModeStorageKey(ribbonUserId);
    if (key && typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(key) as ConstraintMode | null;
        if (raw === "none" || raw === "ortho" || raw === "ortho-angle" || raw === "polar") {
          return raw;
        }
      } catch {
        // ignore
      }
    }
    return "none";
  });
  const setConstraintMode = useCallback((mode: ConstraintMode) => {
    setConstraintModeState(mode);
    const key = constraintModeStorageKey(ribbonUserId);
    if (key) {
      try { window.localStorage.setItem(key, mode); } catch { /* ignore */ }
    }
  }, [ribbonUserId]);

  // Section 4 — typed-dimension input. The ribbon's "Dim Input" button
  // opens a small modal. Submitting locks the next vertex placed during
  // a drawing tool to the typed length (in feet). The hook clears the
  // value through `onConsumeDimLength` after the next click.
  //
  // Task #2203 — Polygon / segment workflows often want the same
  // length applied across several clicks in a row (e.g. typing
  // 12, 8, 12, 8 to lay out a rectangle is just "12, Tab, click,
  // change to 8, click, click, change back to 12, click"). When
  // `dimInputRepeat` is on, `onConsumeDimLength` becomes a no-op so
  // the lock survives until the user explicitly clears it.
  const [pendingDimLengthFt, setPendingDimLengthFt] = useState<number | null>(null);
  const [dimInputOpen, setDimInputOpen] = useState(false);
  const [dimInputValue, setDimInputValue] = useState("");
  const [dimInputRepeat, setDimInputRepeat] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("takeoff-dim-input-repeat") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "takeoff-dim-input-repeat",
        String(dimInputRepeat),
      );
    } catch {
      /* ignore */
    }
  }, [dimInputRepeat]);
  // Refs so the Tab keydown listener (which we only want to bind once)
  // can read the live values without re-binding on every state change.
  const dimInputRepeatRef = useRef(dimInputRepeat);
  useEffect(() => {
    dimInputRepeatRef.current = dimInputRepeat;
  }, [dimInputRepeat]);
  const pendingDimLengthFtRef = useRef<number | null>(pendingDimLengthFt);
  useEffect(() => {
    pendingDimLengthFtRef.current = pendingDimLengthFt;
  }, [pendingDimLengthFt]);
  const dimInputOpenRef = useRef(dimInputOpen);
  useEffect(() => {
    dimInputOpenRef.current = dimInputOpen;
  }, [dimInputOpen]);
  // Polar-tracking step in degrees. 15° matches the cheat-sheet spec.
  const polarAngleStep = 15;
  // Layers popover open state — quick toggle of category visibility
  // straight from the ribbon, complementing the sidebar's full UI.
  const [layersPopoverOpen, setLayersPopoverOpen] = useState(false);

  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Task #2237 — Shared canvas-focus return. CanvasViewport renders the
  // viewport `<div>` with `tabIndex=-1` and `data-testid=
  // "takeoff-canvas-viewport"`, so `.focus()` here lands on that element
  // (the same target onLayersPopoverClose has used since Task #2202).
  // Wrappers below route every "overlay just closed" path through this
  // helper so estimators don't have to re-click the canvas before the
  // single-key tool shortcuts work again.
  const focusCanvasViewport = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  // Task #2237 — Wrap setSnapHudOpen so all three close paths
  // (Esc / `S` toggle / "Close" button in the ribbon) hand keyboard
  // focus back to the canvas viewport. The Snap HUD is a plain
  // conditional render rather than a Radix Popover, so without this
  // wrapper closing leaves focus on `<body>` (or the unmounted close
  // button), and `v`/`l`/`a`/etc. wouldn't fire until the user clicked
  // the canvas again.
  const handleSetSnapHudOpen = useCallback(
    (next: boolean) => {
      setSnapHudOpen(next);
      if (!next) focusCanvasViewport();
    },
    [focusCanvasViewport],
  );

  // Task #2237 — Same treatment for the audit overlay opacity slider
  // (`data-testid="overlay-opacity-slider"`). It's another ribbon-
  // anchored transient overlay with no Radix focus management, so
  // closing via the X button or via re-pressing the View > Overlays
  // toggle previously left focus on the unmounted button.
  const handleSetShowOverlaySlider = useCallback(
    (next: boolean) => {
      setShowOverlaySlider(next);
      if (!next) focusCanvasViewport();
    },
    [focusCanvasViewport],
  );

  // Task #2142 — Stylus long-press → snap HUD. When the user holds the
  // pen tip still for `stylusLongPressMs` (within an 8 px movement
  // budget), the snap HUD pops open at the same place it appears for
  // the keyboard shortcut. Touch pointers are explicitly excluded
  // (penOnly = true, the hook's default) so taps and drags don't fire
  // the menu. Wiring lives in `useStylusLongPress` so the integration
  // test for this surface can exercise the actual production hook
  // instead of mirroring the listener bookkeeping.
  useStylusLongPress(containerRef, {
    holdMs: stylusPrefs.stylusLongPressMs,
    onLongPress: (_pt, meta) => {
      // Task #2220 — record the *measured* dwell (wall-clock elapsed
      // from pointer-down to fire) so the platform Stylus Tuning
      // dashboard surfaces real interaction behavior, not the user's
      // configured threshold. We also send the configured threshold
      // alongside so operators can correlate the two distributions.
      recordLongPress({
        pointerType: "pen",
        dwellMs: meta.measuredDwellMs,
        configuredThresholdMs: meta.configuredHoldMs,
      });
      setSnapHudOpen(true);
    },
  });

  const isMarkupTool = (tool: string) => tool.startsWith("markup_");

  const inverseRotate = (pt: { x: number; y: number }): { x: number; y: number } => {
    const w = pageDims?.width || 0;
    const h = pageDims?.height || 0;
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
    updateMeasurementMutation, unlockAndRescaleMeasurementMutation, bulkUnlockAndRescaleMeasurementsMutation, bulkUpdateMeasurementsMutation, deleteMeasurementMutation, bulkDeleteMeasurementsMutation,
    createMarkupMutation, updateMarkupMutation, bulkUpdateMarkupsMutation, deleteMarkupMutation, bulkDeleteMarkupsMutation,
    createSheetLinkMutation, deleteSheetLinkMutation, detectLinksMutation,
    saveCategoryMutation, deleteCategoryMutation,
    renameSheetMutation, duplicateSheetMutation,
    deleteSheetMutation, handleMoveSheet,
    measurementGroups, createGroupMutation, updateGroupMutation,
    deleteGroupMutation, deleteGroupWithMeasurementsMutation, toggleGroupVisibilityMutation,
    conditions, createConditionMutation, updateConditionMutation, deleteConditionMutation,
    measurementCountsPerSheet,
    // Task #2344 — Per-sheet projection of just the calibration-snapshot
    // columns we feed into `computeSheetCalibrationConfidence` below
    // so the bottom-bar chip and the sheet-selector dropdown rows can
    // each render their own four-level confidence dot.
    measurementsBySheet,
    // Task #1768 — Set of markup ids whose most-recent move PATCH was
    // rejected by the server. Used below to render a temporary red
    // glow on each rejected markup so a 50-markup batch failure
    // points the user at exactly which siblings to fix.
    failedMarkupIds,
    // Task #2723 — Measurement revision counter wired into the AI panel.
    measurementsRevision,
  } = data;

  // Task #2653 — Once `data` is realized, point the bridge ref at
  // its `setMeasurementConflict` so undo/redo measurement replays
  // that 409 hand off into the same conflict-resolution dialog the
  // per-id PATCH path opens.
  useEffect(() => {
    measurementConflictHandlerRef.current = (c) => {
      data.setMeasurementConflict({
        measurementId: c.measurementId,
        pendingEdit: { action: c.replay === "undo" ? "history_undo" : "history_redo" },
        serverRow: c.current ?? null,
        currentVersion: c.currentVersion ?? null,
        lastEditor: null,
      });
    };
    return () => {
      measurementConflictHandlerRef.current = null;
    };
  }, [data]);

  // Task #2344 — Pre-compute every sheet's calibration confidence
  // exactly once so both the sheet-selector dropdown rows and the
  // bottom-bar chip read from the same map. Keying by sheet id (a
  // stable Map) keeps each consumer's identity stable across renders
  // that don't actually change a sheet's confidence — important
  // because both the SheetSelectorBar and WorkspaceBottomBar are
  // memoised components.
  const sheetCalibrationConfidences = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeSheetCalibrationConfidence>>();
    sheets.forEach((sheet: TakeoffSheet) => {
      map.set(
        sheet.id,
        computeSheetCalibrationConfidence(
          sheet,
          measurementsBySheet.get(sheet.id) ?? [],
        ),
      );
    });
    return map;
  }, [sheets, measurementsBySheet]);

  useEffect(() => {
    if (!sheetsLoading && sheets.length > 0 && selectedSheet) {
      const exists = sheets.some((s: any) => s.id === selectedSheet);
      if (!exists) {
        setSelectedSheet(null);
      }
    }
  }, [sheetsLoading, sheets, selectedSheet]);

  // Task #2311 — Inline AI Takeoff empty-state CTA. We surface a small
  // dismissible card on top of the canvas when:
  //   1. The user has a sheet selected (the card is sheet-scoped).
  //   2. There are zero measurements on this sheet.
  //   3. There are zero AI Takeoff runs to date for this sheet (so we
  //      don't keep nagging users who tried AI and discarded the items).
  //   4. The AI panel isn't already open (no point CTA-ing into the
  //      panel while it's already on screen).
  //   5. The user hasn't dismissed the CTA for this (user, sheet) pair.
  //
  // Dismissal is persisted in localStorage under
  // `takeoff-ai-cta-dismissed:<userId>:<sheetId>` to match the existing
  // one-off dismissal pattern (`takeoff-gesture-guide-dismissed`,
  // `takeoff-hide-ai-measurements`). Per-(user, sheet) means clearing
  // a sheet's measurements and re-opening the workspace doesn't
  // resurrect a CTA the user already chose to hide for that sheet.
  const aiCtaUserId = ribbonAuthUser?.id ?? "anon";
  const aiCtaStorageKey = useMemo(
    () => (selectedSheet ? `takeoff-ai-cta-dismissed:${aiCtaUserId}:${selectedSheet}` : null),
    [aiCtaUserId, selectedSheet],
  );
  const [aiCtaDismissed, setAiCtaDismissed] = useState(false);
  useEffect(() => {
    if (!aiCtaStorageKey) {
      setAiCtaDismissed(false);
      return;
    }
    try {
      setAiCtaDismissed(localStorage.getItem(aiCtaStorageKey) === "1");
    } catch {
      setAiCtaDismissed(false);
    }
  }, [aiCtaStorageKey]);
  // Only fetch the AI history when the empty-state precondition holds
  // (sheet selected + zero measurements + not already dismissed +
  // panel not already open). Most workspace sessions therefore never
  // hit this endpoint at all — it only loads on a fresh sheet.
  const aiHistoryContextId =
    context?.type === "project" ? context.projectId :
    context?.type === "bid" ? context.bidId :
    // Task #2551 — Standalone takeoff is its own AI history bucket.
    context?.type === "standalone" ? context.standaloneTakeoffId :
    null;
  const aiHistoryContextType =
    context?.type === "bid"
      ? "bid"
      : context?.type === "standalone"
        ? "standalone"
        : "project";
  const aiCtaPreconditionMet =
    !!selectedSheet &&
    !measurementsLoading &&
    measurements.length === 0 &&
    !aiPanelOpen &&
    !aiCtaDismissed &&
    !!aiHistoryContextId;
  interface AiCtaHistoryEntry {
    id: string;
    takeoffSheetId: string | null;
  }
  const { data: aiCtaHistory, isSuccess: aiCtaHistoryLoaded } = useQuery<{ analyses: AiCtaHistoryEntry[] }>({
    queryKey: [
      `/api/ai-features/takeoff/history/${aiHistoryContextId}?type=${aiHistoryContextType}`,
    ],
    enabled: aiCtaPreconditionMet,
  });
  const aiCtaSheetHasRuns = useMemo(() => {
    if (!aiCtaHistory?.analyses || !selectedSheet) return false;
    return aiCtaHistory.analyses.some((a) => a.takeoffSheetId === selectedSheet);
  }, [aiCtaHistory, selectedSheet]);
  // Wait for the AI history query to resolve before showing the card.
  // Otherwise on the first render after a sheet switch the card would
  // briefly flash for sheets that already have prior AI runs (review
  // feedback) — `aiCtaHistory` is undefined while loading, so
  // `aiCtaSheetHasRuns` would falsely report "no runs" until the
  // request returns.
  const showAiCta = aiCtaPreconditionMet && aiCtaHistoryLoaded && !aiCtaSheetHasRuns;
  const handleDismissAiCta = useCallback(() => {
    setAiCtaDismissed(true);
    if (!aiCtaStorageKey) return;
    try {
      localStorage.setItem(aiCtaStorageKey, "1");
    } catch {
      // localStorage may be unavailable (private mode); the in-memory
      // setAiCtaDismissed above still hides the card for this session.
    }
  }, [aiCtaStorageKey]);
  const handleOpenAiFromCta = useCallback(() => {
    setAiPanelOpen(true);
  }, []);

  // Task #2330 — Workspace-wide count of measurements still flagged
  // with `needs_review = true`. Drives the "Review" pill + badge in
  // the bottom bar so reviewers always see the workload, even with
  // no sheet selected and the panel closed. The same endpoint backs
  // the panel itself, so React Query dedupes the request when the
  // panel is open. Refetches on window focus (TanStack default) so
  // the badge stays fresh as teammates flag/clear rows.
  const reviewQueueContextId =
    context?.type === "bid" ? context.bidId :
    context?.type === "project" ? context.projectId :
    projectId || null;
  const reviewQueueContextType: "bid" | "project" =
    context?.type === "bid" ? "bid" : "project";
  const reviewQueueUrl = reviewQueueContextId
    ? reviewQueueContextType === "bid"
      ? `/api/bids/${reviewQueueContextId}/takeoff/review-queue`
      : `/api/projects/${reviewQueueContextId}/takeoff/review-queue`
    : null;
  const reviewQueueKey = reviewQueueContextId
    ? reviewQueueContextType === "bid"
      ? (["/api/bids", reviewQueueContextId, "takeoff/review-queue"] as const)
      : (["/api/projects", reviewQueueContextId, "takeoff/review-queue"] as const)
    : null;
  const { data: reviewQueueData } = useQuery<{ measurements: unknown[]; count: number }>({
    queryKey: reviewQueueKey ?? ["review-queue-disabled"],
    queryFn: async () => {
      const res = await apiRequest("GET", reviewQueueUrl!);
      return res.json();
    },
    enabled: !!reviewQueueUrl,
  });
  const reviewQueueCount = reviewQueueData?.count ?? null;

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
  // Task #2137 — `authUser` is the same useAuth() hoisted above as
  // `ribbonAuthUser`; we keep the local alias so the rest of this file
  // continues to read `authUser` unchanged.
  const authUser = ribbonAuthUser;
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

  // Task #2321 — "Send to reviewer" right-click action. Calls the
  // request-review endpoint with no explicit reviewer (server fans out
  // to all org-level approvers). Invalidates both the bid review
  // summary and the queue list so the header chip and the queue page
  // reflect the new pending row immediately.
  const invalidateAfterReview = () => {
    const ctxBidId = context?.type === "bid" ? context.bidId : undefined;
    if (ctxBidId) queryClient.invalidateQueries({ queryKey: ["/api/bids", ctxBidId, "takeoff/review-summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/takeoff/review-queue"] });
    // Refresh the in-canvas measurements so the row picks up the
    // new needs_review/reviewStatus values without a page reload.
    if (selectedSheet) queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
  };
  const requestReviewMutation = useMutation({
    mutationFn: async (measurementId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${measurementId}/request-review`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterReview();
      toast({ title: "Sent for review", description: "A senior estimator has been notified." });
    },
    onError: (e: Error) => toast({ title: "Failed to send for review", description: e.message, variant: "destructive" }),
  });

  // Task #2321 — Approve / Reject from the right-click menu so
  // reviewers don't have to leave the canvas just to clear an item
  // from the queue. The dialog for capturing a rejection note is
  // owned by the queue page; from the canvas we send a generic
  // "rejected from canvas" note so the requester still sees a
  // notification (with a clear hint to check the queue page for
  // detailed reasoning if needed).
  const approveReviewMutation = useMutation({
    mutationFn: async (measurementId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${measurementId}/approve-review`, {});
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterReview();
      toast({ title: "Approved" });
    },
    onError: (e: Error) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });
  const rejectReviewMutation = useMutation({
    mutationFn: async (measurementId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/measurements/${measurementId}/reject-review`, {
        note: "Rejected from canvas — see review queue for details.",
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateAfterReview();
      toast({ title: "Rejected — requester notified" });
    },
    onError: (e: Error) => toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
  });

  // Task #2345 — Drift remediation mutations. Per-row and bulk
  // share the same invalidation set as the review queue (because
  // "mark stale" flips a measurement back into PENDING) plus the
  // sheet's measurements list (because "recapture" recomputes
  // length/area/volume on those rows). We deliberately don't surface
  // the long failure list from the bulk endpoint here — the route
  // already returns `remediated` (count) and `ids` (success), and
  // any per-row failure was logged server-side; for the toast we
  // just use the aggregate count.
  // Task #2581 — Project change-order list for the BASE/CO scope picker.
  // Only fired in project context (change orders are project-scoped). The
  // query key matches the rest of the app (`["/api/projects", code,
  // "change-orders"]`) so an in-place CO create from the project
  // dialog hot-refreshes our picker too. The list is intentionally
  // lean (`id` + `changeOrderNumber` + `description` are all the chip
  // and dialog need) — full CO rows live behind the project tab.
  const projectChangeOrdersEnabled = context?.type === "project" && !!context.projectCode;
  const { data: projectChangeOrders = [] } = useQuery<
    Array<{ id: string; changeOrderNumber: string; description?: string | null; status?: string | null }>
  >({
    queryKey: ["/api/projects", context?.type === "project" ? context.projectCode : "", "change-orders"],
    enabled: projectChangeOrdersEnabled,
  });

  // Task #2581 — Persist a measurement's BASE/CO scope tag. Backend
  // route also recomputes the parent change-order's `takeoffRollupCost`
  // when present, so we invalidate both the sheet measurements (chip
  // updates) and the project change-orders (rollup cost reflects on
  // the CO list / detail) on success.
  const moveScopeMutation = useMutation({
    mutationFn: async ({
      measurementId,
      scopeTag,
      changeOrderId,
    }: {
      measurementId: string;
      scopeTag: "BASE" | "CO";
      changeOrderId: string | null;
    }) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/measurements/${measurementId}/scope`,
        { scopeTag, changeOrderId },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateAfterReview();
      if (projectChangeOrdersEnabled) {
        queryClient.invalidateQueries({
          queryKey: ["/api/projects", context!.type === "project" ? context!.projectCode : "", "change-orders"],
        });
      }
      // Task #2581 — Also invalidate the rollup query for the affected
      // CO so an open ChangeOrderDialog reflects the new measurement
      // immediately. We can't easily know the *previous* CO id here
      // (the row's prior tag is server-side state), so we additionally
      // invalidate the rollup key prefix to refresh any cached
      // rollups for other COs the row may have just left.
      if (vars.changeOrderId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/change-orders", vars.changeOrderId, "takeoff-rollup"],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
      toast({
        title: vars.scopeTag === "CO" ? "Moved to change order" : "Moved to base bid",
        description:
          vars.scopeTag === "CO"
            ? "Measurement now rolls up under the selected CO."
            : "Measurement returned to the base-bid scope.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Move failed", description: e.message, variant: "destructive" }),
  });

  // Task #2588 — Bulk-move N measurements to BASE/CO in one round-trip.
  // Backend (`POST /api/takeoff/measurements/bulk-scope`) recomputes
  // each affected change order's `takeoffRollupCost`; we invalidate
  // the same query keys as the per-row mutation so an open
  // ChangeOrderDialog reflects the new totals immediately.
  const bulkMoveScopeMutation = useMutation({
    mutationFn: async ({
      ids,
      scopeTag,
      changeOrderId,
    }: {
      ids: string[];
      scopeTag: "BASE" | "CO";
      changeOrderId: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/takeoff/measurements/bulk-scope", {
        ids,
        scopeTag,
        changeOrderId,
      });
      return res.json();
    },
    onSuccess: (data, vars) => {
      invalidateAfterReview();
      if (projectChangeOrdersEnabled) {
        queryClient.invalidateQueries({
          queryKey: ["/api/projects", context!.type === "project" ? context!.projectCode : "", "change-orders"],
        });
      }
      if (vars.changeOrderId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/change-orders", vars.changeOrderId, "takeoff-rollup"],
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
      const n = data?.updatedCount ?? vars.ids.length;
      toast({
        title: vars.scopeTag === "CO" ? `Moved ${n} to change order` : `Moved ${n} to base bid`,
        description:
          vars.scopeTag === "CO"
            ? `${n} measurement${n === 1 ? "" : "s"} now roll up under the selected CO.`
            : `${n} measurement${n === 1 ? "" : "s"} returned to the base-bid scope.`,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Bulk move failed", description: e.message, variant: "destructive" }),
  });

  const remediateDriftMutation = useMutation({
    mutationFn: async ({ measurementId, action }: { measurementId: string; action: "recapture" | "mark_stale" }) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/measurements/${measurementId}/remediate-drift`,
        { action },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      invalidateAfterReview();
      toast({
        title: vars.action === "recapture" ? "Recaptured at current scale" : "Marked as stale",
        description:
          vars.action === "recapture"
            ? "Snapshot updated and quantities recomputed."
            : "Sent to the review queue for triage.",
      });
    },
    onError: (e: Error) => toast({ title: "Drift remediation failed", description: e.message, variant: "destructive" }),
  });
  const bulkRemediateDriftMutation = useMutation({
    mutationFn: async ({ sheetId, action }: { sheetId: string; action: "recapture" | "mark_stale" }) => {
      const res = await apiRequest(
        "POST",
        `/api/takeoff/sheets/${sheetId}/remediate-drift`,
        { action },
      );
      return res.json() as Promise<{ action: string; remediated: number; ids: string[] }>;
    },
    onSuccess: (data, vars) => {
      invalidateAfterReview();
      toast({
        title: vars.action === "recapture"
          ? `Recaptured ${data.remediated} measurement${data.remediated === 1 ? "" : "s"}`
          : `Marked ${data.remediated} measurement${data.remediated === 1 ? "" : "s"} as stale`,
      });
    },
    onError: (e: Error) => toast({ title: "Bulk drift remediation failed", description: e.message, variant: "destructive" }),
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

  // Task #2780 — load calibration zones for the current sheet so measurements
  // drawn inside a zone polygon use that zone's px/ft rather than the sheet
  // global scale. The query is keyed by selectedSheet so it refreshes
  // automatically when the user switches sheets.
  interface CalibrationZone {
    id: string;
    sheet_id: string;
    name: string;
    polygon_points: Array<{ x: number; y: number }>;
    px_per_foot: number;
  }
  const { data: calibrationZones = [] } = useQuery<CalibrationZone[]>({
    queryKey: [`/api/takeoff/sheets/${selectedSheet}/calibration-zones`],
    enabled: !!selectedSheet,
    staleTime: 30_000,
  });

  // Task #2781 — Track which calibration zone is selected (bidirectional:
  // clicking a zone polygon on the canvas selects it; clicking a zone row in
  // the CalibrationZonesPanel also selects it). Reset when the sheet changes.
  const [selectedCalibrationZoneId, setSelectedCalibrationZoneId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedCalibrationZoneId(null);
    // Task #2784 — Discard any in-progress zone polygon when the sheet
    // changes so the pending polygon cannot accidentally be saved against
    // the wrong sheet.
    setZoneDrawingActive(false);
    setZoneDrawPoints([]);
    setPendingZonePoints(null);
    // Task #2793 — Also exit vertex-drag reshape mode when switching sheets.
    setEditingZoneId(null);
    setEditingZonePoints(null);
  }, [selectedSheet]);

  const getScaleForPoint = useCallback(
    (point: { x: number; y: number }): number | undefined => {
      for (const zone of calibrationZones) {
        if (isPointInPolygon(point, zone.polygon_points)) {
          return zone.px_per_foot;
        }
      }
      return currentSheet?.scalePxPerFoot ?? undefined;
    },
    [calibrationZones, currentSheet]
  );

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
    imageWidth: pageDims?.width || 0,
    imageHeight: pageDims?.height || 0,
    onRotateCW: () => handleRotate(90),
    onRotateCCW: () => handleRotate(-90),
    structuralGridlines,
    showStructuralGridlines,
    constraintMode,
    polarAngleStep,
    pendingDimLengthFt,
    onConsumeDimLength: () => {
      // Task #2203 — Honour the dialog's "repeat / chain" mode. When
      // on, the typed length stays locked across multiple clicks so
      // users can lay out a polygon / segment polyline at a fixed
      // step (e.g. 12, 8, 12, 8 for a rectangle). Cleared explicitly
      // via the dialog's Clear button or by toggling repeat off.
      if (dimInputRepeatRef.current) return;
      setPendingDimLengthFt(null);
    },
    disableLegacyShortcuts: unifiedRibbon,
    // Task #2192 — When the unified ribbon is mounted, hand the
    // canvas drawing engine the granular snap-mode set, the
    // constraint group selection and the active ortho preset so
    // toggling individual snap modes / non-90° presets actually
    // changes how points resolve. When the ribbon isn't mounted we
    // pass `undefined` and the hook falls back to legacy
    // `snapEnabled` / `orthoLock` booleans.
    enabledSnapModes: unifiedRibbon ? enabledSnapModes : undefined,
    orthoPresetIndex: unifiedRibbon ? orthoPresetIndex : undefined,
    // Task #2142 — flow the per-user mobile/stylus prefs into the
    // pinch + touch-down handlers so palm rejection and the
    // (default-off) two-finger rotate gate read the same source of
    // truth as PlanMarkupLayer and the long-press detector.
    allowTwoFingerRotate: stylusPrefs.allowTwoFingerRotate,
    palmRejectionBandPx: stylusPrefs.palmRejectionBandPx,
    getScaleForPoint,
  });

  const {
    handleToolSelect,
    handleStageMouseDown,
    handleStageMouseUp,
    handleStageMouseMove,
    clearCursorPosition,
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
    polarGuideStep,
    runningMeasurement,
    snapStats,
    selectedMeasurementIds,
    setSelectedMeasurementIds,
    toggleMeasurementSelection,
  } = interactions;

  // Task #2785 — Derive which calibration zone the cursor is currently inside.
  // We reuse the same `isPointInPolygon` utility that `getScaleForPoint` uses so
  // the bottom-bar badge and the sidebar highlight always agree with the scale
  // that will actually be applied when the user places the next vertex.
  // `cursorPosition` is in canvas world-coordinates (same space as zone polygons)
  // so no transform is needed here.
  const activeCalibrationZone = useMemo(() => {
    if (!cursorPosition || calibrationZones.length === 0) return null;
    for (const zone of calibrationZones) {
      if (isPointInPolygon(cursorPosition, zone.polygon_points)) {
        return zone;
      }
    }
    return null;
  }, [cursorPosition, calibrationZones]);

  // Task #2141 — When a Sheet Set is active, fetch its members so
  // navigation can be re-scoped to the set's ordered list. Disabled
  // when no set is active to avoid wasted round-trips. Detail key
  // matches `SheetSetsPanel`'s `buildDetailQueryKey` so a member
  // change there invalidates this query for free.
  const { data: activeSheetSetDetail } = useQuery<{
    id: string;
    name: string;
    members: Array<{ sheetId: string; sortOrder: number }>;
  }>({
    queryKey: ["/api/takeoff/sheet-sets", activeSheetSetId],
    enabled: !!activeSheetSetId,
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/sheet-sets/${activeSheetSetId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) {
          // Set was deleted elsewhere — clear our active reference so
          // the badge / navigation reverts gracefully.
          setActiveSheetSetId(null);
          return { id: "", name: "", members: [] };
        }
        throw new Error(`Failed to load sheet set (${res.status})`);
      }
      return await res.json();
    },
    staleTime: 5_000,
  });
  // Set-aware navigation list: members in sortOrder when active and
  // non-empty, otherwise the workspace's natural sheet list. We
  // dedupe against `sheets` so members that have been deleted at the
  // sheet level (but still exist as a stale row) don't navigate to
  // a missing target.
  const navSheetList = useMemo<TakeoffSheet[]>(() => {
    if (!activeSheetSetId || !activeSheetSetDetail?.members?.length) return sheets;
    const sheetIndex = new Map(sheets.map((s) => [s.id, s] as const));
    const ordered = [...activeSheetSetDetail.members]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => sheetIndex.get(m.sheetId))
      .filter((s): s is TakeoffSheet => !!s);
    return ordered.length > 0 ? ordered : sheets;
  }, [activeSheetSetId, activeSheetSetDetail, sheets]);

  // Task #2137 / Task #2141 — Sheet navigation helpers for `[` / `]`.
  // Cycles through the active Sheet Set's ordered members when one
  // is active, otherwise falls back to the loaded sheet list.
  // Plain navigation also clears any in-flight multi-sheet
  // selection so the next bulk action only touches the new target.
  const handlePrevSheet = useCallback(() => {
    if (!navSheetList.length) return;
    const curIdx = selectedSheet ? navSheetList.findIndex((s) => s.id === selectedSheet) : -1;
    const nextIdx = curIdx <= 0 ? navSheetList.length - 1 : curIdx - 1;
    setSelectedSheet(navSheetList[nextIdx].id);
    setMultiSheetSelection(new Set());
  }, [navSheetList, selectedSheet, setSelectedSheet]);
  const handleNextSheet = useCallback(() => {
    if (!navSheetList.length) return;
    const curIdx = selectedSheet ? navSheetList.findIndex((s) => s.id === selectedSheet) : -1;
    const nextIdx = curIdx < 0 || curIdx >= navSheetList.length - 1 ? 0 : curIdx + 1;
    setSelectedSheet(navSheetList[nextIdx].id);
    setMultiSheetSelection(new Set());
  }, [navSheetList, selectedSheet, setSelectedSheet]);
  // Task #2141 — Shift+[ / Shift+] (`{` / `}`) extend a contiguous
  // multi-sheet selection through the active set's ordered list.
  // Without an active set the selection still extends through the
  // natural sheet list — handy for cross-set bulk operations on
  // smaller projects. We seed the selection with the current sheet
  // when empty so the first Shift-arrow already grabs two sheets.
  const handleExtendSheetSelection = useCallback(
    (delta: -1 | 1) => {
      if (!navSheetList.length || !selectedSheet) return;
      const curIdx = navSheetList.findIndex((s) => s.id === selectedSheet);
      if (curIdx === -1) return;
      const nextIdx = Math.max(0, Math.min(navSheetList.length - 1, curIdx + delta));
      if (nextIdx === curIdx && multiSheetSelection.size > 0) return;
      const nextSheetId = navSheetList[nextIdx].id;
      setSelectedSheet(nextSheetId);
      setMultiSheetSelection((cur) => {
        const next = new Set(cur);
        next.add(selectedSheet);
        next.add(nextSheetId);
        return next;
      });
    },
    [navSheetList, selectedSheet, setSelectedSheet, multiSheetSelection.size],
  );
  const handleExtendPrevSheet = useCallback(
    () => handleExtendSheetSelection(-1),
    [handleExtendSheetSelection],
  );
  const handleExtendNextSheet = useCallback(
    () => handleExtendSheetSelection(1),
    [handleExtendSheetSelection],
  );
  // Drop the selection if the active set changes (member list shifts
  // and the previous selection is no longer meaningful).
  useEffect(() => {
    setMultiSheetSelection(new Set());
  }, [activeSheetSetId]);

  // Task #2137 — `,` / `.` shortcuts cycle through takeoff versions for the
  // current sheet (Section 2 of docs/takeoff-interaction-map.md). We pull
  // the version list lazily, keyed on the active sheet, and treat the
  // implicit "DRAFT" working version as `null` so it sits at the head of
  // the cycle. Cycling wraps around in both directions; no-op when the
  // sheet has zero or one versions.
  const versionsQueryKey = selectedSheet
    ? ["/api/takeoff/versions", { sheetId: selectedSheet }]
    : ["__no_versions__"];
  const { data: sheetVersionsData = [] } = useQuery<Array<{ id: string }>>({
    queryKey: versionsQueryKey,
    enabled: !!selectedSheet,
    queryFn: async () => {
      const res = await fetch(
        `/api/takeoff/versions?sheetId=${encodeURIComponent(selectedSheet!)}`,
        { credentials: "include" },
      );
      if (!res.ok) return [];
      return (await res.json()) as Array<{ id: string }>;
    },
    staleTime: 30_000,
  });
  const cycleVersion = useCallback(
    (delta: 1 | -1) => {
      const list = sheetVersionsData ?? [];
      if (list.length === 0) return;
      const cycle: Array<string | null> = [null, ...list.map((v) => v.id)];
      if (cycle.length <= 1) return;
      const curIdx = cycle.indexOf(selectedVersionId);
      const safeIdx = curIdx < 0 ? 0 : curIdx;
      const nextIdx = (safeIdx + delta + cycle.length) % cycle.length;
      setSelectedVersionId(cycle[nextIdx]);
    },
    [sheetVersionsData, selectedVersionId, setSelectedVersionId],
  );
  const handlePrevVersion = useCallback(() => cycleVersion(-1), [cycleVersion]);
  const handleNextVersion = useCallback(() => cycleVersion(1), [cycleVersion]);

  // Task #2137 — Cmd/Ctrl+D duplicates the selected measurement.
  // Builds a typed payload that matches `createMeasurementMutation`'s
  // expected input rather than using `any`. The mutation handles the
  // discriminated-union narrowing internally; we just pass through the
  // optional numeric/string fields when present on the source row.
  type DuplicatePayload = Parameters<typeof createMeasurementMutation.mutate>[0];
  const handleDuplicateSelection = useCallback(() => {
    if (!selectedMeasurementId) return;
    const srcM = measurements.find((mm: TakeoffMeasurement) => mm.id === selectedMeasurementId);
    if (!srcM) return;
    const pts: Array<{ x: number; y: number }> =
      typeof srcM.points === "string"
        ? JSON.parse(srcM.points as string)
        : (srcM.points as Array<{ x: number; y: number }>);
    const offset = 20;
    const shiftedPts = pts.map((p) => ({ x: p.x + offset, y: p.y + offset }));
    const optional: Record<string, unknown> = {};
    if (srcM.depthFeet !== null && srcM.depthFeet !== undefined) optional.depthFeet = srcM.depthFeet;
    if (srcM.pitchRatio !== null && srcM.pitchRatio !== undefined) optional.pitchRatio = srcM.pitchRatio;
    if (srcM.count !== null && srcM.count !== undefined) optional.count = srcM.count;
    if (srcM.color) optional.color = srcM.color;
    if (srcM.costCodeId) optional.costCodeId = srcM.costCodeId;
    if (srcM.unitCost !== null && srcM.unitCost !== undefined) optional.unitCost = srcM.unitCost;
    const dupData = {
      sheetId: srcM.sheetId,
      type: srcM.type,
      points: shiftedPts,
      label: `${srcM.label || "Measurement"} (copy)`,
      categoryId: srcM.categoryId || undefined,
      ...optional,
    } as unknown as DuplicatePayload;
    createMeasurementMutation.mutate(dupData);
    toast({ title: "Duplicated", description: "Measurement copied with offset" });
  }, [selectedMeasurementId, measurements, createMeasurementMutation, toast]);

  // Task #2231 — bulk show/hide for the Layers ribbon popover. When
  // hiding everything, clear any selected measurement that would
  // otherwise be hidden so the canvas selection state doesn't get out
  // of sync with the visible set (mirrors the per-category handler
  // below). Declared up here (rather than next to its sibling) so the
  // takeoff shortcut hook on the next line can reference it without
  // tripping a temporal-dead-zone error. Task #2240 also wires this
  // helper to Shift+L / Shift+Alt+L for keyboard-driven bulk toggling.
  const handleSetAllCategoriesVisibility = useCallback(
    (visible: boolean) => {
      if (visible) {
        setHiddenCategoryIds(new Set());
      } else {
        setHiddenCategoryIds(new Set(categories.map((c) => c.id)));
        setSelectedMeasurementId(null);
      }
    },
    [categories],
  );

  // Task #2137 — Mount the unified-ribbon keyboard handler. Only active
  // when the standalone workspace passes `unifiedRibbon`; legacy block
  // in `useTakeoffInteractions` is gated off via `disableLegacyShortcuts`
  // so the two listeners can never fight for the same key.
  useTakeoffShortcuts({
    enabled: unifiedRibbon,
    setActiveTool,
    setConstraintMode,
    constraintMode,
    enabledSnapModes,
    setEnabledSnapModes,
    orthoPresetIndex,
    setOrthoPresetIndex,
    orthoLock,
    setOrthoLock,
    snapHudOpen,
    setSnapHudOpen: handleSetSnapHudOpen,
    setCheatSheetOpen,
    gridEnabled,
    setGridEnabled: handleToggleGrid,
    onPrevSheet: handlePrevSheet,
    onNextSheet: handleNextSheet,
    onExtendPrevSheet: handleExtendPrevSheet,
    onExtendNextSheet: handleExtendNextSheet,
    onPrevVersion: handlePrevVersion,
    onNextVersion: handleNextVersion,
    onOpenCalibrate: () => openCalibrationDrawer(),
    onUndo: () => takeoffHistory.undo(),
    onRedo: () => takeoffHistory.redo(),
    onDuplicateSelection: handleDuplicateSelection,
    onSetAllCategoriesVisibility: handleSetAllCategoriesVisibility,
    isDrawing,
    calibrationActive: calibrationMode !== "idle",
  });

  useEffect(() => {
    if (activeTool !== "select" && selectedMarkupIds.size > 0) {
      setSelectedMarkupIds(new Set());
      setMarkupEditDraft(null);
      setMarkupEditInitial(null);
    }
  }, [activeTool, selectedMarkupIds]);

  // Task #2140 — Apply a parsed dim from the HUD to the in-progress
  // draw. We translate the parsed dim into a single new (x,y) point
  // that we append to `drawingPoints`, then either keep drawing
  // (`continue`) or synthesize an Enter keypress (`finish`) so the
  // existing draw-time keyboard handler (which already knows how to
  // close polygons / commit segments / persist linears) does the
  // actual save. This keeps the typed-input path from forking the
  // measurement-creation logic.
  const commitTypedDimension = useCallback(
    (parsed: ParsedDimension, mode: "continue" | "finish") => {
      if (!isDrawing || drawingPoints.length === 0) return;
      const scale = currentSheet?.scalePxPerFoot;
      if (!scale || scale <= 0) {
        toast({
          title: "Calibrate the sheet first",
          description: "Typed dimensions need a known scale.",
          variant: "destructive",
        });
        return;
      }
      const last = drawingPoints[drawingPoints.length - 1];
      let nx = last.x;
      let ny = last.y;

      if (parsed.kind === "delta-xy") {
        nx = last.x + parsed.dxFt * scale;
        // Canvas Y axis grows downward — typed positive Δy means
        // "up the sheet" the way an estimator reads a drawing, so
        // we flip the sign to match.
        ny = last.y - parsed.dyFt * scale;
      } else {
        let angleDeg: number;
        if (parsed.kind === "length-angle") {
          angleDeg = parsed.angleDeg;
        } else {
          // Plain length — derive direction from the cursor, then
          // clamp to the active ortho preset (Section 4 final
          // paragraph: "the active preset clamps the cursor angle
          // to the nearest multiple before typed input is applied").
          const cursor = getStagePointer();
          if (cursor) {
            const dx = cursor.x - last.x;
            const dy = cursor.y - last.y;
            angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
          } else {
            angleDeg = 0;
          }
          const preset = ORTHO_PRESETS[orthoPresetIndex];
          if (preset != null) {
            angleDeg = Math.round(angleDeg / preset) * preset;
          } else if (orthoLock) {
            // Legacy ortho lock with no active preset → snap to 90.
            angleDeg = Math.round(angleDeg / 90) * 90;
          }
        }
        const lengthPx = parsed.lengthFt * scale;
        const rad = (angleDeg * Math.PI) / 180;
        nx = last.x + lengthPx * Math.cos(rad);
        ny = last.y + lengthPx * Math.sin(rad);
      }

      const next = [...drawingPoints, { x: nx, y: ny }];

      // Task #2140 round-8 — Arc has its own 3-point state machine
      // (start → mid → end) and isn't routed through `Enter` /
      // `completePolygon`. So we drive it explicitly here:
      //   - drawingPoints.length === 1 → typed dim places the
      //     middle (curvature) point. Await the next typed dim or
      //     click. Tab/Enter behave identically since arc has a
      //     fixed 3-point grammar.
      //   - drawingPoints.length === 2 → typed dim places the end
      //     point, validates collinearity, and persists via
      //     `createMeasurementMutation` exactly like the click-path
      //     branch in `use-takeoff-interactions`.
      if (
        activeTool === "arc" &&
        selectedSheet &&
        currentSheet?.scalePxPerFoot
      ) {
        if (drawingPoints.length === 1) {
          // Place mid (curvature) point, advance state.
          setDrawingPoints(next);
          return;
        }
        if (drawingPoints.length === 2) {
          const [startPoint, middlePoint] = drawingPoints;
          const endPoint = { x: nx, y: ny };
          const arcSegment = createArcSegment(
            startPoint,
            endPoint,
            middlePoint,
            currentSheet.scalePxPerFoot,
          );
          if (!arcSegment) {
            toast({
              title: "Error",
              description:
                "Points are collinear - cannot form arc. Try a different dimension.",
              variant: "destructive",
            });
            return;
          }
          const existingArcs = measurements.filter((m) => {
            if (m.type !== "LINEAR") return false;
            const pts =
              typeof m.points === "string"
                ? JSON.parse(m.points)
                : m.points;
            return Array.isArray(pts) && pts.length === 3;
          });
          createMeasurementMutation.mutate({
            sheetId: selectedSheet,
            type: "LINEAR" as const,
            points: [startPoint, middlePoint, endPoint],
            label: `Arc ${existingArcs.length + 1}`,
            categoryId: selectedCategoryId,
          } as Parameters<typeof createMeasurementMutation.mutate>[0]);
          // Arc is always a "finish" event — it has no
          // commit-and-continue analogue.
          setIsDrawing(false);
          setDrawingPoints([]);
          toast({
            title: "Arc Created",
            description: `${arcSegment.arcLength.toFixed(2)} LF`,
          });
          return;
        }
      }

      // For 2-point creators (LINEAR, LINEAR_WITH_DROP,
      // PITCHED_LINEAR) the click handler in
      // `use-takeoff-interactions` creates the measurement directly
      // on the second click — there is no Enter completion path.
      // So we have to call `createMeasurementMutation` ourselves
      // for BOTH modes:
      //   - `finish`  → persist + stop drawing (matches Enter sem.)
      //   - `continue`→ persist + reset drawingPoints to [endpoint]
      //                 so the next typed dim / click extends from
      //                 the new vertex (Tab = commit-and-continue).
      // For polygon-style tools (area / volume / pitched_area /
      // surface_area) and the segment tool the existing draw-time
      // Enter listener completes the in-progress polyline once the
      // appended point is committed; Tab there continues the draw
      // by appending the new vertex (no per-segment persistence —
      // those tools are inherently multi-point).
      const isLinearFamily =
        activeTool === "linear" ||
        activeTool === "linear_with_drop" ||
        activeTool === "pitched_linear";
      if (
        isLinearFamily &&
        selectedSheet &&
        currentSheet?.scalePxPerFoot &&
        next.length >= 2
      ) {
        const segmentPoints = [last, { x: nx, y: ny }];
        const lengthFt = computeDistanceInFeet(
          segmentPoints,
          currentSheet.scalePxPerFoot,
        );
        if (activeTool === "linear") {
          createMeasurementMutation.mutate({
            sheetId: selectedSheet,
            type: "LINEAR",
            points: segmentPoints,
            label: `Line ${measurements.length + 1}`,
            categoryId: selectedCategoryId,
          } as Parameters<typeof createMeasurementMutation.mutate>[0]);
        } else if (activeTool === "linear_with_drop") {
          const drop = parseFloat(dropDistance) || 0;
          const finalLength = computeLinearWithDropFt(lengthFt, drop);
          createMeasurementMutation.mutate({
            sheetId: selectedSheet,
            type: "LINEAR_WITH_DROP",
            points: segmentPoints,
            label: `Drop Line ${measurements.length + 1}`,
            categoryId: selectedCategoryId,
            computedLengthFt: finalLength,
          } as Parameters<typeof createMeasurementMutation.mutate>[0]);
        } else {
          const finalLength = computePitchedLinearFt(lengthFt, pitchRatio);
          createMeasurementMutation.mutate({
            sheetId: selectedSheet,
            type: "PITCHED_LINEAR",
            points: segmentPoints,
            label: `Pitched Line ${measurements.length + 1}`,
            categoryId: selectedCategoryId,
            pitchRatio,
            computedLengthFt: finalLength,
          } as Parameters<typeof createMeasurementMutation.mutate>[0]);
        }
        if (mode === "continue") {
          // Tab — commit-and-continue. Reset the in-progress
          // polyline so the next typed dim or click extends from
          // the new endpoint (NOT from the original anchor — that
          // would replay the just-saved segment).
          setDrawingPoints([{ x: nx, y: ny }]);
        } else {
          // Enter — commit-and-finish. Stop drawing entirely.
          setIsDrawing(false);
          setDrawingPoints([]);
        }
        return;
      }

      setDrawingPoints(next);

      if (mode === "finish") {
        // Defer until React commits the new drawingPoints — the
        // draw-time `keydown` effect in `use-takeoff-interactions`
        // re-binds on `drawingPoints` change so by the time our
        // synthetic Enter fires, the closure already sees the
        // appended point and will completePolygon/completeSegment.
        setTimeout(() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
        }, 0);
      }
    },
    [
      isDrawing,
      drawingPoints,
      currentSheet,
      orthoPresetIndex,
      orthoLock,
      activeTool,
      selectedSheet,
      selectedCategoryId,
      measurements.length,
      dropDistance,
      pitchRatio,
      createMeasurementMutation,
      setIsDrawing,
      setDrawingPoints,
      toast,
    ],
  );

  // Task #2140 — The HUD only listens while a measure draw is in
  // progress AND the active tool is one that consumes typed dims.
  // Notes/counts/markups don't have a "next point" to lock to.
  // (Most draw flows leave `currentDrawingTool` null — only the arc
  // tool sets it — so we key off `activeTool` here instead.)
  //
  // Arc is supported: see the arc-aware branch in
  // `commitTypedDimension` which drives the 3-point state machine
  // directly (no synthetic-Enter dispatch) so typed dimensions can
  // place the mid + end points without the click-path being the only
  // path to creation.
  const dimHudActive =
    isDrawing &&
    [
      "linear",
      "linear_with_drop",
      "pitched_linear",
      "arc",
      "area",
      "pitched_area",
      "surface_area",
      "volume",
      "segment",
      "deduct",
    ].includes(currentDrawingTool ?? activeTool);

  // Task #2203 — Pressing Tab while drawing reopens the Dim Input
  // dialog with the current locked length pre-filled, so users can
  // tweak the chained length without breaking out of the draw to
  // hunt for the ribbon button. Only active during a measure draw
  // (`dimHudActive`) and only when focus is inside the takeoff
  // workspace root (so we don't hijack Tab focus cycles in unrelated
  // panels / global UI). The typed-input HUD already swallows Tab in
  // capture phase when its own buffer is non-empty, so we never
  // compete with that flow. Suppressed when the dialog is already
  // open so Tab keeps its native focus-cycle behaviour inside the
  // dialog itself.
  useEffect(() => {
    if (!dimHudActive) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (dimInputOpenRef.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Only intercept when focus is inside the workspace (or on the
      // body itself, which is the default when Konva-managed canvas
      // surfaces aren't focusable). This keeps normal Tab focus
      // traversal working in unrelated UI / overlays that may be open.
      const root = workspaceRef.current;
      const active = (target as Node | null) ?? document.activeElement;
      const focusInsideWorkspace =
        !!root && (root === active || (active instanceof Node && root.contains(active)));
      const focusOnBody = active === document.body || active === null;
      if (!focusInsideWorkspace && !focusOnBody) return;
      event.preventDefault();
      const current = pendingDimLengthFtRef.current;
      setDimInputValue(current && current > 0 ? String(current) : "");
      setDimInputOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dimHudActive]);

  // Task #2140 — Opening the calibration drawer must also switch the
  // active tool to "calibrate", because the canvas click handler in
  // `use-takeoff-interactions.ts` gates two-point pickup on
  // `activeTool === "calibrate"`. Without this swap, opening the
  // drawer with `T` would render the side panel but canvas clicks
  // would still be routed through whatever tool was active before.
  const openCalibrationDrawer = useCallback(() => {
    // Don't overwrite the saved "previous tool" if the drawer is
    // already open (e.g. T pressed twice) — the very first open is
    // the one we want to restore back to.
    if (!calibrationDrawerOpen) {
      calibrationPrevToolRef.current = activeTool;
    }
    setCalibrationMode("first-point");
    setCalibrationPoints([]);
    setCalibrationDistance("");
    setActiveTool("calibrate");
    setCalibrationDrawerOpen(true);
  }, [
    calibrationDrawerOpen,
    activeTool,
    setCalibrationMode,
    setCalibrationPoints,
    setCalibrationDistance,
    setActiveTool,
  ]);

  // Single source of truth for "close the calibration drawer and
  // unwind all the side-effects opening it triggered". Every close
  // path (drawer's own onOpenChange, the "Use Standard Scale"
  // handoff, save-success, save-failure rollback) MUST go through
  // this helper — otherwise we leak `activeTool: "calibrate"` /
  // `calibrationMode: "first-point"` and the next stage click is
  // misinterpreted as a calibration point.
  const closeCalibrationDrawer = useCallback(() => {
    setCalibrationDrawerOpen(false);
    setCalibrationMode("idle");
    setCalibrationPoints([]);
    setCalibrationDistance("");
    setActiveTool(calibrationPrevToolRef.current);
    // Reset the per-open "default Apply to Sheet Set" hint so a
    // subsequent T-press starts unchecked again.
    setCalibrationDefaultApplyToSet(false);
    // Task #2784 — Always discard any in-progress or pending zone polygon
    // when the drawer closes so zone-draw mode never leaks into the canvas
    // after the drawer is dismissed.
    setZoneDrawingActive(false);
    setZoneDrawPoints([]);
    setPendingZonePoints(null);
    // Task #2793 — Also exit vertex-drag reshape mode when the drawer closes
    // so draggable handles never persist without save/cancel controls visible.
    setEditingZoneId(null);
    setEditingZonePoints(null);
  }, [
    setCalibrationMode,
    setCalibrationPoints,
    setCalibrationDistance,
    setActiveTool,
  ]);

  // Task #2784 — Zone polygon drawing handlers. When the user clicks
  // the "Draw Zone" button in the calibration drawer, zoneDrawingActive
  // flips to true and every subsequent canvas click appends a vertex.
  // Clicking near the first vertex (within 15 px in world coords) OR
  // double-clicking closes the polygon and moves it into pendingZonePoints
  // so the drawer can show the save form.
  const handleZoneCanvasClick = useCallback(
    (pt: { x: number; y: number }) => {
      setZoneDrawPoints(prev => {
        const result = applyZoneClick(prev, pt, stageScale);
        if (result.closedPoints) {
          setPendingZonePoints(result.closedPoints);
          setZoneDrawingActive(false);
        }
        return result.newPoints;
      });
    },
    [stageScale],
  );

  const handleZoneCanvasDblClick = useCallback(() => {
    setZoneDrawPoints(prev => {
      // Konva v9 detects double-clicks by watching two rapid mousedown→mouseup
      // pairs.  Both mousedowns fire onMouseDown → handleZoneCanvasClick, which
      // appends a vertex each time.  By the time onDblClick fires (on the
      // second mouseup) the state already has 2 extra vertices at the
      // double-click position.  Slice them off before closing the polygon so
      // the final vertex count reflects only the intentional single-click
      // vertices the user placed.
      const withoutDblExtras = prev.length >= 2 ? prev.slice(0, -2) : prev;
      const result = applyZoneDblClick(withoutDblExtras);
      if (result.closedPoints) {
        setPendingZonePoints(result.closedPoints);
        setZoneDrawingActive(false);
      }
      return result.newPoints;
    });
  }, []);

  // Task #2793 — Zone polygon vertex-drag reshape handlers.
  // handleStartZoneEdit: enters reshape mode for a zone by copying its
  // persisted polygon_points into the mutable editingZonePoints draft.
  const handleStartZoneEdit = useCallback(
    (zone: { id: string; polygon_points: Array<{ x: number; y: number }> }) => {
      setEditingZoneId(zone.id);
      setEditingZonePoints([...zone.polygon_points]);
    },
    [],
  );

  // handleZoneVertexDrag: called on every drag move from the canvas circle
  // handles; splices the new position into the draft array.
  const handleZoneVertexDrag = useCallback(
    (idx: number, pt: { x: number; y: number }) => {
      setEditingZonePoints(prev => {
        if (!prev) return prev;
        const next = [...prev];
        next[idx] = pt;
        return next;
      });
    },
    [],
  );

  // handleCancelZoneEdit: exits reshape mode and discards the draft.
  const handleCancelZoneEdit = useCallback(() => {
    setEditingZoneId(null);
    setEditingZonePoints(null);
  }, []);

  // handleSaveZoneEdit: PATCHes the updated polygon_points to the server.
  const handleSaveZoneEdit = useCallback(async () => {
    if (!editingZoneId || !editingZonePoints || editingZonePoints.length < 3) return;
    try {
      await apiRequest("PATCH", `/api/takeoff/calibration-zones/${editingZoneId}`, {
        polygonPoints: editingZonePoints,
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/takeoff/sheets/${selectedSheet}/calibration-zones`],
      });
      setEditingZoneId(null);
      setEditingZonePoints(null);
      toast({ title: "Zone polygon updated" });
    } catch {
      toast({
        title: "Failed to save zone polygon",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  }, [editingZoneId, editingZonePoints, selectedSheet, toast]);

  // Task #2141 — Calibrate-set entry point: triggered when the user
  // clicks the per-set scale chip in the SheetSetsPanel. Mark the
  // set as active (so the drawer's checkbox enables and the badge
  // appears) and pre-check the "Apply to entire Sheet Set" checkbox.
  const handleCalibrateSet = useCallback(
    (setId: string) => {
      setActiveSheetSetId(setId);
      setCalibrationDefaultApplyToSet(true);
      openCalibrationDrawer();
    },
    [setActiveSheetSetId, openCalibrationDrawer],
  );

  // Task #2228 — Pull the user's "Don't ask me again" preference for
  // the bulk-scale propagation confirmation dialog out of
  // /api/user-settings. The drawer reads this through props so the
  // dialog can be skipped on subsequent saves once the user opts out.
  // We piggy-back on the same query other consumers use so the cache
  // stays consistent and there's no extra round-trip.
  const { data: userSettingsForBulkScale } = useQuery<{
    skipBulkScalePropagationConfirm?: boolean | null;
  }>({
    queryKey: ["/api/user-settings"],
    staleTime: 60_000,
  });
  const skipBulkScalePropagationConfirm =
    userSettingsForBulkScale?.skipBulkScalePropagationConfirm === true;
  const handleSkipBulkScalePropagationConfirmChange = useCallback(
    async (skip: boolean) => {
      try {
        await apiRequest("PATCH", "/api/user-settings", {
          skipBulkScalePropagationConfirm: skip,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      } catch (err) {
        // Non-fatal: the propagation itself still goes through. Surface
        // a toast so the user knows their preference didn't persist
        // and can re-toggle next time.
        toast({
          title: "Couldn't save your preference",
          description:
            "We applied the scale but couldn't remember your “Don't ask me again” choice.",
          variant: "destructive",
        });
        console.warn(
          "[Takeoff] Failed to PATCH skipBulkScalePropagationConfirm:",
          err,
        );
      }
    },
    [toast],
  );

  // Task #2141 — Push the calibrated scale to every member of the
  // active set, then surface an Undo toast that POSTs to
  // /restore-scales with the priorScales snapshot the apply-scale
  // endpoint returned. The toast is the only place per-sheet prior
  // values exist post-PATCH, so we pass them in by closure rather
  // than re-fetching.
  const handleApplyScaleToSheetSet = useCallback(
    async (input: { setId: string; scalePxPerFoot: number }) => {
      try {
        const res = await apiRequest(
          "POST",
          `/api/takeoff/sheet-sets/${input.setId}/apply-scale`,
          { scalePxPerFoot: input.scalePxPerFoot },
        );
        const data = (await res.json()) as {
          updatedSheets: number;
          priorScales: Array<{
            sheetId: string;
            scalePxPerFoot: number | null;
            scaleLabel: string | null;
          }>;
        };
        // Refresh sheets so the sheet selector / badges pick up the
        // new scales without a hard reload.
        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
        queryClient.invalidateQueries({
          queryKey: ["/api/takeoff/sheet-sets", input.setId],
        });
        toast({
          title: `Scale applied to ${data.updatedSheets} sheet${data.updatedSheets === 1 ? "" : "s"}`,
          description: "All members of the Sheet Set now share this calibration.",
          action: data.priorScales.length > 0 ? (
            <ToastAction
              altText="Undo apply scale"
              data-testid="button-undo-apply-sheet-set-scale"
              onClick={async () => {
                try {
                  await apiRequest(
                    "POST",
                    `/api/takeoff/sheet-sets/${input.setId}/restore-scales`,
                    // Server schema names the field `sheets` — keep
                    // the wire shape in lockstep so the Undo round-
                    // trip doesn't 400 against a renamed key.
                    { sheets: data.priorScales },
                  );
                  queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets"] });
                  queryClient.invalidateQueries({
                    queryKey: ["/api/takeoff/sheet-sets", input.setId],
                  });
                  toast({
                    title: "Apply-scale reverted",
                    description: "Per-sheet calibrations restored.",
                  });
                } catch (err) {
                  toast({
                    title: "Could not undo apply-scale",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                }
              }}
            >
              Undo
            </ToastAction>
          ) : undefined,
        });
      } catch (err) {
        toast({
          title: "Could not apply scale to sheet set",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [toast],
  );

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

  // Task #2657 — Broadcast the local user's currently-focused
  // measurement to peers over the existing collab WebSocket so the
  // properties panel can render a "Jane is editing this measurement"
  // indicator BEFORE a save-time conflict happens. Re-broadcast on
  // sheet change too so a peer who joins mid-edit still sees the
  // sheet context. Cleared on unmount so a closed tab doesn't leave
  // a phantom indicator behind (server-side stale aging is the
  // belt-and-braces fallback if the close packet is dropped).
  useEffect(() => {
    collab.broadcastMeasurementFocus(selectedMeasurementId, selectedSheet);
    return () => {
      collab.broadcastMeasurementFocus(null, null);
    };
  }, [selectedMeasurementId, selectedSheet, collab.broadcastMeasurementFocus]);

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

  // Note: `handleSetAllCategoriesVisibility` (the bulk show/hide helper
  // for the Layers popover and the Shift+L / Shift+Alt+L keyboard
  // shortcuts) lives near the takeoff shortcut hook above so it can
  // be passed to that hook without a temporal-dead-zone error.

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
        pts = [computeAiPosition(aiIdx, pageDims?.width || 2000)];
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
    if (!measurements.length || !pageDims?.width) return;
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
      const pos = computeAiPosition(aiIdx, (pageDims?.width || 0));
      const mId = m.id;
      backfilledAiIdsRef.current.add(mId);
      updateMeasurementMutation.mutate(
        { id: mId, points: JSON.stringify([pos]) },
        { onError: () => { backfilledAiIdsRef.current.delete(mId); } }
      );
    });
  }, [measurements, pdfImage]);

  // Recalibrate AI measurements that were imported with pdfImage (low-res bitmap)
  // dimensions instead of pageDims (canvas world-coordinate) dimensions. This
  // corrects the "cluster at top-left" artifact that occurs when the tile renderer
  // is active because pdfImage.width << pageDims.width. Runs once per measurement
  // ID (tracked in recalibratedAiIdsRef) so it does not fight with user drags.
  const recalibratedAiIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!measurements.length || !pageDims?.width || !pageDims?.height) return;
    if (!pdfImage?.width || !pdfImage?.height) return;
    const scaleRatio = pageDims.width / pdfImage.width;
    // Only run when there is a meaningful mismatch (tile renderer path enlarges
    // the world-coordinate space relative to the low-res placeholder bitmap).
    if (scaleRatio < 1.5) return;

    const imgW = pageDims.width;
    const imgH = pageDims.height;
    const allAiCount = measurements.filter(mm => mm.source === "AI" && mm.type === "COUNT");

    const toFix = measurements.filter(m => {
      if (m.source !== "AI") return false;
      if (recalibratedAiIdsRef.current.has(m.id)) return false;
      const pts = parseMeasurementPoints(m);
      if (pts.length === 0) return false; // handled by the empty-points backfill above

      // COUNT badge: computeAiPosition(idx, pdfImage.width) puts x ≈ pdfImage.width +
      // small offset, which is much less than pageDims.width. Threshold: 3× the
      // low-res width to give headroom for a few columns.
      if (m.type === "COUNT" && pts.length === 1) {
        return pts[0].x < pdfImage.width * 3;
      }

      // AREA / LINEAR imported from a bounding box: if stored max-x is within the
      // low-res bitmap range the coordinates are at the wrong scale.
      if (m.type === "AREA" || m.type === "LINEAR") {
        let meta: Record<string, unknown> = {};
        try { meta = typeof m.metadata === "string" ? JSON.parse(m.metadata) : (m.metadata || {}); } catch {}
        if (!meta.boundingBox) return false;
        const maxX = Math.max(...pts.map((p: { x: number }) => p.x));
        return maxX < (pdfImage.width as number) * 1.1;
      }
      return false;
    });

    if (toFix.length === 0) return;

    // Build the full set of patches before touching recalibratedAiIdsRef so
    // we can roll back cleanly on per-item failure.
    const patches: Array<{ id: string; points: string }> = [];
    for (const m of toFix) {
      let newPoints: Array<{ x: number; y: number }>;
      if (m.type === "COUNT") {
        const aiIdx = allAiCount.findIndex(mm => mm.id === m.id);
        newPoints = [computeAiPosition(Math.max(0, aiIdx), imgW)];
      } else {
        let meta: Record<string, unknown> = {};
        try { meta = typeof m.metadata === "string" ? JSON.parse(m.metadata) : (m.metadata || {}); } catch {}
        const bbox = meta.boundingBox as { x: number; y: number; w: number; h: number };
        const x1 = (bbox.x / 100) * imgW;
        const y1 = (bbox.y / 100) * imgH;
        const x2 = x1 + (bbox.w / 100) * imgW;
        const y2 = y1 + (bbox.h / 100) * imgH;
        if (m.type === "LINEAR") {
          const isWide = (x2 - x1) >= (y2 - y1);
          if (isWide) {
            const midY = (y1 + y2) / 2;
            newPoints = [{ x: x1, y: midY }, { x: x2, y: midY }];
          } else {
            const midX = (x1 + x2) / 2;
            newPoints = [{ x: midX, y: y1 }, { x: midX, y: y2 }];
          }
        } else {
          newPoints = [
            { x: x1, y: y1 }, { x: x2, y: y1 },
            { x: x2, y: y2 }, { x: x1, y: y2 },
          ];
        }
      }
      patches.push({ id: m.id, points: JSON.stringify(newPoints) });
    }

    // Mark all IDs before firing so concurrent renders don't re-enqueue them.
    patches.forEach(p => recalibratedAiIdsRef.current.add(p.id));

    // Fire all PATCHes in parallel — bypassing updateMeasurementMutation so
    // we get exactly ONE cache invalidation at the end instead of N
    // (updateMeasurementMutation.onSuccess calls invalidateQueries per-item,
    // causing N sequential measurement fetches for a single calibration pass).
    Promise.all(
      patches.map(({ id, points }) =>
        apiRequest("PATCH", `/api/takeoff/measurements/${id}`, { points })
          .catch(() => { recalibratedAiIdsRef.current.delete(id); })
      )
    ).then(() => {
      if (selectedSheet) {
        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      }
    });
  }, [measurements, pageDims, pdfImage, selectedSheet]);

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
    const scaleX = sw / ((pageDims?.width || 0) * (1 + padding * 2));
    const scaleY = sh / ((pageDims?.height || 0) * (1 + padding * 2));
    const targetScale = Math.min(scaleX, scaleY, 10);
    const targetPos = {
      x: (sw - (pageDims?.width || 0) * targetScale) / 2,
      y: (sh - (pageDims?.height || 0) * targetScale) / 2,
    };
    animateToPosition(targetScale, targetPos);
  };

  // Task #2310 — Auto-fit on first load per sheet.
  //
  // Without this, opening a sheet that the workspace previously
  // remembered at 25% zoom + a deep pan offset (or simply: a sheet
  // whose page is much larger than the canvas at 1×) would render the
  // PDF correctly but place it entirely outside the visible viewport,
  // leaving the user staring at a grid + ruler with no PDF and
  // assuming the file failed to load.
  //
  // We auto-fit exactly once per `currentSheet.id` for the lifetime
  // of this workspace mount. Each sheet revision is its own
  // `sheets.id` row, so revising a sheet naturally produces a new
  // fit. Manual pan/zoom afterwards is preserved — the ref-set
  // membership prevents re-firing on subsequent renders, viewport
  // resizes, measurement edits, markup updates, etc.
  const autoFittedSheetIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sheetId = currentSheet?.id;
    if (!sheetId) return;
    if (autoFittedSheetIdsRef.current.has(sheetId)) return;
    if (!pageDims || !pdfImage) return;
    // Critical race guard: on a sheet swap, `pdfImage` / `pageDims`
    // briefly hold the previous sheet's data before the async PDF
    // load resolves for the new sheet. Without this check, we would
    // (a) auto-fit using the old sheet's geometry and (b) mark the
    // new sheetId as already-fitted, suppressing the real first-fit
    // when the new sheet's PDF actually arrives. `pageDims.sheetId`
    // is set inside the PDF load effect alongside the dims, so it
    // always reflects which sheet owns the currently-loaded asset.
    if (pageDims.sheetId !== sheetId) return;
    if (stageDimensions.width <= 0 || stageDimensions.height <= 0) return;
    autoFittedSheetIdsRef.current.add(sheetId);
    zoomToFitRef.current();
  }, [
    currentSheet?.id,
    pageDims,
    pdfImage,
    stageDimensions.width,
    stageDimensions.height,
  ]);

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
      const url = context?.type === "standalone"
        ? `/api/takeoff/standalone/${context.standaloneTakeoffId}/all-measurements`
        : context?.type === "bid"
          ? `/api/bids/${context.bidId}/takeoff/all-measurements`
          : `/api/projects/${projectId}/takeoff/all-measurements`;
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
      const url = context?.type === "standalone"
        ? `/api/takeoff/standalone/${context.standaloneTakeoffId}/all-measurements`
        : context?.type === "bid"
          ? `/api/bids/${context.bidId}/takeoff/all-measurements`
          : `/api/projects/${projectId}/takeoff/all-measurements`;
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
      const url = context?.type === "standalone"
        ? `/api/takeoff/standalone/${context.standaloneTakeoffId}/all-measurements`
        : context?.type === "bid"
          ? `/api/bids/${context.bidId}/takeoff/all-measurements`
          : `/api/projects/${projectId}/takeoff/all-measurements`;
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

  // Task #2138: pdfjs lives ONLY in the dedicated worker after this task.
  // The shared scheduler owns the worker pool and orchestrates page loads,
  // tile renders, thumbnail renders, and text extraction.
  //
  // `getSharedScheduler()` returns null in environments that don't expose
  // `Worker` (jsdom unit tests, very old browsers). In that case the
  // workspace surfaces an error toast on first sheet load instead of
  // crashing — there is no main-thread pdfjs path because the task
  // explicitly requires pdfjs to live only in the worker.
  const tileScheduler = useMemo(() => getSharedScheduler(), []);
  const placeholderCacheRef = useRef<Map<string, ImageBitmap>>(new Map());
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const [pdfLoadProgress, setPdfLoadProgress] = useState(0);

  // Legacy fallback path only: when the tile flag is OFF we still need a
  // full-page bitmap so the canvas has something to draw. When the flag
  // is ON, `usePdfTileRenderer` owns the placeholder lifecycle (single
  // 0.25× bucket render) and we forward its bitmap into `pdfImage` via
  // an effect below — no second worker call. pdfjs runs in the worker
  // either way (task constraint).
  const renderFullPagePlaceholder = useCallback(async (
    sheetId: string,
    pdfUrl: string,
    pageIndex: number,
  ): Promise<{ bitmap: ImageBitmap; width: number; height: number }> => {
    if (!tileScheduler) {
      throw new Error("PDF worker is not supported in this browser.");
    }
    const cacheKey = `${sheetId}-${pageIndex}`;
    const cached = placeholderCacheRef.current.get(cacheKey);
    if (cached) {
      placeholderCacheRef.current.delete(cacheKey);
      placeholderCacheRef.current.set(cacheKey, cached);
      const dims = await tileScheduler.getPageDims(pdfUrl, pageIndex);
      return { bitmap: cached, width: dims.width, height: dims.height };
    }
    const res = await tileScheduler.renderPlaceholder(pdfUrl, pageIndex, 1);
    placeholderCacheRef.current.set(cacheKey, res.bitmap);
    if (placeholderCacheRef.current.size > 12) {
      const firstKey = placeholderCacheRef.current.keys().next().value;
      if (firstKey) {
        const stale = placeholderCacheRef.current.get(firstKey);
        placeholderCacheRef.current.delete(firstKey);
        // Defer past two RAFs — Konva may still hold this bitmap as
        // the active `pdfImage` reference for one more frame after
        // the LRU mutation. Sync close → "image source is detached".
        deferredCloseBitmap(stale);
      }
    }
    return { bitmap: res.bitmap, width: res.width, height: res.height };
  }, [tileScheduler]);

  useEffect(() => {
    if (!currentSheet?.imageUrl) {
      setPdfImage(null);
      setPdfImageSheetId(null);
      setPageDims(null);
      return;
    }

    // Ghost-render guard: synchronously drop any prior sheet's bitmap
    // and dims at the very top of every load. Without this, switching
    // from sheet A to sheet B leaves A's `pdfImage` and `pageDims` in
    // scope for the entire async window (getPageDims → tile placeholder
    // arrival), and the canvas keeps painting A under B's loading
    // indicators. The downstream `setIsPdfLoading(true)` only paints a
    // *progress bar* over the stale bitmap; it does not blank the
    // canvas. Clearing here guarantees the loading skeleton path in
    // CanvasStage takes over immediately on sheet swap.
    setPdfImage(null);
    setPdfImageSheetId(null);
    setPageDims(null);

    let cancelled = false;
    const loadPDF = async () => {
      try {
        setIsPdfLoading(true);
        setPdfLoadProgress(10);
        const pdfUrl = `/api/takeoff/sheets/${currentSheet.id}/pdf`;
        setPdfLoadProgress(30);

        if (tileRendererEnabled) {
          // Tile mode: don't render the placeholder here — the hook
          // does it. We only need page dims so the rest of this effect
          // (text extraction, prewarm) and downstream code that reads
          // `pageDims` can proceed without waiting for the bitmap.
          if (!tileScheduler) {
            throw new Error("PDF worker is not supported in this browser.");
          }
          const dims = await tileScheduler.getPageDims(
            pdfUrl,
            currentSheet.sheetIndex || 0,
          );
          if (cancelled) return;
          setPageDims({ width: dims.width, height: dims.height, sheetId: currentSheet.id });
          setPdfLoadProgress(80);
          // `pdfImage` and `setIsPdfLoading(false)` are driven by the
          // mirroring effect below once `tileRenderer.placeholder`
          // arrives.
        } else {
          const res = await renderFullPagePlaceholder(
            currentSheet.id,
            pdfUrl,
            currentSheet.sheetIndex || 0,
          );
          if (cancelled) {
            // Bitmap is owned by `placeholderCacheRef`; closing here
            // would invalidate the cached entry.
            return;
          }
          setPdfLoadProgress(80);
          setPdfImage(res.bitmap);
          setPdfImageSheetId(currentSheet.id);
          setPageDims({ width: res.width, height: res.height, sheetId: currentSheet.id });
          setPdfLoadProgress(100);
          setIsPdfLoading(false);
        }

        if (!currentSheet.scalePxPerFoot) {
          try {
            const latestSheets = sheetsRef.current;
            const uncalibratedSheets = latestSheets.filter((s: any) => !s.scalePxPerFoot && s.imageUrl);
            const batchInput: Array<{ id: string; textItems: string[] }> = [];
            const textResults = await Promise.all(
              uncalibratedSheets.map(async (s: any) => {
                try {
                  if (!tileScheduler) return null;
                  const sPdfUrl = `/api/takeoff/sheets/${s.id}/pdf`;
                  const r = await tileScheduler.getTextItems(sPdfUrl, s.sheetIndex || 0);
                  return { id: s.id as string, textItems: r.items };
                } catch (err) {
                  console.warn(`[Takeoff] Failed to extract text for scale detection:`, err);
                  return null;
                }
              }),
            );
            for (const r of textResults) {
              if (r) batchInput.push(r);
            }
            if (!cancelled && batchInput.length > 0) {
              const batchResults = detectScaleBatch(batchInput);
              const currentResult = batchResults.get(currentSheet.id);
              if (currentResult) setDetectedScale(currentResult);
            }
          } catch (textErr) {
            console.warn("Could not extract text from PDF for scale detection:", textErr);
          }
        }

        // Pre-warm placeholders for adjacent sheets so a sheet flip is
        // instant. The 30-second grace clock stops any prefetch that
        // hasn't started yet — bounded so we don't keep paying for
        // unused work after the user has settled on a sheet.
        const latestSheets = sheetsRef.current;
        const currentIdx = latestSheets.findIndex((s: TakeoffSheet) => s.id === currentSheet.id);
        const adjacentIndices = [currentIdx - 1, currentIdx + 1, currentIdx + 2].filter(i => i >= 0 && i < latestSheets.length);
        for (const idx of adjacentIndices) {
          const adjSheet = latestSheets[idx] as any;
          if (!adjSheet?.imageUrl) continue;
          const adjPdfUrl = `/api/takeoff/sheets/${adjSheet.id}/pdf`;
          const adjPageIndex = adjSheet.sheetIndex || 0;
          if (tileRendererEnabled) {
            // Prime the worker doc/page cache cheaply so the hook's
            // 0.25× placeholder render is fast on visit. No bitmap is
            // produced here — that would duplicate the hook's work.
            tileScheduler?.getPageDims(adjPdfUrl, adjPageIndex).catch(() => undefined);
          } else {
            const k = `${adjSheet.id}-${adjPageIndex}`;
            if (!placeholderCacheRef.current.has(k)) {
              renderFullPagePlaceholder(adjSheet.id, adjPdfUrl, adjPageIndex).catch(() => undefined);
            }
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading PDF:", error);
        setIsPdfLoading(false);
        setPdfLoadProgress(0);
        // Task #2298 follow-up — the previous toast was a bare
        // "Failed to load PDF. The file may not be a valid PDF
        // document." which gives the user no actionable signal.
        // 1) Suppress the toast for benign races (worker shutdown
        //    on unmount, AbortError from a fast sheet flip).
        // 2) For everything else, include the failing sheet name
        //    and the underlying error message so the user can
        //    report it (and so a 404 from the server like
        //    "No PDF file available for this sheet. Please re-import
        //    the document." actually surfaces instead of being
        //    masked by the generic message).
        const rawMessage = error instanceof Error ? error.message : String(error ?? "");
        const isBenignRace =
          rawMessage.includes("AbortError") ||
          rawMessage.includes("Worker was terminated") ||
          rawMessage.includes("Worker terminated") ||
          rawMessage.includes("worker is not supported") ||
          rawMessage.includes("Rendering cancelled");
        if (isBenignRace) return;
        // pdf.js wraps server JSON errors in messages like
        //   "Unexpected server response (404) while retrieving PDF ..."
        // Try to fetch the server's `error` field so we surface the
        // real reason ("No PDF file available", "Access denied", etc.)
        // instead of the pdf.js wrapper.
        let serverDetail: string | null = null;
        try {
          const probe = await fetch(`/api/takeoff/sheets/${currentSheet.id}/pdf`, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          if (!probe.ok) {
            const ct = probe.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const body = await probe.json().catch(() => null);
              if (body && typeof body.error === "string") serverDetail = body.error;
            }
            if (!serverDetail) serverDetail = `Server returned ${probe.status}`;
          }
        } catch {
          /* probe failed too — fall through to the raw error */
        }
        const sheetName = currentSheet.sheetName || "this sheet";
        const detail = serverDetail || rawMessage || "The file may not be a valid PDF document.";
        toast({
          title: `Couldn't load "${sheetName}"`,
          description: detail,
          variant: "destructive",
        });
      }
    };

    loadPDF();
    setDetectedScale(null);
    return () => { cancelled = true; };
  }, [currentSheet?.id, currentSheet?.imageUrl, currentSheet?.sheetName, toast, renderFullPagePlaceholder, tileScheduler, tileRendererEnabled]);

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

  // Task #2139 — Tool Chest wiring
  //
  // The chest is a per-user pinned shelf surfaced as a left-side panel
  // (PanelHost), toggled from the View ribbon group, and populated via
  // (a) right-click "Pin" affordances on ribbon tools / sidebar
  // conditions, and (b) drag-from-chest → drop-on-canvas activations.
  // Everything funnels through `usePinToChest` + `readChestPayload`
  // and the `(kind, refId)` pointer protocol so item identity stays
  // consistent across rename/color overrides.
  const pinToChestMutation = usePinToChest({
    onSuccess: (item) => {
      toast({
        title: "Pinned to Tool Chest",
        description: item.label || "Item added to your chest",
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Failed to pin item";
      // Server returns 409 on duplicate (unique on user+kind+itemId).
      const isDup = /already.*pinned|409|duplicate/i.test(msg);
      toast({
        title: isDup ? "Already in Tool Chest" : "Pin Failed",
        description: isDup ? "This item is already in your chest." : msg,
        variant: isDup ? "default" : "destructive",
      });
    },
  });

  const handleToggleToolChest = useCallback(() => {
    setToolChestOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem("takeoff-tool-chest-open", next ? "true" : "false"); } catch { /* noop */ }
      return next;
    });
  }, []);

  const handlePinToolToChest = useCallback(
    (input: { toolId: string; label: string }) => {
      pinToChestMutation.mutate({
        kind: "tool",
        refId: input.toolId,
        label: input.label,
      });
    },
    [pinToChestMutation],
  );

  const handlePinConditionToChest = useCallback(
    (cond: TakeoffCondition) => {
      pinToChestMutation.mutate({
        kind: "condition",
        refId: cond.id,
        label: cond.name,
        color: cond.color || null,
      });
    },
    [pinToChestMutation],
  );

  const handleChestItemDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const payload: ChestItemDragPayload | null = readChestPayload(e.dataTransfer);
      if (!payload) return;
      // Style pre-applied: chest items carry an optional per-row color
      // override. Apply it to the active markup color *before* switching
      // tools so the next stroke is drawn in the chest item's color
      // (matches Task #2139 "drag-to-canvas activation w/ style
      // pre-applied"). For conditions, `handleActivateCondition` keeps
      // its own intrinsic color contract; we still update the markup
      // toolbar swatch so the user sees the same color the chest swatch
      // showed.
      if (payload.color) {
        setMarkupColor(payload.color);
      }
      if (payload.kind === "tool") {
        // Tool chest items map 1:1 to canvas tools.
        setActiveTool(payload.refId as Tool);
      } else if (payload.kind === "condition") {
        const cond = conditions.find((c: TakeoffCondition) => c.id === payload.refId);
        if (cond) {
          handleActivateCondition(cond);
        } else {
          toast({
            title: "Condition Missing",
            description: "The pinned condition no longer exists.",
            variant: "destructive",
          });
        }
      } else if (payload.kind === "assembly") {
        // Standalone takeoff workspace doesn't host the assembly
        // insert dialog; the bid-estimate workspace will wire that
        // path. Surface a hint instead of silently no-op'ing.
        toast({
          title: "Open in Bid",
          description: "Assemblies activate inside a bid estimate.",
        });
      }
    },
    [conditions, handleActivateCondition, setMarkupColor, toast],
  );

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
    toolChestOpen,
    onToggleToolChest: handleToggleToolChest,
    onPinToolToChest: handlePinToolToChest,
  }), [
    activeTool, handleToolSelect, stageScale, selectedMeasurementId, measurements,
    deleteMeasurementMutation, takeoffHistory, snapEnabled, orthoLock,
    aiPanelOpen, mobileMeasurementsOpen, isDrawing, drawingPoints, isMobile,
    markupColor, markupThickness, handleExportCurrentSheet, handleExportAllSheets,
    handleExportQuantityDelta, handleExportBidPackage, handlePrintSheet, isOffline,
    sheetRotation, handleRotate, gridEnabled, handleToggleGrid, isCalibrated,
    showMeasurementLabels, showStructuralGridlines, labeled,
    toolChestOpen, handleToggleToolChest, handlePinToolToChest,
  ]);
  const handleAcceptDetectedScale = useCallback(async () => {
    if (!selectedSheet || !detectedScale) return;
    try {
      // Task #2320 — accepting an auto-detected scale records source
      // AI_DETECTED and maps the detector's qualitative confidence
      // ("high"/"medium"/"low") onto the canonical
      // HIGH/MEDIUM/LOW provenance enum. Unknown values fall back to
      // UNVERIFIED so the drift banner still surfaces.
      const detectorConfidence: string =
        detectedScale.confidence === "high"
          ? "HIGH"
          : detectedScale.confidence === "medium"
            ? "MEDIUM"
            : detectedScale.confidence === "low"
              ? "LOW"
              : "UNVERIFIED";
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, {
        scalePxPerFoot: detectedScale.pxPerFoot,
        units: detectedScale.units,
        scaleLabel: detectedScale.label,
        scaleSource: "AI_DETECTED",
        scaleConfidence: detectorConfidence,
      });
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      toast({ title: "Scale Applied", description: `Auto-detected scale ${detectedScale.label} applied` });
      setDetectedScale(null);
    } catch (err) {
      console.warn("[Takeoff] Failed to apply detected scale:", err);
      toast({ title: "Error", description: "Failed to apply detected scale", variant: "destructive" });
    }
  }, [selectedSheet, detectedScale, sheetsQueryKey, toast]);

  const pinControlsForSelectorBar = useMemo(() => {
    if (!canManageDrawingSetsOnCanvas || !activeCanvasSetId || !currentSheet) return null;
    const pinnedItem = activeCanvasSetItemMap.get(currentSheet.id);
    const isPinned = pinnedSheetIdsForStrip.has(currentSheet.id);
    const latestId = getLatestRevisionForCanvasSheet(currentSheet.id);
    return {
      isPinned,
      setLabel: activeCanvasSetName || "active set",
      hasPinnedItem: !!pinnedItem,
      hasLatestRevision: !!latestId,
      onPin: () => {
        canvasPinSheetMutation.mutate({ setId: activeCanvasSetId, sheetId: currentSheet.id });
      },
      onUnpin: () => {
        if (!pinnedItem) return;
        canvasUnpinSheetMutation.mutate({ setId: activeCanvasSetId, itemId: pinnedItem.id });
      },
      onUseLatestRevision: () => {
        if (!pinnedItem || !latestId) return;
        canvasSwapPinnedRevisionMutation.mutate({
          setId: activeCanvasSetId,
          oldItemId: pinnedItem.id,
          newSheetId: latestId,
        });
      },
      pinPending: canvasPinSheetMutation.isPending,
      unpinPending: canvasUnpinSheetMutation.isPending,
      swapPending: canvasSwapPinnedRevisionMutation.isPending,
    };
  }, [
    canManageDrawingSetsOnCanvas, activeCanvasSetId, currentSheet,
    activeCanvasSetItemMap, pinnedSheetIdsForStrip, activeCanvasSetName,
    getLatestRevisionForCanvasSheet,
    canvasPinSheetMutation, canvasUnpinSheetMutation, canvasSwapPinnedRevisionMutation,
  ]);

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
    // Task #2320 — drift banner. The fields land on `currentSheet`
    // via the `/api/takeoff/sheets` projection (extended above);
    // when a sheet supersede copied scale forward without
    // re-verification, source flips to `INHERITED_FROM_PARENT` and
    // confidence to `UNVERIFIED` — that combination is what we
    // surface here. Both CTAs route through the same calibration
    // drawer entry point so the user lands in a Section-5 grammar
    // flow either way; "Verify" is conceptually the same action,
    // it just signals intent.
    scaleDrift: {
      visible:
        currentSheet?.scaleSource === "INHERITED_FROM_PARENT" &&
        currentSheet?.scaleConfidence === "UNVERIFIED",
      scaleLabel: currentSheet?.scaleLabel ?? null,
      onVerify: openCalibrationDrawer,
      onRecalibrate: openCalibrationDrawer,
      // Task #2325 — drift banner needs an audit trail entry point.
      // No-ops if the sheet has been deselected mid-render so the
      // banner click never accidentally opens the panel for `null`.
      onShowHistory: () => {
        if (selectedSheet) setScaleHistorySheetId(selectedSheet);
      },
    },
    selectorBar: {
      workspaceRef,
      sheets,
      selectedSheet,
      onSelectSheet: setSelectedSheet,
      currentSheet,
      linkCountsBySheet,
      sheetLinksCount: sheetLinks.length,
      onOpenRename: () => { setRenameValue(currentSheet?.sheetName || ""); setRenameDialogOpen(true); },
      onDuplicateSheet: () => { if (selectedSheet) duplicateSheetMutation.mutate(selectedSheet); },
      duplicatePending: duplicateSheetMutation.isPending,
      hasRevisionHistory,
      onOpenCompareDialog: () => setCompareDialogOpen(true),
      onMoveSheetUp: () => handleMoveSheet("up"),
      onMoveSheetDown: () => handleMoveSheet("down"),
      canMoveUp: sheets.findIndex(s => s.id === selectedSheet) > 0,
      canMoveDown:
        sheets.findIndex(s => s.id === selectedSheet) >= 0 &&
        sheets.findIndex(s => s.id === selectedSheet) < sheets.length - 1,
      pinControls: pinControlsForSelectorBar,
      onDetectLinks: () => { if (selectedSheet) detectLinksMutation.mutate(selectedSheet); },
      detectLinksPending: detectLinksMutation.isPending,
      onCreateLink: () => setCreateLinkMode({ step: "select-area" }),
      onDeleteSheet: () => setDeleteSheetConfirmOpen(true),
      thumbnailStripOpen,
      onToggleThumbnailStrip: () => setThumbnailStripOpen((v) => !v),
      showThumbnailToggle: sheets.length > 1,
      hasLinkBack: linkNavigationHistory.length > 0,
      onLinkBack: handleLinkBack,
      autoImportEnabled,
      onToggleAutoImport: () => setAutoImportEnabled(!autoImportEnabled),
      onOpenVersionHistory: () => setVersionHistoryOpen(true),
      showPropertiesPanelToggle: !!selectedMeasurementId,
      propertiesPanelOpen,
      onTogglePropertiesPanel: () => setPropertiesPanelOpen(!propertiesPanelOpen),
      collabSlot: null,
      showHideResolvedToggle: !!selectedSheet && issues.length > 0,
      hideResolvedIssues,
      onToggleHideResolvedIssues: setHideResolvedIssues,
      showAddScale: !!selectedSheet,
      onOpenScaleModal: () => setScaleModalOpen(true),
      onShowShortcuts: () => setShortcutsDialogOpen(true),
      showCrossModuleToggle: context?.type !== "bid",
      crossModulePanelOpen,
      onToggleCrossModule: () => setCrossModulePanelOpen((v) => !v),
      isFullscreen,
      onToggleFullscreen: toggleFullscreen,
      // Task #2310 — Fit-to-page button surfaced on the sheet header
      // bar. Wired to the same `zoomToFitRef.current()` the keyboard
      // shortcut (F) and vertical toolbar already use, so the three
      // entry points stay in lockstep. Disabled until `pageDims` /
      // `pdfImage` have resolved AND the loaded asset belongs to the
      // current sheet — avoids a stale-state click that would fit
      // using the previous sheet's geometry during a sheet swap.
      onFitToPage: () => zoomToFitRef.current(),
      canFitToPage:
        !!pageDims && !!pdfImage && pageDims.sheetId === currentSheet?.id,
      // Task #2311 — Labelled AI Takeoff button on the sheet header
      // bar. Wired to the same `aiPanelOpen` state the existing
      // vertical-toolbar Sparkles button drives, so a click toggles
      // the same panel and the button's pressed state mirrors the
      // panel's actual visibility from either entry point.
      aiPanelOpen,
      onToggleAiPanel: () => setAiPanelOpen((v) => !v),
      // Task #2141 — Sheet Sets toggle, active-set badge, position chip.
      showSheetSetsToggle: !!sheetSetsCtxId,
      sheetSetsPanelOpen,
      onToggleSheetSetsPanel: () => setSheetSetsPanelOpen((v) => !v),
      // Project Files drawer toggle — mirrors the Sheet Sets gating
      // (only shown when a context is bound). Opening Project Files
      // closes Sheet Sets so the two slide-outs don't stack.
      showProjectFilesToggle: !!context,
      projectFilesPanelOpen,
      onToggleProjectFilesPanel: () => {
        setProjectFilesPanelOpen((v) => {
          const next = !v;
          if (next) setSheetSetsPanelOpen(false);
          return next;
        });
      },
      activeSheetSetName: activeSheetSetId ? activeSheetSetDetail?.name ?? null : null,
      activeSheetSetMemberCount: activeSheetSetId
        ? activeSheetSetDetail?.members?.length ?? 0
        : 0,
      currentSheetIndexInSet:
        activeSheetSetId && activeSheetSetDetail?.members?.length && selectedSheet
          ? (() => {
              const idx = [...activeSheetSetDetail.members]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .findIndex((m) => m.sheetId === selectedSheet);
              return idx === -1 ? null : idx;
            })()
          : null,
      // Task #2332 — Pre-compute the sheet-level capture-scale
      // confidence so the header chip in `SheetSelectorBar` doesn't
      // have to crack open every measurement on render. The helper
      // combines `scaleSource` + `scaleConfidence` (server-vouched
      // band) with the count + drift of `scaleAtCaptureLabel`
      // snapshots actually committed against this sheet, then
      // demotes one notch when capture labels disagree with the
      // sheet's current label. `openCalibrationDrawer` is the same
      // entry point the bottom-bar chip and the `T` shortcut use, so
      // a click from the header lands in the identical drawer flow.
      //
      // Task #2344 — The header chip computes confidence directly
      // against the loaded `measurements` for the active sheet (not
      // the workspace-wide projection) so a brand-new measurement
      // that just demoted the sheet's drift shows up in the chip on
      // the very next render — well before the workspace-wide
      // `allMeasurementsRaw` query has refetched. The dropdown
      // rows below get their per-sheet dots from the cached
      // `sheetCalibrationConfidences` map instead.
      calibrationConfidence:
        currentSheet
          ? computeSheetCalibrationConfidence(currentSheet, measurements)
          : null,
      // Task #2344 — Per-sheet confidence map so each dropdown row
      // can render its own four-level dot + tooltip instead of the
      // old binary CheckCircle2/AlertCircle.
      sheetConfidences: sheetCalibrationConfidences,
      onOpenCalibration: openCalibrationDrawer,
    },
    thumbnailStrip:
      thumbnailStripOpen && sheets.length > 1
        ? {
            sheets,
            selectedSheet,
            onSelectSheet: setSelectedSheet,
            layout: "horizontal" as const,
            measurementCounts: measurementCountsPerSheet,
            pinnedSheetIds: pinnedSheetIdsForStrip,
            newerSheetIds: newerSheetIdsForStrip,
            canManagePins: canManageDrawingSetsOnCanvas && !!activeCanvasSetId,
            onPinSheet: handleCanvasPinSheet,
            onUnpinSheet: handleCanvasUnpinSheet,
            onSwapToLatestRevision: handleCanvasSwapRevision,
            pinActionsDisabled: canvasPinMutationPending,
            activeSetName: activeCanvasSetName,
          }
        : null,
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
  }), [
    isViewingLockedVersion, detectedScale, currentSheet,
    handleAcceptDetectedScale, showStaleBanner, staleCanvasItemCount,
    repinStaleCanvasMutation.isPending, dismissStaleBanner,
    currentSheetIsSuperseded, compareNewSheet,
    // Task #2320 — drift banner reads `currentSheet.scaleSource` /
    // `scaleConfidence` (already covered by the `currentSheet`
    // identity above) and routes both CTAs through
    // `openCalibrationDrawer`, so the slice must rebuild when that
    // callback's identity changes.
    openCalibrationDrawer,
    sheets, selectedSheet, linkCountsBySheet, sheetLinks.length,
    duplicateSheetMutation, hasRevisionHistory, handleMoveSheet,
    pinControlsForSelectorBar, detectLinksMutation,
    thumbnailStripOpen, linkNavigationHistory.length, handleLinkBack,
    autoImportEnabled, selectedMeasurementId, propertiesPanelOpen,
    issues.length, hideResolvedIssues, context?.type, crossModulePanelOpen,
    isFullscreen, toggleFullscreen,
    sheetSetsCtxId, sheetSetsPanelOpen, activeSheetSetId, activeSheetSetDetail,
    projectFilesPanelOpen, context,
    // Task #2332 — `selectorBar.calibrationConfidence` reads the
    // sheet's measurement list to detect drift between captured
    // scale labels and to surface the measurement count, so the
    // memo must rebuild whenever the measurement list changes
    // (insert, edit, delete) — otherwise the chip would stay stale
    // until something else in the slice happened to update.
    measurements,
    // Task #2344 — `selectorBar.sheetConfidences` is the per-sheet
    // confidence map; rebuild the slice when its identity changes
    // (any sheet's calibration provenance or its scale-snapshot
    // population shifted) so dropdown dots and the bottom-bar chip
    // refresh together.
    sheetCalibrationConfidences,
    // Task #2310 — `selectorBar.canFitToPage` reads `pageDims` /
    // `pdfImage` so we must re-build the slice when those change,
    // otherwise the Fit button stays disabled even after the PDF
    // resolves.
    pageDims, pdfImage,
    // Task #2311 — `selectorBar.aiPanelOpen` mirrors the AI panel
    // visibility, so the slice must rebuild whenever that state
    // flips or the bar's pressed/active variant won't update when
    // the user opens the panel from the vertical-toolbar Sparkles.
    aiPanelOpen,
    measurementCountsPerSheet, pinnedSheetIdsForStrip, newerSheetIdsForStrip,
    canManageDrawingSetsOnCanvas, activeCanvasSetId,
    handleCanvasPinSheet, handleCanvasUnpinSheet, handleCanvasSwapRevision,
    canvasPinMutationPending, activeCanvasSetName,
    compareDialogOpen, compareOldSheet,
  ]);
  const canvasViewportCursor =
    createLinkMode?.step === "select-area" ? "crosshair" :
    activeTool === "pan" ? "grab" :
    activeTool === "select" ? "default" :
    "crosshair";
  // Task #2138 — viewport rect in world coords drives the tile renderer's
  // priority queue. Computed inline (not memoized) because it changes on
  // every pan/zoom and dependencies are already tracked downstream.
  const tileViewport = useMemo(() => {
    if (!pageDims || !tileRendererEnabled) return null;
    const stageRect = viewportToWorldRect({
      stageWidth: stageDimensions.width,
      stageHeight: stageDimensions.height,
      stagePosition,
      stageScale,
    });
    // CanvasStage draws tiles inside the rotated `<Group>`, so the
    // tile grid lives in page-native (pre-rotation) coords. Map the
    // stage-world viewport back through `sheetRotation` so the
    // scheduler picks the right tile set on rotated sheets.
    const rot = ((sheetRotation % 360) + 360) % 360;
    const validRot = (rot === 0 || rot === 90 || rot === 180 || rot === 270 ? rot : 0) as 0 | 90 | 180 | 270;
    return rotateViewportToPageNative({
      rect: stageRect,
      rotation: validRot,
      pageDims,
    });
  }, [pageDims, tileRendererEnabled, stageDimensions.width, stageDimensions.height, stagePosition, stageScale, sheetRotation]);
  const tileRenderer = usePdfTileRenderer({
    sheetId: tileRendererEnabled && currentSheet?.imageUrl ? currentSheet.id : null,
    sheetUrl: tileRendererEnabled && currentSheet?.imageUrl ? `/api/takeoff/sheets/${currentSheet.id}/pdf` : null,
    pageIndex: currentSheet?.sheetIndex || 0,
    viewport: tileViewport,
    stageScale,
    enabled: tileRendererEnabled,
  });

  // Tile mode owns the placeholder bitmap inside the hook. Forward it
  // into `pdfImage` so all the existing render paths (CanvasStage,
  // PdfPreview, etc.) see the same source of truth.
  //
  // We also have to react to the hook's `placeholderError`. Without
  // that arm, a worker-side render failure (corrupt page, OOM in
  // OffscreenCanvas on a giant civil sheet, 401/404 on the PDF
  // response, etc.) used to leave the canvas wedged on
  // "Loading plan… 80%" with no toast: `loadPDF` flipped
  // `isPdfLoading=true` after `getPageDims` succeeded and waited for
  // the placeholder to arrive — which the hook silently swallowed.
  // Now we surface the failure so the user sees an actionable toast
  // and the loading skeleton clears.
  const lastPlaceholderErrorSheetRef = useRef<string | null>(null);
  const lastErrSheetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tileRendererEnabled) return;
    // When the user navigates to a different sheet, drop the de-dupe
    // memo so a retry on a previously-failed sheet (or a new failure on
    // the new sheet that happens to share name/status) can toast again
    // instead of being silently swallowed.
    if (lastErrSheetIdRef.current !== (currentSheet?.id ?? null)) {
      lastPlaceholderErrorSheetRef.current = null;
      lastErrSheetIdRef.current = currentSheet?.id ?? null;
    }
    if (tileRenderer.placeholder) {
      lastPlaceholderErrorSheetRef.current = null;
      setPdfImage(tileRenderer.placeholder);
      // Tag the bitmap with the sheet it belongs to so CanvasStage can
      // refuse to draw it when the user has already advanced to a
      // different sheet in the same render commit.
      setPdfImageSheetId(currentSheet?.id ?? null);
      setPdfLoadProgress(100);
      setIsPdfLoading(false);
    } else if (tileRenderer.placeholderError && currentSheet?.id) {
      // De-dupe: only fire one toast per (sheetId × error) so a
      // re-render doesn't spam the user. Includes message so two
      // distinct failures sharing the same name/status (e.g. two
      // different "InvalidPDFException" messages) still both surface.
      // The ref is reset on every sheet change above and on every
      // successful placeholder arrival, so retries can re-toast.
      const placeholderMsg = tileRenderer.placeholderError.message ?? "";
      const isPlaceholderBenign = placeholderMsg.includes("Rendering cancelled");
      if (!isPlaceholderBenign) {
        const errKey = `${currentSheet.id}|${tileRenderer.placeholderError.name ?? ""}|${tileRenderer.placeholderError.status ?? ""}|${placeholderMsg}`;
        if (lastPlaceholderErrorSheetRef.current !== errKey) {
          lastPlaceholderErrorSheetRef.current = errKey;
          const sheetName = currentSheet.sheetName || "this sheet";
          const status = tileRenderer.placeholderError.status;
          const detail =
            status === 401 || status === 403
              ? "You don't have access to this sheet's PDF. Try signing back in."
              : status === 404
                ? "The PDF file is missing. Re-import the document and try again."
                : tileRenderer.placeholderError.message ||
                  "The file may not be a valid PDF document.";
          toast({
            title: `Couldn't load "${sheetName}"`,
            description: detail,
            variant: "destructive",
          });
        }
      }
      setPdfImage(null);
      setPdfImageSheetId(null);
      setIsPdfLoading(false);
      setPdfLoadProgress(0);
    } else {
      setPdfImage(null);
      setPdfImageSheetId(null);
    }
  }, [
    tileRendererEnabled,
    tileRenderer.placeholder,
    tileRenderer.placeholderError,
    currentSheet?.id,
    currentSheet?.sheetName,
    toast,
  ]);

  // NOTE: Intentionally NOT memoized. The slice references 100+ pieces of
  // state and ~20 mutations/handlers; an exhaustive useMemo dependency
  // array is impractical to keep correct, and a stale dep silently breaks
  // UI updates (e.g. context menus, tool picker, link target select).
  // Re-creating this object every orchestrator render is the same cost
  // as the pre-migration inline JSX. CanvasHost / CanvasViewport stay
  // wrapped in React.memo and re-render at the same cadence as before.
  const canvasSlice: CanvasContextSlice = {
    stage: {
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
    tiles: tileRenderer.visibleTiles,
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
    activeCalibrationZoneId: activeCalibrationZone?.id ?? null,
    onSelectCalibrationZone: setSelectedCalibrationZoneId,
    // Task #2793 — When the calibration drawer is open, clicking a zone
    // polygon enters vertex-drag reshape mode for that zone (and also
    // selects it so the row highlights). When the drawer is closed the
    // prop is undefined and the canvas falls back to the plain select path.
    onZonePolygonClick: calibrationDrawerOpen
      ? (zone) => {
          setSelectedCalibrationZoneId(zone.id);
          handleStartZoneEdit(zone);
        }
      : undefined,
    zoneDrawingActive,
    zoneDrawPoints,
    onZoneCanvasClick: handleZoneCanvasClick,
    onZoneCanvasDblClick: handleZoneCanvasDblClick,
    editingZoneId,
    editingZonePoints,
    onZoneVertexDrag: handleZoneVertexDrag,
    currentSnap,
    runningMeasurement,
    snapStats,
    orthoLock,
    polarGuideStep,
    constraintMode: unifiedRibbon ? constraintMode : undefined,
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
    },
    viewport: {
      containerRef,
      cursor: canvasViewportCursor,
      onContextMenu: (e) => {
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
      },
      onClick: () => {
        if (contextMenuPos) setContextMenuPos(null);
        if (measurementContextMenu) setMeasurementContextMenu(null);
      },
      selectedSheet,
      calibrationMode,
      onOpenCalibrate: openCalibrationDrawer,
      isDrawing,
      isMobile,
      drawingPoints,
      activeTool,
      activeCondition,
      showMobileGestureGuide,
      onDismissGestureGuide: () => {
        setShowMobileGestureGuide(false);
        localStorage.setItem("takeoff-gesture-guide-dismissed", "1");
      },
      showMobileToolPicker,
      onToggleMobileToolPicker: () => {
        setShowMobileToolPicker(!showMobileToolPicker);
        if (navigator.vibrate) navigator.vibrate(10);
      },
      onSelectMobileTool: (tool) => {
        setActiveTool(tool);
        setShowMobileToolPicker(false);
        if (navigator.vibrate) navigator.vibrate(10);
      },
      openSheetIds,
      sheets,
      onSelectSheet: setSelectedSheet,
      onCloseSheetTab: (sheetId, e) => handleCloseSheetTab(sheetId, e),
      stageScale,
      currentSheet,
      snapEnabled,
      orthoLock,
      gridEnabled,
      conditions,
      onActivateCondition: handleActivateCondition,
      onChestItemDrop: handleChestItemDrop,
      onOpenUploadDialog: () => setUploadDialogOpen(true),
      markupTextInput,
      pdfImageWidth: pdfImage?.width || 0,
      pdfImageHeight: pdfImage?.height || 0,
      sheetRotation,
      stagePosition,
      workspaceRef,
      onMarkupTextSubmit: handleMarkupTextSubmit,
      onMarkupTextCancel: () => setMarkupTextInput(null),
      createLinkMode,
      createLinkTargetSheet,
      onCreateLinkTargetChange: (val) => {
        setCreateLinkTargetSheet(val);
        if (val && selectedSheet && createLinkMode?.startPoint && createLinkMode.endPoint) {
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
      },
      onCancelCreateLink: () => setCreateLinkMode(null),
      onCancelCreateLinkTarget: () => { setCreateLinkMode(null); setCreateLinkTargetSheet(null); },
      contextMenuPos,
      onContextMenuCreateLink: () => {
        setCreateLinkMode({ step: "select-area" });
        setContextMenuPos(null);
      },
      onContextMenuDetectLinks: () => {
        if (selectedSheet) detectLinksMutation.mutate(selectedSheet);
        setContextMenuPos(null);
      },
      measurementContextMenu,
      measurements,
      onMeasurementContextEdit: (m) => {
        setSelectedMeasurementId(m.id);
        setMeasurementContextMenu(null);
      },
      onMeasurementContextProperties: (m) => {
        setSelectedMeasurementId(m.id);
        setPropertiesPanelOpen(true);
        setMeasurementContextMenu(null);
      },
      onMeasurementContextDelete: (m) => {
        deleteMeasurementMutation.mutate(m);
        setMeasurementContextMenu(null);
      },
      // Task #2321 — Only expose the "Send to reviewer" item when this
      // workspace is in bid context. Project-level takeoffs aren't
      // bound to the bid-lock review gate so the action would have
      // nowhere meaningful to fan out the notification.
      onMeasurementContextSendToReviewer: context?.type === "bid"
        ? (m) => {
            requestReviewMutation.mutate(m.id);
            setMeasurementContextMenu(null);
          }
        : undefined,
      // Task #2321 — Approve / Reject right-click actions. Gated to:
      //   1. bid-context workspaces (queue is bid-scoped)
      //   2. caller is in an approver role (server enforces; we hide
      //      the menu items here so non-approvers don't see
      //      affordances that would always 403)
      //   3. caller did not request review on this row (no
      //      self-approval — the canvas component sees ALL of the
      //      caller's roles + own user id via currentUser)
      onMeasurementContextApproveReview: context?.type === "bid" && (
        currentUser?.user?.role === "ADMIN"
        || currentUser?.user?.role === "MANAGER"
        || currentUser?.user?.role === "SUPERINTENDENT"
        || currentUser?.role === "ADMIN"
        || currentUser?.role === "MANAGER"
        || currentUser?.role === "SUPERINTENDENT"
      ) ? (m) => {
          if (m.reviewRequestedById && (m.reviewRequestedById === currentUser?.user?.id || m.reviewRequestedById === currentUser?.id)) {
            toast({ title: "Cannot self-approve", description: "You requested review on this measurement.", variant: "destructive" });
            setMeasurementContextMenu(null);
            return;
          }
          approveReviewMutation.mutate(m.id);
          setMeasurementContextMenu(null);
        } : undefined,
      onMeasurementContextRejectReview: context?.type === "bid" && (
        currentUser?.user?.role === "ADMIN"
        || currentUser?.user?.role === "MANAGER"
        || currentUser?.user?.role === "SUPERINTENDENT"
        || currentUser?.role === "ADMIN"
        || currentUser?.role === "MANAGER"
        || currentUser?.role === "SUPERINTENDENT"
      ) ? (m) => {
          if (m.reviewRequestedById && (m.reviewRequestedById === currentUser?.user?.id || m.reviewRequestedById === currentUser?.id)) {
            toast({ title: "Cannot self-reject", description: "You requested review on this measurement.", variant: "destructive" });
            setMeasurementContextMenu(null);
            return;
          }
          rejectReviewMutation.mutate(m.id);
          setMeasurementContextMenu(null);
        } : undefined,
      categories,
      showCostPanel,
      onCloseCostPanel: () => setShowCostPanel(false),
      showOverlaySlider,
      overlayOpacity,
      onOverlayOpacityChange: (v) => setOverlayOpacity(v),
      onCloseOverlaySlider: () => handleSetShowOverlaySlider(false),
      // Task #2311 — Inline AI Takeoff empty-state CTA card. Rendered
      // by `<CanvasViewport>` inside the stage area only when the
      // sheet has zero measurements + zero AI runs to date and the
      // user hasn't dismissed it for this (user, sheet). Opens the
      // existing AI panel when accepted; per-(user, sheet) dismissal
      // persists in localStorage so it doesn't re-appear next session.
      showAiCta,
      onOpenAiFromCta: handleOpenAiFromCta,
      onDismissAiCta: handleDismissAiCta,
    },
  };

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

  // NOTE: Intentionally NOT memoized. Same rationale as canvasSlice above —
  // panelSlice spans 12 sub-slots (sidebar, dialogs, bottomBar,
  // measurementTable, issueDetail, aiPanel, markupStylingPanel,
  // propertiesPanel, etc.) referencing 100+ pieces of state; an exhaustive
  // useMemo dependency array is impractical to keep correct. The
  // pre-migration inline JSX rebuilt every render, so this is no worse.
  const panelSlice: PanelContextSlice = {
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
      // Task #2237 — Hand keyboard focus back to the canvas viewport
      // when the version history sheet closes (Esc / outside click /
      // X button). Otherwise Radix returns focus to the Versions
      // ribbon button and the user has to click the canvas before
      // ribbon shortcuts work again.
      onCloseFocusReturn: focusCanvasViewport,
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
      // Task #2239 — sidebar Layers panel gets the same bulk show/hide
      // controls as the ribbon popover (Task #2231) so estimators don't
      // have to bounce between the two surfaces.
      onSetAllCategoriesVisibility: handleSetAllCategoriesVisibility,
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
      collapsed: effectiveSidebarCollapsed,
      onToggleCollapse: effectiveToggleSidebar,
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
      onMeasurementHover: setHoveredMeasurementId,
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
      onPinConditionToChest: handlePinConditionToChest,
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
          // Task #2320 — picking from the Standard Scales modal is a
          // STANDARD_SCALE/HIGH calibration; the user is explicitly
          // attesting the sheet is at this exact ratio.
          await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, {
            scalePxPerFoot: pxPerFoot,
            units: scaleUnits,
            scaleLabel: label,
            scaleSource: "STANDARD_SCALE",
            scaleConfidence: "HIGH",
          });
          queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
          toast({ title: "Scale Applied", description: `Scale set to ${label}` });
        } catch (error: any) {
          toast({ title: "Error", description: error?.message || "Failed to apply scale", variant: "destructive" });
        }
      },
      // Task #2140 — calibration-by-two-points has moved to
      // `InlineCalibrationDrawer` (opened via T or sidebar). The modal
      // is now strictly Standard Scales + Custom ratio, so we no
      // longer expose an `onStartCalibration` entry point here.
      currentScalePxPerFoot: currentSheet?.scalePxPerFoot ?? null,
    },
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
    bottomBar: {
      selectedMeasurementCount: selectedMeasurementIds.size,
      bulkDeletePending: bulkDeleteMeasurementsMutation.isPending,
      onBulkDelete: () => {
        // Task #1901 — Route through the bulk mutation so the user
        // gets a single destructive "Deleted N measurements · Undo"
        // toast and the deletion is coalesced into one
        // MEASUREMENT_DELETE_BATCH history entry instead of N per-id
        // `DELETE` entries from the previous per-id fan-out loop.
        const toDelete = measurements.filter(m => selectedMeasurementIds.has(m.id));
        if (toDelete.length === 0) return;
        setSelectedMeasurementIds(new Set());
        setSelectedMeasurementId(null);
        bulkDeleteMeasurementsMutation.mutate(toDelete);
      },
      onClearSelection: () => setSelectedMeasurementIds(new Set()),
      selectedSheet,
      measurements,
      showCostPanel,
      onToggleCostPanel: () => setShowCostPanel(!showCostPanel),
      showOverlaySlider,
      onToggleOverlaySlider: () => handleSetShowOverlaySlider(!showOverlaySlider),
      showMeasurementTable,
      onToggleMeasurementTable: () => setShowMeasurementTable(!showMeasurementTable),
      showReviewQueue: reviewQueueOpen,
      onToggleReviewQueue: () => setReviewQueueOpen(v => !v),
      reviewQueueCount,
      stageScale,
      currentSheet,
      // Task #2344 — Bottom-bar calibration chip now uses the same
      // four-level helper (`computeSheetCalibrationConfidence`) as
      // the sheet-header chip and the sheet-selector dropdown rows.
      // We compute against the active sheet's freshly-loaded
      // `measurements` (not the workspace-wide projection) so a
      // brand-new measurement that just demoted the sheet's drift
      // shows up in the bottom-bar chip on the very next render.
      calibrationConfidence: currentSheet
        ? computeSheetCalibrationConfidence(currentSheet, measurements)
        : null,
      // Task #2344 — Wire the same calibration drawer the sheet-
      // header chip uses so a click on the bottom-bar chip jumps
      // straight to recalibration. Estimators triaging from the
      // status row no longer have to scroll back up to the header.
      onOpenCalibration: openCalibrationDrawer,
      // Task #2795 — Live active zone badge in the status bar. The badge now
      // shows in real time as the cursor moves over the canvas, not just while
      // drawing. When inside a zone, shows the zone name + px/ft. When on the
      // canvas but outside all zones, the bottom bar shows a "Sheet scale" fallback.
      activeZone: activeCalibrationZone
        ? {
            id: activeCalibrationZone.id,
            name: activeCalibrationZone.name,
            pxPerFoot: activeCalibrationZone.px_per_foot,
          }
        : null,
      // Task #2795 — True whenever the cursor is over the canvas (cursorPosition
      // is non-null). Drives the sheet-scale fallback chip when outside all zones.
      cursorOnCanvas: !!cursorPosition,
    },
    measurementTable: {
      visible: showMeasurementTable && !!selectedSheet,
      measurements,
      categories,
      selectedMeasurementId,
      scalePxPerFoot: currentSheet?.scalePxPerFoot,
      // Task #2345 — drift remediation pass-throughs.
      scaleLabel: currentSheet?.scaleLabel ?? null,
      onRemediateDrift: (measurementId: string, action: "recapture" | "mark_stale") =>
        remediateDriftMutation.mutate({ measurementId, action }),
      onBulkRemediateDrift: (action: "recapture" | "mark_stale") => {
        if (!selectedSheet) return;
        bulkRemediateDriftMutation.mutate({ sheetId: selectedSheet, action });
      },
      isRemediatingDrift: remediateDriftMutation.isPending || bulkRemediateDriftMutation.isPending,
      onClose: () => setShowMeasurementTable(false),
      onSelect: (id: string) => setSelectedMeasurementId(id),
      onDelete: (id: string) => {
        const m = measurements.find((x: TakeoffMeasurement) => x.id === id);
        if (m) deleteMeasurementMutation.mutate(m);
      },
      onUpdate: (id: string, data: Partial<TakeoffMeasurement>) => {
        // Task #1843 — forward a `previous` snapshot so the inline
        // rename in MeasurementTable produces one MEASUREMENT_UPDATE
        // history entry (one Undo press).
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
        updateMeasurementMutation.mutate({ id, ...data, previous } as Parameters<typeof updateMeasurementMutation.mutate>[0]);
      },
      // Task #2334 — Per-row unlock-and-rescale. The MeasurementTable
      // surfaces this through the Locked badge so an estimator who
      // locked by mistake (or who later decides the new sheet scale
      // is correct after all) can re-derive the row against the
      // current `scalePxPerFoot` without deleting and redrawing it.
      onUnlockAndRescale: (id: string) => {
        unlockAndRescaleMeasurementMutation.mutate(id);
      },
      // Task #2357 — Bulk unlock-and-rescale. Same recovery path as
      // the per-row affordance above but for every locked row at
      // once: an estimator who chose "Lock existing measurements" on
      // a re-calibration by mistake can release the whole sheet in
      // one click instead of clicking each badge individually.
      // Task #2581 — BASE/CO scope tagging. Only meaningful when we have
      // a project context (change orders are project-scoped); the
      // change-order list stays empty in bid/standalone contexts so
      // the table hides the "Move to change order…" entry naturally.
      changeOrders: projectChangeOrdersEnabled ? projectChangeOrders : undefined,
      onMoveScope: projectChangeOrdersEnabled
        ? (
            measurementId: string,
            payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
          ) => {
            moveScopeMutation.mutate({ measurementId, ...payload });
          }
        : undefined,
      // Task #2588 — Bulk move many measurements to BASE/CO in one
      // round-trip. Only meaningful in a project context (the
      // change-order picker is project-scoped); the table only
      // surfaces the toolbar action when both this callback and 2+
      // selected rows are present.
      onBulkMoveScope: projectChangeOrdersEnabled
        ? async (
            ids: string[],
            payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
          ) => {
            await bulkMoveScopeMutation.mutateAsync({ ids, ...payload });
          }
        : undefined,
      isMovingScope: moveScopeMutation.isPending || bulkMoveScopeMutation.isPending,
      onBulkUnlockAndRescale: async (ids: string[]) => {
        // Use mutateAsync so the table can await success before
        // clearing its selection. If the request rejects (network
        // failure, 4xx), the user keeps their selection so they can
        // retry without re-checking every row.
        await bulkUnlockAndRescaleMeasurementsMutation.mutateAsync(ids);
      },
      isBulkUnlocking: bulkUnlockAndRescaleMeasurementsMutation.isPending,
      // Task #2617 — Forward the per-sheet measurement groups to the
      // panel so the toolbar can render the group filter (and the
      // "Delete batch" affordance for AI map-reduce review batches).
      groups: measurementGroups,
      onDeleteGroup: async (groupId: string) => {
        await deleteGroupWithMeasurementsMutation.mutateAsync(groupId);
      },
      isDeletingGroup: deleteGroupWithMeasurementsMutation.isPending,
      // Task #2630 — Programmatic group-filter request driven by the AI
      // map-reduce apply-toast "Review batch" action.
      groupFilterRequest: measurementGroupFilterRequest,
    },
    issueDetail: selectedIssue ? {
      issue: selectedIssue,
      orgUsers,
      currentUser,
      sheetId: selectedSheet!,
      onClose: () => setSelectedIssueId(null),
      onDelete: () => {
        setSelectedIssueId(null);
        if (issuesQueryKey) queryClient.invalidateQueries({ queryKey: issuesQueryKey });
        queryClient.invalidateQueries({ queryKey: allSheetsIssuesQueryKey });
      },
    } : null,
    aiPanel: aiPanelOpen && selectedSheet ? {
      visible: true,
      isDrawing,
      isMobile,
      props: {
        projectId: context?.type === "project" ? context.projectId : projectId || undefined,
        bidId: context?.type === "bid" ? context.bidId : undefined,
        // Task #2551 — Standalone takeoff context.
        standaloneTakeoffId: context?.type === "standalone" ? context.standaloneTakeoffId : undefined,
        sheetId: selectedSheet,
        onClose: () => { setAiPanelOpen(false); setPreImportDetectedItems([]); },
        onHighlightItem: (item: DetectedItem | null) => setHighlightedAiItem(item),
        onDetectedItemsChanged: (items: DetectedItem[]) => setPreImportDetectedItems(items),
        showOverlays: showAiOverlays,
        onToggleOverlays: setShowAiOverlays,
        // Task #2723 — Let the AI panel know when measurements change
        // so it can show the "Measurements updated" notice.
        measurementsRevision,
        // Task #2630 — Wire the apply-toast "Review batch" action so
        // a one-click jump from the map-reduce dialog: (1) selects
        // the sheet the new group lives on, (2) opens the bottom
        // measurement table, and (3) scopes its group filter to the
        // freshly-created group id. We pick the first group in the
        // payload — almost every map-reduce apply lands on a single
        // sheet/group anyway because the drafter writes one group
        // per sheet per day, so this is the right default. The
        // group-filter dropdown still lets the user flip to the
        // other batches if the apply spanned multiple sheets.
        onReviewMapReduceBatch: (target) => {
          const first = target.groupBySheet[0];
          if (!first) return;
          setSelectedSheet(first.sheetId);
          setShowMeasurementTable(true);
          setMeasurementGroupFilterRequest({
            groupId: first.groupId,
            nonce: Date.now(),
          });
        },
        onItemsImported: async (items: DetectedItem[]) => {
          let succeeded = 0;
          let failed = 0;
          const failedItems: string[] = [];
          // Use pageDims (world-coordinate canvas size) when available so that
          // bounding-box percentages map to the correct Konva coordinate space.
          // Falling back to pdfImage dimensions caused all imported measurements
          // to cluster in the top-left because pdfImage is the low-res
          // placeholder bitmap (e.g. 816 px) while the canvas world space can
          // be 8000+ px wide.
          const imgW = pageDims?.width || pdfImage?.width || 2000;
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
          // Task #2323 — track aiItemId -> created measurement id so the
          // panel can stitch them onto the closed-loop bulk-accept call.
          const measurementIdsByItemId: Record<string, string> = {};
          const imgH = pageDims?.height || pdfImage?.height || 1500;

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
              if (created?.id) {
                newMeasurementIds.push(created.id);
                measurementIdsByItemId[item.id] = created.id;
              }
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
          return { succeeded, failed, failedItems, measurementIdsByItemId };
        },
      },
    } : null,
    markupStylingPanel: (() => {
      if (selectedMarkupIds.size < 1 || !markupEditDraft || !markupEditInitial) {
        return {
          visible: false,
          isMulti: false,
          selectedCount: 0,
          showTextInput: false,
          showThicknessInput: false,
          isHighlight: false,
          draft: { text: "", color: "#000000", thickness: 1 },
          onChangeDraft: () => {},
          onClose: () => {},
          onDeleteSingle: () => {},
          onDeleteBulk: () => {},
          bulkDeletePending: false,
          saveButtonSlot: null,
        };
      }
      const selectedMarkups = markups.filter(m => selectedMarkupIds.has(m.id));
      if (selectedMarkups.length === 0) {
        return {
          visible: false,
          isMulti: false,
          selectedCount: 0,
          showTextInput: false,
          showThicknessInput: false,
          isHighlight: false,
          draft: { text: "", color: "#000000", thickness: 1 },
          onChangeDraft: () => {},
          onClose: () => {},
          onDeleteSingle: () => {},
          onDeleteBulk: () => {},
          bulkDeletePending: false,
          saveButtonSlot: null,
        };
      }
      // Anchor: when only one is selected we use it directly; when
      // multiple are selected we still pick the first as a header
      // hint, but bulk save fans out across every selectedMarkup.
      const anchor = selectedMarkups.find(m => m.id === selectedMarkupId) ?? selectedMarkups[0];
      const isMulti = selectedMarkups.length > 1;
      const allText = selectedMarkups.every(m => (m.tool as string) === "TEXT");
      const allHighlight = selectedMarkups.every(m => (m.tool as string) === "HIGHLIGHT");
      // Task #1758 — Text input shows for a single TEXT markup OR for
      // a multi-selection that is exclusively TEXT markups (so a user
      // can rename a group of labels to the same string in one shot).
      // Mixed selections still hide it because bulk-renaming non-TEXT
      // shapes has no meaning. The bulk save routes the text change
      // through the same MARKUP_UPDATE_BATCH path as color/thickness
      // so one Undo press reverts every renamed label.
      const showTextInput = allText;
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
      // MARKUP_UPDATE_BATCH history entry pushed only after the PATCH
      // resolves.
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
      return {
        visible: true,
        isMulti,
        selectedCount: selectedMarkups.length,
        showTextInput,
        showThicknessInput,
        isHighlight,
        draft: markupEditDraft,
        onChangeDraft: setMarkupEditDraft,
        onClose: close,
        onDeleteSingle: async () => {
          try {
            await deleteMarkupMutation.mutateAsync(anchor.id);
            close();
          } catch (err) {
            console.warn("[Takeoff] Failed to delete markup:", err);
          }
        },
        onDeleteBulk: async () => {
          // Task #1832 — Multi-select delete now collapses N parallel
          // per-id `deleteMarkupMutation` calls into one bulk DELETE
          // round-trip. The server runs the removal in a transaction
          // so a mid-flight failure rolls back atomically (no
          // half-deleted group). Disabled while the bulk request is
          // in flight to keep accidental double-clicks from racing
          // against the optimistic cache strip.
          try {
            await bulkDeleteMarkupsMutation.mutateAsync(
              selectedMarkups.map((m) => m.id),
            );
            close();
          } catch (err) {
            console.warn("[Takeoff] Failed to bulk-delete markups:", err);
          }
        },
        bulkDeletePending: bulkDeleteMarkupsMutation.isPending,
        saveButtonSlot: (
          <MarkupStylingPopoverSaveButton
            onSave={save}
            updatePending={updateMarkupMutation.isPending}
            bulkPending={bulkUpdateMarkupsMutation.isPending}
          />
        ),
      };
    })(),
    propertiesPanel: (() => {
      if (!selectedMeasurementId) return null;
      const selectedMeasurement = measurements.find(m => m.id === selectedMeasurementId);
      if (!selectedMeasurement) return null;
      // Task #2657 — Surface live "Jane is editing this measurement"
      // presence on the properties panel BEFORE the user hits save.
      // Filter the per-peer focus map down to peers focused on this
      // measurement and de-dupe by userId so two browser tabs from
      // the same person collapse into a single avatar.
      const focusedBy: Array<{ userId: string; userName: string; userColor: string }> = [];
      const seenFocusUsers = new Set<string>();
      collab.measurementFocus.forEach((entry) => {
        if (
          entry.measurementId === selectedMeasurementId &&
          !seenFocusUsers.has(entry.userId)
        ) {
          seenFocusUsers.add(entry.userId);
          focusedBy.push({
            userId: entry.userId,
            userName: entry.userName,
            userColor: entry.userColor,
          });
        }
      });
      // Task #2312 — Below the `lg` breakpoint the inspector switches
      // to a right-edge Sheet drawer (auto-opens on selection, can be
      // dismissed without losing the selection). The previous
      // mobile-only hide path (Task #2206 follow-up) is now obsolete:
      // the drawer doesn't consume canvas width when closed and is
      // touch-friendly when open, so iPad and phone users finally get
      // an inspector. Desktop (lg:+) keeps the pinned panel gated by
      // the explicit `propertiesPanelOpen` toggle in the toolbar.
      // Task #2587 — Forward the BASE/CO scope picker wiring to the
      // properties panel so the chip + dropdown there reuses the same
      // workspace mutation the table row context menu does. Only
      // meaningful in project context (change orders are
      // project-scoped); embedded bid-context callers leave these
      // undefined and the panel hides the affordance.
      const scopeProps = projectChangeOrdersEnabled
        ? {
            changeOrders: projectChangeOrders,
            onMoveScope: (
              measurementId: string,
              payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
            ) => {
              moveScopeMutation.mutate({ measurementId, ...payload });
            },
            isMovingScope: moveScopeMutation.isPending,
          }
        : {};
      if (isBelowLg) {
        return {
          props: {
            measurement: selectedMeasurement,
            selectedSheet,
            onClose: () => setInspectorDrawerOpen(false),
            variant: "drawer" as const,
            focusedBy,
            ...scopeProps,
          },
          drawer: {
            open: inspectorDrawerOpen,
            onOpenChange: setInspectorDrawerOpen,
          },
        };
      }
      if (!propertiesPanelOpen) return null;
      return {
        props: {
          measurement: selectedMeasurement,
          selectedSheet,
          onClose: () => setPropertiesPanelOpen(false),
          variant: "inline" as const,
          focusedBy,
          ...scopeProps,
        },
      };
    })(),
    toolChest: {
      // Task #2139 — left-side pinned shelf. The component reads
      // `open` and self-mounts, so always provide the slice here.
      open: toolChestOpen,
      onClose: () => {
        setToolChestOpen(false);
        try { localStorage.setItem("takeoff-tool-chest-open", "false"); } catch { /* noop */ }
      },
      // /api/auth/me returns `{ user: {...} }` (see client/src/hooks/use-auth.tsx).
      // The legacy `currentUser?.id` reads above are best-effort fallbacks
      // for fields that don't strictly require ownership; the chest needs
      // the real id to compute `ownedByMe`.
      currentUserId: currentUser?.user?.id ?? currentUser?.id ?? null,
      conditions,
      // Standalone takeoff has no library-assemblies catalogue — the
      // bid-estimate workspace will pass its own list. Empty here
      // means assembly chest items render with their stored label
      // and the resolver flags them as "missing" if any get pinned
      // outside a bid context.
      assemblies: [],
      // Style pre-applied: if the chest item carries a color override,
      // push it into the active markup color before flipping the tool
      // so the next stroke is drawn in the chest item's color. The
      // drag-to-canvas path applies the same color via
      // `handleChestItemDrop` (see ChestItemDragPayload.color).
      onActivateTool: (toolId: string, options?: { color?: string | null }) => {
        if (options?.color) setMarkupColor(options.color);
        setActiveTool(toolId as Tool);
      },
      onActivateCondition: (cond: TakeoffCondition, options?: { color?: string | null }) => {
        if (options?.color) setMarkupColor(options.color);
        handleActivateCondition(cond);
      },
    },
    reviewQueuePanel: reviewQueueOpen && reviewQueueContextId
      ? {
          visible: true,
          isDrawing,
          isMobile,
          props: {
            context: reviewQueueContextType === "bid"
              ? { type: "bid", bidId: reviewQueueContextId }
              : { type: "project", projectId: reviewQueueContextId },
            selectedSheet,
            onClose: () => setReviewQueueOpen(false),
            onJumpToSheet: (sheetId: string, measurementId: string) => {
              // Switch sheets and pre-select the measurement so the
              // canvas highlights it on arrival. The measurement
              // properties panel reads `selectedMeasurementId` and
              // opens itself when populated.
              setSelectedSheet(sheetId);
              setSelectedMeasurementId(measurementId);
            },
          },
        }
      : null,
  };
  const collabSlice: CollabContextSlice = useMemo(() => {
    const sheetLockOwnedByMe =
      !!selectedSheet &&
      collab.sheetLocks.has(selectedSheet) &&
      collab.sheetLocks.get(selectedSheet)?.userId === currentUser?.id;
    return {
      collaborators: collab.collaborators,
      currentSheetLock: collab.currentSheetLock,
      connected: collab.connected,
      hasRoom: !!collabRoomId,
      sheetNameById: (sheetId: string) =>
        sheets.find((s: TakeoffSheet) => s.id === sheetId)?.sheetName ?? null,
      sheetLockToggle: {
        visible: !!selectedSheet && collab.collaborators.length > 0,
        ownedByMe: sheetLockOwnedByMe,
        onToggle: () => {
          if (!selectedSheet) return;
          const myLock = collab.sheetLocks.get(selectedSheet);
          if (myLock && myLock.userId === currentUser?.id) {
            collab.unlockSheet(selectedSheet);
          } else {
            collab.lockSheet(selectedSheet);
          }
        },
      },
    };
  }, [
    collab, collabRoomId, sheets, selectedSheet, currentUser?.id,
  ]);
  const ctxValue: TakeoffWorkspaceContextValue = {
    ribbon: ribbonSlice,
    sheet: sheetSlice,
    canvas: canvasSlice,
    panel: panelSlice,
    collab: collabSlice,
  };

  return (
    <TakeoffWorkspaceProvider value={ctxValue}>
    <div
      ref={workspaceRef}
      className={cn(
        "h-full relative overflow-hidden",
        unifiedRibbon ? "flex flex-col" : "flex flex-col sm:flex-row",
      )}
      data-unified-ribbon={unifiedRibbon ? "true" : "false"}
    >
      {unifiedRibbon ? (
        <UnifiedTakeoffRibbon
          userId={ribbonUserId}
          activeTool={activeTool}
          onToolSelect={handleToolSelect}
          enabledSnapModes={enabledSnapModes}
          setEnabledSnapModes={setEnabledSnapModes}
          snapHudOpen={snapHudOpen}
          setSnapHudOpen={handleSetSnapHudOpen}
          constraintMode={constraintMode}
          setConstraintMode={setConstraintMode}
          orthoPresetIndex={orthoPresetIndex}
          setOrthoPresetIndex={setOrthoPresetIndex}
          orthoLock={orthoLock}
          setOrthoLock={setOrthoLock}
          gridEnabled={gridEnabled}
          setGridEnabled={handleToggleGrid}
          onOpenCalibrate={() => openCalibrationDrawer()}
          isCalibrated={isCalibrated}
          onOpenCheatSheet={() => setCheatSheetOpen(true)}
          isOffline={isOffline}
          pendingOutboxCount={queueLength}
          isSyncing={isSyncing}
          labeled={labeled}
          dimHudActive={dimHudActive}
          dimHudUnits={units}
          onDimCommit={commitTypedDimension}
          onStartVerifyScale={() => {
            setVerifyMode("first-point");
            toast({
              title: "Verify Scale",
              description: "Click two points of a known distance to check the current calibration.",
            });
          }}
          verifyScaleActive={verifyMode !== "idle"}
          onOpenDimInput={() => {
            setDimInputValue(pendingDimLengthFt ? String(pendingDimLengthFt) : "");
            setDimInputOpen(true);
          }}
          dimInputActive={!!pendingDimLengthFt && pendingDimLengthFt > 0}
          pendingDimLengthFt={pendingDimLengthFt}
          dimInputRepeat={dimInputRepeat}
          onShowLayers={() => setLayersPopoverOpen((v) => !v)}
          layersActive={layersPopoverOpen || hiddenCategoryIds.size > 0}
          layersPopoverOpen={layersPopoverOpen}
          onLayersPopoverOpenChange={setLayersPopoverOpen}
          onLayersPopoverClose={focusCanvasViewport}
          layersCategories={categories}
          hiddenCategoryIds={hiddenCategoryIds}
          onToggleCategoryVisibility={handleToggleCategoryVisibility}
          onSetAllCategoriesVisibility={handleSetAllCategoriesVisibility}
          onToggleOverlay={() => handleSetShowOverlaySlider(!showOverlaySlider)}
          overlayActive={showOverlaySlider}
          onShowVersions={() => setVersionHistoryOpen(true)}
          versionsActive={versionHistoryOpen}
          toolChestOpen={toolChestOpen}
          onToggleToolChest={handleToggleToolChest}
          onPinTool={handlePinToolToChest}
        />
      ) : (
        <RibbonHost />
      )}
      <TakeoffShortcutCheatSheet open={cheatSheetOpen} onOpenChange={setCheatSheetOpen} />
      <InlineCalibrationDrawer
        open={calibrationDrawerOpen}
        sheetId={selectedSheet ?? undefined}
        onOpenChange={(next) => {
          if (!next) {
            // Route every close through the shared helper so the
            // canvas-state teardown (calibrate tool, first-point
            // mode, picked points) is always undone.
            closeCalibrationDrawer();
          } else {
            setCalibrationDrawerOpen(true);
          }
        }}
        calibrationMode={calibrationMode}
        setCalibrationMode={setCalibrationMode}
        calibrationPoints={calibrationPoints}
        setCalibrationPoints={setCalibrationPoints}
        calibrationDistance={calibrationDistance}
        setCalibrationDistance={setCalibrationDistance}
        units={units}
        setUnits={setUnits}
        currentScalePxPerFoot={currentSheet?.scalePxPerFoot ?? null}
        onSaveCalibration={async (distanceFt, options) => {
          // Task #2140 round-7 — Only close the drawer when the
          // PATCH actually lands. On validation / network failure,
          // `handleSaveCalibration` toasts and returns false; we
          // keep the drawer open so the user can correct the
          // distance / pick fresh points and retry without having
          // to re-enter the calibration flow.
          //
          // Task #2326 — Forward the lock-vs-rescale choice the
          // drawer surfaces on re-calibration. The hook PATCHes the
          // sheet calibration endpoint with
          // `existingMeasurementHandling`, which decides whether
          // existing measurements rescale or get snapshotted at the
          // OLD px/ft.
          const ok = await handleSaveCalibration(distanceFt, options);
          if (ok) {
            closeCalibrationDrawer();
          }
        }}
        onUseStandardScale={() => {
          // "Use Standard Scale instead" hands off to the existing
          // PlanScaleModal. Must go through the shared close helper
          // so we don't leak `activeTool: "calibrate"` /
          // `calibrationMode: "first-point"` into the next user
          // interaction (canvas clicks would still be interpreted
          // as calibration picks otherwise).
          closeCalibrationDrawer();
          setScaleModalOpen(true);
        }}
        onShowScaleHistory={() => {
          // Task #2325 — Open the Scale History panel for the
          // currently selected sheet. We don't close the drawer
          // since the panel is anchored to the opposite side and
          // both can co-exist (the user often wants to see the
          // historical context while re-calibrating). The button
          // is always rendered (so the affordance is visible the
          // moment the drawer opens), but it no-ops if no sheet
          // is selected to avoid opening the panel against `null`.
          if (selectedSheet) setScaleHistorySheetId(selectedSheet);
        }}
        multiCalibMode={multiCalibMode}
        setMultiCalibMode={setMultiCalibMode}
        multiCalibPoints={multiCalibPoints}
        setMultiCalibPoints={setMultiCalibPoints}
        activeSheetSet={
          activeSheetSetId && activeSheetSetDetail
            ? {
                id: activeSheetSetDetail.id,
                name: activeSheetSetDetail.name,
                memberCount: activeSheetSetDetail.members?.length ?? 0,
              }
            : null
        }
        onApplyToSheetSet={handleApplyScaleToSheetSet}
        defaultApplyToSheetSet={calibrationDefaultApplyToSet}
        skipBulkScalePropagationConfirm={skipBulkScalePropagationConfirm}
        onSkipBulkScalePropagationConfirmChange={
          handleSkipBulkScalePropagationConfirmChange
        }
        aiDetectedScale={
          // Task #2320 — Forward the live AI detector result so the
          // drawer can compare it against the user's typed
          // calibration distance and warn on a >5% delta. We only
          // pass `label` + `pxPerFoot` (drawer doesn't need the raw
          // text or confidence enum to compute the warning), and
          // gate on a positive ratio so a malformed detector hit
          // never trips the warning math.
          detectedScale && detectedScale.pxPerFoot > 0
            ? {
                label: detectedScale.label,
                pxPerFoot: detectedScale.pxPerFoot,
              }
            : null
        }
        // Task #2326 — Drives the lock-vs-rescale prompt in the
        // drawer. The radio only renders when this is > 0 AND the
        // sheet has a prior `scalePxPerFoot`, so brand-new sheets
        // skip the prompt entirely.
        existingMeasurementCount={measurements.length}
        selectedCalibrationZoneId={selectedCalibrationZoneId}
        onSelectCalibrationZone={setSelectedCalibrationZoneId}
        activeCalibrationZoneId={activeCalibrationZone?.id ?? null}
        zoneDrawingActive={zoneDrawingActive}
        onStartZoneDraw={() => {
          setZoneDrawPoints([]);
          setZoneDrawingActive(true);
        }}
        onCancelZoneDraw={() => {
          setZoneDrawingActive(false);
          setZoneDrawPoints([]);
        }}
        zoneDrawPoints={zoneDrawPoints}
        pendingZonePoints={pendingZonePoints}
        onClearPendingZone={() => setPendingZonePoints(null)}
        editingZoneId={editingZoneId}
        onEditPolygon={handleStartZoneEdit}
        onSaveZoneEdit={handleSaveZoneEdit}
        onCancelZoneEdit={handleCancelZoneEdit}
      />

      {/* Task #2325 — Scale History side panel. Mounted alongside the
          calibration drawer so opening one doesn't close the other.
          Sheet name is read off the live `sheets` query so the title
          stays in sync if the user renames the sheet mid-session. */}
      <ScaleHistoryPanel
        open={!!scaleHistorySheetId}
        onOpenChange={(next) => {
          if (!next) setScaleHistorySheetId(null);
        }}
        sheetId={scaleHistorySheetId}
        sheetName={
          scaleHistorySheetId
            ? sheets.find((s) => s.id === scaleHistorySheetId)?.sheetName ?? null
            : null
        }
      />

      <Dialog open={dimInputOpen} onOpenChange={setDimInputOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="dialog-dim-input">
          <DialogHeader>
            <DialogTitle>Dimension Input</DialogTitle>
            <DialogDescription>
              Type the exact length (in feet) for the next vertex. The
              segment will lock to that distance along your cursor
              direction. With <strong>Repeat</strong> off, the lock
              clears after one click; with it on, the same length stays
              active across every click until you clear it — useful for
              laying out polygons or segment chains at a fixed step.
              Press <kbd className="px-1 rounded border bg-muted text-[10px]">Tab</kbd>{" "}
              while drawing to reopen this dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="dim-input-length">Length (ft)</Label>
              <Input
                id="dim-input-length"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 12.5"
                value={dimInputValue}
                onChange={(e) => setDimInputValue(e.target.value)}
                data-testid="input-dim-length"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = parseFloat(dimInputValue);
                    if (Number.isFinite(v) && v > 0) {
                      setPendingDimLengthFt(v);
                      setDimInputOpen(false);
                      toast({
                        title: dimInputRepeat
                          ? "Length Chained"
                          : "Length Locked",
                        description: dimInputRepeat
                          ? `Each click will commit at ${v.toFixed(2)} ft until you clear.`
                          : `Next vertex will commit at ${v.toFixed(2)} ft.`,
                      });
                    }
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2">
              <div className="space-y-0.5">
                <Label
                  htmlFor="switch-dim-repeat"
                  className="text-sm font-medium cursor-pointer"
                >
                  Repeat / chain
                </Label>
                <p className="text-xs text-muted-foreground">
                  Keep this length active across every click.
                </p>
              </div>
              <Switch
                id="switch-dim-repeat"
                checked={dimInputRepeat}
                onCheckedChange={setDimInputRepeat}
                data-testid="switch-dim-repeat"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPendingDimLengthFt(null);
                setDimInputValue("");
                setDimInputOpen(false);
              }}
              data-testid="button-dim-clear"
            >
              Clear
            </Button>
            <Button
              onClick={() => {
                const v = parseFloat(dimInputValue);
                if (!Number.isFinite(v) || v <= 0) {
                  toast({
                    title: "Invalid length",
                    description: "Enter a positive number of feet.",
                    variant: "destructive",
                  });
                  return;
                }
                setPendingDimLengthFt(v);
                setDimInputOpen(false);
                toast({
                  title: dimInputRepeat ? "Length Chained" : "Length Locked",
                  description: dimInputRepeat
                    ? `Each click will commit at ${v.toFixed(2)} ft until you clear.`
                    : `Next vertex will commit at ${v.toFixed(2)} ft.`,
                });
              }}
              data-testid="button-dim-apply"
            >
              {dimInputRepeat ? "Chain Length" : "Lock Length"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex flex-col bg-muted/30 min-h-0 relative">
        <SheetHost />

        <CanvasHost />
        {/* Task #2786 — Transparent DOM mirror of each calibration zone polygon.
            Konva Line elements have no DOM nodes; these zero-opacity,
            pointer-events:none SVG polygons give e2e tests a stable
            data-testid handle for render assertions and coordinate look-up
            without affecting normal user interaction. */}
        {calibrationZones.length > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
              {calibrationZones.map((zone) => (
                <polygon
                  key={zone.id}
                  data-testid={`canvas-zone-polygon-${zone.id}`}
                  points={zone.polygon_points
                    .map((p) => `${p.x * stageScale + stagePosition.x},${p.y * stageScale + stagePosition.y}`)
                    .join(" ")}
                  style={{ opacity: 0, pointerEvents: "none" }}
                />
              ))}
            </svg>
          </div>
        )}
        <WorkspaceBottomBar {...panelSlice.bottomBar} />
        {/* Tool Chest mounts inside canvas-area so its `top-0 left-0`
            absolute positioning sits *below* the unified ribbon. The
            host pulls its props from the panel slice (same context as
            PanelHost) so the data flow stays slice-driven. */}
        <ToolChestHost />
      </div>


      <PanelHost />
      {sheetSetsCtxId && (
        <SheetSetsPanel
          open={sheetSetsPanelOpen}
          onClose={() => setSheetSetsPanelOpen(false)}
          projectId={
            context?.type === "project"
              ? context.projectId
              : projectId ?? null
          }
          bidId={context?.type === "bid" ? context.bidId : null}
          sheets={sheets}
          selectedSheet={selectedSheet}
          onSelectSheet={setSelectedSheet}
          activeSetId={activeSheetSetId}
          onSetActive={setActiveSheetSetId}
          onCalibrateSet={handleCalibrateSet}
          multiSelection={multiSheetSelection}
          onClearMultiSelection={() => setMultiSheetSelection(new Set())}
        />
      )}
      {context && context.type !== "standalone" && (
        <ProjectFilesPanel
          open={projectFilesPanelOpen}
          onClose={() => setProjectFilesPanelOpen(false)}
          contextType={context.type}
          contextId={context.type === "bid" ? context.bidId : context.projectId}
          contextCode={context.type === "bid" ? context.bidCode : context.projectCode}
          contextLabel={context.type === "bid" ? context.bidCode : context.projectCode}
          sheets={sheets}
          selectedSheet={selectedSheet}
          onSelectSheet={setSelectedSheet}
        />
      )}
      {/* Task #2629 / #2652 — Optimistic-concurrency conflict
          resolution. Surfaces when PATCH /api/takeoff/measurements/:id
          returns 409 because the row's `version` advanced while we
          were editing. The dialog (extracted in #2652) shows a
          per-field diff between the user's pending edit and the
          teammate's saved row, names the teammate from the latest
          audit_log UPDATE row, and lets the user keep theirs, keep
          mine, or hand-merge field-by-field. Apply re-PATCHes with
          `forceOverwrite` so the server accepts the merged values
          past the version-CAS. */}
      {data.measurementConflict && (
        <MeasurementConflictDialog
          conflict={data.measurementConflict}
          onDismiss={() => data.dismissMeasurementConflict()}
          onApply={(mergedEdit) => {
            const c = data.measurementConflict;
            if (!c) return;
            data.updateMeasurementMutation.mutate({
              id: c.measurementId,
              ...(mergedEdit as Record<string, unknown>),
              forceOverwrite: true,
              skipHistory: true,
            } as Parameters<typeof data.updateMeasurementMutation.mutate>[0]);
            data.dismissMeasurementConflict();
          }}
        />
      )}
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
