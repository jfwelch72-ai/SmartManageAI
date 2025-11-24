import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { useBid } from "@/hooks/use-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, FileText, DollarSign, TrendingUp, CheckCircle, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, bidEstimateKey } from "@/lib/queryClient";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import type { 
  Estimate, 
  EstimateLineItem, 
} from "@shared/schema";
import AppHeader from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";

const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  quantity: z.coerce.number().min(0, "Quantity must be positive"),
  materialCost: z.coerce.number().min(0).default(0),
  laborCost: z.coerce.number().min(0).default(0),
  laborHours: z.coerce.number().min(0).default(0),
  equipmentCost: z.coerce.number().min(0).default(0),
  consumablesCost: z.coerce.number().min(0).default(0),
  subcontractCost: z.coerce.number().min(0).default(0),
  overheadAllocation: z.coerce.number().min(0).default(0),
  profitAllocation: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
});

type LineItemFormValues = z.infer<typeof lineItemSchema>;

export default function BidEstimate() {
  const [, params] = useRoute("/bids/:code/estimate");
  const [, setLocation] = useLocation();
  const bidCode = params?.code || "";
  const { data: bid, isLoading: bidLoading } = useBid(bidCode);
  const bidId = bid?.id;
  const { user, logout } = useAuth();
  
  const { toast } = useToast();
  const [addLineItemOpen, setAddLineItemOpen] = useState(false);
  const [editLineItemOpen, setEditLineItemOpen] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<EstimateLineItem | null>(null);
  const [overheadPercent, setOverheadPercent] = useState<number>(10);
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(15);

  // Fetch estimate data
  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate: Estimate & { lineItems: EstimateLineItem[], totals: any } | null
  }>({
    queryKey: bidEstimateKey(bidId),
    enabled: !!bidId,
  });

  const estimate = estimateData?.estimate || null;
  
  const totals = estimate?.totals || {
    materialCost: 0,
    laborCost: 0,
    laborHours: 0,
    equipmentCost: 0,
    consumablesCost: 0,
    subcontractCost: 0,
    overheadAllocation: 0,
    profitAllocation: 0,
    totalCost: 0,
  };

  // Add line item mutation
  const addLineItemMutation = useMutation({
    mutationFn: (data: LineItemFormValues & { estimateId: string }) => 
      apiRequest("POST", `/api/estimates/${data.estimateId}/line-items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      setAddLineItemOpen(false);
      form.reset();
      toast({ title: "Line item added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add line item", variant: "destructive" });
    },
  });

  // Approve estimate mutation
  const approveEstimateMutation = useMutation({
    mutationFn: (estimateId: string) => 
      apiRequest("POST", `/api/estimates/${estimateId}/approve`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      await queryClient.refetchQueries({ queryKey: bidEstimateKey(bidId) });
      toast({ title: "Estimate approved" });
    },
    onError: () => {
      toast({ title: "Failed to approve estimate", variant: "destructive" });
    },
  });

  // Delete line item mutation
  const deleteLineItemMutation = useMutation({
    mutationFn: ({ estimateId, lineItemId }: { estimateId: string, lineItemId: string }) => 
      apiRequest("DELETE", `/api/estimates/${estimateId}/line-items/${lineItemId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      toast({ title: "Line item deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete line item", variant: "destructive" });
    },
  });

  // Edit line item mutation
  const editLineItemMutation = useMutation({
    mutationFn: ({ estimateId, lineItemId, data }: { estimateId: string, lineItemId: string, data: any }) => 
      apiRequest("PUT", `/api/estimates/${estimateId}/line-items/${lineItemId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      setEditLineItemOpen(false);
      setEditingLineItem(null);
      toast({ title: "Line item updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update line item", variant: "destructive" });
    },
  });

  const form = useForm<LineItemFormValues>({
    resolver: zodResolver(lineItemSchema),
    defaultValues: {
      description: "",
      category: "",
      unit: "",
      quantity: 0,
      materialCost: 0,
      laborCost: 0,
      laborHours: 0,
      equipmentCost: 0,
      consumablesCost: 0,
      subcontractCost: 0,
      overheadAllocation: 0,
      profitAllocation: 0,
      notes: "",
    },
  });

  const onSubmit = (values: LineItemFormValues) => {
    if (!estimateData?.estimate) return;

    if (editingLineItem) {
      // For edit: send numeric values, omit estimateId and source
      const editPayload = {
        category: values.category,
        description: values.description,
        unit: values.unit,
        quantity: values.quantity,
        materialCost: values.materialCost,
        laborCost: values.laborCost,
        laborHours: values.laborHours,
        equipmentCost: values.equipmentCost,
        consumablesCost: values.consumablesCost || 0,
        subcontractCost: values.subcontractCost || 0,
        overheadAllocation: values.overheadAllocation,
        profitAllocation: values.profitAllocation,
        notes: values.notes || undefined,
      };
      
      editLineItemMutation.mutate({
        estimateId: estimateData.estimate.id,
        lineItemId: editingLineItem.id,
        data: editPayload,
      });
    } else {
      // For add: send string values with estimateId and source
      const addPayload = {
        estimateId: estimateData.estimate.id,
        category: values.category,
        description: values.description,
        unit: values.unit,
        quantity: String(values.quantity),
        materialCost: String(values.materialCost),
        laborCost: String(values.laborCost),
        laborHours: String(values.laborHours),
        equipmentCost: String(values.equipmentCost),
        consumablesCost: String(values.consumablesCost || 0),
        subcontractCost: String(values.subcontractCost || 0),
        overheadAllocation: String(values.overheadAllocation),
        profitAllocation: String(values.profitAllocation),
        source: "MANUAL",
        notes: values.notes || undefined,
      };
      
      addLineItemMutation.mutate(addPayload as any);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "outline", icon: any }> = {
      "DRAFT": { variant: "secondary", icon: FileText },
      "APPROVED": { variant: "default", icon: CheckCircle },
    };
    const config = variants[status] || variants["DRAFT"];
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="gap-1" data-testid={`badge-estimate-status-${status.toLowerCase()}`}>
        <Icon className="h-3 w-3" />
        {status}
      </Badge>
    );
  };

  if (bidLoading || estimateLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!bid || !estimate) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader
          userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
          userRole={user?.role || ""}
          onLogout={logout}
        />
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Button variant="ghost" onClick={() => setLocation(`/bids/${bidCode}`)} data-testid="button-back">
            ← Back to Bid
          </Button>
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Estimate not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        userName={`${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "User"}
        userRole={user?.role || ""}
        onLogout={logout}
      />
      
      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => setLocation(`/bids/${bidCode}`)} data-testid="button-back">
            ← Back to Bid
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Bid Estimate</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {bid.name} - {bid.code}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(estimate.status)}
            {estimate.status === "DRAFT" && (
              <Button
                size="sm"
                onClick={() => approveEstimateMutation.mutate(estimate.id)}
                disabled={approveEstimateMutation.isPending || estimate.lineItems.length === 0}
                data-testid="button-approve-estimate"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve Estimate
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Total Estimate</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-estimate">
                ${totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {estimate.lineItems.length} line items
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Material Cost</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-material-cost">
                ${totals.materialCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {totals.totalCost > 0 
                  ? `${((totals.materialCost / totals.totalCost) * 100).toFixed(1)}% of total`
                  : "0% of total"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Labor Cost</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-labor-cost">
                ${totals.laborCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {totals.laborHours.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} hours estimated
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
              <CardTitle className="text-sm font-medium">Profit Margin</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-profit-margin">
                ${totals.profitAllocation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {totals.totalCost > 0 
                  ? `${((totals.profitAllocation / totals.totalCost) * 100).toFixed(1)}% of total`
                  : "0% of total"}
              </p>
            </CardContent>
          </Card>
        </div>

        {estimate.status === "DRAFT" && estimate.lineItems.length > 0 && (
          <Card className="border-primary/20 bg-primary/5" data-testid="card-markup-calculator">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Calculator className="h-5 w-5" />
                    Markup Calculator
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Adjust overhead and profit percentages to see impact on total bid amount
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Overhead</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="30"
                          step="0.5"
                          value={overheadPercent}
                          onChange={(e) => {
                            const value = Math.min(30, Math.max(0, Number(e.target.value)));
                            setOverheadPercent(value);
                          }}
                          className="w-16 h-8 text-right"
                          data-testid="input-overhead-percent"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    </div>
                    <Slider
                      value={[overheadPercent]}
                      onValueChange={(value) => setOverheadPercent(value[0])}
                      min={0}
                      max={30}
                      step={0.5}
                      className="w-full"
                      data-testid="slider-overhead"
                    />
                    <div className="flex gap-1">
                      {[5, 10, 15].map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          variant={overheadPercent === preset ? "default" : "outline"}
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setOverheadPercent(preset)}
                          data-testid={`button-overhead-preset-${preset}`}
                        >
                          {preset}%
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Profit</label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="0"
                          max="50"
                          step="0.5"
                          value={profitMarginPercent}
                          onChange={(e) => {
                            const value = Math.min(50, Math.max(0, Number(e.target.value)));
                            setProfitMarginPercent(value);
                          }}
                          className="w-16 h-8 text-right"
                          data-testid="input-profit-margin-percent"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    </div>
                    <Slider
                      value={[profitMarginPercent]}
                      onValueChange={(value) => setProfitMarginPercent(value[0])}
                      min={0}
                      max={50}
                      step={0.5}
                      className="w-full"
                      data-testid="slider-profit-margin"
                    />
                    <div className="flex gap-1">
                      {[10, 15, 20].map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          variant={profitMarginPercent === preset ? "default" : "outline"}
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => setProfitMarginPercent(preset)}
                          data-testid={`button-profit-preset-${preset}`}
                        >
                          {preset}%
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(() => {
                    const directCosts = 
                      totals.materialCost +
                      totals.laborCost +
                      totals.equipmentCost +
                      totals.consumablesCost +
                      totals.subcontractCost;
                    
                    const projectedOverhead = directCosts * (overheadPercent / 100);
                    const costPlusOverhead = directCosts + projectedOverhead;
                    const projectedProfit = costPlusOverhead * (profitMarginPercent / 100);
                    const projectedTotal = costPlusOverhead + projectedProfit;
                    const combinedMarkup = overheadPercent + profitMarginPercent + (overheadPercent * profitMarginPercent / 100);

                    return (
                      <>
                        <div className="p-4 bg-background rounded-md border">
                          <p className="text-sm text-muted-foreground mb-1">Direct Costs</p>
                          <p className="text-xl font-bold">${directCosts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="p-4 bg-background rounded-md border">
                          <p className="text-sm text-muted-foreground mb-1">+ Overhead</p>
                          <p className="text-xl font-bold text-orange-600 dark:text-orange-400">
                            ${projectedOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {overheadPercent}%
                          </p>
                        </div>
                        <div className="p-4 bg-background rounded-md border">
                          <p className="text-sm text-muted-foreground mb-1">+ Profit</p>
                          <p className="text-xl font-bold text-green-600 dark:text-green-400">
                            ${projectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {profitMarginPercent}%
                          </p>
                        </div>
                        <div className="p-4 bg-primary/10 rounded-md border border-primary/20">
                          <p className="text-sm text-muted-foreground mb-1">Total Bid</p>
                          <p className="text-xl font-bold">${projectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {combinedMarkup.toFixed(1)}% markup
                          </p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {estimate.status === "DRAFT" && (
          <div className="flex gap-3">
            <Dialog open={addLineItemOpen} onOpenChange={setAddLineItemOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-open-add-line-item">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Line Item
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Manual Line Item</DialogTitle>
                  <DialogDescription>
                    Create a custom estimate line item with detailed cost breakdown
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="e.g., Foundation excavation" 
                                {...field}
                                data-testid="input-description"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="category"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Category</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-category">
                                  <SelectValue placeholder="Select a category" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="CONCRETE">Concrete</SelectItem>
                                <SelectItem value="EXCAVATION">Excavation</SelectItem>
                                <SelectItem value="PAVERS">Pavers</SelectItem>
                                <SelectItem value="BOLLARDS">Bollards</SelectItem>
                                <SelectItem value="STRIPING">Striping</SelectItem>
                                <SelectItem value="SIGNAGE">Signage</SelectItem>
                                <SelectItem value="LANDSCAPING">Landscaping</SelectItem>
                                <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                              </SelectContent>
                            </Select>
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
                              <Input {...field} placeholder="e.g., CY, SF, LF" data-testid="input-unit" />
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
                              <Input type="number" step="0.01" {...field} placeholder="0" data-testid="input-quantity" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="materialCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Material Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-material-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="laborCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Labor Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-labor-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="laborHours"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Labor Hours</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.1" {...field} placeholder="0.0" data-testid="input-labor-hours" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="equipmentCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Equipment Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-equipment-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="subcontractCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subcontract Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-subcontract-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="overheadAllocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Overhead ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-overhead" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="profitAllocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Profit ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-profit" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Notes (Optional)</FormLabel>
                            <FormControl>
                              <Textarea {...field} value={field.value || ""} placeholder="Additional details..." data-testid="input-notes" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-3">
                      <Button type="button" variant="outline" onClick={() => setAddLineItemOpen(false)} data-testid="button-cancel">
                        Cancel
                      </Button>
                      <Button type="submit" disabled={addLineItemMutation.isPending} data-testid="button-submit-line-item">
                        {addLineItemMutation.isPending ? "Adding..." : "Add Line Item"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>

            <Dialog open={editLineItemOpen} onOpenChange={(open) => {
              setEditLineItemOpen(open);
              if (!open) {
                setEditingLineItem(null);
                form.reset();
              }
            }}>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Line Item</DialogTitle>
                  <DialogDescription>
                    Update the estimate line item details
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Description</FormLabel>
                            <FormControl>
                              <Input 
                                placeholder="e.g., Foundation excavation" 
                                {...field}
                                data-testid="input-edit-description"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="category"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Category</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-edit-category">
                                  <SelectValue placeholder="Select a category" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="CONCRETE">Concrete</SelectItem>
                                <SelectItem value="EXCAVATION">Excavation</SelectItem>
                                <SelectItem value="PAVERS">Pavers</SelectItem>
                                <SelectItem value="BOLLARDS">Bollards</SelectItem>
                                <SelectItem value="STRIPING">Striping</SelectItem>
                                <SelectItem value="SIGNAGE">Signage</SelectItem>
                                <SelectItem value="LANDSCAPING">Landscaping</SelectItem>
                                <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                              </SelectContent>
                            </Select>
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
                              <Input {...field} placeholder="e.g., CY, SF, LF" data-testid="input-edit-unit" />
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
                              <Input type="number" step="0.01" {...field} placeholder="0" data-testid="input-edit-quantity" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="materialCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Material Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-material-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="laborCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Labor Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-labor-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="laborHours"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Labor Hours</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.1" {...field} placeholder="0.0" data-testid="input-edit-labor-hours" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="equipmentCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Equipment Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-equipment-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="subcontractCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subcontract Cost ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-subcontract-cost" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="overheadAllocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Overhead ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-overhead" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="profitAllocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Profit ($)</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" {...field} placeholder="0.00" data-testid="input-edit-profit" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Notes (Optional)</FormLabel>
                            <FormControl>
                              <Textarea {...field} value={field.value || ""} placeholder="Additional details..." data-testid="input-edit-notes" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="flex justify-end gap-3">
                      <Button type="button" variant="outline" onClick={() => {
                        setEditLineItemOpen(false);
                        setEditingLineItem(null);
                        form.reset();
                      }} data-testid="button-cancel-edit">
                        Cancel
                      </Button>
                      <Button type="submit" disabled={editLineItemMutation.isPending} data-testid="button-submit-edit-line-item">
                        {editLineItemMutation.isPending ? "Updating..." : "Update Line Item"}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Estimate Line Items</CardTitle>
            <CardDescription>
              Detailed breakdown of all cost items in this estimate
            </CardDescription>
          </CardHeader>
          <CardContent>
            {estimate.lineItems.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No line items yet</p>
                <p className="text-sm mt-2">Add manual line items to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Labor</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Equipment</TableHead>
                      <TableHead className="text-right">Subcontract</TableHead>
                      <TableHead className="text-right">Overhead</TableHead>
                      <TableHead className="text-right">Profit</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {estimate.status === "DRAFT" && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estimate.lineItems.map((item) => (
                      <TableRow key={item.id} data-testid={`row-line-item-${item.id}`}>
                        <TableCell className="font-medium">{item.description}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.quantity.toLocaleString()}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                        <TableCell className="text-right">
                          ${Number(item.materialCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.laborCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(item.laborHours).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.equipmentCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.subcontractCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.overheadAllocation).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(item.profitAllocation).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          ${Number(item.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        {estimate.status === "DRAFT" && (
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingLineItem(item);
                                  form.reset({
                                    description: item.description,
                                    category: item.category,
                                    unit: item.unit,
                                    quantity: Number(item.quantity),
                                    materialCost: Number(item.materialCost),
                                    laborCost: Number(item.laborCost),
                                    laborHours: Number(item.laborHours),
                                    equipmentCost: Number(item.equipmentCost),
                                    consumablesCost: Number(item.consumablesCost || 0),
                                    subcontractCost: Number(item.subcontractCost || 0),
                                    overheadAllocation: Number(item.overheadAllocation),
                                    profitAllocation: Number(item.profitAllocation),
                                    notes: (item as any).metadata || "",
                                  });
                                  setEditLineItemOpen(true);
                                }}
                                data-testid={`button-edit-line-item-${item.id}`}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (confirm("Delete this line item?")) {
                                    deleteLineItemMutation.mutate({ estimateId: estimate.id, lineItemId: item.id });
                                  }
                                }}
                                data-testid={`button-delete-line-item-${item.id}`}
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
