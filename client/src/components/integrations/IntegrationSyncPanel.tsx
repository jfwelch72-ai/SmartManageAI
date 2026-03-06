import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  RefreshCw, Settings, CheckCircle, XCircle, Loader2,
  Upload, CreditCard, Clock, AlertCircle, ArrowDownToLine,
  ArrowUpFromLine, Activity, ChevronDown, ChevronUp, Banknote, HardHat,
  Package, ArrowLeftRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Connection, SyncHistoryResponse } from "./types";

const OPERATION_CONFIG: Record<string, { label: string; description: string; direction: string; icon: typeof ArrowDownToLine; needsData: boolean; disabledReason?: string }> = {
  chart_of_accounts: { label: "Chart of Accounts", description: "Import your chart of accounts from QuickBooks", direction: "Import", icon: ArrowDownToLine, needsData: false },
  customers: { label: "Customers", description: "Export CRM contacts to QuickBooks (auto-pulls from your CRM)", direction: "Export", icon: ArrowUpFromLine, needsData: false },
  invoices: { label: "Invoices", description: "Export SOV invoices to QuickBooks for billing", direction: "Export", icon: Upload, needsData: true, disabledReason: "Use the SOV page to export individual invoices" },
  payment_status: { label: "Payment Status", description: "Check payment status of exported invoices", direction: "Import", icon: CreditCard, needsData: true, disabledReason: "Available after invoices are exported" },
  payroll: { label: "Payroll", description: "Export approved pay runs as journal entries to QuickBooks", direction: "Export", icon: Banknote, needsData: true, disabledReason: "Use Pay Runs page to export individual runs" },
  subcontractor_payments: { label: "Subcontractor Bills", description: "Export approved subcontractor payments as bills to QuickBooks", direction: "Export", icon: HardHat, needsData: false },
  purchase_orders: { label: "Purchase Orders", description: "Export procurement items with PO numbers to QuickBooks", direction: "Export", icon: Package, needsData: false },
  reconcile_payments: { label: "Payment Reconciliation", description: "Check all exported invoices for payment updates from QuickBooks", direction: "Import", icon: ArrowLeftRight, needsData: false },
};

