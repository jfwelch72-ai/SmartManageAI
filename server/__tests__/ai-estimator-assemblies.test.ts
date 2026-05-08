/**
 * Task #2624 — Unit + integration coverage for the assembly auto-takeoff
 * wiring.
 *
 *  - `scoreAssemblyAgainstLine` (pure) — fuzzy matcher hard requirements
 *    (drivingType + drivingUnit), additive scoring (+5 costCode,
 *    +3 tradeType, +1 per token overlap), and the score threshold.
 *
 *  - `buildExpansionFromValue` (pure) — base qty + waste-stacked qty +
 *    per-component totalCost match the documented formula
 *    `value * qtyPerDrivingUnit * (1 + assemblyWaste) * (1 + componentWaste)`.
 *
 *  - `applyAssembliesToDraftLines` (integration over the matcher) — when
 *    the matcher is mocked to return an assembly, the draft line is
 *    annotated with an `assembly` field carrying the parent + components;
 *    when no match is found the line stays flat.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scoreAssemblyAgainstLine,
  type AssemblyMatchLine,
} from "../services/aiEstimator/assemblies";
import {
  buildExpansionFromValue,
} from "../services/aiEstimator/explodeAssembly";
import type {
  AiEstimatorAssembly,
  AiEstimatorAssemblyComponent,
} from "@shared/schema";

function makeAssembly(
  overrides: Partial<AiEstimatorAssembly> = {},
): AiEstimatorAssembly {
  return {
    id: "asm-1",
    organizationId: "org-1",
    name: "8\" CMU wall",
    description: "Concrete masonry unit wall with rebar and grout",
    costCode: "04-22-00",
    tradeType: "MASONRY",
    drivingMeasurementType: "AREA",
    drivingUnit: "SF",
    wasteFactor: 0.05,
    productionRatePerHour: null,
    isActive: true,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as AiEstimatorAssembly;
}

function makeComponent(
  overrides: Partial<AiEstimatorAssemblyComponent> = {},
): AiEstimatorAssemblyComponent {
  return {
    id: "cmp-1",
    assemblyId: "asm-1",
    componentType: "MATERIAL",
    description: "8\" CMU block",
    costCode: null,
    qtyPerDrivingUnit: 1.125,
    unit: "EA",
    defaultUnitCost: "2.50" as unknown as AiEstimatorAssemblyComponent["defaultUnitCost"],
    wasteFactor: 0.02,
    sortOrder: 0,
    createdAt: new Date(),
    ...overrides,
  } as AiEstimatorAssemblyComponent;
}

describe("scoreAssemblyAgainstLine", () => {
  const baseLine: AssemblyMatchLine = {
    label: "8 inch CMU wall at trash enclosure",
    type: "AREA",
    unit: "SF",
    costCode: "04-22-00",
    tradeType: "MASONRY",
  };

  it("requires drivingMeasurementType to match", () => {
    const a = makeAssembly();
    const out = scoreAssemblyAgainstLine(a, { ...baseLine, type: "LINEAR" });
    expect(out).toBeNull();
  });

  it("requires drivingUnit to match (case-insensitive)", () => {
    const a = makeAssembly({ drivingUnit: "SF" });
    expect(scoreAssemblyAgainstLine(a, { ...baseLine, unit: "LF" })).toBeNull();
    expect(scoreAssemblyAgainstLine(a, { ...baseLine, unit: "sf" })).not.toBeNull();
  });

  it("scores +5 for cost code match, +3 for trade match, +1 per overlapping token", () => {
    const a = makeAssembly();
    const out = scoreAssemblyAgainstLine(a, baseLine)!;
    expect(out).not.toBeNull();
    // costCode (+5) + tradeType (+3) + tokens "cmu", "wall" (+2) = 10
    expect(out.score).toBeGreaterThanOrEqual(10);
    expect(out.reasons).toContain("costCode");
    expect(out.reasons).toContain("tradeType");
  });

  it("returns a match when only token overlap reaches threshold", () => {
    const a = makeAssembly({ costCode: null, tradeType: null });
    const out = scoreAssemblyAgainstLine(a, {
      ...baseLine,
      costCode: null,
      tradeType: null,
    });
    expect(out).not.toBeNull();
    expect(out!.score).toBeGreaterThanOrEqual(2);
  });

  it("returns null below the score threshold (no signal beyond unit+type)", () => {
    const a = makeAssembly({
      name: "ZZZ",
      description: null,
      costCode: null,
      tradeType: null,
    });
    const out = scoreAssemblyAgainstLine(a, {
      label: "wholly unrelated label",
      type: "AREA",
      unit: "SF",
      costCode: null,
      tradeType: null,
    });
    expect(out).toBeNull();
  });
});

describe("buildExpansionFromValue (waste math)", () => {
  it("computes baseQuantity = drivingQty * qtyPerDrivingUnit (no waste)", () => {
    const exp = buildExpansionFromValue({
      assembly: makeAssembly({ wasteFactor: 0 }),
      components: [makeComponent({ qtyPerDrivingUnit: 1.125, wasteFactor: 0 })],
      drivingQty: 100,
    });
    expect(exp.components[0].baseQuantity).toBe(112.5);
    expect(exp.components[0].quantity).toBe(112.5);
  });

  it("stacks assembly waste and component waste multiplicatively", () => {
    const exp = buildExpansionFromValue({
      assembly: makeAssembly({ wasteFactor: 0.05 }),
      components: [makeComponent({ qtyPerDrivingUnit: 1, wasteFactor: 0.10 })],
      drivingQty: 100,
    });
    // 100 * 1 * 1.05 * 1.10 = 115.5
    expect(exp.components[0].quantity).toBeCloseTo(115.5, 4);
    expect(exp.assemblyWasteFactor).toBe(0.05);
    expect(exp.components[0].componentWasteFactor).toBe(0.10);
  });

  it("computes totalCost = wastedQty * defaultUnitCost", () => {
    const exp = buildExpansionFromValue({
      assembly: makeAssembly({ wasteFactor: 0 }),
      components: [
        makeComponent({
          qtyPerDrivingUnit: 1,
          wasteFactor: 0,
          defaultUnitCost: "2.50" as unknown as AiEstimatorAssemblyComponent["defaultUnitCost"],
        }),
      ],
      drivingQty: 100,
    });
    expect(exp.components[0].totalCost).toBe(250);
  });

  it("preserves parent metadata (id, name, drivingUnit, type)", () => {
    const exp = buildExpansionFromValue({
      assembly: makeAssembly({ id: "asm-xyz", name: "Test asm", drivingUnit: "SF", drivingMeasurementType: "AREA" }),
      components: [],
      drivingQty: 42,
    });
    expect(exp.assemblyId).toBe("asm-xyz");
    expect(exp.assemblyName).toBe("Test asm");
    expect(exp.drivingUnit).toBe("SF");
    expect(exp.drivingMeasurementType).toBe("AREA");
    expect(exp.drivingQty).toBe(42);
  });
});

// =====================================================================
// Integration over `applyAssembliesToDraftLines` — exercises the
// drafter-side wiring without touching the database. We mock the
// matcher so the test focuses on (a) matched lines getting an
// `assembly` field, (b) unmatched lines staying flat, and (c) lines
// with a pre-existing `assembly` being left alone.
// =====================================================================
vi.mock("../services/aiEstimator/assemblies", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../services/aiEstimator/assemblies")
  >();
  return {
    ...original,
    matchAssemblyForLine: vi.fn(),
  };
});

import { matchAssemblyForLine } from "../services/aiEstimator/assemblies";
import {
  applyAssembliesToDraftLines,
  type DraftLineForAssembly,
} from "../services/aiEstimator/applyAssembliesToDraft";

describe("applyAssembliesToDraftLines", () => {
  const mockedMatcher = matchAssemblyForLine as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockedMatcher.mockReset();
  });

  it("annotates matched lines with an assembly explosion (parent + components)", async () => {
    mockedMatcher.mockImplementation(async (opts) => {
      if (opts.line.label.toLowerCase().includes("cmu")) {
        return {
          ...makeAssembly(),
          components: [
            makeComponent({ id: "cmp-1", description: "CMU 8\"", qtyPerDrivingUnit: 1.125, wasteFactor: 0.02 }),
            makeComponent({
              id: "cmp-2",
              componentType: "LABOR",
              description: "Mason hours",
              qtyPerDrivingUnit: 0.05,
              wasteFactor: 0,
              unit: "HR",
              defaultUnitCost: "55.00" as unknown as AiEstimatorAssemblyComponent["defaultUnitCost"],
            }),
          ],
        };
      }
      return null;
    });

    const lines: DraftLineForAssembly[] = [
      { label: "8\" CMU wall", type: "AREA", value: 200, unit: "SF", costCode: "04-22-00" },
      { label: "Sidewalk concrete", type: "AREA", value: 500, unit: "SF", costCode: "03-30-00" },
    ];
    await applyAssembliesToDraftLines({ organizationId: "org-1", lines });

    expect(lines[0].assembly).toBeTruthy();
    expect(lines[0].assembly!.assemblyName).toBe("8\" CMU wall");
    expect(lines[0].assembly!.components).toHaveLength(2);
    // 200 * 1.125 * 1.05 * 1.02 = 240.975
    expect(lines[0].assembly!.components[0].quantity).toBeCloseTo(240.975, 3);
    expect(lines[1].assembly).toBeUndefined();
  });

  it("leaves lines that already carry an assembly untouched (idempotent)", async () => {
    const preExisting = {
      assemblyId: "asm-existing",
      assemblyName: "Existing",
      drivingQty: 1,
      drivingUnit: "SF",
      drivingMeasurementType: "AREA",
      assemblyWasteFactor: 0,
      components: [],
    };
    const lines: DraftLineForAssembly[] = [
      {
        label: "8\" CMU wall",
        type: "AREA",
        value: 200,
        unit: "SF",
        costCode: null,
        assembly: preExisting,
      },
    ];
    await applyAssembliesToDraftLines({ organizationId: "org-1", lines });
    expect(mockedMatcher).not.toHaveBeenCalled();
    expect(lines[0].assembly).toBe(preExisting);
  });

  it("swallows matcher errors and keeps the original flat line (best-effort)", async () => {
    mockedMatcher.mockRejectedValue(new Error("DB blew up"));
    const lines: DraftLineForAssembly[] = [
      { label: "Anything", type: "AREA", value: 1, unit: "SF", costCode: null },
    ];
    await expect(
      applyAssembliesToDraftLines({ organizationId: "org-1", lines }),
    ).resolves.not.toThrow();
    expect(lines[0].assembly).toBeUndefined();
  });

  it("threads the caller's tradeType to the matcher when the line has none", async () => {
    mockedMatcher.mockResolvedValue(null);
    const lines = [
      { label: "Whatever", type: "AREA", value: 1, unit: "SF", costCode: null },
    ];
    await applyAssembliesToDraftLines({
      organizationId: "org-1",
      lines,
      tradeType: "ELECTRICAL",
    });
    expect(mockedMatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        line: expect.objectContaining({ tradeType: "ELECTRICAL" }),
      }),
    );
  });
});
