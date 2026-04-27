/**
 * Trade-Specific Material Calculators
 * Comprehensive calculation engine for all 19 CSI construction trades
 * All formulas use industry-standard conversion factors and safety margins
 */

// ============================================
// UNIT CONVERSION CONSTANTS
// ============================================
const CONVERSIONS = {
  SF_PER_SY: 9,
  CF_PER_CY: 27,
  INCHES_PER_FOOT: 12,
  LF_PER_MILE: 5280,
  SQ_PER_100SF: 100,
  TONS_PER_CY_SOIL: 1.4,
  TONS_PER_CY_STONE: 1.5,
  TONS_PER_CY_ASPHALT: 2.025,
  TONS_PER_CY_CONCRETE: 2.0,
  GAL_PER_LB: 0.12,
  REBAR_OVERLAP_FACTOR: 1.1,
};

// ============================================
// WASTE/SAFETY FACTORS BY TRADE
// ============================================
const WASTE_FACTORS = {
  concrete: 0.10,
  rebar: 0.10,
  wireMesh: 0.10,
  stone: 0.10,
  excavation: 0.25, // Swell factor
  asphalt: 0.05,
  roofing: 0.10,
  framing: 0.10,
  drywall: 0.10,
  insulation: 0.05,
  flooring: 0.10,
  paint: 0.10,
  masonry: 0.05,
  electrical: 0.10,
  plumbing: 0.10,
  hvac: 0.10,
  landscaping: 0.10,
  fireProtection: 0.05,
  lowVoltage: 0.15,
};

// ============================================
// NUMERIC HELPERS
// ============================================

/**
 * Ceil with floating-point epsilon tolerance.
 *
 * IEEE-754 makes products like `100 * 1.10` slightly larger than `110`
 * (e.g. `110.00000000000001`), so a naive `Math.ceil` over-rounds clean
 * round-number inputs by one whole unit. We snap the value to 9 decimal
 * places of precision before ceiling, which absorbs the FP noise without
 * affecting genuinely fractional values.
 */
export function ceilWithEpsilon(value: number): number {
  return Math.ceil(Math.round(value * 1e9) / 1e9);
}

// ============================================
// INPUT VALIDATION HELPERS
// ============================================
export function validatePositive(value: number, name: string): void {
  if (value <= 0) {
    throw new Error(`${name} must be greater than zero. Received: ${value}`);
  }
}

export function validateNonNegative(value: number, name: string): void {
  if (value < 0) {
    throw new Error(`${name} cannot be negative. Received: ${value}`);
  }
}

