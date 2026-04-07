import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Users, TrendingUp, AlertTriangle, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface DailyAllocation {
  date: string;
  dayLabel: string;
  assignedWorkers: number;
  projectCount: number;
}

interface ProjectForecast {
  projectId: string;
  projectName: string;
  crewCount: number;
  workerCount: number;
  startDate: string | null;
  endDate: string | null;
}

interface Conflict {
  userId: string;
  userName: string;
  date: string;
  projects: string[];
}

interface ScheduleImpactResponse {
  dailyAllocation: DailyAllocation[];
  projectForecast: ProjectForecast[];
  conflicts: Conflict[];
  summary: {
    totalAssignedNext7Days: number;
    peakDay: string | null;
    peakWorkers: number;
    conflictCount: number;
  };
}

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{d.dayLabel} ({d.date})</p>
      <p className="text-muted-foreground">Workers: {d.assignedWorkers}</p>
      <p className="text-muted-foreground">Projects: {d.projectCount}</p>
    </div>
  );
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ScheduleImpactWidget() {
  const { data, isLoading, isError, refetch} = useQuery<ScheduleImpactResponse>({
    queryKey: ["/api/dashboard/schedule-impact"],
    refetchInterval: 300000,
  });

  if (isLoading) {
    return (
      <Card data-testid="schedule-impact-loading">
        <CardHeader className="pb-2 px-4 pt-4">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="schedule-impact-error">
        <CardContent className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <AlertCircle className="w-6 h-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground">Failed to load schedule data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-widget">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = data?.summary || { totalAssignedNext7Days: 0, peakDay: null, peakWorkers: 0, conflictCount: 0 };
  const dailyAllocation = data?.dailyAllocation || [];
  const projectForecast = data?.projectForecast || [];
  const conflicts = data?.conflicts || [];
  const isEmpty = dailyAllocation.every(d => d.assignedWorkers === 0) && projectForecast.length === 0;

  return (
    <Card className="transition-all duration-200 hover:shadow-md" data-testid="schedule-impact-widget">
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-600/5 flex items-center justify-center">
            <CalendarDays className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          </div>
          <CardTitle className="text-sm font-medium">Schedule Impact</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        <div className="grid grid-cols-3 gap-2" data-testid="schedule-impact-summary">
          <div className="text-center p-2 bg-blue-500/10 rounded-xl transition-all duration-200 hover:scale-[1.03]">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Users className="w-3 h-3 text-blue-500" />
              <span className="text-xs text-muted-foreground">Total 7D</span>
            </div>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid="text-total-assigned">{summary.totalAssignedNext7Days}</p>
          </div>
          <div className="text-center p-2 bg-green-500/10 rounded-xl transition-all duration-200 hover:scale-[1.03]">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <TrendingUp className="w-3 h-3 text-green-500" />
              <span className="text-xs text-muted-foreground">Peak</span>
            </div>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid="text-peak-day">
              {summary.peakDay || "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">{summary.peakWorkers} workers</p>
          </div>
          <div className={`text-center p-2 rounded-xl transition-all duration-200 hover:scale-[1.03] ${summary.conflictCount > 0 ? "bg-amber-500/10" : "bg-muted/30"}`}>
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <AlertTriangle className={`w-3 h-3 ${summary.conflictCount > 0 ? "text-amber-500" : "text-green-500"}`} />
              <span className="text-xs text-muted-foreground">Conflicts</span>
            </div>
            <p className={`text-lg font-semibold ${summary.conflictCount > 0 ? "text-amber-600 dark:text-amber-400" : ""}`} data-testid="text-conflict-count">
              {summary.conflictCount}
            </p>
          </div>
        </div>

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-6 text-center" data-testid="schedule-impact-empty">
            <CalendarDays className="w-8 h-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No crew assignments found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Assign crews to projects to see the schedule forecast</p>
          </div>
        ) : (
          <>
            <div data-testid="schedule-impact-chart">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Labor Allocation — Next 7 Days</p>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={dailyAllocation} margin={{ top: 2, right: 2, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" vertical={false} />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fontSize: 10 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltipContent />} />
                  <Bar
                    dataKey="assignedWorkers"
                    name="Workers"
                    fill="hsl(215, 70%, 55%)"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {projectForecast.length > 0 && (
              <div data-testid="schedule-impact-forecast">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Project Manpower</p>
                <div className="space-y-1.5">
                  {projectForecast.map((pf) => (
                    <div
                      key={pf.projectId}
                      className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/20"
                      data-testid={`forecast-project-${pf.projectId}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{pf.projectName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatDateShort(pf.startDate)} – {formatDateShort(pf.endDate)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {pf.crewCount} crew{pf.crewCount !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {pf.workerCount} worker{pf.workerCount !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div data-testid="schedule-impact-conflicts">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Conflicts / Overbooking</p>
              {conflicts.length === 0 ? (
                <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 text-green-700 dark:text-green-400" data-testid="no-conflicts">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">No scheduling conflicts detected</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {conflicts.map((c, idx) => (
                    <div
                      key={`${c.userId}-${c.date}-${idx}`}
                      className="flex items-start gap-2 p-1.5 rounded bg-amber-500/10"
                      data-testid={`conflict-${c.userId}-${c.date}`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                          {c.userName} — {formatDateShort(c.date)}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {c.projects.join(", ")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
