import { logError, logWarn } from "./utils/logger";
import { db } from "./db";
import {
  projectScheduleTasks,
  projectSchedules,
  scheduleForecastSnapshots,
  scheduleTaskDependencies,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export interface TypedDependency {
  predecessorId: string;
  type: DependencyType;
  lagDays: number;
}

interface TaskNode {
  id: string;
  durationDays: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  dependencies: TypedDependency[];
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
  workingDaysList?: number[],
  typedDependenciesByTask?: Map<string, TypedDependency[]>,
): CPMResult {
  if (tasks.length === 0) {
    return { tasks: [], projectedCompletionDate: projectStartDate, criticalPathDaysRemaining: 0 };
  }

  const taskIdSet = new Set(tasks.map(t => t.id));
  const taskMap = new Map<string, TaskNode>();
  const successorMap = new Map<string, string[]>();

  for (const t of tasks) {
    const typedDeps = typedDependenciesByTask?.get(t.id);
    let deps: TypedDependency[];
    if (typedDeps && typedDeps.length > 0) {
      deps = typedDeps.filter(d => taskIdSet.has(d.predecessorId));
    } else {
      deps = (t.dependencies || [])
        .filter(d => taskIdSet.has(d))
        .map(predecessorId => ({ predecessorId, type: "FS" as DependencyType, lagDays: 0 }));
    }
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
      if (!successorMap.has(dep.predecessorId)) successorMap.set(dep.predecessorId, []);
      successorMap.get(dep.predecessorId)!.push(id);
    }
  }

  const sorted = topologicalSort(taskMap);

  for (const id of sorted) {
    const node = taskMap.get(id)!;
    let earliest = 0;
    let constrained = false;
    for (const dep of node.dependencies) {
      const pred = taskMap.get(dep.predecessorId);
      if (!pred) continue;
      let candidate: number;
      switch (dep.type) {
        case "SS":
          candidate = pred.earlyStart + dep.lagDays;
          break;
        case "FF":
          candidate = pred.earlyFinish + dep.lagDays - node.durationDays;
          break;
        case "SF":
          candidate = pred.earlyStart + dep.lagDays - node.durationDays;
          break;
        case "FS":
        default:
          candidate = pred.earlyFinish + dep.lagDays;
          break;
      }
      if (!constrained || candidate > earliest) {
        earliest = candidate;
        constrained = true;
      }
    }
    node.earlyStart = constrained ? Math.max(0, earliest) : 0;

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
    const succIds = successorMap.get(id) || [];

    if (succIds.length === 0) {
      node.lateFinish = projectDuration;
      node.lateStart = node.lateFinish - (node.earlyFinish - node.earlyStart);
      continue;
    }

    let latestStart = Infinity;
    let latestFinish = Infinity;
    for (const succId of succIds) {
      const succ = taskMap.get(succId);
      if (!succ) continue;
      const dep = succ.dependencies.find(d => d.predecessorId === id);
      if (!dep) continue;
      switch (dep.type) {
        case "SS": {
          const ls = succ.lateStart - dep.lagDays;
          latestStart = Math.min(latestStart, ls);
          break;
        }
        case "FF": {
          const lf = succ.lateFinish - dep.lagDays;
          latestFinish = Math.min(latestFinish, lf);
          break;
        }
        case "SF": {
          const lf = succ.lateFinish - dep.lagDays;
          // SF: predecessor start to successor finish
          const lsFromSf = lf - (node.earlyFinish - node.earlyStart);
          latestStart = Math.min(latestStart, lsFromSf + (node.earlyFinish - node.earlyStart));
          break;
        }
        case "FS":
        default: {
          const lf = succ.lateStart - dep.lagDays;
          latestFinish = Math.min(latestFinish, lf);
          break;
        }
      }
    }
    const duration = node.earlyFinish - node.earlyStart;
    if (latestStart === Infinity && latestFinish === Infinity) {
      node.lateFinish = projectDuration;
    } else if (latestStart !== Infinity && latestFinish !== Infinity) {
      node.lateFinish = Math.min(latestFinish, latestStart + duration);
    } else if (latestFinish !== Infinity) {
      node.lateFinish = latestFinish;
    } else {
      node.lateFinish = latestStart + duration;
    }
    node.lateStart = node.lateFinish - duration;
  }

  for (const [id, node] of taskMap) {
    node.totalFloat = node.lateStart - node.earlyStart;

    const succIds = successorMap.get(id) || [];
    if (succIds.length === 0) {
      node.freeFloat = projectDuration - node.earlyFinish;
    } else {
      // Free float = minimum slack across each successor edge, respecting type+lag.
      // For each successor, compute the earliest moment by which this predecessor
      // must finish (or start, for SS/SF) without delaying the successor's ES.
      let minSlack = Infinity;
      for (const succId of succIds) {
        const succ = taskMap.get(succId);
        if (!succ) continue;
        const dep = succ.dependencies.find(d => d.predecessorId === id);
        if (!dep) continue;
        let slack: number;
        switch (dep.type) {
          case "SS":
            slack = (succ.earlyStart - dep.lagDays) - node.earlyStart;
            break;
          case "FF":
            slack = (succ.earlyFinish - dep.lagDays) - node.earlyFinish;
            break;
          case "SF":
            slack = (succ.earlyFinish - dep.lagDays) - node.earlyStart;
            break;
          case "FS":
          default:
            slack = (succ.earlyStart - dep.lagDays) - node.earlyFinish;
            break;
        }
        if (slack < minSlack) minSlack = slack;
      }
      node.freeFloat = minSlack === Infinity ? 0 : Math.max(0, minSlack);
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
      logWarn(`CPM: Cycle detected involving task ${id}, breaking cycle`);
      return;
    }
    visiting.add(id);

    const node = taskMap.get(id);
    if (node) {
      for (const dep of node.dependencies) {
        if (taskMap.has(dep.predecessorId)) {
          visit(dep.predecessorId);
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

export function detectCycle(
  taskId: string,
  dependencies: string[],
  allTasks: Array<{ id: string; dependencies: string[] | null }>,
  extraEdges?: Array<{ successorId: string; predecessorId: string }>,
): boolean {
  const graph = new Map<string, string[]>();
  for (const t of allTasks) {
    graph.set(t.id, t.id === taskId ? dependencies : (t.dependencies || []));
  }
  if (extraEdges) {
    for (const edge of extraEdges) {
      if (!graph.has(edge.successorId)) graph.set(edge.successorId, []);
      const arr = graph.get(edge.successorId)!;
      if (!arr.includes(edge.predecessorId)) arr.push(edge.predecessorId);
    }
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

export async function loadTypedDependencyMap(scheduleId: string): Promise<Map<string, TypedDependency[]>> {
  const rows = await db.select().from(scheduleTaskDependencies).where(eq(scheduleTaskDependencies.scheduleId, scheduleId));
  const map = new Map<string, TypedDependency[]>();
  for (const r of rows) {
    if (!map.has(r.successorTaskId)) map.set(r.successorTaskId, []);
    map.get(r.successorTaskId)!.push({
      predecessorId: r.predecessorTaskId,
      type: r.dependencyType as DependencyType,
      lagDays: r.lagDays || 0,
    });
  }
  return map;
}

export async function recalculateSchedule(scheduleId: string): Promise<CPMResult | null> {
  const [schedule] = await db.select().from(projectSchedules).where(eq(projectSchedules.id, scheduleId));
  if (!schedule) return null;

  const tasks = await db.select().from(projectScheduleTasks).where(eq(projectScheduleTasks.scheduleId, scheduleId));
  if (tasks.length === 0) return null;

  const projectStart = schedule.baselineStartDate || tasks[0].plannedStartDate || new Date().toISOString().split("T")[0];
  const workingDaysList = schedule.workingDays ? (schedule.workingDays as number[]) : undefined;
  const typedDepsMap = await loadTypedDependencyMap(scheduleId);
  const previousTaskDates = new Map(tasks.map(t => [t.id, { start: t.plannedStartDate, end: t.plannedEndDate }]));
  const result = runCPM(tasks, projectStart, workingDaysList, typedDepsMap);

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

  try {
    const reschedules: Array<{ taskId: string; previousEnd: string | null; newEnd: string | null; deltaDays: number }> = [];
    for (const cpmTask of result.tasks) {
      const prev = previousTaskDates.get(cpmTask.id);
      if (prev?.end && cpmTask.plannedEndDate && prev.end !== cpmTask.plannedEndDate) {
        const deltaDays = Math.round(
          (new Date(cpmTask.plannedEndDate).getTime() - new Date(prev.end).getTime()) / 86400000,
        );
        if (deltaDays !== 0) {
          reschedules.push({ taskId: cpmTask.id, previousEnd: prev.end, newEnd: cpmTask.plannedEndDate, deltaDays });
        }
      }
    }
    const baselineVariance = schedule.baselineEndDate && result.projectedCompletionDate
      ? Math.round((new Date(result.projectedCompletionDate).getTime() - new Date(schedule.baselineEndDate).getTime()) / 86400000)
      : null;
    if (reschedules.length > 0 || (baselineVariance !== null && baselineVariance >= 1)) {
      const { notifyScheduleChange } = await import("./services/scheduleNotificationService");
      await notifyScheduleChange({ scheduleId, reschedules, baselineVarianceDays: baselineVariance });
    }
  } catch (e) {
    logError("Failed to emit schedule change notifications", {}, e instanceof Error ? e : new Error(String(e)));
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
