import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Clock, DollarSign, UserMinus, HardHat, Lock } from "lucide-react";
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

  const { data, isLoading } = useQuery<WorkforceSnapshot>({
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
          <div className="animate-pulse h-4 w-32 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-12 bg-muted rounded" />
                <div className="h-2.5 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const snapshot = data || { activeWorkers: 0, totalWorkers: 0, overtimePercent: 0, laborCostToday: 0, absentWorkers: 0 };

  const metrics = [
    {
      key: "active",
      label: "Active Workers",
      value: snapshot.activeWorkers,
      formatted: String(snapshot.activeWorkers),
      subtitle: "on site today",
      icon: Users,
      iconColor: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      key: "overtime",
      label: "Overtime",
      value: snapshot.overtimePercent,
      formatted: `${snapshot.overtimePercent.toFixed(1)}%`,
      subtitle: "of total hours",
      icon: Clock,
      iconColor: getOvertimeColor(snapshot.overtimePercent),
      bg: getOvertimeBg(snapshot.overtimePercent),
    },
    {
      key: "labor-cost",
      label: "Labor Cost",
      value: snapshot.laborCostToday,
      formatted: formatCurrency(snapshot.laborCostToday),
      subtitle: "today",
      icon: DollarSign,
      iconColor: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      key: "absent",
      label: "Absent",
      value: snapshot.absentWorkers,
      formatted: String(snapshot.absentWorkers),
      subtitle: `of ${snapshot.totalWorkers} workers`,
      icon: UserMinus,
      iconColor: getAbsentColor(snapshot.absentWorkers, snapshot.totalWorkers),
      bg: getAbsentBg(snapshot.absentWorkers, snapshot.totalWorkers),
    },
  ];

  return (
    <Card data-testid="workforce-snapshot-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <HardHat className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">Workforce Snapshot</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.key}
                className={cn("rounded-lg p-3 transition-colors", metric.bg)}
                data-testid={`metric-${metric.key}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn("w-3.5 h-3.5", metric.iconColor)} />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{metric.label}</span>
                </div>
                <p className={cn("text-xl font-bold tabular-nums", metric.iconColor)}>
                  {metric.formatted}
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
