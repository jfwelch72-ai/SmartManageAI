import { logError } from "./utils/logger";
import { db } from "./db";
import { changeOrders, users, notifications, projects, changeOrderRevisions } from "@shared/schema";
import { eq, desc, max, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { type AuthRequest } from "./auth";
import { insertNotifications } from "./services/notificationService";
import { getOrgIdForFilter } from "./orgFilter";
import { notifyApprovers, notifySubmitter } from "./services/approvalNotificationService";
  

// Valid state transitions for change orders
// Full PCO workflow: PCO → PRICING_REVIEW → SUBMITTED → APPROVED/REJECTED
const VALID_TRANSITIONS: Record<string, string[]> = {
  // New PCO workflow
  PCO: ["PRICING_REVIEW", "SUBMITTED"],             // Issue priced, sent for internal review or directly submitted
  PRICING_REVIEW: ["SUBMITTED", "PCO"],           // Approved to client, or returned for revision
  SUBMITTED: ["APPROVED", "REJECTED", "PCO"],      // Client approves, rejects, or returned to draft
  APPROVED: ["VOIDED"],                           // Re-scope path
  REJECTED: ["PCO"],                              // Returned to re-price
  VOIDED: [],                                     // Terminal state
  // Legacy backward-compatibility entries
  DRAFT: ["SUBMITTED"],
  PENDING_APPROVAL: ["SUBMITTED", "DRAFT"],
};

/**
 * Validates if a state transition is allowed
 */
function isValidTransition(fromStatus: string, toStatus: string): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

/**
 * Gets a change order by ID with validation and project org info
 */
async function getChangeOrderById(id: string) {
  const [result] = await db
    .select({
      order: changeOrders,
      project: {
        id: projects.id,
        gcOrganizationId: projects.gcOrganizationId,
      },
    })
    .from(changeOrders)
    .leftJoin(projects, eq(changeOrders.projectId, projects.id))
    .where(eq(changeOrders.id, id))
    .limit(1);
  
  return result;
}

/**
 * Checks if user has organization access to a change order
 */
function checkOrgAccess(
  req: AuthRequest,
  projectOrgId: string | null | undefined
): { allowed: boolean; mustDenyAccess: boolean } {
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  
  if (mustDenyAccess) {
    return { allowed: false, mustDenyAccess: true };
  }
  
  if (shouldFilter && orgId && projectOrgId !== orgId) {
    return { allowed: false, mustDenyAccess: false };
  }
  
  return { allowed: true, mustDenyAccess: false };
}

/**
 * Notifies relevant users about a change order status change
 */
async function notifyStatusChange(
  order: any,
  newStatus: string,
  message: string,
  notifyRequestedBy: boolean = true,
  orgId?: string
) {
  try {
    const statusTypeMap: Record<string, string> = {
      SUBMITTED: "CHANGE_ORDER_PENDING",
      APPROVED: "CHANGE_ORDER_APPROVED",
      REJECTED: "CHANGE_ORDER_REJECTED",
      DRAFT: "GENERAL",
    };

    const notificationType = statusTypeMap[newStatus] || "GENERAL";

    if (newStatus === "SUBMITTED" && orgId) {
      await notifyApprovers(
        orgId,
        order.requestedById,
        {
          type: "CHANGE_ORDER_PENDING",
          title: "Change Order Submitted",
          message: `Change order ${order.changeOrderNumber} has been submitted to client`,
          relatedEntityId: order.id,
          relatedEntityType: "changeOrder",
        }
      );
    }

    if (notifyRequestedBy && order.requestedById && newStatus !== "SUBMITTED") {
      await notifySubmitter(order.requestedById, {
        type: notificationType,
        title: `Change Order ${newStatus.charAt(0) + newStatus.slice(1).toLowerCase()}`,
        message,
        relatedEntityId: order.id,
        relatedEntityType: "changeOrder",
      }, orgId);
    }
  } catch (error) {
    logError("Failed to create change order notifications:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Creates a revision record for a change order status change
 */
async function createRevision(
  changeOrderId: string,
  previousStatus: string,
  newStatus: string,
  revisedById: string,
  description?: string,
  amount?: string | null,
  changedFields?: Record<string, any>
) {
  const [maxRev] = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(${changeOrderRevisions.revisionNumber}), 0)` })
    .from(changeOrderRevisions)
    .where(eq(changeOrderRevisions.changeOrderId, changeOrderId));

  const nextRevision = (maxRev?.maxNum || 0) + 1;

  await db.insert(changeOrderRevisions).values({
    changeOrderId,
    revisionNumber: nextRevision,
    previousStatus,
    newStatus,
    amount: amount || null,
    description: description || `Status changed from ${previousStatus} to ${newStatus}`,
    changedFields: changedFields ? JSON.stringify(changedFields) : null,
    revisedById,
  });
}


export { VALID_TRANSITIONS, isValidTransition, getChangeOrderById, checkOrgAccess, notifyStatusChange, createRevision };
