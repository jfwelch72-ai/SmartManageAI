import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import {
  projects,
  projectSchedules,
  projectScheduleTasks,
  scheduleTaskDependencies,
  projectEmailDistributionLists,
  scheduleOfValues,
  sovLineItems,
  insertProjectSchema,
} from "@shared/schema";
import { payrollFormVariantValues, type PayrollFormVariant } from "@shared/schema/enums";
import type { ProjectTemplateSnapshot } from "./projectTemplateCapture";

type TradeType =
  | "GENERAL_CONTRACTOR" | "ELECTRICAL" | "PLUMBING" | "HVAC" | "CARPENTRY"
  | "ROOFING" | "MASONRY" | "PAINTING" | "FLOORING" | "DRYWALL"
  | "CONCRETE" | "EXCAVATION" | "LANDSCAPING" | "STEEL" | "GLAZING"
  | "INSULATION" | "WATERPROOFING" | "DEMOLITION" | "FENCING" | "PAVING"
  | "OTHER";
type DependencyType = "FS" | "SS" | "FF" | "SF";

interface PgRow { max_code?: string | number | null }

export interface InstantiateOptions {
  template: { id: string; sourceProjectCode: string | null };
  snapshot: ProjectTemplateSnapshot;
  organizationId: string;
  createdByUserId: string;
  projectStartDate: Date;
  /** Project fields the user supplies in the wizard. */
  projectInput: {
    name: string;
    clientName: string;
    description?: string | null;
    locationAddress?: string | null;
    city?: string | null;
    state?: string | null;
    contractAmount?: string | null;
    budget?: string | null;
    gcOrganizationId?: string | null;
    ownerRepOrganizationId?: string | null;
  };
  /** Map of role names → user IDs (PM, Superintendent, Estimator, Safety). */
  roleAssignments?: {
    projectManagerId?: string | null;
    superintendentId?: string | null;
    estimatorId?: string | null;
    safetyOfficerId?: string | null;
  };
  /** Snapshot task refIds the user opted out of in the preview. The seeded
   * project will skip these tasks AND any dependency that touches them. */
  excludedRefIds?: string[];
}

