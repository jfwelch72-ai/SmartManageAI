/**
 * API-level tenant isolation negative cases.
 *
 * Where `server/__tests__/tenant-rls.test.ts` covers the database
 * layer (RLS policies + dbContext), this spec exercises the same
 * invariants against the live HTTP API: an authenticated session in
 * Org A must NEVER be able to read or mutate an entity owned by
 * Org B, even when it knows that entity's primary-key UUID.
 *
 * Notes on org topology under the dev seed:
 *  - The default `Dev Sandbox Organization` is the canonical Org A;
 *    every `devLogin(role)` call links the user to it.
 *  - `POST /api/dev/fresh-admin-login` produces an unrelated, fully
 *    isolated org-with-admin pair we use as Org B. That endpoint
 *    sets the auth cookie on the request context it was called on,
 *    so we drive Org B from a dedicated APIRequestContext.
 */
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { installCsrf, installCsrfOnRequest } from "./helpers/csrf";
import { devLogin } from "./helpers/auth";
import {
  approvePurchaseRequest,
  approveShift,
  approveTimeEntry,
  awardBidAndConvert,
  clockIn,
  clockOut,
  convertPrToPo,
  createBid,
  createChangeOrder,
  createPayApp,
  createPayRun,
  createProject,
  createPurchaseRequest,
  createSOV,
  createVendorInvoice,
  receivePO,
  recordInvoicePayment,
  runThreeWayMatch,
  submitPurchaseRequest,
} from "./helpers/factories";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface FreshAdminResponse {
  user: { id: string; email: string; organizationId: string };
}

