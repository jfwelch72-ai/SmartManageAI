import { describe, it, expect } from "vitest";

import { calculateMaterials } from "../materialCalculator";
import { buildLineItemFormulaBreakdowns } from "../materialFormulaBreakdown";

/**
 * The breakdown helper must mirror the on-screen MaterialCalculator,
 * which itself wraps `calculateMaterials`. Each test below first runs
 * `calculateMaterials` to obtain the canonical numbers, then feeds the
 * resulting line-item-shaped object into `buildLineItemFormulaBreakdowns`
 * and asserts that the rendered "result" matches. This guarantees the
 * PDF can never silently disagree with the calculator.
 */
describe("buildLineItemFormulaBreakdowns", () => {
  it("returns an empty list when no calculator switches are active", () => {
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "SF",
    });
    expect(blocks).toEqual([]);
  });

  it("concrete slab block matches calculateMaterials (100 SF × 4\")", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "SF",
      concreteDepthInches: 4,
      concreteWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "SF",
      concreteDepthInches: 4,
      concreteWasteFactor: 10,
      calculatedConcreteYards: r.calculatedConcreteYards!,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toContain("Concrete");
    expect(blocks[0].result).toBeCloseTo(r.calculatedConcreteYards!, 2);
    expect(blocks[0].resultUnit).toBe("Cubic Yards");
    // The "Convert to cubic yards" step should be present.
    expect(blocks[0].steps.some((s) => s.label.includes("cubic yards"))).toBe(true);
  });

  it("concrete linear (curb) block uses LF formula", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "LF",
      concreteDepthInches: 8,
      dimensionWidthInches: 6,
      dimensionHeightInches: 8,
      concreteWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "LF",
      concreteDepthInches: 8,
      dimensionWidthInches: 6,
      dimensionHeightInches: 8,
      concreteWasteFactor: 10,
      calculatedConcreteYards: r.calculatedConcreteYards!,
    });
    expect(blocks[0].title).toContain("Linear");
    expect(blocks[0].formula).toContain("LF");
    expect(blocks[0].result).toBeCloseTo(r.calculatedConcreteYards!, 2);
  });

  it("stone block honors stoneType density (compacted base ≠ crushed)", () => {
    const compacted = calculateMaterials({
      quantity: 100,
      unit: "SF",
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "SF",
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      calculatedStoneTons: compacted.calculatedStoneTons!,
    });
    const stone = blocks.find((b) => b.title.startsWith("Stone"))!;
    expect(stone.result).toBeCloseTo(compacted.calculatedStoneTons!, 2);
    // Density step should mention 1.6 t/yd³ for compacted base.
    expect(stone.steps.some((s) => s.calculation?.includes("1.6"))).toBe(true);
    expect(stone.steps.some((s) => s.label.includes("Compacted Base"))).toBe(true);
  });

  it("rebar block reflects the +1 endpoint bar fix (100 SF @ 12\" → 13)", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "SF",
      requiresRebar: true,
      rebarSpacingInches: 12,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "SF",
      requiresRebar: true,
      rebarSpacingInches: 12,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
      calculatedRebarCount: r.calculatedRebarCount!,
    });
    const rebar = blocks.find((b) => b.title.startsWith("Rebar"))!;
    expect(rebar.result).toBe(13);
    expect(rebar.steps.some((s) => s.label.includes("+1 endpoint"))).toBe(true);
  });

  it("dowel block reflects the +1 endpoint dowel fix (100 LF @ 12\" → 101)", () => {
    const r = calculateMaterials({
      quantity: 0,
      unit: "EA",
      requiresDowels: true,
      dowelSpacingInches: 12,
      jointLengthFeet: 100,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 0,
      unit: "EA",
      requiresDowels: true,
      dowelSpacingInches: 12,
      jointLengthFeet: 100,
      calculatedDowelCount: r.calculatedDowelCount!,
    });
    const dowel = blocks[0];
    expect(dowel.title).toContain("Dowel");
    expect(dowel.result).toBe(101);
  });

  it("excavation trench block uses LF formula and matches calculator", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "LF",
      requiresExcavation: true,
      excavationWidthInches: 12,
      excavationDepthInches: 24,
      excavationSwellFactor: 25,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "LF",
      requiresExcavation: true,
      excavationWidthInches: 12,
      excavationDepthInches: 24,
      excavationSwellFactor: 25,
      calculatedExcavationYards: r.calculatedExcavationYards!,
    });
    const exc = blocks.find((b) => b.title.startsWith("Excavation"))!;
    expect(exc.formula).toContain("Width");
    expect(exc.result).toBeCloseTo(r.calculatedExcavationYards!, 2);
  });

  it("wire mesh block matches the rolls-needed value", () => {
    const r = calculateMaterials({
      quantity: 1000,
      unit: "SF",
      requiresWireMesh: true,
      wireMeshCoverageSF: 150,
      wireMeshWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 1000,
      unit: "SF",
      requiresWireMesh: true,
      wireMeshCoverageSF: 150,
      wireMeshWasteFactor: 10,
      calculatedWireMeshRolls: r.calculatedWireMeshRolls!,
    });
    const mesh = blocks[0];
    expect(mesh.title).toContain("Wire Mesh");
    expect(mesh.result).toBe(8);
  });

  it("sealer block matches calculateMaterials gallons", () => {
    const r = calculateMaterials({
      quantity: 1000,
      unit: "SF",
      requiresSealer: true,
      sealerCoats: 1,
      sealerCoverageSFPerGallon: 200,
      sealerWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 1000,
      unit: "SF",
      requiresSealer: true,
      sealerCoats: 1,
      sealerCoverageSFPerGallon: 200,
      sealerWasteFactor: 10,
      calculatedSealerGallons: r.calculatedSealerGallons!,
    });
    const sealer = blocks[0];
    expect(sealer.title).toContain("Sealer");
    expect(sealer.result).toBeCloseTo(r.calculatedSealerGallons!, 2);
  });

  it("underlayment uses the 10' roll overlap factor (1155 SF for 1000 SF + 6\" + 10%)", () => {
    const r = calculateMaterials({
      quantity: 1000,
      unit: "SF",
      requiresUnderlayment: true,
      underlaymentOverlapInches: 6,
      underlaymentWasteFactor: 10,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 1000,
      unit: "SF",
      requiresUnderlayment: true,
      underlaymentOverlapInches: 6,
      underlaymentWasteFactor: 10,
      calculatedUnderlaymentSF: r.calculatedUnderlaymentSF!,
    });
    const ul = blocks[0];
    expect(ul.title).toContain("Underlayment");
    expect(ul.result).toBeCloseTo(1155, 0);
    // Overlap factor step: 1.05 (the bug-fix value, not 1.125).
    expect(ul.steps.some((s) => s.value === "1.0500")).toBe(true);
  });

  it("returns multiple blocks when several calculator branches are active", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "SF",
      concreteDepthInches: 4,
      concreteWasteFactor: 10,
      requiresStoneBase: true,
      stoneType: "CRUSHED_STONE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      requiresExcavation: true,
      excavationDepthInches: 6,
      excavationSwellFactor: 25,
    });
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: 100,
      unit: "SF",
      concreteDepthInches: 4,
      concreteWasteFactor: 10,
      calculatedConcreteYards: r.calculatedConcreteYards!,
      requiresStoneBase: true,
      stoneType: "CRUSHED_STONE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      calculatedStoneTons: r.calculatedStoneTons!,
      requiresExcavation: true,
      excavationDepthInches: 6,
      excavationSwellFactor: 25,
      calculatedExcavationYards: r.calculatedExcavationYards!,
    });
    expect(blocks.map((b) => b.title.split(" ")[0])).toEqual([
      "Concrete",
      "Stone",
      "Excavation",
    ]);
  });

  it("accepts decimal-string inputs (drizzle returns decimals as strings)", () => {
    const blocks = buildLineItemFormulaBreakdowns({
      quantity: "100",
      unit: "SF",
      concreteDepthInches: "4.00",
      concreteWasteFactor: "10",
      calculatedConcreteYards: "1.36",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].result).toBeCloseTo(1.36, 2);
  });
});
