CREATE TABLE IF NOT EXISTS upload_intents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id VARCHAR NOT NULL,
  uploaded_by_id VARCHAR NOT NULL,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS upload_intents_organization_id_idx ON upload_intents (organization_id);
CREATE INDEX IF NOT EXISTS upload_intents_created_at_idx ON upload_intents (created_at);
