import { Router } from "express";
import { db } from "./db";
import { aiInsights, aiGanttRecommendations, aiVendorComparisons } from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { type AuthRequest, requireAuth, requireRole } from "./auth";

const router = Router();

router.get("/ai-insights/dashboard-summary", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const organizationId = req.user!.organizationId;

    const conditions: any[] = [
      eq(aiInsights.isAcknowledged, false),
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`,
    ];

    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    const recentInsights = await db
      .select({
        id: aiInsights.id,
        module: aiInsights.module,
        severity: aiInsights.severity,
        title: aiInsights.title,
        summary: aiInsights.summary,
        estimatedImpact: aiInsights.estimatedImpact,
        isAcknowledged: aiInsights.isAcknowledged,
        createdAt: aiInsights.createdAt,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .orderBy(desc(aiInsights.createdAt))
      .limit(10);

    const countBySeverity = await db
      .select({
        severity: aiInsights.severity,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.severity);

    const countByModule = await db
      .select({
        module: aiInsights.module,
        count: sql<number>`count(*)::int`,
      })
      .from(aiInsights)
      .where(and(...conditions))
      .groupBy(aiInsights.module);

    res.json({
      recentInsights,
      countBySeverity: Object.fromEntries(countBySeverity.map(c => [c.severity, c.count])),
      countByModule: Object.fromEntries(countByModule.map(c => [c.module, c.count])),
      totalUnacknowledged: countBySeverity.reduce((sum, c) => sum + c.count, 0),
    });
  } catch (error: any) {
    console.error("Error fetching AI dashboard summary:", error);
    res.status(500).json({ error: "Failed to fetch AI dashboard summary" });
  }
});

router.get("/ai-insights", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { module, projectId, severity, acknowledged } = req.query;
    const organizationId = req.user.organizationId;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(
        sql`(${aiInsights.organizationId} = ${organizationId} OR ${aiInsights.organizationId} IS NULL)`
      );
    }

    if (module) {
      conditions.push(eq(aiInsights.module, module as any));
    }

    if (projectId) {
      conditions.push(eq(aiInsights.projectId, projectId as string));
    }

    if (severity) {
      conditions.push(eq(aiInsights.severity, severity as any));
    }

    if (acknowledged !== undefined) {
      conditions.push(eq(aiInsights.isAcknowledged, acknowledged === 'true'));
    }

    conditions.push(
      sql`(${aiInsights.expiresAt} IS NULL OR ${aiInsights.expiresAt} > NOW())`
    );

    const insights = await db
      .select()
      .from(aiInsights)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiInsights.createdAt))
      .limit(100);

    const parsedInsights = insights.map(insight => ({
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    }));

    res.json(parsedInsights);
  } catch (error: any) {
    console.error("Error fetching AI insights:", error);
    res.status(500).json({ error: "Failed to fetch AI insights" });
  }
});

router.get("/ai-insights/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const parsedInsight = {
      ...insight,
      metrics: insight.metrics ? JSON.parse(insight.metrics) : null,
      affectedEntities: insight.affectedEntities ? JSON.parse(insight.affectedEntities) : null,
      actionItems: insight.actionItems ? JSON.parse(insight.actionItems) : null,
    };

    res.json(parsedInsight);
  } catch (error: any) {
    console.error("Error fetching AI insight:", error);
    res.status(500).json({ error: "Failed to fetch AI insight" });
  }
});

router.patch("/ai-insights/:id/acknowledge", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    const [insight] = await db
      .select()
      .from(aiInsights)
      .where(eq(aiInsights.id, id))
      .limit(1);

    if (!insight) {
      return res.status(404).json({ error: "Insight not found" });
    }

    if (req.user.role !== 'SUPER_ADMIN' && 
        insight.organizationId && 
        insight.organizationId !== req.user.organizationId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const [updated] = await db
      .update(aiInsights)
      .set({
        isAcknowledged: true,
        acknowledgedById: req.user.id,
        acknowledgedAt: new Date(),
      })
      .where(eq(aiInsights.id, id))
      .returning();

    res.json(updated);
  } catch (error: any) {
    console.error("Error acknowledging AI insight:", error);
    res.status(500).json({ error: "Failed to acknowledge insight" });
  }
});

router.get("/ai-gantt-recommendations/:projectId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;

    const recommendations = await db
      .select()
      .from(aiGanttRecommendations)
      .where(eq(aiGanttRecommendations.projectId, projectId))
      .orderBy(desc(aiGanttRecommendations.createdAt))
      .limit(20);

    const parsedRecommendations = recommendations.map(rec => ({
      ...rec,
      suggestedTasks: rec.suggestedTasks ? JSON.parse(rec.suggestedTasks) : null,
      suggestedDependencies: rec.suggestedDependencies ? JSON.parse(rec.suggestedDependencies) : null,
    }));

    res.json(parsedRecommendations);
  } catch (error: any) {
    console.error("Error fetching Gantt recommendations:", error);
    res.status(500).json({ error: "Failed to fetch Gantt recommendations" });
  }
});

router.get("/ai-vendor-comparisons", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
  try {

    const organizationId = req.user.organizationId;
    const { category } = req.query;

    const conditions: any[] = [];
    
    if (req.user.role !== 'SUPER_ADMIN' && organizationId) {
      conditions.push(eq(aiVendorComparisons.organizationId, organizationId));
    }

    if (category) {
      conditions.push(eq(aiVendorComparisons.materialCategory, category as string));
    }

    const comparisons = await db
      .select()
      .from(aiVendorComparisons)
      .where(conditions.length > 0 ? and(...conditions) : sql`1=1`)
      .orderBy(desc(aiVendorComparisons.createdAt))
      .limit(50);

    const parsedComparisons = comparisons.map(comp => ({
      ...comp,
      analysisData: comp.analysisData ? JSON.parse(comp.analysisData) : null,
    }));

    res.json(parsedComparisons);
  } catch (error: any) {
    console.error("Error fetching vendor comparisons:", error);
    res.status(500).json({ error: "Failed to fetch vendor comparisons" });
  }
});

export default router;
