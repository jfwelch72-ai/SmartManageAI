import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { History, Plus, Lock, ArrowLeftRight, ChevronDown, ChevronUp, GitCompare } from "lucide-react";
import type { TakeoffVersion, TakeoffMeasurement } from "@shared/schema";

type TakeoffVersionWithAuthor = TakeoffVersion & { createdByName?: string | null };

interface TakeoffVersionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string | null;
  projectId?: string;
  bidId?: string;
  onVersionSwitch?: (versionId: string) => void;
}

interface ComparisonDelta {
  older: TakeoffMeasurement;
  newer: TakeoffMeasurement;
  deltas: { lengthDelta: number; areaDelta: number; volumeDelta: number; costDelta: number };
}

interface ComparisonResult {
  versionA: TakeoffVersion;
  versionB: TakeoffVersion;
  summary: {
    addedCount: number;
    removedCount: number;
    changedCount: number;
    unchangedCount: number;
    totalCostDelta: number;
    totalLengthDelta: number;
    totalAreaDelta: number;
  };
  added: TakeoffMeasurement[];
  removed: TakeoffMeasurement[];
  changed: ComparisonDelta[];
  unchanged: TakeoffMeasurement[];
}

function formatDelta(value: number, unit: string): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} ${unit}`;
}

function formatCost(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}₱${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function TakeoffVersionHistory({ open, onOpenChange, sheetId, projectId, bidId, onVersionSwitch }: TakeoffVersionHistoryProps) {
  const { toast } = useToast();
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const queryParams = sheetId ? `sheetId=${sheetId}` : projectId ? `projectId=${projectId}` : bidId ? `bidId=${bidId}` : "";

  const { data: versions = [], isLoading } = useQuery<TakeoffVersionWithAuthor[]>({
    queryKey: ["/api/takeoff/versions", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/versions?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch versions");
      return res.json();
    },
    enabled: open && !!queryParams,
  });

  const { data: comparison, isLoading: comparisonLoading } = useQuery<ComparisonResult>({
    queryKey: ["/api/takeoff/versions/compare", compareA, compareB],
    queryFn: async () => {
      const res = await fetch(`/api/takeoff/versions/compare?versionAId=${compareA}&versionBId=${compareB}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to compare versions");
      return res.json();
    },
    enabled: !!compareA && !!compareB && compareA !== compareB,
  });

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/takeoff/versions", {
        sheetId,
        projectId,
        bidId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/versions", queryParams] });
      if (sheetId) {
        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheetId, "measurements"] });
      }
      toast({ title: "New version created", description: `Version ${data.versionNumber} created` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create version", variant: "destructive" });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Takeoff Version History
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {versions.length} version{versions.length !== 1 ? "s" : ""}
            </p>
            {sheetId && (
              <Button
                size="sm"
                onClick={() => createVersionMutation.mutate()}
                disabled={createVersionMutation.isPending}
                data-testid="button-new-version"
              >
                <Plus className="w-4 h-4 mr-1" />
                {createVersionMutation.isPending ? "Creating..." : "New Version"}
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No versions yet. Create a version to start tracking changes.
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3"
                  data-testid={`version-item-${v.versionNumber}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant={v.status === "LOCKED" ? "secondary" : "default"} className="font-mono shrink-0">
                      {v.status === "LOCKED" && <Lock className="w-3 h-3 mr-1" />}
                      v{v.versionNumber}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {v.label || `Version ${v.versionNumber}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(v.createdAt), "MMM d, yyyy h:mm a")}
                        {v.createdByName && <> · {v.createdByName}</>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="text-xs">
                      {v.status}
                    </Badge>
                    {onVersionSwitch && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => onVersionSwitch(v.id)}
                        data-testid={`button-switch-version-${v.versionNumber}`}
                      >
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {versions.length >= 2 && (
            <>
              <Separator />
              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Compare Versions</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Older Version</label>
                    <Select value={compareA} onValueChange={setCompareA}>
                      <SelectTrigger data-testid="select-compare-older">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            v{v.versionNumber} — {v.label || `Version ${v.versionNumber}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Newer Version</label>
                    <Select value={compareB} onValueChange={setCompareB}>
                      <SelectTrigger data-testid="select-compare-newer">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            v{v.versionNumber} — {v.label || `Version ${v.versionNumber}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {comparisonLoading && (
                  <div className="text-center py-4 text-muted-foreground text-sm">Loading comparison...</div>
                )}

                {comparison && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-mono font-semibold">v{comparison.versionA.versionNumber}</span> → <span className="font-mono font-semibold">v{comparison.versionB.versionNumber}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-md border p-2 text-center">
                        <p className="text-xs text-muted-foreground">Length Delta</p>
                        <p className={`text-sm font-semibold ${comparison.summary.totalLengthDelta > 0 ? "text-green-600" : comparison.summary.totalLengthDelta < 0 ? "text-red-600" : ""}`} data-testid="text-length-delta">
                          {formatDelta(comparison.summary.totalLengthDelta, "LF")}
                        </p>
                      </div>
                      <div className="rounded-md border p-2 text-center">
                        <p className="text-xs text-muted-foreground">Area Delta</p>
                        <p className={`text-sm font-semibold ${comparison.summary.totalAreaDelta > 0 ? "text-green-600" : comparison.summary.totalAreaDelta < 0 ? "text-red-600" : ""}`} data-testid="text-area-delta">
                          {formatDelta(comparison.summary.totalAreaDelta, "SF")}
                        </p>
                      </div>
                      <div className="rounded-md border p-2 text-center">
                        <p className="text-xs text-muted-foreground">Cost Impact</p>
                        <p className={`text-sm font-semibold ${comparison.summary.totalCostDelta > 0 ? "text-red-600" : comparison.summary.totalCostDelta < 0 ? "text-green-600" : ""}`} data-testid="text-cost-impact">
                          {formatCost(comparison.summary.totalCostDelta)}
                        </p>
                      </div>
                    </div>

                    {comparison.added.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                          Added ({comparison.added.length})
                        </p>
                        <div className="rounded border divide-y max-h-40 overflow-y-auto">
                          {comparison.added.map((item) => (
                            <div key={item.id} className="px-3 py-2 bg-green-50 dark:bg-green-950/20" data-testid={`diff-added-${item.id}`}>
                              <p className="text-sm font-medium text-green-800 dark:text-green-300">{item.label}</p>
                              <p className="text-xs text-green-700 dark:text-green-400">
                                {item.type} · {item.computedLengthFt ? `${item.computedLengthFt.toFixed(1)} LF` : item.computedAreaFt2 ? `${item.computedAreaFt2.toFixed(1)} SF` : `${item.count || 0} count`}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {comparison.removed.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                          Removed ({comparison.removed.length})
                        </p>
                        <div className="rounded border divide-y max-h-40 overflow-y-auto">
                          {comparison.removed.map((item) => (
                            <div key={item.id} className="px-3 py-2 bg-red-50 dark:bg-red-950/20" data-testid={`diff-removed-${item.id}`}>
                              <p className="text-sm font-medium text-red-800 dark:text-red-300 line-through">{item.label}</p>
                              <p className="text-xs text-red-700 dark:text-red-400">
                                {item.type} · {item.computedLengthFt ? `${item.computedLengthFt.toFixed(1)} LF` : item.computedAreaFt2 ? `${item.computedAreaFt2.toFixed(1)} SF` : `${item.count || 0} count`}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {comparison.changed.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                          Changed ({comparison.changed.length})
                        </p>
                        <div className="rounded border divide-y max-h-40 overflow-y-auto">
                          {comparison.changed.map(({ older, newer, deltas }: ComparisonDelta) => (
                            <div key={newer.id} className="px-3 py-2 bg-amber-50 dark:bg-amber-950/20" data-testid={`diff-changed-${newer.id}`}>
                              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{newer.label}</p>
                              <div className="flex gap-3 text-xs text-amber-700 dark:text-amber-400 mt-1">
                                {Math.abs(deltas.lengthDelta) > 0.01 && <span>{formatDelta(deltas.lengthDelta, "LF")}</span>}
                                {Math.abs(deltas.areaDelta) > 0.01 && <span>{formatDelta(deltas.areaDelta, "SF")}</span>}
                                {Math.abs(deltas.costDelta) > 0.01 && <span>Cost: {formatCost(deltas.costDelta)}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {comparison.unchanged.length > 0 && (
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between text-xs text-muted-foreground h-8"
                          onClick={() => setShowUnchanged(!showUnchanged)}
                          data-testid="button-toggle-unchanged"
                        >
                          <span>Unchanged ({comparison.unchanged.length} items)</span>
                          {showUnchanged ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                        {showUnchanged && (
                          <div className="rounded border divide-y max-h-40 overflow-y-auto">
                            {comparison.unchanged.map((item) => (
                              <div key={item.id} className="px-3 py-2">
                                <p className="text-sm text-muted-foreground">{item.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {comparison.summary.addedCount === 0 && comparison.summary.removedCount === 0 && comparison.summary.changedCount === 0 && (
                      <p className="text-sm text-center text-muted-foreground py-4">
                        No differences found between these two versions.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
