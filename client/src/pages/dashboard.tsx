import AppHeader from "@/components/AppHeader";
import KPICard from "@/components/KPICard";
import ProjectCard from "@/components/ProjectCard";
import { 
  Briefcase, Clock, AlertCircle, CalendarClock, Plus, DollarSign, 
  AlertTriangle, Users, Bell, HardHat, Check, MessageSquare, Calendar,
  ChevronRight, Sun, Moon, Sunset, FileText, ClipboardList, Wrench,
  TrendingUp, CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardStats, useProjects, useBids } from "@/hooks/use-data";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FeaturePermissions, hasManagementAccess } from "@/lib/rbac";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Notification, CalendarEvent, AITask } from "@shared/schema";
import { formatDistanceToNow, format, isToday, isTomorrow, isThisWeek } from "date-fns";

function getTimeGreeting(): { greeting: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { greeting: "Good morning", icon: Sun };
  if (hour < 17) return { greeting: "Good afternoon", icon: Sun };
  if (hour < 21) return { greeting: "Good evening", icon: Sunset };
  return { greeting: "Good night", icon: Moon };
}

function formatEventDate(dateStr: string | Date): string {
  const date = new Date(dateStr);
  if (isToday(date)) return `Today at ${format(date, 'h:mm a')}`;
  if (isTomorrow(date)) return `Tomorrow at ${format(date, 'h:mm a')}`;
  if (isThisWeek(date)) return format(date, "EEEE 'at' h:mm a");
  return format(date, "MMM d 'at' h:mm a");
}

