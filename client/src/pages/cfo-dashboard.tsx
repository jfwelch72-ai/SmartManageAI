import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, Truck, Clock, Package, AlertCircle, Wrench, Sparkles, RefreshCw, Download } from "lucide-react";
import { useLocation } from "wouter";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

interface EquipmentMetrics {
  summary: {
    total_owned_equipment: number;
    active_rentals: number;
    total_rental_cost_mtd: number;
    underutilized_count: number;
  };
  rental_vs_owned: {
    equipment_type: string;
    avg_rental_daily_rate: number;
    avg_owned_daily_rate: number;
    daily_savings: number;
    break_even_days: number;
    recommendation: string;
  }[];
  frequently_rented: {
    equipment_type: string;
    rental_count: number;
    total_rental_cost: number;
    avg_rental_duration_days: number;
    recommendation: string;
  }[];
  underutilized: {
    equipment_code: string;
    equipment_name: string;
    days_since_last_assignment: number;
    purchase_price: number;
    monthly_carrying_cost: number;
  }[];
  project_equipment_costs: {
    project_code: string;
    project_name: string;
    planned_cost: number;
    actual_cost: number;
    total_cost: number;
  }[];
  last_updated: string | null;
}

export default function CFODashboard() {
  const { user, logout, organizationName } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: profitability, isLoading } = useQuery<ProjectProfitability[]>({
    queryKey: ["/api/cfo/profitability"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER'),
  });

  const { data: equipmentMetrics, isLoading: equipmentLoading } = useQuery<EquipmentMetrics>({
    queryKey: ["/api/cfo/equipment-metrics"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER'),
  });

  const runFullAnalysis = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/ai-pm/run');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Full CFO Analysis Complete",
        description: "Profitability data and equipment metrics have been updated with AI insights.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/cfo/profitability'] });
      queryClient.invalidateQueries({ queryKey: ['/api/cfo/equipment-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/ai-insights'] });
    },
    onError: (error: any) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to run full CFO analysis. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <main className="p-8 text-center">
          <p className="text-muted-foreground">Please log in to view profitability data</p>
        </main>
      </div>
    );
  }

  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return (
      <div className="min-h-screen bg-background">
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

  const exportToCSV = () => {
    if (!profitability || profitability.length === 0) {
      toast({ title: "No Data", description: "No profitability data to export.", variant: "destructive" });
      return;
    }
    const headers = [
      "Project Code", "Project Name", "Budget", "Adjusted Budget", "Labor Cost",
      "Material Cost", "Other Expenses", "Approved COs", "Total Actual Cost",
      "Variance", "Variance %", "Status", "Projected Completion Cost", "Estimated Margin",
      "Labor Hours", "Labor Efficiency", "Material Spend Rate", "Pending COs Value"
    ];
    const rows = profitability.map(p => [
      p.project_code, `"${p.project_name}"`, p.budget, p.adjusted_budget,
      p.total_labor_cost, p.total_material_cost, p.total_other_expenses,
      p.approved_change_orders_value, p.total_actual_cost, p.variance,
      `${p.variance_percent.toFixed(1)}%`, p.status, p.projected_completion_cost,
      p.estimated_margin, p.key_metrics.labor_hours, p.key_metrics.labor_efficiency,
      p.key_metrics.material_spend_rate, p.key_metrics.pending_change_orders_value
    ]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cfo-dashboard-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export Complete", description: `Exported ${profitability.length} projects to CSV.` });
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <DollarSign className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
              CFO Dashboard
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1">
              Real-time profitability analysis across all projects
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => runFullAnalysis.mutate()}
              disabled={runFullAnalysis.isPending}
              data-testid="cfo-run-full-analysis"
            >
              {runFullAnalysis.isPending ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              <span className="hidden sm:inline">{runFullAnalysis.isPending ? 'Running...' : 'Run Full CFO Analysis'}</span>
              <span className="sm:hidden">{runFullAnalysis.isPending ? 'Running...' : 'CFO Analysis'}</span>
            </Button>
            <AIAnalysisButton
              showDropdown={true}
              variant="outline"
              size="sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={exportToCSV}
              disabled={!profitability || profitability.length === 0}
              data-testid="cfo-export-csv"
            >
              <Download className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Export CSV</span>
              <span className="sm:hidden">Export</span>
            </Button>
          </div>
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
                      onClick={() => setLocation(`/projects/${project.project_code}?from=cfo`)}
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
                      onClick={() => setLocation(`/projects/${project.project_code}?from=cfo`)}
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

          {/* Equipment Metrics Section */}
          <div className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 mt-[15px] mb-[15px]">
              <Truck className="h-6 w-6" />
              Equipment Metrics
            </h2>
            
            {equipmentLoading ? (
              <div className="grid gap-4 md:grid-cols-4">
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : equipmentMetrics && (
              <>
                {/* Equipment Summary KPIs */}
                <div className="grid gap-4 md:grid-cols-4">
                  <Card data-testid="card-owned-equipment">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-500" />
                        Owned Fleet
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{equipmentMetrics.summary.total_owned_equipment}</div>
                      <p className="text-xs text-muted-foreground mt-1">pieces of equipment</p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-active-rentals">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Clock className="h-4 w-4 text-green-500" />
                        Active Rentals
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{equipmentMetrics.summary.active_rentals}</div>
                      <p className="text-xs text-muted-foreground mt-1">currently rented</p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-rental-cost-mtd">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-primary" />
                        Rental Spend MTD
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{formatCurrency(equipmentMetrics.summary.total_rental_cost_mtd)}</div>
                      <p className="text-xs text-muted-foreground mt-1">month to date</p>
                    </CardContent>
                  </Card>

                  <Card data-testid="card-underutilized">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                        Underutilized
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{equipmentMetrics.summary.underutilized_count}</div>
                      <p className="text-xs text-muted-foreground mt-1">idle &gt;60 days</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Underutilized Equipment Alert */}
                {equipmentMetrics.underutilized.length > 0 && (
                  <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20" data-testid="card-underutilized-alert">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-500" />
                        Underutilized Equipment - Consider Redeployment
                      </CardTitle>
                      <CardDescription>
                        These owned assets have been idle for over 60 days. Consider redeploying to active projects or evaluating disposal.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {equipmentMetrics.underutilized.slice(0, 5).map((item, idx) => (
                          <div 
                            key={idx}
                            onClick={() => setLocation('/equipment')}
                            className="flex items-center justify-between p-2 bg-background rounded-md cursor-pointer hover-elevate active-elevate-2"
                            data-testid={`underutilized-${item.equipment_code}`}
                          >
                            <div>
                              <span className="font-medium text-sm">{item.equipment_code}</span>
                              <span className="text-sm text-muted-foreground ml-2">- {item.equipment_name}</span>
                              <p className="text-xs text-muted-foreground">
                                Idle {item.days_since_last_assignment} days | Carrying cost: {formatCurrency(item.monthly_carrying_cost)}/mo
                              </p>
                            </div>
                            <Badge variant="outline" className="text-yellow-600 border-yellow-600 dark:text-yellow-500 dark:border-yellow-500">
                              {formatCurrency(item.purchase_price)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Frequently Rented Equipment - ROI Recommendations */}
                {equipmentMetrics.frequently_rented.length > 0 && (
                  <Card data-testid="card-frequently-rented">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Wrench className="w-5 h-5 text-primary" />
                        Frequently Rented Equipment - Purchase Analysis
                      </CardTitle>
                      <CardDescription>
                        Equipment types with high rental frequency. Evaluate purchase vs. continued rental based on projected ROI.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {equipmentMetrics.frequently_rented.map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between p-3 bg-muted rounded-md"
                            data-testid={`frequently-rented-${idx}`}
                          >
                            <div className="flex-1">
                              <span className="font-medium text-sm">{item.equipment_type}</span>
                              <p className="text-xs text-muted-foreground mt-1">
                                {item.rental_count} rentals | {Math.round(item.avg_rental_duration_days)} avg days | Total: {formatCurrency(item.total_rental_cost)}
                              </p>
                              <p className="text-xs mt-1">
                                {item.recommendation.startsWith('REVIEW') ? (
                                  <span className="text-red-600 dark:text-red-400">{item.recommendation}</span>
                                ) : item.recommendation.startsWith('MONITOR') ? (
                                  <span className="text-yellow-600 dark:text-yellow-400">{item.recommendation}</span>
                                ) : (
                                  <span className="text-muted-foreground">{item.recommendation}</span>
                                )}
                              </p>
                            </div>
                            {item.recommendation.startsWith('REVIEW') && (
                              <Badge variant="destructive">Review</Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Rental vs Owned Comparison */}
                {equipmentMetrics.rental_vs_owned.length > 0 && (
                  <Card data-testid="card-rental-vs-owned">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-green-500" />
                        Rental vs Owned Rate Comparison
                      </CardTitle>
                      <CardDescription>
                        Compare daily rental rates vs owned equipment operating costs. Break-even assumes daily usage.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {equipmentMetrics.rental_vs_owned.slice(0, 5).map((item, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between p-3 bg-muted rounded-md"
                            data-testid={`rental-vs-owned-${idx}`}
                          >
                            <div className="flex-1">
                              <span className="font-medium text-sm">{item.equipment_type}</span>
                              <p className="text-xs text-muted-foreground mt-1">
                                Rental: {formatCurrency(item.avg_rental_daily_rate)}/day | Owned: {formatCurrency(item.avg_owned_daily_rate)}/day
                                {item.break_even_days > 0 && ` | Break-even: ${item.break_even_days} days`}
                              </p>
                              <p className="text-xs mt-1">
                                {item.recommendation.startsWith('EVALUATE') ? (
                                  <span className="text-green-600 dark:text-green-400">{item.recommendation}</span>
                                ) : item.recommendation.startsWith('MONITOR') ? (
                                  <span className="text-yellow-600 dark:text-yellow-400">{item.recommendation}</span>
                                ) : item.recommendation.startsWith('RENT') ? (
                                  <span className="text-blue-600 dark:text-blue-400">{item.recommendation}</span>
                                ) : (
                                  <span className="text-muted-foreground">{item.recommendation}</span>
                                )}
                              </p>
                            </div>
                            {item.daily_savings > 0 && (
                              <Badge className="bg-green-500 hover:bg-green-600">
                                {formatCurrency(item.daily_savings)}/day savings
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Last Updated */}
                {equipmentMetrics.last_updated && (
                  <p className="text-xs text-muted-foreground text-right">
                    Equipment data from AI analysis: {new Date(equipmentMetrics.last_updated).toLocaleString()}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="space-y-4 pt-[10px] pb-[10px]">
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
                        onClick={() => setLocation(`/projects/${project.project_code}?from=cfo`)}
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
                  <p className="text-muted-foreground mb-4">
                    No profitability data available. Run the full CFO analysis to calculate project profitability and generate AI insights.
                  </p>
                  <Button
                    variant="default"
                    onClick={() => runFullAnalysis.mutate()}
                    disabled={runFullAnalysis.isPending}
                    data-testid="cfo-empty-state-run-analysis"
                  >
                    {runFullAnalysis.isPending ? (
                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {runFullAnalysis.isPending ? 'Running Analysis...' : 'Run Full CFO Analysis'}
                  </Button>
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
