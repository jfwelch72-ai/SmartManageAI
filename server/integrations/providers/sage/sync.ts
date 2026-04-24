// Sage Intacct sync operations (QBO parity): importChartOfAccounts,
// exportCustomers, exportInvoice, importPaymentStatus. Idempotency via
// integration_sync_state; failures routed through syncRetry with the
// `sage_sync:` entity prefix.

import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import {
  integrationSyncState,
  sageAccountMappings,
  crmOrganisations,
  payApplications,
} from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logError, logInfo, logWarn } from "../../../utils/logger";
import {
  registerSyncRetryHandler,
  recordSyncFailure,
  recordSyncSuccess,
} from "../../syncRetry";
import { logIntegrationAudit } from "../../audit";
import type { SyncResult, SyncError } from "../../types";
import {
  resolveSageCredentials,
  sageRequest,
  SageGatewayError,
  type SageResponse,
} from "./xmlGateway";
import {
  getExportedIds,
  getIdMapping,
  trackExportedId,
} from "../../idMapping";

export const SAGE_SYNC_ENTITY_TYPE_PREFIX = "sage_sync:";

export function sageSyncEntityType(operation: string): string {
  return `${SAGE_SYNC_ENTITY_TYPE_PREFIX}${operation}`;
}

// ---------------------------------------------------------------------------
// Idempotency helpers are sourced from the shared `integrations/idMapping`
// module so QBO and Sage share one implementation of the
// integration_sync_state metadata shape
// (exportedIds + idMapping + lastExportAt).
// ---------------------------------------------------------------------------

// Returns the Sage-side internal RECORDNO (numeric `key`) for every
// AR invoice already exported on this connection. importPaymentStatus
// filters Sage's ARINVOICE on RECORDNO, so the values returned here are
// the ones captured by trackExportedId via extractCreatedKey.
export async function getTrackedSageInvoiceRecordIds(
  connectionId: string,
): Promise<string[]> {
  const [state] = await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, "exported_sage_invoices"),
    ));
  const meta = state?.metadata as Record<string, any> | undefined;
  const exportedIds: string[] = meta?.exportedIds || [];
  const idMapping: Record<string, string> = meta?.idMapping || {};
  const out = new Set<string>();
  for (const local of exportedIds) {
    const sageId = idMapping[local];
    if (sageId) out.add(String(sageId));
  }
  return Array.from(out);
}

