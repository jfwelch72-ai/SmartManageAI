/**
 * Task #2332 — Sheet-level capture-scale confidence indicator.
 *
 * Today every measurement on a sheet inherits a binary "calibrated or
 * not" state from the sheet's `scalePxPerFoot`. Sheets calibrated by
 * AI auto-scale detection or by a quick two-point capture against a
 * reference legend are not equally trustworthy. This helper distills
 * those signals into a coarse confidence level (HIGH / MEDIUM / LOW /
 * UNVERIFIED) plus a tooltip explaining the rationale, so the sheet
 * header can render a single clickable chip that an estimator can
 * triage at a glance.
 *
 * The score combines three independent signals:
 *
 *   1. **How the sheet was calibrated** (`scaleSource`). USER_TWO_POINT
 *      and STANDARD_SCALE start at HIGH. AI_DETECTED and BULK_PROPAGATED
 *      start at MEDIUM. INHERITED_FROM_PARENT starts at LOW because the
 *      label was carried across a revision but never re-verified.
 *      UNVERIFIED stays UNVERIFIED.
 *
 *   2. **The server's confidence band** (`scaleConfidence`). The AI
 *      detector emits HIGH/MEDIUM/LOW; the supersede flow downgrades
 *      to UNVERIFIED. We use this as a *cap* so the indicator never
 *      claims more confidence than the server is willing to vouch for.
 *
 *   3. **Drift between captured scale labels** on this sheet. When a
 *      sheet's measurements were captured under one scale label but
 *      the sheet's current `scaleLabel` is different, the older
 *      measurements were taken against a different ruler. That's a
 *      strong signal the sheet's calibration changed mid-takeoff and
 *      the user should re-verify before continuing. Drift demotes the
 *      indicator one notch.
 *
 * The output is intentionally view-model shaped (label, dotClass,
 * tooltip, hasDrift) rather than raw enum values so the UI doesn't
 * have to re-derive the same strings in three places.
 */

export type SheetCalibrationConfidenceLevel =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNVERIFIED";

/**
 * Subset of `TakeoffSheet` we read. Defining a structural type means
 * the helper is trivially testable without spinning up the full
 * Drizzle row shape, and lets the workspace pass a partial sheet
 * (e.g. when the API response hasn't projected the provenance
 * columns yet) without TypeScript fighting it.
 */
export interface SheetCalibrationInput {
  scalePxPerFoot?: number | null;
  scaleLabel?: string | null;
  scaleSource?: string | null;
  scaleConfidence?: string | null;
}

/**
 * Subset of `TakeoffMeasurement` we read. Only the immutable scale
 * snapshot fields matter for drift detection.
 */
export interface MeasurementCalibrationInput {
  scaleAtCaptureLabel?: string | null;
  scaleAtCapturePxPerFoot?: number | null;
}

export interface SheetCalibrationConfidence {
  confidence: SheetCalibrationConfidenceLevel;
  /** Short word ("High", "Medium", "Low", "Unverified") for the chip. */
  label: string;
  /** Tailwind class for the indicator dot. */
  dotClass: string;
  /** Tailwind classes for the chip's outer ring/foreground. */
  chipClass: string;
  /** One-paragraph human-readable explanation surfaced as a tooltip. */
  tooltip: string;
  /** Source phrase used in the tooltip (also useful for ARIA labels). */
  sourceText: string;
  /** Number of measurements considered when computing the score. */
  measurementCount: number;
  /** Whether captured labels disagree with the sheet's current label. */
  hasDrift: boolean;
  /** Distinct captured labels that disagree with the sheet's current label. */
  driftLabels: string[];
}

