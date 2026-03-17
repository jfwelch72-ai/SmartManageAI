import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface SafetyAlertsConfig {
  showLimit: number;
  showDueThisWeek: boolean;
  filterByCategory: string;
}

export const DEFAULT_SAFETY_ALERTS_CONFIG: SafetyAlertsConfig = {
  showLimit: 5,
  showDueThisWeek: true,
  filterByCategory: "",
};

interface SafetyAlertsSettingsProps {
  config: SafetyAlertsConfig;
  onChange: (config: SafetyAlertsConfig) => void;
}

export function SafetyAlertsSettings({ config, onChange }: SafetyAlertsSettingsProps) {
  const cfg = { ...DEFAULT_SAFETY_ALERTS_CONFIG, ...config };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="safety-category-filter">Filter by Category</Label>
        <Input
          id="safety-category-filter"
          placeholder="e.g. OSHA, Fall Protection (leave blank for all)"
          value={cfg.filterByCategory}
          onChange={(e) => onChange({ ...cfg, filterByCategory: e.target.value })}
          data-testid="input-safety-category-filter"
        />
        <p className="text-xs text-muted-foreground">Show overdue items for this training category only. Leave blank to show all.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="safety-show-limit">Max overdue items to display</Label>
        <Select
          value={String(cfg.showLimit)}
          onValueChange={(v) => onChange({ ...cfg, showLimit: Number(v) })}
        >
          <SelectTrigger id="safety-show-limit" data-testid="select-safety-show-limit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 items</SelectItem>
            <SelectItem value="5">5 items</SelectItem>
            <SelectItem value="10">10 items</SelectItem>
            <SelectItem value="20">20 items</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Number of overdue training assignments shown.</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="safety-show-due-week">Show due this week</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Display the "Due Soon" metric in summary.</p>
        </div>
        <Switch
          id="safety-show-due-week"
          checked={cfg.showDueThisWeek}
          onCheckedChange={(v) => onChange({ ...cfg, showDueThisWeek: v })}
          data-testid="switch-safety-show-due-week"
        />
      </div>
    </div>
  );
}
