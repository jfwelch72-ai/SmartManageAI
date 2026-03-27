-- Migration: Bidirectional entity linking for messages/conversations
-- Applied via direct SQL in initial implementation

-- Create enum for entity types
DO $$ BEGIN
  CREATE TYPE message_entity_type AS ENUM ('RFI', 'CHANGE_ORDER', 'TASK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add entity FK columns to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rfi_id VARCHAR REFERENCES rfis(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS change_order_id VARCHAR REFERENCES change_orders(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS task_id VARCHAR REFERENCES tasks(id) ON DELETE SET NULL;

-- Create junction table for message entity links
CREATE TABLE IF NOT EXISTS message_entity_links (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id VARCHAR NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  entity_type message_entity_type NOT NULL,
  entity_id VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  CONSTRAINT message_entity_links_unique UNIQUE (message_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_mel_message_id ON message_entity_links(message_id);
CREATE INDEX IF NOT EXISTS idx_mel_entity ON message_entity_links(entity_type, entity_id);

-- Indexes for entity-scoped conversation lookups
CREATE INDEX IF NOT EXISTS idx_conv_rfi_id ON conversations(rfi_id) WHERE rfi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_change_order_id ON conversations(change_order_id) WHERE change_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_task_id ON conversations(task_id) WHERE task_id IS NOT NULL;
