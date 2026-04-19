import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  DollarSign, FileText, CheckCircle, Clock, AlertTriangle, ArrowRight,
  Plus, Download, Send, Package, Shield, TrendingUp, Loader2,
  Building2, BarChart3, RefreshCw,
} from "lucide-react";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

interface BillingProject {
  projectId: string;
  projectName: string;
  projectCode: string;
  clientName: string;
  contractValue: number;
  totalBilled: number;
  totalPaid: number;
  totalRetention: number;
  sovCount: number;
  latestStatus: string;
}

interface PayApp {
  id: string;
  organizationId: string;
  projectId: string;
  sovId: string;
  applicationNumber: number;
  periodTo: string | null;
  contractorName: string | null;
  originalContractSum: string;
  contractSumToDate: string;
  totalCompletedAndStored: string;
  currentPaymentDue: string;
  totalRetained: string;
  balanceToFinish: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  projectName: string;
  projectCode: string;
  sovNumber: string;
}

interface StoredMaterial {
  id: string;
  projectId: string;
  sovId: string;
  sovLineItemId: string | null;
  description: string;
  storageLocation: string | null;
  storageStatus: string;
  deliveryDate: string | null;
  incorporatedDate: string | null;
  amount: string;
  vendor: string | null;
  invoiceReference: string | null;
  notes: string | null;
  createdAt: string;
  projectName: string;
  projectCode: string;
}

interface RetentionRelease {
  id: string;
  projectId: string;
  sovId: string | null;
  releaseType: string;
  status: string;
  amount: string;
  reason: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  createdAt: string;
  projectName: string;
  projectCode: string;
}

interface SOVItem {
  id: string;
  projectId: string;
  sovNumber: string;
  title: string;
  contractValue: string;
  status: string;
  periodNumber: number;
}

interface ProjectItem {
  id: string;
  name: string;
  code: string;
}

interface SOVLineItem {
  id: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  scheduledValue: string;
}

interface TMTicket {
  id: string;
  ticketNumber: string;
  costCode: string | null;
  grandTotal: string;
}

interface POCommittedData {
  purchaseOrders: Array<{ id: string; poNumber: string; totalAmount: string }>;
  committedByCostCode: Record<string, number>;
}

interface BillingSummary {
  projects: BillingProject[];
  recentPayApps: PayApp[];
  aging: {
    total: number;
    current: number;
    over30: number;
    over60: number;
    over90: number;
  };
  retention: {
    totalHeld: number;
    totalReleased: number;
    remaining: number;
  };
}

function fmt(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    DRAFT: { variant: "secondary", label: "Draft" },
    PENDING: { variant: "outline", label: "Pending" },
    UNDER_REVIEW: { variant: "outline", label: "Under Review" },
    SUBMITTED: { variant: "default", label: "Submitted" },
    APPROVED: { variant: "default", label: "Approved" },
    REJECTED: { variant: "destructive", label: "Rejected" },
    PAID: { variant: "default", label: "Paid" },
    ARCHIVED: { variant: "secondary", label: "Archived" },
    REQUESTED: { variant: "outline", label: "Requested" },
    RELEASED: { variant: "default", label: "Released" },
    ON_SITE: { variant: "default", label: "On Site" },
    OFF_SITE: { variant: "outline", label: "Off Site" },
    INCORPORATED: { variant: "secondary", label: "Incorporated" },
    PARTIAL: { variant: "outline", label: "Partial" },
    FINAL: { variant: "default", label: "Final" },
  };
  const info = map[status] || { variant: "secondary" as const, label: status };
  return <Badge variant={info.variant} data-testid={`badge-status-${status.toLowerCase()}`}>{info.label}</Badge>;
}

