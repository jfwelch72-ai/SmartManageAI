import { Router } from "express";
import { requireAuth, requireRole } from "./auth";
import { getAllProviders, getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import * as importExportService from "./integrations/importExportService";
import { logIntegrationAudit, getSecurityAuditLog, recordSuppressionReset, listSuppressionResets } from "./integrations/audit";
import { getConnectionHealth } from "./integrations/healthService";
import * as outboxService from "./integrations/outboxService";
import { logInfo, logError } from "./utils/logger";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";
import { eq, and, desc, isNotNull, isNull, inArray, sql } from "drizzle-orm";
import { integrationConnections, type IntegrationConnection, integrationSyncState, integrationSyncAlertMutes, qboAccountMappings, qboSyncSchedules, sageAccountMappings, zapierWebhooks, ZAPIER_EVENT_TYPES, projects, users as usersTable, payApplications, sovLineItems, scheduleOfValues, crmOrganisations, payRuns } from "@shared/schema";
import { verifyIntegrationSyncMuteToken } from "./utils/integrationSyncMuteToken";
import { db } from "./db";
import { decryptMetadata, encryptMetadata } from "./integrations/encryption";
import type { AuthRequest } from "./auth";
import { importChartOfAccounts, exportCustomers, exportInvoice, importPaymentStatus, exportPayroll, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "./integrations/providers/qbo";
import {
  exportHaulTickets,
  exportSuretyPremiums,
  exportCertifiedPayroll,
  qboInvoiceSyncEntityType,
  qboCustomerSyncEntityType,
  qboPayrollSyncEntityType,
  qboCertifiedPayrollSyncEntityType,
  QBO_SYNC_ENTITY_TYPE_PREFIX,
} from "./integrations/providers/qbo/sync";
import {
  importChartOfAccounts as sageImportChartOfAccounts,
  exportCustomers as sageExportCustomers,
  exportInvoice as sageExportInvoice,
  importPaymentStatus as sageImportPaymentStatus,
  getTrackedSageInvoiceRecordIds,
} from "./integrations/providers/sage";
import { getIdMapping } from "./integrations/idMapping";
import { sageRequest, resolveSageCredentials } from "./integrations/providers/sage/xmlGateway";
import { recordSyncFailure, recordSyncSuccess } from "./integrations/syncRetry";
import { parseEbsxJson, importBidPackage, exportEstimateAsEbsx } from "./integrations/providers/aashtoware";
import { importWageDetermination, listSuppressedFailureNotifications, resetSuppressedFailureNotification, resetAllSuppressedFailureNotifications } from "./integrations/providers/dol_davis_bacon";
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

// Task #1377 — typed payload for QBO invoice push so the route validates
// callers up front (no `as any` into exportInvoice) and so every failed
// invoice push has a stable identity (`localInvoiceId`) the auto-retry
// sweep can key off of when persisting/replaying the payload.
const qboInvoicePayloadSchema = z.object({
  localInvoiceId: z.string().min(1, "localInvoiceId is required for retryable invoice pushes"),
  customerRef: z.string().min(1),
  lineItems: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    accountRef: z.string().optional(),
  })).min(1),
  dueDate: z.string().optional(),
  docNumber: z.string().optional(),
});

// Task #1377 — typed payload for QBO customer push. The local id is
// required so the per-customer retry row has a stable identity.
const qboCustomerPayloadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
});

