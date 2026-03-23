import { Router } from "express";
import { db } from "./db";
import { users, organizations, auditLog, organizationSubscriptions, organizationAddOns, organizationUsage, subscriptionEvents, organizationSowItems, scopeItems, estimateLineItems, dailyScopeProgress } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { eq, count, desc, sql, and, ilike } from "drizzle-orm";
import { logAudit } from "./auditLogger";
import { PLAN_INFO, ADDON_INFO, type PlanTier, type AddOnKey } from "@shared/billing/plans";

const router = Router();

// ========================================
// Routes from platformSubscriptionRoutes.ts
// ========================================

function requireSuperAdmin(req: AuthRequest, res: any, next: any) {
  if (!req.user || req.user.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Access denied. Platform admin access required." });
  }
  next();
}

router.get("/platform/subscriptions/stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const byPlanTier = await db.select({
      planTier: organizationSubscriptions.planTier,
      count: count(),
    })
    .from(organizationSubscriptions)
    .groupBy(organizationSubscriptions.planTier);

    const byStatus = await db.select({
      status: organizationSubscriptions.status,
      count: count(),
    })
    .from(organizationSubscriptions)
    .groupBy(organizationSubscriptions.status);

    const addonStats = await db.select({
      addonKey: organizationAddOns.addonKey,
      count: count(),
    })
    .from(organizationAddOns)
    .where(eq(organizationAddOns.status, "active"))
    .groupBy(organizationAddOns.addonKey);

    const [totalOrgs] = await db.select({ count: count() }).from(organizationSubscriptions);

    let estimatedMrr = 0;
    for (const row of byPlanTier) {
      const info = PLAN_INFO[row.planTier as PlanTier];
      if (info) {
        estimatedMrr += info.price * row.count;
      }
    }

    const activeAddonCount = await db.select({ count: count() })
      .from(organizationAddOns)
      .where(eq(organizationAddOns.status, "active"));

    for (const addon of addonStats) {
      const info = ADDON_INFO[addon.addonKey as AddOnKey];
      if (info) {
        estimatedMrr += info.price * addon.count;
      }
    }

    const recentChanges = await db.select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      newValue: auditLog.newValue,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, "subscription"))
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

    res.json({
      totalSubscriptions: totalOrgs.count,
      byPlanTier,
      byStatus,
      addonAdoption: addonStats,
      estimatedMrr,
      recentChanges,
    });
  } catch (error: any) {
    console.error("Subscription stats error:", error.message);
    res.status(500).json({ error: "Failed to get subscription stats" });
  }
});

