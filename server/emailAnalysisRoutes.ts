import { Router } from "express";
import { db } from "./db";
import { 
  emailThreads, 
  emailMessages,
  emailSummaries,
  tasks,
} from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logAudit } from "./auditLogger";
import { z } from "zod";
import { 
  analyzeEmail, 
  summarizeThread, 
  suggestReplies,
  generateEmailSummary,
  matchEmailToEntities,
  createTaskFromEmail,
  type EmailAnalysisResult
} from "./ai/emailAi";
import { governedAiCall } from "./services/aiGovernance";

const router = Router();

router.post("/messages/:id/analyze", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const governedAnalysis = await governedAiCall<EmailAnalysisResult>({
      orgId,
      userId: req.user.id,
      actionType: "email_message_analysis",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await analyzeEmail(
          message.subject,
          message.bodyText || message.bodyHtml || '',
          message.fromAddress,
          orgId
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedAnalysis.blocked) {
      return res.status(429).json({ error: governedAnalysis.reason || "AI rate limit reached" });
    }

    const analysis = governedAnalysis.result;

    const matchedEntities = await matchEmailToEntities(analysis, orgId);

    await db
      .update(emailMessages)
      .set({
        classification: analysis.classification as any,
        aiMetadata: JSON.stringify(analysis),
        aiAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, message.id));

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.id, message.threadId))
      .limit(1);

    if (thread && !thread.primaryClassification) {
      await db
        .update(emailThreads)
        .set({
          primaryClassification: analysis.classification as any,
          projectId: matchedEntities.projectId || thread.projectId,
          bidId: matchedEntities.bidId || thread.bidId,
          vendorId: matchedEntities.vendorId || thread.vendorId,
          updatedAt: new Date(),
        })
        .where(eq(emailThreads.id, thread.id));
    }

    let taskId: string | null = null;
    if (analysis.requiresResponse && analysis.suggestedTaskTitle) {
      taskId = await createTaskFromEmail(
        analysis,
        message.id,
        message.threadId,
        orgId,
        req.user.id,
        matchedEntities
      );

      if (taskId) {
        await logCreate(req.user.id, "EMAIL_TASK", taskId, {
          source: "AI_ANALYSIS",
          messageId: message.id,
        }, req);
      }
    }

    await logAudit({
      userId: req.user.id,
      entityType: "EMAIL_MESSAGE",
      entityId: message.id,
      action: "UPDATE",
      oldValue: null,
      newValue: JSON.stringify({ classification: analysis.classification }),
    }, req);

    return res.json({
      analysis,
      matchedEntities,
      taskCreated: taskId ? true : false,
      taskId,
    });
  } catch (error) {
    console.error("Error analyzing email:", error);
    return res.status(500).json({ error: "Failed to analyze email" });
  }
});

router.post("/messages/:id/suggest-reply", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const toneSchema = z.object({
      tones: z.array(z.enum(['professional', 'casual', 'firm'])).default(['professional']),
    });

    const parseResult = toneSchema.safeParse(req.body);
    const tones = parseResult.success ? parseResult.data.tones : ['professional'] as const;

    const [message] = await db
      .select()
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.id, req.params.id),
          eq(emailMessages.organizationId, orgId)
        )
      )
      .limit(1);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const governedReplies = await governedAiCall<import("./ai/emailAi").ReplyDraft[]>({
      orgId,
      userId: req.user.id,
      actionType: "email_suggest_reply",
      inputRefs: { messageId: message.id },
      fn: async () => {
        const result = await suggestReplies(
          {
            subject: message.subject,
            body: message.bodyText || message.bodyHtml || '',
            fromAddress: message.fromAddress,
          },
          tones as Array<'professional' | 'casual' | 'firm'>
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedReplies.blocked) {
      return res.status(429).json({ error: governedReplies.reason || "AI rate limit reached" });
    }

    const drafts = governedReplies.result;

    return res.json({ drafts });
  } catch (error) {
    console.error("Error generating reply suggestions:", error);
    return res.status(500).json({ error: "Failed to generate reply suggestions" });
  }
});