const PROJECT_CODE_START = 1000;
async function getNextProjectCode(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(
      MAX(CAST(code AS INTEGER)),
      ${PROJECT_CODE_START - 1}
    ) AS max_code
    FROM projects
    WHERE code ~ '^[0-9]+$'
  `);
  const row = result.rows[0] as PgRow | undefined;
  const max = Number(row?.max_code) || PROJECT_CODE_START - 1;
  return String(max + 1);
}

function addDays(base: Date, days: number | null | undefined): string | null {
  if (days === null || days === undefined) return null;
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface InstantiateResult {
  projectId: string;
  projectCode: string;
  taskCount: number;
  dependencyCount: number;
  distributionListCount: number;
  sovCreated: boolean;
}

export async function instantiateProjectFromTemplate(opts: InstantiateOptions): Promise<InstantiateResult> {
  const code = await getNextProjectCode();
  const startDate = opts.projectStartDate;

  const projectInsert = insertProjectSchema.parse({
    code,
    name: opts.projectInput.name,
    clientName: opts.projectInput.clientName,
    description: opts.projectInput.description ?? null,
    locationAddress: opts.projectInput.locationAddress ?? null,
    city: opts.projectInput.city ?? null,
    state: opts.projectInput.state ?? null,
    contractAmount: opts.projectInput.contractAmount ?? null,
    budget: opts.projectInput.budget ?? null,
    gcOrganizationId: opts.projectInput.gcOrganizationId ?? opts.organizationId,
    ownerRepOrganizationId: opts.projectInput.ownerRepOrganizationId ?? null,
    status: "PLANNING" as const,
    startDate,
    projectManagerId: opts.roleAssignments?.projectManagerId ?? null,
    superintendentId: opts.roleAssignments?.superintendentId ?? null,
    estimatorId: opts.roleAssignments?.estimatorId ?? null,
    safetyOfficerId: opts.roleAssignments?.safetyOfficerId ?? null,
    payrollFormVariant: (payrollFormVariantValues as readonly string[]).includes(
      opts.snapshot.defaults.payrollFormVariant ?? "",
    )
      ? (opts.snapshot.defaults.payrollFormVariant as PayrollFormVariant)
      : ("WH_347" as PayrollFormVariant),
  });

  const [newProject] = await db.insert(projects).values(projectInsert).returning();

  // Resolve the excluded set: seed it with the caller-provided refIds and
  // then cascade so any descendant of an excluded parent is also excluded
  // (otherwise the child becomes an orphan in the seeded WBS).
  const excludedRefIds = new Set<string>(opts.excludedRefIds ?? []);
  if (excludedRefIds.size > 0) {
    const childrenByParent = new Map<string, string[]>();
    for (const t of opts.snapshot.tasks) {
      if (!t.parentRefId) continue;
      const arr = childrenByParent.get(t.parentRefId) ?? [];
      arr.push(t.refId);
      childrenByParent.set(t.parentRefId, arr);
    }
    const stack = Array.from(excludedRefIds);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const kids = childrenByParent.get(cur);
      if (!kids) continue;
      for (const k of kids) {
        if (!excludedRefIds.has(k)) {
          excludedRefIds.add(k);
          stack.push(k);
        }
      }
    }
  }

  // Create the project schedule and seed the WBS task tree.
  let taskCount = 0;
  let dependencyCount = 0;
  const remainingTasks = opts.snapshot.tasks.filter((t) => !excludedRefIds.has(t.refId));
  if (remainingTasks.length > 0) {
    const [schedule] = await db
      .insert(projectSchedules)
      .values({
        organizationId: opts.organizationId,
        projectId: newProject.id,
        name: "Master Schedule",
        generatedBy: "MANUAL" as const,
        baselineStartDate: startDate.toISOString().slice(0, 10),
        createdByUserId: opts.createdByUserId,
      })
      .returning();

    // First insert tasks without parent links so we can map refIds → ids,
    // then a second pass updates parentTaskId.
    const refIdToTaskId = new Map<string, string>();
    for (const t of remainingTasks) {
      const [row] = await db
        .insert(projectScheduleTasks)
        .values({
          scheduleId: schedule.id,
          name: t.name,
          description: t.description,
          tradeType: (t.tradeType as TradeType | null) ?? null,
          plannedStartDate: addDays(startDate, t.startOffsetDays),
          plannedEndDate: addDays(startDate, t.endOffsetDays),
          durationDays: t.durationDays ?? null,
          isMilestone: t.isMilestone,
          sortOrder: t.sortOrder,
          wbsCode: t.wbsCode,
          outlineLevel: t.outlineLevel,
        })
        .returning();
      refIdToTaskId.set(t.refId, row.id);
      taskCount++;
    }

    for (const t of remainingTasks) {
      if (!t.parentRefId) continue;
      const childId = refIdToTaskId.get(t.refId);
      const parentId = refIdToTaskId.get(t.parentRefId);
      if (!childId || !parentId) continue;
      await db
        .update(projectScheduleTasks)
        .set({ parentTaskId: parentId })
        .where(eq(projectScheduleTasks.id, childId));
    }

    for (const d of opts.snapshot.dependencies) {
      if (excludedRefIds.has(d.predecessorRefId) || excludedRefIds.has(d.successorRefId)) continue;
      const pred = refIdToTaskId.get(d.predecessorRefId);
      const succ = refIdToTaskId.get(d.successorRefId);
      if (!pred || !succ) continue;
      await db.insert(scheduleTaskDependencies).values({
        scheduleId: schedule.id,
        predecessorTaskId: pred,
        successorTaskId: succ,
        dependencyType: (d.dependencyType as DependencyType | undefined) ?? "FS",
        lagDays: d.lagDays ?? 0,
      });
      dependencyCount++;
    }
  }

  // Distribution lists.
  let distributionListCount = 0;
  for (const list of opts.snapshot.distributionLists) {
    try {
      await db.insert(projectEmailDistributionLists).values({
        organizationId: opts.organizationId,
        projectId: newProject.id,
        name: list.name,
        contactEmails: list.contactEmails,
        extraEmails: list.extraEmails,
        createdById: opts.createdByUserId,
      });
      distributionListCount++;
    } catch {
      // Ignore unique conflicts (e.g. duplicate name within the project).
    }
  }

  // Schedule of Values structure.
  let sovCreated = false;
  if (opts.snapshot.scheduleOfValues && opts.snapshot.scheduleOfValues.lineItems.length > 0) {
    const [sov] = await db
      .insert(scheduleOfValues)
      .values({
        organizationId: opts.organizationId,
        projectId: newProject.id,
        sovNumber: "SOV-001",
        title: opts.snapshot.scheduleOfValues.name || "Schedule of Values",
        contractValue: opts.projectInput.contractAmount ?? "0",
        createdById: opts.createdByUserId,
      })
      .returning();

    let lineNumber = 1;
    for (const li of opts.snapshot.scheduleOfValues.lineItems) {
      await db.insert(sovLineItems).values({
        sovId: sov.id,
        lineNumber: li.sortOrder ?? lineNumber,
        itemCode: li.itemNumber,
        description: li.description || "Line item",
        category: li.costCode,
        scheduledValue: li.scheduledValue ?? "0",
      });
      lineNumber++;
    }
    sovCreated = true;
  }

  return {
    projectId: newProject.id,
    projectCode: newProject.code,
    taskCount,
    dependencyCount,
    distributionListCount,
    sovCreated,
  };
}
