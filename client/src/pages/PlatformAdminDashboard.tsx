import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Building2, Users, TrendingUp, Activity, ChevronRight, Database, Clock, Server, DollarSign, FileText, ListChecks, Headphones, MailWarning, RefreshCw, TicketCheck, ShieldCheck, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { isSuperAdmin } from "@/lib/rbac";

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

interface BetaControl {
  name: string;
  ok: boolean;
  description: string;
  value: string;
}

interface BetaReadiness {
  ready: boolean;
  environment: string;
  controls: BetaControl[];
  checkedAt: string;
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
  const queryClient = useQueryClient();
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

  // Beta Readiness panel — SUPER_ADMIN only (the endpoint enforces this too)
  const isSuper = isSuperAdmin(user?.role);
  const {
    data: betaReadiness,
    isLoading: betaLoading,
    isFetching: betaFetching,
  } = useQuery<BetaReadiness>({
    queryKey: ["/api/ops/beta-readiness"],
    enabled: isSuper,
    retry: false,
  });

  // Task #1594 — surface a small "N quiet org(s)" badge on the
  // transcript-backfill tile so platform support can spot tenants whose
  // alert pipeline is silently broken without opening the deep-link page.
  // Reuses the existing JSON digest endpoint (and its query key shape, to
  // share cache with `BackfillAlertFailuresDigestCard`) so tile + card
  // never drift. Cross-org + quietOrgs are SUPER_ADMIN-only on the server,
  // so we mirror that gating here to skip the request for non-supers.
  const { data: quietDigest } = useQuery<{
    quietOrgs?: Array<{ organizationId: string }>;
  }>({
    queryKey: [
      "/api/crm/calls/transcripts/backfill/alert-failures-digest",
      24,
      "all-orgs",
    ],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/crm/calls/transcripts/backfill/alert-failures-digest?windowHours=24&crossOrg=true",
      );
      return await res.json();
    },
    enabled: isSuper,
  });
  const quietOrgsCount = quietDigest?.quietOrgs?.length ?? 0;

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

      {isSuper && (
        <Card
          data-testid="card-beta-readiness"
          className={
            betaReadiness && !betaReadiness.ready
              ? "border-red-500 dark:border-red-600"
              : betaReadiness?.ready
                ? "border-green-500 dark:border-green-600"
                : ""
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {betaReadiness?.ready ? (
                  <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
                )}
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Beta Readiness
                    {betaReadiness && (
                      <Badge
                        variant={betaReadiness.ready ? "default" : "destructive"}
                        data-testid="badge-beta-readiness-status"
                        className={betaReadiness.ready ? "bg-green-600 dark:bg-green-500 text-white" : ""}
                      >
                        {betaReadiness.ready ? "All clear" : `${betaReadiness.controls.filter((c) => !c.ok).length} failing`}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Critical security and operational controls required before onboarding beta users
                    {betaReadiness?.checkedAt && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · Last checked {new Date(betaReadiness.checkedAt).toLocaleTimeString()}
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                data-testid="button-beta-readiness-refresh"
                disabled={betaFetching}
                onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/ops/beta-readiness"] })}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${betaFetching ? "animate-spin" : ""}`} />
                {betaFetching ? "Checking…" : "Check now"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {betaLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="h-5 w-5 rounded-full mt-0.5 shrink-0" />
                    <div className="space-y-1 flex-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-full max-w-md" />
                    </div>
                    <Skeleton className="h-5 w-16 rounded" />
                  </div>
                ))}
              </div>
            ) : betaReadiness ? (
              <div className="space-y-2" data-testid="list-beta-controls">
                {betaReadiness.controls.map((control) => (
                  <div
                    key={control.name}
                    data-testid={`beta-control-${control.name}`}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                      control.ok
                        ? "bg-green-50 dark:bg-green-950/30"
                        : "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800"
                    }`}
                  >
                    {control.ok ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium font-mono" data-testid={`beta-control-name-${control.name}`}>
                        {control.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5" data-testid={`beta-control-desc-${control.name}`}>
                        {control.description}
                      </p>
                    </div>
                    <Badge
                      variant={control.ok ? "secondary" : "destructive"}
                      className="shrink-0 font-mono text-xs"
                      data-testid={`beta-control-value-${control.name}`}
                    >
                      {control.value}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Unable to load beta readiness status.</p>
            )}
          </CardContent>
        </Card>
      )}

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

        <Link href="/admin/gantt-pdf">
          <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-gantt-pdf">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Gantt PDF renderer
              </CardTitle>
              <CardDescription>Cached browser health, queue depth, and manual recycle</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/admin/portfolio-pdf">
          <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-portfolio-pdf">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Portfolio PDF renderer
              </CardTitle>
              <CardDescription>Availability of the Chromium pool that renders portfolio summary PDFs</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        {isSuper && (
          <Link href="/admin/transcript-backfill">
            <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-transcript-backfill">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Headphones className="h-5 w-5" />
                  Transcript backfill
                  {quietOrgsCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="ml-auto"
                      data-testid="badge-transcript-backfill-quiet-orgs"
                    >
                      {quietOrgsCount} quiet org{quietOrgsCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Cross-org alert-failure CSVs and silent-pipeline digest for quiet tenants</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        )}

        <Link href="/admin/log-email-failures">
          <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-log-email-failures">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MailWarning className="h-5 w-5" />
                Scheduled email failures
              </CardTitle>
              <CardDescription>Per-project log email schedules whose most recent send failed or had no recipients</CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/admin/support-tickets">
          <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-support-tickets">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TicketCheck className="h-5 w-5" />
                Support Tickets
              </CardTitle>
              <CardDescription>View and triage all submitted tickets globally, update status and priority, track SLA health</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <section data-testid="section-admin-background-jobs" className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold" data-testid="heading-background-jobs">Background jobs</h2>
          <p className="text-sm text-muted-foreground">
            Per-job counter health, one-shot post-deploy run history, and rolling 24h trend charts for every tracked job.
          </p>
        </div>

        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
          <Link href="/admin/job-metrics">
            <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-job-metrics">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Background job metrics
                </CardTitle>
                <CardDescription>Birthday digest delivery health and counters from other tracked jobs</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/one-shot-jobs">
            <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-one-shot-jobs">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  One-shot jobs
                </CardTitle>
                <CardDescription>Post-deploy backfills with last-completion details and one-click re-run</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          <Link href="/admin/jobs/metrics">
            <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-jobs-metrics">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Job metrics dashboard
                </CardTitle>
                <CardDescription>Rolling 24h trend charts for every tracked background job</CardDescription>
              </CardHeader>
            </Card>
          </Link>

          {/* Task #1962 — DOT pay-item refresh history + manual re-run. */}
          <Link href="/admin/jobs/dot-pay-items-refresh">
            <Card className="hover-elevate cursor-pointer transition-colors" data-testid="link-admin-dot-pay-items-refresh">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  DOT pay-item refresh
                </CardTitle>
                <CardDescription>Quarterly state DOT catalog refresh: per-agency deltas, coverage regressions, and one-click re-run</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        </div>
      </section>
      </main>
    </div>
  );
}
