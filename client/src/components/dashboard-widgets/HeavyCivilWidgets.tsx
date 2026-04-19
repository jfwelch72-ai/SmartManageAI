import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Award,
  Truck,
  ClipboardCheck,
  Flag,
  AlertTriangle,
  Lock,
  AlertCircle,
  RefreshCw,
  Calendar,
  Flame,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { useFeatureFlags } from "@/hooks/use-feature-flags";

function fmtMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${(a / 1_000).toFixed(1)}K`;
  return `$${a.toFixed(0)}`;
}

function FlagDisabledCard({ title, icon: Icon, message, testId }: {
  title: string;
  icon: typeof Lock;
  message: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-sm text-muted-foreground text-center py-4">{message}</p>
      </CardContent>
    </Card>
  );
}

function LoadingCard({ testId }: { testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2 px-4 pt-4"><Skeleton className="h-4 w-32" /></CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  );
}

function ErrorCard({ onRetry, testId }: { onRetry: () => void; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
        <AlertCircle className="w-6 h-6 text-destructive mb-2" />
        <p className="text-sm text-muted-foreground">Failed to load data.</p>
        <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-retry-widget">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 1) DBE PARTICIPATION WIDGET
// ============================================================

interface DbeProgress {
  projectsWithGoals: number;
  totalGoals: number;
  avgGoalPercent: number;
  totalGoalDollars: number;
  totalActualPaidDollars?: number;
  totalActualVsGoalPercent?: number;
  breakdown: Array<{
    certificationType: string;
    avgGoalPercent: number;
    totalGoalDollars: number;
    projectCount: number;
    actualPaidDollars?: number;
    actualVsGoalPercent?: number;
  }>;
}

export function DBEParticipationWidget() {
  const hasPermission = useFeaturePermission("canViewDbeGoals");
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = isEnabled("DBE_TRACKING");
  const enabled = hasPermission && flagOn;

  const { data, isLoading, isError, refetch } = useQuery<DbeProgress>({
    queryKey: ["/api/dashboard/heavy-civil/dbe-progress"],
    enabled,
    refetchInterval: 300000,
  });

  if (!flagsLoading && !flagOn) {
    return <FlagDisabledCard title="DBE Participation" icon={Lock} message="DBE tracking is not enabled for this organization." testId="dbe-widget-flag-off" />;
  }
  if (!hasPermission) {
    return <FlagDisabledCard title="DBE Participation" icon={Lock} message="You don't have permission to view DBE goals." testId="dbe-widget-no-permission" />;
  }
  if (isLoading || flagsLoading) return <LoadingCard testId="dbe-widget-loading" />;
  if (isError) return <ErrorCard onRetry={() => refetch()} testId="dbe-widget-error" />;

  const d = data ?? { projectsWithGoals: 0, totalGoals: 0, avgGoalPercent: 0, totalGoalDollars: 0, totalActualPaidDollars: 0, totalActualVsGoalPercent: 0, breakdown: [] };
  const isEmpty = d.totalGoals === 0;
  const hasActuals = (d.totalActualPaidDollars ?? 0) > 0;
  const actualPctClamped = Math.min(100, Math.max(0, d.totalActualVsGoalPercent ?? 0));
  const actualColor = actualPctClamped >= 100 ? "text-emerald-600 dark:text-emerald-400" : actualPctClamped >= 75 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="widget-dbe-participation">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500/15 to-purple-600/5 flex items-center justify-center">
            <Award className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
          </div>
          <CardTitle className="text-sm font-medium">DBE Participation</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="dbe-empty-state">
            <Award className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No DBE goals set</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Add DBE goals to projects to track participation</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-purple-500/10 p-3" data-testid="dbe-avg-goal">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Avg Goal</p>
                <p className="text-2xl font-bold tabular-nums text-purple-600 dark:text-purple-400">
                  {d.avgGoalPercent.toFixed(1)}%
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{d.projectsWithGoals} projects</p>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-3" data-testid="dbe-total-dollars">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Goal $ Total</p>
                <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtMoney(d.totalGoalDollars)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{d.totalGoals} goals</p>
              </div>
            </div>

            {hasActuals && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5" data-testid="dbe-actual-vs-goal">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground uppercase tracking-wide font-medium text-[11px]">Awarded vs Goal</span>
                  <span className={cn("font-bold tabular-nums", actualColor)} data-testid="dbe-actual-pct">
                    {actualPctClamped.toFixed(0)}%
                  </span>
                </div>
                <Progress value={actualPctClamped} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {fmtMoney(d.totalActualPaidDollars ?? 0)} awarded of {fmtMoney(d.totalGoalDollars)} goal
                </p>
              </div>
            )}

            {d.breakdown.length > 0 && (
              <div className="space-y-1.5" data-testid="dbe-breakdown">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">By Certification</p>
                {d.breakdown.slice(0, 5).map((b, i) => {
                  const actualPct = Math.min(100, Math.max(0, b.actualVsGoalPercent ?? 0));
                  const rowActualColor = actualPct >= 100
                    ? "text-emerald-600 dark:text-emerald-400"
                    : actualPct >= 75
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400";
                  return (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0" data-testid={`dbe-cert-row-${b.certificationType}`}>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{b.certificationType}</Badge>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-foreground">{b.avgGoalPercent.toFixed(1)}%</span>
                        {(b.actualPaidDollars ?? 0) > 0 ? (
                          <span className={cn("tabular-nums font-medium", rowActualColor)} data-testid={`dbe-cert-actual-${b.certificationType}`}>
                            {actualPct.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">{fmtMoney(b.totalGoalDollars)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        <div className="pt-2.5 border-t border-border/50">
          <Link href="/projects" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-dbe-projects">
            View all projects
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 2) OPEN HAUL TICKETS WIDGET
// ============================================================

interface OpenHaulTickets {
  total: number;
  pendingApproval: number;
  approved: number;
  rejected: number;
  totalQuantity: number;
  totalCost: number;
  todayCount?: number;
  todayQuantity?: number;
  weekCount?: number;
  weekQuantity?: number;
  oldestPendingDays: number;
  recentPending: Array<{
    id: string;
    ticketNumber: string;
    ticketDate: string;
    materialClass: string;
    quantity: number;
    unit: string;
    status: string;
    projectId: string;
  }>;
}

export function OpenHaulTicketsWidget() {
  const hasPermission = useFeaturePermission("canViewHaulTickets");
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = isEnabled("HAUL_TICKETS");
  const enabled = hasPermission && flagOn;

  const { data, isLoading, isError, refetch } = useQuery<OpenHaulTickets>({
    queryKey: ["/api/dashboard/heavy-civil/open-haul-tickets"],
    enabled,
    refetchInterval: 120000,
  });

  if (!flagsLoading && !flagOn) {
    return <FlagDisabledCard title="Open Haul Tickets" icon={Lock} message="Haul ticket tracking is not enabled." testId="haul-widget-flag-off" />;
  }
  if (!hasPermission) {
    return <FlagDisabledCard title="Open Haul Tickets" icon={Lock} message="You don't have permission to view haul tickets." testId="haul-widget-no-permission" />;
  }
  if (isLoading || flagsLoading) return <LoadingCard testId="haul-widget-loading" />;
  if (isError) return <ErrorCard onRetry={() => refetch()} testId="haul-widget-error" />;

  const d = data ?? { total: 0, pendingApproval: 0, approved: 0, rejected: 0, totalQuantity: 0, totalCost: 0, todayCount: 0, todayQuantity: 0, weekCount: 0, weekQuantity: 0, oldestPendingDays: 0, recentPending: [] };
  const isEmpty = d.total === 0;

  const oldAlert = d.oldestPendingDays >= 7;
  const todayQty = d.todayQuantity ?? 0;
  const weekQty = d.weekQuantity ?? 0;
  const todayCount = d.todayCount ?? 0;
  const weekCount = d.weekCount ?? 0;

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="widget-open-haul-tickets">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-600/5 flex items-center justify-center">
            <Truck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-sm font-medium">Open Haul Tickets</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="haul-empty-state">
            <Truck className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No haul tickets yet</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-amber-500/10 p-3" data-testid="haul-pending">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Pending</p>
                <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{d.pendingApproval}</p>
              </div>
              <div className="rounded-lg bg-emerald-500/10 p-3" data-testid="haul-approved">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Approved</p>
                <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{d.approved}</p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-3" data-testid="haul-rejected">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Rejected</p>
                <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">{d.rejected}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2" data-testid="haul-today-week">
              <div className="rounded-md border border-border/60 p-2" data-testid="haul-today">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Today</p>
                <p className="text-sm font-bold tabular-nums">{todayQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
                <p className="text-[10px] text-muted-foreground">{todayCount} ticket{todayCount === 1 ? "" : "s"}</p>
              </div>
              <div className="rounded-md border border-border/60 p-2" data-testid="haul-week">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Last 7 Days</p>
                <p className="text-sm font-bold tabular-nums">{weekQty.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
                <p className="text-[10px] text-muted-foreground">{weekCount} ticket{weekCount === 1 ? "" : "s"}</p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs px-1" data-testid="haul-totals">
              <span className="text-muted-foreground">Total quantity</span>
              <span className="tabular-nums">{d.totalQuantity.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
            </div>
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-muted-foreground">Total cost</span>
              <span className="tabular-nums">{fmtMoney(d.totalCost)}</span>
            </div>

            {oldAlert && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-red-500/10 text-red-700 dark:text-red-300" data-testid="haul-old-alert">
                <AlertTriangle className="w-3.5 h-3.5" />
                Oldest pending ticket: {d.oldestPendingDays} days
              </div>
            )}

            {d.recentPending.length > 0 && (
              <div className="space-y-1.5" data-testid="haul-recent-pending">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Recent Pending</p>
                {d.recentPending.slice(0, 3).map(t => (
                  <Link key={t.id} href={`/projects/${t.projectId}`} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0 hover:bg-accent/40 px-1 rounded" data-testid={`haul-ticket-row-${t.id}`}>
                    <span className="font-mono text-foreground truncate max-w-[40%]">#{t.ticketNumber}</span>
                    <span className="text-muted-foreground truncate max-w-[35%]">{t.materialClass}</span>
                    <span className="tabular-nums">{Number(t.quantity).toFixed(1)} {t.unit}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
        <div className="pt-2.5 border-t border-border/50">
          <Link href="/haul-tickets" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-haul-tickets">
            View all haul tickets
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 3) IDR SUBMISSION STREAK WIDGET
// ============================================================

interface IdrProjectStreak {
  projectId: string;
  projectName: string;
  streakDays: number;
  lastSubmittedDate: string | null;
}

interface IdrStreak {
  totalReports: number;
  last30Days: number;
  last30DaysExpected: number;
  complianceRate: number;
  streakDays: number;
  lastSubmittedDate: string | null;
  activeProjects: number;
  projectStreaks?: IdrProjectStreak[];
}

export function IDRStreakWidget() {
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = isEnabled("DAILY_INSPECTOR_REPORTS");
  const canView = useFeaturePermission("canViewInspectorReports");
  const canManage = useFeaturePermission("canManageInspectorReports");
  const canApprove = useFeaturePermission("canApproveInspectorReports");
  const hasPermission = canView || canManage || canApprove;

  const { data, isLoading, isError, refetch } = useQuery<IdrStreak>({
    queryKey: ["/api/dashboard/heavy-civil/idr-streak"],
    enabled: flagOn && hasPermission,
    refetchInterval: 300000,
  });

  if (!flagsLoading && !flagOn) {
    return <FlagDisabledCard title="IDR Submission Streak" icon={Lock} message="Daily Inspector Reports are not enabled." testId="idr-widget-flag-off" />;
  }
  if (!hasPermission) {
    return <FlagDisabledCard title="IDR Submission Streak" icon={Lock} message="You don't have permission to view inspector reports." testId="idr-widget-no-permission" />;
  }
  if (isLoading || flagsLoading) return <LoadingCard testId="idr-widget-loading" />;
  if (isError) return <ErrorCard onRetry={() => refetch()} testId="idr-widget-error" />;

  const d = data ?? { totalReports: 0, last30Days: 0, last30DaysExpected: 0, complianceRate: 0, streakDays: 0, lastSubmittedDate: null, activeProjects: 0, projectStreaks: [] as IdrProjectStreak[] };
  const topProjects = (d.projectStreaks ?? []).slice().sort((a, b) => b.streakDays - a.streakDays).slice(0, 4);
  const compClamped = Math.min(100, Math.max(0, d.complianceRate));
  const streakColor = d.streakDays >= 14 ? "text-emerald-600 dark:text-emerald-400" : d.streakDays >= 7 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  const streakBg = d.streakDays >= 14 ? "bg-emerald-500/10" : d.streakDays >= 7 ? "bg-amber-500/10" : "bg-red-500/10";

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="widget-idr-streak">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-600/5 flex items-center justify-center">
            <ClipboardCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-sm font-medium">IDR Submission Streak</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className={cn("rounded-lg p-3 flex items-center gap-3", streakBg)} data-testid="idr-streak-display">
          <Flame className={cn("w-8 h-8", streakColor)} />
          <div>
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Current Streak</p>
            <p className={cn("text-2xl font-bold tabular-nums", streakColor)}>
              {d.streakDays} {d.streakDays === 1 ? "day" : "days"}
            </p>
            {d.lastSubmittedDate && (
              <p className="text-[11px] text-muted-foreground mt-0.5">Last: {new Date(d.lastSubmittedDate).toLocaleDateString()}</p>
            )}
          </div>
        </div>

        <div className="space-y-1.5" data-testid="idr-compliance">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">30-Day Compliance</span>
            <span className="font-medium tabular-nums">{compClamped.toFixed(0)}%</span>
          </div>
          <Progress value={compClamped} className="h-2" />
          <p className="text-[11px] text-muted-foreground">
            {d.last30Days} of {d.last30DaysExpected} expected reports
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="text-xs px-1" data-testid="idr-total">
            <span className="text-muted-foreground block">Total Reports</span>
            <span className="font-bold tabular-nums">{d.totalReports}</span>
          </div>
          <div className="text-xs px-1" data-testid="idr-projects">
            <span className="text-muted-foreground block">Active Projects</span>
            <span className="font-bold tabular-nums">{d.activeProjects}</span>
          </div>
        </div>

        {topProjects.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-border/50" data-testid="idr-project-streaks">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Project Streaks</p>
            <div className="space-y-1">
              {topProjects.map((p) => {
                const c = p.streakDays >= 14 ? "text-emerald-600 dark:text-emerald-400" : p.streakDays >= 7 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
                return (
                  <Link
                    key={p.projectId}
                    href={`/projects/${p.projectId}`}
                    className="flex items-center justify-between text-xs px-1.5 py-1 rounded hover:bg-accent/50 transition-colors"
                    data-testid={`idr-project-streak-${p.projectId}`}
                  >
                    <span className="truncate flex-1 mr-2">{p.projectName}</span>
                    <span className={cn("font-bold tabular-nums shrink-0", c)}>{p.streakDays}d</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-2.5 border-t border-border/50">
          <Link href="/projects" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-idr-projects">
            View projects
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 4) BUY AMERICA STATUS WIDGET
// ============================================================

interface BuyAmericaSummary {
  total: number;
  compliant: number;
  waiver: number;
  pending: number;
  nonCompliant: number;
  compliancePercent: number;
}

export function BuyAmericaWidget() {
  const hasPermission = useFeaturePermission("canViewMaterialCertifications");
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const flagOn = isEnabled("BUY_AMERICA");
  const enabled = hasPermission && flagOn;

  const { data, isLoading, isError, refetch } = useQuery<BuyAmericaSummary>({
    queryKey: ["/api/dashboard/heavy-civil/buy-america"],
    enabled,
    refetchInterval: 300000,
  });

  if (!flagsLoading && !flagOn) {
    return <FlagDisabledCard title="Buy America Status" icon={Lock} message="Buy America tracking is not enabled." testId="ba-widget-flag-off" />;
  }
  if (!hasPermission) {
    return <FlagDisabledCard title="Buy America Status" icon={Lock} message="You don't have permission to view material certifications." testId="ba-widget-no-permission" />;
  }
  if (isLoading || flagsLoading) return <LoadingCard testId="ba-widget-loading" />;
  if (isError) return <ErrorCard onRetry={() => refetch()} testId="ba-widget-error" />;

  const d = data ?? { total: 0, compliant: 0, waiver: 0, pending: 0, nonCompliant: 0, compliancePercent: 0 };
  const isEmpty = d.total === 0;
  const pctColor = d.compliancePercent >= 90 ? "text-emerald-600 dark:text-emerald-400" : d.compliancePercent >= 70 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="widget-buy-america">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500/15 to-rose-600/5 flex items-center justify-center">
            <Flag className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
          </div>
          <CardTitle className="text-sm font-medium">Buy America Status</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="ba-empty-state">
            <Flag className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No material certifications yet</p>
          </div>
        ) : (
          <>
            <div className="text-center" data-testid="ba-compliance-pct">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Verified Compliant</p>
              <p className={cn("text-3xl font-bold tabular-nums", pctColor)}>
                {d.compliancePercent.toFixed(0)}%
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{d.compliant} of {d.total} certifications</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-emerald-500/10 p-2" data-testid="ba-compliant">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Verified</p>
                <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{d.compliant}</p>
              </div>
              <div className="rounded-lg bg-blue-500/10 p-2" data-testid="ba-waiver">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Waiver</p>
                <p className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400">{d.waiver}</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 p-2" data-testid="ba-pending">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Pending</p>
                <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{d.pending}</p>
              </div>
              <div className="rounded-lg bg-red-500/10 p-2" data-testid="ba-noncompliant">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Non-Compliant</p>
                <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{d.nonCompliant}</p>
              </div>
            </div>

            {d.nonCompliant > 0 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-md bg-red-500/10 text-red-700 dark:text-red-300" data-testid="ba-noncompliant-alert">
                <AlertTriangle className="w-3.5 h-3.5" />
                {d.nonCompliant} certification{d.nonCompliant !== 1 ? "s" : ""} flagged non-compliant
              </div>
            )}
          </>
        )}
        <div className="pt-2.5 border-t border-border/50">
          <Link href="/material-certifications" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-ba-certifications">
            View certifications
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// 5) BOND & CERTIFICATION EXPIRATIONS WIDGET
// ============================================================

interface ExpirationsResponse {
  bondsEnabled: boolean;
  dbeEnabled: boolean;
  bonds: Array<{
    id: string;
    bondNumber: string;
    bondType: string;
    suretyCompany: string;
    expirationDate: string;
    bondAmount: number;
    daysUntilExpiry: number;
  }>;
  certifications: Array<{
    id: string;
    organisationName: string;
    certificationType: string;
    certifyingAgency: string | null;
    expirationDate: string;
    daysUntilExpiry: number;
  }>;
  totals: { bondsExpiringSoon: number; certsExpiringSoon: number };
}

export function BondCertExpirationsWidget() {
  const canBonds = useFeaturePermission("canViewSuretyBonds");
  const canDbe = useFeaturePermission("canViewDbeGoals");
  const { isEnabled, isLoading: flagsLoading } = useFeatureFlags();
  const bondsFlag = isEnabled("SURETY_BONDS");
  const dbeFlag = isEnabled("DBE_TRACKING");
  const anyFlag = bondsFlag || dbeFlag;
  const anyPerm = canBonds || canDbe;
  // Only fire the API call when at least one (flag && matching permission)
  // pair is satisfied — server filters per dataset, but we avoid useless
  // requests when neither pair holds.
  const enabled = (bondsFlag && canBonds) || (dbeFlag && canDbe);

  const { data, isLoading, isError, refetch } = useQuery<ExpirationsResponse>({
    queryKey: ["/api/dashboard/heavy-civil/expirations"],
    enabled,
    refetchInterval: 600000,
  });

  if (!flagsLoading && !anyFlag) {
    return <FlagDisabledCard title="Bond & Cert Expirations" icon={Lock} message="Surety bond and DBE tracking are not enabled." testId="exp-widget-flag-off" />;
  }
  if (!anyPerm) {
    return <FlagDisabledCard title="Bond & Cert Expirations" icon={Lock} message="You don't have permission to view bonds or certifications." testId="exp-widget-no-permission" />;
  }
  if (isLoading || flagsLoading) return <LoadingCard testId="exp-widget-loading" />;
  if (isError) return <ErrorCard onRetry={() => refetch()} testId="exp-widget-error" />;

  const d = data ?? { bondsEnabled: false, dbeEnabled: false, bonds: [], certifications: [], totals: { bondsExpiringSoon: 0, certsExpiringSoon: 0 } };
  const isEmpty = d.bonds.length === 0 && d.certifications.length === 0;

  const dayBadge = (days: number) => {
    if (days <= 14) return "border-red-500 text-red-600 dark:text-red-400";
    if (days <= 30) return "border-amber-500 text-amber-600 dark:text-amber-400";
    return "border-blue-500 text-blue-600 dark:text-blue-400";
  };

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="widget-bond-cert-expirations">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500/15 to-orange-600/5 flex items-center justify-center">
            <Calendar className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
          </div>
          <CardTitle className="text-sm font-medium">Bond &amp; Cert Expirations</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="exp-empty-state">
            <ShieldCheck className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Nothing expiring in the next 90 days</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-orange-500/10 p-3" data-testid="exp-bonds-count">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Bonds</p>
                <p className="text-2xl font-bold tabular-nums text-orange-600 dark:text-orange-400">{d.totals.bondsExpiringSoon}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">expiring &lt;90 days</p>
              </div>
              <div className="rounded-lg bg-purple-500/10 p-3" data-testid="exp-certs-count">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Certifications</p>
                <p className="text-2xl font-bold tabular-nums text-purple-600 dark:text-purple-400">{d.totals.certsExpiringSoon}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">expiring &lt;90 days</p>
              </div>
            </div>

            {d.bonds.length > 0 && (
              <div className="space-y-1" data-testid="exp-bonds-list">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Bonds</p>
                {d.bonds.slice(0, 5).map(b => (
                  <Link
                    key={b.id}
                    href={`/surety-bonds?id=${b.id}`}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0 hover:bg-accent/40 px-1 rounded transition-colors"
                    data-testid={`exp-bond-${b.id}`}
                  >
                    <div className="truncate max-w-[55%]">
                      <span className="font-mono text-foreground">#{b.bondNumber}</span>
                      <span className="text-muted-foreground ml-1.5">{b.bondType}</span>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", dayBadge(b.daysUntilExpiry))}>
                      {b.daysUntilExpiry}d
                    </Badge>
                  </Link>
                ))}
              </div>
            )}

            {d.certifications.length > 0 && (
              <div className="space-y-1" data-testid="exp-certs-list">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Certifications</p>
                {d.certifications.slice(0, 5).map(c => (
                  <Link
                    key={c.id}
                    href={`/crm/organizations?certificationId=${c.id}`}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0 hover:bg-accent/40 px-1 rounded transition-colors"
                    data-testid={`exp-cert-${c.id}`}
                  >
                    <div className="truncate max-w-[55%]">
                      <span className="text-foreground">{c.organisationName}</span>
                      <span className="text-muted-foreground ml-1.5 font-mono">{c.certificationType}</span>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", dayBadge(c.daysUntilExpiry))}>
                      {c.daysUntilExpiry}d
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
        <div className="pt-2.5 border-t border-border/50 flex items-center justify-between gap-3">
          <Link href="/surety-bonds" className="flex-1 text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-exp-bonds">
            All bonds
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <Link href="/crm/organizations" className="flex-1 text-center text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-exp-certs">
            All certifications
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
