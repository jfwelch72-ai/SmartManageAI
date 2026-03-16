ALTER TABLE purchase_request_items ADD COLUMN IF NOT EXISTS cost_code text;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS cost_code text;
