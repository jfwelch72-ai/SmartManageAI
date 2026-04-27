import { describe, it, expect } from 'vitest';

import {
  aggregateEquipmentRequirements,
  aggregateMaterialRequirements,
  calculateMaterials,
  STONE_DENSITIES_TONS_PER_CY,
  type MaterialCalculationInputs,
} from '../materialCalculator';
import type { EstimateLineItem } from '@shared/schema';
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
  calculateMortarBags,
  calculateBrickCount,
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
  calculateBoardFeet,
  calculatePaintGallons,
  calculatePrimerGallons,
  calculateStainGallons,
  calculateStudCount,
  calculateCMUBlocks,
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
  validatePositive,
  validateNonNegative,
  validateRange,
  TradeCalculators,
} from '../tradeCalculators';

/**
 * Canonical material-calculator tests.
 *
 * Covers every formula the bid feedback flagged (concrete CY, asphalt tons,
 * rebar LF, lumber BF, drywall sheets, paint gallons, roofing squares,
 * stone tons by type, dowels, underlayment, sealer) plus the four bugs
 * fixed in this task:
 *
 *   • Stone tons must respect `stoneType` (compacted base ≠ pea gravel).
 *   • Rebar grid count must include the endpoint bar (+1 per direction).
 *   • Dowel count must include the endpoint dowel (+1).
 *   • Underlayment overlap factor is on 10' rolls — `(overlap/12) / 10`,
 *     not `overlap/48`.
 *   • Roofing area = footprint × pitchMultiplier (NOT × 2).
 *
 * Each block hand-derives the expected number so the test doubles as
 * documentation for the formula and its waste-factor handling.
 */

const baseInputs = (overrides: Partial<MaterialCalculationInputs>): MaterialCalculationInputs => ({
  quantity: 0,
  unit: 'SF',
  ...overrides,
});

