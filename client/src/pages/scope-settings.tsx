import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Settings, Layers, Tag, ArrowLeft, Wrench, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";

interface WorkTypeCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  workTypes: WorkType[];
}

interface WorkType {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  defaultUnit: string;
  requiresDimensions: boolean;
  dimensionType: string | null;
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

interface Modifier {
  id: string;
  categoryId: string;
  name: string;
  code: string;
  displayOrder: number;
  isCustom: boolean;
  isActive: boolean;
}

interface TradeConfigResponse {
  organization: {
    id: string;
    name: string;
    tradeType: string;
    tradeName: string | null;
  };
  sowItemCount: number;
  tradeTypes: { value: string; label: string }[];
}

// Trade to sub-category mapping for hierarchical selection
const TRADE_SUBCATEGORIES: Record<string, string[]> = {
  CONCRETE: ["Flatwork", "Walls", "Foundations", "Footings", "Curb & Gutter", "Decorative", "Stamped", "Precast"],
  EARTHWORK: ["Excavation", "Grading", "Backfill", "Compaction", "Trenching", "Site Prep", "Erosion Control"],
  ASPHALT_PAVING: ["Paving", "Seal Coating", "Striping", "Patching", "Milling", "Overlay"],
  ROOFING: ["Low Slope", "Steep Slope", "Metal Roofing", "Shingles", "Tile", "TPO/EPDM", "Built-Up", "Repairs"],
  ELECTRICAL: ["Rough-In", "Trim-Out", "Panel Work", "Lighting", "Low Voltage", "Service Upgrade", "Generator"],
  PLUMBING: ["Rough-In", "Trim-Out", "Water Heater", "Fixtures", "Drain/Sewer", "Gas Piping", "Water Service"],
  HVAC: ["Ductwork", "Equipment", "Controls", "Refrigeration", "Ventilation", "Split Systems", "Package Units"],
  CARPENTRY: ["Framing", "Rough Carpentry", "Finish Carpentry", "Trim", "Cabinets", "Doors", "Hardware"],
  MASONRY: ["Block", "Brick", "Stone", "Veneer", "Fireplace", "Chimney", "Retaining Walls"],
  DRYWALL: ["Hanging", "Finishing", "Texture", "Acoustical", "Metal Framing", "Insulation"],
  PAINTING: ["Interior", "Exterior", "Prep Work", "Staining", "Specialty Coatings", "Wallcovering"],
  FLOORING: ["Tile", "Hardwood", "LVP/LVT", "Carpet", "Epoxy", "Polished Concrete", "VCT"],
  LANDSCAPING: ["Softscape", "Hardscape", "Irrigation", "Lighting", "Fencing", "Pavers", "Retaining Walls"],
  DEMOLITION: ["Selective Demo", "Full Demo", "Hazmat Abatement", "Concrete Removal", "Interior Strip-Out"],
  STEEL_ERECTION: ["Structural Steel", "Misc Metals", "Ornamental", "Stairs/Rails", "Decking"],
  GLAZING: ["Storefront", "Curtain Wall", "Windows", "Doors", "Skylights", "Mirrors", "Shower Enclosures"],
  INSULATION: ["Batt Insulation", "Blown-In", "Spray Foam", "Rigid Board", "Fire Stopping"],
  FIRE_PROTECTION: ["Sprinkler Systems", "Fire Alarms", "Suppression", "Standpipes", "Extinguishers"],
  LOW_VOLTAGE: ["Data/Network", "Security", "Audio/Video", "Access Control", "Fire Alarm", "Intercom"],
  SOLAR: ["Roof Mount", "Ground Mount", "Battery Storage", "Inverters", "Electrical Tie-In"],
  WATERPROOFING: ["Below Grade", "Above Grade", "Decks/Balconies", "Foundation", "Caulking/Sealants"],
  GENERAL_CONTRACTOR: ["General Conditions", "Supervision", "Temporary Facilities", "Site Management", "Coordination"],
  OTHER: ["Custom", "Miscellaneous", "Specialty"]
};

export default function ScopeSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("work-types");