async function freshAdmin(request: APIRequestContext): Promise<FreshAdminResponse> {
  // Patch CSRF onto the request context BEFORE the first mutation
  // so the negative-write assertions below can never pass for a CSRF
  // reason; they must fail because Org B genuinely has no access.
  await installCsrfOnRequest(request);
  const res = await request.post(`${BASE_URL}/api/dev/fresh-admin-login`);
  expect(res.status(), `fresh-admin-login failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as FreshAdminResponse;
}

test.describe("Tenant isolation: Org A entities are invisible / immutable to Org B", () => {
  test("bid, project, SOV, pay app, and change order are all 404 for the other org", async ({
    page,
    browser,
  }) => {
    // Org A — Dev Sandbox.
    await installCsrf(page);
    await devLogin(page, "ADMIN");

    const bidA = await createBid(page, { bidAmount: 75_000 });
    const projectA = await awardBidAndConvert(page, bidA.code);
    const sovA = await createSOV(page, { projectId: projectA.id, contractValue: 75_000 });
    const payAppA = await createPayApp(page, { projectId: projectA.id, sovId: sovA.id });
    const coA = await createChangeOrder(page, { projectId: projectA.id, amount: 5_000 });

    // Org B — fresh admin in its own context (= its own cookie jar).
    const orgBCtx = await browser.newContext();
    try {
      await freshAdmin(orgBCtx.request);

      // GET single bid by code.
      const bidGet = await orgBCtx.request.get(`${BASE_URL}/api/bids/${bidA.code}`);
      expect([403, 404]).toContain(bidGet.status());

      // GET single project by code.
      const projGet = await orgBCtx.request.get(`${BASE_URL}/api/projects/${projectA.code}`);
      expect([403, 404]).toContain(projGet.status());

      // GET SOV by id (and by project).
      const sovGet = await orgBCtx.request.get(`${BASE_URL}/api/sov/${sovA.id}`);
      expect([403, 404]).toContain(sovGet.status());
      const sovByProj = await orgBCtx.request.get(
        `${BASE_URL}/api/projects/${projectA.id}/sov`,
      );
      expect([403, 404]).toContain(sovByProj.status());

      // Mutating Org A's SOV from Org B must be denied with an authz status.
      const sovMutate = await orgBCtx.request.patch(`${BASE_URL}/api/sov/${sovA.id}`, {
        data: { contractValue: 1 },
      });
      expect([403, 404]).toContain(sovMutate.status());

      // GET pay application by id.
      const payGet = await orgBCtx.request.get(
        `${BASE_URL}/api/aia-billing/pay-applications/${payAppA.id}`,
      );
      expect([403, 404]).toContain(payGet.status());

      // GET change order by id.
      const coGet = await orgBCtx.request.get(`${BASE_URL}/api/change-orders/${coA.id}`);
      expect([403, 404]).toContain(coGet.status());

      // Mutating attempts must fail with an authz status (403/404).
      // 400 is excluded so a CSRF-shaped failure can't quietly pass
      // for the wrong reason — CSRF is installed on the Org B context
      // by `freshAdmin()` above, so any 400 here would be a true
      // validation error, not an auth check.
      const coApprove = await orgBCtx.request.post(
        `${BASE_URL}/api/change-orders/${coA.id}/approve`,
        { data: {} },
      );
      expect([403, 404]).toContain(coApprove.status());

      const payApprove = await orgBCtx.request.patch(
        `${BASE_URL}/api/aia-billing/pay-applications/${payAppA.id}/status`,
        { data: { status: "APPROVED" } },
      );
      expect([403, 404]).toContain(payApprove.status());

      // Listing endpoints must NOT enumerate Org A's records.
      const bidsList = await orgBCtx.request.get(`${BASE_URL}/api/bids`);
      expect(bidsList.status()).toBe(200);
      const bidsBody = await bidsList.json();
      const bidIds = (Array.isArray(bidsBody) ? bidsBody : bidsBody.bids ?? []).map(
        (b: { id: string }) => b.id,
      );
      expect(bidIds).not.toContain(bidA.id);

      const projList = await orgBCtx.request.get(`${BASE_URL}/api/projects`);
      expect(projList.status()).toBe(200);
      const projBody = await projList.json();
      const projIds = (Array.isArray(projBody) ? projBody : projBody.projects ?? []).map(
        (p: { id: string }) => p.id,
      );
      expect(projIds).not.toContain(projectA.id);
    } finally {
      await orgBCtx.close();
    }
  });

  // ----------------------------------------------------------------
  // Procurement (PR / PO / receipt / vendor invoice / payment),
  // time-clock shifts, payroll pay-runs (incl. WH-347 PDF), and AIA
  // pay-application PDFs (G702 / G703).
  //
  // Same Org-A-builds / Org-B-probes pattern as the headline test
  // above — extended to every money-path GET, mutation, and download
  // we surface so a future route that drops `getOrgIdForFilter`
  // can't quietly leak rows across tenants. List endpoints are
  // double-checked to NOT enumerate Org A's records.
  // ----------------------------------------------------------------
  test("procurement, time-clock, payroll, and AIA PDFs are all denied to the other org", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);

    // --- Org A: build a money-path chain ---------------------------
    await installCsrf(page);
    await devLogin(page, "ADMIN");

    const projectA = await createProject(page, { contractAmount: 100_000 });
    const sovA = await createSOV(page, { projectId: projectA.id, contractValue: 100_000 });
    const payAppA = await createPayApp(page, { projectId: projectA.id, sovId: sovA.id });

    // Procurement: PR -> approve -> PO -> receipt -> invoice -> match -> payment.
    const prItems = [
      { description: "Concrete bags", quantity: 10, unit: "EA", estimatedUnitCost: 100 },
    ];
    const prA = await createPurchaseRequest(page, { projectId: projectA.id, items: prItems });
    await submitPurchaseRequest(page, prA.id);
    await approvePurchaseRequest(page, prA.id);
    const poA = await convertPrToPo(page, prA.id);
    const receiptA = await receivePO(page, poA.id);
    const invoiceA = await createVendorInvoice(page, {
      poId: poA.id,
      totalAmount: 1_000,
      items: [{ description: "Concrete bags", quantity: 10, unitCost: 100 }],
    });
    await runThreeWayMatch(page, invoiceA.id);
    await recordInvoicePayment(page, invoiceA.id, { amount: 500 });

    // Billing event: needs a scope item under the project. Created
    // here so we can assert Org B can neither list nor probe it.
    const scopeRes = await page.request.post(
      `${BASE_URL}/api/projects/${projectA.code}/scope`,
      {
        data: {
          description: "E2E billing scope item",
          unit: "EA",
          totalQuantity: "10",
          unitPrice: "100",
        },
      },
    );
    expect(scopeRes.status(), `create scope item failed: ${await scopeRes.text()}`).toBe(201);
    const scopeItemA = (await scopeRes.json()) as { id: string };

    const billingEventRes = await page.request.post(`${BASE_URL}/api/billing-events`, {
      data: {
        scopeItemId: scopeItemA.id,
        quantity: "1",
        unitPrice: "100",
        totalAmount: "100",
        billedDate: new Date().toISOString(),
        paymentStatus: "pending",
      },
    });
    expect(billingEventRes.status(), `create billing event failed: ${await billingEventRes.text()}`).toBe(201);
    const billingEventA = (await billingEventRes.json()) as { id: string };

    // Time-clock shift created by an Org A worker (separate context
    // so the worker session doesn't clobber the admin cookies).
    const workerCtx = await browser.newContext();
    const workerPage = await workerCtx.newPage();
    await installCsrf(workerPage);
    await devLogin(workerPage, "FIELD_WORKER");
    const shiftA = await clockIn(workerPage, { projectId: projectA.id });
    await clockOut(workerPage);

    // Approve the shift (and create a time entry) so the pay-run
    // creation below is deterministic — without an APPROVED entry
    // the pay-run endpoint returns 400 "No approved time entries
    // found" and we'd lose all payroll-leg coverage.
    const approved = await approveShift(page, shiftA.id, { createTimeEntry: true });
    if (approved.timeEntryId) {
      await approveTimeEntry(page, approved.timeEntryId);
    }

    // Pay run covering today (exercises the WH-347 PDF + delete
    // routes from Org B's perspective).
    const today = new Date().toISOString().slice(0, 10);
    const payRunA = await createPayRun(page, {
      payPeriodStart: today,
      payPeriodEnd: today,
    });

    // --- Org B: probe every endpoint -------------------------------
    const orgBCtx = await browser.newContext();
    try {
      await freshAdmin(orgBCtx.request);

      const expectDenied = (res: APIResponse, label: string) => {
        expect([403, 404], `${label} returned ${res.status()}`).toContain(res.status());
      };
      const collectIds = (row: unknown): string[] => {
        // Pull every plausible id out of a list row: top-level `id`
        // plus any nested entity (e.g. billing-events list returns
        // rows shaped { billingEvent: {...}, scopeItem: {...} }).
        if (!row || typeof row !== "object") return [];
        const r = row as Record<string, unknown>;
        const ids: string[] = [];
        if (typeof r.id === "string") ids.push(r.id);
        for (const v of Object.values(r)) {
          if (v && typeof v === "object") {
            const inner = (v as Record<string, unknown>).id;
            if (typeof inner === "string") ids.push(inner);
          }
        }
        return ids;
      };
      const expectListExcludes = async (
        res: APIResponse,
        excludedId: string,
        label: string,
      ) => {
        // List endpoints may return 200+empty, 403 (no feature/role),
        // or even 404 in some edge cases. Whatever they return, they
        // must NOT enumerate Org A's row.
        if (res.status() !== 200) {
          expect([403, 404], `${label} returned ${res.status()}`).toContain(res.status());
          return;
        }
        const body = await res.json();
        const rows = Array.isArray(body)
          ? body
          : body.items ?? body.requests ?? body.orders ?? body.invoices ?? body.payRuns ?? body.receipts ?? body.billingEvents ?? [];
        const ids = (rows as unknown[]).flatMap(collectIds);
        expect(ids, `${label} leaked Org A row`).not.toContain(excludedId);
      };

      // ---- Table-driven endpoint matrix -------------------------
      // Each row is one money-path endpoint that Org B must NOT be
      // able to touch given an Org A entity ID. Adding a new
      // endpoint is a one-line append. `kind: "denied"` asserts a
      // 403/404 response; `kind: "list"` asserts the response (when
      // 200) does not enumerate `excludeId`.
      type Method = "GET" | "POST" | "PATCH" | "DELETE";
      type Case =
        | {
            kind: "denied";
            label: string;
            method: Method;
            path: string;
            data?: unknown;
          }
        | {
            kind: "list";
            label: string;
            path: string;
            excludeId: string;
          };

      const sendBody = { reason: "nope", rejectionNotes: "nope" };
      const cases: Case[] = [
        // Procurement: Purchase Requests
        { kind: "list", label: "PR list", path: "/api/procurement-module/requests", excludeId: prA.id },
        { kind: "denied", label: "PR patch", method: "PATCH", path: `/api/procurement-module/requests/${prA.id}`, data: { title: "hijacked" } },
        { kind: "denied", label: "PR delete", method: "DELETE", path: `/api/procurement-module/requests/${prA.id}` },
        { kind: "denied", label: "PR submit", method: "POST", path: `/api/procurement-module/requests/${prA.id}/submit`, data: {} },
        { kind: "denied", label: "PR approve", method: "POST", path: `/api/procurement-module/requests/${prA.id}/approve`, data: {} },
        { kind: "denied", label: "PR reject", method: "POST", path: `/api/procurement-module/requests/${prA.id}/reject`, data: sendBody },
        { kind: "denied", label: "PR convert", method: "POST", path: `/api/procurement-module/requests/${prA.id}/convert-to-po`, data: {} },

        // Procurement: Purchase Orders
        { kind: "list", label: "PO list", path: "/api/procurement-module/orders", excludeId: poA.id },
        { kind: "denied", label: "PO get", method: "GET", path: `/api/procurement-module/orders/${poA.id}` },
        { kind: "denied", label: "PO patch", method: "PATCH", path: `/api/procurement-module/orders/${poA.id}`, data: { notes: "hijacked" } },
        { kind: "denied", label: "PO delete", method: "DELETE", path: `/api/procurement-module/orders/${poA.id}` },
        { kind: "denied", label: "PO submit", method: "POST", path: `/api/procurement-module/orders/${poA.id}/submit`, data: {} },
        { kind: "denied", label: "PO approve", method: "POST", path: `/api/procurement-module/orders/${poA.id}/approve`, data: {} },
        { kind: "denied", label: "PO reject", method: "POST", path: `/api/procurement-module/orders/${poA.id}/reject`, data: sendBody },
        { kind: "denied", label: "PO send", method: "POST", path: `/api/procurement-module/orders/${poA.id}/send`, data: {} },

        // Procurement: Receipts
        { kind: "list", label: "Receipts global list", path: "/api/procurement-module/receipts", excludeId: receiptA.id },
        { kind: "denied", label: "Receipts list (by PO)", method: "GET", path: `/api/procurement-module/orders/${poA.id}/receipts` },
        { kind: "denied", label: "Receipt create", method: "POST", path: `/api/procurement-module/orders/${poA.id}/receipts`, data: { items: [] } },

        // Procurement: Vendor Invoices
        { kind: "list", label: "Invoice list", path: "/api/procurement-module/invoices", excludeId: invoiceA.id },
        { kind: "denied", label: "Invoice patch", method: "PATCH", path: `/api/procurement-module/invoices/${invoiceA.id}`, data: { notes: "hijacked" } },
        { kind: "denied", label: "Invoice file-url", method: "GET", path: `/api/procurement-module/invoices/${invoiceA.id}/file-url` },
        { kind: "denied", label: "Invoice match GET", method: "GET", path: `/api/procurement-module/invoices/${invoiceA.id}/match` },
        { kind: "denied", label: "Invoice match POST", method: "POST", path: `/api/procurement-module/invoices/${invoiceA.id}/match`, data: {} },
        { kind: "denied", label: "Invoice payments GET", method: "GET", path: `/api/procurement-module/invoices/${invoiceA.id}/payments` },
        { kind: "denied", label: "Invoice payment POST", method: "POST", path: `/api/procurement-module/invoices/${invoiceA.id}/payments`, data: { amount: "1", paymentDate: today } },

        // Time-clock shifts
        { kind: "denied", label: "Shift approve", method: "POST", path: `/api/time-clock/shifts/${shiftA.id}/approve`, data: {} },
        { kind: "denied", label: "Shift reject", method: "POST", path: `/api/time-clock/shifts/${shiftA.id}/reject`, data: sendBody },
        { kind: "denied", label: "Shift adjust", method: "POST", path: `/api/time-clock/shifts/${shiftA.id}/adjust`, data: sendBody },
        { kind: "denied", label: "Shift admin-clock-out", method: "POST", path: `/api/time-clock/shift/${shiftA.id}/admin-clock-out`, data: sendBody },

        // Payroll
        { kind: "list", label: "Pay-run list", path: "/api/payroll/pay-runs", excludeId: payRunA.id },
        { kind: "denied", label: "Pay-run get", method: "GET", path: `/api/payroll/pay-runs/${payRunA.id}` },
        { kind: "denied", label: "Pay-run stubs", method: "GET", path: `/api/payroll/pay-runs/${payRunA.id}/pay-stubs` },
        { kind: "denied", label: "WH-347 PDF", method: "GET", path: `/api/payroll/pay-runs/${payRunA.id}/certified-payroll-pdf` },
        { kind: "denied", label: "Pay-run delete", method: "DELETE", path: `/api/payroll/pay-runs/${payRunA.id}` },

        // Billing events
        { kind: "list", label: "Billing events list (by project)", path: `/api/projects/${projectA.id}/billing-events`, excludeId: billingEventA.id },
        {
          kind: "denied",
          label: "Billing event create (cross-tenant scope item)",
          method: "POST",
          path: "/api/billing-events",
          data: {
            scopeItemId: scopeItemA.id,
            quantity: "1",
            unitPrice: "100",
            totalAmount: "100",
            billedDate: new Date().toISOString(),
            paymentStatus: "pending",
          },
        },

        // AIA pay-application PDFs + payment
        { kind: "denied", label: "G702 PDF", method: "GET", path: `/api/aia-billing/pay-applications/${payAppA.id}/g702-pdf` },
        { kind: "denied", label: "G703 PDF", method: "GET", path: `/api/aia-billing/pay-applications/${payAppA.id}/g703-pdf` },
        { kind: "denied", label: "Pay-app record-payment", method: "POST", path: `/api/aia-billing/pay-applications/${payAppA.id}/record-payment`, data: { amount: "1", paymentDate: today } },
      ];

      const dispatch = async (c: Case): Promise<APIResponse> => {
        const url = `${BASE_URL}${c.kind === "list" ? c.path : c.path}`;
        if (c.kind === "list") return orgBCtx.request.get(url);
        switch (c.method) {
          case "GET":
            return orgBCtx.request.get(url);
          case "POST":
            return orgBCtx.request.post(url, { data: c.data ?? {} });
          case "PATCH":
            return orgBCtx.request.patch(url, { data: c.data ?? {} });
          case "DELETE":
            return orgBCtx.request.delete(url);
        }
      };

      // Surface every leak in one run instead of bailing on first
      // failure — useful when extending coverage later.
      const failures: string[] = [];
      for (const c of cases) {
        const res = await dispatch(c);
        try {
          if (c.kind === "denied") {
            expectDenied(res, c.label);
          } else {
            await expectListExcludes(res, c.excludeId, c.label);
          }
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      expect(failures, `tenant-isolation regressions:\n${failures.join("\n")}`).toEqual([]);
    } finally {
      await orgBCtx.close();
      await workerCtx.close();
    }
  });
});
