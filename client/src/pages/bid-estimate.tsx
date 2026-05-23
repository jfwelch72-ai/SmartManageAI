import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useState, useCallback, useEffect, useRef } from "react";
import { useBid } from "@/hooks/use-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, CheckCircle, AlertTriangle, Layers, RefreshCw, TrendingUp, History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, bidEstimateKey } from "@/lib/queryClient";
import {
  getDefaultMaterialCalculatorData,
  type MaterialCalculatorData,
} from "@/components/MaterialCalculator";
import { MaterialJobTotals } from "@/components/MaterialCalculator";
import { EstimatePdfExportButton } from "@/components/EstimatePdfExportButton";
import { EstimatePhaseCExports } from "@/components/EstimatePhaseCExports";
import { EstimateExcelExportButton } from "@/components/EstimateExcelExportButton";
import AiEstimatorChatPanel from "@/components/AiEstimatorChatPanel";
import { AiEstimatorIntroCallout } from "@/components/AiEstimatorIntroCallout";
import { GenerateDraftEstimateButton } from "@/components/estimate/GenerateDraftEstimateButton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  Estimate,
  EstimateLineItem,
  BidSubcontractorQuote,
} from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { canEditBids } from "@/lib/rbac";
import type { ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import type { LineItemSelectionData } from "@/components/HierarchicalLineItemBuilder";

import {
  lineItemSchema,
  type LineItemFormValues,
  type CatalogPriceItem,
  type WorkCategory,
  buildMaterialCalculatorPayload,
  normalizeUnit,
  detectMaterialTypeFromName,
  LINE_ITEM_DEFAULT_VALUES,
} from "@/lib/estimate-utils";
import { EstimateSummaryCards } from "@/components/estimate/EstimateSummaryCards";
import { MarkupCalculatorCard } from "@/components/estimate/MarkupCalculator";
import { EstimateFactorsOverrideDrawer } from "@/components/estimate/EstimateFactorsOverrideDrawer";
import { OrgMarkupBreakdownCard } from "@/components/estimate/OrgMarkupBreakdownCard";
import { LineItemFormDialog } from "@/components/estimate/LineItemForm";
import { LineItemsTable } from "@/components/estimate/LineItemsTable";
import { AssemblyInsertDialog } from "@/components/estimate/AssemblyInsertDialog";
import { BidTabImportDialog } from "@/components/estimate/BidTabImportDialog";

export default function BidEstimate() {
  const [, params] = useRoute("/bids/:code/estimate");
  const [, setLocation] = useLocation();
  const bidCode = params?.code || "";
  const { data: bid, isLoading: bidLoading } = useBid(bidCode);
  const bidId = bid?.id;
  const { user } = useAuth();
  const hasEstimateAccess = canEditBids(user?.role);

  const { toast } = useToast();
  // Incremented on every successful line-item add/edit/delete so the chat
  // panel can surface an "Estimate updated" notice to the user.
  const [lineItemsMutationCount, setLineItemsMutationCount] = useState(0);
  // Incremented when takeoff measurements for this bid are updated so the
  // chat panel can surface the same "Estimate updated" notice.
  const [measurementsMutationCount, setMeasurementsMutationCount] = useState(0);
  // Tracks the last-seen serialised measurements payload so passive refetches
  // that return identical data do not trigger the "Estimate updated" banner.
  const prevMeasurementsDataRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bidId) return;
    const allMeasurementsQueryKey = `/api/bids/${bidId}/takeoff/all-measurements`;
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === "updated" &&
        // Only fire when a fetch resolved successfully — not on fetch-start,
        // invalidation, option changes, or other state transitions.
        (event as { type: string; action?: { type: string } }).action?.type === "success" &&
        Array.isArray(event.query.queryKey) &&
        event.query.queryKey[0] === allMeasurementsQueryKey
      ) {
        const serialised = JSON.stringify(event.query.state.data);
        if (
          prevMeasurementsDataRef.current !== null &&
          serialised !== prevMeasurementsDataRef.current
        ) {
          setMeasurementsMutationCount((c) => c + 1);
        }
        prevMeasurementsDataRef.current = serialised;
      }
    });
  }, [bidId]);

  const [addLineItemOpen, setAddLineItemOpen] = useState(false);
  const [assemblyInsertOpen, setAssemblyInsertOpen] = useState(false);
  const [editLineItemOpen, setEditLineItemOpen] = useState(false);
  const [equipmentSelectorKey, setEquipmentSelectorKey] = useState(0);
  const [editingLineItem, setEditingLineItem] =
    useState<EstimateLineItem | null>(null);
  const [overheadPercent, setOverheadPercent] = useState<number>(10);
  const [profitMarginPercent, setProfitMarginPercent] = useState<number>(15);
  const [selectedScopeData, setSelectedScopeData] =
    useState<ScopeSelectionData | null>(null);
  const [hierarchicalSelection, setHierarchicalSelection] =
    useState<LineItemSelectionData | null>(null);
  const [hierarchicalQuantity, setHierarchicalQuantity] = useState<number>(0);
  const [hierarchicalUnit, setHierarchicalUnit] = useState<string>("");
  const [materialCalcData, setMaterialCalcData] =
    useState<MaterialCalculatorData>(getDefaultMaterialCalculatorData());
  const [selectedCatalogCategory, setSelectedCatalogCategory] =
    useState<string>("");
  const [useHierarchicalBuilder, setUseHierarchicalBuilder] =
    useState<boolean>(true);
  const [editHadAssignments, setEditHadAssignments] = useState(false);
  const [catalogPricedMaterials, setCatalogPricedMaterials] = useState<
    Set<string>
  >(new Set());

  const { data: estimateData, isLoading: estimateLoading } = useQuery<{
    estimate:
      | (Estimate & { lineItems: EstimateLineItem[]; totals: any })
      | null;
  }>({
    queryKey: bidEstimateKey(bidId),
    enabled: !!bidId,
  });

  const estimate = estimateData?.estimate || null;

  // Task #3038 — local state to hold benchmark data from a refresh call
  // (supersedes whatever is on the estimate row for the current session).
  const [localBenchmarkSummary, setLocalBenchmarkSummary] = useState<string | null>(null);
  const [localOverallConfidence, setLocalOverallConfidence] = useState<string | null>(null);
  // Task #3046 — benchmark history drawer
  const [benchmarkHistoryOpen, setBenchmarkHistoryOpen] = useState(false);

  const benchmarkSummary = localBenchmarkSummary ?? (estimate as any)?.aiDraftBenchmarkSummary ?? null;
  const overallConfidence = localOverallConfidence ?? (estimate as any)?.aiDraftOverallConfidence ?? null;

  const refreshBenchmarksMutation = useMutation({
    mutationFn: async () => {
      if (!bid?.id) throw new Error("No bid");
      const r = await apiRequest("POST", `/api/ai-estimator/estimate/${bid.id}/refresh-benchmarks`, {});
      return r.json() as Promise<{ benchmarkSummary: string; overallConfidence: string }>;
    },
    onSuccess: (data) => {
      setLocalBenchmarkSummary(data.benchmarkSummary);
      setLocalOverallConfidence(data.overallConfidence);
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      // Task #3046 — invalidate benchmark history so the drawer reflects the new entry
      if (estimate?.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/ai-estimator/estimate", estimate.id, "benchmark-history"] });
      }
      toast({ title: "Benchmarks refreshed", description: "Cost benchmark summary updated with current market data." });
    },
    onError: (err: Error) => {
      toast({ title: "Benchmark refresh failed", description: err.message, variant: "destructive" });
    },
  });

  // Task #3046 — fetch benchmark refresh history (lazy: only when the drawer is open)
  type BenchmarkHistoryRow = {
    id: string;
    benchmarkSummary: string;
    overallConfidence: string | null;
    createdAt: string;
    createdById: string;
    createdByName: string | null;
  };
  const { data: benchmarkHistoryData, isLoading: benchmarkHistoryLoading } = useQuery<{ history: BenchmarkHistoryRow[] }>({
    queryKey: ["/api/ai-estimator/estimate", estimate?.id, "benchmark-history"],
    enabled: benchmarkHistoryOpen && !!estimate?.id,
  });

  const { data: aiEstimatorStatus } = useQuery<{ enabled: boolean; canTrain: boolean; canManage: boolean; featureFlagOn: boolean; reason: string }>({
    queryKey: ["/api/ai-estimator/status"],
    staleTime: 60 * 1000,
  });

  const { data: subcontractorQuotes = [] } = useQuery<BidSubcontractorQuote[]>({
    queryKey: ["/api/bids", bidId, "subcontractor-quotes"],
    enabled: !!bidId,
  });

  const { data: workCategories = [] } = useQuery<WorkCategory[]>({
    queryKey: ["/api/organization/work-categories"],
    enabled: hasEstimateAccess,
    staleTime: 10 * 60 * 1000,
  });

  const { data: catalogPrices = [] } = useQuery<CatalogPriceItem[]>({
    queryKey: [
      `/api/vendor-pricing/search?category=${selectedCatalogCategory}`,
    ],
    enabled: !!selectedCatalogCategory && hasEstimateAccess,
    staleTime: 5 * 60 * 1000,
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

  const addLineItemMutation = useMutation({
    mutationFn: async (data: LineItemFormValues & { estimateId: string }) => {
      const response = await apiRequest(
        "POST",
        `/api/estimates/${data.estimateId}/line-items`,
        data,
      );
      return response.json();
    },
    onSuccess: async (newLineItem: { id: string }) => {
      const modSelections =
        hierarchicalSelection?.modifierSelections ||
        selectedScopeData?.modifierSelections ||
        [];
      if (modSelections.length > 0 && newLineItem?.id && bidId) {
        try {
          await apiRequest("POST", "/api/bid-modifier-selections", {
            bidId,
            lineItemId: newLineItem.id,
            selections: modSelections.map((s) => ({
              modifierId: s.modifierId,
              selectedFactor: s.selectedFactor,
            })),
          });
        } catch {
          toast({
            title: "Modifier selections could not be saved",
            description:
              "The line item was created, but its modifier selections failed to persist. You can re-apply them by editing the line item.",
            variant: "destructive",
          });
        }
      }
      setLineItemsMutationCount((c) => c + 1);
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      setAddLineItemOpen(false);
      form.reset();
      setEquipmentSelectorKey((prev) => prev + 1);
      setSelectedScopeData(null);
      setHierarchicalSelection(null);
      toast({ title: "Line item added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add line item", variant: "destructive" });
    },
  });

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

  const deleteLineItemMutation = useMutation({
    mutationFn: ({
      estimateId,
      lineItemId,
    }: {
      estimateId: string;
      lineItemId: string;
    }) =>
      apiRequest(
        "DELETE",
        `/api/estimates/${estimateId}/line-items/${lineItemId}`,
        {},
      ),
    onSuccess: () => {
      setLineItemsMutationCount((c) => c + 1);
      queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      toast({ title: "Line item deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete line item", variant: "destructive" });
    },
  });

  const editLineItemMutation = useMutation({
    mutationFn: ({
      estimateId,
      lineItemId,
      data,
    }: {
      estimateId: string;
      lineItemId: string;
      data: any;
    }) =>
      apiRequest(
        "PUT",
        `/api/estimates/${estimateId}/line-items/${lineItemId}`,
        data,
      ),
    onSuccess: () => {
      setLineItemsMutationCount((c) => c + 1);
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
    defaultValues: LINE_ITEM_DEFAULT_VALUES,
  });

  const handleScopeSelect = (data: ScopeSelectionData) => {
    setSelectedScopeData(data);
    form.setValue("description", data.canonicalName);
    form.setValue("unit", data.unit);
    form.setValue("scopeWorkTypeId", data.workTypeId);

    let matchedCategory = workCategories.find(
      (c) =>
        c.label.toLowerCase() === data.categoryName.toLowerCase() ||
        c.label.toLowerCase().includes(data.categoryName.toLowerCase()),
    );

    const defaultCategory = workCategories.find((c) => c.isDefault);
    const mappedCategory =
      matchedCategory?.value || defaultCategory?.value || "OTHER";

    form.setValue("category", mappedCategory);
    setSelectedCatalogCategory(mappedCategory);
  };

  const handleCategoryChange = (value: string) => {
    form.setValue("category", value);
    setSelectedCatalogCategory(value);
  };

  const applyCatalogPrice = (item: CatalogPriceItem) => {
    const scopeQuantity = form.getValues("quantity") || 1;
    const unitPrice = parseFloat(item.unitPrice);
    const normalizedItemUnit = normalizeUnit(item.unit || "");

    const nameBasedMaterialType = detectMaterialTypeFromName(item.itemName);

    let materialQuantity = scopeQuantity;
    let quantitySource = "scope";
    let materialType: string | null = null;

    if (nameBasedMaterialType) {
      const quantityMap: Record<string, { field: string; source: string }> = {
        concrete: {
          field: "calculatedConcreteYards",
          source: "calculated concrete",
        },
        excavation: {
          field: "calculatedExcavationYards",
          source: "calculated excavation",
        },
        stone: { field: "calculatedStoneTons", source: "calculated stone" },
        wireMesh: {
          field: "calculatedWireMeshRolls",
          source: "calculated wire mesh",
        },
        rebar: { field: "calculatedRebarCount", source: "calculated rebar" },
        dowels: { field: "calculatedDowelCount", source: "calculated dowels" },
        sealer: {
          field: "calculatedSealerGallons",
          source: "calculated sealer",
        },
        underlayment: {
          field: "calculatedUnderlaymentSF",
          source: "calculated underlayment",
        },
      };

      const mapping = quantityMap[nameBasedMaterialType];
      if (mapping) {
        const calcValue = parseFloat(
          (materialCalcData as any)[mapping.field] || "0",
        );
        if (calcValue > 0) {
          materialQuantity = calcValue;
          quantitySource = mapping.source;
          materialType = nameBasedMaterialType;
        }
      }
    }

    if (!materialType) {
      const unitToFieldMap: Record<
        string,
        {
          field: string;
          fallback?: string;
          source: string;
          fallbackSource?: string;
        }
      > = {
        CY: {
          field: "calculatedConcreteYards",
          fallback: "calculatedExcavationYards",
          source: "calculated concrete",
          fallbackSource: "calculated excavation",
        },
        TON: { field: "calculatedStoneTons", source: "calculated stone" },
        ROLL: {
          field: "calculatedWireMeshRolls",
          source: "calculated wire mesh",
        },
        EA: { field: "calculatedRebarCount", source: "calculated rebar" },
        LF: {
          field: "calculatedRebarLinearFeet",
          source: "calculated rebar LF",
        },
        GAL: { field: "calculatedSealerGallons", source: "calculated sealer" },
        DOWEL: { field: "calculatedDowelCount", source: "calculated dowels" },
        SF: {
          field: "calculatedUnderlaymentSF",
          source: "calculated underlayment",
        },
      };

      const mapping = unitToFieldMap[normalizedItemUnit];
      if (mapping) {
        const calcValue = parseFloat(
          (materialCalcData as any)[mapping.field] || "0",
        );
        if (calcValue > 0) {
          materialQuantity = calcValue;
          quantitySource = mapping.source;
          materialType = mapping.source.replace("calculated ", "");
        } else if (mapping.fallback) {
          const fallbackValue = parseFloat(
            (materialCalcData as any)[mapping.fallback] || "0",
          );
          if (fallbackValue > 0) {
            materialQuantity = fallbackValue;
            quantitySource = mapping.fallbackSource || mapping.source;
            materialType = (mapping.fallbackSource || mapping.source).replace(
              "calculated ",
              "",
            );
          }
        }
      }
    }

    const totalMaterialCost = unitPrice * materialQuantity;
    const currentMaterialCost = Number(form.getValues("materialCost")) || 0;
    form.setValue("materialCost", currentMaterialCost + totalMaterialCost);

    if (materialType) {
      setCatalogPricedMaterials((prev) => {
        const newSet = new Set(prev);
        newSet.add(materialType!);
        return newSet;
      });
    }

    const description =
      quantitySource === "scope"
        ? `${item.itemName} from ${item.vendorName} - $${unitPrice.toFixed(2)}/${item.unit} × ${materialQuantity.toFixed(2)} = $${totalMaterialCost.toFixed(2)}`
        : `${item.itemName} from ${item.vendorName} - $${unitPrice.toFixed(2)}/${item.unit} × ${materialQuantity.toFixed(2)} ${item.unit} (${quantitySource}) = $${totalMaterialCost.toFixed(2)}`;

    toast({ title: "Catalog price applied", description });
  };

  const handleAddDialogClose = (open: boolean) => {
    setAddLineItemOpen(open);
    if (!open) {
      form.reset();
      setEquipmentSelectorKey((prev) => prev + 1);
      setSelectedScopeData(null);
      setHierarchicalSelection(null);
      setHierarchicalQuantity(0);
      setHierarchicalUnit("");
      setMaterialCalcData(getDefaultMaterialCalculatorData());
      setSelectedCatalogCategory("");
      setCatalogPricedMaterials(new Set());
    }
  };

  const handleEditDialogClose = (open: boolean) => {
    setEditLineItemOpen(open);
    if (!open) {
      setEditingLineItem(null);
      form.reset();
      setEquipmentSelectorKey((prev) => prev + 1);
      setMaterialCalcData(getDefaultMaterialCalculatorData());
      setSelectedCatalogCategory("");
    }
  };

  const handleHierarchicalSelectionChange = (
    data: LineItemSelectionData | null,
  ) => {
    setHierarchicalSelection(data);
    if (data) {
      form.setValue("description", data.canonicalName);
      form.setValue("unit", data.unit);
      form.setValue("quantity", hierarchicalQuantity);
      form.setValue("scopeWorkTypeId", undefined);

      const matchedCategory = workCategories.find(
        (c) =>
          c.value === data.categoryCode ||
          c.value === data.tradeName.toUpperCase().replace(/ /g, "_"),
      );
      const defaultCategory =
        workCategories.find((c) => c.isDefault)?.value || "GENERAL";
      const mappedCategory = matchedCategory?.value || defaultCategory;
      form.setValue("category", mappedCategory);
      setSelectedCatalogCategory(mappedCategory);
    }
  };

  const onSubmit = (values: LineItemFormValues) => {
    if (!estimateData?.estimate) return;

    const materialCalcPayload =
      buildMaterialCalculatorPayload(materialCalcData);

    if (editingLineItem) {
      editLineItemMutation.mutate({
        estimateId: estimateData.estimate.id,
        lineItemId: editingLineItem.id,
        data: {
          category: values.category,
          description: values.description,
          unit: values.unit,
          quantity: values.quantity,
          materialCost: values.materialCost,
          laborCost: values.laborCost,
          laborHours: values.laborHours,
          jobClassificationId: values.jobClassificationId || null,
          laborRateUsed: values.laborRateUsed || null,
          equipmentCost: values.equipmentCost,
          consumablesCost: values.consumablesCost || 0,
          subcontractCost: values.subcontractCost || 0,
          subcontractorQuoteId: values.subcontractorQuoteId || undefined,
          ...((values.subcontractorAssignments &&
            values.subcontractorAssignments.length > 0) ||
          editHadAssignments
            ? {
                subcontractorAssignments: values.subcontractorAssignments || [],
              }
            : {}),
          overheadAllocation: values.overheadAllocation,
          profitAllocation: values.profitAllocation,
          notes: values.notes || undefined,
          scopeWorkTypeId: values.scopeWorkTypeId || undefined,
          dotPayItemId: values.dotPayItemId ?? null,
          dotSpecBookId: values.dotSpecBookId ?? null,
          payItemNumber: values.payItemNumber ?? null,
          specSection: values.specSection ?? null,
          ...materialCalcPayload,
        },
      });
    } else {
      addLineItemMutation.mutate({
        estimateId: estimateData.estimate.id,
        category: values.category,
        description: values.description,
        unit: values.unit,
        quantity: values.quantity,
        materialCost: values.materialCost,
        laborCost: values.laborCost,
        laborHours: values.laborHours,
        jobClassificationId: values.jobClassificationId || undefined,
        laborRateUsed: values.laborRateUsed || undefined,
        equipmentCost: values.equipmentCost,
        equipmentHours: values.equipmentHours || 0,
        consumablesCost: values.consumablesCost || 0,
        subcontractCost: values.subcontractCost || 0,
        subcontractorQuoteId: values.subcontractorQuoteId || undefined,
        ...(values.subcontractorAssignments &&
        values.subcontractorAssignments.length > 0
          ? { subcontractorAssignments: values.subcontractorAssignments }
          : {}),
        overheadAllocation: values.overheadAllocation,
        profitAllocation: values.profitAllocation,
        notes: values.notes || undefined,
        scopeWorkTypeId: values.scopeWorkTypeId || undefined,
        workTypeCode:
          selectedScopeData?.workTypeCode ||
          hierarchicalSelection?.workTypeCode ||
          undefined,
        organizationSowItemId:
          hierarchicalSelection?.organizationSowItemId || undefined,
        dotPayItemId: values.dotPayItemId ?? null,
        dotSpecBookId: values.dotSpecBookId ?? null,
        payItemNumber: values.payItemNumber ?? null,
        specSection: values.specSection ?? null,
        ...materialCalcPayload,
      });
    }
  };

  const handleEditLineItem = async (item: EstimateLineItem) => {
    setEditingLineItem(item);
    const lineItemAny = item as any;

    let subAssignments: Array<{
      subcontractorQuoteId: string;
      allocatedCost: number;
      isSelected: boolean;
      notes?: string;
    }> = [];
    if (estimateData?.estimate) {
      try {
        const res = await fetch(
          `/api/estimates/${estimateData.estimate.id}/line-items/${item.id}/subcontractors`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          subAssignments = (data || []).map((a: any) => ({
            subcontractorQuoteId: a.subcontractorQuoteId,
            allocatedCost: Number(a.allocatedCost || 0),
            isSelected: a.isSelected !== false,
            notes: a.notes || undefined,
          }));
        }
      } catch {
        /* use empty assignments */
      }
    }

    setEditHadAssignments(subAssignments.length > 0);

    form.reset({
      description: item.description,
      category: item.category,
      unit: item.unit,
      quantity: Number(item.quantity),
      materialCost: Number(item.materialCost),
      laborCost: Number(item.laborCost),
      laborHours: Number(item.laborHours),
      equipmentHours: Number(item.equipmentHours || 0),
      equipmentCost: Number(item.equipmentCost),
      equipmentSource: lineItemAny.equipmentSource || undefined,
      selectedEquipmentId: lineItemAny.selectedEquipmentId || undefined,
      equipmentRateUsed: lineItemAny.equipmentRateUsed
        ? Number(lineItemAny.equipmentRateUsed)
        : undefined,
      consumablesCost: Number(item.consumablesCost || 0),
      subcontractCost: Number(item.subcontractCost || 0),
      subcontractorQuoteId: lineItemAny.subcontractorQuoteId || undefined,
      subcontractorAssignments: subAssignments,
      overheadAllocation: 0,
      profitAllocation: 0,
      notes: lineItemAny.notes || "",
      photoUrl: lineItemAny.photoUrl || undefined,
      photoUrls: Array.isArray(lineItemAny.photoUrls) ? lineItemAny.photoUrls : [],
      dotPayItemId: item.dotPayItemId ?? null,
      dotSpecBookId: item.dotSpecBookId ?? null,
      payItemNumber: item.payItemNumber ?? null,
      specSection: item.specSection ?? null,
    });
    setMaterialCalcData({
      concreteDepthInches: lineItemAny.concreteDepthInches || "",
      dimensionWidthInches: lineItemAny.dimensionWidthInches || "",
      dimensionHeightInches: lineItemAny.dimensionHeightInches || "",
      concreteWasteFactor: lineItemAny.concreteWasteFactor || "10",
      calculatedConcreteYards: lineItemAny.calculatedConcreteYards || "",
      requiresStoneBase: lineItemAny.requiresStoneBase || false,
      stoneType: lineItemAny.stoneType || "CRUSHED_STONE",
      stoneSize: lineItemAny.stoneSize || "#57",
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
      rebarFabType: lineItemAny.rebarFabType || "FIELD_TIED",
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
      underlaymentType: lineItemAny.underlaymentType || "POLY_6MIL",
      underlaymentOverlapInches: lineItemAny.underlaymentOverlapInches || "6",
      underlaymentWasteFactor: lineItemAny.underlaymentWasteFactor || "10",
      calculatedUnderlaymentSF: lineItemAny.calculatedUnderlaymentSF || "0",
    });
    setSelectedCatalogCategory(item.category);
    setEditLineItemOpen(true);
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteConfirmItem = estimate?.lineItems?.find(
    (li) => li.id === deleteConfirmId,
  );

  const handleDeleteLineItem = (lineItemId: string) => {
    setDeleteConfirmId(lineItemId);
  };

  const confirmDeleteLineItem = useCallback(() => {
    if (deleteConfirmId && estimate) {
      deleteLineItemMutation.mutate({
        estimateId: estimate.id,
        lineItemId: deleteConfirmId,
      });
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, estimate, deleteLineItemMutation]);

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      { variant: "default" | "secondary" | "outline"; icon: any }
    > = {
      DRAFT: { variant: "secondary", icon: FileText },
      APPROVED: { variant: "default", icon: CheckCircle },
    };
    const config = variants[status] || variants["DRAFT"];
    const Icon = config.icon;
    return (
      <Badge
        variant={config.variant}
        className="gap-1"
        data-testid={`badge-estimate-status-${status.toLowerCase()}`}
      >
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
        <div className="mx-auto max-w-full px-6 py-8">
          <Button
            variant="ghost"
            onClick={() => setLocation(`/bids/${bidCode}`)}
            data-testid="button-back"
          >
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
      <main className="mx-auto max-w-full px-6 py-8 space-y-6">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => setLocation(`/bids/${bidCode}`)}
            data-testid="button-back"
          >
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
            <GenerateDraftEstimateButton bidId={bid.id} estimateId={estimate.id} />
            <EstimateFactorsOverrideDrawer estimateId={estimate.id} />
            <EstimatePdfExportButton
              estimateId={estimate.id}
              disabled={estimate.lineItems.length === 0}
            />
            <EstimateExcelExportButton
              estimateId={estimate.id}
              disabled={estimate.lineItems.length === 0}
            />
            <EstimatePhaseCExports
              estimateId={estimate.id}
              disabled={estimate.lineItems.length === 0}
            />
            {estimate.status === "DRAFT" && (
              <Button
                size="sm"
                onClick={() => approveEstimateMutation.mutate(estimate.id)}
                disabled={
                  approveEstimateMutation.isPending ||
                  estimate.lineItems.length === 0
                }
                data-testid="button-approve-estimate"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Approve Estimate
              </Button>
            )}
          </div>
        </div>

        <EstimateSummaryCards
          totals={totals}
          lineItemCount={estimate.lineItems.length}
          overheadPercent={overheadPercent}
          profitMarginPercent={profitMarginPercent}
        />

        <OrgMarkupBreakdownCard estimateId={estimate.id} showOverrideDrawer={false} />

        <MaterialJobTotals lineItems={estimate.lineItems} />

        {estimate.lineItems.length > 0 && (
          <MarkupCalculatorCard
            totals={totals}
            overheadPercent={overheadPercent}
            profitMarginPercent={profitMarginPercent}
            onOverheadChange={setOverheadPercent}
            onProfitChange={setProfitMarginPercent}
          />
        )}

        {hasEstimateAccess && (
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setAssemblyInsertOpen(true)}
              disabled={!estimate}
              data-testid="button-insert-assembly"
            >
              <Layers className="w-4 h-4 mr-2" />
              Insert Assembly
            </Button>
            {estimate && (
              <BidTabImportDialog
                estimateId={estimate.id}
                bidId={bidId}
                onLineItemsChanged={() => setLineItemsMutationCount((c) => c + 1)}
              />
            )}
            <LineItemFormDialog
              mode="add"
              open={addLineItemOpen}
              onOpenChange={handleAddDialogClose}
              form={form}
              onSubmit={onSubmit}
              isPending={addLineItemMutation.isPending}
              overheadPercent={overheadPercent}
              profitMarginPercent={profitMarginPercent}
              workCategories={workCategories}
              catalogPrices={catalogPrices}
              subcontractorQuotes={subcontractorQuotes}
              materialCalcData={materialCalcData}
              onMaterialCalcChange={setMaterialCalcData}
              catalogPricedMaterials={catalogPricedMaterials}
              onCatalogPricedMaterialsChange={setCatalogPricedMaterials}
              onCategoryChange={handleCategoryChange}
              onApplyCatalogPrice={applyCatalogPrice}
              equipmentSelectorKey={equipmentSelectorKey}
              estimateId={estimate?.id}
              useHierarchicalBuilder={useHierarchicalBuilder}
              onUseHierarchicalBuilderChange={setUseHierarchicalBuilder}
              selectedScopeData={selectedScopeData}
              onScopeSelect={handleScopeSelect}
              hierarchicalSelection={hierarchicalSelection}
              onHierarchicalSelectionChange={handleHierarchicalSelectionChange}
              hierarchicalQuantity={hierarchicalQuantity}
              onHierarchicalQuantityChange={setHierarchicalQuantity}
              hierarchicalUnit={hierarchicalUnit}
              onHierarchicalUnitChange={setHierarchicalUnit}
              aiEstimatorEnabled={aiEstimatorStatus?.enabled === true}
              aiEstimatorBidId={bid.id}
            />

            <LineItemFormDialog
              mode="edit"
              open={editLineItemOpen}
              onOpenChange={handleEditDialogClose}
              form={form}
              onSubmit={onSubmit}
              isPending={editLineItemMutation.isPending}
              overheadPercent={overheadPercent}
              profitMarginPercent={profitMarginPercent}
              workCategories={workCategories}
              catalogPrices={catalogPrices}
              subcontractorQuotes={subcontractorQuotes}
              materialCalcData={materialCalcData}
              onMaterialCalcChange={setMaterialCalcData}
              catalogPricedMaterials={catalogPricedMaterials}
              onCatalogPricedMaterialsChange={setCatalogPricedMaterials}
              onCategoryChange={handleCategoryChange}
              onApplyCatalogPrice={applyCatalogPrice}
              equipmentSelectorKey={equipmentSelectorKey}
              estimateId={estimate?.id}
              lineItemId={editingLineItem?.id}
              lineItemSource={editingLineItem?.source}
              aiEstimatorEnabled={aiEstimatorStatus?.enabled === true}
              aiEstimatorBidId={bid.id}
            />
          </div>
        )}

        <LineItemsTable
          lineItems={estimate.lineItems}
          overheadPercent={overheadPercent}
          profitMarginPercent={profitMarginPercent}
          hasEstimateAccess={hasEstimateAccess}
          onEdit={handleEditLineItem}
          onDelete={handleDeleteLineItem}
          isDeleting={deleteLineItemMutation.isPending}
        />

        {benchmarkSummary && (
          <div className="rounded-lg border bg-card p-4 space-y-3" data-testid="panel-benchmark-summary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Cost Benchmark Verification</span>
                {overallConfidence && (
                  <Badge
                    variant={overallConfidence === "HIGH" ? "default" : overallConfidence === "LOW" ? "destructive" : "secondary"}
                    className="text-xs"
                    data-testid="badge-overall-confidence"
                  >
                    {overallConfidence} confidence
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBenchmarkHistoryOpen(true)}
                  data-testid="button-view-benchmark-history"
                >
                  <History className="h-3.5 w-3.5 mr-1.5" />
                  View history
                </Button>
                {hasEstimateAccess && aiEstimatorStatus?.enabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refreshBenchmarksMutation.mutate()}
                    disabled={refreshBenchmarksMutation.isPending || estimate.lineItems.length === 0}
                    data-testid="button-refresh-benchmarks"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${refreshBenchmarksMutation.isPending ? "animate-spin" : ""}`} />
                    {refreshBenchmarksMutation.isPending ? "Refreshing…" : "Refresh Benchmarks"}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-benchmark-summary">
              {benchmarkSummary}
            </p>
          </div>
        )}

        {/* Task #3046 — Benchmark refresh history drawer */}
        <Sheet open={benchmarkHistoryOpen} onOpenChange={setBenchmarkHistoryOpen}>
          <SheetContent side="right" className="w-full sm:max-w-lg" data-testid="drawer-benchmark-history">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Benchmark Refresh History
              </SheetTitle>
            </SheetHeader>
            <ScrollArea className="mt-4 h-[calc(100vh-8rem)] pr-2">
              {benchmarkHistoryLoading && (
                <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-benchmark-history-loading">
                  Loading history…
                </p>
              )}
              {!benchmarkHistoryLoading && (!benchmarkHistoryData?.history || benchmarkHistoryData.history.length === 0) && (
                <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-benchmark-history-empty">
                  No refresh history yet. Use "Refresh Benchmarks" to record the first snapshot.
                </p>
              )}
              {benchmarkHistoryData?.history && benchmarkHistoryData.history.length > 0 && (
                <div className="space-y-4">
                  {benchmarkHistoryData.history.map((row, idx) => (
                    <div key={row.id} data-testid={`card-benchmark-history-${row.id}`}>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-muted-foreground">
                              {new Date(row.createdAt).toLocaleString(undefined, {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            {idx === 0 && (
                              <Badge variant="outline" className="text-xs" data-testid={`badge-benchmark-current-${row.id}`}>
                                Current
                              </Badge>
                            )}
                          </div>
                          {row.overallConfidence && (
                            <Badge
                              variant={row.overallConfidence === "HIGH" ? "default" : row.overallConfidence === "LOW" ? "destructive" : "secondary"}
                              className="text-xs"
                              data-testid={`badge-benchmark-confidence-${row.id}`}
                            >
                              {row.overallConfidence}
                            </Badge>
                          )}
                        </div>
                        {row.createdByName && (
                          <p className="text-xs text-muted-foreground" data-testid={`text-benchmark-author-${row.id}`}>
                            by {row.createdByName}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed" data-testid={`text-benchmark-summary-${row.id}`}>
                          {row.benchmarkSummary}
                        </p>
                      </div>
                      {idx < benchmarkHistoryData.history.length - 1 && <Separator className="mt-4" />}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <div className="space-y-2">
          <AiEstimatorIntroCallout surface="bid-estimate" />
          <div className="h-[420px]">
            <AiEstimatorChatPanel
              bidId={bid.id}
              estimateId={estimate.id}
              projectId={bid.convertedToProjectId ?? undefined}
              enabled
              lineItemsRevision={lineItemsMutationCount}
              measurementsRevision={measurementsMutationCount}
            />
          </div>
        </div>
      </main>

      {estimate && (
        <AssemblyInsertDialog
          estimateId={estimate.id}
          bidId={bidId}
          open={assemblyInsertOpen}
          onOpenChange={setAssemblyInsertOpen}
          onLineItemsChanged={() => setLineItemsMutationCount((c) => c + 1)}
        />
      )}

      <AlertDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Line Item
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmItem ? (
                <>
                  Are you sure you want to delete{" "}
                  <span className="font-medium text-foreground">
                    "{deleteConfirmItem.description}"
                  </span>
                  ? This action cannot be undone.
                </>
              ) : (
                "Are you sure you want to delete this line item? This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-line-item">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteLineItem}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-line-item"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
