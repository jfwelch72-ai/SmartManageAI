-- Task #922: cache CRM call recordings in object storage instead of streaming
-- from Twilio every time. Adds a nullable storage_key column on
-- crm_call_recordings so the recording proxy can prefer the cached copy and
-- fall back to Twilio when not yet cached.
ALTER TABLE "crm_call_recordings"
  ADD COLUMN IF NOT EXISTS "storage_key" text;
