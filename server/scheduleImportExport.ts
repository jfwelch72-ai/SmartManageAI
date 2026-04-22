import { XMLParser, XMLBuilder } from "fast-xml-parser";
import type { DependencyType } from "./cpmEngine";

export interface ImportedTask {
  externalId: string;
  name: string;
  outlineLevel: number;
  wbsCode?: string;
  durationDays: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  percentComplete: number;
  isMilestone: boolean;
  parentExternalId?: string;
}

export interface ImportedDependency {
  predecessorExternalId: string;
  successorExternalId: string;
  type: DependencyType;
  lagDays: number;
}

export interface ImportedSchedule {
  projectName?: string;
  startDate: string | null;
  finishDate: string | null;
  tasks: ImportedTask[];
  dependencies: ImportedDependency[];
}

const MSP_TYPE_MAP: Record<string, DependencyType> = {
  "0": "FF",
  "1": "FS",
  "2": "SF",
  "3": "SS",
};

const MSP_TYPE_REVERSE: Record<DependencyType, string> = {
  FF: "0",
  FS: "1",
  SF: "2",
  SS: "3",
};

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function durationToDays(value: unknown): number {
  if (!value) return 1;
  const s = String(value);
  // ISO 8601 duration: PT8H0M0S, or P1D, etc.
  const dayMatch = s.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1] || "0", 10);
    const hours = parseInt(dayMatch[2] || "0", 10);
    const minutes = parseInt(dayMatch[3] || "0", 10);
    const totalMinutes = days * 8 * 60 + hours * 60 + minutes;
    return Math.max(1, Math.round(totalMinutes / (8 * 60)));
  }
  const num = Number(s);
  if (!isNaN(num)) return Math.max(1, Math.round(num));
  return 1;
}

function daysToIsoDuration(days: number): string {
  return `PT${Math.max(1, days) * 8}H0M0S`;
}

function lagToDays(lagValue: unknown, lagFormat: unknown): number {
  if (lagValue === undefined || lagValue === null || lagValue === "") return 0;
  const n = Number(lagValue);
  if (isNaN(n)) return 0;
  // MS Project stores lag in tenths of minutes. lagFormat 7 = days, 4 = hours.
  // Default: assume tenths of minutes converted to days (8h = 480 minutes = 4800 tenths).
  const fmt = lagFormat !== undefined && lagFormat !== null ? String(lagFormat) : "";
  if (fmt === "7" || fmt === "11") return Math.round(n / 4800); // days
  if (fmt === "4" || fmt === "8") return Math.round(n / 600 / 8); // hours -> days
  // Fallback: treat as already days
  return Math.round(n / 4800);
}

function daysToLagValue(days: number): string {
  return String(days * 4800);
}

export function parseMSProjectXml(xml: string): ImportedSchedule {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name) => ["Task", "PredecessorLink"].includes(name),
  });
  const doc = parser.parse(xml);
  const project = doc.Project;
  if (!project) throw new Error("Invalid MS Project XML: missing Project root");

  const startDate = toIsoDate(project.StartDate);
  const finishDate = toIsoDate(project.FinishDate);
  const projectName = project.Name ? String(project.Name) : undefined;

  const rawTasks: any[] = project.Tasks?.Task || [];
  const tasks: ImportedTask[] = [];
  const dependencies: ImportedDependency[] = [];

  // Build parent stack by outlineLevel order in the file
  const parentStack: Array<{ uid: string; level: number }> = [];

  for (const t of rawTasks) {
    const uid = String(t.UID ?? "");
    if (!uid || uid === "0") continue; // skip project summary task
    const outlineLevel = parseInt(String(t.OutlineLevel || "1"), 10);
    while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= outlineLevel) {
      parentStack.pop();
    }
    const parentExternalId = parentStack.length > 0 ? parentStack[parentStack.length - 1].uid : undefined;

    const isMilestone = String(t.Milestone || "0") === "1";
    const summary = String(t.Summary || "0") === "1";

    tasks.push({
      externalId: uid,
      name: String(t.Name || `Task ${uid}`),
      outlineLevel,
      wbsCode: t.WBS ? String(t.WBS) : undefined,
      durationDays: durationToDays(t.Duration),
      plannedStartDate: toIsoDate(t.Start),
      plannedEndDate: toIsoDate(t.Finish),
      percentComplete: parseInt(String(t.PercentComplete || "0"), 10),
      isMilestone,
      parentExternalId,
    });

    parentStack.push({ uid, level: outlineLevel });

    if (summary) continue;

    const links = t.PredecessorLink || [];
    for (const link of links) {
      const predUid = String(link.PredecessorUID ?? "");
      if (!predUid || predUid === "0") continue;
      const typeCode = String(link.Type ?? "1");
      const depType = MSP_TYPE_MAP[typeCode] || "FS";
      dependencies.push({
        predecessorExternalId: predUid,
        successorExternalId: uid,
        type: depType,
        lagDays: lagToDays(link.LinkLag, link.LagFormat),
      });
    }
  }

  return { projectName, startDate, finishDate, tasks, dependencies };
}

