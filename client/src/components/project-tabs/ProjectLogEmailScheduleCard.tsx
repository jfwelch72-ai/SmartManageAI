/**
 * Task #1622 — project-settings panel that lets admins configure the
 * scheduled RFI / submittal log email cadence AND, more importantly,
 * surfaces when the most recent attempt failed to deliver. Before this
 * task the cron quietly logged a server-side error on bounces /
 * suppressions, leaving project teams to discover broken distribution
 * lists only when a recipient complained. The "Last send failed"
 * badge here closes that loop in-app.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, History, Loader2, Mail, MailWarning, Send } from "lucide-react";
import { format } from "date-fns";
import {
  COMMON_TIMEZONES,
  DIGEST_CADENCES,
  DIGEST_WEEKDAYS,
} from "@/components/settings/types";

type Cadence = "OFF" | "DAILY" | "WEEKLY" | "BIWEEKLY";
type LogType = "RFI" | "SUBMITTAL";
type AttemptStatus = "SUCCESS" | "FAILURE" | "NO_RECIPIENTS";

interface ScheduleRow {
  id: string | null;
  organizationId: string;
  projectId: string;
  logType: LogType;
  cadence: Cadence;
  weekday: number;
  hour: number;
  timezone: string;
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: AttemptStatus | null;
  lastAttemptError: string | null;
  lastAttemptRecipientCount: number | null;
  // Task #1667 — running tally of consecutive FAILURE / NO_RECIPIENTS
  // attempts since the last SUCCESS. Surfaced inline as a "Failed N
  // times in a row" badge so admins can spot a chronically broken
  // schedule before the worker's backstop notification escalates.
  consecutiveFailureCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ProjectLogEmailScheduleCardProps {
  projectId: string;
}

const LOG_TYPE_LABELS: Record<LogType, string> = {
  RFI: "RFI log",
  SUBMITTAL: "Submittal log",
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: `${h.toString().padStart(2, "0")}:00`,
}));

function formatAttemptTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

export default function ProjectLogEmailScheduleCard({ projectId }: ProjectLogEmailScheduleCardProps) {
  const { toast } = useToast();
  const queryKey = useMemo(() => ["/api/projects", projectId, "log-email-schedules"] as const, [projectId]);

  const { data, isLoading, isError } = useQuery<{ schedules: ScheduleRow[]; failureThreshold: number }>({
    queryKey,
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <Card data-testid="card-log-email-schedule-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" /> Scheduled log emails
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="card-log-email-schedule-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" /> Scheduled log emails
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-log-email-schedule-error">
            Couldn't load the scheduled log email settings. Try refreshing the page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const schedules = data?.schedules ?? [];
  // Task #1667 — clamp the env-driven threshold to a sane minimum so a
  // malformed server response (or an old client cached against a new
  // server) can't accidentally render the streak badge as "red" on the
  // very first failure. The server already coerces invalid env values
  // back to the default 3, so this is purely defense-in-depth.
  const failureThreshold = Math.max(1, Number(data?.failureThreshold ?? 3) || 3);

  return (
    <Card data-testid="card-log-email-schedule">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="w-4 h-4" /> Scheduled log emails
        </CardTitle>
        <CardDescription>
          Email the latest RFI or submittal log PDF to this project's distribution lists on a recurring cadence.
          A "Last send failed" badge appears here if the most recent automated send didn't go out — e.g. because every
          address was suppressed or the distribution list is empty.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {schedules.map((s) => (
          <ScheduleRowEditor
            key={s.logType}
            projectId={projectId}
            schedule={s}
            queryKey={queryKey}
            toast={toast}
            failureThreshold={failureThreshold}
          />
        ))}
      </CardContent>
    </Card>
  );
}

interface ScheduleRowEditorProps {
  projectId: string;
  schedule: ScheduleRow;
  queryKey: readonly unknown[];
  toast: ReturnType<typeof useToast>["toast"];
  // Task #1667 — env-driven repeated-failure threshold. Used solely to
  // pick the streak badge's color (amber below threshold, red at/above).
  failureThreshold: number;
}

function ScheduleRowEditor({ projectId, schedule, queryKey, toast, failureThreshold }: ScheduleRowEditorProps) {
  const [cadence, setCadence] = useState<Cadence>(schedule.cadence);
  const [weekday, setWeekday] = useState<number>(schedule.weekday);
  const [hour, setHour] = useState<number>(schedule.hour);
  const [timezone, setTimezone] = useState<string>(schedule.timezone);

  // Re-sync local state if the parent query refreshes after a mutation.
  useEffect(() => {
    setCadence(schedule.cadence);
    setWeekday(schedule.weekday);
    setHour(schedule.hour);
    setTimezone(schedule.timezone);
  }, [schedule.cadence, schedule.weekday, schedule.hour, schedule.timezone]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PUT",
        `/api/projects/${projectId}/log-email-schedules/${schedule.logType}`,
        { cadence, weekday, hour, timezone },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule saved", description: `${LOG_TYPE_LABELS[schedule.logType]} cadence updated.` });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => {
      toast({ title: "Couldn't save schedule", variant: "destructive" });
    },
  });

  // Task #1638 — admin-on-demand retry. Hits the same flatten →
  // build PDF → send → stamp-outcome pipeline the cron uses, so the
  // "Last send failed" badge gets refreshed in place. We surface the
  // outcome inline (success/no-recipients/failure) so the admin
  // doesn't have to re-read the badge to know whether their fix
  // worked.
  const sendNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/log-email-schedules/${schedule.logType}/send-now`,
      );
      return res.json() as Promise<{
        result: { status: AttemptStatus | "PROJECT_NOT_FOUND"; error: string | null; recipientCount: number };
        schedule: ScheduleRow;
      }>;
    },
    onSuccess: (data) => {
      const { status, error, recipientCount } = data.result;
      const label = LOG_TYPE_LABELS[schedule.logType];
      if (status === "SUCCESS") {
        toast({
          title: "Log emailed",
          description: `${label} sent to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}.`,
        });
      } else if (status === "NO_RECIPIENTS") {
        toast({
          title: "No recipients to email",
          description: `Add at least one valid email to this project's distribution lists, then try again.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't send the log",
          description: error ?? "The email transport rejected the message.",
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey });
      // Task #1652 — refresh the per-schedule send history table so the
      // attempt row this send just wrote shows up immediately. Without
      // this, the global `staleTime: Infinity` in queryClient means the
      // collapsible would keep displaying yesterday's data until the
      // user closed and re-opened the panel.
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", projectId, "log-email-schedules", schedule.logType, "attempts"],
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't send the log",
        description: err instanceof Error ? err.message : "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const dirty =
    cadence !== schedule.cadence ||
    weekday !== schedule.weekday ||
    hour !== schedule.hour ||
    timezone !== schedule.timezone;

  const showWeekday = cadence === "WEEKLY" || cadence === "BIWEEKLY";
  const testIdSuffix = schedule.logType.toLowerCase();
  // The "Send now" button is only meaningful for an actually-scheduled
  // row. Hide it when cadence is OFF (matches the task's UX spec) or
  // when the schedule row hasn't been saved at all yet (`id === null`),
  // since the server-side endpoint requires a persisted row.
  const canSendNow = schedule.cadence !== "OFF" && schedule.id !== null;
  // Disable the button while there are unsaved cadence/recipient
  // edits — sending the *current saved* configuration after the user
  // has just changed it would be misleading.
  const sendNowDisabled = !canSendNow || dirty || sendNowMutation.isPending || saveMutation.isPending;

  return (
    <div
      className="rounded-md border p-4 space-y-3"
      data-testid={`row-log-email-schedule-${testIdSuffix}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-medium text-sm" data-testid={`text-log-email-schedule-title-${testIdSuffix}`}>
            {LOG_TYPE_LABELS[schedule.logType]}
          </p>
          <p className="text-xs text-muted-foreground">
            {schedule.lastSentAt
              ? <>Last successful send: <span data-testid={`text-last-sent-${testIdSuffix}`}>{formatAttemptTime(schedule.lastSentAt)}</span></>
              : <span data-testid={`text-last-sent-${testIdSuffix}`}>No successful send yet.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AttemptStatusBadge schedule={schedule} testIdSuffix={testIdSuffix} />
          <ConsecutiveFailureBadge
            schedule={schedule}
            testIdSuffix={testIdSuffix}
            failureThreshold={failureThreshold}
          />
        </div>
      </div>

      <AttemptFailureDetail
        schedule={schedule}
        testIdSuffix={testIdSuffix}
        failureThreshold={failureThreshold}
      />

      {/* Task #1652 — collapsible audit trail of the most recent
          attempts (cron + manual). Only mounted when the schedule
          has been persisted; default-OFF rows have no scheduleId
          and no history to show.

          Task #1664 — we plumb the parent's send-now mutation down
          here so the Retry action on each FAILURE row reuses the
          exact same pipeline as the schedule card's "Send now"
          button (and inherits its toasts + cache invalidations).
          We disable retry while there are unsaved cadence edits to
          avoid the same "send now triggers stale config" footgun
          the main button guards against. */}
      {schedule.id !== null && (
        <RecentAttempts
          projectId={projectId}
          logType={schedule.logType}
          testIdSuffix={testIdSuffix}
          onRetry={canSendNow ? () => sendNowMutation.mutate() : null}
          isRetrying={sendNowMutation.isPending}
          retryDisabled={sendNowDisabled}
          retryDisabledReason={
            !canSendNow
              ? "Set a cadence and save the schedule before retrying."
              : dirty
                ? "Save your unsaved changes first, then retry."
                : null
          }
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`cadence-${testIdSuffix}`}>Cadence</Label>
          <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
            <SelectTrigger id={`cadence-${testIdSuffix}`} data-testid={`select-cadence-${testIdSuffix}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIGEST_CADENCES.map((c) => (
                <SelectItem key={c.value} value={c.value} data-testid={`option-cadence-${testIdSuffix}-${c.value.toLowerCase()}`}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showWeekday && (
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`weekday-${testIdSuffix}`}>Day of week</Label>
            <Select value={String(weekday)} onValueChange={(v) => setWeekday(Number(v))}>
              <SelectTrigger id={`weekday-${testIdSuffix}`} data-testid={`select-weekday-${testIdSuffix}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIGEST_WEEKDAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)} data-testid={`option-weekday-${testIdSuffix}-${d.value}`}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`hour-${testIdSuffix}`}>Hour (local)</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger id={`hour-${testIdSuffix}`} data-testid={`select-hour-${testIdSuffix}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {HOUR_OPTIONS.map((h) => (
                <SelectItem key={h.value} value={String(h.value)} data-testid={`option-hour-${testIdSuffix}-${h.value}`}>
                  {h.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`timezone-${testIdSuffix}`}>Timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id={`timezone-${testIdSuffix}`} data-testid={`select-timezone-${testIdSuffix}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz} data-testid={`option-timezone-${testIdSuffix}-${tz.toLowerCase().replace(/\W+/g, "-")}`}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {canSendNow && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sendNowDisabled}
            onClick={() => sendNowMutation.mutate()}
            data-testid={`button-send-now-${testIdSuffix}`}
            title={
              dirty
                ? "Save your changes first, then trigger a manual send."
                : `Email the ${LOG_TYPE_LABELS[schedule.logType].toLowerCase()} now using the saved cadence's recipients.`
            }
          >
            {sendNowMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
            ) : (
              <Send className="w-3 h-3 mr-2" />
            )}
            Send now
          </Button>
        )}
        <Button
          size="sm"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid={`button-save-schedule-${testIdSuffix}`}
        >
          {saveMutation.isPending && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}

