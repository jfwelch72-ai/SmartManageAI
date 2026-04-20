import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend, CartesianGrid } from "recharts";
import { TrendingUp, Target, Trophy, AlertTriangle, DollarSign, Clock } from "lucide-react";

interface AnalyticsData {
  kpis: { openPipeline: number; weightedPipeline: number; wonCount: number; lostCount: number; winRate: number; avgDaysToWin: number };
  funnel: { stage: string; count: number; totalValue: number; weighted: number }[];
  forecast: { month: string; weighted: number; pipeline: number; count: number }[];
  leaderboard: { userId: string; name: string; wonValue: number; wonCount: number; lostCount: number; openValue: number; openCount: number; winRate: number }[];
  lostReasons: { category: string; count: number; lostValue: number }[];
  sources: { source: string; total: number; won: number; wonValue: number; winRate: number }[];
  tasks: { status: string; count: number }[];
}

const STAGE_LABEL: Record<string, string> = { LEAD: "Lead", QUALIFIED: "Qualified", ESTIMATING: "Estimating", BID_SUBMITTED: "Bid Submitted", NEGOTIATION: "Negotiation", WON: "Won", LOST: "Lost" };
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const fmt = (n: number) => "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });

export function CrmAnalyticsView() {
  const { data, isLoading } = useQuery<AnalyticsData>({ queryKey: ["/api/crm/analytics/dashboard"] });

  if (isLoading || !data) return <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;

  const { kpis, funnel, forecast, leaderboard, lostReasons, sources } = data;

  return (
    <div className="space-y-6" data-testid="view-crm-analytics">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard icon={<DollarSign className="h-4 w-4" />} label="Open Pipeline" value={fmt(kpis.openPipeline)} testId="kpi-open-pipeline" />
        <KpiCard icon={<TrendingUp className="h-4 w-4" />} label="Weighted" value={fmt(kpis.weightedPipeline)} testId="kpi-weighted" />
        <KpiCard icon={<Trophy className="h-4 w-4 text-emerald-600" />} label="Won" value={String(kpis.wonCount)} testId="kpi-won-count" />
        <KpiCard icon={<AlertTriangle className="h-4 w-4 text-rose-600" />} label="Lost" value={String(kpis.lostCount)} testId="kpi-lost-count" />
        <KpiCard icon={<Target className="h-4 w-4 text-violet-600" />} label="Win Rate" value={`${kpis.winRate}%`} testId="kpi-win-rate" />
        <KpiCard icon={<Clock className="h-4 w-4 text-amber-600" />} label="Avg Days to Win" value={String(kpis.avgDaysToWin)} testId="kpi-avg-days" />
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader><CardTitle>Pipeline Funnel</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={funnel.map(f => ({ ...f, label: STAGE_LABEL[f.stage] ?? f.stage }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" /><YAxis />
              <Tooltip formatter={(v: number, k) => k === "count" ? v : fmt(v)} />
              <Legend />
              <Bar dataKey="count" name="Count" fill="#3b82f6" />
              <Bar dataKey="totalValue" name="Pipeline $" fill="#10b981" />
              <Bar dataKey="weighted" name="Weighted $" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Forecast */}
        <Card>
          <CardHeader><CardTitle>Forecast (Open Deals by Close Month)</CardTitle></CardHeader>
          <CardContent>
            {forecast.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No deals with expected close dates.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={forecast}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" /><YAxis />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="pipeline" name="Pipeline" stroke="#3b82f6" strokeWidth={2} />
                  <Line type="monotone" dataKey="weighted" name="Weighted" stroke="#10b981" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Lost Reasons */}
        <Card>
          <CardHeader><CardTitle>Lost Reasons</CardTitle></CardHeader>
          <CardContent>
            {lostReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No lost deals yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={lostReasons} dataKey="count" nameKey="category" outerRadius={90} label={(e: any) => `${e.category} (${e.count})`}>
                    {lostReasons.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader><CardTitle>Sales Leaderboard</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No assigned opportunities.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Rep</th><th className="py-2 text-right">Won $</th><th className="py-2 text-right">Won</th>
                <th className="py-2 text-right">Lost</th><th className="py-2 text-right">Open Pipeline</th><th className="py-2 text-right">Win Rate</th>
              </tr></thead>
              <tbody>
                {leaderboard.map(r => (
                  <tr key={r.userId} className="border-b hover-elevate" data-testid={`row-leaderboard-${r.userId}`}>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2 text-right font-semibold text-emerald-600">{fmt(r.wonValue)}</td>
                    <td className="py-2 text-right">{r.wonCount}</td>
                    <td className="py-2 text-right">{r.lostCount}</td>
                    <td className="py-2 text-right">{fmt(r.openValue)} <span className="text-xs text-muted-foreground">({r.openCount})</span></td>
                    <td className="py-2 text-right"><Badge variant={r.winRate >= 50 ? "default" : "secondary"}>{r.winRate}%</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Source Effectiveness */}
      <Card>
        <CardHeader><CardTitle>Source Effectiveness</CardTitle></CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No source data.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {sources.map(s => (
                <div key={s.source} className="border rounded-lg p-3" data-testid={`card-source-${s.source}`}>
                  <div className="text-xs uppercase text-muted-foreground mb-1">{s.source}</div>
                  <div className="text-xl font-bold">{fmt(s.wonValue)}</div>
                  <div className="text-xs text-muted-foreground">{s.won}/{s.total} won · <span className="font-medium">{s.winRate}%</span></div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ icon, label, value, testId }: { icon: React.ReactNode; label: string; value: string; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
