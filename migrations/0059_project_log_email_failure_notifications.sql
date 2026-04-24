-- Task #1637: in-app notification fan-out when a per-project scheduled
-- RFI / submittal log email transitions into FAILURE or NO_RECIPIENTS.
--
-- Task #1622 already stamps the per-attempt status onto each schedule
-- row (see migrations/0058_project_log_email_attempt_tracking.sql) so
-- the project settings panel can render a "Last send failed" badge.
-- That still required an admin to open the project to notice — this
-- migration closes the loop by capturing two pieces of state we need
-- to fan out a one-shot in-app notification:
--
--   * `last_edited_by_id`            - who most recently edited the
--                                      cadence (PUT /api/projects/:projectId/log-email-schedules/:logType).
--                                      Used as one of the notification
--                                      recipients alongside the
--                                      project manager. ON DELETE SET
--                                      NULL so deleting the editing
--                                      user doesn't block the row.
--   * `last_failure_notified_at`     - timestamp of the most recent
--                                      successful failure fan-out.
--                                      Diagnostic-only; the dedupe
--                                      gate uses
--                                      `last_failure_notified_status`.
--   * `last_failure_notified_status` - the failure status the last
--                                      fan-out covered ('FAILURE' or
--                                      'NO_RECIPIENTS'). The cron only
--                                      emits a fresh notification when
--                                      the new attempt's status
--                                      differs from this value, so a
--                                      persistent failure isn't
--                                      re-notified every hourly tick.
--                                      Cleared back to NULL on a
--                                      successful send so the next
--                                      failure starts a brand-new
--                                      notification cycle.
--
-- Companion ALTER TYPE ADD VALUE for the PROJECT_LOG_EMAIL_FAILED
-- notification_type enum value is handled by ensureNotificationEnumValues.
ALTER TABLE project_log_email_schedules
  ADD COLUMN IF NOT EXISTS last_edited_by_id varchar
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_failure_notified_at timestamp,
  ADD COLUMN IF NOT EXISTS last_failure_notified_status text;
