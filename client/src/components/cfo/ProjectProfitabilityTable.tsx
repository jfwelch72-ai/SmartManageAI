import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, AlertTriangle, Sparkles, RefreshCw, Shield, Target } from "lucide-react";
import type { ProjectProfitability } from "./types";

interface ProjectProfitabilityTableProps {
  profitability: ProjectProfitability[] | undefined;
  formatCurrency: (amount: number) => string;
  onProjectClick: (projectCode: string) => void;
  onRunAnalysis: () => void;
  isAnalysisPending: boolean;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ON_BUDGET':
      return <Badge className="bg-green-500 hover:bg-green-600">On Budget</Badge>;
    case 'MINOR_CONCERN':
      return <Badge className="bg-yellow-500 hover:bg-yellow-600">Minor Concern</Badge>;
    case 'MAJOR_RISK':
      return <Badge variant="destructive">Major Risk</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function ProjectProfitabilityTable({
  profitability,
  formatCurrency,
  onProjectClick,
  onRunAnalysis,
  isAnalysisPending,
}: ProjectProfitabilityTableProps) {
  return (
    <div className="space-y-4 pt-[10px] pb-[10px]">
      <h2 className="text-2xl font-bold">Project Profitability</h2>

      {profitability && profitability.length > 0 ? (
        <div className="space-y-3">
          {profitability
            .sort((a, b) => {
              const aBudgetNum = Number(a.adjusted_budget);
              const bBudgetNum = Number(b.adjusted_budget);
              const aMissingBudget = a.adjusted_budget == null || isNaN(aBudgetNum) || aBudgetNum <= 0;
              const bMissingBudget = b.adjusted_budget == null || isNaN(bBudgetNum) || bBudgetNum <= 0;
              
              if (aMissingBudget && !bMissingBudget) return -1;
              if (!aMissingBudget && bMissingBudget) return 1;
              
              const statusOrder = { 'MAJOR_RISK': 0, 'MINOR_CONCERN': 1, 'ON_BUDGET': 2 };
              return statusOrder[a.status] - statusOrder[b.status];
            })
            .map(project => {
              const budgetNum = Number(project.adjusted_budget);
              const hasBudget = project.adjusted_budget != null && !isNaN(budgetNum) && budgetNum > 0;
              return (
                <Card 
                  key={project.project_code}
                  onClick={() => onProjectClick(project.project_code)}
                  className={`cursor-pointer hover-elevate active-elevate-2 ${!hasBudget ? 'border-yellow-500' : ''}`}
                  data-testid={`card-project-${project.project_code}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          {project.project_code} - {project.project_name}
                          {!hasBudget && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                              <DollarSign className="w-3 h-3 mr-1" />
                              No Budget
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {hasBudget ? (
                            <>
                              Budget: {formatCurrency(project.adjusted_budget)} | 
                              Actual: {formatCurrency(project.total_actual_cost)} | 
                              Variance: {formatCurrency(project.variance)} ({project.variance_percent.toFixed(1)}%)
                            </>
                          ) : (
                            <span className="text-yellow-600 dark:text-yellow-500">
                              Budget data required for profitability tracking
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      {getStatusBadge(project.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Labor</p>
                        <p className="font-semibold">{formatCurrency(project.total_labor_cost)}</p>
                        <p className="text-xs text-muted-foreground">{project.key_metrics.labor_efficiency}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Materials</p>
                        <p className="font-semibold">{formatCurrency(project.total_material_cost)}</p>
                        <p className="text-xs text-muted-foreground">{project.key_metrics.material_spend_rate}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground flex items-center gap-1">
                          <Shield className="h-3 w-3 text-indigo-500" />
                          Committed
                        </p>
                        <p className="font-semibold">{formatCurrency(project.committed_cost || 0)}</p>
                        <p className="text-xs text-muted-foreground">POs + Subs</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground flex items-center gap-1">
                          <Target className="h-3 w-3 text-purple-500" />
                          Forecast Final
                        </p>
                        <p className={`font-semibold ${(project.forecast_final_cost || 0) > project.adjusted_budget ? 'text-red-500' : ''}`}>
                          {formatCurrency(project.forecast_final_cost || 0)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Projected Cost</p>
                        <p className="font-semibold">{formatCurrency(project.projected_completion_cost)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Est. Margin</p>
                        <p className={`font-semibold ${project.estimated_margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {formatCurrency(project.estimated_margin)}
                        </p>
                      </div>
                    </div>
                    {project.key_metrics.pending_change_orders_value > 0 && (
                      <div className="mt-4 p-3 bg-muted rounded-md">
                        <p className="text-sm">
                          <AlertTriangle className="h-4 w-4 inline mr-1 text-yellow-500" />
                          Pending Change Orders: {formatCurrency(project.key_metrics.pending_change_orders_value)}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              No profitability data available. Run the full CFO analysis to calculate project profitability and generate AI insights.
            </p>
            <Button
              variant="default"
              onClick={onRunAnalysis}
              disabled={isAnalysisPending}
              data-testid="cfo-empty-state-run-analysis"
            >
              {isAnalysisPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              {isAnalysisPending ? 'Running Analysis...' : 'Run Full CFO Analysis'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
