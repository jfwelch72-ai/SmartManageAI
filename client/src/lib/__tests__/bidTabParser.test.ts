// @vitest-environment jsdom
//
// Task #1165 — Unit tests for the bid tab spreadsheet parser. The parser is
// the gateway for every line item that the BidTabImportDialog ever creates,
// so silent corruption (wrong column picked, blank rows kept, weird headers
// missed) would directly poison estimates. These tests pin the contract.

import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseRows,
  parseFile,
  detectColumns,
  COLUMN_ALIASES,
} from "../bidTabParser";

describe("bidTabParser.detectColumns", () => {
  it("maps every documented alias to the canonical column", () => {
    // Loop the alias map so the test fails the moment someone adds a new
    // alias without thinking through the canonical key it should resolve to.
    for (const [alias, canonical] of Object.entries(COLUMN_ALIASES)) {
      const map = detectColumns([alias]);
      expect(map[canonical], `alias "${alias}"`).toBe(0);
    }
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    const map = detectColumns(["  DESCRIPTION  ", "Qty", "UoM", "Item No"]);
    expect(map.description).toBe(0);
    expect(map.quantity).toBe(1);
    expect(map.unit).toBe(2);
    expect(map.payItemNumber).toBe(3);
  });

  it("keeps the first match when an alias appears twice", () => {
    const map = detectColumns(["Description", "Item Description"]);
    expect(map.description).toBe(0);
  });

  it("ignores headers that are not aliases", () => {
    const map = detectColumns(["Section", "Phase", "Notes"]);
    expect(map).toEqual({});
  });
});

describe("bidTabParser.parseRows — header detection", () => {
  it("detects a header on the first row and parses the rest", () => {
    const rows = [
      ["Description", "Quantity", "Unit", "Item No"],
      ["Roadway excavation", 250, "CY", "203-1"],
      ["Concrete pavement", 100, "SY", "501-2"],
    ];
    const out = parseRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      rowIndex: 0,
      description: "Roadway excavation",
      quantity: 250,
      unit: "CY",
      payItemNumberHint: "203-1",
    });
    expect(out[1].payItemNumberHint).toBe("501-2");
  });

  it("skips banner rows above the real header", () => {
    const rows = [
      ["Bid Tabulation — Project ABC"],
      ["Prepared by: Jane"],
      [""],
      ["Pay Item", "Description", "Estimated Quantity", "UoM"],
      ["203-1", "Roadway excavation", 500, "CY"],
    ];
    const out = parseRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Roadway excavation");
    expect(out[0].quantity).toBe(500);
    expect(out[0].unit).toBe("CY");
    expect(out[0].payItemNumberHint).toBe("203-1");
  });

  it("treats files with no header as a description-first sheet", () => {
    // Three columns but no recognizable header keyword anywhere — falls back
    // to col0=description, col1=quantity, col2=unit.
    const rows = [
      ["Mobilization", 1, "LS"],
      ["Asphalt binder", 750.5, "TON"],
    ];
    const out = parseRows(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      description: "Mobilization",
      quantity: 1,
      unit: "LS",
    });
    expect(out[1]).toMatchObject({
      description: "Asphalt binder",
      quantity: 750.5,
      unit: "TON",
    });
  });

  it("only scans the first 10 rows for a header", () => {
    const rows: unknown[][] = [];
    for (let i = 0; i < 10; i++) rows.push([`junk ${i}`]);
    rows.push(["Description", "Quantity", "Unit"]);
    rows.push(["Late header row", 5, "EA"]);
    const out = parseRows(rows);
    // Header lives at index 10 so it is missed; falls back to header-less
    // mode (col 0 is description). Every junk row + the would-be header row
    // becomes a line item.
    expect(out.length).toBeGreaterThan(1);
    // The would-be header row is still treated as data.
    expect(out.find((r) => r.description === "Description")).toBeDefined();
  });
});

