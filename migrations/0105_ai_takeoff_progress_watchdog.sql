-- Task #2668 — Persist active job id + latest progress snapshot on
-- ai_takeoff_analyses so the AI Auto-Takeoff panel can recover from a
-- hard reload (no jobId in React state) and so polling clients still
-- see an advancing bar when SSE drops or is buffered. The stall
-- watchdog also reads progress_updated_at to decide when a row must
-- be flipped to FAILED.
--
-- Idempotent — safe to replay.

ALTER TABLE ai_takeoff_analyses
  ADD COLUMN IF NOT EXISTS current_job_id text;

ALTER TABLE ai_takeoff_analyses
  ADD COLUMN IF NOT EXISTS progress_pct integer;

ALTER TABLE ai_takeoff_analyses
  ADD COLUMN IF NOT EXISTS progress_message text;

ALTER TABLE ai_takeoff_analyses
  ADD COLUMN IF NOT EXISTS progress_updated_at timestamp;

-- Watchdog scans rows in PENDING / PROCESSING with stale
-- progress_updated_at — index those two columns together so the sweep
-- stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS ai_takeoff_progress_stall_idx
  ON ai_takeoff_analyses (status, progress_updated_at);
