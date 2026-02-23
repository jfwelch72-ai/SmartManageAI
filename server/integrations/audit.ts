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
  | "event.dead_letter";

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
}
