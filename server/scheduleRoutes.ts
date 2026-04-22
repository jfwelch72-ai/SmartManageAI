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
import { projectSchedules, projectScheduleTasks, scheduleForecastSnapshots, scheduleBaselines, projects, changeOrders, projectDelays, crews, aiGanttRecommendations, users, scheduleTaskDependencies } from "@shared/schema";
import { eq, and, desc, sql, inArray, lte, gte } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { recalculateSchedule, computeScheduleImpact, detectCycle, loadTypedDependencyMap, type DependencyType } from "./cpmEngine";
import { parseMSProjectXml, buildMSProjectXml } from "./scheduleImportExport";
import {
  renderGanttPdf,
  GanttPdfQueueFullError,
  getGanttPdfStats,
  recycleGanttBrowser,
  getGanttPdfHistory,
  getGanttPdfAlertConfig,
  getGanttPdfAlertState,
  updateGanttPdfAlertConfig,
  setGanttPdfAlertDispatcher,
  evaluateGanttPdfAlerts,
  type GanttPdfAlertEvent,
} from "./gantt-pdf-service";
import {
  getGanttPdfAlertConfig as getGanttPdfRecipientConfig,
  listGanttPdfAlertRecipients,
  listGanttPdfAlertDeliveries,
  clearGanttPdfAlertDeliveries,
  GANTT_PDF_ALERT_DELIVERIES_RETENTION_MS,
  addGanttPdfAlertRecipient,
  updateGanttPdfAlertRecipient,
  deleteGanttPdfAlertRecipient,
  sendGanttPdfTestAlert,
} from "./gantt-pdf-alerts";
import { notifications } from "@shared/schema";
import { sendNotificationEmail } from "./email";

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

interface TaskBaselineSnapshot {
  taskId: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  durationDays: number | null;
}

async function applyBaselineToTasks(scheduleId: string, snapshots: TaskBaselineSnapshot[]) {
  const snapMap = new Map(snapshots.map(s => [s.taskId, s]));
  const allTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
  for (const t of allTasks) {
    const snap = snapMap.get(t.id);
    await db.update(projectScheduleTasks)
      .set({
        baselineStartDate: snap?.baselineStartDate ?? null,
        baselineEndDate: snap?.baselineEndDate ?? null,
        updatedAt: new Date(),
      })
      .where(eq(projectScheduleTasks.id, t.id));
  }
  let bStart: string | null = null;
  let bEnd: string | null = null;
  for (const s of snapshots) {
    if (s.baselineStartDate && (!bStart || s.baselineStartDate < bStart)) bStart = s.baselineStartDate;
    if (s.baselineEndDate && (!bEnd || s.baselineEndDate > bEnd)) bEnd = s.baselineEndDate;
  }
  return { scheduleStartDate: bStart, scheduleEndDate: bEnd };
}

async function snapshotCurrentTasks(scheduleId: string): Promise<{ snapshots: TaskBaselineSnapshot[]; scheduleStartDate: string | null; scheduleEndDate: string | null }> {
  const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
  const snapshots: TaskBaselineSnapshot[] = tasks.map(t => ({
    taskId: t.id,
    baselineStartDate: t.plannedStartDate,
    baselineEndDate: t.plannedEndDate,
    durationDays: t.durationDays ?? null,
  }));
  let bStart: string | null = null;
  let bEnd: string | null = null;
  for (const s of snapshots) {
    if (s.baselineStartDate && (!bStart || s.baselineStartDate < bStart)) bStart = s.baselineStartDate;
    if (s.baselineEndDate && (!bEnd || s.baselineEndDate > bEnd)) bEnd = s.baselineEndDate;
  }
  return { snapshots, scheduleStartDate: bStart, scheduleEndDate: bEnd };
}

