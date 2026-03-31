import { logWarn } from "./utils/logger";
import type { Response } from "express";

interface SseClient {
  userId: string;
  orgId: string;
  res: Response;
}

/**
 * Registry of active SSE connections keyed by userId.
 * Each user may have multiple concurrent connections (e.g. messages page + global call listener).
 * Events are broadcast to all connections for that user.
 */
const clients = new Map<string, Set<SseClient>>();

export function registerSseClient(userId: string, orgId: string, res: Response): () => void {
  const client: SseClient = { userId, orgId, res };
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(client);
  return () => {
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(client);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  };
}

function sendEvent(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    logWarn("Non-critical operation failed");
    const userClients = clients.get(client.userId);
    if (userClients) {
      userClients.delete(client);
      if (userClients.size === 0) {
        clients.delete(client.userId);
      }
    }
  }
}

function sendToUser(userId: string, orgId: string, event: string, data: unknown): void {
  const userClients = clients.get(userId);
  if (!userClients) return;
  for (const client of userClients) {
    if (client.orgId === orgId) {
      sendEvent(client, event, data);
    }
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
    sendToUser(uid, orgId, "message_new", { conversationId, message });
  }
}

export function emitMessageEdited(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  message: unknown,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "message_edited", { conversationId, message });
  }
}

export function emitMessageDeleted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  messageId: string,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "message_deleted", { conversationId, messageId });
  }
}

export function emitMessageReaction(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  messageId: string,
  reactions: unknown,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "message_reaction", { conversationId, messageId, reactions });
  }
}

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
    sendToUser(uid, orgId, "user_typing", { conversationId, userId: senderUserId, firstName, lastName });
  }
}

export function emitCallStarted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  call: unknown,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "call_started", { conversationId, call });
  }
}

export function emitCallJoined(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
  userId: string,
  userName: string,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "call_joined", { conversationId, callId, userId, userName });
  }
}

export function emitCallLeft(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
  userId: string,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "call_left", { conversationId, callId, userId });
  }
}

export function emitCallEnded(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
): void {
  for (const uid of participantUserIds) {
    sendToUser(uid, orgId, "call_ended", { conversationId, callId });
  }
}

export function emitWebRTCSignal(
  orgId: string,
  targetUserId: string,
  signal: unknown,
): void {
  sendToUser(targetUserId, orgId, "webrtc_signal", signal);
}
