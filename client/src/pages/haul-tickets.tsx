import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import {
  ProjectSelect,
  formatDate,
  formatMoney,
  todayIso,
  getErrorMessage,
  toDateInput,
} from "@/components/dot/FieldFormHelpers";
import { HeavyCivilDocumentField } from "@/components/dot/HeavyCivilDocumentField";
import { MassHaulDiagram } from "@/components/dot/MassHaulDiagram";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import type { HaulTicket } from "@shared/schema";

interface MassHaulImbalance {
  material: string;
  issue: string;
  estimatedSavings?: string | number;
}
interface MassHaulAnalysis {
  summary?: string;
  imbalances?: MassHaulImbalance[];
  recommendations?: string[];
  confidence?: number;
}
interface MassHaulMovement {
  material: string;
  source: string;
  destination: string;
  quantity: number;
  unit: string;
}
interface MassHaulResponse {
  fallback?: boolean;
  message?: string;
  analysis?: MassHaulAnalysis;
  movements?: MassHaulMovement[];
}
interface HaulOcrResponse {
  fallback?: boolean;
  message?: string;
  ticketNumber?: string | null;
  ticketDate?: string | null;
  materialClass?: string | null;
  source?: string | null;
  destination?: string | null;
  truckNumber?: string | null;
  driverName?: string | null;
  quantity?: string | null;
  unit?: string | null;
  unitCost?: string | null;
  confidence?: number;
  notes?: string;
}

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  VOIDED: "outline",
};

type Editing = HaulTicket | "new" | null;

