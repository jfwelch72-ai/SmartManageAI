import { db } from "../db";
import { notifications } from "@shared/schema";

type DocumentEventType = "RFI" | "SUBMITTAL" | "TRANSMITTAL" | "ADDENDUM" | "DOCUMENT_REVISION";

export async function notifyDocumentEvent(
  type: DocumentEventType,
  entityId: string,
  orgId: string,
  projectId: string,
  actorId: string,
  recipientIds: string[],
  eventDescription: string,
  entityLabel?: string
): Promise<void> {
  const uniqueRecipients = [...new Set(recipientIds)].filter(id => id !== actorId);

  if (uniqueRecipients.length === 0) return;

  try {
    const notificationValues = uniqueRecipients.map(userId => ({
      userId,
      type: "GENERAL" as const,
      title: `${type}: ${eventDescription}`,
      message: entityLabel
        ? `${eventDescription} — ${entityLabel}`
        : eventDescription,
      relatedEntityId: entityId,
      relatedEntityType: type,
    }));

    await db.insert(notifications).values(notificationValues);
  } catch (error) {
    console.error(`[DocumentNotification] Failed to create notifications for ${type} ${entityId}:`, error);
  }
}
