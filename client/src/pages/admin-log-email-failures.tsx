/**
 * Task #1666 — org-wide "scheduled email failures" dashboard.
 *
 * Per-project settings already surface the most recent failed
 * attempt for a given log type and let admins expand a "Recent
 * attempts" panel for trend data (Tasks #1622 / #1652). That works
 * fine when triaging one project, but admins on orgs with dozens of
 * projects had no way to see "everywhere this is currently failing"
 * without clicking into each project's settings page in turn.
 *
 * This page lists every schedule whose most recent attempt was a
 * FAILURE or NO_RECIPIENTS (i.e. the same conditions the per-project
 * "Last send failed" badge reacts to). Each row exposes a "View
 * history" affordance that opens a popover rendering the same recent
 * attempts table the project settings card does, backed by the same
 * `GET /api/projects/:projectId/log-email-schedules/:logType/attempts`
 * endpoint — no second underlying API.
 *
 * Roles: gated to ADMIN/SUPER_ADMIN at the route level (matches the
 * other org-admin pages); the backend additionally enforces its own
 * role gate.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle2,
  ExternalLink,
  History,
  Loader2,
  Mail,
  MailWarning,
  Send,
  X,
} from "lucide-react";
import {
  RecentAttemptsBody,
  buildAttemptsQueryKey,
  formatLogEmailAttemptTime,
  type LogEmailAttemptStatus,
  type LogEmailLogType,
} from "@/components/log-email/RecentAttempts";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";

// Mirrors the row shape returned by `GET /api/log-email-schedule-failures`.
// The endpoint already filters to FAILURE/NO_RECIPIENTS, so we don't need
// to second-guess `lastAttemptStatus` here — it's never SUCCESS.
//
// Task #1785 — `rollingFailureCount30d` is the count of FAILURE /
// NO_RECIPIENTS attempts in the last 30 days for this schedule, surfaced
// alongside the existing consecutive-failure streak so admins can
// distinguish a chronically flaky schedule from a one-off transport
// blip. `rollingFailureWindowDays` is the window the count was computed
// over (server-driven so the column header doesn't drift if we ever
// tune the window).
interface FailureRow {
  scheduleId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  logType: LogEmailLogType;
  cadence: "OFF" | "DAILY" | "WEEKLY" | "BIWEEKLY";
  lastAttemptAt: string | null;
  lastAttemptStatus: LogEmailAttemptStatus;
  lastAttemptError: string | null;
  lastAttemptRecipientCount: number | null;
  consecutiveFailureCount: number;
  rollingFailureCount30d: number;
  rollingFailureWindowDays: number;
}

// Task #1785 — admin-selectable sort modes. Mirrors the server's
// allow-list in `projectLogEmailScheduleRoutes.ts`. Default surfaces
// chronic offenders (highest 30-day failure count) first; other modes
// are escape hatches for admins who specifically want to triage by
// "currently broken right now" or "most recently failed".
type FailuresSortMode = "rolling" | "streak" | "recent";
const FAILURES_SORT_OPTIONS: Array<{
  value: FailuresSortMode;
  label: string;
  description: string;
}> = [
  {
    value: "rolling",
    label: "Most failures (30d)",
    description:
      "Chronic offenders first — sorted by failed sends in the last 30 days.",
  },
  {
    value: "streak",
    label: "Longest current streak",
    description:
      "Currently broken pipelines first — sorted by consecutive-failure count.",
  },
  {
    value: "recent",
    label: "Most recent failure",
    description:
      "Freshest breakage first — sorted by the timestamp of the last failed attempt.",
  },
];

/**
 * Task #1691 — per-row "Resend now" action.
 *
 * Reuses the existing
 * `POST /api/projects/:projectId/log-email-schedules/:logType/send-now`
 * endpoint that the project settings card already calls (Task #1638), so
 * the same flatten → build PDF → send → stamp-outcome pipeline runs and
 * the same 30s server-side debounce protects against accidental
 * double-clicks. No backend change is required.
 *
 * On a SUCCESS outcome we invalidate the failures-list query — the row
 * will drop off on the next refresh because the schedule's last attempt
 * is no longer FAILURE/NO_RECIPIENTS. On NO_RECIPIENTS or FAILURE we
 * still invalidate (the lastAttemptAt/error text just changed), and we
 * surface the reason inline via toast so the admin knows what to fix
 * before retrying. The per-schedule attempts cache is also invalidated
 * so any open "View history" popover refreshes to include the attempt
 * row this send just wrote.
 *
 * Task #1716 — per-row UX cooldown that mirrors the server's 30s
 * debounce. After any 2xx response (the server consumed the debounce
 * regardless of the resulting attempt outcome) we disable the button
 * with a "Cooldown Ns…" label until the window elapses. The 429
 * fallback toast is still the source of truth for cross-tab and
 * cross-admin races — this just keeps a single admin from being
 * surprised by their own back-to-back clicks. The timestamp lives in a
 * module-level Map so it survives the row briefly unmounting (e.g. when
 * the failures list refreshes and the row temporarily drops off).
 */
