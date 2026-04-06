import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, Users, TrendingUp, Activity, ChevronRight, Database, Clock, Server, DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";

interface PlatformStats {
  totalOrganizations: number;
  totalUsers: number;
  activeUsers: number;
  newOrganizationsLast30Days: number;
  organizationsByTrade: Array<{ tradeType: string; count: number }>;
  usersByRole: Array<{ role: string; count: number }>;
}

interface SubscriptionStats {
  totalSubscriptions: number;
  estimatedMrr: number;
  byPlanTier: Array<{ planTier: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  addonStats: Array<{ addonKey: string; count: number }>;
}

interface HealthCheck {
  status: string;
  latencyMs?: number;
  detail?: string;
}

interface PlatformHealth {
  status: string;
  uptimeSeconds: number;
  memoryUsageMb: number;
  responseTimeMs: number;
  checks: Record<string, HealthCheck>;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function PlatformAdminDashboard() {
  const { user, logout, organizationName } = useAuth();
  const { data: stats, isLoading } = useQuery<PlatformStats>({
    queryKey: ["/api/platform/stats"],
  });
  const { data: health } = useQuery<PlatformHealth>({
    queryKey: ["/api/platform/health"],
    refetchInterval: 30000,
  });
  const { data: subStats } = useQuery<SubscriptionStats>({
    queryKey: ["/api/platform/subscriptions/stats"],
  });

  const userName = user ? `${user.firstName} ${user.lastName}` : "Admin";
  const userRole = user?.role || "SUPER_ADMIN";

  const tradeTypeLabels: Record<string, string> = {
    GENERAL_CONTRACTOR: "General Contractor",
    ROOFING: "Roofing",
    ELECTRICAL: "Electrical",
    PLUMBING: "Plumbing",
    HVAC: "HVAC",
    CONCRETE: "Concrete",
    CARPENTRY: "Carpentry",
    MASONRY: "Masonry",
    DRYWALL: "Drywall",
    PAINTING: "Painting",
    FLOORING: "Flooring",
    LANDSCAPING: "Landscaping",
    EXCAVATION: "Excavation",
    DEMOLITION: "Demolition",
    STEEL_ERECTION: "Steel Erection",
    GLAZING: "Glazing",
    INSULATION: "Insulation",
    FIRE_PROTECTION: "Fire Protection",
    WATERPROOFING: "Waterproofing",
    OTHER: "Other",
  };

  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: "Super Admins",
    ADMIN: "Administrators",
    HUSTLER: "Hustlers",
    MANAGER: "Managers",
    SUPERINTENDENT: "Superintendents",
    ESTIMATOR: "Estimators",
    FIELD_WORKER: "Field Workers",
    VENDOR: "Vendors",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold">Platform Administration</h1>
              <p className="text-muted-foreground text-sm">Monitor and manage all organizations</p>
            </div>
          </div>
          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-platform-admin-title">Platform Administration</h1>
          <p className="text-muted-foreground text-sm">Monitor and manage all organizations on the platform</p>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-orgs">{stats?.totalOrganizations || 0}</div>
            <p className="text-xs text-muted-foreground">
              +{stats?.newOrganizationsLast30Days || 0} in last 30 days
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-users">{stats?.totalUsers || 0}</div>
            <p className="text-xs text-muted-foreground">
              {stats?.activeUsers || 0} active users
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Monthly Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-mrr">${(subStats?.estimatedMrr || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {subStats?.totalSubscriptions || 0} active subscriptions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Trade Types</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.organizationsByTrade?.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              Different specialties
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Platform Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                health?.status === "healthy"
                  ? "text-green-600 dark:text-green-400"
                  : health?.status === "unhealthy"
                    ? "text-red-600 dark:text-red-400"
                    : health?.status === "degraded"
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-muted-foreground"
              }`}
              data-testid="text-health-status"
            >
              {health?.status === "healthy"
                ? "Healthy"
                : health?.status === "unhealthy"
                  ? "Unhealthy"
                  : health?.status === "degraded"
                    ? "Degraded"
                    : "Checking..."}
            </div>
            <p className="text-xs text-muted-foreground" data-testid="text-health-uptime">
              {health ? `Uptime: ${formatUptime(health.uptimeSeconds)}` : "Loading..."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System Health Details
          </CardTitle>
          <CardDescription>Real-time infrastructure status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Database</p>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={health?.checks?.database?.status === "healthy" ? "default" : "destructive"}
                    data-testid="badge-db-status"
                  >
                    {health?.checks?.database?.status || "checking"}
                  </Badge>
                  {health?.checks?.database?.latencyMs != null && (
                    <span className="text-xs text-muted-foreground" data-testid="text-db-latency">
                      {health.checks.database.latencyMs}ms
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Background Jobs</p>
                <div className="flex flex-col gap-1">
                  <Badge
                    variant={
                      health?.checks?.backgroundJobs?.status === "healthy"
                        ? "default"
                        : health?.checks?.backgroundJobs?.status === "unknown"
                          ? "secondary"
                          : "destructive"
                    }
                    data-testid="badge-jobs-status"
                  >
                    {health?.checks?.backgroundJobs?.status || "checking"}
                  </Badge>
                  {health?.checks?.backgroundJobs?.detail && (
                    <span className="text-xs text-muted-foreground" data-testid="text-jobs-detail">
                      {health.checks.backgroundJobs.detail}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Server</p>
                <div className="flex flex-col gap-1">
                  <Badge variant="default" data-testid="badge-server-status">running</Badge>
                  <span className="text-xs text-muted-foreground" data-testid="text-server-memory">
                    Memory: {health?.memoryUsageMb || "—"} MB
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Organizations by Trade</CardTitle>
                <CardDescription>Distribution of contractor specialties</CardDescription>
              </div>
              <Link href="/admin/organizations">
                <Button variant="ghost" size="sm" data-testid="link-view-all-orgs">
                  View All <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.organizationsByTrade?.slice(0, 6).map((trade) => (
                <div key={trade.tradeType} className="flex items-center justify-between">
                  <span className="text-sm">{tradeTypeLabels[trade.tradeType] || trade.tradeType}</span>
                  <Badge variant="secondary">{trade.count}</Badge>
                </div>
              ))}
              {(!stats?.organizationsByTrade || stats.organizationsByTrade.length === 0) && (
                <p className="text-sm text-muted-foreground">No organizations yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Users by Role</CardTitle>
                <CardDescription>Distribution of user roles across all organizations</CardDescription>
              </div>
              <Link href="/admin/analytics">
                <Button variant="ghost" size="sm" data-testid="link-view-analytics">
                  Analytics <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats?.usersByRole?.map((role) => (
                <div key={role.role} className="flex items-center justify-between">
                  <span className="text-sm">{roleLabels[role.role] || role.role}</span>
                  <Badge variant="secondary">{role.count}</Badge>
                </div>
              ))}
              {(!stats?.usersByRole || stats.usersByRole.length === 0) && (
                <p className="text-sm text-muted-foreground">No users yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
        <Link href="/admin/organizations">
          <Card className="hover-elevate cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Organizations
              </CardTitle>
              <CardDescription>View and manage all contractor companies</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/admin/analytics">
          <Card className="hover-elevate cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Analytics & Monitoring
              </CardTitle>
              <CardDescription>Platform usage, metrics, and resource monitoring</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/admin/tools">
          <Card className="hover-elevate cursor-pointer transition-colors">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Tools
              </CardTitle>
              <CardDescription>Support tools, security audit, subscriptions, and announcements</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
      </main>
    </div>
  );
}