function AttemptStatusBadge({ schedule, testIdSuffix }: { schedule: ScheduleRow; testIdSuffix: string }) {
  // No attempts yet — keep the row visually quiet so admins focus on
  // the cadence editor rather than wondering what an empty status means.
  if (!schedule.lastAttemptStatus || !schedule.lastAttemptAt) {
    if (schedule.cadence === "OFF") {
      return (
        <Badge variant="outline" data-testid={`badge-status-${testIdSuffix}`}>
          Off
        </Badge>
      );
    }
    return (
      <Badge variant="outline" data-testid={`badge-status-${testIdSuffix}`}>
        Awaiting first send
      </Badge>
    );
  }

  if (schedule.lastAttemptStatus === "SUCCESS") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500 text-emerald-700 dark:text-emerald-400"
        data-testid={`badge-status-${testIdSuffix}`}
      >
        <CheckCircle2 className="w-3 h-3 mr-1" /> Last send delivered
      </Badge>
    );
  }

  if (schedule.lastAttemptStatus === "NO_RECIPIENTS") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500 text-amber-700 dark:text-amber-400"
        data-testid={`badge-status-${testIdSuffix}`}
      >
        <MailWarning className="w-3 h-3 mr-1" /> Last send had no recipients
      </Badge>
    );
  }

  return (
    <Badge variant="destructive" data-testid={`badge-status-${testIdSuffix}`}>
      <AlertCircle className="w-3 h-3 mr-1" /> Last send failed
    </Badge>
  );
}

