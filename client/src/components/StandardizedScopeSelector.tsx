import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers } from "lucide-react";

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

interface WorkTypeCategory {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
  workTypes: WorkType[];
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

interface Dimensions {
  length?: string;
  width?: string;
  depth?: string;
  height?: string;
  thickness?: string;
}

export interface ScopeSelectionData {
  workTypeId: string;
  workTypeName: string;
  workTypeCode: string;
  categoryName: string;
  unit: string;
  modifierIds: string[];
  modifierNames: string[];
  dimensions?: Dimensions;
  canonicalName: string;
}

interface StandardizedScopeSelectorProps {
  value?: ScopeSelectionData;
  onChange: (data: ScopeSelectionData) => void;
  showDimensionInputs?: boolean;
}

export default function StandardizedScopeSelector({
  value,
  onChange,
  showDimensionInputs = true,
}: StandardizedScopeSelectorProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState<string>("");
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<Dimensions>({});
  const [expandedModifierCategories, setExpandedModifierCategories] = useState<string[]>([]);

  const { data: workTypeCategories = [], isLoading: loadingWorkTypes } = useQuery<WorkTypeCategory[]>({
    queryKey: ["/api/scope/work-types"],
  });

  const { data: modifierCategories = [], isLoading: loadingModifiers } = useQuery<ModifierCategory[]>({
    queryKey: ["/api/scope/modifiers"],
  });

  const selectedCategory = useMemo(() => {
    return workTypeCategories.find((c) => c.id === selectedCategoryId);
  }, [workTypeCategories, selectedCategoryId]);

  const selectedWorkType = useMemo(() => {
    if (!selectedCategory) return null;
    return selectedCategory.workTypes.find((wt) => wt.id === selectedWorkTypeId);
  }, [selectedCategory, selectedWorkTypeId]);

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

  const canonicalName = useMemo(() => {
    if (!selectedWorkType) return "";
    let name = selectedWorkType.name;
    if (selectedModifiers.length > 0) {
      name += " - " + selectedModifiers.map((m) => m.name).join(", ");
    }
    if (showDimensionInputs && selectedWorkType.requiresDimensions && dimensions) {
      if (selectedWorkType.dimensionType === "length_width_depth") {
        const parts = [dimensions.length, dimensions.width, dimensions.depth].filter(Boolean);
        if (parts.length > 0) {
          name += ` (${parts.join("' x ")}')`;
        }
      } else if (selectedWorkType.dimensionType === "length_height_thickness") {
        const parts = [dimensions.length, dimensions.height, dimensions.thickness].filter(Boolean);
        if (parts.length > 0) {
          name += ` (${parts.join("' x ")}')`;
        }
      }
    }
    return name;
  }, [selectedWorkType, selectedModifiers, dimensions, showDimensionInputs]);

  useEffect(() => {
    if (value?.workTypeId && workTypeCategories.length > 0 && !selectedWorkTypeId) {
      for (const cat of workTypeCategories) {
        const wt = cat.workTypes.find((w) => w.id === value.workTypeId);
        if (wt) {
          setSelectedCategoryId(cat.id);
          setSelectedWorkTypeId(wt.id);
          break;
        }
      }
      if (value.modifierIds) {
        setSelectedModifierIds(value.modifierIds);
      }
      if (value.dimensions) {
        setDimensions(value.dimensions);
      }
    }
  }, [value, workTypeCategories, selectedWorkTypeId]);

  useEffect(() => {
    if (selectedWorkType) {
      const data: ScopeSelectionData = {
        workTypeId: selectedWorkType.id,
        workTypeName: selectedWorkType.name,
        workTypeCode: selectedWorkType.code,
        categoryName: selectedCategory?.name || "",
        unit: selectedWorkType.defaultUnit,
        modifierIds: selectedModifierIds,
        modifierNames: selectedModifiers.map((m) => m.name),
        dimensions: selectedWorkType.requiresDimensions ? dimensions : undefined,
        canonicalName,
      };
      onChange(data);
    }
  }, [selectedWorkType, selectedCategory, selectedModifierIds, selectedModifiers, dimensions, canonicalName]);

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedWorkTypeId("");
  };

  const handleWorkTypeChange = (workTypeId: string) => {
    setSelectedWorkTypeId(workTypeId);
    setDimensions({});
  };

