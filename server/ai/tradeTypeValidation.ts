// Task #2121 — Shared trade-type validation helpers used by the AI route
// handlers. Extracted into a standalone module so they can be unit-tested
// without pulling in the full Express / Drizzle / OpenAI dependency graph
// of `aiDocumentRoutes.ts` or `aiTakeoffFeatureRoutes.ts`.
//
// Two distinct lists are exposed:
//
//  - `VALID_DB_TRADE_TYPES` is derived directly from the Postgres
//    `tradeTypeEnum` and is the authoritative list for any value that
//    will be persisted to a `trade_type` column (`aiTakeoffAnalyses`,
//    `projectScheduleTasks`, etc.). It excludes the eight legacy
//    TS-only labels (FRAMING, WINDOWS_DOORS, SIDING, TILE, CABINETRY,
//    COUNTERTOPS, FENCING, DECKING) that exist in
//    `@shared/tradeTypeUtils` for library/UI compatibility but would
//    fail on insert.
//
//  - The canonical `VALID_TRADE_TYPES` from `@shared/tradeTypeUtils`
//    (re-exported via `isValidAiTradeType` for legacy callers) still
//    accepts the TS-only labels and is used only in non-persistence
//    code paths.

import { tradeTypeEnum } from "@shared/schema/enums";
import {
  isValidTradeType as canonicalIsValidTradeType,
  type TradeType,
} from "@shared/tradeTypeUtils";

/**
 * Authoritative list of trade-type strings that the Postgres enum will
 * accept. Used for prompt construction and request validation in any AI
 * flow whose output is written back to a `tradeTypeEnum` column.
 */
export const VALID_DB_TRADE_TYPES = tradeTypeEnum.enumValues;

export type DbTradeType = (typeof tradeTypeEnum.enumValues)[number];

const DB_TRADE_TYPE_SET = new Set<string>(VALID_DB_TRADE_TYPES);

/**
 * Strict, persistence-safe validator. Returns true only when the value
 * matches a member of the live Postgres `tradeTypeEnum`, ensuring the
 * caller can safely persist it to a `trade_type` column.
 */
export function isValidDbTradeType(
  value: string | null | undefined,
): value is DbTradeType {
  return typeof value === "string" && DB_TRADE_TYPE_SET.has(value);
}

/**
 * Nullable-input wrapper around the canonical `isValidTradeType`. Both AI
 * route handlers receive trade-type values from optional schemas or
 * nullable DB columns, so accepting `null` / `undefined` directly avoids
 * boilerplate at every call site while preserving the type narrowing.
 *
 * NOTE: This accepts the legacy TS-only labels too. Use
 * `isValidDbTradeType` instead when validating values that will be
 * written to a `tradeTypeEnum` column.
 */
export function isValidAiTradeType(
  value: string | null | undefined,
): value is TradeType {
  return typeof value === "string" && canonicalIsValidTradeType(value);
}

/**
 * Normalise an AI-generated free-text trade label into the canonical
 * Postgres-enum value used by `projectScheduleTasks.tradeType`. Returns
 * `null` if the input cannot be mapped to a DB-enum value, which the
 * caller stores as-is so the column is left unset rather than being
 * silently downgraded to `OTHER` or — worse — being assigned a legacy
 * TS-only label that would fail at insert time.
 */
export function normalizeScheduleTaskTradeType(
  tradeType: string | undefined | null,
): DbTradeType | null {
  if (!tradeType) return null;
  const normalized = tradeType
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  if (DB_TRADE_TYPE_SET.has(normalized)) {
    return normalized as DbTradeType;
  }
  return null;
}
