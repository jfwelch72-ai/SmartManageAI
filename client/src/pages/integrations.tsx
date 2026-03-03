import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Link2, Unlink, RefreshCw, Settings, CheckCircle, XCircle, Loader2,
  Upload, FileText, CreditCard, Clock, AlertCircle, ArrowDownToLine,
  ArrowUpFromLine, Activity, ChevronDown, ChevronUp, Zap, Plus,
  Trash2, Send, Globe, ToggleLeft, ToggleRight, Banknote, HardHat,
  Package, ArrowLeftRight, CalendarClock, MapPin, Shield, ShieldCheck,
  ShieldAlert, Lock, KeyRound, Info
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Provider {
  key: string;
  displayName: string;
  authType: string;
  featureFlag: string;
}

interface Connection {
  id: string;
  provider: string;
  displayName: string | null;
  status: "pending" | "active" | "disconnected" | "error";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  tokenStatus?: "valid" | "expired" | "missing";
  tokensEncrypted?: boolean;
  metadata?: {
    scope?: string;
    expiresAt?: string;
    realmId?: string;
    tokenType?: string;
    devMode?: boolean;
  };
}

interface SecurityAuditEntry {
  action: string;
  timestamp: string;
  connectionId?: string;
  provider?: string;
  userId?: string;
  success: boolean;
  details?: string;
}

interface SyncLogEntry {
  operation: string;
  dryRun: boolean;
  result: {
    success: boolean;
    entityType: string;
    direction: string;
    created: number;
    updated: number;
    skipped: number;
    errors: { entityId?: string; message: string }[];
  };
  duration: number;
  triggeredBy: string;
  triggeredAt: string;
}

interface SyncHistoryItem {
  operation: string;
  lastSyncAt: string | null;
  latestResult: SyncLogEntry["result"] | null;
  logs: SyncLogEntry[];
}

interface SyncHistoryResponse {
  history: SyncHistoryItem[];
  chartOfAccounts: { lastSyncAt: string; accountCount: number } | null;
  connectionId: string;
  provider: string;
}

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  qbo: "Sync invoices, customers, and chart of accounts with QuickBooks Online.",
  google: "Connect Gmail and Google Calendar for email ingestion and scheduling.",
  microsoft: "Integrate Outlook mail and Microsoft 365 Calendar.",
  docusign: "Send contracts and change orders for electronic signature.",
  zapier: "Connect SmartManageAI to 5,000+ apps via webhooks and automation triggers.",
};

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

