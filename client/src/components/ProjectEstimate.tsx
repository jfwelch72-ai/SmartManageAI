import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useState, useEffect } from "react";
import { useProject } from "@/hooks/use-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Plus, FileText, DollarSign, TrendingUp, AlertTriangle, CheckCircle, Clock, Calculator, Sparkles } from "lucide-react";
import { AISowAssistantDialog } from "@/components/AISowAssistantDialog";
import { LaborRateSelector } from "@/components/LaborRateSelector";
import MaterialCalculator, { getDefaultMaterialCalculatorData, type MaterialCalculatorData } from "@/components/MaterialCalculator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { shouldAutoShowMaterialCalc } from "@/lib/estimate-utils";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
  QuantityCategory 
} from "@shared/schema";

// Form schema for manual line item
const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  quantity: z.coerce.number().min(0, "Quantity must be positive"),
  materialCost: z.coerce.number().min(0).default(0),
  laborCost: z.coerce.number().min(0).default(0),
  laborHours: z.coerce.number().min(0).default(0),
  jobClassificationId: z.string().optional(),
  laborRateUsed: z.coerce.number().min(0).optional(),
  equipmentCost: z.coerce.number().min(0).default(0),
  consumablesCost: z.coerce.number().min(0).default(0),
  subcontractCost: z.coerce.number().min(0).default(0),
  overheadAllocation: z.coerce.number().min(0).default(0),
  profitAllocation: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
});

type LineItemFormValues = z.infer<typeof lineItemSchema>;

