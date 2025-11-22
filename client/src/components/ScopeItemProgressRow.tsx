import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Calendar } from "lucide-react";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import type { DailyScopeProgress } from "@shared/schema";

interface DailyProgressWithCreator {
  progress: DailyScopeProgress;
  creator: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface ScopeItemProgressRowProps {
  scopeItemId: string;
  onDelete: (progressId: string) => void;
}

export default function ScopeItemProgressRow({ scopeItemId, onDelete }: ScopeItemProgressRowProps) {
  const { data: progressEntries, isLoading } = useQuery<DailyProgressWithCreator[]>({
    queryKey: ["/api/scope-items", scopeItemId, "progress"],
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="bg-muted/50 p-4">
          <div className="text-center text-sm text-muted-foreground">Loading progress history...</div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={9} className="bg-muted/50 p-4">
        <div className="space-y-2">
          <h4 className="font-semibold text-sm mb-3">Daily Progress History</h4>
          {!progressEntries || progressEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No daily progress entries yet</p>
          ) : (
            <div className="rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Qty Completed</TableHead>
                    <TableHead className="text-right">Qty Billed</TableHead>
                    <TableHead>Billing Status</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progressEntries.map(({ progress, creator }) => (
                    <TableRow key={progress.id} data-testid={`row-progress-${progress.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(progress.workDate), "MMM d, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(progress.quantityCompleted).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(progress.billedQuantity).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {progress.billingStatus.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {progress.notes || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {creator ? `${creator.firstName} ${creator.lastName}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(progress.id)}
                          data-testid={`button-delete-progress-${progress.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
