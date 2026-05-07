/**
 * Reusable test data factories for the money-path e2e suite.
 *
 * Every factory issues a single REST call against the dev server (with
 * the calling page's CSRF cookie already installed via `installCsrf`)
 * and returns the parsed JSON response. The factories are intentionally
 * thin so specs can compose them without learning each domain's
 * idiosyncratic schema — and so that a test author who needs a one-off
 * field tweak can pass an `overrides` object instead of forking the
 * helper.
 *
 * Authentication / org context is implicit: the factories piggy-back on
 * the cookies installed by `devLogin(page, "ADMIN")` (or any other
 * write-capable role). Tenant-isolation specs that need to act as Org B
 * should use `devLoginRequest(request, ...)` from `./auth.ts` against a
 * fresh `request.newContext()` and pass that context into the factory
 * via `request:`.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

type Ctx = Page | { request: APIRequestContext };

function getRequest(ctx: Ctx): APIRequestContext {
  // Playwright's Page has a `.request` getter; APIRequestContext-bearing
  // wrappers expose the same shape via the explicit `request` field.
  return (ctx as Page).request ?? (ctx as { request: APIRequestContext }).request;
}

export interface BidFactoryOpts {
  name?: string;
  clientName?: string;
  bidAmount?: number;
  status?: string;
}

export interface CreatedBid {
  id: string;
  code: string;
  name: string;
  status: string;
}

export async function createBid(
  ctx: Ctx,
  opts: BidFactoryOpts = {},
): Promise<CreatedBid> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await getRequest(ctx).post(`${BASE_URL}/api/bids`, {
    data: {
      name: opts.name ?? `E2E Bid ${suffix}`,
      clientName: opts.clientName ?? "E2E Client",
      bidAmount: opts.bidAmount ?? 50000,
      status: opts.status ?? "DRAFT",
    },
  });
  expect(res.status(), `createBid failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedBid;
}

export interface CreatedProject {
  id: string;
  code: string;
  name: string;
  status: string;
  contractAmount?: string | null;
  gcOrganizationId?: string | null;
}

/**
 * Convert a bid into a project — exercises the production
 * `bidStorage.convertBidToProject()` path so the project carries
 * over estimates and the bid flips to AWARDED.
 */
export async function awardBidAndConvert(
  ctx: Ctx,
  bidCode: string,
  opts: { startStatus?: "ACTIVE" | "PLANNING" } = {},
): Promise<CreatedProject> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/bids/${bidCode}/convert`,
    { data: { startStatus: opts.startStatus ?? "ACTIVE" } },
  );
  expect(res.status(), `convert bid failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedProject;
}

export interface ProjectFactoryOpts {
  name?: string;
  clientName?: string;
  status?: "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED";
  contractAmount?: string | number;
}

