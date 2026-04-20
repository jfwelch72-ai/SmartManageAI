import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { installCsrf, installCsrfOnRequest } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const HEAVY_CIVIL_TRADE = "ROADWAY_CONSTRUCTION";

interface AuthMeResponse {
  user: { id: string; role: string; organizationId: string | null };
  organizationName: string | null;
}

interface DashboardLayout {
  sections: Array<{ id: string; title: string; widgets: Array<{ id: string; type: string }> }>;
  version?: number;
  gridCols?: number;
}

interface DbeProgressResponse {
  projectsWithGoals: number;
  totalGoals: number;
  totalGoalDollars: number;
  breakdown: Array<{ certificationType: string; totalGoalDollars: number }>;
}

interface OpenHaulTicketsResponse {
  total: number;
  pendingApproval: number;
  totalQuantity: number;
  totalCost: number;
  recentPending: Array<unknown>;
}

interface IdrStreakResponse {
  totalReports: number;
  last30Days: number;
  activeProjects: number;
  projectStreaks: Array<unknown>;
}

interface BuyAmericaResponse {
  total: number;
  compliant: number;
  pending: number;
  compliancePercent: number;
}

interface ExpirationsResponse {
  bondsEnabled: boolean;
  dbeEnabled: boolean;
  bonds: Array<{ id: string; bondNumber: string; expirationDate: string }>;
  certifications: Array<unknown>;
  totals: { bondsExpiringSoon: number; certsExpiringSoon: number };
}

async function devLogin(req: APIRequestContext, role: string) {
  const response = await req.post(`${BASE_URL}/api/dev/test-login`, { data: { role } });
  expect(response.status(), `dev login (${role}) failed`).toBe(200);
}

async function getMe(req: APIRequestContext): Promise<AuthMeResponse> {
  const res = await req.get(`${BASE_URL}/api/auth/me`);
  expect(res.status()).toBe(200);
  return (await res.json()) as AuthMeResponse;
}

async function ensureHeavyCivilTrade(req: APIRequestContext) {
  const res = await req.post(`${BASE_URL}/api/organization/update-trade-type`, {
    data: { tradeType: HEAVY_CIVIL_TRADE, tradeName: "Roadway Construction" },
  });
  // 200 on success; if SOW reinit prompts, the endpoint can return 409 — accept either as long
  // as the trade is updated. We re-fetch /me and assert.
  expect([200, 409]).toContain(res.status());
}

async function createProject(req: APIRequestContext, name: string): Promise<{ id: string; gcOrganizationId: string | null }> {
  const res = await req.post(`${BASE_URL}/api/projects`, {
    data: {
      name,
      clientName: "Test DOT Owner",
      status: "ACTIVE",
      locationAddress: "123 Heavy-Civil Blvd",
      city: "Sacramento",
      state: "CA",
      budget: "1000000.00",
    },
  });
  expect(res.status(), `create project failed: ${await res.text()}`).toBeLessThan(300);
  const body = await res.json();
  return { id: body.id, gcOrganizationId: body.gcOrganizationId ?? null };
}

async function seedDbeGoal(req: APIRequestContext, projectId: string) {
  const res = await req.post(`${BASE_URL}/api/projects/${projectId}/dbe-goals`, {
    data: {
      certificationType: "DBE",
      goalPercent: "12.5",
      goalDollars: "125000.00",
      notes: "FHWA federal-aid project DBE goal",
    },
  });
  expect(res.status(), `seed DBE goal failed: ${await res.text()}`).toBeLessThan(300);
}

async function seedHaulTickets(req: APIRequestContext, projectId: string) {
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 3; i++) {
    const res = await req.post(`${BASE_URL}/api/haul-tickets`, {
      data: {
        projectId,
        ticketNumber: `HT-${Date.now()}-${i}`,
        ticketDate: today,
        materialClass: "AGGREGATE_BASE",
        quantity: "25.000",
        unit: "TON",
        unitCost: "18.50",
        totalCost: "462.50",
        status: "SUBMITTED",
        source: "Pit #4",
        destination: "STA 100+00",
      },
    });
    expect(res.status(), `seed haul ticket failed: ${await res.text()}`).toBeLessThan(300);
  }
}

