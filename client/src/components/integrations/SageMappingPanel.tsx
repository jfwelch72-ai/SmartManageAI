import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw,
  Loader2,
  Plus,
  Trash2,
  MapPin,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { JobProgressBar } from "@/components/JobProgressBar";
import type { Connection } from "./types";

interface SageMapping {
  id: string;
  costCode: string;
  sageAccountId: string;
  sageAccountName: string;
  mappingType: string;
}

interface SageAccount {
  sageId: string;
  accountNumber: string;
  name: string;
  accountType: string;
  status: string;
}

interface SageAccountsResponse {
  accounts: SageAccount[];
  syncedAt: string | null;
}

const SAGE_OPERATIONS: Array<{
  id: string;
  label: string;
  description: string;
  direction: "import" | "export";
  needsData?: boolean;
  helper?: string;
}> = [
  {
    id: "sage_chart_of_accounts",
    label: "Chart of Accounts",
    description: "Pull GL accounts from Sage Intacct so cost codes can be mapped.",
    direction: "import",
  },
  {
    id: "sage_customers",
    label: "Customers",
    description: "Push CRM customers into Sage Intacct.",
    direction: "export",
    needsData: true,
    helper: "Customers are exported from the CRM page; this trigger is informational.",
  },
  {
    id: "sage_invoice",
    label: "Invoice",
    description: "Export individual SOV invoices from the SOV page.",
    direction: "export",
    needsData: true,
    helper: "Use the SOV page to export individual invoices.",
  },
  {
    id: "sage_payment_status",
    label: "Payment Status",
    description: "Refresh paid / partial / unpaid status for previously-exported invoices.",
    direction: "import",
  },
];

