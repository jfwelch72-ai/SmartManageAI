import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, AlertTriangle, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  type TrendChartConfig,
  DEFAULT_TREND_CONFIG,
  TREND_METRICS,
  TREND_PERIODS,
  TREND_GROUP_BY,
} from "./TrendChartSettings";

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(220, 70%, 50%)",
  "hsl(150, 60%, 40%)",
  "hsl(30, 80%, 50%)",
  "hsl(280, 60%, 50%)",
  "hsl(0, 70%, 50%)",
  "hsl(180, 50%, 40%)",
  "hsl(60, 70%, 40%)",
];

interface TrendPoint {
  date: string;
  value: number;
  group?: string;
}

interface TrendResponse {
  points: TrendPoint[];
  metric: string;
  period: string;
  groupBy: string;
}

function formatMetricValue(value: number, metric: string): string {
  switch (metric) {
    case "LABOR_COST":
    case "REVENUE":
    case "CASH_FLOW":
      if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
      if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}K`;
      return `$${value.toFixed(0)}`;
    case "BID_WIN_RATE":
      return `${value.toFixed(1)}%`;
    case "OVERTIME_HOURS":
      return `${value.toFixed(1)}h`;
    default:
      return value.toLocaleString();
  }
}

function formatDateLabel(dateStr: string): string {
  if (!dateStr) return "";
  if (dateStr.includes("-W")) {
    return dateStr.replace(/(\d{4})-W(\d+)/, "W$2");
  }
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [year, month] = dateStr.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("en-US", { month: "short" });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return dateStr;
}

interface TrendChartWidgetProps {
  config?: TrendChartConfig;
}

export function TrendChartWidget({ config }: TrendChartWidgetProps) {
  const merged = { ...DEFAULT_TREND_CONFIG, ...config };
  const metricDef = TREND_METRICS.find(m => m.value === merged.metric) || TREND_METRICS[0];
  const periodDef = TREND_PERIODS.find(p => p.value === merged.period) || TREND_PERIODS[1];
  const groupDef = TREND_GROUP_BY.find(g => g.value === merged.groupBy) || TREND_GROUP_BY[0];

  const { data, isLoading, isError, refetch} = useQuery<TrendResponse>({
    queryKey: ["/api/dashboard/trend", merged.metric, merged.period, merged.groupBy],
    queryFn: async () => {
      const params = new URLSearchParams({
        metric: merged.metric || "LABOR_COST",
        period: merged.period || "30D",
        groupBy: merged.groupBy || "NONE",
      });
      const res = await fetch(`/api/dashboard/trend?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch trend data");
      return res.json();
    },
    refetchInterval: 120000,
  });

  if (isLoading) {
    return (
      <Card data-testid="trend-chart-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="trend-chart-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load trend data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const points = data?.points || [];
  const groups = merged.groupBy !== "NONE"
    ? [...new Set(points.map(p => p.group).filter(Boolean))]
    : null;

  let chartData: Record<string, any>[];
  let seriesKeys: string[];

  if (groups && groups.length > 0) {
    const dateMap = new Map<string, Record<string, any>>();
    points.forEach(p => {
      if (!dateMap.has(p.date)) {
        dateMap.set(p.date, { date: p.date });
      }
      const entry = dateMap.get(p.date)!;
      const groupName = p.group || "Unknown";
      entry[groupName] = p.value;
    });
    chartData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    seriesKeys = groups as string[];
  } else {
    chartData = points
      .map(p => ({ date: p.date, value: p.value }))
      .sort((a, b) => a.date.localeCompare(b.date));
    seriesKeys = ["value"];
  }

  const isEmpty = chartData.length === 0;

  const ChartIcon = merged.chartType === "bar" ? BarChart3 : TrendingUp;

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="trend-chart-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-600/5 flex items-center justify-center">
              <ChartIcon className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <CardTitle className="text-sm font-medium">{metricDef.label}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="text-[10px]" data-testid="badge-trend-period">
              {periodDef.label}
            </Badge>
            {merged.groupBy !== "NONE" && (
              <Badge variant="outline" className="text-[10px]" data-testid="badge-trend-group">
                {groupDef.label}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground" data-testid="trend-chart-empty">
            <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center mb-3">
              <AlertTriangle className="w-7 h-7 opacity-40" />
            </div>
            <p className="text-sm font-medium">No data available</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">Try adjusting the period or metric</p>
          </div>
        ) : (
          <div className="h-56 w-full" data-testid="trend-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              {merged.chartType === "bar" ? (
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    {seriesKeys.map((key, i) => (
                      <linearGradient key={`grad-${key}`} id={`bar-gradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.6} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={formatDateLabel}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatMetricValue(v, merged.metric!)}
                    width={60}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => formatMetricValue(value, merged.metric!)}
                    labelFormatter={formatDateLabel}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {seriesKeys.map((key, i) => (
                    <Bar
                      key={key}
                      dataKey={key}
                      name={key === "value" ? metricDef.label : key}
                      fill={`url(#bar-gradient-${i})`}
                      radius={[4, 4, 0, 0]}
                      animationDuration={800}
                      animationEasing="ease-out"
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <defs>
                    {seriesKeys.map((key, i) => (
                      <linearGradient key={`area-${key}`} id={`line-gradient-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.15} />
                        <stop offset="100%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-20" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={formatDateLabel}
                    interval="preserveStartEnd"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatMetricValue(v, merged.metric!)}
                    width={60}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: number) => formatMetricValue(value, merged.metric!)}
                    labelFormatter={formatDateLabel}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  {seriesKeys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  {seriesKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={key === "value" ? metricDef.label : key}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2.5}
                      dot={{ r: 3, strokeWidth: 2, fill: 'var(--background)' }}
                      activeDot={{ r: 6, strokeWidth: 2, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                      animationDuration={800}
                      animationEasing="ease-out"
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
