import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { getAllProviders, getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import * as importExportService from "./integrations/importExportService";
import { logIntegrationAudit, getSecurityAuditLog } from "./integrations/audit";
import { getConnectionHealth } from "./integrations/healthService";
import * as outboxService from "./integrations/outboxService";
import { logInfo, logError } from "./utils/logger";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";
import { eq, and, desc, isNotNull, isNull } from "drizzle-orm";
import { integrationConnections, type IntegrationConnection, integrationSyncState, integrationSyncAlertMutes, qboAccountMappings, qboSyncSchedules, zapierWebhooks, ZAPIER_EVENT_TYPES, projects, users as usersTable } from "@shared/schema";
import { verifyIntegrationSyncMuteToken } from "./utils/integrationSyncMuteToken";
import { db } from "./db";
import { decryptMetadata } from "./integrations/encryption";
import type { AuthRequest } from "./auth";
import { importChartOfAccounts, exportCustomers, exportInvoice, importPaymentStatus, exportPayroll, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "./integrations/providers/qbo";
import { exportHaulTickets, exportSuretyPremiums, exportCertifiedPayroll } from "./integrations/providers/qbo/sync";
import { parseEbsxJson, importBidPackage, exportEstimateAsEbsx } from "./integrations/providers/aashtoware";
import { importWageDetermination, listSuppressedFailureNotifications } from "./integrations/providers/dol_davis_bacon";
import { searchDirectory as searchDbeDirectory, refreshCertifications as refreshDbeCertifications, verifyCertification as verifyDbeCertification } from "./integrations/providers/dbe_directory";
import { verifyOrganizationBonds } from "./integrations/providers/surety_verification";
import { importProjects as stackctImportProjects, exportProjects as stackctExportProjects, importPlans as stackctImportPlans, exportPlans as stackctExportPlans, importEstimates as stackctImportEstimates, exportEstimates as stackctExportEstimates, acquireTokenWithCredentials as stackctAcquireToken } from "./integrations/providers/stackct";
import { z } from "zod";
import * as webhookService from "./integrations/webhookService";
import { generateWebhookSecret, deliverZapierWebhook } from "./integrations/providers/zapier";
import { MAX_SYNC_RETRIES, clearSyncRetryState } from "./integrations/syncRetry";

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

router.get("/connections", requireAuth, async (req, res, next) => {
  try {
    const orgId = (req as any).user.organizationId;
    const connections = await connectionService.listConnections(orgId);
    res.json(connectionService.sanitizeConnections(connections));
  } catch (err) {
    next(err);
  }
});

router.post("/connections", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/connections/:id/authorize", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const connection = await connectionService.getDecryptedConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    const provider = getProvider(connection.provider);
    if (!provider) return res.status(400).json({ error: "Provider not registered" });
    if (provider.authType !== "oauth") return res.status(400).json({ error: "Provider does not use OAuth authorization" });
    if (!["pending", "error"].includes(connection.status)) return res.status(400).json({ error: `Connection is already ${connection.status}` });
    const state = Buffer.from(JSON.stringify({ connectionId: connection.id, orgId: user.organizationId, redirectUri: `${getCanonicalBaseUrl(req)}/api/integrations/connections/${connection.id}/callback` })).toString("base64url");
    const redirectUri = `${getCanonicalBaseUrl(req)}/api/integrations/connections/${connection.id}/callback`;
    const authUrl = provider.getAuthUrl(connection.id, redirectUri, state);
    res.json({ authUrl });
  } catch (err) {
    next(err);
  }
});

router.get("/connections/:id/callback", async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: "Missing code or state" });
    const stateData = JSON.parse(Buffer.from(state as string, "base64url").toString());
    const { connectionId, orgId } = stateData;
    if (connectionId !== req.params.id) {
      logError("OAuth callback state mismatch", { expected: req.params.id, received: connectionId });
      return res.redirect("/settings/integrations?error=state_mismatch");
    }
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

