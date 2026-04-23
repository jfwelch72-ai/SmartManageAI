// Task #1372 — Verify the Safety Hub tile badge counts render correctly
// against the five summary endpoints (SWPPP, Daily Inspector Reports,
// Material Certifications, Safety Training, Compliance).
//
// Strategy:
//   1. Log in as ADMIN against the dev sandbox org (all feature flags on).
//   2. Create a fresh project and seed, for each of the five sources, one
//      "overdue/expired" row + one "expiring soon / open" row, using
//      distinctive day-counts so each maxDays badge is deterministic.
//   3. Hit the summary endpoints to capture the authoritative counts
//      (which already include any baseline data present in the dev
//      sandbox org).
//   4. Visit /safety-hub, switch to the Modules tab, and assert each
//      tile renders the totals returned by its summary endpoint —
//      including the "overdue/expired" count badge and the "X day(s)"
//      max-days badge whose data-testid encodes overdue/expired.
//
// This catches regressions where a tile reads the wrong field, two
// tiles' badges get swapped, or a tile stops calling its endpoint.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface SwpppSummary { openCount: number; overdueCount: number; maxDaysOverdue: number }
interface IdrSummary { unsignedCount: number; overdueCount: number; maxDaysOverdue: number }
interface MaterialCertSummary { expiringSoonCount: number; expiredCount: number; maxDaysExpired: number }
interface TrainingSummary { overdueCount: number; expiringSoonCount: number; maxDaysOverdue: number }
interface ComplianceSummary { expiredCount: number; expiringSoonCount: number; maxDaysExpired: number }

interface AuthMeResponse {
  user: { id: string; role: string; organizationId: string | null };
  organizationName: string | null;
}

function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

async function devLogin(req: APIRequestContext, role: string): Promise<void> {
  const res = await req.post(`${BASE_URL}/api/dev/test-login`, { data: { role } });
  expect(res.status(), `dev login (${role}) failed: ${await res.text()}`).toBe(200);
}

async function getMe(req: APIRequestContext): Promise<AuthMeResponse> {
  const res = await req.get(`${BASE_URL}/api/auth/me`);
  expect(res.status()).toBe(200);
  return (await res.json()) as AuthMeResponse;
}

