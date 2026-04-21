import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Mail, Phone, MessageSquare, Linkedin, ListChecks, Trash2, ChevronLeft, Pause, Play, X, AlertTriangle, Reply, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STEP_TYPES = [
  { v: "AUTOMATED_EMAIL", label: "Automated email", icon: Mail },
  { v: "MANUAL_EMAIL", label: "Manual email", icon: Mail },
  { v: "CALL_TASK", label: "Call task", icon: Phone },
  { v: "LINKEDIN_TASK", label: "LinkedIn task", icon: Linkedin },
  { v: "TODO", label: "To-do", icon: ListChecks },
];

interface Step {
  id: string;
  stepOrder: number;
  stepType: string;
  delayDays: number;
  sendHourLocal: number;
  subject?: string;
  body?: string;
  instructions?: string;
}
interface Sequence {
  id: string;
  name: string;
  description?: string;
  status: string;
  ownerId?: string;
  businessHoursOnly: boolean;
  weekdaysOnly: boolean;
  dailySendCap: number;
  optimizedSendWindowStartHour: number;
  optimizedSendWindowEndHour: number;
  steps: Step[];
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`,
}));

export default function SequenceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();

  const { data: seq, isLoading } = useQuery<Sequence>({
    queryKey: ["/api/crm/sequences", id],
  });

  const [exitReasonFilter, setExitReasonFilter] = useState<string>("ALL");
  const [sort, setSort] = useState<string>("createdAt:desc");

  const enrollmentsQS = (() => {
    const p = new URLSearchParams();
    if (exitReasonFilter !== "ALL") p.set("exitReason", exitReasonFilter);
    if (sort) p.set("sort", sort);
    const s = p.toString();
    return s ? `?${s}` : "";
  })();

  const { data: enrollData } = useQuery<{
    enrollments: any[];
    metrics: any[];
    steps: Step[];
  }>({
    queryKey: ["/api/crm/sequences", id, "enrollments", exitReasonFilter, sort],
    queryFn: async () => {
      const r = await fetch(`/api/crm/sequences/${id}/enrollments${enrollmentsQS}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load enrollments");
      return r.json();
    },
  });

  const updateMut = useMutation({
    mutationFn: async (patch: Partial<Sequence>) =>
      (await apiRequest("PATCH", `/api/crm/sequences/${id}`, patch)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id, "next-send"] });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save sequence", description: err?.message || "Please try again", variant: "destructive" });
    },
  });

  const { data: nextSend } = useQuery<{ nextSendAt: string | null }>({
    queryKey: ["/api/crm/sequences", id, "next-send"],
  });

  const addStepMut = useMutation({
    mutationFn: async (s: Partial<Step>) =>
      (await apiRequest("POST", `/api/crm/sequences/${id}/steps`, s)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id, "enrollments"] });
    },
  });

  const updateStepMut = useMutation({
    mutationFn: async ({ stepId, patch }: { stepId: string; patch: Partial<Step> }) =>
      (await apiRequest("PATCH", `/api/crm/sequences/${id}/steps/${stepId}`, patch)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id] }),
  });

  const deleteStepMut = useMutation({
    mutationFn: async (stepId: string) => apiRequest("DELETE", `/api/crm/sequences/${id}/steps/${stepId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id] }),
  });

  const enrollmentActionMut = useMutation({
    mutationFn: async ({ enrollmentId, action }: { enrollmentId: string; action: string }) =>
      (await apiRequest("POST", `/api/crm/sequences/enrollments/${enrollmentId}/${action}`)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/sequences", id, "enrollments"] }),
  });

  if (isLoading) return <div className="p-6"><Skeleton className="h-32" /></div>;
  if (!seq) return <div className="p-6">Not found</div>;

  return (
    <div className="p-6 space-y-6" data-testid="page-sequence-detail">
      <div className="flex items-center gap-3">
        <Link href="/sequences"><Button variant="ghost" size="sm" data-testid="button-back"><ChevronLeft className="h-4 w-4" />Back</Button></Link>
        <h1 className="text-2xl font-bold flex-1" data-testid="text-seq-name">{seq.name}</h1>
        <Badge variant="secondary" data-testid={`badge-seq-status-${seq.status}`}>{seq.status}</Badge>
        {seq.status !== "ACTIVE" && (
          <Button size="sm" onClick={() => updateMut.mutate({ status: "ACTIVE" })} data-testid="button-activate">Activate</Button>
        )}
        {seq.status === "ACTIVE" && (
          <Button size="sm" variant="outline" onClick={() => updateMut.mutate({ status: "DRAFT" })} data-testid="button-pause-seq">Set to draft</Button>
        )}
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder" data-testid="tab-builder">Builder</TabsTrigger>
          <TabsTrigger value="enrollees" data-testid="tab-enrollees">Enrollees & metrics</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Steps
                <AddStepButton onAdd={(s) => addStepMut.mutate(s)} nextOrder={(seq.steps?.length || 0) + 1} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(seq.steps || []).length === 0 ? (
                <p className="text-muted-foreground text-sm">No steps yet. Add one to start building this sequence.</p>
              ) : seq.steps.map((step) => (
                <StepEditor
                  key={step.id}
                  step={step}
                  onSave={(patch) => updateStepMut.mutate({ stepId: step.id, patch })}
                  onDelete={() => deleteStepMut.mutate(step.id)}
                />
              ))}
            </CardContent>
          </Card>
          <PreviewPanel sequenceId={id} steps={seq.steps || []} />
        </TabsContent>

        <TabsContent value="enrollees" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Per-step metrics</CardTitle></CardHeader>
            <CardContent>
              {!enrollData || enrollData.metrics.length === 0 ? (
                <p className="text-muted-foreground text-sm">No metrics yet.</p>
              ) : (
                <table className="w-full text-sm" data-testid="table-metrics">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2">Step</th><th>Type</th><th>Sent</th><th>Opened</th><th>Clicked</th><th>Replied</th><th>Bounced</th><th>Completed</th><th>Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollData.metrics.map((m: any) => (
                      <tr key={m.stepId} className="border-t" data-testid={`row-metric-${m.stepId}`}>
                        <td className="py-2">#{m.stepOrder}</td>
                        <td>{m.stepType}</td>
                        <td>{m.sent}</td><td>{m.opened}</td><td>{m.clicked}</td><td>{m.replied}</td><td>{m.bounced}</td><td>{m.completed}</td><td>{m.pending}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
                <span>Enrollees</span>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Exit reason</Label>
                  <Select value={exitReasonFilter} onValueChange={setExitReasonFilter}>
                    <SelectTrigger className="w-44 h-8" data-testid="select-filter-exit-reason"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All</SelectItem>
                      <SelectItem value="NONE">Still running</SelectItem>
                      <SelectItem value="REPLIED">Replied</SelectItem>
                      <SelectItem value="BOUNCED">Bounced</SelectItem>
                      <SelectItem value="OPPORTUNITY_WON">Opportunity won</SelectItem>
                      <SelectItem value="OPPORTUNITY_LOST">Opportunity lost</SelectItem>
                      <SelectItem value="MANUAL_REMOVE">Manually removed</SelectItem>
                      <SelectItem value="COMPLETED">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label className="text-xs text-muted-foreground">Sort</Label>
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="w-48 h-8" data-testid="select-sort-enrollees"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="createdAt:desc">Newest enrolled</SelectItem>
                      <SelectItem value="createdAt:asc">Oldest enrolled</SelectItem>
                      <SelectItem value="exitReason:asc">Exit reason (A→Z)</SelectItem>
                      <SelectItem value="exitReason:desc">Exit reason (Z→A)</SelectItem>
                      <SelectItem value="exitedAt:desc">Recently exited</SelectItem>
                      <SelectItem value="status:asc">Status (A→Z)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!enrollData || enrollData.enrollments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nobody enrolled yet.</p>
              ) : (
                <table className="w-full text-sm" data-testid="table-enrollees">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2">Contact</th><th>Email</th><th>Sender</th><th>Step</th><th>Status</th><th>Exit reason</th><th>Started</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrollData.enrollments.map((e: any) => (
                      <tr key={e.id} className="border-t" data-testid={`row-enrollee-${e.id}`}>
                        <td className="py-2">{e.contactName || "—"}</td>
                        <td>{e.contactEmail || "—"}</td>
                        <td>{e.senderName || "—"}</td>
                        <td>{e.currentStepIndex + 1}</td>
                        <td><Badge variant="secondary" data-testid={`badge-enroll-status-${e.id}`}>{e.status}</Badge></td>
                        <td><ExitReasonCell enrollment={e} /></td>
                        <td>{new Date(e.startAt).toLocaleDateString()}</td>
                        <td className="flex gap-1">
                          {e.status === "ACTIVE" && (
                            <Button size="sm" variant="ghost" onClick={() => enrollmentActionMut.mutate({ enrollmentId: e.id, action: "pause" })} data-testid={`button-pause-${e.id}`}>
                              <Pause className="h-3 w-3" />
                            </Button>
                          )}
                          {(e.status === "PAUSED" || e.status === "REPLIED") && (
                            <Button size="sm" variant="ghost" onClick={() => enrollmentActionMut.mutate({ enrollmentId: e.id, action: "resume" })} data-testid={`button-resume-${e.id}`}>
                              <Play className="h-3 w-3" />
                            </Button>
                          )}
                          {e.status !== "REMOVED" && e.status !== "FINISHED" && (
                            <Button size="sm" variant="ghost" onClick={() => enrollmentActionMut.mutate({ enrollmentId: e.id, action: "remove" })} data-testid={`button-remove-${e.id}`}>
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-3">
          <Card>
            <CardHeader><CardTitle>Sequence settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input defaultValue={seq.name} onBlur={(e) => e.target.value !== seq.name && updateMut.mutate({ name: e.target.value })} data-testid="input-edit-name" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea defaultValue={seq.description || ""} onBlur={(e) => e.target.value !== (seq.description || "") && updateMut.mutate({ description: e.target.value })} data-testid="input-edit-description" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Send only on weekdays</Label>
                <Switch checked={seq.weekdaysOnly} onCheckedChange={(c) => updateMut.mutate({ weekdaysOnly: c })} data-testid="switch-weekdays" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Respect business hours</Label>
                <Switch checked={seq.businessHoursOnly} onCheckedChange={(c) => updateMut.mutate({ businessHoursOnly: c })} data-testid="switch-business-hours" />
              </div>
              <div>
                <Label>Daily send cap (per org)</Label>
                <Input type="number" defaultValue={seq.dailySendCap} onBlur={(e) => updateMut.mutate({ dailySendCap: Number(e.target.value) })} data-testid="input-daily-cap" />
              </div>
              <div className="border-t pt-4 space-y-3">
                <div>
                  <Label className="text-base">Best-time send window</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    For steps with send-time optimization on, sends are deferred into this local-time window for each recipient. Default is 9 AM – 11 AM.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Start hour (local)</Label>
                    <Select
                      value={String(seq.optimizedSendWindowStartHour)}
                      onValueChange={(v) => updateMut.mutate({ optimizedSendWindowStartHour: Number(v) })}
                    >
                      <SelectTrigger data-testid="select-window-start"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>End hour (local)</Label>
                    <Select
                      value={String(seq.optimizedSendWindowEndHour)}
                      onValueChange={(v) => updateMut.mutate({ optimizedSendWindowEndHour: Number(v) })}
                    >
                      <SelectTrigger data-testid="select-window-end"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HOUR_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground" data-testid="text-next-send">
                  {nextSend?.nextSendAt
                    ? `Next planned send: ${new Date(nextSend.nextSendAt).toLocaleString()}`
                    : "No upcoming sends scheduled."}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExitReasonCell({ enrollment }: { enrollment: any }) {
  const reason: string | null = enrollment.exitReason || null;
  if (!reason) return <span className="text-muted-foreground text-xs" data-testid={`exit-reason-${enrollment.id}`}>—</span>;
  const exitedAt = enrollment.exitedAt ? new Date(enrollment.exitedAt).toLocaleString() : null;
  const cfg: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon?: any }> = {
    REPLIED: { label: "Replied", variant: "default", icon: Reply },
    BOUNCED: { label: "Bounced", variant: "destructive", icon: AlertTriangle },
    OPPORTUNITY_WON: { label: "Deal won", variant: "default" },
    OPPORTUNITY_LOST: { label: "Deal lost", variant: "secondary" },
    MANUAL_REMOVE: { label: "Removed", variant: "outline" },
    COMPLETED: { label: "Completed", variant: "secondary" },
  };
  const c = cfg[reason] || { label: reason, variant: "secondary" as const };
  const Icon = c.icon;
  return (
    <div className="flex flex-col gap-1" data-testid={`exit-reason-${enrollment.id}`}>
      <Badge variant={c.variant} className="w-fit gap-1" data-testid={`badge-exit-reason-${reason}-${enrollment.id}`}>
        {Icon && <Icon className="h-3 w-3" />}
        {c.label}
      </Badge>
      {exitedAt && <span className="text-[10px] text-muted-foreground" title={exitedAt}>{exitedAt}</span>}
      {reason === "BOUNCED" && enrollment.bounceEmailThreadId && (
        <Link href={`/email-assistant?threadId=${encodeURIComponent(enrollment.bounceEmailThreadId)}`}>
          <span className="text-xs text-primary inline-flex items-center gap-1 hover:underline cursor-pointer" data-testid={`link-bounce-email-${enrollment.id}`}>
            <ExternalLink className="h-3 w-3" />
            View bounce email
          </span>
        </Link>
      )}
      {reason === "BOUNCED" && !enrollment.bounceEmailThreadId && (
        <span className="text-[10px] text-muted-foreground italic">DSN not linked</span>
      )}
    </div>
  );
}

function AddStepButton({ onAdd, nextOrder }: { onAdd: (s: Partial<Step>) => void; nextOrder: number }) {
  const [type, setType] = useState("AUTOMATED_EMAIL");
  return (
    <div className="flex gap-2 items-center">
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="w-48" data-testid="select-new-step-type"><SelectValue /></SelectTrigger>
        <SelectContent>
          {STEP_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={() => onAdd({
        stepOrder: nextOrder,
        stepType: type,
        delayDays: 0,
        sendHourLocal: 9,
        subject: type.includes("EMAIL") ? "Hi {{contact.firstName}}" : `${type.replace("_", " ")} for {{contact.firstName}}`,
        body: type.includes("EMAIL") ? "Hi {{contact.firstName}},\n\nFollowing up on {{contact.company}}.\n\nThanks,\n{{user.firstName}}" : "",
        instructions: type.includes("EMAIL") ? "" : "Add notes about this step here.",
      })} data-testid="button-add-step">
        <Plus className="h-4 w-4 mr-1" />Add step
      </Button>
    </div>
  );
}

function StepEditor({ step, onSave, onDelete }: { step: Step; onSave: (p: Partial<Step>) => void; onDelete: () => void }) {
  const [delay, setDelay] = useState(step.delayDays);
  const [hour, setHour] = useState(step.sendHourLocal);
  const [subject, setSubject] = useState(step.subject || "");
  const [body, setBody] = useState(step.body || "");
  const [instructions, setInstructions] = useState(step.instructions || "");
  const isEmail = step.stepType.includes("EMAIL");
  const Icon = STEP_TYPES.find((t) => t.v === step.stepType)?.icon || ListChecks;

  return (
    <div className="border rounded p-3 space-y-2" data-testid={`step-editor-${step.id}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <Badge variant="outline">{step.stepType.replace("_", " ")}</Badge>
        <span className="text-sm text-muted-foreground">Step #{step.stepOrder}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onDelete} data-testid={`button-delete-step-${step.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Delay (days)</Label>
          <Input type="number" value={delay} onChange={(e) => setDelay(Number(e.target.value))} onBlur={() => delay !== step.delayDays && onSave({ delayDays: delay })} data-testid={`input-delay-${step.id}`} />
        </div>
        <div>
          <Label>Send hour (local)</Label>
          <Input type="number" min={0} max={23} value={hour} onChange={(e) => setHour(Number(e.target.value))} onBlur={() => hour !== step.sendHourLocal && onSave({ sendHourLocal: hour })} data-testid={`input-hour-${step.id}`} />
        </div>
      </div>
      <div>
        <Label>Subject {isEmail ? "" : "/ task title"}</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => subject !== (step.subject || "") && onSave({ subject })} data-testid={`input-subject-${step.id}`} />
      </div>
      {isEmail ? (
        <div>
          <Label>Body — supports {`{{contact.firstName}} {{contact.company}} {{user.firstName}}`}</Label>
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== (step.body || "") && onSave({ body })} data-testid={`input-body-${step.id}`} />
        </div>
      ) : (
        <div>
          <Label>Instructions for the rep</Label>
          <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} onBlur={() => instructions !== (step.instructions || "") && onSave({ instructions })} data-testid={`input-instructions-${step.id}`} />
        </div>
      )}
    </div>
  );
}

