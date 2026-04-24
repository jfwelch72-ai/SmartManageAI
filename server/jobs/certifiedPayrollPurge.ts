/**
 * Task #1178: nightly auto-purge of archived certified payroll PDFs whose
 * `archived_at` timestamp is older than each org's configured retention
 * window (`organization_payroll_settings.archived_report_retention_days`,
 * default 1095 days / ~3 years per Davis-Bacon record retention).
 *
 * Lives in `server/jobs/` instead of `server/payrollRoutes.ts` so it can
 * be unit-tested without booting the full Express route surface (which
 * registers ~100 handlers at import time). The original task brief
 * pointed at `payrollRoutes.ts` for discoverability — that file
 * re-exports this function for the same reason.
 *
 * For each expired row we:
 *   1. Delete the underlying object-storage PDF FIRST. If the storage
 *      delete fails (transient outage, permission flap, etc.), we leave
 *      the DB row in place so the next nightly run can retry — this
 *      mirrors the existing manual hard-delete endpoint and prevents a
 *      transient storage error from permanently orphaning a blob.
 *   2. Hard-delete the `certified_payroll_reports` row only on storage
 *      success.
 *   3. Write a single bulk audit_log entry per (org, run) summarising how
 *      many rows were purged and the criteria used. Auditing is attributed
 *      to the org's first SUPER_ADMIN/ADMIN user (audit_log.user_id is NOT
 *      NULL); orgs with no admin are still purged but the audit row is
 *      skipped with a warning.
 *
 * Orgs whose `archived_report_retention_days` is 0 are skipped entirely
 * (auto-purge disabled). Wired into the background job runner; safe to
 * re-run — finds no work after each successful pass.
 */

import { db } from "../db";
import { and, eq, inArray, lte, sql, asc, desc } from "drizzle-orm";
import { certifiedPayrollReports, organizationPayrollSettings, users, jobMetricSamples } from "@shared/schema";
import { logAudit } from "../auditLogger";
import { logError, logInfo, logWarn } from "../utils/logger";
import { recordJobMetrics } from "../utils/jobMetrics";

export const CERTIFIED_PAYROLL_PURGE_JOB = "certified_payroll_purge";

/**
 * Task #1551 — per-run history record for the nightly certified-payroll
 * purge sweep. Mirrors the shape of `OrphanWageDecisionSweepRecord` so
 * the admin Jobs dashboard can render a "Last run" + "Recent runs" card
 * using the same UI pattern.
 */
export interface CertifiedPayrollPurgeResult {
  deleted: number;
  hardDeleted: number;
  storageDeleted: number;
  storageFailures: number;
  orgsProcessed: number;
}

export interface CertifiedPayrollPurgeRecord {
  ranAt: string;
  durationMs: number;
  result: CertifiedPayrollPurgeResult;
}

function rowToCertifiedPayrollPurgeRecord(row: {
  recordedAt: Date | string;
  counters: unknown;
}): CertifiedPayrollPurgeRecord {
  const c = (row.counters ?? {}) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = c[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    ranAt: new Date(row.recordedAt).toISOString(),
    durationMs: num("durationMs"),
    result: {
      deleted: num("deleted"),
      hardDeleted: num("hardDeleted"),
      storageDeleted: num("storageDeleted"),
      storageFailures: num("storageFailures"),
      orgsProcessed: num("orgsProcessed"),
    },
  };
}

export async function getLastCertifiedPayrollPurge(): Promise<CertifiedPayrollPurgeRecord | null> {
  try {
    const [row] = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, CERTIFIED_PAYROLL_PURGE_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(1);
    return row ? rowToCertifiedPayrollPurgeRecord(row) : null;
  } catch (err) {
    logError("Failed to load last certified payroll purge", { error: String(err) });
    return null;
  }
}

export async function getRecentCertifiedPayrollPurges(
  limit = 10,
): Promise<CertifiedPayrollPurgeRecord[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  try {
    const rows = await db
      .select({
        recordedAt: jobMetricSamples.recordedAt,
        counters: jobMetricSamples.counters,
      })
      .from(jobMetricSamples)
      .where(eq(jobMetricSamples.job, CERTIFIED_PAYROLL_PURGE_JOB))
      .orderBy(desc(jobMetricSamples.recordedAt))
      .limit(safeLimit);
    return rows.map(rowToCertifiedPayrollPurgeRecord);
  } catch (err) {
    logError("Failed to load recent certified payroll purges", { error: String(err) });
    return [];
  }
}

