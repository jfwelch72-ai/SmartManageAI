import { logError } from "./utils/logger";
import { safeJsonParse } from "./responseHelper";
import { EstimateLineItem } from "@shared/schema";

/**
 * Material calculator — server-side derivations.
 *
 * Canonical formulas (also covered by `server/__tests__/materialCalculator.test.ts`):
 *
 *   Concrete CY  (slab)   = Quantity_SF × (Depth_in / 12) / 27 × (1 + waste%)
 *   Concrete CY  (linear) = Quantity_LF × (Width_in/12) × (Height_in/12) / 27 × (1 + waste%)
 *   Stone Tons            = Quantity_SF × (Depth_in / 12) / 27 × (1 + waste%) × density(stoneType)
 *                           Densities (t/CY): CRUSHED 1.5 · LIMESTONE 1.35 · COMPACTED_BASE 1.6
 *                                              PEA_GRAVEL 1.42 · RECYCLED_CONCRETE 1.45
 *   Excavation CY         = Volume_CY × (1 + swell%)   (default swell 25%)
 *   Wire Mesh Rolls       = ⌈Quantity_SF × (1 + waste%) / sf_per_roll⌉
 *   Rebar Pieces          = ⌈total_LF / bar_length⌉   where
 *                           total_LF = (⌈√Area / spacingFt⌉ + 1) × √Area × 2 × (1 + waste%)
 *                           — the "+1" accounts for the endpoint bar in each direction.
 *   Dowel Pieces          = ⌈jointLF / spacingFt⌉ + 1 endpoint dowel
 *   Sealer Gallons        = ⌈Quantity_SF × coats × (1 + waste%) / coverage_sf_per_gal⌉
 *   Underlayment SF       = Quantity_SF × (1 + (overlap_in/12) / 10)         ← 10 ft poly rolls
 *                                       × (1 + waste%)
 *
 * Waste-factor handling: every waste/swell input is treated as a percentage
 * (10 → +10%). Only `null`, `undefined`, an empty string, or a non-numeric
 * value falls back to the industry defaults baked into each branch (e.g.
 * 10% concrete waste, 25% excavation swell). An explicit `0` (or `"0"`)
 * is honored as 0% — useful for sanity checks or when the materials are
 * already on hand. See `parseFactor` below.
 */
// Numeric inputs are parsed via `parseNumber` / `parseFactor`, both of which
// accept either a number or a numeric string ("decimal" Drizzle columns are
// returned as strings at runtime, and form fields submit strings too).
type NumericInput = number | string | null;

export interface MaterialCalculationInputs {
  quantity: number;
  unit: string;
  
  concreteDepthInches?: NumericInput;
  dimensionWidthInches?: NumericInput;
  dimensionHeightInches?: NumericInput;
  concreteWasteFactor?: NumericInput;
  
  requiresStoneBase?: boolean | null;
  stoneDepthInches?: NumericInput;
  stoneWasteFactor?: NumericInput;
  stoneType?: string | null;
  
  requiresExcavation?: boolean | null;
  excavationDepthInches?: NumericInput;
  excavationWidthInches?: NumericInput;
  excavationSwellFactor?: NumericInput;
  
  requiresWireMesh?: boolean | null;
  wireMeshCoverageSF?: NumericInput;
  wireMeshWasteFactor?: NumericInput;
  
  requiresRebar?: boolean | null;
  rebarSpacingInches?: NumericInput;
  rebarLengthFeet?: NumericInput;
  rebarWasteFactor?: NumericInput;
  
  requiresDowels?: boolean | null;
  dowelSpacingInches?: NumericInput;
  jointLengthFeet?: NumericInput;
  
  requiresSealer?: boolean | null;
  sealerCoverageSFPerGallon?: NumericInput;
  sealerCoats?: NumericInput;
  sealerWasteFactor?: NumericInput;
  
  requiresUnderlayment?: boolean | null;
  underlaymentOverlapInches?: NumericInput;
  underlaymentWasteFactor?: NumericInput;
}

