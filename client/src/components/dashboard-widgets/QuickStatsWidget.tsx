import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, FileText, MessageSquare, Calendar } from "lucide-react";
import { useLocation } from "wouter";
import { useDashboardStats, useBids } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { hasManagementAccess } from "@/lib/rbac";

interface ConversationWithDetails {
  id: string;
  unreadCount: number;
}

export function QuickStatsWidget() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: stats } = useDashboardStats();
  const { data: bids = [] } = useBids();
  const { data: conversations = [] } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
  });
  const { data: calendarEvents = [] } = useQuery<any[]>({
    queryKey: ["/api/calendar/my-events"],
  });

  const totalUnreadMessages = conversations
    .filter((c) => c.unreadCount > 0)
    .reduce((sum, c) => sum + c.unreadCount, 0);
  const upcomingEvents = calendarEvents.filter(
    (e) => new Date(e.startDate) >= new Date()
  );

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full"
      data-testid="quick-stats"
    >
      <Card
        className="hover-elevate cursor-pointer"
        onClick={() => setLocation("/projects?status=ACTIVE")}
        data-testid="stat-active-projects"
      >
        <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold truncate">
                {stats?.activeProjectsCount || 0}
              </p>
              <p className="text-xs text-muted-foreground truncate">Active Projects</p>
            </div>
            <Briefcase className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground/50 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>

      {hasManagementAccess(user?.role) && (
        <Card
          className="hover-elevate cursor-pointer"
          onClick={() => setLocation("/bids")}
          data-testid="stat-active-bids"
        >
          <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">{bids.length}</p>
                <p className="text-xs text-muted-foreground truncate">Active Bids</p>
              </div>
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground/50 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card
        className="hover-elevate cursor-pointer"
        onClick={() => setLocation("/messages")}
        data-testid="stat-unread-messages"
      >
        <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold truncate">{totalUnreadMessages}</p>
              <p className="text-xs text-muted-foreground truncate">Unread Messages</p>
            </div>
            <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground/50 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>

      <Card
        className="hover-elevate cursor-pointer"
        onClick={() => setLocation("/calendar")}
        data-testid="stat-upcoming-events"
      >
        <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-lg sm:text-2xl font-bold truncate">{upcomingEvents.length}</p>
              <p className="text-xs text-muted-foreground truncate">Upcoming Events</p>
            </div>
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-muted-foreground/50 flex-shrink-0" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
