import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Activity, TrendingUp, TrendingDown, DollarSign, Users, 
  Clock, AlertTriangle, CheckCircle, Target, Building2,
  ArrowUpRight, ArrowDownRight, Minus
} from "lucide-react";

interface HealthMetric {
  name: string;
  value: number;
  target: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  status: 'healthy' | 'warning' | 'critical';
}

interface CompanyHealthData {
  overallScore: number;
  overallStatus: 'healthy' | 'warning' | 'critical';
  financialHealth: {
    cashFlow: number;
    receivables: number;
    payables: number;
    profitMargin: number;
    trend: 'up' | 'down' | 'stable';
  };
  operationalHealth: {
    activeProjects: number;
    onTimeDelivery: number;
    resourceUtilization: number;
    safetyIncidents: number;
  };
  customerHealth: {
    satisfactionScore: number;
    repeatClientRate: number;
    openBids: number;
    winRate: number;
  };
  workforceHealth: {
    totalEmployees: number;
    averageProductivity: number;
    laborCostRatio: number;
    overtimeHours: number;
  };
  metrics: HealthMetric[];
  lastUpdated: string;
}

function MetricCard({ metric }: { metric: HealthMetric }) {
  const percentage = Math.min((metric.value / metric.target) * 100, 100);
  
  const statusColors = {
    healthy: 'bg-green-500',
    warning: 'bg-yellow-500',
    critical: 'bg-red-500'
  };

  const trendIcons = {
    up: <ArrowUpRight className="h-4 w-4 text-green-500" />,
    down: <ArrowDownRight className="h-4 w-4 text-red-500" />,
    stable: <Minus className="h-4 w-4 text-muted-foreground" />
  };

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{metric.name}</p>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">{metric.value}{metric.unit}</span>
          {trendIcons[metric.trend]}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className={`h-2 w-2 rounded-full ${statusColors[metric.status]}`} />
        <span className="text-xs text-muted-foreground">Target: {metric.target}{metric.unit}</span>
      </div>
    </div>
  );
}

function HealthScoreRing({ score, status }: { score: number; status: 'healthy' | 'warning' | 'critical' }) {
  const statusColors = {
    healthy: 'text-green-500',
    warning: 'text-yellow-500',
    critical: 'text-red-500'
  };

  const statusLabels = {
    healthy: 'Healthy',
    warning: 'Needs Attention',
    critical: 'Critical'
  };

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-32 h-32">
        <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-muted/20"
          />
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeDasharray={`${score * 2.51} 251`}
            className={statusColors[status]}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <Badge variant={status === 'healthy' ? 'default' : status === 'warning' ? 'secondary' : 'destructive'} className="mt-2">
        {statusLabels[status]}
      </Badge>
    </div>
  );
}

export default function CompanyHealthPage() {
  const { user } = useAuth();

  const { data: healthData, isLoading } = useQuery<CompanyHealthData>({
    queryKey: ["/api/executive/company-health"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'HUSTLER'),
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Please log in to view company health data</p>
      </div>
    );
  }

  if (user.role !== 'ADMIN' && user.role !== 'MANAGER' && user.role !== 'HUSTLER') {
    return (
      <div className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Executive access required</p>
      </div>
    );
  }

  const mockHealthData: CompanyHealthData = {
    overallScore: 78,
    overallStatus: 'healthy',
    financialHealth: {
      cashFlow: 245000,
      receivables: 180000,
      payables: 95000,
      profitMargin: 12.5,
      trend: 'up'
    },
    operationalHealth: {
      activeProjects: 8,
      onTimeDelivery: 87,
      resourceUtilization: 82,
      safetyIncidents: 0
    },
    customerHealth: {
      satisfactionScore: 4.6,
      repeatClientRate: 68,
      openBids: 12,
      winRate: 34
    },
    workforceHealth: {
      totalEmployees: 45,
      averageProductivity: 91,
      laborCostRatio: 42,
      overtimeHours: 156
    },
    metrics: [
      { name: 'Cash Flow', value: 245, target: 200, unit: 'K', trend: 'up', status: 'healthy' },
      { name: 'Profit Margin', value: 12.5, target: 15, unit: '%', trend: 'up', status: 'warning' },
      { name: 'On-Time Delivery', value: 87, target: 90, unit: '%', trend: 'stable', status: 'warning' },
      { name: 'Resource Utilization', value: 82, target: 85, unit: '%', trend: 'up', status: 'healthy' },
      { name: 'Customer Satisfaction', value: 4.6, target: 4.5, unit: '/5', trend: 'up', status: 'healthy' },
      { name: 'Bid Win Rate', value: 34, target: 30, unit: '%', trend: 'up', status: 'healthy' },
    ],
    lastUpdated: new Date().toISOString()
  };

  const displayData = healthData || mockHealthData;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Activity className="h-6 w-6" />
            Company Health Dashboard
          </h1>
          <p className="text-muted-foreground">Real-time business health metrics and KPIs</p>
        </div>
        <Badge variant="outline" className="text-xs">
          Updated: {new Date(displayData.lastUpdated).toLocaleString()}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Overall Health Score</CardTitle>
            <CardDescription>Combined business health indicator</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <HealthScoreRing score={displayData.overallScore} status={displayData.overallStatus} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Key Performance Indicators</CardTitle>
            <CardDescription>Real-time metrics vs targets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {displayData.metrics.map((metric, index) => (
                <MetricCard key={index} metric={metric} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              Financial Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Cash Flow</span>
              <span className="font-semibold">${displayData.financialHealth.cashFlow.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Receivables</span>
              <span className="font-semibold">${displayData.financialHealth.receivables.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Payables</span>
              <span className="font-semibold">${displayData.financialHealth.payables.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Profit Margin</span>
              <span className="font-semibold flex items-center gap-1">
                {displayData.financialHealth.profitMargin}%
                {displayData.financialHealth.trend === 'up' && <TrendingUp className="h-3 w-3 text-green-500" />}
                {displayData.financialHealth.trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4 text-blue-500" />
              Operational Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Active Projects</span>
              <span className="font-semibold">{displayData.operationalHealth.activeProjects}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">On-Time Delivery</span>
              <span className="font-semibold">{displayData.operationalHealth.onTimeDelivery}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Resource Utilization</span>
              <span className="font-semibold">{displayData.operationalHealth.resourceUtilization}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Safety Incidents</span>
              <span className="font-semibold flex items-center gap-1">
                {displayData.operationalHealth.safetyIncidents}
                {displayData.operationalHealth.safetyIncidents === 0 && <CheckCircle className="h-3 w-3 text-green-500" />}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              Customer Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Satisfaction</span>
              <span className="font-semibold">{displayData.customerHealth.satisfactionScore}/5</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Repeat Clients</span>
              <span className="font-semibold">{displayData.customerHealth.repeatClientRate}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Open Bids</span>
              <span className="font-semibold">{displayData.customerHealth.openBids}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Win Rate</span>
              <span className="font-semibold">{displayData.customerHealth.winRate}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4 text-orange-500" />
              Workforce Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Total Employees</span>
              <span className="font-semibold">{displayData.workforceHealth.totalEmployees}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Avg Productivity</span>
              <span className="font-semibold">{displayData.workforceHealth.averageProductivity}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Labor Cost Ratio</span>
              <span className="font-semibold">{displayData.workforceHealth.laborCostRatio}%</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">OT Hours (MTD)</span>
              <span className="font-semibold flex items-center gap-1">
                {displayData.workforceHealth.overtimeHours}
                {displayData.workforceHealth.overtimeHours > 100 && <AlertTriangle className="h-3 w-3 text-yellow-500" />}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