export function validateRange(value: number, min: number, max: number, name: string): void {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}. Received: ${value}`);
  }
}

// ============================================
// CONCRETE TRADE CALCULATORS (CSI 03)
// ============================================

export interface ConcreteSlabInput {
  areaSF: number;
  thicknessInches: number;
  wasteFactor?: number;
}

export interface ConcreteFootingInput {
  lengthLF: number;
  widthInches: number;
  depthInches: number;
  wasteFactor?: number;
}

export interface ConcreteWallInput {
  lengthLF: number;
  heightFeet: number;
  thicknessInches: number;
  wasteFactor?: number;
}

/**
 * Calculate concrete volume for slabs
 * Formula: (Area SF × Thickness in) / 12 / 27 × (1 + waste)
 */
export function calculateConcreteSlabCY(input: ConcreteSlabInput): number {
  validatePositive(input.areaSF, 'Area SF');
  validatePositive(input.thicknessInches, 'Thickness');
  validateRange(input.thicknessInches, 1, 36, 'Thickness inches');
  
  const waste = input.wasteFactor ?? WASTE_FACTORS.concrete;
  const cubicFeet = input.areaSF * (input.thicknessInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withWaste = cubicYards * (1 + waste);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate concrete volume for footings
 * Formula: (Length LF × Width in × Depth in) / 144 / 27 × (1 + waste)
 */
export function calculateConcreteFootingCY(input: ConcreteFootingInput): number {
  validatePositive(input.lengthLF, 'Length LF');
  validatePositive(input.widthInches, 'Width');
  validatePositive(input.depthInches, 'Depth');
  validateRange(input.widthInches, 6, 96, 'Width inches');
  validateRange(input.depthInches, 6, 48, 'Depth inches');
  
  const waste = input.wasteFactor ?? WASTE_FACTORS.concrete;
  const cubicFeet = input.lengthLF * (input.widthInches / CONVERSIONS.INCHES_PER_FOOT) * (input.depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withWaste = cubicYards * (1 + waste);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate concrete volume for walls
 * Formula: (Length LF × Height FT × Thickness in) / 12 / 27 × (1 + waste)
 */
export function calculateConcreteWallCY(input: ConcreteWallInput): number {
  validatePositive(input.lengthLF, 'Length LF');
  validatePositive(input.heightFeet, 'Height');
  validatePositive(input.thicknessInches, 'Thickness');
  
  const waste = input.wasteFactor ?? WASTE_FACTORS.concrete;
  const cubicFeet = input.lengthLF * input.heightFeet * (input.thicknessInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withWaste = cubicYards * (1 + waste);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate rebar quantity
 * Formula: (Area SF / spacing^2) × 2 directions × bar length / 20ft bars × overlap factor
 */
export function calculateRebarPieces(areaSF: number, spacingInches: number, barLengthFeet: number = 20): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(spacingInches, 'Spacing');
  validateRange(spacingInches, 4, 24, 'Spacing inches');
  
  const spacingFeet = spacingInches / CONVERSIONS.INCHES_PER_FOOT;
  const sideLength = Math.sqrt(areaSF);
  const barsPerDirection = Math.ceil(sideLength / spacingFeet) + 1;
  const totalLinearFeet = barsPerDirection * 2 * sideLength * CONVERSIONS.REBAR_OVERLAP_FACTOR;
  const barsNeeded = Math.ceil(totalLinearFeet / barLengthFeet);
  
  return Math.ceil(barsNeeded * (1 + WASTE_FACTORS.rebar));
}

/**
 * Calculate wire mesh rolls
 * Formula: Area SF × (1 + waste) / SF per roll
 */
export function calculateWireMeshRolls(areaSF: number, sfPerRoll: number = 150): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sfPerRoll, 'SF per roll');
  
  const sfWithWaste = areaSF * (1 + WASTE_FACTORS.wireMesh);
  return Math.ceil(sfWithWaste / sfPerRoll);
}

// ============================================
// EARTHWORK TRADE CALCULATORS (CSI 31)
// ============================================

export interface ExcavationInput {
  areaSF: number;
  depthInches: number;
  swellFactor?: number;
}

export interface TrenchExcavationInput {
  lengthLF: number;
  widthInches: number;
  depthInches: number;
  swellFactor?: number;
}

/**
 * Calculate excavation volume with swell factor
 * Formula: (Area SF × Depth in) / 12 / 27 × (1 + swell)
 */
export function calculateExcavationCY(input: ExcavationInput): number {
  validatePositive(input.areaSF, 'Area SF');
  validatePositive(input.depthInches, 'Depth');
  
  const swell = input.swellFactor ?? WASTE_FACTORS.excavation;
  const cubicFeet = input.areaSF * (input.depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withSwell = cubicYards * (1 + swell);
  
  return Math.round(withSwell * 100) / 100;
}

/**
 * Calculate trench excavation volume
 * Formula: (Length LF × Width in × Depth in) / 144 / 27 × (1 + swell)
 */
export function calculateTrenchExcavationCY(input: TrenchExcavationInput): number {
  validatePositive(input.lengthLF, 'Length LF');
  validatePositive(input.widthInches, 'Width');
  validatePositive(input.depthInches, 'Depth');
  
  const swell = input.swellFactor ?? WASTE_FACTORS.excavation;
  const cubicFeet = input.lengthLF * (input.widthInches / CONVERSIONS.INCHES_PER_FOOT) * (input.depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withSwell = cubicYards * (1 + swell);
  
  return Math.round(withSwell * 100) / 100;
}

/**
 * Calculate stone base tons
 * Formula: (Area SF × Depth in) / 12 / 27 × 1.5 tons/CY × (1 + waste)
 */
export function calculateStoneBaseTons(areaSF: number, depthInches: number, wasteFactor?: number): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(depthInches, 'Depth');
  
  const waste = wasteFactor ?? WASTE_FACTORS.stone;
  const cubicFeet = areaSF * (depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withWaste = cubicYards * (1 + waste);
  const tons = withWaste * CONVERSIONS.TONS_PER_CY_STONE;
  
  return Math.round(tons * 100) / 100;
}

/**
 * Calculate fill/backfill volume
 */
export function calculateFillCY(areaSF: number, depthInches: number, compactionFactor: number = 1.15): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(depthInches, 'Depth');
  
  const cubicFeet = areaSF * (depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const withCompaction = cubicYards * compactionFactor;
  
  return Math.round(withCompaction * 100) / 100;
}

// ============================================
// ASPHALT/PAVING TRADE CALCULATORS (CSI 32)
// ============================================

export interface AsphaltInput {
  areaSF: number;
  thicknessInches: number;
  wasteFactor?: number;
}

/**
 * Calculate asphalt tonnage
 * Formula: (Area SF × Thickness in) / 12 / 27 × 2.025 tons/CY × (1 + waste)
 * Industry standard: 2.025 tons per cubic yard for HMA
 */
export function calculateAsphaltTons(input: AsphaltInput): number {
  validatePositive(input.areaSF, 'Area SF');
  validatePositive(input.thicknessInches, 'Thickness');
  validateRange(input.thicknessInches, 1, 12, 'Thickness inches');
  
  const waste = input.wasteFactor ?? WASTE_FACTORS.asphalt;
  const cubicFeet = input.areaSF * (input.thicknessInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  const tons = cubicYards * CONVERSIONS.TONS_PER_CY_ASPHALT;
  const withWaste = tons * (1 + waste);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate striping paint gallons
 * Formula: Linear feet / coverage rate per gallon
 */
export function calculateStripingGallons(linearFeet: number, coverageLFPerGallon: number = 400): number {
  validatePositive(linearFeet, 'Linear feet');
  validatePositive(coverageLFPerGallon, 'Coverage rate');
  
  const gallons = linearFeet / coverageLFPerGallon;
  return Math.ceil(gallons * (1 + WASTE_FACTORS.paint));
}

/**
 * Calculate sealcoating gallons
 * Formula: Area SF / coverage rate × number of coats × (1 + waste)
 */
export function calculateSealcoatGallons(areaSF: number, coverageSFPerGallon: number = 60, coats: number = 2): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(coverageSFPerGallon, 'Coverage rate');
  validateRange(coats, 1, 4, 'Number of coats');
  
  const totalSF = areaSF * coats;
  const gallons = totalSF / coverageSFPerGallon;
  return Math.ceil(gallons * (1 + WASTE_FACTORS.asphalt));
}

// ============================================
// ROOFING TRADE CALCULATORS (CSI 07)
// ============================================

export interface RoofingAreaInput {
  footprintSF: number;
  pitchRise: number; // Rise per 12" run
}

export interface RoofingCoatingInput {
  areaSF: number;
  milThickness: number;
  wasteFactor?: number;
}

/**
 * Calculate roofing squares from footprint with pitch adjustment
 * Formula: Footprint SF × pitch multiplier / 100
 * Pitch multipliers: flat=1.0, 4/12=1.054, 6/12=1.118, 8/12=1.202, 10/12=1.302, 12/12=1.414
 */
export function calculateRoofingSquares(input: RoofingAreaInput): number {
  validatePositive(input.footprintSF, 'Footprint SF');
  validateNonNegative(input.pitchRise, 'Pitch rise');
  validateRange(input.pitchRise, 0, 24, 'Pitch rise per 12" run');
  
  // Calculate pitch multiplier using Pythagorean theorem
  const run = 12;
  const rafter = Math.sqrt(run * run + input.pitchRise * input.pitchRise);
  const pitchMultiplier = rafter / run;
  
  const actualAreaSF = input.footprintSF * pitchMultiplier;
  const squares = actualAreaSF / CONVERSIONS.SQ_PER_100SF;
  const withWaste = squares * (1 + WASTE_FACTORS.roofing);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate flat roof squares (no pitch adjustment)
 */
export function calculateFlatRoofSquares(areaSF: number): number {
  validatePositive(areaSF, 'Area SF');
  
  const squares = areaSF / CONVERSIONS.SQ_PER_100SF;
  return Math.round(squares * (1 + WASTE_FACTORS.roofing) * 100) / 100;
}

/**
 * Calculate roof coating gallons from mil thickness
 * Formula: Area SF × (mils / 1604) × (1 + waste)
 * 1604 mil-SF per gallon is industry standard for 1 mil wet
 */
export function calculateRoofCoatingGallons(input: RoofingCoatingInput): number {
  validatePositive(input.areaSF, 'Area SF');
  validatePositive(input.milThickness, 'Mil thickness');
  validateRange(input.milThickness, 5, 100, 'Mil thickness');
  
  const waste = input.wasteFactor ?? WASTE_FACTORS.roofing;
  // 1604 is the mil-SF/gallon constant (1 gallon covers 1604 SF at 1 mil)
  const gallons = (input.areaSF * input.milThickness) / 1604;
  const withWaste = gallons * (1 + waste);
  
  return Math.round(withWaste * 100) / 100;
}

/**
 * Calculate silicone coating gallons (20 mil typical)
 */
export function calculateSiliconeCoatingGallons(areaSF: number, milThickness: number = 20): number {
  return calculateRoofCoatingGallons({ areaSF, milThickness });
}

/**
 * Calculate acrylic coating gallons (16-24 mil typical)
 */
export function calculateAcrylicCoatingGallons(areaSF: number, milThickness: number = 20): number {
  return calculateRoofCoatingGallons({ areaSF, milThickness });
}

/**
 * Calculate polyurea coating gallons (40-60 mil typical)
 */
export function calculatePolyureaCoatingGallons(areaSF: number, milThickness: number = 50): number {
  return calculateRoofCoatingGallons({ areaSF, milThickness });
}

/**
 * Calculate elastomeric coating gallons (12-20 mil typical)
 */
export function calculateElastomericCoatingGallons(areaSF: number, milThickness: number = 16): number {
  return calculateRoofCoatingGallons({ areaSF, milThickness });
}

// ============================================
// MASONRY TRADE CALCULATORS (CSI 04)
// ============================================

export interface CMUWallInput {
  lengthFeet: number;
  heightFeet: number;
  blockWidthInches: number;
}

/**
 * Calculate CMU blocks needed
 * Standard CMU: 8" × 16" face = 0.89 SF per block (includes mortar joints)
 * Formula: Wall SF / 0.89 × (1 + waste)
 */
export function calculateCMUBlocks(input: CMUWallInput): number {
  validatePositive(input.lengthFeet, 'Length');
  validatePositive(input.heightFeet, 'Height');
  validateRange(input.blockWidthInches, 4, 16, 'Block width');
  
  const wallSF = input.lengthFeet * input.heightFeet;
  const blocksPerSF = 1.125; // 8"×16" with 3/8" mortar joints = 1.125 blocks per SF
  const blocksNeeded = wallSF * blocksPerSF;
  
  return Math.ceil(blocksNeeded * (1 + WASTE_FACTORS.masonry));
}

/**
 * Calculate mortar bags for CMU
 * Approximately 1 bag (70 lb) per 35 blocks
 */
export function calculateMortarBags(blockCount: number): number {
  validatePositive(blockCount, 'Block count');
  
  const bagsNeeded = blockCount / 35;
  return Math.ceil(bagsNeeded * (1 + WASTE_FACTORS.masonry));
}

/**
 * Calculate brick count
 * Standard modular brick: 3.5" × 7.5" face = 6.75 bricks per SF
 */
export function calculateBrickCount(areaSF: number): number {
  validatePositive(areaSF, 'Area SF');
  
  const bricksPerSF = 6.75;
  const bricksNeeded = areaSF * bricksPerSF;
  
  return Math.ceil(bricksNeeded * (1 + WASTE_FACTORS.masonry));
}

// ============================================
// CARPENTRY/FRAMING TRADE CALCULATORS (CSI 06)
// ============================================

export interface WallFramingInput {
  lengthFeet: number;
  heightFeet: number;
  studSpacingInches: number;
}

/**
 * Calculate stud count for wall framing
 * Formula: (Length FT × 12 / spacing) + 1 (for corners/ends)
 */
export function calculateStudCount(input: WallFramingInput): number {
  validatePositive(input.lengthFeet, 'Wall length');
  validatePositive(input.heightFeet, 'Wall height');
  validateRange(input.studSpacingInches, 12, 24, 'Stud spacing');
  
  const studsNeeded = Math.ceil((input.lengthFeet * 12) / input.studSpacingInches) + 1;
  return Math.ceil(studsNeeded * (1 + WASTE_FACTORS.framing));
}

/**
 * Calculate board feet for lumber.
 *
 * Industry definition: 1 board foot = 144 cubic inches of wood.
 * With length in FEET (not inches), the canonical formula is:
 *
 *   BF = (Thickness_in × Width_in × Length_ft) / 12
 *
 * Worked example: a 2"×4"×8' stud
 *   = (2 × 4 × 8) / 12 = 64 / 12 = 5.333 BF
 *   With 10% framing waste → 5.87 BF.
 */
export function calculateBoardFeet(thicknessInches: number, widthInches: number, lengthFeet: number, quantity: number = 1): number {
  validatePositive(thicknessInches, 'Thickness');
  validatePositive(widthInches, 'Width');
  validatePositive(lengthFeet, 'Length');
  validatePositive(quantity, 'Quantity');

  const boardFeet = (thicknessInches * widthInches * lengthFeet) / 12 * quantity;
  return Math.round(boardFeet * (1 + WASTE_FACTORS.framing) * 100) / 100;
}

/**
 * Calculate plywood sheets
 * Standard sheet: 4' × 8' = 32 SF
 */
export function calculatePlywoodSheets(areaSF: number, sheetSizeSF: number = 32): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sheetSizeSF, 'Sheet size');
  
  const sheets = areaSF / sheetSizeSF;
  return Math.ceil(sheets * (1 + WASTE_FACTORS.framing));
}

// ============================================
// DRYWALL TRADE CALCULATORS (CSI 09)
// ============================================

/**
 * Calculate drywall sheets
 * Standard sheet: 4' × 8' = 32 SF or 4' × 12' = 48 SF
 */
export function calculateDrywallSheets(areaSF: number, sheetSizeSF: number = 32): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sheetSizeSF, 'Sheet size');
  
  const sheets = areaSF / sheetSizeSF;
  return Math.ceil(sheets * (1 + WASTE_FACTORS.drywall));
}

/**
 * Calculate joint compound gallons
 * Approximately 0.5 gallons per sheet for 3-coat finish
 */
export function calculateJointCompoundGallons(sheetCount: number): number {
  validatePositive(sheetCount, 'Sheet count');
  
  const gallons = sheetCount * 0.5;
  return ceilWithEpsilon(gallons * (1 + WASTE_FACTORS.drywall));
}

/**
 * Calculate tape footage
 * Approximately 40 LF of tape per sheet
 */
export function calculateTapeLF(sheetCount: number): number {
  validatePositive(sheetCount, 'Sheet count');
  
  const tapeLF = sheetCount * 40;
  return Math.ceil(tapeLF * (1 + WASTE_FACTORS.drywall));
}

// ============================================
// INSULATION TRADE CALCULATORS (CSI 07)
// ============================================

/**
 * Calculate batt insulation SF
 */
export function calculateBattInsulationSF(areaSF: number): number {
  validatePositive(areaSF, 'Area SF');
  return Math.ceil(areaSF * (1 + WASTE_FACTORS.insulation));
}

/**
 * Calculate spray foam board feet
 * Formula: Area SF × thickness in inches = board feet
 */
export function calculateSprayFoamBoardFeet(areaSF: number, thicknessInches: number): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(thicknessInches, 'Thickness');
  
  const boardFeet = areaSF * thicknessInches;
  return Math.ceil(boardFeet * (1 + WASTE_FACTORS.insulation));
}

/**
 * Calculate blown insulation bags
 * Approximately 30 SF per bag at R-38
 */
export function calculateBlownInsulationBags(areaSF: number, sfPerBag: number = 30): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sfPerBag, 'SF per bag');
  
  const bags = areaSF / sfPerBag;
  return Math.ceil(bags * (1 + WASTE_FACTORS.insulation));
}

// ============================================
// FLOORING TRADE CALCULATORS (CSI 09)
// ============================================

/**
 * Calculate flooring cartons (plank/tile)
 * Standard carton covers 20-25 SF
 */
export function calculateFlooringCartons(areaSF: number, sfPerCarton: number = 20): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sfPerCarton, 'SF per carton');
  
  const cartons = areaSF / sfPerCarton;
  return ceilWithEpsilon(cartons * (1 + WASTE_FACTORS.flooring));
}

/**
 * Calculate carpet yards
 * Standard carpet: 12' wide rolls, sold by SY
 */
export function calculateCarpetSY(areaSF: number): number {
  validatePositive(areaSF, 'Area SF');
  
  const squareYards = areaSF / CONVERSIONS.SF_PER_SY;
  return ceilWithEpsilon(squareYards * (1 + WASTE_FACTORS.flooring));
}

/**
 * Calculate adhesive gallons for flooring
 * Approximately 100 SF per gallon
 */
export function calculateFlooringAdhesiveGallons(areaSF: number, coverageSFPerGallon: number = 100): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(coverageSFPerGallon, 'Coverage rate');
  
  const gallons = areaSF / coverageSFPerGallon;
  return Math.ceil(gallons * (1 + WASTE_FACTORS.flooring));
}

// ============================================
// PAINTING TRADE CALCULATORS (CSI 09)
// ============================================

export interface PaintingInput {
  areaSF: number;
  coats: number;
  coverageSFPerGallon: number;
}

/**
 * Calculate paint gallons
 * Formula: (Area SF × coats) / coverage × (1 + waste)
 */
export function calculatePaintGallons(input: PaintingInput): number {
  validatePositive(input.areaSF, 'Area SF');
  validateRange(input.coats, 1, 4, 'Number of coats');
  validatePositive(input.coverageSFPerGallon, 'Coverage rate');
  
  const totalSF = input.areaSF * input.coats;
  const gallons = totalSF / input.coverageSFPerGallon;
  const withWaste = gallons * (1 + WASTE_FACTORS.paint);
  
  return ceilWithEpsilon(withWaste * 100) / 100;
}

/**
 * Calculate primer gallons
 * Typical coverage: 300-400 SF per gallon
 */
export function calculatePrimerGallons(areaSF: number, coverageSFPerGallon: number = 350): number {
  return calculatePaintGallons({ areaSF, coats: 1, coverageSFPerGallon });
}

/**
 * Calculate stain gallons
 * Typical coverage: 200-300 SF per gallon
 */
export function calculateStainGallons(areaSF: number, coverageSFPerGallon: number = 250): number {
  return calculatePaintGallons({ areaSF, coats: 1, coverageSFPerGallon });
}

// ============================================
// ELECTRICAL TRADE CALCULATORS (CSI 26)
// ============================================

export interface WirePullInput {
  conduitLengthLF: number;
  pullBoxCount: number;
  wiresPerRun: number;
}

export interface CircuitLoadInput {
  deviceCount: number;
  wattsPerDevice: number;
  voltage: number;
}

/**
 * Calculate wire pull length
 * Formula: Conduit LF × wires + (pull boxes × extra per box) × (1 + waste)
 * Add 10 LF per pull box for connections
 */
export function calculateWirePullLF(input: WirePullInput): number {
  validatePositive(input.conduitLengthLF, 'Conduit length');
  validateNonNegative(input.pullBoxCount, 'Pull box count');
  validatePositive(input.wiresPerRun, 'Wires per run');
  
  const extraPerBox = 10;
  const wireLF = (input.conduitLengthLF * input.wiresPerRun) + (input.pullBoxCount * extraPerBox);
  const withWaste = wireLF * (1 + WASTE_FACTORS.electrical);
  
  return ceilWithEpsilon(withWaste);
}

/**
 * Calculate circuit amperage
 * Formula: (devices × watts) / voltage
 */
export function calculateCircuitAmps(input: CircuitLoadInput): number {
  validatePositive(input.deviceCount, 'Device count');
  validatePositive(input.wattsPerDevice, 'Watts per device');
  validatePositive(input.voltage, 'Voltage');
  
  const totalWatts = input.deviceCount * input.wattsPerDevice;
  const amps = totalWatts / input.voltage;
  
  return Math.round(amps * 100) / 100;
}

/**
 * Calculate conduit length needed
 * Add 15% for fittings and bends
 */
export function calculateConduitLF(routeLF: number): number {
  validatePositive(routeLF, 'Route length');
  
  return ceilWithEpsilon(routeLF * (1 + WASTE_FACTORS.electrical));
}

/**
 * Calculate outlet/device boxes
 */
export function calculateDeviceBoxes(outletCount: number): number {
  validatePositive(outletCount, 'Outlet count');
  
  return Math.ceil(outletCount * (1 + WASTE_FACTORS.electrical * 0.5));
}

// ============================================
// PLUMBING TRADE CALCULATORS (CSI 22)
// ============================================

export interface PipingInput {
  lengthLF: number;
  pipeDiameter: number;
}

/**
 * Calculate pipe length with fittings allowance
 * Add 10% for fittings and waste
 */
export function calculatePipeLF(lengthLF: number): number {
  validatePositive(lengthLF, 'Pipe length');
  
  return ceilWithEpsilon(lengthLF * (1 + WASTE_FACTORS.plumbing));
}

/**
 * Calculate pipe hangers
 * Spacing varies by pipe size: small (1/2"-1") = 6 ft, medium (1.5"-3") = 8 ft, large (4"+) = 10 ft
 */
export function calculatePipeHangers(lengthLF: number, pipeDiameterInches: number): number {
  validatePositive(lengthLF, 'Pipe length');
  validatePositive(pipeDiameterInches, 'Pipe diameter');
  
  let spacingFeet: number;
  if (pipeDiameterInches <= 1) {
    spacingFeet = 6;
  } else if (pipeDiameterInches <= 3) {
    spacingFeet = 8;
  } else {
    spacingFeet = 10;
  }
  
  const hangersNeeded = Math.ceil(lengthLF / spacingFeet) + 1;
  return Math.ceil(hangersNeeded * (1 + WASTE_FACTORS.plumbing * 0.5));
}

/**
 * Calculate fixture rough-in costs (standard fixture count)
 */
export function calculateFixtureCount(toilets: number, sinks: number, showers: number): number {
  validateNonNegative(toilets, 'Toilet count');
  validateNonNegative(sinks, 'Sink count');
  validateNonNegative(showers, 'Shower count');
  
  return toilets + sinks + showers;
}

// ============================================
// HVAC TRADE CALCULATORS (CSI 23)
// ============================================

export interface DuctInput {
  lengthLF: number;
  widthInches: number;
  heightInches: number;
}

/**
 * Calculate duct surface area SF
 * Formula: (2 × width + 2 × height) / 12 × length
 */
export function calculateDuctSF(input: DuctInput): number {
  validatePositive(input.lengthLF, 'Duct length');
  validatePositive(input.widthInches, 'Duct width');
  validatePositive(input.heightInches, 'Duct height');
  
  const perimeterFeet = (2 * input.widthInches + 2 * input.heightInches) / CONVERSIONS.INCHES_PER_FOOT;
  const surfaceArea = perimeterFeet * input.lengthLF;
  
  return Math.round(surfaceArea * (1 + WASTE_FACTORS.hvac) * 100) / 100;
}

/**
 * Calculate round duct surface area SF
 * Formula: π × diameter / 12 × length
 */
export function calculateRoundDuctSF(lengthLF: number, diameterInches: number): number {
  validatePositive(lengthLF, 'Duct length');
  validatePositive(diameterInches, 'Duct diameter');
  
  const circumferenceFeet = (Math.PI * diameterInches) / CONVERSIONS.INCHES_PER_FOOT;
  const surfaceArea = circumferenceFeet * lengthLF;
  
  return Math.round(surfaceArea * (1 + WASTE_FACTORS.hvac) * 100) / 100;
}

/**
 * Calculate CFM for room
 * Rule of thumb: 1 CFM per SF for residential, 1.5 CFM per SF for commercial
 */
export function calculateCFM(areaSF: number, commercial: boolean = false): number {
  validatePositive(areaSF, 'Area SF');
  
  const cfmPerSF = commercial ? 1.5 : 1.0;
  return Math.ceil(areaSF * cfmPerSF);
}

/**
 * Calculate tonnage for HVAC system
 * Rule of thumb: 400-600 SF per ton (residential)
 */
export function calculateHVACTons(areaSF: number, sfPerTon: number = 500): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sfPerTon, 'SF per ton');
  
  const tons = areaSF / sfPerTon;
  return Math.ceil(tons * 2) / 2; // Round up to nearest 0.5 ton
}

// ============================================
// FIRE PROTECTION TRADE CALCULATORS (CSI 21)
// ============================================

/**
 * Calculate sprinkler heads
 * Light hazard: 1 head per 200 SF max
 * Ordinary hazard: 1 head per 130 SF max
 */
export function calculateSprinklerHeads(areaSF: number, hazardLevel: 'light' | 'ordinary' | 'extra' = 'ordinary'): number {
  validatePositive(areaSF, 'Area SF');
  
  let sfPerHead: number;
  switch (hazardLevel) {
    case 'light':
      sfPerHead = 200;
      break;
    case 'ordinary':
      sfPerHead = 130;
      break;
    case 'extra':
      sfPerHead = 100;
      break;
  }
  
  const headsNeeded = Math.ceil(areaSF / sfPerHead);
  return Math.ceil(headsNeeded * (1 + WASTE_FACTORS.fireProtection));
}

/**
 * Calculate fire sprinkler pipe LF
 * Based on head count and typical branch/main ratios
 */
export function calculateSprinklerPipeLF(headCount: number, avgDistanceBetweenHeads: number = 15): number {
  validatePositive(headCount, 'Head count');
  validatePositive(avgDistanceBetweenHeads, 'Average distance');
  
  const branchPipe = headCount * avgDistanceBetweenHeads;
  const mainPipe = branchPipe * 0.3; // Mains typically 30% of branch
  const totalPipe = branchPipe + mainPipe;
  
  return Math.ceil(totalPipe * (1 + WASTE_FACTORS.fireProtection));
}

// ============================================
// LOW VOLTAGE TRADE CALCULATORS (CSI 27/28)
// ============================================

/**
 * Calculate low voltage cable drops
 * Typical drop: ~100 LF average for structured cabling
 */
export function calculateCableDropsLF(dropCount: number, avgDropLengthLF: number = 100): number {
  validatePositive(dropCount, 'Drop count');
  validatePositive(avgDropLengthLF, 'Average drop length');
  
  const totalLF = dropCount * avgDropLengthLF;
  return Math.ceil(totalLF * (1 + WASTE_FACTORS.lowVoltage));
}

/**
 * Calculate patch panel ports needed
 * Add 20% spare capacity
 */
export function calculatePatchPanelPorts(activeDrops: number): number {
  validatePositive(activeDrops, 'Active drops');
  
  return Math.ceil(activeDrops * 1.2);
}

/**
 * Calculate conduit/pathway LF for low voltage
 */
export function calculateLVConduitLF(routeLF: number): number {
  validatePositive(routeLF, 'Route length');
  
  return Math.ceil(routeLF * (1 + WASTE_FACTORS.lowVoltage));
}

// ============================================
// LANDSCAPING TRADE CALCULATORS (CSI 32)
// ============================================

/**
 * Calculate mulch cubic yards
 * Formula: (Area SF × Depth in) / 12 / 27 × (1 + waste)
 */
export function calculateMulchCY(areaSF: number, depthInches: number = 3): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(depthInches, 'Depth');
  validateRange(depthInches, 1, 12, 'Depth inches');
  
  const cubicFeet = areaSF * (depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const cubicYards = cubicFeet / CONVERSIONS.CF_PER_CY;
  
  return Math.round(cubicYards * (1 + WASTE_FACTORS.landscaping) * 100) / 100;
}

/**
 * Calculate topsoil cubic yards
 */
export function calculateTopsoilCY(areaSF: number, depthInches: number = 4): number {
  return calculateMulchCY(areaSF, depthInches);
}

/**
 * Calculate sod rolls or pallets
 * Standard sod: 450 SF per pallet, 9 SF per roll
 */
export function calculateSodPallets(areaSF: number, sfPerPallet: number = 450): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(sfPerPallet, 'SF per pallet');
  
  const pallets = areaSF / sfPerPallet;
  return Math.ceil(pallets * (1 + WASTE_FACTORS.landscaping));
}

/**
 * Calculate irrigation heads
 * Based on coverage radius and overlap requirements
 */
export function calculateIrrigationHeads(areaSF: number, coverageRadiusFeet: number = 15): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(coverageRadiusFeet, 'Coverage radius');
  
  // Head-to-head coverage with 50% overlap
  const spacingFeet = coverageRadiusFeet * Math.sqrt(2);
  const coveragePerHead = spacingFeet * spacingFeet;
  const headsNeeded = areaSF / coveragePerHead;
  
  return Math.ceil(headsNeeded * (1 + WASTE_FACTORS.landscaping));
}

// ============================================
// DEMOLITION TRADE CALCULATORS (CSI 02)
// ============================================

/**
 * Calculate demo haul-off cubic yards
 * Uses expansion factor for debris
 */
export function calculateDemoHaulOffCY(areaSF: number, depthInches: number, expansionFactor: number = 1.5): number {
  validatePositive(areaSF, 'Area SF');
  validatePositive(depthInches, 'Depth');
  validateRange(expansionFactor, 1.0, 3.0, 'Expansion factor');
  
  const solidCubicFeet = areaSF * (depthInches / CONVERSIONS.INCHES_PER_FOOT);
  const solidCubicYards = solidCubicFeet / CONVERSIONS.CF_PER_CY;
  const expandedCY = solidCubicYards * expansionFactor;
  
  return Math.round(expandedCY * 100) / 100;
}

/**
 * Calculate dumpster loads
 * Standard dumpster: 20 CY or 30 CY
 */
export function calculateDumpsterLoads(totalCY: number, dumpsterSizeCY: number = 20): number {
  validatePositive(totalCY, 'Total CY');
  validatePositive(dumpsterSizeCY, 'Dumpster size');
  
  return Math.ceil(totalCY / dumpsterSizeCY);
}

// ============================================
// EXPORT ALL CALCULATORS
// ============================================

export const TradeCalculators = {
  // Concrete
  calculateConcreteSlabCY,
  calculateConcreteFootingCY,
  calculateConcreteWallCY,
  calculateRebarPieces,
  calculateWireMeshRolls,
  
  // Earthwork
  calculateExcavationCY,
  calculateTrenchExcavationCY,
  calculateStoneBaseTons,
  calculateFillCY,
  
  // Asphalt/Paving
  calculateAsphaltTons,
  calculateStripingGallons,
  calculateSealcoatGallons,
  
  // Roofing
  calculateRoofingSquares,
  calculateFlatRoofSquares,
  calculateRoofCoatingGallons,
  calculateSiliconeCoatingGallons,
  calculateAcrylicCoatingGallons,
  calculatePolyureaCoatingGallons,
  calculateElastomericCoatingGallons,
  
  // Masonry
  calculateCMUBlocks,
  calculateMortarBags,
  calculateBrickCount,
  
  // Carpentry
  calculateStudCount,
  calculateBoardFeet,
  calculatePlywoodSheets,
  
  // Drywall
  calculateDrywallSheets,
  calculateJointCompoundGallons,
  calculateTapeLF,
  
  // Insulation
  calculateBattInsulationSF,
  calculateSprayFoamBoardFeet,
  calculateBlownInsulationBags,
  
  // Flooring
  calculateFlooringCartons,
  calculateCarpetSY,
  calculateFlooringAdhesiveGallons,
  
  // Painting
  calculatePaintGallons,
  calculatePrimerGallons,
  calculateStainGallons,
  
  // Electrical
  calculateWirePullLF,
  calculateCircuitAmps,
  calculateConduitLF,
  calculateDeviceBoxes,
  
  // Plumbing
  calculatePipeLF,
  calculatePipeHangers,
  calculateFixtureCount,
  
  // HVAC
  calculateDuctSF,
  calculateRoundDuctSF,
  calculateCFM,
  calculateHVACTons,
  
  // Fire Protection
  calculateSprinklerHeads,
  calculateSprinklerPipeLF,
  
  // Low Voltage
  calculateCableDropsLF,
  calculatePatchPanelPorts,
  calculateLVConduitLF,
  
  // Landscaping
  calculateMulchCY,
  calculateTopsoilCY,
  calculateSodPallets,
  calculateIrrigationHeads,
  
  // Demolition
  calculateDemoHaulOffCY,
  calculateDumpsterLoads,
  
  // Validation helpers
  validatePositive,
  validateNonNegative,
  validateRange,
};

export default TradeCalculators;
