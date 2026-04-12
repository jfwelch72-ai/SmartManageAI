/**
 * @openapi
 * /api/projects/{code}/schedule/create:
 *   post:
 *     tags: [Scheduling]
 *     summary: Create project schedule
 *     description: Creates a new project schedule with tasks and dependencies. Requires manager role.
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Schedule created }
 * /api/projects/{code}/schedule/recalculate:
 *   post:
 *     tags: [Scheduling]
 *     summary: Recalculate CPM schedule
 *     description: Recalculates critical path and schedule dates. Requires manager role.
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Schedule recalculated }
 * /api/projects/{code}/schedule/lock-baseline:
 *   post:
 *     tags: [Scheduling]
 *     summary: Lock schedule baseline
 *     description: Locks the current schedule as the baseline for variance tracking.
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Baseline locked }
 * /api/projects/{code}/schedule/unlock-baseline:
 *   post:
 *     tags: [Scheduling]
 *     summary: Unlock schedule baseline
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Baseline unlocked }
 * /api/projects/{code}/schedule/tasks:
 *   post:
 *     tags: [Scheduling]
 *     summary: Add a schedule task
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, durationDays]
 *             properties:
 *               name: { type: string }
 *               durationDays: { type: integer }
 *               startDate: { type: string, format: date }
 *     responses:
 *       201: { description: Task added }
 * /api/projects/{code}/schedule/tasks/{taskId}:
 *   delete:
 *     tags: [Scheduling]
 *     summary: Delete a schedule task
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: taskId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Task deleted }
 * /api/projects/{code}/schedule/tasks/{taskId}/dependencies:
 *   patch:
 *     tags: [Scheduling]
 *     summary: Update task dependencies
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: taskId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               predecessorIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Dependencies updated }
 * /api/projects/{code}/schedule/tasks/{taskId}/crews:
 *   patch:
 *     tags: [Scheduling]
 *     summary: Assign crews to a task
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: taskId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               crewIds: { type: array, items: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Crews assigned }
 * /api/projects/{code}/schedule/resource-loading:
 *   get:
 *     tags: [Scheduling]
 *     summary: Get resource loading data
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Resource loading by week }
 * /api/projects/{code}/schedule/forecast:
 *   get:
 *     tags: [Scheduling]
 *     summary: Get schedule forecast
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Schedule forecast with S-curves }
 * /api/projects/{code}/schedule/delay-impact:
 *   post:
 *     tags: [Scheduling]
 *     summary: Analyze delay impact on schedule
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Delay impact analysis }
 * /api/projects/{code}/schedule/delay-change-order:
 *   post:
 *     tags: [Scheduling]
 *     summary: Create change order from delay
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Change order created from delay }
 * /api/projects/{code}/schedule/recommendations:
 *   get:
 *     tags: [Scheduling]
 *     summary: Get AI schedule recommendations
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: AI-generated schedule recommendations }
 * /api/projects/{code}/schedule/recommendations/{recId}/dismiss:
 *   patch:
 *     tags: [Scheduling]
 *     summary: Dismiss a schedule recommendation
 *     parameters:
 *       - name: code
 *         in: path
 *         required: true
 *         schema: { type: string }
 *       - name: recId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Recommendation dismissed }
 */
import { logError } from "./utils/logger";
import { Router, type Response, NextFunction } from "express";
import { db } from "./db";
import { projectSchedules, projectScheduleTasks, scheduleForecastSnapshots, projects, changeOrders, projectDelays, crews, aiGanttRecommendations } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { recalculateSchedule, computeScheduleImpact, detectCycle } from "./cpmEngine";

const router = Router();

async function getProjectByCode(code: string) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code));
  return project;
}

async function getActiveSchedule(projectId: string) {
  const [schedule] = await db
    .select()
    .from(projectSchedules)
    .where(and(eq(projectSchedules.projectId, projectId), eq(projectSchedules.isActive, true)))
    .orderBy(desc(projectSchedules.createdAt))
    .limit(1);
  return schedule;
}

function checkAccess(req: AuthRequest, project: { gcOrganizationId: string | null }) {
  const orgId = req.user?.organizationId;
  return project.gcOrganizationId === orgId || req.user?.role === "SUPER_ADMIN";
}

