/**
 * Task #1757 — Pure-function commit helpers for the markup body-drag and
 * resize-handle drag handlers in `TakeoffWorkspace`.
 *
 * The original handlers were inline event callbacks that:
 *   1. Reset Konva node positions on drag-end (UI plumbing).
 *   2. Persisted the new points and routed the change through
 *      `useTakeoffHistory` so sidebar Undo / Cmd+Z can reverse them
 *      (see #1742, #1754, #1755).
 *
 * Step (2) is the part that has silently regressed before — every time a
 * caller forgot the `previous` payload, history skipped the gesture
 * altogether. Pulling it out into a pure helper means we can unit-test
 * the contract directly without standing up the full Konva stage.
 *
 * Multi-select body drags were further consolidated by Task #1752: instead
 * of fanning out N parallel `updateMarkupMutation.mutate` calls (each its
 * own HTTP round-trip + cache invalidation), they now commit through a
 * single `bulkUpdateMarkupsMutation` that issues one PATCH and one
 * invalidation.
 *
 * Task #1759 then closed a phantom-Undo bug in that path: the old code
 * pushed the `MARKUP_UPDATE_BATCH` history entry up front, which left an
 * Undo entry on the stack even when the bulk PATCH ultimately failed
 * (the mutation's `onError` rolled the cache back, but the history entry
 * stayed and Redo would silently re-fire the failed payload). The helper
 * now defers the history push until `mutateAsync` resolves successfully;
 * on rejection it stays silent (the mutation's `onError` already toasts
 * and rolls back).
 */

export type Point = { x: number; y: number };

export type MarkupUpdatePrevious = {
  color?: string;
  thickness?: number;
  text?: string | null;
  points?: Point[];
};

export type MarkupUpdatePayload = {
  id: string;
  color?: string;
  thickness?: number;
  text?: string | null;
  points?: Point[];
  previous?: MarkupUpdatePrevious;
  skipHistory?: boolean;
};

/**
 * Minimal slice of `updateMarkupMutation` that the commit helpers depend
 * on. Defining it locally (rather than importing the full
 * `UseMutationResult`) keeps the helpers — and the tests around them —
 * decoupled from React Query internals.
 */
export interface UpdateMarkupMutationLike {
  mutate: (data: MarkupUpdatePayload) => void;
  mutateAsync: (data: MarkupUpdatePayload) => Promise<unknown>;
}

export type BulkMarkupUpdatePayload = {
  updates: { id: string; points: Point[] }[];
};

/**
 * Minimal slice of `bulkUpdateMarkupsMutation` (Task #1752 / #1759). The
 * bulk mutation collapses an N-member multi-select drag into one PATCH
 * and one cache invalidation. The helper uses `mutateAsync` so that the
 * caller can await success before pushing the corresponding
 * `MARKUP_UPDATE_BATCH` history entry (see #1759).
 */
export interface BulkUpdateMarkupsMutationLike {
  mutateAsync: (data: BulkMarkupUpdatePayload) => Promise<unknown>;
}

export type MarkupSnapshotForBatch = { id: string; points?: Point[] };

/**
 * Minimal slice of `useTakeoffHistory` that the body-drag helper needs.
 * Only `pushMarkupUpdateBatchAction` is invoked from inside the helper —
 * single-drag history is recorded by `updateMarkupMutation.onSuccess`
 * itself when `previous` is provided.
 */
export interface MarkupHistoryLike {
  pushMarkupUpdateBatchAction: (
    before: MarkupSnapshotForBatch[],
    after: MarkupSnapshotForBatch[],
    sheetId: string,
  ) => void;
}

export type MarkupForSiblingLookup = {
  id: string;
  points: Point[] | string;
};

export interface CommitMarkupBodyDragArgs {
  markup: { id: string };
  rawPts: Point[];
  dx: number;
  dy: number;
  siblingIds: string[];
  markups: MarkupForSiblingLookup[];
  selectedSheet: string | null;
  updateMarkupMutation: UpdateMarkupMutationLike;
  bulkUpdateMarkupsMutation: BulkUpdateMarkupsMutationLike;
  takeoffHistory: MarkupHistoryLike;
}