const LEVEL_RANK: Record<SheetCalibrationConfidenceLevel, number> = {
  UNVERIFIED: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

const RANK_LEVEL: Record<number, SheetCalibrationConfidenceLevel> = {
  0: "UNVERIFIED",
  1: "LOW",
  2: "MEDIUM",
  3: "HIGH",
};

function clampLevel(rank: number): SheetCalibrationConfidenceLevel {
  if (rank <= 0) return "UNVERIFIED";
  if (rank >= 3) return "HIGH";
  return RANK_LEVEL[rank];
}

function baseLevelForSource(
  source: string | null | undefined,
): SheetCalibrationConfidenceLevel {
  switch (source) {
    case "USER_TWO_POINT":
    case "STANDARD_SCALE":
      return "HIGH";
    case "AI_DETECTED":
    case "BULK_PROPAGATED":
      return "MEDIUM";
    case "INHERITED_FROM_PARENT":
      return "LOW";
    case "UNVERIFIED":
    default:
      return "UNVERIFIED";
  }
}

function describeSource(source: string | null | undefined): string {
  switch (source) {
    case "USER_TWO_POINT":
      return "Calibrated by you (two-point ruler)";
    case "STANDARD_SCALE":
      return "Standard scale applied";
    case "AI_DETECTED":
      return "Auto-detected from sheet";
    case "BULK_PROPAGATED":
      return "Applied to entire Sheet Set";
    case "INHERITED_FROM_PARENT":
      return "Inherited from previous revision";
    case "UNVERIFIED":
    default:
      return "Scale not yet verified";
  }
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  const trimmed = label.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Look across this sheet's measurements and determine whether their
 * `scaleAtCaptureLabel` snapshots agree with the sheet's current
 * `scaleLabel`. Two scenarios count as drift:
 *
 *   1. Two different non-null capture labels exist in the same sheet
 *      (the user re-calibrated mid-takeoff).
 *   2. At least one capture label disagrees with the sheet's current
 *      label (the sheet's calibration changed *after* some
 *      measurements were committed).
 *
 * Capture labels that are null/empty are ignored — they predate the
 * snapshot column or were committed before a label was set.
 */
function detectDrift(
  sheet: SheetCalibrationInput,
  measurements: ReadonlyArray<MeasurementCalibrationInput>,
): { hasDrift: boolean; driftLabels: string[] } {
  const sheetLabel = normalizeLabel(sheet.scaleLabel);
  const captured = new Set<string>();
  for (const m of measurements) {
    const label = normalizeLabel(m.scaleAtCaptureLabel);
    if (label) captured.add(label);
  }
  if (captured.size === 0) return { hasDrift: false, driftLabels: [] };

  // More than one distinct snapshot → mid-takeoff drift.
  if (captured.size > 1) {
    return { hasDrift: true, driftLabels: Array.from(captured).sort() };
  }

  // Single snapshot that disagrees with the sheet's current label.
  if (sheetLabel && !captured.has(sheetLabel)) {
    return { hasDrift: true, driftLabels: Array.from(captured).sort() };
  }

  return { hasDrift: false, driftLabels: [] };
}

/**
 * Task #2345 — Per-measurement drift selector. A single row is in
 * drift when it carries a non-empty `scaleAtCaptureLabel` snapshot
 * that disagrees with the sheet's current `scaleLabel`. Rows whose
 * snapshot is null/empty (legacy rows committed before the snapshot
 * column shipped, or count-style measurements that were never
 * stamped) are intentionally NOT flagged — there's no captured label
 * to disagree with, so a "Recapture at current scale" affordance
 * would have nothing to compare against. Rows on a sheet whose
 * current `scaleLabel` itself is null are also not flagged: the
 * sheet has no authoritative label to recapture *to*.
 *
 * The chip-level `detectDrift` above also flags multi-label drift
 * across the sheet (two captures against different labels even if
 * one matches). The per-row selector deliberately doesn't: each
 * row's affordance is about *its own* snapshot, not about the
 * sheet's mixed history. The bulk action on the sheet remains the
 * way to remediate a multi-label situation.
 */
export function measurementHasDrift(
  sheet: SheetCalibrationInput | null | undefined,
  measurement: MeasurementCalibrationInput | null | undefined,
): boolean {
  if (!sheet || !measurement) return false;
  const sheetLabel = normalizeLabel(sheet.scaleLabel);
  const captured = normalizeLabel(measurement.scaleAtCaptureLabel);
  if (!sheetLabel || !captured) return false;
  return sheetLabel !== captured;
}

/**
 * Task #2345 — Bulk helper: project the IDs of all drifting
 * measurements on a sheet so the bulk-remediate action and the
 * "N drifting" count can read from the same source of truth as the
 * per-row affordance.
 */
export function selectDriftingMeasurementIds<
  T extends MeasurementCalibrationInput & { id: string },
>(
  sheet: SheetCalibrationInput | null | undefined,
  measurements: ReadonlyArray<T>,
): string[] {
  if (!sheet) return [];
  const out: string[] = [];
  for (const m of measurements) {
    if (measurementHasDrift(sheet, m)) out.push(m.id);
  }
  return out;
}

const LEVEL_LABEL: Record<SheetCalibrationConfidenceLevel, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  UNVERIFIED: "Unverified",
};

const LEVEL_DOT_CLASS: Record<SheetCalibrationConfidenceLevel, string> = {
  HIGH: "bg-green-500 dark:bg-green-400",
  MEDIUM: "bg-amber-500 dark:bg-amber-400",
  LOW: "bg-orange-500 dark:bg-orange-400",
  UNVERIFIED: "bg-red-500 dark:bg-red-400",
};

const LEVEL_CHIP_CLASS: Record<SheetCalibrationConfidenceLevel, string> = {
  HIGH:
    "border-green-500/50 text-green-700 dark:text-green-300 hover:bg-green-500/10",
  MEDIUM:
    "border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10",
  LOW:
    "border-orange-500/50 text-orange-700 dark:text-orange-300 hover:bg-orange-500/10",
  UNVERIFIED:
    "border-red-500/50 text-red-700 dark:text-red-300 hover:bg-red-500/10",
};

export function computeSheetCalibrationConfidence(
  sheet: SheetCalibrationInput | null | undefined,
  measurements: ReadonlyArray<MeasurementCalibrationInput> = [],
): SheetCalibrationConfidence {
  const measurementCount = measurements.length;

  // No sheet selected, or sheet has no scale at all → UNVERIFIED.
  if (!sheet || sheet.scalePxPerFoot == null) {
    const sourceText = "Scale not yet verified";
    return {
      confidence: "UNVERIFIED",
      label: LEVEL_LABEL.UNVERIFIED,
      dotClass: LEVEL_DOT_CLASS.UNVERIFIED,
      chipClass: LEVEL_CHIP_CLASS.UNVERIFIED,
      sourceText,
      tooltip:
        "This sheet isn't calibrated yet — measurements taken against it will be unreliable. Click to open the calibration tool.",
      measurementCount,
      hasDrift: false,
      driftLabels: [],
    };
  }

  const source = sheet.scaleSource ?? "UNVERIFIED";
  const sourceText = describeSource(source);
  const baseLevel = baseLevelForSource(source);

  // Cap by the server-supplied confidence band so we never claim more
  // certainty than the server vouches for.
  const serverConfidence = (sheet.scaleConfidence ?? null) as
    | SheetCalibrationConfidenceLevel
    | null;
  const cappedRank =
    serverConfidence && serverConfidence in LEVEL_RANK
      ? Math.min(LEVEL_RANK[baseLevel], LEVEL_RANK[serverConfidence])
      : LEVEL_RANK[baseLevel];

  const drift = detectDrift(sheet, measurements);
  // Drift demotes one notch; floor at UNVERIFIED.
  const finalRank = drift.hasDrift ? Math.max(cappedRank - 1, 0) : cappedRank;
  const finalLevel = clampLevel(finalRank);

  const driftSentence = drift.hasDrift
    ? drift.driftLabels.length === 1
      ? ` Some measurements were captured at "${drift.driftLabels[0]}" but the sheet now reads "${normalizeLabel(sheet.scaleLabel) ?? "an unlabelled scale"}".`
      : ` Measurements on this sheet were captured against ${drift.driftLabels.length} different scale labels (${drift.driftLabels.map((l) => `"${l}"`).join(", ")}).`
    : "";

  const measurementSentence =
    measurementCount === 0
      ? " No measurements have been captured against it yet."
      : measurementCount === 1
        ? " 1 measurement has been captured against it."
        : ` ${measurementCount} measurements have been captured against it.`;

  const tooltip =
    `${sourceText} · ${LEVEL_LABEL[finalLevel].toLowerCase()} confidence.` +
    measurementSentence +
    driftSentence +
    " Click to open the calibration tool.";

  return {
    confidence: finalLevel,
    label: LEVEL_LABEL[finalLevel],
    dotClass: LEVEL_DOT_CLASS[finalLevel],
    chipClass: LEVEL_CHIP_CLASS[finalLevel],
    sourceText,
    tooltip,
    measurementCount,
    hasDrift: drift.hasDrift,
    driftLabels: drift.driftLabels,
  };
}
