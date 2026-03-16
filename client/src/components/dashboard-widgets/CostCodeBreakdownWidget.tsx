import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart as PieChartIcon, Lock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { DEFAULT_COST_CODE_CONFIG, type CostCodeBreakdownConfig } from "./CostCodeBreakdownSettings";

interface LaborItem {
  costCode: string;
  laborCost: number;
  hours: number;
}

interface BudgetItem {
  costCode: string;
  budgeted: number;
  actual: number;
}

interface CostCodeResponse {
  items: (LaborItem | BudgetItem)[];
  totalLaborCost: number;
  totalBudgeted: number;
  totalActual: number;
}

const COLORS = [
  "hsl(215, 70%, 55%)", "hsl(150, 60%, 45%)", "hsl(35, 85%, 55%)",
  "hsl(340, 65%, 55%)", "hsl(270, 55%, 55%)", "hsl(180, 55%, 45%)",
  "hsl(50, 70%, 50%)", "hsl(10, 70%, 55%)", "hsl(195, 60%, 50%)",
  "hsl(100, 50%, 45%)", "hsl(0, 0%, 55%)",
];

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function CustomTooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{d.costCode || d.name}</p>
      {d.laborCost !== undefined && (
        <>
          <p className="text-muted-foreground">Cost: {formatCurrency(d.laborCost)}</p>
          <p className="text-muted-foreground">Hours: {d.hours?.toFixed(1)}</p>
        </>
      )}
      {d.budgeted !== undefined && (
        <>
          <p className="text-blue-600">Budget: {formatCurrency(d.budgeted)}</p>
          <p className={cn(d.actual > d.budgeted ? "text-red-600" : "text-green-600")}>
            Actual: {formatCurrency(d.actual)}
          </p>
        </>
      )}
    </div>
  );
}

interface CostCodeBreakdownWidgetProps {
  config?: CostCodeBreakdownConfig;
}

export function CostCodeBreakdownWidget({ config }: CostCodeBreakdownWidgetProps) {
  const hasPermission = useFeaturePermission("canAccessFinancials");
  const merged = { ...DEFAULT_COST_CODE_CONFIG, ...config };

  const params = new URLSearchParams({ mode: merged.mode || "labor" });
  if (merged.projectId) params.set("projectId", merged.projectId);
  if (merged.groupByDivision) params.set("groupByDivision", "true");

  const { data, isLoading } = useQuery<CostCodeResponse>({
    queryKey: [`/api/dashboard/cost-code-breakdown?${params.toString()}`],
    refetchInterval: 300000,
    enabled: hasPermission,
  });

  if (!hasPermission) {
    return (
      <Card data-testid="cost-code-no-permission">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Cost Code Breakdown</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-sm text-muted-foreground text-center py-4">You don't have permission to view financial data.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card data-testid="cost-code-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="animate-pulse h-4 w-36 bg-muted rounded" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="animate-pulse h-48 bg-muted/50 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  const items = data?.items || [];
  const isEmpty = items.length === 0;
  const isLaborMode = merged.mode !== "budget_vs_actual";

  return (
    <Card data-testid="cost-code-breakdown-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">
            {isLaborMode ? "Labor by Cost Code" : "Budget vs Actual"}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-8 text-center" data-testid="cost-code-empty">
            <PieChartIcon className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No cost code data available</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Time entries with cost codes will appear here</p>
          </div>
        ) : isLaborMode ? (
          <div data-testid="cost-code-pie-chart">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={(items as LaborItem[]).map(i => ({ ...i, name: i.costCode }))}
                  dataKey="laborCost"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={40}
                  paddingAngle={2}
                >
                  {items.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltipContent />} />
                <Legend
                  formatter={(value: string) => <span className="text-xs text-foreground">{value}</span>}
                  wrapperStyle={{ fontSize: "11px" }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="text-center mt-1">
              <span className="text-xs text-muted-foreground">
                Total: {formatCurrency(data?.totalLaborCost || 0)}
              </span>
            </div>
          </div>
        ) : (
          <div data-testid="cost-code-bar-chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={(items as BudgetItem[]).map(i => ({ ...i, name: i.costCode }))}
                margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  className="fill-muted-foreground"
                  tickFormatter={(v) => formatCurrency(v)}
                  width={55}
                />
                <Tooltip content={<CustomTooltipContent />} />
                <Legend
                  formatter={(value: string) => <span className="text-xs text-foreground">{value}</span>}
                  wrapperStyle={{ fontSize: "11px" }}
                />
                <Bar dataKey="budgeted" name="Budget" fill="hsl(215, 70%, 55%)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="hsl(150, 60%, 45%)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-1">
              <span className="text-xs text-muted-foreground">
                Budget: {formatCurrency(data?.totalBudgeted || 0)}
              </span>
              <span className="text-xs text-muted-foreground">
                Actual: {formatCurrency(data?.totalActual || 0)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