describe('server/materialCalculator → calculateMaterials', () => {
  describe('Concrete (CY)', () => {
    it('100 SF × 4" slab × 10% waste → 1.36 CY', () => {
      // 100 SF × (4/12) ft = 33.333 CF → /27 = 1.2346 CY → ×1.10 = 1.358 → 1.36
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'SF',
        concreteDepthInches: 4,
        concreteWasteFactor: 10,
      }));
      expect(r.calculatedConcreteYards).toBeCloseTo(1.36, 2);
    });

    it('100 LF × 6"W × 8"H curb × 10% waste → 1.36 CY', () => {
      // The LF branch is gated on `concreteDepthInches` being set — it's
      // the "I am asking for concrete" flag, while width/height carry the
      // section dimensions for a curb / footing run.
      // 100 × 0.5 × 0.667 = 33.33 CF → /27 = 1.23 CY → ×1.10 = 1.36
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'LF',
        concreteDepthInches: 8,
        dimensionWidthInches: 6,
        dimensionHeightInches: 8,
        concreteWasteFactor: 10,
      }));
      expect(r.calculatedConcreteYards).toBeCloseTo(1.36, 2);
    });

    it('larger waste factor produces more concrete', () => {
      const tenPct = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF', concreteDepthInches: 4, concreteWasteFactor: 10,
      })).calculatedConcreteYards!;
      const twentyPct = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF', concreteDepthInches: 4, concreteWasteFactor: 20,
      })).calculatedConcreteYards!;
      // 20% waste should add ~10% more than 10%-waste result
      expect(twentyPct).toBeGreaterThan(tenPct);
      expect(twentyPct).toBeCloseTo(tenPct * (1.20 / 1.10), 2);
    });
  });

  describe('Stone base (Tons) — density by stoneType', () => {
    const inputs = (stoneType: string | null) => baseInputs({
      quantity: 100,
      unit: 'SF',
      requiresStoneBase: true,
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      stoneType,
    });

    it('CRUSHED_STONE @ 1.5 t/CY → 2.04 tons for 100 SF × 4"', () => {
      // 100 × 4/12 / 27 = 1.2346 CY × 1.10 × 1.5 = 2.037 → 2.04
      const r = calculateMaterials(inputs('CRUSHED_STONE'));
      expect(r.calculatedStoneTons).toBeCloseTo(2.04, 2);
    });

    it('COMPACTED_BASE @ 1.6 t/CY produces more tons than crushed', () => {
      const compacted = calculateMaterials(inputs('COMPACTED_BASE'));
      const crushed = calculateMaterials(inputs('CRUSHED_STONE'));
      expect(compacted.calculatedStoneTons!).toBeGreaterThan(crushed.calculatedStoneTons!);
      // 1.2346 × 1.10 × 1.6 = 2.173 → 2.17
      expect(compacted.calculatedStoneTons).toBeCloseTo(2.17, 2);
    });

    it('LIMESTONE @ 1.35 t/CY produces fewer tons than crushed', () => {
      const limestone = calculateMaterials(inputs('LIMESTONE'));
      // 1.2346 × 1.10 × 1.35 = 1.833 → 1.83
      expect(limestone.calculatedStoneTons).toBeCloseTo(1.83, 2);
    });

    it('falls back to default density when stoneType is unknown / null', () => {
      const r = calculateMaterials(inputs(null));
      // Defaults to crushed (1.5)
      expect(r.calculatedStoneTons).toBeCloseTo(2.04, 2);
      expect(STONE_DENSITIES_TONS_PER_CY.CRUSHED_STONE).toBe(1.5);
    });

    it('stoneType is case-insensitive', () => {
      const r = calculateMaterials(inputs('crushed_stone'));
      expect(r.calculatedStoneTons).toBeCloseTo(2.04, 2);
    });
  });

  describe('Excavation (CY) with swell factor', () => {
    it('100 SF × 6" × 25% swell → 2.31 CY', () => {
      // 100 × 0.5 / 27 = 1.852 × 1.25 = 2.315 → 2.31 (banker's rounding may vary)
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'SF',
        requiresExcavation: true,
        excavationDepthInches: 6,
        excavationSwellFactor: 25,
      }));
      expect(r.calculatedExcavationYards).toBeCloseTo(2.31, 2);
    });

    it('LF trench: 100 LF × 12"W × 24"D × 25% swell → 9.26 CY', () => {
      // 100 × 1 × 2 = 200 CF → 7.407 CY × 1.25 = 9.26
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'LF',
        requiresExcavation: true,
        excavationWidthInches: 12,
        excavationDepthInches: 24,
        excavationSwellFactor: 25,
      }));
      expect(r.calculatedExcavationYards).toBeCloseTo(9.26, 2);
    });
  });

  describe('Wire mesh (Rolls)', () => {
    it('1000 SF × 10% waste / 150 SF per roll → ceiling material req of 8 rolls', () => {
      // 1000 × 1.10 = 1100 / 150 = 7.333… → server ceils to 2 decimals (7.34),
      // but the materialRequirements quantity rounds up to whole rolls (8).
      const r = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresWireMesh: true,
        wireMeshCoverageSF: 150,
        wireMeshWasteFactor: 10,
      }));
      const meshReq = r.materialRequirements.find(m => m.item === 'Wire Mesh');
      expect(meshReq?.quantity).toBe(8);
    });
  });

  describe('Rebar (Pieces) — endpoint bar fix', () => {
    it('100 SF slab @ 12" O.C. with 10% waste needs 13 bars (was 11 before fix)', () => {
      // side = √100 = 10 ft
      // bars/dir = ceil(10/1) + 1 = 11
      // totalBars = 22, totalLF = 220, withWaste = 242
      // bars needed = ceil(242/20) = 13
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'SF',
        requiresRebar: true,
        rebarSpacingInches: 12,
        rebarLengthFeet: 20,
        rebarWasteFactor: 10,
      }));
      expect(r.calculatedRebarCount).toBe(13);
      expect(r.calculatedRebarLinearFeet).toBeCloseTo(242, 0);
    });

    it('1000 SF slab @ 18" O.C. — endpoint bar still applied', () => {
      // side = √1000 ≈ 31.6228 ft
      // spacingFt = 1.5
      // bars/dir = ceil(31.6228/1.5) + 1 = ceil(21.082) + 1 = 22 + 1 = 23
      // totalBars = 46, totalLF = 46 × 31.6228 = 1454.65, ×1.10 = 1600.11
      // bars needed = ceil(1600.11/20) = 81
      const r = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresRebar: true,
        rebarSpacingInches: 18,
        rebarLengthFeet: 20,
        rebarWasteFactor: 10,
      }));
      expect(r.calculatedRebarCount).toBe(81);
    });
  });

  describe('Dowels (Pieces) — endpoint dowel fix', () => {
    it('100 LF joint @ 12" O.C. needs 101 dowels (was 100 before fix)', () => {
      const r = calculateMaterials(baseInputs({
        quantity: 0,
        unit: 'EA',
        requiresDowels: true,
        dowelSpacingInches: 12,
        jointLengthFeet: 100,
      }));
      expect(r.calculatedDowelCount).toBe(101);
    });

    it('derives joint length from a square slab when not provided', () => {
      // 100 SF → side=10, perimeter=40 LF; @12" → ceil(40)+1 = 41
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'SF',
        requiresDowels: true,
        dowelSpacingInches: 12,
      }));
      expect(r.calculatedDowelCount).toBe(41);
    });
  });

  describe('Sealer (Gallons)', () => {
    it('1000 SF × 1 coat × 200 SF/gal × 10% waste → 5.50 gal', () => {
      // 1000 × 1.10 = 1100 / 200 = 5.5
      const r = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresSealer: true,
        sealerCoats: 1,
        sealerCoverageSFPerGallon: 200,
        sealerWasteFactor: 10,
      }));
      expect(r.calculatedSealerGallons).toBeCloseTo(5.5, 2);
    });

    it('two coats roughly doubles the gallon count', () => {
      const oneCoat = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresSealer: true,
        sealerCoats: 1,
        sealerCoverageSFPerGallon: 200,
        sealerWasteFactor: 10,
      }));
      const twoCoats = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresSealer: true,
        sealerCoats: 2,
        sealerCoverageSFPerGallon: 200,
        sealerWasteFactor: 10,
      }));
      expect(twoCoats.calculatedSealerGallons).toBeCloseTo(
        oneCoat.calculatedSealerGallons! * 2,
        2,
      );
    });
  });

  describe("Underlayment (SF) — 10' polyethylene rolls", () => {
    it('1000 SF × 6" overlap × 10% waste → 1155 SF (5% overlap, not 12.5%)', () => {
      // overlapFactor = 1 + (6/12)/10 = 1.05
      // sf with overlap = 1050; +10% waste = 1155
      const r = calculateMaterials(baseInputs({
        quantity: 1000,
        unit: 'SF',
        requiresUnderlayment: true,
        underlaymentOverlapInches: 6,
        underlaymentWasteFactor: 10,
      }));
      expect(r.calculatedUnderlaymentSF).toBeCloseTo(1155, 0);
    });

    it('larger overlap → more material (overlap factor scales linearly)', () => {
      const sixIn = calculateMaterials(baseInputs({
        quantity: 1000, unit: 'SF',
        requiresUnderlayment: true,
        underlaymentOverlapInches: 6,
        underlaymentWasteFactor: 10,
      })).calculatedUnderlaymentSF!;
      const twelveIn = calculateMaterials(baseInputs({
        quantity: 1000, unit: 'SF',
        requiresUnderlayment: true,
        underlaymentOverlapInches: 12,
        underlaymentWasteFactor: 10,
      })).calculatedUnderlaymentSF!;
      // 12" overlap factor 1.10 vs 6" overlap factor 1.05
      expect(twelveIn).toBeGreaterThan(sixIn);
      expect(twelveIn).toBeCloseTo(1000 * 1.10 * 1.10, 0);
    });
  });

  describe('Edge cases', () => {
    it('zero quantity returns null for calculated material values', () => {
      const r = calculateMaterials(baseInputs({
        quantity: 0,
        unit: 'SF',
        concreteDepthInches: 4,
      }));
      expect(r.calculatedConcreteYards).toBeNull();
    });

    it('mismatched unit (CY) does not run SF-only formulas', () => {
      const r = calculateMaterials(baseInputs({
        quantity: 100,
        unit: 'CY',
        requiresWireMesh: true,
      }));
      expect(r.calculatedWireMeshRolls).toBeNull();
    });
  });

  /**
   * 0% waste must mean 0% waste — not "fall back to the industry default".
   *
   * For each material that accepts a waste/swell factor we assert that
   * passing an explicit `0` (or `"0"`) produces the unwasted base
   * quantity and that omitting the field falls back to the documented
   * industry default. This is the regression net for the
   * "Make 0% waste actually mean 0% waste" task.
   */
  describe('Explicit 0% waste / swell is honored (not silently defaulted)', () => {
    it('Concrete: 0% waste returns the un-wasted base CY', () => {
      // 100 SF × 4/12 = 33.333 CF → /27 = 1.2346 CY → with 0% waste = 1.23
      const zero = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF', concreteDepthInches: 4,
        concreteWasteFactor: 0,
      }));
      expect(zero.calculatedConcreteYards).toBeCloseTo(1.23, 2);

      // Same calc with the field omitted → falls back to 10% default = 1.36
      const omitted = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF', concreteDepthInches: 4,
      }));
      expect(omitted.calculatedConcreteYards).toBeCloseTo(1.36, 2);

      // String "0" is treated the same as numeric 0
      const zeroString = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF', concreteDepthInches: 4,
        concreteWasteFactor: '0',
      }));
      expect(zeroString.calculatedConcreteYards).toBeCloseTo(1.23, 2);
    });

    it('Stone: 0% waste returns the un-wasted base tons', () => {
      // 100 SF × 4/12 / 27 × 1.5 = 1.852 tons → with 0% waste = 1.85
      const r = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        requiresStoneBase: true,
        stoneDepthInches: 4,
        stoneType: 'CRUSHED_STONE',
        stoneWasteFactor: 0,
      }));
      expect(r.calculatedStoneTons).toBeCloseTo(1.85, 2);
    });

    it('Excavation: 0% swell returns the in-ground volume', () => {
      // 100 SF × 6/12 / 27 = 1.852 CY → with 0% swell = 1.85
      const r = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        requiresExcavation: true,
        excavationDepthInches: 6,
        excavationSwellFactor: 0,
      }));
      expect(r.calculatedExcavationYards).toBeCloseTo(1.85, 2);
    });

    it('Wire mesh: 0% waste does not pad the area', () => {
      // 1000 SF / 150 SF/roll = 6.6667 → ceil to 2 dec = 6.67 → req rounds to 7
      const r = calculateMaterials(baseInputs({
        quantity: 1000, unit: 'SF',
        requiresWireMesh: true,
        wireMeshCoverageSF: 150,
        wireMeshWasteFactor: 0,
      }));
      const meshReq = r.materialRequirements.find(m => m.item === 'Wire Mesh');
      expect(meshReq?.quantity).toBe(7);
    });

    it('Rebar: 0% waste reduces the LF and bar count vs the 10% default', () => {
      // side = √100 = 10 ft; bars/dir = ceil(10/1)+1 = 11; total bars = 22
      // total LF = 22 × 10 = 220 → with 0% waste = 220 → bars = ceil(220/20) = 11
      const r = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        requiresRebar: true,
        rebarSpacingInches: 12,
        rebarLengthFeet: 20,
        rebarWasteFactor: 0,
      }));
      expect(r.calculatedRebarLinearFeet).toBeCloseTo(220, 0);
      expect(r.calculatedRebarCount).toBe(11);

      // Sanity: with the field omitted we still get the documented 10%-waste result.
      const omitted = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        requiresRebar: true,
        rebarSpacingInches: 12,
        rebarLengthFeet: 20,
      }));
      expect(omitted.calculatedRebarCount).toBe(13);
    });

    it('Sealer: 0% waste returns the un-wasted base gallons', () => {
      // 1000 SF × 1 coat / 200 SF/gal = 5.00 gal — no waste padding
      const r = calculateMaterials(baseInputs({
        quantity: 1000, unit: 'SF',
        requiresSealer: true,
        sealerCoats: 1,
        sealerCoverageSFPerGallon: 200,
        sealerWasteFactor: 0,
      }));
      expect(r.calculatedSealerGallons).toBeCloseTo(5.0, 2);
    });

    it('Underlayment: 0% waste keeps just the overlap factor', () => {
      // overlapFactor = 1 + (6/12)/10 = 1.05 → 1000 × 1.05 = 1050 SF
      const r = calculateMaterials(baseInputs({
        quantity: 1000, unit: 'SF',
        requiresUnderlayment: true,
        underlaymentOverlapInches: 6,
        underlaymentWasteFactor: 0,
      }));
      expect(r.calculatedUnderlaymentSF).toBeCloseTo(1050, 0);
    });

    it('Empty-string waste / swell still falls back to the industry default', () => {
      // The form ships strings, and an empty input must not be treated as 0%.
      const r = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        concreteDepthInches: 4,
        concreteWasteFactor: '',
      }));
      expect(r.calculatedConcreteYards).toBeCloseTo(1.36, 2);
    });

    it('Material requirement notes reflect the chosen waste % (including 0)', () => {
      const r = calculateMaterials(baseInputs({
        quantity: 100, unit: 'SF',
        concreteDepthInches: 4,
        concreteWasteFactor: 0,
      }));
      const req = r.materialRequirements.find(m => m.item === 'Ready Mix Concrete');
      // The note string is what the calculator UI surfaces back to the user,
      // so 0 must show up here verbatim — never "10% waste factor".
      expect(req?.notes).toContain('0% waste factor');
      expect(req?.notes).not.toContain('10% waste factor');
    });
  });
});