router.post("/connections/:id/disconnect", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/connections/:id/test", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/import", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.get("/export", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.get("/audit", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const events = await outboxService.getOutboxEvents(user.organizationId, 200);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

router.get("/health", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const rows = await getConnectionHealth(user.organizationId);
    const summary = {
      total: rows.length,
      ok: rows.filter(r => r.severity === "ok").length,
      warning: rows.filter(r => r.severity === "warning").length,
      error: rows.filter(r => r.severity === "error").length,
    };
    res.json({ summary, connections: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/security-log", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const entries = getSecurityAuditLog(Math.min(limit, 200));
    res.json(entries);
  } catch (err) {
    next(err);
  }
});

type CloudProvider = "gdrive" | "dropbox" | "onedrive" | "box";

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

router.get("/cloud-browse", requireAuth, requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT", "ESTIMATOR", "SUPERINTENDENT"), async (req: AuthRequest, res, next) => {
  try {
    const { provider, folderId, query } = req.query as Record<string, string>;

    if (!provider || !["gdrive", "dropbox", "onedrive", "box"].includes(provider)) {
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

    if (cloudProvider === "onedrive") {
      let url: string;
      if (query) {
        const sanitizedQuery = query.replace(/'/g, "''").replace(/[\\%#&?]/g, "");
        const searchBase = folderId
          ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/search(q='${sanitizedQuery}')`
          : `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${sanitizedQuery}')`;
        url = `${searchBase}?$top=50&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference`;
      } else if (folderId) {
        url = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/children?$top=50&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference&$orderby=name`;
      } else {
        url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$top=50&$select=id,name,file,folder,size,lastModifiedDateTime,parentReference&$orderby=name`;
      }

      const onedriveRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!onedriveRes.ok) {
        const errText = await onedriveRes.text();
        logError("OneDrive list failed", { status: onedriveRes.status, body: errText });
        return res.status(502).json({ error: "Failed to list OneDrive files" });
      }

      const onedriveData = await onedriveRes.json() as { value?: Array<{ id: string; name: string; file?: { mimeType?: string }; folder?: object; size?: number; lastModifiedDateTime?: string }> };
      const files: CloudFileEntry[] = (onedriveData.value || []).map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.file?.mimeType || null,
        size: item.size ?? null,
        modifiedAt: item.lastModifiedDateTime ?? null,
        isFolder: !!item.folder,
      }));

      return res.json({ files });
    }

    if (cloudProvider === "box") {
      if (query) {
        const searchParams = new URLSearchParams({
          query,
          limit: "50",
          fields: "id,name,type,size,modified_at",
        });
        if (folderId) {
          searchParams.set("ancestor_folder_ids", folderId);
        }

        const searchRes = await fetch(
          `https://api.box.com/2.0/search?${searchParams.toString()}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!searchRes.ok) {
          const errText = await searchRes.text();
          logError("Box search failed", { status: searchRes.status, body: errText });
          return res.status(502).json({ error: "Failed to search Box files" });
        }

        const searchData = await searchRes.json() as { entries?: Array<{ id: string; name: string; type: string; size?: number; modified_at?: string }> };
        const files: CloudFileEntry[] = (searchData.entries || [])
          .filter((item) => item.type === "file" || item.type === "folder")
          .map((item) => ({
            id: item.id,
            name: item.name,
            mimeType: null,
            size: item.size ?? null,
            modifiedAt: item.modified_at ?? null,
            isFolder: item.type === "folder",
          }));

        return res.json({ files });
      } else {
        const boxFolderId = folderId || "0";
        const listRes = await fetch(
          `https://api.box.com/2.0/folders/${encodeURIComponent(boxFolderId)}/items?limit=100&fields=id,name,type,size,modified_at`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!listRes.ok) {
          const errText = await listRes.text();
          logError("Box list failed", { status: listRes.status, body: errText });
          return res.status(502).json({ error: "Failed to list Box files" });
        }

        const listData = await listRes.json() as { entries?: Array<{ id: string; name: string; type: string; size?: number; modified_at?: string }> };
        const files: CloudFileEntry[] = (listData.entries || [])
          .filter((item) => item.type === "file" || item.type === "folder")
          .map((item) => ({
            id: item.id,
            name: item.name,
            mimeType: null,
            size: item.size ?? null,
            modifiedAt: item.modified_at ?? null,
            isFolder: item.type === "folder",
          }));

        return res.json({ files });
      }
    }

    return res.status(400).json({ error: "Unsupported provider" });
  } catch (err) {
    next(err);
  }
});

