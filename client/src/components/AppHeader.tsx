import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Building2, LogOut, User, Bell, CheckCheck, Clock, ChevronDown, Briefcase, Calendar, Users as UsersIcon, LayoutDashboard, Bot, DollarSign, Settings, Shield, MessageSquare, Gavel } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useUnreadNotificationCount } from "@/hooks/use-data";
import { NavigationConfig, hasManagementAccess } from "@/lib/rbac";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";

interface AppHeaderProps {
  userName: string;
  userRole: string;
  onLogout: () => Promise<void>;
}

export default function AppHeader({ userName, userRole, onLogout }: AppHeaderProps) {
  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const { data: notificationsData = { count: 0 } } = useUnreadNotificationCount();
  const { data: notifications = [] } = useNotifications();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();

  const unreadCount = notificationsData.count || 0;
  const unreadNotifications = notifications.filter(n => !n.isRead);

  const handleMarkAsRead = (id: string) => {
    markAsRead.mutate(id);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate();
  };

  const handleLogout = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onLogout();
  };

  // Filter navigation items based on user role
  const visibleTimeClockItems = NavigationConfig.timeClockMenu.filter(item => item.visible(userRole));
  const visibleAIItems = NavigationConfig.aiMenu.filter(item => item.visible(userRole));
  const visibleAdminItems = NavigationConfig.adminMenu.filter(item => item.visible(userRole));
  const hasAdminMenu = visibleAdminItems.length > 0;
  const hasAIMenu = visibleAIItems.length > 0;

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-6 gap-6">
        <Link href="/dashboard" data-testid="link-dashboard">
          <div className="flex items-center gap-3 cursor-pointer hover-elevate active-elevate-2 rounded-md -ml-2 pl-2 pr-3 py-2">
            <Building2 className="w-8 h-8 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">TFR Construction</h1>
              <p className="text-xs text-muted-foreground">Management Platform</p>
            </div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-dashboard">
            <Link href="/dashboard">
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-projects">
            <Link href="/projects">
              <Briefcase className="w-4 h-4" />
              Projects
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-calendar">
            <Link href="/calendar">
              <Calendar className="w-4 h-4" />
              Calendar
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-communications">
            <Link href="/communications">
              <MessageSquare className="w-4 h-4" />
              Communications
            </Link>
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-bids">
            <Link href="/bids">
              <Gavel className="w-4 h-4" />
              Bids
            </Link>
          </Button>
          {hasManagementAccess(userRole) && (
            <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-crm">
              <Link href="/crm">
                <UsersIcon className="w-4 h-4" />
                CRM
              </Link>
            </Button>
          )}
          
          {/* Time Clock Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" data-testid="nav-time-clock">
                <Clock className="w-4 h-4" />
                Time Clock
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild data-testid="nav-my-time-clock">
                <Link href="/time-clock">
                  <Clock className="mr-2 h-4 w-4" />
                  My Time Clock
                </Link>
              </DropdownMenuItem>
              {NavigationConfig.timeClockMenu.slice(1).map((item) => 
                item.visible(userRole) && (
                  <DropdownMenuItem key={item.href} asChild data-testid={item.testId}>
                    <Link href={item.href}>{item.label}</Link>
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* AI Menu - Only show if user has access to at least one AI feature */}
          {hasAIMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" data-testid="nav-ai">
                  <Bot className="w-4 h-4" />
                  AI
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {visibleAIItems.map((item, index) => (
                  <div key={item.href}>
                    {index === visibleAIItems.length - 1 && visibleAIItems.length > 1 && <DropdownMenuSeparator />}
                    <DropdownMenuItem asChild data-testid={item.testId}>
                      <Link href={item.href}>
                        {item.href === "/ai-pm" && <Bot className="mr-2 h-4 w-4" />}
                        {item.href === "/cfo" && <DollarSign className="mr-2 h-4 w-4" />}
                        {item.href === "/ai-settings" && <Settings className="mr-2 h-4 w-4" />}
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Admin Menu - Only show if user has access to admin features */}
          {hasAdminMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" data-testid="nav-admin">
                  <Shield className="w-4 h-4" />
                  Admin
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {visibleAdminItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild data-testid={item.testId}>
                    <Link href={item.href}>
                      <UsersIcon className="mr-2 h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <DropdownMenu>
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
            <DropdownMenuContent align="end" className="w-96" data-testid="notifications-panel">
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
                  notifications.map((notification) => (
                    <DropdownMenuItem
                      key={notification.id}
                      className={`flex flex-col items-start p-3 cursor-pointer ${!notification.isRead ? "bg-accent/50" : ""}`}
                      onClick={() => !notification.isRead && handleMarkAsRead(notification.id)}
                      data-testid={`notification-${notification.id}`}
                    >
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
                    </DropdownMenuItem>
                  ))
                )}
              </ScrollArea>
            </DropdownMenuContent>
          </DropdownMenu>

          <ThemeToggle />
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2" data-testid="button-user-menu">
                <Avatar className="w-8 h-8">
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium">{userName}</p>
                  <p className="text-xs text-muted-foreground">{userRole}</p>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="menu-profile">
                <User className="mr-2 h-4 w-4" />
                Profile
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
