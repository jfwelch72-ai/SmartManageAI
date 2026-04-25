import {logError, logWarn } from "./utils/logger";
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "./auth";

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const key = pair.substring(0, idx).trim();
    let val = pair.substring(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
  });
  return cookies;
}

import { db } from "./db";
import { users, projects, bids } from "@shared/schema";
import { eq, and } from "drizzle-orm";

interface CollabClient {
  ws: WebSocket;
  connectionId: string;
  userId: string;
  userName: string;
  userColor: string;
  roomId: string;
  currentSheetId: string | null;
  lastActivity: number;
  sheetLock: string | null;
}

type MessageType =
  | "CURSOR_MOVE"
  | "MEASUREMENT_CREATED"
  | "MEASUREMENT_UPDATED"
  | "MEASUREMENT_DELETED"
  // Task #1971 — server emits `MARKUP_DELETED` from the takeoff
  // markup DELETE / bulk-DELETE routes so every viewer's canvas
  // surgically removes the deleted markup as soon as a teammate
  // removes it on another device. Mirrors the existing
  // `MEASUREMENT_DELETED` pattern but is server-initiated (rather
  // than re-broadcast from the deleter's client) so a stale viewer
  // never has to wait for the next failed PATCH (#1837) to discover
  // the row is gone.
  | "MARKUP_DELETED"
  | "PRESENCE_JOIN"
  | "PRESENCE_LEAVE"
  | "SHEET_CHANGED"
  | "SHEET_LOCK"
  | "SHEET_UNLOCK"
  | "PING"
  | "PONG";

interface CollabMessage {
  type: MessageType;
  payload: any;
  senderId?: string;
  senderName?: string;
  senderColor?: string;
  timestamp?: number;
}

const COLLABORATOR_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f59e0b",
];

const PRESENCE_TIMEOUT_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 15000;

const rooms = new Map<string, Map<string, CollabClient>>();
const sheetLocks = new Map<string, { userId: string; userName: string }>();

function getRoom(roomId: string): Map<string, CollabClient> {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Map());
  }
  return rooms.get(roomId)!;
}

function assignColor(roomId: string, userId: string): string {
  const room = getRoom(roomId);
  const usedColors = new Set<string>();
  room.forEach((client) => {
    if (client.userId !== userId) usedColors.add(client.userColor);
  });
  for (const color of COLLABORATOR_COLORS) {
    if (!usedColors.has(color)) return color;
  }
  return COLLABORATOR_COLORS[Math.floor(Math.random() * COLLABORATOR_COLORS.length)];
}

function broadcastToRoom(roomId: string, message: CollabMessage, excludeConnectionId?: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(message);
  room.forEach((client) => {
    if (excludeConnectionId && client.connectionId === excludeConnectionId) return;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  });
}

/**
 * Task #1971 — Server-initiated broadcast hook used by route handlers
 * (e.g. the takeoff markup DELETE / bulk-DELETE routes) to push a
 * collab event into every connected viewer of `roomId`. The room is
 * the bid id (bid-context takeoffs) or project id (project-context
 * takeoffs) that the takeoff workspace passes when establishing its
 * WebSocket — see `useTakeoffCollaboration` on the client.
 *
 * Idempotent: if the room currently has no connected viewers (no one
 * happens to have the workspace open on the affected bid/project) the
 * call is a no-op rather than an error so routes don't have to guard
 * the call site. Sender exclusion is intentionally NOT supported here
 * — the deleter's client has already removed the row optimistically
 * before its DELETE returned, so receiving the broadcast is a harmless
 * no-op for them.
 */
export function broadcastTakeoffEvent(
  roomId: string,
  type: MessageType,
  payload: unknown,
): void {
  if (!roomId) return;
  if (!rooms.has(roomId)) return;
  broadcastToRoom(roomId, {
    type,
    payload,
    timestamp: Date.now(),
  });
}

function getPresenceList(roomId: string): Array<{ userId: string; userName: string; userColor: string; currentSheetId: string | null; sheetLock: string | null }> {
  const room = rooms.get(roomId);
  if (!room) return [];
  const seen = new Set<string>();
  const result: Array<{ userId: string; userName: string; userColor: string; currentSheetId: string | null; sheetLock: string | null }> = [];
  room.forEach((client) => {
    if (!seen.has(client.userId)) {
      seen.add(client.userId);
      result.push({
        userId: client.userId,
        userName: client.userName,
        userColor: client.userColor,
        currentSheetId: client.currentSheetId,
        sheetLock: client.sheetLock,
      });
    }
  });
  return result;
}

async function verifyRoomAccess(roomId: string, userId: string, organizationId: string | null): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, roomId), eq(projects.gcOrganizationId, organizationId)))
      .limit(1);
    if (project) return true;

    const [bid] = await db.select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.id, roomId), eq(bids.gcOrganizationId, organizationId)))
      .limit(1);
    if (bid) return true;
  } catch (e) {
    logError("[Collab] Room access check failed:", {}, e instanceof Error ? e : new Error(String(e)));
  }
  return false;
}