// ========================================
// Routes from integrationSyncRoutes.ts
// ========================================

const syncSchema = z.object({
  operation: z.enum([
    // QBO core
    "chart_of_accounts", "customers", "invoices", "payment_status",
    "payroll", "subcontractor_payments", "purchase_orders", "reconcile_payments",
    // QBO heavy-civil
    "haul_tickets", "surety_premiums", "certified_payroll",
    // AASHTOWare ebsx
    "ebsx_import", "ebsx_export",
    // DOL Davis-Bacon
    "wage_determination",
    // DBE directory
    "dbe_lookup", "dbe_refresh", "dbe_verify",
    // Surety verification
    "surety_verify",
  ]),
  dryRun: z.boolean().optional().default(false),
  data: z.any().optional(),
});

const QBO_OPERATIONS = new Set([
  "chart_of_accounts", "customers", "invoices", "payment_status",
  "payroll", "subcontractor_payments", "purchase_orders", "reconcile_payments",
  "haul_tickets", "surety_premiums", "certified_payroll",
]);
const PROVIDER_OPERATIONS: Record<string, Set<string>> = {
  qbo: QBO_OPERATIONS,
  aashtoware: new Set(["ebsx_import", "ebsx_export"]),
  dol_davis_bacon: new Set(["wage_determination"]),
  dbe_directory: new Set(["dbe_lookup", "dbe_refresh", "dbe_verify"]),
  surety_verification: new Set(["surety_verify"]),
};

router.post("/connections/:id/sync", requireAuth, async (req, res, next) => {
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

    const allowed = PROVIDER_OPERATIONS[connection.provider as string];
    if (!allowed) {
      const hint = connection.provider === "stackct"
        ? " Use the STACK CT sync endpoint instead."
        : "";
      return res.status(400).json({ error: `Sync operations are not supported for provider '${connection.provider}'.${hint}` });
    }
    if (!allowed.has(operation)) {
      return res.status(400).json({ error: `Operation '${operation}' is not supported by provider '${connection.provider}'.` });
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
      case "haul_tickets":
        result = await exportHaulTickets(connection, { projectId: data?.projectId, dryRun });
        break;
      case "surety_premiums":
        result = await exportSuretyPremiums(connection, { dryRun });
        break;
      case "certified_payroll":
        if (!data?.payRunId) return res.status(400).json({ error: "Pay run ID required" });
        result = await exportCertifiedPayroll(connection, data.payRunId, { dryRun });
        break;
      case "ebsx_import":
        if (!data?.payload) return res.status(400).json({ error: "ebsx payload required" });
        result = await importBidPackage(connection, parseEbsxJson(data.payload), dryRun);
        break;
      case "ebsx_export":
        if (!data?.estimateId) return res.status(400).json({ error: "estimateId required" });
        result = await exportEstimateAsEbsx(connection, data.estimateId, dryRun);
        break;
      case "wage_determination":
        if (!data?.decisionNumber) return res.status(400).json({ error: "decisionNumber required" });
        result = await importWageDetermination(connection, data.decisionNumber, dryRun);
        break;
      case "dbe_lookup": {
        const entries = await searchDbeDirectory(connection, {
          name: data?.name,
          uei: data?.uei,
          duns: data?.duns,
          state: data?.state,
        });
        result = { success: true, entityType: "dbe_directory", direction: "import" as const, created: 0, updated: 0, skipped: 0, errors: [], data: entries };
        break;
      }
      case "dbe_refresh":
        result = await refreshDbeCertifications(connection, dryRun);
        break;
      case "dbe_verify": {
        if (!data?.certificationId) return res.status(400).json({ error: "certificationId required" });
        const v = await verifyDbeCertification(connection, data.certificationId);
        result = { success: !!v, entityType: "dbe_certification", direction: "import" as const, created: 0, updated: v?.verified ? 1 : 0, skipped: 0, errors: [], data: v };
        break;
      }
      case "surety_verify":
        result = await verifyOrganizationBonds(connection, { bondIds: data?.bondIds, dryRun });
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
    next(err);
  }
});

