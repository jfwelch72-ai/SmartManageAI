// Task #2322 — AI takeoff quick wins (model parity, scale grounding,
// adaptive raster, scale-mismatch warning).
//
// These four assertions pin in the small surrounding-pipeline fixes that lift
// AI takeoff accuracy without touching the model itself. The trade classifier
// model id is verified by reading the route source so the test doesn't need
// to spin up a real OpenAI client; the helpers (scale grounding, raster
// scale, scale-mismatch parsing) are exported and unit-tested directly.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MAX_RASTER_PIXELS,
  buildScaleGroundingClause,
  computeRasterScale,
} from "../aiTakeoffHelpers";
import {
  buildScaleMismatchWarning,
  findMatchingPreset,
  parseDrawingScaleString,
} from "@shared/scalePresets";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = path.resolve(__dirname, "../aiTakeoffFeatureRoutes.ts");

describe("Task #2322 — trade classifier model parity", () => {
  it("the trade classifier call uses AI_MODEL_GPT5, not AI_MODEL_GPT4O", () => {
    const source = readFileSync(ROUTES_PATH, "utf8");

    // Pull out the body of `classifyTradeType` so we don't accidentally match
    // a `model:` line from a different OpenAI call further down the file.
    const fnStart = source.indexOf("async function classifyTradeType");
    expect(fnStart).toBeGreaterThan(-1);
    const fnSlice = source.slice(fnStart, fnStart + 4000);

    expect(fnSlice).toMatch(/model:\s*AI_MODEL_GPT5/);
    expect(fnSlice).not.toMatch(/model:\s*AI_MODEL_GPT4O/);
  });

  it("the file no longer references AI_MODEL_GPT4O anywhere", () => {
    const source = readFileSync(ROUTES_PATH, "utf8");
    expect(source).not.toMatch(/AI_MODEL_GPT4O/);
  });
});

describe("Task #2322 — scale grounding clause", () => {
  it("includes scalePxPerFoot and scaleLabel when the sheet is calibrated", () => {
    const clause = buildScaleGroundingClause({
      scalePxPerFoot: 24,
      scaleLabel: '1/4" = 1\'-0"',
      units: "ft",
    });
    expect(clause).toContain("verified by the estimator");
    expect(clause).toContain('1/4" = 1\'-0"');
    expect(clause).toContain("24.00");
    expect(clause).toContain("px/ft");
    expect(clause).toContain("do not infer scale from the title block");
  });

  it("falls back to a px-per-ft string when scaleLabel is null", () => {
    const clause = buildScaleGroundingClause({
      scalePxPerFoot: 9.6,
      scaleLabel: null,
      units: "ft",
    });
    expect(clause).toContain("9.60");
    expect(clause).toContain("verified by the estimator");
  });

  it("emits the 'not yet calibrated' branch when no scale is set", () => {
    const noScale = buildScaleGroundingClause({
      scalePxPerFoot: null,
      scaleLabel: null,
      units: "ft",
    });
    expect(noScale).toContain("not yet calibrated");
    expect(noScale).toContain("LF");
    expect(noScale).toContain("SF");
    expect(noScale).toContain("CY");

    const undef = buildScaleGroundingClause(undefined);
    expect(undef).toContain("not yet calibrated");

    const zero = buildScaleGroundingClause({ scalePxPerFoot: 0 });
    expect(zero).toContain("not yet calibrated");
  });
});

