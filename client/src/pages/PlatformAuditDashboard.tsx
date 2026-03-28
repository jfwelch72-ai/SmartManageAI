import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { 
  Shield, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  SkipForward,
  RefreshCw,
  Database,
  Users,
  Globe,
  Cpu,
  Link2,
  Clock,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

type SortDirection = "asc" | "desc";

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
      ? String(aVal ?? "").localeCompare(String(bVal ?? ""))
      : String(bVal ?? "").localeCompare(String(aVal ?? ""));
  }) : [];

  return { sorted, sortKey, sortDir, toggle };
}

function AuditSortHeader({ label, field, sortKey, sortDir, onToggle }: {
  label: string; field: string; sortKey: string; sortDir: string; onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="flex items-center gap-1 font-medium text-xs uppercase tracking-wider hover:text-foreground transition-colors" data-testid={`sort-crossaudit-${field}`}>
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortKey === field ? "text-foreground" : "text-muted-foreground"}`} />
    </button>
  );
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

interface AuditCheck {
  id: string;
  name: string;
  category: string;
  status: 'pass' | 'fail' | 'skip' | 'warn';
  message?: string;
  details?: string;
  file?: string;
  line?: number;
}

interface AuditReport {
  timestamp: string;
  gitCommit: string;
  environment: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    warnings: number;
  };
  categories: {
    [key: string]: {
      passed: number;
      failed: number;
      skipped: number;
      warnings: number;
    };
  };
  checks: AuditCheck[];
  duration: number;
}

const categoryIcons: Record<string, React.ReactNode> = {
  'database': <Database className="h-4 w-4" />,
  'tenant-isolation': <Shield className="h-4 w-4" />,
  'api-security': <Globe className="h-4 w-4" />,
  'rbac': <Users className="h-4 w-4" />,
  'integrations': <Link2 className="h-4 w-4" />,
  'ai-safety': <Cpu className="h-4 w-4" />,
};

const categoryLabels: Record<string, string> = {
  'database': 'Database Integrity',
  'tenant-isolation': 'Tenant Isolation',
  'api-security': 'API Security',
  'rbac': 'Role-Based Access',
  'integrations': 'Integrations',
  'ai-safety': 'AI Safety',
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pass':
      return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"><CheckCircle className="h-3 w-3 mr-1" /> Pass</Badge>;
    case 'fail':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Fail</Badge>;
    case 'warn':
      return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"><AlertTriangle className="h-3 w-3 mr-1" /> Warning</Badge>;
    case 'skip':
      return <Badge variant="outline"><SkipForward className="h-3 w-3 mr-1" /> Skipped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function CategoryCard({ category, stats }: { category: string; stats: { passed: number; failed: number; skipped: number; warnings: number } }) {
  const total = stats.passed + stats.failed + stats.skipped + stats.warnings;
  const passRate = total > 0 ? Math.round((stats.passed / total) * 100) : 0;
  const hasIssues = stats.failed > 0 || stats.warnings > 0;

  return (
    <Card className={hasIssues ? 'border-yellow-300 dark:border-yellow-700' : ''} data-testid={`card-category-${category}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {categoryIcons[category] || <Shield className="h-4 w-4" />}
          {categoryLabels[category] || category}
        </CardTitle>
        {stats.failed > 0 ? (
          <XCircle className="h-4 w-4 text-destructive" data-testid={`icon-${category}-fail`} />
        ) : stats.warnings > 0 ? (
          <AlertTriangle className="h-4 w-4 text-yellow-500" data-testid={`icon-${category}-warn`} />
        ) : (
          <CheckCircle className="h-4 w-4 text-green-500" data-testid={`icon-${category}-pass`} />
        )}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" data-testid={`text-${category}-rate`}>{passRate}%</div>
        <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
          <span className="text-green-600" data-testid={`text-${category}-passed`}>{stats.passed} passed</span>
          {stats.failed > 0 && <span className="text-red-600" data-testid={`text-${category}-failed`}>{stats.failed} failed</span>}
          {stats.warnings > 0 && <span className="text-yellow-600" data-testid={`text-${category}-warnings`}>{stats.warnings} warnings</span>}
          {stats.skipped > 0 && <span className="text-muted-foreground" data-testid={`text-${category}-skipped`}>{stats.skipped} skipped</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportAsJson(report: AuditReport) {
  const timestamp = new Date(report.timestamp).toISOString().slice(0, 10);
  downloadFile(JSON.stringify(report, null, 2), `audit-report-${timestamp}.json`, 'application/json');
}

function exportAsCsv(report: AuditReport) {
  const headers = ['ID', 'Name', 'Category', 'Status', 'Message', 'Details', 'File', 'Line'];
  const escCsv = (val: string | number | undefined | null) => {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const rows = report.checks.map(c => [
    escCsv(c.id), escCsv(c.name), escCsv(c.category), escCsv(c.status),
    escCsv(c.message), escCsv(c.details), escCsv(c.file), escCsv(c.line)
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const timestamp = new Date(report.timestamp).toISOString().slice(0, 10);
  downloadFile(csv, `audit-report-${timestamp}.csv`, 'text/csv');
}

function CrossOrgAuditLogTab() {
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

  const { sorted, sortKey, sortDir, toggle } = useSortable<AuditLogEntry>(
    data?.entries, "createdAt"
  );

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
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Select value={action || "all"} onValueChange={(v) => { setAction(v === "all" ? "" : v); setPage(1); }}>
            <SelectTrigger data-testid="select-crossaudit-action">
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
            <SelectTrigger data-testid="select-crossaudit-entity-type">
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
            <SelectTrigger data-testid="select-crossaudit-org">
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
            <SelectTrigger data-testid="select-crossaudit-user">
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
            data-testid="input-crossaudit-start-date"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            data-testid="input-crossaudit-end-date"
          />
        </div>

        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Showing {data?.entries.length || 0} of {data?.total.toLocaleString() || 0} entries
            </div>
            <ScrollArea className="h-[500px]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-crossorg-audit-logs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-3">
                        <AuditSortHeader label="Time" field="createdAt" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("createdAt")} />
                      </th>
                      <th className="pb-2 pr-3">
                        <AuditSortHeader label="Action" field="action" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("action")} />
                      </th>
                      <th className="pb-2 pr-3">
                        <AuditSortHeader label="Entity" field="entityType" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("entityType")} />
                      </th>
                      <th className="pb-2 pr-3">
                        <AuditSortHeader label="User" field="userName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("userName")} />
                      </th>
                      <th className="pb-2 pr-3">
                        <AuditSortHeader label="Organization" field="organizationName" sortKey={String(sortKey)} sortDir={sortDir} onToggle={() => toggle("organizationName")} />
                      </th>
                      <th className="pb-2 font-medium text-xs uppercase tracking-wider">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/50" data-testid={`row-crossaudit-${entry.id}`}>
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

            {data && data.totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between pt-4 gap-2">
                <div className="text-xs sm:text-sm text-muted-foreground">
                  Page {data.page} of {data.totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    data-testid="button-crossaudit-prev"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" /> <span className="hidden sm:inline">Previous</span><span className="sm:hidden">Prev</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                    disabled={page >= data.totalPages}
                    data-testid="button-crossaudit-next"
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

export default function PlatformAuditDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: report, isLoading, refetch } = useQuery<AuditReport>({
    queryKey: ["/api/platform/audit-report"],
  });

  const runAuditMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/platform/run-audit', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to run audit');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Audit started", description: "Running full platform audit. Results will appear in ~5 seconds." });
      const pollInterval = setInterval(() => {
        refetch();
      }, 2000);
      setTimeout(() => {
        clearInterval(pollInterval);
        queryClient.invalidateQueries({ queryKey: ["/api/platform/audit-report"] });
      }, 10000);
    },
    onError: (error) => {
      toast({ 
        title: "Audit failed", 
        description: error instanceof Error ? error.message : "Failed to run audit",
        variant: "destructive"
      });
    }
  });

  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen bg-background px-3 sm:px-6 py-4 sm:py-6">
        <Alert variant="destructive">
          <Shield className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            This page is only accessible to Super Administrators.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Platform Security Audit</h1>
            <p className="text-muted-foreground text-sm">Loading audit results...</p>
          </div>
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-background px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Platform Security Audit</h1>
            <p className="text-muted-foreground text-sm">No audit report available</p>
          </div>
          <Button onClick={() => runAuditMutation.mutate()} disabled={runAuditMutation.isPending} className="w-full sm:w-auto">
            <RefreshCw className={`h-4 w-4 mr-2 ${runAuditMutation.isPending ? 'animate-spin' : ''}`} />
            Run Audit
          </Button>
        </div>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Audit Data</AlertTitle>
          <AlertDescription>
            Run the platform audit to generate a security report. This will check database integrity, 
            tenant isolation, RBAC compliance, API security, and integration health.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const failedChecks = report.checks.filter(c => c.status === 'fail');
  const warningChecks = report.checks.filter(c => c.status === 'warn');
  const overallStatus = report.summary.failed === 0 ? 'healthy' : 'failing';

  return (
    <div className="min-h-screen bg-background px-3 sm:px-6 py-4 sm:py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-audit-title">
            <Shield className="h-6 w-6" />
            Platform Security Audit
          </h1>
          <div className="text-muted-foreground text-xs sm:text-sm mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {new Date(report.timestamp).toLocaleString()}</span>
            <span className="hidden sm:inline">|</span>
            <span>Git: {report.gitCommit}</span>
            <span className="hidden sm:inline">|</span>
            <span>Duration: {report.duration}ms</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="button-export-audit">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportAsJson(report)} data-testid="button-export-json">
                <FileJson className="h-4 w-4 mr-2" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAsCsv(report)} data-testid="button-export-csv">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button 
            onClick={() => runAuditMutation.mutate()} 
            disabled={runAuditMutation.isPending}
            data-testid="button-run-audit"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${runAuditMutation.isPending ? 'animate-spin' : ''}`} />
            Run Audit
          </Button>
        </div>
      </div>

      <div className={`p-3 sm:p-4 rounded-lg ${overallStatus === 'healthy' ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'}`}>
        <div className="flex items-center gap-3">
          {overallStatus === 'healthy' ? (
            <CheckCircle className="h-6 w-6 sm:h-8 sm:w-8 text-green-600 shrink-0" />
          ) : (
            <XCircle className="h-6 w-6 sm:h-8 sm:w-8 text-red-600 shrink-0" />
          )}
          <div className="min-w-0">
            <h2 className="text-base sm:text-xl font-bold" data-testid="text-overall-status">
              {overallStatus === 'healthy' ? 'All Checks Passed' : `${report.summary.failed} Check(s) Failed`}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {report.summary.passed} passed, {report.summary.warnings} warnings, {report.summary.skipped} skipped out of {report.summary.total} total checks
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(report.categories).map(([category, stats]) => (
          <CategoryCard key={category} category={category} stats={stats!} />
        ))}
      </div>

      <Tabs defaultValue={failedChecks.length > 0 ? 'failed' : 'all'} className="space-y-4">
        <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
            <TabsTrigger value="all" className="text-xs sm:text-sm">All ({report.summary.total})</TabsTrigger>
            <TabsTrigger value="failed" className={`text-xs sm:text-sm ${failedChecks.length > 0 ? 'text-red-600' : ''}`}>
              Failed ({failedChecks.length})
            </TabsTrigger>
            <TabsTrigger value="warnings" className={`text-xs sm:text-sm ${warningChecks.length > 0 ? 'text-yellow-600' : ''}`}>
              Warnings ({warningChecks.length})
            </TabsTrigger>
            <TabsTrigger value="crossorg-audit" data-testid="tab-crossorg-audit" className="text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" /> Audit Logs
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Audit Checks</CardTitle>
              <CardDescription>Complete list of security and compliance checks</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {report.checks.map((check, i) => (
                    <div key={check.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded hover:bg-muted/50 gap-1 sm:gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{check.name}</p>
                        {check.message && (
                          <p className="text-xs text-muted-foreground truncate">{check.message}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="outline" className="text-xs">{check.category}</Badge>
                        <StatusBadge status={check.status} />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="failed">
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">Failed Checks</CardTitle>
              <CardDescription>These issues require immediate attention</CardDescription>
            </CardHeader>
            <CardContent>
              {failedChecks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No failed checks</p>
              ) : (
                <div className="space-y-4">
                  {failedChecks.map((check) => (
                    <Alert key={check.id} variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertTitle>{check.name}</AlertTitle>
                      <AlertDescription>
                        <p>{check.message}</p>
                        {check.file && (
                          <p className="text-xs mt-1">File: {check.file}{check.line ? `:${check.line}` : ''}</p>
                        )}
                        {check.details && (
                          <p className="text-xs mt-1">{check.details}</p>
                        )}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warnings">
          <Card>
            <CardHeader>
              <CardTitle className="text-yellow-600">Warning Checks</CardTitle>
              <CardDescription>These items should be reviewed</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                {warningChecks.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No warnings</p>
                ) : (
                  <div className="space-y-2">
                    {warningChecks.map((check) => (
                      <div key={check.id} className="p-3 border rounded-lg border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{check.name}</p>
                          <Badge variant="outline" className="text-xs">{check.category}</Badge>
                        </div>
                        {check.message && (
                          <p className="text-sm text-muted-foreground mt-1">{check.message}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crossorg-audit">
          <CrossOrgAuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
