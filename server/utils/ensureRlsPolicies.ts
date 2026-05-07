// Task #2478 — Boot-time idempotent applier for the tenant RLS policies.
//
// Mirrors `migrations/0096_enable_tenant_rls.sql` so the schema-drift
// reconciler doesn't have to round-trip through psql to keep RLS enabled
// on every multi-tenant table.
//
// The table inventory comes from the same source as the migration
// (`scripts/inventory-tenant-tables.mjs`) and is intentionally embedded
// here verbatim — keeping the SQL self-contained means a fresh DB
// brought up by `runStartupMigrations` ends in the same state as one
// brought up by `psql -f migrations/0096_enable_tenant_rls.sql`.
//
// Policy semantics (see docs/architecture/tenant-isolation.md):
//   - The policy is FAIL-CLOSED: a session sees a row IFF
//     `app.is_superadmin = 'true'` OR `organization_id = app.current_org_id`.
//   - `FORCE ROW LEVEL SECURITY` is enabled so the table owner role
//     (the role our pool connects as) is also subject to the policy.
//   - Connections default to `app.is_superadmin = 'true'` via a
//     pool-level `connect` handler in `server/db.ts`, so existing code
//     paths that haven't yet been wrapped in `withOrgContext` keep
//     working. This is the documented, named bypass — flipping the
//     `STRICT_TENANT_RLS=true` env var disables it so unwrapped queries
//     fail closed (return zero rows).
//   - `withOrgContext` explicitly downgrades the session to
//     `app.is_superadmin = 'false'` and the bound org id, which engages
//     true tenant filtering for the duration of the request / job.

import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

