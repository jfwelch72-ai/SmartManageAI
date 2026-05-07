/**
 * Task #2578 — Sub-bid leveling sheet (xlsx).
 *
 * Produces a side-by-side comparison spreadsheet of in-house cost vs N
 * subcontractor quotes for a given scope. Each column lists what is
 * included and what is excluded; the "normalized" row adjusts every
 * column up by the same `addForExcluded` value so the totals are
 * apples-to-apples.
 */

import * as XLSX from "xlsx";

export interface LevelingColumnInput {
  label: string;
  sourceKind: "IN_HOUSE" | "SUB_QUOTE";
  baseAmount: number;
  includedKeys: string[];
  excludedKeys: string[];
  addForExcluded: number;
  normalizedAmount: number;
  isRecommended: boolean;
  notes?: string | null;
}

export interface LevelingSheetInput {
  estimateCode: string;
  scopeLabel: string;
  inclusionKeys: string[];
  columns: LevelingColumnInput[];
}

export function generateLevelingSheetXlsx(input: LevelingSheetInput): Buffer {
  const wb = XLSX.utils.book_new();

  const headers = ["Item", ...input.columns.map((c) => c.label)];
  const recommendedRow = ["Recommended", ...input.columns.map((c) => (c.isRecommended ? "✔" : ""))];
  const baseRow = ["Base Quote / Cost", ...input.columns.map((c) => Number(c.baseAmount || 0))];
  const addRow = ["Add-back for excluded items", ...input.columns.map((c) => Number(c.addForExcluded || 0))];
  const normRow = ["NORMALIZED TOTAL", ...input.columns.map((c) => Number(c.normalizedAmount || 0))];

  type CellValue = string | number;
  type Row = CellValue[];
  const aoa: Row[] = [
    [`Sub-Bid Leveling — ${input.scopeLabel}`],
    [`Estimate: ${input.estimateCode}`],
    [],
    headers,
    recommendedRow,
    baseRow,
    addRow,
    normRow,
    [],
    ["Inclusions"],
  ];

  // Per-item inclusion matrix (rows = canonical inclusion keys, cells = ✔/✗)
  for (const key of input.inclusionKeys) {
    const row: Row = [key];
    for (const col of input.columns) {
      if (col.includedKeys.includes(key)) row.push("✔");
      else if (col.excludedKeys.includes(key)) row.push("✗");
      else row.push("?");
    }
    aoa.push(row);
  }
  aoa.push([]);
  aoa.push(["Notes", ...input.columns.map((c) => c.notes ?? "")]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const cols = [{ wch: 36 }];
  for (let i = 0; i < input.columns.length; i++) cols.push({ wch: 22 });
  ws["!cols"] = cols;

  // Money formats for the 3 numeric rows (rows 6,7,8 — 1-indexed in xlsx)
  for (const row of [5, 6, 7]) {
    for (let c = 1; c <= input.columns.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: row, c });
      if (ws[ref]) ws[ref].z = '"$"#,##0.00';
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Leveling");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Auto-build leveling columns from a set of subcontractor quotes for a
 * scope. The canonical inclusion key set defaults to the union of all
 * quote inclusions; each quote is then normalized by `addForExcluded =
 * sum of the in-house cost share for its missing keys`.
 */
export function buildLevelingColumnsFromQuotes(args: {
  inHouseCost: number | null;
  inHouseInclusions: string[];
  quotes: Array<{
    id: string;
    label: string;
    baseAmount: number;
    inclusions: string[];
    exclusions: string[];
    perItemAddBack?: Record<string, number>;
    isSelected?: boolean;
  }>;
  /**
   * Optional explicit per-key add-back values (in dollars). Takes
   * precedence over the in-house-derived baseline so callers can supply
   * a hand-built normalization map when one exists.
   */
  perKeyAddBack?: Record<string, number>;
}): { inclusionKeys: string[]; columns: LevelingColumnInput[] } {
  const inclusionKeys = Array.from(new Set([
    ...args.inHouseInclusions,
    ...args.quotes.flatMap((q) => q.inclusions),
  ])).sort();

  // Build a baseline per-key cost so that sub quotes that EXCLUDE an
  // item the in-house baseline INCLUDES get the in-house cost share
  // added back. Without this, normalized totals would equal the base
  // amounts and the comparison would not be apples-to-apples.
  const inHouseSet = new Set(args.inHouseInclusions);
  const baselinePerKey: Record<string, number> = {};
  if (args.inHouseCost != null && args.inHouseInclusions.length > 0) {
    const perKey = args.inHouseCost / args.inHouseInclusions.length;
    for (const k of args.inHouseInclusions) baselinePerKey[k] = perKey;
  }

  const resolveAddBack = (
    key: string,
    explicit: Record<string, number> | undefined,
  ): number => {
    if (explicit && explicit[key] != null) return explicit[key];
    if (args.perKeyAddBack && args.perKeyAddBack[key] != null) return args.perKeyAddBack[key];
    if (inHouseSet.has(key) && baselinePerKey[key] != null) return baselinePerKey[key];
    return 0;
  };

  const columns: LevelingColumnInput[] = [];
  if (args.inHouseCost != null) {
    columns.push({
      label: "In-House",
      sourceKind: "IN_HOUSE",
      baseAmount: args.inHouseCost,
      includedKeys: args.inHouseInclusions,
      excludedKeys: inclusionKeys.filter((k) => !inHouseSet.has(k)),
      addForExcluded: 0,
      normalizedAmount: args.inHouseCost,
      isRecommended: false,
    });
  }
  for (const q of args.quotes) {
    const excluded = inclusionKeys.filter((k) => !q.inclusions.includes(k));
    const addBack = excluded.reduce((s, k) => s + resolveAddBack(k, q.perItemAddBack), 0);
    columns.push({
      label: q.label,
      sourceKind: "SUB_QUOTE",
      baseAmount: q.baseAmount,
      includedKeys: q.inclusions,
      excludedKeys: excluded,
      addForExcluded: addBack,
      normalizedAmount: q.baseAmount + addBack,
      isRecommended: q.isSelected ?? false,
    });
  }
  return { inclusionKeys, columns };
}
