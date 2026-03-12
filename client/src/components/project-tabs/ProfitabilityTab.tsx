import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Clock, RefreshCw, DollarSign, HardHat, Package, Users, Wrench, FileText, Receipt, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ProfitabilityData {
  project_code: string;
  project_name: string;
  budget: number;
  adjusted_budget: number;
  total_labor_cost: number;
  total_material_cost: number;
  total_subcontractor_cost: number;
  total_equipment_cost: number;
  total_tm_cost: number;
  total_other_expenses: number;
  total_actual_cost: number;
  approved_change_orders_value: number;
  variance: number;
  variance_percent: number;
  status: "ON_BUDGET" | "MINOR_CONCERN" | "MAJOR_RISK";
  projected_completion_cost: number;
  estimated_margin: number;
  lastCalculated: string;
  previousSnapshot: {
    totalActualCost: number;
    variancePercent: number;
    status: string;
    createdAt: string;
  } | null;
  key_metrics: {
    labor_hours: number;
    labor_efficiency: string;
    material_spend_rate: string;
    pending_change_orders_value: number;
    pending_tm_value: number;
    subcontractor_count: number;
    tm_ticket_count: number;
    equipment_planned_cost: number;
    equipment_actual_cost: number;
    equipment_cost_variance: number;
  };
}

interface HistorySnapshot {
  id: string;
  totalActualCost: string;
  variancePercent: string;
  status: string;
  createdAt: string;
}

function fmt(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function fmtPct(val: number): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(1)}%`;
}

function StatusBadgeComp({ status }: { status: string }) {
  if (status === "ON_BUDGET") return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">On Budget</Badge>;
  if (status === "MINOR_CONCERN") return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Minor Concern</Badge>;
  return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Major Risk</Badge>;
}

function CostRow({ icon: Icon, label, actual, budget, color }: {
  icon: any; label: string; actual: number; budget?: number; color: string;
}) {
  const pct = budget && budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
  const overBudget = budget && actual > budget;
  return (
    <div className="space-y-1" data-testid={`cost-row-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className={`h-4 w-4 ${color}`} />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {budget !== undefined && (
            <span className="text-xs text-muted-foreground">of {fmt(budget)}</span>
          )}
          <span className={`font-semibold ${overBudget ? "text-red-600 dark:text-red-400" : ""}`}>
            {fmt(actual)}
          </span>
          {overBudget && <AlertTriangle className="h-3 w-3 text-red-500" />}
        </div>
      </div>
      {budget !== undefined && budget > 0 && (
        <Progress
          value={pct}
          className={`h-1.5 ${overBudget ? "[&>div]:bg-red-500" : "[&>div]:bg-blue-500"}`}
        />
      )}
    </div>
  );
}

