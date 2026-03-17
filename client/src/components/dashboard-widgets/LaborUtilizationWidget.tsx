import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Users, Clock, TrendingUp, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

interface LaborUtilization {
  utilizedPercent: number;
  workedHours: number;
  availableHours: number;
  billablePercent: number;
  activeWorkers: number;
  totalWorkers: number;
  sparkline: { date: string; utilizedPercent: number }[];
}

function getUtilizationColor(pct: number): string {
  if (pct >= 80) return "text-green-600 dark:text-green-400";
  if (pct >= 50) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getUtilizationBg(pct: number): string {
  if (pct >= 80) return "bg-green-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function SparklineBar({ sparkline }: { sparkline: { date: string; utilizedPercent: number }[] }) {
  if (!sparkline || sparkline.length === 0) return null;
  const max = Math.max(...sparkline.map(s => s.utilizedPercent), 1);
  return (
    <div className="flex items-end gap-0.5 h-8" data-testid="sparkline-bars">
      {sparkline.map((s, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-sm min-h-[2px] transition-all", getUtilizationBg(s.utilizedPercent), "opacity-70")}
          style={{ height: `${Math.max((s.utilizedPercent / max) * 100, 5)}%` }}
          title={`${new Date(s.date).toLocaleDateString(undefined, { weekday: "short" })}: ${s.utilizedPercent}%`}
        />
      ))}
    </div>
  );
}

export function LaborUtilizationWidget() {
  const hasPermission = useFeaturePermission("canManagePayroll");

  const { data, isLoading } = useQuery<LaborUtilization>({
    queryKey: ["/api/dashboard/labor-utilization"],
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
          <div className="animate-pulse h-4 w-36 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="animate-pulse h-14 w-full bg-muted rounded" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-12 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const d = data || { utilizedPercent: 0, workedHours: 0, availableHours: 0, billablePercent: 0, activeWorkers: 0, totalWorkers: 0, sparkline: [] };

  return (
    <Card data-testid="labor-utilization-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Labor Utilization</CardTitle>
          </div>
          <span className={cn("text-xs font-semibold", getUtilizationColor(d.utilizedPercent))} data-testid="utilization-badge">
            {d.utilizedPercent}% Today
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground">Utilization</span>
            <span className={cn("text-2xl font-bold tabular-nums", getUtilizationColor(d.utilizedPercent))} data-testid="utilization-pct">
              {d.utilizedPercent}%
            </span>
          </div>
          <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getUtilizationBg(d.utilizedPercent))}
              style={{ width: `${Math.min(d.utilizedPercent, 100)}%` }}
              data-testid="utilization-bar"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-blue-500/10 p-3" data-testid="metric-workers">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Workers</span>
            </div>
            <p className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
              {d.activeWorkers}<span className="text-sm font-normal text-muted-foreground">/{d.totalWorkers}</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">active today</p>
          </div>
          <div className="rounded-lg bg-purple-500/10 p-3" data-testid="metric-billable">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Billable</span>
            </div>
            <p className="text-xl font-bold tabular-nums text-purple-600 dark:text-purple-400">
              {d.billablePercent}%
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">of worked hours</p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="w-3 h-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">7-day trend</span>
          </div>
          <SparklineBar sparkline={d.sparkline} />
        </div>
      </CardContent>
    </Card>
  );
}