async function getAccountMappings(
  connectionId: string,
  organizationId: string,
): Promise<Map<string, { sageAccountId: string; sageAccountName: string }>> {
  const rows = await db
    .select()
    .from(sageAccountMappings)
    .where(and(
      eq(sageAccountMappings.connectionId, connectionId),
      eq(sageAccountMappings.organizationId, organizationId),
    ));
  const map = new Map<string, { sageAccountId: string; sageAccountName: string }>();
  for (const m of rows) {
    map.set(`${m.costCode}:${m.mappingType}`, {
      sageAccountId: m.sageAccountId,
      sageAccountName: m.sageAccountName,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// importChartOfAccounts
// ---------------------------------------------------------------------------

interface SageGlAccount {
  sageId: string;
  accountNumber: string;
  name: string;
  accountType: string;
  status: string;
}

export async function importChartOfAccounts(
  connection: IntegrationConnection,
  dryRun: boolean = false,
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let created = 0;

  try {
    const credentials = resolveSageCredentials(
      (connection.metadata as Record<string, any>) || {},
    );

    const response = await sageRequest<Record<string, any>>(credentials, [
      {
        name: "readByQuery",
        controlId: "coa",
        body: {
          object: "GLACCOUNT",
          fields: "RECORDNO,ACCOUNTNO,TITLE,ACCOUNTTYPE,STATUS",
          query: "STATUS = 'active'",
          pagesize: 1000,
        },
      },
    ]);

    if (!response.success) {
      const errMsg = response.errors.map((e) => e.message).join("; ") || "Sage error";
      throw new Error(errMsg);
    }

    const rawAccounts = extractRecords<Record<string, any>>(
      response.data?.coa,
      "glaccount",
    );

    const accounts: SageGlAccount[] = rawAccounts.map((a) => ({
      sageId: String(a.RECORDNO ?? a.recordno ?? ""),
      accountNumber: String(a.ACCOUNTNO ?? a.accountno ?? ""),
      name: String(a.TITLE ?? a.title ?? ""),
      accountType: String(a.ACCOUNTTYPE ?? a.accounttype ?? ""),
      status: String(a.STATUS ?? a.status ?? "active"),
    }));

    logInfo("Sage Chart of Accounts fetched", { count: accounts.length, dryRun });

    if (!dryRun) {
      await upsertSyncState(connection, "chart_of_accounts", {
        accounts,
        syncedAt: new Date().toISOString(),
      });
      created = accounts.length;
    }

    logIntegrationAudit("sync.sage_chart_of_accounts.executed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      meta: { count: accounts.length, dryRun },
    });

    return {
      success: true,
      entityType: "chart_of_accounts",
      direction: "import",
      created,
      updated: 0,
      skipped: 0,
      errors,
    };
  } catch (err) {
    logError("Sage Chart of Accounts import failed", { error: String(err) });
    errors.push({ message: String(err) });
    logIntegrationAudit("sync.sage_chart_of_accounts.failed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      error: String(err),
    });
    return {
      success: false,
      entityType: "chart_of_accounts",
      direction: "import",
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
    };
  }
}

// ---------------------------------------------------------------------------
// exportCustomers
// ---------------------------------------------------------------------------

export interface SageCustomerInput {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  externalKey?: string;
}

export async function exportCustomers(
  connection: IntegrationConnection,
  customers: SageCustomerInput[],
  dryRun: boolean = false,
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const credentials = resolveSageCredentials(
      (connection.metadata as Record<string, any>) || {},
    );
    const idMapping = await getIdMapping(connection.id, "exported_sage_customers");

    if (customers.length === 0) {
      const rows = await db
        .select()
        .from(crmOrganisations)
        .where(and(
          eq(crmOrganisations.organizationId, connection.organizationId),
          eq(crmOrganisations.isActive, true),
          eq(crmOrganisations.isDeleted, false),
          inArray(crmOrganisations.type, ["CONTRACTOR", "OWNER_REP"]),
        ));
      customers = rows.map((o) => ({
        id: o.id,
        name: o.name,
      }));
    }

    for (const customer of customers) {
      try {
        const existingSageId = idMapping[customer.id];
        if (dryRun) {
          if (existingSageId) updated++;
          else created++;
          continue;
        }

        const displayContact: Record<string, string> = {};
        if (customer.email) displayContact.EMAIL1 = customer.email;
        if (customer.phone) displayContact.PHONE1 = customer.phone;

        if (existingSageId) {
          const response = await sageRequest<Record<string, any>>(credentials, [
            {
              name: "update",
              controlId: `cust-${customer.id}`,
              body: {
                CUSTOMER: {
                  CUSTOMERID: existingSageId,
                  NAME: customer.name,
                  ...(Object.keys(displayContact).length ? { DISPLAYCONTACT: displayContact } : {}),
                },
              },
            },
          ]);
          if (!response.success) {
            throw new Error(response.errors.map((e) => e.message).join("; ") || "Sage error");
          }
          await trackExportedId(
            connection.id,
            connection.organizationId,
            "exported_sage_customers",
            customer.id,
            existingSageId,
          );
          updated++;
        } else {
          const customerId = customer.externalKey || customer.id;
          const response = await sageRequest<Record<string, any>>(credentials, [
            {
              name: "create",
              controlId: `cust-${customer.id}`,
              body: {
                CUSTOMER: {
                  CUSTOMERID: customerId,
                  NAME: customer.name,
                  STATUS: "active",
                  ...(Object.keys(displayContact).length ? { DISPLAYCONTACT: displayContact } : {}),
                },
              },
            },
          ]);
          if (!response.success) {
            throw new Error(response.errors.map((e) => e.message).join("; ") || "Sage error");
          }
          const sageId = extractCreatedKey(response.data?.[`cust-${customer.id}`]);
          await trackExportedId(
            connection.id,
            connection.organizationId,
            "exported_sage_customers",
            customer.id,
            sageId || customerId,
          );
          created++;
        }
      } catch (err) {
        errors.push({ entityId: customer.id, message: String(err) });
      }
    }

    logInfo("Sage customer export completed", {
      created,
      updated,
      skipped,
      errors: errors.length,
      dryRun,
    });

    logIntegrationAudit("sync.sage_customers.executed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      meta: { created, updated, skipped, errors: errors.length, dryRun },
    });

    return {
      success: errors.length === 0,
      entityType: "customer",
      direction: "export",
      created,
      updated,
      skipped,
      errors,
    };
  } catch (err) {
    logError("Sage customer export bootstrap failed", { error: String(err) });
    errors.push({ message: String(err) });
    logIntegrationAudit("sync.sage_customers.failed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      error: String(err),
    });
    return {
      success: false,
      entityType: "customer",
      direction: "export",
      created,
      updated,
      skipped,
      errors,
    };
  }
}