function AttemptFailureDetail({
  schedule,
  testIdSuffix,
  failureThreshold,
}: {
  schedule: ScheduleRow;
  testIdSuffix: string;
  failureThreshold: number;
}) {
  const status = schedule.lastAttemptStatus;
  if (status !== "FAILURE" && status !== "NO_RECIPIENTS") return null;

  const isFailure = status === "FAILURE";
  const wrapperClass = isFailure
    ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1"
    : "rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm space-y-1";
  const headlineClass = isFailure ? "font-medium text-destructive" : "font-medium text-amber-800 dark:text-amber-300";
  const headline = isFailure ? "Last send failed" : "Last send had no recipients";

  // Task #1667 — when the failure detail panel is already on screen,
  // surface the streak inline so admins reading the reason also see
  // how persistent the problem is. The badge above this panel keeps
  // the at-a-glance signal; this line spells it out in context.
  const streak = schedule.consecutiveFailureCount ?? 0;
  const streakAtOrAboveThreshold = streak >= failureThreshold;

  return (
    <div className={wrapperClass} data-testid={`alert-attempt-failure-${testIdSuffix}`}>
      <p className={headlineClass}>{headline}</p>
      <p className="text-muted-foreground" data-testid={`text-attempt-time-${testIdSuffix}`}>
        At {formatAttemptTime(schedule.lastAttemptAt)}
        {typeof schedule.lastAttemptRecipientCount === "number" && (
          <> · {schedule.lastAttemptRecipientCount} recipient{schedule.lastAttemptRecipientCount === 1 ? "" : "s"} attempted</>
        )}
      </p>
      {schedule.lastAttemptError && (
        <p className="text-muted-foreground break-words" data-testid={`text-attempt-error-${testIdSuffix}`}>
          Reason: {schedule.lastAttemptError}
        </p>
      )}
      {streak > 1 && (
        <p
          className={
            streakAtOrAboveThreshold
              ? "font-medium text-destructive"
              : "font-medium text-amber-800 dark:text-amber-300"
          }
          data-testid={`text-attempt-streak-${testIdSuffix}`}
        >
          Failed {streak} times in a row
          {streakAtOrAboveThreshold && (
            <> · org admins have been notified</>
          )}
        </p>
      )}
      {isFailure ? (
        <p className="text-muted-foreground">
          The cron will try again at the next scheduled tick. Fix any bad addresses on this project's distribution lists, then trigger a manual send if needed.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Add at least one valid email to this project's distribution lists so the next scheduled send has somewhere to go.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Task #1652 — per-schedule send history
// ============================================================
//
// Lazy-loaded collapsible that fetches and renders the most recent
// 10 attempts (cron + manual) so admins debugging a flaky
// distribution list can see trend data instead of just the most
// recent attempt that's already on the schedule row. Open-state
// triggers the fetch (`enabled: open`) so an admin who never
// expands the section doesn't pay for the query.
interface AttemptRow {
  id: string;
  status: AttemptStatus;
  error: string | null;
  recipientCount: number;
  triggerType: "CRON" | "MANUAL";
  triggeredById: string | null;
  triggeredByLabel: string;
  createdAt: string;
}

function RecentAttempts({
  projectId,
  logType,
  testIdSuffix,
  onRetry,
  isRetrying,
  retryDisabled,
  retryDisabledReason,
}: {
  projectId: string;
  logType: LogType;
  testIdSuffix: string;
  // Task #1664 — null when the schedule cannot be retried at all
  // (e.g. cadence is OFF). When non-null, FAILURE rows show a Retry
  // button that invokes this callback.
  onRetry: (() => void) | null;
  isRetrying: boolean;
  retryDisabled: boolean;
  retryDisabledReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const queryKey = useMemo(
    () => ["/api/projects", projectId, "log-email-schedules", logType, "attempts"] as const,
    [projectId, logType],
  );
  const { data, isLoading, isError } = useQuery<{ attempts: AttemptRow[] }>({
    queryKey,
    enabled: open,
  });

  const attempts = data?.attempts ?? [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover-elevate active-elevate-2 rounded px-2 py-1 -ml-2"
          data-testid={`button-toggle-attempt-history-${testIdSuffix}`}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <History className="w-3 h-3" />
          <span>Recent attempts</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {isLoading ? (
          <div className="space-y-2" data-testid={`loading-attempt-history-${testIdSuffix}`}>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : isError ? (
          <p className="text-xs text-muted-foreground" data-testid={`error-attempt-history-${testIdSuffix}`}>
            Couldn't load the send history. Try collapsing and re-opening this section.
          </p>
        ) : attempts.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid={`empty-attempt-history-${testIdSuffix}`}>
            No attempts recorded yet. The next scheduled cron tick (or a manual "Send now" click) will appear here.
          </p>
        ) : (
          <div className="rounded-md border overflow-hidden" data-testid={`table-attempt-history-${testIdSuffix}`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">When</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Triggered by</TableHead>
                  <TableHead className="text-xs text-right">Recipients</TableHead>
                  {/* Task #1664 — actions column hosts the per-row
                      Retry button on FAILURE rows. We only render
                      the column when retry is wired up at all
                      (cadence != OFF, schedule persisted) so we
                      don't add a permanently empty column for
                      retired schedules. */}
                  {onRetry !== null && <TableHead className="text-xs text-right w-0">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {attempts.map((a) => (
                  <TableRow key={a.id} data-testid={`row-attempt-${testIdSuffix}-${a.id}`}>
                    <TableCell className="text-xs whitespace-nowrap" data-testid={`text-attempt-when-${a.id}`}>
                      {formatAttemptTime(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      <AttemptHistoryBadge status={a.status} attemptId={a.id} />
                      {a.error && (a.status === "FAILURE" || a.status === "NO_RECIPIENTS") && (
                        <p
                          className="text-xs text-muted-foreground break-words mt-1"
                          data-testid={`text-attempt-error-${a.id}`}
                        >
                          {a.error}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs" data-testid={`text-attempt-trigger-${a.id}`}>
                      {a.triggerType === "CRON" ? (
                        <span title="Automatic scheduled send">Scheduled run</span>
                      ) : (
                        <span title="Manual 'Send now' click">{a.triggeredByLabel}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums" data-testid={`text-attempt-recipients-${a.id}`}>
                      {a.recipientCount}
                    </TableCell>
                    {/* Task #1664 — Retry action. Only meaningful
                        for FAILURE rows; SUCCESS / NO_RECIPIENTS
                        rows render an empty cell so column
                        alignment stays consistent. */}
                    {onRetry !== null && (
                      <TableCell className="text-xs text-right">
                        {a.status === "FAILURE" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={retryDisabled}
                            onClick={() => onRetry()}
                            data-testid={`button-retry-attempt-${a.id}`}
                            title={
                              retryDisabledReason ??
                              "Retry this send using the saved cadence's recipients."
                            }
                          >
                            {isRetrying ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3 mr-1" />
                            )}
                            Retry
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function AttemptHistoryBadge({ status, attemptId }: { status: AttemptStatus; attemptId: string }) {
  if (status === "SUCCESS") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500 text-emerald-700 dark:text-emerald-400"
        data-testid={`badge-attempt-status-${attemptId}`}
      >
        <CheckCircle2 className="w-3 h-3 mr-1" /> Sent
      </Badge>
    );
  }
  if (status === "NO_RECIPIENTS") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500 text-amber-700 dark:text-amber-400"
        data-testid={`badge-attempt-status-${attemptId}`}
      >
        <MailWarning className="w-3 h-3 mr-1" /> No recipients
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" data-testid={`badge-attempt-status-${attemptId}`}>
      <AlertCircle className="w-3 h-3 mr-1" /> Failed
    </Badge>
  );
}

// Task #1667 — at-a-glance streak indicator beside the per-attempt
// status badge. Hidden when the streak is 0 (no signal worth showing
// for a healthy schedule). Amber while the streak is below the
// configured PROJECT_LOG_EMAIL_FAILURE_THRESHOLD so admins can fix the
// schedule before the worker fans out the org-wide backstop
// notification; flips to red once the streak reaches/exceeds the
// threshold to mirror the worker's escalation. The threshold itself
// is env-driven and surfaced by the GET endpoint, so this badge always
// matches the worker's actual behaviour even after an env override.
function ConsecutiveFailureBadge({
  schedule,
  testIdSuffix,
  failureThreshold,
}: {
  schedule: ScheduleRow;
  testIdSuffix: string;
  failureThreshold: number;
}) {
  const streak = schedule.consecutiveFailureCount ?? 0;
  if (streak <= 0) return null;

  const atOrAboveThreshold = streak >= failureThreshold;
  const label = `Failed ${streak} time${streak === 1 ? "" : "s"} in a row`;
  const title = atOrAboveThreshold
    ? `This schedule has failed ${streak} consecutive sends — at or above the configured alert threshold of ${failureThreshold}, so org admins have been notified.`
    : `This schedule has failed ${streak} consecutive send${streak === 1 ? "" : "s"}. Org admins are notified once the streak reaches ${failureThreshold}.`;

  if (atOrAboveThreshold) {
    return (
      <Badge
        variant="destructive"
        data-testid={`badge-failure-streak-${testIdSuffix}`}
        title={title}
      >
        <AlertCircle className="w-3 h-3 mr-1" /> {label}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="border-amber-500 text-amber-700 dark:text-amber-400"
      data-testid={`badge-failure-streak-${testIdSuffix}`}
      title={title}
    >
      <AlertCircle className="w-3 h-3 mr-1" /> {label}
    </Badge>
  );
}
