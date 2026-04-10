import { useRef, useCallback, useState } from "react";
import type { TakeoffMeasurement } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "CREATE" | "DELETE" | "UPDATE";

interface HistoryEntry {
  type: ActionType;
  measurement: TakeoffMeasurement;
  previousMeasurement?: TakeoffMeasurement;
  sheetId: string;
}

function buildCreatePayload(m: TakeoffMeasurement, sheetId: string) {
  const points = typeof m.points === "string" ? JSON.parse(m.points) : m.points;
  return {
    sheetId,
    type: m.type,
    points,
    label: m.label,
    depthFeet: m.depthFeet ? Number(m.depthFeet) : undefined,
    categoryId: m.categoryId,
    unitCost: m.unitCost ? String(m.unitCost) : undefined,
    costCodeId: m.costCodeId || undefined,
    color: m.color || undefined,
    hostMeasurementId: m.hostMeasurementId || undefined,
    pitchRatio: m.pitchRatio ? String(m.pitchRatio) : undefined,
    dropFeet: m.dropFeet ? String(m.dropFeet) : undefined,
    source: m.source || undefined,
    metadata: m.metadata || undefined,
  };
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

  const pushAction = useCallback((type: ActionType, measurement: TakeoffMeasurement, sheetId: string, previousMeasurement?: TakeoffMeasurement) => {
    undoStack.current.push({ type, measurement, sheetId, previousMeasurement });
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
      } else if (entry.type === "DELETE") {
        const payload = buildCreatePayload(entry.measurement, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
        const restored = await res.json();
        entry.measurement = restored;
      } else if (entry.type === "UPDATE" && entry.previousMeasurement) {
        const points = typeof entry.previousMeasurement.points === "string"
          ? JSON.parse(entry.previousMeasurement.points)
          : entry.previousMeasurement.points;
        const res = await apiRequest("PATCH", `/api/takeoff/measurements/${entry.measurement.id}`, {
          points,
          label: entry.previousMeasurement.label,
          type: entry.previousMeasurement.type,
          categoryId: entry.previousMeasurement.categoryId,
          unitCost: entry.previousMeasurement.unitCost ? String(entry.previousMeasurement.unitCost) : undefined,
          costCodeId: entry.previousMeasurement.costCodeId || undefined,
          color: entry.previousMeasurement.color || undefined,
        });
        const updated = await res.json();
        entry.measurement = updated;
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
        const payload = buildCreatePayload(entry.measurement, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
        const restored = await res.json();
        entry.measurement = restored;
      } else if (entry.type === "DELETE") {
        await apiRequest("DELETE", `/api/takeoff/measurements/${entry.measurement.id}`);
      } else if (entry.type === "UPDATE") {
        const points = typeof entry.measurement.points === "string"
          ? JSON.parse(entry.measurement.points)
          : entry.measurement.points;
        const res = await apiRequest("PATCH", `/api/takeoff/measurements/${entry.measurement.id}`, {
          points,
          label: entry.measurement.label,
          type: entry.measurement.type,
          categoryId: entry.measurement.categoryId,
          unitCost: entry.measurement.unitCost ? String(entry.measurement.unitCost) : undefined,
          costCodeId: entry.measurement.costCodeId || undefined,
          color: entry.measurement.color || undefined,
        });
        const updated = await res.json();
        entry.measurement = updated;
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
