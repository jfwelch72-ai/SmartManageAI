import { Button } from "@/components/ui/button";
import { Table2, KanbanSquare, Calendar as CalendarIcon, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewType = "table" | "kanban" | "calendar" | "map";

const ALL_VIEWS: Record<ViewType, { label: string; icon: typeof Table2 }> = {
  table: { label: "Table", icon: Table2 },
  kanban: { label: "Kanban", icon: KanbanSquare },
  calendar: { label: "Calendar", icon: CalendarIcon },
  map: { label: "Map", icon: MapIcon },
};

interface ViewSwitcherProps {
  value: ViewType;
  onChange: (v: ViewType) => void;
  views?: ViewType[];
  testId?: string;
}

export default function ViewSwitcher({
  value,
  onChange,
  views = ["table", "kanban", "calendar", "map"],
  testId = "view-switcher",
}: ViewSwitcherProps) {
  return (
    <div className="inline-flex rounded-md border bg-background p-0.5" data-testid={testId}>
      {views.map((key) => {
        const { label, icon: Icon } = ALL_VIEWS[key];
        const active = value === key;
        return (
          <Button
            key={key}
            type="button"
            variant={active ? "default" : "ghost"}
            size="sm"
            className={cn("h-8 px-3 gap-1.5", !active && "text-muted-foreground")}
            onClick={() => onChange(key)}
            data-testid={`view-switcher-${key}`}
            aria-pressed={active}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
