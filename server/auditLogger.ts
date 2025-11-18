import { db } from "./db";
import { auditLog, type InsertAuditLog } from "@shared/schema";
import type { Request } from "express";

export async function logAudit(data: Omit<InsertAuditLog, "ipAddress" | "userAgent">, req?: Request): Promise<void> {
  try {
    await db.insert(auditLog).values({
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
  newValue: string,
  req?: Request
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "CREATE",
    oldValue: null,
    newValue,
  }, req);
}

export async function logUpdate(
  userId: string,
  entityType: string,
  entityId: string,
  oldValue: string,
  newValue: string,
  req?: Request
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "UPDATE",
    oldValue,
    newValue,
  }, req);
}

export async function logDelete(
  userId: string,
  entityType: string,
  entityId: string,
  oldValue: string,
  req?: Request
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "DELETE",
    oldValue,
    newValue: null,
  }, req);
}

export async function logApprove(
  userId: string,
  entityType: string,
  entityId: string,
  details: string,
  req?: Request
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "APPROVE",
    oldValue: null,
    newValue: details,
  }, req);
}

export async function logReject(
  userId: string,
  entityType: string,
  entityId: string,
  reason: string,
  req?: Request
): Promise<void> {
  await logAudit({
    userId,
    entityType,
    entityId,
    action: "REJECT",
    oldValue: null,
    newValue: reason,
  }, req);
}
