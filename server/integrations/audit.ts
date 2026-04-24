import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { integrationSuppressionResets } from "@shared/schema";
import { logInfo, logWarn, logError } from "../utils/logger";

export type IntegrationAuditAction = 
  | "connection.created"
  | "connection.authorized"
  | "connection.disconnected"
  | "connection.deleted"
  | "connection.error"
  | "connection.dev_activated"
  | "sync.started"
  | "sync.completed"
  | "sync.failed"
  | `sync.${string}.dry_run`
  | `sync.${string}.executed`
  | "webhook.delivered"
  | "webhook.failed"
  | "event.enqueued"
  | "event.sent"
  | "event.dead_letter"
  | "security.tokens_encrypted"
  | "security.tokens_decrypted"
  | "security.tokens_cleared"
  | "security.token_refresh_success"
  | "security.token_refresh_failed"
  | "security.auth_attempt_failed"
  | "security.credentials_changed";

export interface SecurityAuditEntry {
  action: string;
  timestamp: string;
  connectionId?: string;
  provider?: string;
  userId?: string;
  success: boolean;
  details?: string;
}

const securityAuditLog: SecurityAuditEntry[] = [];
const MAX_SECURITY_LOG_SIZE = 500;

export function logIntegrationAudit(
  action: IntegrationAuditAction | string,
  details: {
    orgId: string;
    connectionId?: string;
    provider?: string;
    userId?: string;
    entityType?: string;
    entityId?: string;
    error?: string;
    meta?: Record<string, any>;
  }
) {
  const level = action.includes("error") || action.includes("failed") || action.includes("dead_letter") ? "error" : "info";
  const message = `[IntegrationAudit] ${action}`;
  
  if (level === "error") {
    logError(message, details);
  } else {
    logInfo(message, details);
  }

  if (action.startsWith("security.") || action.includes("authorized") || action.includes("disconnected")) {
    const entry: SecurityAuditEntry = {
      action,
      timestamp: new Date().toISOString(),
      connectionId: details.connectionId,
      provider: details.provider,
      userId: details.userId,
      success: !action.includes("failed"),
      details: details.meta ? JSON.stringify(details.meta) : details.error || undefined,
    };
    securityAuditLog.unshift(entry);
    if (securityAuditLog.length > MAX_SECURITY_LOG_SIZE) {
      securityAuditLog.length = MAX_SECURITY_LOG_SIZE;
    }
  }
}

export function getSecurityAuditLog(limit: number = 50): SecurityAuditEntry[] {
  return securityAuditLog.slice(0, limit);
}

/**
 * Task #1442 / #1472 — Per-org history of recent Davis-Bacon
 * `davis_bacon.suppression_reset` events. The integrations panel reads
 * this so admins can see "Jane reset CA20260111 4 minutes ago" before
 * they click Reset themselves during an active outage and end up
 * stomping on each other.
 *
 * Originally a process-local ring buffer; now persisted to
 * `integration_suppression_resets` so the "Last reset by X at Y" line
 * survives a server restart or redeploy. The structured audit log
 * remains the canonical record; this table is just a fast,
 * org-scoped feed for the UI's most-recent-N display.
 */
export interface SuppressionResetAuditEntry {
  orgId: string;
  connectionId: string;
  decisionNumber: string;
  userId?: string;
  cleared: boolean;
  timestamp: string;
}

export async function recordSuppressionReset(
  entry: Omit<SuppressionResetAuditEntry, "timestamp">,
): Promise<void> {
  try {
    await db.insert(integrationSuppressionResets).values({
      organizationId: entry.orgId,
      connectionId: entry.connectionId,
      decisionNumber: entry.decisionNumber,
      userId: entry.userId ?? null,
      cleared: entry.cleared,
    });
  } catch (err) {
    // Persistence failure here must not break the reset request — the
    // structured audit logger above already captured the event.
    logWarn("[IntegrationAudit] failed to persist suppression reset", {
      orgId: entry.orgId,
      connectionId: entry.connectionId,
      decisionNumber: entry.decisionNumber,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function listSuppressionResets(
  orgId: string,
  limit: number = 50,
): Promise<SuppressionResetAuditEntry[]> {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 50;
  const rows = await db
    .select({
      connectionId: integrationSuppressionResets.connectionId,
      decisionNumber: integrationSuppressionResets.decisionNumber,
      userId: integrationSuppressionResets.userId,
      cleared: integrationSuppressionResets.cleared,
      createdAt: integrationSuppressionResets.createdAt,
    })
    .from(integrationSuppressionResets)
    .where(eq(integrationSuppressionResets.organizationId, orgId))
    .orderBy(desc(integrationSuppressionResets.createdAt))
    .limit(safeLimit);
  return rows.map((r) => ({
    orgId,
    connectionId: r.connectionId,
    decisionNumber: r.decisionNumber,
    userId: r.userId ?? undefined,
    cleared: r.cleared,
    timestamp:
      r.createdAt instanceof Date
        ? r.createdAt.toISOString()
        : new Date(r.createdAt as unknown as string).toISOString(),
  }));
}

export async function _clearSuppressionResetLogForTests(): Promise<void> {
  await db.delete(integrationSuppressionResets);
}
