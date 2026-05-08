/**
 * Task #2603 — Unit tests for the AIA G703 Schedule of Values xlsx
 * generator. Verifies header layout, scheduled value totals (column C),
 * formula seeds (D+E+F, percent-complete, retainage) and the GRAND
 * TOTAL SUM() row, plus the empty-input edge case.
 */
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { generateSovG703Xlsx, type SovInput } from "../sovG703";

function readSheet(buf: Buffer): XLSX.WorkSheet {
  const wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
  expect(wb.SheetNames).toContain("G703");
  return wb.Sheets["G703"];
}

const lines = [
  { itemNumber: "001", description: "Mobilization", scheduledValue: 5000 },
  { itemNumber: "002", description: "Earthwork", scheduledValue: 12500 },
  { itemNumber: "003", description: "Concrete", scheduledValue: 32500 },
];

describe("generateSovG703Xlsx", () => {
  it("emits header rows, populates scheduled values, and seeds row formulas", () => {
    const buf = generateSovG703Xlsx({
      projectName: "Test Project",
      projectCode: "P-123",
      contractor: "Acme Builders",
      lines,
    } as SovInput);
    expect(buf.length).toBeGreaterThan(500);
    const ws = readSheet(buf);

    // First row is the title
    expect(ws["A1"].v).toMatch(/AIA Document G703/);

    // Data starts at row 7 (1-indexed) — header rows are 1-6, then dataStart=7
    // Scheduled values land in column C
    expect(Number(ws["C7"].v)).toBe(5000);
    expect(Number(ws["C8"].v)).toBe(12500);
    expect(Number(ws["C9"].v)).toBe(32500);

    // Row formulas
    expect(ws["G7"].f).toBe("D7+E7+F7");
    expect(ws["H7"].f).toBe("IF(C7=0,0,G7/C7)");
    expect(ws["I7"].f).toBe("C7-G7");
    // Default 10% retainage
    expect(ws["J7"].f).toBe("G7*0.1");
  });

  it("respects a custom retainage percent in the per-row J formula", () => {
    const buf = generateSovG703Xlsx({
      projectName: "Test Project",
      projectCode: "P-123",
      contractor: "Acme Builders",
      retainagePercent: 5,
      lines,
    } as SovInput);
    const ws = readSheet(buf);
    expect(ws["J7"].f).toBe("G7*0.05");
  });

  it("emits a GRAND TOTAL row that SUMs columns C..J across data rows", () => {
    const buf = generateSovG703Xlsx({
      projectName: "Test Project",
      projectCode: "P-123",
      contractor: "Acme Builders",
      lines,
    } as SovInput);
    const ws = readSheet(buf);

    // dataStart = 7, lines.length = 3 → totals row is row 10
    expect(ws["B10"].v).toBe("GRAND TOTAL");
    expect(ws["C10"].f).toBe("SUM(C7:C9)");
    expect(ws["D10"].f).toBe("SUM(D7:D9)");
    expect(ws["E10"].f).toBe("SUM(E7:E9)");
    expect(ws["F10"].f).toBe("SUM(F7:F9)");
    expect(ws["G10"].f).toBe("SUM(G7:G9)");
    expect(ws["H10"].f).toBe("IF(C10=0,0,G10/C10)");
    expect(ws["I10"].f).toBe("SUM(I7:I9)");
    expect(ws["J10"].f).toBe("SUM(J7:J9)");

    // Sanity: scheduled values sum to the expected dollar total.
    const c7 = Number(ws["C7"].v);
    const c8 = Number(ws["C8"].v);
    const c9 = Number(ws["C9"].v);
    expect(c7 + c8 + c9).toBe(50000);
  });

  it("returns a workbook for an empty SOV (totals row collapses to row 7)", () => {
    const buf = generateSovG703Xlsx({
      projectName: "Empty",
      projectCode: "P-0",
      contractor: "Acme",
      lines: [],
    } as SovInput);
    expect(buf.length).toBeGreaterThan(200);
    const ws = readSheet(buf);
    expect(ws["B7"].v).toBe("GRAND TOTAL");
    // SUM(C7:C6) — degenerate but Excel evaluates to 0; we just verify
    // the formula was emitted at the correct cell.
    expect(ws["C7"].f).toBe("SUM(C7:C6)");
  });
});
