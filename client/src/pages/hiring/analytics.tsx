import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { Users, BriefcaseBusiness, CalendarClock, TrendingUp, UserCheck, UserX } from "lucide-react";

interface HiringAnalytics {
  jobs: {
    total: number;
    byStatus: Record<string, number>;
  };
  candidates: {
    total: number;
    byStage: Record<string, number>;
    hired: number;
    rejected: number;
    perRole: Array<{ jobId: string | null; jobTitle: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
    aiScoreHistogram: Array<{ range: string; count: number }>;
  };
  interviews: {
    total: number;
    byStatus: Record<string, number>;
  };
  monthlyTrend: Array<{ month: string; count: number }>;
  recentActivity: Array<{
    id: string;
    activityType: string;
    actorName: string | null;
    entityLabel: string | null;
    createdAt: string;
  }>;
}

interface DashboardStats {
  openRoles: number;
  draftRoles: number;
  publishedRoles: number;
  totalApplicants: number;
  newInLast7Days: number;
  scheduledInterviews: number;
  offerReady: number;
  overdueHiringTasks: number;
}

const STAGE_COLORS: Record<string, string> = {
  APPLIED: "#3b82f6",
  SCREENING: "#eab308",
  PHONE_INTERVIEW: "#f97316",
  IN_PERSON_INTERVIEW: "#a855f7",
  SKILLS_ASSESSMENT: "#ec4899",
  BACKGROUND_CHECK: "#6366f1",
  REFERENCE_CHECK: "#06b6d4",
  OFFER_EXTENDED: "#10b981",
  HIRED: "#22c55e",
  REJECTED: "#ef4444",
  ARCHIVED: "#9ca3af",
};

const STAGE_LABELS: Record<string, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  PHONE_INTERVIEW: "Phone",
  IN_PERSON_INTERVIEW: "In-Person",
  SKILLS_ASSESSMENT: "Skills",
  BACKGROUND_CHECK: "Background",
  REFERENCE_CHECK: "References",
  OFFER_EXTENDED: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

const JOB_STATUS_COLORS: Record<string, string> = {
  DRAFT: "#9ca3af",
  PUBLISHED: "#22c55e",
  PAUSED: "#eab308",
  ARCHIVED: "#d1d5db",
};

const INTERVIEW_COLORS: Record<string, string> = {
  SCHEDULED: "#3b82f6",
  COMPLETED: "#22c55e",
  CANCELLED: "#9ca3af",
  NO_SHOW: "#ef4444",
};

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-lg ${color ?? "bg-primary/10"}`}>
            <Icon className={`w-5 h-5 ${color ? "text-white" : "text-primary"}`} />
          </div>
          <div>
            <p className="text-2xl font-bold">{value ?? <Skeleton className="h-6 w-10 inline-block" />}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HiringAnalyticsPage() {
  const { data: analytics, isLoading } = useQuery<HiringAnalytics>({
    queryKey: ["/api/hiring/analytics"],
  });
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/hiring/analytics/dashboard"],
  });

  const candidateStageData = analytics
    ? Object.entries(analytics.candidates.byStage)
        .filter(([, v]) => v > 0)
        .map(([stage, count]) => ({
          name: STAGE_LABELS[stage] ?? stage,
          value: count,
          fill: STAGE_COLORS[stage] ?? "#6b7280",
        }))
    : [];

  const jobStatusData = analytics
    ? Object.entries(analytics.jobs.byStatus)
        .filter(([, v]) => v > 0)
        .map(([status, count]) => ({
          name: status,
          value: count,
          fill: JOB_STATUS_COLORS[status] ?? "#6b7280",
        }))
    : [];

  const interviewStatusData = analytics
    ? Object.entries(analytics.interviews.byStatus)
        .filter(([, v]) => v > 0)
        .map(([status, count]) => ({
          name: status,
          value: count,
          fill: INTERVIEW_COLORS[status] ?? "#6b7280",
        }))
    : [];

  const conversionRate = analytics && analytics.candidates.total > 0
    ? Math.round((analytics.candidates.hired / analytics.candidates.total) * 100)
    : 0;

  const rejectionRate = analytics && analytics.candidates.total > 0
    ? Math.round((analytics.candidates.rejected / analytics.candidates.total) * 100)
    : 0;

  const perRoleData = analytics?.candidates.perRole ?? [];
  const sourceData = analytics?.candidates.bySource ?? [];
  const aiHistogramData = analytics?.candidates.aiScoreHistogram ?? [];
  const monthlyTrendData = analytics?.monthlyTrend ?? [];

  const SOURCE_COLORS = ["#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ec4899", "#06b6d4", "#eab308", "#6366f1"];
  const AI_HISTOGRAM_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6"];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-hiring-analytics">Hiring Analytics</h1>
        <p className="text-muted-foreground">Pipeline performance and workforce acquisition metrics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard icon={BriefcaseBusiness} label="Total Jobs" value={analytics?.jobs.total} />
        <MetricCard icon={Users} label="Total Applicants" value={analytics?.candidates.total} />
        <MetricCard icon={CalendarClock} label="Interviews" value={analytics?.interviews.total} />
        <MetricCard icon={TrendingUp} label="New (7 days)" value={stats?.newInLast7Days} />
        <MetricCard icon={UserCheck} label="Hired" value={analytics?.candidates.hired} color="bg-green-500" sub={`${conversionRate}% hire rate`} />
        <MetricCard icon={UserX} label="Rejected" value={analytics?.candidates.rejected} color="bg-destructive" sub={`${rejectionRate}% rejection rate`} />
        <MetricCard icon={CalendarClock} label="Scheduled Interviews" value={stats?.scheduledInterviews} />
        <MetricCard icon={BriefcaseBusiness} label="Offer Ready" value={stats?.offerReady} color="bg-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Candidates by Pipeline Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : candidateStageData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No candidate data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={candidateStageData} margin={{ top: 5, right: 5, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" name="Candidates" radius={[4, 4, 0, 0]}>
                    {candidateStageData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jobs by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : jobStatusData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No job data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={jobStatusData}
                    cx="50%"
                    cy="45%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {jobStatusData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={10} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Interview Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : interviewStatusData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No interview data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={interviewStatusData}
                    cx="50%"
                    cy="45%"
                    outerRadius={90}
                    dataKey="value"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {interviewStatusData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={10} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applicants per Role (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : perRoleData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No applicant data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={perRoleData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="jobTitle"
                    tick={{ fontSize: 10 }}
                    width={120}
                    tickFormatter={(v: string) => v.length > 16 ? `${v.slice(0, 14)}…` : v}
                  />
                  <Tooltip />
                  <Bar dataKey="count" name="Applicants" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Hire Rate by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : candidateStageData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data available</div>
            ) : (
              <div className="space-y-3 pt-2">
                {candidateStageData.map((stage) => {
                  const total = analytics?.candidates.total ?? 1;
                  const pct = total > 0 ? Math.round((stage.value / total) * 100) : 0;
                  return (
                    <div key={stage.name} className="space-y-1" data-testid={`stage-bar-${stage.name}`}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{stage.name}</span>
                        <span className="text-muted-foreground">{stage.value} ({pct}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: stage.fill }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Applicant Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : monthlyTrendData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No trend data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlyTrendData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" name="Applicants" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Applicant Source Quality</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : sourceData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No source data</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="45%"
                    outerRadius={90}
                    dataKey="count"
                    nameKey="source"
                    label={({ name, value }) => `${name}: ${value}`}
                    labelLine={false}
                  >
                    {sourceData.map((_, index) => (
                      <Cell key={index} fill={SOURCE_COLORS[index % SOURCE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" iconSize={10} />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI Score Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : aiHistogramData.every((b) => b.count === 0) ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No AI scores yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={aiHistogramData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Candidates" radius={[4, 4, 0, 0]}>
                    {aiHistogramData.map((_, index) => (
                      <Cell key={index} fill={AI_HISTOGRAM_COLORS[index % AI_HISTOGRAM_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {analytics && analytics.recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {analytics.recentActivity.slice(0, 10).map((log) => (
                <li key={log.id} className="flex items-start gap-3 px-4 py-3" data-testid={`analytics-activity-${log.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{log.actorName ?? "System"}</span>
                      {" — "}
                      <span className="text-muted-foreground">{log.activityType.replace(/_/g, " ").toLowerCase()}</span>
                      {log.entityLabel ? ` "${log.entityLabel}"` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(log.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {log.activityType.split("_")[0]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
