// SLA enforcement & proactive risk alerts for the customer-support pipeline.
// Both the in-app PATCH/POST endpoints and the background schedulers reuse the
// helpers here so the breach math and "near due" notifications behave the same
// regardless of who triggers them.
//
// Task #2962 additions:
//   - runSlaRiskAlerts now reads per-org support_settings:
//       • Uses org's escalationThresholdPct (default 75%) instead of the global constant.
//       • Bumps ticket priority one level when the threshold is crossed.
//       • Notifies org-configured escalationEmails in addition to the global inbox.
//       • Writes an ESCALATE row to audit_log.
//   - runAutoAssign: hourly sweep that distributes unassigned tickets round-robin
//     across eligible agents (ADMIN or SUPER_ADMIN in the same org), with
//     enterprise tickets preferring enterpriseAgentIds first.

import { and, eq, gt, isNull, lte, sql, inArray, lt, or } from "drizzle-orm";
import { db } from "../db";
import { supportTickets, supportSettings, users } from "@shared/schema";
import { sendEmail } from "../email";
import { logError, logInfo } from "../utils/logger";
import { logSystemAudit } from "../auditLogger";
import type { InsertAuditLog } from "@shared/schema";

const SUPPORT_INBOX = process.env.SUPPORT_INBOX_EMAIL || "support@smartmanageai.local";
const SUPPORT_ALERT_RECIPIENTS = (process.env.SUPPORT_ALERT_RECIPIENTS || SUPPORT_INBOX)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PRIORITY_BUMP: Record<string, string | undefined> = {
  low: "normal",
  normal: "high",
  high: "urgent",
  // "urgent" is already the highest — no bump
};

// ─── Breach sweep ─────────────────────────────────────────────────────────────

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

// ─── Risk alerts + escalation ─────────────────────────────────────────────────

