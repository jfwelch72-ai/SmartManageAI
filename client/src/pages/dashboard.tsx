import { DashboardEditMode, EditModeIndicator } from "@/components/DashboardEditMode";
import { ThemePicker } from "@/components/ThemePicker";
import { DashboardGrid } from "@/components/DashboardGrid";
import { WidgetLibrary } from "@/components/WidgetLibrary";
import { useDashboardCustomization } from "@/hooks/use-dashboard-customization";
import { Plus, Sun, Moon, Sunset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { hasManagementAccess, isSuperAdmin, isHustler } from "@/lib/rbac";
import { format } from "date-fns";
import { Redirect } from "wouter";
import { useState } from "react";

function getTimeGreeting(): { greeting: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { greeting: "Good morning", icon: Sun };
  if (hour < 17) return { greeting: "Good afternoon", icon: Sun };
  if (hour < 21) return { greeting: "Good evening", icon: Sunset };
  return { greeting: "Good night", icon: Moon };
}

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { isEditMode, isLoadingLayout } = useDashboardCustomization();
  const [widgetLibraryOpen, setWidgetLibraryOpen] = useState(false);
  const [widgetLibraryTargetSection, setWidgetLibraryTargetSection] = useState<string | undefined>(undefined);

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
      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-8">
        <div className="mb-6 sm:mb-8" data-testid="welcome-section">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <Avatar className="h-12 w-12 sm:h-16 sm:w-16">
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
                <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                  {format(new Date(), "EEEE, MMMM d, yyyy")}
                </p>
                <Badge variant="secondary" className="mt-2">
                  {user?.role?.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              <ThemePicker />
              <DashboardEditMode 
                onToggleWidgetLibrary={() => { setWidgetLibraryTargetSection(undefined); setWidgetLibraryOpen(!widgetLibraryOpen); }}
                widgetLibraryOpen={widgetLibraryOpen}
              />
              {hasManagementAccess(user?.role) && !isEditMode && (
                <Button onClick={() => setLocation('/bids?new=true')} data-testid="button-new-bid" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  New Bid
                </Button>
              )}
            </div>
          </div>
        </div>
        
        <EditModeIndicator />

        {isLoadingLayout ? (
          <div className="text-center py-12 text-muted-foreground">Loading your dashboard...</div>
        ) : (
          <DashboardGrid onAddWidgetToSection={handleAddWidgetToSection} />
        )}

        <WidgetLibrary open={widgetLibraryOpen} onOpenChange={handleWidgetLibraryOpenChange} defaultSectionId={widgetLibraryTargetSection} />
      </main>
    </div>
  );
}
