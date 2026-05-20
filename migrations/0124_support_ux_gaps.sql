-- Task #2961 — Support UX gaps: category, attachments, canned responses, CSAT

-- 1. Category enum
DO $$ BEGIN
  CREATE TYPE support_ticket_category AS ENUM (
    'bids', 'payroll', 'ai_estimator', 'change_orders', 'documents', 'general'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. New columns on support_tickets
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS category support_ticket_category,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS csat_score integer,
  ADD COLUMN IF NOT EXISTS csat_comment text,
  ADD COLUMN IF NOT EXISTS csat_submitted_at timestamp,
  ADD COLUMN IF NOT EXISTS csat_token varchar,
  ADD COLUMN IF NOT EXISTS csat_token_expires_at timestamp;

-- 3. Index on category and csat_token for fast filter/lookup
CREATE INDEX IF NOT EXISTS support_tickets_category_idx ON support_tickets (category);
CREATE INDEX IF NOT EXISTS support_tickets_csat_token_idx ON support_tickets (csat_token);

-- 4. New column on support_ticket_replies
ALTER TABLE support_ticket_replies
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]';

-- 5. Canned responses table
CREATE TABLE IF NOT EXISTS support_canned_responses (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_canned_responses_org_idx ON support_canned_responses (organization_id);
