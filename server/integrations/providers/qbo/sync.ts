import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState, qboAccountMappings, payRuns, payRunLineItems, subcontractorPayments, subcontractorContracts, crmOrganisations, procurementItems, projects, tmInvoices, users, haulTickets, suretyBonds } from "@shared/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
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

async function getAccountMappings(connectionId: string, organizationId: string): Promise<Map<string, { qboAccountId: string; qboAccountName: string }>> {
  const mappings = await db.select().from(qboAccountMappings)
    .where(and(
      eq(qboAccountMappings.connectionId, connectionId),
      eq(qboAccountMappings.organizationId, organizationId),
    ));

  const map = new Map<string, { qboAccountId: string; qboAccountName: string }>();
  for (const m of mappings) {
    map.set(`${m.costCode}:${m.mappingType}`, { qboAccountId: m.qboAccountId, qboAccountName: m.qboAccountName });
  }
  return map;
}

async function getDefaultExpenseAccount(connectionId: string): Promise<{ value: string; name: string } | null> {
  const [coaState] = await db.select().from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, "chart_of_accounts")
    ));

  const accounts = (coaState?.metadata as any)?.accounts || [];
  const expenseAccounts = accounts.filter((a: any) => a.classification === "Expense" && a.active);
  const uncategorized = expenseAccounts.find((a: any) =>
    a.name?.toLowerCase().includes("uncategorized") ||
    a.name?.toLowerCase().includes("miscellaneous") ||
    a.accountSubType === "OtherMiscellaneousExpense"
  );
  const fallback = uncategorized || expenseAccounts[0];
  if (fallback) {
    return { value: fallback.qboId, name: fallback.name };
  }
  return null;
}

async function getDefaultLiabilityAccount(connectionId: string): Promise<{ value: string; name: string } | null> {
  const [coaState] = await db.select().from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, "chart_of_accounts")
    ));

  const accounts = (coaState?.metadata as any)?.accounts || [];
  const liabilityAccounts = accounts.filter((a: any) =>
    (a.classification === "Liability" || a.accountType === "Other Current Liability") && a.active
  );
  const payrollLiab = liabilityAccounts.find((a: any) =>
    a.name?.toLowerCase().includes("payroll") ||
    a.name?.toLowerCase().includes("wages")
  );
  const fallback = payrollLiab || liabilityAccounts[0];
  if (fallback) {
    return { value: fallback.qboId, name: fallback.name };
  }
  return null;
}

async function getOrCreateVendor(realmId: string, accessToken: string, vendorName: string): Promise<string> {
  const query = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName = '${vendorName.replace(/'/g, "\\'")}'`);
  const data = await qboFetch(realmId, accessToken, `query?query=${query}`);
  const existing = data?.QueryResponse?.Vendor;
  if (existing && existing.length > 0) {
    return existing[0].Id;
  }

  const result = await qboPost(realmId, accessToken, "vendor", {
    DisplayName: vendorName,
  });
  return result?.Vendor?.Id;
}

async function getExportedIds(connectionId: string, entityType: string): Promise<Set<string>> {
  const [state] = await db.select().from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType)
    ));

  const meta = state?.metadata as any;
  return new Set(meta?.exportedIds || []);
}

