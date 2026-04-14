import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { useState, useEffect, useRef } from "react";

function useAnimatedValue(target: number, duration = 800) {
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    const start = prevRef.current;
    const diff = target - start;
    if (diff === 0) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(start + diff * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);
  return value;
}

export interface KPIConfig {
  metric?: string;
  dateRange?: string;
  comparison?: string;
}

export const DEFAULT_KPI_CONFIG: KPIConfig = {
  metric: "ACTIVE_PROJECTS",
  dateRange: "THIS_MONTH",
  comparison: "LAST_MONTH",
};

export const KPI_METRICS = [
  { value: "TOTAL_LABOR_COST", label: "Total Labor Cost", format: "currency" },
  { value: "REVENUE_THIS_MONTH", label: "Revenue This Month", format: "currency" },
  { value: "ACTIVE_PROJECTS", label: "Active Projects", format: "number" },
  { value: "OPEN_RFIS", label: "Open RFIs", format: "number" },
  { value: "OUTSTANDING_PAYABLES", label: "Outstanding Payables", format: "currency" },
  { value: "GROSS_MARGIN", label: "Gross Margin %", format: "percent" },
];

export const KPI_DATE_RANGES = [
  { value: "THIS_WEEK", label: "This Week" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "THIS_QUARTER", label: "This Quarter" },
  { value: "THIS_YEAR", label: "This Year" },
];

export const KPI_COMPARISONS = [
  { value: "LAST_WEEK", label: "vs Last Week" },
  { value: "LAST_MONTH", label: "vs Last Month" },
  { value: "LAST_QUARTER", label: "vs Last Quarter" },
];

function formatValue(value: number, format: string): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
    case "percent":
      return `${value}%`;
    default:
      return value.toLocaleString();
  }
}

interface KPISummaryWidgetProps {
  config?: KPIConfig;
}

export function KPISummaryWidget({ config }: KPISummaryWidgetProps) {
  const hasPermission = useFeaturePermission("canViewFinancials");
  const merged = { ...DEFAULT_KPI_CONFIG, ...config };
  const metricDef = KPI_METRICS.find(m => m.value === merged.metric) || KPI_METRICS[2];

  const { data, isLoading, isError, refetch} = useQuery<{
    value: number;
    previousValue: number;
    changePercent: number;
    label: string;
    dateRangeLabel: string;
    isEstimated: boolean;
  }>({
    queryKey: ["/api/dashboard/kpi", merged.metric, merged.dateRange, merged.comparison],
    enabled: hasPermission,
    queryFn: async () => {
      const params = new URLSearchParams({
        metric: merged.metric || "ACTIVE_PROJECTS",
        dateRange: merged.dateRange || "THIS_MONTH",
        comparison: merged.comparison || "LAST_MONTH",
      });
      const res = await fetch(`/api/dashboard/kpi?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch KPI data");
      return res.json();
    },
    refetchInterval: 120000,
  });

  const comparisonLabel = KPI_COMPARISONS.find(c => c.value === merged.comparison)?.label || "vs previous";
  const animatedValue = useAnimatedValue(data?.value || 0);

  if (!hasPermission) return null;

  if (isLoading) {
    return (
      <Card data-testid="kpi-summary-loading">
        <CardContent className="py-4 px-4 sm:px-6 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="kpi-summary-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load KPI data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const changePercent = data?.changePercent || 0;
  const isPositive = changePercent > 0;
  const isNegative = changePercent < 0;
  const isNeutral = changePercent === 0;

  const MiniSparkline = () => {
    const points = isPositive ? "2,14 6,10 10,12 14,6 18,8 22,2" : isNegative ? "2,2 6,6 10,4 14,10 18,8 22,14" : "2,8 6,8 10,8 14,8 18,8 22,8";
    return (
      <svg width="24" height="16" viewBox="0 0 24 16" className="opacity-60">
        <polyline
          points={points}
          fill="none"
          stroke={isPositive ? "#22c55e" : isNegative ? "#ef4444" : "#94a3b8"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="kpi-summary-card">
      <CardContent className="py-4 px-4 sm:px-6">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground truncate">{data?.label || metricDef.label}</p>
            <p className="text-2xl sm:text-3xl font-bold mt-1 truncate">
              {data ? formatValue(Math.round(animatedValue), metricDef.format) : "--"}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Badge
                variant="secondary"
                className={cn(
                  "text-xs gap-1",
                  isPositive && "bg-green-500/10 text-green-600 dark:text-green-400",
                  isNegative && "bg-red-500/10 text-red-600 dark:text-red-400",
                  isNeutral && "bg-muted text-muted-foreground"
                )}
              >
                {isPositive && <TrendingUp className="w-3 h-3" />}
                {isNegative && <TrendingDown className="w-3 h-3" />}
                {isNeutral && <Minus className="w-3 h-3" />}
                {isPositive ? "+" : ""}{changePercent}%
              </Badge>
              <MiniSparkline />
              <span className="text-[11px] text-muted-foreground">{comparisonLabel}</span>
            </div>
            {data?.isEstimated && (
              <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                <AlertTriangle className="w-3 h-3" />
                Estimated
              </div>
            )}
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground">{data?.dateRangeLabel || ""}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
