-- Task #1260: Let users mute SWPPP overdue alerts independently of the
-- generic REMINDER notification type.
--
-- 1) Add a dedicated `SWPPP_OVERDUE_CORRECTIVE_ACTION` value to the
--    notification_type enum so the nightly SWPPP overdue sweep can
--    classify its fanout under its own type instead of REMINDER.
-- 2) Add an optional `in_app_enabled` column to notification_type_prefs
--    so users can suppress the in-app notification row for a given
--    type (in addition to the existing email/sms/push/teams/slack
--    channel toggles). The column is nullable on purpose: a NULL
--    means "not set" and preserves the historical behavior of always
--    creating the in-app notification row.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SWPPP_OVERDUE_CORRECTIVE_ACTION';

ALTER TABLE notification_type_prefs
  ADD COLUMN IF NOT EXISTS in_app_enabled boolean;
