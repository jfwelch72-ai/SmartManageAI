import { useState, useMemo } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Building2, LogOut, User, Bell, CheckCheck, Clock, ChevronDown, ChevronRight, Briefcase, Calendar, Users as UsersIcon, LayoutDashboard, Bot, DollarSign, Settings, Shield, MessageSquare, Gavel, Menu, X, MessageCircle, Truck, Cloud, ClipboardCheck, FileCheck, Package, HardHat, Wrench } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, useUnreadNotificationCount, useUnreadMessageCount, useTradeFeatures, type TradeFeature } from "@/hooks/use-data";
import { NavigationConfig, PlatformAdminNavConfig, hasManagementAccess, isSuperAdmin, hasContractorAccess } from "@/lib/rbac";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link, useLocation } from "wouter";

const getFeatureIcon = (iconName: string | null) => {
  switch (iconName) {
    case "Cloud": return Cloud;
    case "Truck": return Truck;
    case "ClipboardCheck": return ClipboardCheck;
    case "FileCheck": return FileCheck;
    case "Package": return Package;
    case "Shield": return Shield;
    case "HardHat": return HardHat;
    case "Users": return UsersIcon;
    case "Wrench": return Wrench;
    default: return Wrench;
  }
};

interface AppHeaderProps {
  userName: string;
  userRole: string;
  onLogout: () => Promise<void>;
  organizationName?: string;
}

