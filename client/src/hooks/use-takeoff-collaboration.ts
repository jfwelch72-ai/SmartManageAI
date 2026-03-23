import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface Collaborator {
  userId: string;
  userName: string;
  userColor: string;
  currentSheetId: string | null;
  sheetLock: string | null;
}

export interface CollaboratorCursor {
  userId: string;
  userName: string;
  userColor: string;
  x: number;
  y: number;
  sheetId: string | null;
  lastUpdate: number;
}

interface SheetLockInfo {
  userId: string;
  userName: string;
}

interface CollabMessage {
  type: string;
  payload: any;
  senderId?: string;
  senderName?: string;
  senderColor?: string;
  timestamp?: number;
}

const CURSOR_THROTTLE_MS = 50;
const RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const POLL_INTERVAL_MS = 5000;
const CURSOR_STALE_MS = 3000;

interface UseTakeoffCollaborationParams {
  roomId: string | null;
  selectedSheet: string | null;
  currentUserId: string | null;
}

export function useTakeoffCollaboration({ roomId, selectedSheet, currentUserId }: UseTakeoffCollaborationParams) {
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [cursors, setCursors] = useState<Map<string, CollaboratorCursor>>(new Map());
  const [sheetLocks, setSheetLocks] = useState<Map<string, SheetLockInfo>>(new Map());
  const [connected, setConnected] = useState(false);
  const [myColor, setMyColor] = useState<string>("#3b82f6");
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorSendRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const selectedSheetRef = useRef(selectedSheet);
  selectedSheetRef.current = selectedSheet;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  const cleanupWs = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      const sheet = selectedSheetRef.current;
      if (!sheet) return;
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheet, "measurements"] });
    }, POLL_INTERVAL_MS);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!roomId || !mountedRef.current) return;
    cleanupWs();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/takeoff/${roomId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      reconnectAttemptRef.current = 0;
      stopPolling();

      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING", payload: {} }));
        }
      }, 10000);

      if (selectedSheetRef.current) {
        ws.send(JSON.stringify({ type: "SHEET_CHANGED", payload: { sheetId: selectedSheetRef.current } }));
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      let msg: CollabMessage;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case "PRESENCE_JOIN": {
          if (msg.payload?.presence) {
            setCollaborators(msg.payload.presence.filter((p: Collaborator) => p.userId !== currentUserIdRef.current));
          }
          if (msg.payload?.userColor && msg.payload?.userId === currentUserIdRef.current) {
            setMyColor(msg.payload.userColor);
          }
          if (msg.senderId && msg.senderId !== currentUserIdRef.current && msg.senderName) {
            toast({ title: `${msg.senderName} joined`, description: "Working on takeoff" });
          }
          if (msg.payload?.sheetLocks) {
            const locks = new Map<string, SheetLockInfo>();
            for (const [sheetId, info] of Object.entries(msg.payload.sheetLocks as Record<string, SheetLockInfo>)) {
              locks.set(sheetId, info);
            }
            setSheetLocks(locks);
          }
          break;
        }

        case "PRESENCE_LEAVE": {
          if (msg.payload?.presence) {
            setCollaborators(msg.payload.presence.filter((p: Collaborator) => p.userId !== currentUserIdRef.current));
          }
          if (msg.senderId) {
            setCursors((prev) => {
              const next = new Map(prev);
              next.delete(msg.senderId!);
              return next;
            });
          }
          break;
        }

        case "CURSOR_MOVE": {
          if (!msg.senderId || msg.senderId === currentUserIdRef.current) break;
          setCursors((prev) => {
            const next = new Map(prev);
            next.set(msg.senderId!, {
              userId: msg.senderId!,
              userName: msg.senderName || "Unknown",
              userColor: msg.senderColor || "#3b82f6",
              x: msg.payload.x,
              y: msg.payload.y,
              sheetId: msg.payload.sheetId,
              lastUpdate: Date.now(),
            });
            return next;
          });
          break;
        }

        case "MEASUREMENT_CREATED":
        case "MEASUREMENT_UPDATED":
        case "MEASUREMENT_DELETED": {
          const sheetId = msg.payload?.sheetId;
          if (sheetId) {
            queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheetId, "measurements"] });
          }
          if (msg.type === "MEASUREMENT_UPDATED" && msg.senderId !== currentUserIdRef.current && sheetId === selectedSheetRef.current) {
            toast({
              title: "Measurement updated",
              description: `${msg.senderName || "Another user"} modified a measurement on this sheet`,
              variant: "default",
            });
          }
          break;
        }

        case "SHEET_CHANGED": {
          if (msg.payload?.presence) {
            setCollaborators(msg.payload.presence.filter((p: Collaborator) => p.userId !== currentUserIdRef.current));
          }
          break;
        }

        case "SHEET_LOCK": {
          const { sheetId, userId, userName } = msg.payload || {};
          if (sheetId) {
            setSheetLocks((prev) => {
              const next = new Map(prev);
              next.set(sheetId, { userId, userName });
              return next;
            });
            if (userId !== currentUserIdRef.current && sheetId === selectedSheetRef.current) {
              toast({
                title: "Sheet lock",
                description: `${userName || "Another user"} is working on this sheet`,
              });
            }
          }
          break;
        }

        case "SHEET_UNLOCK": {
          const { sheetId } = msg.payload || {};
          if (sheetId) {
            setSheetLocks((prev) => {
              const next = new Map(prev);
              next.delete(sheetId);
              return next;
            });
          }
          break;
        }

        case "PONG":
          break;
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      startPolling();

      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current), MAX_RECONNECT_MS);
      reconnectAttemptRef.current++;
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [roomId, cleanupWs, startPolling, stopPolling, toast]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      cleanupWs();
      stopPolling();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [roomId]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && selectedSheet) {
      wsRef.current.send(JSON.stringify({ type: "SHEET_CHANGED", payload: { sheetId: selectedSheet } }));
    }
  }, [selectedSheet]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCursors((prev) => {
        const next = new Map(prev);
        let changed = false;
        next.forEach((cursor, key) => {
          if (now - cursor.lastUpdate > CURSOR_STALE_MS) {
            next.delete(key);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const sendCursorMove = useCallback((x: number, y: number, sheetId: string | null) => {
    const now = Date.now();
    if (now - lastCursorSendRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorSendRef.current = now;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "CURSOR_MOVE",
        payload: { x, y, sheetId },
      }));
    }
  }, []);

  const broadcastMeasurementChange = useCallback((type: "MEASUREMENT_CREATED" | "MEASUREMENT_UPDATED" | "MEASUREMENT_DELETED", payload: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  const lockSheet = useCallback((sheetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "SHEET_LOCK", payload: { sheetId } }));
    }
    setSheetLocks((prev) => {
      const next = new Map(prev);
      next.set(sheetId, { userId: currentUserIdRef.current || "", userName: "" });
      return next;
    });
  }, []);

  const unlockSheet = useCallback((sheetId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "SHEET_UNLOCK", payload: { sheetId } }));
    }
    setSheetLocks((prev) => {
      const next = new Map(prev);
      next.delete(sheetId);
      return next;
    });
  }, []);

  const visibleCursors = useMemo(() => {
    const result: CollaboratorCursor[] = [];
    cursors.forEach((cursor) => {
      if (cursor.sheetId === selectedSheet) {
        result.push(cursor);
      }
    });
    return result;
  }, [cursors, selectedSheet]);

  const currentSheetLock = useMemo(() => {
    if (!selectedSheet) return null;
    const lock = sheetLocks.get(selectedSheet);
    if (!lock || lock.userId === currentUserId) return null;
    return lock;
  }, [sheetLocks, selectedSheet, currentUserId]);

  return {
    collaborators,
    visibleCursors,
    sheetLocks,
    currentSheetLock,
    connected,
    myColor,
    sendCursorMove,
    broadcastMeasurementChange,
    lockSheet,
    unlockSheet,
  };
}
