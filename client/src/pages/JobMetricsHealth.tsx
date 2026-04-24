import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, Cake, XCircle, Activity, BarChart3, Play, ListChecks, FileStack, HardHat, Trash2, BellRing, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface JobMetricSample {
  timestamp: number;
  counters: Record<string, number>;
}

interface JobMetricsResponse {
  job: string;
  windowMs: number;
  samples: JobMetricSample[];
  totals: Record<string, number>;
  latest: JobMetricSample | null;
}

interface JobsListResponse {
  jobs: JobMetricsResponse[];
}

interface RegistryJob {
  name: string;
  description?: string;
  schedule?: string;
}

interface RegistryJobsResponse {
  schedulersRunning: boolean;
  jobs: RegistryJob[];
}

const BIRTHDAY_JOB = "crm_birthday_digest";
const BIRTHDAY_COUNTERS = [
  "digestsSent",
  "skippedTimeOfDay",
  "skippedDedupe",
  "skippedNoBirthdays",
] as const;

const COUNTER_COLORS: Record<string, string> = {
  digestsSent: "hsl(var(--chart-1))",
  skippedTimeOfDay: "hsl(var(--chart-2))",
  skippedDedupe: "hsl(var(--chart-3))",
  skippedNoBirthdays: "hsl(var(--chart-4))",
};

const COUNTER_LABELS: Record<string, string> = {
  digestsSent: "Digests sent",
  skippedTimeOfDay: "Skipped (time of day)",
  skippedDedupe: "Skipped (dedupe)",
  skippedNoBirthdays: "Skipped (no birthdays)",
};

// Task #1464 — orphan-cleanup chart counters. We chart `candidates`
// (rows that fell into the retention window) and `deleted` (rows the
// sweep actually removed) so a slow drift in either is obvious.
const ORPHAN_COUNTERS = ["candidates", "deleted"] as const;
const ORPHAN_COUNTER_COLORS: Record<string, string> = {
  candidates: "hsl(var(--chart-2))",
  deleted: "hsl(var(--chart-1))",
};
const ORPHAN_COUNTER_LABELS: Record<string, string> = {
  candidates: "Candidates",
  deleted: "Deleted",
};

// Task #1504 — stale-refresh chart counters. Mirrors the orphan-cleanup
// chart treatment (Task #1464) so operators can spot a slow drift in
// candidates / succeeded / failed across the rolling 24h window.
const STALE_COUNTERS = ["candidates", "succeeded", "failed"] as const;
const STALE_COUNTER_COLORS: Record<string, string> = {
  candidates: "hsl(var(--chart-2))",
  succeeded: "hsl(var(--chart-1))",
  failed: "hsl(var(--chart-3))",
};
const STALE_COUNTER_LABELS: Record<string, string> = {
  candidates: "Candidates",
  succeeded: "Succeeded",
  failed: "Failed",
};

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

const BIRTHDAY_KEY = ["/api/admin/metrics/jobs", BIRTHDAY_JOB] as const;
const ALL_JOBS_KEY = ["/api/admin/metrics/jobs"] as const;
const REGISTRY_KEY = ["/api/admin/jobs"] as const;
const WAGE_STALE_LAST_RUN_KEY = ["/api/admin/jobs/wage_decision_stale_refresh/last-run"] as const;
const WAGE_STALE_JOB = "wage_decision_stale_refresh";
const WAGE_ORPHAN_LAST_RUN_KEY = ["/api/admin/jobs/wage_decision_orphan_sweep/last-run"] as const;
const WAGE_ORPHAN_JOB = "wage_decision_orphan_sweep";
const WAGE_ORPHAN_METRICS_KEY = ["/api/admin/metrics/jobs", WAGE_ORPHAN_JOB] as const;
const WAGE_STALE_METRICS_KEY = ["/api/admin/metrics/jobs", WAGE_STALE_JOB] as const;
const WAGE_RETRY_JOB = "wage_decision_retry";

interface OrphanWageDecisionSweepResult {
  candidates: number;
  deleted: number;
  retentionDays: number;
}

interface OrphanWageDecisionSweepRecord {
  ranAt: string;
  durationMs: number;
  result: OrphanWageDecisionSweepResult;
}

interface WageDecisionOrphanLastRunResponse {
  lastRun: OrphanWageDecisionSweepRecord | null;
  recent?: OrphanWageDecisionSweepRecord[];
}

interface StaleWageDecisionSweepResult {
  candidates: number;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNoConnection: number;
  skippedNoCredentials: number;
  staleAfterDays: number;
}

interface StaleWageDecisionSweepRecord {
  ranAt: string;
  durationMs: number;
  result: StaleWageDecisionSweepResult;
}

interface WageDecisionLastRunResponse {
  lastRun: StaleWageDecisionSweepRecord | null;
  recent?: StaleWageDecisionSweepRecord[];
  staleAfterDays: number;
}

