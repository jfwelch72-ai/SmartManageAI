// Tiered SLA policy for customer support.
//
// The tier table itself lives in `shared/sla/policy.ts` — that module is
// the single source of truth for the published SLA, the in-app `/sla`
// page, and the markdown contractual reference (`docs/sla.md`, generated
// by `scripts/generate-sla-doc.ts` and verified by
// `scripts/check-sla-doc.mjs`). This file owns only the *computation*
// helpers (business-hours math, holiday calendar, due-time helpers) and
// re-exports the canonical types/values for back-compat.
//
// Task #2962: Business-hour windows are now timezone-aware. Per-org
// `supportTimezone` (IANA string, e.g. "America/New_York") is accepted
// throughout. UTC remains the safe default.
//
// Holiday calendar: The hardcoded US_FEDERAL_HOLIDAYS set is kept for
// backward compatibility (safe fallback when DB is unavailable). The
// canonical source is now the `support_holidays` DB table, fetched via
// `getHolidaySet()`. Call sites that care about DB accuracy should await
// `getHolidaySet("US")` and pass the result to the `*Tz` helpers.

import {
  SLA_TIERS as CANONICAL_SLA_TIERS,
  type SlaPolicy,
  type SlaTarget,
  type SupportTier,
  type SupportPriority,
  type SlaClock,
} from "@shared/sla/policy";
import { db } from "../db";
import { supportHolidays } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logError } from "../utils/logger";

export type { SlaClock, SlaPolicy, SlaTarget, SupportPriority, SupportTier };

/**
 * Re-export of the canonical tier table from `shared/sla/policy.ts`. Edit
 * the canonical module — never reassign or override here.
 */
export const SLA_TIERS = CANONICAL_SLA_TIERS;

// ─── plan tier mapping ────────────────────────────────────────────────────────
type PlanTier = "free" | "starter" | "professional" | "enterprise";
export function planTierToSupportTier(plan: PlanTier | null | undefined): SupportTier {
  switch (plan) {
    case "enterprise":
      return "enterprise";
    case "professional":
      return "pro";
    case "starter":
    case "free":
    default:
      return "starter";
  }
}

// ─── business-hours constants ─────────────────────────────────────────────────
export const BUSINESS_DAY_START_HOUR = 9;
export const BUSINESS_DAY_END_HOUR = 18;
export const BUSINESS_MINUTES_PER_DAY =
  (BUSINESS_DAY_END_HOUR - BUSINESS_DAY_START_HOUR) * 60;

// Back-compat aliases (callers that reference the UTC-named constants still compile).
export const BUSINESS_DAY_START_HOUR_UTC = BUSINESS_DAY_START_HOUR;
export const BUSINESS_DAY_END_HOUR_UTC = BUSINESS_DAY_END_HOUR;

// ─── Holiday calendar ─────────────────────────────────────────────────────────

/**
 * @deprecated Use `getHolidaySet("US")` to pull from the DB. Kept here so
 * callers that import the constant at module load time (tests, scripts) still
 * compile. The set only covers 2026–2027; the DB calendar extends further.
 */
export const US_FEDERAL_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26",
  "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25",
  "2027-12-24",
]);

let _holidayCache: { at: number; country: string; set: ReadonlySet<string> } | null = null;
const HOLIDAY_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

/** Bust the in-process holiday cache (call after any INSERT/DELETE to support_holidays). */
export function invalidateHolidayCache(): void {
  _holidayCache = null;
}

/**
 * Fetch the holiday set for `country` from the `support_holidays` DB table.
 * Results are cached for 1 hour so the SLA hot-path isn't DB-bound.
 * Falls back to the hardcoded US set on error.
 */
export async function getHolidaySet(country = "US"): Promise<ReadonlySet<string>> {
  if (
    _holidayCache &&
    _holidayCache.country === country &&
    Date.now() - _holidayCache.at < HOLIDAY_CACHE_TTL_MS
  ) {
    return _holidayCache.set;
  }
  try {
    const rows = await db
      .select({ date: supportHolidays.date })
      .from(supportHolidays)
      .where(eq(supportHolidays.country, country));
    if (rows.length > 0) {
      const set: ReadonlySet<string> = new Set(rows.map((r) => r.date));
      _holidayCache = { at: Date.now(), country, set };
      return set;
    }
  } catch (err) {
    logError("[slaPolicy] holiday DB fetch failed, falling back to hardcoded set", err);
  }
  return US_FEDERAL_HOLIDAYS;
}

