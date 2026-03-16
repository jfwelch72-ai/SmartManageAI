import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, Layers, Tags, Calculator, DollarSign, FileText, ChevronRight, Building2, Sparkles, Loader2, Plus, Info } from "lucide-react";
import MaterialCalculator, { MaterialCalculatorData } from "@/components/MaterialCalculator";
import { CostCodeCombobox } from "@/components/CostCodeCombobox";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  organizationSowItemId: string;
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

// AI Suggestion response types
interface AISuggestion {
  categoryName: string;
  name: string;
  code: string;
  description: string;
  suggestedUom: string;
  requiresDimensions: boolean;
  dimensionLabel: string | null;
  confidence: number;
  reasoning: string;
}

interface SimilarItem {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  similarity: number;
}

interface AISuggestResponse {
  success: boolean;
  suggestion: AISuggestion;
  similarItems: SimilarItem[];
  existingCategories: string[];
}

export default function HierarchicalLineItemBuilder({
  onSelectionChange,
  quantity,
  onQuantityChange,
  unit,
  onUnitChange,
  materialCalcData,
  onMaterialCalcChange,
}: HierarchicalLineItemBuilderProps) {
  const { toast } = useToast();
  
  // Selection state
  const [selectedTrade, setSelectedTrade] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState<string>("");
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [expandedModifierCategories, setExpandedModifierCategories] = useState<string[]>([]);
  const [costCodeOverride, setCostCodeOverride] = useState<string>("");
  
  // AI Assist dialog state
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [aiSimilarItems, setAiSimilarItems] = useState<SimilarItem[]>([]);
  const [aiExistingCategories, setAiExistingCategories] = useState<string[]>([]);

  // Fetch hierarchical scope data
  const { data: hierarchicalData, isLoading: loadingHierarchy } = useQuery<HierarchicalData>({
    queryKey: ["/api/scope/hierarchical"],
  });
  
  // AI suggest mutation
  const aiSuggestMutation = useMutation({
    mutationFn: async (userInput: string) => {
      const response = await apiRequest("POST", "/api/ai-assistant/sow/suggest", {
        userInput,
        tradeType: hierarchicalData?.tradeType,
      });
      return response.json() as Promise<AISuggestResponse>;
    },
    onSuccess: (data) => {
      setAiSuggestion(data.suggestion);
      setAiSimilarItems(data.similarItems || []);
      setAiExistingCategories(data.existingCategories || []);
    },
    onError: (error: any) => {
      toast({
        title: "AI Suggestion Failed",
        description: error.message || "Could not generate suggestion. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  // Add SOW item mutation
  const addSowItemMutation = useMutation({
    mutationFn: async (suggestion: AISuggestion) => {
      const response = await apiRequest("POST", "/api/ai-assistant/sow/add", {
        categoryName: suggestion.categoryName,
        name: suggestion.name,
        code: suggestion.code,
        description: suggestion.description,
        unit: suggestion.suggestedUom,
        requiresDimensions: suggestion.requiresDimensions,
        dimensionLabel: suggestion.dimensionLabel,
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Scope Item Created",
        description: `"${aiSuggestion?.name}" has been added to your scope items.`,
      });
      // Refresh hierarchical data to include new item
      queryClient.invalidateQueries({ queryKey: ["/api/scope/hierarchical"] });
      // Close dialog and reset state
      setAiDialogOpen(false);
      setAiInput("");
      setAiSuggestion(null);
      setAiSimilarItems([]);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Item",
        description: error.message || "Could not create the scope item. Please try again.",
        variant: "destructive",
      });
    },
  });
  
  const handleAiSuggest = () => {
    if (!aiInput.trim()) return;
    setAiSuggestion(null);
    setAiSimilarItems([]);
    aiSuggestMutation.mutate(aiInput);
  };
  
  const handleAddSowItem = () => {
    if (!aiSuggestion) return;
    addSowItemMutation.mutate(aiSuggestion);
  };
  
  const resetAiDialog = () => {
    setAiInput("");
    setAiSuggestion(null);
    setAiSimilarItems([]);
    setAiExistingCategories([]);
  };

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
        workTypeCode: costCodeOverride || selectedWorkType.code,
        unit: unit || selectedWorkType.unit || "SF",
        modifierIds: selectedModifierIds,
        modifierNames: selectedModifiers.map(m => m.name),
        canonicalName,
        organizationSowItemId: selectedWorkType.id,
      });
    } else {
      onSelectionChange(null);
    }
  }, [selectedWorkType, selectedTradeObj, selectedTrade, selectedSubcategory, selectedModifierIds, canonicalName, unit, costCodeOverride]);

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
    const wt = availableWorkTypes.find(w => w.id === workTypeId);
    setCostCodeOverride(wt?.code || "");
    
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
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Scope of Work Selection
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                resetAiDialog();
                setAiDialogOpen(true);
              }}
              data-testid="button-ai-create-scope-item"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Create New Item
            </Button>
          </div>
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
              {selectedSubcategory && availableWorkTypes.length === 0 ? (
                <div className="border rounded-md p-3 bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-2">No work types found in this subcategory.</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetAiDialog();
                      setAiDialogOpen(true);
                    }}
                    data-testid="button-ai-create-empty-state"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Create with AI
                  </Button>
                </div>
              ) : (
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
              )}
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

      {/* Cost Code Override */}
      {selectedWorkType && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Cost Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <CostCodeCombobox
              value={costCodeOverride}
              onChange={setCostCodeOverride}
              data-testid="input-estimate-cost-code"
            />
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              This code appears in the Cost Code Breakdown dashboard widget. Pick a standardized code to align budget and actual tracking.
            </p>
          </CardContent>
        </Card>
      )}

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
      
      {/* AI Create New Scope Item Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={(open) => {
        setAiDialogOpen(open);
        if (!open) resetAiDialog();
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Create New Scope Item
            </DialogTitle>
            <DialogDescription>
              Describe the work type you need and AI will help format it correctly.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Input Section */}
            <div className="space-y-2">
              <Label>Describe the scope item</Label>
              <Textarea
                placeholder="e.g., 'Pour 4 inch concrete slab with wire mesh reinforcement' or 'Install 6 inch curb and gutter'"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                className="min-h-24"
                data-testid="textarea-ai-scope-description"
              />
              <Button
                onClick={handleAiSuggest}
                disabled={!aiInput.trim() || aiSuggestMutation.isPending}
                className="w-full"
                data-testid="button-ai-suggest"
              >
                {aiSuggestMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Suggestion
                  </>
                )}
              </Button>
            </div>
            
            {/* Similar Items Warning */}
            {aiSimilarItems.length > 0 && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-900/20 p-3">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 mb-2">
                  Similar items already exist:
                </p>
                <ul className="text-xs space-y-1">
                  {aiSimilarItems.map((item) => (
                    <li key={item.id} className="text-yellow-700 dark:text-yellow-300">
                      {item.name} ({item.categoryName})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* AI Suggestion Display */}
            {aiSuggestion && (
              <div className="rounded-md border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-medium text-sm">AI Suggestion</h4>
                  <Badge variant="secondary" className="text-xs">
                    {aiSuggestion.confidence}% confidence
                  </Badge>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-medium">{aiSuggestion.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Code</p>
                    <p className="font-mono text-xs">{aiSuggestion.code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Category</p>
                    <p>{aiSuggestion.categoryName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Unit</p>
                    <Badge variant="outline">{aiSuggestion.suggestedUom}</Badge>
                  </div>
                </div>
                
                {aiSuggestion.description && (
                  <div>
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="text-sm">{aiSuggestion.description}</p>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground italic border-t pt-2">
                  {aiSuggestion.reasoning}
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAiDialogOpen(false)}
              data-testid="button-cancel-ai-dialog"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddSowItem}
              disabled={!aiSuggestion || addSowItemMutation.isPending}
              data-testid="button-add-scope-item"
            >
              {addSowItemMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add to Scope Items
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
