ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rfi_id varchar REFERENCES rfis(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS change_order_id varchar REFERENCES change_orders(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_id varchar REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS conversations_rfi_id_idx ON conversations(rfi_id);
CREATE INDEX IF NOT EXISTS conversations_change_order_id_idx ON conversations(change_order_id);
CREATE INDEX IF NOT EXISTS conversations_task_id_idx ON conversations(task_id);

DO $$ BEGIN
  CREATE TYPE message_entity_type AS ENUM ('RFI', 'CHANGE_ORDER', 'TASK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS message_entity_links (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id varchar NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  entity_type message_entity_type NOT NULL,
  entity_id varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_entity_links_message_idx ON message_entity_links(message_id);
CREATE INDEX IF NOT EXISTS message_entity_links_entity_idx ON message_entity_links(entity_type, entity_id);

DO $$ BEGIN
  ALTER TABLE message_entity_links ADD CONSTRAINT message_entity_links_unique UNIQUE (message_id, entity_type, entity_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
