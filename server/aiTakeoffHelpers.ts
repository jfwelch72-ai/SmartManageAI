// Task #2322 — Pure helpers extracted from `aiTakeoffFeatureRoutes.ts` so they
// can be unit-tested without pulling in the full Express route module (which
// transitively imports auth/db/rate-limiter wiring not safe to load under
// vitest).

// Cap rendered raster area at ~30 megapixels to stay within OpenAI request
// limits and the `canvas` package's safe allocation range.
export const MAX_RASTER_PIXELS = 30 * 1024 * 1024;

export interface RasterScaleResult {
  // Final raster scale to pass to PDF.js `getViewport({ scale })`.
  scale: number;
  // True when the desired tier (2.0 / 3.0 / 4.0) was clamped down because the
  // resulting pixel area would exceed `MAX_RASTER_PIXELS`. Surfaced to the UI
  // (Task #2336) so estimators can tell when fine symbols may be missing
  // because the sheet was rendered at the maximum supported resolution.
  capped: boolean;
}

// Adaptive PDF rasterization. PDF.js viewport widths/heights at `scale = 1`
// are in CSS pixels at 1 px = 1/72 inch, so the source page size in inches is
// `width / 72`. Larger physical sheets (civil 30x42, 36x48) need a higher
// raster scale so fine symbols (outlets, valves, meter pits) survive the
// resample to the model. We cap the resulting pixel area at
// `MAX_RASTER_PIXELS` so we don't blow past the OpenAI request limit.
export function computeRasterScale(
  viewportWidthAt1: number,
  viewportHeightAt1: number,
): RasterScaleResult {
  if (
    !Number.isFinite(viewportWidthAt1) ||
    !Number.isFinite(viewportHeightAt1) ||
    viewportWidthAt1 <= 0 ||
    viewportHeightAt1 <= 0
  ) {
    return { scale: 2.0, capped: false };
  }
  const widthIn = viewportWidthAt1 / 72;
  const heightIn = viewportHeightAt1 / 72;
  const longSide = Math.max(widthIn, heightIn);
  const shortSide = Math.min(widthIn, heightIn);

  let scale: number;
  if (longSide <= 36 + 0.01 && shortSide <= 24 + 0.01) {
    scale = 2.0;
  } else if (longSide <= 48 + 0.01 && shortSide <= 36 + 0.01) {
    scale = 3.0;
  } else {
    scale = 4.0;
  }

  let capped = false;
  const pixelArea = viewportWidthAt1 * viewportHeightAt1 * scale * scale;
  if (pixelArea > MAX_RASTER_PIXELS) {
    const cappedScale = Math.sqrt(MAX_RASTER_PIXELS / (viewportWidthAt1 * viewportHeightAt1));
    scale = Math.max(1.0, cappedScale);
    capped = true;
  }
  return { scale, capped };
}

export interface SheetCalibration {
  scalePxPerFoot?: number | null;
  scaleLabel?: string | null;
  units?: string | null;
}

// Build the scale-grounding clause that goes into both the system prompt and
// the per-call user message so the model derives quantities from the user's
// verified calibration instead of re-guessing the scale on every run. When no
// scale is set, tell the model to flag low confidence on units derived from
// drawing dimensions (LF, SF, CY).
export function buildScaleGroundingClause(sheet: SheetCalibration | null | undefined): string {
  const px = sheet?.scalePxPerFoot;
  if (typeof px === "number" && Number.isFinite(px) && px > 0) {
    const label = sheet?.scaleLabel?.trim() || `${px.toFixed(2)} px/ft`;
    const units = sheet?.units?.trim() || "ft";
    return `The drawing scale has been verified by the estimator as ${label} (${px.toFixed(2)} px/${units}). Use this scale to derive all quantities — do not infer scale from the title block.`;
  }
  return "Drawing scale not yet calibrated; estimate quantities and flag low confidence on dimension-derived units (LF, SF, CY).";
}
