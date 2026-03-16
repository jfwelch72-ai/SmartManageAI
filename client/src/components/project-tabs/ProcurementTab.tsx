import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectProcurement, useCreateProcurementItem, useUpdateProcurementItem, useDeleteProcurementItem } from "@/hooks/use-data";
import { queryClient } from "@/lib/queryClient";
import type { Project, ProcurementItem } from "@shared/schema";

type ProcurementStatus = "PLANNED" | "QUOTED" | "APPROVED" | "ORDERED" | "DELIVERED";

const ALL_STATUSES: ProcurementStatus[] = ["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"];

const STATUS_VARIANT: Record<ProcurementStatus, "outline" | "secondary" | "default" | "destructive"> = {
  PLANNED: "outline",
  QUOTED: "secondary",
  APPROVED: "secondary",
  ORDERED: "default",
  DELIVERED: "default",
};

const STATUS_LABEL: Record<ProcurementStatus, string> = {
  PLANNED: "Planned",
  QUOTED: "Quoted",
  APPROVED: "Approved",
  ORDERED: "Ordered",
  DELIVERED: "Delivered",
};

interface ProcurementTabProps {
  projectCode: string;
  project: Project;
}

interface FormState {
  description: string;
  vendor: string;
  quantity: string;
  unit: string;
  unitCost: string;
  status: ProcurementStatus;
  poNumber: string;
  neededByDate: string;
}

const emptyForm = (): FormState => ({
  description: "",
  vendor: "",
  quantity: "",
  unit: "",
  unitCost: "",
  status: "PLANNED",
  poNumber: "",
  neededByDate: "",
});

function itemToForm(item: ProcurementItem): FormState {
  return {
    description: item.description,
    vendor: item.vendor || "",
    quantity: item.quantity?.toString() || "",
    unit: item.unit || "",
    unitCost: item.unitCost?.toString() || "",
    status: (item.status as ProcurementStatus) || "PLANNED",
    poNumber: item.poNumber || "",
    neededByDate: item.neededByDate ? new Date(item.neededByDate).toISOString().slice(0, 10) : "",
  };
}

function computeTotal(item: ProcurementItem): number {
  const q = parseFloat(item.quantity?.toString() || "0");
  const u = parseFloat(item.unitCost?.toString() || "0");
  return isNaN(q) || isNaN(u) ? 0 : q * u;
}

