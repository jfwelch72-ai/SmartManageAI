-- Task #51: Add SMS phone number and Teams/Slack webhook URL columns to notification_channel_prefs
ALTER TABLE notification_channel_prefs
  ADD COLUMN IF NOT EXISTS sms_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS teams_webhook_url TEXT,
  ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;
