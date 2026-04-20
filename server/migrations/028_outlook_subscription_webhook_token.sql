-- Task #548: Harden Outlook webhook against URL leaks
-- Adds a per-subscription rotating webhook token to email_accounts. The
-- token is embedded in the Microsoft Graph notificationUrl as ?token=…
-- so that leaking one subscription's URL exposes only that single
-- mailbox; the value rotates whenever the subscription is recreated.
-- Existing rows stay NULL until the next subscription create/renewal.

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS outlook_subscription_webhook_token TEXT;

-- Index used by the Outlook webhook to look up the account that owns an
-- incoming notification by its per-subscription token.
CREATE INDEX IF NOT EXISTS email_accounts_outlook_webhook_token_idx
  ON email_accounts (outlook_subscription_webhook_token);