/**
 * Email the support inbox once per ticket when the first-response SLA window
 * is ≥ (org's escalationThresholdPct)% consumed and no first response has
 * happened yet.
 *
 * When the threshold is crossed:
 *   1. Priority is bumped one level (low→normal→high→urgent).
 *   2. The org's escalationEmails list is notified (in addition to the global inbox).
 *   3. An ESCALATE row is written to audit_log.
 *
 * Stores a marker in `metadata.slaRiskAlertAt` so each ticket is only
 * escalated once.
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

  if (candidates.length === 0) return { alerted: 0 };

  // Batch-fetch support settings for all distinct org IDs in candidates.
  const orgIds = [...new Set(candidates.map((t) => t.organizationId).filter(Boolean))] as string[];
  const orgSettingsRows =
    orgIds.length > 0
      ? await db
          .select()
          .from(supportSettings)
          .where(inArray(supportSettings.organizationId, orgIds))
      : [];

  const settingsByOrg = new Map(orgSettingsRows.map((s) => [s.organizationId, s]));

  let alerted = 0;
  for (const t of candidates) {
    if (!t.slaFirstResponseDueAt) continue;

    const orgSettings = t.organizationId ? settingsByOrg.get(t.organizationId) : undefined;
    const thresholdPct = orgSettings?.escalationThresholdPct ?? 75;
    const escalationEmails: string[] = (orgSettings?.escalationEmails ?? []).filter(Boolean);

    const totalWindowMs = t.slaFirstResponseDueAt.getTime() - t.createdAt.getTime();
    if (totalWindowMs <= 0) continue;
    const elapsedMs = now.getTime() - t.createdAt.getTime();
    const pct = elapsedMs / totalWindowMs;
    if (pct * 100 < thresholdPct) continue;

    const meta = (t.metadata as Record<string, unknown>) || {};
    if (meta.slaRiskAlertAt) continue; // already escalated

    const pctLabel = Math.round(pct * 100);

    // 1. Bump priority one level (idempotent if already urgent).
    const newPriority = PRIORITY_BUMP[t.priority] ?? t.priority;
    const priorityBumped = newPriority !== t.priority;

    // 2. Send alert emails — global inbox + org escalation addresses.
    const recipients = [...new Set([...SUPPORT_ALERT_RECIPIENTS, ...escalationEmails])];
    void sendEmail({
      to: recipients,
      subject: `[Support][SLA at risk${priorityBumped ? " — escalated" : ""}] ${t.subject}`,
      text:
        `Ticket ${t.id} is at ${pctLabel}% of its first-response SLA window with no response yet.\n` +
        `Tier: ${t.tier}  Priority: ${t.priority}${priorityBumped ? ` → ${newPriority}` : ""}\n` +
        `Due: ${t.slaFirstResponseDueAt.toISOString()}\n` +
        `From: ${t.submitterEmail}\n` +
        (priorityBumped ? `\nPriority has been automatically elevated to: ${newPriority}\n` : "") +
        (escalationEmails.length > 0
          ? `Escalation contacts notified: ${escalationEmails.join(", ")}\n`
          : ""),
    }).catch((err) => logError("[support-sla] risk alert email failed", err));

    // 3. Persist the escalation: bump priority + mark metadata.
    const updatedMeta: Record<string, unknown> = {
      ...meta,
      slaRiskAlertAt: now.toISOString(),
    };
    if (priorityBumped) {
      updatedMeta.escalatedFromPriority = t.priority;
      updatedMeta.escalatedAt = now.toISOString();
    }

    await db
      .update(supportTickets)
      .set({
        metadata: updatedMeta,
        ...(priorityBumped ? { priority: newPriority as typeof t.priority } : {}),
        updatedAt: now,
      })
      .where(eq(supportTickets.id, t.id));

    // 4. Write ESCALATE audit row (system-initiated — no human actor).
    if (priorityBumped) {
      void logSystemAudit({
        entityType: "support_ticket",
        entityId: t.id,
        action: "ESCALATE" as InsertAuditLog["action"],
        oldValue: JSON.stringify({ priority: t.priority }),
        newValue: JSON.stringify({
          priority: newPriority,
          reason: `SLA window ${pctLabel}% consumed without first response`,
          thresholdPct,
          organizationId: t.organizationId,
        }),
      });
    }

    alerted += 1;
  }

  if (alerted > 0) {
    logInfo(`[support-sla] sent ${alerted} first-response risk alert(s) (with escalations)`);
  }
  return { alerted };
}

// ─── Auto-assignment ──────────────────────────────────────────────────────────

export interface AutoAssignResult {
  assigned: number;
}

/**
 * Distribute unassigned open tickets round-robin across available agents.
 *
 * Eligibility:
 *   - Ticket is open or in_progress, has no assignedTo, and has been open for
 *     at least the org's `autoAssignGraceMinutes` (default 60).
 *   - "Available agents" = ADMIN or SUPER_ADMIN users in the same org.
 *   - Enterprise tickets check the org's `enterpriseAgentIds` list first.
 *     If that list has no eligible users, falls back to all agents.
 *
 * Round-robin strategy: sort eligible agent IDs alphabetically, then assign
 * round-robin based on (current assignment count mod pool size). This is
 * stateless and converges to balanced load over time.
 *
 * Each assignment is logged to audit_log with action=AUTO_ASSIGN.
 */
