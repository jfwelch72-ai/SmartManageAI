import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  FileText,
  TrendingUp,
  AlertTriangle,
  Bell,
  Save,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Send,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PortfolioRendererStatus {
  available: boolean | null;
  error: string | null;
  lastCheckedAt: number | null;
  cachedBrowser?: { present: boolean; connected: boolean; recycling: boolean };
}

interface PortfolioPdfHistoryBucket {
  bucketStart: number;
  bucketEnd: number;
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface PortfolioPdfHistoryWindow {
  rangeMs: number;
  bucketMs: number;
  buckets: PortfolioPdfHistoryBucket[];
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface PortfolioPdfHistory {
  generatedAt: number;
  retentionMs: number;
  retainedSamples: number;
  lastHour: PortfolioPdfHistoryWindow;
  lastDay: PortfolioPdfHistoryWindow;
}

interface PortfolioPdfAlertConfig {
  enabled: boolean;
  evaluationWindowMs: number;
  minSamples: number;
  failureRatePct: number;
  avgDurationMs: number;
  maxDurationMs: number;
  cooldownMs: number;
}

interface PortfolioPdfAlertBreach {
  reason: "FAILURE_RATE" | "AVG_DURATION" | "MAX_DURATION";
  threshold: number;
  observed: number;
  message: string;
}

interface PortfolioPdfAlertWindowSnapshot {
  rangeMs: number;
  total: number;
  failures: number;
  failureRatePct: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface PortfolioPdfAlertEvent {
  triggeredAt: number;
  breaches: PortfolioPdfAlertBreach[];
  window: PortfolioPdfAlertWindowSnapshot;
  config: PortfolioPdfAlertConfig;
}

interface PortfolioPdfAlertState {
  lastEvaluatedAt: number | null;
  lastTriggeredAt: number | null;
  lastBreaches: PortfolioPdfAlertBreach[];
  recentAlerts: PortfolioPdfAlertEvent[];
}

interface PortfolioPdfAlertRecipientView {
  id: string | null;
  email: string;
  notifyInApp: boolean;
  userId: string | null;
}

interface PortfolioPdfRecipientConfig {
  source: "database" | "env" | "super_admins";
  recipients: string[];
  recipientDetails: PortfolioPdfAlertRecipientView[];
  envRecipients: string[];
  rateLimitMs: number;
  unavailableThresholdMs: number;
  lastSent: {
    rendererUnavailable: number | null;
    rendererRecovered: number | null;
    browserDisconnected: number | null;
    failureRate: number | null;
    test: number | null;
  };
}

interface PortfolioPdfAlertRecipientRow {
  id: string;
  email: string;
  notifyInApp: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PortfolioPdfAlertsResponse {
  config: PortfolioPdfAlertConfig;
  state: PortfolioPdfAlertState;
  recipients: PortfolioPdfRecipientConfig;
}

interface PortfolioPdfAlertDeliveryRow {
  id: string;
  kind: string;
  recipients: string[];
  recipientCount: number;
  emailSuccess: boolean;
  errorMessage: string | null;
  triggeredBy: string | null;
  createdAt: string;
}

const HEALTH_KEY = ["/api/admin/portfolio-pdf/health"] as const;
const HISTORY_KEY = ["/api/admin/portfolio-pdf/history"] as const;
const ALERTS_KEY = ["/api/admin/portfolio-pdf/alerts"] as const;
const RECIPIENTS_KEY = ["/api/admin/portfolio-pdf/alert-recipients"] as const;
const DELIVERIES_KEY = ["/api/admin/portfolio-pdf/alert-deliveries"] as const;

function formatTimestamp(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function formatRelative(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBucketLabel(ts: number, bucketMs: number): string {
  const d = new Date(ts);
  if (bucketMs >= 60 * 60 * 1000) {
    return `${d.getHours().toString().padStart(2, "0")}:00`;
  }
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function reasonLabel(reason: PortfolioPdfAlertBreach["reason"]): string {
  if (reason === "FAILURE_RATE") return "Failure rate";
  if (reason === "AVG_DURATION") return "Avg duration";
  return "Max duration";
}

function alertKindLabel(kind: string): string {
  switch (kind) {
    case "renderer_unavailable":
      return "Renderer unavailable";
    case "renderer_recovered":
      return "Renderer recovered";
    case "browser_disconnected":
      return "Browser disconnected";
    case "failure_rate":
      return "Failure rate";
    case "test_alert":
      return "Test alert";
    default:
      return kind;
  }
}

export default function PortfolioPdfHealth() {
  const { toast } = useToast();
  const [historyRange, setHistoryRange] = useState<"hour" | "day">("hour");

  const { data: status, isLoading, isError, refetch, isFetching } = useQuery<PortfolioRendererStatus>({
    queryKey: HEALTH_KEY,
    refetchInterval: 30_000,
  });

  const { data: history, isLoading: historyLoading } = useQuery<PortfolioPdfHistory>({
    queryKey: HISTORY_KEY,
    refetchInterval: 30_000,
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery<PortfolioPdfAlertsResponse>({
    queryKey: ALERTS_KEY,
    refetchInterval: 30_000,
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/portfolio-pdf/health?check=true");
      return (await res.json()) as PortfolioRendererStatus;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(HEALTH_KEY, result);
      queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
      toast({
        title: result.available ? "Renderer is available" : "Renderer is unavailable",
        description: result.available ? "Chromium launched successfully." : result.error ?? "Unknown error",
        variant: result.available ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Health check failed", description: err.message, variant: "destructive" });
    },
  });

  const [alertForm, setAlertForm] = useState<PortfolioPdfAlertConfig | null>(null);
  useEffect(() => {
    if (alerts?.config && !alertForm) setAlertForm(alerts.config);
  }, [alerts?.config, alertForm]);

  const updateAlertsMutation = useMutation({
    mutationFn: async (cfg: PortfolioPdfAlertConfig) => {
      const res = await apiRequest("PUT", "/api/admin/portfolio-pdf/alerts", cfg);
      return res.json() as Promise<PortfolioPdfAlertsResponse>;
    },
    onSuccess: (result) => {
      setAlertForm(result.config);
      queryClient.setQueryData(ALERTS_KEY, result);
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
      toast({ title: "Alert settings saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save alert settings", description: err.message, variant: "destructive" });
    },
  });

  const evaluateAlertsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/portfolio-pdf/alerts/evaluate");
      return res.json() as Promise<{ triggered: boolean; state: PortfolioPdfAlertState }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
      toast({
        title: result.triggered ? "Alert triggered" : "No thresholds breached",
        description: result.triggered
          ? "Recipients were notified by email and in-app notification."
          : "Current metrics are within configured thresholds.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Evaluate failed", description: err.message, variant: "destructive" });
    },
  });

  const available = status?.available ?? null;
  const cb = status?.cachedBrowser;

  const statusBadge = (() => {
    if (available === true) {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-600" data-testid="badge-portfolio-pdf-status">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Available
        </Badge>
      );
    }
    if (available === false) {
      return (
        <Badge variant="destructive" data-testid="badge-portfolio-pdf-status">
          <XCircle className="h-3 w-3 mr-1" /> Unavailable
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" data-testid="badge-portfolio-pdf-status">
        <HelpCircle className="h-3 w-3 mr-1" /> Unknown
      </Badge>
    );
  })();

  const browserBadge = (() => {
    if (!cb) return null;
    if (!cb.present) return <Badge variant="outline" data-testid="badge-browser-status">No cached browser</Badge>;
    if (cb.recycling) return <Badge variant="secondary" data-testid="badge-browser-status">Recycling</Badge>;
    if (!cb.connected) return <Badge variant="destructive" data-testid="badge-browser-status">Disconnected</Badge>;
    return <Badge data-testid="badge-browser-status">Connected</Badge>;
  })();

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="button-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">
              Portfolio PDF renderer health
            </h1>
            <p className="text-sm text-muted-foreground">
              Availability of the headless Chromium pool used for portfolio summary PDFs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
            data-testid="button-run-check"
          >
            {checkMutation.isPending ? "Checking…" : "Run availability check"}
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to load renderer status</AlertTitle>
          <AlertDescription>You may not have SUPER_ADMIN permission.</AlertDescription>
        </Alert>
      )}

      {alerts && alerts.config.enabled && alerts.state.lastBreaches.length > 0 && (
        <Alert variant="destructive" data-testid="alert-thresholds-breached">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Portfolio PDF thresholds breached</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              {alerts.state.lastBreaches.map((b) => (
                <li key={b.reason} data-testid={`text-current-breach-${b.reason}`}>
                  {b.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" /> Renderer status
              </CardTitle>
              <CardDescription>Chromium availability and cached-browser pool state.</CardDescription>
            </div>
            {isLoading ? <Skeleton className="h-6 w-24" /> : statusBadge}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Last checked</div>
              {isLoading ? (
                <Skeleton className="h-4 w-40 mt-1" />
              ) : (
                <div data-testid="text-last-checked">
                  {formatTimestamp(status?.lastCheckedAt ?? null)}
                  {status?.lastCheckedAt && (
                    <span className="text-muted-foreground ml-2">({formatRelative(status.lastCheckedAt)})</span>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground">Cached availability</div>
              {isLoading ? (
                <Skeleton className="h-4 w-32 mt-1" />
              ) : (
                <div data-testid="text-cached-availability">
                  {available === true
                    ? "Available"
                    : available === false
                      ? "Unavailable"
                      : "Unknown — no probe yet"}
                </div>
              )}
            </div>
            <div>
              <div className="text-muted-foreground">Cached browser</div>
              {isLoading ? <Skeleton className="h-4 w-32 mt-1" /> : <div>{browserBadge ?? "—"}</div>}
            </div>
          </div>

          {available === false && status?.error && (
            <Alert variant="destructive" data-testid="alert-last-error">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Last availability error</AlertTitle>
              <AlertDescription className="font-mono text-xs whitespace-pre-wrap break-all">
                {status.error}
              </AlertDescription>
            </Alert>
          )}

          {available === null && !isLoading && (
            <Alert>
              <HelpCircle className="h-4 w-4" />
              <AlertTitle>No availability data yet</AlertTitle>
              <AlertDescription>
                The renderer has not been probed since the server started. Run an availability check to populate the
                status.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-xs text-muted-foreground">
            Negative results are not cached: the next portfolio PDF request will retry the launch automatically.
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-history">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Render history
              </CardTitle>
              <CardDescription>
                Rolling render counts, durations, and failures. Samples older than{" "}
                {history ? formatDuration(history.retentionMs) : "24h"} are pruned automatically.
              </CardDescription>
            </div>
            <Tabs value={historyRange} onValueChange={(v) => setHistoryRange(v as "hour" | "day")}>
              <TabsList>
                <TabsTrigger value="hour" data-testid="tab-history-hour">Last hour</TabsTrigger>
                <TabsTrigger value="day" data-testid="tab-history-day">Last 24h</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          {historyLoading || !history ? (
            <Skeleton className="h-64 w-full" />
          ) : (() => {
            const win = historyRange === "hour" ? history.lastHour : history.lastDay;
            const chartData = win.buckets.map((b) => ({
              label: formatBucketLabel(b.bucketStart, win.bucketMs),
              total: b.total,
              failures: b.failures,
              avgMs: b.avgDurationMs ?? 0,
            }));
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Total renders</div>
                    <div className="font-medium" data-testid="text-history-total">{win.total}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Failures</div>
                    <div className="font-medium" data-testid="text-history-failures">{win.failures}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Avg duration</div>
                    <div className="font-medium" data-testid="text-history-avg">{formatDuration(win.avgDurationMs)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Max duration</div>
                    <div className="font-medium" data-testid="text-history-max">{formatDuration(win.maxDurationMs)}</div>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Legend />
                      <Bar yAxisId="left" dataKey="total" fill="#3b82f6" name="Renders" />
                      <Bar yAxisId="left" dataKey="failures" fill="#ef4444" name="Failures" />
                      <Line yAxisId="right" type="monotone" dataKey="avgMs" stroke="#10b981" name="Avg ms" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card data-testid="card-alerts">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-4 w-4" /> Failure-rate alerts
              </CardTitle>
              <CardDescription>
                Thresholds that trigger an email + in-app alert when portfolio PDF renders cross them.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => evaluateAlertsMutation.mutate()}
              disabled={evaluateAlertsMutation.isPending}
              data-testid="button-evaluate-alerts"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${evaluateAlertsMutation.isPending ? "animate-spin" : ""}`} />
              Evaluate now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alertsLoading || !alertForm ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="alerts-enabled"
                  checked={alertForm.enabled}
                  onCheckedChange={(v) => setAlertForm({ ...alertForm, enabled: v })}
                  data-testid="switch-alerts-enabled"
                />
                <Label htmlFor="alerts-enabled">Enable alerts</Label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="alert-window">Evaluation window (minutes)</Label>
                  <Input
                    id="alert-window"
                    type="number"
                    min={1}
                    max={1440}
                    value={Math.round(alertForm.evaluationWindowMs / 60000)}
                    onChange={(e) =>
                      setAlertForm({ ...alertForm, evaluationWindowMs: Math.max(1, Number(e.target.value || 0)) * 60000 })
                    }
                    data-testid="input-alert-window-min"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="alert-min-samples">Minimum samples</Label>
                  <Input
                    id="alert-min-samples"
                    type="number"
                    min={1}
                    max={1000}
                    value={alertForm.minSamples}
                    onChange={(e) => setAlertForm({ ...alertForm, minSamples: Math.max(1, Number(e.target.value || 0)) })}
                    data-testid="input-alert-min-samples"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="alert-failure-rate">Failure rate threshold (%)</Label>
                  <Input
                    id="alert-failure-rate"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={alertForm.failureRatePct}
                    onChange={(e) =>
                      setAlertForm({
                        ...alertForm,
                        failureRatePct: Math.min(100, Math.max(0, Number(e.target.value || 0))),
                      })
                    }
                    data-testid="input-alert-failure-rate"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="alert-cooldown">Cooldown between alerts (minutes)</Label>
                  <Input
                    id="alert-cooldown"
                    type="number"
                    min={0}
                    max={1440}
                    value={Math.round(alertForm.cooldownMs / 60000)}
                    onChange={(e) =>
                      setAlertForm({ ...alertForm, cooldownMs: Math.max(0, Number(e.target.value || 0)) * 60000 })
                    }
                    data-testid="input-alert-cooldown-min"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="alert-avg-duration">Avg duration threshold (seconds, 0 = off)</Label>
                  <Input
                    id="alert-avg-duration"
                    type="number"
                    min={0}
                    max={600}
                    value={Math.round(alertForm.avgDurationMs / 1000)}
                    onChange={(e) =>
                      setAlertForm({ ...alertForm, avgDurationMs: Math.max(0, Number(e.target.value || 0)) * 1000 })
                    }
                    data-testid="input-alert-avg-duration-sec"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="alert-max-duration">Max duration threshold (seconds, 0 = off)</Label>
                  <Input
                    id="alert-max-duration"
                    type="number"
                    min={0}
                    max={1800}
                    value={Math.round(alertForm.maxDurationMs / 1000)}
                    onChange={(e) =>
                      setAlertForm({ ...alertForm, maxDurationMs: Math.max(0, Number(e.target.value || 0)) * 1000 })
                    }
                    data-testid="input-alert-max-duration-sec"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => updateAlertsMutation.mutate(alertForm)}
                  disabled={updateAlertsMutation.isPending}
                  data-testid="button-save-alerts"
                >
                  <Save className={`h-4 w-4 mr-1 ${updateAlertsMutation.isPending ? "animate-spin" : ""}`} />
                  Save thresholds
                </Button>
                {alerts && (
                  <span className="text-xs text-muted-foreground" data-testid="text-alerts-last-evaluated">
                    Last evaluated: {formatTimestamp(alerts.state.lastEvaluatedAt)} · Last alert:{" "}
                    {formatTimestamp(alerts.state.lastTriggeredAt)}
                  </span>
                )}
              </div>
              {alerts && alerts.state.recentAlerts.length > 0 && (
                <div className="border-t pt-3">
                  <div className="text-sm font-medium mb-2">Recent alerts</div>
                  <ul className="space-y-2 max-h-64 overflow-y-auto pr-1" data-testid="list-recent-alerts">
                    {alerts.state.recentAlerts.map((a, idx) => (
                      <li
                        key={`${a.triggeredAt}-${idx}`}
                        className="text-xs border rounded p-2 bg-muted/30"
                        data-testid={`item-alert-${a.triggeredAt}`}
                      >
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-medium">{formatTimestamp(a.triggeredAt)}</span>
                          <div className="flex gap-1 flex-wrap">
                            {a.breaches.map((b) => (
                              <Badge key={b.reason} variant="destructive" className="text-[10px]">
                                {reasonLabel(b.reason)}: {b.observed}
                                {b.reason === "FAILURE_RATE" ? "%" : "ms"}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {a.window.total} renders / {a.window.failures} failures
                          {a.window.avgDurationMs !== null ? ` · avg ${formatDuration(a.window.avgDurationMs)}` : ""}
                          {a.window.maxDurationMs !== null ? ` · max ${formatDuration(a.window.maxDurationMs)}` : ""}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertRecipientsCard alertConfig={alerts?.recipients} alertsLoading={alertsLoading} />
    </div>
  );
}

function AlertRecipientsCard({
  alertConfig,
  alertsLoading,
}: {
  alertConfig: PortfolioPdfRecipientConfig | undefined;
  alertsLoading: boolean;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{
    recipients: PortfolioPdfAlertRecipientRow[];
    config: PortfolioPdfRecipientConfig;
  }>({
    queryKey: RECIPIENTS_KEY,
    refetchInterval: 30_000,
  });
  const recipients = data?.recipients ?? [];
  const cfg = data?.config ?? alertConfig;

  const [newEmail, setNewEmail] = useState("");
  const [newNotifyInApp, setNewNotifyInApp] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");

  const [filterKind, setFilterKind] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSinceMs, setFilterSinceMs] = useState<string>("all");

  const deliveriesQueryParams = (() => {
    const params = new URLSearchParams();
    params.set("limit", "100");
    if (filterKind !== "all") params.set("kind", filterKind);
    if (filterStatus !== "all") params.set("success", filterStatus);
    if (filterSinceMs !== "all") params.set("sinceMs", filterSinceMs);
    return params.toString();
  })();
  const deliveriesUrl = `/api/admin/portfolio-pdf/alert-deliveries?${deliveriesQueryParams}`;
  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery<{
    deliveries: PortfolioPdfAlertDeliveryRow[];
    retentionMs?: number;
  }>({
    queryKey: [...DELIVERIES_KEY, filterKind, filterStatus, filterSinceMs],
    queryFn: async () => {
      const res = await apiRequest("GET", deliveriesUrl);
      return res.json();
    },
    refetchInterval: 30_000,
  });
  const deliveries = deliveriesData?.deliveries ?? [];
  const retentionMs = deliveriesData?.retentionMs ?? null;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: RECIPIENTS_KEY });
    queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    queryClient.invalidateQueries({ queryKey: DELIVERIES_KEY });
  };

  const addMutation = useMutation({
    mutationFn: async (input: { email: string; notifyInApp: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/portfolio-pdf/alert-recipients", input);
      return res.json();
    },
    onSuccess: () => {
      setNewEmail("");
      setNewNotifyInApp(true);
      invalidateAll();
      toast({ title: "Recipient added" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add recipient", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { email?: string; notifyInApp?: boolean } }) => {
      const res = await apiRequest("PATCH", `/api/admin/portfolio-pdf/alert-recipients/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      setEditEmail("");
      invalidateAll();
      toast({ title: "Recipient updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update recipient", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/portfolio-pdf/alert-recipients/${id}`);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Recipient removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove recipient", description: err.message, variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/portfolio-pdf/alert-recipients/test");
      return res.json() as Promise<{ ok: boolean; recipientCount: number; recipients: string[]; sentAt: number }>;
    },
    onSuccess: (result) => {
      invalidateAll();
      toast({
        title: "Test alert sent",
        description: `Delivered to ${result.recipientCount} recipient${result.recipientCount === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send test alert", description: err.message, variant: "destructive" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async (olderThanMs: number | null) => {
      const url =
        olderThanMs && olderThanMs > 0
          ? `/api/admin/portfolio-pdf/alert-deliveries?olderThanMs=${olderThanMs}`
          : `/api/admin/portfolio-pdf/alert-deliveries`;
      const res = await apiRequest("DELETE", url);
      return res.json() as Promise<{ ok: boolean; removed: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: DELIVERIES_KEY });
      toast({
        title: "Cleared delivery records",
        description: `Removed ${result.removed} record${result.removed === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to clear delivery records", description: err.message, variant: "destructive" });
    },
  });

  const sourceBadge = (() => {
    if (!cfg) return null;
    if (cfg.source === "database") return <Badge data-testid="badge-alert-source">Configured recipients</Badge>;
    if (cfg.source === "env")
      return (
        <Badge variant="secondary" data-testid="badge-alert-source">
          PORTFOLIO_PDF_ALERT_EMAILS env var
        </Badge>
      );
    return (
      <Badge variant="outline" data-testid="badge-alert-source">
        Active super admins (fallback)
      </Badge>
    );
  })();

  return (
    <Card data-testid="card-alert-recipients">
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4" /> Alert recipients
            </CardTitle>
            <CardDescription>
              Renderer-unavailable, browser-disconnect, and failure-rate alerts go to these emails. If none are
              configured, the system falls back to <code>PORTFOLIO_PDF_ALERT_EMAILS</code>, then to all active super
              admins. Repeat alerts of the same kind are throttled to once per{" "}
              {cfg ? formatDuration(cfg.rateLimitMs) : "30m"}.
              {" "}
              <span className="text-muted-foreground">
                Recipients are stored in a single shared list — entries added or
                updated here may also appear on the Gantt PDF health page.
              </span>
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !cfg || cfg.recipients.length === 0}
            data-testid="button-send-test-alert"
          >
            <Send className={`h-4 w-4 mr-1 ${testMutation.isPending ? "animate-pulse" : ""}`} />
            Send test alert
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {alertsLoading || isLoading || !cfg ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Active source:</span>
              {sourceBadge}
              <span className="text-muted-foreground">·</span>
              <span data-testid="text-alert-recipient-count">
                {cfg.recipients.length} recipient{cfg.recipients.length === 1 ? "" : "s"}
              </span>
            </div>

            {cfg.recipients.length === 0 && (
              <Alert variant="destructive" data-testid="alert-no-recipients">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No recipients configured</AlertTitle>
                <AlertDescription>
                  Add at least one recipient below, set the <code>PORTFOLIO_PDF_ALERT_EMAILS</code> environment
                  variable, or ensure an active super admin exists so alerts can be delivered.
                </AlertDescription>
              </Alert>
            )}

            {recipients.length === 0 ? (
              <div className="text-xs text-muted-foreground" data-testid="text-no-db-recipients">
                No saved recipients yet — using the fallback shown above.
              </div>
            ) : (
              <ul className="divide-y border rounded" data-testid="list-alert-recipients">
                {recipients.map((r) => {
                  const isEditing = editingId === r.id;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 px-2 py-2 flex-wrap"
                      data-testid={`row-recipient-${r.id}`}
                    >
                      {isEditing ? (
                        <Input
                          type="email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          className="max-w-xs h-8"
                          data-testid={`input-edit-email-${r.id}`}
                        />
                      ) : (
                        <span
                          className="font-mono text-xs sm:text-sm flex-1 break-all"
                          data-testid={`text-recipient-email-${r.id}`}
                        >
                          {r.email}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`notify-in-app-${r.id}`}
                          checked={r.notifyInApp}
                          disabled={updateMutation.isPending}
                          onCheckedChange={(v) => updateMutation.mutate({ id: r.id, patch: { notifyInApp: v } })}
                          data-testid={`switch-notify-in-app-${r.id}`}
                        />
                        <Label htmlFor={`notify-in-app-${r.id}`} className="text-xs">
                          In-app
                        </Label>
                        {r.userId ? (
                          <Badge variant="outline" className="text-[10px]" data-testid={`badge-linked-user-${r.id}`}>
                            Linked user
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]" data-testid={`badge-no-user-${r.id}`}>
                            Email only
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-auto">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => updateMutation.mutate({ id: r.id, patch: { email: editEmail } })}
                              disabled={updateMutation.isPending || !editEmail.trim()}
                              data-testid={`button-save-edit-${r.id}`}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(null);
                                setEditEmail("");
                              }}
                              data-testid={`button-cancel-edit-${r.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(r.id);
                                setEditEmail(r.email);
                              }}
                              data-testid={`button-edit-recipient-${r.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(r.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-recipient-${r.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-end gap-2 flex-wrap pt-2 border-t">
              <div className="flex-1 min-w-[200px] space-y-1">
                <Label htmlFor="new-recipient-email" className="text-xs">
                  Add recipient
                </Label>
                <Input
                  id="new-recipient-email"
                  type="email"
                  placeholder="alerts@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  data-testid="input-new-recipient-email"
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="new-notify-in-app"
                  checked={newNotifyInApp}
                  onCheckedChange={setNewNotifyInApp}
                  data-testid="switch-new-notify-in-app"
                />
                <Label htmlFor="new-notify-in-app" className="text-xs">
                  In-app
                </Label>
              </div>
              <Button
                size="sm"
                onClick={() => addMutation.mutate({ email: newEmail.trim(), notifyInApp: newNotifyInApp })}
                disabled={addMutation.isPending || !newEmail.trim()}
                data-testid="button-add-recipient"
              >
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="font-medium">Recent deliveries</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={filterKind} onValueChange={setFilterKind}>
                    <SelectTrigger className="w-[180px] h-8 text-xs" data-testid="select-filter-kind">
                      <SelectValue placeholder="All kinds" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All kinds</SelectItem>
                      <SelectItem value="renderer_unavailable">Renderer unavailable</SelectItem>
                      <SelectItem value="renderer_recovered">Renderer recovered</SelectItem>
                      <SelectItem value="browser_disconnected">Browser disconnected</SelectItem>
                      <SelectItem value="failure_rate">Failure rate</SelectItem>
                      <SelectItem value="test_alert">Test alert</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-filter-status">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="true">Email sent</SelectItem>
                      <SelectItem value="false">Email failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filterSinceMs} onValueChange={setFilterSinceMs}>
                    <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-filter-since">
                      <SelectValue placeholder="All time" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="3600000">Last hour</SelectItem>
                      <SelectItem value="86400000">Last 24h</SelectItem>
                      <SelectItem value="604800000">Last 7 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => clearMutation.mutate(604800000)}
                    disabled={clearMutation.isPending}
                    data-testid="button-clear-old-deliveries"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear &gt;7d
                  </Button>
                </div>
              </div>
              {retentionMs && (
                <div className="text-xs text-muted-foreground mb-2">
                  Records older than {formatDuration(retentionMs)} are pruned automatically.
                </div>
              )}
              {deliveriesLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : deliveries.length === 0 ? (
                <div className="text-xs text-muted-foreground" data-testid="text-no-deliveries">
                  No deliveries match the current filters.
                </div>
              ) : (
                <ul className="space-y-1.5 max-h-72 overflow-y-auto" data-testid="list-alert-deliveries">
                  {deliveries.map((d) => (
                    <li
                      key={d.id}
                      className="text-xs border rounded px-2 py-1.5 flex items-start gap-2 flex-wrap"
                      data-testid={`row-delivery-${d.id}`}
                    >
                      <Badge
                        variant={d.emailSuccess ? "default" : "destructive"}
                        className="text-[10px]"
                        data-testid={`badge-delivery-status-${d.id}`}
                      >
                        {d.emailSuccess ? "Sent" : "Failed"}
                      </Badge>
                      <span className="font-medium">{alertKindLabel(d.kind)}</span>
                      <span className="text-muted-foreground">{new Date(d.createdAt).toLocaleString()}</span>
                      <span className="text-muted-foreground">
                        → {d.recipientCount} recipient{d.recipientCount === 1 ? "" : "s"}
                      </span>
                      {d.triggeredBy && (
                        <span className="text-muted-foreground">by {d.triggeredBy}</span>
                      )}
                      {d.errorMessage && (
                        <span className="text-destructive font-mono break-all w-full">{d.errorMessage}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