  const { data: tradeConfig } = useQuery<TradeConfigResponse>({
    queryKey: ["/api/organization/trade-config"],
    enabled: !!user
  });

  const getTradeTypeBadgeColor = (tradeType: string) => {
    if (tradeType === 'GENERAL_CONTRACTOR') {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    } else if (tradeType === 'OTHER') {
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    }
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
  };
  const [showWorkTypeDialog, setShowWorkTypeDialog] = useState(false);
  const [showModifierDialog, setShowModifierDialog] = useState(false);
  const [editingWorkType, setEditingWorkType] = useState<WorkType | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  
  // Two-level category selection state
  const [selectedTrade, setSelectedTrade] = useState("");
  const [selectedSubCategory, setSelectedSubCategory] = useState("");

  const [workTypeForm, setWorkTypeForm] = useState({
    categoryId: "",
    name: "",
    code: "",
    defaultUnit: "SF",
    requiresDimensions: false,
    dimensionType: "",
    displayOrder: 100
  });

  const [modifierForm, setModifierForm] = useState({
    categoryId: "",
    name: "",
    code: "",
    displayOrder: 100
  });

  const { data: workTypeCategories = [], isLoading: loadingWorkTypes } = useQuery<WorkTypeCategory[]>({
    queryKey: ["/api/scope/work-types"]
  });

  const { data: modifierCategories = [], isLoading: loadingModifiers } = useQuery<ModifierCategory[]>({
    queryKey: ["/api/scope/modifiers"]
  });

