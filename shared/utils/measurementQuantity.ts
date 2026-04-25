/**
 * Shared helpers for deriving the canonical "real" quantity + unit for a
 * takeoff measurement. The on-screen Measurement Summary Report dialog
 * (TakeoffSidebar) is the source of truth for these values, and CSV/PDF
 * exports (client and server) must mirror it exactly so users see the same
 * numbers everywhere.
 *
 * Centralising this logic prevents the on-screen dialog and the various
 * export paths from drifting out of sync the way they did before task #1876.
 */
export interface MeasurementQtyInput {
  type?: string | null;
  count?: number | null;
  computedLengthFt?: number | string | null;
  computedAreaFt2?: number | string | null;
  computedSurfaceAreaFt2?: number | string | null;
  computedVolumeCy?: number | string | null;
}

export interface MeasurementUnitOptions {
  /** Return units in upper case (LF/SF/CY/EA) instead of the dialog's lower case (lf/sf/cy/ea). */
  uppercase?: boolean;
}

function toNum(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Returns the canonical quantity for a measurement, matching the on-screen
 * Measurement Summary Report dialog's logic exactly:
 *   - COUNT: m.count
 *   - AREA / PITCHED_AREA: m.computedAreaFt2
 *   - SURFACE_AREA: m.computedSurfaceAreaFt2 (falls back to computedAreaFt2)
 *   - VOLUME: m.computedVolumeCy
 *   - NOTE: 0
 *   - Anything else (LINEAR / LINEAR_WITH_DROP / PITCHED_LINEAR / SEGMENT / etc.):
 *     m.computedLengthFt
 */
export function getMeasurementQty(m: MeasurementQtyInput): number {
  switch (m.type) {
    case "COUNT":
      return toNum(m.count);
    case "AREA":
    case "PITCHED_AREA":
      return toNum(m.computedAreaFt2);
    case "SURFACE_AREA":
      return toNum(m.computedSurfaceAreaFt2 || m.computedAreaFt2);
    case "VOLUME":
      return toNum(m.computedVolumeCy);
    case "NOTE":
      return 0;
    default:
      return toNum(m.computedLengthFt);
  }
}

/**
 * Returns the canonical unit string for a measurement, matching the
 * on-screen Measurement Summary Report dialog (lowercase by default).
 * Pass `{ uppercase: true }` for export contexts that historically use
 * uppercase units (Excel column headers, CSV fixtures, etc.).
 */
export function getMeasurementUnit(m: MeasurementQtyInput, opts: MeasurementUnitOptions = {}): string {
  let unit: string;
  switch (m.type) {
    case "COUNT":
      unit = "ea";
      break;
    case "AREA":
    case "PITCHED_AREA":
    case "SURFACE_AREA":
      unit = "sf";
      break;
    case "VOLUME":
      unit = "cy";
      break;
    case "NOTE":
      unit = "";
      break;
    default:
      unit = "lf";
  }
  return opts.uppercase ? unit.toUpperCase() : unit;
}