// ─── Timezone-aware local time helpers ───────────────────────────────────────

/**
 * Extract the local-time components of `d` in the given IANA timezone.
 * Returns hours (0–23), day-of-week (0=Sun…6=Sat), and ISO date string.
 */
function getLocalParts(
  d: Date,
  tz: string,
): { hours: number; dow: number; isoDate: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = dtf.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const hours = parseInt(parts.hour ?? "0") % 24; // "24" → 0 for midnight in some locales
  const DOW_MAP: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dow = DOW_MAP[parts.weekday ?? ""] ?? d.getUTCDay();
  const year = parts.year ?? "2000";
  const month = parts.month ?? "01";
  const day = parts.day ?? "01";
  const isoDate = `${year}-${month}-${day}`;
  return { hours, dow, isoDate };
}

/**
 * Find the UTC timestamp corresponding to `targetHour:00` local time on
 * `isoDate` in timezone `tz`. Searches from -15 to +36 hours from midnight
 * UTC on that date in 15-minute steps, which covers all IANA offsets
 * (UTC+14 through UTC-12):
 *   - UTC+14: local midnight ≈ UTC-14h → -840 min
 *   - UTC-12: local 23:00 ≈ UTC+35h → +2100 min
 */
function utcForLocalHour(isoDate: string, targetHour: number, tz: string): Date {
  const midnightUtc = new Date(`${isoDate}T00:00:00Z`);
  for (let m = -15 * 60; m <= 36 * 60; m += 15) {
    const candidate = new Date(midnightUtc.getTime() + m * 60_000);
    const { hours: localH, isoDate: localD } = getLocalParts(candidate, tz);
    if (localD === isoDate && localH === targetHour) {
      return candidate;
    }
  }
  // Fallback: assume UTC
  return new Date(`${isoDate}T${String(targetHour).padStart(2, "0")}:00:00Z`);
}

/**
 * Advance `isoDate` (YYYY-MM-DD) by one calendar day.
 */
function nextIsoDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Timezone-aware business-hours math ──────────────────────────────────────

/**
 * Returns true if `d` falls on a business day in `tz` that is not in
 * `holidays`.
 */
export function isBusinessDayTz(
  d: Date,
  tz: string,
  holidays: ReadonlySet<string>,
): boolean {
  const { dow, isoDate } = getLocalParts(d, tz);
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(isoDate);
}

/**
 * Snap `at` forward to the next business-hours minute (09:00–18:00 local) in
 * `tz`. If `at` is already inside business hours on a business day, returns
 * `at` unchanged. Otherwise jumps to 09:00 local on the next business day.
 */
export function nextBusinessInstantTz(
  at: Date,
  tz: string,
  holidays: ReadonlySet<string>,
): Date {
  let cursor = new Date(at.getTime());
  for (let safety = 0; safety < 21; safety++) {
    const { hours, dow, isoDate } = getLocalParts(cursor, tz);
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidays.has(isoDate);
    if (!isWeekend && !isHoliday && hours >= BUSINESS_DAY_START_HOUR && hours < BUSINESS_DAY_END_HOUR) {
      return cursor;
    }
    // Move to 09:00 local on the next calendar day if we're after business
    // hours; or to 09:00 on the same day if we haven't reached it yet.
    let targetDate = isoDate;
    if (!isWeekend && !isHoliday && hours < BUSINESS_DAY_START_HOUR) {
      // Before business hours — jump to 09:00 same day.
    } else {
      // After business hours / weekend / holiday — jump to next day.
      targetDate = nextIsoDate(isoDate);
    }
    cursor = utcForLocalHour(targetDate, BUSINESS_DAY_START_HOUR, tz);
  }
  return cursor;
}

/**
 * Add `minutes` of business time to `from` in timezone `tz`, skipping
 * non-business hours and holidays.
 */
