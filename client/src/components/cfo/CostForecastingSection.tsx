import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle, Target, BarChart3, Shield, Flame, Clock, Activity } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { CFOForecastingData, BudgetAlertItem, EarlyWarning } from "./types";

interface CostForecastingSectionProps {
  formatCurrency: (amount: number) => string;
  onProjectClick: (projectCode: string) => void;
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'ON_BUDGET':
      return <Badge className="bg-green-500 hover:bg-green-600 text-xs">On Budget</Badge>;
    case 'MINOR_CONCERN':
      return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-xs">Concern</Badge>;
    case 'MAJOR_RISK':
      return <Badge variant="destructive" className="text-xs">Risk</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export function CostForecastingSection({ formatCurrency, onProjectClick }: CostForecastingSectionProps) {
  const { data: forecasting, isLoading } = useQuery<CFOForecastingData>({
    queryKey: ["/api/cfo/forecasting"],
  });

  const { data: allAlerts } = useQuery<BudgetAlertItem[]>({
    queryKey: ["/api/cfo/budget-alerts"],
  });

  const { data: sCurveResponse } = useQuery<{ months: { month: string; planned: number; actual: number | null; forecast: number | null }[] }>({
    queryKey: ["/api/cfo/scurve-data"],
  });

  const sCurveData = sCurveResponse?.months || [];

  if (isLoading) {
    return (
      <div className="space-y-4 mt-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Target className="h-6 w-6" />
          Cost Forecasting
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  if (!forecasting) return null;

  const { summary, projects, early_warnings } = forecasting;
  const alerts = allAlerts || [];
  const earlyWarnings = early_warnings || [];

  function getTrendBadge(trend: string) {
    switch (trend) {
      case 'INCREASING':
        return <Badge variant="destructive" className="text-xs gap-1"><TrendingUp className="h-3 w-3" />Rising</Badge>;
      case 'DECREASING':
        return <Badge className="bg-green-500 hover:bg-green-600 text-xs gap-1"><TrendingDown className="h-3 w-3" />Falling</Badge>;
      default:
        return <Badge variant="outline" className="text-xs gap-1"><Activity className="h-3 w-3" />Stable</Badge>;
    }
  }

  return (
    <div className="space-y-4 mt-6" data-testid="cfo-forecasting-section">
      <h2 className="text-2xl font-bold flex items-center gap-2">
        <Target className="h-6 w-6 text-primary" />
        Cost Forecasting
      </h2>

      <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-6">
        <Card data-testid="card-portfolio-budget">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-blue-500" />
              Portfolio Budget
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.portfolio_budget)}</div>
            <p className="text-xs text-muted-foreground mt-1">{summary.project_count} active projects</p>
          </CardContent>
        </Card>

        <Card data-testid="card-portfolio-committed">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-500" />
              Committed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary.portfolio_committed)}</div>
            <p className="text-xs text-muted-foreground mt-1">POs + Subcontracts</p>
          </CardContent>
        </Card>

