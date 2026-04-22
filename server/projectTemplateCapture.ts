import { db } from "./db";
import { and, eq, desc } from "drizzle-orm";
import {
  projects,
  projectScheduleTasks,
  projectSchedules,
  scheduleTaskDependencies,
  projectEmailDistributionLists,
  scheduleOfValues,
  sovLineItems,
  orgCostCodes,
} from "@shared/schema";

export interface TemplateTaskSnapshot {
  refId: string;
  parentRefId: string | null;
  name: string;
  description: string | null;
  wbsCode: string | null;
  outlineLevel: number;
  durationDays: number | null;
  isMilestone: boolean;
  sortOrder: number;
  tradeType: string | null;
  /** Days from project start (computed from baseline / planned dates). */
  startOffsetDays: number | null;
  endOffsetDays: number | null;
  costCodeId: string | null;
}

export interface TemplateDependencySnapshot {
  predecessorRefId: string;
  successorRefId: string;
  dependencyType: string;
  lagDays: number;
}

export interface TemplateDistributionListSnapshot {
  name: string;
  contactEmails: string[];
  extraEmails: string[];
}

export interface TemplateSovLineSnapshot {
  itemNumber: string | null;
  description: string;
  costCode: string | null;
  scheduledValue: string | null;
  sortOrder: number;
}

export interface TemplateSovSnapshot {
  name: string;
  lineItems: TemplateSovLineSnapshot[];
}

export interface TemplateCostCodeSnapshot {
  code: string;
  description: string;
  division: string;
}

export interface TemplateFolderSnapshot {
  name: string;
  children?: TemplateFolderSnapshot[];
}

export interface ProjectTemplateSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  source: { projectId: string | null; projectCode: string | null };
  /** Default options used by the new-project wizard when instantiating. */
  defaults: {
    payrollFormVariant: string | null;
    autoChangeOrderEnabled: boolean | null;
    geofenceEnforcement: string | null;
  };
  tasks: TemplateTaskSnapshot[];
  dependencies: TemplateDependencySnapshot[];
  documentFolders: TemplateFolderSnapshot[];
  distributionLists: TemplateDistributionListSnapshot[];
  customFieldDefaults: Record<string, unknown>;
  costCodes: TemplateCostCodeSnapshot[];
  scheduleOfValues: TemplateSovSnapshot | null;
  rfiCategories: string[];
  submittalCategories: string[];
}

const DEFAULT_DOC_FOLDERS: TemplateFolderSnapshot[] = [
  { name: "Contracts" },
  { name: "Drawings" },
  { name: "Permits" },
  { name: "Submittals" },
  { name: "RFIs" },
  { name: "Daily Reports" },
  { name: "Photos" },
  { name: "Closeout" },
];

const DEFAULT_RFI_CATEGORIES = [
  "Architectural",
  "Structural",
  "MEP",
  "Civil",
  "Specifications",
  "Schedule",
];

const DEFAULT_SUBMITTAL_CATEGORIES = [
  "Product Data",
  "Shop Drawings",
  "Samples",
  "Mock-ups",
  "Test Reports",
  "Closeout",
];

function dateDiffDays(a: Date | string | null, b: Date | string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((da - db) / (1000 * 60 * 60 * 24));
}

