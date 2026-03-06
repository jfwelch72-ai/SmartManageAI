import { Router } from "express";
import { db } from "./db";
import { 
  tasks,
  type Task,
} from "@shared/schema";
import { eq, and, desc, or, isNotNull } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { logCreate, logUpdate } from "./auditLogger";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

const router = Router();

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

export default router;
