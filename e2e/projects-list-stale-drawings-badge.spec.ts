import { test, expect, type Page } from "@playwright/test";
import { authedRequest } from "./helpers/csrf";
import { uploadFixturePdf } from "./helpers/uploadFixturePdf";

// Task #1916 — UI coverage for the portfolio-level "out of date drawings"
// indicator on /projects. The backend roll-up is unit-tested in
// server/__tests__/drawing-set-stale-summary.test.ts; this spec exercises
// StaleDrawingsBadge end-to-end (visibility, label, and click-through to
// the project's Plans tab).

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface SheetResponse {
  id: string;
  sheetName: string | null;
  projectId: string | null;
  isActive: boolean | null;
}

interface PlanCreateResponse {
  sheets: SheetResponse[];
}

interface DrawingSetResponse {
  id: string;
  projectId: string;
  name: string;
  isPrimary: boolean;
}

async function devLogin(page: Page, role = "ADMIN"): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function createProject(page: Page, name: string): Promise<ProjectResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/projects`, {
    data: { name, clientName: "Stale Badge Client", status: "PLANNING" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function uploadSheet(
  page: Page,
  projectId: string,
  fileName: string,
): Promise<SheetResponse> {
  const upload = await uploadFixturePdf(page, { baseUrl: BASE_URL, label: fileName });
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/${projectId}/takeoff/plans`,
    { data: { fileUrl: upload.objectKey, objectKey: upload.objectKey, fileName } },
  );
  expect(res.status()).toBe(201);
  const body = (await res.json()) as PlanCreateResponse;
  expect(body.sheets.length).toBeGreaterThan(0);
  return body.sheets[0];
}

async function createDrawingSet(
  page: Page,
  projectId: string,
  name: string,
): Promise<DrawingSetResponse> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/${projectId}/drawing-sets`,
    { data: { name } },
  );
  expect(res.status()).toBe(201);
  return (await res.json()) as DrawingSetResponse;
}

async function pinSheet(page: Page, setId: string, sheetId: string): Promise<void> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/projects/drawing-sets/${setId}/items`,
    { data: { sheetId } },
  );
  expect(res.status()).toBe(201);
}

async function supersedeSheet(
  page: Page,
  oldSheetId: string,
  newSheetId: string,
): Promise<void> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/takeoff/sheets/${oldSheetId}/supersede`,
    { data: { newSheetId } },
  );
  expect(res.status()).toBe(200);
}

test.describe("Task #1916 — Projects list stale drawings indicator", () => {
  test("badge renders only on stale rows and click-through opens the Plans tab", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = Date.now();

    await devLogin(page, "ADMIN");

    // Two projects share a unique suffix so the projects-list search input
    // can filter to exactly these rows (the dev sandbox org accumulates
    // projects across test runs).
    const stale = await createProject(page, `PW Stale Badge ${suffix} STALE`);
    const clean = await createProject(page, `PW Stale Badge ${suffix} CLEAN`);

    // Stale project: pin v1, then upload v2 with the same fileName so both
    // sheets share `sheetName`, then supersede v1 → v2 so v2 is the active
    // revision and the pinned v1 is now out-of-date.
    const staleFile = `pw-stale-badge-${suffix}.pdf`;
    const staleV1 = await uploadSheet(page, stale.id, staleFile);
    const staleSet = await createDrawingSet(page, stale.id, `Stale Set ${suffix}`);
    await pinSheet(page, staleSet.id, staleV1.id);
    const staleV2 = await uploadSheet(page, stale.id, staleFile);
    expect(staleV2.id).not.toBe(staleV1.id);
    expect(staleV2.sheetName).toBe(staleV1.sheetName);
    await supersedeSheet(page, staleV1.id, staleV2.id);

    // Clean project: pin the latest active sheet — no superseded version, so
    // the badge must NOT render for this row.
    const cleanV1 = await uploadSheet(page, clean.id, `pw-clean-badge-${suffix}.pdf`);
    const cleanSet = await createDrawingSet(page, clean.id, `Clean Set ${suffix}`);
    await pinSheet(page, cleanSet.id, cleanV1.id);

    // Sanity-check the backend roll-up agrees before driving the UI so a
    // failure in the spec points at the badge rather than the API.
    const summaryRes = await page.request.get(
      `${BASE_URL}/api/projects/drawing-sets/stale-summary`,
    );
    expect(summaryRes.status()).toBe(200);
    const summaryBody = (await summaryRes.json()) as {
      summary: Record<string, { staleSetCount: number; newerSheetCount: number }>;
    };
    expect(summaryBody.summary[stale.id]).toEqual({
      staleSetCount: 1,
      newerSheetCount: 1,
    });
    expect(summaryBody.summary[clean.id]).toBeUndefined();

    await page.goto(`${BASE_URL}/projects`, { waitUntil: "domcontentloaded" });

    // Filter the (potentially long) list down to just our two test rows.
    const search = page.getByTestId("input-search");
    await search.waitFor({ state: "visible", timeout: 15_000 });
    await search.fill(`PW Stale Badge ${suffix}`);

    const staleRow = page.getByTestId(`row-project-${stale.code}`);
    const cleanRow = page.getByTestId(`row-project-${clean.code}`);
    await expect(staleRow).toBeVisible({ timeout: 15_000 });
    await expect(cleanRow).toBeVisible();

    // Stale row exposes the amber badge with the "1 newer" label. Scope to
    // the desktop table row — ProjectsTable also renders a mobile card view
    // (hidden via CSS at md+ breakpoints) which would otherwise duplicate
    // the testid in the DOM.
    const staleBadge = staleRow.getByTestId(
      `badge-project-stale-drawings-${stale.code}`,
    );
    await expect(staleBadge).toBeVisible({ timeout: 15_000 });
    await expect(staleBadge).toHaveText(/1 newer/);
    await expect(staleBadge).toHaveAttribute(
      "aria-label",
      "1 newer drawing sheet available across 1 set",
    );

    // Hover reveals the radix tooltip with the same wording the
    // StaleDrawingsBadge component renders inside <TooltipContent>.
    await staleBadge.hover();
    await expect(
      page.getByRole("tooltip", {
        name: /1 newer sheet available across 1 drawing set\. Click to open the Plans tab\./,
      }),
    ).toBeVisible({ timeout: 5_000 });

    // Clean row has no badge at all (component returns null when summary is
    // missing or newerSheetCount is 0).
    await expect(
      cleanRow.getByTestId(`badge-project-stale-drawings-${clean.code}`),
    ).toHaveCount(0);

    // Click the badge → SPA navigation to /projects/{code}?tab=plans with
    // the Plans tab pre-selected.
    await staleBadge.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/${stale.code}\\?tab=plans$`),
      { timeout: 15_000 },
    );

    // Wait for the project detail page to finish loading (initially renders
    // a "Loading..." placeholder while the project query resolves).
    await expect(page.getByTestId("project-hub-nav-rail")).toBeVisible({
      timeout: 30_000,
    });

    // The desktop nav rail marks the active tab via aria-current="page" on
    // the nav-item button (project-detail.tsx renders this only when the
    // tab is selected).
    const plansNavItem = page.getByTestId("nav-item-plans");
    await expect(plansNavItem).toBeVisible({ timeout: 15_000 });
    await expect(plansNavItem).toHaveAttribute("aria-current", "page");

    // PlansTab itself is mounted only when the parent tab is "plans" — its
    // sub-tab Button confirms the Plans content is rendered.
    await expect(page.getByTestId("tab-plans")).toBeVisible({ timeout: 30_000 });
  });
});
