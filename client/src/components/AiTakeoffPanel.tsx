import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Plus, 
  ChevronDown, 
  ChevronRight,
  Ruler,
  Square,
  Box,
  MapPin,
  FileText,
  Zap,
  AlertTriangle,
  X,
  Filter,
  ArrowUpDown,
  BarChart3,
  Clock,
  Layers,
  SlidersHorizontal,
  ScanSearch,
  RefreshCw,
  Pencil,
  ThumbsDown,
  Ban,
  Maximize2,
  Scissors
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useJobProgress } from "@/hooks/use-job-progress";
import { cn } from "@/lib/utils";
import { AiTakeoffScaleStatusBanner } from "./AiTakeoffScaleStatusBanner";
import { DraftFullTakeoffButton } from "@/components/takeoff/DraftFullTakeoffButton";
import { TradeTemplatesPanel } from "@/components/takeoff/TradeTemplatesPanel";
import { AiEstimatorIntroCallout } from "@/components/AiEstimatorIntroCallout";

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedItem {
  id: string;
  itemType: string;
  description: string;
  quantity: number;
  unit: string;
  confidence: number;
  boundingBox?: BoundingBox;
  suggestedSowItem?: {
    name: string;
    code: string;
  };
}

function RegionThumbnail({ bbox, label }: { bbox: BoundingBox; label: string }) {
  return (
    <div
      className="relative w-12 h-10 bg-muted/50 border border-border/50 rounded overflow-hidden flex-shrink-0"
      title={`Region: ${bbox.x.toFixed(0)}%, ${bbox.y.toFixed(0)}% (${bbox.w.toFixed(0)}×${bbox.h.toFixed(0)}%)`}
      data-testid={`thumbnail-region-${label}`}
    >
      <div
        className="absolute bg-purple-500/30 border border-purple-500/60 rounded-[1px]"
        style={{
          left: `${bbox.x}%`,
          top: `${bbox.y}%`,
          width: `${Math.max(bbox.w, 8)}%`,
          height: `${Math.max(bbox.h, 8)}%`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <MapPin className="w-2.5 h-2.5 text-purple-500/50" />
      </div>
    </div>
  );
}

// Task #2323 — when the workspace finishes its per-item POST loop it
// returns one new shape so the panel can stitch suggestion ids to
// freshly-created measurement ids and POST a single bulk-accept.
export interface ItemImportResult {
  succeeded: number;
  failed: number;
  failedItems: string[];
  // aiItem.id (e.g. "item-3") -> created takeoff_measurement.id
  measurementIdsByItemId?: Record<string, string>;
}

interface AiTakeoffPanelProps {
  projectId?: string;
  bidId?: string;
  // Task #2551 — Standalone takeoff context.
  standaloneTakeoffId?: string;
  sheetId?: string | null;
  onItemsImported?: (items: DetectedItem[]) => Promise<ItemImportResult>;
  onClose?: () => void;
  onHighlightItem?: (item: DetectedItem | null) => void;
  onDetectedItemsChanged?: (items: DetectedItem[]) => void;
  showOverlays?: boolean;
  onToggleOverlays?: (show: boolean) => void;
}

// Reject-reason codes — must stay in sync with `aiTakeoffRejectReasonEnum`
// in `shared/schema/enums.ts`.
const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: "NOT_PRESENT", label: "Not present in drawing" },
  { value: "WRONG_TRADE", label: "Wrong trade" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "WRONG_QUANTITY", label: "Wrong quantity" },
  { value: "WRONG_LOCATION", label: "Wrong location" },
  { value: "OTHER", label: "Other" },
];

interface SuggestionLite {
  id: string;
  itemKey: string;
  // Raw model confidence stored on the suggestion row (0..1). Used to
  // bucket the suggestion against the org calibration map for the
  // suppression check (Task #2342).
  confidence?: number | string | null;
}

// Task #2342 — org-level calibration response shape returned alongside
// the suggestion id map. `suppressionFloor` is null when the org admin
// has not opted in; in that case suppression is bypassed and every
// suggestion is shown.
interface CalibrationBucket {
  bucket: number;
  empiricalAcceptanceRate: number;
  sampleCount: number;
}
interface SuggestionsByAnalysisResponse {
  suggestions: Array<SuggestionLite & Record<string, unknown>>;
  calibration?: CalibrationBucket[];
  suppressionFloor?: number | null;
  suppressionMinSamples?: number;
}

// Mirrors `confidenceBucket()` on the server (60/70/80/90 buckets).
// Input is a 0..100 confidence (matches the suggestion row + the
// detected item shape). Suggestions below 70 land in the 60 bucket so
// they share fate with the lowest reviewed slice.
function confidenceBucket(confidence: number): number {
  if (confidence >= 90) return 90;
  if (confidence >= 80) return 80;
  if (confidence >= 70) return 70;
  return 60;
}

const ITEM_TYPE_ICONS: Record<string, any> = {
  roof_plane: Square,
  ridge: Ruler,
  drip_edge: Ruler,
  penetration: MapPin,
  outlet: MapPin,
  switch: MapPin,
  panel: Box,
  wire_run: Ruler,
  slab: Square,
  footing: Box,
  rebar: Ruler,
  formwork: Square,
  framing: Ruler,
  default: FileText,
};

