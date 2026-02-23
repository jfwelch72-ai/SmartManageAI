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
  Clock
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
      <div className="min-h-screen bg-background p-6">
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
      <div className="min-h-screen bg-background p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Platform Security Audit</h1>
            <p className="text-muted-foreground">Loading audit results...</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
      <div className="min-h-screen bg-background p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Platform Security Audit</h1>
            <p className="text-muted-foreground">No audit report available</p>
          </div>
          <Button onClick={() => runAuditMutation.mutate()} disabled={runAuditMutation.isPending}>
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
          <p className="text-muted-foreground flex items-center gap-2 text-sm sm:text-base">
            <Clock className="h-4 w-4" />
            Last run: {new Date(report.timestamp).toLocaleString()} | 
            Git: {report.gitCommit} | 
            Duration: {report.duration}ms
          </p>
        </div>
        <Button 
          onClick={() => runAuditMutation.mutate()} 
          disabled={runAuditMutation.isPending}
          data-testid="button-run-audit"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${runAuditMutation.isPending ? 'animate-spin' : ''}`} />
          Run Audit
        </Button>
      </div>

      <div className={`p-4 rounded-lg ${overallStatus === 'healthy' ? 'bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800'}`}>
        <div className="flex items-center gap-3">
          {overallStatus === 'healthy' ? (
            <CheckCircle className="h-8 w-8 text-green-600" />
          ) : (
            <XCircle className="h-8 w-8 text-red-600" />
          )}
          <div>
            <h2 className="text-xl font-bold" data-testid="text-overall-status">
              {overallStatus === 'healthy' ? 'All Checks Passed' : `${report.summary.failed} Check(s) Failed`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {report.summary.passed} passed, {report.summary.warnings} warnings, {report.summary.skipped} skipped out of {report.summary.total} total checks
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Object.entries(report.categories).map(([category, stats]) => (
          <CategoryCard key={category} category={category} stats={stats!} />
        ))}
      </div>

      <Tabs defaultValue={failedChecks.length > 0 ? 'failed' : 'all'} className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Checks ({report.summary.total})</TabsTrigger>
          <TabsTrigger value="failed" className={failedChecks.length > 0 ? 'text-red-600' : ''}>
            Failed ({failedChecks.length})
          </TabsTrigger>
          <TabsTrigger value="warnings" className={warningChecks.length > 0 ? 'text-yellow-600' : ''}>
            Warnings ({warningChecks.length})
          </TabsTrigger>
        </TabsList>

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
                    <div key={check.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{check.name}</p>
                        {check.message && (
                          <p className="text-xs text-muted-foreground truncate">{check.message}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
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
      </Tabs>
    </div>
  );
}
