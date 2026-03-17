import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { type SafetyAlertsConfig, DEFAULT_SAFETY_ALERTS_CONFIG } from "./SafetyAlertsSettings";
import type { WidgetComponentProps } from "./WidgetRegistry";

interface SafetySummaryData {
  overdueCount: number;
  dueThisWeekCount: number;
  completionRate: number;
  total: number;
  completed: number;
  overdueItems: {
    id: string;
    employeeName: string;
    trainingTitle: string;
    dueDate: string;
    daysOverdue: number;
  }[];
}

function getDaysOverdueColor(days: number): string {
  if (days >= 14) return "text-red-600 dark:text-red-400";
  if (days >= 7) return "text-orange-600 dark:text-orange-400";
  return "text-amber-600 dark:text-amber-500";
}

export function SafetyAlertsWidget({ config }: WidgetComponentProps) {
  const cfg: SafetyAlertsConfig = { ...DEFAULT_SAFETY_ALERTS_CONFIG, ...(config as Partial<SafetyAlertsConfig>) };

  const { data, isLoading } = useQuery<SafetySummaryData>({
    queryKey: ["/api/dashboard/safety-summary"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="safety-alerts-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-36 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="animate-pulse grid grid-cols-2 gap-3">
            <div className="h-14 bg-muted/50 rounded-lg" />
            <div className="h-14 bg-muted/50 rounded-lg" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse flex gap-3 items-start">
              <div className="h-4 w-4 rounded bg-muted shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const d = data || { overdueCount: 0, dueThisWeekCount: 0, completionRate: 0, total: 0, completed: 0, overdueItems: [] };

  return (
    <Card data-testid="safety-alerts-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Safety Training</CardTitle>
          </div>
          {d.overdueCount > 0 && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-700 dark:text-red-400 text-[10px]" data-testid="overdue-badge">
              {d.overdueCount} Overdue
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {d.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="safety-empty">
            <CheckCircle2 className="w-8 h-8 text-green-500 opacity-70 mb-2" />
            <p className="text-sm text-muted-foreground">No training assignments yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Create safety trainings and assign them to employees</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className={cn("grid gap-2", cfg.showDueThisWeek ? "grid-cols-3" : "grid-cols-2")}>
              <div className="rounded-lg bg-green-500/10 p-2 text-center" data-testid="metric-completion-rate">
                <p className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">{d.completionRate}%</p>
                <p className="text-[10px] text-muted-foreground">Complete</p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-2 text-center" data-testid="metric-overdue-count">
                <p className={cn("text-lg font-bold tabular-nums", d.overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{d.overdueCount}</p>
                <p className="text-[10px] text-muted-foreground">Overdue</p>
              </div>
              {cfg.showDueThisWeek && (
                <div className="rounded-lg bg-amber-500/10 p-2 text-center" data-testid="metric-due-this-week">
                  <p className={cn("text-lg font-bold tabular-nums", d.dueThisWeekCount > 0 ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>{d.dueThisWeekCount}</p>
                  <p className="text-[10px] text-muted-foreground">Due Soon</p>
                </div>
              )}
            </div>

            <div className="space-y-0.5 mb-1">
              <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                <span>{d.completed} of {d.total} completed</span>
                <span>{d.completionRate}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", d.completionRate >= 80 ? "bg-green-500" : d.completionRate >= 50 ? "bg-amber-500" : "bg-red-500")}
                  style={{ width: `${d.completionRate}%` }}
                  data-testid="completion-progress-bar"
                />
              </div>
            </div>

            {d.overdueItems.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Overdue</p>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                  {d.overdueItems.slice(0, cfg.showLimit).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2.5 py-2 px-2.5 rounded-md bg-red-500/5 border border-red-200 dark:border-red-800/40"
                      data-testid={`overdue-item-${item.id}`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{item.employeeName}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{item.trainingTitle}</p>
                      </div>
                      <span className={cn("text-[11px] font-medium shrink-0", getDaysOverdueColor(item.daysOverdue))}>
                        {item.daysOverdue}d ago
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link href="/safety-training" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-safety-training">
              Manage safety training
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
