import { Router, Response } from "express";
import { AuthRequest, requireAuth, requireRole } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { db } from "./db";
import { retentionPolicies, auditLog, messages, timeEntries, media } from "@shared/schema";
import { eq, and, lt, sql, desc } from "drizzle-orm";
import { logAudit } from "./auditLogger";

const router = Router();

router.get("/policies", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const policies = await db.select()
      .from(retentionPolicies)
      .where(eq(retentionPolicies.organizationId, orgId))
      .orderBy(retentionPolicies.entityType);

    res.json(policies);
  } catch (error) {
    console.error("Error fetching retention policies:", error);
    res.status(500).json({ error: "Failed to fetch retention policies" });
  }
});

router.post("/policies/seed", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const defaults = [
      { entityType: "AUDIT_LOGS" as const, retentionDays: 2555, action: "ARCHIVE" as const },
      { entityType: "AI_ACTIONS" as const, retentionDays: 365, action: "DELETE" as const },
      { entityType: "DOCUMENTS" as const, retentionDays: 3650, action: "ARCHIVE" as const },
      { entityType: "TIME_ENTRIES" as const, retentionDays: 2555, action: "ARCHIVE" as const },
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
    console.error("Error seeding retention policies:", error);
    res.status(500).json({ error: "Failed to seed retention policies" });
  }
});

router.put("/policies/:id", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

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
    console.error("Error updating retention policy:", error);
    res.status(500).json({ error: "Failed to update retention policy" });
  }
});

router.post("/preview", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const policies = await db.select()
      .from(retentionPolicies)
      .where(and(eq(retentionPolicies.organizationId, orgId), eq(retentionPolicies.enabled, true)));

    const preview: Array<{ entityType: string; action: string; retentionDays: number; affectedCount: number; cutoffDate: string }> = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      let count = 0;

      switch (policy.entityType) {
        case "AUDIT_LOGS": {
          const result = await db.select({ count: sql<number>`count(*)::int` })
            .from(auditLog)
            .where(lt(auditLog.createdAt, cutoff));
          count = result[0]?.count || 0;
          break;
        }
        case "MESSAGES": {
          const result = await db.select({ count: sql<number>`count(*)::int` })
            .from(messages)
            .where(lt(messages.createdAt, cutoff));
          count = result[0]?.count || 0;
          break;
        }
        case "TIME_ENTRIES": {
          const result = await db.select({ count: sql<number>`count(*)::int` })
            .from(timeEntries)
            .where(lt(timeEntries.createdAt, cutoff));
          count = result[0]?.count || 0;
          break;
        }
        default:
          count = 0;
      }

      preview.push({
        entityType: policy.entityType,
        action: policy.action,
        retentionDays: policy.retentionDays,
        affectedCount: count,
        cutoffDate: cutoff.toISOString(),
      });
    }

    res.json(preview);
  } catch (error) {
    console.error("Error previewing retention:", error);
    res.status(500).json({ error: "Failed to preview retention impact" });
  }
});

router.post("/execute", requireAuth, requireRole("ADMIN", "SUPER_ADMIN"), requireFeature("DATA_RETENTION"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const { policyId, dryRun = true } = req.body;

    const policies = policyId
      ? await db.select().from(retentionPolicies).where(and(eq(retentionPolicies.id, policyId), eq(retentionPolicies.organizationId, orgId)))
      : await db.select().from(retentionPolicies).where(and(eq(retentionPolicies.organizationId, orgId), eq(retentionPolicies.enabled, true)));

    const results: Array<{ entityType: string; action: string; affectedCount: number; executed: boolean }> = [];

    for (const policy of policies) {
      const cutoff = new Date(Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000);
      let count = 0;

      if (policy.entityType === "AUDIT_LOGS") {
        const result = await db.select({ count: sql<number>`count(*)::int` })
          .from(auditLog)
          .where(lt(auditLog.createdAt, cutoff));
        count = result[0]?.count || 0;

        if (!dryRun && count > 0 && policy.action === "DELETE") {
          await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
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
          newValue: JSON.stringify({ executedAt: new Date(), affectedCount: count, entityType: policy.entityType }),
        }, req);
      }

      results.push({
        entityType: policy.entityType,
        action: policy.action,
        affectedCount: count,
        executed: !dryRun,
      });
    }

    res.json({ dryRun, results });
  } catch (error) {
    console.error("Error executing retention:", error);
    res.status(500).json({ error: "Failed to execute retention" });
  }
});

export default router;
