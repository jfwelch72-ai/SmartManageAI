import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  aiEstimatorUserAccess,
  bids,
  estimates,
  projects,
  takeoffSheets,
} from "@shared/schema";

export interface AccessRow {
  userId: string;
  enabled: boolean;
  canTrain: boolean;
  enabledAt: Date | null;
  enabledByUserId: string | null;
}

export interface AccessStatus {
  enabled: boolean;
  canTrain: boolean;
  reason: "OK" | "NOT_ENABLED";
}

/**
 * Per-user enablement state for the AI Estimator workspace within an org.
 * Org admins toggle this from the admin page; the per-request gate uses
 * `canUseAiEstimator` (set on the user's permission map) which is updated
 * in lockstep with this row.
 */
export async function listOrgAccess(organizationId: string): Promise<AccessRow[]> {
  const rows = await db
    .select()
    .from(aiEstimatorUserAccess)
    .where(eq(aiEstimatorUserAccess.organizationId, organizationId));
  return rows.map((r) => ({
    userId: r.userId,
    enabled: !!r.enabled,
    canTrain: !!r.canTrain,
    enabledAt: r.enabledAt,
    enabledByUserId: r.enabledByUserId,
  }));
}

export async function getAccessStatus(
  organizationId: string,
  userId: string,
): Promise<AccessStatus> {
  const [row] = await db
    .select()
    .from(aiEstimatorUserAccess)
    .where(
      and(
        eq(aiEstimatorUserAccess.organizationId, organizationId),
        eq(aiEstimatorUserAccess.userId, userId),
      ),
    );
  const enabled = !!row?.enabled;
  return {
    enabled,
    canTrain: !!row?.canTrain,
    reason: enabled ? "OK" : "NOT_ENABLED",
  };
}

export async function setUserAccess(opts: {
  organizationId: string;
  userId: string;
  enabled: boolean;
  canTrain?: boolean;
  changedById: string;
}): Promise<AccessRow> {
  const [existing] = await db
    .select()
    .from(aiEstimatorUserAccess)
    .where(
      and(
        eq(aiEstimatorUserAccess.organizationId, opts.organizationId),
        eq(aiEstimatorUserAccess.userId, opts.userId),
      ),
    );
  if (existing) {
    const [updated] = await db
      .update(aiEstimatorUserAccess)
      .set({
        enabled: opts.enabled,
        canTrain: opts.canTrain ?? existing.canTrain,
        enabledAt: opts.enabled ? new Date() : existing.enabledAt,
        enabledByUserId: opts.changedById,
      })
      .where(eq(aiEstimatorUserAccess.id, existing.id))
      .returning();
    return {
      userId: updated.userId,
      enabled: !!updated.enabled,
      canTrain: !!updated.canTrain,
      enabledAt: updated.enabledAt,
      enabledByUserId: updated.enabledByUserId,
    };
  }
  const [created] = await db
    .insert(aiEstimatorUserAccess)
    .values({
      organizationId: opts.organizationId,
      userId: opts.userId,
      enabled: opts.enabled,
      canTrain: opts.canTrain ?? false,
      enabledAt: opts.enabled ? new Date() : null,
      enabledByUserId: opts.changedById,
    })
    .returning();
  return {
    userId: created.userId,
    enabled: !!created.enabled,
    canTrain: !!created.canTrain,
    enabledAt: created.enabledAt,
    enabledByUserId: created.enabledByUserId,
  };
}

/**
 * Tenant-safety guards. These confirm that a referenced resource belongs to
 * the caller's organization BEFORE any downstream service uses it. Throws
 * when ownership cannot be confirmed so we never leak cross-tenant data.
 */
export class ResourceOwnershipError extends Error {
  constructor(public resource: string) {
    super(`Resource ${resource} not found in this organization`);
    this.name = "ResourceOwnershipError";
  }
}

export async function assertBidInOrg(bidId: string, organizationId: string): Promise<void> {
  const [row] = await db
    .select({
      gcOrganizationId: bids.gcOrganizationId,
      ownerRepOrganizationId: bids.ownerRepOrganizationId,
    })
    .from(bids)
    .where(eq(bids.id, bidId))
    .limit(1);
  if (!row) throw new ResourceOwnershipError(`bid:${bidId}`);
  if (
    row.gcOrganizationId !== organizationId &&
    row.ownerRepOrganizationId !== organizationId
  ) {
    throw new ResourceOwnershipError(`bid:${bidId}`);
  }
}

export async function assertProjectInOrg(projectId: string, organizationId: string): Promise<void> {
  const [row] = await db
    .select({ gcOrganizationId: projects.gcOrganizationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!row) throw new ResourceOwnershipError(`project:${projectId}`);
  if (row.gcOrganizationId !== organizationId) {
    throw new ResourceOwnershipError(`project:${projectId}`);
  }
}

export async function assertEstimateInOrg(estimateId: string, organizationId: string): Promise<void> {
  const [row] = await db
    .select({
      bidId: estimates.bidId,
      projectId: estimates.projectId,
    })
    .from(estimates)
    .where(eq(estimates.id, estimateId))
    .limit(1);
  if (!row) throw new ResourceOwnershipError(`estimate:${estimateId}`);
  if (row.bidId) {
    await assertBidInOrg(row.bidId, organizationId);
    return;
  }
  if (row.projectId) {
    await assertProjectInOrg(row.projectId, organizationId);
    return;
  }
  throw new ResourceOwnershipError(`estimate:${estimateId}`);
}

/**
 * Filter a candidate list of takeoff-sheet ids down to those that belong
 * to the caller's organization (resolved via parent project or bid). Used
 * to prevent IDOR when callers pass sheet ids alongside a bid id.
 */
export async function filterSheetsInOrg(
  sheetIds: string[],
  organizationId: string,
): Promise<string[]> {
  if (sheetIds.length === 0) return [];
  const rows = await db
    .select({
      id: takeoffSheets.id,
      bidId: takeoffSheets.bidId,
      projectId: takeoffSheets.projectId,
    })
    .from(takeoffSheets);
  const candidates = rows.filter((r) => sheetIds.includes(r.id));
  const allowed: string[] = [];
  for (const c of candidates) {
    try {
      if (c.bidId) {
        await assertBidInOrg(c.bidId, organizationId);
        allowed.push(c.id);
        continue;
      }
      if (c.projectId) {
        await assertProjectInOrg(c.projectId, organizationId);
        allowed.push(c.id);
      }
    } catch {
      // skip — not in org
    }
  }
  return allowed;
}
