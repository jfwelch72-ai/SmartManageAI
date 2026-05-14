import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format, differenceInDays } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600 dark:text-green-400",
  IN_PROGRESS: "text-blue-600 dark:text-blue-400",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600 dark:text-red-400",
  ON_HOLD: "text-yellow-600 dark:text-yellow-400",
};

const BAR_COLORS: Record<string, string> = {
  COMPLETED: "bg-green-500",
  IN_PROGRESS: "bg-blue-500",
  NOT_STARTED: "bg-slate-400",
  DELAYED: "bg-red-500",
  ON_HOLD: "bg-yellow-500",
};

interface ScheduleItem {
  name: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
  progress: number | null;
}

interface PortalScheduleTabProps {
  schedule: ScheduleItem[] | undefined;
}

function GanttTimeline({ schedule }: { schedule: ScheduleItem[] }) {
  const tasksWithDates = schedule.filter((t) => t.startDate && t.endDate);
  if (tasksWithDates.length === 0) return null;

  const allStarts = tasksWithDates.map((t) => new Date(t.startDate!).getTime());
  const allEnds = tasksWithDates.map((t) => new Date(t.endDate!).getTime());
  const minDate = Math.min(...allStarts);
  const maxDate = Math.max(...allEnds);
  const totalRange = maxDate - minDate || 1;

  const today = Date.now();
  const todayPosition = ((today - minDate) / totalRange) * 100;

  return (
    <Card data-testid="schedule-gantt-chart">
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
        <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
          <span>{format(new Date(minDate), "MMM d, yyyy")}</span>
          <span className="flex-1 text-center">→</span>
          <span>{format(new Date(maxDate), "MMM d, yyyy")}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 relative">
          {todayPosition >= 0 && todayPosition <= 100 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-primary/50 z-10"
              style={{ left: `${todayPosition}%` }}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-primary font-medium whitespace-nowrap">
                Today
              </div>
            </div>
          )}
          {tasksWithDates.map((task, idx) => {
            const start = new Date(task.startDate!).getTime();
            const end = new Date(task.endDate!).getTime();
            const leftPct = ((start - minDate) / totalRange) * 100;
            const widthPct = Math.max(((end - start) / totalRange) * 100, 1);
            const barColor = BAR_COLORS[task.status || ""] || "bg-slate-400";
            const days = differenceInDays(new Date(end), new Date(start));

            return (
              <div key={idx} className="flex items-center gap-3" data-testid={`gantt-bar-${idx}`}>
                <div className="w-32 shrink-0 text-sm truncate" title={task.name}>
                  {task.name}
                </div>
                <div className="flex-1 relative h-7 bg-muted/50 rounded">
                  <div
                    className={`absolute h-full rounded ${barColor} opacity-80 flex items-center px-2`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${task.name}: ${format(new Date(start), "MMM d")} - ${format(new Date(end), "MMM d")} (${days}d)`}
                  >
                    {widthPct > 8 && (
                      <span className="text-[10px] text-white font-medium truncate">
                        {days}d
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t">
          {Object.entries(BAR_COLORS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm ${color}`} />
              <span className="text-xs text-muted-foreground">{status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PortalScheduleTab({ schedule }: PortalScheduleTabProps) {
  return (
    <div className="space-y-4">
      {schedule && schedule.length > 0 && <GanttTimeline schedule={schedule} />}

      <Card>
        <CardHeader>
          <CardTitle>Project Schedule</CardTitle>
          <CardDescription>Timeline and milestones for this project</CardDescription>
        </CardHeader>
        <CardContent>
          {schedule && schedule.length > 0 ? (
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.map((task, idx) => (
                    <TableRow key={idx} data-testid={`row-schedule-${idx}`}>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>
                        {task.startDate
                          ? format(new Date(task.startDate), "MMM d, yyyy")
                          : <span className="text-muted-foreground italic text-sm">No date scheduled</span>}
                      </TableCell>
                      <TableCell>
                        {task.endDate
                          ? format(new Date(task.endDate), "MMM d, yyyy")
                          : <span className="text-muted-foreground italic text-sm">No date scheduled</span>}
                      </TableCell>
                      <TableCell>
                        <span className={STATUS_COLORS[task.status || ""] || "text-muted-foreground"}>
                          {task.status?.replace(/_/g, " ") || "Pending"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <Progress value={task.progress || 0} className="h-2 flex-1" />
                          <span className="text-sm text-muted-foreground w-10 text-right">
                            {task.progress || 0}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No schedule data available yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
