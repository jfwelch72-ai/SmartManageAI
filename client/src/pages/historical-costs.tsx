import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, Search, Filter, Plus, Trash2, TrendingUp, DollarSign, Calendar, BarChart3 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const addCostSchema = z.object({
  description: z.string().min(1, "Description is required"),
  scopeCategory: z.string().min(1, "Scope category is required"),
  trade: z.string().optional(),
  costCode: z.string().optional(),
  quantity: z.coerce.number().min(0.01, "Quantity is required"),
  unit: z.string().min(1, "Unit is required"),
  unitCost: z.coerce.number().min(0, "Unit cost is required"),
  projectName: z.string().optional(),
  projectType: z.string().optional(),
  completedDate: z.string().optional(),
  materialCost: z.coerce.number().min(0).optional(),
  laborCost: z.coerce.number().min(0).optional(),
  equipmentCost: z.coerce.number().min(0).optional(),
  subcontractCost: z.coerce.number().min(0).optional(),
});

type AddCostFormValues = z.infer<typeof addCostSchema>;

interface AggregatedCost {
  scopeCategory: string;
  trade: string | null;
  unit: string;
  costCode: string | null;
  recordCount: number;
  avgUnitCost: string;
  minUnitCost: string;
  maxUnitCost: string;
  totalQuantity: string;
  totalCost: string;
  latestDate: string | null;
  earliestDate: string | null;
}

interface HistoricalCost {
  id: string;
  description: string;
  scopeCategory: string;
  trade: string | null;
  costCode: string | null;
  quantity: string;
  unit: string;
  unitCost: string;
  totalCost: string;
  projectName: string | null;
  projectType: string | null;
  completedDate: string | null;
  materialCost: string | null;
  laborCost: string | null;
  equipmentCost: string | null;
  subcontractCost: string | null;
  createdAt: string;
}

