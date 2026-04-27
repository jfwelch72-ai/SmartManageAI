// Task #2121 — Smoke test for AI route trade-type validators.
//
// Two AI route handlers (`server/aiDocumentRoutes.ts` and
// `server/aiTakeoffFeatureRoutes.ts`) used to declare their own private
// `VALID_TRADE_TYPES` arrays for prompt construction and request
// validation. They were not updated by Task #2100, so heavy-civil enum
// values (SANITARY_SEWER, STRUCTURAL_STEEL, FIRE_PROTECTION_SYSTEMS, …)
// were silently rejected or downgraded to OTHER when the AI saw them.
//
// This test pins the fix in place by exercising the canonical trade-type
// utilities AND the per-file wrappers that the routes actually call,
// covering at least one civil and one specialty trade flowing through
// the AI scope-prediction / takeoff / schedule generation flows. It also
// asserts that the persistence-bound helpers reject the legacy TS-only
// labels (FRAMING, WINDOWS_DOORS, …) that exist in
// `@shared/tradeTypeUtils` for library/UI compatibility but are NOT
// members of the Postgres `tradeTypeEnum`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  VALID_TRADE_TYPES,
  isValidTradeType as canonicalIsValidTradeType,
  normalizeTradeType as canonicalNormalizeTradeType,
} from "@shared/tradeTypeUtils";

import {
  VALID_DB_TRADE_TYPES,
  isValidAiTradeType,
  isValidDbTradeType,
  normalizeScheduleTaskTradeType,
} from "../ai/tradeTypeValidation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, "..");

// Civil heavy-civil enum value — was rejected before the fix.
const CIVIL_TRADE = "SANITARY_SEWER" as const;

// Specialty enum values — were silently downgraded before the fix.
const SPECIALTY_TRADES = ["FIRE_PROTECTION_SYSTEMS", "STRUCTURAL_STEEL"] as const;

// Legacy TS-only labels that live in `@shared/tradeTypeUtils` for UI
// compatibility but are NOT members of the Postgres `tradeTypeEnum`. The
// persistence-bound helpers must reject them so we don't poison
// enum-backed columns at insert time.
const LEGACY_TS_ONLY_TRADES = [
  "FRAMING",
  "WINDOWS_DOORS",
  "SIDING",
  "TILE",
  "CABINETRY",
  "COUNTERTOPS",
  "FENCING",
  "DECKING",
] as const;

describe("Task #2121 — canonical trade-type list covers civil + specialty", () => {
  it("VALID_TRADE_TYPES includes the new civil trade", () => {
    expect(VALID_TRADE_TYPES).toContain(CIVIL_TRADE);
  });

  it("VALID_TRADE_TYPES includes the new specialty trades", () => {
    for (const trade of SPECIALTY_TRADES) {
      expect(VALID_TRADE_TYPES).toContain(trade);
    }
  });

  it("canonical isValidTradeType accepts civil + specialty trades", () => {
    expect(canonicalIsValidTradeType(CIVIL_TRADE)).toBe(true);
    for (const trade of SPECIALTY_TRADES) {
      expect(canonicalIsValidTradeType(trade)).toBe(true);
    }
  });

  it("canonical normalizeTradeType round-trips civil + specialty trades", () => {
    expect(canonicalNormalizeTradeType(CIVIL_TRADE)).toBe(CIVIL_TRADE);
    for (const trade of SPECIALTY_TRADES) {
      expect(canonicalNormalizeTradeType(trade)).toBe(trade);
    }
  });
});

describe("Task #2121 — VALID_DB_TRADE_TYPES mirrors the Postgres enum", () => {
  it("includes the civil + specialty trades", () => {
    expect(VALID_DB_TRADE_TYPES).toContain(CIVIL_TRADE);
    for (const trade of SPECIALTY_TRADES) {
      expect(VALID_DB_TRADE_TYPES).toContain(trade);
    }
  });

  it("excludes the legacy TS-only labels that the DB enum does not accept", () => {
    for (const trade of LEGACY_TS_ONLY_TRADES) {
      expect(VALID_DB_TRADE_TYPES).not.toContain(trade);
    }
  });
});

