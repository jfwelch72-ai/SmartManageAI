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
import { AlertCircle, CheckCircle2, Eraser, Loader2, Mail, MailWarning, Send } from "lucide-react";
import { format } from "date-fns";
import {
  COMMON_TIMEZONES,
  DIGEST_CADENCES,
  DIGEST_WEEKDAYS,
} from "@/components/settings/types";
import {
  RecentAttemptsCollapsible,
  buildAttemptsQueryKey,
} from "@/components/log-email/RecentAttempts";

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
      // user closed and re-opened the panel. Builder shared with the
      // org-wide failures dashboard (Task #1666) so a single source of
      // truth keys the cache.
      queryClient.invalidateQueries({
        queryKey: buildAttemptsQueryKey(projectId, schedule.logType),
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

  // Task #1679 — admin-acknowledged "I fixed it, drop the streak
  // badge" mutation. Hits the new reset-failure-streak endpoint
  // which zeroes `consecutive_failure_count` and clears the
  // last-notified dedupe markers. We invalidate the same query
  // key the schedule card already uses so the streak badge falls
  // off the row immediately on success — no real email goes out
  // and nothing in the per-attempt history table needs to change
  // (the row's last *attempt* status is unrelated to the running
  // streak, so we don't refresh the attempts list either).
  const resetStreakMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/log-email-schedules/${schedule.logType}/reset-failure-streak`,
      );
      return res.json() as Promise<{ schedule: ScheduleRow }>;
    },
    onSuccess: () => {
      toast({
        title: "Failure streak cleared",
        description: `${LOG_TYPE_LABELS[schedule.logType]} streak reset. The next failure (if any) will alert again.`,
      });
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast({
        title: "Couldn't reset the streak",
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

  // Task #1679 — the "Reset streak" button only makes sense when
  // there's actually a streak on the row. We also require a
  // persisted schedule id so the server has something to update —
  // a default-OFF row that's never been saved has no streak by
  // construction, but defending here keeps the button from
  // spuriously rendering if the GET endpoint shape ever changes.
  const hasFailureStreak = (schedule.consecutiveFailureCount ?? 0) > 0 && schedule.id !== null;
  const resetStreakDisabled =
    resetStreakMutation.isPending || saveMutation.isPending || sendNowMutation.isPending;

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
          the main button guards against.

          Task #1666 — the collapsible itself was extracted into a
          shared component so the org-wide failures dashboard can
          render the same table behind a "View history" popover
          without duplicating the fetch shape. The dashboard call
          site omits the `retry` prop, so its popover is read-only. */}
      {schedule.id !== null && (
        <RecentAttemptsCollapsible
          projectId={projectId}
          logType={schedule.logType}
          testIdSuffix={testIdSuffix}
          retry={
            canSendNow
              ? {
                  onRetry: () => sendNowMutation.mutate(),
                  isRetrying: sendNowMutation.isPending,
                  disabled: sendNowDisabled,
                  disabledReason: dirty
                    ? "Save your unsaved changes first, then retry."
                    : null,
                }
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
        {hasFailureStreak && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={resetStreakDisabled}
            onClick={() => resetStreakMutation.mutate()}
            data-testid={`button-reset-streak-${testIdSuffix}`}
            title={`I've fixed the underlying issue — clear the "Failed ${schedule.consecutiveFailureCount} times in a row" badge without sending an email.`}
          >
            {resetStreakMutation.isPending ? (
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
            ) : (
              <Eraser className="w-3 h-3 mr-2" />
            )}
            Reset streak
          </Button>
        )}
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
// Task #1652 — per-schedule send history (extracted)
// ============================================================
//
// The collapsible audit trail used to live here as a private
// `RecentAttempts` component plus an `AttemptHistoryBadge` helper.
// Task #1666 moved both into `@/components/log-email/RecentAttempts`
// so the new org-wide "scheduled email failures" dashboard can render
// the same table inside a per-row "View history" popover. Both call
// sites still hit the same `GET .../attempts` endpoint — there is no
// second underlying API.
//
// Task #1664's per-row Retry button now lives on the shared component
// behind an optional `retry` prop, which the project settings card
// supplies (and the dashboard's read-only popover omits).

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
