import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";

function getQboBaseUrl(): string {
  return process.env.QBO_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

async function qboFetch(realmId: string, accessToken: string, endpoint: string): Promise<any> {
  const baseUrl = getQboBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/v3/company/${realmId}/${endpoint}`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QBO API error ${response.status}: ${text}`);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function qboPost(realmId: string, accessToken: string, endpoint: string, body: any): Promise<any> {
  const baseUrl = getQboBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/v3/company/${realmId}/${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`QBO API error ${response.status}: ${text}`);
    }

    return response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function importChartOfAccounts(
  connection: IntegrationConnection,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;

  try {
    const data = await qboFetch(
      metadata.realmId,
      metadata.accessToken || "",
      "query?query=SELECT * FROM Account MAXRESULTS 1000"
    );

    const accounts = data?.QueryResponse?.Account || [];
    logInfo("QBO Chart of Accounts fetched", { count: accounts.length, dryRun });

    if (!dryRun) {
      const [existing] = await db.select().from(integrationSyncState)
        .where(and(
          eq(integrationSyncState.connectionId, connection.id),
          eq(integrationSyncState.entityType, "chart_of_accounts")
        ));

      const syncData = {
        accounts: accounts.map((a: any) => ({
          qboId: a.Id,
          name: a.Name,
          accountType: a.AccountType,
          accountSubType: a.AccountSubType,
          classification: a.Classification,
          active: a.Active,
        })),
        syncedAt: new Date().toISOString(),
      };

      if (existing) {
        await db.update(integrationSyncState)
          .set({ metadata: syncData, lastSyncAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationSyncState.id, existing.id));
      } else {
        await db.insert(integrationSyncState).values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          entityType: "chart_of_accounts",
          metadata: syncData,
          lastSyncAt: new Date(),
        });
      }
      created = accounts.length;
    }

    return { success: true, entityType: "chart_of_accounts", direction: "import", created, updated: 0, skipped: 0, errors };
  } catch (err) {
    logError("QBO Chart of Accounts import failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "chart_of_accounts", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}

export async function exportCustomers(
  connection: IntegrationConnection,
  customers: Array<{ id: string; name: string; email?: string; phone?: string }>,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const customer of customers) {
    try {
      if (dryRun) {
        created++;
        continue;
      }

      const qboCustomer = {
        DisplayName: customer.name,
        PrimaryEmailAddr: customer.email ? { Address: customer.email } : undefined,
        PrimaryPhone: customer.phone ? { FreeFormNumber: customer.phone } : undefined,
      };

      await qboPost(metadata.realmId, metadata.accessToken || "", "customer", qboCustomer);
      created++;
    } catch (err) {
      errors.push({ entityId: customer.id, message: String(err) });
    }
  }

  logInfo("QBO customer export completed", { created, updated, skipped, errors: errors.length });
  return { success: errors.length === 0, entityType: "customer", direction: "export", created, updated, skipped, errors };
}

export async function exportInvoice(
  connection: IntegrationConnection,
  invoice: {
    customerRef: string;
    lineItems: Array<{ description: string; amount: number; accountRef?: string }>;
    dueDate?: string;
    docNumber?: string;
  },
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];

  try {
    if (dryRun) {
      return { success: true, entityType: "invoice", direction: "export", created: 1, updated: 0, skipped: 0, errors: [] };
    }

    const qboInvoice: any = {
      CustomerRef: { value: invoice.customerRef },
      Line: invoice.lineItems.map((item, idx) => ({
        DetailType: "SalesItemLineDetail",
        Amount: item.amount,
        Description: item.description,
        SalesItemLineDetail: {
          ItemRef: { value: "1" },
          ...(item.accountRef ? { AccountRef: { value: item.accountRef } } : {}),
        },
        LineNum: idx + 1,
      })),
    };

    if (invoice.dueDate) qboInvoice.DueDate = invoice.dueDate;
    if (invoice.docNumber) qboInvoice.DocNumber = invoice.docNumber;

    const result = await qboPost(metadata.realmId, metadata.accessToken || "", "invoice", qboInvoice);
    logInfo("QBO invoice exported", { invoiceId: result?.Invoice?.Id });

    return { success: true, entityType: "invoice", direction: "export", created: 1, updated: 0, skipped: 0, errors: [] };
  } catch (err) {
    errors.push({ message: String(err) });
    return { success: false, entityType: "invoice", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

export async function importPaymentStatus(
  connection: IntegrationConnection,
  invoiceIds: string[]
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let updated = 0;

  for (const invoiceId of invoiceIds) {
    try {
      const data = await qboFetch(
        metadata.realmId,
        metadata.accessToken || "",
        `invoice/${invoiceId}`
      );

      const invoice = data?.Invoice;
      if (invoice) {
        const balance = invoice.Balance;
        const total = invoice.TotalAmt;
        const status = balance === 0 ? "paid" : balance < total ? "partial" : "unpaid";
        logInfo("QBO payment status", { invoiceId, status, balance, total });
        updated++;
      }
    } catch (err) {
      errors.push({ entityId: invoiceId, message: String(err) });
    }
  }

  return { success: errors.length === 0, entityType: "payment", direction: "import", created: 0, updated, skipped: 0, errors };
}