// ---------------------------------------------------------------------------
// exportInvoice
// ---------------------------------------------------------------------------

export interface SageInvoiceInput {
  customerRef: string;
  lineItems: Array<{
    description: string;
    amount: number;
    costCode?: string;
    accountRef?: string;
  }>;
  dueDate?: string;
  docNumber?: string;
  invoiceDate?: string;
  localInvoiceId?: string;
}

export interface ExportInvoiceResult extends SyncResult {
  alreadyExported?: boolean;
  sageInvoiceId?: string;
}

export interface SageSyncOptions {
  /**
   * Inject an alternate fetch implementation (forwarded to `sageRequest`).
   * Used by DB-backed tests to stub the network without mocking any other
   * collaborator. Production callers always omit this.
   */
  fetchImpl?: typeof fetch;
}

export async function exportInvoice(
  connection: IntegrationConnection,
  invoice: SageInvoiceInput,
  dryRun: boolean = false,
  options: SageSyncOptions = {},
): Promise<ExportInvoiceResult> {
  const errors: SyncError[] = [];

  try {
    const credentials = resolveSageCredentials(
      (connection.metadata as Record<string, any>) || {},
    );

    if (invoice.localInvoiceId) {
      const exportedIds = await getExportedIds(connection.id, "exported_sage_invoices");
      if (exportedIds.has(invoice.localInvoiceId)) {
        const idMapping = await getIdMapping(connection.id, "exported_sage_invoices");
        return {
          success: true,
          entityType: "invoice",
          direction: "export",
          created: 0,
          updated: 0,
          skipped: 1,
          errors: [],
          alreadyExported: true,
          sageInvoiceId: idMapping[invoice.localInvoiceId],
        };
      }
    }

    if (dryRun) {
      return {
        success: true,
        entityType: "invoice",
        direction: "export",
        created: 1,
        updated: 0,
        skipped: 0,
        errors: [],
      };
    }

    const accountMappings = await getAccountMappings(connection.id, connection.organizationId);
    const invoiceItems = invoice.lineItems.map((item) => {
      let accountRef = item.accountRef;
      if (!accountRef && item.costCode) {
        const mapping = accountMappings.get(`${item.costCode}:cost_code`);
        if (mapping) accountRef = mapping.sageAccountId;
      }
      return {
        ITEMID: item.costCode || "GENERAL",
        ENTRYDESCRIPTION: item.description,
        AMOUNT: Number(item.amount.toFixed(2)),
        ...(accountRef ? { GLACCOUNTNO: accountRef } : {}),
      };
    });

    const controlKey = `inv-${invoice.localInvoiceId || invoice.docNumber || Date.now()}`;
    const response = await sageRequest<Record<string, any>>(
      credentials,
      [
        {
          name: "create",
          controlId: controlKey,
          body: {
            ARINVOICE: {
              CUSTOMERID: invoice.customerRef,
              DATEPOSTED: invoice.invoiceDate || todayString(),
              DATECREATED: invoice.invoiceDate || todayString(),
              ...(invoice.dueDate ? { DATEDUE: invoice.dueDate } : {}),
              ...(invoice.docNumber ? { RECORDID: invoice.docNumber } : {}),
              ARINVOICEITEMS: { ARINVOICEITEM: invoiceItems },
            },
          },
        },
      ],
      options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
    );

    if (!response.success) {
      const errMsg = response.errors.map((e) => e.message).join("; ") || "Sage error";
      throw new Error(errMsg);
    }

    const sageInvoiceId = extractCreatedKey(response.data?.[controlKey]);
    logInfo("Sage invoice exported", { sageInvoiceId });

    if (invoice.localInvoiceId) {
      await trackExportedId(
        connection.id,
        connection.organizationId,
        "exported_sage_invoices",
        invoice.localInvoiceId,
        sageInvoiceId || invoice.docNumber,
      );
    }

    logIntegrationAudit("sync.sage_invoice.executed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      entityType: "invoice",
      entityId: invoice.localInvoiceId,
      meta: { sageInvoiceId, dryRun },
    });

    return {
      success: true,
      entityType: "invoice",
      direction: "export",
      created: 1,
      updated: 0,
      skipped: 0,
      errors: [],
      sageInvoiceId,
    };
  } catch (err) {
    logError("Sage invoice export failed", { error: String(err) });
    errors.push({ message: String(err) });
    logIntegrationAudit("sync.sage_invoice.failed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      error: String(err),
    });
    return {
      success: false,
      entityType: "invoice",
      direction: "export",
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
    };
  }
}

