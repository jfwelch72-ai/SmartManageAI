import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SLA_TIERS,
  addBusinessMinutes,
  firstResponseDueAt,
  resolutionDueAt,
  planTierToSupportTier,
  BUSINESS_DAY_START_HOUR_UTC,
  BUSINESS_DAY_END_HOUR_UTC,
} from "../slaPolicy";
import {
  SLA_TIERS as CANONICAL_SLA_TIERS,
  SUPPORT_TIERS,
  SUPPORT_PRIORITIES,
} from "../../../shared/sla/policy";
import {
  buildTierTableRows,
  formatTarget,
  formatUptime,
  formatChannels,
} from "../../../shared/sla/format";

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

// ─── Task #2680: canonical-source single-source-of-truth assertions ──────────

describe("canonical SLA module is the single source of truth", () => {
  it("server/support/slaPolicy.ts re-exports the canonical SLA_TIERS object", () => {
    // Reference equality, not just deep-equal — guarantees the server
    // hasn't accidentally cloned or shadowed the canonical values.
    expect(SLA_TIERS).toBe(CANONICAL_SLA_TIERS);
  });

  it("every tier defines a target for every priority on both windows", () => {
    for (const tier of SUPPORT_TIERS) {
      for (const priority of SUPPORT_PRIORITIES) {
        const fr = SLA_TIERS[tier].firstResponse[priority];
        const res = SLA_TIERS[tier].resolution[priority];
        expect(fr).toBeDefined();
        expect(res).toBeDefined();
        for (const t of [fr, res]) {
          expect(typeof t.amount).toBe("number");
          expect(t.amount).toBeGreaterThan(0);
          expect(["minutes", "hours"]).toContain(t.unit);
          expect(["wall", "business"]).toContain(t.clock);
        }
      }
    }
  });

  it("every tier carries an uptime %, channels list, and status cadence", () => {
    for (const tier of SUPPORT_TIERS) {
      const p = SLA_TIERS[tier];
      expect(p.uptimeTargetPct).toBeGreaterThan(0);
      expect(p.uptimeTargetPct).toBeLessThanOrEqual(100);
      expect(Array.isArray(p.channels)).toBe(true);
      expect(p.channels.length).toBeGreaterThan(0);
      expect(typeof p.statusUpdateCadence).toBe("string");
      expect(p.statusUpdateCadence.length).toBeGreaterThan(0);
    }
  });
});

describe("formatters produce the published cell strings", () => {
  it("formatUptime trims trailing zeros and keeps the percent sign", () => {
    expect(formatUptime(99.5)).toBe("99.5%");
    expect(formatUptime(99.9)).toBe("99.9%");
    expect(formatUptime(99.95)).toBe("99.95%");
    expect(formatUptime(100)).toBe("100%");
  });

  it("formatTarget renders the exact strings used in docs/sla.md", () => {
    expect(formatTarget(SLA_TIERS.starter.firstResponse.urgent)).toBe("1 business day");
    expect(formatTarget(SLA_TIERS.starter.firstResponse.normal)).toBe("2 business days");
    expect(formatTarget(SLA_TIERS.pro.firstResponse.urgent)).toBe("4 business hours");
    expect(formatTarget(SLA_TIERS.pro.firstResponse.normal)).toBe("1 business day");
    expect(formatTarget(SLA_TIERS.enterprise.firstResponse.urgent)).toBe("30 minutes (24×7)");
    expect(formatTarget(SLA_TIERS.enterprise.firstResponse.normal)).toBe("4 business hours");
    expect(formatTarget(SLA_TIERS.starter.resolution.urgent)).toBe("5 business days");
    expect(formatTarget(SLA_TIERS.pro.resolution.urgent)).toBe("2 calendar days");
    expect(formatTarget(SLA_TIERS.enterprise.resolution.urgent)).toBe("8 hours");
  });

  it("formatChannels joins with ' + '", () => {
    expect(formatChannels(SLA_TIERS.starter.channels)).toBe("In-app + email");
    expect(formatChannels(SLA_TIERS.pro.channels)).toBe("In-app + email + Slack");
    expect(formatChannels(SLA_TIERS.enterprise.channels))
      .toBe("In-app + email + Slack + CSM");
  });
});

describe("docs/sla.md mirrors the canonical tier table", () => {
  it("every published row matches the formatter output", () => {
    const docPath = path.resolve(__dirname, "../../../docs/sla.md");
    const md = readFileSync(docPath, "utf8");
    const rows = buildTierTableRows();
    for (const [label, starter, pro, enterprise] of rows) {
      const expectedRow = `| ${label} | ${starter} | ${pro} | ${enterprise} |`;
      expect(md).toContain(expectedRow);
    }
  });

  it("scripts/check-sla-doc.mjs passes against the committed file", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    // Spawn synchronously; throws (and fails the test) on non-zero exit.
    execFileSync("node", ["scripts/check-sla-doc.mjs"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  });
});

