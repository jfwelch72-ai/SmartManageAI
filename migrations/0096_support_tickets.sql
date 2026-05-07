-- Task #2489 — Customer support, in-app help & SLA operationalization.
--
-- Creates the support ticket pipeline backing /api/support/tickets and the
-- in-app help widget. Each ticket carries the org/user context, the page the
-- user filed it from, the resolved billing tier, and computed SLA due-times
-- so the weekly report and proactive alerts can compare against `now()`.
--
-- Idempotent: safe to replay against a DB where the boot-time
-- reconcileSchemaDrift already created the enums/table from the Drizzle
-- schema. All operations use IF NOT EXISTS / DO blocks.

DO $$ BEGIN
  CREATE TYPE support_ticket_tier AS ENUM ('starter', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE support_ticket_status AS ENUM (
    'open',
    'in_progress',
    'waiting_on_customer',
    'resolved',
    'closed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS support_tickets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id varchar REFERENCES organizations(id) ON DELETE SET NULL,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  submitter_email text NOT NULL,
  submitter_name text,
  subject text NOT NULL,
  body text NOT NULL,
  route text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier support_ticket_tier NOT NULL DEFAULT 'starter',
  priority support_ticket_priority NOT NULL DEFAULT 'normal',
  status support_ticket_status NOT NULL DEFAULT 'open',
  assigned_to varchar REFERENCES users(id) ON DELETE SET NULL,
  sla_first_response_due_at timestamp,
  sla_resolution_due_at timestamp,
  sla_first_response_breached integer NOT NULL DEFAULT 0,
  sla_resolution_breached integer NOT NULL DEFAULT 0,
  first_response_at timestamp,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Hot paths: admin queue (org + status), KPI metrics window, and SLA sweep.
CREATE INDEX IF NOT EXISTS support_tickets_org_idx
  ON support_tickets (organization_id);

CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets (status);

CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx
  ON support_tickets (created_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_sla_first_resp_open_idx
  ON support_tickets (sla_first_response_due_at)
  WHERE first_response_at IS NULL AND sla_first_response_breached = 0;

CREATE INDEX IF NOT EXISTS support_tickets_sla_resolution_open_idx
  ON support_tickets (sla_resolution_due_at)
  WHERE resolved_at IS NULL AND sla_resolution_breached = 0;
