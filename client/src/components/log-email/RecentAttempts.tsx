/**
 * Task #1666 — shared "Recent attempts" view for a per-project
 * scheduled log email.
 *
 * Originally lived inside `ProjectLogEmailScheduleCard.tsx` (Task
 * #1652) as a collapsible audit trail under each schedule row in the
 * project settings card. The org-wide "scheduled email failures"
 * dashboard now wants the same data behind a per-row "View history"
 * popover so admins can triage failing schedules across every project
 * without opening each project one by one. To avoid duplicating the
 * fetch shape + status badge styling in two places, we extracted the
 * component (and its supporting types/helpers) here. Both call sites
 * hit the same `GET /api/projects/:projectId/log-email-schedules/:logType/attempts`
 * endpoint — we don't add a second underlying API.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  MailWarning,
  Send,
} from "lucide-react";

/**
 * Task #1664 — optional Retry action wired into each FAILURE row of
 * the recent-attempts table. The project settings card supplies this
 * (so admins can re-trigger a failed send without leaving the audit
 * trail); the org-wide dashboard's "View history" popover omits it
 * because retry is already exposed elsewhere in that flow. When this
 * prop is absent or null, the Actions column is hidden entirely so the
 * table layout matches the pre-#1664 look.
 */
export interface RecentAttemptsRetryConfig {
  onRetry: () => void;
  isRetrying: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

export type LogEmailLogType = "RFI" | "SUBMITTAL";
export type LogEmailAttemptStatus = "SUCCESS" | "FAILURE" | "NO_RECIPIENTS";

export interface LogEmailAttemptRow {
  id: string;
  status: LogEmailAttemptStatus;
  error: string | null;
  recipientCount: number;
  triggerType: "CRON" | "MANUAL";
  triggeredById: string | null;
  triggeredByLabel: string;
  createdAt: string;
}

export function formatLogEmailAttemptTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "MMM d, yyyy h:mm a");
  } catch {
    return iso;
  }
}

export function buildAttemptsQueryKey(projectId: string, logType: LogEmailLogType) {
  return ["/api/projects", projectId, "log-email-schedules", logType, "attempts"] as const;
}

interface RecentAttemptsTableProps {
  attempts: LogEmailAttemptRow[];
  testIdScope: string;
  retry?: RecentAttemptsRetryConfig | null;
}

/**
 * Pure renderer for a list of attempt rows. Doesn't fetch — the
 * dashboard popover and the project-card collapsible both compose this
 * with their own query wrappers so they can share lifecycle (e.g.
 * lazy-load on open) and styling chrome.
 */
export function RecentAttemptsTable({ attempts, testIdScope, retry }: RecentAttemptsTableProps) {
  if (attempts.length === 0) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid={`empty-attempt-history-${testIdScope}`}
      >
        No attempts recorded yet. The next scheduled cron tick (or a manual "Send now" click) will appear here.
      </p>
    );
  }
  const showActions = !!retry;
  return (
    <div
      className="rounded-md border overflow-hidden"
      data-testid={`table-attempt-history-${testIdScope}`}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">When</TableHead>
            <TableHead className="text-xs">Status</TableHead>
            <TableHead className="text-xs">Triggered by</TableHead>
            <TableHead className="text-xs text-right">Recipients</TableHead>
            {/* Task #1664 — actions column hosts the per-row Retry
                button on FAILURE rows. We only render the column when
                retry is wired up at all (cadence != OFF, schedule
                persisted) so we don't add a permanently empty column
                for retired schedules or for the dashboard's read-only
                popover. */}
            {showActions && <TableHead className="text-xs text-right w-0">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {attempts.map((a) => (
            <TableRow key={a.id} data-testid={`row-attempt-${testIdScope}-${a.id}`}>
              <TableCell
                className="text-xs whitespace-nowrap"
                data-testid={`text-attempt-when-${a.id}`}
              >
                {formatLogEmailAttemptTime(a.createdAt)}
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
              <TableCell
                className="text-xs text-right tabular-nums"
                data-testid={`text-attempt-recipients-${a.id}`}
              >
                {a.recipientCount}
              </TableCell>
              {/* Task #1664 — Retry action. Only meaningful for
                  FAILURE rows; SUCCESS / NO_RECIPIENTS rows render an
                  empty cell so column alignment stays consistent. */}
              {showActions && retry && (
                <TableCell className="text-xs text-right">
                  {a.status === "FAILURE" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={retry.disabled}
                      onClick={() => retry.onRetry()}
                      data-testid={`button-retry-attempt-${a.id}`}
                      title={
                        retry.disabledReason ??
                        "Retry this send using the saved cadence's recipients."
                      }
                    >
                      {retry.isRetrying ? (
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
  );
}

interface RecentAttemptsBodyProps {
  projectId: string;
  logType: LogEmailLogType;
  enabled: boolean;
  testIdScope: string;
  retry?: RecentAttemptsRetryConfig | null;
}

/**
 * Lazy-loaded body that owns the query lifecycle. Use when you want
 * to gate the fetch on (e.g.) "is the popover open?" without forcing
 * the parent to manage React Query state itself.
 */
export function RecentAttemptsBody({
  projectId,
  logType,
  enabled,
  testIdScope,
  retry,
}: RecentAttemptsBodyProps) {
  const queryKey = useMemo(
    () => buildAttemptsQueryKey(projectId, logType),
    [projectId, logType],
  );
  const { data, isLoading, isError } = useQuery<{ attempts: LogEmailAttemptRow[] }>({
    queryKey,
    enabled,
  });

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid={`loading-attempt-history-${testIdScope}`}>
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid={`error-attempt-history-${testIdScope}`}
      >
        Couldn't load the send history. Try again in a moment.
      </p>
    );
  }
  return (
    <RecentAttemptsTable
      attempts={data?.attempts ?? []}
      testIdScope={testIdScope}
      retry={retry}
    />
  );
}

interface RecentAttemptsCollapsibleProps {
  projectId: string;
  logType: LogEmailLogType;
  testIdSuffix: string;
  retry?: RecentAttemptsRetryConfig | null;
}

/**
 * Drop-in replacement for the original collapsible used inside the
 * project settings card. Keeps the same testids and trigger styling
 * so existing tests / selectors don't have to change.
 */
export function RecentAttemptsCollapsible({
  projectId,
  logType,
  testIdSuffix,
  retry,
}: RecentAttemptsCollapsibleProps) {
  const [open, setOpen] = useState(false);
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
        <RecentAttemptsBody
          projectId={projectId}
          logType={logType}
          enabled={open}
          testIdScope={testIdSuffix}
          retry={retry}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AttemptHistoryBadge({
  status,
  attemptId,
}: {
  status: LogEmailAttemptStatus;
  attemptId: string;
}) {
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
