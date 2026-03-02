import { useRef, useCallback, useState } from "react";
import type { TakeoffMeasurement } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "CREATE" | "DELETE";

interface HistoryEntry {
  type: ActionType;
  measurement: TakeoffMeasurement;
  sheetId: string;
}

export function useTakeoffHistory(selectedSheet: string | null) {
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const updateFlags = useCallback(() => {
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const pushAction = useCallback((type: ActionType, measurement: TakeoffMeasurement, sheetId: string) => {
    undoStack.current.push({ type, measurement, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  const invalidate = useCallback((sheetId: string) => {
    queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheetId, "measurements"] });
  }, []);

  const undo = useCallback(async () => {
    if (undoStack.current.length === 0 || isPending) return;
    const entry = undoStack.current.pop()!;
    setIsPending(true);
    try {
      if (entry.type === "CREATE") {
        await apiRequest("DELETE", `/api/takeoff/measurements/${entry.measurement.id}`);
      } else {
        const points = typeof entry.measurement.points === "string"
          ? JSON.parse(entry.measurement.points)
          : entry.measurement.points;
        const res = await apiRequest("POST", "/api/takeoff/measurements", {
          sheetId: entry.sheetId,
          type: entry.measurement.type,
          points,
          label: entry.measurement.label,
          depthFeet: entry.measurement.depthFeet ? Number(entry.measurement.depthFeet) : undefined,
          categoryId: entry.measurement.categoryId,
        });
        const restored = await res.json();
        entry.measurement = restored;
      }
      redoStack.current.push(entry);
      invalidate(entry.sheetId);
    } catch {
      undoStack.current.push(entry);
    } finally {
      setIsPending(false);
      updateFlags();
    }
  }, [isPending, invalidate, updateFlags]);

  const redo = useCallback(async () => {
    if (redoStack.current.length === 0 || isPending) return;
    const entry = redoStack.current.pop()!;
    setIsPending(true);
    try {
      if (entry.type === "CREATE") {
        const points = typeof entry.measurement.points === "string"
          ? JSON.parse(entry.measurement.points)
          : entry.measurement.points;
        const res = await apiRequest("POST", "/api/takeoff/measurements", {
          sheetId: entry.sheetId,
          type: entry.measurement.type,
          points,
          label: entry.measurement.label,
          depthFeet: entry.measurement.depthFeet ? Number(entry.measurement.depthFeet) : undefined,
          categoryId: entry.measurement.categoryId,
        });
        const restored = await res.json();
        entry.measurement = restored;
      } else {
        await apiRequest("DELETE", `/api/takeoff/measurements/${entry.measurement.id}`);
      }
      undoStack.current.push(entry);
      invalidate(entry.sheetId);
    } catch {
      redoStack.current.push(entry);
    } finally {
      setIsPending(false);
      updateFlags();
    }
  }, [isPending, invalidate, updateFlags]);

  const clear = useCallback(() => {
    undoStack.current = [];
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  return { pushAction, undo, redo, canUndo, canRedo, isPending, clear };
}
