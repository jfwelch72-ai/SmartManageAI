import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Download,
  CheckCircle2,
  Send,
  XCircle,
  Trash2,
} from "lucide-react";
import type { SOV, SOVLineItem } from "./types";

interface SovLineItemsEditorProps {
  sov: SOV;
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
}

const billingModeLabels: Record<string, string> = {
  all: "All Categories",
  material: "Material Only",
  labor: "Labor Only",
  material_labor: "Material + Labor",
};

function getFilteredLineItems(items: SOVLineItem[], mode: string) {
  if (mode === "all") return items;
  const categoryMap: Record<string, string[]> = {
    material: ["material"],
    labor: ["labor"],
    material_labor: ["material", "labor"],
  };
  const allowedCategories = categoryMap[mode] || [];
  return items.filter(item => {
    const cat = item.category?.toLowerCase();
    return cat && allowedCategories.includes(cat);
  });
}

function getFilteredTotals(items: SOVLineItem[]) {
  let totalScheduledValue = 0;
  let totalPreviouslyBilled = 0;
  let totalCurrentBilled = 0;
  let totalBalance = 0;
  items.forEach(item => {
    totalScheduledValue += parseFloat(item.scheduledValue || "0");
    totalPreviouslyBilled += parseFloat(item.previouslyBilled || "0");
    totalCurrentBilled += parseFloat(item.currentBilled || "0");
    totalBalance += parseFloat(item.balanceToFinish || "0");
  });
  return { totalScheduledValue, totalPreviouslyBilled, totalCurrentBilled, totalBalance };
}

