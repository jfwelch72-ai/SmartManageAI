import { useRef, useCallback, useState } from "react";
import type { TakeoffMeasurement, TakeoffMarkup } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "CREATE" | "DELETE" | "UPDATE" | "MEASUREMENT_UPDATE" | "MEASUREMENT_UPDATE_BATCH" | "MARKUP_CREATE" | "MARKUP_DELETE" | "MARKUP_UPDATE" | "MARKUP_UPDATE_BATCH";

export interface MarkupSnapshot {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
  points?: { x: number; y: number }[];
}

export interface MeasurementSnapshot {
  id: string;
  color?: string | null;
  label?: string | null;
  costCodeId?: string | null;
  unitCost?: number | string | null;
  categoryId?: string | null;
  groupId?: string | null;
  lineStyle?: string | null;
  lineWidth?: number | null;
  metadata?: string | null;
  points?: string;
}

interface HistoryEntry {
  type: ActionType;
  measurement?: TakeoffMeasurement;
  previousMeasurement?: TakeoffMeasurement;
  measurementBefore?: MeasurementSnapshot;
  measurementAfter?: MeasurementSnapshot;
  measurementBatchBefore?: MeasurementSnapshot[];
  measurementBatchAfter?: MeasurementSnapshot[];
  markup?: TakeoffMarkup & { points: { x: number; y: number }[] };
  markupBefore?: MarkupSnapshot;
  markupAfter?: MarkupSnapshot;
  markupBatchBefore?: MarkupSnapshot[];
  markupBatchAfter?: MarkupSnapshot[];
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

