/**
 * Material Calculator Verification Suite
 * Complete testing and validation for all 19 trade calculators
 * 
 * This suite validates:
 * - Formula correctness
 * - Unit conversions
 * - Waste/safety factors
 * - Edge case handling
 * - Extreme value testing
 * - Cross-trade consistency
 */

import { logInfo } from "./utils/logger";
import {
  calculateConcreteSlabCY,
  calculateConcreteFootingCY,
  calculateConcreteWallCY,
  calculateRebarPieces,
  calculateWireMeshRolls,
  calculateExcavationCY,
  calculateTrenchExcavationCY,
  calculateStoneBaseTons,
  calculateFillCY,
  calculateAsphaltTons,
  calculateStripingGallons,
  calculateSealcoatGallons,
  calculateRoofingSquares,
  calculateFlatRoofSquares,
  calculateRoofCoatingGallons,
  calculateSiliconeCoatingGallons,
  calculateAcrylicCoatingGallons,
  calculatePolyureaCoatingGallons,
  calculateElastomericCoatingGallons,
  calculateCMUBlocks,
  calculateMortarBags,
  calculateBrickCount,
  calculateStudCount,
  calculateBoardFeet,
  calculatePlywoodSheets,
  calculateDrywallSheets,
  calculateJointCompoundGallons,
  calculateTapeLF,
  calculateBattInsulationSF,
  calculateSprayFoamBoardFeet,
  calculateBlownInsulationBags,
  calculateFlooringCartons,
  calculateCarpetSY,
  calculateFlooringAdhesiveGallons,
  calculatePaintGallons,
  calculatePrimerGallons,
  calculateStainGallons,
  calculateWirePullLF,
  calculateCircuitAmps,
  calculateConduitLF,
  calculateDeviceBoxes,
  calculatePipeLF,
  calculatePipeHangers,
  calculateFixtureCount,
  calculateDuctSF,
  calculateRoundDuctSF,
  calculateCFM,
  calculateHVACTons,
  calculateSprinklerHeads,
  calculateSprinklerPipeLF,
  calculateCableDropsLF,
  calculatePatchPanelPorts,
  calculateLVConduitLF,
  calculateMulchCY,
  calculateTopsoilCY,
  calculateSodPallets,
  calculateIrrigationHeads,
  calculateDemoHaulOffCY,
  calculateDumpsterLoads,
} from './tradeCalculators';

// ============================================
// TEST INFRASTRUCTURE
// ============================================

interface TestCase {
  name: string;
  inputs: Record<string, any>;
  expectedMin: number;
  expectedMax: number;
  actualResult?: number;
  passed?: boolean;
  notes?: string;
}

interface TestResult {
  trade: string;
  scope: string;
  testNumber: number;
  inputs: Record<string, any>;
  expected: string;
  actual: number | string;
  result: 'PASS' | 'FAIL';
  note?: string;
}

interface TradeTestSuite {
  trade: string;
  tests: TestCase[];
}

function runTest(
  trade: string,
  scope: string,
  testNum: number,
  calculatorFn: (...args: any[]) => number,
  inputs: any[],
  inputLabels: Record<string, any>,
  expectedMin: number,
  expectedMax: number,
  notes?: string
): TestResult {
  let actual: number | string;
  let passed: boolean;
  
  try {
    actual = calculatorFn(...inputs);
    passed = actual >= expectedMin && actual <= expectedMax;
  } catch (error: any) {
    actual = `ERROR: ${error.message}`;
    passed = false;
  }
  
  return {
    trade,
    scope,
    testNumber: testNum,
    inputs: inputLabels,
    expected: `${expectedMin} – ${expectedMax}`,
    actual,
    result: passed ? 'PASS' : 'FAIL',
    note: notes || (passed ? undefined : `Result ${actual} outside expected range`),
  };
}

function runErrorTest(
  trade: string,
  scope: string,
  testNum: number,
  calculatorFn: (...args: any[]) => number,
  inputs: any[],
  inputLabels: Record<string, any>,
  expectedErrorContains: string
): TestResult {
  let actual: string;
  let passed: boolean;
  
  try {
    const result = calculatorFn(...inputs);
    actual = `No error thrown, got: ${result}`;
    passed = false;
  } catch (error: any) {
    actual = error.message;
    passed = actual.toLowerCase().includes(expectedErrorContains.toLowerCase());
  }
  
  return {
    trade,
    scope,
    testNumber: testNum,
    inputs: inputLabels,
    expected: `Error containing: "${expectedErrorContains}"`,
    actual,
    result: passed ? 'PASS' : 'FAIL',
    note: passed ? 'Error correctly thrown' : 'Expected error not thrown',
  };
}

// ============================================
// CONCRETE TRADE TESTS (CSI 03)
// ============================================

function runConcreteTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Standard 4" slab - 1000 SF
  // Formula: 1000 SF × 4"/12 / 27 × 1.10 = 13.58 CY
  results.push(runTest(
    'CONCRETE', 'Slab Volume', 1,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [1000, 4, 0.10],
    { areaSF: 1000, thicknessInches: 4, wasteFactor: 0.10 },
    13.50, 13.70,
    '1000 SF, 4" thick with 10% waste'
  ));
  
  // Test 2: Standard 6" slab - 5000 SF
  // Formula: 5000 SF × 6"/12 / 27 × 1.10 = 101.85 CY
  results.push(runTest(
    'CONCRETE', 'Slab Volume', 2,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [5000, 6, 0.10],
    { areaSF: 5000, thicknessInches: 6, wasteFactor: 0.10 },
    100.00, 103.00,
    '5000 SF, 6" thick with 10% waste'
  ));
  
  // Test 3: Thick industrial slab - 8" depth
  // Formula: 2500 SF × 8"/12 / 27 × 1.10 = 67.90 CY
  results.push(runTest(
    'CONCRETE', 'Slab Volume', 3,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [2500, 8, 0.10],
    { areaSF: 2500, thicknessInches: 8, wasteFactor: 0.10 },
    67.00, 69.00,
    '2500 SF, 8" thick with 10% waste'
  ));
  
  // Test 4: Standard footing - 100 LF × 24" × 12"
  // Formula: 100 LF × 24"/12 × 12"/12 / 27 × 1.10 = 8.15 CY
  results.push(runTest(
    'CONCRETE', 'Footing Volume', 4,
    (lf, w, d, waste) => calculateConcreteFootingCY({ lengthLF: lf, widthInches: w, depthInches: d, wasteFactor: waste }),
    [100, 24, 12, 0.10],
    { lengthLF: 100, widthInches: 24, depthInches: 12, wasteFactor: 0.10 },
    8.00, 8.20,
    '100 LF footing, 24"W × 12"D with 10% waste'
  ));
  
  // Test 5: Large footing - 250 LF × 36" × 18"
  // Formula: 250 LF × 36"/12 × 18"/12 / 27 × 1.10 = 45.83 CY
  results.push(runTest(
    'CONCRETE', 'Footing Volume', 5,
    (lf, w, d, waste) => calculateConcreteFootingCY({ lengthLF: lf, widthInches: w, depthInches: d, wasteFactor: waste }),
    [250, 36, 18, 0.10],
    { lengthLF: 250, widthInches: 36, depthInches: 18, wasteFactor: 0.10 },
    45.00, 47.00,
    '250 LF footing, 36"W × 18"D with 10% waste'
  ));
  
  // Test 6: Concrete wall - 50 LF × 8' × 8"
  // Formula: 50 LF × 8 FT × 8"/12 / 27 × 1.10 = 10.86 CY
  results.push(runTest(
    'CONCRETE', 'Wall Volume', 6,
    (lf, h, t, waste) => calculateConcreteWallCY({ lengthLF: lf, heightFeet: h, thicknessInches: t, wasteFactor: waste }),
    [50, 8, 8, 0.10],
    { lengthLF: 50, heightFeet: 8, thicknessInches: 8, wasteFactor: 0.10 },
    10.80, 11.00,
    '50 LF wall, 8\' high × 8" thick with 10% waste'
  ));
  
  // Test 7: Rebar for 1000 SF slab @ 12" O.C.
  // Side = sqrt(1000) = 31.62', bars per dir = 32.62, total LF = 32.62 × 2 × 31.62 × 1.1 = 2272 LF
  // Bars = 2272 / 20 × 1.1 = 125 pieces
  results.push(runTest(
    'CONCRETE', 'Rebar Count', 7,
    calculateRebarPieces,
    [1000, 12, 20],
    { areaSF: 1000, spacingInches: 12, barLengthFeet: 20 },
    120, 130,
    '1000 SF slab, 12" O.C., 20\' bars with overlap'
  ));
  
  // Test 8: Wire mesh for 2000 SF slab
  // Formula: 2000 SF × 1.10 / 150 SF/roll = 14.67 rolls
  results.push(runTest(
    'CONCRETE', 'Wire Mesh Rolls', 8,
    calculateWireMeshRolls,
    [2000, 150],
    { areaSF: 2000, sfPerRoll: 150 },
    14, 16,
    '2000 SF slab, 150 SF/roll coverage'
  ));
  
  // Test 9: Zero area (should error)
  results.push(runErrorTest(
    'CONCRETE', 'Slab Volume', 9,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [0, 4, 0.10],
    { areaSF: 0, thicknessInches: 4, wasteFactor: 0.10 },
    'greater than zero'
  ));
  
  // Test 10: Negative thickness (should error)
  results.push(runErrorTest(
    'CONCRETE', 'Slab Volume', 10,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [1000, -4, 0.10],
    { areaSF: 1000, thicknessInches: -4, wasteFactor: 0.10 },
    'greater than zero'
  ));
  
  // Test 11: Extreme thickness (should error - beyond 36")
  results.push(runErrorTest(
    'CONCRETE', 'Slab Volume', 11,
    (sf, thick, waste) => calculateConcreteSlabCY({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [1000, 48, 0.10],
    { areaSF: 1000, thicknessInches: 48, wasteFactor: 0.10 },
    'between'
  ));
  
  return results;
}

// ============================================
// EARTHWORK TRADE TESTS (CSI 31)
// ============================================

function runEarthworkTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Standard excavation - 1000 SF × 6" depth
  // Formula: 1000 SF × 6"/12 / 27 × 1.25 = 23.15 CY
  results.push(runTest(
    'EARTHWORK', 'Excavation Volume', 1,
    (sf, depth, swell) => calculateExcavationCY({ areaSF: sf, depthInches: depth, swellFactor: swell }),
    [1000, 6, 0.25],
    { areaSF: 1000, depthInches: 6, swellFactor: 0.25 },
    23.00, 24.00,
    '1000 SF, 6" depth with 25% swell'
  ));
  
  // Test 2: Deep excavation - 5000 SF × 24" depth
  // Formula: 5000 SF × 24"/12 / 27 × 1.25 = 462.96 CY
  results.push(runTest(
    'EARTHWORK', 'Excavation Volume', 2,
    (sf, depth, swell) => calculateExcavationCY({ areaSF: sf, depthInches: depth, swellFactor: swell }),
    [5000, 24, 0.25],
    { areaSF: 5000, depthInches: 24, swellFactor: 0.25 },
    460.00, 470.00,
    '5000 SF, 24" depth with 25% swell'
  ));
  
  // Test 3: Trench excavation - 200 LF × 24" × 36"
  // Formula: 200 LF × 24"/12 × 36"/12 / 27 × 1.25 = 200 × 2 × 3 / 27 × 1.25 = 55.56 CY
  results.push(runTest(
    'EARTHWORK', 'Trench Excavation', 3,
    (lf, w, d, swell) => calculateTrenchExcavationCY({ lengthLF: lf, widthInches: w, depthInches: d, swellFactor: swell }),
    [200, 24, 36, 0.25],
    { lengthLF: 200, widthInches: 24, depthInches: 36, swellFactor: 0.25 },
    55.00, 56.00,
    '200 LF trench, 24"W × 36"D with 25% swell'
  ));
  
  // Test 4: Stone base - 1000 SF × 4" depth
  // Formula: 1000 SF × 4"/12 / 27 × 1.10 × 1.5 = 20.37 tons
  results.push(runTest(
    'EARTHWORK', 'Stone Base Tons', 4,
    calculateStoneBaseTons,
    [1000, 4, 0.10],
    { areaSF: 1000, depthInches: 4, wasteFactor: 0.10 },
    20.00, 21.00,
    '1000 SF, 4" depth, 1.5 tons/CY with 10% waste'
  ));
  
  // Test 5: Fill/backfill - 500 SF × 12" depth
  // Formula: 500 SF × 12"/12 / 27 × 1.15 = 21.30 CY
  results.push(runTest(
    'EARTHWORK', 'Fill Volume', 5,
    calculateFillCY,
    [500, 12, 1.15],
    { areaSF: 500, depthInches: 12, compactionFactor: 1.15 },
    21.00, 22.00,
    '500 SF, 12" depth with 15% compaction'
  ));
  
  // Test 6: Zero area (should error)
  results.push(runErrorTest(
    'EARTHWORK', 'Excavation Volume', 6,
    (sf, depth, swell) => calculateExcavationCY({ areaSF: sf, depthInches: depth, swellFactor: swell }),
    [0, 6, 0.25],
    { areaSF: 0, depthInches: 6, swellFactor: 0.25 },
    'greater than zero'
  ));
  
  return results;
}

