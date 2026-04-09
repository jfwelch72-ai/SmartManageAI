import { logError } from "./utils/logger";
import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { voiceLogs, issueCaptures, offlineSyncQueue, media, projects, insertVoiceLogSchema, insertIssueCaptureSchema, insertOfflineSyncQueueSchema } from "@shared/schema";
import { eq, and, desc, sql, inArray, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { ObjectStorageService } from "./objectStorage";

const router = Router();

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    organizationId: string;
    role: string;
  };
}

const ALL_INTERNAL_ROLES = ["SUPER_ADMIN", "ADMIN", "HUSTLER", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FIELD_WORKER"];

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireInternalRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const role = (req as any).user?.effectiveRole || req.user?.role;
  if (!role || !ALL_INTERNAL_ROLES.includes(role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  next();
}

// ==========================================
// VOICE LOGS ROUTES
// ==========================================

router.get("/voice-logs", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, status, limit = "50", offset = "0" } = req.query;
    const organizationId = req.user!.organizationId;

    let conditions = [eq(voiceLogs.organizationId, organizationId)];

    if (projectId && typeof projectId === "string") {
      conditions.push(eq(voiceLogs.projectId, projectId));
    }

    if (status && typeof status === "string") {
      conditions.push(eq(voiceLogs.status, status as any));
    }

    const logs = await db
      .select()
      .from(voiceLogs)
      .where(and(...conditions))
      .orderBy(desc(voiceLogs.createdAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    res.json(logs);
  } catch (error) {
    logError("Error fetching voice logs:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch voice logs" });
  }
});

router.get("/voice-logs/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const [log] = await db
      .select()
      .from(voiceLogs)
      .where(and(eq(voiceLogs.id, id), eq(voiceLogs.organizationId, organizationId)));

    if (!log) {
      return res.status(404).json({ error: "Voice log not found" });
    }

    res.json(log);
  } catch (error) {
    logError("Error fetching voice log:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch voice log" });
  }
});

router.post("/voice-logs", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const data = insertVoiceLogSchema.parse({
      ...req.body,
      organizationId,
      userId,
    });

    const [log] = await db.insert(voiceLogs).values(data).returning();
    res.status(201).json(log);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error creating voice log:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create voice log" });
  }
});

const voiceLogUpdateSchema = z.object({
  projectId: z.string().optional(),
  transcription: z.string().optional(),
  status: z.enum(["PENDING", "TRANSCRIBED", "FAILED"]).optional(),
  errorMessage: z.string().optional(),
  aiSummary: z.string().optional(),
  aiTags: z.array(z.string()).optional(),
  aiSentiment: z.string().optional(),
});

router.patch("/voice-logs/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const [existing] = await db
      .select()
      .from(voiceLogs)
      .where(and(eq(voiceLogs.id, id), eq(voiceLogs.organizationId, organizationId)));

    if (!existing) {
      return res.status(404).json({ error: "Voice log not found" });
    }

    const validated = voiceLogUpdateSchema.parse(req.body);
    const forceOverwrite = req.headers['x-force-overwrite'] === 'true';

    if (!forceOverwrite && req.body.lastKnownUpdatedAt) {
      const clientUpdatedAt = new Date(req.body.lastKnownUpdatedAt).getTime();
      const serverUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (serverUpdatedAt > clientUpdatedAt) {
        return res.status(409).json({
          error: "Conflict: server version is newer",
          serverUpdatedAt: existing.updatedAt,
          serverData: existing,
        });
      }
    }

    const updates: Record<string, unknown> = {
      ...validated,
      updatedAt: new Date(),
    };

    if (validated.status === "TRANSCRIBED" && !existing.transcribedAt) {
      updates.transcribedAt = new Date();
    }

    const [updated] = await db
      .update(voiceLogs)
      .set(updates)
      .where(and(eq(voiceLogs.id, id), eq(voiceLogs.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error updating voice log:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update voice log" });
  }
});

router.delete("/voice-logs/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const [existing] = await db
      .select()
      .from(voiceLogs)
      .where(and(eq(voiceLogs.id, id), eq(voiceLogs.organizationId, organizationId)));

    if (!existing) {
      return res.status(404).json({ error: "Voice log not found" });
    }

    await db.delete(voiceLogs).where(eq(voiceLogs.id, id));
    res.status(204).send();
  } catch (error) {
    logError("Error deleting voice log:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete voice log" });
  }
});

