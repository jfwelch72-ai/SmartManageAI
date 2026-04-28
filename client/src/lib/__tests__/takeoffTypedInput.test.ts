// @vitest-environment jsdom
//
// Task #2140 — Pin the Dim Input HUD grammar (Section 4 of
// `docs/takeoff-interaction-map.md`). The parser is the single source
// of truth for both the during-draw HUD and the inline calibration
// drawer, so a silent off-by-one in the foot/inch math would corrupt
// every measurement created via typed dimensions. These tests pin
// the grammar table the docs publish to estimators.

import { describe, it, expect } from "vitest";
import {
  parseTypedDimension,
  isTypedDimensionChar,
  formatParsedDimension,
} from "../takeoffTypedInput";

function ok(input: string, units: "ft" | "m" = "ft") {
  const r = parseTypedDimension(input, units);
  if (!r.ok) throw new Error(`expected "${input}" to parse, got: ${r.error}`);
  return r.value;
}

function err(input: string, units: "ft" | "m" = "ft") {
  const r = parseTypedDimension(input, units);
  if (r.ok) throw new Error(`expected "${input}" to fail, got: ${JSON.stringify(r.value)}`);
  return r.error;
}

function errFull(input: string, units: "ft" | "m" = "ft") {
  const r = parseTypedDimension(input, units);
  if (r.ok) throw new Error(`expected "${input}" to fail, got: ${JSON.stringify(r.value)}`);
  return r;
}

describe("parseTypedDimension — length only", () => {
  it("treats a bare number as feet by default", () => {
    expect(ok("12")).toEqual({ kind: "length", lengthFt: 12 });
  });

  it("treats a bare number as meters when defaults=m", () => {
    const v = ok("12", "m");
    expect(v.kind).toBe("length");
    if (v.kind === "length") {
      expect(v.lengthFt).toBeCloseTo(39.3700787, 5);
    }
  });

  it("accepts the ft suffix", () => {
    expect(ok("12ft")).toEqual({ kind: "length", lengthFt: 12 });
    expect(ok("12 FT")).toEqual({ kind: "length", lengthFt: 12 });
  });

  it("accepts the foot apostrophe", () => {
    expect(ok("12'")).toEqual({ kind: "length", lengthFt: 12 });
  });

  it("accepts inches via in or double-quote", () => {
    const a = ok("6in");
    const b = ok('6"');
    expect(a.kind).toBe("length");
    expect(b.kind).toBe("length");
    if (a.kind === "length" && b.kind === "length") {
      expect(a.lengthFt).toBeCloseTo(0.5, 6);
      expect(b.lengthFt).toBeCloseTo(0.5, 6);
    }
  });

  it("converts metric units to feet", () => {
    const m = ok("3m");
    const cm = ok("100cm");
    const mm = ok("1000mm");
    if (m.kind === "length" && cm.kind === "length" && mm.kind === "length") {
      expect(m.lengthFt).toBeCloseTo(9.84251968, 5);
      expect(cm.lengthFt).toBeCloseTo(3.28083989, 5);
      expect(mm.lengthFt).toBeCloseTo(3.28083989, 5);
    }
  });

  it("parses decimal lengths", () => {
    expect(ok("3.5")).toEqual({ kind: "length", lengthFt: 3.5 });
  });
});

describe("parseTypedDimension — feet-inches composite", () => {
  it("parses 12'6\" as 12.5 ft", () => {
    const v = ok("12'6\"");
    expect(v.kind).toBe("length");
    if (v.kind === "length") expect(v.lengthFt).toBeCloseTo(12.5, 6);
  });

  it("treats trailing quote as optional", () => {
    const v = ok("12'6");
    if (v.kind === "length") expect(v.lengthFt).toBeCloseTo(12.5, 6);
  });

  it("accepts 'in' as inch unit inside feet-inches", () => {
    const v = ok("12'6in");
    if (v.kind === "length") expect(v.lengthFt).toBeCloseTo(12.5, 6);
  });

  it("treats negative feet as a fully signed length", () => {
    const v = ok("-3'2\"");
    if (v.kind === "length") {
      // -3 ft AND -2 in (sign of ft propagates to inches), not -3 + 2/12.
      expect(v.lengthFt).toBeCloseTo(-3.16666666, 5);
    }
  });

  it("ignores whitespace between feet, inches, and units", () => {
    const v = ok("12 ' 6 \"");
    if (v.kind === "length") expect(v.lengthFt).toBeCloseTo(12.5, 6);
  });
});