export interface MaterialCalculationResults {
  calculatedConcreteYards: number | null;
  calculatedStoneTons: number | null;
  calculatedExcavationYards: number | null;
  calculatedWireMeshRolls: number | null;
  calculatedRebarCount: number | null;
  calculatedRebarLinearFeet: number | null;
  calculatedDowelCount: number | null;
  calculatedSealerGallons: number | null;
  calculatedUnderlaymentSF: number | null;
  
  materialRequirements: MaterialRequirement[];
  equipmentRequirements: EquipmentRequirement[];
}

export interface MaterialRequirement {
  category: string;
  item: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface EquipmentRequirement {
  category: string;
  item: string;
  hours: number;
  notes?: string;
}

// Stone densities (tons per cubic yard) — must match the client-side
// `STONE_DENSITIES` map in `client/src/components/MaterialCalculator.tsx`.
// Compacted base is denser than loose crushed stone; pea gravel and recycled
// concrete fall in between. If a stone type isn't recognized we fall back to
// generic crushed stone (1.5 t/yd³).
//
// The constant lives in `shared/materialFormulaBreakdown.ts` so the
// shared "Show Formulas" helper (used by both the client and the PDF
// exporter) and this server-side calculator share the exact same
// numbers. We re-export it here for backward compatibility with
// existing server consumers.
import { STONE_DENSITIES_TONS_PER_CY } from "@shared/materialFormulaBreakdown";
export { STONE_DENSITIES_TONS_PER_CY };
const DEFAULT_STONE_DENSITY = STONE_DENSITIES_TONS_PER_CY.CRUSHED_STONE;

// Standard polyethylene underlayment rolls are 10 ft wide. With a 6"
// side-lap, each pass effectively covers 10 - (overlap/12) feet, so the
// added factor is (overlap/12) / 10. Keep this in sync with
// `calculateUnderlaymentSF` on the client.
const UNDERLAYMENT_ROLL_WIDTH_FT = 10;

function parseNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
}

/**
 * Resolve a waste / swell factor from raw input.
 *
 * Unlike `parseNumber(...) || defaultPercent`, an explicit `0` (or `"0"`)
 * is honored as 0% — only `null`, `undefined`, `""`, or a non-numeric
 * value falls back to the industry default. This makes "0% waste" really
 * mean 0% waste (e.g. for a sanity check or for materials a user already
 * owns) instead of silently reverting to the default.
 */
function parseFactor(value: any, defaultPercent: number): number {
  if (value === null || value === undefined) return defaultPercent;
  if (typeof value === 'string' && value.trim() === '') return defaultPercent;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? defaultPercent : num;
}

