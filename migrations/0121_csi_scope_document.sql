-- Task #2922 — Bid AI Analysis: CSI scope document + standalone takeoff scope fields
--
-- 1. Add scope_document_key to ai_bid_document_analysis for storing generated
--    Scope of Work markdown files in GCS.
-- 2. Add scope columns to standalone_takeoffs so plan-import scope extraction
--    results can be persisted without a separate table.

ALTER TABLE ai_bid_document_analysis
  ADD COLUMN IF NOT EXISTS scope_document_key text;

ALTER TABLE standalone_takeoffs
  ADD COLUMN IF NOT EXISTS scope_document_key text,
  ADD COLUMN IF NOT EXISTS scope_items_json  text,
  ADD COLUMN IF NOT EXISTS scope_analysis_status text;
