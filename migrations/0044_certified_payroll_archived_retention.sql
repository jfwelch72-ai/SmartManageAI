-- Task #1178: per-org configurable retention window (days) after which
-- archived certified payroll PDFs are auto-purged by the nightly cleanup
-- job. Default 1095 days (~3 years) matches federal Davis-Bacon record
-- retention. 0 disables auto-purge for the org.
ALTER TABLE "organization_payroll_settings"
  ADD COLUMN IF NOT EXISTS "archived_report_retention_days" integer NOT NULL DEFAULT 1095;
