import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, AlertCircle, RefreshCw, FileText, ExternalLink } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Notification } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Link } from "wouter";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDigestRange(relatedEntityId: string | null | undefined): { startDate: string; endDate: string } {
  const parts = (relatedEntityId ?? "").split("|");
  const startDate = ISO_DATE.test(parts[0] ?? "") ? parts[0] : "";
  const endDate = ISO_DATE.test(parts[1] ?? "") ? parts[1] : "";
  return { startDate, endDate };
}

function parseDigestMessage(message: string): {
  header: string;
  rows: Array<{ project: string; variant: string; count: string }>;
} {
  const lines = message.split("\n");
  const header = lines[0] ?? "";
  const rows = lines
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const sepIdx = line.lastIndexOf(": ");
      const left = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
      const count = sepIdx >= 0 ? line.slice(sepIdx + 2) : "";
      const dashIdx = left.lastIndexOf(" — ");
      const project = dashIdx >= 0 ? left.slice(0, dashIdx) : left;
      const variant = dashIdx >= 0 ? left.slice(dashIdx + 3) : "";
      return { project, variant, count };
    });
  return { header, rows };
}

function CertifiedPayrollDigestItem({
  notification,
  onDismiss,
  isDismissing,
}: {
  notification: Notification;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  const { startDate, endDate } = parseDigestRange(notification.relatedEntityId);
  const { header, rows } = parseDigestMessage(notification.message);
  const qs = new URLSearchParams();
  if (startDate) qs.set("startDate", startDate);
  if (endDate) qs.set("endDate", endDate);
  const href = `/payroll/certified-history${qs.toString() ? `?${qs.toString()}` : ""}`;

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-md bg-muted/50 border border-border"
      data-testid={`notification-item-${notification.id}`}
    >
      <FileText className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-medium" data-testid={`text-digest-title-${notification.id}`}>
            {notification.title}
          </p>
          {header && (
            <p
              className="text-xs text-muted-foreground"
              data-testid={`text-digest-header-${notification.id}`}
            >
              {header}
            </p>
          )}
        </div>
        {rows.length > 0 && (
          <div
            className="rounded border border-border overflow-hidden"
            data-testid={`table-digest-breakdown-${notification.id}`}
          >
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Project
                  </th>
                  <th className="text-left px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Variant
                  </th>
                  <th className="text-right px-2 py-1 font-medium text-muted-foreground uppercase tracking-wide">
                    Reports
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={`${notification.id}-row-${idx}`}
                    className="border-t border-border"
                    data-testid={`row-digest-breakdown-${notification.id}-${idx}`}
                  >
                    <td className="px-2 py-1">{r.project}</td>
                    <td className="px-2 py-1 text-muted-foreground">{r.variant}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
          </p>
          <Link href={href}>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid={`link-digest-history-${notification.id}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              View week
            </Button>
          </Link>
        </div>
      </div>
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
    </div>
  );
}

export function NotificationsWidget({ config }: { config?: Record<string, unknown> }) {
  const { data: notifications = [], isLoading, isError, refetch } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });
  const [showAll, setShowAll] = useState(false);
  const displayLimit = (config?.displayLimit as number) || 5;

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest(
        "PATCH",
        `/api/notifications/${notificationId}/read`
      );
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  if (isLoading) {
    return (
      <Card className="h-full" data-testid="card-notifications">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" />
            <Skeleton className="h-4 w-24" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 p-2 rounded-md">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
              <Skeleton className="h-7 w-7 rounded shrink-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="h-full" data-testid="card-notifications-error">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive" />
          <p className="text-sm text-muted-foreground">Failed to load notifications.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-notifications">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const unreadNotifications = notifications.filter((n) => !n.isRead);
  const displayedNotifications = showAll ? unreadNotifications : unreadNotifications.slice(0, displayLimit);
  const hasMore = unreadNotifications.length > displayLimit;

  return (
    <Card className="h-full" data-testid="card-notifications">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
            {unreadNotifications.length > 0 && (
              <Badge variant="default" className="ml-1">
                {unreadNotifications.length}
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {unreadNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="notifications-empty">
            <Bell className="w-6 h-6 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">All caught up!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {displayedNotifications.map((notification) => {
              if (notification.relatedEntityType === "CERTIFIED_PAYROLL_DIGEST") {
                return (
                  <CertifiedPayrollDigestItem
                    key={notification.id}
                    notification={notification}
                    onDismiss={() => markAsReadMutation.mutate(notification.id)}
                    isDismissing={markAsReadMutation.isPending}
                  />
                );
              }
              return (
                <div
                  key={notification.id}
                  className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
                  data-testid={`notification-item-${notification.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{notification.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {notification.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notification.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => markAsReadMutation.mutate(notification.id)}
                    disabled={markAsReadMutation.isPending}
                    data-testid={`button-dismiss-notification-${notification.id}`}
                  >
                    <Check className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
            {hasMore && !showAll && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(true)}
                data-testid="button-show-more-notifications"
              >
                Show {unreadNotifications.length - displayLimit} more
              </Button>
            )}
            {showAll && hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => setShowAll(false)}
                data-testid="button-show-less-notifications"
              >
                Show less
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
