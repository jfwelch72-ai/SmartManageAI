import { db } from "../db";
import { approvalRequests } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { notifyApprovers } from "./approvalNotificationService";

export type ApprovalEntityType = "CHANGE_ORDER" | "SOV_PAY_APP" | "TIME_APPROVAL" | "VENDOR_BILL" | "ESIGN_SEND" | "QBO_EXPORT";

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
  notifyApprovers(orgId, requestedByUserId, {
    type: "APPROVAL_REQUEST_NEW",
    title: "New Approval Request",
    message: `A ${entityLabel} requires your approval`,
    relatedEntityId: entityId,
    relatedEntityType: entityType,
  });

  return request;
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
