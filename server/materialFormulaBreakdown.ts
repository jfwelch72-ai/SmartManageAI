import { STONE_DENSITIES_TONS_PER_CY } from "./materialCalculator";

/**
 * Server-side mirror of the "Show Formulas" panel rendered by
 * `client/src/components/calculators/FormulaBreakdown.tsx` and
 * `client/src/components/MaterialCalculator.tsx`. Used by the estimate
 * PDF exporter so the printable estimate can show the same step-by-step
 * derivations the estimator sees on screen.
 *
 * Numbers and constants come from `server/materialCalculator.ts` (which
 * is also covered by `server/__tests__/materialCalculator.test.ts`) — this
 * file MUST stay in lock-step with that calculator so the PDF and the UI
 * never disagree about a quantity.
 */

export interface FormulaStep {
  label: string;
  value: string;
  calculation?: string;
}

export interface FormulaBlock {
  /** Human-readable section title, e.g. "Concrete (Cubic Yards)". */
  title: string;
  /** The high-level formula string (matches the on-screen calculator). */
  formula: string;
  steps: FormulaStep[];
  /** Final numeric result, formatted by the renderer. */
  result: number;
  resultUnit: string;
}

const STONE_TYPE_LABELS: Record<string, string> = {
  CRUSHED_STONE: "Crushed Stone",
  LIMESTONE: "Limestone",
  COMPACTED_BASE: "Compacted Base",
  PEA_GRAVEL: "Pea Gravel",
  RECYCLED_CONCRETE: "Recycled Concrete",
};

// Standard polyethylene underlayment rolls — match the constant in
// `server/materialCalculator.ts` (`UNDERLAYMENT_ROLL_WIDTH_FT`).
const UNDERLAYMENT_ROLL_WIDTH_FT = 10;

export interface LineItemFormulaInputs {
  quantity: number | string | null | undefined;
  unit: string | null | undefined;

  concreteDepthInches?: number | string | null;
  dimensionWidthInches?: number | string | null;
  dimensionHeightInches?: number | string | null;
  concreteWasteFactor?: number | string | null;
  calculatedConcreteYards?: number | string | null;

  requiresStoneBase?: boolean | null;
  stoneType?: string | null;
  stoneDepthInches?: number | string | null;
  stoneWasteFactor?: number | string | null;
  calculatedStoneTons?: number | string | null;

  requiresExcavation?: boolean | null;
  excavationDepthInches?: number | string | null;
  excavationWidthInches?: number | string | null;
  excavationSwellFactor?: number | string | null;
  calculatedExcavationYards?: number | string | null;

  requiresWireMesh?: boolean | null;
  wireMeshCoverageSF?: number | string | null;
  wireMeshWasteFactor?: number | string | null;
  calculatedWireMeshRolls?: number | string | null;

  requiresRebar?: boolean | null;
  rebarSpacingInches?: number | string | null;
  rebarLengthFeet?: number | string | null;
  rebarWasteFactor?: number | string | null;
  calculatedRebarCount?: number | string | null;
  calculatedRebarLinearFeet?: number | string | null;

  requiresDowels?: boolean | null;
  dowelSpacingInches?: number | string | null;
  jointLengthFeet?: number | string | null;
  calculatedDowelCount?: number | string | null;

  requiresSealer?: boolean | null;
  sealerCoverageSFPerGallon?: number | string | null;
  sealerCoats?: number | string | null;
  sealerWasteFactor?: number | string | null;
  calculatedSealerGallons?: number | string | null;

  requiresUnderlayment?: boolean | null;
  underlaymentOverlapInches?: number | string | null;
  underlaymentWasteFactor?: number | string | null;
  calculatedUnderlaymentSF?: number | string | null;
}

function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isSF(unit: string | null | undefined): boolean {
  const u = (unit || "").toUpperCase();
  return u === "SF" || u === "SQ FT" || u === "SQFT";
}

