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
import { useQuery } from "@tanstack/react-query";
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
  MailWarning,
} from "lucide-react";
import {
  RecentAttemptsBody,
  formatLogEmailAttemptTime,
  type LogEmailAttemptStatus,
  type LogEmailLogType,
} from "@/components/log-email/RecentAttempts";

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
