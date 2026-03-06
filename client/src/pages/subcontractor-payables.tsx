import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PayablesKPICards } from "@/components/payables/PayablesKPICards";
import { PayablesTable } from "@/components/payables/PayablesTable";
import { PayableApprovalDialogs } from "@/components/payables/PayableApprovalDialogs";
import type { Payable, PayableSummary } from "@/components/payables/types";

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

export default function SubcontractorPayablesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedPayable, setSelectedPayable] = useState<Payable | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);

  const isAuthorized = !!user && (user.role === "ADMIN" || user.role === "MANAGER" || user.role === "OFFICE_MANAGER");

  const { data: payables = [], isLoading } = useQuery<Payable[]>({
    queryKey: ["/api/payables"],
    enabled: isAuthorized,
    refetchInterval: 15000,
  });

  const { data: summary } = useQuery<PayableSummary>({
    queryKey: ["/api/payables/summary"],
    enabled: isAuthorized,
    refetchInterval: 15000,
  });

  const invalidatePayables = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/payables"] });
    queryClient.invalidateQueries({ queryKey: ["/api/payables/summary"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/payables/${id}/approve`, {});
    },
    onSuccess: () => {
      toast({ title: "Payable approved successfully" });
      invalidatePayables();
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to approve payable", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return apiRequest("POST", `/api/payables/${id}/reject`, { rejectionReason: reason });
    },
    onSuccess: () => {
      toast({ title: "Payable rejected" });
      invalidatePayables();
      setIsRejectOpen(false);
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reject payable", description: error.message, variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, paymentDate, checkNumber, paymentMethod }: {
      id: string;
      paymentDate: string;
      checkNumber?: string;
      paymentMethod?: string;
    }) => {
      return apiRequest("POST", `/api/payables/${id}/mark-paid`, { paymentDate, checkNumber, paymentMethod });
    },
    onSuccess: () => {
      toast({ title: "Payment recorded successfully" });
      invalidatePayables();
      setIsPayOpen(false);
      setIsDetailOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to record payment", description: error.message, variant: "destructive" });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/payables/backfill", {});
      return response.json() as Promise<{ message: string; created: number; failed?: number }>;
    },
    onSuccess: (data) => {
      toast({ title: "Backfill Complete", description: data.message });
      invalidatePayables();
    },
    onError: (error: Error) => {
      toast({ title: "Backfill Failed", description: error.message, variant: "destructive" });
    },
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

  if (!isAuthorized) {
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
            <PayablesKPICards summary={summary} formatCurrency={formatCurrency} />
            <PayablesTable
              payables={filteredPayables}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              userRole={user.role}
              onApprove={(payable) => approveMutation.mutate(payable.id)}
              onRejectOpen={(payable) => {
                setSelectedPayable(payable);
                setIsRejectOpen(true);
              }}
              onPayOpen={(payable) => {
                setSelectedPayable(payable);
                setIsPayOpen(true);
              }}
              onViewDetail={(payable) => {
                setSelectedPayable(payable);
                setIsDetailOpen(true);
              }}
              isApproving={approveMutation.isPending}
              formatCurrency={formatCurrency}
              getStatusBadge={getStatusBadge}
            />
          </>
        )}
      </main>

      <PayableApprovalDialogs
        selectedPayable={selectedPayable}
        isDetailOpen={isDetailOpen}
        onDetailOpenChange={(open) => {
          setIsDetailOpen(open);
          if (!open) setSelectedPayable(null);
        }}
        isRejectOpen={isRejectOpen}
        onRejectOpenChange={setIsRejectOpen}
        isPayOpen={isPayOpen}
        onPayOpenChange={setIsPayOpen}
        userRole={user.role}
        onApprove={(payable) => approveMutation.mutate(payable.id)}
        onReject={(id, reason) => rejectMutation.mutate({ id, reason })}
        onMarkPaid={(params) => markPaidMutation.mutate(params)}
        isApproving={approveMutation.isPending}
        isRejecting={rejectMutation.isPending}
        isMarkingPaid={markPaidMutation.isPending}
        formatCurrency={formatCurrency}
        getStatusBadge={getStatusBadge}
      />
    </div>
  );
}
