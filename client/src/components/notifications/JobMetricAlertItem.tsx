import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { AlertTriangle, BellOff, Check, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { Notification } from "@shared/schema";

/**
 * Task #2010 — Snooze the noisy `pool_health` (and any other
 * job-metric alert) page from inside the in-app notification feed
 * without making the operator hop to the Job Metrics dashboard first.
 *
 * The alert engine writes one notification per fired alert with
 * `relatedEntityType: "job_metric_alert"` and
 * `relatedEntityId: "<job>:<counter|_>:<kind>"` (see
 * `server/utils/jobMetricAlerts.ts`). The dedupe key the engine reads
 * via `fetchActiveSnoozeLookup` is the same `(job, counter, kind)`
 * tuple, so snoozing any one matching event suppresses both in-app and
 * email re-notifications for the chosen window.
 *
 * Task #2022 — The same snooze controls are now exposed inside the
 * global notification bell (top header) via the compact
 * `JobMetricAlertSnoozeMenu` so admins glancing at the bell can
 * dismiss recurring pages without first deep-linking into the Job
 * Metrics dashboard.
 *
 * Task #2023 — Once snoozed, the bell row stays in the feed only as a
 * persistent banner ("Snoozed until 6:00 PM by Jane") with an
 * "Unsnooze" button, so the operator gets a clear visual confirmation
 * instead of just a transient toast. Active snoozes for the
 * `(job, counter, kind)` keys are looked up via a single shared
 * `/active-snoozes` query so we don't N+1 the bell.
 */
export function parseJobMetricAlertKey(
  relatedEntityId: string | null | undefined,
): { job: string; counter: string | null; kind: "spike" | "stall" } | null {
  if (!relatedEntityId) return null;
  const parts = relatedEntityId.split(":");
  if (parts.length !== 3) return null;
  const [job, counterRaw, kindRaw] = parts;
  if (!job) return null;
  const kind = kindRaw === "stall" ? "stall" : kindRaw === "spike" ? "spike" : null;
  if (!kind) return null;
  // The engine uses "_" as the counter sentinel for stall alerts (which
  // have a null counter); preserve that distinction so the snooze
  // lookup matches the engine's dedupe key exactly.
  const counter = counterRaw === "_" || counterRaw === "" ? null : counterRaw;
  return { job, counter, kind };
}

export const SNOOZE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 24, label: "24 hours" },
];

interface ActiveSnooze {
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  eventId: string;
  snoozedUntil: number;
  snoozedById: string | null;
  snoozedByName: string | null;
}

function snoozeKey(
  job: string,
  counter: string | null,
  kind: "spike" | "stall",
): string {
  return `${job}::${counter ?? ""}::${kind}`;
}

function formatSnoozeUntil(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? format(d, "h:mm a") : format(d, "MMM d, h:mm a");
}

/**
 * Shared hook returning the active snooze (if any) for the
 * notification's `(job, counter, kind)` key. Backed by a single
 * shared `/active-snoozes` query so N rendered rows still issue one
 * network request (react-query dedupes by queryKey).
 */
