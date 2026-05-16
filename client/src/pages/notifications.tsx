import { ContextualHelpButton } from "@/components/ContextualHelpButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Bell, Check, CheckCheck, AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useState } from "react";
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/hooks/use-data";
import { CertifiedPayrollDigestItem } from "@/components/notifications/CertifiedPayrollDigestItem";
import { getNotificationDestination } from "@/lib/notificationDestination";
import type { Notification } from "@shared/schema";

export function StandardNotificationItem({
  notification,
  onDismiss,
  isDismissing,
}: {
  notification: Notification;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  const destination = getNotificationDestination(notification);
  // Task #1974 — secondary "Open <recordLabel>" link for
  // INTEGRATION_SYNC_RETRIES_EXHAUSTED rows whose failed QBO sync
  // resolves to a customer / pay app / pay run. Mirrors the email's
  // secondary CTA from Task #1945. Orphan IDs leave metadata unset and
  // the link is omitted, same as the email path.
  const recordLink = notification.metadata?.recordLink ?? null;
  const recordLabel = notification.metadata?.recordLabel ?? null;
  const hasRecordLink = !!(recordLink && recordLabel);

  const body = (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium" data-testid={`text-title-${notification.id}`}>
          {notification.title}
        </p>
        {!notification.isRead && (
          <span className="w-2 h-2 rounded-full bg-primary shrink-0" aria-label="unread" />
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
        {notification.message}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {format(new Date(notification.createdAt), "MMM d, yyyy h:mm a")} ·{" "}
        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
      </p>
    </div>
  );

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-md border border-border ${
        notification.isRead ? "bg-background" : "bg-muted/50"
      }`}
      data-testid={`notification-item-${notification.id}`}
    >
      <div className="flex-1 min-w-0">
        {destination ? (
          <Link href={destination} className="block">
            {body}
          </Link>
        ) : (
          body
        )}
        {hasRecordLink && recordLink && recordLabel && (
          <Link
            href={recordLink}
            onClick={(e) => {
              e.stopPropagation();
              if (!notification.isRead) {
                onDismiss();
              }
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            data-testid={`link-notification-record-${notification.id}`}
          >
            <ExternalLink className="h-3 w-3" />
            Open {recordLabel}
          </Link>
        )}
      </div>
      {!notification.isRead && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={onDismiss}
          disabled={isDismissing}
          data-testid={`button-dismiss-notification-${notification.id}`}
          aria-label="Mark as read"
        >
          <Check className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

function renderNotification(
  notification: Notification,
  onDismiss: () => void,
  isDismissing: boolean,
) {
  if (notification.relatedEntityType === "CERTIFIED_PAYROLL_DIGEST") {
    return (
      <CertifiedPayrollDigestItem
        key={notification.id}
        notification={notification}
        onDismiss={onDismiss}
        isDismissing={isDismissing}
        onView={notification.isRead ? undefined : onDismiss}
        showDismiss={!notification.isRead}
      />
    );
  }
  return (
    <StandardNotificationItem
      key={notification.id}
      notification={notification}
      onDismiss={onDismiss}
      isDismissing={isDismissing}
    />
  );
}

export default function NotificationsInboxPage() {
  const { data: notifications = [], isLoading, isError, refetch } = useNotifications();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();
  const [tab, setTab] = useState<"unread" | "all">("unread");

  const unread = notifications.filter((n) => !n.isRead);
  const list = tab === "unread" ? unread : notifications;

  return (
    <div className="container max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <title>Notifications | SmartManage</title>
      <meta name="description" content="Review your notifications inbox, including certified payroll digests and recent activity alerts." />

      <Card data-testid="card-notifications-inbox">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
              {unread.length > 0 && (
                <Badge variant="default" data-testid="badge-unread-count">
                  {unread.length}
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <ContextualHelpButton />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isLoading}
                data-testid="button-refresh-notifications"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Refresh
              </Button>
              {unread.length > 0 && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => markAllAsRead.mutate()}
                  disabled={markAllAsRead.isPending}
                  data-testid="button-mark-all-read"
                >
                  <CheckCheck className="w-3.5 h-3.5 mr-1.5" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "unread" | "all")}>
            <TabsList className="mb-4">
              <TabsTrigger value="unread" data-testid="tab-unread">
                Unread {unread.length > 0 && `(${unread.length})`}
              </TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-all">
                All ({notifications.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value={tab} className="mt-0">
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-md" />
                  ))}
                </div>
              ) : isError ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <AlertCircle className="w-6 h-6 text-destructive" />
                  <p className="text-sm text-muted-foreground">Failed to load notifications.</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-notifications">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              ) : list.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-10 text-center"
                  data-testid="notifications-empty"
                >
                  <Bell className="w-8 h-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {tab === "unread" ? "All caught up!" : "No notifications yet."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2" data-testid="list-notifications">
                  {list.map((n) =>
                    renderNotification(
                      n,
                      () => markAsRead.mutate(n.id),
                      markAsRead.isPending,
                    ),
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
