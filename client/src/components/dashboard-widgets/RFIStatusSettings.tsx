import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useQuery } from "@tanstack/react-query";

export interface RFIStatusConfig {
  showLimit: number;
  highlightDaysThreshold: number;
  projectId: string;
}

export const DEFAULT_RFI_STATUS_CONFIG: RFIStatusConfig = {
  showLimit: 5,
  highlightDaysThreshold: 7,
  projectId: "",
};

interface ProjectRef {
  id: string;
  name: string;
  code?: string;
}

interface RFIStatusSettingsProps {
  config: RFIStatusConfig;
  onChange: (config: RFIStatusConfig) => void;
}

export function RFIStatusSettings({ config, onChange }: RFIStatusSettingsProps) {
  const cfg = { ...DEFAULT_RFI_STATUS_CONFIG, ...config };
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projects = projectsResponse?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="rfi-project-filter">Filter by Project</Label>
        <Select
          value={cfg.projectId || "ALL"}
          onValueChange={(v) => onChange({ ...cfg, projectId: v === "ALL" ? "" : v })}
        >
          <SelectTrigger id="rfi-project-filter" data-testid="select-rfi-project-filter">
            <SelectValue placeholder="All projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}{p.code ? ` (${p.code})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Show RFIs only for this project. Leave blank to show all projects.</p>
      </div>

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
