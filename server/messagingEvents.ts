import type { Response } from "express";

interface SseClient {
  userId: string;
  orgId: string;
  res: Response;
}

/**
 * Registry of active SSE connections keyed by userId.
 * Using a Map allows O(1) per-user lookup and easy per-user lifecycle management.
 * Multiple tabs for the same user will overwrite the previous entry (last-write-wins),
 * which is acceptable since EventSource auto-reconnects on close.
 */
const clients = new Map<string, SseClient>();

export function registerSseClient(userId: string, orgId: string, res: Response): () => void {
  const client: SseClient = { userId, orgId, res };
  clients.set(userId, client);
  return () => {
    // Only remove if this is still the registered client for this user
    if (clients.get(userId) === client) {
      clients.delete(userId);
    }
  };
}

function sendEvent(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    clients.delete(client.userId);
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
  for (const uid of participantUserIds) {
    const client = clients.get(uid);
    if (client && client.orgId === orgId) {
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
  for (const uid of participantUserIds) {
    if (uid === senderUserId) continue;
    const client = clients.get(uid);
    if (client && client.orgId === orgId) {
      sendEvent(client, "user_typing", { conversationId, userId: senderUserId, firstName, lastName });
    }
  }
}
