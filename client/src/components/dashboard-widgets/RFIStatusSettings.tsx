import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

export interface RFIStatusConfig {
  showLimit: number;
  highlightDaysThreshold: number;
}

export const DEFAULT_RFI_STATUS_CONFIG: RFIStatusConfig = {
  showLimit: 5,
  highlightDaysThreshold: 7,
};

interface RFIStatusSettingsProps {
  config: RFIStatusConfig;
  onChange: (config: RFIStatusConfig) => void;
}

export function RFIStatusSettings({ config, onChange }: RFIStatusSettingsProps) {
  const cfg = { ...DEFAULT_RFI_STATUS_CONFIG, ...config };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="rfi-show-limit">Max RFIs to display</Label>
        <Select
          value={String(cfg.showLimit)}
          onValueChange={(v) => onChange({ ...cfg, showLimit: Number(v) })}
        >
          <SelectTrigger id="rfi-show-limit" data-testid="select-rfi-show-limit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3">3 items</SelectItem>
            <SelectItem value="5">5 items</SelectItem>
            <SelectItem value="10">10 items</SelectItem>
            <SelectItem value="20">20 items</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Number of open RFIs shown in the list.</p>
      </div>

      <div className="space-y-2">
        <Label>Age alert threshold: {cfg.highlightDaysThreshold} days</Label>
        <Slider
          min={3}
          max={30}
          step={1}
          value={[cfg.highlightDaysThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, highlightDaysThreshold: v })}
          data-testid="slider-rfi-days-threshold"
        />
        <p className="text-xs text-muted-foreground">
          RFIs open longer than this many days are highlighted in red.
        </p>
      </div>
    </div>
  );
}