describe('server/tradeCalculators — canonical examples', () => {
  describe('Concrete', () => {
    it('slab: 1000 SF × 4" × 10% waste → 13.58 CY', () => {
      // 1000 × 4/12 = 333.33 CF → 12.346 CY × 1.10 = 13.58
      expect(calculateConcreteSlabCY({
        areaSF: 1000,
        thicknessInches: 4,
      })).toBeCloseTo(13.58, 2);
    });

    it('footing: 100 LF × 16"W × 8"D × 10% waste → 3.62 CY', () => {
      // 100 × 16/12 × 8/12 = 88.889 CF → 3.292 CY × 1.10 = 3.62
      expect(calculateConcreteFootingCY({
        lengthLF: 100,
        widthInches: 16,
        depthInches: 8,
      })).toBeCloseTo(3.62, 2);
    });

    it('wall: 50 LF × 8 ft × 8" × 10% waste → 10.86 CY', () => {
      // 50 × 8 × 8/12 = 266.67 CF → 9.876 CY × 1.10 = 10.86
      expect(calculateConcreteWallCY({
        lengthLF: 50,
        heightFeet: 8,
        thicknessInches: 8,
      })).toBeCloseTo(10.86, 2);
    });
  });

  describe('Asphalt (tons) — 2.025 t/CY', () => {
    it('1000 SF × 3" × 5% waste → 19.69 tons', () => {
      // 1000 × 3/12 = 250 CF → 9.259 CY × 2.025 = 18.75 t × 1.05 = 19.69
      expect(calculateAsphaltTons({
        areaSF: 1000,
        thicknessInches: 3,
      })).toBeCloseTo(19.69, 2);
    });

    it('rejects thickness outside 1–12 inch industry range', () => {
      expect(() => calculateAsphaltTons({ areaSF: 100, thicknessInches: 0.5 })).toThrow();
      expect(() => calculateAsphaltTons({ areaSF: 100, thicknessInches: 24 })).toThrow();
    });
  });

  describe('Roofing (squares)', () => {
    it('flat roof = footprint / 100 × 1.10 (no double counting)', () => {
      // 1000 SF flat → 10 sq × 1.10 = 11 sq
      expect(calculateFlatRoofSquares(1000)).toBeCloseTo(11, 2);
    });

    it('6/12 pitch on 1000 SF footprint → 12.30 squares (not 24.60)', () => {
      // multiplier = √(144+36)/12 = √180/12 = 1.118
      // area = 1118 SF, /100 = 11.18 sq, ×1.10 = 12.30
      // The historic *2 bug would have produced ~24.60 here.
      const sq = calculateRoofingSquares({ footprintSF: 1000, pitchRise: 6 });
      expect(sq).toBeCloseTo(12.30, 2);
      expect(sq).toBeLessThan(20);
    });

    it('flat (0/12) pitch matches calculateFlatRoofSquares', () => {
      const pitched = calculateRoofingSquares({ footprintSF: 1000, pitchRise: 0 });
      const flat = calculateFlatRoofSquares(1000);
      expect(pitched).toBeCloseTo(flat, 2);
    });
  });

  describe('Rebar pieces — trade calculator', () => {
    it('uses endpoint bar (+1) so 100 SF @ 12" needs > 11 bars', () => {
      // bars/dir = ceil(10/1)+1 = 11; totalLF = 22 × 10 × 1.1 (overlap) = 242
      // bars = ceil(242/20) = 13; ×(1+0.10 waste) = ceil(14.3) = 15
      const bars = calculateRebarPieces(100, 12);
      expect(bars).toBeGreaterThanOrEqual(13);
    });
  });

  describe('Wire mesh rolls — trade calculator', () => {
    it('1000 SF / 150 SF/roll × 10% waste → 8 rolls', () => {
      // 1000 × 1.10 / 150 = 7.33 → ceil = 8
      expect(calculateWireMeshRolls(1000)).toBe(8);
    });
  });

  describe('Stone base tons — trade calculator', () => {
    it('1000 SF × 4" × 10% waste × 1.5 t/CY → 20.37 tons', () => {
      // 1000 × 4/12 / 27 = 12.346 CY × 1.10 × 1.5 = 20.37
      expect(calculateStoneBaseTons(1000, 4)).toBeCloseTo(20.37, 2);
    });
  });

  describe('Excavation', () => {
    it('flat: 1000 SF × 6" × 25% swell → 23.15 CY', () => {
      // 500 CF / 27 = 18.52 × 1.25 = 23.15
      expect(calculateExcavationCY({ areaSF: 1000, depthInches: 6 })).toBeCloseTo(23.15, 1);
    });

    it('trench: 100 LF × 12"W × 24"D × 25% swell → 9.26 CY', () => {
      expect(calculateTrenchExcavationCY({
        lengthLF: 100,
        widthInches: 12,
        depthInches: 24,
      })).toBeCloseTo(9.26, 2);
    });
  });

  describe('Drywall sheets', () => {
    it('1000 SF / 32 SF (4×8) × 10% waste → 35 sheets', () => {
      // 1000 / 32 = 31.25 × 1.10 = 34.38 → ceil = 35
      expect(calculateDrywallSheets(1000)).toBe(35);
    });

    it('1000 SF / 48 SF (4×12) × 10% waste → 23 sheets', () => {
      // 1000 / 48 = 20.83 × 1.10 = 22.92 → ceil = 23
      expect(calculateDrywallSheets(1000, 48)).toBe(23);
    });
  });

  describe('Lumber board feet', () => {
    it('one 2"×4"×8\' = 5.33 BF before waste → 5.87 BF with 10%', () => {
      // BF = (Thickness_in × Width_in × Length_ft) / 12
      //    = (2 × 4 × 8) / 12 = 5.333 BF
      // With 10% framing waste → 5.87.
      expect(calculateBoardFeet(2, 4, 8, 1)).toBeCloseTo(5.87, 2);
    });

    it('one 2"×6"×10\' = 10 BF before waste → 11.00 BF with 10%', () => {
      // (2 × 6 × 10) / 12 = 10.0 → ×1.10 = 11.00
      expect(calculateBoardFeet(2, 6, 10, 1)).toBeCloseTo(11.0, 2);
    });

    it('ten 2"×6"×10\' = 100 BF before waste → 110.00 BF with 10%', () => {
      // (2 × 6 × 10 × 10) / 12 = 100 → ×1.10 = 110.00
      expect(calculateBoardFeet(2, 6, 10, 10)).toBeCloseTo(110.0, 2);
    });

    it('quantity scales linearly', () => {
      const one = calculateBoardFeet(2, 6, 10, 1);
      const ten = calculateBoardFeet(2, 6, 10, 10);
      expect(ten).toBeCloseTo(one * 10, 2);
    });
  });

  describe('Paint gallons', () => {
    it('1000 SF × 2 coats × 350 SF/gal × 10% waste → 6.29 gal', () => {
      // 2000 / 350 = 5.714 × 1.10 = 6.286 → ceil(*100)/100 = 6.29
      expect(calculatePaintGallons({
        areaSF: 1000,
        coats: 2,
        coverageSFPerGallon: 350,
      })).toBeCloseTo(6.29, 2);
    });
  });

  describe('Framing studs', () => {
    it('20 LF wall × 16" O.C. → ceil(20×12/16)+1 = 16 studs × 1.10 → 18', () => {
      // ceil(240/16)+1 = 15+1 = 16, ×1.10 = 17.6 → ceil = 18
      expect(calculateStudCount({
        lengthFeet: 20,
        heightFeet: 8,
        studSpacingInches: 16,
      })).toBe(18);
    });
  });

  describe('CMU blocks', () => {
    it('100 SF wall × 1.125 blocks/SF × 5% waste → 119 blocks', () => {
      // 100 × 1.125 = 112.5 × 1.05 = 118.13 → ceil = 119
      expect(calculateCMUBlocks({
        lengthFeet: 10,
        heightFeet: 10,
        blockWidthInches: 8,
      })).toBe(119);
    });
  });
});

