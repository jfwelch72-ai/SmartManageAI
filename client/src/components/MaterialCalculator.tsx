import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Layers, Mountain, Calculator, AlertTriangle, Shovel, Grid3X3, Ruler, Droplets, Square } from "lucide-react";

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

// Wire mesh constants
const WIRE_MESH_TYPES: Record<string, { label: string; coverageSF: number }> = {
  "6x6_W1.4": { label: "6x6 W1.4/W1.4 (Light)", coverageSF: 100 },
  "6x6_W2.9": { label: "6x6 W2.9/W2.9 (Medium)", coverageSF: 100 },
  "6x6_W4": { label: "6x6 W4/W4 (Heavy)", coverageSF: 100 },
  "4x4_W2.9": { label: "4x4 W2.9/W2.9 (Extra Heavy)", coverageSF: 100 },
};

// Rebar sizes and properties
const REBAR_SIZES: Record<string, { label: string; lengthFt: number }> = {
  "#3": { label: "#3 (3/8\")", lengthFt: 20 },
  "#4": { label: "#4 (1/2\")", lengthFt: 20 },
  "#5": { label: "#5 (5/8\")", lengthFt: 20 },
  "#6": { label: "#6 (3/4\")", lengthFt: 20 },
};

// Sealer types and coverage rates
const SEALER_TYPES: Record<string, { label: string; coverageSFPerGallon: number }> = {
  CURE_SEAL: { label: "Cure & Seal", coverageSFPerGallon: 200 },
  ACRYLIC: { label: "Acrylic Sealer", coverageSFPerGallon: 250 },
  PENETRATING: { label: "Penetrating Sealer", coverageSFPerGallon: 150 },
  EPOXY: { label: "Epoxy Sealer", coverageSFPerGallon: 100 },
};

