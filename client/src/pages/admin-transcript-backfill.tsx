import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Loader2,
  Mic,
  Play,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  History,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  X,
  RotateCcw,
  Download,
  ListChecks,
  ExternalLink,
} from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

interface BackfillJob {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recordingId: string; error: string }>;
  // Task #1003 — full set of failed recordingIds. May be longer than `errors`
  // (which is capped at 50 samples) so we use this when surfacing the true
  // retry count in the UI (Task #1013).
  failedRecordingIds: string[];
  startedAt: string;
  completedAt: string | null;
  parentJobId?: string | null;
  concurrency: number | null;
  maxRecords: number | null;
}

interface BackfillHistoryEntry extends BackfillJob {
  startedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  organization?: {
    id: string;
    name: string | null;
    slug: string | null;
  };
}

interface BackfillHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  crossOrg?: boolean;
  jobs: BackfillHistoryEntry[];
}

interface OrganizationSummary {
  id: string;
  name: string;
  slug: string | null;
}

const CROSS_ORG_VALUE = "__ALL__";

interface BackfillSummary {
  pending: number;
  activeJob: BackfillJob | null;
}

interface BackfillOperator {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobCount: number;
}

interface BackfillOperatorsResponse {
  operators: BackfillOperator[];
}

interface PendingRecording {
  recordingId: string;
  callId: string;
  transcriptStatus: string;
  transcriptError: string | null;
  recordingDurationSeconds: number;
  recordingCreatedAt: string | null;
  opportunityId: string | null;
  contactId: string | null;
  crmOrganisationId: string | null;
  direction: string | null;
  fromNumber: string | null;
  toNumber: string | null;
  callStartedAt: string | null;
  callDurationSeconds: number;
}

interface PendingRecordingsResponse {
  total: number;
  limit: number;
  offset: number;
  recordings: PendingRecording[];
}

const SUMMARY_KEY = ["/api/crm/calls/transcripts/backfill"];
const HISTORY_PATH = "/api/crm/calls/transcripts/backfill/history";
const HISTORY_KEY_BASE = [HISTORY_PATH] as const;
const PENDING_PATH = "/api/crm/calls/transcripts/backfill/pending";
const PAGE_SIZE = 20;
const STATUS_OPTIONS = ["RUNNING", "COMPLETED", "FAILED"] as const;
type StatusFilter = "ALL" | (typeof STATUS_OPTIONS)[number];

export default function AdminTranscriptBackfillPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [maxRecords, setMaxRecords] = useState<string>("");
  const [concurrency, setConcurrency] = useState<string>("2");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // History filters. `appliedOperator` is debounced from the input field so we
  // don't fire a request on every keystroke. Status/date changes apply
  // immediately because they come from explicit pickers.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [operatorInput, setOperatorInput] = useState("");
  const [appliedOperator, setAppliedOperator] = useState("");
  // Quick-pick operator dropdown (Task #1001). When set, we filter by this
  // user's id (exact match) and ignore the free-text operator input so the
  // two filters don't fight each other.
  const [operatorId, setOperatorId] = useState<string>("ALL");
  const [startedAfter, setStartedAfter] = useState<Date | undefined>(undefined);
  const [startedBefore, setStartedBefore] = useState<Date | undefined>(undefined);
  // Task #1007 — SUPER_ADMINs can see history across every org. Default to the
  // cross-org view so platform support sees the full picture immediately;
  // they can narrow to a single org from this picker.
  const [orgFilter, setOrgFilter] = useState<string>(CROSS_ORG_VALUE);
  const [page, setPage] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingPage, setPendingPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAppliedOperator(operatorInput.trim()), 300);
    return () => clearTimeout(t);
  }, [operatorInput]);

  // Reset to the first page whenever filters change so users don't end up
  // staring at an empty page because their previous offset is past the new
  // total.
  useEffect(() => {
    setPage(0);
  }, [statusFilter, appliedOperator, operatorId, startedAfter, startedBefore, orgFilter]);

  const historyFilters = useMemo(() => {
    const params: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    };
    if (statusFilter !== "ALL") params.status = statusFilter;
    if (operatorId !== "ALL") {
      // Exact-match filter wins over the free-text fallback.
      params.startedById = operatorId;
    } else if (appliedOperator) {
      params.operator = appliedOperator;
    }
    if (startedAfter) params.startedAfter = startedAfter.toISOString();
    if (startedBefore) {
      // Make the upper bound inclusive of the entire selected day.
      const end = new Date(startedBefore);
      end.setHours(23, 59, 59, 999);
      params.startedBefore = end.toISOString();
    }
    // Task #1007 — only super admins can scope to (or away from) a specific
    // org. Org-scoped admins are locked to their own org by the server.
    if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
      params.organizationId = orgFilter;
    }
    return params;
  }, [page, statusFilter, appliedOperator, operatorId, startedAfter, startedBefore, orgFilter, isSuperAdmin]);

  const hasActiveFilters =
    statusFilter !== "ALL" ||
    !!appliedOperator ||
    operatorId !== "ALL" ||
    !!startedAfter ||
    !!startedBefore ||
    (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE);

  // Task #1007 — load the platform org list lazily for the SUPER_ADMIN org
  // picker. Skipped entirely for org-scoped admins so we don't fire an
  // unauthorized request that would just 403.
  const orgsQuery = useQuery<OrganizationSummary[]>({
    queryKey: ["/api/platform/organizations"],
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });

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
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: [PENDING_PATH] });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/operators"],
      });
    }
  }, [jobQuery.data?.status]);

  const historyQuery = useQuery<BackfillHistoryResponse>({
    queryKey: [HISTORY_PATH, historyFilters],
    refetchInterval: activeJobId ? 5_000 : 30_000,
  });

  // Task #1010 — drill-down list of recordings still missing transcripts.
  // Refresh whenever a job completes so admins see the surviving rows
  // immediately instead of needing to manually reload.
  const pendingFilters = useMemo(
    () => ({ limit: String(PAGE_SIZE), offset: String(pendingPage * PAGE_SIZE) }),
    [pendingPage],
  );
  const pendingRecordingsQuery = useQuery<PendingRecordingsResponse>({
    queryKey: [PENDING_PATH, pendingFilters],
    refetchInterval: activeJobId ? 5_000 : 30_000,
  });

  // Quick-pick dropdown source. Refresh whenever a job finishes so newly
  // appearing operators show up without a manual reload.
  const operatorsQuery = useQuery<BackfillOperatorsResponse>({
    queryKey: ["/api/crm/calls/transcripts/backfill/operators"],
  });

  const retryMutation = useMutation({
    mutationFn: async (parentJobId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/crm/calls/transcripts/backfill/${parentJobId}/retry`,
        {},
      );
      return (await res.json()) as {
        jobId: string | null;
        total: number;
        message?: string;
        parentJobId?: string;
      };
    },
    onSuccess: (data) => {
      if (data.jobId) {
        setActiveJobId(data.jobId);
        toast({
          title: "Retry started",
          description: `Re-running ${data.total} previously failed recording${data.total === 1 ? "" : "s"}.`,
        });
      } else {
        toast({
          title: "Nothing to retry",
          description: data.message ?? "No eligible failed recordings remain.",
        });
      }
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: [PENDING_PATH] });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/operators"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to retry", description: err.message, variant: "destructive" });
    },
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
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: [PENDING_PATH] });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/operators"],
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start backfill", description: err.message, variant: "destructive" });
    },
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (appliedOperator) params.set("operator", appliedOperator);
      if (startedAfter) params.set("startedAfter", startedAfter.toISOString());
      if (startedBefore) {
        const end = new Date(startedBefore);
        end.setHours(23, 59, 59, 999);
        params.set("startedBefore", end.toISOString());
      }
      if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
        params.set("organizationId", orgFilter);
      }
      const qs = params.toString();
      const url = `/api/crm/calls/transcripts/backfill/history.csv${qs ? `?${qs}` : ""}`;
      const res = await apiRequest("GET", url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `transcript-backfill-history-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      toast({
        title: "Failed to export CSV",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

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

      <PendingRecordingsCard
        query={pendingRecordingsQuery}
        page={pendingPage}
        onPageChange={setPendingPage}
      />

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
            <div
              className="text-xs text-muted-foreground"
              data-testid="text-job-settings"
            >
              Concurrency{" "}
              <span className="font-medium text-foreground" data-testid="text-job-concurrency">
                {job.concurrency ?? "default"}
              </span>{" "}
              · Record cap{" "}
              <span className="font-medium text-foreground" data-testid="text-job-max-records">
                {job.maxRecords !== null ? job.maxRecords.toLocaleString() : "no cap"}
              </span>
            </div>
            {job.errors.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs" data-testid="label-job-error-samples">
                  {/* Use the larger of the unbounded failedRecordingIds list
                      (Task #1003) and the bounded errors sample. Falling back
                      keeps the label sensible for legacy job rows that don't
                      yet populate failedRecordingIds. */}
                  {(() => {
                    const totalFailed = Math.max(
                      job.failedRecordingIds.length,
                      job.errors.length,
                    );
                    return totalFailed > job.errors.length
                      ? `Recent error samples (showing ${job.errors.length.toLocaleString()} of ${totalFailed.toLocaleString()} total failures)`
                      : `Recent error samples (${job.errors.length.toLocaleString()})`;
                  })()}
                </Label>
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
              <CardDescription data-testid="text-history-scope">
                {isSuperAdmin && orgFilter === CROSS_ORG_VALUE
                  ? "Past transcript backfill runs across every organization. Click a row to view error samples."
                  : "Past transcript backfill runs for this organization. Click a row to view error samples."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                disabled={
                  isExporting ||
                  historyQuery.isLoading ||
                  (historyQuery.data?.total ?? 0) === 0
                }
                data-testid="button-export-history-csv"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download CSV
              </Button>
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="history-filters">
            {isSuperAdmin && (
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                <Label htmlFor="history-organization" className="text-xs">Organization</Label>
                <Select
                  value={orgFilter}
                  onValueChange={(v) => setOrgFilter(v)}
                  disabled={orgsQuery.isLoading}
                >
                  <SelectTrigger id="history-organization" data-testid="select-history-organization">
                    <SelectValue placeholder="All organizations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value={CROSS_ORG_VALUE}
                      data-testid="select-history-organization-option-all"
                    >
                      All organizations
                    </SelectItem>
                    {(orgsQuery.data ?? []).map((org) => (
                      <SelectItem
                        key={org.id}
                        value={org.id}
                        data-testid={`select-history-organization-option-${org.id}`}
                      >
                        {org.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="history-status" className="text-xs">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger id="history-status" data-testid="select-history-status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" data-testid="select-history-status-option-ALL">All statuses</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s} data-testid={`select-history-status-option-${s}`}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="history-operator" className="text-xs">Operator</Label>
              <Select
                value={operatorId}
                onValueChange={(v) => setOperatorId(v)}
              >
                <SelectTrigger
                  id="history-operator-select"
                  data-testid="select-history-operator"
                >
                  <SelectValue placeholder="Any operator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" data-testid="select-history-operator-option-ALL">
                    Any operator
                  </SelectItem>
                  {(operatorsQuery.data?.operators ?? []).map((op) => (
                    <SelectItem
                      key={op.id}
                      value={op.id}
                      data-testid={`select-history-operator-option-${op.id}`}
                    >
                      {formatOperatorOption(op)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id="history-operator"
                value={operatorInput}
                onChange={(e) => setOperatorInput(e.target.value)}
                placeholder="Or search name / email"
                disabled={operatorId !== "ALL"}
                data-testid="input-history-operator"
              />
              {operatorId !== "ALL" && (
                <p
                  className="text-[11px] text-muted-foreground"
                  data-testid="text-history-operator-hint"
                >
                  Clear the dropdown to use free-text search.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Started after</Label>
              <DatePicker
                value={startedAfter ?? null}
                onChange={(d) => setStartedAfter(d)}
                placeholder="Any date"
                data-testid="picker-history-started-after"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Started before</Label>
              <DatePicker
                value={startedBefore ?? null}
                onChange={(d) => setStartedBefore(d)}
                placeholder="Any date"
                data-testid="picker-history-started-before"
              />
            </div>
            {hasActiveFilters && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("ALL");
                    setOperatorInput("");
                    setAppliedOperator("");
                    setOperatorId("ALL");
                    setStartedAfter(undefined);
                    setStartedBefore(undefined);
                    if (isSuperAdmin) setOrgFilter(CROSS_ORG_VALUE);
                  }}
                  data-testid="button-clear-history-filters"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          {historyQuery.isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="status-loading-history" />
          ) : historyQuery.isError ? (
            <div className="text-sm text-destructive" data-testid="text-history-error">
              Failed to load backfill history.
            </div>
          ) : !historyQuery.data || historyQuery.data.jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground" data-testid="text-history-empty">
              {hasActiveFilters
                ? "No backfill runs match the current filters."
                : "No backfill runs yet."}
            </div>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="list-history">
              {historyQuery.data.jobs.map((entry) => {
                const isExpanded = expandedHistoryId === entry.id;
                const operatorName = formatOperator(entry.startedBy);
                const duration = entry.completedAt
                  ? formatDistanceStrict(new Date(entry.completedAt), new Date(entry.startedAt))
                  : null;
                // Prefer the unbounded failedRecordingIds count (Task #1003),
                // but fall back to the bounded errors sample so legacy history
                // rows persisted before #1003 still expose a working Retry
                // button. The server-side retry endpoint also unions both
                // sources, so this matches what the backend will actually
                // re-run.
                const retryCount =
                  entry.failedRecordingIds.length || entry.errors.length;
                const canRetry =
                  entry.status !== "RUNNING" && retryCount > 0 && !isRunning;
                const retryingThisRow =
                  retryMutation.isPending && retryMutation.variables === entry.id;
                return (
                  <li key={entry.id} data-testid={`history-row-${entry.id}`}>
                    <div className="flex items-start gap-2 p-1.5">
                    <button
                      type="button"
                      className="flex-1 text-left p-1.5 rounded-md hover-elevate active-elevate-2 flex items-start gap-3"
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
                        <div
                          className="text-xs text-muted-foreground"
                          data-testid={`text-history-settings-${entry.id}`}
                        >
                          Concurrency{" "}
                          <span
                            className="font-medium text-foreground"
                            data-testid={`text-history-concurrency-${entry.id}`}
                          >
                            {entry.concurrency ?? "default"}
                          </span>{" "}
                          · Record cap{" "}
                          <span
                            className="font-medium text-foreground"
                            data-testid={`text-history-max-records-${entry.id}`}
                          >
                            {entry.maxRecords !== null ? entry.maxRecords.toLocaleString() : "no cap"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-history-operator-${entry.id}`}>
                          Started by {operatorName} · <code className="text-[10px]">{entry.id}</code>
                        </div>
                        {isSuperAdmin && entry.organization && (
                          <div
                            className="text-xs text-muted-foreground"
                            data-testid={`text-history-organization-${entry.id}`}
                          >
                            Org: {entry.organization.name ?? entry.organization.id}
                            {entry.organization.slug ? (
                              <> · <code className="text-[10px]">{entry.organization.slug}</code></>
                            ) : null}
                          </div>
                        )}
                        {entry.parentJobId && (
                          <div className="text-xs text-muted-foreground" data-testid={`text-history-parent-${entry.id}`}>
                            Retry of <code className="text-[10px]">{entry.parentJobId}</code>
                          </div>
                        )}
                      </div>
                    </button>
                    {canRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => retryMutation.mutate(entry.id)}
                        disabled={retryMutation.isPending || isRunning}
                        data-testid={`button-history-retry-${entry.id}`}
                        title={`Re-run transcription for ${retryCount.toLocaleString()} recording${retryCount === 1 ? "" : "s"} that failed in this run`}
                      >
                        {retryingThisRow ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-4 w-4 mr-1.5" />
                        )}
                        Retry {retryCount.toLocaleString()} failed
                      </Button>
                    )}
                    </div>
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
                            <Label
                              className="text-xs"
                              data-testid={`label-history-error-samples-${entry.id}`}
                            >
                              {retryCount > entry.errors.length
                                ? `Error samples (showing ${entry.errors.length.toLocaleString()} of ${retryCount.toLocaleString()} total failures)`
                                : `Error samples (${entry.errors.length.toLocaleString()})`}
                            </Label>
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
          {historyQuery.data && historyQuery.data.total > 0 && (
            <HistoryPagination
              total={historyQuery.data.total}
              page={page}
              pageSize={PAGE_SIZE}
              isFetching={historyQuery.isFetching}
              onPageChange={setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PendingRecordingsCard({
  query,
  page,
  onPageChange,
}: {
  query: ReturnType<typeof useQuery<PendingRecordingsResponse>>;
  page: number;
  onPageChange: (next: number) => void;
}) {
  const total = query.data?.total ?? 0;
  const recordings = query.data?.recordings ?? [];

  return (
    <Card data-testid="card-pending-recordings">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" />
              Recordings still missing transcripts
            </CardTitle>
            <CardDescription>
              The exact rows a fresh backfill would pick up. Use this to triage
              individual calls instead of re-running the whole job.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            data-testid="button-refresh-pending-recordings"
          >
            {query.isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            data-testid="status-loading-pending-recordings"
          />
        ) : query.isError ? (
          <div className="text-sm text-destructive" data-testid="text-pending-recordings-error">
            Failed to load pending recordings.
          </div>
        ) : recordings.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-pending-recordings-empty"
          >
            No recordings are currently missing transcripts.
          </div>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="list-pending-recordings">
            {recordings.map((rec) => {
              // Prefer the deal page when the call is tied to an opportunity.
              // If it's only tied to a contact / CRM organisation, fall back
              // to the CRM index so admins still have a one-click jump into
              // the CRM area to triage from there.
              const callLink = rec.opportunityId
                ? `/crm/deals/${rec.opportunityId}`
                : rec.contactId || rec.crmOrganisationId
                ? "/crm"
                : null;
              const callLinkLabel = rec.opportunityId
                ? "Open deal"
                : "Open in CRM";
              const counterparty =
                rec.direction === "INBOUND"
                  ? rec.fromNumber
                  : rec.toNumber;
              const startedLabel = rec.callStartedAt
                ? format(new Date(rec.callStartedAt), "PPpp")
                : rec.recordingCreatedAt
                ? format(new Date(rec.recordingCreatedAt), "PPpp")
                : "Unknown time";
              return (
                <li
                  key={rec.recordingId}
                  className="p-3 space-y-1"
                  data-testid={`pending-recording-row-${rec.recordingId}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        rec.transcriptStatus === "FAILED" ? "destructive" : "secondary"
                      }
                      data-testid={`badge-pending-status-${rec.recordingId}`}
                    >
                      {rec.transcriptStatus}
                    </Badge>
                    {rec.direction && (
                      <Badge
                        variant="outline"
                        data-testid={`badge-pending-direction-${rec.recordingId}`}
                      >
                        {rec.direction}
                      </Badge>
                    )}
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-pending-started-${rec.recordingId}`}
                    >
                      {startedLabel}
                    </span>
                    {rec.callDurationSeconds > 0 && (
                      <span
                        className="text-xs text-muted-foreground tabular-nums"
                        data-testid={`text-pending-duration-${rec.recordingId}`}
                      >
                        · {formatDuration(rec.callDurationSeconds)}
                      </span>
                    )}
                  </div>
                  <div className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
                    {callLink ? (
                      <Link
                        href={callLink}
                        className="font-medium text-primary inline-flex items-center gap-1 hover:underline"
                        data-testid={`link-pending-call-${rec.recordingId}`}
                      >
                        {callLinkLabel}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-pending-no-link-${rec.recordingId}`}
                        title="This call isn't linked to an opportunity, so there's no detail page to open."
                      >
                        No linked opportunity
                      </span>
                    )}
                    {counterparty && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-pending-number-${rec.recordingId}`}
                      >
                        {rec.direction === "INBOUND" ? "From" : "To"}{" "}
                        <code className="text-[11px]">{counterparty}</code>
                      </span>
                    )}
                  </div>
                  {rec.transcriptError && (
                    <div
                      className="text-xs text-destructive font-mono break-all"
                      data-testid={`text-pending-error-${rec.recordingId}`}
                    >
                      {rec.transcriptError}
                    </div>
                  )}
                  <div
                    className="text-[11px] text-muted-foreground"
                    data-testid={`text-pending-ids-${rec.recordingId}`}
                  >
                    Recording <code>{rec.recordingId}</code> · Call{" "}
                    <code>{rec.callId}</code>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {total > 0 && (
          <HistoryPagination
            total={total}
            page={page}
            pageSize={PAGE_SIZE}
            isFetching={query.isFetching}
            onPageChange={onPageChange}
          />
        )}
      </CardContent>
    </Card>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
}

function HistoryPagination({
  total,
  page,
  pageSize,
  isFetching,
  onPageChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  isFetching: boolean;
  onPageChange: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = total === 0 ? 0 : safePage * pageSize + 1;
  const endIdx = Math.min(total, (safePage + 1) * pageSize);
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-3"
      data-testid="history-pagination"
    >
      <div className="text-xs text-muted-foreground" data-testid="text-history-range">
        Showing <span className="font-medium">{startIdx.toLocaleString()}</span>–
        <span className="font-medium">{endIdx.toLocaleString()}</span> of{" "}
        <span className="font-medium">{total.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={!canPrev || isFetching}
          onClick={() => onPageChange(0)}
          data-testid="button-history-page-first"
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!canPrev || isFetching}
          onClick={() => onPageChange(safePage - 1)}
          data-testid="button-history-page-prev"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="px-2 text-xs tabular-nums text-muted-foreground" data-testid="text-history-page">
          Page {safePage + 1} of {totalPages}
        </div>
        <Button
          variant="outline"
          size="icon"
          disabled={!canNext || isFetching}
          onClick={() => onPageChange(safePage + 1)}
          data-testid="button-history-page-next"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!canNext || isFetching}
          onClick={() => onPageChange(totalPages - 1)}
          data-testid="button-history-page-last"
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
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

function formatOperatorOption(op: BackfillOperator): string {
  const name = [op.firstName, op.lastName].filter(Boolean).join(" ").trim();
  const label = name || op.email || op.id;
  const suffix = op.jobCount > 0 ? ` (${op.jobCount})` : "";
  // Show the email alongside the name so two operators with the same display
  // name remain distinguishable.
  if (name && op.email && op.email !== label) {
    return `${name} — ${op.email}${suffix}`;
  }
  return `${label}${suffix}`;
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
