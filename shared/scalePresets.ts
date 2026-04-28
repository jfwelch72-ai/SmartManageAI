// Task #2322 — Shared scale presets and parsing helpers.
//
// Lifted from `client/src/components/takeoff/types.ts` (COMMON_SCALES) and
// `client/src/lib/scaleDetection.ts` (findMatchingPreset) so the AI takeoff
// pipeline running on the server can compare a model-detected drawing scale
// against the user's verified calibration without pulling in any browser-only
// imports. The original client modules continue to work unchanged.

export interface ScalePreset {
  label: string;
  pxPerFoot: number;
  description?: string;
}

export const COMMON_SCALES: Record<string, ScalePreset[]> = {
  architectural: [
    { label: '1/16" = 1\'-0"', pxPerFoot: 6, description: "Very small scale" },
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Small scale" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Common floor plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Medium detail" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed plans" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large detail" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Enlarged details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Large details" },
  ],
  civil: [
    { label: '1" = 10\'', pxPerFoot: 9.6, description: "Small site plans" },
    { label: '1" = 20\'', pxPerFoot: 4.8, description: "Medium site plans" },
    { label: '1" = 30\'', pxPerFoot: 3.2, description: "Large site plans" },
    { label: '1" = 40\'', pxPerFoot: 2.4, description: "Very large sites" },
    { label: '1" = 50\'', pxPerFoot: 1.92, description: "Regional plans" },
    { label: '1" = 60\'', pxPerFoot: 1.6, description: "Large regional" },
    { label: '1" = 100\'', pxPerFoot: 0.96, description: "Master plans" },
  ],
  structural: [
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Overall framing" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Framing plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Connection details" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed connections" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large details" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Connection details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Bolt details" },
  ],
};

export function findMatchingPreset(pxPerFoot: number, tolerance = 0.05): ScalePreset | null {
  if (!Number.isFinite(pxPerFoot) || pxPerFoot <= 0) return null;
  for (const scales of Object.values(COMMON_SCALES)) {
    for (const scale of scales) {
      if (Math.abs(scale.pxPerFoot - pxPerFoot) / scale.pxPerFoot < tolerance) {
        return scale;
      }
    }
  }
  return null;
}

function parseFractionString(s: string): number | null {
  const parts = s.split("/");
  if (parts.length !== 2) return null;
  const num = parseInt(parts[0], 10);
  const den = parseInt(parts[1], 10);
  if (!num || !den) return null;
  return num / den;
}

function parseMixedOrFraction(s: string): number | null {
  const trimmed = s.trim();
  const mixed = trimmed.match(/^(\d+)[-\s](\d+)\/(\d+)$/);
  if (mixed) {
    const whole = parseInt(mixed[1], 10);
    const num = parseInt(mixed[2], 10);
    const den = parseInt(mixed[3], 10);
    if (!den) return null;
    return whole + num / den;
  }
  if (/^\d+\/\d+$/.test(trimmed)) return parseFractionString(trimmed);
  const f = parseFloat(trimmed);
  return Number.isFinite(f) ? f : null;
}

// Parse a drawing-scale string emitted by the model (or read from a title block)
// into a px-per-foot value, normalising inch/foot tick marks and the words
// "inch"/"foot". Handles common architectural ("1/4\" = 1'-0\""), civil
// ("1\" = 20'"), metric ratio ("1:50", "1:100 (mm)") and inverted civil
// ("20' = 1\"") forms. Title-block callouts that explicitly disclaim a
// paper-space scale ("NTS", "AS SHOWN", "NOT TO SCALE") are recognised and
// returned with `source: "not-to-scale"` so callers can suppress the
// mismatch warning instead of false-alarming on a numeric comparison.
export type ParsedDrawingScale =
  | {
      pxPerFoot: number;
      label: string;
      source: "architectural" | "civil" | "ratio";
    }
  | {
      pxPerFoot: null;
      label: "NTS" | "AS SHOWN";
      source: "not-to-scale";
    };

