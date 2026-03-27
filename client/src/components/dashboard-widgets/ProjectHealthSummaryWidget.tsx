import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HeartPulse, CheckCircle2, AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { type ProjectHealthSummaryConfig, DEFAULT_PROJECT_HEALTH_CONFIG } from "./ProjectHealthSummarySettings";
import type { WidgetComponentProps } from "./WidgetRegistry";

interface ProjectHealthEntry {
  project_id: string;
  overall_score: number;
  schedule_score: number;
  budget_score: number;
  cost_score: number | null;
  safety_score: number | null;
  trend_direction: string | null;
  ai_explanation: string | null;
  snapshot_date: string;
  project_name: string;
}

function getScoreColor(score: number, cfg: ProjectHealthSummaryConfig): string {
  if (score >= cfg.healthyThreshold) return "text-green-600 dark:text-green-400";
  if (score >= cfg.criticalThreshold) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getScoreBg(score: number, cfg: ProjectHealthSummaryConfig): string {
  if (score >= cfg.healthyThreshold) return "bg-green-500/10 border-green-200 dark:border-green-800/50";
  if (score >= cfg.criticalThreshold) return "bg-amber-500/10 border-amber-200 dark:border-amber-800/50";
  return "bg-red-500/10 border-red-200 dark:border-red-800/50";
}

function getScoreBarColor(score: number, cfg: ProjectHealthSummaryConfig): string {
  if (score >= cfg.healthyThreshold) return "bg-green-500";
  if (score >= cfg.criticalThreshold) return "bg-amber-500";
  return "bg-red-500";
}

function getScoreLabel(score: number, cfg: ProjectHealthSummaryConfig): string {
  if (score >= cfg.healthyThreshold) return "Healthy";
  if (score >= cfg.criticalThreshold) return "At Risk";
  return "Critical";
}

function TrendIcon({ direction }: { direction: string | null | undefined }) {
  if (direction === "improving") return <TrendingUp className="w-3 h-3 text-green-500" />;
  if (direction === "declining") return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

export function ProjectHealthSummaryWidget({ config }: WidgetComponentProps) {
  const cfg: ProjectHealthSummaryConfig = { ...DEFAULT_PROJECT_HEALTH_CONFIG, ...(config as Partial<ProjectHealthSummaryConfig>) };

  const { data, isLoading, isError } = useQuery<ProjectHealthEntry[]>({
    queryKey: ["/api/project-health/overview"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="project-health-summary-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-3 gap-2 mb-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-2 text-center space-y-1.5">
                <Skeleton className="h-7 w-8 mx-auto" />
                <Skeleton className="h-2.5 w-12 mx-auto" />
              </div>
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-2.5 flex items-center gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-1.5 w-full" />
              </div>
              <div className="text-right space-y-1 shrink-0">
                <Skeleton className="h-5 w-8" />
                <Skeleton className="h-2.5 w-12" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="project-health-summary-error">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load project health data.</p>
        </CardContent>
      </Card>
    );
  }

  const allProjects = data || [];
  const projects = cfg.showOnlyCritical
    ? allProjects.filter(p => (p.overall_score || 0) < cfg.healthyThreshold)
    : allProjects;

  const green = allProjects.filter(p => (p.overall_score || 0) >= cfg.healthyThreshold);
  const yellow = allProjects.filter(p => (p.overall_score || 0) >= cfg.criticalThreshold && (p.overall_score || 0) < cfg.healthyThreshold);
  const red = allProjects.filter(p => (p.overall_score || 0) < cfg.criticalThreshold);
  const declining = allProjects.filter(p => p.trend_direction === "declining");
  const avgScore = allProjects.length > 0
    ? Math.round(allProjects.reduce((sum, p) => sum + (p.overall_score || 0), 0) / allProjects.length)
    : 0;

  return (
    <Card data-testid="project-health-summary-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Portfolio Health</CardTitle>
          </div>
          {allProjects.length > 0 && (
            <span className={cn("text-xs font-semibold", getScoreColor(avgScore, cfg))} data-testid="avg-health-score">
              Avg {avgScore}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {allProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="project-health-empty">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No health snapshots yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Compute a health score on any project to see it here</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: "Healthy", count: green.length, color: "text-green-600 dark:text-green-400", bg: "bg-green-500/10" },
                { label: "At Risk", count: yellow.length, color: "text-amber-600 dark:text-amber-500", bg: "bg-amber-500/10" },
                { label: "Critical", count: red.length, color: "text-red-600 dark:text-red-400", bg: "bg-red-500/10" },
              ].map(tier => (
                <div key={tier.label} className={cn("rounded-lg p-2 text-center", tier.bg)} data-testid={`health-tier-${tier.label.toLowerCase()}`}>
                  <p className={cn("text-xl font-bold tabular-nums", tier.color)}>{tier.count}</p>
                  <p className="text-[10px] text-muted-foreground">{tier.label}</p>
                </div>
              ))}
            </div>

            {declining.length > 0 && (
              <div className="rounded-lg bg-red-500/5 border border-red-200 dark:border-red-800/50 p-2 mb-1" data-testid="declining-projects-alert">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingDown className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                    {declining.length} project{declining.length > 1 ? "s" : ""} declining
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {declining.slice(0, 3).map(p => p.project_name).join(", ")}
                  {declining.length > 3 && ` +${declining.length - 3} more`}
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {projects
                .slice()
                .sort((a, b) => (a.overall_score || 0) - (b.overall_score || 0))
                .slice(0, 5)
                .map(p => {
                  const score = p.overall_score || 0;
                  return (
                    <div
                      key={p.project_id}
                      className={cn("flex items-center gap-3 rounded-lg border p-2.5", getScoreBg(score, cfg))}
                      data-testid={`health-project-${p.project_id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium truncate">{p.project_name}</p>
                          <TrendIcon direction={p.trend_direction} />
                        </div>
                        <div className="mt-1 w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", getScoreBarColor(score, cfg))}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn("text-sm font-bold tabular-nums", getScoreColor(score, cfg))}>{score}</span>
                        <p className={cn("text-[10px]", getScoreColor(score, cfg))}>{getScoreLabel(score, cfg)}</p>
                      </div>
                    </div>
                  );
                })}
            </div>

            <Link href="/projects" className="block text-center text-xs text-muted-foreground hover:text-foreground transition-colors mt-1" data-testid="link-view-all-projects">
              View all projects
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
