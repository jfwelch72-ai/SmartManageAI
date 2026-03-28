import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Activity,
  Cpu,
  HardDrive,
  Link2,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  createdAt: string;
  userName: string;
  userEmail: string;
  organizationId: string | null;
  organizationName: string | null;
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

function AuditLogTable({ entries, testIdPrefix }: { entries: AuditLogEntry[]; testIdPrefix: string }) {
  const { sorted, sortKey, sortDir, toggle } = useSortable<AuditLogEntry>(
    entries, "createdAt"
  );

  return (
    <ScrollArea className="h-[500px]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-${testIdPrefix}-logs`}>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-3">
                <SortHeader label="Time" field="createdAt" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("createdAt")} />
              </th>
              <th className="pb-2 pr-3">
                <SortHeader label="Action" field="action" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("action")} />
              </th>
              <th className="pb-2 pr-3">
                <SortHeader label="Entity" field="entityType" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("entityType")} />
              </th>
              <th className="pb-2 pr-3">
                <SortHeader label="User" field="userName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("userName")} />
              </th>
              <th className="pb-2 pr-3">
                <SortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
              </th>
              <th className="pb-2 font-medium text-xs uppercase tracking-wider">IP</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-${testIdPrefix}-${entry.id}`}>
                <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()}
                </td>
                <td className="py-2 pr-3">
                  <Badge variant={
                    entry.action === "DELETE" ? "destructive"
                    : entry.action === "CREATE" ? "default"
                    : "secondary"
                  }>{entry.action}</Badge>
                </td>
                <td className="py-2 pr-3">
                  <span className="font-medium">{entry.entityType}</span>
                  <span className="text-xs text-muted-foreground ml-1 break-all">({entry.entityId.substring(0, 8)}...)</span>
                </td>
                <td className="py-2 pr-3">
                  <div>{entry.userName}</div>
                  <div className="text-xs text-muted-foreground">{entry.userEmail}</div>
                </td>
                <td className="py-2 pr-3 text-sm">{entry.organizationName || "N/A"}</td>
                <td className="py-2 text-xs text-muted-foreground">{entry.ipAddress || "\u2014"}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No audit entries found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </ScrollArea>
  );
}

function AuditLogTab() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [orgId, setOrgId] = useState("");
  const [userId, setUserId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const pageSize = 50;

  const queryParams = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (action) queryParams.set("action", action);
  if (entityType) queryParams.set("entityType", entityType);
  if (orgId) queryParams.set("orgId", orgId);
  if (userId) queryParams.set("userId", userId);
  if (startDate) queryParams.set("startDate", startDate);
  if (endDate) queryParams.set("endDate", endDate);

  const { data, isLoading } = useQuery<{
    entries: AuditLogEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    filters: { actions: string[]; entityTypes: string[] };
  }>({
    queryKey: ["/api/platform/monitoring/audit-logs", page, action, entityType, orgId, userId, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/platform/monitoring/audit-logs?${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: orgs } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/platform/organizations"],
    queryFn: async () => {
      const res = await fetch("/api/platform/organizations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: platformUsers } = useQuery<Array<{ id: string; firstName: string; lastName: string; email: string }>>({
    queryKey: ["/api/platform/users"],
    queryFn: async () => {
      const res = await fetch("/api/platform/users", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Cross-Organization Audit Logs
        </CardTitle>
        <CardDescription>Search and filter audit entries across all organizations</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Select value={action || "all"} onValueChange={(v) => { setAction(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger data-testid="select-audit-action">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {data?.filters.actions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={entityType || "all"} onValueChange={(v) => { setEntityType(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger data-testid="select-audit-entity-type">
              <SelectValue placeholder="Entity Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entity Types</SelectItem>
              {data?.filters.entityTypes.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={orgId || "all"} onValueChange={(v) => { setOrgId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger data-testid="select-audit-org">
              <SelectValue placeholder="Organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Organizations</SelectItem>
              {orgs?.map((org) => (
                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={userId || "all"} onValueChange={(v) => { setUserId(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger data-testid="select-audit-user">
              <SelectValue placeholder="User" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {platformUsers?.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            placeholder="Start Date"
            data-testid="input-audit-start-date"
          />

          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            placeholder="End Date"
            data-testid="input-audit-end-date"
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Showing {data?.entries.length || 0} of {data?.total.toLocaleString() || 0} entries
            </div>

            <AuditLogTable
              entries={data?.entries || []}
              testIdPrefix="audit"
            />

            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <div className="text-sm text-muted-foreground">
                  Page {data.page} of {data.totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    data-testid="button-audit-prev"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                    disabled={page >= data.totalPages}
                    data-testid="button-audit-next"
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function PlatformMonitoring() {
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
    <div className="min-h-screen bg-background px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-monitoring-title">Platform Monitoring</h1>
        <p className="text-muted-foreground text-sm sm:text-base">Resource usage, integration health, and cross-organization audit logs</p>
      </div>

      <Tabs defaultValue="api" className="space-y-4">
        <TabsList className="flex flex-wrap">
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
          <TabsTrigger value="audit" data-testid="tab-audit-logs">
            <FileText className="h-4 w-4 mr-1.5" /> Audit Logs
          </TabsTrigger>
        </TabsList>

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
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