function AgingBar({ aging }: { aging: BillingSummary["aging"] }) {
  const total = aging.total || 1;
  const segments = [
    { label: "Current", value: aging.current, color: "bg-green-500" },
    { label: "31-60 Days", value: aging.over30, color: "bg-yellow-500" },
    { label: "61-90 Days", value: aging.over60, color: "bg-orange-500" },
    { label: "90+ Days", value: aging.over90, color: "bg-red-500" },
  ];

  return (
    <div className="space-y-3" data-testid="aging-bar">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => {
          const pct = total > 0 ? (s.value / total) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div key={s.label} className={`${s.color} transition-all`} style={{ width: `${pct}%` }} title={`${s.label}: ${fmt(s.value)}`} />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {segments.map((s) => (
          <div key={s.label} className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <div className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <p className="text-sm font-semibold" data-testid={`aging-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>{fmt(s.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProgressBillingPage() {
  const { toast } = useToast();
  const { isEnabled } = useFeatureFlags();
  const dotProgressEstimateEnabled = isEnabled("DOT_PROGRESS_ESTIMATE");
  const [activeTab, setActiveTab] = useState("overview");
  const [createPayAppOpen, setCreatePayAppOpen] = useState(false);
  const [createMaterialOpen, setCreateMaterialOpen] = useState(false);
  const [createReleaseOpen, setCreateReleaseOpen] = useState(false);
  const [selectedPayApp, setSelectedPayApp] = useState<PayApp | null>(null);
  const [rejectDialogApp, setRejectDialogApp] = useState<PayApp | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentDialogApp, setPaymentDialogApp] = useState<PayApp | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CHECK");

  const { data: summary, isLoading: summaryLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/aia-billing/billing-hub/summary"],
  });

  const { data: payApps = [], isLoading: payAppsLoading } = useQuery<PayApp[]>({
    queryKey: ["/api/aia-billing/pay-applications"],
  });

  const { data: storedMaterials = [], isLoading: materialsLoading } = useQuery<StoredMaterial[]>({
    queryKey: ["/api/aia-billing/stored-materials"],
  });

  const { data: retentionReleases = [], isLoading: releasesLoading } = useQuery<RetentionRelease[]>({
    queryKey: ["/api/aia-billing/retention-releases"],
  });

  const { data: sovList = [] } = useQuery<SOVItem[]>({
    queryKey: ["/api/sov"],
  });

  const { data: projectsResponse } = useQuery<{ data: ProjectItem[] }>({
    queryKey: ["/api/projects"],
  });
  const projectsList = projectsResponse?.data ?? [];

  const updatePayAppStatus = useMutation({
    mutationFn: async ({ id, status, rejectionReason }: { id: string; status: string; rejectionReason?: string }) => {
      return apiRequest("PATCH", `/api/aia-billing/pay-applications/${id}/status`, { status, rejectionReason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/pay-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const syncPayAppTotals = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/aia-billing/pay-applications/${id}/sync-totals`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/pay-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Pay application totals synced from SOV" });
    },
    onError: () => toast({ title: "Failed to sync totals", variant: "destructive" }),
  });

  const recordPayment = useMutation({
    mutationFn: async ({ id, amount, paymentReference, paymentMethod: method }: { id: string; amount: number; paymentReference?: string; paymentMethod?: string }) => {
      return apiRequest("POST", `/api/aia-billing/pay-applications/${id}/record-payment`, { amount, paymentReference, paymentMethod: method });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/pay-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Payment recorded" });
      setPaymentDialogApp(null);
      setPaymentAmount(""); setPaymentRef(""); setPaymentMethod("CHECK");
    },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  });

  const incorporateMaterial = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/aia-billing/stored-materials/${id}/incorporate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/stored-materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Material incorporated" });
    },
    onError: () => toast({ title: "Failed to incorporate material", variant: "destructive" }),
  });

  const updateReleaseStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/aia-billing/retention-releases/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/retention-releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Release status updated" });
    },
    onError: () => toast({ title: "Failed to update release", variant: "destructive" }),
  });

  const aging = summary?.aging || { total: 0, current: 0, over30: 0, over60: 0, over90: 0 };
  const retention = summary?.retention || { totalHeld: 0, totalReleased: 0, remaining: 0 };
  const projects = summary?.projects || [];

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="progress-billing-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Progress Billing Hub</h1>
          <p className="text-muted-foreground">AIA G702/G703 billing engine, retention tracking, and payment aging</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setCreateMaterialOpen(true)} data-testid="button-add-material">
            <Package className="mr-1.5 h-4 w-4" /> Add Material
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreateReleaseOpen(true)} data-testid="button-request-release">
            <Shield className="mr-1.5 h-4 w-4" /> Retention Release
          </Button>
          <Button onClick={() => setCreatePayAppOpen(true)} data-testid="button-create-pay-app">
            <Plus className="mr-1.5 h-4 w-4" /> New Pay Application
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-ar">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total A/R Outstanding</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-ar">{summaryLoading ? "..." : fmt(aging.total)}</div>
            <p className="text-xs text-muted-foreground">{payApps.filter(a => a.status === "SUBMITTED").length} submitted applications</p>
          </CardContent>
        </Card>

        <Card data-testid="card-retention-held">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retention Held</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-retention-held">{summaryLoading ? "..." : fmt(retention.remaining)}</div>
            <p className="text-xs text-muted-foreground">{fmt(retention.totalReleased)} released</p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-projects">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Projects</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-projects">{summaryLoading ? "..." : projects.length}</div>
            <p className="text-xs text-muted-foreground">with billing activity</p>
          </CardContent>
        </Card>

        <Card data-testid="card-pay-apps">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pay Applications</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pay-app-count">{payAppsLoading ? "..." : payApps.length}</div>
            <p className="text-xs text-muted-foreground">{payApps.filter(a => a.status === "DRAFT").length} drafts</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="billing-tabs">
        <TabsList data-testid="billing-tabs-list">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="pay-applications" data-testid="tab-pay-applications">Pay Applications</TabsTrigger>
          <TabsTrigger value="stored-materials" data-testid="tab-stored-materials">Stored Materials</TabsTrigger>
          <TabsTrigger value="retention" data-testid="tab-retention">Retention</TabsTrigger>
          <TabsTrigger value="aging" data-testid="tab-aging">Payment Aging</TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment Aging Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <AgingBar aging={aging} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Retention Summary</CardTitle>
              </CardHeader>
              <CardContent>
                {summaryLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Total Held</span>
                      <span className="font-semibold" data-testid="text-retention-total-held">{fmt(retention.totalHeld)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Released</span>
                      <span className="font-semibold text-green-600" data-testid="text-retention-released">{fmt(retention.totalReleased)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between items-center">
                      <span className="text-sm font-medium">Remaining</span>
                      <span className="text-lg font-bold" data-testid="text-retention-remaining">{fmt(retention.remaining)}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project Billing Overview</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : projects.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-projects">No billing activity yet. Create a pay application to get started.</p>
              ) : (
                <Table data-testid="table-project-overview">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Contract Value</TableHead>
                      <TableHead className="text-right">Total Billed</TableHead>
                      <TableHead className="text-right">Total Paid</TableHead>
                      <TableHead className="text-right">Retention</TableHead>
                      <TableHead className="text-right">SOVs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map((p) => (
                      <TableRow key={p.projectId} data-testid={`row-project-${p.projectId}`}>
                        <TableCell className="font-medium">{p.projectCode} — {p.projectName}</TableCell>
                        <TableCell>{p.clientName || "—"}</TableCell>
                        <TableCell className="text-right">{fmt(p.contractValue)}</TableCell>
                        <TableCell className="text-right">{fmt(p.totalBilled)}</TableCell>
                        <TableCell className="text-right">{fmt(p.totalPaid)}</TableCell>
                        <TableCell className="text-right">{fmt(p.totalRetention)}</TableCell>
                        <TableCell className="text-right">{p.sovCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pay-applications" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Pay Applications</CardTitle>
              <Button size="sm" onClick={() => setCreatePayAppOpen(true)} data-testid="button-new-pay-app-tab">
                <Plus className="mr-1.5 h-4 w-4" /> New
              </Button>
            </CardHeader>
            <CardContent>
              {payAppsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : payApps.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-pay-apps">No pay applications yet.</p>
              ) : (
                <Table data-testid="table-pay-applications">
                  <TableHeader>
                    <TableRow>
                      <TableHead>App #</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Period To</TableHead>
                      <TableHead className="text-right">Contract Sum</TableHead>
                      <TableHead className="text-right">Completed</TableHead>
                      <TableHead className="text-right">Payment Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payApps.map((app) => (
                      <TableRow key={app.id} data-testid={`row-pay-app-${app.id}`}>
                        <TableCell className="font-medium">#{app.applicationNumber}</TableCell>
                        <TableCell>{app.projectCode} — {app.projectName}</TableCell>
                        <TableCell>{fmtDate(app.periodTo)}</TableCell>
                        <TableCell className="text-right">{fmt(app.contractSumToDate)}</TableCell>
                        <TableCell className="text-right">{fmt(app.totalCompletedAndStored)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmt(app.currentPaymentDue)}</TableCell>
                        <TableCell>{statusBadge(app.status)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {app.status === "DRAFT" && (
                              <Button size="sm" variant="outline" onClick={() => updatePayAppStatus.mutate({ id: app.id, status: "SUBMITTED" })}
                                disabled={updatePayAppStatus.isPending} data-testid={`button-submit-${app.id}`} title="Submit">
                                <Send className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {app.status === "SUBMITTED" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => updatePayAppStatus.mutate({ id: app.id, status: "UNDER_REVIEW" })}
                                  disabled={updatePayAppStatus.isPending} data-testid={`button-review-${app.id}`} title="Mark Under Review">
                                  <Clock className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => updatePayAppStatus.mutate({ id: app.id, status: "APPROVED" })}
                                  disabled={updatePayAppStatus.isPending} data-testid={`button-approve-${app.id}`} title="Approve">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => { setRejectDialogApp(app); setRejectionReason(""); }}
                                  data-testid={`button-reject-${app.id}`} title="Reject">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            {app.status === "UNDER_REVIEW" && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => updatePayAppStatus.mutate({ id: app.id, status: "APPROVED" })}
                                  disabled={updatePayAppStatus.isPending} data-testid={`button-approve-review-${app.id}`} title="Approve">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => { setRejectDialogApp(app); setRejectionReason(""); }}
                                  data-testid={`button-reject-review-${app.id}`} title="Reject">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                            {app.status === "REJECTED" && (
                              <Button size="sm" variant="outline" onClick={() => updatePayAppStatus.mutate({ id: app.id, status: "DRAFT" })}
                                disabled={updatePayAppStatus.isPending} data-testid={`button-revise-${app.id}`} title="Revise (back to Draft)">
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {app.status === "APPROVED" && (
                              <Button size="sm" variant="outline" onClick={() => { setPaymentDialogApp(app); setPaymentAmount(""); }}
                                data-testid={`button-record-payment-${app.id}`} title="Record Payment">
                                <DollarSign className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {app.status !== "PAID" && app.status !== "ARCHIVED" && (
                              <Button size="sm" variant="ghost" onClick={() => syncPayAppTotals.mutate(app.id)}
                                disabled={syncPayAppTotals.isPending} data-testid={`button-sync-${app.id}`} title="Sync totals from SOV">
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" asChild data-testid={`button-g702-${app.id}`}>
                              <a href={`/api/aia-billing/pay-applications/${app.id}/g702-pdf`} target="_blank" rel="noopener noreferrer" title="G702 PDF">
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                            <Button size="sm" variant="ghost" asChild data-testid={`button-g703-${app.id}`}>
                              <a href={`/api/aia-billing/pay-applications/${app.id}/g703-pdf`} target="_blank" rel="noopener noreferrer" title="G703 PDF">
                                <FileText className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                            {dotProgressEstimateEnabled && (
                              <Button size="sm" variant="ghost" asChild data-testid={`button-dot-progress-estimate-${app.id}`}>
                                <a href={`/api/dot/progress-estimates/${app.id}/pdf`} target="_blank" rel="noopener noreferrer" title="DOT Progress Estimate PDF">
                                  <BarChart3 className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stored-materials" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Stored Materials</CardTitle>
              <Button size="sm" onClick={() => setCreateMaterialOpen(true)} data-testid="button-add-material-tab">
                <Plus className="mr-1.5 h-4 w-4" /> Add Material
              </Button>
            </CardHeader>
            <CardContent>
              {materialsLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : storedMaterials.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-materials">No stored materials tracked yet.</p>
              ) : (
                <Table data-testid="table-stored-materials">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Delivered</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storedMaterials.map((m) => (
                      <TableRow key={m.id} data-testid={`row-material-${m.id}`}>
                        <TableCell className="font-medium max-w-[200px] truncate">{m.description}</TableCell>
                        <TableCell>{m.projectCode}</TableCell>
                        <TableCell>{m.vendor || "—"}</TableCell>
                        <TableCell>{m.storageLocation || "—"}</TableCell>
                        <TableCell className="text-right">{fmt(m.amount)}</TableCell>
                        <TableCell>{statusBadge(m.storageStatus)}</TableCell>
                        <TableCell>{fmtDate(m.deliveryDate)}</TableCell>
                        <TableCell>
                          {m.storageStatus !== "INCORPORATED" && (
                            <Button size="sm" variant="outline"
                              onClick={() => incorporateMaterial.mutate(m.id)}
                              disabled={incorporateMaterial.isPending}
                              data-testid={`button-incorporate-${m.id}`}>
                              <ArrowRight className="h-3.5 w-3.5 mr-1" /> Incorporate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="retention" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card data-testid="card-retention-held-detail">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Total Retained</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmt(retention.totalHeld)}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-retention-released-detail">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Released</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{fmt(retention.totalReleased)}</div>
              </CardContent>
            </Card>
            <Card data-testid="card-retention-remaining-detail">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Remaining</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmt(retention.remaining)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Retention Releases</CardTitle>
              <Button size="sm" onClick={() => setCreateReleaseOpen(true)} data-testid="button-new-release-tab">
                <Plus className="mr-1.5 h-4 w-4" /> Request Release
              </Button>
            </CardHeader>
            <CardContent>
              {releasesLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : retentionReleases.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-releases">No retention releases yet.</p>
              ) : (
                <Table data-testid="table-retention-releases">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retentionReleases.map((r) => (
                      <TableRow key={r.id} data-testid={`row-release-${r.id}`}>
                        <TableCell>{r.projectCode} — {r.projectName}</TableCell>
                        <TableCell>{statusBadge(r.releaseType)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmt(r.amount)}</TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{r.reason || "—"}</TableCell>
                        <TableCell>{fmtDate(r.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {r.status === "REQUESTED" && (
                              <Button size="sm" variant="outline" onClick={() => updateReleaseStatus.mutate({ id: r.id, status: "APPROVED" })}
                                disabled={updateReleaseStatus.isPending} data-testid={`button-approve-release-${r.id}`}>
                                <CheckCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {r.status === "APPROVED" && (
                              <Button size="sm" variant="outline" onClick={() => updateReleaseStatus.mutate({ id: r.id, status: "RELEASED" })}
                                disabled={updateReleaseStatus.isPending} data-testid={`button-release-${r.id}`}>
                                <DollarSign className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Accounts Receivable Aging Report</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-6">
                  <AgingBar aging={aging} />

                  <Table data-testid="table-aging-detail">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { label: "Current (0-30 days)", value: aging.current, color: "text-green-600" },
                        { label: "31-60 days", value: aging.over30, color: "text-yellow-600" },
                        { label: "61-90 days", value: aging.over60, color: "text-orange-600" },
                        { label: "Over 90 days", value: aging.over90, color: "text-red-600" },
                      ].map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className={`font-medium ${row.color}`}>{row.label}</TableCell>
                          <TableCell className="text-right">{fmt(row.value)}</TableCell>
                          <TableCell className="text-right">{aging.total > 0 ? ((row.value / aging.total) * 100).toFixed(1) : "0.0"}%</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell className="font-bold">Total Outstanding</TableCell>
                        <TableCell className="text-right font-bold">{fmt(aging.total)}</TableCell>
                        <TableCell className="text-right font-bold">100%</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsPanel projectsList={projectsList} sovList={sovList} />
        </TabsContent>
      </Tabs>

      <CreatePayAppDialog open={createPayAppOpen} onOpenChange={setCreatePayAppOpen} sovList={sovList} projectsList={projectsList} existingPayApps={payApps} />
      <CreateStoredMaterialDialog open={createMaterialOpen} onOpenChange={setCreateMaterialOpen} sovList={sovList} projectsList={projectsList} />
      <CreateRetentionReleaseDialog open={createReleaseOpen} onOpenChange={setCreateReleaseOpen} projectsList={projectsList} />

      <Dialog open={!!rejectDialogApp} onOpenChange={(v) => { if (!v) setRejectDialogApp(null); }}>
        <DialogContent data-testid="dialog-reject-pay-app">
          <DialogHeader>
            <DialogTitle>Reject Pay Application</DialogTitle>
            <DialogDescription>
              Reject Pay Application #{rejectDialogApp?.applicationNumber}. Please provide a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Describe the reason for rejection..." data-testid="input-rejection-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogApp(null)} data-testid="button-cancel-reject">Cancel</Button>
            <Button variant="destructive" disabled={!rejectionReason.trim() || updatePayAppStatus.isPending}
              onClick={() => {
                if (rejectDialogApp) {
                  updatePayAppStatus.mutate({ id: rejectDialogApp.id, status: "REJECTED", rejectionReason });
                  setRejectDialogApp(null);
                }
              }} data-testid="button-confirm-reject">
              {updatePayAppStatus.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <AlertTriangle className="h-4 w-4 mr-1.5" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentDialogApp} onOpenChange={(v) => { if (!v) setPaymentDialogApp(null); }}>
        <DialogContent data-testid="dialog-record-payment">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record payment for Pay Application #{paymentDialogApp?.applicationNumber}.
              {paymentDialogApp && ` Amount due: ${fmt(paymentDialogApp.currentPaymentDue)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Payment Amount ($)</Label>
              <Input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder={paymentDialogApp ? String(parseFloat(paymentDialogApp.currentPaymentDue || "0").toFixed(2)) : "0.00"}
                data-testid="input-payment-amount" />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHECK">Check</SelectItem>
                  <SelectItem value="ACH">ACH</SelectItem>
                  <SelectItem value="WIRE">Wire Transfer</SelectItem>
                  <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reference Number</Label>
              <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Check #, transaction ID, etc." data-testid="input-payment-reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogApp(null)} data-testid="button-cancel-payment">Cancel</Button>
            <Button disabled={!paymentAmount || parseFloat(paymentAmount) <= 0 || recordPayment.isPending}
              onClick={() => {
                if (paymentDialogApp && paymentAmount) {
                  recordPayment.mutate({
                    id: paymentDialogApp.id,
                    amount: parseFloat(paymentAmount),
                    paymentReference: paymentRef || undefined,
                    paymentMethod,
                  });
                }
              }} data-testid="button-confirm-payment">
              {recordPayment.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <DollarSign className="h-4 w-4 mr-1.5" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreatePayAppDialog({ open, onOpenChange, sovList, projectsList, existingPayApps }: { open: boolean; onOpenChange: (v: boolean) => void; sovList: SOVItem[]; projectsList: ProjectItem[]; existingPayApps: PayApp[] }) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [sovId, setSovId] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [architectName, setArchitectName] = useState("");

  const filteredSOVs = sovList.filter((s) => !projectId || s.projectId === projectId);

  const hasExistingPayApp = sovId ? existingPayApps.some(pa => pa.sovId === sovId) : false;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (hasExistingPayApp) {
        return apiRequest("POST", "/api/aia-billing/pay-applications/roll-forward", {
          sovId, periodTo: periodTo || undefined,
        });
      }
      return apiRequest("POST", "/api/aia-billing/pay-applications", {
        projectId, sovId, periodTo: periodTo || undefined,
        contractorName: contractorName || undefined,
        ownerName: ownerName || undefined,
        architectName: architectName || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/pay-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: hasExistingPayApp ? "New billing period created (rolled forward)" : "Pay application created" });
      onOpenChange(false);
      setProjectId(""); setSovId(""); setPeriodTo("");
      setContractorName(""); setOwnerName(""); setArchitectName("");
    },
    onError: () => toast({ title: "Failed to create pay application", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-pay-app">
        <DialogHeader>
          <DialogTitle>{hasExistingPayApp ? "New Billing Period (Roll Forward)" : "New Pay Application"}</DialogTitle>
          <DialogDescription>
            {hasExistingPayApp
              ? "Create the next billing period. Prior period totals, stored materials, and retention will carry forward automatically."
              : "Create an AIA G702 pay application from an existing SOV."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); setSovId(""); }}>
              <SelectTrigger data-testid="select-project"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projectsList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Schedule of Values</Label>
            <Select value={sovId} onValueChange={setSovId}>
              <SelectTrigger data-testid="select-sov"><SelectValue placeholder="Select SOV" /></SelectTrigger>
              <SelectContent>
                {filteredSOVs.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.sovNumber} — {s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {hasExistingPayApp && (
            <div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-700 dark:text-blue-300" data-testid="text-roll-forward-info">
              <ArrowRight className="h-4 w-4 inline mr-1.5" />
              This SOV already has a pay application. Creating a new one will roll forward prior period totals, stored materials, and line-item progress.
            </div>
          )}
          <div className="space-y-2">
            <Label>Period To</Label>
            <Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} data-testid="input-period-to" />
          </div>
          {!hasExistingPayApp && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Contractor Name</Label>
                  <Input value={contractorName} onChange={(e) => setContractorName(e.target.value)} placeholder="Contractor name" data-testid="input-contractor-name" />
                </div>
                <div className="space-y-2">
                  <Label>Owner Name</Label>
                  <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Owner name" data-testid="input-owner-name" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Architect Name</Label>
                <Input value={architectName} onChange={(e) => setArchitectName(e.target.value)} placeholder="Architect name" data-testid="input-architect-name" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-pay-app">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!projectId || !sovId || createMutation.isPending} data-testid="button-save-pay-app">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            {hasExistingPayApp ? "Roll Forward" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateStoredMaterialDialog({ open, onOpenChange, sovList, projectsList }: { open: boolean; onOpenChange: (v: boolean) => void; sovList: SOVItem[]; projectsList: ProjectItem[] }) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [sovId, setSovId] = useState("");
  const [sovLineItemId, setSovLineItemId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [storageLocation, setStorageLocation] = useState("");
  const [storageStatus, setStorageStatus] = useState("ON_SITE");
  const [deliveryDate, setDeliveryDate] = useState("");

  const filteredSOVs = sovList.filter((s) => !projectId || s.projectId === projectId);

  const { data: sovDetailData } = useQuery<{ lineItems: SOVLineItem[] }>({
    queryKey: ["/api/sov", sovId],
    enabled: !!sovId,
  });
  const sovLineItems = sovDetailData?.lineItems || [];

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/aia-billing/stored-materials", {
        projectId, sovId, description, amount,
        sovLineItemId: (sovLineItemId && sovLineItemId !== "none") ? sovLineItemId : undefined,
        vendor: vendor || undefined,
        storageLocation: storageLocation || undefined,
        storageStatus,
        deliveryDate: deliveryDate || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/stored-materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Stored material added" });
      onOpenChange(false);
      setProjectId(""); setSovId(""); setSovLineItemId(""); setDescription(""); setAmount("");
      setVendor(""); setStorageLocation(""); setStorageStatus("ON_SITE"); setDeliveryDate("");
    },
    onError: () => toast({ title: "Failed to add material", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-create-material">
        <DialogHeader>
          <DialogTitle>Add Stored Material</DialogTitle>
          <DialogDescription>Track materials stored on or off-site for AIA G703 billing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Project</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setSovId(""); }}>
                <SelectTrigger data-testid="select-material-project"><SelectValue placeholder="Select project" /></SelectTrigger>
                <SelectContent>
                  {projectsList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>SOV</Label>
              <Select value={sovId} onValueChange={(v) => { setSovId(v); setSovLineItemId(""); }}>
                <SelectTrigger data-testid="select-material-sov"><SelectValue placeholder="Select SOV" /></SelectTrigger>
                <SelectContent>
                  {filteredSOVs.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.sovNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {sovId && sovLineItems.length > 0 && (
            <div className="space-y-2">
              <Label>SOV Line Item (for G703)</Label>
              <Select value={sovLineItemId} onValueChange={setSovLineItemId}>
                <SelectTrigger data-testid="select-material-line-item"><SelectValue placeholder="Select line item (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No specific line item</SelectItem>
                  {sovLineItems.map((li) => (
                    <SelectItem key={li.id} value={li.id}>
                      #{li.lineNumber} — {li.itemCode || li.description || "Line item"} ({fmt(parseFloat(li.scheduledValue || "0"))})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Material description" data-testid="input-material-description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-material-amount" />
            </div>
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor name" data-testid="input-material-vendor" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Storage Location</Label>
              <Input value={storageLocation} onChange={(e) => setStorageLocation(e.target.value)} placeholder="Location" data-testid="input-material-location" />
            </div>
            <div className="space-y-2">
              <Label>Storage Status</Label>
              <Select value={storageStatus} onValueChange={setStorageStatus}>
                <SelectTrigger data-testid="select-material-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ON_SITE">On Site</SelectItem>
                  <SelectItem value="OFF_SITE">Off Site</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Delivery Date</Label>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} data-testid="input-material-delivery" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-material">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!projectId || !sovId || !description || !amount || createMutation.isPending} data-testid="button-save-material">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Package className="h-4 w-4 mr-1.5" />}
            Add Material
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRetentionReleaseDialog({ open, onOpenChange, projectsList }: { open: boolean; onOpenChange: (v: boolean) => void; projectsList: ProjectItem[] }) {
  const { toast } = useToast();
  const [projectId, setProjectId] = useState("");
  const [releaseType, setReleaseType] = useState("PARTIAL");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/aia-billing/retention-releases", {
        projectId, releaseType, amount, reason: reason || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/retention-releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: "Retention release requested" });
      onOpenChange(false);
      setProjectId(""); setReleaseType("PARTIAL"); setAmount(""); setReason("");
    },
    onError: () => toast({ title: "Failed to request release", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-create-release">
        <DialogHeader>
          <DialogTitle>Request Retention Release</DialogTitle>
          <DialogDescription>Submit a request to release held retainage.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="select-release-project"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projectsList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Release Type</Label>
              <Select value={releaseType} onValueChange={setReleaseType}>
                <SelectTrigger data-testid="select-release-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PARTIAL">Partial</SelectItem>
                  <SelectItem value="FINAL">Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="input-release-amount" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for retention release" data-testid="input-release-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-release">Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!projectId || !amount || createMutation.isPending} data-testid="button-save-release">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Shield className="h-4 w-4 mr-1.5" />}
            Request Release
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationsPanel({ projectsList, sovList }: { projectsList: ProjectItem[]; sovList: SOVItem[] }) {
  const { toast } = useToast();
  const [selectedProject, setSelectedProject] = useState("");
  const [tmSovId, setTmSovId] = useState("");
  const [selectedTickets, setSelectedTickets] = useState<string[]>([]);
  const [groupByCostCode, setGroupByCostCode] = useState(false);

  const filteredSOVs = sovList.filter((s) => !selectedProject || s.projectId === selectedProject);

  const { data: tmTickets = [], isLoading: tmLoading } = useQuery<TMTicket[]>({
    queryKey: ["/api/aia-billing/billing-integration/tm-tickets", selectedProject],
    enabled: !!selectedProject,
  });

  const { data: poData, isLoading: poLoading } = useQuery<POCommittedData>({
    queryKey: ["/api/aia-billing/billing-integration/po-costs", selectedProject],
    enabled: !!selectedProject,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/aia-billing/billing-integration/import-tm-tickets", {
        sovId: tmSovId,
        ticketIds: selectedTickets,
        groupByCostCode,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/billing-hub/summary"] });
      toast({ title: `Imported ${selectedTickets.length} T&M ticket(s) into SOV` });
      setSelectedTickets([]);
    },
    onError: () => toast({ title: "Failed to import T&M tickets", variant: "destructive" }),
  });

  const toggleTicket = (id: string) => {
    setSelectedTickets(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Select Project</Label>
        <Select value={selectedProject} onValueChange={(v) => { setSelectedProject(v); setSelectedTickets([]); setTmSovId(""); }}>
          <SelectTrigger data-testid="select-integration-project"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent>
            {projectsList.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedProject && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" /> T&M Ticket Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Target SOV</Label>
                <Select value={tmSovId} onValueChange={setTmSovId}>
                  <SelectTrigger data-testid="select-tm-sov"><SelectValue placeholder="Select SOV to import into" /></SelectTrigger>
                  <SelectContent>
                    {filteredSOVs.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.sovNumber} — {s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="groupByCostCode" checked={groupByCostCode} onChange={(e) => setGroupByCostCode(e.target.checked)} data-testid="checkbox-group-cost-code" />
                <Label htmlFor="groupByCostCode" className="text-sm">Group by cost code</Label>
              </div>

              {tmLoading ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : tmTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-no-tm-tickets">No approved T&M tickets available for import.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {tmTickets.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 p-2 border rounded text-sm hover:bg-muted/50 cursor-pointer" onClick={() => toggleTicket(t.id)} data-testid={`tm-ticket-${t.id}`}>
                      <input type="checkbox" checked={selectedTickets.includes(t.id)} readOnly className="pointer-events-none" />
                      <span className="font-medium">#{t.ticketNumber}</span>
                      <span className="text-muted-foreground">{t.costCode || "—"}</span>
                      <span className="ml-auto font-medium">{fmt(parseFloat(t.grandTotal || "0"))}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedTickets.length > 0 && tmSovId && (
                <Button onClick={() => importMutation.mutate()} disabled={importMutation.isPending} className="w-full" data-testid="button-import-tm">
                  {importMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <ArrowRight className="h-4 w-4 mr-1.5" />}
                  Import {selectedTickets.length} Ticket(s)
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Committed Costs (POs)</CardTitle>
            </CardHeader>
            <CardContent>
              {poLoading ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : !poData || poData.purchaseOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4" data-testid="text-no-po-data">No purchase orders found for this project.</p>
              ) : (
                <div className="space-y-4">
                  <Table data-testid="table-committed-costs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cost Code</TableHead>
                        <TableHead className="text-right">Committed Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(poData.committedByCostCode).map(([code, amount]) => (
                        <TableRow key={code}>
                          <TableCell className="font-medium">{code}</TableCell>
                          <TableCell className="text-right">{fmt(amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2">
                        <TableCell className="font-bold">Total Committed</TableCell>
                        <TableCell className="text-right font-bold">
                          {fmt(Object.values(poData.committedByCostCode).reduce((sum, v) => sum + v, 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  <div className="text-xs text-muted-foreground">
                    {poData.purchaseOrders.length} purchase order(s) across {Object.keys(poData.committedByCostCode).length} cost code(s)
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
