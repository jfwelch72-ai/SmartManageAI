import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Task #2816 — Support ticket reply thread.
 *
 * Creates the `support_ticket_replies` table (idempotent via IF NOT EXISTS).
 * Mirrors migrations/0117_support_ticket_replies.sql so fresh dev/staging
 * environments converge without a manual psql step.
 */
export async function ensureSupportTicketReplies(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "support_ticket_replies" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      "ticket_id" varchar NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
      "author_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
      "author_name" text,
      "body" text NOT NULL,
      "emailed_at" timestamp,
      "created_at" timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_ticket_replies_ticket_idx"
      ON "support_ticket_replies" ("ticket_id")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "support_ticket_replies_created_idx"
      ON "support_ticket_replies" ("created_at")
  `);
  logInfo("[migration] support_ticket_replies — table ready");
}