export function useJobMetricAlertActiveSnooze(
  notification: Notification,
): ActiveSnooze | null {
  const key = parseJobMetricAlertKey(notification.relatedEntityId);
  const { data: activeSnoozesData } = useQuery<{ snoozes: ActiveSnooze[] }>({
    queryKey: ["/api/admin/metrics/jobs/alerts/active-snoozes"],
    // Cheap to refresh and lets the banner expire naturally without
    // requiring a manual refetch when the snooze window ends.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!key || !activeSnoozesData?.snoozes?.length) return null;
  const target = snoozeKey(key.job, key.counter, key.kind);
  const now = Date.now();
  return (
    activeSnoozesData.snoozes.find(
      (s) =>
        snoozeKey(s.job, s.counter, s.kind) === target &&
        s.snoozedUntil > now,
    ) ?? null
  );
}

/**
 * Shared hook that POSTs to the snooze-by-key endpoint, surfaces a
 * toast, and refreshes the bell + dashboard caches. Used by both the
 * dashboard widget item and the compact bell variant so the two share
 * one source of truth for endpoint, payload, and cache invalidation.
 */
export function useJobMetricAlertSnooze(
  notification: Notification,
  options?: { onSnoozed?: () => void },
) {
  const { toast } = useToast();
  const key = parseJobMetricAlertKey(notification.relatedEntityId);

  const mutation = useMutation({
    mutationFn: async ({ hours }: { hours: number }) => {
      if (!key) throw new Error("Alert key missing");
      const res = await apiRequest(
        "POST",
        "/api/admin/metrics/jobs/alerts/snooze-by-key",
        { job: key.job, counter: key.counter, kind: key.kind, hours },
      );
      return res.json();
    },
    onSuccess: (_data, vars) => {
      toast({
        title: `Snoozed for ${vars.hours}h`,
        description: key
          ? `${key.job}${key.counter ? ` · ${key.counter}` : ""} · ${key.kind}`
          : undefined,
      });
      // Mark the bell row as read so it disappears from the unread feed
      // — the underlying alert is recorded on the dashboard regardless.
      options?.onSnoozed?.();
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/unread-count"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/metrics/jobs/alerts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/metrics/jobs/alerts/active-snoozes"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not snooze alert",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return { key, mutation };
}

/**
 * Shared hook that POSTs to the per-event unsnooze endpoint and
 * refreshes the same caches as the snooze hook. Used by both the
 * dashboard widget item and the compact bell variant so the
 * "Snoozed until …" banner + Unsnooze affordance behave identically
 * on every surface.
 */
export function useJobMetricAlertUnsnooze(
  notification: Notification,
  options?: { onUnsnoozed?: () => void },
) {
  const { toast } = useToast();
  const key = parseJobMetricAlertKey(notification.relatedEntityId);

  const mutation = useMutation({
    mutationFn: async ({ eventId }: { eventId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/metrics/jobs/alerts/events/${eventId}/unsnooze`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Snooze cleared",
        description: key
          ? `${key.job}${key.counter ? ` · ${key.counter}` : ""} · ${key.kind}`
          : undefined,
      });
      options?.onUnsnoozed?.();
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/notifications/unread-count"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/metrics/jobs/alerts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/metrics/jobs/alerts/active-snoozes"],
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not unsnooze alert",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return { key, mutation };
}

/**
 * Compact "Snoozed until …" banner — shared between the dashboard
 * widget item and the bell row variant so both surfaces show the
 * persistent confirmation introduced in Task #2023.
 */
function SnoozedBanner({
  notification,
  activeSnooze,
}: {
  notification: Notification;
  activeSnooze: ActiveSnooze;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-amber-300/50 bg-amber-100/50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200"
      data-testid={`banner-snoozed-${notification.id}`}
    >
      <BellOff className="w-3.5 h-3.5 shrink-0" />
      <span className="break-words">
        Snoozed until {formatSnoozeUntil(activeSnooze.snoozedUntil)}
        {activeSnooze.snoozedByName ? ` by ${activeSnooze.snoozedByName}` : ""}
      </span>
    </div>
  );
}

/**
 * Compact snooze dropdown — the same Snooze 1h/4h/24h options as the
 * dashboard widget, sized for the global notification bell rows. The
 * trigger stops click propagation so opening the menu does not
 * navigate the parent row's deep-link or close the bell popover; menu
 * items use `onSelect` (Radix) which does close the inner menu after
 * the choice is made, leaving the bell popover open.
 *
 * When the alert is currently snoozed (Task #2023), the dropdown
 * collapses to a single "Unsnooze" button so the operator can clear
 * the active snooze with one click instead of picking a window.
 */
export function JobMetricAlertSnoozeMenu({
  notification,
  onSnoozed,
  size = "default",
}: {
  notification: Notification;
  onSnoozed?: () => void;
  size?: "default" | "sm";
}) {
  const { key, mutation } = useJobMetricAlertSnooze(notification, { onSnoozed });
  const activeSnooze = useJobMetricAlertActiveSnooze(notification);
  const { mutation: unsnoozeMutation } = useJobMetricAlertUnsnooze(notification);
  if (!key) return null;

  const triggerClass =
    size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 text-xs";

  if (activeSnooze) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={triggerClass}
        disabled={unsnoozeMutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          unsnoozeMutation.mutate({ eventId: activeSnooze.eventId });
        }}
        data-testid={`button-unsnooze-notification-${notification.id}`}
      >
        <BellOff className="w-3 h-3 mr-1" />
        Unsnooze
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={triggerClass}
          disabled={mutation.isPending}
          onClick={(e) => {
            // Don't let the click bubble to the parent bell row
            // (which would mark-read / navigate / close the popover).
            e.stopPropagation();
          }}
          data-testid={`button-snooze-notification-${notification.id}`}
        >
          <BellOff className="w-3 h-3 mr-1" />
          Snooze
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        {SNOOZE_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.hours}
            onSelect={(e) => {
              // Keep the parent bell popover open after choosing a
              // snooze window — Radix would otherwise propagate the
              // close request up to the outer DropdownMenu.
              e.preventDefault();
              mutation.mutate({ hours: opt.hours });
            }}
            data-testid={`option-snooze-notification-${notification.id}-${opt.hours}h`}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Compact bell-row variant for `relatedEntityType === "job_metric_alert"`
 * notifications shown in the global header bell. Shares the same
 * snooze + dismiss wiring as the dashboard widget item but keeps the
 * tighter padding / hover styling used by sibling bell rows so admins
 * get the same one-click experience without the dashboard's outlined
 * card chrome.
 *
 * `onNavigate` is invoked when the user clicks the title to open
 * the Job Metrics dashboard — bells use it to close the popover.
 */
export function JobMetricAlertBellItem({
  notification,
  onDismiss,
  onNavigate,
  isDismissing,
}: {
  notification: Notification;
  onDismiss?: () => void;
  onNavigate?: () => void;
  isDismissing?: boolean;
}) {
  const isUnread = !notification.isRead;
  const activeSnooze = useJobMetricAlertActiveSnooze(notification);

  return (
    <div
      className={`flex items-start gap-2 p-3 rounded-sm hover-elevate ${
        isUnread ? "bg-accent/50" : ""
      }`}
      data-testid={`notification-${notification.id}`}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Link
          href="/admin/job-metrics"
          onClick={() => {
            if (isUnread) onDismiss?.();
            onNavigate?.();
          }}
          className="block"
          data-testid={`link-alert-notification-${notification.id}`}
        >
          <div className="flex items-center gap-1.5">
            <p
              className="text-sm font-medium"
              data-testid={`text-alert-title-${notification.id}`}
            >
              {notification.title}
            </p>
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </div>
          <p
            className="text-xs text-muted-foreground break-words"
            data-testid={`text-alert-message-${notification.id}`}
          >
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
            })}
          </p>
        </Link>
        {activeSnooze && (
          <SnoozedBanner
            notification={notification}
            activeSnooze={activeSnooze}
          />
        )}
        <div className="flex items-center gap-2">
          <JobMetricAlertSnoozeMenu
            notification={notification}
            onSnoozed={onDismiss}
            size="sm"
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        {isUnread && (
          <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
        )}
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            disabled={isDismissing}
            data-testid={`button-dismiss-notification-${notification.id}`}
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function JobMetricAlertItem({
  notification,
  onDismiss,
  isDismissing,
}: {
  notification: Notification;
  onDismiss?: () => void;
  isDismissing?: boolean;
}) {
  const key = parseJobMetricAlertKey(notification.relatedEntityId);
  const activeSnooze = useJobMetricAlertActiveSnooze(notification);

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border"
      data-testid={`notification-item-${notification.id}`}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p
            className="text-sm font-medium"
            data-testid={`text-alert-title-${notification.id}`}
          >
            {notification.title}
          </p>
          <p
            className="text-xs text-muted-foreground break-words"
            data-testid={`text-alert-message-${notification.id}`}
          >
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
            })}
          </p>
        </div>
        {activeSnooze && (
          <SnoozedBanner
            notification={notification}
            activeSnooze={activeSnooze}
          />
        )}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Link href="/admin/job-metrics" onClick={() => onDismiss?.()}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid={`link-alert-dashboard-${notification.id}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              View dashboard
            </Button>
          </Link>
          {key && (
            <JobMetricAlertSnoozeMenu
              notification={notification}
              onSnoozed={onDismiss}
            />
          )}
        </div>
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDismiss}
          disabled={isDismissing}
          data-testid={`button-dismiss-notification-${notification.id}`}
        >
          <Check className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
