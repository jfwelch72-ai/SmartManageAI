import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Save, Layers, Eye, EyeOff, CheckCircle2, AlertTriangle, AlertCircle, Target, Info, Ruler, X,
  History, ChevronDown, ChevronRight, ChevronLeft, GitCompare, Pen, Square, Highlighter, Type, Spline, Flag, BookOpen, Copy, Download,
  FolderPlus, GripVertical, FolderOpen, Loader2, MapPin, Search, ArrowUpDown, Tag
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { COMMON_SCALES, type Tool, type AddendumOverlayData } from "./types";
import { computePixelDistance, computeNetAreaInFt2, computePolygonAreaInFt2 } from "@shared/utils/geometry";
import { evaluateFormula, computeAssemblyResults, type FormulaContext } from "@shared/utils/assemblyFormula";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AssemblyPanel from "@/components/AssemblyPanel";
import LibraryItemDialog from "@/components/LibraryItemDialog";
import { IssuesTab } from "./IssuesTab";
import type { TakeoffSheet, TakeoffMeasurement, TakeoffMeasurementGroup, QuantityCategory, TakeoffCondition, AssemblyComponent } from "@shared/schema";
import type { TakeoffMarkupWithAuthor } from "@/hooks/use-takeoff-data";
import { Zap, Star, Upload as UploadIcon, FileDown, FolderInput } from "lucide-react";
import { FormulaEditor } from "./FormulaEditor";

function CostCodeField({ measurementId, currentValue, onCommit }: { measurementId: string; currentValue: string; onCommit: (val: string) => void }) {
  const [localValue, setLocalValue] = useState(currentValue);
  const lastCommitted = useState({ value: currentValue })[0];

  useEffect(() => {
    setLocalValue(currentValue);
    lastCommitted.value = currentValue;
  }, [currentValue, measurementId]);

  const commit = (val: string) => {
    if (val !== lastCommitted.value) {
      lastCommitted.value = val;
      onCommit(val);
    }
  };

  return (
    <div className="space-y-2" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { commit(localValue); } }}>
      <Label className="text-xs">Cost Code</Label>
      <CostCodeCombobox value={localValue} onChange={(val) => { setLocalValue(val); if (val.includes(" - ")) { commit(val); } }} data-testid="input-cost-code" />
    </div>
  );
}

interface LocationOption {
  id: string;
  name: string;
  level: string;
  parentId: string | null;
}

