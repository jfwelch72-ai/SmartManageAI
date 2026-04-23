import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Droplets, Plus, Loader2, Pencil, Trash2, Wand2, CheckCircle2, RotateCcw, AlertTriangle, BellRing, BellOff } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, todayIso, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import {
  SWPPP_OVERDUE_REMINDER_DEFAULT_CAP,
  SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS,
  type SwpppInspection,
} from "@shared/schema";

function formatNextReminderHint(
  lastNotifiedAt: string | Date | null | undefined,
  intervalHours: number,
  now: Date = new Date(),
): string | null {
  if (!lastNotifiedAt) return null;
  const last = lastNotifiedAt instanceof Date ? lastNotifiedAt : new Date(lastNotifiedAt);
  if (Number.isNaN(last.getTime())) return null;
  const safeInterval = Number.isFinite(intervalHours) && intervalHours > 0
    ? intervalHours
    : SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS;
  const nextMs = last.getTime() + safeInterval * 60 * 60 * 1000;
  const diffMs = nextMs - now.getTime();
  if (diffMs <= 60 * 1000) return "Next reminder due in the next sweep";
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `Next reminder in ~${diffMin}m`;
  const diffHr = Math.round(diffMs / (60 * 60 * 1000));
  if (diffHr < 24) return `Next reminder in ~${diffHr}h`;
  const next = new Date(nextMs);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dayAfter = new Date(today.getTime() + 48 * 60 * 60 * 1000);
  if (next.getTime() >= tomorrow.getTime() && next.getTime() < dayAfter.getTime()) {
    const morningCutoff = new Date(tomorrow);
    morningCutoff.setHours(12, 0, 0, 0);
    return next.getTime() < morningCutoff.getTime()
      ? "Next reminder tomorrow morning"
      : "Next reminder tomorrow";
  }
  return `Next reminder on ${next.toLocaleDateString()}`;
}

interface SwpppSettings {
  organizationId: string;
  overdueReminderMaxCount: number;
  overdueReminderIntervalHours: number;
  defaults?: { overdueReminderMaxCount: number; overdueReminderIntervalHours: number };
}

const TYPES = ["ROUTINE", "POST_RAIN", "PRE_STORM", "FINAL", "OTHER"];

type Editing = SwpppInspection | "new" | null;