/**
 * Dev-only seed endpoint used by the e2e suite (Task #1384) to deterministically
 * stage `metadata.failureNotification` rows on a Davis-Bacon connection so
 * the integrations-page panel can be exercised without having to drive an
 * actual SAM.gov failure streak. Gated by `NODE_ENV === "development"`.
 */
router.post(
  "/dev/davis-bacon/seed-suppressed-failure",
  (req, res, next) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  },
  requireAuth,
  async (req, res, next) => {
    try {
      const user = (req as any).user;
      const { connectionId, decisionNumber, suppressedCount, suppressedSince, lastNotifiedAt, clear } = req.body || {};
      if (!connectionId || typeof decisionNumber !== "string") {
        return res.status(400).json({ error: "connectionId and decisionNumber are required" });
      }
      const connection = await connectionService.getConnection(connectionId, user.organizationId);
      if (!connection) return res.status(404).json({ error: "Connection not found" });
      const entityType = `wage_determination:${decisionNumber}`;
      const [existing] = await db
        .select()
        .from(integrationSyncState)
        .where(and(
          eq(integrationSyncState.connectionId, connectionId),
          eq(integrationSyncState.entityType, entityType),
        ))
        .limit(1);
      const baseMeta: Record<string, unknown> =
        existing?.metadata && typeof existing.metadata === "object"
          ? { ...(existing.metadata as Record<string, unknown>) }
          : {};
      if (clear) {
        delete baseMeta.failureNotification;
      } else {
        baseMeta.failureNotification = {
          lastNotifiedAt: typeof lastNotifiedAt === "number" ? lastNotifiedAt : Date.now(),
          suppressedSince: typeof suppressedSince === "number" ? suppressedSince : Date.now(),
          suppressedCount: typeof suppressedCount === "number" ? suppressedCount : 1,
        };
      }
      if (existing) {
        await db.update(integrationSyncState)
          .set({ metadata: baseMeta as any, updatedAt: new Date() })
          .where(eq(integrationSyncState.id, existing.id));
      } else {
        await db.insert(integrationSyncState).values({
          organizationId: user.organizationId,
          connectionId,
          entityType,
          metadata: baseMeta as any,
          lastAttemptAt: new Date(),
        });
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Task #1384 — Real-time visibility into how many Davis-Bacon auto-sync
 * failure alerts the coalescing window is currently absorbing for each
 * (connection, decision). Powers the "X alerts suppressed since…" badge
 * on the integrations UI so admins managing an active SAM.gov outage
 * don't have to wait for the next email to know the upstream is noisy.
 */
router.get("/davis-bacon/suppressed-failures", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const items = await listSuppressedFailureNotifications(user.organizationId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get("/connections/:id/sync-history", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

// Task #1378 — list pending/exhausted sync retries across all integrations
// for the calling user's org so the integrations page can surface them.
router.get("/sync-retries", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const rows = await db
      .select({
        id: integrationSyncState.id,
        connectionId: integrationSyncState.connectionId,
        entityType: integrationSyncState.entityType,
        lastError: integrationSyncState.lastError,
        lastAttemptAt: integrationSyncState.lastAttemptAt,
        retryCount: integrationSyncState.retryCount,
        nextRetryAt: integrationSyncState.nextRetryAt,
        provider: integrationConnections.provider,
        connectionDisplayName: integrationConnections.displayName,
        connectionStatus: integrationConnections.status,
      })
      .from(integrationSyncState)
      .innerJoin(integrationConnections, eq(integrationConnections.id, integrationSyncState.connectionId))
      .where(and(
        eq(integrationSyncState.organizationId, user.organizationId),
        isNotNull(integrationSyncState.lastError),
      ))
      .orderBy(desc(integrationSyncState.lastAttemptAt));

    // Task #1404 — surface the active mute state alongside each row so
    // the panel can show what's silenced (and expose an unmute action).
    const muteRows = await db
      .select()
      .from(integrationSyncAlertMutes)
      .where(eq(integrationSyncAlertMutes.organizationId, user.organizationId));

    const connectionWideMutes = new Set<string>();
    const entityMutes = new Map<string, string>(); // `${connectionId}::${entityType}` -> mute id
    for (const m of muteRows) {
      if (m.entityType === null) {
        connectionWideMutes.add(m.connectionId);
      } else {
        entityMutes.set(`${m.connectionId}::${m.entityType}`, m.id);
      }
    }

    const retries = rows
      .filter(r => r.retryCount > 0 || r.nextRetryAt !== null)
      .map(r => {
        const connectionMuted = connectionWideMutes.has(r.connectionId);
        const entityMuteId = entityMutes.get(`${r.connectionId}::${r.entityType}`) ?? null;
        return {
          id: r.id,
          connectionId: r.connectionId,
          provider: r.provider,
          connectionDisplayName: r.connectionDisplayName,
          connectionStatus: r.connectionStatus,
          entityType: r.entityType,
          lastError: r.lastError,
          lastAttemptAt: r.lastAttemptAt,
          retryCount: r.retryCount,
          nextRetryAt: r.nextRetryAt,
          maxRetries: MAX_SYNC_RETRIES,
          exhausted: r.retryCount >= MAX_SYNC_RETRIES,
          muted: connectionMuted || entityMuteId !== null,
          muteScope: connectionMuted ? "connection" : entityMuteId ? "entity" : null,
        };
      });

    const mutes = muteRows.map((m) => ({
      id: m.id,
      connectionId: m.connectionId,
      entityType: m.entityType,
      mutedByUserId: m.mutedByUserId,
      reason: m.reason,
      createdAt: m.createdAt,
    }));

    res.json({ retries, maxRetries: MAX_SYNC_RETRIES, mutes });
  } catch (err) {
    next(err);
  }
});

router.post("/sync-retries/:id/retry-now", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const [row] = await db
      .select()
      .from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.id, req.params.id),
        eq(integrationSyncState.organizationId, user.organizationId),
      ))
      .limit(1);

    if (!row) return res.status(404).json({ error: "Sync retry not found" });

    // For exhausted rows the sweep skips entirely (retryCount >= MAX_SYNC_RETRIES),
    // so re-arm the schedule from scratch. Either way, set nextRetryAt to a past
    // timestamp so the next sweep tick picks it up immediately.
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);

    if (row.retryCount >= MAX_SYNC_RETRIES) {
      await clearSyncRetryState(
        { id: row.connectionId, organizationId: row.organizationId },
        row.entityType,
      );
    }

    await db
      .update(integrationSyncState)
      .set({ nextRetryAt: past, updatedAt: now })
      .where(eq(integrationSyncState.id, row.id));

    logIntegrationAudit("sync_retry.manual_retry", {
      orgId: user.organizationId,
      userId: user.id,
      syncStateId: row.id,
      connectionId: row.connectionId,
      entityType: row.entityType,
      previousRetryCount: row.retryCount,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Task #1404 — Admin mute affordances for the INTEGRATION_SYNC_RETRIES_EXHAUSTED
// fan-out. A chronically broken integration (revoked credentials, vendor
// outage, etc.) can produce one fresh admin page per distinct entity —
// and every manual retry re-arms the marker so the next exhaustion
// re-fires. These endpoints let org admins silence the alert while they
// investigate, with two scopes:
//   * connection-wide (entityType omitted) — quiet every entity on the
//     connection.
//   * entity-scoped — quiet only the specific failing entity.
// The mute is shared across the org (not per-recipient like the
// Davis-Bacon mute) so one admin clicking "mute" stops paging everyone.
const muteBodySchema = z.object({
  connectionId: z.string().min(1),
  entityType: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

async function ensureConnectionBelongsToOrg(
  connectionId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.id, connectionId),
      eq(integrationConnections.organizationId, organizationId),
    ))
    .limit(1);
  return !!row;
}

async function upsertSyncAlertMute(args: {
  organizationId: string;
  connectionId: string;
  entityType: string | null;
  mutedByUserId: string | null;
  reason?: string | null;
}): Promise<{ created: boolean; id: string }> {
  // Can't rely on drizzle onConflict because the unique index is a
  // COALESCE expression; fall back to "check-then-insert".
  const existingWhere = and(
    eq(integrationSyncAlertMutes.connectionId, args.connectionId),
    args.entityType === null
      ? isNull(integrationSyncAlertMutes.entityType)
      : eq(integrationSyncAlertMutes.entityType, args.entityType),
  );
  const [existing] = await db
    .select({ id: integrationSyncAlertMutes.id })
    .from(integrationSyncAlertMutes)
    .where(existingWhere)
    .limit(1);
  if (existing) {
    await db
      .update(integrationSyncAlertMutes)
      .set({
        mutedByUserId: args.mutedByUserId,
        reason: args.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(integrationSyncAlertMutes.id, existing.id));
    return { created: false, id: existing.id };
  }
  const [ins] = await db
    .insert(integrationSyncAlertMutes)
    .values({
      organizationId: args.organizationId,
      connectionId: args.connectionId,
      entityType: args.entityType,
      mutedByUserId: args.mutedByUserId,
      reason: args.reason ?? null,
    })
    .returning({ id: integrationSyncAlertMutes.id });
  return { created: true, id: ins.id };
}

router.post("/sync-retries/mute", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Only admins can mute integration sync alerts" });
    }
    const parsed = muteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mute request", details: parsed.error.flatten() });
    }
    if (!(await ensureConnectionBelongsToOrg(parsed.data.connectionId, user.organizationId))) {
      return res.status(404).json({ error: "Connection not found" });
    }
    const result = await upsertSyncAlertMute({
      organizationId: user.organizationId,
      connectionId: parsed.data.connectionId,
      entityType: parsed.data.entityType ?? null,
      mutedByUserId: user.id,
      reason: parsed.data.reason ?? null,
    });
    logIntegrationAudit("sync_retry.mute_created", {
      orgId: user.organizationId,
      userId: user.id,
      connectionId: parsed.data.connectionId,
      entityType: parsed.data.entityType ?? null,
      replaced: !result.created,
    });
    res.json({ success: true, muteId: result.id, created: result.created });
  } catch (err) {
    next(err);
  }
});

