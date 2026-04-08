import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadMessageCount } from "@/hooks/use-data";
import { useVisibleRefetchInterval } from "@/hooks/use-page-visible";
import { PlatformAdminNavConfig, VendorPortalNavConfig, isSuperAdmin, isVendor, isFieldWorker, type FeaturePerms, type SidebarSection, getWorkflowGroups, getVisibleGroupItems, NavItems } from "@/lib/rbac";
import { useDashboardCustomizationSafe } from "@/hooks/use-dashboard-customization";
import { useTour } from "@/components/TourProvider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  LayoutDashboard, 
  Briefcase, 
  MessageSquare, 
  Clock, 
  DollarSign, 
  Shield, 
  Wrench, 
  Store,
  Package,
  ChevronDown,
  LogOut,
  GraduationCap,
  Sparkles,
  Zap,
  HardHat,
  FileSearch,
  Users,
  Crown,
  BarChart3,
  Megaphone,
  Inbox,
  Home,
  TrendingUp,
  CalendarDays,
  ClipboardCheck,
  BookOpen,
  FileText,
  Info,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";

import { Skeleton } from "@/components/ui/skeleton";

const GROUP_ICONS: Record<SidebarSection, LucideIcon> = {
  portfolio: Zap,
  home: Home,
  sales: TrendingUp,
  projects: Briefcase,
  team: Users,
  time: Clock,
  finance: DollarSign,
  field_ops: HardHat,
  settings: Shield,
  marketing: Megaphone,
  tools: Wrench,
  today: CalendarDays,
  crew: Users,
  jobsite: HardHat,
  review: ClipboardCheck,
  reference: BookOpen,
  bids: FileText,
  costs: DollarSign,
  reports: BarChart3,
  info: Info,
};

function SidebarSkeleton() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="w-6 h-6 rounded shrink-0" />
          <Skeleton className="h-5 w-32 group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="flex flex-col gap-1 px-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="flex flex-col gap-1 px-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-3/4 rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-5/6 rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="flex flex-col gap-1 px-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-2/3 rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupContent>
            <div className="flex flex-col gap-1 px-2">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-3/4 rounded-md" />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t">
        <div className="flex items-center gap-2 px-2 py-2">
          <Skeleton className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

interface WalkthroughStatus {
  walkthroughCompleted: boolean;
  walkthroughStep: number;
  totalSteps: number;
  role: string;
  walkthrough: {
    roleName: string;
    welcomeMessage: string;
    completionMessage: string;
  } | null;
}

