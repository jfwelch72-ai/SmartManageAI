import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface SubStats {
  totalSubscriptions: number;
  byPlanTier: { planTier: string; count: number }[];
  byStatus: { status: string; count: number }[];
  addonAdoption: { addonKey: string; count: number }[];
  estimatedMrr: number;
  recentChanges: any[];
}

export function StatsCards({ stats }: { stats: SubStats }) {
  const getPlanCount = (tier: string) => stats.byPlanTier.find(p => p.planTier === tier)?.count || 0;
  const getStatusCount = (s: string) => stats.byStatus.find(st => st.status === s)?.count || 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Total Orgs</p>
          <p className="text-2xl font-bold" data-testid="text-total-subscriptions">{stats.totalSubscriptions}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Est. MRR</p>
          <p className="text-2xl font-bold text-emerald-600" data-testid="text-estimated-mrr">${stats.estimatedMrr.toLocaleString()}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-2xl font-bold text-emerald-600">{getStatusCount("active")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Trialing</p>
          <p className="text-2xl font-bold text-amber-600">{getStatusCount("trialing")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Past Due</p>
          <p className="text-2xl font-bold text-red-600">{getStatusCount("past_due")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Canceled</p>
          <p className="text-2xl font-bold text-gray-500">{getStatusCount("canceled")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function PlanBreakdown({ stats }: { stats: SubStats }) {
  const tiers = [
    { key: "free", label: "Trial", color: "bg-gray-400" },
    { key: "starter", label: "Starter", color: "bg-green-500" },
    { key: "professional", label: "Growth", color: "bg-blue-500" },
    { key: "enterprise", label: "Scale", color: "bg-purple-500" },
  ];
  const total = stats.totalSubscriptions || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Plan Distribution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {tiers.map(tier => {
          const cnt = stats.byPlanTier.find(p => p.planTier === tier.key)?.count || 0;
          const pct = Math.round((cnt / total) * 100);
          return (
            <div key={tier.key} className="flex items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">{tier.label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${tier.color} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 text-right font-medium">{cnt}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
