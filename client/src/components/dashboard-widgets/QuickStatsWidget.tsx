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
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">
                {stats?.activeProjectsCount || 0}
              </p>
              <p className="text-xs text-muted-foreground">Active Projects</p>
            </div>
            <Briefcase className="w-6 h-6 text-muted-foreground/50" />
          </div>
        </CardContent>
      </Card>

      {hasManagementAccess(user?.role) && (
        <Card
          className="hover-elevate cursor-pointer"
          onClick={() => setLocation("/bids")}
          data-testid="stat-active-bids"
        >
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{bids.length}</p>
                <p className="text-xs text-muted-foreground">Active Bids</p>
              </div>
              <FileText className="w-6 h-6 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
      )}

      <Card
        className="hover-elevate cursor-pointer"
        onClick={() => setLocation("/messages")}
        data-testid="stat-unread-messages"
      >
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{totalUnreadMessages}</p>
              <p className="text-xs text-muted-foreground">Unread Messages</p>
            </div>
            <MessageSquare className="w-6 h-6 text-muted-foreground/50" />
          </div>
        </CardContent>
      </Card>

      <Card
        className="hover-elevate cursor-pointer"
        onClick={() => setLocation("/calendar")}
        data-testid="stat-upcoming-events"
      >
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{upcomingEvents.length}</p>
              <p className="text-xs text-muted-foreground">Upcoming Events</p>
            </div>
            <Calendar className="w-6 h-6 text-muted-foreground/50" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
