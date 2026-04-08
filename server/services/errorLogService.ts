import { pool } from "../db";
import { logError as consoleLogError } from "../utils/logger";

interface ErrorLogEntry {
  level?: string;
  message: string;
  stack?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  userId?: string;
  organizationId?: string;
  requestId?: string;
  userAgent?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export async function persistErrorLog(entry: ErrorLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO error_logs (level, message, stack, method, path, status_code, user_id, organization_id, request_id, user_agent, ip, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entry.level || "error",
        entry.message.slice(0, 2000),
        entry.stack?.slice(0, 8000) || null,
        entry.method || null,
        entry.path || null,
        entry.statusCode || null,
        entry.userId || null,
        entry.organizationId || null,
        entry.requestId || null,
        entry.userAgent?.slice(0, 500) || null,
        entry.ip || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  } catch (err) {
    consoleLogError("Failed to persist error log to database", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

export async function pruneOldErrorLogs(daysToKeep = 30): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM error_logs WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [daysToKeep]
    );
    return result.rowCount ?? 0;
  } catch (err) {
    consoleLogError("Failed to prune old error logs", {}, err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
