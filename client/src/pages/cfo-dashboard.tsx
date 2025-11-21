import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import AppHeader from "@/components/AppHeader";

interface ProjectProfitability {
  project_code: string;
  project_name: string;
  budget: number;
  total_labor_cost: number;
  total_material_cost: number;
  total_other_expenses: number;
  approved_change_orders_value: number;
  adjusted_budget: number;
  total_actual_cost: number;
  variance: number;
  variance_percent: number;
  status: 'ON_BUDGET' | 'MINOR_CONCERN' | 'MAJOR_RISK';
  projected_completion_cost: number;
  estimated_margin: number;
  texturaDrawDate: string | null;
  drawDayOfMonth: number | null;
  billingUrgency: 'CRITICAL' | 'HIGH' | null;
  daysUntilDraw: number | null;
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
  };
}

export default function CFODashboard() {
  const { user, logout } = useAuth();
  const [, setLocation] = useLocation();

  const { data: profitability, isLoading } = useQuery<ProjectProfitability[]>({
    queryKey: ["/api/cfo/profitability"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER'),
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName="Guest"
          userRole=""
          onLogout={logout}
        />
        <main className="p-8 text-center">
          <p className="text-muted-foreground">Please log in to view profitability data</p>
        </main>
      </div>
    );
  }

  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user.firstName || ""} ${user.lastName || ""}`.trim() || "User"}
          userRole={user.role || ""}
          onLogout={logout}
        />
        <main className="p-8 text-center">
          <p className="text-muted-foreground">Admin or Manager access required</p>
        </main>
      </div>
    );
  }

  const totalBudget = profitability?.reduce((sum, p) => sum + p.adjusted_budget, 0) || 0;
  const totalActualCost = profitability?.reduce((sum, p) => sum + p.total_actual_cost, 0) || 0;
  const totalVariance = totalBudget - totalActualCost;
  const overallVariancePercent = totalBudget > 0 ? (totalVariance / totalBudget) * 100 : 0;

  const atRiskProjects = profitability?.filter(p => p.status === 'MAJOR_RISK') || [];
  const concernProjects = profitability?.filter(p => p.status === 'MINOR_CONCERN') || [];
  const onBudgetProjects = profitability?.filter(p => p.status === 'ON_BUDGET') || [];
  
  // Identify projects with missing budget data (adjusted_budget = 0, null, undefined, or negative)
  const projectsMissingBudget = profitability?.filter(p => {
    const budgetNum = Number(p.adjusted_budget);
    return p.adjusted_budget == null || isNaN(budgetNum) || budgetNum <= 0;
  }) || [];

  // Identify projects with upcoming Textura draw dates
  const projectsWithDrawDateAlerts = profitability?.filter(p => 
    p.billingUrgency === 'CRITICAL' || p.billingUrgency === 'HIGH'
  ).sort((a, b) => {
    // Sort CRITICAL first, then by days until draw
    if (a.billingUrgency === 'CRITICAL' && b.billingUrgency !== 'CRITICAL') return -1;
    if (a.billingUrgency !== 'CRITICAL' && b.billingUrgency === 'CRITICAL') return 1;
    return (a.daysUntilDraw || 999) - (b.daysUntilDraw || 999);
  }) || [];

  const getStatusBadge = (status: string) => {
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
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user.firstName || ""} ${user.lastName || ""}`.trim() || "User"}
        userRole={user.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <DollarSign className="h-8 w-8 text-primary" />
            CFO Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time profitability analysis across all projects
          </p>
        </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        </div>
      ) : (
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

          {/* Textura Draw Date Alerts */}
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
                      onClick={() => setLocation(`/projects/${project.project_code}`)}
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

          {/* Projects Missing Budget Data Warning */}
          {projectsMissingBudget.length > 0 && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-missing-budget-warning">
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
                      onClick={() => setLocation(`/projects/${project.project_code}`)}
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

          <div className="space-y-4">
            <h2 className="text-2xl font-bold">Project Profitability</h2>

            {profitability && profitability.length > 0 ? (
              <div className="space-y-3">
                {profitability
                  .sort((a, b) => {
                    // Sort: Missing budget first, then by status
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
                        onClick={() => setLocation(`/projects/${project.project_code}`)}
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
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
                  <p className="text-muted-foreground">
                    No profitability data available. Run AI analysis to generate insights.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
      </main>
    </div>
  );
}