router.post("/projects/:code/schedule/recalculate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const result = await recalculateSchedule(schedule.id);
    if (!result) return next(new Error("Failed to recalculate schedule"));

    const updatedTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    const [updatedSchedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, schedule.id));

    res.json({ schedule: updatedSchedule, tasks: updatedTasks, cpm: result });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:code/schedule/lock-baseline", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    for (const task of tasks) {
      await db.update(projectScheduleTasks)
        .set({
          baselineStartDate: task.plannedStartDate,
          baselineEndDate: task.plannedEndDate,
          updatedAt: new Date(),
        })
        .where(eq(projectScheduleTasks.id, task.id));
    }

    let scheduleBaselineStart: string | null = null;
    let scheduleBaselineEnd: string | null = null;
    for (const task of tasks) {
      const sd = task.plannedStartDate;
      const ed = task.plannedEndDate;
      if (sd && (!scheduleBaselineStart || sd < scheduleBaselineStart)) scheduleBaselineStart = sd;
      if (ed && (!scheduleBaselineEnd || ed > scheduleBaselineEnd)) scheduleBaselineEnd = ed;
    }

    const [updatedSchedule] = await db.update(projectSchedules)
      .set({
        baselineLocked: true,
        baselineLockedAt: new Date(),
        ...(scheduleBaselineStart ? { baselineStartDate: scheduleBaselineStart } : {}),
        ...(scheduleBaselineEnd ? { baselineEndDate: scheduleBaselineEnd } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectSchedules.id, schedule.id))
      .returning();

    const updatedTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.json({ schedule: updatedSchedule, tasks: updatedTasks });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:code/schedule/unlock-baseline", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const [updatedSchedule] = await db.update(projectSchedules)
      .set({
        baselineLocked: false,
        updatedAt: new Date(),
      })
      .where(eq(projectSchedules.id, schedule.id))
      .returning();

    res.json({ schedule: updatedSchedule });
  } catch (error) {
    next(error);
  }
});

const taskDependencySchema = z.object({
  dependencies: z.array(z.string()),
});

router.patch("/projects/:code/schedule/tasks/:taskId/dependencies", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const parsed = taskDependencySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const [existingTask] = await db.select().from(projectScheduleTasks)
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)));
    if (!existingTask) return res.status(404).json({ error: "Task not found in this schedule" });

    const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    for (const depId of parsed.data.dependencies) {
      if (depId === req.params.taskId) return res.status(400).json({ error: "Task cannot depend on itself" });
      if (!allTasks.some(t => t.id === depId)) return res.status(400).json({ error: `Dependency task ${depId} not found in schedule` });
    }

    if (detectCycle(req.params.taskId, parsed.data.dependencies, allTasks.map(t => ({ id: t.id, dependencies: t.dependencies })))) {
      return res.status(400).json({ error: "Circular dependency detected" });
    }

    const [updatedTask] = await db.update(projectScheduleTasks)
      .set({
        dependencies: parsed.data.dependencies,
        updatedAt: new Date(),
      })
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)))
      .returning();

    if (!updatedTask) return res.status(404).json({ error: "Task not found" });

    const result = await recalculateSchedule(schedule.id);
    const updatedTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    const [updatedSchedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, schedule.id));

    res.json({ schedule: updatedSchedule, tasks: updatedTasks, cpm: result });
  } catch (error) {
    next(error);
  }
});

const taskCrewsSchema = z.object({
  crewIds: z.array(z.string()),
});

router.patch("/projects/:code/schedule/tasks/:taskId/crews", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const parsed = taskCrewsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const [existingTask] = await db.select().from(projectScheduleTasks)
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)));
    if (!existingTask) return res.status(404).json({ error: "Task not found in this schedule" });

    const [updatedTask] = await db.update(projectScheduleTasks)
      .set({
        crewIds: parsed.data.crewIds,
        updatedAt: new Date(),
      })
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)))
      .returning();

    if (!updatedTask) return res.status(404).json({ error: "Task not found" });

    res.json(updatedTask);
  } catch (error) {
    next(error);
  }
});

const taskCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  durationDays: z.number().min(1).default(1),
  dependencies: z.array(z.string()).optional(),
  isMilestone: z.boolean().optional(),
  plannedStartDate: z.string().optional(),
  plannedEndDate: z.string().optional(),
  tradeType: z.string().optional(),
  parentTaskId: z.string().optional(),
});

router.post("/projects/:code/schedule/tasks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    if (parsed.data.dependencies && parsed.data.dependencies.length > 0) {
      for (const depId of parsed.data.dependencies) {
        if (!allTasks.some(t => t.id === depId)) {
          return res.status(400).json({ error: `Dependency task ${depId} not found in schedule` });
        }
      }
    }

    if (parsed.data.parentTaskId) {
      const parentTask = allTasks.find(t => t.id === parsed.data.parentTaskId);
      if (!parentTask) {
        return res.status(400).json({ error: "Parent task not found in this schedule" });
      }
    }

    const maxSortOrder = allTasks.reduce((max, t) => Math.max(max, t.sortOrder || 0), 0);

    const [newTask] = await db.insert(projectScheduleTasks).values({
      scheduleId: schedule.id,
      name: parsed.data.name,
      description: parsed.data.description || "",
      durationDays: parsed.data.durationDays,
      dependencies: parsed.data.dependencies || [],
      isMilestone: parsed.data.isMilestone || false,
      plannedStartDate: parsed.data.plannedStartDate,
      plannedEndDate: parsed.data.plannedEndDate,
      tradeType: parsed.data.tradeType || null,
      parentTaskId: parsed.data.parentTaskId || null,
      percentComplete: 0,
      sortOrder: maxSortOrder + 1,
    }).returning();

    await recalculateSchedule(schedule.id);
    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.status(201).json({ task: newTask, tasks });
  } catch (error) {
    next(error);
  }
});

