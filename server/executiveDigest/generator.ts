// prompt-injection-guard: system-prompt-anchored summarization over tenant-internal aggregated KPIs; no third-party text
//
// Shared executive-digest generator. Extracted from
// server/executiveDigestRoutes.ts so the daily cron in
// server/jobs/jobRunner.ts can produce digests without duplicating
// the AI prompt + data-context assembly.

import { db } from "../db";
import { projects, changeOrders, bids, organizations } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { routedGeneralChatCompletion } from "../ai/providers";
import { governedAiCall } from "../services/aiGovernance";
import { createExecutiveDigest } from "./storage";

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

export type GenerateExecutiveDigestResult =
  | { ok: true; digestId: string; orgName: string }
  | { ok: false; reason: string };

/**
 * Generate one executive digest for `orgId` over `period`
 * ("daily"|"weekly"|"monthly") and persist it via createExecutiveDigest.
 * Returns ok:false (with a reason) on AI governance block or schema-
 * validation failure so the caller can record the outcome without
 * throwing.
 */
export async function generateExecutiveDigest(opts: {
  orgId: string;
  period: "daily" | "weekly" | "monthly";
  userId: string;
}): Promise<GenerateExecutiveDigestResult> {
  const { orgId, period, userId } = opts;

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const orgName = org?.name || "Organization";

  const [activeProjectsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.status, "ACTIVE"), eq(projects.gcOrganizationId, orgId)));
  const activeProjects = activeProjectsRow?.count || 0;

  const [totalProjectsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.gcOrganizationId, orgId));
  const totalProjects = totalProjectsRow?.count || 0;

  const [completedProjectsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.status, "COMPLETE"), eq(projects.gcOrganizationId, orgId)));
  const completedProjects = completedProjectsRow?.count || 0;

  const [pendingCORow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(changeOrders)
    .innerJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(and(eq(changeOrders.status, "SUBMITTED"), eq(projects.gcOrganizationId, orgId)));
  const pendingChangeOrders = pendingCORow?.count || 0;

  const [approvedCORow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(changeOrders)
    .innerJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(and(eq(changeOrders.status, "APPROVED"), eq(projects.gcOrganizationId, orgId)));
  const approvedChangeOrders = approvedCORow?.count || 0;

  const [openBidsRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bids)
    .where(and(eq(bids.status, "DRAFT"), eq(bids.gcOrganizationId, orgId)));
  const openBids = openBidsRow?.count || 0;

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
    userId,
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
    return { ok: false, reason: aiResult.reason || "AI usage limit exceeded" };
  }

  const parseResult = digestOutputSchema.safeParse(aiResult.result);
  if (!parseResult.success) {
    return { ok: false, reason: `Schema validation failed: ${JSON.stringify(parseResult.error.format())}` };
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
    generatedBy: userId,
  });

  return { ok: true, digestId: saved.id, orgName };
}
