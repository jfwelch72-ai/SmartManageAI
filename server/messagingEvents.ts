import type { Response } from "express";

interface SseClient {
  userId: string;
  orgId: string;
  res: Response;
}

const clients = new Set<SseClient>();

export function registerSseClient(userId: string, orgId: string, res: Response): () => void {
  const client: SseClient = { userId, orgId, res };
  clients.add(client);
  return () => {
    clients.delete(client);
  };
}

function sendEvent(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client);
  }
}

/**
 * Emit a new message event.
 * Only delivered to clients whose userId is in `participantUserIds` (conversation membership check).
 * This prevents cross-conversation data leakage within the same org.
 */
export function emitMessageNew(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  message: unknown,
): void {
  for (const client of clients) {
    if (client.orgId === orgId && participantUserIds.has(client.userId)) {
      sendEvent(client, "message_new", { conversationId, message });
    }
  }
}

/**
 * Emit a typing indicator event.
 * Only delivered to other participants of the conversation (excludes the sender).
 * Caller must verify `senderUserId` is a participant before calling.
 */
export function emitTyping(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  senderUserId: string,
  firstName: string,
  lastName: string,
): void {
  for (const client of clients) {
    if (
      client.orgId === orgId &&
      participantUserIds.has(client.userId) &&
      client.userId !== senderUserId
    ) {
      sendEvent(client, "user_typing", { conversationId, userId: senderUserId, firstName, lastName });
    }
  }
}
