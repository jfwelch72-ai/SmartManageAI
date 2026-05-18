/**
 * Task #1725 — Pure helpers extracted from `PlanMarkupLayer.tsx` so the
 * server-side integration test for the group-move Undo round-trip can
 * import them under a Node test environment without dragging in
 * `react-konva` (which the rest of `PlanMarkupLayer` transitively pulls
 * in for its drawing surface).
 *
 * Both helpers are re-exported from `PlanMarkupLayer.tsx` for the UI's
 * existing call sites and unit tests.
 *
 * Pure logic now lives in `shared/markups/` so server-side tests can
 * import it without crossing the client project boundary.
 */
export type { MarkupShape, MarkupTool } from "../../../../shared/markups";
export { buildBulkMoveUpdates, buildMoveSnapshot } from "../../../../shared/markups";
