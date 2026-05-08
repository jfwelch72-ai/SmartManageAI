import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, Check, CheckCheck, Settings, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

interface PortalNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationPrefs {
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

type PortalRole = "client" | "subcontractor" | "vendor";

interface PortalNotificationBellProps {
  role: PortalRole;
  token?: string | null;
  email?: string;
  projectId?: string | null;
}

function buildHeaders(
  role: PortalRole,
  token: string | null | undefined,
  email: string | undefined,
  projectId: string | null | undefined,
): Record<string, string> {
  if (role === "subcontractor" && token) {
    return { Authorization: `Bearer ${token}` };
  }
  if (role === "client" && email && projectId) {
    return {
      "x-client-email": email,
      "x-client-project-id": projectId,
    };
  }
  return {};
}

function getApiBase(role: PortalRole): string {
  if (role === "subcontractor") return "/api/portal/notifications";
  if (role === "client") return "/api/client-portal/notifications";
  return "/api/vendor/notifications";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return date.toLocaleDateString();
}

export function PortalNotificationBell({
  role,
  token,
  email,
  projectId,
}: PortalNotificationBellProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>({ emailEnabled: true, inAppEnabled: true });
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanedUpRef = useRef(false);

  const apiBase = getApiBase(role);
  const headers = buildHeaders(role, token, email, projectId);
  const headersKey = JSON.stringify(headers);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/unread-count`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count ?? 0);
      }
    } catch {
      // best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, headersKey]);

  const fetchNotifications = useCallback(async (page = 1) => {
    try {
      const res = await fetch(`${apiBase}?page=${page}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (page === 1) {
          setNotifications(data.data ?? []);
        } else {
          setNotifications((prev) => [...prev, ...(data.data ?? [])]);
        }
        setPagination(data.pagination ?? null);
      }
    } catch {
      // best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, headersKey]);

  const fetchPrefs = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/preferences`, { headers });
      if (res.ok) {
        const data = await res.json();
        setPrefs(data);
      }
    } catch {
      // best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, headersKey]);

  useEffect(() => {
    void fetchUnreadCount();
    const interval = setInterval(() => void fetchUnreadCount(), 60000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!open) return;
    void fetchNotifications(1);
    void fetchPrefs();
  }, [open, fetchNotifications, fetchPrefs]);

  const loadMore = async () => {
    if (!pagination?.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchNotifications(pagination.page + 1);
    } finally {
      setLoadingMore(false);
    }
  };

  // SSE connection for real-time notification:new events.
  // • subcontractor → /api/portal/chat/events?token=...
  // • client → /api/client-portal/chat/events?email=...&projectId=...
  // • vendor → /api/vendor/notifications/stream (cookie auth, no query params)
  useEffect(() => {
    cleanedUpRef.current = false;

    let sseUrl: string | null = null;
    if (role === "subcontractor" && token) {
      sseUrl = `/api/portal/chat/events?token=${encodeURIComponent(token)}`;
    } else if (role === "client" && email && projectId) {
      sseUrl = `/api/client-portal/chat/events?email=${encodeURIComponent(email)}&projectId=${encodeURIComponent(projectId)}`;
    } else if (role === "vendor") {
      sseUrl = "/api/vendor/notifications/stream";
    }

    if (!sseUrl) return;

    function connect() {
      if (cleanedUpRef.current || !sseUrl) return;
      const es = new EventSource(sseUrl);
      esRef.current = es;

      es.addEventListener("notification:new", (ev) => {
        setUnreadCount((c) => c + 1);
        if (open) {
          void fetchNotifications(1);
        }
        // Show a toast for the incoming notification
        try {
          const payload = JSON.parse((ev as MessageEvent).data ?? "{}");
          toast({
            title: payload.title ?? "New notification",
            description: payload.message ?? "You have a new portal notification.",
            duration: 5000,
          });
        } catch {
          toast({
            title: "New notification",
            description: "You have a new portal notification.",
            duration: 5000,
          });
        }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cleanedUpRef.current) {
          reconnectRef.current = setTimeout(() => {
            reconnectRef.current = null;
            if (!cleanedUpRef.current && !esRef.current) {
              connect();
            }
          }, 8000);
        }
      };
    }

    connect();

    return () => {
      cleanedUpRef.current = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      if (esRef.current) {
        esRef.current.onerror = null;
        esRef.current.close();
        esRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, email, projectId]);

  const markRead = async (id: string) => {
    try {
      await fetch(`${apiBase}/${id}/read`, { method: "POST", headers });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // best-effort
    }
  };

  const markAllRead = async () => {
    try {
      await fetch(`${apiBase}/read-all`, { method: "POST", headers });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // best-effort
    }
  };

  const savePrefs = async (updated: NotificationPrefs) => {
    setLoadingPrefs(true);
    try {
      await fetch(`${apiBase}/preferences`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setPrefs(updated);
    } catch {
      // best-effort
    } finally {
      setLoadingPrefs(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="relative"
        onClick={() => setOpen(true)}
        data-testid="button-portal-notification-bell"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 w-4 min-w-[16px] text-[10px] flex items-center justify-center p-0 rounded-full"
            data-testid="badge-portal-notification-count"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </Badge>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col p-0"
          data-testid="sheet-portal-notifications"
        >
          <SheetHeader className="px-4 pt-4 pb-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base">Notifications</SheetTitle>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => void markAllRead()}
                    data-testid="button-mark-all-read"
                  >
                    <CheckCheck className="h-3 w-3 mr-1" />
                    Mark all read
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setShowPrefs((p) => !p)}
                  data-testid="button-notification-prefs-toggle"
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <SheetDescription className="sr-only">
              Your portal notifications
            </SheetDescription>
          </SheetHeader>

          {showPrefs ? (
            <div className="px-4 py-4 space-y-4">
              <p className="text-sm font-medium">Notification Preferences</p>
              <div className="flex items-center justify-between">
                <Label htmlFor="pref-in-app" className="text-sm">
                  In-app notifications
                </Label>
                <Switch
                  id="pref-in-app"
                  checked={prefs.inAppEnabled}
                  disabled={loadingPrefs}
                  onCheckedChange={(v) => void savePrefs({ ...prefs, inAppEnabled: v })}
                  data-testid="switch-in-app-notifications"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="pref-email" className="text-sm">
                  Email notifications
                </Label>
                <Switch
                  id="pref-email"
                  checked={prefs.emailEnabled}
                  disabled={loadingPrefs}
                  onCheckedChange={(v) => void savePrefs({ ...prefs, emailEnabled: v })}
                  data-testid="switch-email-notifications"
                />
              </div>
              <Separator />
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowPrefs(false)}
                data-testid="button-back-to-notifications"
              >
                Back to notifications
              </Button>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                  <Bell className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                        n.isRead
                          ? "bg-background"
                          : "bg-blue-50/50 dark:bg-blue-950/20"
                      }`}
                      data-testid={`notification-item-${n.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-sm font-medium leading-tight ${
                              n.isRead ? "text-muted-foreground" : "text-foreground"
                            }`}
                          >
                            {n.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                            {formatRelativeTime(n.createdAt)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {n.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {n.actionUrl && (
                            <a
                              href={n.actionUrl}
                              className="text-xs text-primary hover:underline"
                              onClick={() => void markRead(n.id)}
                              data-testid={`notification-link-${n.id}`}
                            >
                              View details
                            </a>
                          )}
                          {!n.isRead && (
                            <button
                              className="text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => void markRead(n.id)}
                              data-testid={`button-mark-read-${n.id}`}
                            >
                              <Check className="h-3 w-3 inline mr-0.5" />
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                      {!n.isRead && (
                        <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                      )}
                    </div>
                  ))}

                  {pagination?.hasMore && (
                    <div className="px-4 py-3 flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                        onClick={() => void loadMore()}
                        disabled={loadingMore}
                        data-testid="button-load-more-notifications"
                      >
                        {loadingMore ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <ChevronDown className="h-3 w-3 mr-1" />
                        )}
                        {loadingMore ? "Loading..." : "Load more"}
                      </Button>
                    </div>
                  )}

                  {pagination && !pagination.hasMore && notifications.length > 0 && (
                    <p className="text-center text-[10px] text-muted-foreground py-3">
                      All {pagination.total} notification{pagination.total !== 1 ? "s" : ""} loaded
                    </p>
                  )}
                </div>
              )}
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
