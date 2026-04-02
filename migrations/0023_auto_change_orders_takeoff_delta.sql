ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS source text DEFAULT 'MANUAL';
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS takeoff_delta_json text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_change_order_enabled boolean DEFAULT true;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS auto_change_order_threshold numeric(12, 2) DEFAULT 0;

UPDATE change_orders SET source = 'MANUAL' WHERE source IS NULL;
