-- Add BIM to measurement_source enum
ALTER TYPE measurement_source ADD VALUE IF NOT EXISTS 'BIM';

-- Create bim_extractions table
CREATE TABLE IF NOT EXISTS bim_extractions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  bid_id VARCHAR REFERENCES bids(id) ON DELETE CASCADE,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  document_id VARCHAR,
  document_name TEXT,
  extracted_data TEXT NOT NULL,
  mappings TEXT,
  imported_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bim_extractions_bid_idx ON bim_extractions(bid_id);
CREATE INDEX IF NOT EXISTS bim_extractions_project_idx ON bim_extractions(project_id);
CREATE INDEX IF NOT EXISTS bim_extractions_document_idx ON bim_extractions(document_id);
