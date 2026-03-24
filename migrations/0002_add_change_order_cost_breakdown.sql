ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS cost_breakdown_json TEXT;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS overhead_percent NUMERIC(5,2) DEFAULT 10;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS profit_percent NUMERIC(5,2) DEFAULT 5;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS subcontractor_markup_percent NUMERIC(5,2) DEFAULT 5;