interface ConversationWithDetails {
  id: string;
  name: string | null;
  isCompanyChannel: boolean;
  updatedAt: string;
  participants: Array<{
    user: {
      id: string;
      firstName: string;
      lastName: string;
      role: string;
    };
  }>;
  lastMessage?: {
    content: string;
    createdAt: string;
    sender: {
      firstName: string;
      lastName: string;
    };
  } | null;
  unreadCount: number;
}

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: bids = [], isLoading: bidsLoading } = useBids();

  const { greeting, icon: GreetingIcon } = getTimeGreeting();
  const firstName = user?.firstName || "there";

  // Fetch crew assignments for superintendents
  const { data: crewAssignments = [] } = useQuery<import("@shared/schema").CrewProjectAssignment[]>({
    queryKey: ["/api/crew-assignments"],
    enabled: user?.role === "SUPERINTENDENT",
  });

  const { data: crews = [] } = useQuery<import("@shared/schema").Crew[]>({
    queryKey: ["/api/crews"],
    enabled: user?.role === "SUPERINTENDENT",
  });

  // Fetch notifications
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  // Fetch upcoming calendar events
  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/my-events"],
  });

  // Fetch conversations with unread counts
  const { data: conversations = [] } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
  });

  // Fetch AI tasks
  const { data: aiTasks = [] } = useQuery<AITask[]>({
    queryKey: ["/api/ai/tasks"],
  });
  
  const projectAssignmentNotifications = notifications.filter(
    n => n.type === "PROJECT_ASSIGNMENT" && !n.isRead
  );

  const unreadNotifications = notifications.filter(n => !n.isRead);

  // Mark notification as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await apiRequest("PATCH", `/api/notifications/${notificationId}/read`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const activeProjects = projects.filter(p => p.status === 'ACTIVE');
  // All bids in the bids table are considered "active" (not yet converted to projects)
  // Once a bid is awarded, it becomes a project and is removed from the bids table
  const activeBids = bids;

  // Calculate projects missing budget data
  const projectsMissingBudget = projects.filter(p => {
    const budgetNum = Number(p.budget);
    return !p.budget || isNaN(budgetNum) || budgetNum <= 0;
  });

  // Filter upcoming events (next 7 days)
  const upcomingEvents = calendarEvents
    .filter(e => new Date(e.startDate) >= new Date())
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
    .slice(0, 5);

  // Filter conversations with unread messages
  const conversationsWithUnread = conversations.filter(c => c.unreadCount > 0);
  const totalUnreadMessages = conversationsWithUnread.reduce((sum, c) => sum + c.unreadCount, 0);

  // Pending AI tasks
  const pendingTasks = aiTasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS');

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8" data-testid="welcome-section">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <GreetingIcon className="w-5 h-5 text-yellow-500" />
                  <h1 className="text-2xl font-bold text-foreground" data-testid="greeting-text">
                    {greeting}, {firstName}!
                  </h1>
                </div>
                <p className="text-muted-foreground mt-1">
                  {format(new Date(), "EEEE, MMMM d, yyyy")}
                </p>
                <Badge variant="secondary" className="mt-2">
                  {user?.role?.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="flex gap-2">
              {FeaturePermissions.CREATE_PROJECT(user?.role) && (
                <Button onClick={() => setLocation('/projects?new=true')} data-testid="button-new-project">
                  <Plus className="w-4 h-4 mr-2" />
                  New Project
                </Button>
              )}
              {hasManagementAccess(user?.role) && (
                <Button variant="outline" onClick={() => setLocation('/bids?new=true')} data-testid="button-new-bid">
                  <FileText className="w-4 h-4 mr-2" />
                  New Bid
                </Button>
              )}
            </div>
          </div>
        </div>

        {statsLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading your dashboard...</div>
        ) : (
          <div className="space-y-6">
            {/* Quick Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="quick-stats">
              <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/projects?status=ACTIVE')} data-testid="stat-active-projects">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{stats?.activeProjectsCount || 0}</p>
                      <p className="text-sm text-muted-foreground">Active Projects</p>
                    </div>
                    <Briefcase className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>
              
              {hasManagementAccess(user?.role) && (
                <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/bids')} data-testid="stat-active-bids">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-2xl font-bold">{activeBids.length}</p>
                        <p className="text-sm text-muted-foreground">Active Bids</p>
                      </div>
                      <FileText className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                  </CardContent>
                </Card>
              )}
              
              <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/messages')} data-testid="stat-unread-messages">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{totalUnreadMessages}</p>
                      <p className="text-sm text-muted-foreground">Unread Messages</p>
                    </div>
                    <MessageSquare className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="hover-elevate cursor-pointer" onClick={() => setLocation('/calendar')} data-testid="stat-upcoming-events">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold">{upcomingEvents.length}</p>
                      <p className="text-sm text-muted-foreground">Upcoming Events</p>
                    </div>
                    <Calendar className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Messages & Notifications */}
              <div className="space-y-6">
                {/* Unread Messages */}
                <Card data-testid="card-messages">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" />
                        Messages
                        {totalUnreadMessages > 0 && (
                          <Badge variant="default" className="ml-1">
                            {totalUnreadMessages}
                          </Badge>
                        )}
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setLocation('/messages')} data-testid="button-view-all-messages">
                        View All
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {conversationsWithUnread.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No unread messages
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {conversationsWithUnread.slice(0, 4).map((conv) => {
                          const otherParticipants = conv.participants?.filter(p => p.user.id !== user?.id) || [];
                          const displayName = conv.isCompanyChannel 
                            ? "Company Channel" 
                            : conv.name || otherParticipants.map(p => `${p.user.firstName} ${p.user.lastName}`).join(', ');
                          
                          return (
                            <div 
                              key={conv.id}
                              className="flex items-start gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                              onClick={() => setLocation(`/messages?conversation=${conv.id}`)}
                              data-testid={`message-preview-${conv.id}`}
                            >
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-xs">
                                  {conv.isCompanyChannel ? 'TFR' : otherParticipants[0]?.user.firstName?.[0]}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium truncate">{displayName}</p>
                                  <Badge variant="default" className="shrink-0">{conv.unreadCount}</Badge>
                                </div>
                                {conv.lastMessage && (
                                  <p className="text-xs text-muted-foreground truncate">
                                    {conv.lastMessage.sender.firstName}: {conv.lastMessage.content}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Notifications */}
                <Card data-testid="card-notifications">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Bell className="w-4 h-4" />
                        Notifications
                        {unreadNotifications.length > 0 && (
                          <Badge variant="default" className="ml-1">
                            {unreadNotifications.length}
                          </Badge>
                        )}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {unreadNotifications.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        All caught up!
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {unreadNotifications.slice(0, 5).map((notification) => (
                          <div 
                            key={notification.id}
                            className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
                            data-testid={`notification-item-${notification.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{notification.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="shrink-0"
                              onClick={() => markAsReadMutation.mutate(notification.id)}
                              disabled={markAsReadMutation.isPending}
                              data-testid={`button-dismiss-notification-${notification.id}`}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Center Column - Calendar & Tasks */}
              <div className="space-y-6">
                {/* Upcoming Calendar Events */}
                <Card data-testid="card-calendar">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Upcoming Events
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setLocation('/calendar')} data-testid="button-view-calendar">
                        View Calendar
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {upcomingEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No upcoming events
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {upcomingEvents.map((event) => (
                          <div 
                            key={event.id}
                            className="flex items-start gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                            onClick={() => setLocation('/calendar')}
                            data-testid={`event-item-${event.id}`}
                          >
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex flex-col items-center justify-center shrink-0">
                              <span className="text-xs font-bold text-primary">
                                {format(new Date(event.startDate), 'd')}
                              </span>
                              <span className="text-[10px] text-primary uppercase">
                                {format(new Date(event.startDate), 'MMM')}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{event.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatEventDate(event.startDate)}
                              </p>
                              <Badge variant="outline" className="mt-1 text-xs">
                                {event.eventType.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Pending Tasks / Action Items */}
                {pendingTasks.length > 0 && (
                  <Card data-testid="card-tasks">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ClipboardList className="w-4 h-4" />
                        AI-Generated Tasks
                        <Badge variant="default" className="ml-1">{pendingTasks.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {pendingTasks.slice(0, 4).map((task) => (
                          <div 
                            key={task.id}
                            className="flex items-center gap-3 p-2 rounded-md bg-muted/50"
                            data-testid={`task-item-${task.id}`}
                          >
                            <div className={`w-2 h-2 rounded-full shrink-0 ${
                              task.priority === 'CRITICAL' ? 'bg-red-500' :
                              task.priority === 'HIGH' ? 'bg-orange-500' :
                              task.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-500'
                            }`} />
                            <p className="text-sm flex-1 truncate">{task.title}</p>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {task.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Outstanding Items for Management */}
                {hasManagementAccess(user?.role) && (
                  <Card data-testid="card-outstanding-items">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Outstanding Items
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {stats?.pendingChangeOrdersCount ? (
                          <div 
                            className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
                            onClick={() => setLocation('/projects?changeOrders=pending')}
                            data-testid="outstanding-change-orders"
                          >
                            <div className="flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-yellow-500" />
                              <span className="text-sm">Pending Change Orders</span>
                            </div>
                            <Badge variant="secondary">{stats.pendingChangeOrdersCount}</Badge>
                          </div>
                        ) : null}
                        
                        {stats?.pendingTimeOffCount ? (
                          <div 
                            className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
                            onClick={() => setLocation('/calendar?view=timeoff')}
                            data-testid="outstanding-timeoff"
                          >
                            <div className="flex items-center gap-2">
                              <CalendarClock className="w-4 h-4 text-blue-500" />
                              <span className="text-sm">Time-Off Requests</span>
                            </div>
                            <Badge variant="secondary">{stats.pendingTimeOffCount}</Badge>
                          </div>
                        ) : null}
                        
                        {projectsMissingBudget.length > 0 && (
                          <div 
                            className="flex items-center justify-between p-2 rounded-md hover-elevate cursor-pointer"
                            onClick={() => setLocation('/projects?filter=missingBudget')}
                            data-testid="outstanding-missing-budget"
                          >
                            <div className="flex items-center gap-2">
                              <DollarSign className="w-4 h-4 text-orange-500" />
                              <span className="text-sm">Missing Budget Data</span>
                            </div>
                            <Badge variant="secondary">{projectsMissingBudget.length}</Badge>
                          </div>
                        )}
                        
                        {!stats?.pendingChangeOrdersCount && !stats?.pendingTimeOffCount && projectsMissingBudget.length === 0 && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            All caught up! No outstanding items.
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Right Column - Projects & Bids */}
              <div className="space-y-6">
                {/* Active Projects */}
                <Card data-testid="card-active-projects">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Briefcase className="w-4 h-4" />
                        Active Projects
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setLocation('/projects')} data-testid="button-view-all-projects">
                        View All
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {projectsLoading ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
                    ) : activeProjects.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No active projects
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {activeProjects.slice(0, 4).map((project) => (
                          <div 
                            key={project.code}
                            className="p-3 rounded-md border hover-elevate cursor-pointer"
                            onClick={() => setLocation(`/projects/${project.code}`)}
                            data-testid={`project-item-${project.code}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="font-mono text-xs">{project.code}</Badge>
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                                ACTIVE
                              </Badge>
                            </div>
                            <p className="text-sm font-medium truncate">{project.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{project.clientName}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Active Bids - Management Only */}
                {hasManagementAccess(user?.role) && (
                  <Card data-testid="card-active-bids">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          Active Bids
                        </CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => setLocation('/bids')} data-testid="button-view-all-bids">
                          View All
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {bidsLoading ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
                      ) : activeBids.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No active bids
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {activeBids.slice(0, 4).map((bid) => {
                            const bidAmountNum = Number(bid.bidAmount);
                            const hasBudget = bid.bidAmount && !isNaN(bidAmountNum) && bidAmountNum > 0;
                            return (
                              <div
                                key={bid.code}
                                className="p-3 rounded-md border hover-elevate cursor-pointer"
                                onClick={() => setLocation(`/bids/${encodeURIComponent(bid.code)}`)}
                                data-testid={`bid-item-${bid.code}`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="font-mono text-xs">{bid.code}</Badge>
                                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 text-xs">
                                    BID
                                  </Badge>
                                  {!hasBudget && (
                                    <Badge variant="outline" className="text-yellow-600 border-yellow-600 text-xs">
                                      No Budget
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm font-medium truncate">{bid.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {bid.clientName}
                                  {bid.dueDate && ` • Due: ${format(new Date(bid.dueDate), 'MMM d')}`}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Crew Scheduling for Superintendents */}
                {user?.role === "SUPERINTENDENT" && crews.length > 0 && (
                  <Card data-testid="card-crew-overview">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Crew Overview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="text-center p-2 bg-muted rounded-md">
                          <div className="text-lg font-bold">{crews.length}</div>
                          <div className="text-xs text-muted-foreground">Total</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded-md">
                          <div className="text-lg font-bold">
                            {crewAssignments.filter((a: any) => a.project?.status === 'ACTIVE').length}
                          </div>
                          <div className="text-xs text-muted-foreground">Assigned</div>
                        </div>
                        <div className="text-center p-2 bg-muted rounded-md">
                          <div className="text-lg font-bold">
                            {activeProjects.filter((p: any) => !crewAssignments.some((a: any) => a.project?.id === p.id)).length}
                          </div>
                          <div className="text-xs text-muted-foreground">Need Crews</div>
                        </div>
                      </div>
                      <Button 
                        variant="outline" 
                        className="w-full" 
                        onClick={() => setLocation('/crews')}
                        data-testid="button-manage-crews"
                      >
                        Manage Crews
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Project Assignment Notifications - Full Width Alert */}
            {projectAssignmentNotifications.length > 0 && (
              <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950/20" data-testid="card-project-assignments">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <HardHat className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    New Project Assignments
                    <Badge variant="default" className="ml-2">
                      {projectAssignmentNotifications.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    You have been assigned to new projects. Click to view details.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {projectAssignmentNotifications.map((notification) => (
                      <div 
                        key={notification.id}
                        className="flex items-center justify-between p-3 bg-background rounded-md"
                        data-testid={`assignment-notification-${notification.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <Bell className="w-4 h-4 text-blue-500" />
                          <div>
                            <p className="text-sm font-medium">{notification.title}</p>
                            <p className="text-xs text-muted-foreground">{notification.message}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {notification.relatedEntityId && (
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                markAsReadMutation.mutate(notification.id);
                                setLocation(`/projects/${notification.relatedEntityId}`);
                              }}
                              data-testid={`button-view-project-${notification.id}`}
                            >
                              View Project
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => markAsReadMutation.mutate(notification.id)}
                            disabled={markAsReadMutation.isPending}
                            data-testid={`button-dismiss-${notification.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