router.post("/projects/:code/schedule/lock-baseline", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const existing = await db.select().from(scheduleBaselines)
      .where(and(eq(scheduleBaselines.scheduleId, schedule.id), eq(scheduleBaselines.isArchived, false)));
    const defaultName = req.body?.name && typeof req.body.name === "string"
      ? req.body.name.trim()
      : `Baseline ${existing.length + 1}`;

    const { snapshots, scheduleStartDate, scheduleEndDate } = await snapshotCurrentTasks(schedule.id);

    const [baseline] = await db.insert(scheduleBaselines).values({
      scheduleId: schedule.id,
      organizationId: orgId,
      name: defaultName,
      lockedByUserId: req.user!.id,
      scheduleStartDate,
      scheduleEndDate,
      taskSnapshotsJson: JSON.stringify(snapshots),
    }).returning();

    await applyBaselineToTasks(schedule.id, snapshots);

    const [updatedSchedule] = await db.update(projectSchedules)
      .set({
        baselineLocked: true,
        baselineLockedAt: new Date(),
        activeBaselineId: baseline.id,
        ...(scheduleStartDate ? { baselineStartDate: scheduleStartDate } : {}),
        ...(scheduleEndDate ? { baselineEndDate: scheduleEndDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectSchedules.id, schedule.id))
      .returning();

    const updatedTasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));

    res.json({ schedule: updatedSchedule, tasks: updatedTasks, baseline });
  } catch (error) {
    next(error);
  }
});

router.get("/projects/:code/schedule/baselines", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.json({ baselines: [], activeBaselineId: null });

    const includeArchived = req.query.includeArchived === "true";
    const rows = await db
      .select({
        id: scheduleBaselines.id,
        scheduleId: scheduleBaselines.scheduleId,
        name: scheduleBaselines.name,
        lockedAt: scheduleBaselines.lockedAt,
        lockedByUserId: scheduleBaselines.lockedByUserId,
        isArchived: scheduleBaselines.isArchived,
        scheduleStartDate: scheduleBaselines.scheduleStartDate,
        scheduleEndDate: scheduleBaselines.scheduleEndDate,
        notes: scheduleBaselines.notes,
        createdAt: scheduleBaselines.createdAt,
        lockedByFirstName: users.firstName,
        lockedByLastName: users.lastName,
        lockedByEmail: users.email,
      })
      .from(scheduleBaselines)
      .leftJoin(users, eq(users.id, scheduleBaselines.lockedByUserId))
      .where(eq(scheduleBaselines.scheduleId, schedule.id))
      .orderBy(desc(scheduleBaselines.lockedAt));

    const filtered = includeArchived ? rows : rows.filter(r => !r.isArchived);
    res.json({ baselines: filtered, activeBaselineId: schedule.activeBaselineId });
  } catch (error) {
    next(error);
  }
});

const createBaselineSchema = z.object({
  name: z.string().min(1).max(120),
  notes: z.string().max(1000).optional(),
  setActive: z.boolean().optional().default(true),
});

router.post("/projects/:code/schedule/baselines", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const orgId = req.user?.organizationId;
    if (!orgId) return res.status(403).json({ error: "Organization required" });

    const parsed = createBaselineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const { snapshots, scheduleStartDate, scheduleEndDate } = await snapshotCurrentTasks(schedule.id);

    const [baseline] = await db.insert(scheduleBaselines).values({
      scheduleId: schedule.id,
      organizationId: orgId,
      name: parsed.data.name,
      notes: parsed.data.notes,
      lockedByUserId: req.user!.id,
      scheduleStartDate,
      scheduleEndDate,
      taskSnapshotsJson: JSON.stringify(snapshots),
    }).returning();

    if (parsed.data.setActive !== false) {
      await applyBaselineToTasks(schedule.id, snapshots);
      await db.update(projectSchedules)
        .set({
          baselineLocked: true,
          baselineLockedAt: new Date(),
          activeBaselineId: baseline.id,
          ...(scheduleStartDate ? { baselineStartDate: scheduleStartDate } : {}),
          ...(scheduleEndDate ? { baselineEndDate: scheduleEndDate } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projectSchedules.id, schedule.id));
    }

    res.status(201).json({ baseline });
  } catch (error) {
    next(error);
  }
});

const updateBaselineSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  notes: z.string().max(1000).optional(),
  isArchived: z.boolean().optional(),
});

