import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useTMTickets, useCreateTMTicket, useSubmitTMTicket, useApproveTMTicket, useRejectTMTicket, useDeleteTMTicket, type TMTicket, type TMTicketLaborEntry, type TMTicketEquipmentEntry, type TMTicketMaterialEntry } from "@/hooks/use-data";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ChevronDown, ChevronRight, FileText, CheckCircle, XCircle, Clock, Send, Trash2, DollarSign, Users, Wrench, Package, Eye, Printer, Ruler, ListChecks, Search } from "lucide-react";
import { format } from "date-fns";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import type { ScopeItem } from "@shared/schema";

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
  leadTimeDays?: number;
  deliveryFee?: string;
}

// Material categories matching bid estimates for uniformity
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

interface TMTicketsSectionProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

interface LaborEntry {
  employeeName: string;
  position: string;
  crewName: string;
  regularHours: string;
  overtimeHours: string;
  rate: string;
  overtimeRate: string;
}

interface EquipmentEntry {
  equipmentType: string;
  description: string;
  quantity: string;
  hours: string;
  rate: string;
}

interface MaterialEntry {
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  category?: string;  // For vendor pricing catalog lookup
}

const emptyLaborEntry = (): LaborEntry => ({
  employeeName: "",
  position: "",
  crewName: "",
  regularHours: "0",
  overtimeHours: "0",
  rate: "0",
  overtimeRate: "0",
});

const emptyEquipmentEntry = (): EquipmentEntry => ({
  equipmentType: "",
  description: "",
  quantity: "1",
  hours: "0",
  rate: "0",
});

const emptyMaterialEntry = (): MaterialEntry => ({
  description: "",
  quantity: "1",
  unit: "",
  unitCost: "0",
  category: "",
});

function TMStatusBadge({ status }: { status: TMTicket["status"] }) {
  const variants: Record<TMTicket["status"], { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    DRAFT: { variant: "secondary", label: "Draft" },
    SUBMITTED: { variant: "outline", label: "Pending Review" },
    APPROVED: { variant: "default", label: "Approved" },
    REJECTED: { variant: "destructive", label: "Rejected" },
  };
  const { variant, label } = variants[status];
  return <Badge variant={variant} data-testid={`badge-status-${status.toLowerCase()}`}>{label}</Badge>;
}