router.delete("/projects/:code/schedule/tasks/:taskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const [existingTask] = await db.select().from(projectScheduleTasks)
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)));
    if (!existingTask) return res.status(404).json({ error: "Task not found in this schedule" });

    const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    for (const t of allTasks) {
      if (t.dependencies && t.dependencies.includes(req.params.taskId)) {
        const updatedDeps = t.dependencies.filter(d => d !== req.params.taskId);
        await db.update(projectScheduleTasks)
          .set({ dependencies: updatedDeps, updatedAt: new Date() })
          .where(eq(projectScheduleTasks.id, t.id));
      }
    }

    await db.delete(projectScheduleTasks)
      .where(and(eq(projectScheduleTasks.id, req.params.taskId), eq(projectScheduleTasks.scheduleId, schedule.id)));

    await recalculateSchedule(schedule.id);
    const remainingTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.json({ tasks: remainingTasks });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:code/schedule/resource-loading", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.json({ crews: [], timeline: [], overAllocations: [] });

    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    const orgId = req.user?.organizationId;
    const allCrews = orgId
      ? await db.select().from(crews).where(eq(crews.organizationId, orgId))
      : [];

    const crewMap = new Map(allCrews.map(c => [c.id, c]));

    interface CrewAllocation {
      crewId: string;
      crewName: string;
      taskId: string;
      taskName: string;
      startDate: string;
      endDate: string;
    }

    const allocations: CrewAllocation[] = [];

    for (const task of tasks) {
      if (task.status === "COMPLETE") continue;
      const assignedCrews = task.crewIds || (task.crewId ? [task.crewId] : []);
      for (const crewId of assignedCrews) {
        const crew = crewMap.get(crewId);
        allocations.push({
          crewId,
          crewName: crew?.name || "Unknown Crew",
          taskId: task.id,
          taskName: task.name,
          startDate: task.plannedStartDate || "",
          endDate: task.plannedEndDate || "",
        });
      }
    }

    const overAllocations: Array<{ crewId: string; crewName: string; date: string; tasks: string[] }> = [];
    const crewDateTasks = new Map<string, Map<string, string[]>>();

    const workingDaysList: number[] = schedule.workingDays ? (schedule.workingDays as number[]) : [1, 2, 3, 4, 5];

    for (const alloc of allocations) {
      if (!alloc.startDate || !alloc.endDate) continue;
      const start = new Date(alloc.startDate);
      const end = new Date(alloc.endDate);
      const current = new Date(start);

      while (current <= end) {
        if (workingDaysList.includes(current.getDay())) {
          const dateStr = current.toISOString().split("T")[0];
          const key = alloc.crewId;
          if (!crewDateTasks.has(key)) crewDateTasks.set(key, new Map());
          const dateTasks = crewDateTasks.get(key)!;
          if (!dateTasks.has(dateStr)) dateTasks.set(dateStr, []);
          dateTasks.get(dateStr)!.push(alloc.taskName);
        }
        current.setDate(current.getDate() + 1);
      }
    }

    for (const [crewId, dateTasks] of crewDateTasks) {
      for (const [date, taskNames] of dateTasks) {
        if (taskNames.length > 1) {
          overAllocations.push({
            crewId,
            crewName: crewMap.get(crewId)?.name || "Unknown",
            date,
            tasks: taskNames,
          });
        }
      }
    }

    res.json({ allocations, overAllocations, crews: allCrews });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:code/schedule/forecast", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.json({ forecast: null, snapshots: [] });

    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    const overallProgress = tasks.length > 0
      ? Math.round(tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / tasks.length)
      : 0;

    const criticalTasks = tasks.filter(t => t.isCriticalPath && t.status !== "COMPLETE");
    let criticalPathDaysRemaining = 0;
    for (const t of criticalTasks) {
      const dur = t.durationDays || 1;
      const pct = t.percentComplete || 0;
      criticalPathDaysRemaining += Math.ceil(dur * (1 - pct / 100));
    }

    let baselineVarianceDays: number | null = null;
    if (schedule.baselineLocked && schedule.baselineEndDate && schedule.projectedCompletionDate) {
      const baseEnd = new Date(schedule.baselineEndDate);
      const projEnd = new Date(schedule.projectedCompletionDate);
      baselineVarianceDays = Math.round((projEnd.getTime() - baseEnd.getTime()) / (1000 * 60 * 60 * 24));
    }

    const snapshots = await db.select()
      .from(scheduleForecastSnapshots)
      .where(eq(scheduleForecastSnapshots.scheduleId, schedule.id))
      .orderBy(desc(scheduleForecastSnapshots.snapshotDate))
      .limit(30);

    res.json({
      forecast: {
        projectedCompletionDate: schedule.projectedCompletionDate,
        spiValue: schedule.spiValue ? parseFloat(schedule.spiValue) : null,
        baselineEndDate: schedule.baselineEndDate,
        baselineVarianceDays,
        overallProgress,
        criticalPathDaysRemaining,
        baselineLocked: schedule.baselineLocked,
      },
      snapshots: snapshots.reverse(),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:code/schedule/delay-impact", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.json({ impactDays: 0, affectsCriticalPath: false });

    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    const criticalTasks = tasks.filter(t => t.isCriticalPath);

    const { delayStartDate, delayEndDate, estimatedDuration, delayId } = req.body;

    const impact = computeScheduleImpact(
      delayStartDate,
      delayEndDate || null,
      estimatedDuration || null,
      criticalTasks
    );

    res.json({
      ...impact,
      delayId,
      scheduleId: schedule.id,
      criticalPathTaskCount: criticalTasks.length,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/projects/:code/schedule/delay-change-order", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const { delayId, impactDays, delayReason } = req.body;

    const [delay] = delayId
      ? await db.select().from(projectDelays).where(and(eq(projectDelays.id, delayId), eq(projectDelays.projectId, project.id)))
      : [];

    if (delayId && !delay) return res.status(404).json({ error: "Delay not found in this project" });

    const existingOrders = await db.select({ count: sql<number>`count(*)` }).from(changeOrders).where(eq(changeOrders.projectId, project.id));
    const orderCount = existingOrders[0]?.count || 0;
    const coNumber = `CO-${project.code}-${String(orderCount + 1).padStart(3, "0")}`;

    const description = delay
      ? `Schedule impact from delay ${delay.delayNumber}: ${delayReason || delay.reason}. ${impactDays} day(s) impact to project schedule.`
      : `Schedule delay impact: ${delayReason || "Unspecified"}. ${impactDays} day(s) impact.`;

    const [newCO] = await db.insert(changeOrders).values({
      projectId: project.id,
      changeOrderNumber: coNumber,
      description,
      status: "DRAFT",
      requestedById: req.user!.id,
      amount: "0.00",
    }).returning();

    if (delay) {
      await db.update(projectDelays)
        .set({
          linkedChangeOrderId: newCO.id,
          changeOrderRequired: true,
          updatedAt: new Date(),
        })
        .where(eq(projectDelays.id, delayId));
    }

    res.json({ changeOrder: newCO, delayId });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:code/schedule/recommendations", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const recommendations = await db
      .select()
      .from(aiGanttRecommendations)
      .where(eq(aiGanttRecommendations.projectId, project.id))
      .orderBy(desc(aiGanttRecommendations.createdAt));

    res.json({ recommendations });
  } catch (error) {
    next(error);
  }
});

router.patch("/projects/:code/schedule/recommendations/:recId/dismiss", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const [updated] = await db.update(aiGanttRecommendations)
      .set({ isApplied: true, appliedById: req.user!.id, appliedAt: new Date() })
      .where(and(eq(aiGanttRecommendations.id, req.params.recId), eq(aiGanttRecommendations.projectId, project.id)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Recommendation not found" });
    res.json({ recommendation: updated });
  } catch (error) {
    next(error);
  }
});

const manualScheduleSchema = z.object({
  name: z.string().min(1).default("Master Schedule"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workingDays: z.array(z.number().min(0).max(6)).optional(),
});

router.post("/projects/:code/schedule/create", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const parsed = manualScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const existingSchedules = await db
      .select()
      .from(projectSchedules)
      .where(and(eq(projectSchedules.projectId, project.id), eq(projectSchedules.isActive, true)));

    if (existingSchedules.length > 0) {
      for (const s of existingSchedules) {
        await db.update(projectSchedules)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(projectSchedules.id, s.id));
      }
    }

    const [newSchedule] = await db.insert(projectSchedules).values({
      organizationId: orgId,
      projectId: project.id,
      name: parsed.data.name,
      generatedBy: "MANUAL",
      baselineStartDate: parsed.data.startDate,
      workingDays: parsed.data.workingDays || [1, 2, 3, 4, 5],
      isActive: true,
    }).returning();

    res.status(201).json({ schedule: newSchedule, tasks: [] });
  } catch (error) {
    next(error);
  }
});

export default router;
