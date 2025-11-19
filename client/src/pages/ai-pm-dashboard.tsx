import { useQuery, useMutation } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Bot, CheckCircle, Clock, AlertCircle, XCircle, Play, TrendingUp } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AITask, AIRun } from "@shared/schema";

export default function AIPMDashboard() {
  const { user } = useUser();
  const { toast } = useToast();

  const { data: tasks, isLoading: tasksLoading } = useQuery<(AITask & { metadata: any })[]>({
    queryKey: ["/api/ai-pm/tasks"],
    enabled: !!user,
  });

  const { data: latestRun, isLoading: runLoading } = useQuery<AIRun & { aiResponse: any }>({
    queryKey: ["/api/ai-pm/latest-run"],
    enabled: !!user,
  });

  const triggerRunMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/ai-pm/run", {
        method: "POST",
        body: {},
      });
    },
    onSuccess: () => {
      toast({
        title: "AI Analysis Started",
        description: "AI PM + CFO analysis is running. This may take a minute...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Analysis Failed",
        description: error.message || "Failed to start AI analysis",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      return apiRequest(`/api/ai-pm/tasks/${taskId}`, {
        method: "PATCH",
        body: { status },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm/tasks"] });
      toast({
        title: "Task Updated",
        description: "Task status has been updated successfully",
      });
    },
  });

  const pendingTasks = tasks?.filter(t => t.status === "PENDING") || [];
  const inProgressTasks = tasks?.filter(t => t.status === "IN_PROGRESS") || [];
  const completedTasks = tasks?.filter(t => t.status === "COMPLETED") || [];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "CRITICAL": return "destructive";
      case "HIGH": return "default";
      case "MEDIUM": return "secondary";
      case "LOW": return "outline";
      default: return "secondary";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING": return <Clock className="h-4 w-4" />;
      case "IN_PROGRESS": return <AlertCircle className="h-4 w-4" />;
      case "COMPLETED": return <CheckCircle className="h-4 w-4" />;
      case "DISMISSED": return <XCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view your AI-generated tasks</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bot className="h-8 w-8 text-primary" />
            AI Project Manager
          </h1>
          <p className="text-muted-foreground mt-1">
            Daily tasks and insights powered by GPT-4
          </p>
        </div>
        <Button
          onClick={() => triggerRunMutation.mutate()}
          disabled={triggerRunMutation.isPending}
          data-testid="button-run-ai-analysis"
        >
          <Play className="h-4 w-4 mr-2" />
          {triggerRunMutation.isPending ? "Running..." : "Run Analysis Now"}
        </Button>
      </div>

      {runLoading ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ) : latestRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Latest Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Last run: {formatDistanceToNow(new Date(latestRun.createdAt), { addSuffix: true })}
            </p>
            {latestRun.aiResponse?.analysis_summary && (
              <p className="text-sm mt-2">{latestRun.aiResponse.analysis_summary}</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingTasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgressTasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Completed Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedTasks.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Your Tasks</h2>
          <Badge variant="outline" data-testid="text-task-count">
            {tasks?.length || 0} tasks for {user.role}
          </Badge>
        </div>

        {tasksLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : tasks && tasks.length > 0 ? (
          <div className="space-y-3">
            {tasks.map(task => (
              <Card key={task.id} className="hover-elevate" data-testid={`card-task-${task.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        {task.title}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {task.description}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Badge variant={getPriorityColor(task.priority) as any}>
                        {task.priority}
                      </Badge>
                      {task.projectCode && (
                        <Badge variant="outline">{task.projectCode}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{task.taskType.replace(/_/g, " ")}</span>
                      {task.dueDate && (
                        <span>• Due {formatDistanceToNow(new Date(task.dueDate), { addSuffix: true })}</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {task.status === "PENDING" && (
                        <Button
                          size="sm"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "IN_PROGRESS" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-start-task-${task.id}`}
                        >
                          Start
                        </Button>
                      )}
                      {task.status === "IN_PROGRESS" && (
                        <Button
                          size="sm"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "COMPLETED" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-complete-task-${task.id}`}
                        >
                          Complete
                        </Button>
                      )}
                      {task.status !== "DISMISSED" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateTaskMutation.mutate({ taskId: task.id, status: "DISMISSED" })}
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-dismiss-task-${task.id}`}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No tasks available. Click "Run Analysis Now" to generate AI insights.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
