import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

export interface ChangeOrdersPendingConfig {
  showLimit: number;
  highlightDaysThreshold: number;
}

export const DEFAULT_CO_PENDING_CONFIG: ChangeOrdersPendingConfig = {
  showLimit: 5,
  highlightDaysThreshold: 7,
};

interface ChangeOrdersPendingSettingsProps {
  config: ChangeOrdersPendingConfig;
  onChange: (config: ChangeOrdersPendingConfig) => void;
}

export function ChangeOrdersPendingSettings({ config, onChange }: ChangeOrdersPendingSettingsProps) {
  const cfg = { ...DEFAULT_CO_PENDING_CONFIG, ...config };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="co-show-limit">Max change orders to display</Label>
        <Select
          value={String(cfg.showLimit)}
          onValueChange={(v) => onChange({ ...cfg, showLimit: Number(v) })}
        >
          <SelectTrigger id="co-show-limit" data-testid="select-co-show-limit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 items</SelectItem>
            <SelectItem value="5">5 items</SelectItem>
            <SelectItem value="10">10 items</SelectItem>
            <SelectItem value="20">20 items</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Number of pending COs shown in the list.</p>
      </div>

      <div className="space-y-2">
        <Label>Age alert threshold: {cfg.highlightDaysThreshold} days</Label>
        <Slider
          min={3}
          max={30}
          step={1}
          value={[cfg.highlightDaysThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, highlightDaysThreshold: v })}
          data-testid="slider-co-days-threshold"
        />
        <p className="text-xs text-muted-foreground">
          Change orders pending longer than this are highlighted in red.
        </p>
      </div>
    </div>
  );
}
