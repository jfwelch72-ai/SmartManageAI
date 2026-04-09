import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { isVendor } from "@/lib/rbac";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  CalendarRange,
  Building2,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

interface ScheduleEvent {
  id: string;
  projectName: string;
  contractorOrgName: string;
  description: string;
  startDate: string;
  endDate: string;
  location: string | null;
  status: "upcoming" | "in_progress" | "completed" | "delayed";
}

export default function VendorSchedulePage() {
  const { user } = useAuth();

  if (!isVendor(user?.role)) {
    return <Redirect to="/dashboard" />;
  }

  const { data: events, isLoading } = useQuery<ScheduleEvent[]>({
    queryKey: ["/api/vendor/schedule"],
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "in_progress":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" data-testid={`badge-status-${status}`}><Clock className="w-3 h-3 mr-1" />In Progress</Badge>;
      case "completed":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid={`badge-status-${status}`}><CheckCircle2 className="w-3 h-3 mr-1" />Completed</Badge>;
      case "delayed":
        return <Badge variant="destructive" data-testid={`badge-status-${status}`}><AlertTriangle className="w-3 h-3 mr-1" />Delayed</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-status-${status}`}><Clock className="w-3 h-3 mr-1" />Upcoming</Badge>;
    }
  };

  const formatDateRange = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    if (s.getFullYear() !== new Date().getFullYear()) {
      opts.year = "numeric";
    }
    return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
  };

  const upcoming = events?.filter(e => e.status === "upcoming") ?? [];
  const inProgress = events?.filter(e => e.status === "in_progress") ?? [];
  const completed = events?.filter(e => e.status === "completed") ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Schedule</h1>
        <p className="text-muted-foreground mt-1">View your upcoming delivery windows, scheduled work dates, and project milestones from contractors.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-stat-upcoming">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Upcoming</p>
                <p className="text-2xl font-bold" data-testid="text-upcoming-count">{upcoming.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-active">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <CalendarRange className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-2xl font-bold" data-testid="text-active-count">{inProgress.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-completed">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900">
                <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold" data-testid="text-completed-count">{completed.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-schedule-title">Scheduled Events</CardTitle>
          <CardDescription>Delivery windows, work dates, and project milestones assigned to you</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : events && events.length > 0 ? (
            <div className="space-y-3">
              {events.map((event) => (
                <div key={event.id} className="flex items-center justify-between p-4 border rounded-lg" data-testid={`row-event-${event.id}`}>
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded bg-muted">
                      <CalendarRange className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium" data-testid={`text-event-name-${event.id}`}>{event.description}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Building2 className="w-3 h-3" />
                        <span>{event.contractorOrgName}</span>
                        <span>&middot;</span>
                        <span>{event.projectName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateRange(event.startDate, event.endDate)}
                        </span>
                        {event.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {event.location}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(event.status)}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <CalendarRange className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground" data-testid="text-no-events">No scheduled events yet</p>
              <p className="text-sm text-muted-foreground mt-1">When contractors schedule deliveries or work windows involving your services, they'll appear here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
