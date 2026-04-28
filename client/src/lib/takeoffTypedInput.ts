/**
 * Task #2140 — Typed-dimension input parser for the Takeoff Dim Input HUD
 * (Section 4 of `docs/takeoff-interaction-map.md`).
 *
 * Pure, framework-free parser. Used by both the inline calibration drawer
 * (Section 5) and the during-draw HUD so the same grammar applies in
 * either place. No DOM/React/canvas access — exists in `client/src/lib`
 * so it can be unit-tested in jsdom without mounting the workspace.
 *
 * Grammar (case-insensitive, whitespace optional):
 *
 *   length        := number unit?
 *   unit          := 'ft' | "'" | 'in' | '"' | 'm' | 'cm' | 'mm'
 *   feet-inches   := number "'" number? '"'?      ; e.g. 12'6"
 *   angle-suffix  := '<' number ('°')?            ; e.g. <45
 *   typed-input   := length | feet-inches
 *                  [ angle-suffix ]
 *                  [ ',' length ]                 ; second value = explicit Y
 *
 * Always returns lengths in **feet** so callers can multiply by
 * `scalePxPerFoot` directly. The caller passes its current
 * `defaultUnits` ('ft' or 'm') so a bare `12` from a metric sheet is
 * 12 m, not 12 ft.
 *
 * Parse errors carry a 0-indexed `caret` pointing at the offending
 * character of the **original** input string. Callers (the HUD,
 * calibration drawer) use the caret to underline / highlight the
 * offending token.
 */

export type ParsedDimension =
  | { kind: "length"; lengthFt: number }
  | { kind: "length-angle"; lengthFt: number; angleDeg: number }
  | { kind: "delta-xy"; dxFt: number; dyFt: number };

export interface ParseError {
  ok: false;
  /** Human-readable error suitable for inline display under the HUD. */
  error: string;
  /** 0-indexed character position in the original input that the
   *  parser couldn't make sense of. Always within `[0, input.length]`. */
  caret: number;
}

export type ParseResult =
  | { ok: true; value: ParsedDimension }
  | ParseError;

export type DefaultUnits = "ft" | "m";

const M_TO_FT = 3.28083989501312;
const CM_TO_FT = M_TO_FT / 100;
const MM_TO_FT = M_TO_FT / 1000;
const IN_TO_FT = 1 / 12;

/**
 * Internal exception type — carries an offset (relative to the token
 * the parser was working on, NOT the original input). The top-level
 * `parseTypedDimension` translates it back into an absolute caret.
 */
class TokenParseError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.offset = offset;
  }
}

function unitToFeet(
  value: number,
  unit: string | null,
  defaults: DefaultUnits,
): number {
  switch (unit) {
    case "ft":
    case "'":
      return value;
    case "in":
    case '"':
      return value * IN_TO_FT;
    case "m":
      return value * M_TO_FT;
    case "cm":
      return value * CM_TO_FT;
    case "mm":
      return value * MM_TO_FT;
    case null:
      return defaults === "m" ? value * M_TO_FT : value;
    default:
      // Unreachable — `parseLengthToken` only forwards values matched
      // by the regex below.
      throw new TokenParseError(`unknown unit "${unit}"`, 0);
  }
}

// Feet-inches: optional minus, a feet number, a literal `'`, then
// optionally an inches number with an optional `"` or `in` suffix.
// Handles `12'`, `12'6`, `12'6"`, `12'6in`, `12.5'`, `-3'2"`.
const FEET_INCHES_RE =
  /^(-?\d+(?:\.\d+)?)'(?:(\d+(?:\.\d+)?)(?:"|in)?)?$/;

