import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export interface LaborUtilizationConfig {
  lowThreshold: number;
  goodThreshold: number;
}

export const DEFAULT_LABOR_UTIL_CONFIG: LaborUtilizationConfig = {
  lowThreshold: 50,
  goodThreshold: 80,
};

interface LaborUtilizationSettingsProps {
  config: LaborUtilizationConfig;
  onChange: (config: LaborUtilizationConfig) => void;
}

export function LaborUtilizationSettings({ config, onChange }: LaborUtilizationSettingsProps) {
  const cfg = { ...DEFAULT_LABOR_UTIL_CONFIG, ...config };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Low utilization threshold: {cfg.lowThreshold}%</Label>
        <Slider
          min={10}
          max={70}
          step={5}
          value={[cfg.lowThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, lowThreshold: Math.min(v, cfg.goodThreshold - 5) })}
          data-testid="slider-labor-low-threshold"
        />
        <p className="text-xs text-muted-foreground">
          Below this % utilization is shown in red.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Good utilization threshold: {cfg.goodThreshold}%</Label>
        <Slider
          min={40}
          max={100}
          step={5}
          value={[cfg.goodThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, goodThreshold: Math.max(v, cfg.lowThreshold + 5) })}
          data-testid="slider-labor-good-threshold"
        />
        <p className="text-xs text-muted-foreground">
          Above this % utilization is shown in green.
        </p>
      </div>

      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Below {cfg.lowThreshold}%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" /> {cfg.lowThreshold}–{cfg.goodThreshold}%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> Above {cfg.goodThreshold}%</span>
      </div>
    </div>
  );
}