export function calculateMaterials(inputs: MaterialCalculationInputs): MaterialCalculationResults {
  const results: MaterialCalculationResults = {
    calculatedConcreteYards: null,
    calculatedStoneTons: null,
    calculatedExcavationYards: null,
    calculatedWireMeshRolls: null,
    calculatedRebarCount: null,
    calculatedRebarLinearFeet: null,
    calculatedDowelCount: null,
    calculatedSealerGallons: null,
    calculatedUnderlaymentSF: null,
    materialRequirements: [],
    equipmentRequirements: [],
  };

  const quantity = parseNumber(inputs.quantity) || 0;
  const unit = (inputs.unit || '').toUpperCase();
  const isSF = unit === 'SF' || unit === 'SQ FT' || unit === 'SQFT';
  const isLF = unit === 'LF' || unit === 'LINEAR FEET' || unit === 'LINEAL FEET';
  
  const concreteDepth = parseNumber(inputs.concreteDepthInches);
  const dimensionWidth = parseNumber(inputs.dimensionWidthInches);
  const dimensionHeight = parseNumber(inputs.dimensionHeightInches);
  const concreteWaste = parseFactor(inputs.concreteWasteFactor, 10);

  if (concreteDepth && concreteDepth > 0) {
    let cubicFeet = 0;
    
    if (isSF && quantity > 0) {
      cubicFeet = quantity * (concreteDepth / 12);
    } else if (isLF && quantity > 0 && dimensionWidth && dimensionHeight) {
      cubicFeet = quantity * (dimensionWidth / 12) * (dimensionHeight / 12);
    }
    
    if (cubicFeet > 0) {
      const cubicYards = cubicFeet / 27;
      const withWaste = cubicYards * (1 + concreteWaste / 100);
      results.calculatedConcreteYards = Math.round(withWaste * 100) / 100;
      
      results.materialRequirements.push({
        category: 'Concrete',
        item: 'Ready Mix Concrete',
        quantity: results.calculatedConcreteYards,
        unit: 'CY',
        notes: `${concreteDepth}" depth with ${concreteWaste}% waste factor`
      });
      
      results.equipmentRequirements.push({
        category: 'Concrete',
        item: 'Concrete Pump or Conveyor',
        hours: Math.ceil(results.calculatedConcreteYards / 15),
        notes: 'For placing concrete'
      });
    }
  }

  if (inputs.requiresStoneBase && isSF && quantity > 0) {
    const stoneDepth = parseNumber(inputs.stoneDepthInches) || 4;
    const stoneWaste = parseFactor(inputs.stoneWasteFactor, 10);
    const stoneType = (inputs.stoneType || '').toString().toUpperCase();
    const density = STONE_DENSITIES_TONS_PER_CY[stoneType] ?? DEFAULT_STONE_DENSITY;

    const cubicFeet = quantity * (stoneDepth / 12);
    const cubicYards = cubicFeet / 27;
    const withWaste = cubicYards * (1 + stoneWaste / 100);
    const tons = withWaste * density;

    results.calculatedStoneTons = Math.round(tons * 100) / 100;

    results.materialRequirements.push({
      category: 'Aggregates',
      item: 'Stone Base',
      quantity: results.calculatedStoneTons,
      unit: 'Tons',
      notes: `${stoneDepth}" depth with ${stoneWaste}% waste factor (${density} t/yd³)`
    });
    
    results.equipmentRequirements.push({
      category: 'Aggregates',
      item: 'Skid Steer / Loader',
      hours: Math.ceil(results.calculatedStoneTons / 20),
      notes: 'For spreading stone base'
    });
  }

  if (inputs.requiresExcavation) {
    const excavationDepth = parseNumber(inputs.excavationDepthInches) || 6;
    const excavationWidth = parseNumber(inputs.excavationWidthInches);
    const swellFactor = parseFactor(inputs.excavationSwellFactor, 25);
    
    let cubicFeet = 0;
    if (isSF && quantity > 0) {
      cubicFeet = quantity * (excavationDepth / 12);
    } else if (isLF && quantity > 0 && excavationWidth) {
      cubicFeet = quantity * (excavationWidth / 12) * (excavationDepth / 12);
    }
    
    if (cubicFeet > 0) {
      const cubicYards = cubicFeet / 27;
      const withSwell = cubicYards * (1 + swellFactor / 100);
      results.calculatedExcavationYards = Math.round(withSwell * 100) / 100;
      
      results.materialRequirements.push({
        category: 'Excavation',
        item: 'Export Material',
        quantity: results.calculatedExcavationYards,
        unit: 'CY',
        notes: `${excavationDepth}" depth with ${swellFactor}% swell factor`
      });
      
      results.equipmentRequirements.push({
        category: 'Excavation',
        item: 'Excavator',
        hours: Math.ceil(results.calculatedExcavationYards / 25),
        notes: 'For excavation work'
      });
    }
  }

  if (inputs.requiresWireMesh && isSF && quantity > 0) {
    const coverageSF = parseNumber(inputs.wireMeshCoverageSF) || 150;
    const wasteFactor = parseFactor(inputs.wireMeshWasteFactor, 10);
    
    const sfWithWaste = quantity * (1 + wasteFactor / 100);
    const rolls = sfWithWaste / coverageSF;
    
    results.calculatedWireMeshRolls = Math.ceil(rolls * 100) / 100;
    
    results.materialRequirements.push({
      category: 'Reinforcement',
      item: 'Wire Mesh',
      quantity: Math.ceil(results.calculatedWireMeshRolls),
      unit: 'Rolls',
      notes: `${coverageSF} SF/roll coverage with ${wasteFactor}% waste`
    });
  }

  if (inputs.requiresRebar && isSF && quantity > 0) {
    const spacingInches = parseNumber(inputs.rebarSpacingInches) || 12;
    const rebarLengthFt = parseNumber(inputs.rebarLengthFeet) || 20;
    const wasteFactor = parseFactor(inputs.rebarWasteFactor, 10);
    
    const spacingFeet = spacingInches / 12;
    const sideA = Math.sqrt(quantity);
    // Bars laid at N inches O.C. across a side of length L need
    // ceil(L / spacing) + 1 bars: one bar at every spacing interval *plus*
    // the bar that sits on the final endpoint. Without the +1 we
    // systematically undercount by ~10% on small slabs (e.g. a 10×10 slab
    // with 12" spacing needs 11 bars, not 10).
    const barsPerDirection = Math.ceil(sideA / spacingFeet) + 1;
    const totalBars = barsPerDirection * 2;

    const linearFeetPerBar = sideA;
    const totalLinearFeet = totalBars * linearFeetPerBar;
    const linearFeetWithWaste = totalLinearFeet * (1 + wasteFactor / 100);
    
    const barsNeeded = Math.ceil(linearFeetWithWaste / rebarLengthFt);
    
    results.calculatedRebarCount = barsNeeded;
    results.calculatedRebarLinearFeet = Math.round(linearFeetWithWaste * 100) / 100;
    
    results.materialRequirements.push({
      category: 'Reinforcement',
      item: 'Rebar',
      quantity: results.calculatedRebarCount,
      unit: 'Pieces',
      notes: `${spacingInches}" O.C. spacing, ${rebarLengthFt}' bars, ${wasteFactor}% waste`
    });
    
    results.materialRequirements.push({
      category: 'Reinforcement',
      item: 'Rebar Chairs',
      quantity: Math.ceil(quantity / 16),
      unit: 'Each',
      notes: 'For rebar support'
    });
  }

  if (inputs.requiresDowels) {
    const spacingInches = parseNumber(inputs.dowelSpacingInches) || 12;
    const jointLengthFt = parseNumber(inputs.jointLengthFeet) || 0;
    
    let totalJointLength = jointLengthFt;
    if (totalJointLength === 0 && isSF && quantity > 0) {
      const sideLength = Math.sqrt(quantity);
      totalJointLength = sideLength * 4;
    }
    
    if (totalJointLength > 0) {
      const spacingFeet = spacingInches / 12;
      // Same endpoint logic as rebar: a 10' joint at 12" O.C. needs 11
      // dowels, not 10. Matches `calculateDowelCount` on the client.
      const count = Math.ceil(totalJointLength / spacingFeet) + 1;

      results.calculatedDowelCount = count;
      
      results.materialRequirements.push({
        category: 'Reinforcement',
        item: 'Dowel Bars',
        quantity: results.calculatedDowelCount,
        unit: 'Each',
        notes: `${spacingInches}" spacing for ${totalJointLength.toFixed(0)} LF of joints`
      });
    }
  }

  if (inputs.requiresSealer && isSF && quantity > 0) {
    const coveragePerGallon = parseNumber(inputs.sealerCoverageSFPerGallon) || 200;
    const coats = parseNumber(inputs.sealerCoats) || 1;
    const wasteFactor = parseFactor(inputs.sealerWasteFactor, 10);
    
    const totalSF = quantity * coats;
    const sfWithWaste = totalSF * (1 + wasteFactor / 100);
    const gallons = sfWithWaste / coveragePerGallon;
    
    results.calculatedSealerGallons = Math.ceil(gallons * 100) / 100;
    
    results.materialRequirements.push({
      category: 'Finishes',
      item: 'Concrete Sealer',
      quantity: Math.ceil(results.calculatedSealerGallons),
      unit: 'Gallons',
      notes: `${coats} coat(s), ${coveragePerGallon} SF/gal coverage, ${wasteFactor}% waste`
    });
    
    results.equipmentRequirements.push({
      category: 'Finishes',
      item: 'Sprayer',
      hours: Math.ceil(quantity / 2000),
      notes: 'For sealer application'
    });
  }

  if (inputs.requiresUnderlayment && isSF && quantity > 0) {
    const overlapInches = parseNumber(inputs.underlaymentOverlapInches) || 6;
    const wasteFactor = parseFactor(inputs.underlaymentWasteFactor, 10);
    
    // Standard 10' polyethylene rolls — overlap factor matches the
    // client's `calculateUnderlaymentSF`. A 6" overlap on a 10' roll
    // yields ~5% extra coverage, not 12.5%.
    const overlapFactor = 1 + ((overlapInches / 12) / UNDERLAYMENT_ROLL_WIDTH_FT);
    const sfWithOverlap = quantity * overlapFactor;
    const sfWithWaste = sfWithOverlap * (1 + wasteFactor / 100);
    
    results.calculatedUnderlaymentSF = Math.round(sfWithWaste * 100) / 100;
    
    results.materialRequirements.push({
      category: 'Vapor Barrier',
      item: 'Plastic Underlayment',
      quantity: Math.ceil(results.calculatedUnderlaymentSF),
      unit: 'SF',
      notes: `${overlapInches}" overlap with ${wasteFactor}% waste`
    });
  }

  return results;
}

