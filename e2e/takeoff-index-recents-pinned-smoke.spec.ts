import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #2128 — Smoke coverage for the /takeoff landing page's pinned and
// recents block (`takeoff-index-recents`, `takeoff-index-pinned`, and
// `link-takeoff-recent-*` cards with their Pin/Unpin/Remove buttons).
//
// e2e/takeoff-index-landing-smoke.spec.ts (Task #2111) covers the Bids
// section, Projects section, search, and empty state — but it never
// asserts the recents rail, which is the surface most repeat users
// click into when they return to /takeoff. A regression that drops the
// rail or breaks the pin/remove toggles would silently degrade the
// daily flow without any test catching it.
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

async function clearServerRecents(page: Page): Promise<void> {
  // The dev sandbox user is shared across runs, so previous test runs
  // may have left server-side recents around. Wipe them so each test
  // starts with a deterministic, empty rail.
  const res = await page.request.delete(
    `${BASE_URL}/api/takeoff/recents/all`,
  );
  expect([200, 204]).toContain(res.status());
}

async function createBid(page: Page, name: string): Promise<BidResponse> {
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name,
      clientName: "PW Takeoff Recents Bid Client",
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
      clientName: "PW Takeoff Recents Project Client",
      status: "ACTIVE",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function uploadBidSheet(
  page: Page,
  bidId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL });
  const planRes = await page.request.post(
    `${BASE_URL}/api/bids/${bidId}/takeoff/plans`,
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

test.describe("Takeoff index recents + pinned smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
    await clearServerRecents(page);
  });

  test("opening a bid records a recent card; pin moves it to pinned and remove deletes it", async ({
    page,
  }) => {
    const suffix = Date.now();
    const bid = await createBid(page, `PW Takeoff Recents Bid ${suffix}`);

    // Open the standalone bid takeoff workspace once so it gets recorded
    // in the per-user recents rail (see TakeoffWorkspacePage's
    // recordRecent useEffect).
    await page.goto(`${BASE_URL}/takeoff/${bid.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    // Wait for the bid title — that's our signal the bid query resolved
    // and recordRecent has run with non-null entityId/Code/Name.
    await expect(page.getByTestId("text-takeoff-bid-title")).toContainText(
      bid.name,
      { timeout: 15_000 },
    );

    // Return to the landing page; the recents rail should now show our
    // freshly-opened bid as a Recent (unpinned) card.
    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("takeoff-index-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("takeoff-index-recents")).toBeVisible({
      timeout: 15_000,
    });

    // The recent card uses testKey = `${kind}-${entityCode}` (no sheet),
    // so for a bid with code B-123 the testid is link-takeoff-recent-bid-B-123.
    const recentCard = page.getByTestId(`link-takeoff-recent-bid-${bid.code}`);
    await expect(recentCard).toBeVisible({ timeout: 15_000 });

    // The card is a wouter <Link>, rendered as an <a>. Without a sheet,
    // the href deep-links back to the standalone bid workspace.
    const recentHref = await recentCard.getAttribute("href");
    expect(recentHref).toBe(`/takeoff/${bid.code}`);

    // Pin button is a sibling of the link inside the same RecentCard.
    // Clicking it should move the entry into the pinned section and
    // swap the Pin button for an Unpin button.
    const pinBtn = page.getByTestId(`button-takeoff-recent-pin-bid-${bid.code}`);
    await expect(pinBtn).toBeVisible();
    await pinBtn.click();

    await expect(page.getByTestId("takeoff-index-pinned")).toBeVisible({
      timeout: 10_000,
    });

    // After pinning, the same card lives inside takeoff-index-pinned and
    // its toggle button is now button-takeoff-recent-unpin-…. Scope the
    // assertion to the pinned section so we don't accidentally match a
    // duplicate in the Recent group.
    const pinnedSection = page.getByTestId("takeoff-index-pinned");
    await expect(
      pinnedSection.getByTestId(`link-takeoff-recent-bid-${bid.code}`),
    ).toBeVisible();
    await expect(
      pinnedSection.getByTestId(`button-takeoff-recent-unpin-bid-${bid.code}`),
    ).toBeVisible();
    // The pin button for this entry should no longer exist anywhere on
    // the page (the entry only appears once now, in the pinned group).
    await expect(
      page.getByTestId(`button-takeoff-recent-pin-bid-${bid.code}`),
    ).toHaveCount(0);

    // Remove (X) button drops the entry out of the rail entirely. The
    // remove control lives next to the unpin/pin toggle inside the same
    // pinned card.
    const removeBtn = pinnedSection.getByTestId(
      `button-takeoff-recent-remove-bid-${bid.code}`,
    );
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();

    // The card and its action buttons must be gone from both the pinned
    // and the recent groups.
    await expect(
      page.getByTestId(`link-takeoff-recent-bid-${bid.code}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`button-takeoff-recent-unpin-bid-${bid.code}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`button-takeoff-recent-remove-bid-${bid.code}`),
    ).toHaveCount(0);
  });

  test("opening a project takeoff records a recent card with a project deep-link", async ({
    page,
  }) => {
    const suffix = Date.now();
    const project = await createProject(
      page,
      `PW Takeoff Recents Project ${suffix}`,
    );

    await page.goto(`${BASE_URL}/takeoff/project/${project.code}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("text-takeoff-project-title")).toContainText(
      project.name,
      { timeout: 15_000 },
    );

    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("takeoff-index-recents")).toBeVisible({
      timeout: 15_000,
    });

    const recentCard = page.getByTestId(
      `link-takeoff-recent-project-${project.code}`,
    );
    await expect(recentCard).toBeVisible({ timeout: 15_000 });

    // Project entries deep-link back to /takeoff/project/{code}.
    const recentHref = await recentCard.getAttribute("href");
    expect(recentHref).toBe(`/takeoff/project/${project.code}`);
  });

  test("opening a bid sheet via ?sheet= records a sheet-scoped recent whose href preserves the sheet param", async ({
    page,
  }) => {
    const suffix = Date.now();
    const bid = await createBid(page, `PW Takeoff Recents Sheet ${suffix}`);
    const sheet = await uploadBidSheet(
      page,
      bid.id,
      `PW Recents Sheet ${suffix}`,
    );

    // Deep-link directly to the workspace with the sheet pre-selected so
    // the workspace fires recordRecent with sheetId set (see the
    // initialSheetId useEffect that watches sheetsData).
    await page.goto(`${BASE_URL}/takeoff/${bid.code}?sheet=${sheet.id}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("takeoff-workspace-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("text-takeoff-bid-title")).toContainText(
      bid.name,
      { timeout: 15_000 },
    );

    // Wait for the sheet-specific recent to be recorded. The workspace
    // also records a sheet-less entry on bid load, so both will exist —
    // we just need the sheet-scoped one to surface.
    await page.goto(`${BASE_URL}/takeoff`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("takeoff-index-recents")).toBeVisible({
      timeout: 15_000,
    });

    // testKey for a sheet-specific entry is `${kind}-${entityCode}-${sheetId}`.
    const sheetCard = page.getByTestId(
      `link-takeoff-recent-bid-${bid.code}-${sheet.id}`,
    );
    await expect(sheetCard).toBeVisible({ timeout: 15_000 });

    // The recent card's href must round-trip the sheet selection so a
    // user clicking back into the workspace lands on the same sheet.
    const sheetHref = await sheetCard.getAttribute("href");
    expect(sheetHref).toBe(
      `/takeoff/${bid.code}?sheet=${encodeURIComponent(sheet.id)}`,
    );
  });
});