router.patch("/projects/:code/schedule/baselines/:baselineId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const parsed = updateBaselineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const [baseline] = await db.select().from(scheduleBaselines)
      .where(and(eq(scheduleBaselines.id, req.params.baselineId), eq(scheduleBaselines.scheduleId, schedule.id)));
    if (!baseline) return res.status(404).json({ error: "Baseline not found" });

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.isArchived !== undefined) updates.isArchived = parsed.data.isArchived;

    const [updated] = await db.update(scheduleBaselines)
      .set(updates)
      .where(eq(scheduleBaselines.id, baseline.id))
      .returning();

    if (parsed.data.isArchived === true && schedule.activeBaselineId === baseline.id) {
      await switchActiveBaseline(schedule.id, null);
    }

    res.json({ baseline: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/projects/:code/schedule/baselines/:baselineId", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const [baseline] = await db.select().from(scheduleBaselines)
      .where(and(eq(scheduleBaselines.id, req.params.baselineId), eq(scheduleBaselines.scheduleId, schedule.id)));
    if (!baseline) return res.status(404).json({ error: "Baseline not found" });

    await db.delete(scheduleBaselines).where(eq(scheduleBaselines.id, baseline.id));

    if (schedule.activeBaselineId === baseline.id) {
      await switchActiveBaseline(schedule.id, null);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const setActiveBaselineSchema = z.object({
  baselineId: z.string().nullable(),
});

async function switchActiveBaseline(scheduleId: string, baselineId: string | null) {
  if (baselineId) {
    const [b] = await db.select().from(scheduleBaselines)
      .where(and(eq(scheduleBaselines.id, baselineId), eq(scheduleBaselines.scheduleId, scheduleId)));
    if (!b) throw new Error("Baseline not found");
    let snapshots: TaskBaselineSnapshot[] = [];
    try {
      snapshots = JSON.parse(b.taskSnapshotsJson || "[]");
    } catch {
      snapshots = [];
    }
    await applyBaselineToTasks(scheduleId, snapshots);
    await db.update(projectSchedules)
      .set({
        baselineLocked: true,
        activeBaselineId: b.id,
        ...(b.scheduleStartDate ? { baselineStartDate: b.scheduleStartDate } : {}),
        ...(b.scheduleEndDate ? { baselineEndDate: b.scheduleEndDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectSchedules.id, scheduleId));
    return b;
  } else {
    // Pick most recent non-archived baseline; if none, fully clear baseline state
    const [next] = await db.select().from(scheduleBaselines)
      .where(and(eq(scheduleBaselines.scheduleId, scheduleId), eq(scheduleBaselines.isArchived, false)))
      .orderBy(desc(scheduleBaselines.lockedAt))
      .limit(1);
    if (next) {
      let snapshots: TaskBaselineSnapshot[] = [];
      try { snapshots = JSON.parse(next.taskSnapshotsJson || "[]"); } catch { snapshots = []; }
      await applyBaselineToTasks(scheduleId, snapshots);
      await db.update(projectSchedules)
        .set({
          baselineLocked: true,
          activeBaselineId: next.id,
          ...(next.scheduleStartDate ? { baselineStartDate: next.scheduleStartDate } : {}),
          ...(next.scheduleEndDate ? { baselineEndDate: next.scheduleEndDate } : {}),
          updatedAt: new Date(),
        })
        .where(eq(projectSchedules.id, scheduleId));
      return next;
    } else {
      await applyBaselineToTasks(scheduleId, []);
      await db.update(projectSchedules)
        .set({
          baselineLocked: false,
          activeBaselineId: null,
          updatedAt: new Date(),
        })
        .where(eq(projectSchedules.id, scheduleId));
      return null;
    }
  }
}

router.post("/projects/:code/schedule/active-baseline", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });

    const parsed = setActiveBaselineSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

    const schedule = await getActiveSchedule(project.id);
    if (!schedule) return res.status(404).json({ error: "No active schedule" });

    const active = await switchActiveBaseline(schedule.id, parsed.data.baselineId);
    const [updatedSchedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, schedule.id));
    const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
    res.json({ schedule: updatedSchedule, tasks, activeBaseline: active });
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
        activeBaselineId: null,
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

router.post("/projects/:code/schedule/export-pdf", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const project = await getProjectByCode(code);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    if (!checkAccess(req, project)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const schedule = await getActiveSchedule(project.id);
    if (!schedule) {
      return res.status(404).json({ error: "No active schedule" });
    }

    const themeRaw = (req.body?.theme || req.query?.theme || "light").toString().toLowerCase();
    const theme: "light" | "dark" = themeRaw === "dark" ? "dark" : "light";
    const showBaseline = req.body?.showBaseline !== false && req.query?.showBaseline !== "false";

    const authToken: string | undefined = (req as any).cookies?.["auth_token"];
    if (!authToken) {
      return res.status(401).json({ error: "Missing auth cookie" });
    }

    const port = process.env.PORT || "5000";
    const origin = `http://127.0.0.1:${port}`;

    let pdf: Buffer;
    try {
      pdf = await renderGanttPdf({
        projectCode: code,
        theme,
        showBaseline,
        authCookie: { name: "auth_token", value: authToken },
        origin,
      });
    } catch (err) {
      if (err instanceof GanttPdfQueueFullError) {
        res.setHeader("Retry-After", "10");
        return res.status(503).json({
          error: "Server-side Gantt rendering is busy",
          message: err.message,
        });
      }
      logError("Server-side Gantt PDF render failed", err as Error);
      return res.status(503).json({
        error: "Server-side Gantt rendering is unavailable",
        message: (err as Error).message,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeCode}-schedule-${today}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/gantt-pdf/health:
 *   get:
 *     tags: [Admin]
 *     summary: Get Gantt PDF renderer health and queue stats
 *     description: Returns cached browser age, PDF render counts, queue depth, and limits. Requires SUPER_ADMIN.
 *     responses:
 *       200: { description: Renderer health snapshot }
 * /api/admin/gantt-pdf/recycle:
 *   post:
 *     tags: [Admin]
 *     summary: Manually recycle the cached Gantt PDF browser
 *     description: Marks the cached Chromium for retirement so the next render launches a fresh instance. Requires SUPER_ADMIN.
 *     responses:
 *       200: { description: Recycle requested }
 */
router.get("/admin/gantt-pdf/health", requireAuth, requireRole("SUPER_ADMIN"), (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(getGanttPdfStats());
  } catch (error) {
    next(error);
  }
});

router.post("/admin/gantt-pdf/recycle", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await recycleGanttBrowser();
    res.json({ ...result, stats: getGanttPdfStats() });
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/admin/gantt-pdf/history:
 *   get:
 *     tags: [Admin]
 *     summary: Get rolling Gantt PDF render history (last hour and last day buckets)
 *     description: Returns aggregated render counts, failures, and durations bucketed for charting. Requires SUPER_ADMIN.
 *     responses:
 *       200: { description: Render history snapshot }
 */
router.get("/admin/gantt-pdf/history", requireAuth, requireRole("SUPER_ADMIN"), (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(getGanttPdfHistory());
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Gantt PDF alerting
// ---------------------------------------------------------------------------

function ganttHealthUrl(): string {
  const base = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.APP_URL || "";
  return `${base}/admin/gantt-pdf`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function formatWindowMs(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h}h`;
}

async function dispatchGanttPdfAlert(event: GanttPdfAlertEvent): Promise<void> {
  const url = ganttHealthUrl();
  const subjectReasons = event.breaches.map((b) => {
    if (b.reason === "FAILURE_RATE") return `failure rate ${b.observed}%`;
    if (b.reason === "AVG_DURATION") return `avg ${formatDurationMs(b.observed)}`;
    return `max ${formatDurationMs(b.observed)}`;
  }).join(", ");
  const subject = `[SmartManageAI] Gantt PDF alert: ${subjectReasons}`;
  const breachLines = event.breaches.map((b) => `• ${b.message}`).join("<br/>");
  const message =
    `Gantt PDF rendering crossed configured thresholds in the last ${formatWindowMs(event.window.rangeMs)}.<br/><br/>` +
    `${breachLines}<br/><br/>` +
    `Window summary: ${event.window.total} renders, ${event.window.failures} failures (${event.window.failureRatePct}%)` +
    (event.window.avgDurationMs !== null ? `, avg ${formatDurationMs(event.window.avgDurationMs)}` : "") +
    (event.window.maxDurationMs !== null ? `, max ${formatDurationMs(event.window.maxDurationMs)}` : "") +
    `.`;

  let recipients: { id: string; email: string | null }[] = [];
  try {
    recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(
        inArray(users.role, ["SUPER_ADMIN", "ADMIN"]),
        eq(users.isActive, true),
      ));
  } catch (err) {
    logError("Gantt PDF alert: failed to load admin recipients", err as Error);
  }

  const emailAddresses = Array.from(
    new Set(
      recipients
        .map((r) => (r.email || "").trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  );

  if (emailAddresses.length > 0) {
    try {
      await sendNotificationEmail(
        emailAddresses.join(","),
        subject,
        message,
        url,
        "Open Gantt PDF health",
      );
    } catch (err) {
      logError("Gantt PDF alert email failed", err as Error);
    }
  }

  const userIds = recipients.map((r) => r.id);
  if (userIds.length > 0) {
    try {
      const plainMessage = message.replace(/<br\/?>(?:\s*)/g, " ");
      await db.insert(notifications).values(
        userIds.map((userId) => ({
          userId,
          type: "GENERAL" as const,
          title: `Gantt PDF alert: ${subjectReasons}`,
          message: plainMessage.length > 500 ? `${plainMessage.slice(0, 497)}...` : plainMessage,
          relatedEntityType: "gantt_pdf_health",
        })),
      );
    } catch (err) {
      logError("Gantt PDF alert in-app notification failed", err as Error);
    }
  }
}

setGanttPdfAlertDispatcher((event) => {
  // Run async without blocking the render path.
  dispatchGanttPdfAlert(event).catch((err) =>
    logError("Gantt PDF alert dispatch unhandled rejection", err as Error),
  );
});

const updateAlertConfigSchema = z.object({
  enabled: z.boolean().optional(),
  evaluationWindowMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000).optional(),
  minSamples: z.number().int().min(1).max(1000).optional(),
  failureRatePct: z.number().min(0).max(100).optional(),
  avgDurationMs: z.number().int().min(0).max(10 * 60 * 1000).optional(),
  maxDurationMs: z.number().int().min(0).max(30 * 60 * 1000).optional(),
  cooldownMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
});

/**
 * @openapi
 * /api/admin/gantt-pdf/alerts:
 *   get:
 *     tags: [Admin]
 *     summary: Get Gantt PDF alert config and recent alert state
 *     responses:
 *       200: { description: Alert config and state }
 *   put:
 *     tags: [Admin]
 *     summary: Update Gantt PDF alert thresholds and enabled flag
 *     responses:
 *       200: { description: Updated alert config }
 * /api/admin/gantt-pdf/alerts/evaluate:
 *   post:
 *     tags: [Admin]
 *     summary: Force re-evaluation of Gantt PDF alerts now
 *     description: Re-runs the threshold evaluation against current history. Dispatches an alert if thresholds are breached and the cooldown has elapsed. Requires SUPER_ADMIN.
 *     responses:
 *       200: { description: Evaluation result }
 */
router.get("/admin/gantt-pdf/alerts", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const recipients = await getGanttPdfRecipientConfig();
    res.json({
      config: getGanttPdfAlertConfig(),
      state: getGanttPdfAlertState(),
      recipients,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/admin/gantt-pdf/alerts", requireAuth, requireRole("SUPER_ADMIN"), (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = updateAlertConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid alert config", details: parsed.error.flatten() });
    }
    const config = updateGanttPdfAlertConfig(parsed.data);
    // Re-evaluate immediately so admins see new state without waiting for the next render.
    evaluateGanttPdfAlerts();
    res.json({ config, state: getGanttPdfAlertState() });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/gantt-pdf/alerts/evaluate", requireAuth, requireRole("SUPER_ADMIN"), (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const event = evaluateGanttPdfAlerts();
    res.json({ triggered: event !== null, event, state: getGanttPdfAlertState() });
  } catch (error) {
    next(error);
  }
});

// ----- Gantt PDF alert recipient CRUD -----
const recipientEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email("Must be a valid email address");

const createRecipientSchema = z.object({
  email: recipientEmailSchema,
  notifyInApp: z.boolean().optional(),
});

const updateRecipientSchema = z
  .object({
    email: recipientEmailSchema.optional(),
    notifyInApp: z.boolean().optional(),
  })
  .refine((v) => v.email !== undefined || v.notifyInApp !== undefined, {
    message: "At least one of email or notifyInApp is required",
  });

router.get("/admin/gantt-pdf/alert-recipients", requireAuth, requireRole("SUPER_ADMIN"), async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [rows, config] = await Promise.all([
      listGanttPdfAlertRecipients(),
      getGanttPdfRecipientConfig(),
    ]);
    res.json({ recipients: rows, config });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/gantt-pdf/alert-recipients", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = createRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid recipient", details: parsed.error.flatten() });
    }
    try {
      const row = await addGanttPdfAlertRecipient(parsed.data);
      res.status(201).json({ recipient: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg)) {
        return res.status(409).json({ error: "A recipient with that email already exists" });
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

router.patch("/admin/gantt-pdf/alert-recipients/:id", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = updateRecipientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
    }
    try {
      const row = await updateGanttPdfAlertRecipient(req.params.id, parsed.data);
      if (!row) return res.status(404).json({ error: "Recipient not found" });
      res.json({ recipient: row });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/duplicate key|unique/i.test(msg)) {
        return res.status(409).json({ error: "A recipient with that email already exists" });
      }
      throw err;
    }
  } catch (error) {
    next(error);
  }
});

router.post("/admin/gantt-pdf/alert-recipients/test", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const triggeredBy = req.user?.email || req.user?.id || null;
    const result = await sendGanttPdfTestAlert({ triggeredBy });
    if (result.recipientCount === 0) {
      return res.status(409).json({
        error: "No recipients are currently configured. Add a recipient, set GANTT_PDF_ALERT_EMAILS, or ensure an active super admin exists.",
        recipientCount: 0,
        sentAt: result.sentAt,
      });
    }
    res.json({
      ok: true,
      recipientCount: result.recipientCount,
      recipients: result.recipients,
      sentAt: result.sentAt,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/admin/gantt-pdf/alert-recipients/:id", requireAuth, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const removed = await deleteGanttPdfAlertRecipient(req.params.id);
    if (!removed) return res.status(404).json({ error: "Recipient not found" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const ALLOWED_DELIVERY_KINDS = new Set([
  "queue_full",
  "browser_disconnected",
  "queue_drained",
  "browser_reconnected",
  "test_alert",
]);

function parseDeliveryKindsParam(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const cleaned = values
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0 && ALLOWED_DELIVERY_KINDS.has(v));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function parseDeliverySuccessParam(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const v = String(raw).toLowerCase();
  if (v === "true" || v === "success" || v === "delivered" || v === "1") return true;
  if (v === "false" || v === "failed" || v === "failure" || v === "0") return false;
  return undefined;
}

router.get(
  "/admin/gantt-pdf/alert-deliveries",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
      const kinds = parseDeliveryKindsParam(req.query.kind);
      const emailSuccess = parseDeliverySuccessParam(req.query.success);
      const sinceMsRaw = Number(req.query.sinceMs);
      const sinceMs =
        Number.isFinite(sinceMsRaw) && sinceMsRaw > 0 ? sinceMsRaw : undefined;
      const deliveries = await listGanttPdfAlertDeliveries({
        limit,
        kinds,
        emailSuccess,
        sinceMs,
      });
      res.json({
        deliveries,
        retentionMs: GANTT_PDF_ALERT_DELIVERIES_RETENTION_MS,
        filters: {
          kinds: kinds ?? null,
          emailSuccess: emailSuccess ?? null,
          sinceMs: sinceMs ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/admin/gantt-pdf/alert-deliveries",
  requireAuth,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const olderThanMsRaw = Number(req.query.olderThanMs);
      const olderThanMs =
        Number.isFinite(olderThanMsRaw) && olderThanMsRaw > 0
          ? olderThanMsRaw
          : undefined;
      const removed = await clearGanttPdfAlertDeliveries(
        olderThanMs ? { olderThanMs } : undefined,
      );
      res.json({ ok: true, removed, olderThanMs: olderThanMs ?? null });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================================
// Typed dependencies (FS / SS / FF / SF + lag)
// ============================================================================

const typedDepCreateSchema = z.object({
  predecessorTaskId: z.string().min(1),
  successorTaskId: z.string().min(1),
  dependencyType: z.enum(["FS", "SS", "FF", "SF"]).default("FS"),
  lagDays: z.number().int().default(0),
});

router.get(
  "/projects/:code/schedule/dependencies",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const schedule = await getActiveSchedule(project.id);
      if (!schedule) return res.json({ dependencies: [] });
      const rows = await db.select().from(scheduleTaskDependencies)
        .where(eq(scheduleTaskDependencies.scheduleId, schedule.id));
      res.json({ dependencies: rows });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/projects/:code/schedule/dependencies",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const parsed = typedDepCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
      if (parsed.data.predecessorTaskId === parsed.data.successorTaskId) {
        return res.status(400).json({ error: "Task cannot depend on itself" });
      }
      const schedule = await getActiveSchedule(project.id);
      if (!schedule) return res.status(404).json({ error: "No active schedule" });

      const allTasks = await db.select().from(projectScheduleTasks)
        .where(eq(projectScheduleTasks.scheduleId, schedule.id));
      const taskIds = new Set(allTasks.map(t => t.id));
      if (!taskIds.has(parsed.data.predecessorTaskId) || !taskIds.has(parsed.data.successorTaskId)) {
        return res.status(400).json({ error: "Predecessor or successor not in this schedule" });
      }

      const existingTyped = await db.select().from(scheduleTaskDependencies)
        .where(eq(scheduleTaskDependencies.scheduleId, schedule.id));
      const extraEdges = existingTyped
        .map(d => ({ successorId: d.successorTaskId, predecessorId: d.predecessorTaskId }))
        .concat({ successorId: parsed.data.successorTaskId, predecessorId: parsed.data.predecessorTaskId });
      if (detectCycle(
        parsed.data.successorTaskId,
        [],
        allTasks.map(t => ({ id: t.id, dependencies: t.dependencies })),
        extraEdges,
      )) {
        return res.status(400).json({ error: "Circular dependency detected" });
      }

      const [row] = await db.insert(scheduleTaskDependencies).values({
        scheduleId: schedule.id,
        predecessorTaskId: parsed.data.predecessorTaskId,
        successorTaskId: parsed.data.successorTaskId,
        dependencyType: parsed.data.dependencyType,
        lagDays: parsed.data.lagDays,
      }).onConflictDoUpdate({
        target: [scheduleTaskDependencies.successorTaskId, scheduleTaskDependencies.predecessorTaskId],
        set: {
          dependencyType: parsed.data.dependencyType,
          lagDays: parsed.data.lagDays,
        },
      }).returning();

      await recalculateSchedule(schedule.id);
      res.status(201).json({ dependency: row });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/projects/:code/schedule/dependencies/:depId",
  requireAuth,
  requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const schedule = await getActiveSchedule(project.id);
      if (!schedule) return res.status(404).json({ error: "No active schedule" });
      const result = await db.delete(scheduleTaskDependencies)
        .where(and(
          eq(scheduleTaskDependencies.id, req.params.depId),
          eq(scheduleTaskDependencies.scheduleId, schedule.id),
        ))
        .returning();
      if (result.length === 0) return res.status(404).json({ error: "Dependency not found" });
      await recalculateSchedule(schedule.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================================
// Look-ahead view (next N weeks of in-progress / upcoming tasks)
// ============================================================================

router.get(
  "/projects/:code/schedule/look-ahead",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const schedule = await getActiveSchedule(project.id);
      if (!schedule) return res.json({ horizonWeeks: 0, windowStart: null, windowEnd: null, tasks: [] });

      const requestedWeeks = Number(req.query.weeks);
      const horizonWeeks = Number.isFinite(requestedWeeks) && requestedWeeks > 0
        ? Math.min(Math.floor(requestedWeeks), 26)
        : (schedule.lookAheadHorizonWeeks || 3);

      const today = new Date();
      const windowStart = today.toISOString().split("T")[0];
      const windowEndDate = new Date(today.getTime() + horizonWeeks * 7 * 86400000);
      const windowEnd = windowEndDate.toISOString().split("T")[0];

      const tasks = await db.select().from(projectScheduleTasks)
        .where(eq(projectScheduleTasks.scheduleId, schedule.id));

      const inWindow = tasks.filter(t => {
        if (t.status === "COMPLETE") return false;
        const start = t.plannedStartDate;
        const end = t.plannedEndDate;
        if (!start && !end) return false;
        const taskStart = start || end!;
        const taskEnd = end || start!;
        return taskStart <= windowEnd && taskEnd >= windowStart;
      }).sort((a, b) => (a.plannedStartDate || "").localeCompare(b.plannedStartDate || ""));

      res.json({
        horizonWeeks,
        windowStart,
        windowEnd,
        tasks: inWindow,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================================================
// MS Project XML import / export
// ============================================================================

const importBodySchema = z.object({
  format: z.enum(["msp-xml"]).default("msp-xml"),
  xml: z.string().min(1),
  replaceExisting: z.boolean().default(false),
});

router.post(
  "/projects/:code/schedule/import",
  requireAuth,
  requireRole("ADMIN", "MANAGER"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const parsed = importBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });

      let imported;
      try {
        imported = parseMSProjectXml(parsed.data.xml);
      } catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Failed to parse XML" });
      }

      let schedule = await getActiveSchedule(project.id);
      if (!schedule) {
        const [created] = await db.insert(projectSchedules).values({
          projectId: project.id,
          name: imported.projectName || `${project.name} Schedule`,
          baselineStartDate: imported.startDate || new Date().toISOString().split("T")[0],
          baselineEndDate: imported.finishDate,
          isActive: true,
        }).returning();
        schedule = created;
      } else if (parsed.data.replaceExisting) {
        await db.delete(scheduleTaskDependencies).where(eq(scheduleTaskDependencies.scheduleId, schedule.id));
        await db.delete(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, schedule.id));
      }

      const externalIdToTaskId = new Map<string, string>();
      let sortOrder = 0;
      for (const t of imported.tasks) {
        const [inserted] = await db.insert(projectScheduleTasks).values({
          scheduleId: schedule.id,
          name: t.name,
          description: "",
          durationDays: t.durationDays,
          dependencies: [],
          isMilestone: t.isMilestone,
          plannedStartDate: t.plannedStartDate,
          plannedEndDate: t.plannedEndDate,
          percentComplete: t.percentComplete,
          sortOrder: sortOrder++,
          wbsCode: t.wbsCode || null,
          outlineLevel: t.outlineLevel,
          externalSourceRef: t.externalId,
        }).returning();
        externalIdToTaskId.set(t.externalId, inserted.id);
      }

      // Link parents in a second pass
      for (const t of imported.tasks) {
        if (!t.parentExternalId) continue;
        const childId = externalIdToTaskId.get(t.externalId);
        const parentId = externalIdToTaskId.get(t.parentExternalId);
        if (childId && parentId) {
          await db.update(projectScheduleTasks)
            .set({ parentTaskId: parentId, updatedAt: new Date() })
            .where(eq(projectScheduleTasks.id, childId));
        }
      }

      let depCount = 0;
      for (const d of imported.dependencies) {
        const predId = externalIdToTaskId.get(d.predecessorExternalId);
        const succId = externalIdToTaskId.get(d.successorExternalId);
        if (!predId || !succId) continue;
        await db.insert(scheduleTaskDependencies).values({
          scheduleId: schedule.id,
          predecessorTaskId: predId,
          successorTaskId: succId,
          dependencyType: d.type,
          lagDays: d.lagDays,
        }).onConflictDoNothing();
        depCount++;
      }

      await recalculateSchedule(schedule.id);

      res.status(201).json({
        scheduleId: schedule.id,
        tasksImported: externalIdToTaskId.size,
        dependenciesImported: depCount,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/projects/:code/schedule/export",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCode(req.params.code);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (!checkAccess(req, project)) return res.status(403).json({ error: "Access denied" });
      const format = String(req.query.format || "msp-xml");
      if (format !== "msp-xml") return res.status(400).json({ error: "Unsupported format. Supported: msp-xml" });

      const schedule = await getActiveSchedule(project.id);
      if (!schedule) return res.status(404).json({ error: "No active schedule" });

      const tasks = await db.select().from(projectScheduleTasks)
        .where(eq(projectScheduleTasks.scheduleId, schedule.id));
      const deps = await db.select().from(scheduleTaskDependencies)
        .where(eq(scheduleTaskDependencies.scheduleId, schedule.id));

      const startDate = schedule.baselineStartDate
        || tasks.reduce<string | null>((min, t) => {
          if (!t.plannedStartDate) return min;
          return !min || t.plannedStartDate < min ? t.plannedStartDate : min;
        }, null)
        || new Date().toISOString().split("T")[0];
      const finishDate = schedule.projectedCompletionDate
        || schedule.baselineEndDate
        || tasks.reduce<string | null>((max, t) => {
          if (!t.plannedEndDate) return max;
          return !max || t.plannedEndDate > max ? t.plannedEndDate : max;
        }, null)
        || startDate;

      const xml = buildMSProjectXml({
        projectName: project.name || schedule.name || "Schedule",
        startDate,
        finishDate,
        tasks: tasks.map(t => ({
          id: t.id,
          name: t.name,
          outlineLevel: t.outlineLevel ?? 1,
          wbsCode: t.wbsCode,
          durationDays: t.durationDays,
          plannedStartDate: t.plannedStartDate,
          plannedEndDate: t.plannedEndDate,
          percentComplete: t.percentComplete || 0,
          isMilestone: t.isMilestone || false,
          parentTaskId: t.parentTaskId,
        })),
        dependencies: deps.map(d => ({
          predecessorTaskId: d.predecessorTaskId,
          successorTaskId: d.successorTaskId,
          type: d.dependencyType as DependencyType,
          lagDays: d.lagDays || 0,
        })),
      });

      const filename = `${(project.code || "schedule").replace(/[^a-z0-9_-]/gi, "_")}-schedule.xml`;
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
