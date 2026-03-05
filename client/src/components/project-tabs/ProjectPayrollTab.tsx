import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

interface ProjectPayrollSummary {
  laborCostToDate: number;
  budget: number;
  laborVsBudget: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  overtimePercent: number;
  totalEntries: number;
  workers: { userId: string; name: string; role: string; regularHours: number; overtimeHours: number }[];
}

export default function ProjectPayrollTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<ProjectPayrollSummary>({
    queryKey: ["/api/projects", projectId, "payroll-summary"],
  });

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No payroll data available</div>;
  }

  const budgetUsedPercent = summary.laborVsBudget;
  const budgetBarColor = budgetUsedPercent > 90 ? "bg-red-500" : budgetUsedPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor Cost to Date</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-cost">{formatCurrency(summary.laborCostToDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor vs Budget</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-budget">
              {summary.budget > 0 ? `${budgetUsedPercent.toFixed(1)}%` : "N/A"}
            </p>
            {summary.budget > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                <div className={`${budgetBarColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overtime %</p>
            <p className="text-2xl font-bold" data-testid="text-project-overtime-pct">{summary.overtimePercent}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalOvertimeHours.toFixed(1)} OT / {(summary.totalRegularHours + summary.totalOvertimeHours).toFixed(1)} total hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Workers Assigned</p>
            <p className="text-2xl font-bold" data-testid="text-project-workers">{summary.workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.totalEntries} time entries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Workers on This Project</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.workers.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No workers have logged time on this project</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map(w => (
                  <TableRow key={w.userId} data-testid={`row-project-worker-${w.userId}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.regularHours.toFixed(1)}</TableCell>
                    <TableCell>{w.overtimeHours > 0 ? w.overtimeHours.toFixed(1) : "\u2014"}</TableCell>
                    <TableCell className="font-medium">{(w.regularHours + w.overtimeHours).toFixed(1)}</TableCell>
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