describe("Task #2322 — adaptive PDF rasterization", () => {
  // PDF.js viewport widths/heights at scale=1 are in CSS pixels at
  // 1 px = 1/72 inch, so an inch dimension I maps to I*72 viewport units.
  const inchesToViewport = (inches: number) => inches * 72;

  it("uses scale 2.0 for ARCH D / 24x36 sheets and smaller", () => {
    // 24x36 at scale 2.0: 24*36*72^2*4 = 17.9 MP, well under the 30 MP cap.
    expect(computeRasterScale(inchesToViewport(24), inchesToViewport(36))).toBe(2.0);
    expect(computeRasterScale(inchesToViewport(36), inchesToViewport(24))).toBe(2.0); // landscape
    expect(computeRasterScale(inchesToViewport(11), inchesToViewport(17))).toBe(2.0); // tabloid
    expect(computeRasterScale(inchesToViewport(8.5), inchesToViewport(11))).toBe(2.0); // letter
  });

  it("uses scale 3.0 for sheets larger than 24x36 when under the pixel-area cap", () => {
    // Real civil sheets in the 24x36 → 36x48 range are large enough that
    // the desired 3.0x raster trips the 30 MP cap, which is the documented
    // behaviour — so the un-capped 3.0 path is exercised with a synthetic
    // 17×37 sheet (longSide > 36, shortSide ≤ 36) whose area at 3.0 stays
    // under the cap.
    expect(computeRasterScale(inchesToViewport(17), inchesToViewport(37))).toBe(3.0);
  });

  it("uses scale 4.0 for sheets larger than 36x48 when under the pixel-area cap", () => {
    // Same shape of synthetic case for the > 36x48 branch: longSide > 48,
    // shortSide kept narrow so area at 4.0 stays under the cap.
    expect(computeRasterScale(inchesToViewport(7), inchesToViewport(50))).toBe(4.0);
  });

  it("caps the rendered pixel area at MAX_RASTER_PIXELS (~30 MP)", () => {
    // 30x42 (ARCH E1, real civil sheet): would be ~58 MP at uncapped 3.0.
    // The cap must clamp the scale so the resulting area is ~30 MP.
    {
      const w = inchesToViewport(30);
      const h = inchesToViewport(42);
      const scale = computeRasterScale(w, h);
      const area = w * h * scale * scale;
      expect(area).toBeLessThanOrEqual(MAX_RASTER_PIXELS + 1);
      // Cap should land us between 2.0 and the desired 3.0.
      expect(scale).toBeGreaterThan(2.0);
      expect(scale).toBeLessThan(3.0);
    }

    // 60x96 huge sheet: would be ~380 MP at 4.0. Cap holds it to ~30 MP.
    {
      const w = inchesToViewport(60);
      const h = inchesToViewport(96);
      const scale = computeRasterScale(w, h);
      const area = w * h * scale * scale;
      expect(area).toBeLessThanOrEqual(MAX_RASTER_PIXELS + 1);
      expect(scale).toBeGreaterThanOrEqual(1.0);
      expect(scale).toBeLessThan(4.0);
    }
  });

  it("falls back to scale 2.0 on degenerate inputs", () => {
    expect(computeRasterScale(0, 0)).toBe(2.0);
    expect(computeRasterScale(NaN, 100)).toBe(2.0);
    expect(computeRasterScale(-1, 100)).toBe(2.0);
  });
});

describe("Task #2322 — scale-mismatch warning", () => {
  it("snaps a parsed pxPerFoot to the nearest preset", () => {
    expect(findMatchingPreset(24)).toMatchObject({ label: '1/4" = 1\'-0"', pxPerFoot: 24 });
    expect(findMatchingPreset(24.3)).toMatchObject({ label: '1/4" = 1\'-0"' });
    // Way off any preset:
    expect(findMatchingPreset(17)).toBeNull();
  });

  it("parses common drawing-scale strings into pxPerFoot", () => {
    expect(parseDrawingScaleString('1/4" = 1\'-0"')).toMatchObject({ pxPerFoot: 24 });
    expect(parseDrawingScaleString("1/4 inch = 1 foot")).toMatchObject({ pxPerFoot: 24 });
    expect(parseDrawingScaleString('1" = 20\'')).toMatchObject({ pxPerFoot: 4.8 });
    expect(parseDrawingScaleString("1\" = 20 ft")).toMatchObject({ pxPerFoot: 4.8 });
    expect(parseDrawingScaleString("1:50")).toMatchObject({ source: "ratio" });
    expect(parseDrawingScaleString(null)).toBeNull();
    expect(parseDrawingScaleString("not a scale")).toBeNull();
  });

  it("emits a warning when detected scale departs >5% from calibrated", () => {
    // Calibrated 1/4"=1' (24 px/ft), model says 1/8"=1' (12 px/ft) — 50% off.
    const warn = buildScaleMismatchWarning('1/8" = 1\'-0"', 24, '1/4" = 1\'-0"');
    expect(warn).not.toBeNull();
    expect(warn).toContain('1/8" = 1\'-0"');
    expect(warn).toContain('1/4" = 1\'-0"');
    expect(warn).toContain("Re-verify before accepting items");
  });

  it("does not warn when detected scale agrees within 5%", () => {
    // Same preset:
    expect(buildScaleMismatchWarning('1/4" = 1\'-0"', 24, '1/4" = 1\'-0"')).toBeNull();
    // String with the word forms:
    expect(buildScaleMismatchWarning("1/4 inch = 1 foot", 24, '1/4" = 1\'-0"')).toBeNull();
    // Within 5% (24 -> 24.5 is ~2%):
    expect(buildScaleMismatchWarning('1/4" = 1\'-0"', 24.5, '1/4" = 1\'-0"')).toBeNull();
  });

  it("does not warn when there is no calibrated scale or the detected string is unparseable", () => {
    expect(buildScaleMismatchWarning('1/4" = 1\'-0"', null, null)).toBeNull();
    expect(buildScaleMismatchWarning('1/4" = 1\'-0"', 0, null)).toBeNull();
    expect(buildScaleMismatchWarning("garbage", 24, '1/4" = 1\'-0"')).toBeNull();
    expect(buildScaleMismatchWarning(null, 24, '1/4" = 1\'-0"')).toBeNull();
  });
});
