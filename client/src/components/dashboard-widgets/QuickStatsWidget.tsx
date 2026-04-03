import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Briefcase, FileText, MessageSquare, Calendar, AlertCircle, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { useDashboardStats, useBids } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { hasManagementAccess } from "@/lib/rbac";
import { type QuickStatsConfig, DEFAULT_QUICK_STATS_CONFIG } from "./QuickStatsSettings";

interface ConversationWithDetails {
  id: string;
  unreadCount: number;
}

interface QuickStatsWidgetProps {
  config?: QuickStatsConfig;
}

export function QuickStatsWidget({ config }: QuickStatsWidgetProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useDashboardStats();
  const { data: bids = [], isLoading: bidsLoading, isError: bidsError, refetch: refetchBids } = useBids();
  const { data: conversations = [], isLoading: convsLoading, isError: convsError, refetch: refetchConvs } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
  });
  const { data: calendarEvents = [], isLoading: calLoading, isError: calError, refetch: refetchCal } = useQuery<any[]>({
    queryKey: ["/api/calendar/my-events"],
  });

  const cfg = { ...DEFAULT_QUICK_STATS_CONFIG, ...config };

  const isLoading = statsLoading || bidsLoading || convsLoading || calLoading;
  const isError = statsError && bidsError && convsError && calError;

  const showBids = cfg.showActiveBids !== false && hasManagementAccess(user?.role);
  const visibleCount = [
    cfg.showActiveProjects !== false,
    showBids,
    cfg.showUnreadMessages !== false,
    cfg.showUpcomingEvents !== false,
  ].filter(Boolean).length;
  const colClass = visibleCount <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-4";

  if (isLoading) {
    return (
      <div className={`grid ${colClass} gap-3 h-full`} data-testid="quick-stats-loading">
        {Array.from({ length: visibleCount || 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1 min-w-0">
                  <Skeleton className="h-7 w-12" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-6 rounded-full shrink-0" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center gap-2" data-testid="quick-stats-error">
        <AlertCircle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-muted-foreground">Failed to load stats.</p>
        <Button variant="outline" size="sm" onClick={() => { refetchStats(); refetchBids(); refetchConvs(); refetchCal(); }} data-testid="button-retry-stats">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  const totalUnreadMessages = conversations
    .filter((c) => c.unreadCount > 0)
    .reduce((sum, c) => sum + c.unreadCount, 0);
  const upcomingEvents = calendarEvents.filter(
    (e) => new Date(e.startDate) >= new Date()
  );

  const cards: Array<{ key: string; show: boolean; content: JSX.Element }> = [
    {
      key: "activeProjects",
      show: cfg.showActiveProjects !== false,
      content: (
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
      ),
    },
    {
      key: "activeBids",
      show: showBids,
      content: (
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
      ),
    },
    {
      key: "unreadMessages",
      show: cfg.showUnreadMessages !== false,
      content: (
        <Card
          className="hover-elevate cursor-pointer"
          onClick={() => window.dispatchEvent(new CustomEvent("open-messaging-widget"))}
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
      ),
    },
    {
      key: "upcomingEvents",
      show: cfg.showUpcomingEvents !== false,
      content: (
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
      ),
    },
  ];

  const visibleCards = cards.filter((c) => c.show);
  const finalColClass = visibleCards.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-4";

  return (
    <div className={`grid ${finalColClass} gap-3 h-full`} data-testid="quick-stats">
      {visibleCards.map((card) => (
        <div key={card.key}>{card.content}</div>
      ))}
    </div>
  );
}
