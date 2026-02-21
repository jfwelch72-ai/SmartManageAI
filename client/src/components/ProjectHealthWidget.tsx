import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, TrendingUp, Shield, FileText, DollarSign, Clock, Loader2, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface HealthSnapshot {
  id: string;
  overallScore: number;
  scheduleScore: number;
  budgetScore: number;
  rfiSubmittalScore: number;
  changeOrderScore: number;
  safetyScore: number;
  createdAt: string;
}

function ScoreBar({ label, score, icon: Icon }: { label: string; score: number; icon: any }) {
  const color = score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500";
  const textColor = score >= 80 ? "text-green-600" : score >= 60 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={`text-xs font-semibold ${textColor}`}>{score}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(score, 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function ProjectHealthWidget({ projectId }: { projectId: string }) {
  const { toast } = useToast();

  const { data: snapshot, isLoading } = useQuery<HealthSnapshot | null>({
    queryKey: ["/api/project-health", projectId],
  });

  const computeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/project-health/${projectId}/compute`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Health Score Updated", description: "Project health score has been recalculated." });
      queryClient.invalidateQueries({ queryKey: ["/api/project-health", projectId] });
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
  const scoreColor = overallScore >= 80 ? "text-green-600" : overallScore >= 60 ? "text-yellow-600" : "text-red-600";
  const scoreBadge = overallScore >= 80 ? "default" : overallScore >= 60 ? "secondary" : "destructive";
  const scoreLabel = overallScore >= 80 ? "Healthy" : overallScore >= 60 ? "At Risk" : "Critical";

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
          <RefreshCw className={`h-4 w-4 ${computeMutation.isPending ? "animate-spin" : ""}`} />
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
              <div className="flex items-baseline gap-2">
                <span className={`text-4xl font-bold ${scoreColor}`} data-testid="text-overall-health-score">{overallScore}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <Badge variant={scoreBadge as any} data-testid="badge-health-status">{scoreLabel}</Badge>
            </div>

            <div className="space-y-3">
              <ScoreBar label="Schedule (25%)" score={snapshot.scheduleScore} icon={Clock} />
              <ScoreBar label="Budget (25%)" score={snapshot.budgetScore} icon={DollarSign} />
              <ScoreBar label="RFI/Submittals (20%)" score={snapshot.rfiSubmittalScore} icon={FileText} />
              <ScoreBar label="Change Orders (15%)" score={snapshot.changeOrderScore} icon={TrendingUp} />
              <ScoreBar label="Safety (15%)" score={snapshot.safetyScore} icon={Shield} />
            </div>

            <p className="text-xs text-muted-foreground text-right" data-testid="text-health-updated">
              Updated {new Date(snapshot.createdAt).toLocaleString()}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
