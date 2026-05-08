import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface Collaborator {
  userId: string;
  userName: string;
  userColor: string;
  currentSheetId: string | null;
  sheetLock: string | null;
  /** Task #2657 — measurement the peer currently has selected /
   *  is editing in the properties panel. Surfaced via the
   *  presence snapshot so newly-joining clients can render the
   *  properties-panel "X is editing" indicator without waiting for
   *  the next MEASUREMENT_FOCUSED heartbeat. */
  currentMeasurementId?: string | null;
}

/** Task #2657 — Live "Jane is editing this measurement" presence
 *  entry consumed by `TakeoffPropertiesPanel`. Refreshed by every
 *  incoming `MEASUREMENT_FOCUSED` event and aged out client-side
 *  if no refresh arrives within `MEASUREMENT_FOCUS_STALE_MS`. */
export interface MeasurementFocusEntry {
  userId: string;
  userName: string;
  userColor: string;
  measurementId: string;
  sheetId: string | null;
  lastUpdate: number;
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
// Task #2657 — How often the local client re-broadcasts its current
// measurement focus so peers can age it out, and how long peers will
// keep displaying a peer's focus without a refresh before clearing
// the indicator. Stale window is generous enough to ride out a
// missed heartbeat but short enough that "Jane closed the panel"
// clears within a few seconds.
const MEASUREMENT_FOCUS_HEARTBEAT_MS = 4000;
const MEASUREMENT_FOCUS_STALE_MS = 10000;

interface UseTakeoffCollaborationParams {
  roomId: string | null;
  selectedSheet: string | null;
  currentUserId: string | null;
  /**
   * Task #1971 — Invoked when the server broadcasts a `MARKUP_DELETED`
   * collab event (a teammate removed one or more markups via the
   * single-DELETE or bulk-DELETE route). The hook itself surgically
   * prunes the active sheet's `["/api/takeoff/sheets", sheetId, "markups"]`
   * react-query cache for the affected ids; this callback exists so the
   * workspace can mirror the prune into its local selection set, the
   * same way the #1837 `pruneSelectedMarkupIds` callback does for
   * not_found-PATCH-driven prunes.
   *
   * Called even when `sheetId !== selectedSheet` so the workspace can
   * still drop those ids from a multi-sheet selection it may be
   * carrying — the cache prune in this hook is also unconditional for
   * the same reason.
   */
  onMarkupDeleted?: (sheetId: string, markupIds: string[]) => void;
}

export function useTakeoffCollaboration({ roomId, selectedSheet, currentUserId, onMarkupDeleted }: UseTakeoffCollaborationParams) {
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [cursors, setCursors] = useState<Map<string, CollaboratorCursor>>(new Map());
  const [sheetLocks, setSheetLocks] = useState<Map<string, SheetLockInfo>>(new Map());
  // Task #2657 — Live "X is editing this measurement" presence keyed
  // by peer userId. We key by user (not by measurement) so a peer
  // jumping selection between two measurements naturally moves the
  // indicator instead of producing two stale entries.
  const [measurementFocus, setMeasurementFocus] = useState<Map<string, MeasurementFocusEntry>>(new Map());
  const myFocusRef = useRef<{ measurementId: string | null; sheetId: string | null }>({
    measurementId: null,
    sheetId: null,
  });
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
  // Task #1971 — keep the latest `onMarkupDeleted` callback in a ref
  // so the long-lived `ws.onmessage` closure always invokes the
  // current workspace handler (the workspace re-creates its arrow
  // callbacks on every render, but we only attach `onmessage` once
  // per WebSocket connection).
  const onMarkupDeletedRef = useRef(onMarkupDeleted);
  onMarkupDeletedRef.current = onMarkupDeleted;

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
            const presence: Collaborator[] = msg.payload.presence.filter(
              (p: Collaborator) => p.userId !== currentUserIdRef.current,
            );
            setCollaborators(presence);
            // Task #2657 — Seed measurement-focus state from the
            // presence snapshot so the indicator appears immediately
            // for measurements that peers were already editing when
            // we connected (instead of waiting for the next 4s
            // heartbeat).
            const now = Date.now();
            setMeasurementFocus((prev) => {
              const next = new Map(prev);
              for (const p of presence) {
                if (p.currentMeasurementId) {
                  next.set(p.userId, {
                    userId: p.userId,
                    userName: p.userName,
                    userColor: p.userColor,
                    measurementId: p.currentMeasurementId,
                    sheetId: p.currentSheetId ?? null,
                    lastUpdate: now,
                  });
                }
              }
              return next;
            });
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
            // Task #2657 — Clear the leaving peer's focus indicator.
            setMeasurementFocus((prev) => {
              if (!prev.has(msg.senderId!)) return prev;
              const next = new Map(prev);
              next.delete(msg.senderId!);
              return next;
            });
          }
          break;
        }

        case "MEASUREMENT_FOCUSED": {
          // Task #2657 — A peer just selected (or deselected) a
          // measurement in their properties panel. Update our
          // per-peer focus map so the panel can show "X is editing
          // this measurement" before the user tries to save and
          // hits a conflict.
          if (!msg.senderId || msg.senderId === currentUserIdRef.current) break;
          const senderId = msg.senderId;
          const measurementId: string | null =
            typeof msg.payload?.measurementId === "string" && msg.payload.measurementId.length > 0
              ? msg.payload.measurementId
              : null;
          const sheetId: string | null =
            typeof msg.payload?.sheetId === "string" && msg.payload.sheetId.length > 0
              ? msg.payload.sheetId
              : null;
          setMeasurementFocus((prev) => {
            const next = new Map(prev);
            if (measurementId === null) {
              if (!next.has(senderId)) return prev;
              next.delete(senderId);
            } else {
              next.set(senderId, {
                userId: senderId,
                userName: msg.senderName || "Unknown",
                userColor: msg.senderColor || "#3b82f6",
                measurementId,
                sheetId,
                lastUpdate: Date.now(),
              });
            }
            return next;
          });
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

        // Task #1971 — A teammate deleted one or more markups (single
        // or bulk). Surgically prune the affected ids out of the
        // sheet's cached `markups` query so the canvas updates in
        // seconds, instead of waiting for the local user to attempt
        // an edit on a phantom markup and discover it via the #1837
        // not_found PATCH path. The companion `onMarkupDeleted`
        // callback lets the workspace mirror the prune into its
        // local selection set so the user can't re-select a markup
        // the server has already removed.
        case "MARKUP_DELETED": {
          const sheetId: string | undefined = msg.payload?.sheetId;
          const markupIds: unknown = msg.payload?.markupIds;
          if (
            !sheetId ||
            !Array.isArray(markupIds) ||
            markupIds.length === 0
          ) {
            break;
          }
          const ids = markupIds.filter(
            (v): v is string => typeof v === "string" && v.length > 0,
          );
          if (ids.length === 0) break;
          const idSet = new Set(ids);
          const markupsKey = ["/api/takeoff/sheets", sheetId, "markups"];
          queryClient.setQueryData<Array<{ id: string }>>(
            markupsKey,
            (old) => (old ? old.filter((m) => !idSet.has(m.id)) : old),
          );
          onMarkupDeletedRef.current?.(sheetId, ids);
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
      // Task #2657 — Age out per-peer measurement-focus entries we
      // haven't heard a heartbeat for in MEASUREMENT_FOCUS_STALE_MS.
      // This catches cases where a teammate's tab crashed or the
      // network dropped before they could broadcast a blur.
      setMeasurementFocus((prev) => {
        if (prev.size === 0) return prev;
        const next = new Map(prev);
        let changed = false;
        next.forEach((entry, key) => {
          if (now - entry.lastUpdate > MEASUREMENT_FOCUS_STALE_MS) {
            next.delete(key);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Task #2657 — Heartbeat that re-broadcasts the local user's
  // current measurement focus every few seconds. Without this peers
  // would have to keep their own focus state alive forever; with it
  // they can confidently age out entries that stop refreshing.
  useEffect(() => {
    const interval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const focus = myFocusRef.current;
      if (!focus.measurementId) return;
      ws.send(JSON.stringify({
        type: "MEASUREMENT_FOCUSED",
        payload: {
          measurementId: focus.measurementId,
          sheetId: focus.sheetId,
        },
      }));
    }, MEASUREMENT_FOCUS_HEARTBEAT_MS);
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

  // Task #2657 — Broadcast which measurement the local user is
  // currently focused on (selected in the properties panel).
  // `measurementId === null` clears the focus. The workspace calls
  // this from a useEffect that watches `selectedMeasurementId` so
  // peers see the indicator the instant the panel opens — well
  // before the user starts typing and risks a save-time conflict.
  const broadcastMeasurementFocus = useCallback((measurementId: string | null, sheetId: string | null) => {
    const prev = myFocusRef.current;
    if (prev.measurementId === measurementId && prev.sheetId === sheetId) return;
    myFocusRef.current = { measurementId, sheetId };
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "MEASUREMENT_FOCUSED",
        payload: { measurementId, sheetId },
      }));
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
    // Task #2657 — Live "X is editing this measurement" presence
    // and the broadcaster used by the workspace to publish the
    // local user's selected measurement.
    measurementFocus,
    broadcastMeasurementFocus,
    lockSheet,
    unlockSheet,
  };
}
