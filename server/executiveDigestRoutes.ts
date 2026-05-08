// prompt-injection-guard: system-prompt-anchored summarization over tenant-internal aggregated KPIs; no third-party text
import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { projects, changeOrders, bids, organizations, executiveDigests } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { type AuthRequest, requireAuth, requireRole } from "./auth";
import { logError } from "./utils/logger";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { routedGeneralChatCompletion } from "./ai/providers";
import { governedAiCall } from "./services/aiGovernance";
import { isFeatureEnabled } from "./services/featureFlagService";
import { createExecutiveDigest, getLatestExecutiveDigest } from "./executiveDigest/storage";

const digestOutputSchema = z.object({
  executiveSummary: z.string().min(1),
  keyHighlights: z.array(z.string()).min(1),
  sections: z.array(z.object({
    title: z.string(),
    icon: z.enum(["financial", "operational", "risk", "opportunity"]),
    summary: z.string(),
    bullets: z.array(z.string()),
    sentiment: z.enum(["positive", "neutral", "negative"]),
  })).min(1),
  actionItems: z.array(z.object({
    priority: z.enum(["high", "medium", "low"]),
    description: z.string(),
    dueBy: z.string().optional(),
  })),
  kpiSnapshot: z.array(z.object({
    name: z.string(),
    current: z.number(),
    previous: z.number(),
    unit: z.string(),
    trend: z.enum(["up", "down", "stable"]),
  })),
});

const router = Router();

async function checkDigestFeatureFlag(req: AuthRequest, res: Response): Promise<boolean> {
  const orgId = req.user!.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return false;
  }
  const enabled = await isFeatureEnabled(orgId, "EXECUTIVE_DIGEST");
  if (!enabled) {
    res.status(403).json({ error: "Executive Digest feature is not enabled for this organization" });
    return false;
  }
  return true;
}

type ExecutiveDigestRow = typeof executiveDigests.$inferSelect;

function formatDigestResponse(digest: ExecutiveDigestRow) {
  return {
    id: digest.id,
    generatedAt: digest.generatedAt instanceof Date ? digest.generatedAt.toISOString() : String(digest.generatedAt),
    period: digest.period,
    executiveSummary: digest.executiveSummary,
    keyHighlights: digest.keyHighlights,
    sections: digest.sections,
    actionItems: digest.actionItems,
    kpiSnapshot: digest.kpiSnapshot,
  };
}

router.get("/api/executive/digest/:period", requireAuth, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await checkDigestFeatureFlag(req, res))) return;

    const orgId = req.user!.organizationId!;
    const period = req.params.period;
    if (!["daily", "weekly", "monthly"].includes(period)) {
      return res.status(400).json({ error: "Invalid period. Must be daily, weekly, or monthly." });
    }

    const digest = await getLatestExecutiveDigest(orgId, period);

    if (!digest) {
      return res.json(null);
    }

    res.json(formatDigestResponse(digest));
  } catch (error) {
    next(error);
  }
});

