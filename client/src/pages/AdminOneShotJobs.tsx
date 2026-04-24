import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, Trash2, ListChecks, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface OneShotJobRecentRun {
  id: string;
  at: string;
  actorId: string;
  actorEmail: string | null;
  status: string | null;
  ledgerCleared: boolean | null;
  durationMs: number | null;
  error: string | null;
  raw: string | null;
}

interface OneShotJob {
  name: string;
  title: string;
  description: string;
  registered: boolean;
  completedAt: string | null;
  details: Record<string, unknown> | null;
  recentRuns?: OneShotJobRecentRun[];
}

interface OneShotJobsResponse {
  jobs: OneShotJob[];
}

interface RerunOutcome {
  job: string;
  status: string;
  ledgerCleared: boolean;
  durationMs: number;
  details: Record<string, unknown> | null;
  error: string | null;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "skipped_already_complete") return "secondary";
  if (status === "failed" || status === "bookkeeping_error") return "destructive";
  return "outline";
}

function JobCard({ job }: { job: OneShotJob }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const rerun = useMutation({
    mutationFn: async (): Promise<RerunOutcome> => {
      const res = await apiRequest(
        "POST",
        `/api/admin/jobs/one-shot/${encodeURIComponent(job.name)}/rerun`,
      );
      return (await res.json()) as RerunOutcome;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/jobs/one-shot"] });
      if (data.status === "completed") {
        toast({
          title: "Job re-run complete",
          description: `${job.title} finished in ${data.durationMs}ms.`,
        });
      } else if (data.status === "skipped_already_complete") {
        toast({
          title: "Job skipped",
          description: "Ledger row was re-created before the runner could clear it.",
        });
      } else {
        toast({
          title: "Job re-run failed",
          description: data.error ?? `Status: ${data.status}`,
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to re-run job",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const detailEntries = job.details ? Object.entries(job.details) : [];

  return (
    <Card data-testid={`card-one-shot-${job.name}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle
              className="flex items-center gap-2 text-base"
              data-testid={`text-one-shot-title-${job.name}`}
            >
              {job.title}
              {!job.registered && (
                <Badge variant="outline" data-testid={`badge-unregistered-${job.name}`}>
                  unregistered
                </Badge>
              )}
            </CardTitle>
            <CardDescription data-testid={`text-one-shot-description-${job.name}`}>
              {job.description}
            </CardDescription>
            <p
              className="text-xs text-muted-foreground font-mono pt-1"
              data-testid={`text-one-shot-name-${job.name}`}
            >
              {job.name}
            </p>
          </div>
          <Button
            onClick={() => rerun.mutate()}
            disabled={rerun.isPending || !job.registered}
            variant={job.registered ? "default" : "secondary"}
            data-testid={`button-rerun-one-shot-${job.name}`}
          >
            {job.registered ? (
              <>
                <RefreshCw
                  className={`h-4 w-4 mr-1 ${rerun.isPending ? "animate-spin" : ""}`}
                />
                {rerun.isPending ? "Running…" : "Clear ledger & re-run"}
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-1" /> Unavailable
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Last completed:</span>
          <span
            className="font-medium"
            data-testid={`text-one-shot-completed-${job.name}`}
          >
            {formatTimestamp(job.completedAt)}
          </span>
        </div>
        {detailEntries.length > 0 && (
          <div
            className="rounded-md border bg-muted/40 p-3"
            data-testid={`details-one-shot-${job.name}`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Last run details
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono">
              {detailEntries.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-2">
                  <dt className="text-muted-foreground truncate">{key}</dt>
                  <dd className="text-right break-all">
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {job.recentRuns && job.recentRuns.length > 0 && (
          <div
            className="rounded-md border p-3"
            data-testid={`history-one-shot-${job.name}`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Recent manual re-runs
            </div>
            <ul className="space-y-1.5 text-xs">
              {job.recentRuns.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1"
                  data-testid={`history-row-${job.name}-${run.id}`}
                >
                  <span
                    className="font-medium tabular-nums"
                    data-testid={`history-at-${run.id}`}
                  >
                    {formatTimestamp(run.at)}
                  </span>
                  <span
                    className="text-muted-foreground"
                    data-testid={`history-actor-${run.id}`}
                  >
                    {run.actorEmail ?? run.actorId}
                  </span>
                  {run.status ? (
                    <Badge
                      variant={statusBadgeVariant(run.status)}
                      data-testid={`history-status-${run.id}`}
                    >
                      {run.status}
                    </Badge>
                  ) : (
                    <Badge variant="outline">unknown</Badge>
                  )}
                  {run.durationMs !== null && (
                    <span
                      className="text-muted-foreground tabular-nums"
                      data-testid={`history-duration-${run.id}`}
                    >
                      {run.durationMs}ms
                    </span>
                  )}
                  {run.ledgerCleared !== null && (
                    <span className="text-muted-foreground">
                      ledger cleared: {run.ledgerCleared ? "yes" : "no"}
                    </span>
                  )}
                  {run.error && (
                    <span className="text-destructive break-all">
                      — {run.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {rerun.data && (
          <div
            className="flex items-center gap-2 text-xs"
            data-testid={`text-one-shot-last-run-${job.name}`}
          >
            <span className="text-muted-foreground">Manual re-run:</span>
            <Badge variant={statusBadgeVariant(rerun.data.status)}>
              {rerun.data.status}
            </Badge>
            <span className="text-muted-foreground">
              ledger cleared: {rerun.data.ledgerCleared ? "yes" : "no"} ·{" "}
              {rerun.data.durationMs}ms
            </span>
            {rerun.data.error && (
              <span className="text-destructive">— {rerun.data.error}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminOneShotJobs() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    OneShotJobsResponse
  >({
    queryKey: ["/api/admin/jobs/one-shot"],
  });

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin">
            <Button variant="ghost" size="sm" data-testid="link-back-admin">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to admin
            </Button>
          </Link>
          <h1
            className="text-2xl font-semibold flex items-center gap-2 mt-2"
            data-testid="heading-one-shot-jobs"
          >
            <ListChecks className="h-6 w-6" /> One-shot jobs
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Post-deploy backfills that should run exactly once per environment.
            Each row reflects the current `one_shot_jobs` ledger entry. Use
            "Clear ledger &amp; re-run" to re-execute a job — for example after a
            third-party outage, a staging re-test, or to backfill data after a
            schema change.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-one-shot-jobs"
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive" data-testid="alert-one-shot-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load one-shot jobs</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-4" data-testid="loading-one-shot-jobs">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!isLoading && data && data.jobs.length === 0 && (
        <Card data-testid="card-empty-one-shot-jobs">
          <CardContent className="py-10 text-center text-muted-foreground">
            No one-shot jobs are registered in this build.
          </CardContent>
        </Card>
      )}

      {!isLoading && data && data.jobs.length > 0 && (
        <div className="space-y-4" data-testid="list-one-shot-jobs">
          {data.jobs.map((job) => (
            <JobCard key={job.name} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
