-- Task #705: persist background job metric samples so the rolling
-- window survives server restarts and deploys.

CREATE TABLE IF NOT EXISTS "job_metric_samples" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job" text NOT NULL,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "counters" jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_metric_samples_job_recorded_at_idx"
  ON "job_metric_samples" ("job", "recorded_at");

CREATE INDEX IF NOT EXISTS "job_metric_samples_recorded_at_idx"
  ON "job_metric_samples" ("recorded_at");
