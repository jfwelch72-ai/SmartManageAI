import { logError } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { getOrgId, getUserOrThrow } from "./utils/routeHelpers";
import { db } from "./db";
import { retentionPolicies, auditLog, messages, timeEntries, media, aiActionAudit, planDocuments, conversations, projects, users, isSupportedRetentionPolicyCombo } from "@shared/schema";
import { eq, and, lt, sql, desc, isNotNull, or, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { logAudit } from "./auditLogger";

// Task #1572 — shared per-tenant predicates + count/mutation helpers
// for the on-demand /preview and /execute endpoints. These mirror the
// branches in `processRetentionPolicies` (server/jobs/jobRunner.ts) so
// dry-run counts always match the rows the nightly sweep would touch.
// Every helper is scoped to `orgId` so admins in one org cannot see
// or mutate other tenants' data through this surface.
function orgProjectIdsSubquery(orgId: string) {
  return db.select({ id: projects.id })
    .from(projects)
    .where(eq(projects.gcOrganizationId, orgId));
}
function orgConversationIdsSubquery(orgId: string) {
  return db.select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.organizationId, orgId));
}
function orgUserIdsSubquery(orgId: string) {
  return db.select({ id: users.id })
    .from(users)
    .where(eq(users.organizationId, orgId));
}

// Drizzle's `and(...)` helper returns a typed `SQL | undefined`; we
// accept the same shape here so each branch can build its predicate
// using the table's own column references without any casts.
type SqlCondition = ReturnType<typeof and>;
async function runCount(table: PgTable, where: SqlCondition): Promise<number> {
  const r = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return r[0]?.count || 0;
}

async function countRetentionAffected(
  orgId: string,
  entityType: string,
  action: string,
  cutoff: Date,
): Promise<number> {
  if (entityType === "AUDIT_LOGS" && action === "DELETE") {
    return runCount(auditLog, and(
      lt(auditLog.createdAt, cutoff),
      inArray(auditLog.userId, orgUserIdsSubquery(orgId)),
    ));
  }
  if (entityType === "AI_ACTIONS" && action === "DELETE") {
    return runCount(aiActionAudit, and(
      eq(aiActionAudit.organizationId, orgId),
      lt(aiActionAudit.createdAt, cutoff),
    ));
  }
  if (entityType === "AI_ACTIONS" && action === "ANONYMIZE") {
    // Mirror jobRunner.ts: any redactable field non-null qualifies a
    // row for anonymization, so `actorUserId IS NULL` rows that still
    // hold rationale / refs / approver are also scrubbed.
    return runCount(aiActionAudit, and(
      eq(aiActionAudit.organizationId, orgId),
      lt(aiActionAudit.createdAt, cutoff),
      or(
        isNotNull(aiActionAudit.actorUserId),
        isNotNull(aiActionAudit.rationale),
        isNotNull(aiActionAudit.inputRefs),
        isNotNull(aiActionAudit.outputRefs),
        isNotNull(aiActionAudit.approvedByUserId),
      ),
    ));
  }
  if (entityType === "DOCUMENTS" && action === "DELETE") {
    return runCount(planDocuments, and(
      eq(planDocuments.organizationId, orgId),
      lt(planDocuments.uploadedAt, cutoff),
    ));
  }
  if (entityType === "TIME_ENTRIES" && action === "DELETE") {
    return runCount(timeEntries, and(
      lt(timeEntries.createdAt, cutoff),
      inArray(timeEntries.projectId, orgProjectIdsSubquery(orgId)),
    ));
  }
  if (entityType === "TIME_ENTRIES" && action === "ANONYMIZE") {
    return runCount(timeEntries, and(
      lt(timeEntries.createdAt, cutoff),
      inArray(timeEntries.projectId, orgProjectIdsSubquery(orgId)),
      or(isNotNull(timeEntries.notes), isNotNull(timeEntries.rejectionReason)),
    ));
  }
  if (entityType === "MESSAGES" && action === "DELETE") {
    return runCount(messages, and(
      lt(messages.createdAt, cutoff),
      inArray(messages.conversationId, orgConversationIdsSubquery(orgId)),
    ));
  }
  if (entityType === "MESSAGES" && action === "ANONYMIZE") {
    return runCount(messages, and(
      lt(messages.createdAt, cutoff),
      eq(messages.isDeleted, false),
      inArray(messages.conversationId, orgConversationIdsSubquery(orgId)),
    ));
  }
  if (entityType === "FILE_UPLOADS" && action === "DELETE") {
    return runCount(media, and(
      lt(media.uploadedAt, cutoff),
      inArray(media.projectId, orgProjectIdsSubquery(orgId)),
    ));
  }
  return 0;
}

