import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { getAllProviders, getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import * as importExportService from "./integrations/importExportService";
import { logIntegrationAudit, getSecurityAuditLog } from "./integrations/audit";
import * as outboxService from "./integrations/outboxService";
import { logInfo, logError } from "./utils/logger";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";
import { eq, and, desc } from "drizzle-orm";
import { integrationConnections, type IntegrationConnection, integrationSyncState, qboAccountMappings, qboSyncSchedules, zapierWebhooks, ZAPIER_EVENT_TYPES } from "@shared/schema";
import { db } from "./db";
import { decryptMetadata } from "./integrations/encryption";
import type { AuthRequest } from "./auth";
import { importChartOfAccounts, exportCustomers, exportInvoice, importPaymentStatus, exportPayroll, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "./integrations/providers/qbo";
import { z } from "zod";
import * as webhookService from "./integrations/webhookService";
import { generateWebhookSecret, deliverZapierWebhook } from "./integrations/providers/zapier";

const router = Router();

// ========================================
// Routes from integrationConnectionRoutes.ts
// ========================================

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
    const state = Buffer.from(JSON.stringify({ connectionId: connection.id, orgId: user.organizationId, redirectUri: `${getCanonicalBaseUrl(req)}/api/integrations/connections/${connection.id}/callback` })).toString("base64url");
    const redirectUri = `${getCanonicalBaseUrl(req)}/api/integrations/connections/${connection.id}/callback`;
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

router.get("/cloud-browse", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
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

// ========================================
// Routes from integrationSyncRoutes.ts
// ========================================

const syncSchema = z.object({
  operation: z.enum(["chart_of_accounts", "customers", "invoices", "payment_status"]),
  dryRun: z.boolean().optional().default(false),
  data: z.any().optional(),
});

router.post("/connections/:id/sync", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    let connection = await connectionService.getDecryptedConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.status !== "active") {
      return res.status(400).json({ error: "Connection must be active to sync" });
    }

    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { operation, dryRun, data } = parsed.data;

    if (connection.provider !== "qbo") {
      return res.status(400).json({ error: `Sync not yet supported for provider: ${connection.provider}` });
    }

    const metadata = (connection.metadata as Record<string, any>) || {};
    if (metadata.expiresAt && new Date(metadata.expiresAt) < new Date()) {
      const provider = getProvider(connection.provider);
      if (provider && metadata.refreshToken) {
        try {
          const newTokens = await provider.refreshToken(connection);
          await connectionService.storeConnectionTokens(connection.id, user.organizationId, newTokens);
          connection = (await connectionService.getDecryptedConnection(connection.id, user.organizationId))!;
          logIntegrationAudit("security.token_refresh_success", { orgId: user.organizationId, connectionId: connection.id, provider: connection.provider, userId: user.id });
          logInfo("Token refreshed before sync", { connectionId: connection.id });
        } catch (refreshErr) {
          logIntegrationAudit("security.token_refresh_failed", { orgId: user.organizationId, connectionId: connection.id, provider: connection.provider, userId: user.id, error: String(refreshErr) });
          logError("Token refresh failed before sync", { error: String(refreshErr) });
          return res.status(401).json({ error: "Token expired and refresh failed. Please reconnect." });
        }
      } else {
        return res.status(401).json({ error: "Token expired. Please reconnect the integration." });
      }
    }

    let result;
    const startTime = Date.now();

    switch (operation) {
      case "chart_of_accounts":
        result = await importChartOfAccounts(connection, dryRun);
        break;
      case "customers":
        result = await exportCustomers(connection, data?.customers || [], dryRun);
        break;
      case "invoices":
        if (!data?.invoice) return res.status(400).json({ error: "Invoice data required" });
        result = await exportInvoice(connection, data.invoice, dryRun);
        break;
      case "payment_status":
        if (!data?.invoiceIds?.length) return res.status(400).json({ error: "Invoice IDs required" });
        result = await importPaymentStatus(connection, data.invoiceIds);
        break;
      case "payroll":
        if (!data?.payRunId) return res.status(400).json({ error: "Pay run ID required" });
        result = await exportPayroll(connection, data.payRunId, dryRun);
        break;
      case "subcontractor_payments":
        result = await exportSubcontractorPayments(connection, dryRun);
        break;
      case "purchase_orders":
        result = await exportPurchaseOrders(connection, data?.projectId, dryRun);
        break;
      case "reconcile_payments":
        result = await reconcilePayments(connection, dryRun);
        break;
    }

    const duration = Date.now() - startTime;

    const syncLog = {
      operation,
      dryRun,
      result,
      duration,
      triggeredBy: user.id,
      triggeredAt: new Date().toISOString(),
    };

    const [existing] = await db.select().from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, `sync_log_${operation}`)
      ));

    const prevLogs = (existing?.metadata as any)?.logs || [];
    prevLogs.unshift(syncLog);
    const logs = prevLogs.slice(0, 50);

    if (existing) {
      await db.update(integrationSyncState)
        .set({
          metadata: { logs, latestResult: result },
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(integrationSyncState.id, existing.id));
    } else {
      await db.insert(integrationSyncState).values({
        organizationId: user.organizationId,
        connectionId: connection.id,
        entityType: `sync_log_${operation}`,
        metadata: { logs, latestResult: result },
        lastSyncAt: new Date(),
      });
    }

    if (!dryRun) {
      await connectionService.updateConnectionStatus(connection.id, user.organizationId, "active");
    }

    logIntegrationAudit(`sync.${operation}.${dryRun ? "dry_run" : "executed"}`, {
      orgId: user.organizationId,
      connectionId: connection.id,
      userId: user.id,
      meta: { result, duration },
    });

    logInfo("Sync operation completed", { operation, dryRun, duration, success: result?.success });
    res.json({ ...result, dryRun, duration });
  } catch (err) {
    logError("Sync operation failed", { error: String(err), connectionId: req.params.id });
    res.status(500).json({ error: "Sync operation failed", details: String(err) });
  }
});

