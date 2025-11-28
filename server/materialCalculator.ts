import { EstimateLineItem } from "@shared/schema";

export interface MaterialCalculationInputs {
  quantity: number;
  unit: string;
  
  concreteDepthInches?: number | null;
  dimensionWidthInches?: number | null;
  dimensionHeightInches?: number | null;
  concreteWasteFactor?: number | null;
  
  requiresStoneBase?: boolean | null;
  stoneDepthInches?: number | null;
  stoneWasteFactor?: number | null;
  
  requiresExcavation?: boolean | null;
  excavationDepthInches?: number | null;
  excavationWidthInches?: number | null;
  excavationSwellFactor?: number | null;
  
  requiresWireMesh?: boolean | null;
  wireMeshCoverageSF?: number | null;
  wireMeshWasteFactor?: number | null;
  
  requiresRebar?: boolean | null;
  rebarSpacingInches?: number | null;
  rebarLengthFeet?: number | null;
  rebarWasteFactor?: number | null;
  
  requiresDowels?: boolean | null;
  dowelSpacingInches?: number | null;
  jointLengthFeet?: number | null;
  
  requiresSealer?: boolean | null;
  sealerCoverageSFPerGallon?: number | null;
  sealerCoats?: number | null;
  sealerWasteFactor?: number | null;
  
  requiresUnderlayment?: boolean | null;
  underlaymentOverlapInches?: number | null;
  underlaymentWasteFactor?: number | null;
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

const STONE_DENSITY_TONS_PER_CUBIC_YARD = 1.5;

function parseNumber(value: any): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
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
  const concreteWaste = parseNumber(inputs.concreteWasteFactor) || 10;

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
    const stoneWaste = parseNumber(inputs.stoneWasteFactor) || 10;
    
    const cubicFeet = quantity * (stoneDepth / 12);
    const cubicYards = cubicFeet / 27;
    const withWaste = cubicYards * (1 + stoneWaste / 100);
    const tons = withWaste * STONE_DENSITY_TONS_PER_CUBIC_YARD;
    
    results.calculatedStoneTons = Math.round(tons * 100) / 100;
    
    results.materialRequirements.push({
      category: 'Aggregates',
      item: 'Stone Base',
      quantity: results.calculatedStoneTons,
      unit: 'Tons',
      notes: `${stoneDepth}" depth with ${stoneWaste}% waste factor`
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
    const swellFactor = parseNumber(inputs.excavationSwellFactor) || 25;
    
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
    const wasteFactor = parseNumber(inputs.wireMeshWasteFactor) || 10;
    
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
    const wasteFactor = parseNumber(inputs.rebarWasteFactor) || 10;
    
    const sqFtPerRebar = (spacingInches / 12);
    const sideA = Math.sqrt(quantity);
    const barsInOneDirection = sideA / sqFtPerRebar;
    const totalBars = barsInOneDirection * 2;
    
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
      const dowelsPerFoot = 12 / spacingInches;
      const count = Math.ceil(totalJointLength * dowelsPerFoot);
      
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
    const wasteFactor = parseNumber(inputs.sealerWasteFactor) || 10;
    
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
    const wasteFactor = parseNumber(inputs.underlaymentWasteFactor) || 10;
    
    const overlapFactor = 1 + (overlapInches / 48);
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
      const requirements: MaterialRequirement[] = JSON.parse(item.materialRequirementsJson);
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
      console.error('Failed to parse material requirements:', e);
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
      const requirements: EquipmentRequirement[] = JSON.parse(item.equipmentRequirementsJson);
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
      console.error('Failed to parse equipment requirements:', e);
    }
  }
  
  return Array.from(aggregated.values()).sort((a, b) => 
    a.category.localeCompare(b.category) || a.item.localeCompare(b.item)
  );
}