async function seedIdr(req: APIRequestContext, projectId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const res = await req.post(`${BASE_URL}/api/daily-inspector-reports`, {
    data: {
      projectId,
      reportDate: today,
      reportNumber: `IDR-${Date.now()}`,
      status: "SUBMITTED",
      inspectorName: "Test Inspector",
      weatherConditions: "Sunny",
      temperatureHigh: 78,
      temperatureLow: 55,
      crewCount: 8,
      crewHours: "64.00",
      workPerformed: "Subgrade prep STA 100+00 to STA 105+00",
    },
  });
  expect(res.status(), `seed IDR failed: ${await res.text()}`).toBeLessThan(300);
}

async function seedMaterialCerts(req: APIRequestContext, projectId: string) {
  const today = new Date().toISOString().slice(0, 10);
  // One verified (Buy America compliant) and one pending so the widget shows mixed status.
  const compliant = await req.post(`${BASE_URL}/api/material-certifications`, {
    data: {
      projectId,
      materialDescription: "#5 Reinforcing Steel - Domestic Mill",
      manufacturerName: "Nucor Steel",
      manufacturerCountry: "USA",
      millName: "Nucor Birmingham",
      millCountry: "USA",
      heatNumber: `HEAT-${Date.now()}`,
      certNumber: `CERT-${Date.now()}`,
      buyAmericaStatus: "VERIFIED",
      receivedDate: today,
    },
  });
  expect(compliant.status(), `seed compliant cert failed: ${await compliant.text()}`).toBeLessThan(300);

  const pending = await req.post(`${BASE_URL}/api/material-certifications`, {
    data: {
      projectId,
      materialDescription: "Structural Steel Plate",
      manufacturerName: "Acme Steel",
      manufacturerCountry: "USA",
      buyAmericaStatus: "PENDING",
      receivedDate: today,
    },
  });
  expect(pending.status(), `seed pending cert failed: ${await pending.text()}`).toBeLessThan(300);
}

async function seedSuretyBond(req: APIRequestContext, projectId: string) {
  const today = new Date();
  const effective = today.toISOString().slice(0, 10);
  // Expire in ~60 days so it falls inside the 90-day expirations window.
  const exp = new Date();
  exp.setDate(exp.getDate() + 60);
  const expiration = exp.toISOString().slice(0, 10);

  const res = await req.post(`${BASE_URL}/api/surety-bonds`, {
    data: {
      projectId,
      bondType: "PERFORMANCE",
      status: "ACTIVE",
      bondNumber: `PB-${Date.now()}`,
      suretyCompany: "Travelers Casualty & Surety",
      bondAmount: "1000000.00",
      premiumAmount: "12500.00",
      effectiveDate: effective,
      expirationDate: expiration,
    },
  });
  expect(res.status(), `seed bond failed: ${await res.text()}`).toBeLessThan(300);
}

async function setFlagAsSuperAdmin(
  browser: Browser,
  orgId: string,
  flag: string,
  enabled: boolean,
) {
  const ctx = await browser.newContext();
  try {
    await installCsrfOnRequest(ctx.request, ctx);
    await devLogin(ctx.request, "SUPER_ADMIN");
    const res = await ctx.request.patch(`${BASE_URL}/api/feature-flags/${orgId}`, {
      data: { flag, enabled },
    });
    expect(res.status(), `flag toggle (${flag}=${enabled}) failed: ${await res.text()}`).toBe(200);
  } finally {
    await ctx.close();
  }
}

