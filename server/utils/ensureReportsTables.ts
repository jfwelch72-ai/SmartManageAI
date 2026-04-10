import { pool } from "../db";

export async function ensureReportsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_report_type') THEN
          CREATE TYPE project_report_type AS ENUM ('WEEKLY', 'MONTHLY');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_report_status') THEN
          CREATE TYPE project_report_status AS ENUM ('GENERATING', 'COMPLETED', 'FAILED');
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS project_reports (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        report_type project_report_type NOT NULL,
        title TEXT NOT NULL,
        date_range_start DATE NOT NULL,
        date_range_end DATE NOT NULL,
        status project_report_status NOT NULL DEFAULT 'GENERATING',
        generated_by_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
        report_data JSONB,
        pdf_storage_key TEXT,
        email_recipients TEXT[],
        generated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS project_reports_project_id_idx ON project_reports(project_id);
      CREATE INDEX IF NOT EXISTS project_reports_report_type_idx ON project_reports(report_type);
      CREATE INDEX IF NOT EXISTS project_reports_date_range_idx ON project_reports(date_range_start, date_range_end);
    `);
    console.log("[migration] project_reports table ready");
  } finally {
    client.release();
  }
}
