-- Migration: support_ticket_replies
-- Adds a replies thread to support tickets so super admins can reply
-- directly from the admin panel. The firstResponseAt timestamp on the
-- parent ticket is stamped by the server on the first reply.

CREATE TABLE IF NOT EXISTS "support_ticket_replies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticket_id" varchar NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "author_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "author_name" text,
  "body" text NOT NULL,
  "emailed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "support_ticket_replies_ticket_idx"
  ON "support_ticket_replies" ("ticket_id");

CREATE INDEX IF NOT EXISTS "support_ticket_replies_created_idx"
  ON "support_ticket_replies" ("created_at");
