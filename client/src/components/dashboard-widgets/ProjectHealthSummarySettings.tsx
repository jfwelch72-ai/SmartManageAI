import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export interface ProjectHealthSummaryConfig {
  criticalThreshold: number;
  healthyThreshold: number;
  showOnlyCritical: boolean;
}

export const DEFAULT_PROJECT_HEALTH_CONFIG: ProjectHealthSummaryConfig = {
  criticalThreshold: 50,
  healthyThreshold: 75,
  showOnlyCritical: false,
};

interface ProjectHealthSummarySettingsProps {
  config: ProjectHealthSummaryConfig;
  onChange: (config: ProjectHealthSummaryConfig) => void;
}

export function ProjectHealthSummarySettings({ config, onChange }: ProjectHealthSummarySettingsProps) {
  const cfg = { ...DEFAULT_PROJECT_HEALTH_CONFIG, ...config };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Critical threshold: below {cfg.criticalThreshold}</Label>
        <Slider
          min={10}
          max={60}
          step={5}
          value={[cfg.criticalThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, criticalThreshold: Math.min(v, cfg.healthyThreshold - 10) })}
          data-testid="slider-health-critical-threshold"
        />
        <p className="text-xs text-muted-foreground">
          Projects scoring below this are shown as Critical (red).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Healthy threshold: above {cfg.healthyThreshold}</Label>
        <Slider
          min={40}
          max={95}
          step={5}
          value={[cfg.healthyThreshold]}
          onValueChange={([v]) => onChange({ ...cfg, healthyThreshold: Math.max(v, cfg.criticalThreshold + 10) })}
          data-testid="slider-health-healthy-threshold"
        />
        <p className="text-xs text-muted-foreground">
          Projects scoring above this are shown as Healthy (green).
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="health-show-only-critical">Show only at-risk projects</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Only list projects below the healthy threshold.</p>
        </div>
        <Switch
          id="health-show-only-critical"
          checked={cfg.showOnlyCritical}
          onCheckedChange={(v) => onChange({ ...cfg, showOnlyCritical: v })}
          data-testid="switch-health-show-only-critical"
        />
      </div>
    </div>
  );
}