router.get("/connections/:id/sync-history", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const syncStates = await db.select().from(integrationSyncState)
      .where(eq(integrationSyncState.connectionId, connection.id))
      .orderBy(desc(integrationSyncState.lastSyncAt));

    const history = syncStates
      .filter(s => s.entityType.startsWith("sync_log_"))
      .map(s => {
        const meta = s.metadata as any;
        return {
          operation: s.entityType.replace("sync_log_", ""),
          lastSyncAt: s.lastSyncAt,
          latestResult: meta?.latestResult || null,
          logs: (meta?.logs || []).slice(0, 20),
        };
      });

    const accountsState = syncStates.find(s => s.entityType === "chart_of_accounts");
    const accountData = accountsState ? {
      lastSyncAt: accountsState.lastSyncAt,
      accountCount: (accountsState.metadata as any)?.accounts?.length || 0,
    } : null;

    res.json({ history, chartOfAccounts: accountData, connectionId: connection.id, provider: connection.provider });
  } catch (err) {
    logError("Failed to get sync history", { error: String(err) });
    res.status(500).json({ error: "Failed to get sync history" });
  }
});

router.get("/connections/:id/account-mappings", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const mappings = await db.select().from(qboAccountMappings)
      .where(and(
        eq(qboAccountMappings.connectionId, connection.id),
        eq(qboAccountMappings.organizationId, user.organizationId)
      ));

    res.json(mappings);
  } catch (err) {
    logError("Failed to get account mappings", { error: String(err) });
    res.status(500).json({ error: "Failed to get account mappings" });
  }
});

