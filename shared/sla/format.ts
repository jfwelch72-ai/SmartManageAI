// Pure formatters that turn the canonical SLA tier values into the exact
// human-readable strings used in `docs/sla.md` and on the public `/sla`
// page. Kept framework-free so the doc generator (Node script), the
// Express server, and the React client all render the same text.

import type { SlaTarget, SupportTier } from "./policy";
import { SLA_TIERS } from "./policy";

/** "99.5%" / "99.95%" — trims trailing zeros after the decimal point. */
export function formatUptime(pct: number): string {
  // Show up to 2 decimals, drop trailing zeros, never lose the trailing %.
  const s = pct.toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Render a single SLA target cell, e.g.:
 *   - "30 minutes (24×7)"   (wall clock, sub-hour)
 *   - "8 hours"             (wall clock, hours)
 *   - "2 calendar days"     (wall clock, multiple of 24h)
 *   - "4 business hours"    (business clock)
 *   - "1 business day"      (business clock, multiple of an 8h day)
 */
export function formatTarget(t: SlaTarget): string {
  const minutes = t.unit === "hours" ? t.amount * 60 : t.amount;
  if (t.clock === "wall") {
    if (t.unit === "minutes") {
      return `${pluralize(t.amount, "minute", "minutes")} (24×7)`;
    }
    // hours
    if (t.amount % 24 === 0) {
      return pluralize(t.amount / 24, "calendar day", "calendar days");
    }
    return pluralize(t.amount, "hour", "hours");
  }
  // business clock — always reported in business hours, with a business-day
  // alias when the value is a clean multiple of an 8-hour business day.
  const businessHours = minutes / 60;
  if (Number.isInteger(businessHours) && businessHours > 0 && businessHours % 8 === 0) {
    const days = businessHours / 8;
    return pluralize(days, "business day", "business days");
  }
  return pluralize(businessHours, "business hour", "business hours");
}

/** "In-app + email + Slack + CSM" */
export function formatChannels(channels: readonly string[]): string {
  return channels.join(" + ");
}

// ─── doc-table cell helpers ────────────────────────────────────────────────
// Each helper mirrors one row in the `docs/sla.md` "Plan tiers at a glance"
// table and on the public `/sla` page. Keeping them here means the doc
// generator and the React table render the exact same string from the
// exact same canonical input — drift is impossible.

export function tierUptimeCell(tier: SupportTier): string {
  return formatUptime(SLA_TIERS[tier].uptimeTargetPct);
}

export function tierFirstResponseUrgentCell(tier: SupportTier): string {
  return formatTarget(SLA_TIERS[tier].firstResponse.urgent);
}

export function tierFirstResponseNormalCell(tier: SupportTier): string {
  return formatTarget(SLA_TIERS[tier].firstResponse.normal);
}

export function tierResolutionUrgentCell(tier: SupportTier): string {
  return formatTarget(SLA_TIERS[tier].resolution.urgent);
}

export function tierChannelsCell(tier: SupportTier): string {
  return formatChannels(SLA_TIERS[tier].channels);
}

export function tierStatusCadenceCell(tier: SupportTier): string {
  return SLA_TIERS[tier].statusUpdateCadence;
}

/**
 * Returns the "Plan tiers at a glance" table as an array of rows. Each row
 * is `[label, starterCell, proCell, enterpriseCell]`. The order matches
 * the order in `docs/sla.md` and on `/sla`.
 */
export function buildTierTableRows(): Array<[string, string, string, string]> {
  return [
    [
      "Monthly uptime",
      tierUptimeCell("starter"),
      tierUptimeCell("pro"),
      tierUptimeCell("enterprise"),
    ],
    [
      "First response (urgent)",
      tierFirstResponseUrgentCell("starter"),
      tierFirstResponseUrgentCell("pro"),
      tierFirstResponseUrgentCell("enterprise"),
    ],
    [
      "First response (normal)",
      tierFirstResponseNormalCell("starter"),
      tierFirstResponseNormalCell("pro"),
      tierFirstResponseNormalCell("enterprise"),
    ],
    [
      "Target resolution (Sev 1)",
      tierResolutionUrgentCell("starter"),
      tierResolutionUrgentCell("pro"),
      tierResolutionUrgentCell("enterprise"),
    ],
    [
      "Channels",
      tierChannelsCell("starter"),
      tierChannelsCell("pro"),
      tierChannelsCell("enterprise"),
    ],
    [
      "Status updates",
      tierStatusCadenceCell("starter"),
      tierStatusCadenceCell("pro"),
      tierStatusCadenceCell("enterprise"),
    ],
  ];
}
