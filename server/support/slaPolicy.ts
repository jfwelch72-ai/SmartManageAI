// Tiered SLA policy for customer support. Mirrored in `docs/sla.md` and
// `client/src/pages/sla.tsx` so the published commitments and the system
// enforcement never drift apart.
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

export type SupportTier = "starter" | "pro" | "enterprise";
export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SlaClock = "wall" | "business";

export interface SlaTarget {
  /** Minutes (for first-response) or hours (for resolution). */
  amount: number;
  unit: "minutes" | "hours";
  clock: SlaClock;
}

export interface SlaPolicy {
  uptimeTargetPct: number;
  channels: string[];
  firstResponse: Record<SupportPriority, SlaTarget>;
  resolution: Record<SupportPriority, SlaTarget>;
}

const BH = (amount: number, unit: "minutes" | "hours" = "minutes"): SlaTarget => ({
  amount,
  unit,
  clock: "business",
});
const WALL = (amount: number, unit: "minutes" | "hours"): SlaTarget => ({
  amount,
  unit,
  clock: "wall",
});

// Targets are derived directly from docs/sla.md. Any change here must be
// mirrored there (and vice-versa) — the test suite enforces the parity.
export const SLA_TIERS: Record<SupportTier, SlaPolicy> = {
  starter: {
    uptimeTargetPct: 99.5,
    channels: ["in-app help widget", "email"],
    firstResponse: {
      urgent: BH(8 * 60),     // 1 business day
      high: BH(8 * 60),       // 1 business day
      normal: BH(16 * 60),    // 2 business days
      low: BH(24 * 60),       // 3 business days
    },
    resolution: {
      urgent: BH(40, "hours"), // 5 business days
      high: BH(64, "hours"),   // 8 business days
      normal: BH(96, "hours"), // 12 business days
      low: BH(120, "hours"),   // 15 business days
    },
  },
  pro: {
    uptimeTargetPct: 99.9,
    channels: ["in-app help widget", "email", "shared Slack channel"],
    firstResponse: {
      urgent: BH(4 * 60),     // 4 business hours
      high: BH(4 * 60),       // 4 business hours
      normal: BH(8 * 60),     // 1 business day
      low: BH(16 * 60),       // 2 business days
    },
    resolution: {
      urgent: WALL(48, "hours"), // 2 calendar days
      high: WALL(72, "hours"),
      normal: WALL(96, "hours"),
      low: WALL(120, "hours"),
    },
  },
  enterprise: {
    uptimeTargetPct: 99.95,
    channels: ["in-app help widget", "email", "shared Slack channel", "named CSM"],
    firstResponse: {
      urgent: WALL(30, "minutes"), // 30 min, 24×7
      high: BH(60),                // 1 business hour
      normal: BH(4 * 60),          // 4 business hours
      low: BH(8 * 60),             // 1 business day
    },
    resolution: {
      urgent: WALL(8, "hours"),
      high: WALL(16, "hours"),
      normal: WALL(24, "hours"),
      low: WALL(48, "hours"),
    },
  },
};

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
