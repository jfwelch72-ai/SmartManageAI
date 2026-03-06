import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600",
  IN_PROGRESS: "text-blue-600",
  NOT_STARTED: "text-muted-foreground",
  DELAYED: "text-red-600",
  ON_HOLD: "text-yellow-600",
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
  return (
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
                  <TableRow key={idx}>
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
  );
}
