import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, todayIso, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { DailyInspectorReport } from "@shared/schema";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  DRAFT: "outline", SUBMITTED: "secondary", APPROVED: "default", REVISED: "secondary",
};

type Editing = DailyInspectorReport | "new" | null;

export default function DailyInspectorReportsPage() {
  const { toast } = useToast();
  const canView = useFeaturePermission("canViewInspectorReports");
  const canSubmit = useFeaturePermission("canSubmitInspectorReports");
  const canManage = useFeaturePermission("canManageInspectorReports");
  const canApprove = useFeaturePermission("canApproveInspectorReports");
  const canAccess = canView || canSubmit || canManage || canApprove;
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const queryKey = ["/api/daily-inspector-reports", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<DailyInspectorReport[]>({ queryKey, enabled: canAccess });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-inspector-reports">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view Daily Inspector Reports.</CardContent></Card>
      </div>
    );
  }

  const delMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/daily-inspector-reports/${id}`); },
    onSuccess: () => {
      toast({ title: "Report deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-inspector-reports"] });
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const handleDelete = (r: DailyInspectorReport) => {
    if (window.confirm(`Delete IDR for ${formatDate(r.reportDate)}?`)) delMut.mutate(r.id);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Daily Inspector Reports</h1>
          <p className="text-sm text-muted-foreground">DOT-style daily field reports — weather, crews, equipment, and work performed.</p>
        </div>
        {(canSubmit || canManage) && (<Button onClick={() => setEditing("new")} data-testid="button-new-idr"><Plus className="h-4 w-4 mr-2" />New IDR</Button>)}
      </div>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Filter by project</Label>
        <ProjectSelect value={projectId} onChange={setProjectId} testId="select-idr-project-filter" placeholder="All projects" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No daily inspector reports" description="Create your first daily inspector report to log weather, crews, and work performed." testId="empty-idr" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((r) => (
            <Card key={r.id} data-testid={`card-idr-${r.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{formatDate(r.reportDate)}</CardTitle>
                    {r.reportNumber && <div className="text-xs text-muted-foreground">#{r.reportNumber}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[r.status] || "outline"}>{r.status}</Badge>
                    {(canManage || canApprove) && (<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(r)} data-testid={`button-edit-idr-${r.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>)}
                    {canManage && (<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(r)} data-testid={`button-delete-idr-${r.id}`} aria-label="Delete" disabled={delMut.isPending}><Trash2 className="h-3.5 w-3.5" /></Button>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {r.inspectorName && <div><span className="text-muted-foreground">Inspector:</span> {r.inspectorName}</div>}
                {r.weatherConditions && <div><span className="text-muted-foreground">Weather:</span> {r.weatherConditions}</div>}
                {(r.temperatureHigh !== null || r.temperatureLow !== null) && (
                  <div><span className="text-muted-foreground">Temp:</span> {r.temperatureLow ?? "—"}° / {r.temperatureHigh ?? "—"}°</div>
                )}
                {(r.crewCount ?? 0) > 0 && <div><span className="text-muted-foreground">Crew:</span> {r.crewCount} · {r.crewHours} hrs</div>}
                {r.workPerformed && <div className="line-clamp-3 text-xs text-muted-foreground pt-1">{r.workPerformed}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <IdrForm key={editing === "new" ? "new" : editing.id} existing={editing === "new" ? null : editing} defaultProjectId={projectId} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

interface FormState {
  projectId: string; reportDate: string; reportNumber: string; status: string;
  inspectorName: string; weatherConditions: string; temperatureHigh: string; temperatureLow: string;
  precipitationInches: string; windSpeedMph: string; crewCount: string; crewHours: string;
  workPerformed: string; stationsWorked: string; deliveries: string; visitors: string;
  safetyIncidents: string; delaysEncountered: string;
}

function initial(existing: DailyInspectorReport | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "", reportDate: todayIso(), reportNumber: "", status: "DRAFT",
      inspectorName: "", weatherConditions: "", temperatureHigh: "", temperatureLow: "",
      precipitationInches: "", windSpeedMph: "", crewCount: "", crewHours: "",
      workPerformed: "", stationsWorked: "", deliveries: "", visitors: "",
      safetyIncidents: "", delaysEncountered: "",
    };
  }
  return {
    projectId: existing.projectId,
    reportDate: toDateInput(existing.reportDate) || todayIso(),
    reportNumber: existing.reportNumber ?? "",
    status: existing.status,
    inspectorName: existing.inspectorName ?? "",
    weatherConditions: existing.weatherConditions ?? "",
    temperatureHigh: existing.temperatureHigh?.toString() ?? "",
    temperatureLow: existing.temperatureLow?.toString() ?? "",
    precipitationInches: existing.precipitationInches ?? "",
    windSpeedMph: existing.windSpeedMph?.toString() ?? "",
    crewCount: existing.crewCount?.toString() ?? "",
    crewHours: existing.crewHours ?? "",
    workPerformed: existing.workPerformed ?? "",
    stationsWorked: existing.stationsWorked ?? "",
    deliveries: existing.deliveries ?? "",
    visitors: existing.visitors ?? "",
    safetyIncidents: existing.safetyIncidents ?? "",
    delaysEncountered: existing.delaysEncountered ?? "",
  };
}

function IdrForm({ existing, onClose, defaultProjectId }: { existing: DailyInspectorReport | null; onClose: () => void; defaultProjectId?: string }) {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageInspectorReports");
  const canApprove = useFeaturePermission("canApproveInspectorReports");
  const canSubmit = useFeaturePermission("canSubmitInspectorReports");
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      // Server strips status from PATCH; lifecycle goes through workflow
      // endpoints (/submit /approve /reject /request-revision) below.
      const { status: _status, ...rest } = data;
      const payload: Record<string, unknown> = {
        ...rest,
        temperatureHigh: data.temperatureHigh ? Number(data.temperatureHigh) : null,
        temperatureLow: data.temperatureLow ? Number(data.temperatureLow) : null,
        precipitationInches: data.precipitationInches || null,
        windSpeedMph: data.windSpeedMph ? Number(data.windSpeedMph) : null,
        crewCount: data.crewCount ? Number(data.crewCount) : 0,
        crewHours: data.crewHours || "0",
      };
      const url = existing ? `/api/daily-inspector-reports/${existing.id}` : "/api/daily-inspector-reports";
      const r = await apiRequest(existing ? "PATCH" : "POST", url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "IDR updated" : "IDR saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-inspector-reports"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getErrorMessage(error), variant: "destructive" }),
  });

  const transitionMut = useMutation({
    mutationFn: async (action: "submit" | "approve" | "reject" | "request-revision") => {
      if (!existing) throw new Error("Save the report first");
      const r = await apiRequest("POST", `/api/daily-inspector-reports/${existing.id}/${action}`, {});
      return r.json();
    },
    onSuccess: (_d, action) => {
      const labels: Record<string, string> = { submit: "submitted", approve: "approved", reject: "rejected", "request-revision": "sent for revision" };
      toast({ title: `IDR ${labels[action]}` });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-inspector-reports"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Workflow action failed", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{existing ? "Edit Daily Inspector Report" : "New Daily Inspector Report"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(form); }} className="space-y-3">
        <div>
          <Label>Project *</Label>
          <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} testId="select-idr-project" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Report Date *</Label>
            <Input type="date" required value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} data-testid="input-idr-date" />
          </div>
          <div>
            <Label>Report #</Label>
            <Input value={form.reportNumber} onChange={(e) => setForm({ ...form, reportNumber: e.target.value })} data-testid="input-idr-number" />
          </div>
          <div>
            <Label>Status</Label>
            <div className="h-10 flex items-center" data-testid="badge-idr-status">
              <Badge variant={STATUS_VARIANT[form.status] || "outline"}>{form.status}</Badge>
              <span className="text-xs text-muted-foreground ml-2">Use workflow actions below</span>
            </div>
          </div>
        </div>
        <div>
          <Label>Inspector Name</Label>
          <Input value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} data-testid="input-idr-inspector" />
        </div>
        <div>
          <Label>Weather Conditions</Label>
          <Input placeholder="e.g. Sunny, light wind" value={form.weatherConditions} onChange={(e) => setForm({ ...form, weatherConditions: e.target.value })} data-testid="input-idr-weather" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div><Label>Low °F</Label><Input inputMode="numeric" value={form.temperatureLow} onChange={(e) => setForm({ ...form, temperatureLow: e.target.value })} data-testid="input-idr-temp-low" /></div>
          <div><Label>High °F</Label><Input inputMode="numeric" value={form.temperatureHigh} onChange={(e) => setForm({ ...form, temperatureHigh: e.target.value })} data-testid="input-idr-temp-high" /></div>
          <div><Label>Rain (in)</Label><Input inputMode="decimal" value={form.precipitationInches} onChange={(e) => setForm({ ...form, precipitationInches: e.target.value })} data-testid="input-idr-rain" /></div>
          <div><Label>Wind (mph)</Label><Input inputMode="numeric" value={form.windSpeedMph} onChange={(e) => setForm({ ...form, windSpeedMph: e.target.value })} data-testid="input-idr-wind" /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Crew Count</Label><Input inputMode="numeric" value={form.crewCount} onChange={(e) => setForm({ ...form, crewCount: e.target.value })} data-testid="input-idr-crew-count" /></div>
          <div><Label>Crew Hours</Label><Input inputMode="decimal" value={form.crewHours} onChange={(e) => setForm({ ...form, crewHours: e.target.value })} data-testid="input-idr-crew-hours" /></div>
        </div>
        <div><Label>Work Performed</Label><Textarea rows={3} value={form.workPerformed} onChange={(e) => setForm({ ...form, workPerformed: e.target.value })} data-testid="input-idr-work" /></div>
        <div><Label>Stations Worked</Label><Input placeholder="e.g. Sta 100+00 to 110+50" value={form.stationsWorked} onChange={(e) => setForm({ ...form, stationsWorked: e.target.value })} data-testid="input-idr-stations" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Deliveries</Label><Textarea rows={2} value={form.deliveries} onChange={(e) => setForm({ ...form, deliveries: e.target.value })} data-testid="input-idr-deliveries" /></div>
          <div><Label>Visitors</Label><Textarea rows={2} value={form.visitors} onChange={(e) => setForm({ ...form, visitors: e.target.value })} data-testid="input-idr-visitors" /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><Label>Safety Incidents</Label><Textarea rows={2} value={form.safetyIncidents} onChange={(e) => setForm({ ...form, safetyIncidents: e.target.value })} data-testid="input-idr-safety" /></div>
          <div><Label>Delays</Label><Textarea rows={2} value={form.delaysEncountered} onChange={(e) => setForm({ ...form, delaysEncountered: e.target.value })} data-testid="input-idr-delays" /></div>
        </div>
        {existing && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground self-center mr-1">Workflow:</span>
            {(canSubmit || canManage) && (existing.status === "DRAFT" || existing.status === "REVISED") && (
              <Button type="button" size="sm" variant="secondary" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("submit")} data-testid="button-idr-submit">Submit</Button>
            )}
            {(canApprove || canManage) && existing.status === "SUBMITTED" && (
              <>
                <Button type="button" size="sm" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("approve")} data-testid="button-idr-approve">Approve</Button>
                <Button type="button" size="sm" variant="destructive" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("reject")} data-testid="button-idr-reject">Reject</Button>
                <Button type="button" size="sm" variant="outline" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("request-revision")} data-testid="button-idr-revise">Request Revision</Button>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-idr-cancel">Cancel</Button>
          <Button type="submit" disabled={mut.isPending || !form.projectId} data-testid="button-idr-save">
            {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Report" : "Save Report"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
