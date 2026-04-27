import { describe, it, expect } from "vitest";
import {
  ORTHO_PRESET_ANGLES,
  applyOrthoAngleLock,
  applyParsedTypedInput,
  applyTypedLength,
  applyTypedLengthAndAngle,
  applyTypedOffset,
  parseTypedInput,
  parseTypedLength,
  snapAngleToStep,
} from "./geometry";

describe("Task #2065 — parseTypedLength", () => {
  it("treats a bare number as feet", () => {
    expect(parseTypedLength("12")).toMatchObject({ feet: 12, ok: true });
    expect(parseTypedLength(" 12.5 ")).toMatchObject({ feet: 12.5, ok: true });
  });

  it("accepts ft / ' suffix", () => {
    expect(parseTypedLength("12ft").feet).toBe(12);
    expect(parseTypedLength("12'").feet).toBe(12);
  });

  it("accepts feet-and-inches notation", () => {
    expect(parseTypedLength("12'6\"").feet).toBeCloseTo(12.5, 5);
    expect(parseTypedLength("12' 6").feet).toBeCloseTo(12.5, 5);
    expect(parseTypedLength("0'9\"").feet).toBeCloseTo(0.75, 5);
  });

  it("converts inches", () => {
    expect(parseTypedLength("144in").feet).toBe(12);
    expect(parseTypedLength('144"').feet).toBe(12);
  });

  it("converts metric units to feet", () => {
    expect(parseTypedLength("0.3048m").feet).toBeCloseTo(1, 6);
    expect(parseTypedLength("100cm").feet).toBeCloseTo(3.28084, 4);
    expect(parseTypedLength("1000mm").feet).toBeCloseTo(3.28084, 4);
  });

  it("rejects nonsense, zero, negative, and out-of-range inches", () => {
    expect(parseTypedLength("").ok).toBe(false);
    expect(parseTypedLength("abc").ok).toBe(false);
    expect(parseTypedLength("0").ok).toBe(false);
    expect(parseTypedLength("-5").ok).toBe(false);
    expect(parseTypedLength("12'15\"").ok).toBe(false);
  });
});

describe("Task #2065 — parseTypedInput grammar", () => {
  it("parses a single length", () => {
    const r = parseTypedInput("12");
    expect(r).toMatchObject({ ok: true, lengths: [12], angleDeg: null });
  });

  it("parses length<angle", () => {
    const r = parseTypedInput("12<30");
    expect(r).toMatchObject({ ok: true, lengths: [12], angleDeg: 30 });
  });

  it("parses Δx,Δy form", () => {
    const r = parseTypedInput("12,6");
    expect(r).toMatchObject({ ok: true, lengths: [12, 6], angleDeg: null });
  });

  it("tolerates whitespace and degree sign", () => {
    const r = parseTypedInput("12'6\" < 45°");
    expect(r.ok).toBe(true);
    expect(r.lengths[0]).toBeCloseTo(12.5, 5);
    expect(r.angleDeg).toBe(45);
  });

  it("rejects bare angle, empty input, and >2 lengths", () => {
    expect(parseTypedInput("").ok).toBe(false);
    expect(parseTypedInput("<45").ok).toBe(false);
    expect(parseTypedInput("12,6,3").ok).toBe(false);
  });
});

describe("Task #2065 — snapAngleToStep / applyOrthoAngleLock", () => {
  it("snaps to the nearest multiple of stepDeg", () => {
    const fortyFour = (44 * Math.PI) / 180;
    const fortyFive = (45 * Math.PI) / 180;
    expect(snapAngleToStep(fortyFour, 45)).toBeCloseTo(fortyFive, 6);
  });

  it("locks the cursor onto the nearest preset ray, preserving length", () => {
    const anchor = { x: 0, y: 0 };
    // 44° at length √2 → should land on the 45° ray with the same length.
    const angle = (44 * Math.PI) / 180;
    const len = Math.SQRT2;
    const cursor = { x: Math.cos(angle) * len, y: Math.sin(angle) * len };
    const locked = applyOrthoAngleLock(cursor, anchor, 45);
    expect(Math.hypot(locked.x, locked.y)).toBeCloseTo(len, 6);
    const lockedAngle = Math.atan2(locked.y, locked.x);
    expect(lockedAngle).toBeCloseTo((45 * Math.PI) / 180, 6);
  });

  it("returns cursor unchanged when anchor is null or coincident", () => {
    expect(applyOrthoAngleLock({ x: 5, y: 5 }, null, 45)).toEqual({ x: 5, y: 5 });
    const same = applyOrthoAngleLock({ x: 0, y: 0 }, { x: 0, y: 0 }, 45);
    expect(same).toEqual({ x: 0, y: 0 });
  });

  it("exposes the canonical preset angle list in cycling order", () => {
    expect([...ORTHO_PRESET_ANGLES]).toEqual([15, 30, 45, 90]);
  });
});

describe("Task #2065 — applyTypedLength / applyTypedLengthAndAngle / applyTypedOffset", () => {
  const scale = 10; // 10 px / ft

  it("forces the length while preserving direction", () => {
    const out = applyTypedLength({ x: 30, y: 40 }, { x: 0, y: 0 }, 5, scale);
    // 5 ft × 10 px = 50 px along the (3,4) → (0.6,0.8) unit vector.
    expect(out.x).toBeCloseTo(30, 6);
    expect(out.y).toBeCloseTo(40, 6);
  });

  it("falls back to +X when cursor coincides with anchor", () => {
    const out = applyTypedLength({ x: 0, y: 0 }, { x: 0, y: 0 }, 3, scale);
    expect(out).toEqual({ x: 30, y: 0 });
  });

  it("places the point at typed length AND typed angle", () => {
    const out = applyTypedLengthAndAngle(
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      10,
      90,
      scale
    );
    // 10 ft × 10 px = 100 px at 90° → (0, 100)
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(100, 6);
  });

  it("uses cursor angle when no typed angle is supplied", () => {
    const out = applyTypedLengthAndAngle(
      { x: 0, y: 50 },
      { x: 0, y: 0 },
      2,
      null,
      scale
    );
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(20, 6);
  });

  it("applies a typed Δx,Δy offset", () => {
    const out = applyTypedOffset({ x: 100, y: 200 }, 3, -2, scale);
    expect(out).toEqual({ x: 130, y: 180 });
  });
});

describe("Task #2065 — applyParsedTypedInput orchestrator", () => {
  const scale = 10;

  it("dispatches a single length to applyTypedLengthAndAngle", () => {
    const parsed = parseTypedInput("5");
    const out = applyParsedTypedInput(parsed, { x: 30, y: 40 }, { x: 0, y: 0 }, scale);
    expect(out).not.toBeNull();
    expect(out!.x).toBeCloseTo(30, 6);
    expect(out!.y).toBeCloseTo(40, 6);
  });

  it("dispatches Δx,Δy to applyTypedOffset and ignores the angle suffix", () => {
    const parsed = parseTypedInput("3,4");
    const out = applyParsedTypedInput(parsed, { x: 0, y: 0 }, { x: 10, y: 10 }, scale);
    expect(out).not.toBeNull();
    expect(out!.x).toBeCloseTo(40, 6);
    expect(out!.y).toBeCloseTo(50, 6);
  });

  it("returns null for invalid parsed input", () => {
    const parsed = parseTypedInput("");
    const out = applyParsedTypedInput(parsed, { x: 0, y: 0 }, { x: 0, y: 0 }, scale);
    expect(out).toBeNull();
  });
});