const TRADE_TYPE_OPTIONS = [
  { value: "AUTO_DETECT", label: "Auto-detect from drawing" },
  { value: "GENERAL_CONTRACTOR", label: "General Contractor" },
  { value: "ELECTRICAL", label: "Electrical" },
  { value: "PLUMBING", label: "Plumbing" },
  { value: "HVAC", label: "HVAC" },
  { value: "ROOFING", label: "Roofing" },
  { value: "CONCRETE", label: "Concrete" },
  { value: "CARPENTRY", label: "Carpentry" },
  { value: "MASONRY", label: "Masonry" },
  { value: "DRYWALL", label: "Drywall" },
  { value: "PAINTING", label: "Painting" },
  { value: "FLOORING", label: "Flooring" },
  { value: "LANDSCAPING", label: "Landscaping" },
  { value: "DEMOLITION", label: "Demolition" },
  { value: "STEEL_ERECTION", label: "Steel Erection" },
  { value: "GLAZING", label: "Glazing" },
  { value: "INSULATION", label: "Insulation" },
  { value: "FIRE_PROTECTION", label: "Fire Protection" },
  { value: "LOW_VOLTAGE", label: "Low Voltage" },
  { value: "SOLAR", label: "Solar" },
  { value: "WATERPROOFING", label: "Waterproofing" },
  { value: "EARTHWORK", label: "Earthwork" },
  { value: "ASPHALT_PAVING", label: "Asphalt Paving" },
  { value: "OTHER", label: "Other" },
];

