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
import { Flag, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { MaterialCertification } from "@shared/schema";

const STATUSES = ["PENDING", "VERIFIED", "WAIVER_REQUESTED", "WAIVER_GRANTED", "NON_COMPLIANT"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PENDING: "outline", VERIFIED: "default", WAIVER_REQUESTED: "secondary", WAIVER_GRANTED: "secondary", NON_COMPLIANT: "destructive",
};

type Editing = MaterialCertification | "new" | null;

export default function MaterialCertificationsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = useFeaturePermission("canManageMaterialCertifications");
  const canVerify = useFeaturePermission("canVerifyMaterialCertifications");
  const canView = useFeaturePermission("canViewMaterialCertifications");
  const canAccess = canView || canManage || canVerify;
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const queryKey = ["/api/material-certifications", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<MaterialCertification[]>({ queryKey, enabled: canAccess });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-material-certifications">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view Material Certifications.</CardContent></Card>
      </div>
    );
  }

  const delMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/material-certifications/${id}`); },
    onSuccess: () => {
      toast({ title: "Certification deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/material-certifications"] });
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const handleDelete = (c: MaterialCertification) => {
    if (window.confirm(`Delete certification for ${c.materialDescription}?`)) delMut.mutate(c.id);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Material Certifications</h1>
          <p className="text-sm text-muted-foreground">Buy America compliance — manufacturer, mill, heat number, and certification status for each material delivery.</p>
        </div>
        {canManage && (<Button onClick={() => setEditing("new")} data-testid="button-new-cert"><Plus className="h-4 w-4 mr-2" />New Certification</Button>)}
      </div>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Filter by project</Label>
        <ProjectSelect value={projectId} onChange={setProjectId} testId="select-cert-project-filter" placeholder="All projects" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={Flag} title="No material certifications" description="Add a certification to track Buy America compliance for steel, iron, and other manufactured materials." testId="empty-certs" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((c) => (
            <Card key={c.id} data-testid={`card-cert-${c.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{c.materialDescription}</CardTitle>
                    {c.certNumber && <div className="text-xs text-muted-foreground truncate">Cert #{c.certNumber}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[c.buyAmericaStatus] || "outline"}>{c.buyAmericaStatus.replace(/_/g, " ")}</Badge>
                    {(canManage || canVerify) && (<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(c)} data-testid={`button-edit-cert-${c.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>)}
                    {canManage && (<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(c)} data-testid={`button-delete-cert-${c.id}`} aria-label="Delete" disabled={delMut.isPending}><Trash2 className="h-3.5 w-3.5" /></Button>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {c.manufacturerName && <div><span className="text-muted-foreground">Mfr:</span> {c.manufacturerName} {c.manufacturerCountry ? `(${c.manufacturerCountry})` : ""}</div>}
                {c.millName && <div><span className="text-muted-foreground">Mill:</span> {c.millName} {c.millCountry ? `(${c.millCountry})` : ""}</div>}
                {c.heatNumber && <div><span className="text-muted-foreground">Heat #:</span> {c.heatNumber}</div>}
                {c.payItemNumber && <div><span className="text-muted-foreground">Pay Item:</span> {c.payItemNumber}</div>}
                {c.receivedDate && <div className="text-xs"><span className="text-muted-foreground">Received:</span> {formatDate(c.receivedDate)}</div>}
                {c.waiverReason && <div className="text-xs text-muted-foreground line-clamp-2 pt-1">{c.waiverReason}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <CertForm key={editing === "new" ? "new" : editing.id} existing={editing === "new" ? null : editing} defaultProjectId={projectId} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

interface FormState {
  projectId: string; materialDescription: string; payItemNumber: string;
  manufacturerName: string; manufacturerCountry: string; millName: string; millCountry: string;
  heatNumber: string; certNumber: string; buyAmericaStatus: string;
  waiverReason: string; receivedDate: string; notes: string;
}

function initial(existing: MaterialCertification | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "", materialDescription: "", payItemNumber: "",
      manufacturerName: "", manufacturerCountry: "USA", millName: "", millCountry: "USA",
      heatNumber: "", certNumber: "", buyAmericaStatus: "PENDING",
      waiverReason: "", receivedDate: "", notes: "",
    };
  }
  return {
    projectId: existing.projectId,
    materialDescription: existing.materialDescription,
    payItemNumber: existing.payItemNumber ?? "",
    manufacturerName: existing.manufacturerName ?? "",
    manufacturerCountry: existing.manufacturerCountry ?? "USA",
    millName: existing.millName ?? "",
    millCountry: existing.millCountry ?? "USA",
    heatNumber: existing.heatNumber ?? "",
    certNumber: existing.certNumber ?? "",
    buyAmericaStatus: existing.buyAmericaStatus,
    waiverReason: existing.waiverReason ?? "",
    receivedDate: toDateInput(existing.receivedDate),
    notes: existing.notes ?? "",
  };
}

function CertForm({ existing, onClose, defaultProjectId }: { existing: MaterialCertification | null; onClose: () => void; defaultProjectId?: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const payload: Record<string, unknown> = { ...data, receivedDate: data.receivedDate || null };
      const url = existing ? `/api/material-certifications/${existing.id}` : "/api/material-certifications";
      const r = await apiRequest(existing ? "PATCH" : "POST", url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Certification updated" : "Certification saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/material-certifications"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{existing ? "Edit Material Certification" : "New Material Certification"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(form); }} className="space-y-3">
        <div>
          <Label>Project *</Label>
          <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} testId="select-cert-project" />
        </div>
        <div>
          <Label>Material Description *</Label>
          <Input required placeholder="e.g. #6 reinforcing steel rebar" value={form.materialDescription} onChange={(e) => setForm({ ...form, materialDescription: e.target.value })} data-testid="input-cert-material" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Pay Item #</Label><Input value={form.payItemNumber} onChange={(e) => setForm({ ...form, payItemNumber: e.target.value })} data-testid="input-cert-pay-item" /></div>
          <div><Label>Cert #</Label><Input value={form.certNumber} onChange={(e) => setForm({ ...form, certNumber: e.target.value })} data-testid="input-cert-number" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Manufacturer</Label><Input value={form.manufacturerName} onChange={(e) => setForm({ ...form, manufacturerName: e.target.value })} data-testid="input-cert-mfr" /></div>
          <div><Label>Manufacturer Country</Label><Input value={form.manufacturerCountry} onChange={(e) => setForm({ ...form, manufacturerCountry: e.target.value })} data-testid="input-cert-mfr-country" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Mill Name</Label><Input value={form.millName} onChange={(e) => setForm({ ...form, millName: e.target.value })} data-testid="input-cert-mill" /></div>
          <div><Label>Mill Country</Label><Input value={form.millCountry} onChange={(e) => setForm({ ...form, millCountry: e.target.value })} data-testid="input-cert-mill-country" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Heat #</Label><Input value={form.heatNumber} onChange={(e) => setForm({ ...form, heatNumber: e.target.value })} data-testid="input-cert-heat" /></div>
          <div><Label>Received Date</Label><Input type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} data-testid="input-cert-received" /></div>
        </div>
        <div>
          <Label>Buy America Status *</Label>
          <Select value={form.buyAmericaStatus} onValueChange={(v) => setForm({ ...form, buyAmericaStatus: v })}>
            <SelectTrigger data-testid="select-cert-status"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Waiver Reason (if applicable)</Label><Textarea rows={2} value={form.waiverReason} onChange={(e) => setForm({ ...form, waiverReason: e.target.value })} data-testid="input-cert-waiver" /></div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-cert-notes" /></div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-cert-cancel">Cancel</Button>
          <Button type="submit" disabled={mut.isPending || !form.projectId} data-testid="button-cert-save">
            {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Certification" : "Save Certification"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
