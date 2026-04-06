import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  MapPin, Video, Plus, Bell, Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useHiringInterviews, useScheduleInterview, useUpdateInterview } from "@/lib/hiring-api";
import { HiringInterview } from "@/types/hiring";
import { format, isPast, parseISO } from "date-fns";

const INTERVIEW_TYPES = [
  { value: "PHONE_SCREEN", label: "Phone Screen" },
  { value: "VIDEO_CALL", label: "Video Call" },
  { value: "IN_PERSON", label: "In Person" },
  { value: "PANEL", label: "Panel Interview" },
  { value: "TECHNICAL", label: "Technical Assessment" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
  RESCHEDULED: "Rescheduled",
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  COMPLETED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  RESCHEDULED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
};

const DEFAULT_FORM = {
  candidateId: "",
  jobId: undefined as string | undefined,
  startAt: "",
  endAt: "",
  timezone: "America/New_York",
  interviewType: "PHONE_SCREEN",
  location: "",
  videoLink: "",
  notes: "",
  interviewerUserIds: [] as string[],
};

export default function HiringInterviewsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.role;
  const canEdit = role === "ADMIN" || role === "HUSTLER" || role === "MANAGER";

  const [showSchedule, setShowSchedule] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [statusTarget, setStatusTarget] = useState<HiringInterview | null>(null);
  const [cancelTarget, setCancelTarget] = useState<HiringInterview | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const { data: allInterviews = [], isLoading } = useHiringInterviews();
  const { data: candidatesList = [] } = useQuery<Array<{ id: string; fullName: string; currentStage: string }>>({
    queryKey: ["/api/hiring/candidates"],
  });
  const { data: jobsList = [] } = useQuery<Array<{ id: string; title: string }>>({
    queryKey: ["/api/hiring/jobs"],
  });
  const { data: usersList = [] } = useQuery<Array<{ id: string; firstName: string; lastName: string; role: string }>>({
    queryKey: ["/api/users"],
  });
  const scheduleMutation = useScheduleInterview();
  const cancelMutation = useUpdateInterview(cancelTarget?.id ?? "");

  const interviews = allInterviews as HiringInterview[];

  const upcoming = interviews.filter((i) => {
    const active = i.status === "SCHEDULED" || i.status === "RESCHEDULED";
    return active && i.startAt && !isPast(parseISO(i.startAt));
  });

  const past = interviews.filter((i) => {
    if (i.status === "COMPLETED" || i.status === "CANCELLED" || i.status === "NO_SHOW") return true;
    return !i.startAt || isPast(parseISO(i.startAt));
  });

  const displayed = tab === "upcoming" ? upcoming : past;

  function handleSchedule() {
    if (!form.candidateId || !form.startAt) {
      toast({ title: "Required fields missing", description: "Candidate and start time are required.", variant: "destructive" });
      return;
    }
    scheduleMutation.mutate(
      {
        candidateId: form.candidateId,
        jobId: form.jobId || undefined,
        startAt: new Date(form.startAt).toISOString(),
        endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
        timezone: form.timezone || "America/New_York",
        interviewType: form.interviewType,
        location: form.location || undefined,
        videoLink: form.videoLink || undefined,
        notes: form.notes || undefined,
        interviewerUserIds: form.interviewerUserIds.length > 0 ? form.interviewerUserIds : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: "Interview scheduled" });
          setShowSchedule(false);
          setForm(DEFAULT_FORM);
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Interviews</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {upcoming.length} upcoming · {past.length} past
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowSchedule(true)} data-testid="button-schedule-interview">
            <Plus className="w-4 h-4 mr-1" />Schedule Interview
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          variant={tab === "upcoming" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("upcoming")}
          data-testid="tab-upcoming"
        >
          Upcoming ({upcoming.length})
        </Button>
        <Button
          variant={tab === "past" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("past")}
          data-testid="tab-past"
        >
          Past ({past.length})
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : displayed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No {tab === "upcoming" ? "upcoming" : "past"} interviews found.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="interview-table">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Candidate</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Date &amp; Time</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Interviewers</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  {canEdit && <th className="px-4 py-3 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {displayed.map((interview) => {
                  const startDate = interview.startAt ? parseISO(interview.startAt) : null;
                  const endDate = interview.endAt ? parseISO(interview.endAt) : null;
                  const typeLabel = INTERVIEW_TYPES.find((t) => t.value === interview.interviewType)?.label ?? interview.interviewType;
                  const hasReminder = !!interview.reminderSentAt;
                  return (
                    <tr key={interview.id} className="hover:bg-muted/30 transition-colors" data-testid={`interview-row-${interview.id}`}>
                      <td className="px-4 py-3 font-medium">
                        {interview.candidateName ?? interview.candidateId.slice(0, 8)}
                        {hasReminder && <Bell className="inline w-3 h-3 ml-1 text-blue-500" />}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{interview.jobTitle ?? "—"}</td>
                      <td className="px-4 py-3">{typeLabel}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {startDate ? (
                          <span>
                            {format(startDate, "MMM d, yyyy")}
                            <span className="text-muted-foreground ml-1">{format(startDate, "h:mm a")}</span>
                            {endDate && <span className="text-muted-foreground"> – {format(endDate, "h:mm a")}</span>}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[interview.status] ?? "bg-muted text-muted-foreground"}`} data-testid={`status-${interview.id}`}>
                          {interview.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          try {
                            const ids: string[] = JSON.parse(interview.interviewerUserIdsJson ?? "[]");
                            if (!ids.length) return <span className="text-muted-foreground">—</span>;
                            return (
                              <div className="flex flex-wrap gap-1">
                                {ids.map((uid) => {
                                  const u = usersList.find((x) => x.id === uid);
                                  return (
                                    <Badge key={uid} variant="outline" className="text-xs">
                                      {u ? `${u.firstName} ${u.lastName}` : uid.slice(0, 6)}
                                    </Badge>
                                  );
                                })}
                              </div>
                            );
                          } catch {
                            return <span className="text-muted-foreground">—</span>;
                          }
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {interview.videoLink ? (
                          <a href={interview.videoLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                            <Video className="w-3 h-3" />Video Link
                          </a>
                        ) : interview.location ? (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{interview.location}</span>
                        ) : "—"}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {(interview.status === "SCHEDULED" || interview.status === "RESCHEDULED") && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setStatusTarget(interview)}
                                  data-testid={`button-update-status-${interview.id}`}
                                >
                                  Update
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                  onClick={() => setCancelTarget(interview)}
                                  data-testid={`button-cancel-${interview.id}`}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Schedule Dialog */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Interview</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1">
              <Label>Candidate <span className="text-destructive">*</span></Label>
              <Select value={form.candidateId} onValueChange={(v) => setForm((f) => ({ ...f, candidateId: v }))}>
                <SelectTrigger data-testid="select-candidate">
                  <SelectValue placeholder="Select a candidate…" />
                </SelectTrigger>
                <SelectContent>
                  {(candidatesList as Array<{ id: string; fullName: string; currentStage: string }>).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.fullName} ({c.currentStage})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Job (optional)</Label>
              <Select value={form.jobId ?? "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, jobId: v === "__none__" ? undefined : v }))}>
                <SelectTrigger data-testid="select-job">
                  <SelectValue placeholder="Select a job…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No specific job</SelectItem>
                  {(jobsList as Array<{ id: string; title: string }>).map((j) => (
                    <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start <span className="text-destructive">*</span></Label>
                <Input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                  data-testid="input-start-at"
                />
              </div>
              <div className="space-y-1">
                <Label>End</Label>
                <Input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                  data-testid="input-end-at"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.interviewType} onValueChange={(v) => setForm((f) => ({ ...f, interviewType: v }))}>
                  <SelectTrigger data-testid="select-interview-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVIEW_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Timezone</Label>
                <Input
                  placeholder="America/New_York"
                  value={form.timezone}
                  onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                  data-testid="input-timezone"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Location</Label>
              <Input
                placeholder="Office address or leave blank for remote"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                data-testid="input-location"
              />
            </div>
            <div className="space-y-1">
              <Label>Video Link</Label>
              <Input
                placeholder="https://meet.google.com/..."
                value={form.videoLink}
                onChange={(e) => setForm((f) => ({ ...f, videoLink: e.target.value }))}
                data-testid="input-video-link"
              />
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="Topics to cover, instructions for candidate..."
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                data-testid="textarea-notes"
              />
            </div>
            {usersList.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Users className="w-4 h-4" /> Interviewers
                </Label>
                <div className="max-h-36 overflow-y-auto border rounded-md p-2 space-y-1" data-testid="interviewer-list">
                  {usersList.map((u) => {
                    const uid = u.id;
                    const checked = form.interviewerUserIds.includes(uid);
                    return (
                      <div key={uid} className="flex items-center gap-2">
                        <Checkbox
                          id={`interviewer-${uid}`}
                          checked={checked}
                          onCheckedChange={(val) =>
                            setForm((f) => ({
                              ...f,
                              interviewerUserIds: val
                                ? [...f.interviewerUserIds, uid]
                                : f.interviewerUserIds.filter((id) => id !== uid),
                            }))
                          }
                          data-testid={`checkbox-interviewer-${uid}`}
                        />
                        <label htmlFor={`interviewer-${uid}`} className="text-sm cursor-pointer">
                          {u.firstName} {u.lastName}
                          <span className="text-muted-foreground ml-1 text-xs">({u.role})</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
                {form.interviewerUserIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {form.interviewerUserIds.map((uid) => {
                      const u = usersList.find((x) => x.id === uid);
                      return u ? (
                        <Badge key={uid} variant="secondary" className="text-xs">
                          {u.firstName} {u.lastName}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSchedule(false)}>Cancel</Button>
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

      {/* Status Update Dialog */}
      {statusTarget && (
        <StatusUpdateDialog
          interview={statusTarget}
          onClose={() => setStatusTarget(null)}
        />
      )}

      {/* Cancel Confirm */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Interview?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the interview as cancelled. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelTarget(null)}>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!cancelTarget) return;
                cancelMutation.mutate(
                  { status: "CANCELLED" },
                  {
                    onSuccess: () => setCancelTarget(null),
                    onError: () => setCancelTarget(null),
                  }
                );
              }}
              data-testid="button-confirm-cancel"
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
  canEdit,
  onUpdateStatus,
  onCancel,
}: {
  interview: HiringInterview;
  canEdit: boolean;
  onUpdateStatus: (i: HiringInterview) => void;
  onCancel: (i: HiringInterview) => void;
}) {
  const startDate = interview.startAt ? parseISO(interview.startAt) : null;
  const endDate = interview.endAt ? parseISO(interview.endAt) : null;
  const hasReminder = !!interview.reminderSentAt;
  const typeLabel = INTERVIEW_TYPES.find((t) => t.value === interview.interviewType)?.label ?? interview.interviewType;

  return (
    <Card data-testid={`interview-card-${interview.id}`}>
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{interview.candidateName ?? interview.candidateId}</span>
              {interview.jobTitle && (
                <span className="text-xs text-muted-foreground">· {interview.jobTitle}</span>
              )}
              <span className="text-xs text-muted-foreground">({typeLabel})</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[interview.status] ?? "bg-muted text-muted-foreground"}`}
                data-testid={`status-${interview.id}`}
              >
                {STATUS_LABELS[interview.status] ?? interview.status}
              </span>
              {hasReminder && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Bell className="w-3 h-3" />Reminder sent
                </span>
              )}
            </div>

            {startDate && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span>{format(startDate, "EEE, MMM d, yyyy")}</span>
                <Clock className="w-3.5 h-3.5 ml-2" />
                <span>
                  {format(startDate, "h:mm a")}
                  {endDate && ` – ${format(endDate, "h:mm a")}`}
                  {interview.timezone && ` (${interview.timezone.split("/").pop()?.replace(/_/g, " ")})`}
                </span>
              </div>
            )}

            {interview.location && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />
                <span>{interview.location}</span>
              </div>
            )}

            {interview.videoLink && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Video className="w-3.5 h-3.5" />
                <a href={interview.videoLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-xs">
                  {interview.videoLink}
                </a>
              </div>
            )}

            {interview.notes && (
              <p className="text-xs text-muted-foreground border-t pt-1.5 mt-1.5">{interview.notes}</p>
            )}
          </div>

          {canEdit && (
            <div className="flex gap-2 shrink-0">
              {(interview.status === "SCHEDULED" || interview.status === "RESCHEDULED") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCancel(interview)}
                  data-testid={`button-cancel-${interview.id}`}
                >
                  Cancel
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onUpdateStatus(interview)}
                data-testid={`button-update-status-${interview.id}`}
              >
                <RotateCcw className="w-3 h-3 mr-1" />Update
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusUpdateDialog({
  interview,
  onClose,
}: {
  interview: HiringInterview;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState(interview.status);
  const [notes, setNotes] = useState(interview.notes ?? "");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const updateMutation = useUpdateInterview(interview.id);

  function handleSave() {
    const payload: Record<string, unknown> = { status, notes: notes || undefined };
    if (status === "RESCHEDULED" && rescheduleAt) {
      payload.startAt = new Date(rescheduleAt).toISOString();
    }
    updateMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Interview updated" });
        onClose();
      },
      onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update Interview Status</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as HiringInterview["status"])}>
              <SelectTrigger data-testid="select-new-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="RESCHEDULED">Rescheduled</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="NO_SHOW">No Show</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status === "RESCHEDULED" && (
            <div className="space-y-1">
              <Label>New Date/Time</Label>
              <Input
                type="datetime-local"
                value={rescheduleAt}
                onChange={(e) => setRescheduleAt(e.target.value)}
                data-testid="input-reschedule-at"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Interview notes or outcome..."
              data-testid="textarea-status-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-status">
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
