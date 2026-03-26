import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  projectId: string;
  description: string;
  storageStatus: string;
  amount: string;
  vendor: string | null;
}

interface RetentionRelease {
  id: string;
  projectId: string;
  releaseType: string;
  status: string;
  amount: string;
  reason: string | null;
  createdAt: string;
}

interface SOVItem {
  id: string;
  projectId: string;
  sovNumber: string;
  title: string;
  contractValue: string;
  status: string;
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
  const [createPayAppOpen, setCreatePayAppOpen] = useState(false);
  const [selectedSovId, setSelectedSovId] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [contractorName, setContractorName] = useState("");

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
      return Array.isArray(all) ? all.filter((m: StoredMaterial) => m.projectId === projectId) : [];
    },
  });

  const { data: retentionReleases = [], isLoading: releasesLoading } = useQuery<RetentionRelease[]>({
    queryKey: ["/api/aia-billing/retention-releases", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/aia-billing/retention-releases", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((r: RetentionRelease) => r.projectId === projectId) : [];
    },
  });

  const { data: sovList = [] } = useQuery<SOVItem[]>({
    queryKey: ["/api/sov", "project", projectId],
    queryFn: async () => {
      const all = await fetch("/api/sov", { credentials: "include" }).then(r => r.json());
      return Array.isArray(all) ? all.filter((s: SOVItem) => s.projectId === projectId) : [];
    },
  });

  const createPayAppMutation = useMutation({
    mutationFn: async (body: { projectId: string; sovId: string; periodTo?: string; contractorName?: string }) => {
      return apiRequest("POST", "/api/aia-billing/pay-applications", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/aia-billing/pay-applications", "project", projectId] });
      setCreatePayAppOpen(false);
      setSelectedSovId("");
      setPeriodTo("");
      setContractorName("");
      toast({ title: "Pay application created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const totalBilled = payApps.reduce((sum, p) => sum + parseFloat(p.currentPaymentDue || "0"), 0);
  const totalRetained = payApps.reduce((sum, p) => sum + parseFloat(p.totalRetained || "0"), 0);
  const isLoading = payAppsLoading || materialsLoading || releasesLoading;

  return (
    <div className="space-y-6" data-testid="project-billing-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-lg">Progress Billing</h3>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/progress-billing", "_blank")}
            data-testid="button-open-billing-hub"
          >
            Open Billing Hub
          </Button>
          <Button
            size="sm"
            onClick={() => setCreatePayAppOpen(true)}
            disabled={sovList.length === 0}
            data-testid="button-create-pay-app"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Pay App
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-billing-apps">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pay Applications</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : payApps.length}</div>
            <p className="text-xs text-muted-foreground">{payApps.filter(a => a.status === "DRAFT").length} drafts</p>
          </CardContent>
        </Card>

        <Card data-testid="card-billing-total">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : fmt(totalBilled)}</div>
            <p className="text-xs text-muted-foreground">Current payment due</p>
          </CardContent>
        </Card>

        <Card data-testid="card-billing-retention">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Retention Held</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? "..." : fmt(totalRetained)}</div>
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
              <p className="text-xs mt-1">{sovList.length > 0 ? "Click 'New Pay App' to create one." : "Create a Schedule of Values first."}</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Stored Materials
          </CardTitle>
        </CardHeader>
        <CardContent>
          {materialsLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : storedMaterials.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="empty-billing-materials">
              <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No stored materials for this project.</p>
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Retention Releases
          </CardTitle>
        </CardHeader>
        <CardContent>
          {releasesLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : retentionReleases.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="empty-billing-releases">
              <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No retention releases for this project.</p>
            </div>
          ) : (
            <Table data-testid="table-project-retention-releases">
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {retentionReleases.map(r => (
                  <TableRow key={r.id} data-testid={`row-release-${r.id}`}>
                    <TableCell className="font-medium capitalize">{r.releaseType.toLowerCase()}</TableCell>
                    <TableCell className="text-right">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{r.reason || "—"}</TableCell>
                    <TableCell>{fmtDate(r.createdAt)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createPayAppOpen} onOpenChange={setCreatePayAppOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Pay Application</DialogTitle>
            <DialogDescription>Create a new AIA G702/G703 pay application for this project.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Schedule of Values</Label>
              <Select value={selectedSovId} onValueChange={setSelectedSovId}>
                <SelectTrigger data-testid="select-sov">
                  <SelectValue placeholder="Select an SOV" />
                </SelectTrigger>
                <SelectContent>
                  {sovList.map(sov => (
                    <SelectItem key={sov.id} value={sov.id}>
                      {sov.sovNumber} — {sov.title} ({fmt(sov.contractValue)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Period To</Label>
              <Input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} data-testid="input-period-to" />
            </div>
            <div>
              <Label>Contractor Name (optional)</Label>
              <Input value={contractorName} onChange={e => setContractorName(e.target.value)} placeholder="Contractor name" data-testid="input-contractor-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePayAppOpen(false)} data-testid="button-cancel-pay-app">Cancel</Button>
            <Button
              disabled={!selectedSovId || createPayAppMutation.isPending}
              onClick={() => createPayAppMutation.mutate({
                projectId,
                sovId: selectedSovId,
                ...(periodTo ? { periodTo } : {}),
                ...(contractorName ? { contractorName } : {}),
              })}
              data-testid="button-submit-pay-app"
            >
              {createPayAppMutation.isPending ? "Creating..." : "Create Pay Application"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