async function executeRetentionMutation(
  orgId: string,
  entityType: string,
  action: string,
  cutoff: Date,
): Promise<void> {
  if (entityType === "AUDIT_LOGS" && action === "DELETE") {
    await db.delete(auditLog).where(and(
      lt(auditLog.createdAt, cutoff),
      inArray(auditLog.userId, orgUserIdsSubquery(orgId)),
    ));
  } else if (entityType === "AI_ACTIONS" && action === "DELETE") {
    await db.delete(aiActionAudit).where(and(
      eq(aiActionAudit.organizationId, orgId),
      lt(aiActionAudit.createdAt, cutoff),
    ));
  } else if (entityType === "AI_ACTIONS" && action === "ANONYMIZE") {
    await db.update(aiActionAudit)
      .set({ actorUserId: null, rationale: null, inputRefs: null, outputRefs: null, approvedByUserId: null })
      .where(and(
        eq(aiActionAudit.organizationId, orgId),
        lt(aiActionAudit.createdAt, cutoff),
        or(
          isNotNull(aiActionAudit.actorUserId),
          isNotNull(aiActionAudit.rationale),
          isNotNull(aiActionAudit.inputRefs),
          isNotNull(aiActionAudit.outputRefs),
          isNotNull(aiActionAudit.approvedByUserId),
        ),
      ));
  } else if (entityType === "DOCUMENTS" && action === "DELETE") {
    await db.delete(planDocuments).where(and(
      eq(planDocuments.organizationId, orgId),
      lt(planDocuments.uploadedAt, cutoff),
    ));
  } else if (entityType === "TIME_ENTRIES" && action === "DELETE") {
    await db.delete(timeEntries).where(and(
      lt(timeEntries.createdAt, cutoff),
      inArray(timeEntries.projectId, orgProjectIdsSubquery(orgId)),
    ));
  } else if (entityType === "TIME_ENTRIES" && action === "ANONYMIZE") {
    await db.update(timeEntries)
      .set({ notes: null, rejectionReason: null, updatedAt: new Date() })
      .where(and(
        lt(timeEntries.createdAt, cutoff),
        inArray(timeEntries.projectId, orgProjectIdsSubquery(orgId)),
        or(isNotNull(timeEntries.notes), isNotNull(timeEntries.rejectionReason)),
      ));
  } else if (entityType === "MESSAGES" && action === "DELETE") {
    await db.delete(messages).where(and(
      lt(messages.createdAt, cutoff),
      inArray(messages.conversationId, orgConversationIdsSubquery(orgId)),
    ));
  } else if (entityType === "MESSAGES" && action === "ANONYMIZE") {
    await db.update(messages)
      .set({
        content: "[redacted]",
        attachmentUrl: null,
        attachmentName: null,
        attachmentType: null,
        attachmentSize: null,
        voiceUrl: null,
        voiceDurationSeconds: null,
        isDeleted: true,
      })
      .where(and(
        lt(messages.createdAt, cutoff),
        eq(messages.isDeleted, false),
        inArray(messages.conversationId, orgConversationIdsSubquery(orgId)),
      ));
  } else if (entityType === "FILE_UPLOADS" && action === "DELETE") {
    await db.delete(media).where(and(
      lt(media.uploadedAt, cutoff),
      inArray(media.projectId, orgProjectIdsSubquery(orgId)),
    ));
  }
}

const router = Router();

router.get("/policies", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const policies = await db.select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.organizationId, orgId))
      .orderBy(retentionPolicies.entityType);

    res.json(policies);
  } catch (error) {
    next(error);
  }
});

router.post("/policies/seed", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    // Task #1572 — only seed (entityType, action) combos that the
    // nightly sweep (`processRetentionPolicies`) actually implements.
    // Anything else would show up as a "No-op" badge in the admin UI.
    // For TIME_ENTRIES we default to ANONYMIZE so payroll history
    // totals stay intact (just the free-text notes get scrubbed).
    const defaults = [
      { entityType: "AUDIT_LOGS" as const, retentionDays: 2555, action: "DELETE" as const },
      { entityType: "AI_ACTIONS" as const, retentionDays: 365, action: "DELETE" as const },
      { entityType: "DOCUMENTS" as const, retentionDays: 3650, action: "DELETE" as const },
      { entityType: "TIME_ENTRIES" as const, retentionDays: 2555, action: "ANONYMIZE" as const },
      { entityType: "MESSAGES" as const, retentionDays: 730, action: "DELETE" as const },
      { entityType: "FILE_UPLOADS" as const, retentionDays: 1825, action: "DELETE" as const },
    ];

    const existing = await db.select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.organizationId, orgId));

    const existingTypes = new Set(existing.map(p => p.entityType));
    const toInsert = defaults.filter(d => !existingTypes.has(d.entityType));

    if (toInsert.length > 0) {
      await db.insert(retentionPolicies).values(
        toInsert.map(d => ({
          organizationId: orgId,
          entityType: d.entityType,
          retentionDays: d.retentionDays,
          action: d.action,
          enabled: true,
        }))
      );
    }

    const policies = await db.select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.organizationId, orgId))
      .orderBy(retentionPolicies.entityType);

    res.json(policies);
  } catch (error) {
    next(error);
  }
});

