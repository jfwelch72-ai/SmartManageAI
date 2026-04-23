// Task #1165 — Bid tab parser extracted from BidTabImportDialog.tsx so it can
// be unit tested without mounting the dialog. Behaviour is intentionally
// identical: header detection scans the first 10 rows, alias columns are
// normalized via COLUMN_ALIASES, blank rows are skipped, missing quantity
// falls back to 1, and a header-less file uses fixed column positions.

import * as XLSX from "xlsx";
import Papa from "papaparse";

export interface ParsedRow {
  rowIndex: number;
  description: string;
  quantity: number;
  unit: string;
  payItemNumberHint?: string | null;
}

export const COLUMN_ALIASES: Record<string, string> = {
  description: "description",
  desc: "description",
  item: "description",
  "item description": "description",
  "pay item description": "description",
  "work description": "description",
  quantity: "quantity",
  qty: "quantity",
  "estimated quantity": "quantity",
  unit: "unit",
  uom: "unit",
  "unit of measure": "unit",
  "pay item": "payItemNumber",
  "item number": "payItemNumber",
  "item no": "payItemNumber",
  "item #": "payItemNumber",
};

export function detectColumns(headers: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = (h ?? "").toString().trim().toLowerCase();
    const key = COLUMN_ALIASES[norm];
    if (key && map[key] === undefined) map[key] = idx;
  });
  return map;
}

/**
 * Parse a 2D array of cells (as produced by Papa.parse / XLSX.utils.sheet_to_json
 * with `header: 1`). Pulled out of {@link parseFile} so unit tests can exercise
 * header detection, alias matching, and missing-field handling without having
 * to construct File instances.
 */
export function parseRows(rows: unknown[][]): ParsedRow[] {
  if (!rows || rows.length === 0) return [];

  let headerRowIdx: number | null = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = (rows[i] ?? []).map((c) =>
      (c ?? "").toString().trim().toLowerCase(),
    );
    if (headers.some((h) => COLUMN_ALIASES[h] === "description")) {
      headerRowIdx = i;
      break;
    }
  }
  const headers =
    headerRowIdx !== null
      ? (rows[headerRowIdx] ?? []).map((c) => (c ?? "").toString())
      : [];
  const cols = detectColumns(headers);

  if (headerRowIdx === null) {
    cols.description = 0;
    const widestRow = rows.reduce(
      (max, r) => Math.max(max, (r ?? []).length),
      0,
    );
    if (cols.quantity === undefined && widestRow > 1) cols.quantity = 1;
    if (cols.unit === undefined && widestRow > 2) cols.unit = 2;
  }

  const startRow = headerRowIdx === null ? 0 : headerRowIdx + 1;
  const out: ParsedRow[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const description = (row[cols.description] ?? "").toString().trim();
    if (!description) continue;
    const qtyRaw = cols.quantity !== undefined ? (row[cols.quantity] ?? "") : "";
    const qty = parseFloat(qtyRaw.toString().replace(/,/g, ""));
    const unit =
      cols.unit !== undefined ? (row[cols.unit] ?? "").toString().trim() : "";
    const payItemHint =
      cols.payItemNumber !== undefined
        ? (row[cols.payItemNumber] ?? "").toString().trim()
        : "";
    out.push({
      rowIndex: out.length,
      description,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit,
      payItemNumberHint: payItemHint || null,
    });
  }
  return out;
}

export async function parseFile(file: File): Promise<ParsedRow[]> {
  const isCsv =
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv";

  let rows: unknown[][] = [];

  if (isCsv) {
    const text = await file.text();
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    rows = result.data as unknown[][];
  } else {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const ws = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
    }) as unknown[][];
  }

  return parseRows(rows);
}
