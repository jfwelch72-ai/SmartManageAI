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
  // Task #2432 — renamed 0044_dot_pay_item_match_history.sql → 0085 to
  // resolve a 0044 filename collision left over from parallel branches.
  "0085_dot_pay_item_match_history.sql": { helper: "ensureDotPayItemMatchHistory" },
  // Task #2432 — renamed 0044_swppp_overdue_notification_marker.sql → 0086.
  "0086_swppp_overdue_notification_marker.sql": { helper: "ensureSwpppOverdueNotificationColumn" },
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
  // Task #2432 — renamed 0045_swppp_overdue_notification_pref.sql → 0087.
  "0087_swppp_overdue_notification_pref.sql": {
    helper: "ensureNotificationEnumValues",
    note: "Task #1260 — SWPPP_OVERDUE_CORRECTIVE_ACTION added to ensureNotificationEnumValues; companion notification_type_prefs.in_app_enabled nullable ADD COLUMN auto-applied by reconcileSchemaDrift",
  },
  // Task #1259 — swppp_inspections.overdue_reminder_count counter for
  // the follow-up reminder cap. Idempotent ADD COLUMN with a default so
  // reconcileSchemaDrift (Task #1075) auto-applies it on fresh dev DBs.
  // Task #2432 — renamed 0045_swppp_overdue_reminder_count.sql → 0088.
  "0088_swppp_overdue_reminder_count.sql": {
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
  // Task #2432 — renamed 0046_projects_wage_decision.sql → 0089.
  "0089_projects_wage_decision.sql": {
    skip: "(A) idempotent nullable ADD COLUMN — reconcileSchemaDrift auto-adds (Task #1075)",
  },
  // Task #1286 — per-org SWPPP overdue reminder cap + interval columns
  // on the organizations table. See ensureSwpppOverdueReminderSettings.
  // Task #2432 — renamed 0046_swppp_overdue_reminder_settings.sql → 0090.
  "0090_swppp_overdue_reminder_settings.sql": { helper: "ensureSwpppOverdueReminderSettings" },
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
  // Task #1480 — append-only audit history of every PM acknowledgement
  // of a Davis-Bacon rate-change flag, surfaced via the prevailing-wage
  // panel's "View history" affordance for compliance reviews.
  "0055_wage_decision_rate_change_acknowledgements.sql": { helper: "ensureWageDecisionRateChangeAcknowledgements" },
  // Task #1528 — structured history of admin one-shot job re-runs.
  // Replaces the previous regex-parse of `audit_log.new_value` in the
  // admin one-shot jobs panel. New CREATE TABLE + indexes mirrored by
  // ensureOneShotJobRuns.
  "0056_one_shot_job_runs.sql": { helper: "ensureOneShotJobRuns" },
  // Task #1599 — per-RFI dedupe marker + counter for the nightly RFI
  // overdue escalation sweep, plus an external-assignee email column
  // for the EXTERNAL_DOC_EMAIL fanout. Mirrored at boot by
  // ensureRfiOverdueColumns so fresh checkouts don't need drizzle-kit.
  // Task #2432 — renamed 0057_rfi_overdue_columns.sql → 0091.
  "0091_rfi_overdue_columns.sql": { helper: "ensureRfiOverdueColumns" },
  // Task #1599 — same per-row bookkeeping for submittal_reviews + a
  // reviewer_email column for external A/E reviewers.
  // Task #2432 — renamed 0057_submittal_review_overdue_columns.sql → 0093.
  "0093_submittal_review_overdue_columns.sql": { helper: "ensureSubmittalReviewOverdueColumns" },
  // Task #1599 — per-org cap + cadence for the document-control overdue
  // sweeps (mirrors the SWPPP per-org policy column pair).
  "0057_doc_overdue_reminder_settings.sql": { helper: "ensureDocOverdueReminderSettings" },
  // Task #1600 — Sage Intacct chart-of-accounts mapping table that
  // backs the admin Sage mapping panel and the periodic XML Gateway
  // sync. Mirrored at boot by ensureSageAccountMappingsTable.
  // Task #2432 — renamed 0057_sage_account_mappings.sql → 0092.
  "0092_sage_account_mappings.sql": { helper: "ensureSageAccountMappingsTable" },
  // Task #1614 — adds subcontractor_portal_tokens.token_lookup_hash +
  // a btree index on it so requirePortalAuth can index-fetch the single
  // candidate row instead of bcrypt-scanning every active token.
  // Mirrored at boot by ensurePortalTokenLookupHashColumn.
  "0058_portal_token_lookup_hash.sql": { helper: "ensurePortalTokenLookupHashColumn" },
  // Task #1622 — per-attempt outcome tracking columns
  // (last_attempt_at / last_attempt_status / last_attempt_error /
  // last_attempt_recipient_count) on project_log_email_schedules so
  // the project settings panel can render a "Last send failed" badge
  // without admins having to grep server logs. Mirrored at boot by
  // ensureProjectLogEmailAttemptTracking.
  "0058_project_log_email_attempt_tracking.sql": { helper: "ensureProjectLogEmailAttemptTracking" },
  // Task #1637 — last_edited_by_id + failure-notification dedupe
  // columns on project_log_email_schedules. The cron fans a one-shot
  // in-app notification (PROJECT_LOG_EMAIL_FAILED) to the schedule's
  // last editor + project manager on transition into FAILURE /
  // NO_RECIPIENTS, dedupe-keyed on last_failure_notified_status.
  // Mirrored at boot by ensureProjectLogEmailFailureNotifications.
  "0059_project_log_email_failure_notifications.sql": {
    helper: "ensureProjectLogEmailFailureNotifications",
    note: "Companion ALTER TYPE ADD VALUE for PROJECT_LOG_EMAIL_FAILED is handled by ensureNotificationEnumValues",
  },
  // Task #1651 — consecutive_failure_count column on
  // project_log_email_schedules. The worker uses it to fan a backstop
  // notification to every ADMIN/MANAGER/SUPER_ADMIN in the org once a
  // schedule has failed PROJECT_LOG_EMAIL_FAILURE_THRESHOLD (default
  // 3) times in a row, so a quietly-broken distribution list can't go
  // un-noticed for weeks just because nobody opens project settings.
  // Mirrored at boot by ensureProjectLogEmailConsecutiveFailures.
  "0060_project_log_email_consecutive_failures.sql": {
    helper: "ensureProjectLogEmailConsecutiveFailures",
  },
  // Task #1652 — append-only per-schedule send history table that
  // backs the new "Recent attempts" collapsible on the project
  // settings panel. Mirrored at boot by
  // ensureProjectLogEmailScheduleAttemptsTable. Renumbered from 0060
  // to 0061 during rebase to avoid filename collision with the
  // Task #1651 migration that landed concurrently.
  "0061_project_log_email_schedule_attempts.sql": {
    helper: "ensureProjectLogEmailScheduleAttemptsTable",
  },
  // Task #1668 — per-org override for the repeated-failure backstop
  // notification threshold on the per-project scheduled log email
  // worker. NULL means "use the env / global default", a positive
  // integer overrides PROJECT_LOG_EMAIL_FAILURE_THRESHOLD for that
  // org's schedules only. Mirrored at boot by
  // ensureProjectLogEmailFailureThresholdSetting.
  "0062_project_log_email_failure_threshold_setting.sql": {
    helper: "ensureProjectLogEmailFailureThresholdSetting",
  },
  // Task #1732 — per-org schedule (cadence + weekday + hour + timezone)
  // for the project-log-email failures-digest fan-out
  // (`processProjectLogEmailFailuresDigest`). Defaults preserve the
  // original "08:00 UTC daily" behavior so existing orgs upgrade as a
  // no-op. Mirrored at boot by ensureProjectLogEmailFailuresDigestSchedule.
  "0063_project_log_email_failures_digest_schedule.sql": {
    helper: "ensureProjectLogEmailFailuresDigestSchedule",
  },
  // Task #1847 — promote the ad-hoc `op: "restore"` JSON shim used by
  // the soft-delete restore routes (per-id + bulk) to a first-class
  // RESTORE value on the long-lived `audit_action` Postgres enum so
  // the audit trail is directly searchable on the `action` column.
  // `reconcileSchemaDrift` (Task #1075) creates missing enum *types*
  // but never adds values to an existing one, so the runtime helper
  // is required to keep long-lived dev / production DBs in sync.
  "0066_audit_action_restore.sql": {
    helper: "ensureAuditActionEnumValues",
    note: "Task #1847 — RESTORE added to ensureAuditActionEnumValues alongside ARCHIVE/UNARCHIVE",
  },
  "0067_rate_limit_state.sql": {
    helper: "ensureRateLimitStateTable",
    note: "Task #1831 — cross-replica backing store for the per-key debounces previously held in module-level Maps inside projectLogEmailScheduleRoutes.ts",
  },
  // Task #2096 — promote the prebuilt-catalog reset route's audit
  // entries from the generic `UPDATE` action to a first-class
  // `RESET` value on the long-lived `audit_action` Postgres enum so
  // destructive admin resets are directly searchable in the audit
  // trail instead of blending in with ordinary edits on
  // `entityType = "libraryPrebuiltCatalog"`. `reconcileSchemaDrift`
  // (Task #1075) creates missing enum *types* but never adds values
  // to an existing one, so the runtime helper is required to keep
  // long-lived dev / production DBs in sync.
  "0071_audit_action_reset.sql": {
    helper: "ensureAuditActionEnumValues",
    note: "Task #2096 — RESET added to ensureAuditActionEnumValues alongside ARCHIVE/UNARCHIVE/RESTORE",
  },
  // Task #2153 — promote the bulk library-item routes' audit entries
  // from the generic per-row CRUD actions to first-class
  // `BULK_DELETE` / `BULK_DUPLICATE` values on the long-lived
  // `audit_action` Postgres enum so destructive bulk operations are
  // directly searchable in the audit trail instead of blending in
  // with ordinary single-row edits. `reconcileSchemaDrift`
  // (Task #1075) creates missing enum *types* but never adds values
  // to an existing one, so the runtime helper is required to keep
  // long-lived dev / production DBs in sync.
  "0072_audit_action_bulk.sql": {
    helper: "ensureAuditActionEnumValues",
    note: "Task #2153 — BULK_DELETE/BULK_DUPLICATE added to ensureAuditActionEnumValues alongside ARCHIVE/UNARCHIVE/RESTORE/RESET",
  },
  // Task #2190 — adds `rp_id` to passkey_credentials so each WebAuthn
  // credential records the registration domain. Without it, login breaks
  // whenever the runtime hostname differs from the boot-time
  // REPLIT_DEV_DOMAIN. The startup helper keeps long-lived dev DBs in sync
  // even though `reconcileSchemaDrift` would also auto-add the nullable
  // column on a fresh DB.
  "0073_passkey_credentials_rp_id.sql": {
    helper: "ensurePasskeyRpIdColumn",
    note: "Task #2190 — adds nullable rp_id column so passkey verification can use the credential's own RP ID rather than a global one.",
  },
  "0074_user_settings_skip_bulk_scale_propagation_confirm.sql": {
    skip: "Task #2228 — `reconcileSchemaDrift` auto-applies the nullable boolean ADD COLUMN on dev DBs and `npx drizzle-kit push` covers prod.",
  },
  // Task #2323 — AI takeoff closed-loop feedback. Creates the
  // ai_takeoff_suggestions + ai_takeoff_confidence_calibration tables
  // plus their two enum types and indexes, and backfills one PENDING
  // suggestion row per detected item from existing
  // ai_takeoff_analyses.detected_items_json blobs.
  "0075_ai_takeoff_suggestions.sql": {
    helper: "ensureAiTakeoffSuggestionsTables",
    note: "Task #2323 — also runs the one-shot suggestion-row backfill from existing detected_items_json blobs.",
  },
  // Task #2427 — autoscale safety. Adds the `hit_count` /
  // `window_expires_at` counter columns + partial index used by
  // `PgExpressRateLimitStore` so the 5 express-rate-limit limiters in
  // `server/rateLimiter.ts` share buckets across replicas.
  "0078_rate_limit_state_counters.sql": {
    helper: "ensureRateLimitStateCounters",
    note: "Task #2427 — counter columns + partial index for express-rate-limit's Postgres-backed store.",
  },
  // Task #2414 — Claude knowledge-index enrichment pass. Adds
  // ai_estimator_knowledge_index.enriched_summary + enriched_at and
  // ai_estimator_ingest_runs.rows_enriched. All idempotent ADD COLUMN
  // IF NOT EXISTS — `reconcileSchemaDrift` (Task #1075) auto-applies
  // the nullable text/timestamp columns and the rows_enriched counter
  // (NOT NULL DEFAULT 0) on dev DBs, and `npx drizzle-kit push` covers
  // production.
  "0077_ai_estimator_enrichment_columns.sql": {
    skip: "(A) idempotent ADD COLUMN IF NOT EXISTS — reconcileSchemaDrift auto-adds (Task #1075). The NOT NULL DEFAULT 0 on rows_enriched is rendered by the synthesizer the same way as ratesUpdated, so fresh DBs and existing DBs converge.",
  },
  // Task #913 — per-view default grouping for the My Work page. Adds a
  // nullable `grouping` text column to my_work_saved_views. Column is in
  // the Drizzle schema so reconcileSchemaDrift auto-adds on fresh DBs.
  "0054_my_work_saved_views_grouping.sql": {
    skip: "(A)+(B) ADD COLUMN grouping text — auto-applied by reconcileSchemaDrift (Task #913)",
  },
  // Task #1472 — durable per-org history of davis_bacon suppression_reset
  // audit events (integration_suppression_resets table). Table is in the
  // Drizzle schema so reconcileSchemaDrift auto-creates on fresh DBs.
  "0055_integration_suppression_resets.sql": {
    skip: "(A) CREATE TABLE auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #1472)",
  },
  // Task #1747 — per-type mute snooze deadline. Adds nullable muted_until
  // timestamp to notification_type_prefs. Column is in Drizzle schema so
  // reconcileSchemaDrift auto-adds on fresh DBs.
  "0064_notification_type_prefs_muted_until.sql": {
    skip: "(A)+(B) ADD COLUMN muted_until timestamp — auto-applied by reconcileSchemaDrift (Task #1747)",
  },
  // Task #1775 — soft-delete column on plan_document_markups. Adds nullable
  // deleted_at timestamp. Column is in Drizzle schema; reconcileSchemaDrift
  // auto-adds on fresh DBs.
  "0065_plan_document_markups_deleted_at.sql": {
    skip: "(A)+(B) ADD COLUMN deleted_at timestamp — auto-applied by reconcileSchemaDrift (Task #1775)",
  },
  // Task #1974 — per-notification opaque metadata jsonb column. Column is
  // in Drizzle schema so reconcileSchemaDrift auto-adds on fresh DBs.
  "0068_notifications_metadata.sql": {
    skip: "(A)+(B) ADD COLUMN metadata jsonb — auto-applied by reconcileSchemaDrift (Task #1974)",
  },
  // Task #1955 — per-org object-storage quota (storage_quota_bytes bigint).
  // Column is in Drizzle schema so reconcileSchemaDrift auto-adds on fresh DBs.
  "0069_organization_storage_quota.sql": {
    skip: "(A)+(B) ADD COLUMN storage_quota_bytes bigint — auto-applied by reconcileSchemaDrift (Task #1955)",
  },
  // Task #2056 — cross-replica OAuth state table for Apple Sign-In.
  // Mirrored at boot by ensureOauthStateTable.
  "0070_oauth_state.sql": {
    helper: "ensureOauthStateTable",
    note: "Task #2056 — oauth_state table for persistent, cross-replica Apple Sign-In state.",
  },
  // Task #2143 — self-serve "Request access" flow. Creates access_requests
  // table. Mirrored at boot by ensureAccessRequestsTable.
  "0072_access_requests.sql": {
    helper: "ensureAccessRequestsTable",
    note: "Task #2143 — access_requests table + supporting indexes.",
  },
  // Task #2326 — per-measurement scale lock snapshot. Adds
  // locked_scale_px_per_foot double precision to takeoff_measurements.
  // Column is in Drizzle schema so reconcileSchemaDrift auto-adds.
  "0075_takeoff_measurement_scale_lock.sql": {
    skip: "(A)+(B) ADD COLUMN locked_scale_px_per_foot — auto-applied by reconcileSchemaDrift (Task #2326)",
  },
  // Task #2335 — persist AI takeoff scale-mismatch evaluations. Adds
  // columns to ai_takeoff_analyses. All in Drizzle schema.
  "0076_ai_takeoff_scale_mismatch.sql": {
    skip: "(A)+(B) ADD COLUMN — auto-applied by reconcileSchemaDrift (Task #2335)",
  },
  // Task #2466 — AI Estimator real-world upgrade Phase 1. Adds columns to
  // takeoff_sheets (discipline, sheet_number, discipline_confidence, etc.)
  // and creates ai_estimator_legend_symbols, ai_estimator_assemblies,
  // ai_estimator_org_factors tables. All in Drizzle schema.
  "0094_ai_estimator_phase1.sql": {
    skip: "(A) ADD COLUMN + CREATE TABLE — all auto-applied by reconcileSchemaDrift from Drizzle schema (Task #2466)",
  },
  // Task #2464 — per-org weakest trade callout threshold. Adds
  // weakest_trade_min_reviewed integer column to organizations.
  // Column is in Drizzle schema so reconcileSchemaDrift auto-adds.
  "0095_organizations_weakest_trade_min_reviewed.sql": {
    skip: "(A)+(B) ADD COLUMN weakest_trade_min_reviewed integer — auto-applied by reconcileSchemaDrift (Task #2464)",
  },
  // Task #2478 — tenant isolation hardening with Postgres RLS. Enables FORCE
  // row-level security on all multi-tenant tables. Mirrored at boot by
  // ensureRlsPolicies so fresh dev DBs apply the policy on every boot.
  "0096_enable_tenant_rls.sql": {
    helper: "ensureRlsPolicies",
    note: "Task #2478 — FORCE ROW LEVEL SECURITY + fail-closed policy on every multi-tenant table.",
  },
  // Task #2489 — customer support, in-app help & SLA. Creates support_tickets
  // table. Table is in Drizzle schema so reconcileSchemaDrift auto-creates
  // on fresh DBs. All ops use IF NOT EXISTS / DO blocks.
  "0096_support_tickets.sql": {
    skip: "(A) CREATE TABLE auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2489)",
  },
  // Task #2484 — COI & Insurance Compliance Lifecycle. Creates new enum types
  // (insurance_coverage_type, insurance_certificate_status, coi_party_type)
  // and tables. Enums + tables are in Drizzle schema so reconcileSchemaDrift
  // synthesizes them on fresh DBs. DO $$ EXCEPTION blocks are idempotent.
  "0097_coi_compliance_lifecycle.sql": {
    skip: "(A) CREATE TYPE + CREATE TABLE — enums and tables auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2484)",
  },
  // Task #2487 — customer onboarding, data import/export & privacy. Creates
  // org_csv_imports, org_exports, org_deletion_requests tables. All in
  // Drizzle schema so reconcileSchemaDrift auto-creates on fresh DBs.
  "0097_org_lifecycle.sql": {
    skip: "(A) CREATE TABLE — auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2487)",
  },
  // Per-org link to global subcontractors directory. Creates
  // org_subcontractor_ownership with a unique constraint. Table is in
  // Drizzle schema so reconcileSchemaDrift auto-creates on fresh DBs.
  "0098_org_subcontractor_ownership.sql": {
    skip: "(A) CREATE TABLE — auto-synthesized by reconcileSchemaDrift from Drizzle schema",
  },
  // Task #2487 round-5 — align org_deletion_requests with retention
  // semantics: requested_by_id DROP NOT NULL + organization_id FK changed to
  // ON DELETE SET NULL. Fresh DBs create the table directly from the Drizzle
  // schema with the correct nullability so no replay is needed.
  "0099_org_deletion_request_retention.sql": {
    skip: "(B) ALTER TABLE nullability + FK constraint change — fresh DBs create org_deletion_requests with correct schema directly from Drizzle (Task #2487)",
  },
  // Task #2576 — Takeoff & Estimating Phase A. Adds rollup percentage columns
  // to ai_estimator_org_factors and scope_tag / change_order_id to
  // takeoff_measurements. All columns are in Drizzle schema.
  "0100_takeoff_estimating_phase_a.sql": {
    skip: "(A)+(B) ADD COLUMN — auto-applied by reconcileSchemaDrift from Drizzle schema (Task #2576)",
  },
  // Task #2577 — Takeoff & Estimating Phase B. ADD COLUMN on takeoff_sheets
  // (extracted_text_by_page, extracted_text_source, extracted_text_at) and
  // ai_estimator_legend_symbols (review_status text). All in Drizzle schema.
  "0101_takeoff_estimating_phase_b.sql": {
    skip: "(A)+(B) ADD COLUMN — auto-applied by reconcileSchemaDrift from Drizzle schema (Task #2577)",
  },
  // Task #2578 — Takeoff & Estimating Phase C. Creates cost_book_providers,
  // crew_templates, estimate_alternates, etc. All tables are in Drizzle schema
  // so reconcileSchemaDrift auto-synthesizes on fresh DBs.
  "0102_takeoff_estimating_phase_c.sql": {
    skip: "(A) CREATE TABLE — auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2578)",
  },
  // Task #2626 — per-org configurable cap on AI Estimator map-reduce batches.
  // ADD COLUMN max_discipline_batches integer on ai_estimator_org_factors.
  // Column is in Drizzle schema so reconcileSchemaDrift auto-adds.
  "0103_ai_estimator_max_discipline_batches.sql": {
    skip: "(A)+(B) ADD COLUMN max_discipline_batches integer — auto-applied by reconcileSchemaDrift (Task #2626)",
  },
  // Task #2625 — auto-takeoff revision diff view. Creates
  // ai_estimator_takeoff_revisions table. Table is in Drizzle schema so
  // reconcileSchemaDrift auto-synthesizes on fresh DBs.
  "0103_ai_takeoff_revisions.sql": {
    skip: "(A) CREATE TABLE — auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2625)",
  },
  // Task #2623 — sheet classification confidence + review queue. ADD COLUMN
  // on takeoff_sheets (discipline_confidence_score, discipline_rationale,
  // reviewed_by_id, reviewed_at) and ai_estimator_org_factors
  // (low_confidence_threshold). All in Drizzle schema.
  "0103_sheet_review_queue.sql": {
    skip: "(A)+(B) ADD COLUMN — auto-applied by reconcileSchemaDrift from Drizzle schema (Task #2623)",
  },
  // Task #2628 — AI takeoff calibration feedback loop. Creates
  // ai_estimator_calibration_exemplars and ai_estimator_calibration_nudges
  // tables. Both are in Drizzle schema so reconcileSchemaDrift auto-creates.
  "0104_ai_takeoff_calibration_loop.sql": {
    skip: "(A) CREATE TABLE — auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2628)",
  },
  // Task #2629 — takeoff workspace hardening. ADD COLUMN version integer on
  // takeoff_measurements for optimistic concurrency. Column is in Drizzle schema.
  "0104_takeoff_measurements_versioning.sql": {
    skip: "(A)+(B) ADD COLUMN version integer — auto-applied by reconcileSchemaDrift (Task #2629)",
  },
  // Task #2668 — persist active job id + progress snapshot on
  // ai_takeoff_analyses. ADD COLUMN active_job_id, progress_snapshot,
  // progress_updated_at. All in Drizzle schema.
  "0105_ai_takeoff_progress_watchdog.sql": {
    skip: "(A)+(B) ADD COLUMN — auto-applied by reconcileSchemaDrift from Drizzle schema (Task #2668)",
  },
  // Task #2689 — GCS-first atomic closeout export. checksum + completed_at
  // columns on closeout_packages so the package row itself is the integrity
  // oracle. Mirrored at boot by ensureCloseoutPackagesAtomicColumns.
  "0106_closeout_packages_atomic_columns.sql": {
    helper: "ensureCloseoutPackagesAtomicColumns",
  },
  // Task #2690 — replaces the description-tag idempotency guard in the
  // equipment PM engine with a real FK from equipment_repairs.schedule_id
  // to equipment_maintenance_schedules(id) plus a partial unique index on
  // (schedule_id, pm_cycle_key) WHERE status NOT IN ('COMPLETED','CANCELLED').
  // Backfills both columns from existing `[PM:<uuid>]` description prefixes.
  // Renumbered 0106 -> 0107 during rebase to avoid filename collision with
  // Task #2689's 0106_closeout_packages_atomic_columns.sql, which landed
  // concurrently.
  // AI Estimator chat attachments — adds `attachments` JSONB column to
  // ai_estimator_chat_messages so the chat panel can ship files, screenshot
  // pastes and voice notes alongside the prompt. Mirrored at boot by
  // ensureAiEstimatorChatAttachmentsColumn.
  "0112_ai_estimator_chat_attachments.sql": {
    helper: "ensureAiEstimatorChatAttachmentsColumn",
  },
  // Task #2729 — proposed_actions jsonb column on ai_estimator_chat_messages
  // so Claude tool-use proposals (add/edit/delete line items) persist across
  // page refreshes as interactive Accept/Reject cards.
  "0113_ai_estimator_chat_proposed_actions.sql": {
    skip: "(A)+(B) ADD COLUMN proposed_actions jsonb — auto-applied by reconcileSchemaDrift on dev/fresh DBs (Task #2729); column is in Drizzle schema",
  },
  "0107_equipment_repairs_pm_idempotency.sql": {
    helper: "ensureEquipmentRepairsPmIdempotency",
    note: "Task #2690 — FK + partial unique index for PM-cycle idempotency, plus a one-shot backfill of historical [PM:<id>] tagged rows.",
  },
  // Task #2693 — Mobile Sync Conflict Resolution Hardening.
  // Adds `mobile_sync_events` table (per-push-op structured event log with
  // strategy/outcome/conflictPayload) and a `logical_clock` column on
  // `offline_sync_queue` for Lamport timestamps from mobile devices.
  "0108_mobile_sync_events.sql": {
    helper: "ensureMobileSyncEventsTable",
    note: "Task #2693 — mobile_sync_events table + logical_clock on offline_sync_queue.",
  },
  // Task #2694 — Portal Notification Inbox for external users (clients,
  // subcontractors, vendors). Two new tables: portal_notifications and
  // portal_notification_prefs with per-recipient partial unique indexes.
  // Tables auto-synthesized from Drizzle schema by reconcileSchemaDrift on
  // first boot. Partial unique indexes applied by the SQL file on subsequent
  // deployments via runStartupMigrations raw-SQL execution (category: ALTER).
  // Renumbered 0108 → 0109 during rebase to avoid filename collision with
  // Task #2693's 0108_mobile_sync_events.sql, which landed concurrently.
  "0109_portal_notifications.sql": {
    skip: "(A) CREATE TABLE auto-applied by reconcileSchemaDrift (Task #2694); partial unique indexes are advisory and idempotent",
  },
  // Task #2703 — AI Estimator Skills System.
  // Creates ai_estimator_skills table (global/trade/csi_division/project_type
  // scoped methodology rules with priority ordering). Table is in the Drizzle
  // schema so reconcileSchemaDrift + synthesizeMissingTables auto-creates it
  // with all indexes on fresh dev DBs. No startup helper needed.
  "0110_ai_estimator_skills.sql": {
    skip: "(A) CREATE TABLE auto-synthesized by reconcileSchemaDrift from Drizzle schema (Task #2703)",
  },
  // Task #2703 — AI Estimator Skills: soft-delete column.
  // Adds deleted_at timestamp column to ai_estimator_skills. Column is in
  // the Drizzle schema so reconcileSchemaDrift auto-adds it on fresh dev DBs.
  "0111_ai_estimator_skills_soft_delete.sql": {
    skip: "(A)+(B) ADD COLUMN auto-added by reconcileSchemaDrift; fresh DBs create column directly from Drizzle schema (Task #2703)",
  },
  // Task #2755 — OAuth reconnect alert flow.
  // Two ALTER TYPE ADD VALUE calls (needs_reconnect on
  // integration_connection_status; INTEGRATION_RECONNECT_REQUIRED on
  // notification_type). reconcileSchemaDrift creates missing enum types but
  // never appends values to existing ones, so a startup helper is required.
  "0114_oauth_reconnect_alert.sql": {
    helper: "ensureOauthReconnectAlertEnumValues",
    note: "Task #2755 / #2804 — ALTER TYPE ADD VALUE for needs_reconnect + INTEGRATION_RECONNECT_REQUIRED; enum mutations need an explicit helper.",
  },
  // Task #2780 — In-app demo request form (replaces Calendly external link).
  // Creates demo_requests table with email + created_at indexes. Mirrored
  // at boot by ensureDemoRequestsTable.
  "0115_demo_requests.sql": {
    helper: "ensureDemoRequestsTable",
    note: "Task #2780 — demo_requests table for in-app booking form.",
  },
  // Task #2780 / #2804 / #2806 — Multi-region calibration zones in Takeoff workspace.
  // Creates takeoff_sheet_calibration_zones table (named calibration regions
  // each with their own px-per-foot scale, FK to takeoff_sheets ON DELETE
  // CASCADE). Runtime helper retired in Task #2806 — numbered migration 0116
  // guards prod deployments and reconcileSchemaDrift handles fresh-DB synthesis.
  "0116_calibration_zones.sql": {
    skip: "(A) CREATE TABLE auto-synthesized by reconcileSchemaDrift; numbered migration 0116 guards prod deployments (Task #2804)",
    note: "Task #2780 / #2804 — takeoff_sheet_calibration_zones table + calibration_zones_sheet_idx index.",
  },
  // Task #2831 — Support ticket reply threads. Creates support_ticket_replies
  // table + two indexes. reconcileSchemaDrift (category A) synthesizes the
  // CREATE TABLE IF NOT EXISTS and indexes on fresh dev DBs.
  "0117_support_ticket_replies.sql": {
    skip: "(A) CREATE TABLE IF NOT EXISTS + indexes auto-synthesized by reconcileSchemaDrift on fresh dev DBs.",
  },
  // Task #2833 / #2848 — Workflow & lifecycle gap remediation. Adds enum values
  // to workflow_entity_type (SUBMITTAL, WARRANTY_CASE) and approval_entity_type
  // (INVENTORY_ADJUSTMENT), plus SLA columns on workflow_stages, overdue columns
  // on change_orders, approval columns on inventory_transactions, and a per-org
  // adjustment threshold on organizations. The ALTER TYPE ADD VALUE calls are
  // covered by ensureWorkflowLifecycleEnumValues; ADD COLUMN IF NOT EXISTS
  // statements are idempotent and handled by reconcileSchemaDrift.
  "0118_workflow_lifecycle_gaps.sql": {
    helper: "ensureWorkflowLifecycleEnumValues",
    note: "ALTER TYPE ADD VALUE IF NOT EXISTS for workflow_entity_type (SUBMITTAL, WARRANTY_CASE) and approval_entity_type (INVENTORY_ADJUSTMENT); reconcileSchemaDrift handles the ADD COLUMN IF NOT EXISTS statements.",
  },
  // Task #2843 — Composite indexes to speed up filtered time-entry and estimate
  // queries. CREATE INDEX IF NOT EXISTS is idempotent; reconcileSchemaDrift
  // (category A) will re-create the indexes on fresh dev DBs if they are
  // missing. No structural schema change; no startup helper required.
  "0119_time_entry_and_estimate_indexes.sql": {
    skip: "(A) CREATE INDEX IF NOT EXISTS — idempotent DDL, applied by numbered migration runner; reconcileSchemaDrift re-creates missing indexes on fresh dev DBs (Task #2843).",
  },
};
