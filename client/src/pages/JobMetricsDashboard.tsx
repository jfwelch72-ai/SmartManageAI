import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, XCircle, Activity } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
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

const ALL_JOBS_KEY = ["/api/admin/metrics/jobs"] as const;
const REFRESH_INTERVAL_MS = 60_000;
const BUCKET_COUNT = 24;
const BUCKET_MS = 60 * 60 * 1000;

const COUNTER_PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h${m ? ` ${m}m` : ""}`;
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

function bucketSamples(samples: JobMetricSample[], counters: string[]) {
  const now = Date.now();
  const windowMs = BUCKET_COUNT * BUCKET_MS;
  const start = now - windowMs;
  const buckets: Array<Record<string, number | string>> = [];
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const bucketStart = start + i * BUCKET_MS;
    const row: Record<string, number | string> = {
      ts: bucketStart,
      label: new Date(bucketStart).getHours().toString().padStart(2, "0") + ":00",
    };
    for (const c of counters) row[c] = 0;
    buckets.push(row);
  }
  for (const s of samples) {
    if (s.timestamp < start) continue;
    const idx = Math.min(
      BUCKET_COUNT - 1,
      Math.floor((s.timestamp - start) / BUCKET_MS),
    );
    for (const c of counters) {
      const v = s.counters[c];
      if (typeof v === "number") {
        buckets[idx][c] = (buckets[idx][c] as number) + v;
      }
    }
  }
  return buckets;
}

function counterKeys(job: JobMetricsResponse): string[] {
  const set = new Set<string>();
  for (const k of Object.keys(job.totals)) set.add(k);
  for (const s of job.samples) for (const k of Object.keys(s.counters)) set.add(k);
  return Array.from(set).sort();
}

function JobCard({ job }: { job: JobMetricsResponse }) {
  const counters = useMemo(() => counterKeys(job), [job]);
  const chartData = useMemo(() => bucketSamples(job.samples, counters), [job, counters]);
  const sampleCount = job.samples.length;

  return (
    <Card data-testid={`card-job-${job.job}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle
              className="flex items-center gap-2 font-mono text-base"
              data-testid={`text-job-name-${job.job}`}
            >
              <Activity className="h-4 w-4" /> {job.job}
            </CardTitle>
            <CardDescription>
              Window: {formatDuration(job.windowMs)} · Samples:{" "}
              <span data-testid={`text-sample-count-${job.job}`}>{sampleCount}</span> · Last tick:{" "}
              <span data-testid={`text-last-tick-${job.job}`}>
                {formatRelative(job.latest?.timestamp ?? null)}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {counters.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid={`text-no-counters-${job.job}`}
          >
            No counters recorded yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
              {counters.map((c, idx) => (
                <div key={c} data-testid={`stat-${job.job}-${c}`}>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: COUNTER_PALETTE[idx % COUNTER_PALETTE.length] }}
                    />
                    {c}
                  </div>
                  <div
                    className="font-medium text-lg"
                    data-testid={`text-total-${job.job}-${c}`}
                  >
                    {job.totals[c] ?? 0}
                  </div>
                  {job.latest && (
                    <div
                      className="text-xs text-muted-foreground"
                      data-testid={`text-latest-${job.job}-${c}`}
                    >
                      Last tick: {job.latest.counters[c] ?? 0}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {sampleCount === 0 ? (
              <div
                className="h-32 flex items-center justify-center text-sm text-muted-foreground border rounded-md"
                data-testid={`text-no-samples-${job.job}`}
              >
                No samples in the last 24h.
              </div>
            ) : (
              <div className="h-32 w-full" data-testid={`chart-${job.job}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval={3}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      allowDecimals={false}
                      width={28}
                      stroke="currentColor"
                      className="text-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      labelFormatter={(label) => `Hour ${label}`}
                    />
                    {counters.map((c, idx) => (
                      <Line
                        key={c}
                        type="monotone"
                        dataKey={c}
                        name={c}
                        stroke={COUNTER_PALETTE[idx % COUNTER_PALETTE.length]}
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function JobMetricsDashboard() {
  const { data, isLoading, isError, refetch, isFetching, dataUpdatedAt } =
    useQuery<JobsListResponse>({
      queryKey: ALL_JOBS_KEY,
      refetchInterval: REFRESH_INTERVAL_MS,
    });

  const jobs = (data?.jobs ?? []).slice().sort((a, b) => a.job.localeCompare(b.job));

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
              Job metrics dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Rolling 24h trend of counters published by background jobs via{" "}
              <code>recordJobMetrics</code>. Auto-refreshes every minute.
              {dataUpdatedAt > 0 && (
                <>
                  {" "}Updated {formatRelative(dataUpdatedAt)}.
                </>
              )}
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

      {isLoading && !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <Card data-testid="card-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No jobs have published metrics yet. Once a background job calls{" "}
            <code>recordJobMetrics</code>, it will appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2" data-testid="grid-jobs">
          {jobs.map((job) => (
            <JobCard key={job.job} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