function ProcurementForm({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const liveTotal =
    form.quantity && form.unitCost
      ? (parseFloat(form.quantity) * parseFloat(form.unitCost))
      : null;

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      <div>
        <Label htmlFor="proc-description">Description *</Label>
        <Input
          id="proc-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Material or equipment description..."
          data-testid="input-procurement-description"
        />
      </div>
      <div>
        <Label htmlFor="proc-vendor">Vendor / Supplier</Label>
        <Input
          id="proc-vendor"
          value={form.vendor}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          placeholder="Vendor name..."
          data-testid="input-procurement-vendor"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="proc-quantity">Quantity</Label>
          <Input
            id="proc-quantity"
            type="number"
            step="0.01"
            min="0"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            placeholder="0"
            data-testid="input-procurement-quantity"
          />
        </div>
        <div>
          <Label htmlFor="proc-unit">Unit</Label>
          <Input
            id="proc-unit"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            placeholder="ea, lf, sf, cy..."
            data-testid="input-procurement-unit"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="proc-unit-cost">Unit Cost ($)</Label>
        <Input
          id="proc-unit-cost"
          type="number"
          step="0.01"
          min="0"
          value={form.unitCost}
          onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
          placeholder="0.00"
          data-testid="input-procurement-unit-cost"
        />
        {liveTotal !== null && !isNaN(liveTotal) && (
          <p className="text-xs text-muted-foreground mt-1">
            Total: ${liveTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="proc-status">Status</Label>
          <Select
            value={form.status}
            onValueChange={(v) => setForm({ ...form, status: v as ProcurementStatus })}
          >
            <SelectTrigger id="proc-status" data-testid="select-procurement-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="proc-po">PO Number</Label>
          <Input
            id="proc-po"
            value={form.poNumber}
            onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
            placeholder="PO-001..."
            data-testid="input-procurement-po"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="proc-needed-by">Needed By Date</Label>
        <Input
          id="proc-needed-by"
          type="date"
          value={form.neededByDate}
          onChange={(e) => setForm({ ...form, neededByDate: e.target.value })}
          data-testid="input-procurement-needed-by"
        />
      </div>
    </div>
  );
}

export default function ProcurementTab({ projectCode, project }: ProcurementTabProps) {
  const { toast } = useToast();
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const createMutation = useCreateProcurementItem();
  const updateMutation = useUpdateProcurementItem();
  const deleteMutation = useDeleteProcurementItem();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(emptyForm());

  const [editingItem, setEditingItem] = useState<ProcurementItem | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm());

  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredItems = statusFilter === "all"
    ? procurementItems
    : procurementItems.filter((i) => i.status === statusFilter);

  const totalByStatus = (status: ProcurementStatus) =>
    procurementItems.filter((i) => i.status === status).reduce((sum, i) => sum + computeTotal(i), 0);

  const grandTotal = procurementItems.reduce((sum, i) => sum + computeTotal(i), 0);

  const handleCreate = async () => {
    if (!createForm.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        projectId: project.id,
        projectCode,
        description: createForm.description,
        vendor: createForm.vendor || undefined,
        quantity: createForm.quantity || undefined,
        unit: createForm.unit || undefined,
        unitCost: createForm.unitCost || undefined,
        status: createForm.status,
        poNumber: createForm.poNumber || undefined,
        neededByDate: createForm.neededByDate ? new Date(createForm.neededByDate) : undefined,
      });
      toast({ title: "Procurement item created" });
      setShowCreateDialog(false);
      setCreateForm(emptyForm());
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
    } catch {
      toast({ title: "Failed to create item", variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editingItem || !editForm.description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: editingItem.id,
        projectCode,
        data: {
          description: editForm.description,
          vendor: editForm.vendor || undefined,
          quantity: editForm.quantity || undefined,
          unit: editForm.unit || undefined,
          unitCost: editForm.unitCost || undefined,
          status: editForm.status,
          poNumber: editForm.poNumber || undefined,
          neededByDate: editForm.neededByDate ? new Date(editForm.neededByDate) : undefined,
        },
      });
      toast({ title: "Item updated" });
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
    } catch {
      toast({ title: "Failed to update item", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id, projectCode });
      toast({ title: "Item deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
    } catch {
      toast({ title: "Failed to delete item", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Procurement Items</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs" data-testid="select-filter-procurement-status">
              <Filter className="h-3.5 w-3.5 mr-1" />
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-procurement">
                <Plus className="w-4 h-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-procurement">
              <DialogHeader>
                <DialogTitle>Add Procurement Item</DialogTitle>
                <DialogDescription>
                  Enter material or equipment details. Costs flow to project financials.
                </DialogDescription>
              </DialogHeader>
              <ProcurementForm form={createForm} setForm={setCreateForm} />
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowCreateDialog(false); setCreateForm(emptyForm()); }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-procurement"
                >
                  {createMutation.isPending ? "Adding..." : "Add Item"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent>
        {procurementLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading procurement...</div>
        ) : procurementItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No procurement items yet</div>
        ) : (
          <>
            <div className="space-y-3">
              {filteredItems.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">No items match the selected filter.</div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between p-4 border rounded-md gap-3"
                    data-testid={`procurement-${item.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium mb-0.5">{item.description}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
                        {item.vendor && <span>{item.vendor}</span>}
                        {item.poNumber && <span className="font-mono text-xs">PO: {item.poNumber}</span>}
                        {item.neededByDate && (
                          <span className="text-xs">
                            Needed by: {new Date(item.neededByDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        {item.quantity && item.unit && (
                          <p className="font-mono text-sm">{item.quantity} {item.unit}</p>
                        )}
                        {item.unitCost && item.quantity && (
                          <p className="text-xs text-muted-foreground">
                            ${computeTotal(item).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        )}
                      </div>
                      <Badge variant={STATUS_VARIANT[item.status as ProcurementStatus] || "outline"} className="text-xs">
                        {STATUS_LABEL[item.status as ProcurementStatus] || item.status}
                      </Badge>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit item"
                          onClick={() => { setEditingItem(item); setEditForm(itemToForm(item)); }}
                          data-testid={`button-edit-procurement-${item.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              title="Delete item"
                              data-testid={`button-delete-procurement-${item.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Procurement Item?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove "{item.description}" from the project. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(item.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                data-testid={`button-confirm-delete-procurement-${item.id}`}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {(["PLANNED", "QUOTED", "APPROVED", "ORDERED", "DELIVERED"] as ProcurementStatus[])
                  .filter((s) => totalByStatus(s) > 0)
                  .map((s) => (
                    <span key={s}>
                      <span className="font-medium text-foreground">{STATUS_LABEL[s]}:</span>{" "}
                      ${totalByStatus(s).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ))}
                {grandTotal > 0 && (
                  <span className="ml-auto font-semibold text-foreground" data-testid="text-procurement-grand-total">
                    Total: ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent data-testid="dialog-edit-procurement">
          <DialogHeader>
            <DialogTitle>Edit Procurement Item</DialogTitle>
            <DialogDescription>Update the details for this procurement item.</DialogDescription>
          </DialogHeader>
          <ProcurementForm form={editForm} setForm={setEditForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
            <Button
              onClick={handleEdit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit-procurement"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
