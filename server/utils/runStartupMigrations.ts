import { logInfo, logError, logWarn, captureConsoleDuring } from "./logger";
import { reconcileSchemaDrift } from "./schemaDriftDetector";

import { ensureVideoCallTables } from "./ensureVideoCallTables";
import { ensureEstimateSubcontractorTables } from "./ensureEstimateSubcontractorTables";
import { ensureLineItemPhotoUrls } from "./ensureLineItemPhotoUrls";
import { ensureEquipmentColumns } from "./ensureEquipmentColumns";
import { ensureMessageColumns } from "./ensureMessageColumns";
import { ensureNotificationEnumValues } from "./ensureNotificationEnumValues";
import { ensureNotificationTypePrefsMutedUntil } from "./ensureNotificationTypePrefsMutedUntil";
import { ensureNotificationsMetadata } from "./ensureNotificationsMetadata";
import { ensureIntegrationSyncStateFailureColumns } from "./ensureIntegrationSyncStateFailureColumns";
import { ensureIntegrationSyncStateExhaustedNotifiedColumn } from "./ensureIntegrationSyncStateExhaustedNotifiedColumn";
import { ensureIntegrationSyncAlertMutes } from "./ensureIntegrationSyncAlertMutes";
import { ensureWageDecisionRateChanges } from "./ensureWageDecisionRateChanges";
import { ensureSageAccountMappingsTable } from "./ensureSageAccountMappingsTable";
import { ensureRlsPolicies } from "./ensureRlsPolicies";
import { ensureWageDecisionRateChangeAcknowledgements } from "./ensureWageDecisionRateChangeAcknowledgements";
import { ensureOneShotJobRuns } from "./ensureOneShotJobRuns";
import { ensureEstimateCategoryEnumValues } from "./ensureEstimateCategoryEnumValues";
import { ensureTakeoffEnhancements } from "./ensureTakeoffEnhancements";
import { ensureLibraryCategoryTier } from "./ensureLibraryCategoryTier";
import { ensureFieldWorkerPermColumns } from "./ensureFieldWorkerPermColumns";
import { ensurePeerRatingColumns } from "./ensurePeerRatingColumns";
import { ensureNullablePermissions } from "./ensureNullablePermissions";
import { ensurePermissionPresetsTable } from "./ensurePermissionPresetsTable";
import { ensureAccessRequestsTable } from "./ensureAccessRequestsTable";
import { ensureAiTakeoffSuggestionsTables } from "./ensureAiTakeoffSuggestionsTables";
import { ensureAiEstimatorProvenanceTables } from "./ensureAiEstimatorProvenanceTables";
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
import { ensureTakeoffStylusTelemetryEventsTable } from "./ensureTakeoffStylusTelemetryEventsTable";
import { ensureGeofenceEnhancements } from "./ensureGeofenceEnhancements";
import { ensureSiteLeaveTable } from "./ensureSiteLeaveTable";
import { ensureCloseoutPackagesAtomicColumns } from "./ensureCloseoutPackagesAtomicColumns";
import { ensureCsiScopeColumns } from "./ensureCsiScopeColumns";
import { ensureAiEstimatorChatAttachmentsColumn } from "./ensureAiEstimatorChatAttachmentsColumn";
import { ensurePurchaseOrderColumns } from "./ensurePurchaseOrderColumns";
import { ensureCrmOrgTypeEnumValues } from "./ensureCrmOrgTypeEnumValues";
import { ensureDotTables } from "./ensureDotTables";
import { ensureDotPayItemPickerFacetsTable } from "./ensureDotPayItemPickerFacetsTable";
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
import { ensureSupportTicketReplies } from "./ensureSupportTicketReplies";
import { ensureCrmEnhancementTables } from "./ensureCrmEnhancementTables";
import { ensureCrmOrganisationCertColumns } from "./ensureCrmOrganisationCertColumns";
import { ensureEmailAccountPushColumns } from "./ensureEmailAccountPushColumns";
import { ensureSequenceTables } from "./ensureSequenceTables";
import { ensureUserSettingsTableDensity } from "./ensureUserSettingsTableDensity";
import { ensureUserSettingsCrmBirthdayDigestOptOut } from "./ensureUserSettingsCrmBirthdayDigestOptOut";
import { ensureUserSettingsBirthdayDigestSchedule } from "./ensureUserSettingsBirthdayDigestSchedule";
import { ensureUserSettingsTakeoffStylusPrefs } from "./ensureUserSettingsTakeoffStylusPrefs";
import { ensureUserSettingsLabelSheetTemplate } from "./ensureUserSettingsLabelSheetTemplate";
import { ensureCrmCustomFieldTables } from "./ensureCrmCustomFieldTables";
import { ensureGeocodeStatusColumns } from "./ensureGeocodeStatusColumns";
import { ensureUserSavedViewsTable } from "./ensureUserSavedViewsTable";
import { ensureMyWorkSavedViewsTable } from "./ensureMyWorkSavedViewsTable";
import { ensureScheduleBaselinesTable } from "./ensureScheduleBaselinesTable";
import { ensurePlanPinsTable } from "./ensurePlanPinsTable";
import { ensurePlanDocumentMarkupsTable } from "./ensurePlanDocumentMarkupsTable";
import { ensurePlanMarkupLayersTables } from "./ensurePlanMarkupLayersTables";
import { ensureProjectEmailDistributionLists } from "./ensureProjectEmailDistributionLists";
import { ensureProjectLogEmailSchedules } from "./ensureProjectLogEmailSchedules";
import { ensureProjectLogEmailAttemptTracking } from "./ensureProjectLogEmailAttemptTracking";
import { ensureProjectLogEmailFailureNotifications } from "./ensureProjectLogEmailFailureNotifications";
import { ensureProjectLogEmailConsecutiveFailures } from "./ensureProjectLogEmailConsecutiveFailures";
import { ensureProjectLogEmailFailureThresholdSetting } from "./ensureProjectLogEmailFailureThresholdSetting";
import { ensureProjectLogEmailFailuresDigestSchedule } from "./ensureProjectLogEmailFailuresDigestSchedule";
import { ensureProjectLogEmailScheduleAttemptsTable } from "./ensureProjectLogEmailScheduleAttemptsTable";
import { ensureRateLimitStateTable } from "./ensureRateLimitStateTable";
import { ensureRateLimitStateCounters } from "./ensureRateLimitStateCounters";
import { ensureOauthStateTable } from "./ensureOauthStateTable";
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
import { ensureStandaloneTakeoffTables } from "./ensureStandaloneTakeoffTables";
import { ensureStatusPageTables } from "./ensureStatusPageTables";
import { backfillStatusProbeDailyHistory } from "./backfillStatusProbeDailyHistory";
import { ensureMobileOfflineEnumValues } from "./ensureMobileOfflineEnumValues";
import { ensureBillingEnumValues } from "./ensureBillingEnumValues";
import { ensureAuditActionEnumValues } from "./ensureAuditActionEnumValues";
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
import { ensureOrganizationStorageQuotaColumn } from "./ensureOrganizationStorageQuotaColumn";
import { ensureRfiOverdueColumns } from "./ensureRfiOverdueColumns";
import { ensureSubmittalReviewOverdueColumns } from "./ensureSubmittalReviewOverdueColumns";
import { ensureDocOverdueReminderSettings } from "./ensureDocOverdueReminderSettings";
import { ensurePortalTokenLookupHashColumn } from "./ensurePortalTokenLookupHashColumn";
import { ensureCrmTranscriptBackfillJobsTable } from "./ensureCrmTranscriptBackfillJobsTable";
import { ensureCrmTranscriptBackfillNotificationSettingsTable } from "./ensureCrmTranscriptBackfillNotificationSettingsTable";
import { ensureFeatureFlagPresetApplicationsTable } from "./ensureFeatureFlagPresetApplicationsTable";
import { ensureFeatureFlagManualChangesTable } from "./ensureFeatureFlagManualChangesTable";
import { ensureDotPayItemMatchHistory } from "./ensureDotPayItemMatchHistory";
import { ensureDolClassificationMappingsTable } from "./ensureDolClassificationMappingsTable";
import { ensurePlatformIncidentReviewTables } from "./ensurePlatformIncidentReviewTables";
import { ensureTakeoffToolChestTable } from "./ensureTakeoffToolChestTable";
import { ensureTakeoffSheetSetsTables } from "./ensureTakeoffSheetSetsTables";
import { ensureCrmTranscriptBackfillNotificationsTable } from "./ensureCrmTranscriptBackfillNotificationsTable";
import { ensureCrmTranscriptBackfillAlertDeliveriesTable } from "./ensureCrmTranscriptBackfillAlertDeliveriesTable";
import { ensureUsersAlertFailureEmailModeColumn } from "./ensureUsersAlertFailureEmailModeColumn";
import { ensureUsersIntegrationSyncExhaustedEmailOptOutColumn } from "./ensureUsersIntegrationSyncExhaustedEmailOptOutColumn";
import { ensureUsersCrmBackfillSummaryPreferenceColumns } from "./ensureUsersCrmBackfillSummaryPreferenceColumns";
import { ensureUsersPlansSurfacePreferenceColumns } from "./ensureUsersPlansSurfacePreferenceColumns";
import { ensureUsersCrmOwnerFilterColumns } from "./ensureUsersCrmOwnerFilterColumns";
import { ensureCrmTranscriptBackfillTestAlertsTable } from "./ensureCrmTranscriptBackfillTestAlertsTable";
import { ensureCrmAndReportingTables } from "./ensureCrmAndReportingTables";
import { ensureCrmTranscriptBackfillAlertResendCooldownsTable } from "./ensureCrmTranscriptBackfillAlertResendCooldownsTable";
import { runCertifiedPayrollBackfillOnce } from "./runCertifiedPayrollBackfillOnce";
import { runExhaustedSyncRetryAlertsBackfillOnce } from "./runExhaustedSyncRetryAlertsBackfillOnce";
import { runRestoreAuditBackfillOnce } from "./runRestoreAuditBackfillOnce";
import { runScaleCalibrationBackfillOnce } from "./runScaleCalibrationBackfillOnce";
import { ensureSovStatusEnumValues } from "./ensureSovStatusEnumValues";
import { ensureCalendarEventTypeEnumValues } from "./ensureCalendarEventTypeEnumValues";
import { ensurePasskeyRpIdColumn } from "./ensurePasskeyRpIdColumn";
import { ensureEquipmentRepairsPmIdempotency } from "./ensureEquipmentRepairsPmIdempotency";
import { ensureMobileSyncEventsTable } from "./ensureMobileSyncEventsTable";
import { ensureTakeoffSheetsTileColumns } from "./ensureTakeoffSheetsTileColumns";
import { seedTradePackSkills } from "../services/aiEstimator/skills";
import { ensureDemoRequestsTable } from "./ensureDemoRequestsTable";
import { ensureDemoLeadCrmConfig } from "./ensureDemoLeadCrmConfig";
import { ensureOauthReconnectAlertEnumValues } from "./ensureOauthReconnectAlertEnumValues";
import { ensureWorkflowLifecycleEnumValues } from "./ensureWorkflowLifecycleEnumValues";
import { ensureWebsitePageTypeEnumValues } from "./ensureWebsitePageTypeEnumValues";
import { ensureOrgAiKeys } from "./ensureOrgAiKeys";
import { ensureAiActionAuditKeySource } from "./ensureAiActionAuditKeySource";
import { ensureSupportSettings, ensureSupportHolidays } from "./ensureSupportSettings";
import { ensureAuditActionEnumSlaValues } from "./ensureAuditActionEnumSlaValues";
import { ensureAuditLogUserIdNullable } from "./ensureAuditLogUserIdNullable";
import { seedSupportHolidaysOnStartup } from "./seedSupportHolidaysOnStartup";
import { ensureEstimateBenchmarkColumns } from "./ensureEstimateBenchmarkColumns";
import { ensureEstimateBenchmarkRefreshesTable } from "./ensureEstimateBenchmarkRefreshesTable";
import { ensureEnrichmentTables } from "./ensureEnrichmentTables";

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
  // Task #1743 — per-user × per-spec-book picker filter memory for the DOT
  // pay-item picker. Promotes the per-device
  // `dot-pay-item-picker:facets:<uid>:<specBookId>` localStorage key off the
  // device so an estimator's chosen categories + spec sections follow them
  // across machines. Runs after `dot_tables` so the FK on spec_book_id can
  // resolve.
  { name: "dot_pay_item_picker_facets_table", category: "CREATE_TABLE", fn: ensureDotPayItemPickerFacetsTable },
  { name: "video_call_tables", category: "CREATE_TABLE", fn: ensureVideoCallTables },
  { name: "estimate_subcontractor_tables", category: "CREATE_TABLE", fn: ensureEstimateSubcontractorTables },
  { name: "line_item_photo_urls", category: "ADD_COLUMN", fn: ensureLineItemPhotoUrls },
  { name: "equipment_columns", category: "ADD_COLUMN", fn: ensureEquipmentColumns },
  { name: "message_columns", category: "ADD_COLUMN", fn: ensureMessageColumns },
  { name: "notification_enum_values", category: "ADD_ENUM", fn: ensureNotificationEnumValues },
  // Task #1747 — adds `muted_until` to `notification_type_prefs` so per-type
  // mutes can carry an auto-clear deadline (snooze). Read paths treat past
  // deadlines as if the override row didn't exist.
  { name: "notification_type_prefs_muted_until", category: "ADD_COLUMN", fn: ensureNotificationTypePrefsMutedUntil },
  // Task #1974 — adds opaque `metadata` jsonb to `notifications` so the
  // INTEGRATION_SYNC_RETRIES_EXHAUSTED fan-out can persist a friendly
  // {recordLink, recordLabel} pair the in-app bell row renders as a
  // secondary "Open <label>" link, mirroring the email's secondary CTA
  // (Task #1945).
  { name: "notifications_metadata", category: "ADD_COLUMN", fn: ensureNotificationsMetadata },
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
  // Task #1600 — Sage Intacct chart-of-accounts mapping table mirroring
  // qbo_account_mappings so the admin Sage mapping panel can map
  // SmartManageAI cost codes onto Sage GL accounts.
  { name: "sage_account_mappings", category: "CREATE_TABLE", fn: ensureSageAccountMappingsTable },
  // Task #2478 — enable Postgres row-level security on every multi-tenant
  // table so a missed application-level WHERE clause cannot leak rows
  // across tenants. Permissive when no `app.current_org_id` session var
  // is set, so legacy code paths keep working unchanged. Mirrors
  // migrations/0096_enable_tenant_rls.sql. See
  // docs/architecture/tenant-isolation.md.
  { name: "tenant_rls_policies", category: "ALTER_TABLE", fn: ensureRlsPolicies },
  { name: "estimate_category_enum_values", category: "ADD_ENUM", fn: ensureEstimateCategoryEnumValues },
  // Task #1144 — close baseline-migration gaps for ALTER TYPE ADD VALUE
  // operations that `reconcileSchemaDrift` cannot replay (it creates missing
  // enum *types* but not missing values on existing types).
  { name: "sov_status_enum_values", category: "ADD_ENUM", fn: ensureSovStatusEnumValues },
  // Task #1180 — adds ARCHIVE / UNARCHIVE values used by the certified
  // payroll archive admin endpoints in `server/payrollRoutes.ts`.
  { name: "audit_action_enum_values", category: "ADD_ENUM", fn: ensureAuditActionEnumValues },
  { name: "calendar_event_type_enum_values", category: "ADD_ENUM", fn: ensureCalendarEventTypeEnumValues },
  // Task #2190 — adds `rp_id` to `passkey_credentials` so each WebAuthn
  // credential records the domain (RP ID) it was registered under, rather
  // than relying on a global rpID derived from REPLIT_DEV_DOMAIN at boot.
  // Required to fix passkey login on dev URLs that change and on the
  // deployed *.replit.app domain.
  { name: "passkey_credentials_rp_id", category: "ADD_COLUMN", fn: ensurePasskeyRpIdColumn },
  // Task #2690 — replaces the application-level `[PM:<id>]` description
  // tag guard in equipmentPmEngine with a real FK + partial unique index
  // on (schedule_id, pm_cycle_key). Also backfills both columns from
  // historical PM-tagged rows.
  { name: "equipment_repairs_pm_idempotency", category: "ALTER_TABLE", fn: ensureEquipmentRepairsPmIdempotency },
  { name: "takeoff_enhancements", category: "ADD_COLUMN", fn: ensureTakeoffEnhancements },
  // Task #2068 — three-tier trade catalog (Trade > Category > Item).
  { name: "library_category_tier", category: "CREATE_TABLE", fn: ensureLibraryCategoryTier },
  { name: "field_worker_perm_columns", category: "ADD_COLUMN", fn: ensureFieldWorkerPermColumns },
  { name: "peer_rating_columns", category: "ADD_COLUMN", fn: ensurePeerRatingColumns },
  { name: "nullable_permissions", category: "ALTER_TABLE", fn: ensureNullablePermissions },
  { name: "permission_presets_table", category: "CREATE_TABLE", fn: ensurePermissionPresetsTable },
  // Task #2143 — self-serve "Request access" flow that closes the loop on
  // the friendlier 403 toast (e.g. estimate PDF export). Order matters:
  // depends on the `users` and `organizations` tables and on the
  // `user_role` enum, which all exist by this point.
  { name: "access_requests_table", category: "CREATE_TABLE", fn: ensureAccessRequestsTable },
  // Task #2323 — closed-loop AI takeoff feedback. Per-suggestion
  // accept/reject/edit-and-accept tracking + per-org confidence
  // calibration. Backfills one PENDING suggestion row per detected
  // item from existing detected_items_json blobs so the accuracy
  // dashboard has signal on day one. Order matters: depends on
  // organizations, users, ai_takeoff_analyses, takeoff_measurements,
  // and the trade_type enum — all in place by this point.
  { name: "ai_takeoff_suggestions_tables", category: "CREATE_TABLE", fn: ensureAiTakeoffSuggestionsTables },
  { name: "ai_estimator_provenance_tables", category: "CREATE_TABLE", fn: ensureAiEstimatorProvenanceTables },
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
  // Task #2220 — anonymous, tenant-scoped telemetry of takeoff palm
  // rejection / long-press / two-finger-rotate events. Backs the per-org
  // P50/P95 distributions on the platform Stylus Tuning dashboard.
  { name: "takeoff_stylus_telemetry_events", category: "CREATE_TABLE", fn: ensureTakeoffStylusTelemetryEventsTable },
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
  { name: "user_settings_takeoff_stylus_prefs", category: "ADD_COLUMN", fn: ensureUserSettingsTakeoffStylusPrefs },
  // Task #2570 — remember the user's preferred barcode/QR label sheet template.
  { name: "user_settings_label_sheet_template", category: "ADD_COLUMN", fn: ensureUserSettingsLabelSheetTemplate },
  { name: "crm_custom_field_tables", category: "CREATE_TABLE", fn: ensureCrmCustomFieldTables },
  { name: "user_saved_views_table", category: "CREATE_TABLE", fn: ensureUserSavedViewsTable },
  { name: "my_work_saved_views_table", category: "CREATE_TABLE", fn: ensureMyWorkSavedViewsTable },
  { name: "schedule_baselines_table", category: "CREATE_TABLE", fn: ensureScheduleBaselinesTable },
  { name: "plan_pins_table", category: "CREATE_TABLE", fn: ensurePlanPinsTable },
  { name: "plan_document_markups_table", category: "CREATE_TABLE", fn: ensurePlanDocumentMarkupsTable },
  // Task #1662 — markup layers + per-user visibility. Runs AFTER the
  // plan_document_markups migration so the FK on layer_id can be
  // wired by the layers migration once both tables exist.
  { name: "plan_markup_layers_tables", category: "CREATE_TABLE", fn: ensurePlanMarkupLayersTables },
  { name: "project_email_distribution_lists", category: "CREATE_TABLE", fn: ensureProjectEmailDistributionLists },
  { name: "project_log_email_schedules", category: "CREATE_TABLE", fn: ensureProjectLogEmailSchedules },
  // Task #1622 — per-attempt outcome tracking columns on
  // project_log_email_schedules so the project settings panel can
  // surface "Last send failed: <reason>" without forcing admins to
  // dig through server logs.
  { name: "project_log_email_attempt_tracking", category: "ADD_COLUMN", fn: ensureProjectLogEmailAttemptTracking },
  // Task #1637 — last_edited_by_id + failure-notification dedupe
  // columns so the cron can fan a one-shot in-app notification to the
  // schedule's last editor + project manager when a send transitions
  // into FAILURE / NO_RECIPIENTS, without re-notifying every tick.
  { name: "project_log_email_failure_notifications", category: "ADD_COLUMN", fn: ensureProjectLogEmailFailureNotifications },
  // Task #1651 — consecutive_failure_count column on
  // project_log_email_schedules. Lets the worker fan a backstop
  // notification to every ADMIN/MANAGER/SUPER_ADMIN in the org once a
  // schedule has failed PROJECT_LOG_EMAIL_FAILURE_THRESHOLD (default
  // 3) times in a row, so a quietly-broken distribution list can't go
  // un-noticed for weeks just because nobody opens project settings.
  { name: "project_log_email_consecutive_failures", category: "ADD_COLUMN", fn: ensureProjectLogEmailConsecutiveFailures },
  // Task #1668 — per-org override for the repeated-failure backstop
  // notification threshold. NULL means "use the env / global default";
  // a positive integer overrides PROJECT_LOG_EMAIL_FAILURE_THRESHOLD
  // for that org's schedules only. Lets each org dial in its own
  // tolerance without redeploying.
  { name: "project_log_email_failure_threshold_setting", category: "ADD_COLUMN", fn: ensureProjectLogEmailFailureThresholdSetting },
  // Task #1732 — per-org schedule (cadence + weekday + hour + timezone)
  // for the project-log-email failures-digest fan-out. Defaults preserve
  // the original 08:00 UTC daily behavior, so existing orgs upgrade as a
  // no-op.
  { name: "project_log_email_failures_digest_schedule", category: "ADD_COLUMN", fn: ensureProjectLogEmailFailuresDigestSchedule },
  // Task #1652 — append-only per-schedule send history so admins can
  // audit every cron tick + manual send (status, error, recipient
  // count, triggered-by) instead of only seeing the most recent
  // attempt on the schedule row.
  { name: "project_log_email_schedule_attempts_table", category: "CREATE_TABLE", fn: ensureProjectLogEmailScheduleAttemptsTable },
  { name: "rate_limit_state_table", category: "CREATE_TABLE", fn: ensureRateLimitStateTable },
  // Task #2427 — autoscale safety. Adds the `hit_count` and
  // `window_expires_at` counter columns + partial index used by
  // `PgExpressRateLimitStore` so all 5 express-rate-limit limiters in
  // `server/rateLimiter.ts` share state across replicas instead of
  // tracking buckets in per-process memory.
  { name: "rate_limit_state_counters", category: "ADD_COLUMN", fn: ensureRateLimitStateCounters },
  // Task #2056 — persistent, cross-replica backing store for the
  // short-lived Apple Sign-In OAuth state values issued by
  // `/api/auth/apple` and consumed by the cross-site form_post callback
  // at `/api/auth/apple/callback`. Replaces the per-process in-memory
  // Map that broke on deploys mid-sign-in and on multi-replica fleets.
  { name: "oauth_state_table", category: "CREATE_TABLE", fn: ensureOauthStateTable },
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
  { name: "standalone_takeoff_tables", category: "CREATE_TABLE", fn: ensureStandaloneTakeoffTables },
  { name: "status_page_tables", category: "CREATE_TABLE", fn: ensureStatusPageTables },
  { name: "status_probe_daily_history_backfill", category: "ALTER_TABLE", fn: backfillStatusProbeDailyHistory },
  { name: "mobile_offline_enum_values", category: "ADD_ENUM", fn: ensureMobileOfflineEnumValues },
  // Task #2482 — billing & subscription productization adds enum values
  // (`subscription_status.suspended`, `usage_key.{ai_tokens,ai_jobs,storage_bytes}`)
  // that reconcileSchemaDrift can't synthesize for existing enum types.
  { name: "billing_enum_values", category: "ADD_ENUM", fn: ensureBillingEnumValues },
  // Task #2495 — auth + role-change audit_action enum values must exist
  // before the auth routes try to write LOGIN/LOGOUT/PASSWORD_*/ROLE_*
  // rows. Without this, `logAudit` would silently drop them on a long-
  // lived deploy DB created before the enum was extended.
  { name: "audit_action_enum_values", category: "ADD_ENUM", fn: ensureAuditActionEnumValues },
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
  // Task #1955 — per-org object-storage quota for the shared
  // `gallery/<orgId>/` prefix used by the website builder image
  // library and the social-media post media uploader. Default 100 GB.
  { name: "organization_storage_quota_column", category: "ADD_COLUMN", fn: ensureOrganizationStorageQuotaColumn },
  // Task #1599 — per-RFI dedupe marker + counter for the nightly RFI
  // overdue escalation sweep, plus an external-assignee email column
  // for the EXTERNAL_DOC_EMAIL fanout. Idempotent ADD COLUMN IF NOT
  // EXISTS so existing deployments pick them up on boot.
  { name: "rfi_overdue_columns", category: "ADD_COLUMN", fn: ensureRfiOverdueColumns },
  // Task #1599 — same per-row bookkeeping for submittal_reviews + a
  // reviewer_email column for external A/E reviewers.
  { name: "submittal_review_overdue_columns", category: "ADD_COLUMN", fn: ensureSubmittalReviewOverdueColumns },
  // Task #1599 — per-org cap + cadence for the document-control
  // overdue sweeps (mirrors the SWPPP per-org policy column pair).
  { name: "doc_overdue_reminder_settings", category: "ADD_COLUMN", fn: ensureDocOverdueReminderSettings },
  // Task #1614 — adds subcontractor_portal_tokens.token_lookup_hash +
  // its btree index so requirePortalAuth can index-fetch the single
  // candidate row instead of bcrypt-scanning every active token.
  { name: "portal_token_lookup_hash_column", category: "ADD_COLUMN", fn: ensurePortalTokenLookupHashColumn },
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
  // Task #1695 — server-side per-user preferences for the Plans surface
  // (labeled toolbar toggle + plans-tour dismissal marker). Promoted
  // from per-user-id `localStorage` keys so the settings sync across
  // devices instead of being lost on cache clears or device switches.
  { name: "users_plans_surface_preference_columns", category: "ADD_COLUMN", fn: ensureUsersPlansSurfacePreferenceColumns },
  // Task #1720 — server-side per-user CRM owner-filter selections
  // (contacts + organisations tabs). Promoted from per-user-id
  // `localStorage` keys so the "Show only my orgs / contacts" toggle
  // syncs across every device the user signs in on, the same way the
  // Plans-surface preferences (Task #1695) do.
  { name: "users_crm_owner_filter_columns", category: "ADD_COLUMN", fn: ensureUsersCrmOwnerFilterColumns },
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
  // Task #1871 — one-shot promotion of legacy plan-document-markup
  // restore audit rows (which used the pre-#1847 `op: "restore"`
  // JSON shim under action='UPDATE'/'CREATE') to the dedicated
  // `action='RESTORE'` enum value so audit search covers older
  // entries. Must run AFTER `audit_action_enum_values` so RESTORE
  // exists, AND AFTER `one_shot_job_runs` so the coverage row
  // insert succeeds. Idempotent: a `one_shot_jobs` ledger row
  // makes subsequent startups a single SELECT.
  { name: "restore_style_audit_rows_backfill_once", category: "ALTER_TABLE", fn: runRestoreAuditBackfillOnce },
  // Task #2350 — one-shot backfill that emits synthetic structured
  // `scale_calibration` audit_log rows for every takeoff sheet that was
  // calibrated before the structured Scale History writer (Task #2325)
  // shipped. Without this, the new Scale History panel shows only the
  // "Current" section for pre-#2325 sheets and an empty timeline below it.
  // Order: must run AFTER `one_shot_job_runs` (the coverage row insert
  // requires the table). Idempotent on two layers — a `one_shot_jobs`
  // ledger row gates subsequent startups, and the underlying SQL uses
  // NOT EXISTS so even ledger-less re-runs never duplicate timeline
  // entries.
  { name: "scale_calibration_backfill_once", category: "ALTER_TABLE", fn: runScaleCalibrationBackfillOnce },
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
  // Task #1578 — platform-support incident review tables that back the new
  // "Attach to incident review" action on the Recent alert failures card.
  { name: "platform_incident_review_tables", category: "CREATE_TABLE", fn: ensurePlatformIncidentReviewTables },
  // Task #2065 — Tool Chest (Step 7). Per-user pinned shelf of frequently
  // used tools / conditions / assemblies for the takeoff workspace.
  { name: "takeoff_tool_chest_table", category: "CREATE_TABLE", fn: ensureTakeoffToolChestTable },
  // Task #2065 — Sheet Sets (Step 12). Named collections of takeoff sheets
  // that share a workflow context, used by bulk operations such as
  // applying a calibrated scale to every member of a set.
  { name: "takeoff_sheet_sets_tables", category: "CREATE_TABLE", fn: ensureTakeoffSheetSetsTables },
  // Task #2689 — GCS-first atomic closeout export. Adds the checksum +
  // completed_at columns the export route stamps after a verified
  // promote-to-final-key, and that consumers gate on as the "valid
  // package exists" predicate.
  { name: "closeout_packages_atomic_columns", category: "ADD_COLUMN", fn: ensureCloseoutPackagesAtomicColumns },
  // Task #2693 — mobile_sync_events table + logical_clock on offline_sync_queue
  { name: "mobile_sync_events_table", category: "CREATE_TABLE", fn: ensureMobileSyncEventsTable },
  // Task #2703 — seed read-only trade-pack skills (idempotent; skips existing rows).
  { name: "ai_estimator_skills_seed", category: "CREATE_TABLE", fn: seedTradePackSkills },
  // AI Estimator chat attachments — adds the `attachments` JSONB column the
  // chat panel uses to ship file uploads, screenshot pastes and voice notes
  // alongside the prompt. Migration 0112; mirrored here so fresh DBs converge.
  { name: "ai_estimator_chat_attachments", category: "ADD_COLUMN", fn: ensureAiEstimatorChatAttachmentsColumn },
  // Task #2760 — Server-side PDF tile pre-rendering. Adds tile_status,
  // tiled_at, and tile_storage_prefix to takeoff_sheets so the real renderer
  // can stamp tile availability after a pre-render pass. All three columns are
  // nullable so existing rows are treated as un-rendered (client-side fallback).
  { name: "takeoff_sheets_tile_columns", category: "ADD_COLUMN", fn: ensureTakeoffSheetsTileColumns },
  // Task #2780 — In-app demo request form (replaces Calendly external link).
  { name: "demo_requests_table", category: "CREATE_TABLE", fn: ensureDemoRequestsTable },
  // Task #2783 — Demo lead CRM config singleton so Super Admins can configure
  // which organization/pipeline receives demo request leads without needing an
  // env var change. Env var DEMO_CRM_ORG_ID still takes precedence.
  { name: "demo_lead_crm_config", category: "CREATE_TABLE", fn: ensureDemoLeadCrmConfig },
  // Task #2755 / #2804 — OAuth reconnect alert: two ALTER TYPE ADD VALUE calls
  // that reconcileSchemaDrift cannot replay (it creates enum types but never
  // appends values to existing ones). Mirrors 0114_oauth_reconnect_alert.sql.
  { name: "oauth_reconnect_alert_enum_values", category: "ADD_ENUM", fn: ensureOauthReconnectAlertEnumValues },
  // Task #2816 — Support ticket reply thread. Creates support_ticket_replies
  // and its indexes. Mirrors migrations/0117_support_ticket_replies.sql so
  // fresh dev/staging environments converge without a manual psql step.
  { name: "support_ticket_replies", category: "CREATE_TABLE", fn: ensureSupportTicketReplies },
  // Task #2848 / #2833 — Workflow & Lifecycle Gap Remediation: three ALTER TYPE
  // ADD VALUE calls that reconcileSchemaDrift cannot replay (it creates enum
  // types but never appends values to existing ones). Mirrors the enum-only
  // portions of 0118_workflow_lifecycle_gaps.sql.
  { name: "workflow_lifecycle_enum_values", category: "ADD_ENUM", fn: ensureWorkflowLifecycleEnumValues },
  // Task #2849 — drizzle-kit baseline 0002_clumsy_jackpot.sql adds CAREERS to
  // website_page_type via ALTER TYPE ADD VALUE. reconcileSchemaDrift creates
  // missing enum types but never appends values to existing ones, so a long-
  // lived dev DB provisioned before CAREERS was added would silently be missing
  // the value until a CAREERS-page insert crashed.
  { name: "website_page_type_enum_values", category: "ADD_ENUM", fn: ensureWebsitePageTypeEnumValues },
  // Task #2922 — Bid AI Analysis: CSI scope document + standalone takeoff scope fields.
  // Adds scope_document_key to ai_bid_document_analysis and scope_document_key /
  // scope_items_json / scope_analysis_status to standalone_takeoffs. These are the
  // 4 columns reconcileSchemaDrift flags as missing in production. Mirrors
  // migrations/0121_csi_scope_document.sql so production converges on first boot
  // after deploy without requiring a manual drizzle-kit push.
  { name: "csi_scope_columns", category: "ADD_COLUMN", fn: ensureCsiScopeColumns },
  // Task #2948 — BYOK: org_ai_keys table for encrypted per-org AI provider keys.
  // Mirrors migrations/0122_org_ai_keys.sql; creates the table if it doesn't
  // exist on older DBs so production converges on first boot after deploy.
  { name: "org_ai_keys", category: "CREATE_TABLE", fn: ensureOrgAiKeys },
  // Task #2948 — BYOK: key_source column on ai_action_audit.
  // Mirrors migrations/0123_ai_action_audit_key_source.sql; adds the column +
  // index idempotently so production converges on first boot after deploy.
  { name: "ai_action_audit_key_source", category: "ADD_COLUMN", fn: ensureAiActionAuditKeySource },
  // Task #2962 — SLA & routing intelligence.
  // Creates support_settings (per-org timezone + escalation policy) and
  // support_holidays (DB-backed holiday calendar) tables.
  { name: "support_settings", category: "CREATE_TABLE", fn: ensureSupportSettings },
  { name: "support_holidays", category: "CREATE_TABLE", fn: ensureSupportHolidays },
  // Task #2962 — SLA & routing intelligence.
  // Adds ESCALATE and AUTO_ASSIGN values to audit_action enum (used by the
  // escalation engine and auto-assign round-robin in slaMonitor.ts).
  { name: "audit_action_enum_sla_values", category: "ADD_ENUM", fn: ensureAuditActionEnumSlaValues },
  // Task #2962 — SLA & routing intelligence.
  // Makes audit_log.user_id nullable so system-initiated rows (ESCALATE,
  // AUTO_ASSIGN) can be written without a FK violation against users.id.
  { name: "audit_log_user_id_nullable", category: "ALTER_TABLE", fn: ensureAuditLogUserIdNullable },
  // Task #2962 — SLA & routing intelligence.
  // Seeds US federal holidays for current year + 3 years ahead. Idempotent
  // via ON CONFLICT DO NOTHING; auto-extends on each new year's first deploy.
  { name: "support_holidays_seed", category: "ALTER_TABLE", fn: seedSupportHolidaysOnStartup },
  // Task #3038 — Refresh-benchmarks: two text columns on `estimates` that
  // store the Phase-4-only benchmark summary and overall confidence so
  // estimators can re-run benchmark verification without regenerating the full
  // estimate.
  { name: "estimate_benchmark_columns", category: "ADD_COLUMN", fn: ensureEstimateBenchmarkColumns },
  // Task #3046 — Benchmark refresh history: creates the append-only
  // `estimate_benchmark_refreshes` table so every "Refresh Benchmarks" action
  // is stored as an immutable row for later comparison.
  { name: "estimate_benchmark_refreshes_table", category: "CREATE_TABLE", fn: ensureEstimateBenchmarkRefreshesTable },
  // Task #3064 — AI Line Item Enrichment Engine: three jsonb learning-loop
  // tables (enrichment_log, enrichment_feedback, bid_outcomes) that store
  // Claude enrichment calls and estimator Accept/Modify/Dismiss signals so
  // future calls for the same org + cost code improve over time.
  { name: "enrichment_tables", category: "CREATE_TABLE", fn: ensureEnrichmentTables },
];

