import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Mail, Phone, FileText, ChevronRight, Star, MessageSquare, Mail as MailIcon, ClipboardList,
} from "lucide-react";
import {
  useHiringCandidate, useCandidateNotes, useCandidateActivity,
} from "@/lib/hiring-api";
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

function ApplicationAnswersAccordion({ answers }: { answers: Record<string, unknown> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const entries = Object.entries(answers);
  if (entries.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><ClipboardList className="w-4 h-4" />Application Answers</CardTitle></CardHeader>
      <CardContent className="p-0">
        {entries.map(([q, a], i) => {
          const isOpen = open[q] ?? i === 0;
          return (
            <div key={q} className="border-b last:border-0" data-testid={`answer-accordion-${i}`}>
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [q]: !isOpen }))}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                data-testid={`answer-toggle-${i}`}
              >
                <span className="text-sm font-medium">{q}</span>
                <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              </button>
              {isOpen && (
                <div className="px-4 pb-3 text-sm text-muted-foreground" data-testid={`answer-body-${i}`}>
                  {String(a)}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function CandidateDetailPage() {
  const [, params] = useRoute("/hiring/candidates/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const candidateId = params?.id ?? "";

  const [newNote, setNewNote] = useState("");
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState(false);

  const { data: candidate, isLoading } = useHiringCandidate(candidateId);
  const { data: activity = [] } = useCandidateActivity(candidateId);
  const { data: notes = [] } = useCandidateNotes(candidateId);

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
    mutationFn: async (body: string) => {
      const res = await apiRequest("POST", `/api/hiring/candidates/${candidateId}/notes`, { body });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/candidates", candidateId, "notes"] });
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

  function parseApplicationAnswers(json: string | null): Record<string, unknown> | null {
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
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
        <Button variant="ghost" onClick={() => navigate("/hiring/candidates")} className="px-0 mt-2">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to Candidates
        </Button>
      </div>
    );
  }

  const applicationAnswers = parseApplicationAnswers(candidate.applicationAnswersJson);
  const stageHistory = activity.filter((a) =>
    a.activityType === "CANDIDATE_STAGE_CHANGED" || a.activityType === "CANDIDATE_APPLIED"
  );
  const communicationsLog = activity.filter((a) =>
    a.activityType === "EMAIL_SENT" || a.activityType === "EMAIL_RECEIVED" || a.activityType === "NOTE_ADDED"
  );

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
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[candidate.currentStage] ?? ""}`}>
                {STAGE_LABELS[candidate.currentStage] ?? candidate.currentStage}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={candidate.currentStage} onValueChange={handleStageChange}>
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
              {(candidate.city || candidate.state) && (
                <div className="text-sm text-muted-foreground">
                  {[candidate.city, candidate.state].filter(Boolean).join(", ")}
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
              {stageHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stage history yet</p>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4">
                  {stageHistory.map((log) => {
                    let meta: { toStage?: string } | null = null;
                    try { meta = log.metadataJson ? JSON.parse(log.metadataJson) : null; } catch { meta = null; }
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
              {notes.length > 0 && (
                <div className="space-y-2 border-b pb-3">
                  {notes.map((note) => (
                    <div key={note.id} className="text-sm border rounded p-2">
                      <p className="whitespace-pre-line">{note.body}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {note.authorName} · {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  ))}
                </div>
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
          {/* Resume attachment viewer */}
          {candidate.resumeStorageKey ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />Resume
                </CardTitle>
              </CardHeader>
              <CardContent>
                {candidate.resumeStorageKey.match(/\.(pdf)$/i) ? (
                  <object
                    data={`/api/hiring/candidates/${candidate.id}/resume`}
                    type="application/pdf"
                    className="w-full h-96 rounded border"
                    data-testid="resume-pdf-viewer"
                  >
                    <a
                      href={`/api/hiring/candidates/${candidate.id}/resume`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      data-testid="link-resume-download"
                    >
                      Download Resume
                    </a>
                  </object>
                ) : candidate.resumeStorageKey.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? (
                  <div className="space-y-2">
                    <img
                      src={`/api/hiring/candidates/${candidate.id}/resume`}
                      alt="Resume"
                      className="w-full max-h-[600px] object-contain rounded border bg-muted"
                      data-testid="resume-image-viewer"
                    />
                    <a
                      href={`/api/hiring/candidates/${candidate.id}/resume`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm flex items-center gap-1"
                      data-testid="link-resume-download-img"
                    >
                      <FileText className="w-4 h-4" />Open full size
                    </a>
                  </div>
                ) : (
                  <a
                    href={`/api/hiring/candidates/${candidate.id}/resume`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                    data-testid="link-resume-download"
                  >
                    <FileText className="w-4 h-4" />View Resume
                  </a>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />Resume
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">No resume on file</p>
              </CardContent>
            </Card>
          )}

          {/* Application answers accordion */}
          {applicationAnswers && Object.keys(applicationAnswers).length > 0 && (
            <ApplicationAnswersAccordion answers={applicationAnswers} />
          )}

          {/* AI Recommendation */}
          {candidate.aiRecommendation && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Star className="w-4 h-4 text-yellow-500" />AI Recommendation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{candidate.aiRecommendation}</p>
              </CardContent>
            </Card>
          )}

          {/* Communications log */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MailIcon className="w-4 h-4" />Communications
              </CardTitle>
            </CardHeader>
            <CardContent>
              {communicationsLog.length === 0 ? (
                <p className="text-sm text-muted-foreground">No communications yet</p>
              ) : (
                <ul className="space-y-3">
                  {communicationsLog.map((log) => (
                    <li key={log.id} className="flex items-start gap-2 text-sm border-b pb-2 last:border-0" data-testid={`comm-log-${log.id}`}>
                      <MailIcon className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <span>{log.actorName ?? "System"}</span>
                        <span className="text-muted-foreground"> · {log.activityType.replace(/_/g, " ").toLowerCase()}</span>
                        {log.entityLabel && <span className="text-muted-foreground"> — {log.entityLabel}</span>}
                        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Tasks panel */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />Linked Tasks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">No tasks linked to this candidate yet.</p>
              <Badge variant="outline" className="mt-2 text-xs">Coming in Phase 2</Badge>
            </CardContent>
          </Card>

          {/* Activity log */}
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
