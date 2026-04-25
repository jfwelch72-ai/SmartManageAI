import * as XLSX from "xlsx";
import type { TakeoffMeasurement, TakeoffSheet, QuantityCategory } from "@shared/schema";
import { getMeasurementQty, getMeasurementUnit } from "@shared/utils/measurementQuantity";

export interface TakeoffExportOptions {
  projectName: string;
  measurements: TakeoffMeasurement[];
  sheets: TakeoffSheet[];
  categories: QuantityCategory[];
  hiddenCategoryIds?: Set<string>;
}

// Task #1923 — both the on-screen Measurement Summary Report dialog and
// every CSV/PDF/Excel export route through the same shared helpers so the
// exported quantities can never diverge from what users see on screen.
// Excel/CSV historically use uppercase units (LF/SF/CY/EA) so we pass
// `{ uppercase: true }` here while the dialog uses the lowercase default.
function getQuantity(m: TakeoffMeasurement): number {
  return getMeasurementQty(m);
}

function getUnit(type: string): string {
  return getMeasurementUnit({ type }, { uppercase: true });
}

function getSheetName(sheetId: string, sheets: TakeoffSheet[]): string {
  const sheet = sheets.find(s => s.id === sheetId);
  return sheet?.sheetName || "Unknown Sheet";
}

function getCategoryName(categoryId: string | null, categories: QuantityCategory[]): string {
  if (!categoryId) return "Uncategorized";
  const cat = categories.find(c => c.id === categoryId);
  return cat?.name || "Unknown";
}

function autoFitColumns(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const colWidths: number[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxLen = 8;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = ws[cellRef];
      if (!cell) continue;
      let cellText = "";
      if (cell.t === "n") {
        cellText = cell.z ? XLSX.SSF.format(cell.z, cell.v) : String(cell.v);
      } else if (cell.v != null) {
        cellText = String(cell.v);
      }
      maxLen = Math.max(maxLen, cellText.length + 2);
    }
    colWidths.push(Math.min(maxLen, 40));
  }

  ws["!cols"] = colWidths.map(w => ({ wch: w }));
}

function applyCellFormat(ws: XLSX.WorkSheet, row: number, col: number, fmt: string) {
  const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[cellRef];
  if (cell && cell.t === "n") {
    cell.z = fmt;
  }
}

function applyFormatsToRows(ws: XLSX.WorkSheet, startRow: number, endRow: number, colFormats: Record<number, string>) {
  for (let r = startRow; r <= endRow; r++) {
    for (const [col, fmt] of Object.entries(colFormats)) {
      applyCellFormat(ws, r, Number(col), fmt);
    }
  }
}

function styleHeaderRow(ws: XLSX.WorkSheet, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[cellRef];
    if (cell) {
      if (!cell.s) cell.s = {};
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { patternType: "solid", fgColor: { rgb: "3B82F6" } },
        alignment: { horizontal: "center" },
      };
    }
  }
}

function filterMeasurements(
  measurements: TakeoffMeasurement[],
  hiddenCategoryIds?: Set<string>
): TakeoffMeasurement[] {
  if (!hiddenCategoryIds || hiddenCategoryIds.size === 0) return measurements;
  return measurements.filter(m => !m.categoryId || !hiddenCategoryIds.has(m.categoryId));
}