export async function ensureRlsPolicies(): Promise<void> {
  try {
    await db.execute(sql.raw(SUPERADMIN_ACCESS_LOG_DDL));
    await db.execute(sql.raw(buildRlsDdl()));
    logInfo("[migration] tenant RLS policies ensured");
  } catch (err) {
    logError(
      "[migration] Failed to ensure tenant RLS policies:",
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    // Non-fatal in dev so a partially-built test DB doesn't block boot.
    if (process.env.NODE_ENV === "production") throw err;
  }
}

// Dedicated audit table for the runAsSuperadmin escape hatch. The generic
// `audit_log` table requires a non-null user_id and uses an enum that
// doesn't include a "superadmin escape" action, so we keep this trail in
// its own table. Idempotent CREATE so a fresh DB and reboots both end in
// the same state. RLS is intentionally NOT enabled — these rows are
// platform-level (no organization_id) and only super-admins read them.
const SUPERADMIN_ACCESS_LOG_DDL = `
CREATE TABLE IF NOT EXISTS superadmin_access_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reason      text        NOT NULL,
  source      text,
  actor_id    varchar,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS superadmin_access_log_created_at_idx
  ON superadmin_access_log (created_at DESC);
`;

// Built lazily because the TENANT_TABLES const below is hoisted but not
// initialised until module evaluation reaches it; building the SQL inside
// a function defers the read until ensureRlsPolicies() is actually called.
function buildRlsDdl(): string {
  const inventory = TENANT_TABLES.map((t) => `'${t}'`).join(",\n    ");
  return `
DO $rls$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- Inventory mirrors migrations/0096_enable_tenant_rls.sql. Regenerate
    -- both with: node scripts/inventory-tenant-tables.mjs
    ${inventory}
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = t) THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t
                   AND column_name = 'organization_id') THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        AS PERMISSIVE
        FOR ALL
        USING (
          current_setting('app.is_superadmin', true) = 'true'
          OR organization_id = current_setting('app.current_org_id', true)
        )
        WITH CHECK (
          current_setting('app.is_superadmin', true) = 'true'
          OR organization_id = current_setting('app.current_org_id', true)
        )
    $p$, t);
  END LOOP;
END
$rls$;
`;
}

// Inlined from scripts/inventory-tenant-tables.mjs output. Keep alphabetised.
export const TENANT_TABLES: readonly string[] = [
  "activity_log",
  "addenda",
  "ai_action_audit",
  "ai_bid_document_analysis",
  "ai_co_drafts",
  "ai_contract_document_analysis",
  "ai_estimator_assemblies",
  "ai_estimator_chat_sessions",
  "ai_estimator_excluded_sources",
  "ai_estimator_feedback_events",
  "ai_estimator_ingest_runs",
  "ai_estimator_knowledge_index",
  "ai_estimator_learned_rates",
  "ai_estimator_legend_symbols",
  "ai_estimator_org_factors",
  "ai_estimator_rate_samples",
  "ai_estimator_user_access",
  "ai_estimator_web_research_cache",
  "ai_insights",
  "ai_takeoff_analyses",
  "ai_takeoff_confidence_calibration",
  "ai_takeoff_suggestions",
  "ai_vendor_comparisons",
  "annual_salary_categories",
  "approval_requests",
  "attendance_logs",
  "bid_document_distributions",
  "bid_request_clarifications",
  "bids",
  "burden_rates",
  "certified_payroll_reports",
  "change_order_attachments",
  "client_portal_access",
  "contract_clauses",
  "contract_risk_analyses",
  "contracts",
  "contract_templates",
  "conversations",
  "crew_marketplace",
  "crews",
  "crm_assignment_rules",
  "crm_automation_runs",
  "crm_automations",
  "crm_calls",
  "crm_catalog_items",
  "crm_contacts",
  "crm_csv_import_jobs",
  "crm_custom_field_definitions",
  "crm_custom_field_values",
  "crm_custom_reports",
  "crm_email_logging_settings",
  "crm_email_logging_suppressions",
  "crm_email_messages",
  "crm_email_threads",
  "crm_lead_forms",
  "crm_lead_form_submissions",
  "crm_lead_scoring_rules",
  "crm_meeting_bookings",
  "crm_meeting_links",
  "crm_opportunities",
  "crm_organisation_certifications",
  "crm_organisation_notes",
  "crm_organisations",
  "crm_quote_acceptance_tokens",
  "crm_quotes",
  "crm_quote_templates",
  "crm_sequence_email_events",
  "crm_sequence_enrollments",
  "crm_sequences",
  "crm_sequence_step_executions",
  "crm_stage_slas",
  "crm_tasks",
  "crm_transcript_backfill_jobs",
  "custom_libraries",
  "daily_inspector_reports",
  "daily_report_locks",
  "daily_reports",
  "data_processing_records",
  "data_subject_requests",
  "delay_claims",
  "document_revisions",
  "document_transmittals",
  "dol_classification_mappings",
  "dot_pay_item_match_history",
  "dot_pay_item_overrides",
  "drawing_sets",
  "email_accounts",
  "email_attachments",
  "email_campaigns",
  "email_campaign_templates",
  "email_messages",
  "email_summaries",
  "email_tasks",
  "email_threads",
  "employee_classifications",
  "employee_cost_assignments",
  "employee_deductions",
  "employee_performance_profiles",
  "employee_ratings",
  "equipment",
  "equipment_listings",
  "error_logs",
  "executive_digests",
  "feature_flag_manual_changes",
  "feature_flag_preset_applications",
  "haul_tickets",
  "hiring_activity_logs",
  "hiring_ai_reviews",
  "hiring_candidate_documents",
  "hiring_candidate_notes",
  "hiring_candidates",
  "hiring_candidate_stage_history",
  "hiring_integrations",
  "hiring_interviews",
  "hiring_jobs",
  "hiring_job_templates",
  "hiring_pipeline_configs",
  "hiring_pipeline_stages",
  "hiring_sync_logs",
  "hiring_tasks",
  "historical_costs",
  "hustler_link_requests",
  "hustler_organizations",
  "integration_api_keys",
  "integration_api_request_log",
  "integration_connections",
  "integration_events_outbox",
  "integration_suppression_resets",
  "integration_sync_alert_mutes",
  "integration_sync_state",
  "integration_webhook_subscriptions",
  "issue_captures",
  "job_classifications",
  "jobsite_analysis_batches",
  "kpi_assignments",
  "kpi_entries",
  "kpi_templates",
  "leave_requests",
  "leave_types",
  "library_assemblies",
  "library_categories",
  "library_items",
  "lidar_comparisons",
  "lidar_scans",
  "lien_waivers",
  "material_calculator_presets",
  "material_certifications",
  "material_price_index",
  "mobile_devices",
  "modifiers",
  "my_work_saved_views",
  "notifications",
  "object_acl_policies",
  "offline_sync_queue",
  "organization_addons",
  "organization_calculators",
  "organization_documents",
  "organization_dot_preferences",
  "organization_network_settings",
  "organization_payroll_settings",
  "organization_social_links",
  "organization_sow_items",
  "organization_subscriptions",
  "organization_usage",
  "organization_website_pages",
  "organization_websites",
  "organization_work_types",
  "org_color_palettes",
  "org_cost_codes",
  "osha_incidents",
  "overhead_cost_history",
  "overhead_cost_items",
  "overtime_requests",
  "overtime_rules",
  "page_preview_links",
  "page_versions",
  "pay_applications",
  "payroll_deduction_types",
  "payroll_notifications",
  "pay_runs",
  "peer_ratings",
  "pending_contact_reassignment_notifications",
  "performance_reviews",
  "permission_presets",
  "photo_custody_records",
  "plan_document_markups",
  "plan_documents",
  "plan_markup_layers",
  "plan_pins",
  "portal_chat_threads",
  "prevailing_wage_rates",
  "pricebook_import_jobs",
  "project_dbe_goals",
  "project_email_distribution_lists",
  "project_health_snapshots",
  "project_kpi_snapshots",
  "project_log_email_schedule_attempts",
  "project_log_email_schedules",
  "project_profitability_snapshots",
  "project_risks",
  "projects",
  "project_schedules",
  "project_templates",
  "qbo_account_mappings",
  "qbo_sync_schedules",
  "quality_issues",
  "rating_criteria",
  "rental_equipment_catalog",
  "rental_vendors",
  "retention_policies",
  "retention_releases",
  "revenue_recognition",
  "reward_assignments",
  "reward_types",
  "rfi_attachments",
  "rfis",
  "safety_checklist_instances",
  "safety_checklist_templates",
  "safety_incidents",
  "safety_observations",
  "safety_training_assignments",
  "safety_trainings",
  "sage_account_mappings",
  "saved_scale_templates",
  "saved_takeoffs",
  "schedule_baselines",
  "schedule_of_values",
  "signature_requests",
  "skill_verification_requests",
  "social_accounts",
  "social_media_posts",
  "social_post_history",
  "sov_payments",
  "sow_audit_log",
  "sso_configurations",
  "standalone_takeoff_files",
  "standalone_takeoffs",
  "stored_materials",
  "subcontractor_bid_invitations",
  "subcontractor_bid_requests",
  "subcontractor_bid_responses",
  "subcontractor_payments",
  "subcontractor_portal_tokens",
  "submittal_attachments",
  "submittal_items",
  "submittal_reviews",
  "submittals",
  "subscription_events",
  "supervisor_notes",
  "surety_bonds",
  "swppp_inspections",
  "takeoff_assemblies",
  "takeoff_conditions",
  "takeoff_issues",
  "takeoff_markups",
  "takeoff_recents",
  "takeoff_sheet_sets",
  "takeoff_suggestion_dismissals",
  "takeoff_tags",
  "takeoff_tool_chest_items",
  "talent_profiles",
  "tasks",
  "tm_invoices",
  "toolbox_talk_scheduled",
  "toolbox_talk_topics",
  "unified_payments",
  "upload_intents",
  "user_certifications",
  "user_color_palettes",
  "user_dashboard_layouts",
  "user_dashboard_permissions",
  "user_equipment_competencies",
  "users",
  "user_saved_views",
  "user_settings",
  "vendor_pricebook_items",
  "vendor_pricebooks",
  "vendor_pricing_catalogs",
  "vendor_scores",
  "vendor_service_catalog",
  "voice_logs",
  "wage_decision_rate_change_acknowledgements",
  "wage_decision_rate_changes",
  "website_analytics_daily",
  "website_blog_comments",
  "website_blog_posts",
  "website_contact_submissions",
  "website_deployments",
  "website_projects",
  "weekly_payroll_reports",
  "worker_logs",
  "workflow_instances",
  "workflow_templates",
  "zapier_webhooks"
];
