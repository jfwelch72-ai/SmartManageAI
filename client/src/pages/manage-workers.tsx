import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
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

const ROLE_OPTIONS = [
  { value: "ALL", label: "All Roles" },
  { value: "ADMIN", label: "Admin" },
  { value: "MANAGER", label: "Manager" },
  { value: "SUPERINTENDENT", label: "Superintendent" },
  { value: "ESTIMATOR", label: "Estimator" },
  { value: "OFFICE_MANAGER", label: "Office Manager" },
  { value: "HOURLY_EMPLOYEE", label: "Hourly Employee" },
  { value: "MAINTENANCE_MANAGER", label: "Maintenance Manager" },
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

export default function ManageWorkersPage() {
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
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Users className="h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">
                Manage Workers
              </h1>
              <p className="text-muted-foreground" data-testid="text-worker-count">
                {isLoading ? "Loading..." : `${filteredWorkers.length} worker${filteredWorkers.length !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
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
      </main>
    </div>
  );
}