const SEND_NOW_COOLDOWN_MS = 30_000;
const lastResendAt = new Map<string, number>();

function ResendNowButton({
  projectId,
  logType,
  projectName,
  rowKey,
}: {
  projectId: string;
  logType: LogEmailLogType;
  projectName: string;
  rowKey: string;
}) {
  const { toast } = useToast();
  const cooldownKey = `${projectId}:${logType}`;
  const [now, setNow] = useState(() => Date.now());

  const lastAt = lastResendAt.get(cooldownKey);
  const remainingMs =
    lastAt !== undefined
      ? Math.max(0, SEND_NOW_COOLDOWN_MS - (now - lastAt))
      : 0;
  const cooldownSeconds = Math.ceil(remainingMs / 1000);
  const isCoolingDown = remainingMs > 0;

  // Tick once a second while cooling down so the countdown label
  // updates and the button re-enables itself when the window elapses.
  // No interval runs when there's no active cooldown.
  useEffect(() => {
    if (!isCoolingDown) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isCoolingDown]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/log-email-schedules/${logType}/send-now`,
      );
      return res.json() as Promise<{
        result: {
          status: LogEmailAttemptStatus | "PROJECT_NOT_FOUND";
          error: string | null;
          recipientCount: number;
        };
      }>;
    },
    onSuccess: (data) => {
      // The server only reaches this branch after successfully consuming
      // its own 30s debounce slot, so start the matching client-side
      // cooldown for every 2xx outcome (SUCCESS / NO_RECIPIENTS /
      // transport FAILURE / PROJECT_NOT_FOUND).
      lastResendAt.set(cooldownKey, Date.now());
      setNow(Date.now());

      const { status, error, recipientCount } = data.result;
      if (status === "SUCCESS") {
        toast({
          title: "Log emailed",
          description: `${projectName} (${logType}) sent to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}.`,
        });
      } else if (status === "NO_RECIPIENTS") {
        toast({
          title: "No recipients to email",
          description: `${projectName} (${logType}) still has no valid recipients. Add at least one before retrying.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't resend the log",
          description: error ?? "The email transport rejected the message.",
          variant: "destructive",
        });
      }
      // Refresh the failures list (so SUCCESS rows drop off) and the
      // per-schedule attempts cache (so the history popover shows the
      // newly-written attempt row).
      queryClient.invalidateQueries({
        queryKey: ["/api/log-email-schedule-failures"],
      });
      queryClient.invalidateQueries({
        queryKey: buildAttemptsQueryKey(projectId, logType),
      });
    },
    onError: (err) => {
      // The 30s debounce returns 429 with the wait-time message — the
      // shared apiRequest helper surfaces it as `err.message`, so the
      // admin sees the exact "Please wait N seconds" copy. We don't
      // start the local cooldown here because the request didn't
      // consume the server slot (somebody else already did), and the
      // toast already explains the wait.
      toast({
        title: "Couldn't resend the log",
        description:
          err instanceof Error ? err.message : "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const disabled = mutation.isPending || isCoolingDown;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={() => mutation.mutate()}
      data-testid={`button-resend-now-${rowKey}`}
      title={
        isCoolingDown
          ? `Waiting for the ${SEND_NOW_COOLDOWN_MS / 1000}s server-side debounce — ${cooldownSeconds}s remaining.`
          : `Re-run the scheduled send for ${projectName} (${logType}) now.`
      }
    >
      {mutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
      ) : (
        <Send className="w-3.5 h-3.5 mr-1" />
      )}
      {isCoolingDown ? `Cooldown ${cooldownSeconds}s…` : "Resend now"}
    </Button>
  );
}

