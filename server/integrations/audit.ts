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
 * Task #1442 — Per-org ring buffer of recent Davis-Bacon
 * `davis_bacon.suppression_reset` events. The integrations panel reads
 * this so admins can see "Jane reset CA20260111 4 minutes ago" before
 * they click Reset themselves during an active outage and end up
 * stomping on each other.
 *
 * Stored in-memory (matching the rest of this file) — the audit logger
 * is the canonical record; this buffer is just a fast lookup for the
 * UI's most-recent-N display.
 */
export interface SuppressionResetAuditEntry {
  orgId: string;
  connectionId: string;
  decisionNumber: string;
  userId?: string;
  cleared: boolean;
  timestamp: string;
}

const suppressionResetLog: SuppressionResetAuditEntry[] = [];
const MAX_SUPPRESSION_RESET_LOG_SIZE = 500;

export function recordSuppressionReset(
  entry: Omit<SuppressionResetAuditEntry, "timestamp">,
): void {
  suppressionResetLog.unshift({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (suppressionResetLog.length > MAX_SUPPRESSION_RESET_LOG_SIZE) {
    suppressionResetLog.length = MAX_SUPPRESSION_RESET_LOG_SIZE;
  }
}

export function listSuppressionResets(
  orgId: string,
  limit: number = 50,
): SuppressionResetAuditEntry[] {
  const out: SuppressionResetAuditEntry[] = [];
  for (const e of suppressionResetLog) {
    if (e.orgId !== orgId) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export function _clearSuppressionResetLogForTests(): void {
  suppressionResetLog.length = 0;
}
