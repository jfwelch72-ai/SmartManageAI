/**
 * Task #1127 — Startup-migration coverage manifest.
 *
 * Background
 * ----------
 * Every SQL file under `migrations/` must either be:
 *   (a) mirrored by an `ensure*` / `backfill*` helper that is registered in
 *       `server/utils/runStartupMigrations.ts`, OR
 *   (b) explicitly opted out (drizzle-kit baseline, applied via
 *       `npx drizzle-kit migrate`, superseded by a later file, etc.).
 *
 * Several recent regressions (#1062, #1066, #1076, #1089) all had the same
 * root cause: a new SQL file landed in `migrations/` but no startup helper
 * was registered, so freshly-pulled dev DBs silently went missing the
 * column/table until a request 500'd. The companion test
 * (`__tests__/migrationStartupCoverage.test.ts`) walks `migrations/*.sql`
 * and fails loudly if any file is missing from this manifest, catching the
 * problem at PR time instead of in production.
 *
 * Adding a new migration
 * ----------------------
 * 1. Drop your `migrations/NNNN_<name>.sql`.
 * 2. Add an entry below. Prefer `{ helper: "ensureXxx" }` and register the
 *    helper in `runStartupMigrations.ts` so fresh dev DBs auto-apply it.
 * 3. Use `{ skip: "<reason>" }` only when a startup helper is intentionally
 *    not required — e.g. drizzle-kit baseline files, one-off backfills that
 *    only run in production, or files superseded by a later migration.
 *
 * The `helper` name must match a function imported in
 * `runStartupMigrations.ts` (e.g. `ensureUsersManagerIdColumn`).
 */

export type MigrationCoverageEntry =
  | { helper: string; note?: string }
  | { skip: string };

