-- Migration: Change Order Client Portal Comments + Nullable Revision Author
-- Applied: Task #180 - Change Order Client Portal & Financial Visibility

-- Create change_order_comments table for portal comment threads
CREATE TABLE IF NOT EXISTS change_order_comments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id VARCHAR NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_type TEXT NOT NULL DEFAULT 'CLIENT',
  message TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_co_comments_change_order_id ON change_order_comments(change_order_id);

-- Allow null revisedById for portal-initiated revision records
ALTER TABLE change_order_revisions ALTER COLUMN revised_by_id DROP NOT NULL;
