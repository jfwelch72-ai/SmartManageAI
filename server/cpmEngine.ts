import { logError } from "./utils/logger";
import { db } from "./db";
import { projectScheduleTasks, projectSchedules, scheduleForecastSnapshots } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface TaskNode {
  id: string;
  durationDays: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  dependencies: string[];
  status: string;
  percentComplete: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
}

function addWorkingDays(startDate: Date, days: number, workingDays: number[] = [1, 2, 3, 4, 5]): Date {
  if (days <= 0) return new Date(startDate);
  const result = new Date(startDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (workingDays.includes(result.getDay())) {
      added++;
    }
  }
  return result;
}

function workingDaysBetween(start: Date, end: Date, workingDays: number[] = [1, 2, 3, 4, 5]): number {
  if (end <= start) return 0;
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    if (workingDays.includes(current.getDay())) {
      count++;
    }
  }
  return count;
}

function dateToDay(date: string, projectStart: string, workingDaysList?: number[]): number {
  if (workingDaysList && workingDaysList.length > 0 && workingDaysList.length < 7) {
    return workingDaysBetween(new Date(projectStart), new Date(date), workingDaysList);
  }
  const d = new Date(date);
  const s = new Date(projectStart);
  return Math.round((d.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
}

function dayToDate(day: number, projectStart: string, workingDaysList?: number[]): string {
  if (workingDaysList && workingDaysList.length > 0 && workingDaysList.length < 7) {
    const result = addWorkingDays(new Date(projectStart), day, workingDaysList);
    return result.toISOString().split("T")[0];
  }
  const s = new Date(projectStart);
  s.setDate(s.getDate() + day);
  return s.toISOString().split("T")[0];
}

export interface CPMResult {
  tasks: Array<{
    id: string;
    earlyStart: string;
    earlyFinish: string;
    lateStart: string;
    lateFinish: string;
    totalFloat: number;
    freeFloat: number;
    isCriticalPath: boolean;
    plannedStartDate: string;
    plannedEndDate: string;
  }>;
  projectedCompletionDate: string;
  criticalPathDaysRemaining: number;
}

export function runCPM(
  tasks: Array<{
    id: string;
    durationDays: number | null;
    plannedStartDate: string | null;
    plannedEndDate: string | null;
    actualStartDate: string | null;
    actualEndDate: string | null;
    dependencies: string[] | null;
    status: string;
    percentComplete: number;
  }>,
  projectStartDate: string,
  workingDaysList?: number[]
): CPMResult {
  if (tasks.length === 0) {
    return { tasks: [], projectedCompletionDate: projectStartDate, criticalPathDaysRemaining: 0 };
  }

  const taskMap = new Map<string, TaskNode>();
  const successorMap = new Map<string, string[]>();

  for (const t of tasks) {
    const deps = (t.dependencies || []).filter(d => tasks.some(task => task.id === d));
    taskMap.set(t.id, {
      id: t.id,
      durationDays: t.durationDays || 1,
      plannedStartDate: t.plannedStartDate,
      plannedEndDate: t.plannedEndDate,
      actualStartDate: t.actualStartDate,
      actualEndDate: t.actualEndDate,
      dependencies: deps,
      status: t.status,
      percentComplete: t.percentComplete,
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      freeFloat: 0,
    });
  }

  for (const [id, node] of taskMap) {
    for (const dep of node.dependencies) {
      if (!successorMap.has(dep)) successorMap.set(dep, []);
      successorMap.get(dep)!.push(id);
    }
  }

  const sorted = topologicalSort(taskMap);

  for (const id of sorted) {
    const node = taskMap.get(id)!;
    if (node.dependencies.length === 0) {
      node.earlyStart = 0;
    } else {
      let maxPredFinish = 0;
      for (const dep of node.dependencies) {
        const pred = taskMap.get(dep);
        if (pred) {
          maxPredFinish = Math.max(maxPredFinish, pred.earlyFinish);
        }
      }
      node.earlyStart = maxPredFinish;
    }

    if (node.status === "COMPLETE" && node.actualStartDate && node.actualEndDate) {
      const actualDuration = dateToDay(node.actualEndDate, projectStartDate, workingDaysList) - dateToDay(node.actualStartDate, projectStartDate, workingDaysList) + 1;
      node.earlyStart = dateToDay(node.actualStartDate, projectStartDate, workingDaysList);
      node.earlyFinish = node.earlyStart + Math.max(actualDuration, 1);
    } else if (node.status === "IN_PROGRESS" && node.actualStartDate) {
      node.earlyStart = dateToDay(node.actualStartDate, projectStartDate, workingDaysList);
      const remainingDuration = Math.ceil(node.durationDays * (1 - node.percentComplete / 100));
      node.earlyFinish = node.earlyStart + Math.max(remainingDuration, 1);
    } else {
      node.earlyFinish = node.earlyStart + node.durationDays;
    }
  }

  let projectDuration = 0;
  for (const [, node] of taskMap) {
    projectDuration = Math.max(projectDuration, node.earlyFinish);
  }

  for (let i = sorted.length - 1; i >= 0; i--) {
    const id = sorted[i];
    const node = taskMap.get(id)!;
    const succs = successorMap.get(id) || [];

    if (succs.length === 0) {
      node.lateFinish = projectDuration;
    } else {
      let minSuccStart = Infinity;
      for (const succId of succs) {
        const succ = taskMap.get(succId);
        if (succ) {
          minSuccStart = Math.min(minSuccStart, succ.lateStart);
        }
      }
      node.lateFinish = minSuccStart;
    }
    node.lateStart = node.lateFinish - (node.earlyFinish - node.earlyStart);
  }

  for (const [id, node] of taskMap) {
    node.totalFloat = node.lateStart - node.earlyStart;

    const succs = successorMap.get(id) || [];
    if (succs.length === 0) {
      node.freeFloat = projectDuration - node.earlyFinish;
    } else {
      let minSuccES = Infinity;
      for (const succId of succs) {
        const succ = taskMap.get(succId);
        if (succ) {
          minSuccES = Math.min(minSuccES, succ.earlyStart);
        }
      }
      node.freeFloat = minSuccES - node.earlyFinish;
    }
  }

  const resultTasks = sorted.map(id => {
    const node = taskMap.get(id)!;
    const isCritical = Math.abs(node.totalFloat) < 0.5;
    const inclusiveEF = node.earlyFinish > 0 ? node.earlyFinish - 1 : 0;
    const inclusiveLF = node.lateFinish > 0 ? node.lateFinish - 1 : 0;
    return {
      id: node.id,
      earlyStart: dayToDate(node.earlyStart, projectStartDate, workingDaysList),
      earlyFinish: dayToDate(inclusiveEF, projectStartDate, workingDaysList),
      lateStart: dayToDate(node.lateStart, projectStartDate, workingDaysList),
      lateFinish: dayToDate(inclusiveLF, projectStartDate, workingDaysList),
      totalFloat: node.totalFloat,
      freeFloat: node.freeFloat,
      isCriticalPath: isCritical,
      plannedStartDate: dayToDate(node.earlyStart, projectStartDate, workingDaysList),
      plannedEndDate: dayToDate(inclusiveEF, projectStartDate, workingDaysList),
    };
  });

  let criticalPathDaysRemaining = 0;
  for (const t of resultTasks) {
    if (t.isCriticalPath) {
      const originalTask = tasks.find(ot => ot.id === t.id);
      if (originalTask && originalTask.status !== "COMPLETE") {
        const dur = originalTask.durationDays || 1;
        const pct = originalTask.percentComplete || 0;
        criticalPathDaysRemaining += Math.ceil(dur * (1 - pct / 100));
      }
    }
  }

  const projectedCompletionDate = dayToDate(projectDuration > 0 ? projectDuration - 1 : 0, projectStartDate, workingDaysList);

  return {
    tasks: resultTasks,
    projectedCompletionDate,
    criticalPathDaysRemaining,
  };
}

function topologicalSort(taskMap: Map<string, TaskNode>): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      console.warn(`CPM: Cycle detected involving task ${id}, breaking cycle`);
      return;
    }
    visiting.add(id);

    const node = taskMap.get(id);
    if (node) {
      for (const dep of node.dependencies) {
        if (taskMap.has(dep)) {
          visit(dep);
        }
      }
    }
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const id of taskMap.keys()) {
    visit(id);
  }

  return result;
}

