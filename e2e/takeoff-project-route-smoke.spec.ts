import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #2081 — Smoke coverage for the project takeoff route landing page,
// the standalone /takeoff/project/:projectCode workspace, and the
// "Open Full-Screen Takeoff" deep link from the project Plans tab. These
// surfaces had no automated coverage and previously regressed silently
// when routing or the bid-vs-project context switch shifted.
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  projectId: string | null;
  bidId: string | null;
  sheetIndex: number;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function createProject(page: Page, name: string): Promise<ProjectResponse> {
  const res = await page.request.post(`${BASE_URL}/api/projects`, {
    data: {
      name,
      clientName: "PW Takeoff Project Client",
      status: "ACTIVE",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function uploadProjectSheet(
  page: Page,
  projectId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
  const planRes = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/takeoff/plans`,
    {
      data: {
        fileUrl: upload.objectKey,
        objectKey: upload.objectKey,
        fileName,
      },
    },
  );
  expect(planRes.status()).toBe(201);
  const planBody = (await planRes.json()) as { sheets: SheetResponse[] };
  expect(planBody.sheets.length).toBeGreaterThan(0);
  return planBody.sheets[0];
}

test.describe("Project takeoff route smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("landing page surfaces both Bids and Projects sections", async ({ page }) => {
    const suffix = Date.now();
    // Ensure at least one of each entity exists in the dev sandbox org so
    // both sections render. The dev seed usually has bids/projects but we
    // create our own to keep this self-contained.
    const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
      data: {
        name: `PW Takeoff Bid ${suffix}`,
        clientName: "PW Takeoff Bid Client",
        bidAmount: "50000",
      },
    });
    expect(bidRes.status()).toBe(201);
    const project = await createProject(page, `PW Takeoff Project ${suffix}`);

    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });

    // The takeoff index renders both sections side-by-side; assert headings
    // and that the freshly-created project card is clickable.
    await expect(page.getByTestId("takeoff-index-bids-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("takeoff-index-projects-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("text-takeoff-bids-heading")).toHaveText("Bids");
    await expect(page.getByTestId("text-takeoff-projects-heading")).toHaveText(
      "Projects",
    );

    const projectLink = page.getByTestId(`link-takeoff-project-${project.code}`);
    await expect(projectLink).toBeVisible({ timeout: 15_000 });
  });

  test("clicking a project on /takeoff opens the project workspace with header", async ({
    page,
  }) => {
    const suffix = Date.now();
    const project = await createProject(page, `PW Takeoff Header ${suffix}`);

    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });
    const projectLink = page.getByTestId(`link-takeoff-project-${project.code}`);
    await expect(projectLink).toBeVisible({ timeout: 15_000 });
    await projectLink.click();

    await page.waitForURL(`**/takeoff/project/${project.code}`, {
      timeout: 15_000,
    });

    // Project context header should render (Folder icon area, "Back to
    // Project" button, "Open Project Detail" button, project name + code
    // badge).
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("button-back-to-project")).toBeVisible();
    await expect(page.getByTestId("button-back-to-project")).toContainText(
      "Project",
    );
    await expect(page.getByTestId("button-open-project-detail")).toBeVisible();
    await expect(page.getByTestId("button-open-project-detail")).toContainText(
      "Open Project Detail",
    );
    await expect(page.getByTestId("text-takeoff-project-title")).toContainText(
      project.name,
    );
    await expect(page.getByTestId("badge-takeoff-project-code")).toContainText(
      project.code,
    );

    // The project header uses the lucide Folder icon (vs the bid header's
    // FileText), which is the visual cue distinguishing the two contexts.
    // lucide-react renders the icon as <svg class="lucide lucide-folder">.
    await expect(
      page.getByTestId("takeoff-workspace-page").locator("svg.lucide-folder").first(),
    ).toBeVisible();

    // The "Back to Project" link should target /projects/<code>. The Button
    // is rendered via `asChild`, so the data-testid is forwarded onto the
    // underlying <a> element by Radix's Slot.
    const backHref = await page
      .getByTestId("button-back-to-project")
      .getAttribute("href");
    expect(backHref).toBe(`/projects/${project.code}`);
  });

  test("'Open Full-Screen Takeoff' on the Plans tab preserves selected sheet via ?sheet=", async ({
    page,
  }) => {
    const suffix = Date.now();
    const project = await createProject(page, `PW Takeoff Plans ${suffix}`);
    const sheet = await uploadProjectSheet(
      page,
      project.id,
      `PW Plans Sheet ${suffix}`,
    );

    // Pre-seed the sheet selection in sessionStorage so the embedded
    // takeoff in PlansTab boots with this sheet selected without us having
    // to drive the sheet picker UI. PlansTab reads this exact key on mount
    // (see client/src/components/project-tabs/PlansTab.tsx — the
    // `takeoff-sheet-${project.id}` storage key).
    //
    // addInitScript runs before any page script on every navigation in
    // this context, so the value is in place when PlansTab initializes.
    await page.addInitScript(
      ([key, value]) => {
        try {
          sessionStorage.setItem(key, value);
        } catch {
          // Ignore — sessionStorage may be unavailable in some contexts.
        }
      },
      [`takeoff-sheet-${project.id}`, sheet.id] as const,
    );

    await page.goto(`${BASE_URL}/projects/${project.code}?tab=plans`, {
      waitUntil: "domcontentloaded",
    });

    const openWorkspaceBtn = page.getByTestId(
      "button-open-project-takeoff-workspace",
    );
    await expect(openWorkspaceBtn).toBeVisible({ timeout: 30_000 });

    // The button is a wouter <Link>, rendered as an <a>. Verify its href
    // includes the sheet query param before clicking so we get a precise
    // failure message if the deep link breaks. data-testid is forwarded
    // onto the underlying <a> by Radix Slot (Button asChild).
    const href = await openWorkspaceBtn.getAttribute("href");
    expect(href).toBe(`/takeoff/project/${project.code}?sheet=${sheet.id}`);

    await openWorkspaceBtn.click();
    await page.waitForURL(
      `**/takeoff/project/${project.code}?sheet=${sheet.id}`,
      { timeout: 15_000 },
    );

    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("badge-takeoff-project-code")).toContainText(
      project.code,
    );

    const search = new URL(page.url()).search;
    expect(search).toContain(`sheet=${sheet.id}`);
  });
});
