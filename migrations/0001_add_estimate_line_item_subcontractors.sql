CREATE TABLE IF NOT EXISTS estimate_line_item_subcontractors (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id varchar NOT NULL REFERENCES estimate_line_items(id) ON DELETE CASCADE,
  subcontractor_quote_id varchar NOT NULL REFERENCES bid_subcontractor_quotes(id) ON DELETE CASCADE,
  allocated_cost decimal(12,2) NOT NULL DEFAULT '0',
  is_selected boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eli_sub_line_item_idx ON estimate_line_item_subcontractors(line_item_id);
CREATE INDEX IF NOT EXISTS eli_sub_quote_idx ON estimate_line_item_subcontractors(subcontractor_quote_id);

DO $$ BEGIN
  ALTER TABLE estimate_line_item_subcontractors
    ADD CONSTRAINT eli_sub_unique_assignment UNIQUE(line_item_id, subcontractor_quote_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