router.get("/platform/subscriptions", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { planTier, status, search, page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (planTier && planTier !== "all") {
      conditions.push(eq(organizationSubscriptions.planTier, planTier as any));
    }
    if (status && status !== "all") {
      conditions.push(eq(organizationSubscriptions.status, status as any));
    }

    let searchCondition: any = undefined;
    if (search && typeof search === "string" && search.trim()) {
      searchCondition = ilike(organizations.name, `%${search.trim()}%`);
    }

    const allConditions = searchCondition
      ? (conditions.length > 0 ? and(...conditions, searchCondition) : searchCondition)
      : (conditions.length > 0 ? and(...conditions) : undefined);

    const baseQuery = db
      .select({
        subscriptionId: organizationSubscriptions.id,
        orgId: organizations.id,
        orgName: organizations.name,
        orgSlug: organizations.slug,
        tradeType: organizations.tradeType,
        planTier: organizationSubscriptions.planTier,
        status: organizationSubscriptions.status,
        billingProvider: organizationSubscriptions.billingProvider,
        currentPeriodEnd: organizationSubscriptions.currentPeriodEnd,
        createdAt: organizationSubscriptions.createdAt,
        updatedAt: organizationSubscriptions.updatedAt,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id));

    const dataQuery = allConditions
      ? baseQuery.where(allConditions)
      : baseQuery;

    const rows = await dataQuery
      .orderBy(desc(organizationSubscriptions.updatedAt))
      .limit(limitNum)
      .offset(offset);

    const countQuery = db
      .select({ count: count() })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id));

    const [totalRow] = allConditions
      ? await countQuery.where(allConditions)
      : await countQuery;

    const orgIds = rows.map(r => r.orgId);
    let userCounts: Record<string, number> = {};
    let addonCounts: Record<string, number> = {};

    if (orgIds.length > 0) {
      const userCountRows = await db.select({
        orgId: users.organizationId,
        count: count(),
      })
      .from(users)
      .where(sql`${users.organizationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(users.organizationId);

      for (const r of userCountRows) {
        if (r.orgId) userCounts[r.orgId] = r.count;
      }

      const addonCountRows = await db.select({
        orgId: organizationAddOns.organizationId,
        count: count(),
      })
      .from(organizationAddOns)
      .where(and(
        sql`${organizationAddOns.organizationId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`,
        eq(organizationAddOns.status, "active")
      ))
      .groupBy(organizationAddOns.organizationId);

      for (const r of addonCountRows) {
        addonCounts[r.orgId] = r.count;
      }
    }

    const subscriptions = rows.map(r => ({
      ...r,
      userCount: userCounts[r.orgId] || 0,
      activeAddonCount: addonCounts[r.orgId] || 0,
      planPrice: PLAN_INFO[r.planTier as PlanTier]?.price || 0,
      planName: PLAN_INFO[r.planTier as PlanTier]?.name || r.planTier,
    }));

    res.json({
      subscriptions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalRow.count,
        totalPages: Math.ceil(totalRow.count / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Subscriptions list error:", error.message);
    res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

router.get("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const [subscription] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    const addons = await db.select()
      .from(organizationAddOns)
      .where(eq(organizationAddOns.organizationId, orgId));

    const usage = await db.select()
      .from(organizationUsage)
      .where(eq(organizationUsage.organizationId, orgId));

    const [userCount] = await db.select({ count: count() })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const recentAudit = await db.select()
      .from(auditLog)
      .where(and(
        eq(auditLog.entityType, "subscription"),
        eq(auditLog.entityId, orgId)
      ))
      .orderBy(desc(auditLog.createdAt))
      .limit(20);

    res.json({
      organization: { id: org.id, name: org.name, slug: org.slug, tradeType: org.tradeType, createdAt: org.createdAt },
      subscription: subscription || null,
      addons,
      usage,
      userCount: userCount.count,
      planInfo: subscription ? PLAN_INFO[subscription.planTier as PlanTier] : null,
      recentAudit,
    });
  } catch (error: any) {
    console.error("Subscription detail error:", error.message);
    res.status(500).json({ error: "Failed to get subscription details" });
  }
});

router.get("/platform/subscriptions/:orgId/history", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const [totalRow] = await db.select({ count: count() })
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.organizationId, orgId));

    const events = await db.select({
      id: subscriptionEvents.id,
      eventType: subscriptionEvents.eventType,
      previousValue: subscriptionEvents.previousValue,
      newValue: subscriptionEvents.newValue,
      description: subscriptionEvents.description,
      performedBy: subscriptionEvents.performedBy,
      createdAt: subscriptionEvents.createdAt,
    })
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.organizationId, orgId))
    .orderBy(desc(subscriptionEvents.createdAt))
    .limit(limit)
    .offset(offset);

    const performerIds = [...new Set(events.filter(e => e.performedBy).map(e => e.performedBy!))];
    let performerMap: Record<string, string> = {};
    if (performerIds.length > 0) {
      const performers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(performerIds.map(id => sql`${id}`), sql`, `)})`);
      for (const p of performers) {
        performerMap[p.id] = `${p.firstName} ${p.lastName}`;
      }
    }

    const eventsWithPerformer = events.map(e => ({
      ...e,
      performerName: e.performedBy ? performerMap[e.performedBy] || "Unknown" : null,
    }));

    res.json({
      events: eventsWithPerformer,
      pagination: { page, limit, total: totalRow.count, totalPages: Math.ceil(totalRow.count / limit) },
    });
  } catch (error: any) {
    console.error("Subscription history error:", error.message);
    res.status(500).json({ error: "Failed to fetch subscription history" });
  }
});

