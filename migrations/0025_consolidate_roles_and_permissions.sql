-- Migration: Consolidate 18 roles → 8 roles and expand dashboard permissions to 73 flags
-- Maps: OFFICE_MANAGER/HR_MANAGER/SALES/MARKETING/PROCUREMENT_MANAGER → MANAGER
--       SAFETY_MANAGER/DISPATCHER → SUPERINTENDENT
--       PROJECT_ENGINEER → ESTIMATOR
--       MAINTENANCE_MANAGER/EQUIPMENT_MANAGER/HOURLY_EMPLOYEE → FIELD_WORKER

-- ============================================================
-- STEP 0a: Add FIELD_WORKER to existing enum (must be outside transaction)
-- MANAGER, SUPERINTENDENT, ESTIMATOR already exist in the 18-role enum.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'FIELD_WORKER' AND enumtypid = 'user_role'::regtype) THEN
    ALTER TYPE user_role ADD VALUE 'FIELD_WORKER';
  END IF;
END $$;

BEGIN;

-- ============================================================
-- STEP 0b: Capture legacy roles before mutation
-- ============================================================
CREATE TEMP TABLE _legacy_role_map AS
SELECT id, role::text AS old_role
FROM users
WHERE role::text IN (
  'OFFICE_MANAGER', 'HR_MANAGER', 'SALES', 'MARKETING', 'PROCUREMENT_MANAGER',
  'SAFETY_MANAGER', 'DISPATCHER',
  'PROJECT_ENGINEER',
  'MAINTENANCE_MANAGER', 'EQUIPMENT_MANAGER', 'HOURLY_EMPLOYEE'
);

-- ============================================================
-- STEP 1b: Migrate existing user rows to new role values
-- ============================================================
UPDATE users SET role = 'MANAGER' WHERE role IN ('OFFICE_MANAGER', 'HR_MANAGER', 'SALES', 'MARKETING', 'PROCUREMENT_MANAGER');
UPDATE users SET role = 'SUPERINTENDENT' WHERE role IN ('SAFETY_MANAGER', 'DISPATCHER');
UPDATE users SET role = 'ESTIMATOR' WHERE role = 'PROJECT_ENGINEER';
UPDATE users SET role = 'FIELD_WORKER' WHERE role IN ('MAINTENANCE_MANAGER', 'EQUIPMENT_MANAGER', 'HOURLY_EMPLOYEE');

UPDATE hustler_organizations SET role_override = 'MANAGER' WHERE role_override IN ('OFFICE_MANAGER', 'HR_MANAGER', 'SALES', 'MARKETING', 'PROCUREMENT_MANAGER');
UPDATE hustler_organizations SET role_override = 'SUPERINTENDENT' WHERE role_override IN ('SAFETY_MANAGER', 'DISPATCHER');
UPDATE hustler_organizations SET role_override = 'ESTIMATOR' WHERE role_override = 'PROJECT_ENGINEER';
UPDATE hustler_organizations SET role_override = 'FIELD_WORKER' WHERE role_override IN ('MAINTENANCE_MANAGER', 'EQUIPMENT_MANAGER', 'HOURLY_EMPLOYEE');

-- Also migrate other tables that use user_role enum
UPDATE ai_tasks SET role = 'MANAGER' WHERE role IN ('OFFICE_MANAGER', 'HR_MANAGER', 'SALES', 'MARKETING', 'PROCUREMENT_MANAGER');
UPDATE ai_tasks SET role = 'SUPERINTENDENT' WHERE role IN ('SAFETY_MANAGER', 'DISPATCHER');
UPDATE ai_tasks SET role = 'ESTIMATOR' WHERE role = 'PROJECT_ENGINEER';
UPDATE ai_tasks SET role = 'FIELD_WORKER' WHERE role IN ('MAINTENANCE_MANAGER', 'EQUIPMENT_MANAGER', 'HOURLY_EMPLOYEE');

UPDATE hustler_link_requests SET role_override = 'MANAGER' WHERE role_override IN ('OFFICE_MANAGER', 'HR_MANAGER', 'SALES', 'MARKETING', 'PROCUREMENT_MANAGER');
UPDATE hustler_link_requests SET role_override = 'SUPERINTENDENT' WHERE role_override IN ('SAFETY_MANAGER', 'DISPATCHER');
UPDATE hustler_link_requests SET role_override = 'ESTIMATOR' WHERE role_override = 'PROJECT_ENGINEER';
UPDATE hustler_link_requests SET role_override = 'FIELD_WORKER' WHERE role_override IN ('MAINTENANCE_MANAGER', 'EQUIPMENT_MANAGER', 'HOURLY_EMPLOYEE');

