import { logError } from "./utils/logger";
import { Router, type Response } from "express";
import { db } from "./db";
import { projectRisks, projects, users, type Project } from "@shared/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { sanitizeText, sanitizeShortText } from "./sanitization";
import { eventBus } from "./events";
import { openai, AI_MODEL_GPT4O } from "./ai/openaiClient";

const router = Router();

const VALID_CATEGORIES = ["FINANCIAL", "SCHEDULE", "SAFETY", "ENVIRONMENTAL", "REGULATORY", "SUBCONTRACTOR", "SUPPLY_CHAIN", "WEATHER", "DESIGN", "OTHER"] as const;
const VALID_STATUSES = ["IDENTIFIED", "ASSESSED", "MITIGATING", "RESOLVED", "ACCEPTED", "OCCURRED"] as const;

const createRiskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullable().optional(),
  category: z.enum(VALID_CATEGORIES).default("OTHER"),
  probability: z.coerce.number().int().min(1).max(5).default(1),
  impact: z.coerce.number().int().min(1).max(5).default(1),
  status: z.enum(VALID_STATUSES).default("IDENTIFIED"),
  mitigationPlan: z.string().max(5000).nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  costImpactDollars: z.string().nullable().optional(),
  scheduleImpactDays: z.coerce.number().int().nullable().optional(),
  linkedCostCode: z.string().max(100).nullable().optional(),
  linkedMilestone: z.string().max(500).nullable().optional(),
  linkedChangeOrderId: z.string().nullable().optional(),
});

const updateRiskSchema = createRiskSchema.partial().extend({
  autoCreateChangeOrder: z.boolean().optional(),
});

async function verifyProjectOrgAccess(req: AuthRequest, projectId: string, res: Response): Promise<{ project: Project } | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) { res.status(404).json({ error: "Project not found" }); return null; }

  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return null; }
  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }

  return { project };
}

