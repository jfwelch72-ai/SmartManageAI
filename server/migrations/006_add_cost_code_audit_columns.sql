ALTER TABLE org_cost_codes ADD COLUMN IF NOT EXISTS deactivated_by_id VARCHAR REFERENCES users(id);
ALTER TABLE org_cost_codes ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP;
