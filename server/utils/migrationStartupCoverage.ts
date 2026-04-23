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
  // These predate the startup-coverage check. Schema drift for any missing
  // columns/tables is caught by `reconcileSchemaDrift` (Task #1075). New
  // migrations after Task #1127 must use `helper` or a specific `skip`.
  "0000_add_passkey_credentials.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0001_add_estimate_line_item_subcontractors.sql": { helper: "ensureEstimateSubcontractorTables" },
  "0002_add_change_order_cost_breakdown.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0003_add_talent_pool_and_pipeline_stages.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0004_add_overhead_enhancements.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0005_add_leave_management.sql": { helper: "ensureSiteLeaveTable" },
  "0006_add_aia_billing_tables.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0007_change_order_ux_gaps.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0008_change_order_portal_comments.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0009_subcontract_management.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0010_asset_property_management.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0011_crm_win_probability.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0012_add_expected_delivery_date.sql": { helper: "ensurePurchaseOrderColumns" },
  "0012_tm_workflow_enhancements.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0013_equipment_depreciation_fuel_logs.sql": { helper: "ensureEquipmentColumns" },
  "0013_messaging_entity_linking.sql": { helper: "ensureMessageColumns" },
  "0014_drawing_sets_and_revisions.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0015_payroll_workforce_fixes.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0016_add_cost_transactions.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0016_calendar_cleanup.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0017_media_ai_columns.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0018_toolbox_safety_tables.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0019_osha_incidents_table.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0020_add_video_calls_and_budget_amount.sql": { helper: "ensureVideoCallTables" },
  "0021_add_notification_organization_id.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0022_fix_missing_tables_and_columns.sql": { helper: "ensureMissingDrizzleTables" },
  "0023_auto_change_orders_takeoff_delta.sql": { helper: "ensureTakeoffEnhancements" },
  "0024_create_workflow_tables.sql": { helper: "ensureWorkflowTables" },
  "0025_consolidate_roles_and_permissions.sql": { helper: "ensurePermissionPresetsTable" },
  "0026_replace_active_projects_only_with_project_scope.sql": { helper: "ensureFieldWorkerPermColumns" },
  "0027_add_project_note_pages.sql": { skip: "baseline; covered by drizzle-kit migrate" },
  "0028_drop_project_spec_index.sql": { skip: "baseline; idempotent DROP INDEX, no startup helper needed" },
  "0029_certified_payroll_signer_and_fringes.sql": { helper: "ensurePayrollFormVariantColumn" },
  "0030_geocode_status_columns.sql": { helper: "ensureGeocodeStatusColumns" },
  "0030_project_email_distribution_lists.sql": { helper: "ensureProjectEmailDistributionLists" },
  "0031_org_distribution_lists.sql": { skip: "baseline; covered by drizzle-kit migrate" },
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
  "0040_certified_payroll_generated_by_nullable.sql": {
    skip: "one-off ALTER COLUMN DROP NOT NULL; safe to apply via drizzle-kit migrate",
  },
  "0042_swppp_corrective_action_status.sql": { helper: "ensureSwpppCorrectiveActionStatus" },
};