router.delete("/sync-retries/mute/:id", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Only admins can unmute integration sync alerts" });
    }
    const [row] = await db
      .select()
      .from(integrationSyncAlertMutes)
      .where(and(
        eq(integrationSyncAlertMutes.id, req.params.id),
        eq(integrationSyncAlertMutes.organizationId, user.organizationId),
      ))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Mute not found" });

    await db
      .delete(integrationSyncAlertMutes)
      .where(eq(integrationSyncAlertMutes.id, row.id));

    logIntegrationAudit("sync_retry.mute_deleted", {
      orgId: user.organizationId,
      userId: user.id,
      connectionId: row.connectionId,
      entityType: row.entityType,
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #1404 — One-click "mute alerts for this integration" link
 * rendered in INTEGRATION_SYNC_RETRIES_EXHAUSTED emails. The signed
 * token binds recipient userId + connectionId + (optional) entityType
 * so a forwarded email can't mute arbitrary connections; we additionally
 * re-check the recipient's admin role + org membership before inserting
 * a mute row (the mute affects the whole org).
 */
router.get("/mute-sync-alerts", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const payload = token ? verifyIntegrationSyncMuteToken(token) : null;
    const anchor = "#section-sync-retries";

    if (!payload) {
      return res.redirect(`/integrations?mute=invalid${anchor}`);
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        organizationId: usersTable.organizationId,
        role: usersTable.role,
        isActive: usersTable.isActive,
      })
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId))
      .limit(1);

    if (!user || !user.isActive || !user.organizationId) {
      return res.redirect(`/integrations?mute=invalid${anchor}`);
    }
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.redirect(`/integrations?mute=forbidden${anchor}`);
    }

    // Connection must still belong to the recipient's org.
    if (!(await ensureConnectionBelongsToOrg(payload.connectionId, user.organizationId))) {
      return res.redirect(`/integrations?mute=invalid${anchor}`);
    }

    await upsertSyncAlertMute({
      organizationId: user.organizationId,
      connectionId: payload.connectionId,
      entityType: payload.entityType,
      mutedByUserId: user.id,
      reason: "Muted via email one-click",
    });

    logIntegrationAudit("sync_retry.mute_created_via_email", {
      orgId: user.organizationId,
      userId: user.id,
      connectionId: payload.connectionId,
      entityType: payload.entityType,
    });

    logInfo("Integration sync alerts muted via email link", {
      userId: user.id,
      connectionId: payload.connectionId,
      entityType: payload.entityType,
    });

    const scope = payload.entityType ? "entity" : "connection";
    return res.redirect(
      `/integrations?muted=sync_retry_exhausted&scope=${scope}&connection=${encodeURIComponent(payload.connectionId)}${anchor}`,
    );
  } catch (err) {
    logError("Failed to mute integration sync alerts via email link", { error: String(err) });
    next(err);
  }
});

