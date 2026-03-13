import { useState, useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import TimeEntryContent from "@/components/TimeEntryContent";
import {
  DollarSign,
  Clock,
  AlertTriangle,
  CalendarDays,
  Plus,
  Users,
  FileText,
  CheckCircle,
  XCircle,
  ArrowRight,
  Loader2,
  Receipt,
  TrendingUp,
  Trash2,
  Archive,
  Shield,
} from "lucide-react";
import DeductionsTab from "@/components/payroll/DeductionsTab";
import PayStubView from "@/components/payroll/PayStubView";
import { CertifiedPayrollButton } from "@/components/payroll/CertifiedPayrollReport";

interface PayrollOverview {
  currentPeriod: { start: string; end: string; workWeekStart: string };
  metrics: { totalRegularHours: number; totalOvertimeHours: number; totalLaborCost: number; unapprovedEntries: number };
  recentPayRuns: PayRun[];
}

interface PayRun {
  id: string;
  organizationId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  runNumber: string | null;
  status: string;
  totalRegularHours: string;
  totalOvertimeHours: string;
  totalLaborCost: string;
  totalGrossAmount: string;
  totalDeductions: string;
  totalNetAmount: string;
  totalWorkers: number;
  notes: string | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineItems?: PayRunLineItem[];
}

interface PayRunLineItem {
  lineItem: {
    id: string;
    payRunId: string;
    userId: string;
    projectId: string;
    costCode: string | null;
    regularHours: string;
    overtimeHours: string;
    regularRate: string;
    overtimeRate: string;
    totalAmount: string;
    wageType: string | null;
  };
  userName: string;
  projectName: string;
}

interface PayrollWorker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  totalRegularHours: string;
  totalOvertimeHours: string;
  totalEntries: number;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  APPROVED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  PROCESSING: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  PAID: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  VOIDED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  ARCHIVED: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  PROCESSING: "Processing",
  PAID: "Paid",
  VOIDED: "Voided",
  ARCHIVED: "Archived",
};

