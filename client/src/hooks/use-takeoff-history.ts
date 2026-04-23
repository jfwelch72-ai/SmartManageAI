import { useRef, useCallback, useState } from "react";
import type { TakeoffMeasurement, TakeoffMarkup } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "CREATE" | "DELETE" | "UPDATE" | "MARKUP_CREATE" | "MARKUP_DELETE" | "MARKUP_UPDATE";

export interface MarkupSnapshot {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
  points?: { x: number; y: number }[];
}

interface HistoryEntry {
  type: ActionType;
  measurement?: TakeoffMeasurement;
  previousMeasurement?: TakeoffMeasurement;
  markup?: TakeoffMarkup & { points: { x: number; y: number }[] };
  markupBefore?: MarkupSnapshot;
  markupAfter?: MarkupSnapshot;
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

function buildMarkupPayload(m: TakeoffMarkup & { points: { x: number; y: number }[] }, sheetId: string) {
  const points = typeof m.points === "string" ? JSON.parse(m.points as any) : m.points;
  return {
    sheetId,
    tool: m.tool,
    points,
    color: m.color,
    thickness: m.thickness,
    text: (m as any).text || undefined,
    categoryId: (m as any).categoryId || undefined,
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

  const pushMarkupAction = useCallback((type: "MARKUP_CREATE" | "MARKUP_DELETE", markup: TakeoffMarkup & { points: { x: number; y: number }[] }, sheetId: string) => {
    undoStack.current.push({ type, markup, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  const pushMarkupUpdateAction = useCallback((before: MarkupSnapshot, after: MarkupSnapshot, sheetId: string) => {
    undoStack.current.push({ type: "MARKUP_UPDATE", markupBefore: before, markupAfter: after, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  const applyMarkupSnapshot = async (snapshot: MarkupSnapshot) => {
    const payload: Record<string, unknown> = {};
    if (snapshot.color !== undefined) payload.color = snapshot.color;
    if (snapshot.thickness !== undefined) payload.thickness = snapshot.thickness;
    if (snapshot.text !== undefined) payload.text = snapshot.text;
    if (snapshot.points !== undefined) payload.points = snapshot.points;
    await apiRequest("PATCH", `/api/takeoff/markups/${snapshot.id}`, payload);
  };

  const invalidate = useCallback((sheetId: string, isMarkup = false) => {
    const key = isMarkup ? "markups" : "measurements";
    queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", sheetId, key] });
  }, []);

  const undo = useCallback(async () => {
    if (undoStack.current.length === 0 || isPending) return;
    const entry = undoStack.current.pop()!;
    setIsPending(true);
    try {
      if (entry.type === "CREATE" && entry.measurement) {
        await apiRequest("DELETE", `/api/takeoff/measurements/${entry.measurement.id}`);
      } else if (entry.type === "DELETE" && entry.measurement) {
        const payload = buildCreatePayload(entry.measurement, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
        const restored = await res.json();
        entry.measurement = restored;
      } else if (entry.type === "UPDATE" && entry.previousMeasurement && entry.measurement) {
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
      } else if (entry.type === "MARKUP_CREATE" && entry.markup) {
        await apiRequest("DELETE", `/api/takeoff/markups/${entry.markup.id}`);
      } else if (entry.type === "MARKUP_DELETE" && entry.markup) {
        const payload = buildMarkupPayload(entry.markup, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/markups", payload);
        const restored = await res.json();
        entry.markup = { ...restored, points: typeof restored.points === "string" ? JSON.parse(restored.points) : restored.points };
      } else if (entry.type === "MARKUP_UPDATE" && entry.markupBefore) {
        await applyMarkupSnapshot(entry.markupBefore);
      }
      redoStack.current.push(entry);
      invalidate(entry.sheetId, entry.type.startsWith("MARKUP"));
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
      if (entry.type === "CREATE" && entry.measurement) {
        const payload = buildCreatePayload(entry.measurement, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
        const restored = await res.json();
        entry.measurement = restored;
      } else if (entry.type === "DELETE" && entry.measurement) {
        await apiRequest("DELETE", `/api/takeoff/measurements/${entry.measurement.id}`);
      } else if (entry.type === "UPDATE" && entry.measurement) {
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
      } else if (entry.type === "MARKUP_CREATE" && entry.markup) {
        const payload = buildMarkupPayload(entry.markup, entry.sheetId);
        const res = await apiRequest("POST", "/api/takeoff/markups", payload);
        const restored = await res.json();
        entry.markup = { ...restored, points: typeof restored.points === "string" ? JSON.parse(restored.points) : restored.points };
      } else if (entry.type === "MARKUP_DELETE" && entry.markup) {
        await apiRequest("DELETE", `/api/takeoff/markups/${entry.markup.id}`);
      } else if (entry.type === "MARKUP_UPDATE" && entry.markupAfter) {
        await applyMarkupSnapshot(entry.markupAfter);
      }
      undoStack.current.push(entry);
      invalidate(entry.sheetId, entry.type.startsWith("MARKUP"));
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

  return { pushAction, pushMarkupAction, pushMarkupUpdateAction, undo, redo, canUndo, canRedo, isPending, clear };
}