export function parseDrawingScaleString(
  input: string | null | undefined,
): ParsedDrawingScale | null {
  if (!input || typeof input !== "string") return null;

  // Detect explicit not-to-scale callouts BEFORE the inch/foot normalisation
  // below — that pass swaps the literal words IN/INCH/FT/FEET/FOOT for tick
  // marks, which would otherwise mangle phrases like "AS SHOWN".
  const upperRaw = input.trim().toUpperCase().replace(/\s+/g, " ");
  if (upperRaw) {
    const ntsMatch = upperRaw.match(
      /^(?:SCALE\s*[:=]?\s*)?(NTS|N\.T\.S\.?|NOT\s+TO\s+SCALE|AS\s+SHOWN)$/,
    );
    if (ntsMatch) {
      const tag = ntsMatch[1];
      const label: "NTS" | "AS SHOWN" = /AS\s+SHOWN/.test(tag) ? "AS SHOWN" : "NTS";
      return { pxPerFoot: null, label, source: "not-to-scale" };
    }
  }

  const raw = input
    .replace(/[\u2032\u2019]/g, "'")
    .replace(/[\u2033\u201C\u201D\u2036]/g, '"')
    .replace(/\bINCH(?:ES)?\b/gi, '"')
    .replace(/\bIN\b/gi, '"')
    .replace(/\bFEET\b/gi, "'")
    .replace(/\bFOOT\b/gi, "'")
    .replace(/\bFT\b/gi, "'");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Architectural: <fraction|mixed|num>" = 1'-0"  (or just 1')
  const arch = text.match(/^(?:SCALE\s*[:=]\s*)?((?:\d+[-\s])?\d+(?:\/\d+)?)\s*"\s*=\s*1\s*'(?:\s*-?\s*0\s*")?$/i);
  if (arch) {
    const left = parseMixedOrFraction(arch[1]);
    if (left && left > 0) {
      const px = left * 96;
      return { pxPerFoot: px, label: `${arch[1]}" = 1'-0"`, source: "architectural" };
    }
  }

  // Civil: 1" = N'   (N feet, integer)
  const civil = text.match(/^(?:SCALE\s*[:=]\s*)?1\s*"\s*=\s*(\d+)\s*'$/i);
  if (civil) {
    const feet = parseInt(civil[1], 10);
    if (feet > 0) {
      return { pxPerFoot: 96 / feet, label: `1" = ${feet}'`, source: "civil" };
    }
  }

  // Generic inches = feet: M" = N'
  const generic = text.match(/^(?:SCALE\s*[:=]\s*)?(\d+(?:\.\d+)?)\s*"\s*=\s*(\d+(?:\.\d+)?)\s*'$/i);
  if (generic) {
    const inches = parseFloat(generic[1]);
    const feet = parseFloat(generic[2]);
    if (inches > 0 && feet > 0) {
      const px = (inches * 96) / feet;
      const label = inches === 1 ? `1" = ${feet}'` : `${generic[1]}" = ${generic[2]}'`;
      return { pxPerFoot: px, label, source: feet >= 5 ? "civil" : "architectural" };
    }
  }

  // Inverted civil: N' = M"   (e.g. "20' = 1\"" — same scale as 1" = 20').
  // Some title blocks (and the model) write the ground distance first.
  const inverted = text.match(/^(?:SCALE\s*[:=]\s*)?(\d+(?:\.\d+)?)\s*'\s*=\s*(\d+(?:\.\d+)?)\s*"$/i);
  if (inverted) {
    const feet = parseFloat(inverted[1]);
    const inches = parseFloat(inverted[2]);
    if (feet > 0 && inches > 0) {
      const px = (inches * 96) / feet;
      // Normalise the label into the canonical "M\" = N'" form so downstream
      // snapping/UI matches the existing civil/architectural labels.
      const inchesLabel = inches === Math.trunc(inches) ? `${inches}` : `${inches}`;
      const feetLabel = feet === Math.trunc(feet) ? `${feet}` : `${feet}`;
      const label = inches === 1 ? `1" = ${feetLabel}'` : `${inchesLabel}" = ${feetLabel}'`;
      return { pxPerFoot: px, label, source: feet >= 5 ? "civil" : "architectural" };
    }
  }

  // Metric ratio: 1:N, optionally followed by a unit suffix the model likes
  // to volunteer for metric sheets — bare "mm"/"cm"/"m", parenthesised
  // "(mm)", or the word "METRIC". The ratio itself is dimensionless so the
  // suffix doesn't change the px/ft calculation; we just need to accept it.
  const ratio = text.match(
    /^(?:SCALE\s*[:=]\s*)?1\s*:\s*(\d+)(?:\s*\(\s*(?:MM|CM|M|METRIC)\s*\))?(?:\s+(?:MM|CM|M|METRIC))?$/i,
  );
  if (ratio) {
    const r = parseInt(ratio[1], 10);
    if (r > 0) {
      return { pxPerFoot: (96 * 12) / r, label: `1:${r}`, source: "ratio" };
    }
  }

  return null;
}

// Compares an AI-detected scale (parsed from `metadata.drawingScale`) against
// the user's calibrated scale. Returns a mismatch warning string when the two
// disagree by more than `tolerance` (default 5%).
export function buildScaleMismatchWarning(
  detectedScaleString: string | null | undefined,
  calibratedPxPerFoot: number | null | undefined,
  calibratedLabel: string | null | undefined,
  tolerance = 0.05,
): string | null {
  if (!calibratedPxPerFoot || calibratedPxPerFoot <= 0) return null;
  const detected = parseDrawingScaleString(detectedScaleString);
  if (!detected) return null;
  // Documented rationale: when the title block explicitly disclaims a
  // paper-space scale ("NTS", "AS SHOWN", "NOT TO SCALE") there is no
  // numeric scale to compare against, so a mismatch warning would be a
  // false alarm. Stay silent and let the user trust their calibration.
  if (detected.source === "not-to-scale" || detected.pxPerFoot == null) return null;
  const snapped = findMatchingPreset(detected.pxPerFoot) ?? {
    label: detected.label,
    pxPerFoot: detected.pxPerFoot,
  };
  const calibratedSnapped = findMatchingPreset(calibratedPxPerFoot);
  const calibratedDisplay = calibratedLabel || calibratedSnapped?.label || `${calibratedPxPerFoot.toFixed(2)} px/ft`;
  const delta = Math.abs(snapped.pxPerFoot - calibratedPxPerFoot) / calibratedPxPerFoot;
  if (delta <= tolerance) return null;
  return `AI inferred scale ${snapped.label}, but this sheet is calibrated to ${calibratedDisplay}. Re-verify before accepting items.`;
}
