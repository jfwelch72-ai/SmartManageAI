import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface TrendChartConfig {
  metric?: string;
  chartType?: string;
  period?: string;
  groupBy?: string;
}

export const DEFAULT_TREND_CONFIG: TrendChartConfig = {
  metric: "LABOR_COST",
  chartType: "line",
  period: "30D",
  groupBy: "NONE",
};

export const TREND_METRICS = [
  { value: "LABOR_COST", label: "Labor Cost" },
  { value: "REVENUE", label: "Revenue" },
  { value: "BID_WIN_RATE", label: "Bid Win Rate" },
  { value: "OVERTIME_HOURS", label: "Overtime Hours" },
  { value: "CASH_FLOW", label: "Cash Flow" },
];

export const TREND_CHART_TYPES = [
  { value: "line", label: "Line Chart" },
  { value: "bar", label: "Bar Chart" },
];

export const TREND_PERIODS = [
  { value: "7D", label: "Last 7 Days" },
  { value: "30D", label: "Last 30 Days" },
  { value: "90D", label: "Last 90 Days" },
  { value: "6M", label: "Last 6 Months" },
  { value: "1Y", label: "Last Year" },
];

export const TREND_GROUP_BY = [
  { value: "NONE", label: "None (Aggregate)" },
  { value: "PROJECT", label: "By Project" },
  { value: "TRADE", label: "By Trade" },
];

interface TrendChartSettingsProps {
  config: TrendChartConfig;
  onChange: (config: TrendChartConfig) => void;
}

export function TrendChartSettings({ config, onChange }: TrendChartSettingsProps) {
  const merged = { ...DEFAULT_TREND_CONFIG, ...config };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Metric</Label>
        <Select value={merged.metric} onValueChange={(v) => onChange({ ...merged, metric: v })}>
          <SelectTrigger data-testid="select-trend-metric">
            <SelectValue placeholder="Select metric" />
          </SelectTrigger>
          <SelectContent>
            {TREND_METRICS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Chart Type</Label>
        <Select value={merged.chartType} onValueChange={(v) => onChange({ ...merged, chartType: v })}>
          <SelectTrigger data-testid="select-trend-chart-type">
            <SelectValue placeholder="Select chart type" />
          </SelectTrigger>
          <SelectContent>
            {TREND_CHART_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Time Period</Label>
        <Select value={merged.period} onValueChange={(v) => onChange({ ...merged, period: v })}>
          <SelectTrigger data-testid="select-trend-period">
            <SelectValue placeholder="Select time period" />
          </SelectTrigger>
          <SelectContent>
            {TREND_PERIODS.map(p => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Group By</Label>
        <Select value={merged.groupBy} onValueChange={(v) => onChange({ ...merged, groupBy: v })}>
          <SelectTrigger data-testid="select-trend-group-by">
            <SelectValue placeholder="Select grouping" />
          </SelectTrigger>
          <SelectContent>
            {TREND_GROUP_BY.map(g => (
              <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