function SyncPanel({ connection }: { connection: Connection }) {
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

interface AccountMapping {
  id: string;
  costCode: string;
  qboAccountId: string;
  qboAccountName: string;
  mappingType: string;
}

interface QboAccount {
  qboId: string;
  name: string;
  accountType: string;
  accountSubType: string;
  classification: string;
  active: boolean;
}

interface SyncSchedule {
  id: string;
  operation: string;
  frequency: string;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

function AccountMappingPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [newCostCode, setNewCostCode] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");

  const { data: mappings, isLoading } = useQuery<AccountMapping[]>({
    queryKey: ["/api/integrations/connections", connection.id, "account-mappings"],
    enabled: connection.status === "active",
  });

  const { data: syncHistory } = useQuery<SyncHistoryResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "sync-history"],
    enabled: connection.status === "active",
  });

  const accounts: QboAccount[] = (syncHistory as any)?.chartOfAccounts
    ? []
    : [];

  const { data: coaData } = useQuery<{ accounts: QboAccount[] }>({
    queryKey: ["/api/integrations/connections", connection.id, "chart-of-accounts"],
    enabled: false,
  });

  const allAccounts = coaData?.accounts || [];

  const saveMutation = useMutation({
    mutationFn: async ({ costCode, qboAccountId, qboAccountName }: { costCode: string; qboAccountId: string; qboAccountName: string }) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/account-mappings`, {
        costCode,
        qboAccountId,
        qboAccountName,
        mappingType: "cost_code",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
      setNewCostCode("");
      setSelectedAccount("");
    },
    onError: (error: Error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/connections/${connection.id}/account-mappings/${mappingId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
    },
  });

  const autoMapMutation = useMutation({
    mutationFn: async () => {
      const costCodes = (mappings || []).map(m => m.costCode);
      if (newCostCode && !costCodes.includes(newCostCode)) costCodes.push(newCostCode);
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/account-mappings/auto-map`, {
        costCodes: costCodes.length > 0 ? costCodes : ["General", "Labor", "Materials", "Equipment", "Subcontractor", "Overhead"],
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Auto-Map Complete",
        description: `${data.created} new mappings created from ${data.suggestions?.length || 0} matches`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-Map Failed", description: error.message, variant: "destructive" });
    },
  });

  if (!syncHistory?.chartOfAccounts) {
    return null;
  }

  return (
    <Card data-testid="card-account-mappings">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Cost Code Mappings
            </CardTitle>
            <CardDescription>Map your cost codes to QuickBooks accounts for accurate categorization</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMapMutation.mutate()}
            disabled={autoMapMutation.isPending}
            data-testid="button-auto-map"
          >
            {autoMapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Auto-Map
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {(mappings || []).map((mapping) => (
                <div
                  key={mapping.id}
                  className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                  data-testid={`mapping-row-${mapping.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-cost-code-${mapping.id}`}>{mapping.costCode}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-mapping-type-${mapping.id}`}>{mapping.mappingType}</p>
                  </div>
                  <div className="text-right flex-1 min-w-0">
                    <p className="text-sm truncate" data-testid={`text-qbo-account-${mapping.id}`}>{mapping.qboAccountName}</p>
                    <p className="text-xs text-muted-foreground">ID: {mapping.qboAccountId}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(mapping.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-mapping-${mapping.id}`}
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
                    data-testid="input-new-cost-code"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">QBO Account</Label>
                  <Input
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                    placeholder="Account name from QBO"
                    className="h-9"
                    data-testid="input-qbo-account"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newCostCode && selectedAccount) {
                      saveMutation.mutate({
                        costCode: newCostCode,
                        qboAccountId: selectedAccount,
                        qboAccountName: selectedAccount,
                      });
                    }
                  }}
                  disabled={!newCostCode || !selectedAccount || saveMutation.isPending}
                  data-testid="button-add-mapping"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const SCHEDULE_OPERATIONS = [
  { value: "chart_of_accounts", label: "Chart of Accounts" },
  { value: "customers", label: "Customers" },
  { value: "subcontractor_payments", label: "Subcontractor Bills" },
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "reconcile_payments", label: "Payment Reconciliation" },
];

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every Hour" },
  { value: "every_6h", label: "Every 6 Hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

function SyncSchedulePanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [newOp, setNewOp] = useState("");
  const [newFreq, setNewFreq] = useState("daily");

  const { data: schedules, isLoading } = useQuery<SyncSchedule[]>({
    queryKey: ["/api/integrations/connections", connection.id, "schedules"],
    enabled: connection.status === "active",
  });

  const saveMutation = useMutation({
    mutationFn: async ({ operation, frequency, isActive }: { operation: string; frequency: string; isActive?: boolean }) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/schedules`, {
        operation,
        frequency,
        isActive,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "schedules"] });
      setNewOp("");
      setNewFreq("daily");
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/connections/${connection.id}/schedules/${scheduleId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "schedules"] });
    },
  });

  return (
    <Card data-testid="card-sync-schedules">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Automatic Sync Schedules
        </CardTitle>
        <CardDescription>Configure operations to run automatically on a schedule</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {(schedules || []).map((schedule) => {
                const opInfo = SCHEDULE_OPERATIONS.find(o => o.value === schedule.operation);
                const freqInfo = FREQUENCY_OPTIONS.find(f => f.value === schedule.frequency);
                return (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                    data-testid={`schedule-row-${schedule.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" data-testid={`text-schedule-op-${schedule.id}`}>{opInfo?.label || schedule.operation}</p>
                      <p className="text-xs text-muted-foreground">
                        {freqInfo?.label || schedule.frequency}
                        {schedule.lastRunAt && ` · Last: ${new Date(schedule.lastRunAt).toLocaleString()}`}
                        {schedule.nextRunAt && ` · Next: ${new Date(schedule.nextRunAt).toLocaleString()}`}
                      </p>
                    </div>
                    <Switch
                      checked={schedule.isActive}
                      onCheckedChange={(checked) => saveMutation.mutate({
                        operation: schedule.operation,
                        frequency: schedule.frequency,
                        isActive: checked,
                      })}
                      data-testid={`switch-schedule-active-${schedule.id}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(schedule.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-schedule-${schedule.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}

              <div className="flex gap-2 items-end pt-2 border-t">
                <div className="flex-1">
                  <Label className="text-xs">Operation</Label>
                  <Select value={newOp} onValueChange={setNewOp}>
                    <SelectTrigger className="h-9" data-testid="select-schedule-operation">
                      <SelectValue placeholder="Select operation" />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_OPERATIONS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={newFreq} onValueChange={setNewFreq}>
                    <SelectTrigger className="h-9" data-testid="select-schedule-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newOp) {
                      saveMutation.mutate({ operation: newOp, frequency: newFreq });
                    }
                  }}
                  disabled={!newOp || saveMutation.isPending}
                  data-testid="button-add-schedule"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface ZapierWebhook {
  id: string;
  name: string;
  webhookUrl: string;
  eventTypes: string[];
  isActive: boolean;
  secretKey: string;
  lastTriggeredAt: string | null;
  lastStatus: string | null;
  triggerCount: number;
  connectionId: string;
  createdAt: string;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  "project.created": "Project Created",
  "project.updated": "Project Updated",
  "project.status_changed": "Project Status Changed",
  "bid.created": "Bid Created",
  "bid.status_changed": "Bid Status Changed",
  "change_order.created": "Change Order Created",
  "change_order.approved": "Change Order Approved",
  "change_order.rejected": "Change Order Rejected",
  "invoice.created": "Invoice Created",
  "invoice.paid": "Invoice Paid",
  "time_entry.submitted": "Time Entry Submitted",
  "time_entry.approved": "Time Entry Approved",
  "task.created": "Task Created",
  "task.completed": "Task Completed",
  "document.uploaded": "Document Uploaded",
  "safety_incident.reported": "Safety Incident Reported",
};

function ZapierWebhookPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);

  const { data: webhooks, isLoading } = useQuery<ZapierWebhook[]>({
    queryKey: ["/api/integrations/zapier/webhooks"],
  });

  const { data: eventTypes } = useQuery<string[]>({
    queryKey: ["/api/integrations/zapier/event-types"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/integrations/zapier/webhooks", {
        connectionId: connection.id,
        name: newName,
        webhookUrl: newUrl,
        eventTypes: selectedEvents,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Webhook Created", description: "Zapier webhook configured successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
      setShowAddForm(false);
      setNewName("");
      setNewUrl("");
      setSelectedEvents([]);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/integrations/zapier/webhooks/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/zapier/webhooks/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Deleted", description: "Webhook removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/zapier/webhooks"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/integrations/zapier/webhooks/${id}/test`);
      return res.json();
    },
    onSuccess: (data: { delivered: boolean; status: number }) => {
      toast({
        title: data.delivered ? "Test Successful" : "Test Failed",
        description: data.delivered
          ? `Webhook responded with status ${data.status}`
          : `Webhook returned status ${data.status}`,
        variant: data.delivered ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Test Failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleEvent = (eventType: string) => {
    setSelectedEvents((prev) =>
      prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2" data-testid="text-zapier-heading">
            <Zap className="h-5 w-5 text-orange-500" />
            Zapier Webhooks
          </h2>
          <p className="text-sm text-muted-foreground">
            Send events from SmartManageAI to Zapier to trigger automations
          </p>
        </div>
        <Button
          onClick={() => setShowAddForm(!showAddForm)}
          size="sm"
          data-testid="button-add-webhook"
        >
          <Plus className="h-4 w-4 mr-1" />
          Add Webhook
        </Button>
      </div>

      {showAddForm && (
        <Card data-testid="card-add-webhook-form">
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <div>
                <Label htmlFor="webhook-name">Webhook Name</Label>
                <Input
                  id="webhook-name"
                  placeholder="e.g., New Project Notifications"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  data-testid="input-webhook-name"
                />
              </div>
              <div>
                <Label htmlFor="webhook-url">Zapier Webhook URL</Label>
                <Input
                  id="webhook-url"
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  data-testid="input-webhook-url"
                />
              </div>
            </div>
            <div>
              <Label>Events to Send</Label>
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-2">
                {(eventTypes || Object.keys(EVENT_TYPE_LABELS)).map((evt) => (
                  <label
                    key={evt}
                    className="flex items-center gap-2 text-sm p-2 rounded border cursor-pointer hover:bg-muted/50"
                    data-testid={`checkbox-event-${evt}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(evt)}
                      onChange={() => toggleEvent(evt)}
                      className="rounded"
                    />
                    {EVENT_TYPE_LABELS[evt] || evt}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddForm(false)} data-testid="button-cancel-webhook">
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newName || !newUrl || selectedEvents.length === 0 || createMutation.isPending}
                data-testid="button-save-webhook"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save Webhook
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (webhooks || []).length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-zapier-webhooks">
              No webhooks configured yet. Click "Add Webhook" to connect SmartManageAI events to Zapier.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(webhooks || []).map((webhook) => (
            <Card key={webhook.id} data-testid={`card-webhook-${webhook.id}`}>
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30 mt-0.5">
                      <Zap className="h-4 w-4 text-orange-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium" data-testid={`text-webhook-name-${webhook.id}`}>{webhook.name}</p>
                        <Badge variant={webhook.isActive ? "default" : "secondary"} className="text-xs">
                          {webhook.isActive ? "Active" : "Paused"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-xs sm:max-w-md" title={webhook.webhookUrl}>
                        <Globe className="h-3 w-3 inline mr-1" />
                        {webhook.webhookUrl}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {webhook.eventTypes.slice(0, 3).map((evt) => (
                          <Badge key={evt} variant="outline" className="text-xs">
                            {EVENT_TYPE_LABELS[evt] || evt}
                          </Badge>
                        ))}
                        {webhook.eventTypes.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{webhook.eventTypes.length - 3} more
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        <span>Triggers: {webhook.triggerCount}</span>
                        {webhook.lastTriggeredAt && (
                          <span>Last: {new Date(webhook.lastTriggeredAt).toLocaleString()}</span>
                        )}
                        {webhook.lastStatus && (
                          <Badge variant={webhook.lastStatus === "success" ? "default" : "destructive"} className="text-xs h-4">
                            {webhook.lastStatus}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testMutation.mutate(webhook.id)}
                      disabled={testMutation.isPending}
                      title="Send test event"
                      data-testid={`button-test-webhook-${webhook.id}`}
                    >
                      {testMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleMutation.mutate({ id: webhook.id, isActive: !webhook.isActive })}
                      title={webhook.isActive ? "Pause webhook" : "Activate webhook"}
                      data-testid={`button-toggle-webhook-${webhook.id}`}
                    >
                      {webhook.isActive ? <ToggleRight className="h-4 w-4 text-green-500" /> : <ToggleLeft className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(webhook.id)}
                      disabled={deleteMutation.isPending}
                      title="Delete webhook"
                      data-testid={`button-delete-webhook-${webhook.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SecurityBanner() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20" data-testid="card-security-banner">
      <CardContent className="py-3 px-4">
        <button
          className="w-full flex items-center justify-between text-left"
          onClick={() => setExpanded(!expanded)}
          data-testid="button-toggle-security-banner"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
            <span className="font-medium text-sm text-green-800 dark:text-green-300">Integration Security Active</span>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-green-600" /> : <ChevronDown className="h-4 w-4 text-green-600" />}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2 text-sm text-green-700 dark:text-green-400">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              <span>All integration credentials are encrypted at rest using AES-256-GCM</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 shrink-0" />
              <span>Tokens are never exposed to your browser — only metadata is transmitted</span>
            </div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span>Access is restricted to administrators only</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TokenStatusBadge({ status, encrypted }: { status?: string; encrypted?: boolean }) {
  if (status === "valid") {
    return (
      <div className="flex items-center gap-1.5" data-testid="badge-token-valid">
        <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
          {encrypted ? "Encrypted" : "Valid"}
        </span>
      </div>
    );
  }
  if (status === "expired") {
    return (
      <div className="flex items-center gap-1.5" data-testid="badge-token-expired">
        <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Expired</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5" data-testid="badge-token-missing">
      <Shield className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">No Token</span>
    </div>
  );
}

function SecurityDetailsPanel({ connection }: { connection: Connection }) {
  const [expanded, setExpanded] = useState(false);
  const meta = connection.metadata || {};

  return (
    <div className="mt-2" data-testid={`panel-security-details-${connection.id}`}>
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-security-details-${connection.id}`}
      >
        <Info className="h-3 w-3" />
        <span>Security Details</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 p-3 bg-muted/50 rounded-lg text-xs space-y-1.5" data-testid={`security-details-content-${connection.id}`}>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Encryption</span>
            <span className="font-medium">{connection.tokensEncrypted ? "AES-256-GCM" : "N/A"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Token Status</span>
            <span className="font-medium capitalize">{connection.tokenStatus || "unknown"}</span>
          </div>
          {meta.expiresAt && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Token Expiry</span>
              <span className="font-medium">{new Date(meta.expiresAt).toLocaleString()}</span>
            </div>
          )}
          {meta.scope && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Scopes</span>
              <span className="font-medium truncate max-w-[200px]">{meta.scope}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span className="font-medium">{new Date(connection.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SecurityAuditPanel() {
  const [expanded, setExpanded] = useState(false);

  const { data: auditEntries, isLoading } = useQuery<SecurityAuditEntry[]>({
    queryKey: ["/api/integrations/security-log"],
    enabled: expanded,
  });

  const ACTION_LABELS: Record<string, string> = {
    "security.tokens_encrypted": "Tokens Encrypted",
    "security.tokens_cleared": "Tokens Cleared",
    "security.token_refresh_success": "Token Refreshed",
    "security.token_refresh_failed": "Token Refresh Failed",
    "security.auth_attempt_failed": "Auth Attempt Failed",
    "security.credentials_changed": "Credentials Changed",
    "connection.authorized": "Connection Authorized",
    "connection.disconnected": "Connection Disconnected",
  };

  return (
    <Card data-testid="card-security-audit">
      <CardHeader className="pb-3">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded(!expanded)}
          data-testid="button-toggle-security-audit"
        >
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Security Log</CardTitle>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <CardDescription>Security events for integration credentials</CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !auditEntries?.length ? (
            <div className="py-6 text-center">
              <Shield className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-security-events">No security events recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {auditEntries.map((entry, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 text-sm"
                  data-testid={`security-log-entry-${idx}`}
                >
                  <div className="flex items-center gap-2">
                    {entry.success ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    )}
                    <span className="font-medium">{ACTION_LABELS[entry.action] || entry.action}</span>
                    {entry.provider && (
                      <Badge variant="outline" className="text-xs">{entry.provider}</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function IntegrationsPage() {
  const { toast } = useToast();

  const { data: providers, isLoading: providersLoading } = useQuery<Provider[]>({
    queryKey: ["/api/integrations/providers"],
  });

  const { data: connections, isLoading: connectionsLoading } = useQuery<Connection[]>({
    queryKey: ["/api/integrations/connections"],
  });

  const connectMutation = useMutation({
    mutationFn: async (providerKey: string) => {
      const res = await apiRequest("POST", `/api/integrations/connections`, { provider: providerKey, devMode: true });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Connected", description: "Integration connected successfully (dev mode)." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connectionId}/disconnect`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "Integration disconnected." });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/providers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = providersLoading || connectionsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getConnectionForProvider = (providerKey: string) =>
    (connections || []).find(c => c.provider === providerKey && c.status !== "disconnected");

  const activeConnections = (connections || []).filter(c => c.status === "active");
  const qboConnection = activeConnections.find(c => c.provider === "qbo");
  const zapierConnection = activeConnections.find(c => c.provider === "zapier");

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-integrations-title">Integrations Hub</h1>
        <p className="text-muted-foreground" data-testid="text-integrations-description">
          Connect your favorite tools and services to streamline your workflow
        </p>
      </div>

      <SecurityBanner />

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {(providers || []).map((provider) => {
          const conn = getConnectionForProvider(provider.key);
          const isConnected = conn?.status === "active";
          return (
            <Card key={provider.key} data-testid={`card-provider-${provider.key}`}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    )}
                    <CardTitle className="text-base">{provider.displayName}</CardTitle>
                  </div>
                  <Badge variant={isConnected ? "default" : "secondary"} data-testid={`badge-provider-status-${provider.key}`}>
                    {isConnected ? "Connected" : conn ? conn.status : "Disconnected"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{PROVIDER_DESCRIPTIONS[provider.key] || provider.displayName}</p>
                {isConnected && conn && (
                  <TokenStatusBadge status={conn.tokenStatus} encrypted={conn.tokensEncrypted} />
                )}
                {conn ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => disconnectMutation.mutate(conn.id)}
                    disabled={disconnectMutation.isPending}
                    data-testid={`button-disconnect-${provider.key}`}
                  >
                    {disconnectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Unlink className="h-4 w-4 mr-2" />
                    )}
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => connectMutation.mutate(provider.key)}
                    disabled={connectMutation.isPending}
                    data-testid={`button-connect-${provider.key}`}
                  >
                    {connectMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Link2 className="h-4 w-4 mr-2" />
                    )}
                    Connect
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {qboConnection ? (
        <div className="space-y-4">
          <SyncPanel connection={qboConnection} />
          <AccountMappingPanel connection={qboConnection} />
          <SyncSchedulePanel connection={qboConnection} />
        </div>
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Accounting Sync</h2>
          <Card>
            <CardContent className="py-8 text-center">
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-qbo">
                Connect QuickBooks Online above to enable accounting sync operations.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      {zapierConnection ? (
        <ZapierWebhookPanel connection={zapierConnection} />
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            Zapier Webhooks
          </h2>
          <Card>
            <CardContent className="py-8 text-center">
              <Zap className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-zapier">
                Connect Zapier above to configure webhook automations.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Separator />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold" data-testid="text-connections-heading">Active Connections</h2>
        {activeConnections.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Link2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-connections">No active connections yet. Connect a provider above to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {activeConnections.map((connection) => (
              <Card key={connection.id} data-testid={`card-connection-${connection.id}`}>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Settings className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium" data-testid={`text-connection-name-${connection.id}`}>{connection.displayName || connection.provider}</p>
                        <p className="text-sm text-muted-foreground" data-testid={`text-connection-sync-${connection.id}`}>
                          {connection.lastSyncAt
                            ? `Last synced: ${new Date(connection.lastSyncAt).toLocaleString()}`
                            : "Never synced"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <TokenStatusBadge status={connection.tokenStatus} encrypted={connection.tokensEncrypted} />
                      <Badge
                        variant={connection.status === "active" ? "default" : connection.status === "error" ? "destructive" : "secondary"}
                        data-testid={`badge-connection-status-${connection.id}`}
                      >
                        {connection.status}
                      </Badge>
                    </div>
                  </div>
                  <SecurityDetailsPanel connection={connection} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <SecurityAuditPanel />
    </div>
  );
}