        <Card data-testid="card-portfolio-ffc">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              Forecast Final Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.portfolio_ffc > summary.portfolio_budget ? 'text-red-500' : ''}`}>
              {formatCurrency(summary.portfolio_ffc)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Actual + Remaining Committed + Open</p>
          </CardContent>
        </Card>

        <Card data-testid="card-portfolio-variance">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {summary.portfolio_variance >= 0 ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
              FFC Variance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.portfolio_variance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {formatCurrency(summary.portfolio_variance)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Budget - Forecast Final Cost</p>
          </CardContent>
        </Card>

        <Card data-testid="card-portfolio-atrisk">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              At Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.at_risk_count}</div>
            <p className="text-xs text-muted-foreground mt-1">Projects over budget</p>
          </CardContent>
        </Card>

        {summary.early_warning_count != null && summary.early_warning_count > 0 && (
          <Card data-testid="card-early-warnings-count" className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Flame className="h-4 w-4 text-amber-500" />
                Early Warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{summary.early_warning_count}</div>
              <p className="text-xs text-muted-foreground mt-1">Projects trending over</p>
            </CardContent>
          </Card>
        )}
      </div>

      {sCurveData.length > 0 && (
        <Card data-testid="card-scurve-chart">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Portfolio S-Curve: Planned vs Actual vs Forecast
            </CardTitle>
            <CardDescription>Cumulative spend over time — planned budget, actual spend, and projected forecast</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sCurveData} margin={{ top: 10, right: 30, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v: number) => {
                      if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
                      if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
                      return `$${v}`;
                    }}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    labelStyle={{ fontWeight: "bold" }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="planned"
                    name="Planned (Budget)"
                    stroke="#3b82f6"
                    fill="#3b82f680"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="actual"
                    name="Actual Spend"
                    stroke="#10b981"
                    fill="#10b98140"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    name="Forecast"
                    stroke="#a855f7"
                    fill="#a855f720"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    connectNulls={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {earlyWarnings.length > 0 && (
        <Card className="border-amber-400 dark:border-amber-700" data-testid="card-early-warnings">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Flame className="h-5 w-5 text-amber-500" />
              Cost Overrun Early Warnings ({earlyWarnings.length})
            </CardTitle>
            <CardDescription>Projects with predicted cost overruns based on burn-rate analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {earlyWarnings.map(w => (
                <div
                  key={w.project_code}
                  className="flex items-start justify-between p-3 rounded-lg border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20 cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  onClick={() => onProjectClick(w.project_code)}
                  data-testid={`warning-${w.project_code}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{w.project_code}</span>
                      <span className="text-sm text-muted-foreground">— {w.project_name}</span>
                      {getTrendBadge(w.burn_rate_trend)}
                    </div>
                    {w.warning_message && (
                      <p className="text-sm text-muted-foreground">{w.warning_message}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        Burn: {formatCurrency(w.weekly_burn_rate)}/wk
                      </span>
                      {w.weeks_until_overrun != null && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          ~{w.weeks_until_overrun} weeks to overrun
                        </span>
                      )}
                      <span>Confidence: {w.confidence_score}%</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <div className="text-lg font-bold text-red-600 dark:text-red-400">
                      {formatCurrency(w.predicted_overrun)}
                    </div>
                    <p className="text-xs text-muted-foreground">predicted overrun</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {projects.length > 0 && (
        <Card data-testid="card-forecasting-projects">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Projects by Projected Overrun
            </CardTitle>
            <CardDescription>Sorted by worst projected variance — includes AI burn-rate prediction</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Project</th>
                    <th className="text-right p-3 font-medium">Budget</th>
                    <th className="text-right p-3 font-medium">Actual</th>
                    <th className="text-right p-3 font-medium">FFC</th>
                    <th className="text-right p-3 font-medium">Variance</th>
                    <th className="text-right p-3 font-medium">Burn Rate</th>
                    <th className="text-center p-3 font-medium">Trend</th>
                    <th className="text-center p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr
                      key={p.project_code}
                      className="border-b cursor-pointer hover:bg-muted/30"
                      onClick={() => onProjectClick(p.project_code)}
                      data-testid={`row-forecast-project-${p.project_code}`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{p.project_code}</div>
                          {p.cost_prediction?.early_warning && (
                            <Flame className="h-3 w-3 text-amber-500" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{p.project_name}</div>
                      </td>
                      <td className="text-right p-3">{formatCurrency(p.budget)}</td>
                      <td className="text-right p-3">{formatCurrency(p.actual)}</td>
                      <td className="text-right p-3 font-medium">{formatCurrency(p.ffc)}</td>
                      <td className={`text-right p-3 font-medium ${p.variance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {formatCurrency(p.variance)}
                        <div className="text-xs font-normal">
                          {p.variance_percent >= 0 ? '+' : ''}{p.variance_percent.toFixed(1)}%
                        </div>
                      </td>
                      <td className="text-right p-3 text-xs">
                        {p.cost_prediction ? (
                          <>
                            <div>{formatCurrency(p.cost_prediction.weekly_burn_rate)}/wk</div>
                            {p.cost_prediction.weeks_until_overrun != null && (
                              <div className="text-amber-600 dark:text-amber-400">~{p.cost_prediction.weeks_until_overrun}w to overrun</div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="text-center p-3">
                        {p.cost_prediction ? getTrendBadge(p.cost_prediction.burn_rate_trend) : '—'}
                      </td>
                      <td className="text-center p-3">{getStatusBadge(p.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {alerts.length > 0 && (
        <Card className="border-amber-500" data-testid="card-budget-alerts-list">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Active Budget Alerts ({alerts.length})
            </CardTitle>
            <CardDescription>Budget threshold alerts across all projects</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between p-3 rounded-md border-l-4 bg-muted/30 ${
                    alert.alertLevel === "CRITICAL" ? "border-l-red-500" : "border-l-amber-500"
                  }`}
                  data-testid={`alert-item-${alert.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {alert.projectCode && (
                        <span
                          className="font-medium text-sm cursor-pointer hover:underline"
                          onClick={() => alert.projectCode && onProjectClick(alert.projectCode)}
                        >
                          {alert.projectCode}
                        </span>
                      )}
                      {alert.projectName && (
                        <span className="text-sm text-muted-foreground">- {alert.projectName}</span>
                      )}
                      {alert.costCode && (
                        <Badge variant="outline" className="text-xs">{alert.costCode}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {alert.currentPercent.toFixed(0)}% of budget used (threshold: {alert.thresholdPercent.toFixed(0)}%)
                    </p>
                  </div>
                  <Badge variant={alert.alertLevel === "CRITICAL" ? "destructive" : "default"} className={alert.alertLevel !== "CRITICAL" ? "bg-amber-500 hover:bg-amber-600" : ""}>
                    {alert.alertLevel}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
