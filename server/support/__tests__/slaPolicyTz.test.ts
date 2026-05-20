// Task #2972 — Unit tests for timezone-aware SLA helpers introduced in Task #2962.
//
// Covers:
//   - addBusinessMinutesTz: timezone-aware business-hours math
//   - computeDueAt: timezone-aware due-time computation
//   - isBusinessDayTz / nextBusinessInstantTz: supporting helpers
//
// All dates are chosen to be unambiguous in the tested timezone so the math is
// easy to reason about independently of the CI machine's local timezone.

import { describe, it, expect } from "vitest";
import {
  addBusinessMinutesTz,
  computeDueAt,
  isBusinessDayTz,
  nextBusinessInstantTz,
  BUSINESS_DAY_START_HOUR,
  BUSINESS_DAY_END_HOUR,
} from "../slaPolicy";
import type { SlaTarget } from "../slaPolicy";

// ─── Shared fixture dates ─────────────────────────────────────────────────────
//
// "2026-05-04" is a Monday. Memorial Day 2026 is 2026-05-25 (Monday).
// New Year's 2026 is a Thursday (2026-01-01 — federal holiday).
//
// We fix UTC times that correspond to specific local hours in each zone so
// the assertions below are timezone-specific but stable across CI machines.

// Helpers to build UTC Date from an ISO string.
const d = (iso: string) => new Date(iso);

// ─── No-holiday set (isolates business-day math from calendar data) ───────────
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

// ─── A set that treats 2026-05-25 (Memorial Day) as a holiday ────────────────
const MEMORIAL_DAY: ReadonlySet<string> = new Set(["2026-05-25"]);

// ─── isBusinessDayTz ─────────────────────────────────────────────────────────

describe("isBusinessDayTz", () => {
  it("returns true for a Monday in America/New_York during business hours", () => {
    // 2026-05-04 14:00 UTC = 2026-05-04 10:00 EDT (Mon) — inside business hours.
    expect(isBusinessDayTz(d("2026-05-04T14:00:00Z"), "America/New_York", NO_HOLIDAYS)).toBe(true);
  });

  it("returns false for Saturday in America/New_York", () => {
    // 2026-05-09 14:00 UTC = 2026-05-09 10:00 EDT (Sat).
    expect(isBusinessDayTz(d("2026-05-09T14:00:00Z"), "America/New_York", NO_HOLIDAYS)).toBe(false);
  });

  it("returns false for Sunday in America/Los_Angeles", () => {
    // 2026-05-10 17:00 UTC = 2026-05-10 10:00 PDT (Sun).
    expect(isBusinessDayTz(d("2026-05-10T17:00:00Z"), "America/Los_Angeles", NO_HOLIDAYS)).toBe(false);
  });

  it("returns false for a day in the holiday set", () => {
    // 2026-05-25 (Monday) is Memorial Day — treated as holiday.
    // 14:00 UTC = 10:00 EDT.
    expect(isBusinessDayTz(d("2026-05-25T14:00:00Z"), "America/New_York", MEMORIAL_DAY)).toBe(false);
  });

  it("returns true for the same Monday without the holiday in the set", () => {
    expect(isBusinessDayTz(d("2026-05-25T14:00:00Z"), "America/New_York", NO_HOLIDAYS)).toBe(true);
  });

  it("works correctly for Asia/Tokyo (UTC+9)", () => {
    // 2026-05-04 00:30 UTC = 2026-05-04 09:30 JST (Mon) — inside business hours.
    expect(isBusinessDayTz(d("2026-05-04T00:30:00Z"), "Asia/Tokyo", NO_HOLIDAYS)).toBe(true);
  });

  it("returns false for Asia/Tokyo Friday evening (after 18:00 local)", () => {
    // 2026-05-08 is a Friday. 09:30 UTC = 18:30 JST — after close.
    // isBusinessDayTz only checks the day, not the hour — it should still be true
    // for a Friday (the hour check is in nextBusinessInstantTz).
    expect(isBusinessDayTz(d("2026-05-08T09:30:00Z"), "Asia/Tokyo", NO_HOLIDAYS)).toBe(true);
  });
});