export default function AiTakeoffPanel({ projectId, bidId, standaloneTakeoffId, sheetId, onItemsImported, onClose, onHighlightItem, onDetectedItemsChanged, showOverlays, onToggleOverlays }: AiTakeoffPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [analysisMode, setAnalysisMode] = useState<"QUICK" | "DETAILED">("QUICK");
  const [selectedTradeType, setSelectedTradeType] = useState("AUTO_DETECT");
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // Task #2323 — closed-loop feedback state. `localEdits` and
  // `localRejections` are keyed by detected-item id (e.g. "item-3").
  // Edits stay client-side until the user actually imports; rejects
  // POST immediately so a "wrong" item is reported even if the user
  // never imports anything else from the run.
  const [localEdits, setLocalEdits] = useState<Record<string, { quantity?: number; unit?: string; itemType?: string }>>({});
  const [rejectedItemIds, setRejectedItemIds] = useState<Set<string>>(new Set());
  const [editDialogItem, setEditDialogItem] = useState<DetectedItem | null>(null);
  const [editForm, setEditForm] = useState<{ quantity: string; unit: string; itemType: string }>({
    quantity: "",
    unit: "",
    itemType: "",
  });

  const { toast } = useToast();

  interface AnalysisResult {
    analysisId: string;
    status: string;
    tradeType?: string;
    detectedItems: DetectedItem[];
    metadata?: Record<string, any>;
    aiNotes?: string;
    processingTimeMs?: number;
  }

  const { data: analysisResults, isLoading: resultsLoading, refetch: refetchResults } = useQuery<AnalysisResult | null>({
    queryKey: ["/api/ai-features/takeoff/results", analysisId],
    enabled: !!analysisId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "PENDING" || data?.status === "PROCESSING") {
        return 2000;
      }
      return false;
    },
  });

  // Task #2551 — Standalone takeoff is its own history context.
  const historyContextId = standaloneTakeoffId || projectId || bidId;
  const historyContextType = standaloneTakeoffId
    ? "standalone"
    : bidId && !projectId
      ? "bid"
      : "project";
  interface AnalysisHistoryEntry {
    id: string;
    status: string;
    analysisMode: string;
    tradeType: string;
    createdAt: string;
    processingTimeMs: number | null;
    detectedItemsJson: string | null;
  }
  const { data: analysisHistory } = useQuery<{ analyses: AnalysisHistoryEntry[] }>({
    queryKey: [`/api/ai-features/takeoff/history/${historyContextId}?type=${historyContextType}`],
    enabled: !!historyContextId,
  });

  const { data: compareResults } = useQuery<AnalysisResult | null>({
    queryKey: ["/api/ai-features/takeoff/results", compareRunId],
    enabled: !!compareRunId,
  });

  // Task #2323 — suggestion id lookup for the active analysis. Refetched
  // whenever the analysis is COMPLETE so accept/reject actions can call
  // the per-suggestion endpoints without round-tripping per row.
  // Task #2342 — same response now also carries the org's calibration
  // map and suppression floor so we can hide low-acceptance suggestions
  // without a second round-trip.
  const { data: suggestionsData } = useQuery<SuggestionsByAnalysisResponse>({
    queryKey: ["/api/ai-features/takeoff/suggestions/by-analysis", analysisId],
    enabled: !!analysisId && analysisResults?.status === "COMPLETE",
  });
  const suggestionIdByItemKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of suggestionsData?.suggestions ?? []) {
      map.set(s.itemKey, s.id);
    }
    return map;
  }, [suggestionsData]);
  const suggestionConfidenceByItemKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of suggestionsData?.suggestions ?? []) {
      const raw = s.confidence;
      if (raw == null || raw === "") continue;
      const num = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(num)) map.set(s.itemKey, num);
    }
    return map;
  }, [suggestionsData]);

  // Task #2342 — bucket -> calibration row, used for the suppression
  // check and the disclosure tooltip (so users can see why a row was
  // hidden).
  const calibrationByBucket = useMemo(() => {
    const map = new Map<number, CalibrationBucket>();
    for (const c of suggestionsData?.calibration ?? []) {
      map.set(c.bucket, c);
    }
    return map;
  }, [suggestionsData]);
  const suppressionFloor = suggestionsData?.suppressionFloor ?? null;
  const suppressionMinSamples = suggestionsData?.suppressionMinSamples ?? 30;
  // User can opt back in for a single session via the disclosure
  // toggle below — purely a UI preference, never persisted.
  const [showSuppressed, setShowSuppressed] = useState(false);

  const rejectMutation = useMutation({
    mutationFn: async (input: { suggestionId: string; reason: string; note?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/ai-features/takeoff/suggestions/${input.suggestionId}/reject`,
        { reason: input.reason, note: input.note },
      );
      return res.json();
    },
  });

  const handleRejectItem = (item: DetectedItem, reason: string) => {
    const sid = suggestionIdByItemKey.get(item.id);
    if (!sid) {
      // No suggestion row (older analysis prior to backfill) — fall
      // back to local-only rejection so the user still gets feedback.
      setRejectedItemIds((prev) => { const n = new Set(prev); n.add(item.id); return n; });
      setSelectedItems((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
      toast({ title: "Marked as rejected (local only)", description: "Older analysis — no server-side feedback row." });
      return;
    }
    rejectMutation.mutate(
      { suggestionId: sid, reason },
      {
        onSuccess: () => {
          setRejectedItemIds((prev) => { const n = new Set(prev); n.add(item.id); return n; });
          setSelectedItems((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
          toast({ title: "Suggestion rejected", description: REJECT_REASONS.find(r => r.value === reason)?.label });
        },
        onError: (err: Error) => {
          toast({ title: "Reject failed", description: err.message, variant: "destructive" });
        },
      },
    );
  };

  const handleOpenEdit = (item: DetectedItem) => {
    const existingEdit = localEdits[item.id] ?? {};
    setEditDialogItem(item);
    setEditForm({
      quantity: String(existingEdit.quantity ?? item.quantity),
      unit: existingEdit.unit ?? item.unit,
      itemType: existingEdit.itemType ?? item.itemType,
    });
  };

  const handleSaveEdit = () => {
    if (!editDialogItem) return;
    const qtyNum = Number(editForm.quantity);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      toast({ title: "Invalid quantity", description: "Quantity must be a positive number", variant: "destructive" });
      return;
    }
    setLocalEdits((prev) => ({
      ...prev,
      [editDialogItem.id]: {
        quantity: qtyNum !== editDialogItem.quantity ? qtyNum : undefined,
        unit: editForm.unit && editForm.unit !== editDialogItem.unit ? editForm.unit : undefined,
        itemType: editForm.itemType && editForm.itemType !== editDialogItem.itemType ? editForm.itemType : undefined,
      },
    }));
    // Auto-select the row so the user knows it'll be imported on next click.
    setSelectedItems((prev) => { const n = new Set(prev); n.add(editDialogItem.id); return n; });
    setEditDialogItem(null);
  };

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        ...(projectId ? { projectId } : {}),
        ...(bidId ? { bidId } : {}),
        ...(standaloneTakeoffId ? { standaloneTakeoffId } : {}),
        takeoffSheetId: sheetId,
        analysisMode,
      };
      if (selectedTradeType !== "AUTO_DETECT") {
        body.tradeType = selectedTradeType;
      }
      const response = await apiRequest("POST", "/api/ai-features/takeoff/analyze", body);
      return response.json();
    },
    onSuccess: (data: { analysisId: string; estimatedTime: number; jobId?: string }) => {
      setAnalysisId(data.analysisId);
      setAnalysisJobId(data.jobId ?? null);
      setIsAnalyzing(true);
      toast({
        title: "AI Analysis Started",
        description: `${analysisMode === "DETAILED" ? "Detailed (multi-pass)" : "Quick"} analysis... Estimated time: ${data.estimatedTime}s`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to start AI analysis",
        variant: "destructive",
      });
      setIsAnalyzing(false);
    },
  });

  const handleStartAnalysis = () => {
    analyzeMutation.mutate();
  };

  const handleToggleItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((i: DetectedItem) => i.id)));
    }
  };

  const handleToggleGroup = (groupName: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Task #2323 — apply pending local edits to a detected item before
  // sending it through the import flow. Returns a fresh object so the
  // workspace's `metadata.aiItemId` still points to the original AI key.
  const applyEdit = (item: DetectedItem): DetectedItem => {
    const e = localEdits[item.id];
    if (!e) return item;
    return {
      ...item,
      quantity: e.quantity ?? item.quantity,
      unit: e.unit ?? item.unit,
      itemType: e.itemType ?? item.itemType,
    };
  };

  const handleImportSelected = async () => {
    if (!analysisResults?.detectedItems) return;
    const itemsToImport = analysisResults.detectedItems
      .filter((i: DetectedItem) => selectedItems.has(i.id) && !rejectedItemIds.has(i.id))
      .map(applyEdit);
    if (itemsToImport.length === 0) return;

    if (onItemsImported) {
      setIsImporting(true);
      try {
        const result = await onItemsImported(itemsToImport);
        setImportDialogOpen(false);
        setSelectedItems(new Set());

        // Task #2323 — close the loop. Build per-suggestion acceptances
        // and POST one bulk-accept per import batch. Edited rows are
        // bucketed as EDITED on the backend automatically when any field
        // differs from the suggestion.
        if (analysisId && suggestionIdByItemKey.size > 0) {
          const acceptances = itemsToImport
            .map((item) => {
              const suggestionId = suggestionIdByItemKey.get(item.id);
              if (!suggestionId) return null;
              const measurementId = result.measurementIdsByItemId?.[item.id];
              const edit = localEdits[item.id];
              return {
                suggestionId,
                measurementId,
                editedQuantity: edit?.quantity,
                editedUnit: edit?.unit,
                editedItemType: edit?.itemType,
              };
            })
            .filter((a): a is NonNullable<typeof a> => a !== null);
          if (acceptances.length > 0) {
            try {
              await apiRequest("POST", "/api/ai-features/takeoff/suggestions/bulk-accept", {
                analysisId,
                acceptances,
                rejections: [],
              });
              setLocalEdits({});
            } catch (bulkErr) {
              console.warn("bulk-accept failed (non-fatal):", bulkErr);
            }
          }
        }

        if (result.failed === 0) {
          toast({
            title: "Items Imported",
            description: `Successfully imported ${result.succeeded} items to takeoff`,
          });
        } else {
          const failedDesc = result.failedItems.length > 0
            ? `Failed: ${result.failedItems.join(", ")}`
            : `${result.failed} failed`;
          toast({
            title: "Partial Import",
            description: `Imported ${result.succeeded} items. ${failedDesc}`,
            variant: "destructive",
          });
        }
      } catch {
        toast({
          title: "Import Failed",
          description: "Failed to import items to takeoff",
          variant: "destructive",
        });
      } finally {
        setIsImporting(false);
      }
    } else {
      setImportDialogOpen(false);
      setSelectedItems(new Set());
    }
  };

  const groupItemsByType = (items: DetectedItem[]) => {
    const groups: Record<string, DetectedItem[]> = {};
    items.forEach(item => {
      const type = item.itemType || "other";
      if (!groups[type]) groups[type] = [];
      groups[type].push(item);
    });
    return groups;
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return "text-green-500";
    if (confidence >= 70) return "text-yellow-500";
    return "text-orange-500";
  };

  const getConfidenceBadge = (confidence: number): "default" | "secondary" | "outline" => {
    if (confidence >= 85) return "default";
    if (confidence >= 70) return "secondary";
    return "outline";
  };

  const isComplete = analysisResults?.status === "COMPLETE";
  const isPending = analysisResults?.status === "PENDING" || analysisResults?.status === "PROCESSING";
  const detectedItems = analysisResults?.detectedItems || [];

  const baseFilteredItems = useMemo(() => {
    return detectedItems
      .filter((item: DetectedItem) => item.confidence >= confidenceThreshold)
      .sort((a: DetectedItem, b: DetectedItem) => b.confidence - a.confidence);
  }, [detectedItems, confidenceThreshold]);

  // Task #2342 — bucket each detected item against the calibration map
  // and set it aside if the bucket has enough samples and an empirical
  // acceptance rate below the org floor. The suggestion row stays in
  // the database (the calibration job depends on it); we only hide it
  // visually until the user clicks "Show N suppressed".
  const { visibleItems, suppressedItems } = useMemo(() => {
    if (suppressionFloor == null || suppressionFloor <= 0) {
      return { visibleItems: baseFilteredItems, suppressedItems: [] as DetectedItem[] };
    }
    const visible: DetectedItem[] = [];
    const suppressed: DetectedItem[] = [];
    for (const item of baseFilteredItems) {
      // Prefer the suggestion row's stored raw confidence so the
      // bucketing matches what the calibration job actually keyed on
      // (the displayed item.confidence may have been overridden by an
      // earlier calibration pass). Both inputs are 0..100.
      const stored = suggestionConfidenceByItemKey.get(item.id);
      const raw = stored != null ? stored : item.confidence;
      const bucket = confidenceBucket(raw);
      const cal = calibrationByBucket.get(bucket);
      if (
        cal &&
        cal.sampleCount >= suppressionMinSamples &&
        cal.empiricalAcceptanceRate < suppressionFloor
      ) {
        suppressed.push(item);
      } else {
        visible.push(item);
      }
    }
    return { visibleItems: visible, suppressedItems: suppressed };
  }, [
    baseFilteredItems,
    suppressionFloor,
    suppressionMinSamples,
    calibrationByBucket,
    suggestionConfidenceByItemKey,
  ]);

  const filteredItems =
    showSuppressed && suppressedItems.length > 0
      ? [...visibleItems, ...suppressedItems].sort(
          (a, b) => b.confidence - a.confidence,
        )
      : visibleItems;

  const groupedItems = groupItemsByType(filteredItems);

  const avgConfidence = detectedItems.length > 0
    ? Math.round(detectedItems.reduce((sum: number, i: DetectedItem) => sum + i.confidence, 0) / detectedItems.length)
    : 0;

  const pastRuns = analysisHistory?.analyses?.filter((a) => a.status === "COMPLETE" && a.id !== analysisId) || [];

  useEffect(() => {
    if (isComplete || analysisResults?.status === "FAILED") {
      setIsAnalyzing(false);
    }
  }, [isComplete, analysisResults?.status]);

  useEffect(() => {
    onDetectedItemsChanged?.(detectedItems);
  }, [detectedItems]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">AI Auto-Takeoff</h3>
          </div>
          <div className="flex items-center gap-2">
            {isComplete && detectedItems.length > 0 && (
              <Badge variant="secondary" data-testid="badge-items-detected">
                {filteredItems.length}/{detectedItems.length} items
              </Badge>
            )}
            {onClose && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-ai-panel">
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Automatically detect measurements from your blueprints using AI
        </p>
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-4">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Beta Feature:</span> AI-detected quantities are estimates and should be verified manually before use in final estimates or bids.
          </div>
        </div>
        <AiEstimatorIntroCallout surface="ai-takeoff" className="mb-4" />
        
        {!isAnalyzing && !isComplete && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Trade Type</label>
              <Select value={selectedTradeType} onValueChange={setSelectedTradeType}>
                <SelectTrigger className="h-9" data-testid="select-trade-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADE_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.value === "AUTO_DETECT" && <ScanSearch className="w-3.5 h-3.5 inline mr-1.5" />}
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Analysis Mode</label>
              <Select value={analysisMode} onValueChange={(v: "QUICK" | "DETAILED") => setAnalysisMode(v)}>
                <SelectTrigger className="h-9" data-testid="select-analysis-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="QUICK">Quick Analysis (~30s)</SelectItem>
                  <SelectItem value="DETAILED">Detailed Multi-Pass (~2min)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={handleStartAnalysis} 
              className="w-full"
              disabled={analyzeMutation.isPending}
              data-testid="button-ai-analyze"
            >
              {analyzeMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Analyze Blueprint
                </>
              )}
            </Button>
            <DraftFullTakeoffButton bidId={bidId} projectId={projectId} standaloneTakeoffId={standaloneTakeoffId} />
            {bidId && <TradeTemplatesPanel bidId={bidId} />}
          </div>
        )}

        {isPending && (
          <AiTakeoffPendingProgress
            jobId={analysisJobId}
            tradeLabel={analysisResults?.tradeType || "trade"}
            analysisMode={analysisMode}
          />
        )}
      </div>

      {isComplete && detectedItems.length > 0 && (
        <>
          {analysisResults?.metadata && (
            <div className="px-4 pt-3 pb-2 border-b bg-muted/20 space-y-2">
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
                {analysisResults.metadata.drawingType && (
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    {analysisResults.metadata.drawingType}
                  </span>
                )}
                {analysisResults.metadata.drawingScale && (
                  <span className="flex items-center gap-1">
                    <Ruler className="w-3 h-3" />
                    {analysisResults.metadata.drawingScale}
                  </span>
                )}
                {analysisResults.metadata.pageSize && (
                  <span className="flex items-center gap-1" data-testid="text-page-size">
                    <FileText className="w-3 h-3" />
                    {analysisResults.metadata.pageSize}
                  </span>
                )}
                {/* Task #2336 — Show estimators which raster scale the AI
                    actually used so they can tell whether fine symbols are
                    missing because of the rasterizer or the prompt. The
                    "capped at 30 MP" suffix appears when the 30 megapixel
                    cap engaged. */}
                {typeof analysisResults.metadata.rasterScale === "number" && (
                  <span className="flex items-center gap-1" data-testid="text-raster-scale">
                    <Maximize2 className="w-3 h-3" />
                    Rendered at {analysisResults.metadata.rasterScale.toFixed(2)}×
                    {analysisResults.metadata.rasterCapped && (
                      <>
                        , capped at{" "}
                        {Math.round(
                          (Number(analysisResults.metadata.rasterMaxPixels) || 30 * 1024 * 1024) /
                            (1024 * 1024),
                        )}{" "}
                        MP
                      </>
                    )}
                  </span>
                )}
                {analysisResults.processingTimeMs && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {(analysisResults.processingTimeMs / 1000).toFixed(1)}s
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  Avg {avgConfidence}%
                </span>
              </div>
              {analysisResults.tradeType && (
                <div className="flex items-center gap-1.5">
                  {analysisResults.metadata.tradeAutoDetected ? (
                    <>
                      <ScanSearch className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                      <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium" data-testid="text-auto-detected-trade">
                        Auto-detected: {analysisResults.tradeType.replace(/_/g, " ")}
                      </span>
                      {analysisResults.metadata.tradeDetectionConfidence && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-blue-600 border-blue-300">
                          {analysisResults.metadata.tradeDetectionConfidence}%
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      <Layers className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-[11px] text-muted-foreground font-medium" data-testid="text-selected-trade">
                        Trade: {analysisResults.tradeType.replace(/_/g, " ")}
                      </span>
                    </>
                  )}
                </div>
              )}
              {analysisResults.metadata.analysisSource === "openai_vision" && (
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  <span className="text-[11px] text-green-700 dark:text-green-400 font-medium">
                    AI Vision {analysisResults.metadata.analysisMethod?.includes("Multi-Pass") ? "(Multi-Pass)" : ""}
                  </span>
                </div>
              )}
              {analysisResults.metadata.analysisSource && analysisResults.metadata.analysisSource !== "openai_vision" && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 w-full" data-testid="banner-ai-fallback-takeoff">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span className="text-xs text-amber-700 dark:text-amber-400 flex-1">
                    AI analysis unavailable — showing sample data.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    onClick={() => refetchResults()}
                    data-testid="button-retry-takeoff-analysis"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Retry
                  </Button>
                </div>
              )}
              {/* Task #2336 — When the 30 MP raster cap engaged, the AI saw
                  the sheet at less than the desired tier (2.0/3.0/4.0×) so
                  fine symbols may be missing. Invite the user to split the
                  sheet into tiles to recover detail. */}
              {analysisResults.metadata.rasterCapped && (
                <div
                  className="flex items-start gap-1.5 px-3 py-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 w-full"
                  data-testid="banner-raster-capped"
                >
                  <Scissors className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-blue-700 dark:text-blue-400 flex-1">
                    Rendered at the maximum supported resolution. Splitting this sheet into tiles would let the AI see more detail.
                  </span>
                </div>
              )}
              {/* Task #2322 — Surface scale-mismatch warnings emitted by the
                  server when the model's inferred scale disagrees with the
                  user's calibrated scale by >5%. Quantities are not changed —
                  the user re-verifies before accepting.
                  Task #2335 — alongside that warning we link out to the AI
                  takeoff dashboard so a lead running 30 sheets can see the
                  org-wide rollup rather than eyeballing one banner at a time.
                  Task #2355 — when the title block disclaims a paper-space
                  scale ("NTS" / "AS SHOWN") the warning is suppressed and a
                  neutral note takes its place; the two slots are mutually
                  exclusive (handled by AiTakeoffScaleStatusBanner). */}
              <AiTakeoffScaleStatusBanner
                scaleMismatchWarning={analysisResults.metadata.scaleMismatchWarning}
                scaleNotToScale={analysisResults.metadata.scaleNotToScale}
              />
            </div>
          )}

          <div className="px-4 py-3 border-b space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">Confidence: {confidenceThreshold}%+</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{filteredItems.length} of {detectedItems.length}</span>
            </div>
            <Slider
              value={[confidenceThreshold]}
              onValueChange={([v]) => setConfidenceThreshold(v)}
              min={0}
              max={95}
              step={5}
              className="w-full"
              data-testid="slider-confidence-threshold"
            />
            {onToggleOverlays && (
              <div className="flex items-center justify-between pt-1">
                <label htmlFor="ai-overlays" className="text-xs text-muted-foreground cursor-pointer">Show overlays on blueprint</label>
                <Switch
                  id="ai-overlays"
                  checked={showOverlays ?? true}
                  onCheckedChange={onToggleOverlays}
                  data-testid="switch-ai-overlays"
                />
              </div>
            )}
            {suppressedItems.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSuppressed((s) => !s)}
                className="w-full flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-toggle-suppressed"
                title={
                  suppressionFloor != null
                    ? `Buckets below ${(suppressionFloor * 100).toFixed(0)}% empirical acceptance (with ≥${suppressionMinSamples} samples) are hidden`
                    : undefined
                }
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                  <span data-testid="text-suppressed-count">
                    {showSuppressed ? "Hide" : "Show"} {suppressedItems.length} suppressed
                  </span>
                </span>
                <span className="text-[10px]">
                  {showSuppressed ? "▾" : "▸"}
                </span>
              </button>
            )}
          </div>

          <div className="p-4 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={selectedItems.size > 0 && selectedItems.size === filteredItems.length}
                  onCheckedChange={handleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                  Select All ({filteredItems.length})
                </label>
              </div>
              <Button
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                disabled={selectedItems.size === 0}
                data-testid="button-import-selected"
              >
                <Plus className="w-4 h-4 mr-1" />
                Import ({selectedItems.size})
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-3">
              {Object.entries(groupedItems).map(([groupName, items]) => {
                const isExpanded = expandedGroups.has(groupName) || expandedGroups.size === 0;
                const groupIcon = ITEM_TYPE_ICONS[groupName] || ITEM_TYPE_ICONS.default;
                const GroupIcon = groupIcon;
                const groupAvgConf = Math.round(items.reduce((s, i) => s + i.confidence, 0) / items.length);
                
                return (
                  <Card key={groupName} className="overflow-hidden">
                    <button
                      className="w-full px-4 py-3 flex items-center justify-between hover-elevate"
                      onClick={() => handleToggleGroup(groupName)}
                      data-testid={`button-toggle-group-${groupName}`}
                    >
                      <div className="flex items-center gap-2">
                        <GroupIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium capitalize">{groupName.replace(/_/g, ' ')}</span>
                        <Badge variant="outline" className="ml-1">{items.length}</Badge>
                        <Badge variant={getConfidenceBadge(groupAvgConf)} className={cn("text-[10px]", getConfidenceColor(groupAvgConf))}>
                          ~{groupAvgConf}%
                        </Badge>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                    
                    {isExpanded && (
                      <div className="border-t">
                        {items.map((item, idx) => {
                          const isRejected = rejectedItemIds.has(item.id);
                          const edit = localEdits[item.id];
                          const displayedQty = edit?.quantity ?? item.quantity;
                          const displayedUnit = edit?.unit ?? item.unit;
                          const hasEdit = !!edit && (edit.quantity !== undefined || edit.unit !== undefined || edit.itemType !== undefined);
                          return (
                          <div 
                            key={item.id}
                            className={cn(
                              "px-4 py-3 flex items-start gap-3 hover-elevate cursor-pointer transition-colors",
                              idx !== items.length - 1 && "border-b",
                              hoveredItemId === item.id && "bg-primary/5",
                              isRejected && "opacity-50"
                            )}
                            onMouseEnter={() => {
                              setHoveredItemId(item.id);
                              onHighlightItem?.(item);
                            }}
                            onMouseLeave={() => {
                              setHoveredItemId(null);
                              onHighlightItem?.(null);
                            }}
                            data-testid={`row-suggestion-${item.id}`}
                          >
                            <Checkbox
                              id={item.id}
                              checked={selectedItems.has(item.id)}
                              onCheckedChange={() => handleToggleItem(item.id)}
                              disabled={isRejected}
                              className="mt-0.5"
                              data-testid={`checkbox-item-${item.id}`}
                            />
                            {item.boundingBox && (
                              <RegionThumbnail bbox={item.boundingBox} label={item.id} />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm">{item.description}</span>
                                <Badge 
                                  variant={getConfidenceBadge(item.confidence)}
                                  className={cn("text-xs", getConfidenceColor(item.confidence))}
                                >
                                  {item.confidence}%
                                </Badge>
                                {hasEdit && (
                                  <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600" data-testid={`badge-edited-${item.id}`}>
                                    edited
                                  </Badge>
                                )}
                                {isRejected && (
                                  <Badge variant="destructive" className="text-[9px]" data-testid={`badge-rejected-${item.id}`}>
                                    rejected
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                <span className={cn("font-mono", hasEdit && "text-amber-600 dark:text-amber-400")}>
                                  {displayedQty} {displayedUnit}
                                  {hasEdit && (
                                    <span className="text-[10px] ml-1 line-through opacity-70">({item.quantity} {item.unit})</span>
                                  )}
                                </span>
                                {item.suggestedSowItem && (
                                  <span className="text-xs">
                                    &rarr; {item.suggestedSowItem.code}
                                  </span>
                                )}
                              </div>
                              {item.boundingBox && (
                                <div className="mt-1 text-[10px] text-muted-foreground/70">
                                  <MapPin className="w-2.5 h-2.5 inline mr-0.5" />
                                  {item.boundingBox.x.toFixed(0)}%, {item.boundingBox.y.toFixed(0)}% ({item.boundingBox.w.toFixed(0)}×{item.boundingBox.h.toFixed(0)}%)
                                </div>
                              )}
                            </div>
                            {!isRejected && (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => { e.stopPropagation(); handleOpenEdit(item); }}
                                  title="Edit and accept"
                                  data-testid={`button-edit-${item.id}`}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                      title="Reject suggestion"
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`button-reject-${item.id}`}
                                    >
                                      <ThumbsDown className="w-3.5 h-3.5" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-56 p-2" align="end" onClick={(e) => e.stopPropagation()}>
                                    <div className="text-xs font-medium mb-2">Why is this wrong?</div>
                                    <div className="space-y-1">
                                      {REJECT_REASONS.map((r) => (
                                        <Button
                                          key={r.value}
                                          variant="ghost"
                                          size="sm"
                                          className="w-full justify-start h-8 text-xs"
                                          onClick={() => handleRejectItem(item, r.value)}
                                          data-testid={`button-reject-reason-${r.value}-${item.id}`}
                                        >
                                          <Ban className="w-3 h-3 mr-2" />
                                          {r.label}
                                        </Button>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </ScrollArea>

          <div className="p-3 border-t bg-muted/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground truncate max-w-[70%]">
                {analysisResults?.aiNotes}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStartAnalysis}
                disabled={analyzeMutation.isPending}
                data-testid="button-reanalyze"
              >
                Re-analyze
              </Button>
            </div>
            {pastRuns.length > 0 && (
              <div className="pt-1 border-t">
                <label className="text-[10px] font-medium text-muted-foreground block mb-1">Compare with previous run</label>
                <Select value={compareRunId || ""} onValueChange={(v) => setCompareRunId(v || null)}>
                  <SelectTrigger className="h-7 text-[11px]" data-testid="select-compare-run">
                    <SelectValue placeholder="Select a previous run..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pastRuns.map((run) => (
                      <SelectItem key={run.id} value={run.id}>
                        {new Date(run.createdAt).toLocaleString()} — {run.tradeType || "general"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {compareResults && compareResults.status === "COMPLETE" && (() => {
                  const prevItems = compareResults.detectedItems || [];
                  const prevByType: Record<string, DetectedItem[]> = {};
                  prevItems.forEach(i => { const t = i.itemType || "other"; if (!prevByType[t]) prevByType[t] = []; prevByType[t].push(i); });
                  const currByType: Record<string, DetectedItem[]> = {};
                  detectedItems.forEach(i => { const t = i.itemType || "other"; if (!currByType[t]) currByType[t] = []; currByType[t].push(i); });
                  const allTypes = [...new Set([...Object.keys(prevByType), ...Object.keys(currByType)])].sort();
                  const prevAvgConf = prevItems.length > 0 ? Math.round(prevItems.reduce((s, i) => s + i.confidence, 0) / prevItems.length) : 0;
                  return (
                    <div className="mt-2 p-2 bg-blue-500/5 border border-blue-500/20 rounded text-[10px] space-y-2">
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-medium border-b border-blue-500/20 pb-1">
                        <span className="text-muted-foreground">Type</span>
                        <span className="text-center">Previous</span>
                        <span className="text-center">Current</span>
                      </div>
                      {allTypes.map(type => {
                        const prevCount = prevByType[type]?.length || 0;
                        const currCount = currByType[type]?.length || 0;
                        const diff = currCount - prevCount;
                        return (
                          <div key={type} className="grid grid-cols-3 gap-1 text-[10px]">
                            <span className="capitalize text-muted-foreground truncate">{type.replace(/_/g, " ")}</span>
                            <span className="text-center">{prevCount}</span>
                            <span className={cn("text-center", diff > 0 && "text-green-600", diff < 0 && "text-red-500")}>
                              {currCount} {diff !== 0 && `(${diff > 0 ? "+" : ""}${diff})`}
                            </span>
                          </div>
                        );
                      })}
                      <Separator />
                      <div className="grid grid-cols-3 gap-1 text-[10px] font-medium">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-center">{prevItems.length} ({prevAvgConf}%)</span>
                        <span className="text-center">{detectedItems.length} ({avgConfidence}%)</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {isComplete && detectedItems.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h4 className="font-medium mb-2">No Items Detected</h4>
            <p className="text-sm text-muted-foreground mb-4">
              AI could not detect any measurable items in this blueprint.
              Try uploading a clearer image or selecting a different sheet.
            </p>
            <Button variant="outline" onClick={handleStartAnalysis} data-testid="button-retry-analysis">
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* Task #2323 — Edit-and-accept dialog */}
      <Dialog open={!!editDialogItem} onOpenChange={(open) => !open && setEditDialogItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit suggestion</DialogTitle>
            <DialogDescription>
              Change the quantity, unit, or item type before importing. Edits are tracked
              for the AI accuracy dashboard.
            </DialogDescription>
          </DialogHeader>
          {editDialogItem && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{editDialogItem.description}</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-qty" className="text-xs">Quantity</Label>
                  <Input
                    id="edit-qty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={editForm.quantity}
                    onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))}
                    data-testid="input-edit-quantity"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-unit" className="text-xs">Unit</Label>
                  <Input
                    id="edit-unit"
                    value={editForm.unit}
                    onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                    data-testid="input-edit-unit"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-type" className="text-xs">Item type</Label>
                <Input
                  id="edit-type"
                  value={editForm.itemType}
                  onChange={(e) => setEditForm((f) => ({ ...f, itemType: e.target.value }))}
                  data-testid="input-edit-item-type"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogItem(null)} data-testid="button-edit-cancel">
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} data-testid="button-edit-save">
              Save edits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Detected Items</DialogTitle>
            <DialogDescription>
              {selectedItems.size} item{selectedItems.size !== 1 ? "s" : ""} will be added to your takeoff measurements.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <Sparkles className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-purple-700 dark:text-purple-400">
              Items with detected regions will be placed at their <span className="font-semibold">detected location</span> on the blueprint. Others will appear in the AI Detections zone.
            </div>
          </div>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {filteredItems
                .filter((i: DetectedItem) => selectedItems.has(i.id))
                .map((item: DetectedItem) => (
                  <div key={item.id} className="flex items-center justify-between py-2 px-3 bg-muted rounded">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{item.description}</span>
                      <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">AI</Badge>
                      {item.boundingBox && (
                        <Badge variant="outline" className="text-[9px]">
                          <MapPin className="w-2.5 h-2.5 mr-0.5" />Located
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm font-mono">{item.quantity} {item.unit}</span>
                  </div>
                ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportSelected} disabled={isImporting} data-testid="button-confirm-import">
              {isImporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              {isImporting ? "Importing..." : `Import ${selectedItems.size} Item${selectedItems.size !== 1 ? "s" : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Task #2518 — render the live progress bar for an in-flight AI takeoff
 * job. Subscribes to the job-progress SSE feed via `useJobProgress` so
 * users see the actual percentage the worker is publishing instead of a
 * static 45% placeholder.
 */
function AiTakeoffPendingProgress({
  jobId,
  tradeLabel,
  analysisMode,
}: {
  jobId: string | null;
  tradeLabel: string;
  analysisMode: "QUICK" | "DETAILED";
}) {
  const job = useJobProgress(jobId);
  const hasLive = !!jobId && job.status !== "idle";
  const value = hasLive ? job.progress : 5;
  return (
    <div className="space-y-3" data-testid="ai-takeoff-pending-progress">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm" data-testid="text-ai-takeoff-progress-message">
          {hasLive && job.message
            ? job.message
            : "AI is analyzing your blueprint..."}
        </span>
      </div>
      <Progress value={value} className="h-2" data-testid="progress-ai-takeoff" />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Detecting {tradeLabel}-specific items
          {analysisMode === "DETAILED" && " (multi-pass verification)"}
        </span>
        {hasLive && (
          <span className="tabular-nums" data-testid="text-ai-takeoff-progress-pct">
            {job.progress}%
          </span>
        )}
      </div>
    </div>
  );
}
