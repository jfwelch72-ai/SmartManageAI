ALTER TABLE media ADD COLUMN IF NOT EXISTS ai_tags text[];
ALTER TABLE media ADD COLUMN IF NOT EXISTS ai_description text;
ALTER TABLE media ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamp;
