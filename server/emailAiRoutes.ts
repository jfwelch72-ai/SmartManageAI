import { Router } from "express";
import { db } from "./db";
import { 
  emailThreads, 
  emailMessages,
  emailAttachments,
  tasks,
  emailSummaries,
  emailAccounts,
  type EmailThread,
  type EmailMessage,
  type Task,
  emailClassificationEnum,
  emailThreadStatusEnum
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, inArray, or, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate, logAudit } from "./auditLogger";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { 
  analyzeEmail, 
  summarizeThread, 
  suggestReplies,
  generateEmailSummary,
  matchEmailToEntities,
  createTaskFromEmail,
  type EmailAnalysisResult
} from "./ai/emailAi";

const router = Router();

// ==========================================
// EMAIL THREADS ROUTES
// ==========================================

// GET /api/email/threads - List email threads
router.get("/threads", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, classification, projectId, limit = '50', offset = '0' } = req.query;

    let query = db
      .select()
      .from(emailThreads)
      .where(eq(emailThreads.organizationId, orgId))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    // Build conditions
    const conditions = [eq(emailThreads.organizationId, orgId)];
    
    if (status && emailThreadStatusEnum.enumValues.includes(status as any)) {
      conditions.push(eq(emailThreads.status, status as any));
    }
    
    if (classification && emailClassificationEnum.enumValues.includes(classification as any)) {
      conditions.push(eq(emailThreads.primaryClassification, classification as any));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(emailThreads.projectId, projectId));
    }

    const threads = await db
      .select()
      .from(emailThreads)
      .where(and(...conditions))
      .orderBy(desc(emailThreads.lastMessageAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(threads);
  } catch (error) {
    console.error("Error fetching email threads:", error);
    return res.status(500).json({ error: "Failed to fetch email threads" });
  }
});

// GET /api/email/threads/:id - Get single thread with messages
router.get("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
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

    // Get messages for this thread
    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    // Get tasks linked to this thread (using unified tasks table with sourceType filter)
    const linkedTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.emailThreadId, thread.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .orderBy(desc(tasks.createdAt));

    return res.json({
      thread,
      messages,
      tasks: linkedTasks,
    });
  } catch (error) {
    console.error("Error fetching email thread:", error);
    return res.status(500).json({ error: "Failed to fetch email thread" });
  }
});

// PATCH /api/email/threads/:id - Update thread (status, link to project, etc.)
router.patch("/threads/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      status: z.enum(emailThreadStatusEnum.enumValues).optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const [existing] = await db
      .select()
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.id, req.params.id),
          eq(emailThreads.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Thread not found" });
    }

    const data = parseResult.data;

    // Verify linked entities belong to the same organization (mustDenyAccess pattern)
    // Projects and bids use gcOrganizationId (General Contractor mode) for multi-tenant isolation
    if (data.projectId) {
      const { projects } = await import("@shared/schema");
      const [project] = await db
        .select({ gcOrganizationId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, data.projectId))
        .limit(1);
      
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      // Enforce multi-tenant isolation using gcOrganizationId
      if (project.gcOrganizationId && project.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Project belongs to another organization" });
      }
    }

    if (data.bidId) {
      const { bids } = await import("@shared/schema");
      const [bid] = await db
        .select({ gcOrganizationId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, data.bidId))
        .limit(1);
      
      if (!bid) {
        return res.status(404).json({ error: "Bid not found" });
      }
      // Enforce multi-tenant isolation using gcOrganizationId
      if (bid.gcOrganizationId && bid.gcOrganizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Bid belongs to another organization" });
      }
    }

    // Vendors (CRM organisations) use organizationId for multi-tenant isolation
    if (data.vendorId) {
      const { crmOrganisations } = await import("@shared/schema");
      const [vendor] = await db
        .select({ organizationId: crmOrganisations.organizationId })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, data.vendorId))
        .limit(1);
      
      if (!vendor) {
        return res.status(404).json({ error: "Vendor not found" });
      }
      if (vendor.organizationId && vendor.organizationId !== orgId) {
        return res.status(403).json({ error: "Access denied: Vendor belongs to another organization" });
      }
    }

    const [updated] = await db
      .update(emailThreads)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(emailThreads.id, req.params.id))
      .returning();

    await logUpdate(
      req.user.id,
      "EMAIL_THREAD",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
    console.error("Error updating email thread:", error);
    return res.status(500).json({ error: "Failed to update email thread" });
  }
});

// ==========================================
// EMAIL MESSAGES ROUTES
// ==========================================

