import { logInfo, logError, logWarn } from "./logger";
import { reconcileSchemaDrift } from "./schemaDriftDetector";

import { ensureVideoCallTables } from "./ensureVideoCallTables";
import { ensureEstimateSubcontractorTables } from "./ensureEstimateSubcontractorTables";
import { ensureLineItemPhotoUrls } from "./ensureLineItemPhotoUrls";
import { ensureEquipmentColumns } from "./ensureEquipmentColumns";
import { ensureMessageColumns } from "./ensureMessageColumns";
import { ensureNotificationEnumValues } from "./ensureNotificationEnumValues";
import { ensureIntegrationSyncStateFailureColumns } from "./ensureIntegrationSyncStateFailureColumns";
import { ensureIntegrationSyncStateExhaustedNotifiedColumn } from "./ensureIntegrationSyncStateExhaustedNotifiedColumn";
import { ensureIntegrationSyncAlertMutes } from "./ensureIntegrationSyncAlertMutes";
import { ensureWageDecisionRateChanges } from "./ensureWageDecisionRateChanges";
import { ensureWageDecisionRateChangeAcknowledgements } from "./ensureWageDecisionRateChangeAcknowledgements";
import { ensureOneShotJobRuns } from "./ensureOneShotJobRuns";
import { ensureEstimateCategoryEnumValues } from "./ensureEstimateCategoryEnumValues";
import { ensureTakeoffEnhancements } from "./ensureTakeoffEnhancements";
import { ensureFieldWorkerPermColumns } from "./ensureFieldWorkerPermColumns";
import { ensurePeerRatingColumns } from "./ensurePeerRatingColumns";
import { ensureNullablePermissions } from "./ensureNullablePermissions";
import { ensurePermissionPresetsTable } from "./ensurePermissionPresetsTable";
import { ensureLidarTables } from "./ensureLidarTables";
import { ensureErrorLogsTable } from "./ensureErrorLogsTable";
import { ensureScopeModifierTables } from "./ensureScopeModifierTables";
import { ensureStackctProviderEnum } from "./ensureStackctProviderEnum";
import { ensureDotIntegrationSchema } from "./ensureDotIntegrationSchema";
import { ensureMobilizationTables } from "./ensureMobilizationTables";
import { ensurePermitTables } from "./ensurePermitTables";
import { ensureMaterialTestTables } from "./ensureMaterialTestTables";
import { ensureReportsTables } from "./ensureReportsTables";
import { ensureMobileExchangeCodes } from "./ensureMobileExchangeCodes";
import { ensureSocialEngagementColumns } from "./ensureSocialEngagementColumns";
import { ensureEmailCampaignTables } from "./ensureEmailCampaignTables";
import { ensureWorkflowTables } from "./ensureWorkflowTables";
import { ensureMissingDrizzleTables } from "./ensureMissingDrizzleTables";
import { ensureGeofenceEnhancements } from "./ensureGeofenceEnhancements";
import { ensureSiteLeaveTable } from "./ensureSiteLeaveTable";
import { ensurePurchaseOrderColumns } from "./ensurePurchaseOrderColumns";
import { ensureCrmOrgTypeEnumValues } from "./ensureCrmOrgTypeEnumValues";
import { ensureDotTables } from "./ensureDotTables";
import { ensurePayrollFormVariantColumn } from "./ensurePayrollFormVariantColumn";
import { ensureCertifiedPayrollArchiveColumns } from "./ensureCertifiedPayrollArchiveColumns";
import { ensureCertifiedPayrollArchivedRetention } from "./ensureCertifiedPayrollArchivedRetention";
import { ensureCertifiedPayrollDigestScheduleColumns } from "./ensureCertifiedPayrollDigestScheduleColumns";
import { ensureRateChangeSigningPolicyColumns } from "./ensureRateChangeSigningPolicyColumns";
import { ensureMaterialCertColumns } from "./ensureMaterialCertColumns";
import { ensureHeavyCivilDocumentColumns } from "./ensureHeavyCivilDocumentColumns";
import { ensurePlanDocumentsOrgScope } from "./ensurePlanDocumentsOrgScope";
import { ensureCrmOrgCertDocumentColumn } from "./ensureCrmOrgCertDocumentColumn";
import { ensureHeavyCivilEnumValues } from "./ensureHeavyCivilEnumValues";
import { ensureHeavyCivilTables } from "./ensureHeavyCivilTables";
import { ensureProjectHealthSnapshotColumns } from "./ensureProjectHealthSnapshotColumns";
import { ensureCrmEnhancementTables } from "./ensureCrmEnhancementTables";
import { ensureCrmOrganisationCertColumns } from "./ensureCrmOrganisationCertColumns";
import { ensureEmailAccountPushColumns } from "./ensureEmailAccountPushColumns";
import { ensureSequenceTables } from "./ensureSequenceTables";
import { ensureUserSettingsTableDensity } from "./ensureUserSettingsTableDensity";
import { ensureUserSettingsCrmBirthdayDigestOptOut } from "./ensureUserSettingsCrmBirthdayDigestOptOut";
import { ensureUserSettingsBirthdayDigestSchedule } from "./ensureUserSettingsBirthdayDigestSchedule";
import { ensureCrmCustomFieldTables } from "./ensureCrmCustomFieldTables";
import { ensureGeocodeStatusColumns } from "./ensureGeocodeStatusColumns";
import { ensureUserSavedViewsTable } from "./ensureUserSavedViewsTable";
import { ensureMyWorkSavedViewsTable } from "./ensureMyWorkSavedViewsTable";
import { ensureScheduleBaselinesTable } from "./ensureScheduleBaselinesTable";
import { ensurePlanPinsTable } from "./ensurePlanPinsTable";
import { ensureProjectEmailDistributionLists } from "./ensureProjectEmailDistributionLists";
import { ensureGanttPdfRenderSamplesTable } from "./ensureGanttPdfRenderSamplesTable";
import { ensurePortfolioPdfRenderSamplesTable } from "./ensurePortfolioPdfRenderSamplesTable";
import { ensureCrmCsvImportPayloadColumn } from "./ensureCrmCsvImportPayloadColumn";
import { ensureCrmContactBirthdayColumn } from "./ensureCrmContactBirthdayColumn";
import { ensureCrmContactTimezoneColumn } from "./ensureCrmContactTimezoneColumn";
import { ensureCrmContactTimezoneBackfill } from "./ensureCrmContactTimezoneBackfill";
import { ensureBirthdayReminderCadenceColumn } from "./ensureBirthdayReminderCadenceColumn";
import { ensureJobMetricAlertTables } from "./ensureJobMetricAlertTables";
import { ensureUsersJobMetricAlertEmailsColumn } from "./ensureUsersJobMetricAlertEmailsColumn";
import { ensureUsersJobMetricAlertQuietHoursColumns } from "./ensureUsersJobMetricAlertQuietHoursColumns";
import { ensureUsersJobMetricAlertQuietHoursDigestColumns } from "./ensureUsersJobMetricAlertQuietHoursDigestColumns";
import { ensureUsersCrmAlertFailureFallbackColumns } from "./ensureUsersCrmAlertFailureFallbackColumns";
import { ensurePendingContactReassignmentTable } from "./ensurePendingContactReassignmentTable";
import { ensureCrmOrganisationOwnerColumn } from "./ensureCrmOrganisationOwnerColumn";
import { ensureSchedulingModuleEnhancements } from "./ensureSchedulingModuleEnhancements";
import { ensureStatusPageTables } from "./ensureStatusPageTables";
import { backfillStatusProbeDailyHistory } from "./backfillStatusProbeDailyHistory";
import { ensureMobileOfflineEnumValues } from "./ensureMobileOfflineEnumValues";
import { ensureCrmEmailLoggingTables } from "./ensureCrmEmailLoggingTables";
import { ensureUsersManagerIdColumn } from "./ensureUsersManagerIdColumn";
import { ensureProjectTemplateTables } from "./ensureProjectTemplateTables";
import { ensureCrmCallTables } from "./ensureCrmCallTables";
import { ensureProjectsRollupColumns } from "./ensureProjectsRollupColumns";
import { ensureGanttPdfAlertTables } from "./ensureGanttPdfAlertTables";
import { ensurePortfolioPdfAlertTables } from "./ensurePortfolioPdfAlertTables";
import { ensurePdfAlertSharedTables } from "./ensurePdfAlertSharedTables";
import { ensureProjectKpiSnapshotsTable } from "./ensureProjectKpiSnapshotsTable";
import { ensureSwpppCorrectiveActionStatus } from "./ensureSwpppCorrectiveActionStatus";
import { ensureSwpppOverdueNotificationColumn } from "./ensureSwpppOverdueNotificationColumn";
import { ensureSwpppOverdueReminderSettings } from "./ensureSwpppOverdueReminderSettings";
import { ensureCrmTranscriptBackfillJobsTable } from "./ensureCrmTranscriptBackfillJobsTable";
import { ensureCrmTranscriptBackfillNotificationSettingsTable } from "./ensureCrmTranscriptBackfillNotificationSettingsTable";
import { ensureFeatureFlagPresetApplicationsTable } from "./ensureFeatureFlagPresetApplicationsTable";
import { ensureFeatureFlagManualChangesTable } from "./ensureFeatureFlagManualChangesTable";
import { ensureDotPayItemMatchHistory } from "./ensureDotPayItemMatchHistory";
import { ensureDolClassificationMappingsTable } from "./ensureDolClassificationMappingsTable";
import { ensureCrmTranscriptBackfillNotificationsTable } from "./ensureCrmTranscriptBackfillNotificationsTable";
import { ensureCrmTranscriptBackfillAlertDeliveriesTable } from "./ensureCrmTranscriptBackfillAlertDeliveriesTable";
import { ensureUsersAlertFailureEmailModeColumn } from "./ensureUsersAlertFailureEmailModeColumn";
import { ensureUsersIntegrationSyncExhaustedEmailOptOutColumn } from "./ensureUsersIntegrationSyncExhaustedEmailOptOutColumn";
import { ensureUsersCrmBackfillSummaryPreferenceColumns } from "./ensureUsersCrmBackfillSummaryPreferenceColumns";
import { ensureCrmTranscriptBackfillTestAlertsTable } from "./ensureCrmTranscriptBackfillTestAlertsTable";
import { ensureCrmAndReportingTables } from "./ensureCrmAndReportingTables";
import { ensureCrmTranscriptBackfillAlertResendCooldownsTable } from "./ensureCrmTranscriptBackfillAlertResendCooldownsTable";
import { runCertifiedPayrollBackfillOnce } from "./runCertifiedPayrollBackfillOnce";
import { runExhaustedSyncRetryAlertsBackfillOnce } from "./runExhaustedSyncRetryAlertsBackfillOnce";
import { ensureSovStatusEnumValues } from "./ensureSovStatusEnumValues";
import { ensureAuditActionEnumValues } from "./ensureAuditActionEnumValues";
import { ensureCalendarEventTypeEnumValues } from "./ensureCalendarEventTypeEnumValues";

