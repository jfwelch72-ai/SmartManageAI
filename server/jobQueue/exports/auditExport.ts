// Task #2517 — `bulk_export` generator for the audit-log CSV/JSON
// download (`/api/audit/export`). Identical query and shape as the
// legacy inline path, but writes the artifact to GCS so the HTTP
// request returns immediately with a job id.

import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, users } from "@shared/schema";
import { registerExportGenerator } from "../handlers";
import { uploadExportArtifact } from "./uploadExportArtifact";
import type { JobContext } from "../index";

export const AUDIT_LOG_EXPORT_TYPE = "audit_log";

export interface AuditLogExportParams {
  organizationId: string;
  format: "csv" | "json";
  entityType?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function loadAuditRows(p: AuditLogExportParams) {
  const conditions: SQL[] = [];
  if (p.entityType) conditions.push(eq(auditLog.entityType, p.entityType));
  if (p.action) conditions.push(eq(auditLog.action, p.action as never));
  if (p.dateFrom) conditions.push(gte(auditLog.createdAt, new Date(p.dateFrom)));
  if (p.dateTo) conditions.push(lte(auditLog.createdAt, new Date(p.dateTo)));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      action: auditLog.action,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      createdAt: auditLog.createdAt,
      userEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(50_000);
}

function rowsToCsv(rows: Awaited<ReturnType<typeof loadAuditRows>>): Buffer {
  const headers = [
    "ID",
    "User Email",
    "Entity Type",
    "Entity ID",
    "Action",
    "Old Value",
    "New Value",
    "IP Address",
    "User Agent",
    "Timestamp",
  ];
  const lines = [headers.join(",")];
  for (const log of rows) {
    const cells = [
      log.id,
      log.userEmail || "",
      log.entityType || "",
      log.entityId || "",
      log.action,
      `"${(log.oldValue || "").replace(/"/g, '""')}"`,
      `"${(log.newValue || "").replace(/"/g, '""')}"`,
      log.ipAddress || "",
      `"${(log.userAgent || "").replace(/"/g, '""')}"`,
      log.createdAt?.toISOString() || "",
    ];
    lines.push(cells.join(","));
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

export async function runAuditLogExport(
  params: AuditLogExportParams,
  _ctx: JobContext,
): Promise<{ url: string; bytes: number }> {
  const rows = await loadAuditRows(params);
  const today = new Date().toISOString().slice(0, 10);
  if (params.format === "json") {
    const body = Buffer.from(JSON.stringify(rows, null, 2), "utf8");
    return uploadExportArtifact({
      organizationId: params.organizationId,
      extension: "json",
      filename: `audit-log-${today}`,
      contentType: "application/json",
      body,
    });
  }
  const body = rowsToCsv(rows);
  return uploadExportArtifact({
    organizationId: params.organizationId,
    extension: "csv",
    filename: `audit-log-${today}`,
    contentType: "text/csv; charset=utf-8",
    body,
  });
}

registerExportGenerator(AUDIT_LOG_EXPORT_TYPE, async (params, ctx) => {
  const typed = params as unknown as AuditLogExportParams;
  return runAuditLogExport(typed, ctx);
});
