import { useState, useEffect } from "react";
import { format } from "date-fns";
import { FileText, Calendar, User, CheckCircle, XCircle, Clock, Edit, Ruler, Plus, Trash2, Users, Wrench, Package, Search, ChevronDown, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChangeOrderFiles } from "./ChangeOrderFiles";
import { ChangeOrderFileUploader } from "./ChangeOrderFileUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { hasManagementAccess } from "@/lib/rbac";

// Vendor pricing catalog types
interface VendorPricingCatalog {
  id: string;
  organizationId: string;
  organizationName?: string;
  itemName: string;
  itemCode?: string;
  category: string;
  unit: string;
  unitPrice: string;
  effectiveQuarter: string;
}

// Material categories matching bid estimates
const MATERIAL_CATEGORIES = [
  { value: "CONCRETE", label: "Concrete" },
  { value: "STONE", label: "Stone/Aggregate" },
  { value: "REBAR", label: "Rebar/Steel" },
  { value: "WIRE_MESH", label: "Wire Mesh" },
  { value: "FORMS", label: "Forms" },
  { value: "SEALERS", label: "Sealers/Cure" },
  { value: "JOINTS", label: "Joints/Caulk" },
  { value: "OTHER", label: "Other Materials" },
];

interface LaborEntry {
  id?: string;
  employeeName: string;
  position: string;
  hoursWorked: string;
  hourlyRate: string;
}

interface EquipmentEntry {
  id?: string;
  equipmentType: string;
  description: string;
  quantity: number;
  hoursUsed: string;
  hourlyRate: string;
}

interface MaterialEntry {
  id?: string;
  materialDescription: string;
  category: string;
  quantity: string;
  unit: string;
  unitCost: string;
  vendorPricingId?: string;
}

interface LineItemsData {
  laborEntries: LaborEntry[];
  equipmentEntries: EquipmentEntry[];
  materialEntries: MaterialEntry[];
}

interface ChangeOrder {
  id: string;
  changeOrderNumber: string;
  description: string;
  amount: string;
  status: string;
  requestedById: string;
  approvedById?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
  // Standardized scope fields
  workTypeId?: string | null;
  workTypeCode?: string | null;
  workTypeName?: string | null;
  categoryName?: string | null;
  scopeModifierIds?: string | null;
  scopeModifierNames?: string | null;
  canonicalName?: string | null;
  scopeUnit?: string | null;
  scopeQuantity?: string | null;
}

interface ChangeOrderDialogProps {
  changeOrder: ChangeOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  userRole: string;
}

