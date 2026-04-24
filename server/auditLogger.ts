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

// Export the transaction type for use in other files
export type { DbTransaction };
