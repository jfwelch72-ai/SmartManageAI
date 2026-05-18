-- 0123_ai_action_audit_key_source.sql
-- Task #2948 — Add key_source column to ai_action_audit so every AI call
-- records whether it used the platform-default key or an org-supplied BYOK key.
ALTER TABLE ai_action_audit
  ADD COLUMN IF NOT EXISTS key_source TEXT;

CREATE INDEX IF NOT EXISTS ai_action_audit_key_source_idx ON ai_action_audit (key_source);