  const createWorkTypeMutation = useMutation({
    mutationFn: async (data: typeof workTypeForm & { tradeName?: string; categoryName?: string }) => {
      return await apiRequest("POST", "/api/scope/work-types", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type created successfully" });
      setShowWorkTypeDialog(false);
      resetWorkTypeForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create work type", variant: "destructive" });
    }
  });

  const updateWorkTypeMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<WorkType>) => {
      return await apiRequest("PUT", `/api/scope/work-types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type updated successfully" });
      setShowWorkTypeDialog(false);
      setEditingWorkType(null);
      resetWorkTypeForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update work type", variant: "destructive" });
    }
  });

  const deleteWorkTypeMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/scope/work-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/work-types"] });
      toast({ title: "Work type deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete work type", variant: "destructive" });
    }
  });

  const createModifierMutation = useMutation({
    mutationFn: async (data: typeof modifierForm) => {
      return await apiRequest("POST", "/api/scope/modifiers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier created successfully" });
      setShowModifierDialog(false);
      resetModifierForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create modifier", variant: "destructive" });
    }
  });

  const updateModifierMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string } & Partial<Modifier>) => {
      return await apiRequest("PUT", `/api/scope/modifiers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier updated successfully" });
      setShowModifierDialog(false);
      setEditingModifier(null);
      resetModifierForm();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update modifier", variant: "destructive" });
    }
  });

  const deleteModifierMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/scope/modifiers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope/modifiers"] });
      toast({ title: "Modifier deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete modifier", variant: "destructive" });
    }
  });

  const resetWorkTypeForm = () => {
    setWorkTypeForm({
      categoryId: "",
      name: "",
      code: "",
      defaultUnit: "SF",
      requiresDimensions: false,
      dimensionType: "",
      displayOrder: 100
    });
    setSelectedTrade("");
    setSelectedSubCategory("");
  };
  
  // Get available trades from the mapping
  const availableTrades = Object.keys(TRADE_SUBCATEGORIES).sort();
  
  // Get sub-categories for selected trade (always include "General" as first option for fallback)
  const availableSubCategories = selectedTrade 
    ? ["General", ...(TRADE_SUBCATEGORIES[selectedTrade] || [])] 
    : [];
  
  // Find category info based on trade + subcategory selection
  // Returns both categoryId and categoryName for robust mapping
  const findCategoryInfo = (trade: string, subCategory: string): { id: string; name: string } | null => {
    // Format trade name for comparison (underscores to spaces for display matching)
    const tradeFormatted = trade.replace(/_/g, " ");
    
    // Strategy 1: Try exact match with "TRADE - SubCategory" pattern
    const targetName = `${tradeFormatted} - ${subCategory}`;
    const exactMatch = workTypeCategories.find(cat => 
      cat.name.toLowerCase() === targetName.toLowerCase()
    );
    if (exactMatch) {
      return { id: exactMatch.id, name: exactMatch.name };
    }
    
    // Strategy 2: Try matching just the subcategory name alone (handles standalone categories like "Curb & Gutter")
    if (subCategory && subCategory !== "General") {
      const standaloneMatch = workTypeCategories.find(cat => 
        cat.name.toLowerCase() === subCategory.toLowerCase()
      );
      if (standaloneMatch) {
        return { id: standaloneMatch.id, name: standaloneMatch.name };
      }
    }
    
    // Strategy 3: If subCategory is "General" or empty, try to find category that just matches the trade name
    if (!subCategory || subCategory === "General") {
      const tradeCategory = workTypeCategories.find(cat => 
        cat.name.toLowerCase() === trade.toLowerCase() ||
        cat.name.toLowerCase() === tradeFormatted.toLowerCase()
      );
      if (tradeCategory) {
        return { id: tradeCategory.id, name: tradeCategory.name };
      }
    }
    
    // No match found
    return null;
  };
  
  // Legacy wrapper for backward compatibility
  const findCategoryId = (trade: string, subCategory: string): string => {
    const info = findCategoryInfo(trade, subCategory);
    return info?.id || "";
  };
  
  // Check if current selection has a valid category match
  const hasValidCategoryMatch = !!(selectedTrade && selectedSubCategory && workTypeForm.categoryId);
  
  // Handle trade selection change
  const handleTradeChange = (trade: string) => {
    setSelectedTrade(trade);
    setSelectedSubCategory("");
    setWorkTypeForm(prev => ({ ...prev, categoryId: "" }));
  };
  
  // Handle sub-category selection change  
  const handleSubCategoryChange = (subCategory: string) => {
    setSelectedSubCategory(subCategory);
    const categoryId = findCategoryId(selectedTrade, subCategory);
    setWorkTypeForm(prev => ({ ...prev, categoryId }));
  };

  const resetModifierForm = () => {
    setModifierForm({
      categoryId: "",
      name: "",
      code: "",
      displayOrder: 100
    });
  };

  const handleEditWorkType = (workType: WorkType) => {
    setEditingWorkType(workType);
    setWorkTypeForm({
      categoryId: workType.categoryId,
      name: workType.name,
      code: workType.code,
      defaultUnit: workType.defaultUnit,
      requiresDimensions: workType.requiresDimensions,
      dimensionType: workType.dimensionType || "",
      displayOrder: workType.displayOrder
    });
    
    // Parse category name to set trade and sub-category for editing
    const category = workTypeCategories.find(cat => cat.id === workType.categoryId);
    if (category) {
      const dashIndex = category.name.indexOf(" - ");
      if (dashIndex > 0) {
        const trade = category.name.substring(0, dashIndex).trim().toUpperCase().replace(/\s+/g, "_");
        const subCat = category.name.substring(dashIndex + 3).trim();
        setSelectedTrade(trade);
        setSelectedSubCategory(subCat);
      } else {
        // No dash - use full name as trade, set "General" as sub-category
        const trade = category.name.toUpperCase().replace(/\s+/g, "_");
        setSelectedTrade(trade);
        setSelectedSubCategory("General");
      }
    }
    
    setShowWorkTypeDialog(true);
  };

  const handleEditModifier = (modifier: Modifier) => {
    setEditingModifier(modifier);
    setModifierForm({
      categoryId: modifier.categoryId,
      name: modifier.name,
      code: modifier.code,
      displayOrder: modifier.displayOrder
    });
    setShowModifierDialog(true);
  };

  const handleSaveWorkType = () => {
    if (editingWorkType) {
      updateWorkTypeMutation.mutate({ id: editingWorkType.id, ...workTypeForm });
    } else {
      // Get category info - either existing category name or generate new one
      const existingCategoryInfo = findCategoryInfo(selectedTrade, selectedSubCategory);
      const categoryName = existingCategoryInfo?.name 
        || `${selectedTrade.replace(/_/g, " ")} - ${selectedSubCategory}`;
      
      createWorkTypeMutation.mutate({
        ...workTypeForm,
        tradeName: selectedTrade,
        // Always send categoryName for robust backend handling (no index-based mapping)
        categoryName: categoryName,
      });
    }
  };

  const handleSaveModifier = () => {
    if (editingModifier) {
      updateModifierMutation.mutate({ id: editingModifier.id, ...modifierForm });
    } else {
      createModifierMutation.mutate(modifierForm);
    }
  };

  const unitOptions = ["SF", "LF", "SY", "CY", "EA", "TON", "LS"];
  const dimensionTypeOptions = ["", "length_width_depth", "length_height_thickness"];

  // Group categories by parent trade (e.g., "ROOFING - Low Slope" and "ROOFING - Steep Slope" -> grouped under "ROOFING")
  interface GroupedTrade {
    parentTrade: string;
    subCategories: WorkTypeCategory[];
  }

  const groupedByTrade = (): GroupedTrade[] => {
    const tradeMap = new Map<string, WorkTypeCategory[]>();
    
    for (const category of workTypeCategories) {
      // Parse category name - look for pattern "TRADE - SubCategory"
      const dashIndex = category.name.indexOf(" - ");
      let parentTrade: string;
      
      if (dashIndex > 0) {
        parentTrade = category.name.substring(0, dashIndex).trim();
      } else {
        // No dash, use full name as parent trade
        parentTrade = category.name;
      }
      
      if (!tradeMap.has(parentTrade)) {
        tradeMap.set(parentTrade, []);
      }
      tradeMap.get(parentTrade)!.push(category);
    }
    
    // Convert to array and sort by parent trade name
    return Array.from(tradeMap.entries())
      .map(([parentTrade, subCategories]) => ({
        parentTrade,
        subCategories: subCategories.sort((a, b) => a.displayOrder - b.displayOrder)
      }))
      .sort((a, b) => a.parentTrade.localeCompare(b.parentTrade));
  };

  // Get sub-category label (part after " - " or null if no dash)
  const getSubCategoryLabel = (categoryName: string): string | null => {
    const dashIndex = categoryName.indexOf(" - ");
    if (dashIndex > 0) {
      return categoryName.substring(dashIndex + 3).trim();
    }
    return null;
  };

  // Track collapsed trades (all expanded by default)
  const [collapsedTrades, setCollapsedTrades] = useState<Set<string>>(new Set());
  
  const isTradeExpanded = (tradeName: string) => !collapsedTrades.has(tradeName);
  
  const toggleTrade = (tradeName: string) => {
    setCollapsedTrades(prev => {
      const newSet = new Set(prev);
      if (newSet.has(tradeName)) {
        newSet.delete(tradeName);
      } else {
        newSet.add(tradeName);
      }
      return newSet;
    });
  };
  
  const handleKeyDown = (e: React.KeyboardEvent, tradeName: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleTrade(tradeName);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Settings className="h-6 w-6" />
                Scope Standardization Settings
              </h1>
              {tradeConfig && (
                <Badge 
                  variant="secondary" 
                  className={`text-sm px-3 py-1 ${getTradeTypeBadgeColor(tradeConfig.organization.tradeType)}`}
                  data-testid="badge-scope-trade-type"
                >
                  <Wrench className="h-3 w-3 mr-1" />
                  {tradeConfig.organization.tradeType.replace(/_/g, ' ')}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage standardized work types and modifiers for consistent scope tracking
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="work-types" className="flex items-center gap-2" data-testid="tab-work-types">
            <Layers className="h-4 w-4" />
            Work Types
          </TabsTrigger>
          <TabsTrigger value="modifiers" className="flex items-center gap-2" data-testid="tab-modifiers">
            <Tag className="h-4 w-4" />
            Modifiers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="work-types">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetWorkTypeForm();
                setEditingWorkType(null);
                setShowWorkTypeDialog(true);
              }}
              data-testid="button-add-work-type"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Work Type
            </Button>
          </div>

          {loadingWorkTypes ? (
            <div className="text-center py-8">Loading work types...</div>
          ) : (
            <div className="space-y-4">
              {groupedByTrade().map((group) => (
                <Card key={group.parentTrade} data-testid={`trade-group-${group.parentTrade.toLowerCase().replace(/\s+/g, '-')}`}>
                  <CardHeader 
                    className="py-3 cursor-pointer hover-elevate"
                    onClick={() => toggleTrade(group.parentTrade)}
                    onKeyDown={(e) => handleKeyDown(e, group.parentTrade)}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isTradeExpanded(group.parentTrade)}
                    data-testid={`toggle-trade-${group.parentTrade.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <CardTitle className="text-lg flex items-center gap-2">
                      {isTradeExpanded(group.parentTrade) ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                      {group.parentTrade}
                      <Badge variant="secondary" className="ml-2">
                        {group.subCategories.reduce((sum, cat) => sum + cat.workTypes.length, 0)} items
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  
                  {isTradeExpanded(group.parentTrade) && (
                    <CardContent className="space-y-4">
                      {group.subCategories.map((category) => {
                        const subLabel = getSubCategoryLabel(category.name);
                        return (
                          <div key={category.id} className="space-y-2">
                            {/* Show sub-category label if it exists */}
                            {subLabel && (
                              <h4 className="text-sm font-semibold text-muted-foreground border-b pb-1 mb-2">
                                {subLabel}
                              </h4>
                            )}
                            {category.workTypes.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No work types in this category</p>
                            ) : (
                              <div className="grid gap-2">
                                {category.workTypes.map((workType) => (
                                  <div
                                    key={workType.id}
                                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                                    data-testid={`work-type-item-${workType.id}`}
                                  >
                                    <div className="flex items-center gap-3 flex-wrap">
                                      <span className="font-medium">{workType.name}</span>
                                      <Badge variant="outline">{workType.defaultUnit}</Badge>
                                      {workType.requiresDimensions && (
                                        <Badge variant="secondary">Dimensions Required</Badge>
                                      )}
                                      {workType.isCustom && (
                                        <Badge>Custom</Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleEditWorkType(workType)}
                                        data-testid={`button-edit-work-type-${workType.id}`}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      {workType.isCustom && (
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => deleteWorkTypeMutation.mutate(workType.id)}
                                          data-testid={`button-delete-work-type-${workType.id}`}
                                        >
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="modifiers">
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetModifierForm();
                setEditingModifier(null);
                setShowModifierDialog(true);
              }}
              data-testid="button-add-modifier"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Modifier
            </Button>
          </div>

          {loadingModifiers ? (
            <div className="text-center py-8">Loading modifiers...</div>
          ) : (
            <div className="space-y-4">
              {modifierCategories.map((category) => (
                <Card key={category.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {category.modifiers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No modifiers in this category</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {category.modifiers.map((modifier) => (
                          <div
                            key={modifier.id}
                            className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30"
                            data-testid={`modifier-item-${modifier.id}`}
                          >
                            <span>{modifier.name}</span>
                            {modifier.isCustom && (
                              <Badge variant="secondary" className="text-xs">Custom</Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleEditModifier(modifier)}
                              data-testid={`button-edit-modifier-${modifier.id}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {modifier.isCustom && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => deleteModifierMutation.mutate(modifier.id)}
                                data-testid={`button-delete-modifier-${modifier.id}`}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={showWorkTypeDialog} onOpenChange={setShowWorkTypeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingWorkType ? "Edit Work Type" : "Add New Work Type"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Two-level category selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trade Category</Label>
                <Select
                  value={selectedTrade}
                  onValueChange={handleTradeChange}
                >
                  <SelectTrigger data-testid="select-trade-category">
                    <SelectValue placeholder="Select trade" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableTrades.map((trade) => (
                      <SelectItem key={trade} value={trade}>
                        {trade.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sub-Category</Label>
                <Select
                  value={selectedSubCategory}
                  onValueChange={handleSubCategoryChange}
                  disabled={!selectedTrade}
                >
                  <SelectTrigger data-testid="select-sub-category">
                    <SelectValue placeholder={selectedTrade ? "Select sub-category" : "Select trade first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSubCategories.map((subCat) => (
                      <SelectItem key={subCat} value={subCat}>
                        {subCat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Info message when new category will be created */}
            {selectedTrade && selectedSubCategory && !workTypeForm.categoryId && (
              <div className="p-3 rounded-lg border border-primary/50 bg-primary/10 text-sm">
                <span className="font-medium text-primary">New category will be created:</span>
                <span className="text-muted-foreground ml-1">
                  A new category "{selectedTrade.replace(/_/g, " ")} - {selectedSubCategory}" will be automatically created for this work type.
                </span>
              </div>
            )}
            
            <div>
              <Label>Name</Label>
              <Input
                value={workTypeForm.name}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, name: e.target.value })}
                placeholder="e.g., 6 inch Sidewalk"
                data-testid="input-work-type-name"
              />
            </div>
            <div>
              <Label>Code (unique identifier)</Label>
              <Input
                value={workTypeForm.code}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                placeholder="e.g., sidewalk_6in"
                data-testid="input-work-type-code"
              />
            </div>
            <div>
              <Label>Default Unit</Label>
              <Select
                value={workTypeForm.defaultUnit}
                onValueChange={(value) => setWorkTypeForm({ ...workTypeForm, defaultUnit: value })}
              >
                <SelectTrigger data-testid="select-work-type-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={workTypeForm.requiresDimensions}
                onCheckedChange={(checked) => setWorkTypeForm({ ...workTypeForm, requiresDimensions: checked })}
                data-testid="switch-requires-dimensions"
              />
              <Label>Requires Dimension Inputs</Label>
            </div>
            {workTypeForm.requiresDimensions && (
              <div>
                <Label>Dimension Type</Label>
                <Select
                  value={workTypeForm.dimensionType}
                  onValueChange={(value) => setWorkTypeForm({ ...workTypeForm, dimensionType: value })}
                >
                  <SelectTrigger data-testid="select-dimension-type">
                    <SelectValue placeholder="Select dimension type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="length_width_depth">Length x Width x Depth (Footings)</SelectItem>
                    <SelectItem value="length_height_thickness">Length x Height x Thickness (Walls)</SelectItem>
                    <SelectItem value="length_width_thickness">Length x Width x Thickness (Flatwork)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                value={workTypeForm.displayOrder}
                onChange={(e) => setWorkTypeForm({ ...workTypeForm, displayOrder: parseInt(e.target.value) || 100 })}
                data-testid="input-work-type-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWorkTypeDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveWorkType}
              disabled={(!workTypeForm.categoryId && (!selectedTrade || !selectedSubCategory)) || !workTypeForm.name || !workTypeForm.code}
              data-testid="button-save-work-type"
            >
              {editingWorkType ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showModifierDialog} onOpenChange={setShowModifierDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingModifier ? "Edit Modifier" : "Add New Modifier"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <Select
                value={modifierForm.categoryId}
                onValueChange={(value) => setModifierForm({ ...modifierForm, categoryId: value })}
              >
                <SelectTrigger data-testid="select-modifier-category">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {modifierCategories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={modifierForm.name}
                onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
                placeholder="e.g., Fiber Mesh"
                data-testid="input-modifier-name"
              />
            </div>
            <div>
              <Label>Code (unique identifier)</Label>
              <Input
                value={modifierForm.code}
                onChange={(e) => setModifierForm({ ...modifierForm, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                placeholder="e.g., fiber_mesh"
                data-testid="input-modifier-code"
              />
            </div>
            <div>
              <Label>Display Order</Label>
              <Input
                type="number"
                value={modifierForm.displayOrder}
                onChange={(e) => setModifierForm({ ...modifierForm, displayOrder: parseInt(e.target.value) || 100 })}
                data-testid="input-modifier-order"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModifierDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveModifier}
              disabled={!modifierForm.categoryId || !modifierForm.name || !modifierForm.code}
              data-testid="button-save-modifier"
            >
              {editingModifier ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
