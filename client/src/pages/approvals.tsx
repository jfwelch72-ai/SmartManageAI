import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, XCircle, Clock, FileCheck, Loader2, Inbox } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";

interface ApprovalStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

interface Approval {
  id: string;
  entityType: string;
  entityId: string;
  requestedByUserId: string;
  status: "pending" | "approved" | "rejected";
  notes: string | null;
  approverUserId: string | null;
  approverRole: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ApprovalsPage() {
  const { toast } = useToast();

  const { data: approvals, isLoading: approvalsLoading } = useQuery<Approval[]>({
    queryKey: ["/api/approvals"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ApprovalStats>({
    queryKey: ["/api/approvals/stats"],
  });

  const approveMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      const res = await apiRequest("POST", `/api/approvals/${approvalId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Approved", description: "Request has been approved." });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      const res = await apiRequest("POST", `/api/approvals/${approvalId}/reject`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rejected", description: "Request has been rejected." });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals/stats"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const actingOnId = approveMutation.isPending
    ? approveMutation.variables
    : rejectMutation.isPending
      ? rejectMutation.variables
      : null;

  const isLoading = approvalsLoading || statsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statCards = [
    { label: "Total", value: Number(stats?.total) || 0, icon: FileCheck, color: "text-primary" },
    { label: "Pending", value: Number(stats?.pending) || 0, icon: Clock, color: "text-yellow-500" },
    { label: "Approved", value: Number(stats?.approved) || 0, icon: CheckCircle, color: "text-green-500" },
    { label: "Rejected", value: Number(stats?.rejected) || 0, icon: XCircle, color: "text-red-500" },
  ];

  const pendingApprovals = (approvals || []).filter(a => a.status === "pending");

  const ENTITY_TYPE_LABELS: Record<string, string> = {
    CHANGE_ORDER: "Change Order",
    SOV_PAY_APP: "SOV / Pay App",
    TIME_APPROVAL: "Time Approval",
    VENDOR_BILL: "Vendor Bill",
    ESIGN_SEND: "E-Sign",
    QBO_EXPORT: "QBO Export",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-approvals-title">Approvals</h1>
          <p className="text-muted-foreground" data-testid="text-approvals-description">
            Review and manage pending approval requests
          </p>
        </div>
        <ContextualHelpButton />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} data-testid={`card-stat-${stat.label.toLowerCase()}`}>
              <CardContent className="flex items-center gap-3 py-4">
                <div className="p-2 rounded-lg bg-muted">
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold" data-testid={`text-stat-value-${stat.label.toLowerCase()}`}>{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold" data-testid="text-pending-heading">Pending Approvals</h2>
        {pendingApprovals.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No pending approvals"
            description="All caught up! There are no items waiting for your approval."
            testId="empty-state-approvals"
          />
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <Card key={approval.id} data-testid={`card-approval-${approval.id}`}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-yellow-500/10">
                      <Clock className="h-4 w-4 text-yellow-500" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium" data-testid={`text-approval-type-${approval.id}`}>
                          {ENTITY_TYPE_LABELS[approval.entityType] || approval.entityType}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground" data-testid={`text-approval-date-${approval.id}`}>
                        Submitted {new Date(approval.createdAt).toLocaleDateString()}
                        {approval.notes && ` — ${approval.notes}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => rejectMutation.mutate(approval.id)}
                      disabled={actingOnId !== null}
                      data-testid={`button-reject-${approval.id}`}
                    >
                      {rejectMutation.isPending && actingOnId === approval.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <XCircle className="h-4 w-4 mr-2" />
                      )}
                      Reject
                    </Button>
                    <Button
                      onClick={() => approveMutation.mutate(approval.id)}
                      disabled={actingOnId !== null}
                      data-testid={`button-approve-${approval.id}`}
                    >
                      {approveMutation.isPending && actingOnId === approval.id ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-2" />
                      )}
                      Approve
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
