import { eventBus } from "../eventBus";
import type {
  ChangeOrderSubmittedEvent,
  InspectionCompletedEvent,
  SubcontractorPaymentMadeEvent,
  ProjectStatusChangedEvent,
  DocumentRevisionCreatedEvent,
  TmTicketApprovedEvent,
  PoReceiptRecordedEvent,
  RfiAnsweredEvent,
  SubmittalApprovedEvent,
  SubmittalRejectedEvent,
  AiaPayApplicationSubmittedEvent,
  PurchaseOrderIssuedEvent,
  CloseoutPackageReadyEvent,
  PunchListItemAssignedEvent,
  PaymentReceivedEvent,
  InvoiceGeneratedEvent,
  ProjectMilestoneCompletedEvent,
  PurchaseOrderRevisedEvent,
  DeliveryConfirmationRequestedEvent,
  ScheduleChangedEvent,
} from "../eventTypes";
import { db } from "../../db";
import {
  clientPortalAccess,
  subcontractorPortalTokens,
  purchaseOrders,
  projects,
  users,
} from "@shared/schema";
import { crmContacts } from "@shared/schema/features/crm";
import type { UserRole } from "@shared/schema/enums";
import { eq, and, inArray } from "drizzle-orm";
import { createPortalNotification } from "../../portalNotificationService";
import { logError } from "../../utils/logger";

// ── Recipient lookup helpers ─────────────────────────────────────────────────

async function getActiveClientAccessIdsForProject(
  projectId: string,
): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: clientPortalAccess.id })
      .from(clientPortalAccess)
      .where(
        and(
          eq(clientPortalAccess.projectId, projectId),
          eq(clientPortalAccess.isActive, true),
        ),
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function getAllSubTokenIdsForProject(projectId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: subcontractorPortalTokens.id })
      .from(subcontractorPortalTokens)
      .where(
        and(
          eq(subcontractorPortalTokens.projectId, projectId),
          eq(subcontractorPortalTokens.status, "active"),
        ),
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

async function getSubTokenIdsForCrmOrg(
  projectId: string,
  crmOrganisationId: string,
): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: subcontractorPortalTokens.id })
      .from(subcontractorPortalTokens)
      .where(
        and(
          eq(subcontractorPortalTokens.projectId, projectId),
          eq(subcontractorPortalTokens.crmOrganisationId, crmOrganisationId),
          eq(subcontractorPortalTokens.status, "active"),
        ),
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Find sub portal token by the contact email on a specific project.
 * Used for punch-list assignment where the assignee is identified by email.
 */
async function getSubTokenIdsByEmail(
  projectId: string,
  contactEmail: string,
): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: subcontractorPortalTokens.id })
      .from(subcontractorPortalTokens)
      .where(
        and(
          eq(subcontractorPortalTokens.projectId, projectId),
          eq(subcontractorPortalTokens.contactEmail, contactEmail),
          eq(subcontractorPortalTokens.status, "active"),
        ),
      );
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * Resolves targeted vendor user IDs by matching CRM contact emails to VENDOR users.
 *
 * Flow: crmContacts WHERE organisationId = crmOrgId AND email IS NOT NULL
 *       → users WHERE email IN (contactEmails) AND role = 'VENDOR' AND isActive = true
 *
 * This gives precise targeting without a direct FK between users and CRM orgs.
 */
async function getVendorUserIdsForCrmOrg(
  orgId: string,
  crmOrgId: string,
): Promise<string[]> {
  try {
    const contacts = await db
      .select({ email: crmContacts.email })
      .from(crmContacts)
      .where(
        and(
          eq(crmContacts.organizationId, orgId),
          eq(crmContacts.organisationId, crmOrgId),
          eq(crmContacts.isActive, true),
        ),
      );

    const emails = contacts
      .map((c) => c.email)
      .filter((e): e is string => !!e);

    if (emails.length === 0) return [];

    const vendorUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          eq(users.isActive, true),
          eq(users.role, "VENDOR" as UserRole),
          inArray(users.email, emails),
        ),
      );

    return vendorUsers.map((u) => u.id);
  } catch {
    return [];
  }
}

