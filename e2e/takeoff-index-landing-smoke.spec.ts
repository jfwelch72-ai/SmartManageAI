import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

// Task #2111 — Smoke coverage for the /takeoff landing page itself.
//
// Existing route smoke tests (e2e/takeoff-bid-route-smoke.spec.ts and
// e2e/takeoff-project-route-smoke.spec.ts) only click into a single
// entity from the landing page; neither asserts that BOTH the Bids and
// Projects sections render together with their headings, the search
// input, and the empty state. A dedicated landing-page spec catches
// regressions where one of the two sections, the search box, or the
// empty card silently disappears.
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface BidResponse {
  id: string;
  code: string;
  name: string;
  status?: string;
}

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
  status: string;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function createBid(page: Page, name: string): Promise<BidResponse> {
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name,
      clientName: "PW Takeoff Index Bid Client",
      bidAmount: "60000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

async function createProject(
  page: Page,
  name: string,
): Promise<ProjectResponse> {
  const res = await page.request.post(`${BASE_URL}/api/projects`, {
    data: {
      name,
      clientName: "PW Takeoff Index Project Client",
      status: "ACTIVE",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

test.describe("Takeoff index landing page smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("renders both Bids and Projects sections, headings, search, and clickable cards", async ({
    page,
  }) => {
    const suffix = Date.now();
    // Seed at least one bid and one project so both sections render. The
    // dev sandbox is shared, so other rows may also appear, but our
    // freshly-created entities are guaranteed to be present.
    const bid = await createBid(page, `PW Takeoff Index Bid ${suffix}`);
    const project = await createProject(
      page,
      `PW Takeoff Index Project ${suffix}`,
    );

    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });

    // Page shell must render before we start asserting on inner sections.
    await expect(page.getByTestId("takeoff-index-page")).toBeVisible({
      timeout: 15_000,
    });

    // The search input is a stable landmark on the landing page; assert
    // it renders so a regression that drops it is caught immediately.
    await expect(page.getByTestId("input-takeoff-search")).toBeVisible();

    // Both sections render side-by-side once data has loaded.
    await expect(page.getByTestId("takeoff-index-bids-section")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("takeoff-index-projects-section"),
    ).toBeVisible({ timeout: 15_000 });

    // Section headings carry literal labels users rely on to orient
    // themselves between the two lists.
    await expect(page.getByTestId("text-takeoff-bids-heading")).toHaveText(
      "Bids",
    );
    await expect(page.getByTestId("text-takeoff-projects-heading")).toHaveText(
      "Projects",
    );

    // Each section shows a count next to its heading; assert it renders
    // and reads as a positive integer (we just created one of each).
    const bidsCount = page.getByTestId("text-takeoff-bids-count");
    const projectsCount = page.getByTestId("text-takeoff-projects-count");
    await expect(bidsCount).toBeVisible();
    await expect(projectsCount).toBeVisible();
    expect(Number((await bidsCount.textContent())?.trim())).toBeGreaterThan(0);
    expect(Number((await projectsCount.textContent())?.trim())).toBeGreaterThan(
      0,
    );

    // Both freshly-created entity cards must render and be clickable.
    const bidLink = page.getByTestId(`link-takeoff-bid-${bid.code}`);
    const projectLink = page.getByTestId(`link-takeoff-project-${project.code}`);
    await expect(bidLink).toBeVisible({ timeout: 15_000 });
    await expect(projectLink).toBeVisible({ timeout: 15_000 });

    // wouter <Link> renders an <a>; the data-testid is on that anchor and
    // it should point at the standalone takeoff workspace for each kind.
    const bidHref = await bidLink.getAttribute("href");
    const projectHref = await projectLink.getAttribute("href");
    expect(bidHref).toBe(`/takeoff/${bid.code}`);
    expect(projectHref).toBe(`/takeoff/project/${project.code}`);
  });

  test("shows the empty card with both go-to buttons when no bids or projects match", async ({
    page,
  }) => {
    // The dev sandbox org is shared across tests so we cannot guarantee
    // zero bids and zero projects exist. Instead, drive the same code
    // path by typing a search query that no entity can match — the
    // landing page renders the same takeoff-index-empty card whenever
    // filteredBids and filteredProjects are both empty (see
    // client/src/pages/takeoff-index.tsx -> showEmptyState).
    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });

    const search = page.getByTestId("input-takeoff-search");
    await expect(search).toBeVisible({ timeout: 15_000 });

    // A long random string with no spaces will never match a bid/project
    // name, code, or client name in the seeded sandbox.
    const noMatchQuery = `__pw_takeoff_no_match_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}__`;
    await search.fill(noMatchQuery);

    // Empty card replaces the bids/projects sections.
    await expect(page.getByTestId("takeoff-index-empty")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("takeoff-index-bids-section"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("takeoff-index-projects-section"),
    ).toHaveCount(0);

    // Both shortcut buttons are present so the user can jump to either
    // list to create a new entity.
    const goToBids = page.getByTestId("button-takeoff-go-to-bids");
    const goToProjects = page.getByTestId("button-takeoff-go-to-projects");
    await expect(goToBids).toBeVisible();
    await expect(goToProjects).toBeVisible();

    // Both buttons render via Button asChild + wouter <Link>, so the
    // data-testid is forwarded onto the underlying <a> by Radix Slot.
    expect(await goToBids.getAttribute("href")).toBe("/bids");
    expect(await goToProjects.getAttribute("href")).toBe("/projects");
  });
});
