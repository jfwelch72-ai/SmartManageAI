import { useState, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import StatusBadge from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FileUploadZone from "@/components/FileUploadZone";
import ScopeOfWorkTable from "@/components/ScopeOfWorkTable";
import ScopeProgressTracker from "@/components/ScopeProgressTracker";
import DailyNoteFeed from "@/components/DailyNoteFeed";
import MediaGallery from "@/components/MediaGallery";
import { ObjectUploader } from "@/components/ObjectUploader";
import TakeoffWorkspace from "@/components/TakeoffWorkspace";
import ProjectLaborHours from "@/components/ProjectLaborHours";
import { Building2, MapPin, User, Phone, Mail, Calendar, Plus, CheckCircle, XCircle, Clock, Upload, DollarSign, Edit, AlertTriangle, Download, Eye, FileText, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { FeaturePermissions } from "@/lib/rbac";
import { useProject, useScopeItems, useChangeOrders, useApproveChangeOrder, useRejectChangeOrder, useRequestApprovalChangeOrder, useSubmitChangeOrder, useReturnToDraftChangeOrder, useCreateChangeOrder, useProjectNotes, useProjectMedia, useProjectEstimates, useProjectProcurement, useProjectDocuments, useProjectTimeEntries, useProjectTMSheets, useProjectReceipts } from "@/hooks/use-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ChangeOrder, ScopeItem, DailyScopeProgress } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChangeOrderFiles } from "@/components/ChangeOrderFiles";
import { ChangeOrderDialog } from "@/components/ChangeOrderDialog";

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  isLoading: boolean;
  userRole: string;
}

function ChangeOrdersTab({ changeOrders, projectCode, projectId, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [changeOrderNumber, setChangeOrderNumber] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const { toast } = useToast();

  const createMutation = useCreateChangeOrder();
  const requestApprovalMutation = useRequestApprovalChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();
  const submitMutation = useSubmitChangeOrder();
  const returnToDraftMutation = useReturnToDraftChangeOrder();

  const handleCreate = async () => {
    if (!changeOrderNumber || !description || !amount) {
      toast({ title: "Error", description: "All fields are required", variant: "destructive" });
      return;
    }

    try {
      await createMutation.mutateAsync({
        projectId,
        projectCode,
        changeOrderNumber,
        description,
        amount,
      });
      toast({ title: "Success", description: "Change order created" });
      setShowCreateDialog(false);
      setChangeOrderNumber("");
      setDescription("");
      setAmount("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to create change order", variant: "destructive" });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order approved" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to approve", variant: "destructive" });
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("Rejection reason:");
    if (!reason) return;

    try {
      await rejectMutation.mutateAsync({ id, reason, projectCode });
      toast({ title: "Success", description: "Change order rejected" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to reject", variant: "destructive" });
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      await submitMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order submitted to client" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to submit", variant: "destructive" });
    }
  };

  const handleReturnToDraft = async (id: string) => {
    const reason = prompt("Reason for returning to draft (optional):");
    
    try {
      await returnToDraftMutation.mutateAsync({ id, reason: reason || undefined, projectCode });
      toast({ title: "Success", description: "Change order returned to draft" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to return to draft", variant: "destructive" });
    }
  };

  const handleRequestApproval = async (id: string) => {
    try {
      await requestApprovalMutation.mutateAsync({ id, projectCode });
      toast({ title: "Success", description: "Change order sent for approval" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to request approval", variant: "destructive" });
    }
  };

  const canManage = ["ADMIN", "MANAGER"].includes(userRole);

  return (
    <TabsContent value="change-orders">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Change Orders</CardTitle>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-change-order">
                <Plus className="w-4 h-4 mr-2" />
                New Change Order
              </Button>
            </DialogTrigger>
            <DialogContent data-testid="dialog-create-change-order">
              <DialogHeader>
                <DialogTitle>Create Change Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="co-number">Change Order Number</Label>
                  <Input
                    id="co-number"
                    value={changeOrderNumber}
                    onChange={(e) => setChangeOrderNumber(e.target.value)}
                    placeholder="CO-001"
                    data-testid="input-change-order-number"
                  />
                </div>
                <div>
                  <Label htmlFor="co-description">Description</Label>
                  <Textarea
                    id="co-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the change..."
                    data-testid="input-change-order-description"
                  />
                </div>
                <div>
                  <Label htmlFor="co-amount">Amount ($)</Label>
                  <Input
                    id="co-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="2500.00"
                    data-testid="input-change-order-amount"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter positive for additions or negative for deductions (e.g., -500 for scope reduction)
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-change-order"
                >
                  {createMutation.isPending ? "Creating..." : "Create Change Order"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : (
            <div className="space-y-3">
              {changeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          <Badge
                            variant={
                              co.status === "APPROVED" ? "default" :
                              co.status === "REJECTED" ? "destructive" :
                              co.status === "PENDING_APPROVAL" ? "destructive" :
                              "secondary"
                            }
                          >
                            {co.status?.replace("_", " ")}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedChangeOrder(co);
                              setShowViewDialog(true);
                            }}
                            data-testid={`button-view-change-order-${co.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View Details
                          </Button>
                        </div>
                        <p className="font-medium mb-1">{co.description}</p>
                        <p className="text-sm text-muted-foreground">
                          Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                        </p>
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                        
                        {/* File Attachments Section */}
                        <ChangeOrderFiles changeOrderId={co.id} />
                      </div>
                      <div className="text-right">
                        <p className={`text-xl font-bold font-mono ${parseFloat(co.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                          {parseFloat(co.amount) >= 0 ? '+' : ''}${parseFloat(co.amount).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {parseFloat(co.amount) >= 0 ? 'Addition' : 'Deduction'}
                        </p>
                        {co.status === "DRAFT" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleRequestApproval(co.id)}
                              disabled={requestApprovalMutation.isPending}
                              data-testid={`button-request-approval-${co.id}`}
                            >
                              <Clock className="w-4 h-4 mr-1" />
                              Request Approval
                            </Button>
                          </div>
                        )}
                        {canManage && co.status === "PENDING_APPROVAL" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleSubmit(co.id)}
                              disabled={submitMutation.isPending}
                              data-testid={`button-submit-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Submit to Client
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReturnToDraft(co.id)}
                              disabled={returnToDraftMutation.isPending}
                              data-testid={`button-return-draft-${co.id}`}
                            >
                              <Edit className="w-4 h-4 mr-1" />
                              Return to Draft
                            </Button>
                          </div>
                        )}
                        {canManage && co.status === "SUBMITTED" && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => handleApprove(co.id)}
                              disabled={approveMutation.isPending}
                              data-testid={`button-approve-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReject(co.id)}
                              disabled={rejectMutation.isPending}
                              data-testid={`button-reject-${co.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Order View/Edit Dialog */}
      <ChangeOrderDialog
        changeOrder={selectedChangeOrder}
        open={showViewDialog}
        onOpenChange={(open) => {
          setShowViewDialog(open);
          if (!open) setSelectedChangeOrder(null);
        }}
        projectCode={projectCode}
        userRole={userRole}
      />
    </TabsContent>
  );
}

export default function ProjectDetailPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [, params] = useRoute("/projects/:code");
  const { user, logout } = useAuth();
  const { toast } = useToast();
  
  // Check if coming from CFO dashboard
  const searchParams = new URLSearchParams(window.location.search);
  const fromCFO = searchParams.get('from') === 'cfo';
  const backPath = fromCFO ? '/cfo' : '/projects';
  const backLabel = fromCFO ? 'Back to CFO' : 'Back to Projects';
  
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const { data: scopeItems = [], isLoading: scopeLoading } = useScopeItems(projectCode);
  const { data: changeOrders = [], isLoading: changeOrdersLoading } = useChangeOrders(projectCode);
  const { data: projectNotes = [], isLoading: notesLoading } = useProjectNotes(projectCode);
  const { data: mediaItems = [], isLoading: mediaLoading } = useProjectMedia(projectCode);
  const { data: estimates = [], isLoading: estimatesLoading } = useProjectEstimates(projectCode);
  const { data: procurementItems = [], isLoading: procurementLoading } = useProjectProcurement(projectCode);
  const { data: documents = [], isLoading: documentsLoading } = useProjectDocuments(projectCode);
  const { data: timeEntries = [], isLoading: timeEntriesLoading} = useProjectTimeEntries(projectCode);
  const { data: tmSheets = [], isLoading: tmSheetsLoading } = useProjectTMSheets(projectCode);
  const { data: receipts = [], isLoading: receiptsLoading } = useProjectReceipts(projectCode);

  // Subcontractor contracts query
  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Array<{
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
    startDate: string | null;
    completionDate: string | null;
    status: string;
    paymentTerms: string | null;
    retentionPercent: string | null;
    notes: string | null;
    createdAt: string;
    subcontractor: {
      id: string;
      companyName: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }>>({
    queryKey: ["/api/projects", projectCode, "subcontractors"],
    enabled: !!projectCode,
  });

  // Query all users for daily notes filter
  const { data: allUsers = [] } = useQuery<Array<{
    id: string;
    firstName: string;
    lastName: string;
  }>>({
    queryKey: ["/api/users"],
  });

  // Subcontractor payables query (for payment tracking on this project)
  const { data: allPayables = [] } = useQuery<Array<{
    paymentId: string;
    amount: string;
    status: string;
    remainingBalance: string;
    contract: {
      id: string;
      contractAmount: string;
    };
    project: {
      code: string;
    };
  }>>({
    queryKey: ["/api/subcontractor-payables"],
    enabled: !!projectCode,
  });

  // Filter payables for this project and aggregate by contract
  const payablesByContract = useMemo(() => {
    const filtered = allPayables.filter(p => p.project.code === projectCode);
    const grouped = new Map<string, { totalPaid: number; remainingBalance: number }>();
    
    filtered.forEach(payable => {
      const contractId = payable.contract.id;
      if (!grouped.has(contractId)) {
        grouped.set(contractId, { totalPaid: 0, remainingBalance: parseFloat(payable.remainingBalance) });
      }
      const current = grouped.get(contractId)!;
      if (payable.status === 'PAID') {
        current.totalPaid += parseFloat(payable.amount);
      }
    });
    
    return grouped;
  }, [allPayables, projectCode]);

  // Data quality score query
  const { data: dataQuality, isLoading: dataQualityLoading } = useQuery<{
    overall_score: number;
    has_scope: boolean;
    has_estimates: boolean;
    has_budget: boolean;
    has_timeline: boolean;
    has_daily_updates: boolean;
    has_cost_tracking: boolean;
    has_media: boolean;
    has_documentation: boolean;
    has_change_orders_managed: boolean;
    has_billing_setup: boolean;
  }>({
    queryKey: ["/api/projects", projectCode, "data-quality"],
    enabled: !!projectCode,
  });

  // Media upload state
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  const [mediaType, setMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaCaption, setMediaCaption] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  // Documents upload state
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [documentTitle, setDocumentTitle] = useState("");
  const [documentType, setDocumentType] = useState<"PLANS" | "SPECS" | "TAKEOFF" | "OTHER">("OTHER");
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);

  // Receipts upload state
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptVendor, setReceiptVendor] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptCategory, setReceiptCategory] = useState("");
  const [receiptDate, setReceiptDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);

  // Budget edit state (admin only)
  const [showBudgetEditDialog, setShowBudgetEditDialog] = useState(false);
  const [editBudget, setEditBudget] = useState("");
  const [editContractAmount, setEditContractAmount] = useState("");
  const [editTexturaDrawDate, setEditTexturaDrawDate] = useState("");
  const [editDrawDayOfMonth, setEditDrawDayOfMonth] = useState<number | "">("");
  const [plansSubTab, setPlansSubTab] = useState<"takeoff" | "documents">("documents");

  // Upload handlers
  const handleMediaUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingMedia(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", `/api/projects/${projectCode}/media`, {
        type: mediaType,
        caption: mediaCaption,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "media"] });
      toast({ title: "Success", description: "Media uploaded successfully" });
      setShowMediaDialog(false);
      setMediaCaption("");
      setMediaType("IMAGE");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save media", variant: "destructive" });
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleDocumentUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingDocument(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/documents", {
        projectId: project?.id,
        title: documentTitle,
        type: documentType,
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "documents"] });
      toast({ title: "Success", description: "Document uploaded successfully" });
      setShowDocumentDialog(false);
      setDocumentTitle("");
      setDocumentType("OTHER");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save document", variant: "destructive" });
    } finally {
      setIsUploadingDocument(false);
    }
  };

  const handleBudgetUpdate = async () => {
    if (!editBudget || !editContractAmount) {
      toast({ title: "Error", description: "Budget and contract amount are required", variant: "destructive" });
      return;
    }

    try {
      const payload: any = {
        budget: editBudget,
        contractAmount: editContractAmount,
      };
      
      if (editTexturaDrawDate) {
        payload.texturaDrawDate = editTexturaDrawDate;
      }

      if (editDrawDayOfMonth !== "") {
        payload.drawDayOfMonth = editDrawDayOfMonth;
      }

      await apiRequest("PATCH", `/api/projects/${projectCode}/financials`, payload);
      
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode] });
      toast({ title: "Success", description: "Financial data updated" });
      setShowBudgetEditDialog(false);
    } catch (error) {
      toast({ title: "Error", description: "Failed to update financial data", variant: "destructive" });
    }
  };

  const handleReceiptUploadComplete = async (result: any) => {
    if (!result.successful || result.successful.length === 0) {
      toast({ title: "Error", description: "File upload failed", variant: "destructive" });
      setIsUploadingReceipt(false);
      return;
    }

    const uploadedFile = result.successful[0];
    const fileUrl = uploadedFile.uploadURL;
    const fileName = uploadedFile.name;
    const fileSize = uploadedFile.size;
    const mimeType = uploadedFile.type;

    try {
      await apiRequest("POST", "/api/receipts", {
        projectId: project?.id,
        vendor: receiptVendor,
        amount: receiptAmount,
        category: receiptCategory,
        date: new Date(receiptDate).toISOString(),
        fileUrl,
        fileName,
        fileSize,
        mimeType,
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "receipts"] });
      toast({ title: "Success", description: "Receipt uploaded successfully" });
      setShowReceiptDialog(false);
      setReceiptVendor("");
      setReceiptAmount("");
      setReceiptCategory("");
      setReceiptDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to save receipt", variant: "destructive" });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const getUploadParameters = async () => {
    try {
      const response = await apiRequest("POST", "/api/objects/upload");
      const data = await response.json();
      return {
        method: "PUT" as const,
        url: data.uploadURL,
      };
    } catch (error) {
      toast({ title: "Error", description: "Failed to get upload URL", variant: "destructive" });
      throw error;
    }
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={user?.firstName || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex flex-col items-center justify-center h-96">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <Button onClick={() => setLocation(backPath)} data-testid="button-back-to-projects">
            {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={user?.firstName || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Button variant="ghost" onClick={() => setLocation(backPath)} data-testid="button-back">
              ← {backLabel}
            </Button>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="font-mono">
                  {project.code}
                </Badge>
                <StatusBadge status={project.status} type="project" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
            </div>
          </div>
        </div>

        {FeaturePermissions.VIEW_PROJECT_BUDGET(user?.role) && (!project.budget || Number(project.budget) === 0) && (!project.contractAmount || Number(project.contractAmount) === 0) && (
          <Alert variant="destructive" className="mb-6" data-testid="alert-missing-budget">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Missing Financial Data</AlertTitle>
            <AlertDescription>
              This project is missing budget and contract information. Please update the financial data to enable accurate profitability tracking and AI analysis.
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="scope" data-testid="tab-scope">Scope & Progress</TabsTrigger>
            <TabsTrigger value="change-orders" data-testid="tab-change-orders">
              Change Orders
              {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length > 0 && (
                <Badge className="ml-2" variant="destructive">
                  {changeOrders.filter(co => co.status === "PENDING_APPROVAL").length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="daily-notes" data-testid="tab-daily-notes">Daily Notes</TabsTrigger>
            <TabsTrigger value="media" data-testid="tab-media">Photos & Videos</TabsTrigger>
            {FeaturePermissions.VIEW_ESTIMATES_TAB(user?.role) && (
              <TabsTrigger value="estimate" data-testid="tab-estimate">Estimate</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_PROCUREMENT_TAB(user?.role) && (
              <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
            )}
            <TabsTrigger value="plans" data-testid="tab-plans">Plans & Takeoff</TabsTrigger>
            {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
              <TabsTrigger value="time" data-testid="tab-time">Time & T&M</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_TIME_ENTRIES_TAB(user?.role) && (
              <TabsTrigger value="labor-hours" data-testid="tab-labor-hours">Labor Hours</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_RECEIPTS_TAB(user?.role) && (
              <TabsTrigger value="receipts" data-testid="tab-receipts">Receipts</TabsTrigger>
            )}
            {FeaturePermissions.VIEW_SUBCONTRACTORS_TAB(user?.role) && (
              <TabsTrigger value="subcontractors" data-testid="tab-subcontractors">Subcontractors</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Project Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Client</p>
                      <p className="text-sm text-muted-foreground">{project.clientName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Contact</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactName || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Mail className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactEmail || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Phone className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Phone</p>
                      <p className="text-sm text-muted-foreground">{project.clientContactPhone || "N/A"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Location</p>
                      <p className="text-sm text-muted-foreground">
                        {[project.locationAddress, project.city, project.state].filter(Boolean).join(", ") || "N/A"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Project Team & Timeline</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Start Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.startDate ? format(new Date(project.startDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">Target End Date</p>
                    <p className="text-sm text-muted-foreground">
                      {project.endDate ? format(new Date(project.endDate), "MMM d, yyyy") : "Not set"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Financial Information - Hidden from hourly employees */}
            {FeaturePermissions.VIEW_PROJECT_FINANCIALS(user?.role) && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-4">
                  <CardTitle>Financial Information</CardTitle>
                  {(user?.role === "ADMIN" || user?.role === "OFFICE_MANAGER") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditBudget(project.budget || "0");
                        setEditContractAmount(project.contractAmount || "0");
                        setEditTexturaDrawDate(project.texturaDrawDate || "");
                        setEditDrawDayOfMonth(project.drawDayOfMonth || "");
                        setShowBudgetEditDialog(true);
                      }}
                      data-testid="button-edit-financials"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Project Budget</p>
                      <p className="text-2xl font-bold font-mono">
                        ${parseFloat(project.budget || "0").toLocaleString()}
                      </p>
                      {(!project.budget || parseFloat(project.budget) === 0) && (
                        <p className="text-xs text-destructive mt-1">⚠ Missing budget data</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Original Contract Amount</p>
                      <p className="text-2xl font-bold font-mono">
                        ${parseFloat(project.contractAmount || "0").toLocaleString()}
                      </p>
                      {(!project.contractAmount || parseFloat(project.contractAmount) === 0) && (
                        <p className="text-xs text-destructive mt-1">⚠ Missing contract data</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-primary mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Adjusted Contract Amount</p>
                      <p className="text-2xl font-bold font-mono text-primary" data-testid="text-adjusted-contract-amount">
                        ${(() => {
                          const originalAmount = parseFloat(project.contractAmount || "0");
                          const approvedChangeOrders = changeOrders?.filter(co => co.status === "APPROVED") || [];
                          const changeOrderTotal = approvedChangeOrders.reduce((sum, co) => sum + parseFloat(co.amount), 0);
                          return (originalAmount + changeOrderTotal).toLocaleString();
                        })()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {(() => {
                          const approvedChangeOrders = changeOrders?.filter(co => co.status === "APPROVED") || [];
                          const changeOrderTotal = approvedChangeOrders.reduce((sum, co) => sum + parseFloat(co.amount), 0);
                          const additions = approvedChangeOrders.filter(co => parseFloat(co.amount) > 0).length;
                          const deductions = approvedChangeOrders.filter(co => parseFloat(co.amount) < 0).length;
                          if (approvedChangeOrders.length === 0) {
                            return "No approved change orders";
                          }
                          return `Includes ${approvedChangeOrders.length} approved change order${approvedChangeOrders.length > 1 ? 's' : ''} (${additions > 0 ? `${additions} addition${additions > 1 ? 's' : ''}` : ''}${additions > 0 && deductions > 0 ? ', ' : ''}${deductions > 0 ? `${deductions} deduction${deductions > 1 ? 's' : ''}` : ''}) totaling ${changeOrderTotal >= 0 ? '+' : ''}$${changeOrderTotal.toLocaleString()}`;
                        })()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{project.description || "No description provided"}</p>
              </CardContent>
            </Card>

            {/* Data Quality Score Card */}
            <Card data-testid="card-data-quality">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>Data Quality Score</span>
                {dataQuality && (
                  <Badge 
                    className={
                      dataQuality.overall_score >= 80 
                        ? "bg-green-500 hover:bg-green-600" 
                        : dataQuality.overall_score >= 60 
                        ? "bg-yellow-500 hover:bg-yellow-600" 
                        : "bg-red-500 hover:bg-red-600"
                    }
                    data-testid="badge-overall-score"
                  >
                    {dataQuality.overall_score}/100
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Track data completeness to improve AI insights and project management
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataQualityLoading ? (
                <div className="text-center py-4 text-muted-foreground">Loading data quality score...</div>
              ) : !dataQuality ? (
                <div className="text-center py-4 text-muted-foreground">Unable to load data quality score</div>
              ) : (
                <div className="space-y-3">
                  {/* Progress bar */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Overall Quality</span>
                      <span className="font-medium">{dataQuality.overall_score}%</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          dataQuality.overall_score >= 80
                            ? "bg-green-500"
                            : dataQuality.overall_score >= 60
                            ? "bg-yellow-500"
                            : "bg-red-500"
                        }`}
                        style={{ width: `${dataQuality.overall_score}%` }}
                      />
                    </div>
                  </div>

                  {/* Quality dimensions */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      {dataQuality.has_scope ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Scope
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Scope
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_estimates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Estimates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Estimates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_budget ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Budget
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Budget
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_timeline ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Timeline
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Timeline
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_daily_updates ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Daily Updates
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Daily Updates
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_cost_tracking ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Cost Tracking
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Cost Tracking
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_media ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Media
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Media
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_documentation ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Documentation
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Documentation
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_change_orders_managed ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Change Orders
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Change Orders
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {dataQuality.has_billing_setup ? (
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200">
                          ✓ Billing Setup
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200">
                          ✗ Billing Setup
                        </Badge>
                      )}
                    </div>
                  </div>

                  {dataQuality.overall_score < 80 && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-sm font-medium mb-1">Improve Data Quality</p>
                      <p className="text-xs text-muted-foreground">
                        Complete missing sections to enhance AI insights and project tracking accuracy.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            </Card>

            {/* Change Orders Summary */}
            <Card data-testid="card-change-orders-summary">
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div>
                  <CardTitle>Change Orders</CardTitle>
                  <CardDescription>Track status and value of project change orders</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setActiveTab("change-orders")}
                  data-testid="button-view-all-change-orders"
                >
                  View All
                </Button>
              </CardHeader>
              <CardContent>
                {changeOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No change orders yet</p>
                ) : (
                  <div className="space-y-3">
                    {changeOrders.slice(0, 5).map((co) => (
                      <div 
                        key={co.id} 
                        className="flex items-center justify-between gap-4 p-3 rounded-md border hover-elevate active-elevate-2 cursor-pointer"
                        onClick={() => setActiveTab("change-orders")}
                        data-testid={`change-order-summary-${co.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-mono text-xs">
                              {co.changeOrderNumber}
                            </Badge>
                            <Badge
                              variant={
                                co.status === "APPROVED" ? "default" :
                                co.status === "REJECTED" ? "destructive" :
                                co.status === "PENDING_APPROVAL" ? "destructive" :
                                co.status === "SUBMITTED" ? "secondary" :
                                "outline"
                              }
                              className="text-xs"
                            >
                              {co.status?.replace("_", " ")}
                            </Badge>
                          </div>
                          <p className="text-sm font-medium truncate">{co.description}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {format(new Date(co.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(co.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                    {changeOrders.length > 5 && (
                      <p className="text-xs text-muted-foreground text-center pt-2">
                        + {changeOrders.length - 5} more change order{changeOrders.length - 5 !== 1 ? 's' : ''}
                      </p>
                    )}
                    <div className="pt-3 border-t mt-3 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Total Value</p>
                        <p className="text-xl font-bold font-mono">
                          ${changeOrders.reduce((sum, co) => sum + parseFloat(co.amount), 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Approved Value</p>
                        <p className="text-xl font-bold font-mono text-green-600">
                          ${changeOrders
                            .filter(co => co.status === "APPROVED")
                            .reduce((sum, co) => sum + parseFloat(co.amount), 0)
                            .toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scope">
            <Card>
              <CardHeader>
                <CardTitle>Scope of Work & Progress Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ScopeProgressTracker scopeItems={scopeItems} isLoading={scopeLoading} projectCode={projectCode} />
              </CardContent>
            </Card>
          </TabsContent>

          <ChangeOrdersTab 
            changeOrders={changeOrders}
            projectCode={projectCode}
            projectId={project.id}
            isLoading={changeOrdersLoading}
            userRole={user?.role || ""}
          />

          <TabsContent value="daily-notes">
            <DailyNoteFeed projectId={project.id} availableUsers={allUsers} />
          </TabsContent>

          <TabsContent value="media">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Photos & Videos</CardTitle>
                <Dialog open={showMediaDialog} onOpenChange={setShowMediaDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-media">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Media
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-media">
                    <DialogHeader>
                      <DialogTitle>Upload Media</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="media-type">Type</Label>
                        <Select
                          value={mediaType}
                          onValueChange={(value: "IMAGE" | "VIDEO") => setMediaType(value)}
                        >
                          <SelectTrigger id="media-type" data-testid="select-media-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="IMAGE">Image</SelectItem>
                            <SelectItem value="VIDEO">Video</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="media-caption">Caption (Optional)</Label>
                        <Input
                          id="media-caption"
                          value={mediaCaption}
                          onChange={(e) => setMediaCaption(e.target.value)}
                          placeholder="Enter a caption..."
                          data-testid="input-media-caption"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowMediaDialog(false);
                          setMediaCaption("");
                          setMediaType("IMAGE");
                        }}
                        data-testid="button-cancel-media"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={mediaType === "IMAGE" ? ["image/*"] : ["video/*"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingMedia(true);
                          handleMediaUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-media-file"
                      >
                        {isUploadingMedia ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {mediaLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading media...</div>
                ) : mediaItems.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No media uploaded yet</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {mediaItems.map((item) => (
                      <Card key={item.id} data-testid={`media-${item.id}`}>
                        <CardContent className="p-4">
                          <Badge variant="outline" className="mb-2">{item.type}</Badge>
                          <p className="text-sm font-medium mb-1">{item.caption || "Untitled"}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.uploadedAt), "MMM d, yyyy")}
                          </p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="estimate">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Estimates</CardTitle>
                <Button size="sm" data-testid="button-new-estimate">
                  <Plus className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>
              </CardHeader>
              <CardContent>
                {estimatesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading estimates...</div>
                ) : estimates.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No estimates yet</div>
                ) : (
                  <div className="space-y-4">
                    {estimates.map(estimate => (
                      <div key={estimate.id} className="flex items-center justify-between p-4 border rounded-md hover-elevate" data-testid={`estimate-${estimate.id}`}>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">Version {estimate.versionNumber}</span>
                            <Badge variant={estimate.status === "WON" ? "default" : "secondary"}>
                              {estimate.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(estimate.createdAt), "MMM d, yyyy")}
                          </p>
                          {estimate.notes && (
                            <p className="text-xs text-muted-foreground mt-1">{estimate.notes}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold font-mono">
                            {estimate.baseBidAmount ? `$${parseFloat(estimate.baseBidAmount).toLocaleString()}` : "TBD"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="procurement">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Procurement Items</CardTitle>
                <Button size="sm" data-testid="button-new-procurement">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Item
                </Button>
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
          </TabsContent>

          <TabsContent value="plans" className="space-y-0">
            <div className="border-b mb-4">
              <div className="flex gap-2">
                <Button
                  variant={plansSubTab === "documents" ? "default" : "ghost"}
                  onClick={() => setPlansSubTab("documents")}
                  data-testid="tab-documents"
                  className="rounded-b-none"
                >
                  Documents
                </Button>
                <Button
                  variant={plansSubTab === "takeoff" ? "default" : "ghost"}
                  onClick={() => setPlansSubTab("takeoff")}
                  data-testid="tab-takeoff-workspace"
                  className="rounded-b-none"
                >
                  Takeoff Workspace
                </Button>
              </div>
            </div>
            
            {plansSubTab === "documents" && (
              <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4">
                    <CardTitle>Documents</CardTitle>
                    <Dialog open={showDocumentDialog} onOpenChange={setShowDocumentDialog}>
                      <DialogTrigger asChild>
                        <Button size="sm" data-testid="button-upload-document">
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Document
                        </Button>
                      </DialogTrigger>
                      <DialogContent data-testid="dialog-upload-document">
                        <DialogHeader>
                          <DialogTitle>Upload Document</DialogTitle>
                          <DialogDescription>
                            Fill in the details below and then select a file to upload.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="document-title">Title</Label>
                            <Input
                              id="document-title"
                              value={documentTitle}
                              onChange={(e) => setDocumentTitle(e.target.value)}
                              placeholder="Enter document title..."
                              data-testid="input-document-title"
                            />
                          </div>
                          <div>
                            <Label htmlFor="document-type">Type</Label>
                            <Select
                              value={documentType}
                              onValueChange={(value: "PLANS" | "SPECS" | "TAKEOFF" | "OTHER") => setDocumentType(value)}
                            >
                              <SelectTrigger id="document-type" data-testid="select-document-type">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="PLANS">Plans</SelectItem>
                                <SelectItem value="SPECS">Specifications</SelectItem>
                                <SelectItem value="TAKEOFF">Takeoff</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowDocumentDialog(false);
                              setDocumentTitle("");
                              setDocumentType("OTHER");
                            }}
                            data-testid="button-cancel-document"
                          >
                            Cancel
                          </Button>
                          <ObjectUploader
                            maxNumberOfFiles={1}
                            maxFileSize={104857600}
                            onGetUploadParameters={getUploadParameters}
                            onComplete={(result) => {
                              setIsUploadingDocument(true);
                              handleDocumentUploadComplete(result);
                            }}
                            buttonVariant="default"
                            testId="button-select-document-file"
                          >
                            {isUploadingDocument ? "Uploading..." : "Select File"}
                          </ObjectUploader>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardHeader>
                  <CardContent>
                    {documentsLoading ? (
                      <div className="text-center py-8 text-muted-foreground">Loading documents...</div>
                    ) : documents.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">No documents uploaded yet</div>
                    ) : (
                      <div className="space-y-2">
                        {documents.map(doc => (
                          <div key={doc.id} className="flex items-center justify-between p-3 border rounded-md hover-elevate gap-4" data-testid={`document-${doc.id}`}>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{doc.title || doc.fileName}</p>
                              <p className="text-xs text-muted-foreground">
                                Uploaded {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            <Badge variant="outline">{doc.type}</Badge>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(doc.fileUrl, '_blank')}
                                data-testid={`button-view-document-${doc.id}`}
                              >
                                <Eye className="w-4 h-4 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = doc.fileUrl;
                                  link.download = doc.fileName;
                                  document.body.appendChild(link);
                                  link.click();
                                  document.body.removeChild(link);
                                }}
                                data-testid={`button-download-document-${doc.id}`}
                              >
                                <Download className="w-4 h-4 mr-1" />
                                Download
                              </Button>
                              {doc.mimeType === 'application/pdf' && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={async () => {
                                    try {
                                      await apiRequest("POST", `/api/projects/${project!.id}/takeoff/import-plan`, { documentId: doc.id });
                                      toast({ title: "Success", description: "Plan imported to takeoff workspace" });
                                      await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                      await queryClient.refetchQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                    } catch (error: any) {
                                      const errorMessage = error?.message || error?.error || "Failed to import plan";
                                      toast({ title: "Error", description: errorMessage, variant: "destructive" });
                                    }
                                  }}
                                  data-testid={`button-import-takeoff-${doc.id}`}
                                >
                                  <FileText className="w-4 h-4 mr-1" />
                                  Import to Takeoff
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    data-testid={`button-delete-document-${doc.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    Delete
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent data-testid={`dialog-delete-confirm-${doc.id}`}>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Document</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "{doc.title || doc.fileName}"? This action cannot be undone and will also remove any takeoff sheets associated with this document.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-delete-${doc.id}`}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={async () => {
                                        try {
                                          await apiRequest("DELETE", `/api/documents/${doc.id}`);
                                          toast({ title: "Success", description: "Document deleted successfully" });
                                          await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.code, "documents"] });
                                          await queryClient.invalidateQueries({ queryKey: ["/api/projects", project!.id, "takeoff", "sheets"] });
                                        } catch (error: any) {
                                          const errorMessage = error?.message || error?.error || "Failed to delete document";
                                          toast({ title: "Error", description: errorMessage, variant: "destructive" });
                                        }
                                      }}
                                      data-testid={`button-confirm-delete-${doc.id}`}
                                      className="bg-destructive hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
            )}
            
            {plansSubTab === "takeoff" && project && (
              <div className="h-[calc(100vh-200px)]">
                <TakeoffWorkspace projectId={project.id} projectCode={project.code} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="time">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Time & Material Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Time Entries</h3>
                    {timeEntriesLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading time entries...</div>
                    ) : timeEntries.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No time entries yet</div>
                    ) : (
                      <div className="space-y-2">
                        {timeEntries.map((entry) => {
                          const totalHours = parseFloat(entry.hoursRegular) + parseFloat(entry.hoursOvertime || "0");
                          return (
                            <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`time-entry-${entry.id}`}>
                              <div>
                                <p className="text-sm font-medium">{format(new Date(entry.date), "MMM d, yyyy")}</p>
                                {entry.notes && (
                                  <p className="text-xs text-muted-foreground">{entry.notes}</p>
                                )}
                                {entry.costCode && (
                                  <p className="text-xs text-muted-foreground">Cost Code: {entry.costCode}</p>
                                )}
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-sm">{totalHours} hours</p>
                                <Badge variant={entry.approvedAt ? "default" : "secondary"}>
                                  {entry.approvedAt ? "Approved" : "Pending"}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold mb-3">T&M Daily Sheets</h3>
                    {tmSheetsLoading ? (
                      <div className="text-center py-4 text-muted-foreground">Loading T&M sheets...</div>
                    ) : tmSheets.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">No T&M sheets yet</div>
                    ) : (
                      <div className="space-y-2">
                        {tmSheets.map((sheet) => (
                          <div key={sheet.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`tm-sheet-${sheet.id}`}>
                            <div>
                              <p className="text-sm font-medium">{format(new Date(sheet.date), "MMM d, yyyy")}</p>
                              <p className="text-xs text-muted-foreground">TFR Rep: {sheet.tfrRepName}</p>
                              {sheet.clientRepName && (
                                <p className="text-xs text-muted-foreground">Client Rep: {sheet.clientRepName}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="labor-hours">
            {project && <ProjectLaborHours projectId={project.id} projectCode={project.code} />}
          </TabsContent>

          <TabsContent value="receipts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle>Receipts</CardTitle>
                <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-upload-receipt">
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Receipt
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-upload-receipt">
                    <DialogHeader>
                      <DialogTitle>Upload Receipt</DialogTitle>
                      <DialogDescription>
                        Fill in the details below and then select a file to upload.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="receipt-vendor">Vendor</Label>
                        <Input
                          id="receipt-vendor"
                          value={receiptVendor}
                          onChange={(e) => setReceiptVendor(e.target.value)}
                          placeholder="Enter vendor name..."
                          data-testid="input-receipt-vendor"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-amount">Amount ($)</Label>
                        <Input
                          id="receipt-amount"
                          type="number"
                          step="0.01"
                          value={receiptAmount}
                          onChange={(e) => setReceiptAmount(e.target.value)}
                          placeholder="0.00"
                          data-testid="input-receipt-amount"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-category">Category</Label>
                        <Input
                          id="receipt-category"
                          value={receiptCategory}
                          onChange={(e) => setReceiptCategory(e.target.value)}
                          placeholder="Enter category..."
                          data-testid="input-receipt-category"
                        />
                      </div>
                      <div>
                        <Label htmlFor="receipt-date">Date</Label>
                        <Input
                          id="receipt-date"
                          type="date"
                          value={receiptDate}
                          onChange={(e) => setReceiptDate(e.target.value)}
                          data-testid="input-receipt-date"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowReceiptDialog(false);
                          setReceiptVendor("");
                          setReceiptAmount("");
                          setReceiptCategory("");
                          setReceiptDate(format(new Date(), "yyyy-MM-dd"));
                        }}
                        data-testid="button-cancel-receipt"
                      >
                        Cancel
                      </Button>
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={104857600}
                        allowedFileTypes={["image/*", "application/pdf"]}
                        onGetUploadParameters={getUploadParameters}
                        onComplete={(result) => {
                          setIsUploadingReceipt(true);
                          handleReceiptUploadComplete(result);
                        }}
                        buttonVariant="default"
                        testId="button-select-receipt-file"
                      >
                        {isUploadingReceipt ? "Uploading..." : "Select File"}
                      </ObjectUploader>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {receiptsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading receipts...</div>
                ) : receipts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No receipts uploaded yet</div>
                ) : (
                  <div className="space-y-3">
                    {receipts.map((receipt) => (
                      <div key={receipt.id} className="flex items-center justify-between p-4 border rounded-md" data-testid={`receipt-${receipt.id}`}>
                        <div className="flex-1">
                          <p className="font-medium mb-1">{receipt.vendor || "Unknown vendor"}</p>
                          <p className="text-sm text-muted-foreground">{receipt.category}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(receipt.date), "MMM d, yyyy")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(receipt.amount).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subcontractors">
            <Card>
              <CardHeader>
                <CardTitle>Subcontractors & Contracts</CardTitle>
              </CardHeader>
              <CardContent>
                {subcontractorsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading subcontractors...</div>
                ) : subcontractors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No subcontractor contracts yet</div>
                ) : (
                  <div className="space-y-4">
                    {subcontractors.map((contract) => (
                      <Card key={contract.id} data-testid={`subcontractor-${contract.id}`}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <CardTitle className="text-base">
                                  {contract.subcontractor?.companyName || "Unknown Subcontractor"}
                                </CardTitle>
                                <Badge variant={
                                  contract.status === "ACTIVE" ? "default" :
                                  contract.status === "COMPLETED" ? "outline" :
                                  "secondary"
                                }>
                                  {contract.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-1">
                                Contract #{contract.contractNumber}
                              </p>
                              {contract.subcontractor?.contactName && (
                                <p className="text-xs text-muted-foreground">
                                  Contact: {contract.subcontractor.contactName}
                                  {contract.subcontractor.phone && ` • ${contract.subcontractor.phone}`}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-xl font-bold font-mono">
                                ${parseFloat(contract.contractAmount).toLocaleString()}
                              </p>
                              {contract.retentionPercent && (
                                <p className="text-xs text-muted-foreground">
                                  {contract.retentionPercent}% retention
                                </p>
                              )}
                              {payablesByContract.has(contract.id) && (
                                <div className="mt-2 text-sm">
                                  <p className="text-green-600 dark:text-green-500">
                                    Paid: ${payablesByContract.get(contract.id)!.totalPaid.toLocaleString()}
                                  </p>
                                  <p className={`${payablesByContract.get(contract.id)!.remainingBalance > 0 ? 'text-yellow-600 dark:text-yellow-500' : 'text-muted-foreground'}`}>
                                    Balance: ${payablesByContract.get(contract.id)!.remainingBalance.toLocaleString()}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <div>
                            <p className="text-sm font-medium mb-1">Scope of Work</p>
                            <p className="text-sm text-muted-foreground">{contract.scopeOfWork}</p>
                          </div>
                          
                          {(contract.startDate || contract.completionDate) && (
                            <div className="flex items-center gap-4 text-sm">
                              {contract.startDate && (
                                <div>
                                  <span className="text-muted-foreground">Start: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.startDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                              {contract.completionDate && (
                                <div>
                                  <span className="text-muted-foreground">Completion: </span>
                                  <span className="font-medium">
                                    {format(new Date(contract.completionDate), "MMM d, yyyy")}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {contract.paymentTerms && (
                            <div>
                              <p className="text-sm font-medium mb-1">Payment Terms</p>
                              <p className="text-sm text-muted-foreground">{contract.paymentTerms}</p>
                            </div>
                          )}

                          {contract.notes && (
                            <div>
                              <p className="text-sm font-medium mb-1">Notes</p>
                              <p className="text-sm text-muted-foreground">{contract.notes}</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Budget Edit Dialog (Admin Only) */}
        <Dialog open={showBudgetEditDialog} onOpenChange={setShowBudgetEditDialog}>
          <DialogContent data-testid="dialog-edit-budget">
            <DialogHeader>
              <DialogTitle>Edit Financial Data</DialogTitle>
              <DialogDescription>
                Update the project budget and contract amount. This data is used for profitability analysis.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-budget">Project Budget ($)</Label>
                <Input
                  id="edit-budget"
                  type="number"
                  step="0.01"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-budget"
                />
              </div>
              <div>
                <Label htmlFor="edit-contract">Contract Amount ($)</Label>
                <Input
                  id="edit-contract"
                  type="number"
                  step="0.01"
                  value={editContractAmount}
                  onChange={(e) => setEditContractAmount(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-edit-contract"
                />
              </div>
              <div>
                <Label htmlFor="edit-textura-draw-date">Textura Draw Date (Optional Override)</Label>
                <Input
                  id="edit-textura-draw-date"
                  type="date"
                  value={editTexturaDrawDate}
                  onChange={(e) => setEditTexturaDrawDate(e.target.value)}
                  placeholder="YYYY-MM-DD"
                  data-testid="input-edit-textura-draw-date"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use this to override the recurring draw schedule for a specific month
                </p>
              </div>
              <div>
                <Label htmlFor="edit-draw-day-of-month">Recurring Draw Day of Month</Label>
                <Select 
                  value={editDrawDayOfMonth === "" ? "none" : String(editDrawDayOfMonth)}
                  onValueChange={(value) => setEditDrawDayOfMonth(value === "none" ? "" : parseInt(value))}
                >
                  <SelectTrigger id="edit-draw-day-of-month" data-testid="select-draw-day-of-month">
                    <SelectValue placeholder="Select day of month" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No recurring draw</SelectItem>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={String(day)}>
                        {day}{day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of each month
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Set the day each month when Textura draws are due (e.g., 1st, 15th, 30th)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowBudgetEditDialog(false)}
                data-testid="button-cancel-budget-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleBudgetUpdate}
                data-testid="button-save-budget"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
