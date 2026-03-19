import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarClock, Plus, Clock, MapPin, Users, ChevronRight, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useHiringCandidates, useHiringJobs } from "@/lib/hiring-api";
import type { HiringInterview, HiringCandidate, HiringJob } from "@/types/hiring";
import { format, formatDistanceToNow, isPast } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-600",
  NO_SHOW: "bg-red-100 text-red-800",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  SCHEDULED: <CalendarClock className="w-4 h-4" />,
  COMPLETED: <CheckCircle2 className="w-4 h-4 text-green-600" />,
  CANCELLED: <XCircle className="w-4 h-4 text-gray-400" />,
  NO_SHOW: <AlertCircle className="w-4 h-4 text-red-500" />,
};

const INTERVIEW_TYPES = ["PHONE", "VIDEO", "IN_PERSON", "PANEL", "TECHNICAL", "WORKING_INTERVIEW"];

const TYPE_LABELS: Record<string, string> = {
  PHONE: "Phone Screen",
  VIDEO: "Video Interview",
  IN_PERSON: "In-Person",
  PANEL: "Panel Interview",
  TECHNICAL: "Technical Assessment",
  WORKING_INTERVIEW: "Working Interview",
};

function useInterviews(candidateId?: string) {
  const qs = candidateId ? `?candidateId=${candidateId}` : "";
  return useQuery<HiringInterview[]>({
    queryKey: ["/api/hiring/interviews", candidateId ?? "all"],
    queryFn: () => fetch(`/api/hiring/interviews${qs}`, { credentials: "include" }).then((r) => r.json()),
  });
}

interface ScheduleFormState {
  candidateId: string;
  jobId: string;
  startAt: string;
  durationMinutes: string;
  interviewType: string;
  location: string;
  notes: string;
}

const EMPTY_FORM: ScheduleFormState = {
  candidateId: "",
  jobId: "",
  startAt: "",
  durationMinutes: "60",
  interviewType: "IN_PERSON",
  location: "",
  notes: "",
};

