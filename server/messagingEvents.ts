import { logWarn } from "./utils/logger";
import type { Response } from "express";
import {
  publishMessagingEvent,
  setMessagingBusHandler,
  type MessagingBusEnvelope,
  type MessagingBusEvent,
} from "./messagingBus";

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
 * Local fan-out: deliver `event`/`payload` to every locally-connected
 * SSE client in `participantUserIds` whose orgId matches.
 *
 * Used by both the direct emit* helpers (originating-pod path) and the
 * cross-pod LISTEN/NOTIFY subscriber in `messagingBus.ts`. The optional
 * `excludeUserId` skips one user (typing indicator suppresses echo to
 * the typer).
 */
function deliverLocally(
  event: string,
  orgId: string,
  participantUserIds: Iterable<string>,
  payload: unknown,
  excludeUserId?: string,
): void {
  const ids = Array.isArray(participantUserIds)
    ? participantUserIds
    : Array.from(participantUserIds);
  for (const uid of ids) {
    if (excludeUserId && uid === excludeUserId) continue;
    for (const client of getClientsForUser(uid)) {
      if (client.orgId === orgId) {
        sendEvent(client, event, payload);
      }
    }
  }
}

/**
 * Fan out an event:
 *  1. Deliver immediately to local SSE clients (no DB hop).
 *  2. Publish to the cross-pod bus so peers can deliver to their
 *     own connected clients. Peers ignore the echo via `podId`.
 *
 * `excludeUserId` (typing indicator) is encoded into the bus payload so
 * peers honour the same suppression rule.
 */
function fanout(
  busEvent: MessagingBusEvent,
  sseEvent: string,
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  payload: Record<string, unknown>,
  excludeUserId?: string,
): void {
  const ids = Array.from(participantUserIds);
  deliverLocally(sseEvent, orgId, ids, payload, excludeUserId);
  void publishMessagingEvent(
    busEvent,
    orgId,
    conversationId,
    ids,
    excludeUserId ? { ...payload, __excludeUserId: excludeUserId } : payload,
  );
}

/** Map a bus event back to the SSE event name and excludeUserId hint. */
function dispatchBusEnvelope(env: MessagingBusEnvelope): void {
  const { event, orgId, participantUserIds, payload } = env;
  const excludeUserId =
    typeof payload.__excludeUserId === "string" ? payload.__excludeUserId : undefined;
  const cleanPayload: Record<string, unknown> = { ...payload };
  delete cleanPayload.__excludeUserId;
  // Ensure conversationId is present in the SSE payload (every emitter
  // includes it). It already lives on the envelope, so add it here for
  // safety in case a future event ships only payload-side fields.
  if (!("conversationId" in cleanPayload)) {
    cleanPayload.conversationId = env.conversationId;
  }
  deliverLocally(event, orgId, participantUserIds, cleanPayload, excludeUserId);
}

setMessagingBusHandler(dispatchBusEnvelope);

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
  fanout("message_new", "message_new", orgId, conversationId, participantUserIds, {
    conversationId,
    message,
  });
}

export function emitMessageEdited(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  message: unknown,
): void {
  fanout("message_edited", "message_edited", orgId, conversationId, participantUserIds, {
    conversationId,
    message,
  });
}

export function emitMessageDeleted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  messageId: string,
): void {
  fanout("message_deleted", "message_deleted", orgId, conversationId, participantUserIds, {
    conversationId,
    messageId,
  });
}

export function emitMessageReaction(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  messageId: string,
  reactions: unknown,
): void {
  fanout("message_reaction", "message_reaction", orgId, conversationId, participantUserIds, {
    conversationId,
    messageId,
    reactions,
  });
}

export function emitTyping(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  senderUserId: string,
  firstName: string,
  lastName: string,
): void {
  fanout(
    "user_typing",
    "user_typing",
    orgId,
    conversationId,
    participantUserIds,
    { conversationId, userId: senderUserId, firstName, lastName },
    senderUserId,
  );
}

export function emitCallStarted(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  call: unknown,
): void {
  fanout("call_started", "call_started", orgId, conversationId, participantUserIds, {
    conversationId,
    call,
  });
}

export function emitCallJoined(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
  userId: string,
  userName: string,
): void {
  fanout("call_joined", "call_joined", orgId, conversationId, participantUserIds, {
    conversationId,
    callId,
    userId,
    userName,
  });
}

export function emitCallLeft(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
  userId: string,
): void {
  fanout("call_left", "call_left", orgId, conversationId, participantUserIds, {
    conversationId,
    callId,
    userId,
  });
}

export function emitCallEnded(
  orgId: string,
  conversationId: string,
  participantUserIds: ReadonlySet<string>,
  callId: string,
): void {
  fanout("call_ended", "call_ended", orgId, conversationId, participantUserIds, {
    conversationId,
    callId,
  });
}
