/**
 * Task #2603 — Unit tests for the sub-bid leveling sheet xlsx generator
 * and its column-builder helper. Verifies base/normalized totals, the
 * inclusion/exclusion matrix (✔ / ✗ / ?), and the auto-add-back math.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  generateLevelingSheetXlsx,
  buildLevelingColumnsFromQuotes,
  type LevelingSheetInput,
} from "../levelingSheetXlsx";

function readSheet(buf: Buffer): XLSX.WorkSheet {
  const wb = XLSX.read(buf, { type: "buffer" });
  expect(wb.SheetNames).toContain("Leveling");
  return wb.Sheets["Leveling"];
}

const cols = [
  {
    label: "In-House",
    sourceKind: "IN_HOUSE" as const,
    baseAmount: 100000,
    includedKeys: ["demo", "frame"],
    excludedKeys: ["paint"],
    addForExcluded: 0,
    normalizedAmount: 100000,
    isRecommended: false,
  },
  {
    label: "Sub A",
    sourceKind: "SUB_QUOTE" as const,
    baseAmount: 90000,
    includedKeys: ["demo", "frame", "paint"],
    excludedKeys: [],
    addForExcluded: 0,
    normalizedAmount: 90000,
    isRecommended: true,
    notes: "Best price",
  },
  {
    label: "Sub B",
    sourceKind: "SUB_QUOTE" as const,
    baseAmount: 85000,
    includedKeys: ["demo", "frame"],
    excludedKeys: ["paint"],
    addForExcluded: 7000,
    normalizedAmount: 92000,
    isRecommended: false,
  },
];

describe("generateLevelingSheetXlsx", () => {
  it("emits the per-column base/add-back/normalized rows in the correct cells", () => {
    const buf = generateLevelingSheetXlsx({
      estimateCode: "EST-001",
      scopeLabel: "Painting",
      inclusionKeys: ["demo", "frame", "paint"],
      columns: cols,
    } as LevelingSheetInput);
    expect(buf.length).toBeGreaterThan(300);
    const ws = readSheet(buf);

    // Title + header rows. headers row = row 4 (1-indexed)
    expect(ws["A1"].v).toBe("Sub-Bid Leveling — Painting");
    expect(ws["A4"].v).toBe("Item");
    expect(ws["B4"].v).toBe("In-House");
    expect(ws["C4"].v).toBe("Sub A");
    expect(ws["D4"].v).toBe("Sub B");

    // Recommended (row 5)
    expect(ws["B5"].v).toBe("");
    expect(ws["C5"].v).toBe("✔");
    expect(ws["D5"].v).toBe("");

    // Base amounts (row 6)
    expect(Number(ws["B6"].v)).toBe(100000);
    expect(Number(ws["C6"].v)).toBe(90000);
    expect(Number(ws["D6"].v)).toBe(85000);

    // Add-back row (row 7)
    expect(Number(ws["B7"].v)).toBe(0);
    expect(Number(ws["C7"].v)).toBe(0);
    expect(Number(ws["D7"].v)).toBe(7000);

    // Normalized row (row 8): base + add-back, apples-to-apples
    expect(ws["A8"].v).toBe("NORMALIZED TOTAL");
    expect(Number(ws["B8"].v)).toBe(100000);
    expect(Number(ws["C8"].v)).toBe(90000);
    expect(Number(ws["D8"].v)).toBe(92000);
  });

  it("renders the per-key inclusion matrix with ✔ / ✗ / ? markers", () => {
    const buf = generateLevelingSheetXlsx({
      estimateCode: "EST-001",
      scopeLabel: "Painting",
      // Add an extra "unknown" key to ensure the "?" marker fires.
      inclusionKeys: ["demo", "frame", "paint", "primer"],
      columns: cols,
    } as LevelingSheetInput);
    const ws = readSheet(buf);

    // "Inclusions" header lives at row 10. Per-key rows follow at row 11+.
    expect(ws["A10"].v).toBe("Inclusions");

    // Row 11 — "demo" — every column lists it as included.
    expect(ws["A11"].v).toBe("demo");
    expect(ws["B11"].v).toBe("✔");
    expect(ws["C11"].v).toBe("✔");
    expect(ws["D11"].v).toBe("✔");

    // Row 13 — "paint" — In-House and Sub B exclude it; Sub A includes it.
    expect(ws["A13"].v).toBe("paint");
    expect(ws["B13"].v).toBe("✗");
    expect(ws["C13"].v).toBe("✔");
    expect(ws["D13"].v).toBe("✗");

    // Row 14 — "primer" — neither included nor excluded by any column => "?"
    expect(ws["A14"].v).toBe("primer");
    expect(ws["B14"].v).toBe("?");
    expect(ws["C14"].v).toBe("?");
    expect(ws["D14"].v).toBe("?");
  });

  it("produces a workbook for an empty leveling sheet", () => {
    const buf = generateLevelingSheetXlsx({
      estimateCode: "EST-EMPTY",
      scopeLabel: "Empty",
      inclusionKeys: [],
      columns: [],
    } as LevelingSheetInput);
    expect(buf.length).toBeGreaterThan(100);
    const ws = readSheet(buf);
    expect(ws["A1"].v).toBe("Sub-Bid Leveling — Empty");
    expect(ws["A4"].v).toBe("Item");
  });
});

describe("buildLevelingColumnsFromQuotes", () => {
  it("derives the inclusion-key union and adds the in-house cost share back to quotes that exclude scope", () => {
    const out = buildLevelingColumnsFromQuotes({
      inHouseCost: 100,                 // $100 across 2 inclusions => $50/key
      inHouseInclusions: ["demo", "frame"],
      quotes: [
        { id: "q1", label: "Sub A", baseAmount: 90, inclusions: ["demo", "frame"], exclusions: [] },
        { id: "q2", label: "Sub B", baseAmount: 60, inclusions: ["demo"], exclusions: ["frame"] },
      ],
    });
    // Union of in-house + every quote inclusion (sorted)
    expect(out.inclusionKeys).toEqual(["demo", "frame"]);
    // Three columns: In-House first, then the two subs
    expect(out.columns.map((c) => c.label)).toEqual(["In-House", "Sub A", "Sub B"]);

    const inHouseCol = out.columns[0];
    expect(inHouseCol.normalizedAmount).toBe(100);
    expect(inHouseCol.addForExcluded).toBe(0);

    const subA = out.columns[1];
    expect(subA.addForExcluded).toBe(0);
    expect(subA.normalizedAmount).toBe(90);

    // Sub B excludes "frame", in-house carries $50 worth of "frame" => normalize 60+50=110
    const subB = out.columns[2];
    expect(subB.excludedKeys).toEqual(["frame"]);
    expect(subB.addForExcluded).toBe(50);
    expect(subB.normalizedAmount).toBe(110);
  });

  it("prefers an explicit perKeyAddBack map over the in-house derived baseline", () => {
    const out = buildLevelingColumnsFromQuotes({
      inHouseCost: 100,
      inHouseInclusions: ["demo", "frame"],
      perKeyAddBack: { frame: 25 },
      quotes: [
        { id: "q1", label: "Sub", baseAmount: 80, inclusions: ["demo"], exclusions: ["frame"] },
      ],
    });
    expect(out.columns[1].addForExcluded).toBe(25);
    expect(out.columns[1].normalizedAmount).toBe(105);
  });

  it("omits the In-House column when no in-house cost is supplied", () => {
    const out = buildLevelingColumnsFromQuotes({
      inHouseCost: null,
      inHouseInclusions: [],
      quotes: [
        { id: "q", label: "Only Sub", baseAmount: 200, inclusions: ["a"], exclusions: [] },
      ],
    });
    expect(out.columns.map((c) => c.label)).toEqual(["Only Sub"]);
    expect(out.columns[0].normalizedAmount).toBe(200);
  });
});
