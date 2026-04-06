import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { hasFinancialAccess, hasManagementAccess } from "@/lib/rbac";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { FileSpreadsheet, Plus, Eye, CheckCircle2, Clock, Send, XCircle, DollarSign, Percent, Shield, CreditCard, GitCompare, Info } from "lucide-react";
import { SovLineItemsEditor } from "@/components/sov/SovLineItemsEditor";
import { SovPaymentsPanel } from "@/components/sov/SovPaymentsPanel";
import { SovLienWaiverPanel } from "@/components/sov/SovLienWaiverPanel";
import { SovCoTieoutPanel } from "@/components/sov/SovCoTieoutPanel";
import { SovSummaryCards } from "@/components/sov/SovSummaryCards";
import type { SovProject, SOV } from "@/components/sov/types";
import { WorkflowTracker } from "@/components/workflow-tracker";

interface SovTabProps {
  projectId: string;
  projectCode: string;
}

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

export default function SovTab({ projectId, projectCode }: SovTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("pay-apps");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedSOV, setSelectedSOV] = useState<SOV | null>(null);
  const [createForm, setCreateForm] = useState({ title: "", description: "" });

  const userRole = user?.role;
  const canEdit = hasManagementAccess(userRole) || hasFinancialAccess(userRole);
  const canApprove = userRole === "ADMIN";

  const { data: allSovs = [], isLoading: loadingSOVs } = useQuery<SOV[]>({
    queryKey: ["/api/sov"],
    enabled: !!user,
  });

  const sovs = allSovs.filter(s => String(s.projectId) === String(projectId));

  const sovProject: SovProject | null = sovs.length > 0
    ? { id: String(sovs[0].projectId), code: sovs[0].projectCode, name: sovs[0].projectName, clientName: "", contractAmount: sovs[0].contractAmount }
    : null;

  const projects: SovProject[] = sovProject ? [sovProject] : [];

  useEffect(() => {
    if (selectedSOV && sovs.length > 0) {
      const updated = sovs.find(s => s.id === selectedSOV.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedSOV)) {
        setSelectedSOV(updated);
      }
    }
  }, [sovs, selectedSOV]);

  const createMutation = useMutation({
    mutationFn: async (data: { projectId: string; title: string; description: string }) => {
      const res = await apiRequest("POST", "/api/sov", data);
      return res.json() as Promise<SOV>;
    },
    onSuccess: (newSov) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] }).then(() => {
        setShowCreateDialog(false);
        setCreateForm({ title: "", description: "" });
        setSelectedSOV(newSov);
        setShowDetailDialog(true);
      });
      toast({ title: "SOV created successfully" });
    },
    onError: (err: Error) => toast({ title: "Error creating SOV", description: err.message, variant: "destructive" }),
  });

  const draftCount = sovs.filter(s => s.status === "DRAFT").length;
  const pendingCount = sovs.filter(s => s.status === "PENDING").length;
  const approvedCount = sovs.filter(s => s.status === "APPROVED" || s.status === "SUBMITTED").length;

  const gapSov = sovs.find(s => {
    if (s.lineItems.length === 0) return false;
    const contract = parseFloat(s.contractAmount ?? "0");
    const summedScheduled = s.lineItems.reduce(
      (acc, li) => acc + parseFloat(li.scheduledValue ?? "0"),
      0
    );
    if (summedScheduled <= 0 || contract <= summedScheduled + 0.01) return false;
    return s.lineItems.every(li => {
      const completed = parseFloat(
        li.totalCompletedAndStored ?? li.totalCompleted ?? "0"
      );
      const current = parseFloat(
        li.thisPeriodCompleted ?? li.currentBilled ?? "0"
      );
      return completed === 0 && current === 0;
    });
  });
  const sovGapAmount = gapSov
    ? parseFloat(gapSov.contractAmount ?? "0") -
      gapSov.lineItems.reduce((acc, li) => acc + parseFloat(li.scheduledValue ?? "0"), 0)
    : 0;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Schedule of Values
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">Track payment applications for {projectCode}</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-sov" className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            New SOV
          </Button>
        )}
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="pay-apps" className="flex items-center gap-1.5" data-testid="tab-sov-pay-apps">
            <DollarSign className="h-4 w-4" />
            Pay Apps
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-1.5" data-testid="tab-sov-payments">
            <CreditCard className="h-4 w-4" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="lien-waivers" className="flex items-center gap-1.5" data-testid="tab-sov-lien-waivers">
            <Shield className="h-4 w-4" />
            Lien Waivers
          </TabsTrigger>
          <TabsTrigger value="co-tieout" className="flex items-center gap-1.5" data-testid="tab-sov-co-tieout">
            <GitCompare className="h-4 w-4" />
            CO Tie-Out
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pay-apps" className="space-y-4 mt-4">
          {gapSov && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30" data-testid="banner-sov-gap">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 text-sm text-blue-800 dark:text-blue-300 space-y-1">
                <p className="font-medium">Scheduled values are {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(sovGapAmount)} below the contract amount.</p>
                <p className="text-xs">The SOV was seeded from the estimate's direct costs. The gap represents overhead and profit markup — open the SOV to distribute these amounts across line items so they sum to the full contract value.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-7 text-xs border-blue-300 text-blue-800 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
                  onClick={() => { setSelectedSOV(gapSov); setShowDetailDialog(true); }}
                  data-testid="button-sov-gap-review"
                >
                  Review SOV Line Items
                </Button>
              </div>
            </div>
          )}
          {loadingSOVs ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : (
            <>
              <SovSummaryCards
                sovs={sovs}
                draftCount={draftCount}
                pendingCount={pendingCount}
                approvedCount={approvedCount}
              />

              {sovs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center space-y-3">
                    <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground">No SOVs yet for this project.</p>
                    {canEdit && (
                      <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-sov-empty">
                        <Plus className="h-4 w-4 mr-2" />
                        Create SOV
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SOV #</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Contract</TableHead>
                            <TableHead className="text-right">Billed</TableHead>
                            <TableHead className="text-right">
                              <Percent className="h-4 w-4 inline" />
                            </TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sovs.map(sov => (
                            <TableRow key={sov.id} data-testid={`row-sov-${sov.id}`}>
                              <TableCell className="font-mono text-sm">{sov.sovNumber}</TableCell>
                              <TableCell className="font-medium">{sov.title}</TableCell>
                              <TableCell>{getStatusBadge(sov.status)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(sov.contractAmount)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(sov.totalCompleted)}</TableCell>
                              <TableCell className="text-right">{formatPercent(sov.overallPercentComplete)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(sov.totalBalanceToFinish)}</TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setSelectedSOV(sov); setShowDetailDialog(true); }}
                                  data-testid={`button-view-sov-${sov.id}`}
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="md:hidden divide-y">
                      {sovs.map(sov => (
                        <div key={sov.id} className="p-3 space-y-2" data-testid={`card-sov-${sov.id}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{sov.title}</p>
                              <p className="text-xs text-muted-foreground font-mono">{sov.sovNumber}</p>
                            </div>
                            {getStatusBadge(sov.status)}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Contract</span>
                              <p className="font-mono font-medium">{formatCurrency(sov.contractAmount)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Billed</span>
                              <p className="font-mono font-medium">{formatCurrency(sov.totalCompleted)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">% Complete</span>
                              <p className="font-mono font-medium">{formatPercent(sov.overallPercentComplete)}</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full"
                            onClick={() => { setSelectedSOV(sov); setShowDetailDialog(true); }}
                            data-testid={`button-view-sov-m-${sov.id}`}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View Details
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="payments" className="mt-4">
          <SovPaymentsPanel sovs={sovs} />
        </TabsContent>

        <TabsContent value="lien-waivers" className="mt-4">
          <SovLienWaiverPanel projects={projects} sovs={sovs} />
        </TabsContent>

        <TabsContent value="co-tieout" className="mt-4">
          <SovCoTieoutPanel projectId={projectId} />
        </TabsContent>
      </Tabs>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Schedule of Values</DialogTitle>
            <DialogDescription>Create a new SOV pay application for project {projectCode}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={createForm.title}
                onChange={(e) => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g., Pay App #1 — March 2026"
                data-testid="input-sov-title"
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                value={createForm.description}
                onChange={(e) => setCreateForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Notes about this SOV..."
                data-testid="input-sov-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-create-sov">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate({ projectId, title: createForm.title, description: createForm.description })}
              disabled={!createForm.title || createMutation.isPending}
              data-testid="button-submit-create-sov"
            >
              {createMutation.isPending ? "Creating..." : "Create SOV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedSOV && (
            <>
              <WorkflowTracker entityType="SOV_PAY_APP" entityId={selectedSOV.id} compact data-testid={`workflow-tracker-sov-${selectedSOV.id}`} />
              <SovLineItemsEditor
                sov={selectedSOV}
                canEdit={canEdit}
                canApprove={canApprove}
                onClose={() => setShowDetailDialog(false)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