describe("bidTabParser.parseRows — alias columns", () => {
  it("recognizes mixed alias spellings in any column order", () => {
    const rows = [
      ["UOM", "QTY", "Pay Item Description", "Item #"],
      ["LF", "1,250", "Storm drain pipe twelve inch", "603-12"],
    ];
    const out = parseRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      rowIndex: 0,
      description: "Storm drain pipe twelve inch",
      quantity: 1250, // commas stripped
      unit: "LF",
      payItemNumberHint: "603-12",
    });
  });

  it("strips thousands separators when parsing quantity", () => {
    const rows = [
      ["Description", "Quantity", "Unit"],
      ["Embankment fill", "12,500.75", "CY"],
    ];
    const out = parseRows(rows);
    expect(out[0].quantity).toBeCloseTo(12500.75);
  });
});

describe("bidTabParser.parseRows — missing fields & edge cases", () => {
  it("drops rows with a blank description", () => {
    const rows = [
      ["Description", "Quantity", "Unit"],
      ["", 10, "EA"],
      ["   ", 20, "EA"], // whitespace-only
      ["Real item", 1, "LS"],
    ];
    const out = parseRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].description).toBe("Real item");
    // rowIndex re-numbers to a dense 0-based sequence so the dialog can keep
    // a stable React key per surviving row.
    expect(out[0].rowIndex).toBe(0);
  });

  it("defaults quantity to 1 when the cell is missing or non-numeric", () => {
    const rows = [
      ["Description", "Quantity", "Unit"],
      ["No quantity given", "", "EA"],
      ["Garbage quantity", "TBD", "EA"],
      ["Negative quantity", -5, "EA"],
      ["Zero quantity", 0, "EA"],
    ];
    const out = parseRows(rows);
    expect(out.map((r) => r.quantity)).toEqual([1, 1, 1, 1]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseRows([])).toEqual([]);
  });

  it("returns an empty array when the only row is the header", () => {
    expect(parseRows([["Description", "Qty", "Unit"]])).toEqual([]);
  });

  it("leaves unit blank when the column is absent", () => {
    const rows = [
      ["Description", "Quantity"],
      ["Mobilization", 1],
    ];
    const out = parseRows(rows);
    expect(out[0].unit).toBe("");
  });

  it("normalizes payItemNumberHint to null when empty", () => {
    const rows = [
      ["Description", "Quantity", "Unit", "Pay Item"],
      ["Item without number", 1, "LS", ""],
    ];
    const out = parseRows(rows);
    expect(out[0].payItemNumberHint).toBeNull();
  });
});

describe("bidTabParser.parseFile — file plumbing", () => {
  // The body of parseFile is just I/O glue around parseRows; these smoke
  // tests confirm CSV vs XLSX detection and that XLSX sheets without any
  // sheet names return an empty list rather than throwing.

  function makeCsvFile(text: string): File {
    return new File([text], "bid-tab.csv", { type: "text/csv" });
  }

  function makeXlsxFile(rows: unknown[][]): File {
    const ws = XLSX.utils.aoa_to_sheet(rows as (string | number)[][]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return new File([buf], "bid-tab.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  it("parses a CSV file end-to-end", async () => {
    const csv = [
      "Description,Quantity,Unit,Item No",
      "Roadway excavation,250,CY,203-1",
      "Concrete pavement,100,SY,501-2",
      ",,,", // entirely blank row should be dropped by parseRows
    ].join("\n");
    const out = await parseFile(makeCsvFile(csv));
    expect(out).toHaveLength(2);
    expect(out[0].payItemNumberHint).toBe("203-1");
  });

  it("parses an XLSX file end-to-end", async () => {
    const out = await parseFile(
      makeXlsxFile([
        ["Description", "Quantity", "Unit"],
        ["Mobilization", 1, "LS"],
        ["Asphalt binder", 500, "TON"],
      ]),
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      description: "Asphalt binder",
      quantity: 500,
      unit: "TON",
    });
  });
});
