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
import { Droplets, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, todayIso, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { SwpppInspection } from "@shared/schema";

const TYPES = ["ROUTINE", "POST_RAIN", "PRE_STORM", "FINAL", "OTHER"];

type Editing = SwpppInspection | "new" | null;

export default function SwpppInspectionsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = useFeaturePermission("canManageSwppp");
  const isPrivilegedRole = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPER_ADMIN" || user?.role === "SUPERINTENDENT";
  const canAccess = isPrivilegedRole || canManage;
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const queryKey = ["/api/swppp-inspections", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<SwpppInspection[]>({ queryKey, enabled: canAccess });

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
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const handleDelete = (s: SwpppInspection) => {
    if (window.confirm(`Delete SWPPP inspection from ${formatDate(s.inspectionDate)}?`)) delMut.mutate(s.id);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">SWPPP Inspections</h1>
          <p className="text-sm text-muted-foreground">NPDES storm water inspections — BMP checklists, deficiencies, and corrective actions.</p>
        </div>
        {canManage && (<Button onClick={() => setEditing("new")} data-testid="button-new-swppp"><Plus className="h-4 w-4 mr-2" />New Inspection</Button>)}
      </div>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Filter by project</Label>
        <ProjectSelect value={projectId} onChange={setProjectId} testId="select-swppp-project-filter" placeholder="All projects" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={Droplets} title="No SWPPP inspections" description="Log a routine or post-rain inspection to maintain your storm-water compliance record." testId="empty-swppp" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id} data-testid={`card-swppp-${s.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{formatDate(s.inspectionDate)}</CardTitle>
                    {s.inspectorName && <div className="text-xs text-muted-foreground">{s.inspectorName}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="outline">{s.inspectionType.replace(/_/g, " ")}</Badge>
                    {canManage && (<><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(s)} data-testid={`button-edit-swppp-${s.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(s)} data-testid={`button-delete-swppp-${s.id}`} aria-label="Delete" disabled={delMut.isPending}><Trash2 className="h-3.5 w-3.5" /></Button></>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {s.rainfall24hrInches && <div><span className="text-muted-foreground">24hr rain:</span> {s.rainfall24hrInches} in</div>}
                {s.deficienciesFound && <div className="text-xs"><span className="text-muted-foreground">Deficiencies:</span> {s.deficienciesFound}</div>}
                {s.correctiveActions && <div className="text-xs"><span className="text-muted-foreground">Corrective:</span> {s.correctiveActions}</div>}
                {s.correctiveActionDueDate && <div className="text-xs"><span className="text-muted-foreground">Due:</span> {formatDate(s.correctiveActionDueDate)}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <SwpppForm key={editing === "new" ? "new" : editing.id} existing={editing === "new" ? null : editing} defaultProjectId={projectId} onClose={() => setEditing(null)} />
        )}
      </Dialog>
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
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);

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
        <div><Label>Corrective Actions</Label><Textarea rows={2} value={form.correctiveActions} onChange={(e) => setForm({ ...form, correctiveActions: e.target.value })} data-testid="input-swppp-corrective" /></div>
        <div><Label>Corrective Action Due Date</Label><Input type="date" value={form.correctiveActionDueDate} onChange={(e) => setForm({ ...form, correctiveActionDueDate: e.target.value })} data-testid="input-swppp-due" /></div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-swppp-notes" /></div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-swppp-cancel">Cancel</Button>
          <Button type="submit" disabled={mut.isPending || !form.projectId} data-testid="button-swppp-save">
            {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Inspection" : "Save Inspection"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
