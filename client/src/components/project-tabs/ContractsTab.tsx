import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { Plus, Eye, FileText, CheckCircle, XCircle, Clock, ArrowRight, History, MessageSquare, Paperclip, Upload, Trash2, PenTool, Send, BookTemplate, LayoutTemplate, ShieldAlert, AlertTriangle, ChevronDown, ChevronUp, Brain } from "lucide-react";
interface ContractsTabProps {
  projectId: string;
  projectCode: string;
  userRole: string;
}

const CONTRACT_MANAGE_ROLES = ["ADMIN", "MANAGER"];

function canManageContractsClient(role?: string) {
  return CONTRACT_MANAGE_ROLES.includes(role || "");
}

interface ContractVersion {
  id: string;
  versionNumber: number;
  changeNote: string | null;
  createdAt: string;
}

interface ContractRedline {
  id: string;
  description: string;
  section: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
}

interface ContractApproval {
  id: string;
  reviewerId: string;
  decision: string;
  comments: string | null;
  decidedAt: string | null;
  createdAt: string;
}

interface RiskClauseAnalysis {
  category: string;
  title: string;
  riskScore: number;
  riskLevel: string;
  finding: string;
  suggestion: string;
}

interface RiskMissingProtection {
  category: string;
  title: string;
  severity: string;
  description: string;
}

interface RiskRecommendation {
  priority: number;
  title: string;
  description: string;
  impact: string;
}

interface ContractRiskAnalysis {
  id: string;
  contractId: string;
  overallRiskScore: number;
  riskLevel: string;
  summary: string;
  clauseAnalysis: RiskClauseAnalysis[];
  missingProtections: RiskMissingProtection[];
  recommendations: RiskRecommendation[];
  analyzedAt: string;
}

interface ContractAttachment {
  id: string;
  fileName: string;
  objectKey: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  stage: string;
  version: number;
}

interface Contract {
  id: string;
  contractNumber: string;
  contractType: string;
  status: string;
  parties: string | null;
  contractValue: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  paymentTerms: string | null;
  retentionPercent: string | null;
  insuranceRequirements: string | null;
  scopeSummary: string | null;
  keyDates: string | null;
  signatureDate: string | null;
  signatoryNames: string | null;
  currentVersion: number;
  attachmentsJson: string | null;
  createdAt: string;
  versions?: ContractVersion[];
  redlines?: ContractRedline[];
  approvals?: ContractApproval[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  IN_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  REDLINED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  EXECUTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  AMENDED: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

const TYPE_LABELS: Record<string, string> = {
  PRIME: "Prime Contract",
  SUBCONTRACT: "Subcontract",
  JV: "Joint Venture",
  T_AND_M: "Time & Materials",
};

const TRANSITIONS: Record<string, { label: string; target: string; special?: string }[]> = {
  DRAFT: [{ label: "Submit for Review", target: "IN_REVIEW" }],
  IN_REVIEW: [
    { label: "Mark as Redlined", target: "REDLINED" },
    { label: "Request Approval", target: "PENDING_APPROVAL", special: "REQUEST_APPROVAL" },
    { label: "Return to Draft", target: "DRAFT" },
  ],
  REDLINED: [
    { label: "Return to Review", target: "IN_REVIEW" },
    { label: "Request Approval", target: "PENDING_APPROVAL", special: "REQUEST_APPROVAL" },
  ],
  PENDING_APPROVAL: [
    { label: "Return to Review", target: "IN_REVIEW" },
  ],
  APPROVED: [{ label: "Record Execution", target: "EXECUTED" }],
  EXECUTED: [{ label: "Create Amendment", target: "AMENDED" }],
  AMENDED: [{ label: "Submit for Review", target: "IN_REVIEW" }],
};

export default function ContractsTab({ projectId, projectCode, userRole }: ContractsTabProps) {
  const { toast } = useToast();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [showRedlineDialog, setShowRedlineDialog] = useState(false);
  const [showRequestApprovalDialog, setShowRequestApprovalDialog] = useState(false);
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([]);
  const [approvalComment, setApprovalComment] = useState("");
  const [compareV1, setCompareV1] = useState<number | null>(null);
  const [compareV2, setCompareV2] = useState<number | null>(null);
  const [compareResult, setCompareResult] = useState<{ field: string; from: string; to: string }[] | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showRiskAnalysis, setShowRiskAnalysis] = useState(false);
  const [expandedClauseIdx, setExpandedClauseIdx] = useState<number | null>(null);

  const defaultForm = {
    contractNumber: "",
    contractType: "PRIME",
    parties: "",
    contractValue: "",
    effectiveDate: "",
    expirationDate: "",
    paymentTerms: "",
    retentionPercent: "",
    insuranceRequirements: "",
    scopeSummary: "",
    keyDates: "",
  };
  const [form, setForm] = useState(defaultForm);

  const [redlineForm, setRedlineForm] = useState({ description: "", section: "" });
  const [showExecutionDialog, setShowExecutionDialog] = useState(false);
  const [executionForm, setExecutionForm] = useState({ signatureDate: "", signatoryNames: "", executedDocumentUrl: "" });
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signatureForm, setSignatureForm] = useState({ signers: [{ name: "", email: "", role: "" }], message: "", expiresInDays: "30" });
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  const canManage = canManageContractsClient(userRole);

