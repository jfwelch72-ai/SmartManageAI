import { Avatar, AvatarImage, ColoredAvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, CheckCheck, User, LogOut, MessageSquare, Bot, Settings, Search } from "lucide-react";
import { openCommandPalette } from "./CommandPalette";
import ThemeToggle from "./ThemeToggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useUnreadNotificationCount, useUnreadMessageCount } from "@/hooks/use-data";
import { hasContractorAccess, isSuperAdmin, getRoleDisplayName } from "@/lib/rbac";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { getNotificationDestination } from "@/lib/notificationDestination";
import { JobMetricAlertBellItem } from "@/components/notifications/JobMetricAlertItem";
import { BackgroundActivityTray } from "@/components/BackgroundActivityTray";

const ASK_AI_STORAGE_KEY = "smartmanage-ask-ai-enabled";

export default function TopHeader() {
  const { user, logout } = useAuth();
  const [isAskAiEnabled, setIsAskAiEnabled] = useState(() => {
    const stored = localStorage.getItem(ASK_AI_STORAGE_KEY);
    return stored !== "false";
  });

  const handleToggleAskAi = () => {
    const newValue = !isAskAiEnabled;
    setIsAskAiEnabled(newValue);
    localStorage.setItem(ASK_AI_STORAGE_KEY, String(newValue));
    window.dispatchEvent(new Event("storage"));
  };

  if (!user) return null;

  const userName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "User";
  const userRole = user.role;

  const { data: notificationsData = { count: 0 } } = useUnreadNotificationCount();
  const { data: notifications = [] } = useNotifications();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();
  const { data: messageCountData = { unreadCount: 0 } } = useUnreadMessageCount();

  const unreadCount = notificationsData.count || 0;
  const unreadMessageCount = messageCountData.unreadCount || 0;
  const unreadNotifications = notifications.filter(n => !n.isRead);

  const [, setLocation] = useLocation();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    if (!notification.isRead) {
      markAsRead.mutate(notification.id);
    }
    const destination = getNotificationDestination(notification);
    setNotificationsOpen(false);
    if (destination) {
      setTimeout(() => {
        setLocation(destination);
      }, 100);
    }
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate();
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-2 sm:px-4 gap-2 sm:gap-4">
        <div className="flex items-center gap-2">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          {userRole === 'HUSTLER' && <OrganizationSwitcher />}
        </div>

        <div className="flex-1 flex justify-center px-2 max-w-xl mx-auto hidden sm:flex">
          <Button
            variant="outline"
            size="sm"
            className="w-full max-w-md justify-between text-muted-foreground"
            onClick={openCommandPalette}
            data-testid="button-command-palette"
          >
            <span className="flex items-center gap-2">
              <Search className="w-4 h-4" />
              Search…
            </span>
            <kbd className="pointer-events-none ml-2 inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={openCommandPalette}
            data-testid="button-command-palette-mobile"
            aria-label="Search"
          >
            <Search className="w-5 h-5" />
          </Button>
          {hasContractorAccess(userRole) && (
            <Button variant="ghost" size="icon" className="relative" onClick={() => window.dispatchEvent(new CustomEvent("open-messaging-widget"))} data-testid="button-messages">
                <MessageSquare className="w-5 h-5" />
                {unreadMessageCount > 0 && (
                  <Badge 
                    variant="default" 
                    className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
                    data-testid="badge-unread-messages"
                  >
                    {unreadMessageCount}
                  </Badge>
                )}
            </Button>
          )}

          {hasContractorAccess(userRole) && <BackgroundActivityTray />}

          {hasContractorAccess(userRole) && (
            <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
                  <Bell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <Badge 
                      variant="destructive" 
                      className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
                      data-testid="badge-unread-count"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-96" data-testid="notifications-panel">
                <div className="flex items-center justify-between p-2">
                  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                  {unreadNotifications.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleMarkAllAsRead}
                      data-testid="button-mark-all-read"
                    >
                      <CheckCheck className="w-4 h-4 mr-1" />
                      Mark all read
                    </Button>
                  )}
                </div>
                <DropdownMenuSeparator />
                <ScrollArea className="h-96">
                  {notifications.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No notifications
                    </div>
                  ) : (
                    notifications.map((notification) => {
                      // Task #2022 — render the same Snooze 1h/4h/24h
                      // controls inline in the bell so admins can dismiss
                      // recurring `pool_health`/job-metric pages without
                      // first deep-linking into the Job Metrics dashboard.
                      if (notification.relatedEntityType === "job_metric_alert") {
                        return (
                          <JobMetricAlertBellItem
                            key={notification.id}
                            notification={notification}
                            onDismiss={() => {
                              if (!notification.isRead) {
                                markAsRead.mutate(notification.id);
                              }
                            }}
                            onNavigate={() => setNotificationsOpen(false)}
                            isDismissing={markAsRead.isPending}
                          />
                        );
                      }
                      const destination = getNotificationDestination(notification);
                      const hasDestination = destination !== null;

                      const notificationContent = (
                        <div className="flex items-start justify-between w-full gap-2">
                          <div className="flex-1">
                            <p className="font-medium text-sm">{notification.title}</p>
                            <p className="text-xs text-muted-foreground mt-1">{notification.message}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(notification.createdAt), "MMM d, h:mm a")}
                            </p>
                          </div>
                          {!notification.isRead && (
                            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                          )}
                        </div>
                      );

                      if (hasDestination && destination) {
                        return (
                          <DropdownMenuItem
                            key={notification.id}
                            asChild
                            className={`flex flex-col items-start p-3 cursor-pointer ${!notification.isRead ? "bg-accent/50" : ""}`}
                            data-testid={`notification-${notification.id}`}
                          >
                            <Link
                              href={destination}
                              onClick={() => {
                                if (!notification.isRead) {
                                  markAsRead.mutate(notification.id);
                                }
                                setNotificationsOpen(false);
                              }}
                            >
                              {notificationContent}
                            </Link>
                          </DropdownMenuItem>
                        );
                      }

                      return (
                        <DropdownMenuItem
                          key={notification.id}
                          className={`flex flex-col items-start p-3 cursor-pointer ${!notification.isRead ? "bg-accent/50" : ""}`}
                          onSelect={() => {
                            if (!notification.isRead) {
                              markAsRead.mutate(notification.id);
                            }
                          }}
                          data-testid={`notification-${notification.id}`}
                        >
                          {notificationContent}
                        </DropdownMenuItem>
                      );
                    })
                  )}
                </ScrollArea>
                <DropdownMenuSeparator />
                <Link
                  href="/notifications"
                  onClick={() => setNotificationsOpen(false)}
                  data-testid="link-view-all-notifications"
                >
                  <div className="px-3 py-2 text-center text-sm font-medium text-primary hover:underline">
                    View all notifications
                  </div>
                </Link>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <ThemeToggle />

          {isSuperAdmin(userRole) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="hidden md:flex items-center gap-2"
              data-testid="button-super-admin-logout"
            >
              <LogOut className="h-4 w-4" />
              Log Out
            </Button>
          )}
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2" data-testid="button-user-menu">
                <Avatar className="w-8 h-8">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={userName} />}
                  <ColoredAvatarFallback className="text-xs" name={userName} />
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium">{userName}</p>
                  <p className="text-xs text-muted-foreground">{getRoleDisplayName(userRole, false, user?.roleLabel)}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <Link href="/settings">
                <DropdownMenuItem data-testid="menu-settings">
                  <User className="mr-2 h-4 w-4" />
                  Profile & Settings
                </DropdownMenuItem>
              </Link>
              <DropdownMenuItem onClick={handleToggleAskAi} data-testid="menu-toggle-ai">
                <Bot className="mr-2 h-4 w-4" />
                {isAskAiEnabled ? "Hide Ask AI" : "Show Ask AI"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
