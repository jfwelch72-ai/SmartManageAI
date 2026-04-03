import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  DollarSign,
  CheckCircle2,
  CloudRain,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useLocation } from "wouter";
import { useDashboardStats, useProjects } from "@/hooks/use-data";
import { useMemo, useState } from "react";

interface OutstandingItem {
  key: string;
  icon: typeof AlertTriangle;
  iconColor: string;
  label: string;
  count: number;
  path: string;
}

export function OutstandingItemsWidget({ config }: { config?: Record<string, unknown> }) {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useDashboardStats();
  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } = useProjects();
  const [showAll, setShowAll] = useState(false);
  const displayLimit = (config?.displayLimit as number) || 3;

  const isLoading = statsLoading || projectsLoading;
  const isError = statsError || projectsError;

  const projectsMissingBudget = useMemo(() => {
    return projects.filter((p) => {
      const budgetNum = Number(p.budget);
      return !p.budget || isNaN(budgetNum) || budgetNum <= 0;
    });
  }, [projects]);

  const items = useMemo<OutstandingItem[]>(() => {
    const result: OutstandingItem[] = [];
    if (stats?.pendingChangeOrdersCount) {
      result.push({ key: "change-orders", icon: AlertTriangle, iconColor: "text-yellow-500", label: "Pending Change Orders", count: stats.pendingChangeOrdersCount, path: "/projects?changeOrders=pending" });
    }
    if (stats?.pendingTimeOffCount) {
      result.push({ key: "timeoff", icon: CalendarClock, iconColor: "text-blue-500", label: "Pending Leave Requests", count: stats.pendingTimeOffCount, path: "/leave-management" });
    }
    if (projectsMissingBudget.length > 0) {
      result.push({ key: "missing-budget", icon: DollarSign, iconColor: "text-orange-500", label: "Missing Budget Data", count: projectsMissingBudget.length, path: "/projects?filter=missingBudget" });
    }
    if (stats?.delaysNeedingAckCount) {
      result.push({ key: "delays-ack", icon: CloudRain, iconColor: "text-blue-500", label: "Delays Awaiting Acknowledgment", count: stats.delaysNeedingAckCount, path: "/projects?filter=delaysNeedingAck" });
    }
    if (stats?.delaysNeedingChangeOrderCount) {
      result.push({ key: "delays-co", icon: AlertTriangle, iconColor: "text-red-500", label: "Delays Needing Change Order", count: stats.delaysNeedingChangeOrderCount, path: "/projects?filter=delaysNeedingCO" });
    }
    return result;
  }, [stats, projectsMissingBudget]);

  const displayedItems = showAll ? items : items.slice(0, displayLimit);
  const hasMore = items.length > displayLimit;

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-outstanding-items">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <Skeleton className="h-4 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-md">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 shrink-0" />
                <Skeleton className="h-3.5 w-40" />
              </div>
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-outstanding-items-error">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Outstanding Items
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load outstanding items.</p>
          <Button variant="outline" size="sm" onClick={() => { refetchStats(); refetchProjects(); }} data-testid="button-retry-outstanding">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full" data-testid="card-outstanding-items">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Outstanding Items
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {displayedItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
                onClick={() => setLocation(item.path)}
                data-testid={`outstanding-${item.key}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${item.iconColor}`} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <Badge variant="secondary">{item.count}</Badge>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 text-center" data-testid="outstanding-items-empty">
              <CheckCircle2 className="w-6 h-6 text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">All caught up! No outstanding items.</p>
            </div>
          )}

          {hasMore && !showAll && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setShowAll(true)}
              data-testid="button-show-more-outstanding"
            >
              <ChevronDown className="w-3.5 h-3.5 mr-1" />
              Show {items.length - displayLimit} more
            </Button>
          )}
          {showAll && hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setShowAll(false)}
              data-testid="button-show-less-outstanding"
            >
              <ChevronUp className="w-3.5 h-3.5 mr-1" />
              Show less
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
