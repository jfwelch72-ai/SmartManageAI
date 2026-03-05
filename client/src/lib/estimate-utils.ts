import { z } from "zod";
import type { MaterialCalculatorData } from "@/components/MaterialCalculator";

export const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  quantity: z.coerce.number().min(0, "Quantity must be positive"),
  materialCost: z.coerce.number().min(0).default(0),
  laborCost: z.coerce.number().min(0).default(0),
  laborHours: z.coerce.number().min(0).default(0),
  jobClassificationId: z.string().optional(),
  laborRateUsed: z.coerce.number().min(0).optional(),
  equipmentHours: z.coerce.number().min(0).default(0),
  equipmentCost: z.coerce.number().min(0).default(0),
  equipmentSource: z.enum(["OWNED", "RENTAL", "MANUAL"]).optional(),
  selectedEquipmentId: z.string().optional(),
  equipmentRateUsed: z.coerce.number().min(0).optional(),
  consumablesCost: z.coerce.number().min(0).default(0),
  subcontractCost: z.coerce.number().min(0).default(0),
  subcontractorQuoteId: z.string().optional(),
  overheadAllocation: z.coerce.number().min(0).default(0),
  profitAllocation: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
  scopeWorkTypeId: z.string().optional(),
});

export type LineItemFormValues = z.infer<typeof lineItemSchema>;

export type CatalogPriceItem = {
  id: string;
  itemName: string;
  itemCode: string | null;
  category: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  minimumOrder: number | null;
  deliveryFee: string | null;
  effectiveQuarter: string;
  leadTimeDays: number | null;
  vendorId: string;
  vendorName: string;
  vendorType: string;
};

export type WorkCategoryItem = {
  id: string;
  name: string;
  code: string;
  unit: string | null;
  description: string | null;
};

export type WorkCategory = {
  value: string;
  label: string;
  itemCount: number;
  isDefault?: boolean;
  items: WorkCategoryItem[];
};

export function buildMaterialCalculatorPayload(data: MaterialCalculatorData) {
  return {
    concreteDepthInches: data.concreteDepthInches || undefined,
    dimensionWidthInches: data.dimensionWidthInches || undefined,
    dimensionHeightInches: data.dimensionHeightInches || undefined,
    concreteWasteFactor: data.concreteWasteFactor || "10",
    calculatedConcreteYards: data.calculatedConcreteYards || undefined,
    requiresStoneBase: data.requiresStoneBase || false,
    stoneType: data.requiresStoneBase ? (data.stoneType || "CRUSHED_STONE") : undefined,
    stoneSize: data.requiresStoneBase ? (data.stoneSize || "#57") : undefined,
    stoneDepthInches: data.requiresStoneBase ? (data.stoneDepthInches || undefined) : undefined,
    stoneWasteFactor: data.requiresStoneBase ? (data.stoneWasteFactor || "10") : undefined,
    calculatedStoneTons: data.requiresStoneBase ? (data.calculatedStoneTons || undefined) : undefined,
    requiresExcavation: data.requiresExcavation || false,
    excavationDepthInches: data.requiresExcavation ? (data.excavationDepthInches || undefined) : undefined,
    excavationWidthInches: data.requiresExcavation ? (data.excavationWidthInches || undefined) : undefined,
    excavationSwellFactor: data.requiresExcavation ? (data.excavationSwellFactor || "25") : undefined,
    calculatedExcavationYards: data.requiresExcavation ? (data.calculatedExcavationYards || undefined) : undefined,
    requiresWireMesh: data.requiresWireMesh || false,
    wireMeshType: data.requiresWireMesh ? (data.wireMeshType || "6x6_W1.4") : undefined,
    wireMeshWasteFactor: data.requiresWireMesh ? (data.wireMeshWasteFactor || "10") : undefined,
    calculatedWireMeshRolls: data.requiresWireMesh ? (data.calculatedWireMeshRolls || undefined) : undefined,
    requiresRebar: data.requiresRebar || false,
    rebarSize: data.requiresRebar ? (data.rebarSize || "#4") : undefined,
    rebarFabType: data.requiresRebar ? (data.rebarFabType || "FIELD_TIED") : undefined,
    rebarSpacingInches: data.requiresRebar ? (data.rebarSpacingInches || "12") : undefined,
    rebarWasteFactor: data.requiresRebar ? (data.rebarWasteFactor || "10") : undefined,
    calculatedRebarCount: data.requiresRebar ? (data.calculatedRebarCount || undefined) : undefined,
    calculatedRebarLinearFeet: data.requiresRebar ? (data.calculatedRebarLinearFeet || undefined) : undefined,
    requiresDowels: data.requiresDowels || false,
    dowelSpacingInches: data.requiresDowels ? (data.dowelSpacingInches || "12") : undefined,
    jointLengthFeet: data.requiresDowels ? (data.jointLengthFeet || undefined) : undefined,
    calculatedDowelCount: data.requiresDowels ? (data.calculatedDowelCount || undefined) : undefined,
    requiresSealer: data.requiresSealer || false,
    sealerType: data.requiresSealer ? (data.sealerType || "CURE_SEAL") : undefined,
    sealerCoats: data.requiresSealer ? (data.sealerCoats || "1") : undefined,
    sealerWasteFactor: data.requiresSealer ? (data.sealerWasteFactor || "10") : undefined,
    calculatedSealerGallons: data.requiresSealer ? (data.calculatedSealerGallons || undefined) : undefined,
    requiresUnderlayment: data.requiresUnderlayment || false,
    underlaymentType: data.requiresUnderlayment ? (data.underlaymentType || "6MIL_POLY") : undefined,
    underlaymentOverlapInches: data.requiresUnderlayment ? (data.underlaymentOverlapInches || "6") : undefined,
    underlaymentWasteFactor: data.requiresUnderlayment ? (data.underlaymentWasteFactor || "10") : undefined,
    calculatedUnderlaymentSF: data.requiresUnderlayment ? (data.calculatedUnderlaymentSF || undefined) : undefined,
  };
}