router.get("/connections/:id/account-mappings", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/connections/:id/account-mappings", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.delete("/connections/:id/account-mappings/:mappingId", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/connections/:id/account-mappings/auto-map", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.get("/connections/:id/schedules", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/connections/:id/schedules", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.delete("/connections/:id/schedules/:scheduleId", requireAuth, async (req, res, next) => {
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
    next(err);
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

router.get("/events", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const events = await outboxService.getOutboxEvents(user.organizationId, 100);
    res.json(events);
  } catch (err) {
    next(err);
  }
});

router.post("/webhooks/subscribe", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/webhooks/test", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (user.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Super admin access required" });
    const { targetUrl } = req.body;
    if (!targetUrl) return res.status(400).json({ error: "targetUrl required" });
    const result = await webhookService.deliverWebhook(targetUrl, { test: true, timestamp: new Date().toISOString() }, "test-secret");
    res.json({ delivered: result.ok, status: result.status });
  } catch (err) {
    next(err);
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

router.get("/zapier/webhooks", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/zapier/webhooks", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.patch("/zapier/webhooks/:webhookId", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.delete("/zapier/webhooks/:webhookId", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.post("/zapier/webhooks/:webhookId/test", requireAuth, async (req, res, next) => {
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
    next(err);
  }
});

router.get("/zapier/event-types", requireAuth, (_req, res) => {
  res.json(ZAPIER_EVENT_TYPES);
});

