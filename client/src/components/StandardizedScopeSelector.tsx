import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Layers } from "lucide-react";
import ModifierSelector, { type ModifierSelection } from "@/components/ModifierSelector";

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

interface Dimensions {
  length?: string;
  width?: string;
  depth?: string;
  height?: string;
  thickness?: string;
}

export interface ModifierSelectionSummary {
  modifierId: string;
  modifierName: string;
  modifierCode: string;
  categoryName: string;
  layer: string;
  selectedFactor: number;
  costImpactType: string;
}

export interface ScopeSelectionData {
  workTypeId: string;
  workTypeName: string;
  workTypeCode: string;
  categoryName: string;
  unit: string;
  modifierIds: string[];
  modifierNames: string[];
  modifierSelections?: ModifierSelectionSummary[];
  dimensions?: Dimensions;
  canonicalName: string;
}

interface StandardizedScopeSelectorProps {
  value?: ScopeSelectionData;
  onChange: (data: ScopeSelectionData) => void;
  showDimensionInputs?: boolean;
  lineItemId?: string;
}

export default function StandardizedScopeSelector({
  value,
  onChange,
  showDimensionInputs = true,
  lineItemId,
}: StandardizedScopeSelectorProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState<string>("");
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [selectedModifierNames, setSelectedModifierNames] = useState<string[]>([]);
  const [modifierSelectionsState, setModifierSelectionsState] = useState<ModifierSelection[]>([]);
  const [dimensions, setDimensions] = useState<Dimensions>({});
  
  // Use refs to prevent infinite loops
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedDataRef = useRef<string>("");

  const { data: workTypeCategories = [], isLoading: loadingWorkTypes } = useQuery<WorkTypeCategory[]>({
    queryKey: ["/api/scope/work-types"],
  });

  const selectedCategory = useMemo(() => {
    return workTypeCategories.find((c) => c.id === selectedCategoryId);
  }, [workTypeCategories, selectedCategoryId]);

  const selectedWorkType = useMemo(() => {
    if (!selectedCategory) return null;
    return selectedCategory.workTypes.find((wt) => wt.id === selectedWorkTypeId);
  }, [selectedCategory, selectedWorkTypeId]);

  const selectedModifiers = useMemo(() => {
    return selectedModifierNames.map((name, i) => ({
      id: selectedModifierIds[i] || name,
      categoryId: "",
      name,
      code: "",
      displayOrder: 0,
      isCustom: false,
      isActive: true,
    }));
  }, [selectedModifierIds, selectedModifierNames]);

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
      } else if (selectedWorkType.dimensionType === "length_width_thickness") {
        const parts = [dimensions.length, dimensions.width, dimensions.thickness].filter(Boolean);
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
      if (value.modifierNames) {
        setSelectedModifierNames(value.modifierNames);
      }
      if (value.dimensions) {
        setDimensions(value.dimensions);
      }
    }
  }, [value, workTypeCategories, selectedWorkTypeId]);

  // Build data object for onChange - memoized to avoid recalculation
  const currentData = useMemo((): ScopeSelectionData | null => {
    if (!selectedWorkType) return null;
    return {
      workTypeId: selectedWorkType.id,
      workTypeName: selectedWorkType.name,
      workTypeCode: selectedWorkType.code,
      categoryName: selectedCategory?.name || "",
      unit: selectedWorkType.defaultUnit,
      modifierIds: selectedModifierIds,
      modifierNames: selectedModifiers.map((m) => m.name),
      modifierSelections: modifierSelectionsState.map(s => ({
        modifierId: s.modifierId,
        modifierName: s.modifierName,
        modifierCode: s.modifierCode,
        categoryName: s.categoryName,
        layer: s.layer,
        selectedFactor: s.selectedFactor,
        costImpactType: s.costImpactType,
      })),
      dimensions: selectedWorkType.requiresDimensions ? dimensions : undefined,
      canonicalName,
    };
  }, [selectedWorkType, selectedCategory, selectedModifierIds, selectedModifiers, modifierSelectionsState, dimensions, canonicalName]);
  
  // Only emit onChange when the data actually changes (compare by serialized value)
  useEffect(() => {
    if (currentData) {
      const serialized = JSON.stringify(currentData);
      if (serialized !== lastEmittedDataRef.current) {
        lastEmittedDataRef.current = serialized;
        onChangeRef.current(currentData);
      }
    }
  }, [currentData]);

  const handleCategoryChange = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedWorkTypeId("");
    setSelectedModifierIds([]);
    setSelectedModifierNames([]);
    setModifierSelectionsState([]);
  };

  const handleWorkTypeChange = (workTypeId: string) => {
    setSelectedWorkTypeId(workTypeId);
    setDimensions({});
    setSelectedModifierIds([]);
    setSelectedModifierNames([]);
    setModifierSelectionsState([]);
  };

  const handleModifierSelectionsChange = (selections: ModifierSelection[]) => {
    setSelectedModifierIds(selections.map(s => s.modifierId));
    setSelectedModifierNames(selections.map(s => s.modifierName));
    setModifierSelectionsState(selections);
  };

  if (loadingWorkTypes) {
    return <div className="text-sm text-muted-foreground">Loading scope options...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="mt-[0px] mb-[0px] pt-[5px] pb-[5px]">Work Type Category</Label>
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
            {selectedWorkType.dimensionType === "length_width_thickness" && (
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
          <ModifierSelector
            scopeName={selectedWorkType?.name}
            lineItemId={lineItemId}
            onSelectionsChange={handleModifierSelectionsChange}
          />
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
