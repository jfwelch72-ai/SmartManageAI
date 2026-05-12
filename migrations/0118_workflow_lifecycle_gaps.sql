-- Task #2833: Workflow & Lifecycle Gap Remediation
-- Adds: workflow_entity_type SUBMITTAL+WARRANTY_CASE, approval_entity_type INVENTORY_ADJUSTMENT,
--       workflow_stages SLA columns, change_orders overdue columns,
--       inventory_transactions approval columns.

-- 1. Extend workflow_entity_type enum
ALTER TYPE workflow_entity_type ADD VALUE IF NOT EXISTS 'SUBMITTAL';
ALTER TYPE workflow_entity_type ADD VALUE IF NOT EXISTS 'WARRANTY_CASE';

-- 2. Extend approval_entity_type enum
ALTER TYPE approval_entity_type ADD VALUE IF NOT EXISTS 'INVENTORY_ADJUSTMENT';

-- 3. SLA columns on workflow_stages
ALTER TABLE workflow_stages
  ADD COLUMN IF NOT EXISTS sla_duration_hours integer,
  ADD COLUMN IF NOT EXISTS auto_escalate_role text;

-- 4. Change-order overdue sweep columns
ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS required_response_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_overdue_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS change_orders_required_response_date_idx
  ON change_orders (required_response_date)
  WHERE required_response_date IS NOT NULL;

-- 5. Inventory transaction approval columns
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_request_id varchar;

CREATE INDEX IF NOT EXISTS inventory_transactions_approval_status_idx
  ON inventory_transactions (approval_status)
  WHERE approval_status IS NOT NULL;

-- 6. Per-org inventory adjustment approval threshold (dollar value).
--    Supersedes the global INVENTORY_ADJUSTMENT_APPROVAL_VALUE_THRESHOLD env var.
--    Default $500 matches the feature-flag description (task #2833).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS inventory_adjustment_approval_threshold decimal(12,2) NOT NULL DEFAULT 500;

-- 7. Hiring pipeline stage model — per-stage SLA days and notify-on-enter roles.
--    slaDays: idle-threshold (days) for processIdleHiringCandidates sweep;
--             supersedes the static HIRING_STAGE_IDLE_DAYS in-memory map.
--    notifyOnEnterRoles: roles to notify (in-app) when a candidate enters this stage.
ALTER TABLE hiring_pipeline_stages
  ADD COLUMN IF NOT EXISTS sla_days integer,
  ADD COLUMN IF NOT EXISTS notify_on_enter_roles text[];