export async function runStartupMigrations(): Promise<void> {
  const start = Date.now();
  const failed: string[] = [];
  const capturedLogs: string[] = [];
  let appliedCount = 0;

  await captureConsoleDuring(
    {
      onLog: (msg, forward) => {
        if (msg.includes("[migration]") || msg.includes("ensureErrorLogsTable")) {
          capturedLogs.push(msg);
          if (msg.includes("— applied") || msg.includes("— created") || msg.includes("added") || msg.includes("table ready")) {
            appliedCount++;
            forward(msg);
          }
        } else {
          forward(msg);
        }
      },
      onError: (msg, _args, forward) => {
        if (msg.includes("[migration]")) {
          capturedLogs.push(msg);
        }
        forward(msg);
      },
    },
    async ({ log: forwardLog, error: forwardError }) => {
      for (const step of migrations) {
        const stepStart = Date.now();
        try {
          await step.fn();
          const stepElapsed = Date.now() - stepStart;
          if (stepElapsed > 5000) {
            forwardLog(`[migration] ${step.name} (${step.category}) completed in ${stepElapsed}ms (slow)`);
          }
        } catch (err) {
          const stepElapsed = Date.now() - stepStart;
          failed.push(step.name);
          forwardError(`[migration] ${step.name} (${step.category}) failed after ${stepElapsed}ms:`, err);
          logError(`Migration step failed: ${step.name} (${step.category})`, { stepElapsed }, err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
  );

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
