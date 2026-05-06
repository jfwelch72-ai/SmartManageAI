import { logWarn } from "./utils/logger";
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
import {
  payrollFormVariantValues,
  tradeTypeEnum,
  type PayrollFormVariant,
} from "@shared/schema/enums";
import {
  normalizeTradeType,
  resolveBaseTradeType,
} from "@shared/tradeTypeUtils";
import type { ProjectTemplateSnapshot } from "./projectTemplateCapture";

type DependencyType = "FS" | "SS" | "FF" | "SF";

type DbTradeType = (typeof tradeTypeEnum.enumValues)[number];

const DB_TRADE_TYPE_SET = new Set<string>(tradeTypeEnum.enumValues as readonly string[]);

function isDbTradeType(value: string): value is DbTradeType {
  return DB_TRADE_TYPE_SET.has(value);
}

/**
 * Legacy TS-only trade buckets that exist in `VALID_TRADE_TYPES` (for older
 * library/UI screens) but are NOT members of the `tradeTypeEnum` DB enum.
 * `resolveBaseTradeType` cannot rescue them because its fallback map points
 * each to itself. Map the unambiguous ones onto their closest DB-enum
 * equivalent so a snapshot containing e.g. "FRAMING" still preserves the
 * author's intent instead of being dropped to null.
 */
const LEGACY_TRADE_TO_DB_ENUM: Partial<Record<string, DbTradeType>> = {
  FRAMING: "CARPENTRY",
  WINDOWS_DOORS: "GLAZING",
  FENCING: "FENCING_AND_GATES",
};

/**
 * Task #2120 — template snapshots store `tradeType` as a free-form string and
 * the destination column (`projectScheduleTasks.tradeType`) is the strict
 * `tradeTypeEnum`. Casting the snapshot value through the enum type without
 * validation lets a stale or made-up trade name (e.g. "EXCAVATION", which is
 * an alias rather than an enum value) reach the DB and fail with an opaque
 * error — or silently store a value that never round-trips. This helper:
 *   1. Returns null for empty input.
 *   2. Returns the value verbatim if it is already a valid `tradeTypeEnum`
 *      member.
 *   3. Falls back to `normalizeTradeType` to remap aliases / casing /
 *      heavy-civil legacy names. The shared normaliser may return a
 *      legacy TS-only bucket (FRAMING, WINDOWS_DOORS, SIDING, TILE,
 *      CABINETRY, COUNTERTOPS, FENCING, DECKING) that is not in the DB
 *      enum. For those we first consult `LEGACY_TRADE_TO_DB_ENUM` and
 *      then `resolveBaseTradeType`; the latter is a best-effort lookup
 *      and may itself return a non-enum value, so we re-check before
 *      writing.
 *   4. If we still cannot land on a meaningful enum value (anything other
 *      than the catch-all "OTHER"), we log a clear warning and return null
 *      so the import proceeds without polluting the column.
 */
function resolveSnapshotTradeType(raw: string | null | undefined): DbTradeType | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (isDbTradeType(trimmed)) {
    return trimmed;
  }

  const normalized = normalizeTradeType(trimmed);
  if (normalized) {
    let dbValue: string;
    if (isDbTradeType(normalized)) {
      dbValue = normalized;
    } else if (LEGACY_TRADE_TO_DB_ENUM[normalized]) {
      dbValue = LEGACY_TRADE_TO_DB_ENUM[normalized] as string;
    } else {
      dbValue = resolveBaseTradeType(normalized);
    }
    if (isDbTradeType(dbValue) && dbValue !== "OTHER") {
      logWarn(
        `[projectTemplateInstantiate] Remapped snapshot tradeType "${trimmed}" → "${dbValue}"`,
      );
      return dbValue;
    }
  }

  logWarn(
    `[projectTemplateInstantiate] Unrecognised snapshot tradeType "${trimmed}", storing null`,
  );
  return null;
}

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
  /** Per-snapshot-task overrides applied during seeding. Currently supports
   * renaming and changing the duration; the end offset is recomputed from
   * the duration when provided. */
  taskOverrides?: Array<{
    refId: string;
    name?: string;
    durationDays?: number | null;
  }>;
  /** Brand-new tasks to append under an existing snapshot task (or at the
   * top level when parentRefId is null). They inherit the parent's start
   * offset and use the supplied duration. */
  addedTasks?: Array<{
    tempId: string;
    parentRefId: string | null;
    name: string;
    durationDays?: number | null;
  }>;
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

    // Build override map for quick lookup during seeding.
    const overrideByRefId = new Map<string, { name?: string; durationDays?: number | null }>();
    for (const o of opts.taskOverrides ?? []) {
      if (excludedRefIds.has(o.refId)) continue;
      overrideByRefId.set(o.refId, { name: o.name, durationDays: o.durationDays });
    }

    // First insert tasks without parent links so we can map refIds → ids,
    // then a second pass updates parentTaskId.
    const refIdToTaskId = new Map<string, string>();
    for (const t of remainingTasks) {
      const override = overrideByRefId.get(t.refId);
      const finalDuration =
        override && override.durationDays !== undefined ? override.durationDays : t.durationDays ?? null;
      const finalEndOffset =
        override && override.durationDays !== undefined && t.startOffsetDays !== null && finalDuration !== null
          ? t.startOffsetDays + finalDuration
          : t.endOffsetDays;
      const [row] = await db
        .insert(projectScheduleTasks)
        .values({
          scheduleId: schedule.id,
          name: override?.name?.trim() || t.name,
          description: t.description,
          tradeType: resolveSnapshotTradeType(t.tradeType),
          plannedStartDate: addDays(startDate, t.startOffsetDays),
          plannedEndDate: addDays(startDate, finalEndOffset),
          durationDays: finalDuration,
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

    // Append user-added tasks. They inherit the parent's start offset and
    // use the supplied duration. Tasks whose parent was excluded (or is
    // missing entirely) are skipped to avoid orphans.
    const taskByRefId = new Map<string, ProjectTemplateSnapshot["tasks"][number]>();
    for (const t of opts.snapshot.tasks) taskByRefId.set(t.refId, t);
    let appendedSortOrder = remainingTasks.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0) + 1;
    for (const added of opts.addedTasks ?? []) {
      const name = added.name.trim();
      if (!name) continue;
      let parentTaskId: string | null = null;
      let outlineLevel = 0;
      let startOffset: number | null = 0;
      if (added.parentRefId) {
        if (excludedRefIds.has(added.parentRefId)) continue;
        parentTaskId = refIdToTaskId.get(added.parentRefId) ?? null;
        if (!parentTaskId) continue;
        const parent = taskByRefId.get(added.parentRefId);
        outlineLevel = (parent?.outlineLevel ?? 0) + 1;
        startOffset = parent?.startOffsetDays ?? 0;
      }
      const duration = added.durationDays ?? null;
      const endOffset =
        startOffset !== null && duration !== null ? startOffset + duration : startOffset;
      const [row] = await db
        .insert(projectScheduleTasks)
        .values({
          scheduleId: schedule.id,
          name,
          description: null,
          tradeType: null,
          plannedStartDate: addDays(startDate, startOffset),
          plannedEndDate: addDays(startDate, endOffset),
          durationDays: duration,
          isMilestone: false,
          sortOrder: appendedSortOrder++,
          wbsCode: null,
          outlineLevel,
          parentTaskId,
        })
        .returning();
      void row;
      taskCount++;
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
