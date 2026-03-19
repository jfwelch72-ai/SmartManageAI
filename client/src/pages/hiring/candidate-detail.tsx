import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Mail, Phone, Link2, FileText, ChevronRight, Star, MessageSquare } from "lucide-react";
import type { HiringCandidate, HiringActivityLog } from "@/types/hiring";
import { format, formatDistanceToNow } from "date-fns";

const STAGE_OPTIONS = [
  "APPLIED", "SCREENING", "PHONE_INTERVIEW", "IN_PERSON_INTERVIEW",
  "SKILLS_ASSESSMENT", "BACKGROUND_CHECK", "REFERENCE_CHECK",
  "OFFER_EXTENDED", "HIRED", "REJECTED", "ARCHIVED",
];

const STAGE_LABELS: Record<string, string> = {
  APPLIED: "Applied", SCREENING: "Screening", PHONE_INTERVIEW: "Phone Interview",
  IN_PERSON_INTERVIEW: "In-Person Interview", SKILLS_ASSESSMENT: "Skills Assessment",
  BACKGROUND_CHECK: "Background Check", REFERENCE_CHECK: "Reference Check",
  OFFER_EXTENDED: "Offer Extended", HIRED: "Hired", REJECTED: "Rejected", ARCHIVED: "Archived",
};

const DESTRUCTIVE_STAGES = ["REJECTED", "ARCHIVED"];

const STAGE_COLORS: Record<string, string> = {
  APPLIED: "bg-blue-100 text-blue-800",
  SCREENING: "bg-yellow-100 text-yellow-800",
  PHONE_INTERVIEW: "bg-orange-100 text-orange-800",
  IN_PERSON_INTERVIEW: "bg-purple-100 text-purple-800",
  SKILLS_ASSESSMENT: "bg-pink-100 text-pink-800",
  BACKGROUND_CHECK: "bg-indigo-100 text-indigo-800",
  REFERENCE_CHECK: "bg-cyan-100 text-cyan-800",
  OFFER_EXTENDED: "bg-emerald-100 text-emerald-800",
  HIRED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  ARCHIVED: "bg-gray-100 text-gray-600",
};

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

