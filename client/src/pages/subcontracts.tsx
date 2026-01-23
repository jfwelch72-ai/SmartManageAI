import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  FileSignature, 
  Plus, 
  Eye, 
  Download,
  CheckCircle2,
  Clock,
  XCircle,
  DollarSign,
  Calendar,
  Building2,
  Edit,
  Trash2,
  FileText,
  AlertTriangle,
  Users
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";

interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
}

interface Subcontractor {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}

interface SubcontractorContract {
  id: string;
  projectId: string;
  subcontractorId: string;
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
  updatedAt: string | null;
  createdByName: string | null;
  project: {
    code: string;
    name: string;
  };
  subcontractor: Subcontractor;
}

export default function SubcontractsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedContract, setSelectedContract] = useState<SubcontractorContract | null>(null);

  const [createForm, setCreateForm] = useState({
    projectId: "",
    subcontractorId: "",
    scopeOfWork: "",
    contractAmount: "",
    startDate: "",
    completionDate: "",
    paymentTerms: "",
    retentionPercent: "",
    notes: ""
  });

  const { data: projects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/subcontracts/projects"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const { data: subcontractors = [], isLoading: loadingSubs } = useQuery<Subcontractor[]>({
    queryKey: ["/api/subcontracts/subcontractors"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const { data: contracts = [], isLoading: loadingContracts } = useQuery<SubcontractorContract[]>({
    queryKey: ["/api/subcontracts"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)
  });

  const createContractMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      return await apiRequest("POST", "/api/subcontracts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts"] });
      toast({ title: "Subcontract created successfully" });
      setShowCreateDialog(false);
      resetCreateForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to create subcontract", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const updateContractMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof createForm> }) => {
      return await apiRequest("PATCH", `/api/subcontracts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts"] });
      toast({ title: "Subcontract updated" });
      setShowEditDialog(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to update subcontract", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/subcontracts/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts"] });
      toast({ title: "Status updated" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to update status", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const deleteContractMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/subcontracts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts"] });
      toast({ title: "Subcontract deleted" });
      setShowDetailDialog(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to delete subcontract", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const resetCreateForm = () => {
    setCreateForm({
      projectId: "",
      subcontractorId: "",
      scopeOfWork: "",
      contractAmount: "",
      startDate: "",
      completionDate: "",
      paymentTerms: "",
      retentionPercent: "",
      notes: ""
    });
  };

  const downloadPDF = async (contractId: string, includeSignatures: boolean = true) => {
    try {
      const url = `/api/subcontracts/${contractId}/pdf${includeSignatures ? '' : '?signatures=false'}`;
      const response = await fetch(url, {
        credentials: "include"
      });
      if (!response.ok) throw new Error("Failed to download PDF");
      
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `Subcontract-${selectedContract?.contractNumber || contractId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
      
      toast({ title: "PDF downloaded successfully" });
    } catch (error) {
      toast({ 
        title: "Failed to download PDF", 
        description: "An error occurred", 
        variant: "destructive" 
      });
    }
  };

  const openDetailDialog = (contract: SubcontractorContract) => {
    setSelectedContract(contract);
    setShowDetailDialog(true);
  };

  const openEditDialog = (contract: SubcontractorContract) => {
    setSelectedContract(contract);
    setCreateForm({
      projectId: contract.projectId,
      subcontractorId: contract.subcontractorId,
      scopeOfWork: contract.scopeOfWork,
      contractAmount: contract.contractAmount,
      startDate: contract.startDate || "",
      completionDate: contract.completionDate || "",
      paymentTerms: contract.paymentTerms || "",
      retentionPercent: contract.retentionPercent || "",
      notes: contract.notes || ""
    });
    setShowEditDialog(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "ACTIVE":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Active</Badge>;
      case "COMPLETED":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      case "TERMINATED":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Terminated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0.00";
    const num = parseFloat(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(num);
  };

  const canEdit = user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
  const canDelete = user && ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  const pendingContracts = contracts.filter(c => c.status === "PENDING");
  const activeContracts = contracts.filter(c => c.status === "ACTIVE");
  const completedContracts = contracts.filter(c => c.status === "COMPLETED" || c.status === "TERMINATED");

  const totalContractValue = contracts.reduce((sum, c) => sum + parseFloat(c.contractAmount || "0"), 0);
  const activeContractValue = activeContracts.reduce((sum, c) => sum + parseFloat(c.contractAmount || "0"), 0);

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to access Subcontract Agreements</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have access to Subcontract Agreements</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileSignature className="h-8 w-8 text-primary" />
            Subcontract Agreements
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage subcontractor contracts and agreements
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-subcontract">
            <Plus className="h-4 w-4 mr-2" />
            New Subcontract
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileSignature className="h-4 w-4" />
              Total Contracts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contracts.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Active
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeContracts.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalContractValue.toString())}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Active Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(activeContractValue.toString())}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-subcontracts">
          <TabsTrigger value="all" data-testid="tab-all">
            All ({contracts.length})
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingContracts.length})
          </TabsTrigger>
          <TabsTrigger value="active" data-testid="tab-active">
            Active ({activeContracts.length})
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">
            Completed ({completedContracts.length})
          </TabsTrigger>
        </TabsList>

        {["all", "pending", "active", "completed"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-6">
            {loadingContracts ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {(tab === "all" ? contracts : 
                  tab === "pending" ? pendingContracts : 
                  tab === "active" ? activeContracts : 
                  completedContracts
                ).map(contract => (
                  <Card key={contract.id} className="hover-elevate cursor-pointer" onClick={() => openDetailDialog(contract)}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <Building2 className="h-5 w-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-medium truncate">
                              {contract.contractNumber} - {contract.subcontractor.companyName}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {contract.project.code} - {contract.project.name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                          {getStatusBadge(contract.status)}
                          <Badge variant="secondary">
                            <DollarSign className="h-3 w-3 mr-1" />
                            {formatCurrency(contract.contractAmount)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(contract.createdAt), { addSuffix: true })}
                          </span>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={(e) => { e.stopPropagation(); openDetailDialog(contract); }}
                            data-testid={`button-view-contract-${contract.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {(tab === "all" ? contracts : 
                  tab === "pending" ? pendingContracts : 
                  tab === "active" ? activeContracts : 
                  completedContracts
                ).length === 0 && (
                  <Card>
                    <CardContent className="py-8 text-center text-muted-foreground">
                      No contracts in this category
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg create-sub-contract-modal">
          <DialogHeader>
            <DialogTitle>Create Subcontract Agreement</DialogTitle>
            <DialogDescription>
              Create a new subcontractor agreement for a project
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto form-wrapper">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select 
                value={createForm.projectId} 
                onValueChange={(value) => setCreateForm({...createForm, projectId: value})}
              >
                <SelectTrigger data-testid="select-project-subcontract">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(project => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code} - {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subcontractor</Label>
              <Select 
                value={createForm.subcontractorId} 
                onValueChange={(value) => setCreateForm({...createForm, subcontractorId: value})}
              >
                <SelectTrigger data-testid="select-subcontractor">
                  <SelectValue placeholder="Select a subcontractor..." />
                </SelectTrigger>
                <SelectContent>
                  {subcontractors.map(sub => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.companyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Scope of Work</Label>
              <Textarea
                value={createForm.scopeOfWork}
                onChange={(e) => setCreateForm({...createForm, scopeOfWork: e.target.value})}
                placeholder="Describe the scope of work..."
                rows={4}
                data-testid="input-scope-of-work"
              />
            </div>

            <div className="space-y-2">
              <Label>Contract Amount</Label>
              <Input
                type="number"
                value={createForm.contractAmount}
                onChange={(e) => setCreateForm({...createForm, contractAmount: e.target.value})}
                placeholder="0.00"
                data-testid="input-contract-amount"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !createForm.startDate && "text-muted-foreground"
                      )}
                      data-testid="input-start-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {createForm.startDate ? format(parseISO(createForm.startDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={createForm.startDate ? parseISO(createForm.startDate) : undefined}
                      onSelect={(date) => setCreateForm({...createForm, startDate: date ? format(date, "yyyy-MM-dd") : ""})}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Completion Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !createForm.completionDate && "text-muted-foreground"
                      )}
                      data-testid="input-completion-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {createForm.completionDate ? format(parseISO(createForm.completionDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={createForm.completionDate ? parseISO(createForm.completionDate) : undefined}
                      onSelect={(date) => setCreateForm({...createForm, completionDate: date ? format(date, "yyyy-MM-dd") : ""})}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Terms</Label>
              <Input
                value={createForm.paymentTerms}
                onChange={(e) => setCreateForm({...createForm, paymentTerms: e.target.value})}
                placeholder="e.g., Net 30"
                data-testid="input-payment-terms"
              />
            </div>

            <div className="space-y-2">
              <Label>Retention Percent</Label>
              <Input
                type="number"
                value={createForm.retentionPercent}
                onChange={(e) => setCreateForm({...createForm, retentionPercent: e.target.value})}
                placeholder="e.g., 10"
                data-testid="input-retention"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({...createForm, notes: e.target.value})}
                placeholder="Additional notes..."
                rows={2}
                data-testid="input-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-subcontract">
              Cancel
            </Button>
            <Button 
              onClick={() => createContractMutation.mutate(createForm)}
              disabled={!createForm.projectId || !createForm.subcontractorId || !createForm.scopeOfWork || !createForm.contractAmount || createContractMutation.isPending}
              data-testid="button-submit-subcontract"
            >
              Create Subcontract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedContract?.contractNumber}
              {selectedContract && getStatusBadge(selectedContract.status)}
            </DialogTitle>
            <DialogDescription>
              {selectedContract?.project.code} - {selectedContract?.project.name}
            </DialogDescription>
          </DialogHeader>

          {selectedContract && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      Subcontractor
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-medium">{selectedContract.subcontractor.companyName}</p>
                    {selectedContract.subcontractor.contactName && (
                      <p className="text-sm text-muted-foreground">{selectedContract.subcontractor.contactName}</p>
                    )}
                    {selectedContract.subcontractor.email && (
                      <p className="text-sm text-muted-foreground">{selectedContract.subcontractor.email}</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Contract Value
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{formatCurrency(selectedContract.contractAmount)}</p>
                    {selectedContract.retentionPercent && (
                      <p className="text-sm text-muted-foreground">
                        {selectedContract.retentionPercent}% retention
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Scope of Work
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap">{selectedContract.scopeOfWork}</p>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                {selectedContract.startDate && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Start:</span>
                    <span>{format(new Date(selectedContract.startDate), "MMM d, yyyy")}</span>
                  </div>
                )}
                {selectedContract.completionDate && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Completion:</span>
                    <span>{format(new Date(selectedContract.completionDate), "MMM d, yyyy")}</span>
                  </div>
                )}
              </div>

              {selectedContract.paymentTerms && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Payment Terms:</span>{" "}
                  <span>{selectedContract.paymentTerms}</span>
                </div>
              )}

              {selectedContract.notes && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{selectedContract.notes}</p>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between gap-4 pt-4 border-t flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {canEdit && selectedContract.status === "PENDING" && (
                    <Button 
                      onClick={() => updateStatusMutation.mutate({ id: selectedContract.id, status: "ACTIVE" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-activate-contract"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Activate
                    </Button>
                  )}
                  {canEdit && selectedContract.status === "ACTIVE" && (
                    <Button 
                      onClick={() => updateStatusMutation.mutate({ id: selectedContract.id, status: "COMPLETED" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-complete-contract"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark Complete
                    </Button>
                  )}
                  {canEdit && (
                    <Button 
                      variant="outline"
                      onClick={() => { setShowDetailDialog(false); openEditDialog(selectedContract); }}
                      data-testid="button-edit-contract"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  )}
                  {canDelete && (
                    <Button 
                      variant="destructive"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this subcontract?")) {
                          deleteContractMutation.mutate(selectedContract.id);
                        }
                      }}
                      disabled={deleteContractMutation.isPending}
                      data-testid="button-delete-contract"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline"
                    onClick={() => downloadPDF(selectedContract.id, false)}
                    data-testid="button-download-pdf-no-sig"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    PDF (No Signatures)
                  </Button>
                  <Button 
                    onClick={() => downloadPDF(selectedContract.id, true)}
                    data-testid="button-download-pdf"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setShowDetailDialog(false)}
                    data-testid="button-close-contract-detail"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Subcontract</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Scope of Work</Label>
              <Textarea
                value={createForm.scopeOfWork}
                onChange={(e) => setCreateForm({...createForm, scopeOfWork: e.target.value})}
                rows={4}
                data-testid="input-edit-scope"
              />
            </div>

            <div className="space-y-2">
              <Label>Contract Amount</Label>
              <Input
                type="number"
                value={createForm.contractAmount}
                onChange={(e) => setCreateForm({...createForm, contractAmount: e.target.value})}
                data-testid="input-edit-amount"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !createForm.startDate && "text-muted-foreground"
                      )}
                      data-testid="input-edit-start"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {createForm.startDate ? format(parseISO(createForm.startDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={createForm.startDate ? parseISO(createForm.startDate) : undefined}
                      onSelect={(date) => setCreateForm({...createForm, startDate: date ? format(date, "yyyy-MM-dd") : ""})}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Completion Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !createForm.completionDate && "text-muted-foreground"
                      )}
                      data-testid="input-edit-completion"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {createForm.completionDate ? format(parseISO(createForm.completionDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={createForm.completionDate ? parseISO(createForm.completionDate) : undefined}
                      onSelect={(date) => setCreateForm({...createForm, completionDate: date ? format(date, "yyyy-MM-dd") : ""})}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Payment Terms</Label>
              <Input
                value={createForm.paymentTerms}
                onChange={(e) => setCreateForm({...createForm, paymentTerms: e.target.value})}
                data-testid="input-edit-payment-terms"
              />
            </div>

            <div className="space-y-2">
              <Label>Retention Percent</Label>
              <Input
                type="number"
                value={createForm.retentionPercent}
                onChange={(e) => setCreateForm({...createForm, retentionPercent: e.target.value})}
                data-testid="input-edit-retention"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({...createForm, notes: e.target.value})}
                rows={2}
                data-testid="input-edit-notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={() => selectedContract && updateContractMutation.mutate({
                id: selectedContract.id,
                data: {
                  scopeOfWork: createForm.scopeOfWork,
                  contractAmount: createForm.contractAmount,
                  startDate: createForm.startDate || undefined,
                  completionDate: createForm.completionDate || undefined,
                  paymentTerms: createForm.paymentTerms || undefined,
                  retentionPercent: createForm.retentionPercent || undefined,
                  notes: createForm.notes || undefined
                }
              })}
              disabled={updateContractMutation.isPending}
              data-testid="button-save-edit"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
