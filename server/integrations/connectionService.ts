import { db } from "../db";
import { integrationConnections, integrationSyncState } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logInfo, logWarn, logError } from "../utils/logger";
import { getProvider } from "./registry";
import type { TokenSet } from "./types";

export async function listConnections(orgId: string) {
  return db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
}

export async function getConnection(id: string, orgId: string) {
  const [connection] = await db.select().from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));
  return connection || null;
}

export async function createConnection(orgId: string, provider: string, displayName: string, userId: string) {
  const [connection] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: provider as any,
    displayName,
    status: "pending",
    createdByUserId: userId,
    metadata: {},
  }).returning();
  logInfo("Integration connection created", { connectionId: connection.id, orgId, provider });
  return connection;
}

export async function updateConnectionStatus(id: string, orgId: string, status: string, error?: string) {
  const [updated] = await db.update(integrationConnections)
    .set({ status: status as any, lastSyncError: error || null, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();
  return updated;
}

export async function storeConnectionTokens(id: string, orgId: string, tokens: TokenSet) {
  const safeMetadata = { 
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    tokenType: tokens.tokenType, 
    scope: tokens.scope, 
    expiresAt: tokens.expiresAt?.toISOString(),
    ...(tokens.raw || {}),
  };
  const [updated] = await db.update(integrationConnections)
    .set({ status: "active" as any, metadata: safeMetadata, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();
  logInfo("Connection tokens stored", { connectionId: id, orgId });
  return updated;
}

export async function disconnectConnection(id: string, orgId: string) {
  const connection = await getConnection(id, orgId);
  if (!connection) return null;
  
  const provider = getProvider(connection.provider);
  if (provider) {
    try {
      await provider.disconnect(connection);
    } catch (err) {
      logWarn("Provider disconnect failed", { connectionId: id, error: String(err) });
    }
  }
  
  const [updated] = await db.update(integrationConnections)
    .set({ status: "disconnected" as any, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();
  logInfo("Connection disconnected", { connectionId: id, orgId });
  return updated;
}

export async function deleteConnection(id: string, orgId: string) {
  await disconnectConnection(id, orgId);
  await db.delete(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));
  logInfo("Connection deleted", { connectionId: id, orgId });
}
