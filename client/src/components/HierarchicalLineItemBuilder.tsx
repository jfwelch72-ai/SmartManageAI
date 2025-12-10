import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, Layers, Tags, Calculator, DollarSign, FileText, ChevronRight, Building2 } from "lucide-react";
import MaterialCalculator, { MaterialCalculatorData } from "@/components/MaterialCalculator";

// Types for hierarchical data
interface WorkType {
  id: string;
  name: string;
  code: string;
  description: string | null;
  unit: string | null;
  categoryName: string | null;
  requiresDimensions: boolean;
  dimensionLabel: string | null;
}

interface Subcategory {
  subcategoryName: string;
  workTypes: WorkType[];
}

interface Trade {
  tradeName: string;
  categoryCode: string;
  subcategories: Subcategory[];
}

interface HierarchicalData {
  isGC: boolean;
  tradeType: string;
  hierarchy: Trade[];
}

interface Modifier {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  displayOrder: number;
  isCustom: boolean;
  isActive: boolean;
}

interface ModifierCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  modifiers: Modifier[];
}

export interface LineItemSelectionData {
  tradeName: string;
  categoryCode: string;
  subcategoryName: string;
  workTypeId: string;
  workTypeName: string;
  workTypeCode: string;
  unit: string;
  modifierIds: string[];
  modifierNames: string[];
  canonicalName: string;
}

interface HierarchicalLineItemBuilderProps {
  onSelectionChange: (data: LineItemSelectionData | null) => void;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  unit: string;
  onUnitChange: (unit: string) => void;
  materialCalcData: MaterialCalculatorData;
  onMaterialCalcChange: (data: MaterialCalculatorData) => void;
}

const COMMON_UNITS = [
  { value: "SF", label: "SF (Square Feet)" },
  { value: "LF", label: "LF (Linear Feet)" },
  { value: "SY", label: "SY (Square Yards)" },
  { value: "CY", label: "CY (Cubic Yards)" },
  { value: "EA", label: "EA (Each)" },
  { value: "LS", label: "LS (Lump Sum)" },
  { value: "TON", label: "TON (Tons)" },
  { value: "GAL", label: "GAL (Gallons)" },
  { value: "HR", label: "HR (Hours)" },
];