// ============================================
// ASPHALT/PAVING TRADE TESTS (CSI 32)
// ============================================

function runAsphaltTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Standard asphalt - 10000 SF × 2" thick
  // Formula: 10000 SF × 2"/12 / 27 × 2.025 × 1.05 = 131.25 tons
  results.push(runTest(
    'ASPHALT', 'Asphalt Tonnage', 1,
    (sf, thick, waste) => calculateAsphaltTons({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [10000, 2, 0.05],
    { areaSF: 10000, thicknessInches: 2, wasteFactor: 0.05 },
    130.00, 133.00,
    '10,000 SF, 2" thick with 5% waste'
  ));
  
  // Test 2: Thick asphalt - 5000 SF × 4" thick
  // Formula: 5000 SF × 4"/12 / 27 × 2.025 × 1.05 = 131.25 tons
  results.push(runTest(
    'ASPHALT', 'Asphalt Tonnage', 2,
    (sf, thick, waste) => calculateAsphaltTons({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [5000, 4, 0.05],
    { areaSF: 5000, thicknessInches: 4, wasteFactor: 0.05 },
    130.00, 133.00,
    '5,000 SF, 4" thick with 5% waste'
  ));
  
  // Test 3: Striping - 1000 LF
  // Formula: 1000 LF / 400 LF/gal × 1.10 = 2.75 gal
  results.push(runTest(
    'ASPHALT', 'Striping Paint', 3,
    calculateStripingGallons,
    [1000, 400],
    { linearFeet: 1000, coverageLFPerGallon: 400 },
    3, 4,
    '1000 LF at 400 LF/gallon with 10% waste'
  ));
  
  // Test 4: Sealcoat - 5000 SF × 2 coats
  // Formula: 5000 SF × 2 / 60 SF/gal × 1.05 = 175 gal
  results.push(runTest(
    'ASPHALT', 'Sealcoat', 4,
    calculateSealcoatGallons,
    [5000, 60, 2],
    { areaSF: 5000, coverageSFPerGallon: 60, coats: 2 },
    170, 180,
    '5000 SF, 2 coats at 60 SF/gallon'
  ));
  
  // Test 5: Invalid thickness (should error)
  results.push(runErrorTest(
    'ASPHALT', 'Asphalt Tonnage', 5,
    (sf, thick, waste) => calculateAsphaltTons({ areaSF: sf, thicknessInches: thick, wasteFactor: waste }),
    [10000, 15, 0.05],
    { areaSF: 10000, thicknessInches: 15, wasteFactor: 0.05 },
    'between'
  ));
  
  return results;
}

// ============================================
// ROOFING TRADE TESTS (CSI 07)
// ============================================

function runRoofingTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Flat roof - 2000 SF
  // Formula: 2000 SF / 100 × 1.10 = 22 SQ
  results.push(runTest(
    'ROOFING', 'Flat Roof Squares', 1,
    calculateFlatRoofSquares,
    [2000],
    { areaSF: 2000 },
    21.50, 22.50,
    '2000 SF flat roof with 10% waste'
  ));
  
  // Test 2: Pitched roof - 2000 SF footprint @ 6/12 pitch
  // Pitch multiplier for 6/12 = sqrt(12² + 6²)/12 = 1.118
  // Formula: 2000 SF × 1.118 / 100 × 1.10 = 24.60 SQ
  results.push(runTest(
    'ROOFING', 'Pitched Roof Squares', 2,
    (fp, pitch) => calculateRoofingSquares({ footprintSF: fp, pitchRise: pitch }),
    [2000, 6],
    { footprintSF: 2000, pitchRise: 6 },
    24.00, 25.00,
    '2000 SF footprint, 6/12 pitch with 10% waste'
  ));
  
  // Test 3: Steep pitched roof - 1500 SF footprint @ 12/12 pitch
  // Pitch multiplier for 12/12 = sqrt(12² + 12²)/12 = 1.414
  // Formula: 1500 SF × 1.414 / 100 × 1.10 = 23.33 SQ
  results.push(runTest(
    'ROOFING', 'Steep Pitched Roof', 3,
    (fp, pitch) => calculateRoofingSquares({ footprintSF: fp, pitchRise: pitch }),
    [1500, 12],
    { footprintSF: 1500, pitchRise: 12 },
    23.00, 24.00,
    '1500 SF footprint, 12/12 pitch with 10% waste'
  ));
  
  // Test 4: Silicone coating - 5000 SF @ 20 mils
  // Formula: 5000 SF × 20 mils / 1604 × 1.10 = 68.58 gal
  results.push(runTest(
    'ROOFING', 'Silicone Coating', 4,
    calculateSiliconeCoatingGallons,
    [5000, 20],
    { areaSF: 5000, milThickness: 20 },
    68.00, 70.00,
    '5000 SF at 20 mils with 10% waste'
  ));
  
  // Test 5: Acrylic coating - 3000 SF @ 16 mils
  // Formula: 3000 SF × 16 mils / 1604 × 1.10 = 32.93 gal
  results.push(runTest(
    'ROOFING', 'Acrylic Coating', 5,
    calculateAcrylicCoatingGallons,
    [3000, 16],
    { areaSF: 3000, milThickness: 16 },
    32.00, 34.00,
    '3000 SF at 16 mils with 10% waste'
  ));
  
  // Test 6: Polyurea coating - 2000 SF @ 50 mils
  // Formula: 2000 SF × 50 mils / 1604 × 1.10 = 68.58 gal
  results.push(runTest(
    'ROOFING', 'Polyurea Coating', 6,
    calculatePolyureaCoatingGallons,
    [2000, 50],
    { areaSF: 2000, milThickness: 50 },
    68.00, 70.00,
    '2000 SF at 50 mils with 10% waste'
  ));
  
  // Test 7: Elastomeric coating - 4000 SF @ 16 mils
  // Formula: 4000 SF × 16 mils / 1604 × 1.10 = 43.91 gal
  results.push(runTest(
    'ROOFING', 'Elastomeric Coating', 7,
    calculateElastomericCoatingGallons,
    [4000, 16],
    { areaSF: 4000, milThickness: 16 },
    43.00, 45.00,
    '4000 SF at 16 mils with 10% waste'
  ));
  
  // Test 8: Invalid mil thickness (should error)
  results.push(runErrorTest(
    'ROOFING', 'Coating Gallons', 8,
    (sf, mils) => calculateRoofCoatingGallons({ areaSF: sf, milThickness: mils }),
    [5000, 150],
    { areaSF: 5000, milThickness: 150 },
    'between'
  ));
  
  return results;
}

// ============================================
// MASONRY TRADE TESTS (CSI 04)
// ============================================

function runMasonryTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: CMU wall - 50' × 10'
  // Formula: 50 × 10 = 500 SF × 1.125 blocks/SF × 1.05 = 591 blocks
  results.push(runTest(
    'MASONRY', 'CMU Block Count', 1,
    (l, h, w) => calculateCMUBlocks({ lengthFeet: l, heightFeet: h, blockWidthInches: w }),
    [50, 10, 8],
    { lengthFeet: 50, heightFeet: 10, blockWidthInches: 8 },
    580, 600,
    '50\' × 10\' wall with 5% waste'
  ));
  
  // Test 2: Mortar for 500 blocks
  // Formula: 500 blocks / 35 blocks/bag × 1.05 = 15 bags
  results.push(runTest(
    'MASONRY', 'Mortar Bags', 2,
    calculateMortarBags,
    [500],
    { blockCount: 500 },
    14, 16,
    '500 blocks at 35 blocks/bag with 5% waste'
  ));
  
  // Test 3: Brick count - 200 SF
  // Formula: 200 SF × 6.75 bricks/SF × 1.05 = 1418 bricks
  results.push(runTest(
    'MASONRY', 'Brick Count', 3,
    calculateBrickCount,
    [200],
    { areaSF: 200 },
    1400, 1450,
    '200 SF at 6.75 bricks/SF with 5% waste'
  ));
  
  // Test 4: Large CMU wall - 100' × 12'
  results.push(runTest(
    'MASONRY', 'CMU Block Count', 4,
    (l, h, w) => calculateCMUBlocks({ lengthFeet: l, heightFeet: h, blockWidthInches: w }),
    [100, 12, 8],
    { lengthFeet: 100, heightFeet: 12, blockWidthInches: 8 },
    1400, 1450,
    '100\' × 12\' wall with 5% waste'
  ));
  
  return results;
}

// ============================================
// CARPENTRY TRADE TESTS (CSI 06)
// ============================================

function runCarpentryTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Wall studs - 50' wall @ 16" O.C.
  // Formula: (50 × 12 / 16) + 1 × 1.10 = 42 studs
  results.push(runTest(
    'CARPENTRY', 'Stud Count', 1,
    (l, h, s) => calculateStudCount({ lengthFeet: l, heightFeet: h, studSpacingInches: s }),
    [50, 8, 16],
    { lengthFeet: 50, heightFeet: 8, studSpacingInches: 16 },
    40, 45,
    '50\' wall at 16" O.C. with 10% waste'
  ));
  
  // Test 2: Board feet - 2×4×8 × 100 pieces
  // Formula: (2 × 4 × 8) / 12 × 100 × 1.10 = 586.67 BF
  // (1 board foot = 144 cubic inches; with length in feet the divisor is 12.)
  results.push(runTest(
    'CARPENTRY', 'Board Feet', 2,
    calculateBoardFeet,
    [2, 4, 8, 100],
    { thicknessInches: 2, widthInches: 4, lengthFeet: 8, quantity: 100 },
    580.00, 590.00,
    '100 2×4×8 with 10% waste'
  ));
  
  // Test 3: Plywood sheets - 1000 SF
  // Formula: 1000 SF / 32 SF × 1.10 = 35 sheets
  results.push(runTest(
    'CARPENTRY', 'Plywood Sheets', 3,
    calculatePlywoodSheets,
    [1000, 32],
    { areaSF: 1000, sheetSizeSF: 32 },
    34, 36,
    '1000 SF at 32 SF/sheet with 10% waste'
  ));
  
  // Test 4: Wall studs at 24" O.C.
  results.push(runTest(
    'CARPENTRY', 'Stud Count', 4,
    (l, h, s) => calculateStudCount({ lengthFeet: l, heightFeet: h, studSpacingInches: s }),
    [100, 10, 24],
    { lengthFeet: 100, heightFeet: 10, studSpacingInches: 24 },
    55, 60,
    '100\' wall at 24" O.C. with 10% waste'
  ));
  
  return results;
}

