import { useState, useEffect } from "react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { FileText, Calendar, User, CheckCircle, XCircle, Clock, Edit, Ruler, Plus, Trash2, Users, Wrench, Package, Search, ChevronDown, ChevronRight, History, ArrowRight, Shield, Flag, ClipboardCheck, Ban, Send, Link, AlertTriangle } from "lucide-react";
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
  approvedAt?: string | Date | null;
  rejectionReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
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
  // Void fields
  voidedAt?: string | Date | null;
  voidedById?: string | null;
  voidReason?: string | null;
  // Client response due date
  clientResponseDueDate?: string | Date | null;
  // Linked items (Task #70)
  linkedTmTicketId?: string | null;
  linkedRfiId?: string | null;
  projectId?: string;
}

interface ChangeOrderDialogProps {
  changeOrder: ChangeOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  userRole: string;
}

const APPROVAL_ROLES = [
  { value: "MANAGER", label: "Manager" },
  { value: "ADMIN", label: "Admin" },
  { value: "OFFICE_MANAGER", label: "Office Manager" },
];

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
  // Void dialog state (from HEAD)
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  // Approval chain config state (from Task #70)
  const [approvalChainOpen, setApprovalChainOpen] = useState(false);
  const [newApprovalSteps, setNewApprovalSteps] = useState<Array<{ approverRole: string }>>([{ approverRole: "MANAGER" }]);
  // T&M / RFI picker state (from Task #70)
  const [showTmPicker, setShowTmPicker] = useState(false);
  const [showRfiPicker, setShowRfiPicker] = useState(false);
  
  // Line items state
  const [laborEntries, setLaborEntries] = useState<LaborEntry[]>([]);
  const [equipmentEntries, setEquipmentEntries] = useState<EquipmentEntry[]>([]);
  const [materialEntries, setMaterialEntries] = useState<MaterialEntry[]>([]);
  // Per-row catalog state: which row has catalog open and what category to query
  const [catalogState, setCatalogState] = useState<{ index: number; category: string } | null>(null);

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);
  const canReview = ["ADMIN", "MANAGER", "PROJECT_ENGINEER"].includes(userRole);
  const isAdmin = userRole === "ADMIN";
  // ADMIN/MANAGER can edit in DRAFT or PCO states
  const canEdit = canManage && (changeOrder?.status === "DRAFT" || changeOrder?.status === "PCO");
  const nonTerminalStatuses = ["DRAFT", "PCO", "PENDING_APPROVAL", "SUBMITTED"];
  const canLinkItems = canManage && nonTerminalStatuses.includes(changeOrder?.status || "");
  
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

  // Fetch revision history
  const { data: revisions } = useQuery<Array<{
    revision: {
      id: string;
      revisionNumber: number;
      previousStatus: string;
      newStatus: string;
      amount: string | null;
      description: string | null;
      changedFields: string | null;
      createdAt: string;
    };
    revisedBy: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
  }>>({
    queryKey: ["/api/change-orders", changeOrder?.id, "revisions"],
    enabled: !!changeOrder?.id && open,
  });

  // Fetch approval chain
  const { data: approvals } = useQuery<Array<{
    approval: {
      id: string;
      approverRole: string;
      status: string;
      stepOrder: number;
      comments: string | null;
      decidedAt: string | null;
      createdAt: string;
    };
    approver: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
  }>>({
    queryKey: ["/api/change-orders", changeOrder?.id, "approvals"],
    enabled: !!changeOrder?.id && open,
  });

  // Fetch T&M tickets for the project (for the picker)
  const { data: tmTickets = [] } = useQuery<Array<{
    id: string;
    ticketNumber: string;
    description: string;
    status: string;
    totalBillableAmount?: string;
  }>>({
    queryKey: ["/api/projects", changeOrder?.projectId, "tm-tickets"],
    enabled: showTmPicker && !!changeOrder?.projectId,
  });

  // Fetch RFIs for the project (for the picker) - API returns flat array
  const { data: projectRfis = [] } = useQuery<Array<{
    id: string;
    rfiNumber: string;
    subject: string;
    status: string;
  }>>({
    queryKey: ["/api/rfi", { projectId: changeOrder?.projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/rfi?projectId=${encodeURIComponent(changeOrder?.projectId || "")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch RFIs");
      return res.json();
    },
    enabled: showRfiPicker && !!changeOrder?.projectId,
  });

  useEffect(() => {
    if (changeOrder) {
      setEditedNumber(changeOrder.changeOrderNumber);
      setEditedDescription(changeOrder.description);
      setEditedAmount(changeOrder.amount);
      setIsEditing(false);
      setNewApprovalSteps([{ approverRole: "MANAGER" }]);
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
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "approvals"] });
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

  // PCO workflow mutations (from HEAD)
  const promoteToReviewMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/promote-to-review`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order promoted to pricing review" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to promote to pricing review", variant: "destructive" });
    },
  });

  const approvePricingMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/approve-pricing`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Pricing approved, change order submitted to client" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve pricing", variant: "destructive" });
    },
  });

  const returnToPcoMutation = useMutation({
    mutationFn: async (reason?: string) => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/return-to-pco`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order returned to PCO" });
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to return to PCO", variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: async (reason: string) => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/void`, { voidReason: reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order voided" });
      setShowVoidDialog(false);
      setVoidReason("");
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to void change order", variant: "destructive" });
    },
  });

  const handleReturnToPco = async () => {
    const reason = prompt("Reason for returning to PCO (optional):");
    returnToPcoMutation.mutate(reason || undefined);
  };

  const handleVoid = () => {
    if (!voidReason.trim()) {
      toast({ title: "Error", description: "Please provide a void reason", variant: "destructive" });
      return;
    }
    voidMutation.mutate(voidReason);
  };

  // Setup approval chain mutation (from Task #70)
  const setupApprovalChainMutation = useMutation({
    mutationFn: async (steps: Array<{ approverRole: string }>) => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/setup-approval-chain`, { steps });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "approvals"] });
      toast({ title: "Success", description: "Approval chain configured" });
      setApprovalChainOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to configure approval chain", variant: "destructive" });
    },
  });

  // Link T&M mutation (from Task #70)
  const linkTmMutation = useMutation({
    mutationFn: async (tmTicketId: string) => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/link-tm`, { tmTicketId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "T&M ticket linked" });
      setShowTmPicker(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to link T&M ticket", variant: "destructive" });
    },
  });

  // Link RFI mutation (from Task #70)
  const linkRfiMutation = useMutation({
    mutationFn: async (rfiId: string) => {
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/link-rfi`, { rfiId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "RFI linked" });
      setShowRfiPicker(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to link RFI", variant: "destructive" });
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

  const isResponseOverdue = changeOrder.clientResponseDueDate && changeOrder.status === "SUBMITTED"
    && isPast(new Date(changeOrder.clientResponseDueDate));

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
      case "PCO":
        return "outline";
      case "PRICING_REVIEW":
        return "secondary";
      case "VOIDED":
        return "outline";
      default:
        return "secondary";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PCO":
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300" data-testid="status-badge-pco">
            <Flag className="w-3 h-3 mr-1" />
            PCO
          </Badge>
        );
      case "PRICING_REVIEW":
        return (
          <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300" data-testid="status-badge-pricing-review">
            <ClipboardCheck className="w-3 h-3 mr-1" />
            Pricing Review
          </Badge>
        );
      case "VOIDED":
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-900 dark:text-gray-400" data-testid="status-badge-voided">
            <Ban className="w-3 h-3 mr-1" />
            Voided
          </Badge>
        );
      default:
        return <Badge variant={getStatusColor(status) as any}>{status.replace(/_/g, " ")}</Badge>;
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-view-change-order">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Change Order Details
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isResponseOverdue && (
                <Badge variant="destructive" className="flex items-center gap-1" data-testid="badge-response-overdue">
                  <AlertTriangle className="w-3 h-3" />
                  Response Overdue
                </Badge>
              )}
              {getStatusBadge(changeOrder.status)}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Void Panel - shown when voidReason is set (may also be VOIDED status) */}
          {changeOrder.voidReason && (
            <div className="p-4 bg-muted border rounded-md space-y-2" data-testid="panel-voided">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-destructive" />
                <span className="text-sm font-medium text-destructive">Voided</span>
              </div>
              <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {changeOrder.voidReason}</p>
              {changeOrder.voidedAt && (
                <p className="text-sm text-muted-foreground">
                  {format(new Date(changeOrder.voidedAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              )}
              {/* Voided-by from revision history */}
              {revisions && (() => {
                const voidRevision = revisions.find(r => r.revision.newStatus === "VOIDED");
                if (voidRevision?.revisedBy) {
                  return (
                    <p className="text-sm text-muted-foreground" data-testid="text-voided-by">
                      by {voidRevision.revisedBy.firstName} {voidRevision.revisedBy.lastName}
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {/* Submitted state info panel with client response deadline */}
          {changeOrder.status === "SUBMITTED" && changeOrder.clientResponseDueDate && (
            <div className={`p-3 rounded-md border ${isResponseOverdue ? "bg-destructive/10 border-destructive/30" : "bg-muted/40"}`} data-testid="panel-submitted-info">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Client Response Due</span>
                {isResponseOverdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
              </div>
              <p className="text-sm mt-1">
                {format(new Date(changeOrder.clientResponseDueDate), "MMMM d, yyyy")}
                {" "}
                <span className="text-muted-foreground">
                  ({formatDistanceToNow(new Date(changeOrder.clientResponseDueDate), { addSuffix: true })})
                </span>
              </p>
            </div>
          )}

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
                      const modifiers = JSON.parse(changeOrder.scopeModifierNames!);
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

            {/* Linked T&M Ticket */}
            {changeOrder.linkedTmTicketId && (
              <div className="p-3 bg-muted/30 rounded-md" data-testid="card-linked-tm">
                <div className="flex items-center gap-2">
                  <Link className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Linked T&M Ticket</span>
                </div>
                <p className="text-sm mt-1 text-muted-foreground font-mono">{changeOrder.linkedTmTicketId}</p>
              </div>
            )}

            {/* Linked RFI */}
            {changeOrder.linkedRfiId && (
              <div className="p-3 bg-muted/30 rounded-md" data-testid="card-linked-rfi">
                <div className="flex items-center gap-2">
                  <Link className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Linked RFI</span>
                </div>
                <p className="text-sm mt-1 text-muted-foreground font-mono">{changeOrder.linkedRfiId}</p>
              </div>
            )}

            {/* Link T&M / Link RFI buttons */}
            {canLinkItems && (
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTmPicker(true)}
                  data-testid="button-link-tm"
                >
                  <Link className="w-4 h-4 mr-2" />
                  {changeOrder.linkedTmTicketId ? "Change T&M Ticket" : "Link T&M Ticket"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRfiPicker(true)}
                  data-testid="button-link-rfi"
                >
                  <Link className="w-4 h-4 mr-2" />
                  {changeOrder.linkedRfiId ? "Change RFI" : "Link RFI"}
                </Button>
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

          {changeOrder.rejectionReason && changeOrder.status !== "VOIDED" && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm font-medium text-destructive mb-1">Rejection Reason:</p>
              <p className="text-sm text-destructive/90">{changeOrder.rejectionReason}</p>
            </div>
          )}

          <Separator />

          {/* Configure Approval Chain (ADMIN only, non-terminal editable statuses) */}
          {isAdmin && ["DRAFT", "PCO", "PENDING_APPROVAL"].includes(changeOrder.status) && (
            <>
              <Collapsible open={approvalChainOpen} onOpenChange={setApprovalChainOpen}>
                <div className="flex items-center justify-between">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 p-0 hover:bg-transparent" data-testid="toggle-approval-chain-config">
                      {approvalChainOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <Shield className="w-4 h-4" />
                      <h3 className="text-sm font-medium">Configure Approval Chain</h3>
                      {approvals && approvals.length > 0 && (
                        <Badge variant="outline" className="ml-2 text-xs">{approvals.length} step{approvals.length !== 1 ? "s" : ""}</Badge>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="mt-3 space-y-3">
                  {newApprovalSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2" data-testid={`approval-step-config-${idx}`}>
                      <span className="text-sm text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                      <Select
                        value={step.approverRole}
                        onValueChange={(v) => {
                          const updated = [...newApprovalSteps];
                          updated[idx] = { approverRole: v };
                          setNewApprovalSteps(updated);
                        }}
                      >
                        <SelectTrigger className="flex-1" data-testid={`select-approver-role-${idx}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APPROVAL_ROLES.map((role) => (
                            <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {newApprovalSteps.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setNewApprovalSteps(newApprovalSteps.filter((_, i) => i !== idx))}
                          data-testid={`button-remove-step-${idx}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    {newApprovalSteps.length < 3 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setNewApprovalSteps([...newApprovalSteps, { approverRole: "MANAGER" }])}
                        data-testid="button-add-approval-step"
                      >
                        <Plus className="w-4 h-4 mr-1" /> Add Step
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => setupApprovalChainMutation.mutate(newApprovalSteps)}
                      disabled={setupApprovalChainMutation.isPending}
                      data-testid="button-save-approval-chain"
                    >
                      {setupApprovalChainMutation.isPending ? "Saving..." : "Save Chain"}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

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
                          <div className="col-span-3">
                            <Label className="text-xs">Equipment Type</Label>
                            <Input
                              placeholder="Type"
                              value={entry.equipmentType}
                              onChange={(e) => updateEquipmentEntry(index, "equipmentType", e.target.value)}
                              disabled={!canEdit}
                              data-testid={`input-equip-type-${index}`}
                            />
                          </div>
                          <div className="col-span-3">
                            <Label className="text-xs">Description</Label>
                            <Input
                              placeholder="Description"
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
                      <Card key={index} className="p-3">
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

          {/* Approval Chain Progress */}
          {approvals && approvals.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Approval Chain
                </h3>
                <div className="space-y-2">
                  {approvals.map((item, idx) => (
                    <div key={item.approval.id} className="flex items-center gap-3" data-testid={`approval-step-${item.approval.stepOrder}`}>
                      <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 ${
                        item.approval.status === "APPROVED" ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300" :
                        item.approval.status === "REJECTED" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {item.approval.status === "APPROVED" ? <CheckCircle className="w-4 h-4" /> :
                         item.approval.status === "REJECTED" ? <XCircle className="w-4 h-4" /> :
                         item.approval.stepOrder}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.approval.approverRole}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.approval.status === "PENDING" ? "Awaiting approval" :
                           item.approver ? `${item.approver.firstName} ${item.approver.lastName}` : "—"}
                          {item.approval.decidedAt && ` · ${formatDistanceToNow(new Date(item.approval.decidedAt), { addSuffix: true })}`}
                        </p>
                        {item.approval.comments && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">"{item.approval.comments}"</p>
                        )}
                      </div>
                      <Badge variant={
                        item.approval.status === "APPROVED" ? "default" :
                        item.approval.status === "REJECTED" ? "destructive" :
                        "secondary"
                      }>
                        {item.approval.status}
                      </Badge>
                      {idx < approvals.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 hidden sm:block" />}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Revision History Timeline */}
          {revisions && revisions.length > 0 && (
            <>
              <Separator />
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full" data-testid="toggle-revision-history">
                  <History className="w-4 h-4" />
                  Revision History ({revisions.length})
                  <ChevronRight className="w-4 h-4 ml-auto transition-transform data-[state=open]:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <div className="space-y-3">
                    {revisions.map((item) => (
                      <div key={item.revision.id} className="flex gap-3 text-sm" data-testid={`revision-${item.revision.revisionNumber}`}>
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                          <div className="w-px flex-1 bg-border" />
                        </div>
                        <div className="flex-1 pb-3 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">{item.revision.previousStatus}</Badge>
                            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                            <Badge variant={
                              item.revision.newStatus === "APPROVED" ? "default" :
                              item.revision.newStatus === "REJECTED" ? "destructive" :
                              "secondary"
                            } className="text-xs">{item.revision.newStatus}</Badge>
                          </div>
                          {item.revision.description && (
                            <p className="text-xs text-muted-foreground mt-1">{item.revision.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.revisedBy ? `${item.revisedBy.firstName} ${item.revisedBy.lastName}` : "System"}
                            {" · "}
                            {formatDistanceToNow(new Date(item.revision.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          )}
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

              {/* PCO: promote to pricing review */}
              {canReview && changeOrder.status === "PCO" && (
                <Button
                  onClick={() => promoteToReviewMutation.mutate()}
                  disabled={promoteToReviewMutation.isPending}
                  data-testid="button-promote-to-review"
                >
                  <ClipboardCheck className="w-4 h-4 mr-2" />
                  {promoteToReviewMutation.isPending ? "Promoting..." : "Promote to Pricing Review"}
                </Button>
              )}

              {/* PRICING_REVIEW: approve pricing or return to PCO */}
              {canManage && changeOrder.status === "PRICING_REVIEW" && (
                <>
                  <Button
                    onClick={() => approvePricingMutation.mutate()}
                    disabled={approvePricingMutation.isPending}
                    data-testid="button-approve-pricing"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {approvePricingMutation.isPending ? "Submitting..." : "Approve Pricing → Submit to Client"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleReturnToPco}
                    disabled={returnToPcoMutation.isPending}
                    data-testid="button-return-to-pco"
                  >
                    <Flag className="w-4 h-4 mr-2" />
                    {returnToPcoMutation.isPending ? "Returning..." : "Return to PCO"}
                  </Button>
                </>
              )}

              {/* DRAFT: request approval */}
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

              {/* PENDING_APPROVAL */}
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

              {/* SUBMITTED: approve or reject */}
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

              {/* REJECTED: return to PCO for re-pricing */}
              {canManage && changeOrder.status === "REJECTED" && (
                <Button
                  variant="outline"
                  onClick={handleReturnToPco}
                  disabled={returnToPcoMutation.isPending}
                  data-testid="button-return-to-pco-from-rejected"
                >
                  <Flag className="w-4 h-4 mr-2" />
                  {returnToPcoMutation.isPending ? "Returning..." : "Return to PCO"}
                </Button>
              )}

              {/* APPROVED: void (ADMIN only) */}
              {userRole === "ADMIN" && changeOrder.status === "APPROVED" && (
                <Button
                  variant="outline"
                  onClick={() => setShowVoidDialog(true)}
                  data-testid="button-void-change-order"
                >
                  <Ban className="w-4 h-4 mr-2" />
                  Void CO
                </Button>
              )}

              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-dialog">
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {/* T&M Ticket Picker Dialog */}
      <Dialog open={showTmPicker} onOpenChange={setShowTmPicker}>
        <DialogContent className="max-w-lg" data-testid="dialog-tm-picker">
          <DialogHeader>
            <DialogTitle>Link T&M Ticket</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {tmTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No T&M tickets found for this project</p>
            ) : (
              tmTickets.map((ticket) => (
                <Card
                  key={ticket.id}
                  className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => linkTmMutation.mutate(ticket.id)}
                  data-testid={`button-select-tm-${ticket.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm font-mono">{ticket.ticketNumber}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ticket.description}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{ticket.status}</Badge>
                  </div>
                </Card>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTmPicker(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RFI Picker Dialog */}
      <Dialog open={showRfiPicker} onOpenChange={setShowRfiPicker}>
        <DialogContent className="max-w-lg" data-testid="dialog-rfi-picker">
          <DialogHeader>
            <DialogTitle>Link RFI</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {projectRfis.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No RFIs found for this project</p>
            ) : (
              projectRfis.map((rfi) => (
                <Card
                  key={rfi.id}
                  className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => linkRfiMutation.mutate(rfi.id)}
                  data-testid={`button-select-rfi-${rfi.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm font-mono">{rfi.rfiNumber}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rfi.subject}</p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">{rfi.status}</Badge>
                  </div>
                </Card>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRfiPicker(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>

    {/* Void Confirmation Dialog */}
    <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
      <DialogContent className="max-w-md" data-testid="dialog-void-change-order">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-destructive" />
            Void Change Order
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Voiding a change order is permanent. Please provide a reason for voiding this change order.
          </p>
          <div>
            <Label htmlFor="void-reason">Void Reason</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Enter reason for voiding..."
              rows={3}
              data-testid="input-void-reason"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowVoidDialog(false); setVoidReason(""); }}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleVoid}
            disabled={voidMutation.isPending || !voidReason.trim()}
            data-testid="button-confirm-void"
          >
            {voidMutation.isPending ? "Voiding..." : "Void Change Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
