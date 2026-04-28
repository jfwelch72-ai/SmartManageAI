import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas as clickOnCanvasHelper } from "./helpers/canvasDrag";

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

interface BidResponse {
  id: string;
  code: string;
}

async function createBid(page: Page, suffix: number): Promise<BidResponse> {
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `PW Ribbon Bid ${suffix}`,
      clientName: "PW Ribbon Client",
      bidAmount: "100000",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as BidResponse;
}

interface TakeoffFixture {
  bid: { id: string; code: string };
  sheetIds: string[];
  versionIds: string[];
  measurementIds: string[];
}

/**
 * Seed a bid with N sheets, N versions, and 1 measurement so we can
 * press [/]/,/./Cmd+D/Cmd+Z and assert workspace state really moves.
 * This hits a dev-only seed endpoint added under /api/dev so we don't
 * have to upload a real PDF in e2e.
 */
async function seedTakeoffFixture(
  page: Page,
  opts: { sheetCount?: number; versionCount?: number; measurementCount?: number } = {},
): Promise<TakeoffFixture> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-takeoff-fixture`,
    {
      data: {
        sheetCount: opts.sheetCount ?? 2,
        versionCount: opts.versionCount ?? 2,
        measurementCount: opts.measurementCount ?? 1,
      },
    },
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
  // The right-hand TakeoffSidebar is `absolute top-0 right-0 h-full` and
  // overlays the rightmost ribbon groups (Verify, View) plus the bottom
  // status bar. Collapse it up front so ribbon clicks aren't intercepted.
  await collapseTakeoffSidebar(page);
}

async function collapseTakeoffSidebar(page: Page) {
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
}

async function focusRibbon(page: Page) {
  // Make sure the keyboard handler is mounted and the ribbon owns focus
  // (i.e. no input or modal trap is intercepting our keys).
  await page.getByTestId("unified-takeoff-ribbon").click();
  // Click lands on a div, not an input, so document.activeElement remains
  // <body>, which is exactly what useTakeoffShortcuts expects (it ignores
  // events whose target is an editable element).
}

test.describe("Takeoff Unified Ribbon + Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("renders all 7 ribbon groups with collapse persistence", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);

    // 7 groups defined in docs/takeoff-interaction-map.md §1.
    for (const groupId of [
      "select",
      "measure",
      "annotate",
      "snap",
      "constrain",
      "verify",
      "view",
    ]) {
      await expect(page.getByTestId(`ribbon-group-${groupId}`)).toBeVisible();
    }

    // Collapse the Verify group, reload, expect it to remain collapsed
    // because we persisted the open state to localStorage keyed on the
    // logged-in user id (Section 1, "remembers its open state per user").
    const toggle = page.getByTestId("ribbon-group-toggle-verify");
    const tools = page.getByTestId("ribbon-group-tools-verify");
    await expect(tools).toBeVisible();
    await toggle.click();
    await expect(tools).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
      timeout: 15_000,
    });
    await collapseTakeoffSidebar(page);
    await expect(page.getByTestId("ribbon-group-tools-verify")).toHaveCount(0);

    // Re-open so we leave a clean default state for any later reruns.
    await page.getByTestId("ribbon-group-toggle-verify").click();
    await expect(page.getByTestId("ribbon-group-tools-verify")).toBeVisible();
  });

  test("single-key shortcuts swap the active tool", async ({ page }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    // Tool keys per Section 2 of the interaction map.
    const cases: Array<{ key: string; toolId: string }> = [
      { key: "v", toolId: "select" },
      { key: "h", toolId: "pan" },
      { key: "l", toolId: "linear" },
      { key: "p", toolId: "polyline" },
      { key: "a", toolId: "area" },
      { key: "r", toolId: "arc" },
      { key: "c", toolId: "count" },
      { key: "n", toolId: "note" },
    ];

    for (const { key, toolId } of cases) {
      await page.keyboard.press(key);
      const btn = page.getByTestId(`ribbon-tool-${toolId}`);
      await expect(btn).toHaveAttribute("aria-pressed", "true", {
        timeout: 2000,
      });
    }
  });

  test("S opens snap HUD; 1-7 toggles individual snap modes", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    // Endpoint is on by default — pressing 1 should DISABLE it.
    await expect(page.getByTestId("ribbon-tool-endpoint")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    await page.keyboard.press("1");
    await expect(page.getByTestId("ribbon-tool-endpoint")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // HUD stays open so the user can fire 2,3,4 in quick succession to
    // build up a multi-mode set without re-entering S between each.
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    // Toggle endpoint back on (1 again, HUD still open) so reload state
    // is clean for any subsequent reruns.
    await page.keyboard.press("1");
    await expect(page.getByTestId("ribbon-tool-endpoint")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Esc closes the HUD per the keyboard contract.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);
  });

  test("snap HUD digits 1-7 each toggle the matching snap mode (endpoint, midpoint, intersection, perpendicular, center, nearest, grid)", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    // SNAP_MODE_ORDER in client/src/components/takeoff/hosts/takeoff-shortcuts.ts
    // declares the canonical 1→7 mapping. If a regression re-orders the array
    // (e.g. swaps midpoint↔intersection) or drops the trailing "grid" entry,
    // this test must fail.
    const snapModes: Array<{ digit: string; mode: string; initialActive: boolean }> = [
      { digit: "1", mode: "endpoint", initialActive: true },
      { digit: "2", mode: "midpoint", initialActive: true },
      { digit: "3", mode: "intersection", initialActive: true },
      { digit: "4", mode: "perpendicular", initialActive: false },
      { digit: "5", mode: "center", initialActive: false },
      { digit: "6", mode: "nearest", initialActive: false },
      { digit: "7", mode: "grid", initialActive: false },
    ];

    // Workspace seeds enabledSnapModes = ["endpoint","midpoint","intersection"]
    // on a fresh browser context (no localStorage entry yet), so the snap
    // ribbon buttons reflect that exact starting set.
    for (const { mode, initialActive } of snapModes) {
      await expect(page.getByTestId(`ribbon-tool-${mode}`)).toHaveAttribute(
        "aria-pressed",
        initialActive ? "true" : "false",
      );
    }

    await page.keyboard.press("s");
    await expect(page.getByTestId("snap-hud")).toBeVisible();

    // Walk every digit and assert both the in-HUD chip (data-active) and the
    // matching ribbon button (aria-pressed) flip away from their initial
    // value. The HUD stays open across presses per the keyboard contract.
    for (const { digit, mode, initialActive } of snapModes) {
      const ribbonBtn = page.getByTestId(`ribbon-tool-${mode}`);
      const hudChip = page.getByTestId(`snap-hud-mode-${mode}`);

      await page.keyboard.press(digit);

      const expectedAfter = !initialActive;
      await expect(ribbonBtn).toHaveAttribute(
        "aria-pressed",
        expectedAfter ? "true" : "false",
        { timeout: 2000 },
      );
      await expect(hudChip).toHaveAttribute(
        "data-active",
        expectedAfter ? "true" : "false",
      );
      await expect(page.getByTestId("snap-hud")).toBeVisible();
    }

    // Press each digit a second time to restore the original snap-mode set
    // — keeps the per-user localStorage state clean for any later reruns
    // that share the same browser profile.
    for (const { digit, mode, initialActive } of snapModes) {
      await page.keyboard.press(digit);
      await expect(page.getByTestId(`ribbon-tool-${mode}`)).toHaveAttribute(
        "aria-pressed",
        initialActive ? "true" : "false",
        { timeout: 2000 },
      );
    }

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("snap-hud")).toHaveCount(0);
  });

  test("Cmd/Ctrl+/ opens cheat-sheet grouped by ribbon group, Esc closes", async ({
    page,
    browserName,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const mod = browserName === "webkit" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+/`);
    await expect(page.getByTestId("dialog-cheat-sheet")).toBeVisible();

    // Cheat sheet groups by the canonical ribbon-group ids so the
    // overlay matches the ribbon layout the user sees on screen
    // (Section 8 of the interaction map). "global" holds bindings
    // that aren't tied to any specific ribbon group (undo/redo,
    // sheet/version nav, cheat-sheet itself).
    for (const group of [
      "select",
      "measure",
      "annotate",
      "snap",
      "constrain",
      "verify",
      "view",
      "global",
    ]) {
      await expect(
        page.getByTestId(`cheat-sheet-group-${group}`),
      ).toBeVisible();
    }

    // Each group should at least be reachable via canonical row ids.
    await expect(
      page.getByTestId("cheat-sheet-row-tool.linear"),
    ).toBeVisible();
    await expect(
      page.getByTestId("cheat-sheet-row-edit.undo"),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dialog-cheat-sheet")).toHaveCount(0);
  });

  test("cheat-sheet search filters rows and shows match count / empty state", async ({
    page,
    browserName,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const mod = browserName === "webkit" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+/`);
    await expect(page.getByTestId("dialog-cheat-sheet")).toBeVisible();

    const search = page.getByTestId("input-cheat-sheet-search");
    await search.fill("undo");

    await expect(page.getByTestId("cheat-sheet-row-edit.undo")).toBeVisible();
    // Tool rows that don't match should disappear.
    await expect(
      page.getByTestId("cheat-sheet-row-tool.linear"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("text-cheat-sheet-match-count"),
    ).toBeVisible();

    // No-match path renders the empty placeholder.
    await search.fill("zzzzzz-no-match-zzzzzz");
    await expect(page.getByTestId("text-cheat-sheet-empty")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dialog-cheat-sheet")).toHaveCount(0);
  });

  test("Ortho toggle (O) and preset cycle (Shift+O)", async ({ page }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const orthoBtn = page.getByTestId("ribbon-tool-ortho");
    const presetLabel = page.getByTestId("ribbon-ortho-preset");

    await expect(orthoBtn).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("o");
    await expect(orthoBtn).toHaveAttribute("aria-pressed", "true");

    // Capture the current preset label, then press Shift+O — the label
    // should change as the constrain preset rotates.
    const before = (await presetLabel.textContent())?.trim() ?? "";
    await page.keyboard.press("Shift+O");
    await expect
      .poll(async () => (await presetLabel.textContent())?.trim() ?? "")
      .not.toBe(before);
  });

  test("Shift+O walks the full ortho preset cycle 15° → 30° → 45° → 90° → off", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const presetLabel = page.getByTestId("ribbon-ortho-preset");
    const orthoAngleBtn = page.getByTestId("ribbon-tool-ortho-angle");

    // Workspace seeds orthoPresetIndex at ORTHO_PRESETS.length - 1, which
    // maps to the trailing `null` (== "off"). The first Shift+O bumps the
    // cycle into the 15° slot, which is also where the constrain mode
    // flips to "ortho-angle" and the ortho-angle button starts reporting
    // aria-pressed=true. The final Shift+O (5th press) lands us back on
    // "off" with the constrain group reset to "none".
    await expect(presetLabel).toHaveText("off");
    await expect(orthoAngleBtn).toHaveAttribute("aria-pressed", "false");

    const cycle: Array<{ label: string; angleActive: boolean }> = [
      { label: "15°", angleActive: true },
      { label: "30°", angleActive: true },
      { label: "45°", angleActive: true },
      { label: "90°", angleActive: true },
      { label: "off", angleActive: false },
    ];
    for (const step of cycle) {
      await page.keyboard.press("Shift+O");
      await expect(presetLabel).toHaveText(step.label);
      await expect(orthoAngleBtn).toHaveAttribute(
        "aria-pressed",
        step.angleActive ? "true" : "false",
      );
    }
  });

  test("G toggles grid snap and flips ribbon-tool-show-grid aria-pressed", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    const gridBtn = page.getByTestId("ribbon-tool-show-grid");

    // gridEnabled hydrates from localStorage and falls back to false on a
    // fresh browser context, so the View > Grid button starts inactive.
    await expect(gridBtn).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("g");
    await expect(gridBtn).toHaveAttribute("aria-pressed", "true");

    // Pressing G again toggles the snap back off — confirms the binding
    // is a real toggle and not a one-shot enable.
    await page.keyboard.press("g");
    await expect(gridBtn).toHaveAttribute("aria-pressed", "false");
  });

  test("[ / ] navigates between seeded sheets and updates the active thumbnail", async ({
    page,
  }) => {
    await devLogin(page, "ADMIN");
    // Seed a real bid with two sheets so the prev/next-sheet shortcuts
    // have somewhere to go. The seed endpoint returns the sheet ids in
    // creation order, which matches the order the workspace renders
    // them in PageThumbnailStrip.
    const fixture = await seedTakeoffFixture(page, {
      sheetCount: 2,
      versionCount: 1,
      measurementCount: 0,
    });
    await gotoTakeoff(page, fixture.bid.code);

    // Workspace defaults the thumbnail strip to collapsed; expand it so
    // we can assert thumbnail-level state.
    await page.getByTestId("button-toggle-thumbnails").click();

    const firstThumb = page.getByTestId(
      `thumbnail-sheet-${fixture.sheetIds[0]}`,
    );
    const secondThumb = page.getByTestId(
      `thumbnail-sheet-${fixture.sheetIds[1]}`,
    );

    await expect(firstThumb).toBeVisible({ timeout: 10_000 });
    // Workspace doesn't auto-pick a sheet on load; click the first
    // thumbnail to seed selectedSheet so [ / ] has a starting point.
    await firstThumb.click();
    await expect
      .poll(async () => firstThumb.getAttribute("data-active"), {
        timeout: 5000,
      })
      .toBe("true");

    await focusRibbon(page);

    // Press ] — selectedSheet should advance to the second seeded sheet.
    await page.keyboard.press("]");
    await expect
      .poll(async () => secondThumb.getAttribute("data-active"), {
        timeout: 2000,
      })
      .toBe("true");
    await expect(firstThumb).toHaveAttribute("data-active", "false");

    // Press [ — selectedSheet should return to the first seeded sheet.
    await page.keyboard.press("[");
    await expect
      .poll(async () => firstThumb.getAttribute("data-active"), {
        timeout: 2000,
      })
      .toBe("true");
    await expect(secondThumb).toHaveAttribute("data-active", "false");

    // Cheat-sheet rows for , / . remain registered.
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+/" : "Control+/",
    );
    await expect(page.getByTestId("dialog-cheat-sheet")).toBeVisible();
    await expect(
      page.getByTestId("cheat-sheet-row-nav.prev-version"),
    ).toBeVisible();
    await expect(
      page.getByTestId("cheat-sheet-row-nav.next-version"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test(", and . cycle the active takeoff version", async ({ page }) => {
    await devLogin(page, "ADMIN");
    // The fixture creates v1=DRAFT and v2=LOCKED. Combined with the
    // implicit working-draft state (selectedVersionId=null) the
    // cycle is [null, v1-draft, v2-locked]. SheetHost only shows the
    // "viewing historical" banner when the *selected* version's status
    // is LOCKED — i.e. only when we land on v2.
    const fixture = await seedTakeoffFixture(page, {
      sheetCount: 2,
      versionCount: 2,
      measurementCount: 1,
    });
    await gotoTakeoff(page, fixture.bid.code);

    await page.getByTestId("button-toggle-thumbnails").click();
    const firstThumb = page.getByTestId(
      `thumbnail-sheet-${fixture.sheetIds[0]}`,
    );
    await expect(firstThumb).toBeVisible({ timeout: 10_000 });
    await firstThumb.click();
    await expect
      .poll(async () => firstThumb.getAttribute("data-active"), {
        timeout: 5000,
      })
      .toBe("true");

    await focusRibbon(page);

    const banner = page.getByTestId("banner-viewing-historical");

    // We start on the working draft — banner must not exist.
    await expect(banner).toHaveCount(0);

    // Press . once — cycle moves to v1 (DRAFT snapshot). Banner stays
    // hidden because v1.status === "DRAFT".
    await page.keyboard.press(".");
    await expect(banner).toHaveCount(0, { timeout: 3_000 });

    // Press . again — cycle moves to v2 (LOCKED). Banner appears.
    await page.keyboard.press(".");
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // Press , — cycle moves back to v1 (DRAFT). Banner hides again.
    await page.keyboard.press(",");
    await expect(banner).toHaveCount(0, { timeout: 5_000 });

    // Press , again — back to working draft. Banner still hidden.
    await page.keyboard.press(",");
    await expect(banner).toHaveCount(0);
  });

  test("Cmd/Ctrl+D duplicates the selected measurement (and undo/redo bindings are registered)", async ({
    page,
    browserName,
  }) => {
    await devLogin(page, "ADMIN");
    // Seed two sheets — the workspace's "toggle thumbnail strip" button
    // only renders when sheets.length > 1, and we use the strip to pick
    // the sheet (selectedSheet is null on load until clicked).
    const fixture = await seedTakeoffFixture(page, {
      sheetCount: 2,
      versionCount: 1,
      measurementCount: 1,
    });
    await gotoTakeoff(page, fixture.bid.code);

    const mod = browserName === "webkit" ? "Meta" : "Control";

    // Cheat-sheet still lists undo / redo / duplicate (Section 8). Undo
    // and redo work against the per-session takeoff history queue, so
    // they have nothing to do for purely seeded measurements; we keep
    // those as registration assertions only.
    await page.keyboard.press(`${mod}+/`);
    await expect(page.getByTestId("dialog-cheat-sheet")).toBeVisible();
    for (const id of ["edit.undo", "edit.redo", "edit.duplicate"]) {
      await expect(page.getByTestId(`cheat-sheet-row-${id}`)).toBeVisible();
    }
    await page.keyboard.press("Escape");

    // Workspace doesn't auto-pick a sheet on load — open the thumbnail
    // strip and click the seeded sheet so the measurement-table footer
    // button appears and queries the correct sheet's measurements.
    const sheetId = fixture.sheetIds[0];
    const measurementId = fixture.measurementIds[0];
    expect(measurementId).toBeTruthy();

    await page.getByTestId("button-toggle-thumbnails").click();
    const thumb = page.getByTestId(`thumbnail-sheet-${sheetId}`);
    await expect(thumb).toBeVisible({ timeout: 10_000 });
    await thumb.click();
    await expect
      .poll(async () => thumb.getAttribute("data-active"), { timeout: 5000 })
      .toBe("true");

    // Collapse the right-side takeoff sidebar — it overlays the bottom
    // status bar on narrow viewports and intercepts clicks on the
    // measurement-table toggle.
    const collapseSidebar = page.getByTestId("button-collapse-takeoff-sidebar");
    if (await collapseSidebar.isVisible().catch(() => false)) {
      await collapseSidebar.click();
    }

    await page.getByTestId("button-toggle-measurement-table").click();
    const row = page.getByTestId(`measurement-row-${measurementId}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // Capture the measurement count, fire Cmd/Ctrl+D, then expect the
    // count to grow by one (the duplicate write hits the same sheet).
    const listUrl = `${BASE_URL}/api/takeoff/sheets/${sheetId}/measurements`;
    const beforeRes = await page.request.get(listUrl);
    expect(beforeRes.status()).toBe(200);
    const beforeCount = ((await beforeRes.json()) as unknown[]).length;

    await focusRibbon(page);
    await page.keyboard.press(`${mod}+d`);

    await expect
      .poll(
        async () => {
          const r = await page.request.get(listUrl);
          if (r.status() !== 200) return -1;
          return ((await r.json()) as unknown[]).length;
        },
        { timeout: 5000 },
      )
      .toBe(beforeCount + 1);

    // Cmd/Ctrl+Z undoes the duplicate (the takeoffHistory queue
    // captured the create when Cmd+D fired). Count should drop back
    // to the original.
    await page.keyboard.press(`${mod}+z`);
    await expect
      .poll(
        async () => {
          const r = await page.request.get(listUrl);
          if (r.status() !== 200) return -1;
          return ((await r.json()) as unknown[]).length;
        },
        { timeout: 5000 },
      )
      .toBe(beforeCount);

    // Cmd/Ctrl+Shift+Z redoes — count grows by one again.
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect
      .poll(
        async () => {
          const r = await page.request.get(listUrl);
          if (r.status() !== 200) return -1;
          return ((await r.json()) as unknown[]).length;
        },
        { timeout: 5000 },
      )
      .toBe(beforeCount + 1);
  });

  test("Esc cancels drawing and exits to Select", async ({ page }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    await page.keyboard.press("l");
    await expect(page.getByTestId("ribbon-tool-linear")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Esc on an idle (no in-progress draw) Linear tool should fall
    // through to closing modals — the Linear tool stays selected
    // because the workspace doesn't auto-revert. We instead verify
    // pressing V returns to Select cleanly.
    await page.keyboard.press("v");
    await expect(page.getByTestId("ribbon-tool-select")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("T opens the calibrate dialog from a focused ribbon", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);
    await focusRibbon(page);

    // The standalone takeoff page mounts <PlanScaleModal> in fullscreen
    // mode, so the dialog renders with `dialog-plan-scale-fullscreen`.
    const dialog = page.getByTestId("dialog-plan-scale-fullscreen");
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press("t");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Cheat sheet still advertises the binding so users can discover it
    // alongside the Verify > Calibrate ribbon button.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+/" : "Control+/",
    );
    await expect(page.getByTestId("dialog-cheat-sheet")).toBeVisible();
    await expect(
      page.getByTestId("cheat-sheet-row-verify.calibrate"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("T is gated off while a measurement is mid-draw", async ({ page }) => {
    await devLogin(page, "ADMIN");
    // Seed a calibrated sheet (scalePxPerFoot = 10) so the linear tool
    // actually accepts a first canvas click and flips isDrawing to true.
    // Without the seeded scale the workspace toasts "Calibrate the sheet
    // first" and never enters drawing state. Two sheets are required so
    // the workspace's "toggle thumbnail strip" button (only rendered
    // when sheets.length > 1) is available.
    const fixture = await seedTakeoffFixture(page, {
      sheetCount: 2,
      versionCount: 1,
      measurementCount: 0,
    });
    await gotoTakeoff(page, fixture.bid.code);

    // Pick the seeded sheet so CanvasStage mounts and a Konva canvas
    // becomes clickable.
    await page.getByTestId("button-toggle-thumbnails").click();
    const thumb = page.getByTestId(
      `thumbnail-sheet-${fixture.sheetIds[0]}`,
    );
    await expect(thumb).toBeVisible({ timeout: 10_000 });
    await thumb.click();
    await expect
      .poll(async () => thumb.getAttribute("data-active"), {
        timeout: 5_000,
      })
      .toBe("true");

    const canvas = page.locator(".konvajs-content canvas").first();
    await canvas.waitFor({ state: "visible", timeout: 15_000 });

    await focusRibbon(page);

    // Switch to the Linear tool, then click the canvas once to place
    // the first point — this is the path that flips `isDrawing` true
    // (see use-takeoff-interactions.ts → "linear" branch).
    await page.keyboard.press("l");
    await expect(page.getByTestId("ribbon-tool-linear")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Click well inside the canvas. The Konva stage on the standalone
    // takeoff page renders short and wide (e.g. 1280×~210 in the
    // default Playwright viewport) when no PDF bitmap is attached, so a
    // y close to the canvas height risks landing near the bottom edge
    // and being routed to the status row underneath. (400, 100) is
    // safely inside both axes.
    await clickOnCanvasHelper(page, canvas, { x: 400, y: 100 });

    // The drawing-guide-bar overlay only renders while `isDrawing` is
    // true on a desktop viewport, so its presence proves we're really
    // mid-draw and the `isToolish` guard inside useTakeoffShortcuts
    // should now block T.
    await expect(page.getByTestId("drawing-guide-bar")).toBeVisible({
      timeout: 5_000,
    });

    const dialog = page.getByTestId("dialog-plan-scale-fullscreen");
    await expect(dialog).toHaveCount(0);

    await page.keyboard.press("t");

    // The calibrate dialog must NOT open — `T` is in the `isToolish`
    // bucket and is suppressed while a draw is in flight. Give the
    // event loop a moment so any (incorrectly) queued state update
    // would have rendered before we assert absence.
    await page.waitForTimeout(250);
    await expect(dialog).toHaveCount(0);

    // And the draw must still be in flight — the gate didn't accidentally
    // cancel the in-progress measurement.
    await expect(page.getByTestId("drawing-guide-bar")).toBeVisible();

    // Bail out of the draw cleanly so the test leaves no in-progress
    // state behind for any subsequent reruns.
    await page.keyboard.press("Escape");
  });

  test("offline / autosave indicator transitions: idle hidden → offline visible → saved flash → idle hidden", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);

    const indicator = page.getByTestId("indicator-offline-status");

    // Initial idle state — placeholder rendered with data-state="idle"
    // and visually hidden.
    await expect(indicator).toHaveAttribute("data-state", "idle");
    await expect(indicator).toBeHidden();

    // Flip the browser offline; the navigator-driven listener inside
    // the ribbon should switch the indicator into the visible offline
    // state within a tick.
    await page.context().setOffline(true);
    await expect
      .poll(async () => indicator.getAttribute("data-state"))
      .toBe("offline");
    await expect(indicator).toBeVisible();

    // Restore connectivity. With nothing queued we fall through to the
    // brief "saved" flash, then back to hidden idle.
    await page.context().setOffline(false);
    await expect
      .poll(async () => indicator.getAttribute("data-state"), {
        timeout: 5000,
      })
      .toBe("saved");
    await expect
      .poll(async () => indicator.getAttribute("data-state"), {
        timeout: 5000,
      })
      .toBe("idle");
    await expect(indicator).toBeHidden();
  });

  test("ribbon is keyboard-traversable: Tab/arrow/Enter activates a tool", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);

    // Focus the first tool of the Measure group directly (roving tabindex
    // means only one button per group is in the tab order).
    const linearBtn = page.getByTestId("ribbon-tool-linear");
    await linearBtn.focus();

    // ArrowRight should move focus to the next tool in the same group.
    await page.keyboard.press("ArrowRight");
    const polylineBtn = page.getByTestId("ribbon-tool-polyline");
    await expect(polylineBtn).toBeFocused();

    // ArrowLeft walks back to the previous tool in the same group.
    await page.keyboard.press("ArrowLeft");
    await expect(linearBtn).toBeFocused();

    // Enter activates the focused tool.
    await page.keyboard.press("Enter");
    await expect(linearBtn).toHaveAttribute("aria-pressed", "true");
  });

  test("Tab moves focus group → group across the active tool of each group", async ({
    page,
  }) => {
    const suffix = Date.now();
    await devLogin(page, "ADMIN");
    const bid = await createBid(page, suffix);
    await gotoTakeoff(page, bid.code);

    // Roving tabindex puts exactly one button per group in the natural
    // tab order. With no prior interaction, focusedIdx defaults to 0 for
    // every group, so Tab from Select > Select should land on
    // Measure > Linear, then Annotate > Note, etc.
    const selectBtn = page.getByTestId("ribbon-tool-select");
    await selectBtn.focus();
    await expect(selectBtn).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("ribbon-tool-linear")).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByTestId("ribbon-tool-note")).toBeFocused();

    // Shift+Tab walks the same chain backwards group → group.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("ribbon-tool-linear")).toBeFocused();
  });
});
