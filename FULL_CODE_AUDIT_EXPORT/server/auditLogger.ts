import { db } from "./db";
import { auditLog, type InsertAuditLog } from "@shared/schema";
import type { Request } from "express";

// NOTE: Neon HTTP driver doesn't support transactions in serverless environments
// DbTransaction type is optional - tx parameter will be undefined
type DbTransaction = any;

export async function logAudit(
  data: Omit<InsertAuditLog, "ipAddress" | "userAgent">, 
  req?: Request,
  tx?: DbTransaction
): Promise<void> {
  try {
    const dbClient = tx || db;
    await dbClient.insert(auditLog).values({
      ...data,
      ipAddress: req?.ip || req?.socket.remoteAddress || null,
      userAgent: req?.get("user-agent") || null,
    });
  } catch (error) {
    console.error("Audit logging failed:", error);
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