/**
 * Trade-calculator coverage for the remaining helpers in
 * `server/tradeCalculators.ts` that the existing block above did not pin down.
 *
 * Each describe block cites the formula and the industry-standard constant
 * baked into the helper, the same way the concrete / asphalt / roofing tests
 * above do. Numbers are hand-derived in the comments so a reviewer can
 * verify the math without re-running the suite.
 *
 * Constants codified in `tradeCalculators.ts` and exercised here:
 *   • CONVERSIONS.CF_PER_CY          = 27   (cubic ft / cubic yd)
 *   • CONVERSIONS.INCHES_PER_FOOT    = 12
 *   • CONVERSIONS.SF_PER_SY          = 9
 *   • CONVERSIONS.TONS_PER_CY_STONE  = 1.5
 *   • CONVERSIONS.TONS_PER_CY_ASPHALT= 2.025
 *   • Roof coating: 1604 mil-SF / gallon (1 gal @ 1 mil covers 1604 SF)
 *   • Standard CMU coverage: 1.125 blocks / SF (8" × 16" w/ 3/8" mortar)
 *   • Modular brick coverage: 6.75 bricks / SF (3.5" × 7.5" face)
 *   • Mortar yield: ~1 70-lb bag per 35 CMU
 *   • Drywall: 0.5 gal joint compound + 40 LF tape per sheet (3-coat)
 *   • Carpet: 12' rolls sold by SY (= SF / 9)
 *   • Sod: 450 SF / pallet
 *   • Pipe-hanger spacing: ≤1"→6 ft, ≤3"→8 ft, >3"→10 ft (MSS SP-58)
 *   • Sprinkler density: light=200 SF/head, ordinary=130, extra=100 (NFPA 13)
 *   • HVAC rule of thumb: 500 SF / ton, rounded up to nearest 0.5 ton
 *   • CFM rule of thumb: 1.0 CFM/SF residential, 1.5 CFM/SF commercial
 *
 * Waste/safety factors used (from `WASTE_FACTORS`):
 *   asphalt 5%, masonry 5%, insulation 5%, fireProtection 5%
 *   concrete/rebar/wireMesh/stone/roofing/framing/drywall/flooring/paint/
 *   electrical/plumbing/hvac/landscaping 10%
 *   excavation 25% (swell), lowVoltage 15%
 */
