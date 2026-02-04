import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  DollarSign, AlertCircle, Clock, Search, Building2, Check, X, 
  CreditCard, FileText, User, Calendar, CheckCircle2, XCircle, Loader2,
  Plus, Banknote, RefreshCw
} from "lucide-react";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Payable {
  id: string;
  organizationId: string;
  contractId: string;
  paymentNumber: number;
  amount: string;
  retentionHeld: string | null;
  paymentDate: string | null;
  description: string | null;
  invoiceNumber: string | null;
  status: string;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedById: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  paidById: string | null;
  paidAt: string | null;
  checkNumber: string | null;
  paymentMethod: string | null;
  autoCreated: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  contract: {
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
  };
  subcontractor: {
    id: string;
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
  project: {
    id: string;
    name: string;
    code: string;
  };
  createdBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface PayableSummary {
  pending: { count: number; total: number };
  approved: { count: number; total: number };
  paid: { count: number; total: number };
  rejected: { count: number; total: number };
  totalPayables: number;
}

export default function SubcontractorPayablesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedPayable, setSelectedPayable] = useState<Payable | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [checkNumber, setCheckNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("CHECK");

  const { data: payables = [], isLoading, refetch } = useQuery<Payable[]>({
    queryKey: ["/api/payables"],
    enabled: !!user && (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OFFICE_MANAGER"),
    refetchInterval: 15000, // Auto-refresh every 15 seconds for real-time updates
  });

  const { data: summary } = useQuery<PayableSummary>({
    queryKey: ["/api/payables/summary"],
    enabled: !!user && (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OFFICE_MANAGER"),
    refetchInterval: 15000, // Auto-refresh every 15 seconds for real-time updates
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/payables/${id}/approve`, {});
    },
    onSuccess: () => {
      toast({ title: "Payable approved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/payables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payables/summary"] });
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve payable", description: error.message, variant: "destructive" });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return apiRequest("POST", `/api/payables/${id}/reject`, { rejectionReason: reason });
    },
    onSuccess: () => {
      toast({ title: "Payable rejected" });
      queryClient.invalidateQueries({ queryKey: ["/api/payables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payables/summary"] });
      setIsRejectOpen(false);
      setIsDetailOpen(false);
      setRejectionReason("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject payable", description: error.message, variant: "destructive" });
    }
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, paymentDate, checkNumber, paymentMethod }: { 
      id: string; 
      paymentDate: string; 
      checkNumber?: string; 
      paymentMethod?: string 
    }) => {
      return apiRequest("POST", `/api/payables/${id}/mark-paid`, { paymentDate, checkNumber, paymentMethod });
    },
    onSuccess: () => {
      toast({ title: "Payment recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/payables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payables/summary"] });
      setIsPayOpen(false);
      setIsDetailOpen(false);
      setCheckNumber("");
      setPaymentDate(format(new Date(), "yyyy-MM-dd"));
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record payment", description: error.message, variant: "destructive" });
    }
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/payables/backfill", {});
      return response.json() as Promise<{ message: string; created: number; failed?: number }>;
    },
    onSuccess: (data) => {
      toast({ 
        title: "Backfill Complete", 
        description: data.message 
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payables/summary"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Backfill Failed", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const filteredPayables = useMemo(() => {
    return payables.filter(payable => {
      if (!payable.subcontractor || !payable.project) return false;
      
      const matchesSearch =
        (payable.subcontractor.companyName?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (payable.project.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (payable.project.code?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (payable.contract.contractNumber?.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (payable.invoiceNumber && payable.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus = statusFilter === "ALL" || payable.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [payables, searchTerm, statusFilter]);

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(typeof amount === "string" ? parseFloat(amount) : amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">Pending</Badge>;
      case "APPROVED":
        return <Badge className="bg-blue-500 hover:bg-blue-600">Approved</Badge>;
      case "PAID":
        return <Badge className="bg-green-500 hover:bg-green-600">Paid</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getAgingDays = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - created.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const handleApprove = (payable: Payable) => {
    approveMutation.mutate(payable.id);
  };

  const handleReject = () => {
    if (!selectedPayable || !rejectionReason.trim()) return;
    rejectMutation.mutate({ id: selectedPayable.id, reason: rejectionReason });
  };

  const handleMarkPaid = () => {
    if (!selectedPayable || !paymentDate) return;
    markPaidMutation.mutate({
      id: selectedPayable.id,
      paymentDate,
      checkNumber: checkNumber || undefined,
      paymentMethod: paymentMethod || undefined
    });
  };

  const openDetail = (payable: Payable) => {
    setSelectedPayable(payable);
    setIsDetailOpen(true);
  };

  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "OFFICE_MANAGER")) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Card>
            <CardContent className="p-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Admin, Manager, or Office Manager access required to view subcontractor payables.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1 flex items-center gap-2" data-testid="title-payables">
              <DollarSign className="w-7 h-7 text-primary" />
              Subcontractor Payables
            </h1>
            <p className="text-sm text-muted-foreground">
              Track, approve, and manage all subcontractor payments across projects
            </p>
          </div>
          {user?.role === "ADMIN" && payables.length === 0 && (
            <Button
              variant="outline"
              onClick={() => backfillMutation.mutate()}
              disabled={backfillMutation.isPending}
              data-testid="button-run-backfill"
            >
              {backfillMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Backfill...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Sync Completed Contracts
                </>
              )}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading payables...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <Card data-testid="card-pending-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="w-4 h-4 text-yellow-500" />
                    Pending Approval
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(summary?.pending.total || 0)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summary?.pending.count || 0} invoice{summary?.pending.count !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-approved-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    Approved (Unpaid)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(summary?.approved.total || 0)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summary?.approved.count || 0} payment{summary?.approved.count !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-paid-payables">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-green-500" />
                    Total Paid (All Time)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">{formatCurrency(summary?.paid.total || 0)}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {summary?.paid.count || 0} payment{summary?.paid.count !== 1 ? 's' : ''}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-total-outstanding">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-500">
                    {formatCurrency((summary?.pending.total || 0) + (summary?.approved.total || 0))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Pending + Approved</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by subcontractor, project, or contract..."
                  className="pl-9"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-payables"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="APPROVED">Approved</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {filteredPayables.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    {searchTerm || statusFilter !== "ALL" 
                      ? "No payables match your filters" 
                      : "No subcontractor payables yet. Payables are automatically created when a subcontract is marked as completed."}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Payables List</CardTitle>
                  <CardDescription>
                    {filteredPayables.length} payable{filteredPayables.length !== 1 ? 's' : ''} found
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contract #</TableHead>
                          <TableHead>Subcontractor</TableHead>
                          <TableHead>Project</TableHead>
                          <TableHead>Scope</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Age</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPayables.map((payable) => {
                          const agingDays = getAgingDays(payable.createdAt);
                          return (
                            <TableRow key={payable.id} data-testid={`row-payable-${payable.id}`}>
                              <TableCell className="font-mono text-xs">
                                {payable.contract.contractNumber}
                                {payable.autoCreated && (
                                  <Badge variant="outline" className="ml-2 text-xs">Auto</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{payable.subcontractor.companyName}</p>
                                  {payable.subcontractor.contactName && (
                                    <p className="text-xs text-muted-foreground">{payable.subcontractor.contactName}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div>
                                  <Badge variant="outline" className="font-mono text-xs mb-1">{payable.project.code}</Badge>
                                  <p className="text-sm">{payable.project.name}</p>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-xs truncate">
                                {payable.contract.scopeOfWork}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatCurrency(payable.amount)}
                              </TableCell>
                              <TableCell>{getStatusBadge(payable.status)}</TableCell>
                              <TableCell>
                                <div className={agingDays > 30 ? "text-red-500 font-medium" : agingDays > 14 ? "text-yellow-600 dark:text-yellow-500 font-medium" : ""}>
                                  {agingDays} day{agingDays !== 1 ? 's' : ''}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {payable.status === "PENDING" && (user.role === "ADMIN" || user.role === "MANAGER") && (
                                    <>
                                      <Button 
                                        size="sm" 
                                        onClick={() => handleApprove(payable)}
                                        disabled={approveMutation.isPending}
                                        data-testid={`button-approve-${payable.id}`}
                                      >
                                        {approveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                      </Button>
                                      <Button 
                                        size="sm" 
                                        variant="outline" 
                                        onClick={() => {
                                          setSelectedPayable(payable);
                                          setRejectionReason("");
                                          setIsRejectOpen(true);
                                        }}
                                        data-testid={`button-reject-${payable.id}`}
                                      >
                                        <X className="w-3 h-3" />
                                      </Button>
                                    </>
                                  )}
                                  {payable.status === "APPROVED" && (user.role === "ADMIN" || user.role === "MANAGER") && (
                                    <Button 
                                      size="sm" 
                                      variant="outline"
                                      onClick={() => {
                                        setSelectedPayable(payable);
                                        setPaymentDate(format(new Date(), "yyyy-MM-dd"));
                                        setPaymentMethod(payable.paymentMethod || "CHECK");
                                        setCheckNumber("");
                                        setIsPayOpen(true);
                                      }}
                                      data-testid={`button-pay-${payable.id}`}
                                    >
                                      <CreditCard className="w-3 h-3 mr-1" /> Pay
                                    </Button>
                                  )}
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    onClick={() => openDetail(payable)}
                                    data-testid={`button-view-${payable.id}`}
                                  >
                                    <FileText className="w-3 h-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>

      <Dialog open={isDetailOpen} onOpenChange={(open) => {
        setIsDetailOpen(open);
        if (!open) {
          setSelectedPayable(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="payable-detail-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Payable Details
            </DialogTitle>
            <DialogDescription id="payable-detail-description">
              View full details of this subcontractor payable request.
            </DialogDescription>
          </DialogHeader>
          {selectedPayable && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Contract</p>
                  <p className="font-mono font-bold">{selectedPayable.contract.contractNumber}</p>
                </div>
                {getStatusBadge(selectedPayable.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Subcontractor</p>
                  <p className="font-medium">{selectedPayable.subcontractor.companyName}</p>
                  {selectedPayable.subcontractor.contactName && (
                    <p className="text-sm text-muted-foreground">{selectedPayable.subcontractor.contactName}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <p className="font-medium">{selectedPayable.project.name}</p>
                  <Badge variant="outline" className="font-mono text-xs">{selectedPayable.project.code}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="text-2xl font-bold">{formatCurrency(selectedPayable.amount)}</p>
                </div>
                {selectedPayable.retentionHeld && parseFloat(selectedPayable.retentionHeld) > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground">Retention Held</p>
                    <p className="text-lg font-medium text-yellow-600 dark:text-yellow-500">
                      {formatCurrency(selectedPayable.retentionHeld)}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Scope of Work</p>
                <p className="text-sm">{selectedPayable.contract.scopeOfWork}</p>
              </div>

              {selectedPayable.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="text-sm">{selectedPayable.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-sm">{format(new Date(selectedPayable.createdAt), "MMM d, yyyy h:mm a")}</p>
                  {selectedPayable.autoCreated && (
                    <Badge variant="outline" className="mt-1">Auto-generated from contract completion</Badge>
                  )}
                </div>
                {selectedPayable.approvedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Approved</p>
                    <p className="text-sm">{format(new Date(selectedPayable.approvedAt), "MMM d, yyyy h:mm a")}</p>
                  </div>
                )}
                {selectedPayable.paidAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Paid</p>
                    <p className="text-sm">{format(new Date(selectedPayable.paidAt), "MMM d, yyyy h:mm a")}</p>
                    {selectedPayable.checkNumber && (
                      <p className="text-xs text-muted-foreground">Check #{selectedPayable.checkNumber}</p>
                    )}
                    {selectedPayable.paymentMethod && (
                      <Badge variant="outline" className="mt-1">{selectedPayable.paymentMethod}</Badge>
                    )}
                  </div>
                )}
                {selectedPayable.rejectedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Rejected</p>
                    <p className="text-sm">{format(new Date(selectedPayable.rejectedAt), "MMM d, yyyy h:mm a")}</p>
                    {selectedPayable.rejectionReason && (
                      <p className="text-sm text-destructive mt-1">{selectedPayable.rejectionReason}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            {selectedPayable?.status === "PENDING" && (user.role === "ADMIN" || user.role === "MANAGER") && (
              <div className="flex gap-2 w-full justify-end">
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setRejectionReason("");
                    setIsRejectOpen(true);
                  }}
                >
                  <X className="w-4 h-4 mr-2" /> Reject
                </Button>
                <Button onClick={() => selectedPayable && handleApprove(selectedPayable)} disabled={approveMutation.isPending}>
                  {approveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
              </div>
            )}
            {selectedPayable?.status === "APPROVED" && (user.role === "ADMIN" || user.role === "MANAGER") && (
              <Button onClick={() => {
                setPaymentDate(format(new Date(), "yyyy-MM-dd"));
                setPaymentMethod(selectedPayable.paymentMethod || "CHECK");
                setCheckNumber("");
                setIsPayOpen(true);
              }}>
                <CreditCard className="w-4 h-4 mr-2" /> Record Payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRejectOpen} onOpenChange={(open) => {
        setIsRejectOpen(open);
        if (!open) {
          setRejectionReason("");
        }
      }}>
        <DialogContent aria-describedby="reject-dialog-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Reject Payable
            </DialogTitle>
            <DialogDescription id="reject-dialog-description">
              Please provide a reason for rejecting this payable request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejection-reason">Rejection Reason</Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter the reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="mt-2"
                data-testid="textarea-rejection-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={handleReject}
              disabled={!rejectionReason.trim() || rejectMutation.isPending}
              data-testid="button-confirm-reject"
            >
              {rejectMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
              Reject Payable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPayOpen} onOpenChange={(open) => {
        setIsPayOpen(open);
        if (!open) {
          setCheckNumber("");
          setPaymentDate(format(new Date(), "yyyy-MM-dd"));
          setPaymentMethod("CHECK");
        }
      }}>
        <DialogContent aria-describedby="payment-dialog-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-green-500" />
              Record Payment
            </DialogTitle>
            <DialogDescription id="payment-dialog-description">
              Enter the payment details for this approved payable.
            </DialogDescription>
          </DialogHeader>
          {selectedPayable && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Amount to Pay</p>
                <p className="text-2xl font-bold">{formatCurrency(selectedPayable.amount)}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedPayable.subcontractor.companyName} - {selectedPayable.contract.contractNumber}
                </p>
              </div>

              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payment-date">Payment Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-2",
                          !paymentDate && "text-muted-foreground"
                        )}
                        data-testid="input-payment-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {paymentDate ? format(parseISO(paymentDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={paymentDate ? parseISO(paymentDate) : undefined}
                        onSelect={(date) => setPaymentDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label htmlFor="payment-method">Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="mt-2" data-testid="select-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="ACH">ACH Transfer</SelectItem>
                      <SelectItem value="WIRE">Wire Transfer</SelectItem>
                      <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                      <SelectItem value="CASH">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="check-number">Check/Reference Number (optional)</Label>
                  <Input
                    id="check-number"
                    placeholder="e.g., 12345"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                    className="mt-2"
                    data-testid="input-check-number"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPayOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleMarkPaid}
              disabled={!paymentDate || markPaidMutation.isPending}
              data-testid="button-confirm-payment"
            >
              {markPaidMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
