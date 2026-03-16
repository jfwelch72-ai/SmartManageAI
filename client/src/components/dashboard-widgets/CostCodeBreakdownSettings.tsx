import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useQuery } from "@tanstack/react-query";

export interface CostCodeBreakdownConfig {
  mode?: string;
  projectId?: string;
  groupByDivision?: boolean;
}

export const DEFAULT_COST_CODE_CONFIG: CostCodeBreakdownConfig = {
  mode: "labor",
  projectId: "",
  groupByDivision: false,
};

interface Project {
  id: string;
  name: string;
}

interface CostCodeBreakdownSettingsProps {
  config: CostCodeBreakdownConfig;
  onChange: (config: CostCodeBreakdownConfig) => void;
}

export function CostCodeBreakdownSettings({ config, onChange }: CostCodeBreakdownSettingsProps) {
  const merged = { ...DEFAULT_COST_CODE_CONFIG, ...config };

  const { data: projectsData } = useQuery<{ data: Project[] }>({
    queryKey: ["/api/projects"],
  });

  const projects = projectsData?.data || [];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label data-testid="label-cost-code-mode">Chart Mode</Label>
        <Select
          value={merged.mode}
          onValueChange={(value) => onChange({ ...merged, mode: value })}
        >
          <SelectTrigger data-testid="select-cost-code-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="labor">Labor by Cost Code (Pie)</SelectItem>
            <SelectItem value="budget_vs_actual">Budget vs Actual (Bar)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label data-testid="label-cost-code-project">Project Filter</Label>
        <Select
          value={merged.projectId || "all"}
          onValueChange={(value) => onChange({ ...merged, projectId: value === "all" ? "" : value })}
        >
          <SelectTrigger data-testid="select-cost-code-project">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="group-by-division" data-testid="label-group-by-division">Group by Division</Label>
        <Switch
          id="group-by-division"
          checked={merged.groupByDivision ?? false}
          onCheckedChange={(checked) => onChange({ ...merged, groupByDivision: checked })}
          data-testid="switch-group-by-division"
        />
      </div>
    </div>
  );
}