async function trackExportedId(connectionId: string, organizationId: string, entityType: string, newId: string, qboId?: string): Promise<void> {
  const [existing] = await db.select().from(integrationSyncState)
    .where(and(
      eq(integrationSyncState.connectionId, connectionId),
      eq(integrationSyncState.entityType, entityType)
    ));

  const meta = existing?.metadata as any || {};
  const exportedIds = meta.exportedIds || [];
  const idMapping = meta.idMapping || {};

  if (!exportedIds.includes(newId)) {
    exportedIds.push(newId);
  }
  if (qboId) {
    idMapping[newId] = qboId;
  }

  const updatedMeta = { ...meta, exportedIds, idMapping, lastExportAt: new Date().toISOString() };

  if (existing) {
    await db.update(integrationSyncState)
      .set({ metadata: updatedMeta, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(integrationSyncState.id, existing.id));
  } else {
    await db.insert(integrationSyncState).values({
      organizationId,
      connectionId,
      entityType,
      metadata: updatedMeta,
      lastSyncAt: new Date(),
    });
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
    localInvoiceId?: string;
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
    const qboInvoiceId = result?.Invoice?.Id;
    logInfo("QBO invoice exported", { invoiceId: qboInvoiceId });

    if (invoice.localInvoiceId && qboInvoiceId) {
      await trackExportedId(connection.id, connection.organizationId, "exported_invoices", invoice.localInvoiceId, qboInvoiceId);
    }

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

export async function exportPayroll(
  connection: IntegrationConnection,
  payRunId: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_payroll");
    if (exportedIds.has(payRunId)) {
      logInfo("QBO payroll already exported", { payRunId });
      return { success: true, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 1, errors: [] };
    }

    const [payRun] = await db.select().from(payRuns)
      .where(and(
        eq(payRuns.id, payRunId),
        eq(payRuns.organizationId, connection.organizationId)
      ));

    if (!payRun) {
      return { success: false, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 0, errors: [{ message: "Pay run not found" }] };
    }

    if (!["APPROVED", "PAID"].includes(payRun.status)) {
      return { success: false, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 0, errors: [{ message: `Pay run must be APPROVED or PAID (current: ${payRun.status})` }] };
    }

    const lineItems = await db.select({
      costCode: payRunLineItems.costCode,
      totalAmount: payRunLineItems.totalAmount,
      regularHours: payRunLineItems.regularHours,
      overtimeHours: payRunLineItems.overtimeHours,
      userName: users.firstName,
      userLastName: users.lastName,
      projectName: projects.name,
    })
      .from(payRunLineItems)
      .leftJoin(users, eq(payRunLineItems.userId, users.id))
      .leftJoin(projects, eq(payRunLineItems.projectId, projects.id))
      .where(eq(payRunLineItems.payRunId, payRunId));

    if (lineItems.length === 0) {
      return { success: true, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 1, errors: [{ message: "No line items found" }] };
    }

    const accountMappings = await getAccountMappings(connection.id, connection.organizationId);
    const defaultExpenseAccount = await getDefaultExpenseAccount(connection.id);
    const defaultLiabilityAccount = await getDefaultLiabilityAccount(connection.id);

    if (!defaultExpenseAccount) {
      return { success: false, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 0, errors: [{ message: "No expense accounts found in Chart of Accounts. Please sync Chart of Accounts first." }] };
    }

    const costCodeGroups = new Map<string, { total: number; descriptions: string[] }>();
    for (const item of lineItems) {
      const code = item.costCode || "UNASSIGNED";
      const existing = costCodeGroups.get(code) || { total: 0, descriptions: [] };
      existing.total += Number(item.totalAmount || 0);
      const workerName = [item.userName, item.userLastName].filter(Boolean).join(" ") || "Worker";
      existing.descriptions.push(`${workerName} - ${item.projectName || "Project"} (${item.regularHours}h reg, ${item.overtimeHours}h OT)`);
      costCodeGroups.set(code, existing);
    }

    if (dryRun) {
      return {
        success: true,
        entityType: "payroll",
        direction: "export",
        created: 1,
        updated: 0,
        skipped: 0,
        errors: [],
      };
    }

    const journalLines: any[] = [];
    let totalDebit = 0;
    let lineNum = 1;

    const liabilityAccountRef = defaultLiabilityAccount || defaultExpenseAccount;

    for (const [costCode, group] of costCodeGroups) {
      const mapping = accountMappings.get(`${costCode}:cost_code`);
      const accountRef = mapping
        ? { value: mapping.qboAccountId, name: mapping.qboAccountName }
        : defaultExpenseAccount!;

      journalLines.push({
        DetailType: "JournalEntryLineDetail",
        Amount: Math.round(group.total * 100) / 100,
        Description: `Payroll - ${costCode}: ${group.descriptions.slice(0, 3).join("; ")}${group.descriptions.length > 3 ? ` (+${group.descriptions.length - 3} more)` : ""}`,
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: accountRef,
        },
        LineNum: lineNum++,
      });
      totalDebit += group.total;
    }

    journalLines.push({
      DetailType: "JournalEntryLineDetail",
      Amount: Math.round(totalDebit * 100) / 100,
      Description: `Payroll liability - Run #${payRun.runNumber || payRunId} (${payRun.payPeriodStart} to ${payRun.payPeriodEnd})`,
      JournalEntryLineDetail: {
        PostingType: "Credit",
        AccountRef: liabilityAccountRef,
      },
      LineNum: lineNum,
    });

    const journalEntry = {
      TxnDate: payRun.payPeriodEnd,
      PrivateNote: `SmartManageAI Pay Run #${payRun.runNumber || payRunId}`,
      Line: journalLines,
    };

    const result = await qboPost(metadata.realmId, metadata.accessToken || "", "journalentry", journalEntry);
    const qboJournalId = result?.JournalEntry?.Id;
    logInfo("QBO payroll journal entry created", { payRunId, qboJournalId });

    await trackExportedId(connection.id, connection.organizationId, "exported_payroll", payRunId, qboJournalId);
    created = 1;

    return { success: true, entityType: "payroll", direction: "export", created, updated: 0, skipped, errors };
  } catch (err) {
    logError("QBO payroll export failed", { error: String(err), payRunId });
    errors.push({ message: String(err) });
    return { success: false, entityType: "payroll", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

export async function exportSubcontractorPayments(
  connection: IntegrationConnection,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_sub_payments");

    const payments = await db.select({
      payment: subcontractorPayments,
      contractNumber: subcontractorContracts.contractNumber,
      scopeOfWork: subcontractorContracts.scopeOfWork,
      subcontractorId: subcontractorContracts.subcontractorId,
    })
      .from(subcontractorPayments)
      .innerJoin(subcontractorContracts, eq(subcontractorPayments.contractId, subcontractorContracts.id))
      .where(and(
        eq(subcontractorPayments.organizationId, connection.organizationId),
        inArray(subcontractorPayments.status, ["APPROVED", "PAID"])
      ));

    if (payments.length === 0) {
      return { success: true, entityType: "subcontractor_bill", direction: "export", created: 0, updated: 0, skipped: 0, errors: [] };
    }

    const accountMappings = await getAccountMappings(connection.id, connection.organizationId);
    const defaultExpAccount = await getDefaultExpenseAccount(connection.id);

    if (!defaultExpAccount) {
      return { success: false, entityType: "subcontractor_bill", direction: "export", created: 0, updated: 0, skipped: 0, errors: [{ message: "No expense accounts found in Chart of Accounts. Please sync Chart of Accounts first." }] };
    }

    const subIds = [...new Set(payments.map(p => p.subcontractorId))];
    const subs = await db.select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(inArray(crmOrganisations.id, subIds));
    const subNameMap = new Map(subs.map(s => [s.id, s.name]));

    for (const { payment, contractNumber, scopeOfWork, subcontractorId } of payments) {
      if (exportedIds.has(payment.id)) {
        skipped++;
        continue;
      }

      try {
        const vendorName = subNameMap.get(subcontractorId) || `Subcontractor ${subcontractorId}`;

        if (dryRun) {
          created++;
          continue;
        }

        const vendorId = await getOrCreateVendor(metadata.realmId, metadata.accessToken || "", vendorName);

        const costCodeKey = scopeOfWork ? `${scopeOfWork}:cost_code` : null;
        const mappedAccount = costCodeKey ? accountMappings.get(costCodeKey) : null;
        const lineAccountRef = mappedAccount
          ? { value: mappedAccount.qboAccountId, name: mappedAccount.qboAccountName }
          : defaultExpAccount;

        const bill = {
          VendorRef: { value: vendorId },
          DocNumber: payment.invoiceNumber || `SUB-${contractNumber}-${payment.paymentNumber}`,
          TxnDate: payment.paymentDate ? new Date(payment.paymentDate).toISOString().split("T")[0] : undefined,
          Line: [
            {
              DetailType: "AccountBasedExpenseLineDetail",
              Amount: Number(payment.amount),
              Description: `${scopeOfWork} - Payment #${payment.paymentNumber}${payment.retentionHeld ? ` (Retention: $${payment.retentionHeld})` : ""}`,
              AccountBasedExpenseLineDetail: {
                AccountRef: lineAccountRef,
              },
            },
          ],
        };

        const result = await qboPost(metadata.realmId, metadata.accessToken || "", "bill", bill);
        const qboBillId = result?.Bill?.Id;
        logInfo("QBO bill exported for sub payment", { paymentId: payment.id, qboBillId });

        await trackExportedId(connection.id, connection.organizationId, "exported_sub_payments", payment.id, qboBillId);
        created++;
      } catch (err) {
        errors.push({ entityId: payment.id, message: String(err) });
      }
    }

    logInfo("QBO subcontractor payments export completed", { created, skipped, errors: errors.length });
    return { success: errors.length === 0, entityType: "subcontractor_bill", direction: "export", created, updated: 0, skipped, errors };
  } catch (err) {
    logError("QBO subcontractor payments export failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "subcontractor_bill", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

export async function exportPurchaseOrders(
  connection: IntegrationConnection,
  projectId?: string,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_purchase_orders");

    const conditions = [
      eq(projects.gcOrganizationId, connection.organizationId),
      inArray(procurementItems.status, ["ORDERED", "RECEIVED"]),
    ];
    if (projectId) {
      conditions.push(eq(procurementItems.projectId, projectId));
    }

    const items = await db.select({
      item: procurementItems,
      projectName: projects.name,
    })
      .from(procurementItems)
      .innerJoin(projects, eq(procurementItems.projectId, projects.id))
      .where(and(...conditions));

    if (items.length === 0) {
      return { success: true, entityType: "purchase_order", direction: "export", created: 0, updated: 0, skipped: 0, errors: [] };
    }

    const accountMappings = await getAccountMappings(connection.id, connection.organizationId);
    const defaultExpAccount = await getDefaultExpenseAccount(connection.id);

    if (!defaultExpAccount) {
      return { success: false, entityType: "purchase_order", direction: "export", created: 0, updated: 0, skipped: 0, errors: [{ message: "No expense accounts found in Chart of Accounts. Please sync Chart of Accounts first." }] };
    }

    const poGroups = new Map<string, Array<{ item: typeof items[0]["item"]; projectName: string | null }>>();
    for (const row of items) {
      const poNum = row.item.poNumber || `PO-${row.item.id}`;
      const group = poGroups.get(poNum) || [];
      group.push({ item: row.item, projectName: row.projectName });
      poGroups.set(poNum, group);
    }

    for (const [poNumber, groupItems] of poGroups) {
      if (exportedIds.has(poNumber)) {
        skipped++;
        continue;
      }

      try {
        const vendorName = groupItems[0].item.vendor || "Unknown Vendor";

        if (dryRun) {
          created++;
          continue;
        }

        const vendorId = await getOrCreateVendor(metadata.realmId, metadata.accessToken || "", vendorName);

        const lines = groupItems.map((g, idx) => {
          const costCode = g.item.costCode || "";
          const mapping = costCode ? accountMappings.get(`${costCode}:cost_code`) : null;
          const lineAccountRef = mapping
            ? { value: mapping.qboAccountId, name: mapping.qboAccountName }
            : defaultExpAccount;

          return {
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: Number(g.item.quantity || 0) * Number(g.item.unitCost || 0),
            Description: `${g.item.description} (${g.item.quantity} ${g.item.unit || "units"} @ $${g.item.unitCost}) - ${g.projectName || "Project"}`,
            AccountBasedExpenseLineDetail: {
              AccountRef: lineAccountRef,
            },
            LineNum: idx + 1,
          };
        });

        const po = {
          VendorRef: { value: vendorId },
          DocNumber: poNumber,
          Line: lines,
        };

        const result = await qboPost(metadata.realmId, metadata.accessToken || "", "purchaseorder", po);
        const qboPoId = result?.PurchaseOrder?.Id;
        logInfo("QBO purchase order exported", { poNumber, qboPoId });

        await trackExportedId(connection.id, connection.organizationId, "exported_purchase_orders", poNumber, qboPoId);
        created++;
      } catch (err) {
        errors.push({ entityId: poNumber, message: String(err) });
      }
    }

    logInfo("QBO purchase orders export completed", { created, skipped, errors: errors.length });
    return { success: errors.length === 0, entityType: "purchase_order", direction: "export", created, updated: 0, skipped, errors };
  } catch (err) {
    logError("QBO purchase orders export failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "purchase_order", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

export async function reconcilePayments(
  connection: IntegrationConnection,
  dryRun: boolean = false
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let updated = 0;
  let skipped = 0;

  try {
    const [syncState] = await db.select().from(integrationSyncState)
      .where(and(
        eq(integrationSyncState.connectionId, connection.id),
        eq(integrationSyncState.entityType, "exported_invoices")
      ));

    const stateMeta = syncState?.metadata as any;
    const idMapping = stateMeta?.idMapping || {};
    const localIds = Object.keys(idMapping);

    if (localIds.length === 0) {
      return { success: true, entityType: "payment_reconciliation", direction: "import", created: 0, updated: 0, skipped: 0, errors: [{ message: "No exported invoices found to reconcile" }] };
    }

    const localInvoices = await db.select().from(tmInvoices)
      .where(and(
        eq(tmInvoices.organizationId, connection.organizationId),
        inArray(tmInvoices.id, localIds)
      ));

    const statusChanges: Array<{ localId: string; oldStatus: string; newStatus: string }> = [];

    for (const localInvoice of localInvoices) {
      const qboInvoiceId = idMapping[localInvoice.id];
      if (!qboInvoiceId) {
        skipped++;
        continue;
      }

      try {
        const data = await qboFetch(
          metadata.realmId,
          metadata.accessToken || "",
          `invoice/${qboInvoiceId}`
        );

        const qboInv = data?.Invoice;
        if (!qboInv) {
          skipped++;
          continue;
        }

        const balance = Number(qboInv.Balance || 0);
        const total = Number(qboInv.TotalAmt || 0);
        let newStatus: string;
        if (balance === 0 && total > 0) {
          newStatus = "PAID";
        } else if (balance > 0 && balance < total) {
          newStatus = "SENT";
        } else {
          newStatus = "SENT";
        }

        if (localInvoice.status === "PAID" || localInvoice.status === "CANCELLED") {
          skipped++;
          continue;
        }

        if (localInvoice.status !== newStatus) {
          if (!dryRun) {
            await db.update(tmInvoices)
              .set({ status: newStatus, updatedAt: new Date() })
              .where(eq(tmInvoices.id, localInvoice.id));
          }
          statusChanges.push({ localId: localInvoice.id, oldStatus: localInvoice.status, newStatus });
          updated++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push({ entityId: localInvoice.id, message: String(err) });
      }
    }

    logInfo("QBO payment reconciliation completed", { updated, skipped, errors: errors.length, changes: statusChanges });

    return {
      success: errors.length === 0,
      entityType: "payment_reconciliation",
      direction: "import",
      created: 0,
      updated,
      skipped,
      errors,
    };
  } catch (err) {
    logError("QBO payment reconciliation failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "payment_reconciliation", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}

// ============================================================================
// HEAVY-CIVIL EXPORTS
// Haul tickets → Bills, surety premiums → Bills, certified payroll → Journal
// All idempotent via the existing exportedIds tracker.
// ============================================================================

/**
 * Export approved haul tickets to QBO as Bills (one Bill per ticket, vendor =
 * haulerVendor). Skips tickets already exported, tickets without a hauler,
 * and tickets without a totalCost.
 */
export async function exportHaulTickets(
  connection: IntegrationConnection,
  options: { projectId?: string; dryRun?: boolean } = {}
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_haul_tickets");
    const where = options.projectId
      ? and(
          eq(haulTickets.organizationId, connection.organizationId),
          eq(haulTickets.projectId, options.projectId),
          eq(haulTickets.status, "APPROVED" as any),
          isNotNull(haulTickets.totalCost),
          isNotNull(haulTickets.haulerVendorId),
        )
      : and(
          eq(haulTickets.organizationId, connection.organizationId),
          eq(haulTickets.status, "APPROVED" as any),
          isNotNull(haulTickets.totalCost),
          isNotNull(haulTickets.haulerVendorId),
        );
    const tickets = await db.select().from(haulTickets).where(where);
    const defaultExpAccount = await getDefaultExpenseAccount(connection.id);
    if (!defaultExpAccount) {
      throw new Error("No expense account mapping. Import chart of accounts first.");
    }
    const accountMap = await getAccountMappings(connection.id, connection.organizationId);

    for (const ticket of tickets) {
      if (exportedIds.has(ticket.id)) { skipped++; continue; }
      try {
        const [vendor] = ticket.haulerVendorId
          ? await db.select({ name: crmOrganisations.name }).from(crmOrganisations).where(eq(crmOrganisations.id, ticket.haulerVendorId))
          : [];
        if (!vendor?.name) { skipped++; continue; }

        const ccKey = ticket.costCode ? `${ticket.costCode}:cost_code` : null;
        const acct = (ccKey && accountMap.get(ccKey)) || null;
        const accountRef = acct ? { value: acct.qboAccountId, name: acct.qboAccountName } : defaultExpAccount;

        if (options.dryRun) { created++; continue; }

        const vendorId = await getOrCreateVendor(metadata.realmId, metadata.accessToken || "", vendor.name);
        const bill = {
          VendorRef: { value: vendorId },
          TxnDate: ticket.ticketDate,
          DocNumber: ticket.ticketNumber.slice(0, 21),
          PrivateNote: `Haul ticket ${ticket.ticketNumber} — ${ticket.materialClass}${ticket.payItemNumber ? ` / pay item ${ticket.payItemNumber}` : ""}`,
          Line: [{
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: Number(ticket.totalCost),
            Description: `${ticket.materialClass} ${ticket.quantity} ${ticket.unit} → ${ticket.destination ?? ""}`.slice(0, 4000),
            AccountBasedExpenseLineDetail: { AccountRef: accountRef },
          }],
        };
        const result = await qboPost(metadata.realmId, metadata.accessToken || "", "bill", bill);
        const qboBillId = result?.Bill?.Id;
        await trackExportedId(connection.id, connection.organizationId, "exported_haul_tickets", ticket.id, qboBillId);
        created++;
      } catch (err) {
        errors.push({ entityId: ticket.id, message: String(err) });
      }
    }

    logInfo("QBO haul ticket export complete", { created, skipped, errors: errors.length });
    return {
      success: errors.length === 0,
      entityType: "haul_ticket",
      direction: "export",
      created,
      updated: 0,
      skipped,
      errors,
    };
  } catch (err) {
    logError("QBO haul ticket export failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "haul_ticket", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

/**
 * Export surety bond premiums (premiumAmount > 0, status=ACTIVE) as QBO Bills
 * to the surety company. Idempotent per bond.
 */
export async function exportSuretyPremiums(
  connection: IntegrationConnection,
  options: { dryRun?: boolean } = {}
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];
  let created = 0;
  let skipped = 0;

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_surety_premiums");
    const bonds = await db.select().from(suretyBonds).where(and(
      eq(suretyBonds.organizationId, connection.organizationId),
      eq(suretyBonds.status, "ACTIVE" as any),
      isNotNull(suretyBonds.premiumAmount),
    ));
    const defaultExpAccount = await getDefaultExpenseAccount(connection.id);
    if (!defaultExpAccount) {
      throw new Error("No expense account mapping. Import chart of accounts first.");
    }

    for (const bond of bonds) {
      if (exportedIds.has(bond.id)) { skipped++; continue; }
      const premium = Number(bond.premiumAmount);
      if (!isFinite(premium) || premium <= 0) { skipped++; continue; }
      try {
        if (options.dryRun) { created++; continue; }
        const vendorId = await getOrCreateVendor(metadata.realmId, metadata.accessToken || "", bond.suretyCompany);
        const bill = {
          VendorRef: { value: vendorId },
          TxnDate: bond.effectiveDate ?? new Date().toISOString().slice(0, 10),
          DocNumber: `BOND-${bond.bondNumber}`.slice(0, 21),
          PrivateNote: `${bond.bondType} bond #${bond.bondNumber} premium${bond.expirationDate ? ` (exp ${bond.expirationDate})` : ""}`,
          Line: [{
            DetailType: "AccountBasedExpenseLineDetail",
            Amount: premium,
            Description: `Surety premium — ${bond.bondType} bond ${bond.bondNumber}`,
            AccountBasedExpenseLineDetail: { AccountRef: defaultExpAccount },
          }],
        };
        const result = await qboPost(metadata.realmId, metadata.accessToken || "", "bill", bill);
        const qboBillId = result?.Bill?.Id;
        await trackExportedId(connection.id, connection.organizationId, "exported_surety_premiums", bond.id, qboBillId);
        created++;
      } catch (err) {
        errors.push({ entityId: bond.id, message: String(err) });
      }
    }

    logInfo("QBO surety premium export complete", { created, skipped, errors: errors.length });
    return {
      success: errors.length === 0,
      entityType: "surety_premium",
      direction: "export",
      created,
      updated: 0,
      skipped,
      errors,
    };
  } catch (err) {
    logError("QBO surety premium export failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "surety_premium", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}

/**
 * Export a certified payroll run as a single QBO Journal Entry. Splits the
 * existing payRun aggregation by Davis-Bacon classification, debiting the
 * mapped wage expense account and crediting the default liability account.
 * Idempotency key: payRunId. Intentionally shares the `exported_payroll`
 * bucket with `exportPayroll` so a single pay run can never produce two
 * journal entries — heavy-civil orgs choose ONE payroll export style per run.
 */
export async function exportCertifiedPayroll(
  connection: IntegrationConnection,
  payRunId: string,
  options: { dryRun?: boolean } = {}
): Promise<SyncResult> {
  const metadata = connection.metadata as Record<string, any> || {};
  const errors: SyncError[] = [];

  try {
    const exportedIds = await getExportedIds(connection.id, "exported_payroll");
    if (exportedIds.has(payRunId)) {
      return { success: true, entityType: "certified_payroll", direction: "export", created: 0, updated: 0, skipped: 1, errors };
    }

    const lines = await db
      .select({
        amount: payRunLineItems.grossAmount,
        costCode: payRunLineItems.costCode,
        projectId: payRunLineItems.projectId,
      })
      .from(payRunLineItems)
      .where(eq(payRunLineItems.payRunId, payRunId));

    if (lines.length === 0) {
      return { success: true, entityType: "certified_payroll", direction: "export", created: 0, updated: 0, skipped: 1, errors };
    }

    const defaultExpAccount = await getDefaultExpenseAccount(connection.id);
    const liabilityAccount = await getDefaultLiabilityAccount(connection.id);
    if (!defaultExpAccount || !liabilityAccount) {
      throw new Error("Need both an expense and a liability account. Import chart of accounts first.");
    }
    const accountMap = await getAccountMappings(connection.id, connection.organizationId);

    const buckets = new Map<string, number>();
    for (const ln of lines) {
      const key = ln.costCode ?? "unclassified";
      const amt = Number(ln.amount ?? 0);
      buckets.set(key, (buckets.get(key) ?? 0) + amt);
    }

    let total = 0;
    const journalLines: any[] = [];
    for (const [costCode, amount] of buckets.entries()) {
      if (amount <= 0) continue;
      total += amount;
      const ccKey = `${costCode}:wage_expense`;
      const acct = accountMap.get(ccKey) ?? accountMap.get(`${costCode}:cost_code`);
      const accountRef = acct ? { value: acct.qboAccountId, name: acct.qboAccountName } : defaultExpAccount;
      journalLines.push({
        DetailType: "JournalEntryLineDetail",
        Amount: amount,
        Description: `Certified payroll — cost code ${costCode}`,
        JournalEntryLineDetail: { PostingType: "Debit", AccountRef: accountRef },
      });
    }
    if (total <= 0) {
      return { success: true, entityType: "certified_payroll", direction: "export", created: 0, updated: 0, skipped: 1, errors };
    }
    journalLines.push({
      DetailType: "JournalEntryLineDetail",
      Amount: total,
      Description: `Certified payroll liability — pay run ${payRunId}`,
      JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: liabilityAccount.value, name: liabilityAccount.name } },
    });

    if (options.dryRun) {
      return { success: true, entityType: "certified_payroll", direction: "export", created: 1, updated: 0, skipped: 0, errors };
    }

    const journalEntry = {
      TxnDate: new Date().toISOString().slice(0, 10),
      PrivateNote: `Certified Payroll WH-347 — pay run ${payRunId}`,
      Line: journalLines,
    };
    const result = await qboPost(metadata.realmId, metadata.accessToken || "", "journalentry", journalEntry);
    const qboId = result?.JournalEntry?.Id;
    await trackExportedId(connection.id, connection.organizationId, "exported_payroll", payRunId, qboId);

    logInfo("QBO certified payroll export complete", { payRunId, total, classCount: buckets.size });
    return { success: true, entityType: "certified_payroll", direction: "export", created: 1, updated: 0, skipped: 0, errors };
  } catch (err) {
    logError("QBO certified payroll export failed", { error: String(err), payRunId });
    errors.push({ entityId: payRunId, message: String(err) });
    return { success: false, entityType: "certified_payroll", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}