export async function createProject(
  ctx: Ctx,
  opts: ProjectFactoryOpts = {},
): Promise<CreatedProject> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await getRequest(ctx).post(`${BASE_URL}/api/projects`, {
    data: {
      name: opts.name ?? `E2E Project ${suffix}`,
      clientName: opts.clientName ?? "E2E Client",
      status: opts.status ?? "ACTIVE",
      ...(opts.contractAmount !== undefined
        ? { contractAmount: String(opts.contractAmount) }
        : {}),
    },
  });
  expect(res.status(), `createProject failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedProject;
}

export interface SOVLineItemSeed {
  lineNumber: number;
  description: string;
  scheduledValue: number | string;
  thisPeriodCompleted?: number | string;
  itemCode?: string;
}

export interface CreatedSOV {
  id: string;
  sovNumber: string;
  contractValue: string;
  status: string;
  projectId: string;
  organizationId: string;
}

export async function createSOV(
  ctx: Ctx,
  opts: {
    projectId: string;
    title?: string;
    contractValue: number;
    retainagePercent?: number;
    lineItems?: SOVLineItemSeed[];
  },
): Promise<CreatedSOV> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/sov`, {
    data: {
      projectId: opts.projectId,
      title: opts.title ?? `E2E SOV ${Date.now()}`,
      contractValue: String(opts.contractValue),
      retainagePercent: String(opts.retainagePercent ?? 10),
      lineItems: opts.lineItems ?? [
        {
          lineNumber: 1,
          description: "Mobilization",
          scheduledValue: opts.contractValue,
        },
      ],
    },
  });
  expect(res.status(), `createSOV failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedSOV;
}

export interface CreatedPayApp {
  id: string;
  applicationNumber: number;
  status: string;
  contractSumToDate: string;
  currentPaymentDue: string;
  netChangeByChangeOrders: string;
}

export async function createPayApp(
  ctx: Ctx,
  opts: { projectId: string; sovId: string; periodTo?: string },
): Promise<CreatedPayApp> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/aia-billing/pay-applications`,
    {
      data: {
        projectId: opts.projectId,
        sovId: opts.sovId,
        periodTo: opts.periodTo ?? new Date().toISOString().slice(0, 10),
        ownerName: "E2E Owner",
        contractorName: "E2E Contractor",
      },
    },
  );
  expect(res.status(), `createPayApp failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedPayApp;
}

export async function setPayAppStatus(
  ctx: Ctx,
  payAppId: string,
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "PAID",
  rejectionReason?: string,
): Promise<CreatedPayApp> {
  const res = await getRequest(ctx).patch(
    `${BASE_URL}/api/aia-billing/pay-applications/${payAppId}/status`,
    { data: { status, ...(rejectionReason ? { rejectionReason } : {}) } },
  );
  expect(res.status(), `setPayAppStatus(${status}) failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as CreatedPayApp;
}

export interface CreatedChangeOrder {
  id: string;
  changeOrderNumber: string;
  status: string;
  amount: string;
  projectId: string;
}

export async function createChangeOrder(
  ctx: Ctx,
  opts: {
    projectId: string;
    amount: number;
    description?: string;
    title?: string;
  },
): Promise<CreatedChangeOrder> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/change-orders`, {
    data: {
      projectId: opts.projectId,
      title: opts.title ?? "E2E CO",
      description: opts.description ?? "Added scope per RFI",
      amount: String(opts.amount),
      status: "DRAFT",
    },
  });
  expect(res.status(), `createChangeOrder failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedChangeOrder;
}

export async function submitChangeOrder(
  ctx: Ctx,
  coId: string,
): Promise<CreatedChangeOrder> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/change-orders/${coId}/submit`,
    { data: {} },
  );
  expect(res.status(), `submitChangeOrder failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as CreatedChangeOrder;
}

export interface ApproveChangeOrderResult {
  /** Final-approved (status === "APPROVED" in DB) when true. False when
   *  the workflow engine handed off to a multi-step chain (HTTP 202). */
  finalApproved: boolean;
  status: number;
  order?: CreatedChangeOrder;
}

export async function approveChangeOrder(
  ctx: Ctx,
  coId: string,
): Promise<ApproveChangeOrderResult> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/change-orders/${coId}/approve`,
    { data: {} },
  );
  // /approve returns 200 when it's the final step (DB row goes to
  // APPROVED) or 202 when more approvers are required. The seed has
  // no workflow chain so 200 is the expected default; we still let
  // callers branch deterministically on `finalApproved`.
  expect([200, 202]).toContain(res.status());
  if (res.status() === 200) {
    return { finalApproved: true, status: 200, order: (await res.json()) as CreatedChangeOrder };
  }
  return { finalApproved: false, status: 202 };
}

export interface ClockInResult {
  shift: { id: string; userId: string; clockIn: string };
}

export async function clockIn(
  ctx: Ctx,
  opts: {
    projectId?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    geofenceOverride?: boolean;
  } = {},
): Promise<ClockInResult["shift"]> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/time-clock/clock-in`, {
    data: {
      projectId: opts.projectId ?? null,
      latitude: opts.latitude ?? 40.0,
      longitude: opts.longitude ?? -74.0,
      accuracy: opts.accuracy ?? 10,
      geofenceOverride: opts.geofenceOverride ?? true,
      geofenceOverrideReason: "E2E test override",
    },
  });
  expect([200, 201]).toContain(res.status());
  const body = (await res.json()) as ClockInResult["shift"] & { shift?: ClockInResult["shift"] };
  return body.shift ?? body;
}