async function createProject(req: APIRequestContext, name: string): Promise<string> {
  const res = await req.post(`${BASE_URL}/api/projects`, {
    data: {
      name,
      clientName: "Safety Hub Badge E2E",
      status: "ACTIVE",
      locationAddress: "1 Badge Way",
      city: "Sacramento",
      state: "CA",
      budget: "100000.00",
    },
  });
  expect(res.status(), `create project failed: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).id as string;
}

// ---------------------------------------------------------------------------
// Distinctive max-days values — chosen so each tile's max-days badge is
// effectively guaranteed to dominate any baseline data already present
// in the dev sandbox org. Each value is unique across tiles so a swapped
// badge would be obvious in a failure diff.
// ---------------------------------------------------------------------------
const SWPPP_DAYS_OVERDUE = 877;
const IDR_DAYS_OVERDUE = 743;
const MATERIAL_DAYS_EXPIRED = 821;
const TRAINING_DAYS_OVERDUE = 689;
const COMPLIANCE_DAYS_EXPIRED = 953;

async function seedSwppp(req: APIRequestContext, projectId: string): Promise<void> {
  // Overdue: deficiencies present, due date well in the past, status OPEN.
  const overdue = await req.post(`${BASE_URL}/api/swppp-inspections`, {
    data: {
      projectId,
      inspectionDate: isoDate(-SWPPP_DAYS_OVERDUE - 1),
      inspectionType: "ROUTINE",
      status: "OPEN",
      deficienciesFound: "Silt fence breach at SE corner",
      correctiveActions: "Re-stake silt fence and replace damaged section",
      correctiveActionDueDate: isoDate(-SWPPP_DAYS_OVERDUE),
      inspectorName: "Badge E2E Inspector",
    },
  });
  expect(overdue.status(), `seed SWPPP overdue failed: ${await overdue.text()}`).toBe(201);

  // Open (not overdue): same shape but with a future due date so it
  // lands in `openCount` rather than `overdueCount`.
  const open = await req.post(`${BASE_URL}/api/swppp-inspections`, {
    data: {
      projectId,
      inspectionDate: isoDate(-1),
      inspectionType: "ROUTINE",
      status: "OPEN",
      deficienciesFound: "Concrete washout area needs containment",
      correctiveActions: "Install lined washout pit",
      correctiveActionDueDate: isoDate(7),
      inspectorName: "Badge E2E Inspector",
    },
  });
  expect(open.status(), `seed SWPPP open failed: ${await open.text()}`).toBe(201);
}

async function seedIdr(req: APIRequestContext, projectId: string): Promise<void> {
  // Overdue: DRAFT with a long-past reportDate.
  const overdue = await req.post(`${BASE_URL}/api/daily-inspector-reports`, {
    data: {
      projectId,
      reportDate: isoDate(-IDR_DAYS_OVERDUE),
      reportNumber: `BADGE-IDR-OVR-${Date.now()}`,
      status: "DRAFT",
      inspectorName: "Badge E2E Inspector",
      workPerformed: "Subgrade prep — left unsigned",
      crewCount: 4,
    },
  });
  expect(overdue.status(), `seed IDR overdue failed: ${await overdue.text()}`).toBe(201);

  // Unsigned (not overdue): DRAFT for today.
  const today = await req.post(`${BASE_URL}/api/daily-inspector-reports`, {
    data: {
      projectId,
      reportDate: isoDate(0),
      reportNumber: `BADGE-IDR-TODAY-${Date.now()}`,
      status: "DRAFT",
      inspectorName: "Badge E2E Inspector",
      workPerformed: "Today's draft awaiting signature",
      crewCount: 6,
    },
  });
  expect(today.status(), `seed IDR today-draft failed: ${await today.text()}`).toBe(201);
}

async function seedMaterialCerts(req: APIRequestContext, projectId: string): Promise<void> {
  const expired = await req.post(`${BASE_URL}/api/material-certifications`, {
    data: {
      projectId,
      materialDescription: "Badge E2E — Class A Concrete Mill Cert",
      manufacturerName: "Acme Cement",
      manufacturerCountry: "USA",
      buyAmericaStatus: "PENDING",
      receivedDate: isoDate(-MATERIAL_DAYS_EXPIRED - 30),
      expirationDate: isoDate(-MATERIAL_DAYS_EXPIRED),
    },
  });
  expect(expired.status(), `seed cert expired failed: ${await expired.text()}`).toBe(201);

  const expiringSoon = await req.post(`${BASE_URL}/api/material-certifications`, {
    data: {
      projectId,
      materialDescription: "Badge E2E — Reinforcing Steel Mill Cert",
      manufacturerName: "Nucor",
      manufacturerCountry: "USA",
      buyAmericaStatus: "PENDING",
      receivedDate: isoDate(-30),
      expirationDate: isoDate(15),
    },
  });
  expect(expiringSoon.status(), `seed cert expiringSoon failed: ${await expiringSoon.text()}`).toBe(201);
}

async function seedTraining(
  req: APIRequestContext,
  employeeId: string,
): Promise<void> {
  // 1) Create a training program.
  const tr = await req.post(`${BASE_URL}/api/safety-training`, {
    data: {
      title: `Badge E2E Training ${Date.now()}`,
      category: "GENERAL",
      frequency: "ONCE",
      isActive: true,
    },
  });
  expect(tr.status(), `create training failed: ${await tr.text()}`).toBe(201);
  const trainingId = (await tr.json()).id as string;

  // 2) Overdue assignment — pin a long-past dueDate so the gap drives
  //    the maxDaysOverdue badge. The /assign endpoint takes a single
  //    dueDate per call, so each leg is its own POST.
  const overdue = await req.post(`${BASE_URL}/api/safety-training/assign`, {
    data: {
      trainingId,
      employeeIds: [employeeId],
      dueDate: isoDate(-TRAINING_DAYS_OVERDUE),
    },
  });
  expect(overdue.status(), `assign overdue failed: ${await overdue.text()}`).toBe(201);

  // 3) Expiring-soon assignment. A second training program is needed
  //    because the assignments table is uniquely keyed on
  //    (training, employee).
  const tr2 = await req.post(`${BASE_URL}/api/safety-training`, {
    data: {
      title: `Badge E2E Training (Soon) ${Date.now()}`,
      category: "GENERAL",
      frequency: "ONCE",
      isActive: true,
    },
  });
  expect(tr2.status(), `create training #2 failed: ${await tr2.text()}`).toBe(201);
  const trainingId2 = (await tr2.json()).id as string;

  const soon = await req.post(`${BASE_URL}/api/safety-training/assign`, {
    data: {
      trainingId: trainingId2,
      employeeIds: [employeeId],
      dueDate: isoDate(10),
    },
  });
  expect(soon.status(), `assign expiringSoon failed: ${await soon.text()}`).toBe(201);
}

async function seedCompliance(req: APIRequestContext, projectId: string): Promise<void> {
  // The compliance summary aggregates across DBE certs, surety bonds,
  // CRM org insurance/WC/license, and project permits. Surety bonds
  // are the simplest source available via a direct POST endpoint.
  const expired = await req.post(`${BASE_URL}/api/surety-bonds`, {
    data: {
      projectId,
      bondType: "PERFORMANCE",
      status: "ACTIVE",
      bondNumber: `BADGE-PB-EXP-${Date.now()}`,
      suretyCompany: "Travelers Casualty & Surety",
      bondAmount: "500000.00",
      effectiveDate: isoDate(-COMPLIANCE_DAYS_EXPIRED - 365),
      expirationDate: isoDate(-COMPLIANCE_DAYS_EXPIRED),
    },
  });
  expect(expired.status(), `seed compliance expired bond failed: ${await expired.text()}`).toBe(201);

  const expiringSoon = await req.post(`${BASE_URL}/api/surety-bonds`, {
    data: {
      projectId,
      bondType: "PAYMENT",
      status: "ACTIVE",
      bondNumber: `BADGE-PB-SOON-${Date.now()}`,
      suretyCompany: "Travelers Casualty & Surety",
      bondAmount: "500000.00",
      effectiveDate: isoDate(-180),
      expirationDate: isoDate(20),
    },
  });
  expect(expiringSoon.status(), `seed compliance expiringSoon bond failed: ${await expiringSoon.text()}`).toBe(201);
}

async function fetchSummary<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${BASE_URL}${path}`);
  expect(res.status(), `${path} failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as T;
}