function fmt(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function HistoricalCostsPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTrade, setSelectedTrade] = useState("all");
  const [selectedScope, setSelectedScope] = useState("all");
  const [selectedCostCode, setSelectedCostCode] = useState("all");
  const [selectedProjectType, setSelectedProjectType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activeTab, setActiveTab] = useState<"aggregated" | "detail">("aggregated");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("search", searchTerm);
    if (selectedTrade !== "all") params.set("trade", selectedTrade);
    if (selectedScope !== "all") params.set("scopeCategory", selectedScope);
    if (selectedCostCode !== "all") params.set("costCode", selectedCostCode);
    if (selectedProjectType) params.set("projectType", selectedProjectType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return params.toString();
  };

  const { data: aggregatedData, isLoading: aggLoading } = useQuery<{
    aggregated: AggregatedCost[];
    filters: { trades: string[]; scopeCategories: string[]; costCodes: string[] };
  }>({
    queryKey: ["/api/historical-costs/aggregated", selectedTrade, selectedScope, selectedCostCode, selectedProjectType, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedTrade !== "all") params.set("trade", selectedTrade);
      if (selectedScope !== "all") params.set("scopeCategory", selectedScope);
      if (selectedCostCode !== "all") params.set("costCode", selectedCostCode);
      if (selectedProjectType) params.set("projectType", selectedProjectType);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/api/historical-costs/aggregated?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: detailData = [], isLoading: detailLoading } = useQuery<HistoricalCost[]>({
    queryKey: ["/api/historical-costs", searchTerm, selectedTrade, selectedScope, selectedCostCode, selectedProjectType, startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/historical-costs?${buildParams()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: activeTab === "detail",
  });

  const form = useForm<AddCostFormValues>({
    resolver: zodResolver(addCostSchema),
    defaultValues: {
      description: "",
      scopeCategory: "",
      trade: "",
      costCode: "",
      quantity: 0,
      unit: "",
      unitCost: 0,
      projectName: "",
      projectType: "",
      completedDate: "",
      materialCost: 0,
      laborCost: 0,
      equipmentCost: 0,
      subcontractCost: 0,
    },
  });

  const addCostMutation = useMutation({
    mutationFn: async (data: AddCostFormValues) => {
      const totalCost = data.quantity * data.unitCost;
      const res = await apiRequest("POST", "/api/historical-costs", {
        ...data,
        totalCost: String(totalCost),
        trade: data.trade || undefined,
        costCode: data.costCode || undefined,
        completedDate: data.completedDate || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/historical-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/historical-costs/aggregated"] });
      setShowAddDialog(false);
      form.reset();
      toast({ title: "Historical cost record added" });
    },
    onError: () => {
      toast({ title: "Failed to add cost record", variant: "destructive" });
    },
  });

  const deleteCostMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/historical-costs/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/historical-costs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/historical-costs/aggregated"] });
      toast({ title: "Record deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete record", variant: "destructive" });
    },
  });

  const aggregated = aggregatedData?.aggregated || [];
  const filters = aggregatedData?.filters || { trades: [], scopeCategories: [], costCodes: [] };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-full px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground mb-1" data-testid="text-page-title">
              Historical Cost Database
            </h1>
            <p className="text-sm text-muted-foreground">
              Browse and search actual costs from completed projects
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-cost">
            <Plus className="w-4 h-4 mr-2" />
            Add Cost Record
          </Button>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs mb-1 block">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search descriptions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                    data-testid="input-search-costs"
                  />
                </div>
              </div>
              <div className="w-[160px]">
                <Label className="text-xs mb-1 block">Trade</Label>
                <Select value={selectedTrade} onValueChange={setSelectedTrade}>
                  <SelectTrigger data-testid="select-filter-trade">
                    <SelectValue placeholder="All trades" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Trades</SelectItem>
                    {filters.trades.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[160px]">
                <Label className="text-xs mb-1 block">Scope Category</Label>
                <Select value={selectedScope} onValueChange={setSelectedScope}>
                  <SelectTrigger data-testid="select-filter-scope">
                    <SelectValue placeholder="All scopes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {filters.scopeCategories.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[160px]">
                <Label className="text-xs mb-1 block">Cost Code</Label>
                <Select value={selectedCostCode} onValueChange={setSelectedCostCode}>
                  <SelectTrigger data-testid="select-filter-cost-code">
                    <SelectValue placeholder="All codes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Codes</SelectItem>
                    {filters.costCodes.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[160px]">
                <Label className="text-xs mb-1 block">Project Type</Label>
                <Input
                  placeholder="e.g., Commercial"
                  value={selectedProjectType}
                  onChange={(e) => setSelectedProjectType(e.target.value)}
                  data-testid="input-filter-project-type"
                />
              </div>
              <div className="w-[140px]">
                <Label className="text-xs mb-1 block">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  data-testid="input-filter-start-date"
                />
              </div>
              <div className="w-[140px]">
                <Label className="text-xs mb-1 block">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  data-testid="input-filter-end-date"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 mb-4">
          <Button
            variant={activeTab === "aggregated" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("aggregated")}
            data-testid="button-tab-aggregated"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Summary
          </Button>
          <Button
            variant={activeTab === "detail" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab("detail")}
            data-testid="button-tab-detail"
          >
            <Database className="w-4 h-4 mr-2" />
            Detail Records
          </Button>
        </div>

        {activeTab === "aggregated" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cost Summary by Scope & Trade</CardTitle>
              <CardDescription>Aggregated unit costs with min/max/average breakdown</CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              {aggLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : aggregated.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Database className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p className="font-medium mb-1">No historical cost data yet</p>
                  <p className="text-sm">Add cost records from completed projects to build your database</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Scope Category</TableHead>
                        <TableHead>Trade</TableHead>
                        <TableHead>Cost Code</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Records</TableHead>
                        <TableHead className="text-right">Avg $/Unit</TableHead>
                        <TableHead className="text-right">Min $/Unit</TableHead>
                        <TableHead className="text-right">Max $/Unit</TableHead>
                        <TableHead className="text-right">Total Qty</TableHead>
                        <TableHead className="text-right">Total Cost</TableHead>
                        <TableHead>Date Range</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {aggregated.map((row, idx) => (
                        <TableRow key={idx} data-testid={`row-aggregated-${idx}`}>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{row.scopeCategory}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{row.trade || "—"}</TableCell>
                          <TableCell className="text-sm font-mono">{row.costCode || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{row.unit}</TableCell>
                          <TableCell className="text-right">{row.recordCount}</TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${fmt(Number(row.avgUnitCost))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-600">
                            ${fmt(Number(row.minUnitCost))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-red-600">
                            ${fmt(Number(row.maxUnitCost))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmt(Number(row.totalQuantity))}
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium">
                            ${fmt(Number(row.totalCost))}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.earliestDate && row.latestDate
                              ? `${row.earliestDate} — ${row.latestDate}`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "detail" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Individual Cost Records</CardTitle>
              <CardDescription>Detailed line-item costs from completed projects</CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-6">
              {detailLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : detailData.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Database className="w-12 h-12 mx-auto mb-4 opacity-40" />
                  <p className="font-medium mb-1">No records found</p>
                  <p className="text-sm">Try adjusting your filters or add new cost records</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Trade</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">$/Unit</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailData.map((record) => (
                        <TableRow key={record.id} data-testid={`row-cost-${record.id}`}>
                          <TableCell className="font-medium text-sm max-w-[200px] truncate">
                            {record.description}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{record.scopeCategory}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{record.trade || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(Number(record.quantity))}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{record.unit}</TableCell>
                          <TableCell className="text-right font-mono">${fmt(Number(record.unitCost))}</TableCell>
                          <TableCell className="text-right font-mono font-medium">${fmt(Number(record.totalCost))}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">
                            {record.projectName || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {record.completedDate || "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={() => setDeleteRecordId(record.id)}
                              disabled={deleteCostMutation.isPending}
                              data-testid={`button-delete-cost-${record.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Historical Cost Record</DialogTitle>
              <DialogDescription>
                Record actual costs from a completed project for future reference
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => addCostMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., 4-inch concrete slab" {...field} data-testid="input-cost-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="scopeCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Scope Category</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., CONCRETE" {...field} data-testid="input-cost-scope" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="trade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Trade</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Concrete" {...field} data-testid="input-cost-trade" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="costCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost Code</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., 03-100" {...field} data-testid="input-cost-code" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="completedDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Completed Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-cost-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantity</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-cost-quantity" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., CY, SF, LF" {...field} data-testid="input-cost-unit" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="unitCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit Cost ($)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-cost-unit-cost" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="projectName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Source project name" {...field} data-testid="input-cost-project" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="projectType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project Type</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Commercial, Residential" {...field} data-testid="input-cost-project-type" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-4 gap-3">
                  <FormField
                    control={form.control}
                    name="materialCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Material $</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-cost-material" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="laborCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Labor $</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-cost-labor" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="equipmentCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Equipment $</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-cost-equipment" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="subcontractCost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">Subcontract $</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0" {...field} data-testid="input-cost-subcontract" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" type="button" onClick={() => setShowAddDialog(false)} data-testid="button-cancel-add-cost">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addCostMutation.isPending} data-testid="button-submit-add-cost">
                    {addCostMutation.isPending ? "Adding..." : "Add Record"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteRecordId} onOpenChange={(open) => { if (!open) setDeleteRecordId(null); }}>
          <AlertDialogContent data-testid="dialog-delete-cost-record">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Cost Record</AlertDialogTitle>
              <AlertDialogDescription>
                {(() => {
                  const rec = detailData.find(r => r.id === deleteRecordId);
                  return rec
                    ? `Are you sure you want to delete the record "${rec.description}"? This action cannot be undone.`
                    : "Are you sure you want to delete this cost record? This action cannot be undone.";
                })()}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-cost">Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => {
                  if (deleteRecordId) {
                    deleteCostMutation.mutate(deleteRecordId);
                    setDeleteRecordId(null);
                  }
                }}
                data-testid="button-confirm-delete-cost"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