// ==========================================
// ISSUE CAPTURES ROUTES
// ==========================================

router.get("/issue-captures", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId, status, severity, limit = "50", offset = "0" } = req.query;
    const organizationId = req.user!.organizationId;

    let conditions = [eq(issueCaptures.organizationId, organizationId)];

    if (projectId && typeof projectId === "string") {
      conditions.push(eq(issueCaptures.projectId, projectId));
    }

    if (status && typeof status === "string") {
      conditions.push(eq(issueCaptures.status, status as any));
    }

    if (severity && typeof severity === "string") {
      conditions.push(eq(issueCaptures.severity, severity as any));
    }

    const issues = await db
      .select()
      .from(issueCaptures)
      .where(and(...conditions))
      .orderBy(desc(issueCaptures.createdAt))
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    res.json(issues);
  } catch (error) {
    logError("Error fetching issue captures:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch issue captures" });
  }
});

router.get("/issue-captures/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const [issue] = await db
      .select()
      .from(issueCaptures)
      .where(and(eq(issueCaptures.id, id), eq(issueCaptures.organizationId, organizationId)));

    if (!issue) {
      return res.status(404).json({ error: "Issue capture not found" });
    }

    res.json(issue);
  } catch (error) {
    logError("Error fetching issue capture:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch issue capture" });
  }
});

router.post("/issue-captures", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const createdById = req.user!.id;

    const data = insertIssueCaptureSchema.parse({
      ...req.body,
      organizationId,
      createdById,
    });

    const [issue] = await db.insert(issueCaptures).values(data).returning();
    res.status(201).json(issue);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error creating issue capture:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create issue capture" });
  }
});

const issueCaptureUpdateSchema = z.object({
  projectId: z.string().optional(),
  assignedToId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  photoUrls: z.array(z.string()).optional(),
  photoObjectKeys: z.array(z.string()).optional(),
  location: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  tradeAffected: z.string().optional(),
  category: z.string().optional(),
  resolutionNotes: z.string().optional(),
  aiAnalysis: z.string().optional(),
  aiRecommendations: z.string().optional(),
});

router.patch("/issue-captures/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const [existing] = await db
      .select()
      .from(issueCaptures)
      .where(and(eq(issueCaptures.id, id), eq(issueCaptures.organizationId, organizationId)));

    if (!existing) {
      return res.status(404).json({ error: "Issue capture not found" });
    }

    const validated = issueCaptureUpdateSchema.parse(req.body);
    const forceOverwrite = req.headers['x-force-overwrite'] === 'true';

    if (!forceOverwrite && req.body.lastKnownUpdatedAt) {
      const clientUpdatedAt = new Date(req.body.lastKnownUpdatedAt).getTime();
      const serverUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (serverUpdatedAt > clientUpdatedAt) {
        return res.status(409).json({
          error: "Conflict: server version is newer",
          serverUpdatedAt: existing.updatedAt,
          serverData: existing,
        });
      }
    }

    const updates: Record<string, unknown> = {
      ...validated,
      updatedAt: new Date(),
    };

    if (validated.status === "RESOLVED" && existing.status !== "RESOLVED") {
      updates.resolvedAt = new Date();
      updates.resolvedById = userId;
    }

    const [updated] = await db
      .update(issueCaptures)
      .set(updates)
      .where(and(eq(issueCaptures.id, id), eq(issueCaptures.organizationId, organizationId)))
      .returning();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error updating issue capture:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update issue capture" });
  }
});