export async function processArchivedCertifiedPayrollPurge(opts: { now?: Date } = {}): Promise<{
  orgsProcessed: number;
  rowsPurged: number;
  storageDeleted: number;
  storageFailures: number;
}> {
  const now = opts.now ?? new Date();
  const startedAt = Date.now();
  let orgsProcessed = 0;
  let rowsPurged = 0;
  let storageDeleted = 0;
  let storageFailures = 0;

  // Distinct org IDs that have at least one archived row. Pre-filtering
  // here keeps us from scanning every org — only orgs with archived
  // PDFs can possibly have anything to purge.
  const orgIdRows = await db
    .selectDistinct({ organizationId: certifiedPayrollReports.organizationId })
    .from(certifiedPayrollReports)
    .where(sql`${certifiedPayrollReports.archivedAt} IS NOT NULL`);

  if (orgIdRows.length === 0) {
    // Task #1523 — emit a sample even on the "nothing to do" path so the
    // dashboard shows every nightly tick and the Task #1502 spike rules
    // on `deleted` / `hardDeleted` have a baseline to compare against.
    recordJobMetrics(CERTIFIED_PAYROLL_PURGE_JOB, {
      deleted: 0,
      hardDeleted: 0,
      storageDeleted: 0,
      storageFailures: 0,
      orgsProcessed: 0,
      durationMs: Date.now() - startedAt,
    });
    return { orgsProcessed, rowsPurged, storageDeleted, storageFailures };
  }

  const { ObjectStorageService } = await import("../objectStorage");
  const objectStorage = new ObjectStorageService();

  for (const { organizationId } of orgIdRows) {
    try {
      // Resolve effective retention window for this org. Missing settings
      // row means "use the schema default" (1095 days). 0 disables purge.
      const [settings] = await db
        .select({ retentionDays: organizationPayrollSettings.archivedReportRetentionDays })
        .from(organizationPayrollSettings)
        .where(eq(organizationPayrollSettings.organizationId, organizationId))
        .limit(1);
      const retentionDays = settings?.retentionDays ?? 1095;
      if (!retentionDays || retentionDays <= 0) continue;

      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

      const expired = await db
        .select({
          id: certifiedPayrollReports.id,
          objectKey: certifiedPayrollReports.objectKey,
          archivedAt: certifiedPayrollReports.archivedAt,
        })
        .from(certifiedPayrollReports)
        .where(and(
          eq(certifiedPayrollReports.organizationId, organizationId),
          sql`${certifiedPayrollReports.archivedAt} IS NOT NULL`,
          lte(certifiedPayrollReports.archivedAt, cutoff),
        ));

      if (expired.length === 0) continue;

      orgsProcessed += 1;
      const purgedIds: string[] = [];
      let orgStorageDeleted = 0;
      let orgStorageFailures = 0;
      const failedRowIds: string[] = [];

      for (const row of expired) {
        try {
          // Storage delete must succeed before we drop the DB row —
          // otherwise a transient object-store outage would permanently
          // orphan a blob with no row left to retry from. Mirrors the
          // semantics of the manual hard-delete endpoint in
          // payrollRoutes.ts (`/certified-reports/:id/hard-delete`).
          await objectStorage.deleteObjectByKey(row.objectKey);
          orgStorageDeleted += 1;
          purgedIds.push(row.id);
        } catch (err) {
          orgStorageFailures += 1;
          failedRowIds.push(row.id);
          // Leave the DB row in place; the next nightly run will retry.
          logWarn("Archived certified payroll PDF object delete failed — leaving DB row for retry");
        }
      }

      if (purgedIds.length > 0) {
        await db.delete(certifiedPayrollReports).where(inArray(certifiedPayrollReports.id, purgedIds));
        rowsPurged += purgedIds.length;
        storageDeleted += orgStorageDeleted;
      }
      storageFailures += orgStorageFailures;

      if (orgStorageFailures > 0) {
        logError("Archived certified payroll auto-purge: storage delete failures", {
          organizationId,
          failedCount: orgStorageFailures,
          failedRowIds,
        });
      }

      // If every expired row failed storage deletion, there's nothing to
      // audit for this org this run — skip the audit row.
      if (purgedIds.length === 0) continue;

      // Single bulk audit log entry per org per run summarising the purge.
      // audit_log.user_id is NOT NULL, so we attribute to the org's first
      // active SUPER_ADMIN/ADMIN. If an org has no admin, the purge still
      // runs but we skip the audit row with a warning rather than abort.
      const [adminUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.organizationId, organizationId),
          eq(users.isActive, true),
          inArray(users.role, ["SUPER_ADMIN", "ADMIN"]),
        ))
        .orderBy(asc(users.createdAt))
        .limit(1);

      if (adminUser) {
        await logAudit({
          userId: adminUser.id,
          action: "DELETE",
          entityType: "certified_payroll_reports",
          // entity_id is required; use the org id so the row groups under
          // the affected tenant in audit views.
          entityId: organizationId,
          oldValue: JSON.stringify({
            purgedCount: purgedIds.length,
            purgedIds,
            storageDeleted: orgStorageDeleted,
            storageFailures: orgStorageFailures,
            failedRowIds,
          }),
          newValue: JSON.stringify({
            reason: "AUTO_PURGE_ARCHIVED_RETENTION",
            retentionDays,
            archivedBefore: cutoff.toISOString(),
            runAt: now.toISOString(),
          }),
        });
      } else {
        logWarn("Archived certified payroll auto-purge: no admin user available for audit attribution");
      }

      logInfo("Archived certified payroll auto-purge complete for org", {
        organizationId,
        purged: purgedIds.length,
        storageDeleted: orgStorageDeleted,
        storageFailures: orgStorageFailures,
        retentionDays,
      });
    } catch (err) {
      logError("Archived certified payroll auto-purge failed for org", {
        organizationId,
        error: String(err),
      });
    }
  }

  // Task #1523 — surface per-run counts on the operations dashboard so
  // operators see the nightly history and the Task #1502 over-delete
  // spike rules on `deleted` / `hardDeleted` can fire end-to-end. The
  // hard-delete on this table has no soft-delete column, so
  // `hardDeleted` mirrors `rowsPurged`.
  recordJobMetrics(CERTIFIED_PAYROLL_PURGE_JOB, {
    deleted: rowsPurged,
    hardDeleted: rowsPurged,
    storageDeleted,
    storageFailures,
    orgsProcessed,
    durationMs: Date.now() - startedAt,
  });

  return { orgsProcessed, rowsPurged, storageDeleted, storageFailures };
}
