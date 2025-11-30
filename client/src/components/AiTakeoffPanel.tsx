import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
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
  Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DetectedItem {
  id: string;
  itemType: string;
  description: string;
  quantity: number;
  unit: string;
  confidence: number;
  suggestedSowItem?: {
    name: string;
    code: string;
  };
}

interface AiTakeoffPanelProps {
  projectId: string;
  sheetId?: string | null;
  onItemsImported?: (items: DetectedItem[]) => void;
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

export default function AiTakeoffPanel({ projectId, sheetId, onItemsImported }: AiTakeoffPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  
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

  const { data: analysisHistory } = useQuery<{ analyses: AnalysisResult[] }>({
    queryKey: ["/api/ai-features/takeoff/history", projectId],
    enabled: !!projectId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/ai-features/takeoff/analyze", {
        projectId,
        takeoffSheetId: sheetId,
        analysisMode: "QUICK",
      });
      return response.json();
    },
    onSuccess: (data: { analysisId: string; estimatedTime: number }) => {
      setAnalysisId(data.analysisId);
      setIsAnalyzing(true);
      toast({
        title: "AI Analysis Started",
        description: `Analyzing blueprints... Estimated time: ${data.estimatedTime}s`,
      });
    },
    onError: (error: any) => {
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
    if (!analysisResults?.detectedItems) return;
    if (selectedItems.size === analysisResults.detectedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(analysisResults.detectedItems.map((i: DetectedItem) => i.id)));
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

  const handleImportSelected = () => {
    if (!analysisResults?.detectedItems) return;
    const itemsToImport = analysisResults.detectedItems.filter((i: DetectedItem) => selectedItems.has(i.id));
    onItemsImported?.(itemsToImport);
    setImportDialogOpen(false);
    setSelectedItems(new Set());
    toast({
      title: "Items Imported",
      description: `Successfully imported ${itemsToImport.length} items to takeoff`,
    });
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

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 85) return "default";
    if (confidence >= 70) return "secondary";
    return "outline";
  };

  const isComplete = analysisResults?.status === "COMPLETE";
  const isPending = analysisResults?.status === "PENDING" || analysisResults?.status === "PROCESSING";
  const detectedItems = analysisResults?.detectedItems || [];
  const groupedItems = groupItemsByType(detectedItems);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">AI Auto-Takeoff</h3>
          </div>
          {isComplete && detectedItems.length > 0 && (
            <Badge variant="secondary" data-testid="badge-items-detected">
              {detectedItems.length} items
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Automatically detect measurements from your blueprints using AI
        </p>
        
        {!isAnalyzing && !isComplete && (
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
            </p>
          </div>
        )}
      </div>

      {isComplete && detectedItems.length > 0 && (
        <>
          <div className="p-4 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={selectedItems.size === detectedItems.length}
                  onCheckedChange={handleSelectAll}
                  data-testid="checkbox-select-all"
                />
                <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                  Select All ({detectedItems.length})
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
                        <Badge variant="outline" className="ml-2">{items.length}</Badge>
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
                              "px-4 py-3 flex items-start gap-3 hover-elevate",
                              idx !== items.length - 1 && "border-b"
                            )}
                          >
                            <Checkbox
                              id={item.id}
                              checked={selectedItems.has(item.id)}
                              onCheckedChange={() => handleToggleItem(item.id)}
                              className="mt-0.5"
                              data-testid={`checkbox-item-${item.id}`}
                            />
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
                                    → {item.suggestedSowItem.code}
                                  </span>
                                )}
                              </div>
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

          <div className="p-4 border-t bg-muted/30">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
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
            <Button variant="outline" onClick={handleStartAnalysis}>
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
              The following {selectedItems.size} items will be added to your takeoff:
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {detectedItems
                .filter((i: DetectedItem) => selectedItems.has(i.id))
                .map((item: DetectedItem) => (
                  <div key={item.id} className="flex items-center justify-between py-2 px-3 bg-muted rounded">
                    <span className="text-sm">{item.description}</span>
                    <span className="text-sm font-mono">{item.quantity} {item.unit}</span>
                  </div>
                ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportSelected} data-testid="button-confirm-import">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Import Items
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