router.post("/zapier/incoming/:secretKey", async (req, res, next) => {
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
    next(err);
  }
});

// ========================================
// STACK CT Credential Authorization
// ========================================

const stackctCredentialSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client Secret is required"),
});

router.post("/connections/:id/stackct-authorize", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "stackct") {
      return res.status(400).json({ error: "This endpoint is for STACK CT connections only" });
    }

    const parsed = stackctCredentialSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid credentials", details: parsed.error.flatten() });
    }

    const { clientId, clientSecret } = parsed.data;

    const tokens = await stackctAcquireToken(clientId, clientSecret);

    const enrichedTokens = {
      ...tokens,
      raw: {
        ...tokens.raw,
        clientId,
        clientSecret,
      },
    };

    await connectionService.storeConnectionTokens(connection.id, user.organizationId, enrichedTokens);

    logIntegrationAudit("connection.authorized", {
      orgId: user.organizationId,
      connectionId: connection.id,
      provider: "stackct",
      userId: user.id,
    });

    const updated = await connectionService.getConnection(connection.id, user.organizationId);
    res.json(connectionService.sanitizeConnection(updated));
  } catch (err) {
    logError("STACK CT authorization failed", { error: String(err) });
    logIntegrationAudit("security.auth_attempt_failed", {
      orgId: (req as any).user.organizationId,
      connectionId: req.params.id,
      provider: "stackct",
      error: String(err),
    });
    res.status(400).json({ error: "Failed to authorize with STACK CT. Please check your credentials." });
  }
});

// ========================================
// STACK CT Sync Routes
// ========================================

const stackctSyncSchema = z.object({
  operation: z.enum(["import_projects", "export_projects", "import_plans", "export_plans", "import_estimates", "export_estimates"]),
  dryRun: z.boolean().optional().default(false),
  stackctProjectId: z.string().optional(),
  localProjectId: z.string().optional(),
});