router.post("/connections/:id/account-mappings", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const { costCode, qboAccountId, qboAccountName, mappingType } = req.body;
    if (!costCode || !qboAccountId || !qboAccountName) {
      return res.status(400).json({ error: "costCode, qboAccountId, and qboAccountName are required" });
    }

    const existing = await db.select().from(qboAccountMappings)
      .where(and(
        eq(qboAccountMappings.connectionId, connection.id),
        eq(qboAccountMappings.organizationId, user.organizationId),
        eq(qboAccountMappings.costCode, costCode),
        eq(qboAccountMappings.mappingType, mappingType || "cost_code")
      ));

    if (existing.length > 0) {
      await db.update(qboAccountMappings)
        .set({ qboAccountId, qboAccountName, updatedAt: new Date() })
        .where(eq(qboAccountMappings.id, existing[0].id));
      res.json({ ...existing[0], qboAccountId, qboAccountName });
    } else {
      const [mapping] = await db.insert(qboAccountMappings).values({
        organizationId: user.organizationId,
        connectionId: connection.id,
        costCode,
        qboAccountId,
        qboAccountName,
        mappingType: mappingType || "cost_code",
      }).returning();
      res.json(mapping);
    }
  } catch (err) {
    logError("Failed to save account mapping", { error: String(err) });
    res.status(500).json({ error: "Failed to save account mapping" });
  }
});

router.delete("/connections/:id/account-mappings/:mappingId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    await db.delete(qboAccountMappings)
      .where(and(
        eq(qboAccountMappings.id, req.params.mappingId),
        eq(qboAccountMappings.organizationId, user.organizationId)
      ));

    res.json({ success: true });
  } catch (err) {
    logError("Failed to delete account mapping", { error: String(err) });
    res.status(500).json({ error: "Failed to delete account mapping" });
  }
});

router.post("/connections/:id/account-mappings/auto-map", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const [coaState] = await db.select().from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, "chart_of_accounts")
      ));

    if (!coaState) {
      return res.status(400).json({ error: "Chart of Accounts must be synced first" });
    }

    const accounts = (coaState.metadata as any)?.accounts || [];
    const { costCodes } = req.body;
    if (!costCodes || !Array.isArray(costCodes) || costCodes.length === 0) {
      return res.status(400).json({ error: "costCodes array is required" });
    }

    const suggestions: Array<{ costCode: string; qboAccountId: string; qboAccountName: string; confidence: string }> = [];
    let created = 0;

    for (const code of costCodes) {
      const codeLower = String(code).toLowerCase().replace(/[-_]/g, " ");
      let bestMatch: { qboId: string; name: string; score: number } | null = null;

      for (const acct of accounts) {
        const acctNameLower = (acct.name || "").toLowerCase();
        if (acctNameLower === codeLower) {
          bestMatch = { qboId: acct.qboId, name: acct.name, score: 1 };
          break;
        }
        if (acctNameLower.includes(codeLower) || codeLower.includes(acctNameLower)) {
          const score = 0.5;
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { qboId: acct.qboId, name: acct.name, score };
          }
        }
      }

      if (bestMatch) {
        const existing = await db.select().from(qboAccountMappings)
          .where(and(
            eq(qboAccountMappings.connectionId, connection.id),
            eq(qboAccountMappings.organizationId, user.organizationId),
            eq(qboAccountMappings.costCode, String(code)),
            eq(qboAccountMappings.mappingType, "cost_code")
          ));

        if (existing.length === 0) {
          await db.insert(qboAccountMappings).values({
            organizationId: user.organizationId,
            connectionId: connection.id,
            costCode: String(code),
            qboAccountId: bestMatch.qboId,
            qboAccountName: bestMatch.name,
            mappingType: "cost_code",
          });
          created++;
        }

        suggestions.push({
          costCode: String(code),
          qboAccountId: bestMatch.qboId,
          qboAccountName: bestMatch.name,
          confidence: bestMatch.score === 1 ? "exact" : "partial",
        });
      }
    }

    res.json({ suggestions, created, total: costCodes.length });
  } catch (err) {
    logError("Auto-map failed", { error: String(err) });
    res.status(500).json({ error: "Auto-map failed" });
  }
});

router.get("/connections/:id/schedules", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const schedules = await db.select().from(qboSyncSchedules)
      .where(and(
        eq(qboSyncSchedules.connectionId, connection.id),
        eq(qboSyncSchedules.organizationId, user.organizationId)
      ));

    res.json(schedules);
  } catch (err) {
    logError("Failed to get sync schedules", { error: String(err) });
    res.status(500).json({ error: "Failed to get sync schedules" });
  }
});

