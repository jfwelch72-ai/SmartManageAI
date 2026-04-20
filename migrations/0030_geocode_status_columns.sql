-- Task #590: cache geocode attempt outcomes on projects so the nightly geocoder
-- can back off retries for addresses that previously failed or weren't found.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "last_geocode_attempt_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_geocode_status" text,
  ADD COLUMN IF NOT EXISTS "geocode_attempt_count" integer NOT NULL DEFAULT 0;