export async function clockOut(
  ctx: Ctx,
  opts: { latitude?: number; longitude?: number; accuracy?: number; geofenceOverride?: boolean } = {},
): Promise<{ id: string; clockOut: string }> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/time-clock/clock-out`, {
    data: {
      latitude: opts.latitude ?? 40.0,
      longitude: opts.longitude ?? -74.0,
      accuracy: opts.accuracy ?? 10,
      geofenceOverride: opts.geofenceOverride ?? true,
      geofenceOverrideReason: "E2E test override",
    },
  });
  expect(res.status(), `clockOut failed: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { shift?: { id: string; clockOut: string } } & { id?: string; clockOut?: string };
  return body.shift ?? (body as { id: string; clockOut: string });
}

export interface ApprovedShiftResult {
  shift: { id: string; approvalStatus: string };
  timeEntryId?: string | null;
}

export async function approveShift(
  ctx: Ctx,
  shiftId: string,
  opts: { createTimeEntry?: boolean } = {},
): Promise<ApprovedShiftResult> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/time-clock/shifts/${shiftId}/approve`,
    { data: { createTimeEntry: opts.createTimeEntry ?? false } },
  );
  expect(res.status(), `approveShift failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as ApprovedShiftResult;
}

export async function approveTimeEntry(ctx: Ctx, entryId: string): Promise<void> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/time-entries/${entryId}/approve`,
    { data: {} },
  );
  // 200 = approved, 202 = multi-step approval started.
  expect(
    [200, 202].includes(res.status()),
    `approveTimeEntry unexpected ${res.status()}: ${await res.text()}`,
  ).toBe(true);
}

export interface CreatedPayRun {
  id: string;
  status: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  totalGross?: string;
  workerCount?: number;
}

export async function createPayRun(
  ctx: Ctx,
  opts: { payPeriodStart: string; payPeriodEnd: string; notes?: string },
): Promise<CreatedPayRun> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/payroll/pay-runs`, {
    data: {
      payPeriodStart: opts.payPeriodStart,
      payPeriodEnd: opts.payPeriodEnd,
      notes: opts.notes ?? "E2E pay run",
    },
  });
  expect(res.status(), `createPayRun failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedPayRun;
}

// ---------------------------------------------------------------
// Procurement: PR -> PO -> Receipt -> Invoice -> 3-way match
// ---------------------------------------------------------------

export interface PrItemSeed {
  description: string;
  quantity: string | number;
  unit?: string;
  estimatedUnitCost: string | number;
  costCode?: string;
}

export interface CreatedPR {
  id: string;
  prNumber: string;
  status: string;
  totalEstimatedCost: string | null;
}

export async function createPurchaseRequest(
  ctx: Ctx,
  opts: { projectId: string; title?: string; items: PrItemSeed[] },
): Promise<CreatedPR> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/procurement-module/requests`, {
    data: {
      projectId: opts.projectId,
      title: opts.title ?? `E2E PR ${Date.now()}`,
      items: opts.items.map((i) => ({
        description: i.description,
        quantity: String(i.quantity),
        unit: i.unit ?? "EA",
        estimatedUnitCost: String(i.estimatedUnitCost),
        ...(i.costCode ? { costCode: i.costCode } : {}),
      })),
    },
  });
  expect(res.status(), `createPurchaseRequest failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedPR;
}

export async function submitPurchaseRequest(ctx: Ctx, prId: string): Promise<void> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/requests/${prId}/submit`,
  );
  expect(res.status(), `submitPurchaseRequest failed: ${await res.text()}`).toBe(200);
}

