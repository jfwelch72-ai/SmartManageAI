import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Wrench,
  CreditCard,
  Megaphone,
  Plus,
  Pencil,
  Trash2,
  Archive,
  Building2,
  GitBranch,
  Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SupportUserLookup } from "@/components/platform/SupportUserLookup";
import { SupportAuditPanel } from "@/components/platform/SupportAuditPanel";
import { SupportOrgTools } from "@/components/platform/SupportOrgTools";
import { SupportSystemChecks } from "@/components/platform/SupportSystemChecks";
import { StatsCards, PlanBreakdown, type SubStats } from "@/components/platform/SubscriptionPlanCards";
import { SubscriptionDetailDialog, AssignSubscriptionDialog } from "@/components/platform/SubscriptionAddonsPanel";
import { SubscriptionOrgList } from "@/components/platform/SubscriptionOrgList";

type SortDirection = "asc" | "desc";

interface GlobalWorkflowTemplate {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  isPublished: boolean;
  templateData: any;
  createdAt: string;
  updatedAt: string;
}

interface Announcement {
  id: string;
  title: string;
  message: string;
  targetOrgIds: string[] | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
}

interface Organization {
  id: string;
  name: string;
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

const ENTITY_TYPES = [
  { value: "CHANGE_ORDER", label: "Change Order" },
  { value: "SOV_PAY_APP", label: "SOV Pay App" },
  { value: "TIME_APPROVAL", label: "Time Approval" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "PURCHASE_REQUEST", label: "Purchase Request" },
  { value: "VENDOR_BILL", label: "Vendor Bill" },
  { value: "TM_TICKET", label: "T&M Ticket" },
];

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

function SupportToolsTab() {
  const [activeSubTab, setActiveSubTab] = useState("users");

  return (
    <div className="space-y-6">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="space-y-6">
        <div className="w-full max-w-xs">
          <Select value={activeSubTab} onValueChange={setActiveSubTab}>
            <SelectTrigger data-testid="select-support-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="users" data-testid="tab-users">
                <span className="flex items-center gap-2"><Users className="h-4 w-4" /> All Users</span>
              </SelectItem>
              <SelectItem value="archived" data-testid="tab-archived">
                <span className="flex items-center gap-2"><Archive className="h-4 w-4" /> Archived Users</span>
              </SelectItem>
              <SelectItem value="sow" data-testid="tab-sow">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> SOW Items</span>
              </SelectItem>
              <SelectItem value="worktypes" data-testid="tab-worktypes">
                <span className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Work Types</span>
              </SelectItem>
              <SelectItem value="workflows" data-testid="tab-workflows">
                <span className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Workflow Templates</span>
              </SelectItem>
              <SelectItem value="datatools" data-testid="tab-datatools">
                <span className="flex items-center gap-2"><Database className="h-4 w-4" /> Data Tools</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value="users" className="space-y-4">
          <SupportUserLookup />
        </TabsContent>

        <TabsContent value="archived" className="space-y-4">
          <SupportAuditPanel />
        </TabsContent>

        <TabsContent value="sow" className="space-y-4">
          <SupportOrgTools tab="sow" />
        </TabsContent>

        <TabsContent value="worktypes" className="space-y-4">
          <SupportOrgTools tab="worktypes" />
        </TabsContent>

        <TabsContent value="workflows" className="space-y-4">
          <WorkflowTemplatesSection />
        </TabsContent>

        <TabsContent value="datatools" className="space-y-4">
          <SupportSystemChecks />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkflowTemplatesSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    entityType: "CHANGE_ORDER",
    isPublished: false,
    templateData: '{\n  "stages": [\n    { "name": "Draft", "stageOrder": 0, "isInitial": true },\n    { "name": "Review", "stageOrder": 1 },\n    { "name": "Approved", "stageOrder": 2, "isFinal": true }\n  ]\n}',
  });