// Test-only escape hatch so unit tests can clear the in-memory cooldown
// map between cases without resorting to module re-imports.
export function __resetResendCooldownForTests() {
  lastResendAt.clear();
}

/**
 * Task #1731 — Inline mute / unmute control for the current admin's
 * subscription to the daily failures digest
 * (`PROJECT_LOG_EMAIL_FAILURES_DIGEST`).
 *
 * Surfaces the same per-user `notification_type_prefs` row the standard
 * notification settings page upserts, so the channel resolver in
 * `notificationDelivery.ts` (and the in-app feed filter) honor the
 * mute identically — admins don't need to leave the dashboard, and
 * they're nudged toward muting the *digest* instead of the more
 * important per-failure ping (`PROJECT_LOG_EMAIL_FAILED`) on the full
 * settings page.
 *
 * Only rendered for ADMIN / SUPER_ADMIN — the digest job
 * (`processProjectLogEmailFailuresDigest`) only delivers to those
 * roles, so a switch for MANAGER / SUPERINTENDENT would write a pref
 * row that does nothing.
 */
interface DigestSubscriptionResponse {
  notificationType: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  channelEmailEnabled: boolean;
  emailOverride: boolean | null;
  inAppOverride: boolean | null;
  // Task #1747 — Mute timing surfaced so the dashboard can show
  // "muted N days ago" + the auto-clear deadline (or "indefinitely").
  // `mutedAt` is the override row's `updated_at` and is null when no
  // override is in effect. `mutedUntil` is null for indefinite mutes
  // and otherwise an ISO timestamp.
  mutedAt: string | null;
  mutedUntil: string | null;
  snoozeExpired: boolean;
}

// Task #1747 — Snooze affordances offered by the mute card. `null`
// keeps the historical "indefinite" semantics. Numbers are days the
// server expands into a `muted_until` deadline. Keep this list in
// sync with `MAX_SNOOZE_DAYS` in `notificationPreferencesRoutes.ts`.
const SNOOZE_OPTIONS: Array<{
  value: number | null;
  label: string;
  description: string;
}> = [
  {
    value: 7,
    label: "7 days",
    description:
      "Auto-unmutes in a week — good for clearing this week's noise.",
  },
  {
    value: 30,
    label: "30 days",
    description: "Auto-unmutes next month — good for ongoing remediation.",
  },
  {
    value: null,
    label: "Indefinitely",
    description: "Stays muted until you toggle it back on.",
  },
];

