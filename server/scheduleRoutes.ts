import { Router, type Response } from "express";
import { db } from "./db";
import { projectSchedules, projectScheduleTasks, scheduleForecastSnapshots, projects, changeOrders, projectDelays, crews } from "@shared/schema";
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

router.post("/projects/:code/schedule/recalculate", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const result = await recalculateSchedule(schedule.id);
    if (!result) return res.status(500).json({ error: "Failed to recalculate" });

    const updatedTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    const [updatedSchedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, schedule.id));

    res.json({ schedule: updatedSchedule, tasks: updatedTasks, cpm: result });
  } catch (error) {
    console.error("Recalculate schedule error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:code/schedule/lock-baseline", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Lock baseline error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:code/schedule/unlock-baseline", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response) => {
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
    console.error("Unlock baseline error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const taskDependencySchema = z.object({
  dependencies: z.array(z.string()),
});

router.patch("/projects/:code/schedule/tasks/:taskId/dependencies", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Update dependencies error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const taskCrewsSchema = z.object({
  crewIds: z.array(z.string()),
});

router.patch("/projects/:code/schedule/tasks/:taskId/crews", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Update task crews error:", error);
    res.status(500).json({ error: "Internal server error" });
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
});

router.post("/projects/:code/schedule/tasks", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    if (parsed.data.dependencies && parsed.data.dependencies.length > 0) {
      const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
      for (const depId of parsed.data.dependencies) {
        if (!allTasks.some(t => t.id === depId)) {
          return res.status(400).json({ error: `Dependency task ${depId} not found in schedule` });
        }
      }
    }

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
      percentComplete: 0,
    }).returning();

    await recalculateSchedule(schedule.id);
    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.status(201).json({ task: newTask, tasks });
  } catch (error) {
    console.error("Create schedule task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:code/schedule/tasks/:taskId", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delete schedule task error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:code/schedule/resource-loading", requireAuth, async (req: AuthRequest, res: Response) => {
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

    for (const alloc of allocations) {
      if (!alloc.startDate || !alloc.endDate) continue;
      const start = new Date(alloc.startDate);
      const end = new Date(alloc.endDate);
      const current = new Date(start);

      while (current <= end) {
        const dateStr = current.toISOString().split("T")[0];
        const key = alloc.crewId;
        if (!crewDateTasks.has(key)) crewDateTasks.set(key, new Map());
        const dateTasks = crewDateTasks.get(key)!;
        if (!dateTasks.has(dateStr)) dateTasks.set(dateStr, []);
        dateTasks.get(dateStr)!.push(alloc.taskName);
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
    console.error("Resource loading error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:code/schedule/forecast", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Forecast error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:code/schedule/delay-impact", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Delay impact error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects/:code/schedule/delay-change-order", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response) => {
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
    console.error("Delay change order error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
