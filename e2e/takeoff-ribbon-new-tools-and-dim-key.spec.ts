// Task #2204 — End-to-end coverage for the freshly-wired ribbon
// buttons (lasso, polyline, polygon, circle, dimension) and the
// `D` keyboard shortcut that selects the Dimension annotate tool.
//
// Before this task these buttons were disabled placeholders. This
// spec drives the unified takeoff ribbon under a seeded fixture
// (no PDF upload required) and asserts:
//
//   1. Each new ribbon button is present, visible, and NOT disabled
//      (`data-disabled="false"`, no `disabled` HTML attribute).
//   2. Clicking each one selects the tool, reflected by
//      `aria-pressed="true"` on the ribbon button.
//   3. Pressing `D` (no modifier) routes through `useTakeoffShortcuts`
//      and switches the active tool to `dimension`, lighting up the
//      annotate-group `ribbon-tool-dimension` button.

import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

async function seedTakeoffFixture(page: Page): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function collapseTakeoffSidebar(page: Page) {
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  await collapseTakeoffSidebar(page);
}

async function focusRibbon(page: Page) {
  // Mouse-click the ribbon container so document.activeElement remains
  // <body> (the click lands on a div, not an input). useTakeoffShortcuts
  // ignores keystrokes whose target is an editable element, so this is
  // the prerequisite for any plain-key shortcut e2e.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

// IDs from RIBBON_GROUPS in client/src/components/takeoff/hosts/takeoff-shortcuts.ts.
// Each one was added with `disabled` UNDEFINED (i.e. enabled). If a
// future change re-disables any of them this list catches it.
const NEW_RIBBON_TOOLS = [
  { id: "lasso", group: "select" },
  { id: "polyline", group: "measure" },
  { id: "polygon", group: "measure" },
  { id: "circle", group: "measure" },
  { id: "dimension", group: "annotate" },
] as const;

test.describe("Task #2204 — new ribbon buttons + Dimension `D` shortcut", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("lasso, polyline, polygon, circle, dimension are all visible and NOT disabled", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    for (const { id, group } of NEW_RIBBON_TOOLS) {
      // Group must be present (cheap sanity that the wiring lives in
      // the right ribbon section).
      await expect(
        page.getByTestId(`ribbon-group-${group}`),
      ).toBeVisible();

      const btn = page.getByTestId(`ribbon-tool-${id}`);
      await expect(btn).toBeVisible();
      // The unified ribbon writes `data-disabled` for both the
      // per-tool `disabled` flag and the dynamic state-driven
      // `state.disabled`. A regression that re-disables any of these
      // tools (e.g. flipping the RIBBON_GROUPS entry back to
      // `disabled: true`) flips this attribute to "true".
      await expect(btn).toHaveAttribute("data-disabled", "false");
      // Belt-and-braces: also check the native HTML disabled prop is
      // absent — playwright's `toBeDisabled` matcher reads it.
      await expect(btn).toBeEnabled();
    }
  });

  test("clicking each new ribbon button selects the corresponding tool (aria-pressed=true)", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    for (const { id } of NEW_RIBBON_TOOLS) {
      const btn = page.getByTestId(`ribbon-tool-${id}`);
      await btn.click();
      // `aria-pressed` reflects the unified ribbon's
      // `state.active = activeTool === tool` — true means the click
      // really swapped the active tool, not just visually pressed.
      await expect(btn).toHaveAttribute("aria-pressed", "true", {
        timeout: 2000,
      });
    }
  });

  test("pressing `D` enters dimension mode (annotate group, dimension button highlighted)", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const dimensionBtn = page.getByTestId("ribbon-tool-dimension");
    // Sanity: starts un-pressed (default tool is select).
    await expect(dimensionBtn).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("d");

    await expect(dimensionBtn).toHaveAttribute("aria-pressed", "true", {
      timeout: 2000,
    });

    // Pressing `V` swaps back to select — proves `D` engaged a real
    // tool selection (not a transient toggle) and didn't get swallowed
    // by some other handler like the legacy duplicate shortcut (which
    // requires Cmd/Ctrl).
    await page.keyboard.press("v");
    await expect(dimensionBtn).toHaveAttribute("aria-pressed", "false", {
      timeout: 2000,
    });
    await expect(page.getByTestId("ribbon-tool-select")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