export function detectCycle(taskId: string, dependencies: string[], allTasks: Array<{ id: string; dependencies: string[] | null }>): boolean {
  const graph = new Map<string, string[]>();
  for (const t of allTasks) {
    graph.set(t.id, t.id === taskId ? dependencies : (t.dependencies || []));
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();

  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of (graph.get(id) || [])) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return hasCycle(taskId);
}

export async function recalculateSchedule(scheduleId: string): Promise<CPMResult | null> {
  const [schedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, scheduleId));
  if (!schedule) return null;

  const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
  if (tasks.length === 0) return null;

  const projectStart = schedule.baselineStartDate || tasks[0].plannedStartDate || new Date().toISOString().split("T")[0];
  const workingDaysList = schedule.workingDays ? (schedule.workingDays as number[]) : undefined;
  const result = runCPM(tasks, projectStart, workingDaysList);

  for (const cpmTask of result.tasks) {
    await db.update(projectScheduleTasks)
      .set({
        earlyStart: cpmTask.earlyStart,
        earlyFinish: cpmTask.earlyFinish,
        lateStart: cpmTask.lateStart,
        lateFinish: cpmTask.lateFinish,
        totalFloat: cpmTask.totalFloat,
        freeFloat: cpmTask.freeFloat,
        isCriticalPath: cpmTask.isCriticalPath,
        plannedStartDate: cpmTask.plannedStartDate,
        plannedEndDate: cpmTask.plannedEndDate,
        updatedAt: new Date(),
      })
      .where(eq(projectScheduleTasks.id, cpmTask.id));
  }

  const overallProgress = tasks.length > 0
    ? Math.round(tasks.reduce((sum, t) => sum + (t.percentComplete || 0), 0) / tasks.length)
    : 0;

  let spiValue: string | null = null;
  if (schedule.baselineLocked && schedule.baselineEndDate && schedule.baselineStartDate) {
    const baselineDuration = dateToDay(schedule.baselineEndDate, schedule.baselineStartDate, workingDaysList);
    if (baselineDuration > 0) {
      const earnedDuration = (overallProgress / 100) * baselineDuration;
      const today = new Date().toISOString().split("T")[0];
      const elapsedDuration = Math.max(1, dateToDay(today, schedule.baselineStartDate, workingDaysList));
      const plannedProgress = Math.min(elapsedDuration / baselineDuration, 1);
      const plannedDuration = plannedProgress * baselineDuration;
      spiValue = plannedDuration > 0 ? (earnedDuration / plannedDuration).toFixed(3) : "1.000";
    }
  }

  await db.update(projectSchedules)
    .set({
      projectedCompletionDate: result.projectedCompletionDate,
      spiValue,
      updatedAt: new Date(),
    })
    .where(eq(projectSchedules.id, scheduleId));

  try {
    await db.insert(scheduleForecastSnapshots).values({
      scheduleId,
      snapshotDate: new Date().toISOString().split("T")[0],
      projectedCompletionDate: result.projectedCompletionDate,
      spiValue,
      baselineEndDate: schedule.baselineEndDate,
      currentEndDate: result.projectedCompletionDate,
      criticalPathDaysRemaining: result.criticalPathDaysRemaining,
      overallProgress,
    });
  } catch (e) {
    logError("Failed to save forecast snapshot:", {}, e instanceof Error ? e : new Error(String(e)));
  }

  return result;
}

