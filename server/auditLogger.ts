import { logError } from "./utils/logger";
import { db } from "./db";
import { auditLog, type InsertAuditLog } from "@shared/schema";
import type { Request } from "express";

// NOTE: Neon HTTP driver doesn't support transactions in serverless environments
// DbTransaction type is optional - tx parameter will be undefined
type DbTransaction = any;

// Runtime guard for Task #1492: reject non-string userId values before they
// reach the database. The original Task #1454 bug
//   logCreate(req, "plan_document", ..., req)
// passed the entire Express Request as the userId. Drizzle/Neon then tried to
// JSON.stringify the request and failed with "Converting circular structure
// to JSON", which is swallowed by the catch below — silently dropping the
// audit row. This guard fails loudly (and visibly in logs) if a non-string
// userId is ever passed, so the next regression is caught immediately rather
// than discovered later via a missing audit trail.
//
// The companion lint at scripts/audit-audit-logger-userid.mjs prevents the
// bad shape from being introduced at the call site in the first place.
function assertStringUserId(userId: unknown, helper: string): userId is string {
  if (typeof userId === "string" && userId.length > 0) return true;
  const received =
    userId === null
      ? "null"
      : userId === undefined
        ? "undefined"
        : typeof userId === "object"
          ? `object (likely an Express Request — pass req.user!.id instead)`
          : `${typeof userId}`;
  logError(
    `Audit logging refused: ${helper} received a non-string userId (${received}). This is a programming error — pass the user id string, not the request.`,
    { helper, receivedType: typeof userId },
    new Error(`${helper}: userId must be a non-empty string`),
  );
  return false;
}

export async function logAudit(
  data: Omit<InsertAuditLog, "ipAddress" | "userAgent">, 
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  if (!assertStringUserId(data?.userId, "logAudit")) return;
  try {
    const dbClient = tx || db;
    await dbClient.insert(auditLog).values({
      ...data,
      ipAddress: req?.ip || req?.socket.remoteAddress || null,
      userAgent: req?.get("user-agent") || null,
    });
  } catch (error) {
    logError("Audit logging failed:", {}, error instanceof Error ? error : new Error(String(error)));
    // Don't throw - audit failure shouldn't break the operation
  }
}

/**
 * Write an audit row for a system-initiated event (no human actor).
 *
 * Unlike `logAudit`, this helper skips the assertStringUserId guard and
 * inserts with `userId: null`. The audit_log.user_id column is nullable so
 * NULL = system-initiated action (e.g. ESCALATE, AUTO_ASSIGN from the SLA
 * monitor). This prevents the FK violation that previously caused system audit
 * rows to be silently dropped.
 */
export async function logSystemAudit(
  data: Omit<InsertAuditLog, "userId" | "ipAddress" | "userAgent">,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      ...data,
      userId: null,
      ipAddress: null,
      userAgent: null,
    });
  } catch (error) {
    logError("System audit logging failed:", {}, error instanceof Error ? error : new Error(String(error)));
  }
}

export async function logCreate(
  userId: string,
  entityType: string,
  entityId: string,
  newValue: unknown,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "CREATE",
    oldValue: null,
    newValue: typeof newValue === 'string' ? newValue : JSON.stringify(newValue),
  }, req, tx);
}

export async function logUpdate(
  userId: string,
  entityType: string,
  entityId: string,
  oldValue: unknown,
  newValue: unknown,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "UPDATE",
    oldValue: typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue),
    newValue: typeof newValue === 'string' ? newValue : JSON.stringify(newValue),
  }, req, tx);
}

export async function logDelete(
  userId: string,
  entityType: string,
  entityId: string,
  oldValue: unknown,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "DELETE",
    oldValue: typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue),
    newValue: null,
  }, req, tx);
}

export async function logApprove(
  userId: string,
  entityType: string,
  entityId: string,
  details: unknown,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "APPROVE",
    oldValue: null,
    newValue: typeof details === 'string' ? details : JSON.stringify(details),
  }, req, tx);
}

export async function logReject(
  userId: string,
  entityType: string,
  entityId: string,
  reason: string,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "REJECT",
    oldValue: null,
    newValue: reason,
  }, req, tx);
}

// ---------------------------------------------------------------------------
// Task #2495 — auth + role-change audit helpers.
// Goal: every login, logout, password change/reset, and role grant/revoke
// lands in the central `audit_log` table so the SOC 2 trail is unified
// (see threat_model.md § 5.5).
// ---------------------------------------------------------------------------

type AuthAuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  | "PASSWORD_RESET_REQUESTED"
  | "MFA_ENABLED"
  | "MFA_DISABLED";

/**
 * Log an authentication event (login, logout, password change, etc.) for
 * `userId`. `actorUserId` defaults to `userId` (the user acting on themselves)
 * but can be passed explicitly for admin-initiated flows like a SUPER_ADMIN
 * triggering a password-reset email on behalf of another user — in that
 * case `userId` is the target whose credential changed and `actorUserId`
 * is who initiated it.
 */
export async function logAuthEvent(
  userId: string,
  action: AuthAuditAction,
  details: Record<string, unknown> | null,
  req?: Request,
  actorUserId?: string,
  tx?: DbTransaction
): Promise<void> {
  await logAudit({
    userId: actorUserId || userId,
    entityType: "users",
    entityId: userId,
    action: action as InsertAuditLog["action"],
    oldValue: null,
    newValue: details ? JSON.stringify(details) : null,
  }, req, tx);
}

/**
 * Log a role change on a user. `scope` distinguishes a base-role swap on
 * the `users.role` column (`PLATFORM` / `ORG`) from a HUSTLER oversight
 * grant on `hustler_organizations` (`HUSTLER_ORG`). `oldRole` may be
 * `null` for a brand-new grant; `newRole` may be `null` for a revoke.
 */
export async function logRoleChange(
  actorUserId: string,
  targetUserId: string,
  oldRole: string | null,
  newRole: string | null,
  scope: "PLATFORM" | "ORG" | "HUSTLER_ORG",
  details: Record<string, unknown> | null,
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  let action: InsertAuditLog["action"];
  if (scope === "HUSTLER_ORG") {
    action = (newRole ? "ROLE_GRANTED" : "ROLE_REVOKED") as InsertAuditLog["action"];
  } else {
    action = "ROLE_CHANGED" as InsertAuditLog["action"];
  }
  await logAudit({
    userId: actorUserId,
    entityType: scope === "HUSTLER_ORG" ? "hustlerOrganizations" : "users",
    entityId: targetUserId,
    action,
    oldValue: oldRole ? JSON.stringify({ role: oldRole, scope }) : null,
    newValue: JSON.stringify({ role: newRole, scope, ...(details || {}) }),
  }, req, tx);
}

// Export the transaction type for use in other files
export type { DbTransaction };
