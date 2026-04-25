import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  PlayCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Task #1962 — Super Admin dashboard for the quarterly DOT pay-item
// refresh background job. Shows the most recent run (per-agency
// added/removed/changed deltas + which catalogs regressed below their
// `AGENCY_MIN_ITEMS` threshold), the previous ten runs, and a
// "Run now" button that hits the existing manual-trigger endpoint.

interface AgencyRecord {
  code: string;
  ok: boolean;
  itemCount: number;
  added: number | null;
  removed: number | null;
  changed: number | null;
  prevCount: number | null;
  wrote: boolean;
  reason: string | null;
}

interface RegressionRecord {
  code: string;
  itemCount: number;
  threshold: number;
  reason: "below_threshold" | "fetcher_failed";
  detail?: string;
}

interface RefreshRecord {
  ranAt: string;
  durationMs: number;
  result: {
    agenciesProcessed: number;
    successes: number;
    failures: number;
    regressions: number;
    alertsSent: number;
    agencies: AgencyRecord[];
    regressionDetails: RegressionRecord[];
  };
}

interface LastRunResponse {
  lastRun: RefreshRecord | null;
  recent: RefreshRecord[];
}

const LAST_RUN_KEY = ["/api/admin/jobs/dot_pay_items_refresh/last-run"] as const;

function formatDuration(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function deltaCell(value: number | null, kind: "added" | "removed" | "changed") {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value === 0) return <span className="tabular-nums">0</span>;
  const tone =
    kind === "added"
      ? "text-emerald-600 dark:text-emerald-400"
      : kind === "removed"
        ? "text-rose-600 dark:text-rose-400"
        : "text-amber-600 dark:text-amber-400";
  const sign = kind === "added" ? "+" : kind === "removed" ? "−" : "Δ";
  return (
    <span className={`tabular-nums font-medium ${tone}`}>
      {sign}
      {Math.abs(value)}
    </span>
  );
}