type MigrationCategory = "CREATE_TABLE" | "ADD_COLUMN" | "ADD_ENUM" | "ALTER_TABLE";

interface MigrationStep {
  name: string;
  category: MigrationCategory;
  // Returned values are ignored — return type is widened so migration
  // helpers can also be reused by Super-Admin re-run endpoints that surface
  // structured stats (e.g. Task #1413's exhausted_sync_retry_alerts re-run).
  fn: () => Promise<unknown>;
}

const migrations: MigrationStep[] = [
  { name: "dot_tables", category: "CREATE_TABLE", fn: ensureDotTables },
  { name: "video_call_tables", category: "CREATE_TABLE", fn: ensureVideoCallTables },
  { name: "estimate_subcontractor_tables", category: "CREATE_TABLE", fn: ensureEstimateSubcontractorTables },
  { name: "line_item_photo_urls", category: "ADD_COLUMN", fn: ensureLineItemPhotoUrls },
  { name: "equipment_columns", category: "ADD_COLUMN", fn: ensureEquipmentColumns },
  { name: "message_columns", category: "ADD_COLUMN", fn: ensureMessageColumns },
  { name: "notification_enum_values", category: "ADD_ENUM", fn: ensureNotificationEnumValues },
  // Task #1332 — adds last_attempt_at + last_error to integration_sync_state
  // so the Davis-Bacon background sync can persist failure state per
  // wage decision and surface it in the Project payroll banner.
  { name: "integration_sync_state_failure_columns", category: "ADD_COLUMN", fn: ensureIntegrationSyncStateFailureColumns },
  { name: "integration_sync_state_exhausted_notified_column", category: "ADD_COLUMN", fn: ensureIntegrationSyncStateExhaustedNotifiedColumn },
  // Task #1404 — per-connection / per-entity mute state for the
  // INTEGRATION_SYNC_RETRIES_EXHAUSTED admin fan-out.
  { name: "integration_sync_alert_mutes", category: "CREATE_TABLE", fn: ensureIntegrationSyncAlertMutes },
  // Task #1409 — per-classification record of the most recent
  // Davis-Bacon stale-refresh diff so the project prevailing wage panel
  // can flag classifications whose rate just changed.
  { name: "wage_decision_rate_changes", category: "CREATE_TABLE", fn: ensureWageDecisionRateChanges },
  // Task #1480 — append-only audit history of every PM acknowledgement
  // of a Davis-Bacon rate-change flag. Lets the prevailing-wage panel
  // surface a chronological trail per classification even after the
  // live row was re-armed or auto-cleared.
  { name: "wage_decision_rate_change_acknowledgements", category: "CREATE_TABLE", fn: ensureWageDecisionRateChangeAcknowledgements },
  // Task #1528 — structured history of admin one-shot job re-runs.
  // Replaces the previous practice of regex-parsing the audit_log
  // newValue string in the admin "One-shot jobs" panel.
  { name: "one_shot_job_runs", category: "CREATE_TABLE", fn: ensureOneShotJobRuns },
  { name: "estimate_category_enum_values", category: "ADD_ENUM", fn: ensureEstimateCategoryEnumValues },
  // Task #1144 — close baseline-migration gaps for ALTER TYPE ADD VALUE
  // operations that `reconcileSchemaDrift` cannot replay (it creates missing
  // enum *types* but not missing values on existing types).
  { name: "sov_status_enum_values", category: "ADD_ENUM", fn: ensureSovStatusEnumValues },
  // Task #1180 — adds ARCHIVE / UNARCHIVE values used by the certified
  // payroll archive admin endpoints in `server/payrollRoutes.ts`.
  { name: "audit_action_enum_values", category: "ADD_ENUM", fn: ensureAuditActionEnumValues },
  { name: "calendar_event_type_enum_values", category: "ADD_ENUM", fn: ensureCalendarEventTypeEnumValues },
  { name: "takeoff_enhancements", category: "ADD_COLUMN", fn: ensureTakeoffEnhancements },
  { name: "field_worker_perm_columns", category: "ADD_COLUMN", fn: ensureFieldWorkerPermColumns },
  { name: "peer_rating_columns", category: "ADD_COLUMN", fn: ensurePeerRatingColumns },
  { name: "nullable_permissions", category: "ALTER_TABLE", fn: ensureNullablePermissions },
  { name: "permission_presets_table", category: "CREATE_TABLE", fn: ensurePermissionPresetsTable },
  { name: "lidar_tables", category: "CREATE_TABLE", fn: ensureLidarTables },
  { name: "error_logs_table", category: "CREATE_TABLE", fn: ensureErrorLogsTable },
  { name: "scope_modifier_tables", category: "CREATE_TABLE", fn: ensureScopeModifierTables },
  { name: "stackct_provider_enum", category: "ADD_ENUM", fn: ensureStackctProviderEnum },
  { name: "dot_integration_schema", category: "ADD_ENUM", fn: ensureDotIntegrationSchema },
  { name: "mobilization_tables", category: "CREATE_TABLE", fn: ensureMobilizationTables },
  { name: "permit_tables", category: "CREATE_TABLE", fn: ensurePermitTables },
  { name: "material_test_tables", category: "CREATE_TABLE", fn: ensureMaterialTestTables },
  { name: "project_reports_table", category: "CREATE_TABLE", fn: ensureReportsTables },
  { name: "mobile_exchange_codes_table", category: "CREATE_TABLE", fn: ensureMobileExchangeCodes },
  { name: "social_engagement_columns", category: "ADD_COLUMN", fn: ensureSocialEngagementColumns },
  { name: "email_campaign_tables", category: "CREATE_TABLE", fn: ensureEmailCampaignTables },
  { name: "workflow_tables", category: "CREATE_TABLE", fn: ensureWorkflowTables },
  { name: "missing_drizzle_tables", category: "CREATE_TABLE", fn: ensureMissingDrizzleTables },
  { name: "geofence_enhancements", category: "ADD_COLUMN", fn: ensureGeofenceEnhancements },
  { name: "site_leave_table", category: "CREATE_TABLE", fn: ensureSiteLeaveTable },
  { name: "purchase_order_columns", category: "ADD_COLUMN", fn: ensurePurchaseOrderColumns },
  { name: "crm_org_type_enum_values", category: "ADD_ENUM", fn: ensureCrmOrgTypeEnumValues },
  { name: "payroll_form_variant_column", category: "ADD_COLUMN", fn: ensurePayrollFormVariantColumn },
  { name: "certified_payroll_archive_columns", category: "ADD_COLUMN", fn: ensureCertifiedPayrollArchiveColumns },
  { name: "certified_payroll_archived_retention", category: "ADD_COLUMN", fn: ensureCertifiedPayrollArchivedRetention },
  { name: "certified_payroll_digest_schedule_columns", category: "ADD_COLUMN", fn: ensureCertifiedPayrollDigestScheduleColumns },
  // Task #1485 — per-org + per-project policy column gating certified-payroll
  // PDF generation when there are unacknowledged Davis-Bacon rate changes.
  { name: "rate_change_signing_policy_columns", category: "ADD_COLUMN", fn: ensureRateChangeSigningPolicyColumns },
  { name: "material_cert_submit_columns", category: "ADD_COLUMN", fn: ensureMaterialCertColumns },
  { name: "heavy_civil_enum_values", category: "ADD_ENUM", fn: ensureHeavyCivilEnumValues },
  { name: "project_health_snapshot_columns", category: "ADD_COLUMN", fn: ensureProjectHealthSnapshotColumns },
  { name: "heavy_civil_tables", category: "CREATE_TABLE", fn: ensureHeavyCivilTables },
  { name: "heavy_civil_document_columns", category: "ADD_COLUMN", fn: ensureHeavyCivilDocumentColumns },
  // Task #491 — relax plan_documents.project_id NOT NULL and add scope/
  // organization_id discriminator so DBE/MBE/WBE certification uploads can
  // be org-scoped first-class plan_documents rows with revision history.
  { name: "plan_documents_org_scope", category: "ALTER_TABLE", fn: ensurePlanDocumentsOrgScope },
  // Task #491 — adds crm_organisation_certifications.document_id FK so
  // re-uploading a cert keeps a full revision history instead of clobbering
  // the legacy document_url.
  { name: "crm_org_cert_document_column", category: "ADD_COLUMN", fn: ensureCrmOrgCertDocumentColumn },
  { name: "crm_enhancement_tables", category: "CREATE_TABLE", fn: ensureCrmEnhancementTables },
  { name: "crm_organisation_cert_columns", category: "ADD_COLUMN", fn: ensureCrmOrganisationCertColumns },
  { name: "email_account_push_columns", category: "ADD_COLUMN", fn: ensureEmailAccountPushColumns },
  { name: "crm_sequence_tables", category: "CREATE_TABLE", fn: ensureSequenceTables },
  { name: "user_settings_table_density", category: "ADD_COLUMN", fn: ensureUserSettingsTableDensity },
  { name: "user_settings_crm_birthday_digest_opt_out", category: "ADD_COLUMN", fn: ensureUserSettingsCrmBirthdayDigestOptOut },
  { name: "user_settings_birthday_digest_schedule", category: "ADD_COLUMN", fn: ensureUserSettingsBirthdayDigestSchedule },
  { name: "crm_custom_field_tables", category: "CREATE_TABLE", fn: ensureCrmCustomFieldTables },
  { name: "user_saved_views_table", category: "CREATE_TABLE", fn: ensureUserSavedViewsTable },
  { name: "my_work_saved_views_table", category: "CREATE_TABLE", fn: ensureMyWorkSavedViewsTable },
  { name: "schedule_baselines_table", category: "CREATE_TABLE", fn: ensureScheduleBaselinesTable },
  { name: "plan_pins_table", category: "CREATE_TABLE", fn: ensurePlanPinsTable },
  { name: "project_email_distribution_lists", category: "CREATE_TABLE", fn: ensureProjectEmailDistributionLists },
  { name: "geocode_status_columns", category: "ADD_COLUMN", fn: ensureGeocodeStatusColumns },
  { name: "gantt_pdf_render_samples_table", category: "CREATE_TABLE", fn: ensureGanttPdfRenderSamplesTable },
  { name: "portfolio_pdf_render_samples_table", category: "CREATE_TABLE", fn: ensurePortfolioPdfRenderSamplesTable },
  { name: "crm_csv_import_payload_column", category: "ADD_COLUMN", fn: ensureCrmCsvImportPayloadColumn },
  { name: "crm_contact_birthday_column", category: "ADD_COLUMN", fn: ensureCrmContactBirthdayColumn },
  { name: "crm_contact_timezone_column", category: "ADD_COLUMN", fn: ensureCrmContactTimezoneColumn },
  { name: "crm_contact_timezone_backfill", category: "ALTER_TABLE", fn: ensureCrmContactTimezoneBackfill },
  { name: "birthday_reminder_cadence_column", category: "ADD_COLUMN", fn: ensureBirthdayReminderCadenceColumn },
  { name: "job_metric_alert_tables", category: "CREATE_TABLE", fn: ensureJobMetricAlertTables },
  { name: "users_receives_job_metric_alert_emails_column", category: "ADD_COLUMN", fn: ensureUsersJobMetricAlertEmailsColumn },
  { name: "users_job_metric_alert_quiet_hours_columns", category: "ADD_COLUMN", fn: ensureUsersJobMetricAlertQuietHoursColumns },
  { name: "users_job_metric_alert_quiet_hours_digest_columns", category: "ADD_COLUMN", fn: ensureUsersJobMetricAlertQuietHoursDigestColumns },
  { name: "pending_contact_reassignment_notifications_table", category: "CREATE_TABLE", fn: ensurePendingContactReassignmentTable },
  { name: "crm_organisation_owner_column", category: "ADD_COLUMN", fn: ensureCrmOrganisationOwnerColumn },
  { name: "scheduling_module_enhancements", category: "CREATE_TABLE", fn: ensureSchedulingModuleEnhancements },
  { name: "status_page_tables", category: "CREATE_TABLE", fn: ensureStatusPageTables },
  { name: "status_probe_daily_history_backfill", category: "ALTER_TABLE", fn: backfillStatusProbeDailyHistory },
  { name: "mobile_offline_enum_values", category: "ADD_ENUM", fn: ensureMobileOfflineEnumValues },
  { name: "crm_email_logging_tables", category: "CREATE_TABLE", fn: ensureCrmEmailLoggingTables },
  { name: "users_manager_id_column", category: "ADD_COLUMN", fn: ensureUsersManagerIdColumn },
  { name: "project_template_tables", category: "CREATE_TABLE", fn: ensureProjectTemplateTables },
  { name: "crm_call_tables", category: "CREATE_TABLE", fn: ensureCrmCallTables },
  { name: "projects_rollup_columns", category: "ADD_COLUMN", fn: ensureProjectsRollupColumns },
  { name: "gantt_pdf_alert_tables", category: "CREATE_TABLE", fn: ensureGanttPdfAlertTables },
  { name: "portfolio_pdf_alert_tables", category: "CREATE_TABLE", fn: ensurePortfolioPdfAlertTables },
  // Task #990: must run AFTER both legacy tables exist so backfill copies forward.
  { name: "pdf_alert_shared_tables", category: "CREATE_TABLE", fn: ensurePdfAlertSharedTables },
  { name: "project_kpi_snapshots_table", category: "CREATE_TABLE", fn: ensureProjectKpiSnapshotsTable },
  { name: "swppp_corrective_action_status", category: "ADD_COLUMN", fn: ensureSwpppCorrectiveActionStatus },
  // Task #1173 — adds the per-inspection dedupe marker the SWPPP overdue
  // notification sweep relies on. Idempotent ADD COLUMN IF NOT EXISTS.
  { name: "swppp_overdue_notification_column", category: "ADD_COLUMN", fn: ensureSwpppOverdueNotificationColumn },
  // Task #1286 — per-org SWPPP overdue reminder cap + interval columns.
  { name: "swppp_overdue_reminder_settings", category: "ADD_COLUMN", fn: ensureSwpppOverdueReminderSettings },
  { name: "crm_transcript_backfill_jobs_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillJobsTable },
  { name: "crm_transcript_backfill_notification_settings_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillNotificationSettingsTable },
  // Task #1022 — must run AFTER the jobs table since it FK-references it.
  { name: "crm_transcript_backfill_notifications_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillNotificationsTable },
  { name: "crm_transcript_backfill_alert_deliveries_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillAlertDeliveriesTable },
  // Task #1062 — mirrors migrations/0037_crm_transcript_backfill_test_alerts.sql
  // which was not being auto-applied, leaving the test-alert latest/history
  // endpoints returning 500s on fresh environments.
  { name: "crm_transcript_backfill_test_alerts_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillTestAlertsTable },
  // Task #1066 — per-admin mute for the alert delivery failure fallback
  // emails (Task #1051). Adds two columns to `users`.
  { name: "users_crm_alert_failure_fallback_columns", category: "ADD_COLUMN", fn: ensureUsersCrmAlertFailureFallbackColumns },
  // Task #1076 — per-admin opt-in for real-time vs digest alert-failure emails.
  { name: "users_alert_failure_email_mode_column", category: "ADD_COLUMN", fn: ensureUsersAlertFailureEmailModeColumn },
  // Task #1414 — per-admin opt-out for the INTEGRATION_SYNC_RETRIES_EXHAUSTED
  // transactional email (email-by-default for the "sync gave up" alert).
  { name: "users_integration_sync_exhausted_email_opt_out_column", category: "ADD_COLUMN", fn: ensureUsersIntegrationSyncExhaustedEmailOptOutColumn },
  // Task #1089 — mirrors migrations/0037_backfill_summary_preferences.sql so
  // fresh dev DBs get the `crm_backfill_summary_channel` enum/column and the
  // `crm_backfill_summary_on_failure_only` flag without needing manual psql.
  { name: "users_crm_backfill_summary_preference_columns", category: "ADD_COLUMN", fn: ensureUsersCrmBackfillSummaryPreferenceColumns },
  // Task #1087 — fresh checkouts were missing 14 CRM/reporting tables that
  // never had a static migration. The schema-drift reconciler only adds
  // missing columns/enums, never whole tables, so users had to run
  // `npx drizzle-kit push` by hand. This batched ensure-* migration mirrors
  // the Drizzle schema so a clean `npm run dev` reports zero missing tables.
  { name: "crm_and_reporting_tables", category: "CREATE_TABLE", fn: ensureCrmAndReportingTables },
  // Task #1092 — final missing Drizzle table flagged by the schema-drift audit.
  // Mirrors `crmTranscriptBackfillAlertResendCooldowns` in
  // `shared/schema/operations.ts` so fresh checkouts don't 500 the moment the
  // transcript-backfill notification service tries to reserve a cooldown.
  { name: "crm_transcript_backfill_alert_resend_cooldowns_table", category: "CREATE_TABLE", fn: ensureCrmTranscriptBackfillAlertResendCooldownsTable },
  // Task #1118 — first-deploy auto-trigger for the certified-payroll PDF
  // backfill. Runs once per environment (gated by a `one_shot_jobs` ledger
  // row) so tenants get their pre-audit-table PDFs into the history tab
  // automatically. Subsequent startups read a single row and no-op.
  // Must run AFTER `heavy_civil_tables` so `certified_payroll_reports` exists.
  { name: "certified_payroll_backfill_once", category: "ALTER_TABLE", fn: runCertifiedPayrollBackfillOnce },
  // Task #1405 — one-shot fan-out of the new "integration sync gave up" admin
  // alert (Task #1391) for sync rows that were already exhausted before that
  // feature shipped. Must run AFTER `integration_sync_state_exhausted_notified_column`
  // so the marker column exists. Idempotent: a `one_shot_jobs` ledger row
  // makes subsequent startups a single SELECT.
  { name: "exhausted_sync_retry_alerts_backfill_once", category: "ALTER_TABLE", fn: runExhaustedSyncRetryAlertsBackfillOnce },
  // Task #1119 — audit log for trade-preset applications shown on the
  // Feature Flags tab (Last applied: <preset> on <date> by <user>).
  { name: "feature_flag_preset_applications_table", category: "CREATE_TABLE", fn: ensureFeatureFlagPresetApplicationsTable },
  { name: "feature_flag_manual_changes_table", category: "CREATE_TABLE", fn: ensureFeatureFlagManualChangesTable },
  // Task #1164 — match-history table for boosting frequently-accepted DOT pay
  // items. Must run AFTER `dot_tables` so dot_pay_items / dot_agencies exist.
  { name: "dot_pay_item_match_history", category: "CREATE_TABLE", fn: ensureDotPayItemMatchHistory },
  // Task #1396 — per-project mapping of DOL feed classification names to the
  // chosen `job_classifications` row. Must run AFTER `job_classifications`
  // exists (Drizzle migrations cover that baseline table).
  { name: "dol_classification_mappings_table", category: "CREATE_TABLE", fn: ensureDolClassificationMappingsTable },
];

export async function runStartupMigrations(): Promise<void> {
  const start = Date.now();
  const failed: string[] = [];

  const originalLog = console.log;
  const originalError = console.error;
  const capturedLogs: string[] = [];
  let appliedCount = 0;

  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("[migration]") || msg.includes("ensureErrorLogsTable")) {
      capturedLogs.push(msg);
      if (msg.includes("— applied") || msg.includes("— created") || msg.includes("added") || msg.includes("table ready")) {
        appliedCount++;
        originalLog(msg);
      }
    } else {
      originalLog(...args);
    }
  };

  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("[migration]")) {
      capturedLogs.push(msg);
    }
    originalError(...args);
  };

  for (const step of migrations) {
    const stepStart = Date.now();
    try {
      await step.fn();
      const stepElapsed = Date.now() - stepStart;
      if (stepElapsed > 5000) {
        originalLog(`[migration] ${step.name} (${step.category}) completed in ${stepElapsed}ms (slow)`);
      }
    } catch (err) {
      const stepElapsed = Date.now() - stepStart;
      failed.push(step.name);
      originalError(`[migration] ${step.name} (${step.category}) failed after ${stepElapsed}ms:`, err);
      logError(`Migration step failed: ${step.name} (${step.category})`, { stepElapsed }, err instanceof Error ? err : new Error(String(err)));
    }
  }

  console.log = originalLog;
  console.error = originalError;

  const elapsed = Date.now() - start;
  const total = migrations.length;
  const skipped = total - appliedCount - failed.length;

  const categoryCounts = migrations.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const categoryBreakdown = Object.entries(categoryCounts).map(([k, v]) => `${v} ${k}`).join(", ");

  if (failed.length > 0) {
    logError(`[migrations] ${total} checks complete in ${elapsed}ms: ${appliedCount} applied, ${skipped} skipped, ${failed.length} FAILED (${failed.join(", ")}) — breakdown: ${categoryBreakdown}`);
  } else {
    logInfo(`[migrations] ${total} checks complete in ${elapsed}ms — ${appliedCount} applied, ${skipped} up-to-date — breakdown: ${categoryBreakdown}`);
  }

  // Task #1075: detect schema drift (missing tables AND missing columns) and,
  // in dev, auto-apply the safe append-only fixes (ADD COLUMN IF NOT EXISTS)
  // so a freshly-pulled checkout doesn't 500 on /api/dev/test-login because
  // of new columns like `users.crm_backfill_summary_channel`. Anything not
  // safely auto-fixable (missing tables, ambiguous renames) is surfaced as a
  // loud, actionable banner pointing at `npx drizzle-kit push`. In production
  // we never auto-mutate the schema — `reconcileSchemaDrift` throws so the
  // deploy fails loudly with the same banner.
  try {
    await reconcileSchemaDrift();
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      logError(
        "[migrations] Schema drift reconcile failed in production — exiting.",
        {},
        err instanceof Error ? err : new Error(String(err)),
      );
      process.exit(1);
    }
    logWarn("[migrations] Schema drift reconcile failed (non-fatal in dev)");
  }
}
