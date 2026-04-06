import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, Mail, Phone, FileText, ChevronRight, Star, MessageSquare,
  Mail as MailIcon, ClipboardList, Plus, CheckCircle2, Circle, Sparkles,
} from "lucide-react";
import {
  useHiringCandidate, useCandidateNotes, useCandidateActivity,
  useAiScoreCandidate,
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

interface HiringTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  hiringCandidateId: string | null;
  assignedToFirstName: string | null;
  assignedToLastName: string | null;
  createdAt: string;
}

export default function CandidateDetailPage() {
  const [, params] = useRoute("/hiring/candidates/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "HUSTLER" || role === "MANAGER";
  const canRunAiReview = role === "ADMIN" || role === "HUSTLER" || role === "MANAGER";
  const candidateId = params?.id ?? "";

  const [newNote, setNewNote] = useState("");
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [confirmStage, setConfirmStage] = useState(false);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [aiResult, setAiResult] = useState<{
    score: number;
    tradeFitScore: number;
    roleFitScore: number;
    confidenceScore: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    redFlags: string[];
    extractedSkills: string[];
    extractedCerts: string[];
    extractedEquipment: string[];
    interviewRecommendation: string;
    disclaimer: string;
  } | null>(null);

  const { data: candidate, isLoading } = useHiringCandidate(candidateId);

  const persistedReview = candidate?.latestAiReview ?? null;
  const displayReview = aiResult ?? (persistedReview ? {
    score: persistedReview.score ?? 0,
    tradeFitScore: persistedReview.tradeFitScore ?? 0,
    roleFitScore: persistedReview.roleFitScore ?? 0,
    confidenceScore: persistedReview.confidenceScore ?? 0,
    recommendation: persistedReview.recommendation ?? "MAYBE",
    summary: persistedReview.summary ?? "",
    strengths: JSON.parse(persistedReview.strengthsJson ?? "[]"),
    concerns: JSON.parse(persistedReview.concernsJson ?? "[]"),
    redFlags: JSON.parse(persistedReview.redFlagsJson ?? "[]"),
    extractedSkills: JSON.parse(persistedReview.extractedSkillsJson ?? "[]"),
    extractedCerts: JSON.parse(persistedReview.extractedCertsJson ?? "[]"),
    extractedEquipment: JSON.parse(persistedReview.extractedEquipmentJson ?? "[]"),
    interviewRecommendation: persistedReview.interviewRecommendation ?? "",
    disclaimer: "",
  } : null);

  const { data: activity = [] } = useCandidateActivity(candidateId);
  const { data: notes = [] } = useCandidateNotes(candidateId);
  const HIRING_TASKS_QK = ["/api/tasks", "HIRING", candidateId] as const;
  const { data: tasks = [] } = useQuery<Array<{
    id: string; title: string; status: string; priority: string;
    dueDate: string | null; hiringCandidateId: string | null; createdAt: string;
    assignedToFirstName: string | null; assignedToLastName: string | null;
  }>>({
    queryKey: HIRING_TASKS_QK,
    queryFn: () =>
      apiRequest("GET", `/api/tasks?context=HIRING&hiringCandidateId=${candidateId}`).then((r) => r.json()),
    enabled: !!candidateId,
  });
  const createTaskMutation = useMutation({
    mutationFn: (data: { title: string; dueDate?: string }) =>
      apiRequest("POST", "/api/tasks", {
        title: data.title,
        dueDate: data.dueDate,
        context: "HIRING",
        hiringCandidateId: candidateId,
        status: "PENDING",
        priority: "MEDIUM",
        sourceType: "MANUAL",
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HIRING_TASKS_QK });
    },
  });
  const aiScoreMutation = useAiScoreCandidate(candidateId);

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
        <Button variant="ghost" onClick={() => navigate("/hiring?tab=candidates")} className="px-0 mt-2">
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
          <Button variant="ghost" size="sm" onClick={() => navigate("/hiring?tab=candidates")} className="mb-1 -ml-2" data-testid="button-back-candidates">
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

        {/* Right column — tabbed */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="resume" data-testid="candidate-tabs">
            <TabsList className="mb-4">
              <TabsTrigger value="resume" data-testid="tab-resume"><FileText className="w-3.5 h-3.5 mr-1.5" />Resume</TabsTrigger>
              {applicationAnswers && Object.keys(applicationAnswers).length > 0 && (
                <TabsTrigger value="application" data-testid="tab-application">Application</TabsTrigger>
              )}
              <TabsTrigger value="ai-review" data-testid="tab-ai-review"><Sparkles className="w-3.5 h-3.5 mr-1.5" />AI Review</TabsTrigger>
              <TabsTrigger value="tasks" data-testid="tab-tasks"><ClipboardList className="w-3.5 h-3.5 mr-1.5" />Tasks</TabsTrigger>
              <TabsTrigger value="activity" data-testid="tab-activity"><MessageSquare className="w-3.5 h-3.5 mr-1.5" />Activity</TabsTrigger>
            </TabsList>

            {/* Resume tab */}
            <TabsContent value="resume">
              <Card>
                <CardContent className="pt-5">
                  {candidate.resumeStorageKey ? (
                    candidate.resumeStorageKey.match(/\.(pdf)$/i) ? (
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
                    )
                  ) : (
                    <p className="text-sm text-muted-foreground">No resume on file</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Application answers tab */}
            {applicationAnswers && Object.keys(applicationAnswers).length > 0 && (
              <TabsContent value="application">
                <ApplicationAnswersAccordion answers={applicationAnswers} />
              </TabsContent>
            )}

            {/* AI Review tab */}
            <TabsContent value="ai-review">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-yellow-500" />AI Evaluation
                    </CardTitle>
                    {canRunAiReview && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          aiScoreMutation.mutate(undefined, {
                            onSuccess: (data) => {
                              setAiResult(data);
                              toast({ title: "AI review complete", description: `Score: ${data.score}/100 · ${data.recommendation}` });
                            },
                            onError: (err: Error) => toast({ title: "AI review failed", description: err.message, variant: "destructive" }),
                          });
                        }}
                        disabled={aiScoreMutation.isPending}
                        data-testid="button-run-ai-review"
                      >
                        {aiScoreMutation.isPending ? "Reviewing..." : "Run AI Review"}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {aiScoreMutation.isPending ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Sparkles className="w-4 h-4 animate-pulse text-yellow-500" />
                        Analyzing candidate profile…
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                        <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                        <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                      </div>
                    </div>
                  ) : (displayReview || candidate.aiScore != null || candidate.aiRecommendation) ? (
                    <div className="space-y-4">
                      {/* Scores row */}
                      <div className="flex items-center gap-4 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                          <span className="text-2xl font-bold">{displayReview?.score ?? candidate.aiScore ?? "—"}</span>
                          <span className="text-sm text-muted-foreground">/100</span>
                        </div>
                        {displayReview && (
                          <Badge
                            variant={displayReview.recommendation === "YES" ? "default" : displayReview.recommendation === "NO" ? "destructive" : "secondary"}
                            className="text-xs"
                            data-testid="badge-ai-recommendation"
                          >
                            {displayReview.recommendation}
                          </Badge>
                        )}
                      </div>

                      {/* Score bars */}
                      {displayReview && (
                        <div className="space-y-2">
                          <div data-testid="bar-trade-fit">
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground">Trade Fit</span>
                              <span className="font-medium">{displayReview.tradeFitScore}/100</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(100, displayReview.tradeFitScore)}%` }}
                              />
                            </div>
                          </div>
                          <div data-testid="bar-role-fit">
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground">Role Fit</span>
                              <span className="font-medium">{displayReview.roleFitScore}/100</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500"
                                style={{ width: `${Math.min(100, displayReview.roleFitScore)}%` }}
                              />
                            </div>
                          </div>
                          <div data-testid="bar-confidence">
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground">Confidence</span>
                              <span className="font-medium">{displayReview.confidenceScore}/100</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-purple-500"
                                style={{ width: `${Math.min(100, displayReview.confidenceScore)}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      {(displayReview?.summary || candidate.aiRecommendation) && (
                        <p className="text-sm" data-testid="text-ai-summary">{displayReview?.summary ?? candidate.aiRecommendation}</p>
                      )}

                      {/* Strengths */}
                      {displayReview?.strengths && displayReview.strengths.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">Strengths</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {displayReview.strengths.map((s, i) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Concerns */}
                      {displayReview?.concerns && displayReview.concerns.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-1">Concerns</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {displayReview.concerns.map((c, i) => <li key={i}>{c}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Red flags */}
                      {displayReview?.redFlags && displayReview.redFlags.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-destructive mb-1">Red Flags</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                            {displayReview.redFlags.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        </div>
                      )}

                      {/* Extracted data chips */}
                      {displayReview && (displayReview.extractedSkills.length > 0 || displayReview.extractedCerts.length > 0 || displayReview.extractedEquipment.length > 0) && (
                        <div className="space-y-1.5">
                          {displayReview.extractedSkills.length > 0 && (
                            <div>
                              <p className="text-xs font-medium mb-1 text-muted-foreground">Skills</p>
                              <div className="flex flex-wrap gap-1">
                                {displayReview.extractedSkills.map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                              </div>
                            </div>
                          )}
                          {displayReview.extractedCerts.length > 0 && (
                            <div>
                              <p className="text-xs font-medium mb-1 text-muted-foreground">Certifications</p>
                              <div className="flex flex-wrap gap-1">
                                {displayReview.extractedCerts.map((c, i) => <Badge key={i} variant="outline" className="text-xs">{c}</Badge>)}
                              </div>
                            </div>
                          )}
                          {displayReview.extractedEquipment.length > 0 && (
                            <div>
                              <p className="text-xs font-medium mb-1 text-muted-foreground">Equipment</p>
                              <div className="flex flex-wrap gap-1">
                                {displayReview.extractedEquipment.map((e, i) => <Badge key={i} variant="outline" className="text-xs">{e}</Badge>)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Interview focus */}
                      {displayReview?.interviewRecommendation && (
                        <div className="border-t pt-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Interview Focus</p>
                          <p className="text-xs">{displayReview.interviewRecommendation}</p>
                        </div>
                      )}

                      {/* Disclaimer */}
                      {displayReview?.disclaimer && (
                        <p className="text-xs text-muted-foreground italic border-t pt-2">{displayReview.disclaimer}</p>
                      )}

                      {/* Show last reviewed date + prompt version from persisted data */}
                      {!aiResult && persistedReview?.generatedAt && (
                        <div className="flex items-center justify-between border-t pt-2">
                          <p className="text-xs text-muted-foreground" data-testid="text-ai-last-reviewed">
                            Last reviewed: {format(new Date(persistedReview.generatedAt), "MMM d, yyyy")}
                          </p>
                          {persistedReview.promptVersion && (
                            <p className="text-xs text-muted-foreground" data-testid="text-ai-prompt-version">
                              {persistedReview.promptVersion.startsWith("v") ? persistedReview.promptVersion : `v${persistedReview.promptVersion}`}
                            </p>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground italic">
                        AI evaluation is advisory only. All hiring decisions must be made by a qualified human reviewer.
                      </p>
                    </div>
                  ) : (
                    <div className="text-center py-8 space-y-3">
                      <Sparkles className="w-8 h-8 text-muted-foreground mx-auto" />
                      <div>
                        <p className="font-medium">No AI evaluation yet</p>
                        <p className="text-sm text-muted-foreground">Run an AI review to score this candidate's fit for the role.</p>
                      </div>
                      {canRunAiReview && (
                        <Button
                          onClick={() => {
                            aiScoreMutation.mutate(undefined, {
                              onSuccess: (data) => {
                                setAiResult(data);
                                toast({ title: "AI review complete", description: `Score: ${data.score}/100 · ${data.recommendation}` });
                              },
                              onError: (err: Error) => toast({ title: "AI review failed", description: err.message, variant: "destructive" }),
                            });
                          }}
                          data-testid="button-run-ai-review-empty"
                        >
                          <Sparkles className="w-4 h-4 mr-2" />Run AI Review
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tasks tab */}
            <TabsContent value="tasks">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ClipboardList className="w-4 h-4" />Linked Tasks
                    </CardTitle>
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setShowTaskDialog(true)} data-testid="button-add-task">
                        <Plus className="w-3.5 h-3.5 mr-1" />Add Task
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {(tasks as HiringTask[]).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks linked to this candidate yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(tasks as HiringTask[]).map((task) => (
                        <LinkedTask
                          key={task.id}
                          task={task}
                          canEdit={canEdit}
                          onToggle={() => {
                            const newStatus = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
                            apiRequest("PATCH", `/api/tasks/${task.id}`, { status: newStatus })
                              .then(() => queryClient.invalidateQueries({ queryKey: HIRING_TASKS_QK }))
                              .catch(() => {});
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Activity tab */}
            <TabsContent value="activity">
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="text-base flex items-center gap-2"><MailIcon className="w-4 h-4" />Communications</CardTitle></CardHeader>
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
            </TabsContent>
          </Tabs>
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

      <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label>Task Title</Label>
              <Input
                placeholder="e.g. Schedule reference check"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                data-testid="input-task-title"
              />
            </div>
            <div className="space-y-1">
              <Label>Due Date (optional)</Label>
              <Input
                type="date"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
                data-testid="input-task-due"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTaskDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!newTaskTitle.trim()) return;
                createTaskMutation.mutate(
                  {
                    title: newTaskTitle.trim(),
                    dueDate: newTaskDue ? new Date(newTaskDue).toISOString() : undefined,
                  },
                  {
                    onSuccess: () => {
                      toast({ title: "Task created" });
                      setShowTaskDialog(false);
                      setNewTaskTitle("");
                      setNewTaskDue("");
                    },
                    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                  }
                );
              }}
              disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
              data-testid="button-save-task"
            >
              Add Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LinkedTask({ task, canEdit, onToggle }: { task: HiringTask; canEdit: boolean; onToggle: () => void }) {
  const isDone = task.status === "COMPLETED";

  return (
    <li className="flex items-start gap-2 text-sm" data-testid={`task-row-${task.id}`}>
      <button
        type="button"
        onClick={() => { if (canEdit) onToggle(); }}
        className="mt-0.5 shrink-0 hover:opacity-70 transition-opacity"
        data-testid={`button-toggle-task-${task.id}`}
        disabled={!canEdit}
      >
        {isDone
          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
          : <Circle className="w-4 h-4 text-muted-foreground" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={isDone ? "line-through text-muted-foreground" : ""}>{task.title}</p>
        {task.dueDate && (
          <p className="text-xs text-muted-foreground">
            Due {format(new Date(task.dueDate), "MMM d, yyyy")}
          </p>
        )}
      </div>
    </li>
  );
}