export function AppSidebar() {
  const { user, logout, organizationName } = useAuth();
  const [location] = useLocation();
  const { data: messageCountData = { unreadCount: 0 } } = useUnreadMessageCount();
  const chatRefetchInterval = useVisibleRefetchInterval(30000);
  const { data: portalChatUnreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/team/chat/unread"],
    refetchInterval: chatRefetchInterval,
  });
  const tour = useTour();
  
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const userRole = user?.effectiveRole || user?.role;
  
  useEffect(() => {
    if (!tour.isTourActive || !tour.currentTourTarget || !userRole) return;
    
    const match = tour.currentTourTarget.match(/data-testid="([^"]+)"/);
    if (!match) return;
    const targetTestId = match[1];
    
    const targetNavItem = Object.values(NavItems).find(item => item.testId === targetTestId);
    if (!targetNavItem) return;
    
    const groups = getWorkflowGroups(userRole);
    const targetGroup = groups.find(group => group.itemHrefs.includes(targetNavItem.href));
    if (targetGroup && targetGroup.key !== 'portfolio') {
      setOpenGroups(prev => {
        if (prev[targetGroup.key]) return prev;
        return { ...prev, [targetGroup.key]: true };
      });
    }
  }, [tour.isTourActive, tour.currentTourTarget, userRole]);

  useEffect(() => {
    if (!tour.isTourActive || !userRole) return;
    const groups = getWorkflowGroups(userRole);
    const expandAll: Record<string, boolean> = {};
    groups.forEach(g => {
      if (g.key !== 'portfolio') expandAll[g.key] = true;
    });
    setOpenGroups(prev => ({ ...prev, ...expandAll }));
  }, [tour.isTourActive, userRole]);

  const { data: walkthroughStatus } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  
  const { entitlements } = useEntitlements();
  const { permissions: featurePerms, isLoadingPermissions } = useDashboardCustomizationSafe();

  const showTutorialButton = !!walkthroughStatus;
  const isInWalkthrough = tour.isTourActive;
  const showUpgradeButton = entitlements?.planTier === "free" && user?.role !== "SUPER_ADMIN";

  if (!user) return null;

  const displayName = organizationName || "SmartManageAI";
  const unreadMessageCount = (messageCountData.unreadCount || 0) + (portalChatUnreadData?.unreadCount || 0);

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : user.email?.substring(0, 2).toUpperCase() || "U";

  const handleLogout = async () => {
    await logout();
  };

  if (isSuperAdmin(userRole)) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b">
          <div className="flex items-center gap-2 px-2 py-2">
            <Building2 className="w-6 h-6 text-primary shrink-0" />
            <span className="font-bold text-lg group-data-[collapsible=icon]:hidden">Admin</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PlatformAdminNavConfig.mainNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                      <Link href={item.href} data-testid={item.testId}>
                        {item.href === "/admin" && <LayoutDashboard className="w-4 h-4" />}
                        {item.href === "/admin/organizations" && <Building2 className="w-4 h-4" />}
                        {item.href === "/admin/analytics" && <BarChart3 className="w-4 h-4" />}
                        {item.href === "/admin/tools" && <Wrench className="w-4 h-4" />}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive" data-testid="sidebar-logout">
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  if (isVendor(userRole)) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b">
          <div className="flex items-center gap-2 px-2 py-2">
            <Store className="w-6 h-6 text-primary shrink-0" />
            <span className="font-bold text-lg group-data-[collapsible=icon]:hidden">Vendor</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {VendorPortalNavConfig.mainNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                      <Link href={item.href} data-testid={item.testId}>
                        {item.href === "/dashboard" && <LayoutDashboard className="w-4 h-4" />}
                        {item.href === "/vendor/analytics" && <BarChart3 className="w-4 h-4" />}
                        {item.href === "/vendor/pricing" && <Package className="w-4 h-4" />}
                        {item.href === "/vendor/clients" && <Store className="w-4 h-4" />}
                        {item.href === "/vendor/messages" && <MessageSquare className="w-4 h-4" />}
                        {item.href === "/vendor/documents" && <FileSearch className="w-4 h-4" />}
                        {item.href === "/bid-inbox" && <Inbox className="w-4 h-4" />}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive" data-testid="sidebar-logout">
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  if (isLoadingPermissions) {
    return <SidebarSkeleton />;
  }

  const perms: FeaturePerms | undefined = featurePerms;
  const workflowGroups = getWorkflowGroups(userRole);
  const isFieldWorkerUser = isFieldWorker(userRole);
  const isHustlerUser = userRole === "HUSTLER";

  if (isFieldWorkerUser) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b">
          <Link href="/dashboard" data-testid="sidebar-logo">
            <div className="flex items-center gap-2 px-2 py-2 cursor-pointer hover-elevate rounded-md">
              <Building2 className="w-6 h-6 text-primary shrink-0" />
              <div className="group-data-[collapsible=icon]:hidden">
                <span className="font-bold text-base line-clamp-1">{displayName}</span>
              </div>
            </div>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {workflowGroups.map((group) => {
            const visibleItems = getVisibleGroupItems(group, userRole, perms);
            if (visibleItems.length === 0) return null;
            const GroupIcon = GROUP_ICONS[group.key] || Wrench;
            return (
              <SidebarGroup key={group.key}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {visibleItems.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                          <Link href={item.href} data-testid={item.testId}>
                            <GroupIcon className="w-4 h-4" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </SidebarContent>
        <SidebarFooter className="border-t">
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center">
                <Avatar className="w-8 h-8">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={`${user.firstName} ${user.lastName}`} />}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
                  <p className="text-xs text-muted-foreground truncate">{userRole}</p>
                </div>
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive" data-testid="sidebar-logout">
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <Link href="/dashboard" data-testid="sidebar-logo">
          <div className="flex items-center gap-2 px-2 py-2 cursor-pointer hover-elevate rounded-md">
            <Building2 className="w-6 h-6 text-primary shrink-0" />
            <div className="group-data-[collapsible=icon]:hidden">
              <span className="font-bold text-base line-clamp-1">{displayName}</span>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      
      <SidebarContent>
        {workflowGroups.map((group) => {
          if (group.key === 'portfolio') {
            if (!isHustlerUser) return null;
            return (
              <SidebarGroup key={group.key}>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isActive("/hustler")} tooltip="Portfolio">
                        <Link href="/hustler" data-testid="sidebar-portfolio">
                          <Zap className="w-4 h-4" />
                          <span>Portfolio</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          const visibleItems = getVisibleGroupItems(group, userRole, perms);
          if (visibleItems.length === 0) return null;

          const GroupIcon = GROUP_ICONS[group.key] || Wrench;

          return (
            <SidebarGroup key={group.key}>
              <SidebarGroupContent>
                <SidebarMenu>
                  <Collapsible
                    open={openGroups[group.key] || false}
                    onOpenChange={(open) => setOpenGroups(prev => ({ ...prev, [group.key]: open }))}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={group.label} data-testid={`sidebar-${group.key}-group`}>
                          <GroupIcon className="w-4 h-4" />
                          <span>{group.label}</span>
                          <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {visibleItems.map((item) => {
                            const isMessages = item.href === "/messages";
                            return (
                              <SidebarMenuSubItem key={item.href}>
                                <SidebarMenuSubButton asChild isActive={isActive(item.href) || (isMessages && isActive("/portal-chat"))}>
                                  <Link href={item.href} data-testid={item.testId}>
                                    {item.label}
                                    {isMessages && unreadMessageCount > 0 && (
                                      <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center rounded-full px-1.5 py-0 text-xs ml-1.5" data-testid="badge-unread-messages">
                                        {unreadMessageCount}
                                      </Badge>
                                    )}
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      
      <SidebarFooter className="border-t">
        <SidebarMenu>
          {showUpgradeButton && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Upgrade Plan">
                <Link href="/billing" data-testid="sidebar-upgrade-plan">
                  <Crown className="w-4 h-4 text-yellow-500" />
                  <span className="text-yellow-600 dark:text-yellow-400">Upgrade Plan</span>
                  <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                    Pro
                  </Badge>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {showTutorialButton && !isInWalkthrough && (
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={() => tour.startTour()}
                className="text-primary hover:text-primary"
                tooltip="Start Tour"
                data-testid="sidebar-start-tutorial"
              >
                <GraduationCap className="w-4 h-4" />
                <span>Start Tour</span>
                {!walkthroughStatus?.walkthroughCompleted && walkthroughStatus?.walkthroughStep === 0 && (
                  <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
                    <Sparkles className="w-3 h-3 mr-0.5" />
                    New
                  </Badge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {isInWalkthrough && (
            <SidebarMenuItem>
              <SidebarMenuButton 
                className="text-primary hover:text-primary"
                tooltip="Tour in Progress"
                data-testid="sidebar-tour-progress"
              >
                <GraduationCap className="w-4 h-4" />
                <span>Tour Active</span>
                <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
                  Step {tour.currentStep + 1}
                </Badge>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center">
              <Avatar className="w-8 h-8">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={`${user.firstName} ${user.lastName}`} />}
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-muted-foreground truncate">{userRole}</p>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="text-destructive hover:text-destructive" data-testid="sidebar-logout">
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