router.patch("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;
    const { planTier, status } = req.body;

    const [subscription] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    if (!subscription) return res.status(404).json({ error: "Subscription not found" });

    const updates: any = { updatedAt: new Date() };
    const changes: string[] = [];

    if (planTier && ["free", "starter", "professional", "enterprise"].includes(planTier)) {
      changes.push(`planTier: ${subscription.planTier} → ${planTier}`);
      updates.planTier = planTier;
    }

    if (status && ["active", "trialing", "past_due", "canceled"].includes(status)) {
      changes.push(`status: ${subscription.status} → ${status}`);
      updates.status = status;
    }

    if (changes.length === 0) {
      return res.status(400).json({ error: "No valid changes provided" });
    }

    const [updated] = await db.update(organizationSubscriptions)
      .set(updates)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .returning();

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "UPDATE",
        newValue: JSON.stringify({ changes, planTier: updates.planTier, status: updates.status }),
      },
      req
    );

    if (updates.planTier) {
      await db.insert(subscriptionEvents).values({
        organizationId: orgId,
        eventType: "plan_change",
        previousValue: subscription.planTier,
        newValue: updates.planTier,
        description: `Plan changed from ${subscription.planTier} to ${updates.planTier}`,
        performedBy: req.user!.id,
      });
    }
    if (updates.status) {
      await db.insert(subscriptionEvents).values({
        organizationId: orgId,
        eventType: "status_change",
        previousValue: subscription.status,
        newValue: updates.status,
        description: `Status changed from ${subscription.status} to ${updates.status}`,
        performedBy: req.user!.id,
      });
    }

    res.json({ subscription: updated, changes });
  } catch (error: any) {
    console.error("Subscription update error:", error.message);
    res.status(500).json({ error: "Failed to update subscription" });
  }
});

router.patch("/platform/subscriptions/:orgId/addons/:addonKey", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId, addonKey } = req.params;
    const { status } = req.body;

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'inactive'" });
    }

    const [existing] = await db.select()
      .from(organizationAddOns)
      .where(and(
        eq(organizationAddOns.organizationId, orgId),
        eq(organizationAddOns.addonKey, addonKey as any)
      ))
      .limit(1);

    let result;
    if (existing) {
      [result] = await db.update(organizationAddOns)
        .set({ status, updatedAt: new Date() })
        .where(eq(organizationAddOns.id, existing.id))
        .returning();
    } else {
      [result] = await db.insert(organizationAddOns)
        .values({ organizationId: orgId, addonKey: addonKey as any, status, updatedAt: new Date() })
        .returning();
    }

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "UPDATE",
        newValue: JSON.stringify({ addon: addonKey, status }),
      },
      req
    );

    await db.insert(subscriptionEvents).values({
      organizationId: orgId,
      eventType: "addon_change",
      previousValue: existing ? existing.status : null,
      newValue: status,
      description: `Add-on "${addonKey.replace(/_/g, " ")}" ${status === "active" ? "enabled" : "disabled"}`,
      performedBy: req.user!.id,
    });

    res.json({ addon: result });
  } catch (error: any) {
    console.error("Addon update error:", error.message);
    res.status(500).json({ error: "Failed to update addon" });
  }
});

