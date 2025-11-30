import { Router } from "express";
import { db } from "./db";
import { tasks, aiNoteInsights, users, projects } from "@shared/schema";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { z } from "zod";
import { getOrgIdForFilter } from "./orgFilter";

const router = Router();

// ============================
// AI INSIGHT STATUS ENDPOINTS
// ============================

/**
 * Update AI insight status (acknowledge, start progress, complete, dismiss)
 */
router.patch("/api/insights/:insightId/status", requireAuth, async (req, res) => {
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
      recommendedActions: JSON.parse(updated.recommendedActions || "[]"),
      recipients: JSON.parse(updated.recipients || "[]"),
    };

    res.json(response);
  } catch (error) {
    console.error("Error updating insight status:", error);
    res.status(500).json({ error: "Failed to update insight status" });
  }
});

/**
 * Acknowledge an AI insight (mark as seen)
 */
router.post("/api/insights/:insightId/acknowledge", requireAuth, async (req, res) => {
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
      recommendedActions: JSON.parse(updated.recommendedActions || "[]"),
      recipients: JSON.parse(updated.recipients || "[]"),
    };

    res.json(response);
  } catch (error) {
    console.error("Error acknowledging insight:", error);
    res.status(500).json({ error: "Failed to acknowledge insight" });
  }
});

// ============================
// MANUAL TASK ENDPOINTS
// ============================

/**
 * Get all tasks (with filters)
 */
router.get("/api/tasks", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { status, assignedToId, projectId, createdById } = req.query;
    const userRole = req.user!.role;
    const userId = req.user!.id;

    // Organization filtering: SUPER_ADMIN sees all, others see only their org's tasks
    const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
    
    // SECURITY: Users without org can't see any tasks
    if (mustDenyAccess) {
      return res.json([]);
    }

    // Build where conditions
    const conditions: any[] = [];

    if (status) {
      conditions.push(eq(tasks.status, status as string));
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

    // Organization filter: filter tasks by project's organization
    // Tasks without projects (company-wide) are filtered by creator's organization
    if (shouldFilter && orgId) {
      conditions.push(
        or(
          eq(projects.gcOrganizationId, orgId),
          and(isNull(tasks.projectId), eq(users.organizationId, orgId))
        )
      );
    }

    // RBAC: Non-admin users only see tasks assigned to them or created by them
    if (!["ADMIN", "MANAGER", "SUPER_ADMIN"].includes(userRole)) {
      conditions.push(
        or(
          eq(tasks.assignedToId, userId),
          eq(tasks.createdById, userId)
        )
      );
    }

    // Use .as() method for aliasing when joining users table twice
    const creator = users.as("creator");
    const assignee = users.as("assignee");

    const taskList = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectName: projects.name,
        projectCode: projects.code,
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
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

/**
 * Get a single task by ID
 */
router.get("/api/tasks/:taskId", requireAuth, async (req, res) => {
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
    console.error("Error fetching task:", error);
    res.status(500).json({ error: "Failed to fetch task" });
  }
});

/**
 * Create a new manual task
 */
router.post("/api/tasks", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Validate request body
    const schema = z.object({
      projectId: z.string().optional().nullable(),
      title: z.string().min(1, "Title is required"),
      description: z.string().optional().nullable(),
      category: z.enum(["SUPPLY_NEED", "EQUIPMENT_REPAIR", "WEATHER_DELAY", "CHANGE_ORDER", "SAFETY", "CLIENT_COMMUNICATION", "OTHER"]).default("OTHER"),
      priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
      assignedToId: z.string().optional().nullable(),
      dueDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
    });

    const validated = schema.parse(req.body);

    // Create task
    const [newTask] = await db
      .insert(tasks)
      .values({
        ...validated,
        createdById: userId,
        status: "PENDING",
      })
      .returning();

    res.status(201).json(newTask);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation error", details: error.errors });
    }
    console.error("Error creating task:", error);
    res.status(500).json({ error: "Failed to create task" });
  }
});

/**
 * Update a task
 */
router.patch("/api/tasks/:taskId", requireAuth, async (req, res) => {
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

    const validated = schema.parse(req.body);

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
    console.error("Error updating task:", error);
    res.status(500).json({ error: "Failed to update task" });
  }
});

/**
 * Delete a task
 */
router.delete("/api/tasks/:taskId", requireAuth, async (req, res) => {
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
    console.error("Error deleting task:", error);
    res.status(500).json({ error: "Failed to delete task" });
  }
});

export default router;