function isLF(unit: string | null | undefined): boolean {
  const u = (unit || "").toUpperCase();
  return u === "LF" || u === "LINEAR FEET" || u === "LINEAL FEET";
}

function pad2(n: number): string {
  return Math.round(n).toString().padStart(2, "0");
}

function buildConcreteBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  const quantity = num(input.quantity);
  const concreteDepth = num(input.concreteDepthInches, 0);
  if (quantity <= 0 || concreteDepth <= 0) return null;
  const result = num(input.calculatedConcreteYards, 0);
  if (result <= 0) return null;

  const wasteFactor = num(input.concreteWasteFactor, 10);
  const wasteMultiplier = 1 + wasteFactor / 100;
  const linear = isLF(input.unit);

  if (linear) {
    const w = num(input.dimensionWidthInches, 6);
    const h = num(input.dimensionHeightInches, concreteDepth);
    const wFt = w / 12;
    const hFt = h / 12;
    const cuFt = quantity * wFt * hFt;
    const cy = cuFt / 27;
    return {
      title: "Concrete (Cubic Yards) — Linear Section",
      formula: "LF × (Width ÷ 12) × (Height ÷ 12) ÷ 27 × (1 + Waste%)",
      steps: [
        { label: "Quantity (LF)", value: `${quantity} LF` },
        { label: "Width", value: `${w}" (= ${wFt.toFixed(3)} ft)` },
        { label: "Height/Depth", value: `${h}" (= ${hFt.toFixed(3)} ft)` },
        {
          label: "Volume (cubic feet)",
          calculation: `${quantity} × ${wFt.toFixed(3)} × ${hFt.toFixed(3)}`,
          value: `${cuFt.toFixed(2)} cu ft`,
        },
        {
          label: "Convert to cubic yards",
          calculation: "÷ 27",
          value: `${cy.toFixed(3)} CY`,
        },
        {
          label: `Add ${wasteFactor}% waste`,
          calculation: `× 1.${pad2(wasteFactor)}`,
          value: `${result.toFixed(2)} CY`,
        },
      ],
      result,
      resultUnit: "Cubic Yards",
    };
  }

  if (!isSF(input.unit)) return null;
  const dFt = concreteDepth / 12;
  const cuFt = quantity * dFt;
  const cy = cuFt / 27;
  return {
    title: "Concrete (Cubic Yards)",
    formula: "(Quantity × Depth ÷ 12) ÷ 27 × (1 + Waste%)",
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      { label: "Depth", value: `${concreteDepth}"` },
      {
        label: "Depth in feet",
        calculation: `${concreteDepth} ÷ 12`,
        value: `${dFt.toFixed(3)} ft`,
      },
      {
        label: "Volume (cubic feet)",
        calculation: `${quantity} × ${dFt.toFixed(3)}`,
        value: `${cuFt.toFixed(2)} cu ft`,
      },
      {
        label: "Convert to cubic yards",
        calculation: "÷ 27",
        value: `${cy.toFixed(3)} CY`,
      },
      {
        label: `Add ${wasteFactor}% waste`,
        calculation: `× ${wasteMultiplier.toFixed(2)}`,
        value: `${result.toFixed(2)} CY`,
      },
    ],
    result,
    resultUnit: "Cubic Yards",
  };
}

function buildStoneBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresStoneBase) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0 || !isSF(input.unit)) return null;
  const result = num(input.calculatedStoneTons, 0);
  if (result <= 0) return null;

  const stoneDepth = num(input.stoneDepthInches, 4);
  const wasteFactor = num(input.stoneWasteFactor, 10);
  const stoneType = (input.stoneType || "CRUSHED_STONE").toString().toUpperCase();
  const density = STONE_DENSITIES_TONS_PER_CY[stoneType] ?? STONE_DENSITIES_TONS_PER_CY.CRUSHED_STONE;
  const label = STONE_TYPE_LABELS[stoneType] || "Crushed Stone";

  const cuFt = quantity * (stoneDepth / 12);
  const cy = cuFt / 27;
  const tons = cy * density;
  return {
    title: "Stone Sub-Base (Tons)",
    formula: "(SF × Depth ÷ 12) ÷ 27 × Density × (1 + Waste%)",
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      { label: "Depth", value: `${stoneDepth}"` },
      {
        label: "Volume (cubic feet)",
        calculation: `${quantity} × (${stoneDepth} ÷ 12)`,
        value: `${cuFt.toFixed(2)} cu ft`,
      },
      {
        label: "Convert to cubic yards",
        calculation: "÷ 27",
        value: `${cy.toFixed(3)} CY`,
      },
      {
        label: `Apply density (${label})`,
        calculation: `× ${density} t/yd³`,
        value: `${tons.toFixed(2)} tons`,
      },
      {
        label: `Add ${wasteFactor}% waste`,
        calculation: `× 1.${pad2(wasteFactor)}`,
        value: `${result.toFixed(2)} tons`,
      },
    ],
    result,
    resultUnit: "Tons",
  };
}

function buildExcavationBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresExcavation) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0) return null;
  const result = num(input.calculatedExcavationYards, 0);
  if (result <= 0) return null;

  const depth = num(input.excavationDepthInches, 6);
  const swell = num(input.excavationSwellFactor, 25);
  const inGroundCY = result / (1 + swell / 100);
  const linear = isLF(input.unit);

  if (linear) {
    const width = num(input.excavationWidthInches, 24);
    const wFt = width / 12;
    const dFt = depth / 12;
    const cuFt = quantity * wFt * dFt;
    return {
      title: "Excavation (Cubic Yards) — Trench",
      formula: "LF × (Width ÷ 12) × (Depth ÷ 12) ÷ 27 × (1 + Swell%)",
      steps: [
        { label: "Quantity (LF)", value: `${quantity} LF` },
        { label: "Trench Width", value: `${width}" (= ${wFt.toFixed(3)} ft)` },
        { label: "Excavation Depth", value: `${depth}" (= ${dFt.toFixed(3)} ft)` },
        {
          label: "Volume (cubic feet)",
          calculation: `${quantity} × ${wFt.toFixed(3)} × ${dFt.toFixed(3)}`,
          value: `${cuFt.toFixed(2)} cu ft`,
        },
        {
          label: "In-ground volume",
          calculation: "÷ 27",
          value: `${inGroundCY.toFixed(3)} CY`,
        },
        {
          label: `Apply ${swell}% swell factor`,
          calculation: `× 1.${pad2(swell)}`,
          value: `${result.toFixed(2)} CY`,
        },
      ],
      result,
      resultUnit: "Cubic Yards",
    };
  }

  if (!isSF(input.unit)) return null;
  const cuFt = quantity * (depth / 12);
  return {
    title: "Excavation (Cubic Yards)",
    formula: "(SF × Depth ÷ 12) ÷ 27 × (1 + Swell%)",
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      { label: "Excavation Depth", value: `${depth}"` },
      {
        label: "Volume (cubic feet)",
        calculation: `${quantity} × (${depth} ÷ 12)`,
        value: `${cuFt.toFixed(2)} cu ft`,
      },
      {
        label: "In-ground volume",
        calculation: "÷ 27",
        value: `${inGroundCY.toFixed(3)} CY`,
      },
      {
        label: `Apply ${swell}% swell factor`,
        calculation: `× 1.${pad2(swell)}`,
        value: `${result.toFixed(2)} CY`,
      },
    ],
    result,
    resultUnit: "Cubic Yards",
  };
}

function buildWireMeshBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresWireMesh) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0 || !isSF(input.unit)) return null;
  const rolls = num(input.calculatedWireMeshRolls, 0);
  if (rolls <= 0) return null;

  const coverage = num(input.wireMeshCoverageSF, 150);
  const waste = num(input.wireMeshWasteFactor, 10);
  const sfWithWaste = quantity * (1 + waste / 100);

  return {
    title: "Wire Mesh (Rolls)",
    formula: "Quantity × (1 + Waste%) ÷ Coverage SF/roll, rounded up",
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      {
        label: `Add ${waste}% waste`,
        calculation: `${quantity} × ${(1 + waste / 100).toFixed(2)}`,
        value: `${sfWithWaste.toFixed(0)} SF`,
      },
      {
        label: `Convert to rolls (${coverage} SF each)`,
        calculation: `${sfWithWaste.toFixed(0)} ÷ ${coverage}`,
        value: `${(sfWithWaste / coverage).toFixed(2)} rolls`,
      },
      {
        label: "Round up (full rolls only)",
        value: `${Math.ceil(rolls)} rolls`,
      },
    ],
    result: Math.ceil(rolls),
    resultUnit: "Rolls",
  };
}

function buildRebarBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresRebar) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0 || !isSF(input.unit)) return null;
  const count = num(input.calculatedRebarCount, 0);
  if (count <= 0) return null;

  const spacingIn = num(input.rebarSpacingInches, 12);
  const barLength = num(input.rebarLengthFeet, 20);
  const waste = num(input.rebarWasteFactor, 10);
  const sideLength = Math.sqrt(quantity);
  const spacingFt = spacingIn / 12;
  const barsPerDir = Math.ceil(sideLength / spacingFt) + 1;
  const totalLF = barsPerDir * sideLength * 2;
  const lfWithWaste = totalLF * (1 + waste / 100);

  return {
    title: "Rebar (Pieces)",
    formula: "(⌈√Area ÷ Spacing⌉ + 1) × √Area × 2 × (1 + Waste%) ÷ Bar Length",
    steps: [
      { label: "Area (SF)", value: `${quantity} SF` },
      {
        label: "Side length (assume square)",
        calculation: `√${quantity}`,
        value: `${sideLength.toFixed(2)} ft`,
      },
      {
        label: "Spacing in feet",
        calculation: `${spacingIn} ÷ 12`,
        value: `${spacingFt.toFixed(2)} ft`,
      },
      {
        label: "Bars per direction (+1 endpoint)",
        calculation: `⌈${sideLength.toFixed(2)} ÷ ${spacingFt.toFixed(2)}⌉ + 1`,
        value: `${barsPerDir} bars`,
      },
      {
        label: "Total linear feet (both directions)",
        calculation: `${barsPerDir} × ${sideLength.toFixed(2)} × 2`,
        value: `${totalLF.toFixed(0)} LF`,
      },
      {
        label: `Add ${waste}% waste`,
        calculation: `× ${(1 + waste / 100).toFixed(2)}`,
        value: `${lfWithWaste.toFixed(0)} LF`,
      },
      {
        label: `Convert to ${barLength}' bars`,
        calculation: `⌈${lfWithWaste.toFixed(0)} ÷ ${barLength}⌉`,
        value: `${count} bars`,
      },
    ],
    result: count,
    resultUnit: "Bars",
  };
}

function buildDowelBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresDowels) return null;
  const count = num(input.calculatedDowelCount, 0);
  if (count <= 0) return null;

  const spacingIn = num(input.dowelSpacingInches, 12);
  let jointLF = num(input.jointLengthFeet, 0);
  const quantity = num(input.quantity);
  if (jointLF <= 0 && isSF(input.unit) && quantity > 0) {
    jointLF = Math.sqrt(quantity) * 4;
  }
  const spacingFt = spacingIn / 12;

  return {
    title: "Expansion Joint Dowels",
    formula: "⌈Joint LF ÷ (Spacing ÷ 12)⌉ + 1 endpoint dowel",
    steps: [
      { label: "Joint length", value: `${jointLF.toFixed(0)} LF` },
      { label: "Spacing", value: `${spacingIn}"` },
      {
        label: "Spacing in feet",
        calculation: `${spacingIn} ÷ 12`,
        value: `${spacingFt.toFixed(2)} ft`,
      },
      {
        label: "Dowels (+1 endpoint)",
        calculation: `⌈${jointLF.toFixed(0)} ÷ ${spacingFt.toFixed(2)}⌉ + 1`,
        value: `${count} dowels`,
      },
    ],
    result: count,
    resultUnit: "Dowels",
  };
}

function buildSealerBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresSealer) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0 || !isSF(input.unit)) return null;
  const gallons = num(input.calculatedSealerGallons, 0);
  if (gallons <= 0) return null;

  const coverage = num(input.sealerCoverageSFPerGallon, 200);
  const coats = num(input.sealerCoats, 1);
  const waste = num(input.sealerWasteFactor, 10);
  const totalSF = quantity * (1 + waste / 100) * coats;

  return {
    title: "Sealer (Gallons)",
    formula: "Quantity × (1 + Waste%) × Coats ÷ Coverage",
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      { label: "Coats", value: `${coats}` },
      { label: "Coverage per gallon", value: `${coverage} SF/gal` },
      {
        label: `Add ${waste}% waste, multiply by coats`,
        calculation: `${quantity} × ${(1 + waste / 100).toFixed(2)} × ${coats}`,
        value: `${totalSF.toFixed(0)} SF`,
      },
      {
        label: "Convert to gallons",
        calculation: `⌈${totalSF.toFixed(0)} ÷ ${coverage}⌉`,
        value: `${gallons.toFixed(2)} gal`,
      },
    ],
    result: gallons,
    resultUnit: "Gallons",
  };
}

function buildUnderlaymentBlock(input: LineItemFormulaInputs): FormulaBlock | null {
  if (!input.requiresUnderlayment) return null;
  const quantity = num(input.quantity);
  if (quantity <= 0 || !isSF(input.unit)) return null;
  const sf = num(input.calculatedUnderlaymentSF, 0);
  if (sf <= 0) return null;

  const overlap = num(input.underlaymentOverlapInches, 6);
  const waste = num(input.underlaymentWasteFactor, 10);
  const overlapFactor = 1 + (overlap / 12) / UNDERLAYMENT_ROLL_WIDTH_FT;
  const sfWithOverlap = quantity * overlapFactor;

  return {
    title: "Plastic Underlayment (SF)",
    formula: `Quantity × (1 + Overlap÷12÷${UNDERLAYMENT_ROLL_WIDTH_FT}) × (1 + Waste%)`,
    steps: [
      { label: "Quantity (SF)", value: `${quantity} SF` },
      { label: `Overlap (${UNDERLAYMENT_ROLL_WIDTH_FT}' rolls)`, value: `${overlap}"` },
      {
        label: "Overlap factor",
        calculation: `1 + (${overlap}÷12) ÷ ${UNDERLAYMENT_ROLL_WIDTH_FT}`,
        value: overlapFactor.toFixed(4),
      },
      {
        label: "Add overlap",
        calculation: `${quantity} × ${overlapFactor.toFixed(4)}`,
        value: `${sfWithOverlap.toFixed(2)} SF`,
      },
      {
        label: `Add ${waste}% waste`,
        calculation: `× ${(1 + waste / 100).toFixed(2)}`,
        value: `${sf.toFixed(2)} SF`,
      },
    ],
    result: sf,
    resultUnit: "SF",
  };
}

/**
 * Returns one block per active calculator section for a line item, or
 * an empty array if none of the material-calculator switches are
 * populated. Order matches the on-screen MaterialCalculator (concrete,
 * stone, excavation, wire mesh, rebar, dowels, sealer, underlayment).
 */
export function buildLineItemFormulaBreakdowns(
  input: LineItemFormulaInputs,
): FormulaBlock[] {
  const blocks: FormulaBlock[] = [];
  const builders = [
    buildConcreteBlock,
    buildStoneBlock,
    buildExcavationBlock,
    buildWireMeshBlock,
    buildRebarBlock,
    buildDowelBlock,
    buildSealerBlock,
    buildUnderlaymentBlock,
  ];
  for (const builder of builders) {
    const block = builder(input);
    if (block) blocks.push(block);
  }
  return blocks;
}