// ============================================
// DRYWALL TRADE TESTS (CSI 09)
// ============================================

function runDrywallTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Drywall sheets - 1000 SF
  // Formula: 1000 SF / 32 SF × 1.10 = 35 sheets
  results.push(runTest(
    'DRYWALL', 'Sheet Count', 1,
    calculateDrywallSheets,
    [1000, 32],
    { areaSF: 1000, sheetSizeSF: 32 },
    34, 36,
    '1000 SF at 32 SF/sheet with 10% waste'
  ));
  
  // Test 2: Joint compound - 35 sheets
  // Formula: 35 × 0.5 × 1.10 = 20 gallons
  results.push(runTest(
    'DRYWALL', 'Joint Compound', 2,
    calculateJointCompoundGallons,
    [35],
    { sheetCount: 35 },
    19, 21,
    '35 sheets at 0.5 gal/sheet with 10% waste'
  ));
  
  // Test 3: Tape - 35 sheets
  // Formula: 35 × 40 × 1.10 = 1540 LF
  results.push(runTest(
    'DRYWALL', 'Tape Length', 3,
    calculateTapeLF,
    [35],
    { sheetCount: 35 },
    1530, 1550,
    '35 sheets at 40 LF/sheet with 10% waste'
  ));
  
  // Test 4: Large area - 5000 SF with 48 SF sheets
  results.push(runTest(
    'DRYWALL', 'Sheet Count', 4,
    calculateDrywallSheets,
    [5000, 48],
    { areaSF: 5000, sheetSizeSF: 48 },
    114, 116,
    '5000 SF at 48 SF/sheet with 10% waste'
  ));
  
  return results;
}

