import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers, Mountain, Calculator, AlertTriangle, Shovel } from "lucide-react";

// Stone density constants (tons per cubic yard)
const STONE_DENSITIES: Record<string, number> = {
  CRUSHED_STONE: 1.5,
  LIMESTONE: 1.35,
  COMPACTED_BASE: 1.6,
  PEA_GRAVEL: 1.42,
  RECYCLED_CONCRETE: 1.45,
};

const STONE_TYPE_LABELS: Record<string, string> = {
  CRUSHED_STONE: "Crushed Stone",
  LIMESTONE: "Limestone",
  COMPACTED_BASE: "Compacted Base",
  PEA_GRAVEL: "Pea Gravel",
  RECYCLED_CONCRETE: "Recycled Concrete",
};

// Determine if a unit is linear (LF) or area-based (SF)
function isLinearUnit(unit: string): boolean {
  const linearUnits = ["LF", "lf", "LINEAR FEET", "linear feet", "FT", "ft"];
  return linearUnits.some(u => unit.toUpperCase().includes(u.toUpperCase()));
}

function isAreaUnit(unit: string): boolean {
  const areaUnits = ["SF", "sf", "SQUARE FEET", "square feet", "SQ FT", "sq ft", "SY", "sy"];
  return areaUnits.some(u => unit.toUpperCase().includes(u.toUpperCase()));
}

export interface MaterialCalculatorData {
  concreteDepthInches: string;
  dimensionWidthInches: string;
  dimensionHeightInches: string;
  concreteWasteFactor: string;
  calculatedConcreteYards: string;
  requiresStoneBase: boolean;
  stoneType: string;
  stoneDepthInches: string;
  stoneWasteFactor: string;
  calculatedStoneTons: string;
  requiresExcavation: boolean;
  excavationDepthInches: string;
  excavationWidthInches: string;
  excavationSwellFactor: string;
  calculatedExcavationYards: string;
}

interface MaterialCalculatorProps {
  unit: string;
  quantity: number;
  description: string;
  value: MaterialCalculatorData;
  onChange: (data: MaterialCalculatorData) => void;
  readOnly?: boolean;
}

export function calculateConcreteYards(
  quantity: number,
  unit: string,
  depthInches: number,
  widthInches?: number,
  heightInches?: number,
  wasteFactor: number = 10
): number {
  if (!quantity || !depthInches || depthInches <= 0) return 0;

  let cubicFeet: number;

  if (isLinearUnit(unit)) {
    // For linear items (curbs, walls, etc.): LF × width × height
    const widthFeet = (widthInches || 6) / 12; // default 6" width
    const heightFeet = (heightInches || depthInches) / 12; // use depth as height if not specified
    cubicFeet = quantity * widthFeet * heightFeet;
  } else if (isAreaUnit(unit)) {
    // For area items (sidewalks, slabs, etc.): SF × depth
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * depthFeet;
  } else {
    // Default to area calculation
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * depthFeet;
  }

  // Convert to cubic yards
  const cubicYards = cubicFeet / 27;

  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  return Math.ceil(cubicYards * wasteMultiplier * 100) / 100;
}

export function calculateStoneTons(
  quantity: number,
  unit: string,
  depthInches: number,
  stoneType: string,
  widthInches?: number,
  wasteFactor: number = 10
): number {
  if (!quantity || !depthInches || depthInches <= 0) return 0;

  let cubicFeet: number;

  if (isLinearUnit(unit)) {
    // For linear items: LF × width × depth
    const widthFeet = (widthInches || 24) / 12; // default 2' width for base
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * widthFeet * depthFeet;
  } else {
    // For area items: SF × depth
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * depthFeet;
  }

  // Convert to cubic yards
  const cubicYards = cubicFeet / 27;

  // Get density for stone type
  const density = STONE_DENSITIES[stoneType] || 1.5;

  // Calculate tons
  const tons = cubicYards * density;

  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  return Math.ceil(tons * wasteMultiplier * 100) / 100;
}