router.get("/projects/:projectId/risks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status, category, severity, sortBy } = req.query;

    const conditions = [eq(projectRisks.projectId, projectId)];

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return; }
    if (shouldFilter && orgId) {
      conditions.push(eq(projectRisks.organizationId, orgId));
    }
    if (status && typeof status === "string" && (VALID_STATUSES as readonly string[]).includes(status)) {
      conditions.push(eq(projectRisks.status, status as typeof VALID_STATUSES[number]));
    }
    if (category && typeof category === "string" && (VALID_CATEGORIES as readonly string[]).includes(category)) {
      conditions.push(eq(projectRisks.category, category as typeof VALID_CATEGORIES[number]));
    }

    if (severity && typeof severity === "string") {
      const severityRanges: Record<string, [number, number]> = {
        low: [1, 4],
        medium: [5, 9],
        high: [10, 19],
        critical: [20, 25],
      };
      const range = severityRanges[severity.toLowerCase()];
      if (range) {
        conditions.push(sql`${projectRisks.riskScore} >= ${range[0]}`);
        conditions.push(sql`${projectRisks.riskScore} <= ${range[1]}`);
      }
    }

    let orderBy;
    switch (sortBy) {
      case "score_desc": orderBy = desc(projectRisks.riskScore); break;
      case "score_asc": orderBy = asc(projectRisks.riskScore); break;
      case "newest": orderBy = desc(projectRisks.createdAt); break;
      case "oldest": orderBy = asc(projectRisks.createdAt); break;
      default: orderBy = desc(projectRisks.riskScore);
    }

    const risks = await db
      .select({
        risk: projectRisks,
        ownerFirstName: users.firstName,
        ownerLastName: users.lastName,
      })
      .from(projectRisks)
      .leftJoin(users, eq(projectRisks.ownerUserId, users.id))
      .where(and(...conditions))
      .orderBy(orderBy);

    const result = risks.map((r) => ({
      ...r.risk,
      ownerName: r.ownerFirstName && r.ownerLastName
        ? `${r.ownerFirstName} ${r.ownerLastName}`
        : null,
    }));

    res.json(result);
  } catch (error) {
    logError("Error fetching risks:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/risks/summary", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const conditions = [eq(projectRisks.projectId, projectId)];

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return; }
    if (shouldFilter && orgId) {
      conditions.push(eq(projectRisks.organizationId, orgId));
    }

    const allRisks = await db
      .select()
      .from(projectRisks)
      .where(and(...conditions));

    const openStatuses = ["IDENTIFIED", "ASSESSED", "MITIGATING"];
    const openRisks = allRisks.filter(r => openStatuses.includes(r.status));
    const highRisks = openRisks.filter(r => r.riskScore >= 15);
    const criticalRisks = openRisks.filter(r => r.riskScore >= 20);
    const occurredRisks = allRisks.filter(r => r.status === "OCCURRED");

    const totalCostExposure = openRisks.reduce((sum, r) => sum + Number(r.costImpactDollars || 0), 0);
    const totalScheduleExposure = openRisks.reduce((max, r) => Math.max(max, r.scheduleImpactDays || 0), 0);

    const categoryBreakdown: Record<string, number> = {};
    for (const r of openRisks) {
      categoryBreakdown[r.category] = (categoryBreakdown[r.category] || 0) + 1;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newThisPeriod = allRisks.filter(r => r.createdAt && new Date(r.createdAt) >= thirtyDaysAgo).length;
    const resolvedThisPeriod = allRisks.filter(r => r.status === "RESOLVED" && r.updatedAt && new Date(r.updatedAt) >= thirtyDaysAgo).length;
    const direction = resolvedThisPeriod > newThisPeriod ? "improving" : resolvedThisPeriod < newThisPeriod ? "worsening" : "stable";

    res.json({
      totalRisks: allRisks.length,
      openRisks: openRisks.length,
      highRisks: highRisks.length,
      criticalRisks: criticalRisks.length,
      occurredRisks: occurredRisks.length,
      resolvedRisks: allRisks.filter(r => r.status === "RESOLVED").length,
      acceptedRisks: allRisks.filter(r => r.status === "ACCEPTED").length,
      totalCostExposure,
      totalScheduleExposure,
      categoryBreakdown,
      trend: { newThisPeriod, resolvedThisPeriod, direction },
    });
  } catch (error) {
    logError("Error fetching risk summary:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:projectId/risks/matrix", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;
    const conditions = [eq(projectRisks.projectId, projectId)];

    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return; }
    if (shouldFilter && orgId) {
      conditions.push(eq(projectRisks.organizationId, orgId));
    }

    const openStatuses = ["IDENTIFIED", "ASSESSED", "MITIGATING"];
    const allRisks = await db
      .select()
      .from(projectRisks)
      .where(and(...conditions));

    const openRisks = allRisks.filter(r => openStatuses.includes(r.status));

    const matrix: Record<string, { count: number; risks: { id: string; title: string; category: string }[] }> = {};
    for (let p = 1; p <= 5; p++) {
      for (let i = 1; i <= 5; i++) {
        matrix[`${p}-${i}`] = { count: 0, risks: [] };
      }
    }

    for (const risk of openRisks) {
      const key = `${risk.probability}-${risk.impact}`;
      if (matrix[key]) {
        matrix[key].count++;
        matrix[key].risks.push({ id: risk.id, title: risk.title, category: risk.category });
      }
    }

    res.json(matrix);
  } catch (error) {
    logError("Error fetching risk matrix:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:projectId/risks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;

    const access = await verifyProjectOrgAccess(req, projectId, res);
    if (!access) return;
    const { project } = access;

    const parsed = createRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }

    const data = parsed.data;
    const orgId = project.gcOrganizationId;
    const probability = data.probability;
    const impact = data.impact;
    const riskScore = probability * impact;

    const [risk] = await db.insert(projectRisks).values({
      projectId,
      organizationId: orgId,
      title: sanitizeShortText(data.title),
      description: data.description ? sanitizeText(data.description) : null,
      category: data.category,
      probability,
      impact,
      riskScore,
      status: data.status,
      mitigationPlan: data.mitigationPlan ? sanitizeText(data.mitigationPlan) : null,
      ownerUserId: data.ownerUserId || null,
      costImpactDollars: data.costImpactDollars || null,
      scheduleImpactDays: data.scheduleImpactDays ?? null,
      linkedCostCode: data.linkedCostCode || null,
      linkedMilestone: data.linkedMilestone || null,
      linkedChangeOrderId: data.linkedChangeOrderId || null,
    }).returning();

    res.status(201).json(risk);
  } catch (error) {
    logError("Error creating risk:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/projects/:projectId/risks/:riskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, riskId } = req.params;

    const access = await verifyProjectOrgAccess(req, projectId, res);
    if (!access) return;

    const [existing] = await db.select().from(projectRisks)
      .where(and(eq(projectRisks.id, riskId), eq(projectRisks.projectId, projectId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Risk not found" }); return; }

    const parsed = updateRiskSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten().fieldErrors });
      return;
    }

    const data = parsed.data;
    const updates: Partial<typeof projectRisks.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };

    if (data.title !== undefined) updates.title = sanitizeShortText(data.title);
    if (data.description !== undefined) updates.description = data.description ? sanitizeText(data.description) : null;
    if (data.mitigationPlan !== undefined) updates.mitigationPlan = data.mitigationPlan ? sanitizeText(data.mitigationPlan) : null;
    if (data.category !== undefined) updates.category = data.category;
    if (data.status !== undefined) updates.status = data.status;
    if (data.ownerUserId !== undefined) updates.ownerUserId = data.ownerUserId || null;
    if (data.costImpactDollars !== undefined) updates.costImpactDollars = data.costImpactDollars;
    if (data.scheduleImpactDays !== undefined) updates.scheduleImpactDays = data.scheduleImpactDays;
    if (data.linkedCostCode !== undefined) updates.linkedCostCode = data.linkedCostCode || null;
    if (data.linkedMilestone !== undefined) updates.linkedMilestone = data.linkedMilestone || null;
    if (data.linkedChangeOrderId !== undefined) updates.linkedChangeOrderId = data.linkedChangeOrderId || null;

    if (data.probability !== undefined || data.impact !== undefined) {
      const probability = data.probability ?? existing.probability;
      const impact = data.impact ?? existing.impact;
      updates.probability = probability;
      updates.impact = impact;
      updates.riskScore = probability * impact;
    }

    const [updated] = await db.update(projectRisks)
      .set(updates)
      .where(eq(projectRisks.id, riskId))
      .returning();

    if (data.status && data.status !== existing.status) {
      await eventBus.emit({
        type: "risk.status_changed",
        version: 1,
        orgId: existing.organizationId,
        actorId: req.user!.id,
        timestamp: new Date(),
        payload: {
          riskId: existing.id,
          projectId: existing.projectId,
          title: existing.title,
          oldStatus: existing.status,
          newStatus: data.status,
          costImpactDollars: Number(updated.costImpactDollars) || null,
          scheduleImpactDays: updated.scheduleImpactDays,
          linkedCostCode: updated.linkedCostCode,
          linkedChangeOrderId: updated.linkedChangeOrderId,
          autoCreateChangeOrder: data.autoCreateChangeOrder ?? false,
        },
      });

    }

    res.json(updated);
  } catch (error) {
    logError("Error updating risk:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:projectId/risks/:riskId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId, riskId } = req.params;

    const access = await verifyProjectOrgAccess(req, projectId, res);
    if (!access) return;

    const [existing] = await db.select().from(projectRisks)
      .where(and(eq(projectRisks.id, riskId), eq(projectRisks.projectId, projectId)))
      .limit(1);

    if (!existing) { res.status(404).json({ error: "Risk not found" }); return; }

    await db.delete(projectRisks).where(eq(projectRisks.id, riskId));
    res.json({ success: true });
  } catch (error) {
    logError("Error deleting risk:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:projectId/risks/ai-suggest", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT", "PROJECT_ENGINEER"), async (req: AuthRequest, res: Response) => {
  try {
    const { projectId } = req.params;

    const access = await verifyProjectOrgAccess(req, projectId, res);
    if (!access) return;
    const { project } = access;

    const existingRisks = await db.select({ title: projectRisks.title, category: projectRisks.category })
      .from(projectRisks)
      .where(eq(projectRisks.projectId, projectId));

    const systemPrompt = `You are a construction risk management expert. Analyze the given project details and suggest potential risks.
Return a JSON object with a "risks" array. Each risk should have:
- title: string (concise risk title)
- description: string (detailed description)
- category: one of FINANCIAL, SCHEDULE, SAFETY, ENVIRONMENTAL, REGULATORY, SUBCONTRACTOR, SUPPLY_CHAIN, WEATHER, DESIGN, OTHER
- probability: number 1-5 (1=rare, 5=almost certain)
- impact: number 1-5 (1=negligible, 5=catastrophic)
- mitigationPlan: string (recommended mitigation strategy)
- costImpactDollars: number or null (estimated cost impact)
- scheduleImpactDays: number or null (estimated schedule impact in days)

Suggest 5-8 relevant risks based on the project type and details. Do not duplicate risks already identified.`;

    const userPrompt = `Project: ${project.name}
Code: ${project.code}
Status: ${project.status}
Budget: $${project.budget || "Not set"}
Contract Amount: $${project.contractAmount || "Not set"}
${project.description ? `Description: ${project.description}` : ""}
${project.address ? `Location: ${project.address}` : ""}

Already identified risks: ${existingRisks.length > 0 ? existingRisks.map(r => `${r.title} (${r.category})`).join(", ") : "None"}

Suggest relevant construction project risks that haven't been identified yet.`;

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT4O,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2048,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) { res.status(500).json({ error: "No response from AI" }); return; }

    const parsed = JSON.parse(content);
    res.json(parsed.risks || []);
  } catch (error) {
    logError("Error generating AI risk suggestions:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate risk suggestions" });
  }
});