export function setupTakeoffCollaboration(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/takeoff\/(.+)$/);
    if (!match) {
      return; // Let other upgrade handlers (e.g. Vite HMR) process this
    }

    const roomId = match[1];
    const cookieHeader = request.headers.cookie || "";
    const cookies = parseCookies(cookieHeader);
    const token = cookies["auth_token"];

    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userName = "Unknown";
    let organizationId: string | null = null;
    try {
      const [user] = await db.select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        organizationId: users.organizationId,
      }).from(users).where(eq(users.id, payload.userId)).limit(1);
      if (user) {
        userName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email;
        organizationId = user.organizationId;
      }
    } catch (e) {
      logError("[Collab] Failed to fetch user:", {}, e instanceof Error ? e : new Error(String(e)));
    }

    const hasAccess = await verifyRoomAccess(roomId, payload.userId, organizationId);
    if (!hasAccess) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, { roomId, userId: payload.userId, userName });
    });
  });

  wss.on("connection", (ws: WebSocket, ctx: { roomId: string; userId: string; userName: string }) => {
    const { roomId, userId, userName } = ctx;
    const userColor = assignColor(roomId, userId);
    const room = getRoom(roomId);
    const connectionId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const client: CollabClient = {
      ws,
      connectionId,
      userId,
      userName,
      userColor,
      roomId,
      currentSheetId: null,
      lastActivity: Date.now(),
      sheetLock: null,
    };

    room.set(connectionId, client);

    ws.send(JSON.stringify({
      type: "PRESENCE_JOIN",
      payload: {
        userId,
        userName,
        userColor,
        presence: getPresenceList(roomId),
        sheetLocks: Object.fromEntries(
          Array.from(sheetLocks.entries())
            .filter(([key]) => key.startsWith(`${roomId}:`))
            .map(([key, val]) => [key.split(":")[1], val])
        ),
      },
      senderId: userId,
      senderName: userName,
      senderColor: userColor,
      timestamp: Date.now(),
    }));

    broadcastToRoom(roomId, {
      type: "PRESENCE_JOIN",
      payload: {
        userId,
        userName,
        userColor,
        presence: getPresenceList(roomId),
      },
      senderId: userId,
      senderName: userName,
      senderColor: userColor,
      timestamp: Date.now(),
    }, connectionId);

    ws.on("message", (raw) => {
      client.lastActivity = Date.now();
      let msg: CollabMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        logWarn("Non-critical operation failed");
        return;
      }

      switch (msg.type) {
        case "CURSOR_MOVE":
          broadcastToRoom(roomId, {
            type: "CURSOR_MOVE",
            payload: msg.payload,
            senderId: userId,
            senderName: userName,
            senderColor: userColor,
            timestamp: Date.now(),
          }, connectionId);
          break;

        case "MEASUREMENT_CREATED":
        case "MEASUREMENT_UPDATED":
        case "MEASUREMENT_DELETED":
          broadcastToRoom(roomId, {
            type: msg.type,
            payload: msg.payload,
            senderId: userId,
            senderName: userName,
            senderColor: userColor,
            timestamp: Date.now(),
          }, connectionId);
          break;

        case "SHEET_CHANGED":
          client.currentSheetId = msg.payload?.sheetId || null;
          broadcastToRoom(roomId, {
            type: "SHEET_CHANGED",
            payload: {
              userId,
              userName,
              sheetId: client.currentSheetId,
              presence: getPresenceList(roomId),
            },
            senderId: userId,
            senderName: userName,
            senderColor: userColor,
            timestamp: Date.now(),
          }, connectionId);
          break;

        case "SHEET_LOCK": {
          const sheetId = msg.payload?.sheetId;
          if (!sheetId) break;
          const lockKey = `${roomId}:${sheetId}`;
          if (client.sheetLock && client.sheetLock !== sheetId) {
            sheetLocks.delete(`${roomId}:${client.sheetLock}`);
          }
          client.sheetLock = sheetId;
          sheetLocks.set(lockKey, { userId, userName });
          broadcastToRoom(roomId, {
            type: "SHEET_LOCK",
            payload: { sheetId, userId, userName },
            senderId: userId,
            senderName: userName,
            senderColor: userColor,
            timestamp: Date.now(),
          }, connectionId);
          break;
        }

        case "SHEET_UNLOCK": {
          const sheetId = msg.payload?.sheetId;
          if (!sheetId) break;
          const lockKey = `${roomId}:${sheetId}`;
          const existing = sheetLocks.get(lockKey);
          if (existing && existing.userId === userId) {
            sheetLocks.delete(lockKey);
            client.sheetLock = null;
          }
          broadcastToRoom(roomId, {
            type: "SHEET_UNLOCK",
            payload: { sheetId, userId, userName },
            senderId: userId,
            senderName: userName,
            senderColor: userColor,
            timestamp: Date.now(),
          }, connectionId);
          break;
        }

        case "PING":
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "PONG", payload: {}, timestamp: Date.now() }));
          }
          break;
      }
    });

    ws.on("close", () => {
      room.delete(connectionId);
      if (client.sheetLock) {
        sheetLocks.delete(`${roomId}:${client.sheetLock}`);
      }
      broadcastToRoom(roomId, {
        type: "PRESENCE_LEAVE",
        payload: {
          userId,
          userName,
          presence: getPresenceList(roomId),
        },
        senderId: userId,
        senderName: userName,
        senderColor: userColor,
        timestamp: Date.now(),
      });
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    });

    ws.on("error", () => {
      ws.close();
    });
  });

  setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, roomId) => {
      room.forEach((client, cId) => {
        if (now - client.lastActivity > PRESENCE_TIMEOUT_MS) {
          client.ws.close();
          room.delete(cId);
          if (client.sheetLock) {
            sheetLocks.delete(`${roomId}:${client.sheetLock}`);
          }
          broadcastToRoom(roomId, {
            type: "PRESENCE_LEAVE",
            payload: {
              userId: client.userId,
              userName: client.userName,
              presence: getPresenceList(roomId),
            },
            senderId: client.userId,
            senderName: client.userName,
            senderColor: client.userColor,
            timestamp: Date.now(),
          });
        }
      });
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    });
  }, HEARTBEAT_INTERVAL_MS);

  console.log("[Collab] Takeoff collaboration WebSocket ready");
}
