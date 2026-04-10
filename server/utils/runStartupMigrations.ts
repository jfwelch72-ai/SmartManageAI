import { logInfo, logError } from "./logger";

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
import { ensureMobilizationTables } from "./ensureMobilizationTables";
import { ensurePermitTables } from "./ensurePermitTables";
import { ensureMaterialTestTables } from "./ensureMaterialTestTables";

interface MigrationStep {
  name: string;
  fn: () => Promise<void>;
}

const migrations: MigrationStep[] = [
  { name: "video_call_tables", fn: ensureVideoCallTables },
  { name: "estimate_subcontractor_tables", fn: ensureEstimateSubcontractorTables },
  { name: "equipment_columns", fn: ensureEquipmentColumns },
  { name: "message_columns", fn: ensureMessageColumns },
  { name: "notification_enum_values", fn: ensureNotificationEnumValues },
  { name: "estimate_category_enum_values", fn: ensureEstimateCategoryEnumValues },
  { name: "takeoff_enhancements", fn: ensureTakeoffEnhancements },
  { name: "field_worker_perm_columns", fn: ensureFieldWorkerPermColumns },
  { name: "peer_rating_columns", fn: ensurePeerRatingColumns },
  { name: "nullable_permissions", fn: ensureNullablePermissions },
  { name: "permission_presets_table", fn: ensurePermissionPresetsTable },
  { name: "lidar_tables", fn: ensureLidarTables },
  { name: "error_logs_table", fn: ensureErrorLogsTable },
  { name: "scope_modifier_tables", fn: ensureScopeModifierTables },
  { name: "stackct_provider_enum", fn: ensureStackctProviderEnum },
  { name: "mobilization_tables", fn: ensureMobilizationTables },
  { name: "permit_tables", fn: ensurePermitTables },
  { name: "material_test_tables", fn: ensureMaterialTestTables },
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
    try {
      await step.fn();
    } catch (err) {
      failed.push(step.name);
      originalError(`[migration] ${step.name} failed:`, err);
    }
  }

  console.log = originalLog;
  console.error = originalError;

  const elapsed = Date.now() - start;
  const total = migrations.length;
  const skipped = total - appliedCount - failed.length;

  if (failed.length > 0) {
    logError(`[migrations] ${total} checks complete in ${elapsed}ms: ${appliedCount} applied, ${skipped} skipped, ${failed.length} FAILED (${failed.join(", ")})`);
  } else {
    logInfo(`[migrations] ${total} checks complete in ${elapsed}ms — ${appliedCount} applied, ${skipped} up-to-date`);
  }
}
