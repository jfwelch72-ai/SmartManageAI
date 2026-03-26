import { useState, useEffect, useMemo, useRef } from "react";
import { format, formatDistanceToNow, isPast, differenceInDays } from "date-fns";
import { FileText, Calendar, CheckCircle, XCircle, Clock, Edit, Ruler, Plus, Trash2, ChevronDown, ChevronRight, History, ArrowRight, Shield, Flag, ClipboardCheck, Ban, Send, Link, AlertTriangle, Calculator, DollarSign, Percent, Settings, Download, Printer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChangeOrderFiles } from "./ChangeOrderFiles";
import { ChangeOrderFileUploader } from "./ChangeOrderFileUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { hasManagementAccess } from "@/lib/rbac";

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
  workTypeId?: string | null;
  workTypeCode?: string | null;
  workTypeName?: string | null;
  categoryName?: string | null;
  scopeModifierIds?: string | null;
  scopeModifierNames?: string | null;
  canonicalName?: string | null;
  scopeUnit?: string | null;
  scopeQuantity?: string | null;
  voidedAt?: string | Date | null;
  voidedById?: string | null;
  voidReason?: string | null;
  clientResponseDueDate?: string | Date | null;
  linkedTmTicketId?: string | null;
  linkedRfiId?: string | null;
  contractId?: string | null;
  projectId?: string;
}

interface ChangeOrderDialogProps {
  changeOrder: ChangeOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  projectName?: string;
  projectId?: string;
  subcontractorName?: string;
  userRole: string;
}

interface SectionRow {
  description: string;
  total: string;
  [key: string]: string;
}

interface LaborRow {
  trade: string;
  stdHours: string;
  stdRate: string;
  premHours: string;
  premRate: string;
  isOT: boolean;
  total: string;
}

interface FringeRow {
  trade: string;
  stdAmount: string;
  premAmount: string;
  total: string;
}

interface ItemRow {
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  total: string;
}

type SectionKey = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";
type SectionVisibility = Record<SectionKey, boolean>;

const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
  A: true, B: true, C: true, D: true, E: true, F: true, G: true, H: true, I: true, J: true, K: true,
};

const SECTION_LABELS: Record<SectionKey, string> = {
  A: "A/A1 Labor", B: "B/B1 Fringes", C: "C Equip Rental", D: "D Owned Equip",
  E: "E Trucking", F: "F Overhead", G: "G Material", H: "H Profit",
  I: "I Subcontractor", J: "J Sub Markup", K: "K Misc",
};

interface CostBreakdown {
  sectionA: { rows: LaborRow[] };
  sectionA1?: { rows: LaborRow[] };
  sectionB: { rows: FringeRow[] };
  sectionB1?: { rows: FringeRow[] };
  sectionC: { rows: ItemRow[] };
  sectionD: { rows: ItemRow[] };
  sectionE: { rows: ItemRow[] };
  sectionG: { rows: ItemRow[] };
  sectionI: { rows: SectionRow[] };
  sectionK: { bondInsurance: string; permits: string; lodging: string; rows: SectionRow[] };
  totals?: Record<string, number>;
  sectionVisibility?: SectionVisibility;
}

const EMPTY_LABOR_ROW: LaborRow = { trade: "", stdHours: "", stdRate: "", premHours: "", premRate: "", isOT: false, total: "0" };
const EMPTY_FRINGE_ROW: FringeRow = { trade: "", stdAmount: "", premAmount: "", total: "0" };
const EMPTY_ITEM_ROW: ItemRow = { description: "", quantity: "", unit: "", rate: "", total: "0" };
const EMPTY_SECTION_ROW: SectionRow = { description: "", total: "0" };

function emptyBreakdown(): CostBreakdown {
  return {
    sectionA: { rows: [{ ...EMPTY_LABOR_ROW }] },
    sectionB: { rows: [{ ...EMPTY_FRINGE_ROW }] },
    sectionC: { rows: [{ ...EMPTY_ITEM_ROW }] },
    sectionD: { rows: [{ ...EMPTY_ITEM_ROW }] },
    sectionE: { rows: [{ ...EMPTY_ITEM_ROW }] },
    sectionG: { rows: [{ ...EMPTY_ITEM_ROW }] },
    sectionI: { rows: [{ ...EMPTY_SECTION_ROW }] },
    sectionK: { bondInsurance: "0", permits: "0", lodging: "0", rows: [] },
  };
}

