import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, AlertTriangle, DollarSign, TrendingUp, CheckCircle2, Clock, BarChart3 } from "lucide-react";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";

interface AIDashboardPanelProps {
  className?: string;
}

export function AIDashboardPanel({ className = "" }: AIDashboardPanelProps) {
  const { data: aiSummary, isLoading: loadingSummary } = useQuery<any>({
    queryKey: ['/api/ai-insights/dashboard-summary'],
  });

  const { data: profitability, isLoading: loadingProfit } = useQuery<any>({
    queryKey: ['/api/cfo/profitability'],
  });

  const { data: aiTasks, isLoading: loadingTasks } = useQuery<any>({
    queryKey: ['/api/ai-pm/tasks'],
  });

  const pendingTasks = aiTasks?.filter?.((t: any) => t.status === "PENDING")?.length || 0;
  const inProgressTasks = aiTasks?.filter?.((t: any) => t.status === "IN_PROGRESS")?.length || 0;
  const urgentTasks = aiTasks?.filter?.((t: any) => t.priority === "CRITICAL" || t.priority === "HIGH")?.length || 0;

  const totalRevenue = profitability?.projects?.reduce?.((sum: number, p: any) => sum + (p.adjustedBudget || 0), 0) || 0;
  const totalCosts = profitability?.projects?.reduce?.((sum: number, p: any) => sum + (p.actualCost || 0), 0) || 0;
  const overBudgetCount = profitability?.projects?.filter?.((p: any) => (p.variancePercent || 0) < -5)?.length || 0;

  const isLoading = loadingSummary || loadingProfit || loadingTasks;

  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${className}`} data-testid="ai-dashboard-panel">
      <Card data-testid="card-ai-pm-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Project Manager
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading AI insights...</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold" data-testid="text-pending-tasks">{pendingTasks}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold" data-testid="text-in-progress-tasks">{inProgressTasks}</p>
                  <p className="text-xs text-muted-foreground">In Progress</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold text-destructive" data-testid="text-urgent-tasks">{urgentTasks}</p>
                  <p className="text-xs text-muted-foreground">Urgent</p>
                </div>
              </div>
              {aiSummary?.latestAnalysis && (
                <p className="text-xs text-muted-foreground line-clamp-2" data-testid="text-latest-analysis">
                  {aiSummary.latestAnalysis}
                </p>
              )}
              <AIAnalysisButton module="ALL" variant="outline" size="sm" className="w-full" data-testid="button-run-ai-pm-analysis" />
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-cfo-summary">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            Financial Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading financial data...</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-sm font-bold" data-testid="text-total-revenue">
                    ${(totalRevenue / 1000000).toFixed(1)}M
                  </p>
                  <p className="text-xs text-muted-foreground">Budget</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className="text-sm font-bold" data-testid="text-total-costs">
                    ${(totalCosts / 1000000).toFixed(1)}M
                  </p>
                  <p className="text-xs text-muted-foreground">Actual</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-muted/50">
                  <p className={`text-sm font-bold ${overBudgetCount > 0 ? 'text-destructive' : 'text-green-600'}`} data-testid="text-over-budget">
                    {overBudgetCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Over Budget</p>
                </div>
              </div>
              {profitability?.alerts?.length > 0 && (
                <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs" data-testid="text-budget-alert">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span className="line-clamp-2">{profitability.alerts[0].message || "Budget alerts detected"}</span>
                </div>
              )}
              <AIAnalysisButton module="COSTS" variant="outline" size="sm" className="w-full" data-testid="button-run-cfo-analysis" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
