import { db } from "../db";
import { approvalRequests } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { notifyApprovers } from "./approvalNotificationService";

export type ApprovalEntityType = "CHANGE_ORDER" | "SOV_PAY_APP" | "TIME_APPROVAL" | "VENDOR_BILL" | "ESIGN_SEND" | "QBO_EXPORT" | "CRM_QUOTE" | "CRM_OPPORTUNITY";

export async function createApprovalRequest(
  orgId: string,
  entityType: ApprovalEntityType,
  entityId: string,
  requestedByUserId: string,
  notes?: string
) {
  const [request] = await db.insert(approvalRequests).values({
    organizationId: orgId,
    entityType: entityType as any,
    entityId,
    requestedByUserId,
    status: "pending",
    notes: notes || null,
  }).returning();

  logInfo("Approval request created", { requestId: request.id, orgId, entityType, entityId });

  const entityLabel = entityType.replace(/_/g, " ");
  await notifyApprovers(orgId, requestedByUserId, {
    type: "APPROVAL_REQUEST_NEW",
    title: "New Approval Request",
    message: `A ${entityLabel} requires your approval`,
    relatedEntityId: entityId,
    relatedEntityType: entityType,
  });

  return request;
}

async function syncDownstreamAfterDecision(
  request: { entityType: string; entityId: string; organizationId: string },
  decision: "approved" | "rejected"
): Promise<void> {
  try {
    const { crmQuotes, crmOpportunities } = await import("@shared/schema");
    if (request.entityType === "CRM_QUOTE") {
      await db.update(crmQuotes).set({
        approvalStatus: decision === "approved" ? "APPROVED" : "REJECTED",
        updatedAt: new Date(),
      } as any).where(eq(crmQuotes.id, request.entityId));
    } else if (request.entityType === "CRM_OPPORTUNITY") {
      if (decision === "approved") {
        await db.update(crmOpportunities).set({
          stage: "WON" as any,
          wonAt: new Date(),
          updatedAt: new Date(),
        } as any).where(eq(crmOpportunities.id, request.entityId));
      }
    }
  } catch (e) {
    logError("Approval downstream sync failed", { entityType: request.entityType, entityId: request.entityId }, e as Error);
  }
}

export async function approveRequest(
  requestId: string,
  orgId: string,
  approverUserId: string,
  approverRole: string,
  notes?: string
) {
  const [updated] = await db.update(approvalRequests)
    .set({
      status: "approved" as any,
      approverUserId,
      approverRole,
      notes: notes || undefined,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(approvalRequests.id, requestId),
      eq(approvalRequests.organizationId, orgId),
      eq(approvalRequests.status, "pending")
    ))
    .returning();

  if (updated) {
    logInfo("Approval request approved", { requestId, orgId, approverUserId });
    await syncDownstreamAfterDecision(updated, "approved");
  }
  return updated || null;
}

export async function rejectRequest(
  requestId: string,
  orgId: string,
  approverUserId: string,
  approverRole: string,
  notes?: string
) {
  const [updated] = await db.update(approvalRequests)
    .set({
      status: "rejected" as any,
      approverUserId,
      approverRole,
      notes: notes || undefined,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(approvalRequests.id, requestId),
      eq(approvalRequests.organizationId, orgId),
      eq(approvalRequests.status, "pending")
    ))
    .returning();

  if (updated) {
    logInfo("Approval request rejected", { requestId, orgId, approverUserId });
    await syncDownstreamAfterDecision(updated, "rejected");
  }
  return updated || null;
}

export async function getApprovalById(requestId: string, orgId: string) {
  const [request] = await db.select().from(approvalRequests)
    .where(and(
      eq(approvalRequests.id, requestId),
      eq(approvalRequests.organizationId, orgId)
    ))
    .limit(1);
  return request || null;
}

export async function getApprovalStatus(orgId: string, entityType: string, entityId: string) {
  const [request] = await db.select().from(approvalRequests)
    .where(and(
      eq(approvalRequests.organizationId, orgId),
      eq(approvalRequests.entityType, entityType as any),
      eq(approvalRequests.entityId, entityId)
    ))
    .orderBy(sql`${approvalRequests.createdAt} DESC`)
    .limit(1);
  return request || null;
}

export async function getPendingApprovals(orgId: string, entityType?: string) {
  const conditions = [
    eq(approvalRequests.organizationId, orgId),
    eq(approvalRequests.status, "pending"),
  ];
  if (entityType) {
    conditions.push(eq(approvalRequests.entityType, entityType as any));
  }
  return db.select().from(approvalRequests).where(and(...conditions)).orderBy(sql`${approvalRequests.createdAt} DESC`);
}

export async function getApprovalStats(orgId: string) {
  const result = await db.select({
    total: sql<number>`count(*)`,
    pending: sql<number>`count(*) filter (where ${approvalRequests.status} = 'pending')`,
    approved: sql<number>`count(*) filter (where ${approvalRequests.status} = 'approved')`,
    rejected: sql<number>`count(*) filter (where ${approvalRequests.status} = 'rejected')`,
  }).from(approvalRequests)
    .where(eq(approvalRequests.organizationId, orgId));
  return result[0] || { total: 0, pending: 0, approved: 0, rejected: 0 };
}

export function isApprovalRequired(_orgId: string, _entityType: string, featureFlagEnabled: boolean): boolean {
  return featureFlagEnabled;
}