router.post("/platform/subscriptions", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { organizationId, planTier, status, billingProvider } = req.body;

    if (!organizationId) {
      return res.status(400).json({ error: "organizationId is required" });
    }

    if (!planTier || !["free", "starter", "professional", "enterprise"].includes(planTier)) {
      return res.status(400).json({ error: "Valid planTier is required (free, starter, professional, enterprise)" });
    }

    const [org] = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [existing] = await db.select({ id: organizationSubscriptions.id })
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, organizationId))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Organization already has a subscription. Use the update endpoint instead." });
    }

    const [newSub] = await db.insert(organizationSubscriptions)
      .values({
        organizationId,
        planTier: planTier as any,
        status: status || "active",
        billingProvider: billingProvider || "manual",
      })
      .returning();

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: organizationId,
        action: "CREATE",
        newValue: JSON.stringify({ planTier, status: status || "active", orgName: org.name }),
      },
      req
    );

    await db.insert(subscriptionEvents).values({
      organizationId,
      eventType: "created",
      previousValue: null,
      newValue: planTier,
      description: `Subscription created with ${planTier} plan for ${org.name}`,
      performedBy: req.user!.id,
    });

    res.status(201).json({ subscription: newSub });
  } catch (error: any) {
    console.error("Create subscription error:", error.message);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.delete("/platform/subscriptions/:orgId", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const { orgId } = req.params;

    const [existing] = await db.select()
      .from(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId))
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    await db.delete(organizationAddOns)
      .where(eq(organizationAddOns.organizationId, orgId));

    await db.delete(organizationSubscriptions)
      .where(eq(organizationSubscriptions.organizationId, orgId));

    await logAudit(
      {
        userId: req.user!.id,
        entityType: "subscription",
        entityId: orgId,
        action: "DELETE",
        oldValue: JSON.stringify({ planTier: existing.planTier, status: existing.status }),
      },
      req
    );

    await db.insert(subscriptionEvents).values({
      organizationId: orgId,
      eventType: "canceled",
      previousValue: existing.planTier,
      newValue: null,
      description: `Subscription deleted (was ${existing.planTier} / ${existing.status})`,
      performedBy: req.user!.id,
    });

    res.json({ success: true, message: "Subscription deleted" });
  } catch (error: any) {
    console.error("Delete subscription error:", error.message);
    res.status(500).json({ error: "Failed to delete subscription" });
  }
});

router.get("/platform/organizations-without-subscription", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const orgsWithSubs = db.select({ orgId: organizationSubscriptions.organizationId }).from(organizationSubscriptions);

    const orgsWithoutSubs = await db.select({
      id: organizations.id,
      name: organizations.name,
      tradeType: organizations.tradeType,
    })
      .from(organizations)
      .where(sql`${organizations.id} NOT IN (${orgsWithSubs})`)
      .orderBy(organizations.name)
      .limit(100);

    res.json(orgsWithoutSubs);
  } catch (error: any) {
    console.error("Fetch orgs without subscription error:", error.message);
    res.status(500).json({ error: "Failed to fetch organizations" });
  }
});

// ========================================
// Routes from platformAuditRoutes.ts
// ========================================

router.get("/platform/audit-report", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    
    const reportPath = path.join(process.cwd(), "audit/reports/audit-report.json");
    
    if (!fs.existsSync(reportPath)) {
      return res.status(404).json({ error: "No audit report found. Run the audit first." });
    }
    
    const reportContent = fs.readFileSync(reportPath, "utf-8");
    const report = JSON.parse(reportContent);
    
    res.json(report);
  } catch (error: any) {
    console.error("Audit report fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch audit report" });
  }
});

let lastAuditRun = 0;
const AUDIT_COOLDOWN_MS = 60000;

router.post("/platform/run-audit", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const now = Date.now();
    if (now - lastAuditRun < AUDIT_COOLDOWN_MS) {
      const waitTime = Math.ceil((AUDIT_COOLDOWN_MS - (now - lastAuditRun)) / 1000);
      return res.status(429).json({ error: `Rate limited. Please wait ${waitTime} seconds before running another audit.` });
    }
    
    lastAuditRun = now;
    
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);
    
    await logAudit({
      action: "CREATE",
      entityType: "system_audit",
      entityId: "platform-audit",
      userId: req.user!.id,
      newValue: JSON.stringify({ actionType: "run_audit", triggeredAt: new Date().toISOString() }),
    }, req);
    
    res.json({ message: "Audit started. Refresh the page in a few seconds to see results." });
    
    execAsync("npm run audit", { timeout: 120000 }).catch((error) => {
      console.error("Audit execution error:", error.message);
    });
    
  } catch (error: any) {
    console.error("Audit run error:", error.message);
    res.status(500).json({ error: "Failed to run audit" });
  }
});

