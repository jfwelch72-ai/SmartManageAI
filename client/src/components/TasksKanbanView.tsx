import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { User, Calendar as CalendarIcon } from "lucide-react";

type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED";

const STATUS_COLUMNS: Array<{ key: TaskStatus; label: string; accent: string }> = [
  { key: "PENDING", label: "Pending", accent: "bg-amber-500" },
  { key: "IN_PROGRESS", label: "In Progress", accent: "bg-blue-500" },
  { key: "COMPLETED", label: "Completed", accent: "bg-emerald-500" },
  { key: "DISMISSED", label: "Dismissed", accent: "bg-slate-500" },
];

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900 dark:text-red-200 dark:border-red-800",
  HIGH: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900 dark:text-orange-200 dark:border-orange-800",
  MEDIUM: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  LOW: "",
};

export interface KanbanTaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  category?: string;
  assignedToFirstName?: string;
  assignedToLastName?: string;
  dueDate?: string;
}

interface Props {
  tasks: KanbanTaskItem[];
  onCardClick: (task: KanbanTaskItem) => void;
}

export default function TasksKanbanView({ tasks, onCardClick }: Props) {
  const grouped = STATUS_COLUMNS.reduce((acc, col) => {
    acc[col.key] = tasks.filter((t) => t.status === col.key);
    return acc;
  }, {} as Record<TaskStatus, KanbanTaskItem[]>);

  return (
    <div className="overflow-x-auto pb-2" data-testid="view-kanban">
      <div className="flex gap-4 min-w-max">
        {STATUS_COLUMNS.map((col) => {
          const colTasks = grouped[col.key] || [];
          return (
            <div
              key={col.key}
              className="w-72 shrink-0 rounded-md border bg-muted/30"
              data-testid={`kanban-column-${col.key}`}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">{colTasks.length}</Badge>
              </div>
              <div className="p-2 space-y-2 min-h-32 max-h-[calc(100vh-22rem)] overflow-y-auto">
                {colTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No tasks</p>
                ) : (
                  colTasks.map((t) => (
                    <Card
                      key={t.id}
                      onClick={() => onCardClick(t)}
                      className="cursor-pointer hover-elevate"
                      data-testid={`kanban-card-${t.id}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <h4 className="text-sm font-medium leading-tight" data-testid={`kanban-card-name-${t.id}`}>{t.title}</h4>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {PRIORITY_BADGE[t.priority] !== undefined ? (
                            <Badge className={PRIORITY_BADGE[t.priority] || undefined} variant={PRIORITY_BADGE[t.priority] ? undefined : "secondary"}>
                              {t.priority}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">{t.priority}</Badge>
                          )}
                          {t.category && (
                            <Badge variant="outline" className="text-[10px]">{t.category.replace(/_/g, " ")}</Badge>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          {t.assignedToFirstName ? (
                            <span className="flex items-center gap-1 truncate">
                              <User className="h-3 w-3" />
                              {t.assignedToFirstName} {t.assignedToLastName}
                            </span>
                          ) : <span />}
                          {t.dueDate && (
                            <span className="flex items-center gap-1 shrink-0">
                              <CalendarIcon className="h-3 w-3" />
                              {format(new Date(t.dueDate), "MMM d")}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
