import { logInfo } from "./logger";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError } from "./logger";

const REQUIRED_NOTIFICATION_TYPES = [
  "BID_SUBMITTED",
  "BID_STATUS_CHANGED",
  "BID_ASSIGNED",
  "BID_DUE_DATE_APPROACHING",
  // Heavy-civil DOT workflow notifications (Task #483)
  "HAUL_TICKET_SUBMITTED", "HAUL_TICKET_APPROVED", "HAUL_TICKET_REJECTED", "HAUL_TICKET_VOIDED",
  "INSPECTOR_REPORT_SUBMITTED", "INSPECTOR_REPORT_APPROVED", "INSPECTOR_REPORT_REVISION_REQUESTED",
  "MATERIAL_CERT_SUBMITTED", "MATERIAL_CERT_VERIFIED", "MATERIAL_CERT_REJECTED",
  "SURETY_BOND_ACTIVATED", "SURETY_BOND_RELEASED", "SURETY_BOND_EXPIRED", "SURETY_BOND_CANCELED",
  // Task #709: CRM contact reassignment heads-up notification
  "CRM_CONTACT_REASSIGNED",
  // Task #723: bundle the same coalesced reassignment notifications for
  // CRM opportunities and projects so rapid-fire owner changes don't spam
  // a separate email per record.
  "CRM_OPPORTUNITY_REASSIGNED",
  "PROJECT_REASSIGNED",
  // Task #731: bundle the same coalesced reassignment notifications for CRM
  // organisations now that the table has its own ownerId column.
  "CRM_ORGANIZATION_REASSIGNED",
  // Task #1005: heads-up notification when a CRM transcript backfill job is
  // reaped to FAILED on boot because it exceeded the max-resumable age.
  "CRM_TRANSCRIPT_BACKFILL_REAPED",
  // Task #1144 — values originally added by baseline migrations
  // 0012_tm_workflow_enhancements.sql and 0014_drawing_sets_and_revisions.sql.
  // Without these, long-lived dev DBs created before those migrations would
  // 500 the moment the TM auto-invoice or document-revision notification path
  // tried to insert a row.
  "TM_INVOICE_AUTO_CREATED",
  "DOCUMENT_REVISION_CREATED",
  // Task #1332: heads-up when a background Davis-Bacon (DOL/SAM.gov) sync
  // queued by project create/update fails.
  "DAVIS_BACON_AUTO_SYNC_FAILED",
  // Task #1260: dedicated SWPPP overdue corrective-action fanout type so
  // users can mute it independently of the generic REMINDER notifications.
  "SWPPP_OVERDUE_CORRECTIVE_ACTION",
  // Task #1344: daily reminder fan-out to org admins when a project's
  // Davis-Bacon wage decision has been missing from the local cache.
  "WAGE_DECISION_MISSING_REMINDER",
  // Task #1391: heads-up to org admins the first time a generic
  // integration sync row exhausts MAX_SYNC_RETRIES.
  "INTEGRATION_SYNC_RETRIES_EXHAUSTED",
  // Task #1400: stale-refresh sweep produced different rates from the
  // prior cached payload — notify project managers of affected projects.
  "WAGE_DECISION_RATES_CHANGED",
  // Task #1449: per-PM email triggered when persistRateChangeRecords
  // writes new panel-flag records.
  "WAGE_DECISION_RATES_CHANGED_FOR_PM",
  // Task #1637: scheduled RFI / submittal log email transitioned into
  // FAILURE / NO_RECIPIENTS — fan-out to the schedule's last editor +
  // project manager.
  "PROJECT_LOG_EMAIL_FAILED",
  // Task #2143: self-serve "Request access" flow — fan-out to org admins
  // when a user submits a request from the friendly 403 toast, and
  // approve/deny notifications back to the requester.
  "ACCESS_REQUEST_NEW",
  "ACCESS_REQUEST_APPROVED",
  "ACCESS_REQUEST_DENIED",
  // Task #1715: daily digest to org ADMIN / SUPER_ADMIN users
  // summarising every schedule whose latest attempt was
  // FAILURE / NO_RECIPIENTS. Distinct enum value so admins can mute
  // the digest independently of the per-failure pings.
  "PROJECT_LOG_EMAIL_FAILURES_DIGEST",
];

export async function ensureNotificationEnumValues(): Promise<void> {
  try {
    const result = await db.execute(sql`
      SELECT unnest(enum_range(NULL::notification_type))::text AS val
    `);
    const existing = new Set((result.rows as { val: string }[]).map(r => r.val));

    let added = 0;
    for (const val of REQUIRED_NOTIFICATION_TYPES) {
      if (!existing.has(val)) {
        await db.execute(sql.raw(`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '${val}'`));
        added++;
      }
    }

    if (added > 0) {
      logInfo(`[migration] notification_type enum — added ${added} missing value(s)`);
    } else {
      logInfo("[migration] notification_type enum — all values present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure notification_type enum values:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