// GET /api/email/messages - List messages (optionally filtered by thread)
router.get("/messages", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { threadId, limit = '50', offset = '0' } = req.query;

    const conditions = [eq(emailMessages.organizationId, orgId)];
    
    if (threadId && typeof threadId === 'string') {
      conditions.push(eq(emailMessages.threadId, threadId));
    }

    const messages = await db
      .select()
      .from(emailMessages)
      .where(and(...conditions))
      .orderBy(desc(emailMessages.receivedAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(messages);
  } catch (error) {
    console.error("Error fetching email messages:", error);
    return res.status(500).json({ error: "Failed to fetch email messages" });
  }
});

// GET /api/email/messages/:id - Get single message with attachments
router.get("/messages/:id", requireAuth, async (req: AuthRequest, res) => {
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

    // Get attachments
    const attachments = await db
      .select()
      .from(emailAttachments)
      .where(eq(emailAttachments.emailMessageId, message.id));

    return res.json({
      message,
      attachments,
    });
  } catch (error) {
    console.error("Error fetching email message:", error);
    return res.status(500).json({ error: "Failed to fetch email message" });
  }
});

// POST /api/email/messages/:id/analyze - Run AI analysis on a message
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

    // Run AI analysis
    const analysis = await analyzeEmail(
      message.subject,
      message.bodyText || message.bodyHtml || '',
      message.fromAddress,
      orgId
    );

    // Match to existing entities
    const matchedEntities = await matchEmailToEntities(analysis, orgId);

    // Update message with classification
    await db
      .update(emailMessages)
      .set({
        classification: analysis.classification as any,
        aiMetadata: JSON.stringify(analysis),
        aiAnalyzedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(emailMessages.id, message.id));

    // Update thread with primary classification if not set
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

    // Create task if needed
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

    // Audit log
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

// POST /api/email/messages/:id/suggest-reply - Get AI-generated reply suggestions
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

    const drafts = await suggestReplies(
      {
        subject: message.subject,
        body: message.bodyText || message.bodyHtml || '',
        fromAddress: message.fromAddress,
      },
      tones as Array<'professional' | 'casual' | 'firm'>
    );

    return res.json({ drafts });
  } catch (error) {
    console.error("Error generating reply suggestions:", error);
    return res.status(500).json({ error: "Failed to generate reply suggestions" });
  }
});

// ==========================================
// THREAD SUMMARY & AI FEATURES
// ==========================================

// POST /api/email/threads/:id/summarize - Get AI summary of a thread
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

    // Get messages for summarization
    const messages = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.threadId, thread.id))
      .orderBy(emailMessages.receivedAt);

    if (messages.length === 0) {
      return res.json({ summary: "No messages in this thread." });
    }

    const summary = await summarizeThread(
      messages.map(m => ({
        fromAddress: m.fromAddress,
        fromName: m.fromName ?? undefined,
        subject: m.subject,
        bodyText: m.bodyText ?? undefined,
        receivedAt: m.receivedAt,
      }))
    );

    // Save summary to thread
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

// ==========================================
// EMAIL SUMMARIES (DAILY/WEEKLY)
// ==========================================

// POST /api/email/summary/daily - Generate daily email summary
router.post("/summary/daily", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Get emails from last 24 hours
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

    const summary = await generateEmailSummary(
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

    // Save summary
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

// POST /api/email/summary/weekly - Generate weekly email summary
router.post("/summary/weekly", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Get emails from last 7 days
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

    const summary = await generateEmailSummary(
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

    // Save summary
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

// GET /api/email/summary/latest - Get latest summaries
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

// ==========================================
// EMAIL TASKS (using unified tasks table)
// ==========================================

// GET /api/email/tasks - List email-linked tasks
router.get("/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const { status, projectId, limit = '50', offset = '0' } = req.query;

    // Query unified tasks table filtering by email source types (backward-compatible)
    const conditions = [
      eq(tasks.organizationId, orgId),
      or(
        eq(tasks.sourceType, 'EMAIL'),
        eq(tasks.sourceType, 'AI_GENERATED'),
        eq(tasks.sourceType, 'SYSTEM'),
        isNotNull(tasks.emailThreadId)
      )
    ];
    
    if (status && ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED'].includes(status as string)) {
      conditions.push(eq(tasks.status, status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED"));
    }
    
    if (projectId && typeof projectId === 'string') {
      conditions.push(eq(tasks.projectId, projectId));
    }

    const taskResults = await db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(Math.min(parseInt(limit as string) || 50, 100))
      .offset(parseInt(offset as string) || 0);

    return res.json(taskResults);
  } catch (error) {
    console.error("Error fetching email tasks:", error);
    return res.status(500).json({ error: "Failed to fetch email tasks" });
  }
});

// POST /api/email/tasks - Create a task from email (uses unified tasks table)
router.post("/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const taskSchema = z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
      dueDate: z.string().datetime().optional(),
      emailThreadId: z.string().uuid().optional(),
      emailMessageId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      bidId: z.string().uuid().optional(),
      vendorId: z.string().uuid().optional(),
      assignedToId: z.string().uuid().optional(),
      sourceType: z.enum(['MANUAL', 'EMAIL', 'AI_GENERATED', 'SYSTEM']).default('EMAIL'),
    });

    const parseResult = taskSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const data = parseResult.data;

    const [task] = await db
      .insert(tasks)
      .values({
        organizationId: orgId,
        createdById: req.user.id,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        emailThreadId: data.emailThreadId,
        emailMessageId: data.emailMessageId,
        projectId: data.projectId,
        bidId: data.bidId,
        vendorId: data.vendorId,
        assignedToId: data.assignedToId,
        status: 'PENDING',
        sourceType: data.sourceType,
      })
      .returning();

    await logCreate(req.user.id, "TASK", task.id, { title: task.title, sourceType: task.sourceType }, req);

    return res.status(201).json(task);
  } catch (error) {
    console.error("Error creating email task:", error);
    return res.status(500).json({ error: "Failed to create email task" });
  }
});