export function normalizeUnit(unit: string): string {
  const normalized = (unit || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const unitMap: Record<string, string> = {
    "CY": "CY", "CUBICYARD": "CY", "CUBICYARDS": "CY", "YARD": "CY", "YARDS": "CY", 
    "YD": "CY", "YDS": "CY", "CUYD": "CY", "CUYDS": "CY", "CUBYD": "CY", "CUBYDS": "CY",
    "CUBICYD": "CY", "CUBICYDS": "CY", "CUD": "CY", "CUDS": "CY", "YARDCUBIC": "CY",
    "TON": "TON", "TONS": "TON", "TN": "TON", "TNS": "TON",
    "ROLL": "ROLL", "ROLLS": "ROLL", "RL": "ROLL", "RLS": "ROLL",
    "EA": "EA", "EACH": "EA", "PC": "EA", "PCS": "EA", "PIECE": "EA", "PIECES": "EA", 
    "BAR": "EA", "BARS": "EA", "UNIT": "EA", "UNITS": "EA",
    "LF": "LF", "LINEARFOOT": "LF", "LINEARFEET": "LF", "FT": "LF", "FEET": "LF", "FOOT": "LF",
    "LINFT": "LF", "LINFOOT": "LF", "LINFEET": "LF",
    "GAL": "GAL", "GALLON": "GAL", "GALLONS": "GAL", "GALS": "GAL",
    "DOWEL": "DOWEL", "DOWELS": "DOWEL",
    "SF": "SF", "SQFT": "SF", "SQUAREFOOT": "SF", "SQUAREFEET": "SF", "SQF": "SF",
  };
  
  if (unitMap[normalized]) {
    return unitMap[normalized];
  }
  
  if ((normalized.startsWith("CU") || normalized.startsWith("CUBIC")) && 
      (normalized.endsWith("Y") || normalized.endsWith("YD") || normalized.endsWith("YDS") || normalized.endsWith("YARD") || normalized.endsWith("YARDS"))) {
    return "CY";
  }
  if ((normalized.startsWith("SQ") || normalized.startsWith("SQUARE")) && 
      (normalized.endsWith("F") || normalized.endsWith("FT") || normalized.endsWith("FOOT") || normalized.endsWith("FEET"))) {
    return "SF";
  }
  if (normalized.startsWith("LIN") && 
      (normalized.endsWith("F") || normalized.endsWith("FT") || normalized.endsWith("FOOT") || normalized.endsWith("FEET"))) {
    return "LF";
  }
  
  return normalized;
}

export function detectMaterialTypeFromName(itemName: string): string | null {
  const name = (itemName || "").toLowerCase();
  if (name.includes("dowel")) return "dowels";
  if (name.includes("rebar") || name.includes("re-bar") || name.includes("reinforcing bar")) return "rebar";
  if (name.includes("excavat") || name.includes("haul") || name.includes("backfill") || name.includes("dirt") || name.includes("soil")) return "excavation";
  if (name.includes("concrete") || name.includes("readymix") || name.includes("ready-mix") || name.includes("ready mix")) return "concrete";
  if (name.includes("stone") || name.includes("gravel") || name.includes("aggregate") || name.includes("base")) return "stone";
  if (name.includes("mesh") || name.includes("wire")) return "wireMesh";
  if (name.includes("sealer") || name.includes("seal")) return "sealer";
  if (name.includes("underlayment") || name.includes("vapor barrier") || name.includes("membrane")) return "underlayment";
  return null;
}

export const LINE_ITEM_DEFAULT_VALUES: LineItemFormValues = {
  description: "",
  category: "",
  unit: "",
  quantity: 0,
  materialCost: 0,
  laborCost: 0,
  laborHours: 0,
  jobClassificationId: undefined,
  laborRateUsed: undefined,
  equipmentHours: 0,
  equipmentCost: 0,
  equipmentSource: undefined,
  selectedEquipmentId: undefined,
  equipmentRateUsed: undefined,
  consumablesCost: 0,
  subcontractCost: 0,
  overheadAllocation: 0,
  profitAllocation: 0,
  notes: "",
  scopeWorkTypeId: undefined,
};
