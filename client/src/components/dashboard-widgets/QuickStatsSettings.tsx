import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface QuickStatsConfig {
  showActiveProjects?: boolean;
  showActiveBids?: boolean;
  showUnreadMessages?: boolean;
  showUpcomingEvents?: boolean;
}

export const DEFAULT_QUICK_STATS_CONFIG: QuickStatsConfig = {
  showActiveProjects: true,
  showActiveBids: true,
  showUnreadMessages: true,
  showUpcomingEvents: true,
};

interface QuickStatsSettingsProps {
  config: QuickStatsConfig;
  onChange: (config: QuickStatsConfig) => void;
}

const STAT_OPTIONS = [
  { key: "showActiveProjects" as const, label: "Active Projects" },
  { key: "showActiveBids" as const, label: "Active Bids" },
  { key: "showUnreadMessages" as const, label: "Unread Messages" },
  { key: "showUpcomingEvents" as const, label: "Upcoming Events" },
];

export function QuickStatsSettings({ config, onChange }: QuickStatsSettingsProps) {
  const merged = { ...DEFAULT_QUICK_STATS_CONFIG, ...config };
  const enabledCount = STAT_OPTIONS.filter(opt => merged[opt.key] !== false).length;

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium mb-1">Visible Stats</h4>
        <p className="text-xs text-muted-foreground mb-3">Choose which stat cards to display ({enabledCount} of {STAT_OPTIONS.length} shown)</p>
        <div className="space-y-3">
          {STAT_OPTIONS.map((opt) => (
            <div key={opt.key} className="flex items-center justify-between">
              <Label htmlFor={`stat-${opt.key}`} className="text-sm cursor-pointer">{opt.label}</Label>
              <Switch
                id={`stat-${opt.key}`}
                checked={merged[opt.key] !== false}
                onCheckedChange={(checked) => {
                  if (!checked && enabledCount <= 1) return;
                  onChange({ ...merged, [opt.key]: checked });
                }}
                data-testid={`switch-${opt.key}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
