import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BriefcaseBusiness, Users, UserPlus, CalendarClock, Star, AlertCircle, FileText, CheckCircle2 } from "lucide-react";
import type { HiringActivityLog } from "@/types/hiring";
import { formatDistanceToNow } from "date-fns";

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

function StatCard({ icon: Icon, label, value, href, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
  href?: string;
  color?: string;
}) {
  const inner = (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-5">
        <div className="flex items-center gap-4">
          <div className={`p-2.5 rounded-lg ${color ?? "bg-primary/10"}`}>
            <Icon className={`w-5 h-5 ${color ? "text-white" : "text-primary"}`} />
          </div>
          <div>
            <p className="text-2xl font-bold">{value ?? <Skeleton className="h-6 w-10 inline-block" />}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

function activityIcon(type: string) {
  if (type.includes("HIRED")) return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (type.includes("REJECTED")) return <AlertCircle className="w-4 h-4 text-destructive" />;
  if (type.includes("JOB")) return <BriefcaseBusiness className="w-4 h-4 text-primary" />;
  if (type.includes("STAGE")) return <UserPlus className="w-4 h-4 text-blue-500" />;
  if (type.includes("INTERVIEW")) return <CalendarClock className="w-4 h-4 text-orange-500" />;
  return <FileText className="w-4 h-4 text-muted-foreground" />;
}

function humanizeActivity(log: HiringActivityLog) {
  const actor = log.actorName ?? "System";
  const entity = log.entityLabel ? `"${log.entityLabel}"` : "";
  const parseMeta = () => {
    try { return log.metadataJson ? JSON.parse(log.metadataJson) : null; } catch { return null; }
  };
  switch (log.activityType) {
    case "JOB_CREATED": return `${actor} created job ${entity}`;
    case "JOB_PUBLISHED": return `${actor} published job ${entity}`;
    case "JOB_ARCHIVED": return `${actor} archived job ${entity}`;
    case "CANDIDATE_APPLIED": return `${entity} applied`;
    case "CANDIDATE_STAGE_CHANGED": {
      const meta = parseMeta() as { fromStage?: string; toStage?: string } | null;
      return `${actor} moved ${entity} from ${meta?.fromStage ?? "?"} to ${meta?.toStage ?? "?"}`;
    }
    case "CANDIDATE_HIRED": return `${entity} was hired`;
    case "CANDIDATE_REJECTED": return `${entity} was rejected`;
    case "INTERVIEW_SCHEDULED": return `Interview scheduled for ${entity}`;
    case "TASK_CREATED": return `${actor} created a hiring task`;
    case "TASK_COMPLETED": return `${actor} completed a hiring task`;
    case "NOTE_ADDED": return `${actor} added a note on ${entity}`;
    default: return `${actor} — ${log.activityType.toLowerCase().replace(/_/g, " ")}`;
  }
}

export default function HiringDashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/hiring/analytics/dashboard"],
  });

  const { data: activity = [], isLoading: activityLoading } = useQuery<HiringActivityLog[]>({
    queryKey: ["/api/hiring/activity"],
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="heading-hiring-dashboard">Hiring Dashboard</h1>
        <p className="text-muted-foreground">Overview of your hiring pipeline and activity</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={BriefcaseBusiness} label="Open Roles" value={stats?.openRoles} href="/hiring/jobs" />
        <StatCard icon={FileText} label="Draft Roles" value={stats?.draftRoles} href="/hiring/jobs" />
        <StatCard icon={Users} label="Total Applicants" value={stats?.totalApplicants} href="/hiring/candidates" />
        <StatCard icon={UserPlus} label="New (7 Days)" value={stats?.newInLast7Days} href="/hiring/candidates" />
        <StatCard icon={CalendarClock} label="Interviews Scheduled" value={stats?.scheduledInterviews} />
        <StatCard icon={Star} label="Offer Ready" value={stats?.offerReady} href="/hiring/pipeline" />
        <StatCard icon={CheckCircle2} label="Published Roles" value={stats?.publishedRoles} href="/hiring/jobs" />
        <StatCard
          icon={AlertCircle}
          label="Overdue Tasks"
          value={stats?.overdueHiringTasks}
          color={(stats?.overdueHiringTasks ?? 0) > 0 ? "bg-destructive" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Hiring Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activityLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No recent activity</div>
          ) : (
            <ul className="divide-y">
              {activity.slice(0, 20).map((log) => (
                <li key={log.id} className="flex items-start gap-3 px-4 py-3" data-testid={`activity-row-${log.id}`}>
                  <span className="mt-0.5 shrink-0">{activityIcon(log.activityType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{humanizeActivity(log)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