describe("Task #2121 — aiTakeoffFeatureRoutes accepts civil + specialty trades", () => {
  it("recognises the civil trade as a valid DB-backed takeoff trade type", () => {
    expect(isValidDbTradeType(CIVIL_TRADE)).toBe(true);
  });

  it("recognises the specialty trades as valid DB-backed takeoff trade types", () => {
    for (const trade of SPECIALTY_TRADES) {
      expect(isValidDbTradeType(trade)).toBe(true);
    }
  });

  it("rejects unknown trade types and nullish input", () => {
    expect(isValidDbTradeType("NOT_A_REAL_TRADE")).toBe(false);
    expect(isValidDbTradeType(null)).toBe(false);
    expect(isValidDbTradeType(undefined)).toBe(false);
  });

  it("rejects the legacy TS-only labels so they cannot be persisted to the enum column", () => {
    for (const trade of LEGACY_TS_ONLY_TRADES) {
      // Sanity-check: the canonical (non-DB) helper still recognises them.
      expect(isValidAiTradeType(trade)).toBe(true);
      // But the persistence-bound DB helper must NOT.
      expect(isValidDbTradeType(trade)).toBe(false);
    }
  });
});

describe("Task #2121 — aiDocumentRoutes schedule normaliser accepts civil + specialty trades", () => {
  it("normalises the civil trade to itself for AI schedule task inserts", () => {
    expect(normalizeScheduleTaskTradeType(CIVIL_TRADE)).toBe(CIVIL_TRADE);
  });

  it("normalises specialty trades to themselves for AI schedule task inserts", () => {
    for (const trade of SPECIALTY_TRADES) {
      expect(normalizeScheduleTaskTradeType(trade)).toBe(trade);
    }
  });

  it("still tolerates loosely-formatted civil trade strings", () => {
    // The schedule normaliser uppercases and snake-cases incoming values
    // before checking membership, so e.g. an AI response of
    // "sanitary sewer" must still resolve to the canonical enum value.
    expect(normalizeScheduleTaskTradeType("sanitary sewer")).toBe("SANITARY_SEWER");
    expect(normalizeScheduleTaskTradeType("structural-steel")).toBe("STRUCTURAL_STEEL");
  });

  it("returns null for unknown trade types so the column stays unset", () => {
    expect(normalizeScheduleTaskTradeType("nope")).toBeNull();
    expect(normalizeScheduleTaskTradeType("")).toBeNull();
    expect(normalizeScheduleTaskTradeType(null)).toBeNull();
    expect(normalizeScheduleTaskTradeType(undefined)).toBeNull();
  });

  it("returns null for the legacy TS-only labels rather than poisoning the enum column", () => {
    for (const trade of LEGACY_TS_ONLY_TRADES) {
      expect(normalizeScheduleTaskTradeType(trade)).toBeNull();
    }
  });
});

describe("Task #2121 — AI route modules use the shared trade-type helpers", () => {
  it("aiDocumentRoutes uses the shared trade-type validation helper", () => {
    const src = readFileSync(path.join(SERVER_DIR, "aiDocumentRoutes.ts"), "utf8");
    expect(src).toContain("./ai/tradeTypeValidation");
    // No locally redeclared list/array of canonical trade enum values.
    expect(src).not.toMatch(/^const VALID_TRADE_TYPES = \[/m);
  });

  it("aiTakeoffFeatureRoutes uses the shared DB-bound trade-type helper", () => {
    const src = readFileSync(path.join(SERVER_DIR, "aiTakeoffFeatureRoutes.ts"), "utf8");
    expect(src).toContain("./ai/tradeTypeValidation");
    expect(src).toContain("VALID_DB_TRADE_TYPES");
    expect(src).not.toMatch(/^const VALID_TRADE_TYPES = \[/m);
  });
});
