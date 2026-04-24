/**
 * Task #1725 — Pure helpers extracted from `PlanMarkupLayer.tsx` so the
 * server-side integration test for the group-move Undo round-trip can
 * import them under a Node test environment without dragging in
 * `react-konva` (which the rest of `PlanMarkupLayer` transitively pulls
 * in for its drawing surface).
 *
 * Both helpers are re-exported from `PlanMarkupLayer.tsx` for the UI's
 * existing call sites and unit tests.
 */
import type { MarkupShape } from "./MarkupRenderer";

/**
 * Task #1676 — pure helper that builds the bulk-PATCH payload for a
 * group drag. Exported for unit tests so the delta math can be locked
 * down without driving the full Konva stage.
 *
 * @param markups   The current cached markups (after layer filter).
 * @param memberIds Ids of the markups that should move (expandedSelection).
 * @param ndx       Normalized x-delta in [0,1] of canvas width.
 * @param ndy       Normalized y-delta in [0,1] of canvas height.
 */
export function buildBulkMoveUpdates(
  markups: MarkupShape[],
  memberIds: string[],
  ndx: number,
  ndy: number,
): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
  if (ndx === 0 && ndy === 0) return [];
  const out: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  for (const id of memberIds) {
    const m = markups.find((x) => x.id === id);
    if (!m) continue;
    out.push({
      id: m.id,
      points: m.points.map((p) => ({ x: p.x + ndx, y: p.y + ndy })),
    });
  }
  return out;
}

/**
 * Task #1705 — pure helper that captures a snapshot of every moved
 * markup's pre-move points for the bulk-PATCH undo. Run this BEFORE
 * `buildBulkMoveUpdates` is sent to the server so the snapshot reflects
 * the points as they were when the user grabbed the group. Replaying
 * this same array as a bulk-PATCH payload restores the prior layout.
 */
export function buildMoveSnapshot(
  markups: MarkupShape[],
  memberIds: string[],
): Array<{ id: string; points: Array<{ x: number; y: number }> }> {
  const out: Array<{ id: string; points: Array<{ x: number; y: number }> }> = [];
  for (const id of memberIds) {
    const m = markups.find((x) => x.id === id);
    if (!m) continue;
    out.push({
      id: m.id,
      // Defensive copy — callers may mutate the snapshot otherwise.
      points: m.points.map((p) => ({ x: p.x, y: p.y })),
    });
  }
  return out;
}
