import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600 dark:text-green-400",
  IN_PROGRESS: "text-blue-600 dark:text-blue-400",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600 dark:text-red-400",
  ON_HOLD: "text-yellow-600 dark:text-yellow-400",
};

const CHART_COLORS: Record<string, string> = {
  COMPLETED: "#22c55e",
  IN_PROGRESS: "#3b82f6",
  NOT_STARTED: "#94a3b8",
  DELAYED: "#ef4444",
  ON_HOLD: "#eab308",
};

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  IN_PROGRESS: "In Progress",
  NOT_STARTED: "Not Started",
  DELAYED: "Delayed",
  ON_HOLD: "On Hold",
};

interface ProgressItem {
  description: string;
  status: string;
  completionPercentage: number | null;
  updatedAt: string | null;
}

interface PortalProgressTabProps {
  progress: ProgressItem[] | undefined;
}

export function PortalProgressTab({ progress }: PortalProgressTabProps) {
  const statusCounts: Record<string, number> = {};
  progress?.forEach((item) => {
    const status = item.status || "NOT_STARTED";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const chartData = Object.entries(statusCounts).map(([status, count]) => ({
    name: STATUS_LABELS[status] || status.replace(/_/g, " "),
    value: count,
    color: CHART_COLORS[status] || "#94a3b8",
  }));

  return (
    <div className="space-y-4">
      {chartData.length > 0 && (
        <Card data-testid="progress-donut-chart">
          <CardHeader>
            <CardTitle className="text-base">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    dataKey="value"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      color: "hsl(var(--foreground))",
                    }}
                    formatter={(value: number, name: string) => [`${value} items`, name]}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-sm text-foreground">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scope Progress</CardTitle>
          <CardDescription>Current status of project scope items</CardDescription>
        </CardHeader>
        <CardContent>
          {progress && progress.length > 0 ? (
            <ScrollArea className="max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progress.map((item, idx) => (
                    <TableRow key={idx} data-testid={`row-progress-${idx}`}>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell>
                        <span className={STATUS_COLORS[item.status] || "text-muted-foreground"}>
                          {item.status?.replace(/_/g, " ") || "N/A"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <Progress value={item.completionPercentage || 0} className="h-2 flex-1" />
                          <span className="text-sm text-muted-foreground w-10 text-right">
                            {item.completionPercentage || 0}%
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
              No progress data available yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
