import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  ChevronRight,
  Activity,
  FileText,
  Hammer,
  Clock,
  TrendingUp,
  DollarSign,
  CreditCard,
  Cpu,
  HardDrive,
  Link2,
  ArrowUpDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface PlatformAnalyticsData {
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

type SortDirection = "asc" | "desc";

interface ApiUsageOrg {
  organizationId: string;
  organizationName: string;
  auditedActions: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
}

interface AiUsageOrg {
  organizationId: string;
  organizationName: string;
  totalCalls: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  estimatedCost: number;
  aiRuns: number;
}

interface StorageOrg {
  organizationId: string;
  organizationName: string;
  totalFiles: number;
  totalSizeBytes: number;
  totalSizeMB: number;
}

interface IntegrationOrg {
  organizationId: string;
  organizationName: string;
  overallStatus: string;
  healthyCount: number;
  failingCount: number;
  disconnectedCount: number;
  totalConnections: number;
  connections: Array<{
    id: string;
    provider: string;
    status: string;
    displayName: string | null;
    lastSyncAt: string | null;
    lastSyncError: string | null;
  }>;
}

function useSortable<T>(data: T[] | undefined, defaultKey: keyof T, defaultDir: SortDirection = "desc") {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDirection>(defaultDir);

  const toggle = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = data ? [...data].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sortDir === "asc" ? aVal - bVal : bVal - aVal;
    }
    return sortDir === "asc"
      ? String(aVal).localeCompare(String(bVal))
      : String(bVal).localeCompare(String(aVal));
  }) : [];

  return { sorted, sortKey, sortDir, toggle };
}

function SortHeader({ label, field, sortKey, sortDir, onToggle }: {
  label: string; field: string; sortKey: string; sortDir: string; onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 font-medium text-xs uppercase tracking-wider hover:text-foreground transition-colors" data-testid={`sort-${field}`}>
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-foreground" : "text-muted-foreground"}`} />
    </button>
  );
}

