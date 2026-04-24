-- Task #1528: structured history of admin one-shot job re-runs.
-- Previously the admin "One-shot jobs" panel parsed status / duration /
-- ledgerCleared / errorText out of the free-form `audit_log.new_value`
-- string written by /api/admin/jobs/one-shot/:name/rerun, which silently
-- broke whenever the log message format drifted and could not be
-- filtered or sorted server-side. This dedicated table lets the admin
-- endpoint read structured fields directly. The audit_log row is still
-- written alongside it for the generic compliance trail.
--
-- Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS one_shot_job_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  run_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL,
  ledger_cleared boolean NOT NULL,
  duration_ms integer NOT NULL,
  error_text text,
  started_at timestamp NOT NULL,
  finished_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS one_shot_job_runs_job_started_idx
  ON one_shot_job_runs (job_name, started_at);

CREATE INDEX IF NOT EXISTS one_shot_job_runs_started_at_idx
  ON one_shot_job_runs (started_at);
