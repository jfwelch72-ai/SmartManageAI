-- Task #1622: surface scheduled log email failures in the project
-- settings panel. The cron used to log a server-side error and move on
-- when SendGrid bounced or every recipient was suppressed; admins had
-- no in-app signal until someone complained. We now stamp the outcome
-- of every attempt onto the schedule row so the UI can render a
-- "Last send failed" badge with the reason.
--
-- Columns:
--   * last_attempt_at            - timestamp of the most recent attempt
--                                  (success, failure, or no-recipients).
--                                  Distinct from `last_sent_at`, which
--                                  is still only stamped on success so
--                                  the existing dedupe windows continue
--                                  to work unchanged.
--   * last_attempt_status        - 'SUCCESS' | 'FAILURE' | 'NO_RECIPIENTS'.
--   * last_attempt_error         - human-readable reason on FAILURE
--                                  (provider error message) or a hint
--                                  on NO_RECIPIENTS. NULL on SUCCESS.
--   * last_attempt_recipient_count - how many addresses we tried to
--                                  send to during the most recent
--                                  attempt. Helps admins distinguish
--                                  "12 sent" from "0 sent because the
--                                  list was empty".
ALTER TABLE project_log_email_schedules
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS last_attempt_status text,
  ADD COLUMN IF NOT EXISTS last_attempt_error text,
  ADD COLUMN IF NOT EXISTS last_attempt_recipient_count integer;
