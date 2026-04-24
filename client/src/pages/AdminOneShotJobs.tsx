import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  ListChecks,
  AlertCircle,
  Settings2,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";

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

type OneShotJobParameter =
  | {
      name: string;
      label: string;
      description?: string;
      type: "string";
      default?: string;
      placeholder?: string;
    }
  | {
      name: string;
      label: string;
      description?: string;
      type: "boolean";
      default?: boolean;
    };

interface OneShotJob {
  name: string;
  title: string;
  description: string;
  registered: boolean;
  parameters?: OneShotJobParameter[];
  completedAt: string | null;
  details: Record<string, unknown> | null;
  lastSuccessAt: string | null;
  failureCountLast7d: number;
  avgDurationMs: number | null;
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
  params?: Record<string, unknown>;
}

function buildInitialParamValues(
  parameters: OneShotJobParameter[] | undefined,
): Record<string, string | boolean> {
  const initial: Record<string, string | boolean> = {};
  for (const p of parameters ?? []) {
    if (p.type === "boolean") {
      initial[p.name] = p.default ?? false;
    } else {
      initial[p.name] = p.default ?? "";
    }
  }
  return initial;
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

const DEFAULT_RECENT_LIMIT = 5;
const EXPANDED_RECENT_LIMIT = 25;

function JobCard({
  job,
  expanded,
  onToggleExpanded,
  filtersActive,
}: {
  job: OneShotJob;
  expanded: boolean;
  onToggleExpanded: () => void;
  filtersActive: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [paramValues, setParamValues] = useState<Record<string, string | boolean>>(
    () => buildInitialParamValues(job.parameters),
  );

  const hasParams = (job.parameters?.length ?? 0) > 0;

  const rerun = useMutation({
    mutationFn: async (): Promise<RerunOutcome> => {
      const body = hasParams ? { params: paramValues } : undefined;
      const res = await apiRequest(
        "POST",
        `/api/admin/jobs/one-shot/${encodeURIComponent(job.name)}/rerun`,
        body,
      );
      return (await res.json()) as RerunOutcome;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/jobs/one-shot"], exact: false });
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
        {hasParams && job.registered && (
          <div
            className="rounded-md border bg-muted/30 p-3 space-y-3"
            data-testid={`params-one-shot-${job.name}`}
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" /> Run options
            </div>
            {job.parameters!.map((param) => {
              const inputId = `param-${job.name}-${param.name}`;
              if (param.type === "boolean") {
                const checked = paramValues[param.name] === true;
                return (
                  <div key={param.name} className="flex items-start gap-2">
                    <Checkbox
                      id={inputId}
                      checked={checked}
                      onCheckedChange={(value) =>
                        setParamValues((prev) => ({
                          ...prev,
                          [param.name]: value === true,
                        }))
                      }
                      data-testid={`checkbox-param-${job.name}-${param.name}`}
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor={inputId} className="text-sm font-medium">
                        {param.label}
                      </Label>
                      {param.description && (
                        <p className="text-xs text-muted-foreground">
                          {param.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              }
              const value =
                typeof paramValues[param.name] === "string"
                  ? (paramValues[param.name] as string)
                  : "";
              return (
                <div key={param.name} className="space-y-1">
                  <Label htmlFor={inputId} className="text-sm font-medium">
                    {param.label}
                  </Label>
                  {param.description && (
                    <p className="text-xs text-muted-foreground">
                      {param.description}
                    </p>
                  )}
                  <Input
                    id={inputId}
                    value={value}
                    placeholder={param.placeholder}
                    onChange={(e) =>
                      setParamValues((prev) => ({
                        ...prev,
                        [param.name]: e.target.value,
                      }))
                    }
                    data-testid={`input-param-${job.name}-${param.name}`}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Last completed:</span>
          <span
            className="font-medium"
            data-testid={`text-one-shot-completed-${job.name}`}
          >
            {formatTimestamp(job.completedAt)}
          </span>
        </div>
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border bg-muted/20 p-3 text-xs"
          data-testid={`aggregates-one-shot-${job.name}`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="uppercase tracking-wide text-muted-foreground">
              Last successful run
            </span>
            <span
              className="font-medium tabular-nums"
              data-testid={`text-one-shot-last-success-${job.name}`}
            >
              {formatTimestamp(job.lastSuccessAt)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="uppercase tracking-wide text-muted-foreground">
              Failures (7d)
            </span>
            <span
              className="font-medium tabular-nums flex items-center gap-1.5"
              data-testid={`text-one-shot-failures-7d-${job.name}`}
            >
              {job.failureCountLast7d}
              {job.failureCountLast7d > 0 && (
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  needs triage
                </Badge>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="uppercase tracking-wide text-muted-foreground">
              Avg duration (success)
            </span>
            <span
              className="font-medium tabular-nums"
              data-testid={`text-one-shot-avg-duration-${job.name}`}
            >
              {job.avgDurationMs === null ? "—" : `${job.avgDurationMs}ms`}
            </span>
          </div>
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
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Recent manual re-runs{filtersActive ? " (filtered)" : ""}
              </div>
              <span
                className="text-xs text-muted-foreground tabular-nums"
                data-testid={`history-count-${job.name}`}
              >
                {expanded
                  ? `showing ${job.recentRuns.length}`
                  : `showing ${Math.min(
                      job.recentRuns.length,
                      DEFAULT_RECENT_LIMIT,
                    )} of ${job.recentRuns.length}`}
              </span>
            </div>
            <ul className="space-y-1.5 text-xs">
              {(expanded
                ? job.recentRuns
                : job.recentRuns.slice(0, DEFAULT_RECENT_LIMIT)
              ).map((run) => (
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
            {job.recentRuns.length > DEFAULT_RECENT_LIMIT && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                onClick={onToggleExpanded}
                data-testid={`button-show-more-${job.name}`}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5 mr-1" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5 mr-1" /> Show more
                  </>
                )}
              </Button>
            )}
            {!expanded &&
              job.recentRuns.length === DEFAULT_RECENT_LIMIT && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 px-2 text-xs"
                  onClick={onToggleExpanded}
                  data-testid={`button-show-more-${job.name}`}
                >
                  <ChevronDown className="h-3.5 w-3.5 mr-1" /> Show more (load up
                  to {EXPANDED_RECENT_LIMIT})
                </Button>
              )}
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
  // Draft state for the filter inputs (debounced into `applied` on submit so
  // we don't refetch on every keystroke). Only `applied` is wired into the
  // query key.
  const [actorEmailDraft, setActorEmailDraft] = useState("");
  const [sinceDraft, setSinceDraft] = useState("");
  const [applied, setApplied] = useState<{
    actorEmail: string;
    since: string;
  }>({ actorEmail: "", since: "" });
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const anyExpanded = expandedJobs.size > 0;

  const sinceIso = useMemo(() => {
    if (!applied.since) return "";
    const parsed = new Date(applied.since);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }, [applied.since]);

  const queryParams = {
    actorEmail: applied.actorEmail || undefined,
    since: sinceIso || undefined,
    limit: anyExpanded ? EXPANDED_RECENT_LIMIT : undefined,
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    OneShotJobsResponse
  >({
    queryKey: ["/api/admin/jobs/one-shot", queryParams],
  });

  const filtersActive = Boolean(applied.actorEmail || applied.since);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied({
      actorEmail: actorEmailDraft.trim(),
      since: sinceDraft.trim(),
    });
  };

  const handleClearFilters = () => {
    setActorEmailDraft("");
    setSinceDraft("");
    setApplied({ actorEmail: "", since: "" });
  };

  const toggleExpanded = (jobName: string) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobName)) {
        next.delete(jobName);
      } else {
        next.add(jobName);
      }
      return next;
    });
  };

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

      <form
        onSubmit={handleApplyFilters}
        className="rounded-md border bg-muted/30 p-3 flex flex-wrap items-end gap-3"
        data-testid="form-one-shot-filters"
      >
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="filter-actor-email"
            className="text-xs text-muted-foreground"
          >
            Actor email contains
          </Label>
          <Input
            id="filter-actor-email"
            type="text"
            value={actorEmailDraft}
            onChange={(e) => setActorEmailDraft(e.target.value)}
            placeholder="alice@example.com"
            className="h-8 w-64"
            data-testid="input-filter-actor-email"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="filter-since"
            className="text-xs text-muted-foreground"
          >
            Since
          </Label>
          <Input
            id="filter-since"
            type="datetime-local"
            value={sinceDraft}
            onChange={(e) => setSinceDraft(e.target.value)}
            className="h-8 w-56"
            data-testid="input-filter-since"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            data-testid="button-apply-filters"
          >
            Apply filters
          </Button>
          {filtersActive && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              data-testid="button-clear-filters"
            >
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          )}
        </div>
        {filtersActive && (
          <span
            className="text-xs text-muted-foreground"
            data-testid="text-filters-active"
          >
            Filtering re-run history
            {applied.actorEmail ? ` by actor "${applied.actorEmail}"` : ""}
            {applied.since ? ` since ${applied.since}` : ""}
          </span>
        )}
      </form>

      {!isLoading && data && data.jobs.length > 0 && (
        <div className="space-y-4" data-testid="list-one-shot-jobs">
          {data.jobs.map((job) => (
            <JobCard
              key={job.name}
              job={job}
              expanded={expandedJobs.has(job.name)}
              onToggleExpanded={() => toggleExpanded(job.name)}
              filtersActive={filtersActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}
