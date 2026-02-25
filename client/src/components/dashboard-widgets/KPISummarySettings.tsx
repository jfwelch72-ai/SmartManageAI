import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KPI_METRICS, KPI_DATE_RANGES, KPI_COMPARISONS, type KPIConfig, DEFAULT_KPI_CONFIG } from "./KPISummaryWidget";
export { DEFAULT_KPI_CONFIG, type KPIConfig };

interface KPISummarySettingsProps {
  config: KPIConfig;
  onChange: (config: KPIConfig) => void;
}

export function KPISummarySettings({ config, onChange }: KPISummarySettingsProps) {
  const merged = { ...DEFAULT_KPI_CONFIG, ...config };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm">Metric</Label>
        <Select value={merged.metric} onValueChange={(v) => onChange({ ...merged, metric: v })}>
          <SelectTrigger data-testid="select-kpi-metric">
            <SelectValue placeholder="Select metric" />
          </SelectTrigger>
          <SelectContent>
            {KPI_METRICS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Date Range</Label>
        <Select value={merged.dateRange} onValueChange={(v) => onChange({ ...merged, dateRange: v })}>
          <SelectTrigger data-testid="select-kpi-date-range">
            <SelectValue placeholder="Select date range" />
          </SelectTrigger>
          <SelectContent>
            {KPI_DATE_RANGES.map(d => (
              <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Comparison</Label>
        <Select value={merged.comparison} onValueChange={(v) => onChange({ ...merged, comparison: v })}>
          <SelectTrigger data-testid="select-kpi-comparison">
            <SelectValue placeholder="Select comparison" />
          </SelectTrigger>
          <SelectContent>
            {KPI_COMPARISONS.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