export default function ProjectEstimate() {
  const [, params] = useRoute("/projects/:code");
  const projectCode = params?.code || "";
  const { data: project, isLoading: projectLoading } = useProject(projectCode);
  const projectId = project?.id;
  
  const { toast } = useToast();
  const [addLineItemOpen, setAddLineItemOpen] = useState(false);
  const [importTakeoffOpen, setImportTakeoffOpen] = useState(false);
  const [aiSowAssistantOpen, setAiSowAssistantOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(15);
  const [materialCalcData, setMaterialCalcData] = useState<MaterialCalculatorData>(getDefaultMaterialCalculatorData());

  // Fetch estimate data
  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate: Estimate & { lineItems: EstimateLineItem[], totals: any } | null
  }>({
    queryKey: ["/api/projects", projectId, "/estimate"],
    enabled: !!projectId,
  });

  // Fetch takeoff categories for import
  const { data: categoriesData } = useQuery<{ categories: QuantityCategory[] }>({
    queryKey: ["/api/projects", projectId, "/takeoff-categories"],
    enabled: !!projectId,
  });

  const estimate = estimateData?.estimate || null;
  const categories = categoriesData?.categories || [];
  
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

  // Initialize and sync profit margin calculator from actual estimate data
  // MUST be before any conditional returns to follow Rules of Hooks
  useEffect(() => {
    if (estimate && estimate.lineItems.length > 0) {
      // Calculate cost base
      const costBase = 
        totals.materialCost +
        totals.laborCost +
        totals.equipmentCost +
        totals.consumablesCost +
        totals.subcontractCost +
        totals.overheadAllocation;

      // Calculate actual current profit percentage from totals
      const actualMargin = costBase > 0 
        ? (totals.profitAllocation / costBase) * 100 
        : 15; // Default to 15% if no cost base

      // Update state to match actual estimate
      setProfitMarginPercent(Number(actualMargin.toFixed(1)));
    }
  }, [estimate?.id, totals.profitAllocation, totals.totalCost]); // Re-sync when estimate changes

  // Create estimate mutation
  const createEstimateMutation = useMutation({
    mutationFn: () => {
      if (!projectId) {
        throw new Error("Project ID is required");
      }
      return apiRequest("POST", `/api/projects/${projectId}/estimate`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      toast({ title: "Estimate created successfully" });
    },
    onError: (error) => {
      console.error("Create estimate error:", error);
      toast({ title: "Failed to create estimate", variant: "destructive" });
    },
  });

  // Import takeoff mutation
  const importTakeoffMutation = useMutation({
    mutationFn: async (data: { estimateId: string, categoryIds: string[] }) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/estimate/import-takeoff`, data);
      return res.json() as Promise<{ count: number; message?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      setImportTakeoffOpen(false);
      setSelectedCategories([]);
      if (data.count > 0) {
        toast({ title: "Takeoff quantities imported successfully", description: `${data.count} line item(s) added to your estimate` });
      } else if (data.message) {
        toast({ title: "No items imported", description: data.message, variant: "destructive" });
      } else {
        toast({ title: "No items imported", description: "No measurements found to import. Add measurements to your takeoff sheets first." });
      }
    },
    onError: () => {
      toast({ title: "Failed to import takeoff", variant: "destructive" });
    },
  });

  // Add line item mutation
  const addLineItemMutation = useMutation({
    mutationFn: (data: LineItemFormValues & { estimateId: string }) => 
      apiRequest("POST", `/api/estimates/${data.estimateId}/line-items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      setAddLineItemOpen(false);
      form.reset();
      setMaterialCalcData(getDefaultMaterialCalculatorData());
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
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      await queryClient.refetchQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      toast({ title: "Estimate approved and synced to project budget" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "/estimate"] });
      toast({ title: "Line item deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete line item", variant: "destructive" });
    },
  });

  // Form for adding line items
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
      jobClassificationId: undefined,
      laborRateUsed: undefined,
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

    // Convert numbers to strings for decimal database fields
    const payload = {
      estimateId: estimateData.estimate.id,
      category: values.category,
      description: values.description,
      unit: values.unit,
      quantity: String(values.quantity),
      materialCost: String(values.materialCost),
      laborCost: String(values.laborCost),
      laborHours: String(values.laborHours),
      jobClassificationId: values.jobClassificationId || null,
      laborRateUsed: values.laborRateUsed ? String(values.laborRateUsed) : null,
      equipmentCost: String(values.equipmentCost),
      consumablesCost: String(values.consumablesCost || 0),
      subcontractCost: String(values.subcontractCost || 0),
      overheadAllocation: String(values.overheadAllocation),
      profitAllocation: String(values.profitAllocation),
      source: "MANUAL",
      notes: values.notes || undefined,
      concreteDepthInches: materialCalcData.concreteDepthInches || null,
      dimensionWidthInches: materialCalcData.dimensionWidthInches || null,
      dimensionHeightInches: materialCalcData.dimensionHeightInches || null,
      concreteWasteFactor: materialCalcData.concreteWasteFactor || null,
      calculatedConcreteYards: materialCalcData.calculatedConcreteYards || null,
      requiresStoneBase: materialCalcData.requiresStoneBase,
      stoneType: materialCalcData.stoneType || null,
      stoneSize: materialCalcData.stoneSize || null,
      stoneDepthInches: materialCalcData.stoneDepthInches || null,
      stoneWasteFactor: materialCalcData.stoneWasteFactor || null,
      calculatedStoneTons: materialCalcData.calculatedStoneTons || null,
      requiresExcavation: materialCalcData.requiresExcavation,
      excavationDepthInches: materialCalcData.excavationDepthInches || null,
      excavationWidthInches: materialCalcData.excavationWidthInches || null,
      excavationSwellFactor: materialCalcData.excavationSwellFactor || null,
      calculatedExcavationYards: materialCalcData.calculatedExcavationYards || null,
      requiresWireMesh: materialCalcData.requiresWireMesh,
      wireMeshType: materialCalcData.wireMeshType || null,
      wireMeshWasteFactor: materialCalcData.wireMeshWasteFactor || null,
      calculatedWireMeshRolls: materialCalcData.calculatedWireMeshRolls || null,
      requiresRebar: materialCalcData.requiresRebar,
      rebarSize: materialCalcData.rebarSize || null,
      rebarFabType: materialCalcData.rebarFabType || null,
      rebarSpacingInches: materialCalcData.rebarSpacingInches || null,
      rebarWasteFactor: materialCalcData.rebarWasteFactor || null,
      calculatedRebarCount: materialCalcData.calculatedRebarCount || null,
      calculatedRebarLinearFeet: materialCalcData.calculatedRebarLinearFeet || null,
      requiresDowels: materialCalcData.requiresDowels,
      dowelSpacingInches: materialCalcData.dowelSpacingInches || null,
      jointLengthFeet: materialCalcData.jointLengthFeet || null,
      calculatedDowelCount: materialCalcData.calculatedDowelCount || null,
      requiresSealer: materialCalcData.requiresSealer,
      sealerType: materialCalcData.sealerType || null,
      sealerCoats: materialCalcData.sealerCoats || null,
      sealerWasteFactor: materialCalcData.sealerWasteFactor || null,
      calculatedSealerGallons: materialCalcData.calculatedSealerGallons || null,
      requiresUnderlayment: materialCalcData.requiresUnderlayment,
      underlaymentType: materialCalcData.underlaymentType || null,
      underlaymentOverlapInches: materialCalcData.underlaymentOverlapInches || null,
      underlaymentWasteFactor: materialCalcData.underlaymentWasteFactor || null,
      calculatedUnderlaymentSF: materialCalcData.calculatedUnderlaymentSF || null,
    };

    addLineItemMutation.mutate(payload as any);
  };

  const handleImportTakeoff = () => {
    if (!estimateData?.estimate || selectedCategories.length === 0) return;
    importTakeoffMutation.mutate({
      estimateId: estimateData.estimate.id,
      categoryIds: selectedCategories,
    });
  };

  if (projectLoading || (estimateLoading && projectId)) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading estimate...</div>
      </div>
    );
  }

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Project not found</div>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Project Estimate</CardTitle>
            <CardDescription>
              Create a comprehensive cost estimate for this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              No estimate exists for this project yet. Create one to start estimating costs.
            </p>
            <Button 
              onClick={() => {
                console.log("Creating estimate with projectId:", projectId);
                createEstimateMutation.mutate();
              }} 
              disabled={createEstimateMutation.isPending}
              data-testid="button-create-estimate"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Estimate
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary" data-testid="badge-estimate-draft"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
      case "PENDING_APPROVAL":
        return <Badge variant="outline" data-testid="badge-estimate-pending"><AlertTriangle className="h-3 w-3 mr-1" />Pending Approval</Badge>;
      case "APPROVED":
        return <Badge className="bg-green-600 hover:bg-green-700" data-testid="badge-estimate-approved"><CheckCircle className="h-3 w-3 mr-1" />Approved</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6" data-testid="container-project-estimate">
      {/* Header with Status and Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Project Estimate</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage cost estimates and project budget
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
              Approve & Sync to Budget
            </Button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
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

      {/* Profit Margin Calculator */}
      {estimate.status === "DRAFT" && estimate.lineItems.length > 0 && (
        <Card className="border-primary/20 bg-primary/5" data-testid="card-profit-calculator">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Profit Margin Calculator
                </CardTitle>
                <CardDescription className="mt-1">
                  Adjust profit percentage to see impact on job total and profitability
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Profit Margin Slider */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Profit Margin</label>
                  <div className="flex items-center gap-3">
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
                      className="w-20 h-8 text-right"
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
              </div>

              {/* Calculations Display */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(() => {
                  // Calculate cost base (everything except profit)
                  const costBase = 
                    totals.materialCost +
                    totals.laborCost +
                    totals.equipmentCost +
                    totals.consumablesCost +
                    totals.subcontractCost +
                    totals.overheadAllocation;

                  // Calculate current profit percentage from actual totals
                  const actualCurrentProfitPercent = costBase > 0 
                    ? (totals.profitAllocation / costBase) * 100 
                    : 0;

                  // Calculate new profit based on adjusted percentage
                  const newProfit = costBase * (profitMarginPercent / 100);
                  const newTotal = costBase + newProfit;

                  // Calculate differences
                  const profitDifference = newProfit - totals.profitAllocation;
                  const totalDifference = newTotal - totals.totalCost;

                  return (
                    <>
                      {/* Current Values */}
                      <div className="space-y-1 p-3 rounded-lg border bg-card">
                        <p className="text-xs text-muted-foreground">Current Status</p>
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Cost Base:</span>
                            <span className="text-sm font-medium">${costBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Profit ({actualCurrentProfitPercent.toFixed(1)}%):</span>
                            <span className="text-sm font-medium">${totals.profitAllocation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-semibold">Total:</span>
                            <span className="text-base font-bold">${totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>

                      {/* Projected Values */}
                      <div className="space-y-1 p-3 rounded-lg border bg-primary/10 border-primary/20">
                        <p className="text-xs text-muted-foreground">Projected with {profitMarginPercent}%</p>
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Cost Base:</span>
                            <span className="text-sm font-medium">${costBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Profit ({profitMarginPercent}%):</span>
                            <span className="text-sm font-medium text-primary" data-testid="text-projected-profit">${newProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-semibold">Total:</span>
                            <span className="text-base font-bold text-primary" data-testid="text-projected-total">${newTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>

                      {/* Difference */}
                      <div className="space-y-1 p-3 rounded-lg border bg-card">
                        <p className="text-xs text-muted-foreground">Impact</p>
                        <div className="space-y-1">
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Profit Change:</span>
                            <span className={`text-sm font-medium ${profitDifference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {profitDifference >= 0 ? '+' : ''}${profitDifference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs">Margin Change:</span>
                            <span className={`text-sm font-medium ${profitDifference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {profitDifference >= 0 ? '+' : ''}{(profitMarginPercent - actualCurrentProfitPercent).toFixed(1)}%
                            </span>
                          </div>
                          <Separator className="my-1" />
                          <div className="flex justify-between items-baseline">
                            <span className="text-xs font-semibold">Total Change:</span>
                            <span className={`text-base font-bold ${totalDifference >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid="text-total-change">
                              {totalDifference >= 0 ? '+' : ''}${totalDifference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Helper Text */}
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
                <p className="font-medium mb-1">How this works:</p>
                <p>• Cost Base = Materials + Labor + Equipment + Consumables + Subcontractors + Overhead</p>
                <p>• Profit = Cost Base × Profit Margin %</p>
                <p>• Total Bid = Cost Base + Profit</p>
                <p className="mt-2">Adjust the slider to see how different profit margins affect your total bid amount and profitability.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {estimate.status === "DRAFT" && (
        <div className="flex gap-3">
          <Dialog open={importTakeoffOpen} onOpenChange={setImportTakeoffOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-open-import-takeoff">
                <FileText className="h-4 w-4 mr-2" />
                Import from Takeoff
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Takeoff Quantities</DialogTitle>
                <DialogDescription>
                  Select quantity categories from takeoff to generate estimate line items
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {categories.map((category) => (
                    <div 
                      key={category.id}
                      className="flex items-center space-x-3 p-3 border rounded-md hover-elevate"
                    >
                      <Checkbox
                        id={`category-${category.id}`}
                        checked={selectedCategories.includes(category.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedCategories([...selectedCategories, category.id]);
                          } else {
                            setSelectedCategories(selectedCategories.filter(id => id !== category.id));
                          }
                        }}
                        data-testid={`checkbox-category-${category.id}`}
                      />
                      <label
                        htmlFor={`category-${category.id}`}
                        className="flex-1 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                      >
                        {category.name}
                      </label>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setImportTakeoffOpen(false);
                      setSelectedCategories([]);
                    }}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleImportTakeoff}
                    disabled={selectedCategories.length === 0 || importTakeoffMutation.isPending}
                    data-testid="button-confirm-import"
                  >
                    Import {selectedCategories.length} {selectedCategories.length === 1 ? 'Category' : 'Categories'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={addLineItemOpen} onOpenChange={(open) => {
            setAddLineItemOpen(open);
            if (!open) {
              setMaterialCalcData(getDefaultMaterialCalculatorData());
            }
          }}>
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
                              <SelectItem value="GC">General Conditions</SelectItem>
                              <SelectItem value="OVERHEAD">Overhead</SelectItem>
                              <SelectItem value="PROFIT">Profit</SelectItem>
                              <SelectItem value="GENERAL">General</SelectItem>
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
                            <Input 
                              placeholder="e.g., CY, SF, LF" 
                              {...field}
                              data-testid="input-unit"
                            />
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
                            <Input 
                              type="number" 
                              step="0.01" 
                              placeholder="0" 
                              {...field}
                              data-testid="input-quantity"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <h4 className="font-medium text-sm">Cost Breakdown</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="materialCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Material Cost</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-material-cost"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {(() => {
                        const unit = form.watch("unit") || "";
                        const quantity = Number(form.watch("quantity")) || 0;
                        const category = form.watch("category") || "";
                        const description = form.watch("description") || "";

                        const { autoShow: showMaterialCalc } = shouldAutoShowMaterialCalc({
                          unit, category, description, materialCalcData,
                        });

                        return showMaterialCalc ? (
                          <div className="col-span-2">
                            <MaterialCalculator
                              unit={unit}
                              quantity={quantity}
                              description={description}
                              value={materialCalcData}
                              onChange={setMaterialCalcData}
                            />
                          </div>
                        ) : null;
                      })()}

                      <div className="col-span-2 space-y-3 p-3 rounded-md border bg-muted/30">
                        <h5 className="font-medium text-sm">Labor Costs</h5>
                        
                        <div className="space-y-2">
                          <FormLabel className="text-sm">Labor Classification (from Cost Rates)</FormLabel>
                          <LaborRateSelector
                            value={form.watch("jobClassificationId")}
                            onSelect={(classificationId, rate) => {
                              form.setValue("jobClassificationId", classificationId || undefined);
                              form.setValue("laborRateUsed", rate);
                              const laborHours = form.watch("laborHours") || 0;
                              if (rate > 0 && laborHours > 0) {
                                form.setValue("laborCost", laborHours * rate);
                              }
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="laborHours"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Labor Hours</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    step="0.1" 
                                    placeholder="0" 
                                    {...field}
                                    onChange={(e) => {
                                      const hours = parseFloat(e.target.value) || 0;
                                      field.onChange(hours);
                                      const rate = form.watch("laborRateUsed") || 0;
                                      if (rate > 0) {
                                        form.setValue("laborCost", hours * rate);
                                      }
                                    }}
                                    data-testid="input-labor-hours"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="laborCost"
                            render={({ field }) => {
                              const rate = form.watch("laborRateUsed");
                              const hasRate = !!(rate && rate > 0);
                              return (
                                <FormItem>
                                  <FormLabel>
                                    Labor Cost
                                    {hasRate && (
                                      <span className="text-xs text-muted-foreground ml-1">
                                        (auto-calculated)
                                      </span>
                                    )}
                                  </FormLabel>
                                  <FormControl>
                                    <Input 
                                      type="number" 
                                      step="0.01" 
                                      placeholder="0.00" 
                                      {...field}
                                      readOnly={hasRate}
                                      className={hasRate ? "bg-muted" : ""}
                                      data-testid="input-labor-cost"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              );
                            }}
                          />
                        </div>

                        {form.watch("laborRateUsed") && form.watch("laborRateUsed")! > 0 && form.watch("laborHours") > 0 && (
                          <div className="text-xs text-muted-foreground bg-background p-2 rounded border" data-testid="labor-calculation-summary">
                            {form.watch("laborHours")} hrs × ${form.watch("laborRateUsed")?.toFixed(2)}/hr = ${form.watch("laborCost").toFixed(2)}
                          </div>
                        )}
                      </div>

                      <FormField
                        control={form.control}
                        name="equipmentCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Equipment Cost</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-equipment-cost"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="consumablesCost"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Consumables Cost</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-consumables-cost"
                              />
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
                            <FormLabel>Subcontract Cost</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-subcontract-cost"
                              />
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
                            <FormLabel>Overhead Allocation</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-overhead-allocation"
                              />
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
                            <FormLabel>Profit Allocation</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="0.00" 
                                {...field}
                                data-testid="input-profit-allocation"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Additional notes or details..." 
                            {...field}
                            data-testid="input-notes"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-between items-center gap-3">
                    <Button 
                      type="button" 
                      variant="secondary" 
                      onClick={() => {
                        setAddLineItemOpen(false);
                        setAiSowAssistantOpen(true);
                      }}
                      data-testid="button-open-ai-assistant"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Add with AI
                    </Button>
                    <div className="flex gap-3">
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => setAddLineItemOpen(false)}
                        data-testid="button-cancel-line-item"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={addLineItemMutation.isPending}
                        data-testid="button-submit-line-item"
                      >
                        Add Line Item
                      </Button>
                    </div>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <AISowAssistantDialog 
            open={aiSowAssistantOpen}
            onOpenChange={setAiSowAssistantOpen}
            onItemAdded={(item) => {
              form.setValue('description', item.name);
              form.setValue('category', item.categoryName);
              form.setValue('unit', item.unit || 'EA');
              setAddLineItemOpen(true);
              toast({
                title: "Item Selected",
                description: "SOW item details have been filled in. Complete the remaining fields.",
              });
            }}
          />
        </div>
      )}

      {/* Line Items Table */}
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
              <p className="text-sm mt-2">Import from takeoff or add manual line items to get started</p>
            </div>
          ) : (
            <>
            <div className="hidden md:block overflow-x-auto">
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
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {item.description}
                          {item.vendorMatchConfidence && (
                            <Badge
                              variant={item.vendorMatchConfidence === "EXACT" ? "default" : "outline"}
                              className={`text-[10px] px-1.5 py-0 ${
                                item.vendorMatchConfidence === "EXACT"
                                  ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400"
                                  : item.vendorMatchConfidence === "FUZZY"
                                  ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400"
                                  : "bg-gray-100 text-gray-500 border-gray-300 dark:bg-gray-800 dark:text-gray-400"
                              }`}
                              data-testid={`badge-vendor-match-${item.id}`}
                            >
                              {item.vendorMatchConfidence === "EXACT" ? "Exact Match" :
                               item.vendorMatchConfidence === "FUZZY" ? "Fuzzy Match" :
                               "No Match"}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
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
                      <TableCell className="text-right text-muted-foreground">
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
                      <TableCell className="text-right font-semibold">
                        ${Number(item.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      {estimate.status === "DRAFT" && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteLineItemMutation.mutate({ 
                              estimateId: estimate.id, 
                              lineItemId: item.id 
                            })}
                            disabled={deleteLineItemMutation.isPending}
                            data-testid={`button-delete-${item.id}`}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="md:hidden space-y-3">
              {estimate.lineItems.map((item) => (
                <div
                  key={item.id}
                  className="border rounded-md p-3 space-y-2"
                  data-testid={`row-line-item-mobile-${item.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm" data-testid={`text-description-mobile-${item.id}`}>{item.description}</span>
                      {item.vendorMatchConfidence && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 w-fit ${
                            item.vendorMatchConfidence === "EXACT"
                              ? "bg-green-100 text-green-700 border-green-300"
                              : item.vendorMatchConfidence === "FUZZY"
                              ? "bg-amber-100 text-amber-700 border-amber-300"
                              : "bg-gray-100 text-gray-500 border-gray-300"
                          }`}
                          data-testid={`badge-vendor-match-mobile-${item.id}`}
                        >
                          {item.vendorMatchConfidence === "EXACT" ? "Exact Match" :
                           item.vendorMatchConfidence === "FUZZY" ? "Fuzzy Match" :
                           "No Match"}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0" data-testid={`badge-category-mobile-${item.id}`}>
                      {item.category}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-xs text-muted-foreground">Qty / Unit</span>
                      <p data-testid={`text-qty-mobile-${item.id}`}>{item.quantity.toLocaleString()} {item.unit}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Material</span>
                      <p data-testid={`text-material-mobile-${item.id}`}>${Number(item.materialCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Labor</span>
                      <p data-testid={`text-labor-mobile-${item.id}`}>${Number(item.laborCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Labor Hours</span>
                      <p data-testid={`text-hours-mobile-${item.id}`}>{Number(item.laborHours).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Equipment</span>
                      <p data-testid={`text-equipment-mobile-${item.id}`}>${Number(item.equipmentCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Subcontract</span>
                      <p data-testid={`text-subcontract-mobile-${item.id}`}>${Number(item.subcontractCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </div>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="font-semibold" data-testid={`text-total-mobile-${item.id}`}>
                      ${Number(item.totalCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {estimate.status === "DRAFT" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => deleteLineItemMutation.mutate({
                        estimateId: estimate.id,
                        lineItemId: item.id
                      })}
                      disabled={deleteLineItemMutation.isPending}
                      data-testid={`button-delete-mobile-${item.id}`}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              ))}
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
