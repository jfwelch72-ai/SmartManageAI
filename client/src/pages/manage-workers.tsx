import { useState, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Link } from "wouter";
import KpiManagementPage from "@/pages/kpi-management";
import { KpiCard } from "@/pages/my-kpis";
import {
  Search,
  Eye,
  MessageSquare,
  UserPlus,
  Users,
  BarChart3,
  TrendingUp,
  HardHat,
  ShieldAlert,
  Star,
  ChevronDown,
  ChevronUp,
  Activity,
  Clock,
  Award,
  Trophy,
  Plus,
  Send,
  Crown,
  Medal,
  Target,
  Gift,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Gauge,
  Settings2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface Worker {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  isActive: boolean;
  avatarUrl: string | null;
  tradeSpecialization: string | null;
  employmentType: string | null;
  createdAt: string;
  clockStatus: string | null;
  experienceLevel: string | null;
  currentProject: string | null;
}

interface KpiDashboardData {
  summary: {
    totalWorkers: number;
    activeWorkers: number;
    onDutyNow: number;
    avgAttendanceRate: number;
    avgOverallRating: number;
  };
  attendanceDistribution: Array<{ status: string; count: number }>;
  performanceTrend: Array<{
    month: string;
    overall: number;
    productivity: number | null;
    quality: number | null;
    safety: number | null;
  }>;
  safetyQualityOverview: Array<{
    month: string;
    safetyIncidents: number;
    qualityIssues: number;
    criticalIncidents: number;
  }>;
  topPerformers: Array<{
    userId: string;
    firstName: string;
    lastName: string;
    role: string;
    avgRating: number;
    reviewCount: number;
  }>;
}

interface Criteria { id: string; name: string; description: string; weight: string; maxScore: number; isActive: boolean; sortOrder: number; kpiTemplateId?: string | null; }
interface KpiCriteria { id: string; kpiTemplateId: string; name: string; description: string | null; category: string; unit: string; direction: string; weight: string; maxScore: number; isActive: boolean; sortOrder: number; targetValue: number | null; periodType: string | null; assignmentId: string | null; isKpiBased: true; }
interface EligibleEmployee { id: string; firstName: string; lastName: string; role: string; }
interface RatingScore { criteriaId: string; score: string; comment?: string; criteriaName: string; }
interface Rating { id: string; employeeId: string; evaluatorId: string; projectId?: string; period?: string; overallScore: string; weightedScore: string; comments?: string; createdAt: string; scores: RatingScore[]; employeeName: string; evaluatorName: string; }
interface RewardType { id: string; name: string; description: string; category: string; value: string; isActive: boolean; }
interface Reward { id: string; employeeId: string; rewardTypeId: string; assignedById: string; ratingId?: string; amount?: string; justification?: string; expiresAt?: string; createdAt: string; rewardTypeName: string; employeeName: string; assignedByName: string; }
interface LeaderboardEntry { employeeId: string; firstName: string; lastName: string; role: string; avgScore: string; ratingCount: number; }
interface RewardAnalytics { totalRewards: number; totalAmount: string; byType: { category: string; count: number; totalAmount: string }[]; byMonth: { month: string; count: number; totalAmount: string }[]; }
interface KpiSummaryItem { assignmentId: string; templateName: string; category: string; unit: string; direction: string; targetValue: number; actualValue: number; achievement: number; trend: "improving" | "declining" | "stable"; periodType: string; latestPeriodEnd: string | null; entryCount: number; }

const criteriaSchema = z.object({ name: z.string().min(1), description: z.string().optional(), weight: z.coerce.number().min(0).max(100), maxScore: z.coerce.number().min(1).max(100) });
const rewardTypeSchema = z.object({ name: z.string().min(1), description: z.string().optional(), category: z.string().min(1), value: z.coerce.number().min(0) });
const assignRewardSchema = z.object({ employeeId: z.string().min(1), rewardTypeId: z.string().min(1), amount: z.coerce.number().optional(), justification: z.string().optional(), ratingId: z.string().optional() });

const ROLE_OPTIONS = [
  { value: "ALL", label: "All Roles" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "SUPERINTENDENT", label: "Superintendent" },
  { value: "ESTIMATOR", label: "Estimator" },
  { value: "OFFICE_MANAGER", label: "Office Manager" },
  { value: "HOURLY_EMPLOYEE", label: "Hourly Employee" },
  { value: "MAINTENANCE_MANAGER", label: "Maintenance Manager" },
  { value: "SALES", label: "Sales" },
  { value: "MARKETING", label: "Marketing" },
  { value: "SAFETY_MANAGER", label: "Safety Manager" },
  { value: "HR_MANAGER", label: "HR Manager" },
  { value: "EQUIPMENT_MANAGER", label: "Equipment Manager" },
  { value: "PROJECT_ENGINEER", label: "Project Engineer" },
  { value: "PROCUREMENT_MANAGER", label: "Procurement Manager" },
  { value: "DISPATCHER", label: "Dispatcher" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "ALL", label: "All Types" },
  { value: "Direct Hire", label: "Direct Hire" },
  { value: "Subcontractor", label: "Subcontractor" },
  { value: "Temp/Day Hire", label: "Temp/Day Hire" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SUPERINTENDENT: "Superintendent",
  ESTIMATOR: "Estimator",
  OFFICE_MANAGER: "Office Manager",
  HOURLY_EMPLOYEE: "Hourly Employee",
  MAINTENANCE_MANAGER: "Maintenance Manager",
  SALES: "Sales",
  MARKETING: "Marketing",
  SAFETY_MANAGER: "Safety Manager",
  HR_MANAGER: "HR Manager",
  EQUIPMENT_MANAGER: "Equipment Manager",
  PROJECT_ENGINEER: "Project Engineer",
  PROCUREMENT_MANAGER: "Procurement Manager",
  DISPATCHER: "Dispatcher",
};

const ATTENDANCE_COLORS: Record<string, string> = {
  PRESENT: "hsl(142, 71%, 45%)",
  LATE: "hsl(48, 96%, 53%)",
  ABSENT: "hsl(0, 84%, 60%)",
  EXCUSED: "hsl(217, 91%, 60%)",
  HALF_DAY: "hsl(280, 67%, 55%)",
};

const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  EXCUSED: "Excused",
  HALF_DAY: "Half Day",
};

function getStatusColor(clockStatus: string | null): string {
  if (!clockStatus) return "bg-gray-400";
  switch (clockStatus) {
    case "ON_DUTY":
    case "PRESENT":
      return "bg-green-500";
    case "LATE":
    case "HALF_DAY":
    case "EXCUSED":
      return "bg-yellow-500";
    case "ABSENT":
      return "bg-red-500";
    case "INACTIVE":
    default:
      return "bg-gray-400";
  }
}

function getStatusLabel(clockStatus: string | null): string {
  if (!clockStatus) return "No Data";
  switch (clockStatus) {
    case "ON_DUTY":
      return "On Duty";
    case "PRESENT":
      return "Present";
    case "LATE":
      return "Late";
    case "HALF_DAY":
      return "Half Day";
    case "EXCUSED":
      return "Off Duty";
    case "ABSENT":
      return "Absent";
    case "INACTIVE":
      return "Inactive";
    default:
      return "No Data";
  }
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function formatMonth(month: string): string {
  if (!month || month === "unknown") return month;
  const [year, m] = month.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${year.slice(2)}`;
}

function KpiSummaryCards({ summary }: { summary: KpiDashboardData["summary"] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4" data-testid="kpi-summary-cards">
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Total Workers</p>
          </div>
          <p className="text-2xl font-bold" data-testid="kpi-total-workers">{summary.totalWorkers}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-green-600" />
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <p className="text-2xl font-bold" data-testid="kpi-active-workers">{summary.activeWorkers}</p>
          <p className="text-xs text-muted-foreground">
            {summary.totalWorkers > 0 ? `${Math.round((summary.activeWorkers / summary.totalWorkers) * 100)}%` : "0%"} of total
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-blue-600" />
            <p className="text-xs text-muted-foreground">On Duty Now</p>
          </div>
          <p className="text-2xl font-bold" data-testid="kpi-on-duty">{summary.onDutyNow}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <HardHat className="h-4 w-4 text-amber-600" />
            <p className="text-xs text-muted-foreground">Attendance Rate</p>
          </div>
          <p className="text-2xl font-bold" data-testid="kpi-attendance-rate">{summary.avgAttendanceRate}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center gap-2 mb-1">
            <Star className="h-4 w-4 text-yellow-500" />
            <p className="text-xs text-muted-foreground">Avg Rating</p>
          </div>
          <p className="text-2xl font-bold" data-testid="kpi-avg-rating">
            {summary.avgOverallRating > 0 ? `${summary.avgOverallRating}/5` : "N/A"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AttendanceChart({ data }: { data: KpiDashboardData["attendanceDistribution"] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <HardHat className="h-4 w-4" />
            Attendance Distribution
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground" data-testid="text-no-attendance-data">No attendance data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(d => ({
    name: ATTENDANCE_LABELS[d.status] || d.status,
    value: d.count,
    fill: ATTENDANCE_COLORS[d.status] || "hsl(var(--muted-foreground))",
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <HardHat className="h-4 w-4" />
          Attendance Distribution
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="chart-attendance">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={40}
              paddingAngle={2}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => [value, "Records"]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function PerformanceTrendChart({ data }: { data: KpiDashboardData["performanceTrend"] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Performance Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground" data-testid="text-no-performance-data">No performance review data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(d => ({
    ...d,
    month: formatMonth(d.month),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Performance Trend (Monthly Avg)
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="chart-performance-trend">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="overall" stroke="hsl(217, 91%, 60%)" strokeWidth={2} name="Overall" dot={{ r: 3 }} />
            <Line type="monotone" dataKey="productivity" stroke="hsl(142, 71%, 45%)" strokeWidth={1.5} name="Productivity" dot={{ r: 2 }} connectNulls />
            <Line type="monotone" dataKey="quality" stroke="hsl(280, 67%, 55%)" strokeWidth={1.5} name="Quality" dot={{ r: 2 }} connectNulls />
            <Line type="monotone" dataKey="safety" stroke="hsl(48, 96%, 53%)" strokeWidth={1.5} name="Safety" dot={{ r: 2 }} connectNulls />
            <Legend />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function SafetyQualityChart({ data }: { data: KpiDashboardData["safetyQualityOverview"] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Safety & Quality Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground" data-testid="text-no-safety-data">No safety or quality data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(d => ({
    ...d,
    month: formatMonth(d.month),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          Safety & Quality Issues (Monthly)
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="chart-safety-quality">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="safetyIncidents" fill="hsl(0, 84%, 60%)" name="Safety Incidents" radius={[2, 2, 0, 0]} />
            <Bar dataKey="qualityIssues" fill="hsl(48, 96%, 53%)" name="Quality Issues" radius={[2, 2, 0, 0]} />
            <Bar dataKey="criticalIncidents" fill="hsl(0, 72%, 40%)" name="Critical" radius={[2, 2, 0, 0]} />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TopPerformers({ data }: { data: KpiDashboardData["topPerformers"] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Star className="h-4 w-4" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <p className="text-sm text-muted-foreground" data-testid="text-no-top-performers">No performance data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Star className="h-4 w-4" />
          Top Performers
        </CardTitle>
      </CardHeader>
      <CardContent data-testid="list-top-performers">
        <div className="space-y-3">
          {data.map((performer, idx) => (
            <Link key={performer.userId} href={`/manage-workers/${performer.userId}`}>
              <div
                className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 hover-elevate rounded-md px-2 cursor-pointer"
                data-testid={`top-performer-${performer.userId}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-bold text-muted-foreground w-5">{idx + 1}</span>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs">
                      {getInitials(performer.firstName, performer.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{performer.firstName} {performer.lastName}</p>
                    <p className="text-xs text-muted-foreground">{ROLE_LABELS[performer.role] || performer.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star
                        key={i}
                        className={`h-3 w-3 ${i < Math.round(performer.avgRating) ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium ml-1">{performer.avgRating}</span>
                  <span className="text-xs text-muted-foreground ml-1">({performer.reviewCount})</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function KpiDashboardSkeleton() {
  return (
    <div className="space-y-4" data-testid="kpi-loading">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4 pb-3 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4">
              <Skeleton className="h-4 w-40 mb-4" />
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function WorkerCardSkeleton() {
  return (
    <Card className="rounded-md">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-3 w-3 rounded-full" />
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkersTab() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [tradeFilter, setTradeFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("ALL");
  const [showKpiDashboard, setShowKpiDashboard] = useState(true);

  const queryParams = new URLSearchParams();
  if (tradeFilter) queryParams.set("trade", tradeFilter);
  if (roleFilter !== "ALL") queryParams.set("role", roleFilter);
  if (employmentTypeFilter !== "ALL") queryParams.set("employmentType", employmentTypeFilter);
  const queryString = queryParams.toString();

  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ["/api/auth/manage-workers", queryString ? `?${queryString}` : ""],
  });

  const { data: kpiData, isLoading: kpiLoading } = useQuery<KpiDashboardData>({
    queryKey: ["/api/auth/manage-workers/kpi-dashboard"],
  });

  const filteredWorkers = searchTerm
    ? workers.filter((w) => {
        const fullName = `${w.firstName} ${w.lastName}`.toLowerCase();
        const term = searchTerm.toLowerCase();
        return fullName.includes(term) || w.email.toLowerCase().includes(term);
      })
    : workers;

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted-foreground" data-testid="text-worker-count">
          {isLoading ? "Loading..." : `${filteredWorkers.length} worker${filteredWorkers.length !== 1 ? "s" : ""}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowKpiDashboard(!showKpiDashboard)}
          data-testid="button-toggle-kpi"
        >
          <BarChart3 className="h-4 w-4 mr-1" />
          {showKpiDashboard ? "Hide" : "Show"} KPI Dashboard
          {showKpiDashboard ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
        </Button>
      </div>

      {showKpiDashboard && (
        <div className="space-y-4" data-testid="kpi-dashboard-section">
          {kpiLoading ? (
            <KpiDashboardSkeleton />
          ) : kpiData ? (
            <>
              <KpiSummaryCards summary={kpiData.summary} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <AttendanceChart data={kpiData.attendanceDistribution} />
                <PerformanceTrendChart data={kpiData.performanceTrend} />
                <SafetyQualityChart data={kpiData.safetyQualityOverview} />
                <TopPerformers data={kpiData.topPerformers} />
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            className="pl-9 w-[220px]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="input-search-workers"
          />
        </div>

        <Input
          placeholder="Filter by trade..."
          className="w-[180px]"
          value={tradeFilter}
          onChange={(e) => setTradeFilter(e.target.value)}
          data-testid="input-trade-filter"
        />

        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-role-filter">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`option-role-${opt.value.toLowerCase()}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={employmentTypeFilter} onValueChange={setEmploymentTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-employment-type-filter">
            <SelectValue placeholder="Employment Type" />
          </SelectTrigger>
          <SelectContent>
            {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} data-testid={`option-employment-${opt.value.toLowerCase().replace(/\//g, "-")}`}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" data-testid="loading-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <WorkerCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredWorkers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold">No workers found</h3>
          <p className="text-muted-foreground mt-1">
            Try adjusting your filters or search term.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {filteredWorkers.map((worker) => (
            <Card key={worker.id} className="rounded-md" data-testid={`card-worker-${worker.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10" data-testid={`avatar-worker-${worker.id}`}>
                    <AvatarImage src={worker.avatarUrl || undefined} alt={`${worker.firstName} ${worker.lastName}`} />
                    <AvatarFallback>{getInitials(worker.firstName, worker.lastName)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold truncate" data-testid={`text-worker-name-${worker.id}`}>
                        {worker.firstName} {worker.lastName}
                      </span>
                      <div
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${getStatusColor(worker.clockStatus)}`}
                        title={getStatusLabel(worker.clockStatus)}
                        data-testid={`status-indicator-${worker.id}`}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground truncate" data-testid={`text-worker-role-${worker.id}`}>
                      {ROLE_LABELS[worker.role] || worker.role}
                      {worker.tradeSpecialization ? ` / ${worker.tradeSpecialization}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground truncate" data-testid={`text-worker-status-${worker.id}`}>
                      {getStatusLabel(worker.clockStatus)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {worker.experienceLevel && (
                    <Badge variant="secondary" data-testid={`badge-experience-${worker.id}`}>
                      {worker.experienceLevel}
                    </Badge>
                  )}
                  {worker.employmentType && (
                    <Badge variant="secondary" data-testid={`badge-employment-${worker.id}`}>
                      {worker.employmentType}
                    </Badge>
                  )}
                </div>

                {worker.currentProject && (
                  <p className="mt-2 text-sm text-muted-foreground" data-testid={`text-project-${worker.id}`}>
                    Project: {worker.currentProject}
                    {worker.createdAt && (
                      <span className="ml-1">
                        (since {new Date(worker.createdAt).toLocaleDateString()})
                      </span>
                    )}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-2">
                  <Link href={`/manage-workers/${worker.id}`}>
                    <Button variant="outline" size="sm" data-testid={`button-view-${worker.id}`}>
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                  </Link>
                  <Link href="/messages">
                    <Button variant="outline" size="sm" data-testid={`button-message-${worker.id}`}>
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Message
                    </Button>
                  </Link>
                  <Button variant="outline" size="sm" data-testid={`button-assign-${worker.id}`}>
                    <UserPlus className="w-4 h-4 mr-1" />
                    Assign
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ManageCriteriaDialog() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editMaxScore, setEditMaxScore] = useState("");
  const { data: criteria = [], isLoading } = useQuery<Criteria[]>({ queryKey: ["/api/performance/criteria"] });
  const form = useForm<z.infer<typeof criteriaSchema>>({ resolver: zodResolver(criteriaSchema), defaultValues: { name: "", description: "", weight: 1, maxScore: 10 } });

  const createMut = useMutation({
    mutationFn: async (data: z.infer<typeof criteriaSchema>) => { const res = await apiRequest("POST", "/api/performance/criteria", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); form.reset(); toast({ title: "Criteria created" }); },
    onError: (e: Error) => { toast({ title: "Failed to create criteria", description: e.message, variant: "destructive" }); },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Criteria> }) => { const res = await apiRequest("PATCH", `/api/performance/criteria/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); setEditingId(null); toast({ title: "Criteria updated" }); },
    onError: (e: Error) => { toast({ title: "Update failed", description: e.message, variant: "destructive" }); },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const res = await apiRequest("DELETE", `/api/performance/criteria/${id}`); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/criteria"] }); toast({ title: "Criteria deactivated" }); },
    onError: (e: Error) => { toast({ title: "Delete failed", description: e.message, variant: "destructive" }); },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-manage-criteria"><Target className="w-4 h-4 mr-2" />Manage Criteria</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Rating Criteria</DialogTitle></DialogHeader>
        {isLoading ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Weight</TableHead><TableHead>Max</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {criteria.map((c) => (
                <TableRow key={c.id} data-testid={`criteria-row-${c.id}`}>
                  {editingId === c.id ? (<>
                    <TableCell><Input value={editName} onChange={(e) => setEditName(e.target.value)} data-testid={`input-edit-criteria-name-${c.id}`} /></TableCell>
                    <TableCell><Input type="number" value={editWeight} onChange={(e) => setEditWeight(e.target.value)} data-testid={`input-edit-criteria-weight-${c.id}`} /></TableCell>
                    <TableCell><Input type="number" value={editMaxScore} onChange={(e) => setEditMaxScore(e.target.value)} data-testid={`input-edit-criteria-max-${c.id}`} /></TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => updateMut.mutate({ id: c.id, data: { name: editName, weight: editWeight, maxScore: Number(editMaxScore) } })} disabled={updateMut.isPending} data-testid={`button-save-criteria-${c.id}`}><Check className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} data-testid={`button-cancel-criteria-${c.id}`}><X className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </>) : (<>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.weight}</TableCell>
                    <TableCell>{c.maxScore}</TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => { setEditingId(c.id); setEditName(c.name); setEditWeight(String(c.weight)); setEditMaxScore(String(c.maxScore)); }} data-testid={`button-edit-criteria-${c.id}`}><Pencil className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteMut.mutate(c.id)} disabled={deleteMut.isPending} data-testid={`button-delete-criteria-${c.id}`}><Trash2 className="w-4 h-4" /></Button>
                    </div></TableCell>
                  </>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="border-t pt-4 mt-4">
          <p className="text-sm font-medium mb-3">Add New Criteria</p>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => createMut.mutate(d))} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField control={form.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Quality of Work" data-testid="input-new-criteria-name" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} placeholder="Optional" data-testid="input-new-criteria-desc" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="weight" render={({ field }) => (<FormItem><FormLabel>Weight</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-criteria-weight" /></FormControl><FormMessage /></FormItem>)} />
              <FormField control={form.control} name="maxScore" render={({ field }) => (<FormItem><FormLabel>Max Score</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-criteria-max" /></FormControl><FormMessage /></FormItem>)} />
              <div className="sm:col-span-2">
                <Button type="submit" disabled={createMut.isPending} data-testid="button-add-criteria">
                  {createMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Add Criteria
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PerformanceTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canManageKpis = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "SUPERINTENDENT" || user?.role === "HUSTLER" || user?.role === "HR_MANAGER";
  const [perfSubTab, setPerfSubTab] = useState<"rate" | "kpi-library" | "history" | "analytics">("rate");
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState("");
  const [ratingComment, setRatingComment] = useState("");
  const [historyView, setHistoryView] = useState<"received" | "given">("received");
  const [expandedRating, setExpandedRating] = useState<string | null>(null);

  const { data: kpiCriteria = [], isLoading: loadingKpi } = useQuery<KpiCriteria[]>({
    queryKey: ["/api/performance/kpi-criteria", selectedEmployee],
    queryFn: () => fetch(`/api/performance/kpi-criteria${selectedEmployee ? `?employeeId=${selectedEmployee}` : ""}`, { credentials: "include" }).then((r) => r.json()),
  });
  const { data: employees = [], isLoading: loadingEmp } = useQuery<EligibleEmployee[]>({ queryKey: ["/api/performance/eligible-employees"] });
  const { data: myRatings = [], isLoading: loadingMy } = useQuery<Rating[]>({ queryKey: ["/api/performance/ratings/my"] });
  const { data: givenRatings = [], isLoading: loadingGiven } = useQuery<Rating[]>({
    queryKey: ["/api/performance/ratings", { evaluatorId: user?.id }],
    queryFn: () => fetch(`/api/performance/ratings?evaluatorId=${user?.id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!user?.id,
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      const scoresToSubmit = kpiCriteria
        .filter((c) => scores[c.id] !== undefined && scores[c.id] !== null)
        .map((c) => ({ criteriaId: c.id, score: scores[c.id] || 0 }));
      if (scoresToSubmit.length === 0) throw new Error("Please score at least one KPI");
      const res = await apiRequest("POST", "/api/performance/ratings", {
        employeeId: selectedEmployee, period: period || undefined, comments: ratingComment || undefined,
        scores: scoresToSubmit,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance/ratings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/ratings/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/leaderboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/kpi-criteria"] });
      setSelectedEmployee(""); setScores({}); setPeriod(""); setRatingComment("");
      toast({ title: "Rating submitted successfully" });
    },
    onError: (e: Error) => { toast({ title: "Failed to submit rating", description: e.message, variant: "destructive" }); },
  });

  const displayed = historyView === "received" ? myRatings : givenRatings;
  const loadingHist = historyView === "received" ? loadingMy : loadingGiven;

  const getScorePercentage = (kpi: KpiCriteria, score: number) => {
    if (kpi.targetValue && kpi.targetValue > 0) {
      return Math.min((score / kpi.targetValue) * 100, 100);
    }
    return (score / kpi.maxScore) * 100;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b pb-3">
        <Button variant={perfSubTab === "rate" ? "default" : "outline"} size="sm" onClick={() => setPerfSubTab("rate")} data-testid="button-perf-rate">
          <Star className="w-4 h-4 mr-1.5" />Rate Employee
        </Button>
        {canManageKpis && (
          <Button variant={perfSubTab === "kpi-library" ? "default" : "outline"} size="sm" onClick={() => setPerfSubTab("kpi-library")} data-testid="button-perf-kpi-library">
            <Settings2 className="w-4 h-4 mr-1.5" />KPI Library
          </Button>
        )}
        <Button variant={perfSubTab === "history" ? "default" : "outline"} size="sm" onClick={() => setPerfSubTab("history")} data-testid="button-perf-history">
          <Award className="w-4 h-4 mr-1.5" />Rating History
        </Button>
        <Button variant={perfSubTab === "analytics" ? "default" : "outline"} size="sm" onClick={() => setPerfSubTab("analytics")} data-testid="button-perf-analytics">
          <BarChart3 className="w-4 h-4 mr-1.5" />Analytics
        </Button>
      </div>

      {perfSubTab === "rate" && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Gauge className="w-5 h-5" />Rate Employee by KPIs</CardTitle>
                <CardDescription>Score employees against their assigned KPI targets</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingEmp ? <Skeleton className="h-10 w-full" /> : (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Employee</label>
                    <Select value={selectedEmployee} onValueChange={(v) => { setSelectedEmployee(v); setScores({}); }}>
                      <SelectTrigger data-testid="select-employee-to-rate"><SelectValue placeholder="Select an employee..." /></SelectTrigger>
                      <SelectContent>
                        {employees.map((e) => (<SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName} - {e.role}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedEmployee && loadingKpi && <Skeleton className="h-40 w-full" />}

                {selectedEmployee && !loadingKpi && kpiCriteria.length > 0 && (<>
                  <div className="space-y-4">
                    {kpiCriteria.map((kpi) => {
                      const scoreVal = scores[kpi.id];
                      const pct = scoreVal !== undefined ? getScorePercentage(kpi, scoreVal) : 0;
                      const dirIcon = kpi.direction === "higher_is_better"
                        ? <ArrowUpRight className="w-3 h-3 text-green-600" />
                        : <ArrowDownRight className="w-3 h-3 text-orange-600" />;

                      return (
                        <div key={kpi.id} className="border rounded-lg p-3 space-y-2" data-testid={`kpi-criterion-${kpi.id}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <label className="text-sm font-medium">{kpi.name}</label>
                              {dirIcon}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-xs">{kpi.unit}</Badge>
                              <Badge variant="secondary" className="text-xs">{kpi.category}</Badge>
                            </div>
                          </div>
                          {kpi.description && <p className="text-xs text-muted-foreground">{kpi.description}</p>}
                          {kpi.targetValue !== null && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Target className="w-3 h-3" />
                              <span>Target: {kpi.targetValue} {kpi.unit}</span>
                              {kpi.periodType && <span className="text-muted-foreground/60">({kpi.periodType})</span>}
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <Input
                              type="number"
                              min={0}
                              max={kpi.maxScore}
                              value={scores[kpi.id] ?? ""}
                              onChange={(e) => setScores((p) => ({ ...p, [kpi.id]: Number(e.target.value) }))}
                              placeholder={`Score 0 - ${kpi.maxScore}`}
                              className="w-32"
                              data-testid={`input-score-${kpi.id}`}
                            />
                            <div className="flex-1">
                              <Progress value={pct} className="h-2" />
                            </div>
                            <span className="text-xs font-medium w-12 text-right">{pct.toFixed(0)}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Period</label>
                    <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. Q1 2026" data-testid="input-rating-period" />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Overall Comments</label>
                    <Textarea value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} placeholder="Provide overall feedback..." rows={3} data-testid="textarea-rating-comments" />
                  </div>
                  <Button onClick={() => submitMut.mutate()} disabled={submitMut.isPending || !selectedEmployee} className="w-full" data-testid="button-submit-rating">
                    {submitMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}Submit Rating
                  </Button>
                </>)}
                {selectedEmployee && !loadingKpi && kpiCriteria.length === 0 && (
                  <div className="text-center py-6 space-y-2">
                    <Target className="w-8 h-8 mx-auto text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">No KPIs configured yet. Create KPIs in the KPI Library to use them as rating criteria.</p>
                    {canManageKpis && (
                      <Button variant="outline" size="sm" onClick={() => setPerfSubTab("kpi-library")} data-testid="button-go-kpi-library">
                        <Settings2 className="w-4 h-4 mr-1.5" />Go to KPI Library
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="border rounded-md p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-kpi-count">{kpiCriteria.length}</p>
                    <p className="text-xs text-muted-foreground">Active KPIs</p>
                  </div>
                  <div className="border rounded-md p-3 text-center">
                    <p className="text-2xl font-bold" data-testid="text-assigned-count">
                      {kpiCriteria.filter(k => k.assignmentId).length}
                    </p>
                    <p className="text-xs text-muted-foreground">With Targets</p>
                  </div>
                </div>
                {selectedEmployee && kpiCriteria.length > 0 && Object.keys(scores).length > 0 && (
                  <div className="border rounded-md p-3">
                    <p className="text-xs text-muted-foreground mb-1">Average Score</p>
                    <p className="text-xl font-bold" data-testid="text-avg-score">
                      {(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length).toFixed(1)}
                    </p>
                    <Progress
                      value={(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length / 10) * 100}
                      className="h-2 mt-2"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {perfSubTab === "kpi-library" && canManageKpis && <KpiManagementPage />}

      {perfSubTab === "history" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2"><Award className="w-5 h-5" />Rating History</CardTitle>
              <div className="flex gap-1">
                <Button variant={historyView === "received" ? "default" : "outline"} size="sm" onClick={() => setHistoryView("received")} data-testid="button-my-ratings">My Ratings</Button>
                <Button variant={historyView === "given" ? "default" : "outline"} size="sm" onClick={() => setHistoryView("given")} data-testid="button-given-ratings">Given</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingHist ? <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div> : displayed.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No ratings found</p>
            ) : (
              <div className="space-y-3">
                {displayed.map((r) => (
                  <div key={r.id} className="border rounded-md p-3 hover-elevate cursor-pointer" onClick={() => setExpandedRating(expandedRating === r.id ? null : r.id)} data-testid={`rating-card-${r.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{(historyView === "received" ? r.evaluatorName : r.employeeName)?.[0]}</AvatarFallback></Avatar>
                        <div>
                          <p className="text-sm font-medium">{historyView === "received" ? r.evaluatorName : r.employeeName}</p>
                          <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}{r.period && ` - ${r.period}`}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{parseFloat(String(r.overallScore)).toFixed(1)}</Badge>
                        {expandedRating === r.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                    <div className="mt-2">
                      <Progress value={(parseFloat(String(r.overallScore)) / 10) * 100} className="h-2" />
                      <span className="text-xs text-muted-foreground mt-1 block">Weighted: {parseFloat(String(r.weightedScore)).toFixed(2)}</span>
                    </div>
                    {expandedRating === r.id && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        {r.scores?.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <span className="text-sm">{s.criteriaName}</span>
                            <div className="flex items-center gap-2">
                              <Progress value={(parseFloat(String(s.score)) / 10) * 100} className="h-1.5 w-20" />
                              <span className="text-sm font-medium w-8 text-right">{s.score}</span>
                            </div>
                          </div>
                        ))}
                        {r.comments && <p className="text-sm text-muted-foreground mt-2 italic">{r.comments}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {perfSubTab === "analytics" && <PerformanceAnalyticsSection />}
    </div>
  );
}

function PerformanceAnalyticsSection() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER" || user?.role === "OFFICE_MANAGER";
  const canSeeLeaderboard = isAdmin || isManager;

  const { data: leaderboard = [], isLoading: loadingLb } = useQuery<LeaderboardEntry[]>({ queryKey: ["/api/performance/leaderboard"], enabled: canSeeLeaderboard });
  const { data: analytics } = useQuery<RewardAnalytics>({ queryKey: ["/api/performance/rewards/analytics"], enabled: isAdmin });
  const { data: kpiSummary, isLoading: loadingKpi } = useQuery<KpiSummaryItem[]>({ queryKey: ["/api/kpis/summary"], enabled: !!user });

  const totalRatings = leaderboard.reduce((s, e) => s + e.ratingCount, 0);
  const avgScore = leaderboard.length > 0 ? leaderboard.reduce((s, e) => s + parseFloat(String(e.avgScore)), 0) / leaderboard.length : 0;
  const activeKpis = kpiSummary?.length || 0;
  const overallKpiAchievement = kpiSummary && kpiSummary.length > 0
    ? Math.round(kpiSummary.reduce((acc, k) => acc + k.achievement, 0) / kpiSummary.length)
    : 0;

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const filteredKpis = kpiSummary?.filter((kpi) => categoryFilter === "all" || kpi.category === categoryFilter) || [];
  const categories = kpiSummary ? Array.from(new Set(kpiSummary.map((k) => k.category))) : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="hover-elevate" data-testid="stat-total-ratings">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-2xl font-bold">{totalRatings}</p>
                <p className="text-sm text-muted-foreground">Total Ratings</p>
              </div>
              <Star className="w-8 h-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate" data-testid="stat-avg-score">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-2xl font-bold">{avgScore.toFixed(1)}</p>
                <p className="text-sm text-muted-foreground">Average Score</p>
              </div>
              <TrendingUp className="w-8 h-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate" data-testid="stat-active-kpis">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-2xl font-bold">{activeKpis}</p>
                <p className="text-sm text-muted-foreground">Active KPIs</p>
              </div>
              <Target className="w-8 h-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="hover-elevate" data-testid="stat-kpi-achievement">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-2xl font-bold">{overallKpiAchievement}%</p>
                <p className="text-sm text-muted-foreground">KPI Achievement</p>
              </div>
              <Activity className="w-8 h-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {canSeeLeaderboard && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Crown className="w-5 h-5" />Performance Leaderboard</CardTitle>
            <CardDescription>Top performing employees</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingLb ? (
              <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            ) : leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No performance data available yet</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Rank</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Avg Score</TableHead>
                    <TableHead>Ratings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((e, i) => (
                    <TableRow key={e.employeeId} data-testid={`leaderboard-row-${e.employeeId}`}>
                      <TableCell>
                        {i === 0 && <Crown className="w-4 h-4 text-yellow-500" />}
                        {i === 1 && <Medal className="w-4 h-4 text-gray-400" />}
                        {i === 2 && <Medal className="w-4 h-4 text-amber-600" />}
                        {i > 2 && <span className="text-sm text-muted-foreground pl-1">{i + 1}</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7"><AvatarFallback className="text-xs">{e.firstName[0]}{e.lastName[0]}</AvatarFallback></Avatar>
                          <span className="font-medium text-sm">{e.firstName} {e.lastName}</span>
                        </div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{e.role}</Badge></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={(parseFloat(String(e.avgScore)) / 10) * 100} className="h-1.5 w-16" />
                          <span className="text-sm font-medium">{parseFloat(String(e.avgScore)).toFixed(1)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{e.ratingCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-base font-semibold mb-3 flex items-center gap-2"><Target className="w-4 h-4" />My KPI Performance</h3>
        {loadingKpi ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            {categories.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <span className="text-sm text-muted-foreground mr-1">Filter:</span>
                <Button variant={categoryFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter("all")} data-testid="button-filter-all">All</Button>
                {categories.map((cat) => (
                  <Button key={cat} variant={categoryFilter === cat ? "default" : "outline"} size="sm" onClick={() => setCategoryFilter(cat)} data-testid={`button-filter-${cat.toLowerCase()}`}>{cat}</Button>
                ))}
              </div>
            )}
            {filteredKpis.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Target className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2" data-testid="text-no-kpis-title">No KPIs Assigned</h3>
                  <p className="text-muted-foreground text-sm" data-testid="text-no-kpis-description">
                    You don't have any KPIs assigned yet. Your manager will assign KPIs with target values for you to track.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredKpis.map((kpi) => (
                  <KpiCard key={kpi.assignmentId} kpi={kpi} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {isAdmin && analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5" />Rewards by Category</CardTitle></CardHeader>
            <CardContent>
              {analytics.byType.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No data available</p>
              ) : (
                <div className="space-y-3">
                  {analytics.byType.map((item) => (
                    <div key={item.category} className="space-y-1" data-testid={`analytics-category-${item.category}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{item.category}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">{item.count} rewards</span>
                          <span className="text-sm font-medium">${parseFloat(String(item.totalAmount)).toLocaleString()}</span>
                        </div>
                      </div>
                      <Progress value={parseFloat(String(analytics.totalAmount)) > 0 ? (parseFloat(String(item.totalAmount)) / parseFloat(String(analytics.totalAmount))) * 100 : 0} className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" />Rewards by Month</CardTitle></CardHeader>
            <CardContent>
              {analytics.byMonth.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No data available</p>
              ) : (
                <div className="space-y-3">
                  {analytics.byMonth.map((item) => (
                    <div key={item.month} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0" data-testid={`analytics-month-${item.month}`}>
                      <span className="text-sm">{item.month}</span>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{item.count} rewards</Badge>
                        <span className="text-sm font-medium">${parseFloat(String(item.totalAmount)).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RewardsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [editTypeId, setEditTypeId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCat, setEditCat] = useState("");
  const [editVal, setEditVal] = useState("");

  const { data: myRewards = [], isLoading: loadingMy } = useQuery<Reward[]>({ queryKey: ["/api/performance/rewards/my"] });
  const { data: rewardTypes = [], isLoading: loadingTypes } = useQuery<RewardType[]>({ queryKey: ["/api/performance/reward-types"], enabled: isAdmin });
  const { data: employees = [] } = useQuery<EligibleEmployee[]>({ queryKey: ["/api/performance/eligible-employees"], enabled: isAdmin });
  const { data: allRewards = [], isLoading: loadingAll } = useQuery<Reward[]>({
    queryKey: ["/api/performance/rewards", { all: true }],
    queryFn: () => fetch("/api/performance/rewards?all=true", { credentials: "include" }).then((r) => r.json()),
    enabled: isAdmin,
  });

  const typeForm = useForm<z.infer<typeof rewardTypeSchema>>({ resolver: zodResolver(rewardTypeSchema), defaultValues: { name: "", description: "", category: "", value: 0 } });
  const rewardForm = useForm<z.infer<typeof assignRewardSchema>>({ resolver: zodResolver(assignRewardSchema), defaultValues: { employeeId: "", rewardTypeId: "", amount: 0, justification: "" } });

  const createTypeMut = useMutation({
    mutationFn: async (d: z.infer<typeof rewardTypeSchema>) => { const r = await apiRequest("POST", "/api/performance/reward-types", d); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); typeForm.reset(); toast({ title: "Reward type created" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const updateTypeMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RewardType> }) => { const r = await apiRequest("PATCH", `/api/performance/reward-types/${id}`, data); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); setEditTypeId(null); toast({ title: "Updated" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const deleteTypeMut = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("DELETE", `/api/performance/reward-types/${id}`); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/performance/reward-types"] }); toast({ title: "Deactivated" }); },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const assignMut = useMutation({
    mutationFn: async (d: z.infer<typeof assignRewardSchema>) => { const r = await apiRequest("POST", "/api/performance/rewards", d); return r.json(); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/performance/rewards/analytics"] });
      rewardForm.reset(); toast({ title: "Reward assigned" });
    },
    onError: (e: Error) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5" />My Rewards</CardTitle>
          <CardDescription>Rewards you have received</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingMy ? <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : myRewards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No rewards received yet</p>
          ) : (
            <div className="space-y-3">
              {myRewards.map((rw) => (
                <div key={rw.id} className="border rounded-md p-3 hover-elevate" data-testid={`reward-card-${rw.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2"><Trophy className="w-4 h-4 text-yellow-500" /><span className="font-medium text-sm">{rw.rewardTypeName}</span></div>
                    {rw.amount != null && <Badge variant="default">${rw.amount}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Assigned by {rw.assignedByName} on {new Date(rw.createdAt).toLocaleDateString()}</p>
                  {rw.justification && <p className="text-sm text-muted-foreground mt-1">{rw.justification}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Medal className="w-5 h-5" />Reward Types</CardTitle></CardHeader>
          <CardContent>
            {loadingTypes ? <Skeleton className="h-10 w-full" /> : (
              <div className="space-y-2 mb-4">
                {rewardTypes.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border rounded-md p-2" data-testid={`reward-type-${t.id}`}>
                    {editTypeId === t.id ? (
                      <div className="flex items-center gap-2 flex-1 flex-wrap">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 min-w-[100px]" data-testid={`input-edit-type-name-${t.id}`} />
                        <Input value={editCat} onChange={(e) => setEditCat(e.target.value)} className="w-24" data-testid={`input-edit-type-cat-${t.id}`} />
                        <Input type="number" value={editVal} onChange={(e) => setEditVal(e.target.value)} className="w-20" data-testid={`input-edit-type-val-${t.id}`} />
                        <Button size="icon" variant="ghost" onClick={() => updateTypeMut.mutate({ id: t.id, data: { name: editName, category: editCat, value: editVal } })} data-testid={`button-save-type-${t.id}`}><Check className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditTypeId(null)} data-testid={`button-cancel-type-${t.id}`}><X className="w-4 h-4" /></Button>
                      </div>
                    ) : (<>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">{t.category} - ${t.value}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant={t.isActive ? "default" : "secondary"} className="shrink-0">{t.isActive ? "Active" : "Inactive"}</Badge>
                        <Button size="icon" variant="ghost" onClick={() => { setEditTypeId(t.id); setEditName(t.name); setEditCat(t.category); setEditVal(String(t.value)); }} data-testid={`button-edit-type-${t.id}`}><Pencil className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => deleteTypeMut.mutate(t.id)} data-testid={`button-delete-type-${t.id}`}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </>)}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-3">Add Reward Type</p>
              <Form {...typeForm}>
                <form onSubmit={typeForm.handleSubmit((d) => createTypeMut.mutate(d))} className="space-y-3">
                  <FormField control={typeForm.control} name="name" render={({ field }) => (<FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Employee of the Month" data-testid="input-new-type-name" /></FormControl><FormMessage /></FormItem>)} />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField control={typeForm.control} name="category" render={({ field }) => (
                      <FormItem><FormLabel>Category</FormLabel>
                        <Select value={field.value || ""} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger data-testid="select-new-type-cat"><SelectValue placeholder="Select category..." /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="RECOGNITION">Recognition</SelectItem>
                            <SelectItem value="BONUS">Bonus</SelectItem>
                            <SelectItem value="INCENTIVE">Incentive</SelectItem>
                            <SelectItem value="POINTS">Points</SelectItem>
                            <SelectItem value="CUSTOM">Custom</SelectItem>
                          </SelectContent>
                        </Select><FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={typeForm.control} name="value" render={({ field }) => (<FormItem><FormLabel>Value</FormLabel><FormControl><Input type="number" {...field} data-testid="input-new-type-val" /></FormControl><FormMessage /></FormItem>)} />
                  </div>
                  <FormField control={typeForm.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} placeholder="Optional" data-testid="input-new-type-desc" /></FormControl><FormMessage /></FormItem>)} />
                  <Button type="submit" disabled={createTypeMut.isPending} data-testid="button-add-type">
                    {createTypeMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}Add Type
                  </Button>
                </form>
              </Form>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gift className="w-5 h-5" />Assign Reward</CardTitle>
            <CardDescription>Recognize outstanding employee performance</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...rewardForm}>
              <form onSubmit={rewardForm.handleSubmit((d) => assignMut.mutate(d))} className="space-y-4">
                <FormField control={rewardForm.control} name="employeeId" render={({ field }) => (
                  <FormItem><FormLabel>Employee</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-reward-employee"><SelectValue placeholder="Select employee..." /></SelectTrigger></FormControl>
                      <SelectContent>{employees.map((e) => (<SelectItem key={e.id} value={e.id}>{e.firstName} {e.lastName}</SelectItem>))}</SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={rewardForm.control} name="rewardTypeId" render={({ field }) => (
                  <FormItem><FormLabel>Reward Type</FormLabel>
                    <Select value={field.value || ""} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-reward-type"><SelectValue placeholder="Select reward type..." /></SelectTrigger></FormControl>
                      <SelectContent>{rewardTypes.filter((t) => t.isActive).map((t) => (<SelectItem key={t.id} value={t.id}>{t.name} (${t.value})</SelectItem>))}</SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={rewardForm.control} name="amount" render={({ field }) => (<FormItem><FormLabel>Amount (optional)</FormLabel><FormControl><Input type="number" {...field} placeholder="Leave blank for default" data-testid="input-reward-amount" /></FormControl><FormMessage /></FormItem>)} />
                <FormField control={rewardForm.control} name="justification" render={({ field }) => (<FormItem><FormLabel>Justification</FormLabel><FormControl><Textarea {...field} placeholder="Why is this employee being rewarded?" rows={3} data-testid="textarea-reward-justification" /></FormControl><FormMessage /></FormItem>)} />
                <Button type="submit" disabled={assignMut.isPending} className="w-full" data-testid="button-assign-reward">
                  {assignMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Award className="w-4 h-4 mr-2" />}Assign Reward
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="w-5 h-5" />Recent Rewards</CardTitle></CardHeader>
        <CardContent>
          {loadingAll ? <Skeleton className="h-12 w-full" /> : allRewards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No rewards assigned yet</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Reward</TableHead><TableHead>Amount</TableHead><TableHead>Assigned By</TableHead><TableHead>Date</TableHead></TableRow></TableHeader>
              <TableBody>
                {allRewards.slice(0, 20).map((rw) => (
                  <TableRow key={rw.id} data-testid={`recent-reward-${rw.id}`}>
                    <TableCell className="font-medium">{rw.employeeName}</TableCell>
                    <TableCell>{rw.rewardTypeName}</TableCell>
                    <TableCell>{rw.amount != null ? `$${rw.amount}` : "-"}</TableCell>
                    <TableCell>{rw.assignedByName}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(rw.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ManageWorkersPage() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const isAdmin = user?.role === "ADMIN";
  const isManager = user?.role === "MANAGER" || user?.role === "OFFICE_MANAGER";
  const canManageWorkers = isAdmin || isManager;
  const defaultTab = canManageWorkers ? "workers" : "performance";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    if (canManageWorkers) opts.push({ value: "workers", label: "Workers" });
    opts.push({ value: "performance", label: "Performance" });
    opts.push({ value: "rewards", label: "Rewards" });
    return opts;
  }, [canManageWorkers]);

  if (!user) return <div className="p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 md:px-6 py-6 md:py-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-muted-foreground shrink-0" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-page-title">Workforce Management</h1>
              <p className="text-sm text-muted-foreground mt-1">Manage your team, track performance, and recognize achievements</p>
            </div>
          </div>
          
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {isMobile ? (
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger data-testid="select-workforce-tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <TabsList data-testid="workforce-tabs">
              {canManageWorkers && <TabsTrigger value="workers" data-testid="tab-workers"><Users className="w-4 h-4 mr-1.5" />Workers</TabsTrigger>}
              <TabsTrigger value="performance" data-testid="tab-performance"><Gauge className="w-4 h-4 mr-1.5" />Performance</TabsTrigger>
              <TabsTrigger value="rewards" data-testid="tab-rewards"><Gift className="w-4 h-4 mr-1.5" />Rewards</TabsTrigger>
            </TabsList>
          )}
          {canManageWorkers && <TabsContent value="workers"><WorkersTab /></TabsContent>}
          <TabsContent value="performance"><PerformanceTab /></TabsContent>
          <TabsContent value="rewards"><RewardsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