export default function CandidateDetailPage() {
  const [, params] = useRoute("/hiring/candidates/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const candidateId = params?.id;

  const [newNote, setNewNote] = useState("");
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState(false);

  const { data: candidate, isLoading } = useQuery<HiringCandidate>({
    queryKey: ["/api/hiring/candidates", candidateId],
    enabled: !!candidateId,
  });

  const { data: activity = [] } = useQuery<HiringActivityLog[]>({
    queryKey: ["/api/hiring/candidates", candidateId, "activity"],
    enabled: !!candidateId,
  });

  const stageMutation = useMutation({
    mutationFn: async (stage: string) => {
      const res = await apiRequest("PUT", `/api/hiring/candidates/${candidateId}/stage`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates"] });
      toast({ title: "Stage updated" });
      setPendingStage(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const noteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/hiring/candidates/${candidateId}/notes`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId] });
      toast({ title: "Note added" });
      setNewNote("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleStageChange(stage: string) {
    if (DESTRUCTIVE_STAGES.includes(stage)) {
      setPendingStage(stage);
      setConfirmStage(true);
    } else {
      stageMutation.mutate(stage);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-48 col-span-1" />
          <Skeleton className="h-48 col-span-2" />
        </div>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Candidate not found.</p>
        <Button variant="link" onClick={() => navigate("/hiring/candidates")} className="px-0 mt-2">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Candidates
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/hiring/candidates")} className="mb-1 -ml-2" data-testid="button-back-candidates">
            <ArrowLeft className="w-4 h-4 mr-1" />Candidates
          </Button>
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarFallback className="bg-primary/10 text-primary">{initials(candidate.fullName)}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold" data-testid="heading-candidate-name">{candidate.fullName}</h1>
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[candidate.stage] ?? ""}`}>
                {STAGE_LABELS[candidate.stage] ?? candidate.stage}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={candidate.stage} onValueChange={handleStageChange}>
            <SelectTrigger className="w-48" data-testid="select-candidate-stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column */}
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact Info</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {candidate.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${candidate.email}`} className="hover:underline truncate" data-testid="link-candidate-email">{candidate.email}</a>
                </div>
              )}
              {candidate.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`tel:${candidate.phone}`} className="hover:underline" data-testid="link-candidate-phone">{candidate.phone}</a>
                </div>
              )}
              {candidate.linkedinUrl && (
                <div className="flex items-center gap-2 text-sm">
                  <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={candidate.linkedinUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate" data-testid="link-candidate-linkedin">LinkedIn</a>
                </div>
              )}
              <Separator />
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Applied</span>
                  <span>{candidate.appliedAt ? format(new Date(candidate.appliedAt), "MMM d, yyyy") : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Source</span>
                  <span>{candidate.source ?? "—"}</span>
                </div>
                {candidate.aiScore != null && (
                  <div className="flex justify-between items-center">
                    <span>AI Score</span>
                    <span className="flex items-center gap-1">
                      <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                      {candidate.aiScore}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Stage History</CardTitle></CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stage history yet</p>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {activity.filter((a) => a.activityType === "CANDIDATE_STAGE_CHANGED" || a.activityType === "CANDIDATE_APPLIED").map((log) => {
                    const meta = log.metadata as { toStage?: string } | null;
                    return (
                      <li key={log.id} className="ml-4" data-testid={`stage-history-${log.id}`}>
                        <span className="absolute -left-1.5 mt-1 w-3 h-3 bg-primary rounded-full border-2 border-background" />
                        <p className="text-sm font-medium">{STAGE_LABELS[meta?.toStage ?? ""] ?? meta?.toStage ?? "Applied"}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                          {log.actorName ? ` · ${log.actorName}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4" />Notes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {candidate.notes && (
                <p className="text-sm whitespace-pre-line border-b pb-3">{candidate.notes}</p>
              )}
              <Textarea
                placeholder="Add a note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={3}
                data-testid="textarea-candidate-note"
              />
              <Button
                size="sm"
                onClick={() => noteMutation.mutate(newNote)}
                disabled={!newNote.trim() || noteMutation.isPending}
                data-testid="button-add-note"
              >
                Add Note
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-5">
          {candidate.resumeUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />Resume
                </CardTitle>
              </CardHeader>
              <CardContent>
                {candidate.resumeUrl.match(/\.(pdf)$/i) ? (
                  <object data={candidate.resumeUrl} type="application/pdf" className="w-full h-96 rounded border">
                    <a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-resume-download">
                      Download Resume
                    </a>
                  </object>
                ) : (
                  <a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1" data-testid="link-resume-download">
                    <FileText className="w-4 h-4" />View Resume
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {candidate.applicationAnswers && Object.keys(candidate.applicationAnswers).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Application Answers</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(candidate.applicationAnswers).map(([q, a]) => (
                  <div key={q} className="border-b pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-muted-foreground">{q}</p>
                    <p className="text-sm mt-1">{String(a)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Activity Log</CardTitle></CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet</p>
              ) : (
                <ul className="space-y-3">
                  {activity.slice(0, 20).map((log) => (
                    <li key={log.id} className="flex items-start gap-2 text-sm" data-testid={`activity-log-${log.id}`}>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <span>{log.actorName ?? "System"}</span>
                        <span className="text-muted-foreground"> · {log.activityType.replace(/_/g, " ").toLowerCase()}</span>
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmStage} onOpenChange={setConfirmStage}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to {STAGE_LABELS[pendingStage ?? ""] ?? pendingStage}?</AlertDialogTitle>
            <AlertDialogDescription>
              Moving a candidate to {STAGE_LABELS[pendingStage ?? ""] ?? pendingStage} is a significant action. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStage(null)} data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingStage) stageMutation.mutate(pendingStage); setConfirmStage(false); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-stage"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
