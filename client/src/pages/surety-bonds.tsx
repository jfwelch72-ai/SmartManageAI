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
import { ShieldCheck, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, formatMoney, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { SuretyBond } from "@shared/schema";

const BOND_TYPES = ["BID", "PERFORMANCE", "PAYMENT", "MAINTENANCE", "SUPPLY", "WARRANTY", "LICENSE", "OTHER"];
const BOND_STATUSES = ["DRAFT", "ACTIVE", "EXPIRED", "RELEASED", "CLAIMED", "CANCELED"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline", ACTIVE: "default", EXPIRED: "destructive", RELEASED: "secondary", CLAIMED: "destructive", CANCELED: "outline",
};

type Editing = SuretyBond | "new" | null;

export default function SuretyBondsPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = useFeaturePermission("canManageSuretyBonds");
  const canView = useFeaturePermission("canViewSuretyBonds");
  const canAccess = canView || canManage;
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const queryKey = ["/api/surety-bonds", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<SuretyBond[]>({ queryKey, enabled: canAccess });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-surety-bonds">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view Surety Bonds.</CardContent></Card>
      </div>
    );
  }

  const delMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/surety-bonds/${id}`); },
    onSuccess: () => {
      toast({ title: "Bond deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/surety-bonds"] });
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const handleDelete = (b: SuretyBond) => {
    if (window.confirm(`Delete bond ${b.bondNumber}?`)) delMut.mutate(b.id);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Surety Bonds</h1>
          <p className="text-sm text-muted-foreground">Bid, performance, payment and other surety bonds — agents, premiums and expiration dates.</p>
        </div>
        {canManage && (<Button onClick={() => setEditing("new")} data-testid="button-new-bond"><Plus className="h-4 w-4 mr-2" />New Bond</Button>)}
      </div>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Filter by project</Label>
        <ProjectSelect value={projectId} onChange={setProjectId} testId="select-bond-project-filter" placeholder="All projects" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No surety bonds tracked" description="Add your first bond to track expiration dates, premiums and surety contacts." testId="empty-bonds" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((b) => (
            <Card key={b.id} data-testid={`card-bond-${b.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{b.bondType} — {b.bondNumber}</CardTitle>
                    <div className="text-xs text-muted-foreground truncate">{b.suretyCompany}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[b.status] || "outline"}>{b.status}</Badge>
                    {canManage && (<><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(b)} data-testid={`button-edit-bond-${b.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(b)} data-testid={`button-delete-bond-${b.id}`} aria-label="Delete" disabled={delMut.isPending}><Trash2 className="h-3.5 w-3.5" /></Button></>)}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Amount:</span> {formatMoney(b.bondAmount)}</div>
                {b.premiumAmount && <div><span className="text-muted-foreground">Premium:</span> {formatMoney(b.premiumAmount)}</div>}
                {b.effectiveDate && <div><span className="text-muted-foreground">Effective:</span> {formatDate(b.effectiveDate)}</div>}
                {b.expirationDate && <div><span className="text-muted-foreground">Expires:</span> {formatDate(b.expirationDate)}</div>}
                {b.agentName && <div className="text-xs"><span className="text-muted-foreground">Agent:</span> {b.agentName}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <BondForm key={editing === "new" ? "new" : editing.id} existing={editing === "new" ? null : editing} defaultProjectId={projectId} onClose={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  );
}

interface FormState {
  projectId: string; bondType: string; status: string; bondNumber: string; suretyCompany: string;
  agentName: string; agentPhone: string; agentEmail: string;
  bondAmount: string; premiumAmount: string; effectiveDate: string; expirationDate: string; notes: string;
}

function initial(existing: SuretyBond | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "", bondType: "PERFORMANCE", status: "DRAFT",
      bondNumber: "", suretyCompany: "",
      agentName: "", agentPhone: "", agentEmail: "",
      bondAmount: "", premiumAmount: "", effectiveDate: "", expirationDate: "", notes: "",
    };
  }
  return {
    projectId: existing.projectId ?? "",
    bondType: existing.bondType,
    status: existing.status,
    bondNumber: existing.bondNumber,
    suretyCompany: existing.suretyCompany,
    agentName: existing.agentName ?? "",
    agentPhone: existing.agentPhone ?? "",
    agentEmail: existing.agentEmail ?? "",
    bondAmount: existing.bondAmount ?? "",
    premiumAmount: existing.premiumAmount ?? "",
    effectiveDate: toDateInput(existing.effectiveDate),
    expirationDate: toDateInput(existing.expirationDate),
    notes: existing.notes ?? "",
  };
}

function BondForm({ existing, onClose, defaultProjectId }: { existing: SuretyBond | null; onClose: () => void; defaultProjectId?: string }) {
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const payload: Record<string, unknown> = {
        ...data,
        projectId: data.projectId || null,
        premiumAmount: data.premiumAmount || null,
        effectiveDate: data.effectiveDate || null,
        expirationDate: data.expirationDate || null,
      };
      const url = existing ? `/api/surety-bonds/${existing.id}` : "/api/surety-bonds";
      const r = await apiRequest(existing ? "PATCH" : "POST", url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Bond updated" : "Bond saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/surety-bonds"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{existing ? "Edit Surety Bond" : "New Surety Bond"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(form); }} className="space-y-3">
        <div>
          <Label>Project (optional)</Label>
          <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} testId="select-bond-project" placeholder="No project" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Bond Type *</Label>
            <Select value={form.bondType} onValueChange={(v) => setForm({ ...form, bondType: v })}>
              <SelectTrigger data-testid="select-bond-type"><SelectValue /></SelectTrigger>
              <SelectContent>{BOND_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger data-testid="select-bond-status"><SelectValue /></SelectTrigger>
              <SelectContent>{BOND_STATUSES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Bond Number *</Label><Input required value={form.bondNumber} onChange={(e) => setForm({ ...form, bondNumber: e.target.value })} data-testid="input-bond-number" /></div>
          <div><Label>Surety Company *</Label><Input required value={form.suretyCompany} onChange={(e) => setForm({ ...form, suretyCompany: e.target.value })} data-testid="input-surety-company" /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Agent Name</Label><Input value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} data-testid="input-agent-name" /></div>
          <div><Label>Agent Phone</Label><Input value={form.agentPhone} onChange={(e) => setForm({ ...form, agentPhone: e.target.value })} data-testid="input-agent-phone" /></div>
          <div><Label>Agent Email</Label><Input type="email" value={form.agentEmail} onChange={(e) => setForm({ ...form, agentEmail: e.target.value })} data-testid="input-agent-email" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Bond Amount *</Label><Input required inputMode="decimal" value={form.bondAmount} onChange={(e) => setForm({ ...form, bondAmount: e.target.value })} data-testid="input-bond-amount" /></div>
          <div><Label>Premium</Label><Input inputMode="decimal" value={form.premiumAmount} onChange={(e) => setForm({ ...form, premiumAmount: e.target.value })} data-testid="input-bond-premium" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Effective Date</Label><Input type="date" value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} data-testid="input-bond-effective" /></div>
          <div><Label>Expiration Date</Label><Input type="date" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} data-testid="input-bond-expiration" /></div>
        </div>
        <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-bond-notes" /></div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-bond-cancel">Cancel</Button>
          <Button type="submit" disabled={mut.isPending} data-testid="button-bond-save">
            {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Bond" : "Save Bond"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