export async function captureProjectTemplate(projectId: string): Promise<ProjectTemplateSnapshot> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    throw new Error("Project not found");
  }

  const [activeSchedule] = await db
    .select()
    .from(projectSchedules)
    .where(and(eq(projectSchedules.projectId, projectId), eq(projectSchedules.isActive, true)))
    .orderBy(desc(projectSchedules.createdAt))
    .limit(1);

  const taskRows = activeSchedule
    ? await db
        .select()
        .from(projectScheduleTasks)
        .where(eq(projectScheduleTasks.scheduleId, activeSchedule.id))
    : [];

  const depRows = activeSchedule
    ? await db
        .select()
        .from(scheduleTaskDependencies)
        .where(eq(scheduleTaskDependencies.scheduleId, activeSchedule.id))
    : [];

  // Anchor offsets to the earliest planned start so dates rebase cleanly on
  // instantiation regardless of when the source project actually started.
  const anchor = (() => {
    const dates = taskRows
      .map((t) => t.plannedStartDate || t.baselineStartDate)
      .filter(Boolean) as Array<string | Date>;
    if (dates.length === 0) return null;
    return new Date(dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b)[0]);
  })();

  const idToRef = new Map<string, string>();
  taskRows.forEach((t, i) => idToRef.set(t.id, `task_${i + 1}`));

  const tasks: TemplateTaskSnapshot[] = taskRows.map((t) => ({
    refId: idToRef.get(t.id)!,
    parentRefId: t.parentTaskId ? idToRef.get(t.parentTaskId) ?? null : null,
    name: t.name,
    description: t.description ?? null,
    wbsCode: t.wbsCode ?? null,
    outlineLevel: t.outlineLevel ?? 0,
    durationDays: t.durationDays ?? null,
    isMilestone: !!t.isMilestone,
    sortOrder: t.sortOrder ?? 0,
    tradeType: (t.tradeType as string | null) ?? null,
    startOffsetDays: anchor ? dateDiffDays(t.plannedStartDate || t.baselineStartDate, anchor) : null,
    endOffsetDays: anchor ? dateDiffDays(t.plannedEndDate || t.baselineEndDate, anchor) : null,
    costCodeId: t.costCodeId ?? null,
  }));

  const dependencies: TemplateDependencySnapshot[] = depRows
    .map((d) => {
      const pred = idToRef.get(d.predecessorTaskId);
      const succ = idToRef.get(d.successorTaskId);
      if (!pred || !succ) return null;
      return {
        predecessorRefId: pred,
        successorRefId: succ,
        dependencyType: (d.dependencyType as string) ?? "FS",
        lagDays: d.lagDays ?? 0,
      };
    })
    .filter((d): d is TemplateDependencySnapshot => d !== null);

  const distLists = await db
    .select()
    .from(projectEmailDistributionLists)
    .where(eq(projectEmailDistributionLists.projectId, projectId));

  const distributionLists: TemplateDistributionListSnapshot[] = distLists.map((l) => ({
    name: l.name,
    contactEmails: l.contactEmails ?? [],
    extraEmails: l.extraEmails ?? [],
  }));

  const [sov] = await db
    .select()
    .from(scheduleOfValues)
    .where(eq(scheduleOfValues.projectId, projectId))
    .limit(1);

  let scheduleOfValuesSnap: TemplateSovSnapshot | null = null;
  if (sov) {
    const lines = await db.select().from(sovLineItems).where(eq(sovLineItems.sovId, sov.id));
    scheduleOfValuesSnap = {
      name: sov.title ?? "Schedule of Values",
      lineItems: lines.map((l, i) => ({
        itemNumber: l.itemCode ?? null,
        description: l.description ?? "",
        costCode: l.category ?? null,
        scheduledValue: l.scheduledValue ? String(l.scheduledValue) : null,
        sortOrder: l.lineNumber ?? i,
      })),
    };
  }

  let costCodes: TemplateCostCodeSnapshot[] = [];
  if (project.gcOrganizationId) {
    const codes = await db
      .select()
      .from(orgCostCodes)
      .where(eq(orgCostCodes.organizationId, project.gcOrganizationId));
    costCodes = codes
      .filter((c) => c.isActive)
      .map((c) => ({ code: c.code, description: c.description, division: c.division }));
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: { projectId: project.id, projectCode: project.code },
    defaults: {
      payrollFormVariant: (project.payrollFormVariant as string | null) ?? null,
      autoChangeOrderEnabled: project.autoChangeOrderEnabled ?? null,
      geofenceEnforcement: (project.geofenceEnforcement as string | null) ?? null,
    },
    tasks,
    dependencies,
    documentFolders: DEFAULT_DOC_FOLDERS,
    distributionLists,
    customFieldDefaults: {},
    costCodes,
    scheduleOfValues: scheduleOfValuesSnap,
    rfiCategories: DEFAULT_RFI_CATEGORIES,
    submittalCategories: DEFAULT_SUBMITTAL_CATEGORIES,
  };
}
