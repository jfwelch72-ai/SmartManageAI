-- Allow generated_by_id to be NULL so the backfill script can insert rows
-- for legacy certified payroll PDFs whose original generator user is unknown.
ALTER TABLE "certified_payroll_reports" ALTER COLUMN "generated_by_id" DROP NOT NULL;