  // Task #1755 — group multi-select markup body drags into a single
  // history entry so one Undo/Redo press reverses the whole gesture.
  // Without this, after Task #1742 each member of a 5-markup drag pushed
  // its own MARKUP_UPDATE entry, forcing the user to press Undo five
  // times to put the group back. The batch entry PATCHes every member
  // in parallel during undo/redo and falls back gracefully if a single
  // snapshot lacks a meaningful diff (we still push when the caller
  // pre-screens for changes).
  const pushMarkupUpdateBatchAction = useCallback((before: MarkupSnapshot[], after: MarkupSnapshot[], sheetId: string) => {
    if (before.length === 0 || after.length === 0) return;
    undoStack.current.push({ type: "MARKUP_UPDATE_BATCH", markupBatchBefore: before, markupBatchAfter: after, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  // Task #1843 — mirror MARKUP_UPDATE (#1758) for measurements: a single
  // label/category/cost rename via the properties panel pushes one
  // MEASUREMENT_UPDATE entry so a single Undo press reverses it. Without
  // this the per-id PATCH for a single edit produced zero history entries
  // (only batch and CREATE/DELETE were tracked) and rename gestures were
  // un-undoable. Empty / no-op snapshots are filtered out by the caller
  // (use-takeoff-data's `onSuccess` only pushes when `previous` carries a
  // before value for at least one changed field).
  const pushMeasurementUpdateAction = useCallback((before: MeasurementSnapshot, after: MeasurementSnapshot, sheetId: string) => {
    undoStack.current.push({ type: "MEASUREMENT_UPDATE", measurementBefore: before, measurementAfter: after, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  // Task #1770 — mirror MARKUP_UPDATE_BATCH (#1755/#1758) for measurements:
  // bulk property edits or group drags across a multi-selection collapse
  // into a single MEASUREMENT_UPDATE_BATCH entry, undoable/redoable in one
  // press. The measurements API has no `/bulk` PATCH endpoint, so undo/
  // redo fans out per-id PATCHes via Promise.all. Empty arrays are no-ops
  // so callers can pre-screen their snapshots without guarding the call.
  const pushMeasurementUpdateBatchAction = useCallback((before: MeasurementSnapshot[], after: MeasurementSnapshot[], sheetId: string) => {
    if (before.length === 0 || after.length === 0) return;
    undoStack.current.push({ type: "MEASUREMENT_UPDATE_BATCH", measurementBatchBefore: before, measurementBatchAfter: after, sheetId });
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

  // Task #1764 — Group body-drag snapshots only carry `points`, so we
  // can replay them through the same `/api/takeoff/markups/bulk`
  // endpoint that Task #1752 introduced for the original commit. That
  // collapses an N-member Undo/Redo from N PATCHes into one round-trip
  // (a 50-markup group move now costs one PATCH to undo and one to
  // redo, matching the commit cost).
  //
  // Style-only batches (color/thickness/text from the bulk style
  // popover) still fall back to the per-id Promise.all path because
  // the bulk endpoint's schema only accepts `{ id, points }`.
  // Mixed-field batches are not produced anywhere in the codebase
  // today (group drags push points-only; the bulk style popover pushes
  // style-only), but the predicate is defensive: any snapshot that
  // carries a field other than `points` forces the fallback.
  const isPointsOnlyBatch = (
    snaps: MarkupSnapshot[],
  ): snaps is Array<MarkupSnapshot & { points: { x: number; y: number }[] }> =>
    snaps.every(
      (s) =>
        s.points !== undefined &&
        s.color === undefined &&
        s.thickness === undefined &&
        s.text === undefined,
    );

  const applyMarkupBatchSnapshots = async (snaps: MarkupSnapshot[]) => {
    if (isPointsOnlyBatch(snaps)) {
      await apiRequest("PATCH", "/api/takeoff/markups/bulk", {
        updates: snaps.map((s) => ({ id: s.id, points: s.points })),
      });
      return;
    }
    await Promise.all(snaps.map(applyMarkupSnapshot));
  };

  // Task #1770 — apply a single MeasurementSnapshot during undo/redo.
  // Only fields explicitly present on the snapshot are PATCHed so that
  // bulk operations targeting one property (e.g. `categoryId` on the
  // sidebar's Assign Category dropdown) don't accidentally clobber
  // unrelated fields. Mirrors `applyMarkupSnapshot` field-by-field.
  const applyMeasurementSnapshot = async (snapshot: MeasurementSnapshot) => {
    const payload: Record<string, unknown> = {};
    if (snapshot.color !== undefined) payload.color = snapshot.color;
    if (snapshot.label !== undefined) payload.label = snapshot.label;
    if (snapshot.costCodeId !== undefined) payload.costCodeId = snapshot.costCodeId;
    if (snapshot.unitCost !== undefined) {
      payload.unitCost = snapshot.unitCost === null ? null : String(snapshot.unitCost);
    }
    if (snapshot.categoryId !== undefined) payload.categoryId = snapshot.categoryId;
    if (snapshot.groupId !== undefined) payload.groupId = snapshot.groupId;
    if (snapshot.lineStyle !== undefined) payload.lineStyle = snapshot.lineStyle;
    if (snapshot.lineWidth !== undefined) payload.lineWidth = snapshot.lineWidth;
    if (snapshot.metadata !== undefined) payload.metadata = snapshot.metadata;
    if (snapshot.points !== undefined) payload.points = snapshot.points;
    await apiRequest("PATCH", `/api/takeoff/measurements/${snapshot.id}`, payload);
  };

  const applyMeasurementBatchSnapshots = async (snaps: MeasurementSnapshot[]) => {
    await Promise.all(snaps.map(applyMeasurementSnapshot));
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
      } else if (entry.type === "MARKUP_UPDATE_BATCH" && entry.markupBatchBefore) {
        await applyMarkupBatchSnapshots(entry.markupBatchBefore);
      } else if (entry.type === "MEASUREMENT_UPDATE" && entry.measurementBefore) {
        await applyMeasurementSnapshot(entry.measurementBefore);
      } else if (entry.type === "MEASUREMENT_UPDATE_BATCH" && entry.measurementBatchBefore) {
        await applyMeasurementBatchSnapshots(entry.measurementBatchBefore);
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
      } else if (entry.type === "MARKUP_UPDATE_BATCH" && entry.markupBatchAfter) {
        await applyMarkupBatchSnapshots(entry.markupBatchAfter);
      } else if (entry.type === "MEASUREMENT_UPDATE" && entry.measurementAfter) {
        await applyMeasurementSnapshot(entry.measurementAfter);
      } else if (entry.type === "MEASUREMENT_UPDATE_BATCH" && entry.measurementBatchAfter) {
        await applyMeasurementBatchSnapshots(entry.measurementBatchAfter);
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

  return { pushAction, pushMarkupAction, pushMarkupUpdateAction, pushMarkupUpdateBatchAction, pushMeasurementUpdateAction, pushMeasurementUpdateBatchAction, undo, redo, canUndo, canRedo, isPending, clear };
}
