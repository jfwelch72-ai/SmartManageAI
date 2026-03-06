import { Router } from "express";
import { requireAuth } from "./auth";
import { getProvider } from "./integrations/registry";
import * as connectionService from "./integrations/connectionService";
import { logIntegrationAudit } from "./integrations/audit";
import { logInfo, logError } from "./utils/logger";
import { db } from "./db";
import { integrationSyncState, qboAccountMappings, qboSyncSchedules } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { importChartOfAccounts, exportCustomers, exportInvoice, importPaymentStatus, exportPayroll, exportSubcontractorPayments, exportPurchaseOrders, reconcilePayments } from "./integrations/providers/qbo";
import { z } from "zod";

const router = Router();

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

export default router;
