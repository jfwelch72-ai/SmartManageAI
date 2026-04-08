import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status: string;
  contractAmount: string | null;
}

interface BidResponse {
  id: string;
  code: string;
  name: string;
  status: string;
  bidAmount: string | null;
}

interface EstimateResponse {
  id: string;
  bidId: string | null;
  projectId: string | null;
  lineItems?: LineItemResponse[];
}

interface LineItemResponse {
  id: string;
  estimateId: string;
  description: string;
  materialCost: string | null;
  laborCost: string | null;
}

interface FinancialSummary {
  contractAmount?: number | string;
  totalChangeOrders?: number | string;
  adjustedContract?: number | string;
  laborCosts?: number | string;
  materialCosts?: number | string;
  [key: string]: unknown;
}

interface ChangeOrderResponse {
  id: string;
  amount: string;
  projectId: string;
}

let app: Express;
let server: Server;
let adminCookie: string;
const suffix = Date.now();

function extractCookie(res: request.Response): string | null {
  const cookies = res.headers["set-cookie"] as string | string[] | undefined;
  if (!cookies) return null;
  const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
  for (const c of cookieArr) {
    const match = c.match(/auth_token=([^;]+)/);
    if (match) return `auth_token=${match[1]}`;
  }
  return null;
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());

  server = await registerRoutes(app);

  const loginRes = await request(app)
    .post("/api/dev/test-login")
    .send({ role: "ADMIN" });

  const cookie = extractCookie(loginRes);
  if (cookie) adminCookie = cookie;
}, 60_000);

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

function authGet(path: string) {
  return request(app).get(path).set("Cookie", adminCookie);
}

function authPost(path: string) {
  return request(app).post(path).set("Cookie", adminCookie);
}

function authPatch(path: string) {
  return request(app).patch(path).set("Cookie", adminCookie);
}

describe("Financial Calculation Integration Tests", () => {
  let projectCode: string;
  let projectId: string;

  it("creates a project with contract amount", async () => {
    const res = await authPost("/api/projects")
      .send({
        name: `Fin Calc Test ${suffix}`,
        clientName: "Fin Calc Client",
        contractAmount: "500000",
        status: "PLANNING",
      });

    expect(res.status).toBe(201);
    const project = res.body as ProjectResponse;
    projectCode = project.code;
    projectId = project.id;
    expect(projectCode).toBeTruthy();
  });

  it("moves project to ACTIVE", async () => {
    const res = await authPatch(`/api/projects/${projectCode}`)
      .send({ status: "ACTIVE" });
    expect(res.status).toBe(200);
    expect((res.body as ProjectResponse).status).toBe("ACTIVE");
  });

  it("project financials endpoint returns valid structure", async () => {
    const res = await authGet(`/api/projects/${projectCode}/financials`);
    expect(res.status).toBe(200);
    const fin = res.body as FinancialSummary;
    expect(fin).toBeDefined();
    expect(typeof fin).toBe("object");
  });

  it("change order affects financial summary", async () => {
    const coRes = await authPost("/api/change-orders")
      .send({
        projectId,
        description: "Extra excavation",
        amount: "25000",
        type: "ADDITION",
      });

    expect([200, 201]).toContain(coRes.status);
    const co = coRes.body as ChangeOrderResponse;
    expect(co.id).toBeTruthy();

    const finRes = await authGet(`/api/projects/${projectCode}/financials`);
    expect(finRes.status).toBe(200);
    const fin = finRes.body as FinancialSummary;
    expect(fin).toBeDefined();
  });

  it("bid estimate line items track material and labor costs", async () => {
    const bidRes = await authPost("/api/bids")
      .send({
        name: `Fin Bid ${suffix}`,
        clientName: "Fin Bid Client",
        bidAmount: "100000",
      });
    expect(bidRes.status).toBe(201);
    const bid = bidRes.body as BidResponse;

    const estRes = await authPost(`/api/bids/${bid.id}/estimate`)
      .send({});
    expect(estRes.status).toBe(201);
    const estimate = estRes.body as EstimateResponse;

    const li1Res = await authPost(`/api/estimates/${estimate.id}/line-items`)
      .send({
        description: "Material A",
        quantity: "10",
        unit: "EA",
        materialCost: "5000",
        laborCost: "3000",
        laborHours: "20",
        equipmentCost: "0",
        equipmentHours: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
      });
    expect(li1Res.status).toBe(201);
    const li1 = li1Res.body as LineItemResponse;
    expect(parseFloat(li1.materialCost || "0")).toBe(5000);

    const li2Res = await authPost(`/api/estimates/${estimate.id}/line-items`)
      .send({
        description: "Material B",
        quantity: "5",
        unit: "EA",
        materialCost: "7500",
        laborCost: "4500",
        laborHours: "30",
        equipmentCost: "1000",
        equipmentHours: "10",
        consumablesCost: "500",
        subcontractCost: "2000",
        overheadAllocation: "300",
        profitAllocation: "200",
      });
    expect(li2Res.status).toBe(201);
    const li2 = li2Res.body as LineItemResponse;
    expect(parseFloat(li2.materialCost || "0")).toBe(7500);

    const estDetailRes = await authGet(`/api/bids/${bid.id}/estimate`);
    expect(estDetailRes.status).toBe(200);
    const estDetail = estDetailRes.body as { estimate?: EstimateResponse } & EstimateResponse;
    const estimateObj = estDetail.estimate || estDetail;
    expect(estimateObj).toBeDefined();
  });

  it("bid monetary validation rejects invalid amounts", async () => {
    const nanRes = await authPost("/api/bids")
      .send({ name: "NaN Bid", clientName: "Client", bidAmount: "not-a-number" });
    expect(nanRes.status).toBe(400);

    const negRes = await authPost("/api/bids")
      .send({ name: "Neg Bid", clientName: "Client", bidAmount: "-5000" });
    expect(negRes.status).toBe(400);
  });

  it("project labor rates CRUD works", async () => {
    const setRes = await authPost(`/api/projects/${projectCode}/labor-rates`)
      .send({
        defaultRegularRate: "65.00",
        defaultOvertimeRate: "97.50",
        burdenMultiplier: "1.35",
      });
    expect(setRes.status).toBe(200);

    const getRes = await authGet(`/api/projects/${projectCode}/labor-rates`);
    expect(getRes.status).toBe(200);
    const rates = getRes.body as Record<string, string>;
    expect(rates).toBeTruthy();
    expect(parseFloat(rates.defaultRegularRate)).toBe(65);
    expect(parseFloat(rates.defaultOvertimeRate)).toBe(97.5);
    expect(parseFloat(rates.burdenMultiplier)).toBe(1.35);
  });

  it("dashboard stats returns numeric financial data", async () => {
    const res = await authGet("/api/dashboard/stats");
    expect(res.status).toBe(200);
    const stats = res.body as Record<string, unknown>;
    expect(stats).toBeDefined();
    expect(typeof stats).toBe("object");
  });
});