router.post("/connections/:id/schedules", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });

    const { operation, frequency, isActive } = req.body;
    const validOps = ["chart_of_accounts", "customers", "subcontractor_payments", "purchase_orders", "reconcile_payments"];
    if (!operation || !validOps.includes(operation)) {
      return res.status(400).json({ error: `Operation must be one of: ${validOps.join(", ")}` });
    }

    const validFreqs = ["hourly", "every_6h", "daily", "weekly"];
    if (frequency && !validFreqs.includes(frequency)) {
      return res.status(400).json({ error: `Frequency must be one of: ${validFreqs.join(", ")}` });
    }

    const nextRunAt = computeNextRunAt(frequency || "daily");

    const existing = await db.select().from(qboSyncSchedules)
      .where(and(
        eq(qboSyncSchedules.connectionId, connection.id),
        eq(qboSyncSchedules.organizationId, user.organizationId),
        eq(qboSyncSchedules.operation, operation)
      ));

    if (existing.length > 0) {
      const [updated] = await db.update(qboSyncSchedules)
        .set({
          frequency: frequency || existing[0].frequency,
          isActive: isActive !== undefined ? isActive : existing[0].isActive,
          nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(qboSyncSchedules.id, existing[0].id))
        .returning();
      res.json(updated);
    } else {
      const [schedule] = await db.insert(qboSyncSchedules).values({
        organizationId: user.organizationId,
        connectionId: connection.id,
        operation,
        frequency: frequency || "daily",
        isActive: isActive !== undefined ? isActive : true,
        nextRunAt,
      }).returning();
      res.json(schedule);
    }
  } catch (err) {
    logError("Failed to save sync schedule", { error: String(err) });
    res.status(500).json({ error: "Failed to save sync schedule" });
  }
});

router.delete("/connections/:id/schedules/:scheduleId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    await db.delete(qboSyncSchedules)
      .where(and(
        eq(qboSyncSchedules.id, req.params.scheduleId),
        eq(qboSyncSchedules.organizationId, user.organizationId)
      ));

    res.json({ success: true });
  } catch (err) {
    logError("Failed to delete sync schedule", { error: String(err) });
    res.status(500).json({ error: "Failed to delete sync schedule" });
  }
});

function computeNextRunAt(frequency: string): Date {
  const now = new Date();
  switch (frequency) {
    case "hourly":
      return new Date(now.getTime() + 60 * 60 * 1000);
    case "every_6h":
      return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    case "daily":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "weekly":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

// ========================================
// Routes from integrationWebhookRoutes.ts
// ========================================

router.get("/events", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const events = await outboxService.getOutboxEvents(user.organizationId, 100);
    res.json(events);
  } catch (err) {
    logError("Failed to list events", { error: String(err) });
    res.status(500).json({ error: "Failed to list events" });
  }
});

router.post("/webhooks/subscribe", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { connectionId, eventType, targetUrl } = req.body;
    if (!connectionId || !eventType || !targetUrl) return res.status(400).json({ error: "Missing required fields" });
    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const sub = await webhookService.createSubscription(user.organizationId, connectionId, eventType, targetUrl);
    res.status(201).json({ id: sub.id, eventType: sub.eventType, targetUrl: sub.targetUrl });
  } catch (err) {
    logError("Failed to create webhook subscription", { error: String(err) });
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

router.post("/webhooks/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Super admin access required" });
    const { targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: "targetUrl required" });
    const result = await webhookService.deliverWebhook(targetUrl, { test: true, timestamp: new Date().toISOString() }, "test-secret");
    res.json({ delivered: result.ok, status: result.status });
  } catch (err) {
    res.status(500).json({ error: "Webhook test failed", details: String(err) });
  }
});

const zapierWebhookSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1).max(100),
  webhookUrl: z.string().url(),
  eventTypes: z.array(z.string().refine(
    (val) => (ZAPIER_EVENT_TYPES as readonly string[]).includes(val),
    { message: "Invalid event type" }
  )).min(1),
});

