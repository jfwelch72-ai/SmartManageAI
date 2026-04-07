import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Clock, DollarSign, UserMinus, HardHat, Lock, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";

interface WorkforceSnapshot {
  activeWorkers: number;
  totalWorkers: number;
  overtimePercent: number;
  laborCostToday: number;
  absentWorkers: number;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function getOvertimeColor(pct: number): string {
  if (pct > 20) return "text-red-600 dark:text-red-400";
  if (pct > 10) return "text-yellow-600 dark:text-yellow-500";
  return "text-green-600 dark:text-green-400";
}

function getOvertimeBg(pct: number): string {
  if (pct > 20) return "bg-red-500/10";
  if (pct > 10) return "bg-yellow-500/10";
  return "bg-green-500/10";
}

function getAbsentColor(absent: number, total: number): string {
  if (total === 0) return "text-muted-foreground";
  const pct = (absent / total) * 100;
  if (pct > 30) return "text-red-600 dark:text-red-400";
  if (pct > 15) return "text-yellow-600 dark:text-yellow-500";
  return "text-green-600 dark:text-green-400";
}

function getAbsentBg(absent: number, total: number): string {
  if (total === 0) return "bg-muted/50";
  const pct = (absent / total) * 100;
  if (pct > 30) return "bg-red-500/10";
  if (pct > 15) return "bg-yellow-500/10";
  return "bg-green-500/10";
}

export function WorkforceSnapshotWidget() {
  const hasPermission = useFeaturePermission("canManagePayroll");

  const { data, isLoading, isError, refetch} = useQuery<WorkforceSnapshot>({
    queryKey: ["/api/dashboard/workforce-snapshot"],
    refetchInterval: 120000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="workforce-snapshot-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Workforce Snapshot</CardTitle>
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
      <Card data-testid="workforce-snapshot-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="workforce-snapshot-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load workforce data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const snapshot = data || { activeWorkers: 0, totalWorkers: 0, overtimePercent: 0, laborCostToday: 0, absentWorkers: 0 };

  const metrics = [
    {
      key: "active",
      label: "Active Workers",
      value: String(snapshot.activeWorkers),
      subtitle: "on site today",
      icon: Users,
      iconColor: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      key: "overtime",
      label: "Overtime",
      value: `${snapshot.overtimePercent.toFixed(1)}%`,
      subtitle: "of total hours",
      icon: Clock,
      iconColor: getOvertimeColor(snapshot.overtimePercent),
      bg: getOvertimeBg(snapshot.overtimePercent),
    },
    {
      key: "labor-cost",
      label: "Labor Cost",
      value: formatCurrency(snapshot.laborCostToday),
      subtitle: "today",
      icon: DollarSign,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      key: "absent",
      label: "Absent",
      value: String(snapshot.absentWorkers),
      subtitle: `of ${snapshot.totalWorkers} workers`,
      icon: UserMinus,
      iconColor: getAbsentColor(snapshot.absentWorkers, snapshot.totalWorkers),
      bg: getAbsentBg(snapshot.absentWorkers, snapshot.totalWorkers),
    },
  ];

  const activeRatio = snapshot.totalWorkers > 0 ? (snapshot.activeWorkers / snapshot.totalWorkers) * 100 : 0;

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="workforce-snapshot-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-600/5 flex items-center justify-center">
            <HardHat className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-sm font-medium">Workforce Snapshot</CardTitle>
          {snapshot.totalWorkers > 0 && (
            <span className="text-[10px] text-muted-foreground ml-auto">{Math.round(activeRatio)}% active</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {snapshot.totalWorkers > 0 && (
          <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-700"
              style={{ width: `${activeRatio}%` }}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.key}
                className={cn("rounded-xl p-3 transition-all duration-200 hover:scale-[1.02]", metric.bg)}
                data-testid={`metric-${metric.key}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-6 h-6 rounded-md bg-white/60 dark:bg-white/10 flex items-center justify-center">
                    <Icon className={cn("w-3 h-3", metric.iconColor)} />
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                </div>
                <p className={cn("text-xl font-bold tabular-nums", metric.iconColor)}>
                  {metric.value}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{metric.subtitle}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2.5 border-t border-border/50">
          <Link href="/workforce" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-workforce">
            View workforce management
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