const syncSchema = z.object({
  operation: z.enum([
    // QBO core
    "chart_of_accounts", "customers", "invoices", "payment_status",
    "payroll", "subcontractor_payments", "purchase_orders", "reconcile_payments",
    // QBO heavy-civil
    "haul_tickets", "surety_premiums", "certified_payroll",
    // Sage Intacct
    "sage_chart_of_accounts", "sage_customers", "sage_invoice", "sage_payment_status",
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
  sage_intacct: new Set([
    "sage_chart_of_accounts",
    "sage_customers",
    "sage_invoice",
    "sage_payment_status",
  ]),
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

    if (connection.provider === "sage_intacct") {
      if (process.env.INTEGRATION_SAGE !== "true") {
        return res.status(403).json({
          error: "Sage Intacct sync is disabled. Enable INTEGRATION_SAGE to use this integration.",
        });
      }
      // Sage operations are ADMIN-only even via the unified dispatcher,
      // matching the named /sage/* routes.
      if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
        return res.status(403).json({
          error: "Sage Intacct operations require SUPER_ADMIN or ADMIN role.",
        });
      }
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
      case "customers": {
        const customersParsed = z.array(qboCustomerPayloadSchema).safeParse(data?.customers ?? []);
        if (!customersParsed.success) {
          return res.status(400).json({ error: "Invalid customer payload", details: customersParsed.error.flatten() });
        }
        const customersInput = customersParsed.data;
        result = await exportCustomers(connection, customersInput, dryRun);
        // Task #1377: per-customer auto-retry bookkeeping. Persist the
        // payload on the failure row so the sweep can replay each customer
        // push individually; clear it on success so the row resolves.
        if (!dryRun) {
          const failedIds = new Set((result.errors ?? []).map((e) => e.entityId).filter(Boolean) as string[]);
          for (const cust of customersInput) {
            if (!cust?.id) continue;
            const ent = qboCustomerSyncEntityType(cust.id);
            try {
              if (failedIds.has(cust.id)) {
                const errMsg = (result.errors ?? []).find((e) => e.entityId === cust.id)?.message || "QBO customer push failed";
                await recordSyncFailure(connection, ent, errMsg, { metadata: { payload: cust } });
              } else {
                await recordSyncSuccess(connection, ent, { metadata: null });
              }
            } catch (err) {
              logError("Failed to persist QBO customer retry state", { connectionId: connection.id, customerId: cust.id, error: String(err) });
            }
          }
        }
        break;
      }
      case "invoices": {
        const invoiceParsed = qboInvoicePayloadSchema.safeParse(data?.invoice);
        if (!invoiceParsed.success) {
          return res.status(400).json({ error: "Invoice data required", details: invoiceParsed.error.flatten() });
        }
        const invoicePayload = invoiceParsed.data;
        result = await exportInvoice(connection, invoicePayload, dryRun);
        // Task #1377: persist invoice payload on failure so the sweep can
        // replay it. The schema requires localInvoiceId so every failed
        // invoice push is auto-retryable end-to-end.
        if (!dryRun) {
          const ent = qboInvoiceSyncEntityType(invoicePayload.localInvoiceId);
          try {
            if (result.success) {
              await recordSyncSuccess(connection, ent, { metadata: null });
            } else {
              const errMsg = (result.errors ?? []).map((e) => e.message).join("; ") || "QBO invoice push failed";
              await recordSyncFailure(connection, ent, errMsg, { metadata: { payload: invoicePayload } });
            }
          } catch (err) {
            logError("Failed to persist QBO invoice retry state", { connectionId: connection.id, localInvoiceId: invoicePayload.localInvoiceId, error: String(err) });
          }
        }
        break;
      }
      case "payment_status":
        if (!data?.invoiceIds?.length) return res.status(400).json({ error: "Invoice IDs required" });
        result = await importPaymentStatus(connection, data.invoiceIds);
        break;
      case "payroll": {
        if (!data?.payRunId) return res.status(400).json({ error: "Pay run ID required" });
        const payRunId = data.payRunId as string;
        result = await exportPayroll(connection, payRunId, dryRun);
        // Task #1377: per-pay-run auto-retry bookkeeping. The payRunId is
        // sufficient payload because exportPayroll re-queries the DB on
        // every call, so we don't need to persist a separate payload blob.
        if (!dryRun) {
          const ent = qboPayrollSyncEntityType(payRunId);
          try {
            if (result.success) {
              await recordSyncSuccess(connection, ent, { metadata: null });
            } else {
              const errMsg = (result.errors ?? []).map((e) => e.message).join("; ") || "QBO pay run push failed";
              await recordSyncFailure(connection, ent, errMsg, { metadata: { payload: { payRunId } } });
            }
          } catch (err) {
            logError("Failed to persist QBO payroll retry state", { connectionId: connection.id, payRunId, error: String(err) });
          }
        }
        break;
      }
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
      case "certified_payroll": {
        if (!data?.payRunId) return res.status(400).json({ error: "Pay run ID required" });
        const payRunId = data.payRunId as string;
        result = await exportCertifiedPayroll(connection, payRunId, { dryRun });
        // Task #1377: per-pay-run auto-retry bookkeeping for the
        // certified-payroll variant. Idempotency on the export side is
        // shared with `exportPayroll` via the `exported_payroll` bucket.
        if (!dryRun) {
          const ent = qboCertifiedPayrollSyncEntityType(payRunId);
          try {
            if (result.success) {
              await recordSyncSuccess(connection, ent, { metadata: null });
            } else {
              const errMsg = (result.errors ?? []).map((e) => e.message).join("; ") || "QBO certified payroll push failed";
              await recordSyncFailure(connection, ent, errMsg, { metadata: { payload: { payRunId } } });
            }
          } catch (err) {
            logError("Failed to persist QBO certified payroll retry state", { connectionId: connection.id, payRunId, error: String(err) });
          }
        }
        break;
      }
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
      case "sage_chart_of_accounts":
        result = await sageImportChartOfAccounts(connection, dryRun);
        break;
      case "sage_customers":
        result = await sageExportCustomers(connection, data?.customers || [], dryRun);
        break;
      case "sage_invoice":
        if (!data?.invoice) return res.status(400).json({ error: "Invoice data required" });
        result = await sageExportInvoice(connection, data.invoice, dryRun);
        break;
      case "sage_payment_status": {
        let pmtIds: string[] = Array.isArray(data?.invoiceIds) ? data.invoiceIds : [];
        if (pmtIds.length === 0) {
          pmtIds = (await getTrackedSageInvoiceRecordIds(connection.id)).slice(0, 200);
        }
        result = await sageImportPaymentStatus(connection, pmtIds);
        break;
      }
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

/**
 * Task #1403 — Force-clear the coalescing window for a specific
 * (connection, decision) so the next failure is delivered immediately
 * instead of being absorbed for the remainder of the 1h window. Wipes
 * `metadata.failureNotification` on the matching `integration_sync_state`
 * row and the in-memory `failureCoalesceMap` entry. Limited to admins
 * (SUPER_ADMIN/ADMIN) so a casual MANAGER read of the panel can't
 * accidentally trigger fresh email blasts during an active outage.
 */
router.post("/davis-bacon/suppressed-failures/reset", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const schema = z.object({
      connectionId: z.string().min(1),
      decisionNumber: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const { connectionId, decisionNumber } = parsed.data;

    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection || connection.provider !== "dol_davis_bacon") {
      return res.status(404).json({ error: "Connection not found" });
    }

    const cleared = await resetSuppressedFailureNotification(
      connection as any,
      decisionNumber,
    );

    logIntegrationAudit("davis_bacon.suppression_reset", {
      orgId: user.organizationId,
      userId: user.id,
      connectionId,
      decisionNumber,
      cleared,
    });

    // Task #1442 — also push into the per-org reset history buffer so
    // the integrations panel can show "Last reset by X at Y" on each
    // suppressed-failure row, preventing two admins from racing each
    // other on the same row during an outage.
    await recordSuppressionReset({
      orgId: user.organizationId,
      userId: user.id,
      connectionId,
      decisionNumber,
      cleared,
    });

    res.json({ success: true, cleared });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #1443 — Bulk reset of every suppression row for a Davis-Bacon
 * connection. Clears `metadata.failureNotification` on every wage-decision
 * row in a single transaction and emits one combined audit entry naming
 * each cleared decision so the security log doesn't get spammed with
 * dozens of per-row entries during an outage cleanup.
 */
router.post("/davis-bacon/suppressed-failures/reset-all", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    const schema = z.object({ connectionId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const { connectionId } = parsed.data;

    const connection = await connectionService.getConnection(connectionId, user.organizationId);
    if (!connection || connection.provider !== "dol_davis_bacon") {
      return res.status(404).json({ error: "Connection not found" });
    }

    const { cleared, decisionNumbers } = await resetAllSuppressedFailureNotifications(
      connection,
    );

    logIntegrationAudit("davis_bacon.suppression_reset_all", {
      orgId: user.organizationId,
      userId: user.id,
      connectionId,
      cleared,
      decisionNumbers,
    });

    // Task #1442 — also push every cleared decision into the per-org
    // reset history buffer so the "Last reset by X" line on the panel
    // reflects bulk resets too, not just per-row clicks.
    for (const decisionNumber of decisionNumbers) {
      await recordSuppressionReset({
        orgId: user.organizationId,
        userId: user.id,
        connectionId,
        decisionNumber,
        cleared: true,
      });
    }

    res.json({ success: true, cleared, decisionNumbers });
  } catch (err) {
    next(err);
  }
});

/**
 * Task #1442 — Recent `davis_bacon.suppression_reset` history scoped
 * to the caller's org. The integrations UI uses this to surface
 * "Last reset by X at Y" on each suppressed-failure row so two admins
 * managing an outage don't race each other on the same (connection,
 * decision). Includes both successful and no-op (`cleared=false`)
 * resets — the no-op case is still useful evidence that a teammate
 * just clicked the button.
 */
router.get("/davis-bacon/suppression-resets", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    // Clamp `limit` to a sane positive range so a negative/NaN query
    // value can't surprise the buffer accessor or return an oddly
    // sized payload.
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 200)
        : 100;
    const entries = await listSuppressionResets(user.organizationId, limit);

    const userIds = Array.from(
      new Set(entries.map((e) => e.userId).filter((u): u is string => !!u)),
    );
    const nameById: Record<string, string> = {};
    if (userIds.length > 0) {
      const rows = await db
        .select({
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(usersTable)
        .where(
          and(
            inArray(usersTable.id, userIds),
            // Defence in depth: only resolve names within the caller's
            // org even though the buffer entries are already org-scoped.
            eq(usersTable.organizationId, user.organizationId),
          ),
        );
      for (const r of rows) {
        const name = `${r.firstName} ${r.lastName}`.trim();
        nameById[r.id] = name || r.id;
      }
    }

    const items = entries.map((e) => ({
      connectionId: e.connectionId,
      decisionNumber: e.decisionNumber,
      cleared: e.cleared,
      userId: e.userId ?? null,
      userName: e.userId ? nameById[e.userId] ?? null : null,
      timestamp: e.timestamp,
    }));

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

// Task #1394 — per-connection QBO sync retry feed. The global
// `/sync-retries` endpoint surfaces every failing row across providers,
// but admins on the QuickBooks integration page need a focused view of
// the QBO-specific failures grouped by kind (customer / invoice /
// pay-run / scheduled op) so they can spot what needs attention without
// scanning unrelated providers. Returns rows from `integration_sync_state`
// whose entity_type starts with `qbo_sync:` for the supplied connection,
// pre-bucketed by kind and decorated with retry count, last error, next
// attempt time, and exhausted flag (for the "Retry now" affordance which
// rides on the existing /sync-retries/:id/retry-now endpoint).
router.get("/connections/:id/qbo-sync-retries", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "qbo") {
      return res.status(400).json({ error: "Connection is not a QuickBooks integration" });
    }

    const rows = await db
      .select({
        id: integrationSyncState.id,
        entityType: integrationSyncState.entityType,
        lastError: integrationSyncState.lastError,
        lastAttemptAt: integrationSyncState.lastAttemptAt,
        retryCount: integrationSyncState.retryCount,
        nextRetryAt: integrationSyncState.nextRetryAt,
      })
      .from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.organizationId, user.organizationId),
        eq(integrationSyncState.connectionId, connection.id),
        sql`${integrationSyncState.entityType} LIKE ${QBO_SYNC_ENTITY_TYPE_PREFIX + "%"}`,
        isNotNull(integrationSyncState.lastError),
      ))
      .orderBy(desc(integrationSyncState.lastAttemptAt));

    type Kind = "customer" | "invoice" | "pay_run" | "scheduled_op";
    type SubKind = "customer" | "invoice" | "payroll" | "certified_payroll" | null;
    const classify = (entityType: string): { kind: Kind; subKind: SubKind; label: string; itemId: string | null } => {
      const operation = entityType.slice(QBO_SYNC_ENTITY_TYPE_PREFIX.length);
      const colonIdx = operation.indexOf(":");
      if (colonIdx > 0) {
        const subKind = operation.slice(0, colonIdx);
        const itemId = operation.slice(colonIdx + 1);
        if (subKind === "customer") {
          return { kind: "customer", subKind: "customer", label: `Customer ${itemId}`, itemId };
        }
        if (subKind === "invoice") {
          return { kind: "invoice", subKind: "invoice", label: `Invoice ${itemId}`, itemId };
        }
        if (subKind === "payroll") {
          return { kind: "pay_run", subKind: "payroll", label: `Payroll run ${itemId}`, itemId };
        }
        if (subKind === "certified_payroll") {
          return { kind: "pay_run", subKind: "certified_payroll", label: `Certified payroll run ${itemId}`, itemId };
        }
        return { kind: "scheduled_op", subKind: null, label: operation, itemId };
      }
      // Bare scheduled operation (no item id).
      if (operation === "customers") {
        return { kind: "customer", subKind: null, label: "Customer batch sync", itemId: null };
      }
      const label = operation.replace(/_/g, " ");
      return { kind: "scheduled_op", subKind: null, label, itemId: null };
    };

    const classified = rows
      .filter(r => r.retryCount > 0 || r.nextRetryAt !== null)
      .map(r => ({ row: r, ...classify(r.entityType) }));

    // Task #1941 — resolve human-readable names for per-item rows so
    // admins can identify which customer / invoice / pay-run is failing
    // without copying raw IDs into another screen. We collect distinct
    // local IDs per kind, run one batched query each, then attach a
    // `displayName` and a deep `link` to each retry row.
    const customerIds = new Set<string>();
    const invoiceIds = new Set<string>();
    const payRunIds = new Set<string>();
    for (const c of classified) {
      if (!c.itemId) continue;
      if (c.subKind === "customer") customerIds.add(c.itemId);
      else if (c.subKind === "invoice") invoiceIds.add(c.itemId);
      else if (c.subKind === "payroll" || c.subKind === "certified_payroll") payRunIds.add(c.itemId);
    }

    const customerLookup = new Map<string, { name: string }>();
    if (customerIds.size > 0) {
      const orgs = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(and(
          eq(crmOrganisations.organizationId, user.organizationId),
          inArray(crmOrganisations.id, Array.from(customerIds)),
        ));
      for (const o of orgs) customerLookup.set(o.id, { name: o.name });
    }

    const invoiceLookup = new Map<string, { applicationNumber: number; projectCode: string | null; projectName: string | null }>();
    if (invoiceIds.size > 0) {
      const apps = await db
        .select({
          id: payApplications.id,
          applicationNumber: payApplications.applicationNumber,
          projectCode: projects.code,
          projectName: projects.name,
        })
        .from(payApplications)
        .leftJoin(projects, eq(projects.id, payApplications.projectId))
        .where(and(
          eq(payApplications.organizationId, user.organizationId),
          inArray(payApplications.id, Array.from(invoiceIds)),
        ));
      for (const a of apps) {
        invoiceLookup.set(a.id, {
          applicationNumber: a.applicationNumber,
          projectCode: a.projectCode,
          projectName: a.projectName,
        });
      }
    }

    const payRunLookup = new Map<string, { runNumber: string | null; periodStart: string; periodEnd: string }>();
    if (payRunIds.size > 0) {
      const runs = await db
        .select({
          id: payRuns.id,
          runNumber: payRuns.runNumber,
          periodStart: payRuns.payPeriodStart,
          periodEnd: payRuns.payPeriodEnd,
        })
        .from(payRuns)
        .where(and(
          eq(payRuns.organizationId, user.organizationId),
          inArray(payRuns.id, Array.from(payRunIds)),
        ));
      for (const r of runs) {
        payRunLookup.set(r.id, {
          runNumber: r.runNumber,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
        });
      }
    }

    const retries = classified.map(({ row: r, kind, subKind, label, itemId }) => {
      const exhausted = r.retryCount >= MAX_SYNC_RETRIES && r.nextRetryAt === null;

      let displayName: string | null = null;
      let link: string | null = null;
      if (itemId) {
        if (subKind === "customer") {
          const hit = customerLookup.get(itemId);
          if (hit) {
            displayName = hit.name;
            link = `/crm?organisationId=${encodeURIComponent(itemId)}`;
          }
        } else if (subKind === "invoice") {
          const hit = invoiceLookup.get(itemId);
          if (hit) {
            const projectLabel = hit.projectCode ?? hit.projectName ?? null;
            displayName = projectLabel
              ? `Pay app #${hit.applicationNumber} — ${projectLabel}`
              : `Pay app #${hit.applicationNumber}`;
            link = `/progress-billing?payApplicationId=${encodeURIComponent(itemId)}`;
          }
        } else if (subKind === "payroll" || subKind === "certified_payroll") {
          const hit = payRunLookup.get(itemId);
          if (hit) {
            const variantLabel = subKind === "certified_payroll" ? "Certified pay run" : "Pay run";
            const numberLabel = hit.runNumber ? `#${hit.runNumber}` : `${hit.periodStart} – ${hit.periodEnd}`;
            displayName = `${variantLabel} ${numberLabel}`;
            link = `/payroll-management?payRunId=${encodeURIComponent(itemId)}`;
          }
        }
      }

      return {
        id: r.id,
        entityType: r.entityType,
        kind,
        label,
        itemId,
        displayName,
        link,
        lastError: r.lastError,
        lastAttemptAt: r.lastAttemptAt,
        retryCount: r.retryCount,
        nextRetryAt: r.nextRetryAt,
        exhausted,
      };
    });

    res.json({
      connectionId: connection.id,
      provider: connection.provider,
      maxRetries: MAX_SYNC_RETRIES,
      retries,
    });
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

// Sage Intacct chart-of-accounts mapping CRUD (parallel to QBO).

router.get("/connections/:id/sage-account-mappings", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "sage_intacct") {
      return res.status(400).json({ error: "Connection is not a Sage Intacct connection" });
    }

    const mappings = await db.select().from(sageAccountMappings)
      .where(and(
        eq(sageAccountMappings.connectionId, connection.id),
        eq(sageAccountMappings.organizationId, user.organizationId),
      ));
    res.json(mappings);
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:id/sage-account-mappings", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "sage_intacct") {
      return res.status(400).json({ error: "Connection is not a Sage Intacct connection" });
    }

    const { costCode, sageAccountId, sageAccountName, mappingType } = req.body || {};
    if (!costCode || !sageAccountId || !sageAccountName) {
      return res.status(400).json({ error: "costCode, sageAccountId, and sageAccountName are required" });
    }

    const existing = await db.select().from(sageAccountMappings)
      .where(and(
        eq(sageAccountMappings.connectionId, connection.id),
        eq(sageAccountMappings.organizationId, user.organizationId),
        eq(sageAccountMappings.costCode, costCode),
        eq(sageAccountMappings.mappingType, mappingType || "cost_code"),
      ));

    if (existing.length > 0) {
      await db.update(sageAccountMappings)
        .set({ sageAccountId, sageAccountName, updatedAt: new Date() })
        .where(eq(sageAccountMappings.id, existing[0].id));
      logIntegrationAudit("sync.sage_mapping.updated", {
        orgId: user.organizationId,
        connectionId: connection.id,
        provider: "sage_intacct",
        userId: user.id,
        meta: { costCode, sageAccountId },
      });
      res.json({ ...existing[0], sageAccountId, sageAccountName });
    } else {
      const [mapping] = await db.insert(sageAccountMappings).values({
        organizationId: user.organizationId,
        connectionId: connection.id,
        costCode,
        sageAccountId,
        sageAccountName,
        mappingType: mappingType || "cost_code",
      }).returning();
      logIntegrationAudit("sync.sage_mapping.created", {
        orgId: user.organizationId,
        connectionId: connection.id,
        provider: "sage_intacct",
        userId: user.id,
        meta: { costCode, sageAccountId },
      });
      res.json(mapping);
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/connections/:id/sage-account-mappings/:mappingId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;

    await db.delete(sageAccountMappings)
      .where(and(
        eq(sageAccountMappings.id, req.params.mappingId),
        eq(sageAccountMappings.organizationId, user.organizationId),
      ));
    logIntegrationAudit("sync.sage_mapping.deleted", {
      orgId: user.organizationId,
      connectionId: req.params.id,
      provider: "sage_intacct",
      userId: user.id,
      meta: { mappingId: req.params.mappingId },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/connections/:id/sage-account-mappings/auto-map", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "sage_intacct") {
      return res.status(400).json({ error: "Connection is not a Sage Intacct connection" });
    }

    const [coaState] = await db.select().from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, "chart_of_accounts"),
      ));
    if (!coaState) {
      return res.status(400).json({ error: "Chart of Accounts must be synced first" });
    }

    const accounts = (coaState.metadata as any)?.accounts || [];
    const { costCodes } = req.body || {};
    if (!Array.isArray(costCodes) || costCodes.length === 0) {
      return res.status(400).json({ error: "costCodes array is required" });
    }

    const suggestions: Array<{ costCode: string; sageAccountId: string; sageAccountName: string; confidence: string }> = [];
    let created = 0;

    for (const code of costCodes) {
      const codeLower = String(code).toLowerCase().replace(/[-_]/g, " ");
      let best: { sageId: string; name: string; score: number } | null = null;
      for (const acct of accounts) {
        const acctName = String(acct.name || acct.accountNumber || "").toLowerCase();
        if (!acctName) continue;
        if (acctName === codeLower) {
          best = { sageId: acct.sageId, name: acct.name, score: 1 };
          break;
        }
        if (acctName.includes(codeLower) || codeLower.includes(acctName)) {
          if (!best || 0.5 > best.score) best = { sageId: acct.sageId, name: acct.name, score: 0.5 };
        }
      }
      if (best) {
        const existing = await db.select().from(sageAccountMappings)
          .where(and(
            eq(sageAccountMappings.connectionId, connection.id),
            eq(sageAccountMappings.organizationId, user.organizationId),
            eq(sageAccountMappings.costCode, String(code)),
            eq(sageAccountMappings.mappingType, "cost_code"),
          ));
        if (existing.length === 0) {
          await db.insert(sageAccountMappings).values({
            organizationId: user.organizationId,
            connectionId: connection.id,
            costCode: String(code),
            sageAccountId: best.sageId,
            sageAccountName: best.name,
            mappingType: "cost_code",
          });
          created++;
        }
        suggestions.push({
          costCode: String(code),
          sageAccountId: best.sageId,
          sageAccountName: best.name,
          confidence: best.score === 1 ? "exact" : "partial",
        });
      }
    }

    res.json({ suggestions, created, total: costCodes.length });
  } catch (err) {
    next(err);
  }
});

