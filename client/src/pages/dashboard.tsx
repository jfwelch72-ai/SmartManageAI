import { DashboardEditMode, EditModeIndicator } from "@/components/DashboardEditMode";
import { ThemePicker } from "@/components/ThemePicker";
import { DashboardGrid } from "@/components/DashboardGrid";
import { WidgetLibrary } from "@/components/WidgetLibrary";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { AIDashboardPanel } from "@/components/AIDashboardPanel";
import { AIFeatureTrigger } from "@/components/AIFeatureDialog";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { Plus, Sun, Moon, Sunset, ChevronDown, Sparkles, Brain, DollarSign, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AIFeatureDialog } from "@/components/AIFeatureDialog";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess, isSuperAdmin, isHustler } from "@/lib/rbac";
import { format } from "date-fns";
import { Redirect } from "wouter";
import { useState } from "react";
import { useDashboardStats, useBids } from "@/hooks/use-data";

function getTimeGreeting(): { greeting: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { greeting: "Good morning", icon: Sun };
  if (hour < 17) return { greeting: "Good afternoon", icon: Sun };
  if (hour < 21) return { greeting: "Good evening", icon: Sunset };
  return { greeting: "Good night", icon: Moon };
}

function useRoleSubtitle(role?: string): string {
  const { data: stats } = useDashboardStats();
  const { data: bids } = useBids();

  const projects = stats?.activeProjectsCount ?? 0;
  const activeBids = bids?.length ?? 0;
  const delays = stats?.activeDelaysCount ?? 0;

  switch (role) {
    case 'ADMIN':
    case 'SUPER_ADMIN': {
      const parts: string[] = [];
      if (projects > 0) parts.push(`${projects} active project${projects !== 1 ? 's' : ''}`);
      if (delays > 0) parts.push(`${delays} delay${delays !== 1 ? 's' : ''} to review`);
      return parts.length > 0 ? parts.join(' · ') : "Here's your company overview";
    }
    case 'HUSTLER': {
      const parts: string[] = [];
      if (projects > 0) parts.push(`${projects} project${projects !== 1 ? 's' : ''} in portfolio`);
      if (activeBids > 0) parts.push(`${activeBids} bid${activeBids !== 1 ? 's' : ''} in pipeline`);
      return parts.length > 0 ? parts.join(' · ') : "Your portfolio at a glance";
    }
    case 'MANAGER': {
      const parts: string[] = [];
      if (projects > 0) parts.push(`${projects} active project${projects !== 1 ? 's' : ''}`);
      if (delays > 0) parts.push(`${delays} delay${delays !== 1 ? 's' : ''} flagged`);
      return parts.length > 0 ? parts.join(' · ') : "Your projects and team status";
    }
    case 'SUPERINTENDENT':
      return delays > 0 ? `${delays} delay${delays !== 1 ? 's' : ''} on your jobsites` : "Today's crew and jobsite status";
    case 'ESTIMATOR':
      return activeBids > 0 ? `${activeBids} active bid${activeBids !== 1 ? 's' : ''} in pipeline` : "Your bids and pipeline";
    case 'FIELD_WORKER':
      return projects > 0 ? `Assigned to ${projects} project${projects !== 1 ? 's' : ''}` : "Your tasks and schedule";
    case 'VENDOR':
      return "Your messages and updates";
    default:
      return "Here's what's happening today";
  }
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" data-testid="dashboard-skeleton">
      {[1, 2, 3].map((sectionIdx) => (
        <Card key={sectionIdx} className="overflow-hidden">
          <CardHeader className="py-2 px-3 sm:py-3 sm:px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-2 pb-2">
            <div className={`grid ${sectionIdx === 1 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'} gap-3`}>
              {Array.from({ length: sectionIdx === 1 ? 4 : 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border p-4 space-y-3 relative overflow-hidden">
                  <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-4 rounded-full" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { isEditMode, isLoadingLayout } = useDashboardCustomization();
  const roleSubtitle = useRoleSubtitle(user?.role);
  const [widgetLibraryOpen, setWidgetLibraryOpen] = useState(false);
  const [widgetLibraryTargetSection, setWidgetLibraryTargetSection] = useState<string | undefined>(undefined);
  const [mobileFeatureOpen, setMobileFeatureOpen] = useState<"ai-pm" | "cfo" | "voice-logs" | null>(null);

  const handleAddWidgetToSection = (sectionId: string) => {
    setWidgetLibraryTargetSection(sectionId);
    setWidgetLibraryOpen(true);
  };

  const handleWidgetLibraryOpenChange = (open: boolean) => {
    setWidgetLibraryOpen(open);
    if (!open) setWidgetLibraryTargetSection(undefined);
  };

  if (isSuperAdmin(user?.role)) {
    return <Redirect to="/admin" />;
  }
  
  if (isHustler(user?.role)) {
    return <Redirect to="/hustler" />;
  }

  const { greeting, icon: GreetingIcon } = getTimeGreeting();
  const firstName = user?.firstName || "there";

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-3 sm:px-6 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8 rounded-xl bg-gradient-to-br from-primary/5 via-primary/3 to-transparent dark:from-primary/10 dark:via-primary/5 dark:to-transparent border border-border/50 p-4 sm:p-6" data-testid="welcome-section">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Avatar className="h-12 w-12 sm:h-16 sm:w-16 ring-2 ring-primary/20 ring-offset-2 ring-offset-background">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={`${user.firstName} ${user.lastName}`} />}
                <AvatarFallback className="text-base sm:text-lg bg-primary text-primary-foreground">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <GreetingIcon className="w-5 h-5 text-yellow-500" />
                  <h1 className="text-xl sm:text-2xl font-bold text-foreground" data-testid="greeting-text">
                    {greeting}, {firstName}!
                  </h1>
                </div>
                <p className="text-muted-foreground mt-0.5 text-sm sm:text-base" data-testid="text-role-subtitle">
                  {roleSubtitle}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant="secondary" className="text-xs">
                    {user?.role?.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(), "EEEE, MMMM d, yyyy")}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <ThemePicker />

              <div className="hidden sm:flex items-center gap-2">
                <AIAnalysisButton module="ALL" showDropdown={true} variant="outline" size="sm" data-testid="button-ai-analysis" />
                <AIFeatureTrigger feature="ai-pm" variant="outline" size="sm" label="AI Tasks" data-testid="button-open-ai-pm" />
                <AIFeatureTrigger feature="cfo" variant="outline" size="sm" label="Financials" data-testid="button-open-cfo" />
                <AIFeatureTrigger feature="voice-logs" variant="outline" size="sm" label="Voice Logs" data-testid="button-open-voice-logs" />
              </div>

              <div className="flex sm:hidden items-center gap-1">
                <AIAnalysisButton module="ALL" variant="outline" size="sm" data-testid="button-ai-analysis-mobile" />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-quick-actions-dropdown">
                      <Sparkles className="w-4 h-4 mr-1.5" />
                      More
                      <ChevronDown className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setMobileFeatureOpen("ai-pm")} data-testid="menu-item-ai-tasks">
                      <Brain className="w-4 h-4 mr-2" />
                      AI Tasks
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMobileFeatureOpen("cfo")} data-testid="menu-item-financials">
                      <DollarSign className="w-4 h-4 mr-2" />
                      Financials
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMobileFeatureOpen("voice-logs")} data-testid="menu-item-voice-logs">
                      <Mic className="w-4 h-4 mr-2" />
                      Voice Logs
                    </DropdownMenuItem>
                    {hasManagementAccess(user?.role) && !isEditMode && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setLocation('/bids?new=true')} data-testid="menu-item-new-bid">
                          <Plus className="w-4 h-4 mr-2" />
                          New Bid
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {mobileFeatureOpen && (
                  <AIFeatureDialog
                    feature={mobileFeatureOpen}
                    open={true}
                    onOpenChange={(open) => { if (!open) setMobileFeatureOpen(null); }}
                  />
                )}
              </div>

              <DashboardEditMode 
                onToggleWidgetLibrary={() => { setWidgetLibraryTargetSection(undefined); setWidgetLibraryOpen(!widgetLibraryOpen); }}
                widgetLibraryOpen={widgetLibraryOpen}
              />
              {hasManagementAccess(user?.role) && !isEditMode && (
                <Button onClick={() => setLocation('/bids?new=true')} data-testid="button-new-bid" className="hidden sm:inline-flex">
                  <Plus className="w-4 h-4 mr-2" />
                  New Bid
                </Button>
              )}
            </div>
          </div>
        </div>
        
        <AnnouncementBanner />
        <EditModeIndicator />

        {hasManagementAccess(user?.role) && (
          <AIDashboardPanel className="mb-6" />
        )}

        {isLoadingLayout ? (
          <DashboardSkeleton />
        ) : (
          <DashboardGrid onAddWidgetToSection={handleAddWidgetToSection} />
        )}

        <WidgetLibrary open={widgetLibraryOpen} onOpenChange={handleWidgetLibraryOpenChange} defaultSectionId={widgetLibraryTargetSection} />
      </main>
    </div>
  );
}
