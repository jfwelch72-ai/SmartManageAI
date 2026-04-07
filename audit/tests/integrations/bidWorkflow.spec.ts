import { describe, it, expect } from "vitest";

const BASE_URL = (process.env.BASE_URL && process.env.BASE_URL.startsWith("http")) ? process.env.BASE_URL : `http://localhost:${process.env.PORT || 5000}`;

async function apiRequest(method: string, path: string, body?: any, cookies?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cookies) headers["Cookie"] = cookies;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const json = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  return { status: res.status, json, setCookie: setCookie || cookies || "" };
}

async function login(role: string) {
  const { json, setCookie } = await apiRequest("POST", "/api/dev/test-login", { role });
  return { user: json?.user, cookies: setCookie };
}

describe("Bid Workflow E2E", () => {
  let adminCookies = "";
  let estimatorCookies = "";
  let bidCode = "";
  let bidCode2 = "";
  let bidCode3 = "";
  let bidCode4 = "";
  let convertedProjectId = "";
  const uniqueSuffix = Date.now();

  it("should login as ADMIN", async () => {
    const { user, cookies } = await login("ADMIN");
    adminCookies = cookies;
    expect(user?.role).toBe("ADMIN");
  });

  describe("Bid CRUD", () => {
    it("should create a new bid with required fields", async () => {
      const { status, json } = await apiRequest("POST", "/api/bids", {
        name: `E2E Bid ${uniqueSuffix}`,
        clientName: "E2E Test Client",
        clientContactEmail: "e2e@test.com",
        bidAmount: "50000",
        description: "Bid workflow test",
      }, adminCookies);
      expect(status).toBe(201);
      expect(json.status).toBe("DRAFT");
      expect(json.code).toBeTruthy();
      bidCode = json.code;
    });

    it("should edit bid details via PATCH", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        name: `E2E Bid Updated ${uniqueSuffix}`,
        clientName: "Updated Client",
        bidAmount: "75000",
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.name).toBe(`E2E Bid Updated ${uniqueSuffix}`);
      expect(json.clientName).toBe("Updated Client");
    });

    it("should fetch bid by code via GET", async () => {
      const { status, json } = await apiRequest("GET", `/api/bids/${bidCode}`, undefined, adminCookies);
      expect(status).toBe(200);
      expect(json.code).toBe(bidCode);
      expect(json.name).toBe(`E2E Bid Updated ${uniqueSuffix}`);
    });
  });

  describe("PATCH Allowlist Enforcement", () => {
    it("should silently ignore sensitive fields (convertedToProjectId, awardedAt, submittedAt)", async () => {
      const { status } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        convertedToProjectId: "fake-id",
        awardedAt: "2025-01-01T00:00:00Z",
        submittedAt: "2025-01-01T00:00:00Z",
      }, adminCookies);
      expect(status).toBe(200);

      const { json } = await apiRequest("GET", `/api/bids/${bidCode}`, undefined, adminCookies);
      expect(json.convertedToProjectId).toBeNull();
      expect(json.awardedAt).toBeNull();
    });

    it("should silently ignore code field in PATCH", async () => {
      const { status } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        code: "INJECTED-CODE",
        name: `E2E Bid Updated ${uniqueSuffix}`,
      }, adminCookies);
      expect(status).toBe(200);

      const { json } = await apiRequest("GET", `/api/bids/${bidCode}`, undefined, adminCookies);
      expect(json.code).toBe(bidCode);
    });

    it("should silently ignore gcOrganizationId in PATCH (cross-tenant protection)", async () => {
      const { status } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        gcOrganizationId: "different-org-id",
        name: `E2E Bid Updated ${uniqueSuffix}`,
      }, adminCookies);
      expect(status).toBe(200);
    });
  });

  describe("Status Transitions", () => {
    it("should transition DRAFT → ACTIVE", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        status: "ACTIVE",
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("ACTIVE");
    });

    it("should transition ACTIVE → SUBMITTED", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        status: "SUBMITTED",
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("SUBMITTED");
    });

    it("should reject invalid transition SUBMITTED → DRAFT (422)", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode}`, {
        status: "DRAFT",
      }, adminCookies);
      expect(status).toBe(422);
      expect(json.error).toContain("Invalid status transition");
    });

    it("should reject invalid transition DRAFT → AWARDED (422)", async () => {
      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E Transition Test ${uniqueSuffix}`,
        clientName: "Transition Client",
      }, adminCookies);
      expect(createRes.status).toBe(201);
      bidCode2 = createRes.json.code;

      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode2}`, {
        status: "AWARDED",
      }, adminCookies);
      expect(status).toBe(422);
      expect(json.error).toContain("Invalid status transition");
    });

    it("should reject invalid transition DRAFT → LOST (422)", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode2}`, {
        status: "LOST",
      }, adminCookies);
      expect(status).toBe(422);
      expect(json.error).toContain("Invalid status transition");
    });
  });

  describe("Admin Force Transitions", () => {
    it("should create and move a bid to CANCELLED terminal state", async () => {
      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E Force Transition ${uniqueSuffix}`,
        clientName: "Force Test Client",
      }, adminCookies);
      expect(createRes.status).toBe(201);
      bidCode4 = createRes.json.code;

      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode4}`, {
        status: "CANCELLED",
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("CANCELLED");
    });

    it("should allow ADMIN to force-transition CANCELLED → DRAFT with force flag", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode4}`, {
        status: "DRAFT",
        force: true,
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("DRAFT");
    });

    it("should reject force-transition without force flag from terminal state", async () => {
      await apiRequest("PATCH", `/api/bids/${bidCode4}`, { status: "CANCELLED" }, adminCookies);

      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode4}`, {
        status: "DRAFT",
      }, adminCookies);
      expect(status).toBe(422);
      expect(json.error).toContain("Invalid status transition");
    });

    it("should reject ESTIMATOR from force-transitioning terminal states", async () => {
      const { cookies } = await login("ESTIMATOR");
      estimatorCookies = cookies;

      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E Estimator Force ${uniqueSuffix}`,
        clientName: "Estimator Force Client",
      }, estimatorCookies);
      expect(createRes.status).toBe(201);
      const estBidCode = createRes.json.code;

      await apiRequest("PATCH", `/api/bids/${estBidCode}`, { status: "CANCELLED" }, estimatorCookies);

      const { status, json } = await apiRequest("PATCH", `/api/bids/${estBidCode}`, {
        status: "DRAFT",
        force: true,
      }, estimatorCookies);
      expect(status).toBe(422);
      expect(json.error).toContain("Invalid status transition");
    });

    it("should allow ADMIN to force-transition LOST → ACTIVE", async () => {
      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E Lost Force ${uniqueSuffix}`,
        clientName: "Lost Force Client",
      }, adminCookies);
      expect(createRes.status).toBe(201);
      const lostBidCode = createRes.json.code;

      await apiRequest("PATCH", `/api/bids/${lostBidCode}`, { status: "ACTIVE" }, adminCookies);
      await apiRequest("PATCH", `/api/bids/${lostBidCode}`, { status: "LOST" }, adminCookies);

      const { status, json } = await apiRequest("PATCH", `/api/bids/${lostBidCode}`, {
        status: "ACTIVE",
        force: true,
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("ACTIVE");
    });
  });

  describe("Bid-to-Project Conversion", () => {
    it("should convert SUBMITTED bid to project (201)", async () => {
      const { status, json } = await apiRequest("POST", `/api/bids/${bidCode}/convert`, {
        startStatus: "PLANNING",
      }, adminCookies);
      expect(status).toBe(201);
      expect(json.code).toBe(bidCode);
      expect(json.id).toBeTruthy();
      convertedProjectId = json.id;
    });

    it("should show bid as AWARDED after conversion with convertedToProjectId set", async () => {
      const { status, json } = await apiRequest("GET", `/api/bids/${bidCode}`, undefined, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("AWARDED");
      expect(json.convertedToProjectId).toBeTruthy();
      expect(json.convertedToProjectId).toBe(convertedProjectId);
    });

    it("should reject duplicate conversion (409)", async () => {
      const { status, json } = await apiRequest("POST", `/api/bids/${bidCode}/convert`, {}, adminCookies);
      expect(status).toBe(409);
      expect(json.error).toBeTruthy();
    });

    it("should show converted project in projects list with matching code", async () => {
      const { status, json } = await apiRequest("GET", "/api/projects", undefined, adminCookies);
      expect(status).toBe(200);
      const projects = Array.isArray(json) ? json : (json?.projects || json?.data || []);
      const project = projects.find((p: any) => p.code === bidCode);
      expect(project).toBeTruthy();
      expect(project.id).toBe(convertedProjectId);
    });

    it("should access SOV endpoint for converted project (SOV seeded only if estimate line items exist)", async () => {
      expect(convertedProjectId).toBeTruthy();
      const { status, json } = await apiRequest("GET", "/api/sov", undefined, adminCookies);
      expect(status).toBe(200);
      expect(Array.isArray(json)).toBe(true);
    });
  });

  describe("Bid Deletion", () => {
    it("should delete an unconverted bid", async () => {
      const { status } = await apiRequest("DELETE", `/api/bids/${bidCode2}`, undefined, adminCookies);
      expect(status).toBe(200);

      const getRes = await apiRequest("GET", `/api/bids/${bidCode2}`, undefined, adminCookies);
      expect(getRes.status).toBe(404);
    });

    it("should reject deletion of converted bid (409)", async () => {
      const { status, json } = await apiRequest("DELETE", `/api/bids/${bidCode}`, undefined, adminCookies);
      expect(status).toBe(409);
      expect(json.error).toBeTruthy();
    });
  });

  describe("RBAC - ESTIMATOR Restrictions", () => {
    it("should block ESTIMATOR from converting bids (403)", async () => {
      if (!estimatorCookies) {
        const { cookies } = await login("ESTIMATOR");
        estimatorCookies = cookies;
      }

      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E Estimator Convert ${uniqueSuffix}`,
        clientName: "Estimator Client",
      }, estimatorCookies);
      expect(createRes.status).toBe(201);
      bidCode3 = createRes.json.code;

      await apiRequest("PATCH", `/api/bids/${bidCode3}`, { status: "ACTIVE" }, estimatorCookies);
      await apiRequest("PATCH", `/api/bids/${bidCode3}`, { status: "SUBMITTED" }, estimatorCookies);

      const { status } = await apiRequest("POST", `/api/bids/${bidCode3}/convert`, {}, estimatorCookies);
      expect(status).toBe(403);
    });

    it("should allow ESTIMATOR to create bids", async () => {
      const { status, json } = await apiRequest("POST", "/api/bids", {
        name: `E2E Estimator Create ${uniqueSuffix}`,
        clientName: "Estimator CRUD Client",
      }, estimatorCookies);
      expect(status).toBe(201);
      expect(json.status).toBe("DRAFT");
    });

    it("should allow ESTIMATOR to edit bid fields", async () => {
      const { status, json } = await apiRequest("PATCH", `/api/bids/${bidCode3}`, {
        description: "Updated by estimator",
      }, estimatorCookies);
      expect(status).toBe(200);
      expect(json.description).toBe("Updated by estimator");
    });
  });

  describe("Bid Listing and Filtering", () => {
    it("should list bids and return array", async () => {
      const { status, json } = await apiRequest("GET", "/api/bids", undefined, adminCookies);
      expect(status).toBe(200);
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);
    });

    it("should include AWARDED bid in list with correct status", async () => {
      const { json } = await apiRequest("GET", "/api/bids", undefined, adminCookies);
      const awardedBid = json.find((b: any) => b.code === bidCode);
      expect(awardedBid).toBeTruthy();
      expect(awardedBid.status).toBe("AWARDED");
      expect(awardedBid.convertedToProjectId).toBeTruthy();
    });

    it("should return 404 for nonexistent bid code", async () => {
      const { status } = await apiRequest("GET", "/api/bids/NONEXISTENT-9999", undefined, adminCookies);
      expect(status).toBe(404);
    });
  });

  describe("Input Validation", () => {
    it("should reject bid creation with missing name (required field)", async () => {
      const { status } = await apiRequest("POST", "/api/bids", {
        clientName: "No Name Client",
      }, adminCookies);
      expect(status).toBe(400);
    });

    it("should reject bid creation with invalid bidAmount (non-numeric)", async () => {
      const { status } = await apiRequest("POST", "/api/bids", {
        name: `E2E Invalid Amount ${uniqueSuffix}`,
        clientName: "Validation Client",
        bidAmount: "not-a-number",
      }, adminCookies);
      expect(status).toBe(400);
    });

    it("should reject bid creation with negative bidAmount", async () => {
      const { status } = await apiRequest("POST", "/api/bids", {
        name: `E2E Negative Amount ${uniqueSuffix}`,
        clientName: "Validation Client",
        bidAmount: "-5000",
      }, adminCookies);
      expect(status).toBe(400);
    });
  });

  describe("Conversion with Estimate Line Items and SOV/Budget Seeding", () => {
    let sovBidCode = "";
    let sovBidId = "";
    let sovProjectId = "";

    it("should create a bid and add an estimate with line items", async () => {
      const createRes = await apiRequest("POST", "/api/bids", {
        name: `E2E SOV Seed ${uniqueSuffix}`,
        clientName: "SOV Seed Client",
        bidAmount: "100000",
      }, adminCookies);
      expect(createRes.status).toBe(201);
      sovBidCode = createRes.json.code;
      sovBidId = createRes.json.id;

      const estimateRes = await apiRequest("POST", `/api/bids/${sovBidId}/estimate`, {}, adminCookies);
      expect(estimateRes.status).toBe(201);
      const estimateId = estimateRes.json.id;
      expect(estimateId).toBeTruthy();

      const lineItem1Res = await apiRequest("POST", `/api/estimates/${estimateId}/line-items`, {
        description: "Concrete Foundation",
        quantity: "100",
        unit: "SF",
        materialCost: "5000",
        laborCost: "3000",
        laborHours: "40",
        equipmentCost: "0",
        equipmentHours: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
      }, adminCookies);
      expect(lineItem1Res.status).toBe(201);

      const lineItem2Res = await apiRequest("POST", `/api/estimates/${estimateId}/line-items`, {
        description: "Steel Framing",
        quantity: "50",
        unit: "LF",
        materialCost: "7500",
        laborCost: "4500",
        laborHours: "60",
        equipmentCost: "0",
        equipmentHours: "0",
        consumablesCost: "0",
        subcontractCost: "0",
        overheadAllocation: "0",
        profitAllocation: "0",
      }, adminCookies);
      expect(lineItem2Res.status).toBe(201);
    });

    it("should transition bid with estimate to SUBMITTED", async () => {
      await apiRequest("PATCH", `/api/bids/${sovBidCode}`, { status: "ACTIVE" }, adminCookies);
      const { status, json } = await apiRequest("PATCH", `/api/bids/${sovBidCode}`, {
        status: "SUBMITTED",
      }, adminCookies);
      expect(status).toBe(200);
      expect(json.status).toBe("SUBMITTED");
    });

    it("should convert bid with estimate line items to project", async () => {
      const { status, json } = await apiRequest("POST", `/api/bids/${sovBidCode}/convert`, {
        startStatus: "PLANNING",
      }, adminCookies);
      expect(status).toBe(201);
      expect(json.code).toBe(sovBidCode);
      sovProjectId = json.id;
      expect(sovProjectId).toBeTruthy();
    });

    it("should verify SOV was seeded from estimate line items", async () => {
      expect(sovProjectId).toBeTruthy();
      const { status, json } = await apiRequest("GET", "/api/sov", undefined, adminCookies);
      expect(status).toBe(200);
      expect(Array.isArray(json)).toBe(true);
      const projectSov = json.find((sov: any) => sov.projectId === sovProjectId);
      expect(projectSov).toBeTruthy();
      expect(projectSov.id).toBeTruthy();
      expect(projectSov.lineItems).toBeTruthy();
      expect(projectSov.lineItems.length).toBeGreaterThanOrEqual(2);
    });

    it("should verify bid is AWARDED with convertedToProjectId", async () => {
      const { json } = await apiRequest("GET", `/api/bids/${sovBidCode}`, undefined, adminCookies);
      expect(json.status).toBe("AWARDED");
      expect(json.convertedToProjectId).toBe(sovProjectId);
    });
  });

  describe("Org-Scoped Bid Access", () => {
    it("should scope GET /api/bids to the authenticated user org", async () => {
      const { json: adminBids } = await apiRequest("GET", "/api/bids", undefined, adminCookies);
      expect(Array.isArray(adminBids)).toBe(true);

      for (const bid of adminBids) {
        expect(bid.gcOrganizationId).toBeTruthy();
      }

      const allOrgIds = new Set(adminBids.map((b: any) => b.gcOrganizationId));
      expect(allOrgIds.size).toBeLessThanOrEqual(1);
    });

    it("should return 401 for unauthenticated access to bids", async () => {
      const { status } = await apiRequest("GET", "/api/bids");
      expect(status).toBe(401);
    });
  });
});
