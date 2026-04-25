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

const SNOOZE_OPTIONS: Array<{ hours: number; label: string }> = [
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

export function JobMetricAlertItem({
  notification,
  onDismiss,
  isDismissing,
}: {
  notification: Notification;
  onDismiss?: () => void;
  isDismissing?: boolean;
}) {
  const { toast } = useToast();
  const key = parseJobMetricAlertKey(notification.relatedEntityId);

  // Shared across every JobMetricAlertItem in the feed — react-query
  // dedupes by queryKey, so N rows still issue one network request.
  // Refetched on snooze/unsnooze success below so the banner flips
  // immediately without waiting for the next polling tick.
  const { data: activeSnoozesData } = useQuery<{ snoozes: ActiveSnooze[] }>({
    queryKey: ["/api/admin/metrics/jobs/alerts/active-snoozes"],
    // Cheap to refresh and lets the banner expire naturally without
    // requiring a manual refetch when the snooze window ends.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const activeSnooze = (() => {
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
  })();

  const snoozeMutation = useMutation({
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
      onDismiss?.();
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
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

  const unsnoozeMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
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
          <div
            className="flex items-center gap-2 rounded-md border border-amber-300/50 bg-amber-100/50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid={`banner-snoozed-${notification.id}`}
          >
            <BellOff className="w-3.5 h-3.5 shrink-0" />
            <span className="break-words">
              Snoozed until {formatSnoozeUntil(activeSnooze.snoozedUntil)}
              {activeSnooze.snoozedByName
                ? ` by ${activeSnooze.snoozedByName}`
                : ""}
            </span>
          </div>
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
          {key && activeSnooze ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={unsnoozeMutation.isPending}
              onClick={() =>
                unsnoozeMutation.mutate({ eventId: activeSnooze.eventId })
              }
              data-testid={`button-unsnooze-notification-${notification.id}`}
            >
              <BellOff className="w-3 h-3 mr-1" />
              Unsnooze
            </Button>
          ) : (
            key && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={snoozeMutation.isPending}
                    data-testid={`button-snooze-notification-${notification.id}`}
                  >
                    <BellOff className="w-3 h-3 mr-1" />
                    Snooze
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SNOOZE_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.hours}
                      onSelect={() => snoozeMutation.mutate({ hours: opt.hours })}
                      data-testid={`option-snooze-notification-${notification.id}-${opt.hours}h`}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
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