// ============================================
// ELECTRICAL TRADE TESTS (CSI 26)
// ============================================

function runElectricalTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Wire pull - 500 LF conduit, 3 wires, 5 boxes
  // Formula: (500 × 3) + (5 × 10) × 1.10 = 1705 LF
  results.push(runTest(
    'ELECTRICAL', 'Wire Pull Length', 1,
    (conduit, boxes, wires) => calculateWirePullLF({ conduitLengthLF: conduit, pullBoxCount: boxes, wiresPerRun: wires }),
    [500, 5, 3],
    { conduitLengthLF: 500, pullBoxCount: 5, wiresPerRun: 3 },
    1700, 1720,
    '500 LF conduit, 3 wires, 5 pull boxes with 10% waste'
  ));
  
  // Test 2: Circuit amps - 20 devices @ 100W, 120V
  // Formula: 20 × 100 / 120 = 16.67 amps
  results.push(runTest(
    'ELECTRICAL', 'Circuit Amperage', 2,
    (devices, watts, volts) => calculateCircuitAmps({ deviceCount: devices, wattsPerDevice: watts, voltage: volts }),
    [20, 100, 120],
    { deviceCount: 20, wattsPerDevice: 100, voltage: 120 },
    16.50, 16.80,
    '20 devices at 100W on 120V'
  ));
  
  // Test 3: Conduit length
  // Formula: 300 LF × 1.10 = 330 LF
  results.push(runTest(
    'ELECTRICAL', 'Conduit Length', 3,
    calculateConduitLF,
    [300],
    { routeLF: 300 },
    329, 331,
    '300 LF route with 10% waste'
  ));
  
  // Test 4: Device boxes - 50 outlets
  results.push(runTest(
    'ELECTRICAL', 'Device Boxes', 4,
    calculateDeviceBoxes,
    [50],
    { outletCount: 50 },
    52, 54,
    '50 outlets with 5% waste'
  ));
  
  return results;
}

// ============================================
// PLUMBING TRADE TESTS (CSI 22)
// ============================================

function runPlumbingTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Pipe length - 200 LF
  // Formula: 200 × 1.10 = 220 LF
  results.push(runTest(
    'PLUMBING', 'Pipe Length', 1,
    calculatePipeLF,
    [200],
    { lengthLF: 200 },
    219, 221,
    '200 LF with 10% waste'
  ));
  
  // Test 2: Pipe hangers - 100 LF of 2" pipe
  // Formula: 100 LF / 8 ft spacing + 1 × 1.05 = 14 hangers
  results.push(runTest(
    'PLUMBING', 'Pipe Hangers', 2,
    calculatePipeHangers,
    [100, 2],
    { lengthLF: 100, pipeDiameterInches: 2 },
    14, 16,
    '100 LF of 2" pipe at 8\' spacing with 5% waste'
  ));
  
  // Test 3: Small pipe hangers - 50 LF of 1/2" pipe
  // Formula: 50 LF / 6 ft spacing + 1 × 1.05 = 10 hangers
  results.push(runTest(
    'PLUMBING', 'Pipe Hangers', 3,
    calculatePipeHangers,
    [50, 0.5],
    { lengthLF: 50, pipeDiameterInches: 0.5 },
    9, 11,
    '50 LF of 1/2" pipe at 6\' spacing with 5% waste'
  ));
  
  // Test 4: Fixture count - 3 toilets, 4 sinks, 2 showers
  results.push(runTest(
    'PLUMBING', 'Fixture Count', 4,
    calculateFixtureCount,
    [3, 4, 2],
    { toilets: 3, sinks: 4, showers: 2 },
    9, 9,
    '3 toilets + 4 sinks + 2 showers'
  ));
  
  return results;
}

// ============================================
// HVAC TRADE TESTS (CSI 23)
// ============================================

function runHVACTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Rectangular duct SF - 50 LF × 12"W × 10"H
  // Formula: (2×12 + 2×10)/12 × 50 × 1.10 = 201.67 SF
  results.push(runTest(
    'HVAC', 'Duct Surface Area', 1,
    (l, w, h) => calculateDuctSF({ lengthLF: l, widthInches: w, heightInches: h }),
    [50, 12, 10],
    { lengthLF: 50, widthInches: 12, heightInches: 10 },
    200.00, 205.00,
    '50 LF of 12"×10" duct with 10% waste'
  ));
  
  // Test 2: Round duct SF - 30 LF × 8" diameter
  // Formula: π × 8/12 × 30 × 1.10 = 69.12 SF
  results.push(runTest(
    'HVAC', 'Round Duct SF', 2,
    calculateRoundDuctSF,
    [30, 8],
    { lengthLF: 30, diameterInches: 8 },
    68.00, 70.00,
    '30 LF of 8" round duct with 10% waste'
  ));
  
  // Test 3: CFM calculation - 2000 SF residential
  // Formula: 2000 × 1.0 = 2000 CFM
  results.push(runTest(
    'HVAC', 'CFM Calculation', 3,
    calculateCFM,
    [2000, false],
    { areaSF: 2000, commercial: false },
    2000, 2000,
    '2000 SF residential at 1 CFM/SF'
  ));
  
  // Test 4: HVAC tonnage - 2500 SF
  // Formula: 2500 / 500 = 5 tons
  results.push(runTest(
    'HVAC', 'HVAC Tonnage', 4,
    calculateHVACTons,
    [2500, 500],
    { areaSF: 2500, sfPerTon: 500 },
    5.0, 5.0,
    '2500 SF at 500 SF/ton'
  ));
  
  return results;
}

