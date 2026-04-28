import { logError } from "./utils/logger";
import { safeJsonParse } from "./responseHelper";
import { Router, Response, NextFunction } from "express";
import { db } from "./db";
import { tasks, aiNoteInsights, users, projects, taskSubtasks, taskComments, taskAttachments } from "@shared/schema";
import { eq, and, desc, asc, isNull, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireAuth, type AuthRequest } from "./auth";
import { z } from "zod";
import { parseOrRespond } from "./utils/validation";
import { getOrgIdForFilter } from "./orgFilter";
import multer from "multer";
import { sensitiveLimiter } from "./rateLimiter";
import { ObjectStorageService } from "./objectStorage";

const taskUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

async function authorizeTaskAccess(req: AuthRequest, taskId: string): Promise<{ authorized: boolean; task?: typeof tasks.$inferSelect; error?: string; status?: number }> {
  const userId = req.user!.id;
  const userRole = req.user!.role;

  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);

  if (mustDenyAccess) {
    return { authorized: false, error: "Access denied", status: 403 };
  }

  const conditions: SQL[] = [eq(tasks.id, taskId)];
  if (shouldFilter && orgId) {
    conditions.push(eq(tasks.organizationId, orgId));
  }

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(...conditions));

  if (!task) {
    return { authorized: false, error: "Task not found", status: 404 };
  }

  if (!["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(userRole)) {
    if (task.assignedToId !== userId && task.createdById !== userId) {
      return { authorized: false, error: "Access denied", status: 403 };
    }
  }

  return { authorized: true, task };
}

// ============================
// AI INSIGHT STATUS ENDPOINTS
// ============================

/**
 * Update AI insight status (acknowledge, start progress, complete, dismiss)
 */
