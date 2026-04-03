import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface DisplayLimitConfig {
  displayLimit: number;
}

export const DEFAULT_DISPLAY_LIMIT_CONFIG: DisplayLimitConfig = {
  displayLimit: 4,
};

interface DisplayLimitSettingsProps {
  config: DisplayLimitConfig;
  onChange: (config: DisplayLimitConfig) => void;
  label?: string;
  defaultLimit?: number;
}

const LIMIT_OPTIONS = [
  { value: "2", label: "2 items" },
  { value: "3", label: "3 items" },
  { value: "4", label: "4 items" },
  { value: "5", label: "5 items" },
  { value: "6", label: "6 items" },
  { value: "8", label: "8 items" },
  { value: "10", label: "10 items" },
];

export function DisplayLimitSettings({ config, onChange, label = "Items to show", defaultLimit = 4 }: DisplayLimitSettingsProps) {
  const currentLimit = config.displayLimit || defaultLimit;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="display-limit" className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground mb-2">Number of items visible before "Show more"</p>
        <Select
          value={String(currentLimit)}
          onValueChange={(value) => onChange({ ...config, displayLimit: parseInt(value, 10) })}
        >
          <SelectTrigger id="display-limit" data-testid="select-display-limit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`option-limit-${opt.value}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
