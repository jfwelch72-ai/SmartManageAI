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
