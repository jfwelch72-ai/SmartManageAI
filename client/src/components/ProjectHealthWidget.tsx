import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  DollarSign,
  Calendar,
  Loader2,
  RefreshCw,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface HealthSnapshot {
  id: string;
  overallScore: number;
  scheduleScore: number;
  budgetScore: number;
  costScore: number | null;
  rfiSubmittalScore: number;
  changeOrderScore: number;
  safetyScore: number;
  complianceScore: number | null;
  trendDirection: string | null;
  aiExplanation: string | null;
  createdAt: string;
  snapshotDate: string;
  breakdown?: {
    compliance?: {
      expiredBonds?: number;
      expiringSoonBonds?: number;
      nonCompliantMaterialCerts?: number;
      expiredMaterialCerts?: number;
      idrWorkdaysExpected?: number;
      idrDaysWithReport?: number;
      missingIdrDays?: number;
      trackingIdr?: boolean;
      dbeGoalCount?: number;
      dbeGoalsWithShortfall?: number;
      dbeShortfallDollars?: number;
    };
  } | null;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getScoreBarColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

function ScoreBar({ label, score, icon: Icon, weight }: { label: string; score: number; icon: any; weight: string }) {
  return (
    <div className="flex items-center gap-3" data-testid={`subscore-${label.toLowerCase().replace(/[\s/]/g, "-")}`}>
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">
            {label} <span className="text-[10px]">({weight})</span>
          </span>
          <span className={cn("text-xs font-semibold", getScoreColor(score))}>{score}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", getScoreBarColor(score))}
            style={{ width: `${Math.min(score, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SparklineChart({ data }: { data: number[] }) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 100);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const padding = 2;

  const points = data.map((val, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  const lastScore = data[data.length - 1];
  const strokeColor = lastScore >= 80 ? "#22c55e" : lastScore >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={width} height={height} className="inline-block" data-testid="sparkline-health-trend">
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ProjectHealthWidget({ projectId }: { projectId: string }) {
  const { toast } = useToast();

  const { data: snapshot, isLoading } = useQuery<HealthSnapshot | null>({
    queryKey: ["/api/project-health", projectId],
  });

  const { data: history = [] } = useQuery<HealthSnapshot[]>({
    queryKey: ["/api/project-health", projectId, "history"],
    queryFn: () =>
      apiRequest("GET", `/api/project-health/${projectId}/history?limit=14`).then((r) => r.json()),
    enabled: !!snapshot,
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/project-health/${projectId}/compute`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Health Score Updated", description: "Project health score has been recalculated." });
      queryClient.invalidateQueries({ queryKey: ["/api/project-health", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/project-health/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/project-health-portfolio/summary"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const overallScore = snapshot?.overallScore ?? 0;
  const costScore = snapshot?.costScore ?? snapshot?.budgetScore ?? 0;
  const scheduleScore = snapshot?.scheduleScore ?? 0;
  const safetyScore = snapshot?.safetyScore ?? 0;
  const complianceScore = snapshot?.complianceScore ?? null;
  const hasCompliance = complianceScore !== null && complianceScore !== undefined;
  const trendDirection = snapshot?.trendDirection;
  const sparklineData = [...history].reverse().map((s) => s.overallScore);

  const trendIcon =
    trendDirection === "improving" ? (
      <TrendingUp className="w-4 h-4 text-green-500" />
    ) : trendDirection === "declining" ? (
      <TrendingDown className="w-4 h-4 text-red-500" />
    ) : (
      <Minus className="w-4 h-4 text-muted-foreground" />
    );

  return (
    <Card data-testid="card-project-health">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Project Health Score</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => computeMutation.mutate()}
          disabled={computeMutation.isPending}
          data-testid="button-recompute-health"
        >
          <RefreshCw className={cn("h-4 w-4", computeMutation.isPending && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!snapshot ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-no-health-score">No health score available yet.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => computeMutation.mutate()}
              disabled={computeMutation.isPending}
              data-testid="button-compute-initial-health"
            >
              {computeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Activity className="h-4 w-4 mr-2" />}
              Calculate Health Score
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-baseline gap-2">
                  <span className={cn("text-4xl font-bold", getScoreColor(overallScore))} data-testid="text-overall-health-score">
                    {overallScore}
                  </span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                </div>
                <div>
                  <Badge
                    variant={overallScore >= 80 ? "default" : overallScore >= 60 ? "secondary" : "destructive"}
                    data-testid="badge-health-status"
                  >
                    {getScoreLabel(overallScore)}
                  </Badge>
                  <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                    {trendIcon}
                    <span className="capitalize">{trendDirection || "stable"}</span>
                  </div>
                </div>
              </div>
              {sparklineData.length >= 2 && (
                <div className="flex flex-col items-end">
                  <SparklineChart data={sparklineData} />
                  <span className="text-[10px] text-muted-foreground mt-0.5">
                    Trend ({sparklineData.length} pts)
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <ScoreBar label="Cost Risk" score={costScore} icon={DollarSign} weight={hasCompliance ? "35%" : "40%"} />
              <ScoreBar label="Schedule Risk" score={scheduleScore} icon={Calendar} weight={hasCompliance ? "30%" : "35%"} />
              <ScoreBar label="Safety Risk" score={safetyScore} icon={Shield} weight={hasCompliance ? "20%" : "25%"} />
              {hasCompliance && (
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ScoreBar label="Compliance" score={complianceScore!} icon={ShieldCheck} weight="15%" />
                  </div>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          data-testid="button-compliance-factors"
                          aria-label="Compliance factor breakdown"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs text-xs space-y-1" data-testid="tooltip-compliance-factors">
                        <div className="font-semibold">Compliance breakdown</div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                          <span>Expired bonds</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.expiredBonds ?? 0}</span>
                          <span>Bonds expiring ≤30d</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.expiringSoonBonds ?? 0}</span>
                          <span>Non-compliant material certs</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.nonCompliantMaterialCerts ?? 0}</span>
                          <span>Expired material certs</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.expiredMaterialCerts ?? 0}</span>
                          <span>IDR workdays (last 14)</span>
                          <span className="text-right tabular-nums">
                            {snapshot?.breakdown?.compliance?.idrDaysWithReport ?? 0}
                            {snapshot?.breakdown?.compliance?.idrWorkdaysExpected != null
                              ? ` / ${snapshot.breakdown.compliance.idrWorkdaysExpected}`
                              : ""}
                          </span>
                          <span>Missing IDR workdays</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.missingIdrDays ?? 0}</span>
                          <span>DBE goals defined</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.dbeGoalCount ?? 0}</span>
                          <span>DBE goals short</span>
                          <span className="text-right tabular-nums">{snapshot?.breakdown?.compliance?.dbeGoalsWithShortfall ?? 0}</span>
                          {snapshot?.breakdown?.compliance?.dbeShortfallDollars != null && snapshot.breakdown.compliance.dbeShortfallDollars > 0 && (
                            <>
                              <span>DBE shortfall ($)</span>
                              <span className="text-right tabular-nums">
                                {snapshot.breakdown.compliance.dbeShortfallDollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            </>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            </div>

            {snapshot.aiExplanation && (
              <div
                className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground leading-relaxed"
                data-testid="text-ai-explanation"
              >
                <div className="flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                  <span>{snapshot.aiExplanation}</span>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-right" data-testid="text-health-updated">
              Updated {new Date(snapshot.createdAt).toLocaleString()}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
