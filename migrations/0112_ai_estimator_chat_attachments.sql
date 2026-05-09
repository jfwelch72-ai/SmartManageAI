-- Task: AI Estimator chat attachments — file uploads, voice notes, screenshot paste
-- Adds an `attachments` JSONB column to ai_estimator_chat_messages so a single
-- user turn can carry one or more uploaded artefacts (image / document / audio)
-- alongside its text prompt.
--
-- Stored shape (array of):
--   {
--     kind:        'image' | 'document' | 'audio',
--     objectPath:  '/objects/<id>'  (normalized GCS path returned by /api/objects/confirm),
--     contentType: string,
--     fileName:    string,
--     sizeBytes:   number,
--     transcript?: string,   -- populated for audio (Whisper)
--     extractedText?: string -- populated for documents/images (truncated)
--   }
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Mirrored at boot by
-- ensureAiEstimatorChatAttachmentsColumn.
ALTER TABLE ai_estimator_chat_messages
  ADD COLUMN IF NOT EXISTS attachments JSONB;
