import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600",
  IN_PROGRESS: "text-blue-600",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600",
  ON_HOLD: "text-yellow-600",
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

export function PortalScheduleTab({ schedule }: PortalScheduleTabProps) {
  return (
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
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{task.name}</TableCell>
                    <TableCell>
                      {task.startDate
                        ? format(new Date(task.startDate), "MMM d")
                        : "TBD"}
                    </TableCell>
                    <TableCell>
                      {task.endDate
                        ? format(new Date(task.endDate), "MMM d")
                        : "TBD"}
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
  );
}
