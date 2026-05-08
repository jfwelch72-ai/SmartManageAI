// Task #2622 — Reconciliation unit tests for `mapReduceDraft.ts`.
//
// `reconcileMeasurements` (extracted from the inline loop in
// `mapReduceDraftFromPlans`) implements the disjoint/overlap citation
// merge that drives final quantities for large plan sets. Getting this
// wrong silently doubles or halves bid quantities, so the rules are
// pinned here independently of the harness.

import { describe, expect, it } from "vitest";
import {
  makeMeasurementKey,
  reconcileMeasurements,
  type MapReduceMeasurement,
} from "../services/aiEstimator/mapReduceDraft";

function m(partial: Partial<MapReduceMeasurement>): MapReduceMeasurement {
  return {
    label: "Item",
    type: "COUNT",
    value: 1,
    unit: "EA",
    costCode: null,
    rationale: "",
    sheetCitations: [],
    contributingDisciplines: [],
    ...partial,
  };
}

describe("makeMeasurementKey", () => {
  it("normalises unit case and label whitespace/case", () => {
    expect(makeMeasurementKey({ label: "  Slab On Grade ", type: "AREA", unit: "sf" }))
      .toBe(makeMeasurementKey({ label: "slab on grade", type: "AREA", unit: "SF" }));
  });

  it("treats different types or units as distinct identities", () => {
    const a = makeMeasurementKey({ label: "Wall", type: "LINEAR", unit: "LF" });
    const b = makeMeasurementKey({ label: "Wall", type: "AREA", unit: "SF" });
    const c = makeMeasurementKey({ label: "Wall", type: "LINEAR", unit: "FT" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("reconcileMeasurements — same item across key plan + detail", () => {
  it("keeps the larger value when citations OVERLAP (duplicate observation)", () => {
    // Same VAV count emitted on the floor plan and the enlarged plan;
    // the enlarged plan happens to read 9 due to a model hallucination.
    // Overlapping citation (M-101) → take the max, never sum.
    const result = reconcileMeasurements([
      {
        discipline: "M",
        measurements: [m({ label: "VAV box", value: 8, sheetCitations: ["M-101"] })],
      },
      {
        discipline: "M",
        measurements: [m({ label: "VAV box", value: 9, sheetCitations: ["M-101", "M-501"] })],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(9);
    expect(result[0].sheetCitations.sort()).toEqual(["M-101", "M-501"]);
  });

  it("SUMS when citations are DISJOINT (genuinely separate scopes)", () => {
    // Asphalt paving on C-201 (drives) and on C-501 (parking lot) is
    // additive — same label/unit but different scopes.
    const result = reconcileMeasurements([
      {
        discipline: "C",
        measurements: [
          m({ label: "Asphalt paving", type: "AREA", unit: "SF", value: 12000, sheetCitations: ["C-201"] }),
          m({ label: "Asphalt paving", type: "AREA", unit: "SF", value: 6500, sheetCitations: ["C-501"] }),
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(18500);
    expect(result[0].sheetCitations.sort()).toEqual(["C-201", "C-501"]);
  });

  it("conservatively takes max when NEITHER side has citations (no proof of disjointness)", () => {
    // Without citations we cannot prove the two emissions are different
    // scopes; summing would risk double-counting. Take the max.
    const result = reconcileMeasurements([
      { discipline: "S", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 4000 })] },
      { discipline: "S", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 4800 })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(4800);
  });

  it("sums when one side has citations and the other does not (still disjoint)", () => {
    // The "neither has citations" rule is the conservative one. Once
    // one side carries a citation, we treat them as disjoint and add.
    const result = reconcileMeasurements([
      { discipline: "S", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 4000, sheetCitations: ["S-101"] })] },
      { discipline: "S", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 800 })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(4800);
  });
});

describe("reconcileMeasurements — near-duplicates with different units", () => {
  it("does NOT merge identical labels with different units", () => {
    // 320 LF of grade beam vs 320 SF of grade beam shading — different
    // identity, must surface as two rows so the estimator can decide.
    const result = reconcileMeasurements([
      {
        discipline: "S",
        measurements: [
          m({ label: "Grade beam", type: "LINEAR", unit: "LF", value: 320, sheetCitations: ["S-101"] }),
          m({ label: "Grade beam", type: "AREA", unit: "SF", value: 320, sheetCitations: ["S-101"] }),
        ],
      },
    ]);
    expect(result).toHaveLength(2);
    const types = result.map((r) => r.type).sort();
    expect(types).toEqual(["AREA", "LINEAR"]);
  });

  it("does NOT merge same label/type with different units (LF vs FT, EA vs each)", () => {
    // Unit normalisation is uppercase only — "LF" and "FT" are not the
    // same unit, even though they're convertible. Surfacing both rows
    // makes the unit drift visible to the estimator.
    const result = reconcileMeasurements([
      {
        discipline: "C",
        measurements: [
          m({ label: "Curb", type: "LINEAR", unit: "LF", value: 2240, sheetCitations: ["C-201"] }),
          m({ label: "Curb", type: "LINEAR", unit: "FT", value: 2240, sheetCitations: ["C-501"] }),
        ],
      },
    ]);
    expect(result).toHaveLength(2);
  });
});

describe("reconcileMeasurements — citation-tie-breaking & metadata merging", () => {
  it("unions citations and contributing disciplines across batches", () => {
    const result = reconcileMeasurements([
      { discipline: "S", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 4800, sheetCitations: ["S-101"] })] },
      { discipline: "C", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 4800, sheetCitations: ["S-101"] })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].contributingDisciplines.sort()).toEqual(["C", "S"]);
    expect(result[0].sheetCitations).toEqual(["S-101"]);
    // Overlapping citation → max, not sum.
    expect(result[0].value).toBe(4800);
  });

  it("concatenates rationales without repeating identical text", () => {
    const result = reconcileMeasurements([
      { discipline: "M", measurements: [m({ label: "VAV", value: 8, rationale: "M-101 plan", sheetCitations: ["M-101"] })] },
      { discipline: "M", measurements: [m({ label: "VAV", value: 8, rationale: "M-101 plan", sheetCitations: ["M-101"] })] },
      { discipline: "M", measurements: [m({ label: "VAV", value: 8, rationale: "M-501 enlarged", sheetCitations: ["M-101"] })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].rationale).toContain("M-101 plan");
    expect(result[0].rationale).toContain("M-501 enlarged");
    // Identical rationale should NOT appear twice.
    const firstIdx = result[0].rationale.indexOf("M-101 plan");
    const secondIdx = result[0].rationale.indexOf("M-101 plan", firstIdx + 1);
    expect(secondIdx).toBe(-1);
  });

  it("caps merged rationale at 1000 characters", () => {
    const long = "x".repeat(600);
    const result = reconcileMeasurements([
      { discipline: "M", measurements: [m({ label: "Z", rationale: long, sheetCitations: ["M-1"] })] },
      { discipline: "M", measurements: [m({ label: "Z", rationale: long.replace("x", "y"), sheetCitations: ["M-1"] })] },
    ]);
    expect(result[0].rationale.length).toBeLessThanOrEqual(1000);
  });

  it("does not mutate the original input batches", () => {
    const original = m({ label: "Slab", type: "AREA", unit: "SF", value: 4800, sheetCitations: ["S-101"] });
    const batches = [
      { discipline: "S", measurements: [original] },
      { discipline: "C", measurements: [m({ label: "Slab", type: "AREA", unit: "SF", value: 100, sheetCitations: ["C-101"] })] },
    ];
    const result = reconcileMeasurements(batches);
    expect(result[0].value).toBe(4900); // disjoint → sum
    // Original input untouched.
    expect(original.value).toBe(4800);
    expect(original.sheetCitations).toEqual(["S-101"]);
    expect(original.contributingDisciplines).toEqual([]);
  });
});

describe("reconcileMeasurements — empty + edge cases", () => {
  it("returns [] for empty batches", () => {
    expect(reconcileMeasurements([])).toEqual([]);
    expect(reconcileMeasurements([{ discipline: "M", measurements: [] }])).toEqual([]);
  });

  it("preserves single-emission items unchanged", () => {
    const result = reconcileMeasurements([
      { discipline: "E", measurements: [m({ label: "Panel", value: 2, sheetCitations: ["E-401"] })] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(2);
    expect(result[0].contributingDisciplines).toEqual(["E"]);
  });
});