router.post("/platform/backfill-sow-links", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const results = {
      scopeItemsUpdated: 0,
      estimateLineItemsUpdated: 0,
      dailyProgressUpdated: 0,
      sovLineItemsUpdated: 0,
      errors: [] as string[],
    };

    const allOrgs = await db.select({ id: organizations.id }).from(organizations);

    for (const org of allOrgs) {
      const orgSowItems = await db
        .select()
        .from(organizationSowItems)
        .where(eq(organizationSowItems.organizationId, org.id));

      if (orgSowItems.length === 0) continue;

      const sowLookup = new Map<string, typeof orgSowItems[0]>();
      for (const sow of orgSowItems) {
        const normalizedName = sow.name.toLowerCase().trim();
        sowLookup.set(normalizedName, sow);
      }

      const unlinkedScopeItems = await db.execute(sql`
        SELECT si.* FROM scope_items si
        JOIN projects p ON si.project_id = p.id
        JOIN estimates e ON e.project_id = p.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND si.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedScopeItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(scopeItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(scopeItems.id, item.id));
          results.scopeItemsUpdated++;

          const updatedProgress = await db
            .update(dailyScopeProgress)
            .set({ organizationSowItemId: matchedSow.id })
            .where(and(
              eq(dailyScopeProgress.scopeItemId, item.id),
              sql`${dailyScopeProgress.organizationSowItemId} IS NULL`
            ))
            .returning();
          results.dailyProgressUpdated += updatedProgress.length;
        }
      }

      const unlinkedLineItems = await db.execute(sql`
        SELECT eli.* FROM estimate_line_items eli
        JOIN estimates e ON eli.estimate_id = e.id
        JOIN bids b ON e.bid_id = b.id
        WHERE b.gc_organization_id = ${org.id}
        AND eli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db
            .update(estimateLineItems)
            .set({ organizationSowItemId: matchedSow.id, updatedAt: new Date() })
            .where(eq(estimateLineItems.id, item.id));
          results.estimateLineItemsUpdated++;
        }
      }

      const unlinkedSovLineItems = await db.execute(sql`
        SELECT sli.* FROM sov_line_items sli
        JOIN schedule_of_values sov ON sli.sov_id = sov.id
        WHERE sov.organization_id = ${org.id}
        AND sli.organization_sow_item_id IS NULL
      `);

      for (const item of unlinkedSovLineItems.rows as any[]) {
        const normalizedDesc = (item.description || "").toLowerCase().trim();
        const matchedSow = sowLookup.get(normalizedDesc);
        
        if (matchedSow) {
          await db.execute(sql`
            UPDATE sov_line_items 
            SET organization_sow_item_id = ${matchedSow.id}, updated_at = NOW()
            WHERE id = ${item.id}
          `);
          results.sovLineItemsUpdated++;
        }
      }
    }

    await logAudit({
      userId: req.user!.id,
      action: "UPDATE",
      entityType: "system",
      entityId: "sow_backfill",
      oldValue: null,
      newValue: JSON.stringify(results),
    }, req);

    console.log("SOW backfill completed:", results);
    res.json({
      message: "SOW link backfill completed",
      ...results,
    });
  } catch (error: any) {
    console.error("SOW backfill error:", error.message);
    res.status(500).json({ error: "Failed to backfill SOW links", details: error.message });
  }
});

router.get("/platform/sow-link-stats", requireAuth, requireSuperAdmin, async (req: AuthRequest, res) => {
  try {
    const stats = await db.execute(sql`
      SELECT 
        'scope_items_without_sow' as metric, COUNT(*) as count 
      FROM scope_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'estimate_line_items_without_sow' as metric, COUNT(*) as count 
      FROM estimate_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'daily_progress_without_sow' as metric, COUNT(*) as count 
      FROM daily_scope_progress WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'sov_line_items_without_sow' as metric, COUNT(*) as count 
      FROM sov_line_items WHERE organization_sow_item_id IS NULL
      UNION ALL
      SELECT 'total_scope_items' as metric, COUNT(*) as count FROM scope_items
      UNION ALL
      SELECT 'total_estimate_line_items' as metric, COUNT(*) as count FROM estimate_line_items
      UNION ALL
      SELECT 'total_daily_progress' as metric, COUNT(*) as count FROM daily_scope_progress
      UNION ALL
      SELECT 'total_sov_line_items' as metric, COUNT(*) as count FROM sov_line_items
    `);

    res.json(stats.rows);
  } catch (error: any) {
    console.error("SOW stats error:", error.message);
    res.status(500).json({ error: "Failed to get SOW link stats" });
  }
});

export default router;
