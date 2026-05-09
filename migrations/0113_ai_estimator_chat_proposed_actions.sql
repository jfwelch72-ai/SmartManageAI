-- Task #2729 — Add proposed_actions jsonb column to ai_estimator_chat_messages.
-- Stores the Claude tool-use proposals returned from the chat turn so they
-- can be rendered as interactive Accept/Reject cards after a page refresh.
ALTER TABLE ai_estimator_chat_messages
  ADD COLUMN IF NOT EXISTS proposed_actions jsonb;
