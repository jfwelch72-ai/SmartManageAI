import { useState, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScopeItem } from "@shared/schema";
import ScopeItemProgressRow from "./ScopeItemProgressRow";

interface ScopeProgressTrackerProps {
  scopeItems: ScopeItem[];
  isLoading: boolean;
  projectCode: string;
}

export default function ScopeProgressTracker({ scopeItems, isLoading, projectCode }: ScopeProgressTrackerProps) {
  const { toast } = useToast();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [selectedScopeItem, setSelectedScopeItem] = useState<ScopeItem | null>(null);
  
  // Form state
  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantityCompleted, setQuantityCompleted] = useState("");
  const [billedQuantity, setBilledQuantity] = useState("");
  const [billingStatus, setBillingStatus] = useState<"NOT_READY" | "READY_TO_BILL" | "BILLED">("NOT_READY");
  const [notes, setNotes] = useState("");

  // Calculate summary totals
  const summary = scopeItems.reduce(
    (acc, item) => ({
      totalQuantity: acc.totalQuantity + parseFloat(item.totalQuantity),
      completedQuantity: acc.completedQuantity + parseFloat(item.completedQuantity || "0"),
      billedQuantity: acc.billedQuantity + parseFloat(item.billedQuantity || "0"),
    }),
    { totalQuantity: 0, completedQuantity: 0, billedQuantity: 0 }
  );
  const summaryRemaining = summary.totalQuantity - summary.completedQuantity;
  const summaryProgressPercent = summary.totalQuantity > 0 ? (summary.completedQuantity / summary.totalQuantity) * 100 : 0;

  // Fetch daily progress for expanded scope items using useQueries (respecting React hook rules)
  // Only fetch for expanded rows to avoid N parallel requests on initial load
  const progressQueries = useQueries({
    queries: scopeItems.map((item) => ({
      queryKey: ["/api/scope-items", item.id, "progress"],
      queryFn: async () => {
        const response = await fetch(`/api/scope-items/${item.id}/progress`);
        if (!response.ok) throw new Error("Failed to fetch progress");
        return response.json() as Promise<DailyProgressWithCreator[]>;
      },
      // Only fetch when row is expanded to avoid performance issues on large projects
      enabled: expandedItems.has(item.id),
    })),
  });

  // Create a map of scope item ID to progress data
  const progressDataMap = new Map<string, DailyProgressWithCreator[]>();
  scopeItems.forEach((item, index) => {
    progressDataMap.set(item.id, progressQueries[index]?.data || []);
  });

  // Create daily progress mutation
  const createProgressMutation = useMutation({
    mutationFn: async (data: {
      scopeItemId: string;
      workDate: string;
      quantityCompleted: string;
      billedQuantity: string;
      billingStatus: string;
      notes?: string;
    }) => {
      return apiRequest(`/api/scope-items/${data.scopeItemId}/progress`, "POST", data);
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope-items"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Daily progress recorded" });
      setShowProgressDialog(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record progress", variant: "destructive" });
    },
  });

  // Delete progress mutation
  const deleteProgressMutation = useMutation({
    mutationFn: async ({ scopeItemId, progressId }: { scopeItemId: string; progressId: string }) => {
      return apiRequest(`/api/scope-items/${scopeItemId}/progress/${progressId}`, "DELETE");
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope-items"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Progress entry deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    },
  });

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const resetForm = () => {
    setWorkDate(format(new Date(), "yyyy-MM-dd"));
    setQuantityCompleted("");
    setBilledQuantity("");
    setBillingStatus("NOT_READY");
    setNotes("");
    setSelectedScopeItem(null);
  };

  const handleCreateProgress = () => {
    if (!selectedScopeItem || !quantityCompleted) {
      toast({ title: "Error", description: "Please fill in required fields", variant: "destructive" });
      return;
    }

    createProgressMutation.mutate({
      scopeItemId: selectedScopeItem.id,
      workDate,
      quantityCompleted: quantityCompleted || "0",
      billedQuantity: billedQuantity || "0",
      billingStatus,
      notes,
    });
  };

  const handleDeleteProgress = (scopeItemId: string, progressId: string) => {
    if (confirm("Are you sure you want to delete this progress entry?")) {
      deleteProgressMutation.mutate({ scopeItemId, progressId });
    }
  };

  const openProgressDialog = (item: ScopeItem) => {
    setSelectedScopeItem(item);
    setShowProgressDialog(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading scope items...</div>;
  }

  if (scopeItems.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No scope items yet</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Quantity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-quantity">
              {summary.totalQuantity.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-completed-quantity">
              {summary.completedQuantity.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {summaryProgressPercent.toFixed(1)}% complete
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Billed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-billed-quantity">
              {summary.billedQuantity.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Remaining</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-remaining-quantity">
              {summaryRemaining.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Scope Items Table with Expandable Progress */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Total Qty</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead>Billing Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scopeItems.map((item) => {
              const total = parseFloat(item.totalQuantity);
              const completed = parseFloat(item.completedQuantity || "0");
              const billed = parseFloat(item.billedQuantity || "0");
              const remaining = total - completed;
              const isExpanded = expandedItems.has(item.id);
              const progressEntries = progressDataMap.get(item.id) || [];

              return (
                <Fragment key={item.id}>
                  <TableRow data-testid={`row-scope-${item.id}`}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(item.id)}
                        data-testid={`button-expand-${item.id}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell className="text-right font-mono">{total.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{completed.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{billed.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{remaining.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.billingStatus === "BILLED" ? "default" :
                          item.billingStatus === "READY_TO_BILL" ? "destructive" :
                          "secondary"
                        }
                        data-testid={`badge-billing-${item.id}`}
                      >
                        {item.billingStatus?.replace("_", " ") || "NOT READY"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openProgressDialog(item)}
                        data-testid={`button-add-progress-${item.id}`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Progress
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
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
                                          onClick={() => handleDeleteProgress(item.id, progress.id)}
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
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Add Progress Dialog */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent data-testid="dialog-add-progress">
          <DialogHeader>
            <DialogTitle>Record Daily Progress</DialogTitle>
          </DialogHeader>
          {selectedScopeItem && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium">{selectedScopeItem.description}</p>
                <p className="text-xs text-muted-foreground">Unit: {selectedScopeItem.unit}</p>
              </div>
              <div>
                <Label htmlFor="work-date">Work Date</Label>
                <Input
                  id="work-date"
                  type="date"
                  value={workDate}
                  onChange={(e) => setWorkDate(e.target.value)}
                  data-testid="input-work-date"
                />
              </div>
              <div>
                <Label htmlFor="quantity-completed">Quantity Completed *</Label>
                <Input
                  id="quantity-completed"
                  type="number"
                  step="0.01"
                  value={quantityCompleted}
                  onChange={(e) => setQuantityCompleted(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-quantity-completed"
                />
              </div>
              <div>
                <Label htmlFor="billed-quantity">Billed Quantity</Label>
                <Input
                  id="billed-quantity"
                  type="number"
                  step="0.01"
                  value={billedQuantity}
                  onChange={(e) => setBilledQuantity(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-billed-quantity"
                />
              </div>
              <div>
                <Label htmlFor="billing-status">Billing Status</Label>
                <Select value={billingStatus} onValueChange={(value: any) => setBillingStatus(value)}>
                  <SelectTrigger id="billing-status" data-testid="select-billing-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_READY">Not Ready</SelectItem>
                    <SelectItem value="READY_TO_BILL">Ready to Bill</SelectItem>
                    <SelectItem value="BILLED">Billed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="progress-notes">Notes (Optional)</Label>
                <Textarea
                  id="progress-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about today's work..."
                  rows={3}
                  data-testid="input-progress-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowProgressDialog(false);
                resetForm();
              }}
              data-testid="button-cancel-progress"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProgress}
              disabled={createProgressMutation.isPending}
              data-testid="button-save-progress"
            >
              {createProgressMutation.isPending ? "Saving..." : "Save Progress"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
