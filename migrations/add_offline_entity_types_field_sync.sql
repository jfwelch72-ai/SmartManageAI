-- Task #865 — Bring fresh databases in sync with the Drizzle schema so the
-- field-sync / mobile-sync tests stop failing on missing enum values.
--
-- Adds the following values to `offline_entity_type` (idempotent):
--   * RFI
--   * INSPECTION
--   * DAILY_REPORT
--   * PUNCH_ITEM
--   * DRAWING_MARKUP
--
-- These were previously hand-applied via ad-hoc `ALTER TYPE` in the test
-- environment after the corresponding values were added to
-- `shared/schema/enums.ts` (`offlineEntityTypeEnum`). Capturing the change
-- here means new contributors and CI environments no longer need to know
-- to apply the fix manually.
--
-- IMPORTANT: This file MUST be safe to run against a *completely empty*
-- database (the test bootstrap may apply it before `drizzle-kit push` has
-- created the baseline schema). The DO block below first checks that the
-- enum type already exists and silently no-ops otherwise — once
-- `drizzle-kit push` creates the type the next run will pick up the new
-- values.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offline_entity_type') THEN
    ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS 'RFI';
    ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS 'INSPECTION';
    ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS 'DAILY_REPORT';
    ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS 'PUNCH_ITEM';
    ALTER TYPE offline_entity_type ADD VALUE IF NOT EXISTS 'DRAWING_MARKUP';
  END IF;
END
$$;