function formatRelativePast(isoTs: string | null): string | null {
  if (!isoTs) return null;
  const ms = Date.now() - new Date(isoTs).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatRelativeFuture(isoTs: string | null): string | null {
  if (!isoTs) return null;
  const ms = new Date(isoTs).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / (60 * 1000));
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  if (days < 60) return `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.ceil(days / 30);
  return `in ${months} month${months === 1 ? "" : "s"}`;
}

function formatAbsolute(isoTs: string | null): string | null {
  if (!isoTs) return null;
  try {
    return new Date(isoTs).toLocaleString();
  } catch {
    return null;
  }
}

function DigestSubscriptionCard() {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<DigestSubscriptionResponse>({
    queryKey: ["/api/notifications/preferences/log-email-failures-digest"],
  });

  // Track which snooze duration the admin most recently picked so the
  // *next* mute click on either channel uses it. `null` = indefinite.
  // Defaults to indefinite because that's the historical behavior and
  // the right pick when an admin really wants to mute permanently.
  const [pendingSnoozeDays, setPendingSnoozeDays] = useState<number | null>(
    null,
  );

  const mutation = useMutation({
    mutationFn: async (patch: {
      emailEnabled?: boolean;
      inAppEnabled?: boolean;
      mutedUntilDays?: number | null;
    }) => {
      const res = await apiRequest(
        "PUT",
        "/api/notifications/preferences/log-email-failures-digest",
        patch,
      );
      return res.json() as Promise<{ success: boolean }>;
    },
    onSuccess: (_data, patch) => {
      // Refresh the subscription card so the switches reflect the
      // server's persisted state (and any defaults the server filled
      // in when the override row was first created).
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/preferences/log-email-failures-digest"],
      });
      // Also invalidate the standard prefs query so the Notifications
      // settings page picks up the change next time it mounts.
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/preferences"],
      });

      const label = patch.emailEnabled !== undefined ? "Email" : "In-app";
      const enabled =
        patch.emailEnabled !== undefined
          ? patch.emailEnabled
          : patch.inAppEnabled;
      // Task #1747 — Mute toasts now name the snooze window so the
      // admin gets immediate confirmation of how long the digest will
      // be silent (and that "indefinitely" really means forever).
      let description: string;
      if (enabled) {
        description = `You'll receive the daily failures digest ${label.toLowerCase()}.`;
      } else if (patch.mutedUntilDays && patch.mutedUntilDays > 0) {
        description = `The daily failures digest will be silenced ${label.toLowerCase()} for ${patch.mutedUntilDays} day${patch.mutedUntilDays === 1 ? "" : "s"}, then auto-clear.`;
      } else {
        description = `The daily failures digest will no longer be delivered ${label.toLowerCase()} until you toggle it back on.`;
      }
      toast({
        title: enabled ? `${label} digest re-enabled` : `${label} digest muted`,
        description,
      });
    },
    onError: (err) => {
      toast({
        title: "Couldn't update your digest subscription",
        description:
          err instanceof Error ? err.message : "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="card-digest-subscription">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Daily failures digest
          </CardTitle>
          <CardDescription>Loading your subscription…</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton
            className="h-9 w-full"
            data-testid="loading-digest-subscription"
          />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    // Non-fatal: the page is still useful without this card. Show a
    // muted hint with a deep-link to the full settings page so the
    // admin still has a path to mute the digest.
    return (
      <Card data-testid="card-digest-subscription">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Daily failures digest
          </CardTitle>
          <CardDescription>
            Couldn't load your subscription right now.{" "}
            <Link
              href="/settings/notifications"
              className="underline"
              data-testid="link-digest-subscription-fallback"
            >
              Manage in notification settings
            </Link>
            .
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const {
    emailEnabled,
    inAppEnabled,
    channelEmailEnabled,
    mutedAt,
    mutedUntil,
  } = data;
  const anyChannelMuted = !emailEnabled || !inAppEnabled;
  const bothMuted = !emailEnabled && !inAppEnabled;
  const StatusIcon = bothMuted ? BellOff : Bell;

  // Task #1747 — Build the mute-timing summary line. Only meaningful
  // when at least one channel is muted (otherwise there's nothing
  // counting down). `mutedAt` is null when no override row is in
  // effect (server already accounts for an expired snooze), so the
  // copy never claims a stale duration.
  const mutedAgo = anyChannelMuted ? formatRelativePast(mutedAt) : null;
  const autoClearsIn = anyChannelMuted
    ? formatRelativeFuture(mutedUntil)
    : null;
  const mutedAtAbs = formatAbsolute(mutedAt);
  const mutedUntilAbs = formatAbsolute(mutedUntil);

  return (
    <Card data-testid="card-digest-subscription">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <StatusIcon className="h-4 w-4" />
          Daily failures digest
        </CardTitle>
        <CardDescription>
          {bothMuted ? (
            <span data-testid="text-digest-subscription-status">
              You've muted the daily summary of these failures. The per-failure
              ping (sent the moment a schedule first breaks) is unaffected.
            </span>
          ) : (
            <span data-testid="text-digest-subscription-status">
              You're subscribed to a daily summary of these failures. Mute
              either channel below — your per-failure ping is unaffected.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex items-center justify-between sm:justify-start gap-3 flex-1">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Email</span>
            </div>
            <Switch
              checked={emailEnabled}
              disabled={mutation.isPending}
              onCheckedChange={(checked) =>
                // Task #1747 — Mute requests carry the currently
                // selected snooze window; unmute requests don't bother
                // sending one (server clears `muted_until` either way).
                mutation.mutate(
                  checked
                    ? { emailEnabled: true }
                    : {
                        emailEnabled: false,
                        mutedUntilDays: pendingSnoozeDays,
                      },
                )
              }
              data-testid="switch-digest-email"
              aria-label="Email me the daily failures digest"
            />
          </div>
          <div className="flex items-center justify-between sm:justify-start gap-3 flex-1">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">In-app</span>
            </div>
            <Switch
              checked={inAppEnabled}
              disabled={mutation.isPending}
              onCheckedChange={(checked) =>
                mutation.mutate(
                  checked
                    ? { inAppEnabled: true }
                    : {
                        inAppEnabled: false,
                        mutedUntilDays: pendingSnoozeDays,
                      },
                )
              }
              data-testid="switch-digest-in-app"
              aria-label="Show the daily failures digest in my in-app feed"
            />
          </div>
          <Link
            href="/settings/notifications"
            className="text-xs text-muted-foreground underline whitespace-nowrap"
            data-testid="link-digest-manage-settings"
          >
            Manage notification settings
          </Link>
        </div>

        {/*
          Task #1747 — Snooze affordance. Always rendered so an admin
          can pre-pick "7 days" *before* flipping a switch, and so the
          card visibly answers the "how long does muting actually
          last?" question even when nothing is currently muted. The
          buttons restate the chosen window for the next mute action;
          they do NOT mutate state on their own.
        */}
        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          data-testid="group-digest-snooze-options"
        >
          <span className="text-xs text-muted-foreground mr-1">
            Next mute lasts:
          </span>
          {SNOOZE_OPTIONS.map((opt) => {
            const isSelected = pendingSnoozeDays === opt.value;
            const testValue =
              opt.value === null ? "indefinite" : `${opt.value}d`;
            return (
              <Button
                key={testValue}
                type="button"
                size="sm"
                variant={isSelected ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setPendingSnoozeDays(opt.value)}
                title={opt.description}
                data-testid={`button-digest-snooze-${testValue}`}
                aria-pressed={isSelected}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>

        {anyChannelMuted && mutedAgo && (
          // Task #1747 — Surface when the mute was set + when it
          // auto-clears (or that it never will). This is the
          // headline benefit of the task: an admin browsing the
          // dashboard months later sees the duration at a glance and
          // can decide whether the silence has gone on too long.
          <p
            className="text-xs text-muted-foreground mt-3"
            data-testid="text-digest-mute-timing"
          >
            <span title={mutedAtAbs ?? undefined}>Muted {mutedAgo}.</span>{" "}
            {autoClearsIn ? (
              <span
                title={mutedUntilAbs ?? undefined}
                data-testid="text-digest-mute-auto-clears"
              >
                Auto-clears {autoClearsIn}.
              </span>
            ) : (
              <span data-testid="text-digest-mute-indefinite">
                This mute is indefinite — it will not auto-clear.
              </span>
            )}
          </p>
        )}

        {emailEnabled && !channelEmailEnabled && (
          // The override forces email on for the digest type, but the
          // channel-level master switch is off. The notification
          // service still respects the override, so digests will be
          // emailed; we just call it out so the admin doesn't think
          // their channel-level "no email" preference is being ignored.
          <p
            className="text-xs text-muted-foreground mt-3"
            data-testid="text-digest-channel-email-off"
          >
            Heads up: your channel-level email is off, but this digest override
            keeps the daily summary arriving in your inbox.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function FailureStatusBadge({
  status,
  rowKey,
}: {
  status: LogEmailAttemptStatus;
  rowKey: string;
}) {
  if (status === "NO_RECIPIENTS") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500 text-amber-700 dark:text-amber-400"
        data-testid={`badge-failure-status-${rowKey}`}
      >
        <MailWarning className="w-3 h-3 mr-1" /> No recipients
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" data-testid={`badge-failure-status-${rowKey}`}>
      <AlertCircle className="w-3 h-3 mr-1" /> Failed
    </Badge>
  );
}

// Task #1746 — Confirmation banner shown when the failures digest mute
// link in the email footer redirects back here. Mirrors the pattern in
// `NotificationPrefsSection.tsx` for the SWPPP / Davis-Bacon mute links:
// captured once on mount from `?muted=…` / `?mute=invalid`, then the
// query string is stripped via `history.replaceState` so a refresh or
// shared URL doesn't re-show a stale banner. Stored in component state
// so the banner stays visible after we rewrite the URL, and dismissable
// inline.
type DigestMuteBanner =
  | { kind: "success"; key: string }
  | { kind: "invalid"; key: string };

const DIGEST_MUTE_FAMILY = "log_email_failures_digest";

export default function AdminLogEmailFailuresPage() {
  const { user: authUser } = useAuth();
  // Task #1731 — Only ADMIN / SUPER_ADMIN actually receive the daily
  // failures digest, so the mute card is only meaningful for them.
  // MANAGER / SUPERINTENDENT can still browse the dashboard but won't
  // see (or write to) a pref row that does nothing.
  const role = authUser?.effectiveRole || authUser?.role;
  const canManageDigestSubscription =
    role === "ADMIN" || role === "SUPER_ADMIN";

  // Task #1785 — admin-selectable sort. Default is "rolling" so chronic
  // offenders surface above schedules that just happen to be currently
  // broken. The selection rides as a query string on the GET so the
  // server returns rows in the right order; the cache key includes it
  // so each mode caches independently and toggling between them
  // doesn't refetch unnecessarily.
  const [sort, setSort] = useState<FailuresSortMode>("rolling");

  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    failures: FailureRow[];
    sort?: FailuresSortMode;
    rollingFailureWindowDays?: number;
  }>({
    queryKey: ["/api/log-email-schedule-failures", { sort }],
  });

  const failures = useMemo(() => data?.failures ?? [], [data]);
  // Server-driven so we don't have to hardcode "30" if the window
  // is ever tuned. Falls back to 30 for the empty-state path before
  // the first response lands.
  const rollingWindowDays = data?.rollingFailureWindowDays ?? 30;
  const activeSortLabel =
    FAILURES_SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "";

  // Task #1746 — One-shot capture of the `?muted=…` / `?mute=invalid`
  // query params appended by the failures-digest mute endpoint
  // (`GET /api/notifications/mute/log-email-failures-digest`). The
  // params are stripped from the URL on mount so a reload or a shared
  // link doesn't re-fire the banner; the captured value powers an
  // inline confirmation/error banner below.
  const [muteBanner] = useState<DigestMuteBanner | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const muted = params.get("muted");
    const mute = params.get("mute");
    if (muted === DIGEST_MUTE_FAMILY) {
      return { kind: "success", key: `muted:${muted}` };
    }
    if (mute === "invalid") {
      return { kind: "invalid", key: "mute:invalid" };
    }
    return null;
  });
  const [dismissedMuteBannerKey, setDismissedMuteBannerKey] = useState<
    string | null
  >(null);
  const showMuteBanner =
    muteBanner !== null && dismissedMuteBannerKey !== muteBanner.key;

  useEffect(() => {
    if (!muteBanner) return;
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      let changed = false;
      if (url.searchParams.has("muted")) {
        url.searchParams.delete("muted");
        changed = true;
      }
      if (url.searchParams.has("mute")) {
        url.searchParams.delete("mute");
        changed = true;
      }
      if (!changed) return;
      const newSearch = url.searchParams.toString();
      const newUrl =
        url.pathname + (newSearch ? `?${newSearch}` : "") + (url.hash || "");
      window.history.replaceState(window.history.state, "", newUrl);
    } catch {
      // Ignore — the banner is still rendered from in-memory state.
    }
  }, [muteBanner]);

  // After a successful one-click mute, the digest subscription card's
  // cached query is stale (the server just upserted the per-type prefs
  // row). Invalidate it once on mount so the card's switches reflect
  // the new "muted" state without a manual refresh.
  useEffect(() => {
    if (muteBanner?.kind === "success") {
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/preferences/log-email-failures-digest"],
      });
    }
  }, [muteBanner]);

  return (
    <div className="container mx-auto py-8 px-4 max-w-full space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1
            className="text-2xl font-semibold"
            data-testid="heading-log-email-failures"
          >
            Scheduled email failures
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Every project schedule whose most recent send failed or had no
            recipients. Open a row's history to audit recent attempts, or jump
            into the project to fix the distribution list.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh-log-email-failures"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {showMuteBanner && muteBanner ? (
        muteBanner.kind === "success" ? (
          <Alert
            data-testid="banner-digest-mute-success"
            className="relative border-emerald-500/50 text-emerald-900 dark:text-emerald-100 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Daily failures digest muted</AlertTitle>
            <AlertDescription>
              You won't receive this digest by email or in-app anymore. The
              per-failure ping is unaffected. Use the toggles below to re-enable
              either channel at any time.
            </AlertDescription>
            <button
              type="button"
              onClick={() => setDismissedMuteBannerKey(muteBanner.key)}
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss"
              data-testid="button-dismiss-digest-mute-banner"
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        ) : (
          <Alert
            variant="destructive"
            data-testid="banner-digest-mute-invalid"
            className="relative"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>That mute link is no longer valid</AlertTitle>
            <AlertDescription>
              The link may have expired or already been used. Use the digest
              subscription toggles below to mute it directly.
            </AlertDescription>
            <button
              type="button"
              onClick={() => setDismissedMuteBannerKey(muteBanner.key)}
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Dismiss"
              data-testid="button-dismiss-digest-mute-banner"
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        )
      ) : null}

      {canManageDigestSubscription && <DigestSubscriptionCard />}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Failing schedules</CardTitle>
              <CardDescription>
                {/*
                  Task #1785 — copy now reflects the rolling-count default
                  so admins don't think "currently broken right now" is
                  the only thing they're seeing.
                */}
                Sorted by {activeSortLabel.toLowerCase()}. Capped at 50 rows;
                resolve the distribution list and the row will clear on the next
                successful send.
              </CardDescription>
            </div>
          </div>
          {/*
            Task #1785 — sort toggle. Lets an admin pivot between
            "chronic offenders first" (default), "longest current streak
            first", and "most recently failed first" without having to
            sort the table client-side. The selection drives the GET so
            the server returns rows already in the right order.
          */}
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="group-failures-sort-options"
          >
            <span className="text-xs text-muted-foreground mr-1">Sort by:</span>
            {FAILURES_SORT_OPTIONS.map((opt) => {
              const isActive = sort === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setSort(opt.value)}
                  title={opt.description}
                  aria-pressed={isActive}
                  data-testid={`button-failures-sort-${opt.value}`}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2" data-testid="loading-log-email-failures">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="error-log-email-failures"
            >
              Couldn't load the failures list. Try the Refresh button.
            </p>
          ) : failures.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="empty-log-email-failures"
            >
              No scheduled email failures right now. Newly broken schedules will
              appear here automatically.
            </p>
          ) : (
            <div
              className="rounded-md border overflow-hidden"
              data-testid="table-log-email-failures"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Log</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last attempt</TableHead>
                    {/*
                      Task #1785 — rolling 30-day failure count surfaces
                      chronic offenders whose streak has reset on a
                      transient SUCCESS but who keep breaking again.
                    */}
                    <TableHead
                      className="text-right whitespace-nowrap"
                      title={`Failed sends in the last ${rollingWindowDays} days, including past breakages that have since recovered.`}
                    >
                      Failures ({rollingWindowDays}d)
                    </TableHead>
                    <TableHead className="text-right">In a row</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failures.map((row) => {
                    const rowKey = `${row.projectId}-${row.logType}`;
                    return (
                      <TableRow
                        key={rowKey}
                        data-testid={`row-failure-${rowKey}`}
                      >
                        <TableCell>
                          <div
                            className="font-medium"
                            data-testid={`text-project-name-${rowKey}`}
                          >
                            {row.projectName}
                          </div>
                          <div
                            className="text-xs text-muted-foreground"
                            data-testid={`text-project-code-${rowKey}`}
                          >
                            {row.projectCode}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-log-type-${rowKey}`}>
                          {row.logType}
                        </TableCell>
                        <TableCell>
                          <FailureStatusBadge
                            status={row.lastAttemptStatus}
                            rowKey={rowKey}
                          />
                          {row.lastAttemptError && (
                            <p
                              className="text-xs text-muted-foreground break-words mt-1 max-w-xs"
                              data-testid={`text-failure-error-${rowKey}`}
                            >
                              {row.lastAttemptError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-xs whitespace-nowrap"
                          data-testid={`text-last-attempt-${rowKey}`}
                        >
                          {formatLogEmailAttemptTime(row.lastAttemptAt)}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          data-testid={`text-rolling-failures-${rowKey}`}
                          title={`${row.rollingFailureCount30d ?? 0} failed send${(row.rollingFailureCount30d ?? 0) === 1 ? "" : "s"} in the last ${row.rollingFailureWindowDays ?? rollingWindowDays} days.`}
                        >
                          {row.rollingFailureCount30d ?? 0}
                        </TableCell>
                        <TableCell
                          className="text-right tabular-nums"
                          data-testid={`text-consecutive-failures-${rowKey}`}
                        >
                          {row.consecutiveFailureCount}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <ResendNowButton
                              projectId={row.projectId}
                              logType={row.logType}
                              projectName={row.projectName}
                              rowKey={rowKey}
                            />
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  data-testid={`button-view-history-${rowKey}`}
                                >
                                  <History className="w-3.5 h-3.5 mr-1" />
                                  View history
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                className="w-[480px] max-w-[90vw]"
                                data-testid={`popover-history-${rowKey}`}
                              >
                                <div className="space-y-2">
                                  <div className="text-sm font-medium">
                                    Recent attempts — {row.projectName} (
                                    {row.logType})
                                  </div>
                                  {/* `enabled` is unconditionally true here:
                                      the popover only mounts when the admin
                                      clicks the trigger, so the fetch is
                                      already lazy at the popover level. */}
                                  <RecentAttemptsBody
                                    projectId={row.projectId}
                                    logType={row.logType}
                                    testIdScope={rowKey}
                                    enabled={true}
                                  />
                                </div>
                              </PopoverContent>
                            </Popover>
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              data-testid={`link-open-project-${rowKey}`}
                            >
                              <Link href={`/projects/${row.projectCode}`}>
                                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                                Open
                              </Link>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
