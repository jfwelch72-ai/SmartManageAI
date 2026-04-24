import { db } from "../db";
import { notifications } from "@shared/schema";
import { deliverNotifications } from "./notificationDelivery";
import { sendExternalDocEmail, type ExternalDocKind } from "./externalDocEmailService";
import { logError } from "../utils/logger";

type DocumentEventType = "RFI" | "SUBMITTAL" | "TRANSMITTAL" | "ADDENDUM" | "DOCUMENT_REVISION";

export interface ExternalRecipient {
  email: string;
  documentNumber: string;
  documentSubject: string;
  kind: ExternalDocKind;
  inviterName: string;
  // Submittal review payload extras (rendered in email body when kind
  // === "SUBMITTAL_REVIEW"). Optional for RFI forwards.
  dueDate?: Date | string | null;
  itemCount?: number | null;
}

/**
 * Document event fanout. Internally creates audit-bearing
 * `notifications` rows + native push delivery for the listed user
 * IDs. Task #1599: when an `external` recipient is provided AND the
 * per-org `EXTERNAL_DOC_EMAIL` flag is on, additionally fans out a
 * tokenized portal-link email to the external party. The external
 * branch is delegated to `sendExternalDocEmail` (CRM contact lookup,
 * subcontractor portal token mint, Resend send, structured logging)
 * — keeping every send path under the same call site so audit
 * tooling and feature-flag toggles stay aligned.
 */
export async function notifyDocumentEvent(
  type: DocumentEventType,
  entityId: string,
  orgId: string,
  projectId: string,
  actorId: string,
  recipientIds: string[],
  eventDescription: string,
  entityLabel?: string,
  external?: ExternalRecipient | null,
): Promise<void> {
  const uniqueRecipients = [...new Set(recipientIds)].filter(id => id !== actorId);

  if (uniqueRecipients.length > 0) {
    try {
      const notificationValues = uniqueRecipients.map(userId => ({
        userId,
        organizationId: orgId || null,
        type: "GENERAL" as const,
        title: `${type}: ${eventDescription}`,
        message: entityLabel
          ? `${eventDescription} — ${entityLabel}`
          : eventDescription,
        relatedEntityId: entityId,
        relatedEntityType: type,
      }));

      const inserted = await db.insert(notifications).values(notificationValues).returning();
      setImmediate(() => {
        deliverNotifications(inserted as Parameters<typeof deliverNotifications>[0]).catch(() => undefined);
      });
    } catch (error) {
      logError(`[DocumentNotification] Failed to create notifications for ${type} ${entityId}`, { error: String(error) });
    }
  }

  if (external?.email) {
    void sendExternalDocEmail({
      organizationId: orgId,
      projectId,
      recipientEmail: external.email,
      documentNumber: external.documentNumber,
      documentSubject: external.documentSubject,
      kind: external.kind,
      inviterId: actorId,
      inviterName: external.inviterName,
      dueDate: external.dueDate ?? null,
      itemCount: external.itemCount ?? null,
      documentId: entityId,
    }).catch((error) => {
      // sendExternalDocEmail logs internally; this guard is purely so a
      // throw from the helper never bubbles out and breaks the calling
      // write transaction.
      logError(
        `[DocumentNotification] External email helper threw for ${type} ${entityId}`,
        { error: String(error) },
      );
    });
  }
}
