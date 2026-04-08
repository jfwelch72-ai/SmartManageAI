import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status: string;
  description: string | null;
  contractAmount: string | null;
  scopeItems?: unknown[];
}

interface ProjectListResponse {
  data: ProjectResponse[];
  pagination: { page: number; limit: number; totalCount: number; totalPages: number };
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

test.describe("Project CRUD E2E", () => {
  test.beforeEach(async ({ page }) => {
    await devLogin(page, "ADMIN");
  });

  test("create project via API and verify in list", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: {
        name: `PW Project ${suffix}`,
        clientName: "PW Test Client",
        description: "Created by Playwright test",
        contractAmount: "150000",
        status: "PLANNING",
      },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;
    expect(project.code).toBeTruthy();
    expect(project.name).toBe(`PW Project ${suffix}`);
    expect(project.status).toBe("PLANNING");

    const listRes = await page.request.get(`${BASE_URL}/api/projects`);
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as ProjectListResponse;
    const data = listBody.data || [];
    const found = data.find((p: ProjectResponse) => p.code === project.code);
    expect(found).toBeTruthy();
  });

  test("get project by code returns detail with scope items", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Detail ${suffix}`, clientName: "Detail Client" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const getRes = await page.request.get(`${BASE_URL}/api/projects/${project.code}`);
    expect(getRes.status()).toBe(200);
    const detail = (await getRes.json()) as ProjectResponse;
    expect(detail.code).toBe(project.code);
    expect(detail.scopeItems).toBeDefined();
  });

  test("update project fields", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Update ${suffix}`, clientName: "Update Client" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const patchRes = await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { name: `PW Updated ${suffix}`, description: "Updated description" },
    });
    expect(patchRes.status()).toBe(200);
    const updated = (await patchRes.json()) as ProjectResponse;
    expect(updated.name).toBe(`PW Updated ${suffix}`);
  });

  test("project status transitions follow valid paths", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Status ${suffix}`, clientName: "Status Client", status: "PLANNING" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const activeRes = await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });
    expect(activeRes.status()).toBe(200);
    expect(((await activeRes.json()) as ProjectResponse).status).toBe("ACTIVE");

    const completeRes = await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "COMPLETE" },
    });
    expect(completeRes.status()).toBe(200);
    expect(((await completeRes.json()) as ProjectResponse).status).toBe("COMPLETE");
  });

  test("invalid status transition returns 422", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Invalid ${suffix}`, clientName: "Invalid Client", status: "PLANNING" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const invalidRes = await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "CLOSED" },
    });
    expect(invalidRes.status()).toBe(422);
  });

  test("get nonexistent project returns 404", async ({ page }) => {
    const getRes = await page.request.get(`${BASE_URL}/api/projects/NONEXISTENT_CODE_999`);
    expect(getRes.status()).toBe(404);
  });

  test("delete project", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Delete ${suffix}`, clientName: "Delete Client" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    const delRes = await page.request.delete(`${BASE_URL}/api/projects/${project.code}`);
    expect(delRes.status()).toBe(200);

    const getRes = await page.request.get(`${BASE_URL}/api/projects/${project.code}`);
    expect(getRes.status()).toBe(404);
  });

  test("create project with missing name returns error", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { clientName: "No Name Client" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("FIELD_WORKER can only see ACTIVE projects", async ({ page }) => {
    const suffix = Date.now();
    await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Planning ${suffix}`, clientName: "Planning Client", status: "PLANNING" },
    });

    const activeRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Active ${suffix}`, clientName: "Active Client", status: "PLANNING" },
    });
    expect(activeRes.status()).toBe(201);
    const activeProject = (await activeRes.json()) as ProjectResponse;
    await page.request.patch(`${BASE_URL}/api/projects/${activeProject.code}`, {
      data: { status: "ACTIVE" },
    });

    await devLogin(page, "FIELD_WORKER");

    const listRes = await page.request.get(`${BASE_URL}/api/projects`);
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as ProjectListResponse;
    const data = listBody.data || [];
    for (const p of data) {
      expect(p.status).toBe("ACTIVE");
    }
  });

  test("FIELD_WORKER cannot create projects (403)", async ({ page }) => {
    await devLogin(page, "FIELD_WORKER");
    const res = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: "FW Project", clientName: "FW Client" },
    });
    expect(res.status()).toBe(403);
  });

  test("project financials endpoint returns data", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Fin ${suffix}`, clientName: "Fin Client", contractAmount: "200000", status: "PLANNING" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
      data: { status: "ACTIVE" },
    });

    const finRes = await page.request.get(`${BASE_URL}/api/projects/${project.code}/financials`);
    expect(finRes.status()).toBe(200);
    const fin = (await finRes.json()) as FinancialResponse;
    expect(fin).toBeDefined();
  });

  test("project detail page renders in browser", async ({ page }) => {
    const suffix = Date.now();
    const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
      data: { name: `PW Page ${suffix}`, clientName: "Page Client" },
    });
    expect(createRes.status()).toBe(201);
    const project = (await createRes.json()) as ProjectResponse;

    await page.goto(`${BASE_URL}/projects/${project.code}`);
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toContain(project.code);
  });
});
