import { db } from "../db";
import { crmStageSlas, crmOpportunities, notifications } from "@shared/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";

export async function checkAndFlagSlaBreaches(now: Date = new Date(), scopeOrgId?: string): Promise<{ flagged: number }> {
  const slas = scopeOrgId
    ? await db.select().from(crmStageSlas).where(eq(crmStageSlas.organizationId, scopeOrgId))
    : await db.select().from(crmStageSlas);
  if (slas.length === 0) return { flagged: 0 };

  let flagged = 0;
  for (const sla of slas) {
    try {
      const cutoff = new Date(now.getTime() - sla.maxDaysInStage * 24 * 60 * 60 * 1000);
      const breached = await db.select().from(crmOpportunities).where(and(
        eq(crmOpportunities.organizationId, sla.organizationId),
        eq(crmOpportunities.stage, sla.stage),
        lt(crmOpportunities.stageEnteredAt, cutoff),
        isNull(crmOpportunities.slaBreachedAt),
        isNull(crmOpportunities.wonAt),
        isNull(crmOpportunities.lostAt),
      ));
      for (const opp of breached) {
        await db.update(crmOpportunities).set({
          slaBreachedAt: now,
          needsAttentionReason: `Stage "${sla.stage}" exceeded SLA of ${sla.maxDaysInStage} days`,
        }).where(eq(crmOpportunities.id, opp.id));
        flagged++;

        if (sla.notifyAssignee && opp.assignedToId) {
          try {
            await db.insert(notifications).values({
              userId: opp.assignedToId,
              organizationId: opp.organizationId,
              type: "CRM_SLA_BREACH",
              title: "Deal needs attention",
              message: `"${opp.name}" has been in ${sla.stage} for more than ${sla.maxDaysInStage} days`,
              relatedEntityId: opp.id,
              relatedEntityType: "CRM_OPPORTUNITY",
            } as any);
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      logError("SLA check failed for stage", { stage: sla.stage, orgId: sla.organizationId }, e as Error);
    }
  }
  if (flagged > 0) logInfo("CRM SLA breaches flagged", { flagged });
  return { flagged };
}