-- ============================================================
-- STEP 2: Rebuild the user_role enum with only 8 values
-- ============================================================
ALTER TYPE user_role RENAME TO user_role_old;

CREATE TYPE user_role AS ENUM (
  'SUPER_ADMIN',
  'ADMIN',
  'HUSTLER',
  'MANAGER',
  'SUPERINTENDENT',
  'ESTIMATOR',
  'FIELD_WORKER',
  'VENDOR'
);

ALTER TABLE users
  ALTER COLUMN role TYPE user_role USING role::text::user_role,
  ALTER COLUMN role SET DEFAULT 'FIELD_WORKER';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hustler_organizations'
    AND column_name = 'role_override'
    AND udt_name = 'user_role_old'
  ) THEN
    EXECUTE 'ALTER TABLE hustler_organizations ALTER COLUMN role_override TYPE user_role USING role_override::text::user_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_tasks'
    AND column_name = 'role'
    AND udt_name = 'user_role_old'
  ) THEN
    EXECUTE 'ALTER TABLE ai_tasks ALTER COLUMN role TYPE user_role USING role::text::user_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hustler_link_requests'
    AND column_name = 'role_override'
    AND udt_name = 'user_role_old'
  ) THEN
    EXECUTE 'ALTER TABLE hustler_link_requests ALTER COLUMN role_override TYPE user_role USING role_override::text::user_role';
  END IF;
END $$;

DROP TYPE user_role_old;

-- ============================================================
-- STEP 3: Add new permission columns to user_dashboard_permissions
-- ============================================================
DO $$
DECLARE
  col_rec RECORD;
BEGIN
  FOR col_rec IN
    SELECT unnest(ARRAY[
      'can_access_dashboard',
      'can_access_projects',
      'can_access_active_projects_only',
      'can_create_projects',
      'can_edit_projects',
      'can_access_calendar',
      'can_access_tasks',
      'can_access_messages',
      'can_access_bulletins',
      'can_access_email_assistant',
      'can_view_bids',
      'can_edit_bids',
      'can_delete_bids',
      'can_generate_bid_pdfs',
      'can_convert_bid_to_project',
      'can_access_bid_network_gc',
      'can_access_bid_network_inbox',
      'can_manage_bid_responses',
      'can_delete_bid_requests',
      'can_access_historical_costs',
      'can_access_scope_settings',
      'can_use_ai_bid_analysis',
      'can_use_ai_contract_analysis',
      'can_access_financials',
      'can_access_cost_rates',
      'can_access_cfo_dashboard',
      'can_access_tm_billing',
      'can_access_progress_billing',
      'can_manage_contracts',
      'can_access_subcontracts',
      'can_access_overhead_costs',
      'can_access_production_rates',
      'can_access_vendor_pricing',
      'can_access_time_clock',
      'can_manage_time_clock',
      'can_approve_time',
      'can_access_tm_daily',
      'can_manage_payroll',
      'can_manage_crews',
      'can_manage_workforce',
      'can_manage_leave',
      'can_manage_safety',
      'can_manage_scheduling',
      'can_access_kpis',
      'can_lock_daily_reports',
      'can_manage_equipment',
      'can_manage_procurement',
      'can_access_crm',
      'can_create_crm_contacts',
      'can_access_marketplace',
      'can_manage_hiring',
      'can_access_hiring_interviews',
      'can_manage_hiring_settings',
      'can_post_social_media',
      'can_manage_website',
      'can_access_executive_digest',
      'can_use_ai_features',
      'can_access_company_settings',
      'can_manage_users',
      'can_access_approvals',
      'can_access_audit_logs',
      'can_access_reports',
      'can_access_enterprise_settings',
      'can_manage_ai_settings',
      'can_view_project_budget',
      'can_view_project_estimates',
      'can_view_project_procurement',
      'can_view_project_receipts',
      'can_view_project_time_entries',
      'can_view_project_subcontractors',
      'can_create_change_orders',
      'can_delete_scope_items',
      'can_edit_project_handoff'
    ]) AS col_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'user_dashboard_permissions'
      AND column_name = col_rec.col_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE user_dashboard_permissions ADD COLUMN %I BOOLEAN NOT NULL DEFAULT false',
        col_rec.col_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- STEP 3b: Backfill NEW columns only with role defaults for existing