// ============================================
// FIRE PROTECTION TRADE TESTS (CSI 21)
// ============================================

function runFireProtectionTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Sprinkler heads - 3000 SF ordinary hazard
  // Formula: 3000 / 130 × 1.05 = 25 heads
  results.push(runTest(
    'FIRE_PROTECTION', 'Sprinkler Heads', 1,
    calculateSprinklerHeads,
    [3000, 'ordinary'],
    { areaSF: 3000, hazardLevel: 'ordinary' },
    24, 26,
    '3000 SF ordinary hazard at 130 SF/head with 5% waste'
  ));
  
  // Test 2: Sprinkler heads - 5000 SF light hazard
  // Formula: 5000 / 200 × 1.05 = 27 heads
  results.push(runTest(
    'FIRE_PROTECTION', 'Sprinkler Heads', 2,
    calculateSprinklerHeads,
    [5000, 'light'],
    { areaSF: 5000, hazardLevel: 'light' },
    26, 28,
    '5000 SF light hazard at 200 SF/head with 5% waste'
  ));
  
  // Test 3: Sprinkler pipe - 25 heads @ 15' avg
  // Formula: (25 × 15) + (25 × 15 × 0.3) × 1.05 = 512 LF
  results.push(runTest(
    'FIRE_PROTECTION', 'Sprinkler Pipe', 3,
    calculateSprinklerPipeLF,
    [25, 15],
    { headCount: 25, avgDistanceBetweenHeads: 15 },
    510, 520,
    '25 heads at 15\' avg with 5% waste'
  ));
  
  return results;
}

// ============================================
// LOW VOLTAGE TRADE TESTS (CSI 27/28)
// ============================================

function runLowVoltageTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Cable drops - 50 drops @ 100 LF avg
  // Formula: 50 × 100 × 1.15 = 5750 LF
  results.push(runTest(
    'LOW_VOLTAGE', 'Cable Drops', 1,
    calculateCableDropsLF,
    [50, 100],
    { dropCount: 50, avgDropLengthLF: 100 },
    5740, 5760,
    '50 drops at 100 LF avg with 15% waste'
  ));
  
  // Test 2: Patch panel ports - 48 active drops
  // Formula: 48 × 1.2 = 58 ports
  results.push(runTest(
    'LOW_VOLTAGE', 'Patch Panel Ports', 2,
    calculatePatchPanelPorts,
    [48],
    { activeDrops: 48 },
    57, 59,
    '48 active drops with 20% spare'
  ));
  
  // Test 3: LV conduit - 200 LF route
  // Formula: 200 × 1.15 = 230 LF
  results.push(runTest(
    'LOW_VOLTAGE', 'Conduit Length', 3,
    calculateLVConduitLF,
    [200],
    { routeLF: 200 },
    229, 231,
    '200 LF route with 15% waste'
  ));
  
  return results;
}

// ============================================
// LANDSCAPING TRADE TESTS (CSI 32)
// ============================================

function runLandscapingTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Mulch - 1000 SF × 3" depth
  // Formula: 1000 × 3/12 / 27 × 1.10 = 10.19 CY
  results.push(runTest(
    'LANDSCAPING', 'Mulch Volume', 1,
    calculateMulchCY,
    [1000, 3],
    { areaSF: 1000, depthInches: 3 },
    10.00, 10.50,
    '1000 SF at 3" depth with 10% waste'
  ));
  
  // Test 2: Topsoil - 500 SF × 4" depth
  // Formula: 500 × 4/12 / 27 × 1.10 = 6.79 CY
  results.push(runTest(
    'LANDSCAPING', 'Topsoil Volume', 2,
    calculateTopsoilCY,
    [500, 4],
    { areaSF: 500, depthInches: 4 },
    6.70, 7.00,
    '500 SF at 4" depth with 10% waste'
  ));
  
  // Test 3: Sod pallets - 2000 SF
  // Formula: 2000 / 450 × 1.10 = 5 pallets
  results.push(runTest(
    'LANDSCAPING', 'Sod Pallets', 3,
    calculateSodPallets,
    [2000, 450],
    { areaSF: 2000, sfPerPallet: 450 },
    5, 6,
    '2000 SF at 450 SF/pallet with 10% waste'
  ));
  
  // Test 4: Irrigation heads - 5000 SF @ 15' radius
  // Spacing = 15 × √2 = 21.21', coverage per head ≈ 450 SF
  results.push(runTest(
    'LANDSCAPING', 'Irrigation Heads', 4,
    calculateIrrigationHeads,
    [5000, 15],
    { areaSF: 5000, coverageRadiusFeet: 15 },
    12, 14,
    '5000 SF at 15\' coverage radius with 10% waste'
  ));
  
  return results;
}

// ============================================
// DEMOLITION TRADE TESTS (CSI 02)
// ============================================

function runDemolitionTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Demo haul-off - 1000 SF × 6" × 1.5 expansion
  // Formula: 1000 × 6/12 / 27 × 1.5 = 27.78 CY
  results.push(runTest(
    'DEMOLITION', 'Haul-off Volume', 1,
    calculateDemoHaulOffCY,
    [1000, 6, 1.5],
    { areaSF: 1000, depthInches: 6, expansionFactor: 1.5 },
    27.50, 28.50,
    '1000 SF at 6" with 1.5× expansion'
  ));
  
  // Test 2: Dumpster loads - 100 CY of debris
  // Formula: 100 / 20 = 5 loads
  results.push(runTest(
    'DEMOLITION', 'Dumpster Loads', 2,
    calculateDumpsterLoads,
    [100, 20],
    { totalCY: 100, dumpsterSizeCY: 20 },
    5, 5,
    '100 CY in 20 CY dumpsters'
  ));
  
  // Test 3: Large demo - 5000 SF × 12" × 2.0 expansion
  // Formula: 5000 × 12/12 / 27 × 2.0 = 370.37 CY
  results.push(runTest(
    'DEMOLITION', 'Haul-off Volume', 3,
    calculateDemoHaulOffCY,
    [5000, 12, 2.0],
    { areaSF: 5000, depthInches: 12, expansionFactor: 2.0 },
    369.00, 372.00,
    '5000 SF at 12" with 2.0× expansion'
  ));
  
  return results;
}

// ============================================
// PAINTING TRADE TESTS (CSI 09)
// ============================================

function runPaintingTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Paint gallons - 1000 SF, 2 coats @ 350 SF/gal
  // Formula: 1000 × 2 / 350 × 1.10 = 6.29 gallons
  results.push(runTest(
    'PAINTING', 'Paint Coverage', 1,
    (area, coats, coverage) => calculatePaintGallons({ areaSF: area, coats, coverageSFPerGallon: coverage }),
    [1000, 2, 350],
    { areaSF: 1000, coats: 2, coverageSFPerGallon: 350 },
    6.20, 6.40,
    '1000 SF, 2 coats at 350 SF/gal with 10% waste'
  ));
  
  // Test 2: Primer gallons - 2000 SF @ 350 SF/gal
  // Formula: 2000 / 350 × 1.10 = 6.29 gallons
  results.push(runTest(
    'PAINTING', 'Primer Coverage', 2,
    calculatePrimerGallons,
    [2000, 350],
    { areaSF: 2000, coverageSFPerGallon: 350 },
    6.20, 6.40,
    '2000 SF at 350 SF/gal with 10% waste'
  ));
  
  // Test 3: Stain gallons - 500 SF @ 250 SF/gal
  // Formula: 500 / 250 × 1.10 = 2.2 gallons
  results.push(runTest(
    'PAINTING', 'Stain Coverage', 3,
    calculateStainGallons,
    [500, 250],
    { areaSF: 500, coverageSFPerGallon: 250 },
    2.15, 2.25,
    '500 SF at 250 SF/gal with 10% waste'
  ));
  
  // Test 4: Large commercial paint job
  results.push(runTest(
    'PAINTING', 'Paint Coverage', 4,
    (area, coats, coverage) => calculatePaintGallons({ areaSF: area, coats, coverageSFPerGallon: coverage }),
    [10000, 2, 400],
    { areaSF: 10000, coats: 2, coverageSFPerGallon: 400 },
    54.00, 56.00,
    '10000 SF, 2 coats at 400 SF/gal with 10% waste'
  ));
  
  return results;
}

// ============================================
// FLOORING TRADE TESTS (CSI 09)
// ============================================

function runFlooringTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Flooring cartons - 1000 SF @ 20 SF/carton
  // Formula: ceil(1000 / 20 × 1.10) = 55 cartons
  results.push(runTest(
    'FLOORING', 'Carton Count', 1,
    calculateFlooringCartons,
    [1000, 20],
    { areaSF: 1000, sfPerCarton: 20 },
    54, 56,
    '1000 SF at 20 SF/carton with 10% waste'
  ));
  
  // Test 2: Flooring adhesive - 500 SF @ 100 SF/gal
  // Formula: ceil(500 / 100 × 1.10) = ceil(5.5) = 6 gallons (always rounds up for ordering)
  results.push(runTest(
    'FLOORING', 'Adhesive Gallons', 2,
    calculateFlooringAdhesiveGallons,
    [500, 100],
    { areaSF: 500, coverageSFPerGallon: 100 },
    6, 6,
    '500 SF at 100 SF/gal with 10% waste (ceil rounds up)'
  ));
  
  // Test 3: Carpet square yards - 1000 SF
  // Formula: ceil(1000 / 9 × 1.10) = 123 SY
  results.push(runTest(
    'FLOORING', 'Carpet SY', 3,
    calculateCarpetSY,
    [1000],
    { areaSF: 1000 },
    122, 124,
    '1000 SF carpet with 10% waste'
  ));
  
  // Test 4: Large flooring job
  results.push(runTest(
    'FLOORING', 'Carton Count', 4,
    calculateFlooringCartons,
    [5000, 25],
    { areaSF: 5000, sfPerCarton: 25 },
    219, 221,
    '5000 SF at 25 SF/carton with 10% waste'
  ));
  
  return results;
}

// ============================================
// CROSS-TRADE CONSISTENCY TESTS
// ============================================

