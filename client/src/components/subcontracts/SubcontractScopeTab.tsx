import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, ListOrdered, Loader2 } from "lucide-react";

interface SovLineItem {
  id: string;
  contractId: string;
  itemNumber: number;
  description: string;
  scheduledValue: string;
  originalValue: string | null;
  changeOrderRef: string | null;
}

interface SubcontractScopeTabProps {
  contractId: string;
  canEdit: boolean;
}

export function SubcontractScopeTab({ contractId, canEdit }: SubcontractScopeTabProps) {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<SovLineItem | null>(null);
  const [form, setForm] = useState({ description: "", scheduledValue: "", changeOrderRef: "" });

  const { data: sovItems = [], isLoading, isError, refetch } = useQuery<SovLineItem[]>({
    queryKey: ["/api/subcontracts", contractId, "sov"],
    queryFn: async () => {
      const res = await fetch(`/api/subcontracts/${contractId}/sov`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch SOV");
      return res.json();
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: { description: string; scheduledValue: string; changeOrderRef?: string }) =>
      apiRequest("POST", `/api/subcontracts/${contractId}/sov`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "sov"] });
      toast({ title: "Line item added" });
      setShowAddDialog(false);
      setForm({ description: "", scheduledValue: "", changeOrderRef: "" });
    },
    onError: (e: Error) => toast({ title: "Failed to add", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { description?: string; scheduledValue?: string; changeOrderRef?: string; itemNumber?: number } }) =>
      apiRequest("PATCH", `/api/subcontracts/${contractId}/sov/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "sov"] });
      toast({ title: "Line item updated" });
      setEditingItem(null);
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/subcontracts/${contractId}/sov/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "sov"] });
      toast({ title: "Line item deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const totalScheduled = sovItems.reduce((sum, item) => sum + parseFloat(item.scheduledValue || "0"), 0);
  const totalOriginal = sovItems.reduce((sum, item) => sum + parseFloat(item.originalValue || item.scheduledValue || "0"), 0);

  const fmt = (v: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(typeof v === "string" ? parseFloat(v) : v);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading scope...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load schedule of values.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-scope-title">
            <ListOrdered className="h-5 w-5" />
            Schedule of Values
          </h3>
          <p className="text-sm text-muted-foreground">{sovItems.length} line items | Total: {fmt(totalScheduled)}</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-sov-item">
            <Plus className="h-4 w-4 mr-2" />Add Line Item
          </Button>
        )}
      </div>

      {totalOriginal !== totalScheduled && (
        <Card>
          <CardContent className="py-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Original contract value: {fmt(totalOriginal)}</span>
              <span>Revised value: <span className="font-semibold">{fmt(totalScheduled)}</span></span>
              <Badge variant={totalScheduled > totalOriginal ? "destructive" : "secondary"}>
                {totalScheduled > totalOriginal ? "+" : ""}{fmt(totalScheduled - totalOriginal)} change
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {sovItems.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No scope line items yet. Add items to build the schedule of values.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Scheduled Value</TableHead>
                  <TableHead className="text-right">Original Value</TableHead>
                  <TableHead>Change Order</TableHead>
                  {canEdit && <TableHead className="w-24">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sovItems.map(item => (
                  <TableRow key={item.id} data-testid={`row-sov-${item.id}`}>
                    <TableCell className="font-mono">{item.itemNumber}</TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(item.scheduledValue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{item.originalValue ? fmt(item.originalValue) : "-"}</TableCell>
                    <TableCell>{item.changeOrderRef ? <Badge variant="outline">{item.changeOrderRef}</Badge> : "-"}</TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setEditingItem(item); setForm({ description: item.description, scheduledValue: item.scheduledValue, changeOrderRef: item.changeOrderRef || "" }); }} data-testid={`button-edit-sov-${item.id}`}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm("Delete this line item?")) deleteMutation.mutate(item.id); }} data-testid={`button-delete-sov-${item.id}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                <TableRow className="font-bold bg-muted/50">
                  <TableCell></TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmt(totalScheduled)}</TableCell>
                  <TableCell className="text-right">{fmt(totalOriginal)}</TableCell>
                  <TableCell></TableCell>
                  {canEdit && <TableCell></TableCell>}
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add SOV Line Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-sov-description" /></div>
            <div><Label>Scheduled Value ($)</Label><Input type="number" value={form.scheduledValue} onChange={e => setForm({ ...form, scheduledValue: e.target.value })} data-testid="input-sov-value" /></div>
            <div><Label>Change Order Ref (optional)</Label><Input value={form.changeOrderRef} onChange={e => setForm({ ...form, changeOrderRef: e.target.value })} data-testid="input-sov-co-ref" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onClick={() => addMutation.mutate(form)} disabled={!form.description || !form.scheduledValue || addMutation.isPending} data-testid="button-submit-sov-item">
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit SOV Line Item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Item Number</Label><Input type="number" min={1} value={editingItem?.itemNumber || ""} onChange={e => { if (editingItem) setEditingItem({ ...editingItem, itemNumber: parseInt(e.target.value) || 1 }); }} data-testid="input-edit-sov-item-number" /></div>
            <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="input-edit-sov-description" /></div>
            <div><Label>Scheduled Value ($)</Label><Input type="number" value={form.scheduledValue} onChange={e => setForm({ ...form, scheduledValue: e.target.value })} data-testid="input-edit-sov-value" /></div>
            <div><Label>Change Order Ref</Label><Input value={form.changeOrderRef} onChange={e => setForm({ ...form, changeOrderRef: e.target.value })} data-testid="input-edit-sov-co-ref" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
            <Button onClick={() => { if (editingItem) updateMutation.mutate({ id: editingItem.id, data: { ...form, itemNumber: editingItem.itemNumber } }); }} disabled={updateMutation.isPending} data-testid="button-save-sov-edit">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