export function ChangeOrderDialog({
  changeOrder,
  open,
  onOpenChange,
  projectCode,
  userRole,
}: ChangeOrderDialogProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedNumber, setEditedNumber] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [editedAmount, setEditedAmount] = useState("");
  const [lineItemsOpen, setLineItemsOpen] = useState(true);
  const [activeLineTab, setActiveLineTab] = useState("labor");
  
  // Line items state
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([]);
  const [equipmentEntries, setEquipmentEntries] = useState<EquipmentEntry[]>([]);
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);
  // Per-row catalog state: which row has catalog open and what category to query
  const [catalogState, setCatalogState] = useState<{ index: number; category: string } | null>(null);

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);
  // Only ADMIN/MANAGER can edit change orders (enforced by backend)
  const canEdit = canManage && changeOrder?.status === "DRAFT";
  
  // Fetch line items for change order
  const { data: lineItemsData } = useQuery<LineItemsData>({
    queryKey: ["/api/change-orders", changeOrder?.id, "line-items"],
    enabled: !!changeOrder?.id && open,
  });

  // Fetch vendor pricing catalog for the currently open catalog row
  const { data: vendorCatalog } = useQuery<VendorPricingCatalog[]>({
    queryKey: ["/api/vendor-pricing/search", { category: catalogState?.category }],
    enabled: !!catalogState?.category,
  });

  useEffect(() => {
    if (changeOrder) {
      setEditedNumber(changeOrder.changeOrderNumber);
      setEditedDescription(changeOrder.description);
      setEditedAmount(changeOrder.amount);
      setIsEditing(false);
    }
  }, [changeOrder]);
  
  // Populate line items when data loads
  useEffect(() => {
    if (lineItemsData) {
      setLaborEntries(lineItemsData.laborEntries || []);
      setEquipmentEntries(lineItemsData.equipmentEntries || []);
      setMaterialEntries(lineItemsData.materialEntries || []);
    }
  }, [lineItemsData]);
  
  // Save line items mutation
  const saveLineItemsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", `/api/change-orders/${changeOrder?.id}/line-items`, {
        laborEntries,
        equipmentEntries,
        materialEntries,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      if (data?.total !== undefined) {
        setEditedAmount(String(data.total));
      }
      toast({ title: "Success", description: "Line items saved and total updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save line items", variant: "destructive" });
    },
  });
  
  // Calculate totals
  const laborTotal = laborEntries.reduce((sum, e) => sum + (parseFloat(e.hoursWorked || "0") * parseFloat(e.hourlyRate || "0")), 0);
  const equipmentTotal = equipmentEntries.reduce((sum, e) => sum + ((e.quantity || 1) * parseFloat(e.hoursUsed || "0") * parseFloat(e.hourlyRate || "0")), 0);
  const materialTotal = materialEntries.reduce((sum, e) => sum + (parseFloat(e.quantity || "0") * parseFloat(e.unitCost || "0")), 0);
  const lineItemsTotal = laborTotal + equipmentTotal + materialTotal;
  
  // Add entry functions
  const addLaborEntry = () => {
    setLaborEntries([...laborEntries, { employeeName: "", position: "", hoursWorked: "", hourlyRate: "" }]);
  };
  
  const addEquipmentEntry = () => {
    setEquipmentEntries([...equipmentEntries, { equipmentType: "", description: "", quantity: 1, hoursUsed: "", hourlyRate: "" }]);
  };
  
  const addMaterialEntry = () => {
    setMaterialEntries([...materialEntries, { materialDescription: "", category: "", quantity: "", unit: "", unitCost: "" }]);
  };
  
  // Remove entry functions
  const removeLaborEntry = (index: number) => {
    setLaborEntries(laborEntries.filter((_, i) => i !== index));
  };
  
  const removeEquipmentEntry = (index: number) => {
    setEquipmentEntries(equipmentEntries.filter((_, i) => i !== index));
  };
  
  const removeMaterialEntry = (index: number) => {
    setMaterialEntries(materialEntries.filter((_, i) => i !== index));
    if (catalogState?.index === index) setCatalogState(null);
  };
  
  // Update entry functions
  const updateLaborEntry = (index: number, field: keyof LaborEntry, value: string) => {
    const updated = [...laborEntries];
    (updated[index] as any)[field] = value;
    setLaborEntries(updated);
  };
  
  const updateEquipmentEntry = (index: number, field: keyof EquipmentEntry, value: string | number) => {
    const updated = [...equipmentEntries];
    (updated[index] as any)[field] = value;
    setEquipmentEntries(updated);
  };
  
  const updateMaterialEntry = (index: number, field: keyof MaterialEntry, value: string) => {
    const updated = [...materialEntries];
    (updated[index] as any)[field] = value;
    setMaterialEntries(updated);
    // Show catalog when category is selected (auto-open per-row)
    if (field === "category" && value) {
      setCatalogState({ index, category: value });
    }
  };
  
  // Apply vendor pricing to material entry
  const applyVendorPricing = (index: number, pricing: VendorPricingCatalog) => {
    const updated = [...materialEntries];
    updated[index] = {
      ...updated[index],
      materialDescription: pricing.itemName,
      unit: pricing.unit,
      unitCost: pricing.unitPrice,
      vendorPricingId: pricing.id,
    };
    setMaterialEntries(updated);
    setCatalogState(null);
    toast({ title: "Applied", description: `${pricing.itemName} from catalog applied` });
  };

  const updateMutation = useMutation({
    mutationFn: async (data: { changeOrderNumber: string; description: string; amount: string }) => {
      return apiRequest("PATCH", `/api/change-orders/${changeOrder?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order updated successfully" });
      setIsEditing(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update change order", variant: "destructive" });
    },
  });

  const requestApprovalMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/request-approval`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order sent for approval" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to request approval", variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/submit`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order submitted to client" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to submit", variant: "destructive" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order approved" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const reason = prompt("Please provide a reason for rejection:");
      if (!reason) throw new Error("Rejection reason required");
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order rejected" });
      onOpenChange(false);
    },
    onError: (error: any) => {
      if (error.message !== "Rejection reason required") {
        toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
      }
    },
  });

  const returnToDraftMutation = useMutation({
    mutationFn: async () => {
      const reason = prompt("Reason for returning to draft (optional):");
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/return-to-draft`, {
        reason: reason || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order returned to draft" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!editedNumber || !editedDescription || !editedAmount) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    updateMutation.mutate({
      changeOrderNumber: editedNumber,
      description: editedDescription,
      amount: editedAmount,
    });
  };

  if (!changeOrder) return null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "APPROVED":
        return "default";
      case "REJECTED":
        return "destructive";
      case "PENDING_APPROVAL":
        return "destructive";
      case "SUBMITTED":
        return "secondary";
      default:
        return "secondary";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-view-change-order">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Change Order Details
            </DialogTitle>
            <Badge variant={getStatusColor(changeOrder.status)}>
              {changeOrder.status.replace("_", " ")}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="view-co-number">Change Order Number</Label>
              {isEditing ? (
                <Input
                  id="view-co-number"
                  value={editedNumber}
                  onChange={(e) => setEditedNumber(e.target.value)}
                  data-testid="input-edit-co-number"
                />
              ) : (
                <div className="mt-1">
                  <Badge variant="outline" className="font-mono text-base px-3 py-1">
                    {changeOrder.changeOrderNumber}
                  </Badge>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="view-co-description">Description</Label>
              {isEditing ? (
                <Textarea
                  id="view-co-description"
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  rows={4}
                  data-testid="input-edit-co-description"
                />
              ) : (
                <p className="mt-1 text-sm">{changeOrder.description}</p>
              )}
            </div>

            {hasManagementAccess(userRole) && (
              <div>
                <Label htmlFor="view-co-amount">Amount</Label>
                {isEditing ? (
                  <>
                    <Input
                      id="view-co-amount"
                      type="number"
                      step="0.01"
                      value={editedAmount}
                      onChange={(e) => setEditedAmount(e.target.value)}
                      data-testid="input-edit-co-amount"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter positive for additions or negative for deductions
                    </p>
                  </>
                ) : (
                  <div className="mt-1">
                    <p className={`text-2xl font-bold font-mono ${parseFloat(changeOrder.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                      {parseFloat(changeOrder.amount) >= 0 ? '+' : ''}${parseFloat(changeOrder.amount).toLocaleString()}
                    </p>
                    <Badge variant={parseFloat(changeOrder.amount) >= 0 ? "default" : "destructive"} className="mt-1">
                      {parseFloat(changeOrder.amount) >= 0 ? 'Addition' : 'Deduction'}
                    </Badge>
                  </div>
                )}
              </div>
            )}

            {/* Standardized Scope of Work display */}
            {changeOrder.canonicalName && (
              <div className="p-3 bg-muted/30 rounded-md">
                <div className="flex items-center gap-2 mb-2">
                  <Ruler className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Scope of Work</span>
                </div>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Work Type:</span> {changeOrder.canonicalName}</p>
                  {changeOrder.categoryName && (
                    <p><span className="text-muted-foreground">Category:</span> {changeOrder.categoryName}</p>
                  )}
                  {changeOrder.scopeQuantity && changeOrder.scopeUnit && (
                    <p><span className="text-muted-foreground">Quantity:</span> {changeOrder.scopeQuantity} {changeOrder.scopeUnit}</p>
                  )}
                  {changeOrder.scopeModifierNames && (() => {
                    try {
                      const modifiers = JSON.parse(changeOrder.scopeModifierNames);
                      if (Array.isArray(modifiers) && modifiers.length > 0) {
                        return (
                          <p><span className="text-muted-foreground">Modifiers:</span> {modifiers.join(", ")}</p>
                        );
                      }
                    } catch (e) {}
                    return null;
                  })()}
                  {changeOrder.workTypeCode && (
                    <p className="text-xs text-muted-foreground">Code: {changeOrder.workTypeCode}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>Created: {format(new Date(changeOrder.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
            </div>
            {changeOrder.approvedAt && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4" />
                <span>Approved: {format(new Date(changeOrder.approvedAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            )}
          </div>

          {changeOrder.rejectionReason && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm font-medium text-destructive mb-1">Rejection Reason:</p>
              <p className="text-sm text-destructive/90">{changeOrder.rejectionReason}</p>
            </div>
          )}

          <Separator />

          {/* Line Items Breakdown - Only visible to managers */}
          {hasManagementAccess(userRole) && (
            <Collapsible open={lineItemsOpen} onOpenChange={setLineItemsOpen}>
              <div className="flex items-center justify-between">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 p-0 hover:bg-transparent">
                    {lineItemsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <h3 className="text-sm font-medium">Cost Breakdown</h3>
                    <Badge variant="outline" className="ml-2">
                      ${lineItemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Badge>
                  </Button>
                </CollapsibleTrigger>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveLineItemsMutation.mutate()}
                    disabled={saveLineItemsMutation.isPending}
                    data-testid="button-save-line-items"
                  >
                    {saveLineItemsMutation.isPending ? "Saving..." : "Save & Calculate"}
                  </Button>
                )}
              </div>
              
              <CollapsibleContent className="mt-4 space-y-4">
                <Tabs value={activeLineTab} onValueChange={setActiveLineTab}>
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="labor" className="flex items-center gap-1" data-testid="tab-labor">
                      <Users className="w-3 h-3" />
                      Labor
                      <Badge variant="secondary" className="ml-1 text-xs">${laborTotal.toFixed(0)}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="equipment" className="flex items-center gap-1" data-testid="tab-equipment">
                      <Wrench className="w-3 h-3" />
                      Equipment
                      <Badge variant="secondary" className="ml-1 text-xs">${equipmentTotal.toFixed(0)}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="materials" className="flex items-center gap-1" data-testid="tab-materials">
                      <Package className="w-3 h-3" />
                      Materials
                      <Badge variant="secondary" className="ml-1 text-xs">${materialTotal.toFixed(0)}</Badge>
                    </TabsTrigger>
                  </TabsList>

                  {/* Labor Tab */}
                  <TabsContent value="labor" className="space-y-3 mt-3">
                    {laborEntries.map((entry, index) => (
                      <Card key={index} className="p-3">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-3">
                            <Label className="text-xs">Employee</Label>
                            <Input
                              placeholder="Name"
                              value={entry.employeeName}
                              onChange={(e) => updateLaborEntry(index, "employeeName", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-labor-name-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Position</Label>
                            <Input
                              placeholder="Role"
                              value={entry.position}
                              onChange={(e) => updateLaborEntry(index, "position", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-labor-position-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Hours</Label>
                            <Input
                              type="number"
                              step="0.5"
                              placeholder="0"
                              value={entry.hoursWorked}
                              onChange={(e) => updateLaborEntry(index, "hoursWorked", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-labor-hours-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Rate/Hr</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={entry.hourlyRate}
                              onChange={(e) => updateLaborEntry(index, "hourlyRate", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-labor-rate-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Total</Label>
                            <div className="h-9 flex items-center font-mono text-sm">
                              ${(parseFloat(entry.hoursWorked || "0") * parseFloat(entry.hourlyRate || "0")).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1">
                            {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeLaborEntry(index)}
                                data-testid={`button-remove-labor-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={addLaborEntry} data-testid="button-add-labor">
                        <Plus className="w-4 h-4 mr-1" /> Add Labor
                      </Button>
                    )}
                    {laborEntries.length === 0 && !canEdit && (
                      <p className="text-sm text-muted-foreground text-center py-4">No labor entries</p>
                    )}
                  </TabsContent>

                  {/* Equipment Tab */}
                  <TabsContent value="equipment" className="space-y-3 mt-3">
                    {equipmentEntries.map((entry, index) => (
                      <Card key={index} className="p-3">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-2">
                            <Label className="text-xs">Type</Label>
                            <Input
                              placeholder="Type"
                              value={entry.equipmentType}
                              onChange={(e) => updateEquipmentEntry(index, "equipmentType", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-equip-type-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Description</Label>
                            <Input
                              placeholder="Details"
                              value={entry.description}
                              onChange={(e) => updateEquipmentEntry(index, "description", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-equip-desc-${index}`}
                            />
                          </div>
                          <div className="col-span-1">
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number"
                              min="1"
                              value={entry.quantity}
                              onChange={(e) => updateEquipmentEntry(index, "quantity", parseInt(e.target.value) || 1)}
                              disabled={!canEdit}
                              data-testid={`input-equip-qty-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Hours</Label>
                            <Input
                              type="number"
                              step="0.5"
                              placeholder="0"
                              value={entry.hoursUsed}
                              onChange={(e) => updateEquipmentEntry(index, "hoursUsed", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-equip-hours-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Rate/Hr</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={entry.hourlyRate}
                              onChange={(e) => updateEquipmentEntry(index, "hourlyRate", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-equip-rate-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Total</Label>
                            <div className="h-9 flex items-center font-mono text-sm">
                              ${((entry.quantity || 1) * parseFloat(entry.hoursUsed || "0") * parseFloat(entry.hourlyRate || "0")).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1">
                            {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeEquipmentEntry(index)}
                                data-testid={`button-remove-equip-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={addEquipmentEntry} data-testid="button-add-equipment">
                        <Plus className="w-4 h-4 mr-1" /> Add Equipment
                      </Button>
                    )}
                    {equipmentEntries.length === 0 && !canEdit && (
                      <p className="text-sm text-muted-foreground text-center py-4">No equipment entries</p>
                    )}
                  </TabsContent>

                  {/* Materials Tab */}
                  <TabsContent value="materials" className="space-y-3 mt-3">
                    {materialEntries.map((entry, index) => (
                      <Card key={index} className="p-3 space-y-2">
                        <div className="grid grid-cols-12 gap-2 items-end">
                          <div className="col-span-2">
                            <Label className="text-xs">Category</Label>
                            <Select
                              value={entry.category}
                              onValueChange={(v) => updateMaterialEntry(index, "category", v)}
                              disabled={!canEdit}
                            >
                              <SelectTrigger data-testid={`select-material-category-${index}`}>
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                {MATERIAL_CATEGORIES.map((cat) => (
                                  <SelectItem key={cat.value} value={cat.value}>
                                    {cat.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-3">
                            <Label className="text-xs">Description</Label>
                            <Input
                              placeholder="Material name"
                              value={entry.materialDescription}
                              onChange={(e) => updateMaterialEntry(index, "materialDescription", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-material-desc-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Quantity</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0"
                              value={entry.quantity}
                              onChange={(e) => updateMaterialEntry(index, "quantity", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-material-qty-${index}`}
                            />
                          </div>
                          <div className="col-span-1">
                            <Label className="text-xs">Unit</Label>
                            <Input
                              placeholder="CY"
                              value={entry.unit}
                              onChange={(e) => updateMaterialEntry(index, "unit", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-material-unit-${index}`}
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Unit Cost</Label>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={entry.unitCost}
                              onChange={(e) => updateMaterialEntry(index, "unitCost", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-material-cost-${index}`}
                            />
                          </div>
                          <div className="col-span-1">
                            <Label className="text-xs">Total</Label>
                            <div className="h-9 flex items-center font-mono text-sm">
                              ${(parseFloat(entry.quantity || "0") * parseFloat(entry.unitCost || "0")).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1 flex items-end gap-1">
                            {canEdit && entry.category && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  if (catalogState?.index === index) {
                                    setCatalogState(null);
                                  } else {
                                    setCatalogState({ index, category: entry.category });
                                  }
                                }}
                                data-testid={`button-catalog-${index}`}
                                title="Search vendor catalog"
                              >
                                <Search className="w-4 h-4" />
                              </Button>
                            )}
                            {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => removeMaterialEntry(index)}
                                data-testid={`button-remove-material-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                        
                        {/* Vendor Catalog Results - Per-row lookup */}
                        {catalogState?.index === index && vendorCatalog && vendorCatalog.length > 0 && (
                          <div className="mt-2 p-2 bg-muted/50 rounded-md">
                            <p className="text-xs font-medium mb-2">Vendor Catalog Items:</p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {vendorCatalog.map((item) => (
                                <Button
                                  key={item.id}
                                  variant="ghost"
                                  size="sm"
                                  className="w-full justify-between text-xs h-8"
                                  onClick={() => applyVendorPricing(index, item)}
                                  data-testid={`button-apply-catalog-${item.id}`}
                                >
                                  <span>{item.itemName}</span>
                                  <span className="text-muted-foreground">
                                    ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                                  </span>
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {catalogState?.index === index && vendorCatalog && vendorCatalog.length === 0 && (
                          <div className="mt-2 p-2 bg-muted/50 rounded-md">
                            <p className="text-xs text-muted-foreground">No vendor pricing found for this category</p>
                          </div>
                        )}
                      </Card>
                    ))}
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={addMaterialEntry} data-testid="button-add-material">
                        <Plus className="w-4 h-4 mr-1" /> Add Material
                      </Button>
                    )}
                    {materialEntries.length === 0 && !canEdit && (
                      <p className="text-sm text-muted-foreground text-center py-4">No material entries</p>
                    )}
                  </TabsContent>
                </Tabs>

                {/* Totals Summary */}
                <Card className="p-3 bg-muted/30">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Line Items Total</span>
                    <span className="text-lg font-bold font-mono">
                      ${lineItemsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}

          <Separator />

          {/* File Attachments */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Attachments</h3>
              {canEdit && <ChangeOrderFileUploader changeOrderId={changeOrder.id} variant="outline" />}
            </div>
            <ChangeOrderFiles changeOrderId={changeOrder.id} alwaysExpanded />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {isEditing ? (
            <>
              <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                data-testid="button-save-changes"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(true)}
                  data-testid="button-edit-change-order"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}

              {changeOrder.status === "DRAFT" && (
                <Button
                  onClick={() => requestApprovalMutation.mutate()}
                  disabled={requestApprovalMutation.isPending}
                  data-testid="button-request-approval-dialog"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  {requestApprovalMutation.isPending ? "Requesting..." : "Request Approval"}
                </Button>
              )}

              {canManage && changeOrder.status === "PENDING_APPROVAL" && (
                <>
                  <Button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    data-testid="button-submit-dialog"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {submitMutation.isPending ? "Submitting..." : "Submit to Client"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => returnToDraftMutation.mutate()}
                    disabled={returnToDraftMutation.isPending}
                    data-testid="button-return-draft-dialog"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    {returnToDraftMutation.isPending ? "Returning..." : "Return to Draft"}
                  </Button>
                </>
              )}

              {canManage && changeOrder.status === "SUBMITTED" && (
                <>
                  <Button
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                    data-testid="button-approve-dialog"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {approveMutation.isPending ? "Approving..." : "Approve"}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectMutation.isPending}
                    data-testid="button-reject-dialog"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    {rejectMutation.isPending ? "Rejecting..." : "Reject"}
                  </Button>
                </>
              )}

              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-dialog">
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