// Plain `number unit?`. Handles `12`, `12ft`, `12in`, `12m`, `12cm`,
// `12mm`, `6"`, `12'` (the latter falls through to FEET_INCHES_RE
// first; this is for `12'` not matching above which it does).
const NUMBER_UNIT_RE =
  /^(-?\d+(?:\.\d+)?)(ft|in|cm|mm|m|"|')?$/;

function parseLengthToken(raw: string, defaults: DefaultUnits): number {
  // Drop ALL whitespace inside the token so `12 ' 6 "` still parses.
  const tok = raw.toLowerCase().replace(/\s+/g, "");
  if (!tok) throw new TokenParseError("empty length", 0);

  const fi = FEET_INCHES_RE.exec(tok);
  if (fi) {
    const ft = parseFloat(fi[1]);
    const inches = fi[2] ? parseFloat(fi[2]) : 0;
    if (!Number.isFinite(ft) || !Number.isFinite(inches)) {
      throw new TokenParseError(`bad feet-inches "${raw}"`, 0);
    }
    const sign = ft < 0 ? -1 : 1;
    return ft + sign * inches * IN_TO_FT;
  }

  const nu = NUMBER_UNIT_RE.exec(tok);
  if (!nu) {
    // Find the first character we couldn't match against the leading
    // number — gives the caret a sensible target.
    const m = /[^\d.\-]/.exec(tok);
    throw new TokenParseError(`cannot parse "${raw}"`, m ? m.index : 0);
  }
  const value = parseFloat(nu[1]);
  if (!Number.isFinite(value)) {
    throw new TokenParseError(`cannot parse "${raw}"`, 0);
  }
  return unitToFeet(value, nu[2] ?? null, defaults);
}

function leadingTrimOffset(input: string): number {
  let i = 0;
  while (i < input.length && /\s/.test(input[i])) i++;
  return i;
}

/**
 * Parse a single typed-dimension expression. Splits on `<` first
 * (length-angle) then on `,` (delta-xy), then falls through to a
 * single length value. Returns `{ ok:false, error, caret }` for
 * anything the HUD should refuse to commit.
 */
export function parseTypedDimension(
  input: string,
  defaults: DefaultUnits = "ft",
): ParseResult {
  const trimOffset = leadingTrimOffset(input);
  const cleaned = input.trim();
  if (!cleaned) return { ok: false, error: "empty", caret: 0 };

  try {
    const angleSplit = cleaned.split("<");
    if (angleSplit.length > 2) {
      return {
        ok: false,
        error: 'multiple "<"',
        caret: trimOffset + cleaned.indexOf("<", cleaned.indexOf("<") + 1),
      };
    }
    if (angleSplit.length === 2) {
      const [lenPart, anglePart] = angleSplit;
      if (!lenPart.trim()) {
        return {
          ok: false,
          error: 'missing length before "<"',
          caret: trimOffset,
        };
      }
      const lengthFt = parseLengthToken(lenPart, defaults);
      const angleRaw = anglePart.trim().replace(/°$/, "");
      const angleDeg = parseFloat(angleRaw);
      if (!Number.isFinite(angleDeg)) {
        return {
          ok: false,
          error: "bad angle",
          caret: trimOffset + cleaned.indexOf("<") + 1,
        };
      }
      return { ok: true, value: { kind: "length-angle", lengthFt, angleDeg } };
    }

    const commaSplit = cleaned.split(",");
    if (commaSplit.length > 2) {
      return {
        ok: false,
        error: 'multiple ","',
        caret: trimOffset + cleaned.indexOf(",", cleaned.indexOf(",") + 1),
      };
    }
    if (commaSplit.length === 2) {
      const [xRaw, yRaw] = commaSplit;
      let dxFt: number;
      try {
        dxFt = parseLengthToken(xRaw, defaults);
      } catch (e: unknown) {
        if (e instanceof TokenParseError) {
          return { ok: false, error: e.message, caret: trimOffset + e.offset };
        }
        throw e;
      }
      let dyFt: number;
      try {
        dyFt = parseLengthToken(yRaw, defaults);
      } catch (e: unknown) {
        if (e instanceof TokenParseError) {
          return {
            ok: false,
            error: e.message,
            caret: trimOffset + cleaned.indexOf(",") + 1 + e.offset,
          };
        }
        throw e;
      }
      return { ok: true, value: { kind: "delta-xy", dxFt, dyFt } };
    }

    const lengthFt = parseLengthToken(cleaned, defaults);
    return { ok: true, value: { kind: "length", lengthFt } };
  } catch (e: unknown) {
    if (e instanceof TokenParseError) {
      return { ok: false, error: e.message, caret: trimOffset + e.offset };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : "parse error",
      caret: 0,
    };
  }
}

/**
 * Format a parsed dimension as a friendly preview string for the HUD
 * (e.g. `12 ft 6 in @ 30°`). Pure — no React/DOM. Kept here so the
 * unit tests can pin the format independently of the component.
 */
export function formatParsedDimension(
  parsed: ParsedDimension,
  units: DefaultUnits,
): string {
  if (parsed.kind === "delta-xy") {
    return `Δx ${formatLengthFt(parsed.dxFt, units)}, Δy ${formatLengthFt(parsed.dyFt, units)}`;
  }
  const len = formatLengthFt(parsed.lengthFt, units);
  if (parsed.kind === "length-angle") {
    return `${len} @ ${parsed.angleDeg}°`;
  }
  return len;
}

function formatLengthFt(lengthFt: number, units: DefaultUnits): string {
  if (units === "m") {
    const m = lengthFt / M_TO_FT;
    return `${m.toFixed(3)} m`;
  }
  // Imperial: emit `ft` + optional `in` if the inches part is non-zero.
  const sign = lengthFt < 0 ? -1 : 1;
  const abs = Math.abs(lengthFt);
  const ft = Math.floor(abs);
  const inches = (abs - ft) * 12;
  if (inches < 1e-3) return `${sign * ft} ft`;
  // Round to 1/16" precision for display readability.
  const inchesRounded = Math.round(inches * 16) / 16;
  return `${sign * ft} ft ${inchesRounded.toFixed(2)} in`;
}

/**
 * The set of single keystrokes the Dim Input HUD should swallow.
 *
 * The grammar is digit-led: a typed dimension MUST start with a
 * digit, a `.`, a leading `-`, or a `'` (the bare-feet apostrophe).
 * Letters are only consumed once the buffer already contains
 * something — and even then we restrict to the unit letters
 * `f`, `t`, `i`, `n`, `m`, `c` (case-insensitive). That preserves
 * single-letter shortcuts like `O` (ortho), `T` (calibrate),
 * `S` (snap), etc. when the HUD is active but empty.
 */
const STARTERS_RE = /^[0-9.\-']$/;
const UNIT_LETTERS_RE = /^[ftincmFTINCM]$/;
const SEPARATORS_RE = /^[.,'"<°]$/;

export function isTypedDimensionChar(key: string, bufferEmpty: boolean): boolean {
  if (key.length !== 1) return false;
  // Always allow digits and the digit-adjacent separators (after a
  // number is in the buffer, `.` `,` `'` `"` `<` `°` continue the
  // grammar; before a number, only `'`, `.`, `-` make sense as a
  // length starter).
  if (/^[0-9]$/.test(key)) return true;
  if (bufferEmpty) return STARTERS_RE.test(key);
  if (SEPARATORS_RE.test(key)) return true;
  if (UNIT_LETTERS_RE.test(key)) return true;
  return false;
}
