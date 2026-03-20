import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { Card, CardContent } from "@/components/ui/card";
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
import { FileSpreadsheet, Plus, Eye, CheckCircle2, Clock, Send, XCircle, DollarSign, Percent, ChevronDown, ChevronRight, Shield, CreditCard, GitCompare } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SovLienWaiverPanel } from "@/components/sov/SovLienWaiverPanel";
import { SovPaymentsPanel } from "@/components/sov/SovPaymentsPanel";
import { SovCoTieoutPanel } from "@/components/sov/SovCoTieoutPanel";
import { SovSummaryCards } from "@/components/sov/SovSummaryCards";
import { SovLineItemsEditor } from "@/components/sov/SovLineItemsEditor";
import type { SovProject, SOV } from "@/components/sov/types";

const formatCurrency = (value: string | null) => {
  if (!value) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(parseFloat(value));
};

const formatPercent = (value: string | null) => {
  if (!value) return "0%";
  return `${parseFloat(value).toFixed(1)}%`;
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "DRAFT":
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
    case "PENDING":
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    case "APPROVED":
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
    case "SUBMITTED":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"><Send className="h-3 w-3 mr-1" />Submitted</Badge>;
    case "REJECTED":
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function ScheduleOfValuesPage() {
  const { user } = useAuth();
  const hasFinancialsPermission = useFeaturePermission('canAccessFinancials');
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("pay-apps");
  const [activeTab, setActiveTab] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedSOV, setSelectedSOV] = useState<SOV | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const deepLinkProjectId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("projectId") ?? ""
    : "";
  const [createForm, setCreateForm] = useState({ projectId: deepLinkProjectId, title: "", description: "" });
  const didAutoOpen = useRef(false);

  const { data: projects = [] } = useQuery<SovProject[]>({
    queryKey: ["/api/sov/projects"],
    enabled: !!user && (["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role) || hasFinancialsPermission)
  });

  const { data: sovs = [], isLoading: loadingSOVs } = useQuery<SOV[]>({
    queryKey: ["/api/sov"],
    enabled: !!user && (["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(user.role) || hasFinancialsPermission)
  });

  useEffect(() => {
    if (selectedSOV && sovs.length > 0) {
      const updatedSOV = sovs.find(s => s.id === selectedSOV.id);
      if (updatedSOV && JSON.stringify(updatedSOV) !== JSON.stringify(selectedSOV)) {
        setSelectedSOV(updatedSOV);
      }
    }
  }, [sovs, selectedSOV]);

  useEffect(() => {
    if (deepLinkProjectId && !didAutoOpen.current && !loadingSOVs) {
      const existingSOV = sovs.find(s => String(s.projectId) === deepLinkProjectId);
      if (existingSOV) {
        setSelectedSOV(existingSOV);
        setShowDetailDialog(true);
      } else {
        setShowCreateDialog(true);
      }
      didAutoOpen.current = true;
    }
  }, [deepLinkProjectId, sovs]);

  const createSOVMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      return await apiRequest("POST", "/api/sov", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "SOV created successfully" });
      setShowCreateDialog(false);
      setCreateForm({ projectId: "", title: "", description: "" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create SOV", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const openDetailDialog = (sov: SOV) => {
    setSelectedSOV(sov);
    setShowDetailDialog(true);
  };

  const toggleExpanded = (id: string) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedItems(newSet);
  };

  const canEdit = user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
  const canApprove = user && ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  const draftSOVs = sovs.filter(s => s.status === "DRAFT");
  const pendingSOVs = sovs.filter(s => s.status === "PENDING");
  const approvedSOVs = sovs.filter(s => s.status === "APPROVED" || s.status === "SUBMITTED");

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to access Schedule of Values</p>
      </div>
    );
  }

  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(user.role) && !hasFinancialsPermission) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have access to Schedule of Values</p>
      </div>
    );
  }

  const getFilteredSOVs = (tab: string) => {
    if (tab === "draft") return draftSOVs;
    if (tab === "pending") return pendingSOVs;
    if (tab === "approved") return approvedSOVs;
    return sovs;
  };

  return (
    <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
            Schedule of Values
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Manage billing schedules, payments, lien waivers, and change order reconciliation
          </p>
        </div>
        {canEdit && mainTab === "pay-apps" && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-sov" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Create SOV
          </Button>
        )}
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="w-full" data-testid="tabs-main-sov">
          <TabsTrigger value="pay-apps" className="flex-1 text-xs sm:text-sm" data-testid="tab-pay-apps">
            <FileSpreadsheet className="h-4 w-4 mr-1 sm:mr-1.5" /> <span className="hidden sm:inline">Pay Apps</span><span className="sm:hidden">Pay Apps</span>
          </TabsTrigger>
          <TabsTrigger value="lien-waivers" className="flex-1 text-xs sm:text-sm" data-testid="tab-lien-waivers">
            <Shield className="h-4 w-4 mr-1 sm:mr-1.5" /> <span className="hidden sm:inline">Lien Waivers</span><span className="sm:hidden">Waivers</span>
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex-1 text-xs sm:text-sm" data-testid="tab-payments">
            <CreditCard className="h-4 w-4 mr-1 sm:mr-1.5" /> <span>Payments</span>
          </TabsTrigger>
          <TabsTrigger value="co-tieout" className="flex-1 text-xs sm:text-sm" data-testid="tab-co-tieout">
            <GitCompare className="h-4 w-4 mr-1 sm:mr-1.5" /> <span className="hidden sm:inline">CO Tie-Out</span><span className="sm:hidden">CO</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pay-apps" className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
          <SovSummaryCards sovs={sovs} draftCount={draftSOVs.length} pendingCount={pendingSOVs.length} approvedCount={approvedSOVs.length} />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList data-testid="tabs-sov">
              <TabsTrigger value="all" data-testid="tab-all">All ({sovs.length})</TabsTrigger>
              <TabsTrigger value="draft" data-testid="tab-draft">Draft ({draftSOVs.length})</TabsTrigger>
              <TabsTrigger value="pending" data-testid="tab-pending">Pending ({pendingSOVs.length})</TabsTrigger>
              <TabsTrigger value="approved" data-testid="tab-approved">Approved ({approvedSOVs.length})</TabsTrigger>
            </TabsList>

            {["all", "draft", "pending", "approved"].map(tab => (
              <TabsContent key={tab} value={tab} className="mt-6">
                {loadingSOVs ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {getFilteredSOVs(tab).map(sov => (
                      <Collapsible key={sov.id} open={expandedItems.has(sov.id)}>
                        <Card>
                          <CardContent className="py-3 sm:py-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                              <CollapsibleTrigger
                                className="flex items-center gap-2 sm:gap-4 cursor-pointer flex-1"
                                onClick={() => toggleExpanded(sov.id)}
                              >
                                {expandedItems.has(sov.id) ? (
                                  <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                                )}
                                <div className="text-left min-w-0">
                                  <h3 className="font-medium text-sm sm:text-base truncate">{sov.sovNumber} - {sov.title}</h3>
                                  <p className="text-xs sm:text-sm text-muted-foreground truncate">
                                    {sov.projectCode} - {sov.projectName}
                                  </p>
                                </div>
                              </CollapsibleTrigger>
                              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 flex-wrap pl-7 sm:pl-0">
                                {getStatusBadge(sov.status)}
                                <Badge variant="outline" className="text-xs">
                                  <Percent className="h-3 w-3 mr-1" />
                                  {formatPercent(sov.overallPercentComplete)}
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  <DollarSign className="h-3 w-3 mr-1" />
                                  {formatCurrency(sov.totalScheduledValue)}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openDetailDialog(sov)}
                                  data-testid={`button-view-sov-${sov.id}`}
                                  className="h-7 sm:h-8"
                                >
                                  <Eye className="h-4 w-4 sm:mr-1" />
                                  <span className="hidden sm:inline">View</span>
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                          <CollapsibleContent>
                            <div className="px-3 sm:px-6 pb-4 border-t pt-4">
                              <div className="hidden sm:block">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="w-16">#</TableHead>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Scheduled Value</TableHead>
                                      <TableHead className="text-right">% Complete</TableHead>
                                      <TableHead className="text-right">Balance</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {sov.lineItems?.map(item => (
                                      <TableRow key={item.id}>
                                        <TableCell>{item.itemNumber}</TableCell>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(item.scheduledValue)}</TableCell>
                                        <TableCell className="text-right">{formatPercent(item.percentComplete)}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(item.balanceToFinish)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              <div className="sm:hidden space-y-2">
                                {sov.lineItems?.map(item => (
                                  <div key={item.id} className="border rounded-lg p-2.5 space-y-1" data-testid={`card-line-item-${item.id}`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-sm font-medium">#{item.itemNumber} {item.description}</p>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-xs">
                                      <div>
                                        <span className="text-muted-foreground">Value</span>
                                        <p className="font-mono font-medium">{formatCurrency(item.scheduledValue)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Complete</span>
                                        <p className="font-mono font-medium">{formatPercent(item.percentComplete)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Balance</span>
                                        <p className="font-mono font-medium">{formatCurrency(item.balanceToFinish)}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    ))}
                    {getFilteredSOVs(tab).length === 0 && (
                      <Card>
                        <CardContent className="py-8 text-center text-muted-foreground">
                          No SOVs in this category
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        <TabsContent value="lien-waivers" className="mt-6">
          <SovLienWaiverPanel projects={projects} sovs={sovs} />
        </TabsContent>

        <TabsContent value="payments" className="mt-6">
          <SovPaymentsPanel sovs={sovs} />
        </TabsContent>

        <TabsContent value="co-tieout" className="mt-6">
          <SovCoTieoutPanel />
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Schedule of Values</DialogTitle>
            <DialogDescription>
              Create a new SOV for billing and progress tracking
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select
                value={createForm.projectId}
                onValueChange={(value) => setCreateForm({...createForm, projectId: value})}
              >
                <SelectTrigger data-testid="select-project-sov">
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
              <Label>Title</Label>
              <Input
                value={createForm.title}
                onChange={(e) => setCreateForm({...createForm, title: e.target.value})}
                placeholder="e.g., Initial SOV, Progress Billing #1"
                data-testid="input-sov-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({...createForm, description: e.target.value})}
                placeholder="Additional details about this SOV..."
                rows={3}
                data-testid="input-sov-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-sov">
              Cancel
            </Button>
            <Button
              onClick={() => createSOVMutation.mutate(createForm)}
              disabled={!createForm.projectId || !createForm.title || createSOVMutation.isPending}
              data-testid="button-submit-sov"
            >
              Create SOV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {selectedSOV && (
            <SovLineItemsEditor
              sov={selectedSOV}
              canEdit={!!canEdit}
              canApprove={!!canApprove}
              onClose={() => setShowDetailDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
