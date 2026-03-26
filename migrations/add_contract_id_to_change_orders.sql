ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS contract_id VARCHAR REFERENCES contracts(id);
