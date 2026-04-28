// @vitest-environment node
/**
 * Task #2332 — Pin the scoring contract for the sheet-level capture-
 * scale confidence indicator. The chip in the takeoff sheet header
 * has to keep telling the truth across three independent failure
 * modes (uncalibrated sheets, AI-only calibration with no human
 * verification, mid-takeoff drift between captured scale labels) so
 * an estimator can triage which sheets need a calibration pass
 * before they take off any quantities. These cases are the contract.
 */
import { describe, it, expect } from "vitest";
import { computeSheetCalibrationConfidence } from "../sheetCalibrationConfidence";

describe("computeSheetCalibrationConfidence", () => {
  it("returns UNVERIFIED for a sheet with no scale at all", () => {
    const result = computeSheetCalibrationConfidence(
      { scalePxPerFoot: null, scaleSource: "UNVERIFIED" },
      [],
    );
    expect(result.confidence).toBe("UNVERIFIED");
    expect(result.label).toBe("Unverified");
    expect(result.dotClass).toContain("red");
    expect(result.tooltip.toLowerCase()).toContain("isn't calibrated");
  });

  it("returns UNVERIFIED when the input sheet is null", () => {
    const result = computeSheetCalibrationConfidence(null, []);
    expect(result.confidence).toBe("UNVERIFIED");
    expect(result.measurementCount).toBe(0);
    expect(result.hasDrift).toBe(false);
  });

  it("rates a USER_TWO_POINT calibration as HIGH when no drift", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "HIGH",
      },
      [
        { scaleAtCaptureLabel: '1/8" = 1\'' },
        { scaleAtCaptureLabel: '1/8" = 1\'' },
      ],
    );
    expect(result.confidence).toBe("HIGH");
    expect(result.measurementCount).toBe(2);
    expect(result.hasDrift).toBe(false);
    expect(result.dotClass).toContain("green");
    expect(result.tooltip).toContain("Calibrated by you");
  });

  it("rates an AI_DETECTED calibration as MEDIUM by default", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "AI_DETECTED",
        scaleConfidence: "HIGH",
      },
      [],
    );
    expect(result.confidence).toBe("MEDIUM");
    expect(result.dotClass).toContain("amber");
    expect(result.tooltip).toContain("Auto-detected");
  });

  it("caps at the server-vouched scaleConfidence band", () => {
    // USER_TWO_POINT would normally rate HIGH, but a LOW server
    // confidence should pull the chip down to LOW.
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "LOW",
      },
      [],
    );
    expect(result.confidence).toBe("LOW");
  });

  it("demotes one notch when captured labels disagree with the sheet's current label", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 48,
        scaleLabel: '1/4" = 1\'',
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "HIGH",
      },
      [
        { scaleAtCaptureLabel: '1/8" = 1\'' },
        { scaleAtCaptureLabel: '1/8" = 1\'' },
      ],
    );
    expect(result.confidence).toBe("MEDIUM");
    expect(result.hasDrift).toBe(true);
    expect(result.driftLabels).toEqual(['1/8" = 1\'']);
    expect(result.tooltip).toContain('"1/8" = 1\'"');
  });

  it("demotes when measurements were captured at multiple distinct labels", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "HIGH",
      },
      [
        { scaleAtCaptureLabel: '1/8" = 1\'' },
        { scaleAtCaptureLabel: '1/4" = 1\'' },
      ],
    );
    expect(result.confidence).toBe("MEDIUM");
    expect(result.hasDrift).toBe(true);
    expect(result.driftLabels.length).toBe(2);
  });

  it("ignores null/empty captured labels (legacy rows pre-snapshot)", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "USER_TWO_POINT",
        scaleConfidence: "HIGH",
      },
      [
        { scaleAtCaptureLabel: null },
        { scaleAtCaptureLabel: "" },
        { scaleAtCaptureLabel: '1/8" = 1\'' },
      ],
    );
    expect(result.confidence).toBe("HIGH");
    expect(result.hasDrift).toBe(false);
  });

  it("rates INHERITED_FROM_PARENT as LOW (carried but not re-verified)", () => {
    const result = computeSheetCalibrationConfidence(
      {
        scalePxPerFoot: 24,
        scaleLabel: '1/8" = 1\'',
        scaleSource: "INHERITED_FROM_PARENT",
        scaleConfidence: "UNVERIFIED",
      },
      [],
    );
    // Floored to UNVERIFIED by the LOW->UNVERIFIED scaleConfidence cap.
    expect(result.confidence).toBe("UNVERIFIED");
    expect(result.tooltip).toContain("Inherited from previous revision");
  });

  it("includes a measurement-count phrase in the tooltip", () => {
    const noneResult = computeSheetCalibrationConfidence(
      { scalePxPerFoot: 24, scaleSource: "USER_TWO_POINT", scaleConfidence: "HIGH" },
      [],
    );
    expect(noneResult.tooltip).toContain("No measurements");

    const oneResult = computeSheetCalibrationConfidence(
      { scalePxPerFoot: 24, scaleSource: "USER_TWO_POINT", scaleConfidence: "HIGH" },
      [{ scaleAtCaptureLabel: null }],
    );
    expect(oneResult.tooltip).toContain("1 measurement");

    const manyResult = computeSheetCalibrationConfidence(
      { scalePxPerFoot: 24, scaleSource: "USER_TWO_POINT", scaleConfidence: "HIGH" },
      Array.from({ length: 5 }, () => ({ scaleAtCaptureLabel: null })),
    );
    expect(manyResult.tooltip).toContain("5 measurements");
  });

  it("always tells the user the chip is clickable to recalibrate", () => {
    const result = computeSheetCalibrationConfidence(
      { scalePxPerFoot: null, scaleSource: "UNVERIFIED" },
      [],
    );
    expect(result.tooltip.toLowerCase()).toContain("calibration");
  });
});
