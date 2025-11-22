import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Calendar, Check } from "lucide-react";
import { format } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DailyScopeProgress } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

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
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: progressEntries, isLoading } = useQuery<DailyProgressWithCreator[]>({
    queryKey: ["/api/scope-items", scopeItemId, "progress"],
  });

  // Mutation to update billing status
  const updateBillingStatusMutation = useMutation({
    mutationFn: async ({ progressId, billingStatus }: { progressId: string; billingStatus: string }) => {
      return apiRequest("PATCH", `/api/scope-items/${scopeItemId}/progress/${progressId}`, { billingStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope-items", scopeItemId, "progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Success", description: "Billing status updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update billing status", variant: "destructive" });
    },
  });

  // Check if user can edit billing status (Superintendent, Office Manager, Admin, Manager)
  const canEditBillingStatus = user && ["SUPERINTENDENT", "OFFICE_MANAGER", "ADMIN", "MANAGER"].includes(user.role);

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
                    <TableHead>Billed Date</TableHead>
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
                        {canEditBillingStatus ? (
                          <Select
                            value={progress.billingStatus}
                            onValueChange={(value) => updateBillingStatusMutation.mutate({
                              progressId: progress.id,
                              billingStatus: value,
                            })}
                            disabled={updateBillingStatusMutation.isPending}
                          >
                            <SelectTrigger className="w-36 h-8" data-testid={`select-billing-status-${progress.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NOT_READY">NOT READY</SelectItem>
                              <SelectItem value="READY_TO_BILL">READY TO BILL</SelectItem>
                              <SelectItem value="BILLED">BILLED</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {progress.billingStatus.replace("_", " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {progress.billedDate ? (
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            {format(new Date(progress.billedDate), "MMM d, yyyy")}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
