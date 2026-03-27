import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, CheckCircle2, Circle, Clock, GitBranch } from "lucide-react";

interface WorkflowStage {
  id: string;
  name: string;
  color: string | null;
  stageOrder: number;
  allowedTransitions: string[];
}

interface WorkflowHistoryEntry {
  fromStageName?: string;
  toStageName: string;
  transitionedAt: string;
  notes?: string;
}

interface WorkflowInstance {
  id: string;
  currentStageId: string;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  history: WorkflowHistoryEntry[];
}

interface WorkflowTemplate {
  name: string;
}

interface WorkflowInstanceResponse {
  instance: WorkflowInstance;
  stages: WorkflowStage[];
  currentStage: WorkflowStage | null;
  template: WorkflowTemplate | null;
}

interface WorkflowTrackerProps {
  entityType: string;
  entityId: string;
  compact?: boolean;
}

export function WorkflowTracker({ entityType, entityId, compact }: WorkflowTrackerProps) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<WorkflowInstanceResponse | null>({
    queryKey: ["/api/workflows/instances/entity", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/instances/entity/${entityType}/${entityId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!entityType && !!entityId,
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ instanceId, targetStageId }: { instanceId: string; targetStageId: string }) =>
      apiRequest("POST", `/api/workflows/instances/${instanceId}/transition`, { targetStageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows/instances/entity", entityType, entityId] });
      toast({ title: "Stage transitioned successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Transition failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="animate-pulse flex items-center gap-2">
            <div className="h-4 bg-muted rounded w-24" />
            <div className="h-4 bg-muted rounded w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { instance, stages, currentStage, template } = data;

  if (!instance || !stages) return null;

  const currentStageIndex = stages.findIndex((s) => s.id === instance.currentStageId);
  const allowedTransitions = currentStage?.allowedTransitions || [];
  const nextStages = stages.filter((s) => allowedTransitions.includes(s.id));

  if (compact) {
    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid="workflow-tracker-compact">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{template?.name}:</span>
        {stages.map((stage, i) => {
          const isPast = i < currentStageIndex;
          const isCurrent = stage.id === instance.currentStageId;
          return (
            <div key={stage.id} className="flex items-center">
              <Badge
                variant={isCurrent ? "default" : isPast ? "secondary" : "outline"}
                className="text-xs"
                style={isCurrent ? { backgroundColor: stage.color || "#6366f1" } : {}}
                data-testid={`badge-tracker-stage-${stage.id}`}
              >
                {isPast && <CheckCircle2 className="w-3 h-3 mr-1" />}
                {isCurrent && <Circle className="w-3 h-3 mr-1 fill-current" />}
                {stage.name}
              </Badge>
              {i < stages.length - 1 && <ArrowRight className="w-3 h-3 mx-1 text-muted-foreground" />}
            </div>
          );
        })}
        {instance.status === "COMPLETED" && (
          <Badge variant="default" className="bg-green-600 text-xs">Completed</Badge>
        )}
      </div>
    );
  }

  return (
    <Card data-testid="workflow-tracker">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            {template?.name || "Workflow"}
          </CardTitle>
          <Badge
            variant={instance.status === "COMPLETED" ? "default" : instance.status === "CANCELLED" ? "destructive" : "secondary"}
            data-testid="badge-workflow-status"
          >
            {instance.status === "IN_PROGRESS" && <Clock className="w-3 h-3 mr-1" />}
            {instance.status === "COMPLETED" && <CheckCircle2 className="w-3 h-3 mr-1" />}
            {instance.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {stages.map((stage, i) => {
            const isPast = i < currentStageIndex;
            const isCurrent = stage.id === instance.currentStageId;
            return (
              <div key={stage.id} className="flex items-center">
                <div
                  className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap flex items-center gap-1 ${
                    isCurrent
                      ? "text-white shadow-md"
                      : isPast
                      ? "bg-muted text-muted-foreground line-through"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                  style={isCurrent ? { backgroundColor: stage.color || "#6366f1" } : {}}
                  data-testid={`stage-indicator-${stage.id}`}
                >
                  {isPast && <CheckCircle2 className="w-3 h-3" />}
                  {isCurrent && <Circle className="w-3 h-3 fill-current" />}
                  {stage.name}
                </div>
                {i < stages.length - 1 && <ArrowRight className="w-3 h-3 mx-1 text-muted-foreground flex-shrink-0" />}
              </div>
            );
          })}
        </div>

        {instance.status === "IN_PROGRESS" && nextStages.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Move to:</span>
            {nextStages.map((stage) => (
              <Button
                key={stage.id}
                size="sm"
                variant="outline"
                onClick={() => transitionMutation.mutate({ instanceId: instance.id, targetStageId: stage.id })}
                disabled={transitionMutation.isPending}
                data-testid={`button-transition-${stage.id}`}
              >
                <ArrowRight className="w-3 h-3 mr-1" />
                {stage.name}
              </Button>
            ))}
          </div>
        )}

        {instance.history && instance.history.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Transition History</h4>
            <div className="space-y-1">
              {instance.history.slice().reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-xs" data-testid={`history-entry-${i}`}>
                  <span className="text-muted-foreground">
                    {new Date(entry.transitionedAt).toLocaleString()}
                  </span>
                  {entry.fromStageName ? (
                    <>
                      <Badge variant="outline" className="text-xs">{entry.fromStageName}</Badge>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <Badge variant="outline" className="text-xs">{entry.toStageName}</Badge>
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs">{entry.toStageName}</Badge>
                  )}
                  {entry.notes && <span className="text-muted-foreground italic">— {entry.notes}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
