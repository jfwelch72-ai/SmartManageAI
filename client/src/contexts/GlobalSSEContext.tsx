import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

type SSEEventCallback = (event: MessageEvent) => void;

interface GlobalSSEContextType {
  addListener: (eventType: string, callback: SSEEventCallback) => void;
  removeListener: (eventType: string, callback: SSEEventCallback) => void;
  isConnected: boolean;
}

const GlobalSSEContext = createContext<GlobalSSEContextType | null>(null);

export function GlobalSSEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const listenersRef = useRef<Map<string, Set<SSEEventCallback>>>(new Map());
  const registeredEventsRef = useRef<Set<string>>(new Set());

  const dispatchToListeners = useCallback((eventType: string, event: MessageEvent) => {
    const callbacks = listenersRef.current.get(eventType);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
  }, []);

  const ensureEventRegistered = useCallback((eventType: string) => {
    const es = esRef.current;
    if (!es || registeredEventsRef.current.has(eventType)) return;

    const handler = (e: MessageEvent) => dispatchToListeners(eventType, e);
    es.addEventListener(eventType, handler as EventListener);
    registeredEventsRef.current.add(eventType);
  }, [dispatchToListeners]);

  useEffect(() => {
    if (!user) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
        registeredEventsRef.current.clear();
        setIsConnected(false);
      }
      return;
    }

    const es = new EventSource("/api/messaging/events", { withCredentials: true } as EventSourceInit);
    esRef.current = es;

    const handleConnected = () => {
      setIsConnected(true);
      dispatchToListeners("connected", new MessageEvent("connected"));
    };
    es.addEventListener("connected", handleConnected);

    for (const eventType of listenersRef.current.keys()) {
      if (!registeredEventsRef.current.has(eventType)) {
        const handler = (e: MessageEvent) => dispatchToListeners(eventType, e);
        es.addEventListener(eventType, handler as EventListener);
        registeredEventsRef.current.add(eventType);
      }
    }

    es.onerror = () => setIsConnected(false);

    return () => {
      es.close();
      esRef.current = null;
      registeredEventsRef.current.clear();
      setIsConnected(false);
    };
  }, [user, dispatchToListeners]);

  const addListener = useCallback((eventType: string, callback: SSEEventCallback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType)!.add(callback);
    ensureEventRegistered(eventType);
  }, [ensureEventRegistered]);

  const removeListener = useCallback((eventType: string, callback: SSEEventCallback) => {
    const callbacks = listenersRef.current.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        listenersRef.current.delete(eventType);
      }
    }
  }, []);

  return (
    <GlobalSSEContext.Provider value={{ addListener, removeListener, isConnected }}>
      {children}
    </GlobalSSEContext.Provider>
  );
}

export function useGlobalSSE() {
  const ctx = useContext(GlobalSSEContext);
  if (!ctx) throw new Error("useGlobalSSE must be used within GlobalSSEProvider");
  return ctx;
}
