import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { Plus, Trash2, Send, Check, X, ArrowRight, Package, FileText, Truck, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  usePurchaseRequests, useCreatePurchaseRequest, useSubmitPurchaseRequest,
  useApprovePurchaseRequest, useRejectPurchaseRequest, useConvertPRToPO, useDeletePurchaseRequest,
  usePurchaseOrders, usePurchaseOrderDetail, useCreatePurchaseOrder,
  useSubmitPurchaseOrder, useApprovePurchaseOrder, useRejectPurchaseOrder, useSendPurchaseOrder, useDeletePurchaseOrder,
  useCreatePOReceipt, useProcurementReceipts,
  useVendorInvoices, useCreateVendorInvoice,
  useCreateInvoiceMatch, useResolveMatchDiscrepancy,
  type ProcurementReceipt, type ProcurementReceiptItem,
} from "@/hooks/use-data";
import type { Project } from "@shared/schema";

const PR_STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  DRAFT: "outline", PENDING_APPROVAL: "secondary", APPROVED: "default", REJECTED: "destructive", CONVERTED_TO_PO: "default",
};
const PO_STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  DRAFT: "outline", PENDING_APPROVAL: "secondary", APPROVED: "default", SENT: "default",
  ACKNOWLEDGED: "default", PARTIAL: "secondary", FULFILLED: "default", CANCELLED: "destructive",
};
const INVOICE_STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  PENDING: "outline", MATCHED: "default", APPROVED: "default", PAID: "default", DISPUTED: "destructive",
};
const MATCH_STATUS_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  PENDING: "outline", MATCHED: "default", DISCREPANCY: "destructive",
};

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/To Po/i, "to PO");
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtCurrency(v: string | number | null | undefined) {
  const n = parseFloat(String(v || "0"));
  if (isNaN(n) || n === 0) return "-";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface LineItem {
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitCost?: string;
  unitCost?: string;
  category?: string;
  costCode?: string;
}

interface VendorRef {
  id: string;
  name: string;
}

interface POItem {
  id: string;
  poId: string;
  description: string;
  quantity: string | null;
  unit: string | null;
  unitCost: string | null;
  quantityReceived: string | null;
  costCode: string | null;
}

interface PRItem {
  id: string;
  prId: string;
  description: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  estimatedUnitCost: string | null;
  costCode: string | null;
}

interface PurchaseRequest {
  id: string;
  prNumber: string;
  title: string;
  status: string;
  project?: { name: string; code: string } | null;
  createdAt: string;
  neededByDate: string | null;
  totalEstimatedCost: string | null;
  requestedBy?: { firstName: string; lastName: string } | null;
  items?: PRItem[];
}

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  totalCost: string | null;
  neededByDate: string | null;
  vendorId: string | null;
  vendor?: VendorRef | null;
  project?: { name: string; code: string } | null;
  items: POItem[];
  receipts: POReceiptSummary[];
  invoices: InvoiceSummary[];
  terms?: string | null;
}

interface POReceiptSummary {
  id: string;
  status: string;
  receivedAt: string;
  deliveryNote: string | null;
  notes: string | null;
  receivedBy?: { firstName: string; lastName: string } | null;
  items: { id: string; poItemId: string; quantityReceived: string; condition: string; notes: string | null }[];
}

interface MatchDetail {
  matchStatus: string;
  poAmount?: string;
  invoiceAmount?: string;
  receivedQtyMatchPct?: string;
  resolvedAt?: string | null;
}

interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  invoiceDate: string;
  dueDate: string | null;
  match?: MatchDetail | null;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
  invoiceDate: string;
  dueDate: string | null;
  po?: { poNumber: string } | null;
  vendor?: VendorRef | null;
  match?: MatchDetail | null;
}

interface ProcurementTabProps {
  projectCode: string;
  project: Project;
}

function ProjectPurchaseRequestsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: prs = [], isLoading } = usePurchaseRequests({ projectId });
  const createMutation = useCreatePurchaseRequest();
  const submitMutation = useSubmitPurchaseRequest();
  const approveMutation = useApprovePurchaseRequest();
  const rejectMutation = useRejectPurchaseRequest();
  const convertMutation = useConvertPRToPO();
  const deleteMutation = useDeletePurchaseRequest();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedPRId, setExpandedPRId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", neededByDate: "", notes: "" });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
  const [rejectingPRId, setRejectingPRId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
  const removeLineItem = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLineItem = (i: number, field: string, value: string) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        projectId,
        title: form.title,
        neededByDate: form.neededByDate || null,
        notes: form.notes || null,
        items: lineItems.filter(li => li.description.trim()),
      });
      toast({ title: "Purchase request created" });
      setShowCreate(false);
      setForm({ title: "", neededByDate: "", notes: "" });
      setLineItems([{ description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
    } catch { toast({ title: "Failed to create request", variant: "destructive" }); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Purchase Requests</CardTitle>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-pr"><Plus className="w-4 h-4 mr-2" />New Request</Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : prs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No purchase requests for this project</div>
        ) : (
          <div className="space-y-3">
            {prs.map((pr: PurchaseRequest) => (
              <div key={pr.id} className="border rounded-md" data-testid={`pr-${pr.id}`}>
                <div className="flex items-start justify-between p-4 gap-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpandedPRId(expandedPRId === pr.id ? null : pr.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{pr.prNumber}</span>
                      <Badge variant={PR_STATUS_VARIANT[pr.status] || "outline"}>{statusLabel(pr.status)}</Badge>
                    </div>
                    <p className="font-medium">{pr.title}</p>
                    <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                      {pr.requestedBy && <span>By: {pr.requestedBy.firstName} {pr.requestedBy.lastName}</span>}
                      <span>Needed: {fmtDate(pr.neededByDate)}</span>
                      <span>Est: {fmtCurrency(pr.totalEstimatedCost)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {pr.status === "DRAFT" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { try { await submitMutation.mutateAsync(pr.id); toast({ title: "Submitted for approval" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-submit-pr-${pr.id}`}>
                          <Send className="h-3.5 w-3.5 mr-1" />Submit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { try { await deleteMutation.mutateAsync(pr.id); toast({ title: "Deleted" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-delete-pr-${pr.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {pr.status === "PENDING_APPROVAL" && (
                      <>
                        <Button size="sm" variant="default" onClick={async () => { try { await approveMutation.mutateAsync(pr.id); toast({ title: "Approved" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-approve-pr-${pr.id}`}>
                          <Check className="h-3.5 w-3.5 mr-1" />Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectingPRId(pr.id); setRejectNotes(""); }} data-testid={`button-reject-pr-${pr.id}`}>
                          <X className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                      </>
                    )}
                    {pr.status === "APPROVED" && (
                      <Button size="sm" variant="default" onClick={async () => { try { await convertMutation.mutateAsync({ id: pr.id }); toast({ title: "Converted to PO" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-convert-pr-${pr.id}`}>
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />Convert to PO
                      </Button>
                    )}
                  </div>
                </div>
                {expandedPRId === pr.id && pr.items && pr.items.length > 0 && (
                  <div className="px-4 pb-4 pt-0 border-t">
                    <h4 className="font-semibold text-sm mt-3 mb-2">Line Items</h4>
                    <div className="space-y-2">
                      {pr.items.map((item: PRItem) => (
                        <div key={item.id} className="text-sm p-2 border rounded">
                          <p className="font-medium">{item.description}</p>
                          <p className="text-muted-foreground">{item.quantity} {item.unit} @ {fmtCurrency(item.estimatedUnitCost)}</p>
                          {item.costCode && <p className="text-xs text-blue-500">Cost Code: {item.costCode}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl" data-testid="dialog-create-pr">
          <DialogHeader>
            <DialogTitle>New Purchase Request</DialogTitle>
            <DialogDescription>Create a purchase request with line items for approval.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Title *</Label>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Brief description of what you need..." data-testid="input-pr-title" />
              </div>
              <div>
                <Label>Needed By</Label>
                <Input type="date" value={form.neededByDate} onChange={e => setForm({ ...form, neededByDate: e.target.value })} data-testid="input-pr-needed-by" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-pr-notes" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLineItem} data-testid="button-add-pr-line"><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
            </div>
            {lineItems.map((li, i) => (
              <div key={i} className="space-y-2 p-3 border rounded-md">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs">Description</Label>
                    <Input value={li.description} onChange={e => updateLineItem(i, "description", e.target.value)} placeholder="Material/item..." data-testid={`input-pr-line-desc-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" step="0.01" value={li.quantity} onChange={e => updateLineItem(i, "quantity", e.target.value)} data-testid={`input-pr-line-qty-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit</Label>
                    <Input value={li.unit} onChange={e => updateLineItem(i, "unit", e.target.value)} placeholder="ea, lf..." data-testid={`input-pr-line-unit-${i}`} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Est. Unit Cost</Label>
                    <Input type="number" step="0.01" value={li.estimatedUnitCost} onChange={e => updateLineItem(i, "estimatedUnitCost", e.target.value)} data-testid={`input-pr-line-cost-${i}`} />
                  </div>
                  <div className="col-span-1">
                    {lineItems.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLineItem(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Cost Code</Label>
                  <CostCodeCombobox value={li.costCode || ""} onChange={(val) => updateLineItem(i, "costCode", val)} data-testid={`input-pr-line-costcode-${i}`} />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-create-pr">
              {createMutation.isPending ? "Creating..." : "Create Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectingPRId} onOpenChange={o => { if (!o) setRejectingPRId(null); }}>
        <DialogContent data-testid="dialog-reject-pr">
          <DialogHeader>
            <DialogTitle>Reject Purchase Request</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this request.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea value={rejectNotes} onChange={e => setRejectNotes(e.target.value)} rows={3} placeholder="Explain why this request is being rejected..." data-testid="input-reject-pr-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingPRId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectNotes.trim() || rejectMutation.isPending} onClick={async () => { if (!rejectingPRId || !rejectNotes.trim()) return; try { await rejectMutation.mutateAsync({ id: rejectingPRId, rejectionNotes: rejectNotes.trim() }); toast({ title: "Rejected" }); setRejectingPRId(null); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid="button-confirm-reject-pr">
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProjectPurchaseOrdersTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: pos = [], isLoading } = usePurchaseOrders({ projectId });
  const { data: vendors = [] } = useQuery<VendorRef[]>({ queryKey: ["/api/crm/organisations"] });
  const createMutation = useCreatePurchaseOrder();
  const submitMutation = useSubmitPurchaseOrder();
  const approveMutation = useApprovePurchaseOrder();
  const rejectPOMutation = useRejectPurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const deleteMutation = useDeletePurchaseOrder();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [form, setForm] = useState({ vendorId: "", terms: "", deliveryAddress: "", neededByDate: "", notes: "" });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
  const [rejectingPOId, setRejectingPOId] = useState<string | null>(null);
  const [rejectPONotes, setRejectPONotes] = useState("");

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
  const removeLineItem = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLineItem = (i: number, field: string, value: string) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const handleCreate = async () => {
    const validItems = lineItems.filter(li => li.description.trim());
    if (validItems.length === 0) { toast({ title: "At least one line item is required", variant: "destructive" }); return; }
    try {
      await createMutation.mutateAsync({
        projectId,
        vendorId: form.vendorId || null,
        terms: form.terms || null,
        deliveryAddress: form.deliveryAddress || null,
        neededByDate: form.neededByDate || null,
        notes: form.notes || null,
        items: validItems,
      });
      toast({ title: "Purchase order created" });
      setShowCreate(false);
      setForm({ vendorId: "", terms: "", deliveryAddress: "", neededByDate: "", notes: "" });
      setLineItems([{ description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
    } catch { toast({ title: "Failed to create PO", variant: "destructive" }); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Purchase Orders</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-po"><Plus className="w-4 h-4 mr-2" />New PO</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : pos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No purchase orders for this project</div>
          ) : (
            <div className="space-y-3">
              {pos.map((po: PurchaseOrder) => (
                <div key={po.id} className="flex items-start justify-between p-4 border rounded-md gap-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedPOId(po.id)} data-testid={`po-${po.id}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{po.poNumber}</span>
                      <Badge variant={PO_STATUS_VARIANT[po.status] || "outline"}>{statusLabel(po.status)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                      {po.vendor && <span>{po.vendor.name}</span>}
                      <span>Needed: {fmtDate(po.neededByDate)}</span>
                      <span>Total: {fmtCurrency(po.totalCost)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {po.status === "DRAFT" && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => { try { await submitMutation.mutateAsync(po.id); toast({ title: "Submitted" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-submit-po-${po.id}`}>
                          <Send className="h-3.5 w-3.5 mr-1" />Submit
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { try { await deleteMutation.mutateAsync(po.id); toast({ title: "Deleted" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {po.status === "PENDING_APPROVAL" && (
                      <>
                        <Button size="sm" variant="default" onClick={async () => { try { await approveMutation.mutateAsync(po.id); toast({ title: "Approved" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-approve-po-${po.id}`}>
                          <Check className="h-3.5 w-3.5 mr-1" />Approve
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectingPOId(po.id); setRejectPONotes(""); }} data-testid={`button-reject-po-${po.id}`}>
                          <X className="h-3.5 w-3.5 mr-1" />Reject
                        </Button>
                      </>
                    )}
                    {po.status === "APPROVED" && (
                      <Button size="sm" variant="default" onClick={async () => { try { await sendMutation.mutateAsync(po.id); toast({ title: "Marked as Sent" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }}>
                        <Send className="h-3.5 w-3.5 mr-1" />Mark Sent
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl" data-testid="dialog-create-po">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>Create a purchase order with line items.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Vendor</Label>
                <Select value={form.vendorId} onValueChange={v => setForm({ ...form, vendorId: v })}>
                  <SelectTrigger data-testid="select-po-vendor"><SelectValue placeholder="Select vendor..." /></SelectTrigger>
                  <SelectContent>{(vendors || []).map((v: VendorRef) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Needed By</Label>
                <Input type="date" value={form.neededByDate} onChange={e => setForm({ ...form, neededByDate: e.target.value })} data-testid="input-po-needed-by" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Terms</Label>
                <Input value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} placeholder="Net 30, COD..." data-testid="input-po-terms" />
              </div>
              <div>
                <Label>Delivery Address</Label>
                <Input value={form.deliveryAddress} onChange={e => setForm({ ...form, deliveryAddress: e.target.value })} data-testid="input-po-address" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} data-testid="input-po-notes" />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Line Items</Label>
              <Button size="sm" variant="outline" onClick={addLineItem} data-testid="button-add-po-line"><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
            </div>
            {lineItems.map((li, i) => (
              <div key={i} className="space-y-2 p-3 border rounded-md">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs">Description</Label>
                    <Input value={li.description} onChange={e => updateLineItem(i, "description", e.target.value)} placeholder="Material/item..." data-testid={`input-po-line-desc-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" step="0.01" value={li.quantity} onChange={e => updateLineItem(i, "quantity", e.target.value)} data-testid={`input-po-line-qty-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit</Label>
                    <Input value={li.unit} onChange={e => updateLineItem(i, "unit", e.target.value)} placeholder="ea, lf..." data-testid={`input-po-line-unit-${i}`} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Unit Cost</Label>
                    <Input type="number" step="0.01" value={li.unitCost} onChange={e => updateLineItem(i, "unitCost", e.target.value)} data-testid={`input-po-line-cost-${i}`} />
                  </div>
                  <div className="col-span-1">
                    {lineItems.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeLineItem(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Cost Code</Label>
                  <CostCodeCombobox value={li.costCode || ""} onChange={(val) => updateLineItem(i, "costCode", val)} data-testid={`input-po-line-costcode-${i}`} />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-create-po">
              {createMutation.isPending ? "Creating..." : "Create PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedPOId && <ProjectPODetailSheet poId={selectedPOId} onClose={() => setSelectedPOId(null)} />}

      <Dialog open={!!rejectingPOId} onOpenChange={o => { if (!o) setRejectingPOId(null); }}>
        <DialogContent data-testid="dialog-reject-po">
          <DialogHeader>
            <DialogTitle>Reject Purchase Order</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this purchase order.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Rejection Reason *</Label>
            <Textarea value={rejectPONotes} onChange={e => setRejectPONotes(e.target.value)} rows={3} placeholder="Explain why this PO is being rejected..." data-testid="input-reject-po-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingPOId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectPONotes.trim() || rejectPOMutation.isPending} onClick={async () => { if (!rejectingPOId || !rejectPONotes.trim()) return; try { await rejectPOMutation.mutateAsync({ id: rejectingPOId, rejectionNotes: rejectPONotes.trim() }); toast({ title: "Rejected" }); setRejectingPOId(null); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid="button-confirm-reject-po">
              {rejectPOMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectPODetailSheet({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: po, isLoading } = usePurchaseOrderDetail(poId);
  const createReceiptMutation = useCreatePOReceipt();
  const createInvoiceMutation = useCreateVendorInvoice();
  const createMatchMutation = useCreateInvoiceMatch();
  const resolveMutation = useResolveMatchDiscrepancy();

  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptItems, setReceiptItems] = useState<{ poItemId: string; quantityReceived: string; condition: string; notes: string }[]>([]);
  const [receiptNotes, setReceiptNotes] = useState("");

  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: "", invoiceDate: "", dueDate: "", totalAmount: "", notes: "" });

  const [resolveInvoiceId, setResolveInvoiceId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const openReceiptDialog = () => {
    if (po?.items) {
      setReceiptItems(po.items.map((item: POItem) => ({
        poItemId: item.id,
        quantityReceived: "",
        condition: "GOOD",
        notes: "",
      })));
    }
    setReceiptNotes("");
    setShowReceiptDialog(true);
  };

  const handleCreateReceipt = async () => {
    const validItems = receiptItems.filter(ri => parseFloat(ri.quantityReceived) > 0);
    if (validItems.length === 0) { toast({ title: "Enter at least one received quantity", variant: "destructive" }); return; }
    try {
      await createReceiptMutation.mutateAsync({
        poId,
        data: { notes: receiptNotes || null, items: validItems },
      });
      toast({ title: "Receipt recorded" });
      setShowReceiptDialog(false);
    } catch { toast({ title: "Failed to record receipt", variant: "destructive" }); }
  };

  const handleCreateInvoice = async () => {
    if (!invoiceForm.invoiceNumber || !invoiceForm.invoiceDate || !invoiceForm.totalAmount) {
      toast({ title: "Invoice number, date, and amount are required", variant: "destructive" }); return;
    }
    try {
      await createInvoiceMutation.mutateAsync({
        poId,
        vendorId: po?.vendorId || null,
        ...invoiceForm,
      });
      toast({ title: "Invoice recorded" });
      setShowInvoiceDialog(false);
      setInvoiceForm({ invoiceNumber: "", invoiceDate: "", dueDate: "", totalAmount: "", notes: "" });
    } catch { toast({ title: "Failed to record invoice", variant: "destructive" }); }
  };

  return (
    <>
      <Sheet open={true} onOpenChange={open => { if (!open) onClose(); }}>
        <SheetContent className="sm:max-w-xl overflow-y-auto" data-testid="sheet-po-detail">
          <SheetHeader>
            <SheetTitle>{po?.poNumber || "Loading..."}</SheetTitle>
            <SheetDescription>Purchase order details and lifecycle</SheetDescription>
          </SheetHeader>
          {isLoading || !po ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <div className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Status:</span> <Badge variant={PO_STATUS_VARIANT[po.status] || "outline"}>{statusLabel(po.status)}</Badge></div>
                <div><span className="text-muted-foreground">Vendor:</span> {po.vendor?.name || "-"}</div>
                <div><span className="text-muted-foreground">Needed By:</span> {fmtDate(po.neededByDate)}</div>
                <div><span className="text-muted-foreground">Total:</span> {fmtCurrency(po.totalCost)}</div>
                {po.terms && <div><span className="text-muted-foreground">Terms:</span> {po.terms}</div>}
              </div>

              <Separator />
              <div>
                <h4 className="font-semibold mb-2">Line Items</h4>
                {po.items?.length > 0 ? (
                  <div className="space-y-2">
                    {po.items.map((item: POItem) => {
                      const ordered = parseFloat(item.quantity || "0");
                      const received = parseFloat(item.quantityReceived || "0");
                      return (
                        <div key={item.id} className="flex justify-between text-sm p-2 border rounded">
                          <div>
                            <p className="font-medium">{item.description}</p>
                            <p className="text-muted-foreground">{item.quantity} {item.unit} @ {fmtCurrency(item.unitCost)}</p>
                            {item.costCode && <p className="text-xs text-blue-500">Cost Code: {item.costCode}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">Received: {received}/{ordered}</p>
                            {ordered > 0 && (
                              <div className="w-20 h-1.5 bg-muted rounded-full mt-1">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min((received / ordered) * 100, 100)}%` }} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No line items</p>}
              </div>

              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold flex items-center gap-1"><Truck className="h-4 w-4" /> Receipts ({po.receipts?.length || 0})</h4>
                  {["SENT", "ACKNOWLEDGED", "PARTIAL", "APPROVED"].includes(po.status) && (
                    <Button size="sm" variant="outline" onClick={openReceiptDialog} data-testid="button-record-receipt">
                      <Plus className="h-3.5 w-3.5 mr-1" />Record Receipt
                    </Button>
                  )}
                </div>
                {po.receipts?.length > 0 ? (
                  <div className="space-y-2">
                    {po.receipts.map((r: POReceiptSummary) => (
                      <div key={r.id} className="text-sm p-2 border rounded">
                        <div className="flex justify-between">
                          <span>{fmtDate(r.receivedAt)} - {r.receivedBy?.firstName} {r.receivedBy?.lastName}</span>
                          <Badge variant={r.status === "COMPLETE" ? "default" : "secondary"}>{r.status}</Badge>
                        </div>
                        {r.notes && <p className="text-muted-foreground text-xs mt-1">{r.notes}</p>}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No receipts recorded</p>}
              </div>

              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold flex items-center gap-1"><FileText className="h-4 w-4" /> Invoices ({po.invoices?.length || 0})</h4>
                  <Button size="sm" variant="outline" onClick={() => setShowInvoiceDialog(true)} data-testid="button-add-invoice">
                    <Plus className="h-3.5 w-3.5 mr-1" />Add Invoice
                  </Button>
                </div>
                {po.invoices?.length > 0 ? (
                  <div className="space-y-2">
                    {po.invoices.map((inv: InvoiceSummary) => (
                      <div key={inv.id} className="text-sm p-2 border rounded">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                            <span className="ml-2">{fmtCurrency(inv.totalAmount)}</span>
                            <span className="ml-2 text-muted-foreground text-xs">{fmtDate(inv.invoiceDate)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={INVOICE_STATUS_VARIANT[inv.status] || "outline"}>{inv.status}</Badge>
                            {inv.match && <Badge variant={MATCH_STATUS_VARIANT[inv.match.matchStatus] || "outline"} className="text-xs">{inv.match.matchStatus}</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          {!inv.match && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={async () => { try { await createMatchMutation.mutateAsync(inv.id); toast({ title: "3-way match completed" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-match-${inv.id}`}>
                              Run 3-Way Match
                            </Button>
                          )}
                          {inv.match?.matchStatus === "DISCREPANCY" && !inv.match.resolvedAt && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setResolveInvoiceId(inv.id); setResolveNotes(""); }} data-testid={`button-resolve-${inv.id}`}>
                              Resolve Discrepancy
                            </Button>
                          )}
                          {inv.match?.matchStatus === "DISCREPANCY" && (
                            <span className="text-xs text-muted-foreground">
                              PO: {fmtCurrency(inv.match.poAmount)} | Inv: {fmtCurrency(inv.match.invoiceAmount)} | Recv: {inv.match.receivedQtyMatchPct}%
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No invoices recorded</p>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="max-w-lg" data-testid="dialog-record-receipt">
          <DialogHeader>
            <DialogTitle>Record Delivery Receipt</DialogTitle>
            <DialogDescription>Enter quantities received for each line item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {receiptItems.map((ri, i) => {
              const poItem = po?.items?.find((it: POItem) => it.id === ri.poItemId);
              return (
                <div key={ri.poItemId} className="p-3 border rounded space-y-2">
                  <p className="text-sm font-medium">{poItem?.description}</p>
                  <p className="text-xs text-muted-foreground">Ordered: {poItem?.quantity} {poItem?.unit} | Already received: {poItem?.quantityReceived || 0}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Qty Received</Label>
                      <Input type="number" step="0.01" value={ri.quantityReceived} onChange={e => { const u = [...receiptItems]; u[i].quantityReceived = e.target.value; setReceiptItems(u); }} data-testid={`input-receipt-qty-${i}`} />
                    </div>
                    <div>
                      <Label className="text-xs">Condition</Label>
                      <Select value={ri.condition} onValueChange={v => { const u = [...receiptItems]; u[i].condition = v; setReceiptItems(u); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GOOD">Good</SelectItem>
                          <SelectItem value="DAMAGED">Damaged</SelectItem>
                          <SelectItem value="REJECTED">Rejected</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Notes</Label>
                      <Input value={ri.notes} onChange={e => { const u = [...receiptItems]; u[i].notes = e.target.value; setReceiptItems(u); }} />
                    </div>
                  </div>
                </div>
              );
            })}
            <div>
              <Label>Delivery Notes</Label>
              <Textarea value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiptDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateReceipt} disabled={createReceiptMutation.isPending} data-testid="button-submit-receipt">
              {createReceiptMutation.isPending ? "Saving..." : "Record Receipt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent data-testid="dialog-add-invoice">
          <DialogHeader>
            <DialogTitle>Add Vendor Invoice</DialogTitle>
            <DialogDescription>Record an invoice from the vendor for this PO.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Invoice Number *</Label>
              <Input value={invoiceForm.invoiceNumber} onChange={e => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })} data-testid="input-invoice-number" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Date *</Label>
                <Input type="date" value={invoiceForm.invoiceDate} onChange={e => setInvoiceForm({ ...invoiceForm, invoiceDate: e.target.value })} data-testid="input-invoice-date" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={invoiceForm.dueDate} onChange={e => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} data-testid="input-invoice-due" />
              </div>
            </div>
            <div>
              <Label>Total Amount *</Label>
              <Input type="number" step="0.01" value={invoiceForm.totalAmount} onChange={e => setInvoiceForm({ ...invoiceForm, totalAmount: e.target.value })} data-testid="input-invoice-amount" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={invoiceForm.notes} onChange={e => setInvoiceForm({ ...invoiceForm, notes: e.target.value })} rows={2} data-testid="input-invoice-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvoiceDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateInvoice} disabled={createInvoiceMutation.isPending} data-testid="button-submit-invoice">
              {createInvoiceMutation.isPending ? "Saving..." : "Add Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveInvoiceId} onOpenChange={open => { if (!open) setResolveInvoiceId(null); }}>
        <DialogContent data-testid="dialog-resolve-discrepancy">
          <DialogHeader>
            <DialogTitle>Resolve Discrepancy</DialogTitle>
            <DialogDescription>Provide a note explaining how the discrepancy was resolved.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Resolution Notes</Label>
            <Textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} rows={3} data-testid="input-resolve-notes" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveInvoiceId(null)}>Cancel</Button>
            <Button onClick={async () => {
              if (!resolveInvoiceId) return;
              try {
                await resolveMutation.mutateAsync({ invoiceId: resolveInvoiceId, notes: resolveNotes });
                toast({ title: "Discrepancy resolved" });
                setResolveInvoiceId(null);
              } catch { toast({ title: "Failed", variant: "destructive" }); }
            }} disabled={resolveMutation.isPending} data-testid="button-submit-resolve">
              {resolveMutation.isPending ? "Resolving..." : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProjectReceiptsTab({ projectId }: { projectId: string }) {
  const { data: receipts = [], isLoading } = useProcurementReceipts(projectId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Delivery Receipts</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No delivery receipts for this project. Record receipts from a PO detail view.</div>
        ) : (
          <div className="space-y-3">
            {receipts.map((r: ProcurementReceipt) => (
              <div key={r.id} className="p-4 border rounded-md" data-testid={`receipt-${r.id}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {r.poNumber && <span className="font-mono text-xs text-muted-foreground">PO: {r.poNumber}</span>}
                    <Badge variant={r.status === "COMPLETE" ? "default" : "secondary"}>{r.status}</Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">{fmtDate(r.receivedAt)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                  {r.receivedBy && <span>By: {r.receivedBy.firstName} {r.receivedBy.lastName}</span>}
                  {r.vendor && <span>Vendor: {r.vendor.name}</span>}
                  {r.deliveryNote && <span>Note: {r.deliveryNote}</span>}
                </div>
                {r.items?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {r.items.map((item: ProcurementReceiptItem) => (
                      <div key={item.id} className="text-xs flex gap-2 text-muted-foreground">
                        {item.itemDescription && <span className="font-medium text-foreground">{item.itemDescription}</span>}
                        <span>Qty: {item.quantityReceived}</span>
                        <Badge variant={item.condition === "GOOD" ? "outline" : "destructive"} className="text-[10px] px-1 py-0">{item.condition}</Badge>
                        {item.notes && <span>{item.notes}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectInvoicesTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data: invoices = [], isLoading } = useVendorInvoices({ projectId });
  const createMatchMutation = useCreateInvoiceMatch();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Vendor Invoices</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No vendor invoices for this project. Add invoices from a PO detail view.</div>
        ) : (
          <div className="space-y-3">
            {invoices.map((inv: InvoiceRow) => (
              <div key={inv.id} className="flex items-center justify-between p-4 border rounded-md gap-3" data-testid={`invoice-${inv.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                    <Badge variant={INVOICE_STATUS_VARIANT[inv.status] || "outline"}>{inv.status}</Badge>
                    {inv.match && <Badge variant={MATCH_STATUS_VARIANT[inv.match.matchStatus] || "outline"} className="text-xs">{inv.match.matchStatus}</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                    {inv.po && <span>PO: {inv.po.poNumber}</span>}
                    {inv.vendor && <span>{inv.vendor.name}</span>}
                    <span>Date: {fmtDate(inv.invoiceDate)}</span>
                    {inv.dueDate && <span>Due: {fmtDate(inv.dueDate)}</span>}
                    <span className="font-medium text-foreground">{fmtCurrency(inv.totalAmount)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!inv.match && (
                    <Button size="sm" variant="outline" onClick={async () => { try { await createMatchMutation.mutateAsync(inv.id); toast({ title: "3-way match completed" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-match-invoice-${inv.id}`}>
                      Run 3-Way Match
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProcurementTab({ projectCode, project }: ProcurementTabProps) {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList data-testid="tabs-project-procurement">
          <TabsTrigger value="requests" data-testid="tab-project-pr"><ClipboardCheck className="h-4 w-4 mr-1" />Requests</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-project-po"><Package className="h-4 w-4 mr-1" />Orders</TabsTrigger>
          <TabsTrigger value="receipts" data-testid="tab-project-receipts"><Truck className="h-4 w-4 mr-1" />Receipts</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-project-invoices"><FileText className="h-4 w-4 mr-1" />Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <ProjectPurchaseRequestsTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="orders">
          <ProjectPurchaseOrdersTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="receipts">
          <ProjectReceiptsTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="invoices">
          <ProjectInvoicesTab projectId={project.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
