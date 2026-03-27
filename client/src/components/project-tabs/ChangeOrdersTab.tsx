import { useState, useMemo, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, CheckCircle, XCircle, Eye, Ruler, Flag, ClipboardCheck, Ban, AlertTriangle, Calendar, FileText, Clock, Download, Send, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format, isPast, differenceInDays } from "date-fns";
import type { ChangeOrder } from "@shared/schema";
import { useCreateChangeOrder, useApproveChangeOrder, useRejectChangeOrder, useRequestApprovalChangeOrder, useSubmitChangeOrder, useReturnToDraftChangeOrder } from "@/hooks/use-data";
import { ChangeOrderFiles } from "@/components/ChangeOrderFiles";
import { ChangeOrderDialog } from "@/components/ChangeOrderDialog";
import StandardizedScopeSelector, { type ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import AiChangeOrderGenerator from "@/components/AiChangeOrderGenerator";
import { hasManagementAccess } from "@/lib/rbac";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ChangeOrdersTabProps {
  changeOrders: ChangeOrder[];
  projectCode: string;
  projectId: string;
  projectName: string;
  clientName?: string;
  isLoading: boolean;
  userRole: string;
}

function statusDurationDays(co: ChangeOrder & { lastStatusChangeAt?: string | null }): number {
  const refDate = co.lastStatusChangeAt ? new Date(co.lastStatusChangeAt) : (co.updatedAt ? new Date(co.updatedAt) : new Date(co.createdAt));
  return differenceInDays(new Date(), refDate);
}

function StatusDurationBadge({ co }: { co: ChangeOrder }) {
  const days = statusDurationDays(co);
  if (days < 1) return null;
  const isLong = days > 7;
  return (
    <Badge variant="outline" className={`text-xs ${isLong ? "border-amber-400 text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid={`badge-duration-${co.id}`}>
      <Clock className="w-3 h-3 mr-1" />{days}d
    </Badge>
  );
}

export default function ChangeOrdersTab({ changeOrders, projectCode, projectId, projectName, clientName, isLoading, userRole }: ChangeOrdersTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedChangeOrder, setSelectedChangeOrder] = useState<ChangeOrder | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [manualCoNumber, setManualCoNumber] = useState("");
  const [selectedCostCodeId, setSelectedCostCodeId] = useState<string>("");
  const [scopeSelection, setScopeSelection] = useState<ScopeSelectionData | null>(null);
  const [scopeQuantity, setScopeQuantity] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [pendingSubmitId, setPendingSubmitId] = useState<string | null>(null);
  const [clientResponseDueDate, setClientResponseDueDate] = useState("");
  const [addedToSovIds, setAddedToSovIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: sovCoLinkedData } = useQuery<{ linkedCoIds: string[] }>({
    queryKey: ["/api/projects", projectCode, "sov-co-linked-ids"],
  });

  const { data: costCodes = [] } = useQuery<Array<{ id: number; code: string; description: string; division: string }>>({
    queryKey: ["/api/cost-codes/org"],
  });

  useEffect(() => {
    if (sovCoLinkedData?.linkedCoIds?.length) {
      setAddedToSovIds(new Set(sovCoLinkedData.linkedCoIds));
    }
  }, [sovCoLinkedData]);

  useEffect(() => {
    if (changeOrders.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkCoId = params.get("coId");
    if (deepLinkCoId) {
      const found = changeOrders.find(co => co.id === deepLinkCoId);
      if (found) {
        setSelectedChangeOrder(found);
        setShowViewDialog(true);
      }
    }
  }, [changeOrders]);

  const addToSovMutation = useMutation({
    mutationFn: async (coId: string) => {
      const res = await apiRequest("POST", `/api/change-orders/${coId}/add-to-sov`, {});
      return res.json();
    },
    onSuccess: (_data, coId) => {
      setAddedToSovIds((prev) => new Set([...prev, coId]));
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "sov"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "sov-co-linked-ids"] });
      toast({ title: "Added to SOV", description: "The change order has been added as a new SOV line item." });
    },
    onError: (error: Error) => {
      const msg = error.message?.includes("already linked") ? "This change order is already on the SOV." : "Failed to add to SOV";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const createMutation = useCreateChangeOrder();
  const requestApprovalMutation = useRequestApprovalChangeOrder();
  const approveMutation = useApproveChangeOrder();
  const rejectMutation = useRejectChangeOrder();
  const returnToDraftMutation = useReturnToDraftChangeOrder();

  const bulkSubmitMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/change-orders/bulk-submit", { ids });
      return res.json();
    },
    onSuccess: (data: { summary?: { succeeded?: number; total?: number } }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Bulk Submit Complete", description: `${data.summary?.succeeded || 0} of ${data.summary?.total || 0} submitted successfully` });
      setSelectedIds(new Set());
    },
    onError: () => {
      toast({ title: "Error", description: "Bulk submit failed", variant: "destructive" });
    },
  });

  const handleCreate = async () => {
    if (!description || !amount) {
      toast({ title: "Error", description: "Description and amount are required", variant: "destructive" });
      return;
    }

    try {
      const createPayload: Record<string, unknown> & { projectCode: string } = {
        projectId,
        projectCode,
        description,
        amount,
        changeOrderNumber: manualCoNumber.trim() || undefined,
        costCodeId: selectedCostCodeId && selectedCostCodeId !== "none" ? parseInt(selectedCostCodeId, 10) : undefined,
        workTypeId: scopeSelection?.workTypeId || undefined,
        workTypeCode: scopeSelection?.workTypeCode || undefined,
        workTypeName: scopeSelection?.workTypeName || undefined,
        categoryName: scopeSelection?.categoryName || undefined,
        scopeModifierIds: scopeSelection ? JSON.stringify(scopeSelection.modifierIds || []) : undefined,
        scopeModifierNames: scopeSelection ? JSON.stringify(scopeSelection.modifierNames || []) : undefined,
        canonicalName: scopeSelection?.canonicalName || undefined,
        scopeUnit: scopeSelection?.unit || undefined,
        scopeQuantity: scopeQuantity || undefined,
      };
      const result = await createMutation.mutateAsync(createPayload as Parameters<typeof createMutation.mutateAsync>[0]);
      const generatedNumber = (result as { changeOrderNumber?: string })?.changeOrderNumber || "";
      toast({
        title: "Change order created",
        description: generatedNumber ? `CO #${generatedNumber} has been created` : "Change order created successfully",
      });
      setShowCreateDialog(false);
      setDescription("");
      setAmount("");
      setManualCoNumber("");
      setSelectedCostCodeId("");
      setScopeSelection(null);
      setScopeQuantity("");
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

  const openSubmitDialog = (id: string) => {
    setPendingSubmitId(id);
    setClientResponseDueDate("");
    setShowSubmitDialog(true);
  };

  const handleSubmit = async () => {
    if (!pendingSubmitId) return;
    try {
      await apiRequest("POST", `/api/change-orders/${pendingSubmitId}/submit`, {
        clientResponseDueDate: clientResponseDueDate || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "change-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Success", description: "Change order submitted to client" });
      setShowSubmitDialog(false);
      setPendingSubmitId(null);
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

  const filteredChangeOrders = useMemo(() => {
    if (statusFilter === "ALL") return changeOrders;
    return changeOrders.filter(co => co.status === statusFilter);
  }, [changeOrders, statusFilter]);

  const isResponseOverdue = (co: ChangeOrder) => {
    return co.status === "SUBMITTED" && co.clientResponseDueDate && isPast(new Date(co.clientResponseDueDate));
  };

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredChangeOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredChangeOrders.map(co => co.id)));
    }
  }, [filteredChangeOrders, selectedIds.size]);

  const submittableSelected = useMemo(() => {
    return filteredChangeOrders.filter(co => selectedIds.has(co.id) && (co.status === "PCO" || co.status === "DRAFT"));
  }, [filteredChangeOrders, selectedIds]);

  const handleBulkExportCsv = useCallback(() => {
    const sanitizeCsvCell = (val: string) => {
      let s = val.replace(/"/g, '""');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return s;
    };
    const rows = filteredChangeOrders.filter(co => selectedIds.size === 0 || selectedIds.has(co.id));
    const header = "CO Number,Status,Description,Amount,Created,Updated";
    const csvRows = rows.map(co =>
      `"${sanitizeCsvCell(co.changeOrderNumber)}","${sanitizeCsvCell(co.status)}","${sanitizeCsvCell(co.description)}","${co.amount}","${format(new Date(co.createdAt), "yyyy-MM-dd")}","${format(new Date(co.updatedAt), "yyyy-MM-dd")}"`
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `change-orders-${projectCode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${rows.length} change orders exported to CSV` });
  }, [filteredChangeOrders, selectedIds, projectCode, toast]);

  const [bulkPdfLoading, setBulkPdfLoading] = useState(false);
  const handleBulkExportPdf = useCallback(async () => {
    setBulkPdfLoading(true);
    try {
      const idsParam = selectedIds.size > 0 ? `?ids=${Array.from(selectedIds).join(',')}` : '';
      const res = await fetch(`/api/change-orders/project/${projectId}/bulk-pdf${idsParam}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to export PDFs");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ChangeOrders_${projectCode}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: "Change orders exported as PDF ZIP" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to export PDFs";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setBulkPdfLoading(false);
    }
  }, [selectedIds, projectId, projectCode, toast]);

  const costCodeMap = useMemo(() => {
    const map = new Map<number, { code: string; description: string }>();
    costCodes.forEach(cc => map.set(cc.id, { code: cc.code, description: cc.description }));
    return map;
  }, [costCodes]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle>Change Orders</CardTitle>
            <div className="flex items-center gap-2">
              {canManage && selectedIds.size > 0 && (
                <>
                  {submittableSelected.length > 0 && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => bulkSubmitMutation.mutate(submittableSelected.map(co => co.id))}
                      disabled={bulkSubmitMutation.isPending}
                      data-testid="button-bulk-submit"
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Submit {submittableSelected.length} Selected
                    </Button>
                  )}
                </>
              )}
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkExportCsv}
                  data-testid="button-export-csv"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Export {selectedIds.size} Selected
                </Button>
              )}
              {selectedIds.size === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkExportCsv}
                  data-testid="button-export-csv-all"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Export All CSV
                </Button>
              )}
              {(userRole === "ADMIN" || userRole === "MANAGER") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkExportPdf}
                  disabled={bulkPdfLoading}
                  data-testid="button-export-pdf-zip"
                >
                  <FileText className="w-4 h-4 mr-1" />
                  {bulkPdfLoading ? "Exporting..." : selectedIds.size > 0 ? `Export ${selectedIds.size} PDFs` : "Export All PDFs"}
                </Button>
              )}
              <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                <DialogTrigger asChild>
                  <Button size="sm" data-testid="button-new-change-order" className="w-full sm:w-auto">
                    <Plus className="w-4 h-4 mr-2" />
                    New Change Order
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-create-change-order">
                <DialogHeader>
                  <DialogTitle>Create Change Order</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">Creates a new Potential Change Order (PCO). A CO number will be auto-assigned unless you specify one.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="co-number">CO Number (optional)</Label>
                      <Input
                        id="co-number"
                        value={manualCoNumber}
                        onChange={(e) => setManualCoNumber(e.target.value)}
                        placeholder="Auto-generated (e.g. CO-001)"
                        data-testid="input-manual-co-number"
                      />
                      <p className="text-xs text-muted-foreground mt-1">Leave blank for auto-numbering</p>
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
                        Enter positive for additions or negative for deductions
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="co-cost-code">Cost Code</Label>
                      <Select value={selectedCostCodeId} onValueChange={setSelectedCostCodeId}>
                        <SelectTrigger id="co-cost-code" data-testid="select-cost-code">
                          <SelectValue placeholder="Select cost code (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No Cost Code</SelectItem>
                          {costCodes.map(cc => (
                            <SelectItem key={cc.id} value={String(cc.id)}>
                              {cc.code} — {cc.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Card className="p-4 bg-muted/30">
                    <div className="flex items-center gap-2 mb-3">
                      <Ruler className="w-4 h-4 text-muted-foreground" />
                      <Label className="text-sm font-medium">Scope of Work (for Production Rate Tracking)</Label>
                    </div>
                    <StandardizedScopeSelector
                      value={scopeSelection || undefined}
                      onChange={setScopeSelection}
                      showDimensionInputs={false}
                    />
                    {scopeSelection && (
                      <div className="mt-3 grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="co-scope-quantity">Quantity</Label>
                          <div className="flex items-center gap-2">
                            <Input
                              id="co-scope-quantity"
                              type="number"
                              step="0.01"
                              value={scopeQuantity}
                              onChange={(e) => setScopeQuantity(e.target.value)}
                              placeholder="0"
                              data-testid="input-co-scope-quantity"
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
                        Select a work type to enable production rate tracking for this change order.
                      </p>
                    )}
                  </Card>

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
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!isLoading && changeOrders.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PCO">PCO</SelectItem>
                  <SelectItem value="PRICING_REVIEW">Pricing Review</SelectItem>
                  <SelectItem value="SUBMITTED">Submitted</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="VOIDED">Voided</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                </SelectContent>
              </Select>
              {statusFilter !== "ALL" && (
                <span className="text-xs text-muted-foreground">
                  {filteredChangeOrders.length} of {changeOrders.length} shown
                </span>
              )}
              {canManage && filteredChangeOrders.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={toggleSelectAll}
                  data-testid="button-select-all"
                  className="ml-auto"
                >
                  {selectedIds.size === filteredChangeOrders.length ? "Deselect All" : "Select All"}
                </Button>
              )}
            </div>
          )}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading change orders...</div>
          ) : filteredChangeOrders.length === 0 && changeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders yet</div>
          ) : filteredChangeOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No change orders match the selected filter</div>
          ) : (
            <div className="space-y-3">
              {filteredChangeOrders.map((co) => (
                <Card key={co.id} data-testid={`change-order-${co.id}`} className={selectedIds.has(co.id) ? "ring-2 ring-primary" : ""}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {canManage && (
                            <Checkbox
                              checked={selectedIds.has(co.id)}
                              onCheckedChange={() => toggleSelection(co.id)}
                              data-testid={`checkbox-co-${co.id}`}
                            />
                          )}
                          <Badge variant="outline" className="font-mono">{co.changeOrderNumber}</Badge>
                          {co.status === "PCO" ? (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300" data-testid={`status-pco-${co.id}`}>
                              <Flag className="w-3 h-3 mr-1" />PCO
                            </Badge>
                          ) : co.status === "PRICING_REVIEW" ? (
                            <Badge variant="secondary" className="bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300" data-testid={`status-pricing-review-${co.id}`}>
                              <ClipboardCheck className="w-3 h-3 mr-1" />Pricing Review
                            </Badge>
                          ) : co.status === "VOIDED" ? (
                            <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-900 dark:text-gray-400" data-testid={`status-voided-${co.id}`}>
                              <Ban className="w-3 h-3 mr-1" />Voided
                            </Badge>
                          ) : (
                            <Badge
                              variant={
                                co.status === "APPROVED" ? "default" :
                                co.status === "REJECTED" ? "destructive" :
                                co.status === "SUBMITTED" ? "secondary" :
                                "outline"
                              }
                              data-testid={`status-badge-${co.id}`}
                            >
                              {co.status?.replace(/_/g, " ")}
                            </Badge>
                          )}
                          <StatusDurationBadge co={co} />
                          {isResponseOverdue(co) && (
                            <Badge variant="destructive" className="flex items-center gap-1" data-testid={`badge-overdue-${co.id}`}>
                              <AlertTriangle className="w-3 h-3" />
                              Response Overdue
                            </Badge>
                          )}
                          {co.costCodeId && costCodeMap.has(co.costCodeId) && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-cost-code-${co.id}`}>
                              {costCodeMap.get(co.costCodeId)?.code}
                            </Badge>
                          )}
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
                        {co.clientResponseDueDate && co.status === "SUBMITTED" && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Response due: {format(new Date(co.clientResponseDueDate), "MMM d, yyyy")}
                          </p>
                        )}
                        {co.rejectionReason && (
                          <p className="text-sm text-destructive mt-2">
                            Rejected: {co.rejectionReason}
                          </p>
                        )}
                        
                        <ChangeOrderFiles changeOrderId={co.id} />
                      </div>
                      <div className="text-right">
                        {hasManagementAccess(userRole) && (
                          <>
                            <p className={`text-xl font-bold font-mono ${parseFloat(co.amount) < 0 ? 'text-destructive' : 'text-primary'}`}>
                              {parseFloat(co.amount) >= 0 ? '+' : ''}${parseFloat(co.amount).toLocaleString()}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {parseFloat(co.amount) >= 0 ? 'Addition' : 'Deduction'}
                            </p>
                          </>
                        )}
                        {canManage && (co.status === "DRAFT" || co.status === "PCO") && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => openSubmitDialog(co.id)}
                              data-testid={`button-submit-${co.id}`}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Submit to Client
                            </Button>
                          </div>
                        )}
                        {canManage && co.status === "SUBMITTED" && (
                          <div className="flex gap-2 mt-2 flex-wrap justify-end">
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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReturnToDraft(co.id)}
                              disabled={returnToDraftMutation.isPending}
                              data-testid={`button-return-draft-${co.id}`}
                            >
                              <RotateCcw className="w-4 h-4 mr-1" />
                              Return to Draft
                            </Button>
                          </div>
                        )}
                        {co.status === "APPROVED" && canManage && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => addToSovMutation.mutate(co.id)}
                              disabled={addToSovMutation.isPending || addedToSovIds.has(co.id)}
                              data-testid={`button-add-to-sov-${co.id}`}
                            >
                              <FileText className="w-4 h-4 mr-1" />
                              {addedToSovIds.has(co.id) ? "On SOV" : "Add to SOV"}
                            </Button>
                          </div>
                        )}
                        {co.status === "PCO" && (
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            <Flag className="w-3 h-3 inline mr-1" />Open in details to advance workflow
                          </p>
                        )}
                        {co.status === "PRICING_REVIEW" && (
                          <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                            <ClipboardCheck className="w-3 h-3 inline mr-1" />Awaiting internal pricing review
                          </p>
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

      {canManage && (
        <div className="mt-6">
          <AiChangeOrderGenerator
            projectId={projectId}
            projectName={projectName}
            onCreateChangeOrder={(draft) => {
              setAmount(draft.suggestedAmount.toString());
              setDescription(draft.aiGeneratedDescription);
              setShowCreateDialog(true);
            }}
          />
        </div>
      )}

      <ChangeOrderDialog
        changeOrder={selectedChangeOrder}
        open={showViewDialog}
        onOpenChange={(open) => {
          setShowViewDialog(open);
          if (!open) setSelectedChangeOrder(null);
        }}
        projectCode={projectCode}
        projectName={projectName}
        projectId={projectId}
        subcontractorName={clientName}
        userRole={userRole}
      />

      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="max-w-sm" data-testid="dialog-submit-co">
          <DialogHeader>
            <DialogTitle>Submit to Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Optionally set a client response deadline for this change order.
            </p>
            <div>
              <Label htmlFor="client-response-due-date" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Client Response Due Date (optional)
              </Label>
              <Input
                id="client-response-due-date"
                type="date"
                value={clientResponseDueDate}
                onChange={(e) => setClientResponseDueDate(e.target.value)}
                data-testid="input-client-response-due-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>Cancel</Button>
            <Button onClick={handleSubmit} data-testid="button-confirm-submit">
              Submit to Client
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