// Sage Intacct — named operation routes (delegate to sync.ts helpers).
// All require requireAuth + RBAC + INTEGRATION_SAGE=true.

async function loadActiveSageConnection(orgId: string): Promise<IntegrationConnection | null> {
  const [conn] = await db
    .select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.organizationId, orgId),
      eq(integrationConnections.provider, "sage_intacct"),
      eq(integrationConnections.status, "active"),
    ));
  if (!conn) return null;
  // sync helpers + xmlGateway expect plaintext userPassword/accessToken;
  // the row's metadata is encrypted at rest by encryptMetadata.
  return {
    ...conn,
    metadata: decryptMetadata((conn.metadata ?? {}) as Record<string, any>),
  } as IntegrationConnection;
}

// Task #1603 — Find any non-disconnected Sage connection for the org so the
// /sage/credentials endpoint can attach Web Services credentials to a
// freshly-created (status=pending) row, not just an already-active one.
async function loadAnySageConnection(orgId: string): Promise<IntegrationConnection | null> {
  const rows = await db
    .select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.organizationId, orgId),
      eq(integrationConnections.provider, "sage_intacct"),
    ));
  // Prefer active, then pending/error, ignore disconnected.
  const candidate =
    rows.find((r) => r.status === "active") ||
    rows.find((r) => r.status !== "disconnected");
  if (!candidate) return null;
  return {
    ...candidate,
    metadata: decryptMetadata((candidate.metadata ?? {}) as Record<string, any>),
  } as IntegrationConnection;
}

