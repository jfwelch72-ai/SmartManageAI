import { pool } from "../db";

export async function ensureErrorLogsTable(): Promise<void> {
  try {
    const { rows } = await pool.query(`
      SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'error_logs') AS exists
    `);
    const alreadyExists = rows[0]?.exists === true;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        level TEXT NOT NULL DEFAULT 'error',
        message TEXT NOT NULL,
        stack TEXT,
        method TEXT,
        path TEXT,
        status_code INTEGER,
        user_id VARCHAR,
        organization_id VARCHAR,
        request_id TEXT,
        user_agent TEXT,
        ip TEXT,
        metadata TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS error_logs_created_at_idx ON error_logs (created_at);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS error_logs_level_idx ON error_logs (level);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS error_logs_user_id_idx ON error_logs (user_id);`);
    console.log(alreadyExists
      ? "[migration] error_logs table — already present, skipped"
      : "[migration] error_logs table — created");
  } catch (err) {
    console.error("[migration] Failed to ensure error_logs table:", err);
  }
}
