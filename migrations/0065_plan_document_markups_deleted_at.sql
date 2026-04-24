-- Task #1775: Add a soft-delete column to plan_document_markups so the
-- DELETE handler can stamp `deleted_at` instead of removing the row,
-- letting `POST /api/plan-document-markups/:id/restore` bring the
-- markup back with its original id, layer, group, points, and every
-- other column intact.
--
-- Every read path (LIST, per-layer counts, group/ungroup, bulk-move,
-- carryover-on-revision, copy-to-sheet) filters `deleted_at IS NULL`,
-- so soft-deleted rows stay invisible to all live surfaces until the
-- restore endpoint clears the column. The bulk
-- `/markups/restore` route also clears `deleted_at` on conflict so the
-- existing client-side undo cache (Task #1737) keeps working after the
-- DELETE handler switches to soft-delete.
ALTER TABLE "plan_document_markups"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
