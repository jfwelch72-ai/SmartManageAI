import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, FileText, DollarSign, Target, HardHat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

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
  const { data, isLoading } = useQuery<BidPipeline>({
    queryKey: ["/api/dashboard/bid-pipeline"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="bid-pipeline-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-28 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-muted/50 p-3 space-y-2">
                <div className="h-3 w-16 bg-muted rounded" />
                <div className="h-6 w-14 bg-muted rounded" />
                <div className="h-2.5 w-20 bg-muted rounded" />
              </div>
            ))}
          </div>
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

  return (
    <Card data-testid="bid-pipeline-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-muted-foreground" />
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
                className={cn("rounded-lg p-3 transition-colors", metric.bg)}
                data-testid={`bid-metric-${metric.key}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn("w-3.5 h-3.5", metric.iconColor)} />
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
      </CardContent>
    </Card>
  );
}
