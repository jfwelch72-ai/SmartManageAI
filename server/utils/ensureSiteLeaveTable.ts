import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureSiteLeaveTable(): Promise<void> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'site_leaves'
    ) AS exists
  `);

  const exists = (result.rows[0] as Record<string, unknown>)?.exists;
  if (exists) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS site_leaves (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      shift_id VARCHAR NOT NULL REFERENCES time_clock_shifts(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id),
      project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      category VARCHAR(30) NOT NULL DEFAULT 'OTHER',
      estimated_return_minutes INTEGER,
      departed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      returned_at TIMESTAMP,
      return_notes TEXT,
      depart_latitude DOUBLE PRECISION,
      depart_longitude DOUBLE PRECISION,
      return_latitude DOUBLE PRECISION,
      return_longitude DOUBLE PRECISION,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS site_leaves_shift_idx ON site_leaves(shift_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS site_leaves_user_idx ON site_leaves(user_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS site_leaves_project_idx ON site_leaves(project_id)`);

  logInfo("[migration] site_leaves table — created");
}