function formatCurrency(value: string | null) {
  if (!value) return "$0.00";
  const num = parseFloat(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function formatPercent(value: string | null) {
  if (!value) return "0%";
  return `${parseFloat(value).toFixed(1)}%`;
}

export function SovLineItemsEditor({ sov, canEdit, canApprove, onClose }: SovLineItemsEditorProps) {
  const { toast } = useToast();
  const [billingMode, setBillingMode] = useState<"all" | "material" | "labor" | "material_labor">("all");
  const [showAddLineItemDialog, setShowAddLineItemDialog] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [lineItemForm, setLineItemForm] = useState({ description: "", scheduledValue: "" });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="outline">Draft</Badge>;
      case "PENDING":
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Pending</Badge>;
      case "APPROVED":
        return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Approved</Badge>;
      case "SUBMITTED":
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Submitted</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/sov/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "Status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update status", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const addLineItemMutation = useMutation({
    mutationFn: async (data: { sovId: string; description: string; scheduledValue: string }) => {
      return await apiRequest("POST", `/api/sov/${data.sovId}/items`, {
        description: data.description,
        scheduledValue: data.scheduledValue
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "Line item added" });
      setShowAddLineItemDialog(false);
      setLineItemForm({ description: "", scheduledValue: "" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add line item", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const deleteLineItemMutation = useMutation({
    mutationFn: async ({ sovId, itemId }: { sovId: string; itemId: string }) => {
      return await apiRequest("DELETE", `/api/sov/${sovId}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "Line item removed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove line item", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const sendToRepMutation = useMutation({
    mutationFn: async ({ sovId, email, billingMode }: { sovId: string; email: string; billingMode: string }) => {
      return await apiRequest("POST", `/api/sov/${sovId}/send`, { email, billingMode });
    },
    onSuccess: () => {
      toast({ title: "PDF sent successfully", description: "The billing breakdown has been emailed to the representative." });
      setShowSendDialog(false);
      setSendEmail("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to send", description: error.message || "An error occurred", variant: "destructive" });
    }
  });

  const downloadPDF = async (sovId: string, mode: string = "all") => {
    try {
      const response = await fetch(`/api/sov/${sovId}/pdf?billingMode=${mode}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to download PDF");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const modeLabel = mode === "all" ? "" : `-${mode}`;
      a.download = `SOV-${sov.sovNumber || sovId}${modeLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({ title: "PDF downloaded successfully" });
    } catch (error) {
      toast({ title: "Failed to download PDF", description: "An error occurred", variant: "destructive" });
    }
  };

  const filtered = getFilteredLineItems(sov.lineItems || [], billingMode);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {sov.sovNumber} - {sov.title}
          {getStatusBadge(sov.status)}
        </DialogTitle>
        <DialogDescription>
          {sov.projectCode} - {sov.projectName}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Contract Amount</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold" data-testid="text-contract-amount">{formatCurrency(sov.contractAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Total Billed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold" data-testid="text-total-billed">{formatCurrency(sov.totalCompleted)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Balance to Finish</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold" data-testid="text-balance-finish">{formatCurrency(sov.totalBalanceToFinish)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">% Complete</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-bold" data-testid="text-percent-complete">{formatPercent(sov.overallPercentComplete)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Billing Breakdown</Label>
            <p className="text-xs text-muted-foreground">Filter line items by cost category</p>
          </div>
          <Select value={billingMode} onValueChange={(val: any) => setBillingMode(val)}>
            <SelectTrigger className="w-[200px]" data-testid="select-billing-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="material">Material Only</SelectItem>
              <SelectItem value="labor">Labor Only</SelectItem>
              <SelectItem value="material_labor">Material + Labor</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {billingMode !== "all" && (() => {
          const totals = getFilteredTotals(filtered);
          return (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Badge variant="secondary">{billingModeLabels[billingMode]}</Badge>
                  <span className="text-sm text-muted-foreground">{filtered.length} of {sov.lineItems?.length || 0} line items</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Scheduled Value</p>
                    <p className="text-lg font-bold">{formatCurrency(String(totals.totalScheduledValue))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Previously Billed</p>
                    <p className="text-lg font-bold">{formatCurrency(String(totals.totalPreviouslyBilled))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Current Period</p>
                    <p className="text-lg font-bold">{formatCurrency(String(totals.totalCurrentBilled))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Balance to Finish</p>
                    <p className="text-lg font-bold">{formatCurrency(String(totals.totalBalance))}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold">Line Items</h3>
          {canEdit && sov.status === "DRAFT" && (
            <Button
              size="sm"
              onClick={() => setShowAddLineItemDialog(true)}
              data-testid="button-add-line-item"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Line Item
            </Button>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">#</TableHead>
              <TableHead className="w-32">Pay Item</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Scheduled Value</TableHead>
              <TableHead className="text-right">Previously Billed</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">% Complete</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              {canEdit && sov.status === "DRAFT" && (
                <TableHead className="w-16"></TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell>{item.itemNumber}</TableCell>
                <TableCell>
                  {item.payItemNumber ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="font-mono text-xs font-medium" data-testid={`text-sov-pay-item-${item.id}`}>
                        {item.payItemNumber}
                      </span>
                      {item.specSection && (
                        <span className="text-[10px] text-muted-foreground" data-testid={`text-sov-spec-section-${item.id}`}>
                          §{item.specSection}
                        </span>
                      )}
                    </div>
                  ) : item.itemCode ? (
                    <span className="font-mono text-xs text-muted-foreground">{item.itemCode}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{item.description}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.scheduledValue)}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.previouslyBilled)}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.currentBilled)}</TableCell>
                <TableCell className="text-right">{formatPercent(item.percentComplete)}</TableCell>
                <TableCell className="text-right">{formatCurrency(item.balanceToFinish)}</TableCell>
                {canEdit && sov.status === "DRAFT" && (
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteLineItemMutation.mutate({ sovId: sov.id, itemId: item.id })}
                      data-testid={`button-delete-item-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit && sov.status === "DRAFT" ? 9 : 8} className="text-center text-muted-foreground py-8">
                  No line items yet. Add items to build your SOV.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between gap-4 pt-4 border-t flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && sov.status === "DRAFT" && (
              <Button
                variant="outline"
                onClick={() => updateStatusMutation.mutate({ id: sov.id, status: "PENDING" })}
                disabled={updateStatusMutation.isPending}
                data-testid="button-submit-for-approval"
              >
                <Send className="h-4 w-4 mr-2" />
                Submit for Approval
              </Button>
            )}
            {canApprove && sov.status === "PENDING" && (
              <>
                <Button
                  onClick={() => updateStatusMutation.mutate({ id: sov.id, status: "APPROVED" })}
                  disabled={updateStatusMutation.isPending}
                  data-testid="button-approve-sov"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => updateStatusMutation.mutate({ id: sov.id, status: "REJECTED" })}
                  disabled={updateStatusMutation.isPending}
                  data-testid="button-reject-sov"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </>
            )}
            {sov.status === "APPROVED" && canEdit && (
              <Button
                onClick={() => updateStatusMutation.mutate({ id: sov.id, status: "SUBMITTED" })}
                disabled={updateStatusMutation.isPending}
                data-testid="button-mark-submitted"
              >
                <Send className="h-4 w-4 mr-2" />
                Mark as Submitted
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => downloadPDF(sov.id, billingMode)}
              data-testid="button-download-pdf"
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowSendDialog(true)}
              data-testid="button-send-to-rep"
            >
              <Send className="h-4 w-4 mr-2" />
              Send to Representative
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="button-close-sov-detail"
            >
              Close
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showAddLineItemDialog} onOpenChange={setShowAddLineItemDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={lineItemForm.description}
                onChange={(e) => setLineItemForm({...lineItemForm, description: e.target.value})}
                placeholder="e.g., Site Preparation, Foundation Work"
                data-testid="input-item-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Scheduled Value</Label>
              <Input
                type="number"
                value={lineItemForm.scheduledValue}
                onChange={(e) => setLineItemForm({...lineItemForm, scheduledValue: e.target.value})}
                placeholder="0.00"
                data-testid="input-item-value"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLineItemDialog(false)} data-testid="button-cancel-line-item">
              Cancel
            </Button>
            <Button
              onClick={() => addLineItemMutation.mutate({
                sovId: sov.id,
                description: lineItemForm.description,
                scheduledValue: lineItemForm.scheduledValue
              })}
              disabled={!lineItemForm.description || !lineItemForm.scheduledValue || addLineItemMutation.isPending}
              data-testid="button-submit-line-item"
            >
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send to Representative</DialogTitle>
            <DialogDescription>
              Email the billing breakdown PDF to a representative
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Billing Type</Label>
              <div className="text-sm">
                <Badge variant="secondary">{billingModeLabels[billingMode]}</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Recipient Email</Label>
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="representative@company.com"
                data-testid="input-rep-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)} data-testid="button-cancel-send">
              Cancel
            </Button>
            <Button
              onClick={() => sendToRepMutation.mutate({ sovId: sov.id, email: sendEmail, billingMode })}
              disabled={!sendEmail || sendToRepMutation.isPending}
              data-testid="button-confirm-send"
            >
              {sendToRepMutation.isPending ? "Sending..." : "Send PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