router.get("/zapier/webhooks", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const webhooks = await db
      .select()
      .from(zapierWebhooks)
      .where(eq(zapierWebhooks.organizationId, user.organizationId))
      .orderBy(desc(zapierWebhooks.createdAt));
    res.json(webhooks);
  } catch (err) {
    logError("Failed to list Zapier webhooks", { error: String(err) });
    res.status(500).json({ error: "Failed to list webhooks" });
  }
});

router.post("/zapier/webhooks", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const parsed = zapierWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { connectionId, name, webhookUrl, eventTypes } = parsed.data;
    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "zapier") return res.status(400).json({ error: "Connection must be a Zapier connection" });

    const secretKey = generateWebhookSecret();
    const [webhook] = await db.insert(zapierWebhooks).values({
      organizationId: user.organizationId,
      connectionId,
      name,
      webhookUrl,
      eventTypes,
      secretKey,
      isActive: true,
    }).returning();

    logIntegrationAudit("zapier.webhook_created", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: webhook.id, name, eventTypes },
    });
    res.status(201).json(webhook);
  } catch (err) {
    logError("Failed to create Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to create webhook" });
  }
});

router.patch("/zapier/webhooks/:webhookId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const { name, webhookUrl, eventTypes, isActive } = req.body;
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
    if (eventTypes !== undefined) updates.eventTypes = eventTypes;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await db
      .update(zapierWebhooks)
      .set(updates)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Webhook not found" });
    logIntegrationAudit("zapier.webhook_updated", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: updated.id },
    });
    res.json(updated);
  } catch (err) {
    logError("Failed to update Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to update webhook" });
  }
});

router.delete("/zapier/webhooks/:webhookId", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const [deleted] = await db
      .delete(zapierWebhooks)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      )
      .returning();

    if (!deleted) return res.status(404).json({ error: "Webhook not found" });
    logIntegrationAudit("zapier.webhook_deleted", {
      orgId: user.organizationId,
      userId: user.id,
      meta: { webhookId: deleted.id },
    });
    res.json({ success: true });
  } catch (err) {
    logError("Failed to delete Zapier webhook", { error: String(err) });
    res.status(500).json({ error: "Failed to delete webhook" });
  }
});

router.post("/zapier/webhooks/:webhookId/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const [webhook] = await db
      .select()
      .from(zapierWebhooks)
      .where(
        and(
          eq(zapierWebhooks.id, req.params.webhookId),
          eq(zapierWebhooks.organizationId, user.organizationId)
        )
      );
    if (!webhook) return res.status(404).json({ error: "Webhook not found" });

    const result = await deliverZapierWebhook(
      webhook.webhookUrl,
      "test.ping",
      { message: "Test webhook from SmartManageAI", organization: user.organizationId },
      webhook.secretKey
    );
    res.json({ delivered: result.ok, status: result.status });
  } catch (err) {
    logError("Zapier webhook test failed", { error: String(err) });
    res.status(500).json({ error: "Webhook test failed" });
  }
});

router.get("/zapier/event-types", requireAuth, (_req, res) => {
  res.json(ZAPIER_EVENT_TYPES);
});

router.post("/zapier/incoming/:secretKey", async (req, res) => {
  try {
    const { secretKey } = req.params;
    if (!secretKey) return res.status(400).json({ error: "Missing secret key" });

    const [webhook] = await db
      .select()
      .from(zapierWebhooks)
      .where(eq(zapierWebhooks.secretKey, secretKey));

    if (!webhook || !webhook.isActive) {
      return res.status(404).json({ error: "Webhook not found or inactive" });
    }

    logInfo("Zapier incoming webhook received", {
      webhookId: webhook.id,
      orgId: webhook.organizationId,
      action: req.body?.action || "unknown",
    });

    res.json({ received: true, webhookId: webhook.id });
  } catch (err) {
    logError("Zapier incoming webhook error", { error: String(err) });
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
