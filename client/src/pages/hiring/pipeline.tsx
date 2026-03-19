import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Star } from "lucide-react";
import type { HiringCandidate } from "@/types/hiring";
import { format } from "date-fns";

const STAGES = [
  { key: "APPLIED", label: "Applied", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  { key: "SCREENING", label: "Screening", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  { key: "PHONE_INTERVIEW", label: "Phone Interview", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  { key: "IN_PERSON_INTERVIEW", label: "In-Person", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  { key: "SKILLS_ASSESSMENT", label: "Skills Test", color: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300" },
  { key: "BACKGROUND_CHECK", label: "Background", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300" },
  { key: "REFERENCE_CHECK", label: "References", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300" },
  { key: "OFFER_EXTENDED", label: "Offer Extended", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  { key: "HIRED", label: "Hired", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  { key: "REJECTED", label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
];

const DESTRUCTIVE_STAGES = new Set(["REJECTED", "ARCHIVED"]);

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

const SOURCE_SHORT: Record<string, string> = {
  INDEED: "Indeed", LINKEDIN: "LI", REFERRAL: "Ref", DIRECT: "Direct",
  CRAIGSLIST: "CL", COMPANY_WEBSITE: "Web", ATS_SYNC: "ATS", OTHER: "Other",
};

export default function HiringPipelinePage() {
  const { toast } = useToast();
  const dragCandidateId = useRef<string | null>(null);
  const [confirmMove, setConfirmMove] = useState<{ candidateId: string; toStage: string } | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const { data: candidates = [], isLoading } = useQuery<HiringCandidate[]>({
    queryKey: ["/api/hiring/candidates"],
  });

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
    if (!candidate || candidate.stage === toStage) return;
    if (DESTRUCTIVE_STAGES.has(toStage)) {
      setConfirmMove({ candidateId: cId, toStage });
    } else {
      stageMutation.mutate({ id: cId, stage: toStage });
    }
    dragCandidateId.current = null;
  }

  const byStage = (stageKey: string) => candidates.filter((c) => c.stage === stageKey);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((s) => (
            <div key={s.key} className="w-56 shrink-0 space-y-2">
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
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-pipeline">Pipeline Board</h1>
        <p className="text-muted-foreground">Drag candidates between stages to update their status</p>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "70vh" }}>
        {STAGES.map((stage) => {
          const cols = byStage(stage.key);
          const isOver = dragOverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`w-60 shrink-0 flex flex-col gap-2 rounded-lg p-2 border-2 transition-colors ${isOver ? "border-primary bg-primary/5" : "border-transparent bg-muted/30"}`}
              onDragOver={(e) => handleDragOver(e, stage.key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, stage.key)}
              data-testid={`column-${stage.key}`}
            >
              <div className="flex items-center justify-between px-1">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stage.color}`}>{stage.label}</span>
                <span className="text-xs text-muted-foreground">{cols.length}</span>
              </div>

              <div className="flex-1 space-y-2 min-h-[120px]">
                {cols.map((c) => (
                  <Card
                    key={c.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, c.id)}
                    className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                    data-testid={`card-candidate-${c.id}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-7 h-7 shrink-0">
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials(c.fullName)}</AvatarFallback>
                        </Avatar>
                        <Link href={`/hiring/candidates/${c.id}`} className="font-medium text-xs hover:underline line-clamp-1 flex-1" data-testid={`link-pipeline-candidate-${c.id}`}>
                          {c.fullName}
                        </Link>
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
                ))}
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Move</AlertDialogTitle>
            <AlertDialogDescription>
              Moving a candidate to <strong>{confirmMove?.toStage}</strong> is a significant action and may be difficult to undo. Continue?
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
