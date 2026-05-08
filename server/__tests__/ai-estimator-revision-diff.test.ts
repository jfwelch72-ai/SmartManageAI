// Task #2625 — Auto-takeoff revision diff engine tests.
//
// Pure unit tests for `diffRevisions` and `computeSheetVersionDelta`:
// alignment by identity key, fuzzy label matching, sheet-version
// awareness, and grouping. The engine is dependency-free so these
// tests don't need a DB / Express harness.

import { describe, it, expect } from "vitest";
import {
  diffRevisions,
  computeSheetVersionDelta,
  makeIdentityKey,
} from "../services/aiEstimator/revisionDiff";
import type { MapReduceMeasurement } from "../services/aiEstimator/mapReduceDraft";

function m(over: Partial<MapReduceMeasurement>): MapReduceMeasurement {
  return {
    label: "Concrete slab",
    type: "AREA",
    value: 1000,
    unit: "SF",
    costCode: "03-30-00",
    rationale: "",
    sheetCitations: [],
    contributingDisciplines: ["S"],
    ...over,
  };
}

describe("makeIdentityKey", () => {
  it("normalizes type/unit/costCode/label", () => {
    const a = makeIdentityKey({ label: "  Concrete  Slab ", type: "area", unit: "sf", costCode: " 03-30-00 " });
    const b = makeIdentityKey({ label: "concrete slab", type: "AREA", unit: "SF", costCode: "03-30-00" });
    expect(a).toBe(b);
  });
});

describe("diffRevisions — exact-key alignment", () => {
  it("classifies added / removed / changed / unchanged rows", () => {
    const from = {
      measurements: [
        m({ label: "Concrete slab", value: 1000 }),
        m({ label: "Footings", type: "VOLUME", unit: "CY", costCode: "03-31-00", value: 50 }),
        m({ label: "CMU wall", value: 200, costCode: "04-22-00" }),
      ],
      planSetVersion: null,
    };
    const to = {
      measurements: [
        m({ label: "Concrete slab", value: 1100 }), // changed
        m({ label: "Footings", type: "VOLUME", unit: "CY", costCode: "03-31-00", value: 50 }), // unchanged
        m({ label: "Steel beams", type: "LINEAR", unit: "LF", costCode: "05-10-00", value: 300 }), // added
        // CMU wall removed
      ],
      planSetVersion: null,
    };
    const res = diffRevisions(from, to);
    expect(res.summary).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });

    const slab = res.entries.find((e) => e.label === "Concrete slab")!;
    expect(slab.status).toBe("CHANGED");
    expect(slab.fromValue).toBe(1000);
    expect(slab.toValue).toBe(1100);
    expect(slab.delta).toBe(100);
    expect(slab.deltaPct).toBeCloseTo(10);

    const beams = res.entries.find((e) => e.label === "Steel beams")!;
    expect(beams.status).toBe("ADDED");
    expect(beams.fromValue).toBeNull();

    const cmu = res.entries.find((e) => e.label === "CMU wall")!;
    expect(cmu.status).toBe("REMOVED");
    expect(cmu.toValue).toBeNull();
    expect(cmu.delta).toBe(-200);
  });

  it("handles a row that exists only on the to-side as an ADDED with deltaPct null", () => {
    const res = diffRevisions(
      { measurements: [], planSetVersion: null },
      { measurements: [m({ label: "X", value: 5 })], planSetVersion: null },
    );
    expect(res.summary.added).toBe(1);
    expect(res.entries[0]!.deltaPct).toBeNull();
  });
});

describe("diffRevisions — fuzzy label matching", () => {
  it("pairs near-identical labels within the same type/unit/costCode bucket", () => {
    const from = {
      measurements: [m({ label: "8 inch CMU wall - exterior", value: 200 })],
      planSetVersion: null,
    };
    const to = {
      measurements: [m({ label: "8\" CMU wall exterior", value: 220 })],
      planSetVersion: null,
    };
    const res = diffRevisions(from, to);
    expect(res.summary.changed).toBe(1);
    expect(res.summary.added).toBe(0);
    expect(res.summary.removed).toBe(0);
    expect(res.entries[0]!.fuzzy).toBe(true);
    expect(res.entries[0]!.delta).toBe(20);
  });

  it("does NOT pair across different cost codes even if labels match", () => {
    const from = { measurements: [m({ label: "Slab", costCode: "03-30-00", value: 100 })], planSetVersion: null };
    const to = { measurements: [m({ label: "Slab", costCode: "03-31-00", value: 100 })], planSetVersion: null };
    const res = diffRevisions(from, to);
    expect(res.summary.removed).toBe(1);
    expect(res.summary.added).toBe(1);
    expect(res.summary.changed).toBe(0);
  });
});

