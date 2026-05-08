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
// First-response and resolution targets are *priority-aware* per tier — the
// urgent target is much tighter than the normal one — and the computation
// supports two clocks:
//
// - "wall"     : straight wall-clock minutes from creation (used for
//                Enterprise urgent and any "calendar day" published target).
// - "business" : 09:00–18:00 UTC, Monday–Friday, skipping the US federal
//                holidays in `US_FEDERAL_HOLIDAYS`. This is the default for
//                Starter/Pro and for non-urgent Enterprise tickets, matching
//                the public SLA copy.
//
// Per-tenant time-zone-aware business hours are tracked as a follow-up
// (the in-app SLA page calls this out). UTC is the safe default until the
// billing-address TZ is plumbed through.

import {
  SLA_TIERS as CANONICAL_SLA_TIERS,
  type SlaPolicy,
  type SlaTarget,
  type SupportTier,
  type SupportPriority,
  type SlaClock,
} from "@shared/sla/policy";

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

// ─── business-hours math ──────────────────────────────────────────────────────
// All math is in UTC; we treat 09:00–18:00 UTC as the business window. This is
// intentional and called out in docs/sla.md until per-tenant TZ is wired.

export const BUSINESS_DAY_START_HOUR_UTC = 9;
export const BUSINESS_DAY_END_HOUR_UTC = 18;
export const BUSINESS_MINUTES_PER_DAY =
  (BUSINESS_DAY_END_HOUR_UTC - BUSINESS_DAY_START_HOUR_UTC) * 60;

// US federal holidays — kept short and explicit. Add years/dates as needed; the
// helper falls back to "no holidays" outside this set, which is safe (slightly
// tighter SLA than published on those dates) but should be kept current.
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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !US_FEDERAL_HOLIDAYS.has(isoDate(d));
}

/**
 * Snap a wall-clock instant onto the *next* business-hours minute. Outside
 * business hours / weekends / holidays we jump forward to 09:00 UTC of the
 * next business day. Inside business hours we return the timestamp unchanged.
 */
export function nextBusinessInstant(at: Date): Date {
  const cursor = new Date(at.getTime());
  // Walk forward up to ~14 days at most — enough to clear a holiday week.
  for (let safety = 0; safety < 21; safety++) {
    const hour = cursor.getUTCHours();
    if (isBusinessDay(cursor) && hour >= BUSINESS_DAY_START_HOUR_UTC && hour < BUSINESS_DAY_END_HOUR_UTC) {
      return cursor;
    }
    if (isBusinessDay(cursor) && hour < BUSINESS_DAY_START_HOUR_UTC) {
      cursor.setUTCHours(BUSINESS_DAY_START_HOUR_UTC, 0, 0, 0);
      return cursor;
    }
    // Otherwise jump to 09:00 UTC tomorrow and try again.
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(BUSINESS_DAY_START_HOUR_UTC, 0, 0, 0);
  }
  return cursor;
}

/**
 * Add `minutes` of business time to `from`, walking only Mon-Fri 09:00–18:00
 * UTC and skipping holidays in `US_FEDERAL_HOLIDAYS`.
 */
export function addBusinessMinutes(from: Date, minutes: number): Date {
  let cursor = nextBusinessInstant(from);
  let remaining = minutes;
  // Cap iterations defensively — even a 30-business-day SLA is 30 loops.
  for (let safety = 0; safety < 200 && remaining > 0; safety++) {
    const endOfToday = new Date(cursor.getTime());
    endOfToday.setUTCHours(BUSINESS_DAY_END_HOUR_UTC, 0, 0, 0);
    const minutesLeftToday = Math.floor((endOfToday.getTime() - cursor.getTime()) / 60_000);
    if (remaining <= minutesLeftToday) {
      return new Date(cursor.getTime() + remaining * 60_000);
    }
    remaining -= minutesLeftToday;
    // Roll to the next business day at 09:00 UTC.
    cursor = nextBusinessInstant(new Date(endOfToday.getTime() + 60_000));
  }
  return cursor;
}

/**
 * Convert a publish-table SLA target into a concrete due-time, applied from
 * `from`. This is the single function the rest of the codebase should use so
 * the create endpoint, the sweep, and the risk-alert math always agree.
 */
export function computeDueAt(from: Date, target: SlaTarget): Date {
  const minutes = target.unit === "hours" ? target.amount * 60 : target.amount;
  if (target.clock === "wall") {
    return new Date(from.getTime() + minutes * 60_000);
  }
  return addBusinessMinutes(from, minutes);
}

export function firstResponseDueAt(from: Date, tier: SupportTier, priority: SupportPriority): Date {
  return computeDueAt(from, SLA_TIERS[tier].firstResponse[priority]);
}

export function resolutionDueAt(from: Date, tier: SupportTier, priority: SupportPriority): Date {
  return computeDueAt(from, SLA_TIERS[tier].resolution[priority]);
}