export const migrationStartupCoverage: Record<string, MigrationCoverageEntry> = {
  // --- drizzle-kit auto-generated baseline (random animal names) ----------
  // These are part of the initial drizzle-kit snapshot and are applied via
  // `npx drizzle-kit migrate` / `push`, not via runtime startup helpers.
  "0001_marvelous_anita_blake.sql": { skip: "drizzle-kit baseline snapshot" },
  "0002_clumsy_jackpot.sql": { skip: "drizzle-kit baseline snapshot" },
  "0003_tricky_captain_flint.sql": { skip: "drizzle-kit baseline snapshot" },
  "0004_sweet_vargas.sql": { skip: "drizzle-kit baseline snapshot" },
  "0005_dusty_kulan_gath.sql": { skip: "drizzle-kit baseline snapshot" },

  // --- pre-existing custom migrations (baseline before Task #1127) --------
  // Task #1144 audit: every `skip` below documents *why* a startup helper is
  // unnecessary. The two safe categories are:
  //   (A) idempotent CREATE TABLE / ADD COLUMN — `reconcileSchemaDrift`
  //       (Task #1075) auto-creates missing columns and `synthesizeMissing
  //       Tables` (Task #1138) auto-creates missing tables (with FKs +
  //       indexes) directly from the Drizzle schema on fresh dev DBs.
  //   (B) one-off DDL whose end-state is already encoded in the Drizzle
  //       schema — e.g. `ALTER COLUMN TYPE`, `ALTER COLUMN DROP NOT NULL`,
  //       or backfill `UPDATE`s. Fresh dev DBs create the column with the
  //       target type/nullability directly, so no replay is needed.
  // Anything that mutates an *existing* enum's values (`ALTER TYPE ADD
  // VALUE`) does NOT fall into either category — `reconcileSchemaDrift`
  // creates missing enum types but never adds values to existing ones — so
  // those baselines must be promoted to a `helper` entry below.
  "0000_add_passkey_credentials.sql": {
    skip: "(A) CREATE TABLE + indexes auto-applied by reconcileSchemaDrift table synthesis (Task #1138)",
  },
  "0001_add_estimate_line_item_subcontractors.sql": { helper: "ensureEstimateSubcontractorTables" },
  "0002_add_change_order_cost_breakdown.sql": {
    skip: "(A) idempotent ADD COLUMN with defaults — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  "0003_add_talent_pool_and_pipeline_stages.sql": {
    skip: "(A)+(B) new enums/tables auto-synthesized; ALTER COLUMN TYPE on hiring_candidates is one-off (fresh DB creates as TEXT directly)",
  },
  "0004_add_overhead_enhancements.sql": {
    skip: "(A) new enum + new table + ADD COLUMN — all auto-applied by reconcileSchemaDrift",
  },
  "0005_add_leave_management.sql": { helper: "ensureSiteLeaveTable" },
  "0006_add_aia_billing_tables.sql": { helper: "ensureSovStatusEnumValues",
    note: "Task #1144 — adds UNDER_REVIEW/REJECTED to sov_status; new tables auto-synthesized by reconcileSchemaDrift",
  },
  "0007_change_order_ux_gaps.sql": {
    skip: "(A)+(B) cost_code_id ADD COLUMN auto-applied; FK + (project_id, change_order_number) unique index are not in the Drizzle schema, so they are intentionally DB-only enforcement and not replayed at startup",
  },
  "0008_change_order_portal_comments.sql": {
    skip: "(A)+(B) new table auto-synthesized; ALTER COLUMN DROP NOT NULL is one-off — fresh DBs create change_order_revisions.revised_by_id as nullable directly from the Drizzle schema",
  },
  "0009_subcontract_management.sql": {
    skip: "(A) ADD COLUMN + new tables — all auto-applied by reconcileSchemaDrift",
  },
  "0010_asset_property_management.sql": {
    skip: "(A) new enums + new tables — all auto-applied by reconcileSchemaDrift",
  },
  "0011_crm_win_probability.sql": {
    skip: "(A) idempotent ADD COLUMN — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  "0012_add_expected_delivery_date.sql": { helper: "ensurePurchaseOrderColumns" },
  "0012_tm_workflow_enhancements.sql": { helper: "ensureNotificationEnumValues",
    note: "Task #1144 — TM_INVOICE_AUTO_CREATED added to ensureNotificationEnumValues; ADD COLUMNs auto-applied by reconcileSchemaDrift",
  },
  "0013_equipment_depreciation_fuel_logs.sql": { helper: "ensureEquipmentColumns" },
  "0013_messaging_entity_linking.sql": { helper: "ensureMessageColumns" },
  "0014_drawing_sets_and_revisions.sql": { helper: "ensureNotificationEnumValues",
    note: "Task #1144 — DOCUMENT_REVISION_CREATED added to ensureNotificationEnumValues; new geofence_enforcement enum + drawing_sets/drawing_set_items tables auto-synthesized by reconcileSchemaDrift",
  },
  "0015_payroll_workforce_fixes.sql": {
    skip: "(A) idempotent ADD COLUMN with defaults — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  "0016_add_cost_transactions.sql": {
    skip: "(A) new enums + cost_transactions table — all auto-applied by reconcileSchemaDrift",
  },
  "0016_calendar_cleanup.sql": { helper: "ensureCalendarEventTypeEnumValues",
    note: "Task #1144 — adds MEETING/PROJECT_DEADLINE values to existing calendar_event_type enum (not handled by reconcileSchemaDrift)",
  },
  "0017_media_ai_columns.sql": {
    skip: "(A) idempotent ADD COLUMN — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  "0018_toolbox_safety_tables.sql": {
    skip: "(A) new tables — auto-synthesized by reconcileSchemaDrift table synthesis (Task #1138)",
  },
  "0019_osha_incidents_table.sql": {
    skip: "(A) new osha_incidents table — auto-synthesized by reconcileSchemaDrift table synthesis (Task #1138)",
  },
  "0020_add_video_calls_and_budget_amount.sql": { helper: "ensureVideoCallTables" },
  "0021_add_notification_organization_id.sql": {
    skip: "(A)+(B) ADD COLUMN auto-applied; one-off backfill UPDATE only matters for legacy rows (no fresh-DB rows to backfill)",
  },
  "0022_fix_missing_tables_and_columns.sql": { helper: "ensureMissingDrizzleTables" },
  "0023_auto_change_orders_takeoff_delta.sql": { helper: "ensureTakeoffEnhancements" },
  "0024_create_workflow_tables.sql": { helper: "ensureWorkflowTables" },
  "0025_consolidate_roles_and_permissions.sql": { helper: "ensurePermissionPresetsTable" },
  "0026_replace_active_projects_only_with_project_scope.sql": { helper: "ensureFieldWorkerPermColumns" },
  "0027_add_project_note_pages.sql": {
    skip: "(A) note_block_type enum + project_note_pages/blocks tables — all auto-applied by reconcileSchemaDrift",
  },
  "0028_drop_project_spec_index.sql": { skip: "idempotent DROP INDEX — no startup helper needed (no schema state to ensure)" },
  "0029_certified_payroll_signer_and_fringes.sql": { helper: "ensurePayrollFormVariantColumn" },
  "0030_geocode_status_columns.sql": { helper: "ensureGeocodeStatusColumns" },
  "0030_project_email_distribution_lists.sql": { helper: "ensureProjectEmailDistributionLists" },
  "0031_org_distribution_lists.sql": { helper: "ensureProjectEmailDistributionLists",
    note: "Task #1144 — ensureProjectEmailDistributionLists already issues both the DROP NOT NULL on project_id and the partial unique index `project_email_lists_org_name_uniq` from this migration",
  },
  "0032_backfill_crm_contact_timezones.sql": { helper: "ensureCrmContactTimezoneBackfill" },
  "0033_crm_contact_owner_id.sql": { helper: "ensureCrmOrganisationOwnerColumn" },
  "0034_scheduling_module_enhancements.sql": { helper: "ensureSchedulingModuleEnhancements" },
  "0035_project_kpi_snapshots.sql": { helper: "ensureProjectKpiSnapshotsTable" },
  "0036_crm_call_recording_storage_key.sql": { helper: "ensureCrmCallTables" },
  "0036_crm_calls_owner_and_follow_up.sql": { helper: "ensureCrmCallTables" },
  "0037_backfill_summary_preferences.sql": { helper: "ensureUsersCrmBackfillSummaryPreferenceColumns" },
  "0037_crm_transcript_backfill_test_alerts.sql": { helper: "ensureCrmTranscriptBackfillTestAlertsTable" },
  "0038_alert_failure_fallback_prefs.sql": { helper: "ensureUsersCrmAlertFailureFallbackColumns" },
  "0038_crm_transcript_backfill_canceller.sql": {
    skip: "idempotent ADD COLUMN IF NOT EXISTS picked up by reconcileSchemaDrift (Task #1075)",
  },
  "0039_alert_delivery_resend_actor.sql": {
    skip: "idempotent ADD COLUMN IF NOT EXISTS picked up by reconcileSchemaDrift (Task #1075)",
  },
  "0041_test_alert_threshold_columns.sql": { helper: "ensureCrmTranscriptBackfillNotificationSettingsTable" },
  "0040_certified_payroll_generated_by_nullable.sql": {
    skip: "one-off ALTER COLUMN DROP NOT NULL; safe to apply via drizzle-kit migrate",
  },
  "0042_swppp_corrective_action_status.sql": { helper: "ensureSwpppCorrectiveActionStatus" },
  "0043_certified_payroll_archive_columns.sql": { helper: "ensureCertifiedPayrollArchiveColumns" },
  "0044_dot_pay_item_match_history.sql": { helper: "ensureDotPayItemMatchHistory" },
  "0044_swppp_overdue_notification_marker.sql": { helper: "ensureSwpppOverdueNotificationColumn" },
  "0044_certified_payroll_archived_retention.sql": { helper: "ensureCertifiedPayrollArchivedRetention" },
  // Task #1247 — batch_id column + (organization_id, batch_id) index on
  // dot_pay_item_match_history so the post-import toast can one-click
  // "undo" a whole bid-tab import batch. Mirrored inside
  // ensureDotPayItemMatchHistory alongside the original CREATE TABLE.
  "0045_dot_pay_item_match_history_batch_id.sql": {
    helper: "ensureDotPayItemMatchHistory",
    note: "Task #1247 — batch_id column + org_batch index are applied by ensureDotPayItemMatchHistory",
  },
  // Task #1260 — dedicated SWPPP_OVERDUE_CORRECTIVE_ACTION enum value +
  // nullable notification_type_prefs.in_app_enabled column. The enum
  // value is added by ensureNotificationEnumValues; the nullable
  // ADD COLUMN is auto-applied by reconcileSchemaDrift (Task #1075).
  "0045_swppp_overdue_notification_pref.sql": {
    helper: "ensureNotificationEnumValues",
    note: "Task #1260 — SWPPP_OVERDUE_CORRECTIVE_ACTION added to ensureNotificationEnumValues; companion notification_type_prefs.in_app_enabled nullable ADD COLUMN auto-applied by reconcileSchemaDrift",
  },
  // Task #1259 — swppp_inspections.overdue_reminder_count counter for
  // the follow-up reminder cap. Idempotent ADD COLUMN with a default so
  // reconcileSchemaDrift (Task #1075) auto-applies it on fresh dev DBs.
  "0045_swppp_overdue_reminder_count.sql": {
    skip: "(A) idempotent ADD COLUMN with default — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  // Task #491 — plan_documents org scope (new enum, scope/organization_id
  // columns, DROP NOT NULL on project_id, backfill, index) plus the
  // companion crm_organisation_certifications.document_id FK. Mirrored
  // at boot by ensurePlanDocumentsOrgScope (+ ensureCrmOrgCertDocumentColumn
  // for the FK column) so fresh checkouts don't need drizzle-kit.
  "0046_plan_documents_org_scope.sql": {
    helper: "ensurePlanDocumentsOrgScope",
    note: "Task #491 — plan_documents DDL applied by ensurePlanDocumentsOrgScope; companion crm_organisation_certifications.document_id column is applied by ensureCrmOrgCertDocumentColumn (also registered in runStartupMigrations.ts)",
  },
  // Task #494 — nullable projects.wage_decision text column used by the
  // WH-347 generator to fall back to cached DOL prevailing-wage rates.
  // Idempotent ADD COLUMN auto-applied by reconcileSchemaDrift.
  "0046_projects_wage_decision.sql": {
    skip: "(A) idempotent nullable ADD COLUMN — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  // Task #1286 — per-org SWPPP overdue reminder cap + interval columns
  // on the organizations table. See ensureSwpppOverdueReminderSettings.
  "0046_swppp_overdue_reminder_settings.sql": { helper: "ensureSwpppOverdueReminderSettings" },
  // Task #1314 — extend feature_flag_preset_applications with kind +
  // flag_keys columns so drift-reset audit rows surface in the Preset
  // history card. Idempotent ADD COLUMN IF NOT EXISTS handled by the
  // existing ensure helper.
  "0047_feature_flag_preset_application_kind.sql": { helper: "ensureFeatureFlagPresetApplicationsTable" },
  // Task #1332 — adds last_attempt_at + last_error to integration_sync_state
  // and the DAVIS_BACON_AUTO_SYNC_FAILED notification_type enum value so
  // failed Davis-Bacon background syncs surface to the integration owner.
  "0048_integration_sync_state_failure_tracking.sql": { helper: "ensureIntegrationSyncStateFailureColumns",
    note: "Companion ALTER TYPE ADD VALUE for DAVIS_BACON_AUTO_SYNC_FAILED is handled by ensureNotificationEnumValues",
  },
  // Task #1354 — adds integration_sync_state.retry_count +
  // next_retry_at columns used by the generic failed-sync retry sweep
  // (processFailedWageDecisionRetries). Both are idempotent ADD COLUMN
  // statements (retry_count has a default of 0; next_retry_at is
  // nullable) so reconcileSchemaDrift (Task #1075) picks them up on
  // fresh dev DBs.
  "0049_integration_sync_state_retry_backoff.sql": {
    skip: "(A) idempotent ADD COLUMN (one default, one nullable) — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  // Task #1344 — companion ALTER TYPE ADD VALUE for the
  // WAGE_DECISION_MISSING_REMINDER notification_type used by the daily
  // missing-wage-decision reminder fan-out. Handled by
  // ensureNotificationEnumValues.
  "0050_wage_decision_missing_reminder.sql": {
    helper: "ensureNotificationEnumValues",
    note: "Task #1344 — WAGE_DECISION_MISSING_REMINDER already listed in ensureNotificationEnumValues",
  },
  // Task #1391 — adds integration_sync_state.exhausted_notified_at so the
  // generic retry sweep / recordSyncFailure can fan one-and-only-one
  // admin notification per exhaustion event. The companion ALTER TYPE
  // ADD VALUE for INTEGRATION_SYNC_RETRIES_EXHAUSTED is handled by
  // ensureNotificationEnumValues.
  "0051_integration_sync_state_exhausted_notified.sql": {
    helper: "ensureIntegrationSyncStateExhaustedNotifiedColumn",
    note: "Companion ALTER TYPE ADD VALUE for INTEGRATION_SYNC_RETRIES_EXHAUSTED is handled by ensureNotificationEnumValues",
  },
  // Task #1404 — per-connection (and optional per-entityType) mute state
  // for the INTEGRATION_SYNC_RETRIES_EXHAUSTED admin fan-out so a
  // chronically broken integration stops spamming admins during triage.
  "0052_integration_sync_alert_mutes.sql": { helper: "ensureIntegrationSyncAlertMutes" },
  // Task #1409 — per-classification record of the most recent
  // Davis-Bacon stale-refresh diff so the project prevailing wage panel
  // can flag classifications whose rate just changed (and clear the flag
  // once a PM acknowledges or a follow-up refresh has no diff).
  "0053_wage_decision_rate_changes.sql": { helper: "ensureWageDecisionRateChanges" },
};