-- permission rows. Only updates the 65 columns added by this migration.
-- Preserves the original 8 columns (can_access_financials, can_manage_payroll,
-- can_access_reports, can_use_ai_features, can_post_social_media,
-- can_manage_website, can_manage_equipment, can_manage_procurement) which
-- may have per-user custom overrides.
-- ============================================================

-- ADMIN users: all NEW features enabled
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_create_projects = true, can_edit_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true, can_access_email_assistant = true,
  can_view_bids = true, can_edit_bids = true, can_delete_bids = true,
  can_generate_bid_pdfs = true, can_convert_bid_to_project = true,
  can_access_bid_network_gc = true, can_access_bid_network_inbox = true,
  can_manage_bid_responses = true, can_delete_bid_requests = true,
  can_access_historical_costs = true, can_access_scope_settings = true,
  can_use_ai_bid_analysis = true, can_use_ai_contract_analysis = true,
  can_access_cost_rates = true,
  can_access_cfo_dashboard = true, can_access_tm_billing = true,
  can_access_progress_billing = true, can_manage_contracts = true,
  can_access_subcontracts = true, can_access_overhead_costs = true,
  can_access_production_rates = true, can_access_vendor_pricing = true,
  can_access_time_clock = true, can_manage_time_clock = true,
  can_approve_time = true, can_access_tm_daily = true,
  can_manage_crews = true,
  can_manage_workforce = true, can_manage_leave = true,
  can_manage_safety = true, can_manage_scheduling = true,
  can_access_kpis = true, can_lock_daily_reports = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_marketplace = true, can_manage_hiring = true,
  can_access_hiring_interviews = true, can_manage_hiring_settings = true,
  can_access_executive_digest = true,
  can_access_company_settings = true, can_manage_users = true,
  can_access_approvals = true, can_access_audit_logs = true,
  can_access_enterprise_settings = true,
  can_manage_ai_settings = true,
  can_view_project_budget = true, can_view_project_estimates = true,
  can_view_project_procurement = true, can_view_project_receipts = true,
  can_view_project_time_entries = true, can_view_project_subcontractors = true,
  can_create_change_orders = true, can_delete_scope_items = true, can_edit_project_handoff = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'ADMIN';

-- MANAGER users: most NEW features except user management and website
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_create_projects = true, can_edit_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true, can_access_email_assistant = true,
  can_view_bids = true, can_edit_bids = true, can_delete_bids = true,
  can_generate_bid_pdfs = true, can_convert_bid_to_project = true,
  can_access_bid_network_gc = true, can_access_bid_network_inbox = true,
  can_manage_bid_responses = true, can_delete_bid_requests = true,
  can_access_historical_costs = true, can_access_scope_settings = true,
  can_use_ai_bid_analysis = true, can_use_ai_contract_analysis = true,
  can_access_cfo_dashboard = true, can_access_tm_billing = true,
  can_access_progress_billing = true, can_manage_contracts = true,
  can_access_subcontracts = true, can_access_overhead_costs = true,
  can_access_production_rates = true, can_access_vendor_pricing = true,
  can_access_time_clock = true, can_manage_time_clock = true,
  can_approve_time = true, can_access_tm_daily = true,
  can_manage_workforce = true, can_manage_leave = true,
  can_manage_safety = true, can_manage_scheduling = true,
  can_access_kpis = true, can_lock_daily_reports = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_marketplace = true, can_manage_hiring = true,
  can_access_hiring_interviews = true,
  can_access_executive_digest = true,
  can_access_company_settings = true,
  can_access_approvals = true,
  can_view_project_budget = true, can_view_project_estimates = true,
  can_view_project_procurement = true, can_view_project_receipts = true,
  can_view_project_time_entries = true, can_view_project_subcontractors = true,
  can_create_change_orders = true, can_delete_scope_items = true, can_edit_project_handoff = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'MANAGER';