/**
 * Commit a markup body-drag gesture.
 *
 * Single-markup branch (no siblings):
 *   - Fires one `updateMarkupMutation.mutate` with `previous: { points }`
 *     so `updateMarkupMutation.onSuccess` records exactly one
 *     `MARKUP_UPDATE` history entry (#1742).
 *
 * Multi-select branch (≥1 sibling):
 *   - Fires ONE `bulkUpdateMarkupsMutation.mutateAsync` (#1752) carrying
 *     the full updates array — replaces the legacy N-parallel-PATCH
 *     path.
 *   - Pushes a single `MARKUP_UPDATE_BATCH` history entry ONLY AFTER the
 *     bulk PATCH resolves (#1759). On rejection the bulk mutation's
 *     `onError` rolls the optimistic cache back and surfaces a toast;
 *     the helper deliberately skips the history push so a failed group
 *     never leaves a phantom Undo entry on the stack.
 *
 * Returns a Promise so callers and tests can observe completion. Konva
 * `onDragEnd` callers ignore the return value (fire-and-forget). No-op
 * when the drag delta is zero.
 */
export async function commitMarkupBodyDrag(
  args: CommitMarkupBodyDragArgs,
): Promise<void> {
  const {
    markup,
    rawPts,
    dx,
    dy,
    siblingIds,
    markups,
    selectedSheet,
    updateMarkupMutation,
    bulkUpdateMarkupsMutation,
    takeoffHistory,
  } = args;
  if (dx === 0 && dy === 0) return;
  const newPts = rawPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));

  if (siblingIds.length === 0) {
    updateMarkupMutation.mutate({
      id: markup.id,
      points: newPts,
      previous: { points: rawPts },
    });
    return;
  }

  const beforeSnaps: MarkupSnapshotForBatch[] = [{ id: markup.id, points: rawPts }];
  const afterSnaps: MarkupSnapshotForBatch[] = [{ id: markup.id, points: newPts }];
  const bulkUpdates: { id: string; points: Point[] }[] = [
    { id: markup.id, points: newPts },
  ];

  for (const id of siblingIds) {
    const m = markups.find((x) => x.id === id);
    if (!m) continue;
    const sPts = (typeof m.points === "string"
      ? (JSON.parse(m.points) as Point[])
      : m.points) as Point[];
    if (!sPts || sPts.length === 0) continue;
    const sNewPts = sPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    beforeSnaps.push({ id, points: sPts });
    afterSnaps.push({ id, points: sNewPts });
    bulkUpdates.push({ id, points: sNewPts });
  }

  // Capture the sheet id before the await so a sheet switch mid-gesture
  // doesn't push the batch into the wrong sheet's history.
  const sheetIdForBatch = selectedSheet;
  try {
    await bulkUpdateMarkupsMutation.mutateAsync({ updates: bulkUpdates });
  } catch {
    // Bulk mutation's onError handles cache rollback + the user-visible
    // toast. Skipping the history push (Task #1759) prevents a phantom
    // MARKUP_UPDATE_BATCH from claiming a move that never happened.
    return;
  }
  if (sheetIdForBatch) {
    takeoffHistory.pushMarkupUpdateBatchAction(beforeSnaps, afterSnaps, sheetIdForBatch);
  }
}

export interface CommitMarkupResizeArgs {
  markupId: string;
  newPts: Point[];
  /**
   * Pre-resize points captured at drag-start. When defined, the PATCH
   * forwards them as `previous: { points }` so
   * `updateMarkupMutation.onSuccess` records a `MARKUP_UPDATE` entry —
   * this is what lets sidebar Undo / Cmd+Z reverse the resize (#1754).
   * The arrow-endpoint handler may legitimately omit this if the
   * pre-resize ref was already cleared, in which case the PATCH still
   * lands but no history entry is recorded.
   */
  origPts?: Point[];
  updateMarkupMutation: UpdateMarkupMutationLike;
}

/**
 * Commit a markup resize-handle drag gesture (arrow endpoint or
 * bounding-box corner). Errors from the PATCH are swallowed because the
 * mutation's `onError` already rolls the optimistic cache back to the
 * pre-resize points.
 */
export async function commitMarkupResize(args: CommitMarkupResizeArgs): Promise<void> {
  const { markupId, newPts, origPts, updateMarkupMutation } = args;
  try {
    await updateMarkupMutation.mutateAsync({
      id: markupId,
      points: newPts,
      ...(origPts ? { previous: { points: origPts } } : {}),
    });
  } catch {
    // onError handles cache rollback + the user-visible toast.
  }
}