export default function HierarchicalLineItemBuilder({
  onSelectionChange,
  quantity,
  onQuantityChange,
  unit,
  onUnitChange,
  materialCalcData,
  onMaterialCalcChange,
}: HierarchicalLineItemBuilderProps) {
  // Selection state
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState<string>("");
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [expandedModifierCategories, setExpandedModifierCategories] = useState<string[]>([]);

  // Fetch hierarchical scope data
  const { data: hierarchicalData, isLoading: loadingHierarchy } = useQuery<HierarchicalData>({
    queryKey: ["/api/scope/hierarchical"],
  });

  // Fetch modifiers
  const { data: modifierCategories = [], isLoading: loadingModifiers } = useQuery<ModifierCategory[]>({
    queryKey: ["/api/scope/modifiers"],
  });

  // Get selected trade object with categoryCode
  const selectedTradeObj = useMemo(() => {
    if (!hierarchicalData || !selectedTrade) return null;
    return hierarchicalData.hierarchy.find(t => t.tradeName === selectedTrade) || null;
  }, [hierarchicalData, selectedTrade]);

  // Get available subcategories for selected trade
  const availableSubcategories = useMemo(() => {
    return selectedTradeObj?.subcategories || [];
  }, [selectedTradeObj]);

  // Get available work types for selected subcategory
  const availableWorkTypes = useMemo(() => {
    if (!selectedSubcategory || availableSubcategories.length === 0) return [];
    const subcategory = availableSubcategories.find(s => s.subcategoryName === selectedSubcategory);
    return subcategory?.workTypes || [];
  }, [availableSubcategories, selectedSubcategory]);

  // Get selected work type details
  const selectedWorkType = useMemo(() => {
    if (!selectedWorkTypeId) return null;
    return availableWorkTypes.find(wt => wt.id === selectedWorkTypeId) || null;
  }, [availableWorkTypes, selectedWorkTypeId]);

  // Get selected modifiers
  const selectedModifiers = useMemo(() => {
    const mods: Modifier[] = [];
    modifierCategories.forEach((cat) => {
      cat.modifiers.forEach((m) => {
        if (selectedModifierIds.includes(m.id)) {
          mods.push(m);
        }
      });
    });
    return mods;
  }, [modifierCategories, selectedModifierIds]);

  // Build canonical name
  const canonicalName = useMemo(() => {
    if (!selectedWorkType) return "";
    let name = selectedWorkType.name;
    if (selectedModifiers.length > 0) {
      name += " - " + selectedModifiers.map(m => m.name).join(", ");
    }
    return name;
  }, [selectedWorkType, selectedModifiers]);

  // Emit selection change
  useEffect(() => {
    if (selectedWorkType && selectedTradeObj) {
      onSelectionChange({
        tradeName: selectedTrade,
        categoryCode: selectedTradeObj.categoryCode,
        subcategoryName: selectedSubcategory,
        workTypeId: selectedWorkType.id,
        workTypeName: selectedWorkType.name,
        workTypeCode: selectedWorkType.code,
        unit: unit || selectedWorkType.unit || "SF",
        modifierIds: selectedModifierIds,
        modifierNames: selectedModifiers.map(m => m.name),
        canonicalName,
      });
    } else {
      onSelectionChange(null);
    }
  }, [selectedWorkType, selectedTradeObj, selectedTrade, selectedSubcategory, selectedModifierIds, canonicalName, unit]);

  // Auto-set unit when work type changes
  useEffect(() => {
    if (selectedWorkType?.unit && !unit) {
      onUnitChange(selectedWorkType.unit);
    }
  }, [selectedWorkType]);

  // Handle trade change - reset downstream selections
  const handleTradeChange = (trade: string) => {
    setSelectedTrade(trade);
    setSelectedSubcategory("");
    setSelectedWorkTypeId("");
    setSelectedModifierIds([]);
  };

  // Handle subcategory change - reset work type
  const handleSubcategoryChange = (subcategory: string) => {
    setSelectedSubcategory(subcategory);
    setSelectedWorkTypeId("");
    setSelectedModifierIds([]);
  };

  // Handle work type change
  const handleWorkTypeChange = (workTypeId: string) => {
    setSelectedWorkTypeId(workTypeId);
    setSelectedModifierIds([]);
    
    // Auto-set unit from work type
    const workType = availableWorkTypes.find(wt => wt.id === workTypeId);
    if (workType?.unit) {
      onUnitChange(workType.unit);
    }
  };

  // Toggle modifier selection
  const toggleModifier = (modifierId: string) => {
    setSelectedModifierIds(prev => 
      prev.includes(modifierId) 
        ? prev.filter(id => id !== modifierId)
        : [...prev, modifierId]
    );
  };

  // Toggle modifier category expansion
  const toggleModifierCategory = (categoryId: string) => {
    setExpandedModifierCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  if (loadingHierarchy) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 bg-muted rounded" />
        <div className="h-10 bg-muted rounded" />
        <div className="h-10 bg-muted rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1-3: Hierarchical Selection */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Scope of Work Selection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trade/Category Selection */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Step 1: Trade/Category */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {hierarchicalData?.isGC ? "Trade Category" : "Category"}
              </Label>
              <Select value={selectedTrade} onValueChange={handleTradeChange}>
                <SelectTrigger data-testid="select-trade-category">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {hierarchicalData?.hierarchy.map((trade) => (
                    <SelectItem key={trade.tradeName} value={trade.tradeName}>
                      {trade.tradeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: Subcategory */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                Subcategory
              </Label>
              <Select 
                value={selectedSubcategory} 
                onValueChange={handleSubcategoryChange}
                disabled={!selectedTrade}
              >
                <SelectTrigger data-testid="select-subcategory">
                  <SelectValue placeholder={selectedTrade ? "Select subcategory..." : "Select category first"} />
                </SelectTrigger>
                <SelectContent>
                  {availableSubcategories.map((sub) => (
                    <SelectItem key={sub.subcategoryName} value={sub.subcategoryName}>
                      {sub.subcategoryName} ({sub.workTypes.length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 3: Work Type */}
            <div className="space-y-2">
              <Label className="text-xs font-medium flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Work Type
              </Label>
              <Select 
                value={selectedWorkTypeId} 
                onValueChange={handleWorkTypeChange}
                disabled={!selectedSubcategory}
              >
                <SelectTrigger data-testid="select-work-type">
                  <SelectValue placeholder={selectedSubcategory ? "Select work type..." : "Select subcategory first"} />
                </SelectTrigger>
                <SelectContent>
                  {availableWorkTypes.map((wt) => (
                    <SelectItem key={wt.id} value={wt.id}>
                      {wt.name}
                      {wt.unit && <span className="text-muted-foreground ml-1">({wt.unit})</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selected Work Type Info */}
          {selectedWorkType && (
            <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-sm">{canonicalName}</p>
                  {selectedWorkType.description && (
                    <p className="text-xs text-muted-foreground mt-1">{selectedWorkType.description}</p>
                  )}
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      {selectedTrade}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {selectedSubcategory}
                    </Badge>
                  </div>
                </div>
                <Badge className="text-xs">{selectedWorkType.unit || "SF"}</Badge>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 4: Modifiers */}
      {selectedWorkType && modifierCategories.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tags className="h-4 w-4 text-primary" />
              Modifiers
              {selectedModifiers.length > 0 && (
                <Badge variant="secondary" className="ml-auto">{selectedModifiers.length} selected</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {modifierCategories.map((category) => (
              <Collapsible
                key={category.id}
                open={expandedModifierCategories.includes(category.id)}
                onOpenChange={() => toggleModifierCategory(category.id)}
              >
                <CollapsibleTrigger 
                  className="flex items-center gap-2 w-full p-2 rounded hover:bg-muted/50 text-sm"
                  data-testid={`button-modifier-category-${category.id}`}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${expandedModifierCategories.includes(category.id) ? "rotate-180" : ""}`} />
                  <span className="font-medium">{category.name}</span>
                  <span className="text-muted-foreground text-xs">({category.modifiers.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pl-6 space-y-1 py-2">
                  {category.modifiers.map((modifier) => (
                    <label
                      key={modifier.id}
                      className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/30 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedModifierIds.includes(modifier.id)}
                        onCheckedChange={() => toggleModifier(modifier.id)}
                        data-testid={`checkbox-modifier-${modifier.id}`}
                      />
                      <span>{modifier.name}</span>
                      <span className="text-muted-foreground text-xs">({modifier.code})</span>
                    </label>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Step 5: Quantity & Unit */}
      {selectedWorkType && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Quantity & Measurements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quantity || ""}
                  onChange={(e) => onQuantityChange(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  data-testid="input-quantity"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Unit of Measure</Label>
                <Select value={unit} onValueChange={onUnitChange}>
                  <SelectTrigger data-testid="select-unit">
                    <SelectValue placeholder="Select unit..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COMMON_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Material Calculator */}
            {quantity > 0 && unit && (
              <div className="mt-4">
                <MaterialCalculator
                  unit={unit}
                  quantity={quantity}
                  description={canonicalName}
                  value={materialCalcData}
                  onChange={onMaterialCalcChange}
                  workTypeCode={selectedWorkType.code}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
