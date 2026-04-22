import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Mic, Play, AlertTriangle, CheckCircle2, RefreshCw, ChevronDown, ChevronRight, History } from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";

interface BackfillJob {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recordingId: string; error: string }>;
  startedAt: string;
  completedAt: string | null;
}

interface BackfillHistoryEntry extends BackfillJob {
  startedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

interface BackfillHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  jobs: BackfillHistoryEntry[];
}

interface BackfillSummary {
  pending: number;
  activeJob: BackfillJob | null;
}

const SUMMARY_KEY = ["/api/crm/calls/transcripts/backfill"];
const HISTORY_KEY = ["/api/crm/calls/transcripts/backfill/history"];

export default function AdminTranscriptBackfillPage() {
  const { toast } = useToast();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [maxRecords, setMaxRecords] = useState<string>("");
  const [concurrency, setConcurrency] = useState<string>("2");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  const summaryQuery = useQuery<BackfillSummary>({
    queryKey: SUMMARY_KEY,
    refetchInterval: activeJobId ? false : 10_000,
  });

  // Resume polling an in-flight job after a page reload.
  useEffect(() => {
    if (!activeJobId && summaryQuery.data?.activeJob) {
      setActiveJobId(summaryQuery.data.activeJob.id);
    }
  }, [activeJobId, summaryQuery.data?.activeJob]);

  const jobQuery = useQuery<BackfillJob>({
    queryKey: ["/api/crm/calls/transcripts/backfill", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const data = query.state.data as BackfillJob | undefined;
      if (!data) return 2000;
      return data.status === "RUNNING" ? 2000 : false;
    },
  });

  // When a job finishes, refresh the pending count and history list.
  useEffect(() => {
    const status = jobQuery.data?.status;
    if (status && status !== "RUNNING") {
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    }
  }, [jobQuery.data?.status]);

  const historyQuery = useQuery<BackfillHistoryResponse>({
    queryKey: HISTORY_KEY,
    refetchInterval: activeJobId ? 5_000 : 30_000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const body: { maxRecords?: number; concurrency?: number } = {};
      const max = parseInt(maxRecords, 10);
      if (Number.isFinite(max) && max > 0) body.maxRecords = max;
      const c = parseInt(concurrency, 10);
      if (Number.isFinite(c) && c > 0) body.concurrency = c;
      const res = await apiRequest("POST", "/api/crm/calls/transcripts/backfill", body);
      return (await res.json()) as { jobId: string; total: number; message?: string };
    },
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      toast({
        title: "Backfill started",
        description: data.message ?? `Processing ${data.total} recording${data.total === 1 ? "" : "s"}.`,
      });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start backfill", description: err.message, variant: "destructive" });
    },
  });

  const pending = summaryQuery.data?.pending ?? 0;
  const job = jobQuery.data ?? summaryQuery.data?.activeJob ?? null;
  const isRunning = job?.status === "RUNNING";
  const progressPct = job && job.total > 0 ? Math.min(100, (job.processed / job.total) * 100) : 0;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="heading-transcript-backfill">
          <Mic className="h-6 w-6" />
          Transcript Backfill
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate Whisper transcripts for any call recordings that are missing them.
        </p>
      </div>

      <Card data-testid="card-pending">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Recordings missing transcripts</CardTitle>
              <CardDescription>
                Calls in PENDING or FAILED state with no stored transcript.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => summaryQuery.refetch()}
              disabled={summaryQuery.isFetching}
              data-testid="button-refresh-pending"
            >
              {summaryQuery.isFetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="status-loading-pending" />
          ) : summaryQuery.isError ? (
            <div className="text-sm text-destructive" data-testid="text-pending-error">
              Failed to load pending count.
            </div>
          ) : (
            <div className="text-4xl font-semibold tabular-nums" data-testid="text-pending-count">
              {pending.toLocaleString()}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-controls">
        <CardHeader className="pb-3">
          <CardTitle>Run a backfill</CardTitle>
          <CardDescription>
            Leave the limit blank to process every eligible recording. Concurrency caps how many
            transcriptions run in parallel (max 4).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="max-records" className="text-xs">Max records (optional)</Label>
              <Input
                id="max-records"
                type="number"
                min={1}
                placeholder="All eligible"
                value={maxRecords}
                onChange={(e) => setMaxRecords(e.target.value)}
                data-testid="input-max-records"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="concurrency" className="text-xs">Concurrency (1–4)</Label>
              <Input
                id="concurrency"
                type="number"
                min={1}
                max={4}
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
                data-testid="input-concurrency"
              />
            </div>
          </div>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || isRunning || pending === 0}
            data-testid="button-start-backfill"
          >
            {startMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {isRunning ? "Backfill running…" : "Start backfill"}
          </Button>
          {pending === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground" data-testid="text-no-pending">
              Nothing to backfill — all recordings already have transcripts.
            </p>
          )}
        </CardContent>
      </Card>

      {job && (
        <Card data-testid="card-progress">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Job progress
                  <Badge
                    variant={
                      job.status === "RUNNING"
                        ? "secondary"
                        : job.status === "COMPLETED"
                        ? "default"
                        : "destructive"
                    }
                    data-testid="badge-job-status"
                  >
                    {job.status === "RUNNING" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    {job.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {job.status === "FAILED" && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {job.status}
                  </Badge>
                </CardTitle>
                <CardDescription data-testid="text-job-id">
                  Job <code className="text-xs">{job.id}</code> · started{" "}
                  {format(new Date(job.startedAt), "PPpp")}
                  {job.completedAt && (
                    <> · finished {format(new Date(job.completedAt), "PPpp")}</>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Progress value={progressPct} data-testid="progress-bar" />
              <div className="text-xs text-muted-foreground" data-testid="text-progress-summary">
                {job.processed.toLocaleString()} of {job.total.toLocaleString()} processed
                ({progressPct.toFixed(0)}%)
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Processed" value={job.processed} testId="stat-processed" />
              <Stat label="Succeeded" value={job.succeeded} testId="stat-succeeded" tone="success" />
              <Stat label="Failed" value={job.failed} testId="stat-failed" tone="error" />
            </div>
            {job.errors.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">Recent error samples ({job.errors.length})</Label>
                <ScrollArea className="h-[200px] rounded-md border p-3">
                  <ul className="space-y-2 text-xs font-mono" data-testid="list-errors">
                    {job.errors.map((err, i) => (
                      <li key={`${err.recordingId}-${i}`} data-testid={`error-${i}`}>
                        <span className="text-muted-foreground">{err.recordingId}:</span>{" "}
                        <span className="text-destructive">{err.error}</span>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-history">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Backfill history
              </CardTitle>
              <CardDescription>
                Recent transcript backfill runs for this organization. Click a row to view error samples.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => historyQuery.refetch()}
              disabled={historyQuery.isFetching}
              data-testid="button-refresh-history"
            >
              {historyQuery.isFetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="status-loading-history" />
          ) : historyQuery.isError ? (
            <div className="text-sm text-destructive" data-testid="text-history-error">
              Failed to load backfill history.
            </div>
          ) : !historyQuery.data || historyQuery.data.jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-history-empty">
              No backfill runs yet.
            </div>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="list-history">
              {historyQuery.data.jobs.map((entry) => {
                const isExpanded = expandedHistoryId === entry.id;
                const operatorName = formatOperator(entry.startedBy);
                const duration = entry.completedAt
                  ? formatDistanceStrict(new Date(entry.completedAt), new Date(entry.startedAt))
                  : null;
                return (
                  <li key={entry.id} data-testid={`history-row-${entry.id}`}>
                    <button
                      type="button"
                      className="w-full text-left p-3 hover-elevate active-elevate-2 flex items-start gap-3"
                      onClick={() => setExpandedHistoryId(isExpanded ? null : entry.id)}
                      data-testid={`button-history-toggle-${entry.id}`}
                    >
                      <div className="pt-0.5">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              entry.status === "RUNNING"
                                ? "secondary"
                                : entry.status === "COMPLETED"
                                ? "default"
                                : "destructive"
                            }
                            data-testid={`badge-history-status-${entry.id}`}
                          >
                            {entry.status === "RUNNING" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {entry.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {entry.status === "FAILED" && <AlertTriangle className="h-3 w-3 mr-1" />}
                            {entry.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground" data-testid={`text-history-started-${entry.id}`}>
                            {format(new Date(entry.startedAt), "PPpp")}
                          </span>
                          {entry.completedAt && (
                            <span className="text-xs text-muted-foreground" data-testid={`text-history-finished-${entry.id}`}>
                              → {format(new Date(entry.completedAt), "PPpp")}
                            </span>
                          )}
                          {duration && (
                            <span className="text-xs text-muted-foreground" data-testid={`text-history-duration-${entry.id}`}>
                              · {duration}
                            </span>
                          )}
                        </div>
                        <div className="text-sm tabular-nums" data-testid={`text-history-totals-${entry.id}`}>
                          {entry.processed.toLocaleString()} / {entry.total.toLocaleString()} processed ·{" "}
                          <span className="text-green-600 dark:text-green-500">{entry.succeeded.toLocaleString()} ok</span> ·{" "}
                          <span className="text-destructive">{entry.failed.toLocaleString()} failed</span>
                        </div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-history-operator-${entry.id}`}>
                          Started by {operatorName} · <code className="text-[10px]">{entry.id}</code>
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 pl-10" data-testid={`history-details-${entry.id}`}>
                        {entry.completedAt && (
                          <div className="text-xs text-muted-foreground mb-2" data-testid={`text-history-completed-${entry.id}`}>
                            Finished {format(new Date(entry.completedAt), "PPpp")}
                          </div>
                        )}
                        {entry.errors.length === 0 ? (
                          <div className="text-xs text-muted-foreground" data-testid={`text-history-no-errors-${entry.id}`}>
                            No error samples recorded for this run.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label className="text-xs">Error samples ({entry.errors.length})</Label>
                            <ScrollArea className="h-[180px] rounded-md border p-3">
                              <ul className="space-y-2 text-xs font-mono" data-testid={`list-history-errors-${entry.id}`}>
                                {entry.errors.map((err, i) => (
                                  <li key={`${err.recordingId}-${i}`} data-testid={`history-error-${entry.id}-${i}`}>
                                    <span className="text-muted-foreground">{err.recordingId}:</span>{" "}
                                    <span className="text-destructive">{err.error}</span>
                                  </li>
                                ))}
                              </ul>
                            </ScrollArea>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatOperator(
  startedBy: BackfillHistoryEntry["startedBy"],
): string {
  if (!startedBy) return "Unknown";
  const name = [startedBy.firstName, startedBy.lastName].filter(Boolean).join(" ").trim();
  return name || startedBy.email || "Unknown";
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone?: "success" | "error";
  testId: string;
}) {
  const color =
    tone === "success"
      ? "text-green-600 dark:text-green-500"
      : tone === "error"
      ? "text-destructive"
      : "";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color}`} data-testid={testId}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
