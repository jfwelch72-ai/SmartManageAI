import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useProjectProcurement, useCreateProcurementItem } from "@/hooks/use-data";
import { queryClient } from "@/lib/queryClient";
import type { Project } from "@shared/schema";

interface ProcurementTabProps {
  projectCode: string;
  project: Project;
}

export default function ProcurementTab({ projectCode, project }: ProcurementTabProps) {
  const { toast } = useToast();
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const createProcurementMutation = useCreateProcurementItem();

  const [showProcurementDialog, setShowProcurementDialog] = useState(false);
  const [procurementDescription, setProcurementDescription] = useState("");
  const [procurementVendor, setProcurementVendor] = useState("");
  const [procurementQuantity, setProcurementQuantity] = useState("");
  const [procurementUnit, setProcurementUnit] = useState("");
  const [procurementUnitCost, setProcurementUnitCost] = useState("");
  const [procurementStatus, setProcurementStatus] = useState<"PLANNED" | "ORDERED" | "DELIVERED">("PLANNED");
  const [procurementPoNumber, setProcurementPoNumber] = useState("");

  const handleCreateProcurement = async () => {
    if (!procurementDescription) {
      toast({ title: "Error", description: "Description is required", variant: "destructive" });
      return;
    }
    if (!project) return;

    try {
      await createProcurementMutation.mutateAsync({
        projectId: project.id,
        projectCode,
        description: procurementDescription,
        vendor: procurementVendor || undefined,
        quantity: procurementQuantity || undefined,
        unit: procurementUnit || undefined,
        unitCost: procurementUnitCost || undefined,
        status: procurementStatus,
        poNumber: procurementPoNumber || undefined,
      });
      toast({ title: "Success", description: "Procurement item created" });
      setShowProcurementDialog(false);
      setProcurementDescription("");
      setProcurementVendor("");
      setProcurementQuantity("");
      setProcurementUnit("");
      setProcurementUnitCost("");
      setProcurementStatus("PLANNED");
      setProcurementPoNumber("");
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
    } catch (error) {
      toast({ title: "Error", description: "Failed to create procurement item", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Procurement Items</CardTitle>
        <Dialog open={showProcurementDialog} onOpenChange={setShowProcurementDialog}>
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
                Enter material or equipment details. Costs entered here flow to the project financials.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <Label htmlFor="procurement-description">Description *</Label>
                <Input
                  id="procurement-description"
                  value={procurementDescription}
                  onChange={(e) => setProcurementDescription(e.target.value)}
                  placeholder="Material or equipment description..."
                  data-testid="input-procurement-description"
                />
              </div>
              <div>
                <Label htmlFor="procurement-vendor">Vendor/Supplier</Label>
                <Input
                  id="procurement-vendor"
                  value={procurementVendor}
                  onChange={(e) => setProcurementVendor(e.target.value)}
                  placeholder="Vendor name..."
                  data-testid="input-procurement-vendor"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="procurement-quantity">Quantity</Label>
                  <Input
                    id="procurement-quantity"
                    type="number"
                    step="0.01"
                    value={procurementQuantity}
                    onChange={(e) => setProcurementQuantity(e.target.value)}
                    placeholder="0"
                    data-testid="input-procurement-quantity"
                  />
                </div>
                <div>
                  <Label htmlFor="procurement-unit">Unit</Label>
                  <Input
                    id="procurement-unit"
                    value={procurementUnit}
                    onChange={(e) => setProcurementUnit(e.target.value)}
                    placeholder="ea, lf, sf, cy..."
                    data-testid="input-procurement-unit"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="procurement-unit-cost">Unit Cost ($)</Label>
                <Input
                  id="procurement-unit-cost"
                  type="number"
                  step="0.01"
                  value={procurementUnitCost}
                  onChange={(e) => setProcurementUnitCost(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-procurement-unit-cost"
                />
                {procurementQuantity && procurementUnitCost && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Total: ${(parseFloat(procurementQuantity) * parseFloat(procurementUnitCost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="procurement-status">Status</Label>
                <Select
                  value={procurementStatus}
                  onValueChange={(value: "PLANNED" | "ORDERED" | "DELIVERED") => setProcurementStatus(value)}
                >
                  <SelectTrigger id="procurement-status" data-testid="select-procurement-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLANNED">Planned</SelectItem>
                    <SelectItem value="ORDERED">Ordered</SelectItem>
                    <SelectItem value="DELIVERED">Delivered</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="procurement-po">PO Number (Optional)</Label>
                <Input
                  id="procurement-po"
                  value={procurementPoNumber}
                  onChange={(e) => setProcurementPoNumber(e.target.value)}
                  placeholder="PO-001..."
                  data-testid="input-procurement-po"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowProcurementDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateProcurement}
                disabled={createProcurementMutation.isPending}
                data-testid="button-submit-procurement"
              >
                {createProcurementMutation.isPending ? "Adding..." : "Add Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {procurementLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading procurement...</div>
        ) : procurementItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No procurement items yet</div>
        ) : (
          <div className="space-y-3">
            {procurementItems.map(item => (
              <div key={item.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`procurement-${item.id}`}>
                <div className="flex-1">
                  <p className="font-medium mb-1">{item.description}</p>
                  <p className="text-sm text-muted-foreground">{item.vendor || "No vendor"}</p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-mono text-sm">
                      {item.quantity} {item.unit}
                    </p>
                    {item.unitCost && item.quantity && (
                      <p className="text-xs text-muted-foreground">
                        ${(parseFloat(item.quantity) * parseFloat(item.unitCost)).toLocaleString()} total
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={
                      item.status === "DELIVERED" ? "default" :
                      item.status === "ORDERED" ? "secondary" :
                      "outline"
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
