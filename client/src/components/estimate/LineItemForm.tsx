import { useState, useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Plus, FileText, CheckCircle, Calculator, Layers, Tag, Store, Database, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StandardizedScopeSelector, { ScopeSelectionData } from "@/components/StandardizedScopeSelector";
import HierarchicalLineItemBuilder, { LineItemSelectionData } from "@/components/HierarchicalLineItemBuilder";
import ModifierSelector from "@/components/ModifierSelector";
import { UomSelect } from "@/components/UomSelect";
import MaterialCalculator, { type MaterialCalculatorData } from "@/components/MaterialCalculator";
import { ManualMaterialPricing } from "@/components/ManualMaterialPricing";
import { LaborRateSelector } from "@/components/LaborRateSelector";
import { EquipmentRateSelector } from "@/components/EquipmentRateSelector";
import { Checkbox } from "@/components/ui/checkbox";
import type { BidSubcontractorQuote } from "@shared/schema";
import type { LineItemFormValues, CatalogPriceItem, WorkCategory, SubcontractorAssignment } from "@/lib/estimate-utils";
import { shouldAutoShowMaterialCalc } from "@/lib/estimate-utils";

function SubcontractorAssignmentPanel({
  quotes,
  assignments,
  onAssignmentsChange,
  testPrefix = "",
}: {
  quotes: BidSubcontractorQuote[];
  assignments: SubcontractorAssignment[];
  onAssignmentsChange: (assignments: SubcontractorAssignment[]) => void;
  testPrefix?: string;
}) {
  const [compareMode, setCompareMode] = useState(false);

  const toggleQuote = (quoteId: string, checked: boolean) => {
    if (checked) {
      const quote = quotes.find(q => q.id === quoteId);
      onAssignmentsChange([
        ...assignments,
        {
          subcontractorQuoteId: quoteId,
          allocatedCost: Number(quote?.quoteAmount || 0),
          isSelected: true,
        },
      ]);
    } else {
      onAssignmentsChange(assignments.filter(a => a.subcontractorQuoteId !== quoteId));
    }
  };

  const updateAllocatedCost = (quoteId: string, cost: number) => {
    onAssignmentsChange(
      assignments.map(a =>
        a.subcontractorQuoteId === quoteId ? { ...a, allocatedCost: cost } : a
      )
    );
  };

  const totalAllocated = assignments
    .filter(a => a.isSelected)
    .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);

  return (
    <div className="col-span-2 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Subcontractor Quotes</h4>
        <Button
          type="button"
          variant={compareMode ? "default" : "outline"}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          data-testid={`button-${testPrefix}compare-quotes`}
        >
          {compareMode ? "Hide Comparison" : "Compare Quotes"}
        </Button>
      </div>

      {compareMode && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardContent className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">Quote Amount</TableHead>
                  <TableHead>Lead Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote) => (
                  <TableRow key={quote.id} data-testid={`row-compare-quote-${quote.id}`}>
                    <TableCell className="font-medium">{quote.subcontractorName}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">{quote.scopeOfWork}</TableCell>
                    <TableCell className="text-right font-medium">${Number(quote.quoteAmount).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">{quote.leadTime || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {quotes.map((quote) => {
          const assignment = assignments.find(a => a.subcontractorQuoteId === quote.id);
          const isChecked = !!assignment;

          return (
            <div
              key={quote.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${isChecked ? "border-primary bg-primary/5" : "border-border"}`}
              data-testid={`sub-assignment-${quote.id}`}
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={(checked) => toggleQuote(quote.id, !!checked)}
                data-testid={`checkbox-${testPrefix}sub-${quote.id}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{quote.subcontractorName}</span>
                  <Badge variant="secondary" className="text-xs">
                    ${Number(quote.quoteAmount).toLocaleString()}
                  </Badge>
                  {quote.leadTime && (
                    <span className="text-xs text-muted-foreground">{quote.leadTime}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{quote.scopeOfWork}</p>
              </div>
              {isChecked && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Allocated $</label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    className="w-28 h-8 text-sm"
                    value={assignment?.allocatedCost ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        updateAllocatedCost(quote.id, parseFloat(val) || 0);
                      }
                    }}
                    data-testid={`input-${testPrefix}sub-allocated-${quote.id}`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {assignments.length > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 rounded-lg" data-testid={`text-${testPrefix}sub-total`}>
          <span className="text-sm font-medium">Total Allocated</span>
          <span className="font-semibold">${totalAllocated.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

interface LineItemFormDialogProps {
  mode: "add" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<LineItemFormValues>;
  onSubmit: (values: LineItemFormValues) => void;
  isPending: boolean;
  overheadPercent: number;
  profitMarginPercent: number;
  workCategories: WorkCategory[];
  catalogPrices: CatalogPriceItem[];
  subcontractorQuotes: BidSubcontractorQuote[];
  materialCalcData: MaterialCalculatorData;
  onMaterialCalcChange: (data: MaterialCalculatorData) => void;
  catalogPricedMaterials: Set<string>;
  onCatalogPricedMaterialsChange: (materials: Set<string>) => void;
  onCategoryChange: (value: string) => void;
  onApplyCatalogPrice: (item: CatalogPriceItem) => void;
  equipmentSelectorKey: number;
  lineItemId?: string;
  lineItemSource?: string;
  useHierarchicalBuilder?: boolean;
  onUseHierarchicalBuilderChange?: (value: boolean) => void;
  selectedScopeData?: ScopeSelectionData | null;
  onScopeSelect?: (data: ScopeSelectionData) => void;
  hierarchicalSelection?: LineItemSelectionData | null;
  onHierarchicalSelectionChange?: (data: LineItemSelectionData | null) => void;
  hierarchicalQuantity?: number;
  onHierarchicalQuantityChange?: (q: number) => void;
  hierarchicalUnit?: string;
  onHierarchicalUnitChange?: (u: string) => void;
}

interface HistoricalCostRecord {
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
}

function HistoricalCostImportButton({ form }: { form: UseFormReturn<LineItemFormValues> }) {
  const [importOpen, setImportOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: records = [], isLoading } = useQuery<HistoricalCostRecord[]>({
    queryKey: ["/api/historical-costs", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("limit", "20");
      const res = await fetch(`/api/historical-costs?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: importOpen,
  });

  const handleSelect = (record: HistoricalCostRecord) => {
    form.setValue("description", record.description);
    form.setValue("unit", record.unit);
    form.setValue("quantity", Number(record.quantity) || 0);
    form.setValue("materialCost", Number(record.unitCost) || 0);
    setImportOpen(false);
    setSearchTerm("");
  };

  return (
    <Dialog open={importOpen} onOpenChange={setImportOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-import-from-history">
          <Database className="h-4 w-4 mr-2" />
          Import from History
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import from Historical Costs</DialogTitle>
          <DialogDescription>Select a historical cost record to populate line item fields</DialogDescription>
        </DialogHeader>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search historical costs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
            data-testid="input-search-history-import"
          />
        </div>
        {isLoading ? (
          <div className="text-center py-6 text-muted-foreground">Loading...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">
            <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No historical cost records found</p>
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead className="text-right">$/Unit</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id} data-testid={`row-history-import-${record.id}`}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">{record.description}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{record.scopeCategory}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${Number(record.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-xs">{record.unit}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">{record.projectName || "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSelect(record)}
                        data-testid={`button-use-history-${record.id}`}
                      >
                        Use
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LineItemFormDialog({
  mode,
  open,
  onOpenChange,
  form,
  onSubmit,
  isPending,
  overheadPercent,
  profitMarginPercent,
  workCategories,
  catalogPrices,
  subcontractorQuotes,
  materialCalcData,
  onMaterialCalcChange,
  catalogPricedMaterials,
  onCatalogPricedMaterialsChange,
  onCategoryChange,
  onApplyCatalogPrice,
  equipmentSelectorKey,
  lineItemId,
  lineItemSource,
  useHierarchicalBuilder = false,
  onUseHierarchicalBuilderChange,
  selectedScopeData,
  onScopeSelect,
  hierarchicalSelection,
  onHierarchicalSelectionChange,
  hierarchicalQuantity = 0,
  onHierarchicalQuantityChange,
  hierarchicalUnit = "",
  onHierarchicalUnitChange,
}: LineItemFormDialogProps) {
  const isAdd = mode === "add";
  const isEdit = mode === "edit";
  const testPrefix = isEdit ? "edit-" : "";
  const [manualCalcToggle, setManualCalcToggle] = useState(false);
  const [numericDisplayValues, setNumericDisplayValues] = useState<Record<string, string>>({});
  
  useEffect(() => {
    if (!open) {
      setManualCalcToggle(false);
      setNumericDisplayValues({});
    }
  }, [open]);

  const currentAssignments = form.watch("subcontractorAssignments") || [];
  const hasMultiSubAssignments = currentAssignments.length > 0;

  type NumericLineItemField = 'quantity' | 'materialCost' | 'laborCost' | 'laborHours'
    | 'equipmentCost' | 'equipmentHours' | 'consumablesCost'
    | 'subcontractCost' | 'overheadAllocation' | 'profitAllocation';

  const setNumericFormValue = (fieldName: NumericLineItemField, value: number) => {
    form.setValue(fieldName, value, { shouldDirty: true, shouldValidate: false });
  };

  const numericInputProps = (field: { value: number; onChange: (v: number) => void; onBlur: () => void; name: string; ref: React.Ref<HTMLInputElement> }) => {
    const displayValue = numericDisplayValues[field.name];
    const showValue = displayValue !== undefined ? displayValue : (field.value != null && field.value !== 0 ? String(field.value) : '');

    return {
      type: "text" as const,
      inputMode: "decimal" as const,
      ref: field.ref,
      name: field.name,
      onBlur: () => {
        const pendingDisplay = numericDisplayValues[field.name];
        if (pendingDisplay !== undefined) {
          const parsed = pendingDisplay === '' ? 0 : parseFloat(pendingDisplay);
          const value = Number.isNaN(parsed) ? 0 : parsed;
          setNumericFormValue(field.name as NumericLineItemField, value);
        }
        setNumericDisplayValues(prev => {
          const next = { ...prev };
          delete next[field.name];
          return next;
        });
        field.onBlur();
      },
      value: showValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
          setNumericDisplayValues(prev => ({ ...prev, [field.name]: raw }));
          const parsed = raw === '' ? 0 : parseFloat(raw);
          const value = Number.isNaN(parsed) ? 0 : parsed;
          field.onChange(value);
          setNumericFormValue(field.name as NumericLineItemField, value);
        }
      },
    };
  };

  const numericFieldNames: NumericLineItemField[] = [
    'quantity', 'materialCost', 'laborCost', 'laborHours',
    'equipmentCost', 'equipmentHours', 'consumablesCost',
    'subcontractCost', 'overheadAllocation', 'profitAllocation',
  ];

  const handleSubmitWithFlush = (values: LineItemFormValues) => {
    const flushed: LineItemFormValues = { ...values };
    for (const fieldName of numericFieldNames) {
      const displayVal = numericDisplayValues[fieldName];
      if (displayVal !== undefined) {
        const parsed = displayVal === '' ? 0 : parseFloat(displayVal);
        flushed[fieldName] = Number.isNaN(parsed) ? 0 : parsed;
      }
    }
    onSubmit(flushed);
  };

  const dialogContent = (
    <DialogContent className={`${isAdd ? "max-w-4xl" : "max-w-3xl"} max-h-[90vh] overflow-y-auto`}>
      <DialogHeader>
        <DialogTitle>{isAdd ? "Add Line Item" : "Edit Line Item"}</DialogTitle>
        <DialogDescription>
          {isAdd ? "Select scope of work and configure pricing details" : "Update the estimate line item details"}
        </DialogDescription>
      </DialogHeader>
      
      {isAdd && (
        <div className="flex items-center gap-2 border-b pb-3 mb-4">
          <Button
            type="button"
            variant={useHierarchicalBuilder ? "default" : "outline"}
            size="sm"
            onClick={() => onUseHierarchicalBuilderChange?.(true)}
            data-testid="button-hierarchical-mode"
          >
            <Layers className="h-4 w-4 mr-2" />
            Guided Selection
          </Button>
          <Button
            type="button"
            variant={!useHierarchicalBuilder ? "default" : "outline"}
            size="sm"
            onClick={() => onUseHierarchicalBuilderChange?.(false)}
            data-testid="button-manual-mode"
          >
            <FileText className="h-4 w-4 mr-2" />
            Manual Entry
          </Button>
          <div className="ml-auto">
            <HistoricalCostImportButton form={form} />
          </div>
        </div>
      )}
      
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmitWithFlush)} className="space-y-6" data-testid="form-line-item">
          {isAdd && useHierarchicalBuilder ? (
            <>
              <HierarchicalLineItemBuilder
                onSelectionChange={onHierarchicalSelectionChange!}
                lineItemId={lineItemId}
                quantity={hierarchicalQuantity}
                onQuantityChange={(q) => {
                  onHierarchicalQuantityChange?.(q);
                  form.setValue("quantity", q);
                }}
                unit={hierarchicalUnit}
                onUnitChange={(u) => {
                  onHierarchicalUnitChange?.(u);
                  form.setValue("unit", u);
                }}
                materialCalcData={materialCalcData}
                onMaterialCalcChange={onMaterialCalcChange}
              />
              
              {hierarchicalSelection && (
                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-900">
                  <p className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Scope selected: {hierarchicalSelection.canonicalName}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                    Trade: {hierarchicalSelection.tradeName} → {hierarchicalSelection.subcategoryName} → {hierarchicalSelection.workTypeName}
                  </p>
                </div>
              )}
            </>
          ) : isAdd ? (
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Standardized Scope of Work</span>
                <span className="text-xs text-muted-foreground ml-auto">Optional</span>
              </div>
              <StandardizedScopeSelector
                value={selectedScopeData || undefined}
                onChange={onScopeSelect!}
                showDimensionInputs={false}
                lineItemId={lineItemId}
              />
              {selectedScopeData && (
                <div className="mt-2 p-2 bg-green-50 dark:bg-green-950/30 rounded border border-green-200 dark:border-green-900">
                  <p className="text-xs text-green-700 dark:text-green-400">
                    SOW selected: Description, unit, and category have been auto-filled.
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {isEdit && lineItemId && (
            <div className="border rounded-md p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Modifiers</span>
              </div>
              <ModifierSelector
                trade={form.getValues("category")?.toUpperCase().replace(/ /g, "_")}
                lineItemId={lineItemId}
                onSelectionsChange={() => {}}
              />
            </div>
          )}
          
          {(isEdit || (isAdd && !useHierarchicalBuilder)) && (
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
                        data-testid={`input-${testPrefix}description`}
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
                    <Select onValueChange={onCategoryChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid={`select-${testPrefix}category`}>
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {workCategories.length > 0 ? (
                          workCategories.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                              {cat.itemCount > 0 && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({cat.itemCount})
                                </span>
                              )}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="CONCRETE">Concrete</SelectItem>
                            <SelectItem value="EXCAVATION">Excavation</SelectItem>
                            <SelectItem value="GRADING">Grading</SelectItem>
                            <SelectItem value="PAVING">Paving</SelectItem>
                            <SelectItem value="PAVERS">Pavers</SelectItem>
                            <SelectItem value="DEMOLITION">Demolition</SelectItem>
                            <SelectItem value="SITEWORK">Sitework</SelectItem>
                            <SelectItem value="STRUCTURAL_STEEL">Structural Steel</SelectItem>
                            <SelectItem value="MASONRY">Masonry</SelectItem>
                            <SelectItem value="FRAMING">Framing</SelectItem>
                            <SelectItem value="CARPENTRY">Carpentry</SelectItem>
                            <SelectItem value="ROOFING">Roofing</SelectItem>
                            <SelectItem value="WATERPROOFING">Waterproofing</SelectItem>
                            <SelectItem value="INSULATION">Insulation</SelectItem>
                            <SelectItem value="DRYWALL">Drywall</SelectItem>
                            <SelectItem value="PAINTING">Painting</SelectItem>
                            <SelectItem value="FLOORING">Flooring</SelectItem>
                            <SelectItem value="WINDOWS_DOORS">Windows & Doors</SelectItem>
                            <SelectItem value="PLUMBING">Plumbing</SelectItem>
                            <SelectItem value="HVAC">HVAC</SelectItem>
                            <SelectItem value="MECHANICAL">Mechanical</SelectItem>
                            <SelectItem value="ELECTRICAL">Electrical</SelectItem>
                            <SelectItem value="FIRE_PROTECTION">Fire Protection</SelectItem>
                            <SelectItem value="ELEVATOR">Elevator</SelectItem>
                            <SelectItem value="BOLLARDS">Bollards</SelectItem>
                            <SelectItem value="STRIPING">Striping</SelectItem>
                            <SelectItem value="SIGNAGE">Signage</SelectItem>
                            <SelectItem value="LANDSCAPING">Landscaping</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </>
                        )}
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
                      {isAdd ? (
                        <UomSelect
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Select unit"
                          data-testid="select-unit"
                        />
                      ) : (
                        <Input {...field} placeholder="e.g., CY, SF, LF" data-testid="input-edit-unit" />
                      )}
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
                        {...numericInputProps(field)}
                        placeholder="0" 
                        data-testid={`input-${testPrefix}quantity`} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="materialCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Material Cost ($)</FormLabel>
                  <FormControl>
                    <Input 
                      {...numericInputProps(field)}
                      placeholder="0.00" 
                      data-testid={`input-${testPrefix}material-cost`} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      onClick={() => onApplyCatalogPrice(item)}
                      data-testid={`${testPrefix}catalog-price-${item.id}`}
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
                          {...numericInputProps(field)}
                          placeholder="0.0" 
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '' || /^\d*\.?\d*$/.test(raw)) {
                              setNumericDisplayValues(prev => ({ ...prev, [field.name]: raw }));
                              const hours = raw === '' ? 0 : parseFloat(raw);
                              const safeHours = Number.isNaN(hours) ? 0 : hours;
                              field.onChange(safeHours);
                              form.setValue("laborHours", safeHours, { shouldDirty: true, shouldValidate: false });
                              const rate = form.watch("laborRateUsed") || 0;
                              if (rate > 0) {
                                form.setValue("laborCost", safeHours * rate, { shouldDirty: true, shouldValidate: false });
                              }
                            }
                          }}
                          data-testid={`input-${testPrefix}labor-hours`}
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
                          Labor Cost ($)
                          {hasRate && (
                            <span className="text-xs text-muted-foreground ml-1">
                              (auto-calculated)
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Input 
                            {...numericInputProps(field)}
                            placeholder="0.00" 
                            readOnly={hasRate}
                            className={hasRate ? "bg-muted" : ""}
                            data-testid={`input-${testPrefix}labor-cost`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
              </div>

              {form.watch("laborRateUsed") && form.watch("laborRateUsed")! > 0 && form.watch("laborHours") > 0 && (
                <div className="text-xs text-muted-foreground bg-background p-2 rounded border" data-testid={`${testPrefix}labor-calculation-summary`}>
                  {form.watch("laborHours")} hrs × ${form.watch("laborRateUsed")?.toFixed(2)}/hr = ${form.watch("laborCost").toFixed(2)}
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-3 p-3 rounded-md border bg-muted/30">
              <h5 className="font-medium text-sm">Equipment Costs</h5>
              
              <EquipmentRateSelector
                key={`equipment-${mode}-${equipmentSelectorKey}`}
                onSelect={(equipmentData) => {
                  form.setValue("equipmentHours", equipmentData.hours);
                  form.setValue("equipmentCost", equipmentData.totalCost);
                  form.setValue("equipmentSource", equipmentData.source);
                  form.setValue("selectedEquipmentId", equipmentData.equipmentId || undefined);
                  form.setValue("equipmentRateUsed", equipmentData.hourlyRate);
                }}
                initialHours={form.getValues("equipmentHours")}
                initialEquipmentId={form.getValues("selectedEquipmentId")}
                initialSource={form.getValues("equipmentSource") as "OWNED" | "RENTAL" | "MANUAL" | undefined}
              />
              
              {form.watch("equipmentRateUsed") > 0 && form.watch("equipmentSource") !== "MANUAL" && (
                <div className="text-xs text-muted-foreground bg-background rounded px-2 py-1 border" data-testid="text-equipment-rate-info">
                  Rate: ${form.watch("equipmentRateUsed")?.toFixed(2)}/hr
                  {form.watch("equipmentSource") === "OWNED" ? " (owned)" : " (rental)"}
                  {form.watch("equipmentHours") > 0 && ` × ${form.watch("equipmentHours")} hrs`}
                </div>
              )}

              <FormField
                control={form.control}
                name="equipmentCost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Equipment Cost ($)
                      <span className="text-xs text-muted-foreground ml-1">
                        {form.watch("selectedEquipmentId") ? "(auto-calculated, override below)" : "(or enter manually)"}
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input 
                        {...numericInputProps(field)}
                        placeholder="0.00" 
                        data-testid={`input-${testPrefix}equipment-cost`} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="subcontractCost"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subcontract Cost ($)</FormLabel>
                  <FormControl>
                    <Input 
                      {...numericInputProps(field)}
                      placeholder="0.00"
                      disabled={hasMultiSubAssignments}
                      data-testid={`input-${testPrefix}subcontract-cost`} 
                    />
                  </FormControl>
                  {hasMultiSubAssignments && (
                    <p className="text-xs text-muted-foreground">Auto-calculated from subcontractor allocations below</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {subcontractorQuotes.length > 0 && (
              <SubcontractorAssignmentPanel
                quotes={subcontractorQuotes}
                assignments={form.watch("subcontractorAssignments") || []}
                onAssignmentsChange={(assignments) => {
                  form.setValue("subcontractorAssignments", assignments);
                  const totalAllocated = assignments
                    .filter(a => a.isSelected)
                    .reduce((sum, a) => sum + Number(a.allocatedCost || 0), 0);
                  form.setValue("subcontractCost", assignments.length > 0 ? totalAllocated : 0);
                }}
                testPrefix={testPrefix}
              />
            )}

            {!hasMultiSubAssignments && form.watch("subcontractCost") > 0 && subcontractorQuotes.length > 0 && (
              <FormField
                control={form.control}
                name="subcontractorQuoteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign to Subcontractor (Legacy)</FormLabel>
                    <Select
                      onValueChange={(val) => field.onChange(val === "none" ? "" : val)}
                      value={field.value || ""}
                    >
                      <FormControl>
                        <SelectTrigger data-testid={`select-${testPrefix}subcontractor-quote`}>
                          <SelectValue placeholder="Select subcontractor..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
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
                    <Textarea {...field} value={field.value || ""} placeholder="Additional details..." data-testid={`input-${testPrefix}notes`} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {(isEdit || (isAdd && !useHierarchicalBuilder)) && (() => {
            const watchedValues = form.watch();
            const unit = watchedValues.unit || "";
            const quantity = Number(watchedValues.quantity) || 0;
            const category = watchedValues.category || "";
            const description = watchedValues.description || "";

            const { unitMatch, autoShow } = shouldAutoShowMaterialCalc({
              unit, category, description, materialCalcData, source: lineItemSource,
            });
            const showMaterialCalc = autoShow || (unitMatch && manualCalcToggle);
            
            if (showMaterialCalc) {
              return (
                <MaterialCalculator
                  unit={unit}
                  quantity={quantity}
                  description={description}
                  value={materialCalcData}
                  onChange={onMaterialCalcChange}
                />
              );
            }
            
            if (unitMatch && !autoShow) {
              return (
                <div className="flex justify-center py-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setManualCalcToggle(true)}
                    data-testid={`button-${testPrefix}show-material-calculator`}
                  >
                    <Calculator className="h-4 w-4 mr-2" />
                    Show Material Calculator
                  </Button>
                </div>
              );
            }
            
            return null;
          })()}

          <CalculatedQuantitiesSummary materialCalcData={materialCalcData} testPrefix={testPrefix} />

          <ManualMaterialPricing
            materialCalcData={materialCalcData}
            onMaterialCostChange={(cost) => form.setValue("materialCost", cost)}
            currentMaterialCost={Number(form.watch("materialCost")) || 0}
            catalogPricedMaterials={catalogPricedMaterials}
          />

          <CostPerUnitPreview
            form={form}
            overheadPercent={overheadPercent}
            profitMarginPercent={profitMarginPercent}
            testPrefix={testPrefix}
          />

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid={`button-${testPrefix}cancel`}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} data-testid={`button-${isAdd ? "submit-line-item" : "submit-edit-line-item"}`}>
              {isPending ? (isAdd ? "Adding..." : "Updating...") : (isAdd ? "Add Line Item" : "Update Line Item")}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );

  if (isAdd) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
        <DialogTrigger asChild>
          <Button data-testid="button-open-add-line-item">
            <Plus className="h-4 w-4 mr-2" />
            Add Line Item
          </Button>
        </DialogTrigger>
        {dialogContent}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      {dialogContent}
    </Dialog>
  );
}

function CalculatedQuantitiesSummary({ materialCalcData, testPrefix }: { materialCalcData: MaterialCalculatorData; testPrefix: string }) {
  const concreteYards = parseFloat(materialCalcData.calculatedConcreteYards || "0");
  const stoneTons = parseFloat(materialCalcData.calculatedStoneTons || "0");
  const excavationYards = parseFloat(materialCalcData.calculatedExcavationYards || "0");
  const wireMeshRolls = parseFloat(materialCalcData.calculatedWireMeshRolls || "0");
  const rebarCount = parseFloat(materialCalcData.calculatedRebarCount || "0");
  const rebarFeet = parseFloat(materialCalcData.calculatedRebarLinearFeet || "0");
  const sealerGallons = parseFloat(materialCalcData.calculatedSealerGallons || "0");
  const dowelCount = parseFloat(materialCalcData.calculatedDowelCount || "0");
  const underlaymentSF = parseFloat(materialCalcData.calculatedUnderlaymentSF || "0");
  
  const hasCalculatedQuantities = concreteYards > 0 || stoneTons > 0 || excavationYards > 0 || 
    wireMeshRolls > 0 || rebarCount > 0 || sealerGallons > 0 || dowelCount > 0 || underlaymentSF > 0;
  
  if (!hasCalculatedQuantities) return null;
  
  return (
    <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
          <Calculator className="h-4 w-4" />
          Calculated Material Quantities
        </CardTitle>
        <CardDescription className="text-xs">
          These quantities will be used for material cost calculations (not the scope quantity)
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {concreteYards > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-concrete-yards`}>
              Concrete: {concreteYards.toFixed(2)} CY
            </Badge>
          )}
          {stoneTons > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-stone-tons`}>
              Stone: {stoneTons.toFixed(2)} TON
            </Badge>
          )}
          {excavationYards > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-excavation-yards`}>
              Excavation: {excavationYards.toFixed(2)} CY
            </Badge>
          )}
          {wireMeshRolls > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-wire-mesh-rolls`}>
              Wire Mesh: {wireMeshRolls.toFixed(1)} ROLLS
            </Badge>
          )}
          {rebarCount > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-rebar-count`}>
              Rebar: {rebarCount.toFixed(0)} EA ({rebarFeet.toFixed(0)} LF)
            </Badge>
          )}
          {dowelCount > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-dowel-count`}>
              Dowels: {dowelCount.toFixed(0)} EA
            </Badge>
          )}
          {sealerGallons > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-sealer-gallons`}>
              Sealer: {sealerGallons.toFixed(1)} GAL
            </Badge>
          )}
          {underlaymentSF > 0 && (
            <Badge variant="outline" className="bg-background" data-testid={`${testPrefix}badge-underlayment-sf`}>
              Underlayment: {underlaymentSF.toFixed(0)} SF
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Use catalog pricing or enter manual unit prices below
        </p>
      </CardContent>
    </Card>
  );
}

function CostPerUnitPreview({ 
  form, 
  overheadPercent, 
  profitMarginPercent, 
  testPrefix 
}: { 
  form: UseFormReturn<LineItemFormValues>; 
  overheadPercent: number; 
  profitMarginPercent: number; 
  testPrefix: string;
}) {
  const watchedValues = form.watch();
  const quantity = Number(watchedValues.quantity) || 0;
  const unit = watchedValues.unit || "UNIT";
  const directCost = (Number(watchedValues.materialCost) || 0) + 
                    (Number(watchedValues.laborCost) || 0) + 
                    (Number(watchedValues.equipmentCost) || 0) + 
                    (Number(watchedValues.consumablesCost) || 0) +
                    (Number(watchedValues.subcontractCost) || 0);
  
  if (quantity <= 0) return null;

  const costPerUnit = directCost / quantity;
  const overheadPerUnit = costPerUnit * (overheadPercent / 100);
  const costWithOverhead = costPerUnit + overheadPerUnit;
  const profitPerUnit = costWithOverhead * (profitMarginPercent / 100);
  const bidPricePerUnit = costWithOverhead + profitPerUnit;
  const totalMarkupPercent = costPerUnit > 0 ? ((bidPricePerUnit / costPerUnit) - 1) * 100 : 0;
  const totalOverhead = directCost * (overheadPercent / 100);
  const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
  
  return (
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
            <p className="text-lg font-semibold" data-testid={`text-${testPrefix}cost-per-unit`}>
              ${costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-background rounded-md border">
            <p className="text-xs text-muted-foreground mb-1">+ Overhead ({overheadPercent}%)</p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400" data-testid={`text-${testPrefix}overhead-per-unit`}>
              +${overheadPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-background rounded-md border">
            <p className="text-xs text-muted-foreground mb-1">+ Profit ({profitMarginPercent}%)</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400" data-testid={`text-${testPrefix}profit-per-unit`}>
              +${profitPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
          <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
            <p className="text-xs text-muted-foreground mb-1">Bid Price</p>
            <p className="text-lg font-bold text-primary" data-testid={`text-${testPrefix}bid-price-per-unit`}>
              ${bidPricePerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-muted-foreground">per {unit}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-800">
              <p className="text-xs text-muted-foreground mb-1">Total Overhead</p>
              <p className="text-xl font-bold text-orange-600 dark:text-orange-400" data-testid={`text-${testPrefix}total-overhead`}>
                ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md border border-green-200 dark:border-green-800">
              <p className="text-xs text-muted-foreground mb-1">Total Profit</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid={`text-${testPrefix}total-profit`}>
                ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="p-3 bg-primary/10 rounded-md border border-primary/20">
              <p className="text-xs text-muted-foreground mb-1">Total Bid Price</p>
              <p className="text-xl font-bold text-primary" data-testid={`text-${testPrefix}total-bid-price`}>
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
  );
}
