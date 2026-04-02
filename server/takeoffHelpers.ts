import { db } from "./db";
import { logWarn } from "./utils/logger";
import { takeoffSheets, projects, bids, takeoffMeasurementGroups } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";

export function safeParsePoints(raw: any): any[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    logWarn("Non-critical operation failed");
    return null;
  }
}

export async function verifySheetAccess(sheetId: string, user: { id: string; organizationId: string | null; role: string }): Promise<{ allowed: boolean; sheet: any | null; reason?: string }> {
  const [sheet] = await db
    .select({
      id: takeoffSheets.id,
      projectId: takeoffSheets.projectId,
      bidId: takeoffSheets.bidId,
    })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, sheetId))
    .limit(1);

  if (!sheet) return { allowed: false, sheet: null, reason: "Sheet not found" };

  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (sheet.projectId) {
    const projectConditions = isSuperAdmin
      ? [eq(projects.id, sheet.projectId)]
      : [eq(projects.id, sheet.projectId), eq(projects.gcOrganizationId, user.organizationId)];
    const [project] = await db
      .select({ id: projects.id, gcOrganizationId: projects.gcOrganizationId })
      .from(projects)
      .where(and(...projectConditions))
      .limit(1);
    if (!project) return { allowed: false, sheet, reason: "Sheet not found" };

    if (!isSuperAdmin && user.role !== "ADMIN" && user.role !== "MANAGER" && user.role !== "ESTIMATOR") {
      const { crewProjectAssignments, crewMembers } = await import("@shared/schema");
      const [assignment] = await db
        .select({ id: crewProjectAssignments.id })
        .from(crewProjectAssignments)
        .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
        .where(and(eq(crewProjectAssignments.projectId, sheet.projectId), eq(crewMembers.userId, user.id)))
        .limit(1);
      if (!assignment) return { allowed: false, sheet, reason: "Access denied" };
    }
    return { allowed: true, sheet };
  }

  if (sheet.bidId) {
    const bidConditions = isSuperAdmin
      ? [eq(bids.id, sheet.bidId)]
      : [eq(bids.id, sheet.bidId), eq(bids.gcOrganizationId, user.organizationId)];
    const [bid] = await db
      .select({ id: bids.id, gcOrganizationId: bids.gcOrganizationId })
      .from(bids)
      .where(and(...bidConditions))
      .limit(1);
    if (!bid) return { allowed: false, sheet, reason: "Sheet not found" };
    return { allowed: true, sheet };
  }

  return { allowed: false, sheet, reason: "Sheet has no parent" };
}

export async function verifyGroupAccess(groupId: string, user: { id: string; organizationId: string | null; role: string }): Promise<{ allowed: boolean; group: any | null; reason?: string }> {
  const [group] = await db.select().from(takeoffMeasurementGroups).where(eq(takeoffMeasurementGroups.id, groupId)).limit(1);
  if (!group) return { allowed: false, group: null, reason: "Group not found" };
  if (!group.sheetId) return { allowed: false, group, reason: "Group has no sheet" };
  const sheetAccess = await verifySheetAccess(group.sheetId, user);
  return { allowed: sheetAccess.allowed, group, reason: sheetAccess.reason };
}

export async function getActiveDraftVersionId(sheetId: string): Promise<string | null> {
  const { takeoffVersions } = await import("@shared/schema");
  const [draft] = await db.select({ id: takeoffVersions.id })
    .from(takeoffVersions)
    .where(and(eq(takeoffVersions.sheetId, sheetId), eq(takeoffVersions.status, "DRAFT")))
    .limit(1);
  return draft?.id || null;
}

export async function getDefaultVersionId(sheetId: string): Promise<string | null> {
  const { takeoffVersions } = await import("@shared/schema");
  const [draft] = await db.select({ id: takeoffVersions.id })
    .from(takeoffVersions)
    .where(and(eq(takeoffVersions.sheetId, sheetId), eq(takeoffVersions.status, "DRAFT")))
    .limit(1);
  if (draft) return draft.id;
  const [latest] = await db.select({ id: takeoffVersions.id })
    .from(takeoffVersions)
    .where(eq(takeoffVersions.sheetId, sheetId))
    .orderBy(desc(takeoffVersions.versionNumber))
    .limit(1);
  return latest?.id || null;
}

export async function hasAnyVersions(sheetId: string): Promise<boolean> {
  const { takeoffVersions } = await import("@shared/schema");
  const [v] = await db.select({ id: takeoffVersions.id })
    .from(takeoffVersions)
    .where(eq(takeoffVersions.sheetId, sheetId))
    .limit(1);
  return !!v;
}

export async function isMeasurementLocked(measurementId: string): Promise<boolean> {
  const { takeoffMeasurements, takeoffVersions } = await import("@shared/schema");
  const [m] = await db.select({ takeoffVersionId: takeoffMeasurements.takeoffVersionId })
    .from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, measurementId))
    .limit(1);
  if (!m?.takeoffVersionId) return false;
  const [v] = await db.select({ status: takeoffVersions.status })
    .from(takeoffVersions)
    .where(eq(takeoffVersions.id, m.takeoffVersionId))
    .limit(1);
  return v?.status === "LOCKED";
}