export function computeScheduleImpact(
  delayStartDate: string,
  delayEndDate: string | null,
  estimatedDuration: number | null,
  criticalPathTasks: Array<{ plannedStartDate: string | null; plannedEndDate: string | null; status: string }>
): { impactDays: number; affectsCriticalPath: boolean } {
  const delayStart = new Date(delayStartDate);
  const delayEnd = delayEndDate ? new Date(delayEndDate) : (estimatedDuration ? new Date(delayStart.getTime() + estimatedDuration * 86400000) : new Date());
  
  let impactDays = 0;
  let affectsCriticalPath = false;

  for (const task of criticalPathTasks) {
    if (task.status === "COMPLETE" || !task.plannedStartDate || !task.plannedEndDate) continue;
    const taskStart = new Date(task.plannedStartDate);
    const taskEnd = new Date(task.plannedEndDate);
    
    const overlapStart = new Date(Math.max(delayStart.getTime(), taskStart.getTime()));
    const overlapEnd = new Date(Math.min(delayEnd.getTime(), taskEnd.getTime()));
    
    if (overlapStart <= overlapEnd) {
      affectsCriticalPath = true;
      const overlapDays = Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1;
      impactDays = Math.max(impactDays, overlapDays);
    }
  }

  if (!affectsCriticalPath && estimatedDuration) {
    impactDays = estimatedDuration;
  }

  return { impactDays, affectsCriticalPath };
}

export async function computeProjectDelayImpact(
  projectId: string,
  estimatedDuration: number,
  delayStartDate?: string
): Promise<{ impactDays: number; criticalPathAffected: boolean; projectedCompletionDate: string | null } | null> {
  const { projectSchedules: ps, projectScheduleTasks: pst } = await import("@shared/schema");
  const [schedule] = await db.select().from(ps).where(and(eq(ps.projectId, projectId), eq(ps.isActive, true)));
  if (!schedule) return null;

  const tasks = await db.select().from(pst).where(eq(pst.scheduleId, schedule.id));
  const criticalPathTasks = tasks.filter(t => t.isCriticalPath);

  const startDate = delayStartDate || new Date().toISOString().split("T")[0];
  const result = computeScheduleImpact(startDate, null, estimatedDuration, criticalPathTasks);

  return {
    impactDays: result.impactDays,
    criticalPathAffected: result.affectsCriticalPath,
    projectedCompletionDate: schedule.projectedCompletionDate || null,
  };
}
