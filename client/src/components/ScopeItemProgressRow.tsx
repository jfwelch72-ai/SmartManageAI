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
  isMobile?: boolean;
}

export default function ScopeItemProgressRow({ scopeItemId, onDelete, isMobile }: ScopeItemProgressRowProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: progressEntries, isLoading, isFetching } = useQuery<DailyProgressWithCreator[]>({
    queryKey: ["/api/scope-items", scopeItemId, "progress"],
    staleTime: 1000,
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

  if (isLoading && !progressEntries) {
    if (isMobile) {
      return <div className="text-center text-sm text-muted-foreground py-4">Loading progress history...</div>;
    }
    return (
      <TableRow>
        <TableCell colSpan={9} className="bg-muted/50 p-4">
          <div className="text-center text-sm text-muted-foreground">Loading progress history...</div>
        </TableCell>
      </TableRow>
    );
  }

  // Show "no entries" only when we have fetched and confirmed there are none
  const hasEntries = progressEntries && progressEntries.length > 0;

  const progressContent = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="font-semibold text-sm">Daily Progress History</h4>
        {isFetching && <span className="text-xs text-muted-foreground">(updating...)</span>}
      </div>
      {!hasEntries ? (
        <p className="text-sm text-muted-foreground">No daily progress entries yet</p>
      ) : isMobile ? (
        <div className="space-y-2">
          {progressEntries!.map(({ progress, creator }) => (
            <div key={progress.id} className="rounded-md border bg-background p-3 space-y-2" data-testid={`card-progress-mobile-${progress.id}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {format(new Date(progress.workDate), "MMM d, yyyy")}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onDelete(progress.id)}
                  data-testid={`button-delete-progress-mobile-${progress.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Qty Completed</span>
                  <p className="font-mono font-medium">{parseFloat(progress.quantityCompleted).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Qty Billed</span>
                  <p className="font-mono font-medium">{parseFloat(progress.billedQuantity).toLocaleString()}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Billing Status</span>
                  {canEditBillingStatus ? (
                    <Select
                      value={progress.billingStatus}
                      onValueChange={(value) => updateBillingStatusMutation.mutate({
                        progressId: progress.id,
                        billingStatus: value,
                      })}
                      disabled={updateBillingStatusMutation.isPending}
                    >
                      <SelectTrigger className="w-32 h-7 text-xs" data-testid={`select-billing-status-mobile-${progress.id}`}>
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
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Billed Date</span>
                  <span className="font-medium">
                    {progress.billedDate ? (
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Check className="h-3 w-3" />
                        {format(new Date(progress.billedDate), "MMM d, yyyy")}
                      </span>
                    ) : "—"}
                  </span>
                </div>
                {progress.notes && (
                  <div>
                    <span className="text-muted-foreground">Notes</span>
                    <p className="text-foreground">{progress.notes}</p>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Recorded By</span>
                  <span className="font-medium">{creator ? `${creator.firstName} ${creator.lastName}` : "—"}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
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
              {progressEntries!.map(({ progress, creator }) => (
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
  );

  if (isMobile) {
    return progressContent;
  }

  return (
    <TableRow>
      <TableCell colSpan={9} className="bg-muted/50 p-4">
        {progressContent}
      </TableCell>
    </TableRow>
  );
}
