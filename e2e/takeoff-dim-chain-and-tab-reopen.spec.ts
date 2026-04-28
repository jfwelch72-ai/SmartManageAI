// Task #2227 — End-to-end coverage for the typed-length **chain mode**
// (Repeat / chain switch) and the **Tab-to-reopen** flow added in
// Task #2203.
//
// The cursor badge half of the contract is covered by the focused
// vitest suite at
// `client/src/components/takeoff/hosts/__tests__/DimInputCursorBadge.test.tsx`
// (Konva nodes are not in the DOM, so a Playwright DOM query can't
// see the badge — and the conditional render contract doesn't need
// the full takeoff stack to verify).
//
// What this spec pins down — that no other e2e currently covers:
//
//   1. With chain mode ON and a length locked, multiple draw clicks
//      keep `pendingDimLengthFt` set. Concretely: two consecutive
//      LINEAR draws each commit a segment whose pixel distance
//      matches the locked length, AND the ribbon's `indicator-dim-lock`
//      chip stays in `data-state="chained"` across both. If the
//      chain ref ever stops gating `setPendingDimLengthFt(null)` in
//      `onConsumeDimLength`, the second draw would either snap to
//      the cursor distance (no lock) or hide the chip — both caught
//      here.
//
//   2. Pressing Tab while drawing reopens the Dim Input dialog with
//      the prior locked length pre-filled. The Tab handler
//      explicitly preserves the existing length so the user can
//      tweak it without retyping. A regression that re-mounts the
//      dialog with an empty input (or fails to open at all because
//      another Tab handler swallowed the event) is caught here.
//
// Functional outcomes are asserted by intercepting the same backend
// POSTs the workspace makes (mirrors the existing
// `takeoff-typed-dim-and-calibration.spec.ts` strategy) and by
// reading the rendered chip state, instead of relying on internal
// component state.

import { test, expect, type Page, type Locator } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";
import { clickOnCanvas } from "./helpers/canvasDrag";

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

async function gotoTakeoff(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/takeoff/${bidCode}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("unified-takeoff-ribbon")).toBeVisible({
    timeout: 15_000,
  });
  // Match the typed-dim/calibration spec — close the right sidebar
  // so its overlay doesn't intercept clicks against the rightmost
  // ribbon groups, where Verify (and the Dim Input button) live.
  const collapse = page.getByTestId("button-collapse-takeoff-sidebar");
  if (await collapse.isVisible().catch(() => false)) {
    await collapse.click();
    await expect(collapse).toHaveCount(0);
  }
  // Same focus-the-ribbon trick — keystrokes (Tab) flow to
  // document.body when no tool grabs focus, which is what the
  // workspace-level Tab handler expects.
  await page.getByTestId("unified-takeoff-ribbon").click();
}

async function openDimInputDialog(page: Page) {
  // The Dim Input button lives in the Verify ribbon group, which
  // collapses to a toggle on narrow viewports. Open it if needed,
  // then click the entry. Falling back to the chip click is
  // intentional because the ribbon mounts the chip as soon as a
  // length is locked — once that's true the chip is the canonical
  // entry point and ribbon-tool-dim-input may scroll out of view.
  const groupToggle = page.getByTestId("ribbon-group-toggle-verify");
  if (await groupToggle.isVisible().catch(() => false)) {
    await groupToggle.click().catch(() => {});
  }
  const dimInputBtn = page.getByTestId("ribbon-tool-dim-input");
  await expect(dimInputBtn).toBeVisible({ timeout: 10_000 });
  await dimInputBtn.click();
  await expect(page.getByTestId("dialog-dim-input")).toBeVisible({
    timeout: 5_000,
  });
}

async function selectLinearTool(page: Page) {
  const measureToggle = page.getByTestId("ribbon-group-toggle-measure");
  if (await measureToggle.isVisible().catch(() => false)) {
    await measureToggle.click().catch(() => {});
  }
  const linearBtn = page.getByTestId("ribbon-tool-linear");
  await expect(linearBtn).toBeVisible({ timeout: 10_000 });
  await linearBtn.click();
}

