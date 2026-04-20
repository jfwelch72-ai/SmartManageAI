import { db } from "../db";
import { sql } from "drizzle-orm";

export async function ensureGanttPdfRenderSamplesTable(): Promise<void> {
  const tableExists = await db.execute(sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'gantt_pdf_render_samples'
    ) AS exists
  `);
  const exists = (tableExists.rows[0] as { exists: boolean }).exists;

  if (!exists) {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "gantt_pdf_render_samples" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "started_at" timestamp NOT NULL,
        "duration_ms" integer NOT NULL,
        "success" boolean NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "gantt_pdf_render_samples_started_at_idx"
      ON "gantt_pdf_render_samples" ("started_at")
    `);
    console.log("[migration] gantt_pdf_render_samples — table created");
  }
}
