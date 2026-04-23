import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, Cake, XCircle, Activity, BarChart3, Play, ListChecks, FileStack } from "lucide-react";
import { useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  const [cpOrgId, setCpOrgId] = useState("");
  const [cpDryRun, setCpDryRun] = useState(false);
  const [cpClearLedger, setCpClearLedger] = useState(false);
  const [cpLastResult, setCpLastResult] = useState<{
    inserted: number;
    alreadyPresent: number;
    missingPayRun: number;
    orgsScanned: number;
    durationMs: number;
    dryRun: boolean;
    ledgerCleared: boolean;
    orgFilter: string | null;
    skippedReason?: string;
  } | null>(null);

  const certifiedPayrollBackfillMutation = useMutation({
    mutationFn: async (input: { orgId: string; dryRun: boolean; clearLedger: boolean }) => {
      const res = await apiRequest("POST", "/api/admin/jobs/certified-payroll-backfill/run", {
        orgId: input.orgId.trim() || undefined,
        dryRun: input.dryRun,
        clearLedger: input.clearLedger,
      });
      return (await res.json()) as {
        job: string;
        durationMs: number;
        ledgerCleared: boolean;
        orgFilter: string | null;
        dryRun: boolean;
        stats: {
          inserted: number;
          alreadyPresent: number;
          missingPayRun: number;
          orgsScanned: number;
          skippedReason?: string;
        };
      };
    },
    onSuccess: (data) => {
      setCpLastResult({
        inserted: data.stats.inserted,
        alreadyPresent: data.stats.alreadyPresent,
        missingPayRun: data.stats.missingPayRun,
        orgsScanned: data.stats.orgsScanned,
        durationMs: data.durationMs,
        dryRun: data.dryRun,
        ledgerCleared: data.ledgerCleared,
        orgFilter: data.orgFilter,
        skippedReason: data.stats.skippedReason,
      });
      toast({
        title: data.dryRun ? "Backfill dry-run complete" : "Certified payroll backfill complete",
        description:
          data.stats.skippedReason === "no_private_dir"
            ? "Object storage not configured (PRIVATE_OBJECT_DIR unset). No files scanned."
            : `Inserted ${data.stats.inserted}, already present ${data.stats.alreadyPresent}, ` +
              `missing pay run ${data.stats.missingPayRun}, orgs scanned ${data.stats.orgsScanned} ` +
              `in ${data.durationMs}ms.`,
      });
    },
    onError: (err: unknown) => {
      const description =
        err instanceof Error ? err.message : "An unexpected error occurred. Check server logs.";
      toast({
        title: "Failed to run certified payroll backfill",
        description,
        variant: "destructive",
      });
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

      <Card data-testid="card-certified-payroll-backfill">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileStack className="h-4 w-4" /> Certified payroll backfill
          </CardTitle>
          <CardDescription>
            Re-run the post-deploy certified payroll PDF backfill. Use this if a tenant
            uploaded legacy PDFs after the original run, or if the post-deploy run
            failed for some org. Optionally scope to a single organization, do a
            dry-run, or clear the one-shot ledger flag so the next deploy will also
            re-run automatically. Super Admin only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cp-backfill-org">Organization ID (optional)</Label>
              <Input
                id="cp-backfill-org"
                placeholder="Leave blank to scan all orgs"
                value={cpOrgId}
                onChange={(e) => setCpOrgId(e.target.value)}
                disabled={certifiedPayrollBackfillMutation.isPending}
                data-testid="input-cp-backfill-org"
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cp-backfill-dry-run"
                  checked={cpDryRun}
                  onCheckedChange={(v) => setCpDryRun(v === true)}
                  disabled={certifiedPayrollBackfillMutation.isPending}
                  data-testid="checkbox-cp-backfill-dry-run"
                />
                <Label htmlFor="cp-backfill-dry-run" className="cursor-pointer">
                  Dry run (no inserts)
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cp-backfill-clear-ledger"
                  checked={cpClearLedger}
                  onCheckedChange={(v) => setCpClearLedger(v === true)}
                  disabled={certifiedPayrollBackfillMutation.isPending}
                  data-testid="checkbox-cp-backfill-clear-ledger"
                />
                <Label htmlFor="cp-backfill-clear-ledger" className="cursor-pointer">
                  Clear one-shot ledger
                </Label>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Button
              onClick={() =>
                certifiedPayrollBackfillMutation.mutate({
                  orgId: cpOrgId,
                  dryRun: cpDryRun,
                  clearLedger: cpClearLedger,
                })
              }
              disabled={certifiedPayrollBackfillMutation.isPending}
              data-testid="button-run-cp-backfill"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${
                  certifiedPayrollBackfillMutation.isPending ? "animate-spin" : ""
                }`}
              />
              {certifiedPayrollBackfillMutation.isPending
                ? "Running…"
                : "Run backfill now"}
            </Button>
            {cpLastResult && (
              <div className="text-sm text-muted-foreground" data-testid="text-cp-backfill-last-result">
                Last run:{" "}
                {cpLastResult.skippedReason === "no_private_dir" ? (
                  <span data-testid="text-cp-backfill-skipped">
                    skipped (object storage not configured)
                  </span>
                ) : (
                  <>
                    inserted{" "}
                    <span className="font-medium" data-testid="text-cp-backfill-inserted">
                      {cpLastResult.inserted}
                    </span>
                    , already present{" "}
                    <span className="font-medium" data-testid="text-cp-backfill-already-present">
                      {cpLastResult.alreadyPresent}
                    </span>
                    , missing pay run{" "}
                    <span className="font-medium" data-testid="text-cp-backfill-missing-payrun">
                      {cpLastResult.missingPayRun}
                    </span>
                    , orgs scanned{" "}
                    <span className="font-medium" data-testid="text-cp-backfill-orgs-scanned">
                      {cpLastResult.orgsScanned}
                    </span>{" "}
                    in {cpLastResult.durationMs}ms
                    {cpLastResult.dryRun ? " (dry run)" : ""}
                    {cpLastResult.orgFilter ? ` · org=${cpLastResult.orgFilter}` : ""}
                    {cpLastResult.ledgerCleared ? " · ledger cleared" : ""}
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