function PreviewPanel({ sequenceId, steps }: { sequenceId: string; steps: Step[] }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [contactId, setContactId] = useState("");
  const previewMut = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/crm/sequences/${sequenceId}/preview`, { stepIndex, contactId: contactId || undefined })).json(),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Preview rendered output</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Step to preview</Label>
            <Select value={String(stepIndex)} onValueChange={(v) => setStepIndex(Number(v))}>
              <SelectTrigger data-testid="select-preview-step"><SelectValue /></SelectTrigger>
              <SelectContent>
                {steps.map((s, i) => <SelectItem key={s.id} value={String(i)}>Step #{s.stepOrder} ({s.stepType})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sample contact ID (optional)</Label>
            <Input value={contactId} onChange={(e) => setContactId(e.target.value)} data-testid="input-preview-contact" placeholder="Leave blank for empty merge" />
          </div>
        </div>
        <Button size="sm" onClick={() => previewMut.mutate()} disabled={steps.length === 0} data-testid="button-preview">Render preview</Button>
        {previewMut.data && (
          <div className="border rounded p-3 bg-muted space-y-2" data-testid="preview-output">
            {previewMut.data.subject && <div><strong>Subject:</strong> {previewMut.data.subject}</div>}
            {previewMut.data.body && <div className="whitespace-pre-wrap">{previewMut.data.body}</div>}
            {previewMut.data.instructions && <div><strong>Instructions:</strong> {previewMut.data.instructions}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
