import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { Plus, Trash2, Send, Check, X, ArrowRight, Package, FileText, Truck, ClipboardCheck, Search, DollarSign, AlertCircle, Edit, Upload, Loader2, ChevronsLeft, ChevronsRight, ChevronDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { usePagination } from "@/hooks/use-pagination";
import {
  usePurchaseRequests, useCreatePurchaseRequest, useUpdatePurchaseRequest, useSubmitPurchaseRequest,
  useApprovePurchaseRequest, useRejectPurchaseRequest, useConvertPRToPO, useDeletePurchaseRequest,
  usePurchaseOrders, usePurchaseOrderDetail, useCreatePurchaseOrder, useUpdatePurchaseOrder,
  useSubmitPurchaseOrder, useApprovePurchaseOrder, useRejectPurchaseOrder, useSendPurchaseOrder, useDeletePurchaseOrder,
  useCreatePOReceipt, useProcurementReceipts,
  useVendorInvoices, useCreateVendorInvoice,
  useCreateInvoiceMatch, useResolveMatchDiscrepancy, useUpdateVendorInvoice,
  useInvoicePayments, useCreateInvoicePayment,
  type ProcurementPR, type ProcurementPRItem,
  type ProcurementPO, type ProcurementPOItem, type ProcurementPOReceipt, type ProcurementPOInvoice,
  type ProcurementInvoice,
  type ProcurementReceipt, type ProcurementReceiptItem, type InvoicePayment,
} from "@/hooks/use-data";

const PR_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "CONVERTED_TO_PO"];
const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACKNOWLEDGED", "PARTIAL", "FULFILLED", "CANCELLED"];
const INV_STATUSES = ["PENDING", "MATCHED", "APPROVED", "PAID", "DISPUTED"];

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

interface ProjectRef { id: string; name: string; code?: string | null; }
interface VendorRef { id: string; name: string; }

type POItem = ProcurementPOItem;
type PRItem = ProcurementPRItem;
type PurchaseRequest = ProcurementPR;
type PurchaseOrder = ProcurementPO;
type POReceiptSummary = ProcurementPOReceipt;
type InvoiceSummary = ProcurementPOInvoice;
type InvoiceRow = ProcurementInvoice;

