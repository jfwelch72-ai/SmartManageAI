import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Bot,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Play,
  TrendingUp,
  ArrowLeft,
  Users,
  DollarSign,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import type { AITask, AIRun } from "@shared/schema";

export default function AIPMDashboard() {
  const { user, logout, organizationName } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: tasks, isLoading: tasksLoading } = useQuery<
    (AITask & { metadata: any })[]
  >({
    queryKey: ["/api/ai-pm/tasks"],
    enabled: !!user,
    refetchInterval: 15000,
  });

  const { data: latestRun, isLoading: runLoading } = useQuery<
    AIRun & { aiResponse: any }
  >({
    queryKey: ["/api/ai-pm/latest-run"],
    enabled: !!user,
    refetchInterval: 15000,
  });

  const triggerRunMutation = useMutation({
    mutationFn: async () => {
      toast({
        title: "AI Analysis Started",
        description:
          "AI PM + CFO analysis is running. This may take up to 30 seconds...",
      });
      const response = await apiRequest("POST", "/api/ai-pm/run", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm"] });
      toast({
        title: "Analysis Complete!",
        description: `Successfully generated ${data.tasksCreated || "new"} AI tasks. Check your task list below.`,
      });
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
    mutationFn: async ({
      taskId,
      status,
    }: {
      taskId: string;
      status: string;
    }) => {
      return apiRequest("PATCH", `/api/ai-pm/tasks/${taskId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-pm/tasks"] });
      toast({
        title: "Task Updated",
        description: "Task status has been updated successfully",
      });
    },
  });

  const pendingTasks = tasks?.filter((t) => t.status === "PENDING") || [];
  const inProgressTasks =
    tasks?.filter((t) => t.status === "IN_PROGRESS") || [];
  const completedTasks = tasks?.filter((t) => t.status === "COMPLETED") || [];

  // Filter billing-related tasks (Textura draw dates, billing/office tasks, etc.)
  const billingTasks =
    tasks
      ?.filter(
        (t) =>
          t.status !== "DISMISSED" &&
          t.status !== "COMPLETED" &&
          (t.role === "ADMIN" || t.role === "MANAGER" ||
            t.title.toLowerCase().includes("textura") ||
            t.title.toLowerCase().includes("billing") ||
            t.title.toLowerCase().includes("draw") ||
            t.description?.toLowerCase().includes("textura") ||
            t.description?.toLowerCase().includes("billing")),
      )
      .sort((a, b) => {
        // Sort CRITICAL first, then by due date
        if (a.priority === "CRITICAL" && b.priority !== "CRITICAL") return -1;
        if (a.priority !== "CRITICAL" && b.priority === "CRITICAL") return 1;
        return 0;
      }) || [];

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "CRITICAL":
        return "destructive";
      case "HIGH":
        return "default";
      case "MEDIUM":
        return "secondary";
      case "LOW":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Clock className="h-4 w-4" />;
      case "IN_PROGRESS":
        return <AlertCircle className="h-4 w-4" />;
      case "COMPLETED":
        return <CheckCircle className="h-4 w-4" />;
      case "DISMISSED":
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <main className="p-8 text-center">
          <p className="text-muted-foreground">
            Please log in to view your AI-generated tasks
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.history.back()}
          className="gap-2 mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-6">
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
        ) : (
          latestRun && (
            <Card className="mt-[15px] mb-[15px]">
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Latest Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Last run:{" "}
                  {formatDistanceToNow(new Date(latestRun.createdAt), {
                    addSuffix: true,
                  })}
                </p>
                {latestRun.aiResponse?.analysis_summary && (
                  <p className="text-sm mt-2">
                    {latestRun.aiResponse.analysis_summary}
                  </p>
                )}
              </CardContent>
            </Card>
          )
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Pending Tasks
              </CardTitle>
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
              <CardTitle className="text-sm font-medium">
                Completed Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{completedTasks.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Billing & Draw Date Tasks Alert */}
        {billingTasks.length > 0 && (
          <Card
            className="border-red-500 bg-red-50 dark:bg-red-950/20"
            data-testid="card-billing-tasks-alert"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-500" />
                {billingTasks.length} Urgent Billing Task
                {billingTasks.length !== 1 ? "s" : ""}
              </CardTitle>
              <CardDescription>
                Critical billing and Textura draw date tasks requiring immediate
                attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {billingTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-center justify-between p-3 bg-background rounded-md ${
                      task.priority === "CRITICAL"
                        ? "border-l-4 border-l-red-500"
                        : "border-l-4 border-l-yellow-500"
                    }`}
                    data-testid={`billing-task-${task.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {task.title}
                        </span>
                        {task.projectCode && (
                          <Badge variant="outline" className="text-xs">
                            {task.projectCode}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {task.description}
                      </p>
                      {task.dueDate && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Due:{" "}
                          {formatDistanceToNow(new Date(task.dueDate), {
                            addSuffix: true,
                          })}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Badge
                        variant={getPriorityColor(task.priority) as any}
                        data-testid={`badge-priority-${task.id}`}
                      >
                        {task.priority}
                      </Badge>
                      {task.status === "PENDING" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateTaskMutation.mutate({
                              taskId: task.id,
                              status: "IN_PROGRESS",
                            })
                          }
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-start-billing-task-${task.id}`}
                        >
                          Start
                        </Button>
                      )}
                      {task.status === "IN_PROGRESS" && (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateTaskMutation.mutate({
                              taskId: task.id,
                              status: "COMPLETED",
                            })
                          }
                          disabled={updateTaskMutation.isPending}
                          data-testid={`button-complete-billing-task-${task.id}`}
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between mt-[10px] mb-[10px]">
            <h2 className="text-2xl font-bold">Your Tasks</h2>
            <Badge variant="outline" data-testid="text-task-count">
              {tasks?.length || 0} tasks for {user.role}
            </Badge>
          </div>

          {tasksLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : tasks && tasks.length > 0 ? (
            <div className="space-y-3">
              {tasks.map((task) => (
                <Card
                  key={task.id}
                  className="hover-elevate"
                  data-testid={`card-task-${task.id}`}
                >
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
                          <span>
                            • Due{" "}
                            {formatDistanceToNow(new Date(task.dueDate), {
                              addSuffix: true,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {task.status === "PENDING" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              updateTaskMutation.mutate({
                                taskId: task.id,
                                status: "IN_PROGRESS",
                              })
                            }
                            disabled={updateTaskMutation.isPending}
                            data-testid={`button-start-task-${task.id}`}
                          >
                            Start
                          </Button>
                        )}
                        {task.status === "IN_PROGRESS" && (
                          <Button
                            size="sm"
                            onClick={() =>
                              updateTaskMutation.mutate({
                                taskId: task.id,
                                status: "COMPLETED",
                              })
                            }
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
                            onClick={() =>
                              updateTaskMutation.mutate({
                                taskId: task.id,
                                status: "DISMISSED",
                              })
                            }
                            disabled={updateTaskMutation.isPending}
                            data-testid={`button-dismiss-task-${task.id}`}
                          >
                            Dismiss
                          </Button>
                        )}
                      </div>
                    </div>

                    {task.metadata?.sub_recommendations && task.metadata.sub_recommendations.length > 0 && (
                      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800" data-testid={`task-sub-recommendations-${task.id}`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Users className="h-3.5 w-3.5 text-blue-600" />
                          <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Recommended Subcontractors</span>
                        </div>
                        <div className="space-y-1.5">
                          {task.metadata.sub_recommendations.map((rec: { subcontractorId: string; subcontractorName: string; overallScore: number; rank: number; tradeMatch: boolean }, idx: number) => (
                            <div key={rec.subcontractorId || idx} className="flex items-center justify-between text-xs" data-testid={`sub-rec-${task.id}-${idx}`}>
                              <span className="font-medium">#{rec.rank} {rec.subcontractorName}</span>
                              <div className="flex items-center gap-2">
                                {rec.tradeMatch && <Badge variant="outline" className="text-[10px] px-1 py-0">Trade Match</Badge>}
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Score: {rec.overallScore}</Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {task.metadata?.ai_cost_prediction && (
                      <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-md border border-amber-200 dark:border-amber-800" data-testid={`task-cost-prediction-${task.id}`}>
                        <div className="flex items-center gap-1.5 mb-2">
                          <DollarSign className="h-3.5 w-3.5 text-amber-600" />
                          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">AI Cost Overrun Prediction</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Project:</span>{" "}
                            <span className="font-medium">{task.metadata.ai_cost_prediction.project_code}</span>
                          </div>
                          {task.metadata.ai_cost_prediction.predicted_overrun_amount != null && (
                            <div>
                              <span className="text-muted-foreground">Predicted Overrun:</span>{" "}
                              <span className="font-medium text-red-600">${Number(task.metadata.ai_cost_prediction.predicted_overrun_amount).toLocaleString()}</span>
                            </div>
                          )}
                          {(task.metadata.ai_cost_prediction.confidence_score ?? task.metadata.ai_cost_prediction.confidence) != null && (
                            <div>
                              <span className="text-muted-foreground">Confidence:</span>{" "}
                              <span className="font-medium">{task.metadata.ai_cost_prediction.confidence_score ?? task.metadata.ai_cost_prediction.confidence}%</span>
                            </div>
                          )}
                          {(task.metadata.ai_cost_prediction.recommended_actions || task.metadata.ai_cost_prediction.recommended_action) && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Actions:</span>{" "}
                              <span className="font-medium">
                                {Array.isArray(task.metadata.ai_cost_prediction.recommended_actions)
                                  ? task.metadata.ai_cost_prediction.recommended_actions.join('; ')
                                  : task.metadata.ai_cost_prediction.recommended_action}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  No tasks available. Click "Run Analysis Now" to generate AI
                  insights.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
