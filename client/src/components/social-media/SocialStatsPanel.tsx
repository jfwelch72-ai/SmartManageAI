import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Megaphone, Clock, CheckCircle, Edit, Eye, AlertCircle, TrendingUp, Users
} from "lucide-react";
import { getPlatformInfo } from "./types";

export function SocialStatsPanel() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/social/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const statCards = [
    { label: "Total Posts", value: stats?.total || 0, icon: Megaphone, color: "text-blue-600" },
    { label: "Scheduled", value: stats?.scheduled || 0, icon: Clock, color: "text-purple-600" },
    { label: "Published This Month", value: stats?.publishedThisMonth || 0, icon: CheckCircle, color: "text-green-600" },
    { label: "Drafts", value: stats?.drafts || 0, icon: Edit, color: "text-gray-600" },
    { label: "Pending Approval", value: stats?.pendingApproval || 0, icon: Eye, color: "text-amber-600" },
    { label: "Failed", value: stats?.failed || 0, icon: AlertCircle, color: "text-red-600" },
    { label: "Published This Week", value: stats?.publishedThisWeek || 0, icon: TrendingUp, color: "text-emerald-600" },
    { label: "Connected Accounts", value: stats?.connectedAccounts || 0, icon: Users, color: "text-indigo-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold mt-1" data-testid={`stat-${s.label.toLowerCase().replace(/\s/g, '-')}`}>{s.value}</p>
                </div>
                <s.icon className={`h-5 w-5 ${s.color}`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats?.byPlatform && Object.keys(stats.byPlatform).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Posts by Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.byPlatform).map(([platform, count]) => {
                const info = getPlatformInfo(platform);
                const Icon = info.icon;
                return (
                  <div key={platform} className="flex items-center gap-2 px-3 py-2 rounded-lg border" data-testid={`platform-count-${platform.toLowerCase()}`}>
                    <Icon className="h-4 w-4" style={{ color: info.color }} />
                    <span className="text-sm font-medium">{info.label}</span>
                    <Badge variant="secondary" className="text-xs">{count as number}</Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