router.get("/risks/portfolio-summary", requireAuth, requireRole("ADMIN", "MANAGER", "SUPER_ADMIN", "OFFICE_MANAGER"), async (req: AuthRequest, res: Response) => {
  try {
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess) { res.status(403).json({ error: "Access denied" }); return; }

    const conditions = [];
    if (shouldFilter && orgId) {
      conditions.push(eq(projectRisks.organizationId, orgId));
    }

    const allRisks = conditions.length > 0
      ? await db.select().from(projectRisks).where(and(...conditions))
      : await db.select().from(projectRisks);

    const openStatuses = ["IDENTIFIED", "ASSESSED", "MITIGATING"];
    const openRisks = allRisks.filter(r => openStatuses.includes(r.status));
    const highRisks = openRisks.filter(r => r.riskScore >= 15);
    const occurredRisks = allRisks.filter(r => r.status === "OCCURRED");

    const totalCostExposure = openRisks.reduce((sum, r) => sum + Number(r.costImpactDollars || 0), 0);

    const projectRiskCounts: Record<string, { open: number; high: number; occurred: number; costExposure: number }> = {};
    for (const r of allRisks) {
      if (!projectRiskCounts[r.projectId]) {
        projectRiskCounts[r.projectId] = { open: 0, high: 0, occurred: 0, costExposure: 0 };
      }
      if (openStatuses.includes(r.status)) {
        projectRiskCounts[r.projectId].open++;
        projectRiskCounts[r.projectId].costExposure += Number(r.costImpactDollars || 0);
        if (r.riskScore >= 15) projectRiskCounts[r.projectId].high++;
      }
      if (r.status === "OCCURRED") projectRiskCounts[r.projectId].occurred++;
    }

    const highRiskProjects = Object.entries(projectRiskCounts)
      .filter(([, counts]) => counts.high > 0 || counts.occurred > 0)
      .sort(([, a], [, b]) => (b.high + b.occurred) - (a.high + a.occurred));

    const projectIds = highRiskProjects.map(([id]) => id);
    let projectNames: Record<string, string> = {};
    if (projectIds.length > 0) {
      const projRows = await db.select({ id: projects.id, name: projects.name, code: projects.code })
        .from(projects)
        .where(inArray(projects.id, projectIds));
      projectNames = Object.fromEntries(projRows.map(p => [p.id, `${p.code} - ${p.name}`]));
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const newThisPeriod = allRisks.filter(r => r.createdAt && new Date(r.createdAt) >= thirtyDaysAgo).length;
    const resolvedThisPeriod = allRisks.filter(r => r.status === "RESOLVED" && r.updatedAt && new Date(r.updatedAt) >= thirtyDaysAgo).length;
    const direction = resolvedThisPeriod > newThisPeriod ? "improving" : resolvedThisPeriod < newThisPeriod ? "worsening" : "stable";

    res.json({
      totalOpenRisks: openRisks.length,
      totalHighRisks: highRisks.length,
      totalOccurredRisks: occurredRisks.length,
      totalCostExposure,
      totalProjects: Object.keys(projectRiskCounts).length,
      trend: { newThisPeriod, resolvedThisPeriod, direction },
      highRiskProjects: highRiskProjects.slice(0, 10).map(([projectId, counts]) => ({
        projectId,
        projectName: projectNames[projectId] || projectId,
        ...counts,
      })),
    });
  } catch (error) {
    logError("Error fetching portfolio risk summary:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
