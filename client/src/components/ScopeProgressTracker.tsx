import { useState, Fragment, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ChevronDown, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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
  const [location, setLocation] = useLocation();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [selectedScopeItem, setSelectedScopeItem] = useState<ScopeItem | null>(null);
  const [showNewScopeDialog, setShowNewScopeDialog] = useState(false);
  
  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Sync filter state FROM URL when location changes
  useEffect(() => {
    const searchParams = new URLSearchParams(location.split('?')[1] || '');
    const urlSearch = searchParams.get('search') || '';
    const urlUnit = searchParams.get('unit') || 'all';
    const urlStatus = searchParams.get('status') || 'all';
    
    // Only update state if ALL values differ to avoid redundant renders
    const needsUpdate = urlSearch !== searchTerm || urlUnit !== unitFilter || urlStatus !== statusFilter;
    
    if (needsUpdate) {
      if (urlSearch !== searchTerm) setSearchTerm(urlSearch);
      if (urlUnit !== unitFilter) setUnitFilter(urlUnit);
      if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    }
  }, [location, searchTerm, unitFilter, statusFilter]);

  // Sync filter state TO URL when filters change
  useEffect(() => {
    // Start from current URL params to preserve other query parameters
    const params = new URLSearchParams(location.split('?')[1] || '');
    
    // Update or remove filter-specific params
    if (searchTerm) {
      params.set('search', searchTerm);
    } else {
      params.delete('search');
    }
    
    if (unitFilter !== 'all') {
      params.set('unit', unitFilter);
    } else {
      params.delete('unit');
    }
    
    if (statusFilter !== 'all') {
      params.set('status', statusFilter);
    } else {
      params.delete('status');
    }
    
    const queryString = params.toString();
    const newPath = location.split('?')[0] + (queryString ? `?${queryString}` : '');
    
    // Only update if the path has changed to avoid infinite loops
    if (newPath !== location) {
      setLocation(newPath, { replace: true });
    }
  }, [searchTerm, unitFilter, statusFilter, location, setLocation]);
  
  // Form state for daily progress
  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantityCompleted, setQuantityCompleted] = useState("");
  const [billedQuantity, setBilledQuantity] = useState("");
  const [billingStatus, setBillingStatus] = useState<"NOT_READY" | "READY_TO_BILL" | "BILLED">("NOT_READY");
  const [notes, setNotes] = useState("");

  // Form state for new scope item
  const [newScopeDescription, setNewScopeDescription] = useState("");
  const [newScopeUnit, setNewScopeUnit] = useState("");
  const [newScopeTotalQty, setNewScopeTotalQty] = useState("");
  const [newScopeUnitPrice, setNewScopeUnitPrice] = useState("");

  // Apply filters to scope items
  const filteredScopeItems = scopeItems.filter((item) => {
    const matchesSearch = searchTerm === "" || 
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesUnit = unitFilter === "all" || item.unit === unitFilter;
    const matchesStatus = statusFilter === "all" || item.billingStatus === statusFilter;
    return matchesSearch && matchesUnit && matchesStatus;
  });

  // Get unique units and statuses for filter dropdowns
  const uniqueUnits = Array.from(new Set(scopeItems.map(item => item.unit))).sort();
  const uniqueStatuses = ["NOT_READY", "READY_TO_BILL", "BILLED"];

  // Calculate summary for each individual SOW item
  const summaryByItem = filteredScopeItems.map(item => {
    const total = parseFloat(item.totalQuantity);
    const completed = parseFloat(item.completedQuantity || "0");
    const billed = parseFloat(item.billedQuantity || "0");
    const remaining = total - completed;
    const completionPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const billingPercent = total > 0 ? Math.round((billed / total) * 100) : 0;
    
    return {
      id: item.id,
      description: item.description,
      unit: item.unit,
      total,
      completed,
      billed,
      remaining,
      completionPercent,
      billingPercent,
      billingStatus: item.billingStatus,
    };
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
      return apiRequest("POST", `/api/scope-items/${data.scopeItemId}/progress`, data);
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
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
      return apiRequest("DELETE", `/api/scope-items/${scopeItemId}/progress/${progressId}`);
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Progress entry deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    },
  });

  // Create new scope item mutation
  const createScopeItemMutation = useMutation({
    mutationFn: async (data: {
      description: string;
      unit: string;
      totalQuantity: string;
      unitPrice?: string;
    }) => {
      return apiRequest("POST", `/api/projects/${projectCode}/scope`, data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Scope item created successfully" });
      setShowNewScopeDialog(false);
      resetNewScopeForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to create scope item", 
        variant: "destructive" 
      });
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

  const resetNewScopeForm = () => {
    setNewScopeDescription("");
    setNewScopeUnit("");
    setNewScopeTotalQty("");
    setNewScopeUnitPrice("");
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

  const handleCreateScopeItem = () => {
    if (!newScopeDescription || !newScopeUnit || !newScopeTotalQty) {
      toast({ title: "Error", description: "Please fill in required fields", variant: "destructive" });
      return;
    }

    const totalQty = parseFloat(newScopeTotalQty);
    if (isNaN(totalQty) || totalQty <= 0) {
      toast({ title: "Error", description: "Total quantity must be a positive number", variant: "destructive" });
      return;
    }

    createScopeItemMutation.mutate({
      description: newScopeDescription,
      unit: newScopeUnit,
      totalQuantity: newScopeTotalQty,
      unitPrice: newScopeUnitPrice || undefined,
    });
  };

  const openProgressDialog = (item: ScopeItem) => {
    setSelectedScopeItem(item);
    setShowProgressDialog(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading scope items...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards by Individual SOW Items */}
      {summaryByItem.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summaryByItem.map((item) => (
            <Card key={item.id} data-testid={`card-sow-item-${item.id}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="text-sm font-medium line-clamp-2">
                  {item.description}
                </CardTitle>
                <Badge variant="outline" className="shrink-0">{item.unit}</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-mono font-medium">{item.total.toLocaleString()} {item.unit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completed:</span>
                      <span className="font-mono font-medium text-green-600 dark:text-green-400">
                        {item.completed.toLocaleString()} {item.unit}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Billed:</span>
                      <span className="font-mono font-medium text-blue-600 dark:text-blue-400">
                        {item.billed.toLocaleString()} {item.unit}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Remaining:</span>
                      <span className="font-mono font-medium text-orange-600 dark:text-orange-400">
                        {item.remaining.toLocaleString()} {item.unit}
                      </span>
                    </div>
                  </div>
                  
                  <div className="pt-2 border-t space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Completion:</span>
                      <span className="font-medium">{item.completionPercent}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div 
                        className="bg-green-600 dark:bg-green-400 h-1.5 rounded-full transition-all" 
                        style={{ width: `${item.completionPercent}%` }}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Billing:</span>
                      <span className="font-medium">{item.billingPercent}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div 
                        className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full transition-all" 
                        style={{ width: `${item.billingPercent}%` }}
                      />
                    </div>
                    
                    <div className="pt-1">
                      <Badge 
                        variant={
                          item.billingStatus === "BILLED" ? "default" : 
                          item.billingStatus === "READY_TO_BILL" ? "secondary" : 
                          "outline"
                        }
                        className="text-xs w-full justify-center"
                      >
                        {item.billingStatus.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Filter and Actions Bar - Always visible */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="search">Search SOW (Scope of Work)</Label>
              <Input
                id="search"
                placeholder="Search scope of work..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-scope"
              />
            </div>
            <div className="w-[180px]">
              <Label htmlFor="unit-filter">Filter by Unit</Label>
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger id="unit-filter" data-testid="select-unit-filter">
                  <SelectValue placeholder="All Units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {uniqueUnits.map(unit => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Label htmlFor="status-filter">Filter by Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" data-testid="select-status-filter">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {uniqueStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setShowNewScopeDialog(true)}
              data-testid="button-new-scope-item"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Scope Item
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scope Items Table with Expandable Progress or Empty State */}
      {scopeItems.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium">No scope items yet</p>
              <p className="text-sm mt-2">Click "New Scope Item" to get started</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>SOW (Scope of Work)</TableHead>
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
              {filteredScopeItems.map((item) => {
              const total = parseFloat(item.totalQuantity);
              const completed = parseFloat(item.completedQuantity || "0");
              const billed = parseFloat(item.billedQuantity || "0");
              const remaining = total - completed;
              const isExpanded = expandedItems.has(item.id);

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
                    <ScopeItemProgressRow 
                      scopeItemId={item.id}
                      onDelete={(progressId) => handleDeleteProgress(item.id, progressId)}
                    />
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}

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
              <div className="space-y-2">
                <Label htmlFor="work-date">Work Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      type="button"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !workDate && "text-muted-foreground"
                      )}
                      data-testid="input-work-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {workDate ? format(parseISO(workDate), "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarPicker
                      mode="single"
                      selected={workDate ? parseISO(workDate) : undefined}
                      onSelect={(date) => setWorkDate(date ? format(date, "yyyy-MM-dd") : "")}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
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

      {/* New Scope Item Dialog */}
      <Dialog open={showNewScopeDialog} onOpenChange={setShowNewScopeDialog}>
        <DialogContent data-testid="dialog-new-scope-item">
          <DialogHeader>
            <DialogTitle>Create New Scope Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-description">SOW (Scope of Work) *</Label>
              <Input
                id="new-description"
                value={newScopeDescription}
                onChange={(e) => setNewScopeDescription(e.target.value)}
                placeholder="e.g., 4' Sidewalk, Slab on Grade, 18' Curb, Excavation, Bollards"
                data-testid="input-new-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="new-unit">Unit *</Label>
                <Input
                  id="new-unit"
                  value={newScopeUnit}
                  onChange={(e) => setNewScopeUnit(e.target.value)}
                  placeholder="e.g., SF, LF, EA, CY"
                  data-testid="input-new-unit"
                />
              </div>
              <div>
                <Label htmlFor="new-total-qty">Total Quantity *</Label>
                <Input
                  id="new-total-qty"
                  type="number"
                  step="0.01"
                  value={newScopeTotalQty}
                  onChange={(e) => setNewScopeTotalQty(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-new-total-qty"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new-unit-price">Unit Price (Optional)</Label>
              <Input
                id="new-unit-price"
                type="number"
                step="0.01"
                value={newScopeUnitPrice}
                onChange={(e) => setNewScopeUnitPrice(e.target.value)}
                placeholder="0.00"
                data-testid="input-new-unit-price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewScopeDialog(false);
                resetNewScopeForm();
              }}
              data-testid="button-cancel-new-scope"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateScopeItem}
              disabled={createScopeItemMutation.isPending}
              data-testid="button-save-new-scope"
            >
              {createScopeItemMutation.isPending ? "Creating..." : "Create Scope Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
