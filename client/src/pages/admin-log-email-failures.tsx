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
import { useMemo } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ExternalLink,
  History,
  Loader2,
  MailWarning,
  Send,
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

// Mirrors the row shape returned by `GET /api/log-email-schedule-failures`.
// The endpoint already filters to FAILURE/NO_RECIPIENTS, so we don't need
// to second-guess `lastAttemptStatus` here — it's never SUCCESS.
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
}

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
 */
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
      queryClient.invalidateQueries({ queryKey: ["/api/log-email-schedule-failures"] });
      queryClient.invalidateQueries({ queryKey: buildAttemptsQueryKey(projectId, logType) });
    },
    onError: (err) => {
      // The 30s debounce returns 429 with the wait-time message — the
      // shared apiRequest helper surfaces it as `err.message`, so the
      // admin sees the exact "Please wait N seconds" copy.
      toast({
        title: "Couldn't resend the log",
        description: err instanceof Error ? err.message : "Please try again in a moment.",
        variant: "destructive",
      });
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      data-testid={`button-resend-now-${rowKey}`}
      title={`Re-run the scheduled send for ${projectName} (${logType}) now.`}
    >
      {mutation.isPending ? (
        <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
      ) : (
        <Send className="w-3.5 h-3.5 mr-1" />
      )}
      Resend now
    </Button>
  );
}

function FailureStatusBadge({ status, rowKey }: { status: LogEmailAttemptStatus; rowKey: string }) {
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

export default function AdminLogEmailFailuresPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{
    failures: FailureRow[];
  }>({
    queryKey: ["/api/log-email-schedule-failures"],
  });

  const failures = useMemo(() => data?.failures ?? [], [data]);

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold" data-testid="heading-log-email-failures">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failing schedules</CardTitle>
          <CardDescription>
            Sorted by most recent attempt. Capped at 50 rows; resolve the
            distribution list and the row will clear on the next successful
            send.
          </CardDescription>
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
                          <div className="font-medium" data-testid={`text-project-name-${rowKey}`}>
                            {row.projectName}
                          </div>
                          <div className="text-xs text-muted-foreground" data-testid={`text-project-code-${rowKey}`}>
                            {row.projectCode}
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-log-type-${rowKey}`}>
                          {row.logType}
                        </TableCell>
                        <TableCell>
                          <FailureStatusBadge status={row.lastAttemptStatus} rowKey={rowKey} />
                          {row.lastAttemptError && (
                            <p
                              className="text-xs text-muted-foreground break-words mt-1 max-w-xs"
                              data-testid={`text-failure-error-${rowKey}`}
                            >
                              {row.lastAttemptError}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap" data-testid={`text-last-attempt-${rowKey}`}>
                          {formatLogEmailAttemptTime(row.lastAttemptAt)}
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
                                    Recent attempts — {row.projectName} ({row.logType})
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
