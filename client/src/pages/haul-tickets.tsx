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
import { Truck, Plus, Loader2, Pencil, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ProjectSelect, formatDate, formatMoney, todayIso, getErrorMessage, toDateInput } from "@/components/dot/FieldFormHelpers";
import { HeavyCivilDocumentField } from "@/components/dot/HeavyCivilDocumentField";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import type { HaulTicket } from "@shared/schema";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline", SUBMITTED: "secondary", APPROVED: "default", REJECTED: "destructive", VOIDED: "outline",
};

type Editing = HaulTicket | "new" | null;

export default function HaulTicketsPage() {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageHaulTickets");
  const canApprove = useFeaturePermission("canApproveHaulTickets");
  const canView = useFeaturePermission("canViewHaulTickets");
  const canAccess = canView || canManage || canApprove;
  const [projectId, setProjectId] = useState<string>("");
  const [editing, setEditing] = useState<Editing>(null);
  const queryKey = ["/api/haul-tickets", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<HaulTicket[]>({ queryKey, enabled: canAccess });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-haul-tickets">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view Haul Tickets.</CardContent></Card>
      </div>
    );
  }

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/haul-tickets/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Ticket deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/haul-tickets"] });
    },
    onError: (error: Error) => toast({ title: "Failed to delete", description: getErrorMessage(error), variant: "destructive" }),
  });

  const handleDelete = (t: HaulTicket) => {
    if (window.confirm(`Delete haul ticket #${t.ticketNumber}?`)) delMut.mutate(t.id);
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Haul Tickets</h1>
          <p className="text-sm text-muted-foreground">Field-recorded truck tickets — material, source, destination, quantity, and cost.</p>
        </div>
        {canManage && (
          <Button onClick={() => setEditing("new")} data-testid="button-new-haul-ticket"><Plus className="h-4 w-4 mr-2" />New Ticket</Button>
        )}
      </div>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">Filter by project</Label>
        <ProjectSelect value={projectId} onChange={setProjectId} testId="select-haul-project-filter" placeholder="All projects" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading…</div>
      ) : data.length === 0 ? (
        <EmptyState icon={Truck} title="No haul tickets yet" description="Record your first haul ticket to start tracking imported and exported material." testId="empty-haul-tickets" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id} data-testid={`card-haul-ticket-${t.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">#{t.ticketNumber}</CardTitle>
                    <div className="text-xs text-muted-foreground">{formatDate(t.ticketDate)}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[t.status] || "outline"}>{t.status}</Badge>
                    {(canManage || canApprove) && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(t)} data-testid={`button-edit-haul-${t.id}`} aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    )}
                    {canManage && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDelete(t)} data-testid={`button-delete-haul-${t.id}`} aria-label="Delete" disabled={delMut.isPending}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Material:</span> {t.materialClass}</div>
                <div><span className="text-muted-foreground">Qty:</span> {t.quantity} {t.unit}</div>
                {t.source && <div><span className="text-muted-foreground">From:</span> {t.source}</div>}
                {t.destination && <div><span className="text-muted-foreground">To:</span> {t.destination}</div>}
                {t.truckNumber && <div><span className="text-muted-foreground">Truck:</span> {t.truckNumber}{t.driverName ? ` · ${t.driverName}` : ""}</div>}
                {t.totalCost && <div><span className="text-muted-foreground">Total:</span> {formatMoney(t.totalCost)}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        {editing !== null && (
          <HaulTicketForm
            key={editing === "new" ? "new" : editing.id}
            existing={editing === "new" ? null : editing}
            defaultProjectId={projectId}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

interface FormState {
  projectId: string;
  ticketNumber: string;
  ticketDate: string;
  status: string;
  materialClass: string;
  source: string;
  destination: string;
  truckNumber: string;
  driverName: string;
  quantity: string;
  unit: string;
  unitCost: string;
  costCode: string;
  payItemNumber: string;
  notes: string;
  ticketPhotoDocumentId: string;
}

function initial(existing: HaulTicket | null, defaultProjectId?: string): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "", ticketNumber: "", ticketDate: todayIso(), status: "DRAFT",
      materialClass: "", source: "", destination: "", truckNumber: "", driverName: "",
      quantity: "", unit: "TON", unitCost: "", costCode: "", payItemNumber: "", notes: "",
      ticketPhotoDocumentId: "",
    };
  }
  return {
    projectId: existing.projectId,
    ticketNumber: existing.ticketNumber,
    ticketDate: toDateInput(existing.ticketDate) || todayIso(),
    status: existing.status,
    materialClass: existing.materialClass,
    source: existing.source ?? "",
    destination: existing.destination ?? "",
    truckNumber: existing.truckNumber ?? "",
    driverName: existing.driverName ?? "",
    quantity: existing.quantity ?? "",
    unit: existing.unit ?? "TON",
    unitCost: existing.unitCost ?? "",
    costCode: existing.costCode ?? "",
    payItemNumber: existing.payItemNumber ?? "",
    notes: existing.notes ?? "",
    ticketPhotoDocumentId: (existing as { ticketPhotoDocumentId?: string | null }).ticketPhotoDocumentId ?? "",
  };
}

function HaulTicketForm({ existing, onClose, defaultProjectId }: { existing: HaulTicket | null; onClose: () => void; defaultProjectId?: string }) {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageHaulTickets");
  const canApprove = useFeaturePermission("canApproveHaulTickets");
  const [form, setForm] = useState<FormState>(() => initial(existing, defaultProjectId));
  useEffect(() => { setForm(initial(existing, defaultProjectId)); }, [existing, defaultProjectId]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const totalCost = data.unitCost && data.quantity ? (Number(data.unitCost) * Number(data.quantity)).toFixed(2) : null;
      // Server strips status from PATCH; lifecycle transitions go through
      // /submit /approve /reject /void below.
      const { status: _status, ...rest } = data;
      const payload: Record<string, unknown> = {
        ...rest,
        unitCost: data.unitCost || null,
        totalCost,
        ticketPhotoDocumentId: data.ticketPhotoDocumentId || null,
      };
      const url = existing ? `/api/haul-tickets/${existing.id}` : "/api/haul-tickets";
      const method = existing ? "PATCH" : "POST";
      const r = await apiRequest(method, url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Ticket updated" : "Haul ticket saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/haul-tickets"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Failed to save", description: getErrorMessage(error), variant: "destructive" }),
  });

  const transitionMut = useMutation({
    mutationFn: async (action: "submit" | "approve" | "reject" | "void") => {
      if (!existing) throw new Error("Save the ticket first");
      const r = await apiRequest("POST", `/api/haul-tickets/${existing.id}/${action}`, {});
      return r.json();
    },
    onSuccess: (_d, action) => {
      toast({ title: `Haul ticket ${action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "voided"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/haul-tickets"] });
      onClose();
    },
    onError: (error: Error) => toast({ title: "Workflow action failed", description: getErrorMessage(error), variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{existing ? "Edit Haul Ticket" : "New Haul Ticket"}</DialogTitle></DialogHeader>
      <form onSubmit={(e) => { e.preventDefault(); mut.mutate(form); }} className="space-y-3">
        <div>
          <Label>Project *</Label>
          <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} testId="select-haul-project" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Ticket # *</Label>
            <Input required value={form.ticketNumber} onChange={(e) => setForm({ ...form, ticketNumber: e.target.value })} data-testid="input-haul-ticket-number" />
          </div>
          <div>
            <Label>Date *</Label>
            <Input type="date" required value={form.ticketDate} onChange={(e) => setForm({ ...form, ticketDate: e.target.value })} data-testid="input-haul-date" />
          </div>
          <div>
            <Label>Status</Label>
            <div className="h-10 flex items-center" data-testid="badge-haul-status">
              <Badge variant={STATUS_VARIANT[form.status] || "outline"}>{form.status}</Badge>
              <span className="text-xs text-muted-foreground ml-2">Use workflow actions below</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Material Class *</Label>
            <Input required placeholder="e.g. 304 Aggregate" value={form.materialClass} onChange={(e) => setForm({ ...form, materialClass: e.target.value })} data-testid="input-haul-material" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Quantity *</Label>
              <Input required inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="input-haul-quantity" />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                <SelectTrigger data-testid="select-haul-unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TON">TON</SelectItem>
                  <SelectItem value="CY">CY</SelectItem>
                  <SelectItem value="LF">LF</SelectItem>
                  <SelectItem value="EA">EA</SelectItem>
                  <SelectItem value="LOAD">LOAD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Source</Label>
            <Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} data-testid="input-haul-source" />
          </div>
          <div>
            <Label>Destination</Label>
            <Input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} data-testid="input-haul-destination" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Truck #</Label>
            <Input value={form.truckNumber} onChange={(e) => setForm({ ...form, truckNumber: e.target.value })} data-testid="input-haul-truck" />
          </div>
          <div>
            <Label>Driver</Label>
            <Input value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} data-testid="input-haul-driver" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Unit Cost</Label>
            <Input inputMode="decimal" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} data-testid="input-haul-unit-cost" />
          </div>
          <div>
            <Label>Cost Code</Label>
            <Input value={form.costCode} onChange={(e) => setForm({ ...form, costCode: e.target.value })} data-testid="input-haul-cost-code" />
          </div>
          <div>
            <Label>Pay Item #</Label>
            <Input value={form.payItemNumber} onChange={(e) => setForm({ ...form, payItemNumber: e.target.value })} data-testid="input-haul-pay-item" />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-haul-notes" />
        </div>
        <div className="border-t pt-3">
          <Label className="mb-2 block">Ticket Photo</Label>
          <HeavyCivilDocumentField
            documentId={form.ticketPhotoDocumentId || null}
            projectId={form.projectId}
            title={`Haul Ticket ${form.ticketNumber || form.ticketDate}`}
            docType="OTHER"
            label="Ticket photo"
            testId="haul-photo"
            onChange={(id) => setForm({ ...form, ticketPhotoDocumentId: id })}
          />
        </div>
        {existing && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground self-center mr-1">Workflow:</span>
            {canManage && existing.status === "DRAFT" && (
              <Button type="button" size="sm" variant="secondary" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("submit")} data-testid="button-haul-submit">Submit</Button>
            )}
            {(canApprove || canManage) && existing.status === "SUBMITTED" && (
              <>
                <Button type="button" size="sm" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("approve")} data-testid="button-haul-approve">Approve</Button>
                <Button type="button" size="sm" variant="destructive" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("reject")} data-testid="button-haul-reject">Reject</Button>
              </>
            )}
            {canManage && existing.status !== "VOIDED" && (
              <Button type="button" size="sm" variant="outline" disabled={transitionMut.isPending} onClick={() => transitionMut.mutate("void")} data-testid="button-haul-void">Void</Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} data-testid="button-haul-cancel">Cancel</Button>
          <Button type="submit" disabled={mut.isPending || !form.projectId} data-testid="button-haul-save">
            {mut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : existing ? "Update Ticket" : "Save Ticket"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
