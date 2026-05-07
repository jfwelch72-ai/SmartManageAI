import { describe, it, expect } from "vitest";
import {
  SLA_TIERS,
  addBusinessMinutes,
  firstResponseDueAt,
  resolutionDueAt,
  planTierToSupportTier,
  BUSINESS_DAY_START_HOUR_UTC,
  BUSINESS_DAY_END_HOUR_UTC,
} from "../slaPolicy";

// All anchor dates are chosen on regular Mon–Fri working days that are NOT
// US federal holidays, so the math is easy to reason about.
const MON_10AM = new Date("2026-05-04T10:00:00Z"); // Monday
const FRI_5PM = new Date("2026-05-08T17:00:00Z"); // Friday, 1h before close
const SAT_NOON = new Date("2026-05-09T12:00:00Z"); // Saturday

describe("planTierToSupportTier", () => {
  it("maps free + starter to starter, professional to pro, enterprise to enterprise", () => {
    expect(planTierToSupportTier("free")).toBe("starter");
    expect(planTierToSupportTier("starter")).toBe("starter");
    expect(planTierToSupportTier("professional")).toBe("pro");
    expect(planTierToSupportTier("enterprise")).toBe("enterprise");
    expect(planTierToSupportTier(null)).toBe("starter");
    expect(planTierToSupportTier(undefined)).toBe("starter");
  });
});

describe("addBusinessMinutes", () => {
  it("stays inside the same business day for short windows", () => {
    const out = addBusinessMinutes(MON_10AM, 90);
    expect(out.toISOString()).toBe("2026-05-04T11:30:00.000Z");
  });

  it("rolls over to the next business day at 09:00 UTC when it crosses 18:00", () => {
    // 17:00 UTC + 2h business = 18:00 today (1h) + 09:00 next day + 1h = 10:00 next day
    const out = addBusinessMinutes(FRI_5PM, 120);
    // Friday close is 18:00, so 1h fits today; remaining 1h lands on Monday 10:00.
    expect(out.toISOString()).toBe("2026-05-11T10:00:00.000Z");
  });

  it("snaps a weekend start onto Monday 09:00 UTC", () => {
    const out = addBusinessMinutes(SAT_NOON, 60);
    // Saturday → Monday 09:00 + 1 hour = Monday 10:00 UTC.
    expect(out.toISOString()).toBe("2026-05-11T10:00:00.000Z");
  });

  it("skips US federal holidays (Memorial Day 2026-05-25)", () => {
    const fri = new Date("2026-05-22T17:00:00Z"); // Friday before Memorial Day
    // 1h fits Friday, then Mon 5/25 is a holiday → should land on Tue 5/26.
    const out = addBusinessMinutes(fri, 120);
    expect(out.toISOString()).toBe("2026-05-26T10:00:00.000Z");
  });
});

describe("priority-aware first-response targets match docs/sla.md", () => {
  it("Enterprise urgent is 30 minutes wall-clock and respects 24×7", () => {
    const target = SLA_TIERS.enterprise.firstResponse.urgent;
    expect(target.amount).toBe(30);
    expect(target.unit).toBe("minutes");
    expect(target.clock).toBe("wall");
    // Saturday noon + 30 min → Saturday 12:30 (24×7, no business-hour snap).
    const due = firstResponseDueAt(SAT_NOON, "enterprise", "urgent");
    expect(due.toISOString()).toBe("2026-05-09T12:30:00.000Z");
  });

  it("Pro urgent is 4 business hours and skips weekends", () => {
    const target = SLA_TIERS.pro.firstResponse.urgent;
    expect(target.amount).toBe(4 * 60);
    expect(target.clock).toBe("business");
    // Saturday noon → Monday 09:00 + 4 BH = Monday 13:00.
    const due = firstResponseDueAt(SAT_NOON, "pro", "urgent");
    expect(due.toISOString()).toBe("2026-05-11T13:00:00.000Z");
  });

  it("Starter urgent is 1 business day and Starter normal is 2 business days", () => {
    expect(SLA_TIERS.starter.firstResponse.urgent.amount).toBe(8 * 60);
    expect(SLA_TIERS.starter.firstResponse.normal.amount).toBe(16 * 60);
    // Mon 10:00 + 8 BH lands exactly at Mon 18:00 (today's close).
    expect(firstResponseDueAt(MON_10AM, "starter", "urgent").toISOString())
      .toBe("2026-05-04T18:00:00.000Z");
    // Mon 10:00 + 16 BH = 8h today (→ Mon 18:00) + 8h tomorrow (→ Tue 17:00).
    expect(firstResponseDueAt(MON_10AM, "starter", "normal").toISOString())
      .toBe("2026-05-05T17:00:00.000Z");
  });

  it("urgent is always tighter than normal across every tier", () => {
    for (const tier of ["starter", "pro", "enterprise"] as const) {
      const urgent = SLA_TIERS[tier].firstResponse.urgent;
      const normal = SLA_TIERS[tier].firstResponse.normal;
      const urgentMin = urgent.unit === "hours" ? urgent.amount * 60 : urgent.amount;
      const normalMin = normal.unit === "hours" ? normal.amount * 60 : normal.amount;
      expect(urgentMin).toBeLessThanOrEqual(normalMin);
    }
  });
});

describe("resolution targets", () => {
  it("Pro Sev1 resolution is 2 calendar days (wall-clock)", () => {
    const target = SLA_TIERS.pro.resolution.urgent;
    expect(target.amount).toBe(48);
    expect(target.clock).toBe("wall");
    const due = resolutionDueAt(SAT_NOON, "pro", "urgent");
    // Wall-clock: Saturday noon + 48h = Monday noon.
    expect(due.toISOString()).toBe("2026-05-11T12:00:00.000Z");
  });

  it("Enterprise Sev1 resolution is 8 hours wall-clock", () => {
    const target = SLA_TIERS.enterprise.resolution.urgent;
    expect(target.amount).toBe(8);
    expect(target.clock).toBe("wall");
  });

  it("Starter Sev1 resolution is 5 business days (40 BH)", () => {
    const target = SLA_TIERS.starter.resolution.urgent;
    expect(target.amount).toBe(40);
    expect(target.clock).toBe("business");
  });
});

describe("business-hour window constants", () => {
  it("are 09:00–18:00 UTC as documented", () => {
    expect(BUSINESS_DAY_START_HOUR_UTC).toBe(9);
    expect(BUSINESS_DAY_END_HOUR_UTC).toBe(18);
  });
});
