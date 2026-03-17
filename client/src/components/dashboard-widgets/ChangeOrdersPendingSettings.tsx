import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useQuery } from "@tanstack/react-query";

export interface ChangeOrdersPendingConfig {
  showLimit: number;
  highlightDaysThreshold: number;
  projectId: string;
}

export const DEFAULT_CO_PENDING_CONFIG: ChangeOrdersPendingConfig = {
  showLimit: 5,
  highlightDaysThreshold: 7,
  projectId: "",
};

interface ProjectRef {
  id: string;
  name: string;
  code?: string;
}

interface ChangeOrdersPendingSettingsProps {
  config: ChangeOrdersPendingConfig;
  onChange: (config: ChangeOrdersPendingConfig) => void;
}

export function ChangeOrdersPendingSettings({ config, onChange }: ChangeOrdersPendingSettingsProps) {
  const cfg = { ...DEFAULT_CO_PENDING_CONFIG, ...config };
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projects = projectsResponse?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="co-project-filter">Filter by Project</Label>
        <Select
          value={cfg.projectId || "ALL"}
          onValueChange={(v) => onChange({ ...cfg, projectId: v === "ALL" ? "" : v })}
        >
          <SelectTrigger id="co-project-filter" data-testid="select-co-project-filter">
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
        <p className="text-xs text-muted-foreground">Show change orders only for this project. Leave blank for all projects.</p>
      </div>

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
