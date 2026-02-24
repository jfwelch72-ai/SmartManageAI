import { useState, useEffect } from "react";
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
  FileSpreadsheet, 
  Plus, 
  Eye, 
  Download,
  CheckCircle2,
  Clock,
  Send,
  XCircle,
  DollarSign,
  Percent,
  FileText,
  Edit,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Mail,
  Shield,
  CreditCard,
  GitCompare,
  ArrowRightLeft,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string;
  contractAmount: string | null;
}

interface SOVLineItem {
  id: string;
  sovId: string;
  itemNumber: number;
  description: string;
  scheduledValue: string;
  previouslyBilled: string;
  currentBilled: string;
  storedMaterials: string;
  totalCompleted: string;
  percentComplete: string;
  balanceToFinish: string;
  retainage: string;
  sortOrder: number;
  category: string | null;
}

interface SOV {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  sovNumber: string;
  title: string;
  description: string | null;
  status: string;
  contractAmount: string;
  totalScheduledValue: string;
  totalPreviouslyBilled: string;
  totalCurrentBilled: string;
  totalStoredMaterials: string;
  totalCompleted: string;
  overallPercentComplete: string;
  totalBalanceToFinish: string;
  totalRetainage: string;
  lineItems: SOVLineItem[];
  createdAt: string;
  updatedAt: string | null;
  createdByName: string | null;
}

