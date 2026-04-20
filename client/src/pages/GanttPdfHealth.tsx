import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, RotateCcw, Activity, Clock, FileText, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Bell, BellOff, Save } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface GanttPdfStats {
  cachedBrowser: {
    present: boolean;
    connected: boolean;
    recycling: boolean;
    ageMs: number | null;
    pdfCount: number;
    inFlight: number;
  };
  limits: {
    maxPdfsPerBrowser: number;
    maxBrowserAgeMs: number;
    maxConcurrentRenders: number;
    maxQueueLength: number;
    queueWaitTimeoutMs: number;
  };
  queue: {
    activeRenders: number;
    queuedRenders: number;
  };
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const HEALTH_KEY = ["/api/admin/gantt-pdf/health"] as const;
const HISTORY_KEY = ["/api/admin/gantt-pdf/history"] as const;
const ALERTS_KEY = ["/api/admin/gantt-pdf/alerts"] as const;

interface GanttPdfAlertConfig {
  enabled: boolean;
  evaluationWindowMs: number;
  minSamples: number;
  failureRatePct: number;
  avgDurationMs: number;
  maxDurationMs: number;
  cooldownMs: number;
}

interface GanttPdfAlertBreach {
  reason: "FAILURE_RATE" | "AVG_DURATION" | "MAX_DURATION";
  threshold: number;
  observed: number;
  message: string;
}

interface GanttPdfAlertWindowSnapshot {
  rangeMs: number;
  total: number;
  failures: number;
  failureRatePct: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface GanttPdfAlertEvent {
  triggeredAt: number;
  breaches: GanttPdfAlertBreach[];
  window: GanttPdfAlertWindowSnapshot;
  config: GanttPdfAlertConfig;
}

interface GanttPdfAlertState {
  lastEvaluatedAt: number | null;
  lastTriggeredAt: number | null;
  lastBreaches: GanttPdfAlertBreach[];
  recentAlerts: GanttPdfAlertEvent[];
}

interface GanttPdfAlertsResponse {
  config: GanttPdfAlertConfig;
  state: GanttPdfAlertState;
}

function reasonLabel(reason: GanttPdfAlertBreach["reason"]): string {
  if (reason === "FAILURE_RATE") return "Failure rate";
  if (reason === "AVG_DURATION") return "Avg duration";
  return "Max duration";
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  return d.toLocaleString();
}

interface GanttPdfHistoryBucket {
  bucketStart: number;
  bucketEnd: number;
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface GanttPdfHistoryWindow {
  rangeMs: number;
  bucketMs: number;
  buckets: GanttPdfHistoryBucket[];
  total: number;
  failures: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
}

interface GanttPdfHistory {
  generatedAt: number;
  retentionMs: number;
  retainedSamples: number;
  lastHour: GanttPdfHistoryWindow;
  lastDay: GanttPdfHistoryWindow;
}

function formatBucketLabel(ts: number, bucketMs: number): string {
  const d = new Date(ts);
  if (bucketMs >= 60 * 60 * 1000) {
    const h = d.getHours().toString().padStart(2, "0");
    return `${h}:00`;
  }
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export default function GanttPdfHealth() {
  const { toast } = useToast();
  const [historyRange, setHistoryRange] = useState<"hour" | "day">("hour");
  const { data, isLoading, isError, refetch, isFetching } = useQuery<GanttPdfStats>({
    queryKey: HEALTH_KEY,
    refetchInterval: 5000,
  });
  const { data: history, isLoading: historyLoading } = useQuery<GanttPdfHistory>({
    queryKey: HISTORY_KEY,
    refetchInterval: 15000,
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery<GanttPdfAlertsResponse>({
    queryKey: ALERTS_KEY,
    refetchInterval: 15000,
  });

  const [alertForm, setAlertForm] = useState<GanttPdfAlertConfig | null>(null);
  useEffect(() => {
    if (alerts?.config && !alertForm) {
      setAlertForm(alerts.config);
    }
  }, [alerts?.config, alertForm]);

  const updateAlertsMutation = useMutation({
    mutationFn: async (cfg: GanttPdfAlertConfig) => {
      const res = await apiRequest("PUT", "/api/admin/gantt-pdf/alerts", cfg);
      return res.json() as Promise<GanttPdfAlertsResponse>;
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
      const res = await apiRequest("POST", "/api/admin/gantt-pdf/alerts/evaluate");
      return res.json() as Promise<{ triggered: boolean; state: GanttPdfAlertState }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
      toast({
        title: result.triggered ? "Alert triggered" : "No thresholds breached",
        description: result.triggered
          ? "Admins were notified by email and in-app notification."
          : "Current metrics are within configured thresholds.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Evaluate failed", description: err.message, variant: "destructive" });
    },
  });

  const recycleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/gantt-pdf/recycle");
      return res.json();
    },
    onSuccess: (result: { recycled: boolean }) => {
      toast({
        title: result.recycled ? "Recycle requested" : "No active browser",
        description: result.recycled
          ? "The cached Chromium will retire after in-flight renders finish."
          : "There is no cached browser to recycle right now.",
      });
      queryClient.invalidateQueries({ queryKey: HEALTH_KEY });
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
    onError: (err: Error) => {
      toast({
        title: "Recycle failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const queueDepth = data?.queue.queuedRenders ?? 0;
  const queueMax = data?.limits.maxQueueLength ?? 0;
  const queueBackedUp = queueMax > 0 && queueDepth >= Math.max(1, Math.floor(queueMax * 0.75));

  const cb = data?.cachedBrowser;
  const browserStatusBadge = (() => {
    if (!cb) return null;
    if (!cb.present) return <Badge variant="outline" data-testid="badge-browser-status">No cached browser</Badge>;
    if (cb.recycling) return <Badge variant="secondary" data-testid="badge-browser-status">Recycling</Badge>;
    if (!cb.connected) return <Badge variant="destructive" data-testid="badge-browser-status">Disconnected</Badge>;
    return <Badge data-testid="badge-browser-status">Connected</Badge>;
  })();

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="link-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to admin
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">Gantt PDF renderer health</h1>
            <p className="text-sm text-muted-foreground">
              Status of the cached Chromium instance used to export project Gantt PDFs.
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
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => recycleMutation.mutate()}
            disabled={recycleMutation.isPending || !cb?.present}
            data-testid="button-recycle"
          >
            <RotateCcw className={`h-4 w-4 mr-1 ${recycleMutation.isPending ? "animate-spin" : ""}`} />
            Recycle now
          </Button>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive" data-testid="alert-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to load renderer health</AlertTitle>
          <AlertDescription>Try refreshing or check server logs.</AlertDescription>
        </Alert>
      )}

      {queueBackedUp && (
        <Alert data-testid="alert-queue-backed-up">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Render queue is backing up</AlertTitle>
          <AlertDescription>
            {queueDepth} of {queueMax} queue slots are in use. New PDF requests may start failing if the queue fills up.
          </AlertDescription>
        </Alert>
      )}

      {alerts && alerts.config.enabled && alerts.state.lastBreaches.length > 0 && (
        <Alert variant="destructive" data-testid="alert-thresholds-breached">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Gantt PDF thresholds breached</AlertTitle>
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Browser
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2" data-testid="text-browser-status">
              {isLoading ? <Skeleton className="h-6 w-24" /> : browserStatusBadge}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            In-flight renders:{" "}
            <span className="font-medium text-foreground" data-testid="text-browser-inflight">
              {isLoading ? "…" : cb?.inFlight ?? 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Browser age
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-browser-age">
              {isLoading ? <Skeleton className="h-6 w-24" /> : formatDuration(cb?.ageMs ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Max age: {data ? formatDuration(data.limits.maxBrowserAgeMs) : "—"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> PDFs rendered
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-pdf-count">
              {isLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                `${cb?.pdfCount ?? 0} / ${data?.limits.maxPdfsPerBrowser ?? 0}`
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            On the current cached browser
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Activity className="h-3.5 w-3.5" /> Queue
            </CardDescription>
            <CardTitle className="text-lg" data-testid="text-queue-depth">
              {isLoading ? (
                <Skeleton className="h-6 w-24" />
              ) : (
                <>
                  <span data-testid="text-queue-active">{data?.queue.activeRenders ?? 0}</span>
                  {" active · "}
                  <span data-testid="text-queue-waiting">{queueDepth}</span>
                  {" waiting"}
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Max concurrent: {data?.limits.maxConcurrentRenders ?? "—"} · Max queue: {queueMax || "—"}
          </CardContent>
        </Card>
      </div>

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
              ts: b.bucketStart,
              total: b.total,
              failures: b.failures,
              avgSec: b.avgDurationMs != null ? Math.round(b.avgDurationMs / 100) / 10 : 0,
              maxSec: b.maxDurationMs != null ? Math.round(b.maxDurationMs / 100) / 10 : 0,
            }));
            const failureRate = win.total > 0 ? Math.round((win.failures / win.total) * 1000) / 10 : 0;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Renders</div>
                    <div className="font-medium" data-testid="text-history-total">{win.total}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Failures</div>
                    <div className="font-medium" data-testid="text-history-failures">
                      {win.failures} ({failureRate}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Avg duration</div>
                    <div className="font-medium" data-testid="text-history-avg">
                      {win.avgDurationMs != null ? formatDuration(win.avgDurationMs) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Max duration</div>
                    <div className="font-medium" data-testid="text-history-max">
                      {win.maxDurationMs != null ? formatDuration(win.maxDurationMs) : "—"}
                    </div>
                  </div>
                </div>
                {win.total === 0 ? (
                  <div className="h-64 flex items-center justify-center text-sm text-muted-foreground" data-testid="text-history-empty">
                    No renders recorded in this window yet.
                  </div>
                ) : (
                  <div className="h-64 w-full" data-testid="chart-history">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="count" tick={{ fontSize: 11 }} allowDecimals={false} />
                        <YAxis yAxisId="dur" orientation="right" tick={{ fontSize: 11 }} unit="s" />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar yAxisId="count" dataKey="total" name="Renders" fill="hsl(var(--primary))" />
                        <Bar yAxisId="count" dataKey="failures" name="Failures" fill="hsl(var(--destructive))" />
                        <Line yAxisId="dur" type="monotone" dataKey="avgSec" name="Avg (s)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                        <Line yAxisId="dur" type="monotone" dataKey="maxSec" name="Max (s)" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="text-xs text-muted-foreground" data-testid="text-history-retained">
                  {history.retainedSamples} sample{history.retainedSamples === 1 ? "" : "s"} retained.
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
                {alerts?.config.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                Alerts
              </CardTitle>
              <CardDescription>
                Notify SUPER_ADMIN and ADMIN users by email and in-app when failure rate or render duration crosses these thresholds.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
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
                    onChange={(e) => setAlertForm({ ...alertForm, evaluationWindowMs: Math.max(1, Number(e.target.value || 0)) * 60000 })}
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
                    onChange={(e) => setAlertForm({ ...alertForm, failureRatePct: Math.min(100, Math.max(0, Number(e.target.value || 0))) })}
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
                    onChange={(e) => setAlertForm({ ...alertForm, cooldownMs: Math.max(0, Number(e.target.value || 0)) * 60000 })}
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
                    onChange={(e) => setAlertForm({ ...alertForm, avgDurationMs: Math.max(0, Number(e.target.value || 0)) * 1000 })}
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
                    onChange={(e) => setAlertForm({ ...alertForm, maxDurationMs: Math.max(0, Number(e.target.value || 0)) * 1000 })}
                    data-testid="input-alert-max-duration-sec"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
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

      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>Configured thresholds that drive recycling and back-pressure.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max PDFs per browser</dt>
                <dd className="font-medium" data-testid="text-limit-max-pdfs">{data.limits.maxPdfsPerBrowser}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max browser age</dt>
                <dd className="font-medium" data-testid="text-limit-max-age">{formatDuration(data.limits.maxBrowserAgeMs)}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max concurrent renders</dt>
                <dd className="font-medium" data-testid="text-limit-max-concurrent">{data.limits.maxConcurrentRenders}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Max queue length</dt>
                <dd className="font-medium" data-testid="text-limit-max-queue">{data.limits.maxQueueLength}</dd>
              </div>
              <div className="flex justify-between border-b pb-1">
                <dt className="text-muted-foreground">Queue wait timeout</dt>
                <dd className="font-medium" data-testid="text-limit-queue-timeout">{formatDuration(data.limits.queueWaitTimeoutMs)}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