// Build a SageInvoiceInput from the local pay-application identified by
// `:invoiceId`. Only APPROVED pay applications are exportable; everything
// else returns null so the route surfaces 404. Customer ref prefers the
// project's `gcOrganizationId` (matches what `exportCustomers` exports as
// CUSTOMERID) and falls back to a sanitised `clientName` slug.
async function resolveSageInvoiceFromPayApplication(
  payApplicationId: string,
  organizationId: string,
): Promise<{
  customerRef: string;
  lineItems: Array<{ description: string; amount: number; costCode?: string }>;
  dueDate?: string;
  docNumber?: string;
  invoiceDate?: string;
  localInvoiceId?: string;
} | null> {
  const [pa] = await db
    .select()
    .from(payApplications)
    .where(and(
      eq(payApplications.id, payApplicationId),
      eq(payApplications.organizationId, organizationId),
    ));
  if (!pa) return null;
  if (pa.status !== "APPROVED") return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, pa.projectId));
  if (!project) return null;

  const items = await db
    .select()
    .from(sovLineItems)
    .where(eq(sovLineItems.sovId, pa.sovId));

  const lineItems = items
    .map((it) => ({
      description: it.description,
      amount: Number(it.thisPeriodCompleted ?? 0) + Number(it.materialsStored ?? 0),
      ...(it.itemCode ? { costCode: it.itemCode } : {}),
    }))
    .filter((it) => it.amount > 0);

  if (lineItems.length === 0) return null;

  const customerRef =
    (project.gcOrganizationId && String(project.gcOrganizationId)) ||
    String(project.clientName || "").trim().replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) ||
    "UNASSIGNED";

  return {
    customerRef,
    lineItems,
    ...(pa.periodTo ? { dueDate: String(pa.periodTo) } : {}),
    docNumber: `PA-${pa.applicationNumber}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    localInvoiceId: pa.id,
  };
}

function requireSageEnabledOrFail(res: any): boolean {
  if (process.env.INTEGRATION_SAGE !== "true") {
    res.status(403).json({ error: "Sage Intacct integration is disabled (INTEGRATION_SAGE=false)" });
    return false;
  }
  return true;
}

// Securely upsert per-tenant Sage Web Services credentials. Accepts the
// userId/userPassword/companyId/locationId in an authenticated POST body
// (TLS only) instead of via OAuth state. The password is encrypted at
// rest via encryptMetadata. Task #1603 — auto-creates a pending Sage
// connection on first use, runs a probe call against the Sage XML
// Gateway with the freshly-supplied credentials, and only flips the
// connection to status=active when the probe succeeds. Bad credentials
// surface immediately to the admin instead of failing later inside a
// background sync.
router.post("/sage/credentials", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;

    const { userId, userPassword, companyId, locationId } = req.body || {};
    if (typeof companyId !== "string" || companyId.length === 0) {
      return res.status(400).json({ error: "companyId is required" });
    }
    if (typeof userId !== "string" || userId.length === 0) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (typeof userPassword !== "string" || userPassword.length === 0) {
      return res.status(400).json({ error: "userPassword is required" });
    }

    // Reuse an existing connection (active/pending/error) or create a
    // new pending row so the integrations page can stand up Sage Intacct
    // end-to-end without a separate OAuth dance or DB-level setup.
    let conn = await loadAnySageConnection(user.organizationId);
    if (!conn) {
      const providerImpl = getProvider("sage_intacct");
      const created = await connectionService.createConnection(
        user.organizationId,
        "sage_intacct",
        providerImpl?.displayName || "Sage Intacct Construction",
        user.id,
      );
      logIntegrationAudit("connection.created", {
        orgId: user.organizationId,
        connectionId: created.id,
        provider: "sage_intacct",
        userId: user.id,
      });
      conn = { ...created, metadata: {} } as IntegrationConnection;
    }

    const existing = (conn.metadata ?? {}) as Record<string, any>;
    const merged: Record<string, any> = {
      ...existing,
      userId,
      userPassword,
      companyId,
    };
    if (typeof locationId === "string" && locationId.length > 0) {
      merged.locationId = locationId;
    } else {
      delete merged.locationId;
    }

    // Probe the Sage XML Gateway with the supplied credentials. We use a
    // trivial readByQuery against COMPANY (always present) so a 401-style
    // auth failure or a wrong companyId is surfaced inline. The probe
    // runs against the *plaintext* merged metadata so we don't have to
    // round-trip through encryptMetadata first.
    let probeError: string | undefined;
    try {
      const credentials = resolveSageCredentials(merged);
      const probe = await sageRequest(
        credentials,
        [
          {
            name: "readByQuery",
            body: {
              object: "COMPANY",
              query: "",
              fields: "COMPANY_ID,COMPANY_NAME",
              pagesize: "1",
              returnFormat: "xml",
            },
            controlId: "sage-credentials-probe",
          },
        ],
        // Keep the probe fast — admin is sitting on the Connect dialog.
        { timeoutMs: 15_000, maxAttempts: 1 },
      );
      if (!probe.success) {
        probeError =
          probe.errors?.[0]?.message || "Sage Intacct probe failed (no detail returned)";
      }
    } catch (err) {
      probeError = err instanceof Error ? err.message : String(err);
    }

    if (probeError) {
      // Bug-class guard: never overwrite a previously-working connection's
      // metadata with unverified credentials. Only update lastSyncError so
      // the admin sees the inline failure and the existing sync stays
      // alive. For pending/error rows we likewise leave prior metadata
      // intact — the admin can retry without us persisting a known-bad
      // password to the encrypted store.
      const keepActive = conn.status === "active";
      const nextStatus: "active" | "pending" = keepActive ? "active" : "pending";
      await db
        .update(integrationConnections)
        .set({
          status: nextStatus,
          lastSyncError: probeError,
          updatedAt: new Date(),
        })
        .where(and(
          eq(integrationConnections.id, conn.id),
          eq(integrationConnections.organizationId, user.organizationId),
        ));

      logIntegrationAudit("security.auth_attempt_failed", {
        orgId: user.organizationId,
        connectionId: conn.id,
        provider: "sage_intacct",
        userId: user.id,
        meta: { event: "sage_credential_probe_failed", error: probeError },
      });
      return res.status(400).json({
        error: `Sage Intacct credential probe failed: ${probeError}`,
        detail: probeError,
        connectionId: conn.id,
      });
    }

    // Probe succeeded — safe to persist the (now-verified) credentials
    // and flip the connection to active in a single update.
    const encrypted = encryptMetadata(merged);
    await db
      .update(integrationConnections)
      .set({
        metadata: encrypted,
        status: "active",
        lastSyncError: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(integrationConnections.id, conn.id),
        eq(integrationConnections.organizationId, user.organizationId),
      ));

    logIntegrationAudit("security.credentials_changed", {
      orgId: user.organizationId,
      connectionId: conn.id,
      provider: "sage_intacct",
      userId: user.id,
      meta: { event: "sage_credentials_upserted" },
    });
    if (conn.status !== "active") {
      logIntegrationAudit("connection.authorized", {
        orgId: user.organizationId,
        connectionId: conn.id,
        provider: "sage_intacct",
        userId: user.id,
      });
    }

    res.status(200).json({ ok: true, connectionId: conn.id, status: "active" });
  } catch (err) {
    next(err);
  }
});

router.post("/sage/sync-coa", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const conn = await loadActiveSageConnection(user.organizationId);
    if (!conn) return res.status(404).json({ error: "No active Sage Intacct connection" });
    const dryRun = req.body?.dryRun === true;
    const result = await sageImportChartOfAccounts(conn, dryRun);
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/sage/export-customers", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const conn = await loadActiveSageConnection(user.organizationId);
    if (!conn) return res.status(404).json({ error: "No active Sage Intacct connection" });
    const dryRun = req.body?.dryRun === true;
    const customers = Array.isArray(req.body?.customers) ? req.body.customers : [];
    const result = await sageExportCustomers(conn, customers, dryRun);
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/sage/export-invoice/:invoiceId", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const conn = await loadActiveSageConnection(user.organizationId);
    if (!conn) return res.status(404).json({ error: "No active Sage Intacct connection" });

    const invoice = await resolveSageInvoiceFromPayApplication(
      req.params.invoiceId,
      user.organizationId,
    );
    if (!invoice) {
      return res.status(404).json({ error: "Pay application not found or not approved for billing" });
    }

    const dryRun = req.body?.dryRun === true;
    const result = await sageExportInvoice(conn, invoice, dryRun);
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/sage/import-payments", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const conn = await loadActiveSageConnection(user.organizationId);
    if (!conn) return res.status(404).json({ error: "No active Sage Intacct connection" });
    let invoiceIds: string[] = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds : [];
    if (invoiceIds.length === 0) {
      invoiceIds = (await getTrackedSageInvoiceRecordIds(conn.id)).slice(0, 200);
    }
    const result = await sageImportPaymentStatus(conn, invoiceIds);
    res.status(result.success ? 200 : 502).json(result);
  } catch (err) {
    next(err);
  }
});

// Task #1604 — read the cached Sage `payment_status_snapshot` and project it
// onto local pay-application IDs (via the `exported_sage_invoices` idMapping)
// so the SOV / pay-app list can render Paid / Partial / Unpaid badges
// without a per-row Sage round-trip. Safe for any authenticated org user
// (read-only cached data); gracefully returns an empty map when the Sage
// integration is disabled or no active connection exists, so the UI can
// always render unconditionally.
router.get("/sage/payment-statuses", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const empty = {
      enabled: process.env.INTEGRATION_SAGE === "true",
      connected: false,
      checkedAt: null as string | null,
      statuses: {} as Record<string, unknown>,
      exportedPayAppIds: [] as string[],
    };
    if (!empty.enabled) return res.json(empty);

    const [conn] = await db
      .select()
      .from(integrationConnections)
      .where(and(
        eq(integrationConnections.organizationId, user.organizationId),
        eq(integrationConnections.provider, "sage_intacct"),
        eq(integrationConnections.status, "active"),
      ));
    if (!conn) return res.json(empty);

    const [exportedRow] = await db
      .select()
      .from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, "exported_sage_invoices"),
      ));
    const [snapshotRow] = await db
      .select()
      .from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, conn.id),
        eq(integrationSyncState.entityType, "payment_status_snapshot"),
      ));

    const exportedMeta = (exportedRow?.metadata ?? {}) as Record<string, any>;
    const idMapping = (exportedMeta.idMapping ?? {}) as Record<string, string>;
    const sageToLocal = new Map<string, string>();
    const exportedPayAppIds: string[] = [];
    for (const [local, sageId] of Object.entries(idMapping)) {
      if (sageId) {
        sageToLocal.set(String(sageId), local);
        exportedPayAppIds.push(local);
      }
    }

    const snapMeta = (snapshotRow?.metadata ?? {}) as Record<string, any>;
    const rawStatuses: Array<Record<string, any>> = Array.isArray(snapMeta.statuses)
      ? snapMeta.statuses
      : [];
    const statuses: Record<string, {
      status: string;
      totalDue: number;
      totalPaid: number;
      dueDate?: string;
      sageInvoiceId: string;
    }> = {};
    for (const s of rawStatuses) {
      const sageId = String(s?.invoiceId ?? "");
      if (!sageId) continue;
      const local = sageToLocal.get(sageId);
      if (!local) continue;
      statuses[local] = {
        status: typeof s.status === "string" ? s.status : "unknown",
        totalDue: Number(s.totalDue ?? 0),
        totalPaid: Number(s.totalPaid ?? 0),
        ...(typeof s.dueDate === "string" && s.dueDate ? { dueDate: s.dueDate } : {}),
        sageInvoiceId: sageId,
      };
    }

    res.json({
      enabled: true,
      connected: true,
      checkedAt:
        (typeof snapMeta.checkedAt === "string" && snapMeta.checkedAt) ||
        (snapshotRow?.lastSyncAt ? snapshotRow.lastSyncAt.toISOString() : null),
      statuses,
      exportedPayAppIds,
    });
  } catch (err) {
    next(err);
  }
});

// Task #1604 — PM-accessible refresh affordance that triggers the existing
// `sage_payment_status` sync op for the (optionally) supplied local pay-app
// IDs. Local IDs are translated to Sage RECORDNOs via the
// `exported_sage_invoices` idMapping so the route accepts the same IDs the
// UI already renders. MANAGER+ may invoke this (PMs need to refresh badges
// from the SOV / invoice list); the read-only ARINVOICE query is safe to
// expose at that level even though the named /sage/* mutation routes are
// kept ADMIN-only.
router.post("/sage/payment-statuses/refresh", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const conn = await loadActiveSageConnection(user.organizationId);
    if (!conn) return res.status(404).json({ error: "No active Sage Intacct connection" });

    const localIds: string[] = Array.isArray(req.body?.invoiceIds)
      ? req.body.invoiceIds.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
      : [];

    let sageIds: string[];
    if (localIds.length > 0) {
      const idMapping = await getIdMapping(conn.id, "exported_sage_invoices");
      const seen = new Set<string>();
      sageIds = [];
      for (const local of localIds) {
        const sageId = idMapping[local];
        if (sageId && !seen.has(String(sageId))) {
          seen.add(String(sageId));
          sageIds.push(String(sageId));
        }
      }
    } else {
      sageIds = (await getTrackedSageInvoiceRecordIds(conn.id)).slice(0, 200);
    }

    if (sageIds.length === 0) {
      return res.json({
        success: true,
        refreshed: 0,
        skipped: localIds.length,
        message: "No Sage-exported invoices to refresh",
      });
    }

    const result = await sageImportPaymentStatus(conn, sageIds);
    res.status(result.success ? 200 : 502).json({
      success: result.success,
      refreshed: result.updated,
      errors: result.errors,
    });
  } catch (err) {
    next(err);
  }
});

// Returns the cached Sage chart-of-accounts for the admin mapping panel.
router.get("/connections/:id/sage-accounts", requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    if (!requireSageEnabledOrFail(res)) return;
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
    if (!connection) return res.status(404).json({ error: "Connection not found" });
    if (connection.provider !== "sage_intacct") {
      return res.status(400).json({ error: "Connection is not a Sage Intacct connection" });
    }

    const [state] = await db.select().from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, "chart_of_accounts"),
      ));
    const accounts = (state?.metadata as any)?.accounts || [];
    const syncedAt = (state?.metadata as any)?.syncedAt || null;
    res.json({ accounts, syncedAt });
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
