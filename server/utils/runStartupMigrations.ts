import { logInfo, logError, logWarn } from "./logger";
import { detectSchemaDrift } from "./schemaDriftDetector";

import { ensureVideoCallTables } from "./ensureVideoCallTables";
import { ensureEstimateSubcontractorTables } from "./ensureEstimateSubcontractorTables";
import { ensureEquipmentColumns } from "./ensureEquipmentColumns";
import { ensureMessageColumns } from "./ensureMessageColumns";
import { ensureNotificationEnumValues } from "./ensureNotificationEnumValues";
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
import { ensureMaterialCertColumns } from "./ensureMaterialCertColumns";
import { ensureHeavyCivilDocumentColumns } from "./ensureHeavyCivilDocumentColumns";
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
import { ensureScheduleBaselinesTable } from "./ensureScheduleBaselinesTable";
import { ensurePlanPinsTable } from "./ensurePlanPinsTable";
import { ensureProjectEmailDistributionLists } from "./ensureProjectEmailDistributionLists";
import { ensureGanttPdfRenderSamplesTable } from "./ensureGanttPdfRenderSamplesTable";
import { ensureCrmCsvImportPayloadColumn } from "./ensureCrmCsvImportPayloadColumn";
import { ensureCrmContactBirthdayColumn } from "./ensureCrmContactBirthdayColumn";
import { ensureCrmContactTimezoneColumn } from "./ensureCrmContactTimezoneColumn";
import { ensureCrmContactTimezoneBackfill } from "./ensureCrmContactTimezoneBackfill";
import { ensureBirthdayReminderCadenceColumn } from "./ensureBirthdayReminderCadenceColumn";
import { ensureJobMetricAlertTables } from "./ensureJobMetricAlertTables";
import { ensureUsersJobMetricAlertEmailsColumn } from "./ensureUsersJobMetricAlertEmailsColumn";
import { ensureUsersJobMetricAlertQuietHoursColumns } from "./ensureUsersJobMetricAlertQuietHoursColumns";
import { ensureUsersJobMetricAlertQuietHoursDigestColumns } from "./ensureUsersJobMetricAlertQuietHoursDigestColumns";
import { ensurePendingContactReassignmentTable } from "./ensurePendingContactReassignmentTable";
import { ensureCrmOrganisationOwnerColumn } from "./ensureCrmOrganisationOwnerColumn";

type MigrationCategory = "CREATE_TABLE" | "ADD_COLUMN" | "ADD_ENUM" | "ALTER_TABLE";

interface MigrationStep {
  name: string;
  category: MigrationCategory;
  fn: () => Promise<void>;
}

const migrations: MigrationStep[] = [
  { name: "dot_tables", category: "CREATE_TABLE", fn: ensureDotTables },
  { name: "video_call_tables", category: "CREATE_TABLE", fn: ensureVideoCallTables },
  { name: "estimate_subcontractor_tables", category: "CREATE_TABLE", fn: ensureEstimateSubcontractorTables },
  { name: "equipment_columns", category: "ADD_COLUMN", fn: ensureEquipmentColumns },
  { name: "message_columns", category: "ADD_COLUMN", fn: ensureMessageColumns },
  { name: "notification_enum_values", category: "ADD_ENUM", fn: ensureNotificationEnumValues },
  { name: "estimate_category_enum_values", category: "ADD_ENUM", fn: ensureEstimateCategoryEnumValues },
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
  { name: "social_engagement_columns", category: "ADD_COLUMN", fn: ensureSocialEngagementColumns },
  { name: "email_campaign_tables", category: "CREATE_TABLE", fn: ensureEmailCampaignTables },
  { name: "workflow_tables", category: "CREATE_TABLE", fn: ensureWorkflowTables },
  { name: "missing_drizzle_tables", category: "CREATE_TABLE", fn: ensureMissingDrizzleTables },
  { name: "geofence_enhancements", category: "ADD_COLUMN", fn: ensureGeofenceEnhancements },
  { name: "site_leave_table", category: "CREATE_TABLE", fn: ensureSiteLeaveTable },
  { name: "purchase_order_columns", category: "ADD_COLUMN", fn: ensurePurchaseOrderColumns },
  { name: "crm_org_type_enum_values", category: "ADD_ENUM", fn: ensureCrmOrgTypeEnumValues },
  { name: "payroll_form_variant_column", category: "ADD_COLUMN", fn: ensurePayrollFormVariantColumn },
  { name: "material_cert_submit_columns", category: "ADD_COLUMN", fn: ensureMaterialCertColumns },
  { name: "heavy_civil_enum_values", category: "ADD_ENUM", fn: ensureHeavyCivilEnumValues },
  { name: "project_health_snapshot_columns", category: "ADD_COLUMN", fn: ensureProjectHealthSnapshotColumns },
  { name: "heavy_civil_tables", category: "CREATE_TABLE", fn: ensureHeavyCivilTables },
  { name: "heavy_civil_document_columns", category: "ADD_COLUMN", fn: ensureHeavyCivilDocumentColumns },
  { name: "crm_enhancement_tables", category: "CREATE_TABLE", fn: ensureCrmEnhancementTables },
  { name: "crm_organisation_cert_columns", category: "ADD_COLUMN", fn: ensureCrmOrganisationCertColumns },
  { name: "email_account_push_columns", category: "ADD_COLUMN", fn: ensureEmailAccountPushColumns },
  { name: "crm_sequence_tables", category: "CREATE_TABLE", fn: ensureSequenceTables },
  { name: "user_settings_table_density", category: "ADD_COLUMN", fn: ensureUserSettingsTableDensity },
  { name: "user_settings_crm_birthday_digest_opt_out", category: "ADD_COLUMN", fn: ensureUserSettingsCrmBirthdayDigestOptOut },
  { name: "user_settings_birthday_digest_schedule", category: "ADD_COLUMN", fn: ensureUserSettingsBirthdayDigestSchedule },
  { name: "crm_custom_field_tables", category: "CREATE_TABLE", fn: ensureCrmCustomFieldTables },
  { name: "user_saved_views_table", category: "CREATE_TABLE", fn: ensureUserSavedViewsTable },
  { name: "schedule_baselines_table", category: "CREATE_TABLE", fn: ensureScheduleBaselinesTable },
  { name: "plan_pins_table", category: "CREATE_TABLE", fn: ensurePlanPinsTable },
  { name: "project_email_distribution_lists", category: "CREATE_TABLE", fn: ensureProjectEmailDistributionLists },
  { name: "geocode_status_columns", category: "ADD_COLUMN", fn: ensureGeocodeStatusColumns },
  { name: "gantt_pdf_render_samples_table", category: "CREATE_TABLE", fn: ensureGanttPdfRenderSamplesTable },
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

  try {
    await detectSchemaDrift();
  } catch {
    logWarn("[migrations] Schema drift detection skipped due to error");
  }
}
