import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { getAllProviders, getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import * as importExportService from "./integrations/importExportService";
import { logIntegrationAudit, getSecurityAuditLog } from "./integrations/audit";
import * as outboxService from "./integrations/outboxService";
import { logInfo, logError } from "./utils/logger";
import { eq, and } from "drizzle-orm";
import { integrationConnections, type IntegrationConnection } from "@shared/schema";
import { db } from "./db";
import { decryptMetadata } from "./integrations/encryption";
import type { AuthRequest } from "./auth";

const router = Router();

router.get("/providers", requireAuth, (req, res) => {
  const providers = getAllProviders().map(p => ({
    key: p.key,
    displayName: p.displayName,
    authType: p.authType,
    featureFlag: p.featureFlag,
  }));
  res.json(providers);
});

router.get("/connections", requireAuth, async (req, res) => {
  try {
    const orgId = (req as any).user.organizationId;
    const connections = await connectionService.listConnections(orgId);
    res.json(connectionService.sanitizeConnections(connections));
  } catch (err) {
    logError("Failed to list connections", { error: String(err) });
    res.status(500).json({ error: "Failed to list connections" });
  }
});

router.post("/connections", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { provider, displayName, devMode } = req.body;
    if (!provider) return res.status(400).json({ error: "Provider required" });
    const providerImpl = getProvider(provider);
    if (!providerImpl) return res.status(400).json({ error: "Unknown provider" });
    const connection = await connectionService.createConnection(user.organizationId, provider, displayName || providerImpl.displayName, user.id);

    if (devMode && process.env.NODE_ENV !== "production") {
      await connectionService.storeConnectionTokens(connection.id, user.organizationId, {
        accessToken: "dev-simulated-token",
        refreshToken: "dev-simulated-refresh",
        expiresAt: new Date(Date.now() + 86400000 * 365),
        scope: providerImpl.requiredScopes.join(" "),
        tokenType: "Bearer",
        raw: { devMode: true, simulatedAt: new Date().toISOString() },
      });
      logIntegrationAudit("connection.dev_activated", { orgId: user.organizationId, connectionId: connection.id, provider, userId: user.id });
      const updated = await connectionService.getConnection(connection.id, user.organizationId); 
      return res.status(201).json(connectionService.sanitizeConnection(updated));
    }

    logIntegrationAudit("connection.created", { orgId: user.organizationId, connectionId: connection.id, provider, userId: user.id });
    res.status(201).json(connectionService.sanitizeConnection(connection));
  } catch (err) {
    logError("Failed to create connection", { error: String(err) });
    res.status(500).json({ error: "Failed to create connection" });
  }
});

router.post("/connections/:id/authorize", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const connection = await connectionService.getDecryptedConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const provider = getProvider(connection.provider);
    if (!provider) return res.status(400).json({ error: "Provider not registered" });
    const state = Buffer.from(JSON.stringify({ connectionId: connection.id, orgId: user.organizationId })).toString("base64url");
    const redirectUri = `${req.protocol}://${req.get("host")}/api/integrations/connections/${connection.id}/callback`;
    const authUrl = provider.getAuthUrl(connection.id, redirectUri, state);
    res.json({ authUrl });
  } catch (err) {
    logError("Failed to start authorization", { error: String(err) });
    res.status(500).json({ error: "Failed to start authorization" });
  }
});

router.get("/connections/:id/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: "Missing code or state" });
    const stateData = JSON.parse(Buffer.from(state as string, "base64url").toString());
    const { connectionId, orgId } = stateData;
    const connection = await connectionService.getDecryptedConnection(connectionId, orgId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const provider = getProvider(connection.provider);
    if (!provider) return res.status(400).json({ error: "Provider not registered" });
    const tokens = await provider.handleCallback(code as string, state as string);
    await connectionService.storeConnectionTokens(connectionId, orgId, tokens);
    logIntegrationAudit("connection.authorized", { orgId, connectionId, provider: connection.provider });
    res.redirect("/settings/integrations?connected=true");
  } catch (err) {
    logError("OAuth callback failed", { error: String(err) });
    res.redirect("/settings/integrations?error=callback_failed");
  }
});

