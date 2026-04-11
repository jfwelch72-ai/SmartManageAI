import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  User,
  Briefcase,
  Clock,
  Settings,
  FolderOpen,
  TrendingUp,
  Calendar,
  Mail,
  Phone,
  Shield,
  Activity,
} from "lucide-react";

interface ProjectSummary {
  code: string;
  name: string;
  status: string;
}

interface ActivityLogEntry {
  id: string;
  action: string;
  details: string | null;
  createdAt: string;
}

export default function ProfilePage() {
  const { user } = useAuth();

  const { data: projectsData, isLoading: projectsLoading } = useQuery<{ data: ProjectSummary[] }>({
    queryKey: ["/api/projects"],
  });

  const { data: activityData, isLoading: activityLoading } = useQuery<ActivityLogEntry[]>({
    queryKey: ["/api/activity-log?limit=10"],
  });

  const { data: dashStats, isLoading: statsLoading } = useQuery<{
    activeProjectsCount: number;
    pendingChangeOrdersCount: number;
    pendingTimeOffCount: number;
    activeDelaysCount: number;
  }>({
    queryKey: ["/api/dashboard/stats"],
  });

  const projects = projectsData?.data || [];
  const activeProjects = projects.filter(p => p.status === "ACTIVE");
  const isLoading = projectsLoading || statsLoading;

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Card data-testid="card-profile-summary">
        <CardContent className="flex flex-col sm:flex-row items-center gap-6 pt-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt="Avatar"
                className="w-20 h-20 rounded-full object-cover"
                data-testid="img-avatar"
              />
            ) : (
              <User className="w-10 h-10 text-primary" />
            )}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold" data-testid="text-profile-name">
              {user.firstName} {user.lastName}
            </h1>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-1">
              <Badge variant="secondary" data-testid="badge-role">
                <Shield className="w-3 h-3 mr-1" />
                {user.roleLabel || user.role}
              </Badge>
              {user.tradeSpecialization && (
                <Badge variant="outline" data-testid="badge-trade">
                  {user.tradeSpecialization}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 mt-3 text-sm text-muted-foreground">
              {user.email && (
                <span className="flex items-center gap-1" data-testid="text-email">
                  <Mail className="w-3.5 h-3.5" />
                  {user.email}
                </span>
              )}
              {user.phone && (
                <span className="flex items-center gap-1" data-testid="text-phone">
                  <Phone className="w-3.5 h-3.5" />
                  {user.phone}
                </span>
              )}
            </div>
          </div>
          <Link href="/settings/profile">
            <Button variant="outline" size="sm" data-testid="button-edit-profile">
              <Settings className="w-4 h-4 mr-1" />
              Edit Profile
            </Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FolderOpen className="w-5 h-5 text-blue-600 dark:text-blue-300" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-active-projects">
                  {isLoading ? <Skeleton className="h-6 w-8 inline-block" /> : (dashStats?.activeProjectsCount ?? activeProjects.length)}
                </p>
                <p className="text-sm text-muted-foreground">Active Projects</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Briefcase className="w-5 h-5 text-amber-600 dark:text-amber-300" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-total-projects">
                  {isLoading ? <Skeleton className="h-6 w-8 inline-block" /> : projects.length}
                </p>
                <p className="text-sm text-muted-foreground">Total Projects</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <TrendingUp className="w-5 h-5 text-orange-600 dark:text-orange-300" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-pending-cos">
                  {isLoading ? <Skeleton className="h-6 w-8 inline-block" /> : (dashStats?.pendingChangeOrdersCount ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">Pending COs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <Clock className="w-5 h-5 text-red-600 dark:text-red-300" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="stat-active-delays">
                  {isLoading ? <Skeleton className="h-6 w-8 inline-block" /> : (dashStats?.activeDelaysCount ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">Active Delays</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-assigned-projects">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            Assigned Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : activeProjects.length === 0 ? (
            <div className="text-center py-8">
              <FolderOpen className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No active projects assigned</p>
              <Link href="/projects">
                <Button variant="outline" size="sm" className="mt-3" data-testid="button-view-projects">
                  View All Projects
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {activeProjects.slice(0, 8).map(project => (
                <Link key={project.code} href={`/projects/${project.code}`}>
                  <div
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                    data-testid={`project-row-${project.code}`}
                  >
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-sm">{project.code}</p>
                        <p className="text-xs text-muted-foreground">{project.name}</p>
                      </div>
                    </div>
                    <Badge
                      variant={project.status === "ACTIVE" ? "default" : "secondary"}
                      data-testid={`badge-project-status-${project.code}`}
                    >
                      {project.status}
                    </Badge>
                  </div>
                </Link>
              ))}
              {activeProjects.length > 8 && (
                <Link href="/projects">
                  <Button variant="ghost" size="sm" className="w-full mt-2" data-testid="button-view-all-projects">
                    View all {activeProjects.length} active projects
                  </Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-recent-activity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activityLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !activityData || activityData.length === 0 ? (
            <div className="text-center py-8">
              <Activity className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No recent activity</p>
              <p className="text-xs text-muted-foreground mt-1">Your actions across the platform will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {activityData.slice(0, 10).map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded-lg border"
                  data-testid={`activity-row-${entry.id}`}
                >
                  <div className="p-1.5 rounded bg-muted mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{entry.action.replace(/_/g, " ")}</p>
                    {entry.details && (
                      <p className="text-xs text-muted-foreground truncate">{entry.details}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-quick-links">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Quick Links
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link href="/settings/profile">
              <Button variant="outline" className="w-full justify-start" data-testid="link-settings-profile">
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Button>
            </Link>
            <Link href="/time-tracking">
              <Button variant="outline" className="w-full justify-start" data-testid="link-time-tracking">
                <Clock className="w-4 h-4 mr-2" />
                Time Tracking
              </Button>
            </Link>
            <Link href="/tasks">
              <Button variant="outline" className="w-full justify-start" data-testid="link-tasks">
                <Briefcase className="w-4 h-4 mr-2" />
                My Tasks
              </Button>
            </Link>
            <Link href="/messages">
              <Button variant="outline" className="w-full justify-start" data-testid="link-messages">
                <Mail className="w-4 h-4 mr-2" />
                Messages
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