function bucketSamples(samples: JobMetricSample[], counters: readonly string[]) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const bucketMs = 60 * 60 * 1000;
  const bucketCount = 24;
  const start = now - windowMs;
  const buckets: Array<{
    label: string;
    ts: number;
    [key: string]: number | string;
  }> = [];
  for (let i = 0; i < bucketCount; i++) {
    const bucketStart = start + i * bucketMs;
    const row: Record<string, number | string> = {
      ts: bucketStart,
      label: new Date(bucketStart).getHours().toString().padStart(2, "0") + ":00",
    };
    for (const c of counters) row[c] = 0;
    buckets.push(row as typeof buckets[number]);
  }
  for (const s of samples) {
    if (s.timestamp < start) continue;
    const idx = Math.min(
      bucketCount - 1,
      Math.floor((s.timestamp - start) / bucketMs)
    );
    for (const c of counters) {
      const v = s.counters[c];
      if (typeof v === "number") {
        (buckets[idx][c] as number) = (buckets[idx][c] as number) + v;
      }
    }
  }
  return buckets;
}

export default function JobMetricsHealth() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<JobMetricsResponse>({
    queryKey: BIRTHDAY_KEY,
    refetchInterval: 15000,
  });

  const { data: allJobs } = useQuery<JobsListResponse>({
    queryKey: ALL_JOBS_KEY,
    refetchInterval: 30000,
  });

  const { data: registry, isLoading: registryLoading, isError: registryError } = useQuery<RegistryJobsResponse>({
    queryKey: REGISTRY_KEY,
  });

  const { data: wageStaleLastRun, isLoading: wageStaleLoading } = useQuery<WageDecisionLastRunResponse>({
    queryKey: WAGE_STALE_LAST_RUN_KEY,
    refetchInterval: 30000,
  });

  // Task #1429 — orphan-row cleanup runs inside the wage-decision retry
  // sweep but its counters are tracked separately so operators can see
  // at a glance whether the retention window is doing what they expect.
  const { data: wageOrphanLastRun, isLoading: wageOrphanLoading } = useQuery<WageDecisionOrphanLastRunResponse>({
    queryKey: WAGE_ORPHAN_LAST_RUN_KEY,
    refetchInterval: 30000,
  });

  // Task #1464 — pull the rolling 24h sample series for the orphan
  // sweep so we can render a bar chart of `candidates` and `deleted`
  // counters using the same `bucketSamples` + recharts pattern as the
  // birthday-digest card. The endpoint is the generic per-job metrics
  // route that already serves any job calling `recordJobMetrics`.
  const {
    data: wageOrphanMetrics,
    isLoading: wageOrphanMetricsLoading,
    isError: wageOrphanMetricsError,
  } = useQuery<JobMetricsResponse>({
    queryKey: WAGE_ORPHAN_METRICS_KEY,
    refetchInterval: 30000,
  });

  // Task #1504 — same rolling 24h sample series for the stale-refresh
  // sweep so the card can render a `bucketSamples` + recharts trend
  // chart matching the orphan-cleanup card.
  const {
    data: wageStaleMetrics,
    isLoading: wageStaleMetricsLoading,
    isError: wageStaleMetricsError,
  } = useQuery<JobMetricsResponse>({
    queryKey: WAGE_STALE_METRICS_KEY,
    refetchInterval: 30000,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [runningJob, setRunningJob] = useState<string | null>(null);

  const runJobMutation = useMutation({
    mutationFn: async (jobName: string) => {
      const res = await apiRequest("POST", `/api/admin/jobs/${encodeURIComponent(jobName)}/run`);
      return (await res.json()) as { job: string; status: string; durationMs: number };
    },
    onMutate: (jobName) => {
      setRunningJob(jobName);
    },
    onSuccess: (data) => {
      toast({
        title: `Job '${data.job}' completed`,
        description: `Finished in ${data.durationMs}ms.`,
      });
      queryClient.invalidateQueries({ queryKey: ALL_JOBS_KEY });
      queryClient.invalidateQueries({ queryKey: BIRTHDAY_KEY });
      queryClient.invalidateQueries({ queryKey: WAGE_STALE_LAST_RUN_KEY });
      queryClient.invalidateQueries({ queryKey: WAGE_ORPHAN_LAST_RUN_KEY });
      queryClient.invalidateQueries({ queryKey: WAGE_ORPHAN_METRICS_KEY });
      queryClient.invalidateQueries({ queryKey: WAGE_STALE_METRICS_KEY });
    },
    onError: (err: unknown, jobName) => {
      const description =
        err instanceof Error ? err.message : "An unexpected error occurred. Check server logs.";
      toast({
        title: `Failed to run '${jobName}'`,
        description,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setRunningJob(null);
    },
  });
  const portfolioKpiMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/jobs/portfolio_kpi_snapshot/run");
      return (await res.json()) as { job: string; status: string; durationMs: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Portfolio KPI snapshot captured",
        description: `Completed in ${data.durationMs}ms. Sparklines will refresh shortly.`,
      });
      queryClient.invalidateQueries({ queryKey: ALL_JOBS_KEY });
    },
    onError: (err: unknown) => {
      const description =
        err instanceof Error ? err.message : "An unexpected error occurred. Check server logs.";
      toast({
        title: "Failed to capture portfolio KPI snapshot",
        description,
        variant: "destructive",
      });
    },
  });

  const chartData = useMemo(
    () => (data ? bucketSamples(data.samples, BIRTHDAY_COUNTERS) : []),
    [data]
  );

  const wageOrphanChartData = useMemo(
    () =>
      wageOrphanMetrics
        ? bucketSamples(wageOrphanMetrics.samples, ORPHAN_COUNTERS)
        : [],
    [wageOrphanMetrics]
  );
  const wageOrphanSampleCount = wageOrphanMetrics?.samples.length ?? 0;

  const wageStaleChartData = useMemo(
    () =>
      wageStaleMetrics
        ? bucketSamples(wageStaleMetrics.samples, STALE_COUNTERS)
        : [],
    [wageStaleMetrics]
  );
  const wageStaleSampleCount = wageStaleMetrics?.samples.length ?? 0;

  const totals = data?.totals ?? {};
  const latest = data?.latest ?? null;
  const sampleCount = data?.samples.length ?? 0;
  const otherJobs = (allJobs?.jobs ?? []).filter((j) => j.job !== BIRTHDAY_JOB);

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
            <h1 className="text-2xl font-semibold" data-testid="text-page-title">
              Background job metrics
            </h1>
            <p className="text-sm text-muted-foreground">
              Rolling 24h delivery health for the CRM birthday digest job and any other
              job that publishes counters via <code>recordJobMetrics</code>. Samples are
              process-local and reset on restart.
            </p>
          </div>
        </div>
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
      </div>

      {isError && (
        <Alert variant="destructive" data-testid="alert-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Failed to load job metrics</AlertTitle>
          <AlertDescription>Try refreshing or check server logs.</AlertDescription>
        </Alert>
      )}

      <Card data-testid="card-portfolio-kpi-snapshot">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> Portfolio KPI snapshot
              </CardTitle>
              <CardDescription>
                Manually run the <code>portfolio_kpi_snapshot</code> job to refresh per-project
                weekly KPI sparklines (health/SPI/CPI/burn). The job otherwise runs nightly at
                02:15. Super Admin only.
              </CardDescription>
            </div>
            <Button
              onClick={() => portfolioKpiMutation.mutate()}
              disabled={portfolioKpiMutation.isPending}
              data-testid="button-run-portfolio-kpi-snapshot"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${portfolioKpiMutation.isPending ? "animate-spin" : ""}`}
              />
              {portfolioKpiMutation.isPending ? "Capturing…" : "Capture snapshot now"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/*
        Task #1490 — The bespoke certified-payroll backfill card was retired
        once the generic "One-shot jobs" admin panel (Task #1448) covered the
        re-run flow. The orgFilter / dryRun specialised re-run still lives at
        POST /api/admin/jobs/certified-payroll-backfill/run for ops scripts.
      */}
      <Card data-testid="card-certified-payroll-backfill-link">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileStack className="h-4 w-4" /> Certified payroll backfill
              </CardTitle>
              <CardDescription>
                Re-runs are now managed from the generic One-shot jobs panel.
                Org-scoped or dry-run re-runs remain available via the
                <code> /api/admin/jobs/certified-payroll-backfill/run</code>{" "}
                endpoint for ops scripts.
              </CardDescription>
            </div>
            <Link href="/admin/one-shot-jobs">
              <Button variant="outline" size="sm" data-testid="link-cp-backfill-one-shot-jobs">
                Manage in One-shot jobs
              </Button>
            </Link>
          </div>
        </CardHeader>
      </Card>

      <Card data-testid="card-wage-decision-stale-refresh">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardHat className="h-4 w-4" /> Davis-Bacon wage decision auto-refresh
              </CardTitle>
              <CardDescription>
                Daily sweep at 06:00 UTC that re-syncs cached prevailing wage
                determinations whose <code>lastSyncAt</code> is older than{" "}
                <span data-testid="text-wage-stale-after-days">
                  {wageStaleLastRun?.staleAfterDays ?? "—"}
                </span>{" "}
                days (controlled by <code>DOL_DAVIS_BACON_STALE_AFTER_DAYS</code>). Rows
                currently in the failure-backoff lane are skipped so a flaky DOL endpoint
                isn't hammered. Super Admin only.
              </CardDescription>
            </div>
            <Button
              onClick={() => runJobMutation.mutate(WAGE_STALE_JOB)}
              disabled={runJobMutation.isPending}
              data-testid="button-run-wage-decision-stale-refresh"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${
                  runJobMutation.isPending && runningJob === WAGE_STALE_JOB
                    ? "animate-spin"
                    : ""
                }`}
              />
              {runJobMutation.isPending && runningJob === WAGE_STALE_JOB
                ? "Running…"
                : "Run now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {wageStaleLoading ? (
            <Skeleton className="h-24 w-full" data-testid="skeleton-wage-stale" />
          ) : !wageStaleLastRun?.lastRun ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-wage-stale-no-run"
            >
              No sweep has ever been recorded. Sweep summaries are persisted across
              restarts, so this means the job has truly never run yet — use “Run now” to
              trigger it manually, or wait for the next 06:00 UTC tick.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Last sweep:{" "}
                <span className="font-medium text-foreground" data-testid="text-wage-stale-ran-at">
                  {new Date(wageStaleLastRun.lastRun.ranAt).toLocaleString()}
                </span>{" "}
                <span data-testid="text-wage-stale-relative">
                  ({formatRelative(new Date(wageStaleLastRun.lastRun.ranAt).getTime())})
                </span>{" "}
                · finished in{" "}
                <span data-testid="text-wage-stale-duration">
                  {wageStaleLastRun.lastRun.durationMs}ms
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                {(
                  [
                    ["candidates", "Candidates"],
                    ["attempted", "Attempted"],
                    ["succeeded", "Succeeded"],
                    ["failed", "Failed"],
                    ["skippedNoConnection", "Skipped (no connection)"],
                    ["skippedNoCredentials", "Skipped (no credentials)"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} data-testid={`stat-wage-stale-${key}`}>
                    <div className="text-muted-foreground">{label}</div>
                    <div
                      className="font-medium text-lg"
                      data-testid={`text-wage-stale-${key}`}
                    >
                      {wageStaleLastRun.lastRun!.result[key]}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2" data-testid="wage-stale-trend">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Last 24h trend
                </div>
                {wageStaleMetricsLoading ? (
                  <Skeleton
                    className="h-48 w-full"
                    data-testid="skeleton-wage-stale-chart"
                  />
                ) : wageStaleMetricsError ? (
                  <Alert
                    variant="destructive"
                    data-testid="alert-wage-stale-chart-error"
                  >
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Failed to load stale-refresh trend</AlertTitle>
                    <AlertDescription>
                      Try refreshing or check server logs.
                    </AlertDescription>
                  </Alert>
                ) : wageStaleSampleCount === 0 ? (
                  <div
                    className="h-48 flex items-center justify-center text-sm text-muted-foreground border rounded-md"
                    data-testid="text-wage-stale-no-samples"
                  >
                    No samples recorded in the last 24h yet.
                  </div>
                ) : (
                  <div
                    className="h-48 w-full"
                    data-testid="chart-wage-stale"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={wageStaleChartData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11 }}
                          interval={2}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {STALE_COUNTERS.map((c) => (
                          <Bar
                            key={c}
                            dataKey={c}
                            name={STALE_COUNTER_LABELS[c]}
                            fill={STALE_COUNTER_COLORS[c]}
                          />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              {wageStaleLastRun.recent && wageStaleLastRun.recent.length > 1 && (
                <div className="pt-2" data-testid="wage-stale-recent-history">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Recent sweeps
                  </div>
                  <div className="text-xs border rounded-md divide-y">
                    {wageStaleLastRun.recent.slice(0, 10).map((s, idx) => (
                      <div
                        key={`${s.ranAt}-${idx}`}
                        className="flex items-center justify-between gap-2 px-2 py-1"
                        data-testid={`row-wage-stale-recent-${idx}`}
                      >
                        <span className="text-muted-foreground">
                          {new Date(s.ranAt).toLocaleString()}
                        </span>
                        <span>
                          cand {s.result.candidates} · ok {s.result.succeeded} · fail{" "}
                          {s.result.failed} · {s.durationMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-wage-decision-orphan-sweep">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trash2 className="h-4 w-4" /> Davis-Bacon orphan row cleanup
              </CardTitle>
              <CardDescription>
                Cleanup that drops cached <code>wage_determination:*</code> rows no
                project references anymore and whose last touch is older than the
                retention window
                {wageOrphanLastRun?.lastRun ? (
                  <>
                    {" "}(currently{" "}
                    <span data-testid="text-wage-orphan-retention-days">
                      {wageOrphanLastRun.lastRun.result.retentionDays}
                    </span>{" "}
                    days)
                  </>
                ) : null}
                . Runs as part of the wage-decision retry sweep
                (<code>{WAGE_RETRY_JOB}</code>); use “Run now” to trigger that sweep
                manually. Super Admin only.
              </CardDescription>
            </div>
            <Button
              onClick={() => runJobMutation.mutate(WAGE_RETRY_JOB)}
              disabled={runJobMutation.isPending}
              data-testid="button-run-wage-decision-orphan-sweep"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${
                  runJobMutation.isPending && runningJob === WAGE_RETRY_JOB
                    ? "animate-spin"
                    : ""
                }`}
              />
              {runJobMutation.isPending && runningJob === WAGE_RETRY_JOB
                ? "Running…"
                : "Run now"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {wageOrphanLoading ? (
            <Skeleton className="h-24 w-full" data-testid="skeleton-wage-orphan" />
          ) : !wageOrphanLastRun?.lastRun ? (
            <div
              className="text-sm text-muted-foreground"
              data-testid="text-wage-orphan-no-run"
            >
              No cleanup has been recorded yet. The sweep runs every time the
              wage-decision retry job ticks — use “Run now” to trigger it
              immediately.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Last cleanup:{" "}
                <span className="font-medium text-foreground" data-testid="text-wage-orphan-ran-at">
                  {new Date(wageOrphanLastRun.lastRun.ranAt).toLocaleString()}
                </span>{" "}
                <span data-testid="text-wage-orphan-relative">
                  ({formatRelative(new Date(wageOrphanLastRun.lastRun.ranAt).getTime())})
                </span>{" "}
                · finished in{" "}
                <span data-testid="text-wage-orphan-duration">
                  {wageOrphanLastRun.lastRun.durationMs}ms
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                {(
                  [
                    ["candidates", "Candidates considered"],
                    ["deleted", "Rows deleted"],
                    ["retentionDays", "Retention (days)"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} data-testid={`stat-wage-orphan-${key}`}>
                    <div className="text-muted-foreground">{label}</div>
                    <div
                      className="font-medium text-lg"
                      data-testid={`text-wage-orphan-${key}`}
                    >
                      {wageOrphanLastRun.lastRun!.result[key]}
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2" data-testid="wage-orphan-trend">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Last 24h trend
                </div>
                {wageOrphanMetricsLoading ? (
                  <Skeleton
                    className="h-48 w-full"
                    data-testid="skeleton-wage-orphan-chart"
                  />
                ) : wageOrphanMetricsError ? (
                  <Alert
                    variant="destructive"
                    data-testid="alert-wage-orphan-chart-error"
                  >
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Failed to load orphan sweep trend</AlertTitle>
                    <AlertDescription>
                      Try refreshing or check server logs.
                    </AlertDescription>
                  </Alert>
                ) : wageOrphanSampleCount === 0 ? (
                  <div
                    className="h-48 flex items-center justify-center text-sm text-muted-foreground border rounded-md"
                    data-testid="text-wage-orphan-no-samples"
                  >
                    No samples recorded in the last 24h yet.
                  </div>
                ) : (
                  <div
                    className="h-48 w-full"
                    data-testid="chart-wage-orphan"
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={wageOrphanChartData}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11 }}
                          interval={2}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          allowDecimals={false}
                        />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {ORPHAN_COUNTERS.map((c) => (
                          <Bar
                            key={c}
                            dataKey={c}
                            name={ORPHAN_COUNTER_LABELS[c]}
                            fill={ORPHAN_COUNTER_COLORS[c]}
                          />
                        ))}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
              {wageOrphanLastRun.recent && wageOrphanLastRun.recent.length > 1 && (
                <div className="pt-2" data-testid="wage-orphan-recent-history">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Recent cleanups
                  </div>
                  <div className="text-xs border rounded-md divide-y">
                    {wageOrphanLastRun.recent.slice(0, 10).map((s, idx) => (
                      <div
                        key={`${s.ranAt}-${idx}`}
                        className="flex items-center justify-between gap-2 px-2 py-1"
                        data-testid={`row-wage-orphan-recent-${idx}`}
                      >
                        <span className="text-muted-foreground">
                          {new Date(s.ranAt).toLocaleString()}
                        </span>
                        <span>
                          cand {s.result.candidates} · del {s.result.deleted} ·{" "}
                          {s.durationMs}ms
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <WageRefreshAlertThresholdsCard />

      <Card data-testid="card-all-jobs">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4" /> All background jobs
          </CardTitle>
          <CardDescription>
            Manually trigger any job registered in the backend job registry. Useful for
            kicking off nightly compliance checks, idle opportunity sweeps, IMAP sync, etc.
            without shell access.{" "}
            {registry && (
              <span className="text-muted-foreground" data-testid="text-schedulers-status">
                Schedulers are{" "}
                <strong>{registry.schedulersRunning ? "running" : "disabled"}</strong> in this
                environment.
              </span>
            )}{" "}
            Super Admin only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registryLoading ? (
            <Skeleton className="h-32 w-full" data-testid="skeleton-registry" />
          ) : registryError || !registry ? (
            <Alert variant="destructive" data-testid="alert-registry-error">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Failed to load job registry</AlertTitle>
              <AlertDescription>Try refreshing or check server logs.</AlertDescription>
            </Alert>
          ) : registry.jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-no-jobs">
              No jobs registered.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-jobs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Job</th>
                    <th className="py-2 pr-4 font-medium">Description</th>
                    <th className="py-2 pr-4 font-medium">Schedule</th>
                    <th className="py-2 pr-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {registry.jobs.map((job) => {
                    const isRunning = runJobMutation.isPending && runningJob === job.name;
                    const anyRunning = runJobMutation.isPending;
                    return (
                      <tr
                        key={job.name}
                        className="border-b last:border-b-0 align-top"
                        data-testid={`row-job-${job.name}`}
                      >
                        <td className="py-2 pr-4 font-mono text-xs" data-testid={`text-job-registry-name-${job.name}`}>
                          {job.name}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {job.description ?? "—"}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                          {job.schedule ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => runJobMutation.mutate(job.name)}
                            disabled={anyRunning}
                            data-testid={`button-run-job-${job.name}`}
                          >
                            {isRunning ? (
                              <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5 mr-1" />
                            )}
                            {isRunning ? "Running…" : "Run now"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-birthday-digest">
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cake className="h-4 w-4" /> CRM birthday digest
              </CardTitle>
              <CardDescription>
                Window: {data ? formatDuration(data.windowMs) : "24h"} · Samples retained:{" "}
                <span data-testid="text-sample-count">{sampleCount}</span> · Last tick:{" "}
                <span data-testid="text-last-tick">{formatRelative(latest?.timestamp ?? null)}</span>
                {latest && (
                  <span className="text-muted-foreground"> ({formatTimestamp(latest.timestamp)})</span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {BIRTHDAY_COUNTERS.map((c) => (
                  <div key={c} data-testid={`stat-${c}`}>
                    <div className="text-muted-foreground">{COUNTER_LABELS[c]}</div>
                    <div className="font-medium text-lg" data-testid={`text-total-${c}`}>
                      {totals[c] ?? 0}
                    </div>
                    {latest && (
                      <div className="text-xs text-muted-foreground" data-testid={`text-latest-${c}`}>
                        Last tick: {latest.counters[c] ?? 0}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {sampleCount === 0 ? (
                <div
                  className="h-64 flex items-center justify-center text-sm text-muted-foreground"
                  data-testid="text-no-samples"
                >
                  No samples recorded yet. The job has not run since the server started.
                </div>
              ) : (
                <div className="h-64 w-full" data-testid="chart-birthday-digest">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {BIRTHDAY_COUNTERS.map((c) => (
                        <Bar
                          key={c}
                          dataKey={c}
                          name={COUNTER_LABELS[c]}
                          stackId="counters"
                          fill={COUNTER_COLORS[c]}
                        />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {otherJobs.length > 0 && (
        <Card data-testid="card-other-jobs">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Other tracked jobs
            </CardTitle>
            <CardDescription>
              Totals over the rolling 24h window for any other job that publishes counters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {otherJobs.map((job) => (
              <div key={job.job} className="border rounded-md p-3" data-testid={`job-${job.job}`}>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <div className="font-medium" data-testid={`text-job-name-${job.job}`}>
                    {job.job}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {job.samples.length} sample{job.samples.length === 1 ? "" : "s"} · Last tick:{" "}
                    {formatRelative(job.latest?.timestamp ?? null)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {Object.entries(job.totals).length === 0 ? (
                    <div className="text-muted-foreground">No counters recorded.</div>
                  ) : (
                    Object.entries(job.totals).map(([k, v]) => (
                      <div key={k} data-testid={`text-other-counter-${job.job}-${k}`}>
                        <span className="text-muted-foreground">{k}: </span>
                        <span className="font-medium">{v}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Task #1452 — Wage refresh alert threshold editor
// ---------------------------------------------------------------------
// Lets a Super Admin tune the built-in alert defaults for the nightly
// `wage_decision_stale_refresh` sweep without touching SQL. Surfaces:
//   - the resolved built-in default (from PER_JOB_DEFAULTS, served via
//     /api/admin/metrics/jobs/alerts), and
//   - whether an operator-authored override row already exists.
// Saving upserts a row in `job_metric_alert_rules` via the existing
// `upsertJobMetricAlertRule` helper. "Reset to default" deletes the
// override and falls back to the built-in.

const WAGE_REFRESH_JOB = "wage_decision_stale_refresh";
const WAGE_REFRESH_SPIKE_COUNTER = "failed";
const ALERTS_KEY = ["/api/admin/metrics/jobs/alerts"] as const;

interface JobMetricAlertRuleRow {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  threshold: string;
  minAbsolute: number;
  dedupeMinutes: number;
  enabled: boolean;
  emailWhenAbove: string | null;
}

interface PerJobDefaultsResponse {
  [job: string]: {
    stall?: {
      thresholdHours: number;
      dedupeMinutes?: number;
      emailWhenAboveHours?: number | null;
    };
    spikes?: Record<
      string,
      {
        multiplier: number;
        minAbsolute: number;
        dedupeMinutes?: number;
        emailWhenAbove?: number | null;
      }
    >;
  };
}

interface AlertsResponse {
  rules: JobMetricAlertRuleRow[];
  defaults: {
    spike: { multiplier: number; minAbsolute: number; dedupeMinutes: number; emailWhenAbove: number };
    stall: { hours: number; dedupeMinutes: number; emailWhenAbove: number };
  };
  perJobDefaults: PerJobDefaultsResponse;
}

interface ThresholdFormState {
  threshold: string;
  minAbsolute: string;
  emailWhenAbove: string;
}

function findRule(
  rules: JobMetricAlertRuleRow[],
  kind: "spike" | "stall",
  counter: string | null,
): JobMetricAlertRuleRow | null {
  return (
    rules.find(
      (r) =>
        r.job === WAGE_REFRESH_JOB &&
        r.kind === kind &&
        (kind === "stall" ? r.counter === null : r.counter === counter),
    ) ?? null
  );
}

function WageRefreshAlertThresholdsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<AlertsResponse>({
    queryKey: ALERTS_KEY,
  });

  const stallOverride = data ? findRule(data.rules, "stall", null) : null;
  const spikeOverride = data ? findRule(data.rules, "spike", WAGE_REFRESH_SPIKE_COUNTER) : null;

  const stallDefault = data?.perJobDefaults?.[WAGE_REFRESH_JOB]?.stall ?? null;
  const spikeDefault =
    data?.perJobDefaults?.[WAGE_REFRESH_JOB]?.spikes?.[WAGE_REFRESH_SPIKE_COUNTER] ?? null;

  const resolvedStall = {
    threshold: stallOverride
      ? Number(stallOverride.threshold)
      : stallDefault?.thresholdHours ?? data?.defaults.stall.hours ?? 4,
    emailWhenAbove:
      stallOverride && stallOverride.emailWhenAbove !== null
        ? Number(stallOverride.emailWhenAbove)
        : stallDefault?.emailWhenAboveHours ?? data?.defaults.stall.emailWhenAbove ?? null,
  };
  const resolvedSpike = {
    threshold: spikeOverride
      ? Number(spikeOverride.threshold)
      : spikeDefault?.multiplier ?? data?.defaults.spike.multiplier ?? 3,
    minAbsolute: spikeOverride
      ? spikeOverride.minAbsolute
      : spikeDefault?.minAbsolute ?? data?.defaults.spike.minAbsolute ?? 5,
    emailWhenAbove:
      spikeOverride && spikeOverride.emailWhenAbove !== null
        ? Number(spikeOverride.emailWhenAbove)
        : spikeDefault?.emailWhenAbove ?? data?.defaults.spike.emailWhenAbove ?? null,
  };

  const [stallForm, setStallForm] = useState<ThresholdFormState>({
    threshold: "",
    minAbsolute: "",
    emailWhenAbove: "",
  });
  const [spikeForm, setSpikeForm] = useState<ThresholdFormState>({
    threshold: "",
    minAbsolute: "",
    emailWhenAbove: "",
  });

  // Re-sync the form inputs whenever a fresh payload arrives. The init
  // signatures collapse the resolved (default | override) values into a
  // single string so the effect only fires when something actually
  // changed (not on every render). Inputs stay as strings so operators
  // can clear them mid-edit and so a blank emailWhenAbove can be
  // distinguished from "0".
  const stallInit = `${resolvedStall.threshold}|${resolvedStall.emailWhenAbove ?? ""}`;
  const spikeInit = `${resolvedSpike.threshold}|${resolvedSpike.minAbsolute}|${resolvedSpike.emailWhenAbove ?? ""}`;
  useEffect(() => {
    if (!data) return;
    setStallForm({
      threshold: String(resolvedStall.threshold),
      minAbsolute: "",
      emailWhenAbove:
        resolvedStall.emailWhenAbove === null || resolvedStall.emailWhenAbove === undefined
          ? ""
          : String(resolvedStall.emailWhenAbove),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stallInit, data]);
  useEffect(() => {
    if (!data) return;
    setSpikeForm({
      threshold: String(resolvedSpike.threshold),
      minAbsolute: String(resolvedSpike.minAbsolute),
      emailWhenAbove:
        resolvedSpike.emailWhenAbove === null || resolvedSpike.emailWhenAbove === undefined
          ? ""
          : String(resolvedSpike.emailWhenAbove),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spikeInit, data]);

  const upsertMutation = useMutation({
    mutationFn: async (payload: {
      id?: string | null;
      kind: "spike" | "stall";
      counter: string | null;
      threshold: number;
      minAbsolute?: number;
      emailWhenAbove: number | null;
    }) => {
      const res = await apiRequest("POST", "/api/admin/metrics/jobs/alerts/rules", {
        id: payload.id ?? undefined,
        job: WAGE_REFRESH_JOB,
        counter: payload.counter,
        kind: payload.kind,
        threshold: payload.threshold,
        minAbsolute: payload.minAbsolute,
        emailWhenAbove: payload.emailWhenAbove,
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: "Override saved",
        description: `Custom ${vars.kind} threshold for ${WAGE_REFRESH_JOB} is now active.`,
      });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to save override",
        description: err instanceof Error ? err.message : "Check server logs.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/metrics/jobs/alerts/rules/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Override cleared",
        description: "Reverted to the built-in default.",
      });
      queryClient.invalidateQueries({ queryKey: ALERTS_KEY });
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to clear override",
        description: err instanceof Error ? err.message : "Check server logs.",
        variant: "destructive",
      });
    },
  });

  const saveStall = () => {
    const threshold = Number(stallForm.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      toast({ title: "Invalid stall threshold", description: "Must be a positive number of hours.", variant: "destructive" });
      return;
    }
    const emailRaw = stallForm.emailWhenAbove.trim();
    const emailWhenAbove = emailRaw === "" ? null : Number(emailRaw);
    if (emailWhenAbove !== null && (!Number.isFinite(emailWhenAbove) || emailWhenAbove <= 0)) {
      toast({ title: "Invalid email threshold", description: "Leave blank to disable email, or enter a positive number of hours.", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({
      id: stallOverride?.id ?? null,
      kind: "stall",
      counter: null,
      threshold,
      emailWhenAbove,
    });
  };

  const saveSpike = () => {
    const threshold = Number(spikeForm.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      toast({ title: "Invalid spike multiplier", description: "Must be a positive number.", variant: "destructive" });
      return;
    }
    const minAbsolute = Number(spikeForm.minAbsolute);
    if (!Number.isInteger(minAbsolute) || minAbsolute < 0) {
      toast({ title: "Invalid floor", description: "Must be a non-negative integer.", variant: "destructive" });
      return;
    }
    const emailRaw = spikeForm.emailWhenAbove.trim();
    const emailWhenAbove = emailRaw === "" ? null : Number(emailRaw);
    if (emailWhenAbove !== null && (!Number.isFinite(emailWhenAbove) || emailWhenAbove <= 0)) {
      toast({ title: "Invalid email threshold", description: "Leave blank to disable email, or enter a positive multiplier.", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({
      id: spikeOverride?.id ?? null,
      kind: "spike",
      counter: WAGE_REFRESH_SPIKE_COUNTER,
      threshold,
      minAbsolute,
      emailWhenAbove,
    });
  };

  return (
    <Card data-testid="card-wage-refresh-alert-thresholds">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-4 w-4" /> Wage refresh alert thresholds
        </CardTitle>
        <CardDescription>
          Tune the built-in alert defaults for the nightly{" "}
          <code>{WAGE_REFRESH_JOB}</code> sweep. Lower the stall threshold to page
          sooner if a nightly run is missed, or raise the failed-spike floor if your
          environment runs noisier. Saving writes an operator override to{" "}
          <code>job_metric_alert_rules</code>; "Reset to default" removes the
          override and falls back to the built-in. Super Admin only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" data-testid="skeleton-wage-thresholds" />
        ) : isError || !data ? (
          <Alert variant="destructive" data-testid="alert-wage-thresholds-error">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Failed to load alert configuration</AlertTitle>
            <AlertDescription>Try refreshing or check server logs.</AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stall rule */}
            <div className="space-y-3 border rounded-md p-4" data-testid="section-wage-stall-threshold">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-medium flex items-center gap-2">
                  Stall threshold
                  {stallOverride ? (
                    <Badge variant="default" data-testid="badge-stall-override">Override active</Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-stall-default">Built-in default</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Built-in: {stallDefault?.thresholdHours ?? data.defaults.stall.hours}h
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Fires a Super Admin alert when the sweep has not produced a sample for
                this many hours. Raise to tolerate occasional missed runs; lower to
                page faster.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="wage-stall-threshold">Stall hours</Label>
                  <Input
                    id="wage-stall-threshold"
                    type="number"
                    min={1}
                    step={1}
                    value={stallForm.threshold}
                    onChange={(e) => setStallForm((s) => ({ ...s, threshold: e.target.value }))}
                    data-testid="input-wage-stall-threshold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wage-stall-email">Email when ≥ (hours, blank = no email)</Label>
                  <Input
                    id="wage-stall-email"
                    type="number"
                    min={1}
                    step={1}
                    value={stallForm.emailWhenAbove}
                    onChange={(e) => setStallForm((s) => ({ ...s, emailWhenAbove: e.target.value }))}
                    data-testid="input-wage-stall-email"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Button
                  size="sm"
                  onClick={saveStall}
                  disabled={upsertMutation.isPending}
                  data-testid="button-save-wage-stall"
                >
                  {upsertMutation.isPending ? "Saving…" : stallOverride ? "Update override" : "Save override"}
                </Button>
                {stallOverride && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(stallOverride.id)}
                    disabled={deleteMutation.isPending}
                    data-testid="button-reset-wage-stall"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reset to default
                  </Button>
                )}
              </div>
            </div>

            {/* Spike rule on `failed` counter */}
            <div className="space-y-3 border rounded-md p-4" data-testid="section-wage-spike-threshold">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-medium flex items-center gap-2">
                  Failed spike threshold
                  {spikeOverride ? (
                    <Badge variant="default" data-testid="badge-spike-override">Override active</Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-spike-default">Built-in default</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Built-in: {spikeDefault?.multiplier ?? data.defaults.spike.multiplier}× /
                  floor {spikeDefault?.minAbsolute ?? data.defaults.spike.minAbsolute}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Fires when last-hour <code>failed</code> count exceeds{" "}
                <em>multiplier × baseline</em> AND meets the absolute floor — keeps the
                rule from tripping on a 1-vs-0-baseline blip.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="wage-spike-multiplier">Multiplier</Label>
                  <Input
                    id="wage-spike-multiplier"
                    type="number"
                    min={1}
                    step={0.5}
                    value={spikeForm.threshold}
                    onChange={(e) => setSpikeForm((s) => ({ ...s, threshold: e.target.value }))}
                    data-testid="input-wage-spike-multiplier"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wage-spike-floor">Absolute floor</Label>
                  <Input
                    id="wage-spike-floor"
                    type="number"
                    min={0}
                    step={1}
                    value={spikeForm.minAbsolute}
                    onChange={(e) => setSpikeForm((s) => ({ ...s, minAbsolute: e.target.value }))}
                    data-testid="input-wage-spike-floor"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wage-spike-email">Email when ≥ (blank = no email)</Label>
                  <Input
                    id="wage-spike-email"
                    type="number"
                    min={1}
                    step={1}
                    value={spikeForm.emailWhenAbove}
                    onChange={(e) => setSpikeForm((s) => ({ ...s, emailWhenAbove: e.target.value }))}
                    data-testid="input-wage-spike-email"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Button
                  size="sm"
                  onClick={saveSpike}
                  disabled={upsertMutation.isPending}
                  data-testid="button-save-wage-spike"
                >
                  {upsertMutation.isPending ? "Saving…" : spikeOverride ? "Update override" : "Save override"}
                </Button>
                {spikeOverride && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => deleteMutation.mutate(spikeOverride.id)}
                    disabled={deleteMutation.isPending}
                    data-testid="button-reset-wage-spike"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                    Reset to default
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