export default function AppHeader({ userName, userRole, onLogout, organizationName }: AppHeaderProps) {
  const displayName = organizationName || "SmartManageAI";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [timeClockOpen, setTimeClockOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [location] = useLocation();

  const { data: tradeFeatureData } = useTradeFeatures();
  
  const tradeNavFeatures = useMemo(() => {
    if (!tradeFeatureData?.features) return [];
    return tradeFeatureData.features.filter(f => f.navPath && f.navSection);
  }, [tradeFeatureData?.features]);

  const groupedFeatures = useMemo(() => {
    const groups: Record<string, TradeFeature[]> = {};
    for (const feature of tradeNavFeatures) {
      const section = feature.navSection || "tools";
      if (!groups[section]) groups[section] = [];
      groups[section].push(feature);
    }
    return groups;
  }, [tradeNavFeatures]);

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const { data: notificationsData = { count: 0 } } = useUnreadNotificationCount();
  const { data: notifications = [] } = useNotifications();
  const markAsRead = useMarkNotificationRead();
  const markAllAsRead = useMarkAllNotificationsRead();
  const { data: messageCountData = { unreadCount: 0 } } = useUnreadMessageCount();

  const unreadCount = notificationsData.count || 0;
  const unreadMessageCount = messageCountData.unreadCount || 0;
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

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    setTimeClockOpen(false);
    setAiMenuOpen(false);
    setAdminMenuOpen(false);
    setToolsMenuOpen(false);
  };

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  // Filter navigation items based on user role
  const visibleTimeClockItems = NavigationConfig.timeClockMenu.filter(item => item.visible(userRole));
  const visibleAIItems = NavigationConfig.aiMenu.filter(item => item.visible(userRole));
  const visibleAdminItems = NavigationConfig.adminMenu.filter(item => item.visible(userRole));
  const hasAdminMenu = visibleAdminItems.length > 0;
  const hasAIMenu = visibleAIItems.length > 0;

  // Mobile navigation items for contractors
  const mobileNavItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/projects", icon: Briefcase, label: "Projects" },
    { href: "/calendar", icon: Calendar, label: "Calendar" },
    { href: "/communications", icon: MessageSquare, label: "Communications" },
    { href: "/messages", icon: MessageCircle, label: "Messages", badge: unreadMessageCount },
    { href: "/bids", icon: Gavel, label: "Bids" },
  ];

  // Mobile navigation items for platform admins
  const platformAdminMobileNavItems = [
    { href: "/admin", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/admin/organizations", icon: Building2, label: "Organizations" },
    { href: "/admin/analytics", icon: Briefcase, label: "Analytics" },
    { href: "/admin/support", icon: Shield, label: "Support Tools" },
  ];

  // Mobile navigation link component
  const MobileNavLink = ({ href, icon: Icon, label, badge }: { href: string; icon: any; label: string; badge?: number }) => (
    <Link href={href} onClick={closeMobileMenu}>
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
          isActive(href)
            ? "bg-primary/10 text-primary font-medium"
            : "hover:bg-accent text-foreground"
        }`}
        data-testid={`mobile-nav-${label.toLowerCase()}`}
      >
        <Icon className="w-5 h-5" />
        <span className="flex-1">{label}</span>
        {badge !== undefined && badge > 0 && (
          <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center p-0 text-xs">
            {badge}
          </Badge>
        )}
      </div>
    </Link>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 md:h-16 items-center justify-between px-4 md:px-6 gap-2 md:gap-6">
        {/* Mobile hamburger menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              data-testid="button-mobile-menu"
            >
              <Menu className="h-6 w-6" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="w-6 h-6 text-primary" />
                <span>{isSuperAdmin(userRole) ? "SmartManageAI Admin" : displayName}</span>
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-80px)]">
              <nav className="flex flex-col gap-1 p-4">
                {/* Platform admin mobile navigation */}
                {isSuperAdmin(userRole) ? (
                  <>
                    {platformAdminMobileNavItems.map((item) => (
                      <MobileNavLink key={item.href} {...item} />
                    ))}
                  </>
                ) : (
                  <>
                    {/* Main nav items */}
                    {mobileNavItems.map((item) => (
                      <MobileNavLink key={item.href} {...item} />
                    ))}

                    {/* CRM - conditional */}
                    {hasManagementAccess(userRole) && (
                      <MobileNavLink href="/crm" icon={UsersIcon} label="CRM" />
                    )}

                    {/* Equipment - conditional */}
                    {(userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT") && (
                      <MobileNavLink href="/equipment" icon={Truck} label="Equipment" />
                    )}

                    {/* Time Clock - collapsible */}
                    <Collapsible open={timeClockOpen} onOpenChange={setTimeClockOpen}>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-accent cursor-pointer">
                          <div className="flex items-center gap-3">
                            <Clock className="w-5 h-5" />
                            <span>Time Clock</span>
                          </div>
                          <ChevronRight className={`w-4 h-4 transition-transform ${timeClockOpen ? "rotate-90" : ""}`} />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pl-8 space-y-1">
                        <Link href="/time-clock" onClick={closeMobileMenu}>
                          <div className={`px-4 py-2 rounded-lg ${isActive("/time-clock") ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                            My Time Clock
                          </div>
                        </Link>
                        {NavigationConfig.timeClockMenu.slice(1).map((item) =>
                          item.visible(userRole) && (
                            <Link key={item.href} href={item.href} onClick={closeMobileMenu}>
                              <div className={`px-4 py-2 rounded-lg ${isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                                {item.label}
                              </div>
                            </Link>
                          )
                        )}
                      </CollapsibleContent>
                    </Collapsible>

                    {/* AI Menu - collapsible */}
                    {hasAIMenu && (
                      <Collapsible open={aiMenuOpen} onOpenChange={setAiMenuOpen}>
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-accent cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Bot className="w-5 h-5" />
                              <span>AI</span>
                            </div>
                            <ChevronRight className={`w-4 h-4 transition-transform ${aiMenuOpen ? "rotate-90" : ""}`} />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pl-8 space-y-1">
                          {visibleAIItems.map((item) => (
                            <Link key={item.href} href={item.href} onClick={closeMobileMenu}>
                              <div className={`px-4 py-2 rounded-lg ${isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                                {item.label}
                              </div>
                            </Link>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Trade-Specific Tools Menu - collapsible */}
                    {tradeNavFeatures.length > 0 && hasManagementAccess(userRole) && (
                      <Collapsible open={toolsMenuOpen} onOpenChange={setToolsMenuOpen}>
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-accent cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Wrench className="w-5 h-5" />
                              <span>Trade Tools</span>
                            </div>
                            <ChevronRight className={`w-4 h-4 transition-transform ${toolsMenuOpen ? "rotate-90" : ""}`} />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pl-8 space-y-1">
                          {tradeNavFeatures.map((feature) => {
                            const FeatureIcon = getFeatureIcon(feature.navIcon);
                            return (
                              <Link key={feature.id} href={feature.navPath || "#"} onClick={closeMobileMenu}>
                                <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isActive(feature.navPath || "") ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                                  <FeatureIcon className="w-4 h-4" />
                                  {feature.featureName}
                                </div>
                              </Link>
                            );
                          })}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {/* Admin Menu - collapsible */}
                    {hasAdminMenu && (
                      <Collapsible open={adminMenuOpen} onOpenChange={setAdminMenuOpen}>
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-accent cursor-pointer">
                            <div className="flex items-center gap-3">
                              <Shield className="w-5 h-5" />
                              <span>Admin</span>
                            </div>
                            <ChevronRight className={`w-4 h-4 transition-transform ${adminMenuOpen ? "rotate-90" : ""}`} />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pl-8 space-y-1">
                          {visibleAdminItems.map((item) => (
                            <Link key={item.href} href={item.href} onClick={closeMobileMenu}>
                              <div className={`px-4 py-2 rounded-lg ${isActive(item.href) ? "bg-primary/10 text-primary" : "hover:bg-accent"}`}>
                                {item.label}
                              </div>
                            </Link>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </>
                )}

                {/* User section at bottom */}
                <div className="border-t mt-4 pt-4">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Avatar className="w-10 h-10">
                      <AvatarFallback>{initials}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{userName}</p>
                      <p className="text-sm text-muted-foreground">{userRole}</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-3 px-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      closeMobileMenu();
                      handleLogout(e);
                    }}
                    data-testid="mobile-logout"
                  >
                    <LogOut className="w-5 h-5" />
                    Logout
                  </Button>
                </div>
              </nav>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Logo - simplified on mobile */}
        <Link href={isSuperAdmin(userRole) ? "/admin" : "/dashboard"} data-testid="link-dashboard">
          <div className="flex items-center gap-2 md:gap-3 cursor-pointer hover-elevate active-elevate-2 rounded-md pl-1 md:pl-2 pr-2 md:pr-3 py-2">
            <Building2 className="w-7 h-7 md:w-8 md:h-8 text-primary" />
            <div className="hidden sm:block">
              <h1 className="text-lg md:text-xl font-bold text-foreground">
                {isSuperAdmin(userRole) ? "SmartManageAI Admin" : displayName}
              </h1>
              <p className="text-xs text-muted-foreground hidden md:block">
                {isSuperAdmin(userRole) ? "Platform Administration" : "Construction Management"}
              </p>
            </div>
          </div>
        </Link>

        {/* Desktop Navigation - hidden on mobile */}
        <nav className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto">
          {/* Platform Admin Navigation - SUPER_ADMIN only */}
          {isSuperAdmin(userRole) ? (
            <>
              {PlatformAdminNavConfig.mainNav.map((item) => (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  className="gap-2 whitespace-nowrap"
                  asChild
                  data-testid={item.testId}
                >
                  <Link href={item.href}>
                    {item.href === "/admin" && <LayoutDashboard className="w-4 h-4" />}
                    {item.href === "/admin/organizations" && <Building2 className="w-4 h-4" />}
                    {item.href === "/admin/analytics" && <Briefcase className="w-4 h-4" />}
                    {item.href === "/admin/support" && <Shield className="w-4 h-4" />}
                    {item.label}
                  </Link>
                </Button>
              ))}
            </>
          ) : (
            <>
              {/* Regular contractor navigation */}
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
              {(userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT") && (
                <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" asChild data-testid="nav-equipment">
                  <Link href="/equipment">
                    <Truck className="w-4 h-4" />
                    Equipment
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

              {/* Trade-Specific Tools Menu */}
              {tradeNavFeatures.length > 0 && hasManagementAccess(userRole) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-2 whitespace-nowrap" data-testid="nav-trade-tools">
                      <Wrench className="w-4 h-4" />
                      Trade Tools
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {Object.entries(groupedFeatures).map(([section, features]) => (
                      <div key={section}>
                        {Object.keys(groupedFeatures).length > 1 && (
                          <DropdownMenuLabel className="text-xs text-muted-foreground capitalize">
                            {section}
                          </DropdownMenuLabel>
                        )}
                        {features.map((feature) => {
                          const FeatureIcon = getFeatureIcon(feature.navIcon);
                          return (
                            <DropdownMenuItem key={feature.id} asChild data-testid={`nav-trade-${feature.featureKey}`}>
                              <Link href={feature.navPath || "#"}>
                                <FeatureIcon className="mr-2 h-4 w-4" />
                                {feature.featureName}
                              </Link>
                            </DropdownMenuItem>
                          );
                        })}
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
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* Messages Icon - only for contractor users */}
          {hasContractorAccess(userRole) && (
            <Button variant="ghost" size="icon" className="relative" asChild data-testid="button-messages">
              <Link href="/messages">
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
              </Link>
            </Button>
          )}

          {/* Notifications - only for contractor users */}
          {hasContractorAccess(userRole) && (
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
          )}

          <ThemeToggle />

          {/* Dedicated Logout button for SUPER_ADMIN - more visible */}
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
