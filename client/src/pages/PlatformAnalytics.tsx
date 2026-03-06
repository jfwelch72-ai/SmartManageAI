import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Activity, FileText, Hammer, Clock, TrendingUp, DollarSign, CreditCard, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";

interface PlatformAnalytics {
  weeklyActions: number;
  monthlyProjectsCreated: number;
  monthlyBidsCreated: number;
  monthlyShiftsLogged: number;
  mrr: number;
  activeSubscriptions: number;
  planBreakdown: Record<string, number>;
  trend: Array<{ date: string; orgs: number; users: number }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    userId: string;
    oldValue: string | null;
    newValue: string | null;
    createdAt: string;
  }>;
  activityTotal: number;
  activityPage: number;
  activityPageSize: number;
  days: number;
}

export default function PlatformAnalytics() {
  const { user } = useAuth();
  const [days, setDays] = useState("30");
  const [activityPage, setActivityPage] = useState(1);

  const { data: analytics, isLoading } = useQuery<PlatformAnalytics>({
    queryKey: ["/api/platform/analytics", { days, page: activityPage }],
    queryFn: async () => {
      const res = await fetch(`/api/platform/analytics?days=${days}&page=${activityPage}&pageSize=20`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "CREATE":
        return <Badge variant="default">Created</Badge>;
      case "UPDATE":
        return <Badge variant="secondary">Updated</Badge>;
      case "DELETE":
        return <Badge variant="destructive">Deleted</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const formatEntityType = (type: string) => {
    return type
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  const totalPages = analytics ? Math.ceil(analytics.activityTotal / analytics.activityPageSize) : 1;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(value);
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm" data-testid="button-back-admin">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Platform Analytics</h1>
              <p className="text-muted-foreground">Usage metrics and activity across all organizations</p>
            </div>
          </div>
          <Select value={days} onValueChange={(v) => { setDays(v); setActivityPage(1); }}>
            <SelectTrigger className="w-[160px]" data-testid="select-date-range">
              <SelectValue placeholder="Time period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">MRR</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-mrr">
                    {formatCurrency(analytics?.mrr || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground">Monthly recurring revenue</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Active Subs</CardTitle>
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-active-subs">
                    {analytics?.activeSubscriptions || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Paid subscriptions</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Weekly Actions</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-weekly-actions">
                    {analytics?.weeklyActions || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Last 7 days</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Projects Created</CardTitle>
                  <Hammer className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-monthly-projects">
                    {analytics?.monthlyProjectsCreated || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Last {days} days</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Bids Created</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-monthly-bids">
                    {analytics?.monthlyBidsCreated || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Last {days} days</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
                  <CardTitle className="text-sm font-medium">Shifts Logged</CardTitle>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-monthly-shifts">
                    {analytics?.monthlyShiftsLogged || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">Last {days} days</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Growth Trend
                </CardTitle>
                <CardDescription>New organizations and users over the last {days} days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]" data-testid="chart-growth-trend">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics?.trend || []} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorOrgs" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--chart-2, 160 60% 45%))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--chart-2, 160 60% 45%))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickFormatter={(val) => format(new Date(val), "MMM d")}
                        className="text-muted-foreground"
                      />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} className="text-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                        }}
                        labelFormatter={(val) => format(new Date(val), "MMM d, yyyy")}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="orgs"
                        name="New Orgs"
                        stroke="hsl(var(--primary))"
                        fillOpacity={1}
                        fill="url(#colorOrgs)"
                      />
                      <Area
                        type="monotone"
                        dataKey="users"
                        name="New Users"
                        stroke="hsl(var(--chart-2, 160 60% 45%))"
                        fillOpacity={1}
                        fill="url(#colorUsers)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5" />
                      Recent Activity
                    </CardTitle>
                    <CardDescription>
                      {analytics?.activityTotal || 0} total actions in the last {days} days
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activityPage <= 1}
                      onClick={() => setActivityPage((p) => Math.max(1, p - 1))}
                      data-testid="button-activity-prev"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm text-muted-foreground" data-testid="text-activity-page">
                      Page {activityPage} of {totalPages || 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={activityPage >= totalPages}
                      onClick={() => setActivityPage((p) => p + 1)}
                      data-testid="button-activity-next"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity Type</TableHead>
                      <TableHead>Entity ID</TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics?.recentActivity?.map((activity) => (
                      <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                        <TableCell>{getActionBadge(activity.action)}</TableCell>
                        <TableCell>{formatEntityType(activity.entityType)}</TableCell>
                        <TableCell className="font-mono text-sm">{activity.entityId.slice(0, 8)}...</TableCell>
                        <TableCell>
                          {format(new Date(activity.createdAt), "MMM d, yyyy h:mm a")}
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!analytics?.recentActivity || analytics.recentActivity.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                          No recent activity
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
