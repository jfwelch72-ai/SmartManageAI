import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, CheckCircle, XCircle, Loader2,
  ArrowDownToLine, ArrowUpFromLine, Activity,
  ChevronDown, ChevronUp, Building2, FileText,
  Calculator, HardHat, KeyRound, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Connection } from "./types";

interface StackCTSyncHistoryItem {
  operation: string;
  lastSyncAt: string | null;
  latestResult: {
    success: boolean;
    entityType: string;
    direction: string;
    created: number;
    updated: number;
    skipped: number;
    errors: { entityId?: string; message: string }[];
  } | null;
  logs: any[];
}

interface StackCTSyncHistoryResponse {
  history: StackCTSyncHistoryItem[];
  projectMappings: { localProjectId: string; stackctProjectId: string; projectName: string }[];
  connectionId: string;
  provider: string;
}

const STACKCT_OPERATIONS: Record<string, {
  label: string;
  description: string;
  direction: string;
  icon: typeof ArrowDownToLine;
  requiresProject: boolean;
}> = {
  import_projects: {
    label: "Import Projects",
    description: "Import projects from STACK CT into the platform",
    direction: "Import",
    icon: ArrowDownToLine,
    requiresProject: false,
  },
  export_projects: {
    label: "Export Projects",
    description: "Export platform projects to STACK CT",
    direction: "Export",
    icon: ArrowUpFromLine,
    requiresProject: false,
  },
  import_plans: {
    label: "Import Plans",
    description: "Import plan documents from a STACK CT project",
    direction: "Import",
    icon: FileText,
    requiresProject: true,
  },
  export_plans: {
    label: "Export Plans",
    description: "Export plan documents to a STACK CT project",
    direction: "Export",
    icon: FileText,
    requiresProject: true,
  },
  import_estimates: {
    label: "Import Takeoff/Estimates",
    description: "Import takeoff and estimate data from STACK CT",
    direction: "Import",
    icon: Calculator,
    requiresProject: true,
  },
  export_estimates: {
    label: "Export Estimates",
    description: "Export estimate line items to STACK CT as takeoffs",
    direction: "Export",
    icon: Calculator,
    requiresProject: true,
  },
};

