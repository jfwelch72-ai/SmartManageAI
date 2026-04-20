-- Task #524: Real-time email push notifications
-- Adds columns to email_accounts to track Gmail watch + Outlook Graph
-- subscription state for push-based incremental sync.

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS gmail_watch_expiration TIMESTAMP,
  ADD COLUMN IF NOT EXISTS gmail_watch_history_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_expiration TIMESTAMP,
  ADD COLUMN IF NOT EXISTS outlook_subscription_client_state TEXT;

-- Index used by the Outlook webhook to look up the account that owns an
-- incoming subscription notification.
CREATE INDEX IF NOT EXISTS email_accounts_outlook_sub_idx
  ON email_accounts (outlook_subscription_id);
