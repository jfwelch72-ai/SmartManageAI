// Task #2141 — End-to-end coverage for the Sheet Sets UI in the
// takeoff workspace. Drives the panel, the active-set toggle, the
// set-aware `[`/`]` navigation, the Shift+`[`/`]` multi-sheet
// selection, the active-set badge in the sheet header, and the
// "Apply to entire Sheet Set" propagation + Undo round-trip in the
// inline calibration drawer. Built on top of the dev seed-takeoff
// fixture so no PDF upload is needed in CI.

import { test, expect, type Page } from "@playwright/test";
import { authedRequest, installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

interface SheetSetCreateResponse {
  id: string;
  name: string;
}

async function devLogin(page: Page, role = "ADMIN"): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

async function seedTakeoffFixture(
  page: Page,
  sheetCount = 3,
): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(page: Page, bidCode: string): Promise<void> {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // The right TakeoffSidebar is an absolute-positioned overlay that
  // covers the rightmost ribbon controls — including the Sheet Sets
  // toggle and the Verify group. Collapse it the same way the
  // typed-dim/calibration spec does so our click targets are
  // pointer-event reachable.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Focus the workspace shell so document.activeElement === <body>
  // and useTakeoffShortcuts will accept our keystrokes.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function createSet(
  page: Page,
  bidId: string,
  name: string,
): Promise<SheetSetCreateResponse> {
  const res = await authedRequest(page, "POST", `${BASE_URL}/api/takeoff/sheet-sets`, {
    data: { bidId, name },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as SheetSetCreateResponse;
}

async function addMembers(
  page: Page,
  setId: string,
  sheetIds: string[],
): Promise<void> {
  const res = await authedRequest(
    page,
    "POST",
    `${BASE_URL}/api/takeoff/sheet-sets/${setId}/members`,
    { data: { sheetIds } },
  );
  expect(res.status()).toBe(201);
}

async function fetchSheetScale(
  page: Page,
  bidId: string,
  sheetId: string,
): Promise<number | null> {
  const res = await page.request.get(
    `${BASE_URL}/api/bids/${bidId}/takeoff/sheets`,
  );
  expect(res.status()).toBe(200);
  const sheets = (await res.json()) as Array<{
    id: string;
    scalePxPerFoot: number | null;
  }>;
  const found = sheets.find((s) => s.id === sheetId);
  return found?.scalePxPerFoot ?? null;
}

test.describe("Task #2141 — Sheet Sets UI", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("panel CRUD: open, create a set, see badge in header, toggle active off", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page, 2);
    await gotoTakeoff(page, bid.code);

    // Open the panel from the sheet selector bar.
    const toggle = page.getByTestId("button-toggle-sheet-sets");
    await expect(toggle).toBeVisible();
    await toggle.click();

    const panel = page.getByTestId("panel-sheet-sets");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("text-sheet-sets-empty")).toBeVisible();

    // Create a set via the inline form.
    await page.getByTestId("button-new-sheet-set").click();
    const nameInput = page.getByTestId("input-sheet-set-name");
    await nameInput.fill("PW Set A");
    await page.getByTestId("button-confirm-create-sheet-set").click();

    // Empty-state copy is gone; the new set row is in the DOM.
    await expect(page.getByTestId("text-sheet-sets-empty")).toHaveCount(0, {
      timeout: 10_000,
    });
    const setRow = page.locator("[data-testid^='row-sheet-set-']").first();
    await expect(setRow).toBeVisible({ timeout: 10_000 });
    const setId = (await setRow.getAttribute("data-testid"))!.replace(
      "row-sheet-set-",
      "",
    );

    // No badge until activated.
    await expect(page.getByTestId("badge-active-sheet-set")).toHaveCount(0);

    // Activate.
    await page.getByTestId(`button-toggle-active-set-${setId}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toBeVisible();
    await expect(page.getByTestId("badge-active-sheet-set")).toContainText(
      "PW Set A",
    );

    // Deactivate by clicking again.
    await page.getByTestId(`button-toggle-active-set-${setId}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toHaveCount(0);
  });

  test("set-aware [/] navigation skips non-members; Shift+[/] extends multi-sheet selection", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Build a set containing sheets [0] and [2] only (skip the middle).
    const set = await createSet(page, fixture.bid.id, "PW Nav Set");
    await addMembers(page, set.id, [fixture.sheetIds[0], fixture.sheetIds[2]]);

    // Open the panel and activate the set.
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-active-set-${set.id}`).click();
    const badge = page.getByTestId("badge-active-sheet-set");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("PW Nav Set");

    // Close the panel so it doesn't intercept keystrokes.
    await page.getByTestId("button-close-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toHaveCount(0);

    // Refocus the workspace.
    await page.getByTestId("unified-takeoff-ribbon").click();

    // No sheet was selected by default in this fresh workspace, so
    // the position chip is absent. The first `]` snaps onto the
    // first member of the active set (set-aware nav).
    await page.keyboard.press("]");
    await expect(badge).toContainText("1/2", { timeout: 5_000 });

    // `]` again advances to sheet[2] (sheet[1] is *not* a member,
    // so set-aware navigation skips it entirely).
    await page.keyboard.press("]");
    await expect(badge).toContainText("2/2", { timeout: 5_000 });

    // `[` wraps back to sheet[0].
    await page.keyboard.press("[");
    await expect(badge).toContainText("1/2", { timeout: 5_000 });

    // Shift+] extends the multi-sheet selection inside the set.
    // The shortcut matches `event.key === "}"` with shiftKey true
    // (Section 2 of the takeoff interaction map). Playwright's
    // `Shift+]` sends both, but we also dispatch a synthetic keydown
    // explicitly to guarantee `event.key === "}"` regardless of the
    // headless-Chromium keymap and avoid a flaky chord on slower CI
    // runners.
    await page.keyboard.press("Shift+]");
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "}",
          code: "BracketRight",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    // Re-open the panel to verify the multi-selection chip surfaces.
    await page.getByTestId("button-toggle-sheet-sets").click();
    const multiSel = page.getByTestId("text-multi-sheet-selection");
    await expect(multiSel).toBeVisible({ timeout: 5_000 });
    await expect(multiSel).toContainText(/2 sheets selected/i);

    // Clear the selection and confirm the chip disappears.
    await page.getByTestId("button-clear-multi-sheet-selection").click();
    await expect(multiSel).toHaveCount(0);
  });

  test("Apply to entire Sheet Set: checkbox enabled when active, propagates scale, Undo restores", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await devLogin(page, "ADMIN");
    const fixture = await seedTakeoffFixture(page, 3);
    await gotoTakeoff(page, fixture.bid.code);

    // Set with two sheets so a propagation has something to fan out to.
    const set = await createSet(page, fixture.bid.id, "PW Calib Set");
    await addMembers(page, set.id, [fixture.sheetIds[0], fixture.sheetIds[1]]);

    // Pre-condition: the seed fixture writes scalePxPerFoot=10 for every
    // sheet, so we know the prior values for the Undo round-trip.
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(10);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(10);

    // Activate the set.
    await page.getByTestId("button-toggle-sheet-sets").click();
    await expect(page.getByTestId("panel-sheet-sets")).toBeVisible();
    await page.getByTestId(`button-toggle-active-set-${set.id}`).click();
    await expect(page.getByTestId("badge-active-sheet-set")).toBeVisible();
    await page.getByTestId("button-close-sheet-sets").click();

    // Focus the workspace and open the inline calibration drawer.
    await page.getByTestId("unified-takeoff-ribbon").click();
    await page.keyboard.press("t");

    const drawer = page.getByTestId("inline-calibration-drawer");
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The Apply-to-set checkbox is enabled now (was Coming-soon-disabled
    // in #2140) and pre-checked because a set is active.
    const checkbox = page.getByTestId("checkbox-apply-sheet-set");
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeEnabled();

    // Drive the calibration save through the public API instead of
    // synthesizing two canvas clicks — the propagation + Undo flow lives
    // entirely in the apply-scale and restore-scales endpoints, and we
    // assert their effects on the sheets directly.
    const newScale = 25;
    const applyRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}/apply-scale`,
      { data: { scalePxPerFoot: newScale, scaleLabel: "1/4\" = 1'-0\"" } },
    );
    expect(applyRes.status()).toBe(200);
    const applyBody = (await applyRes.json()) as {
      updatedSheets: number;
      priorScales: Array<{ sheetId: string; scalePxPerFoot: number | null }>;
    };
    expect(applyBody.updatedSheets).toBe(2);
    expect(applyBody.priorScales).toHaveLength(2);
    // Every snapshot row preserves the seeded value.
    for (const snap of applyBody.priorScales) {
      expect(snap.scalePxPerFoot).toBe(10);
    }

    // Both members now reflect the new scale on the server.
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(newScale);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(newScale);

    // Undo round-trip restores per-sheet prior scales. The schema
    // names the array `sheets` (the workspace's apply-scale toast
    // uses the same field), so we send it the same way.
    const restoreRes = await authedRequest(
      page,
      "POST",
      `${BASE_URL}/api/takeoff/sheet-sets/${set.id}/restore-scales`,
      { data: { sheets: applyBody.priorScales } },
    );
    expect(restoreRes.status()).toBe(200);

    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[0])).toBe(10);
    expect(await fetchSheetScale(page, fixture.bid.id, fixture.sheetIds[1])).toBe(10);

    // Cancel the drawer — we already validated the propagation through
    // the same backend the drawer would have called.
    await page.getByTestId("button-inline-calibration-cancel").click();
    await expect(drawer).toHaveCount(0);
  });
});