router.put("/policies/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { id } = req.params;
    const { retentionDays, action, enabled } = req.body;

    const existing = await db.select()
      .from(retentionPolicies)
      .where(and(eq(retentionPolicies.id, id), eq(retentionPolicies.organizationId, orgId)));

    if (!existing.length) {
      return res.status(404).json({ error: "Policy not found" });
    }

    const [updated] = await db.update(retentionPolicies)
      .set({
        retentionDays: retentionDays !== undefined ? retentionDays : existing[0].retentionDays,
        action: action || existing[0].action,
        enabled: enabled !== undefined ? enabled : existing[0].enabled,
        updatedAt: new Date(),
      })
      .where(eq(retentionPolicies.id, id))
      .returning();

    await logAudit({
      userId: user.id,
      entityType: "retention_policies",
      entityId: id,
      action: "UPDATE",
      oldValue: JSON.stringify(existing[0]),
      newValue: JSON.stringify(updated),
    }, req);

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post("/preview", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req, res);
    if (!orgId) return;

    const policies = await db.select()
      .from(retentionPolicies)
      .where(and(eq(retentionPolicies.organizationId, orgId), eq(retentionPolicies.enabled, true)));

    const preview: Array<{ entityType: string; action: string; retentionDays: number; affectedCount: number; cutoffDate: string; supported: boolean }> = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      const supported = isSupportedRetentionPolicyCombo(policy.entityType, policy.action);
      // Task #1572 — preview must mirror the sweep's tenant scoping
      // exactly. Unsupported combos report 0 so the preview never
      // implies cross-tenant work that won't happen.
      const count = supported
        ? await countRetentionAffected(orgId, policy.entityType, policy.action, cutoff)
        : 0;

      preview.push({
        entityType: policy.entityType,
        action: policy.action,
        retentionDays: policy.retentionDays,
        affectedCount: count,
        cutoffDate: cutoff.toISOString(),
        supported,
      });
    }

    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/execute", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = getUserOrThrow(req, res);
    if (!user) return;
    const orgId = getOrgId(req, res);
    if (!orgId) return;
    const { policyId, dryRun = true } = req.body;

    const policies = policyId
      ? await db.select().from(retentionPolicies).where(and(eq(retentionPolicies.id, policyId), eq(retentionPolicies.organizationId, orgId)))
      : await db.select().from(retentionPolicies).where(and(eq(retentionPolicies.organizationId, orgId), eq(retentionPolicies.enabled, true)));

    const results: Array<{ entityType: string; action: string; affectedCount: number; executed: boolean; supported: boolean }> = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      let count = 0;
      const supported = isSupportedRetentionPolicyCombo(policy.entityType, policy.action);

      // Task #1572 — counts mirror the predicates used by the nightly
      // sweep, including the per-org tenant scoping. Unsupported
      // combos report 0 and never mutate so dry-run output matches
      // executable behavior exactly.
      if (supported) {
        count = await countRetentionAffected(orgId, policy.entityType, policy.action, cutoff);
        if (!dryRun && count > 0) {
          await executeRetentionMutation(orgId, policy.entityType, policy.action, cutoff);
        }
      }

      if (!dryRun) {
        await db.update(retentionPolicies)
          .set({ lastRunAt: new Date(), updatedAt: new Date() })
          .where(eq(retentionPolicies.id, policy.id));

        await logAudit({
          userId: user.id,
          entityType: "retention_policies",
          entityId: policy.id,
          action: "UPDATE",
          newValue: JSON.stringify({ executedAt: new Date(), affectedCount: count, entityType: policy.entityType, action: policy.action }),
        }, req);
      }

      results.push({
        entityType: policy.entityType,
        action: policy.action,
        affectedCount: count,
        executed: !dryRun && supported,
        supported,
      });
    }

    res.json({ dryRun, results });
  } catch (error) {
    next(error);
  }
});

export default router;