function FilterBar({ search, onSearch, status, onStatus, statuses, placeholder, projectId, onProjectChange, projects }: {
  search: string; onSearch: (v: string) => void;
  status: string; onStatus: (v: string) => void;
  statuses: string[]; placeholder?: string;
  projectId?: string; onProjectChange?: (v: string) => void; projects?: ProjectRef[];
}) {
  const [localSearch, setLocalSearch] = useState(search);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = useCallback((v: string) => {
    setLocalSearch(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onSearch(v), 300);
  }, [onSearch]);
  useEffect(() => { setLocalSearch(search); }, [search]);
  useEffect(() => { return () => { if (timerRef.current) clearTimeout(timerRef.current); }; }, []);
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={localSearch} onChange={e => handleSearchChange(e.target.value)} placeholder={placeholder || "Search..."} className="pl-8" data-testid="input-filter-search" />
      </div>
      <Select value={status} onValueChange={onStatus}>
        <SelectTrigger className="w-[180px]" data-testid="select-filter-status">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All Statuses</SelectItem>
          {statuses.map(s => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
        </SelectContent>
      </Select>
      {projects && onProjectChange && (
        <Select value={projectId || "ALL"} onValueChange={onProjectChange}>
          <SelectTrigger className="w-[200px]" data-testid="select-filter-project">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function RejectDialog({ open, onClose, onConfirm, isPending, entityLabel }: {
  open: boolean; onClose: () => void; onConfirm: (notes: string) => void;
  isPending: boolean; entityLabel: string;
}) {
  const [notes, setNotes] = useState("");
  const notesEmpty = !notes.trim();
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { onClose(); setNotes(""); } }}>
      <DialogContent data-testid="dialog-reject">
        <DialogHeader>
          <DialogTitle>Reject {entityLabel}</DialogTitle>
          <DialogDescription>Provide a reason for rejecting this {entityLabel.toLowerCase()}.</DialogDescription>
        </DialogHeader>
        <div>
          <Label>Rejection Reason *</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Enter reason for rejection..." data-testid="input-rejection-notes" />
          {notesEmpty && <p className="text-xs text-destructive mt-1">A rejection reason is required.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setNotes(""); }}>Cancel</Button>
          <Button variant="destructive" onClick={() => { onConfirm(notes.trim()); setNotes(""); }} disabled={isPending || notesEmpty} data-testid="button-confirm-reject">
            {isPending ? "Rejecting..." : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaginationControls({ rangeStart, rangeEnd, totalItems, hasPrev, hasNext, onPrev, onNext }: {
  rangeStart: number; rangeEnd: number; totalItems: number;
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void;
}) {
  if (totalItems <= 25) return null;
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t">
      <span className="text-sm text-muted-foreground" data-testid="text-pagination-info">
        Showing {rangeStart}–{rangeEnd} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onPrev} disabled={!hasPrev} data-testid="button-pagination-prev">
          <ChevronsLeft className="h-4 w-4 mr-1" />Previous
        </Button>
        <Button size="sm" variant="outline" onClick={onNext} disabled={!hasNext} data-testid="button-pagination-next">
          Next<ChevronsRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function VendorCombobox({ value, onChange, vendors }: { value: string; onChange: (v: string) => void; vendors: VendorRef[] }) {
  const [open, setOpen] = useState(false);
  const selected = vendors.find(v => v.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" data-testid="combobox-po-vendor">
          {selected ? selected.name : "Select vendor..."}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search vendors..." data-testid="input-vendor-search" />
          <CommandList>
            <CommandEmpty>No vendors found.</CommandEmpty>
            <CommandGroup>
              {vendors.map(v => (
                <CommandItem key={v.id} value={v.name} onSelect={() => { onChange(v.id); setOpen(false); }} data-testid={`vendor-option-${v.id}`}>
                  <Check className={`mr-2 h-4 w-4 ${value === v.id ? "opacity-100" : "opacity-0"}`} />
                  {v.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PurchaseRequestsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const { data: prs = [], isLoading } = usePurchaseRequests({
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    search: search || undefined,
    projectId: projectFilter !== "ALL" ? projectFilter : undefined,
  });
  const { pageItems: pagedPRs, rangeStart: prStart, rangeEnd: prEnd, totalItems: prTotal, hasPrev: prHasPrev, hasNext: prHasNext, prevPage: prPrev, nextPage: prNext, resetPage: prResetPage } = usePagination(prs);
  useEffect(() => { prResetPage(); }, [search, statusFilter, projectFilter, prResetPage]);
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projectsList = projectsResponse?.data ?? [];
  const createMutation = useCreatePurchaseRequest();
  const updateMutation = useUpdatePurchaseRequest();
  const submitMutation = useSubmitPurchaseRequest();
  const approveMutation = useApprovePurchaseRequest();
  const rejectMutation = useRejectPurchaseRequest();
  const convertMutation = useConvertPRToPO();
  const deleteMutation = useDeletePurchaseRequest();

  const [showCreate, setShowCreate] = useState(false);
  const [editingPR, setEditingPR] = useState<PurchaseRequest | null>(null);
  const [expandedPRId, setExpandedPRId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [form, setForm] = useState({ projectId: "", title: "", neededByDate: "", notes: "" });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
  const removeLineItem = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLineItem = (i: number, field: string, value: string) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const handleCreate = async () => {
    if (!form.projectId || !form.title.trim()) {
      toast({ title: "Project and title are required", variant: "destructive" }); return;
    }
    try {
      await createMutation.mutateAsync({
        projectId: form.projectId, title: form.title,
        neededByDate: form.neededByDate || null, notes: form.notes || null,
        items: lineItems.filter(li => li.description.trim()),
      });
      toast({ title: "Purchase request created" });
      setShowCreate(false);
      setForm({ projectId: "", title: "", neededByDate: "", notes: "" });
      setLineItems([{ description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
    } catch { toast({ title: "Failed to create request", variant: "destructive" }); }
  };

  const openEdit = (pr: PurchaseRequest) => {
    setEditingPR(pr);
    setForm({ projectId: "", title: pr.title, neededByDate: pr.neededByDate?.split("T")[0] || "", notes: pr.notes || "" });
    setLineItems(pr.items?.map(i => ({
      description: i.description, quantity: i.quantity || "", unit: i.unit || "",
      estimatedUnitCost: i.estimatedUnitCost || "", category: i.category || "", costCode: i.costCode || "",
    })) || [{ description: "", quantity: "", unit: "", estimatedUnitCost: "", category: "", costCode: "" }]);
  };

  const handleEdit = async () => {
    if (!editingPR) return;
    try {
      await updateMutation.mutateAsync({
        id: editingPR.id,
        data: {
          title: form.title, neededByDate: form.neededByDate || null, notes: form.notes || null,
          items: lineItems.filter(li => li.description.trim()),
        },
      });
      toast({ title: "Purchase request updated" });
      setEditingPR(null);
    } catch { toast({ title: "Failed to update request", variant: "destructive" }); }
  };

  const renderForm = (isEdit: boolean) => (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
      {!isEdit && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Project *</Label>
            <Select value={form.projectId} onValueChange={v => setForm({ ...form, projectId: v })}>
              <SelectTrigger data-testid="select-pr-project"><SelectValue placeholder="Select project..." /></SelectTrigger>
              <SelectContent>{projectsList.map((p: ProjectRef) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Needed By</Label>
            <Input type="date" value={form.neededByDate} onChange={e => setForm({ ...form, neededByDate: e.target.value })} data-testid="input-pr-needed-by" />
          </div>
        </div>
      )}
      {isEdit && (
        <div>
          <Label>Needed By</Label>
          <Input type="date" value={form.neededByDate} onChange={e => setForm({ ...form, neededByDate: e.target.value })} data-testid="input-pr-needed-by" />
        </div>
      )}
      <div>
        <Label>Title *</Label>
        <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Brief description..." data-testid="input-pr-title" />
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
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5" /> Purchase Requests</CardTitle>
        <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-new-pr"><Plus className="w-4 h-4 mr-2" />New Request</Button>
      </CardHeader>
      <CardContent>
        <FilterBar search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} statuses={PR_STATUSES} placeholder="Search by title, PR number, or project..." projectId={projectFilter} onProjectChange={setProjectFilter} projects={projectsList} />
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : prs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No purchase requests found</div>
        ) : (
          <>
            <div className="space-y-3">
              {pagedPRs.map((pr: PurchaseRequest) => (
                <div key={pr.id} className="border rounded-md" data-testid={`pr-${pr.id}`}>
                  <div className="flex items-start justify-between p-4 gap-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpandedPRId(expandedPRId === pr.id ? null : pr.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-muted-foreground">{pr.prNumber}</span>
                        <Badge variant={PR_STATUS_VARIANT[pr.status] || "outline"}>{statusLabel(pr.status)}</Badge>
                      </div>
                      <p className="font-medium">{pr.title}</p>
                      <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                        {pr.project && <span>{pr.project.name}</span>}
                        {pr.requestedBy && <span>By: {pr.requestedBy.firstName} {pr.requestedBy.lastName}</span>}
                        <span>Needed: {fmtDate(pr.neededByDate)}</span>
                        <span>Est: {fmtCurrency(pr.totalEstimatedCost)}</span>
                      </div>
                      {pr.status === "REJECTED" && pr.rejectionNotes && (
                        <div className="flex items-start gap-1.5 mt-1 text-sm text-destructive">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{pr.rejectionNotes}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      {pr.status === "DRAFT" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(pr)} data-testid={`button-edit-pr-${pr.id}`}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
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
                          <Button size="sm" variant="destructive" onClick={() => setRejectingId(pr.id)} data-testid={`button-reject-pr-${pr.id}`}>
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
            <PaginationControls rangeStart={prStart} rangeEnd={prEnd} totalItems={prTotal} hasPrev={prHasPrev} hasNext={prHasNext} onPrev={prPrev} onNext={prNext} />
          </>
        )}
      </CardContent>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl" data-testid="dialog-create-pr">
          <DialogHeader>
            <DialogTitle>New Purchase Request</DialogTitle>
            <DialogDescription>Create a purchase request with line items for approval.</DialogDescription>
          </DialogHeader>
          {renderForm(false)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-create-pr">
              {createMutation.isPending ? "Creating..." : "Create Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingPR} onOpenChange={o => { if (!o) setEditingPR(null); }}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-pr">
          <DialogHeader>
            <DialogTitle>Edit Purchase Request — {editingPR?.prNumber}</DialogTitle>
            <DialogDescription>Update the details and line items.</DialogDescription>
          </DialogHeader>
          {renderForm(true)}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPR(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending} data-testid="button-submit-edit-pr">
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RejectDialog
        open={!!rejectingId}
        onClose={() => setRejectingId(null)}
        entityLabel="Purchase Request"
        isPending={rejectMutation.isPending}
        onConfirm={async (notes) => {
          if (!rejectingId) return;
          try {
            await rejectMutation.mutateAsync({ id: rejectingId, rejectionNotes: notes || undefined });
            toast({ title: "Rejected" });
            setRejectingId(null);
          } catch { toast({ title: "Failed", variant: "destructive" }); }
        }}
      />
    </Card>
  );
}

function PurchaseOrdersTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const { data: pos = [], isLoading } = usePurchaseOrders({
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    search: search || undefined,
    projectId: projectFilter !== "ALL" ? projectFilter : undefined,
  });
  const { pageItems: pagedPOs, rangeStart: poStart, rangeEnd: poEnd, totalItems: poTotal, hasPrev: poHasPrev, hasNext: poHasNext, prevPage: poPrev, nextPage: poNext, resetPage: poResetPage } = usePagination(pos);
  useEffect(() => { poResetPage(); }, [search, statusFilter, projectFilter, poResetPage]);
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projectsList = projectsResponse?.data ?? [];
  const { data: vendors = [] } = useQuery<VendorRef[]>({ queryKey: ["/api/crm/organisations"] });
  const createMutation = useCreatePurchaseOrder();
  const submitMutation = useSubmitPurchaseOrder();
  const approveMutation = useApprovePurchaseOrder();
  const rejectPOMutation = useRejectPurchaseOrder();
  const sendMutation = useSendPurchaseOrder();
  const deleteMutation = useDeletePurchaseOrder();

  const [showCreate, setShowCreate] = useState(false);
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [form, setForm] = useState({ projectId: "", vendorId: "", terms: "", deliveryAddress: "", neededByDate: "", notes: "" });
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
  const removeLineItem = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const updateLineItem = (i: number, field: string, value: string) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: value };
    setLineItems(updated);
  };

  const handleCreate = async () => {
    if (!form.projectId) { toast({ title: "Project is required", variant: "destructive" }); return; }
    const validItems = lineItems.filter(li => li.description.trim());
    if (validItems.length === 0) { toast({ title: "At least one line item is required", variant: "destructive" }); return; }
    try {
      await createMutation.mutateAsync({
        projectId: form.projectId, vendorId: form.vendorId || null,
        terms: form.terms || null, deliveryAddress: form.deliveryAddress || null,
        neededByDate: form.neededByDate || null, notes: form.notes || null, items: validItems,
      });
      toast({ title: "Purchase order created" });
      setShowCreate(false);
      setForm({ projectId: "", vendorId: "", terms: "", deliveryAddress: "", neededByDate: "", notes: "" });
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
          <FilterBar search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} statuses={PO_STATUSES} placeholder="Search by PO number, vendor, or project..." projectId={projectFilter} onProjectChange={setProjectFilter} projects={projectsList} />
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : pos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No purchase orders found</div>
          ) : (
            <>
            <div className="space-y-3">
              {pagedPOs.map((po: PurchaseOrder) => (
                <div key={po.id} className="p-4 border rounded-md gap-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedPOId(po.id)} data-testid={`po-${po.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-muted-foreground">{po.poNumber}</span>
                        <Badge variant={PO_STATUS_VARIANT[po.status] || "outline"}>{statusLabel(po.status)}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                        {po.vendor && <span>{po.vendor.name}</span>}
                        {po.project && <span>{po.project.name}</span>}
                        <span>Needed: {fmtDate(po.neededByDate)}</span>
                        <span>Total: {fmtCurrency(po.totalCost)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      {(po.status === "DRAFT" || po.status === "PENDING_APPROVAL") && (
                        <Button size="sm" variant="ghost" onClick={() => setSelectedPOId(po.id)} data-testid={`button-edit-po-card-${po.id}`}>
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      )}
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
                          <Button size="sm" variant="destructive" onClick={() => setRejectingId(po.id)} data-testid={`button-reject-po-${po.id}`}>
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
                  {po.status === "CANCELLED" && po.rejectionNotes && (
                    <div className="flex items-start gap-1.5 mt-2 text-sm text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{po.rejectionNotes}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <PaginationControls rangeStart={poStart} rangeEnd={poEnd} totalItems={poTotal} hasPrev={poHasPrev} hasNext={poHasNext} onPrev={poPrev} onNext={poNext} />
            </>
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
                <Label>Project *</Label>
                <Select value={form.projectId} onValueChange={v => setForm({ ...form, projectId: v })}>
                  <SelectTrigger data-testid="select-po-project"><SelectValue placeholder="Select project..." /></SelectTrigger>
                  <SelectContent>{projectsList.map((p: ProjectRef) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vendor</Label>
                <VendorCombobox value={form.vendorId} onChange={v => setForm({ ...form, vendorId: v })} vendors={vendors || []} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Needed By</Label>
                <Input type="date" value={form.neededByDate} onChange={e => setForm({ ...form, neededByDate: e.target.value })} data-testid="input-po-needed-by" />
              </div>
              <div>
                <Label>Terms</Label>
                <Input value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} placeholder="Net 30, COD..." data-testid="input-po-terms" />
              </div>
            </div>
            <div>
              <Label>Delivery Address</Label>
              <Input value={form.deliveryAddress} onChange={e => setForm({ ...form, deliveryAddress: e.target.value })} data-testid="input-po-address" />
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
                    <Input value={li.description} onChange={e => updateLineItem(i, "description", e.target.value)} data-testid={`input-po-line-desc-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" step="0.01" value={li.quantity} onChange={e => updateLineItem(i, "quantity", e.target.value)} data-testid={`input-po-line-qty-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit</Label>
                    <Input value={li.unit} onChange={e => updateLineItem(i, "unit", e.target.value)} data-testid={`input-po-line-unit-${i}`} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Unit Cost</Label>
                    <Input type="number" step="0.01" value={li.unitCost || ""} onChange={e => updateLineItem(i, "unitCost", e.target.value)} data-testid={`input-po-line-cost-${i}`} />
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

      <RejectDialog
        open={!!rejectingId}
        onClose={() => setRejectingId(null)}
        entityLabel="Purchase Order"
        isPending={rejectPOMutation.isPending}
        onConfirm={async (notes) => {
          if (!rejectingId) return;
          try {
            await rejectPOMutation.mutateAsync({ id: rejectingId, rejectionNotes: notes || undefined });
            toast({ title: "Rejected" });
            setRejectingId(null);
          } catch { toast({ title: "Failed", variant: "destructive" }); }
        }}
      />

      {selectedPOId && <PODetailSheet poId={selectedPOId} onClose={() => setSelectedPOId(null)} />}
    </>
  );
}

function PODetailSheet({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { toast } = useToast();
  const { data: po, isLoading } = usePurchaseOrderDetail(poId);
  const updateMutation = useUpdatePurchaseOrder();
  const createReceiptMutation = useCreatePOReceipt();
  const createInvoiceMutation = useCreateVendorInvoice();
  const createMatchMutation = useCreateInvoiceMatch();
  const resolveMutation = useResolveMatchDiscrepancy();
  const createPaymentMutation = useCreateInvoicePayment();

  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [receiptItems, setReceiptItems] = useState<{ poItemId: string; quantityReceived: string; condition: string; notes: string }[]>([]);
  const [receiptNotes, setReceiptNotes] = useState("");

  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: "", invoiceDate: "", dueDate: "", totalAmount: "", notes: "", fileUrl: "" });
  const [invoiceLineItems, setInvoiceLineItems] = useState<{ poItemId: string; description: string; quantity: string; unitCost: string; amount: string }[]>([]);
  const [isUploadingInvoiceFile, setIsUploadingInvoiceFile] = useState(false);

  const openInvoiceDialog = () => {
    setInvoiceForm({ invoiceNumber: "", invoiceDate: new Date().toISOString().split("T")[0], dueDate: "", totalAmount: "", notes: "", fileUrl: "" });
    if (po?.items) {
      setInvoiceLineItems(po.items.map((item: POItem) => ({
        poItemId: item.id,
        description: item.description,
        quantity: item.quantity || "",
        unitCost: item.unitCost || "",
        amount: String(parseFloat(item.quantity || "0") * parseFloat(item.unitCost || "0")),
      })));
    } else {
      setInvoiceLineItems([]);
    }
    setShowInvoiceDialog(true);
  };

  const updateInvoiceLineItem = (i: number, field: string, value: string) => {
    const updated = [...invoiceLineItems];
    updated[i] = { ...updated[i], [field]: value };
    if (field === "quantity" || field === "unitCost") {
      const q = parseFloat(field === "quantity" ? value : updated[i].quantity) || 0;
      const u = parseFloat(field === "unitCost" ? value : updated[i].unitCost) || 0;
      updated[i].amount = String(Math.round(q * u * 100) / 100);
    }
    setInvoiceLineItems(updated);
    const total = updated.reduce((sum, li) => sum + (parseFloat(li.amount) || 0), 0);
    setInvoiceForm(prev => ({ ...prev, totalAmount: String(Math.round(total * 100) / 100) }));
  };

  const handleInvoiceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingInvoiceFile(true);
    try {
      const res = await apiRequest("POST", "/api/objects/upload");
      const { uploadURL } = await res.json();
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const fileUrl = uploadURL.split("?")[0];
      setInvoiceForm(prev => ({ ...prev, fileUrl }));
      toast({ title: "File uploaded successfully" });
    } catch {
      toast({ title: "File upload failed", variant: "destructive" });
    } finally {
      setIsUploadingInvoiceFile(false);
    }
  };

  const [resolveInvoiceId, setResolveInvoiceId] = useState<string | null>(null);
  const [resolveNotes, setResolveNotes] = useState("");

  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentDate: "", method: "", referenceNumber: "", notes: "" });

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ terms: "", deliveryAddress: "", neededByDate: "", notes: "" });
  const [editLineItems, setEditLineItems] = useState<LineItem[]>([]);

  const openEdit = () => {
    if (!po) return;
    setEditForm({
      terms: po.terms || "", deliveryAddress: po.deliveryAddress || "",
      neededByDate: po.neededByDate?.split("T")[0] || "", notes: po.notes || "",
    });
    setEditLineItems(po.items?.map((item: POItem) => ({
      description: item.description, quantity: item.quantity || "", unit: item.unit || "",
      unitCost: item.unitCost || "", costCode: item.costCode || "",
    })) || [{ description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
    setShowEditDialog(true);
  };

  const addEditLineItem = () => setEditLineItems([...editLineItems, { description: "", quantity: "", unit: "", unitCost: "", costCode: "" }]);
  const removeEditLineItem = (i: number) => setEditLineItems(editLineItems.filter((_, idx) => idx !== i));
  const updateEditLineItem = (i: number, field: string, value: string) => {
    const updated = [...editLineItems];
    updated[i] = { ...updated[i], [field]: value };
    setEditLineItems(updated);
  };

  const handleEdit = async () => {
    const validItems = editLineItems.filter(li => li.description.trim());
    try {
      await updateMutation.mutateAsync({
        id: poId,
        data: {
          terms: editForm.terms || null, deliveryAddress: editForm.deliveryAddress || null,
          neededByDate: editForm.neededByDate || null, notes: editForm.notes || null,
          items: validItems,
        },
      });
      toast({ title: "Purchase order updated" });
      setShowEditDialog(false);
    } catch { toast({ title: "Failed to update PO", variant: "destructive" }); }
  };

  const openReceiptDialog = () => {
    if (po?.items) {
      setReceiptItems(po.items.map((item: POItem) => ({
        poItemId: item.id, quantityReceived: "", condition: "GOOD", notes: "",
      })));
    }
    setReceiptNotes("");
    setShowReceiptDialog(true);
  };

  const handleCreateReceipt = async () => {
    const validItems = receiptItems.filter(ri => parseFloat(ri.quantityReceived) > 0);
    if (validItems.length === 0) { toast({ title: "Enter at least one received quantity", variant: "destructive" }); return; }
    try {
      await createReceiptMutation.mutateAsync({ poId, data: { notes: receiptNotes || null, items: validItems } });
      toast({ title: "Receipt recorded" });
      setShowReceiptDialog(false);
    } catch { toast({ title: "Failed to record receipt", variant: "destructive" }); }
  };

  const handleCreateInvoice = async () => {
    if (!invoiceForm.invoiceNumber || !invoiceForm.invoiceDate || !invoiceForm.totalAmount) {
      toast({ title: "Invoice number, date, and amount are required", variant: "destructive" }); return;
    }
    const validItems = invoiceLineItems.filter(li => li.description.trim() && parseFloat(li.amount) > 0);
    try {
      await createInvoiceMutation.mutateAsync({
        poId, vendorId: po?.vendorId || null,
        invoiceNumber: invoiceForm.invoiceNumber, invoiceDate: invoiceForm.invoiceDate,
        totalAmount: invoiceForm.totalAmount, dueDate: invoiceForm.dueDate || null,
        notes: invoiceForm.notes || null, fileUrl: invoiceForm.fileUrl || null,
        items: validItems,
      });
      toast({ title: "Invoice recorded" });
      setShowInvoiceDialog(false);
      setInvoiceForm({ invoiceNumber: "", invoiceDate: "", dueDate: "", totalAmount: "", notes: "", fileUrl: "" });
      setInvoiceLineItems([]);
    } catch { toast({ title: "Failed to record invoice", variant: "destructive" }); }
  };

  const handleRecordPayment = async () => {
    if (!paymentInvoiceId || !paymentForm.amount || !paymentForm.paymentDate) {
      toast({ title: "Amount and date are required", variant: "destructive" }); return;
    }
    try {
      await createPaymentMutation.mutateAsync({
        invoiceId: paymentInvoiceId,
        data: {
          amount: paymentForm.amount, paymentDate: paymentForm.paymentDate,
          method: paymentForm.method || null, referenceNumber: paymentForm.referenceNumber || null,
          notes: paymentForm.notes || null,
        },
      });
      toast({ title: "Payment recorded" });
      setPaymentInvoiceId(null);
      setPaymentForm({ amount: "", paymentDate: "", method: "", referenceNumber: "", notes: "" });
    } catch { toast({ title: "Failed to record payment", variant: "destructive" }); }
  };

  const canEdit = po && (po.status === "DRAFT" || po.status === "PENDING_APPROVAL");

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
              <div className="flex items-center justify-between">
                <div className="grid grid-cols-2 gap-3 text-sm flex-1">
                  <div><span className="text-muted-foreground">Status:</span> <Badge variant={PO_STATUS_VARIANT[po.status] || "outline"}>{statusLabel(po.status)}</Badge></div>
                  <div><span className="text-muted-foreground">Vendor:</span> {po.vendor?.name || "-"}</div>
                  <div><span className="text-muted-foreground">Project:</span> {po.project?.name || "-"}</div>
                  <div><span className="text-muted-foreground">Needed By:</span> {fmtDate(po.neededByDate)}</div>
                  <div><span className="text-muted-foreground">Total:</span> {fmtCurrency(po.totalCost)}</div>
                  {po.terms && <div><span className="text-muted-foreground">Terms:</span> {po.terms}</div>}
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={openEdit} data-testid="button-edit-po">
                    <Edit className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                )}
              </div>

              {po.status === "CANCELLED" && po.rejectionNotes && (
                <div className="flex items-start gap-1.5 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div><span className="font-medium">Rejection Reason:</span> {po.rejectionNotes}</div>
                </div>
              )}

              <Separator />
              <div>
                <h4 className="font-semibold mb-2">Line Items</h4>
                {po.items?.length > 0 ? (
                  <div className="space-y-2">
                    {po.items.map((item: POItem) => {
                      const ordered = parseFloat(item.quantity || "0");
                      const received = parseFloat(String(item.quantityReceived ?? "0"));
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
                {(po.receipts?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {po.receipts!.map((r: POReceiptSummary) => (
                      <div key={r.id} className="text-sm p-2 border rounded">
                        <div className="flex justify-between">
                          <span>{fmtDate(r.receivedAt)} - {r.receivedBy?.firstName} {r.receivedBy?.lastName}</span>
                          <Badge variant={r.status === "COMPLETE" ? "default" : "secondary"}>{r.status}</Badge>
                        </div>
                        {r.notes && <p className="text-muted-foreground text-xs mt-1">{r.notes}</p>}
                        {r.items?.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {r.items.map(ri => {
                              const poItem = po.items?.find((it: POItem) => it.id === ri.poItemId);
                              return (
                                <div key={ri.id} className="text-xs flex gap-2 text-muted-foreground">
                                  <span className="font-medium text-foreground">{poItem?.description || "Item"}</span>
                                  <span>Qty: {ri.quantityReceived}</span>
                                  <Badge variant={ri.condition === "GOOD" ? "outline" : "destructive"} className="text-[10px] px-1 py-0">{ri.condition}</Badge>
                                  {ri.notes && <span>{ri.notes}</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No receipts recorded</p>}
              </div>

              <Separator />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold flex items-center gap-1"><FileText className="h-4 w-4" /> Invoices ({po.invoices?.length || 0})</h4>
                  <Button size="sm" variant="outline" onClick={openInvoiceDialog} data-testid="button-add-invoice">
                    <Plus className="h-3.5 w-3.5 mr-1" />Add Invoice
                  </Button>
                </div>
                {(po.invoices?.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {po.invoices!.map((inv: InvoiceSummary) => {
                      const totalPaid = parseFloat(inv.totalPaid || "0");
                      const totalAmt = parseFloat(inv.totalAmount || "0");
                      return (
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
                          {totalPaid > 0 && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Paid: {fmtCurrency(totalPaid)} of {fmtCurrency(totalAmt)}
                              {totalAmt > 0 && (
                                <div className="w-full h-1 bg-muted rounded-full mt-0.5">
                                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${Math.min((totalPaid / totalAmt) * 100, 100)}%` }} />
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex gap-2 mt-2 flex-wrap">
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
                            {["MATCHED", "APPROVED"].includes(inv.status) && (
                              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPaymentInvoiceId(inv.id); setPaymentForm({ amount: "", paymentDate: new Date().toISOString().split("T")[0], method: "", referenceNumber: "", notes: "" }); }} data-testid={`button-pay-${inv.id}`}>
                                <DollarSign className="h-3 w-3 mr-1" />Record Payment
                              </Button>
                            )}
                            {inv.match?.matchStatus === "DISCREPANCY" && (
                              <span className="text-xs text-muted-foreground">
                                PO: {fmtCurrency(inv.match.poAmount)} | Inv: {fmtCurrency(inv.match.invoiceAmount)} | Recv: {inv.match.receivedQtyMatchPct}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No invoices recorded</p>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl" data-testid="dialog-edit-po">
          <DialogHeader>
            <DialogTitle>Edit Purchase Order</DialogTitle>
            <DialogDescription>Update PO details and line items.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Needed By</Label>
                <Input type="date" value={editForm.neededByDate} onChange={e => setEditForm({ ...editForm, neededByDate: e.target.value })} />
              </div>
              <div>
                <Label>Terms</Label>
                <Input value={editForm.terms} onChange={e => setEditForm({ ...editForm, terms: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Delivery Address</Label>
              <Input value={editForm.deliveryAddress} onChange={e => setEditForm({ ...editForm, deliveryAddress: e.target.value })} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Line Items</Label>
              <Button size="sm" variant="outline" onClick={addEditLineItem} data-testid="button-add-edit-po-line"><Plus className="h-3.5 w-3.5 mr-1" />Add Item</Button>
            </div>
            {editLineItems.map((li, i) => (
              <div key={i} className="space-y-2 p-3 border rounded-md">
                <div className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <Label className="text-xs">Description</Label>
                    <Input value={li.description} onChange={e => updateEditLineItem(i, "description", e.target.value)} data-testid={`input-edit-po-line-desc-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Qty</Label>
                    <Input type="number" step="0.01" value={li.quantity} onChange={e => updateEditLineItem(i, "quantity", e.target.value)} data-testid={`input-edit-po-line-qty-${i}`} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit</Label>
                    <Input value={li.unit} onChange={e => updateEditLineItem(i, "unit", e.target.value)} data-testid={`input-edit-po-line-unit-${i}`} />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Unit Cost</Label>
                    <Input type="number" step="0.01" value={li.unitCost || ""} onChange={e => updateEditLineItem(i, "unitCost", e.target.value)} data-testid={`input-edit-po-line-cost-${i}`} />
                  </div>
                  <div className="col-span-1">
                    {editLineItems.length > 1 && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeEditLineItem(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Cost Code</Label>
                  <CostCodeCombobox value={li.costCode || ""} onChange={(val) => updateEditLineItem(i, "costCode", val)} data-testid={`input-edit-po-line-costcode-${i}`} />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending} data-testid="button-submit-edit-po">
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        <DialogContent className="max-w-2xl" data-testid="dialog-add-invoice">
          <DialogHeader>
            <DialogTitle>Add Vendor Invoice</DialogTitle>
            <DialogDescription>Record an invoice from the vendor for this PO. Line items are auto-populated from PO items for per-item matching.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
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
              <Label>Invoice File (optional)</Label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border rounded-md text-sm hover:bg-muted transition-colors">
                  {isUploadingInvoiceFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {isUploadingInvoiceFile ? "Uploading..." : "Upload File"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={handleInvoiceFileUpload} disabled={isUploadingInvoiceFile} data-testid="input-invoice-file" />
                </label>
                {invoiceForm.fileUrl && (
                  <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" />File attached</span>
                )}
              </div>
            </div>
            {invoiceLineItems.length > 0 && (
              <>
                <Separator />
                <Label className="text-base font-semibold">Line Items</Label>
                {invoiceLineItems.map((li, i) => (
                  <div key={i} className="p-3 border rounded-md space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">{li.description}</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Qty</Label>
                        <Input type="number" step="0.01" value={li.quantity} onChange={e => updateInvoiceLineItem(i, "quantity", e.target.value)} data-testid={`input-inv-line-qty-${i}`} />
                      </div>
                      <div>
                        <Label className="text-xs">Unit Cost</Label>
                        <Input type="number" step="0.01" value={li.unitCost} onChange={e => updateInvoiceLineItem(i, "unitCost", e.target.value)} data-testid={`input-inv-line-cost-${i}`} />
                      </div>
                      <div>
                        <Label className="text-xs">Amount</Label>
                        <Input type="number" step="0.01" value={li.amount} onChange={e => updateInvoiceLineItem(i, "amount", e.target.value)} data-testid={`input-inv-line-amount-${i}`} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="text-right text-sm font-semibold">
                  Total: {fmtCurrency(invoiceForm.totalAmount)}
                </div>
              </>
            )}
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
                toast({ title: "Discrepancy resolved" }); setResolveInvoiceId(null);
              } catch { toast({ title: "Failed", variant: "destructive" }); }
            }} disabled={resolveMutation.isPending} data-testid="button-submit-resolve">
              {resolveMutation.isPending ? "Resolving..." : "Resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentInvoiceId} onOpenChange={open => { if (!open) setPaymentInvoiceId(null); }}>
        <DialogContent data-testid="dialog-record-payment">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Enter payment details for this invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount *</Label>
                <Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="input-payment-amount" />
              </div>
              <div>
                <Label>Payment Date *</Label>
                <Input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} data-testid="input-payment-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Method</Label>
                <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                  <SelectTrigger data-testid="select-payment-method"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECK">Check</SelectItem>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="WIRE">Wire</SelectItem>
                    <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                    <SelectItem value="CASH">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reference #</Label>
                <Input value={paymentForm.referenceNumber} onChange={e => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })} data-testid="input-payment-ref" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={2} data-testid="input-payment-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentInvoiceId(null)}>Cancel</Button>
            <Button onClick={handleRecordPayment} disabled={createPaymentMutation.isPending} data-testid="button-submit-payment">
              {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvoicesTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const { data: invoices = [], isLoading } = useVendorInvoices({
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    search: search || undefined,
    projectId: projectFilter !== "ALL" ? projectFilter : undefined,
  });
  const { pageItems: pagedInvoices, rangeStart: invStart, rangeEnd: invEnd, totalItems: invTotal, hasPrev: invHasPrev, hasNext: invHasNext, prevPage: invPrev, nextPage: invNext, resetPage: invResetPage } = usePagination(invoices);
  useEffect(() => { invResetPage(); }, [search, statusFilter, projectFilter, invResetPage]);
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projectsList = projectsResponse?.data ?? [];
  const createMatchMutation = useCreateInvoiceMatch();
  const updateInvoiceMutation = useUpdateVendorInvoice();
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceRow | null>(null);
  const [editInvForm, setEditInvForm] = useState({ invoiceNumber: "", invoiceDate: "", dueDate: "", totalAmount: "", notes: "", fileUrl: "" });
  const [isUploading, setIsUploading] = useState(false);
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", paymentDate: "", method: "", referenceNumber: "", notes: "" });
  const payMutation = useMutation({
    mutationFn: async (data: { invoiceId: string; amount: string; paymentDate: string; method?: string; referenceNumber?: string; notes?: string }) => {
      await apiRequest("POST", `/api/procurement-module/invoices/${data.invoiceId}/payments`, data);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/procurement-module/invoices"] }); toast({ title: "Payment recorded" }); setPayInvoice(null); },
    onError: () => { toast({ title: "Failed to record payment", variant: "destructive" }); },
  });

  const openEditInvoice = (inv: InvoiceRow) => {
    setEditingInvoice(inv);
    setEditInvForm({
      invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate?.split("T")[0] || "",
      dueDate: inv.dueDate?.split("T")[0] || "", totalAmount: inv.totalAmount || "",
      notes: inv.notes || "", fileUrl: inv.fileUrl || "",
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const res = await apiRequest("POST", "/api/objects/upload");
      const { uploadURL } = await res.json();
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const fileUrl = uploadURL.split("?")[0];
      setEditInvForm(prev => ({ ...prev, fileUrl }));
      toast({ title: "File uploaded successfully" });
    } catch {
      toast({ title: "File upload failed", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleEditInvoice = async () => {
    if (!editingInvoice) return;
    try {
      await updateInvoiceMutation.mutateAsync({
        id: editingInvoice.id,
        data: {
          invoiceNumber: editInvForm.invoiceNumber, invoiceDate: editInvForm.invoiceDate,
          totalAmount: editInvForm.totalAmount, dueDate: editInvForm.dueDate || null,
          notes: editInvForm.notes || null, fileUrl: editInvForm.fileUrl || null,
        },
      });
      toast({ title: "Invoice updated" });
      setEditingInvoice(null);
    } catch { toast({ title: "Failed to update invoice", variant: "destructive" }); }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Vendor Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <FilterBar search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} statuses={INV_STATUSES} placeholder="Search by invoice number or vendor..." projectId={projectFilter} onProjectChange={setProjectFilter} projects={projectsList} />
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No vendor invoices found. Add invoices from a PO detail view.</div>
          ) : (
            <>
            <div className="space-y-3">
              {pagedInvoices.map((inv: InvoiceRow) => {
                const totalPaid = parseFloat(inv.totalPaid || "0");
                const totalAmt = parseFloat(inv.totalAmount || "0");
                return (
                  <div key={inv.id} className="p-4 border rounded-md gap-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedInvoice(inv)} data-testid={`invoice-${inv.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                          <Badge variant={INVOICE_STATUS_VARIANT[inv.status] || "outline"}>{inv.status}</Badge>
                          {inv.match && <Badge variant={MATCH_STATUS_VARIANT[inv.match.matchStatus] || "outline"} className="text-xs">{inv.match.matchStatus}</Badge>}
                          {inv.fileUrl && <a href={inv.fileUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-500 hover:text-blue-700" data-testid={`link-invoice-file-${inv.id}`}><FileText className="h-3.5 w-3.5" /></a>}
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
                          {inv.po && <span>PO: {inv.po.poNumber}</span>}
                          {inv.vendor && <span>{inv.vendor.name}</span>}
                          <span>Date: {fmtDate(inv.invoiceDate)}</span>
                          {inv.dueDate && <span>Due: {fmtDate(inv.dueDate)}</span>}
                          <span className="font-medium text-foreground">{fmtCurrency(inv.totalAmount)}</span>
                          {totalPaid > 0 && <span className="text-green-600">Paid: {fmtCurrency(totalPaid)}</span>}
                          {totalAmt > totalPaid && <span className="text-orange-600">Due: {fmtCurrency(totalAmt - totalPaid)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        {inv.status === "PENDING" && (
                          <Button size="sm" variant="ghost" onClick={() => openEditInvoice(inv)} data-testid={`button-edit-invoice-${inv.id}`}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!inv.match && (
                          <Button size="sm" variant="outline" onClick={async () => { try { await createMatchMutation.mutateAsync(inv.id); toast({ title: "3-way match completed" }); } catch { toast({ title: "Failed", variant: "destructive" }); } }} data-testid={`button-match-invoice-${inv.id}`}>
                            Run 3-Way Match
                          </Button>
                        )}
                        {(inv.status === "MATCHED" || inv.status === "APPROVED") && totalAmt > totalPaid && (
                          <Button size="sm" variant="outline" onClick={() => { setPayInvoice(inv); setPayForm({ amount: String(Math.round((totalAmt - totalPaid) * 100) / 100), paymentDate: new Date().toISOString().split("T")[0], method: "", referenceNumber: "", notes: "" }); }} data-testid={`button-pay-invoice-${inv.id}`}>
                            <DollarSign className="h-3.5 w-3.5 mr-1" />Record Payment
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <PaginationControls rangeStart={invStart} rangeEnd={invEnd} totalItems={invTotal} hasPrev={invHasPrev} hasNext={invHasNext} onPrev={invPrev} onNext={invNext} />
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingInvoice} onOpenChange={o => { if (!o) setEditingInvoice(null); }}>
        <DialogContent data-testid="dialog-edit-invoice">
          <DialogHeader>
            <DialogTitle>Edit Invoice — {editingInvoice?.invoiceNumber}</DialogTitle>
            <DialogDescription>Update invoice details (PENDING invoices only).</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Invoice Number *</Label>
              <Input value={editInvForm.invoiceNumber} onChange={e => setEditInvForm({ ...editInvForm, invoiceNumber: e.target.value })} data-testid="input-edit-invoice-number" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Invoice Date *</Label>
                <Input type="date" value={editInvForm.invoiceDate} onChange={e => setEditInvForm({ ...editInvForm, invoiceDate: e.target.value })} data-testid="input-edit-invoice-date" />
              </div>
              <div>
                <Label>Due Date</Label>
                <Input type="date" value={editInvForm.dueDate} onChange={e => setEditInvForm({ ...editInvForm, dueDate: e.target.value })} data-testid="input-edit-invoice-due" />
              </div>
            </div>
            <div>
              <Label>Total Amount *</Label>
              <Input type="number" step="0.01" value={editInvForm.totalAmount} onChange={e => setEditInvForm({ ...editInvForm, totalAmount: e.target.value })} data-testid="input-edit-invoice-amount" />
            </div>
            <div>
              <Label>Invoice File</Label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer px-3 py-2 border rounded-md text-sm hover:bg-muted transition-colors">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {isUploading ? "Uploading..." : "Upload File"}
                  <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" onChange={handleFileUpload} disabled={isUploading} data-testid="input-edit-invoice-file" />
                </label>
                {editInvForm.fileUrl && (
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">File attached</span>
                )}
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={editInvForm.notes} onChange={e => setEditInvForm({ ...editInvForm, notes: e.target.value })} rows={2} data-testid="input-edit-invoice-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingInvoice(null)}>Cancel</Button>
            <Button onClick={handleEditInvoice} disabled={updateInvoiceMutation.isPending} data-testid="button-submit-edit-invoice">
              {updateInvoiceMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceDetailDialog invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />

      <Dialog open={!!payInvoice} onOpenChange={o => { if (!o) setPayInvoice(null); }}>
        <DialogContent data-testid="dialog-pay-invoice">
          <DialogHeader>
            <DialogTitle>Record Payment — {payInvoice?.invoiceNumber}</DialogTitle>
            <DialogDescription>Record a payment for this invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount *</Label>
              <Input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} data-testid="input-pay-amount" />
            </div>
            <div>
              <Label>Payment Date *</Label>
              <Input type="date" value={payForm.paymentDate} onChange={e => setPayForm({ ...payForm, paymentDate: e.target.value })} data-testid="input-pay-date" />
            </div>
            <div>
              <Label>Method</Label>
              <Input value={payForm.method} onChange={e => setPayForm({ ...payForm, method: e.target.value })} placeholder="Check, ACH, Wire..." data-testid="input-pay-method" />
            </div>
            <div>
              <Label>Reference Number</Label>
              <Input value={payForm.referenceNumber} onChange={e => setPayForm({ ...payForm, referenceNumber: e.target.value })} data-testid="input-pay-ref" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} rows={2} data-testid="input-pay-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayInvoice(null)}>Cancel</Button>
            <Button onClick={() => { if (!payInvoice || !payForm.amount || !payForm.paymentDate) { toast({ title: "Amount and date are required", variant: "destructive" }); return; } payMutation.mutate({ invoiceId: payInvoice.id, ...payForm }); }} disabled={payMutation.isPending} data-testid="button-submit-pay">
              {payMutation.isPending ? "Saving..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvoiceDetailDialog({ invoice, onClose }: { invoice: InvoiceRow | null; onClose: () => void }) {
  const { toast } = useToast();
  const createMatchMutation = useCreateInvoiceMatch();
  const resolveMutation = useResolveMatchDiscrepancy();
  const createPaymentMutation = useCreateInvoicePayment();
  const { data: payments = [] } = useInvoicePayments(invoice?.id || null);
  const [resolveNotes, setResolveNotes] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentDate: "", method: "", referenceNumber: "", notes: "" });

  if (!invoice) return null;

  const totalPaid = parseFloat(invoice.totalPaid || "0");
  const totalAmt = parseFloat(invoice.totalAmount || "0");
  const remaining = Math.max(0, totalAmt - totalPaid);

  const handleRecordPayment = async () => {
    if (!paymentForm.amount || !paymentForm.paymentDate) {
      toast({ title: "Amount and date are required", variant: "destructive" }); return;
    }
    try {
      await createPaymentMutation.mutateAsync({
        invoiceId: invoice.id,
        data: {
          amount: paymentForm.amount, paymentDate: paymentForm.paymentDate,
          method: paymentForm.method || null, referenceNumber: paymentForm.referenceNumber || null,
          notes: paymentForm.notes || null,
        },
      });
      toast({ title: "Payment recorded" });
      setShowPayment(false);
      setPaymentForm({ amount: "", paymentDate: "", method: "", referenceNumber: "", notes: "" });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
  };

  return (
    <Sheet open={!!invoice} onOpenChange={() => onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="sheet-invoice-detail">
        <SheetHeader>
          <SheetTitle>Invoice {invoice.invoiceNumber}</SheetTitle>
          <SheetDescription>Invoice details, match, and payment history</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Status:</span> <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] || "outline"}>{invoice.status}</Badge></div>
            <div><span className="text-muted-foreground">Amount:</span> <span className="font-medium">{fmtCurrency(invoice.totalAmount)}</span></div>
            <div><span className="text-muted-foreground">Date:</span> {fmtDate(invoice.invoiceDate)}</div>
            {invoice.dueDate && <div><span className="text-muted-foreground">Due:</span> {fmtDate(invoice.dueDate)}</div>}
            {invoice.po && <div><span className="text-muted-foreground">PO:</span> {invoice.po.poNumber}</div>}
            {invoice.vendor && <div><span className="text-muted-foreground">Vendor:</span> {invoice.vendor.name}</div>}
          </div>

          {invoice.fileUrl && (
            <div>
              <a href={invoice.fileUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> View Invoice File
              </a>
            </div>
          )}

          <div className="border-t pt-4">
            <h4 className="font-semibold mb-2">3-Way Match Result</h4>
            {invoice.match ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={MATCH_STATUS_VARIANT[invoice.match.matchStatus] || "outline"}>{invoice.match.matchStatus}</Badge>
                </div>
                <div className="text-sm space-y-1 text-muted-foreground">
                  <div>PO Amount: {fmtCurrency(invoice.match.poAmount)}</div>
                  <div>Invoice Amount: {fmtCurrency(invoice.match.invoiceAmount)}</div>
                  <div>Received: {invoice.match.receivedQtyMatchPct}%</div>
                </div>
                {invoice.match.matchStatus === "DISCREPANCY" && !invoice.match.resolvedAt && (
                  <div className="mt-3 space-y-2">
                    <Label>Resolution Notes</Label>
                    <Textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} rows={2} data-testid="input-invoice-resolve-notes" />
                    <Button size="sm" onClick={async () => {
                      try {
                        await resolveMutation.mutateAsync({ invoiceId: invoice.id, notes: resolveNotes });
                        toast({ title: "Discrepancy resolved" }); onClose();
                      } catch { toast({ title: "Failed", variant: "destructive" }); }
                    }} disabled={resolveMutation.isPending} data-testid="button-invoice-resolve">
                      {resolveMutation.isPending ? "Resolving..." : "Resolve Discrepancy"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No match result yet.</p>
                <Button size="sm" variant="outline" onClick={async () => {
                  try {
                    await createMatchMutation.mutateAsync(invoice.id);
                    toast({ title: "3-way match completed" });
                  } catch { toast({ title: "Failed", variant: "destructive" }); }
                }} disabled={createMatchMutation.isPending} data-testid="button-detail-run-match">
                  {createMatchMutation.isPending ? "Running..." : "Run 3-Way Match"}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold flex items-center gap-1"><DollarSign className="h-4 w-4" /> Payments</h4>
              {["MATCHED", "APPROVED"].includes(invoice.status) && (
                <Button size="sm" variant="outline" onClick={() => { setShowPayment(true); setPaymentForm({ amount: String(remaining), paymentDate: new Date().toISOString().split("T")[0], method: "", referenceNumber: "", notes: "" }); }} data-testid="button-detail-pay">
                  <Plus className="h-3.5 w-3.5 mr-1" />Record Payment
                </Button>
              )}
            </div>
            {totalPaid > 0 && (
              <div className="mb-2 text-sm">
                <span className="text-muted-foreground">Total Paid:</span> <span className="font-medium text-green-600">{fmtCurrency(totalPaid)}</span>
                <span className="text-muted-foreground ml-2">Remaining:</span> <span className="font-medium">{fmtCurrency(remaining)}</span>
              </div>
            )}
            {payments.length > 0 ? (
              <div className="space-y-2">
                {payments.map((p: InvoicePayment) => (
                  <div key={p.id} className="text-sm p-2 border rounded">
                    <div className="flex justify-between">
                      <span className="font-medium">{fmtCurrency(p.amount)}</span>
                      <span className="text-muted-foreground text-xs">{fmtDate(p.paymentDate)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {p.method && <span>{p.method}</span>}
                      {p.referenceNumber && <span>Ref: {p.referenceNumber}</span>}
                      {p.recordedBy && <span>By: {p.recordedBy.firstName} {p.recordedBy.lastName}</span>}
                    </div>
                    {p.notes && <p className="text-xs text-muted-foreground mt-1">{p.notes}</p>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No payments recorded</p>}
          </div>

          {showPayment && (
            <div className="border-t pt-4 space-y-3">
              <h4 className="font-semibold text-sm">New Payment</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Amount *</Label>
                  <Input type="number" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="input-detail-payment-amount" />
                </div>
                <div>
                  <Label className="text-xs">Date *</Label>
                  <Input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} data-testid="input-detail-payment-date" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={paymentForm.method} onValueChange={v => setPaymentForm({ ...paymentForm, method: v })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="ACH">ACH</SelectItem>
                      <SelectItem value="WIRE">Wire</SelectItem>
                      <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                      <SelectItem value="CASH">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Reference #</Label>
                  <Input value={paymentForm.referenceNumber} onChange={e => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={2} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowPayment(false)}>Cancel</Button>
                <Button size="sm" onClick={handleRecordPayment} disabled={createPaymentMutation.isPending} data-testid="button-detail-submit-payment">
                  {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const RECEIPT_STATUSES = ["PARTIAL", "COMPLETE"];

function ReceiptsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [projectFilter, setProjectFilter] = useState("ALL");
  const { data: receipts = [], isLoading } = useProcurementReceipts({
    status: statusFilter !== "ALL" ? statusFilter : undefined,
    search: search || undefined,
    projectId: projectFilter !== "ALL" ? projectFilter : undefined,
  });
  const { pageItems: pagedReceipts, rangeStart: rcStart, rangeEnd: rcEnd, totalItems: rcTotal, hasPrev: rcHasPrev, hasNext: rcHasNext, prevPage: rcPrev, nextPage: rcNext, resetPage: rcResetPage } = usePagination(receipts);
  useEffect(() => { rcResetPage(); }, [search, statusFilter, projectFilter, rcResetPage]);
  const { data: projectsResponse } = useQuery<{ data: ProjectRef[] }>({ queryKey: ["/api/projects"] });
  const projectsList = projectsResponse?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" /> Delivery Receipts</CardTitle>
      </CardHeader>
      <CardContent>
        <FilterBar search={search} onSearch={setSearch} status={statusFilter} onStatus={setStatusFilter} statuses={RECEIPT_STATUSES} placeholder="Search by PO number or notes..." projectId={projectFilter} onProjectChange={setProjectFilter} projects={projectsList} />
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : receipts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No delivery receipts yet. Record receipts from a PO detail view.</div>
        ) : (
          <>
          <div className="space-y-3">
            {pagedReceipts.map((r: ProcurementReceipt) => (
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
                  {r.project && <span>Project: {r.project.name}</span>}
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
          <PaginationControls rangeStart={rcStart} rangeEnd={rcEnd} totalItems={rcTotal} hasPrev={rcHasPrev} hasNext={rcHasNext} onPrev={rcPrev} onNext={rcNext} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProcurementModulePage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold" data-testid="text-procurement-title">Procurement</h1>
        <p className="text-muted-foreground">Manage purchase requests, orders, delivery receipts, and vendor invoices.</p>
      </div>

      <Tabs defaultValue="requests" className="space-y-4">
        <TabsList data-testid="tabs-procurement">
          <TabsTrigger value="requests" data-testid="tab-pr"><ClipboardCheck className="h-4 w-4 mr-1" />Requests</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-po"><Package className="h-4 w-4 mr-1" />Orders</TabsTrigger>
          <TabsTrigger value="receipts" data-testid="tab-receipts"><Truck className="h-4 w-4 mr-1" />Receipts</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices"><FileText className="h-4 w-4 mr-1" />Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <PurchaseRequestsTab />
        </TabsContent>
        <TabsContent value="orders">
          <PurchaseOrdersTab />
        </TabsContent>
        <TabsContent value="receipts">
          <ReceiptsTab />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