export async function runAutoAssign(): Promise<AutoAssignResult> {
  const now = new Date();

  // Fetch tickets that are open/in_progress, unassigned, and past their
  // grace window. We fetch a broad set and apply per-org grace minutes below.
  const candidateTickets = await db
    .select()
    .from(supportTickets)
    .where(
      and(
        or(
          eq(supportTickets.status, "open"),
          eq(supportTickets.status, "in_progress"),
        ),
        isNull(supportTickets.assignedTo),
        // Minimum possible grace: even if grace is 0, we only touch tickets
        // older than 1 minute to avoid double-assigning newly created ones.
        sql`${supportTickets.createdAt} < ${new Date(now.getTime() - 60_000)}`,
      ),
    );

  if (candidateTickets.length === 0) return { assigned: 0 };

  // Batch-fetch support settings for all distinct orgs.
  const orgIds = [...new Set(candidateTickets.map((t) => t.organizationId).filter(Boolean))] as string[];
  const orgSettingsRows =
    orgIds.length > 0
      ? await db.select().from(supportSettings).where(inArray(supportSettings.organizationId, orgIds))
      : [];
  const settingsByOrg = new Map(orgSettingsRows.map((s) => [s.organizationId, s]));

  // Batch-fetch ADMIN + SUPER_ADMIN users for all candidate orgs.
  const agentRows =
    orgIds.length > 0
      ? await db
          .select({ id: users.id, organizationId: users.organizationId, role: users.role })
          .from(users)
          .where(
            and(
              inArray(users.organizationId, orgIds),
              inArray(users.role, ["ADMIN", "SUPER_ADMIN"]),
              eq(users.isActive, true),
            ),
          )
      : [];

  // Map orgId → sorted agent ID list.
  const agentsByOrg = new Map<string, string[]>();
  for (const a of agentRows) {
    if (!a.organizationId) continue;
    const list = agentsByOrg.get(a.organizationId) ?? [];
    list.push(a.id);
    agentsByOrg.set(a.organizationId, list);
  }
  // Sort agent lists for deterministic round-robin ordering.
  for (const [orgId, ids] of agentsByOrg) {
    agentsByOrg.set(orgId, ids.sort());
  }

  // Track per-agent assignment counts within this run for fair distribution.
  const assignmentCount = new Map<string, number>();

  let assigned = 0;
  for (const ticket of candidateTickets) {
    if (!ticket.organizationId) continue;

    const orgSettings = settingsByOrg.get(ticket.organizationId);
    const graceMinutes = orgSettings?.autoAssignGraceMinutes ?? 60;

    // Skip if still within the grace window.
    const ageMinutes = (now.getTime() - ticket.createdAt.getTime()) / 60_000;
    if (ageMinutes < graceMinutes) continue;

    // Determine eligible agent pool.
    let agentPool: string[] = agentsByOrg.get(ticket.organizationId) ?? [];

    // For enterprise tickets, prefer the configured enterprise agent IDs.
    if (ticket.tier === "enterprise" && orgSettings?.enterpriseAgentIds?.length) {
      const enterprisePool = (orgSettings.enterpriseAgentIds as string[]).filter((id) =>
        agentPool.includes(id),
      );
      if (enterprisePool.length > 0) {
        agentPool = enterprisePool.sort();
      }
    }

    if (agentPool.length === 0) continue;

    // Pick the agent with the fewest assignments so far in this run.
    const picked = agentPool.reduce((best, id) => {
      const countBest = assignmentCount.get(best) ?? 0;
      const countId = assignmentCount.get(id) ?? 0;
      return countId < countBest ? id : best;
    });

    assignmentCount.set(picked, (assignmentCount.get(picked) ?? 0) + 1);

    await db
      .update(supportTickets)
      .set({ assignedTo: picked, updatedAt: now })
      .where(eq(supportTickets.id, ticket.id));

    void logSystemAudit({
      entityType: "support_ticket",
      entityId: ticket.id,
      action: "AUTO_ASSIGN" as InsertAuditLog["action"],
      oldValue: null,
      newValue: JSON.stringify({
        assignedTo: picked,
        tier: ticket.tier,
        organizationId: ticket.organizationId,
        ageMinutes: Math.round(ageMinutes),
        graceMinutes,
      }),
    });

    assigned += 1;
  }

  if (assigned > 0) {
    logInfo(`[support-sla] auto-assigned ${assigned} ticket(s)`);
  }
  return { assigned };
}
