import { describe, expect, it } from "vitest";

import {
  formatPolarAngleDeg,
  formatPolarDistanceFt,
  formatPolarGuideLabel,
} from "../takeoffPolarLabel";

describe("formatPolarAngleDeg", () => {
  it("inverts screen-Y so dragging up-right reads as 45°, not -45°", () => {
    // atan2 with dy = -1, dx = 1 in Y-down screen coords gives -45°,
    // but the user perceives the cursor as being north-east of the
    // anchor — the label has to match that perception.
    expect(formatPolarAngleDeg(-45)).toBe("45°");
  });

  it("normalizes negative bearings into [0, 360)", () => {
    expect(formatPolarAngleDeg(45)).toBe("315°");
    expect(formatPolarAngleDeg(180)).toBe("180°");
    expect(formatPolarAngleDeg(-90)).toBe("90°");
  });

  it("collapses 360° back to 0° so a full revolution doesn't read as 360°", () => {
    expect(formatPolarAngleDeg(-360)).toBe("0°");
    expect(formatPolarAngleDeg(720)).toBe("0°");
  });

  it("strips trailing .0 on common preset bearings", () => {
    expect(formatPolarAngleDeg(0)).toBe("0°");
    expect(formatPolarAngleDeg(-90)).toBe("90°");
    expect(formatPolarAngleDeg(-30)).toBe("30°");
  });

  it("keeps one decimal place for fractional bearings", () => {
    expect(formatPolarAngleDeg(-22.5)).toBe("22.5°");
  });
});

describe("formatPolarDistanceFt", () => {
  it("emits the CAD ft-in shorthand for mixed values", () => {
    expect(formatPolarDistanceFt(12.5)).toBe(`12'-6"`);
  });

  it("collapses whole feet to a bare ft mark", () => {
    expect(formatPolarDistanceFt(8)).toBe(`8'`);
  });

  it("collapses sub-foot values to bare inches", () => {
    expect(formatPolarDistanceFt(0.5)).toBe(`6"`);
    expect(formatPolarDistanceFt(0.25)).toBe(`3"`);
  });

  it("returns 0\" at the anchor (so the label collapses to the bearing)", () => {
    expect(formatPolarDistanceFt(0)).toBe(`0"`);
  });

  it("carries rounded inches into the foot column instead of emitting 11'-12\"", () => {
    // 11.999... ft ≈ 12 ft after rounding; without the carry this
    // would emit `11'-12"` which isn't a valid CAD reading.
    expect(formatPolarDistanceFt(11.9999)).toBe(`12'`);
    // 4'-12" → 5'-0", collapsed to bare ft.
    expect(formatPolarDistanceFt(4 + 11.6 / 12)).toBe(`5'`);
  });

  it("handles negative lengths defensively (sign is preserved)", () => {
    expect(formatPolarDistanceFt(-3.5)).toBe(`-3'-6"`);
  });

  it("returns an em-dash placeholder for non-finite input", () => {
    expect(formatPolarDistanceFt(Number.NaN)).toBe("—");
    expect(formatPolarDistanceFt(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatPolarGuideLabel", () => {
  it("joins the angle and distance into a single cursor label", () => {
    expect(formatPolarGuideLabel(-45, 12.5)).toBe(`45°  12'-6"`);
  });

  it("falls back to bare angle when no scale is calibrated", () => {
    // A sheet without scalePxPerFoot can't render a meaningful
    // distance — the bearing alone is still useful.
    expect(formatPolarGuideLabel(-90, null)).toBe("90°");
  });
});
