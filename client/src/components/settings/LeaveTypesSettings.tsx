import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useLeaveTypes, useCreateLeaveType, useUpdateLeaveType, useDeleteLeaveType } from "@/hooks/use-data";
import { Plus, Pencil, Trash2, TreePalm } from "lucide-react";
import type { LeaveType } from "@shared/schema";

function LeaveTypeForm({ leaveType, onClose }: { leaveType?: LeaveType; onClose: () => void }) {
  const createType = useCreateLeaveType();
  const updateType = useUpdateLeaveType();
  const { toast } = useToast();

  const [name, setName] = useState(leaveType?.name || "");
  const [annualAllowance, setAnnualAllowance] = useState(leaveType?.annualAllowance?.toString() || "0");
  const [isActive, setIsActive] = useState(leaveType?.isActive ?? true);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Error", description: "Name is required", variant: "destructive" });
      return;
    }

    const allowance = parseInt(annualAllowance) || 0;

    try {
      if (leaveType) {
        await updateType.mutateAsync({ id: leaveType.id, name: name.trim(), annualAllowance: allowance, isActive });
        toast({ title: "Updated", description: "Leave type updated successfully" });
      } else {
        await createType.mutateAsync({ name: name.trim(), annualAllowance: allowance, isActive });
        toast({ title: "Created", description: "Leave type created successfully" });
      }
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to save leave type", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Vacation, Sick, Personal"
          data-testid="input-leave-type-name"
        />
      </div>
      <div>
        <Label>Annual Allowance (days)</Label>
        <Input
          type="number"
          min="0"
          value={annualAllowance}
          onChange={(e) => setAnnualAllowance(e.target.value)}
          data-testid="input-leave-type-allowance"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={isActive} onCheckedChange={setIsActive} data-testid="switch-leave-type-active" />
        <Label>Active</Label>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          disabled={createType.isPending || updateType.isPending}
          data-testid="button-save-leave-type"
        >
          {createType.isPending || updateType.isPending ? "Saving..." : leaveType ? "Update" : "Create"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function LeaveTypesSettings() {
  const { data: leaveTypes = [], isLoading } = useLeaveTypes();
  const deleteType = useDeleteLeaveType();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingType, setEditingType] = useState<LeaveType | undefined>();

  const handleDelete = async (id: string) => {
    try {
      await deleteType.mutateAsync(id);
      toast({ title: "Deleted", description: "Leave type removed" });
    } catch {
      toast({ title: "Error", description: "Failed to delete leave type", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" data-testid="text-leave-types-heading">Leave Types</h2>
          <p className="text-sm text-muted-foreground">
            Configure leave types and annual allowances for your organization
          </p>
        </div>
        <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditingType(undefined); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-leave-type">
              <Plus className="w-4 h-4 mr-2" />
              Add Leave Type
            </Button>
          </DialogTrigger>
          <DialogContent data-testid="dialog-leave-type-form">
            <DialogHeader>
              <DialogTitle>{editingType ? "Edit Leave Type" : "New Leave Type"}</DialogTitle>
            </DialogHeader>
            <LeaveTypeForm
              leaveType={editingType}
              onClose={() => { setShowForm(false); setEditingType(undefined); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : leaveTypes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <TreePalm className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No leave types configured yet. Add your first leave type above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {leaveTypes.map((type) => (
            <Card key={type.id} data-testid={`card-leave-type-${type.id}`}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <TreePalm className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{type.name}</span>
                      {!type.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {type.annualAllowance} days per year
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setEditingType(type); setShowForm(true); }}
                    data-testid={`button-edit-leave-type-${type.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(type.id)}
                    disabled={deleteType.isPending}
                    data-testid={`button-delete-leave-type-${type.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