export interface ExportTaskInput {
  id: string;
  name: string;
  outlineLevel: number | null;
  wbsCode: string | null;
  durationDays: number | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  percentComplete: number;
  isMilestone: boolean;
  parentTaskId: string | null;
}

export interface ExportDependencyInput {
  predecessorTaskId: string;
  successorTaskId: string;
  type: DependencyType;
  lagDays: number;
}

export function buildMSProjectXml(opts: {
  projectName: string;
  startDate: string;
  finishDate: string;
  tasks: ExportTaskInput[];
  dependencies: ExportDependencyInput[];
}): string {
  const idToUid = new Map<string, number>();
  let nextUid = 1;
  const orderedTasks = [...opts.tasks];
  for (const t of orderedTasks) {
    idToUid.set(t.id, nextUid++);
  }

  const depsBySuccessor = new Map<string, ExportDependencyInput[]>();
  for (const d of opts.dependencies) {
    if (!depsBySuccessor.has(d.successorTaskId)) depsBySuccessor.set(d.successorTaskId, []);
    depsBySuccessor.get(d.successorTaskId)!.push(d);
  }

  const taskNodes = orderedTasks.map((t, idx) => {
    const uid = idToUid.get(t.id)!;
    const links = (depsBySuccessor.get(t.id) || [])
      .filter(d => idToUid.has(d.predecessorTaskId))
      .map(d => ({
        PredecessorUID: idToUid.get(d.predecessorTaskId)!,
        Type: MSP_TYPE_REVERSE[d.type] || "1",
        LinkLag: daysToLagValue(d.lagDays || 0),
        LagFormat: "7",
      }));

    return {
      UID: uid,
      ID: idx + 1,
      Name: t.name,
      Active: "1",
      Manual: "0",
      Type: "0",
      OutlineLevel: t.outlineLevel ?? 1,
      WBS: t.wbsCode || `${idx + 1}`,
      Milestone: t.isMilestone ? "1" : "0",
      Summary: "0",
      Start: t.plannedStartDate ? `${t.plannedStartDate}T08:00:00` : `${opts.startDate}T08:00:00`,
      Finish: t.plannedEndDate ? `${t.plannedEndDate}T17:00:00` : `${opts.finishDate}T17:00:00`,
      Duration: daysToIsoDuration(t.durationDays || 1),
      PercentComplete: t.percentComplete || 0,
      ...(links.length > 0 ? { PredecessorLink: links } : {}),
    };
  });

  const doc = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8", "@_standalone": "yes" },
    Project: {
      "@_xmlns": "http://schemas.microsoft.com/project",
      Name: opts.projectName,
      Title: opts.projectName,
      StartDate: `${opts.startDate}T08:00:00`,
      FinishDate: `${opts.finishDate}T17:00:00`,
      ScheduleFromStart: "1",
      MinutesPerDay: "480",
      MinutesPerWeek: "2400",
      DaysPerMonth: "20",
      Tasks: { Task: taskNodes },
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
  });
  return builder.build(doc);
}
