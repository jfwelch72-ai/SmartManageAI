import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { AITask } from "@shared/schema";

export function AITasksWidget() {
  const { data: aiTasks = [], isLoading, isError } = useQuery<AITask[]>({
    queryKey: ["/api/ai/tasks"],
  });

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-tasks">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
              <Skeleton className="h-2 w-2 rounded-full shrink-0" />
              <Skeleton className="flex-1 h-3.5" />
              <Skeleton className="h-5 w-16 rounded-full shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-tasks-error">
        <CardContent className="flex flex-col items-center justify-center h-full py-8 text-center">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load tasks.</p>
        </CardContent>
      </Card>
    );
  }

  const pendingTasks = aiTasks.filter(
    (t) => t.status === "PENDING" || t.status === "IN_PROGRESS"
  );

  return (
    <Card className="h-full" data-testid="card-tasks">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ClipboardList className="w-4 h-4" />
          AI-Generated Tasks
          {pendingTasks.length > 0 && (
            <Badge variant="default" className="ml-1">
              {pendingTasks.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pendingTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No pending tasks
          </p>
        ) : (
          <div className="space-y-2">
            {pendingTasks.slice(0, 4).map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                data-testid={`task-item-${task.id}`}
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    task.priority === "CRITICAL"
                      ? "bg-red-500"
                      : task.priority === "HIGH"
                        ? "bg-orange-500"
                        : task.priority === "MEDIUM"
                          ? "bg-yellow-500"
                          : "bg-green-500"
                  }`}
                />
                <p className="text-sm flex-1 truncate">{task.title}</p>
                <Badge variant="outline" className="text-xs shrink-0">
                  {task.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