function CredentialForm({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const authorizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/stackct-authorize`, {
        clientId,
        clientSecret,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Connected to STACK CT",
        description: "Credentials validated and connection authorized successfully.",
      });
      setClientId("");
      setClientSecret("");
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Authorization Failed",
        description: error.message || "Please check your credentials and try again.",
        variant: "destructive",
      });
    },
  });

  const isConnected = connection.status === "active";

  return (
    <div className="space-y-4" data-testid="stackct-credential-form">
      {isConnected ? (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-green-700 dark:text-green-400">
            Connected to STACK CT
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => authorizeMutation.mutate()}
            disabled={authorizeMutation.isPending || !clientId || !clientSecret}
            data-testid="button-stackct-reauthorize"
          >
            {authorizeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <KeyRound className="h-4 w-4 mr-1" />}
            Re-authorize
          </Button>
        </div>
      ) : (
        <div className="p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Enter STACK CT API Credentials</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Provide your STACK CT Client ID and Client Secret to establish a server-to-server connection.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="stackct-client-id" className="text-sm">Client ID</Label>
          <Input
            id="stackct-client-id"
            type="text"
            placeholder="Enter Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            data-testid="input-stackct-client-id"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stackct-client-secret" className="text-sm">Client Secret</Label>
          <Input
            id="stackct-client-secret"
            type="password"
            placeholder="Enter Client Secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            data-testid="input-stackct-client-secret"
          />
        </div>
      </div>

      {!isConnected && (
        <Button
          onClick={() => authorizeMutation.mutate()}
          disabled={authorizeMutation.isPending || !clientId || !clientSecret}
          className="w-full"
          data-testid="button-stackct-authorize"
        >
          {authorizeMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <KeyRound className="h-4 w-4 mr-2" />
          )}
          Authorize Connection
        </Button>
      )}
    </div>
  );
}

function ProjectSyncControls({
  connection,
  projectMappings,
  dryRun,
  syncHistory,
}: {
  connection: Connection;
  projectMappings: { localProjectId: string; stackctProjectId: string; projectName: string }[];
  dryRun: boolean;
  syncHistory: StackCTSyncHistoryResponse | undefined;
}) {
  const { toast } = useToast();
  const [selectedMapping, setSelectedMapping] = useState<string>("");
  const [activeSync, setActiveSync] = useState<string | null>(null);

  const syncMutation = useMutation({
    mutationFn: async ({ operation, localProjectId, stackctProjectId }: { operation: string; localProjectId: string; stackctProjectId: string }) => {
      setActiveSync(operation);
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/stackct-sync`, {
        operation,
        dryRun,
        localProjectId,
        stackctProjectId,
      });
      return res.json();
    },
    onSuccess: (data, variables) => {
      const opLabel = STACKCT_OPERATIONS[variables.operation]?.label || variables.operation;
      const mode = dryRun ? " (Preview)" : "";
      if (data.success) {
        toast({
          title: `${opLabel} Complete${mode}`,
          description: `Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped} (${data.duration}ms)`,
        });
      } else {
        toast({
          title: `${opLabel} Failed${mode}`,
          description: data.errors?.[0]?.message || "Unknown error occurred",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "stackct-sync-history"] });
      setActiveSync(null);
    },
    onError: (error: Error) => {
      toast({ title: "Sync Error", description: error.message, variant: "destructive" });
      setActiveSync(null);
    },
  });

  const getLastSync = (operation: string) => {
    const item = syncHistory?.history?.find(h => h.operation === operation);
    return item?.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString() : null;
  };

  const getLatestResult = (operation: string) => {
    return syncHistory?.history?.find(h => h.operation === operation)?.latestResult || null;
  };

  const currentMapping = projectMappings.find(m => `${m.localProjectId}::${m.stackctProjectId}` === selectedMapping);

  if (projectMappings.length === 0) {
    return (
      <div className="p-3 rounded-lg border bg-muted/30 text-center">
        <Building2 className="h-5 w-5 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium">No Linked Projects</p>
        <p className="text-xs text-muted-foreground mt-1">
          Import or export projects first to create project mappings, then use project-level sync operations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Select Linked Project</Label>
        <Select value={selectedMapping} onValueChange={setSelectedMapping}>
          <SelectTrigger data-testid="select-stackct-project">
            <SelectValue placeholder="Choose a linked project..." />
          </SelectTrigger>
          <SelectContent>
            {projectMappings.map((m) => (
              <SelectItem
                key={`${m.localProjectId}::${m.stackctProjectId}`}
                value={`${m.localProjectId}::${m.stackctProjectId}`}
              >
                {m.projectName || `Project ${m.localProjectId.substring(0, 8)}...`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {currentMapping && (
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(STACKCT_OPERATIONS)
            .filter(([_, config]) => config.requiresProject)
            .map(([key, config]) => {
              const Icon = config.icon;
              const lastSync = getLastSync(key);
              const result = getLatestResult(key);
              const isActive = activeSync === key;

              return (
                <div
                  key={key}
                  className="flex items-start justify-between p-3 rounded-lg border bg-card"
                  data-testid={`stackct-op-${key}`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`p-1.5 rounded-md ${config.direction === "Import" ? "bg-green-500/10" : "bg-blue-500/10"}`}>
                      <Icon className={`h-4 w-4 ${config.direction === "Import" ? "text-green-600" : "text-blue-600"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{config.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                      {lastSync && (
                        <p className="text-xs text-muted-foreground mt-1">Last: {lastSync}</p>
                      )}
                      {result && (
                        <div className="flex items-center gap-1 mt-1">
                          {result.success ? (
                            <CheckCircle className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          <span className="text-xs">
                            {result.created}c / {result.updated}u / {result.skipped}s
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncMutation.mutate({
                      operation: key,
                      localProjectId: currentMapping.localProjectId,
                      stackctProjectId: currentMapping.stackctProjectId,
                    })}
                    disabled={isActive || syncMutation.isPending}
                    data-testid={`button-stackct-sync-${key}`}
                  >
                    {isActive ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function StackCTSyncPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [dryRun, setDryRun] = useState(false);
  const [activeSync, setActiveSync] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);

  const isConnected = connection.status === "active";

  const { data: syncHistory, isLoading: historyLoading } = useQuery<StackCTSyncHistoryResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "stackct-sync-history"],
    enabled: isConnected,
  });

  const syncMutation = useMutation({
    mutationFn: async ({ operation, dryRun: isDry }: { operation: string; dryRun: boolean }) => {
      setActiveSync(operation);
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/stackct-sync`, {
        operation,
        dryRun: isDry,
      });
      return res.json();
    },
    onSuccess: (data, variables) => {
      const opLabel = STACKCT_OPERATIONS[variables.operation]?.label || variables.operation;
      const mode = variables.dryRun ? " (Preview)" : "";
      if (data.success) {
        toast({
          title: `${opLabel} Complete${mode}`,
          description: `Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped} (${data.duration}ms)`,
        });
      } else {
        toast({
          title: `${opLabel} Failed${mode}`,
          description: data.errors?.[0]?.message || "Unknown error occurred",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "stackct-sync-history"] });
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

  const getLastSync = (operation: string) => {
    const item = syncHistory?.history?.find(h => h.operation === operation);
    return item?.lastSyncAt ? new Date(item.lastSyncAt).toLocaleString() : null;
  };

  const getLatestResult = (operation: string) => {
    return syncHistory?.history?.find(h => h.operation === operation)?.latestResult || null;
  };

  return (
    <Card data-testid="card-stackct-sync">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <HardHat className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg" data-testid="text-stackct-sync-title">STACK CT Integration</CardTitle>
              <CardDescription>Sync projects, plans, and estimates with STACK CT</CardDescription>
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                data-testid="button-stackct-test-connection"
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Activity className="h-4 w-4 mr-1" />
                )}
                Test
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  id="stackct-dry-run"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                  data-testid="switch-stackct-dry-run"
                />
                <Label htmlFor="stackct-dry-run" className="text-sm">Preview</Label>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CredentialForm connection={connection} />

        {isConnected && (
          <>
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Global Sync Operations</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(STACKCT_OPERATIONS)
                  .filter(([_, config]) => !config.requiresProject)
                  .map(([key, config]) => {
                    const Icon = config.icon;
                    const lastSync = getLastSync(key);
                    const result = getLatestResult(key);
                    const isActive = activeSync === key;

                    return (
                      <div
                        key={key}
                        className="flex items-start justify-between p-3 rounded-lg border bg-card"
                        data-testid={`stackct-op-${key}`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`p-1.5 rounded-md ${config.direction === "Import" ? "bg-green-500/10" : "bg-blue-500/10"}`}>
                            <Icon className={`h-4 w-4 ${config.direction === "Import" ? "text-green-600" : "text-blue-600"}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm">{config.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{config.description}</p>
                            {lastSync && (
                              <p className="text-xs text-muted-foreground mt-1">Last: {lastSync}</p>
                            )}
                            {result && (
                              <div className="flex items-center gap-1 mt-1">
                                {result.success ? (
                                  <CheckCircle className="h-3 w-3 text-green-500" />
                                ) : (
                                  <XCircle className="h-3 w-3 text-red-500" />
                                )}
                                <span className="text-xs">
                                  {result.created}c / {result.updated}u / {result.skipped}s
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => syncMutation.mutate({ operation: key, dryRun })}
                          disabled={isActive || syncMutation.isPending}
                          data-testid={`button-stackct-sync-${key}`}
                        >
                          {isActive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Project-Level Sync</p>
              </div>
              <ProjectSyncControls
                connection={connection}
                projectMappings={syncHistory?.projectMappings || []}
                dryRun={dryRun}
                syncHistory={syncHistory}
              />
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : syncHistory?.history && syncHistory.history.length > 0 ? (
              <div className="border-t pt-4">
                <button
                  className="flex items-center gap-2 text-sm font-medium w-full text-left"
                  onClick={() => setExpandedLogs(expandedLogs ? null : "all")}
                  data-testid="button-stackct-toggle-history"
                >
                  <Activity className="h-4 w-4" />
                  Sync History
                  {expandedLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {expandedLogs && (
                  <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto">
                    {syncHistory.history.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 text-sm"
                        data-testid={`stackct-history-${idx}`}
                      >
                        <div className="flex items-center gap-2">
                          {item.latestResult?.success ? (
                            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5 text-red-500" />
                          )}
                          <span className="font-medium">
                            {STACKCT_OPERATIONS[item.operation]?.label || item.operation}
                          </span>
                          {item.latestResult && (
                            <span className="text-xs text-muted-foreground">
                              {item.latestResult.created}c / {item.latestResult.updated}u / {item.latestResult.skipped}s
                            </span>
                          )}
                        </div>
                        {item.lastSyncAt && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.lastSyncAt).toLocaleString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
