import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, FileText, Shield, Loader2, Package, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PayApp {
  id: string;
  projectId: string;
  applicationNumber: number;
  periodTo: string | null;
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
}

interface StoredMaterial {
  id: string;
  description: string;
  storageStatus: string;
  amount: string;
  vendor: string | null;
}

interface RetentionRelease {
  id: string;
  releaseType: string;
  status: string;
  amount: string;
  reason: string | null;
  createdAt: string;
}

function fmt(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return "$" + num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
    DRAFT: { variant: "secondary", label: "Draft" },
    SUBMITTED: { variant: "default", label: "Submitted" },
    APPROVED: { variant: "default", label: "Approved" },
    REJECTED: { variant: "destructive", label: "Rejected" },
    PAID: { variant: "default", label: "Paid" },
    REQUESTED: { variant: "outline", label: "Requested" },
    RELEASED: { variant: "default", label: "Released" },
    ON_SITE: { variant: "default", label: "On Site" },
    OFF_SITE: { variant: "outline", label: "Off Site" },
    INCORPORATED: { variant: "secondary", label: "Incorporated" },
    PARTIAL: { variant: "outline", label: "Partial" },
    FINAL: { variant: "default", label: "Final" },
  };
  const info = map[status] || { variant: "secondary" as const, label: status };
  return <Badge variant={info.variant} data-testid={`badge-billing-status-${status.toLowerCase()}`}>{info.label}</Badge>;
}

interface BillingTabProps {
  projectId: string;
  projectCode: string;
}

export default function BillingTab({ projectId, projectCode }: BillingTabProps) {
  const { toast } = useToast();

  const { data: payApps = [], isLoading: payAppsLoading } = useQuery<PayApp[]>({
    queryKey: ["/api/aia-billing/pay-applications", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/aia-billing/pay-applications", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((p: PayApp) => p.projectId === projectId) : [];
    },
  });

  const { data: storedMaterials = [], isLoading: materialsLoading } = useQuery<StoredMaterial[]>({
    queryKey: ["/api/aia-billing/stored-materials", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/aia-billing/stored-materials", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((m: { projectId: string }) => m.projectId === projectId) : [];
    },
  });

  const { data: retentionReleases = [], isLoading: releasesLoading } = useQuery<RetentionRelease[]>({
    queryKey: ["/api/aia-billing/retention-releases", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/aia-billing/retention-releases", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((r: { projectId: string }) => r.projectId === projectId) : [];
    },
  });

  const totalBilled = payApps.reduce((sum, p) => sum + parseFloat(p.currentPaymentDue || "0"), 0);
  const totalRetained = payApps.reduce((sum, p) => sum + parseFloat(p.totalRetained || "0"), 0);

  return (
    <div className="space-y-6" data-testid="project-billing-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Progress Billing</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open("/progress-billing", "_blank")}
          data-testid="button-open-billing-hub"
        >
          Open Billing Hub
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-billing-apps">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pay Applications</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payAppsLoading ? "..." : payApps.length}</div>
            <p className="text-xs text-muted-foreground">{payApps.filter(a => a.status === "DRAFT").length} drafts</p>
          </CardContent>
        </Card>

        <Card data-testid="card-billing-total">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payAppsLoading ? "..." : fmt(totalBilled)}</div>
            <p className="text-xs text-muted-foreground">Current payment due</p>
          </CardContent>
        </Card>

        <Card data-testid="card-billing-retention">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retention Held</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{payAppsLoading ? "..." : fmt(totalRetained)}</div>
            <p className="text-xs text-muted-foreground">{retentionReleases.length} release requests</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pay Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {payAppsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : payApps.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="empty-billing-pay-apps">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No pay applications for this project.</p>
              <p className="text-xs mt-1">Create one from the Progress Billing Hub.</p>
            </div>
          ) : (
            <Table data-testid="table-project-pay-apps">
              <TableHeader>
                <TableRow>
                  <TableHead>App #</TableHead>
                  <TableHead>Period To</TableHead>
                  <TableHead className="text-right">Contract Sum</TableHead>
                  <TableHead className="text-right">Payment Due</TableHead>
                  <TableHead className="text-right">Retained</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payApps.map(app => (
                  <TableRow key={app.id} data-testid={`row-pay-app-${app.id}`}>
                    <TableCell className="font-medium">#{app.applicationNumber}</TableCell>
                    <TableCell>{fmtDate(app.periodTo)}</TableCell>
                    <TableCell className="text-right">{fmt(app.contractSumToDate)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(app.currentPaymentDue)}</TableCell>
                    <TableCell className="text-right">{fmt(app.totalRetained)}</TableCell>
                    <TableCell>{statusBadge(app.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {storedMaterials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Stored Materials ({storedMaterials.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table data-testid="table-project-stored-materials">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {storedMaterials.map(m => (
                  <TableRow key={m.id} data-testid={`row-material-${m.id}`}>
                    <TableCell className="font-medium">{m.description}</TableCell>
                    <TableCell>{m.vendor || "—"}</TableCell>
                    <TableCell className="text-right">{fmt(m.amount)}</TableCell>
                    <TableCell>{statusBadge(m.storageStatus)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
