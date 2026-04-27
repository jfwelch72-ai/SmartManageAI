import { describe, it, expect } from "vitest";

import { calculateMaterials } from "../materialCalculator";
// PDF generator import path (`server/estimate-pdf-service.ts`).
import {
  buildLineItemFormulaBreakdowns as buildFromServer,
  type FormulaBlock,
} from "../materialFormulaBreakdown";
// On-screen MaterialCalculator import path (`client/src/components/MaterialCalculator.tsx`).
import { buildLineItemFormulaBreakdowns as buildFromShared } from "@shared/materialFormulaBreakdown";

/**
 * Regression test for Task #2088.
 *
 * The on-screen Material Calculator and the estimate PDF exporter both
 * render formula breakdowns. Historically each one hand-rolled its own
 * step list, and the only thing keeping them in sync was the test suite
 * that pinned both to `calculateMaterials`. Now both paths consume the
 * same shared helper from `shared/materialFormulaBreakdown.ts`; this
 * test makes the lock-step explicit by:
 *
 *   1. Importing the helper through the *server* re-export
 *      (`server/materialFormulaBreakdown.ts`) — the path the PDF
 *      exporter uses.
 *   2. Importing the helper through the *shared* path
 *      (`@shared/materialFormulaBreakdown`) — the path the React
 *      component uses.
 *   3. Asserting that for a representative line item their outputs are
 *      byte-equal (deep-equal + JSON-stringify match), so a future
 *      formula tweak can never produce on-screen blocks that disagree
 *      with the PDF.
 */
describe("buildLineItemFormulaBreakdowns — shared source byte-equality", () => {
  it("server re-export and @shared import resolve to the same module", () => {
    expect(buildFromServer).toBe(buildFromShared);
  });

  it("returns byte-equal blocks for a representative multi-section line item", () => {
    const r = calculateMaterials({
      quantity: 240,
      unit: "SF",
      concreteDepthInches: 6,
      concreteWasteFactor: 10,
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      requiresExcavation: true,
      excavationDepthInches: 10,
      excavationSwellFactor: 25,
      requiresWireMesh: true,
      wireMeshCoverageSF: 100,
      wireMeshWasteFactor: 10,
      requiresRebar: true,
      rebarSpacingInches: 18,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
      requiresDowels: true,
      dowelSpacingInches: 12,
      jointLengthFeet: 30,
      requiresSealer: true,
      sealerCoverageSFPerGallon: 200,
      sealerCoats: 2,
      sealerWasteFactor: 10,
      requiresUnderlayment: true,
      underlaymentOverlapInches: 6,
      underlaymentWasteFactor: 10,
    });

    const input = {
      quantity: 240,
      unit: "SF",
      concreteDepthInches: 6,
      concreteWasteFactor: 10,
      calculatedConcreteYards: r.calculatedConcreteYards!,
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      calculatedStoneTons: r.calculatedStoneTons!,
      requiresExcavation: true,
      excavationDepthInches: 10,
      excavationSwellFactor: 25,
      calculatedExcavationYards: r.calculatedExcavationYards!,
      requiresWireMesh: true,
      wireMeshCoverageSF: 100,
      wireMeshWasteFactor: 10,
      calculatedWireMeshRolls: r.calculatedWireMeshRolls!,
      requiresRebar: true,
      rebarSpacingInches: 18,
      rebarLengthFeet: 20,
      rebarWasteFactor: 10,
      calculatedRebarCount: r.calculatedRebarCount!,
      requiresDowels: true,
      dowelSpacingInches: 12,
      jointLengthFeet: 30,
      calculatedDowelCount: r.calculatedDowelCount!,
      requiresSealer: true,
      sealerCoverageSFPerGallon: 200,
      sealerCoats: 2,
      sealerWasteFactor: 10,
      calculatedSealerGallons: r.calculatedSealerGallons!,
      requiresUnderlayment: true,
      underlaymentOverlapInches: 6,
      underlaymentWasteFactor: 10,
      calculatedUnderlaymentSF: r.calculatedUnderlaymentSF!,
    };

    const screenBlocks: FormulaBlock[] = buildFromShared(input);
    const pdfBlocks: FormulaBlock[] = buildFromServer(input);

    // Sanity: every section should be represented.
    expect(screenBlocks.map((b) => b.title.split(" ")[0])).toEqual([
      "Concrete",
      "Stone",
      "Excavation",
      "Wire",
      "Rebar",
      "Expansion",
      "Sealer",
      "Plastic",
    ]);

    // Deep-equal AND byte-equal JSON serializations — a future formula
    // tweak that landed in only one consumer would break this test.
    expect(pdfBlocks).toEqual(screenBlocks);
    expect(JSON.stringify(pdfBlocks)).toBe(JSON.stringify(screenBlocks));
  });

  it("returns byte-equal blocks for a linear (curb) line item", () => {
    const r = calculateMaterials({
      quantity: 100,
      unit: "LF",
      concreteDepthInches: 8,
      dimensionWidthInches: 6,
      dimensionHeightInches: 18,
      concreteWasteFactor: 10,
      requiresExcavation: true,
      excavationWidthInches: 18,
      excavationDepthInches: 12,
      excavationSwellFactor: 25,
    });

    const input = {
      quantity: 100,
      unit: "LF",
      concreteDepthInches: 8,
      dimensionWidthInches: 6,
      dimensionHeightInches: 18,
      concreteWasteFactor: 10,
      calculatedConcreteYards: r.calculatedConcreteYards!,
      requiresExcavation: true,
      excavationWidthInches: 18,
      excavationDepthInches: 12,
      excavationSwellFactor: 25,
      calculatedExcavationYards: r.calculatedExcavationYards!,
    };

    const screenBlocks = buildFromShared(input);
    const pdfBlocks = buildFromServer(input);
    expect(JSON.stringify(pdfBlocks)).toBe(JSON.stringify(screenBlocks));
    expect(screenBlocks[0].title).toContain("Linear");
    expect(screenBlocks[1].title).toContain("Trench");
  });

  it("renders the LF-mode stone block when calculatedStoneTons is supplied directly", () => {
    // `calculateMaterials` only computes stone for SF inputs today, but the
    // shared helper still gracefully handles a hand-supplied LF stone block
    // (e.g. if a future calculator change starts emitting it). Lock that in.
    const input = {
      quantity: 100,
      unit: "LF",
      requiresStoneBase: true,
      stoneType: "COMPACTED_BASE",
      stoneDepthInches: 4,
      stoneWasteFactor: 10,
      dimensionWidthInches: 24,
      calculatedStoneTons: 5,
    };

    const screenBlocks = buildFromShared(input);
    const pdfBlocks = buildFromServer(input);
    expect(JSON.stringify(pdfBlocks)).toBe(JSON.stringify(screenBlocks));
    expect(screenBlocks).toHaveLength(1);
    expect(screenBlocks[0].title).toBe("Stone Sub-Base (Tons)");
    expect(screenBlocks[0].formula).toContain("LF × (Width ÷ 12)");
  });
});
