// Deterministic mapping of the ORIGINAL workbook (read via its cached values in row_analysis.json)
// to SmartManage estimate_line_items. This is a QA harness mapping, not a corrected estimate.
// Mapping (documented in the report, cell-level):
//   A->description, B->quantity, C->unit (trimmed; blank -> "LS"), F->laborCost, H->materialCost,
//   J->equipmentCost, L->subcontractCost, N(Other)->consumablesCost (no "other" bucket exists in schema),
//   profitAllocation = P - O (P as stored, including the P23 literal override), D/E kept in metadata.
//   Rows 56-57 -> lineType ALTERNATE in group ALT-1 (row 55 header). Header/note rows -> estimate notes.
import fs from "node:fs";
export function loadRows(runDir) {
  const d = JSON.parse(fs.readFileSync(`${runDir}/estimate/row_analysis.json`, "utf8"));
  return d;
}
export function mapItems(d) {
  const items = [], notes = [];
  for (const r of d.rows) {
    if (r.row > 112) continue;
    if (r.kind === "header/note") { notes.push(`Row ${r.row}: ${String(r.A).trim()}`); continue; }
    if (r.kind !== "item") continue;
    const c = r.cached; const n = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const O = n(c.O), P = n(c.P);
    items.push({
      sourceRow: r.row,
      category: "GENERAL",
      description: `[R${r.row}] ${String(r.A).trim()}`,
      quantity: String(r.B),
      unit: (r.C ? String(r.C).trim() : "LS") || "LS",
      laborCost: String(n(c.F)), materialCost: String(n(c.H)), equipmentCost: String(n(c.J)),
      subcontractCost: String(n(c.L)), consumablesCost: String(n(c.N)),
      overheadAllocation: "0", laborHours: "0", equipmentHours: "0", profitAllocation: String(n(P - O)),
      lineType: r.row >= 55 && r.row <= 57 ? "ALTERNATE" : "BASE",
      metadata: JSON.stringify({ qaSource: "00420 workbook", sourceRow: r.row, D: r.D, E: r.E, G: r.G, K: r.K, M: r.M, cachedO: O, cachedP: P, pLiteral: r.P_literal }),
    });
  }
  return { items, notes };
}
