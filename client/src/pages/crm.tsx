import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AIAnalysisButton } from "@/components/AIAnalysisButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ComplianceBadge } from "@/components/ComplianceBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Building2,
  Plus,
  Search,
  MapPin,
  Package,
  AlertCircle,
  X,
  ShieldAlert,
  TrendingUp,
  Users,
  Mail,
  Phone,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Filter,
  BarChart2,
  Download,
  ChevronRight,
  DollarSign,
  Brain,
  CheckSquare,
  FileText,
  Settings as SettingsIcon,
  Rows3,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTableDensity, TABLE_DENSITY_OPTIONS } from "@/hooks/use-table-density";
import { Link } from "wouter";
import CrmPipelineView from "@/components/crm/CrmPipelineView";
import { CrmTasksView } from "@/components/crm/CrmTasksView";
import { CrmQuotesView } from "@/components/crm/CrmQuotesView";
import { CrmAnalyticsView } from "@/components/crm/CrmAnalyticsView";
import type {
  CrmOrganisation as CrmOrganization,
  CrmContact,
  Project,
} from "@shared/schema";
import { useCrmMutations } from "@/hooks/useCrmMutations";
import { EmptyState } from "@/components/EmptyState";
import {
  CrmOrgDialogs,
  type OrgFormState,
} from "@/components/crm/CrmOrgDialogs";
import { CrmContactDialogs } from "@/components/crm/CrmContactDialogs";
import { EnrollSequenceDialog } from "@/components/crm/EnrollSequenceDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { CrmOrgDetail } from "@/components/crm/CrmOrgDetail";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OrganizationType =
  | "CONTRACTOR"
  | "SUBCONTRACTOR"
  | "SUPPLIER"
  | "VENDOR"
  | "OWNER_REP"
  | "RENTAL_VENDOR";
type ContactRole =
  | "PM"
  | "ESTIMATOR"
  | "SUPERINTENDENT"
  | "SALES"
  | "ACCOUNTS_PAYABLE"
  | "ACCOUNTS_RECEIVABLE"
  | "OWNER"
  | "GENERAL_MANAGER"
  | "FOREMAN"
  | "OTHER";

interface OrganizationWithContacts extends CrmOrganization {
  contacts: CrmContact[];
  customFields?: Record<string, unknown>;
}

type CrmContactWithCustomFields = CrmContact & { customFields?: Record<string, unknown> };

const TYPE_LABELS: Record<OrganizationType, string> = {
  CONTRACTOR: "GC / Contractor",
  SUBCONTRACTOR: "Subcontractor",
  SUPPLIER: "Supplier",
  VENDOR: "Vendor",
  SERVICE_VENDOR: "Service Vendor",
  OWNER_REP: "Owner Rep",
  RENTAL_VENDOR: "Rental Vendor",
};

