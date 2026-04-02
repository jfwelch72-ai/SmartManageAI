import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  ShoppingCart,
  GitCompare,
  FileSpreadsheet,
  BarChart3,
  ArrowRight,
  Plus,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Package,
  FileText,
  Loader2,
  X,
} from "lucide-react";

interface TakeoffCrossModulePanelProps {
  projectId: string;
  selectedSheet: string | null;
  measurements: any[];
  categories: any[];
  selectedMeasurementIds?: string[];
  onClose: () => void;
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function MaterialRequestTab({
  projectId,
  measurements,
  categories,
}: {
  projectId: string;
  measurements: any[];
  categories: any[];
}) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const categoryMap = new Map(categories.map((c: any) => [c.id, c]));

  const convertMutation = useMutation({
    mutationFn: async (measurementIds: string[]) => {
      const res = await apiRequest("POST", "/api/takeoff/convert-to-material-request", {
        projectId,
        measurementIds,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/projects"] });
      toast({
        title: "Material Request Created",
        description: `Purchase Request ${data.purchaseRequest.prNumber} created with ${data.itemCount} items (${fmtCurrency(data.totalEstimatedCost)})`,
      });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create material request", variant: "destructive" });
    },
  });

  const toggleAll = () => {
    if (selectedIds.size === measurements.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(measurements.map((m: any) => m.id)));
    }
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function getQuantityDisplay(m: any) {
    if (m.type === "LINEAR" && m.computedLengthFt) return `${m.computedLengthFt.toFixed(1)} LF`;
    if (m.type === "AREA" && m.computedAreaFt2) return `${m.computedAreaFt2.toFixed(1)} SF`;
    if (m.type === "VOLUME" && m.computedVolumeCy) return `${m.computedVolumeCy.toFixed(1)} CY`;
    if (m.type === "COUNT" && m.count) return `${m.count} EA`;
    return `${m.count || 1} EA`;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Select measurements to convert into a procurement material request.
        </p>
      </div>

      {measurements.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
          No measurements on this sheet yet.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectedIds.size === measurements.length && measurements.length > 0}
              onCheckedChange={toggleAll}
              data-testid="checkbox-select-all-measurements"
            />
            <span className="text-xs text-muted-foreground">
              Select All ({selectedIds.size}/{measurements.length})
            </span>
          </div>

          <ScrollArea className="h-[240px]">
            <div className="space-y-1">
              {measurements.map((m: any) => {
                const cat = m.categoryId ? categoryMap.get(m.categoryId) : null;
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 text-sm"
                    data-testid={`measurement-row-${m.id}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(m.id)}
                      onCheckedChange={() => toggleId(m.id)}
                      data-testid={`checkbox-measurement-${m.id}`}
                    />
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat?.color || m.color || "#6b7280" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{m.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {cat?.name || "Uncategorized"} — {getQuantityDisplay(m)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          <Button
            className="w-full"
            disabled={selectedIds.size === 0 || convertMutation.isPending}
            onClick={() => convertMutation.mutate([...selectedIds])}
            data-testid="button-convert-to-material-request"
          >
            {convertMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4 mr-2" />
            )}
            Convert {selectedIds.size} Item{selectedIds.size !== 1 ? "s" : ""} to Material Request
          </Button>
        </>
      )}
    </div>
  );
}

function ChangeDetectionTab({
  projectId,
  selectedSheet,
}: {
  projectId: string;
  selectedSheet: string | null;
}) {
  const { toast } = useToast();
  const [deltas, setDeltas] = useState<any[]>([]);
  const [sheetInfo, setSheetInfo] = useState<any>(null);
  const [selectedDeltas, setSelectedDeltas] = useState<Set<number>>(new Set());

  const detectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${selectedSheet}/detect-changes`, {});
      return res.json();
    },
    onSuccess: (data) => {
      setDeltas(data.deltas || []);
      setSheetInfo(data);
      if (data.deltas?.length === 0) {
        toast({ title: "No Changes", description: data.message || "No quantity deltas detected" });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to detect changes", variant: "destructive" });
    },
  });

  const createPcoMutation = useMutation({
    mutationFn: async (selectedDeltaItems: any[]) => {
      const res = await apiRequest("POST", "/api/takeoff/create-pco-from-delta", {
        projectId,
        deltas: selectedDeltaItems,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/projects"] });
      toast({
        title: "PCO Created",
        description: `${data.changeOrder.changeOrderNumber} created with ${data.deltaCount} delta(s), cost impact: ${fmtCurrency(data.totalCostImpact)}`,
      });
      setSelectedDeltas(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create PCO", variant: "destructive" });
    },
  });

  const toggleDelta = (idx: number) => {
    setSelectedDeltas((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (!selectedSheet) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <GitCompare className="h-8 w-8 mx-auto mb-2 opacity-50" />
        Select a sheet to detect changes.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Compare current sheet against its previous version and flag quantity deltas as potential change orders.
      </p>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => detectMutation.mutate()}
        disabled={detectMutation.isPending}
        data-testid="button-detect-changes"
      >
        {detectMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <GitCompare className="h-4 w-4 mr-2" />
        )}
        Detect Changes vs Previous Version
      </Button>

      {sheetInfo && deltas.length > 0 && (
        <>
          <div className="text-xs text-muted-foreground">
            Comparing: <span className="font-medium">{sheetInfo.predecessorSheetName}</span>
            {" → "}
            <span className="font-medium">{sheetInfo.currentSheetName}</span>
          </div>

          <ScrollArea className="h-[220px]">
            <div className="space-y-1">
              {deltas.map((d: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-md border text-sm"
                  data-testid={`delta-row-${idx}`}
                >
                  <Checkbox
                    checked={selectedDeltas.has(idx)}
                    onCheckedChange={() => toggleDelta(idx)}
                    className="mt-0.5"
                    data-testid={`checkbox-delta-${idx}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium truncate">{d.label}</span>
                      <Badge
                        variant={d.type === "ADDED" ? "default" : d.type === "REMOVED" ? "destructive" : "secondary"}
                        className="text-xs shrink-0"
                      >
                        {d.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {d.categoryName} — {d.oldQuantity} → {d.newQuantity} {d.unit}
                      {" "}(Δ{d.quantityDiff > 0 ? "+" : ""}{d.quantityDiff})
                    </p>
                    <p className={`text-xs font-medium mt-0.5 ${d.costImpact >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      Cost Impact: {d.costImpact >= 0 ? "+" : ""}{fmtCurrency(d.costImpact)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <Button
            className="w-full"
            disabled={selectedDeltas.size === 0 || createPcoMutation.isPending}
            onClick={() => {
              const items = [...selectedDeltas].map((idx) => deltas[idx]);
              createPcoMutation.mutate(items);
            }}
            data-testid="button-create-pco"
          >
            {createPcoMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 mr-2" />
            )}
            Create PCO from {selectedDeltas.size} Delta{selectedDeltas.size !== 1 ? "s" : ""}
          </Button>
        </>
      )}

      {sheetInfo && deltas.length === 0 && (
        <div className="text-center py-4 text-sm">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-1.5 text-green-500" />
          <p className="text-muted-foreground">No quantity deltas found between revisions.</p>
        </div>
      )}
    </div>
  );
}

function SovSyncTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/takeoff/projects/${projectId}/generate-sov`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/projects"] });
      toast({
        title: "SOV Generated",
        description: `${data.sov.sovNumber} created with ${data.lineItemCount} line items totaling ${fmtCurrency(data.totalScheduledValue)}`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to generate SOV",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Generate or refresh SOV line items from takeoff categories and quantities. Each category becomes a line item.
      </p>

      <Card className="bg-muted/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileSpreadsheet className="h-4 w-4" />
            How it works
          </div>
          <ul className="text-xs text-muted-foreground space-y-1 ml-6 list-disc">
            <li>Groups measurements by category across all active sheets</li>
            <li>Maps quantities and unit costs to scheduled values</li>
            <li>Creates a new DRAFT SOV with one line per category</li>
          </ul>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        data-testid="button-generate-sov"
      >
        {generateMutation.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 mr-2" />
        )}
        Generate SOV from Takeoff
      </Button>
    </div>
  );
}

function CostSummaryTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<any>({
    queryKey: ["/api/takeoff/projects", projectId, "cost-summary"],
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/projects/${projectId}/cost-summary`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch cost summary");
      return res.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading cost summary...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No cost data available yet.
      </div>
    );
  }

  const { totals, scopeAreas, counts } = summary;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="Takeoff Estimate" value={fmtCurrency(totals.takeoffEstimate)} icon={<BarChart3 className="h-3.5 w-3.5 text-blue-500" />} />
        <SummaryCard label="Budget" value={fmtCurrency(totals.budget)} icon={<FileText className="h-3.5 w-3.5 text-purple-500" />} />
        <SummaryCard label="Committed (POs)" value={fmtCurrency(totals.committed)} icon={<ShoppingCart className="h-3.5 w-3.5 text-orange-500" />} />
        <SummaryCard label="Approved COs" value={fmtCurrency(totals.approvedChanges)} icon={<GitCompare className="h-3.5 w-3.5 text-teal-500" />} />
      </div>

      <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
        <span className="text-muted-foreground">Variance (Budget - Committed)</span>
        <span className={`font-bold ${totals.variance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {totals.variance >= 0 ? <TrendingUp className="h-3 w-3 inline mr-0.5" /> : <TrendingDown className="h-3 w-3 inline mr-0.5" />}
          {fmtCurrency(totals.variance)}
        </span>
      </div>

      <Separator />

      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Cost by Scope Area
      </div>

      <ScrollArea className="h-[160px]">
        <div className="space-y-1">
          {scopeAreas.map((area: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2 rounded-md hover:bg-muted/30 text-sm"
              data-testid={`scope-area-${idx}`}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{area.name}</p>
                <p className="text-xs text-muted-foreground">
                  {area.takeoffQty} {area.unit}
                </p>
              </div>
              <span className="font-mono text-xs">{fmtCurrency(area.estimatedCost)}</span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Separator />

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="text-muted-foreground">Measurements</p>
          <p className="font-bold text-lg" data-testid="text-count-measurements">{counts.measurements}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Categories</p>
          <p className="font-bold text-lg" data-testid="text-count-categories">{counts.categories}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Change Orders</p>
          <p className="font-bold text-lg" data-testid="text-count-change-orders">{counts.changeOrders}</p>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-md border bg-card">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm font-bold mt-0.5">{value}</p>
    </div>
  );
}

export default function TakeoffCrossModulePanel({
  projectId,
  selectedSheet,
  measurements,
  categories,
  onClose,
}: TakeoffCrossModulePanelProps) {
  const [activeTab, setActiveTab] = useState("material-request");

  return (
    <Card className="w-full border-l" data-testid="panel-cross-module">
      <CardHeader className="p-3 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <ArrowRight className="h-4 w-4" />
            Cross-Module Actions
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} data-testid="button-close-cross-module">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full h-auto flex-wrap gap-0.5 p-0.5">
            <TabsTrigger value="material-request" className="text-xs flex-1 px-1.5 py-1" data-testid="tab-material-request">
              <ShoppingCart className="h-3 w-3 mr-1" />
              Procure
            </TabsTrigger>
            <TabsTrigger value="change-detection" className="text-xs flex-1 px-1.5 py-1" data-testid="tab-change-detection">
              <GitCompare className="h-3 w-3 mr-1" />
              Changes
            </TabsTrigger>
            <TabsTrigger value="sov-sync" className="text-xs flex-1 px-1.5 py-1" data-testid="tab-sov-sync">
              <FileSpreadsheet className="h-3 w-3 mr-1" />
              SOV
            </TabsTrigger>
            <TabsTrigger value="summary" className="text-xs flex-1 px-1.5 py-1" data-testid="tab-summary">
              <BarChart3 className="h-3 w-3 mr-1" />
              Summary
            </TabsTrigger>
          </TabsList>

          <TabsContent value="material-request" className="mt-3">
            <MaterialRequestTab
              projectId={projectId}
              measurements={measurements}
              categories={categories}
            />
          </TabsContent>

          <TabsContent value="change-detection" className="mt-3">
            <ChangeDetectionTab projectId={projectId} selectedSheet={selectedSheet} />
          </TabsContent>

          <TabsContent value="sov-sync" className="mt-3">
            <SovSyncTab projectId={projectId} />
          </TabsContent>

          <TabsContent value="summary" className="mt-3">
            <CostSummaryTab projectId={projectId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
