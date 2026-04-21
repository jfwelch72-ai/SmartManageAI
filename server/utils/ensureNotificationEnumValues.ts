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
      console.log(`[migration] notification_type enum — added ${added} missing value(s)`);
    } else {
      console.log("[migration] notification_type enum — all values present, skipped");
    }
  } catch (err) {
    logError("[migration] Failed to ensure notification_type enum values:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