// ---------------------------------------------------------------------------
// importPaymentStatus
// ---------------------------------------------------------------------------

export interface SagePaymentStatus {
  invoiceId: string;
  status: "paid" | "partial" | "unpaid" | "overdue" | "unknown";
  totalDue: number;
  totalPaid: number;
  dueDate?: string;
}

export async function importPaymentStatus(
  connection: IntegrationConnection,
  invoiceIds: string[],
): Promise<SyncResult & { statuses?: SagePaymentStatus[] }> {
  const errors: SyncError[] = [];
  const statuses: SagePaymentStatus[] = [];
  let updated = 0;

  if (invoiceIds.length === 0) {
    return {
      success: true,
      entityType: "payment",
      direction: "import",
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      statuses: [],
    };
  }

  try {
    const credentials = resolveSageCredentials(
      (connection.metadata as Record<string, any>) || {},
    );
    // Tracked ids come from `extractCreatedKey` which returns Sage's
    // internal `key` (== RECORDNO, integer). Filter on RECORDNO and pass
    // unquoted numerics so the ARINVOICE query matches what we created.
    const idList = invoiceIds
      .map((id) => String(id).replace(/[^0-9]/g, ""))
      .filter((id) => id.length > 0)
      .join(",");
    if (idList.length === 0) {
      return {
        success: true,
        entityType: "payment",
        direction: "import",
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        statuses: [],
      };
    }
    const response = await sageRequest<Record<string, any>>(credentials, [
      {
        name: "readByQuery",
        controlId: "pmt",
        body: {
          object: "ARINVOICE",
          fields: "RECORDID,RECORDNO,TOTALDUE,TOTALPAID,STATE,WHENPAID,WHENDUE",
          query: `RECORDNO IN (${idList})`,
          pagesize: 1000,
        },
      },
    ]);

    if (!response.success) {
      const errMsg = response.errors.map((e) => e.message).join("; ") || "Sage error";
      throw new Error(errMsg);
    }

    const now = Date.now();
    const rows = extractRecords<Record<string, any>>(response.data?.pmt, "arinvoice");
    for (const row of rows) {
      try {
        const recordNo = String(row.RECORDNO ?? row.recordno ?? "");
        const totalDue = Number(row.TOTALDUE ?? row.totaldue ?? 0);
        const totalPaid = Number(row.TOTALPAID ?? row.totalpaid ?? 0);
        const stateRaw = String(row.STATE ?? row.state ?? "").toLowerCase();
        const whenDue = String(row.WHENDUE ?? row.whendue ?? "").trim();
        const dueDateMs = whenDue ? Date.parse(whenDue) : Number.NaN;
        const isPastDue = !Number.isNaN(dueDateMs) && dueDateMs < now;

        let status: SagePaymentStatus["status"];
        if (stateRaw === "paid" || totalDue <= 0.0001) status = "paid";
        else if (totalPaid > 0) status = "partial";
        else if (isPastDue) status = "overdue";
        else status = "unpaid";

        statuses.push({
          invoiceId: recordNo,
          status,
          totalDue,
          totalPaid,
          ...(whenDue ? { dueDate: whenDue } : {}),
        });
        updated++;
      } catch (err) {
        errors.push({ entityId: String(row?.RECORDNO ?? ""), message: String(err) });
      }
    }

    // Apply remote payment results to local pay-applications via the
    // local→Sage RECORDNO mapping captured by exportInvoice.
    try {
      const [stateRow] = await db
        .select()
        .from(integrationSyncState)
        .where(and(
          eq(integrationSyncState.connectionId, connection.id),
          eq(integrationSyncState.entityType, "exported_sage_invoices"),
        ));
      const stateMeta = (stateRow?.metadata ?? {}) as Record<string, unknown>;
      const idMapping = (stateMeta.idMapping ?? {}) as Record<string, string>;
      // sageRecordId -> localInvoiceId
      const sageToLocal = new Map<string, string>();
      for (const [local, sageId] of Object.entries(idMapping)) {
        if (sageId) sageToLocal.set(String(sageId), local);
      }

      const paidLocalIds: string[] = [];
      const paidByLocal = new Map<string, { totalPaid: number }>();
      for (const s of statuses) {
        if (s.status !== "paid" && s.status !== "partial") continue;
        const local = sageToLocal.get(s.invoiceId);
        if (!local) continue;
        if (s.status === "paid") paidLocalIds.push(local);
        paidByLocal.set(local, { totalPaid: s.totalPaid });
      }

      if (paidByLocal.size > 0) {
        const localIds = Array.from(paidByLocal.keys());
        const existing = await db
          .select()
          .from(payApplications)
          .where(and(
            eq(payApplications.organizationId, connection.organizationId),
            inArray(payApplications.id, localIds),
          ));
        for (const pa of existing) {
          const info = paidByLocal.get(pa.id);
          if (!info) continue;
          const isPaid = paidLocalIds.includes(pa.id);
          await db.update(payApplications).set({
            paidAmount: String(info.totalPaid),
            ...(isPaid && !pa.paidAt ? { paidAt: new Date() } : {}),
            paymentReference: `sage:${idMapping[pa.id] || pa.id}`,
            paymentMethod: pa.paymentMethod ?? "sage_intacct",
          }).where(eq(payApplications.id, pa.id));
        }
        if (existing.length > 0) {
          logInfo("Sage payment status applied to local pay applications", {
            connectionId: connection.id,
            updatedCount: existing.length,
          });
        }
      }
    } catch (err) {
      logWarn("Sage payment status: failed to promote into pay applications", {
        connectionId: connection.id,
        error: String(err),
      });
    }

    await upsertSyncState(connection, "payment_status_snapshot", {
      statuses,
      checkedAt: new Date().toISOString(),
    });

    logIntegrationAudit("sync.sage_payment_status.executed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      meta: { updated, errors: errors.length },
    });

    return {
      success: errors.length === 0,
      entityType: "payment",
      direction: "import",
      created: 0,
      updated,
      skipped: 0,
      errors,
      statuses,
    };
  } catch (err) {
    logError("Sage payment status import failed", { error: String(err) });
    errors.push({ message: String(err) });
    logIntegrationAudit("sync.sage_payment_status.failed", {
      orgId: connection.organizationId,
      connectionId: connection.id,
      provider: "sage_intacct",
      error: String(err),
    });
    return {
      success: false,
      entityType: "payment",
      direction: "import",
      created: 0,
      updated,
      skipped: 0,
      errors,
      statuses,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function upsertSyncState(
  connection: IntegrationConnection,
  entityType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connection.id),
      eq(integrationSyncState.entityType, entityType),
    ));

  if (existing) {
    await db
      .update(integrationSyncState)
      .set({ metadata, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(integrationSyncState.id, existing.id));
  } else {
    await db.insert(integrationSyncState).values({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      entityType,
      metadata,
      lastSyncAt: new Date(),
    });
  }
}

