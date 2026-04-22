import { db } from "../db";
import {
  projectSchedules,
  projectScheduleTasks,
  projects,
  type InsertNotification,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { logError } from "../utils/logger";
import { insertNotifications } from "./notificationService";

export interface ScheduleChangeContext {
  scheduleId: string;
  reschedules: Array<{
    taskId: string;
    previousEnd: string | null;
    newEnd: string | null;
    deltaDays: number;
  }>;
  baselineVarianceDays: number | null;
}

const SLIP_RENOTIFY_GROW_DAYS = 1;

export async function notifyScheduleChange(ctx: ScheduleChangeContext): Promise<void> {
  try {
    const [schedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, ctx.scheduleId));
    if (!schedule) return;
    const [project] = await db.select().from(projects).where(eq(projects.id, schedule.projectId));
    if (!project) return;

    const recipientIds = new Set<string>();
    if (project.projectManagerId) recipientIds.add(project.projectManagerId);
    if (project.superintendentId) recipientIds.add(project.superintendentId);

    if (recipientIds.size === 0) return;

    const inserts: InsertNotification[] = [];

    const significant = ctx.reschedules.filter(r => Math.abs(r.deltaDays) >= 1);
    if (significant.length > 0) {
      const top = significant
        .slice()
        .sort((a, b) => Math.abs(b.deltaDays) - Math.abs(a.deltaDays))
        .slice(0, 3);
      const taskIds = top.map(t => t.taskId);
      const taskRows = taskIds.length
        ? await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, ctx.scheduleId))
        : [];
      const taskNameById = new Map(taskRows.map(t => [t.id, t.name]));
      const summary = top.map(t => {
        const direction = t.deltaDays > 0 ? "delayed" : "pulled in";
        const days = Math.abs(t.deltaDays);
        return `${taskNameById.get(t.taskId) || t.taskId}: ${direction} ${days} day${days === 1 ? "" : "s"}`;
      }).join("; ");
      const more = significant.length - top.length;
      const message = `${significant.length} task${significant.length === 1 ? "" : "s"} rescheduled on ${project.name}. ${summary}${more > 0 ? ` (and ${more} more)` : ""}.`;
      for (const userId of recipientIds) {
        inserts.push({
          userId,
          type: "SCHEDULE_TASK_RESCHEDULED",
          title: `Schedule updated — ${project.name}`,
          message,
          relatedEntityType: "project",
          relatedEntityId: project.id,
        });
      }
    }

    if (
      ctx.baselineVarianceDays !== null &&
      ctx.baselineVarianceDays >= 1 &&
      (schedule.lastSlipVarianceDays === null ||
        ctx.baselineVarianceDays - (schedule.lastSlipVarianceDays || 0) >= SLIP_RENOTIFY_GROW_DAYS)
    ) {
      const message = `${project.name} is forecasted to finish ${ctx.baselineVarianceDays} day${ctx.baselineVarianceDays === 1 ? "" : "s"} past baseline (projected ${schedule.projectedCompletionDate}, baseline ${schedule.baselineEndDate}).`;
      for (const userId of recipientIds) {
        inserts.push({
          userId,
          type: "SCHEDULE_BASELINE_SLIP",
          title: `Schedule slip — ${project.name}`,
          message,
          relatedEntityType: "project",
          relatedEntityId: project.id,
        });
      }
      await db.update(projectSchedules)
        .set({
          lastSlipVarianceDays: ctx.baselineVarianceDays,
          lastSlipNotifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectSchedules.id, ctx.scheduleId));
    }

    if (inserts.length > 0) {
      await insertNotifications(inserts);
    }
  } catch (err) {
    logError("notifyScheduleChange failed", { scheduleId: ctx.scheduleId }, err instanceof Error ? err : new Error(String(err)));
  }
}