export function calculateExcavationYards(
  quantity: number,
  unit: string,
  depthInches: number,
  widthInches?: number,
  swellFactor: number = 25
): number {
  if (!quantity || !depthInches || depthInches <= 0) return 0;

  let cubicFeet: number;

  if (isLinearUnit(unit)) {
    // For linear items (trenches, utility lines): LF × width × depth
    const widthFeet = (widthInches || 24) / 12; // default 2' width for trenches
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * widthFeet * depthFeet;
  } else if (isAreaUnit(unit)) {
    // For area items (parking lots, building pads): SF × depth
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * depthFeet;
  } else {
    // Default to area calculation
    const depthFeet = depthInches / 12;
    cubicFeet = quantity * depthFeet;
  }

  // Convert to cubic yards (in-ground volume)
  const cubicYards = cubicFeet / 27;

  // Apply swell factor (soil expands when excavated, typically 20-35%)
  const swellMultiplier = 1 + (swellFactor / 100);
  return Math.ceil(cubicYards * swellMultiplier * 100) / 100;
}

export default function MaterialCalculator({
  unit,
  quantity,
  description,
  value,
  onChange,
  readOnly = false,
}: MaterialCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isLinear = isLinearUnit(unit);
  const isArea = isAreaUnit(unit);

  // Auto-detect if this is a concrete item based on description
  const isConcreteItem = useMemo(() => {
    const concreteKeywords = ["sidewalk", "curb", "gutter", "slab", "foundation", "patio", "driveway", "flatwork", "wall", "footing", "concrete"];
    return concreteKeywords.some(kw => description.toLowerCase().includes(kw));
  }, [description]);

  // Calculate concrete yards
  const concreteYards = useMemo(() => {
    return calculateConcreteYards(
      quantity,
      unit,
      parseFloat(value.concreteDepthInches) || 0,
      parseFloat(value.dimensionWidthInches) || undefined,
      parseFloat(value.dimensionHeightInches) || undefined,
      parseFloat(value.concreteWasteFactor) || 10
    );
  }, [quantity, unit, value.concreteDepthInches, value.dimensionWidthInches, value.dimensionHeightInches, value.concreteWasteFactor]);

  // Calculate stone tons
  const stoneTons = useMemo(() => {
    if (!value.requiresStoneBase) return 0;
    return calculateStoneTons(
      quantity,
      unit,
      parseFloat(value.stoneDepthInches) || 0,
      value.stoneType || "CRUSHED_STONE",
      parseFloat(value.dimensionWidthInches) || undefined,
      parseFloat(value.stoneWasteFactor) || 10
    );
  }, [quantity, unit, value.requiresStoneBase, value.stoneDepthInches, value.stoneType, value.dimensionWidthInches, value.stoneWasteFactor]);

  // Calculate excavation yards
  const excavationYards = useMemo(() => {
    if (!value.requiresExcavation) return 0;
    return calculateExcavationYards(
      quantity,
      unit,
      parseFloat(value.excavationDepthInches) || 0,
      parseFloat(value.excavationWidthInches) || undefined,
      parseFloat(value.excavationSwellFactor) || 25
    );
  }, [quantity, unit, value.requiresExcavation, value.excavationDepthInches, value.excavationWidthInches, value.excavationSwellFactor]);

  // Update calculated values when inputs change
  useEffect(() => {
    const newConcreteYards = concreteYards.toString();
    const newStoneTons = stoneTons.toString();
    const newExcavationYards = excavationYards.toString();
    
    if (
      newConcreteYards !== value.calculatedConcreteYards ||
      newStoneTons !== value.calculatedStoneTons ||
      newExcavationYards !== value.calculatedExcavationYards
    ) {
      onChange({
        ...value,
        calculatedConcreteYards: newConcreteYards,
        calculatedStoneTons: newStoneTons,
        calculatedExcavationYards: newExcavationYards,
      });
    }
  }, [concreteYards, stoneTons, excavationYards]);

  const updateValue = (field: keyof MaterialCalculatorData, newValue: string | boolean) => {
    onChange({
      ...value,
      [field]: newValue,
    });
  };

  if (!isConcreteItem && !value.concreteDepthInches) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid="button-material-calculator-toggle">
        <Calculator className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Material Calculator</span>
        {(concreteYards > 0 || stoneTons > 0 || excavationYards > 0) && (
          <div className="flex flex-wrap gap-2 ml-auto mr-2">
            {concreteYards > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-concrete-yards">
                {concreteYards.toFixed(2)} CY Concrete
              </Badge>
            )}
            {stoneTons > 0 && (
              <Badge variant="outline" className="text-xs" data-testid="badge-stone-tons">
                {stoneTons.toFixed(2)} Tons Stone
              </Badge>
            )}
            {excavationYards > 0 && (
              <Badge variant="outline" className="text-xs bg-orange-500/10 border-orange-500/30" data-testid="badge-excavation-yards">
                {excavationYards.toFixed(2)} CY Excavation
              </Badge>
            )}
          </div>
        )}
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="space-y-4 p-3 bg-muted/30 rounded-md mt-2">
          {/* Concrete Section */}
          <Card className="border-primary/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Concrete Quantity
              </CardTitle>
            </CardHeader>
            <CardContent className="py-2 px-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs">Depth (inches)</Label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={value.concreteDepthInches}
                    onChange={(e) => updateValue("concreteDepthInches", e.target.value)}
                    placeholder="4"
                    disabled={readOnly}
                    data-testid="input-concrete-depth"
                  />
                  <span className="text-xs text-muted-foreground">Common: 4", 6", 8"</span>
                </div>
                
                {isLinear && (
                  <>
                    <div>
                      <Label className="text-xs">Width (inches)</Label>
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        value={value.dimensionWidthInches}
                        onChange={(e) => updateValue("dimensionWidthInches", e.target.value)}
                        placeholder="6"
                        disabled={readOnly}
                        data-testid="input-dimension-width"
                      />
                      <span className="text-xs text-muted-foreground">e.g., curb face</span>
                    </div>
                    <div>
                      <Label className="text-xs">Height (inches)</Label>
                      <Input
                        type="number"
                        step="0.25"
                        min="0"
                        value={value.dimensionHeightInches}
                        onChange={(e) => updateValue("dimensionHeightInches", e.target.value)}
                        placeholder="18"
                        disabled={readOnly}
                        data-testid="input-dimension-height"
                      />
                      <span className="text-xs text-muted-foreground">e.g., curb height</span>
                    </div>
                  </>
                )}
                
                <div>
                  <Label className="text-xs">Waste Factor %</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    max="50"
                    value={value.concreteWasteFactor}
                    onChange={(e) => updateValue("concreteWasteFactor", e.target.value)}
                    placeholder="10"
                    disabled={readOnly}
                    data-testid="input-concrete-waste"
                  />
                  <span className="text-xs text-muted-foreground">Typical: 5-15%</span>
                </div>
              </div>

              {/* Concrete Calculation Result */}
              <div className="flex items-center justify-between p-3 bg-primary/10 rounded-md border border-primary/20">
                <div>
                  <p className="text-xs text-muted-foreground">Calculated Concrete</p>
                  <p className="text-lg font-bold text-primary" data-testid="text-concrete-result">
                    {concreteYards.toFixed(2)} <span className="text-sm font-normal">Cubic Yards</span>
                  </p>
                </div>
                {concreteYards > 0 && (
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Base: {(concreteYards / (1 + parseFloat(value.concreteWasteFactor || "10") / 100)).toFixed(2)} CY</p>
                    <p>+ {value.concreteWasteFactor || "10"}% waste</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stone Sub-Base Section */}
          <Card className="border-amber-500/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mountain className="h-4 w-4" />
                Stone Sub-Base
                <Switch
                  checked={value.requiresStoneBase}
                  onCheckedChange={(checked) => updateValue("requiresStoneBase", checked)}
                  disabled={readOnly}
                  data-testid="switch-stone-base"
                />
              </CardTitle>
            </CardHeader>
            {value.requiresStoneBase && (
              <CardContent className="py-2 px-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Stone Type</Label>
                    <Select
                      value={value.stoneType || "CRUSHED_STONE"}
                      onValueChange={(val) => updateValue("stoneType", val)}
                      disabled={readOnly}
                    >
                      <SelectTrigger data-testid="select-stone-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STONE_TYPE_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label} ({STONE_DENSITIES[key]} t/yd³)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label className="text-xs">Stone Depth (inches)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      value={value.stoneDepthInches}
                      onChange={(e) => updateValue("stoneDepthInches", e.target.value)}
                      placeholder="4"
                      disabled={readOnly}
                      data-testid="input-stone-depth"
                    />
                    <span className="text-xs text-muted-foreground">Common: 4", 6"</span>
                  </div>
                  
                  <div>
                    <Label className="text-xs">Waste Factor %</Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max="50"
                      value={value.stoneWasteFactor}
                      onChange={(e) => updateValue("stoneWasteFactor", e.target.value)}
                      placeholder="10"
                      disabled={readOnly}
                      data-testid="input-stone-waste"
                    />
                    <span className="text-xs text-muted-foreground">Typical: 5-10%</span>
                  </div>
                </div>

                {/* Stone Calculation Result */}
                <div className="flex items-center justify-between p-3 bg-amber-500/10 rounded-md border border-amber-500/20">
                  <div>
                    <p className="text-xs text-muted-foreground">Calculated Stone</p>
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400" data-testid="text-stone-result">
                      {stoneTons.toFixed(2)} <span className="text-sm font-normal">Tons</span>
                    </p>
                  </div>
                  {stoneTons > 0 && (
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Density: {STONE_DENSITIES[value.stoneType || "CRUSHED_STONE"]} t/yd³</p>
                      <p>+ {value.stoneWasteFactor || "10"}% waste</p>
                    </div>
                  )}
                </div>

                {/* Warning for specs */}
                <div className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/30 rounded text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>Verify stone specifications with project engineer. Compaction requirements may affect quantity.</p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Excavation Section */}
          <Card className="border-orange-500/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shovel className="h-4 w-4" />
                Excavation / Material Removal
                <Switch
                  checked={value.requiresExcavation}
                  onCheckedChange={(checked) => updateValue("requiresExcavation", checked)}
                  disabled={readOnly}
                  data-testid="switch-excavation"
                />
              </CardTitle>
            </CardHeader>
            {value.requiresExcavation && (
              <CardContent className="py-2 px-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Excavation Depth (inches)</Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={value.excavationDepthInches}
                      onChange={(e) => updateValue("excavationDepthInches", e.target.value)}
                      placeholder="12"
                      disabled={readOnly}
                      data-testid="input-excavation-depth"
                    />
                    <span className="text-xs text-muted-foreground">Typical: 6"-24"</span>
                  </div>
                  
                  {isLinear && (
                    <div>
                      <Label className="text-xs">Trench Width (inches)</Label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={value.excavationWidthInches}
                        onChange={(e) => updateValue("excavationWidthInches", e.target.value)}
                        placeholder="24"
                        disabled={readOnly}
                        data-testid="input-excavation-width"
                      />
                      <span className="text-xs text-muted-foreground">Typical: 18"-36"</span>
                    </div>
                  )}
                  
                  <div>
                    <Label className="text-xs">Swell Factor %</Label>
                    <Input
                      type="number"
                      step="5"
                      min="0"
                      max="50"
                      value={value.excavationSwellFactor}
                      onChange={(e) => updateValue("excavationSwellFactor", e.target.value)}
                      placeholder="25"
                      disabled={readOnly}
                      data-testid="input-excavation-swell"
                    />
                    <span className="text-xs text-muted-foreground">Soil expansion: 20-35%</span>
                  </div>
                </div>

                {/* Excavation Calculation Result */}
                <div className="flex items-center justify-between p-3 bg-orange-500/10 rounded-md border border-orange-500/20">
                  <div>
                    <p className="text-xs text-muted-foreground">Material to Remove</p>
                    <p className="text-lg font-bold text-orange-600 dark:text-orange-400" data-testid="text-excavation-result">
                      {excavationYards.toFixed(2)} <span className="text-sm font-normal">Cubic Yards</span>
                    </p>
                  </div>
                  {excavationYards > 0 && (
                    <div className="text-right text-xs text-muted-foreground">
                      <p>In-ground: {(excavationYards / (1 + parseFloat(value.excavationSwellFactor || "25") / 100)).toFixed(2)} CY</p>
                      <p>+ {value.excavationSwellFactor || "25"}% swell factor</p>
                    </div>
                  )}
                </div>

                {/* Excavation notes */}
                <div className="flex items-start gap-2 p-2 bg-orange-50 dark:bg-orange-950/30 rounded text-xs text-orange-700 dark:text-orange-300">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>Swell factor accounts for soil expansion when excavated. Clay/dense soils swell more (30-35%). Sandy soils swell less (20-25%).</p>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Job totals component for showing aggregate concrete, stone, and excavation
interface MaterialJobTotalsProps {
  lineItems: Array<{
    calculatedConcreteYards?: string | null;
    calculatedStoneTons?: string | null;
    calculatedExcavationYards?: string | null;
    requiresStoneBase?: boolean | null;
    requiresExcavation?: boolean | null;
  }>;
}

export function MaterialJobTotals({ lineItems }: MaterialJobTotalsProps) {
  const totals = useMemo(() => {
    let totalConcrete = 0;
    let totalStone = 0;
    let totalExcavation = 0;
    let itemsWithConcrete = 0;
    let itemsWithStone = 0;
    let itemsWithExcavation = 0;

    for (const item of lineItems) {
      const concrete = parseFloat(item.calculatedConcreteYards || "0");
      const stone = parseFloat(item.calculatedStoneTons || "0");
      const excavation = parseFloat(item.calculatedExcavationYards || "0");

      if (concrete > 0) {
        totalConcrete += concrete;
        itemsWithConcrete++;
      }
      if (stone > 0 && item.requiresStoneBase) {
        totalStone += stone;
        itemsWithStone++;
      }
      if (excavation > 0 && item.requiresExcavation) {
        totalExcavation += excavation;
        itemsWithExcavation++;
      }
    }

    return {
      totalConcrete: Math.ceil(totalConcrete * 100) / 100,
      totalStone: Math.ceil(totalStone * 100) / 100,
      totalExcavation: Math.ceil(totalExcavation * 100) / 100,
      itemsWithConcrete,
      itemsWithStone,
      itemsWithExcavation,
    };
  }, [lineItems]);

  if (totals.totalConcrete === 0 && totals.totalStone === 0 && totals.totalExcavation === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-dashed" data-testid="card-material-job-totals">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Material Job Totals
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {totals.totalConcrete > 0 && (
            <div className="p-4 bg-primary/10 rounded-lg border border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="h-5 w-5 text-primary" />
                <span className="font-semibold">Total Concrete</span>
              </div>
              <p className="text-3xl font-bold text-primary" data-testid="text-total-concrete">
                {totals.totalConcrete.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">Cubic Yards</p>
              <p className="text-xs text-muted-foreground mt-1">
                From {totals.itemsWithConcrete} line item{totals.itemsWithConcrete !== 1 ? "s" : ""}
              </p>
            </div>
          )}
          
          {totals.totalStone > 0 && (
            <div className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Mountain className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <span className="font-semibold">Total Stone Base</span>
              </div>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-total-stone">
                {totals.totalStone.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">Tons</p>
              <p className="text-xs text-muted-foreground mt-1">
                From {totals.itemsWithStone} line item{totals.itemsWithStone !== 1 ? "s" : ""}
              </p>
            </div>
          )}
          
          {totals.totalExcavation > 0 && (
            <div className="p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Shovel className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                <span className="font-semibold">Total Excavation</span>
              </div>
              <p className="text-3xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-total-excavation">
                {totals.totalExcavation.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">Cubic Yards</p>
              <p className="text-xs text-muted-foreground mt-1">
                From {totals.itemsWithExcavation} line item{totals.itemsWithExcavation !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Default empty value for new line items
export function getDefaultMaterialCalculatorData(): MaterialCalculatorData {
  return {
    concreteDepthInches: "",
    dimensionWidthInches: "",
    dimensionHeightInches: "",
    concreteWasteFactor: "10",
    calculatedConcreteYards: "0",
    requiresStoneBase: false,
    stoneType: "CRUSHED_STONE",
    stoneDepthInches: "",
    stoneWasteFactor: "10",
    calculatedStoneTons: "0",
    requiresExcavation: false,
    excavationDepthInches: "",
    excavationWidthInches: "",
    excavationSwellFactor: "25",
    calculatedExcavationYards: "0",
  };
}
