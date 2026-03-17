import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileEdit, DollarSign, CheckCircle2, Lock, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { type ChangeOrdersPendingConfig, DEFAULT_CO_PENDING_CONFIG } from "./ChangeOrdersPendingSettings";
import type { WidgetComponentProps } from "./WidgetRegistry";

interface ChangeOrderItem {
  id: string;
  coNumber: number;
  description: string;
  amount: number;
  projectName: string;
  projectCode?: string;
  daysPending: number;
}

interface ChangeOrdersPendingData {
  count: number;
  totalValue: number;
  items: ChangeOrderItem[];
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

export function ChangeOrdersPendingWidget({ config }: WidgetComponentProps) {
  const hasPermission = useFeaturePermission("canAccessFinancials");
  const cfg: ChangeOrdersPendingConfig = { ...DEFAULT_CO_PENDING_CONFIG, ...(config as Partial<ChangeOrdersPendingConfig>) };

  const { data, isLoading, isError } = useQuery<ChangeOrdersPendingData>({
    queryKey: ["/api/dashboard/change-orders-pending"],
    refetchInterval: 120000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="change-orders-pending-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Change Orders Pending</CardTitle>
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
      <Card data-testid="change-orders-pending-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-44" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 items-start py-2 px-2.5 rounded-md">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <div className="text-right space-y-1">
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="h-3 w-6" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="change-orders-pending-error">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load change orders.</p>
        </CardContent>
      </Card>
    );
  }

  const allItems = (data?.items || []).filter(item =>
    !cfg.projectCode ||
    (item.projectCode && item.projectCode === cfg.projectCode) ||
    item.projectName.toLowerCase().includes(cfg.projectCode.toLowerCase())
  );
  const filteredCount = allItems.length;
  const filteredValue = allItems.reduce((sum, item) => sum + item.amount, 0);
  const d = { count: filteredCount, totalValue: filteredValue, items: allItems };

  return (
    <Card data-testid="change-orders-pending-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileEdit className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Change Orders Pending</CardTitle>
          </div>
          {d.count > 0 && (
            <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]" data-testid="co-count-badge">
              {d.count} Pending
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {d.count === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="change-orders-empty">
            <CheckCircle2 className="w-8 h-8 text-green-500 opacity-70 mb-2" />
            <p className="text-sm text-muted-foreground">No pending change orders</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {cfg.projectCode ? `No pending COs for project "${cfg.projectCode}"` : "All submitted change orders have been reviewed"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 mb-1">
              <div className="rounded-lg bg-amber-500/10 p-3" data-testid="metric-co-count">
                <div className="flex items-center gap-1.5 mb-1">
                  <FileEdit className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Pending</span>
                </div>
                <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{d.count}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">awaiting approval</p>
              </div>
              <div className="rounded-lg bg-green-500/10 p-3" data-testid="metric-co-value">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Total Value</span>
                </div>
                <p className="text-xl font-bold tabular-nums text-green-600 dark:text-green-400">{formatCurrency(d.totalValue)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">pending approval</p>
              </div>
            </div>

            <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
              {d.items.slice(0, cfg.showLimit).map((item) => {
                const isOld = item.daysPending > cfg.highlightDaysThreshold;
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-2.5 py-2 px-2.5 rounded-md bg-muted/30 border border-border/50"
                    data-testid={`co-item-${item.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">CO-{item.coNumber}</span>
                        <span className="text-[11px] text-muted-foreground truncate">· {item.projectName}</span>
                      </div>
                      {item.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-semibold text-foreground">{formatCurrency(item.amount)}</p>
                      <p className={cn("text-[11px]", isOld ? "text-red-600 dark:text-red-400" : item.daysPending > Math.floor(cfg.highlightDaysThreshold / 2) ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                        {item.daysPending}d
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <Link href="/projects" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-all-cos">
              View all change orders
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