export default function SwpppInspectionsPage() {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageSwppp");
  const canView = useFeaturePermission("canViewSwppp");
  const canAccess = canView || canManage;
  const searchString = useSearch();
  const initialProjectId = new URLSearchParams(searchString).get("projectId") ?? "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "OVERDUE" | "RESOLVED">("ALL");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleteTarget, setDeleteTarget] = useState<SwpppInspection | null>(null);
  const queryKey = ["/api/swppp-inspections", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<SwpppInspection[]>({ queryKey, enabled: canAccess });

  // Sync filter with URL changes (e.g. deep links from notifications)
  useEffect(() => {
    const next = new URLSearchParams(searchString).get("projectId") ?? "";
    setProjectId((prev) => (prev === next ? prev : next));
  }, [searchString]);

  // Auto-open the inspection referenced by the deep link as soon as it's loaded
  const openedInspectionRef = useRef<string | null>(null);
  useEffect(() => {
    const targetId = new URLSearchParams(searchString).get("inspectionId");
    if (!targetId || !canAccess) return;
    if (openedInspectionRef.current === targetId) return;
    const match = data.find((d) => d.id === targetId);
    if (match) {
      openedInspectionRef.current = targetId;
      setEditing(match);
    }
  }, [searchString, data, canAccess]);
  const { data: swpppSettings } = useQuery<SwpppSettings>({
    queryKey: ["/api/swppp/settings"],
    enabled: canAccess,
  });
  const reminderCap = swpppSettings?.overdueReminderMaxCount ?? SWPPP_OVERDUE_REMINDER_DEFAULT_CAP;
  const reminderIntervalHours = swpppSettings?.overdueReminderIntervalHours ?? SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS;

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-swppp">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view SWPPP Inspections.</CardContent></Card>
      </div>
    );
  }

  const delMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/swppp-inspections/${id}`); },
    onSuccess: () => {
      toast({ title: "Inspection deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
      setDeleteTarget(null);
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const resolveMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/swppp-inspections/${id}/resolve`, {});
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Marked resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
    },
    onError: (error: Error) => toast({ title: "Failed to resolve", description: getErrorMessage(error), variant: "destructive" }),
  });

  const reopenMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiRequest("POST", `/api/swppp-inspections/${id}/reopen`, {});
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Reopened" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
    },
    onError: (error: Error) => toast({ title: "Failed to reopen", description: getErrorMessage(error), variant: "destructive" }),
  });

  const isOverdue = (s: SwpppInspection): boolean => {
    if (s.status === "RESOLVED" || !s.correctiveActionDueDate) return false;
    const due = new Date(s.correctiveActionDueDate as unknown as string);
    if (Number.isNaN(due.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due.getTime() < today.getTime();
  };

  const daysOverdue = (s: SwpppInspection): number => {
    if (!s.correctiveActionDueDate) return 0;
    const due = new Date(s.correctiveActionDueDate as unknown as string);
    if (Number.isNaN(due.getTime())) return 0;
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffMs = today.getTime() - due.getTime();
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  };

  const hasCorrective = (s: SwpppInspection): boolean =>
    Boolean((s.deficienciesFound && s.deficienciesFound.trim()) || (s.correctiveActions && s.correctiveActions.trim()));

  const statusOf = (s: SwpppInspection): "OPEN" | "OVERDUE" | "RESOLVED" | "NONE" => {
    if (!hasCorrective(s)) return "NONE";
    if (s.status === "RESOLVED") return "RESOLVED";
    return isOverdue(s) ? "OVERDUE" : "OPEN";
  };

  const counts = data.reduce(
    (acc, s) => {
      const st = statusOf(s);
      if (st === "OPEN") acc.open += 1;
      else if (st === "OVERDUE") {
        acc.overdue += 1;
        const days = daysOverdue(s);
        if (days > acc.maxDaysOverdue) acc.maxDaysOverdue = days;
      }
      else if (st === "RESOLVED") acc.resolved += 1;
      return acc;
    },
    { open: 0, overdue: 0, resolved: 0, maxDaysOverdue: 0 },
  );

  const filtered = data.filter((s) => {
    if (statusFilter === "ALL") return true;
    return statusOf(s) === statusFilter;
  });

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">SWPPP Inspections</h1>
          <p className="text-sm text-muted-foreground">NPDES storm water inspections — BMP checklists, deficiencies, and corrective actions.</p>
        </div>
        {canManage && (<Button onClick={() => setEditing("new")} data-testid="button-new-swppp"><Plus className="h-4 w-4 mr-2" />New Inspection</Button>)}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 max-w-md">
          <Label className="text-xs text-muted-foreground">Filter by project</Label>
          <ProjectSelect value={projectId} onChange={setProjectId} testId="select-swppp-project-filter" placeholder="All projects" />
        </div>
        <div className="w-full sm:w-48">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger data-testid="select-swppp-status-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isLoading && (counts.open > 0 || counts.overdue > 0 || counts.resolved > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="summary-swppp-counts">
          <span className="text-muted-foreground">Corrective actions:</span>
          <Badge variant={counts.open > 0 ? "secondary" : "outline"} data-testid="count-swppp-open">{counts.open} open</Badge>
          <Badge variant={counts.overdue > 0 ? "destructive" : "outline"} data-testid="count-swppp-overdue">
            {counts.overdue > 0 && <AlertTriangle className="h-3 w-3 mr-1" />}{counts.overdue} overdue
          </Badge>
          {counts.maxDaysOverdue > 0 && (
            <Badge variant="outline" className="border-destructive/60 text-destructive bg-destructive/5" data-testid="count-swppp-max-days-overdue">
              Oldest overdue: {counts.maxDaysOverdue} {counts.maxDaysOverdue === 1 ? "day" : "days"}
            </Badge>
          )}
          <Badge variant="outline" data-testid="count-swppp-resolved">
            <CheckCircle2 className="h-3 w-3 mr-1" />{counts.resolved} resolved
          </Badge>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={Droplets} title="No SWPPP inspections" description="Log a routine or post-rain inspection to maintain your storm-water compliance record." testId="empty-swppp" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Droplets} title="No matching inspections" description="No inspections match the selected status. Try changing the filter." testId="empty-swppp-filter" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const overdue = isOverdue(s);
            const resolved = s.status === "RESOLVED";
            const showCorrectiveControls = canManage && hasCorrective(s);
            return (
            <Card
              key={s.id}
              data-testid={`card-swppp-${s.id}`}
              className={overdue ? "border-destructive ring-1 ring-destructive/30" : undefined}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{formatDate(s.inspectionDate)}</CardTitle>
                    {s.inspectorName && <div className="text-xs text-muted-foreground">{s.inspectorName}</div>}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    <Badge variant="outline">{s.inspectionType.replace(/_/g, " ")}</Badge>
                    {hasCorrective(s) && (
                      resolved ? (
                        <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" data-testid={`status-swppp-${s.id}`}>
                          <CheckCircle2 className="h-3 w-3 mr-1" />Resolved
                        </Badge>
                      ) : overdue ? (
                        <Badge variant="destructive" data-testid={`status-swppp-${s.id}`}>
                          <AlertTriangle className="h-3 w-3 mr-1" />Overdue
                        </Badge>
                      ) : (
                        <Badge variant="secondary" data-testid={`status-swppp-${s.id}`}>Open</Badge>
                      )
                    )}
                    {canManage && (<><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(s)} data-testid={`button-edit-swppp-${s.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDeleteTarget(s)} data-testid={`button-delete-swppp-${s.id}`} aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button></>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s.rainfall24hrInches && <div><span className="text-muted-foreground">24hr rain:</span> {s.rainfall24hrInches} in</div>}
                {s.deficienciesFound && <div className="text-xs"><span className="text-muted-foreground">Deficiencies:</span> {s.deficienciesFound}</div>}
                {s.correctiveActions && <div className="text-xs"><span className="text-muted-foreground">Corrective:</span> {s.correctiveActions}</div>}
                {s.correctiveActionDueDate && (
                  <div className={`text-xs ${overdue ? "text-destructive font-medium" : ""}`}>
                    <span className="text-muted-foreground">Due:</span> {formatDate(s.correctiveActionDueDate)}
                    {overdue && <span className="ml-1">(overdue)</span>}
                    {overdue && (() => {
                      const days = daysOverdue(s);
                      if (days <= 0) return null;
                      return (
                        <span className="ml-1" data-testid={`text-swppp-days-overdue-${s.id}`}>
                          — {days} {days === 1 ? "day" : "days"} overdue
                        </span>
                      );
                    })()}
                  </div>
                )}
                {!resolved && overdue && (s.overdueReminderCount ?? 0) > 0 && (
                  (s.overdueReminderCount ?? 0) >= reminderCap ? (
                    <Badge
                      variant="outline"
                      className="text-xs border-destructive/60 text-destructive bg-destructive/5"
                      data-testid={`badge-swppp-reminders-capped-${s.id}`}
                    >
                      <BellOff className="h-3 w-3 mr-1" />
                      Reminders paused — cap of {reminderCap} reached
                    </Badge>
                  ) : (() => {
                    const nextHint = formatNextReminderHint(
                      s.lastOverdueNotifiedAt as unknown as string | null,
                      reminderIntervalHours,
                    );
                    return (
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge
                          variant="outline"
                          className="text-xs"
                          data-testid={`badge-swppp-reminders-${s.id}`}
                        >
                          <BellRing className="h-3 w-3 mr-1" />
                          Reminder {s.overdueReminderCount} of {reminderCap} sent
                        </Badge>
                        {nextHint && (
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid={`text-swppp-next-reminder-${s.id}`}
                          >
                            {nextHint}
                          </span>
                        )}
                      </div>
                    );
                  })()
                )}
                {resolved && s.resolvedAt && (
                  <div className="text-xs text-emerald-700 dark:text-emerald-400" data-testid={`text-resolved-${s.id}`}>
                    <span className="text-muted-foreground">Resolved:</span> {formatDate(s.resolvedAt as unknown as string)}
                  </div>
                )}
                {showCorrectiveControls && (
                  <div className="pt-2">
                    {resolved ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => reopenMut.mutate(s.id)}
                        disabled={reopenMut.isPending}
                        data-testid={`button-reopen-swppp-${s.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-2" />Reopen
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => resolveMut.mutate(s.id)}
                        disabled={resolveMut.isPending}
                        data-testid={`button-resolve-swppp-${s.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-2" />Mark Resolved
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <SwpppForm key={editing === "new" ? "new" : editing.id} existing={editing === "new" ? null : editing} defaultProjectId={projectId} onClose={() => setEditing(null)} />
        )}
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent data-testid="dialog-delete-swppp">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SWPPP Inspection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the <strong>{deleteTarget?.inspectionType.replace(/_/g, " ")}</strong> inspection from <strong>{deleteTarget ? formatDate(deleteTarget.inspectionDate) : ""}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-swppp-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={delMut.isPending}
              onClick={(e) => { e.preventDefault(); if (deleteTarget) delMut.mutate(deleteTarget.id); }}
              data-testid="button-delete-swppp-confirm"
            >
              {delMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FormState {
  projectId: string; inspectionDate: string; inspectionType: string;
  inspectorName: string; inspectorCertNumber: string;
  rainfall24hrInches: string; rainfallTriggerInches: string;
  deficienciesFound: string; correctiveActions: string; correctiveActionDueDate: string; notes: string;
}

function initial(existing: SwpppInspection | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "", inspectionDate: todayIso(), inspectionType: "ROUTINE",
      inspectorName: "", inspectorCertNumber: "",
      rainfall24hrInches: "", rainfallTriggerInches: "",
      deficienciesFound: "", correctiveActions: "", correctiveActionDueDate: "", notes: "",
    };
  }
  return {
    projectId: existing.projectId,
    inspectionDate: toDateInput(existing.inspectionDate) || todayIso(),
    inspectionType: existing.inspectionType,
    inspectorName: existing.inspectorName ?? "",
    inspectorCertNumber: existing.inspectorCertNumber ?? "",
    rainfall24hrInches: existing.rainfall24hrInches ?? "",
    rainfallTriggerInches: existing.rainfallTriggerInches ?? "",
    deficienciesFound: existing.deficienciesFound ?? "",
    correctiveActions: existing.correctiveActions ?? "",
    correctiveActionDueDate: toDateInput(existing.correctiveActionDueDate),
    notes: existing.notes ?? "",
  };
}

function SwpppForm({ existing, onClose, defaultProjectId }: { existing: SwpppInspection | null; onClose: () => void; defaultProjectId?: string }) {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageSwppp");
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);
  const { data: swpppSettings } = useQuery<SwpppSettings>({ queryKey: ["/api/swppp/settings"] });
  const reminderCap = swpppSettings?.overdueReminderMaxCount ?? SWPPP_OVERDUE_REMINDER_DEFAULT_CAP;
  const reminderIntervalHours = swpppSettings?.overdueReminderIntervalHours ?? SWPPP_OVERDUE_REMINDER_DEFAULT_INTERVAL_HOURS;

  const resolveMut = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error("Save the inspection before resolving.");
      const r = await apiRequest("POST", `/api/swppp-inspections/${existing.id}/resolve`, {});
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Marked resolved" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to resolve", description: getErrorMessage(error), variant: "destructive" }),
  });

  const reopenMut = useMutation({
    mutationFn: async () => {
      if (!existing) throw new Error("Save the inspection first.");
      const r = await apiRequest("POST", `/api/swppp-inspections/${existing.id}/reopen`, {});
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Reopened" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to reopen", description: getErrorMessage(error), variant: "destructive" }),
  });

  const aiDraftMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ai-features/heavy-civil/swppp/draft-corrective", {
        deficienciesFound: form.deficienciesFound,
        inspectionType: form.inspectionType,
        rainfall24hrInches: form.rainfall24hrInches || undefined,
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data?.fallback) { toast({ title: "AI couldn't draft corrective actions", description: data.message ?? "Enter manually." }); return; }
      const due = data?.recommendedDueDays && Number.isFinite(Number(data.recommendedDueDays))
        ? new Date(Date.now() + Number(data.recommendedDueDays) * 86400000).toISOString().slice(0, 10)
        : form.correctiveActionDueDate;
      setForm((prev) => ({
        ...prev,
        correctiveActions: data.correctiveActions ?? prev.correctiveActions,
        correctiveActionDueDate: prev.correctiveActionDueDate || due,
      }));
      toast({ title: "AI draft inserted", description: `Confidence ${data.confidence ?? "—"}/100. Review before saving.` });
    },
    onError: (error: Error) => toast({ title: "AI draft failed", description: getErrorMessage(error), variant: "destructive" }),
  });

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const payload: Record<string, unknown> = {
        ...data,
        rainfall24hrInches: data.rainfall24hrInches || null,
        rainfallTriggerInches: data.rainfallTriggerInches || null,
        correctiveActionDueDate: data.correctiveActionDueDate || null,
      };
      const url = existing ? `/api/swppp-inspections/${existing.id}` : "/api/swppp-inspections";
      const r = await apiRequest(existing ? "PATCH" : "POST", url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Inspection updated" : "SWPPP inspection saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/swppp-inspections"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{existing ? "Edit SWPPP Inspection" : "New SWPPP Inspection"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(form); }} className="space-y-3">
        <div>
          <Label>Project *</Label>
          <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} testId="select-swppp-project" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Date *</Label><Input type="date" required value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} data-testid="input-swppp-date" /></div>
          <div>
            <Label>Type *</Label>
            <Select value={form.inspectionType} onValueChange={(v) => setForm({ ...form, inspectionType: v })}>
              <SelectTrigger data-testid="select-swppp-type"><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Inspector Name</Label><Input value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} data-testid="input-swppp-inspector" /></div>
          <div><Label>Cert Number</Label><Input value={form.inspectorCertNumber} onChange={(e) => setForm({ ...form, inspectorCertNumber: e.target.value })} data-testid="input-swppp-cert" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>24hr Rainfall (in)</Label><Input inputMode="decimal" value={form.rainfall24hrInches} onChange={(e) => setForm({ ...form, rainfall24hrInches: e.target.value })} data-testid="input-swppp-rain" /></div>
          <div><Label>Trigger (in)</Label><Input inputMode="decimal" value={form.rainfallTriggerInches} onChange={(e) => setForm({ ...form, rainfallTriggerInches: e.target.value })} data-testid="input-swppp-trigger" /></div>
        </div>
        <div><Label>Deficiencies Found</Label><Textarea rows={2} value={form.deficienciesFound} onChange={(e) => setForm({ ...form, deficienciesFound: e.target.value })} data-testid="input-swppp-deficiencies" /></div>
        <div>
          <div className="flex items-center justify-between">
            <Label>Corrective Actions</Label>
            <Button type="button" size="sm" variant="outline" disabled={aiDraftMut.isPending || form.deficienciesFound.length < 5} onClick={() => aiDraftMut.mutate()} data-testid="button-swppp-ai-draft">
              {aiDraftMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-2" />}AI Draft
            </Button>
          </div>
          <Textarea rows={3} value={form.correctiveActions} onChange={(e) => setForm({ ...form, correctiveActions: e.target.value })} data-testid="input-swppp-corrective" />
        </div>
        <div><Label>Corrective Action Due Date</Label><Input type="date" value={form.correctiveActionDueDate} onChange={(e) => setForm({ ...form, correctiveActionDueDate: e.target.value })} data-testid="input-swppp-due" /></div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-swppp-notes" /></div>
        {existing && existing.status !== "RESOLVED" && (existing.overdueReminderCount ?? 0) > 0 && (() => {
          const dueRaw = existing.correctiveActionDueDate as unknown as string | null;
          if (!dueRaw) return false;
          const due = new Date(dueRaw);
          if (Number.isNaN(due.getTime())) return false;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return due.getTime() < today.getTime();
        })() && (
          (existing.overdueReminderCount ?? 0) >= reminderCap ? (
            <div
              className="flex items-center gap-2 rounded-md border border-destructive/60 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              data-testid="detail-swppp-reminders-capped"
            >
              <BellOff className="h-3.5 w-3.5" />
              Overdue reminders paused — cap of {reminderCap} reached. Move the corrective-action due date forward or reopen the inspection to restart reminders.
            </div>
          ) : (() => {
            const nextHint = formatNextReminderHint(
              existing.lastOverdueNotifiedAt as unknown as string | null,
              reminderIntervalHours,
            );
            return (
              <div
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                data-testid="detail-swppp-reminders"
              >
                <BellRing className="h-3.5 w-3.5" />
                <span>
                  Reminder {existing.overdueReminderCount} of {reminderCap} sent for this overdue corrective action.
                  {nextHint && (
                    <span className="ml-1" data-testid="detail-swppp-next-reminder">
                      {nextHint}.
                    </span>
                  )}
                </span>
              </div>
            );
          })()
        )}
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between sm:items-center gap-2">
          <div className="flex items-center gap-2">
            {existing && canManage && (form.deficienciesFound.trim() || form.correctiveActions.trim()) && (
              existing.status === "RESOLVED" ? (
                <Button type="button" variant="outline" onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending} data-testid="button-swppp-reopen">
                  {reopenMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}Reopen
                </Button>
              ) : (
                <Button type="button" variant="default" onClick={() => resolveMut.mutate()} disabled={resolveMut.isPending} data-testid="button-swppp-resolve">
                  {resolveMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}Mark Resolved
                </Button>
              )
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose} data-testid="button-swppp-cancel">Cancel</Button>
            <Button type="submit" disabled={mut.isPending || !form.projectId} data-testid="button-swppp-save">
              {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Inspection" : "Save Inspection"}
            </Button>
          </div>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