function buildSummarySheet(measurements: TakeoffMeasurement[], categories: QuantityCategory[]): XLSX.WorkSheet {
  const headers = ["Category", "Measurement Type", "Total Quantity", "Unit", "Unit Cost", "Total Cost"];
  const rows: any[][] = [headers];

  const grouped: Record<string, Record<string, TakeoffMeasurement[]>> = {};
  measurements.forEach(m => {
    const catName = getCategoryName(m.categoryId, categories);
    if (!grouped[catName]) grouped[catName] = {};
    if (!grouped[catName][m.type]) grouped[catName][m.type] = [];
    grouped[catName][m.type].push(m);
  });

  Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).forEach(([catName, types]) => {
    Object.entries(types).forEach(([type, ms]) => {
      const totalQty = ms.reduce((sum, m) => sum + getQuantity(m), 0);
      const unit = getUnit(type);
      const avgUnitCost = ms.reduce((sum, m) => sum + (Number(m.unitCost) || 0), 0) / ms.length;
      const totalCost = ms.reduce((sum, m) => {
        const qty = getQuantity(m);
        const uc = Number(m.unitCost) || 0;
        return sum + qty * uc;
      }, 0);

      rows.push([
        catName,
        type,
        Number(totalQty.toFixed(2)),
        unit,
        avgUnitCost > 0 ? Number(avgUnitCost.toFixed(2)) : "",
        totalCost > 0 ? Number(totalCost.toFixed(2)) : "",
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyFormatsToRows(ws, 1, rows.length - 1, { 2: "0.00", 4: "$#,##0.00", 5: "$#,##0.00" });
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  return ws;
}

function buildMeasurementsSheet(
  measurements: TakeoffMeasurement[],
  sheets: TakeoffSheet[],
  categories: QuantityCategory[]
): XLSX.WorkSheet {
  const headers = ["Sheet", "Category", "Label", "Type", "Quantity", "Unit", "Unit Cost", "Cost Code", "Total Cost"];
  const rows: any[][] = [headers];

  measurements.forEach(m => {
    const qty = getQuantity(m);
    const unit = getUnit(m.type);
    const unitCost = Number(m.unitCost) || 0;
    const totalCost = qty * unitCost;

    rows.push([
      getSheetName(m.sheetId, sheets),
      getCategoryName(m.categoryId, categories),
      m.label || "Untitled",
      m.type,
      Number(qty.toFixed(2)),
      unit,
      unitCost > 0 ? Number(unitCost.toFixed(2)) : "",
      m.costCodeId || "",
      totalCost > 0 ? Number(totalCost.toFixed(2)) : "",
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyFormatsToRows(ws, 1, rows.length - 1, { 4: "0.00", 6: "$#,##0.00", 8: "$#,##0.00" });
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  return ws;
}

function buildBySheetWorksheet(
  measurements: TakeoffMeasurement[],
  sheets: TakeoffSheet[],
  categories: QuantityCategory[]
): XLSX.WorkSheet {
  const headers = ["Sheet", "Category", "Label", "Type", "Quantity", "Unit", "Unit Cost", "Cost Code", "Total Cost"];
  const rows: any[][] = [headers];

  const bySheet: Record<string, TakeoffMeasurement[]> = {};
  measurements.forEach(m => {
    if (!bySheet[m.sheetId]) bySheet[m.sheetId] = [];
    bySheet[m.sheetId].push(m);
  });

  Object.entries(bySheet).forEach(([sheetId, sheetMeasurements]) => {
    const sheetName = getSheetName(sheetId, sheets);
    rows.push([`--- ${sheetName} ---`, "", "", "", "", "", "", "", ""]);

    sheetMeasurements.forEach(m => {
      const qty = getQuantity(m);
      const unit = getUnit(m.type);
      const unitCost = Number(m.unitCost) || 0;
      const totalCost = qty * unitCost;
      rows.push([
        "",
        getCategoryName(m.categoryId, categories),
        m.label || "Untitled",
        m.type,
        Number(qty.toFixed(2)),
        unit,
        unitCost > 0 ? Number(unitCost.toFixed(2)) : "",
        m.costCodeId || "",
        totalCost > 0 ? Number(totalCost.toFixed(2)) : "",
      ]);
    });

    const sheetTotal = sheetMeasurements.reduce((sum, m) => {
      const qty = getQuantity(m);
      const uc = Number(m.unitCost) || 0;
      return sum + qty * uc;
    }, 0);
    if (sheetTotal > 0) {
      rows.push(["", "", "", "", "", "", "", "Subtotal:", Number(sheetTotal.toFixed(2))]);
    }
    rows.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyFormatsToRows(ws, 1, rows.length - 1, { 4: "0.00", 6: "$#,##0.00", 8: "$#,##0.00" });
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  return ws;
}

function buildByCostCodeSheet(
  measurements: TakeoffMeasurement[],
  sheets: TakeoffSheet[],
  categories: QuantityCategory[]
): XLSX.WorkSheet {
  const headers = ["Cost Code", "Sheet", "Category", "Label", "Type", "Quantity", "Unit", "Unit Cost", "Total Cost"];
  const rows: any[][] = [headers];

  const byCostCode: Record<string, TakeoffMeasurement[]> = {};
  measurements.forEach(m => {
    const code = m.costCodeId || "(No Cost Code)";
    if (!byCostCode[code]) byCostCode[code] = [];
    byCostCode[code].push(m);
  });

  Object.entries(byCostCode).sort(([a], [b]) => a.localeCompare(b)).forEach(([code, ms]) => {
    rows.push([`--- ${code} ---`, "", "", "", "", "", "", "", ""]);
    ms.forEach(m => {
      const qty = getQuantity(m);
      const unit = getUnit(m.type);
      const unitCost = Number(m.unitCost) || 0;
      const totalCost = qty * unitCost;
      rows.push([
        "",
        getSheetName(m.sheetId, sheets),
        getCategoryName(m.categoryId, categories),
        m.label || "Untitled",
        m.type,
        Number(qty.toFixed(2)),
        unit,
        unitCost > 0 ? Number(unitCost.toFixed(2)) : "",
        totalCost > 0 ? Number(totalCost.toFixed(2)) : "",
      ]);
    });

    const subtotal = ms.reduce((sum, m) => {
      const qty = getQuantity(m);
      const uc = Number(m.unitCost) || 0;
      return sum + qty * uc;
    }, 0);
    if (subtotal > 0) {
      rows.push(["", "", "", "", "", "", "", "Subtotal:", Number(subtotal.toFixed(2))]);
    }
    rows.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyFormatsToRows(ws, 1, rows.length - 1, { 5: "0.00", 7: "$#,##0.00", 8: "$#,##0.00" });
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  return ws;
}

export interface QuantityDeltaOptions {
  projectName: string;
  oldMeasurements: TakeoffMeasurement[];
  newMeasurements: TakeoffMeasurement[];
  sheets: TakeoffSheet[];
  categories: QuantityCategory[];
  oldRevision: string;
  newRevision: string;
}

export function generateQuantityDeltaReport(options: QuantityDeltaOptions): void {
  const { projectName, oldMeasurements, newMeasurements, sheets, categories, oldRevision, newRevision } = options;
  const wb = XLSX.utils.book_new();

  const catMap = new Map<string, { name: string; oldQty: number; newQty: number; unit: string; diff: number; pctChange: number }>();

  const aggregateByCategory = (measurements: TakeoffMeasurement[], target: "old" | "new") => {
    measurements.forEach(m => {
      const catId = m.categoryId || "__uncategorized__";
      const catName = getCategoryName(m.categoryId, categories);
      const qty = getQuantity(m);
      const unit = getUnit(m.type);
      if (!catMap.has(catId)) {
        catMap.set(catId, { name: catName, oldQty: 0, newQty: 0, unit, diff: 0, pctChange: 0 });
      }
      const entry = catMap.get(catId)!;
      if (target === "old") entry.oldQty += qty;
      else entry.newQty += qty;
    });
  };

  aggregateByCategory(oldMeasurements, "old");
  aggregateByCategory(newMeasurements, "new");

  catMap.forEach(entry => {
    entry.diff = entry.newQty - entry.oldQty;
    entry.pctChange = entry.oldQty > 0 ? (entry.diff / entry.oldQty) * 100 : (entry.newQty > 0 ? 100 : 0);
  });

  const headers = ["Category", "Unit", `${oldRevision} Qty`, `${newRevision} Qty`, "Difference", "% Change", "Status"];
  const rows: any[][] = [headers];

  Array.from(catMap.values())
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .forEach(entry => {
      const status = entry.diff > 0 ? "INCREASE" : entry.diff < 0 ? "DECREASE" : "NO CHANGE";
      rows.push([
        entry.name, entry.unit,
        Number(entry.oldQty.toFixed(2)), Number(entry.newQty.toFixed(2)),
        Number(entry.diff.toFixed(2)), Number(entry.pctChange.toFixed(1)),
        status,
      ]);
    });

  const totals = Array.from(catMap.values()).reduce((acc, e) => ({
    old: acc.old + e.oldQty, new: acc.new + e.newQty, diff: acc.diff + e.diff,
  }), { old: 0, new: 0, diff: 0 });

  rows.push([]);
  rows.push(["TOTAL", "", Number(totals.old.toFixed(2)), Number(totals.new.toFixed(2)), Number(totals.diff.toFixed(2)), "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Quantity Delta");

  const date = new Date().toISOString().split("T")[0];
  const safeName = (projectName || "Takeoff").replace(/[^a-zA-Z0-9 _-]/g, "");
  XLSX.writeFile(wb, `${safeName} - Quantity Delta - ${oldRevision} vs ${newRevision} - ${date}.xlsx`);
}

export interface BidPackageExportOptions {
  projectName: string;
  measurements: TakeoffMeasurement[];
  sheets: TakeoffSheet[];
  categories: QuantityCategory[];
  tradeScope: string;
}

export function generateBidPackageExport(options: BidPackageExportOptions): void {
  const { projectName, measurements, sheets, categories, tradeScope } = options;
  const wb = XLSX.utils.book_new();

  const headers = ["Item #", "Description", "Sheet", "Quantity", "Unit", "Unit Price", "Total"];
  const rows: any[][] = [headers];

  const grouped = new Map<string, TakeoffMeasurement[]>();
  measurements.forEach(m => {
    const catName = getCategoryName(m.categoryId, categories);
    if (!grouped.has(catName)) grouped.set(catName, []);
    grouped.get(catName)!.push(m);
  });

  let itemNum = 1;
  grouped.forEach((items, catName) => {
    rows.push([`--- ${catName} ---`, "", "", "", "", "", ""]);
    items.forEach(m => {
      const qty = getQuantity(m);
      const unit = getUnit(m.type);
      const sheetName = getSheetName(m.sheetId, sheets);
      rows.push([itemNum++, m.label || catName, sheetName, Number(qty.toFixed(2)), unit, "", ""]);
    });
    const catTotal = items.reduce((sum, m) => sum + getQuantity(m), 0);
    rows.push(["", "Subtotal", "", Number(catTotal.toFixed(2)), "", "", ""]);
    rows.push([]);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);
  styleHeaderRow(ws, headers.length);
  autoFitColumns(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Bid Package");

  const infoRows = [
    ["Project", projectName],
    ["Trade/Scope", tradeScope],
    ["Date", new Date().toLocaleDateString()],
    ["Total Items", measurements.length],
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(infoRows);
  autoFitColumns(infoWs);
  XLSX.utils.book_append_sheet(wb, infoWs, "Project Info");

  const date = new Date().toISOString().split("T")[0];
  const safeName = (projectName || "Takeoff").replace(/[^a-zA-Z0-9 _-]/g, "");
  XLSX.writeFile(wb, `${safeName} - Bid Package - ${tradeScope} - ${date}.xlsx`);
}

export function generateTakeoffExcel(options: TakeoffExportOptions): void {
  const { projectName, measurements, sheets, categories, hiddenCategoryIds } = options;

  const exportMeasurements = filterMeasurements(measurements, hiddenCategoryIds);

  if (exportMeasurements.length === 0) return;

  const wb = XLSX.utils.book_new();

  const summaryWs = buildSummarySheet(exportMeasurements, categories);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  const measurementsWs = buildMeasurementsSheet(exportMeasurements, sheets, categories);
  XLSX.utils.book_append_sheet(wb, measurementsWs, "Measurements");

  const bySheetWs = buildBySheetWorksheet(exportMeasurements, sheets, categories);
  XLSX.utils.book_append_sheet(wb, bySheetWs, "By Sheet");

  const byCostCodeWs = buildByCostCodeSheet(exportMeasurements, sheets, categories);
  XLSX.utils.book_append_sheet(wb, byCostCodeWs, "By Cost Code");

  const date = new Date().toISOString().split("T")[0];
  const safeName = (projectName || "Takeoff").replace(/[^a-zA-Z0-9 _-]/g, "");
  const filename = `${safeName} - Takeoff Export - ${date}.xlsx`;

  XLSX.writeFile(wb, filename);
}
