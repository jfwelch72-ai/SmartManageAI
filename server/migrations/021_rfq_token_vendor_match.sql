ALTER TABLE bid_subcontractor_quotes ADD COLUMN IF NOT EXISTS rfq_response_token TEXT;
ALTER TABLE bid_subcontractor_quotes ADD COLUMN IF NOT EXISTS rfq_response_attachments_json TEXT;
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS vendor_pricing_id VARCHAR;
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS vendor_match_confidence TEXT;
ALTER TABLE bids ADD COLUMN IF NOT EXISTS crm_opportunity_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_bid_sub_quotes_rfq_token ON bid_subcontractor_quotes (rfq_response_token) WHERE rfq_response_token IS NOT NULL;
