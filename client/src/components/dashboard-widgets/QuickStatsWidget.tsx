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
import { useState, useEffect, useRef } from "react";

function AnimatedCounter({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    if (diff === 0) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);

  return <>{display}</>;
}

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

  const statCardStyles = "hover-elevate cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-md";

  const cards: Array<{ key: string; show: boolean; content: JSX.Element }> = [
    {
      key: "activeProjects",
      show: cfg.showActiveProjects !== false,
      content: (
        <Card
          className={statCardStyles}
          onClick={() => setLocation("/projects?status=ACTIVE")}
          data-testid="stat-active-projects"
        >
          <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">
                  <AnimatedCounter value={stats?.activeProjectsCount || 0} />
                </p>
                <p className="text-xs text-muted-foreground truncate">Active Projects</p>
              </div>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-blue-600/5 flex items-center justify-center flex-shrink-0">
                <Briefcase className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 dark:text-blue-400" />
              </div>
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
          className={statCardStyles}
          onClick={() => setLocation("/bids")}
          data-testid="stat-active-bids"
        >
          <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">
                  <AnimatedCounter value={bids.length} />
                </p>
                <p className="text-xs text-muted-foreground truncate">Active Bids</p>
              </div>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
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
          className={statCardStyles}
          onClick={() => window.dispatchEvent(new CustomEvent("open-messaging-widget"))}
          data-testid="stat-unread-messages"
        >
          <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">
                  <AnimatedCounter value={totalUnreadMessages} />
                </p>
                <p className="text-xs text-muted-foreground truncate">Unread Messages</p>
              </div>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-violet-500/15 to-violet-600/5 flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5 text-violet-600 dark:text-violet-400" />
              </div>
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
          className={statCardStyles}
          onClick={() => setLocation("/calendar")}
          data-testid="stat-upcoming-events"
        >
          <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4 px-3 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">
                  <AnimatedCounter value={upcomingEvents.length} />
                </p>
                <p className="text-xs text-muted-foreground truncate">Upcoming Events</p>
              </div>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-600/5 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 dark:text-amber-400" />
              </div>
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
