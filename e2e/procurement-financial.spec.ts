import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface PurchaseRequest {
  id: string;
  title: string;
  status: string;
}

interface PurchaseOrder {
  id: string;
  status: string;
}

interface ProcurementSummary {
  totalRequests?: number;
  totalOrders?: number;
  [key: string]: unknown;
}

interface FinancialResponse {
  contractAmount?: string | number;
  [key: string]: unknown;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

test.describe("Procurement & Financial E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("full PR → PO → Receipt flow", async ({ page }) => {
    const suffix = Date.now();

    const projRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Proc ${suffix}`, clientName: "Proc Client", status: "PLANNING" },
    });
    expect(projRes.status()).toBe(201);
    const project = (await projRes.json()) as ProjectResponse;

    await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });

    const prRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests`, {
      data: {
        projectId: project.id,
        title: `PW Purchase Request ${suffix}`,
        notes: "Test procurement request",
        items: [
          { description: "Concrete bags", quantity: "50", unit: "EA", estimatedUnitCost: "12.50" },
          { description: "Rebar #5", quantity: "100", unit: "LF", estimatedUnitCost: "3.75" },
        ],
      },
    });
    expect(prRes.status()).toBe(201);
    const pr = (await prRes.json()) as PurchaseRequest;
    expect(pr.id).toBeTruthy();

    const submitRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests/${pr.id}/submit`);
    expect(submitRes.status()).toBe(200);

    const approveRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests/${pr.id}/approve`);
    expect(approveRes.status()).toBe(200);

    const convertRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests/${pr.id}/convert-to-po`);
    expect(convertRes.status()).toBe(201);
    const po = (await convertRes.json()) as PurchaseOrder;
    expect(po.id).toBeTruthy();

    const poDetailRes = await page.request.get(`${BASE_URL}/api/procurement-module/orders/${po.id}`);
    expect(poDetailRes.status()).toBe(200);

    const receiptRes = await page.request.post(`${BASE_URL}/api/procurement-module/orders/${po.id}/receipts`, {
      data: {
        receivedDate: new Date().toISOString().split("T")[0],
        notes: "Partial delivery received",
      },
    });
    expect([200, 201]).toContain(receiptRes.status());

    const receiptsListRes = await page.request.get(`${BASE_URL}/api/procurement-module/orders/${po.id}/receipts`);
    expect(receiptsListRes.status()).toBe(200);
  });

  test("PR cannot be approved without being submitted", async ({ page }) => {
    const suffix = Date.now();

    const projRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW PRFlow ${suffix}`, clientName: "PRFlow Client", status: "PLANNING" },
    });
    expect(projRes.status()).toBe(201);
    const project = (await projRes.json()) as ProjectResponse;
    await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });

    const prRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests`, {
      data: {
        projectId: project.id,
        title: `PW Draft PR ${suffix}`,
      },
    });
    expect(prRes.status()).toBe(201);
    const pr = (await prRes.json()) as PurchaseRequest;

    const approveRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests/${pr.id}/approve`);
    expect(approveRes.status()).toBe(400);
  });

  test("procurement summary returns stats", async ({ page }) => {
    const summaryRes = await page.request.get(`${BASE_URL}/api/procurement-module/summary`);
    expect(summaryRes.status()).toBe(200);
    const summary = (await summaryRes.json()) as ProcurementSummary;
    expect(summary).toBeDefined();
    expect(typeof summary).toBe("object");
  });

  test("purchase order list endpoint works", async ({ page }) => {
    const ordersRes = await page.request.get(`${BASE_URL}/api/procurement-module/orders`);
    expect(ordersRes.status()).toBe(200);
    const orders = await ordersRes.json();
    expect(Array.isArray(orders)).toBe(true);
  });

  test("change order creation and budget impact", async ({ page }) => {
    const suffix = Date.now();

    const projRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: {
        name: `PW CO ${suffix}`,
        clientName: "CO Client",
        contractAmount: "500000",
        status: "PLANNING",
      },
    });
    expect(projRes.status()).toBe(201);
    const project = (await projRes.json()) as ProjectResponse;
    await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });

    const coRes = await page.request.post(`${BASE_URL}/api/change-orders`, {
      data: {
        projectId: project.id,
        description: "Additional foundation work",
        amount: "25000",
        type: "ADDITION",
      },
    });
    expect([200, 201]).toContain(coRes.status());

    const finRes = await page.request.get(`${BASE_URL}/api/projects/${project.code}/financials`);
    expect(finRes.status()).toBe(200);
    const fin = (await finRes.json()) as FinancialResponse;
    expect(fin).toBeDefined();
  });

  test("FIELD_WORKER cannot create purchase requests (403)", async ({ page }) => {
    const suffix = Date.now();

    const projRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW FW Proc ${suffix}`, clientName: "FW Client", status: "PLANNING" },
    });
    expect(projRes.status()).toBe(201);
    const project = (await projRes.json()) as ProjectResponse;
    await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });

    await devLogin(page, "FIELD_WORKER");

    const prRes = await page.request.post(`${BASE_URL}/api/procurement-module/requests`, {
      data: {
        projectId: project.id,
        title: `FW PR ${suffix}`,
      },
    });
    expect(prRes.status()).toBe(403);
  });
});