export default function ProfitabilityTab({ projectCode }: { projectCode: string }) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery<ProfitabilityData>({
    queryKey: ["/api/projects", projectCode, "profitability", "live"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/profitability/live`);
      if (!r.ok) throw new Error("Failed to load profitability data");
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
    enabled: !!projectCode,
  });

  const { data: history = [] } = useQuery<HistorySnapshot[]>({
    queryKey: ["/api/projects", projectCode, "profitability", "history"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectCode}/profitability/history`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectCode,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load profitability data. This project may be missing budget information.</AlertDescription>
      </Alert>
    );
  }

  const varianceTrend = data.previousSnapshot
    ? data.variance_percent - data.previousSnapshot.variancePercent
    : 0;

  const budgetUsedPct = data.adjusted_budget > 0
    ? (data.total_actual_cost / data.adjusted_budget) * 100
    : 0;

  const isOverBudget = data.variance < 0;
  const varianceAbs = Math.abs(data.variance_percent);

  return (
    <div className="space-y-4" data-testid="profitability-tab">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Live Cost Tracking</h2>
          <StatusBadgeComp status={data.status} />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" />
          <span>Auto-refreshes every 5 min — Last updated {formatDistanceToNow(new Date(data.lastCalculated), { addSuffix: true })}</span>
        </div>
      </div>

      {data.status !== "ON_BUDGET" && (
        <Alert className={data.status === "MAJOR_RISK" ? "border-red-300 bg-red-50 dark:bg-red-900/10" : "border-yellow-300 bg-yellow-50 dark:bg-yellow-900/10"}>
          <AlertTriangle className={`h-4 w-4 ${data.status === "MAJOR_RISK" ? "text-red-600" : "text-yellow-600"}`} />
          <AlertDescription className={data.status === "MAJOR_RISK" ? "text-red-800 dark:text-red-300" : "text-yellow-800 dark:text-yellow-300"}>
            {data.status === "MAJOR_RISK"
              ? `This project is ${fmtPct(varianceAbs)} over budget — projected to finish at ${fmt(data.projected_completion_cost)}.`
              : `Costs are running ${fmtPct(varianceAbs)} over budget. Monitor closely as the project progresses.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-contract-budget">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Contract Budget</p>
            <p className="text-2xl font-bold">{fmt(data.adjusted_budget)}</p>
            {data.approved_change_orders_value > 0 && (
              <p className="text-xs text-green-600 dark:text-green-400">+{fmt(data.approved_change_orders_value)} from approved COs</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-actual-cost">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Actual Cost to Date</p>
            <p className="text-2xl font-bold">{fmt(data.total_actual_cost)}</p>
            <p className="text-xs text-muted-foreground">{budgetUsedPct.toFixed(1)}% of budget used</p>
          </CardContent>
        </Card>

        <Card data-testid="card-variance">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Variance</p>
            <p className={`text-2xl font-bold ${isOverBudget ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {fmt(Math.abs(data.variance))}
            </p>
            <div className="flex items-center gap-1">
              {isOverBudget
                ? <TrendingDown className="h-3 w-3 text-red-500" />
                : <TrendingUp className="h-3 w-3 text-green-500" />}
              <span className={`text-xs font-medium ${isOverBudget ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                {isOverBudget ? "Over budget" : "Under budget"} ({fmtPct(varianceAbs)})
              </span>
            </div>
            {varianceTrend !== 0 && (
              <p className={`text-xs ${varianceTrend > 0 ? "text-red-500" : "text-green-500"}`}>
                {varianceTrend > 0 ? "↑" : "↓"} {Math.abs(varianceTrend).toFixed(1)}% since last check
              </p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-margin">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Est. Margin at Completion</p>
            <p className={`text-2xl font-bold ${data.estimated_margin < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
              {fmt(data.estimated_margin)}
            </p>
            <p className="text-xs text-muted-foreground">
              Projected finish: {fmt(data.projected_completion_cost)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Budget vs Actual — Cost Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">Total Budget Consumed</span>
              <span className="font-semibold">{budgetUsedPct.toFixed(1)}%</span>
            </div>
            <Progress
              value={Math.min(budgetUsedPct, 100)}
              className={`h-3 ${budgetUsedPct > 100 ? "[&>div]:bg-red-500" : budgetUsedPct > 85 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>$0</span>
              <span>{fmt(data.adjusted_budget)}</span>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <CostRow
              icon={HardHat}
              label="Labor"
              actual={data.total_labor_cost}
              color="text-blue-500"
            />
            <CostRow
              icon={Package}
              label="Materials"
              actual={data.total_material_cost}
              color="text-purple-500"
            />
            <CostRow
              icon={Users}
              label="Subcontractors"
              actual={data.total_subcontractor_cost}
              color="text-orange-500"
            />
            <CostRow
              icon={Wrench}
              label="Equipment"
              actual={data.total_equipment_cost}
              color="text-cyan-500"
            />
            <CostRow
              icon={FileText}
              label="T&M Tickets"
              actual={data.total_tm_cost}
              color="text-pink-500"
            />
            <CostRow
              icon={Receipt}
              label="Other Expenses"
              actual={data.total_other_expenses}
              color="text-gray-500"
            />
            <div className="border-t pt-3 flex items-center justify-between font-semibold text-sm">
              <span>Total Actual Cost</span>
              <span className={isOverBudget ? "text-red-600 dark:text-red-400" : ""}>{fmt(data.total_actual_cost)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-key-metrics">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Key Metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Labor Hours</span>
              <span className="font-medium">{data.key_metrics.labor_hours.toLocaleString()} hrs</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Labor Efficiency</span>
              <span className="font-medium">{data.key_metrics.labor_efficiency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Material Spend Rate</span>
              <span className="font-medium">{data.key_metrics.material_spend_rate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subcontractors</span>
              <span className="font-medium">{data.key_metrics.subcontractor_count}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">T&M Tickets</span>
              <span className="font-medium">{data.key_metrics.tm_ticket_count}</span>
            </div>
            {data.key_metrics.pending_change_orders_value > 0 && (
              <div className="flex justify-between text-yellow-700 dark:text-yellow-400">
                <span>Pending COs</span>
                <span className="font-medium">{fmt(data.key_metrics.pending_change_orders_value)}</span>
              </div>
            )}
            {data.key_metrics.pending_tm_value > 0 && (
              <div className="flex justify-between text-yellow-700 dark:text-yellow-400">
                <span>Pending T&M</span>
                <span className="font-medium">{fmt(data.key_metrics.pending_tm_value)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-snapshot-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Snapshots
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No historical snapshots yet. They are captured automatically every 15 minutes.</p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 8).map((snap) => (
                  <div key={snap.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">
                      {formatDistanceToNow(new Date(snap.createdAt), { addSuffix: true })}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{fmt(Number(snap.totalActualCost))}</span>
                      <span className={`text-xs ${Number(snap.variancePercent) > 0 ? "text-red-500" : "text-green-500"}`}>
                        {Number(snap.variancePercent) > 0 ? "+" : ""}{Number(snap.variancePercent).toFixed(1)}%
                      </span>
                      <StatusBadgeComp status={snap.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
