import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadMessageCount } from "@/hooks/use-data";
import { NavigationConfig, PlatformAdminNavConfig, VendorPortalNavConfig, hasManagementAccess, isSuperAdmin, isVendor, isHustler, canAccessBids, canAccessBidNetworkAsGC, canAccessBidNetworkAsSub, hasEquipmentAccess } from "@/lib/rbac";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
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
  Gavel, 
  Clock, 
  Bot, 
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
} from "lucide-react";
import { useState } from "react";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";

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
  const { data: portalChatUnreadData } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/team/chat/unread"],
    refetchInterval: 10000,
  });
  const { state } = useSidebar();
  const tour = useTour();
  
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [timeClockOpen, setTimeClockOpen] = useState(false);
  const [preconstructionOpen, setPreconstructionOpen] = useState(false);
  const [financialsOpen, setFinancialsOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [administrationOpen, setAdministrationOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);

  const { data: walkthroughStatus } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user,
    refetchOnWindowFocus: false,
  });
  
  const { entitlements } = useEntitlements();

  const showTutorialButton = walkthroughStatus?.walkthroughCompleted || 
    (walkthroughStatus?.walkthroughStep === 0 && !walkthroughStatus?.walkthroughCompleted);
  const isInWalkthrough = tour.isTourActive;
  const showUpgradeButton = entitlements?.planTier === "free";

  if (!user) return null;

  const userRole = user.effectiveRole || user.role;
  const isHustlerUser = user.role === "HUSTLER";
  const displayName = organizationName || "SmartManageAI";
  const unreadMessageCount = (messageCountData.unreadCount || 0) + (portalChatUnreadData?.unreadCount || 0);

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : user.email?.substring(0, 2).toUpperCase() || "U";

  const visibleProjectsItems = NavigationConfig.projectsMenu.filter(item => item.visible(userRole));
  const visibleTimeClockItems = NavigationConfig.timeClockMenu.filter(item => item.visible(userRole));
  const visibleOperationsItems = NavigationConfig.operationsMenu.filter(item => item.visible(userRole));
  const visiblePreconstructionItems = NavigationConfig.preconstructionMenu.filter(item => item.visible(userRole));
  const visibleFinancialsItems = NavigationConfig.financialsMenu.filter(item => item.visible(userRole));
  const visibleInsightsItems = NavigationConfig.insightsMenu.filter(item => item.visible(userRole));
  const visibleAdministrationItems = NavigationConfig.administrationMenu.filter(item => item.visible(userRole));
  const visibleToolsItems = NavigationConfig.toolsMenu.filter(item => item.visible(userRole));

  const hasProjectsMenu = visibleProjectsItems.length > 0;
  const hasOperationsMenu = visibleOperationsItems.length > 0 || visibleTimeClockItems.length > 0;
  const hasPreconstructionMenu = visiblePreconstructionItems.length > 0;
  const hasFinancialsMenu = visibleFinancialsItems.length > 0;
  const hasInsightsMenu = visibleInsightsItems.length > 0;
  const hasAdministrationMenu = visibleAdministrationItems.length > 0;
  const hasToolsMenu = visibleToolsItems.length > 0;

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
                        {item.href === "/admin/analytics" && <Briefcase className="w-4 h-4" />}
                        {item.href === "/admin/support" && <Shield className="w-4 h-4" />}
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
            <SidebarGroupLabel>Portal</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {VendorPortalNavConfig.mainNav.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)} tooltip={item.label}>
                      <Link href={item.href} data-testid={item.testId}>
                        {item.href === "/vendor" && <LayoutDashboard className="w-4 h-4" />}
                        {item.href === "/vendor/pricing" && <Package className="w-4 h-4" />}
                        {item.href === "/vendor/clients" && <Store className="w-4 h-4" />}
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
        {/* 1. Top-level: Dashboard, Bulletins */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {isHustlerUser && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/hustler")} tooltip="Portfolio">
                    <Link href="/hustler" data-testid="sidebar-portfolio">
                      <Zap className="w-4 h-4" />
                      <span>Portfolio</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/dashboard")} tooltip="Dashboard">
                  <Link href="/dashboard" data-testid="sidebar-dashboard">
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/communications")} tooltip="Bulletins">
                  <Link href="/communications" data-testid="sidebar-bulletins">
                    <MessageSquare className="w-4 h-4" />
                    <span>Bulletins</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarSeparator />

        {/* 2. Projects group */}
        {hasProjectsMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Projects" data-testid="sidebar-projects-group">
                        <Briefcase className="w-4 h-4" />
                        <span>Projects</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleProjectsItems.map((item) => {
                          const isMessages = item.href === "/messages";
                          return (
                            <SidebarMenuSubItem key={item.href}>
                              <SidebarMenuSubButton asChild isActive={isActive(item.href) || (isMessages && isActive("/portal-chat"))}>
                                <Link href={item.href} data-testid={item.testId}>
                                  {item.label}
                                </Link>
                              </SidebarMenuSubButton>
                              {isMessages && unreadMessageCount > 0 && (
                                <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center p-0 text-xs ml-auto">
                                  {unreadMessageCount}
                                </Badge>
                              )}
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
        )}
        
        {/* 3. Operations group (includes nested Time Clock) */}
        {hasOperationsMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={operationsOpen} onOpenChange={setOperationsOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Operations" data-testid="sidebar-operations-group">
                        <HardHat className="w-4 h-4" />
                        <span>Operations</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleTimeClockItems.length > 0 && (
                          <Collapsible open={timeClockOpen} onOpenChange={setTimeClockOpen} className="group/timeclock">
                            <SidebarMenuSubItem>
                              <CollapsibleTrigger asChild>
                                <SidebarMenuSubButton data-testid="sidebar-time-clock-group" className="cursor-pointer">
                                  <span>Time Clock</span>
                                  <ChevronDown className="ml-auto w-3 h-3 transition-transform group-data-[state=open]/timeclock:rotate-180" />
                                </SidebarMenuSubButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <SidebarMenuSub>
                                  {visibleTimeClockItems.map((item) => (
                                    <SidebarMenuSubItem key={item.href}>
                                      <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                                        <Link href={item.href} data-testid={item.testId}>
                                          {item.label}
                                        </Link>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  ))}
                                </SidebarMenuSub>
                              </CollapsibleContent>
                            </SidebarMenuSubItem>
                          </Collapsible>
                        )}
                        
                        {visibleOperationsItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* 4. Preconstruction group */}
        {hasPreconstructionMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={preconstructionOpen} onOpenChange={setPreconstructionOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Preconstruction" data-testid="sidebar-preconstruction-group">
                        <Gavel className="w-4 h-4" />
                        <span>Preconstruction</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visiblePreconstructionItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {/* 5. Financials group */}
        {hasFinancialsMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={financialsOpen} onOpenChange={setFinancialsOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Financials" data-testid="sidebar-financials-group">
                        <DollarSign className="w-4 h-4" />
                        <span>Financials</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleFinancialsItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {/* 6. Insights group */}
        {hasInsightsMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={insightsOpen} onOpenChange={setInsightsOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Insights" data-testid="sidebar-insights-group">
                        <Bot className="w-4 h-4" />
                        <span>Insights</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleInsightsItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {/* 7. Administration group */}
        {hasAdministrationMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={administrationOpen} onOpenChange={setAdministrationOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Administration" data-testid="sidebar-admin-group">
                        <Shield className="w-4 h-4" />
                        <span>Administration</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAdministrationItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        
        {/* 8. Tools group */}
        {hasToolsMenu && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <Collapsible open={toolsMenuOpen} onOpenChange={setToolsMenuOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Tools" data-testid="sidebar-tools-group">
                        <Wrench className="w-4 h-4" />
                        <span>Tools</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleToolsItems.map((item) => (
                          <SidebarMenuSubItem key={item.href}>
                            <SidebarMenuSubButton asChild isActive={isActive(item.href)}>
                              <Link href={item.href} data-testid={item.testId}>
                                {item.label}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
