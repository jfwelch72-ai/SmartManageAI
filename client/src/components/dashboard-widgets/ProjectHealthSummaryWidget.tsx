import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeartPulse, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

interface ProjectHealthEntry {
  project_id: string;
  overall_score: number;
  schedule_score: number;
  budget_score: number;
  snapshot_date: string;
  project_name: string;
}

function getScoreColor(score: number): string {
  if (score >= 75) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getScoreBg(score: number): string {
  if (score >= 75) return "bg-green-500/10 border-green-200 dark:border-green-800/50";
  if (score >= 50) return "bg-amber-500/10 border-amber-200 dark:border-amber-800/50";
  return "bg-red-500/10 border-red-200 dark:border-red-800/50";
}

function getScoreBarColor(score: number): string {
  if (score >= 75) return "bg-green-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 75) return "Healthy";
  if (score >= 50) return "At Risk";
  return "Critical";
}

export function ProjectHealthSummaryWidget() {
  const { data, isLoading } = useQuery<ProjectHealthEntry[]>({
    queryKey: ["/api/project-health/overview"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="project-health-summary-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-40 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-muted/50 p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 bg-muted rounded" />
                <div className="h-2 w-full bg-muted rounded" />
              </div>
              <div className="h-6 w-10 bg-muted rounded" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const projects = data || [];
  const green = projects.filter(p => (p.overall_score || 0) >= 75);
  const yellow = projects.filter(p => (p.overall_score || 0) >= 50 && (p.overall_score || 0) < 75);
  const red = projects.filter(p => (p.overall_score || 0) < 50);
  const avgScore = projects.length > 0
    ? Math.round(projects.reduce((sum, p) => sum + (p.overall_score || 0), 0) / projects.length)
    : 0;

  return (
    <Card data-testid="project-health-summary-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Project Health</CardTitle>
          </div>
          {projects.length > 0 && (
            <span className={cn("text-xs font-semibold", getScoreColor(avgScore))} data-testid="avg-health-score">
              Avg {avgScore}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {projects.length === 0 ? (
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
                      className={cn("flex items-center gap-3 rounded-lg border p-2.5", getScoreBg(score))}
                      data-testid={`health-project-${p.project_id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{p.project_name}</p>
                        <div className="mt-1 w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", getScoreBarColor(score))}
                            style={{ width: `${score}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={cn("text-sm font-bold tabular-nums", getScoreColor(score))}>{score}</span>
                        <p className={cn("text-[10px]", getScoreColor(score))}>{getScoreLabel(score)}</p>
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