describe('server/tradeCalculators — additional helper coverage', () => {
  describe('Earthwork — calculateFillCY', () => {
    it('1000 SF × 6" × 1.15 compaction → 21.30 CY', () => {
      // 1000 × 6/12 = 500 CF → /27 = 18.5185 CY × 1.15 = 21.296 → 21.30
      expect(calculateFillCY(1000, 6)).toBeCloseTo(21.30, 2);
    });

    it('custom compaction factor scales linearly', () => {
      // No compaction (1.0) → 18.52 CY; default 1.15 should be 15% larger.
      const noCompact = calculateFillCY(1000, 6, 1.0);
      const default115 = calculateFillCY(1000, 6);
      expect(default115).toBeCloseTo(noCompact * 1.15, 1);
    });
  });

  describe('Asphalt extras', () => {
    it('calculateStripingGallons: 4000 LF / 400 LF/gal × 10% paint waste → 11', () => {
      // 4000/400 = 10 gal, ×1.10 = 11 → ceil = 11
      expect(calculateStripingGallons(4000)).toBe(11);
    });

    it('calculateStripingGallons rounds fractional gallons up', () => {
      // 1000/400 = 2.5 × 1.10 = 2.75 → ceil = 3
      expect(calculateStripingGallons(1000)).toBe(3);
    });

    it('calculateSealcoatGallons: 6000 SF × 2 coats / 60 SF/gal × 5% waste → 210', () => {
      // 6000 × 2 = 12000; 12000/60 = 200; ×1.05 = 210 → ceil = 210
      expect(calculateSealcoatGallons(6000)).toBe(210);
    });

    it('calculateSealcoatGallons rejects coats outside 1–4 range', () => {
      expect(() => calculateSealcoatGallons(1000, 60, 0)).toThrow();
      expect(() => calculateSealcoatGallons(1000, 60, 5)).toThrow();
    });
  });

  describe('Roof coatings — 1604 mil-SF / gallon', () => {
    it('generic: 1000 SF × 20 mil × 10% waste → 13.72 gal', () => {
      // (1000 × 20) / 1604 = 12.469 × 1.10 = 13.716 → 13.72
      expect(calculateRoofCoatingGallons({ areaSF: 1000, milThickness: 20 })).toBeCloseTo(13.72, 2);
    });

    it('silicone defaults to 20 mil → matches generic helper', () => {
      expect(calculateSiliconeCoatingGallons(1000)).toBeCloseTo(13.72, 2);
    });

    it('acrylic defaults to 20 mil → matches generic helper', () => {
      expect(calculateAcrylicCoatingGallons(1000)).toBeCloseTo(13.72, 2);
    });

    it('polyurea defaults to 50 mil (heavy build) → 34.29 gal', () => {
      // (1000 × 50)/1604 = 31.172 × 1.10 = 34.289 → 34.29
      expect(calculatePolyureaCoatingGallons(1000)).toBeCloseTo(34.29, 2);
    });

    it('elastomeric defaults to 16 mil → 10.97 gal', () => {
      // (1000 × 16)/1604 = 9.975 × 1.10 = 10.972 → 10.97
      expect(calculateElastomericCoatingGallons(1000)).toBeCloseTo(10.97, 2);
    });

    it('rejects mil thickness outside 5–100 range', () => {
      expect(() => calculateRoofCoatingGallons({ areaSF: 1000, milThickness: 4 })).toThrow();
      expect(() => calculateRoofCoatingGallons({ areaSF: 1000, milThickness: 101 })).toThrow();
    });
  });

  describe('Masonry extras', () => {
    it('calculateMortarBags: 350 blocks / 35 per bag × 5% waste → 11', () => {
      // 350/35 = 10 bags; ×1.05 = 10.5 → ceil = 11
      expect(calculateMortarBags(350)).toBe(11);
    });

    it('calculateBrickCount: 100 SF × 6.75 bricks/SF × 5% waste → 709', () => {
      // 100 × 6.75 = 675; ×1.05 = 708.75 → ceil = 709
      expect(calculateBrickCount(100)).toBe(709);
    });
  });

  describe('Carpentry — calculatePlywoodSheets', () => {
    it('1000 SF / 32 SF (4×8) × 10% framing waste → 35 sheets', () => {
      // 1000/32 = 31.25; ×1.10 = 34.375 → ceil = 35
      expect(calculatePlywoodSheets(1000)).toBe(35);
    });

    it('custom 4×4 = 16 SF half-sheets → 69 sheets for the same 1000 SF', () => {
      // 1000/16 = 62.5; ×1.10 = 68.75 → ceil = 69
      expect(calculatePlywoodSheets(1000, 16)).toBe(69);
    });
  });

  describe('Drywall finishing extras', () => {
    it('calculateJointCompoundGallons: 100 sheets × 0.5 gal × 10% waste → 55', () => {
      // 100 × 0.5 = 50 gallons before waste; ×1.10 = 55 mathematically.
      // ceilWithEpsilon snaps the IEEE-754 noise away so we don't bill an
      // estimator for an extra gallon on clean round-number inputs.
      expect(calculateJointCompoundGallons(100)).toBe(55);
    });

    it('calculateTapeLF: 100 sheets × 40 LF/sheet × 10% waste → 4400', () => {
      // 100 × 40 = 4000; ×1.10 = 4400 → ceil = 4400
      expect(calculateTapeLF(100)).toBe(4400);
    });
  });

  describe('Insulation', () => {
    it('calculateBattInsulationSF: 1000 SF × 5% insulation waste → 1050', () => {
      expect(calculateBattInsulationSF(1000)).toBe(1050);
    });

    it('calculateSprayFoamBoardFeet: 1000 SF × 3" thickness × 5% waste → 3150 BF', () => {
      // SF × inches = board feet; ×1.05 = 3150
      expect(calculateSprayFoamBoardFeet(1000, 3)).toBe(3150);
    });

    it('calculateBlownInsulationBags: 900 SF / 30 SF/bag × 5% waste → 32', () => {
      // 900/30 = 30 bags; ×1.05 = 31.5 → ceil = 32
      expect(calculateBlownInsulationBags(900)).toBe(32);
    });
  });

  describe('Flooring', () => {
    it('calculateFlooringCartons: 1000 SF / 20 SF per carton × 10% waste → 55', () => {
      // 1000/20 = 50 cartons before waste; ×1.10 = 55 mathematically.
      // ceilWithEpsilon strips the IEEE-754 fuzz so we land on the textbook
      // answer instead of charging the estimator for an extra carton.
      expect(calculateFlooringCartons(1000)).toBe(55);
    });

    it('calculateCarpetSY: 900 SF / 9 SF per SY × 10% waste → 110', () => {
      // 900/9 = 100 SY exactly; ×1.10 = 110 mathematically. ceilWithEpsilon
      // absorbs the floating-point noise so a clean 100 SY input does not
      // bill an extra square yard.
      expect(calculateCarpetSY(900)).toBe(110);
    });

    it('calculateFlooringAdhesiveGallons: 1000 SF / 100 SF per gal × 10% waste → 11', () => {
      // 1000/100 = 10 gal; ×1.10 = 11 → ceil = 11
      expect(calculateFlooringAdhesiveGallons(1000)).toBe(11);
    });
  });

  describe('Painting — primer & stain wrappers', () => {
    it('calculatePrimerGallons: 1000 SF / 350 SF/gal × 1 coat × 10% waste → 3.15 gal', () => {
      // 1000/350 = 2.857 × 1.10 = 3.143 → ceil(*100)/100 = 3.15
      expect(calculatePrimerGallons(1000)).toBeCloseTo(3.15, 2);
    });

    it('calculateStainGallons: 1000 SF / 250 SF/gal × 1 coat × 10% waste → 4.40 gal', () => {
      // 1000/250 = 4.0; ×1.10 = 4.40 mathematically. ceilWithEpsilon strips
      // the IEEE-754 noise on `4.4 × 100` so the result lands on the
      // textbook 4.40 instead of being bumped up to 4.41.
      expect(calculateStainGallons(1000)).toBeCloseTo(4.40, 2);
    });
  });

  describe('Electrical (CSI 26)', () => {
    it('calculateWirePullLF: 100 LF conduit × 3 wires + 2 boxes × 10 LF, ×10% waste → 352 LF', () => {
      // (100 × 3) + (2 × 10) = 320; ×1.10 = 352 → ceil = 352
      expect(calculateWirePullLF({
        conduitLengthLF: 100,
        pullBoxCount: 2,
        wiresPerRun: 3,
      })).toBe(352);
    });

    it('calculateWirePullLF allows zero pull boxes', () => {
      // 100 × 1 = 100; ×1.10 = 110 mathematically. ceilWithEpsilon ignores
      // IEEE-754 noise so a clean 100 LF / 1-wire pull lands on 110, not
      // 111. Also validates the pull-box term reduces to zero when
      // pullBoxCount is 0.
      expect(calculateWirePullLF({
        conduitLengthLF: 100,
        pullBoxCount: 0,
        wiresPerRun: 1,
      })).toBe(110);
    });

    it('calculateCircuitAmps: 10 devices × 100 W / 120 V → 8.33 A', () => {
      // 1000W / 120V = 8.333… → round to 2 decimals = 8.33
      expect(calculateCircuitAmps({
        deviceCount: 10,
        wattsPerDevice: 100,
        voltage: 120,
      })).toBeCloseTo(8.33, 2);
    });

    it('calculateCircuitAmps: 5 devices × 1000 W / 240 V → 20.83 A', () => {
      // 5000 / 240 = 20.833 → 20.83
      expect(calculateCircuitAmps({
        deviceCount: 5,
        wattsPerDevice: 1000,
        voltage: 240,
      })).toBeCloseTo(20.83, 2);
    });

    it('calculateConduitLF: 100 LF route × 10% electrical waste → 110', () => {
      // 100 × 1.10 = 110 mathematically. ceilWithEpsilon strips the
      // IEEE-754 fuzz so a clean 100 LF route does not bill an extra LF.
      expect(calculateConduitLF(100)).toBe(110);
    });

    it('calculateDeviceBoxes: 20 outlets × half-waste (5%) → 21', () => {
      // outletCount × (1 + 0.10 × 0.5) = 20 × 1.05 = 21 → ceil = 21
      expect(calculateDeviceBoxes(20)).toBe(21);
    });
  });

  describe('Plumbing (CSI 22)', () => {
    it('calculatePipeLF: 100 LF × 10% fittings/waste → 110', () => {
      // 100 × 1.10 = 110 mathematically. ceilWithEpsilon strips the
      // IEEE-754 fuzz so 100 LF of pipe doesn't get billed for 111 LF.
      expect(calculatePipeLF(100)).toBe(110);
    });

    it('calculatePipeHangers: small (≤1") pipe — 6 ft spacing per MSS SP-58', () => {
      // 60 LF / 6 ft = 10; +1 endpoint = 11; ×1.05 half-waste = 11.55 → ceil = 12
      expect(calculatePipeHangers(60, 1)).toBe(12);
    });

    it('calculatePipeHangers: medium (1.5"–3") pipe — 8 ft spacing', () => {
      // 80/8 = 10; +1 = 11; ×1.05 = 11.55 → ceil = 12
      expect(calculatePipeHangers(80, 2)).toBe(12);
    });

    it('calculatePipeHangers: large (4"+) pipe — 10 ft spacing', () => {
      // 100/10 = 10; +1 = 11; ×1.05 = 11.55 → ceil = 12
      expect(calculatePipeHangers(100, 4)).toBe(12);
    });

    it('calculateFixtureCount: simple sum across toilets/sinks/showers', () => {
      expect(calculateFixtureCount(3, 4, 2)).toBe(9);
      expect(calculateFixtureCount(0, 0, 0)).toBe(0);
    });

    it('calculateFixtureCount rejects negative counts', () => {
      expect(() => calculateFixtureCount(-1, 0, 0)).toThrow();
    });
  });

  describe('HVAC (CSI 23)', () => {
    it('calculateDuctSF rectangular: 100 LF × 24"W × 12"H, ×10% waste → 660 SF', () => {
      // perimeter ft = (2×24 + 2×12) / 12 = 72/12 = 6 ft
      // surface = 6 × 100 = 600; ×1.10 = 660.00
      expect(calculateDuctSF({
        lengthLF: 100,
        widthInches: 24,
        heightInches: 12,
      })).toBeCloseTo(660, 2);
    });

    it('calculateRoundDuctSF: 100 LF × 12" diameter, ×10% waste → 345.58 SF', () => {
      // circumference ft = π × 12 / 12 = π ≈ 3.14159
      // surface = π × 100 = 314.159; ×1.10 = 345.575 → 345.58
      expect(calculateRoundDuctSF(100, 12)).toBeCloseTo(345.58, 2);
    });

    it('calculateCFM: 1.0 CFM/SF residential, 1.5 CFM/SF commercial', () => {
      expect(calculateCFM(1000)).toBe(1000);
      expect(calculateCFM(1000, true)).toBe(1500);
    });

    it('calculateHVACTons: 1000 SF / 500 SF per ton → 2.0 tons exactly', () => {
      // 1000/500 = 2.0; ceil(2.0 × 2)/2 = 4/2 = 2.0
      expect(calculateHVACTons(1000)).toBe(2);
    });

    it('calculateHVACTons rounds UP to the nearest 0.5 ton', () => {
      // 1100/500 = 2.2 → ceil(4.4)/2 = 5/2 = 2.5
      expect(calculateHVACTons(1100)).toBe(2.5);
      // 600/500 = 1.2 → ceil(2.4)/2 = 3/2 = 1.5
      expect(calculateHVACTons(600)).toBe(1.5);
    });
  });

  describe('Fire Protection (CSI 21) — NFPA 13 head densities', () => {
    it('light hazard: 200 SF/head — 1000 SF × 5% waste → 6 heads', () => {
      // 1000/200 = 5 heads; ×1.05 = 5.25 → ceil = 6
      expect(calculateSprinklerHeads(1000, 'light')).toBe(6);
    });

    it('ordinary hazard (default): 130 SF/head — 1000 SF → 9 heads', () => {
      // ceil(1000/130) = 8 heads; ×1.05 = 8.4 → ceil = 9
      expect(calculateSprinklerHeads(1000)).toBe(9);
      expect(calculateSprinklerHeads(1000, 'ordinary')).toBe(9);
    });

    it('extra hazard: 100 SF/head — 1000 SF → 11 heads', () => {
      // 1000/100 = 10 heads; ×1.05 = 10.5 → ceil = 11
      expect(calculateSprinklerHeads(1000, 'extra')).toBe(11);
    });

    it('calculateSprinklerPipeLF: 10 heads × 15 ft branch + 30% main, ×5% waste → 205', () => {
      // branch = 10 × 15 = 150; main = 150 × 0.3 = 45; total = 195; ×1.05 = 204.75 → ceil = 205
      expect(calculateSprinklerPipeLF(10)).toBe(205);
    });
  });

  describe('Low Voltage (CSI 27/28) — 15% lowVoltage waste', () => {
    it('calculateCableDropsLF: 20 drops × 100 LF avg × 15% waste → 2300 LF', () => {
      // 20 × 100 = 2000; ×1.15 = 2300 → ceil = 2300
      expect(calculateCableDropsLF(20)).toBe(2300);
    });

    it('calculatePatchPanelPorts: 20 active drops × 1.20 spare → 24 ports', () => {
      expect(calculatePatchPanelPorts(20)).toBe(24);
      // 25 × 1.2 = 30 → ceil = 30
      expect(calculatePatchPanelPorts(25)).toBe(30);
    });

    it('calculateLVConduitLF: 100 LF route × 15% waste → 115', () => {
      expect(calculateLVConduitLF(100)).toBe(115);
    });
  });

  describe('Landscaping (CSI 32)', () => {
    it('calculateMulchCY: 1000 SF × 3" default depth × 10% waste → 10.19 CY', () => {
      // 1000 × 3/12 = 250 CF; /27 = 9.2593 CY; ×1.10 = 10.185 → 10.19
      expect(calculateMulchCY(1000)).toBeCloseTo(10.19, 2);
    });

    it('calculateMulchCY rejects depth outside 1–12 inch range', () => {
      expect(() => calculateMulchCY(1000, 0.5)).toThrow();
      expect(() => calculateMulchCY(1000, 13)).toThrow();
    });

    it('calculateTopsoilCY: shares the mulch formula but defaults to 4" depth → 13.58 CY', () => {
      // 1000 × 4/12 = 333.33 CF; /27 = 12.346 CY; ×1.10 = 13.580 → 13.58
      expect(calculateTopsoilCY(1000)).toBeCloseTo(13.58, 2);
    });

    it('calculateSodPallets: 1800 SF / 450 SF per pallet × 10% waste → 5 pallets', () => {
      // 1800/450 = 4 pallets; ×1.10 = 4.4 → ceil = 5
      expect(calculateSodPallets(1800)).toBe(5);
    });

    it('calculateIrrigationHeads: 4500 SF, 15 ft radius (head-to-head) → 11 heads', () => {
      // spacing = 15 × √2; coverage per head = (15√2)² = 450 SF
      // 4500/450 = 10 heads; ×1.10 = 11 → ceil = 11
      expect(calculateIrrigationHeads(4500)).toBe(11);
    });
  });

  describe('Demolition (CSI 02)', () => {
    it('calculateDemoHaulOffCY: 1000 SF × 6" × 1.5 expansion → 27.78 CY', () => {
      // solid CF = 500; /27 = 18.5185 CY; ×1.5 expansion = 27.778 → 27.78
      expect(calculateDemoHaulOffCY(1000, 6)).toBeCloseTo(27.78, 2);
    });

    it('calculateDemoHaulOffCY rejects expansion factors outside 1.0–3.0', () => {
      expect(() => calculateDemoHaulOffCY(1000, 6, 0.9)).toThrow();
      expect(() => calculateDemoHaulOffCY(1000, 6, 3.1)).toThrow();
    });

    it('calculateDumpsterLoads: 50 CY / 20 CY default dumpster → 3 loads', () => {
      // 50/20 = 2.5 → ceil = 3
      expect(calculateDumpsterLoads(50)).toBe(3);
    });

    it('calculateDumpsterLoads honours custom 30 CY dumpster size', () => {
      // 50/30 = 1.667 → ceil = 2
      expect(calculateDumpsterLoads(50, 30)).toBe(2);
    });
  });

  describe('Validation helpers', () => {
    it('validatePositive throws on zero and negatives, accepts > 0', () => {
      expect(() => validatePositive(0, 'X')).toThrow(/X must be greater than zero/);
      expect(() => validatePositive(-1, 'X')).toThrow();
      expect(() => validatePositive(0.0001, 'X')).not.toThrow();
    });

    it('validateNonNegative throws only on negatives, allows zero', () => {
      expect(() => validateNonNegative(-0.0001, 'X')).toThrow(/X cannot be negative/);
      expect(() => validateNonNegative(0, 'X')).not.toThrow();
      expect(() => validateNonNegative(5, 'X')).not.toThrow();
    });

    it('validateRange enforces inclusive bounds', () => {
      expect(() => validateRange(0, 1, 10, 'X')).toThrow(/X must be between 1 and 10/);
      expect(() => validateRange(11, 1, 10, 'X')).toThrow();
      expect(() => validateRange(1, 1, 10, 'X')).not.toThrow();
      expect(() => validateRange(10, 1, 10, 'X')).not.toThrow();
    });
  });

  describe('TradeCalculators export', () => {
    it('exposes every helper covered by these tests on the default object', () => {
      // Sanity check that the bundled object stays in sync with the named
      // exports. If a new calculator is added but not registered here, this
      // test will catch the omission before the API drifts.
      const required = [
        'calculateConcreteSlabCY', 'calculateConcreteFootingCY', 'calculateConcreteWallCY',
        'calculateRebarPieces', 'calculateWireMeshRolls',
        'calculateExcavationCY', 'calculateTrenchExcavationCY', 'calculateStoneBaseTons', 'calculateFillCY',
        'calculateAsphaltTons', 'calculateStripingGallons', 'calculateSealcoatGallons',
        'calculateRoofingSquares', 'calculateFlatRoofSquares', 'calculateRoofCoatingGallons',
        'calculateSiliconeCoatingGallons', 'calculateAcrylicCoatingGallons',
        'calculatePolyureaCoatingGallons', 'calculateElastomericCoatingGallons',
        'calculateCMUBlocks', 'calculateMortarBags', 'calculateBrickCount',
        'calculateStudCount', 'calculateBoardFeet', 'calculatePlywoodSheets',
        'calculateDrywallSheets', 'calculateJointCompoundGallons', 'calculateTapeLF',
        'calculateBattInsulationSF', 'calculateSprayFoamBoardFeet', 'calculateBlownInsulationBags',
        'calculateFlooringCartons', 'calculateCarpetSY', 'calculateFlooringAdhesiveGallons',
        'calculatePaintGallons', 'calculatePrimerGallons', 'calculateStainGallons',
        'calculateWirePullLF', 'calculateCircuitAmps', 'calculateConduitLF', 'calculateDeviceBoxes',
        'calculatePipeLF', 'calculatePipeHangers', 'calculateFixtureCount',
        'calculateDuctSF', 'calculateRoundDuctSF', 'calculateCFM', 'calculateHVACTons',
        'calculateSprinklerHeads', 'calculateSprinklerPipeLF',
        'calculateCableDropsLF', 'calculatePatchPanelPorts', 'calculateLVConduitLF',
        'calculateMulchCY', 'calculateTopsoilCY', 'calculateSodPallets', 'calculateIrrigationHeads',
        'calculateDemoHaulOffCY', 'calculateDumpsterLoads',
        'validatePositive', 'validateNonNegative', 'validateRange',
      ] as const;

      for (const name of required) {
        expect(typeof (TradeCalculators as Record<string, unknown>)[name]).toBe('function');
      }
    });
  });
});

