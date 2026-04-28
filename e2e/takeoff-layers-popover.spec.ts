// Task #2232 — Real-browser coverage for the Layers ribbon popover's
// focus-return contract. The unit test in
// `client/src/components/takeoff/__tests__/UnifiedTakeoffRibbon.test.tsx`
// only exercises the unmount path because Radix's FocusScope auto-focus
// behaviour (which fires `onCloseAutoFocus`) does not run faithfully
// inside jsdom — there is no real focus model behind it. This spec
// drives a real Chromium / WebKit / Firefox session so we can verify
// that closing the popover via Escape OR an outside click really does
// hand keyboard focus back to the takeoff canvas viewport
// (`tabIndex=-1` div with `data-testid="takeoff-canvas-viewport"`),
// which is the prerequisite for estimators continuing to use ribbon
// shortcuts (`v`, `l`, `a`, `[`, `]`, …) without first re-clicking
// the canvas.

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
  // sheetCount=1 / versionCount=1 / measurementCount=0 is the cheapest
  // shape the seed endpoint accepts and is enough to render the
  // unified takeoff ribbon (which is what we actually exercise here).
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    { data: { sheetCount: 1, versionCount: 1, measurementCount: 0 } },
  );
  expect(res.status()).toBe(200);
  return (await res.json()) as TakeoffFixture;
}

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // The right-hand TakeoffSidebar is `absolute top-0 right-0 h-full`
  // and overlays the rightmost ribbon groups (Verify, View) where the
  // Layers button lives. Collapse it up front so the click lands on the
  // ribbon button instead of being intercepted by the sidebar.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

async function openLayersPopover(page: Page) {
  const layersBtn = page.getByTestId("ribbon-tool-layers");
  await expect(layersBtn).toBeVisible();
  await expect(layersBtn).toHaveAttribute("aria-expanded", "false");
  await layersBtn.click();
  await expect(page.getByTestId("popover-layers")).toBeVisible();
  await expect(layersBtn).toHaveAttribute("aria-expanded", "true");
}

async function expectCanvasViewportFocused(page: Page) {
  // The workspace's `onLayersPopoverClose` calls
  // `containerRef.current?.focus({ preventScroll: true })` on the same
  // div that CanvasViewport renders with `tabIndex=-1` and
  // `data-testid="takeoff-canvas-viewport"`. We assert that
  // `document.activeElement` really points at that node — anything
  // else (body, the layers ribbon button, the popover trigger) means
  // the focus return regressed.
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            document.activeElement?.getAttribute("data-testid") ?? null,
        ),
      { timeout: 5_000 },
    )
    .toBe("takeoff-canvas-viewport");
}

test.describe("Task #2232 — Layers popover focus return", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("Escape closes the layers popover and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    await openLayersPopover(page);

    // Escape is the keyboard close path. Radix routes it through its
    // dismissable layer → `onOpenChange(false)` → parent state flip →
    // popover unmount → FocusScope `onCloseAutoFocus` → workspace
    // focuses the canvas viewport.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("popover-layers")).toHaveCount(0);
    await expect(page.getByTestId("ribbon-tool-layers")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await expectCanvasViewportFocused(page);
  });

  test("Outside-click closes the layers popover and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);

    await openLayersPopover(page);

    // Click well inside the canvas viewport but away from the centered
    // empty-state card / Import button — the top-left corner of the
    // viewport bounding box is just background, so the click registers
    // as an outside-click on Radix's dismissable layer without
    // triggering any of the empty-state controls.
    const canvas = page.getByTestId("takeoff-canvas-viewport");
    const box = await canvas.boundingBox();
    expect(box, "canvas viewport bounding box").not.toBeNull();
    await page.mouse.click(box!.x + 24, box!.y + 24);

    await expect(page.getByTestId("popover-layers")).toHaveCount(0);
    await expect(page.getByTestId("ribbon-tool-layers")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await expectCanvasViewportFocused(page);
  });
});