async function getOrgIdForProject(projectId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ orgId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return row?.orgId ?? null;
  } catch {
    return null;
  }
}

async function getPoDetails(
  poId: string,
): Promise<{ vendorId: string | null; projectId: string; orgId: string } | null> {
  try {
    const [row] = await db
      .select({
        vendorId: purchaseOrders.vendorId,
        projectId: purchaseOrders.projectId,
        orgId: purchaseOrders.orgId,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, poId))
      .limit(1);
    if (!row) return null;
    return { vendorId: row.vendorId, projectId: row.projectId, orgId: row.orgId };
  } catch {
    return null;
  }
}

// ── Delivery helpers ─────────────────────────────────────────────────────────

type NotifPayload = {
  type: string;
  title: string;
  message: string;
  actionUrl: string;
  metadata?: Record<string, unknown>;
  highPriority?: boolean;
};

async function notifyClients(
  projectId: string,
  orgId: string,
  payload: NotifPayload,
): Promise<void> {
  const ids = await getActiveClientAccessIdsForProject(projectId);
  await Promise.allSettled(
    ids.map((clientPortalAccessId) =>
      createPortalNotification({
        organizationId: orgId,
        recipientType: "client",
        clientPortalAccessId,
        ...payload,
      }),
    ),
  );
}

async function notifyAllSubs(
  projectId: string,
  orgId: string,
  payload: NotifPayload,
): Promise<void> {
  const ids = await getAllSubTokenIdsForProject(projectId);
  await Promise.allSettled(
    ids.map((portalTokenId) =>
      createPortalNotification({
        organizationId: orgId,
        recipientType: "subcontractor",
        portalTokenId,
        ...payload,
      }),
    ),
  );
}

async function notifyTargetedSub(
  projectId: string,
  orgId: string,
  crmOrganisationId: string,
  payload: NotifPayload,
): Promise<void> {
  const ids = await getSubTokenIdsForCrmOrg(projectId, crmOrganisationId);
  await Promise.allSettled(
    ids.map((portalTokenId) =>
      createPortalNotification({
        organizationId: orgId,
        recipientType: "subcontractor",
        portalTokenId,
        ...payload,
      }),
    ),
  );
}

/**
 * Notify vendor users targeted by CRM org (matched via contact email).
 * Falls back to no notification (not org-wide) if no contact email match exists.
 */
