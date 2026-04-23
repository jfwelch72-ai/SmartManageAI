-- Task #1117: allow admins to archive (soft-hide) or hard-delete obsolete
-- certified payroll PDFs from the org-wide history page.
ALTER TABLE "certified_payroll_reports"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp,
  ADD COLUMN IF NOT EXISTS "archived_by_id" varchar REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "archive_reason" text;

CREATE INDEX IF NOT EXISTS "certified_payroll_reports_archived_at_idx"
  ON "certified_payroll_reports" ("archived_at");
