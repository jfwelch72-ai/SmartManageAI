// SLA enforcement & proactive risk alerts for the customer-support pipeline.
// Both the in-app PATCH/POST endpoints and the background schedulers reuse the
// helpers here so the breach math and "near due" notifications behave the same
// regardless of who triggers them.

import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { supportTickets } from "@shared/schema";
import { sendEmail } from "../email";
import { logError, logInfo } from "../utils/logger";
// (We compute the risk window directly from the persisted due-time minus
// creation, so we don't need to re-resolve the policy here.)

const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL || "support@smartmanageai.local";
const SUPPORT_ALERT_RECIPIENTS = (process.env.SUPPORT_ALERT_RECIPIENTS || SUPPORT_INBOX)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Tickets get a "you're at risk of breaching first-response" warning when they
// pass this fraction of their SLA window without a first response.
const RISK_THRESHOLD = 0.75;

export interface SweepResult {
  firstResponseBreached: number;
  resolutionBreached: number;
}

/**
 * Flip the breach flags on tickets whose SLA due-time has passed without a
 * first response / resolution. Idempotent — only flips rows whose flag is
 * still 0, so it's safe to run on a tight cadence.
 */
export async function runSlaSweep(): Promise<SweepResult> {
  const now = new Date();
  const firstResp = await db
    .update(supportTickets)
    .set({ slaFirstResponseBreached: 1 })
    .where(
      and(
        isNull(supportTickets.firstResponseAt),
        sql`${supportTickets.slaFirstResponseDueAt} < ${now}`,
        eq(supportTickets.slaFirstResponseBreached, 0),
      ),
    )
    .returning({
      id: supportTickets.id,
      subject: supportTickets.subject,
      tier: supportTickets.tier,
      organizationId: supportTickets.organizationId,
    });

  const resolution = await db
    .update(supportTickets)
    .set({ slaResolutionBreached: 1 })
    .where(
      and(
        isNull(supportTickets.resolvedAt),
        sql`${supportTickets.slaResolutionDueAt} < ${now}`,
        eq(supportTickets.slaResolutionBreached, 0),
      ),
    )
    .returning({
      id: supportTickets.id,
      subject: supportTickets.subject,
      tier: supportTickets.tier,
    });

  if (firstResp.length || resolution.length) {
    const lines = [
      firstResp.length ? `First-response SLA breached on ${firstResp.length} ticket(s):` : null,
      ...firstResp.map((r) => `  • [${r.tier}] ${r.id} — ${r.subject}`),
      resolution.length ? `Resolution SLA breached on ${resolution.length} ticket(s):` : null,
      ...resolution.map((r) => `  • [${r.tier}] ${r.id} — ${r.subject}`),
    ].filter(Boolean) as string[];
    void sendEmail({
      to: SUPPORT_ALERT_RECIPIENTS,
      subject: `[Support][SLA breach] ${firstResp.length + resolution.length} ticket(s) past due`,
      text: lines.join("\n"),
    }).catch((err) => logError("[support-sla] breach alert email failed", err));
    logInfo(
      `[support-sla] sweep flipped ${firstResp.length} first-response and ${resolution.length} resolution breach(es)`,
    );
  }

  return { firstResponseBreached: firstResp.length, resolutionBreached: resolution.length };
}

/**
 * Email the support inbox once per ticket when the first-response SLA window
 * is ≥75% consumed and no first response has happened yet. Stores a marker
 * in `metadata.slaRiskAlertAt` so we don't spam the inbox.
 */
export async function runSlaRiskAlerts(): Promise<{ alerted: number }> {
  const now = new Date();
  const candidates = await db
    .select()
    .from(supportTickets)
    .where(
      and(
        isNull(supportTickets.firstResponseAt),
        eq(supportTickets.slaFirstResponseBreached, 0),
        gt(supportTickets.slaFirstResponseDueAt, now),
      ),
    );

  let alerted = 0;
  for (const t of candidates) {
    if (!t.slaFirstResponseDueAt) continue;
    // Use the persisted due-time minus creation as the authoritative window.
    // This is calendar-clock by design (it's an at-risk warning, not the SLA
    // decision itself) and matches business-hours due-times correctly because
    // they were computed at create-time.
    const totalWindowMs = t.slaFirstResponseDueAt.getTime() - t.createdAt.getTime();
    if (totalWindowMs <= 0) continue;
    const elapsedMs = now.getTime() - t.createdAt.getTime();
    if (elapsedMs / totalWindowMs < RISK_THRESHOLD) continue;

    const meta = (t.metadata as Record<string, unknown>) || {};
    if (meta.slaRiskAlertAt) continue;

    void sendEmail({
      to: SUPPORT_ALERT_RECIPIENTS,
      subject: `[Support][SLA at risk] ${t.subject}`,
      text:
        `Ticket ${t.id} is at ${Math.round((elapsedMs / totalWindowMs) * 100)}% of its first-response SLA window with no response yet.\n` +
        `Tier: ${t.tier}  Priority: ${t.priority}\nDue: ${t.slaFirstResponseDueAt.toISOString()}\nFrom: ${t.submitterEmail}`,
    }).catch((err) => logError("[support-sla] risk alert email failed", err));

    await db
      .update(supportTickets)
      .set({ metadata: { ...meta, slaRiskAlertAt: now.toISOString() } })
      .where(eq(supportTickets.id, t.id));

    alerted += 1;
  }

  if (alerted > 0) {
    logInfo(`[support-sla] sent ${alerted} first-response risk alert(s)`);
  }
  return { alerted };
}