function GrowthRevenueTab() {
  const [days, setDays] = useState("30");
  const [activityPage, setActivityPage] = useState(1);

  const { data: analytics, isLoading } = useQuery<PlatformAnalyticsData>({
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

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const renderEntityId = (entityId: string | null | undefined, entityType: string) => {
    if (!entityId) {
      return <span className="text-muted-foreground" data-testid="text-entity-id">—</span>;
    }
    if (entityId === "all_orgs") {
      return (
        <span className="italic text-muted-foreground" data-testid="text-entity-id">
          All Organizations
        </span>
      );
    }
    if (UUID_RE.test(entityId)) {
      return (
        <span
          className="font-mono text-sm cursor-help"
          title={entityId}
          data-testid="text-entity-id"
        >
          {entityId.slice(0, 8)}…
        </span>
      );
    }
    return (
      <span className="font-mono text-sm break-all" data-testid="text-entity-id">
        {entityId}
      </span>
    );
  };

  const parseResource = (newValue: string | null | undefined): string | null => {
    if (!newValue) return null;
    try {
      const parsed = JSON.parse(newValue);
      const resource =
        typeof parsed?.resource === "string"
          ? parsed.resource
          : typeof parsed?.targetOrganizationId === "string"
            ? null
            : null;
      return resource ?? null;
    } catch {
      return null;
    }
  };

  const totalPages = analytics ? Math.ceil(analytics.activityTotal / analytics.activityPageSize) : 1;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(value);
  };

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Select value={days} onValueChange={(v) => { setDays(v); setActivityPage(1); }}>
          <SelectTrigger className="w-full sm:w-[160px]" data-testid="select-date-range">
            <SelectValue placeholder="Time period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          <div className="overflow-x-auto">
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
                {analytics?.recentActivity?.map((activity) => {
                  const resource = parseResource(activity.newValue);
                  return (
                    <TableRow key={activity.id} data-testid={`row-activity-${activity.id}`}>
                      <TableCell>{getActionBadge(activity.action)}</TableCell>
                      <TableCell>{formatEntityType(activity.entityType)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          {renderEntityId(activity.entityId, activity.entityType)}
                          {resource && (
                            <span
                              className="text-xs text-muted-foreground font-mono truncate max-w-[280px]"
                              title={resource}
                              data-testid={`text-activity-resource-${activity.id}`}
                            >
                              {resource}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {format(new Date(activity.createdAt), "MMM d, yyyy h:mm a")}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(!analytics?.recentActivity || analytics.recentActivity.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No recent activity
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ApiUsageTab() {
  const [period, setPeriod] = useState("7d");
  const { data, isLoading } = useQuery<{ period: string; since: string; organizations: ApiUsageOrg[] }>({
    queryKey: ["/api/platform/monitoring/api-usage", period],
    queryFn: async () => {
      const res = await fetch(`/api/platform/monitoring/api-usage?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { sorted, sortKey, sortDir, toggle } = useSortable<ApiUsageOrg>(
    data?.organizations, "auditedActions"
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              API Usage by Organization
            </CardTitle>
            <CardDescription>Request counts and error rates per organization</CardDescription>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32" data-testid="select-api-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-api-usage">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">
                  <SortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Audited Actions" field="auditedActions" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("auditedActions")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Requests" field="totalRequests" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalRequests")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Errors" field="totalErrors" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalErrors")} />
                </th>
                <th className="pb-2 text-right">
                  <SortHeader label="Error Rate" field="errorRate" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("errorRate")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((org) => (
                <tr key={org.organizationId} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-api-${org.organizationId}`}>
                  <td className="py-3 pr-4 font-medium">{org.organizationName}</td>
                  <td className="py-3 pr-4 text-right">{org.auditedActions.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">{org.totalRequests.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">
                    {org.totalErrors > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{org.totalErrors.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <Badge variant={org.errorRate > 10 ? "destructive" : org.errorRate > 0 ? "secondary" : "outline"}>
                      {org.errorRate}%
                    </Badge>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No API usage data available</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function AiUsageTab() {
  const [period, setPeriod] = useState("7d");
  const { data, isLoading } = useQuery<{ period: string; organizations: AiUsageOrg[] }>({
    queryKey: ["/api/platform/monitoring/ai-usage", period],
    queryFn: async () => {
      const res = await fetch(`/api/platform/monitoring/ai-usage?period=${period}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { sorted, sortKey, sortDir, toggle } = useSortable<AiUsageOrg>(
    data?.organizations, "totalCalls"
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              AI Usage by Organization
            </CardTitle>
            <CardDescription>AI calls, token consumption, estimated costs, and AI runs per organization</CardDescription>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32" data-testid="select-ai-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-ai-usage">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">
                  <SortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="AI Calls" field="totalCalls" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalCalls")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Tokens In" field="tokensIn" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("tokensIn")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Tokens Out" field="tokensOut" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("tokensOut")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Total Tokens" field="totalTokens" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalTokens")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Est. Cost" field="estimatedCost" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("estimatedCost")} />
                </th>
                <th className="pb-2 text-right">
                  <SortHeader label="AI Runs" field="aiRuns" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("aiRuns")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((org) => (
                <tr key={org.organizationId} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-ai-${org.organizationId}`}>
                  <td className="py-3 pr-4 font-medium">{org.organizationName}</td>
                  <td className="py-3 pr-4 text-right">{org.totalCalls.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">{org.tokensIn.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">{org.tokensOut.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right font-medium">{org.totalTokens.toLocaleString()}</td>
                  <td className="py-3 pr-4 text-right">
                    <Badge variant="secondary">${org.estimatedCost.toFixed(4)}</Badge>
                  </td>
                  <td className="py-3 text-right">{org.aiRuns}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No AI usage data available</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function StorageTab() {
  const { data, isLoading } = useQuery<{ organizations: StorageOrg[] }>({
    queryKey: ["/api/platform/monitoring/storage-usage"],
    queryFn: async () => {
      const res = await fetch("/api/platform/monitoring/storage-usage", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { sorted, sortKey, sortDir, toggle } = useSortable<StorageOrg>(
    data?.organizations, "totalSizeBytes"
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const totalFiles = data?.organizations.reduce((s, o) => s + o.totalFiles, 0) || 0;
  const totalMB = data?.organizations.reduce((s, o) => s + o.totalSizeMB, 0) || 0;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Object Storage Usage
          </CardTitle>
          <CardDescription>
            Per-organization file counts and sizes
            <span className="ml-2">({totalFiles.toLocaleString()} files, {totalMB.toFixed(2)} MB total)</span>
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-storage-usage">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">
                  <SortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
                </th>
                <th className="pb-2 pr-4 text-right">
                  <SortHeader label="Total Files" field="totalFiles" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalFiles")} />
                </th>
                <th className="pb-2 text-right">
                  <SortHeader label="Total Size (MB)" field="totalSizeMB" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalSizeMB")} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((org) => (
                <tr key={org.organizationId} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-storage-${org.organizationId}`}>
                  <td className="py-3 pr-4 font-medium">{org.organizationName}</td>
                  <td className="py-3 pr-4 text-right">{org.totalFiles.toLocaleString()}</td>
                  <td className="py-3 text-right">
                    <Badge variant={org.totalSizeMB > 100 ? "destructive" : org.totalSizeMB > 10 ? "secondary" : "outline"}>
                      {org.totalSizeMB.toFixed(2)} MB
                    </Badge>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">No storage usage data available</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationHealthTab() {
  const { data, isLoading } = useQuery<{
    organizations: IntegrationOrg[];
    platformIntegrations: Record<string, boolean>;
  }>({
    queryKey: ["/api/platform/monitoring/integration-health"],
    queryFn: async () => {
      const res = await fetch("/api/platform/monitoring/integration-health", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { sorted, sortKey, sortDir, toggle } = useSortable<IntegrationOrg>(
    data?.organizations, "organizationName", "asc"
  );

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const platformIntegrations = data?.platformIntegrations || {};

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Platform Integration Status
          </CardTitle>
          <CardDescription>Global integration configuration status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {Object.entries(platformIntegrations).map(([key, configured]) => (
              <div key={key} className="flex items-center gap-3 p-3 rounded-lg border">
                {configured ? (
                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium capitalize">{key}</p>
                  <p className="text-xs text-muted-foreground">{configured ? "Configured" : "Not configured"}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Integration Connections</CardTitle>
          <CardDescription>Per-organization connected integrations and their current status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-integration-health">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">
                    <SortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
                  </th>
                  <th className="pb-2 pr-4">
                    <SortHeader label="Status" field="overallStatus" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("overallStatus")} />
                  </th>
                  <th className="pb-2 pr-4">
                    <SortHeader label="Active / Total" field="healthyCount" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("healthyCount")} />
                  </th>
                  <th className="pb-2 pr-4">
                    <SortHeader label="Total Connections" field="totalConnections" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("totalConnections")} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((org) => (
                  <tr key={org.organizationId} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-integration-${org.organizationId}`}>
                    <td className="py-3 pr-4 font-medium">{org.organizationName}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={
                        org.overallStatus === "healthy" ? "default"
                        : org.overallStatus === "failing" ? "destructive"
                        : "secondary"
                      }>
                        {org.overallStatus === "healthy" ? (
                          <><CheckCircle className="h-3 w-3 mr-1" /> Healthy</>
                        ) : org.overallStatus === "failing" ? (
                          <><XCircle className="h-3 w-3 mr-1" /> Failing</>
                        ) : org.overallStatus === "partial" ? (
                          <><AlertTriangle className="h-3 w-3 mr-1" /> Partial</>
                        ) : (
                          <><AlertTriangle className="h-3 w-3 mr-1" /> Unknown</>
                        )}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4">{org.healthyCount}/{org.totalConnections}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-1">
                        {org.connections.map((conn) => (
                          <Badge
                            key={conn.id}
                            variant={conn.status === "active" ? "outline" : conn.status === "error" ? "destructive" : "secondary"}
                            className="text-xs"
                            title={conn.lastSyncError || undefined}
                          >
                            {conn.displayName || conn.provider}
                            {conn.status === "error" && <XCircle className="h-3 w-3 ml-1" />}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
                {(!data?.organizations || data.organizations.length === 0) && (
                  <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No organizations with connected integrations</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlatformAnalyticsMonitoring() {
  const { user } = useAuth();

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div className="min-h-screen bg-background p-6">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Access denied. Platform admin access required.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-analytics-monitoring-title">Analytics & Monitoring</h1>
          <p className="text-muted-foreground text-sm">Platform usage metrics, resource monitoring, and integration health</p>
        </div>

        <Tabs defaultValue="growth" className="space-y-4">
          <div className="overflow-x-auto -mx-3 sm:-mx-6 px-3 sm:px-6">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
              <TabsTrigger value="growth" data-testid="tab-growth-revenue">
                <TrendingUp className="h-4 w-4 mr-1.5" /> Growth & Revenue
              </TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api-usage">
                <Activity className="h-4 w-4 mr-1.5" /> API Usage
              </TabsTrigger>
              <TabsTrigger value="ai" data-testid="tab-ai-usage">
                <Cpu className="h-4 w-4 mr-1.5" /> AI Usage
              </TabsTrigger>
              <TabsTrigger value="storage" data-testid="tab-storage">
                <HardDrive className="h-4 w-4 mr-1.5" /> Storage
              </TabsTrigger>
              <TabsTrigger value="integrations" data-testid="tab-integrations">
                <Link2 className="h-4 w-4 mr-1.5" /> Integrations
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="growth">
            <GrowthRevenueTab />
          </TabsContent>
          <TabsContent value="api">
            <ApiUsageTab />
          </TabsContent>
          <TabsContent value="ai">
            <AiUsageTab />
          </TabsContent>
          <TabsContent value="storage">
            <StorageTab />
          </TabsContent>
          <TabsContent value="integrations">
            <IntegrationHealthTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