// Underlayment types
const UNDERLAYMENT_TYPES: Record<string, { label: string; rollWidthFt: number; rollLengthFt: number }> = {
  "6MIL_POLY": { label: "6 mil Poly (Vapor Barrier)", rollWidthFt: 10, rollLengthFt: 100 },
  "10MIL_POLY": { label: "10 mil Poly (Heavy Duty)", rollWidthFt: 10, rollLengthFt: 100 },
  VISQUEEN: { label: "Visqueen", rollWidthFt: 10, rollLengthFt: 100 },
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
  requiresWireMesh: boolean;
  wireMeshType: string;
  wireMeshWasteFactor: string;
  calculatedWireMeshRolls: string;
  requiresRebar: boolean;
  rebarSize: string;
  rebarSpacingInches: string;
  rebarWasteFactor: string;
  calculatedRebarCount: string;
  calculatedRebarLinearFeet: string;
  requiresDowels: boolean;
  dowelSpacingInches: string;
  jointLengthFeet: string;
  calculatedDowelCount: string;
  requiresSealer: boolean;
  sealerType: string;
  sealerCoats: string;
  sealerWasteFactor: string;
  calculatedSealerGallons: string;
  requiresUnderlayment: boolean;
  underlaymentType: string;
  underlaymentOverlapInches: string;
  underlaymentWasteFactor: string;
  calculatedUnderlaymentSF: string;
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

// Calculate wire mesh rolls needed
export function calculateWireMeshRolls(
  quantity: number,
  unit: string,
  wasteFactor: number = 10,
  coverageSF: number = 100
): number {
  if (!quantity) return 0;
  
  let areaSF: number;
  if (isAreaUnit(unit)) {
    areaSF = quantity;
  } else {
    return 0; // Wire mesh only applies to area-based items
  }
  
  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  const totalSF = areaSF * wasteMultiplier;
  
  // Calculate rolls needed (standard rolls are 100 SF)
  return Math.ceil(totalSF / coverageSF);
}

// Calculate rebar count and linear feet
export function calculateRebar(
  quantity: number,
  unit: string,
  spacingInches: number = 12,
  rebarLengthFeet: number = 20,
  wasteFactor: number = 10
): { count: number; linearFeet: number } {
  if (!quantity || !spacingInches) return { count: 0, linearFeet: 0 };
  
  let areaSF: number;
  if (isAreaUnit(unit)) {
    areaSF = quantity;
  } else if (isLinearUnit(unit)) {
    // For linear items, assume width and calculate area
    areaSF = quantity * 2; // Assume 2' width average
  } else {
    return { count: 0, linearFeet: 0 };
  }
  
  // Calculate grid spacing in feet
  const spacingFeet = spacingInches / 12;
  
  // Calculate side length (assuming square area)
  const sideLength = Math.sqrt(areaSF);
  
  // Calculate number of bars in each direction
  const barsPerDirection = Math.ceil(sideLength / spacingFeet) + 1;
  
  // Total linear feet of rebar (both directions)
  const linearFeetPerDirection = barsPerDirection * sideLength;
  const totalLinearFeet = linearFeetPerDirection * 2;
  
  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  const adjustedLinearFeet = totalLinearFeet * wasteMultiplier;
  
  // Calculate number of bars needed
  const count = Math.ceil(adjustedLinearFeet / rebarLengthFeet);
  
  return {
    count,
    linearFeet: Math.ceil(adjustedLinearFeet * 100) / 100,
  };
}

// Calculate dowel count
export function calculateDowelCount(
  jointLengthFeet: number,
  spacingInches: number = 12
): number {
  if (!jointLengthFeet || !spacingInches) return 0;
  
  const spacingFeet = spacingInches / 12;
  return Math.ceil(jointLengthFeet / spacingFeet) + 1;
}

// Calculate sealer gallons
export function calculateSealerGallons(
  quantity: number,
  unit: string,
  coverageSFPerGallon: number = 200,
  coats: number = 1,
  wasteFactor: number = 10
): number {
  if (!quantity) return 0;
  
  let areaSF: number;
  if (isAreaUnit(unit)) {
    areaSF = quantity;
  } else {
    return 0; // Sealer only applies to area-based items
  }
  
  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  const totalSF = areaSF * wasteMultiplier * coats;
  
  return Math.ceil((totalSF / coverageSFPerGallon) * 100) / 100;
}

// Calculate underlayment SF
export function calculateUnderlaymentSF(
  quantity: number,
  unit: string,
  overlapInches: number = 6,
  wasteFactor: number = 10
): number {
  if (!quantity) return 0;
  
  let areaSF: number;
  if (isAreaUnit(unit)) {
    areaSF = quantity;
  } else {
    return 0; // Underlayment only applies to area-based items
  }
  
  // Calculate overlap factor (typically adds 5-10% for 6" overlap on 10' rolls)
  const overlapFactor = 1 + ((overlapInches / 12) / 10); // ~5% for 6" overlap
  
  // Apply waste factor
  const wasteMultiplier = 1 + (wasteFactor / 100);
  
  return Math.ceil(areaSF * overlapFactor * wasteMultiplier);
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

  // Calculate wire mesh rolls
  const wireMeshRolls = useMemo(() => {
    if (!value.requiresWireMesh) return 0;
    const meshType = WIRE_MESH_TYPES[value.wireMeshType] || WIRE_MESH_TYPES["6x6_W1.4"];
    return calculateWireMeshRolls(
      quantity,
      unit,
      parseFloat(value.wireMeshWasteFactor) || 10,
      meshType.coverageSF
    );
  }, [quantity, unit, value.requiresWireMesh, value.wireMeshType, value.wireMeshWasteFactor]);

  // Calculate rebar
  const rebarCalc = useMemo(() => {
    if (!value.requiresRebar) return { count: 0, linearFeet: 0 };
    const rebarSize = REBAR_SIZES[value.rebarSize] || REBAR_SIZES["#4"];
    return calculateRebar(
      quantity,
      unit,
      parseFloat(value.rebarSpacingInches) || 12,
      rebarSize.lengthFt,
      parseFloat(value.rebarWasteFactor) || 10
    );
  }, [quantity, unit, value.requiresRebar, value.rebarSize, value.rebarSpacingInches, value.rebarWasteFactor]);

  // Calculate dowels
  const dowelCount = useMemo(() => {
    if (!value.requiresDowels) return 0;
    return calculateDowelCount(
      parseFloat(value.jointLengthFeet) || 0,
      parseFloat(value.dowelSpacingInches) || 12
    );
  }, [value.requiresDowels, value.jointLengthFeet, value.dowelSpacingInches]);

  // Calculate sealer
  const sealerGallons = useMemo(() => {
    if (!value.requiresSealer) return 0;
    const sealerType = SEALER_TYPES[value.sealerType] || SEALER_TYPES["CURE_SEAL"];
    return calculateSealerGallons(
      quantity,
      unit,
      sealerType.coverageSFPerGallon,
      parseFloat(value.sealerCoats) || 1,
      parseFloat(value.sealerWasteFactor) || 10
    );
  }, [quantity, unit, value.requiresSealer, value.sealerType, value.sealerCoats, value.sealerWasteFactor]);

  // Calculate underlayment
  const underlaymentSF = useMemo(() => {
    if (!value.requiresUnderlayment) return 0;
    return calculateUnderlaymentSF(
      quantity,
      unit,
      parseFloat(value.underlaymentOverlapInches) || 6,
      parseFloat(value.underlaymentWasteFactor) || 10
    );
  }, [quantity, unit, value.requiresUnderlayment, value.underlaymentOverlapInches, value.underlaymentWasteFactor]);

  // Update calculated values when inputs change
  useEffect(() => {
    const newConcreteYards = concreteYards.toString();
    const newStoneTons = stoneTons.toString();
    const newExcavationYards = excavationYards.toString();
    const newWireMeshRolls = wireMeshRolls.toString();
    const newRebarCount = rebarCalc.count.toString();
    const newRebarLinearFeet = rebarCalc.linearFeet.toString();
    const newDowelCount = dowelCount.toString();
    const newSealerGallons = sealerGallons.toString();
    const newUnderlaymentSF = underlaymentSF.toString();
    
    if (
      newConcreteYards !== value.calculatedConcreteYards ||
      newStoneTons !== value.calculatedStoneTons ||
      newExcavationYards !== value.calculatedExcavationYards ||
      newWireMeshRolls !== value.calculatedWireMeshRolls ||
      newRebarCount !== value.calculatedRebarCount ||
      newRebarLinearFeet !== value.calculatedRebarLinearFeet ||
      newDowelCount !== value.calculatedDowelCount ||
      newSealerGallons !== value.calculatedSealerGallons ||
      newUnderlaymentSF !== value.calculatedUnderlaymentSF
    ) {
      onChange({
        ...value,
        calculatedConcreteYards: newConcreteYards,
        calculatedStoneTons: newStoneTons,
        calculatedExcavationYards: newExcavationYards,
        calculatedWireMeshRolls: newWireMeshRolls,
        calculatedRebarCount: newRebarCount,
        calculatedRebarLinearFeet: newRebarLinearFeet,
        calculatedDowelCount: newDowelCount,
        calculatedSealerGallons: newSealerGallons,
        calculatedUnderlaymentSF: newUnderlaymentSF,
      });
    }
  }, [concreteYards, stoneTons, excavationYards, wireMeshRolls, rebarCalc, dowelCount, sealerGallons, underlaymentSF]);

  const updateValue = (field: keyof MaterialCalculatorData, newValue: string | boolean) => {
    onChange({
      ...value,
      [field]: newValue,
    });
  };

  if (!isConcreteItem && !value.concreteDepthInches) {
    return null;
  }

  // Check if any materials are calculated
  const hasMaterials = concreteYards > 0 || stoneTons > 0 || excavationYards > 0 || 
    wireMeshRolls > 0 || rebarCalc.count > 0 || dowelCount > 0 || 
    sealerGallons > 0 || underlaymentSF > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/50 transition-colors" data-testid="button-material-calculator-toggle">
        <Calculator className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Material Calculator</span>
        {hasMaterials && (
          <div className="flex flex-wrap gap-1 ml-auto mr-2">
            {concreteYards > 0 && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-concrete-yards">
                {concreteYards.toFixed(1)} CY
              </Badge>
            )}
            {stoneTons > 0 && (
              <Badge variant="outline" className="text-xs" data-testid="badge-stone-tons">
                {stoneTons.toFixed(1)}T Stone
              </Badge>
            )}
            {excavationYards > 0 && (
              <Badge variant="outline" className="text-xs bg-orange-500/10 border-orange-500/30" data-testid="badge-excavation-yards">
                {excavationYards.toFixed(1)} CY Exc
              </Badge>
            )}
            {wireMeshRolls > 0 && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 border-blue-500/30" data-testid="badge-wire-mesh">
                {wireMeshRolls} Mesh
              </Badge>
            )}
            {rebarCalc.count > 0 && (
              <Badge variant="outline" className="text-xs bg-purple-500/10 border-purple-500/30" data-testid="badge-rebar">
                {rebarCalc.count} Rebar
              </Badge>
            )}
            {dowelCount > 0 && (
              <Badge variant="outline" className="text-xs bg-gray-500/10 border-gray-500/30" data-testid="badge-dowels">
                {dowelCount} Dowels
              </Badge>
            )}
            {sealerGallons > 0 && (
              <Badge variant="outline" className="text-xs bg-green-500/10 border-green-500/30" data-testid="badge-sealer">
                {sealerGallons.toFixed(1)}gal Seal
              </Badge>
            )}
            {underlaymentSF > 0 && (
              <Badge variant="outline" className="text-xs bg-teal-500/10 border-teal-500/30" data-testid="badge-underlayment">
                {underlaymentSF} SF Poly
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

          {/* Wire Mesh Section - only for area items */}
          {isArea && (
            <Card className="border-blue-500/20">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4" />
                  Wire Mesh Reinforcement
                  <Switch
                    checked={value.requiresWireMesh}
                    onCheckedChange={(checked) => updateValue("requiresWireMesh", checked)}
                    disabled={readOnly}
                    data-testid="switch-wire-mesh"
                  />
                </CardTitle>
              </CardHeader>
              {value.requiresWireMesh && (
                <CardContent className="py-2 px-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Mesh Type</Label>
                      <Select
                        value={value.wireMeshType || "6x6_W1.4"}
                        onValueChange={(val) => updateValue("wireMeshType", val)}
                        disabled={readOnly}
                      >
                        <SelectTrigger data-testid="select-wire-mesh-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(WIRE_MESH_TYPES).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              {config.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Waste Factor %</Label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="30"
                        value={value.wireMeshWasteFactor}
                        onChange={(e) => updateValue("wireMeshWasteFactor", e.target.value)}
                        placeholder="10"
                        disabled={readOnly}
                        data-testid="input-wire-mesh-waste"
                      />
                      <span className="text-xs text-muted-foreground">Typical: 10%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-blue-500/10 rounded-md border border-blue-500/20">
                    <div>
                      <p className="text-xs text-muted-foreground">Wire Mesh Needed</p>
                      <p className="text-lg font-bold text-blue-600 dark:text-blue-400" data-testid="text-wire-mesh-result">
                        {wireMeshRolls} <span className="text-sm font-normal">Rolls (100 SF each)</span>
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Total SF: {(quantity * (1 + parseFloat(value.wireMeshWasteFactor || "10") / 100)).toFixed(0)}</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Rebar Section */}
          <Card className="border-purple-500/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Rebar Reinforcement
                <Switch
                  checked={value.requiresRebar}
                  onCheckedChange={(checked) => updateValue("requiresRebar", checked)}
                  disabled={readOnly}
                  data-testid="switch-rebar"
                />
              </CardTitle>
            </CardHeader>
            {value.requiresRebar && (
              <CardContent className="py-2 px-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Rebar Size</Label>
                    <Select
                      value={value.rebarSize || "#4"}
                      onValueChange={(val) => updateValue("rebarSize", val)}
                      disabled={readOnly}
                    >
                      <SelectTrigger data-testid="select-rebar-size">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(REBAR_SIZES).map(([key, config]) => (
                          <SelectItem key={key} value={key}>
                            {config.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label className="text-xs">Spacing (inches)</Label>
                    <Input
                      type="number"
                      step="1"
                      min="4"
                      max="24"
                      value={value.rebarSpacingInches}
                      onChange={(e) => updateValue("rebarSpacingInches", e.target.value)}
                      placeholder="12"
                      disabled={readOnly}
                      data-testid="input-rebar-spacing"
                    />
                    <span className="text-xs text-muted-foreground">Common: 12", 18"</span>
                  </div>
                  
                  <div>
                    <Label className="text-xs">Waste Factor %</Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max="30"
                      value={value.rebarWasteFactor}
                      onChange={(e) => updateValue("rebarWasteFactor", e.target.value)}
                      placeholder="10"
                      disabled={readOnly}
                      data-testid="input-rebar-waste"
                    />
                    <span className="text-xs text-muted-foreground">Typical: 10%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-purple-500/10 rounded-md border border-purple-500/20">
                  <div>
                    <p className="text-xs text-muted-foreground">Rebar Needed</p>
                    <p className="text-lg font-bold text-purple-600 dark:text-purple-400" data-testid="text-rebar-result">
                      {rebarCalc.count} <span className="text-sm font-normal">Bars ({value.rebarSize || "#4"})</span>
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>Linear Feet: {rebarCalc.linearFeet.toFixed(0)} LF</p>
                    <p>20' bars each</p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Dowels Section */}
          <Card className="border-gray-500/20">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Ruler className="h-4 w-4" />
                Expansion Joint Dowels
                <Switch
                  checked={value.requiresDowels}
                  onCheckedChange={(checked) => updateValue("requiresDowels", checked)}
                  disabled={readOnly}
                  data-testid="switch-dowels"
                />
              </CardTitle>
            </CardHeader>
            {value.requiresDowels && (
              <CardContent className="py-2 px-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Joint Length (feet)</Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={value.jointLengthFeet}
                      onChange={(e) => updateValue("jointLengthFeet", e.target.value)}
                      placeholder="100"
                      disabled={readOnly}
                      data-testid="input-joint-length"
                    />
                    <span className="text-xs text-muted-foreground">Total joint LF</span>
                  </div>
                  
                  <div>
                    <Label className="text-xs">Dowel Spacing (inches)</Label>
                    <Input
                      type="number"
                      step="1"
                      min="6"
                      max="24"
                      value={value.dowelSpacingInches}
                      onChange={(e) => updateValue("dowelSpacingInches", e.target.value)}
                      placeholder="12"
                      disabled={readOnly}
                      data-testid="input-dowel-spacing"
                    />
                    <span className="text-xs text-muted-foreground">Common: 12"</span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 bg-gray-500/10 rounded-md border border-gray-500/20">
                  <div>
                    <p className="text-xs text-muted-foreground">Dowels Needed</p>
                    <p className="text-lg font-bold text-gray-600 dark:text-gray-400" data-testid="text-dowel-result">
                      {dowelCount} <span className="text-sm font-normal">Dowels</span>
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>@ {value.dowelSpacingInches || "12"}" spacing</p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Sealer Section - only for area items */}
          {isArea && (
            <Card className="border-green-500/20">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Droplets className="h-4 w-4" />
                  Sealer / Cure & Seal
                  <Switch
                    checked={value.requiresSealer}
                    onCheckedChange={(checked) => updateValue("requiresSealer", checked)}
                    disabled={readOnly}
                    data-testid="switch-sealer"
                  />
                </CardTitle>
              </CardHeader>
              {value.requiresSealer && (
                <CardContent className="py-2 px-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Sealer Type</Label>
                      <Select
                        value={value.sealerType || "CURE_SEAL"}
                        onValueChange={(val) => updateValue("sealerType", val)}
                        disabled={readOnly}
                      >
                        <SelectTrigger data-testid="select-sealer-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SEALER_TYPES).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              {config.label} ({config.coverageSFPerGallon} SF/gal)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Number of Coats</Label>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        max="3"
                        value={value.sealerCoats}
                        onChange={(e) => updateValue("sealerCoats", e.target.value)}
                        placeholder="1"
                        disabled={readOnly}
                        data-testid="input-sealer-coats"
                      />
                      <span className="text-xs text-muted-foreground">1-2 typical</span>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Waste Factor %</Label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="30"
                        value={value.sealerWasteFactor}
                        onChange={(e) => updateValue("sealerWasteFactor", e.target.value)}
                        placeholder="10"
                        disabled={readOnly}
                        data-testid="input-sealer-waste"
                      />
                      <span className="text-xs text-muted-foreground">Typical: 10%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-md border border-green-500/20">
                    <div>
                      <p className="text-xs text-muted-foreground">Sealer Needed</p>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400" data-testid="text-sealer-result">
                        {sealerGallons.toFixed(1)} <span className="text-sm font-normal">Gallons</span>
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{value.sealerCoats || "1"} coat(s)</p>
                      <p>+ {value.sealerWasteFactor || "10"}% waste</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Underlayment Section - only for area items */}
          {isArea && (
            <Card className="border-teal-500/20">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Square className="h-4 w-4" />
                  Plastic Underlayment / Vapor Barrier
                  <Switch
                    checked={value.requiresUnderlayment}
                    onCheckedChange={(checked) => updateValue("requiresUnderlayment", checked)}
                    disabled={readOnly}
                    data-testid="switch-underlayment"
                  />
                </CardTitle>
              </CardHeader>
              {value.requiresUnderlayment && (
                <CardContent className="py-2 px-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Material Type</Label>
                      <Select
                        value={value.underlaymentType || "6MIL_POLY"}
                        onValueChange={(val) => updateValue("underlaymentType", val)}
                        disabled={readOnly}
                      >
                        <SelectTrigger data-testid="select-underlayment-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(UNDERLAYMENT_TYPES).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                              {config.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Overlap (inches)</Label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="12"
                        value={value.underlaymentOverlapInches}
                        onChange={(e) => updateValue("underlaymentOverlapInches", e.target.value)}
                        placeholder="6"
                        disabled={readOnly}
                        data-testid="input-underlayment-overlap"
                      />
                      <span className="text-xs text-muted-foreground">Typical: 6"</span>
                    </div>
                    
                    <div>
                      <Label className="text-xs">Waste Factor %</Label>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="30"
                        value={value.underlaymentWasteFactor}
                        onChange={(e) => updateValue("underlaymentWasteFactor", e.target.value)}
                        placeholder="10"
                        disabled={readOnly}
                        data-testid="input-underlayment-waste"
                      />
                      <span className="text-xs text-muted-foreground">Typical: 10%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-teal-500/10 rounded-md border border-teal-500/20">
                    <div>
                      <p className="text-xs text-muted-foreground">Underlayment Needed</p>
                      <p className="text-lg font-bold text-teal-600 dark:text-teal-400" data-testid="text-underlayment-result">
                        {underlaymentSF} <span className="text-sm font-normal">Square Feet</span>
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Base: {quantity} SF</p>
                      <p>+ overlap & waste</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}
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
    requiresWireMesh: false,
    wireMeshType: "6x6_W1.4",
    wireMeshWasteFactor: "10",
    calculatedWireMeshRolls: "0",
    requiresRebar: false,
    rebarSize: "#4",
    rebarSpacingInches: "12",
    rebarWasteFactor: "10",
    calculatedRebarCount: "0",
    calculatedRebarLinearFeet: "0",
    requiresDowels: false,
    dowelSpacingInches: "12",
    jointLengthFeet: "",
    calculatedDowelCount: "0",
    requiresSealer: false,
    sealerType: "CURE_SEAL",
    sealerCoats: "1",
    sealerWasteFactor: "10",
    calculatedSealerGallons: "0",
    requiresUnderlayment: false,
    underlaymentType: "6MIL_POLY",
    underlaymentOverlapInches: "6",
    underlaymentWasteFactor: "10",
    calculatedUnderlaymentSF: "0",
  };
}