router.post("/threads/:id/summarize", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const [thread] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    if (messages.length === 0) {
      return res.json({ summary: "No messages in this thread." });
    }

    const governedSummary = await governedAiCall<import("./ai/emailAi").ThreadSummaryResult>({
      orgId,
      userId: req.user.id,
      actionType: "email_thread_summary",
      inputRefs: { threadId: thread.id },
      fn: async () => {
        const result = await summarizeThread(
          messages.map(m => ({
            fromAddress: m.fromAddress,
            fromName: m.fromName ?? undefined,
            subject: m.subject,
            bodyText: m.bodyText ?? undefined,
            receivedAt: m.receivedAt,
          }))
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedSummary.blocked) {
      return res.status(429).json({ error: governedSummary.reason || "AI rate limit reached" });
    }

    const summary = governedSummary.result;

    await db
      .update(emailThreads)
      .set({
        aiSummary: summary.summary,
        aiMetadata: JSON.stringify(summary),
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, thread.id));

    return res.json(summary);
  } catch (error) {
    console.error("Error summarizing thread:", error);
    return res.status(500).json({ error: "Failed to summarize thread" });
  }
});

router.post("/summary/daily", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneDayAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(100);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 24 hours",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 24 hours.",
      });
    }

    const governedDaily = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user.id,
      actionType: "email_daily_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'DAILY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedDaily.blocked) {
      return res.status(429).json({ error: governedDaily.reason || "AI rate limit reached" });
    }

    const summary = governedDaily.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user.id,
      summaryType: 'DAILY',
      periodStart: oneDayAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
    console.error("Error generating daily summary:", error);
    return res.status(500).json({ error: "Failed to generate daily summary" });
  }
});

router.post("/summary/weekly", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const recentMessages = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
        subject: emailMessages.subject,
        fromAddress: emailMessages.fromAddress,
        snippet: emailMessages.snippet,
        classification: emailMessages.classification,
        receivedAt: emailMessages.receivedAt,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.organizationId, orgId),
          gte(emailMessages.receivedAt, oneWeekAgo)
        )
      )
      .orderBy(desc(emailMessages.receivedAt))
      .limit(200);

    if (recentMessages.length === 0) {
      return res.json({
        periodDescription: "Last 7 days",
        totalEmails: 0,
        byClassification: {},
        highlights: [],
        actionNeeded: [],
        summaryNarrative: "No new emails in the last 7 days.",
      });
    }

    const governedWeekly = await governedAiCall<import("./ai/emailAi").EmailSummaryDigest>({
      orgId,
      userId: req.user.id,
      actionType: "email_weekly_summary",
      inputRefs: { messageCount: recentMessages.length },
      fn: async () => {
        const result = await generateEmailSummary(
          recentMessages.map(m => ({
            classification: m.classification ?? undefined,
            subject: m.subject,
            fromAddress: m.fromAddress,
            snippet: m.snippet ?? undefined,
            threadId: m.threadId,
            receivedAt: m.receivedAt,
          })),
          'WEEKLY'
        );
        return { result, completion: { usage: { prompt_tokens: 0, completion_tokens: 0 }, model: "gpt-4o" } };
      },
    });

    if (governedWeekly.blocked) {
      return res.status(429).json({ error: governedWeekly.reason || "AI rate limit reached" });
    }

    const summary = governedWeekly.result;

    await db.insert(emailSummaries).values({
      organizationId: orgId,
      userId: req.user.id,
      summaryType: 'WEEKLY',
      periodStart: oneWeekAgo,
      periodEnd: new Date(),
      summaryContent: summary.summaryNarrative,
      highlightsJson: JSON.stringify(summary.highlights),
      emailCount: summary.totalEmails,
      tasksCreated: 0,
    });

    return res.json(summary);
  } catch (error) {
    console.error("Error generating weekly summary:", error);
    return res.status(500).json({ error: "Failed to generate weekly summary" });
  }
});

router.get("/summary/latest", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const summaries = await db
      .select()
      .from(emailSummaries)
      .where(
        and(
          eq(emailSummaries.organizationId, orgId),
          eq(emailSummaries.userId, req.user.id)
        )
      )
      .orderBy(desc(emailSummaries.createdAt))
      .limit(5);

    return res.json(summaries);
  } catch (error) {
    console.error("Error fetching summaries:", error);
    return res.status(500).json({ error: "Failed to fetch summaries" });
  }
});

export default router;