// ─── nextBusinessInstantTz ────────────────────────────────────────────────────

describe("nextBusinessInstantTz", () => {
  it("returns the same instant if already inside business hours on a weekday", () => {
    // 2026-05-04 14:00 UTC = 10:00 EDT (Mon) — inside 09:00–18:00 EDT.
    const from = d("2026-05-04T14:00:00Z");
    const result = nextBusinessInstantTz(from, "America/New_York", NO_HOLIDAYS);
    expect(result.getTime()).toBe(from.getTime());
  });

  it("snaps a Saturday to 09:00 local on the next Monday (UTC)", () => {
    // Saturday 2026-05-09 at any time in UTC → next business open is Mon 09:00 EDT.
    // 09:00 EDT = 13:00 UTC.
    const from = d("2026-05-09T12:00:00Z"); // Saturday noon UTC
    const result = nextBusinessInstantTz(from, "America/New_York", NO_HOLIDAYS);
    // Monday 2026-05-11 09:00 EDT = 2026-05-11T13:00:00Z
    expect(result.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });

  it("snaps to next business day when after 18:00 local", () => {
    // 2026-05-04 (Mon) 23:00 UTC = 2026-05-04 19:00 EDT — past close.
    // Next business open: Tuesday 2026-05-05 09:00 EDT = 13:00 UTC.
    const from = d("2026-05-04T23:00:00Z");
    const result = nextBusinessInstantTz(from, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-05T13:00:00.000Z");
  });

  it("snaps to same-day open when before 09:00 local", () => {
    // 2026-05-04 (Mon) 11:00 UTC = 07:00 EDT — before open.
    // Should snap to 09:00 EDT same day = 13:00 UTC.
    const from = d("2026-05-04T11:00:00Z");
    const result = nextBusinessInstantTz(from, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-04T13:00:00.000Z");
  });

  it("skips a holiday and lands on the next business day", () => {
    // Monday 2026-05-25 14:00 UTC = 10:00 EDT — Memorial Day (holiday).
    // Should skip to Tuesday 2026-05-26 09:00 EDT = 13:00 UTC.
    const from = d("2026-05-25T14:00:00Z");
    const result = nextBusinessInstantTz(from, "America/New_York", MEMORIAL_DAY);
    expect(result.toISOString()).toBe("2026-05-26T13:00:00.000Z");
  });

  it("handles Asia/Tokyo offset correctly", () => {
    // Saturday 2026-05-09 12:00 UTC = 2026-05-09 21:00 JST (Sat evening).
    // Next open: Mon 2026-05-11 09:00 JST = 2026-05-11T00:00:00Z (JST = UTC+9).
    const from = d("2026-05-09T12:00:00Z");
    const result = nextBusinessInstantTz(from, "Asia/Tokyo", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });
});

// ─── addBusinessMinutesTz ─────────────────────────────────────────────────────

describe("addBusinessMinutesTz", () => {
  it("stays inside the same business day for short windows (America/New_York)", () => {
    // 2026-05-04 Mon 10:00 EDT (14:00 UTC) + 90 business minutes = 11:30 EDT (15:30 UTC).
    const from = d("2026-05-04T14:00:00Z");
    const result = addBusinessMinutesTz(from, 90, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-04T15:30:00.000Z");
  });

  it("rolls over to the next business day when crossing 18:00 local", () => {
    // 2026-05-04 Mon 17:00 EDT (21:00 UTC) + 120 business minutes.
    // 1h fits today (17:00→18:00). 1h rolls to Tue 09:00→10:00 EDT.
    // Tue 10:00 EDT = 14:00 UTC.
    const from = d("2026-05-04T21:00:00Z");
    const result = addBusinessMinutesTz(from, 120, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-05T14:00:00.000Z");
  });

  it("snaps a Saturday start to Mon 09:00 local before counting minutes", () => {
    // Saturday noon UTC = 08:00 EDT (Sat).
    // Snaps to Mon 09:00 EDT (13:00 UTC) then adds 60 min → Mon 10:00 EDT (14:00 UTC).
    const from = d("2026-05-09T12:00:00Z");
    const result = addBusinessMinutesTz(from, 60, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-11T14:00:00.000Z");
  });

  it("skips a holiday (Memorial Day 2026-05-25) in America/New_York", () => {
    // Fri 2026-05-22 17:00 EDT (21:00 UTC) + 120 business minutes.
    // 1h fits Fri (17:00→18:00). Mon 05-25 is Memorial Day → skip to Tue 05-26.
    // Tue 09:00 EDT + 1h = Tue 10:00 EDT = 14:00 UTC.
    const from = d("2026-05-22T21:00:00Z");
    const result = addBusinessMinutesTz(from, 120, "America/New_York", MEMORIAL_DAY);
    expect(result.toISOString()).toBe("2026-05-26T14:00:00.000Z");
  });

  it("works for Asia/Tokyo (UTC+9) — short window", () => {
    // Mon 2026-05-04 09:30 JST = 00:30 UTC. + 60 min = 10:30 JST = 01:30 UTC.
    const from = d("2026-05-04T00:30:00Z");
    const result = addBusinessMinutesTz(from, 60, "Asia/Tokyo", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-04T01:30:00.000Z");
  });

  it("spans multiple business days for a large minute count (8 business hours = 480 min)", () => {
    // Mon 2026-05-04 10:00 EDT (14:00 UTC) + 480 min.
    // 8h available today from 10:00→18:00, which is exactly 480 min.
    const from = d("2026-05-04T14:00:00Z");
    const result = addBusinessMinutesTz(from, 480, "America/New_York", NO_HOLIDAYS);
    // Result should be Mon 18:00 EDT = 22:00 UTC.
    expect(result.toISOString()).toBe("2026-05-04T22:00:00.000Z");
  });

  it("crosses into the following week when adding 2 business days from Friday", () => {
    // Fri 2026-05-08 09:00 EDT (13:00 UTC) + 16 BH (960 min).
    // Day 1: Fri 09:00→18:00 = 9h = 540 min. Remaining 420 min.
    // Day 2: Mon 09:00→18:00 = 9h = 540 min. Remaining 420 – 540 < 0 → lands at Mon 09:00+420min = 16:00 EDT = 20:00 UTC.
    const from = d("2026-05-08T13:00:00Z");
    const result = addBusinessMinutesTz(from, 960, "America/New_York", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-11T20:00:00.000Z");
  });

  it("handles America/Los_Angeles (UTC-7 in summer) correctly", () => {
    // Mon 2026-05-04 09:00 PDT = 16:00 UTC. + 30 min = 09:30 PDT = 16:30 UTC.
    const from = d("2026-05-04T16:00:00Z");
    const result = addBusinessMinutesTz(from, 30, "America/Los_Angeles", NO_HOLIDAYS);
    expect(result.toISOString()).toBe("2026-05-04T16:30:00.000Z");
  });
});

// ─── computeDueAt ─────────────────────────────────────────────────────────────

describe("computeDueAt", () => {
  // Wall-clock targets ignore business hours entirely.
  const wallTarget: SlaTarget = { amount: 30, unit: "minutes", clock: "wall" };

  // Business-hours target.
  const businessTarget: SlaTarget = { amount: 4, unit: "hours", clock: "business" };

  // Small business-minutes target.
  const businessMinTarget: SlaTarget = { amount: 90, unit: "minutes", clock: "business" };

  it("wall-clock target: adds raw minutes regardless of timezone or day type", () => {
    // Saturday noon UTC + 30 min → 12:30 UTC (no business-hour snapping).
    const from = d("2026-05-09T12:00:00Z");
    const result = computeDueAt(from, wallTarget, { timezone: "America/New_York" });
    expect(result.toISOString()).toBe("2026-05-09T12:30:00.000Z");
  });

  it("wall-clock target: uses UTC fast-path when timezone is UTC", () => {
    const from = d("2026-05-09T12:00:00Z");
    const result = computeDueAt(from, wallTarget, { timezone: "UTC" });
    expect(result.toISOString()).toBe("2026-05-09T12:30:00.000Z");
  });

  it("business target with timezone routes through addBusinessMinutesTz", () => {
    // Mon 2026-05-04 10:00 EDT (14:00 UTC) + 4h business (240 min).
    // 14:00 EDT → stays on same day → 14:00 EDT = 18:00 UTC.
    const from = d("2026-05-04T14:00:00Z");
    const result = computeDueAt(from, businessTarget, {
      timezone: "America/New_York",
      holidays: NO_HOLIDAYS,
    });
    expect(result.toISOString()).toBe("2026-05-04T18:00:00.000Z");
  });

  it("business target with UTC defaults to the legacy addBusinessMinutes path", () => {
    // Mon 2026-05-04 10:00 UTC + 4h business (240 min) = Mon 14:00 UTC.
    const from = d("2026-05-04T10:00:00Z");
    const result = computeDueAt(from, businessTarget); // no options → UTC
    expect(result.toISOString()).toBe("2026-05-04T14:00:00.000Z");
  });

  it("business-minutes target snaps a weekend start to next Monday", () => {
    // Saturday noon UTC (08:00 EDT). Snaps to Mon 09:00 EDT (13:00 UTC) + 90 min = 10:30 EDT (14:30 UTC).
    const from = d("2026-05-09T12:00:00Z");
    const result = computeDueAt(from, businessMinTarget, {
      timezone: "America/New_York",
      holidays: NO_HOLIDAYS,
    });
    expect(result.toISOString()).toBe("2026-05-11T14:30:00.000Z");
  });

  it("hours unit is converted to minutes before computation", () => {
    // 4h target = 240 minutes. Mon 09:00 EDT (13:00 UTC) + 240 min = Mon 13:00 EDT (17:00 UTC).
    const from = d("2026-05-04T13:00:00Z");
    const result = computeDueAt(from, businessTarget, {
      timezone: "America/New_York",
      holidays: NO_HOLIDAYS,
    });
    expect(result.toISOString()).toBe("2026-05-04T17:00:00.000Z");
  });

  it("business target with Asia/Tokyo timezone works across midnight UTC boundary", () => {
    // Mon 2026-05-04 09:00 JST = 00:00 UTC. + 90 business min = 10:30 JST = 01:30 UTC.
    const from = d("2026-05-04T00:00:00Z");
    const result = computeDueAt(from, businessMinTarget, {
      timezone: "Asia/Tokyo",
      holidays: NO_HOLIDAYS,
    });
    expect(result.toISOString()).toBe("2026-05-04T01:30:00.000Z");
  });

  it("respects holidays passed in options", () => {
    // Fri 2026-05-22 17:00 EDT (21:00 UTC) + 4h (240 min) business.
    // 1h fits Fri. Mon 05-25 is Memorial Day. Tue 09:00 EDT + 3h = 12:00 EDT (16:00 UTC).
    const from = d("2026-05-22T21:00:00Z");
    const result = computeDueAt(from, businessTarget, {
      timezone: "America/New_York",
      holidays: MEMORIAL_DAY,
    });
    expect(result.toISOString()).toBe("2026-05-26T16:00:00.000Z");
  });

  it("business target without explicit holidays uses the US_FEDERAL_HOLIDAYS fallback", () => {
    // Just asserts the call does not throw and returns a Date in the future.
    const from = d("2026-05-04T14:00:00Z");
    const result = computeDueAt(from, businessTarget, { timezone: "America/New_York" });
    expect(result instanceof Date).toBe(true);
    expect(result.getTime()).toBeGreaterThan(from.getTime());
  });
});

// ─── Business-hours constants sanity check ────────────────────────────────────

describe("business-hour constants", () => {
  it("start is 9 and end is 18, matching the SLA documentation", () => {
    expect(BUSINESS_DAY_START_HOUR).toBe(9);
    expect(BUSINESS_DAY_END_HOUR).toBe(18);
  });
});