export function IntegrationSyncPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState(false);
  const [activeSync, setActiveSync] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);

  const { data: syncHistory, isLoading: historyLoading } = useQuery<SyncHistoryResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "sync-history"],
    enabled: connection.status === "active",
  });

  const syncMutation = useMutation({
    mutationFn: async ({ operation, dryRun: isDry }: { operation: string; dryRun: boolean }) => {
      setActiveSync(operation);
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/sync`, { operation, dryRun: isDry });
      return res.json();
    },
    onSuccess: (data, variables) => {
      const opLabel = OPERATION_CONFIG[variables.operation]?.label || variables.operation;
      const mode = variables.dryRun ? " (Preview)" : "";
      if (data.success) {
        toast({
          title: `${opLabel} Sync Complete${mode}`,
          description: `Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped} (${data.duration}ms)`,
        });
      } else {
        toast({
          title: `${opLabel} Sync Failed${mode}`,
          description: data.errors?.[0]?.message || "Unknown error occurred",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "sync-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
      setActiveSync(null);
    },
    onError: (error: Error) => {
      toast({ title: "Sync Error", description: error.message, variant: "destructive" });
      setActiveSync(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/test`);
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: data.ok ? "Connection OK" : "Connection Issue",
        description: data.message,
        variant: data.ok ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  if (connection.provider !== "qbo") {
    return (
      <Card className="border-dashed" data-testid={`card-sync-unsupported-${connection.id}`}>
        <CardContent className="py-6 text-center">
          <Settings className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Sync operations for {connection.displayName || connection.provider} are not yet available.</p>
        </CardContent>
      </Card>
    );
  }

  const getLogForOperation = (op: string) => syncHistory?.history.find(h => h.operation === op);

  return (
    <div className="space-y-4" data-testid={`sync-panel-${connection.id}`}>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">QuickBooks Online Sync</CardTitle>
              <CardDescription>Run sync operations between SmartManageAI and QuickBooks</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="dry-run"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                  data-testid="switch-dry-run"
                />
                <Label htmlFor="dry-run" className="text-sm cursor-pointer">
                  Preview mode
                </Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                data-testid="button-test-connection"
              >
                {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Activity className="h-4 w-4 mr-1" />}
                Test
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {dryRun && (
            <div className="flex items-center gap-2 mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>Preview mode is on. Syncs will simulate without making changes.</span>
            </div>
          )}

          {syncHistory?.chartOfAccounts && (
            <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
              <span className="font-medium">Chart of Accounts:</span>{" "}
              {syncHistory.chartOfAccounts.accountCount} accounts synced
              {syncHistory.chartOfAccounts.lastSyncAt && (
                <span className="text-muted-foreground ml-2">
                  (last: {new Date(syncHistory.chartOfAccounts.lastSyncAt).toLocaleString()})
                </span>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(OPERATION_CONFIG).map(([op, info]) => {
              const log = getLogForOperation(op);
              const isSyncing = activeSync === op && syncMutation.isPending;
              const Icon = info.icon;
              const isDisabled = info.needsData;
              return (
                <Card key={op} className={`border ${isDisabled ? "opacity-70" : ""}`} data-testid={`card-sync-op-${op}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{info.label}</p>
                          <Badge variant="outline" className="text-xs mt-0.5">
                            {info.direction}
                          </Badge>
                        </div>
                      </div>
                      {log?.latestResult && (
                        <Badge
                          variant={log.latestResult.success ? "default" : "destructive"}
                          className="text-xs"
                          data-testid={`badge-sync-status-${op}`}
                        >
                          {log.latestResult.success ? "OK" : "Failed"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{info.description}</p>
                    {log?.lastSyncAt && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(log.lastSyncAt).toLocaleString()}
                      </p>
                    )}
                    {isDisabled ? (
                      <p className="text-xs text-muted-foreground italic">{info.disabledReason}</p>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full"
                        variant={dryRun ? "outline" : "default"}
                        onClick={() => syncMutation.mutate({ operation: op, dryRun })}
                        disabled={isSyncing || (syncMutation.isPending && activeSync !== op)}
                        data-testid={`button-sync-${op}`}
                      >
                        {isSyncing ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1" />
                        )}
                        {dryRun ? "Preview" : "Sync Now"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-sync-history">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Sync History</CardTitle>
          <CardDescription>Recent sync operations and results</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !syncHistory?.history.length ? (
            <div className="py-8 text-center">
              <Clock className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-sync-history">No sync history yet. Run a sync operation above to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {syncHistory.history.map((item) => {
                const info = OPERATION_CONFIG[item.operation];
                const isExpanded = expandedLogs === item.operation;
                return (
                  <div key={item.operation} className="border rounded-lg" data-testid={`sync-history-${item.operation}`}>
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors text-left"
                      onClick={() => setExpandedLogs(isExpanded ? null : item.operation)}
                      data-testid={`button-expand-history-${item.operation}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          {item.latestResult?.success ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : item.latestResult ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-medium text-sm">{info?.label || item.operation}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {item.logs.length} run{item.logs.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.lastSyncAt && (
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {new Date(item.lastSyncAt).toLocaleString()}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t px-3 pb-3">
                        <div className="divide-y">
                          {item.logs.slice(0, 10).map((log, idx) => (
                            <div key={idx} className="py-2.5 text-sm" data-testid={`sync-log-entry-${item.operation}-${idx}`}>
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <Badge variant={log.result?.success ? "default" : "destructive"} className="text-xs">
                                  {log.result?.success ? "Success" : "Failed"}
                                </Badge>
                                {log.dryRun && <Badge variant="outline" className="text-xs">Preview</Badge>}
                                <span className="text-xs text-muted-foreground">
                                  {new Date(log.triggeredAt).toLocaleString()}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {log.duration}ms
                                </span>
                              </div>
                              {log.result && (
                                <div className="flex gap-3 text-xs text-muted-foreground">
                                  <span>Created: <strong className="text-foreground">{log.result.created}</strong></span>
                                  <span>Updated: <strong className="text-foreground">{log.result.updated}</strong></span>
                                  <span>Skipped: <strong className="text-foreground">{log.result.skipped}</strong></span>
                                </div>
                              )}
                              {log.result?.errors?.length > 0 && (
                                <div className="mt-1.5 p-2 bg-red-50 dark:bg-red-950/20 rounded text-xs text-red-700 dark:text-red-300">
                                  {log.result.errors.slice(0, 3).map((e, ei) => (
                                    <p key={ei}>{e.message}</p>
                                  ))}
                                  {log.result.errors.length > 3 && (
                                    <p className="text-red-500">...and {log.result.errors.length - 3} more errors</p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