test.describe("Takeoff Dim Input — chain mode + Tab reopen (Task #2227)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
  });

  test("chain mode keeps pendingDimLengthFt locked across consecutive draws", async ({
    page,
  }) => {
    // Functional contract: with the dialog's "Repeat / chain"
    // switch on, two consecutive LINEAR draws must each commit a
    // segment whose pixel distance equals the locked length
    // (12.5 ft × 10 px/ft = 125 px on the seeded sheet), AND the
    // ribbon's dim-lock chip must stay in `data-state="chained"`
    // the entire time. The chain-mode contract is enforced by
    // `dimInputRepeatRef.current` in `TakeoffWorkspace`'s
    // `onConsumeDimLength` callback — if that ref ever stops
    // gating the `setPendingDimLengthFt(null)` clear, the second
    // draw snaps to the cursor distance and the chip disappears.
    await devLogin(page, "ADMIN");
    const { bid, sheetIds } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    // 1) Open the Dim Input dialog and configure chain mode + length.
    await openDimInputDialog(page);
    const repeatSwitch = page.getByTestId("switch-dim-repeat");
    // The switch may already be on (it persists across reloads via
    // localStorage). Force it to the on state.
    if ((await repeatSwitch.getAttribute("data-state")) !== "checked") {
      await repeatSwitch.click();
    }
    await expect(repeatSwitch).toHaveAttribute("data-state", "checked");
    await page.getByTestId("input-dim-length").fill("12.5");
    // The Apply button label flips to "Chain Length" when chain
    // mode is on, so the button copy itself confirms the toggle
    // wired through.
    const applyBtn = page.getByTestId("button-dim-apply");
    await expect(applyBtn).toContainText("Chain Length");
    await applyBtn.click();
    await expect(page.getByTestId("dialog-dim-input")).toHaveCount(0);

    // 2) The lock chip must immediately show "Chain" + 12.50 ft.
    //    This is the rendered proof that the dialog's Apply
    //    pushed the value through to TakeoffWorkspace.
    const chip = page.getByTestId("indicator-dim-lock");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state", "chained");
    await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
      "12.50 ft",
    );

    // 3) Pick LINEAR and run the first draw.
    await selectLinearTool(page);
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });

    const firstPost = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    );
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });
    // Second click commits the segment with the locked length
    // applied along the cursor direction.
    await clickOnCanvas(page, canvas, { x: 400, y: 200 });
    const firstReq = await firstPost;
    const firstBody = firstReq.postDataJSON() as {
      sheetId?: string;
      type?: string;
      points?: Array<{ x: number; y: number }>;
    };
    expect(firstBody.sheetId).toBe(sheetIds[0]);
    expect(firstBody.type).toBe("LINEAR");
    const [a0, a1] = firstBody.points!;
    const firstPx = Math.hypot(a1.x - a0.x, a1.y - a0.y);
    // 12.5 ft × 10 px/ft = 125 px; small tolerance for the
    // angle-rotation rounding in `applyFixedLength`.
    expect(firstPx).toBeGreaterThan(124);
    expect(firstPx).toBeLessThan(126);

    // 4) The chip MUST still be visible in chain state — the
    //    contract this test exists to enforce. Without
    //    `dimInputRepeatRef.current` gating the consume callback,
    //    the chip would disappear here and the next draw would
    //    use the raw cursor distance.
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state", "chained");
    await expect(page.getByTestId("text-dim-lock-length")).toHaveText(
      "12.50 ft",
    );

    // 5) Run a second draw at a different cursor direction.
    //    With chain mode on, this segment must ALSO be 125 px —
    //    proving the lock survived the first commit.
    const secondPost = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        /\/api\/takeoff\/measurements/.test(req.url()),
      { timeout: 15_000 },
    );
    await clickOnCanvas(page, canvas, { x: 220, y: 320 });
    await clickOnCanvas(page, canvas, { x: 220, y: 500 });
    const secondReq = await secondPost;
    const secondBody = secondReq.postDataJSON() as {
      sheetId?: string;
      type?: string;
      points?: Array<{ x: number; y: number }>;
    };
    expect(secondBody.type).toBe("LINEAR");
    const [b0, b1] = secondBody.points!;
    const secondPx = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    expect(secondPx).toBeGreaterThan(124);
    expect(secondPx).toBeLessThan(126);

    // 6) And the chip is STILL there after the second draw.
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state", "chained");
  });

  test("Tab while drawing reopens the Dim Input dialog with the prior length pre-filled", async ({
    page,
  }) => {
    // Functional contract: after locking a length and starting a
    // measure draw, pressing Tab must reopen the Dim Input dialog
    // with the locked value already populated in the input. The
    // Tab handler in `TakeoffWorkspace` reads
    // `pendingDimLengthFtRef.current` and seeds `dimInputValue`
    // from it — a regression that drops that pre-fill (or fails
    // to open the dialog because another Tab handler intercepted
    // the event) is caught here.
    await devLogin(page, "ADMIN");
    const { bid } = await seedTakeoffFixture(page);
    await gotoTakeoff(page, bid.code);

    // 1) Lock a length without chain mode — exercises the
    //    one-shot path AND ensures the pre-fill comes from
    //    `pendingDimLengthFtRef`, not from a chained dialog
    //    that simply never closed.
    await openDimInputDialog(page);
    const repeatSwitch = page.getByTestId("switch-dim-repeat");
    if ((await repeatSwitch.getAttribute("data-state")) === "checked") {
      await repeatSwitch.click();
    }
    await expect(repeatSwitch).toHaveAttribute("data-state", "unchecked");
    await page.getByTestId("input-dim-length").fill("8");
    await page.getByTestId("button-dim-apply").click();
    await expect(page.getByTestId("dialog-dim-input")).toHaveCount(0);
    await expect(page.getByTestId("indicator-dim-lock")).toHaveAttribute(
      "data-state",
      "locked",
    );

    // 2) Pick a measure tool and start a draw. The Tab handler
    //    only fires when `dimHudActive` is true, which requires
    //    a draw-tool to be active.
    await selectLinearTool(page);
    const canvas: Locator = page.locator(".konvajs-content canvas").first();
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await clickOnCanvas(page, canvas, { x: 200, y: 200 });

    // 3) The HUD becomes visible once `dimHudActive` flips on —
    //    use that as a proof point that we're in the right state
    //    for the workspace-level Tab handler to fire.
    await expect(page.getByTestId("dim-input-hud")).toBeVisible({
      timeout: 5_000,
    });

    // 4) Press Tab. Critical: the typed-input HUD's own capture
    //    handler only swallows Tab when its buffer is non-empty
    //    (we never typed anything), so this Tab bubbles up to the
    //    workspace handler that opens the dialog.
    await page.keyboard.press("Tab");

    // 5) Dialog must reopen with the prior length pre-filled.
    await expect(page.getByTestId("dialog-dim-input")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByTestId("input-dim-length")).toHaveValue("8");
  });
});