function runCrossTradeTests(): TestResult[] {
  const results: TestResult[] = [];
  
  // Test 1: Concrete slab area should match wire mesh and rebar quantities
  const slabArea = 1000;
  const concreteCY = calculateConcreteSlabCY({ areaSF: slabArea, thicknessInches: 4 });
  const meshRolls = calculateWireMeshRolls(slabArea, 150);
  const rebarPieces = calculateRebarPieces(slabArea, 12, 20);
  
  // Concrete, mesh, and rebar should all scale proportionally
  const meshCoverageRatio = meshRolls * 150 / slabArea;
  
  results.push(runTest(
    'CROSS-TRADE', 'Slab Proportionality', 1,
    () => meshCoverageRatio,
    [],
    { slabAreaSF: slabArea, meshRolls, concreteCY },
    1.00, 1.20,
    'Wire mesh coverage ratio should be ~1.1× (10% waste)'
  ));
  
  // Test 2: CMU wall should align with mortar
  const cmuBlocks = calculateCMUBlocks({ lengthFeet: 50, heightFeet: 10, blockWidthInches: 8 });
  const mortarBags = calculateMortarBags(cmuBlocks);
  const blocksPerBag = cmuBlocks / mortarBags;
  
  results.push(runTest(
    'CROSS-TRADE', 'CMU-Mortar Ratio', 2,
    () => blocksPerBag,
    [],
    { cmuBlocks, mortarBags },
    32.00, 38.00,
    'Blocks per mortar bag should be ~35'
  ));
  
  // Test 3: Sprinkler coverage should match pipe length
  const sprinklerHeads = calculateSprinklerHeads(5000, 'ordinary');
  const sprinklerPipe = calculateSprinklerPipeLF(sprinklerHeads, 15);
  const pipePerHead = sprinklerPipe / sprinklerHeads;
  
  results.push(runTest(
    'CROSS-TRADE', 'Sprinkler Pipe-Head Ratio', 3,
    () => pipePerHead,
    [],
    { sprinklerHeads, sprinklerPipeLF: sprinklerPipe },
    18.00, 22.00,
    'Pipe per head should be ~20 LF (branch + main)'
  ));
  
  // Test 4: Drywall sheets should align with tape and compound
  const drywallSheets = calculateDrywallSheets(1000, 32);
  const jointCompound = calculateJointCompoundGallons(drywallSheets);
  const tapeLF = calculateTapeLF(drywallSheets);
  const compoundPerSheet = jointCompound / drywallSheets;
  const tapePerSheet = tapeLF / drywallSheets;
  
  results.push(runTest(
    'CROSS-TRADE', 'Drywall Material Ratios', 4,
    () => compoundPerSheet,
    [],
    { drywallSheets, jointCompoundGallons: jointCompound, tapeLF },
    0.50, 0.60,
    'Compound per sheet should be ~0.55 gallons'
  ));
  
  results.push(runTest(
    'CROSS-TRADE', 'Drywall Material Ratios', 5,
    () => tapePerSheet,
    [],
    { drywallSheets, jointCompoundGallons: jointCompound, tapeLF },
    42.00, 46.00,
    'Tape per sheet should be ~44 LF'
  ));
  
  return results;
}

// ============================================
// RUN ALL TESTS AND GENERATE REPORT
// ============================================

export interface VerificationSummary {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: string;
  results: TestResult[];
  byTrade: Record<string, { passed: number; failed: number; total: number }>;
}

export function runAllVerificationTests(): VerificationSummary {
  const allResults: TestResult[] = [
    ...runConcreteTests(),
    ...runEarthworkTests(),
    ...runAsphaltTests(),
    ...runRoofingTests(),
    ...runMasonryTests(),
    ...runCarpentryTests(),
    ...runDrywallTests(),
    ...runElectricalTests(),
    ...runPlumbingTests(),
    ...runHVACTests(),
    ...runFireProtectionTests(),
    ...runLowVoltageTests(),
    ...runLandscapingTests(),
    ...runDemolitionTests(),
    ...runPaintingTests(),
    ...runFlooringTests(),
    ...runCrossTradeTests(),
  ];
  
  const passed = allResults.filter(r => r.result === 'PASS').length;
  const failed = allResults.filter(r => r.result === 'FAIL').length;
  
  const byTrade: Record<string, { passed: number; failed: number; total: number }> = {};
  allResults.forEach(r => {
    if (!byTrade[r.trade]) {
      byTrade[r.trade] = { passed: 0, failed: 0, total: 0 };
    }
    byTrade[r.trade].total++;
    if (r.result === 'PASS') {
      byTrade[r.trade].passed++;
    } else {
      byTrade[r.trade].failed++;
    }
  });
  
  return {
    totalTests: allResults.length,
    passed,
    failed,
    passRate: `${((passed / allResults.length) * 100).toFixed(1)}%`,
    results: allResults,
    byTrade,
  };
}

export function printVerificationReport(summary: VerificationSummary): void {
  logInfo('\n========================================');
  logInfo('MATERIAL CALCULATOR VERIFICATION REPORT');
  logInfo('========================================\n');
  
  logInfo(`Total Tests: ${summary.totalTests}`);
  logInfo(`Passed: ${summary.passed}`);
  logInfo(`Failed: ${summary.failed}`);
  logInfo(`Pass Rate: ${summary.passRate}\n`);
  
  logInfo('By Trade:');
  logInfo('----------------------------------------');
  Object.entries(summary.byTrade).forEach(([trade, stats]) => {
    const status = stats.failed === 0 ? '✓' : '✗';
    logInfo(`${status} ${trade}: ${stats.passed}/${stats.total} passed`);
  });
  
  if (summary.failed > 0) {
    logInfo('\n----------------------------------------');
    logInfo('FAILED TESTS:');
    logInfo('----------------------------------------');
    summary.results.filter(r => r.result === 'FAIL').forEach(r => {
      logInfo(`\n[${r.trade}] – ${r.scope} – TEST #${r.testNumber}`);
      logInfo(`INPUTS: ${JSON.stringify(r.inputs)}`);
      logInfo(`EXPECTED: ${r.expected}`);
      logInfo(`ACTUAL: ${r.actual}`);
      logInfo(`RESULT: ${r.result}`);
      if (r.note) logInfo(`NOTE: ${r.note}`);
    });
  }
  
  logInfo('\n========================================');
  logInfo('END OF VERIFICATION REPORT');
  logInfo('========================================\n');
}

// Export the complete verification suite
export const CALCULATION_VERIFICATION_SUITE = {
  concrete: runConcreteTests,
  earthwork: runEarthworkTests,
  asphalt: runAsphaltTests,
  roofing: runRoofingTests,
  masonry: runMasonryTests,
  carpentry: runCarpentryTests,
  drywall: runDrywallTests,
  electrical: runElectricalTests,
  plumbing: runPlumbingTests,
  hvac: runHVACTests,
  fireProtection: runFireProtectionTests,
  lowVoltage: runLowVoltageTests,
  landscaping: runLandscapingTests,
  demolition: runDemolitionTests,
  crossTrade: runCrossTradeTests,
  runAll: runAllVerificationTests,
  printReport: printVerificationReport,
};

export default CALCULATION_VERIFICATION_SUITE;
