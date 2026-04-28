/**
 * Task #2236 — Helpers for labelling the active polar guide ray with
 * its bearing + the live cursor distance from the anchor.
 *
 * Pure functions so we can pin the wire format independently of the
 * Konva render block in `CanvasStage.tsx`. The CAD-style formatter
 * matches the `12'-6"` shorthand cited in the task: feet and whole
 * inches, with sub-foot distances collapsed to bare inches and
 * rounding to the nearest inch (the polar fan is a coarse drafting
 * aid — the segment label below the in-progress line still carries
 * the precise `12.34'` decimal value).
 */

/**
 * Format the snapped angle of the highlighted polar ray.
 *
 * Input is in math-Y-down screen coordinates (the angle that
 * `Math.atan2(cursorY - anchorY, cursorX - anchorX)` would produce
 * before snapping). We invert Y so the rendered bearing matches what
 * the user perceives on screen — dragging the cursor up-right of the
 * anchor reads as `45°`, not `-45°` — and normalize into `[0, 360)`.
 */
export function formatPolarAngleDeg(screenDegYDown: number): string {
  let deg = -screenDegYDown;
  deg = ((deg % 360) + 360) % 360;
  // Strip the trailing `.0` so common preset bearings (45°, 90°,
  // 270°) read clean instead of `45.0°`.
  const rounded = Math.round(deg * 10) / 10;
  return Number.isInteger(rounded)
    ? `${rounded.toFixed(0)}°`
    : `${rounded.toFixed(1)}°`;
}

/**
 * Format a length in feet using the CAD `feet'-inches"` shorthand.
 *
 * - `0` → `0"`
 * - sub-foot → bare `7"`
 * - whole-foot → bare `12'`
 * - mixed → `12'-6"`
 *
 * Inches are rounded to the nearest whole; rounding 12 carries into
 * the foot column so we never emit `11'-12"`.
 */
export function formatPolarDistanceFt(ft: number): string {
  if (!Number.isFinite(ft)) return "—";
  const sign = ft < 0 ? "-" : "";
  const abs = Math.abs(ft);
  const inchesTotal = Math.round(abs * 12);
  if (inchesTotal === 0) return `0"`;
  const wholeFt = Math.floor(inchesTotal / 12);
  const inches = inchesTotal % 12;
  if (wholeFt === 0) return `${sign}${inches}"`;
  if (inches === 0) return `${sign}${wholeFt}'`;
  return `${sign}${wholeFt}'-${inches}"`;
}

/**
 * Combine the angle + distance into the single-line cursor label.
 *
 * Skipping the distance (e.g. when the sheet has no scale calibrated
 * yet) keeps the angle visible — a polar lock without scale is still
 * useful as a bearing aid.
 */
export function formatPolarGuideLabel(
  screenDegYDown: number,
  distanceFt: number | null,
): string {
  const angle = formatPolarAngleDeg(screenDegYDown);
  if (distanceFt == null) return angle;
  return `${angle}  ${formatPolarDistanceFt(distanceFt)}`;
}
