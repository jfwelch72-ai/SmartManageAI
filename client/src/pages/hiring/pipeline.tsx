import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Star } from "lucide-react";
import { useHiringCandidates, useHiringJobs } from "@/lib/hiring-api";
import { format } from "date-fns";

interface PipelineStage {
  key: string;
  name: string;
  color: string;
  isTerminal: boolean;
  displayOrder: number;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

const SOURCE_SHORT: Record<string, string> = {
  INDEED: "Indeed", LINKEDIN: "LI", REFERRAL: "Ref", DIRECT: "Direct",
  CRAIGSLIST: "CL", COMPANY_WEBSITE: "Web", ATS_SYNC: "ATS", TALENT_POOL: "Pool", OTHER: "Other",
};

export default function HiringPipelinePage() {
  const { toast } = useToast();
  const dragCandidateId = useRef<string | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ candidateId: string; toStage: string; stageName: string } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const { data: candidates = [], isLoading: candidatesLoading } = useHiringCandidates();
  const { data: jobs = [] } = useHiringJobs();
  const jobsById = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const { data: pipelineStages = [], isLoading: stagesLoading } = useQuery<PipelineStage[]>({
    queryKey: ["/api/hiring/pipeline-stages"],
  });

  const isLoading = candidatesLoading || stagesLoading;

  const stageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const res = await apiRequest("PUT", `/api/hiring/candidates/${id}/stage`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleDragStart(e: React.DragEvent, candidateId: string) {
    dragCandidateId.current = candidateId;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent, stageKey: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageKey);
  }

  function handleDragLeave() {
    setDragOverStage(null);
  }

  function handleDrop(e: React.DragEvent, toStage: string) {
    e.preventDefault();
    setDragOverStage(null);
    const cId = dragCandidateId.current;
    if (!cId) return;
    const candidate = candidates.find((c) => c.id === cId);
    if (!candidate || candidate.currentStage === toStage) return;
    const stageInfo = pipelineStages.find((s) => s.key === toStage);
    if (stageInfo?.isTerminal) {
      setConfirmMove({ candidateId: cId, toStage, stageName: stageInfo.name });
    } else {
      stageMutation.mutate({ id: cId, stage: toStage });
    }
    dragCandidateId.current = null;
  }

  const byStage = (stageKey: string) => candidates.filter((c) => c.currentStage === stageKey);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex flex-col sm:flex-row gap-4 sm:overflow-x-auto pb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="w-full sm:w-56 sm:shrink-0 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="heading-pipeline">Pipeline Board</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Drag candidates between stages to update their status</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:overflow-x-auto pb-4" style={{ minHeight: "70vh" }}>
        {pipelineStages.map((stage) => {
          const cols = byStage(stage.key);
          const isOver = dragOverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`w-full sm:w-60 sm:shrink-0 flex flex-col gap-2 rounded-lg p-2 border-2 transition-colors ${isOver ? "border-primary bg-primary/5" : "border-transparent bg-muted/30"}`}
              onDragOver={(e) => handleDragOver(e, stage.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.key)}
              data-testid={`column-${stage.key}`}
            >
              <div className="flex items-center justify-between px-1">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                >
                  {stage.name}
                </span>
                <span className="text-xs text-muted-foreground">{cols.length}</span>
              </div>

              <div className="flex-1 space-y-2 min-h-[120px]">
                {cols.map((c) => {
                  const role = c.jobId ? jobsById[c.jobId]?.title : null;
                  return (
                    <Card
                      key={c.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, c.id)}
                      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow touch-manipulation"
                      data-testid={`card-candidate-${c.id}`}
                    >
                      <CardContent className="p-3 space-y-1.5 min-h-[44px]">
                        <div className="flex items-center gap-2">
                          <Avatar className="w-7 h-7 shrink-0">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(c.fullName)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <Link href={`/hiring/candidates/${c.id}`} className="font-medium text-xs hover:underline line-clamp-1 block" data-testid={`link-pipeline-candidate-${c.id}`}>
                              {c.fullName}
                            </Link>
                            {role && <p className="text-xs text-muted-foreground line-clamp-1">{role}</p>}
                          </div>
                        </div>
                        {c.appliedAt && (
                          <p className="text-xs text-muted-foreground">{format(new Date(c.appliedAt), "MMM d")}</p>
                        )}
                        <div className="flex items-center justify-between">
                          {c.source && (
                            <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground">
                              {SOURCE_SHORT[c.source] ?? c.source}
                            </span>
                          )}
                          {c.aiScore != null && (
                            <span className="flex items-center gap-0.5 text-xs">
                              <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                              {c.aiScore}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {cols.length === 0 && (
                  <div className={`rounded-lg border-2 border-dashed p-4 text-center text-xs text-muted-foreground transition-colors ${isOver ? "border-primary" : "border-border"}`}>
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmMove} onOpenChange={(open) => { if (!open) setConfirmMove(null); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Move</AlertDialogTitle>
            <AlertDialogDescription>
              Moving a candidate to <strong>{confirmMove?.stageName || ""}</strong> is a significant action and may be difficult to undo. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmMove(null)} data-testid="button-pipeline-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmMove) stageMutation.mutate({ id: confirmMove.candidateId, stage: confirmMove.toStage });
                setConfirmMove(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-pipeline-confirm"
            >
              Move
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
