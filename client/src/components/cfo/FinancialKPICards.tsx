import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle } from "lucide-react";
import type { ProjectProfitability } from "./types";

interface FinancialKPICardsProps {
  profitability: ProjectProfitability[];
  formatCurrency: (amount: number) => string;
  onProjectClick: (projectCode: string) => void;
}

export function FinancialKPICards({ profitability, formatCurrency, onProjectClick }: FinancialKPICardsProps) {
  const totalBudget = profitability.reduce((sum, p) => sum + p.adjusted_budget, 0);
  const totalActualCost = profitability.reduce((sum, p) => sum + p.total_actual_cost, 0);
  const totalVariance = totalBudget - totalActualCost;
  const overallVariancePercent = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0;

  const atRiskProjects = profitability.filter(p => p.status === 'MAJOR_RISK');
  const concernProjects = profitability.filter(p => p.status === 'MINOR_CONCERN');

  const projectsMissingBudget = profitability.filter(p => {
    const budgetNum = Number(p.adjusted_budget);
    return p.adjusted_budget == null || isNaN(budgetNum) || budgetNum <= 0;
  });

  const projectsWithDrawDateAlerts = profitability
    .filter(p => p.billingUrgency === 'CRITICAL' || p.billingUrgency === 'HIGH')
    .sort((a, b) => {
      if (a.billingUrgency === 'CRITICAL' && b.billingUrgency !== 'CRITICAL') return -1;
      if (a.billingUrgency !== 'CRITICAL' && b.billingUrgency === 'CRITICAL') return 1;
      return (a.daysUntilDraw || 999) - (b.daysUntilDraw || 999);
    });

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalBudget)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Actual Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalActualCost)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {totalVariance >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalVariance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(totalVariance)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overallVariancePercent >= 0 ? '+' : ''}{overallVariancePercent.toFixed(1)}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              At Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{atRiskProjects.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {concernProjects.length} with minor concerns
            </p>
          </CardContent>
        </Card>
      </div>

      {projectsWithDrawDateAlerts.length > 0 && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/20" data-testid="card-draw-date-alerts">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500" />
              {projectsWithDrawDateAlerts.length} Project{projectsWithDrawDateAlerts.length !== 1 ? 's' : ''} with Upcoming Textura Draw Date{projectsWithDrawDateAlerts.length !== 1 ? 's' : ''}
            </CardTitle>
            <CardDescription>
              These projects have Textura billing deadlines approaching. Ensure billing packages are prepared and submitted on time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {projectsWithDrawDateAlerts.map(project => (
                <div 
                  key={project.project_code}
                  onClick={() => onProjectClick(project.project_code)}
                  className={`flex items-center justify-between p-3 bg-background rounded-md cursor-pointer hover-elevate active-elevate-2 ${
                    project.billingUrgency === 'CRITICAL' ? 'border-l-4 border-l-red-500' : 'border-l-4 border-l-yellow-500'
                  }`}
                  data-testid={`draw-date-alert-${project.project_code}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{project.project_code}</span>
                      <span className="text-sm text-muted-foreground">- {project.project_name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {project.drawDayOfMonth ? (
                        <>
                          Recurring Draw: {project.drawDayOfMonth}{project.drawDayOfMonth === 1 ? 'st' : project.drawDayOfMonth === 2 ? 'nd' : project.drawDayOfMonth === 3 ? 'rd' : 'th'} of each month
                          {project.texturaDrawDate && <span className="ml-2 text-yellow-600 dark:text-yellow-500">(Override: {new Date(project.texturaDrawDate).toLocaleDateString()})</span>}
                        </>
                      ) : (
                        <>Draw Date: {project.texturaDrawDate ? new Date(project.texturaDrawDate).toLocaleDateString() : 'N/A'}</>
                      )}
                      {project.daysUntilDraw !== null && (
                        <span className="ml-2 font-medium">
                          ({project.daysUntilDraw} day{project.daysUntilDraw !== 1 ? 's' : ''} remaining)
                        </span>
                      )}
                    </p>
                  </div>
                  {project.billingUrgency === 'CRITICAL' ? (
                    <Badge variant="destructive" data-testid={`badge-urgency-${project.project_code}`}>
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      CRITICAL
                    </Badge>
                  ) : (
                    <Badge className="bg-yellow-500 hover:bg-yellow-600" data-testid={`badge-urgency-${project.project_code}`}>
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      HIGH
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {projectsMissingBudget.length > 0 && (
        <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 mt-[15px] mb-[15px]" data-testid="card-missing-budget-warning">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
              {projectsMissingBudget.length} Project{projectsMissingBudget.length !== 1 ? 's' : ''} Missing Budget Data
            </CardTitle>
            <CardDescription>
              These projects have no budget entered. AI analysis and profitability tracking are incomplete without budget data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {projectsMissingBudget.map(project => (
                <div 
                  key={project.project_code}
                  onClick={() => onProjectClick(project.project_code)}
                  className="flex items-center justify-between p-2 bg-background rounded-md cursor-pointer hover-elevate active-elevate-2"
                  data-testid={`missing-budget-${project.project_code}`}
                >
                  <div>
                    <span className="font-medium text-sm">{project.project_code}</span>
                    <span className="text-sm text-muted-foreground ml-2">- {project.project_name}</span>
                  </div>
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                    <DollarSign className="w-3 h-3 mr-1" />
                    No Budget
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