export function generateMaterialRequirementsJson(results: MaterialCalculationResults): string {
  return JSON.stringify(results.materialRequirements);
}

export function generateEquipmentRequirementsJson(results: MaterialCalculationResults): string {
  return JSON.stringify(results.equipmentRequirements);
}

export function aggregateMaterialRequirements(lineItems: EstimateLineItem[]): MaterialRequirement[] {
  const aggregated: Map<string, MaterialRequirement> = new Map();
  
  for (const item of lineItems) {
    if (!item.materialRequirementsJson) continue;
    
    try {
      const requirements: MaterialRequirement[] =
        safeJsonParse<MaterialRequirement[]>(item.materialRequirementsJson, []);
      for (const req of requirements) {
        const key = `${req.category}:${req.item}:${req.unit}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.quantity += req.quantity;
        } else {
          aggregated.set(key, { ...req });
        }
      }
    } catch (e) {
      logError('Failed to parse material requirements:', {}, e instanceof Error ? e : new Error(String(e)));
    }
  }
  
  return Array.from(aggregated.values()).sort((a, b) => 
    a.category.localeCompare(b.category) || a.item.localeCompare(b.item)
  );
}

export function aggregateEquipmentRequirements(lineItems: EstimateLineItem[]): EquipmentRequirement[] {
  const aggregated: Map<string, EquipmentRequirement> = new Map();
  
  for (const item of lineItems) {
    if (!item.equipmentRequirementsJson) continue;
    
    try {
      const requirements: EquipmentRequirement[] =
        safeJsonParse<EquipmentRequirement[]>(item.equipmentRequirementsJson, []);
      for (const req of requirements) {
        const key = `${req.category}:${req.item}`;
        const existing = aggregated.get(key);
        if (existing) {
          existing.hours += req.hours;
        } else {
          aggregated.set(key, { ...req });
        }
      }
    } catch (e) {
      logError('Failed to parse equipment requirements:', {}, e instanceof Error ? e : new Error(String(e)));
    }
  }
  
  return Array.from(aggregated.values()).sort((a, b) => 
    a.category.localeCompare(b.category) || a.item.localeCompare(b.item)
  );
}
