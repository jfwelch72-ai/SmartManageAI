import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Package, Plus, AlertTriangle, TrendingUp, DollarSign, Percent, Loader2, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScopeItem } from "@shared/schema";

interface MaterialBudget {
  id: string;
  projectId: string;
  scopeItemId: string;
  description: string;
  unit: string;
  budgetedQuantity: string;
  budgetedUnitCost: string;
  budgetedTotalCost: string;
  actualQuantityUsed: string;
  actualTotalCost: string;
  varianceQuantity: string;
  variancePercent: string;
  alertThresholdPercent: string;
  alertTriggered: boolean;
}

interface MaterialUsage {
  id: string;
  usageDate: string;
  description: string;
  quantityUsed: string;
  unit: string;
  unitCost: string;
  totalCost: string;
  vendorName?: string;
  receiptReference?: string;
  notes?: string;
}

interface MaterialBudgetTrackerProps {
  projectId: string;
  projectCode: string;
  scopeItems: ScopeItem[];
}

export default function MaterialBudgetTracker({ projectId, projectCode, scopeItems }: MaterialBudgetTrackerProps) {
  const { toast } = useToast();
  const [addUsageOpen, setAddUsageOpen] = useState(false);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [selectedScopeItemId, setSelectedScopeItemId] = useState<string>("");

  const { data: budgets = [], isLoading: budgetsLoading } = useQuery<{ budget: MaterialBudget; scopeItem: any }[]>({
    queryKey: ["/api/projects", projectId, "material-budgets"],
  });

  const { data: summary } = useQuery<{
    totalItems: number;
    totalBudgetedCost: number;
    totalActualCost: number;
    variance: number;
    variancePercent: number;
    itemsAtRisk: number;
    alertsTriggered: number;
  }>({
    queryKey: ["/api/projects", projectId, "material-budgets", "summary"],
  });

  const { data: usageEntries = [] } = useQuery<{ usage: MaterialUsage; scopeItem: any; createdBy: any }[]>({
    queryKey: ["/api/projects", projectId, "material-usage"],
  });

  const addUsageMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/projects/${projectId}/material-usage`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-budgets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-usage"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "material-budgets", "summary"] });
      setAddUsageOpen(false);
      toast({
        title: "Material Usage Recorded",
        description: "The material usage has been added and budgets updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to record material usage.",
      });
    },
  });

  const handleAddUsage = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const data = {
      scopeItemId: selectedScopeItemId || formData.get("scopeItemId"),
      materialBudgetId: selectedBudgetId,
      usageDate: formData.get("usageDate"),
      description: formData.get("description"),
      quantityUsed: formData.get("quantityUsed"),
      unit: formData.get("unit"),
      unitCost: formData.get("unitCost") || "0",
      vendorName: formData.get("vendorName") || null,
      receiptReference: formData.get("receiptReference") || null,
      notes: formData.get("notes") || null,
    };

    addUsageMutation.mutate(data);
  };

  const openAddUsageDialog = (budgetId?: string, scopeItemId?: string) => {
    setSelectedBudgetId(budgetId || null);
    setSelectedScopeItemId(scopeItemId || "");
    setAddUsageOpen(true);
  };

  const getUsagePercent = (budget: MaterialBudget) => {
    const budgeted = Number(budget.budgetedQuantity || 0);
    const used = Number(budget.actualQuantityUsed || 0);
    return budgeted > 0 ? Math.min((used / budgeted) * 100, 100) : 0;
  };

  const getProgressColor = (percent: number, alertTriggered: boolean) => {
    if (alertTriggered || percent >= 100) return "bg-destructive";
    if (percent >= 90) return "bg-yellow-500";
    return "bg-primary";
  };

  if (budgetsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {summary && summary.alertsTriggered > 0 && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-center gap-4 py-4">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Material Budget Alert</p>
              <p className="text-sm text-muted-foreground">
                {summary.alertsTriggered} material{summary.alertsTriggered > 1 ? "s" : ""} have exceeded 90% of budgeted quantity. 
                Consider creating a change order.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="h-4 w-4" />
              Total Materials
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-materials">
              {summary?.totalItems || budgets.length}
            </div>
            <p className="text-xs text-muted-foreground">Tracked scope items</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Budgeted Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono" data-testid="text-budgeted-cost">
              ${(summary?.totalBudgetedCost || 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">From bid estimate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Actual Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${(summary?.variance || 0) > 0 ? "text-destructive" : "text-green-600"}`} data-testid="text-actual-cost">
              ${(summary?.totalActualCost || 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {(summary?.variance || 0) > 0 ? "Over budget" : "Under budget"} by ${Math.abs(summary?.variance || 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Items at Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(summary?.itemsAtRisk || 0) > 0 ? "text-destructive" : "text-green-600"}`} data-testid="text-items-at-risk">
              {summary?.itemsAtRisk || 0}
            </div>
            <p className="text-xs text-muted-foreground">Over 90% of budget</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Material Budget vs Actual</CardTitle>
            <CardDescription>
              Track material usage against bid quantities. Alerts trigger at 90% to allow time for change orders.
            </CardDescription>
          </div>
          <Button onClick={() => openAddUsageDialog()} data-testid="button-add-material-usage">
            <Plus className="h-4 w-4 mr-2" />
            Add Usage
          </Button>
        </CardHeader>
        <CardContent>
          {budgets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No Material Budgets</p>
              <p className="text-sm">Material budgets are created automatically when a bid with material costs is converted to a project.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {budgets.map(({ budget, scopeItem }) => {
                const usagePercent = getUsagePercent(budget);
                const remaining = Number(budget.budgetedQuantity) - Number(budget.actualQuantityUsed);
                
                return (
                  <div
                    key={budget.id}
                    className="border rounded-lg p-4 space-y-3"
                    data-testid={`card-material-budget-${budget.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{budget.description}</h4>
                          {budget.alertTriggered && (
                            <Badge variant="destructive" className="text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Alert
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{budget.unit}</p>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => openAddUsageDialog(budget.id, budget.scopeItemId)}
                        data-testid={`button-add-usage-${budget.id}`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Usage
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Budgeted</p>
                        <p className="font-medium font-mono">{Number(budget.budgetedQuantity).toLocaleString()} {budget.unit}</p>
                        <p className="text-xs text-muted-foreground">${Number(budget.budgetedTotalCost).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Used</p>
                        <p className={`font-medium font-mono ${usagePercent >= 90 ? "text-destructive" : ""}`}>
                          {Number(budget.actualQuantityUsed).toLocaleString()} {budget.unit}
                        </p>
                        <p className="text-xs text-muted-foreground">${Number(budget.actualTotalCost).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Remaining</p>
                        <p className={`font-medium font-mono ${remaining < 0 ? "text-destructive" : "text-green-600"}`}>
                          {remaining.toLocaleString()} {budget.unit}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Usage %</p>
                        <p className={`font-medium ${usagePercent >= 90 ? "text-destructive" : ""}`}>
                          {usagePercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Progress 
                        value={usagePercent} 
                        className={`h-2 ${getProgressColor(usagePercent, budget.alertTriggered)}`}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0%</span>
                        <span className="text-yellow-600">90% Alert</span>
                        <span>100%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {usageEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Material Usage</CardTitle>
            <CardDescription>Latest material entries from field reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {usageEntries.slice(0, 10).map(({ usage, scopeItem, createdBy }) => (
                <div 
                  key={usage.id} 
                  className="flex items-center justify-between border-b pb-3 last:border-0"
                  data-testid={`row-usage-${usage.id}`}
                >
                  <div className="flex-1">
                    <p className="font-medium">{usage.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(usage.usageDate), "MMM d, yyyy")} • 
                      {createdBy ? ` ${createdBy.firstName} ${createdBy.lastName}` : ""}
                      {usage.vendorName && ` • ${usage.vendorName}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium font-mono">{Number(usage.quantityUsed).toLocaleString()} {usage.unit}</p>
                    <p className="text-sm text-muted-foreground">${Number(usage.totalCost).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addUsageOpen} onOpenChange={setAddUsageOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Material Usage</DialogTitle>
            <DialogDescription>
              Enter the materials used today. This will be deducted from the budget.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddUsage} className="space-y-4">
            {!selectedBudgetId && (
              <div className="space-y-2">
                <Label htmlFor="scopeItemId">Scope Item</Label>
                <Select 
                  value={selectedScopeItemId} 
                  onValueChange={setSelectedScopeItemId}
                >
                  <SelectTrigger data-testid="select-scope-item">
                    <SelectValue placeholder="Select scope item" />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.description} ({item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="usageDate">Date</Label>
              <Input 
                id="usageDate" 
                name="usageDate" 
                type="date" 
                defaultValue={format(new Date(), "yyyy-MM-dd")}
                required
                data-testid="input-usage-date"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input 
                id="description" 
                name="description" 
                placeholder="e.g., Concrete pour for section A"
                required
                data-testid="input-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantityUsed">Quantity</Label>
                <Input 
                  id="quantityUsed" 
                  name="quantityUsed" 
                  type="number" 
                  step="0.01"
                  placeholder="0"
                  required
                  data-testid="input-quantity"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <Input 
                  id="unit" 
                  name="unit" 
                  placeholder="SF, CY, etc."
                  required
                  data-testid="input-unit"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitCost">Unit Cost ($)</Label>
              <Input 
                id="unitCost" 
                name="unitCost" 
                type="number" 
                step="0.01"
                placeholder="0.00"
                data-testid="input-unit-cost"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendorName">Vendor (Optional)</Label>
                <Input 
                  id="vendorName" 
                  name="vendorName" 
                  placeholder="Vendor name"
                  data-testid="input-vendor"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="receiptReference">Receipt # (Optional)</Label>
                <Input 
                  id="receiptReference" 
                  name="receiptReference" 
                  placeholder="Receipt number"
                  data-testid="input-receipt"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea 
                id="notes" 
                name="notes" 
                placeholder="Any additional notes..."
                rows={2}
                data-testid="input-notes"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddUsageOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addUsageMutation.isPending} data-testid="button-submit-usage">
                {addUsageMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Record Usage
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