export async function approvePurchaseRequest(ctx: Ctx, prId: string): Promise<void> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/requests/${prId}/approve`,
  );
  expect(res.status(), `approvePurchaseRequest failed: ${await res.text()}`).toBe(200);
}

export interface CreatedPO {
  id: string;
  poNumber: string;
  status: string;
  totalCost: string | null;
  prId?: string | null;
}

export async function convertPrToPo(ctx: Ctx, prId: string): Promise<CreatedPO> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/requests/${prId}/convert-to-po`,
    { data: {} },
  );
  expect(res.status(), `convertPrToPo failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedPO;
}

export interface CreatedReceipt {
  id: string;
  poId: string;
}

export async function receivePO(
  ctx: Ctx,
  poId: string,
  opts: { receivedDate?: string; notes?: string } = {},
): Promise<CreatedReceipt> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/orders/${poId}/receipts`,
    {
      data: {
        receivedDate: opts.receivedDate ?? new Date().toISOString().slice(0, 10),
        notes: opts.notes ?? "E2E receipt",
      },
    },
  );
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  return (body.receipt ?? body) as CreatedReceipt;
}

export interface CreatedVendorInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: string;
}

export async function createVendorInvoice(
  ctx: Ctx,
  opts: {
    poId: string;
    totalAmount: number | string;
    invoiceNumber?: string;
    invoiceDate?: string;
    items?: Array<{ description: string; quantity: number | string; unitCost: number | string }>;
  },
): Promise<CreatedVendorInvoice> {
  const res = await getRequest(ctx).post(`${BASE_URL}/api/procurement-module/invoices`, {
    data: {
      poId: opts.poId,
      invoiceNumber: opts.invoiceNumber ?? `INV-${Date.now()}`,
      invoiceDate: opts.invoiceDate ?? new Date().toISOString().slice(0, 10),
      totalAmount: String(opts.totalAmount),
      ...(opts.items
        ? {
            items: opts.items.map((i) => ({
              description: i.description,
              quantity: String(i.quantity),
              unitCost: String(i.unitCost),
            })),
          }
        : {}),
    },
  });
  expect(res.status(), `createVendorInvoice failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as CreatedVendorInvoice;
}

export interface ThreeWayMatchResult {
  matchStatus: "MATCHED" | "DISCREPANCY" | "PARTIAL" | string;
  poAmount?: string | null;
  invoiceAmount?: string | null;
  receivedQtyMatchPct?: string | null;
}

export async function runThreeWayMatch(
  ctx: Ctx,
  invoiceId: string,
): Promise<ThreeWayMatchResult> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/invoices/${invoiceId}/match`,
    { data: {} },
  );
  expect(res.status(), `runThreeWayMatch failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as ThreeWayMatchResult;
}

export interface RecordedInvoicePayment {
  payment: { id: string; amount: string };
  totalPaid: string;
}

export async function recordInvoicePayment(
  ctx: Ctx,
  invoiceId: string,
  opts: { amount: number; paymentDate?: string; method?: string; referenceNumber?: string },
): Promise<RecordedInvoicePayment> {
  const res = await getRequest(ctx).post(
    `${BASE_URL}/api/procurement-module/invoices/${invoiceId}/payments`,
    {
      data: {
        amount: String(opts.amount),
        paymentDate: opts.paymentDate ?? new Date().toISOString().slice(0, 10),
        method: opts.method ?? "ACH",
        referenceNumber: opts.referenceNumber ?? `E2E-${Date.now()}`,
      },
    },
  );
  expect(res.status(), `recordInvoicePayment failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as RecordedInvoicePayment;
}