function LienWaiversTab({ projects, sovs }: { projects: Project[]; sovs: SOV[] }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    projectId: "",
    sovId: "",
    waiverType: "CONDITIONAL_PARTIAL" as string,
    recipientName: "",
    recipientCompany: "",
    throughDate: "",
    amount: "",
    notes: "",
  });

  const { data: waivers = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/lien-waivers"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/sov/lien-waivers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/lien-waivers"] });
      toast({ title: "Lien waiver created" });
      setShowCreate(false);
      setForm({ projectId: "", sovId: "", waiverType: "CONDITIONAL_PARTIAL", recipientName: "", recipientCompany: "", throughDate: "", amount: "", notes: "" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/sov/lien-waivers/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/lien-waivers"] });
      toast({ title: "Waiver updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const waiverTypeLabel = (t: string) => {
    const map: Record<string, string> = {
      CONDITIONAL_PARTIAL: "Conditional Partial",
      UNCONDITIONAL_PARTIAL: "Unconditional Partial",
      CONDITIONAL_FINAL: "Conditional Final",
      UNCONDITIONAL_FINAL: "Unconditional Final",
    };
    return map[t] || t;
  };

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
      SENT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      RECEIVED: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
      APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
      REJECTED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    };
    return map[s] || "bg-gray-100 text-gray-800";
  };

  const nextStatus = (current: string): string | null => {
    const flow: Record<string, string> = { PENDING: "SENT", SENT: "RECEIVED", RECEIVED: "APPROVED" };
    return flow[current] || null;
  };

  const projectSovs = sovs.filter(s => s.projectId === form.projectId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" /> Lien Waivers
        </h2>
        <Button onClick={() => setShowCreate(true)} data-testid="button-create-lien-waiver">
          <Plus className="h-4 w-4 mr-2" /> New Waiver
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : waivers.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No lien waivers yet</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Through Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waivers.map((w: any) => (
                  <TableRow key={w.id} data-testid={`row-waiver-${w.id}`}>
                    <TableCell>
                      <span className="font-medium">{w.projectName}</span>
                      {w.projectCode && <span className="text-xs text-muted-foreground ml-1">({w.projectCode})</span>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{waiverTypeLabel(w.waiverType)}</Badge></TableCell>
                    <TableCell>
                      <span>{w.recipientName}</span>
                      {w.recipientCompany && <span className="text-xs text-muted-foreground block">{w.recipientCompany}</span>}
                    </TableCell>
                    <TableCell>{w.throughDate ? format(new Date(w.throughDate), "MMM d, yyyy") : "—"}</TableCell>
                    <TableCell className="text-right font-medium">${parseFloat(w.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell><Badge className={statusColor(w.status)}>{w.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {nextStatus(w.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateStatusMutation.mutate({ id: w.id, status: nextStatus(w.status)! })}
                          disabled={updateStatusMutation.isPending}
                          data-testid={`button-advance-waiver-${w.id}`}
                        >
                          {nextStatus(w.status) === "SENT" ? "Mark Sent" : nextStatus(w.status) === "RECEIVED" ? "Mark Received" : "Approve"}
                        </Button>
                      )}
                      {w.status === "RECEIVED" && (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="ml-1"
                          onClick={() => updateStatusMutation.mutate({ id: w.id, status: "REJECTED" })}
                          disabled={updateStatusMutation.isPending}
                          data-testid={`button-reject-waiver-${w.id}`}
                        >
                          Reject
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Lien Waiver</DialogTitle>
            <DialogDescription>Track a conditional or unconditional lien waiver</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={form.projectId} onValueChange={(v) => setForm(f => ({ ...f, projectId: v, sovId: "" }))}>
                  <SelectTrigger data-testid="select-waiver-project"><SelectValue placeholder="Select project..." /></SelectTrigger>
                  <SelectContent>
                    {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Linked SOV (optional)</Label>
                <Select value={form.sovId} onValueChange={(v) => setForm(f => ({ ...f, sovId: v }))}>
                  <SelectTrigger data-testid="select-waiver-sov"><SelectValue placeholder="Select SOV..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {projectSovs.map(s => <SelectItem key={s.id} value={s.id}>{s.sovNumber} - {s.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Waiver Type</Label>
              <Select value={form.waiverType} onValueChange={(v) => setForm(f => ({ ...f, waiverType: v }))}>
                <SelectTrigger data-testid="select-waiver-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONDITIONAL_PARTIAL">Conditional Partial</SelectItem>
                  <SelectItem value="UNCONDITIONAL_PARTIAL">Unconditional Partial</SelectItem>
                  <SelectItem value="CONDITIONAL_FINAL">Conditional Final</SelectItem>
                  <SelectItem value="UNCONDITIONAL_FINAL">Unconditional Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recipient Name</Label>
                <Input value={form.recipientName} onChange={(e) => setForm(f => ({ ...f, recipientName: e.target.value }))} data-testid="input-waiver-recipient" />
              </div>
              <div className="space-y-2">
                <Label>Company (optional)</Label>
                <Input value={form.recipientCompany} onChange={(e) => setForm(f => ({ ...f, recipientCompany: e.target.value }))} data-testid="input-waiver-company" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Through Date</Label>
                <Input type="date" value={form.throughDate} onChange={(e) => setForm(f => ({ ...f, throughDate: e.target.value }))} data-testid="input-waiver-date" />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-waiver-amount" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-waiver-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-waiver">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate({ ...form, sovId: form.sovId === "none" ? "" : form.sovId })}
              disabled={!form.projectId || !form.recipientName || !form.throughDate || !form.amount || createMutation.isPending}
              data-testid="button-submit-waiver"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Waiver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentsTab({ sovs }: { sovs: SOV[] }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    sovId: "",
    amount: "",
    paymentDate: "",
    paymentMethod: "CHECK" as string,
    referenceNumber: "",
    notes: "",
  });

  const { data: payments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/payments"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/sov/payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "Payment recorded" });
      setShowCreate(false);
      setForm({ sovId: "", amount: "", paymentDate: "", paymentMethod: "CHECK", referenceNumber: "", notes: "" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const paymentsBySOV: Record<string, any[]> = {};
  payments.forEach((p: any) => {
    if (!paymentsBySOV[p.sovId]) paymentsBySOV[p.sovId] = [];
    paymentsBySOV[p.sovId].push(p);
  });

  const getSOVBalance = (sovId: string, earnedLessRetainage: string) => {
    const total = parseFloat(earnedLessRetainage || "0");
    const paid = (paymentsBySOV[sovId] || []).reduce((sum: number, p: any) => sum + parseFloat(p.amount || "0"), 0);
    return { total, paid, remaining: total - paid };
  };

  const methodLabel = (m: string) => {
    const map: Record<string, string> = { CHECK: "Check", ACH: "ACH", WIRE: "Wire", CREDIT_CARD: "Credit Card", OTHER: "Other" };
    return map[m] || m;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Partial Payments
        </h2>
        <Button onClick={() => setShowCreate(true)} data-testid="button-record-payment">
          <Plus className="h-4 w-4 mr-2" /> Record Payment
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : payments.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No payments recorded yet</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SOV / Project</TableHead>
                  <TableHead className="text-center">Payment #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p: any) => {
                  const bal = getSOVBalance(p.sovId, p.totalEarnedLessRetainage);
                  return (
                    <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                      <TableCell>
                        <span className="font-medium">{p.sovNumber}</span>
                        <span className="text-xs text-muted-foreground block">{p.projectName}</span>
                      </TableCell>
                      <TableCell className="text-center">#{p.paymentNumber}</TableCell>
                      <TableCell className="text-right font-medium text-emerald-600">${parseFloat(p.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{p.paymentDate ? format(new Date(p.paymentDate), "MMM d, yyyy") : "—"}</TableCell>
                      <TableCell><Badge variant="outline">{methodLabel(p.paymentMethod)}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{p.referenceNumber || "—"}</TableCell>
                      <TableCell className="text-right">
                        <span className={bal.remaining > 0.01 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                          ${bal.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Record a full or partial payment against an SOV pay app</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>SOV Pay App</Label>
              <Select value={form.sovId} onValueChange={(v) => setForm(f => ({ ...f, sovId: v }))}>
                <SelectTrigger data-testid="select-payment-sov"><SelectValue placeholder="Select SOV..." /></SelectTrigger>
                <SelectContent>
                  {sovs.map(s => <SelectItem key={s.id} value={s.id}>{s.sovNumber} - {s.title} ({s.projectName})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-payment-amount" />
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input type="date" value={form.paymentDate} onChange={(e) => setForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid="input-payment-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm(f => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECK">Check</SelectItem>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="WIRE">Wire</SelectItem>
                    <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference # (optional)</Label>
                <Input value={form.referenceNumber} onChange={(e) => setForm(f => ({ ...f, referenceNumber: e.target.value }))} data-testid="input-payment-reference" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-payment-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-payment">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.sovId || !form.amount || !form.paymentDate || createMutation.isPending}
              data-testid="button-submit-payment"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function COTieOutTab() {
  const { data: reconciliation = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/co-tieout"],
  });

  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>;
  }

  if (reconciliation.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No projects with approved change orders or SOVs to reconcile
        </CardContent>
      </Card>
    );
  }

  const reconciledCount = reconciliation.filter((r: any) => r.isReconciled).length;
  const discrepancyCount = reconciliation.filter((r: any) => !r.isReconciled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <GitCompare className="h-5 w-5" /> Change Order SOV Tie-Out
        </h2>
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {reconciledCount} Reconciled
          </Badge>
          {discrepancyCount > 0 && (
            <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
              <AlertTriangle className="h-3 w-3 mr-1" /> {discrepancyCount} Discrepancies
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Contract Value</TableHead>
                <TableHead className="text-right">Approved COs</TableHead>
                <TableHead className="text-right">Expected SOV Total</TableHead>
                <TableHead className="text-right">Actual SOV Total</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconciliation.map((r: any) => (
                <>
                  <TableRow
                    key={r.projectId}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpandedProject(expandedProject === r.projectId ? null : r.projectId)}
                    data-testid={`row-tieout-${r.projectId}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {expandedProject === r.projectId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span className="font-medium">{r.projectName}</span>
                        {r.projectCode && <span className="text-xs text-muted-foreground">({r.projectCode})</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">${r.contractValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">
                      ${r.approvedCOTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      <span className="text-xs text-muted-foreground ml-1">({r.changeOrderCount} COs)</span>
                    </TableCell>
                    <TableCell className="text-right">${r.expectedSovTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">${r.actualSovTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">
                      <span className={Math.abs(r.variance) < 0.01 ? "text-muted-foreground" : r.variance > 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                        {r.variance >= 0 ? "+" : ""}${r.variance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </TableCell>
                    <TableCell>
                      {r.isReconciled ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled
                        </Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Discrepancy
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  {expandedProject === r.projectId && (
                    <TableRow key={`${r.projectId}-detail`}>
                      <TableCell colSpan={7} className="bg-muted/20 p-4">
                        <div className="grid grid-cols-2 gap-6">
                          <div>
                            <h4 className="text-sm font-semibold mb-2">Approved Change Orders ({r.changeOrderCount})</h4>
                            {r.changeOrders.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No approved COs</p>
                            ) : (
                              <div className="space-y-1">
                                {r.changeOrders.map((co: any) => (
                                  <div key={co.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                                    <span>{co.changeOrderNumber}: {co.description}</span>
                                    <span className="font-medium">${parseFloat(co.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold mb-2">SOV Records ({r.sovCount})</h4>
                            {r.sovs.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No SOVs found</p>
                            ) : (
                              <div className="space-y-1">
                                {r.sovs.map((sov: any) => (
                                  <div key={sov.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                                    <span>{sov.sovNumber}: {sov.title}</span>
                                    <span className="font-medium">${parseFloat(sov.totalScheduledValue || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ScheduleOfValuesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [mainTab, setMainTab] = useState("pay-apps");
  const [activeTab, setActiveTab] = useState("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showAddLineItemDialog, setShowAddLineItemDialog] = useState(false);
  const [selectedSOV, setSelectedSOV] = useState<SOV | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [billingMode, setBillingMode] = useState<"all" | "material" | "labor" | "material_labor">("all");
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const billingModeLabels: Record<string, string> = {
    all: "All Categories",
    material: "Material Only",
    labor: "Labor Only",
    material_labor: "Material + Labor",
  };

  const getFilteredLineItems = (items: SOVLineItem[], mode: string) => {
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
  };

  const getFilteredTotals = (items: SOVLineItem[]) => {
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
  };

  const [createForm, setCreateForm] = useState({
    projectId: "",
    title: "",
    description: ""
  });

  const [lineItemForm, setLineItemForm] = useState({
    description: "",
    scheduledValue: ""
  });

  const { data: projects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ["/api/sov/projects"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const { data: sovs = [], isLoading: loadingSOVs } = useQuery<SOV[]>({
    queryKey: ["/api/sov"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(user.role)
  });

  // Sync selectedSOV with refreshed sovs data after query invalidation
  useEffect(() => {
    if (selectedSOV && sovs.length > 0) {
      const updatedSOV = sovs.find(s => s.id === selectedSOV.id);
      if (updatedSOV && JSON.stringify(updatedSOV) !== JSON.stringify(selectedSOV)) {
        setSelectedSOV(updatedSOV);
      }
    }
  }, [sovs, selectedSOV]);

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
      toast({ 
        title: "Failed to create SOV", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PATCH", `/api/sov/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
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
      toast({ 
        title: "Failed to add line item", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
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
      toast({ 
        title: "Failed to remove line item", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
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
      toast({ 
        title: "Failed to send", 
        description: error.message || "An error occurred", 
        variant: "destructive" 
      });
    }
  });

  const downloadPDF = async (sovId: string, mode: string = "all") => {
    try {
      const response = await fetch(`/api/sov/${sovId}/pdf?billingMode=${mode}`, {
        credentials: "include"
      });
      if (!response.ok) throw new Error("Failed to download PDF");
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const modeLabel = mode === "all" ? "" : `-${mode}`;
      a.download = `SOV-${selectedSOV?.sovNumber || sovId}${modeLabel}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
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

  const openDetailDialog = (sov: SOV) => {
    setSelectedSOV(sov);
    setBillingMode("all");
    setShowDetailDialog(true);
  };

  const toggleExpanded = (id: string) => {
    const newSet = new Set(expandedItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setExpandedItems(newSet);
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

  const formatCurrency = (value: string | null) => {
    if (!value) return "$0.00";
    const num = parseFloat(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(num);
  };

  const formatPercent = (value: string | null) => {
    if (!value) return "0%";
    const num = parseFloat(value);
    return `${num.toFixed(1)}%`;
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

  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "OFFICE_MANAGER"].includes(user.role)) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">You don't have access to Schedule of Values</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-8 w-8 text-primary" />
            Schedule of Values
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage billing schedules, payments, lien waivers, and change order reconciliation
          </p>
        </div>
        {canEdit && mainTab === "pay-apps" && (
          <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-sov">
            <Plus className="h-4 w-4 mr-2" />
            Create SOV
          </Button>
        )}
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList data-testid="tabs-main-sov">
          <TabsTrigger value="pay-apps" data-testid="tab-pay-apps">
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Pay Apps
          </TabsTrigger>
          <TabsTrigger value="lien-waivers" data-testid="tab-lien-waivers">
            <Shield className="h-4 w-4 mr-1.5" /> Lien Waivers
          </TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-payments">
            <CreditCard className="h-4 w-4 mr-1.5" /> Payments
          </TabsTrigger>
          <TabsTrigger value="co-tieout" data-testid="tab-co-tieout">
            <GitCompare className="h-4 w-4 mr-1.5" /> CO Tie-Out
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pay-apps" className="mt-6 space-y-6">

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Total SOVs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sovs.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftSOVs.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Pending Approval
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingSOVs.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Approved/Submitted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvedSOVs.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-sov">
          <TabsTrigger value="all" data-testid="tab-all">
            All ({sovs.length})
          </TabsTrigger>
          <TabsTrigger value="draft" data-testid="tab-draft">
            Draft ({draftSOVs.length})
          </TabsTrigger>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending ({pendingSOVs.length})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Approved ({approvedSOVs.length})
          </TabsTrigger>
        </TabsList>

        {["all", "draft", "pending", "approved"].map(tab => (
          <TabsContent key={tab} value={tab} className="mt-6">
            {loadingSOVs ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {(tab === "all" ? sovs : 
                  tab === "draft" ? draftSOVs : 
                  tab === "pending" ? pendingSOVs : 
                  approvedSOVs
                ).map(sov => (
                  <Collapsible key={sov.id} open={expandedItems.has(sov.id)}>
                    <Card>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between gap-4">
                          <CollapsibleTrigger 
                            className="flex items-center gap-4 cursor-pointer flex-1"
                            onClick={() => toggleExpanded(sov.id)}
                          >
                            {expandedItems.has(sov.id) ? (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            )}
                            <div className="text-left">
                              <h3 className="font-medium">{sov.sovNumber} - {sov.title}</h3>
                              <p className="text-sm text-muted-foreground">
                                {sov.projectCode} - {sov.projectName}
                              </p>
                            </div>
                          </CollapsibleTrigger>
                          <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                            {getStatusBadge(sov.status)}
                            <Badge variant="outline">
                              <Percent className="h-3 w-3 mr-1" />
                              {formatPercent(sov.overallPercentComplete)}
                            </Badge>
                            <Badge variant="secondary">
                              <DollarSign className="h-3 w-3 mr-1" />
                              {formatCurrency(sov.totalScheduledValue)}
                            </Badge>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => openDetailDialog(sov)}
                              data-testid={`button-view-sov-${sov.id}`}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                      <CollapsibleContent>
                        <div className="px-6 pb-4 border-t pt-4">
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
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ))}
                {(tab === "all" ? sovs : 
                  tab === "draft" ? draftSOVs : 
                  tab === "pending" ? pendingSOVs : 
                  approvedSOVs
                ).length === 0 && (
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
        <LienWaiversTab projects={projects} sovs={sovs} />
      </TabsContent>

      <TabsContent value="payments" className="mt-6">
        <PaymentsTab sovs={sovs} />
      </TabsContent>

      <TabsContent value="co-tieout" className="mt-6">
        <COTieOutTab />
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
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedSOV?.sovNumber} - {selectedSOV?.title}
              {selectedSOV && getStatusBadge(selectedSOV.status)}
            </DialogTitle>
            <DialogDescription>
              {selectedSOV?.projectCode} - {selectedSOV?.projectName}
            </DialogDescription>
          </DialogHeader>

          {selectedSOV && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">Contract Amount</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-bold">{formatCurrency(selectedSOV.contractAmount)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">Total Billed</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-bold">{formatCurrency(selectedSOV.totalCompleted)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">Balance to Finish</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-bold">{formatCurrency(selectedSOV.totalBalanceToFinish)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground">% Complete</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-bold">{formatPercent(selectedSOV.overallPercentComplete)}</p>
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

              {billingMode !== "all" && selectedSOV && (() => {
                const filtered = getFilteredLineItems(selectedSOV.lineItems || [], billingMode);
                const totals = getFilteredTotals(filtered);
                return (
                  <Card>
                    <CardContent className="py-4">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <Badge variant="secondary">{billingModeLabels[billingMode]}</Badge>
                        <span className="text-sm text-muted-foreground">{filtered.length} of {selectedSOV.lineItems?.length || 0} line items</span>
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
                {canEdit && selectedSOV.status === "DRAFT" && (
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
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Scheduled Value</TableHead>
                    <TableHead className="text-right">Previously Billed</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">% Complete</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    {canEdit && selectedSOV.status === "DRAFT" && (
                      <TableHead className="w-16"></TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getFilteredLineItems(selectedSOV.lineItems || [], billingMode).map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{item.itemNumber}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.scheduledValue)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.previouslyBilled)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.currentBilled)}</TableCell>
                      <TableCell className="text-right">{formatPercent(item.percentComplete)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.balanceToFinish)}</TableCell>
                      {canEdit && selectedSOV.status === "DRAFT" && (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteLineItemMutation.mutate({ 
                              sovId: selectedSOV.id, 
                              itemId: item.id 
                            })}
                            data-testid={`button-delete-item-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {getFilteredLineItems(selectedSOV.lineItems || [], billingMode).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={canEdit && selectedSOV.status === "DRAFT" ? 8 : 7} className="text-center text-muted-foreground py-8">
                        No line items yet. Add items to build your SOV.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between gap-4 pt-4 border-t flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  {canEdit && selectedSOV.status === "DRAFT" && (
                    <Button 
                      variant="outline"
                      onClick={() => updateStatusMutation.mutate({ id: selectedSOV.id, status: "PENDING" })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-submit-for-approval"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Submit for Approval
                    </Button>
                  )}
                  {canApprove && selectedSOV.status === "PENDING" && (
                    <>
                      <Button 
                        onClick={() => updateStatusMutation.mutate({ id: selectedSOV.id, status: "APPROVED" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid="button-approve-sov"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button 
                        variant="destructive"
                        onClick={() => updateStatusMutation.mutate({ id: selectedSOV.id, status: "REJECTED" })}
                        disabled={updateStatusMutation.isPending}
                        data-testid="button-reject-sov"
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                    </>
                  )}
                  {selectedSOV.status === "APPROVED" && canEdit && (
                    <Button 
                      onClick={() => updateStatusMutation.mutate({ id: selectedSOV.id, status: "SUBMITTED" })}
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
                    onClick={() => downloadPDF(selectedSOV.id, billingMode)}
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
                    onClick={() => setShowDetailDialog(false)}
                    data-testid="button-close-sov-detail"
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAddLineItemDialog} onOpenChange={setShowAddLineItemDialog}>
        <DialogContent className="max-w-md">
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
              onClick={() => selectedSOV && addLineItemMutation.mutate({
                sovId: selectedSOV.id,
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
        <DialogContent className="max-w-md">
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
              onClick={() => selectedSOV && sendToRepMutation.mutate({
                sovId: selectedSOV.id,
                email: sendEmail,
                billingMode
              })}
              disabled={!sendEmail || sendToRepMutation.isPending}
              data-testid="button-confirm-send"
            >
              {sendToRepMutation.isPending ? "Sending..." : "Send PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
