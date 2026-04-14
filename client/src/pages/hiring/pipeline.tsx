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
import { Star, Inbox } from "lucide-react";
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
      <div>
        <div className="mb-4 space-y-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-72" />
        </div>
        <div className="flex gap-4 pb-4 overflow-x-auto" style={{ minHeight: "70vh" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl bg-muted/30 p-3 min-w-[220px] flex-1">
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="heading-pipeline">Pipeline Board</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Drag candidates between stages to update their status</p>
      </div>

      <div
        className="flex gap-3 pb-4 overflow-x-auto"
        style={{ minHeight: "70vh" }}
      >
        {pipelineStages.map((stage) => {
          const cols = byStage(stage.key);
          const isOver = dragOverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`min-w-[220px] flex-1 flex flex-col gap-2.5 rounded-xl p-3 border-2 transition-all duration-200 ${
                isOver
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md"
                  : "border-transparent bg-muted/30"
              }`}
              onDragOver={(e) => handleDragOver(e, stage.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.key)}
              data-testid={`column-${stage.key}`}
            >
              <div className="flex items-center justify-between px-1 py-1">
                <span
                  className="text-sm font-bold px-3 py-1 rounded-full"
                  style={{ backgroundColor: `${stage.color}20`, color: stage.color }}
                >
                  {stage.name}
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full bg-background border border-border text-muted-foreground"
                  data-testid={`badge-count-${stage.key}`}
                >
                  {cols.length}
                </span>
              </div>

              <div className="flex-1 space-y-2.5 min-h-[120px]">
                {cols.map((c) => {
                  const role = c.jobId ? jobsById[c.jobId]?.title : null;
                  return (
                    <Card
                      key={c.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, c.id)}
                      className="cursor-grab active:cursor-grabbing active:scale-[0.98] hover:shadow-lg transition-all duration-150 overflow-hidden bg-card relative"
                      data-testid={`card-candidate-${c.id}`}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[inherit]" style={{ backgroundColor: stage.color }} />
                      <CardContent className="p-3.5 pl-4 space-y-2 min-h-[44px]">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="w-8 h-8 shrink-0">
                            <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">{initials(c.fullName)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <Link href={`/hiring/candidates/${c.id}`} className="font-semibold text-sm hover:underline line-clamp-1 block" data-testid={`link-pipeline-candidate-${c.id}`}>
                              {c.fullName}
                            </Link>
                            {role && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{role}</p>}
                          </div>
                        </div>
                        {c.appliedAt && (
                          <p className="text-xs text-muted-foreground">{format(new Date(c.appliedAt), "MMM d")}</p>
                        )}
                        <div className="flex items-center justify-between">
                          {c.source && (
                            <span className="text-xs bg-secondary px-2 py-0.5 rounded-md text-secondary-foreground font-medium">
                              {SOURCE_SHORT[c.source] ?? c.source}
                            </span>
                          )}
                          {c.aiScore != null && (
                            <span className="flex items-center gap-0.5 text-xs font-medium">
                              <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                              {c.aiScore}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
                {cols.length === 0 && (
                  <div className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-all duration-200 min-h-[140px] ${
                    isOver
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border/60 text-muted-foreground"
                  }`}>
                    <Inbox className={`w-8 h-8 ${isOver ? "text-primary" : "text-muted-foreground/40"}`} />
                    <span className="text-xs font-medium">Drop candidates here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmMove} onOpenChange={(open) => { if (!open) setConfirmMove(null); }}>
        <AlertDialogContent className="sm:max-w-[calc(100vw-2rem)] sm:max-w-lg">
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
