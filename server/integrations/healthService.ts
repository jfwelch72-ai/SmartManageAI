import { db } from "../db";
import { integrationConnections } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decryptMetadata } from "./encryption";

export type HealthSeverity = "ok" | "warning" | "error";

export interface ConnectionHealth {
  connectionId: string;
  provider: string;
  displayName: string | null;
  status: string;
  severity: HealthSeverity;
  message: string;
  expiresAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function getConnectionHealth(orgId: string): Promise<ConnectionHealth[]> {
  const rows = await db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  const now = Date.now();
  return rows.map((row) => {
    const metadata = row.metadata ? decryptMetadata(row.metadata as Record<string, any>) : {};
    const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null;
    let severity: HealthSeverity = "ok";
    let message = "Healthy";
    if (row.status === "error") {
      severity = "error";
      message = row.lastSyncError || "Last sync failed";
    } else if (row.status === "disconnected") {
      severity = "warning";
      message = "Disconnected";
    } else if (!metadata.accessToken && row.status !== "pending") {
      severity = "warning";
      message = "Missing credentials";
    } else if (expiresAt) {
      const msUntil = expiresAt.getTime() - now;
      if (msUntil <= 0) {
        severity = "error";
        message = "Access token expired";
      } else if (msUntil < 24 * 60 * 60 * 1000) {
        severity = "warning";
        message = `Token expires in ${Math.round(msUntil / 60_000)} min`;
      }
    }
    return {
      connectionId: row.id,
      provider: row.provider,
      displayName: row.displayName,
      status: row.status,
      severity,
      message,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      lastError: row.lastSyncError,
    };
  });
}