export default function TMTicketsSection({ projectId, projectCode, userRole }: TMTicketsSectionProps) {
  const { toast } = useToast();
  const { data: tickets = [], isLoading } = useTMTickets(projectId);
  const createMutation = useCreateTMTicket();
  const submitMutation = useSubmitTMTicket();
  const approveMutation = useApproveTMTicket();
  const rejectMutation = useRejectTMTicket();
  const deleteMutation = useDeleteTMTicket();
  
  // Fetch existing project scope items for quick selection
  const { data: projectScopeItems = [] } = useQuery<ScopeItem[]>({
    queryKey: ["/api/projects", projectId, "scope-items"],
    enabled: !!projectId,
  });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TMTicket | null>(null);
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [ticketToReject, setTicketToReject] = useState<string | null>(null);

  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([emptyLaborEntry()]);
  const [equipmentEntries, setEquipmentEntries] = useState<EquipmentEntry[]>([]);
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);
  const [activeEntryTab, setActiveEntryTab] = useState("labor");
  
  // Standardized scope of work selection (matches estimating sheets)
  const [scopeSelection, setScopeSelection] = useState<ScopeSelectionData | null>(null);
  const [scopeQuantity, setScopeQuantity] = useState("");
  
  // Vendor pricing catalog for materials (uniformity with bid estimates)
  const [selectedMaterialCategory, setSelectedMaterialCategory] = useState<string>("");
  
  // Fetch vendor pricing catalog when category is selected
  const { data: catalogPrices = [] } = useQuery<VendorPricingCatalog[]>({
    queryKey: ["/api/vendor-pricing/search", { category: selectedMaterialCategory }],
    enabled: !!selectedMaterialCategory,
  });

  const canCreate = ["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole);
  const canApprove = ["ADMIN", "MANAGER"].includes(userRole);

  const toggleTicketExpanded = (id: string) => {
    const newSet = new Set(expandedTickets);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedTickets(newSet);
  };

  const resetForm = () => {
    setWorkDate(format(new Date(), "yyyy-MM-dd"));
    setDescription("");
    setLocation("");
    setLaborEntries([emptyLaborEntry()]);
    setEquipmentEntries([]);
    setMaterialEntries([]);
    setActiveEntryTab("labor");
    setScopeSelection(null);
    setScopeQuantity("");
    setSelectedMaterialCategory("");
  };
  
  // Apply vendor catalog pricing to a material entry
  const applyCatalogPrice = (catalogItem: VendorPricingCatalog) => {
    const newEntry: MaterialEntry = {
      description: catalogItem.itemName,
      quantity: "1",
      unit: catalogItem.unit,
      unitCost: catalogItem.unitPrice,
      category: catalogItem.category,
    };
    setMaterialEntries([...materialEntries, newEntry]);
    toast({ title: "Catalog price applied", description: `Added ${catalogItem.itemName} at $${catalogItem.unitPrice}/${catalogItem.unit}` });
  };

  const handleCreate = async () => {
    if (!description.trim()) {
      toast({ title: "Error", description: "Description is required", variant: "destructive" });
      return;
    }

    const validLaborEntries = laborEntries.filter(e => e.employeeName.trim() && parseFloat(e.regularHours) > 0);
    const validEquipmentEntries = equipmentEntries.filter(e => e.equipmentType.trim() && parseFloat(e.hours) > 0);
    const validMaterialEntries = materialEntries.filter(e => e.description.trim() && parseFloat(e.quantity) > 0);

    if (validLaborEntries.length === 0 && validEquipmentEntries.length === 0 && validMaterialEntries.length === 0) {
      toast({ title: "Error", description: "At least one labor, equipment, or material entry is required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        workDate,
        description,
        location: location || undefined,
        // Standardized scope data for production rate tracking
        workTypeId: scopeSelection?.workTypeId || undefined,
        workTypeCode: scopeSelection?.workTypeCode || undefined,
        workTypeName: scopeSelection?.workTypeName || undefined,
        categoryName: scopeSelection?.categoryName || undefined,
        // Stringify arrays for API (schema expects JSON strings) - always send "[]" when empty
        scopeModifierIds: scopeSelection ? JSON.stringify(scopeSelection.modifierIds || []) : undefined,
        scopeModifierNames: scopeSelection ? JSON.stringify(scopeSelection.modifierNames || []) : undefined,
        canonicalName: scopeSelection?.canonicalName || undefined,
        scopeUnit: scopeSelection?.unit || undefined,
        scopeQuantity: scopeQuantity || undefined,
        laborEntries: validLaborEntries.map(e => ({
          employeeName: e.employeeName,
          position: e.position || undefined,
          crewName: e.crewName || undefined,
          regularHours: e.regularHours,
          overtimeHours: e.overtimeHours || undefined,
          rate: e.rate,
          overtimeRate: e.overtimeRate || undefined,
        })),
        equipmentEntries: validEquipmentEntries.map(e => ({
          equipmentType: e.equipmentType,
          description: e.description || undefined,
          quantity: e.quantity,
          hours: e.hours,
          rate: e.rate,
        })),
        materialEntries: validMaterialEntries.map(e => ({
          description: e.description,
          quantity: e.quantity,
          unit: e.unit || undefined,
          unitCost: e.unitCost,
        })),
      });
      toast({ title: "Success", description: "T&M ticket created" });
      setShowCreateDialog(false);
      resetForm();
    } catch (error) {
      toast({ title: "Error", description: "Failed to create T&M ticket", variant: "destructive" });
    }
  };

  const handleSubmit = async (ticketId: string) => {
    try {
      await submitMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket submitted for approval" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit ticket", variant: "destructive" });
    }
  };

  const handleApprove = async (ticketId: string) => {
    try {
      await approveMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve ticket", variant: "destructive" });
    }
  };

  const handleReject = async () => {
    if (!ticketToReject || !rejectionReason.trim()) {
      toast({ title: "Error", description: "Rejection reason is required", variant: "destructive" });
      return;
    }
    try {
      await rejectMutation.mutateAsync({ ticketId: ticketToReject, projectId, reason: rejectionReason });
      toast({ title: "Success", description: "T&M ticket rejected" });
      setShowRejectDialog(false);
      setRejectionReason("");
      setTicketToReject(null);
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject ticket", variant: "destructive" });
    }
  };

  const handleDelete = async (ticketId: string) => {
    try {
      await deleteMutation.mutateAsync({ ticketId, projectId });
      toast({ title: "Success", description: "T&M ticket deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete ticket", variant: "destructive" });
    }
  };

  const handleViewTicket = (ticket: TMTicket) => {
    setSelectedTicket(ticket);
    setShowViewDialog(true);
  };

  const handleViewPDF = (ticketId: string) => {
    window.open(`/api/tm-tickets/${ticketId}/pdf`, "_blank");
  };

  const addLaborEntry = () => setLaborEntries([...laborEntries, emptyLaborEntry()]);
  const removeLaborEntry = (index: number) => setLaborEntries(laborEntries.filter((_, i) => i !== index));
  const updateLaborEntry = (index: number, field: keyof LaborEntry, value: string) => {
    const updated = [...laborEntries];
    updated[index] = { ...updated[index], [field]: value };
    setLaborEntries(updated);
  };

  const addEquipmentEntry = () => setEquipmentEntries([...equipmentEntries, emptyEquipmentEntry()]);
  const removeEquipmentEntry = (index: number) => setEquipmentEntries(equipmentEntries.filter((_, i) => i !== index));
  const updateEquipmentEntry = (index: number, field: keyof EquipmentEntry, value: string) => {
    const updated = [...equipmentEntries];
    updated[index] = { ...updated[index], [field]: value };
    setEquipmentEntries(updated);
  };

  const addMaterialEntry = () => setMaterialEntries([...materialEntries, emptyMaterialEntry()]);
  const removeMaterialEntry = (index: number) => setMaterialEntries(materialEntries.filter((_, i) => i !== index));
  const updateMaterialEntry = (index: number, field: keyof MaterialEntry, value: string) => {
    const updated = [...materialEntries];
    updated[index] = { ...updated[index], [field]: value };
    setMaterialEntries(updated);
  };

  const formatCurrency = (value: string | number) => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
  };

  const sortedTickets = [...tickets].sort((a, b) => {
    const statusOrder = { SUBMITTED: 0, DRAFT: 1, APPROVED: 2, REJECTED: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const pendingCount = tickets.filter(t => t.status === "SUBMITTED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">T&M Work Tickets</h3>
          {pendingCount > 0 && (
            <Badge variant="secondary" data-testid="badge-pending-count">
              {pendingCount} pending
            </Badge>
          )}
        </div>
        {canCreate && (
          <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-tm-ticket">
                <Plus className="w-4 h-4 mr-2" />
                New T&M Ticket
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-tm-ticket">
              <DialogHeader>
                <DialogTitle>Create T&M Work Ticket</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="tm-work-date">Work Date</Label>
                    <Input
                      id="tm-work-date"
                      type="date"
                      value={workDate}
                      onChange={(e) => setWorkDate(e.target.value)}
                      data-testid="input-tm-work-date"
                    />
                  </div>
                  <div>
                    <Label htmlFor="tm-location">Location</Label>
                    <Input
                      id="tm-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Work location (optional)"
                      data-testid="input-tm-location"
                    />
                  </div>
                </div>

                {/* Standardized Scope of Work - matches estimating sheets for production rate tracking */}
                <Card className="p-4 bg-muted/30">
                  <div className="flex items-center gap-2 mb-3">
                    <Ruler className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-medium">Scope of Work (for Production Rate Tracking)</Label>
                  </div>
                  
                  {/* Quick selection from existing project scope items */}
                  {projectScopeItems.length > 0 && (
                    <div className="space-y-2 mb-4 p-3 bg-background rounded-md border">
                      <div className="flex items-center gap-2">
                        <ListChecks className="w-4 h-4 text-muted-foreground" />
                        <Label className="text-xs text-muted-foreground">Select from Project Scope Items</Label>
                      </div>
                      <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                        {projectScopeItems.map((item) => (
                          <Button
                            key={item.id}
                            type="button"
                            variant={scopeSelection?.canonicalName === item.description ? "default" : "outline"}
                            size="sm"
                            className="text-xs h-auto py-1 px-2"
                            onClick={() => {
                              setScopeSelection({
                                workTypeId: "",
                                workTypeName: item.description,
                                workTypeCode: "",
                                categoryName: "",
                                unit: item.unit,
                                modifierIds: [],
                                modifierNames: [],
                                canonicalName: item.description,
                              });
                            }}
                            data-testid={`button-scope-item-${item.id}`}
                          >
                            {item.description} ({item.completedQuantity || 0}/{item.totalQuantity} {item.unit})
                          </Button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Or use the selector below to create a new scope entry
                      </p>
                    </div>
                  )}
                  
                  <StandardizedScopeSelector
                    value={scopeSelection || undefined}
                    onChange={setScopeSelection}
                    showDimensionInputs={false}
                  />
                  {scopeSelection && (
                    <div className="mt-3 grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="tm-scope-quantity">Quantity Completed</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id="tm-scope-quantity"
                            type="number"
                            step="0.01"
                            value={scopeQuantity}
                            onChange={(e) => setScopeQuantity(e.target.value)}
                            placeholder="0"
                            data-testid="input-tm-scope-quantity"
                          />
                          <span className="text-sm text-muted-foreground whitespace-nowrap">{scopeSelection.unit}</span>
                        </div>
                      </div>
                      <div className="flex items-end">
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">Selected:</span> {scopeSelection.canonicalName}
                        </div>
                      </div>
                    </div>
                  )}
                  {!scopeSelection && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Select a work type to enable production rate tracking for T&M work.
                    </p>
                  )}
                </Card>

                <div>
                  <Label htmlFor="tm-description">Work Description / Notes</Label>
                  <Textarea
                    id="tm-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the T&M work performed (required)..."
                    data-testid="input-tm-description"
                  />
                </div>

                <Tabs value={activeEntryTab} onValueChange={setActiveEntryTab}>
                  <TabsList>
                    <TabsTrigger value="labor" data-testid="tab-labor-entries">
                      <Users className="w-4 h-4 mr-2" />
                      Labor ({laborEntries.filter(e => e.employeeName.trim()).length})
                    </TabsTrigger>
                    <TabsTrigger value="equipment" data-testid="tab-equipment-entries">
                      <Wrench className="w-4 h-4 mr-2" />
                      Equipment ({equipmentEntries.filter(e => e.equipmentType.trim()).length})
                    </TabsTrigger>
                    <TabsTrigger value="materials" data-testid="tab-material-entries">
                      <Package className="w-4 h-4 mr-2" />
                      Materials ({materialEntries.filter(e => e.description.trim()).length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="labor" className="space-y-3">
                    {laborEntries.map((entry, index) => (
                      <Card key={index} className="p-3">
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          <div className="col-span-2">
                            <Label className="text-xs">Employee Name</Label>
                            <Input
                              value={entry.employeeName}
                              onChange={(e) => updateLaborEntry(index, "employeeName", e.target.value)}
                              placeholder="Name"
                              data-testid={`input-labor-name-${index}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Position</Label>
                            <Input
                              value={entry.position}
                              onChange={(e) => updateLaborEntry(index, "position", e.target.value)}
                              placeholder="Position"
                              data-testid={`input-labor-position-${index}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Crew</Label>
                            <Input
                              value={entry.crewName}
                              onChange={(e) => updateLaborEntry(index, "crewName", e.target.value)}
                              placeholder="Crew"
                              data-testid={`input-labor-crew-${index}`}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-5 gap-2">
                          <div>
                            <Label className="text-xs">Reg Hours</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={entry.regularHours}
                              onChange={(e) => updateLaborEntry(index, "regularHours", e.target.value)}
                              data-testid={`input-labor-reg-hours-${index}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">OT Hours</Label>
                            <Input
                              type="number"
                              step="0.5"
                              value={entry.overtimeHours}
                              onChange={(e) => updateLaborEntry(index, "overtimeHours", e.target.value)}
                              data-testid={`input-labor-ot-hours-${index}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Reg Rate</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={entry.rate}
                              onChange={(e) => updateLaborEntry(index, "rate", e.target.value)}
                              data-testid={`input-labor-rate-${index}`}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">OT Rate</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={entry.overtimeRate}
                              onChange={(e) => updateLaborEntry(index, "overtimeRate", e.target.value)}
                              data-testid={`input-labor-ot-rate-${index}`}
                            />
                          </div>
                          <div className="flex items-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeLaborEntry(index)}
                              disabled={laborEntries.length === 1}
                              data-testid={`button-remove-labor-${index}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                    <Button variant="outline" size="sm" onClick={addLaborEntry} data-testid="button-add-labor">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Labor Entry
                    </Button>
                  </TabsContent>

                  <TabsContent value="equipment" className="space-y-3">
                    {equipmentEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No equipment entries. Click below to add.</p>
                    ) : (
                      equipmentEntries.map((entry, index) => (
                        <Card key={index} className="p-3">
                          <div className="grid grid-cols-6 gap-2">
                            <div className="col-span-2">
                              <Label className="text-xs">Equipment Type</Label>
                              <Input
                                value={entry.equipmentType}
                                onChange={(e) => updateEquipmentEntry(index, "equipmentType", e.target.value)}
                                placeholder="Type"
                                data-testid={`input-equipment-type-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Qty</Label>
                              <Input
                                type="number"
                                value={entry.quantity}
                                onChange={(e) => updateEquipmentEntry(index, "quantity", e.target.value)}
                                data-testid={`input-equipment-qty-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Hours</Label>
                              <Input
                                type="number"
                                step="0.5"
                                value={entry.hours}
                                onChange={(e) => updateEquipmentEntry(index, "hours", e.target.value)}
                                data-testid={`input-equipment-hours-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Rate/Hr</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={entry.rate}
                                onChange={(e) => updateEquipmentEntry(index, "rate", e.target.value)}
                                data-testid={`input-equipment-rate-${index}`}
                              />
                            </div>
                            <div className="flex items-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeEquipmentEntry(index)}
                                data-testid={`button-remove-equipment-${index}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-2">
                            <Label className="text-xs">Description</Label>
                            <Input
                              value={entry.description}
                              onChange={(e) => updateEquipmentEntry(index, "description", e.target.value)}
                              placeholder="Additional details (optional)"
                              data-testid={`input-equipment-desc-${index}`}
                            />
                          </div>
                        </Card>
                      ))
                    )}
                    <Button variant="outline" size="sm" onClick={addEquipmentEntry} data-testid="button-add-equipment">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Equipment Entry
                    </Button>
                  </TabsContent>

                  <TabsContent value="materials" className="space-y-3">
                    {/* Vendor Pricing Catalog Lookup - same as bid estimates */}
                    <Card className="p-4 bg-muted/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <h4 className="text-sm font-medium">Vendor Pricing Catalog</h4>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <Label className="text-xs">Material Category</Label>
                          <Select 
                            value={selectedMaterialCategory} 
                            onValueChange={setSelectedMaterialCategory}
                          >
                            <SelectTrigger data-testid="select-material-category">
                              <SelectValue placeholder="Select category to search catalog..." />
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
                      </div>
                      
                      {selectedMaterialCategory && catalogPrices.length > 0 && (
                        <div className="mt-3 border rounded-md p-3 bg-background max-h-40 overflow-y-auto">
                          <p className="text-xs text-muted-foreground mb-2">
                            Click to add from vendor catalog:
                          </p>
                          <div className="space-y-1">
                            {catalogPrices.slice(0, 8).map((item) => (
                              <div 
                                key={item.id}
                                onClick={() => applyCatalogPrice(item)}
                                className="flex items-center justify-between p-2 hover-elevate cursor-pointer rounded text-sm"
                                data-testid={`catalog-item-${item.id}`}
                              >
                                <div className="flex-1">
                                  <span className="font-medium">{item.itemName}</span>
                                  {item.organizationName && (
                                    <span className="text-xs text-muted-foreground ml-2">
                                      ({item.organizationName})
                                    </span>
                                  )}
                                </div>
                                <Badge variant="secondary" className="font-mono">
                                  ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                                </Badge>
                              </div>
                            ))}
                          </div>
                          {catalogPrices.length > 8 && (
                            <p className="text-xs text-muted-foreground mt-2 text-center">
                              +{catalogPrices.length - 8} more items
                            </p>
                          )}
                        </div>
                      )}
                      
                      {selectedMaterialCategory && catalogPrices.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          No vendor pricing found for this category. Add items manually below.
                        </p>
                      )}
                    </Card>
                    
                    {/* Material entries list */}
                    {materialEntries.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No material entries. Select from catalog above or add manually below.</p>
                    ) : (
                      materialEntries.map((entry, index) => (
                        <Card key={index} className="p-3">
                          <div className="grid grid-cols-5 gap-2">
                            <div className="col-span-2">
                              <Label className="text-xs">Description</Label>
                              <Input
                                value={entry.description}
                                onChange={(e) => updateMaterialEntry(index, "description", e.target.value)}
                                placeholder="Material description"
                                data-testid={`input-material-desc-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Quantity</Label>
                              <Input
                                type="number"
                                step="0.01"
                                value={entry.quantity}
                                onChange={(e) => updateMaterialEntry(index, "quantity", e.target.value)}
                                data-testid={`input-material-qty-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Unit</Label>
                              <Input
                                value={entry.unit}
                                onChange={(e) => updateMaterialEntry(index, "unit", e.target.value)}
                                placeholder="ea, lf, sf..."
                                data-testid={`input-material-unit-${index}`}
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <Label className="text-xs">Unit Cost</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={entry.unitCost}
                                  onChange={(e) => updateMaterialEntry(index, "unitCost", e.target.value)}
                                  data-testid={`input-material-cost-${index}`}
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeMaterialEntry(index)}
                                  data-testid={`button-remove-material-${index}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    )}
                    <Button variant="outline" size="sm" onClick={addMaterialEntry} data-testid="button-add-material">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Material Manually
                    </Button>
                  </TabsContent>
                </Tabs>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-tm-ticket">
                  {createMutation.isPending ? "Creating..." : "Create Ticket"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-4 text-muted-foreground">Loading T&M tickets...</div>
      ) : sortedTickets.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>No T&M work tickets yet</p>
          {canCreate && <p className="text-sm">Click "New T&M Ticket" to create one</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedTickets.map((ticket) => (
            <Collapsible
              key={ticket.id}
              open={expandedTickets.has(ticket.id)}
              onOpenChange={() => toggleTicketExpanded(ticket.id)}
            >
              <Card data-testid={`tm-ticket-card-${ticket.id}`}>
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between p-4 cursor-pointer hover-elevate">
                    <div className="flex items-center gap-4">
                      {expandedTickets.has(ticket.id) ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid={`text-ticket-number-${ticket.id}`}>
                            {ticket.ticketNumber}
                          </span>
                          <TMStatusBadge status={ticket.status} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(ticket.workDate), "MMM d, yyyy")} - {ticket.scopeDescription.substring(0, 50)}
                          {ticket.scopeDescription.length > 50 && "..."}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-mono font-medium" data-testid={`text-ticket-total-${ticket.id}`}>
                          {formatCurrency(ticket.grandTotal)}
                        </p>
                        <div className="flex gap-2 text-xs text-muted-foreground">
                          <span>L: {formatCurrency(ticket.totalLaborCost)}</span>
                          <span>E: {formatCurrency(ticket.totalEquipmentCost)}</span>
                          <span>M: {formatCurrency(ticket.totalMaterialCost)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 pt-0 border-t">
                    <div className="mt-4 space-y-4">
                      <p className="text-sm"><span className="font-medium">Description:</span> {ticket.scopeDescription}</p>
                      {ticket.notes && (
                        <p className="text-sm"><span className="font-medium">Notes:</span> {ticket.notes}</p>
                      )}

                      {ticket.rejectionReason && (
                        <div className="bg-destructive/10 p-3 rounded-md">
                          <p className="text-sm font-medium text-destructive">Rejection Reason:</p>
                          <p className="text-sm">{ticket.rejectionReason}</p>
                        </div>
                      )}

                      {ticket.laborEntries && ticket.laborEntries.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Users className="w-4 h-4" /> Labor Entries
                          </h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Employee</TableHead>
                                <TableHead>Position</TableHead>
                                <TableHead className="text-right">Hours</TableHead>
                                <TableHead className="text-right">Rate</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {ticket.laborEntries.map((entry) => (
                                <TableRow key={entry.id}>
                                  <TableCell>{entry.employeeName}</TableCell>
                                  <TableCell>{entry.position || "-"}</TableCell>
                                  <TableCell className="text-right">{entry.hoursWorked}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.hourlyRate || "0")}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {ticket.equipmentEntries && ticket.equipmentEntries.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Wrench className="w-4 h-4" /> Equipment Entries
                          </h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Equipment</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Hours</TableHead>
                                <TableHead className="text-right">Rate</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {ticket.equipmentEntries.map((entry) => (
                                <TableRow key={entry.id}>
                                  <TableCell>{entry.equipmentType}</TableCell>
                                  <TableCell className="text-right">{entry.quantity}</TableCell>
                                  <TableCell className="text-right">{entry.hoursUsed}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.hourlyRate || "0")}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {ticket.materialEntries && ticket.materialEntries.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Package className="w-4 h-4" /> Material Entries
                          </h4>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead>Unit</TableHead>
                                <TableHead className="text-right">Unit Cost</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {ticket.materialEntries.map((entry) => (
                                <TableRow key={entry.id}>
                                  <TableCell>{entry.materialDescription}</TableCell>
                                  <TableCell className="text-right">{entry.quantity}</TableCell>
                                  <TableCell>{entry.unit || "-"}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.unitCost || "0")}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2 border-t">
                        {ticket.status === "DRAFT" && canCreate && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSubmit(ticket.id)}
                              disabled={submitMutation.isPending}
                              data-testid={`button-submit-${ticket.id}`}
                            >
                              <Send className="w-4 h-4 mr-2" />
                              Submit for Approval
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" data-testid={`button-delete-${ticket.id}`}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete T&M Ticket?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will permanently delete ticket {ticket.ticketNumber}. This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(ticket.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        )}

                        {ticket.status === "SUBMITTED" && canApprove && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setTicketToReject(ticket.id);
                                setShowRejectDialog(true);
                              }}
                              data-testid={`button-reject-${ticket.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-2" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleApprove(ticket.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${ticket.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Approve
                            </Button>
                          </>
                        )}

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewPDF(ticket.id)}
                          data-testid={`button-view-pdf-${ticket.id}`}
                        >
                          <Printer className="w-4 h-4 mr-2" />
                          Print / PDF
                        </Button>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          ))}
        </div>
      )}

      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent data-testid="dialog-reject-tm-ticket">
          <DialogHeader>
            <DialogTitle>Reject T&M Ticket</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="rejection-reason">Rejection Reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this ticket is being rejected..."
              data-testid="input-rejection-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending || !rejectionReason.trim()}
              data-testid="button-confirm-reject"
            >
              Reject Ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