-- SUPERINTENDENT users: field management NEW columns (matches role defaults)
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_view_bids = true, can_access_historical_costs = true,
  can_manage_contracts = true,
  can_access_subcontracts = true, can_access_production_rates = true,
  can_access_time_clock = true, can_manage_time_clock = true,
  can_approve_time = true, can_access_tm_daily = true,
  can_manage_workforce = true, can_manage_safety = true,
  can_manage_scheduling = true, can_access_kpis = true,
  can_lock_daily_reports = true, can_manage_leave = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_company_settings = true, can_access_approvals = true,
  can_view_project_budget = true, can_view_project_estimates = true,
  can_view_project_procurement = true,
  can_view_project_receipts = true, can_view_project_time_entries = true,
  can_view_project_subcontractors = true,
  can_create_change_orders = true, can_delete_scope_items = true, can_edit_project_handoff = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'SUPERINTENDENT';

-- ESTIMATOR users: pre-construction NEW columns (matches role defaults)
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_create_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_view_bids = true, can_edit_bids = true,
  can_generate_bid_pdfs = true, can_convert_bid_to_project = true,
  can_access_bid_network_gc = true, can_access_bid_network_inbox = true,
  can_access_historical_costs = true, can_access_scope_settings = true,
  can_use_ai_bid_analysis = true,
  can_access_cost_rates = true,
  can_access_production_rates = true,
  can_access_time_clock = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_company_settings = true,
  can_view_project_budget = true, can_view_project_estimates = true,
  can_view_project_procurement = true,
  can_view_project_receipts = true, can_view_project_time_entries = true,
  can_view_project_subcontractors = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'ESTIMATOR';

-- FIELD_WORKER users: basic field NEW columns (matches role defaults)
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_access_time_clock = true, can_manage_leave = true,
  can_view_project_time_entries = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'FIELD_WORKER';

-- HUSTLER users: financial/executive NEW columns
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true,
  can_access_cfo_dashboard = true,
  can_access_kpis = true,
  can_manage_hiring = true, can_access_hiring_interviews = true,
  can_access_executive_digest = true
FROM users u
WHERE udp.user_id = u.id AND u.role = 'HUSTLER';

-- ============================================================
-- STEP 3c: Reset migrated users' flags to false before legacy-specific backfill
-- ============================================================
-- Step 3b set new-column defaults for ALL users of each role.
-- Migrated legacy users (e.g., SALES→MANAGER) should NOT keep those broad
-- defaults. Reset only the NEW columns so Step 4b can set conservative flags.
-- Original 8 columns are preserved (they may have admin-set overrides).
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = false, can_access_projects = false, can_access_active_projects_only = false,
  can_create_projects = false, can_edit_projects = false,
  can_access_calendar = false, can_access_tasks = false,
  can_access_messages = false, can_access_bulletins = false, can_access_email_assistant = false,
  can_view_bids = false, can_edit_bids = false, can_delete_bids = false,
  can_generate_bid_pdfs = false, can_convert_bid_to_project = false,
  can_access_bid_network_gc = false, can_access_bid_network_inbox = false,
  can_manage_bid_responses = false, can_delete_bid_requests = false,
  can_access_historical_costs = false, can_access_scope_settings = false,
  can_use_ai_bid_analysis = false, can_use_ai_contract_analysis = false,
  can_access_cost_rates = false,
  can_access_cfo_dashboard = false, can_access_tm_billing = false,
  can_access_progress_billing = false, can_manage_contracts = false,
  can_access_subcontracts = false, can_access_overhead_costs = false,
  can_access_production_rates = false, can_access_vendor_pricing = false,
  can_access_time_clock = false, can_manage_time_clock = false,
  can_approve_time = false, can_access_tm_daily = false,
  can_manage_crews = false,
  can_manage_workforce = false, can_manage_leave = false,
  can_manage_safety = false, can_manage_scheduling = false,
  can_access_kpis = false, can_lock_daily_reports = false,
  can_access_crm = false, can_create_crm_contacts = false,
  can_access_marketplace = false, can_manage_hiring = false,
  can_access_hiring_interviews = false, can_manage_hiring_settings = false,
  can_access_executive_digest = false,
  can_access_company_settings = false, can_manage_users = false,
  can_access_approvals = false, can_access_audit_logs = false,
  can_access_enterprise_settings = false,
  can_manage_ai_settings = false,
  can_view_project_budget = false, can_view_project_estimates = false,
  can_view_project_procurement = false, can_view_project_receipts = false,
  can_view_project_time_entries = false, can_view_project_subcontractors = false,
  can_create_change_orders = false, can_delete_scope_items = false, can_edit_project_handoff = false
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id;

