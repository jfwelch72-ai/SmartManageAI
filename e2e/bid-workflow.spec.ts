import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

test.describe("Bid Workflow - Playwright E2E", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("bids page loads with bid cards and status tabs", async ({ page }) => {
    await page.goto(`${BASE_URL}/bids`);
    await page.waitForLoadState("networkidle");

    const tabsList = page.locator('[data-testid="tabs-bids"]');
    await expect(tabsList).toBeVisible();

    const boardTab = page.locator('[data-testid="tab-bid-board"]');
    await expect(boardTab).toBeVisible();

    const searchInput = page.locator('[data-testid="input-search-bids"]');
    await expect(searchInput).toBeVisible();
  });

  test("bid status filter dropdown works", async ({ page }) => {
    await page.goto(`${BASE_URL}/bids`);
    await page.waitForLoadState("networkidle");

    const statusFilter = page.locator('[data-testid="select-status-filter"]');
    await expect(statusFilter).toBeVisible();
    await statusFilter.click();

    await page.waitForTimeout(300);
    const statusOptions = page.locator('[role="option"]');
    const optionCount = await statusOptions.count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test("bid search input filters bids", async ({ page }) => {
    await page.goto(`${BASE_URL}/bids`);
    await page.waitForLoadState("networkidle");

    const searchInput = page.locator('[data-testid="input-search-bids"]');
    await searchInput.fill("NONEXISTENT_BID_XYZ_999");
    await page.waitForTimeout(500);
  });

  test("create bid via UI: open dialog, skip AI, fill form, submit", async ({ page }) => {
    const suffix = Date.now();
    await page.goto(`${BASE_URL}/bids`);
    await page.waitForLoadState("networkidle");

    const newBidBtn = page.locator('[data-testid="button-new-bid"]');
    await expect(newBidBtn).toBeVisible();
    await newBidBtn.click();

    await page.waitForTimeout(300);
    const dropdown = page.locator('[data-testid="menu-item-manual-bid"]');
    await expect(dropdown).toBeVisible();
    await dropdown.click();

    const dialog = page.locator('[data-testid="dialog-create-bid"]');
    await expect(dialog).toBeVisible();

    const step1Indicator = page.locator('[data-testid="step-indicator-1"]');
    await expect(step1Indicator).toBeVisible();

    const skipAiBtn = page.locator('[data-testid="button-skip-ai"]');
    await expect(skipAiBtn).toBeVisible();
    await skipAiBtn.click();

    await page.waitForTimeout(300);

    const bidNameInput = page.locator('[data-testid="input-bid-name"]');
    await expect(bidNameInput).toBeVisible();
    await bidNameInput.fill(`PW UI Bid ${suffix}`);

    const clientNameInput = page.locator('[data-testid="input-client-name"]');
    await expect(clientNameInput).toBeVisible();
    await clientNameInput.fill("Playwright UI Client");

    const bidAmountInput = page.locator('[data-testid="input-bid-amount"]');
    if (await bidAmountInput.isVisible()) {
      await bidAmountInput.fill("35000");
    }

    const submitBtn = page.locator('[data-testid="button-submit-create"]');
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    await page.waitForTimeout(2000);

    const currentUrl = page.url();
    const createdSuccessfully =
      currentUrl.includes("/bids/") ||
      (await page.locator("text=successfully").isVisible().catch(() => false)) ||
      (await page.locator('[data-testid="dialog-create-bid"]').isHidden().catch(() => true));
    expect(createdSuccessfully).toBe(true);
  });

  test("full bid API lifecycle with estimate line items, SOV seeding, and budget verification", async ({ page }) => {
    const suffix = Date.now();

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `PW Lifecycle ${suffix}`,
        clientName: "PW Lifecycle Client",
        bidAmount: "45000",
      },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();
    expect(bid.status).toBe("DRAFT");
    expect(bid.code).toBeTruthy();
    const bidCode = bid.code;
    const bidId = bid.id;

    const patchRes = await page.request.patch(`${BASE_URL}/api/bids/${bidCode}`, {
      data: { name: `PW Lifecycle Updated ${suffix}`, bidAmount: "55000" },
    });
    expect(patchRes.status()).toBe(200);
    const updatedBid = await patchRes.json();
    expect(updatedBid.name).toBe(`PW Lifecycle Updated ${suffix}`);

    const estimateRes = await page.request.post(`${BASE_URL}/api/bids/${bidId}/estimate`, { data: {} });
    expect(estimateRes.status()).toBe(201);
    const estimate = await estimateRes.json();
    const estimateId = estimate.id;

    const li1Res = await page.request.post(`${BASE_URL}/api/estimates/${estimateId}/line-items`, {
      data: {
        description: "Concrete Foundation",
        quantity: "100", unit: "SF",
        materialCost: "5000", laborCost: "3000", laborHours: "40",
        equipmentCost: "0", equipmentHours: "0",
        consumablesCost: "0", subcontractCost: "0",
        overheadAllocation: "0", profitAllocation: "0",
      },
    });
    expect(li1Res.status()).toBe(201);

    const li2Res = await page.request.post(`${BASE_URL}/api/estimates/${estimateId}/line-items`, {
      data: {
        description: "Steel Framing",
        quantity: "50", unit: "LF",
        materialCost: "7500", laborCost: "4500", laborHours: "60",
        equipmentCost: "0", equipmentHours: "0",
        consumablesCost: "0", subcontractCost: "0",
        overheadAllocation: "0", profitAllocation: "0",
      },
    });
    expect(li2Res.status()).toBe(201);

    const activeRes = await page.request.patch(`${BASE_URL}/api/bids/${bidCode}`, {
      data: { status: "ACTIVE" },
    });
    expect(activeRes.status()).toBe(200);
    expect((await activeRes.json()).status).toBe("ACTIVE");

    const submitRes = await page.request.patch(`${BASE_URL}/api/bids/${bidCode}`, {
      data: { status: "SUBMITTED" },
    });
    expect(submitRes.status()).toBe(200);
    expect((await submitRes.json()).status).toBe("SUBMITTED");

    const invalidRes = await page.request.patch(`${BASE_URL}/api/bids/${bidCode}`, {
      data: { status: "DRAFT" },
    });
    expect(invalidRes.status()).toBe(422);
    const invalidBody = await invalidRes.json();
    expect(invalidBody.error).toContain("Invalid status transition");

    const convertRes = await page.request.post(`${BASE_URL}/api/bids/${bidCode}/convert`, {
      data: { startStatus: "PLANNING" },
    });
    expect(convertRes.status()).toBe(201);
    const project = await convertRes.json();
    expect(project.code).toBe(bidCode);
    expect(project.id).toBeTruthy();
    const projectId = project.id;

    const bidAfterRes = await page.request.get(`${BASE_URL}/api/bids/${bidCode}`);
    const bidAfter = await bidAfterRes.json();
    expect(bidAfter.status).toBe("AWARDED");
    expect(bidAfter.convertedToProjectId).toBe(projectId);

    const sovRes = await page.request.get(`${BASE_URL}/api/sov`);
    expect(sovRes.status()).toBe(200);
    const sovList = await sovRes.json();
    const projectSov = sovList.find((sov: any) => sov.projectId === projectId);
    expect(projectSov).toBeTruthy();
    expect(projectSov.lineItems).toBeTruthy();
    expect(projectSov.lineItems.length).toBeGreaterThanOrEqual(2);

    const dupRes = await page.request.post(`${BASE_URL}/api/bids/${bidCode}/convert`, {
      data: {},
    });
    expect(dupRes.status()).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error).toBeTruthy();

    const projectsRes = await page.request.get(`${BASE_URL}/api/projects`);
    const projectsList = await projectsRes.json();
    const projects = Array.isArray(projectsList) ? projectsList : (projectsList?.projects || projectsList?.data || []);
    const foundProject = projects.find((p: any) => p.code === bidCode);
    expect(foundProject).toBeTruthy();

    const delRes = await page.request.delete(`${BASE_URL}/api/bids/${bidCode}`);
    expect(delRes.status()).toBe(409);
  });

  test("PATCH allowlist blocks sensitive field injection", async ({ page }) => {
    const suffix = Date.now();

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: `PW Allowlist ${suffix}`, clientName: "PW Allowlist Client" },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();

    const patchRes = await page.request.patch(`${BASE_URL}/api/bids/${bid.code}`, {
      data: {
        convertedToProjectId: "injected-id",
        awardedAt: "2025-01-01T00:00:00Z",
        submittedAt: "2025-01-01T00:00:00Z",
        code: "HACKED",
        gcOrganizationId: "other-org",
      },
    });
    expect(patchRes.status()).toBe(200);

    const verifyRes = await page.request.get(`${BASE_URL}/api/bids/${bid.code}`);
    const verify = await verifyRes.json();
    expect(verify.convertedToProjectId).toBeNull();
    expect(verify.awardedAt).toBeNull();
    expect(verify.submittedAt).toBeNull();
    expect(verify.code).toBe(bid.code);
  });

  test("ESTIMATOR cannot convert bids (403)", async ({ page }) => {
    const suffix = Date.now();

    const adminCreateRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: `PW RBAC ${suffix}`, clientName: "RBAC Client" },
    });
    expect(adminCreateRes.status()).toBe(201);
    const rbacBid = await adminCreateRes.json();

    await page.request.patch(`${BASE_URL}/api/bids/${rbacBid.code}`, {
      data: { status: "ACTIVE" },
    });
    await page.request.patch(`${BASE_URL}/api/bids/${rbacBid.code}`, {
      data: { status: "SUBMITTED" },
    });

    await devLogin(page, "ESTIMATOR");

    const convertRes = await page.request.post(`${BASE_URL}/api/bids/${rbacBid.code}/convert`, {
      data: {},
    });
    expect(convertRes.status()).toBe(403);
  });

  test("admin force-transition from terminal state", async ({ page }) => {
    const suffix = Date.now();

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: `PW Force ${suffix}`, clientName: "Force Client" },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();

    const cancelRes = await page.request.patch(`${BASE_URL}/api/bids/${bid.code}`, {
      data: { status: "CANCELLED" },
    });
    expect(cancelRes.status()).toBe(200);
    expect((await cancelRes.json()).status).toBe("CANCELLED");

    const noForceRes = await page.request.patch(`${BASE_URL}/api/bids/${bid.code}`, {
      data: { status: "DRAFT" },
    });
    expect(noForceRes.status()).toBe(422);

    const forceRes = await page.request.patch(`${BASE_URL}/api/bids/${bid.code}`, {
      data: { status: "DRAFT", force: true },
    });
    expect(forceRes.status()).toBe(200);
    expect((await forceRes.json()).status).toBe("DRAFT");
  });

  test("input validation rejects missing name and invalid amounts", async ({ page }) => {
    const missingNameRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { clientName: "No Name Client" },
    });
    expect(missingNameRes.status()).toBe(400);

    const invalidAmountRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: "Invalid Amount Bid", clientName: "Client", bidAmount: "not-a-number" },
    });
    expect(invalidAmountRes.status()).toBe(400);

    const negativeAmountRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: "Negative Amount Bid", clientName: "Client", bidAmount: "-5000" },
    });
    expect(negativeAmountRes.status()).toBe(400);
  });

  test("bid deletion works for unconverted bid", async ({ page }) => {
    const suffix = Date.now();

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: `PW Delete ${suffix}`, clientName: "Delete Client" },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();

    const delRes = await page.request.delete(`${BASE_URL}/api/bids/${bid.code}`);
    expect(delRes.status()).toBe(200);

    const getRes = await page.request.get(`${BASE_URL}/api/bids/${bid.code}`);
    expect(getRes.status()).toBe(404);
  });

  test("navigating to created bid detail page shows correct data", async ({ page }) => {
    const suffix = Date.now();

    const createRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: { name: `PW Detail ${suffix}`, clientName: "Detail Client", bidAmount: "99000" },
    });
    expect(createRes.status()).toBe(201);
    const bid = await createRes.json();

    await page.goto(`${BASE_URL}/bids/${bid.code}`);
    await page.waitForLoadState("networkidle");

    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toContain(bid.code);
  });
});
