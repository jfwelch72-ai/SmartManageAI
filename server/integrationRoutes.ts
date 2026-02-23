import { Router } from "express";
import { requireAuth } from "./auth";
import { getAllProviders, getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import * as outboxService from "./integrations/outboxService";
import * as webhookService from "./integrations/webhookService";
import * as importExportService from "./integrations/importExportService";
import { logIntegrationAudit } from "./integrations/audit";
import { logInfo, logError } from "./utils/logger";
import { db } from "./db";
import { integrationSyncState } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { importChartOfAccounts, exportCustomers, exportInvoice, importPaymentStatus } from "./integrations/providers/qbo";
import { z } from "zod";

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
    res.json(connections);
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
      return res.status(201).json(updated);
    }

    logIntegrationAudit("connection.created", { orgId: user.organizationId, connectionId: connection.id, provider, userId: user.id });
    res.status(201).json(connection);
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
    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
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
    const connection = await connectionService.getConnection(connectionId, orgId);
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
    res.json(updated);
  } catch (err) {
    logError("Failed to disconnect", { error: String(err) });
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

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

    let connection = await connectionService.getConnection(req.params.id, user.organizationId);
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
          connection = (await connectionService.getConnection(connection.id, user.organizationId))!;
          logInfo("Token refreshed before sync", { connectionId: connection.id });
        } catch (refreshErr) {
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

router.post("/connections/:id/test", requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const connection = await connectionService.getConnection(req.params.id, user.organizationId);
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

export default router;
