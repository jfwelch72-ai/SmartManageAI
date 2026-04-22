import { useEffect, useMemo, useRef, useState } from "react";
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
  ArrowRight,
  Send,
  Bell,
  Mail,
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

interface BackfillLineageNode {
  id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  startedAt: string;
  completedAt: string | null;
  parentJobId: string | null;
  attempt: number;
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
  lineage: BackfillLineageNode[];
  // Task #1022 — recipient snapshot for the run-completed admin email.
  // `null` when no notification was dispatched (legacy rows, suppressed
  // because no eligible recipients, or send failed before audit).
  notification?: {
    channel: string;
    recipientEmails: string[];
    recipientCount: number;
    notifiedAt: string;
  } | null;
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

interface RunningBackfillJob extends BackfillJob {
  organization: {
    id: string;
    name: string | null;
    slug: string | null;
  };
}

interface BackfillSummary {
  pending: number;
  activeJob: BackfillJob | null;
  // Task #1019 — populated only on the SUPER_ADMIN cross-org view. When
  // `crossOrg` is true, `pending` is the platform-wide total and `runningJobs`
  // lists every currently running backfill across all tenants.
  crossOrg?: boolean;
  scopedOrganizationId?: string | null;
  runningJobs?: RunningBackfillJob[];
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

// Task #1032 — read-only summary of which alert destinations are wired up
// server-side. The Slack webhook URL is intentionally NOT included.
interface NotificationConfig {
  slack: { configured: boolean; valid: boolean };
  email: { configured: boolean; recipients: string[] };
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

const SUMMARY_PATH = "/api/crm/calls/transcripts/backfill";
// Task #1019 — when a SUPER_ADMIN narrows the org picker, the summary endpoint
// returns that org's pending count + active job; otherwise it returns a
// platform-wide roll-up. We key the cache on the same params the request
// sends so switching orgs refetches automatically.
const SUMMARY_KEY_BASE = [SUMMARY_PATH] as const;
const HISTORY_PATH = "/api/crm/calls/transcripts/backfill/history";
const HISTORY_KEY_BASE = [HISTORY_PATH] as const;
const PENDING_PATH = "/api/crm/calls/transcripts/backfill/pending";
// Task #1033 — most recent "Send test alert" audit row, surfaced under the
// button so admins can see who last triggered a test and whether each
// channel succeeded.
const TEST_ALERT_LATEST_KEY = [
  "/api/crm/calls/transcripts/backfill/test-alert/latest",
] as const;

interface LatestTestAlert {
  id: string;
  sentAt: string;
  sentById: string | null;
  operatorDisplay: string;
  slackConfigured: boolean;
  slackOk: boolean;
  slackError: string | null;
  emailConfigured: boolean;
  emailOk: boolean;
  emailError: string | null;
  emailRecipients: string[];
  sentByFirstName: string | null;
  sentByLastName: string | null;
  sentByEmail: string | null;
}
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
  // Task #1015 — when the user clicks an off-page lineage chip we ask the
  // server which page that run lives on, navigate there (clearing conflicting
  // filters), and remember the id so the row gets expanded + scrolled into
  // view as soon as it appears in the next history fetch.
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null);
  const [isJumping, setIsJumping] = useState(false);
  // The filter-change effect below resets `page` to 0 whenever filters change.
  // When we're in the middle of a jump that auto-clears filters we still want
  // to land on the target page, so we briefly suppress that reset.
  const suppressFilterPageReset = useRef(false);

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
    if (suppressFilterPageReset.current) {
      suppressFilterPageReset.current = false;
      return;
    }
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

  // Build the summary request params so SUPER_ADMINs see the full platform
  // roll-up by default (or a single org when one is picked). The org-scoped
  // path keeps the empty-params behavior the server already locks down by
  // organization. Including the params in the queryKey means switching the
  // org picker invalidates the cache on its own.
  const summaryParams = useMemo(() => {
    if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
      return { organizationId: orgFilter };
    }
    return {};
  }, [isSuperAdmin, orgFilter]);
  const summaryKey = useMemo(
    () => [SUMMARY_PATH, summaryParams] as const,
    [summaryParams],
  );

  const summaryQuery = useQuery<BackfillSummary>({
    queryKey: summaryKey,
    refetchInterval: activeJobId ? false : 10_000,
  });