router.delete("/issue-captures/:id", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user!.organizationId;

    const [existing] = await db
      .select()
      .from(issueCaptures)
      .where(and(eq(issueCaptures.id, id), eq(issueCaptures.organizationId, organizationId)));

    if (!existing) {
      return res.status(404).json({ error: "Issue capture not found" });
    }

    await db.delete(issueCaptures).where(eq(issueCaptures.id, id));
    res.status(204).send();
  } catch (error) {
    logError("Error deleting issue capture:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete issue capture" });
  }
});

// Issue stats endpoint
router.get("/issue-captures/stats/summary", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const { projectId } = req.query;

    let conditions = [eq(issueCaptures.organizationId, organizationId)];
    if (projectId && typeof projectId === "string") {
      conditions.push(eq(issueCaptures.projectId, projectId));
    }

    const issues = await db
      .select()
      .from(issueCaptures)
      .where(and(...conditions));

    const stats = {
      total: issues.length,
      open: issues.filter(i => i.status === "OPEN").length,
      inProgress: issues.filter(i => i.status === "IN_PROGRESS").length,
      resolved: issues.filter(i => i.status === "RESOLVED").length,
      closed: issues.filter(i => i.status === "CLOSED").length,
      bySeverity: {
        critical: issues.filter(i => i.severity === "CRITICAL").length,
        high: issues.filter(i => i.severity === "HIGH").length,
        medium: issues.filter(i => i.severity === "MEDIUM").length,
        low: issues.filter(i => i.severity === "LOW").length,
      },
    };

    res.json(stats);
  } catch (error) {
    logError("Error fetching issue stats:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch issue stats" });
  }
});

// ==========================================
// OFFLINE SYNC QUEUE ROUTES
// ==========================================

router.get("/offline-sync", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, entityType, limit = "100" } = req.query;
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    let conditions = [
      eq(offlineSyncQueue.organizationId, organizationId),
      eq(offlineSyncQueue.userId, userId),
    ];

    if (status && typeof status === "string") {
      conditions.push(eq(offlineSyncQueue.status, status as any));
    }

    if (entityType && typeof entityType === "string") {
      conditions.push(eq(offlineSyncQueue.entityType, entityType as any));
    }

    const queue = await db
      .select()
      .from(offlineSyncQueue)
      .where(and(...conditions))
      .orderBy(desc(offlineSyncQueue.createdAt))
      .limit(parseInt(limit as string));

    res.json(queue);
  } catch (error) {
    logError("Error fetching offline sync queue:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch offline sync queue" });
  }
});

router.post("/offline-sync", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;

    const data = insertOfflineSyncQueueSchema.parse({
      ...req.body,
      organizationId,
      userId,
    });

    const [item] = await db.insert(offlineSyncQueue).values(data).returning();
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error creating offline sync item:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create offline sync item" });
  }
});

router.post("/offline-sync/batch", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const userId = req.user!.id;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Items array is required" });
    }

    const validatedItems = items.map((item: any) => 
      insertOfflineSyncQueueSchema.parse({
        ...item,
        organizationId,
        userId,
      })
    );

    const inserted = await db.insert(offlineSyncQueue).values(validatedItems).returning();
    res.status(201).json(inserted);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error creating batch offline sync items:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create batch offline sync items" });
  }
});

const offlineSyncUpdateSchema = z.object({
  status: z.enum(["PENDING", "SYNCED", "FAILED"]).optional(),
  syncedEntityId: z.string().optional(),
  errorMessage: z.string().optional(),
});

