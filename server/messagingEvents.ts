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

export function emitMessageNew(
  orgId: string,
  conversationId: string,
  message: unknown,
): void {
  for (const client of clients) {
    if (client.orgId === orgId) {
      sendEvent(client, "message_new", { conversationId, message });
    }
  }
}

export function emitTyping(
  orgId: string,
  conversationId: string,
  userId: string,
  firstName: string,
  lastName: string,
): void {
  for (const client of clients) {
    if (client.orgId === orgId && client.userId !== userId) {
      sendEvent(client, "user_typing", { conversationId, userId, firstName, lastName });
    }
  }
}
