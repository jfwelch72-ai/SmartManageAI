import { useState } from "react";
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
import {
  useHiringIntegrations, useHiringSyncLogs, useConnectIntegration,
  useDisconnectIntegration, useTestIntegration, useSyncIntegration,
} from "@/lib/hiring-api";
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
  providerName: string;
  apiToken: string;
  subdomain: string;
}

export default function HiringSettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [connectForm, setConnectForm] = useState<ATSConnectForm>({ providerName: "WORKABLE", apiToken: "", subdomain: "" });
  const [showConnect, setShowConnect] = useState(false);
  const [aiScoringEnabled, setAiScoringEnabled] = useState(false);
  const [autoTasksEnabled, setAutoTasksEnabled] = useState(false);
  const [interviewReminders, setInterviewReminders] = useState(true);

  const { data: integrations = [], isLoading: intLoading } = useHiringIntegrations();
  const { data: syncLogs = [], isLoading: logsLoading } = useHiringSyncLogs();

  const connectMutation = useConnectIntegration();
  const disconnectMutation = useDisconnectIntegration();
  const testMutation = useTestIntegration();
  const syncMutation = useSyncIntegration();

  if (user?.role !== "ADMIN") {
    return <Redirect to="/hiring" />;
  }

  const activeIntegration = integrations[0];
  const integrationStatusVariant = (status: string) =>
    status === "connected" ? "default" : "destructive";

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
                  <p className="font-medium">{activeIntegration.providerName}</p>
                  <p className="text-sm text-muted-foreground">
                    {activeIntegration.lastSyncAt
                      ? `Last synced: ${format(new Date(activeIntegration.lastSyncAt), "MMM d, h:mm a")}`
                      : "Never synced"}
                  </p>
                </div>
                <Badge variant={integrationStatusVariant(activeIntegration.status)}>
                  {activeIntegration.status}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testMutation.mutate(activeIntegration.id, {
                    onSuccess: (data: { success: boolean; message: string }) =>
                      toast({ title: data.success ? "Connection OK" : "Connection failed", description: data.message }),
                    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
                  })}
                  disabled={testMutation.isPending}
                  data-testid="button-test-connection"
                >
                  <TestTube2 className="w-4 h-4 mr-1" />
                  {testMutation.isPending ? "Testing..." : "Test Connection"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate(activeIntegration.id, {
                    onSuccess: () => toast({ title: "Sync started" }),
                    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                  })}
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
                  onClick={() => disconnectMutation.mutate(activeIntegration.id, {
                    onSuccess: () => toast({ title: "Disconnected" }),
                    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                  })}
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
                <Select value={connectForm.providerName} onValueChange={(v) => setConnectForm((f) => ({ ...f, providerName: v }))}>
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
              {connectForm.providerName === "WORKABLE" && (
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
                <Button
                  onClick={() => {
                    const credentials: Record<string, string> = { apiToken: connectForm.apiToken };
                    if (connectForm.subdomain) credentials.subdomain = connectForm.subdomain;
                    connectMutation.mutate(
                      { providerName: connectForm.providerName, credentials },
                      {
                        onSuccess: () => {
                          toast({ title: "ATS Integration connected" });
                          setShowConnect(false);
                          setConnectForm({ providerName: "WORKABLE", apiToken: "", subdomain: "" });
                        },
                        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
                      }
                    );
                  }}
                  disabled={connectMutation.isPending || !connectForm.apiToken.trim()}
                  data-testid="button-connect-ats"
                >
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
                    <TableHead>Processed</TableHead>
                    <TableHead>Failed</TableHead>
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
                        <TableCell className="text-sm">{log.recordsProcessed}</TableCell>
                        <TableCell className="text-sm">{log.recordsFailed}</TableCell>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Pipeline Stage Order</CardTitle>
          <CardDescription>Configure the default order of stages in your hiring pipeline. Drag to reorder (future use).</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" data-testid="pipeline-stage-order">
            {[
              "APPLIED", "SCREENING", "PHONE_INTERVIEW", "IN_PERSON_INTERVIEW",
              "SKILLS_ASSESSMENT", "BACKGROUND_CHECK", "REFERENCE_CHECK",
              "OFFER_EXTENDED", "HIRED", "REJECTED", "ARCHIVED",
            ].map((stage, idx) => (
              <li key={stage} className="flex items-center gap-3 p-2 rounded border bg-muted/30" data-testid={`stage-order-${stage}`}>
                <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}</span>
                <span className="text-sm font-medium">
                  {stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
                <Badge variant="outline" className="ml-auto text-xs">Default</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">Drag-to-reorder will be available in a future update.</p>
        </CardContent>
      </Card>
    </div>
  );
}
