import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, Save, Layers, Eye, EyeOff, CheckCircle2, AlertTriangle, AlertCircle, Target, Info, Ruler, X,
  History, ChevronDown, ChevronRight, GitCompare, Pen, Square, Highlighter, Type, Spline, Flag, BookOpen, Copy, Download
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { COMMON_SCALES, type Tool, type AddendumOverlayData } from "./types";
import { computePixelDistance } from "@shared/utils/geometry";
import { apiRequest, queryClient } from "@/lib/queryClient";
import AssemblyPanel from "@/components/AssemblyPanel";
import LibraryItemDialog from "@/components/LibraryItemDialog";
import { IssuesTab } from "./IssuesTab";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory, TakeoffCondition } from "@shared/schema";
import type { TakeoffMarkupWithAuthor } from "@/hooks/use-takeoff-data";
import { Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
  onApplyPresetScale: (scaleCategory: string, selectedPresetScale: string, resetFn: () => void) => void;
  sheets?: any[];
  onCompareRevisions?: () => void;
  onSelectSheet?: (id: string) => void;
  markups?: TakeoffMarkupWithAuthor[];
  deleteMarkupMutation?: any;
  issues?: any[];
  allSheetIssues?: any[];
  selectedIssueId?: string | null;
  onSelectIssue?: (issue: any) => void;
  onExportCurrentSheet?: () => void;
  onExportAllSheets?: () => void;
  onZoomToMeasurement?: (measurement: TakeoffMeasurement) => void;
  onZoomToFitMeasurement?: (measurement: TakeoffMeasurement) => void;
  conditions?: TakeoffCondition[];
  activeCondition?: TakeoffCondition | null;
  onActivateCondition?: (condition: TakeoffCondition) => void;
  onClearCondition?: () => void;
  onSaveCondition?: (data: { name: string; measurementType: string; color: string; categoryName?: string; unitCost?: number; costCodeId?: string; labelTemplate?: string; lineStyle?: string }) => void;
  onUpdateCondition?: (data: { id: string; [key: string]: any }) => void;
  onDeleteCondition?: (id: string) => void;
  saveConditionPending?: boolean;
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
    deleteMeasurementMutation, updateMeasurementMutation, aggregatedMeasurements,
    projectAddenda, addendaOverlays, setAddendaOverlays,
    verifyMode, setVerifyMode, verifyPoints, setVerifyPoints,
    verifyExpectedDistance, setVerifyExpectedDistance, verifyResult, setVerifyResult,
    multiCalibMode, setMultiCalibMode, multiCalibPoints, setMultiCalibPoints,
    setCalibrationMode, setCalibrationPoints,
    workspaceRef, aiPanelOpen, onApplyPresetScale,
    sheets = [], onCompareRevisions, onSelectSheet,
    markups = [], deleteMarkupMutation,
    issues = [], allSheetIssues = [], selectedIssueId = null, onSelectIssue,
    onExportCurrentSheet, onExportAllSheets,
    onZoomToMeasurement, onZoomToFitMeasurement,
    conditions = [], activeCondition = null, onActivateCondition, onClearCondition,
    onSaveCondition, onUpdateCondition, onDeleteCondition, saveConditionPending = false,
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
  const openIssueCount = allSheetIssues.filter((i: any) => i.status === "OPEN").length;
  const [conditionDialogOpen, setConditionDialogOpen] = useState(false);
  const [editingCondition, setEditingCondition] = useState<TakeoffCondition | null>(null);
  const [condForm, setCondForm] = useState({ name: "", measurementType: "LINEAR", color: "#3b82f6", categoryName: "", unitCost: "", costCodeId: "", labelTemplate: "", lineStyle: "solid" });

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

  return (
    <div className={cn("hidden sm:flex w-72 sm:w-80 bg-card border-l flex-col shrink-0", aiPanelOpen && "hidden md:flex")}>
      <div className="flex border-b shrink-0">
        <button
          className={cn("flex-1 py-2 text-xs font-medium transition-colors", sidebarTab === "tools" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setSidebarTab("tools")}
          data-testid="tab-tools"
        >
          Tools
        </button>
        <button
          className={cn("flex-1 py-2 text-xs font-medium transition-colors relative", sidebarTab === "conditions" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setSidebarTab("conditions")}
          data-testid="tab-conditions"
        >
          Conditions
          {activeCondition && (
            <span className="absolute -top-0.5 right-2 w-2 h-2 rounded-full" style={{ backgroundColor: activeCondition.color }} />
          )}
        </button>
        <button
          className={cn("flex-1 py-2 text-xs font-medium transition-colors relative", sidebarTab === "issues" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setSidebarTab("issues")}
          data-testid="tab-issues"
        >
          Issues
          {openIssueCount > 0 && (
            <span className="absolute -top-0.5 right-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full min-w-4 h-4 flex items-center justify-center px-1">
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
              <Button size="sm" onClick={() => { setEditingCondition(null); setCondForm({ name: "", measurementType: "LINEAR", color: "#3b82f6", categoryName: "", unitCost: "", costCodeId: "", labelTemplate: "", lineStyle: "solid" }); setConditionDialogOpen(true); }} data-testid="button-add-condition">
                <Plus className="w-4 h-4 mr-1" />New
              </Button>
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

            {conditions.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <Zap className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-xs text-muted-foreground">No conditions yet. Create one to speed up your takeoff workflow.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conditions.map((cond) => (
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
                    </div>
                    <div className="mt-2 flex justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setEditingCondition(cond); setCondForm({ name: cond.name, measurementType: cond.measurementType, color: cond.color, categoryName: cond.categoryName || "", unitCost: cond.unitCost ? String(cond.unitCost) : "", costCodeId: cond.costCodeId || "", labelTemplate: cond.labelTemplate || "", lineStyle: cond.lineStyle || "solid" }); setConditionDialogOpen(true); }} data-testid={`button-edit-condition-${cond.id}`}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteCondition?.(cond.id); }} data-testid={`button-delete-condition-${cond.id}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

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
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">Measurements</h3>
                <div className="flex items-center gap-1">
                  {(onExportCurrentSheet || onExportAllSheets) && (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid="button-export-excel-sidebar">
                              <Download className="w-4 h-4" />
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                  <Badge variant="secondary" data-testid="badge-measurement-count">{measurements.length}</Badge>
                </div>
              </div>
              {measurements.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No measurements yet</p>
              ) : (
                <div className="space-y-2">
                  {measurements.map((m) => (
                    <div key={m.id} className={`p-3 rounded-md bg-muted hover-elevate cursor-pointer ${selectedMeasurementId === m.id ? 'ring-2 ring-primary' : ''}`} onClick={() => { if (clickTimerRef.current) clearTimeout(clickTimerRef.current); clickTimerRef.current = setTimeout(() => { setSelectedMeasurementId(m.id); setSelectedSegmentIndex(null); onZoomToMeasurement?.(m); clickTimerRef.current = null; }, 200); }} onDoubleClick={() => { if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; } setSelectedMeasurementId(m.id); setSelectedSegmentIndex(null); onZoomToFitMeasurement?.(m); }} data-testid={`measurement-item-${m.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{m.label || "Untitled"}</span>
                          <Badge variant="outline" className="text-xs">{m.type}</Badge>
                          {m.source === "BIM" && (
                            <Badge variant="secondary" className="text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300" data-testid={`badge-bim-source-${m.id}`}>BIM</Badge>
                          )}
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteMeasurementMutation.mutate(m); }} data-testid={`button-delete-measurement-${m.id}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {(m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && m.computedLengthFt
                          ? `${(Number.isFinite(m.computedLengthFt) ? m.computedLengthFt : 0).toFixed(2)} LF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                          : (m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && (m.computedAreaFt2 || (m as any).computedSurfaceAreaFt2)
                          ? `${((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2 || 0).toFixed(2)} SF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                          : m.type === "VOLUME" && m.computedVolumeCy ? `${(Number.isFinite(m.computedVolumeCy) ? m.computedVolumeCy : 0).toFixed(2)} CY`
                          : m.type === "SEGMENT" && m.computedLengthFt ? `${(Number.isFinite(m.computedLengthFt) ? m.computedLengthFt : 0).toFixed(2)} LF total`
                          : m.type === "COUNT" ? "Count marker" : m.type === "NOTE" ? "Note" : ""}
                      </p>
                      {m.type === "SEGMENT" && (() => {
                        const points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                        let segProps: any[] = [];
                        try { const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata; segProps = meta?.segmentProperties || []; } catch {}
                        if (points.length < 2 || !currentSheet?.scalePxPerFoot) return null;
                        return (
                          <Collapsible>
                            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1" data-testid={`button-expand-segments-${m.id}`}>
                              <ChevronRight className="w-3 h-3 transition-transform [[data-state=open]>&]:rotate-90" />
                              <span>{points.length - 1} segments</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-1 space-y-1 ml-2 border-l-2 border-muted pl-2">
                                {points.slice(0, -1).map((_: any, i: number) => {
                                  const segLabel = segProps[i]?.label || `Seg ${i + 1}`;
                                  const segColor = segProps[i]?.color || "#2563eb";
                                  const p1 = points[i];
                                  const p2 = points[i + 1];
                                  const dx = p2.x - p1.x;
                                  const dy = p2.y - p1.y;
                                  const pxDist = Math.sqrt(dx * dx + dy * dy);
                                  const segLenFt = pxDist / currentSheet.scalePxPerFoot;
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
                      {(m as any).costCodeId && <p className="text-xs text-blue-500 mt-1">Cost Code: {(m as any).costCodeId}</p>}
                      {(m as any).unitCost && <p className="text-xs text-green-500">Unit Cost: ${Number((m as any).unitCost).toFixed(2)}</p>}
                    </div>
                  ))}
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
                    {selM.computedAreaFt2 && <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span>{Number(selM.computedAreaFt2).toFixed(2)} SF</span></div>}
                    {(selM as any).computedSurfaceAreaFt2 && <div className="flex justify-between"><span className="text-muted-foreground">Surface Area:</span><span>{Number((selM as any).computedSurfaceAreaFt2).toFixed(2)} SF</span></div>}
                    {selM.computedVolumeCy && <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{Number(selM.computedVolumeCy).toFixed(2)} CY</span></div>}
                    {(selM as any).pitchRatio && <div className="flex justify-between"><span className="text-muted-foreground">Pitch:</span><span>{(selM as any).pitchRatio}</span></div>}
                  </div>
                  {selM.type === "SEGMENT" && selectedSegmentIndex !== null && (() => {
                    const pts = typeof selM.points === 'string' ? JSON.parse(selM.points) : selM.points;
                    let segProps: any[] = [];
                    try { const meta = typeof selM.metadata === 'string' ? JSON.parse(selM.metadata) : selM.metadata; segProps = meta?.segmentProperties || []; } catch {}
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
                  <CostCodeField measurementId={selM.id} currentValue={(selM as any).costCodeId || ""} onCommit={(val) => { updateMeasurementMutation.mutate({ id: selM.id, costCodeId: val || undefined }); }} />
                  <div className="space-y-2">
                    <Label className="text-xs">Unit Cost ($)</Label>
                    <Input type="number" placeholder="0.00" defaultValue={(selM as any).unitCost || ""} onBlur={(e) => { const val = parseFloat(e.target.value) || undefined; if (val !== (selM as any).unitCost) { updateMeasurementMutation.mutate({ id: selM.id, unitCost: val }); } }} className="h-8 text-sm" data-testid="input-unit-cost" />
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
                  const linearTotal = categoryMeasurements.filter((m: any) => m.type === "LINEAR").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  const areaTotal = categoryMeasurements.filter((m: any) => m.type === "AREA").reduce((sum: number, m: any) => { const val = Number(m.computedAreaFt2); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  const volumeTotal = categoryMeasurements.filter((m: any) => m.type === "VOLUME").reduce((sum: number, m: any) => { const val = Number(m.computedVolumeCy); return sum + (Number.isFinite(val) ? val : 0); }, 0);
                  const countTotal = categoryMeasurements.filter((m: any) => m.type === "COUNT").length;
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

                {aggregatedMeasurements.uncategorized.length > 0 && (
                  <div className="border-l-4 border-muted pl-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-sm text-muted-foreground">Uncategorized</span>
                      <Badge variant="outline" className="text-xs">{aggregatedMeasurements.uncategorized.length}</Badge>
                    </div>
                    <div className="space-y-1 text-xs ml-5">
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Linear:</span><span>{(() => { const total = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0); return (Number.isFinite(total) ? total : 0).toFixed(2); })()} LF</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "AREA").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span>{(() => { const total = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "AREA").reduce((sum: number, m: any) => { const val = Number(m.computedAreaFt2); return sum + (Number.isFinite(val) ? val : 0); }, 0); return (Number.isFinite(total) ? total : 0).toFixed(2); })()} SF</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "VOLUME").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span>{(() => { const total = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "VOLUME").reduce((sum: number, m: any) => { const val = Number(m.computedVolumeCy); return sum + (Number.isFinite(val) ? val : 0); }, 0); return (Number.isFinite(total) ? total : 0).toFixed(2); })()} CY</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "COUNT").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Count:</span><span>{aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "COUNT").length}</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "SEGMENT").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Segment:</span><span>{(() => { const total = aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "SEGMENT").reduce((sum: number, m: any) => { const val = Number(m.computedLengthFt); return sum + (Number.isFinite(val) ? val : 0); }, 0); return (Number.isFinite(total) ? total : 0).toFixed(2); })()} LF</span></div>
                      )}
                      {aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length > 0 && (
                        <div className="flex justify-between"><span className="text-muted-foreground">Pitched/Surface:</span><span>{aggregatedMeasurements.uncategorized.filter((m: any) => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length} items</span></div>
                      )}
                    </div>
                  </div>
                )}

                {measurements.length > 0 && (
                  <div className="pt-3 border-t space-y-2">
                    <h4 className="font-semibold text-sm">Total Quantities</h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Linear:</span><span className="font-medium">{(Number.isFinite(aggregatedMeasurements.grandTotals.linearTotal) ? aggregatedMeasurements.grandTotals.linearTotal : 0).toFixed(2)} LF</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Area:</span><span className="font-medium">{(Number.isFinite(aggregatedMeasurements.grandTotals.areaTotal) ? aggregatedMeasurements.grandTotals.areaTotal : 0).toFixed(2)} SF</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Volume:</span><span className="font-medium">{(Number.isFinite(aggregatedMeasurements.grandTotals.volumeTotal) ? aggregatedMeasurements.grandTotals.volumeTotal : 0).toFixed(2)} CY</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Count:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.countTotal}</span></div>
                      {aggregatedMeasurements.grandTotals.linearWithDropTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Linear+Drop:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.linearWithDropTotal.toFixed(2)} LF</span></div>}
                      {aggregatedMeasurements.grandTotals.pitchedLinearTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Pitched Linear:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.pitchedLinearTotal.toFixed(2)} LF</span></div>}
                      {aggregatedMeasurements.grandTotals.pitchedAreaTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Pitched Area:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.pitchedAreaTotal.toFixed(2)} SF</span></div>}
                      {aggregatedMeasurements.grandTotals.surfaceAreaTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Surface Area:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.surfaceAreaTotal.toFixed(2)} SF</span></div>}
                      {aggregatedMeasurements.grandTotals.segmentTotal > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Segment:</span><span className="font-medium">{aggregatedMeasurements.grandTotals.segmentTotal.toFixed(2)} LF</span></div>}
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
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Addenda Overlays</h3>
                </div>
                <p className="text-xs text-muted-foreground">Toggle addendum documents as overlays on the plan sheet.</p>
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
                            <div className="flex items-center gap-2 pl-8">
                              <span className="text-[10px] text-muted-foreground w-10">Opacity</span>
                              <input type="range" min={0} max={100} value={Math.round(opacity * 100)} onChange={(e) => {
                                const newOpacity = parseInt(e.target.value) / 100;
                                setAddendaOverlays((prev: any) => ({ ...prev, [addendum.id]: { ...prev[addendum.id], opacity: newOpacity } }));
                              }} className="flex-1 h-1 accent-primary" data-testid={`slider-opacity-addendum-${addendum.id}`} />
                              <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(opacity * 100)}%</span>
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
                        <p className="text-[10px] text-muted-foreground italic">
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
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Calibration Info</h3>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Scale:</span><span className="font-mono">{currentSheet.scalePxPerFoot.toFixed(2)} px/{currentSheet.units || "ft"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Units:</span><span>{currentSheet.units === "m" ? "Meters" : "Feet"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status:</span><Badge variant="default" className="text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" /> Calibrated</Badge></div>
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
                      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
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
                              onClick={() => deleteMarkupMutation.mutate(markup.id)}
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
        <DialogContent className="max-w-md">
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
                  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
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
    </div>
  );
}