export default function HiringInterviewsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "HUSTLER" || role === "HR_MANAGER";

  const { data: interviews = [], isLoading } = useInterviews();
  const { data: candidates = [] } = useHiringCandidates();
  const { data: jobs = [] } = useHiringJobs();

  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState<ScheduleFormState>(EMPTY_FORM);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);
  const [statusEdit, setStatusEdit] = useState<{ id: string; status: string } | null>(null);

  const candidateMap = Object.fromEntries(candidates.map((c) => [c.id, c]));
  const jobMap = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const scheduleMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/hiring/interviews", data);
      return res.json() as Promise<HiringInterview>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/interviews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/analytics/dashboard"] });
      toast({ title: "Interview scheduled" });
      setShowDialog(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/hiring/interviews/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/interviews"] });
      toast({ title: "Interview updated" });
      setStatusEdit(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/hiring/interviews/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/interviews"] });
      toast({ title: "Interview cancelled" });
      setCancelConfirm(null);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleSchedule() {
    if (!form.candidateId || !form.startAt) {
      toast({ title: "Required fields missing", description: "Candidate and start time are required.", variant: "destructive" });
      return;
    }
    scheduleMutation.mutate({
      candidateId: form.candidateId || undefined,
      jobId: form.jobId || undefined,
      startAt: new Date(form.startAt).toISOString(),
      durationMinutes: Number(form.durationMinutes) || 60,
      interviewType: form.interviewType || undefined,
      location: form.location || undefined,
      notes: form.notes || undefined,
      status: "SCHEDULED",
    });
  }

  const upcoming = interviews.filter((i) => i.status === "SCHEDULED" && !isPast(new Date(i.scheduledAt)));
  const past = interviews.filter((i) => i.status !== "SCHEDULED" || isPast(new Date(i.scheduledAt)));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="heading-interviews">Interviews</h1>
          <p className="text-muted-foreground">Schedule and track candidate interviews</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowDialog(true)} data-testid="button-schedule-interview">
            <Plus className="w-4 h-4 mr-2" />Schedule Interview
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : interviews.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CalendarClock className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No interviews scheduled yet</p>
            {canEdit && (
              <Button className="mt-4" onClick={() => setShowDialog(true)} data-testid="button-schedule-first">
                Schedule Your First Interview
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Upcoming ({upcoming.length})</h2>
              <div className="space-y-3">
                {upcoming.map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    candidate={candidateMap[interview.candidateId]}
                    job={interview.jobId ? jobMap[interview.jobId] : undefined}
                    canEdit={canEdit}
                    onStatusEdit={() => setStatusEdit({ id: interview.id, status: interview.status })}
                    onCancel={() => setCancelConfirm(interview.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Past & Completed ({past.length})</h2>
              <div className="space-y-3">
                {past.slice(0, 20).map((interview) => (
                  <InterviewCard
                    key={interview.id}
                    interview={interview}
                    candidate={candidateMap[interview.candidateId]}
                    job={interview.jobId ? jobMap[interview.jobId] : undefined}
                    canEdit={canEdit}
                    onStatusEdit={() => setStatusEdit({ id: interview.id, status: interview.status })}
                    onCancel={() => setCancelConfirm(interview.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Interview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Candidate <span className="text-destructive">*</span></Label>
              <Select value={form.candidateId} onValueChange={(v) => setForm((f) => ({ ...f, candidateId: v }))}>
                <SelectTrigger data-testid="select-interview-candidate">
                  <SelectValue placeholder="Select candidate..." />
                </SelectTrigger>
                <SelectContent>
                  {candidates.filter((c) => !["HIRED", "REJECTED", "ARCHIVED"].includes(c.currentStage)).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Job (optional)</Label>
              <Select value={form.jobId} onValueChange={(v) => setForm((f) => ({ ...f, jobId: v }))}>
                <SelectTrigger data-testid="select-interview-job">
                  <SelectValue placeholder="Select job..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No job linked</SelectItem>
                  {jobs.filter((j) => j.status !== "ARCHIVED").map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date & Time <span className="text-destructive">*</span></Label>
                <Input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                  data-testid="input-interview-start"
                />
              </div>
              <div className="space-y-1">
                <Label>Duration (minutes)</Label>
                <Input
                  type="number"
                  min={15}
                  step={15}
                  value={form.durationMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                  data-testid="input-interview-duration"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Interview Type</Label>
              <Select value={form.interviewType} onValueChange={(v) => setForm((f) => ({ ...f, interviewType: v }))}>
                <SelectTrigger data-testid="select-interview-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVIEW_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Location / Link</Label>
              <Input
                placeholder="e.g. Office, Zoom link..."
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                data-testid="input-interview-location"
              />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Any special instructions or notes..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                data-testid="textarea-interview-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} data-testid="button-cancel-schedule">Cancel</Button>
            <Button
              onClick={handleSchedule}
              disabled={scheduleMutation.isPending}
              data-testid="button-confirm-schedule"
            >
              {scheduleMutation.isPending ? "Scheduling..." : "Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!statusEdit} onOpenChange={() => setStatusEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Update Interview Status</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Select
              value={statusEdit?.status ?? ""}
              onValueChange={(v) => setStatusEdit((s) => s ? { ...s, status: v } : null)}
            >
              <SelectTrigger data-testid="select-update-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="NO_SHOW">No Show</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusEdit(null)}>Cancel</Button>
            <Button
              onClick={() => { if (statusEdit) updateStatusMutation.mutate(statusEdit); }}
              disabled={updateStatusMutation.isPending}
              data-testid="button-save-status"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelConfirm} onOpenChange={() => setCancelConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Interview?</AlertDialogTitle>
            <AlertDialogDescription>This will mark the interview as cancelled. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-no">Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (cancelConfirm) cancelMutation.mutate(cancelConfirm); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-cancel-yes"
            >
              Cancel Interview
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InterviewCard({
  interview,
  candidate,
  job,
  canEdit,
  onStatusEdit,
  onCancel,
}: {
  interview: HiringInterview;
  candidate?: HiringCandidate;
  job?: HiringJob;
  canEdit: boolean;
  onStatusEdit: () => void;
  onCancel: () => void;
}) {
  const startDate = new Date(interview.scheduledAt);
  const isOverdue = interview.status === "SCHEDULED" && isPast(startDate);

  return (
    <Card className={isOverdue ? "border-orange-300" : ""} data-testid={`interview-card-${interview.id}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 shrink-0">{STATUS_ICONS[interview.status] ?? <CalendarClock className="w-4 h-4" />}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {candidate ? (
                  <Link href={`/hiring/candidates/${candidate.id}`} className="font-semibold hover:underline truncate" data-testid={`link-candidate-${candidate.id}`}>
                    {candidate.fullName}
                  </Link>
                ) : (
                  <span className="font-semibold text-muted-foreground">Unknown Candidate</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[interview.status] ?? "bg-gray-100"}`}>
                  {interview.status}
                </span>
                {isOverdue && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-800">Overdue</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" />
                  {format(startDate, "MMM d, yyyy 'at' h:mm a")}
                </span>
                {interview.durationMinutes && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {interview.durationMinutes} min
                  </span>
                )}
                {interview.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {interview.location}
                  </span>
                )}
                {interview.interviewType && (
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {TYPE_LABELS[interview.interviewType] ?? interview.interviewType}
                  </span>
                )}
              </div>
              {job && (
                <div className="mt-1 text-xs text-muted-foreground">
                  For: <Link href={`/hiring/jobs/${job.id}`} className="hover:underline">{job.title}</Link>
                </div>
              )}
              {interview.notes && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{interview.notes}</p>
              )}
            </div>
          </div>
          {canEdit && interview.status !== "CANCELLED" && (
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={onStatusEdit} data-testid={`button-update-status-${interview.id}`}>
                Update Status
              </Button>
              {interview.status === "SCHEDULED" && (
                <Button size="sm" variant="ghost" onClick={onCancel} className="text-destructive hover:text-destructive" data-testid={`button-cancel-${interview.id}`}>
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
