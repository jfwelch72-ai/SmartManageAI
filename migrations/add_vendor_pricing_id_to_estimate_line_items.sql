-- Add missing vendor_pricing_id column to estimate_line_items
ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS vendor_pricing_id VARCHAR;
