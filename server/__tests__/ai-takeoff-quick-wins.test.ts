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
  evaluateScaleMismatch,
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
    expect(computeRasterScale(inchesToViewport(24), inchesToViewport(36))).toEqual({ scale: 2.0, capped: false });
    expect(computeRasterScale(inchesToViewport(36), inchesToViewport(24))).toEqual({ scale: 2.0, capped: false }); // landscape
    expect(computeRasterScale(inchesToViewport(11), inchesToViewport(17))).toEqual({ scale: 2.0, capped: false }); // tabloid
    expect(computeRasterScale(inchesToViewport(8.5), inchesToViewport(11))).toEqual({ scale: 2.0, capped: false }); // letter
  });

  it("uses scale 3.0 for sheets larger than 24x36 when under the pixel-area cap", () => {
    // Real civil sheets in the 24x36 → 36x48 range are large enough that
    // the desired 3.0x raster trips the 30 MP cap, which is the documented
    // behaviour — so the un-capped 3.0 path is exercised with a synthetic
    // 17×37 sheet (longSide > 36, shortSide ≤ 36) whose area at 3.0 stays
    // under the cap.
    expect(computeRasterScale(inchesToViewport(17), inchesToViewport(37))).toEqual({ scale: 3.0, capped: false });
  });

  it("uses scale 4.0 for sheets larger than 36x48 when under the pixel-area cap", () => {
    // Same shape of synthetic case for the > 36x48 branch: longSide > 48,
    // shortSide kept narrow so area at 4.0 stays under the cap.
    expect(computeRasterScale(inchesToViewport(7), inchesToViewport(50))).toEqual({ scale: 4.0, capped: false });
  });

  it("caps the rendered pixel area at MAX_RASTER_PIXELS (~30 MP)", () => {
    // 30x42 (ARCH E1, real civil sheet): would be ~58 MP at uncapped 3.0.
    // The cap must clamp the scale so the resulting area is ~30 MP.
    {
      const w = inchesToViewport(30);
      const h = inchesToViewport(42);
      const result = computeRasterScale(w, h);
      const area = w * h * result.scale * result.scale;
      expect(area).toBeLessThanOrEqual(MAX_RASTER_PIXELS + 1);
      // Cap should land us between 2.0 and the desired 3.0.
      expect(result.scale).toBeGreaterThan(2.0);
      expect(result.scale).toBeLessThan(3.0);
      // Task #2336 — `capped: true` is the signal the UI uses to show the
      // "rendered at the maximum supported resolution" hint.
      expect(result.capped).toBe(true);
    }

    // 60x96 huge sheet: would be ~380 MP at 4.0. Cap holds it to ~30 MP.
    {
      const w = inchesToViewport(60);
      const h = inchesToViewport(96);
      const result = computeRasterScale(w, h);
      const area = w * h * result.scale * result.scale;
      expect(area).toBeLessThanOrEqual(MAX_RASTER_PIXELS + 1);
      expect(result.scale).toBeGreaterThanOrEqual(1.0);
      expect(result.scale).toBeLessThan(4.0);
      expect(result.capped).toBe(true);
    }
  });

  it("falls back to scale 2.0 on degenerate inputs", () => {
    expect(computeRasterScale(0, 0)).toEqual({ scale: 2.0, capped: false });
    expect(computeRasterScale(NaN, 100)).toEqual({ scale: 2.0, capped: false });
    expect(computeRasterScale(-1, 100)).toEqual({ scale: 2.0, capped: false });
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

describe("Task #2337 — broader scale-string variants", () => {
  it("parses metric ratios with bare unit suffixes", () => {
    // 1:50 → (96*12)/50 = 23.04 px/ft
    expect(parseDrawingScaleString("1:50 mm")).toMatchObject({
      pxPerFoot: (96 * 12) / 50,
      label: "1:50",
      source: "ratio",
    });
    expect(parseDrawingScaleString("1:100 cm")).toMatchObject({
      pxPerFoot: (96 * 12) / 100,
      label: "1:100",
      source: "ratio",
    });
    expect(parseDrawingScaleString("SCALE: 1:200 metric")).toMatchObject({
      pxPerFoot: (96 * 12) / 200,
      label: "1:200",
      source: "ratio",
    });
  });

  it("parses metric ratios with parenthesised unit suffixes", () => {
    expect(parseDrawingScaleString("1:100 (mm)")).toMatchObject({
      pxPerFoot: (96 * 12) / 100,
      label: "1:100",
      source: "ratio",
    });
    expect(parseDrawingScaleString("1:50(MM)")).toMatchObject({
      pxPerFoot: (96 * 12) / 50,
      label: "1:50",
      source: "ratio",
    });
    expect(parseDrawingScaleString("Scale = 1:25 (metric)")).toMatchObject({
      pxPerFoot: (96 * 12) / 25,
      label: "1:25",
      source: "ratio",
    });
  });

  it("parses inverted civil scales (N' = 1\")", () => {
    // 20' = 1" → 96/20 = 4.8 px/ft, identical to 1" = 20'
    expect(parseDrawingScaleString("20' = 1\"")).toMatchObject({
      pxPerFoot: 96 / 20,
      label: "1\" = 20'",
      source: "civil",
    });
    expect(parseDrawingScaleString("SCALE: 50' = 1\"")).toMatchObject({
      pxPerFoot: 96 / 50,
      label: "1\" = 50'",
      source: "civil",
    });
    // Inverted with non-1 inches: 40' = 2" → (2*96)/40 = 4.8 px/ft
    expect(parseDrawingScaleString("40' = 2\"")).toMatchObject({
      pxPerFoot: (2 * 96) / 40,
      label: "2\" = 40'",
      source: "civil",
    });
    // Architectural-range inverted: 1' = 1" → arch range (feet < 5)
    expect(parseDrawingScaleString("1' = 1\"")).toMatchObject({
      pxPerFoot: 96,
      source: "architectural",
    });
  });

  it("recognises NTS / N.T.S. / NOT TO SCALE callouts as not-to-scale", () => {
    for (const s of ["NTS", "nts", "N.T.S.", "n.t.s", "Not To Scale", "NOT TO SCALE"]) {
      const parsed = parseDrawingScaleString(s);
      expect(parsed).not.toBeNull();
      expect(parsed!.source).toBe("not-to-scale");
      expect(parsed!.pxPerFoot).toBeNull();
      expect(parsed!.label).toBe("NTS");
    }
    expect(parseDrawingScaleString("SCALE: NTS")).toMatchObject({
      source: "not-to-scale",
      label: "NTS",
      pxPerFoot: null,
    });
  });

  it("recognises AS SHOWN / SCALE AS SHOWN callouts as not-to-scale", () => {
    for (const s of ["AS SHOWN", "as shown", "Scale: As Shown", "SCALE AS SHOWN"]) {
      const parsed = parseDrawingScaleString(s);
      expect(parsed).not.toBeNull();
      expect(parsed!.source).toBe("not-to-scale");
      expect(parsed!.pxPerFoot).toBeNull();
      expect(parsed!.label).toBe("AS SHOWN");
    }
  });

  it("does not warn when the detected scale is explicitly not-to-scale", () => {
    // Even with a calibrated sheet, NTS / AS SHOWN should suppress the
    // mismatch warning — there's no numeric paper-space scale to compare.
    expect(buildScaleMismatchWarning("NTS", 24, '1/4" = 1\'-0"')).toBeNull();
    expect(buildScaleMismatchWarning("N.T.S.", 24, '1/4" = 1\'-0"')).toBeNull();
    expect(buildScaleMismatchWarning("NOT TO SCALE", 24, '1/4" = 1\'-0"')).toBeNull();
    expect(buildScaleMismatchWarning("AS SHOWN", 24, '1/4" = 1\'-0"')).toBeNull();
    expect(buildScaleMismatchWarning("SCALE: AS SHOWN", 4.8, '1" = 20\'')).toBeNull();
  });

  it("does warn when an inverted civil scale disagrees with the calibration", () => {
    // Sheet calibrated to 1/4" = 1' (24 px/ft); model returns "20' = 1\""
    // (4.8 px/ft) — that's a real mismatch and should warn.
    const warn = buildScaleMismatchWarning("20' = 1\"", 24, '1/4" = 1\'-0"');
    expect(warn).not.toBeNull();
    expect(warn).toContain("1\" = 20'");
    expect(warn).toContain('1/4" = 1\'-0"');
  });

  it("does not warn when an inverted civil scale agrees with the calibration", () => {
    // 20' = 1"  ≡  1" = 20'  → 4.8 px/ft. Calibrated to 4.8 → silent.
    expect(buildScaleMismatchWarning("20' = 1\"", 4.8, '1" = 20\'')).toBeNull();
  });

  it("does not warn when a metric ratio with a unit suffix matches the calibration", () => {
    // 1:48 ≈ 24 px/ft (96*12/48 = 24); within 5% of the 1/4" = 1' preset.
    expect(buildScaleMismatchWarning("1:48 (mm)", 24, '1/4" = 1\'-0"')).toBeNull();
    // Big mismatch should still warn:
    const warn = buildScaleMismatchWarning("1:100 (mm)", 24, '1/4" = 1\'-0"');
    expect(warn).not.toBeNull();
  });
});

describe("Task #2335 — persisted scale-mismatch evaluation", () => {
  // The dashboard rollup needs structured numbers (delta percent,
  // detected vs calibrated labels), not just a banner string. The new
  // `evaluateScaleMismatch` helper drives both the persisted columns
  // and the legacy banner so the two stay in lockstep.

  it("returns the structured evaluation with mismatch=true when delta exceeds tolerance", () => {
    const result = evaluateScaleMismatch('1/8" = 1\'-0"', 24, '1/4" = 1\'-0"');
    expect(result).not.toBeNull();
    expect(result!.mismatch).toBe(true);
    expect(result!.detectedLabel).toBe('1/8" = 1\'-0"');
    expect(result!.detectedPxPerFoot).toBe(12);
    expect(result!.calibratedLabel).toBe('1/4" = 1\'-0"');
    expect(result!.calibratedPxPerFoot).toBe(24);
    // 1/8" = 12 px/ft vs calibrated 24 px/ft -> 50% off.
    expect(result!.deltaPercent).toBeCloseTo(0.5, 5);
    expect(result!.message).toMatch(/Re-verify/);
  });

  it("returns mismatch=false (with delta) when within tolerance so dashboards can still chart drift", () => {
    // 24.5 vs calibrated 24 -> ~2% off.
    const result = evaluateScaleMismatch('1/4" = 1\'-0"', 24.5, '1/4" = 1\'-0"');
    expect(result).not.toBeNull();
    expect(result!.mismatch).toBe(false);
    expect(result!.message).toBeNull();
    expect(result!.deltaPercent).toBeLessThan(0.05);
  });

  it("returns null (skipped, not a false-positive) when calibration or detected string is missing", () => {
    expect(evaluateScaleMismatch(null, 24, '1/4" = 1\'-0"')).toBeNull();
    expect(evaluateScaleMismatch('1/4" = 1\'-0"', null, null)).toBeNull();
    expect(evaluateScaleMismatch('1/4" = 1\'-0"', 0, null)).toBeNull();
    expect(evaluateScaleMismatch("garbage", 24, '1/4" = 1\'-0"')).toBeNull();
  });

  it("falls back to a px-per-ft calibrated label when no preset / explicit label is supplied", () => {
    // 9.6 px/ft maps to a civil preset, so the snapped label wins.
    const civil = evaluateScaleMismatch('1/4" = 1\'-0"', 9.6, null);
    expect(civil!.calibratedLabel).toContain('1" = 10');

    // 17.4 px/ft is between presets — the helper should fall back to a
    // formatted px/ft string so the dashboard never shows a blank scale.
    const offPreset = evaluateScaleMismatch('1/4" = 1\'-0"', 17.4, null);
    expect(offPreset!.calibratedLabel).toContain("17.40");
    expect(offPreset!.calibratedLabel).toContain("px/ft");
  });

  it("the legacy banner helper stays in lockstep with evaluateScaleMismatch", () => {
    const a = buildScaleMismatchWarning('1/8" = 1\'-0"', 24, '1/4" = 1\'-0"');
    const b = evaluateScaleMismatch('1/8" = 1\'-0"', 24, '1/4" = 1\'-0"')!.message;
    expect(a).toBe(b);
  });
});

describe("Task #2335 — analysis pipeline persists scale-mismatch columns", () => {
  // Pinning the wiring at the source level so the ROUTE keeps writing
  // the new columns even if a future refactor moves the helper around.
  // We only check structural facts (the column names appear in the
  // route's update set, the helper is imported), not runtime — that's
  // covered by the unit-tests above and the e2e suite.
  it("calls evaluateScaleMismatch and writes the four mismatch columns on the COMPLETE update", () => {
    const source = readFileSync(ROUTES_PATH, "utf8");
    expect(source).toContain('import { evaluateScaleMismatch } from "@shared/scalePresets"');
    expect(source).toContain("evaluateScaleMismatch(");

    // Find the `status: "COMPLETE"` set() block.
    const idx = source.indexOf('status: "COMPLETE"');
    expect(idx).toBeGreaterThan(-1);
    const slice = source.slice(idx, idx + 2000);
    expect(slice).toContain("scaleMismatchDetected");
    expect(slice).toContain("detectedScaleLabel");
    expect(slice).toContain("calibratedScaleLabel");
    expect(slice).toContain("scaleDeltaPercent");
  });

  it("exposes the GET /ai-features/takeoff/scale-mismatches dashboard endpoint", () => {
    const source = readFileSync(ROUTES_PATH, "utf8");
    expect(source).toContain('"/ai-features/takeoff/scale-mismatches"');
    // Endpoint must report the rollup figures the dashboard tile / rate
    // chart spec calls for.
    expect(source).toContain("totalAnalyses");
    expect(source).toContain("mismatchCount");
    expect(source).toContain("mismatchRate");
  });
});