router.post("/connections/:id/stackct-sync", requireAuth, async (req, res, next) => {
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
    if (connection.provider !== "stackct") {
      return res.status(400).json({ error: "This endpoint is for STACK CT connections only" });
    }

    const parsed = stackctSyncSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { operation, dryRun, stackctProjectId, localProjectId } = parsed.data;

    if (localProjectId) {
      const [project] = await db.select({ id: projects.id }).from(projects)
        .where(and(eq(projects.id, localProjectId), eq(projects.gcOrganizationId, user.organizationId)));
      if (!project) {
        return res.status(403).json({ error: "Project does not belong to your organization" });
      }
    }

    const metadata = (connection.metadata as Record<string, any>) || {};
    if (metadata.expiresAt && new Date(metadata.expiresAt) < new Date()) {
      const provider = getProvider(connection.provider);
      if (provider) {
        try {
          const newTokens = await provider.refreshToken(connection);
          await connectionService.storeConnectionTokens(connection.id, user.organizationId, newTokens);
          connection = (await connectionService.getDecryptedConnection(connection.id, user.organizationId))!;
          logIntegrationAudit("security.token_refresh_success", { orgId: user.organizationId, connectionId: connection.id, provider: connection.provider, userId: user.id });
        } catch (refreshErr) {
          logIntegrationAudit("security.token_refresh_failed", { orgId: user.organizationId, connectionId: connection.id, provider: connection.provider, userId: user.id, error: String(refreshErr) });
          return res.status(401).json({ error: "Token expired and refresh failed. Please reconnect." });
        }
      }
    }

    let result;
    const startTime = Date.now();

    switch (operation) {
      case "import_projects":
        result = await stackctImportProjects(connection, dryRun);
        break;
      case "export_projects":
        result = await stackctExportProjects(connection, dryRun);
        break;
      case "import_plans":
        if (!stackctProjectId || !localProjectId) {
          return res.status(400).json({ error: "stackctProjectId and localProjectId are required for plan sync" });
        }
        result = await stackctImportPlans(connection, stackctProjectId, localProjectId, dryRun);
        break;
      case "export_plans":
        if (!stackctProjectId || !localProjectId) {
          return res.status(400).json({ error: "stackctProjectId and localProjectId are required for plan sync" });
        }
        result = await stackctExportPlans(connection, stackctProjectId, localProjectId, dryRun);
        break;
      case "import_estimates":
        if (!stackctProjectId || !localProjectId) {
          return res.status(400).json({ error: "stackctProjectId and localProjectId are required for estimate sync" });
        }
        result = await stackctImportEstimates(connection, stackctProjectId, localProjectId, dryRun);
        break;
      case "export_estimates":
        if (!stackctProjectId || !localProjectId) {
          return res.status(400).json({ error: "stackctProjectId and localProjectId are required for estimate sync" });
        }
        result = await stackctExportEstimates(connection, stackctProjectId, localProjectId, dryRun);
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
        eq(integrationSyncState.entityType, `stackct_sync_log_${operation}`)
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
        entityType: `stackct_sync_log_${operation}`,
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
      provider: "stackct",
      userId: user.id,
      meta: { result, duration },
    });

    logInfo("STACK CT sync operation completed", { operation, dryRun, duration, success: result?.success });
    res.json({ ...result, dryRun, duration });
  } catch (err) {
    next(err);
  }
});

router.get("/connections/:id/stackct-sync-history", requireAuth, async (req, res, next) => {
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
      .filter(s => s.entityType.startsWith("stackct_sync_log_"))
      .map(s => {
        const meta = s.metadata as any;
        return {
          operation: s.entityType.replace("stackct_sync_log_", ""),
          lastSyncAt: s.lastSyncAt,
          latestResult: meta?.latestResult || null,
          logs: (meta?.logs || []).slice(0, 20),
        };
      });

    const projectMappingRecords = syncStates
      .filter(s => s.entityType.startsWith("stackct_project_") || s.entityType.startsWith("stackct_export_project_"));

    const projectMappings: { localProjectId: string; stackctProjectId: string; projectName: string }[] = [];
    const seenKeys = new Set<string>();

    for (const s of projectMappingRecords) {
      const meta = s.metadata as any;
      const localProjectId = meta?.localProjectId;
      const stackctProjectId = meta?.stackctProjectId;
      if (!localProjectId || !stackctProjectId) continue;
      const key = `${localProjectId}::${stackctProjectId}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      projectMappings.push({
        localProjectId,
        stackctProjectId,
        projectName: meta?.name || meta?.projectName || `Project ${localProjectId.substring(0, 8)}`,
      });
    }

    res.json({
      history,
      projectMappings,
      connectionId: connection.id,
      provider: connection.provider,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