export function addBusinessMinutesTz(
  from: Date,
  minutes: number,
  tz: string,
  holidays: ReadonlySet<string>,
): Date {
  let cursor = nextBusinessInstantTz(from, tz, holidays);
  let remaining = minutes;
  for (let safety = 0; safety < 200 && remaining > 0; safety++) {
    const { hours, isoDate } = getLocalParts(cursor, tz);
    const endOfBusinessUtc = utcForLocalHour(isoDate, BUSINESS_DAY_END_HOUR, tz);
    const minutesLeftToday = Math.floor((endOfBusinessUtc.getTime() - cursor.getTime()) / 60_000);
    if (remaining <= minutesLeftToday) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= minutesLeftToday;
    // Roll to next business day at 09:00 local.
    cursor = nextBusinessInstantTz(
      new Date(endOfBusinessUtc.getTime() + 60_000),
      tz,
      holidays,
    );
  }
  return cursor;
}

// ─── Legacy UTC helpers (back-compat) ────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !US_FEDERAL_HOLIDAYS.has(isoDate(d));
}

/** @deprecated Use {@link nextBusinessInstantTz} with an explicit timezone. */
export function nextBusinessInstant(at: Date): Date {
  const cursor = new Date(at.getTime());
  for (let safety = 0; safety < 21; safety++) {
    const hour = cursor.getUTCHours();
    if (isBusinessDay(cursor) && hour >= BUSINESS_DAY_START_HOUR_UTC && hour < BUSINESS_DAY_END_HOUR_UTC) {
      return cursor;
    }
    if (isBusinessDay(cursor) && hour < BUSINESS_DAY_START_HOUR_UTC) {
      cursor.setUTCHours(BUSINESS_DAY_START_HOUR_UTC, 0, 0, 0);
      return cursor;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(BUSINESS_DAY_START_HOUR_UTC, 0, 0, 0);
  }
  return cursor;
}

/** @deprecated Use {@link addBusinessMinutesTz} with an explicit timezone. */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let cursor = nextBusinessInstant(from);
  let remaining = minutes;
  for (let safety = 0; safety < 200 && remaining > 0; safety++) {
    const endOfToday = new Date(cursor.getTime());
    endOfToday.setUTCHours(BUSINESS_DAY_END_HOUR_UTC, 0, 0, 0);
    const minutesLeftToday = Math.floor((endOfToday.getTime() - cursor.getTime()) / 60_000);
    if (remaining <= minutesLeftToday) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= minutesLeftToday;
    cursor = nextBusinessInstant(new Date(endOfToday.getTime() + 60_000));
  }
  return cursor;
}

// ─── Public API: due-time computation ────────────────────────────────────────

export interface DueAtOptions {
  /** IANA timezone string. Default "UTC". */
  timezone?: string;
  /** Pre-fetched holiday set. Defaults to the hardcoded UTC set when omitted. */
  holidays?: ReadonlySet<string>;
}

/**
 * Convert a publish-table SLA target into a concrete due-time, applied from
 * `from`. Accepts an optional `options.timezone` (IANA) and
 * `options.holidays` set so callers can pass the org's support settings
 * without triggering a DB round-trip for every ticket.
 *
 * This is the single function the rest of the codebase should use so the
 * create endpoint, the sweep, and the risk-alert math always agree.
 */
export function computeDueAt(from: Date, target: SlaTarget, options?: DueAtOptions): Date {
  const minutes = target.unit === "hours" ? target.amount * 60 : target.amount;
  if (target.clock === "wall") {
    return new Date(from.getTime() + minutes * 60_000);
  }
  const tz = options?.timezone || "UTC";
  const holidays = options?.holidays ?? US_FEDERAL_HOLIDAYS;
  if (tz === "UTC" && holidays === US_FEDERAL_HOLIDAYS) {
    // Fast path: keep the existing UTC computation for backward compat.
    return addBusinessMinutes(from, minutes);
  }
  return addBusinessMinutesTz(from, minutes, tz, holidays);
}

export function firstResponseDueAt(
  from: Date,
  tier: SupportTier,
  priority: SupportPriority,
  options?: DueAtOptions,
): Date {
  return computeDueAt(from, SLA_TIERS[tier].firstResponse[priority], options);
}

export function resolutionDueAt(
  from: Date,
  tier: SupportTier,
  priority: SupportPriority,
  options?: DueAtOptions,
): Date {
  return computeDueAt(from, SLA_TIERS[tier].resolution[priority], options);
}