  const { data: contractsList = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts/by-project", projectId],
  });

  const { data: orgMembers = [] } = useQuery<{ id: string; firstName: string; lastName: string; role: string }[]>({
    queryKey: ["/api/organization/members"],
  });

  const requestApprovalMutation = useMutation({
    mutationFn: async ({ contractId, reviewerIds }: { contractId: string; reviewerIds: string[] }) => {
      const res = await apiRequest("POST", `/api/contracts/${contractId}/request-approval`, { reviewerIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setShowRequestApprovalDialog(false);
      setSelectedReviewerIds([]);
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Approval requested" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to request approval", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, string | null>) => {
      const res = await apiRequest("POST", "/api/contracts", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setShowCreateDialog(false);
      setForm({ contractNumber: "", contractType: "PRIME", parties: "", contractValue: "", effectiveDate: "", expirationDate: "", paymentTerms: "", retentionPercent: "", insuranceRequirements: "", scopeSummary: "", keyDates: "" });
      toast({ title: "Contract created" });
    },
    onError: () => toast({ title: "Error", description: "Failed to create contract", variant: "destructive" }),
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, newStatus, extra }: { id: string; newStatus: string; extra?: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/contracts/${id}/transition`, { newStatus, ...extra });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Status updated" });
      if (selectedContract) {
        loadContractDetail(selectedContract.id);
      }
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to update status", variant: "destructive" }),
  });

  const redlineMutation = useMutation({
    mutationFn: async ({ contractId, description, section }: { contractId: string; description: string; section: string }) => {
      const res = await apiRequest("POST", `/api/contracts/${contractId}/redlines`, { description, section });
      return res.json();
    },
    onSuccess: () => {
      setShowRedlineDialog(false);
      setRedlineForm({ description: "", section: "" });
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Redline added" });
    },
    onError: () => toast({ title: "Error", description: "Failed to add redline", variant: "destructive" }),
  });

  const resolveRedlineMutation = useMutation({
    mutationFn: async ({ contractId, redlineId, status, resolution }: { contractId: string; redlineId: string; status: string; resolution?: string }) => {
      const res = await apiRequest("PATCH", `/api/contracts/${contractId}/redlines/${redlineId}`, { status, resolution });
      return res.json();
    },
    onSuccess: () => {
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Redline updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update redline", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | null> }) => {
      const res = await apiRequest("PATCH", `/api/contracts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setShowEditDialog(false);
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Contract updated" });
    },
    onError: () => toast({ title: "Error", description: "Failed to update contract", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, comments }: { id: string; comments?: string }) => {
      const res = await apiRequest("POST", `/api/contracts/${id}/approve`, { comments });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Contract approved" });
      setApprovalComment("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to approve", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, comments }: { id: string; comments?: string }) => {
      const res = await apiRequest("POST", `/api/contracts/${id}/reject`, { comments });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Contract rejected" });
      setApprovalComment("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to reject", variant: "destructive" }),
  });

  const { data: templates = [] } = useQuery<{ id: string; name: string; description: string | null; contractType: string; isActive: boolean }[]>({
    queryKey: ["/api/clause-library/templates"],
  });

  const applyTemplateMutation = useMutation({
    mutationFn: async ({ templateId, contractId }: { templateId: string; contractId: string }) => {
      const res = await apiRequest("POST", `/api/clause-library/templates/${templateId}/apply/${contractId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setShowTemplateDialog(false);
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Template applied successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to apply template", variant: "destructive" }),
  });

  const signatureRequestMutation = useMutation({
    mutationFn: async ({ contractId, signers, message, expiresInDays }: { contractId: string; signers: { name: string; email: string; role: string }[]; message: string; expiresInDays: number }) => {
      const res = await apiRequest("POST", `/api/contracts/${contractId}/signature-request`, { signers, message, expiresInDays });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      setShowSignatureDialog(false);
      setSignatureForm({ signers: [{ name: "", email: "", role: "" }], message: "", expiresInDays: "30" });
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Signature request sent" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to send signature request", variant: "destructive" }),
  });

  const signMutation = useMutation({
    mutationFn: async ({ contractId, reqId, signerId, action, declineReason }: { contractId: string; reqId: string; signerId: string; action: string; declineReason?: string }) => {
      const res = await apiRequest("POST", `/api/contracts/${contractId}/signature-requests/${reqId}/sign`, { signerId, action, declineReason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      if (selectedContract) {
        loadContractDetail(selectedContract.id);
        loadSignatureRequests(selectedContract.id);
      }
      toast({ title: "Signature recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message || "Failed to sign", variant: "destructive" }),
  });

  const [signatureRequests, setSignatureRequests] = useState<{ id: string; status: string; message: string | null; expiresAt: string | null; createdAt: string; signers: { id: string; name: string; email: string; role: string; status: string; signedAt?: string }[] }[]>([]);

  const loadSignatureRequests = async (contractId: string) => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/signature-requests`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSignatureRequests(data);
      }
    } catch (err) {
      console.error("[ContractsTab] Failed to load signature requests:", err);
    }
  };

  const loadContractDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/contracts/${id}`, { credentials: "include" });
      if (res.ok) {
        const detail = await res.json();
        setSelectedContract(detail);
      }
    } catch (err) {
      console.error("[ContractsTab] Failed to load contract detail:", err);
    }
  };

  const handleCreate = () => {
    if (!form.contractNumber) {
      toast({ title: "Error", description: "Contract number is required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      projectId,
      ...form,
      contractValue: form.contractValue || null,
      retentionPercent: form.retentionPercent || null,
      effectiveDate: form.effectiveDate || null,
      expirationDate: form.expirationDate || null,
    });
  };

  const openDetail = async (contract: Contract) => {
    await loadContractDetail(contract.id);
    await loadSignatureRequests(contract.id);
    setShowDetailDialog(true);
  };

  const compareVersions = async (contractId: string, v1: number, v2: number) => {
    try {
      const res = await fetch(`/api/contracts/${contractId}/versions/compare?v1=${v1}&v2=${v2}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCompareResult(data.changes);
        setCompareV1(v1);
        setCompareV2(v2);
      }
    } catch (err) {
      console.error("[ContractsTab] Version compare error:", err);
      toast({ title: "Error", description: "Failed to compare versions", variant: "destructive" });
    }
  };

  const handleFileUpload = async (contractId: string, file: File) => {
    setIsUploading(true);
    try {
      const urlRes = await apiRequest("POST", `/api/contracts/${contractId}/attachments/upload-url`, {});
      const { uploadURL, objectKey } = await urlRes.json();

      await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      await apiRequest("POST", `/api/contracts/${contractId}/attachments`, {
        fileName: file.name,
        objectKey,
        fileType: file.type,
        fileSize: file.size,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      loadContractDetail(contractId);
      toast({ title: "Document uploaded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload document";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const deleteAttachmentMutation = useMutation({
    mutationFn: async ({ contractId, attachmentId }: { contractId: string; attachmentId: string }) => {
      const res = await apiRequest("DELETE", `/api/contracts/${contractId}/attachments/${attachmentId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts/by-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      if (selectedContract) loadContractDetail(selectedContract.id);
      toast({ title: "Document removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: riskAnalyses = [], isLoading: isLoadingRisk } = useQuery<ContractRiskAnalysis[]>({
    queryKey: ["/api/contracts", selectedContract?.id, "risk-analysis"],
    queryFn: async () => {
      if (!selectedContract) return [];
      const res = await fetch(`/api/contracts/${selectedContract.id}/risk-analysis`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedContract && showRiskAnalysis,
  });

  const runRiskAnalysisMutation = useMutation({
    mutationFn: async (contractId: string) => {
      const res = await apiRequest("POST", `/api/contracts/${contractId}/risk-analysis`);
      return res.json();
    },
    onSuccess: () => {
      if (selectedContract) {
        queryClient.invalidateQueries({ queryKey: ["/api/contracts", selectedContract.id, "risk-analysis"] });
      }
      toast({ title: "Risk analysis complete" });
    },
    onError: (err: Error) => toast({ title: "Analysis failed", description: err.message, variant: "destructive" }),
  });

  const getRiskColor = (level: string) => {
    switch (level) {
      case "LOW": return "text-green-600 dark:text-green-400";
      case "MODERATE": return "text-yellow-600 dark:text-yellow-400";
      case "HIGH": return "text-orange-600 dark:text-orange-400";
      case "CRITICAL": return "text-red-600 dark:text-red-400";
      default: return "text-muted-foreground";
    }
  };

  const getRiskBadgeVariant = (level: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (level) {
      case "LOW": return "secondary";
      case "MODERATE": return "outline";
      case "HIGH": return "destructive";
      case "CRITICAL": return "destructive";
      default: return "outline";
    }
  };

  const getRiskBg = (level: string) => {
    switch (level) {
      case "LOW": return "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800";
      case "MODERATE": return "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800";
      case "HIGH": return "bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800";
      case "CRITICAL": return "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800";
      default: return "bg-muted border";
    }
  };

  const getScoreColor = (score: number) => {
    if (score <= 25) return "text-green-600 dark:text-green-400";
    if (score <= 50) return "text-yellow-600 dark:text-yellow-400";
    if (score <= 75) return "text-orange-600 dark:text-orange-400";
    return "text-red-600 dark:text-red-400";
  };

  const openEdit = (contract: Contract) => {
    setForm({
      contractNumber: contract.contractNumber,
      contractType: contract.contractType,
      parties: contract.parties || "",
      contractValue: contract.contractValue || "",
      effectiveDate: contract.effectiveDate ? contract.effectiveDate.split("T")[0] : "",
      expirationDate: contract.expirationDate ? contract.expirationDate.split("T")[0] : "",
      paymentTerms: contract.paymentTerms || "",
      retentionPercent: contract.retentionPercent || "",
      insuranceRequirements: contract.insuranceRequirements || "",
      scopeSummary: contract.scopeSummary || "",
      keyDates: contract.keyDates || "",
    });
    setShowEditDialog(true);
  };

  const formatCurrency = (val: string | null) => {
    if (!val) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(val));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Contracts
        </h2>
        {canManage && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-contract">
            <Plus className="h-4 w-4 mr-2" />
            New Contract
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading contracts...</div>
      ) : contractsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-no-contracts">No contracts yet for this project.</p>
            {canManage && (
              <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-contract-empty">
                <Plus className="h-4 w-4 mr-2" />
                Create Contract
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {contractsList.map((contract) => (
            <Card key={contract.id} data-testid={`card-contract-${contract.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="outline" className="font-mono" data-testid={`text-contract-number-${contract.id}`}>
                        {contract.contractNumber}
                      </Badge>
                      <Badge className={STATUS_COLORS[contract.status] || ""} data-testid={`status-badge-${contract.id}`}>
                        {contract.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" data-testid={`text-contract-type-${contract.id}`}>
                        {TYPE_LABELS[contract.contractType] || contract.contractType}
                      </Badge>
                    </div>
                    {contract.scopeSummary && (
                      <p className="text-sm text-muted-foreground mb-1 line-clamp-2">{contract.scopeSummary}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Version {contract.currentVersion} · Created {format(new Date(contract.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="text-right space-y-2">
                    <p className="text-lg font-bold font-mono" data-testid={`text-contract-value-${contract.id}`}>
                      {formatCurrency(contract.contractValue)}
                    </p>
                    <Button size="sm" variant="ghost" onClick={() => openDetail(contract)} data-testid={`button-view-contract-${contract.id}`}>
                      <Eye className="h-4 w-4 mr-1" />
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-contract">
          <DialogHeader>
            <DialogTitle>Create Contract</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contract Number *</Label>
                <Input value={form.contractNumber} onChange={(e) => setForm(f => ({ ...f, contractNumber: e.target.value }))} placeholder="e.g., CTR-2026-001" data-testid="input-contract-number" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.contractType} onValueChange={(v) => setForm(f => ({ ...f, contractType: v }))}>
                  <SelectTrigger data-testid="select-contract-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIME">Prime Contract</SelectItem>
                    <SelectItem value="SUBCONTRACT">Subcontract</SelectItem>
                    <SelectItem value="JV">Joint Venture</SelectItem>
                    <SelectItem value="T_AND_M">Time & Materials</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contract Value ($)</Label>
                <Input type="number" step="0.01" value={form.contractValue} onChange={(e) => setForm(f => ({ ...f, contractValue: e.target.value }))} placeholder="0.00" data-testid="input-contract-value" />
              </div>
              <div>
                <Label>Retention %</Label>
                <Input type="number" step="0.01" value={form.retentionPercent} onChange={(e) => setForm(f => ({ ...f, retentionPercent: e.target.value }))} placeholder="10.00" data-testid="input-retention-percent" />
              </div>
            </div>
            <div>
              <Label>Parties</Label>
              <Input value={form.parties} onChange={(e) => setForm(f => ({ ...f, parties: e.target.value }))} placeholder="Owner, GC, Subcontractor..." data-testid="input-parties" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Effective Date</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm(f => ({ ...f, effectiveDate: e.target.value }))} data-testid="input-effective-date" />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input type="date" value={form.expirationDate} onChange={(e) => setForm(f => ({ ...f, expirationDate: e.target.value }))} data-testid="input-expiration-date" />
              </div>
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.paymentTerms} onChange={(e) => setForm(f => ({ ...f, paymentTerms: e.target.value }))} placeholder="Net 30, Monthly progress payments..." data-testid="input-payment-terms" />
            </div>
            <div>
              <Label>Insurance Requirements</Label>
              <Textarea value={form.insuranceRequirements} onChange={(e) => setForm(f => ({ ...f, insuranceRequirements: e.target.value }))} placeholder="GL $1M, Workers Comp..." data-testid="input-insurance" />
            </div>
            <div>
              <Label>Scope Summary</Label>
              <Textarea value={form.scopeSummary} onChange={(e) => setForm(f => ({ ...f, scopeSummary: e.target.value }))} placeholder="Describe the scope of work..." data-testid="input-scope-summary" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-contract">
              {createMutation.isPending ? "Creating..." : "Create Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="dialog-contract-detail">
          {selectedContract && (
            <div className="space-y-6">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {selectedContract.contractNumber}
                  <Badge className={STATUS_COLORS[selectedContract.status] || ""}>
                    {selectedContract.status.replace(/_/g, " ")}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Type</span>
                  <p className="font-medium">{TYPE_LABELS[selectedContract.contractType] || selectedContract.contractType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Value</span>
                  <p className="font-medium font-mono">{formatCurrency(selectedContract.contractValue)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Retention</span>
                  <p className="font-medium">{selectedContract.retentionPercent ? `${selectedContract.retentionPercent}%` : "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Effective</span>
                  <p className="font-medium">{selectedContract.effectiveDate ? format(new Date(selectedContract.effectiveDate), "MMM d, yyyy") : "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Expiration</span>
                  <p className="font-medium">{selectedContract.expirationDate ? format(new Date(selectedContract.expirationDate), "MMM d, yyyy") : "—"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Version</span>
                  <p className="font-medium">v{selectedContract.currentVersion}</p>
                </div>
              </div>

              {selectedContract.parties && (
                <div>
                  <span className="text-sm text-muted-foreground">Parties</span>
                  <p className="text-sm">{selectedContract.parties}</p>
                </div>
              )}

              {selectedContract.scopeSummary && (
                <div>
                  <span className="text-sm text-muted-foreground">Scope Summary</span>
                  <p className="text-sm">{selectedContract.scopeSummary}</p>
                </div>
              )}

              {selectedContract.paymentTerms && (
                <div>
                  <span className="text-sm text-muted-foreground">Payment Terms</span>
                  <p className="text-sm">{selectedContract.paymentTerms}</p>
                </div>
              )}

              {selectedContract.signatureDate && (
                <div className="p-3 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20">
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    Executed on {format(new Date(selectedContract.signatureDate), "MMM d, yyyy")}
                    {selectedContract.signatoryNames && ` — ${selectedContract.signatoryNames}`}
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                  <Paperclip className="h-4 w-4" /> Documents
                </h3>
                {(() => {
                  const attachments: ContractAttachment[] = JSON.parse(selectedContract.attachmentsJson || "[]");
                  return (
                    <div className="space-y-1">
                      {attachments.length === 0 && <p className="text-xs text-muted-foreground">No documents attached.</p>}
                      {attachments.map((att) => (
                        <div key={att.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`attachment-${att.id}`}>
                          <div className="flex items-center gap-2">
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                            <span>{att.fileName}</span>
                            <Badge variant="outline" className="text-xs">v{att.version} / {att.stage}</Badge>
                            <span className="text-xs text-muted-foreground">{(att.fileSize / 1024).toFixed(1)} KB</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">{format(new Date(att.uploadedAt), "MMM d, yyyy")}</span>
                            {canManage && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={() => deleteAttachmentMutation.mutate({ contractId: selectedContract.id, attachmentId: att.id })}
                                data-testid={`button-delete-attachment-${att.id}`}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {canManage && (
                        <div className="mt-2">
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileUpload(selectedContract.id, file);
                                e.target.value = "";
                              }}
                              data-testid="input-upload-attachment"
                            />
                            <Button size="sm" variant="outline" asChild disabled={isUploading}>
                              <span>
                                <Upload className="h-3 w-3 mr-1" />
                                {isUploading ? "Uploading..." : "Upload Document"}
                              </span>
                            </Button>
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {selectedContract.status !== "EXECUTED" && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(selectedContract)} data-testid="button-edit-contract">
                      <FileText className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  )}
                  {selectedContract.status === "DRAFT" && templates.filter(t => t.isActive).length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setShowTemplateDialog(true)} data-testid="button-apply-template">
                      <LayoutTemplate className="h-3 w-3 mr-1" /> Apply Template
                    </Button>
                  )}
                  {selectedContract.status === "APPROVED" && (
                    <Button size="sm" variant="default" onClick={() => setShowSignatureDialog(true)} data-testid="button-send-for-signature">
                      <PenTool className="h-3 w-3 mr-1" /> Send for Signature
                    </Button>
                  )}
                  {TRANSITIONS[selectedContract.status]?.map((t) => (
                    <Button
                      key={t.special || t.target}
                      size="sm"
                      variant={t.target === "EXECUTED" ? "default" : "outline"}
                      disabled={transitionMutation.isPending}
                      onClick={() => {
                        if (t.target === "EXECUTED") {
                          setShowExecutionDialog(true);
                        } else if (t.special === "REQUEST_APPROVAL") {
                          setShowRequestApprovalDialog(true);
                        } else {
                          transitionMutation.mutate({ id: selectedContract.id, newStatus: t.target });
                        }
                      }}
                      data-testid={`button-transition-${t.special || t.target}`}
                    >
                      <ArrowRight className="h-3 w-3 mr-1" />
                      {t.label}
                    </Button>
                  ))}
                </div>
              )}

              {selectedContract.status === "PENDING_APPROVAL" && canManage && (
                <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 space-y-3">
                  <h4 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">Approval Actions</h4>
                  <div>
                    <Label className="text-xs">Comment (optional)</Label>
                    <Input value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Approval comment..." className="mt-1" data-testid="input-approval-comment" />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => approveMutation.mutate({ id: selectedContract.id, comments: approvalComment || undefined })} disabled={approveMutation.isPending} data-testid="button-approve-contract">
                      <CheckCircle className="h-3 w-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => rejectMutation.mutate({ id: selectedContract.id, comments: approvalComment || undefined })} disabled={rejectMutation.isPending} data-testid="button-reject-contract">
                      <XCircle className="h-3 w-3 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              )}

              {signatureRequests.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <PenTool className="h-4 w-4" /> E-Signature Requests ({signatureRequests.length})
                  </h3>
                  <div className="space-y-3">
                    {signatureRequests.map((sr) => (
                      <div key={sr.id} className="p-3 rounded-lg border text-sm space-y-2" data-testid={`signature-request-${sr.id}`}>
                        <div className="flex items-center justify-between">
                          <Badge className={sr.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : sr.status === "DECLINED" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}>
                            {sr.status.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(sr.createdAt), "MMM d, yyyy")}
                            {sr.expiresAt && ` · Expires ${format(new Date(sr.expiresAt), "MMM d, yyyy")}`}
                          </span>
                        </div>
                        {sr.message && <p className="text-xs text-muted-foreground">{sr.message}</p>}
                        <div className="space-y-1">
                          {sr.signers.map((signer) => (
                            <div key={signer.id} className="flex items-center justify-between py-1 px-2 rounded bg-muted/50">
                              <div className="flex items-center gap-2">
                                {signer.status === "SIGNED" ? (
                                  <CheckCircle className="h-3 w-3 text-green-600" />
                                ) : signer.status === "DECLINED" ? (
                                  <XCircle className="h-3 w-3 text-red-600" />
                                ) : (
                                  <Clock className="h-3 w-3 text-yellow-600" />
                                )}
                                <span className="font-medium">{signer.name}</span>
                                <span className="text-muted-foreground">({signer.role})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs">{signer.email}</span>
                                {signer.status === "PENDING" && sr.status !== "DECLINED" && sr.status !== "COMPLETED" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-xs"
                                    onClick={() => signMutation.mutate({ contractId: selectedContract.id, reqId: sr.id, signerId: signer.id, action: "sign" })}
                                    disabled={signMutation.isPending}
                                    data-testid={`button-sign-${signer.id}`}
                                  >
                                    Sign
                                  </Button>
                                )}
                                {signer.signedAt && (
                                  <span className="text-xs text-green-600">Signed {format(new Date(signer.signedAt), "MMM d")}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedContract.redlines && selectedContract.redlines.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <MessageSquare className="h-4 w-4" /> Redlines ({selectedContract.redlines.length})
                  </h3>
                  <div className="space-y-2">
                    {selectedContract.redlines.map((r: ContractRedline) => (
                      <div key={r.id} className="p-3 rounded-lg border text-sm" data-testid={`redline-${r.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            {r.section && <span className="text-xs font-mono text-muted-foreground mr-2">[{r.section}]</span>}
                            <span>{r.description}</span>
                          </div>
                          <Badge variant={r.status === "OPEN" ? "destructive" : r.status === "RESOLVED" ? "default" : "secondary"}>
                            {r.status}
                          </Badge>
                        </div>
                        {r.resolution && <p className="text-xs text-muted-foreground mt-1">Resolution: {r.resolution}</p>}
                        {canManage && r.status === "OPEN" && (
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" variant="outline" onClick={() => {
                              const resolution = prompt("Resolution note:");
                              if (resolution) resolveRedlineMutation.mutate({ contractId: selectedContract.id, redlineId: r.id, status: "RESOLVED", resolution });
                            }} data-testid={`button-resolve-redline-${r.id}`}>
                              <CheckCircle className="h-3 w-3 mr-1" /> Resolve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveRedlineMutation.mutate({ contractId: selectedContract.id, redlineId: r.id, status: "REJECTED" })} data-testid={`button-reject-redline-${r.id}`}>
                              <XCircle className="h-3 w-3 mr-1" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setShowRedlineDialog(true)} data-testid="button-add-redline">
                  <MessageSquare className="h-4 w-4 mr-1" /> Add Redline
                </Button>
              )}

              {selectedContract.approvals && selectedContract.approvals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> Approvals ({selectedContract.approvals.length})
                  </h3>
                  <div className="space-y-2">
                    {selectedContract.approvals.map((a: ContractApproval) => (
                      <div key={a.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`approval-${a.id}`}>
                        <div>
                          <Badge variant={a.decision === "APPROVED" ? "default" : a.decision === "REJECTED" ? "destructive" : "secondary"}>
                            {a.decision}
                          </Badge>
                          {a.comments && <span className="text-xs text-muted-foreground ml-2">{a.comments}</span>}
                        </div>
                        {a.decidedAt && <span className="text-xs text-muted-foreground">{format(new Date(a.decidedAt), "MMM d, yyyy")}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedContract.versions && selectedContract.versions.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                    <History className="h-4 w-4" /> Version History ({selectedContract.versions.length})
                  </h3>
                  <div className="space-y-1">
                    {selectedContract.versions.map((v: ContractVersion, idx: number) => (
                      <div key={v.id} className="flex items-center justify-between p-2 rounded border text-sm" data-testid={`version-${v.id}`}>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">v{v.versionNumber}</Badge>
                          <span className="text-muted-foreground">{v.changeNote}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{format(new Date(v.createdAt), "MMM d, yyyy")}</span>
                          {idx < selectedContract.versions!.length - 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs px-2"
                              onClick={() => compareVersions(selectedContract.id, selectedContract.versions![idx + 1].versionNumber, v.versionNumber)}
                              data-testid={`button-compare-v${v.versionNumber}`}
                            >
                              Compare
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {compareResult !== null && (
                    <div className="mt-3 p-3 rounded-lg border bg-muted/50">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold">Changes v{compareV1} → v{compareV2}</h4>
                        <Button size="sm" variant="ghost" className="h-5 text-xs" onClick={() => setCompareResult(null)} data-testid="button-close-compare">Close</Button>
                      </div>
                      {compareResult.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No field-level changes detected.</p>
                      ) : (
                        <div className="space-y-1">
                          {compareResult.map((c, i) => (
                            <div key={i} className="text-xs" data-testid={`compare-change-${i}`}>
                              <span className="font-medium">{c.field}:</span>{" "}
                              <span className="text-red-600 dark:text-red-400 line-through">{c.from || "(empty)"}</span>{" → "}
                              <span className="text-green-600 dark:text-green-400">{c.to || "(empty)"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-1">
                    <Brain className="h-4 w-4" /> AI Risk Analysis
                  </h3>
                  <div className="flex gap-2">
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowRiskAnalysis(true);
                          runRiskAnalysisMutation.mutate(selectedContract.id);
                        }}
                        disabled={runRiskAnalysisMutation.isPending}
                        data-testid="button-run-risk-analysis"
                      >
                        <ShieldAlert className="h-4 w-4 mr-1" />
                        {runRiskAnalysisMutation.isPending ? "Analyzing..." : "Run Analysis"}
                      </Button>
                    )}
                    {riskAnalyses.length > 0 && !showRiskAnalysis && (
                      <Button size="sm" variant="ghost" onClick={() => setShowRiskAnalysis(true)} data-testid="button-show-risk">
                        View Results
                      </Button>
                    )}
                    {showRiskAnalysis && (
                      <Button size="sm" variant="ghost" onClick={() => { setShowRiskAnalysis(false); setExpandedClauseIdx(null); }} data-testid="button-hide-risk">
                        Hide
                      </Button>
                    )}
                  </div>
                </div>

                {runRiskAnalysisMutation.isPending && (
                  <div className="flex items-center gap-2 p-4 rounded-lg border bg-muted/50 text-sm text-muted-foreground" data-testid="risk-analysis-loading">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    Analyzing contract for risks... This may take a moment.
                  </div>
                )}

                {showRiskAnalysis && !runRiskAnalysisMutation.isPending && riskAnalyses.length > 0 && (() => {
                  const latest = riskAnalyses[0];
                  return (
                    <div className="space-y-4" data-testid="risk-analysis-results">
                      <div className={`p-4 rounded-lg border ${getRiskBg(latest.riskLevel)}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className="text-center">
                              <div className={`text-3xl font-bold ${getScoreColor(latest.overallRiskScore)}`} data-testid="text-risk-score">
                                {latest.overallRiskScore}
                              </div>
                              <div className="text-[10px] text-muted-foreground uppercase">Risk Score</div>
                            </div>
                            <div>
                              <Badge variant={getRiskBadgeVariant(latest.riskLevel)} className="mb-1" data-testid="badge-risk-level">
                                {latest.riskLevel} RISK
                              </Badge>
                              <p className="text-sm">{latest.summary}</p>
                            </div>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Analyzed {format(new Date(latest.analyzedAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>

                      {latest.clauseAnalysis.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                            <FileText className="h-3.5 w-3.5" /> Clause-by-Clause Analysis ({latest.clauseAnalysis.length})
                          </h4>
                          <div className="space-y-1">
                            {latest.clauseAnalysis.map((clause, idx) => (
                              <div key={idx} className="rounded-lg border text-sm" data-testid={`risk-clause-${idx}`}>
                                <button
                                  className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
                                  onClick={() => setExpandedClauseIdx(expandedClauseIdx === idx ? null : idx)}
                                  data-testid={`button-expand-clause-${idx}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`font-mono text-xs font-bold ${getScoreColor(clause.riskScore)}`}>{clause.riskScore}</span>
                                    <span className="font-medium">{clause.title}</span>
                                    <Badge variant={getRiskBadgeVariant(clause.riskLevel)} className="text-[10px] px-1.5 py-0">
                                      {clause.riskLevel}
                                    </Badge>
                                  </div>
                                  {expandedClauseIdx === idx ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                                {expandedClauseIdx === idx && (
                                  <div className="px-3 pb-3 space-y-2 border-t">
                                    <div className="pt-2">
                                      <span className="text-xs font-semibold text-muted-foreground uppercase">Finding</span>
                                      <p className="text-sm mt-0.5">{clause.finding}</p>
                                    </div>
                                    <div>
                                      <span className="text-xs font-semibold text-muted-foreground uppercase">Suggestion</span>
                                      <p className="text-sm mt-0.5">{clause.suggestion}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {latest.missingProtections.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" /> Missing Protections ({latest.missingProtections.length})
                          </h4>
                          <div className="space-y-2">
                            {latest.missingProtections.map((mp, idx) => (
                              <div key={idx} className={`p-3 rounded-lg border text-sm ${getRiskBg(mp.severity)}`} data-testid={`risk-missing-${idx}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant={getRiskBadgeVariant(mp.severity)} className="text-[10px] px-1.5 py-0">
                                    {mp.severity}
                                  </Badge>
                                  <span className="font-medium">{mp.title}</span>
                                  <span className="text-xs text-muted-foreground">({mp.category})</span>
                                </div>
                                <p className="text-sm text-muted-foreground">{mp.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {latest.recommendations.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Recommendations</h4>
                          <div className="space-y-2">
                            {latest.recommendations.sort((a, b) => a.priority - b.priority).map((rec, idx) => (
                              <div key={idx} className="p-3 rounded-lg border text-sm" data-testid={`risk-recommendation-${idx}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold">{rec.priority}</span>
                                  <span className="font-medium">{rec.title}</span>
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {rec.impact} Impact
                                  </Badge>
                                </div>
                                <p className="text-sm text-muted-foreground ml-7">{rec.description}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {riskAnalyses.length > 1 && (
                        <p className="text-xs text-muted-foreground">
                          {riskAnalyses.length} analyses on record. Showing most recent.
                        </p>
                      )}
                    </div>
                  );
                })()}

                {showRiskAnalysis && !runRiskAnalysisMutation.isPending && !isLoadingRisk && riskAnalyses.length === 0 && (
                  <p className="text-sm text-muted-foreground p-3 text-center" data-testid="risk-no-results">
                    No risk analysis has been run yet. Click "Run Analysis" to get started.
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showExecutionDialog} onOpenChange={setShowExecutionDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-record-execution">
          <DialogHeader>
            <DialogTitle>Record Contract Execution</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Signature Date *</Label>
              <Input type="date" value={executionForm.signatureDate} onChange={(e) => setExecutionForm(f => ({ ...f, signatureDate: e.target.value }))} data-testid="input-signature-date" />
            </div>
            <div>
              <Label>Signatory Names</Label>
              <Input value={executionForm.signatoryNames} onChange={(e) => setExecutionForm(f => ({ ...f, signatoryNames: e.target.value }))} placeholder="Names of signing parties" data-testid="input-signatory-names" />
            </div>
            <div>
              <Label>Executed Document URL</Label>
              <Input value={executionForm.executedDocumentUrl} onChange={(e) => setExecutionForm(f => ({ ...f, executedDocumentUrl: e.target.value }))} placeholder="Link to executed document" data-testid="input-executed-doc-url" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExecutionDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!executionForm.signatureDate) { toast({ title: "Error", description: "Signature date is required", variant: "destructive" }); return; }
              if (selectedContract) {
                transitionMutation.mutate({
                  id: selectedContract.id,
                  newStatus: "EXECUTED",
                  extra: {
                    signatureDate: executionForm.signatureDate,
                    signatoryNames: executionForm.signatoryNames ?? "",
                    executedDocumentUrl: executionForm.executedDocumentUrl ?? "",
                  }
                });
                setShowExecutionDialog(false);
                setExecutionForm({ signatureDate: "", signatoryNames: "", executedDocumentUrl: "" });
              }
            }} disabled={transitionMutation.isPending} data-testid="button-submit-execution">
              {transitionMutation.isPending ? "Recording..." : "Record Execution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRequestApprovalDialog} onOpenChange={setShowRequestApprovalDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-request-approval">
          <DialogHeader>
            <DialogTitle>Request Contract Approval</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Select Reviewers *</Label>
              <p className="text-xs text-muted-foreground mb-2">Choose one or more team members to review and approve this contract.</p>
              <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                {orgMembers
                  .filter(m => ["ADMIN", "MANAGER"].includes(m.role))
                  .map(m => (
                    <label key={m.id} className="flex items-center gap-2 p-1 hover:bg-muted rounded cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selectedReviewerIds.includes(m.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedReviewerIds(prev => [...prev, m.id]);
                          } else {
                            setSelectedReviewerIds(prev => prev.filter(id => id !== m.id));
                          }
                        }}
                        data-testid={`checkbox-reviewer-${m.id}`}
                      />
                      {m.firstName} {m.lastName} <span className="text-muted-foreground text-xs">({m.role})</span>
                    </label>
                  ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRequestApprovalDialog(false); setSelectedReviewerIds([]); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (selectedReviewerIds.length === 0) {
                  toast({ title: "Error", description: "Select at least one reviewer", variant: "destructive" });
                  return;
                }
                if (selectedContract) {
                  requestApprovalMutation.mutate({ contractId: selectedContract.id, reviewerIds: selectedReviewerIds });
                }
              }}
              disabled={requestApprovalMutation.isPending}
              data-testid="button-submit-request-approval"
            >
              {requestApprovalMutation.isPending ? "Requesting..." : "Request Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-edit-contract">
          <DialogHeader>
            <DialogTitle>Edit Contract</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contract Number *</Label>
                <Input value={form.contractNumber} onChange={(e) => setForm(f => ({ ...f, contractNumber: e.target.value }))} data-testid="input-edit-contract-number" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.contractType} onValueChange={(v) => setForm(f => ({ ...f, contractType: v }))}>
                  <SelectTrigger data-testid="select-edit-contract-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIME">Prime Contract</SelectItem>
                    <SelectItem value="SUBCONTRACT">Subcontract</SelectItem>
                    <SelectItem value="JV">Joint Venture</SelectItem>
                    <SelectItem value="T_AND_M">Time & Materials</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contract Value ($)</Label>
                <Input type="number" step="0.01" value={form.contractValue} onChange={(e) => setForm(f => ({ ...f, contractValue: e.target.value }))} data-testid="input-edit-contract-value" />
              </div>
              <div>
                <Label>Retention %</Label>
                <Input type="number" step="0.01" value={form.retentionPercent} onChange={(e) => setForm(f => ({ ...f, retentionPercent: e.target.value }))} data-testid="input-edit-retention" />
              </div>
            </div>
            <div>
              <Label>Parties</Label>
              <Input value={form.parties} onChange={(e) => setForm(f => ({ ...f, parties: e.target.value }))} data-testid="input-edit-parties" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Effective Date</Label>
                <Input type="date" value={form.effectiveDate} onChange={(e) => setForm(f => ({ ...f, effectiveDate: e.target.value }))} data-testid="input-edit-effective-date" />
              </div>
              <div>
                <Label>Expiration Date</Label>
                <Input type="date" value={form.expirationDate} onChange={(e) => setForm(f => ({ ...f, expirationDate: e.target.value }))} data-testid="input-edit-expiration-date" />
              </div>
            </div>
            <div>
              <Label>Payment Terms</Label>
              <Input value={form.paymentTerms} onChange={(e) => setForm(f => ({ ...f, paymentTerms: e.target.value }))} data-testid="input-edit-payment-terms" />
            </div>
            <div>
              <Label>Insurance Requirements</Label>
              <Textarea value={form.insuranceRequirements} onChange={(e) => setForm(f => ({ ...f, insuranceRequirements: e.target.value }))} data-testid="input-edit-insurance" />
            </div>
            <div>
              <Label>Scope Summary</Label>
              <Textarea value={form.scopeSummary} onChange={(e) => setForm(f => ({ ...f, scopeSummary: e.target.value }))} data-testid="input-edit-scope" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!selectedContract) return;
              editMutation.mutate({
                id: selectedContract.id,
                data: {
                  contractNumber: form.contractNumber,
                  contractType: form.contractType,
                  parties: form.parties || null,
                  contractValue: form.contractValue || null,
                  retentionPercent: form.retentionPercent || null,
                  effectiveDate: form.effectiveDate || null,
                  expirationDate: form.expirationDate || null,
                  paymentTerms: form.paymentTerms || null,
                  insuranceRequirements: form.insuranceRequirements || null,
                  scopeSummary: form.scopeSummary || null,
                },
              });
            }} disabled={editMutation.isPending} data-testid="button-submit-edit">
              {editMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRedlineDialog} onOpenChange={setShowRedlineDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-add-redline">
          <DialogHeader>
            <DialogTitle>Add Redline</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Section (optional)</Label>
              <Input value={redlineForm.section} onChange={(e) => setRedlineForm(f => ({ ...f, section: e.target.value }))} placeholder="e.g., Section 5.2" data-testid="input-redline-section" />
            </div>
            <div>
              <Label>Description *</Label>
              <Textarea value={redlineForm.description} onChange={(e) => setRedlineForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe the change request..." data-testid="input-redline-description" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRedlineDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              if (!redlineForm.description) { toast({ title: "Error", description: "Description required", variant: "destructive" }); return; }
              if (selectedContract) redlineMutation.mutate({ contractId: selectedContract.id, ...redlineForm });
            }} disabled={redlineMutation.isPending} data-testid="button-submit-redline">
              {redlineMutation.isPending ? "Adding..." : "Add Redline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-signature-request">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" /> Send for E-Signature
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Signers</Label>
              {signatureForm.signers.map((signer, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2 mb-2">
                  <Input
                    placeholder="Name"
                    value={signer.name}
                    onChange={(e) => {
                      const updated = [...signatureForm.signers];
                      updated[idx] = { ...updated[idx], name: e.target.value };
                      setSignatureForm(f => ({ ...f, signers: updated }));
                    }}
                    data-testid={`input-signer-name-${idx}`}
                  />
                  <Input
                    placeholder="Email"
                    type="email"
                    value={signer.email}
                    onChange={(e) => {
                      const updated = [...signatureForm.signers];
                      updated[idx] = { ...updated[idx], email: e.target.value };
                      setSignatureForm(f => ({ ...f, signers: updated }));
                    }}
                    data-testid={`input-signer-email-${idx}`}
                  />
                  <div className="flex gap-1">
                    <Input
                      placeholder="Role (e.g., Owner)"
                      value={signer.role}
                      onChange={(e) => {
                        const updated = [...signatureForm.signers];
                        updated[idx] = { ...updated[idx], role: e.target.value };
                        setSignatureForm(f => ({ ...f, signers: updated }));
                      }}
                      data-testid={`input-signer-role-${idx}`}
                    />
                    {signatureForm.signers.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 w-9 p-0 shrink-0"
                        onClick={() => setSignatureForm(f => ({ ...f, signers: f.signers.filter((_, i) => i !== idx) }))}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSignatureForm(f => ({ ...f, signers: [...f.signers, { name: "", email: "", role: "" }] }))}
                data-testid="button-add-signer"
              >
                <Plus className="h-3 w-3 mr-1" /> Add Signer
              </Button>
            </div>
            <div>
              <Label>Message (optional)</Label>
              <Textarea
                value={signatureForm.message}
                onChange={(e) => setSignatureForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Add a message to the signing request..."
                data-testid="input-signature-message"
              />
            </div>
            <div>
              <Label>Expires In (days)</Label>
              <Input
                type="number"
                value={signatureForm.expiresInDays}
                onChange={(e) => setSignatureForm(f => ({ ...f, expiresInDays: e.target.value }))}
                data-testid="input-signature-expires"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSignatureDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const validSigners = signatureForm.signers.filter(s => s.name && s.email && s.role);
                if (validSigners.length === 0) {
                  toast({ title: "Error", description: "Add at least one signer with name, email, and role", variant: "destructive" });
                  return;
                }
                if (selectedContract) {
                  signatureRequestMutation.mutate({
                    contractId: selectedContract.id,
                    signers: validSigners,
                    message: signatureForm.message,
                    expiresInDays: parseInt(signatureForm.expiresInDays) || 30,
                  });
                }
              }}
              disabled={signatureRequestMutation.isPending}
              data-testid="button-submit-signature-request"
            >
              <Send className="h-3 w-3 mr-1" />
              {signatureRequestMutation.isPending ? "Sending..." : "Send for Signature"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-apply-template">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-5 w-5" /> Apply Template
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Select a template to apply to this draft contract. This will populate the contract with the template's clauses, payment terms, and other defaults.</p>
            {templates.filter(t => t.isActive).map(template => (
              <div
                key={template.id}
                className="p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => {
                  if (selectedContract) {
                    applyTemplateMutation.mutate({ templateId: template.id, contractId: selectedContract.id });
                  }
                }}
                data-testid={`template-option-${template.id}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{template.name}</span>
                  <Badge variant="outline" className="text-xs">{TYPE_LABELS[template.contractType] || template.contractType}</Badge>
                </div>
                {template.description && (
                  <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                )}
              </div>
            ))}
            {applyTemplateMutation.isPending && (
              <p className="text-sm text-center text-muted-foreground">Applying template...</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