router.post("/connections/:id/disconnect", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const updated = await connectionService.disconnectConnection(req.params.id, user.organizationId);
    if (!updated) return res.status(404).json({ error: "Connection not found" });
    logIntegrationAudit("connection.disconnected", { orgId: user.organizationId, connectionId: req.params.id, userId: user.id });
    res.json(connectionService.sanitizeConnection(updated));
  } catch (err) {
    logError("Failed to disconnect", { error: String(err) });
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.post("/connections/:id/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const connection = await connectionService.getDecryptedConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const provider = getProvider(connection.provider);
    if (!provider) return res.status(400).json({ error: "Provider not registered" });

    const result = await provider.testConnection(connection);
    res.json(result);
  } catch (err) {
    logError("Connection test failed", { error: String(err) });
    res.status(500).json({ error: "Connection test failed" });
  }
});

router.post("/import", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const { entityType, data } = req.body;
    if (!entityType || !data) return res.status(400).json({ error: "entityType and data required" });
    const result = await importExportService.importFromCsv(user.organizationId, entityType, data);
    res.json(result);
  } catch (err) {
    logError("Import failed", { error: String(err) });
    res.status(500).json({ error: "Import failed" });
  }
});

router.get("/export", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const entityType = req.query.entityType as string;
    if (!entityType) return res.status(400).json({ error: "entityType required" });
    const csv = await importExportService.exportToCsv(user.organizationId, entityType);
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (err) {
    logError("Export failed", { error: String(err) });
    res.status(500).json({ error: "Export failed" });
  }
});

router.get("/audit", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const events = await outboxService.getOutboxEvents(user.organizationId, 200);
    res.json(events);
  } catch (err) {
    logError("Failed to get audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get audit log" });
  }
});

router.get("/security-log", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const entries = getSecurityAuditLog(Math.min(limit, 200));
    res.json(entries);
  } catch (err) {
    logError("Failed to get security audit log", { error: String(err) });
    res.status(500).json({ error: "Failed to get security log" });
  }
});

type CloudProvider = "gdrive" | "dropbox";

interface CloudFileEntry {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  modifiedAt: string | null;
  isFolder: boolean;
  path?: string;
}

interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

interface DropboxFileEntry {
  ".tag": string;
  id?: string;
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  client_modified?: string;
  server_modified?: string;
}

interface DropboxSearchMatch {
  metadata?: {
    ".tag"?: string;
    metadata?: DropboxFileEntry;
    id?: string;
    name?: string;
    path_lower?: string;
    path_display?: string;
    size?: number;
    client_modified?: string;
    server_modified?: string;
  };
}

async function getValidAccessToken(provider: CloudProvider, orgId: string): Promise<{ accessToken: string; connection: IntegrationConnection } | null> {
  const [connection] = await db
    .select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.organizationId, orgId),
      eq(integrationConnections.provider, provider),
      eq(integrationConnections.status, "active"),
    ))
    .limit(1);

  if (!connection || !connection.metadata) return null;

  const metadata = decryptMetadata(connection.metadata as Record<string, unknown>);
  const accessTokenRaw = metadata.accessToken;
  if (!accessTokenRaw || typeof accessTokenRaw !== "string") return null;
  let accessToken: string = accessTokenRaw;

  const expiresAtRaw = metadata.expiresAt;
  const expiresAt = expiresAtRaw && typeof expiresAtRaw === "string" ? new Date(expiresAtRaw) : null;
  const isExpired = expiresAt && expiresAt < new Date(Date.now() + 60000);

  if (isExpired && metadata.refreshToken) {
    const providerImpl = getProvider(provider);
    if (!providerImpl) return null;
    try {
      const tokens = await providerImpl.refreshToken({ ...connection, metadata });
      await connectionService.storeConnectionTokens(connection.id, orgId, tokens);
      accessToken = tokens.accessToken;
    } catch (err) {
      logError("Token refresh failed during cloud browse", { error: String(err) });
      return null;
    }
  }

  return { accessToken, connection };
}

