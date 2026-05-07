/**
 * Task #2578 — AIA G703-compatible Schedule of Values (xlsx).
 *
 * Produces a workbook whose first sheet matches the AIA G702/G703
 * column conventions (Item, Description, Scheduled Value, Work Completed
 * From Previous, This Period, Materials Stored, Total Completed/Stored,
 * % G/C, Balance to Finish, Retainage). Column F (Materials Presently
 * Stored) and "%" are seeded as live formulas so the customer can paste
 * progress numbers directly.
 */

import * as XLSX from "xlsx";

export interface SovInputLine {
  itemNumber: string;
  description: string;
  scheduledValue: number;
}

export interface SovInput {
  projectName: string;
  projectCode: string;
  contractor: string;
  owner?: string;
  applicationNumber?: number;
  periodTo?: string;
  retainagePercent?: number;
  lines: SovInputLine[];
}

type FormulaCell = { f: string };
type AoaValue = string | number | FormulaCell;
type AoaRow = AoaValue[];

function isFormulaCell(v: unknown): v is FormulaCell {
  return typeof v === "object" && v !== null && typeof (v as { f?: unknown }).f === "string";
}

export function generateSovG703Xlsx(input: SovInput): Buffer {
  const wb = XLSX.utils.book_new();
  const headerRows: AoaRow[] = [
    ["AIA Document G703 — Continuation Sheet"],
    [`Project: ${input.projectName}`, "", "", "", "", "", `Code: ${input.projectCode}`],
    [`To Owner: ${input.owner ?? ""}`, "", "", "", "", "", `From Contractor: ${input.contractor}`],
    [`Application No.: ${input.applicationNumber ?? 1}`, "", "", "", "", "", `Period To: ${input.periodTo ?? new Date().toLocaleDateString()}`],
    [],
    [
      "A\nItem No.",
      "B\nDescription of Work",
      "C\nScheduled Value",
      "D\nFrom Previous Application",
      "E\nThis Period",
      "F\nMaterials Presently Stored",
      "G\nTotal Completed and Stored to Date (D+E+F)",
      "H\n%\n(G ÷ C)",
      "I\nBalance to Finish (C - G)",
      "J\nRetainage",
    ],
  ];

  const dataStart = headerRows.length + 1; // 1-indexed XLSX row
  const data: AoaRow[] = input.lines.map((line, idx) => {
    const r = dataStart + idx;
    return [
      line.itemNumber,
      line.description,
      Number(line.scheduledValue || 0),
      0,                                   // D — From previous
      0,                                   // E — This period
      0,                                   // F — Materials stored
      { f: `D${r}+E${r}+F${r}` },         // G — Total completed/stored
      { f: `IF(C${r}=0,0,G${r}/C${r})` }, // H — %
      { f: `C${r}-G${r}` },               // I — Balance to finish
      { f: `G${r}*${(input.retainagePercent ?? 10) / 100}` }, // J — Retainage
    ];
  });

  // Totals row
  const totalsRow = dataStart + input.lines.length;
  const totalsRowData: AoaRow = [
    "",
    "GRAND TOTAL",
    { f: `SUM(C${dataStart}:C${totalsRow - 1})` },
    { f: `SUM(D${dataStart}:D${totalsRow - 1})` },
    { f: `SUM(E${dataStart}:E${totalsRow - 1})` },
    { f: `SUM(F${dataStart}:F${totalsRow - 1})` },
    { f: `SUM(G${dataStart}:G${totalsRow - 1})` },
    { f: `IF(C${totalsRow}=0,0,G${totalsRow}/C${totalsRow})` },
    { f: `SUM(I${dataStart}:I${totalsRow - 1})` },
    { f: `SUM(J${dataStart}:J${totalsRow - 1})` },
  ];

  const aoa: AoaRow[] = [...headerRows, ...data, totalsRowData];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Convert formula objects to proper XLSX cell objects.
  for (let r = dataStart - 1; r < totalsRow; r++) {
    for (let c = 0; c < 10; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell: XLSX.CellObject | undefined = ws[ref];
      if (cell && isFormulaCell(cell.v)) {
        const formula = cell.v.f;
        const replacement: XLSX.CellObject = { t: "n", f: formula };
        ws[ref] = replacement;
      }
    }
  }

  // Column widths
  ws["!cols"] = [
    { wch: 8 }, { wch: 42 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 14 },
  ];
  // Number format for money columns
  for (let r = dataStart - 1; r < totalsRow; r++) {
    for (const col of [2, 3, 4, 5, 6, 8, 9]) {
      const ref = XLSX.utils.encode_cell({ r, c: col });
      if (ws[ref]) ws[ref].z = '"$"#,##0.00';
    }
    const pctRef = XLSX.utils.encode_cell({ r, c: 7 });
    if (ws[pctRef]) ws[pctRef].z = "0.00%";
  }

  XLSX.utils.book_append_sheet(wb, ws, "G703");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
