import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState } from "react";
import { useBid } from "@/hooks/use-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, FileText, DollarSign, TrendingUp, CheckCircle, Calculator, Layers, Mountain, Tag, Store } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, bidEstimateKey } from "@/lib/queryClient";
import StandardizedScopeSelector, { ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import { UomSelect } from "@/components/UomSelect";
import MaterialCalculator, { MaterialJobTotals, getDefaultMaterialCalculatorData, type MaterialCalculatorData } from "@/components/MaterialCalculator";
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
  BidSubcontractorQuote,
} from "@shared/schema";
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
  subcontractorQuoteId: z.string().optional(),
  overheadAllocation: z.coerce.number().min(0).default(0),
  profitAllocation: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  scopeWorkTypeId: z.string().optional(),
});

type LineItemFormValues = z.infer<typeof lineItemSchema>;

type CatalogPriceItem = {
  id: string;
  itemName: string;
  itemCode: string | null;
  category: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumOrder: number | null;
  deliveryFee: string | null;
  effectiveQuarter: string;
  leadTimeDays: number | null;
  vendorId: string;
  vendorName: string;
  vendorType: string;
};

export default function BidEstimate() {
  const [, params] = useRoute("/bids/:code/estimate");
  const [, setLocation] = useLocation();
  const bidCode = params?.code || "";
  const { data: bid, isLoading: bidLoading } = useBid(bidCode);
  const bidId = bid?.id;
  const { user, logout, organizationName } = useAuth();
  
  // Check if user has estimate editing access (Admin, Manager, Estimator only)
  const hasEstimateAccess = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "ESTIMATOR";
  
  const { toast } = useToast();
  const [addLineItemOpen, setAddLineItemOpen] = useState(false);
  const [editLineItemOpen, setEditLineItemOpen] = useState(false);
  const [editingLineItem, setEditingLineItem] = useState<EstimateLineItem | null>(null);
  const [overheadPercent, setOverheadPercent] = useState<number>(10);
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(15);
  const [selectedScopeData, setSelectedScopeData] = useState<ScopeSelectionData | null>(null);
  const [materialCalcData, setMaterialCalcData] = useState<MaterialCalculatorData>(getDefaultMaterialCalculatorData());
  const [selectedCatalogCategory, setSelectedCatalogCategory] = useState<string>("");

  // Fetch estimate data
  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate: Estimate & { lineItems: EstimateLineItem[], totals: any } | null
  }>({
    queryKey: bidEstimateKey(bidId),
    enabled: !!bidId,
  });

  const estimate = estimateData?.estimate || null;
  
  // Fetch subcontractor quotes for the bid
  const { data: subcontractorQuotes = [] } = useQuery<BidSubcontractorQuote[]>({
    queryKey: ["/api/bids", bidId, "subcontractor-quotes"],
    enabled: !!bidId,
  });
  
  // Fetch catalog pricing suggestions for the selected category
  const { data: catalogPrices = [] } = useQuery<CatalogPriceItem[]>({
    queryKey: [`/api/vendor-pricing/search?category=${selectedCatalogCategory}`],
    enabled: !!selectedCatalogCategory && hasEstimateAccess,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  
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
      setSelectedScopeData(null);
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
      setMaterialCalcData(getDefaultMaterialCalculatorData());
      setSelectedCatalogCategory("");
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
      scopeWorkTypeId: undefined,
    },
  });

  // Handle standardized scope selection
  const handleScopeSelect = (data: ScopeSelectionData) => {
    setSelectedScopeData(data);
    form.setValue("description", data.canonicalName);
    form.setValue("unit", data.unit);
    form.setValue("scopeWorkTypeId", data.workTypeId);
    
    // Map category name to our category enum
    const categoryMap: Record<string, string> = {
      "Sidewalk": "CONCRETE",
      "Driveway": "CONCRETE",
      "Curb & Gutter": "CONCRETE",
      "Foundation": "CONCRETE",
      "Patio": "CONCRETE",
      "Flatwork": "CONCRETE",
      "Excavation": "EXCAVATION",
      "Grading": "EXCAVATION",
      "Pavers": "PAVERS",
      "Bollards": "BOLLARDS",
      "Striping": "STRIPING",
      "Signage": "SIGNAGE",
      "Landscaping": "LANDSCAPING",
      "Electrical": "ELECTRICAL",
    };
    const mappedCategory = categoryMap[data.categoryName] || "OTHER";
    form.setValue("category", mappedCategory);
    setSelectedCatalogCategory(mappedCategory);
  };
  
  // Handle category change to trigger catalog lookup
  const handleCategoryChange = (value: string) => {
    form.setValue("category", value);
    setSelectedCatalogCategory(value);
  };
  
  // Apply catalog pricing to form
  const applyCatalogPrice = (item: CatalogPriceItem) => {
    const quantity = form.getValues("quantity") || 1;
    const unitPrice = parseFloat(item.unitPrice);
    const totalMaterialCost = unitPrice * quantity;
    form.setValue("materialCost", totalMaterialCost);
    if (item.unit) {
      form.setValue("unit", item.unit);
    }
    toast({
      title: "Catalog price applied",
      description: `${item.itemName} from ${item.vendorName} - $${unitPrice.toFixed(2)}/${item.unit}`
    });
  };
  
  // Reset form and scope selection when dialog closes
  const handleDialogClose = (open: boolean) => {
    setAddLineItemOpen(open);
    if (!open) {
      form.reset();
      setSelectedScopeData(null);
      setMaterialCalcData(getDefaultMaterialCalculatorData());
      setSelectedCatalogCategory("");
    }
  };

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
        subcontractorQuoteId: values.subcontractorQuoteId || undefined,
        overheadAllocation: values.overheadAllocation,
        profitAllocation: values.profitAllocation,
        notes: values.notes || undefined,
        scopeWorkTypeId: values.scopeWorkTypeId || undefined,
        // Material calculator fields
        concreteDepthInches: materialCalcData.concreteDepthInches || undefined,
        dimensionWidthInches: materialCalcData.dimensionWidthInches || undefined,
        dimensionHeightInches: materialCalcData.dimensionHeightInches || undefined,
        concreteWasteFactor: materialCalcData.concreteWasteFactor || "10",
        calculatedConcreteYards: materialCalcData.calculatedConcreteYards || undefined,
        requiresStoneBase: materialCalcData.requiresStoneBase || false,
        stoneType: materialCalcData.requiresStoneBase ? (materialCalcData.stoneType || "CRUSHED_STONE") : undefined,
        stoneDepthInches: materialCalcData.requiresStoneBase ? (materialCalcData.stoneDepthInches || undefined) : undefined,
        stoneWasteFactor: materialCalcData.requiresStoneBase ? (materialCalcData.stoneWasteFactor || "10") : undefined,
        calculatedStoneTons: materialCalcData.requiresStoneBase ? (materialCalcData.calculatedStoneTons || undefined) : undefined,
        // Excavation fields
        requiresExcavation: materialCalcData.requiresExcavation || false,
        excavationDepthInches: materialCalcData.requiresExcavation ? (materialCalcData.excavationDepthInches || undefined) : undefined,
        excavationWidthInches: materialCalcData.requiresExcavation ? (materialCalcData.excavationWidthInches || undefined) : undefined,
        excavationSwellFactor: materialCalcData.requiresExcavation ? (materialCalcData.excavationSwellFactor || "25") : undefined,
        calculatedExcavationYards: materialCalcData.requiresExcavation ? (materialCalcData.calculatedExcavationYards || undefined) : undefined,
        // Wire mesh fields
        requiresWireMesh: materialCalcData.requiresWireMesh || false,
        wireMeshType: materialCalcData.requiresWireMesh ? (materialCalcData.wireMeshType || "6x6_W1.4") : undefined,
        wireMeshWasteFactor: materialCalcData.requiresWireMesh ? (materialCalcData.wireMeshWasteFactor || "10") : undefined,
        calculatedWireMeshRolls: materialCalcData.requiresWireMesh ? (materialCalcData.calculatedWireMeshRolls || undefined) : undefined,
        // Rebar fields
        requiresRebar: materialCalcData.requiresRebar || false,
        rebarSize: materialCalcData.requiresRebar ? (materialCalcData.rebarSize || "#4") : undefined,
        rebarSpacingInches: materialCalcData.requiresRebar ? (materialCalcData.rebarSpacingInches || "12") : undefined,
        rebarWasteFactor: materialCalcData.requiresRebar ? (materialCalcData.rebarWasteFactor || "10") : undefined,
        calculatedRebarCount: materialCalcData.requiresRebar ? (materialCalcData.calculatedRebarCount || undefined) : undefined,
        calculatedRebarLinearFeet: materialCalcData.requiresRebar ? (materialCalcData.calculatedRebarLinearFeet || undefined) : undefined,
        // Dowel fields
        requiresDowels: materialCalcData.requiresDowels || false,
        dowelSpacingInches: materialCalcData.requiresDowels ? (materialCalcData.dowelSpacingInches || "12") : undefined,
        jointLengthFeet: materialCalcData.requiresDowels ? (materialCalcData.jointLengthFeet || undefined) : undefined,
        calculatedDowelCount: materialCalcData.requiresDowels ? (materialCalcData.calculatedDowelCount || undefined) : undefined,
        // Sealer fields
        requiresSealer: materialCalcData.requiresSealer || false,
        sealerType: materialCalcData.requiresSealer ? (materialCalcData.sealerType || "CURE_SEAL") : undefined,
        sealerCoats: materialCalcData.requiresSealer ? (materialCalcData.sealerCoats || "1") : undefined,
        sealerWasteFactor: materialCalcData.requiresSealer ? (materialCalcData.sealerWasteFactor || "10") : undefined,
        calculatedSealerGallons: materialCalcData.requiresSealer ? (materialCalcData.calculatedSealerGallons || undefined) : undefined,
        // Underlayment fields
        requiresUnderlayment: materialCalcData.requiresUnderlayment || false,
        underlaymentType: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentType || "6MIL_POLY") : undefined,
        underlaymentOverlapInches: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentOverlapInches || "6") : undefined,
        underlaymentWasteFactor: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentWasteFactor || "10") : undefined,
        calculatedUnderlaymentSF: materialCalcData.requiresUnderlayment ? (materialCalcData.calculatedUnderlaymentSF || undefined) : undefined,
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
        subcontractorQuoteId: values.subcontractorQuoteId || undefined,
        overheadAllocation: String(values.overheadAllocation),
        profitAllocation: String(values.profitAllocation),
        source: "MANUAL",
        notes: values.notes || undefined,
        scopeWorkTypeId: values.scopeWorkTypeId || undefined,
        workTypeCode: selectedScopeData?.workTypeCode || undefined,
        // Material calculator fields
        concreteDepthInches: materialCalcData.concreteDepthInches || undefined,
        dimensionWidthInches: materialCalcData.dimensionWidthInches || undefined,
        dimensionHeightInches: materialCalcData.dimensionHeightInches || undefined,
        concreteWasteFactor: materialCalcData.concreteWasteFactor || "10",
        calculatedConcreteYards: materialCalcData.calculatedConcreteYards || undefined,
        requiresStoneBase: materialCalcData.requiresStoneBase || false,
        stoneType: materialCalcData.requiresStoneBase ? (materialCalcData.stoneType || "CRUSHED_STONE") : undefined,
        stoneDepthInches: materialCalcData.requiresStoneBase ? (materialCalcData.stoneDepthInches || undefined) : undefined,
        stoneWasteFactor: materialCalcData.requiresStoneBase ? (materialCalcData.stoneWasteFactor || "10") : undefined,
        calculatedStoneTons: materialCalcData.requiresStoneBase ? (materialCalcData.calculatedStoneTons || undefined) : undefined,
        // Excavation fields
        requiresExcavation: materialCalcData.requiresExcavation || false,
        excavationDepthInches: materialCalcData.requiresExcavation ? (materialCalcData.excavationDepthInches || undefined) : undefined,
        excavationWidthInches: materialCalcData.requiresExcavation ? (materialCalcData.excavationWidthInches || undefined) : undefined,
        excavationSwellFactor: materialCalcData.requiresExcavation ? (materialCalcData.excavationSwellFactor || "25") : undefined,
        calculatedExcavationYards: materialCalcData.requiresExcavation ? (materialCalcData.calculatedExcavationYards || undefined) : undefined,
        // Wire mesh fields
        requiresWireMesh: materialCalcData.requiresWireMesh || false,
        wireMeshType: materialCalcData.requiresWireMesh ? (materialCalcData.wireMeshType || "6x6_W1.4") : undefined,
        wireMeshWasteFactor: materialCalcData.requiresWireMesh ? (materialCalcData.wireMeshWasteFactor || "10") : undefined,
        calculatedWireMeshRolls: materialCalcData.requiresWireMesh ? (materialCalcData.calculatedWireMeshRolls || undefined) : undefined,
        // Rebar fields
        requiresRebar: materialCalcData.requiresRebar || false,
        rebarSize: materialCalcData.requiresRebar ? (materialCalcData.rebarSize || "#4") : undefined,
        rebarSpacingInches: materialCalcData.requiresRebar ? (materialCalcData.rebarSpacingInches || "12") : undefined,
        rebarWasteFactor: materialCalcData.requiresRebar ? (materialCalcData.rebarWasteFactor || "10") : undefined,
        calculatedRebarCount: materialCalcData.requiresRebar ? (materialCalcData.calculatedRebarCount || undefined) : undefined,
        calculatedRebarLinearFeet: materialCalcData.requiresRebar ? (materialCalcData.calculatedRebarLinearFeet || undefined) : undefined,
        // Dowel fields
        requiresDowels: materialCalcData.requiresDowels || false,
        dowelSpacingInches: materialCalcData.requiresDowels ? (materialCalcData.dowelSpacingInches || "12") : undefined,
        jointLengthFeet: materialCalcData.requiresDowels ? (materialCalcData.jointLengthFeet || undefined) : undefined,
        calculatedDowelCount: materialCalcData.requiresDowels ? (materialCalcData.calculatedDowelCount || undefined) : undefined,
        // Sealer fields
        requiresSealer: materialCalcData.requiresSealer || false,
        sealerType: materialCalcData.requiresSealer ? (materialCalcData.sealerType || "CURE_SEAL") : undefined,
        sealerCoats: materialCalcData.requiresSealer ? (materialCalcData.sealerCoats || "1") : undefined,
        sealerWasteFactor: materialCalcData.requiresSealer ? (materialCalcData.sealerWasteFactor || "10") : undefined,
        calculatedSealerGallons: materialCalcData.requiresSealer ? (materialCalcData.calculatedSealerGallons || undefined) : undefined,
        // Underlayment fields
        requiresUnderlayment: materialCalcData.requiresUnderlayment || false,
        underlaymentType: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentType || "6MIL_POLY") : undefined,
        underlaymentOverlapInches: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentOverlapInches || "6") : undefined,
        underlaymentWasteFactor: materialCalcData.requiresUnderlayment ? (materialCalcData.underlaymentWasteFactor || "10") : undefined,
        calculatedUnderlaymentSF: materialCalcData.requiresUnderlayment ? (materialCalcData.calculatedUnderlaymentSF || undefined) : undefined,
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
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!bid || !estimate) {
    return (
      <div className="min-h-screen bg-background">
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

        {/* Material Quantities Summary - Job Totals */}
        <MaterialJobTotals lineItems={estimate.lineItems} />

        {estimate.lineItems.length > 0 && (
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

        {hasEstimateAccess && (
          <div className="flex gap-3">
            <Dialog open={addLineItemOpen} onOpenChange={handleDialogClose}>
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
                    {/* Standardized SOW Selector */}
                    <div className="border rounded-md p-4 bg-muted/30">
                      <div className="flex items-center gap-2 mb-3">
                        <Layers className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Standardized Scope of Work</span>
                        <span className="text-xs text-muted-foreground ml-auto">Recommended for tracking</span>
                      </div>
                      <StandardizedScopeSelector
                        value={selectedScopeData || undefined}
                        onChange={handleScopeSelect}
                        showDimensionInputs={false}
                      />
                      {selectedScopeData && (
                        <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-900">
                          <p className="text-xs text-green-700 dark:text-green-400">
                            SOW selected: Description, unit, and category have been auto-filled. You can still customize them below.
                          </p>
                        </div>
                      )}
                    </div>
                    
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
                            <Select onValueChange={handleCategoryChange} value={field.value}>
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
                              <UomSelect
                                value={field.value}
                                onChange={field.onChange}
                                placeholder="Select unit"
                                data-testid="select-unit"
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

                      {/* Catalog Price Suggestions */}
                      {catalogPrices.length > 0 && (
                        <div className="col-span-2 p-3 bg-muted/50 rounded-md border">
                          <div className="flex items-center gap-2 mb-2">
                            <Store className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">Catalog Pricing Available</span>
                            <Badge variant="secondary" className="text-xs">{catalogPrices.length} items</Badge>
                          </div>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {catalogPrices.slice(0, 5).map((item) => (
                              <div 
                                key={item.id}
                                className="flex items-center justify-between p-2 bg-background rounded border hover-elevate cursor-pointer"
                                onClick={() => applyCatalogPrice(item)}
                                data-testid={`catalog-price-${item.id}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{item.itemName}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {item.vendorName} | {item.effectiveQuarter}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                                    ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                                  </Badge>
                                  <Tag className="h-3 w-3 text-muted-foreground" />
                                </div>
                              </div>
                            ))}
                          </div>
                          {catalogPrices.length > 5 && (
                            <p className="text-xs text-muted-foreground mt-2 text-center">
                              +{catalogPrices.length - 5} more items available
                            </p>
                          )}
                        </div>
                      )}

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

                      {/* Subcontractor Quote Selector - shows when subcontract cost > 0 */}
                      {form.watch("subcontractCost") > 0 && subcontractorQuotes.length > 0 && (
                        <FormField
                          control={form.control}
                          name="subcontractorQuoteId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Assign to Subcontractor</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value || ""}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-subcontractor-quote">
                                    <SelectValue placeholder="Select subcontractor..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  {subcontractorQuotes.map((quote) => (
                                    <SelectItem key={quote.id} value={quote.id}>
                                      {quote.subcontractorName} - ${Number(quote.quoteAmount).toLocaleString()}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

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

                    {/* Material Calculator - show for concrete, excavation, and related work */}
                    {(() => {
                      const watchedValues = form.watch();
                      const unit = watchedValues.unit;
                      const quantity = Number(watchedValues.quantity) || 0;
                      const category = watchedValues.category;
                      const description = watchedValues.description || "";
                      
                      // Show for SF or LF units with concrete, excavation, or site work categories
                      const materialCategories = [
                        "CONCRETE", "FLATWORK", "FOUNDATION", "PATIO", "DRIVEWAY", "SIDEWALK", "CURB",
                        "EXCAVATION", "GRADING", "SITE_WORK", "UTILITY", "TRENCH", "EARTHWORK"
                      ];
                      const showMaterialCalc = (unit === "SF" || unit === "LF") && 
                        materialCategories.includes(category || "");
                      
                      return showMaterialCalc ? (
                        <MaterialCalculator
                          unit={unit}
                          quantity={quantity}
                          description={description}
                          value={materialCalcData}
                          onChange={setMaterialCalcData}
                        />
                      ) : null;
                    })()}

                    {/* Cost Per Unit Preview */}
                    {(() => {
                      const watchedValues = form.watch();
                      const quantity = Number(watchedValues.quantity) || 0;
                      const unit = watchedValues.unit || "UNIT";
                      const directCost = (Number(watchedValues.materialCost) || 0) + 
                                        (Number(watchedValues.laborCost) || 0) + 
                                        (Number(watchedValues.equipmentCost) || 0) + 
                                        (Number(watchedValues.consumablesCost) || 0) +
                                        (Number(watchedValues.subcontractCost) || 0);
                      
                      const costPerUnit = quantity > 0 ? directCost / quantity : 0;
                      const overheadPerUnit = costPerUnit * (overheadPercent / 100);
                      const costWithOverhead = costPerUnit + overheadPerUnit;
                      const profitPerUnit = costWithOverhead * (profitMarginPercent / 100);
                      const bidPricePerUnit = costWithOverhead + profitPerUnit;
                      const totalMarkupPercent = costPerUnit > 0 ? ((bidPricePerUnit / costPerUnit) - 1) * 100 : 0;
                      const totalOverhead = directCost * (overheadPercent / 100);
                      const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
                      
                      return quantity > 0 ? (
                        <Card className="border-primary/20 bg-primary/5">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Calculator className="h-4 w-4" />
                              Cost Per {unit} Breakdown
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Auto-calculated based on quantity and What-If Calculator settings
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="grid grid-cols-4 gap-3">
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">Your Cost</p>
                                <p className="text-lg font-semibold" data-testid="text-cost-per-unit">
                                  ${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">+ Overhead ({overheadPercent}%)</p>
                                <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid="text-overhead-per-unit">
                                  +${overheadPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">+ Profit ({profitMarginPercent}%)</p>
                                <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid="text-profit-per-unit">
                                  +${profitPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
                                <p className="text-xs text-muted-foreground mb-1">Bid Price</p>
                                <p className="text-lg font-bold text-primary" data-testid="text-bid-price-per-unit">
                                  ${bidPricePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                            </div>
                            {/* Line Item Totals */}
                            <div className="mt-3 pt-3 border-t">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-800">
                                  <p className="text-xs text-muted-foreground mb-1">Total Overhead</p>
                                  <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-total-overhead">
                                    ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
                                  <p className="text-xs text-muted-foreground mb-1">Total Profit</p>
                                  <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-total-profit">
                                    ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                                <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
                                  <p className="text-xs text-muted-foreground mb-1">Total Bid Price</p>
                                  <p className="text-xl font-bold text-primary" data-testid="text-total-bid-price">
                                    ${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t flex justify-between items-center text-xs text-muted-foreground">
                              <span>
                                {quantity.toLocaleString()} {unit} x ${bidPricePerUnit.toFixed(2)} = <span className="font-semibold text-foreground">${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> total bid
                              </span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                {totalMarkupPercent.toFixed(1)}% total markup
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ) : null;
                    })()}

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
                setMaterialCalcData(getDefaultMaterialCalculatorData());
                setSelectedCatalogCategory("");
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
                            <Select onValueChange={handleCategoryChange} value={field.value}>
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

                      {/* Catalog Price Suggestions (Edit Dialog) */}
                      {catalogPrices.length > 0 && (
                        <div className="col-span-2 p-3 bg-muted/50 rounded-md border">
                          <div className="flex items-center gap-2 mb-2">
                            <Store className="h-4 w-4 text-primary" />
                            <span className="text-sm font-medium">Catalog Pricing Available</span>
                            <Badge variant="secondary" className="text-xs">{catalogPrices.length} items</Badge>
                          </div>
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {catalogPrices.slice(0, 5).map((item) => (
                              <div 
                                key={item.id}
                                className="flex items-center justify-between p-2 bg-background rounded border hover-elevate cursor-pointer"
                                onClick={() => applyCatalogPrice(item)}
                                data-testid={`edit-catalog-price-${item.id}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{item.itemName}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {item.vendorName} | {item.effectiveQuarter}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                                    ${parseFloat(item.unitPrice).toFixed(2)}/{item.unit}
                                  </Badge>
                                  <Tag className="h-3 w-3 text-muted-foreground" />
                                </div>
                              </div>
                            ))}
                          </div>
                          {catalogPrices.length > 5 && (
                            <p className="text-xs text-muted-foreground mt-2 text-center">
                              +{catalogPrices.length - 5} more items available
                            </p>
                          )}
                        </div>
                      )}

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

                      {/* Subcontractor Quote Selector - shows when subcontract cost > 0 */}
                      {form.watch("subcontractCost") > 0 && subcontractorQuotes.length > 0 && (
                        <FormField
                          control={form.control}
                          name="subcontractorQuoteId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Assign to Subcontractor</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                value={field.value || ""}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-edit-subcontractor-quote">
                                    <SelectValue placeholder="Select subcontractor..." />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  {subcontractorQuotes.map((quote) => (
                                    <SelectItem key={quote.id} value={quote.id}>
                                      {quote.subcontractorName} - ${Number(quote.quoteAmount).toLocaleString()}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

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

                    {/* Material Calculator for Edit Dialog */}
                    {(() => {
                      const watchedValues = form.watch();
                      const unit = watchedValues.unit || "";
                      const quantity = Number(watchedValues.quantity) || 0;
                      const category = watchedValues.category || "";
                      const description = watchedValues.description || "";
                      
                      const materialCategories = [
                        "CONCRETE", "FLATWORK", "FOUNDATION", "PATIO", "DRIVEWAY", "SIDEWALK", "CURB",
                        "EXCAVATION", "GRADING", "SITE_WORK", "UTILITY", "TRENCH", "EARTHWORK"
                      ];
                      const showMaterialCalc = (unit === "SF" || unit === "LF") && 
                        materialCategories.includes(category || "");
                      
                      return showMaterialCalc ? (
                        <MaterialCalculator
                          unit={unit}
                          quantity={quantity}
                          description={description}
                          value={materialCalcData}
                          onChange={setMaterialCalcData}
                        />
                      ) : null;
                    })()}

                    {/* Cost Per Unit Preview */}
                    {(() => {
                      const watchedValues = form.watch();
                      const quantity = Number(watchedValues.quantity) || 0;
                      const unit = watchedValues.unit || "UNIT";
                      const directCost = (Number(watchedValues.materialCost) || 0) + 
                                        (Number(watchedValues.laborCost) || 0) + 
                                        (Number(watchedValues.equipmentCost) || 0) + 
                                        (Number(watchedValues.consumablesCost) || 0) +
                                        (Number(watchedValues.subcontractCost) || 0);
                      
                      const costPerUnit = quantity > 0 ? directCost / quantity : 0;
                      const overheadPerUnit = costPerUnit * (overheadPercent / 100);
                      const costWithOverhead = costPerUnit + overheadPerUnit;
                      const profitPerUnit = costWithOverhead * (profitMarginPercent / 100);
                      const bidPricePerUnit = costWithOverhead + profitPerUnit;
                      const totalMarkupPercent = costPerUnit > 0 ? ((bidPricePerUnit / costPerUnit) - 1) * 100 : 0;
                      const totalOverhead = directCost * (overheadPercent / 100);
                      const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
                      
                      return quantity > 0 ? (
                        <Card className="border-primary/20 bg-primary/5">
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Calculator className="h-4 w-4" />
                              Cost Per {unit} Breakdown
                            </CardTitle>
                            <CardDescription className="text-xs">
                              Auto-calculated based on quantity and What-If Calculator settings
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="grid grid-cols-4 gap-3">
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">Your Cost</p>
                                <p className="text-lg font-semibold" data-testid="text-edit-cost-per-unit">
                                  ${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">+ Overhead ({overheadPercent}%)</p>
                                <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid="text-edit-overhead-per-unit">
                                  +${overheadPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-background rounded-md border">
                                <p className="text-xs text-muted-foreground mb-1">+ Profit ({profitMarginPercent}%)</p>
                                <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid="text-edit-profit-per-unit">
                                  +${profitPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                              <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
                                <p className="text-xs text-muted-foreground mb-1">Bid Price</p>
                                <p className="text-lg font-bold text-primary" data-testid="text-edit-bid-price-per-unit">
                                  ${bidPricePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs text-muted-foreground">per {unit}</p>
                              </div>
                            </div>
                            {/* Line Item Totals */}
                            <div className="mt-3 pt-3 border-t">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-800">
                                  <p className="text-xs text-muted-foreground mb-1">Total Overhead</p>
                                  <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-edit-total-overhead">
                                    ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
                                  <p className="text-xs text-muted-foreground mb-1">Total Profit</p>
                                  <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-edit-total-profit">
                                    ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                                <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
                                  <p className="text-xs text-muted-foreground mb-1">Total Bid Price</p>
                                  <p className="text-xl font-bold text-primary" data-testid="text-edit-total-bid-price">
                                    ${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t flex justify-between items-center text-xs text-muted-foreground">
                              <span>
                                {quantity.toLocaleString()} {unit} x ${bidPricePerUnit.toFixed(2)} = <span className="font-semibold text-foreground">${(quantity * bidPricePerUnit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> total bid
                              </span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                {totalMarkupPercent.toFixed(1)}% total markup
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      ) : null;
                    })()}

                    <div className="flex justify-end gap-3">
                      <Button type="button" variant="outline" onClick={() => {
                        setEditLineItemOpen(false);
                        setEditingLineItem(null);
                        form.reset();
                        setMaterialCalcData(getDefaultMaterialCalculatorData());
                        setSelectedCatalogCategory("");
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
              <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                <Table className="min-w-[1000px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Description</TableHead>
                      <TableHead className="whitespace-nowrap">Category</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Material</TableHead>
                      <TableHead className="text-right">Labor</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Equipment</TableHead>
                      <TableHead className="text-right">Subcontract</TableHead>
                      <TableHead className="text-right">Direct Cost</TableHead>
                      <TableHead className="text-right text-orange-600 dark:text-orange-400">Overhead ({overheadPercent}%)</TableHead>
                      <TableHead className="text-right text-green-600 dark:text-green-400">Profit ({profitMarginPercent}%)</TableHead>
                      <TableHead className="text-right">Bid Total</TableHead>
                      {hasEstimateAccess && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estimate.lineItems.map((item) => {
                      const directCost = Number(item.materialCost) + Number(item.laborCost) + Number(item.equipmentCost) + Number(item.consumablesCost || 0) + Number(item.subcontractCost || 0);
                      const totalOverhead = directCost * (overheadPercent / 100);
                      const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
                      const bidTotal = directCost + totalOverhead + totalProfit;
                      
                      return (
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
                          ${directCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-orange-600 dark:text-orange-400">
                          ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right text-green-600 dark:text-green-400">
                          ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          ${bidTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        {hasEstimateAccess && (
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
                                    subcontractorQuoteId: (item as any).subcontractorQuoteId || undefined,
                                    overheadAllocation: 0,
                                    profitAllocation: 0,
                                    notes: (item as any).metadata || "",
                                  });
                                  // Load material calc data from line item
                                  const lineItemAny = item as any;
                                  setMaterialCalcData({
                                    concreteDepthInches: lineItemAny.concreteDepthInches || "",
                                    dimensionWidthInches: lineItemAny.dimensionWidthInches || "",
                                    dimensionHeightInches: lineItemAny.dimensionHeightInches || "",
                                    concreteWasteFactor: lineItemAny.concreteWasteFactor || "10",
                                    calculatedConcreteYards: lineItemAny.calculatedConcreteYards || "",
                                    requiresStoneBase: lineItemAny.requiresStoneBase || false,
                                    stoneType: lineItemAny.stoneType || "CRUSHED_STONE",
                                    stoneDepthInches: lineItemAny.stoneDepthInches || "",
                                    stoneWasteFactor: lineItemAny.stoneWasteFactor || "10",
                                    calculatedStoneTons: lineItemAny.calculatedStoneTons || "",
                                    requiresExcavation: lineItemAny.requiresExcavation || false,
                                    excavationDepthInches: lineItemAny.excavationDepthInches || "",
                                    excavationWidthInches: lineItemAny.excavationWidthInches || "",
                                    excavationSwellFactor: lineItemAny.excavationSwellFactor || "25",
                                    calculatedExcavationYards: lineItemAny.calculatedExcavationYards || "",
                                    requiresWireMesh: lineItemAny.requiresWireMesh || false,
                                    wireMeshType: lineItemAny.wireMeshType || "6x6_W1.4",
                                    wireMeshWasteFactor: lineItemAny.wireMeshWasteFactor || "10",
                                    calculatedWireMeshRolls: lineItemAny.calculatedWireMeshRolls || "0",
                                    requiresRebar: lineItemAny.requiresRebar || false,
                                    rebarSize: lineItemAny.rebarSize || "#4",
                                    rebarSpacingInches: lineItemAny.rebarSpacingInches || "12",
                                    rebarWasteFactor: lineItemAny.rebarWasteFactor || "10",
                                    calculatedRebarCount: lineItemAny.calculatedRebarCount || "0",
                                    calculatedRebarLinearFeet: lineItemAny.calculatedRebarLinearFeet || "0",
                                    requiresDowels: lineItemAny.requiresDowels || false,
                                    dowelSpacingInches: lineItemAny.dowelSpacingInches || "12",
                                    jointLengthFeet: lineItemAny.jointLengthFeet || "",
                                    calculatedDowelCount: lineItemAny.calculatedDowelCount || "0",
                                    requiresSealer: lineItemAny.requiresSealer || false,
                                    sealerType: lineItemAny.sealerType || "CURE_SEAL",
                                    sealerCoats: lineItemAny.sealerCoats || "1",
                                    sealerWasteFactor: lineItemAny.sealerWasteFactor || "10",
                                    calculatedSealerGallons: lineItemAny.calculatedSealerGallons || "0",
                                    requiresUnderlayment: lineItemAny.requiresUnderlayment || false,
                                    underlaymentType: lineItemAny.underlaymentType || "6MIL_POLY",
                                    underlaymentOverlapInches: lineItemAny.underlaymentOverlapInches || "6",
                                    underlaymentWasteFactor: lineItemAny.underlaymentWasteFactor || "10",
                                    calculatedUnderlaymentSF: lineItemAny.calculatedUnderlaymentSF || "0",
                                  });
                                  setSelectedCatalogCategory(item.category);
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
                      );
                    })}
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