router.post("/api/executive/digest/generate", requireAuth, requireRole("ADMIN", "MANAGER", "HUSTLER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await checkDigestFeatureFlag(req, res))) return;

    const orgId = req.user!.organizationId!;
    const period = req.body.period || "daily";
    if (!["daily", "weekly", "monthly"].includes(period)) {
      return res.status(400).json({ error: "Invalid period" });
    }

    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const orgName = org?.name || "Organization";

    const activeProjectsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.status, "ACTIVE"), eq(projects.gcOrganizationId, orgId)));
    const activeProjects = activeProjectsResult[0]?.count || 0;

    const totalProjectsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.gcOrganizationId, orgId));
    const totalProjects = totalProjectsResult[0]?.count || 0;

    const completedProjectsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.status, "COMPLETE"), eq(projects.gcOrganizationId, orgId)));
    const completedProjects = completedProjectsResult[0]?.count || 0;

    const pendingCOResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(and(eq(changeOrders.status, "SUBMITTED"), eq(projects.gcOrganizationId, orgId)));
    const pendingChangeOrders = pendingCOResult[0]?.count || 0;

    const approvedCOResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(changeOrders)
      .innerJoin(projects, eq(changeOrders.projectId, projects.id))
      .where(and(eq(changeOrders.status, "APPROVED"), eq(projects.gcOrganizationId, orgId)));
    const approvedChangeOrders = approvedCOResult[0]?.count || 0;

    const openBidsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bids)
      .where(and(eq(bids.status, "DRAFT"), eq(bids.gcOrganizationId, orgId)));
    const openBids = openBidsResult[0]?.count || 0;

    const projectsList = await db
      .select({
        name: projects.name,
        status: projects.status,
        contractAmount: projects.contractAmount,
      })
      .from(projects)
      .where(eq(projects.gcOrganizationId, orgId))
      .orderBy(desc(projects.updatedAt))
      .limit(10);

    const dataContext = `
Organization: ${orgName}
Period: ${period}

Project Statistics:
- Total projects: ${totalProjects}
- Active projects: ${activeProjects}
- Completed projects: ${completedProjects}

Change Orders:
- Pending approval: ${pendingChangeOrders}
- Approved: ${approvedChangeOrders}

Bids:
- Open/Draft bids: ${openBids}

Recent Projects:
${projectsList.map((p) => `- ${p.name} (${p.status}) - Contract: $${p.contractAmount || "N/A"}`).join("\n")}
`;

    const systemPrompt = `You are an executive business intelligence analyst for a construction company. Generate a comprehensive ${period} executive digest based on the organization's data.

You MUST respond with valid JSON matching this exact structure:
{
  "executiveSummary": "A 2-3 sentence overview of the organization's current state",
  "keyHighlights": ["highlight1", "highlight2", "highlight3"],
  "sections": [
    {
      "title": "Section Title",
      "icon": "financial|operational|risk|opportunity",
      "summary": "Brief section summary",
      "bullets": ["bullet1", "bullet2"],
      "sentiment": "positive|neutral|negative"
    }
  ],
  "actionItems": [
    {
      "priority": "high|medium|low",
      "description": "Action item description",
      "dueBy": "Optional due date string"
    }
  ],
  "kpiSnapshot": [
    {
      "name": "KPI Name",
      "current": 100,
      "previous": 90,
      "unit": "$|%|#",
      "trend": "up|down|stable"
    }
  ]
}

Requirements:
- Generate 3-5 key highlights
- Include exactly 4 sections covering financial, operational, risk, and opportunity areas
- Include 3-6 action items prioritized by urgency
- Include 4-6 KPIs with realistic current/previous values based on the data
- Make the content specific to the data provided, not generic
- Use dollar amounts that make sense for a construction company
- Ensure all JSON is valid and parseable`;

    const aiResult = await governedAiCall({
      orgId,
      userId: req.user!.id,
      actionType: "executive_digest_generation",
      inputRefs: { period, orgId },
      fn: async () => {
        const completion = await routedGeneralChatCompletion({
          orgId,
          featureKey: "general.executive_digest",
          request: {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: dataContext },
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 4096,
          },
        });

        const content = completion.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(content);
        return { result: parsed, completion };
      },
    });

    if (aiResult.blocked) {
      return res.status(429).json({ error: aiResult.reason || "AI usage limit exceeded" });
    }

    const parseResult = digestOutputSchema.safeParse(aiResult.result);
    if (!parseResult.success) {
      return next(new Error(`Failed to parse executive digest AI output: ${JSON.stringify(parseResult.error.format())}`));
    }

    const digestData = parseResult.data;

    const saved = await createExecutiveDigest({
      organizationId: orgId,
      period,
      executiveSummary: digestData.executiveSummary,
      keyHighlights: digestData.keyHighlights,
      sections: digestData.sections,
      actionItems: digestData.actionItems,
      kpiSnapshot: digestData.kpiSnapshot,
      generatedBy: req.user!.id,
    });

    res.json(formatDigestResponse(saved));
  } catch (error) {
    next(error);
  }
});

export default router;
