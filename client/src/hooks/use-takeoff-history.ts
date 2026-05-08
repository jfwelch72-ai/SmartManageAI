import { useRef, useCallback, useState } from "react";
import type { TakeoffMeasurement, TakeoffMarkup } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";

type ActionType = "CREATE" | "DELETE" | "UPDATE" | "MEASUREMENT_UPDATE" | "MEASUREMENT_UPDATE_BATCH" | "MEASUREMENT_DELETE_BATCH" | "MARKUP_CREATE" | "MARKUP_DELETE" | "MARKUP_DELETE_BATCH" | "MARKUP_UPDATE" | "MARKUP_UPDATE_BATCH";

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
  // Task #2653 — Optimistic-concurrency token captured at the
  // moment the action was committed. Sent as `expectedVersion` on
  // the replay PATCH so undo/redo refuses to overwrite a teammate's
  // edit landed in between (CAS, mirrors the per-id PATCH path
  // from Task #2629). Optional so legacy callers / older snapshots
  // continue to land on last-write-wins.
  version?: number;
}

// Task #2653 — Surface a measurement-version conflict that came
// out of an undo/redo replay (single or batch). Mirrors the 409
// shape the per-id PATCH already uses so the consumer can re-use
// the same conflict dialog.
export interface MeasurementHistoryConflict {
  measurementId: string;
  expectedVersion: number | null;
  currentVersion: number | null;
  current?: TakeoffMeasurement | null;
  replay: "undo" | "redo";
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
  // Task #1860 — full-row snapshots of every markup removed by a
  // bulk DELETE. Used by `MARKUP_DELETE_BATCH` so a single Undo press
  // can POST `/api/takeoff/markups/restore-bulk` with the original
  // ids / authorship / sheet preserved (and a single Redo press can
  // re-issue the same bulk DELETE that produced them).
  markupBatch?: Array<TakeoffMarkup & { points: { x: number; y: number }[] }>;
  // Task #1901 — full-row snapshots of every measurement removed by a
  // bulk DELETE. Used by `MEASUREMENT_DELETE_BATCH` so a single Undo
  // press recreates the whole selection. The measurements API has no
  // bulk DELETE / bulk-restore endpoint today (unlike #1860's markup
  // bulk endpoints), so undo/redo fan the work out per-id via
  // Promise.all to mirror the existing per-id `DELETE` entry path.
  // Restored measurements receive new ids on undo; the restored row
  // objects are stored back on the entry so the redo branch can target
  // those new ids.
  measurementBatch?: TakeoffMeasurement[];
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
    pitchRatio: m.pitchRatio ? String(m.pitchRatio) : undefined,
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

export interface UseTakeoffHistoryOptions {
  // Task #2653 — Invoked when an undo/redo replay PATCH against the
  // measurements API hits a 409 (`reason === "version_conflict"`).
  // The entry is pushed back onto its origin stack before the
  // callback fires so the user can re-attempt the gesture after
  // resolving the conflict (mirrors the per-id PATCH dialog path).
  onMeasurementConflict?: (conflict: MeasurementHistoryConflict) => void;
}

export function useTakeoffHistory(
  selectedSheet: string | null,
  options: UseTakeoffHistoryOptions = {},
) {
  const onMeasurementConflict = options.onMeasurementConflict;
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

  // Task #1860 — Coalesce a bulk DELETE of N markups into a single
  // history entry so one Undo press restores the whole selection in
  // one server round-trip (POST /api/takeoff/markups/restore-bulk),
  // preserving the original ids / authorship / sheet. Without this,
  // the bulk DELETE pushed one MARKUP_DELETE entry per row and Undo
  // fanned out N parallel POSTs to the per-id create route — the
  // exact N-roundtrip problem the bulk DELETE itself was meant to
  // solve. Empty arrays are no-ops so callers don't have to guard.
  const pushMarkupDeleteBatchAction = useCallback((
    markups: Array<TakeoffMarkup & { points: { x: number; y: number }[] }>,
    sheetId: string,
  ) => {
    if (markups.length === 0) return;
    undoStack.current.push({ type: "MARKUP_DELETE_BATCH", markupBatch: markups, sheetId });
    redoStack.current = [];
    updateFlags();
  }, [updateFlags]);

  // Task #1901 — Coalesce a bulk DELETE of N measurements into a
  // single history entry so one Undo press recreates the whole
  // selection. Mirrors `pushMarkupDeleteBatchAction` (#1860) but the
  // measurements API has no bulk DELETE / bulk-restore endpoint, so
  // the undo/redo branches fan the work out per-id (one POST per
  // restored row, one DELETE per re-deleted row) — same shape as the
  // existing per-id `DELETE` entry path. Empty arrays are no-ops so
  // callers don't have to guard.
  const pushMeasurementDeleteBatchAction = useCallback((
    measurements: TakeoffMeasurement[],
    sheetId: string,
  ) => {
    if (measurements.length === 0) return;
    undoStack.current.push({ type: "MEASUREMENT_DELETE_BATCH", measurementBatch: measurements, sheetId });
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
  const applyMeasurementSnapshot = async (
    snapshot: MeasurementSnapshot,
  ): Promise<{ id: string; version?: number } | null> => {
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
    // Task #2653 — Replay PATCH carries the version captured at
    // action-commit time so the server's CAS refuses to clobber a
    // teammate's interleaving edit.
    if (snapshot.version !== undefined) payload.expectedVersion = snapshot.version;
    const res = await apiRequest("PATCH", `/api/takeoff/measurements/${snapshot.id}`, payload);
    try {
      const body = await res.json();
      return { id: body?.id ?? snapshot.id, version: body?.version };
    } catch {
      return null;
    }
  };

  const applyMeasurementBatchSnapshots = async (
    snaps: MeasurementSnapshot[],
  ): Promise<Array<{ id: string; version?: number }>> => {
    // Task #2653 — Use the bulk PATCH endpoint when every snapshot
    // carries fields the bulk schema accepts. The bulk endpoint
    // applies all rows in one transaction and surfaces a single
    // 409 with per-row conflicts, matching the per-id semantics.
    // Fields outside the bulk schema (`points`) force the per-id
    // fallback so existing replay shapes keep working.
    const bulkSafe = (s: MeasurementSnapshot) => s.points === undefined;
    if (snaps.length > 0 && snaps.every(bulkSafe)) {
      const updates = snaps
        .map((s) => {
          const u: Record<string, unknown> = { id: s.id };
          if (s.label !== undefined) u.label = s.label;
          if (s.categoryId !== undefined) u.categoryId = s.categoryId;
          if (s.costCodeId !== undefined) u.costCodeId = s.costCodeId;
          if (s.unitCost !== undefined) {
            u.unitCost = s.unitCost === null ? null : Number(s.unitCost);
          }
          if (s.groupId !== undefined) u.groupId = s.groupId;
          if (s.lineStyle !== undefined) u.lineStyle = s.lineStyle;
          if (s.lineWidth !== undefined) u.lineWidth = s.lineWidth;
          if (s.metadata !== undefined) u.metadata = s.metadata;
          if (s.color !== undefined && s.color !== null) u.color = s.color;
          if (s.version !== undefined) u.expectedVersion = s.version;
          return u;
        })
        // Drop entries that reduced to id-only — the bulk schema's
        // `.refine` rejects rows with no field changes (matches the
        // commit-side filter in `handleBulkCategoryAssign`).
        .filter((u) => Object.keys(u).length > 1);
      if (updates.length === 0) return [];
      const res = await apiRequest("PATCH", "/api/takeoff/measurements/bulk", { updates });
      try {
        const body = await res.json();
        const rows: any[] = Array.isArray(body) ? body : (body?.measurements ?? []);
        return rows.map((r) => ({ id: r.id, version: r.version }));
      } catch {
        return [];
      }
    }
    const results = await Promise.all(snaps.map(applyMeasurementSnapshot));
    return results.filter((r): r is { id: string; version?: number } => !!r);
  };

  // Task #2653 — Inspect a thrown apiRequest error and, if it looks
  // like a measurement version_conflict (per-id 409 or bulk 409),
  // surface it through the consumer-supplied callback.
  const surfaceMeasurementConflict = (
    err: unknown,
    replay: "undo" | "redo",
  ): boolean => {
    if (!onMeasurementConflict) return false;
    const e = err as { status?: number; data?: any } | undefined;
    if (!e || e.status !== 409 || !e.data) return false;
    const data = e.data;
    if (data.reason === "version_conflict") {
      // Per-id PATCH shape: { reason, currentVersion, current, expectedVersion? }
      if (Array.isArray(data.conflicts)) {
        for (const c of data.conflicts) {
          onMeasurementConflict({
            measurementId: c.id,
            expectedVersion: c.expectedVersion ?? null,
            currentVersion: c.currentVersion ?? null,
            current: c.current ?? null,
            replay,
          });
        }
      } else {
        onMeasurementConflict({
          measurementId: data.id ?? data.current?.id ?? "",
          expectedVersion: data.expectedVersion ?? null,
          currentVersion: data.currentVersion ?? null,
          current: data.current ?? null,
          replay,
        });
      }
      return true;
    }
    return false;
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
      } else if (entry.type === "MARKUP_DELETE_BATCH" && entry.markupBatch) {
        // Task #1860 — Single round-trip restore. The server preserves
        // the original id / authorship / sheet of each row, so the
        // companion redo branch can target the same ids without any
        // client-side mapping of "old id → new id".
        const payload = {
          markups: entry.markupBatch.map((m) => ({
            id: m.id,
            sheetId: m.sheetId,
            organizationId: m.organizationId,
            createdBy: m.createdBy,
            tool: m.tool,
            points: typeof m.points === "string" ? JSON.parse(m.points as any) : m.points,
            color: m.color,
            thickness: m.thickness,
            text: (m as any).text ?? null,
            categoryId: (m as any).categoryId ?? null,
          })),
        };
        await apiRequest("POST", "/api/takeoff/markups/restore-bulk", payload);
      } else if (entry.type === "MARKUP_UPDATE" && entry.markupBefore) {
        await applyMarkupSnapshot(entry.markupBefore);
      } else if (entry.type === "MARKUP_UPDATE_BATCH" && entry.markupBatchBefore) {
        await applyMarkupBatchSnapshots(entry.markupBatchBefore);
      } else if (entry.type === "MEASUREMENT_UPDATE" && entry.measurementBefore) {
        // Task #2653 — Roll the server's new `version` forward onto
        // the opposite snapshot so a follow-up Redo (or repeated
        // Undo→Redo cycle) sends the freshly-bumped expectedVersion
        // and doesn't false-conflict against itself.
        const result = await applyMeasurementSnapshot(entry.measurementBefore);
        if (result?.version !== undefined && entry.measurementAfter) {
          entry.measurementAfter = { ...entry.measurementAfter, version: result.version };
        }
      } else if (entry.type === "MEASUREMENT_UPDATE_BATCH" && entry.measurementBatchBefore) {
        const results = await applyMeasurementBatchSnapshots(entry.measurementBatchBefore);
        if (results.length > 0 && entry.measurementBatchAfter) {
          const versionById = new Map(results.map((r) => [r.id, r.version]));
          entry.measurementBatchAfter = entry.measurementBatchAfter.map((s) =>
            versionById.has(s.id) ? { ...s, version: versionById.get(s.id) } : s,
          );
        }
      } else if (entry.type === "MEASUREMENT_DELETE_BATCH" && entry.measurementBatch) {
        // Task #1901 — Recreate every removed measurement. The
        // measurements API has no bulk-restore counterpart to
        // /api/takeoff/markups/restore-bulk, so we fan out per-id
        // POSTs via Promise.all (matching the per-id `DELETE` undo
        // path). Each POST returns a fresh row; we store those back
        // on the entry so the redo branch can DELETE the new ids.
        const restored = await Promise.all(
          entry.measurementBatch.map(async (m) => {
            const payload = buildCreatePayload(m, entry.sheetId);
            const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
            return res.json() as Promise<TakeoffMeasurement>;
          }),
        );
        entry.measurementBatch = restored;
      }
      redoStack.current.push(entry);
      invalidate(entry.sheetId, entry.type.startsWith("MARKUP"));
    } catch (err) {
      undoStack.current.push(entry);
      // Task #2653 — Surface measurement version_conflict 409s out
      // of undo replays so the consumer can show the same conflict
      // dialog it uses for the per-id PATCH path. The entry has
      // already been pushed back so a retry-after-resolve gesture
      // works without losing history depth.
      if (
        entry.type === "MEASUREMENT_UPDATE" ||
        entry.type === "MEASUREMENT_UPDATE_BATCH"
      ) {
        surfaceMeasurementConflict(err, "undo");
      }
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
      } else if (entry.type === "MARKUP_DELETE_BATCH" && entry.markupBatch) {
        // Task #1860 — Redo replays the original bulk DELETE in a
        // single round-trip. The Undo branch restored every row with
        // its original id, so the same id list still applies.
        const ids = entry.markupBatch.map((m) => m.id);
        await apiRequest("DELETE", "/api/takeoff/markups/bulk", { ids });
      } else if (entry.type === "MARKUP_UPDATE" && entry.markupAfter) {
        await applyMarkupSnapshot(entry.markupAfter);
      } else if (entry.type === "MARKUP_UPDATE_BATCH" && entry.markupBatchAfter) {
        await applyMarkupBatchSnapshots(entry.markupBatchAfter);
      } else if (entry.type === "MEASUREMENT_UPDATE" && entry.measurementAfter) {
        // Task #2653 — Stamp the post-redo `version` onto the
        // before-snapshot so the next Undo presses the freshly
        // bumped expectedVersion through the CAS.
        const result = await applyMeasurementSnapshot(entry.measurementAfter);
        if (result?.version !== undefined && entry.measurementBefore) {
          entry.measurementBefore = { ...entry.measurementBefore, version: result.version };
        }
      } else if (entry.type === "MEASUREMENT_UPDATE_BATCH" && entry.measurementBatchAfter) {
        const results = await applyMeasurementBatchSnapshots(entry.measurementBatchAfter);
        if (results.length > 0 && entry.measurementBatchBefore) {
          const versionById = new Map(results.map((r) => [r.id, r.version]));
          entry.measurementBatchBefore = entry.measurementBatchBefore.map((s) =>
            versionById.has(s.id) ? { ...s, version: versionById.get(s.id) } : s,
          );
        }
      } else if (entry.type === "MEASUREMENT_DELETE_BATCH" && entry.measurementBatch) {
        // Task #1901 — Re-issue the bulk delete by fanning out per-id
        // DELETEs against the (post-undo) ids stored on the entry.
        await Promise.all(
          entry.measurementBatch.map((m) =>
            apiRequest("DELETE", `/api/takeoff/measurements/${m.id}`),
          ),
        );
      }
      undoStack.current.push(entry);
      invalidate(entry.sheetId, entry.type.startsWith("MARKUP"));
    } catch (err) {
      redoStack.current.push(entry);
      // Task #2653 — Mirror the undo branch: surface measurement
      // version_conflict 409s out of redo replays so the consumer
      // can show the same conflict dialog.
      if (
        entry.type === "MEASUREMENT_UPDATE" ||
        entry.type === "MEASUREMENT_UPDATE_BATCH"
      ) {
        surfaceMeasurementConflict(err, "redo");
      }
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

  return { pushAction, pushMarkupAction, pushMarkupDeleteBatchAction, pushMarkupUpdateAction, pushMarkupUpdateBatchAction, pushMeasurementUpdateAction, pushMeasurementUpdateBatchAction, pushMeasurementDeleteBatchAction, undo, redo, canUndo, canRedo, isPending, clear };
}
