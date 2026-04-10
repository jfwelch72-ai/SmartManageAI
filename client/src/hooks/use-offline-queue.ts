import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface QueuedOperation {
  id: string;
  type: "CREATE" | "UPDATE" | "DELETE";
  url: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: any;
  sheetId: string;
  timestamp: number;
}

const QUEUE_KEY = "takeoff-offline-queue";

function loadQueue(): QueuedOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedOperation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function useOfflineQueue() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [queueLength, setQueueLength] = useState(() => loadQueue().length);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();
  const syncingRef = useRef(false);

  useEffect(() => {
    const goOffline = () => {
      setIsOffline(true);
      toast({ title: "You're offline", description: "Changes will be saved and synced when you reconnect" });
    };
    const goOnline = () => {
      setIsOffline(false);
      replayQueue();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  const enqueue = useCallback((op: Omit<QueuedOperation, "id" | "timestamp">) => {
    const queue = loadQueue();
    const entry: QueuedOperation = {
      ...op,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    queue.push(entry);
    saveQueue(queue);
    setQueueLength(queue.length);
  }, []);

  const replayQueue = useCallback(async () => {
    if (syncingRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncingRef.current = true;
    setIsSyncing(true);

    let succeeded = 0;
    let failed = 0;
    const remaining: QueuedOperation[] = [];
    const affectedSheets = new Set<string>();

    for (const op of queue) {
      try {
        if (op.method === "DELETE") {
          await apiRequest("DELETE", op.url);
        } else if (op.method === "POST") {
          await apiRequest("POST", op.url, op.body);
        } else if (op.method === "PATCH") {
          await apiRequest("PATCH", op.url, op.body);
        }
        succeeded++;
        affectedSheets.add(op.sheetId);
      } catch {
        failed++;
        remaining.push(op);
      }
    }

    saveQueue(remaining);
    setQueueLength(remaining.length);

    for (const sheetId of affectedSheets) {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheetId, "measurements"] });
    }

    if (succeeded > 0) {
      toast({
        title: "Sync complete",
        description: `${succeeded} queued change${succeeded > 1 ? "s" : ""} synced${failed > 0 ? `, ${failed} failed` : ""}`,
      });
    }

    syncingRef.current = false;
    setIsSyncing(false);
  }, [toast]);

  const wrapMutation = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      url: string,
      body: any | undefined,
      sheetId: string,
      opType: "CREATE" | "UPDATE" | "DELETE"
    ): Promise<any> => {
      if (navigator.onLine) {
        if (method === "DELETE") {
          return apiRequest("DELETE", url);
        } else if (method === "POST") {
          return apiRequest("POST", url, body);
        } else {
          return apiRequest("PATCH", url, body);
        }
      }

      enqueue({ type: opType, url, method, body, sheetId });
      toast({ title: "Saved offline", description: "This change will sync when you're back online" });
      return null;
    },
    [enqueue, toast]
  );

  return {
    isOffline,
    queueLength,
    isSyncing,
    enqueue,
    wrapMutation,
    replayQueue,
  };
}