describe('server/materialCalculator → aggregate{Material,Equipment}Requirements', () => {
  // Both aggregators read JSON columns off `EstimateLineItem` rows. The
  // bug fixed in this task was that `safeJsonParse(..., null)` returned
  // `null` when the JSON was absent or unparseable — and the downstream
  // `for (const req of requirements)` would then throw at runtime. The
  // fallback is now `[]` (and the local type is tightened) so the bad
  // row is silently skipped instead of taking the whole aggregation
  // down with it.
  const lineItem = (overrides: Partial<EstimateLineItem>): EstimateLineItem =>
    ({
      materialRequirementsJson: null,
      equipmentRequirementsJson: null,
      ...overrides,
    }) as EstimateLineItem;

  describe('aggregateMaterialRequirements', () => {
    it('returns [] when every row has a null JSON column', () => {
      expect(
        aggregateMaterialRequirements([lineItem({}), lineItem({})]),
      ).toEqual([]);
    });

    it('skips rows whose JSON is unparseable instead of throwing', () => {
      const items = [
        lineItem({ materialRequirementsJson: 'not-json{' }),
        lineItem({
          materialRequirementsJson: JSON.stringify([
            { category: 'Concrete', item: 'Ready Mix', unit: 'CY', quantity: 5 },
          ]),
        }),
      ];
      expect(() => aggregateMaterialRequirements(items)).not.toThrow();
      const out = aggregateMaterialRequirements(items);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ item: 'Ready Mix', quantity: 5 });
    });

    it('aggregates same-key requirements across rows', () => {
      const make = (qty: number) =>
        lineItem({
          materialRequirementsJson: JSON.stringify([
            { category: 'Concrete', item: 'Ready Mix', unit: 'CY', quantity: qty },
          ]),
        });
      const out = aggregateMaterialRequirements([make(3), make(4)]);
      expect(out).toHaveLength(1);
      expect(out[0].quantity).toBe(7);
    });
  });

  describe('aggregateEquipmentRequirements', () => {
    it('returns [] when every row has a null JSON column', () => {
      expect(
        aggregateEquipmentRequirements([lineItem({}), lineItem({})]),
      ).toEqual([]);
    });

    it('skips rows whose JSON is unparseable instead of throwing', () => {
      const items = [
        lineItem({ equipmentRequirementsJson: '{bad' }),
        lineItem({
          equipmentRequirementsJson: JSON.stringify([
            { category: 'Earthwork', item: 'Excavator', hours: 8 },
          ]),
        }),
      ];
      expect(() => aggregateEquipmentRequirements(items)).not.toThrow();
      const out = aggregateEquipmentRequirements(items);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ item: 'Excavator', hours: 8 });
    });

    it('aggregates same-key equipment hours across rows', () => {
      const make = (hours: number) =>
        lineItem({
          equipmentRequirementsJson: JSON.stringify([
            { category: 'Earthwork', item: 'Excavator', hours },
          ]),
        });
      const out = aggregateEquipmentRequirements([make(8), make(4)]);
      expect(out).toHaveLength(1);
      expect(out[0].hours).toBe(12);
    });
  });
});
