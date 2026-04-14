import { logWarn } from "./utils/logger";
import type { Response } from "express";

interface PortalSseClient {
  id: string;
  identifier: string;
  type: "client" | "sub";
  res: Response;
}

let clientIdCounter = 0;

const clientsByIdentifier = new Map<string, PortalSseClient[]>();

function makeKey(type: "client" | "sub", identifier: string): string {
  return `${type}:${identifier}`;
}

export function registerPortalSseClient(
  type: "client" | "sub",
  identifier: string,
  res: Response
): () => void {
  const key = makeKey(type, identifier);
  const client: PortalSseClient = {
    id: String(++clientIdCounter),
    identifier,
    type,
    res,
  };
  const existing = clientsByIdentifier.get(key) || [];
  clientsByIdentifier.set(key, [...existing, client]);

  return () => {
    const arr = clientsByIdentifier.get(key);
    if (arr) {
      const filtered = arr.filter((c) => c.id !== client.id);
      if (filtered.length === 0) {
        clientsByIdentifier.delete(key);
      } else {
        clientsByIdentifier.set(key, filtered);
      }
    }
  };
}

function sendPortalEvent(
  client: PortalSseClient,
  event: string,
  data: unknown
): void {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    logWarn("Non-critical operation failed");
    const key = makeKey(client.type, client.identifier);
    const arr = clientsByIdentifier.get(key);
    if (arr) {
      const filtered = arr.filter((c) => c.id !== client.id);
      if (filtered.length === 0) {
        clientsByIdentifier.delete(key);
      } else {
        clientsByIdentifier.set(key, filtered);
      }
    }
  }
}

export function emitPortalChatMessage(
  type: "client" | "sub",
  identifier: string,
  threadId: string,
  message: unknown
): void {
  const key = makeKey(type, identifier);
  const clients = clientsByIdentifier.get(key) || [];
  for (const client of clients) {
    sendPortalEvent(client, "portal_chat_message", { threadId, message });
  }
}

export function emitPortalChatThreadUpdate(
  type: "client" | "sub",
  identifier: string,
  threadId: string
): void {
  const key = makeKey(type, identifier);
  const clients = clientsByIdentifier.get(key) || [];
  for (const client of clients) {
    sendPortalEvent(client, "portal_chat_thread_update", { threadId });
  }
}