async function notifyTargetedVendors(
  orgId: string,
  crmOrgId: string,
  payload: NotifPayload,
): Promise<void> {
  const userIds = await getVendorUserIdsForCrmOrg(orgId, crmOrgId);
  await Promise.allSettled(
    userIds.map((userId) =>
      createPortalNotification({
        organizationId: orgId,
        recipientType: "vendor",
        userId,
        ...payload,
      }),
    ),
  );
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// ── Event Listeners ──────────────────────────────────────────────────────────

export function registerPortalNotificationListener(): void {

  // ── Change Order Submitted → clients (action required) ─────────────────
  eventBus.on("change_order.submitted", async (event: ChangeOrderSubmittedEvent) => {
    try {
      const { changeOrderId, projectId, changeOrderNumber, amount } = event.payload;
      if (!projectId) return;

      const orgId = event.orgId || await getOrgIdForProject(projectId);
      if (!orgId) return;

      const label = changeOrderNumber ? `Change order ${changeOrderNumber}` : "A change order";
      const amountSuffix = amount != null ? ` for ${fmt.format(amount)}` : "";

      await notifyClients(projectId, orgId, {
        type: "change_order.submitted",
        title: "Change Order Submitted for Review",
        message: `${label}${amountSuffix} has been submitted and requires your review.`,
        actionUrl: "/portal?tab=change-orders",
        metadata: { changeOrderId },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: change_order.submitted failed", { error: String(err) });
    }
  });

  // ── Inspection Completed → clients + all subs (presented as report-ready) ─
  eventBus.on("inspection.completed", async (event: InspectionCompletedEvent) => {
    try {
      const { projectId } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const notifPayload: NotifPayload = {
        type: "inspection.report_ready",
        title: "Inspection Report Ready",
        message: "A project inspection report is now available for review.",
        actionUrl: "/portal?tab=progress",
        metadata: { inspectionId: event.payload.inspectionId },
      };

      await Promise.all([
        notifyClients(projectId, orgId, notifPayload),
        notifyAllSubs(projectId, orgId, notifPayload),
      ]);
    } catch (err) {
      logError("portalNotificationListener: inspection.completed failed", { error: String(err) });
    }
  });

  // ── Subcontractor Payment Made → all subs on project ───────────────────
  eventBus.on("subcontractor.payment_made", async (event: SubcontractorPaymentMadeEvent) => {
    try {
      const { projectId, amount } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      await notifyAllSubs(projectId, orgId, {
        type: "subcontractor.payment_made",
        title: "Payment Processed",
        message: `A payment of ${fmt.format(amount)} has been processed for your subcontract.`,
        actionUrl: "/portal?tab=rfis",
        metadata: { paymentId: event.payload.paymentId, contractId: event.payload.contractId },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: subcontractor.payment_made failed", { error: String(err) });
    }
  });

  // ── Project Status Changed → clients + all subs ─────────────────────────
  eventBus.on("project.status_changed", async (event: ProjectStatusChangedEvent) => {
    try {
      const { projectId, newStatus } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const friendlyStatus = newStatus.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      const notifPayload: NotifPayload = {
        type: "project.status_changed",
        title: "Project Status Updated",
        message: `Project status has changed to ${friendlyStatus}.`,
        actionUrl: "/portal",
        metadata: { projectId, newStatus },
      };

      await Promise.all([
        notifyClients(projectId, orgId, notifPayload),
        notifyAllSubs(projectId, orgId, notifPayload),
      ]);
    } catch (err) {
      logError("portalNotificationListener: project.status_changed failed", { error: String(err) });
    }
  });

  // ── Document Revision Created → clients + all subs ──────────────────────
  eventBus.on("document.revision_created", async (event: DocumentRevisionCreatedEvent) => {
    try {
      const { projectId, documentTitle, revisionNumber } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const notifPayload: NotifPayload = {
        type: "document.revision_created",
        title: "Document Updated",
        message: `"${documentTitle}" has been updated (revision ${revisionNumber}).`,
        actionUrl: "/portal?tab=documents",
        metadata: { documentId: event.payload.documentId, revisionId: event.payload.revisionId },
      };

      await Promise.all([
        notifyClients(projectId, orgId, notifPayload),
        notifyAllSubs(projectId, orgId, notifPayload),
      ]);
    } catch (err) {
      logError("portalNotificationListener: document.revision_created failed", { error: String(err) });
    }
  });

  // ── T&M Ticket Approved → all subs on project ───────────────────────────
  eventBus.on("tm_ticket.approved", async (event: TmTicketApprovedEvent) => {
    try {
      const { projectId, grandTotal } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      await notifyAllSubs(projectId, orgId, {
        type: "tm_ticket.approved",
        title: "T&M Ticket Approved",
        message: `A time & material ticket totaling ${fmt.format(grandTotal)} has been approved.`,
        actionUrl: "/portal?tab=rfis",
        metadata: { ticketId: event.payload.ticketId },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: tm_ticket.approved failed", { error: String(err) });
    }
  });

  // ── PO Receipt Recorded → targeted vendors (via CRM contact email) ──────
  eventBus.on("po.receipt_recorded", async (event: PoReceiptRecordedEvent) => {
    try {
      const { poId } = event.payload;
      const po = await getPoDetails(poId);
      if (!po || !po.vendorId) return;

      await notifyTargetedVendors(po.orgId, po.vendorId, {
        type: "po.receipt_recorded",
        title: "Delivery Confirmed",
        message: "A delivery against your purchase order has been received and confirmed.",
        actionUrl: "/portal?tab=dashboard",
        metadata: { poId, receiptId: event.payload.receiptId },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: po.receipt_recorded failed", { error: String(err) });
    }
  });

  // ── RFI Answered → targeted sub by crmOrganisationId (or all subs) ─────
  eventBus.on("rfi.answered", async (event: RfiAnsweredEvent) => {
    try {
      const { projectId, subject, rfiNumber, subcontractorCrmOrgId } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const label = rfiNumber ? `RFI ${rfiNumber}` : "An RFI";
      const notifPayload: NotifPayload = {
        type: "rfi.answered",
        title: "RFI Answered",
        message: `${label} "${subject}" has been answered by the project team.`,
        actionUrl: "/portal?tab=rfis",
        metadata: { rfiId: event.payload.rfiId },
        highPriority: true,
      };

      if (subcontractorCrmOrgId) {
        await notifyTargetedSub(projectId, orgId, subcontractorCrmOrgId, notifPayload);
      } else {
        await notifyAllSubs(projectId, orgId, notifPayload);
      }
    } catch (err) {
      logError("portalNotificationListener: rfi.answered failed", { error: String(err) });
    }
  });

  // ── Submittal Approved → targeted sub by crmOrganisationId (or all) ────
  eventBus.on("submittal.approved", async (event: SubmittalApprovedEvent) => {
    try {
      const { projectId, subject, submittalNumber, subcontractorCrmOrgId } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const label = submittalNumber ? `Submittal ${submittalNumber}` : "A submittal";
      const notifPayload: NotifPayload = {
        type: "submittal.approved",
        title: "Submittal Approved",
        message: `${label} "${subject}" has been approved.`,
        actionUrl: "/portal?tab=submittals",
        metadata: { submittalId: event.payload.submittalId },
        highPriority: true,
      };

      if (subcontractorCrmOrgId) {
        await notifyTargetedSub(projectId, orgId, subcontractorCrmOrgId, notifPayload);
      } else {
        await notifyAllSubs(projectId, orgId, notifPayload);
      }
    } catch (err) {
      logError("portalNotificationListener: submittal.approved failed", { error: String(err) });
    }
  });

  // ── Submittal Rejected → targeted sub by crmOrganisationId (or all) ────
  eventBus.on("submittal.rejected", async (event: SubmittalRejectedEvent) => {
    try {
      const { projectId, subject, submittalNumber, reviewComments, subcontractorCrmOrgId } = event.payload;
      if (!projectId) return;

      const orgId = await getOrgIdForProject(projectId);
      if (!orgId) return;

      const label = submittalNumber ? `Submittal ${submittalNumber}` : "A submittal";
      const commentSuffix = reviewComments ? ` Reviewer comment: "${reviewComments}"` : "";
      const notifPayload: NotifPayload = {
        type: "submittal.rejected",
        title: "Submittal Rejected",
        message: `${label} "${subject}" has been rejected and requires revision.${commentSuffix}`,
        actionUrl: "/portal?tab=submittals",
        metadata: { submittalId: event.payload.submittalId },
        highPriority: true,
      };

      if (subcontractorCrmOrgId) {
        await notifyTargetedSub(projectId, orgId, subcontractorCrmOrgId, notifPayload);
      } else {
        await notifyAllSubs(projectId, orgId, notifPayload);
      }
    } catch (err) {
      logError("portalNotificationListener: submittal.rejected failed", { error: String(err) });
    }
  });

  // ── AIA Pay Application Submitted → clients (action required) ──────────
  eventBus.on("aia_pay_application.submitted", async (event: AiaPayApplicationSubmittedEvent) => {
    try {
      const { projectId, applicationNumber, organizationId } = event.payload;
      if (!projectId) return;

      const appLabel = applicationNumber != null
        ? `Pay Application #${applicationNumber}`
        : "A pay application";

      await notifyClients(projectId, organizationId, {
        type: "aia_pay_application.submitted",
        title: "Pay Application Submitted",
        message: `${appLabel} has been submitted for your review and approval.`,
        actionUrl: "/portal?tab=payments",
        metadata: { payApplicationId: event.payload.payApplicationId },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: aia_pay_application.submitted failed", { error: String(err) });
    }
  });

  // ── Purchase Order Issued → targeted vendor + all subs on the project ───
  eventBus.on("purchase_order.issued", async (event: PurchaseOrderIssuedEvent) => {
    try {
      const { poId, poNumber, totalCost, vendorId, projectId } = event.payload;
      const orgId = event.orgId;
      if (!orgId) return;

      const formattedTotal = totalCost ? fmt.format(parseFloat(totalCost)) : null;
      const vendorMessage = formattedTotal
        ? `Purchase order ${poNumber} totaling ${formattedTotal} has been issued to your organization.`
        : `Purchase order ${poNumber} has been issued to your organization.`;

      const tasks: Promise<void>[] = [];

      // Notify the specific vendor (targeted by CRM org)
      if (vendorId) {
        tasks.push(
          notifyTargetedVendors(orgId, vendorId, {
            type: "purchase_order.issued",
            title: "Purchase Order Issued",
            message: vendorMessage,
            actionUrl: "/portal?tab=dashboard",
            metadata: { poId, poNumber },
            highPriority: true,
          }),
        );
      }

      // Notify all subs on the project so they know materials/services are on order
      if (projectId) {
        tasks.push(
          notifyAllSubs(projectId, orgId, {
            type: "purchase_order.issued",
            title: "Purchase Order Issued",
            message: formattedTotal
              ? `A purchase order ${poNumber} totaling ${formattedTotal} has been issued for this project.`
              : `A purchase order ${poNumber} has been issued for this project.`,
            actionUrl: "/portal?tab=rfis",
            metadata: { poId, poNumber },
          }),
        );
      }

      await Promise.allSettled(tasks);
    } catch (err) {
      logError("portalNotificationListener: purchase_order.issued failed", { error: String(err) });
    }
  });

  // ── Closeout Package Ready → clients on project (action available) ──────
  eventBus.on("closeout.package_ready", async (event: CloseoutPackageReadyEvent) => {
    try {
      const { packageId, projectId, filename, fileSize, downloadUrl } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      const sizeKb = Math.round(fileSize / 1024);
      await notifyClients(projectId, orgId, {
        type: "closeout.package_ready",
        title: "Closeout Package Ready",
        message: `The project closeout package "${filename}" (${sizeKb} KB) is ready for download.`,
        actionUrl: downloadUrl ?? "/portal?tab=documents",
        metadata: { packageId, filename, fileSize },
        highPriority: true,
      });
    } catch (err) {
      logError("portalNotificationListener: closeout.package_ready failed", { error: String(err) });
    }
  });

  // ── Punch List Item Assigned → only the specific assigned subcontractor ─
  eventBus.on("punch_list_item.assigned", async (event: PunchListItemAssignedEvent) => {
    try {
      const { itemId, projectId, title, assignedToUserId, assignedToName, assignedToEmail } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      // Only notify if we can identify a specific recipient — never broadcast
      if (!assignedToEmail) return;

      const tokenIds = await getSubTokenIdsByEmail(projectId, assignedToEmail);
      if (tokenIds.length === 0) return;

      await Promise.allSettled(
        tokenIds.map((portalTokenId) =>
          createPortalNotification({
            organizationId: orgId,
            recipientType: "subcontractor",
            portalTokenId,
            type: "punch_list_item.assigned",
            title: "Punch List Item Assigned",
            message: `You have been assigned a punch list item: "${title}". Please review and complete it.`,
            actionUrl: "/portal?tab=rfis",
            metadata: { itemId, assignedToUserId, assignedToName, assignedToEmail },
            highPriority: true,
          }),
        ),
      );
    } catch (err) {
      logError("portalNotificationListener: punch_list_item.assigned failed", { error: String(err) });
    }
  });

  // ── Payment Received → clients (AIA) / subs (TM) / vendor (VENDOR_INVOICE)
  eventBus.on("payment.received", async (event: PaymentReceivedEvent) => {
    try {
      const { paymentId, projectId, invoiceType, invoiceId, amount, vendorCrmOrgId } = event.payload;
      const orgId = event.orgId;
      if (!orgId) return;

      const formattedAmount = fmt.format(parseFloat(amount));

      if (invoiceType === "AIA_PAY_APP" && projectId) {
        await notifyClients(projectId, orgId, {
          type: "payment.received",
          title: "Payment Received",
          message: `A payment of ${formattedAmount} has been received for your pay application.`,
          actionUrl: "/portal?tab=payments",
          metadata: { paymentId, invoiceId, invoiceType },
          highPriority: true,
        });
      } else if (invoiceType === "TM_INVOICE" && projectId) {
        await notifyAllSubs(projectId, orgId, {
          type: "payment.received",
          title: "Invoice Payment Received",
          message: `A payment of ${formattedAmount} has been recorded for invoice ${invoiceId}.`,
          actionUrl: "/portal?tab=rfis",
          metadata: { paymentId, invoiceId, invoiceType },
          highPriority: true,
        });
      } else if (invoiceType === "VENDOR_INVOICE" && vendorCrmOrgId) {
        await notifyTargetedVendors(orgId, vendorCrmOrgId, {
          type: "payment.received",
          title: "Invoice Payment Processed",
          message: `A payment of ${formattedAmount} has been processed for invoice ${invoiceId}.`,
          actionUrl: "/portal?tab=dashboard",
          metadata: { paymentId, invoiceId, invoiceType },
          highPriority: true,
        });
      }
    } catch (err) {
      logError("portalNotificationListener: payment.received failed", { error: String(err) });
    }
  });

  // ── Invoice Generated → clients (in-app only, no email) ─────────────────
  eventBus.on("invoice.generated", async (event: InvoiceGeneratedEvent) => {
    try {
      const { invoiceId, projectId, invoiceNumber, total } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      const totalStr = total ? ` for ${fmt.format(parseFloat(total))}` : "";
      await notifyClients(projectId, orgId, {
        type: "invoice.generated",
        title: "Invoice Generated",
        message: `Invoice ${invoiceNumber}${totalStr} has been generated and is available for review.`,
        actionUrl: "/portal?tab=payments",
        metadata: { invoiceId, invoiceNumber },
      });
    } catch (err) {
      logError("portalNotificationListener: invoice.generated failed", { error: String(err) });
    }
  });

  // ── Project Milestone Completed → all clients on the project ────────────
  eventBus.on("project.milestone_completed", async (event: ProjectMilestoneCompletedEvent) => {
    try {
      const { projectId, milestoneId, milestoneName, percentComplete } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      await notifyClients(projectId, orgId, {
        type: "project.milestone_completed",
        title: "Project Milestone Reached",
        message: `Milestone "${milestoneName}" has been completed. The project is now ${percentComplete}% complete.`,
        actionUrl: "/portal?tab=schedule",
        metadata: { milestoneId, milestoneName, percentComplete },
      });
    } catch (err) {
      logError("portalNotificationListener: project.milestone_completed failed", { error: String(err) });
    }
  });

  // ── Purchase Order Revised → targeted vendor ─────────────────────────────
  eventBus.on("purchase_order.revised", async (event: PurchaseOrderRevisedEvent) => {
    try {
      const { poId, poNumber, projectId, vendorId, revisionNote } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      const note = revisionNote ? ` Note: ${revisionNote}` : "";
      const notif: NotifPayload = {
        type: "purchase_order.revised",
        title: "Purchase Order Revised",
        message: `PO ${poNumber} has been revised and requires your attention.${note}`,
        actionUrl: "/portal?tab=dashboard",
        metadata: { poId, poNumber, vendorId },
        highPriority: true,
      };

      if (vendorId) {
        const vendorUserIds = await getVendorUserIdsForCrmOrg(orgId, vendorId);
        await Promise.allSettled(
          vendorUserIds.map((vendorUserId) =>
            createPortalNotification({
              organizationId: orgId,
              recipientType: "vendor",
              userId: vendorUserId,
              ...notif,
            }),
          ),
        );
      }
    } catch (err) {
      logError("portalNotificationListener: purchase_order.revised failed", { error: String(err) });
    }
  });

  // ── Delivery Confirmation Requested → targeted vendor ────────────────────
  eventBus.on("delivery_confirmation.requested", async (event: DeliveryConfirmationRequestedEvent) => {
    try {
      const { poId, poNumber, projectId, vendorId, expectedDeliveryDate } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      const dateStr = expectedDeliveryDate
        ? ` Expected delivery: ${new Date(expectedDeliveryDate).toLocaleDateString()}.`
        : "";
      const notif: NotifPayload = {
        type: "delivery_confirmation.requested",
        title: "Delivery Confirmation Requested",
        message: `Please confirm delivery for PO ${poNumber}.${dateStr}`,
        actionUrl: "/portal?tab=dashboard",
        metadata: { poId, poNumber, vendorId, expectedDeliveryDate },
        highPriority: true,
      };

      if (vendorId) {
        const vendorUserIds = await getVendorUserIdsForCrmOrg(orgId, vendorId);
        await Promise.allSettled(
          vendorUserIds.map((vendorUserId) =>
            createPortalNotification({
              organizationId: orgId,
              recipientType: "vendor",
              userId: vendorUserId,
              ...notif,
            }),
          ),
        );
      }
    } catch (err) {
      logError("portalNotificationListener: delivery_confirmation.requested failed", { error: String(err) });
    }
  });

  // ── Schedule Changed → all clients + all subs on the project ─────────────
  eventBus.on("schedule.changed", async (event: ScheduleChangedEvent) => {
    try {
      const { projectId, scheduleId, changeType, affectedTaskCount } = event.payload;
      const orgId = event.orgId;
      if (!orgId || !projectId) return;

      const taskWord = affectedTaskCount === 1 ? "task" : "tasks";
      const changeDesc: Record<typeof changeType, string> = {
        task_added: "New tasks have been added",
        task_updated: "Tasks have been updated",
        task_deleted: "Tasks have been removed",
        baseline_updated: "The project baseline has been updated",
      };
      const message = `${changeDesc[changeType]} affecting ${affectedTaskCount} ${taskWord}. Please review the updated schedule.`;

      await Promise.allSettled([
        notifyClients(projectId, orgId, {
          type: "schedule.changed",
          title: "Project Schedule Updated",
          message,
          actionUrl: "/portal?tab=schedule",
          metadata: { scheduleId, changeType, affectedTaskCount },
        }),
        notifyAllSubs(projectId, orgId, {
          type: "schedule.changed",
          title: "Project Schedule Updated",
          message,
          actionUrl: "/portal?tab=rfis",
          metadata: { scheduleId, changeType, affectedTaskCount },
        }),
      ]);
    } catch (err) {
      logError("portalNotificationListener: schedule.changed failed", { error: String(err) });
    }
  });
}