export function SageMappingPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [newCostCode, setNewCostCode] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [activeSync, setActiveSync] = useState<string | null>(null);
  // Task #2530 — track the queued accounting_sync jobId so the panel can
  // render the live progress bar driven by useJobProgress.
  const [periodicSyncJobId, setPeriodicSyncJobId] = useState<string | null>(null);

  const isActive = connection.status === "active";

  const mappingsQuery = useQuery<SageMapping[]>({
    queryKey: ["/api/integrations/connections", connection.id, "sage-account-mappings"],
    enabled: isActive,
  });

  const accountsQuery = useQuery<SageAccountsResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "sage-accounts"],
    enabled: isActive,
  });

  const accounts = accountsQuery.data?.accounts || [];
  const selectedAccount = accounts.find((a) => a.sageId === selectedAccountId);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!newCostCode || !selectedAccount) {
        throw new Error("Cost code and Sage account are required");
      }
      const res = await apiRequest(
        "POST",
        `/api/integrations/connections/${connection.id}/sage-account-mappings`,
        {
          costCode: newCostCode,
          sageAccountId: selectedAccount.sageId,
          sageAccountName: selectedAccount.name,
          mappingType: "cost_code",
        },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping saved" });
      setNewCostCode("");
      setSelectedAccountId("");
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/connections", connection.id, "sage-account-mappings"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/integrations/connections/${connection.id}/sage-account-mappings/${mappingId}`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping removed" });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/connections", connection.id, "sage-account-mappings"],
      });
    },
  });

  const autoMapMutation = useMutation({
    mutationFn: async () => {
      const seedCodes = (mappingsQuery.data || []).map((m) => m.costCode);
      if (newCostCode && !seedCodes.includes(newCostCode)) seedCodes.push(newCostCode);
      const codes =
        seedCodes.length > 0
          ? seedCodes
          : ["General", "Labor", "Materials", "Equipment", "Subcontractor", "Overhead"];
      const res = await apiRequest(
        "POST",
        `/api/integrations/connections/${connection.id}/sage-account-mappings/auto-map`,
        { costCodes: codes },
      );
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Auto-map complete",
        description: `${data.created} new mappings created from ${data.suggestions?.length || 0} matches`,
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/connections", connection.id, "sage-account-mappings"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Auto-map failed", description: err.message, variant: "destructive" });
    },
  });

  const periodicSyncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/integrations/connections/${connection.id}/periodic-sync`,
      );
      return res.json();
    },
    onSuccess: (data: { jobId?: string }) => {
      if (data.jobId) setPeriodicSyncJobId(data.jobId);
      else toast({ title: "Sync failed", description: "No job id returned", variant: "destructive" });
    },
    onError: (err: Error) =>
      toast({ title: "Background sync failed", description: err.message, variant: "destructive" }),
  });

  const handlePeriodicSyncComplete = () => {
    toast({ title: "Sync complete" });
    queryClient.invalidateQueries({
      queryKey: ["/api/integrations/connections", connection.id, "sage-accounts"],
    });
    setPeriodicSyncJobId(null);
  };

  const handlePeriodicSyncFail = (_id: string, message?: string) => {
    toast({
      title: "Background sync failed",
      description: message ?? "Job failed",
      variant: "destructive",
    });
    setPeriodicSyncJobId(null);
  };

  const syncMutation = useMutation({
    mutationFn: async (operation: string) => {
      setActiveSync(operation);
      const res = await apiRequest(
        "POST",
        `/api/integrations/connections/${connection.id}/sync`,
        { operation, dryRun: false },
      );
      return { operation, body: await res.json() } as const;
    },
    onSuccess: ({ operation, body }) => {
      const op = SAGE_OPERATIONS.find((o) => o.id === operation);
      if (body?.success === false) {
        toast({
          title: `${op?.label || operation} failed`,
          description: body?.errors?.[0]?.message || "Unknown error",
          variant: "destructive",
        });
      } else {
        toast({
          title: `${op?.label || operation} synced`,
          description: `Created: ${body?.created ?? 0}, Updated: ${body?.updated ?? 0}, Skipped: ${body?.skipped ?? 0}`,
        });
      }
      setActiveSync(null);
      queryClient.invalidateQueries({
        queryKey: ["/api/integrations/connections", connection.id, "sage-accounts"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Sync error", description: err.message, variant: "destructive" });
      setActiveSync(null);
    },
  });

  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-4" data-testid="sage-panel-root">
      <h2 className="text-xl font-semibold">Sage Intacct</h2>

      <Card data-testid="card-sage-sync">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Sync Operations
          </CardTitle>
          <CardDescription>
            Trigger Sage Intacct XML Gateway operations. The periodic sync runs every 4 hours
            in the background; manual triggers are useful after configuration changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 border rounded-md p-3">
            <div className="text-xs text-muted-foreground">
              Run the full periodic Sage sync now in the background. Progress streams live —
              you can leave the page and come back.
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => periodicSyncMutation.mutate()}
              disabled={periodicSyncMutation.isPending || !!periodicSyncJobId}
              data-testid="button-sage-periodic-sync"
            >
              {periodicSyncMutation.isPending || !!periodicSyncJobId ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Run periodic sync
            </Button>
          </div>
          {periodicSyncJobId && (
            <JobProgressBar
              jobId={periodicSyncJobId}
              fallbackMessage="Starting Sage sync..."
              onComplete={handlePeriodicSyncComplete}
              onFail={handlePeriodicSyncFail}
              testIdPrefix="job-progress-sage-sync"
            />
          )}
        <div className="grid sm:grid-cols-2 gap-3">
          {SAGE_OPERATIONS.map((op) => {
            const Icon = op.direction === "import" ? ArrowDownToLine : ArrowUpFromLine;
            const disabled = syncMutation.isPending || op.needsData === true;
            const running = activeSync === op.id;
            return (
              <div
                key={op.id}
                className="border rounded-md p-3 flex flex-col gap-2"
                data-testid={`card-sage-op-${op.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium" data-testid={`text-sage-op-label-${op.id}`}>
                      {op.label}
                    </span>
                  </div>
                  <Badge variant="outline">{op.direction}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{op.description}</p>
                {op.helper && (
                  <p className="text-xs text-muted-foreground italic">{op.helper}</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || running}
                  onClick={() => syncMutation.mutate(op.id)}
                  data-testid={`button-sage-run-${op.id}`}
                >
                  {running ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Run now
                </Button>
              </div>
            );
          })}
        </div>
        </CardContent>
      </Card>

      <Card data-testid="card-sage-account-mappings">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Cost Code → Sage GL Mappings
              </CardTitle>
              <CardDescription>
                Map SmartManageAI cost codes to Sage Intacct GL accounts so journal entries
                post to the right account.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => autoMapMutation.mutate()}
              disabled={autoMapMutation.isPending || accounts.length === 0}
              data-testid="button-sage-auto-map"
            >
              {autoMapMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Auto-Map
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {accountsQuery.isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : accounts.length === 0 ? (
            <div
              className="flex items-start gap-2 p-3 rounded-md bg-muted/40"
              data-testid="text-sage-no-coa"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Run <strong>Chart of Accounts</strong> first to load Sage GL accounts before
                creating mappings.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {mappingsQuery.isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {(mappingsQuery.data || []).length === 0 && (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="text-sage-no-mappings"
                    >
                      No mappings yet. Use Auto-Map for a starter set, or add one below.
                    </p>
                  )}
                  {(mappingsQuery.data || []).map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                      data-testid={`row-sage-mapping-${m.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          data-testid={`text-sage-cost-code-${m.id}`}
                        >
                          {m.costCode}
                        </p>
                        <p className="text-xs text-muted-foreground">{m.mappingType}</p>
                      </div>
                      <div className="text-right flex-1 min-w-0">
                        <p
                          className="text-sm truncate"
                          data-testid={`text-sage-account-${m.id}`}
                        >
                          {m.sageAccountName}
                        </p>
                        <p className="text-xs text-muted-foreground">ID: {m.sageAccountId}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(m.id)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-sage-delete-${m.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}

                  <div className="flex gap-2 items-end pt-2 border-t">
                    <div className="flex-1">
                      <Label className="text-xs">Cost Code</Label>
                      <Input
                        value={newCostCode}
                        onChange={(e) => setNewCostCode(e.target.value)}
                        placeholder="e.g. Labor, Materials, 01-100"
                        className="h-9"
                        data-testid="input-sage-new-cost-code"
                      />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Sage GL Account</Label>
                      <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                        <SelectTrigger className="h-9" data-testid="select-sage-account">
                          <SelectValue placeholder="Select an account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((a) => (
                            <SelectItem key={a.sageId} value={a.sageId}>
                              {a.accountNumber} — {a.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => saveMutation.mutate()}
                      disabled={
                        saveMutation.isPending || !newCostCode || !selectedAccountId
                      }
                      data-testid="button-sage-add-mapping"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Plus className="h-4 w-4 mr-1" />
                      )}
                      Add
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
