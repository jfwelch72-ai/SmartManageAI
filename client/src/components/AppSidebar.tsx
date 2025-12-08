import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadMessageCount } from "@/hooks/use-data";
import { NavigationConfig, PlatformAdminNavConfig, VendorPortalNavConfig, hasManagementAccess, isSuperAdmin, isVendor } from "@/lib/rbac";
import { apiRequest } from "@/lib/queryClient";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  LayoutDashboard, 
  Briefcase, 
  Calendar, 
  MessageSquare, 
  MessageCircle, 
  Mail,
  Gavel, 
  Users as UsersIcon, 
  Clock, 
  Bot, 
  DollarSign, 
  Settings, 
  Shield, 
  Truck, 
  Wrench, 
  Package, 
  Store,
  ChevronDown,
  LogOut,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

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
  const { state } = useSidebar();
  const queryClient = useQueryClient();
  
  const [timeClockOpen, setTimeClockOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);

  const { data: walkthroughStatus } = useQuery<WalkthroughStatus>({
    queryKey: ["/api/ai/walkthrough/status"],
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const resetAndStartWalkthroughMutation = useMutation({
    mutationFn: async () => {
      // First reset the walkthrough, then start it to ensure step goes to 1
      await apiRequest("POST", "/api/ai/walkthrough/reset");
      const response = await apiRequest("POST", "/api/ai/walkthrough/start");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/walkthrough/status"] });
      sessionStorage.removeItem("smartmanage-welcome-dismissed");
      // Dispatch event to open the AI assistant widget
      window.dispatchEvent(new CustomEvent("open-ai-assistant"));
    },
    onError: () => {
      // Silent fail - button re-enables automatically since mutation completes
      // User can try again by clicking the button
    },
  });

  const showTutorialButton = walkthroughStatus?.walkthroughCompleted || 
    (walkthroughStatus?.walkthroughStep === 0 && !walkthroughStatus?.walkthroughCompleted);
  const isInWalkthrough = walkthroughStatus && !walkthroughStatus.walkthroughCompleted && walkthroughStatus.walkthroughStep > 0;

  if (!user) return null;

  const userRole = user.role;
  const displayName = organizationName || "SmartManageAI";
  const unreadMessageCount = messageCountData.unreadCount || 0;

  const isActive = (path: string) => location === path || location.startsWith(path + "/");

  const initials = user.firstName && user.lastName
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : user.email?.substring(0, 2).toUpperCase() || "U";

  const visibleTimeClockItems = NavigationConfig.timeClockMenu.filter(item => item.visible(userRole));
  const visibleAIItems = NavigationConfig.aiMenu.filter(item => item.visible(userRole));
  const visibleAdminItems = NavigationConfig.adminMenu.filter(item => item.visible(userRole));
  const visibleToolsItems = NavigationConfig.toolsMenu.filter(item => item.visible(userRole));
  const hasAdminMenu = visibleAdminItems.length > 0;
  const hasAIMenu = visibleAIItems.length > 0;
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
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/dashboard")} tooltip="Dashboard">
                  <Link href="/dashboard" data-testid="sidebar-dashboard">
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/projects")} tooltip="Projects">
                  <Link href="/projects" data-testid="sidebar-projects">
                    <Briefcase className="w-4 h-4" />
                    <span>Projects</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/calendar")} tooltip="Calendar">
                  <Link href="/calendar" data-testid="sidebar-calendar">
                    <Calendar className="w-4 h-4" />
                    <span>Calendar</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/communications")} tooltip="Communications">
                  <Link href="/communications" data-testid="sidebar-communications">
                    <MessageSquare className="w-4 h-4" />
                    <span>Communications</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/messages")} tooltip="Messages">
                  <Link href="/messages" data-testid="sidebar-messages">
                    <MessageCircle className="w-4 h-4" />
                    <span>Messages</span>
                  </Link>
                </SidebarMenuButton>
                {unreadMessageCount > 0 && (
                  <SidebarMenuBadge>
                    <Badge variant="default" className="h-5 min-w-5 flex items-center justify-center p-0 text-xs">
                      {unreadMessageCount}
                    </Badge>
                  </SidebarMenuBadge>
                )}
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/email-assistant")} tooltip="Email Assistant">
                  <Link href="/email-assistant" data-testid="sidebar-email-assistant">
                    <Mail className="w-4 h-4" />
                    <span>Email Assistant</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/bids")} tooltip="Bids">
                  <Link href="/bids" data-testid="sidebar-bids">
                    <Gavel className="w-4 h-4" />
                    <span>Bids</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              
              {hasManagementAccess(userRole) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/crm")} tooltip="CRM">
                    <Link href="/crm" data-testid="sidebar-crm">
                      <UsersIcon className="w-4 h-4" />
                      <span>CRM</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              
              {(userRole === "ADMIN" || userRole === "MANAGER" || userRole === "SUPERINTENDENT") && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/equipment")} tooltip="Equipment">
                    <Link href="/equipment" data-testid="sidebar-equipment">
                      <Truck className="w-4 h-4" />
                      <span>Equipment</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        
        <SidebarSeparator />
        
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible open={timeClockOpen} onOpenChange={setTimeClockOpen} className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Time Clock">
                      <Clock className="w-4 h-4" />
                      <span>Time Clock</span>
                      <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={isActive("/time-clock")}>
                          <Link href="/time-clock" data-testid="sidebar-my-time-clock">
                            My Time Clock
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      {visibleTimeClockItems.slice(1).map((item) => (
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
              
              {hasAIMenu && (
                <Collapsible open={aiMenuOpen} onOpenChange={setAiMenuOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="AI Tools">
                        <Bot className="w-4 h-4" />
                        <span>AI</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAIItems.map((item) => (
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
              )}
              
              {hasAdminMenu && (
                <Collapsible open={adminMenuOpen} onOpenChange={setAdminMenuOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Admin">
                        <Shield className="w-4 h-4" />
                        <span>Admin</span>
                        <ChevronDown className="ml-auto w-4 h-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAdminItems.map((item) => (
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
              )}
              
              {hasToolsMenu && (
                <Collapsible open={toolsMenuOpen} onOpenChange={setToolsMenuOpen} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip="Tools">
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
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="border-t">
        <SidebarMenu>
          {showTutorialButton && (
            <SidebarMenuItem>
              <SidebarMenuButton 
                onClick={() => resetAndStartWalkthroughMutation.mutate()}
                disabled={resetAndStartWalkthroughMutation.isPending}
                className="text-primary hover:text-primary"
                tooltip="Start Tutorial"
                data-testid="sidebar-start-tutorial"
              >
                <GraduationCap className="w-4 h-4" />
                <span>Start Tutorial</span>
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
              <div className="px-2 py-1.5 group-data-[collapsible=icon]:hidden">
                <div className="flex items-center gap-2 text-xs text-primary">
                  <Sparkles className="w-3 h-3" />
                  <span>Tutorial: Step {walkthroughStatus.walkthroughStep}/{walkthroughStatus.totalSteps}</span>
                </div>
              </div>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center">
              <Avatar className="w-8 h-8">
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
