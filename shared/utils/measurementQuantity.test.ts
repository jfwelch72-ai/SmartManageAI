import { describe, it, expect } from "vitest";
import { getMeasurementQty, getMeasurementUnit } from "./measurementQuantity";

describe("getMeasurementQty", () => {
  it("returns m.count for COUNT measurements", () => {
    expect(getMeasurementQty({ type: "COUNT", count: 12 })).toBe(12);
  });

  it("returns 0 for COUNT measurements with no count set (no silent fallback to 1)", () => {
    expect(getMeasurementQty({ type: "COUNT", count: null })).toBe(0);
    expect(getMeasurementQty({ type: "COUNT" })).toBe(0);
  });

  it("returns computedAreaFt2 for AREA / PITCHED_AREA", () => {
    expect(getMeasurementQty({ type: "AREA", computedAreaFt2: 250.5 })).toBe(250.5);
    expect(getMeasurementQty({ type: "PITCHED_AREA", computedAreaFt2: 100 })).toBe(100);
  });

  it("prefers computedSurfaceAreaFt2 for SURFACE_AREA, falling back to computedAreaFt2", () => {
    expect(
      getMeasurementQty({ type: "SURFACE_AREA", computedSurfaceAreaFt2: 480, computedAreaFt2: 300 }),
    ).toBe(480);
    expect(
      getMeasurementQty({ type: "SURFACE_AREA", computedSurfaceAreaFt2: null, computedAreaFt2: 300 }),
    ).toBe(300);
  });

  it("returns computedVolumeCy for VOLUME", () => {
    expect(getMeasurementQty({ type: "VOLUME", computedVolumeCy: 8.75 })).toBe(8.75);
  });

  it("returns 0 for NOTE measurements", () => {
    expect(getMeasurementQty({ type: "NOTE", computedLengthFt: 999, count: 999 })).toBe(0);
  });

  it("returns computedLengthFt for LINEAR-style and unknown types (default branch)", () => {
    expect(getMeasurementQty({ type: "LINEAR", computedLengthFt: 42.1 })).toBe(42.1);
    expect(getMeasurementQty({ type: "LINEAR_WITH_DROP", computedLengthFt: 13 })).toBe(13);
    expect(getMeasurementQty({ type: "PITCHED_LINEAR", computedLengthFt: 7 })).toBe(7);
    expect(getMeasurementQty({ type: "SEGMENT", computedLengthFt: 3.3 })).toBe(3.3);
  });

  it("coerces numeric strings (drizzle decimal columns are returned as strings)", () => {
    expect(getMeasurementQty({ type: "AREA", computedAreaFt2: "120.50" })).toBe(120.5);
    expect(getMeasurementQty({ type: "VOLUME", computedVolumeCy: "1.25" })).toBe(1.25);
  });

  it("returns 0 instead of NaN/Infinity for non-numeric values", () => {
    expect(getMeasurementQty({ type: "AREA", computedAreaFt2: "abc" as unknown as string })).toBe(0);
    expect(getMeasurementQty({ type: "LINEAR", computedLengthFt: undefined })).toBe(0);
  });
});

describe("getMeasurementUnit", () => {
  it("returns lower-case units by default (matching the on-screen Summary Report dialog)", () => {
    expect(getMeasurementUnit({ type: "COUNT" })).toBe("ea");
    expect(getMeasurementUnit({ type: "AREA" })).toBe("sf");
    expect(getMeasurementUnit({ type: "PITCHED_AREA" })).toBe("sf");
    expect(getMeasurementUnit({ type: "SURFACE_AREA" })).toBe("sf");
    expect(getMeasurementUnit({ type: "VOLUME" })).toBe("cy");
    expect(getMeasurementUnit({ type: "NOTE" })).toBe("");
    expect(getMeasurementUnit({ type: "LINEAR" })).toBe("lf");
    expect(getMeasurementUnit({ type: "LINEAR_WITH_DROP" })).toBe("lf");
    expect(getMeasurementUnit({ type: "PITCHED_LINEAR" })).toBe("lf");
    expect(getMeasurementUnit({ type: "SEGMENT" })).toBe("lf");
  });

  it("returns upper-case units when uppercase=true (CSV/Excel export style)", () => {
    expect(getMeasurementUnit({ type: "COUNT" }, { uppercase: true })).toBe("EA");
    expect(getMeasurementUnit({ type: "AREA" }, { uppercase: true })).toBe("SF");
    expect(getMeasurementUnit({ type: "VOLUME" }, { uppercase: true })).toBe("CY");
    expect(getMeasurementUnit({ type: "LINEAR" }, { uppercase: true })).toBe("LF");
    expect(getMeasurementUnit({ type: "NOTE" }, { uppercase: true })).toBe("");
  });

  it("defaults unknown types to the linear/'lf' branch", () => {
    expect(getMeasurementUnit({ type: "UNKNOWN_FUTURE_TYPE" })).toBe("lf");
    expect(getMeasurementUnit({ type: null })).toBe("lf");
  });
});
