DO $$ BEGIN
  CREATE TYPE "video_call_status" AS ENUM ('RINGING', 'ACTIVE', 'ENDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "video_calls" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" varchar NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "initiator_id" varchar NOT NULL REFERENCES "users"("id"),
  "status" "video_call_status" NOT NULL DEFAULT 'RINGING',
  "started_at" timestamp NOT NULL DEFAULT now(),
  "ended_at" timestamp
);

CREATE TABLE IF NOT EXISTS "video_call_participants" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" varchar NOT NULL REFERENCES "video_calls"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "joined_at" timestamp NOT NULL DEFAULT now(),
  "left_at" timestamp
);

CREATE TABLE IF NOT EXISTS "video_call_notes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "call_id" varchar NOT NULL REFERENCES "video_calls"("id") ON DELETE CASCADE,
  "author_id" varchar NOT NULL REFERENCES "users"("id"),
  "content" text NOT NULL DEFAULT '',
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "video_calls_conversation_idx" ON "video_calls" USING btree ("conversation_id");
CREATE INDEX IF NOT EXISTS "video_calls_status_idx" ON "video_calls" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "video_calls_unique_active" ON "video_calls" USING btree ("conversation_id") WHERE status IN ('RINGING', 'ACTIVE');
DO $$ BEGIN
  ALTER TABLE "video_call_participants" ADD CONSTRAINT "video_call_participants_unique" UNIQUE ("call_id", "user_id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "video_call_participants_call_idx" ON "video_call_participants" USING btree ("call_id");
CREATE INDEX IF NOT EXISTS "video_call_notes_call_idx" ON "video_call_notes" USING btree ("call_id");
CREATE INDEX IF NOT EXISTS "video_call_notes_author_idx" ON "video_call_notes" USING btree ("author_id");