router.patch("/api/insights/:insightId/status", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { insightId } = req.params;
    const { status, dismissReason } = req.body;
    const userId = req.user!.id;

    // Validate status
    const validStatuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Build update object based on status
    const updates: any = { status };
    const now = new Date();

    // Always set acknowledged fields when transitioning to IN_PROGRESS or COMPLETED
    if ((status === "IN_PROGRESS" || status === "COMPLETED")) {
      // Get current insight to check if already acknowledged
      const [currentInsight] = await db
        .select({ acknowledgedById: aiNoteInsights.acknowledgedById })
        .from(aiNoteInsights)
        .where(eq(aiNoteInsights.id, insightId))
        .limit(1);

      if (currentInsight && !currentInsight.acknowledgedById) {
        updates.acknowledgedById = userId;
        updates.acknowledgedAt = now;
      }
    }

    if (status === "COMPLETED") {
      updates.completedById = userId;
      updates.completedAt = now;
    }

    if (status === "DISMISSED") {
      // Require dismiss reason
      if (!dismissReason || dismissReason.trim().length === 0) {
        return res.status(400).json({ error: "Dismiss reason is required" });
      }
      updates.dismissedById = userId;
      updates.dismissedAt = now;
      updates.dismissReason = dismissReason;
    }

    // Update insight
    const [updated] = await db
      .update(aiNoteInsights)
      .set(updates)
      .where(eq(aiNoteInsights.id, insightId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Insight not found" });
    }

    // Parse JSON fields for response
    const response = {
      ...updated,
      recommendedActions: safeJsonParse(updated.recommendedActions, []),
      recipients: safeJsonParse(updated.recipients, []),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * Acknowledge an AI insight (mark as seen)
 */
router.post("/api/insights/:insightId/acknowledge", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { insightId } = req.params;
    const userId = req.user!.id;

    const [updated] = await db
      .update(aiNoteInsights)
      .set({
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
        status: "IN_PROGRESS", // Move to in progress when acknowledged
      })
      .where(eq(aiNoteInsights.id, insightId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Insight not found" });
    }

    const response = {
      ...updated,
      recommendedActions: safeJsonParse(updated.recommendedActions, []),
      recipients: safeJsonParse(updated.recipients, []),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

// ============================
// MANUAL TASK ENDPOINTS
// ============================

/**
 * Get all tasks (with filters)
 */
router.get("/api/tasks", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { status, assignedToId, projectId, createdById, context, hiringCandidateId, hiringJobId } = req.query;
    const userRole = req.user!.role;
    const userId = req.user!.id;

    // Organization filtering: SUPER_ADMIN sees all, others see only their org's tasks
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    // SECURITY: Users without org can't see any tasks
    if (mustDenyAccess) {
      return res.json([]);
    }

    // Build where conditions
    const conditions: SQL[] = [];

    if (status) {
      const validStatus = status as "PENDING" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED";
      conditions.push(eq(tasks.status, validStatus));
    }

    if (assignedToId) {
      conditions.push(eq(tasks.assignedToId, assignedToId as string));
    }

    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId as string));
    }

    if (createdById) {
      conditions.push(eq(tasks.createdById, createdById as string));
    }

    if (context) {
      conditions.push(eq(tasks.context, context as string));
    }

    if (hiringCandidateId) {
      conditions.push(eq(tasks.hiringCandidateId, hiringCandidateId as string));
    }

    if (hiringJobId) {
      conditions.push(eq(tasks.hiringJobId, hiringJobId as string));
    }

    // Organization filter: filter tasks by organization
    if (shouldFilter && orgId) {
      conditions.push(eq(tasks.organizationId, orgId));
    }

    // RBAC: Non-admin users only see tasks assigned to them or created by them
    if (!["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(userRole)) {
      const rbacFilter = or(
        eq(tasks.assignedToId, userId),
        eq(tasks.createdById, userId)
      );
      if (rbacFilter) {
        conditions.push(rbacFilter);
      }
    }

    // Use alias function for aliasing when joining users table twice
    const creator = alias(users, "creator");
    const assignee = alias(users, "assignee");

    const taskList = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        context: tasks.context,
        hiringCandidateId: tasks.hiringCandidateId,
        hiringJobId: tasks.hiringJobId,
        title: tasks.title,
        description: tasks.description,
        category: tasks.category,
        priority: tasks.priority,
        status: tasks.status,
        createdById: tasks.createdById,
        createdByFirstName: creator.firstName,
        createdByLastName: creator.lastName,
        assignedToId: tasks.assignedToId,
        assignedToFirstName: assignee.firstName,
        assignedToLastName: assignee.lastName,
        dueDate: tasks.dueDate,
        acknowledgedById: tasks.acknowledgedById,
        acknowledgedAt: tasks.acknowledgedAt,
        completedById: tasks.completedById,
        completedAt: tasks.completedAt,
        dismissedById: tasks.dismissedById,
        dismissedAt: tasks.dismissedAt,
        dismissReason: tasks.dismissReason,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(creator, eq(tasks.createdById, creator.id))
      .leftJoin(assignee, eq(tasks.assignedToId, assignee.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tasks.createdAt));

    res.json(taskList);
  } catch (error) {
    next(error);
  }
});

/**
 * Get a single task by ID
 */
router.get("/api/tasks/:taskId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // RBAC: Check access
    if (!["ADMIN", "MANAGER"].includes(userRole)) {
      if (task.assignedToId !== userId && task.createdById !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    res.json(task);
  } catch (error) {
    next(error);
  }
});

/**
 * Create a new manual task
 */
router.post("/api/tasks", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;
    
    if (!organizationId) {
      return res.status(400).json({ error: "User must belong to an organization" });
    }

    // Validate request body
    const schema = z.object({
      projectId: z.string().optional().nullable(),
      context: z.string().optional().nullable(),
      hiringCandidateId: z.string().optional().nullable(),
      hiringJobId: z.string().optional().nullable(),
      title: z.string().min(1, "Title is required"),
      description: z.string().optional().nullable(),
      category: z.enum(["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]).default("OTHER"),
      priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"]).optional(),
      sourceType: z.enum(["MANUAL", "EMAIL", "AI_GENERATED", "SYSTEM"]).optional(),
      assignedToId: z.string().optional().nullable(),
      dueDate: z.string().optional().nullable().transform(val => val ? new Date(val) : undefined),
    });

    const validated = parseOrRespond(schema, req.body, res);
    if (!validated) return;

    // Create task
    const [newTask] = await db
      .insert(tasks)
      .values({
        organizationId,
        projectId: validated.projectId || undefined,
        context: validated.context || undefined,
        hiringCandidateId: validated.hiringCandidateId || undefined,
        hiringJobId: validated.hiringJobId || undefined,
        title: validated.title,
        description: validated.description || undefined,
        category: validated.category,
        priority: validated.priority,
        assignedToId: validated.assignedToId || undefined,
        dueDate: validated.dueDate,
        createdById: userId,
        status: validated.status ?? "PENDING",
        sourceType: validated.sourceType ?? "MANUAL",
      })
      .returning();

    res.status(201).json(newTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

/**
 * Update a task
 */
router.patch("/api/tasks/:taskId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Get existing task
    const [existingTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    // RBAC: Only creator, assignee, admin, or manager can update
    if (!["ADMIN", "MANAGER"].includes(userRole)) {
      if (existingTask.createdById !== userId && existingTask.assignedToId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    // Validate update fields
    const schema = z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      category: z.enum(["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]).optional(),
      priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "DISMISSED"]).optional(),
      assignedToId: z.string().optional().nullable(),
      dueDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
      dismissReason: z.string().optional().nullable(),
    });

    const validated = parseOrRespond(schema, req.body, res);
    if (!validated) return;

    // Handle status-specific updates
    const updates: any = { ...validated, updatedAt: new Date() };

    // Always set acknowledged fields when transitioning to IN_PROGRESS or COMPLETED
    if ((validated.status === "IN_PROGRESS" || validated.status === "COMPLETED") && !existingTask.acknowledgedById) {
      updates.acknowledgedById = userId;
      updates.acknowledgedAt = new Date();
    }

    if (validated.status === "COMPLETED" && !existingTask.completedById) {
      updates.completedById = userId;
      updates.completedAt = new Date();
    }

    if (validated.status === "DISMISSED") {
      // Require dismiss reason
      if (!validated.dismissReason || validated.dismissReason.trim().length === 0) {
        return res.status(400).json({ error: "Dismiss reason is required when dismissing a task" });
      }
      if (!existingTask.dismissedById) {
        updates.dismissedById = userId;
        updates.dismissedAt = new Date();
      }
    }

    // Update task
    const [updated] = await db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, taskId))
      .returning();

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

/**
 * Delete a task
 */
router.delete("/api/tasks/:taskId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    // Get existing task
    const [existingTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    // RBAC: Only creator, admin, or manager can delete
    if (!["ADMIN", "MANAGER"].includes(userRole)) {
      if (existingTask.createdById !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    await db.delete(tasks).where(eq(tasks.id, taskId));

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================
// TASK SUBTASKS ENDPOINTS
// ============================

router.get("/api/tasks/:taskId/subtasks", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const subtaskList = await db
      .select()
      .from(taskSubtasks)
      .where(eq(taskSubtasks.taskId, taskId))
      .orderBy(asc(taskSubtasks.createdAt));
    res.json(subtaskList);
  } catch (error) {
    next(error);
  }
});

router.post("/api/tasks/:taskId/subtasks", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const userId = req.user!.id;
    const schema = z.object({ title: z.string().min(1, "Title is required") });
    const subtaskParsed = parseOrRespond(schema, req.body, res);
    if (!subtaskParsed) return;
    const { title } = subtaskParsed;

    const [subtask] = await db
      .insert(taskSubtasks)
      .values({ taskId, title, createdById: userId })
      .returning();
    res.status(201).json(subtask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

router.patch("/api/tasks/:taskId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId, subtaskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const schema = z.object({
      title: z.string().min(1).optional(),
      completed: z.boolean().optional(),
    });
    const validated = parseOrRespond(schema, req.body, res);
    if (!validated) return;

    const [updated] = await db
      .update(taskSubtasks)
      .set({ ...validated, updatedAt: new Date() })
      .where(and(eq(taskSubtasks.id, subtaskId), eq(taskSubtasks.taskId, taskId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Subtask not found" });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

router.delete("/api/tasks/:taskId/subtasks/:subtaskId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId, subtaskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const [deleted] = await db
      .delete(taskSubtasks)
      .where(and(eq(taskSubtasks.id, subtaskId), eq(taskSubtasks.taskId, taskId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Subtask not found" });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================
// TASK COMMENTS ENDPOINTS
// ============================

router.get("/api/tasks/:taskId/comments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const commenter = alias(users, "commenter");
    const commentList = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        content: taskComments.content,
        createdById: taskComments.createdById,
        createdByFirstName: commenter.firstName,
        createdByLastName: commenter.lastName,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
      })
      .from(taskComments)
      .leftJoin(commenter, eq(taskComments.createdById, commenter.id))
      .where(eq(taskComments.taskId, taskId))
      .orderBy(desc(taskComments.createdAt));
    res.json(commentList);
  } catch (error) {
    next(error);
  }
});

router.post("/api/tasks/:taskId/comments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const userId = req.user!.id;
    const schema = z.object({ content: z.string().min(1, "Content is required") });
    const commentParsed = parseOrRespond(schema, req.body, res);
    if (!commentParsed) return;
    const { content } = commentParsed;

    const [comment] = await db
      .insert(taskComments)
      .values({ taskId, content, createdById: userId })
      .returning();

    const commenter = alias(users, "commenter");
    const [commentWithUser] = await db
      .select({
        id: taskComments.id,
        taskId: taskComments.taskId,
        content: taskComments.content,
        createdById: taskComments.createdById,
        createdByFirstName: commenter.firstName,
        createdByLastName: commenter.lastName,
        createdAt: taskComments.createdAt,
        updatedAt: taskComments.updatedAt,
      })
      .from(taskComments)
      .leftJoin(commenter, eq(taskComments.createdById, commenter.id))
      .where(eq(taskComments.id, comment.id));

    res.status(201).json(commentWithUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

// ============================
// TASK ATTACHMENTS ENDPOINTS
// ============================

router.get("/api/tasks/:taskId/attachments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const uploader = alias(users, "uploader");
    const attachmentList = await db
      .select({
        id: taskAttachments.id,
        taskId: taskAttachments.taskId,
        fileName: taskAttachments.fileName,
        fileUrl: taskAttachments.fileUrl,
        fileSize: taskAttachments.fileSize,
        mimeType: taskAttachments.mimeType,
        uploadedById: taskAttachments.uploadedById,
        uploadedByFirstName: uploader.firstName,
        uploadedByLastName: uploader.lastName,
        createdAt: taskAttachments.createdAt,
      })
      .from(taskAttachments)
      .leftJoin(uploader, eq(taskAttachments.uploadedById, uploader.id))
      .where(eq(taskAttachments.taskId, taskId))
      .orderBy(desc(taskAttachments.createdAt));
    res.json(attachmentList);
  } catch (error) {
    next(error);
  }
});

router.post("/api/tasks/:taskId/attachments", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const userId = req.user!.id;
    const schema = z.object({
      fileName: z.string().min(1),
      fileUrl: z.string().min(1),
      fileSize: z.number().optional(),
      mimeType: z.string().optional(),
    });
    const validated = parseOrRespond(schema, req.body, res);
    if (!validated) return;

    const [attachment] = await db
      .insert(taskAttachments)
      .values({ taskId, ...validated, uploadedById: userId })
      .returning();
    res.status(201).json(attachment);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    next(error);
  }
});

router.post("/api/tasks/:taskId/attachments/upload", requireAuth, sensitiveLimiter, taskUpload.single("file"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const allowedTypes = [
      "image/jpeg", "image/png", "image/gif", "image/webp",
      "application/pdf",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain", "text/csv",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: `File type '${file.mimetype}' is not allowed. Accepted: images, PDFs, Office documents, and text files.` });
    }

    const userId = req.user!.id;
    const organizationId = req.user!.organizationId;

    const objectStorage = new ObjectStorageService();
    const { uploadURL, objectKey } = await objectStorage.getObjectEntityUploadURL(organizationId!);
    const uploadRes = await fetch(uploadURL, {
      method: "PUT",
      body: file.buffer,
      headers: { "Content-Type": file.mimetype },
    });
    if (!uploadRes.ok) {
      return next(error);
    }
    const fileUrl = objectKey;

    const [attachment] = await db
      .insert(taskAttachments)
      .values({
        taskId,
        fileName: file.originalname,
        fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedById: userId,
      })
      .returning();
    res.status(201).json(attachment);
  } catch (error) {
    next(error);
  }
});

router.delete("/api/tasks/:taskId/attachments/:attachmentId", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId, attachmentId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const [deleted] = await db
      .delete(taskAttachments)
      .where(and(eq(taskAttachments.id, attachmentId), eq(taskAttachments.taskId, taskId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Attachment not found" });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================
// TASK ACTIVITY LOG ENDPOINT
// ============================

router.get("/api/tasks/:taskId/activity", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { taskId } = req.params;
    const auth = await authorizeTaskAccess(req, taskId);
    if (!auth.authorized) return res.status(auth.status!).json({ error: auth.error });

    const task = auth.task!;
    const activity: Array<{ action: string; timestamp: string; userId: string | null; userName?: string }> = [];

    activity.push({
      action: "Task created",
      timestamp: task.createdAt.toISOString(),
      userId: task.createdById,
    });

    if (task.acknowledgedAt) {
      activity.push({
        action: "Task acknowledged / started",
        timestamp: task.acknowledgedAt.toISOString(),
        userId: task.acknowledgedById,
      });
    }

    if (task.completedAt) {
      activity.push({
        action: "Task marked as completed",
        timestamp: task.completedAt.toISOString(),
        userId: task.completedById,
      });
    }

    if (task.dismissedAt) {
      activity.push({
        action: `Task dismissed${task.dismissReason ? `: ${task.dismissReason}` : ""}`,
        timestamp: task.dismissedAt.toISOString(),
        userId: task.dismissedById,
      });
    }

    if (task.updatedAt && task.updatedAt.getTime() !== task.createdAt.getTime()) {
      activity.push({
        action: "Task updated",
        timestamp: task.updatedAt.toISOString(),
        userId: null,
      });
    }

    const userIds = activity.map(a => a.userId).filter(Boolean) as string[];
    if (userIds.length > 0) {
      const uniqueIds = [...new Set(userIds)];
      const userRows = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .where(or(...uniqueIds.map(uid => eq(users.id, uid))));

      const userMap = new Map(userRows.map(u => [u.id, `${u.firstName} ${u.lastName}`]));
      for (const item of activity) {
        if (item.userId) {
          item.userName = userMap.get(item.userId) || "Unknown";
        }
      }
    }

    activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json(activity);
  } catch (error) {
    next(error);
  }
});

export default router;