router.get("/cloud-browse", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "FOREMAN"), async (req: AuthRequest, res) => {
  try {
    const { provider, folderId, query } = req.query as Record<string, string>;

    if (!provider || !["gdrive", "dropbox"].includes(provider)) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    const cloudProvider = provider as CloudProvider;
    const tokenData = await getValidAccessToken(cloudProvider, req.user!.organizationId!);
    if (!tokenData) {
      return res.status(401).json({ error: "No active connection for provider" });
    }

    const { accessToken } = tokenData;

    if (cloudProvider === "gdrive") {
      const params = new URLSearchParams({
        pageSize: "50",
        fields: "files(id,name,mimeType,size,modifiedTime,parents)",
        orderBy: "folder,name",
      });

      const q: string[] = ["trashed = false"];
      if (query) {
        q.push(`name contains '${query.replace(/'/g, "\\'")}'`);
      } else if (folderId) {
        q.push(`'${folderId}' in parents`);
      } else {
        q.push("'root' in parents");
      }
      params.set("q", q.join(" and "));

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!driveRes.ok) {
        const errText = await driveRes.text();
        logError("Google Drive list failed", { status: driveRes.status, body: errText });
        return res.status(502).json({ error: "Failed to list Google Drive files" });
      }

      const GOOGLE_NATIVE_MIME_TYPES = new Set([
        "application/vnd.google-apps.document",
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.google-apps.presentation",
        "application/vnd.google-apps.drawing",
        "application/vnd.google-apps.form",
        "application/vnd.google-apps.script",
        "application/vnd.google-apps.site",
        "application/vnd.google-apps.map",
      ]);

      const driveData = await driveRes.json() as { files?: DriveFileEntry[] };
      const files: CloudFileEntry[] = (driveData.files || [])
        .filter((f) => {
          if (f.mimeType === "application/vnd.google-apps.folder") return true;
          return !GOOGLE_NATIVE_MIME_TYPES.has(f.mimeType);
        })
        .map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size ? parseInt(f.size) : null,
          modifiedAt: f.modifiedTime ?? null,
          isFolder: f.mimeType === "application/vnd.google-apps.folder",
        }));

      return res.json({ files });
    }

    if (cloudProvider === "dropbox") {
      const path = folderId || "";
      if (query) {
        const searchRes = await fetch(
          "https://api.dropboxapi.com/2/files/search_v2",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query, options: { path: path || undefined, max_results: 50 } }),
          }
        );
        if (!searchRes.ok) {
          return res.status(502).json({ error: "Failed to search Dropbox files" });
        }
        const searchData = await searchRes.json() as { matches?: DropboxSearchMatch[] };
        const files: CloudFileEntry[] = (searchData.matches || []).map((m) => {
          const meta: DropboxFileEntry = (m.metadata?.metadata || m.metadata) as DropboxFileEntry;
          return {
            id: meta.id || meta.path_lower || meta.name,
            name: meta.name,
            mimeType: null,
            size: meta.size ?? null,
            modifiedAt: meta.client_modified || meta.server_modified || null,
            isFolder: meta[".tag"] === "folder",
            path: meta.path_display || meta.path_lower,
          };
        });
        return res.json({ files });
      } else {
        const listRes = await fetch(
          "https://api.dropboxapi.com/2/files/list_folder",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ path, limit: 100 }),
          }
        );
        if (!listRes.ok) {
          return res.status(502).json({ error: "Failed to list Dropbox files" });
        }
        const listData = await listRes.json() as { entries?: DropboxFileEntry[] };
        const files: CloudFileEntry[] = (listData.entries || []).map((f) => ({
          id: f.id || f.path_lower || f.name,
          name: f.name,
          mimeType: null,
          size: f.size ?? null,
          modifiedAt: f.client_modified || f.server_modified || null,
          isFolder: f[".tag"] === "folder",
          path: f.path_display || f.path_lower,
        }));
        return res.json({ files });
      }
    }

    return res.status(400).json({ error: "Unsupported provider" });
  } catch (err) {
    logError("Cloud browse error", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
