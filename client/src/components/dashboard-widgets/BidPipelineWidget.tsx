import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, FileText, DollarSign, Target, HardHat, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { canAccessBids } from "@/lib/rbac";

interface BidPipeline {
  activeBids: number;
  pipelineValue: number;
  winRate: number;
  laborExposure: number;
  awardedCount: number;
  lostCount: number;
}

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `$${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `$${(abs / 1000).toFixed(1)}K`;
  return `$${abs.toFixed(0)}`;
}

export function BidPipelineWidget() {
  const { user } = useAuth();
  const hasAccess = canAccessBids(user?.role);
  const { data, isLoading, isError, refetch} = useQuery<BidPipeline>({
    queryKey: ["/api/dashboard/bid-pipeline"],
    refetchInterval: 300000,
    enabled: hasAccess,
  });

  if (!hasAccess) return null;

  if (isLoading) {
    return (
      <Card data-testid="bid-pipeline-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-14" />
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
      <Card data-testid="bid-pipeline-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load bid pipeline.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const d = data || { activeBids: 0, pipelineValue: 0, winRate: 0, laborExposure: 0, awardedCount: 0, lostCount: 0 };
  const isEmpty = d.activeBids === 0 && d.awardedCount === 0 && d.lostCount === 0;

  if (isEmpty) {
    return (
      <Card data-testid="bid-pipeline-widget">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Bid Pipeline</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="bid-pipeline-empty">
            <Briefcase className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No bids in the pipeline</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Bid metrics will appear here once bids are created</p>
          </div>
          <div className="pt-2.5 border-t border-border/50">
            <Link href="/bids" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-all-bids">
              View all bids
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const metrics = [
    {
      key: "active",
      label: "Active Bids",
      value: String(d.activeBids),
      subtitle: "currently in progress",
      icon: FileText,
      iconColor: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      key: "pipeline",
      label: "Pipeline Value",
      value: formatCurrency(d.pipelineValue),
      subtitle: "total active bid value",
      icon: DollarSign,
      iconColor: "text-green-600 dark:text-green-400",
      bg: "bg-green-500/10",
    },
    {
      key: "winrate",
      label: "Win Rate",
      value: `${d.winRate.toFixed(1)}%`,
      subtitle: `${d.awardedCount}W / ${d.lostCount}L`,
      icon: Target,
      iconColor: d.winRate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-orange-600 dark:text-orange-400",
      bg: d.winRate >= 50 ? "bg-amber-500/10" : "bg-orange-500/10",
    },
    {
      key: "labor",
      label: "Labor Exposure",
      value: formatCurrency(d.laborExposure),
      subtitle: "estimated labor on active bids",
      icon: HardHat,
      iconColor: "text-indigo-600 dark:text-indigo-400",
      bg: "bg-indigo-500/10",
    },
  ];

  const winRateWidth = Math.min(Math.max(d.winRate, 0), 100);

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="bid-pipeline-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-600/5 flex items-center justify-center">
            <Briefcase className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-sm font-medium">Bid Pipeline</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={metric.key}
                className={cn("rounded-xl p-3 transition-all duration-200 hover:scale-[1.02]", metric.bg)}
                data-testid={`bid-metric-${metric.key}`}
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
                {metric.key === "winrate" ? (
                  <div className="mt-1.5">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-700"
                        style={{ width: `${winRateWidth}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{metric.subtitle}</p>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{metric.subtitle}</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 pt-2.5 border-t border-border/50">
          <Link href="/bids" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-view-all-bids">
            View all bids
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