const TYPE_COLORS: Record<OrganizationType, string> = {
  CONTRACTOR: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SUBCONTRACTOR:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SUPPLIER:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  VENDOR:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  SERVICE_VENDOR:
    "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  OWNER_REP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  RENTAL_VENDOR:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

const DEFAULT_ORG: OrgFormState = {
  type: "SUBCONTRACTOR",
  name: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  website: "",
  specialties: [],
  paymentTerms: "",
  notes: "",
  crmStatus: "ACTIVE",
  licenseNumber: "",
  bondingCapacity: "",
  insuranceExpiration: "",
  tradeSpecialty: "",
  materialCategories: [],
  serviceCategory: "",
  contractExpiration: "",
  equipmentCategory: "",
  rentalTerms: "",
  companyRepresented: "",
  activeProjectIds: [],
};

const DEFAULT_CONTACT = {
  firstName: "",
  lastName: "",
  title: "",
  role: "OTHER" as ContactRole,
  email: "",
  phone: "",
  mobile: "",
  isPrimary: false,
  notes: "",
};

interface DupOrg {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  state: string | null;
  crmStatus: string;
  isActive: boolean;
}

interface DupPair {
  orgA: DupOrg;
  orgB: DupOrg;
  matchReason: string;
}

// ============================================================
// CRM Pipeline Reports Component
// ============================================================

function ContactsDensityMenu() {
  const { density, setDensity } = useTableDensity();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" title="Table density" data-testid="button-contacts-density">
          <Rows3 className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Table density</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {TABLE_DENSITY_OPTIONS.map(({ value, label, description }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setDensity(value)}
            data-testid={`menu-item-density-${value.toLowerCase()}`}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="text-sm font-medium flex items-center gap-2">
              {label}
              {density === value && <span className="text-xs text-primary">●</span>}
            </span>
            <span className="text-xs text-muted-foreground">{description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function fmt(n: number) {
  return n >= 1000000
    ? `$${(n / 1000000).toFixed(1)}M`
    : n >= 1000
    ? `$${(n / 1000).toFixed(0)}K`
    : `$${n.toFixed(0)}`;
}

function exportCsv(filename: string, headers: string[], rows: (string | number)[]) {
  const csvRows = [headers.join(","), ...rows.map(String)];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function WinLossSection({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{
    days: number; wonCount: number; lostCount: number; totalClosed: number;
    wonValue: number; lostValue: number; winRate: number; avgWonDeal: number; avgLostDeal: number;
  }>({
    queryKey: ["/api/crm/reports/win-loss", days],
    queryFn: async () => {
      const res = await fetch(`/api/crm/reports/win-loss?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: true,
  });

  const chartData = data ? [
    { label: "Won", value: data.wonCount, fill: "#22c55e" },
    { label: "Lost", value: data.lostCount, fill: "#ef4444" },
  ] : [];

  const handleExport = () => {
    if (!data) return;
    exportCsv(
      `win-loss-${days}d.csv`,
      ["Metric", "Value"],
      [
        `Won Deals,${data.wonCount}`,
        `Lost Deals,${data.lostCount}`,
        `Win Rate,${data.winRate}%`,
        `Total Won Value,${data.wonValue.toFixed(2)}`,
        `Total Lost Value,${data.lostValue.toFixed(2)}`,
        `Avg Won Deal Size,${data.avgWonDeal.toFixed(2)}`,
        `Avg Lost Deal Size,${data.avgLostDeal.toFixed(2)}`,
      ]
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-base">Win / Loss Summary</h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="button-export-winloss">
          <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
      ) : !data || data.totalClosed === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">No closed deals in this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Won", value: data.wonCount, sub: fmt(data.wonValue), color: "text-green-600 dark:text-green-400" },
                { label: "Lost", value: data.lostCount, sub: fmt(data.lostValue), color: "text-red-500 dark:text-red-400" },
                { label: "Win Rate", value: `${data.winRate}%`, sub: `of ${data.totalClosed} closed`, color: "text-primary" },
                { label: "Avg Won Deal", value: fmt(data.avgWonDeal), sub: "per deal", color: "text-foreground" },
              ].map(({ label, value, sub, color }) => (
                <div key={label} className="border rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold ${color}`} data-testid={`metric-${label.toLowerCase().replace(/ /g, "-")}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => [`${v} deals`, "Count"]} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.label} fill={entry.fill} />
                  ))}
                  <LabelList dataKey="value" position="top" style={{ fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function TimeInStageSection({ days }: { days: number }) {
  const { data, isLoading } = useQuery<{
    days: number;
    stages: { stage: string; label: string; avgDays: number; count: number }[];
  }>({
    queryKey: ["/api/crm/reports/time-in-stage", days],
    queryFn: async () => {
      const res = await fetch(`/api/crm/reports/time-in-stage?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const chartData = (data?.stages ?? []).filter(s => s.avgDays > 0);

  const handleExport = () => {
    if (!data) return;
    exportCsv(
      `time-in-stage-${days}d.csv`,
      ["Stage", "Avg Days", "Transitions"],
      data.stages.map(s => `${s.label},${s.avgDays},${s.count}`)
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-base">Time in Stage</h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="button-export-time-in-stage">
          <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : chartData.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">Not enough stage transition data in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 40, left: 80, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 12 }} unit="d" />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={80} />
            <Tooltip formatter={(v: number) => [`${v} days avg`, "Avg Time"]} />
            <Bar dataKey="avgDays" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="avgDays" position="right" style={{ fontSize: 11 }} formatter={(v: number) => `${v}d`} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function RepPerformanceSection({ days }: { days: number }) {
  type Rep = {
    repId: string; repName: string; openCount: number; pipelineValue: number;
    wonCount: number; lostCount: number; winRate: number;
  };
  const { data, isLoading } = useQuery<{ days: number; reps: Rep[] }>({
    queryKey: ["/api/crm/reports/rep-performance", days],
    queryFn: async () => {
      const res = await fetch(`/api/crm/reports/rep-performance?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  type SortKey = "repName" | "openCount" | "pipelineValue" | "wonCount" | "lostCount" | "winRate";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "pipelineValue", dir: "desc" });

  const handleSort = (key: SortKey) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "repName" ? "asc" : "desc" });
  };

  const sorted = [...(data?.reps ?? [])].sort((a, b) => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const av = a[sort.key], bv = b[sort.key];
    return typeof av === "string" && typeof bv === "string"
      ? av.localeCompare(bv) * dir
      : ((av as number) - (bv as number)) * dir;
  });

  const handleExport = () => {
    if (!data) return;
    exportCsv(
      `rep-performance-${days}d.csv`,
      ["Rep", "Open Deals", "Pipeline Value", "Won", "Lost", "Win Rate"],
      data.reps.map(r => `${r.repName},${r.openCount},${r.pipelineValue.toFixed(2)},${r.wonCount},${r.lostCount},${r.winRate}%`)
    );
  };

  const cols: { key: SortKey; label: string }[] = [
    { key: "repName", label: "Rep" },
    { key: "openCount", label: "Open Deals" },
    { key: "pipelineValue", label: "Pipeline Value" },
    { key: "wonCount", label: "Won" },
    { key: "lostCount", label: "Lost" },
    { key: "winRate", label: "Win Rate" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-base">Rep Performance</h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!data} data-testid="button-export-rep-perf">
          <Download className="w-3.5 h-3.5 mr-1.5" />Export CSV
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !data || data.reps.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">No opportunities found in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="table-rep-performance">
            <thead>
              <tr className="border-b bg-muted/40">
                {cols.map(({ key, label }) => (
                  <th
                    key={key}
                    className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                    onClick={() => handleSort(key)}
                    data-testid={`th-rep-${key}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {sort.key === key ? (
                        sort.dir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                      ) : <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((rep) => (
                <tr key={rep.repId} className="hover:bg-muted/30 transition-colors" data-testid={`row-rep-${rep.repId}`}>
                  <td className="px-4 py-3 font-medium">{rep.repName}</td>
                  <td className="px-4 py-3 text-center">{rep.openCount}</td>
                  <td className="px-4 py-3">{fmt(rep.pipelineValue)}</td>
                  <td className="px-4 py-3 text-center text-green-600 dark:text-green-400 font-medium">{rep.wonCount}</td>
                  <td className="px-4 py-3 text-center text-red-500 dark:text-red-400 font-medium">{rep.lostCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-1.5 min-w-[60px]">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${rep.winRate}%` }} />
                      </div>
                      <span className="text-xs font-medium tabular-nums">{rep.winRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RevenueForecastSection() {
  const { data, isLoading } = useQuery<{
    totalWeightedValue: number;
    openDealsCount: number;
    totalUnweightedValue: number;
    monthlyProjections: { month: string; label: string; value: number }[];
  }>({
    queryKey: ["/api/crm/reports/revenue-forecast"],
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return <p className="text-sm text-muted-foreground">No data available</p>;

  const maxValue = Math.max(...data.monthlyProjections.map(m => m.value), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-primary" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Weighted Pipeline</p>
          </div>
          <p className="text-xl font-bold text-primary" data-testid="text-weighted-pipeline">
            ${data.totalWeightedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Pipeline</p>
          </div>
          <p className="text-xl font-bold" data-testid="text-total-pipeline">
            ${data.totalUnweightedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Open Deals</p>
          </div>
          <p className="text-xl font-bold" data-testid="text-open-deals-count">{data.openDealsCount}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Monthly Projected Revenue (Next 6 Months)</p>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.monthlyProjections} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(0)}K` : `$${v}`} />
              <Tooltip
                formatter={(value: number) => [`$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, "Projected Revenue"]}
              />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: number) => v > 0 ? `$${v >= 1000 ? `${(v/1000).toFixed(0)}K` : v.toFixed(0)}` : ""}
                  style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function CrmPipelineReports() {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    revForecast: true, winLoss: true, timeInStage: true, repPerf: true,
  });

  const toggleSection = (key: string) =>
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  const sections = [
    { key: "revForecast", title: "Revenue Forecast", content: <RevenueForecastSection /> },
    { key: "winLoss", title: "Win / Loss Summary", content: <WinLossSection days={days} /> },
    { key: "timeInStage", title: "Time in Stage", content: <TimeInStageSection days={days} /> },
    { key: "repPerf", title: "Rep Performance", content: <RepPerformanceSection days={days} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pipeline Reports</h2>
          <p className="text-sm text-muted-foreground">Win/loss analysis, stage timing, and rep breakdown</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 30 | 90 | 365)}>
          <SelectTrigger className="w-[140px]" data-testid="select-report-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last 365 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sections.map(({ key, title, content }) => (
        <Card key={key}>
          <CardHeader
            className="pb-2 cursor-pointer select-none"
            onClick={() => toggleSection(key)}
            data-testid={`section-header-${key}`}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
              {openSections[key] ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {openSections[key] && (
            <CardContent>{content}</CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

export default function CRMPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [crmTab, setCrmTab] = useState<"orgs" | "contacts" | "pipeline" | "tasks" | "quotes" | "reports" | "analytics">("orgs");
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedContactIds(new Set());
  }, [crmTab, contactSearch]);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [specialtyFilters, setSpecialtyFilters] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [mergePair, setMergePair] = useState<DupPair | null>(null);
  const [mergeWinnerId, setMergeWinnerId] = useState<string>("");

  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [editOrgOpen, setEditOrgOpen] = useState(false);
  const [detailOrgOpen, setDetailOrgOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] =
    useState<OrganizationWithContacts | null>(null);

  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [viewContactOpen, setViewContactOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(
    null,
  );

  const [newOrg, setNewOrg] = useState<OrgFormState>({ ...DEFAULT_ORG });
  const [newContact, setNewContact] = useState({ ...DEFAULT_CONTACT });
  const [orgCustomFields, setOrgCustomFields] = useState<Record<string, unknown>>({});
  const [contactCustomFields, setContactCustomFields] = useState<Record<string, unknown>>({});

  // Reset custom field state when create dialogs open or close so prior edit
  // values cannot leak into a new record. (Edit flows seed from the entity.)
  const handleCreateOrgOpenChange = (open: boolean) => {
    setOrgCustomFields({});
    setCreateOrgOpen(open);
  };
  const handleCreateContactOpenChange = (open: boolean) => {
    setContactCustomFields({});
    setCreateContactOpen(open);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    const tabMap: Record<string, "orgs" | "contacts" | "pipeline" | "tasks" | "quotes" | "reports" | "analytics"> = {
      orgs: "orgs",
      organisations: "orgs",
      organizations: "orgs",
      vendors: "orgs",
      subcontractors: "orgs",
      contacts: "contacts",
      pipeline: "pipeline",
      opportunities: "pipeline",
      deals: "pipeline",
      tasks: "tasks",
      activities: "tasks",
      quotes: "quotes",
      reports: "reports",
      analytics: "analytics",
    };
    if (tabParam && tabMap[tabParam]) {
      setCrmTab(tabMap[tabParam]);
    }
    const newParam = params.get("new");
    if (newParam === "1" || newParam === "true" || newParam === "call") {
      const target = tabParam ? tabMap[tabParam] : "orgs";
      if (target === "contacts") setCreateContactOpen(true);
      else if (target === "orgs") setCreateOrgOpen(true);
      else if (target === "pipeline") {
        setCrmTab("pipeline");
        setTimeout(() => window.dispatchEvent(new CustomEvent("crm:open-create-deal")), 50);
      } else setCrmTab(target ?? "orgs");
    }
    const orgId = params.get("organisationId") || params.get("organizationId");
    if (orgId) {
      setCrmTab("orgs");
      fetch(`/api/crm/organisations/${encodeURIComponent(orgId)}`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((org) => {
          if (org) {
            setSelectedOrg(org as OrganizationWithContacts);
            setDetailOrgOpen(true);
          }
        })
        .catch(() => undefined);
    }
    const contactId = params.get("contactId");
    if (contactId) {
      setCrmTab("contacts");
      fetch(`/api/crm/contacts/${encodeURIComponent(contactId)}`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : null))
        .then((contact) => {
          if (contact) {
            setSelectedContact(contact as CrmContact);
            setViewContactOpen(true);
          }
        })
        .catch(() => undefined);
    }
    if (tabParam || newParam || orgId || contactId) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("organisationId");
      url.searchParams.delete("organizationId");
      url.searchParams.delete("contactId");
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : ""));
    }
  }, []);

  const orgQueryParams = {
    search: searchTerm,
    type: selectedType !== "all" ? selectedType : "",
    status: statusFilter !== "all" ? statusFilter : "",
    state: stateFilter,
    specialties: specialtyFilters,
  };

  const { data: organizations, isLoading: orgsLoading } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations", orgQueryParams],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgQueryParams.search) params.set("search", orgQueryParams.search);
      if (orgQueryParams.type) params.set("type", orgQueryParams.type);
      if (orgQueryParams.status) params.set("status", orgQueryParams.status);
      if (orgQueryParams.state) params.set("state", orgQueryParams.state);
      orgQueryParams.specialties.forEach((s) => params.append("specialty", s));
      const res = await fetch(`/api/crm/organisations?${params}`);
      if (!res.ok) throw new Error("Failed to fetch organizations");
      return res.json();
    },
  });

  const { data: projectsResponse } = useQuery<{ data: Project[] }>({
    queryKey: ["/api/projects"],
  });
  const allProjects = projectsResponse?.data || [];

  interface ComplianceItem {
    orgId: string;
    orgName: string;
    orgType: string;
    complianceType: string;
    expirationDate: string;
    status: "expired" | "expiring_soon";
    daysUntilExpiration: number;
  }
  const { data: complianceData } = useQuery<{
    total: number;
    expired: number;
    expiringSoon: number;
    items: ComplianceItem[];
  }>({
    queryKey: ["/api/crm/organisations/expiring-compliance"],
  });

  interface AllContact extends CrmContact {
    orgName?: string | null;
    orgType?: string | null;
  }
  const { data: allContacts = [], isLoading: contactsLoading } = useQuery<AllContact[]>({
    queryKey: ["/api/crm/contacts", { search: contactSearch }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (contactSearch) params.set("search", contactSearch);
      const res = await fetch(`/api/crm/contacts?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: crmTab === "contacts",
  });

  const ROLE_LABELS: Record<string, string> = {
    PM: "Project Manager", ESTIMATOR: "Estimator", SUPERINTENDENT: "Superintendent",
    SALES: "Sales", ACCOUNTS_PAYABLE: "Accounts Payable", ACCOUNTS_RECEIVABLE: "Accounts Receivable",
    OWNER: "Owner", GENERAL_MANAGER: "General Manager", FOREMAN: "Foreman", OTHER: "Other",
  };

  type ContactSortKey = "name" | "role" | "orgName" | "email" | "phone";
  const [contactSort, setContactSort] = useState<{ key: ContactSortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const sortedContacts = [...allContacts].sort((a, b) => {
    const dir = contactSort.dir === "asc" ? 1 : -1;
    const getVal = (c: AllContact): string => {
      if (contactSort.key === "name") return `${c.firstName ?? ""} ${c.lastName ?? ""}`.toLowerCase();
      if (contactSort.key === "role") return (ROLE_LABELS[c.role as string] || c.role || "").toLowerCase();
      if (contactSort.key === "orgName") return (c.orgName ?? "").toLowerCase();
      if (contactSort.key === "email") return (c.email ?? "").toLowerCase();
      if (contactSort.key === "phone") return (c.phone ?? "").toLowerCase();
      return "";
    };
    return getVal(a) < getVal(b) ? -dir : getVal(a) > getVal(b) ? dir : 0;
  });

  const handleContactSort = (key: ContactSortKey) => {
    setContactSort((prev) => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };

  const isAdminOrManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: dupData, isLoading: dupLoading } = useQuery<{ pairs: DupPair[]; total: number }>({
    queryKey: ["/api/crm/organisations/duplicates"],
    enabled: dupOpen && isAdminOrManager,
  });

  const mergeMutation = useMutation({
    mutationFn: async ({ winnerId, loserId }: { winnerId: string; loserId: string }) =>
      apiRequest("POST", `/api/crm/organisations/${winnerId}/merge/${loserId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations/duplicates"] });
      toast({ title: "Merged", description: "Organizations merged successfully." });
      setMergePair(null);
      setMergeWinnerId("");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to merge organizations.", variant: "destructive" });
    },
  });

  const mutations = useCrmMutations(selectedOrg?.id);

  const createOrgMutationWrapped = {
    ...mutations.createOrgMutation,
    mutate: (data: any) => {
      mutations.createOrgMutation.mutate({ ...data, customFields: orgCustomFields }, {
        onSuccess: () => {
          setCreateOrgOpen(false);
          setNewOrg({ ...DEFAULT_ORG });
          setOrgCustomFields({});
        },
      });
    },
  };

  const updateOrgMutationWrapped = {
    ...mutations.updateOrgMutation,
    mutate: (data: any) => {
      mutations.updateOrgMutation.mutate({ ...data, customFields: orgCustomFields }, {
        onSuccess: () => {
          setEditOrgOpen(false);
        },
      });
    },
  };

  const createContactMutationWrapped = {
    ...mutations.createContactMutation,
    mutate: (data: any) => {
      mutations.createContactMutation.mutate({ ...data, customFields: contactCustomFields }, {
        onSuccess: () => {
          setCreateContactOpen(false);
          setNewContact({ ...DEFAULT_CONTACT });
          setContactCustomFields({});
        },
      });
    },
  };

  const updateContactMutationWrapped = {
    ...mutations.updateContactMutation,
    mutate: (data: any) => {
      mutations.updateContactMutation.mutate({ ...data, customFields: contactCustomFields }, {
        onSuccess: () => {
          setEditContactOpen(false);
        },
      });
    },
  };

  const deleteOrgMutationWrapped = {
    ...mutations.deleteOrgMutation,
    mutate: (id: string) => {
      mutations.deleteOrgMutation.mutate(id, {
        onSuccess: () => {
          setDetailOrgOpen(false);
          setSelectedOrg(null);
        },
      });
    },
  };

  const { data: allOrgsForOptions } = useQuery<CrmOrganization[]>({
    queryKey: ["/api/crm/organisations", "options"],
    queryFn: async () => {
      const res = await fetch("/api/crm/organisations");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const uniqueSpecialties = useMemo(() => {
    const allSpecialties =
      (allOrgsForOptions ?? []).flatMap((org) => org.specialties || []);
    return Array.from(new Set(allSpecialties)).sort();
  }, [allOrgsForOptions]);

  const uniqueStates = useMemo(() => {
    const states = (allOrgsForOptions ?? []).map((o) => o.state).filter(Boolean) as string[];
    return Array.from(new Set(states)).sort();
  }, [allOrgsForOptions]);

  const filteredOrganizations = organizations ?? [];

  const orgCounts = {
    total: organizations?.length || 0,
    activeOnProjects:
      organizations?.filter((o) => (o.activeProjectIds?.length || 0) > 0)
        .length || 0,
    complianceIssues:
      organizations?.filter((o) => o.crmStatus === "COMPLIANCE_ISSUE").length ||
      0,
    inactive:
      organizations?.filter((o) => o.crmStatus === "INACTIVE").length || 0,
  };

  const openOrgDetail = (org: CrmOrganization) => {
    setSelectedOrg(org as OrganizationWithContacts);
    setDetailOrgOpen(true);
  };

  const openEditOrg = (org: CrmOrganization) => {
    setNewOrg({
      type: org.type as OrganizationType,
      name: org.name,
      address: org.address || "",
      city: org.city || "",
      state: org.state || "",
      zipCode: org.zipCode || "",
      website: org.website || "",
      specialties: org.specialties || [],
      paymentTerms: org.paymentTerms || "",
      notes: org.notes || "",
      crmStatus:
        (org.crmStatus as
          | "ACTIVE"
          | "PREQUALIFIED"
          | "COMPLIANCE_ISSUE"
          | "INACTIVE") || "ACTIVE",
      licenseNumber: org.licenseNumber || "",
      bondingCapacity: org.bondingCapacity || "",
      insuranceExpiration: org.insuranceExpiration
        ? new Date(org.insuranceExpiration).toISOString().split("T")[0]
        : "",
      tradeSpecialty: org.tradeSpecialty || "",
      materialCategories: org.materialCategories || [],
      serviceCategory: org.serviceCategory || "",
      contractExpiration: org.contractExpiration
        ? new Date(org.contractExpiration).toISOString().split("T")[0]
        : "",
      equipmentCategory: org.equipmentCategory || "",
      rentalTerms: org.rentalTerms || "",
      companyRepresented: org.companyRepresented || "",
      activeProjectIds: org.activeProjectIds || [],
    });
    setOrgCustomFields(org.customFields ?? {});
    setSelectedOrg(org as OrganizationWithContacts);
    setEditOrgOpen(true);
  };

  const openEditContact = (contact: CrmContactWithCustomFields) => {
    setNewContact({
      firstName: contact.firstName,
      lastName: contact.lastName,
      title: contact.title || "",
      role: contact.role as ContactRole,
      email: contact.email || "",
      phone: contact.phone || "",
      mobile: contact.mobile || "",
      isPrimary: contact.isPrimary,
      notes: contact.notes || "",
    });
    setContactCustomFields(contact.customFields ?? {});
    setSelectedContact(contact);
    setEditContactOpen(true);
  };

  if (!user) return null;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <main className="flex-1 container mx-auto max-w-full px-4 py-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1
                className="text-2xl font-bold text-foreground"
                data-testid="text-page-title"
              >
                Customer Relationship Management
              </h1>
              <p className="text-muted-foreground">
                Manage contractors, subcontractors, suppliers, and vendors
              </p>
            </div>
            <div className="flex gap-2">
              <AIAnalysisButton module="VENDOR_PRICING" />
              <Button variant="outline" asChild data-testid="button-crm-settings">
                <Link href="/crm-settings">
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  CRM Settings
                </Link>
              </Button>
              {crmTab === "orgs" && isAdminOrManager && (
                <Button
                  variant="outline"
                  onClick={() => setDupOpen(true)}
                  data-testid="button-find-duplicates"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Find Duplicates
                </Button>
              )}
              {crmTab === "orgs" && (
                <Button
                  onClick={() => setCreateOrgOpen(true)}
                  data-testid="button-add-organization"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Organization
                </Button>
              )}
            </div>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 border-b overflow-x-auto" data-testid="crm-tab-switcher">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "orgs" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("orgs")}
              data-testid="tab-organizations"
            >
              <Building2 className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Organizations</span>
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "contacts" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("contacts")}
              data-testid="tab-contacts"
            >
              <Users className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Contacts</span>
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "pipeline" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("pipeline")}
              data-testid="tab-sales-pipeline"
            >
              <TrendingUp className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Pipeline</span>
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "tasks" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("tasks")}
              data-testid="tab-tasks"
            >
              <CheckSquare className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Tasks</span>
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "quotes" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("quotes")}
              data-testid="tab-quotes"
            >
              <FileText className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Quotes</span>
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "analytics" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("analytics")}
              data-testid="tab-crm-analytics"
            >Analytics</button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${crmTab === "reports" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => setCrmTab("reports")}
              data-testid="tab-pipeline-reports"
            >
              <BarChart2 className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              <span className="whitespace-nowrap">Reports</span>
            </button>
          </div>

          {crmTab === "pipeline" && <CrmPipelineView />}

          {crmTab === "tasks" && <CrmTasksView />}

          {crmTab === "quotes" && <CrmQuotesView />}

          {crmTab === "analytics" && <CrmAnalyticsView />}
          {crmTab === "reports" && <CrmPipelineReports />}

          {crmTab === "contacts" && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    All Contacts
                    {!contactsLoading && (
                      <Badge variant="secondary" className="ml-1 text-xs font-normal">{allContacts.length}</Badge>
                    )}
                    {selectedContactIds.size > 0 && (
                      <span className="ml-2 flex items-center gap-2" data-testid="bulk-contact-actions">
                        <Badge variant="default" className="text-xs">{selectedContactIds.size} selected</Badge>
                        <EnrollSequenceDialog
                          contactIds={Array.from(selectedContactIds)}
                          trigger={
                            <Button size="sm" variant="outline" data-testid="button-bulk-enroll-sequence">
                              <Mail className="h-4 w-4 mr-1" />
                              Enroll {selectedContactIds.size} in sequence
                            </Button>
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedContactIds(new Set())}
                          data-testid="button-clear-contact-selection"
                        >
                          Clear
                        </Button>
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2 flex-1 max-w-sm">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name, email, or organization..."
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        className="pl-9"
                        data-testid="input-contacts-search"
                      />
                    </div>
                    <ContactsDensityMenu />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {contactsLoading ? (
                  <div className="space-y-2 p-6">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : allContacts.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No contacts found"
                    description={contactSearch ? "Try a different search term." : "Add contacts inside an organization to see them here."}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid="table-contacts">
                      <thead>
                        <tr className="border-b bg-muted/40">
                          <th className="px-4 py-3 w-10">
                            {(() => {
                              const visibleSelected = sortedContacts.filter((c) => selectedContactIds.has(c.id)).length;
                              const allSelected = sortedContacts.length > 0 && visibleSelected === sortedContacts.length;
                              const someSelected = visibleSelected > 0 && !allSelected;
                              const checkedValue: boolean | "indeterminate" = allSelected
                                ? true
                                : someSelected
                                  ? "indeterminate"
                                  : false;
                              return (
                                <Checkbox
                                  checked={checkedValue}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedContactIds(new Set(sortedContacts.map((c) => c.id)));
                                    } else {
                                      setSelectedContactIds(new Set());
                                    }
                                  }}
                                  aria-label="Select all contacts"
                                  data-testid="checkbox-select-all-contacts"
                                />
                              );
                            })()}
                          </th>
                          {(
                            [
                              { key: "name", label: "Name" },
                              { key: "role", label: "Role" },
                              { key: "orgName", label: "Organization" },
                              { key: "email", label: "Email" },
                              { key: "phone", label: "Phone" },
                            ] as { key: ContactSortKey; label: string }[]
                          ).map(({ key, label }) => (
                            <th
                              key={key}
                              className="px-4 py-3 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
                              onClick={() => handleContactSort(key)}
                              data-testid={`th-contact-${key}`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {label}
                                {contactSort.key === key ? (
                                  contactSort.dir === "asc" ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )
                                ) : (
                                  <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
                                )}
                              </span>
                            </th>
                          ))}
                          <th className="px-4 py-3 w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sortedContacts.map((contact) => (
                          <tr
                            key={contact.id}
                            className="cursor-pointer hover:bg-muted/40 transition-colors"
                            onClick={() => {
                              setSelectedContact(contact);
                              setViewContactOpen(true);
                            }}
                            data-testid={`row-contact-${contact.id}`}
                          >
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedContactIds.has(contact.id)}
                                onCheckedChange={(checked) => {
                                  setSelectedContactIds((prev) => {
                                    const next = new Set(prev);
                                    if (checked) next.add(contact.id);
                                    else next.delete(contact.id);
                                    return next;
                                  });
                                }}
                                aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                                data-testid={`checkbox-select-contact-${contact.id}`}
                              />
                            </td>
                            <td className="px-4 py-3 font-medium">
                              <div className="flex items-center gap-2">
                                {contact.firstName} {contact.lastName}
                                {contact.isPrimary && (
                                  <Badge variant="secondary" className="text-xs">Primary</Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {ROLE_LABELS[contact.role as string] || contact.role || "—"}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {contact.orgName || "—"}
                            </td>
                            <td className="px-4 py-3">
                              {contact.email ? (
                                <a
                                  href={`mailto:${contact.email}`}
                                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`link-contact-email-${contact.id}`}
                                >
                                  <Mail className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[180px]">{contact.email}</span>
                                </a>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {contact.phone ? (
                                <a
                                  href={`tel:${contact.phone}`}
                                  className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`link-contact-phone-${contact.id}`}
                                >
                                  <Phone className="w-3.5 h-3.5 shrink-0" />
                                  {contact.phone}
                                </a>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <EnrollSequenceDialog
                                contactIds={[contact.id]}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Enroll in sequence"
                                    data-testid={`button-enroll-sequence-row-${contact.id}`}
                                  >
                                    <Mail className="w-4 h-4" />
                                  </Button>
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {crmTab === "orgs" && <><div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card
              className="hover-elevate cursor-pointer"
              onClick={() => setSelectedType("all")}
              data-testid="card-total-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.total}</p>
                    <p className="text-sm text-muted-foreground">Total Orgs</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-active-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-green-100 dark:bg-green-900">
                    <Building2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {orgCounts.activeOnProjects}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Active on Projects
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-compliance-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-orange-100 dark:bg-orange-900">
                    <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {orgCounts.complianceIssues}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Compliance Issues
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card
              className="hover-elevate cursor-pointer"
              data-testid="card-inactive-count"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-gray-100 dark:bg-gray-900">
                    <Building2 className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{orgCounts.inactive}</p>
                    <p className="text-sm text-muted-foreground">Inactive</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {complianceData && complianceData.total > 0 && (
            <Card
              className="border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950"
              data-testid="card-compliance-alert"
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-orange-800 dark:text-orange-200">
                      Compliance Alert: {complianceData.total} item
                      {complianceData.total !== 1 ? "s" : ""} require attention
                    </p>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                      {complianceData.expired > 0 && (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          {complianceData.expired} expired
                        </span>
                      )}
                      {complianceData.expired > 0 &&
                        complianceData.expiringSoon > 0 &&
                        " · "}
                      {complianceData.expiringSoon > 0 && (
                        <span>
                          {complianceData.expiringSoon} expiring within 30 days
                        </span>
                      )}
                    </p>
                    <div className="mt-2 space-y-1">
                      {complianceData.items.slice(0, 5).map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-sm"
                          data-testid={`compliance-item-${idx}`}
                        >
                          <Badge
                            variant={
                              item.status === "expired"
                                ? "destructive"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {item.status === "expired"
                              ? "Expired"
                              : `${item.daysUntilExpiration}d left`}
                          </Badge>
                          <span className="text-orange-800 dark:text-orange-200 font-medium">
                            {item.orgName}
                          </span>
                          <span className="text-orange-600 dark:text-orange-400">
                            — {item.complianceType}
                          </span>
                        </div>
                      ))}
                      {complianceData.items.length > 5 && (
                        <p className="text-xs text-orange-600 dark:text-orange-400">
                          +{complianceData.items.length - 5} more items
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <CardTitle>Organizations</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search organizations..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-search"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters((v) => !v)}
                    data-testid="button-toggle-filters"
                  >
                    <Filter className="w-4 h-4 mr-1.5" />
                    Filters
                    {(selectedType !== "all" || specialtyFilters.length > 0 || statusFilter !== "all" || stateFilter) && (
                      <span className="ml-1.5 bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
                        {[selectedType !== "all", specialtyFilters.length > 0, statusFilter !== "all", !!stateFilter].filter(Boolean).length}
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {showFilters && (
                <div className="flex flex-wrap gap-2 pt-3 border-t mt-3" data-testid="filter-panel">
                  <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="w-[160px]" data-testid="select-type-filter">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="CONTRACTOR">GC / Contractors</SelectItem>
                      <SelectItem value="SUBCONTRACTOR">Subcontractors</SelectItem>
                      <SelectItem value="SUPPLIER">Suppliers</SelectItem>
                      <SelectItem value="VENDOR">Vendors</SelectItem>
                      <SelectItem value="SERVICE_VENDOR">Service Vendors</SelectItem>
                      <SelectItem value="RENTAL_VENDOR">Rental Vendors</SelectItem>
                      <SelectItem value="OWNER_REP">Owner Reps</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-status-filter">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="PREQUALIFIED">Prequalified</SelectItem>
                      <SelectItem value="COMPLIANCE_ISSUE">Compliance Issue</SelectItem>
                      <SelectItem value="INACTIVE">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  {uniqueStates.length > 0 && (
                    <Select value={stateFilter || "all"} onValueChange={(v) => setStateFilter(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-[160px]" data-testid="select-state-filter">
                        <SelectValue placeholder="All States" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All States</SelectItem>
                        {uniqueStates.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {uniqueSpecialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-xs text-muted-foreground">Specialties:</span>
                      {uniqueSpecialties.map((specialty) => (
                        <Badge
                          key={specialty}
                          variant={specialtyFilters.includes(specialty) ? "default" : "outline"}
                          className="cursor-pointer select-none text-xs"
                          onClick={() =>
                            setSpecialtyFilters((prev) =>
                              prev.includes(specialty)
                                ? prev.filter((s) => s !== specialty)
                                : [...prev, specialty]
                            )
                          }
                          data-testid={`badge-specialty-${specialty}`}
                        >
                          {specialty}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(searchTerm ||
                selectedType !== "all" ||
                specialtyFilters.length > 0 ||
                statusFilter !== "all" ||
                stateFilter) && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-sm text-muted-foreground">
                    Active filters:
                  </span>
                  {searchTerm && (
                    <Badge variant="secondary" className="gap-1">
                      Search: "{searchTerm}"
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSearchTerm("")}
                        data-testid="button-clear-search"
                      />
                    </Badge>
                  )}
                  {selectedType !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {TYPE_LABELS[selectedType as OrganizationType]}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSelectedType("all")}
                        data-testid="button-clear-type-filter"
                      />
                    </Badge>
                  )}
                  {statusFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {statusFilter === "COMPLIANCE_ISSUE" ? "Compliance Issue" : statusFilter.charAt(0) + statusFilter.slice(1).toLowerCase()}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setStatusFilter("all")}
                        data-testid="button-clear-status-filter"
                      />
                    </Badge>
                  )}
                  {stateFilter && (
                    <Badge variant="secondary" className="gap-1">
                      State: {stateFilter}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setStateFilter("")}
                        data-testid="button-clear-state-filter"
                      />
                    </Badge>
                  )}
                  {specialtyFilters.map((s) => (
                    <Badge key={s} variant="secondary" className="gap-1">
                      {s}
                      <X
                        className="w-3 h-3 cursor-pointer"
                        onClick={() => setSpecialtyFilters((prev) => prev.filter((f) => f !== s))}
                        data-testid={`button-clear-specialty-${s}`}
                      />
                    </Badge>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedType("all");
                      setSpecialtyFilters([]);
                      setStatusFilter("all");
                      setStateFilter("");
                    }}
                    data-testid="button-clear-all-filters"
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {orgsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filteredOrganizations.length === 0 ? (
                <div>
                  <EmptyState
                    icon={Building2}
                    title="No organizations found"
                    description={searchTerm || selectedType !== "all" || statusFilter !== "all"
                      ? "Try adjusting your search or filters."
                      : "Add your first organization to start building your CRM."}
                    actionLabel={!(searchTerm || selectedType !== "all" || statusFilter !== "all") ? "Add Organization" : undefined}
                    onAction={!(searchTerm || selectedType !== "all" || statusFilter !== "all") ? () => setCreateOrgOpen(true) : undefined}
                  />
                  {!(searchTerm || selectedType !== "all" || statusFilter !== "all") && ["ADMIN", "HUSTLER", "MANAGER", "SUPER_ADMIN"].includes(user?.role ?? "") && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <span>Just exploring?</span>
                      <Button
                        variant="link"
                        className="h-auto p-0 text-primary"
                        onClick={async () => {
                          try {
                            const res = await fetch("/api/dev/seed-crm", { method: "POST", credentials: "include" });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.message || data.error || "Seed failed");
                            toast({ title: "Demo data loaded", description: `Added ${data.counts.organisations} orgs, ${data.counts.opportunities} deals, ${data.counts.contacts} contacts` });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/organisations"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/opportunities"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/pipeline/stats"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/quotes"] });
                            queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] });
                          } catch (e: any) {
                            toast({ title: "Could not load demo data", description: e.message, variant: "destructive" });
                          }
                        }}
                        data-testid="button-seed-crm-demo"
                      >
                        Load sample CRM data
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredOrganizations.map((org) => {
                    const statusColor =
                      org.crmStatus === "ACTIVE"
                        ? "bg-green-500"
                        : org.crmStatus === "PREQUALIFIED"
                          ? "bg-blue-500"
                          : org.crmStatus === "COMPLIANCE_ISSUE"
                            ? "bg-orange-500"
                            : "bg-gray-400";
                    const statusLabel =
                      org.crmStatus === "ACTIVE"
                        ? "Active"
                        : org.crmStatus === "PREQUALIFIED"
                          ? "Prequalified"
                          : org.crmStatus === "COMPLIANCE_ISSUE"
                            ? "Compliance Issue"
                            : "Inactive";
                    const typeSpecificInfo =
                      org.type === "CONTRACTOR"
                        ? org.bondingCapacity
                          ? `Bonding: ${org.bondingCapacity}`
                          : null
                        : org.type === "SUBCONTRACTOR"
                          ? org.tradeSpecialty ||
                            (org.specialties?.length
                              ? org.specialties[0]
                              : null)
                          : org.type === "SUPPLIER"
                            ? org.materialCategories?.length
                              ? org.materialCategories[0]
                              : null
                            : org.type === "VENDOR"
                              ? org.serviceCategory || null
                              : org.type === "RENTAL_VENDOR"
                                ? org.equipmentCategory || null
                                : org.type === "OWNER_REP"
                                  ? org.companyRepresented || null
                                  : null;

                    return (
                      <Card
                        key={org.id}
                        className="hover-elevate cursor-pointer transition-all flex flex-col"
                        onClick={() => openOrgDetail(org)}
                        data-testid={`card-org-${org.id}`}
                      >
                        <CardContent className="p-4 flex flex-col flex-1">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`}
                              />
                              <h3 className="font-semibold text-foreground truncate">
                                {org.name}
                              </h3>
                              <ComplianceBadge partyType="CRM_ORG" partyId={org.id} className="shrink-0" />

                            </div>
                          </div>
                          <div className="space-y-1.5 text-sm">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                className={`${TYPE_COLORS[org.type as OrganizationType]} text-xs`}
                              >
                                {TYPE_LABELS[org.type as OrganizationType]}
                              </Badge>
                            </div>
                            {(org.city || org.state) && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  {org.city && org.state
                                    ? `${org.city}, ${org.state}`
                                    : org.city || org.state}
                                </span>
                              </div>
                            )}
                            {typeSpecificInfo && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Package className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">
                                  {typeSpecificInfo}
                                </span>
                              </div>
                            )}
                            {(org.activeProjectIds?.length || 0) > 0 && (
                              <div className="flex items-center gap-1.5 text-muted-foreground">
                                <Building2 className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Projects: {org.activeProjectIds!.length}{" "}
                                  Active
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center mt-auto pt-3 border-t">
                            <span className="text-xs text-muted-foreground">
                              {statusLabel}
                            </span>
                            <div className="flex items-center gap-1 ml-auto">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrgDetail(org);
                                }}
                                data-testid={`button-view-org-${org.id}`}
                              >
                                View
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditOrg(org);
                                }}
                                data-testid={`button-edit-org-${org.id}`}
                              >
                                Edit
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          </>}
        </div>
      </main>

      <CrmOrgDialogs
        createOrgOpen={createOrgOpen}
        setCreateOrgOpen={handleCreateOrgOpenChange}
        editOrgOpen={editOrgOpen}
        setEditOrgOpen={(open) => { if (!open) setOrgCustomFields({}); setEditOrgOpen(open); }}
        newOrg={newOrg}
        setNewOrg={setNewOrg}
        allProjects={allProjects}
        selectedOrgId={selectedOrg?.id}
        createOrgMutation={createOrgMutationWrapped}
        updateOrgMutation={updateOrgMutationWrapped}
        customFields={orgCustomFields}
        setCustomFields={setOrgCustomFields}
      />

      <CrmOrgDetail
        detailOrgOpen={detailOrgOpen}
        setDetailOrgOpen={setDetailOrgOpen}
        selectedOrg={selectedOrg}
        allProjects={allProjects}
        openEditOrg={openEditOrg}
        openEditContact={openEditContact}
        setCreateContactOpen={handleCreateContactOpenChange}
        resetNewContact={() => setNewContact({ ...DEFAULT_CONTACT })}
        setSelectedContact={setSelectedContact}
        setViewContactOpen={setViewContactOpen}
        mutations={{
          ...mutations,
          deleteOrgMutation: deleteOrgMutationWrapped,
        }}
      />

      <CrmContactDialogs
        createContactOpen={createContactOpen}
        setCreateContactOpen={handleCreateContactOpenChange}
        editContactOpen={editContactOpen}
        setEditContactOpen={(open) => { if (!open) setContactCustomFields({}); setEditContactOpen(open); }}
        viewContactOpen={viewContactOpen}
        setViewContactOpen={setViewContactOpen}
        newContact={newContact}
        setNewContact={setNewContact}
        selectedContact={selectedContact}
        selectedOrgName={selectedOrg?.name}
        selectedOrgId={selectedOrg?.id}
        createContactMutation={createContactMutationWrapped}
        updateContactMutation={updateContactMutationWrapped}
        openEditContact={openEditContact}
        customFields={contactCustomFields}
        setCustomFields={setContactCustomFields}
      />

      {/* Duplicate Detection Dialog */}
      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col" data-testid="dialog-duplicates">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5" />
              Potential Duplicate Organizations
            </DialogTitle>
            <DialogDescription>
              Records with similar names or shared contact information are shown below. Review each pair and merge if needed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {dupLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
              </div>
            ) : !dupData || dupData.pairs.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Copy className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="font-medium">No potential duplicates found</p>
                <p className="text-sm mt-1">All organizations appear to be unique.</p>
              </div>
            ) : (
              dupData.pairs.map((pair, idx) => (
                <div
                  key={idx}
                  className="border rounded-lg p-4 space-y-3"
                  data-testid={`dup-pair-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      Matched by: {pair.matchReason}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setMergePair(pair);
                        setMergeWinnerId(pair.orgA.id);
                      }}
                      data-testid={`button-review-pair-${idx}`}
                    >
                      Review & Merge
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {[pair.orgA, pair.orgB].map((org) => (
                      <div key={org.id} className="space-y-1">
                        <p className="font-semibold text-sm truncate">{org.name}</p>
                        <p className="text-xs text-muted-foreground">{org.type ?? "—"}</p>
                        {(org.city || org.state) && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {[org.city, org.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          data-testid={`dup-org-status-${org.id}`}
                        >
                          {org.crmStatus === "COMPLIANCE_ISSUE" ? "Compliance Issue" : org.crmStatus.charAt(0) + org.crmStatus.slice(1).toLowerCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)} data-testid="button-close-duplicates">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Confirmation Dialog */}
      {mergePair && (
        <Dialog open={!!mergePair} onOpenChange={(open) => { if (!open) { setMergePair(null); setMergeWinnerId(""); } }}>
          <DialogContent className="sm:max-w-xl" data-testid="dialog-merge">
            <DialogHeader>
              <DialogTitle>Merge Organizations</DialogTitle>
              <DialogDescription>
                Choose the record to keep (winner). All contacts and notes from the other record will be moved to the winner, and the duplicate will be archived.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {[mergePair.orgA, mergePair.orgB].map((org) => (
                <div
                  key={org.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${mergeWinnerId === org.id ? "border-primary bg-primary/5" : "hover:border-muted-foreground/40"}`}
                  onClick={() => setMergeWinnerId(org.id)}
                  data-testid={`merge-option-${org.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{org.name}</p>
                      <p className="text-sm text-muted-foreground">{org.type ?? "—"}{org.city ? ` · ${org.city}${org.state ? `, ${org.state}` : ""}` : ""}</p>
                    </div>
                    {mergeWinnerId === org.id && (
                      <Badge className="shrink-0" data-testid={`badge-winner-${org.id}`}>Keep (Winner)</Badge>
                    )}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                The record not selected will be archived. This action cannot be undone.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setMergePair(null); setMergeWinnerId(""); }}
                data-testid="button-cancel-merge"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!mergeWinnerId || mergeMutation.isPending}
                onClick={() => {
                  const loserId = mergeWinnerId === mergePair.orgA.id ? mergePair.orgB.id : mergePair.orgA.id;
                  mergeMutation.mutate({ winnerId: mergeWinnerId, loserId });
                }}
                data-testid="button-confirm-merge"
              >
                {mergeMutation.isPending ? "Merging..." : "Merge & Archive Duplicate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