-- ============================================================
-- STEP 4a: Ensure all migrated users have a permissions row
-- ============================================================
-- INSERT permission rows for any migrated user missing one.
-- Without this, users fall back to broad new-role defaults (privilege escalation).
INSERT INTO user_dashboard_permissions (user_id, organization_id)
SELECT lrm.id, u.organization_id
FROM _legacy_role_map lrm
JOIN users u ON u.id = lrm.id
LEFT JOIN user_dashboard_permissions udp ON udp.user_id = lrm.id
WHERE udp.user_id IS NULL;

-- ============================================================
-- STEP 4b: Backfill permissions ONLY for users who had legacy roles
-- ============================================================
-- Uses _legacy_role_map temp table to target only migrated users.
-- Flags are set conservatively per the legacy role's typical access scope.

-- OFFICE_MANAGER → MANAGER: office/billing/vendor access
-- Original 8 columns (can_access_financials, can_manage_payroll, can_manage_procurement,
-- can_access_reports) are preserved from existing per-user overrides.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_access_tm_billing = true,
  can_access_progress_billing = true, can_access_subcontracts = true,
  can_access_overhead_costs = true, can_access_vendor_pricing = true,
  can_manage_time_clock = true, can_approve_time = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_view_project_budget = true, can_view_project_receipts = true,
  can_view_project_subcontractors = true, can_create_change_orders = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'OFFICE_MANAGER';

-- HR_MANAGER → MANAGER: HR/workforce/leave access
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_manage_workforce = true, can_manage_leave = true,
  can_manage_hiring = true, can_access_hiring_interviews = true,
  can_manage_hiring_settings = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'HR_MANAGER';

-- SALES → MANAGER: CRM/pipeline access
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_view_bids = true, can_edit_bids = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_marketplace = true,
  can_access_email_assistant = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'SALES';

-- MARKETING → MANAGER: marketing/social access
-- Original columns can_post_social_media and can_manage_website preserved.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_access_marketplace = true,
  can_access_email_assistant = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'MARKETING';

-- PROCUREMENT_MANAGER → MANAGER: procurement/vendor access
-- Original column can_manage_procurement preserved.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_access_vendor_pricing = true,
  can_access_subcontracts = true,
  can_access_crm = true, can_create_crm_contacts = true,
  can_view_project_procurement = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'PROCUREMENT_MANAGER';

-- SAFETY_MANAGER → SUPERINTENDENT: safety/compliance access
-- Original columns can_manage_equipment, can_access_reports preserved.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_manage_safety = true,
  can_access_time_clock = true,
  can_view_project_time_entries = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'SAFETY_MANAGER';

-- DISPATCHER → SUPERINTENDENT: scheduling/crew access
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_manage_crews = true, can_manage_scheduling = true,
  can_access_time_clock = true, can_manage_time_clock = true,
  can_view_project_time_entries = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'DISPATCHER';

-- PROJECT_ENGINEER → ESTIMATOR: RFI/submittal/estimation access
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true,
  can_view_bids = true, can_edit_bids = true,
  can_access_historical_costs = true, can_access_scope_settings = true,
  can_access_cost_rates = true, can_access_production_rates = true,
  can_view_project_budget = true, can_view_project_estimates = true,
  can_view_project_procurement = true,
  can_create_change_orders = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'PROJECT_ENGINEER';

-- MAINTENANCE_MANAGER → FIELD_WORKER: equipment/maintenance access
-- Original column can_manage_equipment preserved.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_access_time_clock = true, can_manage_leave = true,
  can_view_project_time_entries = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'MAINTENANCE_MANAGER';

-- EQUIPMENT_MANAGER → FIELD_WORKER: equipment registry access
-- Original column can_manage_equipment preserved.
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_access_time_clock = true, can_manage_leave = true,
  can_view_project_time_entries = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'EQUIPMENT_MANAGER';

-- HOURLY_EMPLOYEE → FIELD_WORKER: basic field access
UPDATE user_dashboard_permissions udp
SET
  can_access_dashboard = true, can_access_projects = true,
  can_access_active_projects_only = true,
  can_access_calendar = true, can_access_tasks = true,
  can_access_messages = true, can_access_bulletins = true,
  can_access_time_clock = true, can_manage_leave = true,
  can_view_project_time_entries = true
FROM _legacy_role_map lrm
WHERE udp.user_id = lrm.id AND lrm.old_role = 'HOURLY_EMPLOYEE';

-- Clean up temp table
DROP TABLE _legacy_role_map;

COMMIT;
