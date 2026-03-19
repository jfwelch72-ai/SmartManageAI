import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Link2, RefreshCw, TestTube2, ShieldOff, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import type { HiringIntegration, HiringSyncLog } from "@/types/hiring";
import { format } from "date-fns";
import { Redirect } from "wouter";

const SYNC_STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDING: { label: "Pending", icon: Clock },
  RUNNING: { label: "Running", icon: RefreshCw },
  SUCCESS: { label: "Success", icon: CheckCircle2 },
  FAILED: { label: "Failed", icon: AlertCircle },
  PARTIAL: { label: "Partial", icon: AlertCircle },
};

interface ATSConnectForm {
  provider: string;
  apiToken: string;
  subdomain: string;
}

export default function HiringSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [connectForm, setConnectForm] = useState<ATSConnectForm>({ provider: "WORKABLE", apiToken: "", subdomain: "" });
  const [showConnect, setShowConnect] = useState(false);
  const [aiScoringEnabled, setAiScoringEnabled] = useState(false);
  const [autoTasksEnabled, setAutoTasksEnabled] = useState(false);
  const [interviewReminders, setInterviewReminders] = useState(true);

  if (user?.role !== "ADMIN") {
    return <Redirect to="/hiring" />;
  }

  const { data: integrations = [], isLoading: intLoading } = useQuery<HiringIntegration[]>({
    queryKey: ["/api/hiring/integrations"],
  });

  const { data: syncLogs = [], isLoading: logsLoading } = useQuery<HiringSyncLog[]>({
    queryKey: ["/api/hiring/sync-logs"],
  });

  const connectMutation = useMutation({
    mutationFn: async (data: ATSConnectForm) => {
      const res = await apiRequest("POST", "/api/hiring/integrations", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
      toast({ title: "ATS Integration connected" });
      setShowConnect(false);
      setConnectForm({ provider: "WORKABLE", apiToken: "", subdomain: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/hiring/integrations/${id}`, undefined);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
      toast({ title: "Disconnected" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/integrations/${id}/test`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.success ? "Connection OK" : "Connection failed", description: data.message });
    },
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/hiring/integrations/${id}/sync`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hiring/integrations/sync-logs"] });
      toast({ title: "Sync started" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const activeIntegration = integrations[0];

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-hiring-settings">Hiring Settings</h1>
        <p className="text-muted-foreground">Configure ATS integrations, AI features, and pipeline defaults</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="w-4 h-4" />ATS Integration
          </CardTitle>
          <CardDescription>Connect an external ATS to sync jobs and candidates automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {intLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : activeIntegration ? (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{activeIntegration.provider}</p>
                  <p className="text-sm text-muted-foreground">
                    {activeIntegration.lastSyncedAt
                      ? `Last synced: ${format(new Date(activeIntegration.lastSyncedAt), "MMM d, h:mm a")}`
                      : "Never synced"}
                  </p>
                </div>
                <Badge variant={activeIntegration.status === "CONNECTED" ? "default" : "destructive"}>
                  {activeIntegration.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testMutation.mutate(activeIntegration.id)}
                  disabled={testMutation.isPending}
                  data-testid="button-test-connection"
                >
                  <TestTube2 className="w-4 h-4 mr-1" />
                  {testMutation.isPending ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate(activeIntegration.id)}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-now"
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                  {syncMutation.isPending ? "Syncing..." : "Sync Now"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => disconnectMutation.mutate(activeIntegration.id)}
                  disabled={disconnectMutation.isPending}
                  data-testid="button-disconnect-ats"
                >
                  <ShieldOff className="w-4 h-4 mr-1" />Disconnect
                </Button>
              </div>
            </div>
          ) : showConnect ? (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="space-y-1">
                <Label>Provider</Label>
                <Select value={connectForm.provider} onValueChange={(v) => setConnectForm((f) => ({ ...f, provider: v }))}>
                  <SelectTrigger data-testid="select-ats-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WORKABLE">Workable</SelectItem>
                    <SelectItem value="GREENHOUSE">Greenhouse</SelectItem>
                    <SelectItem value="LEVER">Lever</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>API Token</Label>
                <Input
                  type="password"
                  placeholder="Your ATS API token"
                  value={connectForm.apiToken}
                  onChange={(e) => setConnectForm((f) => ({ ...f, apiToken: e.target.value }))}
                  data-testid="input-ats-token"
                />
              </div>
              {connectForm.provider === "WORKABLE" && (
                <div className="space-y-1">
                  <Label>Subdomain</Label>
                  <Input
                    placeholder="your-company"
                    value={connectForm.subdomain}
                    onChange={(e) => setConnectForm((f) => ({ ...f, subdomain: e.target.value }))}
                    data-testid="input-ats-subdomain"
                  />
                  <p className="text-xs text-muted-foreground">Your Workable subdomain (e.g. acme if your URL is acme.workable.com)</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={() => connectMutation.mutate(connectForm)} disabled={connectMutation.isPending || !connectForm.apiToken.trim()} data-testid="button-connect-ats">
                  {connectMutation.isPending ? "Connecting..." : "Connect"}
                </Button>
                <Button variant="outline" onClick={() => setShowConnect(false)} data-testid="button-cancel-connect">Cancel</Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setShowConnect(true)} data-testid="button-add-ats">
              <Link2 className="w-4 h-4 mr-1" />Connect ATS
            </Button>
          )}
        </CardContent>
      </Card>

      {(activeIntegration || syncLogs.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {logsLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : syncLogs.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No sync runs yet</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Jobs</TableHead>
                    <TableHead>Candidates</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLogs.slice(0, 10).map((log) => {
                    const cfg = SYNC_STATUS_CONFIG[log.status] ?? SYNC_STATUS_CONFIG.PENDING;
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={log.id} data-testid={`row-sync-log-${log.id}`}>
                        <TableCell>
                          <span className="flex items-center gap-1 text-sm">
                            <Icon className="w-4 h-4" />
                            {cfg.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">{log.jobsSynced ?? "—"}</TableCell>
                        <TableCell className="text-sm">{log.candidatesSynced ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {format(new Date(log.startedAt), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.completedAt ? format(new Date(log.completedAt), "h:mm a") : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature Toggles</CardTitle>
          <CardDescription>Control AI-powered and automation features for hiring.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">AI Candidate Scoring</p>
              <p className="text-xs text-muted-foreground">Automatically score candidates with AI (requires OpenAI)</p>
            </div>
            <Switch checked={aiScoringEnabled} onCheckedChange={setAiScoringEnabled} data-testid="toggle-ai-scoring" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Auto-Create Hiring Tasks</p>
              <p className="text-xs text-muted-foreground">Automatically create tasks when candidates advance stages</p>
            </div>
            <Switch checked={autoTasksEnabled} onCheckedChange={setAutoTasksEnabled} data-testid="toggle-auto-tasks" />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Interview Reminders</p>
              <p className="text-xs text-muted-foreground">Send reminders to interviewers before scheduled interviews</p>
            </div>
            <Switch checked={interviewReminders} onCheckedChange={setInterviewReminders} data-testid="toggle-interview-reminders" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
