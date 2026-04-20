import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, RotateCcw, Activity, Clock, FileText, CheckCircle2, XCircle, AlertTriangle, TrendingUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