describe("parseTypedDimension — angle suffix", () => {
  it("parses 12<30 as length+angle", () => {
    expect(ok("12<30")).toEqual({
      kind: "length-angle",
      lengthFt: 12,
      angleDeg: 30,
    });
  });

  it("strips a trailing degree sign", () => {
    expect(ok("12<45°")).toEqual({
      kind: "length-angle",
      lengthFt: 12,
      angleDeg: 45,
    });
  });

  it("accepts feet-inches before the angle", () => {
    const v = ok("12'6\"<45");
    expect(v.kind).toBe("length-angle");
    if (v.kind === "length-angle") {
      expect(v.lengthFt).toBeCloseTo(12.5, 6);
      expect(v.angleDeg).toBe(45);
    }
  });

  it("rejects empty length before <", () => {
    expect(err("<30")).toMatch(/missing length/);
  });

  it("rejects multiple angle separators", () => {
    expect(err("12<30<45")).toMatch(/multiple/);
  });

  it("rejects a non-numeric angle", () => {
    expect(err("12<abc")).toMatch(/angle/);
  });
});

describe("parseTypedDimension — delta xy", () => {
  it("parses 12,6 as Δx=12 Δy=6 in default units", () => {
    expect(ok("12,6")).toEqual({ kind: "delta-xy", dxFt: 12, dyFt: 6 });
  });

  it("supports mixed units between dx and dy", () => {
    const v = ok('12,6"');
    if (v.kind === "delta-xy") {
      expect(v.dxFt).toBeCloseTo(12, 6);
      expect(v.dyFt).toBeCloseTo(0.5, 6);
    }
  });

  it("rejects more than one comma", () => {
    expect(err("1,2,3")).toMatch(/multiple/);
  });
});

describe("parseTypedDimension — error surface", () => {
  it("returns ok:false for empty input", () => {
    expect(err("")).toMatch(/empty/);
    expect(err("   ")).toMatch(/empty/);
  });

  it("returns ok:false for unparseable garbage", () => {
    expect(err("hello")).toBeTruthy();
    expect(err("12xy")).toBeTruthy();
  });
});

describe("parseTypedDimension — caret position", () => {
  // The caret is what the HUD/drawer underline to show the user
  // exactly where their input went off the rails. These are pinned
  // so a refactor of the parser can't silently move the highlight.

  it("points to the second '<' when there are too many", () => {
    const r = errFull("12<30<45");
    expect(r.caret).toBe("12<30<45".indexOf("<", 3));
  });

  it("points just past '<' for a non-numeric angle", () => {
    const r = errFull("12<abc");
    expect(r.caret).toBe("12<abc".indexOf("<") + 1);
  });

  it("points at the second comma when there are too many", () => {
    const r = errFull("1,2,3");
    expect(r.caret).toBe("1,2,3".indexOf(",", 2));
  });

  it("points to the offending character inside a length token", () => {
    // `12xy` — the `x` is the first non-numeric char.
    const r = errFull("12xy");
    expect(r.caret).toBe(2);
  });

  it("offsets the caret past leading whitespace", () => {
    const r = errFull("   <30");
    // empty length before `<` — caret lands at the first non-space.
    expect(r.caret).toBe(3);
  });

  it("offsets the caret past the comma when dy fails", () => {
    const r = errFull("12,xy");
    // `xy` starts right after the comma → caret = comma index + 1.
    expect(r.caret).toBe(3);
  });

  it("returns caret 0 for empty input", () => {
    const r = errFull("");
    expect(r.caret).toBe(0);
  });
});