  const { data: templates, isLoading } = useQuery<GlobalWorkflowTemplate[]>({
    queryKey: ["/api/platform/workflow-templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/platform/workflow-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      setDialogOpen(false);
      toast({ title: "Template created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/platform/workflow-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      setDialogOpen(false);
      toast({ title: "Template updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/workflow-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const togglePublishMutation = useMutation({
    mutationFn: async ({ id, isPublished }: { id: string; isPublished: boolean }) => {
      const res = await apiRequest("PATCH", `/api/platform/workflow-templates/${id}`, { isPublished });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/workflow-templates"] });
    },
  });

  const resetForm = () => {
    setForm({
      name: "",
      description: "",
      entityType: "CHANGE_ORDER",
      isPublished: false,
      templateData: '{\n  "stages": [\n    { "name": "Draft", "stageOrder": 0, "isInitial": true },\n    { "name": "Review", "stageOrder": 1 },\n    { "name": "Approved", "stageOrder": 2, "isFinal": true }\n  ]\n}',
    });
    setEditingId(null);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (t: GlobalWorkflowTemplate) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      description: t.description || "",
      entityType: t.entityType,
      isPublished: t.isPublished,
      templateData: JSON.stringify(t.templateData, null, 2),
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    let parsedData;
    try {
      parsedData = JSON.parse(form.templateData);
    } catch {
      toast({ title: "Invalid JSON", description: "Template data must be valid JSON", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name,
      description: form.description || null,
      entityType: form.entityType,
      isPublished: form.isPublished,
      templateData: parsedData,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Global Workflow Templates
              </CardTitle>
              <CardDescription>Manage workflow templates that organizations can import</CardDescription>
            </div>
            <Button onClick={openCreate} data-testid="button-create-workflow-template">
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !templates?.length ? (
            <p className="text-muted-foreground text-center py-8">No global workflow templates yet.</p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Entity Type</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map(t => (
                  <TableRow key={t.id} data-testid={`row-workflow-template-${t.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{t.name}</p>
                        {t.description && <p className="text-sm text-muted-foreground line-clamp-1">{t.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ENTITY_TYPES.find(e => e.value === t.entityType)?.label || t.entityType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.isPublished}
                        onCheckedChange={(checked) => togglePublishMutation.mutate({ id: t.id, isPublished: checked })}
                        data-testid={`switch-template-published-${t.id}`}
                      />
                    </TableCell>
                    <TableCell>{format(new Date(t.updatedAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(t)} data-testid={`button-edit-template-${t.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(t.id)} data-testid={`button-delete-template-${t.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Global Workflow Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Template name"
                data-testid="input-template-name"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional description"
                data-testid="input-template-description"
              />
            </div>
            <div>
              <Label>Entity Type</Label>
              <Select value={form.entityType} onValueChange={v => setForm(f => ({ ...f, entityType: v }))}>
                <SelectTrigger data-testid="select-template-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITY_TYPES.map(e => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isPublished}
                onCheckedChange={checked => setForm(f => ({ ...f, isPublished: checked }))}
                data-testid="switch-template-form-published"
              />
              <Label>Published (visible to organizations)</Label>
            </div>
            <div>
              <Label>Template Data (JSON)</Label>
              <Textarea
                value={form.templateData}
                onChange={e => setForm(f => ({ ...f, templateData: e.target.value }))}
                rows={10}
                className="font-mono text-sm"
                data-testid="input-template-data"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.name || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-template"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SecurityAuditTab() {
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

  if (isLoading) {
    return (
      <div className="space-y-6">
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
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">No audit report available</p>
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2" data-testid="text-audit-title">
            <Shield className="h-5 w-5" />
            Platform Security Audit
          </h2>
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
            <h3 className="text-base sm:text-xl font-bold" data-testid="text-overall-status">
              {overallStatus === 'healthy' ? 'All Checks Passed' : `${report.summary.failed} Check(s) Failed`}
            </h3>
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
                  {report.checks.map((check) => (
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
  });

  const { data: platformUsers } = useQuery<Array<{ id: string; firstName: string; lastName: string; email: string }>>({
    queryKey: ["/api/platform/users"],
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

function SubscriptionsTab() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const { data: stats, isLoading: statsLoading } = useQuery<SubStats>({
    queryKey: ["/api/platform/subscriptions/stats"],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2" data-testid="text-subscriptions-title">
          <CreditCard className="h-5 w-5" /> Subscription Management
        </h2>
        <Button onClick={() => setShowAssignDialog(true)} data-testid="button-assign-subscription">
          <Plus className="w-4 h-4 mr-2" /> Assign Subscription
        </Button>
      </div>

      {statsLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : stats ? (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-3">
            <StatsCards stats={stats} />
          </div>
          <PlanBreakdown stats={stats} />
        </div>
      ) : null}

      <SubscriptionOrgList onSelectOrg={setSelectedOrgId} />

      {selectedOrgId && (
        <SubscriptionDetailDialog
          orgId={selectedOrgId}
          open={!!selectedOrgId}
          onClose={() => setSelectedOrgId(null)}
        />
      )}

      <AssignSubscriptionDialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
      />
    </div>
  );
}

function AnnouncementsTab() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", message: "", isActive: true, expiresAt: "", targetOrgIds: "" });

  const { data: announcements, isLoading } = useQuery<Announcement[]>({
    queryKey: ["/api/platform/announcements"],
  });

  const { data: orgs } = useQuery<Organization[]>({
    queryKey: ["/api/platform/organizations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/platform/announcements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement created" });
    },
    onError: (e: Error) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/platform/announcements/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Announcement updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/platform/announcements/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
      toast({ title: "Announcement deleted" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/platform/announcements/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/announcements"] });
    },
  });

  const resetForm = () => {
    setForm({ title: "", message: "", isActive: true, expiresAt: "", targetOrgIds: "" });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      message: a.message,
      isActive: a.isActive,
      expiresAt: a.expiresAt ? a.expiresAt.split("T")[0] : "",
      targetOrgIds: a.targetOrgIds?.join(", ") || "",
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const targetOrgIds = form.targetOrgIds.trim()
      ? form.targetOrgIds.split(",").map(s => s.trim()).filter(Boolean)
      : null;
    const payload = {
      title: form.title,
      message: form.message,
      isActive: form.isActive,
      expiresAt: form.expiresAt || null,
      targetOrgIds,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const getOrgName = (id: string) => orgs?.find(o => o.id === id)?.name || id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2" data-testid="text-announcements-title">
          <Megaphone className="h-5 w-5" /> Platform Announcements
        </h2>
        <Button onClick={openCreate} className="w-full sm:w-auto" data-testid="button-create-announcement">
          <Plus className="h-4 w-4 mr-2" />
          New Announcement
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" />
            All Announcements
          </CardTitle>
          <CardDescription>{announcements?.length || 0} total announcements</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : !announcements?.length ? (
            <p className="text-muted-foreground text-center py-8">No announcements yet. Create one to get started.</p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcements.map((a) => (
                  <TableRow key={a.id} data-testid={`row-announcement-${a.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{a.title}</p>
                        <p className="text-sm text-muted-foreground line-clamp-1">{a.message}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={a.isActive}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: a.id, isActive: checked })}
                        data-testid={`switch-announcement-active-${a.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      {a.targetOrgIds?.length ? (
                        <div className="flex flex-wrap gap-1">
                          {a.targetOrgIds.slice(0, 2).map(id => (
                            <Badge key={id} variant="outline" className="text-xs">{getOrgName(id)}</Badge>
                          ))}
                          {a.targetOrgIds.length > 2 && (
                            <Badge variant="outline" className="text-xs">+{a.targetOrgIds.length - 2}</Badge>
                          )}
                        </div>
                      ) : (
                        <Badge variant="secondary">All Orgs</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.expiresAt ? format(new Date(a.expiresAt), "MMM d, yyyy") : "Never"}
                    </TableCell>
                    <TableCell>{format(new Date(a.createdAt), "MMM d, yyyy")}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(a)} data-testid={`button-edit-announcement-${a.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(a.id)} data-testid={`button-delete-announcement-${a.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Announcement" : "New Announcement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Announcement title"
                data-testid="input-announcement-title"
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                placeholder="Announcement message..."
                rows={4}
                data-testid="input-announcement-message"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isActive}
                onCheckedChange={checked => setForm(f => ({ ...f, isActive: checked }))}
                data-testid="switch-announcement-form-active"
              />
              <Label>Active</Label>
            </div>
            <div>
              <Label>Expires At (optional)</Label>
              <Input
                type="date"
                value={form.expiresAt}
                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                data-testid="input-announcement-expires"
              />
            </div>
            <div>
              <Label>Target Org IDs (comma-separated, leave empty for all)</Label>
              <Input
                value={form.targetOrgIds}
                onChange={e => setForm(f => ({ ...f, targetOrgIds: e.target.value }))}
                placeholder="Leave empty to target all organizations"
                data-testid="input-announcement-targets"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title || !form.message || createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-announcement"
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PlatformTools() {
  const { user } = useAuth();

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

  return (
    <div className="min-h-screen bg-background">
      <main className="px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-tools-title">Tools</h1>
          <p className="text-muted-foreground text-sm">Support tools, security audit, subscriptions, and announcements</p>
        </div>

        <Tabs defaultValue="support" className="space-y-4">
          <div className="overflow-x-auto -mx-3 sm:-mx-6 px-3 sm:px-6">
            <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
              <TabsTrigger value="support" data-testid="tab-support-tools">
                <Wrench className="h-4 w-4 mr-1.5" /> Support Tools
              </TabsTrigger>
              <TabsTrigger value="audit" data-testid="tab-security-audit">
                <Shield className="h-4 w-4 mr-1.5" /> Security & Audit
              </TabsTrigger>
              <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
                <CreditCard className="h-4 w-4 mr-1.5" /> Subscriptions
              </TabsTrigger>
              <TabsTrigger value="announcements" data-testid="tab-announcements">
                <Megaphone className="h-4 w-4 mr-1.5" /> Announcements
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="support">
            <SupportToolsTab />
          </TabsContent>
          <TabsContent value="audit">
            <SecurityAuditTab />
          </TabsContent>
          <TabsContent value="subscriptions">
            <SubscriptionsTab />
          </TabsContent>
          <TabsContent value="announcements">
            <AnnouncementsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
