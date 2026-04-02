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
  ScanSearch
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

interface AiTakeoffPanelProps {
  projectId?: string;
  bidId?: string;
  sheetId?: string | null;
  onItemsImported?: (items: DetectedItem[]) => Promise<{ succeeded: number; failed: number; failedItems: string[] }>;
  onClose?: () => void;
  onHighlightItem?: (item: DetectedItem | null) => void;
  onDetectedItemsChanged?: (items: DetectedItem[]) => void;
  showOverlays?: boolean;
  onToggleOverlays?: (show: boolean) => void;
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

export default function AiTakeoffPanel({ projectId, bidId, sheetId, onItemsImported, onClose, onHighlightItem, onDetectedItemsChanged, showOverlays, onToggleOverlays }: AiTakeoffPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [analysisMode, setAnalysisMode] = useState<"QUICK" | "DETAILED">("QUICK");
  const [selectedTradeType, setSelectedTradeType] = useState("AUTO_DETECT");
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  
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

  const historyContextId = projectId || bidId;
  const historyContextType = bidId && !projectId ? "bid" : "project";
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

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        ...(projectId ? { projectId } : {}),
        ...(bidId ? { bidId } : {}),
        takeoffSheetId: sheetId,
        analysisMode,
      };
      if (selectedTradeType !== "AUTO_DETECT") {
        body.tradeType = selectedTradeType;
      }
      const response = await apiRequest("POST", "/api/ai-features/takeoff/analyze", body);
      return response.json();
    },
    onSuccess: (data: { analysisId: string; estimatedTime: number }) => {
      setAnalysisId(data.analysisId);
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

  const handleImportSelected = async () => {
    if (!analysisResults?.detectedItems) return;
    const itemsToImport = analysisResults.detectedItems.filter((i: DetectedItem) => selectedItems.has(i.id));
    if (itemsToImport.length === 0) return;

    if (onItemsImported) {
      setIsImporting(true);
      try {
        const result = await onItemsImported(itemsToImport);
        setImportDialogOpen(false);
        setSelectedItems(new Set());
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

  const filteredItems = useMemo(() => {
    return detectedItems
      .filter((item: DetectedItem) => item.confidence >= confidenceThreshold)
      .sort((a: DetectedItem, b: DetectedItem) => b.confidence - a.confidence);
  }, [detectedItems, confidenceThreshold]);

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
          </div>
        )}

        {isPending && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm">AI is analyzing your blueprint...</span>
            </div>
            <Progress value={45} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Detecting {analysisResults?.tradeType || "trade"}-specific items
              {analysisMode === "DETAILED" && " (multi-pass verification)"}
            </p>
          </div>
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
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                    Demo Data - Upload a blueprint for real AI detection
                  </span>
                </div>
              )}
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
                        {items.map((item, idx) => (
                          <div 
                            key={item.id}
                            className={cn(
                              "px-4 py-3 flex items-start gap-3 hover-elevate cursor-pointer transition-colors",
                              idx !== items.length - 1 && "border-b",
                              hoveredItemId === item.id && "bg-primary/5"
                            )}
                            onMouseEnter={() => {
                              setHoveredItemId(item.id);
                              onHighlightItem?.(item);
                            }}
                            onMouseLeave={() => {
                              setHoveredItemId(null);
                              onHighlightItem?.(null);
                            }}
                          >
                            <Checkbox
                              id={item.id}
                              checked={selectedItems.has(item.id)}
                              onCheckedChange={() => handleToggleItem(item.id)}
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
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                                <span className="font-mono">{item.quantity} {item.unit}</span>
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
                          </div>
                        ))}
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
