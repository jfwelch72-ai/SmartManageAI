import { db } from "../db";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

/**
 * Task #2962 — SLA & routing intelligence.
 *
 * Adds ESCALATE and AUTO_ASSIGN values to the audit_action enum so that
 * the escalation engine (slaMonitor.ts → runSlaRiskAlerts) and auto-assign
 * round-robin (runAutoAssign) can write typed audit_log rows.
 *
 * Uses IF NOT EXISTS so repeated calls are idempotent.
 */
export async function ensureAuditActionEnumSlaValues(): Promise<void> {
  try {
    await db.execute(
      sql.raw(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ESCALATE'`),
    );
    await db.execute(
      sql.raw(`ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'AUTO_ASSIGN'`),
    );
    logInfo(
      "[migration] audit_action enum — ESCALATE + AUTO_ASSIGN values ready",
    );
  } catch (err) {
    logError(err, { helper: "ensureAuditActionEnumSlaValues" });
    throw err;
  }
}
