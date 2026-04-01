import { logWarn } from "./utils/logger";
import type { Response } from "express";

interface SseClient {
  id: string;
  userId: string;
  orgId: string;
  res: Response;
}

let clientIdCounter = 0;

const clientsByUser = new Map<string, SseClient[]>();

export function registerSseClient(userId: string, orgId: string, res: Response): () => void {
  const client: SseClient = { id: String(++clientIdCounter), userId, orgId, res };
  const existing = clientsByUser.get(userId) || [];
  clientsByUser.set(userId, [...existing, client]);
  return () => {
    const arr = clientsByUser.get(userId);
    if (arr) {
      const filtered = arr.filter(c => c.id !== client.id);
      if (filtered.length === 0) {
        clientsByUser.delete(userId);
      } else {
        clientsByUser.set(userId, filtered);
      }
    }
  };
}

function getClientsForUser(userId: string): SseClient[] {
  return clientsByUser.get(userId) || [];
}

function sendEvent(client: SseClient, event: string, data: unknown): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    logWarn("Non-critical operation failed");
    const arr = clientsByUser.get(client.userId);
    if (arr) {
      const filtered = arr.filter(c => c.id !== client.id);
      if (filtered.length === 0) {
        clientsByUser.delete(client.userId);
      } else {
        clientsByUser.set(client.userId, filtered);
      }
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
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "message_new", { conversationId, message });
      }
    }
  }
}

export function emitMessageEdited(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  message: unknown,
): void {
  for (const uid of participantUserIds) {
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "message_edited", { conversationId, message });
      }
    }
  }
}

export function emitMessageDeleted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  messageId: string,
): void {
  for (const uid of participantUserIds) {
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "message_deleted", { conversationId, messageId });
      }
    }
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
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "message_reaction", { conversationId, messageId, reactions });
      }
    }
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
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "user_typing", { conversationId, userId: senderUserId, firstName, lastName });
      }
    }
  }
}

export function emitCallStarted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  call: unknown,
): void {
  for (const uid of participantUserIds) {
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "call_started", { conversationId, call });
      }
    }
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
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "call_joined", { conversationId, callId, userId, userName });
      }
    }
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
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "call_left", { conversationId, callId, userId });
      }
    }
  }
}

export function emitCallEnded(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
): void {
  for (const uid of participantUserIds) {
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, "call_ended", { conversationId, callId });
      }
    }
  }
}

export function emitWebRTCSignal(
  orgId: string,
  targetUserId: string,
  signal: unknown,
): boolean {
  const clients = getClientsForUser(targetUserId).filter(c => c.orgId === orgId);
  if (clients.length === 0) return false;
  for (const client of clients) {
    sendEvent(client, "webrtc_signal", signal);
  }
  return true;
}
