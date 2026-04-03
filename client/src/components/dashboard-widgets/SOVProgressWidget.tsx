import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, DollarSign, ShieldCheck, ArrowRight, Lock, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

interface SOVProject {
  name: string;
  billedPercent: number;
  completePercent: number;
}

interface SOVProgress {
  billedPercent: number;
  completePercent: number;
  totalScheduledValue: number;
  totalCompletedToDate: number;
  totalBilled: number;
  laborCost: number;
  sovValue: number;
  laborToSovPercent: number;
  retainageHeld: number;
  avgRetainagePercent: number;
  projects: SOVProject[];
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

function ProgressBar({ label, percent, color }: { label: string; percent: number; color: string }) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function SOVProgressWidget() {
  const hasPermission = useFeaturePermission("canAccessFinancials");

  const { data, isLoading, isError, refetch} = useQuery<SOVProgress>({
    queryKey: ["/api/dashboard/sov-progress"],
    refetchInterval: 300000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="sov-progress-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">SOV Progress</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground text-center py-4">You don't have permission to view financial data.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="sov-progress-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-full" />
          </div>
          <Skeleton className="h-16 bg-muted/50 rounded-lg" />
          <Skeleton className="h-12 bg-muted/50 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="sov-progress-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load SOV data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const d = data || {
    billedPercent: 0, completePercent: 0, totalScheduledValue: 0,
    totalCompletedToDate: 0, totalBilled: 0, laborCost: 0, sovValue: 0,
    laborToSovPercent: 0, retainageHeld: 0, avgRetainagePercent: 0, projects: [],
  };

  const variance = d.billedPercent - d.completePercent;
  const isEmpty = d.totalScheduledValue === 0 && d.projects.length === 0;

  return (
    <Card data-testid="sov-progress-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">SOV Progress</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="sov-empty-state">
            <ClipboardList className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No active Schedule of Values</p>
            <p className="text-xs text-muted-foreground/70 mt-1">SOV data will appear here once pay applications are created</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2" data-testid="sov-billed-vs-complete">
              <ProgressBar label="% Billed" percent={d.billedPercent} color="bg-blue-500" />
              <ProgressBar label="% Complete" percent={d.completePercent} color="bg-green-500" />
              <div className="flex items-center justify-end gap-1.5">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    variance > 2 ? "border-amber-500 text-amber-600 dark:text-amber-400" :
                    variance < -2 ? "border-red-500 text-red-600 dark:text-red-400" :
                    "border-green-500 text-green-600 dark:text-green-400"
                  )}
                  data-testid="sov-variance-badge"
                >
                  {variance > 2 ? "Over-billed" : variance < -2 ? "Under-billed" : "On Track"}
                  {` (${variance >= 0 ? "+" : ""}${variance.toFixed(1)}%)`}
                </Badge>
              </div>
            </div>

            {d.projects.length > 0 && (
              <div className="space-y-1.5" data-testid="sov-project-breakdown">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Top Projects</p>
                <div className="space-y-1">
                  {d.projects.map((proj, i) => {
                    const pv = proj.billedPercent - proj.completePercent;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                        data-testid={`sov-project-row-${i}`}
                      >
                        <span className="truncate max-w-[45%] text-foreground">{proj.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-blue-600 dark:text-blue-400 tabular-nums">{proj.billedPercent.toFixed(0)}%</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <span className="text-green-600 dark:text-green-400 tabular-nums">{proj.completePercent.toFixed(0)}%</span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px] px-1 py-0 ml-1",
                              pv > 2 ? "border-amber-400 text-amber-600 dark:text-amber-400" :
                              pv < -2 ? "border-red-400 text-red-600 dark:text-red-400" :
                              "border-green-400 text-green-600 dark:text-green-400"
                            )}
                          >
                            {pv >= 0 ? "+" : ""}{pv.toFixed(0)}%
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-indigo-500/10 p-3" data-testid="sov-labor-vs-sov">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Labor vs SOV</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <p className="text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                    {formatCurrency(d.laborCost)}
                  </p>
                  <span className="text-[11px] text-muted-foreground">/ {formatCurrency(d.sovValue)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {d.laborToSovPercent.toFixed(1)}% of SOV value
                </p>
              </div>

              <div className="rounded-lg bg-emerald-500/10 p-3" data-testid="sov-retainage-held">
                <div className="flex items-center gap-1.5 mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Retainage</span>
                </div>
                <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(d.retainageHeld)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  avg {d.avgRetainagePercent.toFixed(1)}% held
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="pt-2.5 border-t border-border/50">
          <Link href="/projects" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-projects-sov">
            View all projects
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