function LocationPickerField({ projectId, currentValue, onCommit, workspaceRef }: {
  projectId: string;
  currentValue: string | null;
  onCommit: (val: string | null) => void;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { data: locations = [] } = useQuery<LocationOption[]>({
    queryKey: ["/api/projects", projectId, "locations"],
    enabled: !!projectId,
  });

  if (locations.length === 0) return null;

  const buildLabel = (loc: LocationOption): string => {
    const parent = loc.parentId ? locations.find(l => l.id === loc.parentId) : null;
    return parent ? `${parent.name} > ${loc.name}` : loc.name;
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1">
        <MapPin className="h-3 w-3" />
        Location
      </Label>
      <Select
        value={currentValue || "__none__"}
        onValueChange={(val) => onCommit(val === "__none__" ? null : val)}
        data-testid="select-measurement-location"
      >
        <SelectTrigger className="h-8 text-sm" data-testid="select-trigger-measurement-location">
          <SelectValue placeholder="No Location" />
        </SelectTrigger>
        <SelectContent container={workspaceRef.current}>
          <SelectItem value="__none__">No Location</SelectItem>
          {locations.map(l => (
            <SelectItem key={l.id} value={l.id}>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{l.level}</span>
                <span>{buildLabel(l)}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface TakeoffSidebarProps {
  selectedSheet: string | null;
  currentSheet: TakeoffSheet | undefined;
  projectId: string;
  calibrationMode: "idle" | "first-point" | "second-point";
  calibrationPoints: { x: number; y: number }[];
  calibrationDistance: string;
  setCalibrationDistance: (v: string) => void;
  units: "ft" | "m";
  setUnits: (v: "ft" | "m") => void;
  onSaveCalibration: () => void;
  activeTool: Tool;
  categories: QuantityCategory[];
  selectedCategoryId: string | null;
  setSelectedCategoryId: (v: string | null) => void;
  setCategoryDialogOpen: (v: boolean) => void;
  setEditingCategory: (v: QuantityCategory | null) => void;
  onDeleteCategory: (id: string) => void;
  hiddenCategoryIds: Set<string>;
  onToggleCategoryVisibility: (id: string) => void;
  pitchRatio: string;
  setPitchRatio: (v: string) => void;
  dropDistance: string;
  setDropDistance: (v: string) => void;
  measurements: TakeoffMeasurement[];
  selectedMeasurementId: string | null;
  setSelectedMeasurementId: (v: string | null) => void;
  selectedSegmentIndex: number | null;
  setSelectedSegmentIndex: (v: number | null) => void;
  deleteMeasurementMutation: any;
  updateMeasurementMutation: any;
  // Task #1770 — wires the bulk category assignment in this sidebar
  // (and any future bulk measurement edit) into the same Undo/Redo
  // batch entry the workspace uses for markups (#1755/#1758). Optional
  // so existing test mounts continue to compile; without it, the bulk
  // path simply skips the history push (preserving today's "no entry"
  // behavior instead of regressing to N entries).
  pushMeasurementUpdateBatch?: (
    before: { id: string; categoryId?: string | null }[],
    after: { id: string; categoryId?: string | null }[],
    sheetId: string,
  ) => void;
  aggregatedMeasurements: any;
  projectAddenda: AddendumOverlayData[];
  addendaOverlays: Record<string, { visible: boolean; opacity: number; imageUrl?: string }>;
  setAddendaOverlays: (v: any) => void;
  verifyMode: "idle" | "first-point" | "second-point";
  setVerifyMode: (v: "idle" | "first-point" | "second-point") => void;
  verifyPoints: { x: number; y: number }[];
  setVerifyPoints: (v: { x: number; y: number }[]) => void;
  verifyExpectedDistance: string;
  setVerifyExpectedDistance: (v: string) => void;
  verifyResult: { expected: number; measured: number; errorPct: number } | null;
  setVerifyResult: (v: any) => void;
  multiCalibMode: boolean;
  setMultiCalibMode: (v: boolean) => void;
  multiCalibPoints: Array<{ points: [{ x: number; y: number }, { x: number; y: number }]; distance: number }>;
  setMultiCalibPoints: (v: any) => void;
  setCalibrationMode: (v: "idle" | "first-point" | "second-point") => void;
  setCalibrationPoints: (v: { x: number; y: number }[]) => void;
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  aiPanelOpen: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onApplyPresetScale: (scaleCategory: string, selectedPresetScale: string, resetFn: () => void) => void;
  sheets?: any[];
  sheetsQueryKey?: string[];
  onCompareRevisions?: () => void;
  onSelectSheet?: (id: string) => void;
  markups?: TakeoffMarkupWithAuthor[];
  deleteMarkupMutation?: any;
  measurementGroups?: TakeoffMeasurementGroup[];
  createGroupMutation?: any;
  updateGroupMutation?: any;
  deleteGroupMutation?: any;
  toggleGroupVisibilityMutation?: any;
  issues?: any[];
  allSheetIssues?: any[];
  selectedIssueId?: string | null;
  onSelectIssue?: (issue: any) => void;
  onExportCurrentSheet?: () => void;
  onExportAllSheets?: () => void;
  onExportQuantityDelta?: () => void;
  onExportBidPackage?: () => void;
  onPrintSheet?: () => void;
  onZoomToMeasurement?: (measurement: TakeoffMeasurement) => void;
  onZoomToFitMeasurement?: (measurement: TakeoffMeasurement) => void;
  conditions?: TakeoffCondition[];
  activeCondition?: TakeoffCondition | null;
  onActivateCondition?: (condition: TakeoffCondition) => void;
  onClearCondition?: () => void;
  onSaveCondition?: (data: { name: string; measurementType: string; color: string; categoryName?: string; unitCost?: number; costCodeId?: string; labelTemplate?: string; lineStyle?: string; formula?: string; assemblyComponents?: string }) => void;
  onUpdateCondition?: (data: { id: string; [key: string]: string | number | boolean | undefined }) => void;
  onDeleteCondition?: (id: string) => void;
  saveConditionPending?: boolean;
  hideAiMeasurements?: boolean;
  setHideAiMeasurements?: (v: boolean) => void;
  measurementLinks?: { hasPR: Set<string>; hasCO: Set<string>; hasSOV: Set<string> };
  typicals?: Array<{ id: string; name: string; measurementIds: string[]; sheetId: string }>;
  onSaveTypical?: (name: string, measurementIds: string[]) => void;
  onDeleteTypical?: (id: string) => void;
  onStampTypical?: (typicalId: string) => void;
  structuralGridlines?: {
    horizontal: Array<{ label: string; position: number }>;
    vertical: Array<{ label: string; position: number }>;
  };
  onUpdateGridlines?: (gridlines: { horizontal: Array<{ label: string; position: number }>; vertical: Array<{ label: string; position: number }> }) => void;
  labelHiddenCategories?: Set<string>;
  onToggleLabelCategory?: (catId: string) => void;
  showMeasurementLabels?: boolean;
}

interface MeasurementMeta {
  unit?: string;
  quantity?: number;
  confidence?: number;
  costCodeId?: string;
  unitCost?: number;
  computedSurfaceAreaFt2?: number;
  pitchRatio?: string;
  segmentProperties?: Array<{ label?: string; color?: string }>;
  [key: string]: unknown;
}

function parseMeta(metadata: string | null | undefined | Record<string, unknown>): MeasurementMeta {
  if (!metadata) return {};
  try {
    return typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  } catch {
    return {};
  }
}

export function TakeoffSidebar(props: TakeoffSidebarProps) {
  const { toast } = useToast();
  const [scaleCategory, setScaleCategory] = useState<string>("");
  const [selectedPresetScale, setSelectedPresetScale] = useState<string>("");

  const {
    selectedSheet, currentSheet, projectId,
    calibrationMode, calibrationPoints, calibrationDistance, setCalibrationDistance,
    units, setUnits, onSaveCalibration,
    activeTool, categories, selectedCategoryId, setSelectedCategoryId,
    setCategoryDialogOpen, setEditingCategory, onDeleteCategory,
    hiddenCategoryIds, onToggleCategoryVisibility,
    pitchRatio, setPitchRatio, dropDistance, setDropDistance,
    measurements, selectedMeasurementId, setSelectedMeasurementId,
    selectedSegmentIndex, setSelectedSegmentIndex,
    deleteMeasurementMutation, updateMeasurementMutation, pushMeasurementUpdateBatch, aggregatedMeasurements,
    projectAddenda, addendaOverlays, setAddendaOverlays,
    verifyMode, setVerifyMode, verifyPoints, setVerifyPoints,
    verifyExpectedDistance, setVerifyExpectedDistance, verifyResult, setVerifyResult,
    multiCalibMode, setMultiCalibMode, multiCalibPoints, setMultiCalibPoints,
    setCalibrationMode, setCalibrationPoints,
    workspaceRef, aiPanelOpen, collapsed, onToggleCollapse, onApplyPresetScale,
    sheets = [], sheetsQueryKey, onCompareRevisions, onSelectSheet,
    markups = [], deleteMarkupMutation,
    measurementGroups = [], createGroupMutation, updateGroupMutation, deleteGroupMutation, toggleGroupVisibilityMutation,
    issues = [], allSheetIssues = [], selectedIssueId = null, onSelectIssue,
    onExportCurrentSheet, onExportAllSheets,
    onExportQuantityDelta, onExportBidPackage, onPrintSheet,
    onZoomToMeasurement, onZoomToFitMeasurement,
    conditions = [], activeCondition = null, onActivateCondition, onClearCondition,
    onSaveCondition, onUpdateCondition, onDeleteCondition, saveConditionPending = false,
    hideAiMeasurements = false, setHideAiMeasurements,
    measurementLinks,
    typicals = [], onSaveTypical, onDeleteTypical, onStampTypical,
    structuralGridlines = { horizontal: [], vertical: [] }, onUpdateGridlines,
    labelHiddenCategories = new Set(), onToggleLabelCategory,
    showMeasurementLabels = true,
  } = props;

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { return () => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); }; }, []);
  const [markupsPanelOpen, setMarkupsPanelOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"tools" | "conditions" | "issues">("tools");
  const [saveToLibraryOpen, setSaveToLibraryOpen] = useState(false);
  const [propagateDialogOpen, setPropagateDialogOpen] = useState(false);
  const [propagateMode, setPropagateMode] = useState<"all" | "same-plan">("all");
  const [isPropagating, setIsPropagating] = useState(false);
  const [saveToLibraryItem, setSaveToLibraryItem] = useState<{ name: string; unitOfMeasure: string; costTypes: string[]; unitCosts: Record<string, string>; notes: string } | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLabel, setQuickAddLabel] = useState("");
  const [quickAddType, setQuickAddType] = useState<string>("COUNT");
  const [quickAddQty, setQuickAddQty] = useState("1");
  const [showSummaryReport, setShowSummaryReport] = useState(false);
  const [quickAddUnit, setQuickAddUnit] = useState("EA");
  const [quickAddCategory, setQuickAddCategory] = useState<string>("");
  const [quickAddPending, setQuickAddPending] = useState(false);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditLabel, setInlineEditLabel] = useState("");
  const [inlineEditQty, setInlineEditQty] = useState("");
  const [inlineEditUnit, setInlineEditUnit] = useState("");
  const [inlineEditCost, setInlineEditCost] = useState("");
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState("");
  const [bulkPastePending, setBulkPastePending] = useState(false);
  const [measurementSearch, setMeasurementSearch] = useState("");
  const [measurementSort, setMeasurementSort] = useState<"default" | "type" | "value">("default");

  const typeBadgeStyles: Record<string, string> = {
    LINEAR: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    LINEAR_WITH_DROP: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    PITCHED_LINEAR: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800",
    AREA: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    PITCHED_AREA: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    SURFACE_AREA: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    VOLUME: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    COUNT: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-800",
    SEGMENT: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800",
    NOTE: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  };

  const typeLabels: Record<string, string> = {
    LINEAR: "LIN", LINEAR_WITH_DROP: "DROP", PITCHED_LINEAR: "P-LIN",
    AREA: "AREA", PITCHED_AREA: "P-AREA", SURFACE_AREA: "SURF",
    VOLUME: "VOL", COUNT: "CNT", SEGMENT: "SEG", NOTE: "NOTE",
  };

  const getMeasurementValue = (m: TakeoffMeasurement): string => {
    if ((m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "SEGMENT") && m.computedLengthFt)
      return `${Number(m.computedLengthFt).toFixed(1)} LF`;
    if ((m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && (m.computedAreaFt2 || (m as any).computedSurfaceAreaFt2))
      return `${Number((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2).toFixed(1)} SF`;
    if (m.type === "VOLUME" && m.computedVolumeCy) return `${Number(m.computedVolumeCy).toFixed(2)} CY`;
    if (m.type === "COUNT") {
      const meta = parseMeta(m.metadata);
      return `${m.count ?? meta.quantity ?? 1} ${meta.unit || "EA"}`;
    }
    return "";
  };

  const filterAndSortMeasurements = (items: TakeoffMeasurement[]): TakeoffMeasurement[] => {
    let result = items;
    if (measurementSearch.trim()) {
      const q = measurementSearch.toLowerCase();
      result = result.filter(m => {
        const label = (m.label || "").toLowerCase();
        const cat = categories.find(c => c.id === m.categoryId);
        const catName = (cat?.name || "").toLowerCase();
        return label.includes(q) || catName.includes(q) || m.type.toLowerCase().includes(q);
      });
    }
    if (measurementSort === "type") {
      result = [...result].sort((a, b) => a.type.localeCompare(b.type));
    } else if (measurementSort === "value") {
      result = [...result].sort((a, b) => {
        const numVal = (m: TakeoffMeasurement) => {
          const meta = parseMeta(m.metadata);
          return Number((meta as any).computedSurfaceAreaFt2 || m.computedLengthFt || m.computedAreaFt2 || m.computedVolumeCy || m.count || 0);
        };
        return numVal(b) - numVal(a);
      });
    }
    return result;
  };

  const exportGroupCSV = (groupName: string, items: TakeoffMeasurement[]) => {
    const rows = [["Label", "Type", "Length (LF)", "Area (SF)", "Volume (CY)", "Category", "Line Style", "Line Width"]];
    items.forEach((m) => {
      const cat = categories.find(c => c.id === m.categoryId);
      rows.push([
        m.label || "Untitled",
        m.type,
        m.computedLengthFt ? String(m.computedLengthFt.toFixed(2)) : "",
        m.computedAreaFt2 ? String(m.computedAreaFt2.toFixed(2)) : "",
        m.computedVolumeCy ? String(m.computedVolumeCy.toFixed(2)) : "",
        cat?.name || "",
        m.lineStyle || "solid",
        String(m.lineWidth || 3),
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${groupName.replace(/[^a-zA-Z0-9]/g, "_")}_measurements.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${items.length} measurements exported as CSV` });
  };

  const handleQuickAdd = async () => {
    if (!selectedSheet || !quickAddLabel.trim()) return;
    setQuickAddPending(true);
    try {
      await apiRequest("POST", "/api/takeoff/measurements", {
        sheetId: selectedSheet,
        type: quickAddType,
        points: [{ x: 100, y: 100 }],
        label: quickAddLabel.trim(),
        count: quickAddType === "COUNT" ? parseInt(quickAddQty) || 1 : undefined,
        categoryId: quickAddCategory || undefined,
        source: "MANUAL",
        metadata: JSON.stringify({ unit: quickAddUnit, quantity: parseInt(quickAddQty) || 1 }),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      toast({ title: "Item Added", description: `Added "${quickAddLabel.trim()}" to measurements` });
      setQuickAddLabel("");
      setQuickAddQty("1");
      setQuickAddUnit("EA");
      setQuickAddCategory("");
    } catch {
      toast({ title: "Failed to add item", variant: "destructive" });
    } finally {
      setQuickAddPending(false);
    }
  };

  const handleBulkDelete = async () => {
    if (bulkSelectedIds.size === 0) return;
    const ids = Array.from(bulkSelectedIds);
    for (const id of ids) {
      const m = measurements.find(mm => mm.id === id);
      if (m) deleteMeasurementMutation.mutate(m);
    }
    setBulkSelectedIds(new Set());
    setBulkSelectMode(false);
  };

  // Task #1770 — collapse a multi-select category assignment into a
  // single MEASUREMENT_UPDATE_BATCH history entry so one Undo press
  // restores every member's prior categoryId (mirrors #1755/#1758 for
  // markups). Capture the per-id `before` snapshot from the cached
  // `measurements` prop BEFORE firing any mutation, skip no-op members
  // (already in the target category), then fan out per-id PATCHes with
  // `skipHistory: true` so the per-call path doesn't add its own entry.
  // Using `mutateAsync` + `Promise.all` ensures the batch entry is only
  // pushed after every PATCH lands, matching the markup pattern.
  const handleBulkCategoryAssign = async (categoryId: string) => {
    if (bulkSelectedIds.size === 0) return;
    const ids = Array.from(bulkSelectedIds);
    const beforeSnaps: { id: string; categoryId: string | null }[] = [];
    const afterSnaps: { id: string; categoryId: string | null }[] = [];
    for (const id of ids) {
      const m = measurements.find(mm => mm.id === id);
      if (!m) continue;
      if ((m.categoryId ?? null) === categoryId) continue;
      beforeSnaps.push({ id, categoryId: m.categoryId ?? null });
      afterSnaps.push({ id, categoryId });
    }
    if (afterSnaps.length === 0) {
      setBulkSelectedIds(new Set());
      return;
    }
    try {
      await Promise.all(
        afterSnaps.map(s =>
          updateMeasurementMutation.mutateAsync({ id: s.id, categoryId, skipHistory: true }),
        ),
      );
      if (selectedSheet && pushMeasurementUpdateBatch) {
        pushMeasurementUpdateBatch(beforeSnaps, afterSnaps, selectedSheet);
      }
      setBulkSelectedIds(new Set());
      toast({ title: "Category assigned", description: `Updated ${afterSnaps.length} items` });
    } catch {
      // updateMeasurementMutation.onError already shows a toast.
    }
  };

  const handleInlineEditSave = (mId: string) => {
    const updates: { id: string; label?: string; count?: number; metadata?: string; previous?: { label?: string | null; metadata?: string | null } } = { id: mId };
    if (inlineEditLabel.trim()) updates.label = inlineEditLabel.trim();
    if (inlineEditQty) updates.count = parseInt(inlineEditQty) || undefined;

    const m = measurements.find(mm => mm.id === mId);
    const existingMeta = m ? parseMeta(m.metadata) : {};
    const metaUpdates: Record<string, unknown> = { ...existingMeta };

    if (inlineEditUnit.trim()) {
      metaUpdates.unit = inlineEditUnit.trim();
    }
    if (inlineEditCost) {
      const cost = parseFloat(inlineEditCost);
      if (!isNaN(cost)) {
        metaUpdates.unitCost = cost;
      }
    } else {
      delete metaUpdates.unitCost;
    }

    updates.metadata = JSON.stringify(metaUpdates);
    // Task #1843 — capture before-state so the inline label rename is
    // undoable in a single Cmd+Z press. `count` is intentionally not
    // restored here because the mutation type doesn't expose it on the
    // `previous` payload; the rename + metadata pair covers the common
    // case (label and unit/cost edits).
    if (m) {
      updates.previous = {
        label: m.label ?? null,
        metadata: typeof m.metadata === "string" ? m.metadata : (m.metadata == null ? null : JSON.stringify(m.metadata)),
      };
    }
    updateMeasurementMutation.mutate(updates);
    setInlineEditId(null);
  };

  const handleBulkPaste = async () => {
    if (!selectedSheet || !bulkPasteText.trim()) return;
    setBulkPastePending(true);
    const lines = bulkPasteText.trim().split("\n").filter(l => l.trim());
    let added = 0;
    let errors = 0;
    for (const line of lines) {
      const parts = line.split(/[\t,]/).map(p => p.trim());
      const label = parts[0] || "Item";
      const qty = parseInt(parts[1]) || 1;
      const unit = parts[2] || "EA";
      try {
        await apiRequest("POST", "/api/takeoff/measurements", {
          sheetId: selectedSheet,
          type: "COUNT",
          points: [{ x: 100 + added * 30, y: 100 + added * 30 }],
          label,
          count: qty,
          source: "MANUAL",
          metadata: JSON.stringify({ unit, quantity: qty }),
        });
        added++;
      } catch { errors++; }
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
    toast({ title: "Bulk Paste Complete", description: `Added ${added} items${errors > 0 ? `, ${errors} failed` : ""}` });
    setBulkPasteText("");
    setBulkPasteOpen(false);
    setBulkPastePending(false);
  };

  const handleDuplicateMeasurement = async (m: TakeoffMeasurement) => {
    if (!selectedSheet) return;
    try {
      const pts = typeof m.points === "string" ? JSON.parse(m.points) : m.points;
      const offsetPts = Array.isArray(pts) ? pts.map((p: { x: number; y: number }) => ({ x: (p.x || 0) + 30, y: (p.y || 0) + 30 })) : [{ x: 130, y: 130 }];
      await apiRequest("POST", "/api/takeoff/measurements", {
        sheetId: selectedSheet,
        type: m.type,
        points: offsetPts,
        label: `${m.label || "Untitled"} (copy)`,
        count: m.count,
        categoryId: m.categoryId || undefined,
        source: "MANUAL",
        metadata: m.metadata || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      toast({ title: "Duplicated", description: `Cloned "${m.label || "Untitled"}"` });
    } catch {
      toast({ title: "Failed to duplicate", variant: "destructive" });
    }
  };

  const openIssueCount = allSheetIssues.filter((i: any) => i.status === "OPEN").length;
  const [conditionDialogOpen, setConditionDialogOpen] = useState(false);
  const [editingCondition, setEditingCondition] = useState<TakeoffCondition | null>(null);
  const [condForm, setCondForm] = useState({ name: "", measurementType: "LINEAR", color: "#3b82f6", categoryName: "", unitCost: "", costCodeId: "", labelTemplate: "", lineStyle: "solid", formula: "", assemblyComponents: [] as AssemblyComponent[] });
  const [condSearchQuery, setCondSearchQuery] = useState("");
  const [condShowFavoritesOnly, setCondShowFavoritesOnly] = useState(false);
  const [applyToProjectOpen, setApplyToProjectOpen] = useState(false);
  const [applyProjectCode, setApplyProjectCode] = useState("");
  const [applySelectedIds, setApplySelectedIds] = useState<Set<string>>(new Set());
  const [applyPending, setApplyPending] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const { data: scaleTemplates = [] } = useQuery<Array<{ id: string; name: string; label: string; pxPerFoot: number; category: string }>>({
    queryKey: ["/api/takeoff/scale-templates"],
  });

  const revisionChain = (() => {
    if (!currentSheet) return [];
    const chain: any[] = [];
    const allSheets = sheets as any[];
    let s: any = allSheets.find((x: any) => x.id === currentSheet.id);
    if (!s) return [];
    chain.push(s);
    while (s && (s as any).supersededById) {
      const next = allSheets.find((x: any) => x.id === (s as any).supersededById);
      if (!next) break;
      chain.push(next);
      s = next;
    }
    const predecessors: any[] = [];
    let cursor: any = allSheets.find((x: any) => x.id === currentSheet.id);
    while (cursor) {
      const pred = allSheets.find((x: any) => x.supersededById === cursor.id);
      if (!pred) break;
      predecessors.unshift(pred);
      cursor = pred;
    }
    return [...predecessors, ...chain];
  })();

  if (collapsed) {
    return (
      <div className={cn("hidden sm:flex w-9 bg-card border-l flex-col shrink-0 items-center py-2 gap-1", aiPanelOpen && "hidden md:flex")}>
        <button
          onClick={onToggleCollapse}
          className="w-7 h-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground"
          data-testid="button-expand-takeoff-sidebar"
          title="Expand sidebar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setSidebarTab("tools"); onToggleCollapse?.(); }}
          className={cn("w-7 h-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground", sidebarTab === "tools" && "text-primary")}
          data-testid="button-expand-tab-tools"
          title="Takeoff"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={() => { setSidebarTab("conditions"); onToggleCollapse?.(); }}
          className={cn("w-7 h-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground relative", sidebarTab === "conditions" && "text-primary")}
          data-testid="button-expand-tab-conditions"
          title="Conditions"
        >
          <Zap className="w-4 h-4" />
          {activeCondition && (
            <span className="absolute top-0 right-0 w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: activeCondition.color }} />
          )}
        </button>
        <button
          onClick={() => { setSidebarTab("issues"); onToggleCollapse?.(); }}
          className={cn("w-7 h-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground relative", sidebarTab === "issues" && "text-primary")}
          data-testid="button-expand-tab-issues"
          title="Issues"
        >
          <Flag className="w-4 h-4" />
          {openIssueCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-3.5 h-3.5 flex items-center justify-center px-0.5">
              {openIssueCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("hidden sm:flex absolute top-0 right-0 h-full w-full sm:w-[320px] md:w-[340px] lg:w-[360px] bg-card border-l flex-col min-w-0 overflow-hidden shadow-2xl z-30", aiPanelOpen && "hidden md:flex")}>
      <div className="flex border-b shrink-0 bg-muted/30 items-stretch">
        <button
          onClick={onToggleCollapse}
          className="px-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 border-r shrink-0"
          data-testid="button-collapse-takeoff-sidebar"
          title="Collapse sidebar"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          className={cn("flex-1 py-2.5 text-xs font-medium transition-all relative", sidebarTab === "tools" ? "border-b-2 border-primary text-primary bg-card" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}
          onClick={() => setSidebarTab("tools")}
          data-testid="tab-tools"
        >
          <Layers className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
          Takeoff
        </button>
        <button
          className={cn("flex-1 py-2.5 text-xs font-medium transition-all relative", sidebarTab === "conditions" ? "border-b-2 border-primary text-primary bg-card" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}
          onClick={() => setSidebarTab("conditions")}
          data-testid="tab-conditions"
        >
          <Zap className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
          Conditions
          {activeCondition && (
            <span className="absolute top-1 right-2 w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: activeCondition.color }} />
          )}
        </button>
        <button
          className={cn("flex-1 py-2.5 text-xs font-medium transition-all relative", sidebarTab === "issues" ? "border-b-2 border-primary text-primary bg-card" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")}
          onClick={() => setSidebarTab("issues")}
          data-testid="tab-issues"
        >
          <Flag className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
          Issues
          {openIssueCount > 0 && (
            <span className="absolute top-1 right-3 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
              {openIssueCount}
            </span>
          )}
        </button>
      </div>

      {sidebarTab === "conditions" && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Takeoff Conditions</h3>
              <Button size="sm" onClick={() => { setEditingCondition(null); setCondForm({ name: "", measurementType: "LINEAR", color: "#3b82f6", categoryName: "", unitCost: "", costCodeId: "", labelTemplate: "", lineStyle: "solid", formula: "", assemblyComponents: [] }); setConditionDialogOpen(true); }} data-testid="button-add-condition">
                <Plus className="w-4 h-4 mr-1" />New
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  value={condSearchQuery}
                  onChange={(e) => setCondSearchQuery(e.target.value)}
                  placeholder="Search conditions..."
                  className="h-7 text-xs pl-7"
                  data-testid="input-search-conditions"
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={condShowFavoritesOnly ? "secondary" : "ghost"}
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setCondShowFavoritesOnly(!condShowFavoritesOnly)}
                    data-testid="button-toggle-favorites"
                  >
                    <Star className={cn("w-3.5 h-3.5", condShowFavoritesOnly && "fill-current text-yellow-500")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Show favorites only</p></TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 px-2"
                    onClick={async () => {
                      try {
                        const res = await apiRequest("GET", "/api/takeoff/conditions/export-csv");
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url; a.download = "conditions.csv"; a.click();
                        URL.revokeObjectURL(url);
                      } catch { /* ignore */ }
                    }}
                    data-testid="button-export-conditions-csv"
                  >
                    <FileDown className="w-3 h-3" />Export
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Export conditions as CSV</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 px-2"
                    onClick={() => csvInputRef.current?.click()}
                    data-testid="button-import-conditions-csv"
                  >
                    <UploadIcon className="w-3 h-3" />Import
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Import conditions from CSV</p></TooltipContent>
              </Tooltip>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const lines = text.split("\n").filter(l => l.trim());
                    if (lines.length < 2) return;
                    const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
                    const rows = [];
                    for (let i = 1; i < lines.length; i++) {
                      const vals = lines[i].match(/("(?:[^"]|"")*"|[^,]*)/g)?.map(v => v.replace(/^"|"$/g, "").replace(/""/g, '"').trim()) || [];
                      const row: Record<string, string> = {};
                      headers.forEach((h, idx) => {
                        const key = h === "Name" ? "name" : h === "Measurement Type" ? "measurementType" : h === "Color" ? "color" : h === "Category" ? "categoryName" : h === "Unit Cost" ? "unitCost" : h === "Cost Code" ? "costCodeId" : h === "Line Style" ? "lineStyle" : h === "Label Template" ? "labelTemplate" : h === "Formula" ? "formula" : h === "Assembly Components" ? "assemblyComponents" : h.toLowerCase();
                        row[key] = vals[idx] || "";
                      });
                      if (row.name && row.measurementType) rows.push(row);
                    }
                    if (rows.length > 0) {
                      await apiRequest("POST", "/api/takeoff/conditions/import-csv", { rows });
                      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/conditions"] });
                    }
                  } catch { /* ignore */ }
                  e.target.value = "";
                }}
                data-testid="input-csv-import-file"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 px-2"
                    onClick={() => {
                      setApplySelectedIds(new Set());
                      setApplyProjectCode("");
                      setApplyToProjectOpen(true);
                    }}
                    disabled={conditions.length === 0}
                    data-testid="button-apply-to-project"
                  >
                    <FolderInput className="w-3 h-3" />Apply to Project
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p className="text-xs">Apply selected conditions to another project</p></TooltipContent>
              </Tooltip>
            </div>

            <p className="text-xs text-muted-foreground">Click a condition to auto-select the tool and pre-assign properties for the next measurement.</p>

            {activeCondition && (
              <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/30 rounded-md">
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: activeCondition.color }} />
                <span className="text-xs font-medium flex-1 truncate">Active: {activeCondition.name}</span>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onClearCondition} data-testid="button-clear-active-condition">
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}

            {(() => {
              const filtered = conditions
                .filter((cond) => {
                  if (condShowFavoritesOnly && !cond.isFavorite) return false;
                  if (condSearchQuery) {
                    const q = condSearchQuery.toLowerCase();
                    return cond.name.toLowerCase().includes(q) ||
                      (cond.categoryName || "").toLowerCase().includes(q) ||
                      cond.measurementType.toLowerCase().includes(q);
                  }
                  return true;
                })
                .sort((a, b) => {
                  if (a.isFavorite && !b.isFavorite) return -1;
                  if (!a.isFavorite && b.isFavorite) return 1;
                  const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
                  const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
                  return bTime - aTime;
                });

              const grouped = new Map<string, typeof filtered>();
              for (const cond of filtered) {
                const key = cond.categoryName || "Uncategorized";
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key)!.push(cond);
              }

              return filtered.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <Zap className="w-8 h-8 mx-auto text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    {conditions.length === 0 ? "No conditions yet. Create one to speed up your takeoff workflow." : "No matching conditions found."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Array.from(grouped.entries()).map(([groupName, groupConds]) => (
                    <div key={groupName}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{groupName}</span>
                        <Badge variant="secondary" className="text-[9px] px-1 h-3.5">{groupConds.length}</Badge>
                      </div>
                  {groupConds.map((cond) => (
                    <div
                      key={cond.id}
                      className={cn(
                        "p-3 rounded-md border cursor-pointer hover-elevate transition-all",
                        activeCondition?.id === cond.id ? "ring-2 ring-primary bg-primary/5" : "bg-muted/50"
                      )}
                      onClick={() => onActivateCondition?.(cond)}
                      data-testid={`condition-item-${cond.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full shrink-0 border" style={{ backgroundColor: cond.color }} />
                        <span className="font-medium text-sm flex-1 truncate">{cond.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{cond.measurementType}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                        {cond.categoryName && <span className="bg-muted px-1.5 py-0.5 rounded">{cond.categoryName}</span>}
                        {cond.unitCost && <span className="bg-muted px-1.5 py-0.5 rounded">${Number(cond.unitCost).toFixed(2)}/unit</span>}
                        {cond.costCodeId && <span className="bg-muted px-1.5 py-0.5 rounded">{cond.costCodeId}</span>}
                        {cond.formula && <span className="bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded font-mono">{cond.formula}</span>}
                      </div>
                      <div className="mt-2 flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => {
                          e.stopPropagation();
                          apiRequest("PATCH", `/api/takeoff/conditions/${cond.id}/favorite`).then(() => {
                            queryClient.invalidateQueries({ queryKey: ["/api/takeoff/conditions"] });
                          }).catch(() => {});
                        }} data-testid={`button-toggle-favorite-${cond.id}`}>
                          <Star className={cn("w-3 h-3", cond.isFavorite && "fill-current text-yellow-500")} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setEditingCondition(cond); setCondForm({ name: cond.name, measurementType: cond.measurementType, color: cond.color, categoryName: cond.categoryName || "", unitCost: cond.unitCost ? String(cond.unitCost) : "", costCodeId: cond.costCodeId || "", labelTemplate: cond.labelTemplate || "", lineStyle: cond.lineStyle || "solid", formula: cond.formula || "", assemblyComponents: (() => { try { return cond.assemblyComponents ? JSON.parse(cond.assemblyComponents) : []; } catch { return []; } })() }); setConditionDialogOpen(true); }} data-testid={`button-edit-condition-${cond.id}`}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteCondition?.(cond.id); }} data-testid={`button-delete-condition-${cond.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                    </div>
                  ))}
                </div>
              );
            })()}

            {selectedMeasurementId && (() => {
              const selM = measurements.find(m => m.id === selectedMeasurementId);
              if (!selM) return null;
              const category = categories.find(c => c.id === selM.categoryId);
              return (
                <Card>
                  <CardContent className="pt-4 space-y-2">
                    <h4 className="text-xs font-semibold">Save as Condition</h4>
                    <p className="text-[10px] text-muted-foreground">Create a reusable condition from "{selM.label}"</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => {
                        setEditingCondition(null);
                        setCondForm({
                          name: selM.label || "New Condition",
                          measurementType: selM.type,
                          color: selM.color || "#3b82f6",
                          categoryName: category?.name || "",
                          unitCost: selM.unitCost ? String(selM.unitCost) : "",
                          costCodeId: selM.costCodeId || "",
                          labelTemplate: "",
                          lineStyle: "solid",
                          formula: "",
                          assemblyComponents: [],
                        });
                        setConditionDialogOpen(true);
                      }}
                      data-testid="button-save-as-condition"
                    >
                      <Save className="w-3 h-3 mr-1" /> Save as Condition
                    </Button>
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        </ScrollArea>
      )}

      {sidebarTab === "issues" && (
        <div className="flex-1 overflow-y-auto p-4">
          <IssuesTab
            issues={allSheetIssues}
            sheets={sheets}
            selectedSheetId={selectedSheet}
            onSelectIssue={(issue) => onSelectIssue?.(issue)}
            onSelectSheet={(sheetId) => onSelectSheet?.(sheetId)}
            selectedIssueId={selectedIssueId}
          />
        </div>
      )}

      {sidebarTab === "tools" && (
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {calibrationMode !== "idle" && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h3 className="font-semibold text-sm">Manual Calibration</h3>
                <p className="text-xs text-muted-foreground">Click two points on a known distance</p>
                <div>
                  <Label>Real-World Distance</Label>
                  <div className="flex gap-2">
                    <Input type="number" value={calibrationDistance} onChange={(e) => setCalibrationDistance(e.target.value)} placeholder="50" data-testid="input-calibration-distance" />
                    <Select value={units} onValueChange={(v: any) => setUnits(v)}>
                      <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        <SelectItem value="ft">ft</SelectItem>
                        <SelectItem value="m">m</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={onSaveCalibration} className="w-full" disabled={calibrationPoints.length !== 2 || !calibrationDistance} data-testid="button-save-calibration">
                  <Save className="w-4 h-4 mr-2" />Save Calibration
                </Button>
              </CardContent>
            </Card>
          )}

          {selectedSheet && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h3 className="font-semibold text-sm">{currentSheet?.scalePxPerFoot ? "Recalibrate with Preset Scale" : "Or Use Preset Scale"}</h3>
                <p className="text-xs text-muted-foreground">Select a common architectural, civil, or structural scale</p>
                <div>
                  <Label>Scale Category</Label>
                  <Select value={scaleCategory} onValueChange={(v: any) => { setScaleCategory(v); setSelectedPresetScale(""); }}>
                    <SelectTrigger data-testid="select-scale-category"><SelectValue placeholder="Select category..." /></SelectTrigger>
                    <SelectContent container={workspaceRef.current}>
                      <SelectItem value="architectural">Architectural</SelectItem>
                      <SelectItem value="civil">Civil/Site</SelectItem>
                      <SelectItem value="structural">Structural</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {scaleCategory && (
                  <div>
                    <Label>Scale</Label>
                    <Select value={selectedPresetScale} onValueChange={setSelectedPresetScale}>
                      <SelectTrigger data-testid="select-preset-scale"><SelectValue placeholder="Select scale..." /></SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        {COMMON_SCALES[scaleCategory as keyof typeof COMMON_SCALES].map((scale) => (
                          <SelectItem key={scale.label} value={scale.label}>{scale.label} - {scale.description}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button onClick={() => onApplyPresetScale(scaleCategory, selectedPresetScale, () => { setScaleCategory(""); setSelectedPresetScale(""); })} className="w-full" disabled={!selectedPresetScale} data-testid="button-apply-preset-scale">
                  <Save className="w-4 h-4 mr-2" />Apply Preset Scale
                </Button>
              </CardContent>
            </Card>
          )}

          {selectedSheet && (() => {
            return scaleTemplates.length > 0 ? (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Saved Scale Templates</h3>
                  </div>
                  <div className="space-y-1.5">
                    {scaleTemplates.map((tpl) => (
                      <div key={tpl.id} className="flex items-center gap-2 p-2 rounded border hover:bg-muted/50 transition-colors">
                        <Ruler className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium flex-1 truncate">{tpl.label}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{tpl.category}</Badge>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => {
                          if (!selectedSheet) return;
                          try {
                            await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, {
                              scalePxPerFoot: tpl.pxPerFoot,
                              units: "ft",
                              scaleLabel: tpl.label,
                            });
                            queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
                          } catch { /* ignore */ }
                        }} data-testid={`button-apply-scale-template-${tpl.id}`}>
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={async () => {
                          try {
                            await apiRequest("DELETE", `/api/takeoff/scale-templates/${tpl.id}`);
                            queryClient.invalidateQueries({ queryKey: ["/api/takeoff/scale-templates"] });
                          } catch { /* ignore */ }
                        }} data-testid={`button-delete-scale-template-${tpl.id}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  {currentSheet?.scalePxPerFoot && (
                    <Button variant="outline" size="sm" className="w-full text-xs gap-1" onClick={async () => {
                      const label = prompt("Save current scale as:", currentSheet.scaleLabel || `${currentSheet.scalePxPerFoot} px/ft`);
                      if (!label) return;
                      try {
                        await apiRequest("POST", "/api/takeoff/scale-templates", { name: label, label, pxPerFoot: currentSheet.scalePxPerFoot, category: "custom" });
                        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/scale-templates"] });
                      } catch { /* ignore */ }
                    }} data-testid="button-save-scale-template">
                      <Save className="w-3 h-3" /> Save Current Scale as Template
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : currentSheet?.scalePxPerFoot ? (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <h3 className="font-semibold text-sm">Scale Templates</h3>
                  <p className="text-xs text-muted-foreground">Save this calibration for reuse on other sheets.</p>
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1" onClick={async () => {
                    const label = prompt("Save current scale as:", currentSheet.scaleLabel || `${currentSheet.scalePxPerFoot} px/ft`);
                    if (!label) return;
                    try {
                      await apiRequest("POST", "/api/takeoff/scale-templates", { name: label, label, pxPerFoot: currentSheet.scalePxPerFoot, category: "custom" });
                      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/scale-templates"] });
                    } catch { /* ignore */ }
                  }} data-testid="button-save-scale-template">
                    <Save className="w-3 h-3" /> Save Current Scale as Template
                  </Button>
                </CardContent>
              </Card>
            ) : null;
          })()}

          {selectedSheet && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">Quantity Categories</h3>
                  <Button size="sm" onClick={() => setCategoryDialogOpen(true)} data-testid="button-add-category">
                    <Plus className="w-4 h-4 mr-1" />Add
                  </Button>
                </div>
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">No categories yet. Create one to organize measurements.</p>
                ) : (
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-2 pr-4">
                      {categories.map((category) => {
                        const isHidden = hiddenCategoryIds.has(category.id);
                        const categoryCount = (aggregatedMeasurements.byCategory[category.id] || []).length;
                        return (
                          <div key={category.id} className={cn("flex items-center justify-between p-2 rounded border hover-elevate", isHidden && "opacity-60")} style={{ borderLeft: `4px solid ${category.color}` }}>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="w-4 h-4 rounded flex-shrink-0" style={{ backgroundColor: isHidden ? "#9ca3af" : category.color }} />
                              <span className={cn("text-sm truncate", isHidden && "line-through text-muted-foreground")}>{category.name}</span>
                              {categoryCount > 0 && <Badge variant="secondary" className="text-xs shrink-0" data-testid={`badge-category-count-${category.id}`}>{categoryCount}</Badge>}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onToggleCategoryVisibility(category.id)} data-testid={`button-toggle-visibility-category-${category.id}`} title={isHidden ? "Show layer" : "Hide layer"}>
                                {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              </Button>
                              {showMeasurementLabels && onToggleLabelCategory && (
                                <Button size="icon" variant="ghost" className={cn("h-6 w-6", labelHiddenCategories.has(category.id) && "opacity-40")} onClick={() => onToggleLabelCategory(category.id)} data-testid={`button-toggle-label-category-${category.id}`} title={labelHiddenCategories.has(category.id) ? "Show labels for this category" : "Hide labels for this category"}>
                                  <Tag className="w-3 h-3" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingCategory(category); setCategoryDialogOpen(true); }} data-testid={`button-edit-category-${category.id}`}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onDeleteCategory(category.id)} data-testid={`button-delete-category-${category.id}`}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {(activeTool === "linear" || activeTool === "area" || activeTool === "volume" || activeTool === "count" || activeTool === "linear_with_drop" || activeTool === "pitched_linear" || activeTool === "pitched_area" || activeTool === "surface_area") && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h3 className="font-semibold text-sm">Drawing Settings</h3>
                <div className="space-y-2">
                  <Label htmlFor="category-select">Quantity Category</Label>
                  <Select value={selectedCategoryId || "none"} onValueChange={(value) => setSelectedCategoryId(value === "none" ? null : value)}>
                    <SelectTrigger id="category-select" data-testid="select-category"><SelectValue placeholder="Select category (optional)" /></SelectTrigger>
                    <SelectContent container={workspaceRef.current}>
                      <SelectItem value="none">None</SelectItem>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: cat.color }} />
                            {cat.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Measurements will be color-coded and grouped by category</p>
                </div>
                {(activeTool === "pitched_linear" || activeTool === "pitched_area" || activeTool === "surface_area") && (
                  <div className="space-y-2">
                    <Label htmlFor="pitch-ratio">Pitch Ratio</Label>
                    <Select value={pitchRatio} onValueChange={setPitchRatio}>
                      <SelectTrigger id="pitch-ratio" data-testid="select-pitch-ratio"><SelectValue /></SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        {["1:12", "2:12", "3:12", "4:12", "5:12", "6:12", "7:12", "8:12", "9:12", "10:12", "12:12", "14:12", "16:12"].map(r => (
                          <SelectItem key={r} value={r}>{r}{r === "1:12" ? " (low slope)" : r === "6:12" ? " (standard)" : r === "12:12" ? " (45°)" : r === "14:12" ? " (steep)" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Rise:Run ratio — adjusts measured lengths and areas for slope</p>
                  </div>
                )}
                {activeTool === "linear_with_drop" && (
                  <div className="space-y-2">
                    <Label htmlFor="drop-distance">Drop Distance (ft)</Label>
                    <Input id="drop-distance" type="number" value={dropDistance} onChange={(e) => setDropDistance(e.target.value)} placeholder="Vertical drop in feet" data-testid="input-drop-distance" />
                    <p className="text-xs text-muted-foreground">Vertical distance added to horizontal measurement (√(h² + v²))</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4 px-3">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="font-semibold text-sm shrink-0">Measurements</h3>
                <div className="flex items-center gap-0.5 flex-wrap justify-end">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowSummaryReport(true)} data-testid="button-measurement-summary">
                        <BookOpen className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Measurement Summary Report</TooltipContent>
                  </Tooltip>
                  {(onExportCurrentSheet || onExportAllSheets) && (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6" data-testid="button-export-excel-sidebar">
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Export to Excel</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent>
                        {onExportCurrentSheet && (
                          <DropdownMenuItem onClick={onExportCurrentSheet} data-testid="button-export-current-sheet-sidebar">
                            Current Sheet Only
                          </DropdownMenuItem>
                        )}
                        {onExportAllSheets && (
                          <DropdownMenuItem onClick={onExportAllSheets} data-testid="button-export-all-sheets-sidebar">
                            All Sheets
                          </DropdownMenuItem>
                        )}
                        {onExportQuantityDelta && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onExportQuantityDelta} data-testid="button-export-qty-delta-sidebar">
                              Quantity Delta Report
                            </DropdownMenuItem>
                          </>
                        )}
                        {onExportBidPackage && (
                          <DropdownMenuItem onClick={onExportBidPackage} data-testid="button-export-bid-package-sidebar">
                            Bid Package Export
                          </DropdownMenuItem>
                        )}
                        {onPrintSheet && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onPrintSheet} data-testid="button-print-sheet-sidebar">
                              Print Sheet
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Badge variant="secondary" data-testid="badge-measurement-count">{measurements.length}</Badge>
                  {measurements.some(m => m.source === "AI") && setHideAiMeasurements && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={hideAiMeasurements ? "outline" : "ghost"}
                          size="icon"
                          className={cn("h-6 w-6", hideAiMeasurements && "text-purple-500 border-purple-300")}
                          onClick={() => setHideAiMeasurements(!hideAiMeasurements)}
                          data-testid="button-toggle-ai-measurements"
                        >
                          <Zap className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{hideAiMeasurements ? "Show AI measurements" : "Hide AI measurements"}</TooltipContent>
                    </Tooltip>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNewGroupInput(true)} title="Create group" data-testid="button-create-group">
                    <FolderPlus className="w-3.5 h-3.5" />
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={quickAddOpen ? "secondary" : "ghost"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setQuickAddOpen(!quickAddOpen)}
                        data-testid="button-quick-add-toggle"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Quick add line item</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setBulkPasteOpen(true)}
                        data-testid="button-bulk-paste-toggle"
                      >
                        <BookOpen className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Bulk paste items</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={bulkSelectMode ? "secondary" : "ghost"}
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => { setBulkSelectMode(!bulkSelectMode); setBulkSelectedIds(new Set()); }}
                        data-testid="button-bulk-select-toggle"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Bulk select</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {showNewGroupInput && (
                <div className="flex items-center gap-2 mb-3">
                  <Input
                    placeholder="Group name..."
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newGroupName.trim()) {
                        createGroupMutation?.mutate({ name: newGroupName.trim(), sortOrder: measurementGroups.length });
                        setNewGroupName("");
                        setShowNewGroupInput(false);
                      }
                    }}
                    className="h-8 text-sm"
                    autoFocus
                    data-testid="input-new-group-name"
                  />
                  <Button size="sm" className="h-8 px-2" onClick={() => { if (newGroupName.trim()) { createGroupMutation?.mutate({ name: newGroupName.trim(), sortOrder: measurementGroups.length }); setNewGroupName(""); setShowNewGroupInput(false); } }} data-testid="button-save-group">
                    <Save className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setNewGroupName(""); setShowNewGroupInput(false); }} data-testid="button-cancel-group">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}

              {quickAddOpen && (
                <Card className="p-3 mb-3 space-y-2 border-dashed">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Item label..."
                      value={quickAddLabel}
                      onChange={(e) => setQuickAddLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleQuickAdd(); }}
                      className="h-8 text-sm flex-1"
                      autoFocus
                      data-testid="input-quick-add-label"
                    />
                    <Select value={quickAddType} onValueChange={setQuickAddType}>
                      <SelectTrigger className="h-8 w-24 text-xs" data-testid="select-quick-add-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COUNT">Count</SelectItem>
                        <SelectItem value="LINEAR">Linear</SelectItem>
                        <SelectItem value="AREA">Area</SelectItem>
                        <SelectItem value="VOLUME">Volume</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Qty"
                      type="number"
                      value={quickAddQty}
                      onChange={(e) => setQuickAddQty(e.target.value)}
                      className="h-8 text-sm w-16"
                      data-testid="input-quick-add-qty"
                    />
                    <Input
                      placeholder="Unit"
                      value={quickAddUnit}
                      onChange={(e) => setQuickAddUnit(e.target.value)}
                      className="h-8 text-sm w-16"
                      data-testid="input-quick-add-unit"
                    />
                    {categories.length > 0 && (
                      <Select value={quickAddCategory} onValueChange={setQuickAddCategory}>
                        <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-quick-add-category">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button size="sm" className="h-8" onClick={handleQuickAdd} disabled={quickAddPending || !quickAddLabel.trim()} data-testid="button-quick-add-submit">
                      {quickAddPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    </Button>
                  </div>
                </Card>
              )}

              {bulkSelectMode && bulkSelectedIds.size > 0 && (
                <div className="flex items-center gap-2 mb-2 p-2 bg-primary/5 rounded-md border border-primary/20">
                  <Badge variant="secondary" className="text-xs">{bulkSelectedIds.size} selected</Badge>
                  {categories.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="button-bulk-assign-category">
                          Assign Category
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {categories.map(cat => (
                          <DropdownMenuItem key={cat.id} onClick={() => handleBulkCategoryAssign(cat.id)}>
                            <span className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: cat.color || "#3b82f6" }} />
                            {cat.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Button size="sm" variant="destructive" className="h-7 text-xs ml-auto" onClick={handleBulkDelete} data-testid="button-bulk-delete">
                    <Trash2 className="w-3 h-3 mr-1" /> Delete
                  </Button>
                </div>
              )}

              {measurements.length > 3 && (
                <div className="flex items-center gap-1.5 mb-3" data-testid="measurement-search-bar">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Filter measurements..."
                      value={measurementSearch}
                      onChange={(e) => setMeasurementSearch(e.target.value)}
                      className="h-7 text-xs pl-7 pr-6"
                      data-testid="input-measurement-search"
                    />
                    {measurementSearch && (
                      <button className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setMeasurementSearch("")}>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className={cn("h-7 w-7 shrink-0", measurementSort !== "default" && "text-primary")} data-testid="button-measurement-sort">
                        <ArrowUpDown className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setMeasurementSort("default")} className={measurementSort === "default" ? "font-semibold" : ""}>Default Order</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMeasurementSort("type")} className={measurementSort === "type" ? "font-semibold" : ""}>Sort by Type</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMeasurementSort("value")} className={measurementSort === "value" ? "font-semibold" : ""}>Sort by Value</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {measurements.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <Ruler className="w-8 h-8 mx-auto text-muted-foreground/50" />
                  <p className="text-sm font-medium text-muted-foreground">No measurements yet</p>
                  <p className="text-xs text-muted-foreground/70">Select a measurement tool from the toolbar and click on the plan to start measuring</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(() => {
                    const preFiltered = hideAiMeasurements ? measurements.filter(m => m.source !== "AI") : measurements;
                    const filteredMeasurements = filterAndSortMeasurements(preFiltered);
                    const grouped: Record<string, TakeoffMeasurement[]> = {};
                    const ungrouped: TakeoffMeasurement[] = [];
                    filteredMeasurements.forEach((m) => {
                      if (m.groupId) {
                        if (!grouped[m.groupId]) grouped[m.groupId] = [];
                        grouped[m.groupId].push(m);
                      } else {
                        ungrouped.push(m);
                      }
                    });

                    const renderMeasurementItem = (m: TakeoffMeasurement) => {
                      const category = categories.find(c => c.id === m.categoryId);
                      const valueStr = getMeasurementValue(m);
                      const meta = parseMeta(m.metadata);
                      return (
                      <div
                        key={m.id}
                        className={cn(
                          "group/item p-2.5 rounded-lg border transition-all cursor-pointer",
                          selectedMeasurementId === m.id
                            ? "ring-2 ring-primary bg-primary/5 border-primary/30 shadow-sm"
                            : "bg-card hover:bg-accent/50 border-border/60 hover:border-border",
                          bulkSelectMode && bulkSelectedIds.has(m.id) && "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-950/30"
                        )}
                        style={category ? { borderLeftWidth: 3, borderLeftColor: category.color } : undefined}
                        onClick={() => {
                          if (bulkSelectMode) {
                            setBulkSelectedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                              return next;
                            });
                            return;
                          }
                          if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
                          clickTimerRef.current = setTimeout(() => {
                            setSelectedMeasurementId(m.id);
                            setSelectedSegmentIndex(null);
                            onZoomToMeasurement?.(m);
                            clickTimerRef.current = null;
                          }, 200);
                        }}
                        onDoubleClick={() => {
                          if (bulkSelectMode) return;
                          if (clickTimerRef.current) {
                            clearTimeout(clickTimerRef.current);
                            clickTimerRef.current = null;
                          }
                          setSelectedMeasurementId(m.id);
                          setSelectedSegmentIndex(null);
                          onZoomToFitMeasurement?.(m);
                        }}
                        draggable={!bulkSelectMode}
                        onDragStart={(e) => { e.dataTransfer.setData("measurement-id", m.id); e.dataTransfer.effectAllowed = "move"; }}
                        data-testid={`measurement-item-${m.id}`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          {bulkSelectMode && (
                            <input type="checkbox" checked={bulkSelectedIds.has(m.id)} readOnly className="w-3.5 h-3.5 rounded shrink-0" />
                          )}
                          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 font-semibold border shrink-0", typeBadgeStyles[m.type] || "")}>
                            {typeLabels[m.type] || m.type}
                          </Badge>
                          {inlineEditId === m.id ? (
                            <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={inlineEditLabel}
                                onChange={(e) => setInlineEditLabel(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleInlineEditSave(m.id); if (e.key === "Escape") setInlineEditId(null); }}
                                className="h-6 text-sm w-24"
                                autoFocus
                                placeholder="Label"
                                data-testid={`input-inline-edit-label-${m.id}`}
                              />
                              <Input
                                value={inlineEditQty}
                                onChange={(e) => setInlineEditQty(e.target.value)}
                                className="h-6 text-sm w-12"
                                placeholder="Qty"
                                type="number"
                                data-testid={`input-inline-edit-qty-${m.id}`}
                              />
                              <Input
                                value={inlineEditUnit}
                                onChange={(e) => setInlineEditUnit(e.target.value)}
                                className="h-6 text-sm w-12"
                                placeholder="Unit"
                                data-testid={`input-inline-edit-unit-${m.id}`}
                              />
                              <Input
                                value={inlineEditCost}
                                onChange={(e) => setInlineEditCost(e.target.value)}
                                className="h-6 text-sm w-14"
                                placeholder="Cost"
                                type="number"
                                step="0.01"
                                data-testid={`input-inline-edit-cost-${m.id}`}
                              />
                              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => handleInlineEditSave(m.id)} data-testid={`button-inline-save-${m.id}`}>
                                <Save className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-medium text-sm truncate flex-1 min-w-0" onDoubleClick={(e) => {
                              e.stopPropagation();
                              setInlineEditId(m.id);
                              setInlineEditLabel(m.label || "");
                              setInlineEditQty(m.count ? String(m.count) : "");
                              const editMeta = parseMeta(m.metadata);
                              setInlineEditUnit(editMeta.unit ? String(editMeta.unit) : "");
                              setInlineEditCost(editMeta.unitCost ? String(editMeta.unitCost) : "");
                            }}>{m.label || "Untitled"}</span>
                          )}
                          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); handleDuplicateMeasurement(m); }} data-testid={`button-duplicate-measurement-${m.id}`}>
                              <Copy className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMeasurementMutation.mutate(m); }} data-testid={`button-delete-measurement-${m.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {valueStr && <span className="text-xs font-mono font-medium text-foreground/80">{valueStr}</span>}
                          {meta.conditionFormula && (() => {
                            const fCtx: FormulaContext = {
                              length: m.computedLengthFt ?? 0,
                              area: m.computedAreaFt2 ?? 0,
                              volume: m.computedVolumeCy ?? 0,
                              count: m.count ?? 1,
                              depth: m.depthFeet ?? 0,
                            };
                            const fResult = evaluateFormula(String(meta.conditionFormula ?? ""), fCtx);
                            return (
                              <span className="text-[10px] font-mono text-violet-600 dark:text-violet-400" data-testid={`text-formula-qty-${m.id}`}>
                                fx={fResult.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              </span>
                            );
                          })()}
                          {(m as any).pitchRatio && <span className="text-[10px] text-muted-foreground">({(m as any).pitchRatio})</span>}
                          {m.source === "AI" && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" data-testid={`badge-ai-source-${m.id}`}>
                              <Zap className="w-2.5 h-2.5 mr-0.5" />AI
                            </Badge>
                          )}
                          {m.source === "BIM" && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" data-testid={`badge-bim-source-${m.id}`}>BIM</Badge>
                          )}
                          {measurementLinks?.hasPR.has(m.id) && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" data-testid={`badge-pr-${m.id}`}>PR</Badge>
                          )}
                          {measurementLinks?.hasCO.has(m.id) && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300" data-testid={`badge-co-${m.id}`}>CO</Badge>
                          )}
                          {measurementLinks?.hasSOV.has(m.id) && (
                            <Badge variant="secondary" className="text-[9px] h-4 px-1 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" data-testid={`badge-sov-${m.id}`}>SOV</Badge>
                          )}
                          {category && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: category.color }} />{category.name}</span>}
                          {meta.unitCost && <span className="text-[10px] text-green-600 dark:text-green-400" data-testid={`text-unitcost-${m.id}`}>${Number(meta.unitCost).toFixed(2)}</span>}
                          {meta.costCodeId && <span className="text-[10px] text-blue-500" data-testid={`text-costcode-${m.id}`}>{meta.costCodeId}</span>}
                        </div>
                        {Array.isArray(meta.assemblyResults) && meta.assemblyResults.length > 0 && (
                          <div className="mt-1 space-y-0.5 ml-1 border-l-2 border-violet-200 dark:border-violet-800 pl-2">
                            {meta.assemblyResults.map((ar: { name: string; quantity: number; unit: string; totalCost: number }, arIdx: number) => (
                              <div key={arIdx} className="flex items-center justify-between text-[10px] text-muted-foreground" data-testid={`assembly-line-${m.id}-${arIdx}`}>
                                <span className="truncate">{ar.name}: {ar.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} {ar.unit}</span>
                                {ar.totalCost > 0 && <span className="font-mono text-green-600 dark:text-green-400 shrink-0 ml-1">${ar.totalCost.toFixed(2)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {m.type === "SEGMENT" && (() => {
                          const points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                          let segProps: any[] = [];
                          try { const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata; segProps = meta?.segmentProperties || []; } catch (err) { console.warn("[TakeoffSidebar] Failed to parse segment metadata:", err); }
                          if (points.length < 2 || !currentSheet?.scalePxPerFoot) return null;
                          const scalePxPerFoot = currentSheet.scalePxPerFoot;
                          return (
                            <Collapsible>
                              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1" data-testid={`button-expand-segments-${m.id}`}>
                                <ChevronRight className="w-3 h-3 transition-transform [[data-state=open]>&]:rotate-90" />
                                <span>{points.length - 1} segments</span>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="mt-1 space-y-1 ml-2 border-l-2 border-muted pl-2">
                                  {points.slice(0, -1).map((_: { x: number; y: number }, i: number) => {
                                    const segLabel = segProps[i]?.label || `Seg ${i + 1}`;
                                    const segColor = segProps[i]?.color || "#2563eb";
                                    const p1 = points[i];
                                    const p2 = points[i + 1];
                                    const dx = p2.x - p1.x;
                                    const dy = p2.y - p1.y;
                                    const pxDist = Math.sqrt(dx * dx + dy * dy);
                                    const segLenFt = pxDist / scalePxPerFoot;
                                    return (
                                      <div
                                        key={i}
                                        className={`flex items-center gap-2 text-xs cursor-pointer rounded px-1 py-0.5 transition-colors ${selectedMeasurementId === m.id && selectedSegmentIndex === i ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted'}`}
                                        onClick={(e) => { e.stopPropagation(); setSelectedMeasurementId(m.id); setSelectedSegmentIndex(i); }}
                                        data-testid={`segment-child-${m.id}-${i}`}
                                      >
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: segColor }} />
                                        <span className="text-muted-foreground">{segLabel}:</span>
                                        <span>{segLenFt.toFixed(2)} LF</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          );
                        })()}
                      </div>
                    );
                    };

                    const computeGroupTotals = (items: TakeoffMeasurement[]) => {
                      let linear = 0, area = 0, volume = 0, count = 0, segment = 0;
                      items.forEach(m => {
                        if (m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") { const v = Number(m.computedLengthFt); linear += Number.isFinite(v) ? v : 0; }
                        else if (m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") { const v = Number((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2); area += Number.isFinite(v) ? v : 0; }
                        else if (m.type === "VOLUME") { const v = Number(m.computedVolumeCy); volume += Number.isFinite(v) ? v : 0; }
                        else if (m.type === "COUNT") { count += 1; }
                        else if (m.type === "SEGMENT") { const v = Number(m.computedLengthFt); segment += Number.isFinite(v) ? v : 0; }
                      });
                      const totalCost = items.reduce((sum, m) => {
                        const mMeta = parseMeta(m.metadata);
                        const surfArea = Number(mMeta.computedSurfaceAreaFt2) || 0;
                        const qty = Number(surfArea || m.computedLengthFt || m.computedAreaFt2 || (m.type === "COUNT" ? 1 : 0));
                        return sum + (Number.isFinite(qty) ? qty : 0) * (Number(mMeta.unitCost) || 0);
                      }, 0);
                      return { linear, area, volume, count, segment, totalCost };
                    };

                    return (
                      <>
                        {measurementGroups.map((group) => {
                          const groupItems = grouped[group.id] || [];
                          const isCollapsed = collapsedGroups.has(group.id);
                          const totals = computeGroupTotals(groupItems);
                          const allVisible = groupItems.every(m => m.visible !== false);
                          return (
                            <div key={group.id} className={cn("group rounded-lg border transition-colors overflow-hidden", dragOverGroupId === group.id ? "bg-primary/5 border-primary shadow-sm" : "border-border/70")} style={dragOverGroupId !== group.id ? { borderLeftWidth: 3, borderLeftColor: group.color } : undefined} data-testid={`group-${group.id}`}
                              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverGroupId(group.id); }}
                              onDragLeave={() => setDragOverGroupId(null)}
                              onDrop={(e) => { e.preventDefault(); setDragOverGroupId(null); const mId = e.dataTransfer.getData("measurement-id"); if (mId) updateMeasurementMutation.mutate({ id: mId, groupId: group.id }); }}>
                              <div
                                className="flex items-center gap-1.5 px-2.5 py-2 cursor-pointer hover:bg-accent/40 transition-colors"
                                onClick={() => setCollapsedGroups(prev => { const next = new Set(prev); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}
                              >
                                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                                <FolderOpen className="w-3.5 h-3.5 shrink-0" style={{ color: group.color }} />
                                <span className="font-semibold text-sm flex-1 truncate">{group.name}</span>
                                <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{groupItems.length}</Badge>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); toggleGroupVisibilityMutation?.mutate({ groupId: group.id, visible: !allVisible }); }} data-testid={`button-toggle-group-visibility-${group.id}`}>
                                    {allVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); exportGroupCSV(group.name, groupItems); }} data-testid={`button-export-group-${group.id}`} title="Export group as CSV">
                                    <Download className="w-3 h-3" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); setDeleteGroupConfirm(group.id); }} data-testid={`button-delete-group-${group.id}`}>
                                    <Trash2 className="w-3 h-3 text-destructive" />
                                  </Button>
                                </div>
                              </div>

                              {deleteGroupConfirm === group.id && (
                                <div className="px-2 pb-2 flex items-center gap-2">
                                  <span className="text-xs text-destructive">Delete group?</span>
                                  <Button size="sm" variant="destructive" className="h-6 text-xs px-2" onClick={() => { deleteGroupMutation?.mutate(group.id); setDeleteGroupConfirm(null); }} data-testid={`button-confirm-delete-group-${group.id}`}>Yes</Button>
                                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setDeleteGroupConfirm(null)}>No</Button>
                                </div>
                              )}

                              {!isCollapsed && (
                                <div className="px-2.5 pb-2.5 space-y-1.5">
                                  {groupItems.length > 0 && (totals.linear > 0 || totals.area > 0 || totals.volume > 0 || totals.count > 0 || totals.totalCost > 0) && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono tabular-nums bg-muted/50 rounded-md px-2 py-1.5 mb-1">
                                      {totals.linear > 0 && <span><strong className="text-blue-600 dark:text-blue-400">{totals.linear.toFixed(1)}</strong> LF</span>}
                                      {totals.area > 0 && <span><strong className="text-emerald-600 dark:text-emerald-400">{totals.area.toFixed(1)}</strong> SF</span>}
                                      {totals.volume > 0 && <span><strong className="text-amber-600 dark:text-amber-400">{totals.volume.toFixed(1)}</strong> CY</span>}
                                      {totals.count > 0 && <span><strong className="text-violet-600 dark:text-violet-400">{totals.count}</strong> ct</span>}
                                      {totals.segment > 0 && <span><strong className="text-cyan-600 dark:text-cyan-400">{totals.segment.toFixed(1)}</strong> LF seg</span>}
                                      {totals.totalCost > 0 && <span className="text-green-600 dark:text-green-400 font-medium">${totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                    </div>
                                  )}
                                  {groupItems.map(renderMeasurementItem)}
                                  {groupItems.length === 0 && (
                                    <p className="text-xs text-muted-foreground text-center py-3 italic">Drag measurements here to organize</p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {(ungrouped.length > 0 || measurementGroups.length > 0) && (
                          <div className={`space-y-1 ${measurementGroups.length > 0 ? 'border rounded-md p-2' : ''} ${dragOverGroupId === "__ungrouped__" ? 'bg-primary/10 border-primary' : ''}`}
                            onDragOver={(e) => { if (measurementGroups.length > 0) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverGroupId("__ungrouped__"); } }}
                            onDragLeave={() => setDragOverGroupId(null)}
                            onDrop={(e) => { e.preventDefault(); setDragOverGroupId(null); const mId = e.dataTransfer.getData("measurement-id"); if (mId) updateMeasurementMutation.mutate({ id: mId, groupId: null }); }}
                          >
                            {measurementGroups.length > 0 && (
                              <div className="flex items-center gap-2 py-1">
                                <span className="text-xs font-medium text-muted-foreground">Ungrouped</span>
                                <Badge variant="outline" className="text-[10px]">{ungrouped.length}</Badge>
                              </div>
                            )}
                            {ungrouped.map(renderMeasurementItem)}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedMeasurementId && (() => {
            const selM = measurements.find(m => m.id === selectedMeasurementId);
            if (!selM) return null;
            return (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <h3 className="font-semibold text-sm">Measurement Properties</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Type:</span><Badge variant="outline">{selM.type}</Badge></div>
                    {selM.computedLengthFt && <div className="flex justify-between"><span className="text-muted-foreground">{selM.type === "SEGMENT" ? "Total Length:" : "Length:"}</span><span>{Number(selM.computedLengthFt).toFixed(2)} LF</span></div>}
                    {selM.type === "SEGMENT" && (() => {
                      const pts = typeof selM.points === 'string' ? JSON.parse(selM.points) : selM.points;
                      return pts.length >= 2 ? <div className="flex justify-between"><span className="text-muted-foreground">Segments:</span><span>{pts.length - 1}</span></div> : null;
                    })()}
                    {selM.computedAreaFt2 && (() => {
                      const deductions: Array<{width?: number; height?: number; points?: {x:number;y:number}[]; areaFt2?: number; label?: string}> = (() => {
                        try { return selM.deductions ? JSON.parse(selM.deductions as string) : []; } catch { return []; }
                      })();
                      const grossArea = Number(selM.computedAreaFt2);
                      const mainPts = (() => { try { const p = typeof selM.points === "string" ? JSON.parse(selM.points) : selM.points; return Array.isArray(p) ? p : []; } catch { return []; } })();
                      const polyDeductPolygons = deductions.filter(d => d.points && Array.isArray(d.points)).map(d => d.points!);
                      const wHDeductionSf = deductions.filter(d => !d.points).reduce((sum, d) => sum + ((d.width || 0) * (d.height || 0)), 0);
                      let polyDeductionSf = 0;
                      if (polyDeductPolygons.length > 0 && currentSheet?.scalePxPerFoot) {
                        const netResult = computeNetAreaInFt2(mainPts, polyDeductPolygons, currentSheet.scalePxPerFoot);
                        polyDeductionSf = netResult.deductionArea;
                      } else {
                        polyDeductionSf = deductions.filter(d => d.points).reduce((sum, d) => sum + (d.areaFt2 || 0), 0);
                      }
                      const totalDeductionSf = wHDeductionSf + polyDeductionSf;
                      const netArea = Math.max(0, grossArea - totalDeductionSf);
                      return (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{deductions.length > 0 ? "Gross Area:" : "Area:"}</span>
                            <span>{grossArea.toFixed(2)} SF</span>
                          </div>
                          {deductions.length > 0 && (
                            <>
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>Deductions:</span>
                                <span>-{totalDeductionSf.toFixed(2)} SF</span>
                              </div>
                              <div className="flex justify-between text-green-600 dark:text-green-400 font-medium">
                                <span>Net Area:</span>
                                <span>{netArea.toFixed(2)} SF</span>
                              </div>
                            </>
                          )}
                        </>
                      );
                    })()}
                    {(() => {
                      try {
                        const meta = selM.metadata ? (typeof selM.metadata === "string" ? JSON.parse(selM.metadata) : selM.metadata) : null;
                        if (meta?.perimeterFt) {
                          return (
                            <div className="flex justify-between" data-testid="text-perimeter">
                              <span className="text-muted-foreground">Perimeter:</span>
                              <span>{Number(meta.perimeterFt).toFixed(2)} LF</span>
                            </div>
                          );
                        }
                      } catch (err) { console.warn("[TakeoffSidebar] Failed to parse area metadata:", err); }
                      return null;
                    })()}
                    {structuralGridlines && (structuralGridlines.vertical.length > 0 || structuralGridlines.horizontal.length > 0) && (() => {
                      const pts = (() => { try { const p = typeof selM.points === "string" ? JSON.parse(selM.points) : selM.points; return Array.isArray(p) ? p : []; } catch { return []; } })();
                      if (pts.length === 0) return null;
                      const center = pts.length === 1 ? pts[0] : { x: pts.reduce((s: number, p: { x: number; y: number }) => s + p.x, 0) / pts.length, y: pts.reduce((s: number, p: { x: number; y: number }) => s + p.y, 0) / pts.length };
                      const nearestV = structuralGridlines.vertical.length > 0
                        ? structuralGridlines.vertical.reduce((best, gl) => Math.abs(gl.position - center.x) < Math.abs(best.position - center.x) ? gl : best)
                        : null;
                      const nearestH = structuralGridlines.horizontal.length > 0
                        ? structuralGridlines.horizontal.reduce((best, gl) => Math.abs(gl.position - center.y) < Math.abs(best.position - center.y) ? gl : best)
                        : null;
                      const ref = [nearestV?.label, nearestH?.label].filter(Boolean).join("/");
                      return ref ? (
                        <div className="flex justify-between" data-testid="text-grid-reference">
                          <span className="text-muted-foreground">Grid Ref:</span>
                          <span className="font-mono text-purple-600 dark:text-purple-400">{ref}</span>
                        </div>
                      ) : null;
                    })()}
                    {(selM as any).computedSurfaceAreaFt2 && <div className="flex justify-between"><span className="text-muted-foreground">Surface Area:</span><span>{Number((selM as any).computedSurfaceAreaFt2).toFixed(2)} SF</span></div>}
                    {selM.computedVolumeCy && <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{Number(selM.computedVolumeCy).toFixed(2)} CY</span></div>}
                    {(selM as any).pitchRatio && <div className="flex justify-between"><span className="text-muted-foreground">Pitch:</span><span>{(selM as any).pitchRatio}</span></div>}
                  </div>
                  {(selM.type === "AREA" || selM.type === "PITCHED_AREA" || selM.type === "SURFACE_AREA") && selM.computedAreaFt2 && (() => {
                    const deductions: Array<{width?: number; height?: number; points?: {x: number; y: number}[]; areaFt2?: number; label?: string}> = (() => {
                      try { return selM.deductions ? JSON.parse(selM.deductions as string) : []; } catch { return []; }
                    })();
                    return (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-semibold">Deductions / Openings</h4>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2"
                              onClick={() => {
                                const newDeduction = { width: 3, height: 3, label: `Opening ${deductions.length + 1}` };
                                const updated = [...deductions, newDeduction];
                                updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                              }}
                              data-testid="button-add-deduction"
                            >
                              <Plus className="w-3 h-3 mr-0.5" /> Add
                            </Button>
                          </div>
                          {deductions.length === 0 && (
                            <p className="text-[10px] text-muted-foreground">No deductions. Add openings (W×H) or draw polygon deducts on canvas with the Deduct tool.</p>
                          )}
                          {deductions.map((d: { width?: number; height?: number; points?: { x: number; y: number }[]; areaFt2?: number; label?: string }, idx: number) => {
                            if (d.points && Array.isArray(d.points)) {
                              return (
                                <div key={idx} className="flex items-center gap-1.5 text-xs bg-red-50 dark:bg-red-950/30 rounded p-1.5 border border-red-200 dark:border-red-800" data-testid={`deduction-item-${idx}`}>
                                  <span className="text-[10px] font-medium text-red-600 dark:text-red-400">{d.label || `Deduct ${idx + 1}`}</span>
                                  <span className="text-[9px] text-muted-foreground ml-auto">{Number(d.areaFt2 || 0).toFixed(1)} SF (polygon)</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 text-destructive"
                                    onClick={() => {
                                      const updated = deductions.filter((_, i) => i !== idx);
                                      updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                                    }}
                                    data-testid={`button-delete-deduction-${idx}`}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              );
                            }
                            return (
                            <div key={idx} className="flex items-center gap-1.5 text-xs bg-muted/50 rounded p-1.5" data-testid={`deduction-item-${idx}`}>
                              <Input
                                className="h-6 w-16 text-[10px] px-1"
                                defaultValue={d.label || `Opening ${idx + 1}`}
                                onBlur={(e) => {
                                  const updated = [...deductions];
                                  updated[idx] = { ...updated[idx], label: e.target.value };
                                  updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                                }}
                                data-testid={`input-deduction-label-${idx}`}
                              />
                              <Input
                                type="number"
                                className="h-6 w-12 text-[10px] px-1 text-right"
                                defaultValue={d.width}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const updated = [...deductions];
                                  updated[idx] = { ...updated[idx], width: val };
                                  updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                                }}
                                data-testid={`input-deduction-width-${idx}`}
                              />
                              <span className="text-muted-foreground">×</span>
                              <Input
                                type="number"
                                className="h-6 w-12 text-[10px] px-1 text-right"
                                defaultValue={d.height}
                                onBlur={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const updated = [...deductions];
                                  updated[idx] = { ...updated[idx], height: val };
                                  updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                                }}
                                data-testid={`input-deduction-height-${idx}`}
                              />
                              <span className="text-muted-foreground text-[9px]">ft</span>
                              <span className="text-[9px] text-muted-foreground ml-auto">{((d.width || 0) * (d.height || 0)).toFixed(1)} SF</span>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 text-destructive"
                                onClick={() => {
                                  const updated = deductions.filter((_, i) => i !== idx);
                                  updateMeasurementMutation.mutate({ id: selM.id, deductions: JSON.stringify(updated) });
                                }}
                                data-testid={`button-delete-deduction-${idx}`}
                              >
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                  {selM.type === "SEGMENT" && selectedSegmentIndex !== null && (() => {
                    const pts = typeof selM.points === 'string' ? JSON.parse(selM.points) : selM.points;
                    let segProps: any[] = [];
                    try { const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata) : selM.metadata; segProps = meta?.segmentProperties || []; } catch (err) { console.warn("[TakeoffSidebar] Failed to parse selected segment metadata:", err); }
                    if (selectedSegmentIndex >= pts.length - 1) return null;
                    const p1 = pts[selectedSegmentIndex];
                    const p2 = pts[selectedSegmentIndex + 1];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const pxDist = Math.sqrt(dx * dx + dy * dy);
                    const segLenFt = currentSheet?.scalePxPerFoot ? pxDist / currentSheet.scalePxPerFoot : 0;
                    const segProp = segProps[selectedSegmentIndex] || {};
                    return (
                      <>
                        <Separator />
                        <div className="space-y-2" key={`${selM.id}-seg-${selectedSegmentIndex}`}>
                          <h4 className="font-semibold text-xs text-primary">Selected Segment: {segProp.label || `Seg ${selectedSegmentIndex + 1}`}</h4>
                          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Length:</span><span>{segLenFt.toFixed(2)} LF</span></div>
                          <div className="space-y-1">
                            <Label className="text-xs">Segment Label</Label>
                            <Input
                              className="h-8 text-sm"
                              defaultValue={segProp.label || `Seg ${selectedSegmentIndex + 1}`}
                              onBlur={(e) => {
                                const newLabel = e.target.value.trim();
                                if (!newLabel || newLabel === segProp.label) return;
                                const newSegProps = [...segProps];
                                newSegProps[selectedSegmentIndex] = { ...newSegProps[selectedSegmentIndex], label: newLabel };
                                const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                updateMeasurementMutation.mutate({ id: selM.id, metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }) });
                              }}
                              data-testid={`input-segment-label-${selectedSegmentIndex}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Segment Color</Label>
                            <input
                              type="color"
                              className="w-full h-8 cursor-pointer rounded border"
                              defaultValue={segProp.color || "#2563eb"}
                              onChange={(e) => {
                                const val = e.target.value;
                                const newSegProps = [...segProps];
                                newSegProps[selectedSegmentIndex] = { ...newSegProps[selectedSegmentIndex], color: val };
                                const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                updateMeasurementMutation.mutate({ id: selM.id, metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }) });
                              }}
                              data-testid={`input-segment-color-${selectedSegmentIndex}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Segment Unit Cost ($)</Label>
                            <Input
                              type="number"
                              className="h-8 text-sm"
                              placeholder="0.00"
                              defaultValue={segProp.unitCost || ""}
                              onBlur={(e) => {
                                const val = parseFloat(e.target.value) || undefined;
                                if (val === segProp.unitCost) return;
                                const newSegProps = [...segProps];
                                newSegProps[selectedSegmentIndex] = { ...newSegProps[selectedSegmentIndex], unitCost: val };
                                const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                updateMeasurementMutation.mutate({ id: selM.id, metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }) });
                              }}
                              data-testid={`input-segment-unit-cost-${selectedSegmentIndex}`}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Segment Cost Code</Label>
                            <Input
                              className="h-8 text-sm"
                              placeholder="Cost code"
                              defaultValue={segProp.costCodeId || ""}
                              onBlur={(e) => {
                                const val = e.target.value.trim() || undefined;
                                if (val === segProp.costCodeId) return;
                                const newSegProps = [...segProps];
                                newSegProps[selectedSegmentIndex] = { ...newSegProps[selectedSegmentIndex], costCodeId: val };
                                const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                updateMeasurementMutation.mutate({ id: selM.id, metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }) });
                              }}
                              data-testid={`input-segment-cost-code-${selectedSegmentIndex}`}
                            />
                          </div>
                          {categories.length > 0 && (
                            <div className="space-y-1">
                              <Label className="text-xs">Segment Category</Label>
                              <select
                                className="w-full h-8 text-sm border rounded px-2 bg-background"
                                value={segProp.categoryId || ""}
                                onChange={(e) => {
                                  const val = e.target.value || undefined;
                                  if (val === segProp.categoryId) return;
                                  const newSegProps = [...segProps];
                                  newSegProps[selectedSegmentIndex] = { ...newSegProps[selectedSegmentIndex], categoryId: val };
                                  const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                  updateMeasurementMutation.mutate({ id: selM.id, metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }) });
                                }}
                                data-testid={`select-segment-category-${selectedSegmentIndex}`}
                              >
                                <option value="">No category</option>
                                {categories.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                          {segProp.unitCost && segLenFt > 0 && (
                            <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm">
                              <div className="flex justify-between font-medium">
                                <span>Segment Cost:</span>
                                <span className="text-green-600 dark:text-green-400">
                                  ${(Number(segProp.unitCost) * segLenFt).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          )}
                          {pts.length > 2 && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="w-full text-xs"
                              onClick={() => {
                                const newPts = [...pts];
                                const removeIdx = selectedSegmentIndex;
                                if (removeIdx === 0) {
                                  newPts.splice(0, 1);
                                } else if (removeIdx === pts.length - 2) {
                                  newPts.splice(pts.length - 1, 1);
                                } else {
                                  newPts.splice(removeIdx + 1, 1);
                                }
                                const newSegProps = [...segProps];
                                newSegProps.splice(removeIdx, 1);
                                let newTotalLen = 0;
                                if (currentSheet?.scalePxPerFoot) {
                                  for (let i = 0; i < newPts.length - 1; i++) {
                                    const ddx = newPts[i + 1].x - newPts[i].x;
                                    const ddy = newPts[i + 1].y - newPts[i].y;
                                    newTotalLen += Math.sqrt(ddx * ddx + ddy * ddy) / currentSheet.scalePxPerFoot;
                                  }
                                }
                                const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata || '{}') : (selM.metadata || {});
                                updateMeasurementMutation.mutate({
                                  id: selM.id,
                                  points: JSON.stringify(newPts),
                                  computedLengthFt: newTotalLen,
                                  metadata: JSON.stringify({ ...meta, segmentProperties: newSegProps }),
                                });
                                setSelectedSegmentIndex(null);
                              }}
                              data-testid={`button-delete-segment-${selectedSegmentIndex}`}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Delete This Segment
                            </Button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs">Line Style</Label>
                    <Select
                      value={selM.lineStyle || "solid"}
                      onValueChange={(val) => updateMeasurementMutation.mutate({ id: selM.id, lineStyle: val, previous: { lineStyle: selM.lineStyle ?? null } })}
                      data-testid="select-line-style"
                    >
                      <SelectTrigger className="h-8 text-sm" data-testid="select-trigger-line-style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        <SelectItem value="solid">
                          <div className="flex items-center gap-2">
                            <svg width="40" height="8"><line x1="0" y1="4" x2="40" y2="4" stroke="currentColor" strokeWidth="2" /></svg>
                            <span>Solid</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="dashed">
                          <div className="flex items-center gap-2">
                            <svg width="40" height="8"><line x1="0" y1="4" x2="40" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 3" /></svg>
                            <span>Dashed</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="dotted">
                          <div className="flex items-center gap-2">
                            <svg width="40" height="8"><line x1="0" y1="4" x2="40" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3" /></svg>
                            <span>Dotted</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="dash-dot">
                          <div className="flex items-center gap-2">
                            <svg width="40" height="8"><line x1="0" y1="4" x2="40" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="8 3 2 3" /></svg>
                            <span>Dash-Dot</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="double">
                          <div className="flex items-center gap-2">
                            <svg width="40" height="10"><line x1="0" y1="3" x2="40" y2="3" stroke="currentColor" strokeWidth="1.5" /><line x1="0" y1="7" x2="40" y2="7" stroke="currentColor" strokeWidth="1.5" /></svg>
                            <span>Double</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Line Width</Label>
                    <Select
                      value={String(selM.lineWidth || 3)}
                      onValueChange={(val) => updateMeasurementMutation.mutate({ id: selM.id, lineWidth: parseInt(val), previous: { lineWidth: selM.lineWidth ?? null } })}
                      data-testid="select-line-width"
                    >
                      <SelectTrigger className="h-8 text-sm" data-testid="select-trigger-line-width">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        {[1, 2, 3, 4, 5].map(w => (
                          <SelectItem key={w} value={String(w)}>
                            <div className="flex items-center gap-2">
                              <svg width="30" height="10"><line x1="0" y1="5" x2="30" y2="5" stroke="currentColor" strokeWidth={w} /></svg>
                              <span>{w}px</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {measurementGroups.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs">Group</Label>
                      <Select
                        value={selM.groupId || "__none__"}
                        onValueChange={(val) => updateMeasurementMutation.mutate({ id: selM.id, groupId: val === "__none__" ? null : val, previous: { groupId: selM.groupId ?? null } })}
                        data-testid="select-measurement-group"
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid="select-trigger-measurement-group">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent container={workspaceRef.current}>
                          <SelectItem value="__none__">Ungrouped</SelectItem>
                          {measurementGroups.map(g => (
                            <SelectItem key={g.id} value={g.id}>
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: g.color }} />
                                <span>{g.name}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <LocationPickerField
                    projectId={projectId}
                    currentValue={(selM as any).locationId || null}
                    onCommit={(val) => updateMeasurementMutation.mutate({ id: selM.id, locationId: val || null })}
                    workspaceRef={workspaceRef}
                  />
                  <Separator />
                  <CostCodeField measurementId={selM.id} currentValue={(selM as any).costCodeId || ""} onCommit={(val) => { updateMeasurementMutation.mutate({ id: selM.id, costCodeId: val || undefined, previous: { costCodeId: (selM as any).costCodeId ?? null } }); }} />
                  <div className="space-y-2">
                    <Label className="text-xs">Unit Cost ($)</Label>
                    <Input type="number" placeholder="0.00" defaultValue={(selM as any).unitCost || ""} onBlur={(e) => { const val = parseFloat(e.target.value) || undefined; if (val !== (selM as any).unitCost) { updateMeasurementMutation.mutate({ id: selM.id, unitCost: val, previous: { unitCost: (selM as any).unitCost ?? null } }); } }} className="h-8 text-sm" data-testid="input-unit-cost" />
                  </div>
                  {(selM as any).unitCost && (selM.computedLengthFt || selM.computedAreaFt2 || (selM as any).computedSurfaceAreaFt2) && (
                    <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm">
                      <div className="flex justify-between font-medium">
                        <span>Estimated Total:</span>
                        <span className="text-green-600 dark:text-green-400">
                          ${(Number((selM as any).unitCost) * Number((selM as any).computedSurfaceAreaFt2 || selM.computedLengthFt || selM.computedAreaFt2 || 0)).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                  <Separator />
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => {
                      const uom = selM.type === "LINEAR" || selM.type === "PITCHED_LINEAR" || selM.type === "LINEAR_WITH_DROP" || selM.type === "SEGMENT"
                        ? "LF"
                        : selM.type === "AREA" || selM.type === "PITCHED_AREA" || selM.type === "SURFACE_AREA"
                        ? "SF"
                        : selM.type === "VOLUME"
                        ? "CY"
                        : "EA";
                      const totalCost = (selM as any).unitCost ? Number((selM as any).unitCost) : 0;
                      setSaveToLibraryItem({
                        name: selM.label || "Untitled Measurement",
                        unitOfMeasure: uom,
                        costTypes: ["material"],
                        unitCosts: totalCost > 0 ? { material: String(totalCost) } : {},
                        notes: (selM as any).costCodeId ? `Cost Code: ${(selM as any).costCodeId}` : "",
                      });
                      setSaveToLibraryOpen(true);
                    }}
                    data-testid="button-save-to-library"
                  >
                    <BookOpen className="w-3 h-3 mr-1" /> Save to Library
                  </Button>
                </CardContent>
              </Card>
            );
          })()}

          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold mb-4">Quantity Summary by Category</h3>
              <div className="space-y-4">
                {categories.map((category) => {
                  const categoryMeasurements = aggregatedMeasurements.byCategory[category.id] || [];
                  if (categoryMeasurements.length === 0) return null;
                  let linearTotal = categoryMeasurements.filter((m: any) => m.type === "LINEAR").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let areaTotal = categoryMeasurements.filter((m: any) => m.type === "AREA").reduce((sum: number, m: any) => { const val = Number(m.computedAreaFt2); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let volumeTotal = categoryMeasurements.filter((m: any) => m.type === "VOLUME").reduce((sum: number, m: any) => { const val = Number(m.computedVolumeCy); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let countTotal = 0;
                  categoryMeasurements.filter((m: any) => m.type === "COUNT").forEach((m: any) => {
                    let meta: any = {};
                    try { meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch (err) { console.warn("[TakeoffSidebar] Failed to parse count metadata:", err); }
                    const rawQty = Number(m.count ?? meta.quantity ?? 1);
                    const qty = Number.isFinite(rawQty) ? rawQty : 1;
                    const unit = (meta.unit || "EA").toUpperCase();
                    if (unit === "CY") { volumeTotal += qty; }
                    else if (unit === "SF") { areaTotal += qty; }
                    else if (unit === "LF") { linearTotal += qty; }
                    else { countTotal += qty; }
                  });
                  return (
                    <div key={category.id} className="border-l-4 pl-3" style={{ borderColor: category.color }}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: category.color }} />
                        <span className="font-medium text-sm">{category.name}</span>
                        <Badge variant="outline" className="text-xs">{categoryMeasurements.length}</Badge>
                      </div>
                      <div className="space-y-1 text-xs ml-5">
                        {linearTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Linear:</span><span>{(Number.isFinite(linearTotal) ? linearTotal : 0).toFixed(2)} LF</span></div>}
                        {areaTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span>{(Number.isFinite(areaTotal) ? areaTotal : 0).toFixed(2)} SF</span></div>}
                        {volumeTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{(Number.isFinite(volumeTotal) ? volumeTotal : 0).toFixed(2)} CY</span></div>}
                        {countTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Count:</span><span>{countTotal}</span></div>}
                      </div>
                    </div>
                  );
                })}

                {aggregatedMeasurements.uncategorized.length > 0 && (() => {
                  let uncatLinear = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let uncatArea = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "AREA").reduce((sum: number, m: any) => { const val = Number(m.computedAreaFt2); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let uncatVolume = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "VOLUME").reduce((sum: number, m: any) => { const val = Number(m.computedVolumeCy); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  let uncatCount = 0;
                  aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "COUNT").forEach((m: any) => {
                    let meta: any = {};
                    try { meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : (m.metadata || {}); } catch (err) { console.warn("[TakeoffSidebar] Failed to parse count metadata:", err); }
                    const rawQty = Number(m.count ?? meta.quantity ?? 1);
                    const qty = Number.isFinite(rawQty) ? rawQty : 1;
                    const unit = (meta.unit || "EA").toUpperCase();
                    if (unit === "CY") { uncatVolume += qty; }
                    else if (unit === "SF") { uncatArea += qty; }
                    else if (unit === "LF") { uncatLinear += qty; }
                    else { uncatCount += qty; }
                  });
                  return (
                  <div className="border-l-4 border-muted pl-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm text-muted-foreground">Uncategorized</span>
                      <Badge variant="outline" className="text-xs">{aggregatedMeasurements.uncategorized.length}</Badge>
                    </div>
                    <div className="space-y-1 text-xs ml-5">
                      {uncatLinear > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Linear:</span><span>{uncatLinear.toFixed(2)} LF</span></div>
                      )}
                      {uncatArea > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span>{uncatArea.toFixed(2)} SF</span></div>
                      )}
                      {uncatVolume > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{uncatVolume.toFixed(2)} CY</span></div>
                      )}
                      {uncatCount > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Count:</span><span>{uncatCount}</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "SEGMENT").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Segment:</span><span>{(() => { const total = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "SEGMENT").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0); return (Number.isFinite(total) ? total : 0).toFixed(2); })()} LF</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Pitched/Surface:</span><span>{aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length} items</span></div>
                      )}
                    </div>
                  </div>
                  );
                })()}

                {measurements.length > 0 && (
                  <div className="pt-3 border-t space-y-2">
                    <h4 className="font-semibold text-sm">Total Quantities</h4>
                    <div className="space-y-1 text-sm min-w-0">
                      <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Linear:</span><span className="font-medium text-right break-all">{(Number.isFinite(aggregatedMeasurements.grandTotals.linearTotal) ? aggregatedMeasurements.grandTotals.linearTotal : 0).toFixed(2)} LF</span></div>
                      <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Area:</span><span className="font-medium text-right break-all">{(Number.isFinite(aggregatedMeasurements.grandTotals.areaTotal) ? aggregatedMeasurements.grandTotals.areaTotal : 0).toFixed(2)} SF</span></div>
                      <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Volume:</span><span className="font-medium text-right break-all">{(Number.isFinite(aggregatedMeasurements.grandTotals.volumeTotal) ? aggregatedMeasurements.grandTotals.volumeTotal : 0).toFixed(2)} CY</span></div>
                      <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Count:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.countTotal}</span></div>
                      {aggregatedMeasurements.grandTotals.linearWithDropTotal > 0 && <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Linear+Drop:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.linearWithDropTotal.toFixed(2)} LF</span></div>}
                      {aggregatedMeasurements.grandTotals.pitchedLinearTotal > 0 && <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Pitched Linear:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.pitchedLinearTotal.toFixed(2)} LF</span></div>}
                      {aggregatedMeasurements.grandTotals.pitchedAreaTotal > 0 && <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Pitched Area:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.pitchedAreaTotal.toFixed(2)} SF</span></div>}
                      {aggregatedMeasurements.grandTotals.surfaceAreaTotal > 0 && <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Surface Area:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.surfaceAreaTotal.toFixed(2)} SF</span></div>}
                      {aggregatedMeasurements.grandTotals.segmentTotal > 0 && <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Segment:</span><span className="font-medium text-right break-all">{aggregatedMeasurements.grandTotals.segmentTotal.toFixed(2)} LF</span></div>}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedSheet && (
            <Card>
              <CardContent className="pt-6">
                <AssemblyPanel selectedMeasurementId={selectedMeasurementId} />
              </CardContent>
            </Card>
          )}

          {selectedSheet && (
            <Card>
              <CardContent className="pt-6 space-y-3 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                  <Layers className="w-4 h-4 text-primary shrink-0" />
                  <h3 className="font-semibold text-sm truncate">Addenda Overlays</h3>
                </div>
                <p className="text-xs text-muted-foreground break-words">Toggle addendum documents as overlays on the plan sheet.</p>
                {projectAddenda.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">No addenda for this project.</p>
                ) : (
                  <div className="space-y-2">
                    {projectAddenda.filter(a => {
                      if (!a.storageKey && !a.fileUrl) return false;
                      const key = a.storageKey || a.fileName || a.fileUrl || "";
                      return /\.(png|jpg|jpeg|gif|webp|bmp|svg|tiff?)$/i.test(key);
                    }).map((addendum) => {
                      const overlay = addendaOverlays[addendum.id];
                      const isVisible = overlay?.visible || false;
                      const opacity = overlay?.opacity ?? 0.5;
                      return (
                        <div key={addendum.id} className="border rounded-md p-2 space-y-2" data-testid={`addenda-overlay-${addendum.id}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => {
                                setAddendaOverlays((prev: any) => ({ ...prev, [addendum.id]: { ...prev[addendum.id], visible: !isVisible, opacity: prev[addendum.id]?.opacity ?? 0.5 } }));
                              }} data-testid={`button-toggle-addendum-${addendum.id}`}>
                                {isVisible ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                              </Button>
                              <span className="text-xs font-medium truncate">#{addendum.addendumNumber} — {addendum.title}</span>
                            </div>
                            <Badge variant="outline" className="text-[10px] shrink-0">{addendum.status}</Badge>
                          </div>
                          {isVisible && (
                            <div className="flex items-center gap-2 pl-8 min-w-0">
                              <span className="text-[10px] text-muted-foreground w-10 shrink-0">Opacity</span>
                              <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => {
                                const newOpacity = parseInt(e.target.value) / 100;
                                setAddendaOverlays((prev: any) => ({ ...prev, [addendum.id]: { ...prev[addendum.id], opacity: newOpacity } }));
                              }} className="flex-1 h-1 accent-primary" data-testid={`slider-opacity-addendum-${addendum.id}`} />
                              <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{Math.round(opacity * 100)}%</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(() => {
                      const imageAddenda = projectAddenda.filter(a => {
                        if (!a.storageKey && !a.fileUrl) return false;
                        const key = a.storageKey || a.fileName || a.fileUrl || "";
                        return /\.(png|jpg|jpeg|gif|webp|bmp|svg|tiff?)$/i.test(key);
                      });
                      const nonImageCount = projectAddenda.length - imageAddenda.length;
                      if (nonImageCount > 0) return (
                        <p className="text-[10px] text-muted-foreground italic break-words">
                          {nonImageCount} addenda not shown (PDF or no file attached — only image overlays supported)
                        </p>
                      );
                      return null;
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {selectedSheet && currentSheet?.scalePxPerFoot && (
            <Card>
              <CardContent className="pt-6 space-y-3 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                  <Info className="w-4 h-4 text-primary shrink-0" />
                  <h3 className="font-semibold text-sm truncate">Calibration Info</h3>
                </div>
                <div className="space-y-2 text-xs min-w-0">
                  <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Scale:</span><span className="font-mono text-right break-all">{currentSheet.scalePxPerFoot.toFixed(2)} px/{currentSheet.units || "ft"}</span></div>
                  <div className="flex justify-between gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Units:</span><span className="text-right">{currentSheet.units === "m" ? "Meters" : "Feet"}</span></div>
                  <div className="flex justify-between items-center gap-2 min-w-0"><span className="text-muted-foreground shrink-0">Status:</span><Badge variant="default" className="text-[10px] shrink-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Calibrated</Badge></div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                    setVerifyMode("first-point"); setVerifyPoints([]); setVerifyResult(null);
                    toast({ title: "Scale Verification", description: "Click two points on a known distance to verify accuracy" });
                  }} data-testid="button-start-verify">
                    <Target className="w-3 h-3 mr-1" /> Verify Scale Accuracy
                  </Button>
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                    setMultiCalibMode(true); setMultiCalibPoints([]); setCalibrationMode("first-point"); setCalibrationPoints([]);
                    toast({ title: "Multi-Point Calibration", description: "Take multiple reference measurements for higher accuracy. Click two points for each reference distance." });
                  }} data-testid="button-start-multi-calib">
                    <Ruler className="w-3 h-3 mr-1" /> Multi-Point Calibration
                  </Button>
                  {sheets.length > 1 && currentSheet?.scalePxPerFoot && sheets.some((s: any) => s.id !== selectedSheet && !s.scalePxPerFoot) && (
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setPropagateDialogOpen(true)} data-testid="button-apply-to-all-sheets">
                      <Copy className="w-3 h-3 mr-1" /> Apply to All Sheets
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {(verifyMode !== "idle" || verifyResult) && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Scale Verification</h3>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setVerifyMode("idle"); setVerifyPoints([]); setVerifyResult(null); setVerifyExpectedDistance(""); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{verifyMode === "first-point" ? "Click first point of known distance" : "Click second point to measure"}</p>
                <div>
                  <Label className="text-xs">Expected Distance</Label>
                  <div className="flex gap-2">
                    <Input type="number" value={verifyExpectedDistance} onChange={(e) => setVerifyExpectedDistance(e.target.value)} placeholder="e.g. 20" className="h-8 text-xs" data-testid="input-verify-distance" />
                    <span className="text-xs text-muted-foreground self-center">{currentSheet?.units || "ft"}</span>
                  </div>
                </div>
                {verifyResult && (
                  <>
                    <div className={`p-2 rounded text-xs ${verifyResult.errorPct <= 2 ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : verifyResult.errorPct <= 5 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"} border`}>
                      <div className="flex items-center gap-1 mb-1">
                        {verifyResult.errorPct <= 2 ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <AlertTriangle className="w-3 h-3 text-amber-600" />}
                        <span className="font-medium">{verifyResult.errorPct <= 2 ? "Accurate" : verifyResult.errorPct <= 5 ? "Minor deviation" : "Significant deviation"}</span>
                      </div>
                      <div>Expected: {verifyResult.expected.toFixed(2)} {currentSheet?.units || "ft"}</div>
                      <div>Measured: {verifyResult.measured.toFixed(2)} {currentSheet?.units || "ft"}</div>
                      <div>Error: {verifyResult.errorPct.toFixed(1)}%</div>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setVerifyMode("first-point"); setVerifyPoints([]); setVerifyResult(null); }} data-testid="button-verify-again">
                      <Target className="w-3 h-3 mr-1" /> Verify Again
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {multiCalibMode && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Multi-Point Calibration</h3>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setMultiCalibMode(false); setMultiCalibPoints([]); setCalibrationMode("idle"); setCalibrationPoints([]); }}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Add multiple reference measurements, then apply averaged calibration for better accuracy.</p>
                {multiCalibPoints.length > 0 && (
                  <div className="space-y-1">
                    {multiCalibPoints.map((entry, i) => (
                      <div key={i} className="flex items-center justify-between text-xs p-1 bg-muted rounded">
                        <span>Ref #{i + 1}: {entry.distance} {currentSheet?.units || "ft"}</span>
                        <span className="text-muted-foreground font-mono">{computePixelDistance(entry.points[0], entry.points[1]).toFixed(1)} px</span>
                      </div>
                    ))}
                  </div>
                )}
                {calibrationPoints.length === 2 && (
                  <div className="space-y-2">
                    <Label className="text-xs">Distance for this reference</Label>
                    <div className="flex gap-2">
                      <Input type="number" value={calibrationDistance} onChange={(e) => setCalibrationDistance(e.target.value)} placeholder="Distance" className="h-8 text-xs" data-testid="input-multi-calib-distance" />
                      <Button size="sm" className="h-8 text-xs" disabled={!calibrationDistance} onClick={() => {
                        const dist = parseFloat(calibrationDistance);
                        if (!dist || dist <= 0) return;
                        setMultiCalibPoints((prev: any) => [...prev, { points: [calibrationPoints[0], calibrationPoints[1]], distance: dist }]);
                        setCalibrationPoints([]);
                        setCalibrationDistance("");
                        setCalibrationMode("first-point");
                        toast({ title: "Reference Added", description: `Reference #${multiCalibPoints.length + 1} recorded. Add more or apply.` });
                      }} data-testid="button-add-multi-ref">
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </Button>
                    </div>
                  </div>
                )}
                {multiCalibPoints.length >= 2 && (
                  <Button className="w-full text-xs" size="sm" onClick={async () => {
                    const avgPxPerUnit = multiCalibPoints.reduce((sum, entry) => {
                      const pxDist = computePixelDistance(entry.points[0], entry.points[1]);
                      return sum + pxDist / entry.distance;
                    }, 0) / multiCalibPoints.length;
                    if (!Number.isFinite(avgPxPerUnit) || avgPxPerUnit <= 0) {
                      toast({ title: "Error", description: "Invalid calibration result", variant: "destructive" }); return;
                    }
                    try {
                      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: avgPxPerUnit, units: currentSheet?.units || "ft" });
                      queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
                      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
                      setMultiCalibMode(false); setMultiCalibPoints([]); setCalibrationMode("idle"); setCalibrationPoints([]);
                      toast({ title: "Success", description: `Multi-point calibration applied (${multiCalibPoints.length} references averaged)` });
                    } catch { toast({ title: "Error", description: "Failed to save calibration", variant: "destructive" }); }
                  }} data-testid="button-apply-multi-calib">
                    <Save className="w-3 h-3 mr-1" /> Apply Averaged Calibration ({multiCalibPoints.length} points)
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          {revisionChain.length > 1 && (
            <Collapsible defaultOpen>
              <Card>
                <CardContent className="pt-4 pb-2">
                  <CollapsibleTrigger asChild>
                    <button className="w-full flex items-center justify-between mb-3 group" data-testid="button-revision-history-toggle">
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-muted-foreground" />
                        <h3 className="font-semibold text-sm">Revision History</h3>
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">{revisionChain.length}</Badge>
                      </div>
                      <ChevronDown className="w-4 h-4 text-muted-foreground group-data-[state=open]:rotate-180 transition-transform" />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-1.5">
                      {revisionChain.map((s: any, idx: number) => {
                        const isCurrent = s.id === currentSheet?.id;
                        const isSuperseded = s.isActive === false;
                        return (
                          <div
                            key={s.id}
                            className={cn(
                              "flex items-center gap-2 p-2 rounded-md text-sm cursor-pointer hover:bg-muted transition-colors",
                              isCurrent && "bg-primary/10 ring-1 ring-primary/30"
                            )}
                            onClick={() => !isCurrent && onSelectSheet?.(s.id)}
                            data-testid={`revision-item-${s.id}`}
                          >
                            {s.scalePxPerFoot ? (
                              <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                            ) : (
                              <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                            )}
                            <span className={cn("flex-1 truncate", isSuperseded && "text-muted-foreground")}>
                              {s.sheetName}
                            </span>
                            {s.revisionLabel && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">{s.revisionLabel}</Badge>
                            )}
                            {isSuperseded && !isCurrent && (
                              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0 opacity-60">Old</Badge>
                            )}
                            {isCurrent && (
                              <Badge className="text-[10px] px-1 py-0 h-4 shrink-0">Current</Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {onCompareRevisions && (
                      <Button variant="ghost" size="sm" className="w-full mt-2 gap-2 text-xs h-7" onClick={onCompareRevisions} data-testid="button-sidebar-compare">
                        <GitCompare className="w-3.5 h-3.5" /> Compare Revisions
                      </Button>
                    )}
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>
          )}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left text-sm font-semibold" data-testid="button-toggle-typicals-panel">
                  <ChevronRight className="w-4 h-4" />
                  <Copy className="w-4 h-4" />
                  Typical Layouts
                  <Badge variant="secondary" className="ml-auto">{typicals.length}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 mt-2">
                    <p className="text-[10px] text-muted-foreground">Save a group of measurements as a typical to stamp/repeat in other locations.</p>
                    {selectedMeasurementId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-7 text-xs"
                        onClick={() => {
                          const ids = bulkSelectMode && bulkSelectedIds.size > 0
                            ? Array.from(bulkSelectedIds)
                            : selectedMeasurementId ? [selectedMeasurementId] : [];
                          if (ids.length > 0 && onSaveTypical) {
                            const name = `Typical ${typicals.length + 1}`;
                            onSaveTypical(name, ids);
                          }
                        }}
                        data-testid="button-save-typical"
                      >
                        <Plus className="w-3 h-3 mr-1" /> Save Selected as Typical
                      </Button>
                    )}
                    {typicals.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-xs" data-testid={`typical-item-${t.id}`}>
                        <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{t.name} ({t.measurementIds.length} items)</span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 text-[10px] px-1.5"
                          onClick={() => onStampTypical?.(t.id)}
                          data-testid={`button-stamp-typical-${t.id}`}
                        >
                          Stamp
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={() => onDeleteTypical?.(t.id)}
                          data-testid={`button-delete-typical-${t.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 space-y-2">
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 w-full text-left text-sm font-semibold" data-testid="button-toggle-gridlines-panel">
                  <ChevronRight className="w-4 h-4" />
                  <Ruler className="w-4 h-4" />
                  Column Gridlines
                  <Badge variant="secondary" className="ml-auto">{structuralGridlines.vertical.length + structuralGridlines.horizontal.length}</Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-2 mt-2">
                    <p className="text-[10px] text-muted-foreground">Define structural column gridlines with alphanumeric labels (A, B, C / 1, 2, 3).</p>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold">Vertical (A, B, C...)</Label>
                      {structuralGridlines.vertical.map((gl, idx) => (
                        <div key={`v-${idx}`} className="flex items-center gap-1 text-xs" data-testid={`gridline-vertical-${idx}`}>
                          <Input
                            className="h-6 w-12 text-[10px] px-1"
                            defaultValue={gl.label}
                            onBlur={(e) => {
                              const updated = { ...structuralGridlines, vertical: [...structuralGridlines.vertical] };
                              updated.vertical[idx] = { ...updated.vertical[idx], label: e.target.value };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`input-gridline-vlabel-${idx}`}
                          />
                          <Input
                            type="number"
                            className="h-6 w-16 text-[10px] px-1"
                            defaultValue={gl.position}
                            onBlur={(e) => {
                              const updated = { ...structuralGridlines, vertical: [...structuralGridlines.vertical] };
                              updated.vertical[idx] = { ...updated.vertical[idx], position: parseFloat(e.target.value) || 0 };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`input-gridline-vpos-${idx}`}
                          />
                          <span className="text-[9px] text-muted-foreground">px</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 text-destructive ml-auto"
                            onClick={() => {
                              const updated = { ...structuralGridlines, vertical: structuralGridlines.vertical.filter((_, i) => i !== idx) };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`button-delete-gridline-v-${idx}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2"
                        onClick={() => {
                          const nextLabel = String.fromCharCode(65 + structuralGridlines.vertical.length);
                          const lastPos = structuralGridlines.vertical.length > 0
                            ? structuralGridlines.vertical[structuralGridlines.vertical.length - 1].position + 200
                            : 100;
                          const updated = { ...structuralGridlines, vertical: [...structuralGridlines.vertical, { label: nextLabel, position: lastPos }] };
                          onUpdateGridlines?.(updated);
                        }}
                        data-testid="button-add-gridline-vertical"
                      >
                        <Plus className="w-3 h-3 mr-0.5" /> Add Vertical
                      </Button>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] font-semibold">Horizontal (1, 2, 3...)</Label>
                      {structuralGridlines.horizontal.map((gl, idx) => (
                        <div key={`h-${idx}`} className="flex items-center gap-1 text-xs" data-testid={`gridline-horizontal-${idx}`}>
                          <Input
                            className="h-6 w-12 text-[10px] px-1"
                            defaultValue={gl.label}
                            onBlur={(e) => {
                              const updated = { ...structuralGridlines, horizontal: [...structuralGridlines.horizontal] };
                              updated.horizontal[idx] = { ...updated.horizontal[idx], label: e.target.value };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`input-gridline-hlabel-${idx}`}
                          />
                          <Input
                            type="number"
                            className="h-6 w-16 text-[10px] px-1"
                            defaultValue={gl.position}
                            onBlur={(e) => {
                              const updated = { ...structuralGridlines, horizontal: [...structuralGridlines.horizontal] };
                              updated.horizontal[idx] = { ...updated.horizontal[idx], position: parseFloat(e.target.value) || 0 };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`input-gridline-hpos-${idx}`}
                          />
                          <span className="text-[9px] text-muted-foreground">px</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 text-destructive ml-auto"
                            onClick={() => {
                              const updated = { ...structuralGridlines, horizontal: structuralGridlines.horizontal.filter((_, i) => i !== idx) };
                              onUpdateGridlines?.(updated);
                            }}
                            data-testid={`button-delete-gridline-h-${idx}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2"
                        onClick={() => {
                          const nextLabel = String(structuralGridlines.horizontal.length + 1);
                          const lastPos = structuralGridlines.horizontal.length > 0
                            ? structuralGridlines.horizontal[structuralGridlines.horizontal.length - 1].position + 200
                            : 100;
                          const updated = { ...structuralGridlines, horizontal: [...structuralGridlines.horizontal, { label: nextLabel, position: lastPos }] };
                          onUpdateGridlines?.(updated);
                        }}
                        data-testid="button-add-gridline-horizontal"
                      >
                        <Plus className="w-3 h-3 mr-0.5" /> Add Horizontal
                      </Button>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {markups.length > 0 && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <button
                  className="flex items-center gap-2 w-full text-left text-sm font-semibold"
                  onClick={() => setMarkupsPanelOpen(v => !v)}
                  data-testid="button-toggle-markups-panel"
                >
                  {markupsPanelOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Pen className="w-4 h-4" />
                  Markups
                  <Badge variant="secondary" className="ml-auto">{markups.length}</Badge>
                </button>
                {markupsPanelOpen && (
                  <div className="space-y-1 mt-1">
                    {markups.map((markup) => {
                      const tool = markup.tool as string;
                      const color = (markup.color as string) || "#ff0000";
                      const ToolIcon =
                        tool === "TEXT" ? Type :
                        tool === "RECTANGLE" ? Square :
                        tool === "HIGHLIGHT" ? Highlighter :
                        tool === "FREEHAND" ? Pen :
                        tool === "CLOUD" ? Spline :
                        Pencil;
                      return (
                        <div
                          key={markup.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm group"
                          data-testid={`markup-item-${markup.id}`}
                        >
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                          <ToolIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate text-xs capitalize">
                            {tool.toLowerCase()}{markup.text ? `: ${markup.text}` : ""}
                          </span>
                          {deleteMarkupMutation && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
                              onClick={() => deleteMarkupMutation.mutate(markup)}
                              disabled={deleteMarkupMutation.isPending}
                              data-testid={`button-delete-markup-${markup.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
      )}

      {saveToLibraryOpen && (
        <LibraryItemDialog
          open={saveToLibraryOpen}
          onOpenChange={(open) => {
            setSaveToLibraryOpen(open);
            if (!open) setSaveToLibraryItem(null);
          }}
          item={null}
          initialValues={saveToLibraryItem || undefined}
        />
      )}

      <Dialog open={propagateDialogOpen} onOpenChange={setPropagateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Scale to Other Sheets</DialogTitle>
            <DialogDescription>
              Apply the current calibration ({currentSheet?.scalePxPerFoot?.toFixed(2)} px/{currentSheet?.units || "ft"}) to uncalibrated sheets.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={propagateMode === "all" ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setPropagateMode("all")}
                data-testid="button-propagate-all"
              >
                All Uncalibrated
              </Button>
              <Button
                variant={propagateMode === "same-plan" ? "default" : "outline"}
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setPropagateMode("same-plan")}
                data-testid="button-propagate-same-plan"
              >
                Same Plan Only
              </Button>
            </div>
            {(() => {
              const uncalibratedSheets = sheets.filter((s: any) => {
                if (s.id === selectedSheet) return false;
                if (s.scalePxPerFoot) return false;
                if (propagateMode === "same-plan" && currentSheet?.planId) {
                  return s.planId === currentSheet.planId;
                }
                return propagateMode === "all";
              });
              return (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {uncalibratedSheets.length === 0
                      ? "No uncalibrated sheets found."
                      : `${uncalibratedSheets.length} sheet${uncalibratedSheets.length !== 1 ? "s" : ""} will be updated:`}
                  </p>
                  {uncalibratedSheets.length > 0 && (
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {uncalibratedSheets.map((s: any) => (
                        <div key={s.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted rounded" data-testid={`propagate-sheet-${s.id}`}>
                          <AlertCircle className="w-3 h-3 text-amber-500 shrink-0" />
                          <span className="truncate">{s.sheetName}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPropagateDialogOpen(false)} data-testid="button-propagate-cancel">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPropagating}
              onClick={async () => {
                const uncalibratedSheets = sheets.filter((s: any) => {
                  if (s.id === selectedSheet) return false;
                  if (s.scalePxPerFoot) return false;
                  if (propagateMode === "same-plan" && currentSheet?.planId) {
                    return s.planId === currentSheet.planId;
                  }
                  return propagateMode === "all";
                });
                if (uncalibratedSheets.length === 0) {
                  setPropagateDialogOpen(false);
                  return;
                }
                setIsPropagating(true);
                try {
                  await apiRequest("PATCH", "/api/takeoff/sheets/batch-calibration", {
                    sheetIds: uncalibratedSheets.map((s: any) => s.id),
                    scalePxPerFoot: currentSheet?.scalePxPerFoot,
                    units: currentSheet?.units || "ft",
                  });
                  queryClient.invalidateQueries({ queryKey: sheetsQueryKey || ["/api/projects", projectId, "takeoff", "sheets"] });
                  toast({ title: "Scale Propagated", description: `Applied calibration to ${uncalibratedSheets.length} sheet${uncalibratedSheets.length !== 1 ? "s" : ""}` });
                  setPropagateDialogOpen(false);
                } catch {
                  toast({ title: "Error", description: "Failed to propagate scale", variant: "destructive" });
                } finally {
                  setIsPropagating(false);
                }
              }}
              data-testid="button-propagate-confirm"
            >
              {isPropagating ? "Applying..." : "Apply Scale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={conditionDialogOpen} onOpenChange={setConditionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCondition ? "Edit Condition" : "New Condition"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input value={condForm.name} onChange={(e) => setCondForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Concrete Slab" data-testid="input-condition-name" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Measurement Type</Label>
              <Select value={condForm.measurementType} onValueChange={(v) => setCondForm(f => ({ ...f, measurementType: v }))}>
                <SelectTrigger data-testid="select-condition-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LINEAR">Linear</SelectItem>
                  <SelectItem value="AREA">Area</SelectItem>
                  <SelectItem value="VOLUME">Volume</SelectItem>
                  <SelectItem value="COUNT">Count</SelectItem>
                  <SelectItem value="LINEAR_WITH_DROP">Linear + Drop</SelectItem>
                  <SelectItem value="PITCHED_LINEAR">Pitched Linear</SelectItem>
                  <SelectItem value="PITCHED_AREA">Pitched Area</SelectItem>
                  <SelectItem value="SURFACE_AREA">Surface Area</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Color</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={condForm.color} onChange={(e) => setCondForm(f => ({ ...f, color: e.target.value }))} className="w-10 h-8 rounded border cursor-pointer" data-testid="input-condition-color" />
                <span className="text-xs text-muted-foreground">{condForm.color}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Category Name (optional)</Label>
              <Input value={condForm.categoryName} onChange={(e) => setCondForm(f => ({ ...f, categoryName: e.target.value }))} placeholder="e.g. Foundation" data-testid="input-condition-category" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Unit Cost (optional)</Label>
              <Input type="number" value={condForm.unitCost} onChange={(e) => setCondForm(f => ({ ...f, unitCost: e.target.value }))} placeholder="0.00" data-testid="input-condition-unit-cost" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Cost Code (optional)</Label>
              <Input value={condForm.costCodeId} onChange={(e) => setCondForm(f => ({ ...f, costCodeId: e.target.value }))} placeholder="e.g. 03 30 00" data-testid="input-condition-cost-code" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Label Template (optional)</Label>
              <Input value={condForm.labelTemplate} onChange={(e) => setCondForm(f => ({ ...f, labelTemplate: e.target.value }))} placeholder="e.g. Slab #{n}" data-testid="input-condition-label-template" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Line Style</Label>
              <Select value={condForm.lineStyle} onValueChange={(v) => setCondForm(f => ({ ...f, lineStyle: v }))}>
                <SelectTrigger data-testid="select-condition-line-style"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="solid">Solid</SelectItem>
                  <SelectItem value="dashed">Dashed</SelectItem>
                  <SelectItem value="dotted">Dotted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <FormulaEditor
              formula={condForm.formula}
              onChange={(f) => setCondForm(prev => ({ ...prev, formula: f }))}
              measurementType={condForm.measurementType}
            />
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium w-full py-1">
                <ChevronRight className="w-3 h-3 transition-transform ui-open:rotate-90" />
                Assembly Components ({condForm.assemblyComponents.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                {condForm.assemblyComponents.map((comp, idx) => (
                  <div key={comp.id} className="border rounded p-2 space-y-1.5 bg-muted/30" data-testid={`assembly-component-${idx}`}>
                    <div className="flex items-center justify-between">
                      <Input
                        className="h-7 text-xs flex-1 mr-2"
                        placeholder="Component name"
                        value={comp.name}
                        onChange={(e) => {
                          const updated = [...condForm.assemblyComponents];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setCondForm(f => ({ ...f, assemblyComponents: updated }));
                        }}
                        data-testid={`input-assembly-name-${idx}`}
                      />
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => {
                        setCondForm(f => ({ ...f, assemblyComponents: f.assemblyComponents.filter((_, i) => i !== idx) }));
                      }} data-testid={`button-remove-assembly-${idx}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <Label className="text-[10px]">Unit</Label>
                        <Input className="h-6 text-[10px]" value={comp.unit} onChange={(e) => {
                          const updated = [...condForm.assemblyComponents];
                          updated[idx] = { ...updated[idx], unit: e.target.value };
                          setCondForm(f => ({ ...f, assemblyComponents: updated }));
                        }} placeholder="LF" data-testid={`input-assembly-unit-${idx}`} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Unit Cost</Label>
                        <Input className="h-6 text-[10px]" type="number" value={comp.unitCost || ""} onChange={(e) => {
                          const updated = [...condForm.assemblyComponents];
                          updated[idx] = { ...updated[idx], unitCost: parseFloat(e.target.value) || 0 };
                          setCondForm(f => ({ ...f, assemblyComponents: updated }));
                        }} placeholder="0.00" data-testid={`input-assembly-cost-${idx}`} />
                      </div>
                      <div>
                        <Label className="text-[10px]">Waste %</Label>
                        <Input className="h-6 text-[10px]" type="number" value={comp.wasteFactor || ""} onChange={(e) => {
                          const updated = [...condForm.assemblyComponents];
                          updated[idx] = { ...updated[idx], wasteFactor: parseFloat(e.target.value) || 0 };
                          setCondForm(f => ({ ...f, assemblyComponents: updated }));
                        }} placeholder="0" data-testid={`input-assembly-waste-${idx}`} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[10px]">Formula</Label>
                      <Input className="h-6 text-[10px] font-mono" value={comp.formula} onChange={(e) => {
                        const updated = [...condForm.assemblyComponents];
                        updated[idx] = { ...updated[idx], formula: e.target.value };
                        setCondForm(f => ({ ...f, assemblyComponents: updated }));
                      }} placeholder="e.g. length / 1.333 + 1" data-testid={`input-assembly-formula-${idx}`} />
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => {
                  const newComp: AssemblyComponent = {
                    id: crypto.randomUUID(),
                    name: "",
                    measurementType: condForm.measurementType,
                    unit: condForm.measurementType === "AREA" ? "SF" : condForm.measurementType === "VOLUME" ? "CY" : "LF",
                    unitCost: 0,
                    formula: condForm.measurementType === "AREA" ? "area" : condForm.measurementType === "VOLUME" ? "volume" : "length",
                    wasteFactor: 0,
                  };
                  setCondForm(f => ({ ...f, assemblyComponents: [...f.assemblyComponents, newComp] }));
                }} data-testid="button-add-assembly-component">
                  <Plus className="w-3 h-3 mr-1" /> Add Component
                </Button>
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConditionDialogOpen(false)} data-testid="button-condition-cancel">Cancel</Button>
            <Button
              disabled={!condForm.name || !condForm.measurementType || saveConditionPending}
              onClick={() => {
                const payload = {
                  name: condForm.name,
                  measurementType: condForm.measurementType,
                  color: condForm.color,
                  categoryName: condForm.categoryName || undefined,
                  unitCost: condForm.unitCost ? parseFloat(condForm.unitCost) : undefined,
                  costCodeId: condForm.costCodeId || undefined,
                  labelTemplate: condForm.labelTemplate || undefined,
                  lineStyle: condForm.lineStyle || undefined,
                  formula: condForm.formula || undefined,
                  assemblyComponents: condForm.assemblyComponents.length > 0 ? JSON.stringify(condForm.assemblyComponents) : undefined,
                };
                if (editingCondition) {
                  onUpdateCondition?.({ id: editingCondition.id, ...payload });
                } else {
                  onSaveCondition?.(payload);
                }
                setConditionDialogOpen(false);
              }}
              data-testid="button-condition-save"
            >
              {editingCondition ? "Update" : "Save"} Condition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkPasteOpen} onOpenChange={setBulkPasteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Paste Items</DialogTitle>
            <DialogDescription>
              Paste items one per line. Format: Label, Quantity, Unit (tab or comma separated).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <textarea
              className="w-full h-40 p-3 text-sm border rounded-md bg-background resize-none font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={"Window, 12, EA\nDoor, 4, EA\nConcrete Slab, 250, SF"}
              value={bulkPasteText}
              onChange={(e) => setBulkPasteText(e.target.value)}
              data-testid="textarea-bulk-paste"
            />
            <p className="text-[10px] text-muted-foreground">
              {bulkPasteText.trim() ? `${bulkPasteText.trim().split("\n").filter(l => l.trim()).length} item(s) detected` : "Paste or type items above"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkPasteOpen(false); setBulkPasteText(""); }}>Cancel</Button>
            <Button onClick={handleBulkPaste} disabled={bulkPastePending || !bulkPasteText.trim()} data-testid="button-bulk-paste-submit">
              {bulkPastePending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              {bulkPastePending ? "Adding..." : "Add Items"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSummaryReport} onOpenChange={setShowSummaryReport}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto print:max-w-none print:max-h-none print:overflow-visible print:shadow-none" data-testid="measurement-summary-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              Measurement Summary Report
            </DialogTitle>
            <DialogDescription>
              {currentSheet?.sheetName ? `Sheet: ${currentSheet.sheetName}` : "All measurements"} · {measurements.length} measurement{measurements.length !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 print:space-y-2" id="measurement-summary-content">
            {(() => {
              const byCat: Record<string, { name: string; color: string; measurements: typeof measurements }> = {};
              const uncategorized: typeof measurements = [];
              measurements.forEach(m => {
                const cat = categories.find(c => c.id === m.categoryId);
                if (cat) {
                  if (!byCat[cat.id]) byCat[cat.id] = { name: cat.name, color: cat.color, measurements: [] };
                  byCat[cat.id].measurements.push(m);
                } else {
                  uncategorized.push(m);
                }
              });
              const catEntries = Object.values(byCat);
              const formatVal = (v: number | string | null | undefined) => {
                const n = Number(v);
                return isNaN(n) ? "0" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              };
              const getUnit = (m: typeof measurements[0]) => {
                switch (m.type) {
                  case "COUNT":
                    return "ea";
                  case "AREA":
                  case "PITCHED_AREA":
                  case "SURFACE_AREA":
                    return "sf";
                  case "VOLUME":
                    return "cy";
                  case "NOTE":
                    return "";
                  default:
                    return "lf";
                }
              };
              const getQty = (m: typeof measurements[0]) => {
                switch (m.type) {
                  case "COUNT":
                    return Number(m.count || 0);
                  case "AREA":
                  case "PITCHED_AREA":
                    return Number(m.computedAreaFt2 || 0);
                  case "SURFACE_AREA":
                    return Number(m.computedSurfaceAreaFt2 || m.computedAreaFt2 || 0);
                  case "VOLUME":
                    return Number(m.computedVolumeCy || 0);
                  case "NOTE":
                    return 0;
                  default:
                    return Number(m.computedLengthFt || 0);
                }
              };
              const formatType = (t: string | null | undefined) =>
                (t || "").toLowerCase().replace(/_/g, " ");
              const renderGroup = (title: string, color: string | null, items: typeof measurements) => (
                <div key={title} className="border rounded-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                    {color && <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                    <span className="text-sm font-semibold">{title}</span>
                    <Badge variant="secondary" className="text-xs ml-auto">{items.length}</Badge>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left p-2 font-medium">Label</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-right p-2 font-medium">Qty</th>
                        <th className="text-right p-2 font-medium">Unit</th>
                        <th className="text-right p-2 font-medium">Unit Cost</th>
                        <th className="text-right p-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(m => {
                        const qty = getQty(m);
                        const unitCost = Number(m.unitCost || 0);
                        const total = qty * unitCost;
                        return (
                          <tr key={m.id} className="border-b last:border-b-0 hover:bg-muted/20" data-testid={`row-summary-${m.id}`}>
                            <td className="p-2 font-medium" data-testid={`text-summary-label-${m.id}`}>{m.label || formatType(m.type)}</td>
                            <td className="p-2 text-muted-foreground capitalize" data-testid={`text-summary-type-${m.id}`}>{formatType(m.type)}</td>
                            <td className="p-2 text-right font-mono" data-testid={`text-summary-qty-${m.id}`}>{formatVal(qty)}</td>
                            <td className="p-2 text-right text-muted-foreground" data-testid={`text-summary-unit-${m.id}`}>{getUnit(m)}</td>
                            <td className="p-2 text-right font-mono">{unitCost > 0 ? `$${formatVal(unitCost)}` : "—"}</td>
                            <td className="p-2 text-right font-mono font-medium">{total > 0 ? `$${formatVal(total)}` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/30">
                        <td colSpan={2} className="p-2 font-semibold">Subtotal</td>
                        <td className="p-2 text-right font-mono font-semibold" data-testid={`text-summary-subtotal-qty-${title}`}>{formatVal(items.reduce((s, m) => s + getQty(m), 0))}</td>
                        <td className="p-2" />
                        <td className="p-2" />
                        <td className="p-2 text-right font-mono font-semibold">
                          {(() => { const t = items.reduce((s, m) => s + getQty(m) * Number(m.unitCost || 0), 0); return t > 0 ? `$${formatVal(t)}` : "—"; })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
              return (
                <>
                  {catEntries.map(e => renderGroup(e.name, e.color, e.measurements))}
                  {uncategorized.length > 0 && renderGroup("Uncategorized", null, uncategorized)}
                  <div className="border rounded-lg p-3 bg-primary/5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">Grand Total</span>
                      <div className="text-right">
                        <span className="text-sm font-mono font-bold" data-testid="text-summary-grand-total">
                          {(() => {
                            const t = measurements.reduce((s, m) => s + getQty(m) * Number(m.unitCost || 0), 0);
                            return t > 0 ? `$${formatVal(t)}` : "—";
                          })()}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          ({measurements.length} measurement{measurements.length !== 1 ? "s" : ""})
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
          <DialogFooter className="print:hidden">
            <Button variant="outline" onClick={() => setShowSummaryReport(false)} data-testid="button-close-summary">
              Close
            </Button>
            <Button onClick={() => window.print()} data-testid="button-print-summary">
              <Download className="w-4 h-4 mr-2" />
              Print / Export
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={applyToProjectOpen} onOpenChange={setApplyToProjectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Apply Conditions to Project</DialogTitle>
            <DialogDescription>Select conditions and enter the target project code to copy them.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Target Project Code</Label>
              <Input
                value={applyProjectCode}
                onChange={(e) => setApplyProjectCode(e.target.value)}
                placeholder="e.g. PRJ-001"
                data-testid="input-apply-project-code"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Select Conditions ({applySelectedIds.size} selected)</Label>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                <Button variant="ghost" size="sm" className="w-full text-xs h-6 justify-start" onClick={() => {
                  if (applySelectedIds.size === conditions.length) {
                    setApplySelectedIds(new Set());
                  } else {
                    setApplySelectedIds(new Set(conditions.map(c => c.id)));
                  }
                }} data-testid="button-toggle-all-conditions">
                  {applySelectedIds.size === conditions.length ? "Deselect All" : "Select All"}
                </Button>
                {conditions.map(cond => (
                  <label key={cond.id} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/50 px-1 rounded text-xs" data-testid={`checkbox-apply-condition-${cond.id}`}>
                    <input
                      type="checkbox"
                      checked={applySelectedIds.has(cond.id)}
                      onChange={() => {
                        const next = new Set(applySelectedIds);
                        if (next.has(cond.id)) next.delete(cond.id);
                        else next.add(cond.id);
                        setApplySelectedIds(next);
                      }}
                    />
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cond.color }} />
                    <span className="truncate">{cond.name}</span>
                    <Badge variant="secondary" className="text-[9px] ml-auto">{cond.measurementType}</Badge>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyToProjectOpen(false)} data-testid="button-apply-cancel">Cancel</Button>
            <Button
              disabled={applyPending || !applyProjectCode.trim() || applySelectedIds.size === 0}
              onClick={async () => {
                setApplyPending(true);
                try {
                  await apiRequest("POST", "/api/takeoff/conditions/apply-to-project", {
                    conditionIds: Array.from(applySelectedIds),
                    projectCode: applyProjectCode.trim(),
                  });
                  toast({ title: "Conditions Applied", description: `${applySelectedIds.size} condition(s) applied to ${applyProjectCode}` });
                  setApplyToProjectOpen(false);
                } catch (err: any) {
                  toast({ title: "Failed", description: err.message || "Could not apply conditions", variant: "destructive" });
                } finally {
                  setApplyPending(false);
                }
              }}
              data-testid="button-apply-submit"
            >
              {applyPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FolderInput className="w-4 h-4 mr-2" />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
