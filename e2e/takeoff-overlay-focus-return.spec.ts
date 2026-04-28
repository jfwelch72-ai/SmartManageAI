// Task #2237 — Real-browser coverage for the canvas-focus return that
// fires when the takeoff workspace's transient overlays close. This is
// a sibling of `takeoff-layers-popover.spec.ts` (Task #2232): the
// Layers spec exercises a Radix Popover, while this one exercises the
// non-Radix Snap HUD plus the audit overlay opacity slider — the two
// surfaces called out in the task description as missing the focus-
// return contract until now. A regression in any of the close paths
// would land keyboard focus on `<body>` (or the unmounted close
// button) and break the `v` / `l` / `a` / `[` / `]` ribbon shortcuts
// estimators rely on.

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
  // Cheapest shape that still renders the unified ribbon and the
  // CanvasViewport host (which is what we actually focus-test here).
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
  // The right-hand TakeoffSidebar overlays the rightmost ribbon groups
  // (Verify, View) so collapse it up front for predictable click
  // targeting on the View > Overlay / Versions buttons.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

async function focusRibbon(page: Page) {
  // useTakeoffShortcuts only fires when document.activeElement is NOT
  // an editable element / inside a Radix portal. Clicking the ribbon
  // div leaves activeElement on <body>, which is the contract the hook
  // expects — the same primer used in takeoff-ribbon-shortcuts.spec.ts.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function expectCanvasViewportFocused(page: Page) {
  // Workspace's focusCanvasViewport() calls
  // `containerRef.current?.focus({ preventScroll: true })` on the same
  // div CanvasViewport renders with `tabIndex=-1` and
  // `data-testid="takeoff-canvas-viewport"`. Anything else
  // (`<body>`, the snap-hud-close button that just unmounted, the
  // overlay slider close button, the Versions ribbon button) means
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

test.describe("Task #2237 — Snap HUD focus return", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("Esc closes the Snap HUD and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    // Esc routes through useTakeoffShortcuts' `close-modal` intent →
    // workspace `handleSetSnapHudOpen(false)` → focusCanvasViewport().
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });

  test("re-pressing S toggles the Snap HUD off and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    // Toggling S back off must hand focus back too — same close path
    // as Esc, just driven by the `open-snap-hud` intent flipping the
    // current value.
    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });

  test("clicking the in-HUD Close button returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    // Mouse close path: the "Close" link inside the HUD calls
    // `setSnapHudOpen(false)` which is now wrapped by the workspace.
    // Without that wrapper focus would fall on the unmounted button →
    // <body> and the next `v`/`l` keypress would silently no-op.
    await page.getByTestId("snap-hud-close").click();
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });

  test("after Snap HUD closes, single-key tool shortcuts fire without re-clicking the canvas", async ({
    page,
  }) => {
    // End-to-end smoke for the user-visible payoff: open the HUD,
    // close it via Esc, press `l` and confirm the linear tool became
    // active (which requires keyboard shortcuts to still be reaching
    // the workspace handler — i.e. focus is somewhere the handler
    // accepts, not stuck on a stale button).
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);
    await expectCanvasViewportFocused(page);

    await page.keyboard.press("l");
    await expect(page.getByTestId("ribbon-tool-linear")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 2_000 },
    );
  });
});

test.describe("Task #2237 — Audit overlay opacity slider focus return", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("clicking the slider's X closes it and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    // Open via the View > Overlay ribbon button (`action: "overlay"`
    // → `onToggleOverlay` → workspace wrapper).
    await page.getByTestId("ribbon-tool-overlay").click();
    await expect(page.getByTestId("overlay-opacity-slider")).toBeVisible();

    await page.getByTestId("button-close-overlay-slider").click();
    await expect(page.getByTestId("overlay-opacity-slider")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });

  test("re-clicking the View > Overlay ribbon button toggles the slider closed and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.getByTestId("ribbon-tool-overlay").click();
    await expect(page.getByTestId("overlay-opacity-slider")).toBeVisible();

    // Toggle path (same handler, same wrapper) — closing via the
    // ribbon button itself must also return focus to the canvas so
    // the next ribbon-shortcut keypress reaches the workspace.
    await page.getByTestId("ribbon-tool-overlay").click();
    await expect(page.getByTestId("overlay-opacity-slider")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });
});

test.describe("Task #2237 — Version history sheet focus return", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("Esc closes the version history sheet and returns focus to the canvas viewport (overrides Radix's return-to-trigger)", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.getByTestId("ribbon-tool-versions").click();
    // Sheet body renders inside a Radix dialog role — wait for that
    // before sending Esc so the dismissable layer is mounted.
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Without our `onCloseAutoFocus` override, Radix would return
    // focus to the Versions ribbon button (data-testid =
    // "ribbon-tool-versions"). The override + workspace's
    // focusCanvasViewport() lands focus on the canvas viewport
    // instead.
    await expectCanvasViewportFocused(page);
  });

  test("the sheet's built-in X close button returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.getByTestId("ribbon-tool-versions").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // The Radix Sheet ships with an absolutely-positioned close button
    // labelled "Close" (an SR-only span — see
    // client/src/components/ui/sheet.tsx). Clicking it goes through
    // the same dismissable-layer path as Esc, so our
    // `onCloseAutoFocus` override must still fire.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /close/i })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });

  test("outside-click closes the version history sheet and returns focus to the canvas viewport", async ({
    page,
  }) => {
    const fixture = await seedTakeoffFixture(page);
    await gotoTakeoff(page, fixture.bid.code);
    await focusRibbon(page);

    await page.getByTestId("ribbon-tool-versions").click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Clicking the Sheet's overlay (outside the panel) is the third
    // close path Radix supports. We click near the top-left corner of
    // the canvas viewport so the click lands on the dimmed overlay
    // backdrop rather than on any of the in-canvas controls.
    const canvas = page.getByTestId("takeoff-canvas-viewport");
    const box = await canvas.boundingBox();
    expect(box, "canvas viewport bounding box").not.toBeNull();
    await page.mouse.click(box!.x + 24, box!.y + 24);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expectCanvasViewportFocused(page);
  });
});
