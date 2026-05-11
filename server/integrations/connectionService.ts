import { db } from "../db";
import { integrationConnections, integrationSyncState, notifications, users } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { logInfo, logWarn, logError } from "../utils/logger";
import { getProvider } from "./registry";
import { encryptMetadata, decryptMetadata, isEncrypted } from "./encryption";
import { logIntegrationAudit } from "./audit";
import type { TokenSet } from "./types";
import { insertNotification } from "../services/notificationService";

export async function listConnections(orgId: string) {
  return db.select().from(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
}

export async function getConnection(id: string, orgId: string) {
  const [connection] = await db.select().from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));
  return connection || null;
}

export async function getDecryptedConnection(id: string, orgId: string) {
  const connection = await getConnection(id, orgId);
  if (!connection || !connection.metadata) return connection;
  return {
    ...connection,
    metadata: decryptMetadata(connection.metadata as Record<string, any>),
  };
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
  // Task #2755 — check if the connection was in needs_reconnect state so we
  // can clear outstanding reconnect notifications after a successful re-auth.
  const [prevState] = await db
    .select({ status: integrationConnections.status })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));
  const wasNeedsReconnect = prevState?.status === "needs_reconnect";

  const rawMetadata = { 
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    tokenType: tokens.tokenType, 
    scope: tokens.scope, 
    expiresAt: tokens.expiresAt?.toISOString(),
    ...(tokens.raw || {}),
  };
  const encryptedMetadata = encryptMetadata(rawMetadata);
  const [updated] = await db.update(integrationConnections)
    .set({ status: "active", metadata: encryptedMetadata, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();
  logIntegrationAudit("security.tokens_encrypted", { orgId, connectionId: id, meta: { event: "tokens_stored_encrypted" } });
  logInfo("Connection tokens stored (encrypted)", { connectionId: id, orgId });

  if (wasNeedsReconnect) {
    // Mark outstanding INTEGRATION_RECONNECT_REQUIRED notifications as read
    // so the banner clears from the UI automatically after re-auth.
    try {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(
          and(
            eq(notifications.organizationId, orgId),
            eq(notifications.type, "INTEGRATION_RECONNECT_REQUIRED"),
            eq(notifications.relatedEntityId, id),
          ),
        );
    } catch (err) {
      logError("Failed to clear reconnect notifications", { connectionId: id, error: String(err) });
    }
  }

  return updated;
}

/**
 * Task #2755 — Mark an integration connection as needs_reconnect when the
 * OAuth refresh token is permanently revoked (invalid_grant, AADSTS, etc.).
 * Only transitions if the connection is not already in needs_reconnect state
 * to avoid duplicate notifications. Returns null if no transition occurred.
 */
export async function markConnectionNeedsReconnect(
  id: string,
  orgId: string,
  reason: string,
): Promise<(typeof integrationConnections.$inferSelect) | null> {
  const [current] = await db
    .select({ status: integrationConnections.status, displayName: integrationConnections.displayName, provider: integrationConnections.provider })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));

  if (!current) return null;
  if (current.status === "needs_reconnect") return null;

  const [updated] = await db
    .update(integrationConnections)
    .set({
      status: "needs_reconnect",
      lastSyncError: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();

  logWarn("Integration connection marked as needs_reconnect — user must re-authorize", {
    connectionId: id,
    orgId,
    provider: current.provider,
    reason: reason.slice(0, 200),
  });

  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.organizationId, orgId),
          inArray(users.role, ["ADMIN", "SUPER_ADMIN"]),
          eq(users.isActive, true),
        ),
      );

    const displayName = current.displayName || current.provider;
    await Promise.allSettled(
      admins.map((admin) =>
        insertNotification({
          userId: admin.id,
          organizationId: orgId,
          type: "INTEGRATION_RECONNECT_REQUIRED",
          title: `${displayName} connection has expired`,
          message: `Your ${displayName} OAuth token was revoked. Reconnect in Integrations settings to resume sync.`,
          relatedEntityId: id,
          relatedEntityType: "INTEGRATION_CONNECTION",
        }),
      ),
    );
  } catch (notifyErr) {
    logError("Failed to send reconnect notifications for integration", {
      connectionId: id,
      error: String(notifyErr),
    });
  }

  return updated ?? null;
}

export async function disconnectConnection(id: string, orgId: string) {
  const connection = await getDecryptedConnection(id, orgId);
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
    .set({ status: "disconnected" as any, metadata: {}, updatedAt: new Date() })
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)))
    .returning();
  logIntegrationAudit("security.tokens_cleared", { orgId, connectionId: id, meta: { event: "tokens_cleared_on_disconnect" } });
  logInfo("Connection disconnected", { connectionId: id, orgId });
  return updated;
}

export async function deleteConnection(id: string, orgId: string) {
  await disconnectConnection(id, orgId);
  await db.delete(integrationConnections)
    .where(and(eq(integrationConnections.id, id), eq(integrationConnections.organizationId, orgId)));
  logInfo("Connection deleted", { connectionId: id, orgId });
}

function getTokenStatus(metadata: Record<string, any> | null): "valid" | "expired" | "missing" {
  if (!metadata) return "missing";
  const accessToken = metadata.accessToken;
  if (!accessToken) return "missing";
  const expiresAt = metadata.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) return "expired";
  return "valid";
}

export function sanitizeConnection(connection: any) {
  if (!connection) return connection;

  const metadata = (connection.metadata as Record<string, any>) || {};
  const tokenStatus = getTokenStatus(metadata);
  const hasAccessToken = !!metadata.accessToken;
  const tokensEncrypted = hasAccessToken && isEncrypted(metadata.accessToken);

  const sanitizedMetadata: Record<string, any> = {};
  const safeFields = ["tokenType", "scope", "expiresAt", "realmId", "devMode", "simulatedAt"];
  for (const field of safeFields) {
    if (metadata[field] !== undefined) {
      sanitizedMetadata[field] = metadata[field];
    }
  }

  return {
    ...connection,
    metadata: sanitizedMetadata,
    tokenStatus,
    tokensEncrypted,
  };
}

export function sanitizeConnections(connections: any[]) {
  return connections.map(sanitizeConnection);
}