  const handleModifierToggle = (modifierId: string) => {
    setSelectedModifierIds((prev) =>
      prev.includes(modifierId)
        ? prev.filter((id) => id !== modifierId)
        : [...prev, modifierId]
    );
  };

  const toggleModifierCategory = (categoryId: string) => {
    setExpandedModifierCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  if (loadingWorkTypes || loadingModifiers) {
    return <div className="text-sm text-muted-foreground">Loading scope options...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Work Type Category</Label>
          <Select value={selectedCategoryId} onValueChange={handleCategoryChange}>
            <SelectTrigger data-testid="select-scope-category">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {workTypeCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Work Type</Label>
          <Select
            value={selectedWorkTypeId}
            onValueChange={handleWorkTypeChange}
            disabled={!selectedCategoryId}
          >
            <SelectTrigger data-testid="select-scope-work-type">
              <SelectValue placeholder={selectedCategoryId ? "Select work type" : "Select category first"} />
            </SelectTrigger>
            <SelectContent>
              {selectedCategory?.workTypes.map((wt) => (
                <SelectItem key={wt.id} value={wt.id}>
                  {wt.name} ({wt.defaultUnit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showDimensionInputs && selectedWorkType?.requiresDimensions && (
        <Card>
          <CardContent className="pt-4">
            <Label className="mb-2 block">Dimensions</Label>
            {selectedWorkType.dimensionType === "length_width_depth" && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Length (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Length"
                    value={dimensions.length || ""}
                    onChange={(e) => setDimensions({ ...dimensions, length: e.target.value })}
                    data-testid="input-dimension-length"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Width (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Width"
                    value={dimensions.width || ""}
                    onChange={(e) => setDimensions({ ...dimensions, width: e.target.value })}
                    data-testid="input-dimension-width"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Depth (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Depth"
                    value={dimensions.depth || ""}
                    onChange={(e) => setDimensions({ ...dimensions, depth: e.target.value })}
                    data-testid="input-dimension-depth"
                  />
                </div>
              </div>
            )}
            {selectedWorkType.dimensionType === "length_height_thickness" && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Length (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Length"
                    value={dimensions.length || ""}
                    onChange={(e) => setDimensions({ ...dimensions, length: e.target.value })}
                    data-testid="input-dimension-length"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Height (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Height"
                    value={dimensions.height || ""}
                    onChange={(e) => setDimensions({ ...dimensions, height: e.target.value })}
                    data-testid="input-dimension-height"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Thickness (in)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Thickness"
                    value={dimensions.thickness || ""}
                    onChange={(e) => setDimensions({ ...dimensions, thickness: e.target.value })}
                    data-testid="input-dimension-thickness"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedWorkTypeId && (
        <div>
          <Label className="mb-2 block">Modifiers (Optional)</Label>
          <div className="space-y-2">
            {modifierCategories.map((cat) => (
              <Collapsible
                key={cat.id}
                open={expandedModifierCategories.includes(cat.id)}
                onOpenChange={() => toggleModifierCategory(cat.id)}
              >
                <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-md hover-elevate bg-muted/30 text-sm">
                  <span className="font-medium">{cat.name}</span>
                  <div className="flex items-center gap-2">
                    {cat.modifiers.filter((m) => selectedModifierIds.includes(m.id)).length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {cat.modifiers.filter((m) => selectedModifierIds.includes(m.id)).length} selected
                      </Badge>
                    )}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        expandedModifierCategories.includes(cat.id) ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 pl-2">
                  <div className="flex flex-wrap gap-2">
                    {cat.modifiers.map((mod) => (
                      <div
                        key={mod.id}
                        className="flex items-center gap-2 p-2 rounded-md border bg-background cursor-pointer hover-elevate"
                        onClick={() => handleModifierToggle(mod.id)}
                        data-testid={`modifier-checkbox-${mod.id}`}
                      >
                        <Checkbox
                          checked={selectedModifierIds.includes(mod.id)}
                          onCheckedChange={() => handleModifierToggle(mod.id)}
                        />
                        <span className="text-sm">{mod.name}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      )}

      {canonicalName && (
        <div className="p-3 rounded-lg border bg-muted/30">
          <Label className="text-xs text-muted-foreground">Generated Scope Name</Label>
          <div className="flex items-center gap-2 mt-1">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium" data-testid="text-canonical-scope-name">
              {canonicalName}
            </span>
            {selectedWorkType && (
              <Badge variant="outline" className="ml-auto">
                {selectedWorkType.defaultUnit}
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
