-- Task #1314: Extend feature_flag_preset_applications to record drift-reset
-- actions (per-flag and bulk) alongside full preset applications, so the
-- Preset history card on the Feature Flags & Trade Presets tab can display
-- "who reset which flags to the preset" inline with full applications.
--
-- `kind` distinguishes 'apply' (existing full preset application rows) from
-- 'reset_drift' (new rows written when an admin resets one or more drifted
-- flags back to the preset value). `flag_keys` lists the affected flag keys
-- for reset rows; it is NULL for full preset applications.
--
-- Backfill semantics: every existing row is a full preset application, so
-- the column default of 'apply' is correct for all historical rows.
-- Idempotent ADD COLUMN IF NOT EXISTS.
ALTER TABLE "feature_flag_preset_applications"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'apply';

ALTER TABLE "feature_flag_preset_applications"
  ADD COLUMN IF NOT EXISTS "flag_keys" text[];
