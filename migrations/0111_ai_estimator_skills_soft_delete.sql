-- Task #2703 — AI Estimator Skills: soft-delete column
-- Adds deleted_at to ai_estimator_skills so DELETE becomes a soft stamp
-- rather than a hard removal. NULL = alive, non-NULL = soft-deleted.
-- List/retrieve queries filter WHERE deleted_at IS NULL by default.

ALTER TABLE "ai_estimator_skills"
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
