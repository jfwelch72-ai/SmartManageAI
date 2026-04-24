// Task #1749 — unit tests for the "Next digest:" preview helpers
// rendered on the failures-digest schedule card. Locks in the hour /
// weekday / OFF / timezone gating so future tweaks don't quietly
// drift away from the server-side fan-out (`processProjectLog
// EmailFailuresDigest` in server/jobs/jobRunner.ts).
import { describe, it, expect } from "vitest";
import {
  computeNextFailuresDigestFire,
  formatNextFailuresDigestFire,
} from "../failuresDigestSchedule";

describe("computeNextFailuresDigestFire", () => {
  it("returns null when cadence is OFF", () => {
    const now = new Date("2026-04-24T13:30:00Z");
    expect(
      computeNextFailuresDigestFire({
        cadence: "OFF",
        weekday: 1,
        hour: 8,
        timezone: "America/New_York",
        now,
      }),
    ).toBeNull();
  });

  it("DAILY: returns later same-day fire when 'now' is before the firing hour", () => {
    // 4/24/2026 = Friday. 10:00 UTC == 06:00 EDT. Digest fires at 8 AM EDT.
    const now = new Date("2026-04-24T10:00:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "DAILY",
      weekday: 1,
      hour: 8,
      timezone: "America/New_York",
      now,
    });
    expect(next?.toISOString()).toBe("2026-04-24T12:00:00.000Z"); // 8 AM EDT
  });

  it("DAILY: rolls to next day when 'now' is past the firing hour", () => {
    // 13:30 UTC == 09:30 EDT, past the 8 AM digest.
    const now = new Date("2026-04-24T13:30:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "DAILY",
      weekday: 1,
      hour: 8,
      timezone: "America/New_York",
      now,
    });
    expect(next?.toISOString()).toBe("2026-04-25T12:00:00.000Z");
  });

  it("WEEKLY: skips ahead to the configured weekday", () => {
    // Friday 9:30 AM EDT → next Monday 8 AM EDT.
    const now = new Date("2026-04-24T13:30:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "WEEKLY",
      weekday: 1, // Monday
      hour: 8,
      timezone: "America/New_York",
      now,
    });
    expect(next?.toISOString()).toBe("2026-04-27T12:00:00.000Z");
  });

  it("works in non-server timezones (Tokyo)", () => {
    // Friday 13:30 UTC == Saturday 04:30 in Tokyo.
    // WEEKLY Saturday 14:00 Tokyo == Saturday 05:00 UTC.
    const now = new Date("2026-04-24T13:30:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "WEEKLY",
      weekday: 6,
      hour: 14,
      timezone: "Asia/Tokyo",
      now,
    });
    expect(next?.toISOString()).toBe("2026-04-25T05:00:00.000Z");
  });

  it("returns null for an invalid IANA timezone string (form will show 'Unable to compute')", () => {
    // The timezone <Select> only allows values from COMMON_TIMEZONES,
    // so this branch is realistically unreachable from the UI, but
    // the helper guards against bad input by returning null rather
    // than throwing — the card then renders the "Unable to compute"
    // fallback copy.
    const now = new Date("2026-04-24T13:30:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "DAILY",
      weekday: 1,
      hour: 8,
      timezone: "Not/A/Real_Zone",
      now,
    });
    expect(next).toBeNull();
  });

  it("at exactly the top of the firing hour, advances to the next occurrence", () => {
    // The cron job either just fired or is firing right now; surfacing
    // the *next* future occurrence avoids showing a time that has
    // already elapsed.
    const now = new Date("2026-04-24T13:00:00Z");
    const next = computeNextFailuresDigestFire({
      cadence: "DAILY",
      weekday: 1,
      hour: 13,
      timezone: "UTC",
      now,
    });
    expect(next?.toISOString()).toBe("2026-04-25T13:00:00.000Z");
  });
});

describe("formatNextFailuresDigestFire", () => {
  it("includes the timezone abbreviation so admins in non-server zones can verify", () => {
    const date = new Date("2026-04-27T12:00:00Z"); // Monday 8 AM EDT
    const label = formatNextFailuresDigestFire(date, "America/New_York");
    expect(label).toMatch(/Mon/);
    expect(label).toMatch(/Apr 27/);
    expect(label).toMatch(/8:00\s?AM/);
    expect(label).toMatch(/EDT/);
  });

  it("renders UTC as UTC", () => {
    const date = new Date("2026-04-27T08:00:00Z");
    const label = formatNextFailuresDigestFire(date, "UTC");
    expect(label).toMatch(/UTC/);
    expect(label).toMatch(/8:00\s?AM/);
  });
});