export default function DotPayItemsRefreshAdminPage() {
  const { toast } = useToast();
  const [expandedRunIdx, setExpandedRunIdx] = useState<number | null>(null);

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<LastRunResponse>({
    queryKey: LAST_RUN_KEY,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/admin/jobs/dot_pay_items_refresh/run",
      );
      return (await res.json()) as { durationMs?: number };
    },
    onSuccess: (body) => {
      toast({
        title: "DOT pay-item refresh complete",
        description: body?.durationMs
          ? `Finished in ${formatDuration(body.durationMs)}.`
          : "Run finished.",
      });
      queryClient.invalidateQueries({ queryKey: LAST_RUN_KEY });
    },
    onError: (err: unknown) => {
      toast({
        title: "Refresh failed",
        description:
          err instanceof Error
            ? err.message
            : "The manual run could not complete. Check the server logs.",
        variant: "destructive",
      });
    },
  });

  const lastRun = data?.lastRun ?? null;
  const recent = useMemo(() => data?.recent ?? [], [data?.recent]);
  const previousRuns = useMemo(() => recent.slice(1), [recent]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <title>DOT Pay-Item Refresh | Super Admin</title>
      <meta
        name="description"
        content="Recent runs of the quarterly DOT pay-item refresh job: per-agency added/removed/changed deltas, coverage regressions, and a manual re-run trigger."
      />

      <div className="flex flex-col gap-2">
        <Link href="/admin">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit -ml-2"
            data-testid="link-back-admin"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to admin
          </Button>
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1
              className="text-3xl font-bold tracking-tight"
              data-testid="heading-dot-pay-items-refresh"
            >
              DOT pay-item refresh
            </h1>
            <p className="text-muted-foreground max-w-3xl">
              Quarterly job that re-fetches every state DOT pay-item catalog,
              writes a new <code>data/dot-pay-items/&lt;agency&gt;.json</code>
              {" "}snapshot when the count clears its agency-specific threshold,
              and emails the on-call rotation when a catalog regresses. Runs
              automatically at 04:00 UTC on the 1st of January, April, July, and
              October.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching || runMutation.isPending}
              data-testid="button-refresh-history"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending}
              data-testid="button-run-now"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              <span className="ml-2">
                {runMutation.isPending ? "Running…" : "Run now"}
              </span>
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ) : !lastRun ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              No runs recorded yet
            </CardTitle>
            <CardDescription>
              The job hasn&apos;t run on this server yet, or no per-run sample
              has been persisted to <code>job_metric_samples</code>. Click{" "}
              <strong>Run now</strong> above to trigger a manual refresh.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <LastRunCard run={lastRun} />

          {previousRuns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Earlier runs
                  <Badge variant="secondary" data-testid="badge-recent-count">
                    {previousRuns.length}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Click a row to expand the per-agency deltas for that run.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table data-testid="table-recent-runs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Started</TableHead>
                        <TableHead className="text-right">Agencies</TableHead>
                        <TableHead className="text-right">Succeeded</TableHead>
                        <TableHead className="text-right">Failed</TableHead>
                        <TableHead className="text-right">Regressions</TableHead>
                        <TableHead className="text-right">Alerts</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previousRuns.map((run, idx) => {
                        const isOpen = expandedRunIdx === idx;
                        return (
                          <Fragment key={`run-${run.ranAt}-${idx}`}>
                            <TableRow
                              data-testid={`row-recent-run-${idx}`}
                              className="cursor-pointer"
                              onClick={() =>
                                setExpandedRunIdx(isOpen ? null : idx)
                              }
                            >
                              <TableCell>
                                <div className="flex flex-col">
                                  <span data-testid={`text-run-time-${idx}`}>
                                    {format(
                                      new Date(run.ranAt),
                                      "MMM d, yyyy h:mm a",
                                    )}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDistanceToNow(new Date(run.ranAt), {
                                      addSuffix: true,
                                    })}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {run.result.agenciesProcessed}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                                {run.result.successes}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {run.result.failures > 0 ? (
                                  <span className="text-rose-600 dark:text-rose-400 font-medium">
                                    {run.result.failures}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {run.result.regressions > 0 ? (
                                  <span className="text-amber-600 dark:text-amber-400 font-medium">
                                    {run.result.regressions}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {run.result.alertsSent}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatDuration(run.durationMs)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {isOpen ? "Hide" : "Show"}
                              </TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow
                                data-testid={`row-recent-run-detail-${idx}`}
                              >
                                <TableCell colSpan={8} className="bg-muted/30">
                                  <div className="py-3 space-y-3">
                                    {run.result.regressionDetails.length > 0 && (
                                      <RegressionList
                                        regressions={run.result.regressionDetails}
                                        idPrefix={`recent-${idx}`}
                                      />
                                    )}
                                    <AgencyTable
                                      agencies={run.result.agencies}
                                      idPrefix={`recent-${idx}`}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function LastRunCard({ run }: { run: RefreshRecord }) {
  return (
    <Card data-testid="card-last-run">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Last run
            </CardTitle>
            <CardDescription>
              <span data-testid="text-last-run-when">
                {format(new Date(run.ranAt), "MMM d, yyyy h:mm a")} (
                {formatDistanceToNow(new Date(run.ranAt), { addSuffix: true })})
              </span>{" "}
              · finished in{" "}
              <span data-testid="text-last-run-duration">
                {formatDuration(run.durationMs)}
              </span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryStat
            label="Agencies"
            value={run.result.agenciesProcessed}
            testid="stat-agencies"
          />
          <SummaryStat
            label="Succeeded"
            value={run.result.successes}
            tone="positive"
            testid="stat-succeeded"
          />
          <SummaryStat
            label="Failed"
            value={run.result.failures}
            tone={run.result.failures > 0 ? "negative" : undefined}
            testid="stat-failed"
          />
          <SummaryStat
            label="Regressions"
            value={run.result.regressions}
            tone={run.result.regressions > 0 ? "warning" : undefined}
            testid="stat-regressions"
          />
          <SummaryStat
            label="Alerts sent"
            value={run.result.alertsSent}
            testid="stat-alerts"
          />
        </div>

        {run.result.regressionDetails.length > 0 && (
          <RegressionList
            regressions={run.result.regressionDetails}
            idPrefix="last"
          />
        )}

        <AgencyTable agencies={run.result.agencies} idPrefix="last" />
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number;
  tone?: "positive" | "negative" | "warning";
  testid: string;
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : "";
  return (
    <div className="rounded-md border bg-card p-3" data-testid={testid}>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div
        className={`text-2xl font-semibold tabular-nums ${toneClass}`}
        data-testid={`${testid}-value`}
      >
        {value}
      </div>
    </div>
  );
}

function RegressionList({
  regressions,
  idPrefix,
}: {
  regressions: RegressionRecord[];
  idPrefix: string;
}) {
  return (
    <Alert
      variant="destructive"
      data-testid={`alert-regressions-${idPrefix}`}
      className="border-amber-500/40 text-amber-900 dark:text-amber-200 [&>svg]:text-amber-600"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        Coverage regression{regressions.length === 1 ? "" : "s"} detected
      </AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          {regressions.map((r, i) => (
            <li
              key={`reg-${idPrefix}-${r.code}-${i}`}
              data-testid={`text-regression-${idPrefix}-${r.code}`}
            >
              <span className="font-mono font-semibold">{r.code}</span>:{" "}
              {r.reason === "fetcher_failed" ? (
                <>fetcher failed{r.detail ? ` — ${r.detail}` : ""}</>
              ) : (
                <>
                  {r.itemCount} items (below threshold of {r.threshold})
                </>
              )}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function AgencyTable({
  agencies,
  idPrefix,
}: {
  agencies: AgencyRecord[];
  idPrefix: string;
}) {
  if (agencies.length === 0) {
    return (
      <div
        className="text-sm text-muted-foreground"
        data-testid={`text-no-agencies-${idPrefix}`}
      >
        No per-agency detail recorded for this run.
      </div>
    );
  }
  const sorted = [...agencies].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="overflow-x-auto">
      <Table data-testid={`table-agencies-${idPrefix}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Agency</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Items</TableHead>
            <TableHead className="text-right">Prev</TableHead>
            <TableHead className="text-right">Added</TableHead>
            <TableHead className="text-right">Removed</TableHead>
            <TableHead className="text-right">Changed</TableHead>
            <TableHead>Snapshot</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((a) => (
            <TableRow
              key={`${idPrefix}-${a.code}`}
              data-testid={`row-agency-${idPrefix}-${a.code}`}
            >
              <TableCell className="font-mono font-semibold">
                {a.code}
              </TableCell>
              <TableCell>
                {a.ok ? (
                  <Badge
                    variant="outline"
                    className="text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
                    data-testid={`badge-status-${idPrefix}-${a.code}`}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    OK
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-rose-700 dark:text-rose-300 border-rose-500/40"
                    data-testid={`badge-status-${idPrefix}-${a.code}`}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {a.itemCount}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {a.prevCount === null ? "—" : a.prevCount}
              </TableCell>
              <TableCell className="text-right">
                {deltaCell(a.added, "added")}
              </TableCell>
              <TableCell className="text-right">
                {deltaCell(a.removed, "removed")}
              </TableCell>
              <TableCell className="text-right">
                {deltaCell(a.changed, "changed")}
              </TableCell>
              <TableCell>
                {a.wrote ? (
                  <Badge variant="secondary">Wrote</Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-muted-foreground"
                    data-testid={`badge-skipped-${idPrefix}-${a.code}`}
                  >
                    Skipped
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[20rem] truncate">
                {a.reason || ""}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