router.patch("/offline-sync/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    const [existing] = await db
      .select()
      .from(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.id, id),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.organizationId, organizationId)
      ));

    if (!existing) {
      return res.status(404).json({ error: "Sync item not found" });
    }

    const validated = offlineSyncUpdateSchema.parse(req.body);
    const forceOverwrite = req.headers['x-force-overwrite'] === 'true';

    if (!forceOverwrite && req.body.lastKnownUpdatedAt) {
      const clientUpdatedAt = new Date(req.body.lastKnownUpdatedAt).getTime();
      const serverUpdatedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (serverUpdatedAt > clientUpdatedAt) {
        return res.status(409).json({
          error: "Conflict: server version is newer",
          serverUpdatedAt: existing.updatedAt,
          serverData: existing,
        });
      }
    }

    const updates: Record<string, unknown> = {
      ...validated,
      updatedAt: new Date(),
    };

    if (validated.status === "SYNCED") {
      updates.syncedAt = new Date();
    }

    if (validated.status === "FAILED") {
      updates.retryCount = (existing.retryCount || 0) + 1;
      updates.lastRetryAt = new Date();
    }

    const [updated] = await db
      .update(offlineSyncQueue)
      .set(updates)
      .where(and(
        eq(offlineSyncQueue.id, id),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.organizationId, organizationId)
      ))
      .returning();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error updating offline sync item:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update offline sync item" });
  }
});

router.delete("/offline-sync/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const [existing] = await db
      .select()
      .from(offlineSyncQueue)
      .where(and(eq(offlineSyncQueue.id, id), eq(offlineSyncQueue.userId, userId)));

    if (!existing) {
      return res.status(404).json({ error: "Sync item not found" });
    }

    await db.delete(offlineSyncQueue).where(eq(offlineSyncQueue.id, id));
    res.status(204).send();
  } catch (error) {
    logError("Error deleting offline sync item:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete offline sync item" });
  }
});

router.delete("/offline-sync/clear/synced", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    await db
      .delete(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.organizationId, organizationId),
        eq(offlineSyncQueue.userId, userId),
        eq(offlineSyncQueue.status, "SYNCED")
      ));

    res.json({ message: "Synced items cleared" });
  } catch (error) {
    logError("Error clearing synced items:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to clear synced items" });
  }
});

router.get("/offline-sync/stats", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    const items = await db
      .select()
      .from(offlineSyncQueue)
      .where(and(
        eq(offlineSyncQueue.organizationId, organizationId),
        eq(offlineSyncQueue.userId, userId)
      ));

    const stats = {
      total: items.length,
      pending: items.filter(i => i.status === "PENDING").length,
      synced: items.filter(i => i.status === "SYNCED").length,
      failed: items.filter(i => i.status === "FAILED").length,
      byEntityType: {
        timeEntry: items.filter(i => i.entityType === "TIME_ENTRY").length,
        note: items.filter(i => i.entityType === "NOTE").length,
        issue: items.filter(i => i.entityType === "ISSUE").length,
        voiceLog: items.filter(i => i.entityType === "VOICE_LOG").length,
        photo: items.filter(i => i.entityType === "PHOTO").length,
      },
    };

    res.json(stats);
  } catch (error) {
    logError("Error fetching offline sync stats:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch offline sync stats" });
  }
});

// ==========================================
// VOICE LOG AI PARSING
// ==========================================

const voiceLogParseSchema = z.object({
  transcription: z.string().min(1),
  outputType: z.enum(["daily_report", "rfi"]).default("daily_report"),
  projectId: z.string().optional(),
});

