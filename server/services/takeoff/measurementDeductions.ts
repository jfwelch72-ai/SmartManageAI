/**
 * Task #2576 — Parse the JSON-encoded `deductions` field on a takeoff
 * measurement and return gross/deduction/net area in square feet.
 *
 * Historically the AI summarizer and exports treated `computedAreaFt2`
 * as the net value, but it is actually the *gross* area for any
 * measurement that has openings (windows, doorways, equipment pads).
 * This helper is the single source of truth that everyone — exports,
 * AI prompt, material calculator — should call before quoting an area.
 *
 * The `deductions` column is a JSON array of objects shaped like one of:
 *   { areaFt2: number, label?: string }            // explicit
 *   { width: number, height: number, ... }         // rectangular opening (ft)
 *   { points: [{x,y}, ...], scalePxPerFoot: number } // polygonal opening
 *
 * Unknown shapes are skipped (logged once at the call site if needed).
 */

import { computePolygonAreaInFt2 } from "@shared/utils/geometry";

export interface DeductionEntry {
  areaFt2?: number;
  label?: string;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  scalePxPerFoot?: number;
}

export interface NetAreaBreakdown {
  grossAreaFt2: number;
  deductionAreaFt2: number;
  netAreaFt2: number;
  deductionCount: number;
}

export function parseDeductions(raw: unknown): DeductionEntry[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: DeductionEntry[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") out.push(item as DeductionEntry);
  }
  return out;
}

export function deductionEntryAreaFt2(
  entry: DeductionEntry,
  fallbackScalePxPerFoot: number,
): number {
  if (typeof entry.areaFt2 === "number" && Number.isFinite(entry.areaFt2)) {
    return Math.max(0, entry.areaFt2);
  }
  if (
    typeof entry.width === "number" &&
    typeof entry.height === "number" &&
    Number.isFinite(entry.width) &&
    Number.isFinite(entry.height)
  ) {
    return Math.max(0, entry.width * entry.height);
  }
  if (entry.points && entry.points.length >= 3) {
    const scale = entry.scalePxPerFoot ?? fallbackScalePxPerFoot;
    if (scale > 0) {
      return Math.max(0, computePolygonAreaInFt2(entry.points, scale));
    }
  }
  return 0;
}

/**
 * Resolve net area for a measurement-shaped object. Caller supplies
 * the gross area (typically `measurement.computedAreaFt2`) and the
 * raw `deductions` field; we return all three values plus a count of
 * deductions actually applied so callers can flag rows that have a
 * non-zero deduction in their UI.
 */
export function resolveNetAreaFt2(opts: {
  grossAreaFt2: number | null | undefined;
  rawDeductions: unknown;
  scalePxPerFoot?: number | null;
}): NetAreaBreakdown {
  const gross = Math.max(0, Number(opts.grossAreaFt2 ?? 0) || 0);
  const fallbackScale = Number(opts.scalePxPerFoot ?? 0) || 0;
  const entries = parseDeductions(opts.rawDeductions);
  let deduction = 0;
  let applied = 0;
  for (const entry of entries) {
    const area = deductionEntryAreaFt2(entry, fallbackScale);
    if (area > 0) {
      deduction += area;
      applied += 1;
    }
  }
  const net = Math.max(0, gross - deduction);
  return {
    grossAreaFt2: gross,
    deductionAreaFt2: deduction,
    netAreaFt2: net,
    deductionCount: applied,
  };
}