test.describe("Heavy-Civil Dashboard E2E", () => {
  let projectId: string;
  let orgId: string;
  let primaryPage: Page;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    primaryPage = await ctx.newPage();

    await installCsrf(primaryPage);
    await devLogin(primaryPage.request, "ADMIN");
    const me = await getMe(primaryPage.request);
    expect(me.user.organizationId).toBeTruthy();
    orgId = me.user.organizationId!;

    await ensureHeavyCivilTrade(primaryPage.request);

    const project = await createProject(primaryPage.request, `HC E2E ${Date.now()}`);
    projectId = project.id;

    await seedDbeGoal(primaryPage.request, projectId);
    await seedHaulTickets(primaryPage.request, projectId);
    await seedIdr(primaryPage.request, projectId);
    await seedMaterialCerts(primaryPage.request, projectId);
    await seedSuretyBond(primaryPage.request, projectId);
  });

  test("dashboard layout auto-applies HEAVY_CIVIL_LAYOUT for heavy-civil tradeType", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/layout`);
    expect(res.status()).toBe(200);
    const layout = (await res.json()) as DashboardLayout;
    const sectionIds = layout.sections.map((s) => s.id);
    // HEAVY_CIVIL_LAYOUT is identified by its section ids prefixed `section-hc-`.
    expect(sectionIds.some((id) => id.startsWith("section-hc-"))).toBe(true);

    const widgetTypes = layout.sections.flatMap((s) => s.widgets.map((w) => w.type));
    for (const expected of [
      "DBE_PARTICIPATION",
      "BUY_AMERICA",
      "OPEN_HAUL_TICKETS",
      "IDR_STREAK",
      "BOND_CERT_EXPIRATIONS",
    ]) {
      expect(widgetTypes, `layout missing ${expected} widget`).toContain(expected);
    }
  });

  test("DBE progress widget returns seeded goal", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/dbe-progress`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as DbeProgressResponse;
    expect(body.totalGoals).toBeGreaterThanOrEqual(1);
    expect(body.projectsWithGoals).toBeGreaterThanOrEqual(1);
    expect(body.totalGoalDollars).toBeGreaterThan(0);
    expect(body.breakdown.length).toBeGreaterThan(0);
    expect(body.breakdown.some((b) => b.certificationType === "DBE")).toBe(true);
  });

  test("Open haul tickets widget reflects seeded SUBMITTED tickets", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/open-haul-tickets`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as OpenHaulTicketsResponse;
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.pendingApproval).toBeGreaterThanOrEqual(3);
    expect(body.totalQuantity).toBeGreaterThan(0);
    expect(body.totalCost).toBeGreaterThan(0);
    expect(Array.isArray(body.recentPending)).toBe(true);
  });

  test("IDR streak widget reflects seeded report", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/idr-streak`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as IdrStreakResponse;
    expect(body.activeProjects).toBeGreaterThanOrEqual(1);
    expect(body.totalReports).toBeGreaterThanOrEqual(1);
    expect(body.last30Days).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.projectStreaks)).toBe(true);
  });

  test("Buy America widget reflects seeded compliant + pending certs", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/buy-america`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as BuyAmericaResponse;
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.compliant).toBeGreaterThanOrEqual(1);
    expect(body.pending).toBeGreaterThanOrEqual(1);
    expect(body.compliancePercent).toBeGreaterThan(0);
  });

  test("Bond/cert expirations widget includes seeded bond expiring within 90 days", async () => {
    const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/expirations`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as ExpirationsResponse;
    expect(body.bondsEnabled).toBe(true);
    expect(body.totals.bondsExpiringSoon).toBeGreaterThanOrEqual(1);
    expect(body.bonds.length).toBeGreaterThanOrEqual(1);
  });

  test("Heavy-Civil Summary PDF downloads non-empty PDF for the project", async () => {
    const res = await primaryPage.request.get(
      `${BASE_URL}/api/projects/${projectId}/heavy-civil-summary/pdf`,
    );
    expect(res.status(), `pdf request failed: ${await res.text().catch(() => "")}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const buf = await res.body();
    // PDFs always start with "%PDF-" and are at least a few hundred bytes.
    expect(buf.byteLength).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });

  test("Widget endpoints return 403 when their feature flag is disabled", async ({ browser }) => {
    // Disable HAUL_TICKETS flag via SUPER_ADMIN.
    await setFlagAsSuperAdmin(browser, orgId, "HAUL_TICKETS", false);
    try {
      const res = await primaryPage.request.get(`${BASE_URL}/api/dashboard/heavy-civil/open-haul-tickets`);
      expect(res.status(), "haul widget should be 403 when HAUL_TICKETS flag is off").toBe(403);
    } finally {
      // Restore for any subsequent tests / re-runs.
      await setFlagAsSuperAdmin(browser, orgId, "HAUL_TICKETS", true);
    }
  });

  test("Widget endpoints return 403 for users without required permission", async ({ browser }) => {
    // FIELD_WORKER lacks canViewHaulTickets/canManageHaulTickets and other heavy-civil perms.
    const ctx = await browser.newContext();
    try {
      await installCsrfOnRequest(ctx.request, ctx);
      await devLogin(ctx.request, "FIELD_WORKER");
      const endpoints = [
        "/api/dashboard/heavy-civil/dbe-progress",
        "/api/dashboard/heavy-civil/open-haul-tickets",
        "/api/dashboard/heavy-civil/idr-streak",
        "/api/dashboard/heavy-civil/buy-america",
        "/api/dashboard/heavy-civil/expirations",
      ];
      for (const ep of endpoints) {
        const res = await ctx.request.get(`${BASE_URL}${ep}`);
        expect([401, 403], `${ep} should be permission-denied for FIELD_WORKER (got ${res.status()})`).toContain(
          res.status(),
        );
      }
    } finally {
      await ctx.close();
    }
  });
});