export default function HaulTicketsPage() {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageHaulTickets");
  const canApprove = useFeaturePermission("canApproveHaulTickets");
  const canView = useFeaturePermission("canViewHaulTickets");
  const canAccess = canView || canManage || canApprove;
  const { isEnabled } = useFeatureFlags();
  const massHaulAnalyzerEnabled = isEnabled("MASS_HAUL_ANALYZER");
  const [projectId, setProjectId] = useState<string>("");
  const [editing, setEditing] = useState<Editing>(null);
  const [deleteTarget, setDeleteTarget] = useState<HaulTicket | null>(null);
  const queryKey = ["/api/haul-tickets", projectId ? { projectId } : {}];
  const { data = [], isLoading } = useQuery<HaulTicket[]>({
    queryKey,
    enabled: canAccess,
  });

  if (!canAccess) {
    return (
      <div
        className="container mx-auto p-6"
        data-testid="no-access-haul-tickets"
      >
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            You don't have permission to view Haul Tickets.
          </CardContent>
        </Card>
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
      setDeleteTarget(null);
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to delete",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const [massHaulOpen, setMassHaulOpen] = useState(false);
  const massHaulMut = useMutation<MassHaulResponse, Error, void>({
    mutationFn: async () => {
      const r = await apiRequest(
        "POST",
        "/api/ai-features/heavy-civil/mass-haul/analyze",
        { projectId },
      );
      return (await r.json()) as MassHaulResponse;
    },
    onError: (error: Error) =>
      toast({
        title: "Mass-haul AI failed",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  return (
    <div className="container max-w-full mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Haul Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Field-recorded truck tickets — material, source, destination,
            quantity, and cost.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canView && projectId && massHaulAnalyzerEnabled && (
            <Button
              variant="outline"
              onClick={() => {
                setMassHaulOpen(true);
                massHaulMut.mutate();
              }}
              disabled={massHaulMut.isPending}
              data-testid="button-haul-mass-haul-ai"
            >
              {massHaulMut.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Mass-Haul AI
            </Button>
          )}
          {canManage && (
            <Button
              onClick={() => setEditing("new")}
              data-testid="button-new-haul-ticket"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Ticket
            </Button>
          )}
        </div>
      </div>

      <Dialog open={massHaulOpen} onOpenChange={setMassHaulOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mass-Haul AI Analysis</DialogTitle>
          </DialogHeader>
          {massHaulMut.isPending ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Analyzing haul movements…
            </div>
          ) : massHaulMut.data?.analysis ? (
            <div
              className="space-y-3 text-sm"
              data-testid="text-mass-haul-result"
            >
              <div>
                <strong>Summary:</strong>{" "}
                {String(massHaulMut.data.analysis.summary ?? "—")}
              </div>
              {Array.isArray(massHaulMut.data.analysis.imbalances) &&
                massHaulMut.data.analysis.imbalances.length > 0 && (
                  <div>
                    <strong>Imbalances:</strong>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {massHaulMut.data.analysis.imbalances.map((i, k) => (
                        <li key={k}>
                          {i.material}: {i.issue}
                          {i.estimatedSavings
                            ? ` — ~${i.estimatedSavings}`
                            : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              {Array.isArray(massHaulMut.data.analysis.recommendations) && (
                <div>
                  <strong>Recommendations:</strong>
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    {massHaulMut.data.analysis.recommendations.map(
                      (r: string, k: number) => (
                        <li key={k}>{r}</li>
                      ),
                    )}
                  </ul>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                Confidence {massHaulMut.data.analysis.confidence ?? "—"}/100 ·{" "}
                {massHaulMut.data.movements?.length ?? 0} movement rows
                analyzed.
              </div>
            </div>
          ) : massHaulMut.data?.message ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-mass-haul-empty"
            >
              {massHaulMut.data.message}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No analysis available.
            </div>
          )}
          {projectId && (
            <div className="mt-6 border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Mass-Haul Diagram</h3>
              <MassHaulDiagram projectId={projectId} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="max-w-md">
        <Label className="text-xs text-muted-foreground">
          Filter by project
        </Label>
        <ProjectSelect
          value={projectId}
          onChange={setProjectId}
          testId="select-haul-project-filter"
          placeholder="All projects"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="animate-spin h-5 w-5 mr-2" />
          Loading…
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No haul tickets yet"
          description="Record your first haul ticket to start tracking imported and exported material."
          testId="empty-haul-tickets"
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id} data-testid={`card-haul-ticket-${t.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">
                      #{t.ticketNumber}
                    </CardTitle>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.ticketDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[t.status] || "outline"}>
                      {t.status}
                    </Badge>
                    {(canManage || canApprove) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditing(t)}
                        data-testid={`button-edit-haul-${t.id}`}
                        aria-label="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setDeleteTarget(t)}
                        data-testid={`button-delete-haul-${t.id}`}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Material:</span>{" "}
                  {t.materialClass}
                </div>
                <div>
                  <span className="text-muted-foreground">Qty:</span>{" "}
                  {t.quantity} {t.unit}
                </div>
                {t.source && (
                  <div>
                    <span className="text-muted-foreground">From:</span>{" "}
                    {t.source}
                  </div>
                )}
                {t.destination && (
                  <div>
                    <span className="text-muted-foreground">To:</span>{" "}
                    {t.destination}
                  </div>
                )}
                {t.truckNumber && (
                  <div>
                    <span className="text-muted-foreground">Truck:</span>{" "}
                    {t.truckNumber}
                    {t.driverName ? ` · ${t.driverName}` : ""}
                  </div>
                )}
                {t.totalCost && (
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    {formatMoney(t.totalCost)}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        {editing !== null && (
          <HaulTicketForm
            key={editing === "new" ? "new" : editing.id}
            existing={editing === "new" ? null : editing}
            defaultProjectId={projectId}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-haul-ticket">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Haul Ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete haul ticket{" "}
              <strong>#{deleteTarget?.ticketNumber}</strong>
              {deleteTarget ? (
                <>
                  {" "}
                  ({deleteTarget.materialClass}, {deleteTarget.quantity}{" "}
                  {deleteTarget.unit})
                </>
              ) : null}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-delete-haul-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={delMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) delMut.mutate(deleteTarget.id);
              }}
              data-testid="button-delete-haul-confirm"
            >
              {delMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function initial(
  existing: HaulTicket | null,
  defaultProjectId?: string,
): FormState {
  if (!existing) {
    return {
      projectId: defaultProjectId || "",
      ticketNumber: "",
      ticketDate: todayIso(),
      status: "DRAFT",
      materialClass: "",
      source: "",
      destination: "",
      truckNumber: "",
      driverName: "",
      quantity: "",
      unit: "TON",
      unitCost: "",
      costCode: "",
      payItemNumber: "",
      notes: "",
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
    ticketPhotoDocumentId:
      (existing as { ticketPhotoDocumentId?: string | null })
        .ticketPhotoDocumentId ?? "",
  };
}

function HaulTicketForm({
  existing,
  onClose,
  defaultProjectId,
}: {
  existing: HaulTicket | null;
  onClose: () => void;
  defaultProjectId?: string;
}) {
  const { toast } = useToast();
  const canManage = useFeaturePermission("canManageHaulTickets");
  const canApprove = useFeaturePermission("canApproveHaulTickets");
  const [form, setForm] = useState<FormState>(() =>
    initial(existing, defaultProjectId),
  );
  useEffect(() => {
    setForm(initial(existing, defaultProjectId));
  }, [existing, defaultProjectId]);

  const mut = useMutation({
    mutationFn: async (data: FormState) => {
      const totalCost =
        data.unitCost && data.quantity
          ? (Number(data.unitCost) * Number(data.quantity)).toFixed(2)
          : null;
      // Server strips status from PATCH; lifecycle transitions go through
      // /submit /approve /reject /void below.
      const { status: _status, ...rest } = data;
      const payload: Record<string, unknown> = {
        ...rest,
        unitCost: data.unitCost || null,
        totalCost,
        ticketPhotoDocumentId: data.ticketPhotoDocumentId || null,
      };
      const url = existing
        ? `/api/haul-tickets/${existing.id}`
        : "/api/haul-tickets";
      const method = existing ? "PATCH" : "POST";
      const r = await apiRequest(method, url, payload);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: existing ? "Ticket updated" : "Haul ticket saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/haul-tickets"] });
      onClose();
    },
    onError: (error: Error) =>
      toast({
        title: "Failed to save",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const ocrMut = useMutation<HaulOcrResponse, Error, string>({
    mutationFn: async (documentId: string) => {
      const r = await apiRequest(
        "POST",
        "/api/ai-features/heavy-civil/haul-ticket/ocr",
        { documentId },
      );
      return (await r.json()) as HaulOcrResponse;
    },
    onSuccess: (data) => {
      if (data?.fallback) {
        toast({
          title: "AI couldn't read the ticket",
          description: data.message ?? "Enter values manually.",
        });
        return;
      }
      // For each field, prefer the AI value when present. Defaulted fields
      // (ticketDate=today, unit="TON") would otherwise block the AI value
      // because they are non-empty in `prev`.
      const pick = (
        aiVal: string | null | undefined,
        prevVal: string,
      ): string => {
        if (aiVal && aiVal.trim().length > 0) return aiVal;
        return prevVal;
      };
      setForm((prev) => ({
        ...prev,
        ticketNumber: pick(data.ticketNumber, prev.ticketNumber),
        ticketDate: pick(data.ticketDate, prev.ticketDate),
        materialClass: pick(data.materialClass, prev.materialClass),
        source: pick(data.source, prev.source),
        destination: pick(data.destination, prev.destination),
        truckNumber: pick(data.truckNumber, prev.truckNumber),
        driverName: pick(data.driverName, prev.driverName),
        quantity: pick(data.quantity, prev.quantity),
        unit: pick(data.unit, prev.unit),
        unitCost: pick(data.unitCost, prev.unitCost),
      }));
      toast({
        title: "AI prefilled from photo",
        description: `Confidence ${data.confidence ?? "—"}/100. Review before saving.`,
      });
    },
    onError: (error: Error) =>
      toast({
        title: "OCR failed",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  const transitionMut = useMutation({
    mutationFn: async (action: "submit" | "approve" | "reject" | "void") => {
      if (!existing) throw new Error("Save the ticket first");
      const r = await apiRequest(
        "POST",
        `/api/haul-tickets/${existing.id}/${action}`,
        {},
      );
      return r.json();
    },
    onSuccess: (_d, action) => {
      toast({
        title: `Haul ticket ${action === "submit" ? "submitted" : action === "approve" ? "approved" : action === "reject" ? "rejected" : "voided"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/haul-tickets"] });
      onClose();
    },
    onError: (error: Error) =>
      toast({
        title: "Workflow action failed",
        description: getErrorMessage(error),
        variant: "destructive",
      }),
  });

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {existing ? "Edit Haul Ticket" : "New Haul Ticket"}
        </DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate(form);
        }}
        className="space-y-3"
      >
        <div>
          <Label>Project *</Label>
          <ProjectSelect
            value={form.projectId}
            onChange={(v) => setForm({ ...form, projectId: v })}
            testId="select-haul-project"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Ticket # *</Label>
            <Input
              required
              value={form.ticketNumber}
              onChange={(e) =>
                setForm({ ...form, ticketNumber: e.target.value })
              }
              data-testid="input-haul-ticket-number"
            />
          </div>
          <div>
            <Label>Date *</Label>
            <Input
              type="date"
              required
              value={form.ticketDate}
              onChange={(e) => setForm({ ...form, ticketDate: e.target.value })}
              data-testid="input-haul-date"
            />
          </div>
          <div>
            <Label>Status</Label>
            <div
              className="h-10 flex items-center"
              data-testid="badge-haul-status"
            >
              <Badge variant={STATUS_VARIANT[form.status] || "outline"}>
                {form.status}
              </Badge>
              <span className="text-xs text-muted-foreground ml-2">
                Use workflow actions below
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Material Class *</Label>
            <Input
              required
              placeholder="e.g. 304 Aggregate"
              value={form.materialClass}
              onChange={(e) =>
                setForm({ ...form, materialClass: e.target.value })
              }
              data-testid="input-haul-material"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Quantity *</Label>
              <Input
                required
                inputMode="decimal"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                data-testid="input-haul-quantity"
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Select
                value={form.unit}
                onValueChange={(v) => setForm({ ...form, unit: v })}
              >
                <SelectTrigger data-testid="select-haul-unit">
                  <SelectValue />
                </SelectTrigger>
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
            <Input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              data-testid="input-haul-source"
            />
          </div>
          <div>
            <Label>Destination</Label>
            <Input
              value={form.destination}
              onChange={(e) =>
                setForm({ ...form, destination: e.target.value })
              }
              data-testid="input-haul-destination"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Truck #</Label>
            <Input
              value={form.truckNumber}
              onChange={(e) =>
                setForm({ ...form, truckNumber: e.target.value })
              }
              data-testid="input-haul-truck"
            />
          </div>
          <div>
            <Label>Driver</Label>
            <Input
              value={form.driverName}
              onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              data-testid="input-haul-driver"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Unit Cost</Label>
            <Input
              inputMode="decimal"
              value={form.unitCost}
              onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
              data-testid="input-haul-unit-cost"
            />
          </div>
          <div>
            <Label>Cost Code</Label>
            <Input
              value={form.costCode}
              onChange={(e) => setForm({ ...form, costCode: e.target.value })}
              data-testid="input-haul-cost-code"
            />
          </div>
          <div>
            <Label>Pay Item #</Label>
            <Input
              value={form.payItemNumber}
              onChange={(e) =>
                setForm({ ...form, payItemNumber: e.target.value })
              }
              data-testid="input-haul-pay-item"
            />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            data-testid="input-haul-notes"
          />
        </div>
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <Label>Ticket Photo</Label>
            {form.ticketPhotoDocumentId && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={ocrMut.isPending}
                onClick={() => ocrMut.mutate(form.ticketPhotoDocumentId)}
                data-testid="button-haul-ocr-ai"
              >
                {ocrMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5 mr-2" />
                )}
                AI Read Ticket
              </Button>
            )}
          </div>
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
            <span className="text-xs text-muted-foreground self-center mr-1">
              Workflow:
            </span>
            {canManage && existing.status === "DRAFT" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={transitionMut.isPending}
                onClick={() => transitionMut.mutate("submit")}
                data-testid="button-haul-submit"
              >
                Submit
              </Button>
            )}
            {(canApprove || canManage) && existing.status === "SUBMITTED" && (
              <>
                <Button
                  type="button"
                  size="sm"
                  disabled={transitionMut.isPending}
                  onClick={() => transitionMut.mutate("approve")}
                  data-testid="button-haul-approve"
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={transitionMut.isPending}
                  onClick={() => transitionMut.mutate("reject")}
                  data-testid="button-haul-reject"
                >
                  Reject
                </Button>
              </>
            )}
            {canManage && existing.status !== "VOIDED" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={transitionMut.isPending}
                onClick={() => transitionMut.mutate("void")}
                data-testid="button-haul-void"
              >
                Void
              </Button>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-haul-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={mut.isPending || !form.projectId}
            data-testid="button-haul-save"
          >
            {mut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : existing ? (
              "Update Ticket"
            ) : (
              "Save Ticket"
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