// PATCH /api/email/tasks/:id - Update a task (uses unified tasks table)
router.patch("/tasks/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    const updateSchema = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(2000).optional(),
      status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED']).optional(),
      priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
      dueDate: z.string().datetime().nullable().optional(),
      assignedToId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      bidId: z.string().uuid().nullable().optional(),
      vendorId: z.string().uuid().nullable().optional(),
    });

    const parseResult = updateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: fromZodError(parseResult.error).message });
    }

    const [existing] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, req.params.id),
          eq(tasks.organizationId, orgId)
        )
      )
      .limit(1);

    if (!existing) {
      return res.status(404).json({ error: "Task not found" });
    }

    const data = parseResult.data;
    const updateData: Partial<Task> & { updatedAt: Date } = {
      updatedAt: new Date(),
    };

    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.assignedToId !== undefined) updateData.assignedToId = data.assignedToId;
    if (data.projectId !== undefined) updateData.projectId = data.projectId;
    if (data.bidId !== undefined) updateData.bidId = data.bidId;
    if (data.vendorId !== undefined) updateData.vendorId = data.vendorId;

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    }

    if (data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
      updateData.completedById = req.user.id;
    }

    if (data.status === 'DISMISSED') {
      updateData.dismissedAt = new Date();
      updateData.dismissedById = req.user.id;
    }

    const [updated] = await db
      .update(tasks)
      .set(updateData)
      .where(eq(tasks.id, req.params.id))
      .returning();

    await logUpdate(
      req.user.id,
      "TASK",
      updated.id,
      { status: existing.status },
      { status: updated.status },
      req
    );

    return res.json(updated);
  } catch (error) {
    console.error("Error updating email task:", error);
    return res.status(500).json({ error: "Failed to update email task" });
  }
});

// ==========================================
// EMAIL SYNC (Manual trigger)
// ==========================================

// POST /api/email/sync - Trigger email sync for current user
router.post("/sync", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization required" });
    }

    // Get active email accounts for this user
    const accounts = await db
      .select()
      .from(emailAccounts)
      .where(
        and(
          eq(emailAccounts.organizationId, orgId),
          eq(emailAccounts.userId, req.user.id),
          eq(emailAccounts.isActive, true)
        )
      );

    if (accounts.length === 0) {
      return res.json({ 
        success: true, 
        message: "No active email accounts to sync",
        accountsProcessed: 0
      });
    }

    // For now, just update lastSyncedAt - actual sync implementation
    // would go through emailIngestService for each account
    for (const account of accounts) {
      await db
        .update(emailAccounts)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(emailAccounts.id, account.id));
    }

    // Note: Real implementation would call emailIngestService here
    // This is a placeholder that marks accounts as synced

    return res.json({
      success: true,
      message: `Email sync triggered for ${accounts.length} account(s)`,
      accountsProcessed: accounts.length,
      note: "Full email ingestion requires provider-specific implementation (Gmail API, MS Graph, IMAP)"
    });
  } catch (error) {
    console.error("Error syncing emails:", error);
    return res.status(500).json({ error: "Failed to sync emails" });
  }
});

export default router;
