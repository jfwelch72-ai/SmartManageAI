import { describe, it, expect } from 'vitest';

import {
  calculateMaterials,
  STONE_DENSITIES_TONS_PER_CY,
  type MaterialCalculationInputs,
} from '../materialCalculator';
import {
  calculateConcreteSlabCY,
  calculateConcreteFootingCY,
  calculateConcreteWallCY,
  calculateRebarPieces,
  calculateWireMeshRolls,
  calculateExcavationCY,
  calculateTrenchExcavationCY,
  calculateStoneBaseTons,
  calculateAsphaltTons,
  calculateRoofingSquares,
  calculateFlatRoofSquares,
  calculateDrywallSheets,
  calculateBoardFeet,
  calculatePaintGallons,
  calculateStudCount,
  calculateCMUBlocks,
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