const p = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  projectName,
  projectId: propProjectId,
  subcontractorName,
  userRole,
}: ChangeOrderDialogProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedNumber, setEditedNumber] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [editedAmount, setEditedAmount] = useState("");
  const [editedCostCodeId, setEditedCostCodeId] = useState<string>("");
  const [lineItemsOpen, setLineItemsOpen] = useState(true);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [approvalChainOpen, setApprovalChainOpen] = useState(false);
  const [newApprovalSteps, setNewApprovalSteps] = useState<Array<{ approverRole: string }>>([{ approverRole: "MANAGER" }]);
  const [showTmPicker, setShowTmPicker] = useState(false);
  const [showRfiPicker, setShowRfiPicker] = useState(false);
  const [showContractPicker, setShowContractPicker] = useState(false);

  const [breakdown, setBreakdown] = useState<CostBreakdown>(emptyBreakdown());
  const [overheadPct, setOverheadPct] = useState("10");
  const [profitPct, setProfitPct] = useState("5");
  const [subMarkupPct, setSubMarkupPct] = useState("5");
  const [useStructuredForm, setUseStructuredForm] = useState(true);
  const [sectionVisibility, setSectionVisibility] = useState<SectionVisibility>({ ...DEFAULT_SECTION_VISIBILITY });
  const [showSectionSettings, setShowSectionSettings] = useState(false);

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);
  const canReview = ["ADMIN", "MANAGER", "PROJECT_ENGINEER"].includes(userRole);
  const isAdmin = userRole === "ADMIN";
  const canEdit = canManage && (changeOrder?.status === "DRAFT" || changeOrder?.status === "PCO");
  const nonTerminalStatuses = ["DRAFT", "PCO", "PENDING_APPROVAL", "SUBMITTED"];
  const canLinkItems = canManage && nonTerminalStatuses.includes(changeOrder?.status || "");

  const { data: lineItemsData } = useQuery<any>({
    queryKey: ["/api/change-orders", changeOrder?.id, "line-items"],
    enabled: !!changeOrder?.id && open,
  });

  const { data: revisions } = useQuery<Array<{
    revision: { id: string; revisionNumber: number; previousStatus: string; newStatus: string; amount: string | null; description: string | null; changedFields: string | null; createdAt: string; };
    revisedBy: { id: string; firstName: string; lastName: string; email: string; } | null;
  }>>({
    queryKey: ["/api/change-orders", changeOrder?.id, "revisions"],
    enabled: !!changeOrder?.id && open,
  });

  const { data: costCodes = [] } = useQuery<Array<{ id: number; code: string; description: string; division: string; isActive: boolean }>>({
    queryKey: ["/api/cost-codes/org"],
    enabled: open && isEditing,
  });

  const { data: orgDefaults } = useQuery<{ defaultOverheadPercent: number }>({
    queryKey: ["/api/overhead/summary"],
    enabled: open,
  });

  const { data: approvals } = useQuery<Array<{
    approval: { id: string; approverRole: string; status: string; stepOrder: number; comments: string | null; decidedAt: string | null; createdAt: string; };
    approver: { id: string; firstName: string; lastName: string; email: string; } | null;
  }>>({
    queryKey: ["/api/change-orders", changeOrder?.id, "approvals"],
    enabled: !!changeOrder?.id && open,
  });

  const { data: tmTickets = [] } = useQuery<Array<{ id: string; ticketNumber: string; description: string; status: string; totalBillableAmount?: string; }>>({
    queryKey: ["/api/projects", changeOrder?.projectId, "tm-tickets"],
    enabled: (showTmPicker || !!changeOrder?.linkedTmTicketId) && !!changeOrder?.projectId,
  });

  const { data: projectRfis = [] } = useQuery<Array<{ id: string; rfiNumber: string; subject: string; status: string; }>>({
    queryKey: ["/api/rfi", { projectId: changeOrder?.projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/rfi?projectId=${encodeURIComponent(changeOrder?.projectId || "")}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch RFIs");
      return res.json();
    },
    enabled: (showRfiPicker || !!changeOrder?.linkedRfiId) && !!changeOrder?.projectId,
  });

  const { data: projectContracts = [] } = useQuery<Array<{ id: string; contractNumber: string; status: string; contractType: string; }>>({
    queryKey: ["/api/contracts/by-project", changeOrder?.projectId],
    enabled: (showContractPicker || !!changeOrder?.contractId) && !!changeOrder?.projectId,
  });

  const orgDefaultsAppliedRef = useRef(false);

  useEffect(() => {
    if (changeOrder) {
      setEditedNumber(changeOrder.changeOrderNumber);
      setEditedDescription(changeOrder.description);
      setEditedAmount(changeOrder.amount);
      setEditedCostCodeId(changeOrder.costCodeId ? String(changeOrder.costCodeId) : "");
      setIsEditing(false);
      setNewApprovalSteps([{ approverRole: "MANAGER" }]);
      orgDefaultsAppliedRef.current = false;
    }
  }, [changeOrder]);

  useEffect(() => {
    if (lineItemsData) {
      const orgOH = orgDefaults?.defaultOverheadPercent ? String(orgDefaults.defaultOverheadPercent) : "10";
      if (lineItemsData.costBreakdown) {
        setBreakdown(lineItemsData.costBreakdown);
        setOverheadPct(lineItemsData.overheadPercent || orgOH);
        setProfitPct(lineItemsData.profitPercent || "5");
        setSubMarkupPct(lineItemsData.subcontractorMarkupPercent || "5");
        setSectionVisibility(lineItemsData.costBreakdown.sectionVisibility || { ...DEFAULT_SECTION_VISIBILITY });
        setUseStructuredForm(true);
      } else {
        const hasLegacyData = (lineItemsData.laborEntries?.length > 0 || lineItemsData.equipmentEntries?.length > 0 || lineItemsData.materialEntries?.length > 0);
        if (hasLegacyData) {
          setUseStructuredForm(false);
        } else {
          setUseStructuredForm(true);
          setBreakdown(emptyBreakdown());
        }
        setOverheadPct(lineItemsData.overheadPercent || orgOH);
        setProfitPct(lineItemsData.profitPercent || "5");
        setSubMarkupPct(lineItemsData.subcontractorMarkupPercent || "5");
      }
    }
  }, [lineItemsData, orgDefaults]);

  useEffect(() => {
    if (orgDefaults?.defaultOverheadPercent && !orgDefaultsAppliedRef.current) {
      const hasExplicitOverhead = lineItemsData?.overheadPercent && lineItemsData.overheadPercent !== "10";
      if (!hasExplicitOverhead) {
        setOverheadPct(String(orgDefaults.defaultOverheadPercent));
        orgDefaultsAppliedRef.current = true;
      }
    }
  }, [orgDefaults, lineItemsData]);

  useEffect(() => {
    setSectionVisibility(prev => {
      const next = { ...prev };
      const overheadInputsAllOff = !prev.A && !prev.B && !prev.C && !prev.D && !prev.E;
      if (overheadInputsAllOff && prev.F) next.F = false;
      const profitInputsAllOff = overheadInputsAllOff && !prev.G;
      if (profitInputsAllOff && prev.H) next.H = false;
      if (!prev.I && prev.J) next.J = false;
      return next;
    });
  }, [sectionVisibility.A, sectionVisibility.B, sectionVisibility.C, sectionVisibility.D, sectionVisibility.E, sectionVisibility.G, sectionVisibility.I]);

  const toggleSection = (key: SectionKey, enabled: boolean) => {
    setSectionVisibility(prev => ({ ...prev, [key]: enabled }));
  };

  const isSectionAutoDisabled = (key: SectionKey): boolean => {
    if (key === "F") return !sectionVisibility.A && !sectionVisibility.B && !sectionVisibility.C && !sectionVisibility.D && !sectionVisibility.E;
    if (key === "H") {
      const overheadInputsAllOff = !sectionVisibility.A && !sectionVisibility.B && !sectionVisibility.C && !sectionVisibility.D && !sectionVisibility.E;
      return overheadInputsAllOff && !sectionVisibility.G;
    }
    if (key === "J") return !sectionVisibility.I;
    return false;
  };

  const totals = useMemo(() => {
    const sv = sectionVisibility;
    const laborRows = breakdown.sectionA.rows;
    const A = sv.A ? laborRows.reduce((s, r) => s + p(r.stdHours) * p(r.stdRate), 0) : 0;
    const A1 = sv.A ? laborRows.reduce((s, r) => s + p(r.premHours) * p(r.premRate), 0) : 0;
    const fringeRows = breakdown.sectionB.rows;
    const B = sv.B ? fringeRows.reduce((s, r) => s + p(r.stdAmount), 0) : 0;
    const B1 = sv.B ? fringeRows.reduce((s, r) => s + p(r.premAmount), 0) : 0;
    const C = sv.C ? breakdown.sectionC.rows.reduce((s, r) => s + p(r.quantity) * p(r.rate), 0) : 0;
    const D = sv.D ? breakdown.sectionD.rows.reduce((s, r) => s + p(r.quantity) * p(r.rate), 0) : 0;
    const E = sv.E ? breakdown.sectionE.rows.reduce((s, r) => s + p(r.quantity) * p(r.rate), 0) : 0;
    const subtotalForOH = A + A1 + B + B1 + C + D + E;
    const F = sv.F ? subtotalForOH * (p(overheadPct) / 100) : 0;
    const G = sv.G ? breakdown.sectionG.rows.reduce((s, r) => s + p(r.quantity) * p(r.rate), 0) : 0;
    const subtotalForProfit = subtotalForOH + F + G;
    const H = sv.H ? subtotalForProfit * (p(profitPct) / 100) : 0;
    const I = sv.I ? breakdown.sectionI.rows.reduce((s, r) => s + p(r.total), 0) : 0;
    const J = sv.J ? I * (p(subMarkupPct) / 100) : 0;
    const kRows = breakdown.sectionK.rows?.reduce((s: number, r: any) => s + p(r.total), 0) || 0;
    const K = sv.K ? p(breakdown.sectionK.bondInsurance) + p(breakdown.sectionK.permits) + p(breakdown.sectionK.lodging) + kRows : 0;
    const grand = subtotalForProfit + H + I + J + K;
    return { A, A1, B, B1, C, D, E, F, G, H, I, J, K, grand, subtotalForOH, subtotalForProfit };
  }, [breakdown, overheadPct, profitPct, subMarkupPct, sectionVisibility]);

  const updateBreakdownSection = <T extends keyof CostBreakdown>(section: T, updater: (prev: CostBreakdown[T]) => CostBreakdown[T]) => {
    setBreakdown(prev => ({ ...prev, [section]: updater(prev[section]) }));
  };

  const saveLineItemsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", `/api/change-orders/${changeOrder?.id}/line-items`, {
        costBreakdown: { ...breakdown, sectionVisibility },
        overheadPercent: overheadPct,
        profitPercent: profitPct,
        subcontractorMarkupPercent: subMarkupPct,
      });
    },
    onSuccess: async (response: any) => {
      let data: any;
      if (response && typeof response.json === 'function') {
        data = await response.json();
      } else {
        data = response;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "line-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      if (data?.total !== undefined) {
        setEditedAmount(String(data.total));
      }
      toast({ title: "Success", description: "Cost breakdown saved and total updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save cost breakdown", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { changeOrderNumber: string; description: string; amount: string; costCodeId?: number | null }) => {
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
    mutationFn: async () => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/request-approval`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order sent for approval" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to request approval", variant: "destructive" }); },
  });

  const submitMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "approvals"] });
      toast({ title: "Success", description: "Change order submitted to client" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to submit", variant: "destructive" }); },
  });

  const approveMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order approved" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to approve", variant: "destructive" }); },
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
      return apiRequest("POST", `/api/change-orders/${changeOrder?.id}/return-to-draft`, { reason: reason || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order returned to draft" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" }); },
  });

  const promoteToReviewMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/promote-to-review`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order promoted to pricing review" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to promote to pricing review", variant: "destructive" }); },
  });

  const approvePricingMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/approve-pricing`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Pricing approved, change order submitted to client" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to approve pricing", variant: "destructive" }); },
  });

  const returnToPcoMutation = useMutation({
    mutationFn: async (reason?: string) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/return-to-pco`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order returned to PCO" });
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to return to PCO", variant: "destructive" }); },
  });

  const voidMutation = useMutation({
    mutationFn: async (reason: string) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/void`, { voidReason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Change order voided" });
      setShowVoidDialog(false);
      setVoidReason("");
      onOpenChange(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to void change order", variant: "destructive" }); },
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

  const pdfAllowedStatuses = ["SUBMITTED", "APPROVED", "VOIDED", "REJECTED", "PRICING_REVIEW"];
  const canExportPdf = changeOrder && pdfAllowedStatuses.includes(changeOrder.status);

  const handleDownloadPdf = async () => {
    if (!changeOrder) return;
    try {
      const res = await fetch(`/api/change-orders/${changeOrder.id}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to download PDF");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ChangeOrder_${changeOrder.changeOrderNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "Failed to download PDF", variant: "destructive" });
    }
  };

  const handlePrint = async () => {
    if (!changeOrder) return;
    try {
      const res = await fetch(`/api/change-orders/${changeOrder.id}/pdf`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to generate PDF for printing");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank');
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print();
        });
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast({ title: "Error", description: "Failed to prepare print view", variant: "destructive" });
    }
  };

  const setupApprovalChainMutation = useMutation({
    mutationFn: async (steps: Array<{ approverRole: string }>) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/setup-approval-chain`, { steps }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/change-orders", changeOrder?.id, "approvals"] });
      toast({ title: "Success", description: "Approval chain configured" });
      setApprovalChainOpen(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to configure approval chain", variant: "destructive" }); },
  });

  const linkTmMutation = useMutation({
    mutationFn: async (tmTicketId: string) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/link-tm`, { tmTicketId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "T&M ticket linked" });
      setShowTmPicker(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to link T&M ticket", variant: "destructive" }); },
  });

  const linkRfiMutation = useMutation({
    mutationFn: async (rfiId: string) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/link-rfi`, { rfiId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "RFI linked" });
      setShowRfiPicker(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to link RFI", variant: "destructive" }); },
  });

  const linkContractMutation = useMutation({
    mutationFn: async (contractId: string) => apiRequest("POST", `/api/change-orders/${changeOrder?.id}/link-contract`, { contractId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      toast({ title: "Success", description: "Contract linked" });
      setShowContractPicker(false);
    },
    onError: () => { toast({ title: "Error", description: "Failed to link contract", variant: "destructive" }); },
  });

  const handleSave = () => {
    if (!editedNumber || !editedDescription || !editedAmount) {
      toast({ title: "Validation Error", description: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      changeOrderNumber: editedNumber,
      description: editedDescription,
      amount: editedAmount,
      costCodeId: editedCostCodeId && editedCostCodeId !== "none" ? parseInt(editedCostCodeId, 10) : null,
    });
  };

  if (!changeOrder) return null;

  const isResponseOverdue = changeOrder.clientResponseDueDate && changeOrder.status === "SUBMITTED"
    && isPast(new Date(changeOrder.clientResponseDueDate));

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PCO":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300" data-testid="status-badge-pco"><Flag className="w-3 h-3 mr-1" />PCO</Badge>;
      case "PRICING_REVIEW":
        return <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300" data-testid="status-badge-pricing-review"><ClipboardCheck className="w-3 h-3 mr-1" />Pricing Review</Badge>;
      case "VOIDED":
        return <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-900 dark:text-gray-400" data-testid="status-badge-voided"><Ban className="w-3 h-3 mr-1" />Voided</Badge>;
      case "APPROVED":
        return <Badge variant="default">{status}</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">{status}</Badge>;
      default:
        return <Badge variant="secondary">{status.replace(/_/g, " ")}</Badge>;
    }
  };

  const SectionHeader = ({ label, sectionKey, total }: { label: string; sectionKey: string; total: number }) => (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md" data-testid={`section-header-${sectionKey}`}>
      <span className="text-sm font-semibold">{label}</span>
      <span className="font-mono text-sm font-bold">${fmt(total)}</span>
    </div>
  );

  const renderCombinedLaborSection = () => {
    const rows = breakdown.sectionA.rows;
    return (
      <div className="space-y-2" data-testid="section-labor">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Sections A / A1 — Labor Summary</h4>
          <div className="flex gap-4 text-xs font-mono">
            <span>Std (A): ${fmt(totals.A)}</span>
            <span>Prem (A1): ${fmt(totals.A1)}</span>
          </div>
        </div>
        <div className="space-y-1">
          {rows.length > 0 && (
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px_40px] gap-1 px-2 text-xs text-muted-foreground font-medium">
              <div>Trade Classification</div>
              <div>STD Hours</div>
              <div>STD Rate</div>
              <div>Prem Hours</div>
              <div>Prem Rate</div>
              <div>OT/DT</div>
              <div></div>
            </div>
          )}
          {rows.map((row, idx) => {
            const stdTotal = p(row.stdHours) * p(row.stdRate);
            const premTotal = p(row.premHours) * p(row.premRate);
            return (
              <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px_40px] gap-1 px-2 items-center" data-testid={`row-labor-${idx}`}>
                <div>
                  <Input placeholder="Trade" value={row.trade} onChange={(e) => {
                    updateBreakdownSection("sectionA", (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], trade: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-labor-trade-${idx}`} />
                </div>
                <div>
                  <Input type="number" step="0.5" placeholder="0" value={row.stdHours} onChange={(e) => {
                    updateBreakdownSection("sectionA", (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], stdHours: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-labor-stdHours-${idx}`} />
                </div>
                <div>
                  <Input type="number" step="0.01" placeholder="0.00" value={row.stdRate} onChange={(e) => {
                    updateBreakdownSection("sectionA", (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], stdRate: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-labor-stdRate-${idx}`} />
                </div>
                <div>
                  <Input type="number" step="0.5" placeholder="0" value={row.premHours} onChange={(e) => {
                    updateBreakdownSection("sectionA", (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], premHours: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-labor-premHours-${idx}`} />
                </div>
                <div>
                  <Input type="number" step="0.01" placeholder="0.00" value={row.premRate} onChange={(e) => {
                    updateBreakdownSection("sectionA", (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], premRate: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-labor-premRate-${idx}`} />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={row.isOT} onChange={(e) => {
                      updateBreakdownSection("sectionA", (s: any) => {
                        const r = [...s.rows]; r[idx] = { ...r[idx], isOT: e.target.checked }; return { ...s, rows: r };
                      });
                    }} disabled={!canEdit} className="h-3 w-3" data-testid={`checkbox-labor-ot-${idx}`} />
                    OT/DT
                  </label>
                </div>
                <div>
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      updateBreakdownSection("sectionA", (s: any) => ({ ...s, rows: s.rows.filter((_: any, i: number) => i !== idx) }));
                    }} data-testid={`button-remove-labor-${idx}`}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {rows.length > 0 && (
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_80px_40px] gap-1 px-2 text-xs font-mono border-t pt-1">
              <div className="text-right font-semibold">Row Totals:</div>
              <div className="col-span-2 text-right">Std: ${fmt(totals.A)}</div>
              <div className="col-span-2 text-right">Prem: ${fmt(totals.A1)}</div>
              <div></div>
              <div></div>
            </div>
          )}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
            updateBreakdownSection("sectionA", (s: any) => ({ ...s, rows: [...s.rows, { ...EMPTY_LABOR_ROW }] }));
          }} data-testid="button-add-labor">
            <Plus className="w-3 h-3 mr-1" /> Add Trade Row
          </Button>
        )}
      </div>
    );
  };

  const renderCombinedFringeSection = () => {
    const rows = breakdown.sectionB.rows;
    return (
      <div className="space-y-2" data-testid="section-fringe">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Sections B / B1 — Fringes &amp; Benefits</h4>
          <div className="flex gap-4 text-xs font-mono">
            <span>Std (B): ${fmt(totals.B)}</span>
            <span>Prem (B1): ${fmt(totals.B1)}</span>
          </div>
        </div>
        <div className="space-y-1">
          {rows.length > 0 && (
            <div className="grid grid-cols-[3fr_2fr_2fr_1fr] gap-1 px-2 text-xs text-muted-foreground font-medium">
              <div>Trade Classification</div>
              <div>Std Fringe Amount</div>
              <div>Prem Fringe Amount</div>
              <div></div>
            </div>
          )}
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-[3fr_2fr_2fr_1fr] gap-1 px-2 items-center" data-testid={`row-fringe-${idx}`}>
              <div>
                <Input placeholder="Trade" value={row.trade} onChange={(e) => {
                  updateBreakdownSection("sectionB", (s: any) => {
                    const r = [...s.rows]; r[idx] = { ...r[idx], trade: e.target.value }; return { ...s, rows: r };
                  });
                }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-fringe-trade-${idx}`} />
              </div>
              <div>
                <Input type="number" step="0.01" placeholder="0.00" value={row.stdAmount} onChange={(e) => {
                  updateBreakdownSection("sectionB", (s: any) => {
                    const r = [...s.rows]; r[idx] = { ...r[idx], stdAmount: e.target.value }; return { ...s, rows: r };
                  });
                }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-fringe-stdAmount-${idx}`} />
              </div>
              <div>
                <Input type="number" step="0.01" placeholder="0.00" value={row.premAmount} onChange={(e) => {
                  updateBreakdownSection("sectionB", (s: any) => {
                    const r = [...s.rows]; r[idx] = { ...r[idx], premAmount: e.target.value }; return { ...s, rows: r };
                  });
                }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-fringe-premAmount-${idx}`} />
              </div>
              <div>
                {canEdit && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                    updateBreakdownSection("sectionB", (s: any) => ({ ...s, rows: s.rows.filter((_: any, i: number) => i !== idx) }));
                  }} data-testid={`button-remove-fringe-${idx}`}>
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="grid grid-cols-[3fr_2fr_2fr_1fr] gap-1 px-2 text-xs font-mono border-t pt-1">
              <div className="text-right font-semibold">Totals:</div>
              <div>${fmt(totals.B)}</div>
              <div>${fmt(totals.B1)}</div>
              <div></div>
            </div>
          )}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
            updateBreakdownSection("sectionB", (s: any) => ({ ...s, rows: [...s.rows, { ...EMPTY_FRINGE_ROW }] }));
          }} data-testid="button-add-fringe">
            <Plus className="w-3 h-3 mr-1" /> Add Trade Row
          </Button>
        )}
      </div>
    );
  };

  const renderItemSection = (sectionKey: "sectionC" | "sectionD" | "sectionE" | "sectionG", label: string, total: number) => {
    const rows = breakdown[sectionKey]?.rows || [];
    return (
      <div className="space-y-2" data-testid={`section-${sectionKey}`}>
        <SectionHeader label={label} sectionKey={sectionKey} total={total} />
        <div className="space-y-1">
          {rows.length > 0 && (
            <div className="grid grid-cols-12 gap-1 px-2 text-xs text-muted-foreground font-medium">
              <div className="col-span-4">Description</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-1">Unit</div>
              <div className="col-span-2">Rate</div>
              <div className="col-span-2">Total</div>
              <div className="col-span-1"></div>
            </div>
          )}
          {rows.map((row, idx) => {
            const rowTotal = p(row.quantity) * p(row.rate);
            return (
              <div key={idx} className="grid grid-cols-12 gap-1 px-2 items-center" data-testid={`row-${sectionKey}-${idx}`}>
                <div className="col-span-4">
                  <Input placeholder="Description" value={row.description} onChange={(e) => {
                    updateBreakdownSection(sectionKey, (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], description: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-${sectionKey}-desc-${idx}`} />
                </div>
                <div className="col-span-2">
                  <Input type="number" step="0.01" placeholder="0" value={row.quantity} onChange={(e) => {
                    updateBreakdownSection(sectionKey, (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], quantity: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-${sectionKey}-qty-${idx}`} />
                </div>
                <div className="col-span-1">
                  <Input placeholder="EA" value={row.unit} onChange={(e) => {
                    updateBreakdownSection(sectionKey, (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], unit: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-${sectionKey}-unit-${idx}`} />
                </div>
                <div className="col-span-2">
                  <Input type="number" step="0.01" placeholder="0.00" value={row.rate} onChange={(e) => {
                    updateBreakdownSection(sectionKey, (s: any) => {
                      const r = [...s.rows]; r[idx] = { ...r[idx], rate: e.target.value }; return { ...s, rows: r };
                    });
                  }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-${sectionKey}-rate-${idx}`} />
                </div>
                <div className="col-span-2 font-mono text-xs flex items-center h-8">${fmt(rowTotal)}</div>
                <div className="col-span-1">
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      updateBreakdownSection(sectionKey, (s: any) => ({ ...s, rows: s.rows.filter((_: any, i: number) => i !== idx) }));
                    }} data-testid={`button-remove-${sectionKey}-${idx}`}>
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
            updateBreakdownSection(sectionKey, (s: any) => ({ ...s, rows: [...s.rows, { ...EMPTY_ITEM_ROW }] }));
          }} data-testid={`button-add-${sectionKey}`}>
            <Plus className="w-3 h-3 mr-1" /> Add Row
          </Button>
        )}
      </div>
    );
  };

  const renderSubcontractorSection = () => {
    const rows = breakdown.sectionI?.rows || [];
    return (
      <div className="space-y-2" data-testid="section-sectionI">
        <SectionHeader label="Section I — Subcontractor" sectionKey="sectionI" total={totals.I} />
        <div className="space-y-1">
          {rows.length > 0 && (
            <div className="grid grid-cols-12 gap-1 px-2 text-xs text-muted-foreground font-medium">
              <div className="col-span-8">Description</div>
              <div className="col-span-3">Amount</div>
              <div className="col-span-1"></div>
            </div>
          )}
          {rows.map((row, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-1 px-2 items-center" data-testid={`row-sectionI-${idx}`}>
              <div className="col-span-8">
                <Input placeholder="Subcontractor description" value={row.description} onChange={(e) => {
                  updateBreakdownSection("sectionI", (s: any) => {
                    const r = [...s.rows]; r[idx] = { ...r[idx], description: e.target.value }; return { ...s, rows: r };
                  });
                }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-sectionI-desc-${idx}`} />
              </div>
              <div className="col-span-3">
                <Input type="number" step="0.01" placeholder="0.00" value={row.total} onChange={(e) => {
                  updateBreakdownSection("sectionI", (s: any) => {
                    const r = [...s.rows]; r[idx] = { ...r[idx], total: e.target.value }; return { ...s, rows: r };
                  });
                }} disabled={!canEdit} className="h-8 text-xs" data-testid={`input-sectionI-total-${idx}`} />
              </div>
              <div className="col-span-1">
                {canEdit && (
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                    updateBreakdownSection("sectionI", (s: any) => ({ ...s, rows: s.rows.filter((_: any, i: number) => i !== idx) }));
                  }} data-testid={`button-remove-sectionI-${idx}`}>
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
            updateBreakdownSection("sectionI", (s: any) => ({ ...s, rows: [...s.rows, { ...EMPTY_SECTION_ROW }] }));
          }} data-testid="button-add-sectionI">
            <Plus className="w-3 h-3 mr-1" /> Add Row
          </Button>
        )}
      </div>
    );
  };

  const renderMiscSection = () => (
    <div className="space-y-2" data-testid="section-sectionK">
      <SectionHeader label="Section K — Miscellaneous" sectionKey="sectionK" total={totals.K} />
      <div className="space-y-2 px-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Bond / Insurance</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={breakdown.sectionK.bondInsurance} onChange={(e) => {
              setBreakdown(prev => ({ ...prev, sectionK: { ...prev.sectionK, bondInsurance: e.target.value } }));
            }} disabled={!canEdit} className="h-8 text-xs" data-testid="input-sectionK-bond" />
          </div>
          <div>
            <Label className="text-xs">Permits / Licenses / Inspection Fees</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={breakdown.sectionK.permits} onChange={(e) => {
              setBreakdown(prev => ({ ...prev, sectionK: { ...prev.sectionK, permits: e.target.value } }));
            }} disabled={!canEdit} className="h-8 text-xs" data-testid="input-sectionK-permits" />
          </div>
        </div>
        <div>
          <Label className="text-xs">Overnight Lodging / Travel</Label>
          <Input type="number" step="0.01" placeholder="0.00" value={breakdown.sectionK.lodging} onChange={(e) => {
            setBreakdown(prev => ({ ...prev, sectionK: { ...prev.sectionK, lodging: e.target.value } }));
          }} disabled={!canEdit} className="h-8 text-xs" data-testid="input-sectionK-lodging" />
        </div>
      </div>
    </div>
  );

  const MARKUP_PRESETS: Record<string, number[]> = {
    sectionF: [5, 10, 15, 20],
    sectionH: [5, 8, 10, 15],
    sectionJ: [5, 10, 15],
  };

  const renderCalculatedSection = (label: string, sectionKey: string, total: number, pctLabel: string, pctValue: string, onPctChange: (v: string) => void, formula: string, baseAmount?: number) => (
    <div className="space-y-2" data-testid={`section-${sectionKey}`}>
      <div className="flex flex-col gap-1 py-2 px-3 bg-muted/50 rounded-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-muted-foreground">({formula})</span>
          </div>
          <span className="font-mono text-sm font-bold">${fmt(total)}</span>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Apply {pctLabel}:</span>
            {MARKUP_PRESETS[sectionKey]?.map(preset => (
              <Button
                key={preset}
                type="button"
                size="sm"
                variant={pctValue === String(preset) ? "default" : "ghost"}
                className="h-6 px-1.5 text-xs"
                onClick={() => onPctChange(String(preset))}
                data-testid={`button-preset-${sectionKey}-${preset}`}
              >
                {preset}%
              </Button>
            ))}
            <Input type="number" step="0.1" value={pctValue} onChange={(e) => onPctChange(e.target.value)} className="h-7 w-16 text-xs text-right" data-testid={`input-${sectionKey}-pct`} />
            <Percent className="w-3 h-3 text-muted-foreground" />
            {baseAmount !== undefined && baseAmount > 0 && (
              <span className="text-xs text-muted-foreground ml-1">on ${fmt(baseAmount)}</span>
            )}
          </div>
        )}
        {!canEdit && <span className="text-xs text-muted-foreground">{pctValue}%</span>}
      </div>
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-view-change-order">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Change Order Detail Form
            </DialogTitle>
            <div className="flex items-center gap-2">
              {isResponseOverdue && (
                <Badge variant="destructive" className="flex items-center gap-1" data-testid="badge-response-overdue">
                  <AlertTriangle className="w-3 h-3" />Response Overdue
                </Badge>
              )}
              {canExportPdf && (
                <Button variant="outline" size="sm" onClick={handleDownloadPdf} data-testid="button-download-co-pdf">
                  <Download className="w-3.5 h-3.5 mr-1" />PDF
                </Button>
              )}
              {canExportPdf && (
                <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print-co">
                  <Printer className="w-3.5 h-3.5 mr-1" />Print
                </Button>
              )}
              {getStatusBadge(changeOrder.status)}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {changeOrder.voidReason && (
            <div className="p-4 bg-muted border rounded-md space-y-2" data-testid="panel-voided">
              <div className="flex items-center gap-2">
                <Ban className="w-4 h-4 text-destructive" />
                <span className="text-sm font-medium text-destructive">Voided</span>
              </div>
              <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {changeOrder.voidReason}</p>
              {changeOrder.voidedAt && <p className="text-sm text-muted-foreground">{format(new Date(changeOrder.voidedAt), "MMM d, yyyy 'at' h:mm a")}</p>}
              {revisions && (() => {
                const voidRevision = revisions.find(r => r.revision.newStatus === "VOIDED");
                if (voidRevision?.revisedBy) return <p className="text-sm text-muted-foreground" data-testid="text-voided-by">by {voidRevision.revisedBy.firstName} {voidRevision.revisedBy.lastName}</p>;
                return null;
              })()}
            </div>
          )}

          {changeOrder.status === "SUBMITTED" && changeOrder.clientResponseDueDate && (
            <div className={`p-3 rounded-md border ${isResponseOverdue ? "bg-destructive/10 border-destructive/30" : "bg-muted/40"}`} data-testid="panel-submitted-info">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Client Response Due</span>
                {isResponseOverdue && <Badge variant="destructive" className="text-xs">Overdue</Badge>}
              </div>
              <p className="text-sm mt-1">
                {format(new Date(changeOrder.clientResponseDueDate), "MMMM d, yyyy")}
                {" "}<span className="text-muted-foreground">({formatDistanceToNow(new Date(changeOrder.clientResponseDueDate), { addSuffix: true })})</span>
              </p>
            </div>
          )}

          {revisions && revisions.length > 0 && (
            <div className="p-3 bg-muted/20 rounded-md border" data-testid="panel-status-timeline">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Status Timeline</span>
                <Badge variant="outline" className="text-xs ml-auto">
                  {(() => {
                    const sorted = [...revisions].sort((a, b) => b.revision.revisionNumber - a.revision.revisionNumber);
                    const lastChange = sorted[0]?.revision.createdAt;
                    return lastChange ? `${differenceInDays(new Date(), new Date(lastChange))}d in current status` : "—";
                  })()}
                </Badge>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {(() => {
                  const sortedRevs = [...revisions].sort((a, b) => a.revision.revisionNumber - b.revision.revisionNumber);
                  const steps = [
                    { status: "PCO", date: changeOrder.createdAt },
                    ...sortedRevs.map(r => ({ status: r.revision.newStatus, date: r.revision.createdAt })),
                  ];
                  return steps.map((step, idx) => {
                    const nextDate = idx < steps.length - 1 ? new Date(steps[idx + 1].date) : new Date();
                    const days = differenceInDays(nextDate, new Date(step.date));
                    return (
                      <div key={idx} className="flex items-center gap-1">
                        {idx > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs">
                          <span className="font-medium">{step.status.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground">{format(new Date(step.date), "M/d")}</span>
                          <span className={`text-muted-foreground ${days > 7 ? "text-amber-600 font-semibold" : ""}`}>({days}d)</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          <Card className="p-4 bg-muted/20 border" data-testid="card-header-info">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Project Name</Label>
                <p className="font-medium" data-testid="text-project-name">{projectName || "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Contract No.</Label>
                <p className="font-mono" data-testid="text-contract-no">{projectCode}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Bulletin / CO No.</Label>
                {isEditing ? (
                  <Input value={editedNumber} onChange={(e) => setEditedNumber(e.target.value)} className="h-7 text-xs" data-testid="input-edit-co-number" />
                ) : (
                  <p className="font-mono" data-testid="text-co-number">{changeOrder.changeOrderNumber}</p>
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Date</Label>
                <p data-testid="text-co-date">{format(new Date(changeOrder.createdAt), "MMM d, yyyy")}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Subcontractor</Label>
                <p data-testid="text-subcontractor">{subcontractorName || "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Contractor Tracking #</Label>
                <p className="font-mono" data-testid="text-tracking-number">{changeOrder.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Status</Label>
                <div>{getStatusBadge(changeOrder.status)}</div>
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Description</Label>
              {isEditing ? (
                <Textarea value={editedDescription} onChange={(e) => setEditedDescription(e.target.value)} rows={2} className="text-xs mt-1" data-testid="input-edit-co-description" />
              ) : (
                <p className="text-sm mt-1" data-testid="text-co-description">{changeOrder.description}</p>
              )}
            </div>
            {isEditing && (
              <div className="mt-3">
                <Label className="text-xs text-muted-foreground">Cost Code</Label>
                <Select value={editedCostCodeId || "none"} onValueChange={setEditedCostCodeId}>
                  <SelectTrigger className="h-8 text-xs mt-1" data-testid="select-edit-cost-code">
                    <SelectValue placeholder="Select cost code (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Cost Code</SelectItem>
                    {costCodes.filter(cc => cc.isActive).map(cc => (
                      <SelectItem key={cc.id} value={String(cc.id)}>{cc.code} — {cc.description}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>

          {changeOrder.canonicalName && (
            <div className="p-3 bg-muted/30 rounded-md">
              <div className="flex items-center gap-2 mb-2">
                <Ruler className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Scope of Work</span>
              </div>
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">Work Type:</span> {changeOrder.canonicalName}</p>
                {changeOrder.categoryName && <p><span className="text-muted-foreground">Category:</span> {changeOrder.categoryName}</p>}
                {changeOrder.scopeQuantity && changeOrder.scopeUnit && <p><span className="text-muted-foreground">Quantity:</span> {changeOrder.scopeQuantity} {changeOrder.scopeUnit}</p>}
              </div>
            </div>
          )}

          {changeOrder.linkedTmTicketId && (
            <div className="p-3 bg-muted/30 rounded-md" data-testid="card-linked-tm">
              <div className="flex items-center gap-2"><Link className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Linked T&M Ticket</span></div>
              <p className="text-sm mt-1 text-muted-foreground" data-testid="text-linked-tm-name">{(() => { const t = tmTickets.find(t => t.id === changeOrder.linkedTmTicketId); return t ? `${t.ticketNumber} – ${t.description}` : changeOrder.linkedTmTicketId; })()}</p>
            </div>
          )}
          {changeOrder.linkedRfiId && (
            <div className="p-3 bg-muted/30 rounded-md" data-testid="card-linked-rfi">
              <div className="flex items-center gap-2"><Link className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Linked RFI</span></div>
              <p className="text-sm mt-1 text-muted-foreground" data-testid="text-linked-rfi-name">{(() => { const r = projectRfis.find(r => r.id === changeOrder.linkedRfiId); return r ? `${r.rfiNumber} – ${r.subject}` : changeOrder.linkedRfiId; })()}</p>
            </div>
          )}
          {changeOrder.contractId && (
            <div className="p-3 bg-muted/30 rounded-md" data-testid="card-linked-contract">
              <div className="flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Linked Contract</span></div>
              <p className="text-sm mt-1 text-muted-foreground" data-testid="text-linked-contract-name">{(() => { const c = projectContracts.find(c => c.id === changeOrder.contractId); return c ? `${c.contractNumber} (${c.status})` : changeOrder.contractId; })()}</p>
            </div>
          )}

          {canLinkItems && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => setShowTmPicker(true)} data-testid="button-link-tm">
                <Link className="w-4 h-4 mr-2" />{changeOrder.linkedTmTicketId ? "Change T&M Ticket" : "Link T&M Ticket"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowRfiPicker(true)} data-testid="button-link-rfi">
                <Link className="w-4 h-4 mr-2" />{changeOrder.linkedRfiId ? "Change RFI" : "Link RFI"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowContractPicker(true)} data-testid="button-link-contract">
                <FileText className="w-4 h-4 mr-2" />{changeOrder.contractId ? "Change Contract" : "Link Contract"}
              </Button>
            </div>
          )}

          <Separator />

          {isAdmin && ["DRAFT", "PCO", "PENDING_APPROVAL"].includes(changeOrder.status) && (
            <>
              <Collapsible open={approvalChainOpen} onOpenChange={setApprovalChainOpen}>
                <div className="flex items-center justify-between">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 p-0 hover:bg-transparent" data-testid="toggle-approval-chain-config">
                      {approvalChainOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <Shield className="w-4 h-4" />
                      <h3 className="text-sm font-medium">Configure Approval Chain</h3>
                      {approvals && approvals.length > 0 && <Badge variant="outline" className="ml-2 text-xs">{approvals.length} step{approvals.length !== 1 ? "s" : ""}</Badge>}
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="mt-3 space-y-3">
                  {newApprovalSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2" data-testid={`approval-step-config-${idx}`}>
                      <span className="text-sm text-muted-foreground w-6 shrink-0">#{idx + 1}</span>
                      <Select value={step.approverRole} onValueChange={(v) => { const updated = [...newApprovalSteps]; updated[idx] = { approverRole: v }; setNewApprovalSteps(updated); }}>
                        <SelectTrigger className="flex-1" data-testid={`select-approver-role-${idx}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{APPROVAL_ROLES.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}</SelectContent>
                      </Select>
                      {newApprovalSteps.length > 1 && (
                        <Button size="icon" variant="ghost" onClick={() => setNewApprovalSteps(newApprovalSteps.filter((_, i) => i !== idx))} data-testid={`button-remove-step-${idx}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    {newApprovalSteps.length < 3 && (
                      <Button variant="outline" size="sm" onClick={() => setNewApprovalSteps([...newApprovalSteps, { approverRole: "MANAGER" }])} data-testid="button-add-approval-step">
                        <Plus className="w-4 h-4 mr-1" /> Add Step
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setupApprovalChainMutation.mutate(newApprovalSteps)} disabled={setupApprovalChainMutation.isPending} data-testid="button-save-approval-chain">
                      {setupApprovalChainMutation.isPending ? "Saving..." : "Save Chain"}
                    </Button>
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Separator />
            </>
          )}

          {hasManagementAccess(userRole) && useStructuredForm && (
            <Collapsible open={lineItemsOpen} onOpenChange={setLineItemsOpen}>
              <div className="flex items-center justify-between">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="flex items-center gap-2 p-0 hover:bg-transparent">
                    {lineItemsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <Calculator className="w-4 h-4" />
                    <h3 className="text-sm font-medium">Cost Breakdown (Sections A–K)</h3>
                    <Badge variant="outline" className="ml-2 font-mono">${fmt(totals.grand)}</Badge>
                  </Button>
                </CollapsibleTrigger>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => saveLineItemsMutation.mutate()} disabled={saveLineItemsMutation.isPending} data-testid="button-save-line-items">
                    <DollarSign className="w-3 h-3 mr-1" />
                    {saveLineItemsMutation.isPending ? "Saving..." : "Save & Calculate"}
                  </Button>
                )}
              </div>

              <CollapsibleContent className="mt-4 space-y-4">
                {canEdit && (
                  <div className="space-y-2" data-testid="section-toggle-settings">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setShowSectionSettings(v => !v)}
                      data-testid="button-toggle-section-settings"
                    >
                      <Settings className="w-3 h-3" />
                      {showSectionSettings ? "Hide Section Settings" : "Section Settings"}
                    </Button>
                    {showSectionSettings && (
                      <div className="flex flex-wrap gap-3 p-3 bg-muted/30 rounded-md border" data-testid="section-settings-panel">
                        {(Object.keys(SECTION_LABELS) as SectionKey[]).map(key => {
                          const autoDisabled = isSectionAutoDisabled(key);
                          return (
                            <label key={key} className="flex items-center gap-1.5 text-xs cursor-pointer" data-testid={`toggle-section-${key}`}>
                              <Switch
                                checked={sectionVisibility[key]}
                                onCheckedChange={(checked: boolean) => toggleSection(key, checked)}
                                disabled={autoDisabled}
                                className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                                data-testid={`switch-section-${key}`}
                              />
                              <span className={autoDisabled ? "text-muted-foreground line-through" : ""}>{SECTION_LABELS[key]}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {sectionVisibility.A && renderCombinedLaborSection()}
                {sectionVisibility.A && sectionVisibility.B && <Separator />}
                {sectionVisibility.B && renderCombinedFringeSection()}
                {(sectionVisibility.B || sectionVisibility.A) && (sectionVisibility.C || sectionVisibility.D || sectionVisibility.E) && <Separator />}
                {sectionVisibility.C && renderItemSection("sectionC", "Section C — Equipment Rental", totals.C)}
                {sectionVisibility.D && renderItemSection("sectionD", "Section D — Owned Equipment", totals.D)}
                {sectionVisibility.E && renderItemSection("sectionE", "Section E — Trucking", totals.E)}
                {sectionVisibility.F && <Separator />}
                {sectionVisibility.F && renderCalculatedSection("Section F — Overhead", "sectionF", totals.F, "Overhead %", overheadPct, setOverheadPct, `(${["A","A1","B","B1","C","D","E"].filter((k) => sectionVisibility[k.replace("1","") as SectionKey]).join("+")}) × ${overheadPct}%`, totals.subtotalForOH)}
                {sectionVisibility.G && <Separator />}
                {sectionVisibility.G && renderItemSection("sectionG", "Section G — Material", totals.G)}
                {sectionVisibility.H && <Separator />}
                {sectionVisibility.H && renderCalculatedSection("Section H — Profit", "sectionH", totals.H, "Profit %", profitPct, setProfitPct, `(${["A","A1","B","B1","C","D","E","F","G"].filter((k) => sectionVisibility[k.replace("1","") as SectionKey]).join("+")}) × ${profitPct}%`, totals.subtotalForProfit)}
                {sectionVisibility.I && <Separator />}
                {sectionVisibility.I && renderSubcontractorSection()}
                {sectionVisibility.J && renderCalculatedSection("Section J — Contractor Markup on Subcontractor", "sectionJ", totals.J, "Markup %", subMarkupPct, setSubMarkupPct, `I × ${subMarkupPct}%`, totals.I)}
                {sectionVisibility.K && <Separator />}
                {sectionVisibility.K && renderMiscSection()}

                <Card className="p-4 bg-primary/5 border-primary/20">
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-sm font-bold">GRAND TOTAL</span>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {["A","A1","B","B1","C","D","E","F","G","H","I","J","K"]
                          .filter(k => sectionVisibility[k.replace("1","") as SectionKey])
                          .join(" + ") || "No sections enabled"}
                      </p>
                    </div>
                    <span className="text-2xl font-bold font-mono" data-testid="text-grand-total">${fmt(totals.grand)}</span>
                  </div>
                  <Separator className="my-3" />
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    {sectionVisibility.A && <div className="flex justify-between"><span className="text-muted-foreground">A (Std Labor):</span><span className="font-mono">${fmt(totals.A)}</span></div>}
                    {sectionVisibility.A && <div className="flex justify-between"><span className="text-muted-foreground">A1 (Prem Labor):</span><span className="font-mono">${fmt(totals.A1)}</span></div>}
                    {sectionVisibility.B && <div className="flex justify-between"><span className="text-muted-foreground">B (Std Fringe):</span><span className="font-mono">${fmt(totals.B)}</span></div>}
                    {sectionVisibility.B && <div className="flex justify-between"><span className="text-muted-foreground">B1 (Prem Fringe):</span><span className="font-mono">${fmt(totals.B1)}</span></div>}
                    {sectionVisibility.C && <div className="flex justify-between"><span className="text-muted-foreground">C (Equip Rental):</span><span className="font-mono">${fmt(totals.C)}</span></div>}
                    {sectionVisibility.D && <div className="flex justify-between"><span className="text-muted-foreground">D (Owned Equip):</span><span className="font-mono">${fmt(totals.D)}</span></div>}
                    {sectionVisibility.E && <div className="flex justify-between"><span className="text-muted-foreground">E (Trucking):</span><span className="font-mono">${fmt(totals.E)}</span></div>}
                    {sectionVisibility.F && <div className="flex justify-between"><span className="text-muted-foreground">F (Overhead):</span><span className="font-mono">${fmt(totals.F)}</span></div>}
                    {sectionVisibility.G && <div className="flex justify-between"><span className="text-muted-foreground">G (Material):</span><span className="font-mono">${fmt(totals.G)}</span></div>}
                    {sectionVisibility.H && <div className="flex justify-between"><span className="text-muted-foreground">H (Profit):</span><span className="font-mono">${fmt(totals.H)}</span></div>}
                    {sectionVisibility.I && <div className="flex justify-between"><span className="text-muted-foreground">I (Subcontractor):</span><span className="font-mono">${fmt(totals.I)}</span></div>}
                    {sectionVisibility.J && <div className="flex justify-between"><span className="text-muted-foreground">J (Sub Markup):</span><span className="font-mono">${fmt(totals.J)}</span></div>}
                    {sectionVisibility.K && <div className="flex justify-between col-span-2"><span className="text-muted-foreground">K (Misc):</span><span className="font-mono">${fmt(totals.K)}</span></div>}
                  </div>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          )}

          {hasManagementAccess(userRole) && !useStructuredForm && (
            <div className="p-4 bg-muted/30 rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Legacy Cost Breakdown</p>
                  <p className="text-xs text-muted-foreground">This change order uses the previous format (Labor/Equipment/Materials).</p>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={() => { setUseStructuredForm(true); setBreakdown(emptyBreakdown()); }} data-testid="button-upgrade-format">
                    Upgrade to Industry Format
                  </Button>
                )}
              </div>
              <div className="mt-3">
                <p className={`text-2xl font-bold font-mono ${parseFloat(changeOrder.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                  {parseFloat(changeOrder.amount) >= 0 ? '+' : ''}${parseFloat(changeOrder.amount).toLocaleString()}
                </p>
                <Badge variant={parseFloat(changeOrder.amount) >= 0 ? "default" : "destructive"} className="mt-1">
                  {parseFloat(changeOrder.amount) >= 0 ? 'Addition' : 'Deduction'}
                </Badge>
              </div>
              {lineItemsData?.laborEntries?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Labor ({lineItemsData.laborEntries.length} entries)</p>
                  {lineItemsData.laborEntries.map((e: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-0.5 border-b border-border/50">
                      <span>{e.employeeName} {e.position ? `(${e.position})` : ""}</span>
                      <span className="font-mono">{e.hoursWorked}h × ${p(e.hourlyRate).toFixed(2)} = ${p(e.totalCost).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              {lineItemsData?.equipmentEntries?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Equipment ({lineItemsData.equipmentEntries.length} entries)</p>
                  {lineItemsData.equipmentEntries.map((e: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-0.5 border-b border-border/50">
                      <span>{e.equipmentType} {e.description ? `— ${e.description}` : ""}</span>
                      <span className="font-mono">${p(e.totalCost).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              {lineItemsData?.materialEntries?.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Materials ({lineItemsData.materialEntries.length} entries)</p>
                  {lineItemsData.materialEntries.map((e: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs py-0.5 border-b border-border/50">
                      <span>{e.materialDescription} {e.unit ? `(${e.unit})` : ""}</span>
                      <span className="font-mono">{e.quantity} × ${p(e.unitCost).toFixed(2)} = ${p(e.totalCost).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasManagementAccess(userRole) && isEditing && (
            <div>
              <Label htmlFor="view-co-amount">Amount (Manual Override)</Label>
              <Input id="view-co-amount" type="number" step="0.01" value={editedAmount} onChange={(e) => setEditedAmount(e.target.value)} data-testid="input-edit-co-amount" />
              <p className="text-xs text-muted-foreground mt-1">This overrides the calculated total. Use Save & Calculate to auto-compute from sections.</p>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Attachments</h3>
              {canEdit && <ChangeOrderFileUploader changeOrderId={changeOrder.id} variant="outline" />}
            </div>
            <ChangeOrderFiles changeOrderId={changeOrder.id} alwaysExpanded />
          </div>

          {approvals && approvals.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2"><Shield className="w-4 h-4" />Approval Chain</h3>
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
                        {item.approval.comments && <p className="text-xs text-muted-foreground mt-0.5 italic">"{item.approval.comments}"</p>}
                      </div>
                      <Badge variant={item.approval.status === "APPROVED" ? "default" : item.approval.status === "REJECTED" ? "destructive" : "secondary"}>
                        {item.approval.status}
                      </Badge>
                      {idx < approvals.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0 hidden sm:block" />}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {revisions && revisions.length > 0 && (
            <>
              <Separator />
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full" data-testid="toggle-revision-history">
                  <History className="w-4 h-4" />Revision History ({revisions.length})
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
                            <Badge variant={item.revision.newStatus === "APPROVED" ? "default" : item.revision.newStatus === "REJECTED" ? "destructive" : "secondary"} className="text-xs">{item.revision.newStatus}</Badge>
                          </div>
                          {item.revision.description && <p className="text-xs text-muted-foreground mt-1">{item.revision.description}</p>}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {item.revisedBy ? `${item.revisedBy.firstName} ${item.revisedBy.lastName}` : "System"}{" · "}{formatDistanceToNow(new Date(item.revision.createdAt), { addSuffix: true })}
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
              <Button variant="outline" onClick={() => setIsEditing(false)} data-testid="button-cancel-edit">Cancel</Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-changes">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              {canEdit && (
                <Button variant="outline" onClick={() => setIsEditing(true)} data-testid="button-edit-change-order">
                  <Edit className="w-4 h-4 mr-2" />Edit
                </Button>
              )}
              {canReview && changeOrder.status === "PCO" && (
                <Button onClick={() => promoteToReviewMutation.mutate()} disabled={promoteToReviewMutation.isPending} data-testid="button-promote-to-review">
                  <ClipboardCheck className="w-4 h-4 mr-2" />{promoteToReviewMutation.isPending ? "Promoting..." : "Promote to Pricing Review"}
                </Button>
              )}
              {canManage && changeOrder.status === "PRICING_REVIEW" && (
                <>
                  <Button onClick={() => approvePricingMutation.mutate()} disabled={approvePricingMutation.isPending} data-testid="button-approve-pricing">
                    <Send className="w-4 h-4 mr-2" />{approvePricingMutation.isPending ? "Submitting..." : "Approve Pricing → Submit to Client"}
                  </Button>
                  <Button variant="outline" onClick={handleReturnToPco} disabled={returnToPcoMutation.isPending} data-testid="button-return-to-pco">
                    <Flag className="w-4 h-4 mr-2" />{returnToPcoMutation.isPending ? "Returning..." : "Return to PCO"}
                  </Button>
                </>
              )}
              {changeOrder.status === "DRAFT" && (
                <Button onClick={() => requestApprovalMutation.mutate()} disabled={requestApprovalMutation.isPending} data-testid="button-request-approval-dialog">
                  <Clock className="w-4 h-4 mr-2" />{requestApprovalMutation.isPending ? "Requesting..." : "Request Approval"}
                </Button>
              )}
              {canManage && changeOrder.status === "PENDING_APPROVAL" && (
                <>
                  <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} data-testid="button-submit-dialog">
                    <CheckCircle className="w-4 h-4 mr-2" />{submitMutation.isPending ? "Submitting..." : "Submit to Client"}
                  </Button>
                  <Button variant="outline" onClick={() => returnToDraftMutation.mutate()} disabled={returnToDraftMutation.isPending} data-testid="button-return-draft-dialog">
                    <Edit className="w-4 h-4 mr-2" />{returnToDraftMutation.isPending ? "Returning..." : "Return to Draft"}
                  </Button>
                </>
              )}
              {canManage && changeOrder.status === "SUBMITTED" && (
                <>
                  <Button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} data-testid="button-approve-dialog">
                    <CheckCircle className="w-4 h-4 mr-2" />{approveMutation.isPending ? "Approving..." : "Approve"}
                  </Button>
                  <Button variant="destructive" onClick={() => rejectMutation.mutate()} disabled={rejectMutation.isPending} data-testid="button-reject-dialog">
                    <XCircle className="w-4 h-4 mr-2" />{rejectMutation.isPending ? "Rejecting..." : "Reject"}
                  </Button>
                </>
              )}
              {canManage && changeOrder.status === "REJECTED" && (
                <Button variant="outline" onClick={handleReturnToPco} disabled={returnToPcoMutation.isPending} data-testid="button-return-to-pco-from-rejected">
                  <Flag className="w-4 h-4 mr-2" />{returnToPcoMutation.isPending ? "Returning..." : "Return to PCO"}
                </Button>
              )}
              {userRole === "ADMIN" && changeOrder.status === "APPROVED" && (
                <Button variant="outline" onClick={() => setShowVoidDialog(true)} data-testid="button-void-change-order">
                  <Ban className="w-4 h-4 mr-2" />Void CO
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-dialog">Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <Dialog open={showTmPicker} onOpenChange={setShowTmPicker}>
        <DialogContent className="max-w-lg" data-testid="dialog-tm-picker">
          <DialogHeader><DialogTitle>Link T&M Ticket</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {tmTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No T&M tickets found for this project</p>
            ) : tmTickets.map((ticket) => (
              <Card key={ticket.id} className="p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => linkTmMutation.mutate(ticket.id)} data-testid={`button-select-tm-${ticket.id}`}>
                <div className="flex items-center justify-between">
                  <div><p className="font-medium text-sm font-mono">{ticket.ticketNumber}</p><p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ticket.description}</p></div>
                  <Badge variant="outline" className="text-xs shrink-0">{ticket.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowTmPicker(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRfiPicker} onOpenChange={setShowRfiPicker}>
        <DialogContent className="max-w-lg" data-testid="dialog-rfi-picker">
          <DialogHeader><DialogTitle>Link RFI</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {projectRfis.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No RFIs found for this project</p>
            ) : projectRfis.map((rfi) => (
              <Card key={rfi.id} className="p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => linkRfiMutation.mutate(rfi.id)} data-testid={`button-select-rfi-${rfi.id}`}>
                <div className="flex items-center justify-between">
                  <div><p className="font-medium text-sm font-mono">{rfi.rfiNumber}</p><p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rfi.subject}</p></div>
                  <Badge variant="outline" className="text-xs shrink-0">{rfi.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowRfiPicker(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showContractPicker} onOpenChange={setShowContractPicker}>
        <DialogContent className="max-w-lg" data-testid="dialog-contract-picker">
          <DialogHeader><DialogTitle>Link Contract</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {projectContracts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No contracts found for this project</p>
            ) : projectContracts.map((c) => (
              <Card key={c.id} className="p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => linkContractMutation.mutate(c.id)} data-testid={`button-select-contract-${c.id}`}>
                <div className="flex items-center justify-between">
                  <div><p className="font-medium text-sm font-mono">{c.contractNumber}</p><p className="text-xs text-muted-foreground mt-0.5">{c.contractType}</p></div>
                  <Badge variant="outline" className="text-xs shrink-0">{c.status}</Badge>
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowContractPicker(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>

    <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
      <DialogContent className="max-w-md" data-testid="dialog-void-change-order">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Ban className="w-5 h-5 text-destructive" />Void Change Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">Voiding a change order is permanent. Please provide a reason for voiding this change order.</p>
          <div>
            <Label htmlFor="void-reason">Void Reason</Label>
            <Textarea id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Enter reason for voiding..." rows={3} data-testid="input-void-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setShowVoidDialog(false); setVoidReason(""); }}>Cancel</Button>
          <Button variant="destructive" onClick={handleVoid} disabled={voidMutation.isPending || !voidReason.trim()} data-testid="button-confirm-void">
            {voidMutation.isPending ? "Voiding..." : "Void Change Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
