import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  Ban,
  RotateCcw,
  Download,
  ListChecks,
  ExternalLink,
  ArrowRight,
  Send,
  Bell,
  Mail,
  BellOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format, formatDistanceStrict } from "date-fns";
import {
  LineChart as RechartsLineChart,
  Line as RechartsLine,
  ResponsiveContainer as RechartsResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";

// Task #1057 — CANCELLED is rendered with its own badge variant + label so
// admins can tell a deliberately-stopped run apart from a crash. Existing
// FAILED rows continue to render exactly as before.
type BackfillJobStatus = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

interface BackfillJob {
  id: string;
  status: BackfillJobStatus;
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
  // Task #1070 — populated when an admin cancelled the run. `cancelledBy`
  // is null on COMPLETED / FAILED rows or when the user record was
  // deleted; `cancellationReason` is null when the canceller didn't enter
  // free-text. Optional so older cached responses don't break the UI.
  cancelledBy?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
  cancellationReason?: string | null;
}

interface BackfillLineageNode {
  id: string;
  status: BackfillJobStatus;
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

// Task #1090 — quick-pick of users who have cancelled at least one run
// in the current org scope. Reuses the operator shape so the dropdown
// renders identically (name — email (jobCount)).
interface BackfillCancellersResponse {
  cancellers: BackfillOperator[];
}

// Task #1032 — read-only summary of which alert destinations are wired up
// server-side. The Slack webhook URL is intentionally NOT included.
// Task #1063 — also carries the persisted last-test outcome so the env-var
// summary panel can render the same inline health indicator the per-org
// settings card shows. `usingEnvFallback` is true when no per-org settings
// row exists (the resolver is using the legacy env vars).
interface NotificationConfig {
  slack: { configured: boolean; valid: boolean };
  email: { configured: boolean; recipients: string[] };
  lastTestAt: string | null;
  lastTestResult: BackfillTestAlertResult | null;
  usingEnvFallback: boolean;
  // Task #1078 — heartbeat staleness window in ms (5 min default, tunable via
  // CRM_BACKFILL_HEARTBEAT_STALE_SECONDS server-side). Used to render the
  // cross-org Cancel hint copy so the UI reflects the live server threshold
  // instead of a hardcoded "5 minutes". Optional so older deploys/tests that
  // don't include it gracefully fall back to the default.
  heartbeatStaleMs?: number;
  // Task #1130 — operator's originally-requested staleness window in ms,
  // before clamping to the [30s, 60min] band. Null when the env var is
  // unset or could not be parsed (the resolver fell back to the default).
  // When this differs from `heartbeatStaleMs` the admin UI renders a
  // subtle "(clamped from X)" hint so ops can spot a silently-overridden
  // env value without reading the source.
  heartbeatStaleRequestedMs?: number | null;
}

// Task #1078 — render the heartbeat staleness window in the most natural unit
// for the cross-org Cancel hint. Whole minutes get "X minutes"; sub-minute
// values fall back to seconds so an ops-tuned 90s window doesn't render as
// "1.5 minutes". Singular/plural handled to keep the copy readable.
function formatHeartbeatStaleWindow(ms: number | undefined): string {
  const fallbackMs = 5 * 60 * 1000;
  const value = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : fallbackMs;
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (totalSeconds < 60) {
    return `${totalSeconds} ${totalSeconds === 1 ? "second" : "seconds"}`;
  }
  const minutes = totalSeconds / 60;
  const rounded = Math.round(minutes * 10) / 10;
  return `${rounded} minutes`;
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
// Task #1052 — paginated history of every test-alert click. SUPER_ADMINs may
// see entries from other orgs (when no org filter is applied) so the row
// optionally carries org name/slug.
interface TestAlertHistoryEntry extends LatestTestAlert {
  organizationId: string;
  organizationName: string | null;
  organizationSlug: string | null;
}
interface TestAlertHistoryResponse {
  total: number;
  limit: number;
  offset: number;
  crossOrg: boolean;
  alerts: TestAlertHistoryEntry[];
}
const TEST_ALERT_HISTORY_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/history";
const TEST_ALERT_HISTORY_KEY_BASE = [TEST_ALERT_HISTORY_PATH] as const;
const TEST_ALERT_HISTORY_PAGE_SIZE = 10;
// Task #1060 — usage frequency rollup (counts in last 24h / 7d / 30d) so
// admins can spot misuse at a glance without scrolling the full audit list.
interface TestAlertUsageResponse {
  last24h: number;
  last7d: number;
  last30d: number;
  windowEndsAt: string;
  crossOrg: boolean;
}
const TEST_ALERT_USAGE_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/usage";
const TEST_ALERT_USAGE_KEY_BASE = [TEST_ALERT_USAGE_PATH] as const;
// Task #1093 — per-day bucket endpoint that powers the inline sparkline
// rendered next to the 24h/7d/30d rollup so admins can spot week-over-week
// trends at a glance instead of just point-in-time totals.
interface TestAlertUsageBucket {
  day: string; // YYYY-MM-DD (UTC)
  count: number;
}
interface TestAlertUsageBucketsResponse {
  buckets: TestAlertUsageBucket[];
  windowEndsAt: string;
  days: number;
  crossOrg: boolean;
}
const TEST_ALERT_USAGE_BUCKETS_PATH =
  "/api/crm/calls/transcripts/backfill/test-alert/usage-buckets";
const TEST_ALERT_USAGE_BUCKETS_KEY_BASE = [
  TEST_ALERT_USAGE_BUCKETS_PATH,
] as const;
const TEST_ALERT_SPARKLINE_DAYS = 30;
const PAGE_SIZE = 20;
// Task #1057 — surface CANCELLED in the history filter so admins can isolate
// deliberately-stopped runs from crashes.
const STATUS_OPTIONS = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
type StatusFilter = "ALL" | (typeof STATUS_OPTIONS)[number];

// Task #1070 — reusable Cancel-with-reason button. Wraps the existing
// `cancelMutation` in an AlertDialog that lets the operator type an
// optional free-text reason (max 500 chars, enforced server-side too)
// before confirming. The reason is forwarded to the server so it can be
// persisted on the job row and surfaced in the active card, history rows,
// and the run-completed Slack/email summary.
function CancelBackfillButton(props: {
  jobId: string;
  isPending: boolean;
  isThisJob: boolean;
  onConfirm: (reason: string) => void;
  testId: string;
  title?: string;
  variant?: "outline" | "destructive";
}) {
  const { jobId, isPending, isThisJob, onConfirm, testId, title, variant = "outline" } = props;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const tooLong = trimmed.length > 500;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          disabled={isPending && isThisJob}
          data-testid={testId}
          title={title}
        >
          {isPending && isThisJob ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <X className="h-4 w-4 mr-1.5" />
          )}
          Cancel backfill
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent data-testid={`dialog-cancel-backfill-${jobId}`}>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel transcript backfill?</AlertDialogTitle>
          <AlertDialogDescription>
            The worker will stop after the current recording finishes. You can
            optionally record why you're stopping the run — it will be shown
            on the active job card, in the history row, and in the
            run-completed Slack/email summary.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`cancel-reason-${jobId}`} className="text-xs">
            Reason (optional, max 500 characters)
          </Label>
          <Textarea
            id={`cancel-reason-${jobId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong tenant, kicked off too many in parallel, etc."
            maxLength={600}
            rows={3}
            data-testid={`input-cancel-reason-${jobId}`}
          />
          {tooLong && (
            <p className="text-xs text-destructive" data-testid={`text-cancel-reason-too-long-${jobId}`}>
              Reason must be 500 characters or fewer.
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={`button-cancel-backfill-dismiss-${jobId}`}>
            Keep running
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={tooLong}
            onClick={() => {
              onConfirm(trimmed);
              setOpen(false);
              setReason("");
            }}
            data-testid={`button-cancel-backfill-confirm-${jobId}`}
          >
            Cancel backfill
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminTranscriptBackfillPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [maxRecords, setMaxRecords] = useState<string>("");
  const [concurrency, setConcurrency] = useState<string>("2");
  // Task #1036 — SUPER_ADMINs choose which tenant a new backfill targets when
  // launching from the platform admin view. Defaults to the super admin's own
  // org so the existing single-org workflow keeps behaving identically. The
  // value is a real organization id; org-scoped admins never see this picker.
  const [startTargetOrgId, setStartTargetOrgId] = useState<string>("");
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
  // Task #1090 — quick-pick "Cancelled by" filter. Mirrors the operator
  // dropdown but matches against the canceller column. "ALL" means no filter.
  const [cancellerId, setCancellerId] = useState<string>("ALL");
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

  // Task #1036 — initialise the start-target org picker to the super admin's
  // own organization so launching a backfill behaves identically to before
  // unless they explicitly pick another tenant.
  useEffect(() => {
    if (isSuperAdmin && !startTargetOrgId && user?.organizationId) {
      setStartTargetOrgId(user.organizationId);
    }
  }, [isSuperAdmin, startTargetOrgId, user?.organizationId]);

  // Reset to the first page whenever filters change so users don't end up
  // staring at an empty page because their previous offset is past the new
  // total.
  useEffect(() => {
    if (suppressFilterPageReset.current) {
      suppressFilterPageReset.current = false;
      return;
    }
    setPage(0);
  }, [statusFilter, appliedOperator, operatorId, cancellerId, startedAfter, startedBefore, orgFilter]);

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
    // Task #1090 — chainable canceller quick-pick. Independent of the operator
    // filter so admins can ask "every run Sam started that Jane cancelled".
    if (cancellerId !== "ALL") {
      params.cancelledById = cancellerId;
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
  }, [page, statusFilter, appliedOperator, operatorId, cancellerId, startedAfter, startedBefore, orgFilter, isSuperAdmin]);

  const hasActiveFilters =
    statusFilter !== "ALL" ||
    !!appliedOperator ||
    operatorId !== "ALL" ||
    cancellerId !== "ALL" ||
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

  // Task #1090 — quick-pick source for the new "Cancelled by" dropdown.
  // Refreshes whenever a job is cancelled (see cancelMutation.onSuccess) so a
  // newly-appearing canceller shows up without a manual reload.
  const cancellersQuery = useQuery<BackfillCancellersResponse>({
    queryKey: ["/api/crm/calls/transcripts/backfill/cancellers"],
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

  // Task #1063 — clear the persisted last-test outcome from the env-var
  // summary panel. Mirrors the dismiss action on the per-org settings card
  // (both hit the same DELETE endpoint, since the lastTest fields live on
  // the same per-org settings row). We invalidate both queries so the panel
  // disappears in either card immediately.
  const dismissNotificationConfigTestResultMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(
        "DELETE",
        "/api/crm/calls/transcripts/backfill/notification-settings/last-test",
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/notification-config"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/notification-settings"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't dismiss the last test result",
        description: err.message,
        variant: "destructive",
      });
    },
  });

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
    setCancellerId("ALL");
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
      // Task #1090 — pass the canceller filter so the locate offset matches
      // the filtered listing.
      if (cancellerId !== "ALL") {
        params.set("cancelledById", cancellerId);
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
      // Task #1052 — also bust the paginated history list so the new row
      // shows up in the "Show previous tests" panel.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_HISTORY_KEY_BASE });
      // Task #1060 — refresh the usage rollup so the 24h/7d/30d counts tick
      // up immediately rather than lagging until the next manual reload.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_USAGE_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_USAGE_BUCKETS_KEY_BASE });
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
    mutationFn: async (overrideTargetOrgId?: string) => {
      const body: {
        maxRecords?: number;
        concurrency?: number;
        organizationId?: string;
      } = {};
      const max = parseInt(maxRecords, 10);
      if (Number.isFinite(max) && max > 0) body.maxRecords = max;
      const c = parseInt(concurrency, 10);
      if (Number.isFinite(c) && c > 0) body.concurrency = c;
      // Task #1036 — only super admins can target a different tenant. The
      // server ignores `organizationId` from org-scoped admins regardless,
      // so this is purely defence-in-depth on the client side.
      if (isSuperAdmin) {
        const targetId = overrideTargetOrgId ?? startTargetOrgId;
        if (targetId) body.organizationId = targetId;
      }
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

  // Task #1036 — cancel a running transcript backfill. Used by:
  //   * the Cancel button on each cross-org running-jobs row (super admin)
  //   * the Cancel button on the active job card (any admin, own org)
  // The server returns immediately (HTTP 202) and the worker flips the row
  // to FAILED on its next iteration, so we just refresh the summary/history
  // and let polling pick up the new status.
  const cancelMutation = useMutation({
    // Task #1070 — cancel now accepts an optional free-text `reason` so
    // admins can record why they stopped the run. The reason flows through
    // to the active job card, history rows, and the run-completed
    // Slack/email summary.
    mutationFn: async (vars: { jobId: string; reason?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/crm/calls/transcripts/backfill/${vars.jobId}/cancel`,
        vars.reason ? { reason: vars.reason } : {},
      );
      return (await res.json()) as {
        jobId: string;
        status: string;
        reaped?: boolean;
        message?: string;
      };
    },
    onSuccess: (data) => {
      toast({
        title: data.reaped ? "Backfill marked as failed" : "Cancellation requested",
        description:
          data.message ??
          (data.reaped
            ? "The worker had already stopped — the run is now marked as failed."
            : "The job will stop after the current recording finishes."),
      });
      queryClient.invalidateQueries({ queryKey: SUMMARY_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY_BASE });
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill", data.jobId],
      });
      // Task #1090 — refresh the "Cancelled by" quick-pick so the new
      // canceller (or an updated jobCount) shows up immediately.
      queryClient.invalidateQueries({
        queryKey: ["/api/crm/calls/transcripts/backfill/cancellers"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to cancel backfill",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      // Task #1141 — mirror the history fetch's filter precedence exactly so
      // the exported CSV matches the on-screen view: the operator quick-pick
      // takes precedence over the free-text operator input (they are
      // mutually exclusive server-side too), and the "Cancelled by"
      // quick-pick is independent.
      if (operatorId !== "ALL") {
        params.set("startedById", operatorId);
      } else if (appliedOperator) {
        params.set("operator", appliedOperator);
      }
      if (cancellerId !== "ALL") params.set("cancelledById", cancellerId);
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
              {/* Task #1063 — show the persisted last-test outcome inline so
                  platform support can spot a stale env-var config without
                  firing a fresh test. Only rendered when the env-var
                  fallback is in use; the per-org settings card already
                  shows the same panel when admins have a saved row. */}
              {notificationConfig.usingEnvFallback &&
                notificationConfig.lastTestResult &&
                notificationConfig.lastTestAt && (
                  <div data-testid="panel-notification-config-last-test">
                    <BackfillLastTestResultPanel
                      result={notificationConfig.lastTestResult}
                      testedAt={notificationConfig.lastTestAt}
                      onDismiss={() =>
                        dismissNotificationConfigTestResultMutation.mutate()
                      }
                      isDismissing={
                        dismissNotificationConfigTestResultMutation.isPending
                      }
                    />
                  </div>
                )}
            </dl>
          )}
        </CardContent>
      </Card>

      <BackfillAdminAlertFailureModesCard />

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
                    {/* Task #1036 — per-row super-admin actions: cancel a
                        runaway backfill in any tenant, or kick off a fresh
                        run directly against that tenant. The start action
                        is disabled while this row is still RUNNING (the
                        server would 409 anyway) — once cancellation lands
                        the row drops off and the start button on the next
                        refresh of the list (or the start-controls card) is
                        usable. We also offer a passive "Target this tenant"
                        shortcut that just pre-selects the org in the
                        Run-a-backfill picker for admins who want to set
                        maxRecords/concurrency before starting. */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <CancelBackfillButton
                        jobId={rj.id}
                        isPending={cancelMutation.isPending}
                        isThisJob={cancelMutation.variables?.jobId === rj.id}
                        onConfirm={(reason) =>
                          cancelMutation.mutate({ jobId: rj.id, reason: reason || undefined })
                        }
                        testId={`button-cross-org-cancel-${rj.id}`}
                        title={`Stop the running transcript backfill in ${orgLabel}`}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Reflect the chosen tenant in the start picker
                          // too so subsequent edits to maxRecords /
                          // concurrency stay scoped to the right org.
                          setStartTargetOrgId(rj.organization.id);
                          startMutation.mutate(rj.organization.id);
                        }}
                        disabled={startMutation.isPending}
                        data-testid={`button-cross-org-start-${rj.id}`}
                        title={`Start a fresh transcript backfill in ${orgLabel} (cancel the running one first to avoid a 409).`}
                      >
                        {startMutation.isPending &&
                        startMutation.variables === rj.organization.id ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-1.5" />
                        )}
                        Start backfill here
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setStartTargetOrgId(rj.organization.id);
                          requestAnimationFrame(() => {
                            const el = document.querySelector(
                              '[data-testid="card-controls"]',
                            );
                            if (el && "scrollIntoView" in el) {
                              (el as HTMLElement).scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                            }
                          });
                        }}
                        data-testid={`button-cross-org-target-${rj.id}`}
                        title={`Pre-select ${orgLabel} in the Run-a-backfill controls below`}
                      >
                        <ArrowRight className="h-4 w-4 mr-1.5" />
                        Target this tenant
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {/* Task #1074 — explain the cooperative-vs-reaped Cancel
                outcomes so support staff don't have to re-derive the
                heartbeat-staleness behavior every time they see the two
                different toasts. Task #1078 — render the live server-side
                threshold from notificationConfig.heartbeatStaleMs so an
                ops-tuned window (e.g. 10 minutes for slower workers)
                doesn't make this hint silently lie. */}
            <p
              className="mt-3 text-xs text-muted-foreground"
              data-testid="text-cross-org-cancel-hint"
            >
              Cancel asks the worker to stop after the current recording
              (&ldquo;Cancellation requested&rdquo;). If its heartbeat is older
              than {formatHeartbeatStaleWindow(notificationConfig?.heartbeatStaleMs)}{" "}
              {/* Task #1130 — annotate the threshold when the resolver had
                  to clamp the env value (e.g. ops set "20" expecting 20s and
                  it got rounded up to the 30-second floor) so admins see the
                  effective number alongside their stated intent without
                  cross-referencing the boot logs. */}
              {typeof notificationConfig?.heartbeatStaleRequestedMs === "number" &&
                notificationConfig.heartbeatStaleRequestedMs !==
                  notificationConfig.heartbeatStaleMs && (
                  <span
                    className="text-muted-foreground/80"
                    data-testid="text-cross-org-cancel-hint-clamped"
                  >
                    (clamped from{" "}
                    {formatHeartbeatStaleWindow(
                      notificationConfig.heartbeatStaleRequestedMs,
                    )}
                    ){" "}
                  </span>
                )}
              the worker is presumed dead and the row is reaped immediately to
              FAILED (&ldquo;Backfill marked as failed&rdquo;).
            </p>
          </CardContent>
        </Card>
      )}


      <Card data-testid="card-controls">
        <CardHeader className="pb-3">
          <CardTitle>Run a backfill</CardTitle>
          <CardDescription>
            Leave the limit blank to process every eligible recording. Concurrency caps how many
            transcriptions run in parallel (max 4).
            {isSuperAdmin && (
              <>
                {" "}
                As a super admin you can target any tenant from the picker below.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Task #1036 — SUPER_ADMIN-only target-tenant picker. Defaults to
              the super admin's own org so the existing single-org workflow
              keeps working unchanged; switching it scopes the next "Start
              backfill" click to the chosen tenant. Org-scoped admins never
              see this control and the server ignores the field for them. */}
          {isSuperAdmin && (
            <div className="space-y-1.5">
              <Label htmlFor="start-target-organization" className="text-xs">
                Target organization
              </Label>
              <Select
                value={startTargetOrgId}
                onValueChange={(v) => setStartTargetOrgId(v)}
                disabled={orgsQuery.isLoading}
              >
                <SelectTrigger
                  id="start-target-organization"
                  data-testid="select-start-target-organization"
                >
                  <SelectValue placeholder="Pick a tenant" />
                </SelectTrigger>
                <SelectContent>
                  {(orgsQuery.data ?? []).map((org) => (
                    <SelectItem
                      key={org.id}
                      value={org.id}
                      data-testid={`select-start-target-organization-option-${org.id}`}
                    >
                      {org.name}
                      {org.id === user?.organizationId ? " (your org)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                className="text-[11px] text-muted-foreground"
                data-testid="text-start-target-help"
              >
                The start button below targets the tenant selected here. The
                pending count and cross-org running list above are scoped by
                the separate History organization picker.
              </p>
            </div>
          )}
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
              onClick={() => startMutation.mutate(undefined)}
              disabled={
                startMutation.isPending ||
                isRunning ||
                (isSuperAdmin
                  ? !startTargetOrgId
                  : pending === 0)
              }
              data-testid="button-start-backfill"
              title={
                isSuperAdmin && !startTargetOrgId
                  ? "Pick a target organization first."
                  : undefined
              }
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
          <TestAlertUsageSummary
            isSuperAdmin={isSuperAdmin}
            orgFilter={orgFilter}
          />
          <TestAlertHistoryPanel
            isSuperAdmin={isSuperAdmin}
            orgFilter={orgFilter}
          />
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
                  {/* Task #1057 — CANCELLED uses an outline badge + Ban icon
                      so it reads as "deliberately stopped" rather than the
                      destructive crash styling reserved for FAILED. */}
                  <Badge
                    variant={
                      job.status === "RUNNING"
                        ? "secondary"
                        : job.status === "COMPLETED"
                        ? "default"
                        : job.status === "CANCELLED"
                        ? "outline"
                        : "destructive"
                    }
                    data-testid="badge-job-status"
                  >
                    {job.status === "RUNNING" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    {job.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {job.status === "CANCELLED" && <Ban className="h-3 w-3 mr-1" />}
                    {job.status === "FAILED" && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {job.status === "CANCELLED" ? "Cancelled" : job.status}
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
              {/* Task #1036 — Cancel button on the active job card. Available
                  to any admin for their own org's RUNNING job; super admins
                  also get per-row cancel buttons in the cross-org list above. */}
              {job.status === "RUNNING" && (
                <CancelBackfillButton
                  jobId={job.id}
                  isPending={cancelMutation.isPending}
                  isThisJob={cancelMutation.variables?.jobId === job.id}
                  onConfirm={(reason) =>
                    cancelMutation.mutate({ jobId: job.id, reason: reason || undefined })
                  }
                  testId="button-cancel-active-backfill"
                  title="Stop this backfill after the current recording finishes"
                />
              )}
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
            {/* Task #1070 — surface who cancelled the run (and why) on the
                active job card. The block stays hidden for COMPLETED /
                FAILED runs and for legacy CANCELLED rows that pre-date the
                cancelledById column. */}
            {job.status === "CANCELLED" && (
              <div
                className="rounded-md border border-border bg-muted/40 p-3 text-xs space-y-1"
                data-testid="text-active-cancellation-summary"
              >
                <div>
                  <span className="text-muted-foreground">Cancelled by: </span>
                  <span
                    className="font-medium text-foreground"
                    data-testid="text-active-cancelled-by"
                  >
                    {job.cancelledBy
                      ? [job.cancelledBy.firstName, job.cancelledBy.lastName]
                          .filter(Boolean)
                          .join(" ") ||
                        job.cancelledBy.email ||
                        "(unknown)"
                      : "(unknown — user record was deleted)"}
                  </span>
                </div>
                {job.cancellationReason && (
                  <div>
                    <span className="text-muted-foreground">Reason: </span>
                    <span
                      className="text-foreground"
                      data-testid="text-active-cancellation-reason"
                    >
                      {job.cancellationReason}
                    </span>
                  </div>
                )}
              </div>
            )}
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
            {/* Task #1090 — "Cancelled by" quick-pick. Only the users who have
                actually cancelled at least one run in the current org scope
                appear here, so an empty dropdown is a meaningful signal that
                nobody has cancelled anything yet. */}
            <div className="space-y-1.5">
              <Label htmlFor="history-cancelled-by-select" className="text-xs">
                Cancelled by
              </Label>
              <Select
                value={cancellerId}
                onValueChange={(v) => setCancellerId(v)}
              >
                <SelectTrigger
                  id="history-cancelled-by-select"
                  data-testid="select-history-cancelled-by"
                >
                  <SelectValue placeholder="Anyone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="ALL"
                    data-testid="select-history-cancelled-by-option-ALL"
                  >
                    Anyone
                  </SelectItem>
                  {(cancellersQuery.data?.cancellers ?? []).map((op) => (
                    <SelectItem
                      key={op.id}
                      value={op.id}
                      data-testid={`select-history-cancelled-by-option-${op.id}`}
                    >
                      {formatOperatorOption(op)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(cancellersQuery.data?.cancellers ?? []).length === 0 &&
                !cancellersQuery.isLoading && (
                  <p
                    className="text-[11px] text-muted-foreground"
                    data-testid="text-history-cancelled-by-empty"
                  >
                    No cancelled runs yet.
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
                    setCancellerId("ALL");
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
                          {/* Task #1057 — match the active-job card: cancelled
                              runs get an outline badge + Ban icon so they
                              don't look like crashes. */}
                          <Badge
                            variant={
                              entry.status === "RUNNING"
                                ? "secondary"
                                : entry.status === "COMPLETED"
                                ? "default"
                                : entry.status === "CANCELLED"
                                ? "outline"
                                : "destructive"
                            }
                            data-testid={`badge-history-status-${entry.id}`}
                          >
                            {entry.status === "RUNNING" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                            {entry.status === "COMPLETED" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                            {entry.status === "CANCELLED" && <Ban className="h-3 w-3 mr-1" />}
                            {entry.status === "FAILED" && <AlertTriangle className="h-3 w-3 mr-1" />}
                            {entry.status === "CANCELLED" ? "Cancelled" : entry.status}
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
                        {/* Task #1070 — surface the canceller (and optional
                            reason) inline on each history row so admins can
                            see at a glance who stopped a run and why. Only
                            renders when both fields exist on the row to
                            stay quiet for legacy CANCELLED rows. */}
                        {entry.status === "CANCELLED" && (entry.cancelledBy || entry.cancellationReason) && (
                          <div
                            className="text-xs text-muted-foreground"
                            data-testid={`text-history-cancelled-by-${entry.id}`}
                          >
                            Cancelled by{" "}
                            <span className="font-medium text-foreground">
                              {entry.cancelledBy
                                ? [entry.cancelledBy.firstName, entry.cancelledBy.lastName]
                                    .filter(Boolean)
                                    .join(" ") ||
                                  entry.cancelledBy.email ||
                                  "(unknown)"
                                : "(unknown — user record was deleted)"}
                            </span>
                            {entry.cancellationReason && (
                              <>
                                {" · "}
                                <span data-testid={`text-history-cancellation-reason-${entry.id}`}>
                                  {entry.cancellationReason}
                                </span>
                              </>
                            )}
                          </div>
                        )}
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

// Task #1052 — collapsible "Show previous tests" panel that lists prior
// test-alert audit rows (newest first, paginated). Lives right under the
// latest-indicator so admins debugging a flaky channel can scroll back
// through several attempts without dropping into a SQL session. SUPER_ADMINs
// see entries from every org by default and can scope to a single tenant
// via the page's existing org picker (the same `orgFilter` that drives the
// main backfill history grid above).
// Task #1060 — compact "how often is this button being used" rollup. Sits
// between the latest-test indicator and the (collapsed) history list so an
// admin can spot misuse / runaway scripts at a glance ("12 in the last 24h
// is way too many") without expanding the full audit log. Counts respect the
// page's existing org-scope picker for SUPER_ADMINs.
function TestAlertUsageSummary({
  isSuperAdmin,
  orgFilter,
}: {
  isSuperAdmin: boolean;
  orgFilter: string;
}) {
  const queryParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
      params.organizationId = orgFilter;
    }
    return params;
  }, [isSuperAdmin, orgFilter]);

  const query = useQuery<TestAlertUsageResponse>({
    queryKey: [...TEST_ALERT_USAGE_KEY_BASE, queryParams],
  });

  // Task #1093 — fetch per-day counts to render an inline sparkline next to
  // the 24h/7d/30d totals so admins can eyeball trends ("usage doubled
  // week over week") instead of only seeing point-in-time numbers.
  const bucketParams = useMemo(() => {
    const params: Record<string, string> = { days: String(TEST_ALERT_SPARKLINE_DAYS) };
    if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
      params.organizationId = orgFilter;
    }
    return params;
  }, [isSuperAdmin, orgFilter]);
  const bucketsQuery = useQuery<TestAlertUsageBucketsResponse>({
    queryKey: [...TEST_ALERT_USAGE_BUCKETS_KEY_BASE, bucketParams],
  });

  if (query.isLoading) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="status-test-alert-usage-loading"
      >
        Loading test alert usage…
      </p>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p
        className="text-xs text-destructive"
        data-testid="text-test-alert-usage-error"
      >
        Couldn't load test alert usage.
      </p>
    );
  }

  const { last24h, last7d, last30d, crossOrg } = query.data;
  const scopeLabel = crossOrg ? "across all orgs" : "in this org";

  return (
    <div
      className="flex flex-wrap items-center gap-3 text-xs"
      data-testid="panel-test-alert-usage"
    >
      <span className="text-muted-foreground">
        Test alerts sent {scopeLabel}:
      </span>
      <span data-testid="text-test-alert-usage-24h">
        <span className="font-medium text-foreground">
          {last24h.toLocaleString()}
        </span>{" "}
        <span className="text-muted-foreground">in last 24h</span>
      </span>
      <span data-testid="text-test-alert-usage-7d">
        <span className="font-medium text-foreground">
          {last7d.toLocaleString()}
        </span>{" "}
        <span className="text-muted-foreground">in last 7d</span>
      </span>
      <span data-testid="text-test-alert-usage-30d">
        <span className="font-medium text-foreground">
          {last30d.toLocaleString()}
        </span>{" "}
        <span className="text-muted-foreground">in last 30d</span>
      </span>
      <TestAlertUsageSparkline query={bucketsQuery} />
    </div>
  );
}

// Task #1093 — small inline sparkline of daily test-alert counts over the
// last 30 days. Rendered next to the 24h/7d/30d totals so admins can spot
// week-over-week trends ("usage doubled week over week") instead of only
// seeing point-in-time numbers. Uses a fixed pixel size (no axes / grid)
// so it stays visually a sparkline rather than a full chart, and degrades
// gracefully when there is no data to plot.
function TestAlertUsageSparkline({
  query,
}: {
  query: ReturnType<
    typeof useQuery<TestAlertUsageBucketsResponse>
  >;
}) {
  if (query.isLoading) {
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid="status-test-alert-usage-sparkline-loading"
      >
        Loading trend…
      </span>
    );
  }
  if (query.isError || !query.data) {
    return (
      <span
        className="text-xs text-destructive"
        data-testid="text-test-alert-usage-sparkline-error"
      >
        trend unavailable
      </span>
    );
  }
  const buckets = query.data.buckets;
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (buckets.length === 0 || total === 0) {
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid="text-test-alert-usage-sparkline-empty"
      >
        no activity in last {query.data.days}d
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="chart-test-alert-usage-sparkline"
      aria-label={`Daily test alert counts over the last ${query.data.days} days`}
    >
      <span
        className="text-muted-foreground"
        data-testid="text-test-alert-usage-sparkline-label"
      >
        {query.data.days}d trend:
      </span>
      <span style={{ width: 120, height: 28, display: "inline-block" }}>
        <RechartsResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            data={buckets}
            margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
          >
            <RechartsTooltip
              cursor={false}
              contentStyle={{ fontSize: 11, padding: "2px 6px" }}
              labelFormatter={(label) => String(label)}
              formatter={(value: number) => [value, "alerts"]}
            />
            <RechartsLine
              type="monotone"
              dataKey="count"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </RechartsLineChart>
        </RechartsResponsiveContainer>
      </span>
    </span>
  );
}
// Task #1061 — channel-result filter values for the test-alert history
// panel. "ANY" means don't filter; the specific values map to slackOk /
// emailOk booleans on the backend.
type TestAlertResultFilter =
  | "ANY"
  | "SLACK_FAILED"
  | "EMAIL_FAILED"
  | "EITHER_FAILED"
  | "ALL_OK";

function TestAlertHistoryPanel({
  isSuperAdmin,
  orgFilter,
}: {
  isSuperAdmin: boolean;
  orgFilter: string;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  // Task #1096 — export the currently-filtered audit trail to CSV so admins
  // can share root-cause investigations offline without screenshotting.
  const [isExporting, setIsExporting] = useState(false);

  // Task #1061 — filter controls so admins can narrow the panel by sender,
  // channel result, and date range without scrolling page by page. Sender is
  // free-text + debounced; result/date changes apply immediately because
  // they come from explicit pickers.
  const [senderInput, setSenderInput] = useState("");
  const [appliedSender, setAppliedSender] = useState("");
  const [resultFilter, setResultFilter] =
    useState<TestAlertResultFilter>("ANY");
  const [sentAfter, setSentAfter] = useState<Date | undefined>(undefined);
  const [sentBefore, setSentBefore] = useState<Date | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setAppliedSender(senderInput.trim()), 300);
    return () => clearTimeout(t);
  }, [senderInput]);

  // Reset to the first page whenever the org scope or any filter changes so
  // a SUPER_ADMIN (or any admin who just narrowed the view) doesn't end up
  // staring at an empty page.
  useEffect(() => {
    setPage(0);
  }, [orgFilter, appliedSender, resultFilter, sentAfter, sentBefore]);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = {
      limit: String(TEST_ALERT_HISTORY_PAGE_SIZE),
      offset: String(page * TEST_ALERT_HISTORY_PAGE_SIZE),
    };
    if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
      params.organizationId = orgFilter;
    }
    if (appliedSender) params.sender = appliedSender;
    // Map the human-friendly result picker into the server's per-channel
    // booleans. EITHER_FAILED uses the dedicated `anyFailed` param because
    // it can't be expressed by ANDing slackOk/emailOk.
    if (resultFilter === "SLACK_FAILED") params.slackOk = "false";
    else if (resultFilter === "EMAIL_FAILED") params.emailOk = "false";
    else if (resultFilter === "EITHER_FAILED") params.anyFailed = "true";
    else if (resultFilter === "ALL_OK") params.anyFailed = "false";
    if (sentAfter) params.sentAfter = sentAfter.toISOString();
    if (sentBefore) {
      // Make the upper bound inclusive of the entire selected day.
      const end = new Date(sentBefore);
      end.setHours(23, 59, 59, 999);
      params.sentBefore = end.toISOString();
    }
    return params;
  }, [
    page,
    isSuperAdmin,
    orgFilter,
    appliedSender,
    resultFilter,
    sentAfter,
    sentBefore,
  ]);

  const hasActiveFilters =
    appliedSender.length > 0 ||
    resultFilter !== "ANY" ||
    !!sentAfter ||
    !!sentBefore;

  const query = useQuery<TestAlertHistoryResponse>({
    queryKey: [...TEST_ALERT_HISTORY_KEY_BASE, queryParams],
    enabled: expanded,
  });

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      // Mirror queryParams but drop pagination — the export streams the full
      // matching set, not the visible page.
      const params = new URLSearchParams();
      if (isSuperAdmin && orgFilter !== CROSS_ORG_VALUE) {
        params.set("organizationId", orgFilter);
      }
      if (appliedSender) params.set("sender", appliedSender);
      if (resultFilter === "SLACK_FAILED") params.set("slackOk", "false");
      else if (resultFilter === "EMAIL_FAILED") params.set("emailOk", "false");
      else if (resultFilter === "EITHER_FAILED") params.set("anyFailed", "true");
      else if (resultFilter === "ALL_OK") params.set("anyFailed", "false");
      if (sentAfter) params.set("sentAfter", sentAfter.toISOString());
      if (sentBefore) {
        const end = new Date(sentBefore);
        end.setHours(23, 59, 59, 999);
        params.set("sentBefore", end.toISOString());
      }
      const qs = params.toString();
      const url = `${TEST_ALERT_HISTORY_PATH}.csv${qs ? `?${qs}` : ""}`;
      const res = await apiRequest("GET", url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `transcript-backfill-test-alert-history-${stamp}.csv`;
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

  const total = query.data?.total ?? 0;
  const alerts = query.data?.alerts ?? [];
  const totalPages = Math.max(1, Math.ceil(total / TEST_ALERT_HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;
  const startIdx = total === 0 ? 0 : safePage * TEST_ALERT_HISTORY_PAGE_SIZE + 1;
  const endIdx = Math.min(total, (safePage + 1) * TEST_ALERT_HISTORY_PAGE_SIZE);
  const showCrossOrg = !!query.data?.crossOrg;

  return (
    <div data-testid="panel-test-alert-history">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-toggle-test-alert-history"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 mr-1" />
          ) : (
            <ChevronRight className="h-3 w-3 mr-1" />
          )}
          {expanded ? "Hide previous tests" : "Show previous tests"}
        </Button>
        {expanded && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleExportCsv}
            disabled={isExporting || query.isLoading || total === 0}
            data-testid="button-export-test-alert-history-csv"
            title="Download the currently filtered test-alert history as CSV"
          >
            {isExporting ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Download className="h-3 w-3 mr-1" />
            )}
            Download CSV
          </Button>
        )}
      </div>
      {expanded && (
        <div
          className="mt-2 space-y-2"
          data-testid="container-test-alert-history"
        >
          <div
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="test-alert-history-filters"
          >
            <div className="space-y-1">
              <Label
                htmlFor="test-alert-history-sender"
                className="text-[11px]"
              >
                Sender
              </Label>
              <Input
                id="test-alert-history-sender"
                value={senderInput}
                onChange={(e) => setSenderInput(e.target.value)}
                placeholder="Name or email"
                className="h-8 text-xs"
                data-testid="input-test-alert-history-sender"
              />
            </div>
            <div className="space-y-1">
              <Label
                htmlFor="test-alert-history-result"
                className="text-[11px]"
              >
                Result
              </Label>
              <Select
                value={resultFilter}
                onValueChange={(v) =>
                  setResultFilter(v as TestAlertResultFilter)
                }
              >
                <SelectTrigger
                  id="test-alert-history-result"
                  className="h-8 text-xs"
                  data-testid="select-test-alert-history-result"
                >
                  <SelectValue placeholder="Any result" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="ANY"
                    data-testid="select-test-alert-history-result-option-ANY"
                  >
                    Any result
                  </SelectItem>
                  <SelectItem
                    value="SLACK_FAILED"
                    data-testid="select-test-alert-history-result-option-SLACK_FAILED"
                  >
                    Slack failed
                  </SelectItem>
                  <SelectItem
                    value="EMAIL_FAILED"
                    data-testid="select-test-alert-history-result-option-EMAIL_FAILED"
                  >
                    Email failed
                  </SelectItem>
                  <SelectItem
                    value="EITHER_FAILED"
                    data-testid="select-test-alert-history-result-option-EITHER_FAILED"
                  >
                    Either failed
                  </SelectItem>
                  <SelectItem
                    value="ALL_OK"
                    data-testid="select-test-alert-history-result-option-ALL_OK"
                  >
                    All ok
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Sent after</Label>
              <DatePicker
                value={sentAfter ?? null}
                onChange={(d) => setSentAfter(d)}
                placeholder="Any date"
                data-testid="picker-test-alert-history-sent-after"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Sent before</Label>
              <DatePicker
                value={sentBefore ?? null}
                onChange={(d) => setSentBefore(d)}
                placeholder="Any date"
                data-testid="picker-test-alert-history-sent-before"
              />
            </div>
            {hasActiveFilters && (
              <div className="sm:col-span-2 lg:col-span-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setSenderInput("");
                    setAppliedSender("");
                    setResultFilter("ANY");
                    setSentAfter(undefined);
                    setSentBefore(undefined);
                  }}
                  data-testid="button-clear-test-alert-history-filters"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear filters
                </Button>
              </div>
            )}
          </div>
          {query.isLoading ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="status-test-alert-history-loading"
            >
              Loading previous tests…
            </p>
          ) : query.isError ? (
            <p
              className="text-xs text-destructive"
              data-testid="text-test-alert-history-error"
            >
              Couldn't load previous test alerts.
            </p>
          ) : alerts.length === 0 ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-test-alert-history-empty"
            >
              {hasActiveFilters
                ? "No previous test alerts match the current filters."
                : "No previous test alerts recorded."}
            </p>
          ) : (
            <>
              <ul
                className="space-y-2"
                data-testid="list-test-alert-history"
              >
                {alerts.map((entry) => {
                  const senderName = [entry.sentByFirstName, entry.sentByLastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  const sender =
                    senderName ||
                    entry.sentByEmail ||
                    entry.operatorDisplay ||
                    "Unknown user";
                  return (
                    <li
                      key={entry.id}
                      className="rounded-md border bg-muted/30 p-2 text-xs space-y-1"
                      data-testid={`row-test-alert-history-${entry.id}`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="text-muted-foreground">
                          <span
                            className="font-medium text-foreground"
                            data-testid={`text-test-alert-history-sender-${entry.id}`}
                          >
                            {sender}
                          </span>{" "}
                          <span
                            data-testid={`text-test-alert-history-time-${entry.id}`}
                          >
                            {format(
                              new Date(entry.sentAt),
                              "MMM d, yyyy 'at' h:mm a",
                            )}
                          </span>
                        </div>
                        {showCrossOrg && entry.organizationName && (
                          <Badge
                            variant="outline"
                            data-testid={`badge-test-alert-history-org-${entry.id}`}
                          >
                            {entry.organizationName}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entry.slackConfigured ? (
                          <Badge
                            variant={entry.slackOk ? "default" : "destructive"}
                            data-testid={`badge-test-alert-history-slack-${entry.id}`}
                          >
                            Slack: {entry.slackOk ? "ok" : "failed"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            data-testid={`badge-test-alert-history-slack-${entry.id}`}
                          >
                            Slack: not configured
                          </Badge>
                        )}
                        {entry.emailConfigured ? (
                          <Badge
                            variant={entry.emailOk ? "default" : "destructive"}
                            data-testid={`badge-test-alert-history-email-${entry.id}`}
                          >
                            Email: {entry.emailOk ? "ok" : "failed"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            data-testid={`badge-test-alert-history-email-${entry.id}`}
                          >
                            Email: not configured
                          </Badge>
                        )}
                      </div>
                      {(entry.slackError || entry.emailError) && (
                        <div
                          className="text-destructive"
                          data-testid={`text-test-alert-history-errors-${entry.id}`}
                        >
                          {entry.slackError && <div>Slack: {entry.slackError}</div>}
                          {entry.emailError && <div>Email: {entry.emailError}</div>}
                        </div>
                      )}
                      {entry.emailConfigured &&
                        entry.emailRecipients &&
                        entry.emailRecipients.length > 0 && (
                          <div
                            className="text-muted-foreground"
                            data-testid={`text-test-alert-history-recipients-${entry.id}`}
                          >
                            Email recipients:{" "}
                            {entry.emailRecipients.join(", ")}
                          </div>
                        )}
                    </li>
                  );
                })}
              </ul>
              <div
                className="flex flex-wrap items-center justify-between gap-2 pt-1"
                data-testid="test-alert-history-pagination"
              >
                <div
                  className="text-xs text-muted-foreground"
                  data-testid="text-test-alert-history-range"
                >
                  Showing{" "}
                  <span className="font-medium">{startIdx.toLocaleString()}</span>
                  –
                  <span className="font-medium">{endIdx.toLocaleString()}</span>{" "}
                  of <span className="font-medium">{total.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={!canPrev || query.isFetching}
                    data-testid="button-test-alert-history-prev"
                  >
                    <ChevronLeft className="h-3 w-3 mr-1" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!canNext || query.isFetching}
                    data-testid="button-test-alert-history-next"
                  >
                    Next
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          )}
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
        // Task #1057 — render CANCELLED with a neutral tone (not the
        // destructive red used for FAILED) so the lineage chip reflects
        // a deliberate stop rather than a crash.
        const statusTone =
          node.status === "COMPLETED"
            ? "border-green-500/40 text-green-700 dark:text-green-400"
            : node.status === "FAILED"
            ? "border-destructive/40 text-destructive"
            : node.status === "CANCELLED"
            ? "border-muted-foreground/60 text-muted-foreground"
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
interface BackfillTestAlertResult {
  slack: { configured: boolean; ok: boolean; error?: string };
  email: {
    configured: boolean;
    ok: boolean;
    error?: string;
    recipients?: string[];
  };
  operatorDisplay: string;
}

interface BackfillNotificationSettings {
  slackWebhookUrl: string;
  emailRecipients: string[];
  updatedAt: string | null;
  // Task #1045 — persisted last test-alert outcome so the settings card can
  // show the destinations' last-known health on load.
  lastTestAt: string | null;
  lastTestResult: BackfillTestAlertResult | null;
  // Task #1094 — admin-tunable test-alert breach threshold. `null` means the
  // service-level default in `testAlertThresholdDefault` is in effect.
  testAlertThresholdPerDay: number | null;
  testAlertThresholdDefault: number;
  // Task #1154 — admins can see how close they are to the breach threshold
  // without firing the test alert. `lastThresholdAlertAt` is the most
  // recent breach notification (null if one has never fired);
  // `testAlertCount24h` is the rolling 24h count ending at
  // `testAlertWindowEndsAt`.
  lastThresholdAlertAt: string | null;
  testAlertCount24h: number;
  testAlertWindowEndsAt: string;
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
      return (await res.json()) as BackfillTestAlertResult & {
        testedAt: string;
      };
    },
    onSuccess: (data) => {
      // Task #1053 — a successful send starts a fresh cooldown window on the
      // server; refresh the audit/cooldown query so the button disables
      // immediately instead of waiting for the next mount.
      // Task #1052 — also refresh the history panel so a click on this
      // card's "Send test alert" button updates the UI on the controls card
      // above without a manual reload.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_LATEST_KEY });
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_HISTORY_KEY_BASE });
      // Task #1060 — keep the usage rollup in sync with the new audit row.
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_USAGE_KEY_BASE });
      queryClient.invalidateQueries({ queryKey: TEST_ALERT_USAGE_BUCKETS_KEY_BASE });
      const { slack, email, operatorDisplay, testedAt } = data;
      // Task #1045 — sync the persisted last-test fields into the cached
      // settings so the inline health summary updates immediately without a
      // refetch round-trip.
      queryClient.setQueryData<BackfillNotificationSettings | undefined>(
        NOTIFICATION_SETTINGS_KEY,
        (prev) => ({
          slackWebhookUrl: prev?.slackWebhookUrl ?? "",
          emailRecipients: prev?.emailRecipients ?? [],
          updatedAt: prev?.updatedAt ?? null,
          lastTestAt: testedAt,
          lastTestResult: { slack, email, operatorDisplay },
          testAlertThresholdPerDay: prev?.testAlertThresholdPerDay ?? null,
          testAlertThresholdDefault: prev?.testAlertThresholdDefault ?? 20,
          // Task #1154 — preserve the breach metadata so the inline
          // "N / threshold in last 24h" line stays correct after a
          // successful test send (which doesn't itself update the count
          // until the usage query refetches).
          lastThresholdAlertAt: prev?.lastThresholdAlertAt ?? null,
          testAlertCount24h: prev?.testAlertCount24h ?? 0,
          testAlertWindowEndsAt:
            prev?.testAlertWindowEndsAt ?? new Date().toISOString(),
        }),
      );
      // The new test-alert click bumps the rolling 24h counter, so refetch
      // the settings query to pick up the fresh count + (potential) new
      // last-breach timestamp.
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
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
  // Task #1094 — kept as a string so the input can render an empty value
  // (which means "fall back to the service default") and so we can validate
  // before parsing on submit.
  const [thresholdRaw, setThresholdRaw] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (settingsQuery.data && !hydrated) {
      setSlackWebhookUrl(settingsQuery.data.slackWebhookUrl ?? "");
      setEmailRecipientsRaw((settingsQuery.data.emailRecipients ?? []).join(", "));
      setThresholdRaw(
        settingsQuery.data.testAlertThresholdPerDay == null
          ? ""
          : String(settingsQuery.data.testAlertThresholdPerDay),
      );
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);

  const thresholdDefault =
    settingsQuery.data?.testAlertThresholdDefault ?? 20;
  // Task #1154 — the value that the breach notifier actually compares
  // against: per-org override when set, service-level default otherwise.
  // Surfacing this (not the raw input value) keeps the inline "N / X in
  // last 24h" line honest while the admin is mid-edit.
  const effectiveThreshold =
    settingsQuery.data?.testAlertThresholdPerDay ?? thresholdDefault;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const recipients = emailRecipientsRaw
        .split(/[,\n;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      // An empty input clears the per-org override (back to the default).
      const trimmedThreshold = thresholdRaw.trim();
      let testAlertThresholdPerDay: number | null = null;
      if (trimmedThreshold !== "") {
        const parsedNum = Number(trimmedThreshold);
        if (!Number.isFinite(parsedNum) || !Number.isInteger(parsedNum)) {
          throw new Error("Threshold must be a whole number");
        }
        if (parsedNum < 0) {
          throw new Error("Threshold cannot be negative");
        }
        testAlertThresholdPerDay = parsedNum;
      }
      const res = await apiRequest("PUT", NOTIFICATION_SETTINGS_PATH, {
        slackWebhookUrl: slackWebhookUrl.trim(),
        emailRecipients: recipients,
        testAlertThresholdPerDay,
      });
      return (await res.json()) as BackfillNotificationSettings;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATION_SETTINGS_KEY, data);
      setSlackWebhookUrl(data.slackWebhookUrl ?? "");
      setEmailRecipientsRaw((data.emailRecipients ?? []).join(", "));
      setThresholdRaw(
        data.testAlertThresholdPerDay == null
          ? ""
          : String(data.testAlertThresholdPerDay),
      );
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

  // Task #1045 — clear the persisted last-test outcome from the settings
  // card. Optimistically updates the cache so the panel disappears
  // immediately; falls back to a refetch on error.
  const dismissTestResultMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(
        "DELETE",
        `${NOTIFICATION_SETTINGS_PATH}/last-test`,
      );
    },
    onSuccess: () => {
      queryClient.setQueryData<BackfillNotificationSettings | undefined>(
        NOTIFICATION_SETTINGS_KEY,
        (prev) =>
          prev
            ? { ...prev, lastTestAt: null, lastTestResult: null }
            : prev,
      );
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't dismiss the last test result",
        description: err.message,
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_SETTINGS_KEY });
    },
  });

  const lastTestResult = settingsQuery.data?.lastTestResult ?? null;
  const lastTestAt = settingsQuery.data?.lastTestAt ?? null;

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
        <div className="space-y-1.5">
          <Label htmlFor="test-alert-threshold" className="text-xs">
            Test-alert breach threshold (per 24h)
          </Label>
          <Input
            id="test-alert-threshold"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            placeholder={String(thresholdDefault)}
            value={thresholdRaw}
            onChange={(e) => setThresholdRaw(e.target.value)}
            disabled={settingsQuery.isLoading}
            data-testid="input-test-alert-threshold"
          />
          <p className="text-xs text-muted-foreground">
            Notify the destinations above when the test-alert button is
            clicked at least this many times in any 24h window. Leave empty
            to use the default of {thresholdDefault}; set to 0 to disable
            the breach alert entirely.
          </p>
          {settingsQuery.data && (
            <BackfillThresholdUsageSummary
              settings={settingsQuery.data}
              effectiveThreshold={effectiveThreshold}
            />
          )}
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
        {lastTestResult && lastTestAt && (
          <BackfillLastTestResultPanel
            result={lastTestResult}
            testedAt={lastTestAt}
            onDismiss={() => dismissTestResultMutation.mutate()}
            isDismissing={dismissTestResultMutation.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

// Task #1154 — inline summary for the Test-alert breach threshold input.
// Renders the rolling 24h count vs. the effective threshold so admins can
// see how close they are to a breach without firing the test alert, and
// the timestamp of the most recent breach notification (when present).
// Lives next to the threshold control so the audit context is right where
// the admin would tune the value.
function BackfillThresholdUsageSummary({
  settings,
  effectiveThreshold,
}: {
  settings: BackfillNotificationSettings;
  effectiveThreshold: number;
}) {
  const count = settings.testAlertCount24h;
  // Threshold of 0 disables the breach alert entirely; render a softer
  // status line so admins don't read the "0 / 0" rollup as an alarm.
  const disabled = effectiveThreshold === 0;
  const ratio = disabled ? 0 : count / effectiveThreshold;
  const tone = disabled
    ? "text-muted-foreground"
    : ratio >= 1
    ? "text-destructive"
    : ratio >= 0.8
    ? "text-amber-600 dark:text-amber-400"
    : "text-muted-foreground";
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
      data-testid="text-test-alert-threshold-usage"
    >
      <span className={`tabular-nums ${tone}`}>
        {disabled ? (
          <>
            <span data-testid="text-threshold-usage-count">
              {count.toLocaleString()}
            </span>{" "}
            test alerts in the last 24h (breach alert disabled)
          </>
        ) : (
          <>
            <span data-testid="text-threshold-usage-count">
              {count.toLocaleString()}
            </span>{" "}
            /{" "}
            <span data-testid="text-threshold-usage-limit">
              {effectiveThreshold.toLocaleString()}
            </span>{" "}
            in last 24h
          </>
        )}
      </span>
      {settings.lastThresholdAlertAt ? (
        <span
          className="text-muted-foreground"
          data-testid="text-last-threshold-alert-at"
          title={new Date(settings.lastThresholdAlertAt).toISOString()}
        >
          Last breach notification{" "}
          {format(new Date(settings.lastThresholdAlertAt), "PPpp")}
        </span>
      ) : (
        <span
          className="text-muted-foreground"
          data-testid="text-last-threshold-alert-at-empty"
        >
          No breach notifications yet
        </span>
      )}
    </div>
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
  // Task #1069 — provenance of this row. `automatic` rows are produced by
  // the regular backfill worker and continue to render as before.
  // `resend` rows include the acting admin so the UI can show
  // "Resent by Jane" alongside the new outcome.
  source?: "automatic" | "resend";
  triggeredBy?: { id: string; displayName: string } | null;
}

// Task #1079 — per-channel summary of how many active org admins muted the
// fallback fan-out (and how many would still receive it). Drives the
// "fallback suppressed (channel muted by N admins)" badge on failure rows
// so an admin reviewing the page realizes the rest of the team was also
// silenced and won't be re-pinged about the misconfiguration.
interface BackfillAlertFallbackChannelSummary {
  mutedAdminCount: number;
  effectiveRecipientCount: number;
}

// Task #1100 — org-wide digest-stream eligibility lives alongside the
// per-channel realtime counts so the badge can also surface "the daily
// digest fallback was silenced too" when nobody is opted into the digest
// stream. The digest is delivered per-org (not per-channel), so this
// counter sits at the top level.
interface BackfillAlertFallbackDigestSummary {
  eligibleRecipientCount: number;
  streamMutedAdminCount: number;
}

interface BackfillAlertFallbackMuteSummary {
  slack: BackfillAlertFallbackChannelSummary;
  email: BackfillAlertFallbackChannelSummary;
  digest?: BackfillAlertFallbackDigestSummary;
}

interface BackfillAlertDeliveriesResponse {
  deliveries: BackfillAlertDelivery[];
  fallbackMuteSummary?: BackfillAlertFallbackMuteSummary;
}

const ALERT_DELIVERIES_PATH =
  "/api/crm/calls/transcripts/backfill/alert-deliveries?limit=10";
const ALERT_DELIVERIES_KEY = [ALERT_DELIVERIES_PATH] as const;

export function BackfillAlertDeliveriesCard() {
  const { toast } = useToast();
  const deliveriesQuery = useQuery<BackfillAlertDeliveriesResponse>({
    queryKey: ALERT_DELIVERIES_KEY,
  });

  // Task #1050 — track which row's resend is in flight so we can show a
  // per-row spinner instead of disabling the entire list.
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Task #1068 — keep a per-row cooldown countdown so a successful resend
  // (or a 429 from the server, e.g. if a second admin already clicked) shows
  // a "try again in N seconds" hint and disables the button locally. State
  // value is the unix-ms wall-clock the cooldown ends at, ticked once a
  // second to drive the countdown label.
  const [cooldownUntil, setCooldownUntil] = useState<Record<string, number>>({});
  const [, setCooldownTick] = useState(0);
  // Re-run only when the set of active cooldowns changes (not every tick) so
  // we don't churn `setInterval` once per second.
  const hasActiveCooldown = Object.values(cooldownUntil).some(
    (t) => t > Date.now(),
  );
  useEffect(() => {
    if (!hasActiveCooldown) return;
    const interval = window.setInterval(() => setCooldownTick((n) => n + 1), 1000);
    return () => window.clearInterval(interval);
  }, [hasActiveCooldown]);
  const remainingSeconds = (deliveryId: string): number => {
    const until = cooldownUntil[deliveryId];
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  };
  const startCooldown = (deliveryId: string, seconds: number) => {
    setCooldownUntil((prev) => ({
      ...prev,
      [deliveryId]: Date.now() + seconds * 1000,
    }));
  };

  const resendMutation = useMutation({
    mutationFn: async (
      deliveryId: string,
    ): Promise<{ deliveryId: string; delivery: BackfillAlertDelivery }> => {
      // Drop the standard `apiRequest` helper here because it collapses every
      // non-2xx into a thrown Error with just the message — we need to read
      // the 429 body's `retryAfterSeconds` to drive the local countdown.
      const csrfMatch = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
      const headers: Record<string, string> = {};
      if (csrfMatch) headers["x-csrf-token"] = decodeURIComponent(csrfMatch[1]);
      const res = await fetch(
        `/api/crm/calls/transcripts/backfill/alert-deliveries/${deliveryId}/resend`,
        { method: "POST", headers, credentials: "include" },
      );
      const bodyText = await res.text();
      let parsed: unknown = null;
      if (bodyText) {
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          parsed = null;
        }
      }
      const isRecord = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null;
      const readString = (v: unknown): string | undefined =>
        typeof v === "string" ? v : undefined;
      const readNumber = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) ? v : undefined;

      if (!res.ok) {
        const errorMessage =
          (isRecord(parsed) ? readString(parsed.error) : undefined) ??
          bodyText ??
          `${res.status} ${res.statusText}`;
        const err = new Error(errorMessage) as Error & {
          status?: number;
          retryAfterSeconds?: number;
          deliveryId?: string;
        };
        err.status = res.status;
        err.deliveryId = deliveryId;
        const bodyRetry = isRecord(parsed)
          ? readNumber(parsed.retryAfterSeconds)
          : undefined;
        if (bodyRetry !== undefined) {
          err.retryAfterSeconds = bodyRetry;
        } else {
          const headerVal = res.headers.get("Retry-After");
          const headerRetry = headerVal ? parseInt(headerVal, 10) : NaN;
          if (Number.isFinite(headerRetry)) err.retryAfterSeconds = headerRetry;
        }
        throw err;
      }

      // Narrow the success body to the delivery shape this card consumes.
      // Anything missing/malformed is treated as a transport failure rather
      // than rendered as garbage.
      const deliveryRaw = isRecord(parsed) ? parsed.delivery : undefined;
      if (!isRecord(deliveryRaw)) {
        throw new Error("Resend response was missing the delivery payload.");
      }
      const id = readString(deliveryRaw.id);
      const channelRaw = readString(deliveryRaw.channel);
      const statusRaw = readString(deliveryRaw.status);
      const recipientSummary = readString(deliveryRaw.recipientSummary);
      const attemptedAt = readString(deliveryRaw.attemptedAt);
      const isChannel = (v: string | undefined): v is "slack" | "email" =>
        v === "slack" || v === "email";
      const isStatus = (v: string | undefined): v is "success" | "failure" =>
        v === "success" || v === "failure";
      if (!id || !attemptedAt || !isChannel(channelRaw) || !isStatus(statusRaw)) {
        throw new Error("Resend response had an unexpected shape.");
      }
      const delivery: BackfillAlertDelivery = {
        id,
        jobId: readString(deliveryRaw.jobId) ?? null,
        channel: channelRaw,
        status: statusRaw,
        recipientSummary: recipientSummary ?? "",
        errorMessage: readString(deliveryRaw.errorMessage) ?? null,
        attemptedAt,
      };
      return { deliveryId, delivery };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ALERT_DELIVERIES_KEY });
      // The server applies the same 30s window regardless of dispatch
      // outcome, so always start the local countdown here.
      startCooldown(data.deliveryId, 30);
      const ok = data.delivery.status === "success";
      toast({
        title: ok ? "Alert resent" : "Resend failed",
        description: ok
          ? `${data.delivery.channel} delivery to ${data.delivery.recipientSummary || "(unspecified)"} succeeded.`
          : data.delivery.errorMessage ??
            "The retry attempt also failed. Check the destination and try again.",
        variant: ok ? "default" : "destructive",
      });
    },
    onError: (
      err: Error & { status?: number; retryAfterSeconds?: number; deliveryId?: string },
    ) => {
      if (err.status === 429 && err.deliveryId) {
        startCooldown(err.deliveryId, err.retryAfterSeconds ?? 30);
      }
      toast({
        title: err.status === 429 ? "Slow down" : "Couldn't resend alert",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => setResendingId(null),
  });

  const deliveries = deliveriesQuery.data?.deliveries ?? [];
  const fallbackMuteSummary = deliveriesQuery.data?.fallbackMuteSummary;

  // Task #1146 — when both Slack and email realtime fan-outs would reach
  // zero admins AND at least one of those zeros is the result of an active
  // mute (rather than the org simply having no admins), the realtime alert
  // stream is fully silenced and a misconfigured webhook would never be
  // surfaced live. Promote that signal from a per-row badge to a top-of-card
  // banner so admins reviewing the page can't miss it. We also call out
  // when the daily-digest fallback is empty for the same reason, since in
  // that case tomorrow's rollup won't catch the failure either.
  const realtimeFanoutSilenced =
    !!fallbackMuteSummary &&
    fallbackMuteSummary.slack.effectiveRecipientCount === 0 &&
    fallbackMuteSummary.email.effectiveRecipientCount === 0 &&
    (fallbackMuteSummary.slack.mutedAdminCount > 0 ||
      fallbackMuteSummary.email.mutedAdminCount > 0);
  const digestFallbackSilenced =
    !!fallbackMuteSummary?.digest &&
    fallbackMuteSummary.digest.eligibleRecipientCount === 0 &&
    fallbackMuteSummary.digest.streamMutedAdminCount > 0;

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
      <CardContent className="space-y-3">
        {realtimeFanoutSilenced && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2"
            data-testid="alert-realtime-fanout-silenced"
          >
            <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">
                Realtime alert fan-out reaches nobody.
              </p>
              <p
                className="text-xs mt-0.5"
                data-testid="text-realtime-fanout-silenced-detail"
              >
                Every active admin has muted both the Slack and email
                alert-failure fallback channels (Slack muted by{" "}
                {fallbackMuteSummary!.slack.mutedAdminCount} admin
                {fallbackMuteSummary!.slack.mutedAdminCount === 1 ? "" : "s"};
                email muted by {fallbackMuteSummary!.email.mutedAdminCount}{" "}
                admin
                {fallbackMuteSummary!.email.mutedAdminCount === 1 ? "" : "s"}).
                Until at least one admin re-enables a channel, transcript
                backfill failures will not page anyone in real time
                {digestFallbackSilenced
                  ? " — and because the daily-digest fallback is also empty, tomorrow's rollup won't catch them either."
                  : "."}
              </p>
              <p className="text-xs mt-1">
                <Link
                  href="/settings/notifications#section-alert-failure-fallback-prefs"
                  className="underline"
                  data-testid="link-realtime-fanout-silenced-settings"
                >
                  Open notification preferences
                </Link>{" "}
                to re-enable a recipient.
              </p>
            </div>
          </div>
        )}
        {/* Task #1150 — proactively warn admins when nobody is opted into
            the daily alert-failure digest stream. Without this banner an
            org would only discover the empty digest after a per-row
            failure surfaced the suppression badge. We reuse the existing
            `fallbackMuteSummary.digest.eligibleRecipientCount === 0`
            signal returned by the deliveries endpoint, so no new server
            work is required. Suppressed when the broader Task #1146
            "realtime fan-out reaches nobody" banner is already on screen,
            because that banner already calls out the empty digest in its
            own copy and we don't want two amber banners stacked. */}
        {!realtimeFanoutSilenced &&
          fallbackMuteSummary?.digest &&
          fallbackMuteSummary.digest.eligibleRecipientCount === 0 && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              data-testid="banner-digest-fallback-empty"
              role="status"
            >
              <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div
                  className="font-medium"
                  data-testid="text-digest-fallback-empty-title"
                >
                  Daily alert-failure digest is going to nobody
                </div>
                <p className="mt-0.5 text-xs leading-snug">
                  No admin in this org is currently opted into the daily
                  alert-failure digest, so tomorrow's rollup of any
                  Slack/email delivery failures won't reach anyone. Update
                  the alert-failure email mode for at least one admin in{" "}
                  <Link
                    href="/settings/notifications#section-alert-failure-fallback-prefs"
                    className="underline text-primary"
                    data-testid="link-digest-fallback-empty-settings"
                  >
                    notification preferences
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}
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
                    {d.source === "resend" && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid={`text-alert-resent-by-${d.id}`}
                        title={
                          d.triggeredBy
                            ? `Manually resent by ${d.triggeredBy.displayName}`
                            : "Manually resent"
                        }
                      >
                        {d.triggeredBy
                          ? `· Resent by ${d.triggeredBy.displayName}`
                          : "· Manually resent"}
                      </span>
                    )}
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
                  {d.status === "failure" &&
                    fallbackMuteSummary &&
                    (() => {
                      // Task #1079 — when no admin would have received the
                      // realtime fan-out for this channel AND at least one
                      // admin actively muted it, surface that the silence
                      // is org-wide so the reviewer doesn't assume the
                      // rest of the team got pinged.
                      //
                      // Task #1100 — additionally, if every otherwise-
                      // eligible admin opted out of the daily digest
                      // stream (alert-failure-email mode set to
                      // realtime / none), the digest fallback is also
                      // empty for this org. Combine both signals into a
                      // single badge so the reviewer sees the full
                      // picture and the tooltip distinguishes which
                      // preference (per-channel mute vs. stream-mode)
                      // drives each suppression.
                      const sum = fallbackMuteSummary[d.channel];
                      if (!sum) return null;
                      if (sum.effectiveRecipientCount > 0) return null;
                      if (sum.mutedAdminCount <= 0) return null;
                      const n = sum.mutedAdminCount;
                      const digest = fallbackMuteSummary.digest;
                      const digestSuppressed =
                        !!digest &&
                        digest.eligibleRecipientCount === 0 &&
                        digest.streamMutedAdminCount > 0;
                      const m = digest?.streamMutedAdminCount ?? 0;
                      const label = digestSuppressed
                        ? `Realtime + digest fallback suppressed (channel muted by ${n} admin${n === 1 ? "" : "s"}; digest off for ${m} admin${m === 1 ? "" : "s"})`
                        : `Fallback suppressed (channel muted by ${n} admin${n === 1 ? "" : "s"})`;
                      return (
                        <div className="mt-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="gap-1 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-700/60 dark:bg-amber-950/40"
                                data-testid={`badge-fallback-suppressed-${d.id}`}
                              >
                                <BellOff className="h-3 w-3" />
                                {label}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs text-xs leading-snug"
                              data-testid={`tooltip-fallback-suppressed-${d.id}`}
                            >
                              <p>
                                No realtime fallback email went out for this{" "}
                                {d.channel} failure because every eligible
                                admin muted {d.channel} failures under "Alert
                                delivery failure fallback" in their
                                notification preferences.
                              </p>
                              {digestSuppressed && (
                                <p
                                  className="mt-1"
                                  data-testid={`text-digest-suppressed-${d.id}`}
                                >
                                  The daily digest fallback is also empty:
                                  every otherwise-eligible admin set their
                                  alert-failure email mode to "real-time only"
                                  or "none", so tomorrow's rollup won't catch
                                  this either.
                                </p>
                              )}
                              <p className="mt-1">
                                <Link
                                  href="/settings/notifications#section-alert-failure-fallback-prefs"
                                  className="underline text-primary"
                                  data-testid={`link-fallback-suppressed-settings-${d.id}`}
                                >
                                  Open notification preferences
                                </Link>{" "}
                                to change the per-channel mute
                                {digestSuppressed
                                  ? " or the alert-failure email mode."
                                  : "."}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })()}
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
                {d.status === "failure" && (() => {
                  const isPending = resendingId === d.id && resendMutation.isPending;
                  const cooldownLeft = remainingSeconds(d.id);
                  const onCooldown = cooldownLeft > 0;
                  return (
                    <div className="flex flex-col items-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setResendingId(d.id);
                          resendMutation.mutate(d.id);
                        }}
                        disabled={isPending || onCooldown}
                        data-testid={`button-resend-alert-${d.id}`}
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Resend
                      </Button>
                      {onCooldown && (
                        <span
                          className="text-[11px] text-muted-foreground"
                          data-testid={`text-resend-cooldown-${d.id}`}
                        >
                          Just resent — try again in {cooldownLeft}s
                        </span>
                      )}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Task #1085 — surface each active org admin's currently-saved
// `alertFailureEmailMode` (real-time / digest / both / none) so ops leads
// can see at a glance who falls into which bucket without opening every
// admin profile. The card flags orgs where no admin is on the realtime
// stream, since a misconfigured webhook would then only be noticed via
// the next day's digest.
interface BackfillAdminAlertFailureModeRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  alertFailureEmailMode: "both" | "realtime" | "digest" | "none";
  // Task #1102 — also surface the Task #1051 "silence all fallbacks" toggle
  // and the Task #1066 per-channel mute list so admins can confirm coverage
  // when a teammate mutes a channel.
  fallbackEnabled: boolean;
  fallbackMutedChannels: ("slack" | "email")[];
}

interface BackfillAdminAlertFailureModesResponse {
  admins: BackfillAdminAlertFailureModeRow[];
  realtimeRecipientCount: number;
  noRealtimeRecipients: boolean;
  // Task #1102 — aggregate "who would actually be paged on this channel"
  // counts after applying the realtime + per-channel mute + fully-disabled
  // filters. Optional so older API responses don't break the typing.
  slackRecipientCount?: number;
  emailRecipientCount?: number;
  fullyOptedOutCount?: number;
}

const ADMIN_ALERT_FAILURE_MODES_PATH =
  "/api/crm/calls/transcripts/backfill/admin-alert-failure-modes";

function modeBadgeProps(
  mode: BackfillAdminAlertFailureModeRow["alertFailureEmailMode"],
): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  description: string;
} {
  switch (mode) {
    case "both":
      return {
        label: "Real-time + digest",
        variant: "default",
        description:
          "Receives every per-failure email AND the daily digest (legacy default).",
      };
    case "realtime":
      return {
        label: "Real-time only",
        variant: "secondary",
        description:
          "Receives the per-failure pages but suppresses the daily digest.",
      };
    case "digest":
      return {
        label: "Digest only",
        variant: "outline",
        description:
          "Suppresses real-time pages — would only see a misconfigured webhook in the next day's digest.",
      };
    case "none":
      return {
        label: "None",
        variant: "destructive",
        description:
          "Silenced both streams; in-app history page is still updated.",
      };
  }
}

function adminDisplayName(row: BackfillAdminAlertFailureModeRow): string {
  const parts = [row.firstName, row.lastName].filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : row.email;
}

// Task #1139 — per-row inline action: lets ops leads change another
// admin's `alertFailureEmailMode` without leaving the page. The Select
// only stages the new mode; the actual PATCH only fires after the
// confirmation dialog is accepted (so misclicks can't silently re-route
// a teammate's alert subscription). The mutation invalidates the parent
// card's query so the row instantly reflects the new badge.
const ADMIN_ALERT_FAILURE_MODE_OPTIONS: Array<{
  value: BackfillAdminAlertFailureModeRow["alertFailureEmailMode"];
  label: string;
}> = [
  { value: "both", label: "Real-time + digest" },
  { value: "realtime", label: "Real-time only" },
  { value: "digest", label: "Digest only" },
  { value: "none", label: "None" },
];

function AdminAlertFailureModeChangeAction({
  row,
}: {
  row: BackfillAdminAlertFailureModeRow;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<
    BackfillAdminAlertFailureModeRow["alertFailureEmailMode"]
  >(row.alertFailureEmailMode);

  // Reset the staged value whenever the dialog reopens or the row's
  // current mode shifts (e.g. another tab updated it during a refetch).
  useEffect(() => {
    if (open) setPending(row.alertFailureEmailMode);
  }, [open, row.alertFailureEmailMode]);

  const mutation = useMutation({
    mutationFn: async (
      mode: BackfillAdminAlertFailureModeRow["alertFailureEmailMode"],
    ) => {
      const res = await apiRequest(
        "PATCH",
        `${ADMIN_ALERT_FAILURE_MODES_PATH}/${row.id}`,
        { alertFailureEmailMode: mode },
      );
      return (await res.json()) as {
        alertFailureEmailMode: BackfillAdminAlertFailureModeRow["alertFailureEmailMode"];
        previousMode: BackfillAdminAlertFailureModeRow["alertFailureEmailMode"];
        changed: boolean;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [ADMIN_ALERT_FAILURE_MODES_PATH],
      });
      const newLabel = modeBadgeProps(data.alertFailureEmailMode).label;
      toast({
        title: data.changed
          ? "Alert-failure mode updated"
          : "No change applied",
        description: data.changed
          ? `${adminDisplayName(row)} is now on "${newLabel}".`
          : `${adminDisplayName(row)} was already on "${newLabel}".`,
      });
      setOpen(false);
    },
    onError: (err: unknown) => {
      toast({
        title: "Failed to update alert-failure mode",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const currentLabel = modeBadgeProps(row.alertFailureEmailMode).label;
  const pendingLabel = modeBadgeProps(pending).label;
  const isNoOp = pending === row.alertFailureEmailMode;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          data-testid={`button-change-admin-alert-failure-mode-${row.id}`}
        >
          Change
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        data-testid={`dialog-change-admin-alert-failure-mode-${row.id}`}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Change alert-failure email mode?</AlertDialogTitle>
          <AlertDialogDescription>
            This updates the per-failure / digest stream that{" "}
            <span className="font-medium">{adminDisplayName(row)}</span>{" "}
            ({row.email}) receives when a transcript-backfill alert fails to
            deliver. Their notification preferences page will reflect the new
            value, and the change is recorded in the audit log under your
            account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 py-1">
          <Label
            htmlFor={`select-admin-alert-failure-mode-${row.id}`}
            className="text-xs text-muted-foreground"
          >
            Currently: <span className="font-medium">{currentLabel}</span>
          </Label>
          <Select
            value={pending}
            onValueChange={(v) =>
              setPending(
                v as BackfillAdminAlertFailureModeRow["alertFailureEmailMode"],
              )
            }
          >
            <SelectTrigger
              id={`select-admin-alert-failure-mode-${row.id}`}
              data-testid={`select-admin-alert-failure-mode-${row.id}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADMIN_ALERT_FAILURE_MODE_OPTIONS.map((opt) => (
                <SelectItem
                  key={opt.value}
                  value={opt.value}
                  data-testid={`option-admin-alert-failure-mode-${row.id}-${opt.value}`}
                >
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p
            className="text-xs text-muted-foreground"
            data-testid={`text-admin-alert-failure-mode-pending-${row.id}`}
          >
            New mode: <span className="font-medium">{pendingLabel}</span>
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel
            disabled={mutation.isPending}
            data-testid={`button-cancel-change-admin-alert-failure-mode-${row.id}`}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending || isNoOp}
            onClick={(e) => {
              // Keep the dialog open until the mutation resolves so the
              // user sees the spinner; we close it ourselves in onSuccess.
              e.preventDefault();
              mutation.mutate(pending);
            }}
            data-testid={`button-confirm-change-admin-alert-failure-mode-${row.id}`}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Confirm change
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Task #1102 — the card auto-refreshes every 30s so when an admin updates
// their fallback / digest preferences in another tab the recipient list on
// this page reflects the change without requiring a manual reload. Window
// focus also triggers a refetch via the React Query default. The polling
// is intentionally cheap (a small JOIN against `users`).
const ADMIN_ALERT_FAILURE_MODES_REFETCH_INTERVAL_MS = 30_000;

export function BackfillAdminAlertFailureModesCard() {
  const query = useQuery<BackfillAdminAlertFailureModesResponse>({
    queryKey: [ADMIN_ALERT_FAILURE_MODES_PATH],
    refetchInterval: ADMIN_ALERT_FAILURE_MODES_REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });

  const data = query.data;
  const admins = data?.admins ?? [];
  const noRealtime = data?.noRealtimeRecipients ?? false;
  const slackRecipientCount = data?.slackRecipientCount ?? 0;
  const emailRecipientCount = data?.emailRecipientCount ?? 0;
  const fullyOptedOutCount = data?.fullyOptedOutCount ?? 0;

  return (
    <Card data-testid="card-admin-alert-failure-modes">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Admin alert-failure email recipients</CardTitle>
            <CardDescription>
              Which admins are currently set to receive per-failure pages,
              the daily digest, both, or neither when a transcript backfill
              alert fails to deliver. Each admin picks their own mode under
              their notification preferences.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: [ADMIN_ALERT_FAILURE_MODES_PATH],
              })
            }
            disabled={query.isFetching}
            data-testid="button-refresh-admin-alert-failure-modes"
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
            data-testid="status-loading-admin-alert-failure-modes"
          />
        ) : query.isError ? (
          <div
            className="text-sm text-destructive"
            data-testid="text-admin-alert-failure-modes-error"
          >
            Failed to load admin alert-failure email modes.
          </div>
        ) : admins.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-admin-alert-failure-modes-empty"
          >
            No active org admins were found. Add at least one ADMIN user so
            backfill failure alerts have an in-org recipient.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Task #1102 — at-a-glance "who would actually be paged" tally
                across the org, after applying every opt-out the recipients
                have configured. Lets ops leads spot a coverage gap (e.g.
                "0 admins on Slack") without scanning every row. */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs"
              data-testid="summary-admin-alert-failure-coverage"
            >
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Slack page recipients</div>
                <div
                  className="text-sm font-medium"
                  data-testid="text-coverage-slack-count"
                >
                  {slackRecipientCount} of {admins.length}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Email page recipients</div>
                <div
                  className="text-sm font-medium"
                  data-testid="text-coverage-email-count"
                >
                  {emailRecipientCount} of {admins.length}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-muted-foreground">Fully silenced</div>
                <div
                  className="text-sm font-medium"
                  data-testid="text-coverage-fully-opted-out-count"
                >
                  {fullyOptedOutCount} of {admins.length}
                </div>
              </div>
            </div>
            {noRealtime && (
              <div
                className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2"
                data-testid="alert-no-realtime-recipients"
              >
                <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">
                    No admin is on the real-time stream.
                  </p>
                  <p className="text-xs mt-0.5">
                    A misconfigured webhook or SMTP outage would only be
                    surfaced via the next day's digest. Have at least one
                    admin switch their mode to "Real-time only" or
                    "Real-time + digest" under{" "}
                    <Link
                      href="/settings/notifications"
                      className="underline"
                      data-testid="link-no-realtime-settings"
                    >
                      notification preferences
                    </Link>
                    .
                  </p>
                </div>
              </div>
            )}
            <ul
              className="divide-y rounded-md border"
              data-testid="list-admin-alert-failure-modes"
            >
              {admins.map((row) => {
                const badge = modeBadgeProps(row.alertFailureEmailMode);
                const onRealtime =
                  row.alertFailureEmailMode === "both" ||
                  row.alertFailureEmailMode === "realtime";
                // Task #1102 — show explicit badges when an admin has
                // silenced fallbacks entirely or muted a specific channel,
                // so coverage can be verified at a glance. Default the
                // new row-level fields defensively so a partial-rollout
                // response (older API, newer client) doesn't render every
                // admin as fully opted out.
                const fallbackEnabled = row.fallbackEnabled ?? true;
                const mutedChannels = Array.isArray(row.fallbackMutedChannels)
                  ? row.fallbackMutedChannels
                  : [];
                const fullyOptedOut = !fallbackEnabled;
                const slackMuted = mutedChannels.includes("slack");
                const emailMuted = mutedChannels.includes("email");
                // Treat "both channels muted" the same as a full opt-out
                // for the bell-icon affordance: no real-time channel is
                // actually reachable for this admin even though the mode
                // says they want pages.
                const allChannelsMuted = slackMuted && emailMuted;
                return (
                  <li
                    key={row.id}
                    className="px-3 py-2 flex items-start gap-3"
                    data-testid={`row-admin-alert-failure-mode-${row.id}`}
                  >
                    {onRealtime && !fullyOptedOut && !allChannelsMuted ? (
                      <Bell
                        className="h-4 w-4 mt-0.5 text-green-600 shrink-0"
                        aria-hidden="true"
                      />
                    ) : (
                      <BellOff
                        className="h-4 w-4 mt-0.5 text-amber-600 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium truncate"
                        data-testid={`text-admin-alert-failure-mode-name-${row.id}`}
                      >
                        {adminDisplayName(row)}
                      </div>
                      <div
                        className="text-xs text-muted-foreground truncate"
                        data-testid={`text-admin-alert-failure-mode-email-${row.id}`}
                      >
                        {row.email}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {fullyOptedOut && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Badge
                                variant="destructive"
                                data-testid={`badge-admin-fallback-opted-out-${row.id}`}
                              >
                                Fallbacks off
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs text-xs leading-snug"
                          >
                            This admin turned off all transcript-backfill
                            failure fallback emails (the per-failure page
                            and the daily digest are both suppressed).
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {!fullyOptedOut && slackMuted && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Badge
                                variant="outline"
                                data-testid={`badge-admin-fallback-muted-slack-${row.id}`}
                              >
                                Slack muted
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs text-xs leading-snug"
                          >
                            This admin still receives email pages but muted
                            the Slack-channel fallback for transcript
                            backfill failures.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {!fullyOptedOut && emailMuted && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              <Badge
                                variant="outline"
                                data-testid={`badge-admin-fallback-muted-email-${row.id}`}
                              >
                                Email muted
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="left"
                            className="max-w-xs text-xs leading-snug"
                          >
                            This admin still receives Slack pages but muted
                            the email-channel fallback for transcript
                            backfill failures.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Badge
                              variant={badge.variant}
                              data-testid={`badge-admin-alert-failure-mode-${row.id}`}
                            >
                              {badge.label}
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="max-w-xs text-xs leading-snug"
                          data-testid={`tooltip-admin-alert-failure-mode-${row.id}`}
                        >
                          {badge.description}
                        </TooltipContent>
                      </Tooltip>
                      <AdminAlertFailureModeChangeAction row={row} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Task #1045 — inline summary of the most recent "Send test alert" outcome
// so admins coming back to the page see whether the destinations are
// currently healthy without having to re-fire the test. Renders one chip
// per configured channel (Slack, email) plus an explicit error line when
// either channel failed.
export function BackfillLastTestResultPanel({
  result,
  testedAt,
  onDismiss,
  isDismissing,
}: {
  result: BackfillTestAlertResult;
  testedAt: string;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  const tested = new Date(testedAt);
  const channels: Array<{
    key: "slack" | "email";
    label: string;
    state: BackfillTestAlertResult["slack"] | BackfillTestAlertResult["email"];
  }> = [
    { key: "slack", label: "Slack", state: result.slack },
    { key: "email", label: "Email", state: result.email },
  ];
  const anyConfigured = result.slack.configured || result.email.configured;

  return (
    <div
      className="rounded-md border bg-muted/40 p-3 space-y-2"
      data-testid="panel-last-test-result"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-medium">
            Last tested{" "}
            <span data-testid="text-last-test-at">
              {format(tested, "PPpp")}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            ({formatDistanceStrict(tested, new Date(), { addSuffix: true })})
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          disabled={isDismissing}
          data-testid="button-dismiss-last-test"
          title="Clear the saved last-test result"
        >
          {isDismissing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
          <span className="sr-only">Dismiss last test result</span>
        </Button>
      </div>
      {!anyConfigured ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid="text-last-test-no-destinations"
        >
          No destinations were configured at the time of the last test.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {channels.map(({ key, label, state }) => {
            if (!state.configured) {
              return (
                <Badge
                  key={key}
                  variant="outline"
                  className="text-muted-foreground"
                  data-testid={`chip-last-test-${key}`}
                >
                  {label}: not configured
                </Badge>
              );
            }
            return (
              <Badge
                key={key}
                variant={state.ok ? "default" : "destructive"}
                className={
                  state.ok
                    ? "bg-green-600 hover:bg-green-600 text-white"
                    : undefined
                }
                data-testid={`chip-last-test-${key}`}
              >
                {state.ok ? (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                ) : (
                  <AlertTriangle className="h-3 w-3 mr-1" />
                )}
                {label}: {state.ok ? "healthy" : "failed"}
              </Badge>
            );
          })}
        </div>
      )}
      {channels
        .filter((c) => c.state.configured && !c.state.ok && c.state.error)
        .map(({ key, label, state }) => (
          <div
            key={`${key}-err`}
            className="text-xs text-destructive break-words"
            data-testid={`text-last-test-${key}-error`}
          >
            <strong>{label} error:</strong> {state.error}
          </div>
        ))}
    </div>
  );
}