router.post("/voice-logs/parse", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { transcription, outputType } = voiceLogParseSchema.parse(req.body);

    const systemPrompt = outputType === "daily_report"
      ? `You are a construction field assistant. Parse the following voice dictation from a field worker into structured daily report data. Extract:
- summary: A concise summary of the report (1-2 sentences)
- workPerformed: Description of work completed
- crewCount: Number of workers mentioned (number or null)
- weather: Weather conditions mentioned (string or null)
- issues: Array of issues or problems mentioned
- tags: Array of relevant tags (trade, activity type, location, etc.)
- hoursWorked: Hours mentioned (number or null)

Respond with valid JSON only.`
      : `You are a construction field assistant. Parse the following voice dictation into a structured RFI (Request for Information) draft. Extract:
- summary: Brief description of the question/issue
- question: The formal RFI question
- context: Background context for the question
- suggestedResponse: A suggested approach if mentioned
- tags: Array of relevant tags (trade, discipline, location, etc.)
- priority: "LOW", "MEDIUM", "HIGH", or "CRITICAL"

Respond with valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcription },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_completion_tokens: 1024,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "No response from AI" });
    }

    const parsed = JSON.parse(content);
    res.json(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    logError("Error parsing voice log:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to parse voice log" });
  }
});

// ==========================================
// PHOTO AUTO-TAGGING
// ==========================================

router.post("/photo-auto-tag", requireAuth, requireInternalRole, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mediaId, imageUrl } = req.body;

    if (!mediaId || !imageUrl) {
      return res.status(400).json({ error: "mediaId and imageUrl are required" });
    }

    const [mediaItem] = await db
      .select({ id: media.id, projectId: media.projectId })
      .from(media)
      .innerJoin(projects, eq(media.projectId, projects.id))
      .where(and(
        eq(media.id, mediaId),
        eq(projects.gcOrganizationId, req.user!.organizationId)
      ));

    if (!mediaItem) {
      return res.status(404).json({ error: "Media not found" });
    }

    let resolvedImageUrl = imageUrl;
    const needsDownload = imageUrl.startsWith("/objects/") || imageUrl.includes("replit-objstore");
    if (needsDownload) {
      try {
        const storageService = new ObjectStorageService();
        let normalizedPath = imageUrl;
        if (!imageUrl.startsWith("/objects/")) {
          normalizedPath = storageService.normalizeObjectEntityPath(imageUrl);
        }
        const file = await storageService.getObjectEntityFile(normalizedPath);
        const [buffer] = await file.download();
        const base64 = buffer.toString("base64");
        const [mediaRecord] = await db.select({ mimeType: media.mimeType }).from(media).where(eq(media.id, mediaId)).limit(1);
        const mime = mediaRecord?.mimeType || "image/jpeg";
        resolvedImageUrl = `data:${mime};base64,${base64}`;
      } catch (e) {
        logError("Failed to download image for auto-tag:", {}, e instanceof Error ? e : new Error(String(e)));
        return res.status(500).json({ error: "Failed to download image for analysis" });
      }
    }

    const systemPrompt = `You are a construction jobsite photo analyzer. Analyze the uploaded construction/jobsite photo and provide:
- tags: Array of descriptive tags including:
  - Trade (e.g., "electrical", "plumbing", "framing", "concrete", "roofing")
  - Location (e.g., "interior", "exterior", "foundation", "roof", "basement")
  - Progress stage (e.g., "rough-in", "finish", "demolition", "excavation", "inspection-ready")
  - Safety status (e.g., "ppe-compliant", "safety-concern", "hazard-present")
  - Any other relevant descriptors
- description: A brief 1-2 sentence description of what the photo shows

Respond with valid JSON only: { "tags": [...], "description": "..." }`;

    const completion = await openai.chat.completions.create({
      model: AI_MODEL_GPT5,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this construction jobsite photo and provide tags and description." },
            { type: "image_url", image_url: { url: resolvedImageUrl, detail: "low" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_completion_tokens: 512,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "No response from AI" });
    }

    const parsed = JSON.parse(content);
    const tags = parsed.tags || [];
    const description = parsed.description || "";

    const [updated] = await db
      .update(media)
      .set({
        aiTags: tags,
        aiDescription: description,
        aiAnalyzedAt: new Date(),
      })
      .where(eq(media.id, mediaId))
      .returning();

    res.json({ tags, description, mediaId: updated?.id });
  } catch (error) {
    logError("Error auto-tagging photo:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to auto-tag photo" });
  }
});

export default router;