describe("computeSheetVersionDelta", () => {
  it("detects added / removed sheets and plan documents", () => {
    const from = {
      planDocuments: [{ id: "doc-1" }],
      sheets: [
        { id: "s1", sheetNumber: "A-101" },
        { id: "s2", sheetNumber: "A-102" },
      ],
    };
    const to = {
      planDocuments: [{ id: "doc-1" }, { id: "doc-2" }],
      sheets: [
        { id: "s1", sheetNumber: "A-101" }, // unchanged
        { id: "s3", sheetNumber: "A-103" }, // added
      ],
    };
    const delta = computeSheetVersionDelta(from, to);
    expect(delta.addedSheetIds).toEqual(["s3"]);
    expect(delta.removedSheetIds).toEqual(["s2"]);
    expect(delta.addedSheetCitations).toEqual(["A-103"]);
    expect(delta.removedSheetCitations).toEqual(["A-102"]);
    expect(delta.addedPlanDocumentIds).toEqual(["doc-2"]);
    expect(delta.removedPlanDocumentIds).toEqual([]);
  });

  it("returns empty arrays when both sides are null/empty", () => {
    const d = computeSheetVersionDelta(null, null);
    expect(d.addedSheetIds).toEqual([]);
    expect(d.removedSheetIds).toEqual([]);
  });
});

describe("diffRevisions — sheet-version awareness", () => {
  it("flags entries whose citations overlap a sheet that was added between revisions", () => {
    const planFrom = { sheets: [{ id: "s1", sheetNumber: "A-101" }] };
    const planTo = {
      sheets: [
        { id: "s1", sheetNumber: "A-101" },
        { id: "s2", sheetNumber: "A-102" },
      ],
    };
    const from = {
      measurements: [m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] })],
      planSetVersion: planFrom,
    };
    const to = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }), // unchanged + un-flagged
        m({ label: "New beams", type: "LINEAR", unit: "LF", costCode: "05-10-00", value: 50, sheetCitations: ["A-102"] }), // added & affected
      ],
      planSetVersion: planTo,
    };
    const res = diffRevisions(from, to);
    expect(res.sheetVersion.addedSheetIds).toEqual(["s2"]);
    const slab = res.entries.find((e) => e.label === "Slab")!;
    const beams = res.entries.find((e) => e.label === "New beams")!;
    expect(slab.affectedBySheetChange).toBe(false);
    expect(beams.affectedBySheetChange).toBe(true);
  });

  it("flags REMOVED entries whose citations overlap a sheet that was dropped", () => {
    const planFrom = {
      sheets: [
        { id: "s1", sheetNumber: "A-101" },
        { id: "s2", sheetNumber: "A-102" },
      ],
    };
    const planTo = { sheets: [{ id: "s1", sheetNumber: "A-101" }] };
    const from = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }),
        m({ label: "Old beams", type: "LINEAR", unit: "LF", costCode: "05-10-00", value: 50, sheetCitations: ["A-102"] }),
      ],
      planSetVersion: planFrom,
    };
    const to = {
      measurements: [m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] })],
      planSetVersion: planTo,
    };
    const res = diffRevisions(from, to);
    const beams = res.entries.find((e) => e.label === "Old beams")!;
    expect(beams.status).toBe("REMOVED");
    expect(beams.affectedBySheetChange).toBe(true);
    expect(res.sheetVersion.removedSheetCitations).toEqual(["A-102"]);
  });
});

describe("diffRevisions — duplicate-aware alignment (Task #2625 review fix)", () => {
  it("preserves multiple same-identity rows that came from different sheets", () => {
    // Same label/type/unit/cost on three different sheets — the diff
    // must keep all three in `from` AND all three in `to` rather than
    // collapsing them through a single map key.
    const from = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }),
        m({ label: "Slab", value: 800, sheetCitations: ["A-102"] }),
        m({ label: "Slab", value: 600, sheetCitations: ["A-103"] }),
      ],
      planSetVersion: null,
    };
    const to = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }), // unchanged scope
        m({ label: "Slab", value: 850, sheetCitations: ["A-102"] }),  // changed on A-102
        m({ label: "Slab", value: 600, sheetCitations: ["A-103"] }),  // unchanged scope
      ],
      planSetVersion: null,
    };
    const res = diffRevisions(from, to);
    // All three from-rows must be paired (no spurious REMOVED) and all
    // three to-rows must be paired (no spurious ADDED).
    expect(res.summary.added).toBe(0);
    expect(res.summary.removed).toBe(0);
    expect(res.summary.changed + res.summary.unchanged).toBe(3);
    // The A-102 pair specifically must be CHANGED.
    const a102 = res.entries.find(
      (e) => e.toCitations.includes("A-102") || e.fromCitations.includes("A-102"),
    )!;
    expect(a102.status).toBe("CHANGED");
    expect(a102.delta).toBe(50);
  });

  it("when one duplicate is dropped on a removed sheet, classifies it as REMOVED + flagged", () => {
    const planFrom = {
      sheets: [
        { id: "s1", sheetNumber: "A-101" },
        { id: "s2", sheetNumber: "A-102" },
      ],
    };
    const planTo = { sheets: [{ id: "s1", sheetNumber: "A-101" }] };
    const from = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }),
        m({ label: "Slab", value: 800, sheetCitations: ["A-102"] }),
      ],
      planSetVersion: planFrom,
    };
    const to = {
      measurements: [m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] })],
      planSetVersion: planTo,
    };
    const res = diffRevisions(from, to);
    expect(res.summary.removed).toBe(1);
    expect(res.summary.unchanged + res.summary.changed).toBe(1);
    const removed = res.entries.find((e) => e.status === "REMOVED")!;
    expect(removed.fromCitations).toEqual(["A-102"]);
    expect(removed.affectedBySheetChange).toBe(true);
  });
});