// Normalise readByQuery result rows (parser may flatten to a single
// object or an array) into a typed array.
export function extractRecords<T>(node: unknown, objectKey: string): T[] {
  if (!node) return [];
  if (Array.isArray(node)) return node as T[];
  if (typeof node !== "object") return [];
  const record = node as Record<string, any>;
  const candidate =
    record[objectKey] ??
    record[objectKey.toUpperCase()] ??
    record.row;
  if (!candidate) {
    return Object.keys(record).length === 0 ? [] : [record as T];
  }
  return Array.isArray(candidate) ? (candidate as T[]) : [candidate as T];
}

function extractCreatedKey(node: unknown): string | undefined {
  if (!node) return undefined;
  if (typeof node === "object") {
    const rec = node as Record<string, any>;
    const k =
      rec.key ??
      rec.KEY ??
      rec.recordno ??
      rec.RECORDNO ??
      rec.customerid ??
      rec.CUSTOMERID;
    if (typeof k === "string" || typeof k === "number") return String(k);
  }
  return undefined;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Retryable operations + handler registration
// ---------------------------------------------------------------------------

const SAGE_RETRYABLE_OPS = new Set<SageRetryableOperation>([
  "chart_of_accounts",
  "payment_status",
]);
type SageRetryableOperation = "chart_of_accounts" | "payment_status";

async function runSageOperation(
  connection: IntegrationConnection,
  operation: SageRetryableOperation,
): Promise<SyncResult> {
  switch (operation) {
    case "chart_of_accounts":
      return importChartOfAccounts(connection, false);
    case "payment_status": {
      const ids = (await getTrackedSageInvoiceRecordIds(connection.id)).slice(0, 200);
      return importPaymentStatus(connection, ids);
    }
  }
}

registerSyncRetryHandler({
  provider: "sage_intacct",
  entityTypePrefix: SAGE_SYNC_ENTITY_TYPE_PREFIX,
  handler: async (connection, row) => {
    const operation = row.entityType.slice(SAGE_SYNC_ENTITY_TYPE_PREFIX.length).trim();
    if (!SAGE_RETRYABLE_OPS.has(operation as SageRetryableOperation)) {
      logWarn("Sage retry sweep: unsupported operation", {
        operation,
        connectionId: connection.id,
      });
      return { success: false, error: `Unsupported Sage operation: ${operation}` };
    }
    try {
      const out = await runSageOperation(connection, operation as SageRetryableOperation);
      if (out.success) {
        logInfo("Sage scheduled retry succeeded", {
          operation,
          organizationId: row.organizationId,
          previousAttempts: row.retryCount,
        });
        return { success: true };
      }
      const errMsg = out.errors.map((e) => e.message).join("; ") || "Sage sync failed";
      return { success: false, error: errMsg };
    } catch (err) {
      logError("Sage scheduled retry threw", {
        operation,
        organizationId: row.organizationId,
        error: String(err),
      });
      return { success: false, error: String(err) };
    }
  },
});

// ---------------------------------------------------------------------------
// Periodic background sync (4h cron entry point)
// ---------------------------------------------------------------------------

// 4-hour cron entrypoint: sweeps every active Sage connection and runs
// the import-side ops. Per-connection failures are logged and returned.
export async function processSagePeriodicSync(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  failures: Array<{ connectionId: string; error: string }>;
}> {
  if (process.env.INTEGRATION_SAGE !== "true") {
    return { attempted: 0, succeeded: 0, failed: 0, failures: [] };
  }

  const { integrationConnections } = await import("@shared/schema");
  const { decryptMetadata } = await import("../../encryption");
  const rawConnections = await db
    .select()
    .from(integrationConnections)
    .where(and(
      eq(integrationConnections.provider, "sage_intacct"),
      eq(integrationConnections.status, "active"),
    ));
  // Decrypt metadata once so downstream sync helpers see plaintext
  // accessToken / userPassword instead of `enc:` ciphertext.
  const connections = rawConnections.map((c) => ({
    ...c,
    metadata: decryptMetadata((c.metadata ?? {}) as Record<string, any>),
  }));

  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ connectionId: string; error: string }> = [];

  for (const connection of connections) {
    // Each operation goes through recordSyncFailure / recordSyncSuccess
    // so the shared SyncRetryPanel + retry sweep see Sage failures the
    // same way they see QBO failures (5/15/45/120/360-min backoff).
    let connectionFailed = false;
    try {
      const coaEntity = sageSyncEntityType("chart_of_accounts");
      try {
        const coa = await importChartOfAccounts(connection, false);
        if (!coa.success) {
          const errMsg = coa.errors.map((e) => e.message).join("; ") || "Sage CoA import failed";
          await recordSyncFailure(connection, coaEntity, errMsg);
          failures.push({ connectionId: connection.id, error: errMsg });
          connectionFailed = true;
        } else {
          await recordSyncSuccess(connection, coaEntity);
        }
      } catch (err) {
        const errMsg = err instanceof SageGatewayError ? err.message : String(err);
        await recordSyncFailure(connection, coaEntity, errMsg);
        failures.push({ connectionId: connection.id, error: errMsg });
        connectionFailed = true;
      }

      const sageRecordIds = await getTrackedSageInvoiceRecordIds(connection.id);
      if (sageRecordIds.length > 0) {
        const pmtEntity = sageSyncEntityType("payment_status");
        try {
          const pmt = await importPaymentStatus(connection, sageRecordIds.slice(0, 200));
          if (!pmt.success) {
            const errMsg = pmt.errors.map((e) => e.message).join("; ") || "Sage payment status failed";
            await recordSyncFailure(connection, pmtEntity, errMsg);
            failures.push({ connectionId: connection.id, error: errMsg });
            connectionFailed = true;
          } else {
            await recordSyncSuccess(connection, pmtEntity);
          }
        } catch (err) {
          const errMsg = err instanceof SageGatewayError ? err.message : String(err);
          await recordSyncFailure(connection, pmtEntity, errMsg);
          failures.push({ connectionId: connection.id, error: errMsg });
          connectionFailed = true;
        }
      }

      if (connectionFailed) failed++;
      else succeeded++;
    } catch (err) {
      failed++;
      failures.push({ connectionId: connection.id, error: String(err) });
      logError("Sage periodic sync iteration failed", {
        connectionId: connection.id,
        error: String(err),
      });
    }
  }

  logInfo("Sage periodic sync sweep complete", {
    attempted: connections.length,
    succeeded,
    failed,
  });
  return { attempted: connections.length, succeeded, failed, failures };
}