  // Resume polling an in-flight job after a page reload — but only when the
  // summary returned a single own-org `activeJob`. In SUPER_ADMIN cross-org
  // mode the server intentionally returns `activeJob: null` and a list of
  // every running tenant in `runningJobs`, so we don't pin our single-job
  // poller to one org.
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
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY_BASE });
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

  // Task #1032 — current notification destination configuration (Slack
  // webhook + email recipients). Surfaced in its own panel so admins can see
  // the setup state without clicking "Send test alert" first.
  const notificationConfigQuery = useQuery<NotificationConfig>({
    queryKey: ["/api/crm/calls/transcripts/backfill/notification-config"],
    staleTime: 60_000,
  });
  const notificationConfig = notificationConfigQuery.data;
  const noDestinationsConfigured =
    !!notificationConfig &&
    !notificationConfig.slack.configured &&
    !notificationConfig.email.configured;

  // Set of job ids visible on the current history page. Used by the lineage
  // chain so we can disable jump links pointing to jobs that aren't on this
  // page (rather than silently no-op'ing).
  const visibleHistoryIds = useMemo(
    () => new Set((historyQuery.data?.jobs ?? []).map((j) => j.id)),
    [historyQuery.data],
  );

  const scrollHistoryRowIntoView = (jobId: string) => {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="history-row-${jobId}"]`);
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  };

  // Task #1027 — per-recording retry from the pending list. Synchronous on
  // the server, so the resolved promise tells us whether the row should now
  // disappear from the list (success) or stay with a fresh error (failure).
  const retryRecordingMutation = useMutation({
    mutationFn: async (recordingId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/crm/calls/transcripts/recordings/${recordingId}/retry`,
        {},
      );
      return (await res.json()) as {
        success?: boolean;
        recordingId: string;
        transcript?: string;
      };
    },
    onSuccess: (_data, recordingId) => {
      toast({
        title: "Transcript re-generated",
        description: "Recording has been transcribed successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [PENDING_PATH] });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY_BASE });
    },
    onError: (err: Error) => {
      toast({
        title: "Retry failed",
        description: err.message,
        variant: "destructive",
      });
      // Refresh anyway so the row picks up the new transcriptError surfaced
      // by the backend.
      queryClient.invalidateQueries({ queryKey: [PENDING_PATH] });
    },
  });

  // Reset the filter UI back to defaults. Used when the locate endpoint tells
  // us the target run doesn't satisfy the current filters and we need to
  // clear them before we can navigate the user.
  const clearAllFilters = () => {
    setStatusFilter("ALL");
    setOperatorInput("");
    setAppliedOperator("");
    setOperatorId("ALL");
    setStartedAfter(undefined);
    setStartedBefore(undefined);
  };

  // Clicking a chip in the lineage chain expands that row and scrolls it into
  // view. When the related run isn't on the current page we ask the server
  // which page (under the current filters) contains it, auto-clear any
  // conflicting filters / switch the org scope if needed, and let the
  // post-fetch effect below expand the row once it appears.
  const handleJumpToHistoryRow = async (jobId: string) => {
    if (visibleHistoryIds.has(jobId)) {
      setExpandedHistoryId(jobId);
      scrollHistoryRowIntoView(jobId);
      return;
    }

    setIsJumping(true);
    try {
      const params = new URLSearchParams();
      params.set("jobId", jobId);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (operatorId !== "ALL") {
        params.set("startedById", operatorId);
      } else if (appliedOperator) {
        params.set("operator", appliedOperator);
      }
      if (startedAfter) params.set("startedAfter", startedAfter.toISOString());
      if (startedBefore) {
        const end = new Date(startedBefore);
        end.setHours(23, 59, 59, 999);
        params.set("startedBefore", end.toISOString());
      }
      if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
        params.set("organizationId", orgFilter);
      }
      const res = await apiRequest(
        "GET",
        `/api/crm/calls/transcripts/backfill/history/locate?${params.toString()}`,
      );
      const data = (await res.json()) as {
        found: boolean;
        offset: number;
        organizationId: string | null;
        filteredOut: boolean;
        orgScopeChanged: boolean;
        pageSize: number;
      };
      if (!data.found) {
        toast({
          title: "Run not found",
          description: "That related run is no longer available.",
          variant: "destructive",
        });
        return;
      }

      // Switch the org picker for super admins when the target lives in a
      // different org than the one currently selected.
      if (isSuperAdmin && data.orgScopeChanged) {
        // Switching to the cross-org view always resolves the mismatch and
        // matches the existing default behavior; that keeps the picker stable
        // even when the target's org isn't loaded in the dropdown yet.
        setOrgFilter(CROSS_ORG_VALUE);
      }
      const pageSize = data.pageSize > 0 ? data.pageSize : PAGE_SIZE;
      const targetPage = Math.max(0, Math.floor(data.offset / pageSize));
      // Set the suppress flag *before* mutating filters so the filter-change
      // effect skips its page-reset and our setPage(targetPage) wins.
      if (data.filteredOut || (isSuperAdmin && data.orgScopeChanged)) {
        suppressFilterPageReset.current = true;
      }
      if (data.filteredOut) {
        clearAllFilters();
      }
      setPendingJumpId(jobId);
      setPage(targetPage);
    } catch (err) {
      toast({
        title: "Couldn't jump to that run",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsJumping(false);
    }
  };

  // Once the history fetch settles, expand and scroll to the pending jump
  // target. We wait for `isFetching` to become false so the effect runs after
  // the new page's rows have actually rendered.
  useEffect(() => {
    if (!pendingJumpId) return;
    if (historyQuery.isFetching) return;
    if (visibleHistoryIds.has(pendingJumpId)) {
      setExpandedHistoryId(pendingJumpId);
      scrollHistoryRowIntoView(pendingJumpId);
      setPendingJumpId(null);
    } else {
      // The target didn't materialize (e.g. it was deleted between the
      // locate call and the page fetch). Surface a toast and bail rather
      // than silently leaving the jump marker hanging.
      toast({
        title: "Run no longer available",
        description: "The related run couldn't be located on the destination page.",
        variant: "destructive",
      });
      setPendingJumpId(null);
    }
    // visibleHistoryIds is derived from historyQuery.data; depending on it
    // ensures we re-check after the new page is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJumpId, historyQuery.isFetching, visibleHistoryIds]);

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
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY_BASE });
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

  const latestTestAlertQuery = useQuery<{
    latest: LatestTestAlert | null;
    cooldownSeconds: number;
    nextAllowedAt: string | null;
  }>({
    queryKey: TEST_ALERT_LATEST_KEY,
  });

  const testAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/crm/calls/transcripts/backfill/test-alert",
        {},
      );
      return (await res.json()) as {
        slack: { configured: boolean; ok: boolean; error?: string };
        email: {
          configured: boolean;
          ok: boolean;
          error?: string;
          recipients?: string[];
        };
        operatorDisplay: string;
      };
    },
    onSuccess: (data) => {
      // Task #1033 — refresh the "last test alert sent by" indicator so the
      // newly-recorded audit row appears without a manual reload.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_LATEST_KEY });
      const { slack, email } = data;
      if (!slack.configured && !email.configured) {
        toast({
          title: "No alert destinations configured",
          description:
            "Set CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK or CRM_BACKFILL_NOTIFY_EMAIL_TO and try again.",
          variant: "destructive",
        });
        return;
      }
      if (slack.configured) {
        toast({
          title: slack.ok ? "Slack test alert sent" : "Slack test alert failed",
          description: slack.ok
            ? "Check your Slack channel for two sample alerts (completed + failed)."
            : slack.error ?? "Unknown error.",
          variant: slack.ok ? "default" : "destructive",
        });
      }
      if (email.configured) {
        const recipientText =
          email.recipients && email.recipients.length > 0
            ? ` to ${email.recipients.join(", ")}`
            : "";
        toast({
          title: email.ok ? "Email test alert sent" : "Email test alert failed",
          description: email.ok
            ? `Sent two sample alerts (completed + failed)${recipientText}.`
            : email.error ?? "Unknown error.",
          variant: email.ok ? "default" : "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to send test alert",
        description: err.message,
        variant: "destructive",
      });
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
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY_BASE });
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
  const isCrossOrgSummary = !!summaryQuery.data?.crossOrg;
  const crossOrgRunningJobs = summaryQuery.data?.runningJobs ?? [];
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
              <CardTitle data-testid="title-pending">
                {isCrossOrgSummary
                  ? "Recordings missing transcripts (all organizations)"
                  : "Recordings missing transcripts"}
              </CardTitle>
              <CardDescription data-testid="text-pending-scope">
                {isCrossOrgSummary
                  ? "Platform-wide roll-up across every tenant. Pick an organization above to scope this view."
                  : "Calls in PENDING or FAILED state with no stored transcript."}
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
        retryMutation={retryRecordingMutation}
        onPageChange={setPendingPage}
      />


      <Card data-testid="card-notification-destinations">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notification destinations
          </CardTitle>
          <CardDescription>
            Where run-completed and run-failed alerts are sent. Configured server-side via
            <code className="mx-1">CRM_BACKFILL_NOTIFY_SLACK_WEBHOOK</code>
            and
            <code className="mx-1">CRM_BACKFILL_NOTIFY_EMAIL_TO</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notificationConfigQuery.isLoading ? (
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              data-testid="status-loading-notification-config"
            />
          ) : notificationConfigQuery.isError || !notificationConfig ? (
            <div
              className="text-sm text-destructive"
              data-testid="text-notification-config-error"
            >
              Failed to load notification destination configuration.
            </div>
          ) : (
            <dl className="space-y-3 text-sm">
              <div className="flex items-start gap-3" data-testid="row-notification-slack">
                <dt className="w-32 shrink-0 font-medium">Slack webhook</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {notificationConfig.slack.configured ? (
                    notificationConfig.slack.valid ? (
                      <Badge
                        variant="secondary"
                        className="gap-1"
                        data-testid="badge-slack-status"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Configured
                      </Badge>
                    ) : (
                      <Badge
                        variant="destructive"
                        className="gap-1"
                        data-testid="badge-slack-status"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Configured but invalid URL
                      </Badge>
                    )
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground"
                      data-testid="badge-slack-status"
                    >
                      Not configured
                    </Badge>
                  )}
                </dd>
              </div>
              <div className="flex items-start gap-3" data-testid="row-notification-email">
                <dt className="w-32 shrink-0 font-medium">Email recipients</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {notificationConfig.email.configured ? (
                    <>
                      <Badge variant="secondary" className="gap-1" data-testid="badge-email-status">
                        <CheckCircle2 className="h-3 w-3" />
                        Configured
                      </Badge>
                      <span
                        className="text-muted-foreground break-all"
                        data-testid="text-email-recipients"
                      >
                        {notificationConfig.email.recipients.join(", ")}
                      </span>
                    </>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground"
                      data-testid="badge-email-status"
                    >
                      Not configured
                    </Badge>
                  )}
                </dd>
              </div>
              {noDestinationsConfigured && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="text-no-destinations-hint"
                >
                  No alert destinations are configured — run-completed and run-failed
                  notifications will be silently skipped until either env var is set.
                </p>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      {isCrossOrgSummary && crossOrgRunningJobs.length > 0 && (
        <Card data-testid="card-cross-org-running">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              Backfills running across the platform
              <Badge variant="secondary" data-testid="badge-cross-org-running-count">
                {crossOrgRunningJobs.length.toLocaleString()}
              </Badge>
            </CardTitle>
            <CardDescription>
              Active transcript backfill jobs in every tenant. Jobs whose worker
              has stopped heartbeating are reaped automatically on the next
              refresh.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border" data-testid="list-cross-org-running">
              {crossOrgRunningJobs.map((rj) => {
                const pct = rj.total > 0
                  ? Math.min(100, (rj.processed / rj.total) * 100)
                  : 0;
                const orgLabel = rj.organization.name
                  ?? rj.organization.slug
                  ?? rj.organization.id;
                return (
                  <li
                    key={rj.id}
                    className="p-3 space-y-2"
                    data-testid={`cross-org-running-row-${rj.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div
                          className="text-sm font-medium"
                          data-testid={`cross-org-running-org-${rj.id}`}
                        >
                          {orgLabel}
                          {rj.organization.slug && rj.organization.name ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              <code className="text-[10px]">{rj.organization.slug}</code>
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Job <code className="text-[10px]">{rj.id}</code> · started{" "}
                          {format(new Date(rj.startedAt), "PPpp")}
                        </div>
                      </div>
                      <Badge variant="secondary" data-testid={`cross-org-running-status-${rj.id}`}>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        RUNNING
                      </Badge>
                    </div>
                    <Progress
                      value={pct}
                      data-testid={`cross-org-running-progress-${rj.id}`}
                    />
                    <div
                      className="text-xs tabular-nums text-muted-foreground"
                      data-testid={`cross-org-running-totals-${rj.id}`}
                    >
                      {rj.processed.toLocaleString()} / {rj.total.toLocaleString()} processed
                      ({pct.toFixed(0)}%) ·{" "}
                      <span className="text-green-600 dark:text-green-500">
                        {rj.succeeded.toLocaleString()} ok
                      </span>{" "}
                      ·{" "}
                      <span className="text-destructive">
                        {rj.failed.toLocaleString()} failed
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}


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
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
          <p className="text-xs text-muted-foreground" data-testid="text-test-alert-help">
            Sends a sample completion + failure alert to whichever Slack webhook /
            email recipients are configured, so you can confirm they arrive.
            {noDestinationsConfigured && (
              <span
                className="ml-1 text-amber-600 dark:text-amber-500"
                data-testid="text-test-alert-no-destinations-hint"
              >
                No destinations are currently configured — clicking this will be a
                no-op until either env var is set.
              </span>
            )}
          </p>
          <LastTestAlertIndicator query={latestTestAlertQuery} />
          {pending === 0 && !isRunning && (
            <p className="text-xs text-muted-foreground" data-testid="text-no-pending">
              Nothing to backfill — all recordings already have transcripts.
            </p>
          )}
        </CardContent>
      </Card>

      <BackfillNotificationSettingsCard />

      <BackfillAlertDeliveriesCard />

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
                        {entry.status !== "RUNNING" && (
                          <div
                            className="text-xs text-muted-foreground flex items-center gap-1"
                            data-testid={`text-history-notified-${entry.id}`}
                          >
                            <Mail className="h-3 w-3" />
                            {entry.notification && entry.notification.recipientCount > 0 ? (
                              <>
                                Emailed{" "}
                                <span
                                  className="font-medium text-foreground"
                                  data-testid={`text-history-notified-count-${entry.id}`}
                                >
                                  {entry.notification.recipientCount.toLocaleString()}
                                </span>{" "}
                                admin{entry.notification.recipientCount === 1 ? "" : "s"}
                                {" · "}
                                {format(new Date(entry.notification.notifiedAt), "PPp")}
                              </>
                            ) : (
                              <span data-testid={`text-history-notified-none-${entry.id}`}>
                                No completion email sent
                              </span>
                            )}
                          </div>
                        )}
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
                    {entry.lineage.length > 1 && (
                      <div className="px-3 pb-2 pl-10">
                        <RetryLineageChain
                          lineage={entry.lineage}
                          currentId={entry.id}
                          visibleIds={visibleHistoryIds}
                          onJump={handleJumpToHistoryRow}
                          isJumping={isJumping}
                        />
                      </div>
                    )}
                    {isExpanded && (
                      <div className="px-3 pb-3 pl-10" data-testid={`history-details-${entry.id}`}>
                        {entry.completedAt && (
                          <div className="text-xs text-muted-foreground mb-2" data-testid={`text-history-completed-${entry.id}`}>
                            Finished {format(new Date(entry.completedAt), "PPpp")}
                          </div>
                        )}
                        {entry.notification && entry.notification.recipientEmails.length > 0 && (
                          <div className="mb-3 space-y-1" data-testid={`history-notification-${entry.id}`}>
                            <Label
                              className="text-xs flex items-center gap-1"
                              data-testid={`label-history-notification-${entry.id}`}
                            >
                              <Mail className="h-3 w-3" />
                              Notified admins ({entry.notification.recipientCount.toLocaleString()})
                            </Label>
                            <ul
                              className="flex flex-wrap gap-1.5"
                              data-testid={`list-history-notification-${entry.id}`}
                            >
                              {entry.notification.recipientEmails.map((email) => (
                                <li key={email}>
                                  <Badge
                                    variant="outline"
                                    className="font-mono text-[11px]"
                                    data-testid={`badge-history-notification-recipient-${entry.id}-${email}`}
                                  >
                                    {email}
                                  </Badge>
                                </li>
                              ))}
                            </ul>
                            <div
                              className="text-[11px] text-muted-foreground"
                              data-testid={`text-history-notification-when-${entry.id}`}
                            >
                              Sent {format(new Date(entry.notification.notifiedAt), "PPpp")}
                            </div>
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
  retryMutation,
}: {
  query: ReturnType<typeof useQuery<PendingRecordingsResponse>>;
  page: number;
  onPageChange: (next: number) => void;
  retryMutation: ReturnType<
    typeof useMutation<
      { success?: boolean; recordingId: string; transcript?: string },
      Error,
      string
    >
  >;
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
              const retryingThisRow =
                retryMutation.isPending &&
                retryMutation.variables === rec.recordingId;
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
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div
                      className="text-[11px] text-muted-foreground"
                      data-testid={`text-pending-ids-${rec.recordingId}`}
                    >
                      Recording <code>{rec.recordingId}</code> · Call{" "}
                      <code>{rec.callId}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate(rec.recordingId)}
                      disabled={retryMutation.isPending}
                      data-testid={`button-retry-recording-${rec.recordingId}`}
                      title="Re-run transcription for just this recording"
                    >
                      {retryingThisRow ? (
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5 mr-2" />
                      )}
                      Retry this recording
                    </Button>
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

// Task #1033 — render the most recent "Send test alert" audit row under the
// button. Shows operator + timestamp + per-channel ok/failed badges, with a
// graceful "never sent" placeholder so the button area always communicates
// state instead of looking unchanged after a click.
function LastTestAlertIndicator({
  query,
}: {
  query: ReturnType<typeof useQuery<{ latest: LatestTestAlert | null }>>;
}) {
  if (query.isLoading) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="status-last-test-alert-loading"
      >
        Loading last test alert…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p
        className="text-xs text-destructive"
        data-testid="text-last-test-alert-error"
      >
        Couldn't load the last test alert.
      </p>
    );
  }
  const latest = query.data?.latest;
  if (!latest) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="text-last-test-alert-empty"
      >
        No test alerts have been sent yet.
      </p>
    );
  }
  const sentAt = new Date(latest.sentAt);
  const senderName = [latest.sentByFirstName, latest.sentByLastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const sender =
    senderName ||
    latest.sentByEmail ||
    latest.operatorDisplay ||
    "Unknown user";
  return (
    <div
      className="rounded-md border bg-muted/40 p-3 text-xs space-y-1"
      data-testid="card-last-test-alert"
    >
      <div className="text-muted-foreground">
        Last test alert sent by{" "}
        <span
          className="font-medium text-foreground"
          data-testid="text-last-test-alert-sender"
        >
          {sender}
        </span>{" "}
        <span data-testid="text-last-test-alert-time">
          on {format(sentAt, "MMM d, yyyy 'at' h:mm a")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {latest.slackConfigured ? (
          <Badge
            variant={latest.slackOk ? "default" : "destructive"}
            data-testid="badge-last-test-alert-slack"
          >
            Slack: {latest.slackOk ? "ok" : "failed"}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            data-testid="badge-last-test-alert-slack"
          >
            Slack: not configured
          </Badge>
        )}
        {latest.emailConfigured ? (
          <Badge
            variant={latest.emailOk ? "default" : "destructive"}
            data-testid="badge-last-test-alert-email"
          >
            Email: {latest.emailOk ? "ok" : "failed"}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            data-testid="badge-last-test-alert-email"
          >
            Email: not configured
          </Badge>
        )}
      </div>
      {(latest.slackError || latest.emailError) && (
        <div
          className="text-destructive pt-1"
          data-testid="text-last-test-alert-errors"
        >
          {latest.slackError && <div>Slack: {latest.slackError}</div>}
          {latest.emailError && <div>Email: {latest.emailError}</div>}
        </div>
      )}
      {latest.emailConfigured &&
        latest.emailRecipients &&
        latest.emailRecipients.length > 0 && (
          <div
            className="text-muted-foreground"
            data-testid="text-last-test-alert-recipients"
          >
            Email recipients: {latest.emailRecipients.join(", ")}
          </div>
        )}
    </div>
  );
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

function RetryLineageChain({
  lineage,
  currentId,
  visibleIds,
  onJump,
  isJumping,
}: {
  lineage: BackfillLineageNode[];
  currentId: string;
  visibleIds: Set<string>;
  onJump: (id: string) => void;
  isJumping: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1 text-xs"
      data-testid={`lineage-chain-${currentId}`}
      aria-label="Retry lineage"
    >
      <span className="text-muted-foreground mr-1">Chain:</span>
      {lineage.map((node, idx) => {
        const isCurrent = node.id === currentId;
        const onPage = visibleIds.has(node.id);
        const label = node.attempt === 0 ? "original" : `retry ${node.attempt}`;
        const statusTone =
          node.status === "COMPLETED"
            ? "border-green-500/40 text-green-700 dark:text-green-400"
            : node.status === "FAILED"
            ? "border-destructive/40 text-destructive"
            : "border-muted-foreground/40 text-muted-foreground";
        const currentTone = isCurrent ? "bg-muted font-medium" : "";
        // Off-page chips used to be disabled. Task #1015 — they're now
        // clickable too; the page handler asks the server which page the
        // run lives on, clears any conflicting filters, and navigates to
        // it. Only the current row stays non-interactive.
        const interactive = !isCurrent && !isJumping;
        return (
          <span key={node.id} className="flex items-center gap-1">
            {idx > 0 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              disabled={!interactive}
              onClick={() => onJump(node.id)}
              title={
                isCurrent
                  ? `${label} (this run) · ${node.status}`
                  : onPage
                  ? `Jump to ${label} · ${node.status}`
                  : `Jump to ${label} · ${node.status} · on another page`
              }
              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${statusTone} ${currentTone} ${
                interactive ? "hover-elevate active-elevate-2 cursor-pointer" : "cursor-default opacity-80"
              }`}
              data-testid={`lineage-chip-${currentId}-${node.id}`}
              data-current={isCurrent ? "true" : "false"}
            >
              <span>{label}</span>
              <code className="text-[10px] opacity-70">
                {node.id.slice(0, 8)}
              </code>
            </button>
          </span>
        );
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Task #1017 — admin-controlled per-org destinations for backfill alerts.
// Lives in this file (not its own page) so the settings sit right next to the
// thing they configure, matching the rest of this admin tool's layout.
// ---------------------------------------------------------------------------
interface BackfillNotificationSettings {
  slackWebhookUrl: string;
  emailRecipients: string[];
  updatedAt: string | null;
}
const NOTIFICATION_SETTINGS_PATH =
  "/api/crm/calls/transcripts/backfill/notification-settings";
const NOTIFICATION_SETTINGS_KEY = [NOTIFICATION_SETTINGS_PATH] as const;

// Exported for unit testing (Task #1044). The settings card is rendered from
// the admin transcript backfill page and otherwise has no consumers.
export function BackfillNotificationSettingsCard() {
  const { toast } = useToast();
  const settingsQuery = useQuery<BackfillNotificationSettings>({
    queryKey: NOTIFICATION_SETTINGS_KEY,
  });

  // Task #1053 — track the per-org test-alert cooldown so the button can be
  // disabled (with a countdown tooltip) until the cooldown clears. Lives
  // alongside the button rather than in the parent so a 429 from the
  // mutation can refresh both the cooldown state and the audit row in one
  // place.
  const cooldownQuery = useQuery<{
    latest: LatestTestAlert | null;
    cooldownSeconds: number;
    nextAllowedAt: string | null;
  }>({
    queryKey: TEST_ALERT_LATEST_KEY,
  });
  const nextAllowedAtIso = cooldownQuery.data?.nextAllowedAt ?? null;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!nextAllowedAtIso) return;
    const targetMs = new Date(nextAllowedAtIso).getTime();
    if (targetMs <= Date.now()) return;
    setNowMs(Date.now());
    const tickId = window.setInterval(() => setNowMs(Date.now()), 1000);
    // Once the cooldown should be over, refresh the audit/cooldown query so
    // the server-side `nextAllowedAt` clears and the button re-enables.
    const clearId = window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_LATEST_KEY });
    }, Math.max(250, targetMs - Date.now() + 250));
    return () => {
      window.clearInterval(tickId);
      window.clearTimeout(clearId);
    };
  }, [nextAllowedAtIso]);
  const cooldownRemainingSec = nextAllowedAtIso
    ? Math.max(
        0,
        Math.ceil((new Date(nextAllowedAtIso).getTime() - nowMs) / 1000),
      )
    : 0;
  const isInCooldown = cooldownRemainingSec > 0;
  const cooldownTooltip = isInCooldown
    ? `Rate-limited — try again in ${cooldownRemainingSec}s (at ${format(
        new Date(nextAllowedAtIso!),
        "p",
      )})`
    : "Dispatch sample completion + failure notifications using the saved Slack webhook and email recipients";

  // Task #1030 — verify the *currently-saved* destinations end-to-end.
  // Living inside the settings card (rather than the controls card) keeps
  // the verify-after-save flow obvious: configure, save, then test.
  const testAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        "/api/crm/calls/transcripts/backfill/test-alert",
        {},
      );
      return (await res.json()) as {
        slack: { configured: boolean; ok: boolean; error?: string };
        email: {
          configured: boolean;
          ok: boolean;
          error?: string;
          recipients?: string[];
        };
        operatorDisplay: string;
      };
    },
    onSuccess: (data) => {
      // Task #1053 — a successful send starts a fresh cooldown window on the
      // server; refresh the audit/cooldown query so the button disables
      // immediately instead of waiting for the next mount.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_LATEST_KEY });
      const { slack, email } = data;
      if (!slack.configured && !email.configured) {
        toast({
          title: "No alert destinations configured",
          description:
            "Save a Slack webhook URL or at least one email recipient above, then try again.",
          variant: "destructive",
        });
        return;
      }
      if (slack.configured) {
        toast({
          title: slack.ok ? "Slack test alert sent" : "Slack test alert failed",
          description: slack.ok
            ? "Check your Slack channel for two sample alerts (completed + failed)."
            : slack.error ?? "Unknown error.",
          variant: slack.ok ? "default" : "destructive",
        });
      }
      if (email.configured) {
        const recipientText =
          email.recipients && email.recipients.length > 0
            ? ` to ${email.recipients.join(", ")}`
            : "";
        toast({
          title: email.ok ? "Email test alert sent" : "Email test alert failed",
          description: email.ok
            ? `Sent two sample alerts (completed + failed)${recipientText}.`
            : email.error ?? "Unknown error.",
          variant: email.ok ? "default" : "destructive",
        });
      }
    },
    onError: (err: Error) => {
      // Task #1053 — refresh the cooldown query so the rate-limit window is
      // picked up even when the client clock skewed past the previous
      // `nextAllowedAt`. Covers the 429 case as well as any other failure
      // that should re-sync the audit row.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_LATEST_KEY });
      toast({
        title: "Failed to send test alert",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [emailRecipientsRaw, setEmailRecipientsRaw] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !hydrated) {
      setSlackWebhookUrl(settingsQuery.data.slackWebhookUrl ?? "");
      setEmailRecipientsRaw((settingsQuery.data.emailRecipients ?? []).join(", "));
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const recipients = emailRecipientsRaw
        .split(/[,\n;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest("PUT", NOTIFICATION_SETTINGS_PATH, {
        slackWebhookUrl: slackWebhookUrl.trim(),
        emailRecipients: recipients,
      });
      return (await res.json()) as BackfillNotificationSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATION_SETTINGS_KEY, data);
      setSlackWebhookUrl(data.slackWebhookUrl ?? "");
      setEmailRecipientsRaw((data.emailRecipients ?? []).join(", "));
      toast({
        title: "Notification settings saved",
        description: "Future backfill alerts will use the new destinations.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save notification settings",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card data-testid="card-notification-settings">
      <CardHeader className="pb-3">
        <CardTitle>Backfill alert destinations</CardTitle>
        <CardDescription>
          Where to send Slack and email notifications when a transcript backfill
          run completes or fails. Leave blank to silence that channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="slack-webhook-url" className="text-xs">
            Slack incoming webhook URL
          </Label>
          <Input
            id="slack-webhook-url"
            type="url"
            placeholder="https://hooks.slack.com/services/…"
            value={slackWebhookUrl}
            onChange={(e) => setSlackWebhookUrl(e.target.value)}
            disabled={settingsQuery.isLoading}
            data-testid="input-slack-webhook"
          />
          <p className="text-xs text-muted-foreground">
            Must start with <code>https://hooks.slack.com/</code>. Leave empty
            to disable Slack alerts.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email-recipients" className="text-xs">
            Email recipients
          </Label>
          <Input
            id="email-recipients"
            type="text"
            placeholder="alerts@example.com, ops@example.com"
            value={emailRecipientsRaw}
            onChange={(e) => setEmailRecipientsRaw(e.target.value)}
            disabled={settingsQuery.isLoading}
            data-testid="input-email-recipients"
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated list (up to 50). Leave empty to disable email
            alerts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || settingsQuery.isLoading}
            data-testid="button-save-notification-settings"
          >
            {saveMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save settings
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => testAlertMutation.mutate()}
            disabled={
              testAlertMutation.isPending ||
              saveMutation.isPending ||
              settingsQuery.isLoading ||
              isInCooldown
            }
            data-testid="button-send-test-alert"
            title={cooldownTooltip}
          >
            {testAlertMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send test alert
          </Button>
          {isInCooldown && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="text-test-alert-cooldown"
            >
              Available again in {cooldownRemainingSec}s
            </span>
          )}
          {settingsQuery.data?.updatedAt && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="text-notification-settings-updated-at"
            >
              Last updated {format(new Date(settingsQuery.data.updatedAt), "PPpp")}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Task #1031 — recent alert delivery history. Surfaces the per-channel
// outcome of the last ~10 dispatch attempts so admins can spot a misconfigured
// webhook or recipient list immediately, instead of waiting for someone to
// notice the silence and dig through server logs.
// ---------------------------------------------------------------------------
interface BackfillAlertDelivery {
  id: string;
  jobId: string | null;
  channel: "slack" | "email";
  status: "success" | "failure";
  recipientSummary: string;
  errorMessage: string | null;
  attemptedAt: string;
}

interface BackfillAlertDeliveriesResponse {
  deliveries: BackfillAlertDelivery[];
}

const ALERT_DELIVERIES_PATH =
  "/api/crm/calls/transcripts/backfill/alert-deliveries?limit=10";
const ALERT_DELIVERIES_KEY = [ALERT_DELIVERIES_PATH] as const;

function BackfillAlertDeliveriesCard() {
  const deliveriesQuery = useQuery<BackfillAlertDeliveriesResponse>({
    queryKey: ALERT_DELIVERIES_KEY,
  });

  const deliveries = deliveriesQuery.data?.deliveries ?? [];

  return (
    <Card data-testid="card-alert-deliveries">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Recent alert deliveries</CardTitle>
            <CardDescription>
              The last {deliveries.length || 10} attempts to dispatch a
              transcript backfill alert. Use this to confirm that Slack /
              email destinations are wired up correctly.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ALERT_DELIVERIES_KEY })
            }
            disabled={deliveriesQuery.isFetching}
            data-testid="button-refresh-alert-deliveries"
          >
            {deliveriesQuery.isFetching ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {deliveriesQuery.isLoading ? (
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            data-testid="status-loading-alert-deliveries"
          />
        ) : deliveriesQuery.isError ? (
          <div
            className="text-sm text-destructive"
            data-testid="text-alert-deliveries-error"
          >
            Failed to load alert delivery history.
          </div>
        ) : deliveries.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-alert-deliveries-empty"
          >
            No alert dispatches recorded yet. Run a backfill (or send a test
            alert) and the per-channel outcome will appear here.
          </div>
        ) : (
          <ul className="divide-y" data-testid="list-alert-deliveries">
            {deliveries.map((d) => (
              <li
                key={d.id}
                className="py-2.5 flex items-start gap-3"
                data-testid={`row-alert-delivery-${d.id}`}
              >
                {d.status === "success" ? (
                  <CheckCircle2
                    className="h-4 w-4 mt-0.5 text-green-600 shrink-0"
                    data-testid={`icon-alert-success-${d.id}`}
                  />
                ) : (
                  <AlertTriangle
                    className="h-4 w-4 mt-0.5 text-destructive shrink-0"
                    data-testid={`icon-alert-failure-${d.id}`}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge
                      variant={d.channel === "slack" ? "secondary" : "outline"}
                      data-testid={`badge-alert-channel-${d.id}`}
                    >
                      {d.channel}
                    </Badge>
                    <Badge
                      variant={d.status === "success" ? "default" : "destructive"}
                      data-testid={`badge-alert-status-${d.id}`}
                    >
                      {d.status}
                    </Badge>
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid={`text-alert-attempted-at-${d.id}`}
                      title={d.attemptedAt}
                    >
                      {format(new Date(d.attemptedAt), "PPpp")}
                    </span>
                  </div>
                  <div
                    className="text-xs text-muted-foreground mt-0.5 truncate"
                    data-testid={`text-alert-recipients-${d.id}`}
                    title={d.recipientSummary}
                  >
                    To: {d.recipientSummary || "(unspecified)"}
                  </div>
                  {d.errorMessage && (
                    <div
                      className="text-xs text-destructive mt-0.5 break-words"
                      data-testid={`text-alert-error-${d.id}`}
                    >
                      {d.errorMessage}
                    </div>
                  )}
                  {d.jobId && (
                    <div
                      className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate"
                      data-testid={`text-alert-job-${d.id}`}
                      title={d.jobId}
                    >
                      job: {d.jobId}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