function daysLabel(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

test.describe("Safety Hub tile badges E2E — task #1372", () => {
  let page: Page;
  let context: import("@playwright/test").BrowserContext;
  let summaries: {
    swppp: SwpppSummary;
    idr: IdrSummary;
    material: MaterialCertSummary;
    training: TrainingSummary;
    compliance: ComplianceSummary;
  };

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await installCsrf(page);

    await devLogin(page.request, "ADMIN");
    const me = await getMe(page.request);
    expect(me.user.organizationId, "ADMIN dev login must yield an org").toBeTruthy();

    const projectId = await createProject(page.request, `Safety Hub Badge E2E ${Date.now()}`);

    await seedSwppp(page.request, projectId);
    await seedIdr(page.request, projectId);
    await seedMaterialCerts(page.request, projectId);
    await seedTraining(page.request, me.user.id);
    await seedCompliance(page.request, projectId);

    summaries = {
      swppp: await fetchSummary<SwpppSummary>(page, "/api/swppp-inspections/summary"),
      idr: await fetchSummary<IdrSummary>(page, "/api/daily-inspector-reports/summary"),
      material: await fetchSummary<MaterialCertSummary>(page, "/api/material-certifications/summary"),
      training: await fetchSummary<TrainingSummary>(page, "/api/safety-training/summary"),
      compliance: await fetchSummary<ComplianceSummary>(page, "/api/compliance/summary"),
    };

    // Sanity-check the seed actually populated each summary so a
    // green test cannot silently mean "no data was checked". Each of
    // the seeded overdue rows must have driven the corresponding
    // maxDays badge to at least our marker value.
    expect(summaries.swppp.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summaries.swppp.maxDaysOverdue).toBeGreaterThanOrEqual(SWPPP_DAYS_OVERDUE);
    expect(summaries.idr.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summaries.idr.maxDaysOverdue).toBeGreaterThanOrEqual(IDR_DAYS_OVERDUE);
    expect(summaries.material.expiredCount).toBeGreaterThanOrEqual(1);
    expect(summaries.material.maxDaysExpired).toBeGreaterThanOrEqual(MATERIAL_DAYS_EXPIRED);
    expect(summaries.training.overdueCount).toBeGreaterThanOrEqual(1);
    expect(summaries.training.maxDaysOverdue).toBeGreaterThanOrEqual(TRAINING_DAYS_OVERDUE);
    expect(summaries.compliance.expiredCount).toBeGreaterThanOrEqual(1);
    expect(summaries.compliance.maxDaysExpired).toBeGreaterThanOrEqual(COMPLIANCE_DAYS_EXPIRED);
  });

  test.afterAll(async () => {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
  });

  test("the Modules tab renders each tile's badges from its summary endpoint", async () => {
    await page.goto(`${BASE_URL}/safety`);
    await expect(page.getByTestId("heading-safety-hub")).toBeVisible();
    await page.getByTestId("tab-modules").click();

    // ---- SWPPP -----------------------------------------------------------
    {
      const total = summaries.swppp.openCount + summaries.swppp.overdueCount;
      await expect(page.getByTestId("badge-swppp-open-total")).toHaveText(`${total} active`);
      await expect(page.getByTestId("badge-swppp-overdue")).toContainText(
        `${summaries.swppp.overdueCount} overdue`,
      );
      await expect(page.getByTestId("badge-swppp-max-days-overdue")).toHaveText(
        daysLabel(summaries.swppp.maxDaysOverdue),
      );
    }

    // ---- Daily Inspector Reports ----------------------------------------
    {
      const total = summaries.idr.unsignedCount + summaries.idr.overdueCount;
      await expect(page.getByTestId("badge-idr-unsigned-total")).toHaveText(`${total} unsigned`);
      await expect(page.getByTestId("badge-idr-overdue")).toContainText(
        `${summaries.idr.overdueCount} overdue`,
      );
      await expect(page.getByTestId("badge-idr-max-days-overdue")).toHaveText(
        daysLabel(summaries.idr.maxDaysOverdue),
      );
    }

    // ---- Material Certifications ----------------------------------------
    {
      const total = summaries.material.expiringSoonCount + summaries.material.expiredCount;
      await expect(page.getByTestId("badge-material-certs-attention-total")).toHaveText(
        `${total} attention`,
      );
      await expect(page.getByTestId("badge-material-certs-expired")).toContainText(
        `${summaries.material.expiredCount} expired`,
      );
      await expect(page.getByTestId("badge-material-certs-max-days-expired")).toHaveText(
        daysLabel(summaries.material.maxDaysExpired),
      );
    }

    // ---- Safety Training ------------------------------------------------
    {
      const total = summaries.training.overdueCount + summaries.training.expiringSoonCount;
      await expect(page.getByTestId("badge-training-attention-total")).toHaveText(
        `${total} attention`,
      );
      await expect(page.getByTestId("badge-training-overdue")).toContainText(
        `${summaries.training.overdueCount} overdue`,
      );
      await expect(page.getByTestId("badge-training-max-days-overdue")).toHaveText(
        daysLabel(summaries.training.maxDaysOverdue),
      );
    }

    // ---- Compliance -----------------------------------------------------
    {
      const total = summaries.compliance.expiredCount + summaries.compliance.expiringSoonCount;
      await expect(page.getByTestId("badge-compliance-attention-total")).toHaveText(
        `${total} attention`,
      );
      await expect(page.getByTestId("badge-compliance-expired")).toContainText(
        `${summaries.compliance.expiredCount} expired`,
      );
      await expect(page.getByTestId("badge-compliance-max-days-expired")).toHaveText(
        daysLabel(summaries.compliance.maxDaysExpired),
      );
    }
  });
});
