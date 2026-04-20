import { Button } from "@/components/ui/button";
import { Table2, KanbanSquare, Calendar as CalendarIcon, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectsViewType = "table" | "kanban" | "calendar" | "map";

interface ProjectsViewSwitcherProps {
  value: ProjectsViewType;
  onChange: (v: ProjectsViewType) => void;
}

const VIEWS: Array<{ key: ProjectsViewType; label: string; icon: typeof Table2 }> = [
  { key: "table", label: "Table", icon: Table2 },
  { key: "kanban", label: "Kanban", icon: KanbanSquare },
  { key: "calendar", label: "Calendar", icon: CalendarIcon },
  { key: "map", label: "Map", icon: MapIcon },
];

export default function ProjectsViewSwitcher({ value, onChange }: ProjectsViewSwitcherProps) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5" data-testid="projects-view-switcher">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = value === v.key;
        return (
          <Button
            key={v.key}
            type="button"
            variant={active ? "default" : "ghost"}
            size="sm"
            className={cn("h-8 px-3 gap-1.5", !active && "text-muted-foreground")}
            onClick={() => onChange(v.key)}
            data-testid={`view-switcher-${v.key}`}
            aria-pressed={active}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{v.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