describe("diffRevisions — integration: rerun after fixture sheet change (Task #2625 review fix)", () => {
  // End-to-end-ish flow without going through the LLM: simulate two
  // map-reduce result snapshots — the second run after a sheet-version
  // bump — and assert the diff matches the documented Done criteria.
  it("classifies adds/removes/changes correctly when a plan sheet is replaced between runs", () => {
    // Run 1 — A-101 + A-102. Slab on A-101 = 1000 SF, footings on A-102.
    const run1 = {
      measurements: [
        m({ label: "Slab", value: 1000, sheetCitations: ["A-101"] }),
        m({
          label: "Footings",
          type: "VOLUME",
          unit: "CY",
          costCode: "03-31-00",
          value: 50,
          sheetCitations: ["A-102"],
        }),
      ],
      planSetVersion: {
        planDocuments: [{ id: "doc-1" }],
        sheets: [
          { id: "s1", sheetNumber: "A-101", revisionLabel: "0" },
          { id: "s2", sheetNumber: "A-102", revisionLabel: "0" },
        ],
      },
    };
    // Run 2 — A-102 was revised (id changes → treated as added/removed),
    // and a brand new A-103 was issued. The slab on A-101 grew because
    // the A-101 sheet was reissued at a higher rev (same id but bumped
    // revisionLabel) — diff still pairs by identity since the sheet id
    // is unchanged.
    const run2 = {
      measurements: [
        m({ label: "Slab", value: 1100, sheetCitations: ["A-101"] }), // CHANGED, not flagged
        m({
          label: "Footings",
          type: "VOLUME",
          unit: "CY",
          costCode: "03-31-00",
          value: 50,
          sheetCitations: ["A-102R1"],
        }), // CHANGED-citation; identity-key fallback pairs it
        m({
          label: "Steel beams",
          type: "LINEAR",
          unit: "LF",
          costCode: "05-10-00",
          value: 300,
          sheetCitations: ["A-103"],
        }), // ADDED on a brand-new sheet
      ],
      planSetVersion: {
        planDocuments: [{ id: "doc-1" }],
        sheets: [
          { id: "s1", sheetNumber: "A-101", revisionLabel: "1" },
          { id: "s2r1", sheetNumber: "A-102R1", revisionLabel: "1" },
          { id: "s3", sheetNumber: "A-103", revisionLabel: "0" },
        ],
      },
    };
    const res = diffRevisions(run1, run2);
    // Sheet-version delta: A-102 dropped, A-102R1 + A-103 added.
    expect(res.sheetVersion.removedSheetIds).toEqual(["s2"]);
    expect(res.sheetVersion.addedSheetIds.sort()).toEqual(["s2r1", "s3"]);

    const slab = res.entries.find((e) => e.label === "Slab")!;
    expect(slab.status).toBe("CHANGED");
    expect(slab.delta).toBe(100);
    expect(slab.affectedBySheetChange).toBe(false);

    const footings = res.entries.find((e) => e.label === "Footings")!;
    // Same identity, different citation -> identity-key fallback pairs
    // them and flags as CHANGED with the sheet-change marker on.
    expect(footings.status).toBe("UNCHANGED");
    expect(footings.affectedBySheetChange).toBe(true);

    const beams = res.entries.find((e) => e.label === "Steel beams")!;
    expect(beams.status).toBe("ADDED");
    expect(beams.affectedBySheetChange).toBe(true);

    // No spurious adds/removes from the duplicate-aware re-pairing.
    expect(res.summary.removed).toBe(0);
  });
});

describe("diffRevisions — grouping", () => {
  it("groups entries by discipline and by sheet citation", () => {
    const res = diffRevisions(
      { measurements: [], planSetVersion: null },
      {
        measurements: [
          m({ label: "Slab", contributingDisciplines: ["S"], sheetCitations: ["S-1"] }),
          m({ label: "HVAC", type: "COUNT", unit: "EA", contributingDisciplines: ["M"], sheetCitations: ["M-1", "M-2"], value: 10 }),
        ],
        planSetVersion: null,
      },
    );
    expect(Object.keys(res.byDiscipline).sort()).toEqual(["M", "S"]);
    expect(res.byDiscipline.S).toHaveLength(1);
    expect(res.byDiscipline.M).toHaveLength(1);
    expect(res.bySheet["S-1"]).toHaveLength(1);
    expect(res.bySheet["M-1"]).toHaveLength(1);
    expect(res.bySheet["M-2"]).toHaveLength(1);
  });
});