export default function PayrollManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const searchString = useSearch();
  const urlTab = useMemo(() => new URLSearchParams(searchString).get("tab"), [searchString]);
  const [activeTab, setActiveTab] = useState(urlTab || "overview");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedPayRun, setSelectedPayRun] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const [newPayRun, setNewPayRun] = useState({
    payPeriodStart: weekAgo.toISOString().split("T")[0],
    payPeriodEnd: today.toISOString().split("T")[0],
    notes: "",
  });

  useEffect(() => {
    if (urlTab && ["overview", "time-entries", "workers", "pay-runs", "deductions", "archived"].includes(urlTab)) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  const { data: overview, isLoading: overviewLoading } = useQuery<PayrollOverview>({
    queryKey: ["/api/payroll/overview"],
  });

  const { data: payRunsList, isLoading: payRunsLoading } = useQuery<PayRun[]>({
    queryKey: ["/api/payroll/pay-runs"],
  });

  const { data: payRunDetail, isLoading: detailLoading } = useQuery<PayRun>({
    queryKey: ["/api/payroll/pay-runs", selectedPayRun],
    enabled: !!selectedPayRun && detailDialogOpen,
  });

  const { data: workers, isLoading: workersLoading } = useQuery<PayrollWorker[]>({
    queryKey: ["/api/payroll/workers"],
    enabled: activeTab === "workers",
  });


  const createPayRunMutation = useMutation({
    mutationFn: async (data: typeof newPayRun) => {
      return await apiRequest("POST", "/api/payroll/pay-runs", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/pay-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/overview"] });
      setCreateDialogOpen(false);
      setNewPayRun({ payPeriodStart: weekAgo.toISOString().split("T")[0], payPeriodEnd: today.toISOString().split("T")[0], notes: "" });
      toast({ title: "Pay run created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create pay run", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return await apiRequest("PUT", `/api/payroll/pay-runs/${id}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/pay-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/overview"] });
      if (selectedPayRun) {
        queryClient.invalidateQueries({ queryKey: ["/api/payroll/pay-runs", selectedPayRun] });
      }
      toast({ title: "Pay run status updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update status", variant: "destructive" });
    },
  });

  const deletePayRunMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/payroll/pay-runs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/pay-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/overview"] });
      setDetailDialogOpen(false);
      setSelectedPayRun(null);
      toast({ title: "Pay run deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete pay run", variant: "destructive" });
    },
  });

  const filteredPayRuns = payRunsList?.filter(pr =>
    pr.status !== "ARCHIVED" && (statusFilter === "all" || pr.status === statusFilter)
  ) || [];

  const archivedPayRuns = payRunsList?.filter(pr => pr.status === "ARCHIVED") || [];

  const getNextStatus = (current: string): { label: string; status: string } | null => {
    switch (current) {
      case "DRAFT": return { label: "Submit for Approval", status: "PENDING_APPROVAL" };
      case "PENDING_APPROVAL": return { label: "Approve", status: "APPROVED" };
      case "APPROVED": return { label: "Start Processing", status: "PROCESSING" };
      case "PROCESSING": return { label: "Mark as Paid", status: "PAID" };
      default: return null;
    }
  };

  const formatCurrency = (val: string | number) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
  };

  const formatHours = (val: string | number) => {
    const num = typeof val === "string" ? parseFloat(val) : val;
    return (num || 0).toFixed(1);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Payroll Management</h1>
          <p className="text-muted-foreground text-sm">Manage pay runs, time entries, and labor costs</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-pay-run">
          <Plus className="w-4 h-4 mr-2" />
          Create Pay Run
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="block md:hidden mb-4">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full" data-testid="select-payroll-tab-mobile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overview" data-testid="select-tab-overview">
                <span className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4" /> Overview</span>
              </SelectItem>
              <SelectItem value="time-entries" data-testid="select-tab-time-entries">
                <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> Time Entries</span>
              </SelectItem>
              <SelectItem value="workers" data-testid="select-tab-workers">
                <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Workers</span>
              </SelectItem>
              <SelectItem value="pay-runs" data-testid="select-tab-pay-runs">
                <span className="flex items-center gap-1.5"><Receipt className="w-4 h-4" /> Pay Runs</span>
              </SelectItem>
              <SelectItem value="deductions" data-testid="select-tab-deductions">
                <span className="flex items-center gap-1.5"><Shield className="w-4 h-4" /> Deductions</span>
              </SelectItem>
              <SelectItem value="archived" data-testid="select-tab-archived">
                <span className="flex items-center gap-1.5"><Archive className="w-4 h-4" /> Archived</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden md:flex w-full">
          <TabsTrigger value="overview" className="flex-1" data-testid="tab-overview">
            <TrendingUp className="w-4 h-4 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="time-entries" className="flex-1" data-testid="tab-time-entries">
            <Clock className="w-4 h-4 mr-1.5" />
            Time Entries
          </TabsTrigger>
          <TabsTrigger value="workers" className="flex-1" data-testid="tab-workers">
            <Users className="w-4 h-4 mr-1.5" />
            Workers
          </TabsTrigger>
          <TabsTrigger value="pay-runs" className="flex-1" data-testid="tab-pay-runs">
            <Receipt className="w-4 h-4 mr-1.5" />
            Pay Runs
          </TabsTrigger>
          <TabsTrigger value="deductions" className="flex-1" data-testid="tab-deductions">
            <Shield className="w-4 h-4 mr-1.5" />
            Deductions
          </TabsTrigger>
          <TabsTrigger value="archived" className="flex-1" data-testid="tab-archived">
            <Archive className="w-4 h-4 mr-1.5" />
            Archived
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          {overviewLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card data-testid="card-current-period">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-blue-100 dark:bg-blue-900">
                        <CalendarDays className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Current Pay Period</p>
                        <p className="font-semibold text-sm" data-testid="text-current-period">
                          {overview?.currentPeriod ? `${format(new Date(overview.currentPeriod.start + "T00:00:00"), "MMM d")} - ${format(new Date(overview.currentPeriod.end + "T00:00:00"), "MMM d")}` : "N/A"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="card-total-labor">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                        <DollarSign className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Labor Cost</p>
                        <p className="text-xl font-bold" data-testid="text-total-labor">
                          {formatCurrency(overview?.metrics.totalLaborCost || 0)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="card-overtime-hours">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                        <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Overtime Hours</p>
                        <p className="text-xl font-bold" data-testid="text-overtime-hours">
                          {formatHours(overview?.metrics.totalOvertimeHours || 0)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card data-testid="card-unapproved">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-md bg-red-100 dark:bg-red-900">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Unapproved Entries</p>
                        <p className="text-xl font-bold" data-testid="text-unapproved">
                          {overview?.metrics.unapprovedEntries || 0}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Recent Pay Runs</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("pay-runs")} data-testid="button-view-all-runs">
                      View All
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {(overview?.recentPayRuns?.length || 0) === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Receipt className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>No pay runs yet</p>
                      <p className="text-sm">Create your first pay run to get started</p>
                    </div>
                  ) : (
                    isMobile ? (
                      <div className="space-y-3">
                        {overview?.recentPayRuns?.slice(0, 5).map(pr => (
                          <Card key={pr.id} data-testid={`row-pay-run-${pr.id}`}>
                            <CardContent className="p-4 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">Run #{pr.runNumber || "—"}</span>
                                <Badge className={STATUS_COLORS[pr.status]}>{STATUS_LABELS[pr.status]}</Badge>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                              </p>
                              <div className="grid grid-cols-3 gap-2 text-sm">
                                <div>
                                  <p className="text-xs text-muted-foreground">Workers</p>
                                  <p className="font-medium">{pr.totalWorkers}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Total Hrs</p>
                                  <p className="font-medium">{formatHours(parseFloat(pr.totalRegularHours) + parseFloat(pr.totalOvertimeHours))}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Cost</p>
                                  <p className="font-medium">{formatCurrency(pr.totalLaborCost)}</p>
                                </div>
                              </div>
                              <Button variant="ghost" size="sm" className="w-full" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-view-run-${pr.id}`}>
                                View Details
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Run #</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead>Workers</TableHead>
                          <TableHead>Total Hours</TableHead>
                          <TableHead>Total Cost</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overview?.recentPayRuns?.slice(0, 5).map(pr => (
                          <TableRow key={pr.id} data-testid={`row-pay-run-${pr.id}`}>
                            <TableCell className="font-medium">{pr.runNumber || "—"}</TableCell>
                            <TableCell className="text-sm">
                              {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell>{pr.totalWorkers}</TableCell>
                            <TableCell>{formatHours(parseFloat(pr.totalRegularHours) + parseFloat(pr.totalOvertimeHours))}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(pr.totalLaborCost)}</TableCell>
                            <TableCell>
                              <Badge className={STATUS_COLORS[pr.status]}>{STATUS_LABELS[pr.status]}</Badge>
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-view-run-${pr.id}`}>
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    )
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="time-entries" className="mt-6">
          <TimeEntryContent />
        </TabsContent>

        <TabsContent value="workers" className="mt-6 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Payroll Workers</CardTitle>
              <p className="text-sm text-muted-foreground">Internal employees eligible for payroll processing</p>
            </CardHeader>
            <CardContent>
              {workersLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (workers?.length || 0) === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>No workers found</p>
                </div>
              ) : (
                isMobile ? (
                  <div className="space-y-3">
                    {workers?.map(worker => (
                      <Card key={worker.id} data-testid={`row-worker-${worker.id}`}>
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{worker.firstName} {worker.lastName}</span>
                            <Badge variant="outline" className="text-xs">{worker.role}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{worker.email}</p>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Regular Hrs</p>
                              <p className="font-medium">{formatHours(worker.totalRegularHours)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">OT Hrs</p>
                              <p className="font-medium">{parseFloat(worker.totalOvertimeHours) > 0 ? formatHours(worker.totalOvertimeHours) : "—"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Entries</p>
                              <p className="font-medium">{worker.totalEntries}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Regular Hours</TableHead>
                        <TableHead>OT Hours</TableHead>
                        <TableHead>Total Entries</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {workers?.map(worker => (
                        <TableRow key={worker.id} data-testid={`row-worker-${worker.id}`}>
                          <TableCell className="font-medium">{worker.firstName} {worker.lastName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{worker.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{worker.role}</Badge>
                          </TableCell>
                          <TableCell>{formatHours(worker.totalRegularHours)}</TableCell>
                          <TableCell>{parseFloat(worker.totalOvertimeHours) > 0 ? formatHours(worker.totalOvertimeHours) : "—"}</TableCell>
                          <TableCell>{worker.totalEntries}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pay-runs" className="mt-6 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-lg">All Pay Runs</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-run-status">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                      <SelectItem value="APPROVED">Approved</SelectItem>
                      <SelectItem value="PROCESSING">Processing</SelectItem>
                      <SelectItem value="PAID">Paid</SelectItem>
                      <SelectItem value="VOIDED">Voided</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={() => setCreateDialogOpen(true)} size="sm" data-testid="button-create-pay-run-tab">
                    <Plus className="w-4 h-4 mr-1" />
                    New Pay Run
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {payRunsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : filteredPayRuns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>No pay runs found</p>
                  <p className="text-sm">Create a pay run to generate payroll from approved time entries</p>
                </div>
              ) : (
                isMobile ? (
                  <div className="space-y-3">
                    {filteredPayRuns.map(pr => {
                      const next = getNextStatus(pr.status);
                      return (
                        <Card key={pr.id} data-testid={`row-pay-run-${pr.id}`}>
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">Run #{pr.runNumber || "—"}</span>
                              <Badge className={STATUS_COLORS[pr.status]}>{STATUS_LABELS[pr.status]}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                            </p>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">Workers</p>
                                <p className="font-medium">{pr.totalWorkers}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Regular Hrs</p>
                                <p className="font-medium">{formatHours(pr.totalRegularHours)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">OT Hrs</p>
                                <p className="font-medium">{parseFloat(pr.totalOvertimeHours) > 0 ? formatHours(pr.totalOvertimeHours) : "—"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Total Cost</p>
                                <p className="font-semibold">{formatCurrency(pr.totalLaborCost)}</p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Button variant="ghost" size="sm" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-detail-run-${pr.id}`}>
                                View
                              </Button>
                              {next && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-xs"
                                  onClick={() => updateStatusMutation.mutate({ id: pr.id, status: next.status })}
                                  disabled={updateStatusMutation.isPending}
                                  data-testid={`button-advance-run-${pr.id}`}
                                >
                                  {next.label}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => updateStatusMutation.mutate({ id: pr.id, status: "ARCHIVED" })}
                                disabled={updateStatusMutation.isPending}
                                data-testid={`button-archive-run-${pr.id}`}
                                title="Archive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run #</TableHead>
                        <TableHead>Pay Period</TableHead>
                        <TableHead>Workers</TableHead>
                        <TableHead>Regular Hrs</TableHead>
                        <TableHead>OT Hrs</TableHead>
                        <TableHead>Total Cost</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPayRuns.map(pr => {
                        const next = getNextStatus(pr.status);
                        return (
                          <TableRow key={pr.id} data-testid={`row-pay-run-${pr.id}`}>
                            <TableCell className="font-medium">{pr.runNumber || "—"}</TableCell>
                            <TableCell className="text-sm">
                              {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                            </TableCell>
                            <TableCell>{pr.totalWorkers}</TableCell>
                            <TableCell>{formatHours(pr.totalRegularHours)}</TableCell>
                            <TableCell>{parseFloat(pr.totalOvertimeHours) > 0 ? formatHours(pr.totalOvertimeHours) : "—"}</TableCell>
                            <TableCell className="font-semibold">{formatCurrency(pr.totalLaborCost)}</TableCell>
                            <TableCell>
                              <Badge className={STATUS_COLORS[pr.status]}>{STATUS_LABELS[pr.status]}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-detail-run-${pr.id}`}>
                                  View
                                </Button>
                                {next && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs"
                                    onClick={() => updateStatusMutation.mutate({ id: pr.id, status: next.status })}
                                    disabled={updateStatusMutation.isPending}
                                    data-testid={`button-advance-run-${pr.id}`}
                                  >
                                    {next.label}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-red-500"
                                  onClick={() => updateStatusMutation.mutate({ id: pr.id, status: "ARCHIVED" })}
                                  disabled={updateStatusMutation.isPending}
                                  data-testid={`button-archive-run-${pr.id}`}
                                  title="Archive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deductions" className="mt-6">
          <DeductionsTab />
        </TabsContent>

        <TabsContent value="archived" className="mt-6 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Archived Pay Runs</CardTitle>
            </CardHeader>
            <CardContent>
              {payRunsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : archivedPayRuns.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Archive className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>No archived pay runs</p>
                  <p className="text-sm">Archived pay runs will appear here</p>
                </div>
              ) : (
                isMobile ? (
                  <div className="space-y-3">
                    {archivedPayRuns.map(pr => (
                      <Card key={pr.id} data-testid={`row-archived-run-${pr.id}`}>
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">Run #{pr.runNumber || "—"}</span>
                            <Badge className={STATUS_COLORS["ARCHIVED"]}>{STATUS_LABELS["ARCHIVED"]}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                          </p>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Workers</p>
                              <p className="font-medium">{pr.totalWorkers}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Regular Hrs</p>
                              <p className="font-medium">{formatHours(pr.totalRegularHours)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">OT Hrs</p>
                              <p className="font-medium">{parseFloat(pr.totalOvertimeHours) > 0 ? formatHours(pr.totalOvertimeHours) : "—"}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Total Cost</p>
                              <p className="font-semibold">{formatCurrency(pr.totalLaborCost)}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" className="w-full" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-detail-archived-${pr.id}`}>
                            View Details
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Run #</TableHead>
                        <TableHead>Pay Period</TableHead>
                        <TableHead>Workers</TableHead>
                        <TableHead>Regular Hrs</TableHead>
                        <TableHead>OT Hrs</TableHead>
                        <TableHead>Total Cost</TableHead>
                        <TableHead>Previous Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {archivedPayRuns.map(pr => (
                        <TableRow key={pr.id} data-testid={`row-archived-run-${pr.id}`}>
                          <TableCell className="font-medium">{pr.runNumber || "—"}</TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(pr.payPeriodStart + "T00:00:00"), "MMM d")} - {format(new Date(pr.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell>{pr.totalWorkers}</TableCell>
                          <TableCell>{formatHours(pr.totalRegularHours)}</TableCell>
                          <TableCell>{parseFloat(pr.totalOvertimeHours) > 0 ? formatHours(pr.totalOvertimeHours) : "—"}</TableCell>
                          <TableCell className="font-semibold">{formatCurrency(pr.totalLaborCost)}</TableCell>
                          <TableCell>
                            <Badge className={STATUS_COLORS["ARCHIVED"]}>{STATUS_LABELS["ARCHIVED"]}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => { setSelectedPayRun(pr.id); setDetailDialogOpen(true); }} data-testid={`button-detail-archived-${pr.id}`}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Pay Run</DialogTitle>
            <DialogDescription>Generate a pay run from approved time entries for the selected period.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="period-start">Period Start</Label>
                <Input
                  id="period-start"
                  type="date"
                  value={newPayRun.payPeriodStart}
                  onChange={(e) => setNewPayRun(prev => ({ ...prev, payPeriodStart: e.target.value }))}
                  data-testid="input-period-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="period-end">Period End</Label>
                <Input
                  id="period-end"
                  type="date"
                  value={newPayRun.payPeriodEnd}
                  onChange={(e) => setNewPayRun(prev => ({ ...prev, payPeriodEnd: e.target.value }))}
                  data-testid="input-period-end"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pay-run-notes">Notes (optional)</Label>
              <Textarea
                id="pay-run-notes"
                placeholder="Add any notes about this pay run..."
                value={newPayRun.notes}
                onChange={(e) => setNewPayRun(prev => ({ ...prev, notes: e.target.value }))}
                data-testid="input-pay-run-notes"
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <p>This will pull all <strong>approved</strong> time entries within the selected date range and generate line items grouped by worker, project, and cost code.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">Cancel</Button>
            <Button
              onClick={() => createPayRunMutation.mutate(newPayRun)}
              disabled={createPayRunMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createPayRunMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Create Pay Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setSelectedPayRun(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
          {detailLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : payRunDetail ? (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-xl">Pay Run {payRunDetail.runNumber}</DialogTitle>
                  <Badge className={STATUS_COLORS[payRunDetail.status]}>{STATUS_LABELS[payRunDetail.status]}</Badge>
                </div>
                <DialogDescription>
                  {format(new Date(payRunDetail.payPeriodStart + "T00:00:00"), "MMM d, yyyy")} - {format(new Date(payRunDetail.payPeriodEnd + "T00:00:00"), "MMM d, yyyy")}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 py-4">
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">Workers</p>
                  <p className="text-lg font-bold">{payRunDetail.totalWorkers}</p>
                </div>
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">Regular Hours</p>
                  <p className="text-lg font-bold">{formatHours(payRunDetail.totalRegularHours)}</p>
                </div>
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">OT Hours</p>
                  <p className="text-lg font-bold">{formatHours(payRunDetail.totalOvertimeHours)}</p>
                </div>
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">Gross Pay</p>
                  <p className="text-lg font-bold">{formatCurrency(payRunDetail.totalGrossAmount || payRunDetail.totalLaborCost)}</p>
                </div>
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">Deductions</p>
                  <p className="text-lg font-bold text-red-600">{parseFloat(payRunDetail.totalDeductions || "0") > 0 ? `-${formatCurrency(payRunDetail.totalDeductions)}` : "$0.00"}</p>
                </div>
                <div className="bg-muted rounded-md p-3">
                  <p className="text-xs text-muted-foreground">Net Pay</p>
                  <p className="text-lg font-bold text-green-600">{formatCurrency(payRunDetail.totalNetAmount || payRunDetail.totalLaborCost)}</p>
                </div>
              </div>

              {payRunDetail.notes && (
                <div className="bg-muted rounded-md p-3 text-sm">
                  <p className="font-medium mb-1">Notes</p>
                  <p className="text-muted-foreground">{payRunDetail.notes}</p>
                </div>
              )}

              {payRunDetail.lineItems && payRunDetail.lineItems.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Line Items</h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Worker</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Cost Code</TableHead>
                          <TableHead>Regular</TableHead>
                          <TableHead>OT</TableHead>
                          <TableHead>Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payRunDetail.lineItems.map((li: PayRunLineItem) => (
                          <TableRow key={li.lineItem.id} data-testid={`row-line-item-${li.lineItem.id}`}>
                            <TableCell className="font-medium">{li.userName}</TableCell>
                            <TableCell className="text-sm">{li.projectName}</TableCell>
                            <TableCell className="text-xs">{li.lineItem.costCode || "—"}</TableCell>
                            <TableCell>{formatHours(li.lineItem.regularHours)}</TableCell>
                            <TableCell>{parseFloat(li.lineItem.overtimeHours) > 0 ? formatHours(li.lineItem.overtimeHours) : "—"}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(li.lineItem.totalAmount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="border-t pt-4">
                <PayStubView payRunId={payRunDetail.id} payRunNumber={payRunDetail.runNumber} />
              </div>

              <DialogFooter className="flex-wrap gap-2">
                <CertifiedPayrollButton payRunId={payRunDetail.id} payRunNumber={payRunDetail.runNumber} />
                {(payRunDetail.status === "DRAFT" || payRunDetail.status === "PENDING_APPROVAL") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (confirm("Are you sure you want to void this pay run? This action cannot be undone.")) {
                        updateStatusMutation.mutate({ id: payRunDetail.id, status: "VOIDED" });
                      }
                    }}
                    data-testid="button-void-run"
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Void
                  </Button>
                )}
                {(() => {
                  const next = getNextStatus(payRunDetail.status);
                  return next ? (
                    <Button
                      onClick={() => updateStatusMutation.mutate({ id: payRunDetail.id, status: next.status })}
                      disabled={updateStatusMutation.isPending}
                      data-testid="button-advance-detail"
                    >
                      {updateStatusMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                      {next.label}
                    </Button>
                  ) : null;
                })()}
              </DialogFooter>
            </>
          ) : (
            <p className="text-muted-foreground">Pay run not found</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