describe("formatParsedDimension", () => {
  it("formats whole feet as 'X ft'", () => {
    expect(formatParsedDimension({ kind: "length", lengthFt: 12 }, "ft")).toBe(
      "12 ft",
    );
  });

  it("formats fractional feet as ft + in", () => {
    const out = formatParsedDimension(
      { kind: "length", lengthFt: 12.5 },
      "ft",
    );
    expect(out).toMatch(/^12 ft 6\.00 in$/);
  });

  it("formats meters when units=m", () => {
    const out = formatParsedDimension(
      { kind: "length", lengthFt: 3.28083989501312 },
      "m",
    );
    expect(out).toMatch(/^1\.000 m$/);
  });

  it("formats length-angle with the @ separator", () => {
    expect(
      formatParsedDimension(
        { kind: "length-angle", lengthFt: 12, angleDeg: 30 },
        "ft",
      ),
    ).toBe("12 ft @ 30°");
  });

  it("formats delta-xy with Δx / Δy prefixes", () => {
    expect(
      formatParsedDimension(
        { kind: "delta-xy", dxFt: 12, dyFt: 6 },
        "ft",
      ),
    ).toBe("Δx 12 ft, Δy 6 ft");
  });
});

describe("isTypedDimensionChar", () => {
  it("accepts digits in any buffer state", () => {
    for (const ch of "0123456789") {
      expect(isTypedDimensionChar(ch, true), ch).toBe(true);
      expect(isTypedDimensionChar(ch, false), ch).toBe(true);
    }
  });

  it("accepts only digit-led starters when the buffer is empty", () => {
    // Allowed starters: digits, `.`, `-`, `'`.
    for (const ch of ".-'") {
      expect(isTypedDimensionChar(ch, true), ch).toBe(true);
    }
    // Separators that need a leading number are NOT allowed first.
    for (const ch of `,<"°`) {
      expect(isTypedDimensionChar(ch, true), ch).toBe(false);
    }
    // Letters are NOT allowed first — preserves single-letter
    // shortcuts like O/T/S even while the HUD is mounted.
    for (const ch of "fFtTiInNmMcC") {
      expect(isTypedDimensionChar(ch, true), ch).toBe(false);
    }
  });

  it("accepts continuation chars + unit letters once the buffer has a number", () => {
    // Once a number has been typed, the continuation separators
    // are allowed. `-` is intentionally NOT here — it's only a
    // leading-minus starter, not a mid-buffer continuation.
    for (const ch of `.,'"<°`) {
      expect(isTypedDimensionChar(ch, false), ch).toBe(true);
    }
    // `-` mid-buffer is rejected (negative numbers must be the
    // first char).
    expect(isTypedDimensionChar("-", false)).toBe(false);
    // Only the unit letters are allowed (case-insensitive).
    for (const ch of "fFtTiInNmMcC") {
      expect(isTypedDimensionChar(ch, false), ch).toBe(true);
    }
    // All other letters are still rejected so shortcuts like
    // O/A/V/Q/etc. work even mid-buffer.
    for (const ch of "oOaAvVsSqQrRwWxXyYzZbBdDeEgGhHjJkKlLpP") {
      expect(isTypedDimensionChar(ch, false), ch).toBe(false);
    }
  });

  it("rejects multi-char keys and non-typed control keys regardless of buffer", () => {
    for (const buf of [true, false]) {
      expect(isTypedDimensionChar("Enter", buf)).toBe(false);
      expect(isTypedDimensionChar("Tab", buf)).toBe(false);
      expect(isTypedDimensionChar("Escape", buf)).toBe(false);
      expect(isTypedDimensionChar(" ", buf)).toBe(false);
      expect(isTypedDimensionChar("/", buf)).toBe(false);
    }
  });
});
