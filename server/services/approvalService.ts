import { db } from "../db";
import { approvalRequests } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { logInfo, logError } from "../utils/logger";
import { notifyApprovers } from "./approvalNotificationService";

export type ApprovalEntityType = "CHANGE_ORDER" | "SOV_PAY_APP" | "TIME_APPROVAL" | "VENDOR_BILL" | "ESIGN_SEND" | "QBO_EXPORT" | "CRM_QUOTE" | "CRM_OPPORTUNITY" | "INVENTORY_ADJUSTMENT";

export async function createApprovalRequest(
  orgId: string,
  entityType: ApprovalEntityType,
  entityId: string,
  requestedByUserId: string,
  notes?: string,
  approverRoles?: readonly string[]
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
  }, approverRoles);

  return request;
}

// Downstream sync is called inside the same DB transaction as the approval-
// status update so that a downstream failure (e.g. insufficient stock) rolls
// back the approval stamp atomically — no orphaned "approved" records.
// The `client` parameter receives the transaction object from the caller;
// errors are re-thrown so the outer transaction can roll back.
async function syncDownstreamAfterDecision(
  request: { entityType: string; entityId: string; organizationId: string },
  decision: "approved" | "rejected",
  client: typeof db
): Promise<void> {
  const { crmQuotes, crmOpportunities } = await import("@shared/schema");
  if (request.entityType === "CRM_QUOTE") {
    await client.update(crmQuotes).set({
      approvalStatus: decision === "approved" ? "APPROVED" : "REJECTED",
      updatedAt: new Date(),
    } as any).where(eq(crmQuotes.id, request.entityId));
  } else if (request.entityType === "CRM_OPPORTUNITY") {
    if (decision === "approved") {
      await client.update(crmOpportunities).set({
        stage: "WON" as any,
        wonAt: new Date(),
        updatedAt: new Date(),
      } as any).where(eq(crmOpportunities.id, request.entityId));
    }
  } else if (request.entityType === "INVENTORY_ADJUSTMENT") {
    // entityId is the pending inventoryTransaction row.
    const { inventoryTransactions, inventoryStockLevels } = await import("@shared/schema");
    const [txn] = await client
      .select()
      .from(inventoryTransactions)
      .where(and(eq(inventoryTransactions.id, request.entityId), eq(inventoryTransactions.organizationId, request.organizationId)))
      .limit(1);

    if (!txn) {
      // Re-throw so the outer transaction rolls back the approval stamp.
      throw new Error(`INVENTORY_ADJUSTMENT downstream sync: transaction not found (entityId=${request.entityId})`);
    }

    if (decision === "approved") {
      // Post the stock change and mark the transaction APPROVED inside a
      // nested savepoint (client.transaction inside an outer transaction uses
      // PostgreSQL SAVEPOINTs, ensuring full atomicity with the approval stamp).
      const qty = Number(txn.quantity);
      await client.transaction(async (tx) => {
        const { sql: dsql } = await import("drizzle-orm");
        const [existing] = await tx
          .select({ id: inventoryStockLevels.id, onHand: inventoryStockLevels.onHand })
          .from(inventoryStockLevels)
          .where(and(
            eq(inventoryStockLevels.organizationId, request.organizationId),
            eq(inventoryStockLevels.materialId, txn.materialId!),
            eq(inventoryStockLevels.locationId, txn.locationId!),
          ))
          .limit(1);

        if (existing) {
          if (Number(existing.onHand) + qty < 0) {
            throw new Error(`Insufficient stock after approval for material ${txn.materialId}`);
          }
          await tx.update(inventoryStockLevels)
            .set({ onHand: dsql`${inventoryStockLevels.onHand} + ${String(qty)}` })
            .where(eq(inventoryStockLevels.id, existing.id));
        } else {
          if (qty < 0) throw new Error(`Insufficient stock after approval for material ${txn.materialId}`);
          await tx.insert(inventoryStockLevels).values({
            organizationId: request.organizationId,
            materialId: txn.materialId!,
            locationId: txn.locationId!,
            onHand: String(qty),
          });
        }
        await tx.update(inventoryTransactions)
          .set({ approvalStatus: "APPROVED" })
          .where(eq(inventoryTransactions.id, txn.id));
      });
      logInfo("INVENTORY_ADJUSTMENT approved — stock updated", { transactionId: txn.id, qty });
    } else {
      // Rejected: mark the pending transaction without moving stock.
      await client.update(inventoryTransactions)
        .set({ approvalStatus: "REJECTED" })
        .where(eq(inventoryTransactions.id, txn.id));
      logInfo("INVENTORY_ADJUSTMENT rejected — no stock movement", { transactionId: txn.id });
    }
  }
}

export async function approveRequest(
  requestId: string,
  orgId: string,
  approverUserId: string,
  approverRole: string,
  notes?: string
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(approvalRequests)
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
      // syncDownstreamAfterDecision errors propagate up and roll back the
      // approval stamp via the enclosing transaction.
      await syncDownstreamAfterDecision(updated, "approved", tx as unknown as typeof db);
    }
    return updated || null;
  }).catch((e) => {
    logError("approveRequest transaction failed — approval stamp rolled back", { requestId, orgId }, e as Error);
    throw e;
  });
}

export async function rejectRequest(
  requestId: string,
  orgId: string,
  approverUserId: string,
  approverRole: string,
  notes?: string
) {
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(approvalRequests)
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
      await syncDownstreamAfterDecision(updated, "rejected", tx as unknown as typeof db);
    }
    return updated || null;
  }).catch((e) => {
    logError("rejectRequest transaction failed — rejection stamp rolled back", { requestId, orgId }, e as Error);
    throw e;
  });
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
