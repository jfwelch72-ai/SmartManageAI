ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rfi_id varchar REFERENCES rfis(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS change_order_id varchar REFERENCES change_orders(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_id varchar REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_rfi_id_idx ON conversations(rfi_id);
CREATE INDEX IF NOT EXISTS conversations_change_order_id_idx ON conversations(change_order_id);
CREATE INDEX IF NOT EXISTS conversations_task_id_idx ON conversations(task_id);
