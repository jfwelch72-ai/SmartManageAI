import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Users, Clock, TrendingUp, Lock, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { type LaborUtilizationConfig, DEFAULT_LABOR_UTIL_CONFIG } from "./LaborUtilizationSettings";
import type { WidgetComponentProps } from "./WidgetRegistry";

interface LaborUtilization {
  utilizedPercent: number;
  workedHours: number;
  availableHours: number;
  billablePercent: number;
  activeWorkers: number;
  totalWorkers: number;
  sparkline: { date: string; utilizedPercent: number }[];
}

function getUtilizationColor(pct: number, cfg: LaborUtilizationConfig): string {
  if (pct >= cfg.goodThreshold) return "text-green-600 dark:text-green-400";
  if (pct >= cfg.lowThreshold) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getUtilizationBg(pct: number, cfg: LaborUtilizationConfig): string {
  if (pct >= cfg.goodThreshold) return "bg-green-500";
  if (pct >= cfg.lowThreshold) return "bg-amber-500";
  return "bg-red-500";
}

function SparklineBar({ sparkline, cfg }: { sparkline: { date: string; utilizedPercent: number }[]; cfg: LaborUtilizationConfig }) {
  if (!sparkline || sparkline.length === 0) return null;
  const max = Math.max(...sparkline.map(s => s.utilizedPercent), 1);
  return (
    <div className="flex items-end gap-0.5 h-8" data-testid="sparkline-bars">
      {sparkline.map((s, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-sm min-h-[2px] transition-all", getUtilizationBg(s.utilizedPercent, cfg), "opacity-70")}
          style={{ height: `${Math.max((s.utilizedPercent / max) * 100, 5)}%` }}
          title={`${new Date(s.date).toLocaleDateString(undefined, { weekday: "short" })}: ${s.utilizedPercent}%`}
        />
      ))}
    </div>
  );
}

const DATE_RANGE_LABELS: Record<string, string> = {
  today: "Today",
  last7days: "Last 7 Days",
  last30days: "Last 30 Days",
};

export function LaborUtilizationWidget({ config }: WidgetComponentProps) {
  const hasPermission = useFeaturePermission("canManagePayroll");
  const cfg: LaborUtilizationConfig = { ...DEFAULT_LABOR_UTIL_CONFIG, ...(config as Partial<LaborUtilizationConfig>) };

  const { data, isLoading, isError, refetch} = useQuery<LaborUtilization>({
    queryKey: ["/api/dashboard/labor-utilization", { dateRange: cfg.dateRange }],
    queryFn: () => fetch(`/api/dashboard/labor-utilization?dateRange=${cfg.dateRange || "today"}`).then(r => r.json()),
    refetchInterval: 120000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="labor-utilization-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Labor Utilization</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground text-center py-4">You don't have permission to view payroll data.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="labor-utilization-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-36" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <Skeleton className="h-14 w-full" />
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-2.5 space-y-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-10" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="labor-utilization-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load labor data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const d = data || { utilizedPercent: 0, workedHours: 0, availableHours: 0, billablePercent: 0, activeWorkers: 0, totalWorkers: 0, sparkline: [] };
  const dateRangeLabel = DATE_RANGE_LABELS[cfg.dateRange || "today"] || "Today";

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="labor-utilization-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-600/5 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <CardTitle className="text-sm font-medium">Labor Utilization</CardTitle>
          </div>
          <span className={cn("text-xs font-semibold", getUtilizationColor(d.utilizedPercent, cfg))} data-testid="utilization-badge">
            {d.utilizedPercent}% — {dateRangeLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Utilization</span>
            <span className={cn("text-2xl font-bold tabular-nums", getUtilizationColor(d.utilizedPercent, cfg))} data-testid="utilization-pct">
              {d.utilizedPercent}%
            </span>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getUtilizationBg(d.utilizedPercent, cfg))}
              style={{ width: `${Math.min(d.utilizedPercent, 100)}%` }}
              data-testid="utilization-bar"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-blue-500/10 p-2.5" data-testid="metric-workers">
            <div className="flex items-center gap-1 mb-1">
              <Users className="w-3 h-3 text-blue-600 dark:text-blue-400" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Workers</span>
            </div>
            <p className="text-lg font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {d.activeWorkers}<span className="text-xs font-normal text-muted-foreground">/{d.totalWorkers}</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">active today</p>
          </div>
          <div className="rounded-lg bg-green-500/10 p-2.5" data-testid="metric-billable">
            <div className="flex items-center gap-1 mb-1">
              <Clock className="w-3 h-3 text-green-600 dark:text-green-400" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Billable</span>
            </div>
            <p className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">
              {d.billablePercent}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">of hrs worked</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5" data-testid="metric-nonbillable">
            <div className="flex items-center gap-1 mb-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Non-Bill</span>
            </div>
            <p className="text-lg font-bold tabular-nums text-muted-foreground">
              {Math.max(0, 100 - d.billablePercent)}%
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">of hrs worked</p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">7-day trend</span>
          </div>
          <SparklineBar sparkline={d.sparkline} cfg={cfg} />
        </div>

        <div className="pt-1 border-t border-border/50">
          <Link href="/workforce" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-workforce-util">
            View workforce management
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
